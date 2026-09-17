// @ts-check
const { app, BrowserWindow, ipcMain, session, Menu, shell, dialog, clipboard, Notification, net, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { MIN_SPLIT_FRAC, cellsForMode, freeCells, normalizeFracsWithMin } = require('./layout-utils');
const gameTelemetry = require('./game-telemetry');
const pokeFormulas = require('./poke-formulas');
const networkHealth = require('./network-health');
const powerManager = require('./power-manager');
const gameConnectionManager = require('./game-connection-manager');
const dnsTest = require('./dns-test');
const translate = require('./translate');
const memoryOptimizer = require('./memory-optimizer');
const pipPlayer = require('./pip-player');
const elementPicker = require('./element-picker');
const { classifyCrash, shouldFallBackToSoftwareRendering } = require('./crash-classifier');
const { pruneCrashDumps, pruneNetLogs } = require('./crash-dumps');
const diagnostics = require('./diagnostics');
const { normalizeAddressInput } = require('./address-bar');
// CSV parsing for the password importer lives in ./csv for the same reason —
// pure logic over a file the user was handed by another program.
const { parseCsv } = require('./csv');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
// Catálogo único de traducciones compartido con el renderer — ver el comentario
// de cabecera en src/i18n-data.js. El proceso main no tiene sandbox, así que
// requerir un archivo bajo src/ funciona igual que con game-telemetry.js.
const I18N = require('../src/i18n-data.js');
function mt(lang, key, vars) {
  let str = (I18N[lang] && I18N[lang][key]) ?? I18N.es[key] ?? key;
  // replaceAll por el mismo motivo documentado en t() (src/renderer.js).
  if (vars) for (const k of Object.keys(vars)) str = str.replaceAll(`{${k}}`, vars[k]);
  return str;
}

// Maps Nexa's UI language ('es' / 'pt-BR' / 'en-US') to the Chromium spellcheck
// locale Electron actually ships a dictionary for. Previously hardcoded to
// ['es-419', 'en-US'] for every account regardless of settings.language —
// loading dictionaries for languages the user never chose. en-US stays as a
// secondary everywhere except when it's already the primary, since loanwords
// and game terms in es/pt-BR text are commonly English.
const SPELLCHECK_LOCALES = { es: 'es-419', 'pt-BR': 'pt-BR', 'en-US': 'en-US' };
function spellCheckerLanguagesFor(lang) {
  const primary = SPELLCHECK_LOCALES[lang] || 'es-419';
  return primary === 'en-US' ? [primary] : [primary, 'en-US'];
}

// Terminal-only console.log, captured before the Object.assign below
// overwrites the global console — used for the per-page console-message
// forwarder (see wireAccountWebContents), which is pure page noise (Cloudflare
// Turnstile debug spam, WebGL/WebGPU warnings from the game's own pages) and
// would otherwise flood main.log until it's all that's left after rotation.
const nativeConsoleLog = console.log.bind(console);

// Redirects every existing console.log/warn/error call (main process) to
// electron-log's file transport (with rotation) in addition to the terminal —
// no need to touch the hundreds of call sites already scattered through this
// file. Log file lives under app.getPath('userData')/logs/main.log.
log.initialize();
Object.assign(console, log.functions);

// Native crash dumps (a full crash — process died, not a caught JS
// exception electron-log above already covers) — local-only on purpose:
// uploadToServer:false means nothing ever leaves the machine, no third-
// party service, no consent/privacy dialog needed. This app stores
// passwords (encrypted) and game-account data, so a Sentry-style
// auto-upload-by-default service wasn't the right default here. Dumps land
// in userData/crashDumps as .dmp files (Windows minidump format) — not
// human-readable on their own, but real ones to hand over if a user
// reports a crash and can zip that folder. app.setPath must run before
// crashReporter.start() picks up the default location.
const CRASH_DUMPS_DIR = path.join(app.getPath('userData'), 'crashDumps');
app.setPath('crashDumps', CRASH_DUMPS_DIR);
crashReporter.start({ uploadToServer: false, compress: true });
// crashReporter itself never prunes its own output — without this, .dmp
// files pile up in CRASH_DUMPS_DIR forever. Only runs once per app launch,
// so it's cheap even though it walks the whole (normally tiny) folder.
pruneCrashDumps(CRASH_DUMPS_DIR);
// Same once-per-launch cleanup for the netlog captures diagnostics:startNetLog
// writes (up to 20MB each, straight into userData) — nothing deleted them
// before, unlike the crash dumps right above.
pruneNetLogs(app.getPath('userData'));
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
// The NSIS differential updater shells out to a PowerShell helper script to
// apply the incremental patch — confirmed live: on a machine where the
// PowerShell execution policy blocks unsigned scripts, that step fails
// silently ("no está firmado digitalmente... no se puede ejecutar este
// script") and the update never gets past download, so 'update-downloaded'
// (and our changelog modal) never fires. Disabling differential downloads
// makes every update a full re-download instead of an incremental patch —
// slower and more bandwidth, but it skips that PowerShell step entirely.
// Reliability over savings for an app this size.
autoUpdater.disableDifferentialDownload = true;

// Last-resort net: an ipcMain.on (not .handle) listener that throws crashes the
// whole app with no trace, since Electron only auto-catches .handle rejections.
// This doesn't replace validating payloads at each handler — it's a backstop
// for whatever the per-handler guards miss, so a bad message loudly logs
// instead of silently killing every open account at once.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

const { hostnameFromUrlLike, isAllowedBookmarkUrl } = require('./url-utils');

// Popup destination policy (POPUP_ALLOWED_HOSTS + hostMatchesPopupAllowlist)
// lives in ./popup-policy so a unit test can reach it without booting
// Electron — same reasoning as url-utils.js and address-bar.js.
const { hostMatchesPopupAllowlist } = require('./popup-policy');

// app.getPath('userData') is derived from package.json's "name" field
// ("nexa-browser" since the rebrand) — do not change that field again without
// a migration step, or existing spaces/accounts/passwords/extensions become
// invisible to the app (new empty folder, old one orphaned). The data file
// itself went through exactly this migration — see LEGACY_DATA_FILE in store.js.
// Only ever read/written when data.settings.translateMemoryPersist is on
// (see app.whenReady and 'before-quit' below) — off by default.
const TRANSLATE_MEMORY_FILE = path.join(app.getPath('userData'), 'translate-memory.json');
// Value shape: { count, lastAt }. A crash from long ago shouldn't count
// against an account that's been stable since — without decay, a account
// that crashed 3 times weeks ago and has run fine ever since immediately
// hits the "giving up on auto-reload" ceiling on its very next crash,
// indistinguishable from an account crash-looping right now.
const crashCounts = new Map();
const CRASH_DECAY_MS = 30 * 60 * 1000; // 30 stable minutes resets the count

function getCrashCount(accountId) {
  const entry = crashCounts.get(accountId);
  if (!entry) return 0;
  if (Date.now() - entry.lastAt > CRASH_DECAY_MS) {
    crashCounts.delete(accountId);
    return 0;
  }
  return entry.count;
}

function recordCrash(accountId) {
  const count = getCrashCount(accountId) + 1;
  crashCounts.set(accountId, { count, lastAt: Date.now() });
  return count;
}
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

// Exactly the same arrangement, for exactly the same reason, applied to the
// other secret this app stores: account.proxy.password. store.js already
// encrypts it at rest (decryptAccountProxies), but the decrypted value was
// then written straight back onto data.accounts — and `data` is what
// broadcastState() hands the renderer wholesale on every single change, so
// every account open/close/rename re-sent every proxy password in plain text.
// That is the exact problem passwordSecrets exists to solve, and this field
// was simply never brought into it. Keyed by account id; the real value only
// leaves here for applyProxy's own login callback (main process, never
// crosses IPC) and for the one channel the account editor calls on demand.
const proxySecrets = new Map();

function getProxyPassword(accountId) {
  return proxySecrets.get(accountId) || '';
}

// Mirrors the shape store.js/applyProxy expect, with the real secret merged
// back in — for the two places that legitimately need it and nowhere else.
function accountWithProxySecret(account) {
  if (!account || !account.proxy) return account;
  return { ...account, proxy: { ...account.proxy, password: getProxyPassword(account.id) } };
}

const { createAdblockManager } = require('./adblock-manager');
const adblockManager = createAdblockManager({
  getData: () => data,
  persist: () => persist(),
  broadcastState: () => broadcastState(),
  getAccount: (id) => getAccount(id)
});
const { applyAdBlock, loadAdBlockEngine, rebuildAdBlockEngine, resetPageAdBlockStats, flushAdBlockStatsPersist } = adblockManager;
const { injectFpsOverlay, setFpsOverlayVisible, injectPingOverlay, setPingOverlayVisible } = require('./overlay-manager');

function isAllowedExternalSupportUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)paypal\.com$/i.test(parsed.hostname) || /(^|\.)paypal\.me$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

const { createPermissionsManager } = require('./permissions-manager');
const permissionsManager = createPermissionsManager({
  getData: () => data,
  persist: () => persist(),
  broadcastState: () => broadcastState(),
  mt,
  getMainWindow: () => mainWindow
});
const { applyPermissionHandler } = permissionsManager;

const proxyAuthWired = new WeakSet();

function applyProxy(ses, account) {
  if (!proxyAuthWired.has(ses)) {
    proxyAuthWired.add(ses);
    ses.on('login', (event, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return; // leave the site's own HTTP auth prompt alone
      event.preventDefault();
      // Read from proxySecrets at call time, not from account.proxy — the
      // password no longer lives on the account object (see proxySecrets).
      // Call time also means a password changed mid-session is picked up
      // without re-wiring this listener.
      if (account.proxy && account.proxy.username) {
        callback(account.proxy.username, getProxyPassword(account.id));
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
// No custom UA override for account webviews — confirmed live, twice, that
// this is what was still breaking Cloudflare Turnstile after the <webview>
// migration. webContents.setUserAgent() only rewrites the UA header and
// navigator.userAgent; it does NOT update navigator.userAgentData (Client
// Hints), which Chromium keeps deriving from the real build regardless. Any
// hand-built override — including a careful one that "freezes" the version
// the same way real Chrome does — creates exactly the
// userAgent/userAgentData mismatch Turnstile's server-side check is built
// to catch. Electron's own honest, unmodified UA (which does say
// "Electron/...") does not trip it at all: internal consistency matters
// more than looking like Chrome. Left un-overridden on purpose; do not
// reintroduce a UA spoof here without live-testing the actual login again.

const ACCOUNT_PRELOAD_PATH = path.join(__dirname, 'account-preload.js');
// <webview>'s `preload` attribute wants a URL, not a bare filesystem path —
// this is what both the main renderer and popout.html actually set it to.
const ACCOUNT_PRELOAD_URL = require('url').pathToFileURL(ACCOUNT_PRELOAD_PATH).href;
function accountPartition(accountId) {
  return `persist:account-${accountId}`;
}

// Wipes one account's browsing data (cookies, storage, cache) and reloads its
// page — i.e. logs it out. Three call sites wanted exactly this: the
// account:clearSession IPC handler, the account context menu's "Borrar datos
// de sesión", and the Ctrl+Shift+Supr shortcut, each with its own copy of the
// same five lines. Resolves the session whether or not the account is
// currently open, since a closed account still has its partition on disk.
async function clearAccountSessionData(accountId) {
  const wc = views.get(accountId);
  const ses = wc && !wc.isDestroyed() ? wc.session : session.fromPartition(accountPartition(accountId));
  await ses.clearStorageData();
  await ses.clearCache();
  if (wc && !wc.isDestroyed()) wc.reload();
}

const RAIL_WIDTH = 56;
const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 64;
const TOPBAR_HEIGHT = 44;
const STATUSBAR_HEIGHT = 26;
const PANEL_HEADER_HEIGHT = 30;
// GAP, GRID_MAX_PANELS, MIN_SPLIT_FRAC, resolveFracs, cellsForMode, freeCells
// and normalizeFracsWithMin now live in ./layout-utils (required above) so
// they can be unit-tested without launching the app — see test/unit/.

/** @type {BrowserWindow|null} */
let mainWindow = null;
// A destroyed BrowserWindow is still a truthy JS object — `if (mainWindow)`
// alone doesn't catch it, which is exactly what let an uncaught
// "Object has been destroyed" TypeError (via mainWindow.getContentSize() in
// contentBounds(), reached from a webContents 'destroyed' listener that fired
// during app shutdown) crash the whole process. Use this everywhere instead.
function mainWindowAlive() {
  return !!mainWindow && !mainWindow.isDestroyed();
}
// La misma comprobacion, pero devolviendo la ventana (o null) en vez de un
// booleano: TypeScript no puede estrechar `mainWindow` a traves de una
// llamada a mainWindowAlive(), asi que el codigo que usa la ventana despues
// del chequeo la toma de aca.
/** @returns {BrowserWindow|null} */
function liveMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}
// Para dialogos que solo se abren a pedido de la propia ventana principal
// (IPC de su renderer, menu contextual de una cuenta que vive dentro de
// ella): ahi la ventana existe por construccion. Si alguna vez no, falla con
// un error con nombre en vez de un TypeError generico, mismo criterio que
// el() en renderer.js.
/** @returns {BrowserWindow} */
function requireMainWindow() {
  const win = liveMainWindow();
  if (!win) throw new Error('[main] la ventana principal no existe o ya se destruyo');
  return win;
}
let appQuitting = false;
let data = store.load();
// Computed after app.whenReady() (safeStorage's OS-keychain backend isn't
// reliably available before that) — see the app.whenReady() block below.
let passwordEncryptionAvailable = true;

// Real health state for the auto-updater — previously a failed check only
// ever hit console.error, invisible to the user (and to Configuración >
// Acerca de, which just shows the static installed version regardless).
// 'idle' before the very first check ever runs (dev, or hasn't reached
// app.whenReady() yet).
/** @type {{ state: string, lastError: string|null, lastCheckedAt: number|null }} */
let updateStatus = { state: 'idle', lastError: null, lastCheckedAt: null };

// Always start on auto grid, regardless of whichever layout was active when the
// app was last closed — the user wants a consistent, predictable starting layout.
data.settings.layoutMode = 'grid';

// settings.reopenLastSpace ("Reabrir el último espacio al iniciar", on by
// default) now actually does something. It had a toggle in Configuración,
// translations in all three languages, an entry in the settings whitelist and
// was persisted on every change — but nothing ever READ it, so the app always
// reopened the last space regardless. currentSpaceId is persisted, which is
// what made the "on" behaviour work by accident and the "off" position a
// no-op. Turning it off now starts in the first (pinned) space instead, which
// is the only thing "don't reopen the last one" can reasonably mean here.
if (data.settings.reopenLastSpace === false && data.spaces.length > 0) {
  data.settings.currentSpaceId = data.spaces[0].id;
  data.settings.activeAccountId = null;
  data.settings.maximizedAccountId = null;
}
const disableHardwareAccelerationForTest = process.env.NEXA_E2E === '1';
const forceSoftwareRendering = disableHardwareAccelerationForTest || process.env.NEXA_FORCE_SOFTWARE === '1';

// Must run before app.whenReady() — can't be toggled live, only at the next launch.
if (forceSoftwareRendering || data.settings.hardwareAcceleration === false) {
  app.disableHardwareAcceleration();
}

// Electron ships its own, fixed copy of Chromium's GPU allow/block-list —
// unlike a real installed Chrome, which auto-updates that list independently
// of the browser version. Some machines show WebGL "INVALID_ENUM:
// getInternalformatParameter" spam with hardwareAcceleration correctly
// enabled, matching this Electron version's bundled GPU block-list
// rejecting a driver/GPU combination Chrome's own, separately-updated list
// already allows. --ignore-gpu-blocklist is Chromium's own standard flag
// for exactly that mismatch — it does not disable or weaken any actual
// capability check, only stops the static list from vetoing hardware the
// driver itself supports. NOTE: this is unrelated to the Turnstile 600010
// login bug — that one turned out to be caused by the WebContentsView API
// itself (see wireAccountWebContents below, and the plan doc, for the full
// diagnosis and the migration to <webview>); WebGL/WebGPU console noise on
// this specific dev machine was a red herring, unaffected by any GPU flag
// tried.
//
// Stability-overhaul audit (Etapa 7): re-examined against the "no
// experimental Chromium flags without justification" rule. Conclusion: KEEP
// — this isn't experimental, it's Chromium's own standard flag for a
// documented, narrow purpose (an outdated static block-list vs. a driver the
// GPU vendor itself supports), it doesn't disable or weaken any real
// capability/security check, and removing it would silently regress the
// original WebGL bug it fixed. Revert instruction if this is ever
// reconsidered: delete the appendSwitch line below; no other state depends
// on it.
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Chromium's own "Intensive Wake Up Throttling" clamps repeated setInterval/
// chained setTimeout to at most ~once/minute in a page that's been
// backgrounded for a few minutes — a SEPARATE mechanism from
// webContents.setBackgroundThrottling() (see syncBackgroundThrottling
// above), which mainly governs rAF/compositor throttling and does NOT
// override this one. That's exactly consistent with the reported symptom:
// an account works fine for a while, then "se pega" and the game shows its
// own reconnect banner a few hours later, specifically on the account that
// isn't the visible panel — the game's WebSocket keepalive/ping is a
// repeated timer, gets clamped to once/minute, the server times the
// connection out from its side, and the game's own client only then
// notices and reconnects. These three switches are Chromium's standard,
// documented way to fully opt a whole app out of every layer of
// background-tab throttling (timer clamping, renderer backgrounding,
// occluded-window backgrounding) — not experimental flags, and exactly
// what several other Electron apps with the same "many always-on
// background tabs" shape (chat clients, dashboards) apply for this reason.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// On a hybrid-graphics machine (a dedicated GPU alongside integrated
// graphics — common on laptops, but also plenty of desktops with both a
// discrete card and the CPU's built-in one), Chromium's default GPU
// selection is not guaranteed to pick the dedicated one. Confirmed live on
// this exact machine (NVIDIA RTX 2060 + AMD integrated): without this flag,
// Electron's own app.getGPUInfo('complete') reported
// glRenderer "ANGLE (AMD ... Radeon(TM) Graphics ...)" — the weaker
// integrated GPU — even with hardwareAcceleration on. Adding
// --force_high_performance_gpu (Chromium's own standard switch for exactly
// this hybrid-graphics case, not an experimental flag) flipped it to
// glRenderer "ANGLE (NVIDIA ...)" on the same run. Only applied when
// hardware acceleration is actually enabled — forcing a specific GPU means
// nothing once rendering is already software-only.
if (!forceSoftwareRendering && data.settings.hardwareAcceleration !== false) {
  app.commandLine.appendSwitch('force_high_performance_gpu');
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
    /** @type {{ dllPath: string, version: string, source: string, browserVersion: string }|null} */
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
// Read straight from Electron/package.json instead of a hand-maintained
// literal — a hardcoded string here (and a second one in preload.js's
// getVersions()) went stale for multiple releases in a row before this,
// always showing an old version in Configuración → Acerca de regardless of
// what was actually installed.
const APP_VERSION = app.getVersion();

// Reset "online since" timers for accounts that aren't closed — elapsed time is per app session.
data.accounts.forEach((a) => {
  if (!a.closed) a.openedAt = Date.now();
});

/** @type {Map<string, Electron.WebContents>} accountId → the guest <webview>'s webContents */
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
/** @type {NodeJS.Timeout|null} */
let persistTimer = null;
let persistDirty = false;
// store.save() is async now (see store.js) — this tracks the promise of
// whatever write is currently running so flushPersist() can actually wait
// for it instead of returning before the data has landed on disk.
/** @type {Promise<void>|null} */
let persistInFlight = null;

// store.js's save() still expects each password entry to carry its real
// `password` field (it's the one that encrypts it before writing to disk) —
// this merges passwordSecrets back in for the copy that actually gets
// written, without ever putting the secret back onto the live `data` object.
// Flipped once the post-whenReady decrypt below has actually populated
// passwordSecrets. Until then passwordSecrets is empty, so the mapping in
// dataForPersist() would turn EVERY stored password into '' — and store.js
// would write those over the real ciphertext. Nothing is expected to persist
// that early, but a crash/quit during startup is exactly when you'd least
// want to lose every saved password, so this doesn't rely on that.
let passwordSecretsReady = false;
// Same flag, same reason, for proxySecrets (see dataForPersist).
let proxySecretsReady = false;

function dataForPersist() {
  // data.passwords / account.proxy still carry their on-disk `password` field
  // verbatim until the decrypt step strips it, and store.js's
  // encryptPassword() is idempotent for already-encrypted values, so passing
  // them through untouched here is safe.
  if (!passwordSecretsReady && !proxySecretsReady) return { ...data };
  return {
    ...data,
    passwords: passwordSecretsReady
      ? data.passwords.map((p) => ({ ...p, password: passwordSecrets.get(p.id) || '' }))
      : data.passwords,
    // Merges the proxy secret back in for the copy that gets written, without
    // ever putting it back on the live `data` object — same split as passwords.
    accounts: proxySecretsReady ? data.accounts.map(accountWithProxySecret) : data.accounts
  };
}

// Opt-in timing log (NEXA_PERF_LOG=1 in the environment) for measuring the
// real effect of the perf work above/below instead of guessing — silent by
// default so normal use doesn't add a line to main.log on every write.
const PERF_LOG = !!process.env.NEXA_PERF_LOG;
function runPersistSave(label) {
  const startedAt = Date.now();
  return store.save(dataForPersist())
    .then(() => {
      if (PERF_LOG) console.log(`[perf] ${label} store.save() took ${Date.now() - startedAt}ms`);
    })
    .catch((err) => {
      console.error(`[main] ${label} write failed`, err);
    });
}

function persist() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) {
      persistDirty = false;
      persistInFlight = runPersistSave('persist()');
    }
  }, PERSIST_DEBOUNCE_MS);
}

// Called on quit (see 'before-quit' below), which now actually awaits this —
// store.save() no longer blocks the main thread while writing, so the only
// way to guarantee the last change lands on disk before the process exits is
// to wait for its promise instead of firing it and immediately quitting.
async function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistDirty) {
    persistDirty = false;
    persistInFlight = runPersistSave('flushPersist()');
  }
  if (persistInFlight) await persistInFlight;
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
  return mt(data.settings.language || 'es', 'main.defaultTabName', { n: position + 1 });
}

// Poke Idle World Fase C: native OS notifications for alert-worthy events
// already tracked as `state.lastEvent` in game-telemetry.js — this loop just
// diffs against the last event we already notified for per account (so a
// still-low ball count doesn't re-notify every 5s) and maps event type to a
// human message, gated by the toggles in data.settings.pokeIdleAlerts.
const notifiedEventAt = new Map();
function buildPokeIdleNotification(cfg, accountName, event) {
  const lang = data.settings.language || 'es';
  switch (event.type) {
    case 'shiny_capture':
      return cfg.shiny ? { title: mt(lang, 'notif.shinyCaptureTitle', { account: accountName }), body: event.payload?.name || '' } : null;
    case 'shiny_wild':
      return cfg.shiny ? { title: mt(lang, 'notif.shinyWildTitle', { account: accountName }), body: event.payload?.name ? mt(lang, 'notif.shinyWildBody', { name: event.payload.name }) : '' } : null;
    case 'rare_capture':
      return cfg.rare ? { title: mt(lang, 'notif.rareCaptureTitle', { account: accountName }), body: `${event.payload?.name || ''} (${event.payload?.rarity || ''})` } : null;
    case 'balls_low':
      return cfg.ballsLow ? { title: mt(lang, 'notif.ballsLowTitle', { account: accountName }), body: mt(lang, 'notif.ballsLowBody', { total: event.payload?.total ?? '?' }) } : null;
    case 'balls_out':
      return cfg.ballsLow ? { title: mt(lang, 'notif.ballsOutTitle', { account: accountName }), body: mt(lang, 'notif.ballsOutBody') } : null;
    case 'disconnected':
      return cfg.disconnect ? { title: mt(lang, 'notif.disconnectedTitle', { account: accountName }), body: mt(lang, 'notif.disconnectedBody') } : null;
    case 'reconnected':
      return cfg.disconnect ? { title: mt(lang, 'notif.reconnectedTitle', { account: accountName }), body: mt(lang, 'notif.reconnectedBody') } : null;
    default:
      return null;
  }
}

function startPokeIdleAlertLoop() {
  setInterval(() => {
    const cfg = data.settings.pokeIdleAlerts;
    if (!cfg || !cfg.enabled || !Notification.isSupported()) return;
    const stats = gameTelemetry.getAllStats();
    for (const [accountId, s] of Object.entries(stats)) {
      if (!s || !s.lastEvent) continue;
      const lastAt = notifiedEventAt.get(accountId) || 0;
      if (s.lastEvent.at <= lastAt) continue;
      notifiedEventAt.set(accountId, s.lastEvent.at);
      const account = getAccount(accountId);
      if (!account) continue;
      const notif = buildPokeIdleNotification(cfg, displayName(account), s.lastEvent);
      if (notif) {
        new Notification(notif).show();
        // Flashes the taskbar icon so a shiny/rare catch or a disconnect is
        // noticeable even when Nexa is minimized or behind another window —
        // Windows stops the flash on its own once the user focuses it back.
        const win = liveMainWindow();
        if (win && !win.isFocused()) win.flashFrame(true);
      }
    }
  }, 5000);
}

// Live DownloadItem handles, keyed by the same id as its `data.downloads`
// record — the item only exists as a closure variable inside 'will-download'
// otherwise, so pause/resume/cancel from the renderer has nothing to call
// without this. Cleared once a download finishes (success, cancel, or
// interruption); pause/resume/cancel only make sense while it's live.
const downloadItems = new Map();

// Tracks which Session objects already have a 'will-download' listener so
// re-opening an account (which reuses the same persist:account-N Session)
// doesn't accumulate duplicate listeners — each duplicate would create an
// extra data.downloads record and extra broadcastState() call per download.
const downloadSessionsWired = new WeakSet();

// Mirrors download progress onto the taskbar icon (Windows' native progress
// ring) so it's visible while Nexa is minimized or behind another window —
// aggregates every still-progressing download into one bar instead of only
// reflecting whichever item last fired an 'updated' event, since users can
// have several downloads running at once across different accounts.
function updateTaskbarProgress() {
  const win = liveMainWindow();
  if (!win) return;
  const active = data.downloads.filter((d) => d.state === 'progressing');
  if (active.length === 0) {
    win.setProgressBar(-1);
    return;
  }
  const allPaused = active.every((d) => d.paused);
  const received = active.reduce((sum, d) => sum + d.receivedBytes, 0);
  const total = active.reduce((sum, d) => sum + (d.totalBytes || 0), 0);
  if (total > 0) {
    win.setProgressBar(received / total, { mode: allPaused ? 'paused' : 'normal' });
  } else {
    win.setProgressBar(2, { mode: 'indeterminate' });
  }
}

function handleDownloads(ses) {
  if (downloadSessionsWired.has(ses)) return;
  downloadSessionsWired.add(ses);
  ses.on('will-download', (event, item) => {
    /** @type {string|null} */
    let savePath = null;
    if (data.settings.askDownloadLocation) {
      // Sin ventana principal el dialogo sale sin padre, igual que antes
      // cuando se le pasaba null.
      const win = liveMainWindow();
      const saveOptions = { defaultPath: item.getFilename() };
      const chosen = win ? dialog.showSaveDialogSync(win, saveOptions) : dialog.showSaveDialogSync(saveOptions);
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
      paused: false,
      startedAt: Date.now()
    };
    data.downloads.unshift(record);
    if (data.downloads.length > 200) data.downloads.length = 200;
    downloadItems.set(record.id, item);
    persist();
    broadcastState();
    updateTaskbarProgress();

    let lastBroadcast = 0;
    item.on('updated', (_e, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.state = state;
      record.paused = item.isPaused();
      const now = Date.now();
      if (now - lastBroadcast > 400) {
        lastBroadcast = now;
        broadcastState();
        // Same throttle as the broadcast right above — 'updated' can fire
        // many times a second on a fast connection, and this is a
        // synchronous native Windows taskbar call, not a free one.
        updateTaskbarProgress();
      }
    });

    item.on('done', (_e, state) => {
      record.state = state;
      record.paused = false;
      record.path = item.getSavePath() || record.path;
      record.receivedBytes = item.getReceivedBytes();
      downloadItems.delete(record.id);
      persist();
      broadcastState();
      updateTaskbarProgress();
    });
  });
}

const { createExtensionsManager } = require('./extensions-manager');
const extensionsManager = createExtensionsManager({
  getData: () => data,
  persist: () => persist(),
  broadcastState: () => broadcastState(),
  mt,
  getMainWindow: () => mainWindow,
  views
});
const { readManifest, extractExtensionAction } = extensionsManager;

const SPACE_COLORS = ['#4f8cff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#f06595', '#22b8cf'];
const SPACE_ICON_KEYS = ['grid', 'gamepad', 'swords', 'shield', 'flame', 'leaf', 'droplet', 'bolt', 'star', 'crown', 'ghost', 'rocket'];

const SHORTCUTS = [
  { combo: 'Ctrl + 1–9', key: 'shortcut.selectPanel' },
  { combo: 'Ctrl + Tab', key: 'shortcut.nextPanel' },
  { combo: 'Ctrl + Shift + N', key: 'shortcut.newSpace' },
  { combo: 'Ctrl + N', key: 'shortcut.newAccount' },
  { combo: 'Ctrl + R / F5', key: 'shortcut.reloadActive' },
  { combo: 'Ctrl + Shift + R / Shift + F5', key: 'shortcut.reloadHardActive' },
  { combo: 'Ctrl + Alt + R', key: 'shortcut.reloadAll' },
  { combo: 'Ctrl + M', key: 'shortcut.muteActive' },
  { combo: 'Ctrl + Shift + M', key: 'shortcut.muteAll' },
  { combo: 'Ctrl + L', key: 'shortcut.focusAddress' },
  { combo: 'Ctrl + F', key: 'shortcut.findInPage' },
  { combo: 'Ctrl + / Ctrl -', key: 'shortcut.zoomInOut' },
  { combo: 'Ctrl + 0', key: 'shortcut.zoomReset' },
  { combo: 'F11', key: 'shortcut.fullscreen' },
  { combo: 'Ctrl + ,', key: 'shortcut.settings' },
  { combo: 'Ctrl + K', key: 'shortcut.commandPalette' },
  { combo: 'Ctrl + W', key: 'shortcut.closeActive' },
  { combo: 'Ctrl + Shift + T', key: 'shortcut.reopenClosed' },
  { combo: 'F12', key: 'shortcut.openDevTools' },
  { combo: 'Ctrl + Alt + T', key: 'shortcut.toggleChatAutoTranslate' },
  { combo: 'Ctrl + B', key: 'shortcut.toggleSidebar' },
  { combo: 'Ctrl + D', key: 'shortcut.bookmarkPage' },
  { combo: 'Ctrl + Shift + Supr', key: 'shortcut.clearSessionData' },
  { combo: 'Ctrl + C', key: 'shortcut.copy' },
  { combo: 'Ctrl + V', key: 'shortcut.paste' }
];

let lastClosedAccountId = null;

// Games this app already knows the chat DOM for (CHAT_SITE_SELECTORS in
// translate.js) get chat auto-translate on from the moment the account is
// created — confirmed live this matters on sites that block their own
// contextmenu event (baiakidle.com): showPageContextMenu's toggle and the
// Ctrl+Alt+T fallback shortcut both never fire on a page the user hasn't
// interacted with yet, so a brand-new account pointed at a known game would
// otherwise sit untranslated until the user discovered either workaround.
// Only ever used to pick the INITIAL value — once chatAutoTranslate is a
// real boolean (set here, via the toggle, or via the shortcut) it's never
// silently overridden again, so a user's explicit "off" always sticks.
// Shared by every chat-related hostname lookup (defaultChatAutoTranslate,
// toggleChatAutoTranslate, showPageContextMenu's chat-toggle gate,
// translateChatMessages) — used to be independently reimplemented at each
// call site. NOT the same as the pre-existing hostnameOf() helper further
// down this file: that one strips a leading "www." for its own callers,
// which would silently break matching against CHAT_SITE_SELECTORS'
// 'www.ragnaidle.com.br' key.
function chatHostnameOf(url) {
  try { return new URL(url || '').hostname; } catch { return ''; }
}

function defaultChatAutoTranslate(url) {
  try {
    return !!translate.chatSelectorsForHost(chatHostnameOf(url));
  } catch {
    return false;
  }
}

function quickAddAccount() {
  const space = getCurrentSpace();
  const url = space?.defaultUrl || data.settings.defaultStartUrl || 'about:blank';
  const account = {
    id: crypto.randomUUID(),
    name: null,
    url,
    spaceId: space?.id || 'default',
    color: null,
    openedAt: Date.now(),
    chatAutoTranslate: defaultChatAutoTranslate(url)
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
    name: mt(data.settings.language || 'es', 'main.defaultSpaceName', { n: data.spaces.length + 1 }),
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

// The five layout modes the UI actually offers (index.html's data-mode
// buttons) — layout:set used to persist whatever string it was handed, so a
// bad value ended up in data.json and every consumer fell through to its
// grid/single default with no explanation. layout:setSplit right below
// already validated its own `field` this way.
const LAYOUT_MODES = new Set(['single', 'columns', 'rows', 'grid', 'free']);

// Any URL that will later be handed to loadURL() as a *default* — the app-wide
// defaultStartUrl and each space's defaultUrl. Both were previously stored
// unvalidated (defaultStartUrl through settings:update's whitelist, defaultUrl
// through importSpaces' object spread) even though account.url, which reaches
// exactly the same loadURL(), has always been sanitized. http/https only,
// matching isAllowedBookmarkUrl's rule for the same reason: file://,
// javascript: and data: have no business being a start page.
const DEFAULT_START_URL = 'https://poke.idleworld.online/login';
function safeStartUrl(url, fallback = 'https://www.google.com') {
  const raw = String(url ?? '').trim();
  if (!raw) return fallback;
  if (isAllowedBookmarkUrl(raw)) return raw;
  const prefixed = `https://${raw}`;
  return isAllowedBookmarkUrl(prefixed) && !/\s/.test(raw) ? prefixed : fallback;
}

// Chromium's own usable range, and the same clamp the Ctrl+/Ctrl- shortcut
// has always applied. The IPC zoom handlers didn't clamp at all, so a zoom
// menu value (or any other caller) could hand setZoomFactor() a 0, a negative
// or a NaN — none of which it handles gracefully, and all of which persist.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
function clampZoom(factor, fallback = 1) {
  const n = Number(factor);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
}

function adjustZoom(id, delta) {
  const account = getAccount(id);
  if (!account) return;
  const current = account.zoom || data.settings.defaultZoom || 1;
  const next = Math.max(0.5, Math.min(2, Math.round((current + delta) * 100) / 100));
  account.zoom = next;
  const view = views.get(id);
  if (view) view.setZoomFactor(next);
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

function setZoomDirect(id, factor) {
  const account = getAccount(id);
  if (!account) return;
  const zoom = clampZoom(factor, account.zoom || 1);
  account.zoom = zoom;
  const view = views.get(id);
  if (view) view.setZoomFactor(zoom);
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

function toggleMuteAccount(id) {
  const account = getAccount(id);
  if (!account) return;
  account.muted = !account.muted;
  views.get(id)?.setAudioMuted(account.muted);
  persist();
  broadcastGeometryOnly();
  broadcastState();
}

// Shared by showPageContextMenu's context-menu item and the Ctrl+Alt+T
// shortcut in handleAccountShortcut — used to be copy-pasted in both
// places, which is exactly how a real bug shipped once already (the
// shortcut handler collided with an unrelated pre-existing Ctrl+Shift+T
// binding, confirmed live). One function means one place to fix next time.
function toggleChatAutoTranslate(wc, accountId) {
  const account = getAccount(accountId);
  if (!account) return;
  if (!translate.chatSelectorsForHost(chatHostnameOf(wc?.getURL()))) return;
  account.chatAutoTranslate = !account.chatAutoTranslate;
  if (!account.chatAutoTranslate) chatUserLanguageHistory.delete(accountId);
  persist();
  broadcastState();
}

function toggleMuteAllAccounts() {
  const muted = !data.settings.allMuted;
  data.accounts.forEach((a) => {
    a.muted = muted;
  });
  for (const view of views.values()) view.setAudioMuted(muted);
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
    liveMainWindow()?.webContents.send('findbar:open', { id: account.id });
    return true;
  }
  if (key === 'escape') {
    view?.stopFindInPage('clearSelection');
    liveMainWindow()?.webContents.send('findbar:close', { id: account.id });
    return false; // let Escape still propagate normally for anything else on the page
  }
  if (ctrl && !shift && !alt && /^[1-9]$/.test(key)) {
    liveMainWindow()?.webContents.send('shortcut:selectPanel', { n: Number(key) });
    return true;
  }
  if (ctrl && !shift && !alt && key === 'tab') {
    liveMainWindow()?.webContents.send('shortcut:nextPanel');
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
    view?.reloadIgnoringCache();
    return true;
  }
  if (ctrl && !shift && alt && key === 'r') {
    openAccountsInCurrentSpace().forEach((a) => views.get(a.id)?.reload());
    return true;
  }
  if (ctrl && !shift && !alt && key === 'r') {
    view?.reload();
    return true;
  }
  // F5 does nothing on its own in a <webview> guest — there's no
  // Application Menu (Menu.setApplicationMenu(null)) to supply the usual
  // "reload" accelerator a real browser gets for free, so it silently no-op'd
  // until now. Same combo convention as Ctrl+R / Ctrl+Shift+R above.
  if (!ctrl && !alt && key === 'f5') {
    if (shift) view?.reloadIgnoringCache();
    else view?.reload();
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
    liveMainWindow()?.webContents.send('shortcut:focusAddress');
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
    // liveMainWindow(), not a bare call: this handler runs off a webview's
    // before-input-event, which can still fire while the window is being torn
    // down — and a destroyed BrowserWindow is a truthy object whose methods
    // throw (see mainWindowAlive's own comment for the crash that taught us).
    const win = liveMainWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
    return true;
  }
  // Some games call preventDefault() on their own contextmenu event to
  // block right-click entirely (confirmed live on baiakidle.com — anti-
  // inspect, not a bug) — that also swallows Nexa's own 'Inspeccionar'
  // context-menu item, since wc.on('context-menu', ...) only ever fires
  // when Chromium's native menu request goes through. before-input-event
  // fires at the native/browser-process level BEFORE the page's own JS
  // ever sees the keystroke, so F12 reaches openDevTools() here regardless
  // of what the page does with keydown — the one reliable way in this app
  // to open DevTools on a page that blocks the usual route.
  if (!ctrl && !shift && !alt && key === 'f12') {
    view?.openDevTools({ mode: 'detach' });
    return true;
  }
  // Same contextmenu-blocked-site problem as F12 above: the only other way
  // to flip account.chatAutoTranslate is showPageContextMenu's own menu
  // item, which never gets a chance to appear on a page that calls
  // preventDefault() on its own contextmenu event (confirmed live on
  // baiakidle.com).
  // Ctrl+Alt+T, NOT Ctrl+Shift+T — that combo was already taken by
  // reopenLastClosedAccount() below. Confirmed live this was a real bug:
  // this handler runs first and unconditionally returns true, so it had
  // been silently swallowing every Ctrl+Shift+T on any page with known
  // chat selectors, making "reopen last closed account" unreachable there.
  if (ctrl && !shift && alt && key === 't') {
    toggleChatAutoTranslate(view, account.id);
    return true;
  }
  if (ctrl && !shift && !alt && key === ',') {
    liveMainWindow()?.webContents.send('shortcut:openSettings');
    return true;
  }
  if (ctrl && !shift && !alt && key === 'w') {
    // Unlike the accounts:close IPC path, this one isn't awaited by anything
    // — without a catch, a rejection here would surface only as a generic
    // process-level unhandledRejection with no hint of which account it was.
    closeAccountAndAdvance(account).catch((err) => console.error('[accounts] Ctrl+W close failed for', account.id, err));
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
    // isAllowedBookmarkUrl (not just !== 'about:blank') so this third path
    // into data.bookmarks applies the same http/https-only rule as the IPC
    // handler and the importer. Also skips duplicates: this fires on every
    // Ctrl+D, and it used to append another identical entry each time.
    if (isAllowedBookmarkUrl(account.url) && !data.bookmarks.some((b) => b.url === account.url)) {
      data.bookmarks.push({ id: crypto.randomUUID(), title: displayName(account), url: account.url });
      persist();
      broadcastState();
    }
    return true;
  }
  if (ctrl && shift && !alt && key === 'delete') {
    clearAccountSessionData(account.id).catch((err) => console.error('[session] Ctrl+Shift+Supr clear failed for', account.id, err));
    return true;
  }
  return false;
}

// Recomputed on every account open/close/navigate rather than polled — the
// powerSaveBlocker only needs to run while at least one non-closed account
// is actually sitting on the game (isGameUrl), gated behind the opt-in
// settings.stability.backgroundKeepalive flag (default off).
function refreshPowerBlockerNeed() {
  if (!data.settings.stability || !data.settings.stability.backgroundKeepalive) {
    powerManager.updateBlockerNeed(false);
    return;
  }
  const hasActiveGameAccount = data.accounts.some((a) => {
    if (a.closed) return false;
    const wc = views.get(a.id);
    return wc && !wc.isDestroyed() && gameTelemetry.isGameUrl(wc.getURL());
  });
  powerManager.updateBlockerNeed(hasActiveGameAccount);
}

// Only game pages need full-speed timers while hidden (the WS keepalive
// relies on it — see the backgroundThrottling=no comment where the
// <webview> is created in renderer.js). Everywhere else (an account sitting
// on /login, an OAuth screen, or any non-game URL) gets normal Chromium
// background throttling back, since a hidden panel with nothing time-
// sensitive running doesn't need its timers at full speed — cuts idle
// CPU/wake-ups proportional to how many open panels aren't actually
// farming. setBackgroundThrottling() takes effect immediately, no reload
// needed, unlike the webview's own initial `webpreferences` attribute.
// accountId is optional (existing call sites that don't have it handy still
// work — they just don't get the "is this the active panel" boost). When
// present, the currently active/frontmost panel always gets full-speed
// timers, not just game pages — so switching to a non-game account (a wiki
// tab, Discord, whatever) never feels laggy from Chromium's own background-
// tab throttling heuristics kicking in on a panel that's technically still
// part of the same window. This is a lighter touch than Modo Eco (which
// actively caps rAF) — it just makes sure nothing throttles the ONE panel
// the user is actually looking at, while backgrounded non-game panels keep
// normal throttling to free up CPU for it.
function syncBackgroundThrottling(wc, url, accountId) {
  if (!wc || wc.isDestroyed()) return;
  const isActive = accountId && data.settings.activeAccountId === accountId;
  wc.setBackgroundThrottling(!(gameTelemetry.isGameUrl(url) || isActive));
}

// Called whenever activeAccountId changes (see accounts:activate) so the
// panel losing focus goes back to normal throttling rules (unless it's a
// game, which stays exempt regardless — see syncBackgroundThrottling) and
// the panel gaining focus immediately gets the full-speed exemption instead
// of waiting for its next did-finish-load/did-navigate-in-page to re-sync.
function syncActiveThrottling(previousId, newId) {
  for (const id of [previousId, newId]) {
    if (!id) continue;
    const wc = views.get(id);
    if (!wc || wc.isDestroyed()) continue;
    syncBackgroundThrottling(wc, wc.getURL(), id);
  }
}

// Enforces a minimum gap between consecutive 'webview:ready' dispatches —
// only matters when several accounts attach in a tight burst (e.g. app
// startup restoring N saved accounts, whose webview elements all get created
// in the same synchronous forEach in renderer.js's reconcileWebviews()).
// Without this, every account's real navigation (its actual JS/CSS/images,
// not the about:blank placeholder) starts within the same instant — a real
// CPU/network spike confirmed live against sites like slumaworld.com (~30
// separate JS requests) and baiakidle.com (2 autoplay background videos) on
// their very first load. A single account opened on its own (not part of a
// startup burst) has no recent dispatch to stagger against, so `delay`
// comes out to 0 and it navigates exactly as before — zero added latency
// outside of a burst.
const WEBVIEW_READY_STAGGER_MS = 400;
let lastWebviewReadyAt = 0;
function scheduleWebviewReady(hostWebContents, accountId) {
  const now = Date.now();
  const delay = Math.max(0, lastWebviewReadyAt + WEBVIEW_READY_STAGGER_MS - now);
  lastWebviewReadyAt = now + delay;
  setTimeout(() => {
    if (!hostWebContents.isDestroyed()) hostWebContents.send('webview:ready', accountId);
  }, delay);
}

// Fire-and-forget DNS+TCP+TLS warmup for an account about to navigate.
// wireAccountWebContents calls this right before scheduleWebviewReady, so
// the real navigation (which only happens once the renderer gets
// 'webview:ready', after the stagger delay above) gets a head start on the
// network round-trip instead of starting DNS resolution from zero the
// moment the <webview>'s src actually changes. Scoped to the account's own
// session partition (not the default session) since that's the partition
// the real navigation will use — Chromium keeps a separate host resolver
// cache per session, so warming the wrong one wouldn't help. Best-effort
// only: any failure (offline, DNS blocked, whatever) is silently ignored
// since the real navigation will surface the actual error on its own.
function preconnectAccountHost(account, ses) {
  try {
    const url = new URL(account.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    const req = net.request({ method: 'HEAD', url: `${url.protocol}//${url.host}/`, session: ses });
    req.on('error', () => {});
    req.on('response', (res) => {
      res.on('data', () => {});
      res.on('error', () => {});
    });
    req.end();
  } catch {
    // Malformed account.url — the real navigation will fail loudly on its
    // own, no need to duplicate that here.
  }
}

// Wires up a specific account's guest <webview> webContents — called from a
// 'did-attach-webview' handler once the renderer has actually created the
// DOM element, instead of main constructing a native WebContentsView itself
// (that native-view architecture is what caused Cloudflare Turnstile's
// 600010 false-positive on the game's login page — confirmed live against
// a minimal <webview>-only reproduction; see the plan doc for the full
// diagnosis). Everything below is otherwise the same logic that used to
// live in createViewForAccount, just operating on `wc` (the guest
// webContents) directly instead of a WebContentsView wrapper around it.
function wireAccountWebContents(wc, account, hostWebContents) {
  if (views.get(account.id) === wc) return; // already wired, no-op
  views.set(account.id, wc);

  wc.session.setSpellCheckerLanguages(spellCheckerLanguagesFor(data.settings.language));
  wc.setZoomFactor(account.zoom || data.settings.defaultZoom || 1);
  // Popups (e.g. a Google login window opened via window.open) get the same
  // isolated session and autofill preload as their opener — but only when
  // the destination is the account's own site or a known login provider
  // (see POPUP_ALLOWED_HOSTS above). Anything else is denied; Chromium's own
  // gesture-gated popup blocker already stops most abuse upstream of this,
  // but that alone was never a URL/origin policy.
  wc.setWindowOpenHandler((details) => {
    const targetHost = hostnameFromUrlLike(details && details.url);
    const accountHost = hostnameFromUrlLike(account.url);
    if (!hostMatchesPopupAllowlist(targetHost, accountHost)) {
      console.warn('[popup] blocked window.open to non-allowlisted host', targetHost, 'from account', account.id);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          partition: accountPartition(account.id),
          contextIsolation: true,
          sandbox: true,
          spellcheck: true,
          plugins: true,
          additionalArguments: [`--account-id=${account.id}`],
          preload: ACCOUNT_PRELOAD_PATH
        }
      }
    };
  });
  handleDownloads(wc.session);
  applyAdBlock(wc.session, account.id);
  applyPermissionHandler(wc.session, account);
  applyProxy(wc.session, account);
  // Sequential, not Promise.all/forEach-fired-in-parallel: opening several
  // accounts at once (e.g. a space with 4 accounts on launch) used to fire
  // N extension loads per account all at the same moment, which is what
  // actually competes for CPU/disk during boot. One extension load queue
  // per account keeps the burst down without changing anything the user
  // sees — the account's own page load isn't gated on this loop finishing.
  (async () => {
    // account.cleanGameProfile (opt-in, per account, default off): when on,
    // only extensions explicitly marked vetted:true load into this specific
    // account — every other account keeps loading the full enabled set
    // exactly as before. Off by default, so behavior is byte-identical to
    // pre-Etapa-8 for every account that never sets this flag.
    const enabledExtensions = data.settings.extensions.filter((ext) => ext.enabled !== false);
    const extensionsForAccount = account.cleanGameProfile
      ? enabledExtensions.filter((ext) => ext.vetted === true)
      : enabledExtensions;
    for (const e of extensionsForAccount) {
      try {
        await wc.session.extensions.loadExtension(e.path);
        console.log('[ext] loaded', e.name, 'into', account.id);
      } catch (err) {
        console.error('[ext] FAILED to load', e.name, 'into', account.id, err);
      }
    }
  })();
  // Attaches as early as possible — the injected WebSocket.prototype patch
  // (game-socket-capture.js) covers any socket already created by the time
  // it runs, but the sooner it installs, the smaller that race window. The
  // renderer creates every <webview> pointed at about:blank first and only
  // sets the real `src` after receiving 'webview:ready' below, specifically
  // so this always runs before that real navigation, for every account (not
  // just game ones — keeps a single, uniform creation path). Only ever
  // attaches for accounts already pointed at the game, per the telemetry
  // feature's scoping rule (main.js never runs this for a random account
  // someone happens to point elsewhere).
  if (account.url && gameTelemetry.isGameUrl(account.url)) {
    attachGameCaptureFor(wc, account.id);
  }
  wc.on('did-navigate', (_e, url) => {
    // A real navigation (not SPA routing) throws away the whole DOM, so any
    // translate-watch state (tracked nodes, the MutationObserver) is gone
    // with it — stop draining for this account until the user translates
    // the new page fresh.
    translateWatching.delete(account.id);
    resetPageAdBlockStats(account.id);
    notifyNav(account.id, url);
  });
  wc.on('did-navigate-in-page', (_e, url) => {
    notifyNav(account.id, url);
    syncBackgroundThrottling(wc, url, account.id);
    // Same /login → /play client-side transition: did-finish-load won't
    // fire again to trigger the telemetry attach below, so it has to be
    // done here too. isGameUrl() now excludes /login on purpose (see
    // game-telemetry.js) so this only actually attaches once the user is
    // past the Turnstile challenge.
    if (gameTelemetry.isGameUrl(url)) {
      attachGameCaptureFor(wc, account.id);
      // /login → /play SPA transition: scrape wallet once the HUD has rendered.
      // Two attempts (3 s and 7 s) because the game's React tree may still be
      // mounting at 3 s on slow connections.
      const scrapeAfterNav = () => {
        if (wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) return;
        wc.executeJavaScript(scrapeGameWalletScript())
          .then((wallet) => wallet && gameTelemetry.updateWallet(account.id, wallet))
          .catch(() => {});
      };
      setTimeout(scrapeAfterNav, 3000);
      setTimeout(scrapeAfterNav, 7000);
    }
  });
  // Chromium resets zoom on full page loads/reloads — reassert the account's
  // chosen zoom (or the app default) so it survives reload/repartition and
  // only ever changes via the user picking a new one or closing the tab.
  wc.on('did-finish-load', () => {
    // Auto-reapplies translation after a REAL navigation (e.g. the
    // /login -> game redirect) if the user had it on before — did-navigate
    // above already dropped translateWatching for the old page, but
    // translationEnabled is the user's standing preference and survives
    // that. A short delay lets the new page's own script actually render
    // its content first; extracting immediately after did-finish-load can
    // catch a still-mostly-empty shell on a JS-heavy page.
    if (translationEnabled.has(account.id)) {
      const to = translationEnabled.get(account.id);
      setTimeout(async () => {
        if (wc.isDestroyed() || !translationEnabled.has(account.id)) return;
        const result = await performTranslate(account.id, to);
        if (result.ok) liveMainWindow()?.webContents.send('translate:autoApplied', { id: account.id });
      }, 1500);
    }
    wc.setZoomFactor(account.zoom || data.settings.defaultZoom || 1);
    syncBackgroundThrottling(wc, wc.getURL(), account.id);
    injectFpsOverlay(wc, data.settings.showFpsOverlay !== false);
    injectPingOverlay(wc, data.settings.showPingOverlay !== false);
    if (account.ecoMode) enableEcoMode(wc);
    if (account.hideChat || account.hideGameBar) applyGameCssToggles(wc, account);
    if (account.sellLockOn) applySellLock(wc, account);
    if (gameTelemetry.isGameUrl(wc.getURL())) enableGameSocketCapture(wc);
    // A navigation could have crossed the /login → game boundary (or back
    // out of it), which changes whether the powerSaveBlocker is needed.
    refreshPowerBlockerNeed();
    if (isGameLoginUrl(wc.getURL())) {
      // No WS layer exists here and the capture script must never attach —
      // the state machine models this as IDLE, not a WS_* state.
      feedConnectionEvent(account.id, { type: 'LOGIN_PAGE' });
    }
    // Covers an account that started elsewhere and only just navigated to
    // the game — attachCapture() is idempotent (checks its own interval-
    // exists guard) so this is a no-op for accounts already attached.
    if (gameTelemetry.isGameUrl(wc.getURL())) {
      attachGameCaptureFor(wc, account.id);
      // A full page load (e.g. after a crash-recovery reload) means any
      // prior RECOVERY_FAILED/crash state should give the WS layer a fresh
      // chance rather than staying stuck.
      feedConnectionEvent(account.id, { type: 'RENDERER_RELOADED' });
      // Full page reload: scrape wallet once the HUD has settled.
      setTimeout(() => {
        if (wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) return;
        wc.executeJavaScript(scrapeGameWalletScript())
          .then((wallet) => wallet && gameTelemetry.updateWallet(account.id, wallet))
          .catch(() => {});
      }, 4000);
    }
  });
  wc.on('page-title-updated', (_e, title) => updateHistoryTitle(wc.getURL(), title));
  wc.on('render-process-gone', (_e, details) => {
    console.error('[crash] renderer gone for', account.id, details.reason);
    feedConnectionEvent(account.id, { type: 'RENDERER_CRASHED', reason: details.reason });
    const crashes = recordCrash(account.id);
    const gaveUp = crashes > 3;
    // Always broadcast, unlike feedConnectionEvent above — that one is a
    // no-op unless the opt-in "Estabilidad" system is on, which meant a
    // crashed account showed literally nothing on screen by default: no
    // overlay, no badge, just ~1s of frozen content then a silent reload,
    // or a permanently dead panel with zero indication if it gave up.
    liveMainWindow()?.webContents.send('account:crashed', { id: account.id, crashes, gaveUp });
    if (!gaveUp && !wc.isDestroyed()) {
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.reload();
      }, 1000);
    } else {
      console.error('[crash]', account.id, 'crashed', crashes, 'times — giving up on auto-reload');
    }
  });
  wc.on('unresponsive', () => feedConnectionEvent(account.id, { type: 'RENDERER_UNRESPONSIVE' }));
  wc.on('responsive', () => feedConnectionEvent(account.id, { type: 'RENDERER_RESPONSIVE' }));
  wc.on('context-menu', (_e, params) => showPageContextMenu(wc, params, account.id));
  wc.on('before-input-event', (event, input) => {
    if (handleAccountShortcut(input, account)) event.preventDefault();
  });
  wc.on('found-in-page', (_e, result) => {
    // `if (mainWindow)` is exactly the check mainWindowAlive() exists to
    // replace — a destroyed window is still truthy.
    const win = liveMainWindow();
    if (win) {
      win.webContents.send('findbar:result', {
        id: account.id,
        matches: result.matches,
        activeMatchOrdinal: result.activeMatchOrdinal
      });
    }
  });
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    nativeConsoleLog(`[page:${account.id}] ${message} (${sourceId}:${line})`);
  });
  // A page can destroy its own webContents any time by calling window.close()
  // on itself (normal web behavior, e.g. after a payment/OAuth flow), and the
  // renderer removing a <webview> element from the DOM (account closed,
  // window closing) also destroys its webContents the same way — either
  // path needs to land here. Without this, that happened outside the app's
  // own close flow entirely: the account never got marked closed, and this
  // entry stayed in the `views` map pointing at a destroyed webContents,
  // which crashed metrics:get on every poll after. finalizeAccountClose's
  // guard makes this safe to also fire when the app itself initiated the
  // close (closeAccountView already handles that path).
  wc.once('destroyed', () => {
    // If `views.get(id)` no longer points at THIS wc, a newer one has
    // already replaced it (e.g. openAccountInNewWindow closing this
    // window's copy right before the popped-out window's replacement
    // attaches) — that's an expected, intentional teardown, not a real
    // account close, so finalizeAccountClose must not run for it.
    if (views.get(account.id) !== wc) return;
    // The whole app quitting destroys every webview the same way a single
    // tab close does — appQuitting distinguishes the two so a normal quit
    // leaves account.closed exactly as it was (open accounts come back open
    // on the next launch instead of every tab reverting to closed).
    if (!account.closed && !appQuitting) {
      finalizeAccountClose(account, wc);
      persist();
      renderLayout();
      broadcastState();
    }
  });

  // account-preload.js listens for enterpictureinpicture/leavepictureinpicture
  // on `document` (capture phase catches it regardless of which video fired
  // it) and forwards the state here — wc.ipc is scoped to this exact guest,
  // no accountId needs to travel over the channel.
  // The renderer is the only consumer: it keeps a pip-active account's
  // <webview> painting OFF-SCREEN instead of display:none while it isn't the
  // active panel, because a hidden guest stops compositing entirely and the
  // floating PiP window would freeze. main.js used to also mirror this into a
  // module-scope Set that nothing ever read — removed, since dead state that
  // looks authoritative is worse than no state.
  wc.ipc.on('nexa-pip-state', (_e, active) => {
    liveMainWindow()?.webContents.send('account:pipState', { id: account.id, active });
  });

  preconnectAccountHost(account, wc.session);
  scheduleWebviewReady(hostWebContents, account.id);
}

// Shared by both the main window and any popped-out account window — finds
// which account a just-attached <webview> guest belongs to by matching its
// session against the deterministic per-account partition (persist:account-
// ${id} always resolves to the same session object for the same id, so an
// identity check here is reliable without inventing a separate correlation
// mechanism).
function wireDidAttachWebview(hostWebContents) {
  hostWebContents.on('did-attach-webview', (_event, wc) => {
    const account = data.accounts.find((a) => wc.session === session.fromPartition(accountPartition(a.id)));
    if (!account) {
      console.error('[webview] did-attach-webview fired for an unrecognized partition — ignoring');
      return;
    }
    wireAccountWebContents(wc, account, hostWebContents);
  });
}

// "Modo Eco" — opt-in per account (off by default, never forced), throttles
// window.requestAnimationFrame to a fixed low fps by rerouting it through
// setTimeout. Deliberately leaves setInterval/setTimeout/WebSocket/fetch
// completely untouched — an idle-farming account with Modo Eco off must keep
// making real progress in the background, same rule the Poke Idle telemetry
// feature already follows. Idempotent (checks window.__nexaEco) so it's safe
// to call again on every full page load. 15fps read as visibly janky once
// the new per-tab FPS badge made the real number visible to the user —
// raised to 30fps, still a real CPU saving over an uncapped ~60-144fps
// canvas loop but no longer perceptibly harmful to the page.
const ECO_MODE_FPS = 30;
function enableEcoMode(wc) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaEco) return;
      const nativeRAF = window.requestAnimationFrame.bind(window);
      const nativeCAF = window.cancelAnimationFrame.bind(window);
      const frameInterval = 1000 / ${ECO_MODE_FPS};
      let last = 0;
      window.requestAnimationFrame = function(cb) {
        const now = performance.now();
        const wait = Math.max(0, frameInterval - (now - last));
        return setTimeout(function() { last = performance.now(); cb(last); }, wait);
      };
      window.cancelAnimationFrame = function(id) { clearTimeout(id); };
      window.__nexaEco = { nativeRAF: nativeRAF, nativeCAF: nativeCAF };
    })();`
  ).catch(() => {});
}

function disableEcoMode(wc) {
  wc.executeJavaScript(
    `(function() {
      if (!window.__nexaEco) return;
      window.requestAnimationFrame = window.__nexaEco.nativeRAF;
      window.cancelAnimationFrame = window.__nexaEco.nativeCAF;
      delete window.__nexaEco;
    })();`
  ).catch((err) => {
    // Logged because a failure here leaves the page still rAF-capped at 30fps
    // while the UI shows Modo Eco as off — and the temp-eco bookkeeping that
    // would retry it (translateAppliedTempEco) has already been cleared by
    // then, so nothing retries on its own until the page reloads.
    console.error('[eco] failed to lift the frame cap', err);
  });
}

// "Modo Eco automático" (browser-inspired idea #1, off by default) —
// auto-applies enableEcoMode() to any open account once it's gone
// autoEco.minutes without being data.settings.activeAccountId, layered ON
// TOP of (never instead of) the per-account manual ecoMode toggle: an
// account with manual eco already on is left alone here, and this never
// writes to account.ecoMode itself, so the persisted manual preference and
// this runtime-only auto-throttle never fight each other.
//
// Polls every 5s instead of hooking every one of the ~15 scattered
// `data.settings.activeAccountId = ...` assignment sites elsewhere in this
// file — cheap (a Set/Map lookup per open account, no I/O) and still gives
// snappy re-focus behavior: eco drops within one tick of clicking back into
// an account, not after the full `minutes` threshold.
const AUTO_ECO_POLL_MS = 5000;
const autoEcoInactiveSince = new Map(); // accountId -> Date.now() when it was last seen active
const autoEcoApplied = new Set(); // accountId currently auto-throttled by this loop
// CPU%, not RAM: this eco mode works by capping requestAnimationFrame to a
// lower FPS (see enableEcoMode above), which reduces rendering/script work,
// not memory footprint — showing a RAM number here would be measuring the
// wrong mechanism. autoEcoBaselineCpu is each account's LAST real CPU
// reading in the tick just before throttling kicked in (its own genuine
// "before"), compared against autoEcoCurrentCpu's latest post-throttle
// reading — a real per-account measurement, not an estimate.
const autoEcoBaselineCpu = new Map(); // accountId -> CPU% right before eco was applied
const autoEcoCurrentCpu = new Map(); // accountId -> latest CPU% while eco'd

function startAutoEcoLoop() {
  setInterval(() => {
    const cfg = data.settings.autoEco || {};
    // autoEco is off by default — every tick used to call app.getAppMetrics()
    // (a real per-process CPU sample across main+every renderer+GPU+utility)
    // and iterate every account regardless, for a feature that then did
    // nothing with any of it. Bailing out first means a user who never
    // turned this on pays zero cost for it, every 5s, for the app's whole
    // lifetime.
    if (!cfg.enabled) return;
    const activeId = data.settings.activeAccountId;
    const thresholdMs = Math.max(1, cfg.minutes || 30) * 60 * 1000;
    const openIds = new Set();
    const cpuByPid = new Map(app.getAppMetrics().map((m) => [m.pid, m.cpu ? m.cpu.percentCPUUsage : 0]));

    for (const account of data.accounts) {
      if (account.closed) continue;
      const wc = views.get(account.id);
      if (!wc || wc.isDestroyed()) continue;
      openIds.add(account.id);
      const cpuNow = cpuByPid.get(wc.getOSProcessId()) || 0;

      const isActive = account.id === activeId;
      if (isActive) {
        autoEcoInactiveSince.delete(account.id);
      } else if (!autoEcoInactiveSince.has(account.id)) {
        autoEcoInactiveSince.set(account.id, Date.now());
      }

      const inactiveMs = autoEcoInactiveSince.has(account.id) ? Date.now() - autoEcoInactiveSince.get(account.id) : 0;
      const shouldAutoEco = !isActive && !!cfg.enabled && !account.ecoMode && inactiveMs >= thresholdMs;

      if (shouldAutoEco && !autoEcoApplied.has(account.id)) {
        autoEcoBaselineCpu.set(account.id, cpuNow);
        enableEcoMode(wc);
        autoEcoApplied.add(account.id);
      } else if (!shouldAutoEco && autoEcoApplied.has(account.id)) {
        // account.ecoMode true means manual eco took over — leave the page
        // throttled, just stop tracking it as an auto-applied one.
        if (!account.ecoMode) disableEcoMode(wc);
        autoEcoApplied.delete(account.id);
        autoEcoBaselineCpu.delete(account.id);
        autoEcoCurrentCpu.delete(account.id);
      } else if (autoEcoApplied.has(account.id)) {
        autoEcoCurrentCpu.set(account.id, cpuNow);
      }
    }

    // Drop bookkeeping for accounts that closed since the last tick, so
    // these maps don't grow forever across the app's lifetime.
    for (const id of [...autoEcoInactiveSince.keys()]) {
      if (!openIds.has(id)) autoEcoInactiveSince.delete(id);
    }
    for (const id of [...autoEcoApplied]) {
      if (!openIds.has(id)) {
        autoEcoApplied.delete(id);
        autoEcoBaselineCpu.delete(id);
        autoEcoCurrentCpu.delete(id);
      }
    }
  }, AUTO_ECO_POLL_MS);
}

// FPS/ping per-tab overlays live in overlay-manager.js now (perf/
// maintainability pass, 2026-08-21 — see the header comment there). This
// file only calls injectFpsOverlay/setFpsOverlayVisible/injectPingOverlay/
// setPingOverlayVisible via the destructured import near the top of main.js.

// Replaces the old floating Pokéball button (which toggled visibility by hand,
// no actual savings) with real persistent settings: hiding the game's chat
// (.chat-box) and top toolbar (.game-dock) via display:none genuinely removes
// them from layout/paint, not just from view. Confirmed live via DevTools
// against poke.idleworld.online — both are plain DOM elements with stable
// class names, not canvas-drawn, so CSS hiding actually works and actually
// saves the browser real work. Idempotent: reuses the same <style> tag across
// calls instead of appending duplicates, so toggling on/off repeatedly or
// re-running on every did-finish-load never leaks style elements.
function applyGameCssToggles(wc, account) {
  const css =
    (account.hideChat ? '.chat-box{display:none !important}' : '') +
    (account.hideGameBar ? '.game-dock{display:none !important}' : '');
  wc.executeJavaScript(
    `(function() {
      let style = document.getElementById('nexa-game-css');
      if (!style) {
        style = document.createElement('style');
        style.id = 'nexa-game-css';
        document.head.appendChild(style);
      }
      style.textContent = ${JSON.stringify(css)};
    })();`
  ).catch(() => {});
}

// Sell-lock lives in electron/sell-lock.js — it is a pure
// (pokeIds, itemIds) -> injected-script-string function with no main.js
// dependencies, and it protects real user assets (it hard-blocks selling
// locked Pokemon/items), so it belongs somewhere a unit test can reach it
// without booting Electron. Same reasoning as crash-classifier.js and
// url-utils.js.
const { sellLockScript } = require('./sell-lock');

function applySellLock(wc, account) {
  // Logged, not swallowed: a cold failure self-heals (did-finish-load
  // re-applies this), but the LIVE updates — the user adding an item to the
  // lock list — don't get retried. A silent failure there leaves the page
  // enforcing the OLD lock set while the UI shows the new one, i.e. an item
  // the user believes is protected isn't.
  wc.executeJavaScript(sellLockScript(account.sellLockPokeIds, account.sellLockItemIds))
    .catch((err) => console.error('[sell-lock] failed to apply the lock list for', account.id, err));
}

// Teleport (favoritos/última hunt): confirmed live (NEXA_DEBUG_NET capture,
// see game-telemetry.js) that entering a hunt is NOT a REST call like
// buy/sell — the game sends a WS frame {"type":"enter-hunt","slug":"<slug>"}
// over its own already-open WebSocket. CDP's Network domain can only
// *observe* WS traffic, not send on the page's behalf, so this patches
// WebSocket.prototype.send (same monkey-patch style as sellLockScript) to
// grab a live reference to the game's socket the next time IT calls .send —
// which happens constantly on its own (boosts-refresh, badge-refresh, etc,
// confirmed live), so the reference is populated almost immediately after
// injection, with zero behavior change to the original send. Idempotent via
// window.__nexaWsCapture, safe to re-run on every did-finish-load.
//
// Bug found live: relying ONLY on the page's own .send() left
// window.__nexaGameSocket unset (or stuck pointing at a dead, already-closed
// socket after a reconnect) whenever an account sat connected-but-otherwise-
// quiet for a while without the game happening to call .send() again in that
// window — every one of OUR OWN outgoing frames (family-get, pokes-get,
// depot moves, teleport) then failed as "socket del juego no disponible" on
// an account that was, from the player's side, connected and playing fine.
// Now also captured the moment a WebSocket is constructed (same idea as the
// receive-side capture in game-socket-capture.js, which patches the
// prototype instead of waiting for a specific call) — trySend()'s own
// readyState check below already handles the brief CONNECTING window before
// a freshly (re)constructed socket reaches OPEN.
function gameSocketCaptureScript() {
  return `(function() {${GAME_SOCKET_CAPTURE_BODY}})();`;
}

function enableGameSocketCapture(wc) {
  wc.executeJavaScript(gameSocketCaptureScript()).catch(() => {});
}

// Body of gameSocketCaptureScript() without its own IIFE wrapper, reused
// inline by sendGameSocketFrameScript below so every single outgoing frame
// re-asserts the capture patch immediately before trying to send — instead
// of depending on some earlier injection (did-finish-load, or the telemetry
// poll loop in game-telemetry.js) having already run in this exact
// webContents. Confirmed live with 2+ accounts open that an account could
// still fail with "socket del juego no disponible" even after those other
// injection points existed, so this closes the gap at the one place that
// actually matters: right where the send is attempted.
const GAME_SOCKET_CAPTURE_BODY = `
    if (!window.__nexaWsCapture) {
      window.__nexaWsCapture = true;
      const OriginalWebSocket = window.WebSocket;
      const proto = OriginalWebSocket.prototype;
      const originalSend = proto.send;
      proto.send = function(data) {
        window.__nexaGameSocket = this;
        return originalSend.call(this, data);
      };
      function NexaWebSocket(...args) {
        const ws = new OriginalWebSocket(...args);
        window.__nexaGameSocket = ws;
        return ws;
      }
      NexaWebSocket.prototype = proto;
      NexaWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
      NexaWebSocket.OPEN = OriginalWebSocket.OPEN;
      NexaWebSocket.CLOSING = OriginalWebSocket.CLOSING;
      NexaWebSocket.CLOSED = OriginalWebSocket.CLOSED;
      window.WebSocket = NexaWebSocket;
    }
`;

// Generic version of the same wait-for-socket-then-send pattern —
// confirmed live that selling a pokemon via our own direct fetch() to
// /api/game/pokemon/sell does NOT get the collection refreshed automatically
// the way the game's own UI does: the native sell button also fires
// {"type":"pokes-get"} over the WS afterward, and the server only pushes an
// updated `pokes` frame in response to that explicit request — never
// unprompted after a sell. Skipping this left the mass-sell panel showing
// already-sold pokemon until a full page reload (which re-syncs everything
// from scratch). Reused for any future "sell/buy doesn't auto-refresh"
// case instead of writing a new one-off sender each time.
function sendGameSocketFrameScript(frame) {
  return `(function() {
    ${GAME_SOCKET_CAPTURE_BODY}
    return new Promise((resolve) => {
      let tries = 0;
      const trySend = () => {
        const ws = window.__nexaGameSocket;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify(${JSON.stringify(frame)}));
          resolve(true);
          return;
        }
        tries += 1;
        if (tries > 20) { resolve(false); return; }
        setTimeout(trySend, 150);
      };
      trySend();
    });
  })();`;
}

async function translateSelectionAt(id, x, y) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  // Shown immediately (before extraction even runs) so the user gets
  // feedback the instant they click "Traducir este texto" instead of
  // wondering whether anything happened — confirmed live this genuinely
  // matters: the whole pipeline (extraction, detection, a possible first-
  // time model download, translateBatch) can take several seconds, and
  // this was previously silent the whole time. Always cleared in the
  // finally block below, success or failure.
  wc.executeJavaScript(translate.showSelectionLoadingScript(x, y)).catch(() => {});
  // Tracks whether the success path below already handed off to
  // finishSelectionLoadingScript (which shows a brief result and cleans
  // itself up on its own timer) — every OTHER exit path (nothing found,
  // an error) still needs the finally block to remove the badge immediately
  // instead of leaving it stuck on "⏳ Traduciendo…" forever.
  let finished = false;
  try {
    const extracted = await wc.executeJavaScript(translate.extractElementAtPointScript(x, y));
    if (!extracted || !extracted.fragments.length) return { ok: true, translated: 0 };
    const to = data.settings.language || 'es';
    // Content-detection FIRST here, page <html lang> only as a last-resort
    // fallback — the opposite priority from the full-page translate flow.
    // Confirmed live against dragonballidle.online: its <html lang> is
    // "es" unconditionally (an app-shell attribute, not something that
    // tracks what's actually on screen), so trusting it here made every
    // right-click "Traducir este texto" on real Portuguese chat text
    // silently no-op — from ('es') matched to ('es'), so translateBatch's
    // own from===to short-circuit returned the text unchanged. Selecting a
    // SPECIFIC piece of text is exactly the case where it's most likely to
    // be in a different language than the page overall (a chat message
    // from another player, a quoted string), so trusting the page's
    // declared lang here is backwards.
    const detected = await translate.detectLanguage(extracted.fragments.join(' '));
    // Real bug hit live in the chat-translate feature this same guard was
    // added for: detectLanguage recognizes languages this app has no
    // Bergamot model for at all (French, Swedish, dozens of others — see
    // translate.js's isSupportedLanguage), and feeding one straight into
    // translateBatch throws instead of translating. Falling back through
    // extracted.from (the page's declared lang) and finally 'pt' means an
    // unsupported detection never reaches translateBatch at all.
    //
    // extracted.from is only trusted here when it's DIFFERENT from the
    // target language — confirmed live this matters: short, slangy chat
    // text ("fiquei top5 cade minha tag OP") is exactly the kind of string
    // franc can't confidently detect at all (returns null, not a wrong
    // guess), and on a page whose declared <html lang> equals the target
    // (the same dragonballidle.online quirk noted above — its lang="es"
    // unconditionally), falling back to that lang would silently turn this
    // into another from===to no-op. 'pt' — every game this app targets —
    // is the same last-resort default used everywhere else in this file
    // for exactly this "genuinely can't tell" case.
    let from = translate.isSupportedLanguage(detected) ? detected
      : (translate.isSupportedLanguage(extracted.from) && extracted.from !== to) ? extracted.from
      : 'pt';
    // Same franc false-positive as translateChatMessages/resolveFragmentFrom:
    // a confident-but-wrong 'to' guess on real Portuguese text (e.g. "fiquei
    // top5 cade minha tag OP" landing on 'es') makes translateBatch's own
    // from===to short-circuit silently no-op the whole selection. An exact
    // glossary match overrides it here too.
    from = translate.glossaryOverrideWhenSameAsTarget(from, to, extracted.fragments.join(' '));
    // Reuses the exact same translate:downloadProgress channel the main
    // "Traducir página" flow uses — the renderer opens the SAME modal for
    // it regardless of what triggered the download (see onTranslateDownloadProgress
    // in renderer.js), so a right-click translate that happens to need a
    // language pair no other translation on this account has used yet
    // isn't just a silent multi-second stall with no explanation.
    let downloadHappened = false;
    const translated = await translate.translateBatch(from, to, extracted.fragments, {
      html: false,
      onDownloadProgress: ({ filename, loaded, total }) => {
        downloadHappened = true;
        liveMainWindow()?.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
      }
    });
    if (downloadHappened) liveMainWindow()?.webContents.send('translate:downloadFinished', { id });
    await wc.executeJavaScript(translate.applySelectionTranslationScript(translated, extracted.startIndex));
    finished = true;
    if (!wc.isDestroyed()) wc.executeJavaScript(translate.finishSelectionLoadingScript(translated.length)).catch(() => {});
    return { ok: true, translated: translated.length, from, to };
  } catch (/** @type {any} */ err) {
    console.error('[translate] selection translate failed', err);
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (!finished && !wc.isDestroyed()) wc.executeJavaScript(translate.hideSelectionLoadingScript()).catch(() => {});
  }
}

async function restoreSelectionTranslations(id) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false };
  await wc.executeJavaScript(translate.restoreSelectionTranslationsScript()).catch(() => {});
  return { ok: true };
}

// uBlock Origin's element picker/zapper — the click-to-hide flow lives
// entirely in elementPickerScript() (runs in-page); this just persists
// what it returns as a real hostname##selector cosmetic rule alongside any
// hand-written ones in the "Reglas personalizadas" dashboard textarea, then
// rebuilds the engine so the rule also applies on the NEXT load of this (or
// any matching) page — the picker's own immediate `display:none` already
// handles the current one.
async function pickElementToBlock(wc, lang) {
  let result;
  try {
    result = await wc.executeJavaScript(elementPicker.elementPickerScript(mt(lang, 'js.adblockPickerHint')), true);
  } catch (err) {
    console.error('[element-picker] failed', err);
    return;
  }
  if (!result || !result.ok || !result.selector) return;
  // No initializer — every path either overwrites this in the try or
  // returns before it's ever read, so the ESLint-flagged `= ''` default was
  // provably dead code, not a real fallback.
  let hostname;
  try {
    hostname = new URL(wc.getURL()).hostname;
  } catch {
    return;
  }
  const rule = `${hostname}##${result.selector}`;
  const rules = new Set(data.settings.adBlockCustomRules || []);
  if (rules.has(rule)) return;
  rules.add(rule);
  data.settings.adBlockCustomRules = Array.from(rules);
  persist();
  broadcastState();
  rebuildAdBlockEngine().catch((err) => console.error('[adblock] rebuild after element pick failed', err));
}

function showPageContextMenu(wc, params, accountId) {
  const lang = data.settings.language || 'es';
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const items = [
    { label: mt(lang, 'ctx.back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: mt(lang, 'ctx.forward'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: mt(lang, 'ctx.reload'), click: () => wc.reload() },
    { type: 'separator' }
  ];

  if (params.linkURL) {
    items.push(
      { label: mt(lang, 'ctx.openLink'), click: () => wc.loadURL(params.linkURL) },
      { label: mt(lang, 'ctx.copyLink'), click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' }
    );
  }

  if (params.mediaType === 'video') {
    items.push(
      {
        label: mt(lang, 'ctx.pip'),
        click: () => {
          // requestPictureInPicture() is gated behind a real user gesture —
          // without the `userGesture` argument here, Chromium sees this
          // executeJavaScript call as script-initiated, not user-initiated
          // (the right-click that opened this menu doesn't carry over), and
          // silently rejects with "Must be handling a user gesture". Same
          // script pip-player.js's toolbar entry point uses (see
          // account:openMiniPlayer below) — point-based here since a
          // right-click has an exact spot to go on, unlike the toolbar.
          wc.executeJavaScript(pipPlayer.requestPipWithControlsScript({ x: params.x, y: params.y }), true)
            .catch((err) => console.error('[pip] executeJavaScript failed:', err));
        }
      },
      { type: 'separator' }
    );
  }

  if (params.selectionText) {
    items.push({ label: mt(lang, 'ctx.copy'), click: () => clipboard.writeText(params.selectionText) }, { type: 'separator' });
  }

  items.push(
    { label: mt(lang, 'ctx.blockElement'), click: () => pickElementToBlock(wc, lang) },
    { type: 'separator' }
  );

  if (!params.isEditable) {
    items.push(
      { label: mt(lang, 'ctx.translateSelection'), click: () => translateSelectionAt(accountId, params.x, params.y) },
      { label: mt(lang, 'ctx.restoreTranslatedSelections'), click: () => restoreSelectionTranslations(accountId) },
      { type: 'separator' }
    );
  }

  // Only offered on sites this app actually knows the chat DOM structure
  // for (see CHAT_SITE_SELECTORS in translate.js) — showing it everywhere
  // and having it silently do nothing on unsupported sites would be
  // confusing, not helpful.
  {
    if (translate.chatSelectorsForHost(chatHostnameOf(wc.getURL()))) {
      const account = getAccount(accountId);
      const enabled = !!(account && account.chatAutoTranslate);
      items.push(
        {
          label: mt(lang, enabled ? 'ctx.chatAutoTranslateOff' : 'ctx.chatAutoTranslateOn'),
          click: () => toggleChatAutoTranslate(wc, accountId)
        },
        { type: 'separator' }
      );
    }
  }

  if (params.isEditable) {
    items.push(
      { label: mt(lang, 'ctx.cut'), click: () => wc.cut() },
      { label: mt(lang, 'ctx.copy'), click: () => wc.copy() },
      { label: mt(lang, 'ctx.paste'), click: () => wc.paste() },
      { type: 'separator' }
    );
  }

  items.push(
    {
      label: mt(lang, 'ctx.saveAs'),
      click: async () => {
        const result = await dialog.showSaveDialog(requireMainWindow(), { defaultPath: wc.getTitle() || 'page' });
        // Logged, not swallowed: the user already picked a filename at this
        // point, so a failure here (disk full, denied path) otherwise means
        // no file, no error and no trace of why.
        if (!result.canceled && result.filePath) {
          wc.savePage(result.filePath, 'HTMLComplete')
            .catch((err) => console.error('[save-page] failed to save', result.filePath, err));
        }
      }
    },
    { label: mt(lang, 'ctx.print'), click: () => wc.print() },
    { type: 'separator' },
    {
      label: mt(lang, 'ctx.viewSource'),
      click: () => {
        const srcWindow = new BrowserWindow({ width: 900, height: 700, title: mt(lang, 'ctx.sourceWindowTitle'), icon: APP_ICON_PATH });
        srcWindow.loadURL('view-source:' + wc.getURL());
      }
    },
    { label: mt(lang, 'ctx.inspect'), click: () => wc.inspectElement(params.x, params.y) }
  );

  Menu.buildFromTemplate(items).popup({ window: liveMainWindow() ?? undefined });
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

// did-navigate/did-navigate-in-page (see wireDidAttachWebview) fire "many
// times a minute" for a hash-routing/SPA-style game, per account. account.url
// stays immediately accurate below (other code reads it directly and expects
// it current, and persist() is already internally debounced — see
// PERSIST_DEBOUNCE_MS — so calling it often is cheap) but the actual
// cross-process nav:update IPC send is real per-call cost with no data lost
// by delaying it slightly, so it's the one throttled here, per account (not
// globally — one busy account's navigations shouldn't starve another's).
const NAV_UPDATE_THROTTLE_MS = 500;
const lastNavUpdateSentAt = new Map();
function notifyNav(id, url) {
  const account = getAccount(id);
  if (!account) return;
  account.url = url;
  pushHistory(url, null);
  persist();
  const now = Date.now();
  if (now - (lastNavUpdateSentAt.get(id) || 0) < NAV_UPDATE_THROTTLE_MS) return;
  lastNavUpdateSentAt.set(id, now);
  liveMainWindow()?.webContents.send('nav:update', { id, url });
}

// The renderer owns creation now (it reactively creates a <webview> for every
// open account it sees in state, see renderPanelWebviews in renderer.js) —
// this just looks up whatever main has already wired via did-attach-webview.
// Can legitimately return undefined for a brand-new account whose <webview>
// hasn't attached yet; call sites already guard with `?.`.
function ensureView(account) {
  return views.get(account.id);
}

function sidebarWidth() {
  return data.settings.sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
}

function contentBounds() {
  const win = liveMainWindow();
  if (!win) return { x: 0, y: 0, width: 0, height: 0 };
  const [winWidth, winHeight] = win.getContentSize();
  const top = TOPBAR_HEIGHT;
  const left = RAIL_WIDTH + sidebarWidth();
  return {
    x: left,
    y: top,
    width: Math.max(winWidth - left, 0),
    height: Math.max(winHeight - top - STATUSBAR_HEIGHT, 0)
  };
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
    fullRect: rect,
    // Same math renderLayout used to hand to view.setBounds() — the actual
    // page-content area, i.e. the cell minus the header strip. The renderer
    // positions each account's real <webview> element with this now that
    // main no longer composites it natively.
    contentRect: {
      x: rect.x,
      y: rect.y + PANEL_HEADER_HEIGHT,
      width: rect.width,
      height: Math.max(rect.height - PANEL_HEADER_HEIGHT, 0)
    }
  }));
}

// Used to be responsible for compositing every account's native
// WebContentsView into place too (clearAllViews() + re-add + setBounds per
// panel); now it's just geometry math + one IPC send, since <webview>
// elements are real DOM the renderer positions itself off this same
// payload (see renderPanelWebviews in renderer.js).
function renderLayout() {
  const win = liveMainWindow();
  if (!win) return;
  const bounds = contentBounds();
  const { cells, maximized } = computeCells(bounds);
  win.webContents.send('panels:geometry', buildGeometry(cells, maximized));
}

// For changes that only affect a panel's displayed metadata (mute/name/color/
// zoom) — not which accounts are open, the layout mode, or their sizes —
// this is identical to renderLayout() now that neither function touches any
// native view. Kept as a separate name for the (many) call sites that were
// written back when the two functions did meaningfully different amounts of
// work, so this diff doesn't have to also chase down every one of them.
function broadcastGeometryOnly() {
  const win = liveMainWindow();
  if (!win) return;
  const { cells, maximized } = computeCells(contentBounds());
  win.webContents.send('panels:geometry', buildGeometry(cells, maximized));
}

function createWindow() {
  const win = new BrowserWindow({
    name: 'main-window',
    windowStatePersistence: true,
    width: 1280,
    height: 800,
    show: false,
    title: 'Nexa Browser',
    backgroundColor: '#111318',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // <webview> is opt-in — without this every account panel's element
      // silently does nothing (no error, just never attaches a guest).
      webviewTag: true
    }
  });
  mainWindow = win;

  const shellUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;

  // This window is the privileged one: preload.js exposes window.api with
  // ~100 IPC channels on it, including the only channel that returns real
  // password values. Nothing may ever navigate it away from index.html.
  //
  // The realistic way that happened without this guard is boring and easy to
  // hit by accident: dropping a link or a file anywhere on the chrome that
  // isn't one of the two elements with their own dragover handler (the
  // account list and the space rail) makes Chromium navigate the whole
  // window to it — arbitrary content, in the document that owns window.api.
  // Guest pages are unaffected: each account is a <webview>, a separate
  // webContents with its own navigation, not this one.
  win.webContents.on('will-navigate', (event, url) => {
    if (url === shellUrl) return;
    event.preventDefault();
    console.warn('[shell] blocked a navigation away from the app UI:', url);
  });
  // DO NOT add a setWindowOpenHandler here. It looks like the obvious
  // companion to the guard above — the shell has no legitimate window.open()
  // caller, and anything it opened would inherit this window's privileges —
  // but confirmed live against the e2e suite: attaching a <webview> guest
  // goes through the HOST webContents' window-open path, so a handler that
  // returns 'deny' silently stops every account panel from ever attaching.
  // The symptom is not an error anywhere: `views` just stays empty,
  // ensureView() returns undefined, and every account:navigate answers "la
  // vista de esta cuenta todavía no está lista" while the UI otherwise looks
  // completely normal.
  //
  // The real risk here — arbitrary content loaded into the one document that
  // owns window.api — is already covered by the will-navigate guard above
  // plus the document-level drag/drop guard at the top of renderer.js.
  // (The matching document-level drag/drop guard — what stops a dropped file
  // from becoming a navigation request in the first place — lives at the top
  // of src/renderer.js, where it belongs as renderer code.)

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[boot] did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[boot] render-process-gone', details);
  });
  win.on('unresponsive', () => {
    console.error('[boot] main window became unresponsive');
  });

  // Marks the quit as already in progress the moment the window starts
  // closing — before Electron destroys the window's child <webview>
  // webContents, which is what used to run the same 'destroyed' handler
  // that a real one-tab close uses (see wireAccountWebContents below) and
  // silently flip every open account to closed:true on a normal app quit.
  // The old `appQuitting` flag (set in 'before-quit') was too late for this:
  // that event only fires after 'window-all-closed', which itself only
  // fires after every window (and its children) is already destroyed.
  win.on('close', () => {
    appQuitting = true;
  });

  wireDidAttachWebview(win.webContents);

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  // Right-click Cut/Copy/Paste/Select all for our own chrome's editable
  // fields (address bar, command palette, settings inputs, etc). Electron
  // doesn't provide this by default the way a real browser does — only the
  // account webviews had it (see showPageContextMenu below), so typing a
  // URL had no way to paste via the mouse, only via Ctrl+V.
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return;
    const lang = data.settings.language || 'es';
    const wc = win.webContents;
    Menu.buildFromTemplate([
      { label: mt(lang, 'ctx.cut'), enabled: params.editFlags.canCut, click: () => wc.cut() },
      { label: mt(lang, 'ctx.copy'), enabled: params.editFlags.canCopy, click: () => wc.copy() },
      { label: mt(lang, 'ctx.paste'), enabled: params.editFlags.canPaste, click: () => wc.paste() },
      { type: 'separator' },
      { label: mt(lang, 'ctx.selectAll'), enabled: params.editFlags.canSelectAll, click: () => wc.selectAll() }
    ]).popup({ window: win });
  });

  // Throttled: OS resize events can fire dozens of times per second while the
  // user drags a window edge, and each renderLayout() tears down and re-adds
  // every open WebContentsView — unthrottled this visibly janks with more than
  // a couple of panels open. Renders immediately on the first tick (stays
  // responsive), then at most once per RESIZE_THROTTLE_MS while still moving,
  // with one guaranteed trailing render so the final size is always exact.
  const RESIZE_THROTTLE_MS = 50;
  /** @type {NodeJS.Timeout|null} */
  let resizeThrottleTimer = null;
  let resizeRenderPending = false;
  win.on('resize', () => {
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

  return win;
}

// Coalesced across a microtask: several IPC handlers call persist() +
// broadcastState() back to back within the same synchronous tick (e.g. a
// batch action touching multiple accounts), which used to serialize and
// send the entire `data` object once per call. Queuing on a microtask
// collapses those into a single send of whatever `data` looks like once all
// of that tick's synchronous mutations have landed — same end state, fewer
// full-state IPC round-trips.
let stateBroadcastQueued = false;
function broadcastState() {
  if (!mainWindowAlive() || stateBroadcastQueued) return;
  stateBroadcastQueued = true;
  queueMicrotask(() => {
    stateBroadcastQueued = false;
    liveMainWindow()?.webContents.send('state:update', data);
  });
}

// ---- IPC handlers ----

ipcMain.handle('state:get', () => data);
ipcMain.handle('security:passwordEncryptionAvailable', () => passwordEncryptionAvailable);

permissionsManager.registerIpcHandlers();

ipcMain.handle('accounts:add', (_e, { name, url, spaceId, color }) => {
  const targetSpaceId = spaceId || getCurrentSpace()?.id || 'default';
  const account = {
    id: crypto.randomUUID(),
    name: name || mt(data.settings.language || 'es', 'main.defaultAccountName'),
    url: /^https?:\/\//.test(url) ? url : `https://${url}`,
    spaceId: targetSpaceId,
    color: color || '#4f8cff',
    openedAt: Date.now()
  };
  account.chatAutoTranslate = defaultChatAutoTranslate(account.url);
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
  if (!account) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotFound') };
  const target = normalizeAddressInput(url);
  // account.url (and the state broadcast the renderer polls) used to be set
  // BEFORE confirming the real <webview> was even wired up yet — if
  // ensureView() returned undefined, the state silently claimed the
  // navigation happened while the actual page never moved. Now the state
  // only advances once there's a real webContents to call loadURL on.
  const wc = ensureView(account);
  if (!wc) return { ok: false, error: mt(data.settings.language || 'es', 'err.viewNotReady') };
  account.url = target;
  if (account.chatAutoTranslate === undefined) account.chatAutoTranslate = defaultChatAutoTranslate(target);
  persist();
  wc.loadURL(target);
  broadcastState();
  return { ok: true, url: target };
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
  const wc = views.get(id);
  const ses = wc ? wc.session : session.fromPartition(accountPartition(id));
  if (wc) {
    // Force-closes even if the page has an unsaved-form beforeunload prompt —
    // "remove this account" always wins over that, unlike the regular
    // "close tab" flow (closeAccountView) which respects it. The renderer
    // will also see this account missing from the next state:update and
    // remove its <webview> element from the DOM on its own, but closing the
    // webContents directly here means the resources are freed immediately
    // regardless of when that reconciliation runs.
    wc.close();
    views.delete(id);
  }
  ses.clearStorageData().then(() => ses.clearCache()).catch((err) => console.error('[remove-account] failed to clear session for', id, err));
  adblockManager.cleanupAccount(id);
  crashCounts.delete(id);
  lastGpuRecoveryAt.delete(id);
  proxySecrets.delete(id);
  connectionManagers.delete(id);
  gameTelemetry.removeState(id);
  notifiedEventAt.delete(id);
  translateWatching.delete(id);
  translationEnabled.delete(id);
  chatUserLanguageHistory.delete(id);
  frozenNotifiedAt.delete(id);
  translateAppliedTempEco.delete(id);
  pageTranslateInFlight.delete(id);
  chatTranslateInFlight.delete(id);
  lastNavUpdateSentAt.delete(id);
  if (data.settings.activeAccountId === id) {
    data.settings.activeAccountId = accountsInCurrentSpace()[0]?.id || null;
  }
  refreshPowerBlockerNeed();
  persist();
  renderLayout();
  broadcastState();
}

ipcMain.handle('accounts:remove', (_e, { id }) => {
  removeAccountCompletely(id);
  return data;
});

// Shared by accounts:duplicate and the account context-menu's "Duplicar
// cuenta" item — used to be copy-pasted in both, same pattern already fixed
// once this session for chatAutoTranslate's toggle (see its comment above).
// Everything about an account EXCEPT the handful of fields that must be
// unique to the copy. Listing what to keep (the old approach) meant every
// per-account setting added since — proxy, ecoMode, hideChat, hideGameBar,
// sellLockOn and its two id lists, cleanUpProfile, zoom, chatAutoTranslate,
// groupId, the layout fracs — was silently dropped, so "duplicar" produced a
// bare account with the same name and URL and nothing else. Listing what to
// REPLACE instead means a field added tomorrow is carried over by default,
// which is what a user means by "duplicate".
//
// The session is deliberately NOT shared: the copy gets a new id, so it gets
// its own persist:account-<id> partition and its own login, which is the whole
// point of duplicating an account in this app.
function copyOfAccount(source, overrides) {
  const copy = { ...source, ...overrides };
  // Runtime-only bookkeeping that must never be inherited.
  delete copy.freeRect;
  // The proxy password lives in proxySecrets, not on the account object, so a
  // plain spread would have left the copy pointing at a proxy it cannot
  // authenticate against.
  if (copy.proxy && copy.id !== source.id) {
    const secret = getProxyPassword(source.id);
    if (secret) proxySecrets.set(copy.id, secret);
  }
  return copy;
}

function duplicateAccount(id) {
  const source = getAccount(id);
  if (!source) return;
  const copy = copyOfAccount(source, {
    id: crypto.randomUUID(),
    name: `${displayName(source)} ${mt(data.settings.language || 'es', 'ctx.copySuffix')}`,
    muted: false,
    closed: false,
    openedAt: Date.now()
  });
  const index = data.accounts.findIndex((a) => a.id === id);
  data.accounts.splice(index + 1, 0, copy);
  persist();
  renderLayout();
  broadcastState();
}

ipcMain.handle('accounts:duplicate', (_e, { id }) => {
  duplicateAccount(id);
  return data;
});

ipcMain.handle('account:clearSession', async (_e, { id }) => {
  const account = getAccount(id);
  if (!account) return;
  await clearAccountSessionData(id);
});

function getGroup(id) {
  return data.groups.find((g) => g.id === id);
}

// Collapsible account groups within a Space (browser-inspired idea #11).
ipcMain.handle('groups:create', (_e, { spaceId, name }) => {
  const group = { id: crypto.randomUUID(), spaceId, name: name || 'Grupo', collapsed: false };
  data.groups.push(group);
  persist();
  broadcastState();
  return group;
});

ipcMain.handle('groups:rename', (_e, { id, name }) => {
  const group = getGroup(id);
  if (group && name && name.trim()) {
    group.name = name.trim();
    persist();
    broadcastState();
  }
  return data;
});

// Ungroups its accounts rather than deleting them — removing a group is
// about the grouping, never about the accounts inside it.
ipcMain.handle('groups:remove', (_e, { id }) => {
  data.groups = data.groups.filter((g) => g.id !== id);
  data.accounts.forEach((a) => {
    if (a.groupId === id) a.groupId = null;
  });
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('groups:toggleCollapsed', (_e, { id }) => {
  const group = getGroup(id);
  if (group) {
    group.collapsed = !group.collapsed;
    persist();
    broadcastState();
  }
  return data;
});

ipcMain.handle('accounts:setGroup', (_e, { id, groupId }) => {
  const account = getAccount(id);
  if (account) {
    account.groupId = groupId || null;
    persist();
    broadcastState();
  }
  return data;
});

ipcMain.on('groups:contextmenu', (_e, payload) => {
  if (!payload || typeof payload.id !== 'string') return;
  const group = getGroup(payload.id);
  if (!group) return;
  const lang = data.settings.language || 'es';
  const menu = Menu.buildFromTemplate([
    {
      label: mt(lang, 'ctx.renameGroup'),
      click: () => liveMainWindow()?.webContents.send('ui:promptRenameGroup', { groupId: group.id, currentName: group.name })
    },
    {
      label: mt(lang, 'ctx.deleteGroup'),
      click: () => {
        data.groups = data.groups.filter((g) => g.id !== group.id);
        data.accounts.forEach((a) => {
          if (a.groupId === group.id) a.groupId = null;
        });
        persist();
        broadcastState();
      }
    }
  ]);
  menu.popup({ window: liveMainWindow() ?? undefined });
});

ipcMain.on('accounts:contextmenu', (_e, payload) => {
  if (!payload || typeof payload.id !== 'string') return;
  const { id } = payload;
  const account = getAccount(id);
  if (!account) return;
  const space = getSpace(account.spaceId);
  const lang = data.settings.language || 'es';
  const menu = Menu.buildFromTemplate([
    { label: mt(lang, 'ctx.reload'), click: () => views.get(id)?.reload() },
    {
      label: mt(lang, 'ctx.goToDefaultUrl'),
      click: () => {
        const target = space?.defaultUrl || 'https://www.google.com';
        account.url = target;
        persist();
        views.get(id)?.loadURL(target);
        broadcastState();
      }
    },
    {
      label: account.muted ? mt(lang, 'ctx.unmutePanel') : mt(lang, 'topbar.mute'),
      click: () => {
        account.muted = !account.muted;
        views.get(id)?.setAudioMuted(account.muted);
        persist();
        renderLayout();
        broadcastState();
      }
    },
    { type: 'separator' },
    {
      label: mt(lang, 'ctx.closeAccount'),
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
    { label: mt(lang, 'ctx.editAccount'), click: () => liveMainWindow()?.webContents.send('ui:open-account-editor', { id }) },
    {
      label: mt(lang, 'ctx.moveToGroup'),
      submenu: [
        ...(account.groupId
          ? [
              {
                label: mt(lang, 'ctx.removeFromGroup'),
                click: () => {
                  account.groupId = null;
                  persist();
                  broadcastState();
                }
              },
              { type: 'separator' }
            ]
          : []),
        ...data.groups
          .filter((g) => g.spaceId === account.spaceId)
          .map((g) => ({
            label: g.name,
            type: 'radio',
            checked: account.groupId === g.id,
            click: () => {
              account.groupId = g.id;
              persist();
              broadcastState();
            }
          })),
        { type: 'separator' },
        {
          label: mt(lang, 'ctx.newGroup'),
          click: () => liveMainWindow()?.webContents.send('ui:promptNewGroup', { accountId: id, spaceId: account.spaceId })
        }
      ]
    },
    {
      label: mt(lang, 'ctx.openInNewWindow'),
      enabled: !poppedOutIds.has(id),
      click: () => openAccountInNewWindow(id)
    },
    {
      label: mt(lang, 'ctx.duplicateAccount'),
      click: () => duplicateAccount(id)
    },
    { type: 'separator' },
    {
      label: mt(lang, 'ctx.clearSessionData'),
      click: () => {
        clearAccountSessionData(id).catch((err) => console.error('[session] clear failed for', id, err));
      }
    },
    {
      label: mt(lang, 'ctx.deleteAccount'),
      click: () => removeAccountCompletely(id)
    }
  ]);
  menu.popup({ window: liveMainWindow() ?? undefined });
});

ipcMain.handle('accounts:update', (_e, { id, name, color, url, proxy, ecoMode, hideChat, hideGameBar, sellLockOn, cleanGameProfile, chatAutoTranslate }) => {
  const account = getAccount(id);
  if (!account) return data;
  if (name !== undefined) account.name = name || null;
  if (color !== undefined) account.color = color;
  if (url !== undefined && url.trim() && url !== account.url) {
    const target = /^https?:\/\/|^about:/.test(url) ? url : `https://${url}`;
    account.url = target;
    views.get(id)?.loadURL(target);
  }
  if (proxy !== undefined) {
    if (proxy && proxy.server) {
      // The password is split off into proxySecrets and never stored on the
      // account object — see proxySecrets. An empty/absent password field in
      // an update means 'leave the stored one alone' (the editor sends back
      // what it was shown, and it is never shown the real value), so it only
      // overwrites when the user actually typed something.
      const { password, ...proxyMeta } = proxy;
      account.proxy = proxyMeta;
      if (typeof password === 'string' && password) proxySecrets.set(id, password);
    } else {
      account.proxy = null;
      proxySecrets.delete(id);
    }
    const wc = views.get(id);
    if (wc) applyProxy(wc.session, account);
  }
  if (ecoMode !== undefined && ecoMode !== account.ecoMode) {
    account.ecoMode = !!ecoMode;
    const wc = views.get(id);
    // Only the live page needs the immediate toggle — did-finish-load already
    // re-applies enableEcoMode() on every future load from account.ecoMode.
    if (wc && !wc.isDestroyed()) {
      if (account.ecoMode) enableEcoMode(wc);
      else disableEcoMode(wc);
    }
  }
  if ((hideChat !== undefined && hideChat !== account.hideChat) || (hideGameBar !== undefined && hideGameBar !== account.hideGameBar)) {
    if (hideChat !== undefined) account.hideChat = !!hideChat;
    if (hideGameBar !== undefined) account.hideGameBar = !!hideGameBar;
    const wc = views.get(id);
    if (wc && !wc.isDestroyed()) applyGameCssToggles(wc, account);
  }
  if (sellLockOn !== undefined && sellLockOn !== account.sellLockOn) {
    account.sellLockOn = !!sellLockOn;
    const wc = views.get(id);
    // Turning it off doesn't un-patch fetch (harmless no-op with empty sets
    // once re-enabled) — only re-applying with the account's real lock lists
    // when turned back on matters here.
    if (wc && !wc.isDestroyed() && account.sellLockOn) applySellLock(wc, account);
  }
  if (chatAutoTranslate !== undefined && chatAutoTranslate !== account.chatAutoTranslate) {
    account.chatAutoTranslate = !!chatAutoTranslate;
    // Turning it off drops whatever per-user language history had been
    // built up — starting fresh next time it's re-enabled is simpler and
    // safer than trying to decide whether a stale history is still
    // trustworthy after an unknown gap.
    if (!account.chatAutoTranslate) chatUserLanguageHistory.delete(id);
  }
  // Extensions only actually load once, at account-wiring time (see the
  // extensionsForAccount filter in wireAccountWebContents) — this just
  // persists the flag; it takes effect the next time this account's
  // <webview> is (re)created (reopening a closed account, or on next app
  // launch), same as ecoMode's did-finish-load re-application model but
  // without a live extension unload/reload path (Electron has no supported
  // "unload one extension from one session" API to hot-apply this).
  if (cleanGameProfile !== undefined) account.cleanGameProfile = !!cleanGameProfile;
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

// Toggles one Pokémon's sell-lock membership by its unique instance id (from
// game-telemetry's team/roster data) — add/remove is symmetric on purpose so
// the same handler serves both the lock and unlock click in the UI.
ipcMain.handle('account:toggleSellLockPoke', (_e, { id, pokeId }) => {
  const account = getAccount(id);
  if (!account || pokeId == null) return data;
  account.sellLockPokeIds = account.sellLockPokeIds || [];
  const key = String(pokeId);
  const idx = account.sellLockPokeIds.indexOf(key);
  if (idx === -1) account.sellLockPokeIds.push(key);
  else account.sellLockPokeIds.splice(idx, 1);
  const wc = views.get(id);
  if (wc && !wc.isDestroyed() && account.sellLockOn) applySellLock(wc, account);
  persist();
  broadcastState();
  return data;
});

// Full-list replace (not toggle-one) for items — the renderer manages its own
// add/remove UI over a plain item-id list and just resends the whole thing.
ipcMain.handle('account:setSellLockItems', (_e, { id, itemIds }) => {
  const account = getAccount(id);
  if (!account || !Array.isArray(itemIds)) return data;
  account.sellLockItemIds = itemIds.filter((n) => Number.isInteger(n));
  const wc = views.get(id);
  if (wc && !wc.isDestroyed() && account.sellLockOn) applySellLock(wc, account);
  persist();
  broadcastState();
  return data;
});

// orderedIds must be an exact permutation of the current ids — checked via
// two equal-size sets (not just "every id in orderedIds exists"), because a
// payload with a duplicate id and a missing one would otherwise pass a
// naive length+membership check and silently drop the missing entry from
// data.accounts/data.spaces when mapped.
function isExactPermutation(orderedIds, currentIds) {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) return false;
  const orderedSet = new Set(orderedIds);
  if (orderedSet.size !== orderedIds.length) return false; // duplicates
  if (orderedSet.size !== currentIds.size) return false;
  for (const id of orderedSet) if (!currentIds.has(id)) return false;
  return true;
}

ipcMain.handle('accounts:reorder', (_e, orderedIds) => {
  const currentIds = new Set(data.accounts.map((a) => a.id));
  if (!isExactPermutation(orderedIds, currentIds)) return data;
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  data.accounts = orderedIds.map((id) => byId.get(id));
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('spaces:reorder', (_e, orderedIds) => {
  const currentIds = new Set(data.spaces.map((s) => s.id));
  if (!isExactPermutation(orderedIds, currentIds)) return data;
  const byId = new Map(data.spaces.map((s) => [s.id, s]));
  data.spaces = orderedIds.map((id) => byId.get(id));
  persist();
  broadcastState();
  return data;
});

function removeSpace(id) {
  // The first space is pinned — always keep one guaranteed home base to work in.
  if (data.spaces.length <= 1 || id === data.spaces[0].id) return;
  const fallback = data.spaces.find((s) => s.id !== id);
  // Groups belong to exactly one space, so the removed space's groups have
  // nowhere to go — drop them, and clear the groupId of the accounts moving
  // to the fallback space so nothing is left pointing at a group that no
  // longer exists. Without this, data.groups accumulated one dead entry per
  // deleted space forever (the renderer degrades gracefully — it lists an
  // account with an unknown groupId as ungrouped — so it grew invisibly).
  // Same cleanup groups:remove already does for a single group.
  const removedGroupIds = new Set(data.groups.filter((g) => g.spaceId === id).map((g) => g.id));
  data.groups = data.groups.filter((g) => g.spaceId !== id);
  data.accounts
    .filter((a) => a.spaceId === id)
    .forEach((a) => {
      a.spaceId = fallback.id;
      if (removedGroupIds.has(a.groupId)) a.groupId = null;
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
    name: `${source.name} ${mt(data.settings.language || 'es', 'ctx.copySuffix')}`,
    color: source.color,
    icon: source.icon,
    defaultUrl: source.defaultUrl,
    defaultLayout: source.defaultLayout
  };
  const index = data.spaces.findIndex((s) => s.id === id);
  data.spaces.splice(index + 1, 0, newSpace);

  // The space's groups come along too, remapped to new ids — otherwise every
  // account in the copy landed ungrouped even though the original was
  // organised into groups.
  const groupIdMap = new Map();
  data.groups
    .filter((g) => g.spaceId === id)
    .forEach((g) => {
      const newGroupId = crypto.randomUUID();
      groupIdMap.set(g.id, newGroupId);
      data.groups.push({ ...g, id: newGroupId, spaceId: newSpace.id });
    });

  // Duplicating a space also duplicates its accounts, each as a fresh isolated
  // session (new id/partition) so cookies/cache don't leak between the copies.
  // Full copy (see copyOfAccount) rather than a hand-listed subset — the old
  // version silently dropped every per-account setting except name/url/color.
  data.accounts
    .filter((a) => a.spaceId === id)
    .forEach((a) => {
      data.accounts.push(copyOfAccount(a, {
        id: crypto.randomUUID(),
        spaceId: newSpace.id,
        groupId: groupIdMap.get(a.groupId) || null,
        muted: false,
        closed: a.closed,
        openedAt: a.closed ? undefined : Date.now()
      }));
    });

  persist();
  renderLayout();
  broadcastState();
}

function finalizeAccountClose(account, wc) {
  // Idempotent: this can now be reached twice for the same close — once from
  // the webContents' own permanent 'destroyed' listener (wireAccountWebContents,
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
  views.delete(account.id);
  refreshPowerBlockerNeed();
}

// Resolves true if the account actually closed, false if the page's own
// beforeunload handler asked to confirm and the user chose to stay (Chromium
// shows its native "Leave site?" dialog for this automatically).
function closeAccountView(account) {
  return new Promise((resolve) => {
    const wc = views.get(account.id);
    if (!wc) {
      finalizeAccountClose(account, null);
      resolve(true);
      return;
    }
    let settled = false;
    const onDestroyed = () => {
      if (settled) return;
      settled = true;
      finalizeAccountClose(account, wc);
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

// Shared by the Ctrl+W shortcut and the accounts:closeOne IPC handler — used
// to be copy-pasted in both (same close → reassign active → persist →
// renderLayout → broadcastState sequence), the same pattern that already
// caused a real bug once this session (see toggleChatAutoTranslate's
// comment above). Returns whether the account actually closed.
async function closeAccountAndAdvance(account) {
  const closed = await closeAccountView(account);
  if (closed) {
    if (data.settings.activeAccountId === account.id) {
      data.settings.activeAccountId = openAccountsInCurrentSpace()[0]?.id || null;
    }
    persist();
    renderLayout();
    broadcastState();
  }
  return closed;
}

ipcMain.handle('accounts:activate', (_e, { id }) => {
  const account = getAccount(id);
  if (!account) return data;

  const previousActiveId = data.settings.activeAccountId;
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
  // Gives the newly-active panel full-speed timers immediately instead of
  // waiting for its next did-navigate-in-page/did-finish-load, and puts the
  // previously-active one back under normal throttling rules (unless it's a
  // game page, which stays exempt either way).
  syncActiveThrottling(previousActiveId, id);
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

// A <webview> can't be reparented across BrowserWindows the way a
// WebContentsView instance used to be (it's a DOM element scoped to one
// renderer document) — so "pop out" no longer moves the same guest, it
// closes the account's <webview> in the main window and opens a second,
// minimal BrowserWindow (src/popout.html + electron/popout-preload.js)
// that creates its own <webview> on the exact same partition. Same
// partition means the same session/cookies/login — a fresh webContents
// instance, but indistinguishable to the user from the original panel.
function openAccountInNewWindow(id) {
  const account = getAccount(id);
  if (!account || account.closed || poppedOutIds.has(id)) return;
  if (data.settings.maximizedAccountId === id) data.settings.maximizedAccountId = null;

  const existingWc = views.get(id);
  if (existingWc) {
    views.delete(id);
    existingWc.close();
  }
  poppedOutIds.add(id);

  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: displayName(account),
    backgroundColor: '#111318',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'popout-preload.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  });
  wireDidAttachWebview(win.webContents);
  win.loadFile(path.join(__dirname, '..', 'src', 'popout.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('popout:init', {
      accountId: id,
      partition: accountPartition(id),
      preload: ACCOUNT_PRELOAD_URL,
      url: account.url
    });
  });
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
  await closeAccountAndAdvance(account);
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
  if (!rect || [rect.x, rect.y, rect.width, rect.height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return data;
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
  if (!LAYOUT_MODES.has(mode)) return data;
  data.settings.layoutMode = mode;
  persist();
  renderLayout();
  broadcastState();
  return data;
});

ipcMain.handle('account:reload', (_e, { id }) => {
  const view = views.get(id);
  if (view) view.reload();
});

ipcMain.handle('account:reloadHard', (_e, { id }) => {
  const view = views.get(id);
  if (view) view.reloadIgnoringCache();
});

ipcMain.handle('accounts:reopenLastClosed', () => {
  reopenLastClosedAccount();
  return data;
});

// Shared by both the direct-save path (account:captureScreenshot) and the
// editor's save (screenshot-editor:save) — same folder-resolution logic
// handleDownloads() already uses.
function resolveScreenshotFolder() {
  const folder = data.settings.downloadsFolder || path.join(app.getPath('pictures'), 'Nexa Browser');
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function writeScreenshotFile(buffer) {
  const folder = resolveScreenshotFolder();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(folder, `nexa-screenshot-${stamp}.png`);
  fs.writeFileSync(filePath, buffer);
  try {
    new Notification({ title: 'Nexa Browser', body: `Captura guardada: ${filePath}` }).show();
  } catch { /* Notification unsupported/unavailable — non-fatal, the file is already saved */ }
  return filePath;
}

// Point 7 of the browser-inspired feature list (Firefox's built-in
// Screenshot tool) — captures exactly what the account's own <webview> is
// currently showing via wc.capturePage() (no extra permissions needed, it's
// the same webContents that already renders the page) and writes it
// straight to disk as a PNG. Kept as a direct one-click primitive (used by
// the command palette's quick action and by e2e tests) — the toolbar button
// instead opens the editor below for the region-select + annotate flow.
ipcMain.handle('account:captureScreenshot', async (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  try {
    const image = await wc.capturePage();
    const filePath = writeScreenshotFile(image.toPNG());
    return { ok: true, path: filePath };
  } catch (/** @type {any} */ err) {
    console.error('[screenshot] failed to capture/save', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Screenshot editor: captures the same way as above, but opens a small
// dedicated window (src/screenshot-editor.html) instead of saving straight
// to disk — lets the user crop to a region and draw simple arrow/text
// annotations before it's written. Same window/preload split as the
// popped-out account window (popout-preload.js) — its own minimal IPC
// surface, nothing shared with the main app's window.api.
/** @type {BrowserWindow|null} */
let activeScreenshotEditorWindow = null;
ipcMain.handle('account:openScreenshotEditor', async (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  try {
    const image = await wc.capturePage();
    const dataUrl = 'data:image/png;base64,' + image.toPNG().toString('base64');
    const size = image.getSize();
    if (activeScreenshotEditorWindow && !activeScreenshotEditorWindow.isDestroyed()) {
      activeScreenshotEditorWindow.close();
    }
    const editorWin = new BrowserWindow({
      width: Math.min(1100, size.width + 40),
      height: Math.min(850, size.height + 150),
      title: 'Editar captura — Nexa Browser',
      backgroundColor: '#111318',
      icon: APP_ICON_PATH,
      webPreferences: {
        preload: path.join(__dirname, 'screenshot-editor-preload.js'),
        contextIsolation: true,
        sandbox: true
      }
    });
    editorWin.setMenuBarVisibility(false);
    editorWin.loadFile(path.join(__dirname, '..', 'src', 'screenshot-editor.html'));
    editorWin.webContents.once('did-finish-load', () => {
      editorWin.webContents.send('screenshot-editor:image', { dataUrl, lang: data.settings.language || 'es' });
    });
    editorWin.on('closed', () => {
      if (activeScreenshotEditorWindow === editorWin) activeScreenshotEditorWindow = null;
    });
    activeScreenshotEditorWindow = editorWin;
    return { ok: true };
  } catch (/** @type {any} */ err) {
    console.error('[screenshot-editor] failed to open', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Does NOT close the editor window itself — the renderer (screenshot-editor.html)
// awaits this IPC call and closes its own window only once the reply
// actually arrives, which is what genuinely guarantees the round-trip
// completed before teardown (see that file's save button handler for why
// a fixed delay here instead used to still race intermittently).
ipcMain.handle('screenshot-editor:save', (_e, dataUrl) => {
  try {
    const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
    const filePath = writeScreenshotFile(Buffer.from(base64, 'base64'));
    return { ok: true, path: filePath };
  } catch (/** @type {any} */ err) {
    console.error('[screenshot-editor] failed to save', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('screenshot-editor:cancel', () => {
  if (activeScreenshotEditorWindow && !activeScreenshotEditorWindow.isDestroyed()) {
    activeScreenshotEditorWindow.close();
  }
  return { ok: true };
});

// Toolbar entry point for Picture-in-Picture (no click point to go on,
// unlike the right-click ctx.pip menu item, which shares the same
// underlying script — see pip-player.js for why this ended up building on
// the native requestPictureInPicture() + Media Session API instead of a
// fully custom Document Picture-in-Picture window: that approach opened
// successfully but self-closed within milliseconds every time when
// triggered from inside a <webview> guest context, confirmed live via
// direct process logs.
ipcMain.handle('account:openMiniPlayer', (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  return wc.executeJavaScript(pipPlayer.requestPipWithControlsScript(), true)
    .catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
});

ipcMain.on('account:findInPage', (_e, payload) => {
  if (!payload) return;
  const { id, text, forward, findNext } = payload;
  const view = views.get(id);
  if (!view || !text) return;
  view.findInPage(text, { forward: forward !== false, findNext: !!findNext });
});

ipcMain.on('account:stopFindInPage', (_e, payload) => {
  const view = payload && views.get(payload.id);
  if (view) view.stopFindInPage('clearSelection');
});

ipcMain.on('account:goBack', (_e, payload) => {
  const view = payload && views.get(payload.id);
  if (view?.navigationHistory.canGoBack()) view.navigationHistory.goBack();
});

ipcMain.on('account:goForward', (_e, payload) => {
  const view = payload && views.get(payload.id);
  if (view?.navigationHistory.canGoForward()) view.navigationHistory.goForward();
});

ipcMain.handle('app:getMeta', () => ({ startTime: appStartTime, version: APP_VERSION, accountPreloadUrl: ACCOUNT_PRELOAD_URL }));
// Settings → Acerca de reads this synchronously (window.api.getVersions() is
// called as a plain sync function, not awaited) — sendSync/returnValue is the
// only way to answer that without changing the call site to async.
ipcMain.on('app:getVersionSync', (e) => { e.returnValue = APP_VERSION; });

ipcMain.handle('shortcuts:list', () => {
  const lang = data.settings.language || 'es';
  return SHORTCUTS.map((s) => ({ combo: s.combo, label: mt(lang, s.key) }));
});

ipcMain.handle('account:mute', (_e, { id, muted }) => {
  const account = getAccount(id);
  const view = views.get(id);
  if (view) view.setAudioMuted(muted);
  if (account) account.muted = muted;
  persist();
  broadcastGeometryOnly();
  broadcastState();
});

ipcMain.handle('spaces:add', (_e, payload = {}) => {
  const space = {
    id: crypto.randomUUID(),
    name: payload.name || mt(data.settings.language || 'es', 'main.defaultSpaceNameGeneric'),
    color: payload.color || '#4f8cff',
    // A key from SPACE_ICON_KEYS, not an emoji — the renderer resolves it via
    // SPACE_ICON_SVGS[space.icon], so the old '🔲' default never matched and
    // always fell through to the 'grid' fallback anyway (a leftover from when
    // icons really were emoji). createRandomSpace() already picks from the
    // key list; this makes the two creation paths agree.
    icon: SPACE_ICON_KEYS.includes(payload.icon) ? payload.icon : 'grid',
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

const SPACE_UPDATE_WHITELIST = new Set(['name', 'color', 'icon', 'defaultUrl', 'defaultLayout']);
ipcMain.handle('spaces:update', (_e, { id, ...fields }) => {
  const space = getSpace(id);
  if (!space) return data;
  for (const key of Object.keys(fields)) {
    if (SPACE_UPDATE_WHITELIST.has(key)) space[key] = fields[key];
  }
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
  const lang = data.settings.language || 'es';
  const menu = Menu.buildFromTemplate([
    { label: mt(lang, 'ctx.editSpace'), click: () => liveMainWindow()?.webContents.send('ui:open-space-editor', { id }) },
    { label: mt(lang, 'ctx.duplicateSpace'), click: () => duplicateSpace(id) },
    { type: 'separator' },
    {
      label: mt(lang, 'ctx.deleteSpace'),
      enabled: !isFirst && data.spaces.length > 1,
      click: () => removeSpace(id)
    }
  ]);
  menu.popup({ window: liveMainWindow() ?? undefined });
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

// The ui:hide-views / ui:show-views channels are gone. They used to strip
// every native WebContentsView out from under a modal dialog and re-add them
// after, because a native view always painted above the renderer's own DOM no
// matter its z-index. Since accounts became real <webview> DOM elements, a
// modal with a higher z-index covers them for free, and the real work moved
// into preload.js's hideViews/showViews, which toggle a CSS class locally.
// The handlers here were left as empty functions, so every modal open/close
// and every divider drag still sent two IPC messages to nothing — the sends
// are gone from preload.js too.

// Live-follows a divider drag: reflects just the one panel's rect straight
// back to the renderer immediately, without touching account data or
// triggering a full renderLayout/persist — those only happen once on
// mouseup (see layout:setSplit) so dragging stays cheap and the real page
// content visibly resizes instead of a placeholder while the user drags.
ipcMain.on('account:setLiveRect', (_e, payload) => {
  if (!payload) return;
  const { id, rect } = payload;
  if (!rect || [rect.x, rect.y, rect.width, rect.height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return;
  const win = liveMainWindow();
  if (!win) return;
  win.webContents.send('account:liveRect', {
    id,
    contentRect: {
      x: rect.x,
      y: rect.y + PANEL_HEADER_HEIGHT,
      width: rect.width,
      height: Math.max(rect.height - PANEL_HEADER_HEIGHT, 0)
    }
  });
});

extensionsManager.registerIpcHandlers();

ipcMain.handle('account:setZoom', (_e, { id, factor }) => {
  const account = getAccount(id);
  if (!account) return data;
  const zoom = clampZoom(factor, account.zoom || 1);
  account.zoom = zoom;
  const view = views.get(id);
  if (view) view.setZoomFactor(zoom);
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:setZoomAll', (_e, { factor }) => {
  const zoom = clampZoom(factor);
  data.accounts.forEach((a) => {
    a.zoom = zoom;
  });
  for (const view of views.values()) view.setZoomFactor(zoom);
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

ipcMain.on('app:toggleFullscreen', () => {
  const win = liveMainWindow();
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
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

ipcMain.handle('downloads:pause', (_e, { id }) => {
  const item = downloadItems.get(id);
  if (item && !item.isPaused()) item.pause();
});

ipcMain.handle('downloads:resume', (_e, { id }) => {
  const item = downloadItems.get(id);
  if (item && item.isPaused() && item.canResume()) item.resume();
});

ipcMain.handle('downloads:cancel', (_e, { id }) => {
  const item = downloadItems.get(id);
  if (item) item.cancel();
});

ipcMain.handle('accounts:muteAll', (_e, { muted }) => {
  data.accounts.forEach((a) => {
    a.muted = muted;
  });
  for (const view of views.values()) view.setAudioMuted(muted);
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
  'theme',
  'language',
  'pokeIdleAlerts',
  'startWithWindows',
  'reopenLastSpace',
  'hardwareAcceleration',
  'protectionLevel',
  'autoEco',
  'showFpsOverlay',
  'showPingOverlay',
  'huntTelemetryEnabled',
  'defaultStartUrl',
  'supportPaypalUrl',
  'defaultZoom',
  'newSpaceDefaultLayout',
  'askDownloadLocation',
  'stability',
  'translateMemoryPersist',
  'betaUpdates'
]);

ipcMain.handle('settings:update', (_e, fields) => {
  if (!fields || typeof fields !== 'object') return data;
  for (const key of Object.keys(fields)) {
    if (!SETTINGS_UPDATE_WHITELIST.has(key)) continue;
    if (key === 'pokeIdleAlerts' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
    if (key === 'protectionLevel' && !['off', 'standard', 'strict'].includes(fields[key])) continue;
    if (key === 'autoEco' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
    if (key === 'supportPaypalUrl' && fields[key]) {
      try {
        const parsed = new URL(String(fields[key]).trim());
        if (!isAllowedExternalSupportUrl(parsed.toString())) continue;
        fields[key] = parsed.toString();
      } catch {
        continue;
      }
    }
    if (key === 'language' && !Object.prototype.hasOwnProperty.call(I18N, fields[key])) continue;
    // Both of these end up somewhere that actually acts on them — a loadURL()
    // for the start page, a setZoomFactor() for the zoom — so they get the
    // same normalization their per-account equivalents already had.
    if (key === 'defaultStartUrl') fields[key] = safeStartUrl(fields[key], DEFAULT_START_URL);
    if (key === 'defaultZoom') fields[key] = clampZoom(fields[key]);
    if (key === 'newSpaceDefaultLayout' && !LAYOUT_MODES.has(fields[key])) continue;
    data.settings[key] = fields[key];
  }
  if (fields.pokeIdleAlerts && typeof fields.pokeIdleAlerts.ballsThreshold === 'number') {
    gameTelemetry.setBallsLowThreshold(fields.pokeIdleAlerts.ballsThreshold);
  }
  if ('startWithWindows' in fields) {
    app.setLoginItemSettings({ openAtLogin: !!fields.startWithWindows });
  }
  if ('stability' in fields) refreshPowerBlockerNeed();
  // Turning it on mid-session picks up whatever was saved from a previous
  // run right away, instead of only taking effect after the next restart.
  if (fields.translateMemoryPersist) translate.loadPersistedCache(TRANSLATE_MEMORY_FILE);
  // Live-apply to every already-open account instead of waiting for their
  // next did-finish-load — the badges are already injected, this just
  // flips their display style (see setFpsOverlayVisible/setPingOverlayVisible).
  if ('showFpsOverlay' in fields) {
    for (const wc of views.values()) if (!wc.isDestroyed()) setFpsOverlayVisible(wc, fields.showFpsOverlay !== false);
  }
  if ('showPingOverlay' in fields) {
    for (const wc of views.values()) if (!wc.isDestroyed()) setPingOverlayVisible(wc, fields.showPingOverlay !== false);
  }
  // Live-apply for already-open accounts, same pattern as the overlay
  // toggles above. Turning it off stops the polling interval outright
  // (gameTelemetry.detachCapture, not just hiding something) for every open
  // game account; turning it back on re-attaches via attachGameCaptureFor —
  // the exact function did-finish-load already calls, so this stays in sync
  // with the stability-onFrame wiring instead of duplicating it.
  if ('huntTelemetryEnabled' in fields) {
    for (const [accountId, wc] of views.entries()) {
      if (wc.isDestroyed()) continue;
      if (fields.huntTelemetryEnabled === false) {
        gameTelemetry.detachCapture(accountId);
      } else if (gameTelemetry.isGameUrl(wc.getURL())) {
        attachGameCaptureFor(wc, accountId);
      }
    }
  }
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('app:openExternal', async (_e, { url }) => {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:') return { ok: false, error: 'invalid-url' };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (/** @type {any} */ err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('settings:chooseDownloadsFolder', async () => {
  const result = await dialog.showOpenDialog(requireMainWindow(), { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return data;
  data.settings.downloadsFolder = result.filePaths[0];
  persist();
  broadcastState();
  return data;
});

ipcMain.handle('plugins:list', () => {
  const lang = data.settings.language || 'es';
  return [
    {
      name: 'Widevine Content Decryption Module',
      description: widevineCdm
        ? mt(lang, 'plugin.widevineDesc', { source: widevineCdm.source, version: widevineCdm.browserVersion })
        : mt(lang, 'plugin.widevineMissing'),
      version: widevineCdm ? widevineCdm.version : null,
      enabled: !!widevineCdm
    },
    {
      name: mt(lang, 'plugin.h264Name'),
      description: mt(lang, 'plugin.h264Desc'),
      version: null,
      enabled: true
    }
  ];
});

ipcMain.handle('settings:exportSpaces', async () => {
  const result = await dialog.showSaveDialog(requireMainWindow(), {
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
  const result = await dialog.showOpenDialog(requireMainWindow(), {
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
      // Field-by-field, not `{ ...s }`: this object comes from a file the user
      // was handed by someone else, and a spread copied every key in it
      // verbatim — including defaultUrl, which later gets loadURL()'d by the
      // "Ir a la URL por defecto" menu item and by every account created in
      // that space. The account URLs below were already sanitized; the space's
      // own URL was the one that wasn't. Same whitelist spaces:update uses.
      data.spaces.push({
        id: newId,
        name: typeof s.name === 'string' ? s.name : mt(data.settings.language || 'es', 'main.defaultSpaceNameGeneric'),
        color: typeof s.color === 'string' ? s.color : '#4f8cff',
        icon: SPACE_ICON_KEYS.includes(s.icon) ? s.icon : 'grid',
        defaultUrl: safeStartUrl(s.defaultUrl),
        defaultLayout: LAYOUT_MODES.has(s.defaultLayout) ? s.defaultLayout : 'single'
      });
    });
    (parsed.accounts || []).forEach((a) => {
      const rawUrl = String(a.url || '').trim();
      const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : rawUrl ? `https://${rawUrl}` : 'about:blank';
      data.accounts.push({
        id: crypto.randomUUID(),
        name: a.name || null,
        url: safeUrl,
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


ipcMain.handle('bookmarks:add', (_e, { title, url }) => {
  // Same scheme check bookmarks:import already applies — two paths writing to
  // the same list had two different rules, so file://, javascript: and data:
  // were rejected on import but accepted here (and from the Ctrl+D shortcut).
  if (!isAllowedBookmarkUrl(url)) return data;
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
  const result = await dialog.showSaveDialog(requireMainWindow(), {
    defaultPath: 'marcadores-nexa-browser.html',
    filters: [{ name: 'Marcadores (HTML)', extensions: ['html'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    // Netscape Bookmark File format — the universal export/import standard
    // supported by Chrome, Firefox, Brave and Edge.
    const items = data.bookmarks.map((b) => `    <DT><A HREF="${escapeHtml(b.url)}">${escapeHtml(b.title)}</A>`).join('\n');
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
  const result = await dialog.showOpenDialog(requireMainWindow(), {
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
      if (!isAllowedBookmarkUrl(b.url)) return; // skip file://, javascript:, data: etc.
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
  const result = await dialog.showOpenDialog(requireMainWindow(), {
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const rows = parseCsv(raw);
    if (!rows.length) return { ok: false, error: mt(data.settings.language || 'es', 'main.emptyOrUnrecognizedFile') };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      name: header.indexOf('name'),
      url: header.indexOf('url'),
      username: header.findIndex((h) => h === 'username' || h === 'login'),
      password: header.indexOf('password')
    };
    if (idx.url === -1 || idx.password === -1) {
      return { ok: false, error: mt(data.settings.language || 'es', 'err.csvFormat') };
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

ipcMain.handle('autofill:query', (e, origin) => {
  const host = hostnameOf(origin);
  if (!host) return [];
  // Verify that the real sender frame URL matches the claimed origin so a
  // compromised renderer can't request credentials for a different domain.
  // Fails CLOSED: e.senderFrame is null whenever the frame has already been
  // disposed (it navigated away, or was destroyed, while this invoke was in
  // flight — a documented and genuinely reachable Electron state), and an
  // unparseable frame URL (about:blank, data:, blob:) also yields null here.
  // The previous `senderHost && ...` form skipped the check entirely in all of
  // those cases, which meant the caller got credentials for whatever origin it
  // simply claimed. There is no legitimate caller that can't prove its origin.
  const senderHost = hostnameOf(e.senderFrame?.url || '');
  if (!senderHost || senderHost !== host) return [];
  return data.passwords
    .filter((p) => hostnameOf(p.url) === host)
    .map((p) => ({ username: p.username, password: passwordSecrets.get(p.id) || '', name: p.name, url: p.url }));
});

// The only channel that hands back real password values for display — called
// on demand when the renderer opens Configuración → Contraseñas, not folded
// into the general state broadcast (see the comment on passwordSecrets).
ipcMain.handle('passwords:list', (e) => {
  // Only the main chrome window (settings panel) should be able to list
  // all passwords. Account webviews use account-preload.js which does not
  // expose this channel, but a belt-and-suspenders sender check ensures
  // that even if that changes, credential data never leaks to a webview.
  // Fails CLOSED: the old `mainWindow && ...` form let EVERY sender through
  // whenever mainWindow was null or already destroyed (before createWindow,
  // during shutdown, or while a popped-out account window outlives it), which
  // is the opposite of what a belt-and-suspenders check is for. No main window
  // means there is no legitimate caller for this channel at all.
  const win = liveMainWindow();
  if (!win || e.sender !== win.webContents) return [];
  return data.passwords.map((p) => ({ ...p, password: passwordSecrets.get(p.id) || '' }));
});

// The proxy password for one account, for the account editor to prefill its
// field with. Same main-window-only sender check as passwords:list above, and
// for the same reason: this is the only channel that hands the real value
// back, and it is deliberately not part of the state broadcast.
ipcMain.handle('proxy:getPassword', (e, { id }) => {
  const win = liveMainWindow();
  if (!win || e.sender !== win.webContents) return '';
  return getProxyPassword(id);
});

ipcMain.handle('passwords:add', (_e, { name, url, username, password }) => {
  if (!url || !password) return { ok: false, error: mt(data.settings.language || 'es', 'main.urlPasswordRequired') };
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
function scrapeGameWalletScript() {
  return `(() => {
    const parseAmount = (value) => {
      if (value == null) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      const suffix = (raw.match(/[kmb]$/i) || [null])[0];
      const mult = suffix && suffix.toLowerCase() === 'k' ? 1000 : suffix && suffix.toLowerCase() === 'm' ? 1000000 : suffix && suffix.toLowerCase() === 'b' ? 1000000000 : 1;
      const cleaned = raw.replace(/[^\\d.,-]/g, '').replace(/\\.(?=\\d{3}(?:\\D|$))/g, '').replace(/,(?=\\d{3}(?:\\D|$))/g, '').replace(',', '.');
      const n = Number(cleaned);
      return Number.isFinite(n) ? Math.round(n * mult) : null;
    };
    const visible = (el) => {
      try {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      } catch {
        return false;
      }
    };
    const textOf = (el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const candidates = Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text);
    let gold = null;
    let goldSource = null;
    const MAX_REASONABLE_DIAMONDS = 10000000;
    const diamondCandidates = [];
    const goldCandidates = [];
    const pushGold = (amount, item, reason) => {
      if (amount == null || amount < 0) return;
      const text = item && item.text ? item.text.replace(/\\s+/g, ' ') : '';
      const rect = item && item.rect ? item.rect : { left: 0, top: 9999 };
      const low = normalize(text);
      let score = 0;
      if (amount > 0) score += 80;
      if (/\\$\\s*[\\d.,]+\\s*[kmb]?/i.test(text)) score += 70;
      if (reason === 'visual-shop') score += 260;
      if (reason === 'visual-hud') score += 160;
      if (low.includes('buy') || low.includes('comprar') || low.includes('efficiency')) score -= 90;
      if (rect.top < 520) score += 25;
      if (rect.left > window.innerWidth / 2) score += 15;
      goldCandidates.push({ amount, score, reason });
    };
    const pushDiamond = (amount, item, reason) => {
      if (amount == null || amount < 0 || amount > MAX_REASONABLE_DIAMONDS) return;
      if (!String(reason || '').startsWith('diamond-store')) return;
      const text = item && item.text ? item.text.replace(/\\s+/g, ' ') : '';
      const rect = item && item.rect ? item.rect : { left: 9999, top: 9999 };
      const low = normalize(text);
      let score = 0;
      if (amount > 0) score += 100;
      if (/\\d[\\d.,]*\\s*[kmb]?\\s*(diamonds?|diamantes?)/i.test(text)) score += 60;
      if (/(diamonds?|diamantes?)\\s*\\d[\\d.,]*\\s*[kmb]?/i.test(text)) score += 45;
      if (reason === 'diamond-balance-pattern') score += 80;
      if (reason === 'diamond-store-balance') score += 250;
      if (reason === 'diamond-store-label-near-number') score += 230;
      if (low.includes('buy') || low.includes('comprar')) score -= 50;
      if (low.includes('store') || low.includes('market') || low.includes('boosts') || low.includes('clans')) score += 20;
      if (rect.left < 260) score += 30;
      if (rect.top < 190) score += 15;
      diamondCandidates.push({ amount, score, reason });
    };
    const closestPanel = (el) => {
      let current = el;
      while (current && current !== document.body) {
        const rect = current.getBoundingClientRect();
        if (rect.width >= 320 && rect.height >= 240) return current;
        current = current.parentElement;
      }
      return null;
    };
    const storeTitle = candidates
      .filter((item) => normalize(item.text).includes('diamond store'))
      .sort((a, b) => a.text.length - b.text.length)[0];
    const diamondStoreScope = storeTitle ? closestPanel(storeTitle.el) : null;
    if (diamondStoreScope) {
      const scoped = Array.from(diamondStoreScope.querySelectorAll('*'))
        .filter(visible)
        .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
        .filter((item) => item.text);
      for (const item of scoped) {
        const text = item.text.replace(/\\s+/g, ' ');
        const exact = text.match(/^\\s*(\\d[\\d.,]*\\s*[kmb]?)\\s*(diamonds?|diamantes?)\\s*$/i);
        if (exact) pushDiamond(parseAmount(exact[1]), item, 'diamond-store-balance');
      }
      for (const label of scoped.filter((item) => /^(diamonds?|diamantes?)$/i.test(item.text.trim()))) {
        const labelRect = label.rect;
        const nearbyNumbers = scoped
          .filter((item) => /^\\s*\\d[\\d.,]*\\s*[kmb]?\\s*$/i.test(item.text.trim()))
          .map((item) => ({
            item,
            amount: parseAmount(item.text),
            distance: Math.abs((item.rect.left + item.rect.width / 2) - (labelRect.left + labelRect.width / 2)) +
              Math.abs((item.rect.top + item.rect.height / 2) - (labelRect.top + labelRect.height / 2))
          }))
          .filter((entry) => entry.amount != null && entry.distance < 90)
          .sort((a, b) => a.distance - b.distance);
        if (nearbyNumbers[0]) pushDiamond(nearbyNumbers[0].amount, nearbyNumbers[0].item, 'diamond-store-label-near-number');
      }
    }
    // Reuses \`candidates\` (built once at the top) instead of walking
    // document.querySelectorAll('body *') a second time and re-running
    // visible()/textOf() over every element again. Both of those force
    // synchronous layout per element (getBoundingClientRect, getComputedStyle,
    // innerText), so the duplicate pass was doubling the single most expensive
    // thing this script does — on the same thread the game renders its canvas,
    // for every open account, on every poll. Identical result: the filter
    // below only ever looked at the same {el, text, rect} shape.
    const shopTitle = candidates
      .filter((item) => /mark'?s shop/i.test(item.text))
      .sort((a, b) => a.text.length - b.text.length)[0];
    const shopScope = shopTitle ? closestPanel(shopTitle.el) : null;
    if (shopScope) {
      const scoped = Array.from(shopScope.querySelectorAll('*'))
        .filter(visible)
        .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
        .filter((item) => item.text);
      for (const item of scoped) {
        const text = item.text.replace(/\\s+/g, ' ');
        const match = text.match(/\\$\\s*[\\d.,]+\\s*[kmb]?/i);
        if (match) pushGold(parseAmount(match[0]), item, 'visual-shop');
      }
    }
    for (const item of candidates) {
      const text = item.text.replace(/\\s+/g, ' ');
      const low = normalize(text);
      if (/\\$\\s*[\\d.,]+\\s*[kmb]?/i.test(text)) pushGold(parseAmount(text.match(/\\$\\s*[\\d.,]+\\s*[kmb]?/i)[0]), item, 'visual-hud');
      if (/(diamond|diamante|diamantes|💎)/.test(low)) {
        const beforeLabel = text.match(/(\\d[\\d.,]*\\s*[kmb]?)\\s*(?:diamonds?|diamantes?)/i);
        const afterLabel = text.match(/(?:diamonds?|diamantes?)\\s*(\\d[\\d.,]*\\s*[kmb]?)/i);
        pushDiamond(parseAmount(beforeLabel && beforeLabel[1]), item, 'diamond-balance-pattern');
        pushDiamond(parseAmount(afterLabel && afterLabel[1]), item, 'diamond-balance-pattern');
      }
    }
    for (const img of Array.from(document.images || [])) {
      const meta = normalize([img.alt, img.title, img.src, img.getAttribute('aria-label')].filter(Boolean).join(' '));
      if (!/(diamond|diamante|diamantes)/.test(meta) || !visible(img)) continue;
      for (const el of [img.parentElement, img.closest('div'), img.closest('button')].filter(Boolean)) {
        const text = textOf(el);
        if (!text || text.length > 80) continue;
        pushDiamond(parseAmount(text), { text, rect: el.getBoundingClientRect() }, 'diamond-image-nearby-text');
      }
    }
    const bestDiamond = diamondCandidates
      .filter((item) => Number.isFinite(item.amount))
      .sort((a, b) => b.score - a.score || b.amount - a.amount)[0];
    const bestGold = goldCandidates
      .filter((item) => Number.isFinite(item.amount))
      .sort((a, b) => b.score - a.score || b.amount - a.amount)[0];
    if (bestGold) {
      gold = bestGold.amount;
      goldSource = bestGold.reason;
    }
    const diamonds = bestDiamond ? bestDiamond.amount : null;
    return { gold, goldSource, walletSource: bestGold ? 'visual' : null, diamonds, diamondsSource: bestDiamond ? 'diamond-store' : null };
  })();`;
}

// The wallet scrape walks every element in the game's DOM and reads layout
// (getBoundingClientRect/getComputedStyle/innerText) for each one, so it is by
// far the most expensive thing this file asks a game renderer to do. Two
// things bound that cost, both of which were missing:
//
//  1. huntTelemetryEnabled. Turning that off already stops the WebSocket frame
//     poll (attachGameCaptureFor bails immediately), and the Configuración
//     hint promises it trades panel data for "one less thing competing with
//     the game's own canvas render thread". This scrape ignored the setting
//     entirely, so the cheap half was being switched off while the expensive
//     half kept running every 5s.
//  2. Its own cadence. It used to run on every gameStats:get, i.e. the
//     renderer's 5s stats poll — but gold and diamonds are a balance the user
//     glances at, not a rate that needs 5s freshness. WALLET_SCRAPE_MIN_GAP_MS
//     decouples the two: stats keep their 5s tick, the DOM walk happens at
//     most once a minute. The explicit post-navigation scrapes elsewhere in
//     this file (did-navigate-in-page / did-finish-load) are unaffected —
//     they call updateWallet directly and are what makes a fresh login show a
//     balance immediately.
const WALLET_SCRAPE_MIN_GAP_MS = 60 * 1000;
let lastWalletScrapeAt = 0;

async function refreshGameWalletSnapshots() {
  if (data.settings.huntTelemetryEnabled === false) return;
  const now = Date.now();
  if (now - lastWalletScrapeAt < WALLET_SCRAPE_MIN_GAP_MS) return;
  lastWalletScrapeAt = now;
  const tasks = [];
  for (const account of data.accounts) {
    if (account.closed) continue;
    const wc = views.get(account.id);
    if (!wc || wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) continue;
    tasks.push(wc.executeJavaScript(scrapeGameWalletScript())
      .then((wallet) => gameTelemetry.updateWallet(account.id, wallet))
      .catch(() => {}));
  }
  await Promise.allSettled(tasks);
}

async function pulseGameRealtimeConnection(wc) {
  const report = { ok: false, pulsed: false };
  if (!wc || wc.isDestroyed()) return { ...report, error: mt(data.settings.language || 'es', 'err.webContentsUnavailable') };
  try {
    // Used to force a real offline/online pulse via CDP Network conditions
    // to make the game's WS reconnect. Dropped: that's a genuine navigator
    // network state change, and the game's own client treats any WS
    // reconnect as a connection-loss event — it kicks the user back to the
    // shop/depot as a "safe" screen, killing the farming session it was
    // supposed to unstick. Any way of forcing a reconnect (real network
    // drop or closing the socket from JS) hits the same client-side
    // handler, so the fix is to stop forcing reconnects at all and only
    // send soft wake events the game's own polling/visibility logic may
    // pick up on its own schedule.
    await wc.executeJavaScript(`
      try {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new CustomEvent('nexa-reconnect', { detail: { reason: 'pulse' } }));
      } catch(e) {}
    `);
    report.pulsed = true;
    return { ...report, ok: true };
  } catch (/** @type {any} */ err) {
    return { ...report, error: String((err && err.message) || err) };
  }
}

ipcMain.handle('gameStats:get', async () => {
  await refreshGameWalletSnapshots();
  // Scoped to accounts that are actually open — this handler runs on the
  // renderer's 5s poll, and game-telemetry keeps state for every account that
  // ever attached this session, so unscoped it recomputed and serialized full
  // stats for closed accounts too, forever.
  return gameTelemetry.getAllStats(data.accounts.filter((a) => !a.closed).map((a) => a.id));
});

// On-demand full collection for one account (see getCollection's comment in
// game-telemetry.js) — deliberately not part of the 5s gameStats payload.
ipcMain.handle('gameStats:getCollection', (_e, { id }) => gameTelemetry.getCollection(id));

// For the Tier List / Comparador / Caza & XP tools — works even if the user
// opens them before any account has attached to the game (triggers the same
// cached fetch attachCapture() would have).
ipcMain.handle('pokeFormulas:getCreatureCatalog', async (_e, { forceRefresh } = {}) => {
  await gameTelemetry.ensureCreatureCatalog(!!forceRefresh);
  return {
    creatures: gameTelemetry.getCreatureCatalogArray(),
    meta: gameTelemetry.getCreatureCatalogMeta()
  };
});

// For the sell-lock item picker in the account modal.
ipcMain.handle('pokeFormulas:getItemCatalog', async () => {
  await gameTelemetry.ensureItemPriceCatalog();
  return gameTelemetry.getItemCatalogArray();
});

// pokes:get (Mi Equipo's data source) assumes the account is actually ON
// poke.idleworld.online right now — an account sitting on the login page,
// about:blank, or literally any other site (these are general-purpose
// browser tabs, not exclusively game tabs) made a game-only request throw
// straight into the renderer — confirmed live. This guard turns that into a
// normal { ok: false } result with a clear message instead.
function requireGameWebContents(id) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  if (!gameTelemetry.isGameUrl(wc.getURL())) {
    return { error: mt(data.settings.language || 'es', 'err.notInGame') };
  }
  return { wc };
}

// Personal Depot's Pokémon subtab (Equipo/Box) only ever read whatever
// `pokes` frame the server happened to push on its own — same passive-only
// bug the family depot had before its own forceRefresh fix. If no `pokes`
// frame had fired yet this session (e.g. right after connecting, before any
// level-up/capture/sale), Equipo/Box stayed empty forever even with real
// Pokémon in the collection. Mirrors family:get below: actively ask via the
// game's own WebSocket and wait for the real frame instead of trusting
// whatever's already cached.
ipcMain.handle('pokes:get', async (_e, { id }) => {
  const { wc, error } = requireGameWebContents(id);
  if (!wc) return { ok: false, error };
  try {
    const waitPromise = gameTelemetry.waitForNextPokes(id);
    const sent = await wc.executeJavaScript(sendGameSocketFrameScript({ type: 'pokes-get' }));
    if (!sent) return { ok: false, error: mt(data.settings.language || 'es', 'err.socketUnavailable') };
    const confirmed = await waitPromise;
    if (!confirmed) return { ok: false, error: mt(data.settings.language || 'es', 'err.serverTimeout') };
    return { ok: true };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});


const CALC_STAT_KEYS = ['hp', 'atk', 'def', 'spatk', 'spdef', 'speed'];
ipcMain.handle('pokeFormulas:computeGrowth', async (_e, payload) => {
  const { speciesId, level, quality, observed, projLevel } = payload || {};
  if (!speciesId || !level || !quality || !observed) return { error: 'missing_fields' };
  await gameTelemetry.ensureCreatureCatalog();
  const creature = gameTelemetry.getCreatureCatalogArray().find((c) => c.pokeId === speciesId);
  if (!creature) return { error: 'unknown_species' };
  const base = {
    hp: creature.baseHp, atk: creature.baseAtk, def: creature.baseDef,
    spatk: creature.baseSpAtk, spdef: creature.baseSpDef, speed: creature.baseSpeed
  };
  const targetLevel = projLevel || level;
  let ivMin = 0, ivMax = 0, statsSumAtProj = 0;
  const rows = CALC_STAT_KEYS.map((key) => {
    const obs = Number(observed[key]);
    const res = pokeFormulas.inferGrowth(base[key], level, quality, obs, key);
    const min = Math.min(...res.values), max = Math.max(...res.values);
    const mid = Math.round((min + max) / 2);
    ivMin += min; ivMax += max;
    const projected = pokeFormulas.growthStat(base[key], mid, targetLevel, quality, key);
    statsSumAtProj += projected;
    return { key, min, max, observed: obs, projected };
  });
  const projectedPower = pokeFormulas.powerFor(statsSumAtProj, quality);
  const band = pokeFormulas.qualityBand(quality);
  return { creatureName: creature.name, rows, ivMin, ivMax, projectedPower, band, quality };
});

// ── Memory optimizer ────────────────────────────────────────────────────────
// Safe operations only: clears HTTP cache and Cache Storage (cached files,
// service-worker caches) — never touches cookies, localStorage, IndexedDB or
// any other storage that keeps the user logged in. Inactive renderers are
// also asked to GC their own JS heap (window.gc(), best-effort). This used
// to also force a CDP memory purge (Memory.forciblyPurgeJavaScriptMemory) —
// dropped once game accounts stopped attaching the CDP debugger at all (see
// game-telemetry.js), since that purge could disrupt an account's live
// JS/WS state mid-session anyway — exactly the kind of silent hiccup that
// can bounce the game's client back to its spawn/depot screen without the
// page ever reloading or the user noticing anything happened.
let lastOptimizeAt = Date.now();
let optimizeRunning = false;

function broadcastOptimizeStatus() {
  const win = liveMainWindow();
  if (!win) return;
  win.webContents.send('memory:optimizeStatus', {
    lastOptimizeAt,
    running: optimizeRunning,
    dueIn: Math.max(0, lastOptimizeAt + 24 * 60 * 60 * 1000 - Date.now())
  });
}

// One implementation, two tiers. These were two ~60-line functions whose only
// real difference was whether the per-account growth threshold applies —
// everything else (the dedup-by-storagePath loop, the cache clear, the main
// session clear, the inactive-renderer GC pass) was duplicated verbatim,
// including the GC loop appearing twice. This file already documents, in
// several places, that copy-pasting a block like this is what shipped a real
// bug before; the optimizer was the last remaining instance.
//
//  - 'safe' (the 24h/pressure auto-loop and the toolbar button) skips accounts
//    under the configured cache-growth threshold, mid-purchase, mid-page-load
//    or currently RECOVERING, via memory-optimizer.js's shouldSkipOptimize.
//  - 'deep' (manual only) clears every session regardless of size. That is the
//    ONLY difference — "deep clean" means "don't size-gate", not "touch more".
//
// Both tiers obey the same hard rule: cookies, localStorage, IndexedDB and
// anything else that keeps an account logged in are never touched.
async function optimizeMemory({ gated }) {
  if (optimizeRunning) return { ok: false, reason: 'already running' };
  optimizeRunning = true;
  broadcastOptimizeStatus();
  const thresholdMb = (data.settings.stability && data.settings.stability.memoryGrowthThresholdMb) || memoryOptimizer.DEFAULT_MEMORY_GROWTH_THRESHOLD_MB;
  const result = { sessionsCleaned: 0, sessionsSkipped: 0, viewsPurged: 0, cacheCleared: 0 };
  const label = gated ? 'optimize' : 'optimize/deep';
  try {
    const clearedSessions = new Set();
    for (const account of data.accounts) {
      const wc = views.get(account.id);
      const ses = wc && !wc.isDestroyed() ? wc.session : session.fromPartition(accountPartition(account.id));
      const key = ses.storagePath || account.id;
      if (clearedSessions.has(key)) continue;

      if (gated) {
        let cacheSizeMb = 0;
        try {
          const bytes = await ses.getCacheSize();
          cacheSizeMb = bytes / (1024 * 1024);
        } catch { /* getCacheSize unsupported/unavailable — treat as 0, safe-side skip below */ }

        const accountState = connectionManagers.has(account.id) ? connectionManagers.get(account.id).getState().state : null;
        const { skip, reason } = memoryOptimizer.shouldSkipOptimize({
          cacheSizeMb,
          thresholdMb,
          accountState,
          isLoading: !!(wc && !wc.isDestroyed() && typeof wc.isLoadingMainFrame === 'function' && wc.isLoadingMainFrame())
        });
        if (skip) {
          result.sessionsSkipped++;
          console.log(`[${label}] skipping`, account.id, '—', reason);
          continue;
        }
      }

      clearedSessions.add(key);
      try {
        // 1. HTTP disk cache — just cached network responses, not auth state
        //    or game data.
        await ses.clearCache();
        // Cache Storage API (service-worker offline caches) — also safe.
        await ses.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] });
        result.sessionsCleaned++;
      } catch (err) {
        // sessionsCleaned is only incremented on success, so the count was
        // always honest — but a session that fails every time reported
        // nothing at all, and the 24h auto-loop just kept retrying it
        // forever with no way to find out why.
        console.warn(`[${label}] failed to clear the cache for`, account.id, err);
      }
    }
    // Also clear the main window's session.
    try {
      await session.defaultSession.clearCache();
      result.cacheCleared++;
    } catch (err) {
      console.warn(`[${label}] failed to clear the main session cache`, err);
    }

    // 2. For INACTIVE account renderers: ask the renderer to GC its own JS
    //    heap. The active account is left untouched so farming isn't broken.
    //    Works only if the page exposes gc() — best-effort, no CDP involved
    //    (game accounts no longer attach the CDP debugger at all since the
    //    telemetry capture migrated to a passive JS patch). Renderers never
    //    get --js-flags=--expose-gc, so window.gc is realistically always
    //    undefined right now — only counting a REAL purge (instead of
    //    unconditionally incrementing) keeps viewsPurged from silently
    //    claiming JS-heap purges that never happened.
    const activeId = data.settings.activeAccountId;
    for (const [accountId, wc] of views.entries()) {
      if (accountId === activeId || wc.isDestroyed()) continue;
      const purged = await wc.executeJavaScript(
        '(() => { try { if (typeof window.gc === "function") { window.gc(); return true; } return false; } catch (e) { return false; } })()'
      ).catch(() => false);
      if (purged) result.viewsPurged++;
    }

    lastOptimizeAt = Date.now();
  } finally {
    optimizeRunning = false;
    broadcastOptimizeStatus();
  }
  return { ok: true, ...result };
}

const optimizeMemorySafe = () => optimizeMemory({ gated: true });
const optimizeMemoryDeepClean = () => optimizeMemory({ gated: false });

// A blind 24h timer alone means an account genuinely growing fast (several
// accounts open a long time) waits up to 24h before getting any relief, even
// while real memory pressure is already building. app.getAppMetrics() is
// data Electron already tracks internally per-process — no extra cost to
// read — so it's used as a second, independent trigger alongside the 24h
// one, without changing what optimizeMemorySafe() itself does or its
// per-account shouldSkipOptimize gating.
const MEMORY_PRESSURE_THRESHOLD_MB = 6000;
function totalAccountMemoryMb() {
  try {
    return app.getAppMetrics().reduce((sum, m) => {
      const kb = m.memory && typeof m.memory.workingSetSize === 'number' ? m.memory.workingSetSize : 0;
      return sum + kb / 1024;
    }, 0);
  } catch {
    return 0;
  }
}

// Real OS-level free memory, not just our own processes' usage — Electron
// exposes this directly (process.getSystemMemoryInfo(), KB), no native calls
// or shelling out needed. Firefox-style: reacts to actual system pressure
// (another heavy app eating RAM counts too), which totalAccountMemoryMb()
// alone can't see since it only sums our own working sets.
function systemFreeMemoryInfo() {
  try {
    const info = process.getSystemMemoryInfo();
    return { freeMb: info.free / 1024, totalMb: info.total / 1024 };
  } catch {
    return { freeMb: null, totalMb: null };
  }
}

// Auto-optimize: check every 30 min, fire when 24 h have elapsed, OR when
// our own processes' memory crosses MEMORY_PRESSURE_THRESHOLD_MB, OR when
// the whole system's free RAM drops below memoryOptimizer's percentage
// threshold — whichever comes first. All three only ever lead to the same
// safe-tier cache clear (optimizeMemorySafe never touches an account's
// connection/session), so this never disconnects anything, no matter which
// trigger fires.
function startAutoOptimizeLoop() {
  setInterval(async () => {
    if (optimizeRunning) return;
    const elapsed = Date.now() - lastOptimizeAt;
    if (elapsed >= 24 * 60 * 60 * 1000) {
      console.log('[optimize] 24 h threshold reached — running auto-optimization (safe tier)');
      await optimizeMemorySafe();
      return;
    }
    const memoryMb = totalAccountMemoryMb();
    if (memoryMb >= MEMORY_PRESSURE_THRESHOLD_MB) {
      console.log('[optimize] memory pressure threshold reached (', Math.round(memoryMb), 'MB across all processes) — running auto-optimization early (safe tier)');
      await optimizeMemorySafe();
      return;
    }
    const { freeMb, totalMb } = systemFreeMemoryInfo();
    if (memoryOptimizer.systemMemoryPressureHigh({ freeMb, totalMb })) {
      console.log('[optimize] system-wide free memory low (', Math.round(freeMb ?? 0), '/', Math.round(totalMb ?? 0), 'MB free) — running auto-optimization early (safe tier)');
      await optimizeMemorySafe();
    }
  }, 30 * 60 * 1000);
}

// ── Connection manager wiring ────────────────────────────────────────────────
// Feeds real account lifecycle events into game-connection-manager.js's pure
// state machine and executes its recovery levels. Entirely gated behind
// settings.stability.enabled (default false) — everything below is inert
// until a user opts in from Configuración → Poke Idle World → Estabilidad.
// This AUGMENTS the existing freeze-detector/render-process-gone handling,
// it does not replace or remove either — when disabled, both keep behaving
// exactly as before this stage.
const connectionManagers = new Map(); // accountId -> manager instance
const RECOVERY_MAX_ATTEMPTS = 8;

function stabilityEnabled() {
  return !!(data.settings.stability && data.settings.stability.enabled);
}

function isGameLoginUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'poke.idleworld.online' && u.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

function getOrCreateConnectionManager(accountId) {
  let manager = connectionManagers.get(accountId);
  if (!manager) {
    manager = gameConnectionManager.createAccountConnectionManager(accountId, {
      getWc: () => views.get(accountId),
      onStateChange: (change) => {
        liveMainWindow()?.webContents.send('stability:update', change);
      },
      onRecoveryLevel: (info) => runRecoveryLevel(info).catch((err) => console.error('[stability] recovery level failed', err))
    });
    connectionManagers.set(accountId, manager);
  }
  return manager;
}

function feedConnectionEvent(accountId, event) {
  if (!stabilityEnabled()) return;
  getOrCreateConnectionManager(accountId).handleEvent(event, Date.now());
}

// Thin wrapper around gameTelemetry.attachCapture — when stability is
// enabled, wires its onFrame callback into the connection manager; when
// disabled, calls it exactly as every version before this stage did (no
// options, no behavior change). There's no onDetach anymore: that was a
// CDP-only concept (the debugger session dying) — the JS-based capture
// (game-telemetry.js) doesn't "detach", its interval either keeps polling
// or the webContents got destroyed, which it already handles on its own.
//
// data.settings.huntTelemetryEnabled (default true, see store.js) gates the
// whole thing: off means no capture interval ever attaches for this
// account, i.e. zero executeJavaScript() round-trips competing with the
// game's own render thread — at the cost of the hunt/drops panel having no
// data, and (only if settings.stability.enabled is also on) losing the
// FRAME_RECEIVED heartbeat signal the connection-manager uses to notice a
// stuck account. Both trade-offs are called out in the Configuración hint
// text, not hidden — see settings.huntTelemetryHint in src/i18n-data.js.
function attachGameCaptureFor(wc, accountId) {
  if (data.settings.huntTelemetryEnabled === false) return;
  if (!stabilityEnabled()) {
    gameTelemetry.attachCapture(wc, accountId);
    return;
  }
  gameTelemetry.attachCapture(wc, accountId, {
    onFrame: () => feedConnectionEvent(accountId, { type: 'FRAME_RECEIVED' })
  });
}

async function runRecoveryLevel({ accountId, level, wc, reason }) {
  if (!stabilityEnabled()) return;
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account || account.closed || !wc || wc.isDestroyed()) return;

  const manager = getOrCreateConnectionManager(accountId);
  const stop = gameConnectionManager.shouldStopRetrying({
    closed: !!account.closed,
    quitting: appQuitting,
    isLoginPage: isGameLoginUrl(wc.getURL()),
    noInternet: false,
    userDisabled: !data.settings.stability.autoRecovery,
    attemptCount: manager.getState().attemptCount,
    maxAttempts: RECOVERY_MAX_ATTEMPTS
  });
  if (stop.stop) {
    if (stop.reason === 'max-attempts-reached') feedConnectionEvent(accountId, { type: 'RECOVERY_EXHAUSTED' });
    return;
  }

  console.log('[stability] account', accountId, 'recovery level', level, '—', reason);

  if (level === 1) {
    const result = await networkHealth.checkAccountNetwork(accountId, { hostname: 'poke.idleworld.online' });
    feedConnectionEvent(accountId, { type: 'NETWORK_CHECK', result });
  } else if (level === 2) {
    // Also called by the freeze detector below — keep its signature/behavior
    // consistent between both callers.
    await pulseGameRealtimeConnection(wc).catch(() => {});
    try {
      if (typeof wc.setBackgroundThrottling === 'function') wc.setBackgroundThrottling(false);
    } catch { /* not exposed on this Electron/webview combination — best effort only */ }
    feedConnectionEvent(accountId, { type: 'RECOVERY_LEVEL_2_DONE' });
  } else if (level === 3) {
    // Used to mean "re-attach the CDP debugger" — now means "force a clean
    // re-poll cycle of the JS capture" (gameTelemetry.reattachCapture).
    gameTelemetry.reattachCapture(wc, accountId, {
      onFrame: () => feedConnectionEvent(accountId, { type: 'FRAME_RECEIVED' })
    });
    feedConnectionEvent(accountId, { type: 'WS_REATTACHED' });
  } else if (level === 4) {
    if (data.settings.stability.disconnectNotifications) {
      try {
        new Notification({
          title: 'Nexa Browser',
          body: `${account.name || 'Cuenta'}: parece desconectada del juego. Revisala cuando puedas.`
        }).show();
      } catch { /* Notification unsupported/unavailable — non-fatal */ }
    }
    // Last-resort auto-reload: opt-in, default OFF, and still bounded by the
    // existing crashCounts ceiling (main.js's render-process-gone handler),
    // so this can never reload more times than a real crash would allow.
    if (data.settings.stability.lastResortAutoReload) {
      if (getCrashCount(accountId) < 3) {
        recordCrash(accountId);
        setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 1000);
      }
    }
  }
}

ipcMain.handle('stability:getAccountState', (_e, { id }) => {
  if (!connectionManagers.has(id)) return null;
  return connectionManagers.get(id).getState();
});

// On-demand "test my connection" for the Estabilidad tab — same probe
// (network interface / DNS / HTTPS reachability to the game's own host)
// that Level 1 recovery already runs automatically; this just exposes it
// as a manual, on-request check so a user can see it directly instead of
// having to wait for a freeze to trigger it.
ipcMain.handle('stability:testNetwork', async (_e, { id }) => {
  return await networkHealth.checkAccountNetwork(id, { hostname: 'poke.idleworld.online' });
});

ipcMain.handle('stability:manualReconnect', (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountUnavailable') };
  // Manual override: bypasses the current backoff timer, but still respects
  // shouldStopRetrying's other conditions (closed/quitting/login-page).
  runRecoveryLevel({ accountId: id, level: 3, wc, reason: 'manual-reconnect' })
    .catch((err) => console.error('[stability] manual reconnect failed', err));
  return { ok: true };
});

// ── Global crash/GPU/Network-Service differentiation ─────────────────────────
// app-level render-process-gone/child-process-gone additionally cover
// non-account renderers and GPU/Network Service/Utility/Audio processes —
// AUGMENTS the existing per-account wc.on('render-process-gone', ...) handler
// in wireAccountWebContents (which still runs exactly as before), doesn't
// replace it.
let consecutiveGpuCrashes = 0;
let lastGpuCrashAt = 0;
const GPU_CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000;
// Cumulative for the whole app session, never reset by elapsed time — this is
// what catches a GPU that resets a few times an hour rather than several
// times a minute. Four is deliberately above "unlucky once or twice" and well
// below a day's worth of a genuinely broken driver.
let gpuCrashesThisSession = 0;
const GPU_CRASH_SESSION_LIMIT = 4;

app.on('render-process-gone', (_event, _wc, details) => {
  const info = classifyCrash({ reason: details.reason });
  console.error('[crash-global] render-process-gone —', info.severity, info.reason);
});

app.on('child-process-gone', (_event, details) => {
  const info = classifyCrash({ reason: details.reason, type: details.type });
  console.error('[crash-global] child-process-gone —', info.category, info.severity, info.reason);

  if (info.category === 'Network Service' && info.severity !== 'info') {
    // A Network Service crash affects every session at once, not just one
    // account — re-validate every open game account's WS layer rather than
    // waiting for each one's own heartbeat to notice independently.
    console.warn('[crash-global] Network Service crashed — re-validating all open game accounts');
    for (const account of data.accounts) {
      if (account.closed) continue;
      const wc = views.get(account.id);
      if (!wc || wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) continue;
      feedConnectionEvent(account.id, { type: 'WS_DETACHED', reason: 'network-service-crashed' });
    }
  }

  if (info.shouldDisableGpu) {
    const now = Date.now();
    consecutiveGpuCrashes = (now - lastGpuCrashAt < GPU_CRASH_LOOP_WINDOW_MS) ? consecutiveGpuCrashes + 1 : 1;
    gpuCrashesThisSession += 1;
    lastGpuCrashAt = now;

    // Recovering the visible page is the urgent part, and it has to happen
    // whether or not the counters below ever decide to fall back to software
    // rendering. Confirmed live on a hybrid-graphics laptop whose NVIDIA
    // driver resets the GPU under load (Windows event nvlddmkm 153, one
    // second before each of these): the GPU process dying takes every WebGL
    // context in every account down with it, so the game canvases go black
    // and stay black — the render loop keeps running at full FPS with
    // nothing to draw on, which is why it doesn't look like a crash and
    // nothing here used to notice.
    recoverAccountsAfterGpuCrash();

    // Two independent triggers, because a GPU can fail in two very different
    // shapes and the original 3-in-5-minutes rule only caught one of them:
    //   - a real crash loop (several in a row, fast), and
    //   - a slow drip: one reset every 30-60 minutes for days, which never
    //     accumulates inside a 5-minute window because the counter keeps
    //     resetting to 1. Confirmed live: 95 driver resets over two weeks
    //     and the fallback below never once fired.
    const { fallback, trigger } = shouldFallBackToSoftwareRendering({
      consecutiveCrashes: consecutiveGpuCrashes,
      sessionCrashes: gpuCrashesThisSession,
      sessionThreshold: GPU_CRASH_SESSION_LIMIT
    });
    if (fallback && data.settings.hardwareAcceleration !== false) {
      console.error(
        '[crash-global] GPU failing —',
        trigger === 'loop'
          ? `${consecutiveGpuCrashes} crashes within ${GPU_CRASH_LOOP_WINDOW_MS / 1000}s`
          : `${gpuCrashesThisSession} crashes this session`,
        '— disabling hardware acceleration for the next launch'
      );
      data.settings.hardwareAcceleration = false;
      persist();
      broadcastState();
      try {
        new Notification({
          title: 'Nexa Browser',
          body: 'La GPU falló varias veces — se desactivó la aceleración por hardware para el próximo inicio. Podés reactivarla en Configuración.'
        }).show();
      } catch { /* Notification unsupported/unavailable — non-fatal */ }
    }
  }
});

// Reloads only the accounts whose WebGL context the GPU crash actually
// killed. Deliberately NOT "reload everything": this app's whole premise is
// long-lived farming sessions, and a reload costs the account its in-page
// state — the same reason pulseGameRealtimeConnection stopped forcing
// reconnects (see its comment). An account whose page never used WebGL, or
// whose engine handled webglcontextrestored on its own, is left alone.
//
// The delay is not cosmetic: Chromium needs a moment to bring a fresh GPU
// process up, and a page reloaded before that just loses its new context too.
const GPU_RECOVERY_DELAY_MS = 3000;
// Floor between automatic reloads of the same account, so a driver that
// resets every few seconds can't turn this into a reload loop that's worse
// than the black screen it's fixing.
const GPU_RECOVERY_MIN_GAP_MS = 60 * 1000;
const lastGpuRecoveryAt = new Map(); // accountId -> timestamp
let gpuRecoveryPending = false;

// Asks the page whether any canvas it owns has a lost context. Cheap, and
// side-effect free: getContext() on a canvas that already has a context of
// another type returns null rather than creating one.
const DETECT_LOST_CONTEXT_SCRIPT = `(() => {
  try {
    for (const canvas of document.querySelectorAll('canvas')) {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl && gl.isContextLost && gl.isContextLost()) return true;
    }
    return false;
  } catch { return false; }
})()`;

function recoverAccountsAfterGpuCrash() {
  if (gpuRecoveryPending || appQuitting) return;
  gpuRecoveryPending = true;
  setTimeout(async () => {
    gpuRecoveryPending = false;
    if (appQuitting) return;
    const now = Date.now();
    for (const account of data.accounts) {
      if (account.closed) continue;
      const wc = views.get(account.id);
      if (!wc || wc.isDestroyed()) continue;
      if (now - (lastGpuRecoveryAt.get(account.id) || 0) < GPU_RECOVERY_MIN_GAP_MS) continue;
      let lost;
      try {
        lost = await wc.executeJavaScript(DETECT_LOST_CONTEXT_SCRIPT);
      } catch {
        continue; // page navigating or gone — nothing to recover
      }
      if (!lost || wc.isDestroyed()) continue;
      lastGpuRecoveryAt.set(account.id, Date.now());
      console.warn('[crash-global] account', account.id, 'lost its WebGL context to the GPU crash — reloading it');
      wc.reload();
    }
  }, GPU_RECOVERY_DELAY_MS);
}

// ── Freeze / stuck-character detector ───────────────────────────────────────
// When the game's WebSocket drops, the character stops moving and kills/XP
// drop to 0 even though the account looks "connected". Liveness is read
// straight from gameTelemetry's per-account deltas (isLikelyFrozen) — NOT
// from killsPerHour, a cumulative rate that stays positive for hours after
// a single early kill and so never actually catches a real freeze (found
// live, this was the bug). No local activity bookkeeping needed here
// anymore: game-telemetry already persists lastAnyFrameAt/lastKillAt/etc.
// per account for as long as the account exists.
const FREEZE_THRESHOLD_MS = 4 * 60 * 1000; // 4 min of staleness = probably frozen
const frozenNotifiedAt = new Map(); // prevent repeated notifications per account

function startFreezeDetectorLoop() {
  setInterval(async () => {
    for (const account of data.accounts) {
      if (account.closed) continue;
      const wc = views.get(account.id);
      if (!wc || wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) continue;
      const deltas = gameTelemetry.getDeltas(account.id);
      if (!deltas) continue;
      const frozen = gameTelemetry.isLikelyFrozen({ deltas }, FREEZE_THRESHOLD_MS);

      if (stabilityEnabled()) {
        // Hand off to the connection-manager pipeline instead of pulsing
        // directly — its own Level 2 recovery step is what actually calls
        // pulseGameRealtimeConnection, after Level 1 (network revalidation)
        // has had a chance to run first.
        feedConnectionEvent(account.id, frozen ? { type: 'FROZEN_DETECTED' } : { type: 'FRAME_RECEIVED' });
        continue;
      }

      if (!frozen) {
        frozenNotifiedAt.delete(account.id); // reset freeze notice for this account
        continue;
      }
      // Looks frozen — pulse the WS quietly to unstick it.
      const lastNotified = frozenNotifiedAt.get(account.id) || 0;
      if (Date.now() - lastNotified < 5 * 60 * 1000) continue; // max once per 5 min
      frozenNotifiedAt.set(account.id, Date.now());
      console.log('[freeze-detector] account', account.id, 'looks frozen — nudging WS');
      pulseGameRealtimeConnection(wc).catch(() => {});
    }
  }, 60 * 1000); // check every minute
}

ipcMain.handle('memory:optimize', async () => optimizeMemorySafe());
ipcMain.handle('memory:deepClean', async () => optimizeMemoryDeepClean());
ipcMain.handle('memory:getOptimizeStatus', () => ({
  lastOptimizeAt,
  running: optimizeRunning,
  dueIn: Math.max(0, lastOptimizeAt + 24 * 60 * 60 * 1000 - Date.now())
}));
// ────────────────────────────────────────────────────────────────────────────

ipcMain.handle('metrics:get', () => {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const result = {};
  for (const [id, view] of views.entries()) {
    if (view.isDestroyed()) continue; // stale entry mid-cleanup — skip rather than throw
    const pid = view.getOSProcessId();
    const m = byPid.get(pid);
    result[id] = {
      cpu: m ? m.cpu.percentCPUUsage : 0,
      memoryMB: m ? Math.round((m.memory?.workingSetSize || 0) / 1024) : 0,
      blocked: adblockManager.getBlockedCount(id)
    };
  }
  return result;
});

// Lighter alternative to metrics:get for when the per-account CPU/RAM row is
// turned off (settings.showAccountMetrics) — the shield's blocked-ads badge
// in the topbar still needs live counts, but getBlockedCount() is a cheap
// in-memory lookup, unlike app.getAppMetrics() which actually samples every
// open OS process. Keeps that opt-out honest (skips the real per-account
// sampling cost) without silently breaking a different, still-wanted
// feature.
ipcMain.handle('metrics:getBlockedCounts', () => {
  const result = {};
  for (const [id, view] of views.entries()) {
    if (view.isDestroyed()) continue; // stale entry mid-cleanup — same guard as metrics:get above
    result[id] = { cpu: 0, memoryMB: 0, blocked: adblockManager.getBlockedCount(id) };
  }
  return result;
});

ipcMain.handle('diagnostics:exportReport', async () => {
  const appMetrics = app.getAppMetrics();
  const byPid = new Map(appMetrics.map((m) => [m.pid, m]));
  const memoryStats = [];
  const accountConnectionStates = [];
  const adBlockLogFlat = [];
  const netCheckAccountIds = [];

  for (const account of data.accounts) {
    if (account.closed) continue;
    const wc = views.get(account.id);
    if (!wc || wc.isDestroyed()) continue;
    const pid = wc.getOSProcessId();
    const m = byPid.get(pid);
    memoryStats.push({
      accountId: account.id,
      cpu: m ? m.cpu.percentCPUUsage : 0,
      memoryMB: m ? Math.round((m.memory?.workingSetSize || 0) / 1024) : 0
    });
    if (connectionManagers.has(account.id)) {
      accountConnectionStates.push({ accountId: account.id, ...connectionManagers.get(account.id).getState() });
    }
    if (gameTelemetry.isGameUrl(wc.getURL())) netCheckAccountIds.push(account.id);
    const log = adblockManager.getLogForAccount(account.id);
    if (log) adBlockLogFlat.push(...log);
  }

  // Probed in parallel instead of one account at a time — each check is an
  // independent network round-trip (DNS/HTTPS to the game's own host), so
  // sequential awaiting made total report latency scale with how many game
  // accounts were open instead of just the slowest single probe.
  const networkSnapshots = await Promise.all(
    netCheckAccountIds.map(async (accountId) => {
      const snapshot = await networkHealth.checkAccountNetwork(accountId, { hostname: 'poke.idleworld.online' });
      return { accountId, ...snapshot };
    })
  );

  return diagnostics.buildReport({ accountConnectionStates, networkSnapshots, adBlockLog: adBlockLogFlat, memoryStats });
});

// Local crash reporting (see crashReporter.start() above) writes real .dmp
// files but has no viewer of its own — this just hands the folder to the
// OS file explorer so a user can find/zip them to attach to a bug report.
// fs.mkdirSync ensures there's something to open even before any crash has
// ever happened (shell.openPath on a missing folder just fails silently).
ipcMain.handle('diagnostics:openCrashDumpsFolder', async () => {
  try {
    fs.mkdirSync(CRASH_DUMPS_DIR, { recursive: true });
    const result = await shell.openPath(CRASH_DUMPS_DIR);
    return result ? { ok: false, error: result } : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/** @type {{ accountId: string, path: string }|null} */
let activeNetLogSession = null; // { accountId, path } | null — one capture at a time, kept simple on purpose

ipcMain.handle('diagnostics:startNetLog', async (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountUnavailable') };
  if (activeNetLogSession) return { ok: false, error: `ya hay una captura en curso (${activeNetLogSession.accountId})` };
  const logPath = path.join(app.getPath('userData'), `netlog-${id}-${Date.now()}.json`);
  const result = await networkHealth.startNetLogCapture(wc.session, { path: logPath, maxSizeMb: 20 });
  if (result.ok) activeNetLogSession = { accountId: id, path: logPath };
  return result;
});

ipcMain.handle('diagnostics:stopNetLog', async () => {
  if (!activeNetLogSession) return { ok: false, error: mt(data.settings.language || 'es', 'err.noCaptureRunning') };
  const wc = views.get(activeNetLogSession.accountId);
  const ses = wc && !wc.isDestroyed() ? wc.session : null;
  const result = ses ? await networkHealth.stopNetLogCapture(ses) : { ok: false, error: mt(data.settings.language || 'es', 'err.sessionGone') };
  activeNetLogSession = null;
  return result;
});

// DNS speed test — measures real resolution latency per provider (see
// dns-test.js). Never touches the OS's actual DNS config; applyCommandFor()
// only hands the renderer a PowerShell command for the user to run
// themselves, exactly as decided: Nexa Browser measures, the user applies.
// Real per-account CPU% before/after Modo Eco auto-throttling — see
// autoEcoBaselineCpu/autoEcoCurrentCpu above. Only counts accounts with
// BOTH a baseline and at least one post-eco sample; an account throttled
// less than one 5s tick ago won't have a post-eco reading yet and is left
// out rather than reported with a misleading 0%.
ipcMain.handle('eco:getSavings', () => {
  let cpuBefore = 0;
  let cpuAfter = 0;
  let sampled = 0;
  for (const id of autoEcoApplied) {
    const before = autoEcoBaselineCpu.get(id);
    const after = autoEcoCurrentCpu.get(id);
    if (before == null || after == null) continue;
    cpuBefore += before;
    cpuAfter += after;
    sampled++;
  }
  return {
    throttledCount: autoEcoApplied.size,
    sampledCount: sampled,
    cpuBefore: Math.round(cpuBefore * 10) / 10,
    cpuAfter: Math.round(cpuAfter * 10) / 10,
    savingsPercent: sampled > 0 && cpuBefore > 0 ? Math.round((1 - cpuAfter / cpuBefore) * 100) : null
  };
});

// Same picker the right-click "Bloquear este elemento" context menu item
// uses (pickElementToBlock), triggered from the shield popup's target icon
// instead — the renderer calls showViews() first (the popup itself hides
// the account views the way every other dropdown does) so the click-to-hide
// listeners land on real, visible page content.
ipcMain.handle('adblock:pickElement', async (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false };
  await pickElementToBlock(wc, data.settings.language || 'es');
  return { ok: true };
});

adblockManager.registerIpcHandlers();

ipcMain.handle('dns:test', async () => dnsTest.runSpeedTest());
ipcMain.handle('dns:getApplyCommand', (_e, { servers }) => dnsTest.applyCommandFor(servers));
ipcMain.handle('dns:getRestoreCommand', () => dnsTest.RESTORE_COMMAND);
ipcMain.handle('dns:copyCommand', (_e, { command }) => {
  clipboard.writeText(command);
  return { ok: true };
});

// On-device page translation (see translate.js) — extracts visible text
// nodes from the account's own webview, translates them locally via the
// Bergamot WASM engine (no API key, no network dependency beyond the
// one-time model download), and writes the translation back into the same
// nodes. translate:restore puts the original text back without a reload.
// accountId -> {from, to} for every account currently showing a translated
// page. Drained by startPageTranslateWatchLoop() below, which is what keeps a
// page translated through its OWN later DOM updates (a live gold counter, a
// re-rendered shop list, ...) instead of only translating once at click
// time — confirmed live that without this, any text a game rewrites after
// the initial translation silently reverts to the original language.
const translateWatching = new Map();

// accountId -> target language, for as long as the user wants this account
// kept translated — set on a successful manual translate:page, cleared only
// by translate:restore or the account closing. Deliberately separate from
// translateWatching (which tracks the CURRENT page's live MutationObserver
// state and gets cleared on every real navigation): this one is the user's
// standing preference, and is what makes did-finish-load below know to
// automatically re-translate a freshly-loaded page (e.g. right after a
// login redirect) instead of leaving the user to click the button again —
// confirmed live this was a real, repeated point of friction.
const translationEnabled = new Map();

// Chat auto-translate — a first, deliberately narrow base (see
// translate.js's CHAT_SITE_SELECTORS): only Dragon Ball Idle's chat DOM has
// been confirmed live so far. accountId -> Map(username -> {lang, count}).
// Per-account (not global) since the same username on two different
// accounts' chats has no reason to share a history — different accounts
// can even be in different clans/worlds with unrelated player rosters.
// Confidence gate (count >= 1 — a single successfully-detected message is
// already enough to trust). Originally required 2 matching detections
// before trusting a player's history, but that has a real bootstrap
// problem confirmed live: a chat where every message from a given player
// happens to be very short ("olá", "beleza", ".") never produces a SECOND
// confirmation, since franc can't confidently detect a language from one
// or two words either — the threshold could never be reached at all, so
// that player's messages just silently never got translated. A single
// detection is weaker evidence, but it's still real evidence, and a wrong
// guess only affects that one player's own short follow-up messages
// (self-correcting the moment they write something long enough for franc
// to detect on its own again).
const chatUserLanguageHistory = new Map();
const CHAT_HISTORY_CONFIDENCE_THRESHOLD = 1;
// Caps each account's inner username->{lang,count} map — unlike
// data.history (300) and data.downloads (200), this had no eviction at all,
// so an account sitting in an active game chat channel for days/weeks (this
// app's whole premise) grew it forever, one entry per distinct username ever
// seen. Map preserves insertion order, so the oldest-seen username is
// evicted first — good enough for a soft cap, not meant to be true LRU.
const CHAT_HISTORY_MAX_USERS_PER_ACCOUNT = 500;

// Returns a small result object (not just fire-and-forget) — the watch
// loop below ignores it, but this is also exposed directly over IPC (see
// translate:chatOnce) both to make this independently useful (a manual
// "translate chat now" trigger, e.g. if the 800ms tick hasn't caught up
// yet) and to make it possible to test at all — Playwright can't reach a
// <webview>'s DOM to verify a fire-and-forget effect any other way.
async function translateChatMessages(id) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  // account.url (set optimistically by account:navigate, then reasserted by
  // notifyNav on the real did-navigate event) instead of wc.getURL(): the
  // latter only updates once Electron actually commits the new navigation,
  // which lags account.url by however long the page takes to load. This
  // auto-translate poll runs every 800ms and often lands in that gap right
  // after navigating — confirmed live via e2e (translateChatOnce called
  // straight after a navigate call intermittently saw the OLD hostname,
  // wrongly reporting unsupported:true for a site chat translation DOES
  // support). account.url reflects user intent immediately and is always
  // eventually correct, so it's the more reliable source here.
  const account = getAccount(id);
  let hostname;
  try {
    hostname = new URL((account && account.url) || wc.getURL()).hostname;
  } catch {
    return { ok: false, error: mt(data.settings.language || 'es', 'err.invalidUrl') };
  }
  const selectors = translate.chatSelectorsForHost(hostname);
  if (!selectors) return { ok: true, translated: 0, unsupported: true };

  const to = data.settings.language || 'es';
  let history = chatUserLanguageHistory.get(id);
  if (!history) {
    history = new Map();
    chatUserLanguageHistory.set(id, history);
  }

  try {
    const extracted = await wc.executeJavaScript(translate.extractChatMessagesScript(selectors));
    // extracted.hidden means the chat panel is minimized/closed in the
    // game's own UI right now — extraction already short-circuited before
    // doing any real work (see extractChatMessagesScript), so this is a
    // near-free check, not a wasted translateBatch call.
    if (!extracted || !extracted.items.length) return { ok: true, translated: 0, hidden: !!(extracted && extracted.hidden) };
    // Only shown when there's actually new chat content to process — the
    // 800ms watch-loop tick would otherwise flash this on/off constantly
    // even during quiet stretches with nothing new to translate.
    wc.executeJavaScript(translate.chatTranslateStatusScript('loading')).catch(() => {});
    // Same temporary Modo Eco throttle performTranslate uses for the main
    // "Traducir página" flow — confirmed live this is a real user concern
    // (visible FPS drop while a translation batch runs, competing for CPU
    // with the game's own canvas rendering). Only actually applies if the
    // account doesn't already have manual Modo Eco on (see
    // startTranslateTempEco), and is always lifted in the finally block
    // below regardless of how this exits.
    startTranslateTempEco(id, wc);

    // Group by the detected (or history-assisted) source language so each
    // group can go through translateBatch with the correct model pair —
    // a real chat mixes languages message-by-message, unlike the rest of
    // this app's translate flow which assumes one source language per page.
    const groups = new Map(); // from -> [{ index, text }]
    for (let i = 0; i < extracted.items.length; i++) {
      const { username, text } = extracted.items[i];
      let from = await translate.detectLanguage(text);
      // Confirmed live this is most of a real chat: franc returns null
      // (no opinion) for exactly the words a translator most needs to
      // handle — "olá", "vc", "blz", "boa noite" — because they're short
      // and common-shaped across languages. An EXACT glossary match is
      // much stronger evidence than franc's own uncertain guess would be
      // even if it had one, so this is checked before falling back to
      // per-user history.
      if (!from) from = translate.glossaryLanguageFor(text);
      // Confirmed live: franc has real false positives for short/slangy
      // Portuguese chat text landing on 'es' (e.g. "Onde que vai pora
      // breedar?" detected as Spanish) — since 'es' is also this app's
      // usual target language, that misdetection made the message look
      // "already translated" and skip forever. An exact glossary match is
      // stronger evidence than franc's guess, so it's checked first, before
      // falling back to this user's history.
      from = translate.glossaryOverrideWhenSameAsTarget(from, to, text);
      const histEntry = username && history.get(username);
      if (!from && histEntry && histEntry.count >= CHAT_HISTORY_CONFIDENCE_THRESHOLD) {
        // franc couldn't tell on its own (too short) — fall back to what
        // this same player has reliably written in before.
        from = histEntry.lang;
      }
      // A confident, already-built history for this exact user in a
      // different supported language is stronger evidence than a single
      // franc guess on a short message, when no glossary word settled it.
      if (from === to && histEntry && histEntry.count >= CHAT_HISTORY_CONFIDENCE_THRESHOLD && histEntry.lang !== to) {
        from = histEntry.lang;
      }
      if (!from || from === to) continue; // already in the target language, or genuinely undetectable — leave it as-is rather than guess
      // franc recognizes languages this app has no model for at all (see
      // isSupportedLanguage's comment) — skip rather than let translateBatch
      // throw, which used to abort every OTHER language's group in the same
      // pass along with it.
      if (!translate.isSupportedLanguage(from)) continue;
      if (username) {
        const existing = history.get(username);
        if (existing && existing.lang === from) {
          existing.count += 1;
        } else {
          if (history.size >= CHAT_HISTORY_MAX_USERS_PER_ACCOUNT) {
            history.delete(history.keys().next().value);
          }
          history.set(username, { lang: from, count: 1 });
        }
      }
      if (!groups.has(from)) groups.set(from, []);
      groups.get(from).push({ index: extracted.startIndex + i, text });
    }
    if (!groups.size) {
      wc.executeJavaScript(translate.chatTranslateStatusScript('done', 0)).catch(() => {});
      return { ok: true, translated: 0, seen: extracted.items.length };
    }

    const translations = [];
    let downloadHappened = false;
    for (const [from, entries] of groups) {
      // One language group failing (network hiccup on a first-ever model
      // download, etc.) shouldn't lose every OTHER group's already-successful
      // translations — apply what worked instead of an all-or-nothing batch.
      try {
        const translated = await translate.translateBatch(from, to, entries.map((e) => e.text), {
          html: false,
          // Same modal the main "Traducir página" flow uses (see
          // translate:downloadProgress in renderer.js) — a chat that
          // suddenly needs, say, a ru->es model it's never loaded before
          // otherwise just goes quiet for several seconds with zero
          // indication anything is happening.
          onDownloadProgress: ({ filename, loaded, total }) => {
            downloadHappened = true;
            liveMainWindow()?.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
          }
        });
        entries.forEach((e, i) => translations.push({ index: e.index, text: translated[i] }));
      } catch (err) {
        console.error('[translate] chat group', from, '->', to, 'failed for', id, err);
      }
    }
    if (downloadHappened) liveMainWindow()?.webContents.send('translate:downloadFinished', { id });
    if (translations.length) await wc.executeJavaScript(translate.applyChatTranslationsScript(translations));
    if (!wc.isDestroyed()) wc.executeJavaScript(translate.chatTranslateStatusScript('done', translations.length)).catch(() => {});
    return { ok: true, translated: translations.length, seen: extracted.items.length };
  } catch (/** @type {any} */ err) {
    console.error('[translate] chat auto-translate failed for', id, err);
    if (!wc.isDestroyed()) wc.executeJavaScript(translate.chatTranslateStatusScript('done', 0)).catch(() => {});
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    stopTranslateTempEco(id, wc);
  }
}

// accountId -> true while performTranslate applied a TEMPORARY eco-throttle
// of its own (see below) — tracked so the matching disableEcoMode only ever
// fires for a throttle we actually applied, never for an account the user
// already had on manual Modo Eco (that one's the user's own choice and
// isn't ours to touch).
const translateAppliedTempEco = new Set();

function startTranslateTempEco(id, wc) {
  const account = getAccount(id);
  if (!account || account.ecoMode || translateAppliedTempEco.has(id)) return;
  translateAppliedTempEco.add(id);
  enableEcoMode(wc);
}

function stopTranslateTempEco(id, wc) {
  if (!translateAppliedTempEco.has(id)) return;
  translateAppliedTempEco.delete(id);
  if (!wc.isDestroyed()) disableEcoMode(wc);
}

// Confirmed live against a real account: a page can genuinely mix
// languages — dragonballidle.online's own menu is Spanish, but a
// Portuguese third-party helper overlay (Auto-Helper) can be layered on
// top of it. The old single from-language-for-the-whole-page approach
// (either <html lang> or one detectLanguage() call over every fragment
// joined together) always resolved to whichever language dominates by
// volume — here, the game's own already-Spanish menu — so from===to for
// the WHOLE page and the Portuguese overlay silently never got touched,
// even though translateBatch reported a non-zero "translated" count (it
// ran, it just had nothing to actually change). Per-fragment detection
// (same approach translateChatMessages already uses for mixed-language
// chat) fixes this: each fragment gets its own source-language guess,
// grouped by language, translated in separate batches, and results are
// scattered back into their original positions — fragments already in
// the target language are left untouched rather than force-fed through
// translateBatch for nothing.
async function resolveFragmentFrom(text, to, pageLangFallback) {
  let from = await translate.detectLanguage(text);
  // franc recognizes dozens of languages this app has no model for at all —
  // a confident-but-wrong guess (e.g. a short English word misdetected as
  // Swedish) is just as useless as no opinion at all, and must fall through
  // the same way, not get treated as a real answer that then fails the
  // isSupportedLanguage check below and silently skips a fragment that
  // genuinely needed translating. Confirmed by a real e2e regression: short
  // fragments like a button's "Inventory" label or a title= tooltip
  // occasionally got misdetected this way and were wrongly left untranslated.
  if (!translate.isSupportedLanguage(from)) from = null;
  if (!from) from = translate.glossaryLanguageFor(text);
  // Same misdetection franc has for Portuguese chat text (see
  // translateChatMessages): a confident-but-wrong 'to' guess reads
  // identically to "already translated" and never reaches translateBatch at
  // all. An exact glossary match overrides it the same way here.
  from = translate.glossaryOverrideWhenSameAsTarget(from, to, text);
  // pageLangFallback (<html lang>) is a much weaker signal than real
  // content detection — confirmed live that dragonballidle.online's
  // <html lang> is a fixed "es" regardless of actual content — so it's
  // only ever used for fragments too short/ambiguous for franc to have
  // any opinion on, and only when it actually differs from the target
  // (matches translateSelectionAt's same fix earlier this session).
  if (!from && translate.isSupportedLanguage(pageLangFallback) && pageLangFallback !== to) from = pageLangFallback;
  if (!from) from = 'pt'; // every game this app targets is Portuguese
  if (from === to) return null;
  return from; // isSupportedLanguage(from) is already guaranteed at this point
}

async function groupFragmentsByLang(fragments, to, pageLangFallback) {
  const groups = new Map(); // from -> [{ index, text }]
  for (let i = 0; i < fragments.length; i++) {
    const from = await resolveFragmentFrom(fragments[i], to, pageLangFallback);
    if (!from) continue;
    if (!groups.has(from)) groups.set(from, []);
    groups.get(from).push({ index: i, text: fragments[i] });
  }
  return groups;
}

// Returns a results array the same length/order as `fragments` (entries
// that didn't need translation keep their original text unchanged — safe
// to feed straight into applyTranslatedTextScript/applyPendingScript,
// which write by position) plus how many fragments were actually
// translated (for the ok/translated count callers report) and `from`, the
// language with the most translated fragments — for the overwhelmingly
// common single-language page this is simply the correct answer; for a
// genuinely mixed page it's a best-effort summary, not a claim that every
// fragment shared one source language.
async function translateFragmentsMixed(fragments, to, pageLangFallback, batchOpts = {}) {
  const groups = await groupFragmentsByLang(fragments, to, pageLangFallback);
  const results = fragments.slice();
  let translatedCount = 0;
  let dominantFrom = null;
  let dominantCount = 0;
  for (const [from, entries] of groups) {
    try {
      const translated = await translate.translateBatch(from, to, entries.map((e) => e.text), batchOpts);
      entries.forEach((e, i) => { results[e.index] = translated[i]; });
      translatedCount += entries.length;
      if (entries.length > dominantCount) { dominantCount = entries.length; dominantFrom = from; }
    } catch (err) {
      console.error('[translate] mixed-language group', from, '->', to, 'failed', err);
    }
  }
  return { results, translatedCount, from: dominantFrom };
}

async function performTranslate(id, to) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  // Read at the moment translation is actually about to run (not e.g. on
  // every account open/close) — cheap, and this is the only place that
  // ever needs an up-to-date count: see currentWorkerCount() in
  // translate.js, which only consults it when a language pair's translator
  // is first created.
  translate.setOpenAccountCount(views.size);
  // Frees up real CPU for the translator by briefly capping THIS account's
  // own rAF (same mechanism Modo Eco already uses) for as long as
  // translation is actively running — confirmed live this matters: 4 real
  // game accounts rendering at once were the actual bottleneck behind
  // translation feeling stuck, not a lack of workers. Only this one
  // account's rendering is throttled, not the other open accounts, and
  // it's lifted the moment all translation work (including the background
  // off-screen tail below) finishes.
  startTranslateTempEco(id, wc);
  // Set right before kicking off a background off-screen tail (the one path
  // that must keep the throttle alive past this function returning — its
  // own .then/.finally lifts it once that tail actually completes). Every
  // other return/throw path below hits the finally block with this still
  // false, so it cleans up immediately instead of leaking the throttle on.
  let keepTempEcoForBackgroundTail = false;
  try {
    // Already actively translated on THIS exact page (translateWatching
    // only ever gets cleared by a real navigation — see did-navigate)? A
    // repeat call — the user clicking the button again, or opening a new
    // panel that hasn't been caught by the background watch loop yet —
    // must never re-run the full extraction. Confirmed live against a real
    // game: doing that re-walks and re-translates text that's ALREADY
    // Spanish, and translating already-translated text a second time
    // through the pt/en pivot doesn't repeat the same correct answer, it
    // produces garbage ("Impulso de daños" came back as "Implora de
    // daños"). Draining instead — the exact same mechanism
    // startPageTranslateWatchLoop uses — only ever touches text the
    // MutationObserver has flagged as genuinely new, so a repeat click is
    // safe and just catches up faster than waiting for the next tick.
    const watching = translateWatching.get(id);
    if (watching) {
      let translatedCount = 0;
      for (let round = 0; round < 5; round++) {
        const pending = await wc.executeJavaScript(translate.drainPendingScript());
        if (!pending || !pending.fragments.length) break;
        liveMainWindow()?.webContents.send('translate:progress', { id, done: 0, total: pending.fragments.length });
        const { results, translatedCount: groupCount } = await translateFragmentsMixed(pending.fragments, watching.to, watching.pageLang, {
          html: false,
          onProgress: (done, total) => {
            liveMainWindow()?.webContents.send('translate:progress', { id, done, total });
          },
          onDownloadProgress: ({ filename, loaded, total }) => {
            liveMainWindow()?.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
          }
        });
        await wc.executeJavaScript(translate.applyPendingScript(results));
        translatedCount += groupCount;
      }
      translationEnabled.set(id, watching.to);
      return { ok: true, translated: translatedCount, to: watching.to };
    }

    const extracted = await wc.executeJavaScript(translate.extractPageTextScript());
    if (!extracted) return { ok: true, translated: 0 };
    if (!extracted.fragments.length) {
      return { ok: true, translated: 0 };
    }
    // extracted.from (<html lang>) is kept only as a weak per-fragment
    // fallback now, not a single answer for the whole page — confirmed
    // live that a real page can mix languages (a game's own Spanish menu
    // alongside a Portuguese third-party helper overlay), and both <html
    // lang> and a single detectLanguage() call over every fragment joined
    // together always resolve to whichever language dominates by volume,
    // silently no-oping every fragment that doesn't happen to match it
    // even though translateBatch reports a non-zero "translated" count.
    // See resolveFragmentFrom/translateFragmentsMixed above.
    translateWatching.set(id, { pageLang: extracted.from, to });

    // Visible-first: extractPageTextScript already sorted fragments so the
    // first `visibleCount` are what's actually on screen right now.
    // Translating and applying just those, then resolving/closing the
    // modal, means the user sees real translated text almost immediately
    // instead of waiting on the WHOLE page (open tabs, scrolled-off
    // content) before seeing anything at all — the rest keeps translating
    // in the background afterward, same mechanism the watch loop uses.
    const visibleCount = Math.max(1, Math.min(extracted.visibleCount ?? extracted.fragments.length, extracted.fragments.length));
    const priorityFragments = extracted.fragments.slice(0, visibleCount);
    const restFragments = extracted.fragments.slice(visibleCount);

    liveMainWindow()?.webContents.send('translate:progress', { id, done: 0, total: priorityFragments.length });
    const { results: translatedPriority, translatedCount: priorityTranslatedCount, from: dominantFrom } = await translateFragmentsMixed(priorityFragments, to, extracted.from, {
      html: false,
      onProgress: (done, total) => {
        liveMainWindow()?.webContents.send('translate:progress', { id, done, total });
      },
      onDownloadProgress: ({ filename, loaded, total }) => {
        liveMainWindow()?.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
      }
    });
    await wc.executeJavaScript(translate.applyTranslatedTextScript(translatedPriority, 0));

    if (restFragments.length) {
      // Fire-and-forget: the IPC call (and the modal it drives) doesn't
      // wait on this.
      keepTempEcoForBackgroundTail = true;
      translateFragmentsMixed(restFragments, to, extracted.from, { html: false })
        .then(async ({ results: translatedRest }) => {
          if (!wc.isDestroyed()) await wc.executeJavaScript(translate.applyTranslatedTextScript(translatedRest, visibleCount));
        })
        .catch((err) => console.error('[translate] background off-screen batch failed', err))
        .finally(() => stopTranslateTempEco(id, wc));
    }

    translationEnabled.set(id, to);
    return { ok: true, translated: priorityTranslatedCount, from: dominantFrom || extracted.from, to };
  } catch (/** @type {any} */ err) {
    console.error('[translate] failed', err);
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (!keepTempEcoForBackgroundTail) stopTranslateTempEco(id, wc);
  }
}

ipcMain.handle('translate:page', async (_e, { id, to }) => performTranslate(id, to));

// Same functions the right-click "Traducir este texto"/"Ver texto
// original" context menu items call (see showPageContextMenu) — exposed
// over IPC too so this is reachable from window.api, not just a native
// menu click (also what makes it possible to cover with an e2e test at
// all, since Electron's native context menus can't be driven from
// Playwright).
ipcMain.handle('translate:selectionAt', async (_e, { id, x, y }) => translateSelectionAt(id, x, y));
ipcMain.handle('translate:restoreSelections', async (_e, { id }) => restoreSelectionTranslations(id));
ipcMain.handle('translate:chatOnce', async (_e, { id }) => translateChatMessages(id));

ipcMain.handle('translate:restore', async (_e, { id }) => {
  translateWatching.delete(id);
  translationEnabled.delete(id);
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: mt(data.settings.language || 'es', 'err.accountNotOpen') };
  try {
    await wc.executeJavaScript(translate.restorePageTextScript());
    return { ok: true };
  } catch (/** @type {any} */ err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Runs alongside the other per-account background loops (see
// startFreezeDetectorLoop) — one shared interval instead of one per account,
// same reasoning as that one. Drains whatever new text the MutationObserver
// installed by extractPageTextScript queued since last tick and translates
// just that, so a translated page stays translated as the game keeps
// updating it, not just at the moment the button was clicked.
//
// 400ms, not 800ms — confirmed live (scripts/verify-translate-dynamic.js
// against test/fixtures/dynamic-game-mock.html) that a value the game
// re-renders often on its own (a gold counter ticking roughly every 1.2s)
// could visibly flash back to its native-language text for a moment: the
// game's next update landed before the watch loop caught up on the
// previous one, so translateBatch was still "in flight" for a value that
// was already stale by the time it came back. Tightening the interval
// shrinks that window without going all the way to something like 100ms,
// which would cost meaningfully more CPU/IPC for only marginal extra
// benefit. This ONLY ever runs for accounts already in translateWatching,
// which is populated exclusively by performTranslate() after a real
// translation the user explicitly asked for already succeeded on an
// already-loaded page — never during login/page-load, and never for an
// account nobody asked to translate. Chat auto-translate deliberately
// stays on its own separate, slower 800ms loop below: it never showed the
// same flicker complaint, and there's no reason to spend extra CPU/IPC on
// it just because the page-translate loop needed to tighten up.
const PAGE_TRANSLATE_WATCH_MS = 400;
// Guards against a tick starting a SECOND overlapping drain for the same
// account while an earlier tick's is still running — confirmed live this is
// reachable: translateFragmentsMixed's first-ever load of a language pair's
// model can take several seconds (real model download), easily longer than
// this loop's own 400ms period, so without this the next tick(s) would pile
// on duplicate executeJavaScript/translateBatch calls and race their writes.
const pageTranslateInFlight = new Set();
function startPageTranslateWatchLoop() {
  setInterval(async () => {
    for (const [id, { pageLang, to }] of translateWatching) {
      if (pageTranslateInFlight.has(id)) continue;
      const wc = views.get(id);
      if (!wc || wc.isDestroyed()) {
        translateWatching.delete(id);
        continue;
      }
      pageTranslateInFlight.add(id);
      try {
        // Drains repeatedly (capped) within a single tick instead of one
        // pass per tick — confirmed live against a real game
        // (baiakidle.com): opening a big new panel (e.g. a whole equipment
        // sub-menu) queues dozens of fragments at once, and translating
        // only one drain's worth per tick made that panel visibly trickle
        // in translated over several seconds instead of arriving whole.
        // Each round is cheap when there's nothing left (an empty
        // fragments array short-circuits immediately), so this adds no
        // overhead for accounts with nothing new to catch up on.
        for (let round = 0; round < 5; round++) {
          const pending = await wc.executeJavaScript(translate.drainPendingScript());
          if (!pending || !pending.fragments.length) break;
          // Per-fragment language grouping (see translateFragmentsMixed
          // above) — new content the game renders after the initial
          // translate can belong to a different language than whatever
          // dominated the page at click time, same reasoning as the fix
          // to performTranslate itself.
          const { results } = await translateFragmentsMixed(pending.fragments, to, pageLang, { html: false });
          await wc.executeJavaScript(translate.applyPendingScript(results));
        }
      } catch (err) {
        console.error('[translate] watch-loop drain failed for', id, err);
      } finally {
        pageTranslateInFlight.delete(id);
      }
    }
  }, PAGE_TRANSLATE_WATCH_MS);
}

// Split out from the page-translate loop above (used to share its 800ms
// tick) so tightening that one's interval for the flicker fix doesn't also
// double this one's CPU/IPC cost for accounts that only opted into chat
// translation, never page translation. translateChatMessages() itself
// no-ops instantly (before touching the page at all) for every account
// that isn't opted in, so this stays cheap regardless of account count.
// Same overlapping-tick risk as pageTranslateInFlight above — a first-time
// model download inside translateChatMessages can outlast this loop's own
// 800ms period, and translateChatMessages() isn't awaited here (fire-and-
// forget, so one slow account never blocks the others' ticks), so nothing
// else stops a second call for that SAME account starting before the first
// resolves.
const chatTranslateInFlight = new Set();
function startChatAutoTranslateLoop() {
  setInterval(() => {
    for (const account of data.accounts) {
      if (account.closed || !account.chatAutoTranslate) continue;
      if (chatTranslateInFlight.has(account.id)) continue;
      chatTranslateInFlight.add(account.id);
      translateChatMessages(account.id).finally(() => chatTranslateInFlight.delete(account.id));
    }
  }, 800);
}

// Closes every window and installs the already-downloaded update — the user
// only reaches this after seeing what's actually in it (see the
// update-downloaded listener above and the changelog modal in renderer.js).
ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});
ipcMain.handle('update:getStatus', () => updateStatus);

// Session partitions (accountPartition's persist:account-<id>) live on disk
// as <userData>/Partitions/account-<id>/ for as long as Chromium/Electron
// keeps them, independent of whether the account is still tracked in
// data.accounts. removeAccountCompletely's ses.clearStorageData() empties a
// partition's storage but doesn't delete the directory itself, and any
// account removed before that cleanup call existed (or by an older app
// version) left its partition behind forever with no code path that ever
// revisits it. Confirmed live on this machine: 5 partition folders on disk
// against 2 tracked accounts — 3 fully orphaned. Best-effort and
// deliberately narrow: only ever deletes a folder named exactly
// "account-<id>" whose <id> isn't in the CURRENT data.accounts list, never
// touches anything else under userData.
function cleanupOrphanedPartitions() {
  // HARD PRECONDITION: `data` must be the real, successfully-parsed save file.
  // store.load() returns DEFAULT_DATA (accounts: []) when data.json exists but
  // can't be parsed — and with an empty accounts array EVERY partition folder
  // below looks orphaned, so this function would delete the cookies/localStorage/
  // login of every account the user has, permanently, on the very launch where
  // they can least afford it. store.js writes a .corrupt-*.json backup in that
  // case, but restoring it can't bring the deleted sessions back, so the backup
  // is only worth anything if we don't destroy the partitions first.
  if (store.wasRecoveredFromCorruptFile()) {
    console.warn('[startup] skipping orphaned-partition cleanup — this launch recovered from a corrupt data file, so an empty account list is not evidence that any partition is actually orphaned');
    return;
  }
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions');
  let entries;
  try {
    entries = fs.readdirSync(partitionsDir, { withFileTypes: true });
  } catch {
    return; // no Partitions dir yet — nothing to clean
  }
  const liveIds = new Set(data.accounts.map((a) => a.id));
  // Second, independent belt: any state where we'd delete EVERY partition on
  // disk is far more likely to be a bug or an unanticipated load failure than
  // a user who genuinely deleted all their accounts. The cost of skipping is
  // some stale folders that the next real removal will clean up anyway; the
  // cost of being wrong in the other direction is unrecoverable.
  if (liveIds.size === 0 && entries.some((e) => e.isDirectory() && e.name.startsWith('account-'))) {
    console.warn('[startup] skipping orphaned-partition cleanup — no accounts are tracked but partitions exist on disk, which is not a state worth acting destructively on');
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('account-')) continue;
    const id = entry.name.slice('account-'.length);
    if (liveIds.has(id)) continue;
    try {
      fs.rmSync(path.join(partitionsDir, entry.name), { recursive: true, force: true });
      console.log('[startup] removed orphaned partition', entry.name);
    } catch (err) {
      console.error('[startup] failed to remove orphaned partition', entry.name, err);
    }
  }
}

// Prevent two instances from ever running at once — they'd share the same
// userData folder (data.json, extension sessions) and silently corrupt each
// other's state, which looks exactly like extensions "trying but never
// finishing" to load.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = liveMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  try {
  if (process.platform === 'win32') app.setAppUserModelId('com.nexabrowser.app');
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
  passwordSecretsReady = true; // see dataForPersist()
  // Same safeStorage boundary, same "not reliable before whenReady()" reason
  // as the password decrypt right above — see decryptAccountProxies in store.js.
  // And the same split: the decrypted proxy password goes into proxySecrets,
  // never back onto data.accounts, so it can't ride along on every
  // broadcastState() to the renderer.
  data.accounts = store.decryptAccountProxies(data.accounts).map((a) => {
    if (!a || !a.proxy || !a.proxy.password) return a;
    proxySecrets.set(a.id, a.proxy.password);
    const { password, ...proxyMeta } = a.proxy;
    return { ...a, proxy: proxyMeta };
  });
  proxySecretsReady = true; // see dataForPersist()
  passwordEncryptionAvailable = store.isPasswordEncryptionAvailable();
  Menu.setApplicationMenu(null);
  cleanupOrphanedPartitions();
  // Backfills `.action` (toolbar icon + popup path) for extensions installed
  // before that field existed — without this, every extension installed
  // pre-upgrade would never get a toolbar button until reinstalled.
  for (const ext of data.settings.extensions) {
    if (ext.action) continue;
    try {
      ext.action = extractExtensionAction(readManifest(ext.path), ext.path);
    } catch {
      ext.action = null;
    }
  }
  store.watchDataFile(() => {
    console.warn('[main] data file externally modified; a restart is recommended to avoid state divergence');
    // A console.warn nobody reads (no devtools open in normal use) was the
    // only signal this ever gave — real risk it protects against: the next
    // save() from THIS process wholesale overwrites whatever the external
    // tool (OneDrive sync, a manual edit) just wrote, silently. A real
    // reload+merge is genuinely risky to get right blind (could itself lose
    // whichever side's changes are newer, or mishandle encrypted password
    // fields) — surfacing it to the user so THEY can decide whether to
    // restart is the safe, proportionate fix instead.
    if (Notification.isSupported()) {
      new Notification({
        title: 'Nexa Browser',
        body: 'Se detectó un cambio externo en los datos guardados. Reiniciá la app para evitar perder cambios.'
      }).show();
    }
  });
  gameTelemetry.startHeartbeat();
  gameTelemetry.setBallsLowThreshold(data.settings.pokeIdleAlerts?.ballsThreshold ?? 20);
  startPokeIdleAlertLoop();
  startAutoOptimizeLoop();
  startAutoEcoLoop();
  startFreezeDetectorLoop();
  startPageTranslateWatchLoop();
  startChatAutoTranslateLoop();
  // Wired unconditionally (cheap, idempotent) — refreshPowerBlockerNeed()
  // itself no-ops unless settings.stability.backgroundKeepalive is on, so
  // this stays fully inert for every existing install until a user opts in.
  powerManager.initPowerManager({
    onResume: () => {
      console.log('[power-manager] system resumed — re-checking network for open game accounts');
      for (const account of data.accounts) {
        if (account.closed) continue;
        const wc = views.get(account.id);
        if (!wc || wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) continue;
        networkHealth.checkAccountNetwork(account.id, { hostname: 'poke.idleworld.online' })
          .then((r) => console.log('[power-manager] post-resume network check', account.id, r))
          .catch((err) => console.error('[power-manager] post-resume network check failed', account.id, err));
      }
    },
    onUnlockScreen: () => refreshPowerBlockerNeed()
  });
  app.setLoginItemSettings({ openAtLogin: !!data.settings.startWithWindows });
  // No-ops on an unpackaged dev run (electron-updater needs app-update.yml,
  // which electron-builder only generates for a real packaged install) —
  // guarded so `npm start` never logs a spurious "update check failed".
  if (app.isPackaged) {
    // electron-updater's GitHub provider already knows how to tell a
    // pre-release apart from a stable one (from the tag's own semver
    // pre-release identifier, e.g. v0.4.1-beta.1) — this is the only toggle
    // needed on the app side. Read fresh each launch, not cached, so
    // flipping the setting in Ajustes takes effect the next time the app
    // starts without needing any other wiring.
    autoUpdater.allowPrerelease = !!data.settings.betaUpdates;
    updateStatus = { state: 'checking', lastError: null, lastCheckedAt: Date.now() };
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      updateStatus = { state: 'error', lastError: err && err.message ? err.message : String(err), lastCheckedAt: Date.now() };
      console.error('[autoUpdater] check failed', err);
    });
  }
  // Copies the pt<->en and en<->es model files bundled in the installer
  // (electron/bundled-models/, ~42MB) into the same on-disk cache the
  // normal download path uses — a pure local file copy, no network
  // involved, so unlike translate.preload() below this runs unconditionally
  // on every launch (a no-op after the first, since it skips any file
  // already present). This is what makes the first-ever pt->es or pt->en
  // translation instant instead of needing a live download.
  translate.seedBundledModels();
  if (data.settings.translateMemoryPersist) translate.loadPersistedCache(TRANSLATE_MEMORY_FILE);
  // Deliberately NOT warming the translator in the background anymore —
  // explicit user directive: account login/render is always the priority,
  // and secondary tasks like translation must never touch CPU/RAM until the
  // user actually presses a translate button or toggle. seedBundledModels()
  // above is fine to keep (plain fs.copyFileSync of already-bundled files,
  // no WASM worker spun up, no ongoing CPU cost) — it's translate.preload()
  // itself, which loads a real model into a worker thread, that used to run
  // unconditionally at launch and was confirmed to compete with account
  // login for CPU.
  // Real download progress instead of just a silent wait until
  // 'update-downloaded' fires — electron-updater emits this repeatedly
  // while the update file streams in, with percent/transferred/total/
  // bytesPerSecond already computed.
  autoUpdater.on('update-not-available', () => {
    updateStatus = { state: 'up-to-date', lastError: null, lastCheckedAt: Date.now() };
  });
  autoUpdater.on('update-available', () => {
    updateStatus = { state: 'downloading', lastError: null, lastCheckedAt: Date.now() };
  });
  autoUpdater.on('error', (err) => {
    updateStatus = { state: 'error', lastError: err && err.message ? err.message : String(err), lastCheckedAt: Date.now() };
  });
  autoUpdater.on('download-progress', (progress) => {
    const win = liveMainWindow();
    if (!win) return;
    win.webContents.send('update:downloadProgress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });
  // Fires once the update finished downloading in the background (still
  // needs the user to actually restart — checkForUpdatesAndNotify() only
  // shows a native OS notification for that part). This shows our own
  // in-app changelog instead of leaving the user to find out what changed
  // only from that notification, or not at all.
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = { state: 'downloaded', lastError: null, lastCheckedAt: Date.now() };
    const win = liveMainWindow();
    if (!win) return;
    const notes = info.releaseNotes;
    const releaseNotes = typeof notes === 'string'
      ? notes
      : Array.isArray(notes)
        ? notes.map((n) => `## ${n.version}\n${n.note || ''}`).join('\n\n')
        : '';
    win.webContents.send('update:downloaded', { version: info.version, releaseNotes });
  });
  // Explicit capture from the host UI's own window.onerror/unhandledrejection
  // (wired in renderer.js), landing in the same log as everything else here
  // instead of depending on Chromium happening to also print the exception
  // as a console error (which the console-message listener above would then
  // catch, but only incidentally — not guaranteed for every error shape).
  // QA audit finding (2026-08-08): the account webviews already have
  // extensive crash/error coverage (render-process-gone, unresponsive,
  // crash-classifier); the host chrome itself had none of its own.
  // Registered here (once, at app startup) rather than inside createWindow()
  // — that function runs again from 'activate' below whenever the app
  // reopens with zero windows, which used to re-register this listener each
  // time, stacking a duplicate on every reopen (a later renderer:error would
  // then log once per prior window creation).
  ipcMain.on('renderer:error', (_e, info) => {
    console.error('[renderer-error]', info && info.kind, info && info.message, info && info.stack);
  });

  const win = createWindow();
  win.webContents.once('did-finish-load', () => {
    renderLayout();
    broadcastState();
    // Deferred past first paint — see the comment on loadAdBlockEngine().
    loadAdBlockEngine();
    adblockManager.registerCosmeticIpcHandlers();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  } catch (/** @type {any} */ err) {
    console.error('[boot] failed during app.whenReady()', err);
    dialog.showErrorBox('Nexa Browser', String(err && err.stack ? err.stack : err));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// flushPersist() is async (store.save() writes off-thread now) — quitting
// immediately after calling it, like before, would let the process exit
// mid-write on a machine slow enough for it to matter. preventDefault() once
// to hold the quit open just long enough to actually await it, then quit for
// real; quitConfirmed guards against re-entering this same delay forever
// (app.quit() below re-fires this very event).
let quitConfirmed = false;
app.on('before-quit', (event) => {
  if (quitConfirmed) return;
  event.preventDefault();
  appQuitting = true;
  powerManager.shutdownPowerManager();
  // A netlog capture left running holds its file open and never gets a
  // stopNetLogCapture() — close it so the .json on disk is actually complete.
  if (activeNetLogSession) {
    const netLogWc = views.get(activeNetLogSession.accountId);
    if (netLogWc && !netLogWc.isDestroyed()) {
      networkHealth.stopNetLogCapture(netLogWc.session).catch((err) => console.error('[netlog] failed to stop the capture on quit', err));
    }
    activeNetLogSession = null;
  }
  if (data.settings.translateMemoryPersist) translate.savePersistedCache(TRANSLATE_MEMORY_FILE);
  flushAdBlockStatsPersist();
  flushPersist()
    .catch((err) => console.error('[main] flushPersist on quit failed', err))
    .finally(() => {
      // Bergamot's own README is explicit about this: skipping delete() on a
      // NodeJS translator leaves its worker thread listening for messages
      // forever, which can keep the process from exiting cleanly on its own.
      translate.shutdown();
      quitConfirmed = true;
      app.quit();
    });
});
