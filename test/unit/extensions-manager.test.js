// Behavior of createExtensionsManager(): installing from the Chrome Web Store
// (download → CRX → zip checks → extraction), loading unpacked folders, and
// the extensions:* IPC handlers. extension-archive-safety.test.js covers the
// exported archive predicates in isolation; this file runs the real install
// pipeline end to end, which is the only way preValidateZipEntries() and
// assertNoEscapedEntries() are ever reached.
//
// Mocked: electron (app paths, dialog, ipcMain, BrowserWindow) and https (so
// no test touches the network). extract-zip and yauzl stay real and extract
// real archives built below.
const { test, describe, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-extmgr-test-'));
const userDataDir = path.join(tmpRoot, 'userData');
const tempDir = path.join(tmpRoot, 'temp');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------- fakes

const ipcHandlers = new Map();
const dialogState = { result: { canceled: true, filePaths: [] }, calls: 0 };

let windows = [];
class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.listeners = {};
    this.url = null;
    windows.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
  emit(event) {
    for (const fn of this.listeners[event] || []) fn();
  }
  loadURL(url) {
    this.url = url;
  }
  setPosition() {}
}

mock.module('electron', {
  exports: {
    app: { getPath: (name) => (name === 'temp' ? tempDir : userDataDir) },
    dialog: {
      showOpenDialog: async () => {
        dialogState.calls++;
        return dialogState.result;
      }
    },
    ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
    BrowserWindow: FakeWindow
  }
});

// Each https.get() call pops the next scripted response.
const httpsState = { responses: [], urls: [] };
mock.module('https', {
  exports: {
    get(url, _options, callback) {
      httpsState.urls.push(url);
      const script = httpsState.responses.shift();
      const req = new EventEmitter();
      setImmediate(() => {
        if (!script) {
          req.emit('error', new Error('unexpected request'));
          return;
        }
        if (script.networkError) {
          req.emit('error', script.networkError);
          return;
        }
        const res = new EventEmitter();
        res.statusCode = script.status;
        res.headers = script.headers || {};
        res.resumed = false;
        res.destroyed = false;
        res.resume = () => {
          res.resumed = true;
        };
        res.destroy = () => {
          res.destroyed = true;
        };
        callback(res);
        setImmediate(() => {
          for (const chunk of script.chunks || []) {
            if (res.destroyed) return;
            res.emit('data', chunk);
          }
          if (!res.destroyed) res.emit('end');
        });
      });
      return req;
    }
  }
});

const { createExtensionsManager, EXTENSIONS_DIR } = require('../../electron/extensions-manager');

// ------------------------------------------------------- archive builders

// Minimal "stored" (uncompressed) zip. `mode` becomes the unix mode in the
// high bits of externalFileAttributes, which is how zip marks a symlink.
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, content = '', mode = 0o100644 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function buildCrx3(zip) {
  const header = Buffer.from('fake-crx3-signed-header');
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'utf8');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'Test Blocker',
  version: '1.2.3',
  description: 'desc',
  action: { default_popup: 'popup.html', default_icon: { 16: 'i16.png', 48: 'i48.png' } }
});

const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop';

function okCrx(entries) {
  return { status: 200, chunks: [buildCrx3(buildZip(entries))] };
}

// ------------------------------------------------------------ fixtures

let data;
let persistCalls;
let broadcastCalls;
let views;
let manager;

function fakeView({ id = 'loaded-id', loadError = null, destroyed = false } = {}) {
  const view = {
    destroyed,
    isDestroyed() {
      return view.destroyed;
    },
    loaded: [],
    removed: [],
    session: {
      extensions: {
        loadExtension: async (dir) => {
          view.loaded.push(dir);
          if (loadError) throw loadError;
          return { id, name: 'Loaded Name', version: '9.9.9' };
        },
        removeExtension: (extId) => {
          view.removed.push(extId);
          if (loadError) throw loadError;
        }
      }
    }
  };
  return view;
}

function invoke(channel, payload) {
  return ipcHandlers.get(channel)({}, payload);
}

function tempLeftovers() {
  return fs.readdirSync(tempDir);
}

beforeEach(() => {
  data = { settings: { language: 'es', extensions: [], activeAccountId: null } };
  persistCalls = 0;
  broadcastCalls = 0;
  views = new Map();
  windows = [];
  ipcHandlers.clear();
  httpsState.responses = [];
  httpsState.urls = [];
  dialogState.result = { canceled: true, filePaths: [] };
  dialogState.calls = 0;
  fs.rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  for (const f of tempLeftovers())
    fs.rmSync(path.join(tempDir, f), { recursive: true, force: true });
  manager = createExtensionsManager({
    getData: () => data,
    persist: () => {
      persistCalls++;
    },
    broadcastState: () => {
      broadcastCalls++;
    },
    mt: (lang, key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    getMainWindow: () => null,
    views
  });
  manager.registerIpcHandlers();
});

// ------------------------------------------------------------------ tests

test('EXTENSIONS_DIR lives under userData and exists at module load', () => {
  assert.equal(EXTENSIONS_DIR, path.join(userDataDir, 'extensions'));
  assert.ok(fs.existsSync(EXTENSIONS_DIR));
});

describe('readManifest()', () => {
  test('parses manifest.json from a folder', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'm-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST);
    assert.equal(manager.readManifest(dir).name, 'Test Blocker');
  });

  test('returns {} for a missing or malformed manifest', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'm-'));
    assert.deepEqual(manager.readManifest(dir), {});
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json');
    assert.deepEqual(manager.readManifest(dir), {});
  });
});

describe('extractExtensionAction()', () => {
  const dir = path.join('C:', 'ext');
  const act = (manifest) => manager.extractExtensionAction(manifest, dir);

  test('reads a Manifest V3 action and prefers the first icon size >= 32', () => {
    assert.deepEqual(
      act({
        name: 'N',
        action: {
          default_popup: 'p.html',
          default_title: 'T',
          default_icon: { 16: 'a.png', 48: 'b.png', 32: 'c.png' }
        }
      }),
      {
        icon: path.join(dir, 'c.png'),
        popup: 'p.html',
        title: 'T'
      }
    );
  });

  test('falls back to the largest icon when none reaches 32px', () => {
    assert.equal(
      act({ action: { default_icon: { 16: 'a.png', 24: 'b.png' } } }).icon,
      path.join(dir, 'b.png')
    );
  });

  test('accepts a single string icon', () => {
    assert.equal(act({ action: { default_icon: 'one.png' } }).icon, path.join(dir, 'one.png'));
  });

  test('uses browser_action, then page_action, for Manifest V2', () => {
    assert.equal(
      act({ browser_action: { default_popup: 'b.html' }, page_action: { default_popup: 'p.html' } })
        .popup,
      'b.html'
    );
    assert.equal(act({ page_action: { default_popup: 'p.html' } }).popup, 'p.html');
  });

  test('falls back to top-level icons and to the extension name', () => {
    assert.deepEqual(act({ name: 'Only Name', icons: { 128: 'big.png' } }), {
      icon: path.join(dir, 'big.png'),
      popup: null,
      title: 'Only Name'
    });
  });

  test('an extension with no action and no icons has nothing to show', () => {
    assert.deepEqual(act({}), { icon: null, popup: null, title: '' });
    assert.equal(act({ action: { default_icon: { abc: 'x.png' } } }).icon, null);
  });
});

describe('finishInstall()', () => {
  test('stores the id Electron actually assigned, not the guessed one', async () => {
    views.set('acc1', fakeView({ id: 'real-electron-id' }));
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'fi-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST);
    const entry = await manager.finishInstall('guessed-id', dir);
    assert.equal(entry.id, 'real-electron-id');
    assert.equal(entry.name, 'Loaded Name');
    assert.equal(entry.version, '9.9.9');
    assert.equal(entry.description, 'desc');
    assert.equal(entry.enabled, true);
    assert.deepEqual(data.settings.extensions, [entry]);
    assert.equal(persistCalls, 1);
    assert.equal(broadcastCalls, 1);
  });

  test('falls back to the guessed id and the manifest when no session loads it', async () => {
    views.set('acc1', fakeView({ loadError: new Error('nope') }));
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'fi-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST);
    const entry = await manager.finishInstall('guessed-id', dir);
    assert.equal(entry.id, 'guessed-id');
    assert.equal(entry.name, 'Test Blocker');
    assert.equal(entry.version, '1.2.3');
  });

  test('loads the extension into every open account session', async () => {
    const a = fakeView();
    const b = fakeView({ loadError: new Error('already loaded') });
    const c = fakeView();
    views.set('a', a).set('b', b).set('c', c);
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'fi-'));
    await manager.finishInstall('guessed-id', dir);
    assert.deepEqual([a.loaded, b.loaded, c.loaded], [[dir], [dir], [dir]]);
  });
});

describe('extensions:installFromStore', () => {
  test('rejects input without a valid 32-letter extension id, without downloading', async () => {
    for (const input of ['', 'hello', 'https://chromewebstore.google.com/detail/x/123']) {
      assert.deepEqual(await invoke('extensions:installFromStore', { input }), {
        ok: false,
        error: 'main.noValidExtensionId'
      });
    }
    assert.equal(httpsState.urls.length, 0);
  });

  test('extracts the id from a full store URL and asks Google for that id', async () => {
    httpsState.responses.push({ status: 404 });
    await invoke('extensions:installFromStore', {
      input: `https://chromewebstore.google.com/detail/name/${STORE_ID}?hl=es`
    });
    assert.equal(httpsState.urls.length, 1);
    assert.match(httpsState.urls[0], new RegExp(`x=id%3D${STORE_ID}%26uc`));
    assert.match(httpsState.urls[0], /acceptformat=crx3/);
  });

  test('refuses an extension already installed in the same folder', async () => {
    data.settings.extensions.push({ id: 'whatever', path: path.join(EXTENSIONS_DIR, STORE_ID) });
    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: false,
      error: 'main.extensionAlreadyInstalled'
    });
    assert.equal(httpsState.urls.length, 0);
  });

  test('a non-200 response fails with its status', async () => {
    httpsState.responses.push({ status: 404 });
    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: false,
      error: 'main.downloadFailed:{"status":404}'
    });
  });

  test('follows redirects, but gives up after 5', async () => {
    for (let i = 0; i < 6; i++)
      httpsState.responses.push({ status: 302, headers: { location: `https://r${i}.example/` } });
    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: false,
      error: 'main.tooManyRedirects'
    });
    assert.equal(httpsState.urls.length, 6);
    assert.equal(httpsState.urls[5], 'https://r4.example/');
  });

  test('a download larger than 128MB is aborted instead of buffered', async () => {
    // A fake chunk that only reports its size: nothing close to 128MB is allocated.
    httpsState.responses.push({ status: 200, chunks: [{ length: 128 * 1024 * 1024 + 1 }] });
    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: false,
      error: 'main.downloadFailed:{"status":"too large"}'
    });
  });

  test('a network error is reported', async () => {
    httpsState.responses.push({ networkError: new Error('ECONNRESET') });
    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: false,
      error: 'ECONNRESET'
    });
  });

  test('a response that is not a CRX is rejected with a translated error', async () => {
    httpsState.responses.push({
      status: 200,
      chunks: [Buffer.from('<html>not a crx at all</html>')]
    });
    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: false,
      error: 'main.invalidCrxFile'
    });
    assert.equal(persistCalls, 0);
  });

  test('installs a real CRX: follows the redirect, extracts, loads and records it', async () => {
    views.set('acc1', fakeView({ id: 'electron-assigned-id' }));
    httpsState.responses.push({
      status: 302,
      headers: { location: 'https://cdn.example/ext.crx' }
    });
    httpsState.responses.push(
      okCrx([
        { name: 'manifest.json', content: MANIFEST },
        { name: 'js/popup.js', content: 'console.log(1)' }
      ])
    );

    assert.deepEqual(await invoke('extensions:installFromStore', { input: STORE_ID }), {
      ok: true
    });

    const destDir = path.join(EXTENSIONS_DIR, STORE_ID);
    assert.equal(fs.readFileSync(path.join(destDir, 'js', 'popup.js'), 'utf8'), 'console.log(1)');
    assert.equal(data.settings.extensions.length, 1);
    assert.equal(data.settings.extensions[0].id, 'electron-assigned-id');
    assert.equal(data.settings.extensions[0].path, destDir);
    assert.equal(data.settings.extensions[0].action.popup, 'popup.html');
    assert.deepEqual(views.get('acc1').loaded, [destDir]);
    assert.deepEqual(tempLeftovers(), [], 'the temporary zip is deleted');
  });

  test('an archive with a symlink entry is refused before anything is extracted', async () => {
    httpsState.responses.push(
      okCrx([
        { name: 'manifest.json', content: MANIFEST },
        { name: 'evil-link', content: '../../../outside', mode: 0o120777 }
      ])
    );
    const result = await invoke('extensions:installFromStore', { input: STORE_ID });
    assert.equal(result.ok, false);
    assert.match(result.error, /symlink/);
    assert.equal(fs.existsSync(path.join(EXTENSIONS_DIR, STORE_ID)), false);
    assert.deepEqual(tempLeftovers(), []);
    assert.deepEqual(data.settings.extensions, []);
  });

  test('an archive with a path-traversal entry is refused and writes nothing outside', async () => {
    const escaped = path.join(EXTENSIONS_DIR, 'escaped.txt');
    httpsState.responses.push(
      okCrx([
        { name: 'manifest.json', content: MANIFEST },
        { name: '../escaped.txt', content: 'pwned' }
      ])
    );
    const result = await invoke('extensions:installFromStore', { input: STORE_ID });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(escaped), false);
    assert.equal(fs.existsSync(path.join(EXTENSIONS_DIR, STORE_ID)), false);
    assert.deepEqual(tempLeftovers(), []);
    assert.deepEqual(data.settings.extensions, []);
  });

  test('a corrupt zip inside a valid CRX header fails and leaves no temp file', async () => {
    httpsState.responses.push({
      status: 200,
      chunks: [buildCrx3(Buffer.from('PK-not-really-a-zip'))]
    });
    const result = await invoke('extensions:installFromStore', { input: STORE_ID });
    assert.equal(result.ok, false);
    assert.deepEqual(tempLeftovers(), []);
    assert.deepEqual(data.settings.extensions, []);
  });
});

describe('extensions:installFromStore — extraction failure', () => {
  // The central directory is intact, so the entry-list pre-scan passes; the
  // first local file header is broken, so extract-zip fails mid-extraction.
  function zipWithBrokenLocalHeader() {
    const zip = buildZip([{ name: 'manifest.json', content: MANIFEST }]);
    zip.writeUInt32LE(0xdeadbeef, 0);
    return zip;
  }

  test('fails, deletes the temporary zip and records nothing', async () => {
    httpsState.responses.push({ status: 200, chunks: [buildCrx3(zipWithBrokenLocalHeader())] });
    const result = await invoke('extensions:installFromStore', { input: STORE_ID });
    assert.equal(result.ok, false);
    assert.match(result.error, /local file header/);
    assert.deepEqual(tempLeftovers(), []);
    assert.equal(
      fs.existsSync(path.join(EXTENSIONS_DIR, STORE_ID)),
      false,
      'la carpeta que extract-zip ya habia creado no debe quedar huerfana'
    );
    assert.deepEqual(data.settings.extensions, []);
  });
});

describe('extensions:loadUnpacked', () => {
  function unpackedDir(manifest = MANIFEST) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'unpacked-'));
    if (manifest !== null) fs.writeFileSync(path.join(dir, 'manifest.json'), manifest);
    return dir;
  }

  test('does nothing when the folder picker is cancelled', async () => {
    assert.deepEqual(await invoke('extensions:loadUnpacked'), { ok: false });
    assert.equal(dialogState.calls, 1);
  });

  test('rejects a folder whose manifest has no manifest_version', async () => {
    dialogState.result = {
      canceled: false,
      filePaths: [unpackedDir(JSON.stringify({ name: 'x' }))]
    };
    assert.deepEqual(await invoke('extensions:loadUnpacked'), {
      ok: false,
      error: 'main.invalidManifestFolder'
    });
    dialogState.result = { canceled: false, filePaths: [unpackedDir(null)] };
    assert.deepEqual(await invoke('extensions:loadUnpacked'), {
      ok: false,
      error: 'main.invalidManifestFolder'
    });
  });

  test('refuses the same folder twice', async () => {
    const dir = unpackedDir();
    data.settings.extensions.push({ id: 'x', path: dir });
    dialogState.result = { canceled: false, filePaths: [dir] };
    assert.deepEqual(await invoke('extensions:loadUnpacked'), {
      ok: false,
      error: 'main.folderAlreadyLoaded'
    });
  });

  test('without any open session it records a deterministic a-j fallback id', async () => {
    const dir = unpackedDir();
    dialogState.result = { canceled: false, filePaths: [dir] };
    assert.deepEqual(await invoke('extensions:loadUnpacked'), { ok: true });
    const [entry] = data.settings.extensions;
    assert.match(entry.id, /^[a-j]{32}$/);
    assert.equal(entry.path, dir);

    data.settings.extensions = [];
    await invoke('extensions:loadUnpacked');
    assert.equal(data.settings.extensions[0].id, entry.id, 'same folder, same id');
  });
});

describe('extensions:openPopup', () => {
  const EXT = {
    id: 'ext1',
    name: 'Ext One',
    path: 'x',
    action: { popup: 'popup.html', title: 'Ext Title' },
    enabled: true
  };

  test('reports an unknown extension or one without a popup', () => {
    assert.deepEqual(invoke('extensions:openPopup', { id: 'nope' }), {
      ok: false,
      error: 'main.extensionNotFound'
    });
    data.settings.extensions.push({ ...EXT, action: { popup: null } });
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), {
      ok: false,
      error: 'main.extensionNoPopup'
    });
  });

  test('needs at least one open account', () => {
    data.settings.extensions.push(EXT);
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), {
      ok: false,
      error: 'main.openAccountFirst'
    });
    views.set('dead', fakeView({ destroyed: true }));
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), {
      ok: false,
      error: 'main.openAccountFirst'
    });
    assert.equal(windows.length, 0);
  });

  test('opens the popup in the active account session, sandboxed', () => {
    data.settings.extensions.push(EXT);
    const active = fakeView();
    views.set('other', fakeView()).set('active', active);
    data.settings.activeAccountId = 'active';
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), { ok: true });
    const popup = windows[0];
    assert.equal(popup.url, 'chrome-extension://ext1/popup.html');
    assert.equal(popup.options.title, 'Ext Title');
    assert.equal(popup.options.webPreferences.session, active.session);
    assert.equal(popup.options.webPreferences.sandbox, true);
    assert.equal(popup.options.webPreferences.contextIsolation, true);
  });

  test('falls back to any live account when the active one is gone', () => {
    data.settings.extensions.push(EXT);
    const live = fakeView();
    views.set('active', fakeView({ destroyed: true })).set('live', live);
    data.settings.activeAccountId = 'active';
    invoke('extensions:openPopup', { id: 'ext1' });
    assert.equal(windows[0].options.webPreferences.session, live.session);
  });

  test('a second click closes the open popup instead of opening another', () => {
    data.settings.extensions.push(EXT);
    views.set('a', fakeView());
    invoke('extensions:openPopup', { id: 'ext1' });
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), { ok: true, closed: true });
    assert.equal(windows.length, 1);
    assert.equal(windows[0].isDestroyed(), true);
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), { ok: true });
    assert.equal(windows.length, 2);
  });

  test('the popup closes itself on blur, and a closed popup can be reopened', () => {
    data.settings.extensions.push(EXT);
    views.set('a', fakeView());
    invoke('extensions:openPopup', { id: 'ext1' });
    windows[0].emit('blur');
    assert.equal(windows[0].isDestroyed(), true);
    assert.deepEqual(invoke('extensions:openPopup', { id: 'ext1' }), { ok: true });
    assert.equal(windows.length, 2);
  });
});

describe('extensions:toggle', () => {
  const ext = () => ({
    id: 'ext1',
    name: 'Ext',
    path: path.join(EXTENSIONS_DIR, 'ext1'),
    action: { popup: 'p.html' },
    enabled: false
  });

  test('enabling succeeds when at least one session loads it', async () => {
    data.settings.extensions.push(ext());
    views.set('a', fakeView({ loadError: new Error('x') })).set('b', fakeView());
    await invoke('extensions:toggle', { id: 'ext1', enabled: true });
    assert.equal(data.settings.extensions[0].enabled, true);
    assert.equal(persistCalls, 1);
  });

  test('enabling fails, and the toggle stays off, when every session rejects it', async () => {
    data.settings.extensions.push(ext());
    views
      .set('a', fakeView({ loadError: new Error('x') }))
      .set('b', fakeView({ loadError: new Error('y') }));
    const originalError = console.error;
    console.error = () => {};
    try {
      await invoke('extensions:toggle', { id: 'ext1', enabled: true });
    } finally {
      console.error = originalError;
    }
    assert.equal(data.settings.extensions[0].enabled, false);
    assert.equal(persistCalls, 0);
  });

  test('enabling with no open accounts is optimistic', async () => {
    data.settings.extensions.push(ext());
    await invoke('extensions:toggle', { id: 'ext1', enabled: true });
    assert.equal(data.settings.extensions[0].enabled, true);
  });

  test('disabling unloads it everywhere and closes its popup', async () => {
    data.settings.extensions.push({ ...ext(), enabled: true });
    const a = fakeView();
    const b = fakeView({ loadError: new Error('not loaded here') });
    views.set('a', a).set('b', b);
    invoke('extensions:openPopup', { id: 'ext1' });
    await invoke('extensions:toggle', { id: 'ext1', enabled: false });
    assert.equal(data.settings.extensions[0].enabled, false);
    assert.deepEqual([a.removed, b.removed], [['ext1'], ['ext1']]);
    assert.equal(windows[0].isDestroyed(), true);
    assert.equal(persistCalls, 1);
  });

  test('an unknown id changes nothing', async () => {
    assert.equal(await invoke('extensions:toggle', { id: 'nope', enabled: true }), data);
    assert.equal(persistCalls, 0);
  });
});

describe('extensions:remove', () => {
  test('deletes an extension folder inside EXTENSIONS_DIR', () => {
    const dir = path.join(EXTENSIONS_DIR, 'ext1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), MANIFEST);
    data.settings.extensions.push({ id: 'ext1', path: dir });
    const a = fakeView();
    views.set('a', a);
    invoke('extensions:remove', { id: 'ext1' });
    assert.equal(fs.existsSync(dir), false);
    assert.deepEqual(data.settings.extensions, []);
    assert.deepEqual(a.removed, ['ext1']);
    assert.equal(persistCalls, 1);
  });

  test('never deletes an unpacked folder that lives elsewhere', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'user-dev-ext-'));
    data.settings.extensions.push({ id: 'dev', path: dir });
    invoke('extensions:remove', { id: 'dev' });
    assert.equal(fs.existsSync(dir), true);
    assert.deepEqual(data.settings.extensions, []);
  });

  test('never deletes a sibling folder that only shares the EXTENSIONS_DIR prefix', () => {
    const sibling = `${EXTENSIONS_DIR}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    try {
      data.settings.extensions.push({ id: 'evil', path: sibling });
      invoke('extensions:remove', { id: 'evil' });
      assert.equal(fs.existsSync(sibling), true);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  test('never deletes EXTENSIONS_DIR itself', () => {
    data.settings.extensions.push({ id: 'root', path: EXTENSIONS_DIR });
    invoke('extensions:remove', { id: 'root' });
    assert.equal(fs.existsSync(EXTENSIONS_DIR), true);
  });

  test('an unknown id changes nothing', () => {
    data.settings.extensions.push({ id: 'keep', path: 'x' });
    invoke('extensions:remove', { id: 'nope' });
    assert.equal(data.settings.extensions.length, 1);
    assert.equal(persistCalls, 0);
  });
});
