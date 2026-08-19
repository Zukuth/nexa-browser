// Chrome extension install/load/unload and the whole extensions:* IPC
// surface — split out of main.js. Same dependency-injection shape as
// permissions-manager.js/adblock-manager.js: main.js stays the single owner
// of `data`/persist()/broadcastState(), this module only ever touches them
// through the functions it's handed. `views` is passed directly (not a
// getter) since it's a `const` Map in main.js — mutations are visible
// through the same reference, it's just never reassigned.
const { app, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const extractZip = require('extract-zip');
const yauzl = require('yauzl');
const { createAnchoredPopup } = require('./popup-window');

const EXTENSIONS_DIR = path.join(app.getPath('userData'), 'extensions');
if (!fs.existsSync(EXTENSIONS_DIR)) fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

function extensionIdFromInput(input) {
  const match = String(input).trim().match(/[a-p]{32}/);
  return match ? match[0] : null;
}

function readManifest(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Manifest V3 uses `action`, V2 used `browser_action`/`page_action` — real
// installed extensions can be either depending on age, so all three are
// checked in that priority order (matches Chrome's own resolution). Falls
// back to the extension's top-level `icons` (present on essentially every
// extension, action or not) if the action itself doesn't declare its own
// icon — some extensions rely on that fallback rather than repeating it.
function extractExtensionAction(manifest, dir) {
  const action = manifest.action || manifest.browser_action || manifest.page_action || null;
  const pickIconPath = (iconField) => {
    if (!iconField) return null;
    if (typeof iconField === 'string') return iconField;
    if (typeof iconField === 'object') {
      const sizes = Object.keys(iconField).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!sizes.length) return null;
      const preferred = sizes.find((s) => s >= 32) ?? sizes[sizes.length - 1];
      return iconField[String(preferred)];
    }
    return null;
  };
  const iconRel = pickIconPath(action?.default_icon) || pickIconPath(manifest.icons);
  return {
    icon: iconRel ? path.join(dir, iconRel) : null,
    popup: action?.default_popup || null,
    title: action?.default_title || manifest.name || ''
  };
}

// extract-zip has an unfixed symlink path-traversal vuln (GHSA-jmr9-qjv8-65gv):
// a malicious CRX can smuggle a symlink entry that later entries write
// through, landing files outside destDir despite extract-zip's own in-flight
// check. A post-extraction walk (assertNoEscapedEntries below) only catches
// this AFTER the out-of-bounds write already happened — it can clean up
// destDir but can't undo a file extract-zip already wrote somewhere else.
// So the real fix has to happen BEFORE extraction: scan the zip's own entry
// list (via yauzl, which extract-zip is already built on) and refuse to even
// call extractZip() if any entry is a symlink or names a path that would
// resolve outside destDir — the write this CVE depends on never gets a
// chance to happen.
const ZIP_IFMT = 61440;
const ZIP_IFLNK = 40960;

function zipEntryIsSymlink(entry) {
  const mode = (entry.externalFileAttributes >> 16) & 0xffff;
  return (mode & ZIP_IFMT) === ZIP_IFLNK;
}

function assertZipEntryPathSafe(destDir, fileName) {
  const target = path.normalize(path.join(destDir, fileName));
  const rel = path.relative(destDir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Extension archive entry "${fileName}" resolves outside its own folder — refusing to install`);
  }
}

function preValidateZipEntries(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      let settled = false;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(e);
      };
      zipfile.on('error', fail);
      zipfile.on('entry', (entry) => {
        if (settled) return;
        try {
          if (zipEntryIsSymlink(entry)) {
            throw new Error(`Extension archive contains a symlink (${entry.fileName}) — refusing to install`);
          }
          assertZipEntryPathSafe(destDir, entry.fileName);
        } catch (e) {
          fail(e);
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zipfile.readEntry();
    });
  });
}

// Defense-in-depth behind preValidateZipEntries above — re-checks the tree
// extract-zip actually produced on disk, in case something about the zip
// structure let an entry slip past the pre-scan (e.g. a bug in this exact
// check, or a future extract-zip version that resolves paths differently
// than yauzl's raw entry names suggest). An unpacked browser extension never
// legitimately needs a symlink or a path that resolves outside its own
// folder.
function assertNoEscapedEntries(destDir) {
  const realDestDir = fs.realpathSync(destDir);
  const stack = [realDestDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const lst = fs.lstatSync(full);
      if (lst.isSymbolicLink()) {
        throw new Error(`Extension archive contains a symlink (${full}) — refusing to install`);
      }
      // `dir` came off the stack already proven to be a real (symlink-free)
      // path, so a non-symlink direct child of it (`full`, just confirmed
      // above) IS its own realpath — no need to re-resolve it from the
      // filesystem root via another realpathSync call, which used to redo
      // the whole ancestor chain's resolution for every single entry.
      const rel = path.relative(realDestDir, full);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Extension archive entry resolves outside its own folder (${full}) — refusing to install`);
      }
      if (lst.isDirectory()) stack.push(full);
    }
  }
}

function createExtensionsManager({ getData, persist, broadcastState, mt, getMainWindow, views }) {
  const extensionPopupWindows = new Map();

  // Compatibilidad de extensiones: prodversion le dice al Chrome Web Store con
  // qué motor estamos, y Google puede devolver una build más vieja del paquete
  // si cree que el navegador es más antiguo de lo que realmente es. Usar la
  // versión real de Chromium en cada descarga evita pedirle a Google una
  // build pensada para un motor mucho más viejo que el que realmente ejecuta
  // la extensión. Verificado en vivo: instalación real de AdGuard Adblocker
  // (bgnkhhnnamicmpeenaelnjfhikgbkllg) completó ok con la versión corregida.
  function downloadCrx(id) {
    const lang = getData().settings.language || 'es';
    const chromeVersion = process.versions.chrome || '131.0.6778.86';
    const url =
      'https://clients2.google.com/service/update2/crx?response=redirect' +
      '&os=win&arch=x64&os_arch=x64&nacl_arch=x64' +
      `&prod=chrome&prodchannel=stable&prodversion=${chromeVersion}&lang=en` +
      '&acceptformat=crx3' +
      `&x=id%3D${id}%26uc`;
    return new Promise((resolve, reject) => {
      const get = (u, redirects) => {
        if (redirects > 5) return reject(new Error(mt(lang, 'main.tooManyRedirects')));
        https
          .get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              get(res.headers.location, redirects + 1);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(mt(lang, 'main.downloadFailed', { status: res.statusCode })));
              return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          })
          .on('error', reject);
      };
      get(url, 0);
    });
  }

  function crxToZip(buf) {
    const lang = getData().settings.language || 'es';
    if (buf.toString('utf8', 0, 4) !== 'Cr24') throw new Error(mt(lang, 'main.invalidCrxFile'));
    const version = buf.readUInt32LE(4);
    let offset;
    if (version === 2) {
      const pubKeyLen = buf.readUInt32LE(8);
      const sigLen = buf.readUInt32LE(12);
      offset = 16 + pubKeyLen + sigLen;
    } else if (version === 3) {
      const headerLen = buf.readUInt32LE(8);
      offset = 12 + headerLen;
    } else {
      throw new Error(mt(lang, 'main.unsupportedCrxVersion'));
    }
    return buf.subarray(offset);
  }

  async function loadExtensionOnAllSessions(dir) {
    let result = null;
    for (const view of views.values()) {
      try {
        result = await view.session.extensions.loadExtension(dir);
      } catch {
        // session may already have it loaded, or view may be closing — ignore
      }
    }
    return result;
  }

  // `id` here is only a GUESS at what Electron will assign — the Chrome Web
  // Store ID for a downloaded CRX (crxToZip strips the original signature/
  // key, so Electron can't recompute the store's canonical ID from the
  // unpacked folder) or a locally-replicated path hash for a manually loaded
  // unpacked folder. Confirmed live: installing AdGuard Adblocker from the
  // store, the guessed id (bgnkhhnn...) never matched what session.
  // extensions.loadExtension() actually assigned (cbmeffkc...) — every
  // chrome-extension:// URL built from the guessed id then hit
  // ERR_BLOCKED_BY_CLIENT, leaving the popup permanently blank. loaded.id
  // (what Electron/Chromium itself decided, the only id any
  // chrome-extension:// URL or session lookup can ever match) is now the
  // source of truth; the guess is only a fallback for the rare case
  // loadExtension() failed on every session.
  async function finishInstall(id, dir) {
    const data = getData();
    const manifest = readManifest(dir);
    const loaded = await loadExtensionOnAllSessions(dir);
    const realId = loaded?.id || id;
    const entry = {
      id: realId,
      path: dir,
      name: loaded?.name || manifest.name || id,
      version: loaded?.version || manifest.version || '',
      description: manifest.description || '',
      action: extractExtensionAction(manifest, dir),
      enabled: true
    };
    data.settings.extensions.push(entry);
    persist();
    broadcastState();
    return entry;
  }

  async function installExtensionFromStore(input) {
    const data = getData();
    const lang = data.settings.language || 'es';
    const id = extensionIdFromInput(input);
    if (!id) throw new Error(mt(lang, 'main.noValidExtensionId'));
    // Checked by destination folder, not by e.id — finishInstall now stores
    // whatever id Electron actually assigns on load (see its comment), which
    // for a downloaded CRX never matches this store id, so comparing against
    // e.id here would never catch a real duplicate. destDir is deterministic
    // from the store id regardless, so it's still a reliable "already
    // downloaded this one" check.
    const destDir = path.join(EXTENSIONS_DIR, id);
    if (data.settings.extensions.some((e) => e.path === destDir)) throw new Error(mt(lang, 'main.extensionAlreadyInstalled'));

    const crxBuf = await downloadCrx(id);
    const zipBuf = crxToZip(crxBuf);
    const zipPath = path.join(app.getPath('temp'), `${id}-${Date.now()}.zip`);
    fs.writeFileSync(zipPath, zipBuf);

    try {
      await preValidateZipEntries(zipPath, destDir);
    } catch (err) {
      fs.unlinkSync(zipPath);
      throw err;
    }

    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    await extractZip(zipPath, { dir: destDir });
    fs.unlinkSync(zipPath);

    try {
      assertNoEscapedEntries(destDir);
    } catch (err) {
      fs.rmSync(destDir, { recursive: true, force: true });
      throw err;
    }

    return finishInstall(id, destDir);
  }

  function closeExtensionPopup(id) {
    const popup = extensionPopupWindows.get(id);
    if (popup && !popup.isDestroyed()) popup.close();
    extensionPopupWindows.delete(id);
  }

  function unloadExtensionFromAllSessions(id) {
    for (const view of views.values()) {
      try {
        view.session.extensions.removeExtension(id);
      } catch {
        // not loaded on this session — ignore
      }
    }
  }

  function registerIpcHandlers() {
    ipcMain.handle('extensions:installFromStore', async (_e, { input }) => {
      try {
        await installExtensionFromStore(input);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    ipcMain.handle('extensions:loadUnpacked', async () => {
      const data = getData();
      const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return { ok: false };
      const dir = result.filePaths[0];
      const manifest = readManifest(dir);
      if (!manifest.manifest_version) return { ok: false, error: 'La carpeta no contiene un manifest.json válido.' };
      const id = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 32).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
      if (data.settings.extensions.some((e) => e.path === dir)) return { ok: false, error: mt(data.settings.language || 'es', 'main.folderAlreadyLoaded') };
      try {
        await finishInstall(id, dir);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    // Opens (or, if already open, closes) an extension's toolbar popup —
    // chrome-extension://<id>/<popup> only resolves inside a session that
    // actually has that extension loaded, so this reuses the currently
    // active account's session (falling back to any open account) rather
    // than a dedicated session, matching where the extension is actually
    // running.
    ipcMain.handle('extensions:openPopup', (_e, { id }) => {
      const data = getData();
      const ext = data.settings.extensions.find((e) => e.id === id);
      if (!ext) return { ok: false, error: 'Extensión no encontrada' };
      if (!ext.action || !ext.action.popup) {
        return { ok: false, error: 'Esta extensión no tiene una ventana propia — funciona en segundo plano.' };
      }

      const existing = extensionPopupWindows.get(id);
      if (existing && !existing.isDestroyed()) {
        existing.close();
        extensionPopupWindows.delete(id);
        return { ok: true, closed: true };
      }

      const activeId = data.settings.activeAccountId;
      let wc = activeId ? views.get(activeId) : null;
      if (!wc || wc.isDestroyed()) {
        wc = [...views.values()].find((v) => !v.isDestroyed());
      }
      if (!wc) return { ok: false, error: 'Abrí al menos una cuenta primero.' };

      const popup = createAnchoredPopup(getMainWindow, {
        width: 380,
        height: 560,
        anchor: 'top-right',
        windowOptions: {
          backgroundColor: '#ffffff',
          title: ext.action.title || ext.name,
          webPreferences: { session: wc.session }
        }
      });
      extensionPopupWindows.set(id, popup);
      popup.on('closed', () => extensionPopupWindows.delete(id));
      // Auto-dismiss on blur, same as a real browser's extension popup —
      // otherwise it'd be a floating window the user has to remember to close.
      popup.on('blur', () => {
        if (!popup.isDestroyed()) popup.close();
      });
      popup.loadURL(`chrome-extension://${id}/${ext.action.popup}`);
      return { ok: true };
    });

    ipcMain.handle('extensions:toggle', (_e, { id, enabled }) => {
      const data = getData();
      const ext = data.settings.extensions.find((e) => e.id === id);
      if (!ext) return data;
      ext.enabled = enabled;
      if (enabled) {
        for (const view of views.values()) {
          view.session.extensions
            .loadExtension(ext.path)
            .catch((err) => console.error('[ext] FAILED to re-enable', ext.name, err));
        }
      } else {
        unloadExtensionFromAllSessions(id);
        closeExtensionPopup(id);
      }
      persist();
      broadcastState();
      return data;
    });

    ipcMain.handle('extensions:remove', (_e, { id }) => {
      const data = getData();
      const ext = data.settings.extensions.find((e) => e.id === id);
      if (!ext) return data;
      unloadExtensionFromAllSessions(id);
      closeExtensionPopup(id);
      try {
        if (ext.path.startsWith(EXTENSIONS_DIR)) fs.rmSync(ext.path, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      data.settings.extensions = data.settings.extensions.filter((e) => e.id !== id);
      persist();
      broadcastState();
      return data;
    });
  }

  return {
    loadExtensionOnAllSessions,
    unloadExtensionFromAllSessions,
    closeExtensionPopup,
    readManifest,
    extractExtensionAction,
    finishInstall,
    registerIpcHandlers
  };
}

module.exports = { createExtensionsManager, EXTENSIONS_DIR };
