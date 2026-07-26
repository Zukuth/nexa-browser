const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const store = require('./store');
const { autoUpdater } = require('electron-updater');
const { GAP, GRID_MAX_PANELS, MIN_SPLIT_FRAC, resolveFracs, cellsForMode, freeCells, normalizeFracsWithMin } = require('./layout-utils');
const gameTelemetry = require('./game-telemetry');

// Last-resort net: an ipcMain.on (not .handle) listener that throws crashes the
// whole app with no trace, since Electron only auto-catches .handle rejections.
// This doesn't replace validating payloads at each handler — it's a backstop
// for whatever the per-handler guards miss, so a bad message loudly logs
// instead of silently killing every open account at once.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// app.getPath('userData') is derived from package.json's "name" field — keep that
// field as "chilean-browser" even after rebranding, or existing spaces/accounts/
// passwords/extensions become invisible to the app (new empty folder, old one orphaned).
const EXTENSIONS_DIR = path.join(app.getPath('userData'), 'extensions');
if (!fs.existsSync(EXTENSIONS_DIR)) fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

// Ad/tracker blocker — starts blocking immediately with this curated list of the
// most common ad/analytics/tracking domains, then gets replaced in the background
// by the much larger community-maintained StevenBlack hosts list (cached to disk,
// refreshed at most once a day) once it's fetched.
const BUILTIN_BLOCKLIST = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com',
  'facebook.com/tr', 'connect.facebook.net', 'ads-twitter.com', 'analytics.twitter.com',
  'amazon-adsystem.com', 'adnxs.com', 'adsrvr.org', 'adroll.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'media.net',
  'moatads.com', 'scorecardresearch.com', 'quantserve.com', 'quantcast.com', 'hotjar.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'fullstory.com', 'mouseflow.com', 'crazyegg.com',
  'yandex.ru/metrica', 'mc.yandex.ru', 'bat.bing.com', 'ads.yahoo.com', 'advertising.com',
  'adcolony.com', 'applovin.com', 'chartboost.com', 'unityads.unity3d.com', 'vungle.com',
  'ironsrc.com', 'inmobi.com', 'smartadserver.com', 'adform.net', 'flashtalking.com',
  'bidswitch.net', 'casalemedia.com', 'contextweb.com', 'sharethrough.com', 'triplelift.com',
  'yieldmo.com', 'indexexchange.com', 'sovrn.com', 'gumgum.com', 'teads.tv', 'spotxchange.com',
  'tremorhub.com', 'undertone.com', 'zedo.com', 'adtechus.com', 'exelator.com', 'demdex.net',
  'krxd.net', 'bluekai.com', 'rlcdn.com', 'agkn.com', 'adsymptotic.com', 'mathtag.com',
  'turn.com', 'rfihub.com', 'simpli.fi', 'tapad.com', 'chango.com', 'brightroll.com',
  'yieldlab.net', 'improvedigital.com', 'smartclip.net', 'adtelligent.com', 'sonobi.com',
  '33across.com', 'lijit.com', 'rhythmone.com', 'freewheel.tv', 'innovid.com',
  'newrelic.com', 'nr-data.net', 'bugsnag.com', 'sentry.io', 'amplitude.com',
  'clicktale.net', 'clarity.ms', 'histats.com', 'statcounter.com', 'analytics.google.com'
];

const BLOCKLIST_CACHE_FILE = path.join(app.getPath('userData'), 'blocklist-cache.txt');
const BLOCKLIST_URL = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
let blockedDomains = new Set(BUILTIN_BLOCKLIST);
const blockedCounts = new Map();
const crashCounts = new Map();
let lastFocusedAccountId = null;

// Real password values never live on `data.passwords` — only id/name/url/
// username do. `data` is what state:get/state:update hand the renderer
// wholesale on every change (and what dozens of IPC handlers return as-is),
// so keeping the secret there meant every open account/space/etc. change
// re-sent the full plaintext password list to the renderer's memory. The
// actual secret lives here, keyed by password entry id, and is only ever
// handed out by the two channels that legitimately need it: autofill:query
// (scoped to the requesting page's own origin) and passwords:list (fetched
// on demand when the user opens Configuración → Contraseñas, not on every
// broadcast).
const passwordSecrets = new Map();

function parseHostsFile(text, into) {
  const re = /^\s*0\.0\.0\.0\s+(\S+)/gm;
  let m;
  while ((m = re.exec(text))) {
    const host = m[1].toLowerCase();
    if (host !== 'localhost' && host !== '0.0.0.0') into.add(host);
  }
}

// Async and called after the first window is up (see app.whenReady() below) —
// this used to be a synchronous fs.readFileSync() called before createWindow(),
// which blocked the very first paint on however long it took to read+parse a
// StevenBlack cache file that can run into the hundreds of KB. Adblock isn't
// needed until a page actually loads in some account view, well after the
// window itself has appeared, so there's no reason to make startup wait on it.
async function loadCachedBlocklist() {
  try {
    const raw = await fs.promises.readFile(BLOCKLIST_CACHE_FILE, 'utf-8');
    parseHostsFile(raw, blockedDomains);
    console.log('[adblock] loaded cached list —', blockedDomains.size, 'domains');
  } catch {
    console.log('[adblock] no cache yet — using built-in list of', blockedDomains.size, 'domains');
  }
}

function refreshBlocklistIfStale() {
  let stale = true;
  try {
    const stat = fs.statSync(BLOCKLIST_CACHE_FILE);
    stale = Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000;
  } catch {
    // no cache file yet — definitely stale
  }
  if (!stale) return;

  https
    .get(BLOCKLIST_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        try {
          fs.writeFileSync(BLOCKLIST_CACHE_FILE, text, 'utf-8');
        } catch {
          // best-effort cache write
        }
        const fresh = new Set(BUILTIN_BLOCKLIST);
        parseHostsFile(text, fresh);
        blockedDomains = fresh;
        console.log('[adblock] refreshed list —', blockedDomains.size, 'domains');
      });
    })
    .on('error', () => {
      // offline or blocked — keep using the built-in/cached list
    });
}

function isBlockedHost(hostname) {
  if (!hostname) return false;
  let h = hostname.toLowerCase();
  while (h.includes('.')) {
    if (blockedDomains.has(h)) return true;
    h = h.slice(h.indexOf('.') + 1);
  }
  return false;
}

function applyAdBlock(ses, accountId) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (data.settings.adBlockEnabled === false || details.resourceType === 'mainFrame') {
      callback({});
      return;
    }
    let hostname;
    try {
      hostname = new URL(details.url).hostname;
    } catch {
      callback({});
      return;
    }
    if (isBlockedHost(hostname)) {
      blockedCounts.set(accountId, (blockedCounts.get(accountId) || 0) + 1);
      callback({ cancel: true });
    } else {
      callback({});
    }
  });
}

// Without an explicit handler Electron denies most permission requests outright,
// which silently breaks sites that need a camera/mic (video calls), notifications,
// or geolocation. These are all things a site only asks for when the page itself
// wants to use them, so allowing the common/expected set matches normal browser
// behavior instead of a blanket silent denial.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'geolocation',
  'fullscreen',
  'pointerLock',
  'midi',
  'midiSysex',
  'clipboard-sanitized-write',
  'openExternal'
]);

function applyPermissionHandler(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

const proxyAuthWired = new WeakSet();

function applyProxy(ses, account) {
  if (!proxyAuthWired.has(ses)) {
    proxyAuthWired.add(ses);
    ses.on('login', (event, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return; // leave the site's own HTTP auth prompt alone
      event.preventDefault();
      if (account.proxy && account.proxy.username) {
        callback(account.proxy.username, account.proxy.password || '');
      } else {
        callback();
      }
    });
  }
  if (!account.proxy || !account.proxy.server) {
    ses.setProxy({ mode: 'direct' }).catch((err) => console.error('[proxy] failed to clear for', account.id, err));
    return;
  }
  ses.setProxy({ proxyRules: account.proxy.server }).catch((err) => console.error('[proxy] failed to set for', account.id, err));
}

// A standard desktop Chrome UA — without this, Electron's default UA includes
// "Electron/x.x.x", which some sites detect and block or serve a broken page for.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const RAIL_WIDTH = 56;
const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 64;
const TOPBAR_HEIGHT = 44;
const STATUSBAR_HEIGHT = 26;
const PANEL_HEADER_HEIGHT = 30;
// GAP, GRID_MAX_PANELS, MIN_SPLIT_FRAC, resolveFracs, cellsForMode, freeCells
// and normalizeFracsWithMin now live in ./layout-utils (required above) so
// they can be unit-tested without launching the app — see test/unit/.

let mainWindow = null;
let data = store.load();

// Always start on auto grid, regardless of whichever layout was active when the
// app was last closed — the user wants a consistent, predictable starting layout.
data.settings.layoutMode = 'grid';

// Must run before app.whenReady() — can't be toggled live, only at the next launch.
if (data.settings.hardwareAcceleration === false) {
  app.disableHardwareAcceleration();
}

// Vanilla Electron doesn't ship Widevine (it's Google-licensed DRM, not something
// an open-source build can bundle) — this borrows the CDM binary that a real,
// already-licensed Chrome or Edge install has on disk, so DRM sites (Netflix,
// Spotify Web Player, etc.) can actually play. Best-effort: if no compatible
// install is found, or the version drifts too far from our own Chromium, it just
// silently isn't available rather than breaking anything.
// Windows installs keep each version in its own versioned subfolder
// (Application\131.0.6778.86\WidevineCdm\...); Linux .deb/.rpm installs of
// Chrome/Chromium/Edge instead keep a single current WidevineCdm dir straight
// under the install root, no version subfolder — so the two OSes need
// different traversal, not just different root paths.
function findWidevineCdm() {
  if (process.platform === 'win32') {
    const roots = [
      'C:\\Program Files\\Google\\Chrome\\Application',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application',
      'C:\\Program Files\\Microsoft\\Edge\\Application',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application'
    ];
    let best = null;
    for (const root of roots) {
      let versions;
      try {
        versions = fs.readdirSync(root).filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v));
      } catch {
        continue;
      }
      for (const v of versions) {
        const dllPath = path.join(root, v, 'WidevineCdm', '_platform_specific', 'win_x64', 'widevinecdm.dll');
        const manifestPath = path.join(root, v, 'WidevineCdm', 'manifest.json');
        try {
          if (!fs.existsSync(dllPath)) continue;
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (!best || manifest.version > best.version) {
            best = { dllPath, version: manifest.version, source: root.includes('Edge') ? 'Edge' : 'Chrome', browserVersion: v };
          }
        } catch {
          // unreadable manifest or missing files — skip this candidate
        }
      }
    }
    return best;
  }

  if (process.platform === 'linux') {
    const roots = [
      { dir: '/opt/google/chrome/WidevineCdm', source: 'Chrome' },
      { dir: '/opt/microsoft/msedge/WidevineCdm', source: 'Edge' },
      { dir: '/usr/lib/chromium/WidevineCdm', source: 'Chromium' },
      { dir: '/usr/lib/chromium-browser/WidevineCdm', source: 'Chromium' }
    ];
    for (const { dir, source } of roots) {
      const dllPath = path.join(dir, '_platform_specific', 'linux_x64', 'libwidevinecdm.so');
      const manifestPath = path.join(dir, 'manifest.json');
      try {
        if (!fs.existsSync(dllPath)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        return { dllPath, version: manifest.version, source, browserVersion: '' };
      } catch {
        // unreadable manifest or missing files — try the next candidate
      }
    }
    return null;
  }

  return null; // macOS: not a target platform for this app right now
}

const widevineCdm = findWidevineCdm();
if (widevineCdm) {
  app.commandLine.appendSwitch('widevine-cdm-path', widevineCdm.dllPath);
  app.commandLine.appendSwitch('widevine-cdm-version', widevineCdm.version);
  console.log(
    '[widevine] using CDM from',
    widevineCdm.source,
    widevineCdm.browserVersion || '',
    '— CDM v' + widevineCdm.version
  );
} else {
  console.log('[widevine] no compatible CDM found (checked local Chrome/Edge installs) — DRM playback will not work');
}

const appStartTime = Date.now();
const APP_VERSION = '0.1.2';

// Reset "online since" timers for accounts that aren't closed — elapsed time is per app session.
data.accounts.forEach((a) => {
  if (!a.closed) a.openedAt = Date.now();
});

/** @type {Map<string, WebContentsView>} */
const views = new Map();
const poppedOutIds = new Set();
const poppedOutWindows = new Map();

// Debounced: SPA sites fire did-navigate-in-page (pushState/hash routing) and
// page-title-updated many times a minute, and persist() used to do a synchronous
// full-state disk write on every single one, on the same thread that composites
// every window — a real source of stalls with several accounts open. In-memory
// `data` is always updated immediately by the caller before persist() runs, so
// delaying the disk write doesn't affect anything visible; it only widens the
// crash-durability window from "instant" to "at most PERSIST_DEBOUNCE_MS old",
// which flushPersist() (called on quit) closes for the normal-exit case anyway.
const PERSIST_DEBOUNCE_MS = 400;
let persistTimer = null;
let persistDirty = false;

// store.js's save() still expects each password entry to carry its real
// `password` field (it's the one that encrypts it before writing to disk) —
// this merges passwordSecrets back in for the copy that actually gets
// written, without ever putting the secret back onto the live `data` object.
function dataForPersist() {
  return {
    ...data,
    passwords: data.passwords.map((p) => ({ ...p, password: passwordSecrets.get(p.id) || '' }))
  };
}

function persist() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) {
      persistDirty = false;
      store.save(dataForPersist());
    }
  }, PERSIST_DEBOUNCE_MS);
}

function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistDirty) {
    persistDirty = false;
    store.save(dataForPersist());
  }
}

function getAccount(id) {
  return data.accounts.find((a) => a.id === id);
}

function getSpace(id) {
  return data.spaces.find((s) => s.id === id);
}

function getCurrentSpace() {
  return getSpace(data.settings.currentSpaceId) || data.spaces[0];
}

function accountsInCurrentSpace() {
  const spaceId = getCurrentSpace()?.id;
  return data.accounts.filter((a) => a.spaceId === spaceId);
}

function openAccountsInCurrentSpace() {
  return accountsInCurrentSpace().filter((a) => !a.closed);
}

function displayName(account) {
  if (account.name) return account.name;
  const siblings = data.accounts.filter((a) => a.spaceId === account.spaceId);
  const position = siblings.indexOf(account);
  return `Pestaña ${position + 1}`;
}

function handleDownloads(ses) {
  ses.on('will-download', (event, item) => {
    let savePath = null;
    if (data.settings.askDownloadLocation) {
      const chosen = dialog.showSaveDialogSync(mainWindow, { defaultPath: item.getFilename() });
      if (!chosen) {
        event.preventDefault();
        return;
      }
      item.setSavePath(chosen);
      savePath = chosen;
    } else if (data.settings.downloadsFolder) {
      savePath = path.join(data.settings.downloadsFolder, item.getFilename());
      item.setSavePath(savePath);
    }

    const record = {
      id: crypto.randomUUID(),
      filename: item.getFilename(),
      url: item.getURL(),
      path: savePath,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startedAt: Date.now()
    };
    data.downloads.unshift(record);
    if (data.downloads.length > 200) data.downloads.length = 200;
    persist();
    broadcastState();

    let lastBroadcast = 0;
    item.on('updated', (_e, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.state = state;
      const now = Date.now();
      if (now - lastBroadcast > 400) {
        lastBroadcast = now;
        broadcastState();
      }
    });

    item.on('done', (_e, state) => {
      record.state = state;
      record.path = item.getSavePath() || record.path;
      record.receivedBytes = item.getReceivedBytes();
      persist();
      broadcastState();
    });
  });
}

function extensionIdFromInput(input) {
  const match = String(input).trim().match(/[a-p]{32}/);
  return match ? match[0] : null;
}

function downloadCrx(id) {
  const url =
    'https://clients2.google.com/service/update2/crx?response=redirect' +
    '&os=win&arch=x64&os_arch=x64&nacl_arch=x64' +
    '&prod=chrome&prodchannel=stable&prodversion=131.0.6778.86&lang=en' +
    '&acceptformat=crx3' +
    `&x=id%3D${id}%26uc`;
  return new Promise((resolve, reject) => {
    const get = (u, redirects) => {
      if (redirects > 5) return reject(new Error('Demasiadas redirecciones'));
      https
        .get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            get(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Descarga falló (HTTP ${res.statusCode})`));
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
  if (buf.toString('utf8', 0, 4) !== 'Cr24') throw new Error('Archivo CRX inválido');
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
    throw new Error('Versión de CRX no soportada');
  }
  return buf.subarray(offset);
}

async function loadExtensionOnAllSessions(dir) {
  let result = null;
  for (const view of views.values()) {
    try {
      result = await view.webContents.session.extensions.loadExtension(dir, { allowFileAccess: true });
    } catch {
      // session may already have it loaded, or view may be closing — ignore
    }
  }
  return result;
}

function readManifest(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function installExtensionFromStore(input) {
  const id = extensionIdFromInput(input);
  if (!id) throw new Error('No se pudo reconocer un ID de extensión válido en ese texto.');
  if (data.settings.extensions.some((e) => e.id === id)) throw new Error('Esa extensión ya está instalada.');

  const crxBuf = await downloadCrx(id);
  const zipBuf = crxToZip(crxBuf);
  const zipPath = path.join(app.getPath('temp'), `${id}-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, zipBuf);

  const destDir = path.join(EXTENSIONS_DIR, id);
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  await extractZip(zipPath, { dir: destDir });
  fs.unlinkSync(zipPath);

  return finishInstall(id, destDir);
}

async function finishInstall(id, dir) {
  const manifest = readManifest(dir);
  const loaded = await loadExtensionOnAllSessions(dir);
  const entry = {
    id,
    path: dir,
    name: loaded?.name || manifest.name || id,
    version: loaded?.version || manifest.version || '',
    description: manifest.description || '',
    enabled: true
  };
  data.settings.extensions.push(entry);
  persist();
  broadcastState();
  return entry;
}

// Extensions a fresh profile should have without the user having to find and
// paste in the Chrome Web Store ID manually. IMPORTANT: this fetches the real
// CRX from Google's official update servers each time (same code path as
// Configuración → Extensiones → Agregar) — it must NOT bundle or copy a local
// modified copy of a third-party extension into the app package. IV Helper's
// own LICENSE.txt is explicit: "uso é permitido exclusivamente na forma da
// extensão oficial publicada pelo autor na Chrome Web Store" (redistribution,
// modification and derivative works are all expressly prohibited) — shipping
// a bundled/edited copy inside our installer would violate that.
const DEFAULT_EXTENSION_IDS = ['cpapjpndggpeepabijbaikmapdceldnl']; // IV Helper (Poke IdleWorld)

// Runs once per id ever: seededExtensions (persisted, separate from the live
// settings.extensions list) is checked so a user who later removes the
// extension doesn't have it silently reinstalled on the next launch.
async function seedDefaultExtensions() {
  const alreadyInstalled = new Set(data.settings.extensions.map((e) => e.id));
  const alreadySeeded = new Set(data.seededExtensions || []);
  let changed = false;
  for (const id of DEFAULT_EXTENSION_IDS) {
    if (alreadySeeded.has(id)) continue;
    data.seededExtensions = [...(data.seededExtensions || []), id];
    changed = true;
    if (alreadyInstalled.has(id)) continue;
    try {
      await installExtensionFromStore(id);
    } catch (err) {
      console.error('[ext] failed to seed default extension', id, err);
    }
  }
  if (changed) persist();
}

function unloadExtensionFromAllSessions(id) {
  for (const view of views.values()) {
    try {
      view.webContents.session.extensions.removeExtension(id);
    } catch {
      // not loaded on this session — ignore
    }
  }
}

const SPACE_COLORS = ['#4f8cff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#f06595', '#22b8cf'];
const SPACE_ICON_KEYS = ['grid', 'gamepad', 'swords', 'shield', 'flame', 'leaf', 'droplet', 'bolt', 'star', 'crown', 'ghost', 'rocket'];

const SHORTCUTS = [
  { combo: 'Ctrl + 1–9', label: 'Seleccionar panel 1–9' },
  { combo: 'Ctrl + Tab', label: 'Siguiente panel' },
  { combo: 'Ctrl + Shift + N', label: 'Nuevo espacio' },
  { combo: 'Ctrl + N', label: 'Nueva cuenta' },
  { combo: 'Ctrl + R', label: 'Recargar panel activo' },
  { combo: 'Ctrl + Shift + R', label: 'Recargar ignorando caché' },
  { combo: 'Ctrl + Alt + R', label: 'Recargar todo' },
  { combo: 'Ctrl + M', label: 'Silenciar panel activo' },
  { combo: 'Ctrl + Shift + M', label: 'Silenciar todo' },
  { combo: 'Ctrl + L', label: 'Enfocar barra de direcciones' },
  { combo: 'Ctrl + F', label: 'Buscar en la página' },
  { combo: 'Ctrl + / Ctrl -', label: 'Zoom + / -' },
  { combo: 'Ctrl + 0', label: 'Restablecer zoom' },
  { combo: 'F11', label: 'Pantalla completa' },
  { combo: 'Ctrl + ,', label: 'Configuración' },
  { combo: 'Ctrl + W', label: 'Cerrar cuenta activa' },
  { combo: 'Ctrl + Shift + T', label: 'Reabrir última cuenta cerrada' },
  { combo: 'Ctrl + B', label: 'Colapsar/expandir barra lateral' },
  { combo: 'Ctrl + D', label: 'Guardar página actual en favoritos' },
  { combo: 'Ctrl + Shift + Supr', label: 'Borrar datos de sesión de la cuenta activa' }
];

let lastClosedAccountId = null;

function quickAddAccount() {
  const space = getCurrentSpace();
  const account = {
    id: crypto.randomUUID(),
    name: null,
    url: space?.defaultUrl || data.settings.defaultStartUrl || 'about:blank',
    spaceId: space?.id || 'default',
    color: null,
    openedAt: Date.now()
  };
  data.accounts.push(account);
  data.settings.activeAccountId = account.id;
  data.settings.layoutMode = 'single';
  persist();
  renderLayout();
  broadcastState();
}

function createRandomSpace() {
  const color = SPACE_COLORS[Math.floor(Math.random() * SPACE_COLORS.length)];
  const icon = SPACE_ICON_KEYS[Math.floor(Math.random() * SPACE_ICON_KEYS.length)];
  const space = {
    id: crypto.randomUUID(),
    name: `Espacio ${data.spaces.length + 1}`,
    color,
    icon,
    defaultUrl: data.settings.defaultStartUrl || 'https://www.google.com',
    defaultLayout: data.settings.newSpaceDefaultLayout || 'single'
  };
  data.spaces.push(space);
  data.settings.currentSpaceId = space.id;
  data.settings.layoutMode = space.defaultLayout;
  data.settings.activeAccountId = null;
  data.settings.maximizedAccountId = null;
  persist();
  renderLayout();
  broadcastState();
}

function reopenLastClosedAccount() {
  const account = getAccount(lastClosedAccountId);
  if (!account || !account.closed) return;
  account.closed = false;
  account.openedAt = Date.now();
  data.settings.activeAccountId = account.id;
  persist();
  renderLayout();
  broadcastState();
}

function adjustZoom(id, delta) {
  const account = getAccount(id);
  if (!account) return;
  const current = account.zoom || data.settings.defaultZoom || 1;
  const next = Math.max(0.5, Math.min(2, Math.round((current + delta) * 100) / 100));
  account.zoom = next;
  const view = views.get(id);
  if (view) view.webContents.setZoomFactor(next);
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

function setZoomDirect(id, factor) {
  const account = getAccount(id);
  if (!account) return;
  account.zoom = factor;
  const view = views.get(id);
  if (view) view.webContents.setZoomFactor(factor);
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

function toggleMuteAccount(id) {
  const account = getAccount(id);
  if (!account) return;
  account.muted = !account.muted;
  views.get(id)?.webContents.setAudioMuted(account.muted);
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

function toggleMuteAllAccounts() {
  const muted = !data.settings.allMuted;
  data.accounts.forEach((a) => {
    a.muted = muted;
  });
  for (const view of views.values()) view.webContents.setAudioMuted(muted);
  data.settings.allMuted = muted;
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

// Handles shortcuts while focus is inside an account's page (a WebContentsView
// intercepts keyboard input independently from the renderer chrome, so this needs
// its own dispatcher rather than relying on the renderer's keydown listener).
function handleAccountShortcut(input, account) {
  if (input.type !== 'keyDown') return false;
  const ctrl = input.control;
  const shift = input.shift;
  const alt = input.alt;
  const key = input.key.toLowerCase();
  const view = views.get(account.id);

  if (ctrl && !shift && !alt && key === 'f') {
    if (mainWindow) mainWindow.webContents.send('findbar:open', { id: account.id });
    return true;
  }
  if (key === 'escape') {
    view?.webContents.stopFindInPage('clearSelection');
    if (mainWindow) mainWindow.webContents.send('findbar:close', { id: account.id });
    return false; // let Escape still propagate normally for anything else on the page
  }
  if (ctrl && !shift && !alt && /^[1-9]$/.test(key)) {
    if (mainWindow) mainWindow.webContents.send('shortcut:selectPanel', { n: Number(key) });
    return true;
  }
  if (ctrl && !shift && !alt && key === 'tab') {
    if (mainWindow) mainWindow.webContents.send('shortcut:nextPanel');
    return true;
  }
  if (ctrl && shift && !alt && key === 'n') {
    createRandomSpace();
    return true;
  }
  if (ctrl && !shift && !alt && key === 'n') {
    quickAddAccount();
    return true;
  }
  if (ctrl && shift && !alt && key === 'r') {
    view?.webContents.reloadIgnoringCache();
    return true;
  }
  if (ctrl && !shift && alt && key === 'r') {
    openAccountsInCurrentSpace().forEach((a) => views.get(a.id)?.webContents.reload());
    return true;
  }
  if (ctrl && !shift && !alt && key === 'r') {
    view?.webContents.reload();
    return true;
  }
  if (ctrl && shift && !alt && key === 'm') {
    toggleMuteAllAccounts();
    return true;
  }
  if (ctrl && !shift && !alt && key === 'm') {
    toggleMuteAccount(account.id);
    return true;
  }
  if (ctrl && !shift && !alt && key === 'l') {
    if (mainWindow) mainWindow.webContents.send('shortcut:focusAddress');
    return true;
  }
  if (ctrl && !shift && !alt && (key === '=' || key === '+')) {
    adjustZoom(account.id, 0.1);
    return true;
  }
  if (ctrl && !shift && !alt && key === '-') {
    adjustZoom(account.id, -0.1);
    return true;
  }
  if (ctrl && !shift && !alt && key === '0') {
    setZoomDirect(account.id, 1);
    return true;
  }
  if (key === 'f11') {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return true;
  }
  if (ctrl && !shift && !alt && key === ',') {
    if (mainWindow) mainWindow.webContents.send('shortcut:openSettings');
    return true;
  }
  if (ctrl && !shift && !alt && key === 'w') {
    closeAccountView(account).then((closed) => {
      if (!closed) return;
      if (data.settings.activeAccountId === account.id) {
        data.settings.activeAccountId = openAccountsInCurrentSpace()[0]?.id || null;
      }
      persist();
      renderLayout();
      broadcastState();
    });
    return true;
  }
  if (ctrl && shift && !alt && key === 't') {
    reopenLastClosedAccount();
    return true;
  }
  if (ctrl && !shift && !alt && key === 'b') {
    data.settings.sidebarCollapsed = !data.settings.sidebarCollapsed;
    persist();
    renderLayout();
    broadcastState();
    return true;
  }
  if (ctrl && !shift && !alt && key === 'd') {
    if (account.url && account.url !== 'about:blank') {
      data.bookmarks.push({ id: crypto.randomUUID(), title: displayName(account), url: account.url });
      persist();
      broadcastState();
    }
    return true;
  }
  if (ctrl && shift && !alt && key === 'delete') {
    const ses = view ? view.webContents.session : session.fromPartition(`persist:account-${account.id}`);
    ses.clearStorageData()
      .then(() => ses.clearCache())
      .then(() => view?.webContents.reload());
    return true;
  }
  return false;
}

function createViewForAccount(account) {
  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:account-${account.id}`,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      plugins: true,
      additionalArguments: [`--account-id=${account.id}`],
      preload: path.join(__dirname, 'account-preload.js')
    }
  });
  view.webContents.setUserAgent(CHROME_UA);
  view.webContents.session.setSpellCheckerLanguages(['es-419', 'en-US']);
  view.webContents.setZoomFactor(account.zoom || data.settings.defaultZoom || 1);
  // Popups (e.g. a Google login window opened via window.open) get the same
  // isolated session and autofill preload as their opener.
  view.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      webPreferences: {
        partition: `persist:account-${account.id}`,
        contextIsolation: true,
        sandbox: true,
        spellcheck: true,
        plugins: true,
        additionalArguments: [`--account-id=${account.id}`],
        preload: path.join(__dirname, 'account-preload.js')
      }
    }
  }));
  view.webContents.on('did-create-window', (win) => {
    win.webContents.setUserAgent(CHROME_UA);
  });
  handleDownloads(view.webContents.session);
  applyAdBlock(view.webContents.session, account.id);
  applyPermissionHandler(view.webContents.session);
  applyProxy(view.webContents.session, account);
  data.settings.extensions
    .filter((e) => e.enabled !== false)
    .forEach((e) => {
      view.webContents.session.extensions
        .loadExtension(e.path, { allowFileAccess: true })
        .then(() => console.log('[ext] loaded', e.name, 'into', account.id))
        .catch((err) => console.error('[ext] FAILED to load', e.name, 'into', account.id, err));
    });
  // Must attach before the first loadURL — CDP's Network.enable needs to be
  // on before the game's own page connects its WebSocket, or the connection
  // (and the frames that arrive right after it) is missed entirely. Only
  // ever attaches for accounts already pointed at the game, per the
  // telemetry feature's scoping rule (main.js never runs this for a random
  // account someone happens to point elsewhere).
  if (account.url && gameTelemetry.isGameUrl(account.url)) {
    gameTelemetry.attachCapture(view, account.id);
  }
  if (account.url && account.url !== 'about:blank') {
    view.webContents.loadURL(account.url);
  }
  view.webContents.on('did-navigate', (_e, url) => notifyNav(account.id, url));
  view.webContents.on('did-navigate-in-page', (_e, url) => {
    notifyNav(account.id, url);
    // poke.idleworld.online routes from /login to /play client-side (History
    // API, no full reload) after a successful sign-in, so did-finish-load
    // below never fires again for that transition and the overlay buttons
    // used to never appear until the next full reload. injectGameOverlayButtons
    // already no-ops off the URL check and off window.__cbOverlayWatchdog
    // already existing, so calling it here too is safe and idempotent.
    injectGameOverlayButtons(view.webContents);
    stopGameOverlayWatchdogIfLeft(view.webContents, url);
  });
  // Chromium resets zoom on full page loads/reloads — reassert the account's
  // chosen zoom (or the app default) so it survives reload/repartition and
  // only ever changes via the user picking a new one or closing the tab.
  view.webContents.on('did-finish-load', () => {
    view.webContents.setZoomFactor(account.zoom || data.settings.defaultZoom || 1);
    injectGameOverlayButtons(view.webContents);
    // Covers an account that started elsewhere and only just navigated to
    // the game — attachCapture() is idempotent (checks debugger.isAttached())
    // so this is a no-op for accounts that already attached before loadURL.
    if (gameTelemetry.isGameUrl(view.webContents.getURL())) {
      gameTelemetry.attachCapture(view, account.id);
    }
  });
  view.webContents.on('page-title-updated', (_e, title) => updateHistoryTitle(view.webContents.getURL(), title));
  view.webContents.on('render-process-gone', (_e, details) => {
    console.error('[crash] renderer gone for', account.id, details.reason);
    const crashes = (crashCounts.get(account.id) || 0) + 1;
    crashCounts.set(account.id, crashes);
    if (crashes <= 3 && !view.webContents.isDestroyed()) {
      setTimeout(() => {
        if (!view.webContents.isDestroyed()) view.webContents.reload();
      }, 1000);
    } else {
      console.error('[crash]', account.id, 'crashed', crashes, 'times — giving up on auto-reload');
    }
  });
  view.webContents.on('context-menu', (_e, params) => showPageContextMenu(view.webContents, params));
  view.webContents.on('focus', () => {
    lastFocusedAccountId = account.id;
  });
  view.webContents.on('before-input-event', (event, input) => {
    if (handleAccountShortcut(input, account)) event.preventDefault();
  });
  view.webContents.on('found-in-page', (_e, result) => {
    if (mainWindow) {
      mainWindow.webContents.send('findbar:result', {
        id: account.id,
        matches: result.matches,
        activeMatchOrdinal: result.activeMatchOrdinal
      });
    }
  });
  view.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[page:${account.id}] ${message} (${sourceId}:${line})`);
  });
  // A page can destroy its own webContents any time by calling window.close()
  // on itself (normal web behavior, e.g. after a payment/OAuth flow) — without
  // this, that happened outside the app's own close flow entirely: the account
  // never got marked closed, and this view stayed in the `views` map pointing
  // at a destroyed webContents, which crashed metrics:get on every poll after.
  // finalizeAccountClose's guard makes this safe to also fire when the app
  // itself initiated the close (closeAccountView already handles that path).
  view.webContents.once('destroyed', () => {
    if (!account.closed) {
      finalizeAccountClose(account, view);
      persist();
      renderLayout();
      broadcastState();
    }
  });
  views.set(account.id, view);
  return view;
}

const GENGAR_ICON_B64 = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'assets', 'gengar-icon-b64.txt'), 'utf-8').trim();
    console.log('[gengar-icon] loaded, length =', raw.length);
    return raw;
  } catch (err) {
    console.error('[gengar-icon] FAILED to load from', path.join(__dirname, 'assets', 'gengar-icon-b64.txt'), err);
    return '';
  }
})();

// Site-specific enhancement: on poke.idleworld.online's /play page only, add two
// floating buttons top-right — a Pokéball that manually collapses/expands the
// game's own top toolbar, and a Gengar ball right below it that shows/hides the
// IV Helper extension's panel directly (no page reload, no session-level
// enable/disable — just toggling the same panel element the extension's own
// Alt+I shortcut controls). Both are purely user-controlled, no auto-hide.
// The toolbar's own class names are hashed/generated (Next.js), so instead of a
// hardcoded selector (which would break on the next deploy) this heuristically
// finds a fixed/sticky bar pinned near the top spanning most of the width with
// several small icon-like children — matches the toolbar row shown in the app.
function injectGameOverlayButtons(wc) {
  let url;
  try {
    url = new URL(wc.getURL());
  } catch {
    return;
  }
  if (url.hostname !== 'poke.idleworld.online' || !url.pathname.startsWith('/play')) return;

  wc.executeJavaScript(
    `(function() {
      if (window.__cbOverlayWatchdog) { window.__cbOverlayWatchdog(); return; }

      function findToolbar() {
        const all = document.querySelectorAll('body *');
        let best = null;
        let bestWidth = 0;
        for (const el of all) {
          if (el.id === 'cb-toggle-ball' || el.id === 'cb-ext-toggle-ball') continue;
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' && cs.position !== 'sticky' && cs.position !== 'absolute') continue;
          const r = el.getBoundingClientRect();
          if (r.top > 40 || r.height < 16 || r.height > 160) continue;
          if (r.width < window.innerWidth * 0.35) continue;
          const kids = el.querySelectorAll(':scope > *');
          if (kids.length < 4) continue;
          if (r.width > bestWidth) { best = el; bestWidth = r.width; }
        }
        return best;
      }

      function ensureToggleBall() {
        if (document.getElementById('cb-toggle-ball')) return;
        const ball = document.createElement('div');
        ball.id = 'cb-toggle-ball';
        ball.title = 'Mostrar/ocultar barra del juego';
        Object.assign(ball.style, {
          position: 'fixed', top: '120px', right: '8px', width: '34px', height: '34px',
          borderRadius: '50%', cursor: 'pointer', zIndex: '2147483000',
          boxShadow: '0 2px 8px rgba(0,0,0,.5)', border: '2px solid #1a1a1a',
          background: 'linear-gradient(#ee1515 0 46%, #1a1a1a 46% 54%, #fff 54% 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box'
        });
        const dot = document.createElement('div');
        Object.assign(dot.style, {
          width: '10px', height: '10px', borderRadius: '50%', background: '#fff',
          border: '2px solid #1a1a1a', boxSizing: 'border-box'
        });
        ball.appendChild(dot);

        let hiddenBar = null;
        let originalDisplay = '';
        ball.addEventListener('click', () => {
          if (hiddenBar) {
            hiddenBar.style.display = originalDisplay;
            hiddenBar = null;
            return;
          }
          const bar = findToolbar();
          if (!bar) return;
          originalDisplay = bar.style.display;
          bar.style.display = 'none';
          hiddenBar = bar;
        });

        (document.body || document.documentElement).appendChild(ball);
      }

      function ensureExtBall() {
        if (document.getElementById('cb-ext-toggle-ball') || !'${GENGAR_ICON_B64}') return;
        const gengar = document.createElement('div');
        gengar.id = 'cb-ext-toggle-ball';
        gengar.title = 'Mostrar/ocultar panel de IV Helper';
        Object.assign(gengar.style, {
          position: 'fixed', top: '160px', right: '8px', width: '34px', height: '34px',
          borderRadius: '50%', cursor: 'pointer', zIndex: '2147483000',
          boxShadow: '0 2px 8px rgba(0,0,0,.5)', border: '2px solid #1a1a1a',
          backgroundImage: 'url(data:image/png;base64,${GENGAR_ICON_B64})',
          backgroundSize: 'cover', backgroundPosition: 'center'
        });
        gengar.addEventListener('click', () => {
          const panel = document.getElementById('iv-helper-panel');
          if (!panel) return;
          panel.style.display = panel.style.display === 'none' ? '' : 'none';
        });
        (document.body || document.documentElement).appendChild(gengar);
      }

      // Self-healing: re-adds either button if the page's own re-renders ever
      // strip them out, so they survive both reloads and in-page SPA routing
      // without us having to detect either from the outside.
      window.__cbOverlayWatchdog = function() {
        ensureToggleBall();
        ensureExtBall();
      };
      window.__cbOverlayWatchdog();
      window.__cbOverlayWatchdogTimer = setInterval(window.__cbOverlayWatchdog, 2000);
    })();`
  ).catch((err) => console.error('[overlay-buttons] inject failed', err));
}

// injectGameOverlayButtons only re-fires on a full page load (did-finish-load);
// an in-page SPA navigation away from /play keeps the same JS realm alive, so
// without this the watchdog interval above would keep polling the DOM every
// 2s indefinitely even after the game's own toolbar is long gone.
function stopGameOverlayWatchdogIfLeft(wc, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.hostname === 'poke.idleworld.online' && parsed.pathname.startsWith('/play')) return;
  wc.executeJavaScript(
    `(function() {
      if (window.__cbOverlayWatchdogTimer) {
        clearInterval(window.__cbOverlayWatchdogTimer);
        window.__cbOverlayWatchdogTimer = null;
      }
    })();`
  ).catch(() => {});
}

function showPageContextMenu(wc, params) {
  const items = [
    { label: 'Atrás', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Adelante', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Volver a cargar', click: () => wc.reload() },
    { type: 'separator' }
  ];

  if (params.linkURL) {
    items.push(
      { label: 'Abrir enlace', click: () => wc.loadURL(params.linkURL) },
      { label: 'Copiar enlace', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' }
    );
  }

  if (params.mediaType === 'video') {
    items.push(
      {
        label: 'Picture-in-Picture',
        click: () => {
          wc.executeJavaScript(
            `(function() {
              var el = document.elementFromPoint(${params.x}, ${params.y});
              var video = el && el.tagName === 'VIDEO' ? el : (el && el.closest ? el.closest('video') : null);
              if (!video) video = document.querySelector('video');
              if (video && document.pictureInPictureEnabled && !video.disablePictureInPicture) {
                video.requestPictureInPicture().catch(() => {});
              }
            })();`
          ).catch(() => {});
        }
      },
      { type: 'separator' }
    );
  }

  if (params.selectionText) {
    items.push({ label: 'Copiar', click: () => clipboard.writeText(params.selectionText) }, { type: 'separator' });
  }

  if (params.isEditable) {
    items.push(
      { label: 'Cortar', click: () => wc.cut() },
      { label: 'Copiar', click: () => wc.copy() },
      { label: 'Pegar', click: () => wc.paste() },
      { type: 'separator' }
    );
  }

  items.push(
    {
      label: 'Guardar como...',
      click: async () => {
        const result = await dialog.showSaveDialog(mainWindow, { defaultPath: wc.getTitle() || 'pagina' });
        if (!result.canceled && result.filePath) wc.savePage(result.filePath, 'HTMLComplete').catch(() => {});
      }
    },
    { label: 'Imprimir...', click: () => wc.print() },
    { type: 'separator' },
    {
      label: 'Ver código fuente',
      click: () => {
        const srcWindow = new BrowserWindow({ width: 900, height: 700, title: 'Código fuente', icon: APP_ICON_PATH });
        srcWindow.loadURL('view-source:' + wc.getURL());
      }
    },
    { label: 'Inspeccionar', click: () => wc.inspectElement(params.x, params.y) }
  );

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function pushHistory(url, title) {
  if (!url || url === 'about:blank' || url.startsWith('chrome-extension://')) return;
  const existingIdx = data.history.findIndex((h) => h.url === url);
  if (existingIdx !== -1) data.history.splice(existingIdx, 1);
  data.history.unshift({ url, title: title || url, visitedAt: Date.now() });
  if (data.history.length > 300) data.history.length = 300;
}

function updateHistoryTitle(url, title) {
  const entry = data.history.find((h) => h.url === url);
  if (entry) {
    entry.title = title;
    persist();
  }
}

function notifyNav(id, url) {
  const account = getAccount(id);
  if (!account) return;
  account.url = url;
  pushHistory(url, null);
  persist();
  if (mainWindow) mainWindow.webContents.send('nav:update', { id, url });
}

function ensureView(account) {
  return views.get(account.id) || createViewForAccount(account);
}

function sidebarWidth() {
  return data.settings.sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
}

function contentBounds() {
  const [winWidth, winHeight] = mainWindow.getContentSize();
  const top = TOPBAR_HEIGHT;
  const left = RAIL_WIDTH + sidebarWidth();
  return {
    x: left,
    y: top,
    width: Math.max(winWidth - left, 0),
    height: Math.max(winHeight - top - STATUSBAR_HEIGHT, 0)
  };
}

function clearAllViews() {
  for (const view of views.values()) {
    mainWindow.contentView.removeChildView(view);
  }
}

// cellsForMode and freeCells now live in ./layout-utils (required above).

// Pure (aside from the activeAccountId self-heal below, which only fires when
// the current value is already invalid): figures out which accounts occupy
// which rects for the current layout mode, without touching any real
// WebContentsView. Shared by renderLayout (which applies the result to the
// actual views) and broadcastGeometryOnly (which doesn't need to).
function computeCells(bounds) {
  const mode = data.settings.layoutMode;
  const spaceAccounts = openAccountsInCurrentSpace().filter((a) => !poppedOutIds.has(a.id));
  let cells;

  const maximized = data.settings.maximizedAccountId
    ? spaceAccounts.find((a) => a.id === data.settings.maximizedAccountId)
    : null;

  if (maximized) {
    // Maximized panel temporarily fills the whole content area without touching
    // layoutMode or any other account's open/closed state — a pure view toggle.
    cells = [{ account: maximized, rect: bounds }];
  } else if (mode === 'single') {
    let account = getAccount(data.settings.activeAccountId);
    if (!account || account.spaceId !== getCurrentSpace()?.id || account.closed) {
      account = spaceAccounts[0];
      if (account) data.settings.activeAccountId = account.id;
    }
    cells = account ? [{ account, rect: bounds }] : [];
  } else if (mode === 'free') {
    cells = spaceAccounts.length === 0 ? [] : freeCells(spaceAccounts, bounds);
  } else {
    cells = spaceAccounts.length === 0 ? [] : cellsForMode(mode, spaceAccounts, bounds);
  }

  return { cells, maximized };
}

function buildGeometry(cells, maximized) {
  return cells.map(({ account, rect }) => ({
    id: account.id,
    name: displayName(account),
    url: account.url,
    color: account.color,
    muted: !!account.muted,
    maximized: !!maximized && maximized.id === account.id,
    zoom: account.zoom || data.settings.defaultZoom || 1,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: PANEL_HEADER_HEIGHT },
    fullRect: rect
  }));
}

function renderLayout() {
  const bounds = contentBounds();
  clearAllViews();
  const { cells, maximized } = computeCells(bounds);

  for (const { account, rect } of cells) {
    const view = ensureView(account);
    mainWindow.contentView.addChildView(view);
    view.setBounds({
      x: rect.x,
      y: rect.y + PANEL_HEADER_HEIGHT,
      width: rect.width,
      height: Math.max(rect.height - PANEL_HEADER_HEIGHT, 0)
    });
  }

  if (mainWindow) mainWindow.webContents.send('panels:geometry', buildGeometry(cells, maximized));
}

// For changes that only affect a panel's displayed metadata (mute/name/color/
// zoom) — not which accounts are open, the layout mode, or their sizes —
// resending geometry doesn't need renderLayout's clearAllViews() + re-add +
// setBounds cycle on every open WebContentsView. That cycle is real,
// measurable native work (each call tears down and recomposites every panel),
// and several handlers were paying for it just to flip one boolean.
function broadcastGeometryOnly() {
  if (!mainWindow) return;
  const { cells, maximized } = computeCells(contentBounds());
  mainWindow.webContents.send('panels:geometry', buildGeometry(cells, maximized));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#111318',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  // Throttled: OS resize events can fire dozens of times per second while the
  // user drags a window edge, and each renderLayout() tears down and re-adds
  // every open WebContentsView — unthrottled this visibly janks with more than
  // a couple of panels open. Renders immediately on the first tick (stays
  // responsive), then at most once per RESIZE_THROTTLE_MS while still moving,
  // with one guaranteed trailing render so the final size is always exact.
  const RESIZE_THROTTLE_MS = 50;
  let resizeThrottleTimer = null;
  let resizeRenderPending = false;
  mainWindow.on('resize', () => {
    if (resizeThrottleTimer) {
      resizeRenderPending = true;
      return;
    }
    renderLayout();
    resizeThrottleTimer = setTimeout(() => {
      resizeThrottleTimer = null;
      if (resizeRenderPending) {
        resizeRenderPending = false;
        renderLayout();
      }
    }, RESIZE_THROTTLE_MS);
  });

  return mainWindow;
}

function broadcastState() {
  mainWindow.webContents.send('state:update', data);
}

// ---- IPC handlers ----

ipcMain.handle('state:get', () => data);

ipcMain.handle('accounts:add', (_e, { name, url, spaceId, color }) => {
  const targetSpaceId = spaceId || getCurrentSpace()?.id || 'default';
  const account = {
    id: crypto.randomUUID(),
    name: name || 'Cuenta',
    url: /^https?:\/\//.test(url) ? url : `https://${url}`,
    spaceId: targetSpaceId,
    color: color || '#4f8cff',
    openedAt: Date.now()
  };
  data.accounts.push(account);
  data.settings.activeAccountId = account.id;
  data.settings.layoutMode = 'single';
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:quickAdd', () => {
  quickAddAccount();
  return data;
});

ipcMain.handle('account:navigate', (_e, { id, url }) => {
  const account = getAccount(id);
  if (!account) return;
  const target = /^https?:\/\/|^about:/.test(url) ? url : `https://${url}`;
  account.url = target;
  persist();
  const view = ensureView(account);
  view.webContents.loadURL(target);
  broadcastState();
});

// Shared by the accounts:remove IPC handler and the "Eliminar cuenta" context
// menu item, which used to duplicate this logic verbatim (a fix to one could
// silently not apply to the other). Unlike closing an account (which keeps its
// session around so reopening it stays logged in), permanently removing it
// also releases the persist:account-<id> partition on disk — previously that
// was left orphaned forever, growing the user-data folder with every account
// anyone ever deleted — and drops its blockedCounts/crashCounts bookkeeping,
// which otherwise leaked one Map entry per removed account for the process's
// entire lifetime.
function removeAccountCompletely(id) {
  data.accounts = data.accounts.filter((a) => a.id !== id);
  const view = views.get(id);
  const ses = view ? view.webContents.session : session.fromPartition(`persist:account-${id}`);
  if (view) {
    mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    views.delete(id);
  }
  ses.clearStorageData().then(() => ses.clearCache()).catch((err) => console.error('[remove-account] failed to clear session for', id, err));
  blockedCounts.delete(id);
  crashCounts.delete(id);
  if (data.settings.activeAccountId === id) {
    data.settings.activeAccountId = accountsInCurrentSpace()[0]?.id || null;
  }
  persist();
  renderLayout();
  broadcastState();
}

ipcMain.handle('accounts:remove', (_e, { id }) => {
  removeAccountCompletely(id);
  return data;
});

ipcMain.handle('accounts:duplicate', (_e, { id }) => {
  const source = getAccount(id);
  if (!source) return data;
  const copy = {
    id: crypto.randomUUID(),
    name: `${displayName(source)} (copia)`,
    url: source.url,
    spaceId: source.spaceId,
    color: source.color,
    muted: false,
    openedAt: Date.now()
  };
  const index = data.accounts.findIndex((a) => a.id === id);
  data.accounts.splice(index + 1, 0, copy);
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('account:clearSession', async (_e, { id }) => {
  const account = getAccount(id);
  if (!account) return;
  const view = views.get(id);
  const ses = view ? view.webContents.session : session.fromPartition(`persist:account-${id}`);
  await ses.clearStorageData();
  await ses.clearCache();
  if (view) view.webContents.reload();
});

ipcMain.on('accounts:contextmenu', (_e, payload) => {
  if (!payload || typeof payload.id !== 'string') return;
  const { id } = payload;
  const account = getAccount(id);
  if (!account) return;
  const space = getSpace(account.spaceId);
  const menu = Menu.buildFromTemplate([
    { label: 'Recargar', click: () => views.get(id)?.webContents.reload() },
    {
      label: 'Ir a la URL predeterminada',
      click: () => {
        const target = space?.defaultUrl || 'https://www.google.com';
        account.url = target;
        persist();
        const view = ensureView(account);
        view.webContents.loadURL(target);
        broadcastState();
      }
    },
    {
      label: account.muted ? 'Activar sonido' : 'Silenciar panel',
      click: () => {
        account.muted = !account.muted;
        views.get(id)?.webContents.setAudioMuted(account.muted);
        persist();
        renderLayout();
        broadcastState();
      }
    },
    { type: 'separator' },
    {
      label: 'Cerrar cuenta',
      click: async () => {
        const closed = await closeAccountView(account);
        if (!closed) return;
        if (data.settings.activeAccountId === id) {
          data.settings.activeAccountId = openAccountsInCurrentSpace()[0]?.id || null;
        }
        persist();
        renderLayout();
        broadcastState();
      }
    },
    { label: 'Editar cuenta', click: () => mainWindow.webContents.send('ui:open-account-editor', { id }) },
    {
      label: 'Abrir en ventana nueva',
      enabled: !poppedOutIds.has(id),
      click: () => openAccountInNewWindow(id)
    },
    {
      label: 'Duplicar cuenta',
      click: () => {
        const copy = {
          id: crypto.randomUUID(),
          name: `${displayName(account)} (copia)`,
          url: account.url,
          spaceId: account.spaceId,
          color: account.color,
          muted: false,
          openedAt: Date.now()
        };
        const index = data.accounts.findIndex((a) => a.id === id);
        data.accounts.splice(index + 1, 0, copy);
        persist();
        renderLayout();
        broadcastState();
      }
    },
    { type: 'separator' },
    {
      label: 'Borrar datos de sesión',
      click: async () => {
        const view = views.get(id);
        const ses = view ? view.webContents.session : session.fromPartition(`persist:account-${id}`);
        await ses.clearStorageData();
        await ses.clearCache();
        if (view) view.webContents.reload();
      }
    },
    {
      label: 'Eliminar cuenta',
      click: () => removeAccountCompletely(id)
    }
  ]);
  menu.popup({ window: mainWindow });
});

ipcMain.handle('accounts:update', (_e, { id, name, color, url, proxy }) => {
  const account = getAccount(id);
  if (!account) return data;
  if (name !== undefined) account.name = name || null;
  if (color !== undefined) account.color = color;
  if (url !== undefined && url.trim() && url !== account.url) {
    const target = /^https?:\/\/|^about:/.test(url) ? url : `https://${url}`;
    account.url = target;
    const view = ensureView(account);
    view.webContents.loadURL(target);
  }
  if (proxy !== undefined) {
    account.proxy = proxy && proxy.server ? proxy : null;
    const view = views.get(id);
    if (view) applyProxy(view.webContents.session, account);
  }
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

function removeSpace(id) {
  // The first space is pinned — always keep one guaranteed home base to work in.
  if (data.spaces.length <= 1 || id === data.spaces[0].id) return;
  const fallback = data.spaces.find((s) => s.id !== id);
  data.accounts
    .filter((a) => a.spaceId === id)
    .forEach((a) => {
      a.spaceId = fallback.id;
    });
  data.spaces = data.spaces.filter((s) => s.id !== id);
  if (data.settings.currentSpaceId === id) {
    data.settings.currentSpaceId = fallback.id;
    data.settings.activeAccountId = null;
    data.settings.layoutMode = fallback.defaultLayout || 'single';
  }
  persist();
  renderLayout();
  broadcastState();
}

function duplicateSpace(id) {
  const source = getSpace(id);
  if (!source) return;
  const newSpace = {
    id: crypto.randomUUID(),
    name: `${source.name} (copia)`,
    color: source.color,
    icon: source.icon,
    defaultUrl: source.defaultUrl,
    defaultLayout: source.defaultLayout
  };
  const index = data.spaces.findIndex((s) => s.id === id);
  data.spaces.splice(index + 1, 0, newSpace);

  // Duplicating a space also duplicates its accounts, each as a fresh isolated
  // session (new id/partition) so cookies/cache don't leak between the copies.
  data.accounts
    .filter((a) => a.spaceId === id)
    .forEach((a) => {
      data.accounts.push({
        id: crypto.randomUUID(),
        name: a.name,
        url: a.url,
        spaceId: newSpace.id,
        color: a.color,
        muted: false,
        closed: a.closed,
        openedAt: a.closed ? undefined : Date.now()
      });
    });

  persist();
  renderLayout();
  broadcastState();
}

function finalizeAccountClose(account, view) {
  // Idempotent: this can now be reached twice for the same close — once from
  // the webContents' own permanent 'destroyed' listener (createViewForAccount,
  // which catches a page closing itself via window.close(), previously left
  // account.closed unset and a dead view in the `views` map forever) and once
  // from closeAccountView's flow when the app itself initiated the close.
  if (account.closed) return;
  account.closed = true;
  delete account.openedAt;
  // zoom is intentionally kept — it's a per-account preference the user picked,
  // not session state; only openedAt (elapsed-time display) resets on close.
  lastClosedAccountId = account.id;
  if (data.settings.maximizedAccountId === account.id) {
    data.settings.maximizedAccountId = null;
  }
  if (poppedOutWindows.has(account.id)) {
    const win = poppedOutWindows.get(account.id);
    poppedOutIds.delete(account.id);
    poppedOutWindows.delete(account.id);
    if (!win.isDestroyed()) win.close();
  }
  if (view) {
    try {
      mainWindow.contentView.removeChildView(view);
    } catch {
      // wasn't attached to the main window (e.g. it was popped out) — fine
    }
  }
  views.delete(account.id);
}

// Resolves true if the account actually closed, false if the page's own
// beforeunload handler asked to confirm and the user chose to stay (Chromium
// shows its native "Leave site?" dialog for this automatically).
function closeAccountView(account) {
  return new Promise((resolve) => {
    const view = views.get(account.id);
    if (!view) {
      finalizeAccountClose(account, null);
      resolve(true);
      return;
    }
    const wc = view.webContents;
    let settled = false;
    const onDestroyed = () => {
      if (settled) return;
      settled = true;
      finalizeAccountClose(account, view);
      resolve(true);
    };
    const onPrevent = () => {
      if (settled) return;
      settled = true;
      wc.removeListener('destroyed', onDestroyed);
      resolve(false);
    };
    wc.once('destroyed', onDestroyed);
    wc.once('will-prevent-unload', onPrevent);
    wc.close({ waitForBeforeUnload: true });
  });
}

ipcMain.handle('accounts:activate', (_e, { id }) => {
  const account = getAccount(id);
  if (!account) return data;

  // Opening/switching to an account never touches the others — each tab keeps
  // its own timer and resource usage running independently in the background.
  if (account.closed) {
    account.closed = false;
    account.openedAt = Date.now();
  }
  data.settings.activeAccountId = id;
  // If a panel is currently maximized, switching tabs should swap which
  // account fills the screen instead of leaving the old one stuck on top.
  if (data.settings.maximizedAccountId) {
    data.settings.maximizedAccountId = id;
  }
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:toggleMaximize', (_e, { id }) => {
  data.settings.maximizedAccountId = data.settings.maximizedAccountId === id ? null : id;
  persist();
  renderLayout();
  broadcastState();
  return data;
});

function openAccountInNewWindow(id) {
  const account = getAccount(id);
  if (!account || account.closed || poppedOutIds.has(id)) return;
  if (data.settings.maximizedAccountId === id) data.settings.maximizedAccountId = null;

  const view = ensureView(account);
  try {
    mainWindow.contentView.removeChildView(view);
  } catch {
    // wasn't attached yet — fine
  }
  poppedOutIds.add(id);

  const win = new BrowserWindow({ width: 1100, height: 750, title: displayName(account), backgroundColor: '#111318', icon: APP_ICON_PATH });
  win.contentView.addChildView(view);
  const resize = () => {
    const b = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
  };
  resize();
  win.on('resize', resize);
  // The OS close button (X) fires 'close' before the window is actually gone,
  // so it's the only place this can go through the same beforeunload-respecting
  // flow every other close path uses (closeAccountView) instead of just
  // vanishing the window and skipping any unsaved-work warning the page itself
  // would show. finalizeAccountClose sets account.closed = true and, seeing
  // this account still tracked as popped out, closes this same window itself —
  // that second close() re-enters this handler, where the closed guard below
  // lets it proceed instead of asking again.
  win.on('close', (e) => {
    const acc = getAccount(id);
    if (!acc || acc.closed) return;
    e.preventDefault();
    closeAccountView(acc).then((closed) => {
      if (closed) {
        persist();
        renderLayout();
        broadcastState();
        if (!win.isDestroyed()) win.close();
      }
    });
  });
  win.on('closed', () => {
    poppedOutIds.delete(id);
    poppedOutWindows.delete(id);
  });
  poppedOutWindows.set(id, win);

  renderLayout();
  broadcastState();
}

ipcMain.handle('accounts:openInNewWindow', (_e, { id }) => {
  openAccountInNewWindow(id);
  return data;
});

ipcMain.handle('accounts:closeOne', async (_e, { id }) => {
  const account = getAccount(id);
  if (!account) return data;
  const closed = await closeAccountView(account);
  if (closed) {
    if (data.settings.activeAccountId === id) {
      data.settings.activeAccountId = openAccountsInCurrentSpace()[0]?.id || null;
    }
    persist();
    renderLayout();
    broadcastState();
  }
  return data;
});

ipcMain.handle('accounts:closeAll', async () => {
  const spaceAccounts = accountsInCurrentSpace();
  await Promise.all(spaceAccounts.map((a) => closeAccountView(a)));
  const active = getAccount(data.settings.activeAccountId);
  if (active && active.closed) {
    data.settings.activeAccountId = null;
  }
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:openAll', () => {
  accountsInCurrentSpace().forEach((a) => {
    a.closed = false;
    a.openedAt = Date.now();
  });
  if (!data.settings.activeAccountId) {
    data.settings.activeAccountId = accountsInCurrentSpace()[0]?.id || null;
  }
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('account:setFreeRect', (_e, { id, rect }) => {
  const account = getAccount(id);
  if (!account) return data;
  account.freeRect = rect;
  persist();
  renderLayout();
  broadcastState();
  return data;
});

// Commits a divider drag in columns/rows/grid layouts. `ids` is the whole sibling
// group (a row's accounts for a width split, or one representative account per row
// for a height split — see resolveFracs) so every member's frac is written at once,
// keeping the group's sum at 1 instead of leaving stale values from before the drag.
// normalizeFracsWithMin lives in ./layout-utils (required above).
ipcMain.handle('layout:setSplit', (_e, { ids, fracs, field }) => {
  if (field !== 'widthFrac' && field !== 'heightFrac') return data;
  if (!Array.isArray(ids) || !Array.isArray(fracs) || ids.length !== fracs.length || ids.length < 2) return data;
  const normalized = normalizeFracsWithMin(fracs, MIN_SPLIT_FRAC);
  ids.forEach((id, i) => {
    const account = getAccount(id);
    if (account) account[field] = normalized[i];
  });
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('layout:set', (_e, { mode }) => {
  data.settings.layoutMode = mode;
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('account:reload', (_e, { id }) => {
  const view = views.get(id);
  if (view) view.webContents.reload();
});

ipcMain.handle('account:reloadHard', (_e, { id }) => {
  const view = views.get(id);
  if (view) view.webContents.reloadIgnoringCache();
});

ipcMain.handle('accounts:reopenLastClosed', () => {
  reopenLastClosedAccount();
  return data;
});

ipcMain.on('account:findInPage', (_e, payload) => {
  if (!payload) return;
  const { id, text, forward, findNext } = payload;
  const view = views.get(id);
  if (!view || !text) return;
  view.webContents.findInPage(text, { forward: forward !== false, findNext: !!findNext });
});

ipcMain.on('account:stopFindInPage', (_e, payload) => {
  const view = payload && views.get(payload.id);
  if (view) view.webContents.stopFindInPage('clearSelection');
});

ipcMain.on('account:goBack', (_e, payload) => {
  const view = payload && views.get(payload.id);
  if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
});

ipcMain.on('account:goForward', (_e, payload) => {
  const view = payload && views.get(payload.id);
  if (view?.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward();
});

ipcMain.handle('app:getMeta', () => ({ startTime: appStartTime, version: APP_VERSION }));

ipcMain.handle('shortcuts:list', () => SHORTCUTS);

ipcMain.handle('account:mute', (_e, { id, muted }) => {
  const account = getAccount(id);
  const view = views.get(id);
  if (view) view.webContents.setAudioMuted(muted);
  if (account) account.muted = muted;
  persist();
  broadcastGeometryOnly();
  broadcastState();
});

ipcMain.handle('spaces:add', (_e, payload = {}) => {
  const space = {
    id: crypto.randomUUID(),
    name: payload.name || 'Espacio',
    color: payload.color || '#4f8cff',
    icon: payload.icon || '🔲',
    defaultUrl: payload.defaultUrl || data.settings.defaultStartUrl || 'https://www.google.com',
    defaultLayout: payload.defaultLayout || data.settings.newSpaceDefaultLayout || 'single'
  };
  data.spaces.push(space);
  data.settings.currentSpaceId = space.id;
  data.settings.layoutMode = space.defaultLayout;
  data.settings.activeAccountId = null;
  data.settings.maximizedAccountId = null;
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('spaces:update', (_e, { id, ...fields }) => {
  const space = getSpace(id);
  if (!space) return data;
  Object.assign(space, fields);
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('spaces:remove', (_e, { id }) => {
  removeSpace(id);
  return data;
});

ipcMain.handle('spaces:duplicate', (_e, { id }) => {
  duplicateSpace(id);
  return data;
});

ipcMain.on('spaces:contextmenu', (_e, payload) => {
  if (!payload || typeof payload.id !== 'string') return;
  const { id } = payload;
  const space = getSpace(id);
  if (!space) return;
  const isFirst = data.spaces[0]?.id === id;
  const menu = Menu.buildFromTemplate([
    { label: 'Editar espacio', click: () => mainWindow.webContents.send('ui:open-space-editor', { id }) },
    { label: 'Duplicar espacio', click: () => duplicateSpace(id) },
    { type: 'separator' },
    {
      label: 'Eliminar espacio',
      enabled: !isFirst && data.spaces.length > 1,
      click: () => removeSpace(id)
    }
  ]);
  menu.popup({ window: mainWindow });
});

ipcMain.handle('spaces:activate', (_e, { id }) => {
  const space = getSpace(id);
  if (!space) return data;
  data.settings.currentSpaceId = id;
  data.settings.activeAccountId = null;
  data.settings.maximizedAccountId = null;
  data.settings.layoutMode = space.defaultLayout || 'single';
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('sidebar:toggle', () => {
  data.settings.sidebarCollapsed = !data.settings.sidebarCollapsed;
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.on('ui:hide-views', () => clearAllViews());
ipcMain.on('ui:show-views', () => renderLayout());

// Live-follows a divider drag: repositions just the one view's bounds immediately,
// without touching account data or triggering a full renderLayout/persist — those
// only happen once on mouseup (see layout:setSplit) so dragging stays cheap and the
// real page content visibly resizes instead of a placeholder while the user drags.
ipcMain.on('account:setLiveRect', (_e, payload) => {
  if (!payload) return;
  const { id, rect } = payload;
  if (!rect || [rect.x, rect.y, rect.width, rect.height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return;
  const view = views.get(id);
  if (!view) return;
  view.setBounds({
    x: rect.x,
    y: rect.y + PANEL_HEADER_HEIGHT,
    width: rect.width,
    height: Math.max(rect.height - PANEL_HEADER_HEIGHT, 0)
  });
});

ipcMain.handle('extensions:installFromStore', async (_e, { input }) => {
  try {
    await installExtensionFromStore(input);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:loadUnpacked', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  const dir = result.filePaths[0];
  const manifest = readManifest(dir);
  if (!manifest.manifest_version) return { ok: false, error: 'La carpeta no contiene un manifest.json válido.' };
  const id = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 32).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
  if (data.settings.extensions.some((e) => e.path === dir)) return { ok: false, error: 'Esa carpeta ya está cargada.' };
  try {
    await finishInstall(id, dir);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:toggle', (_e, { id, enabled }) => {
  const ext = data.settings.extensions.find((e) => e.id === id);
  if (!ext) return data;
  ext.enabled = enabled;
  if (enabled) {
    for (const view of views.values()) {
      view.webContents.session.extensions
        .loadExtension(ext.path, { allowFileAccess: true })
        .catch((err) => console.error('[ext] FAILED to re-enable', ext.name, err));
    }
  } else {
    unloadExtensionFromAllSessions(id);
  }
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('extensions:remove', (_e, { id }) => {
  const ext = data.settings.extensions.find((e) => e.id === id);
  if (!ext) return data;
  unloadExtensionFromAllSessions(id);
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

ipcMain.handle('account:setZoom', (_e, { id, factor }) => {
  const account = getAccount(id);
  if (!account) return data;
  account.zoom = factor;
  const view = views.get(id);
  if (view) view.webContents.setZoomFactor(factor);
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:setZoomAll', (_e, { factor }) => {
  data.accounts.forEach((a) => {
    a.zoom = factor;
  });
  for (const view of views.values()) view.webContents.setZoomFactor(factor);
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

ipcMain.on('app:toggleFullscreen', () => {
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on('app:relaunch', () => {
  app.relaunch();
  app.exit();
});

ipcMain.on('app:openDownloads', () => {
  shell.openPath(data.settings.downloadsFolder || app.getPath('downloads'));
});

ipcMain.handle('downloads:openFile', (_e, { id }) => {
  const d = data.downloads.find((x) => x.id === id);
  if (d && d.path) shell.openPath(d.path);
});

ipcMain.handle('downloads:showInFolder', (_e, { id }) => {
  const d = data.downloads.find((x) => x.id === id);
  if (d && d.path) shell.showItemInFolder(d.path);
});

ipcMain.handle('downloads:remove', (_e, { id }) => {
  data.downloads = data.downloads.filter((x) => x.id !== id);
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('downloads:clear', () => {
  data.downloads = [];
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:muteAll', (_e, { muted }) => {
  data.accounts.forEach((a) => {
    a.muted = muted;
  });
  for (const view of views.values()) view.webContents.setAudioMuted(muted);
  data.settings.allMuted = muted;
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

// Whitelisted against every window.api.updateSettings(...) call site in
// renderer.js — anything else is either handled by its own dedicated IPC
// channel (layoutMode via layout:set, sidebarCollapsed via sidebar:toggle,
// etc.) or isn't meant to be renderer-writable at all (extensions,
// maximizedAccountId, activeAccountId are main-process-owned state).
const SETTINGS_UPDATE_WHITELIST = new Set([
  'startWithWindows',
  'reopenLastSpace',
  'hardwareAcceleration',
  'adBlockEnabled',
  'defaultStartUrl',
  'defaultZoom',
  'newSpaceDefaultLayout',
  'askDownloadLocation',
  'autoCheckUpdates'
]);

ipcMain.handle('settings:update', (_e, fields) => {
  if (!fields || typeof fields !== 'object') return data;
  for (const key of Object.keys(fields)) {
    if (!SETTINGS_UPDATE_WHITELIST.has(key)) continue;
    data.settings[key] = fields[key];
  }
  if ('startWithWindows' in fields) {
    app.setLoginItemSettings({ openAtLogin: !!fields.startWithWindows });
  }
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('settings:chooseDownloadsFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return data;
  data.settings.downloadsFolder = result.filePaths[0];
  persist();
  broadcastState();
  return data;
});

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(status, extra = {}) {
  if (mainWindow) mainWindow.webContents.send('update:status', { status, ...extra });
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'));
autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', { version: info.version }));
autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: err?.message || String(err) }));

ipcMain.handle('plugins:list', () => {
  return [
    {
      name: 'Widevine Content Decryption Module',
      description: widevineCdm
        ? `Habilita reproducción de video con DRM (Netflix, Spotify Web Player, etc.) — tomado de ${widevineCdm.source} ${widevineCdm.browserVersion}.`
        : 'No se encontró un módulo compatible en este equipo — la reproducción de video con DRM no va a funcionar. Instala Chrome o Edge para habilitarlo automáticamente.',
      version: widevineCdm ? widevineCdm.version : null,
      enabled: !!widevineCdm
    },
    {
      name: 'Códec de video H.264',
      description:
        'Incluido de fábrica en Electron (a diferencia de Firefox, que lo agrega como plugin aparte de Cisco) — no requiere nada adicional.',
      version: null,
      enabled: true
    }
  ];
});

ipcMain.handle('settings:checkUpdates', () => {
  if (!app.isPackaged) {
    return {
      message:
        'Estás corriendo la versión de desarrollo (sin empaquetar) — todavía no hay ninguna release publicada para revisar. Esto queda listo para funcionar automático apenas empaquetemos y publiquemos una versión.'
    };
  }
  autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus('error', { message: err?.message || String(err) }));
  return { message: 'Buscando actualizaciones…' };
});

ipcMain.handle('settings:installUpdate', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('settings:exportSpaces', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'nexa-browser-espacios.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    const payload = {
      spaces: data.spaces,
      accounts: data.accounts.map((a) => ({ name: a.name, url: a.url, spaceId: a.spaceId, color: a.color }))
    };
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('settings:importSpaces', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    const idMap = new Map();
    (parsed.spaces || []).forEach((s) => {
      const newId = crypto.randomUUID();
      idMap.set(s.id, newId);
      data.spaces.push({ ...s, id: newId });
    });
    (parsed.accounts || []).forEach((a) => {
      data.accounts.push({
        id: crypto.randomUUID(),
        name: a.name || null,
        url: a.url || 'about:blank',
        spaceId: idMap.get(a.spaceId) || getCurrentSpace()?.id || 'default',
        color: a.color || null
      });
    });
    persist();
    renderLayout();
    broadcastState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

ipcMain.handle('bookmarks:add', (_e, { title, url }) => {
  if (!url) return data;
  data.bookmarks.push({ id: crypto.randomUUID(), title: title || url, url });
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('bookmarks:remove', (_e, { id }) => {
  data.bookmarks = data.bookmarks.filter((b) => b.id !== id);
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('bookmarks:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'marcadores-nexa-browser.html',
    filters: [{ name: 'Marcadores (HTML)', extensions: ['html'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    // Netscape Bookmark File format — the universal export/import standard
    // supported by Chrome, Firefox, Brave and Edge.
    const items = data.bookmarks.map((b) => `    <DT><A HREF="${b.url}">${escapeHtml(b.title)}</A>`).join('\n');
    const html =
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
      '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
      items +
      '\n</DL><p>\n';
    fs.writeFileSync(result.filePath, html, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('bookmarks:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Marcadores', extensions: ['html', 'htm', 'json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  const filePath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const imported = [];
    if (filePath.toLowerCase().endsWith('.json')) {
      // Chrome/Brave/Edge "Bookmarks" profile file format.
      const parsed = JSON.parse(raw);
      const walk = (node) => {
        if (!node) return;
        if (node.type === 'url' && node.url) imported.push({ title: node.name || node.url, url: node.url });
        if (Array.isArray(node.children)) node.children.forEach(walk);
      };
      if (parsed.roots) Object.values(parsed.roots).forEach(walk);
    } else {
      // Netscape Bookmark File (HTML export) — Chrome, Firefox, Brave, Edge all produce this.
      const re = /<A[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
      let m;
      while ((m = re.exec(raw))) {
        imported.push({ title: decodeHtmlEntities(m[2]) || m[1], url: m[1] });
      }
    }
    const existingUrls = new Set(data.bookmarks.map((b) => b.url));
    let added = 0;
    imported.forEach((b) => {
      if (!b.url || existingUrls.has(b.url)) return;
      existingUrls.add(b.url);
      data.bookmarks.push({ id: crypto.randomUUID(), title: b.title, url: b.url });
      added++;
    });
    persist();
    broadcastState();
    return { ok: true, added };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('passwords:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const rows = parseCsv(raw);
    if (!rows.length) return { ok: false, error: 'Archivo vacío o formato no reconocido.' };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      name: header.indexOf('name'),
      url: header.indexOf('url'),
      username: header.findIndex((h) => h === 'username' || h === 'login'),
      password: header.indexOf('password')
    };
    if (idx.url === -1 || idx.password === -1) {
      return { ok: false, error: 'El CSV no tiene el formato esperado (columnas url, username, password).' };
    }
    let added = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[idx.url]) continue;
      const id = crypto.randomUUID();
      data.passwords.push({
        id,
        name: idx.name >= 0 ? row[idx.name] : row[idx.url],
        url: row[idx.url],
        username: idx.username >= 0 ? row[idx.username] : ''
      });
      passwordSecrets.set(id, row[idx.password]);
      added++;
    }
    persist();
    broadcastState();
    return { ok: true, added };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    try {
      return new URL(`https://${url}`).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
}

ipcMain.handle('autofill:query', (_e, origin) => {
  const host = hostnameOf(origin);
  if (!host) return [];
  return data.passwords
    .filter((p) => hostnameOf(p.url) === host)
    .map((p) => ({ username: p.username, password: passwordSecrets.get(p.id) || '', name: p.name, url: p.url }));
});

// The only channel that hands back real password values for display — called
// on demand when the renderer opens Configuración → Contraseñas, not folded
// into the general state broadcast (see the comment on passwordSecrets).
ipcMain.handle('passwords:list', () => {
  return data.passwords.map((p) => ({ ...p, password: passwordSecrets.get(p.id) || '' }));
});

ipcMain.handle('passwords:add', (_e, { name, url, username, password }) => {
  if (!url || !password) return { ok: false, error: 'La URL y la contraseña son obligatorias.' };
  const id = crypto.randomUUID();
  data.passwords.push({ id, name: name || url, url, username: username || '' });
  passwordSecrets.set(id, password);
  persist();
  broadcastState();
  return { ok: true };
});

ipcMain.handle('passwords:remove', (_e, { id }) => {
  data.passwords = data.passwords.filter((p) => p.id !== id);
  passwordSecrets.delete(id);
  persist();
  broadcastState();
  return data;
});

// Fase A del motor de telemetría — calcado exactamente del patrón de
// metrics:get de arriba abajo (poll-based, sin push): el renderer llama esto
// cada pocos segundos y solo le importa a las cuentas de poke.idleworld.online
// (getStats devuelve null para cualquier otra, que el renderer simplemente no
// muestra).
ipcMain.handle('gameStats:get', () => gameTelemetry.getAllStats());

ipcMain.handle('metrics:get', () => {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const result = {};
  for (const [id, view] of views.entries()) {
    if (view.webContents.isDestroyed()) continue; // stale entry mid-cleanup — skip rather than throw
    const pid = view.webContents.getOSProcessId();
    const m = byPid.get(pid);
    result[id] = {
      cpu: m ? m.cpu.percentCPUUsage : 0,
      memoryMB: m ? Math.round((m.memory?.workingSetSize || 0) / 1024) : 0,
      blocked: blockedCounts.get(id) || 0
    };
  }
  return result;
});

// Prevent two instances from ever running at once — they'd share the same
// userData folder (data.json, extension sessions) and silently corrupt each
// other's state, which looks exactly like extensions "trying but never
// finishing" to load.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Must happen before anything reads data.passwords (createWindow/renderLayout
  // below broadcast full state right after) — safeStorage's OS-keychain backend
  // isn't reliably available until app.whenReady() resolves, so load() above
  // (which runs at module load time, before ready) leaves passwords as-is and
  // this does the actual decrypt now that it's safe to.
  // Split each decrypted password into passwordSecrets (kept out of `data`
  // entirely) — see the comment on passwordSecrets above for why.
  data.passwords = store.decryptStoredPasswords(data.passwords).map((p) => {
    passwordSecrets.set(p.id, p.password);
    const { password, ...meta } = p;
    return meta;
  });
  Menu.setApplicationMenu(null);
  seedDefaultExtensions();
  gameTelemetry.startHeartbeat();
  gameTelemetry.startDebugLogger();
  app.setLoginItemSettings({ openAtLogin: !!data.settings.startWithWindows });
  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    renderLayout();
    broadcastState();
    // Deferred past first paint — see the comment on loadCachedBlocklist().
    // blockedDomains already has the built-in list from module load, so
    // adblock works from the very first page load either way; this just
    // upgrades it to the fuller cached/fresh list a moment later.
    loadCachedBlocklist().then(refreshBlocklistIfStale);
  });

  if (app.isPackaged && data.settings.autoCheckUpdates !== false) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', flushPersist);
