// Web permission handling (camera/mic, notifications, geolocation, and the
// handful of low-risk permissions every site gets automatically) — split out
// of main.js so the permission-prompt window lifecycle and the per-site
// remember/revoke storage aren't tangled up with window/account bookkeeping.
//
// Uses the same dependency-injection shape as translate.js: main.js stays
// the single owner of `data`/persist()/broadcastState(), this module only
// ever touches them through the functions it's handed.
const { ipcMain, session } = require('electron');
const path = require('path');
const gameTelemetry = require('./game-telemetry');
const { hostnameFromUrlLike } = require('./url-utils');
const { createAnchoredPopup } = require('./popup-window');

// Without an explicit handler Electron denies most permission requests
// outright, which silently breaks sites that need a camera/mic (video
// calls), notifications, or geolocation. These are all things a site only
// asks for when the page itself wants to use them, so allowing the
// common/expected set matches normal browser behavior instead of a blanket
// silent denial. 'prompt' permissions additionally get a real per-site
// allow/block popup (see promptSitePermission below) instead of being
// silently granted like the 'auto' ones — declaring both in one policy map
// means a permission can never end up allowed without anyone deciding
// whether it should be prompted, the way two separately-maintained Sets
// could silently drift apart.
const PERMISSION_POLICY = {
  media: 'prompt',
  notifications: 'prompt',
  geolocation: 'prompt',
  fullscreen: 'auto',
  pointerLock: 'auto',
  midi: 'auto',
  midiSysex: 'auto',
  'clipboard-sanitized-write': 'auto',
  openExternal: 'auto'
};
const ALLOWED_PERMISSIONS = new Set(Object.keys(PERMISSION_POLICY));
// The privacy-sensitive subset — real browsers ask the user per-site for
// these instead of silently granting them. The rest stay auto-granted:
// low-risk UX permissions a real browser doesn't gate behind a prompt
// either.
const PROMPTABLE_PERMISSIONS = new Set(
  Object.keys(PERMISSION_POLICY).filter((k) => PERMISSION_POLICY[k] === 'prompt')
);

// Poke Idle World has no legitimate use for a camera, microphone, or the
// player's real-world location — narrowing the default for that domain
// specifically (instead of the same blanket ALLOWED_PERMISSIONS every other
// site gets) cuts attack surface and avoids spurious OS permission prompts,
// without touching normal browsing, where camera/mic requests are expected
// (video calls, etc.).
const GAME_DENIED_PERMISSIONS = new Set(['media', 'geolocation']);

const PERMISSION_PROMPT_PRELOAD = path.join(__dirname, 'permission-prompt-preload.js');
const PERMISSION_PROMPT_HTML = path.join(__dirname, '../src/permission-prompt.html');

// `getData`/`persist`/`broadcastState`/`mt`/`getMainWindow` are the exact
// functions main.js already uses for this state — passed in rather than
// required, since `data` is a live, reassignable module-level binding in
// main.js that a `require()` here couldn't observe updates to.
function createPermissionsManager({ getData, persist, broadcastState, mt, getMainWindow }) {
  function getSitePermissions() {
    const data = getData();
    if (!data.settings.sitePermissions) data.settings.sitePermissions = {};
    return data.settings.sitePermissions;
  }

  function getSitePermissionDecision(hostname, permission) {
    const forHost = getSitePermissions()[hostname];
    return forHost ? forHost[permission] : undefined;
  }

  function setSitePermissionDecision(hostname, permission, decision) {
    const sp = getSitePermissions();
    if (!sp[hostname]) sp[hostname] = {};
    sp[hostname][permission] = decision;
    persist();
    broadcastState();
  }

  // Shows a small always-on-top prompt window (same pattern as the extension
  // popup in extensions-manager.js) asking the user to allow/block one
  // promptable permission for one hostname, and resolves once they answer.
  // Never times out on its own — closing the window without answering
  // (blur/close) resolves to a denial, matching "dismissed" behavior in a
  // real browser's permission prompt.
  function promptSitePermission(ses, hostname, permission) {
    return new Promise((resolve) => {
      const lang = getData().settings.language || 'es';
      // Deliberately NOT `session: ses` (the requesting account's own
      // session) — that session has the account's extensions and the
      // adblock cosmetic-filter preload script registered on it (Ghostery's
      // registerPreloadScript applies session-wide, not per-frame-origin),
      // which would inject third-party content-manipulation code into this
      // trusted Allow/Deny prompt. A fresh, unique in-memory partition keeps
      // the prompt fully isolated from anything the account's page can reach.
      const promptSession = session.fromPartition(`permission-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const popup = createAnchoredPopup(getMainWindow, {
        width: 380,
        height: 150,
        anchor: 'top-center',
        windowOptions: {
          minimizable: false,
          maximizable: false,
          backgroundColor: '#1b1f2a',
          webPreferences: { session: promptSession, preload: PERMISSION_PROMPT_PRELOAD, sandbox: true, contextIsolation: true }
        }
      });
      let settled = false;
      const finish = (decision, remember) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener('permission-prompt:respond', onRespond);
        if (!popup.isDestroyed()) popup.close();
        resolve({ decision, remember: !!remember });
      };
      const onRespond = (event, payload) => {
        if (event.sender !== popup.webContents) return;
        finish(payload?.decision === 'allow' ? 'allow' : 'deny', payload?.remember);
      };
      ipcMain.on('permission-prompt:respond', onRespond);
      popup.on('closed', () => finish('deny', false));
      popup.loadFile(PERMISSION_PROMPT_HTML, {
        query: {
          msg: mt(lang, 'permission.promptMsg', { hostname, permission: mt(lang, `permission.${permission}`) }),
          allowLabel: mt(lang, 'permission.allowLabel'),
          denyLabel: mt(lang, 'permission.denyLabel'),
          rememberLabel: mt(lang, 'permission.rememberLabel')
        }
      });
    });
  }

  function applyPermissionHandler(ses, account) {
    // Re-read account.url on every check instead of capturing it once at
    // wiring time — this handler is installed exactly once per webview
    // (see wireAccountWebContents's guard in main.js), but account.url is a
    // live field mutated in place on every real navigation. Capturing
    // isGameAccount as a single boolean here would freeze it to whatever
    // the account's very first URL was for the rest of that view's life,
    // silently stopping the game's camera/geolocation denial (or wrongly
    // keeping it) after the same tab navigates somewhere else.
    const isGameAccount = () => !!(account && account.url && gameTelemetry.isGameUrl(account.url));
    const alwaysDenied = (permission) => !ALLOWED_PERMISSIONS.has(permission) || (isGameAccount() && GAME_DENIED_PERMISSIONS.has(permission));
    let pendingPrompts = 0;
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (alwaysDenied(permission)) return callback(false);
      if (!PROMPTABLE_PERMISSIONS.has(permission)) return callback(true);
      const hostname = hostnameFromUrlLike(details?.requestingUrl);
      const stored = getSitePermissionDecision(hostname, permission);
      if (stored === 'allow') return callback(true);
      if (stored === 'deny') return callback(false);
      // Cap concurrent prompt windows per session — a page that hammers
      // getUserMedia in a loop shouldn't be able to spawn unbounded windows.
      if (pendingPrompts >= 3) return callback(false);
      pendingPrompts++;
      promptSitePermission(ses, hostname, permission)
        .then(({ decision, remember }) => {
          if (remember) setSitePermissionDecision(hostname, permission, decision);
          callback(decision === 'allow');
        })
        .finally(() => { pendingPrompts--; });
    });
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (alwaysDenied(permission)) return false;
      if (!PROMPTABLE_PERMISSIONS.has(permission)) return true;
      const hostname = hostnameFromUrlLike(requestingOrigin);
      return getSitePermissionDecision(hostname, permission) === 'allow';
    });
  }

  function registerIpcHandlers() {
    ipcMain.handle('permissions:getSitePermissions', () => getSitePermissions());
    ipcMain.handle('permissions:revoke', (_e, { hostname, permission }) => {
      const sp = getSitePermissions();
      if (sp[hostname]) {
        delete sp[hostname][permission];
        if (Object.keys(sp[hostname]).length === 0) delete sp[hostname];
      }
      persist();
      broadcastState();
      return getSitePermissions();
    });
    ipcMain.handle('permissions:clearAll', () => {
      getData().settings.sitePermissions = {};
      persist();
      broadcastState();
      return getSitePermissions();
    });
  }

  return { applyPermissionHandler, getSitePermissions, registerIpcHandlers };
}

module.exports = { createPermissionsManager, ALLOWED_PERMISSIONS, GAME_DENIED_PERMISSIONS, PROMPTABLE_PERMISSIONS };
