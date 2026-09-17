// Behavior of createPermissionsManager(): the request/check handlers Electron
// calls for every permission a page asks for, the allow/deny prompt window,
// and the IPC handlers behind Configuración → Permisos.
// permission-policy.test.js only covers the constant sets; everything here
// runs the real module against fake Electron objects.
//
// electron is mocked before the module is required (same approach as
// store.test.js). game-telemetry.js and url-utils.js stay real, so "is this
// the game?" and hostname parsing are exercised for real.
const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const ipcListeners = new Map(); // channel -> Set<fn>
const ipcHandlers = new Map(); // channel -> fn
const ipcMain = {
  on(channel, fn) {
    if (!ipcListeners.has(channel)) ipcListeners.set(channel, new Set());
    ipcListeners.get(channel).add(fn);
  },
  removeListener(channel, fn) {
    ipcListeners.get(channel)?.delete(fn);
  },
  handle(channel, fn) {
    ipcHandlers.set(channel, fn);
  }
};
function emitIpc(channel, event, payload) {
  for (const fn of [...(ipcListeners.get(channel) || [])]) fn(event, payload);
}
function listenerCount(channel) {
  return ipcListeners.get(channel)?.size || 0;
}

let windows = [];
let nextWebContentsId = 1;
class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.listeners = {};
    this.webContents = { id: nextWebContentsId++ };
    this.loaded = null;
    windows.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const fn of this.listeners.closed || []) fn();
  }
  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  }
  loadFile(file, options) {
    this.loaded = { file, options };
  }
  setPosition() {}
}

const partitions = [];
mock.module('electron', {
  exports: {
    ipcMain,
    session: {
      fromPartition: (name) => {
        partitions.push(name);
        return { partition: name };
      }
    },
    BrowserWindow: FakeWindow
  }
});

const { createPermissionsManager } = require('../../electron/permissions-manager');

const GAME_URL = 'https://poke.idleworld.online/game';
const SITE = 'https://meet.example.com/room';

let data;
let persistCalls;
let broadcastCalls;
let manager;

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Wires a manager's handlers onto a fake session and returns them, the way
// wireAccountWebContents() in main.js does for a real account.
function wire(account) {
  const ses = {};
  ses.setPermissionRequestHandler = (fn) => {
    ses.request = fn;
  };
  ses.setPermissionCheckHandler = (fn) => {
    ses.check = fn;
  };
  manager.applyPermissionHandler(ses, account);
  return ses;
}

// Calls the request handler and captures what it answered (if anything yet).
function request(ses, permission, requestingUrl) {
  const result = { answered: false, granted: undefined };
  ses.request(
    {},
    permission,
    (granted) => {
      result.answered = true;
      result.granted = granted;
    },
    { requestingUrl }
  );
  return result;
}

function lastPopup() {
  return windows[windows.length - 1];
}

beforeEach(() => {
  data = { settings: { language: 'es' } };
  persistCalls = 0;
  broadcastCalls = 0;
  windows = [];
  ipcListeners.clear();
  ipcHandlers.clear();
  partitions.length = 0;
  manager = createPermissionsManager({
    getData: () => data,
    persist: () => {
      persistCalls++;
    },
    broadcastState: () => {
      broadcastCalls++;
    },
    mt: (lang, key, params) =>
      params ? `${lang}:${key}:${JSON.stringify(params)}` : `${lang}:${key}`,
    getMainWindow: () => null
  });
});

describe('permission request handler: decisions that never prompt', () => {
  test('a permission outside the policy is denied', () => {
    const ses = wire({ url: SITE });
    const r = request(ses, 'usb', SITE);
    assert.deepEqual(r, { answered: true, granted: false });
    assert.equal(windows.length, 0);
  });

  test('a low-risk permission is granted without a prompt', () => {
    const ses = wire({ url: SITE });
    for (const p of ['fullscreen', 'pointerLock', 'clipboard-sanitized-write']) {
      assert.deepEqual(request(ses, p, SITE), { answered: true, granted: true }, p);
    }
    assert.equal(windows.length, 0);
  });

  test('the game account is denied camera/mic, location and protocol handlers', () => {
    const ses = wire({ url: GAME_URL });
    for (const p of ['media', 'geolocation', 'openExternal']) {
      assert.deepEqual(request(ses, p, GAME_URL), { answered: true, granted: false }, p);
    }
    assert.equal(windows.length, 0);
  });

  test('the game account still gets the ordinary auto-granted permissions', () => {
    const ses = wire({ url: GAME_URL });
    assert.deepEqual(request(ses, 'fullscreen', GAME_URL), { answered: true, granted: true });
  });

  test('the game check follows account.url live instead of freezing it at wiring time', () => {
    const account = { url: GAME_URL };
    const ses = wire(account);
    assert.deepEqual(request(ses, 'openExternal', GAME_URL), { answered: true, granted: false });
    account.url = SITE; // same tab navigated away from the game
    assert.deepEqual(request(ses, 'openExternal', SITE), { answered: true, granted: true });
    account.url = GAME_URL; // and back
    assert.deepEqual(request(ses, 'openExternal', GAME_URL), { answered: true, granted: false });
  });

  test('a promptable permission with no parseable requesting URL is denied without a prompt', () => {
    const ses = wire({ url: SITE });
    for (const url of [undefined, '', 'not a url']) {
      assert.deepEqual(request(ses, 'media', url), { answered: true, granted: false }, String(url));
    }
    assert.equal(windows.length, 0);
    assert.deepEqual(data.settings.sitePermissions || {}, {});
  });

  test('a remembered "allow" is granted without a prompt', () => {
    data.settings.sitePermissions = { 'meet.example.com': { media: 'allow' } };
    const ses = wire({ url: SITE });
    assert.deepEqual(request(ses, 'media', SITE), { answered: true, granted: true });
    assert.equal(windows.length, 0);
  });

  test('a remembered "deny" is denied without a prompt', () => {
    data.settings.sitePermissions = { 'meet.example.com': { media: 'deny' } };
    const ses = wire({ url: SITE });
    assert.deepEqual(request(ses, 'media', SITE), { answered: true, granted: false });
    assert.equal(windows.length, 0);
  });

  test('a remembered decision only applies to its own permission', () => {
    data.settings.sitePermissions = { 'meet.example.com': { media: 'allow' } };
    const ses = wire({ url: SITE });
    const r = request(ses, 'geolocation', SITE);
    assert.equal(r.answered, false, 'geolocation must still prompt');
    assert.equal(windows.length, 1);
  });
});

describe('permission prompt window', () => {
  test('opens isolated from the account session, sandboxed, with the translated message', () => {
    const ses = wire({ url: SITE });
    request(ses, 'media', SITE);
    const popup = lastPopup();
    assert.equal(windows.length, 1);
    const prefs = popup.options.webPreferences;
    assert.deepEqual(prefs.session, { partition: 'permission-prompt-shared' });
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.match(popup.loaded.file, /permission-prompt\.html$/);
    assert.equal(
      popup.loaded.options.query.msg,
      'es:permission.promptMsg:{"hostname":"meet.example.com","permission":"es:permission.media"}'
    );
  });

  test('every prompt reuses the same fixed partition', () => {
    const ses = wire({ url: SITE });
    request(ses, 'media', SITE);
    request(ses, 'geolocation', SITE);
    assert.deepEqual(partitions, ['permission-prompt-shared', 'permission-prompt-shared']);
  });

  test('"allow" + remember grants, stores the decision and notifies the UI', async () => {
    const ses = wire({ url: SITE });
    const r = request(ses, 'media', SITE);
    const popup = lastPopup();
    emitIpc(
      'permission-prompt:respond',
      { sender: popup.webContents },
      { decision: 'allow', remember: true }
    );
    await flush();
    assert.deepEqual(r, { answered: true, granted: true });
    assert.deepEqual(data.settings.sitePermissions, { 'meet.example.com': { media: 'allow' } });
    assert.equal(persistCalls, 1);
    assert.equal(broadcastCalls, 1);
    assert.equal(popup.isDestroyed(), true);
  });

  test('"deny" + remember denies and stores the denial', async () => {
    const ses = wire({ url: SITE });
    const r = request(ses, 'geolocation', SITE);
    emitIpc(
      'permission-prompt:respond',
      { sender: lastPopup().webContents },
      { decision: 'deny', remember: true }
    );
    await flush();
    assert.deepEqual(r, { answered: true, granted: false });
    assert.deepEqual(data.settings.sitePermissions, {
      'meet.example.com': { geolocation: 'deny' }
    });
  });

  test('"allow" without remember grants once and stores nothing', async () => {
    const ses = wire({ url: SITE });
    const r = request(ses, 'media', SITE);
    emitIpc(
      'permission-prompt:respond',
      { sender: lastPopup().webContents },
      { decision: 'allow', remember: false }
    );
    await flush();
    assert.deepEqual(r, { answered: true, granted: true });
    assert.equal(persistCalls, 0);
    assert.equal(data.settings.sitePermissions?.['meet.example.com'], undefined);
  });

  test('any decision other than exactly "allow" is treated as a denial', async () => {
    const ses = wire({ url: SITE });
    for (const payload of [{ decision: 'ALLOW' }, { decision: true }, {}, null]) {
      const r = request(ses, 'notifications', SITE);
      emitIpc('permission-prompt:respond', { sender: lastPopup().webContents }, payload);
      await flush();
      assert.deepEqual(r, { answered: true, granted: false }, JSON.stringify(payload));
    }
  });

  test('closing the prompt without answering denies and remembers nothing', async () => {
    const ses = wire({ url: SITE });
    const r = request(ses, 'media', SITE);
    lastPopup().close();
    await flush();
    assert.deepEqual(r, { answered: true, granted: false });
    assert.equal(persistCalls, 0);
  });

  test('an answer from any other window is ignored', async () => {
    const ses = wire({ url: SITE });
    const r = request(ses, 'media', SITE);
    const popup = lastPopup();
    emitIpc(
      'permission-prompt:respond',
      { sender: { id: -1 } },
      { decision: 'allow', remember: true }
    );
    await flush();
    assert.equal(r.answered, false);
    assert.equal(popup.isDestroyed(), false);
    assert.equal(data.settings.sitePermissions?.['meet.example.com'], undefined);

    emitIpc('permission-prompt:respond', { sender: popup.webContents }, { decision: 'deny' });
    await flush();
    assert.deepEqual(r, { answered: true, granted: false });
  });

  test('two open prompts each only accept their own answer', async () => {
    const ses = wire({ url: SITE });
    const first = request(ses, 'media', SITE);
    const firstPopup = lastPopup();
    const second = request(ses, 'geolocation', SITE);
    const secondPopup = lastPopup();

    emitIpc(
      'permission-prompt:respond',
      { sender: secondPopup.webContents },
      { decision: 'allow' }
    );
    await flush();
    assert.equal(first.answered, false);
    assert.deepEqual(second, { answered: true, granted: true });

    emitIpc('permission-prompt:respond', { sender: firstPopup.webContents }, { decision: 'deny' });
    await flush();
    assert.deepEqual(first, { answered: true, granted: false });
  });

  test('the IPC listener is removed once the prompt is answered or closed', async () => {
    const ses = wire({ url: SITE });
    request(ses, 'media', SITE);
    request(ses, 'geolocation', SITE);
    assert.equal(listenerCount('permission-prompt:respond'), 2);
    emitIpc('permission-prompt:respond', { sender: windows[0].webContents }, { decision: 'allow' });
    windows[1].close();
    await flush();
    assert.equal(listenerCount('permission-prompt:respond'), 0);
  });

  test('the callback is answered exactly once even if the window also closes', async () => {
    const ses = wire({ url: SITE });
    let calls = 0;
    ses.request(
      {},
      'media',
      () => {
        calls++;
      },
      { requestingUrl: SITE }
    );
    const popup = lastPopup();
    emitIpc('permission-prompt:respond', { sender: popup.webContents }, { decision: 'allow' });
    popup.close();
    await flush();
    assert.equal(calls, 1);
  });
});

describe('concurrent prompt cap', () => {
  test('a fourth pending prompt on the same session is denied without opening a window', () => {
    const ses = wire({ url: SITE });
    request(ses, 'media', SITE);
    request(ses, 'geolocation', SITE);
    request(ses, 'notifications', SITE);
    const fourth = request(ses, 'media', SITE);
    assert.deepEqual(fourth, { answered: true, granted: false });
    assert.equal(windows.length, 3);
  });

  test('answering a prompt frees its slot', async () => {
    const ses = wire({ url: SITE });
    request(ses, 'media', SITE);
    request(ses, 'geolocation', SITE);
    request(ses, 'notifications', SITE);
    windows[0].close();
    await flush();
    const next = request(ses, 'media', SITE);
    assert.equal(next.answered, false);
    assert.equal(windows.length, 4);
  });

  test('the cap is per session, not global', () => {
    const a = wire({ url: SITE });
    const b = wire({ url: 'https://other.example.org/' });
    for (let i = 0; i < 3; i++) request(a, 'media', SITE);
    const fromB = request(b, 'media', 'https://other.example.org/');
    assert.equal(fromB.answered, false);
    assert.equal(windows.length, 4);
  });
});

describe('permission check handler', () => {
  test('mirrors the request policy without ever prompting', () => {
    data.settings.sitePermissions = {
      'meet.example.com': { media: 'allow', geolocation: 'deny' }
    };
    const site = wire({ url: SITE });
    const game = wire({ url: GAME_URL });
    const origin = 'https://meet.example.com';

    assert.equal(site.check({}, 'usb', origin), false, 'unknown permission');
    assert.equal(site.check({}, 'fullscreen', origin), true, 'auto permission');
    assert.equal(site.check({}, 'media', origin), true, 'stored allow');
    assert.equal(site.check({}, 'geolocation', origin), false, 'stored deny');
    assert.equal(site.check({}, 'notifications', origin), false, 'nothing stored');
    assert.equal(site.check({}, 'media', ''), false, 'no hostname');
    assert.equal(game.check({}, 'media', 'https://poke.idleworld.online'), false, 'game-denied');
    assert.equal(windows.length, 0);
  });
});

describe('IPC handlers', () => {
  beforeEach(() => {
    manager.registerIpcHandlers();
  });

  test('getSitePermissions creates the settings bucket when missing', () => {
    const result = ipcHandlers.get('permissions:getSitePermissions')();
    assert.deepEqual(result, {});
    assert.equal(data.settings.sitePermissions, result);
  });

  test('revoke removes one permission and keeps the host while others remain', () => {
    data.settings.sitePermissions = { 'a.com': { media: 'allow', geolocation: 'deny' } };
    const result = ipcHandlers.get('permissions:revoke')(
      {},
      { hostname: 'a.com', permission: 'media' }
    );
    assert.deepEqual(result, { 'a.com': { geolocation: 'deny' } });
    assert.equal(persistCalls, 1);
    assert.equal(broadcastCalls, 1);
  });

  test('revoking the last permission of a host removes the host', () => {
    data.settings.sitePermissions = { 'a.com': { media: 'allow' }, 'b.com': { media: 'deny' } };
    const result = ipcHandlers.get('permissions:revoke')(
      {},
      { hostname: 'a.com', permission: 'media' }
    );
    assert.deepEqual(result, { 'b.com': { media: 'deny' } });
  });

  test('revoking on an unknown host changes nothing', () => {
    data.settings.sitePermissions = { 'a.com': { media: 'allow' } };
    const result = ipcHandlers.get('permissions:revoke')(
      {},
      { hostname: 'zzz.com', permission: 'media' }
    );
    assert.deepEqual(result, { 'a.com': { media: 'allow' } });
  });

  test('clearAll forgets every remembered decision', () => {
    data.settings.sitePermissions = {
      'a.com': { media: 'allow' },
      'b.com': { geolocation: 'deny' }
    };
    const result = ipcHandlers.get('permissions:clearAll')();
    assert.deepEqual(result, {});
    assert.deepEqual(data.settings.sitePermissions, {});
    assert.equal(persistCalls, 1);
    assert.equal(broadcastCalls, 1);
  });

  test('a revoked "allow" prompts again on the next request', () => {
    data.settings.sitePermissions = { 'meet.example.com': { media: 'allow' } };
    const ses = wire({ url: SITE });
    assert.deepEqual(request(ses, 'media', SITE), { answered: true, granted: true });
    ipcHandlers.get('permissions:revoke')(
      {},
      { hostname: 'meet.example.com', permission: 'media' }
    );
    const again = request(ses, 'media', SITE);
    assert.equal(again.answered, false);
    assert.equal(windows.length, 1);
  });
});
