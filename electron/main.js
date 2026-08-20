const { app, BrowserWindow, ipcMain, session, Menu, shell, dialog, clipboard, Notification, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { GAP, GRID_MAX_PANELS, MIN_SPLIT_FRAC, resolveFracs, cellsForMode, freeCells, normalizeFracsWithMin } = require('./layout-utils');
const gameTelemetry = require('./game-telemetry');
const pokeFormulas = require('./poke-formulas');
const market = require('./market');
const networkHealth = require('./network-health');
const powerManager = require('./power-manager');
const gameConnectionManager = require('./game-connection-manager');
const dnsTest = require('./dns-test');
const translate = require('./translate');
const memoryOptimizer = require('./memory-optimizer');
const pipPlayer = require('./pip-player');
const elementPicker = require('./element-picker');
const { classifyCrash } = require('./crash-classifier');
const diagnostics = require('./diagnostics');
const { normalizeAddressInput } = require('./address-bar');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
// Catálogo único de traducciones compartido con el renderer — ver el comentario
// de cabecera en src/i18n-data.js. El proceso main no tiene sandbox, así que
// requerir un archivo bajo src/ funciona igual que con game-telemetry.js.
const I18N = require('../src/i18n-data.js');
function mt(lang, key, vars) {
  let str = (I18N[lang] && I18N[lang][key]) ?? I18N.es[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) str = str.replace(`{${k}}`, vars[k]);
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

const { hostnameFromUrlLike } = require('./url-utils');

// window.open() popups (Etapa: OAuth login flows) get allowed through only
// when they go to the account's own site or a well-known third-party login
// provider — anything else is denied and logged. Before this, every account
// on every page could window.open() to literally anywhere and still receive
// a fully isolated+sandboxed+contextIsolated popup window; scoping the
// *destination* closes the remaining gap without breaking real Google/
// Facebook/Discord "sign in with..." flows, which is the only legitimate
// reason a game page needs a popup at all.
const POPUP_ALLOWED_HOSTS = new Set([
  'accounts.google.com',
  'accounts.youtube.com',
  'www.facebook.com',
  'm.facebook.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'discord.com',
  'twitter.com',
  'x.com',
  'api.twitter.com'
]);

function hostMatchesPopupAllowlist(hostname, accountHostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  // Same site (or a subdomain of it) opening a popup to itself — e.g. a
  // "share"/"support" window the game itself spawns.
  if (accountHostname && (h === accountHostname || h.endsWith(`.${accountHostname}`))) return true;
  let walk = h;
  while (walk.includes('.')) {
    if (POPUP_ALLOWED_HOSTS.has(walk)) return true;
    walk = walk.slice(walk.indexOf('.') + 1);
  }
  return POPUP_ALLOWED_HOSTS.has(walk);
}

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

const { createAdblockManager } = require('./adblock-manager');
const adblockManager = createAdblockManager({
  getData: () => data,
  persist: () => persist(),
  broadcastState: () => broadcastState(),
  getAccount: (id) => getAccount(id)
});
const { applyAdBlock, loadAdBlockEngine, rebuildAdBlockEngine, resetPageAdBlockStats } = adblockManager;

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
// A destroyed BrowserWindow is still a truthy JS object — `if (mainWindow)`
// alone doesn't catch it, which is exactly what let an uncaught
// "Object has been destroyed" TypeError (via mainWindow.getContentSize() in
// contentBounds(), reached from a webContents 'destroyed' listener that fired
// during app shutdown) crash the whole process. Use this everywhere instead.
function mainWindowAlive() {
  return !!mainWindow && !mainWindow.isDestroyed();
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
let updateStatus = { state: 'idle', lastError: null, lastCheckedAt: null };

// Always start on auto grid, regardless of whichever layout was active when the
// app was last closed — the user wants a consistent, predictable starting layout.
data.settings.layoutMode = 'grid';
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
// accountIds whose page currently has an active native Picture-in-Picture
// session (see wireAccountWebContents' 'nexa-pip-state' listener below) — the
// renderer uses this to keep that account's <webview> painting off-screen
// instead of display:none while it's not the active panel, since a hidden
// guest stops compositing entirely and the floating PiP window would freeze.
const pipActiveAccounts = new Set();
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
      if (notif) new Notification(notif).show();
    }
  }, 5000);
}

// Market IV-alert watch: per-account state so a fresh listing only ever
// alerts once, and so turning the toggle on (or a fresh app boot) doesn't
// immediately fire an alert for every listing already on the market — only
// for ones that show up AFTER the first poll for that account establishes
// a baseline.
const marketWatch = new Map(); // accountId -> { seen: Set<string>, initialized: boolean }
let marketAlertFeed = []; // most-recent-first, capped — shown in the Market tab's alert feed
const MARKET_ALERT_FEED_CAP = 20;
const MARKET_POLL_MS = 5 * 60 * 1000;
const MARKET_ALERT_FEED_TTL_MS = 30 * 60 * 1000;

function marketAlertId(accountId, listing) {
  return String([
    accountId || '',
    listing?.listingId ?? listing?.marketId ?? listing?.id ?? listing?.refId ?? '',
    listing?.price ?? '',
    listing?.iv ?? listing?.ivTotal ?? listing?.totalIv ?? ''
  ].join(':'));
}

function broadcastMarketAlertFeed() {
  pruneMarketAlertFeed();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('market:alertFeedUpdated', marketAlertFeed.slice(0, MARKET_ALERT_FEED_CAP));
  }
}

function pruneMarketAlertFeed() {
  const cutoff = Date.now() - MARKET_ALERT_FEED_TTL_MS;
  marketAlertFeed = marketAlertFeed
    .filter((entry) => entry && (entry.at || 0) >= cutoff)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, MARKET_ALERT_FEED_CAP);
}

function marketListingName(listing) {
  return listing?.name || listing?.title || listing?.speciesName || listing?.itemName || listing?.productName || 'Pokemon';
}

function marketListingIv(listing) {
  const iv = listing?.iv ?? listing?.ivTotal ?? listing?.totalIv ?? null;
  const n = Number(iv);
  return Number.isFinite(n) ? n : null;
}

function marketListingQuality(listing) {
  const raw = listing?.quality ?? listing?.qualityValue ?? listing?.pokemonQuality ?? listing?.pokemon?.quality ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function marketRarityFromQuality(quality) {
  if (quality == null) return '';
  if (quality < 1.0) return 'weak';
  if (quality < 1.1) return 'common';
  if (quality < 1.3) return 'uncommon';
  if (quality < 1.5) return 'rare';
  if (quality < 1.7) return 'epic';
  if (quality < 2.0) return 'legendary';
  if (quality < 3.0) return 'mythic';
  if (quality < 4.0) return 'ancient';
  return 'divine';
}

function marketRarityKey(value) {
  const rarity = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!rarity) return '';
  if (rarity.includes('divine')) return 'divine';
  if (rarity.includes('ancient')) return 'ancient';
  if (rarity.includes('mythic')) return 'mythic';
  if (rarity.includes('legend') || rarity.includes('lendar')) return 'legendary';
  if (rarity.includes('epic') || rarity.includes('epica')) return 'epic';
  if (rarity.includes('rare') || rarity.includes('rara')) return 'rare';
  if (rarity.includes('incom')) return 'uncommon';
  if (rarity.includes('comum') || rarity.includes('common')) return 'common';
  if (rarity.includes('fraca') || rarity.includes('weak')) return 'weak';
  return rarity;
}

function marketListingRarityKey(listing) {
  const fromQuality = marketRarityFromQuality(marketListingQuality(listing));
  if (fromQuality) return fromQuality;
  return marketRarityKey(
    listing?.rarity || listing?.rank || listing?.tier || listing?.qualityLabel ||
    listing?.qualityName || listing?.pokemon?.rarity || listing?.pokemon?.qualityLabel ||
    listing?.pokemon?.qualityName || ''
  );
}

function marketListingPassesAlertRarity(listing, cfg) {
  if (cfg?.marketIvRareOnly === false) return true;
  return ['epic', 'legendary', 'mythic', 'ancient', 'divine'].includes(marketListingRarityKey(listing));
}

function marketListingPriceText(listing) {
  const currency = market.normalizeCurrency(listing?.currency || listing?.paymentCurrency || listing?.moneyType);
  const symbol = currency === 'DIAMONDS' ? 'diamantes' : 'dolares';
  const price = listing?.price ?? listing?.amount ?? '?';
  return `${price} ${symbol}`;
}

function showMarketIvNotification(account, listing, threshold) {
  if (!Notification.isSupported()) return;
  const iv = marketListingIv(listing);
  const notif = new Notification({
    title: `Market global: ${marketListingName(listing)} IV ${iv ?? '?'}`,
    body: `${displayName(account)} · ${marketListingPriceText(listing)} · alerta >= ${threshold} IV`,
    icon: APP_ICON_PATH,
    silent: false
  });
  notif.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Tell the renderer to open the Market panel and highlight this listing.
    mainWindow.webContents.send('market:openAlert', {
      alertId: marketAlertId(account.id, listing),
      accountId: account.id,
      listing
    });
  });
  notif.show();
}

function startMarketAlertLoop() {
  setInterval(async () => {
    pruneMarketAlertFeed();
    broadcastMarketAlertFeed();
    const cfg = data.settings.pokeIdleAlerts;
    if (!cfg || !cfg.marketIv) return;
    const threshold = cfg.marketMinIv ?? 150;
    let notificationsThisTick = 0;
    for (const account of data.accounts) {
      if (account.closed) continue;
      const wc = views.get(account.id);
      if (!wc || wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) continue;
      let result;
      try {
        result = await wc.executeJavaScript(market.fetchListingsScript('Pokémon'));
      } catch {
        continue;
      }
      if (!result || !result.ok || !Array.isArray(result.listings)) continue;
      let watch = marketWatch.get(account.id);
      if (!watch) {
        watch = { seen: new Set(), initialized: false };
        marketWatch.set(account.id, watch);
      }
      const isFirstPoll = !watch.initialized;
      for (const listing of result.listings) {
        const id = listing && listing.id;
        if (!id || watch.seen.has(id)) continue;
        watch.seen.add(id);
        if (isFirstPoll) continue; // baseline — don't alert on what was already there
        const iv = marketListingIv(listing);
        if (iv == null || iv < threshold) continue;
        if (!marketListingPassesAlertRarity(listing, cfg)) continue;
        const maxPrice = Number(cfg.marketIvMaxPrice ?? 0);
        if (maxPrice > 0 && Number(listing.price ?? listing.amount ?? 0) > maxPrice) continue;
        if (notificationsThisTick >= 10) continue;
        marketAlertFeed.unshift({ alertId: marketAlertId(account.id, listing), accountId: account.id, listing, at: Date.now(), threshold });
        pruneMarketAlertFeed();
        broadcastMarketAlertFeed();
        if (cfg.enabled !== false && cfg.marketIvDesktop !== false) showMarketIvNotification(account, listing, threshold);
        notificationsThisTick += 1;
      }
      watch.initialized = true;
      // Cap memory: keep only the most recent chunk of seen ids per account.
      if (watch.seen.size > 2000) watch.seen = new Set([...watch.seen].slice(-1000));
    }
  }, MARKET_POLL_MS);
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

function handleDownloads(ses) {
  if (downloadSessionsWired.has(ses)) return;
  downloadSessionsWired.add(ses);
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
      paused: false,
      startedAt: Date.now()
    };
    data.downloads.unshift(record);
    if (data.downloads.length > 200) data.downloads.length = 200;
    downloadItems.set(record.id, item);
    persist();
    broadcastState();

    let lastBroadcast = 0;
    item.on('updated', (_e, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.state = state;
      record.paused = item.isPaused();
      const now = Date.now();
      if (now - lastBroadcast > 400) {
        lastBroadcast = now;
        broadcastState();
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
  { combo: 'Ctrl + B', key: 'shortcut.toggleSidebar' },
  { combo: 'Ctrl + D', key: 'shortcut.bookmarkPage' },
  { combo: 'Ctrl + Shift + Supr', key: 'shortcut.clearSessionData' },
  { combo: 'Ctrl + C', key: 'shortcut.copy' },
  { combo: 'Ctrl + V', key: 'shortcut.paste' }
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
  account.zoom = factor;
  const view = views.get(id);
  if (view) view.setZoomFactor(factor);
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
    if (mainWindowAlive()) mainWindow.webContents.send('findbar:open', { id: account.id });
    return true;
  }
  if (key === 'escape') {
    view?.stopFindInPage('clearSelection');
    if (mainWindowAlive()) mainWindow.webContents.send('findbar:close', { id: account.id });
    return false; // let Escape still propagate normally for anything else on the page
  }
  if (ctrl && !shift && !alt && /^[1-9]$/.test(key)) {
    if (mainWindowAlive()) mainWindow.webContents.send('shortcut:selectPanel', { n: Number(key) });
    return true;
  }
  if (ctrl && !shift && !alt && key === 'tab') {
    if (mainWindowAlive()) mainWindow.webContents.send('shortcut:nextPanel');
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
    if (mainWindowAlive()) mainWindow.webContents.send('shortcut:focusAddress');
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
    if (mainWindowAlive()) mainWindow.webContents.send('shortcut:openSettings');
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
    const ses = view ? view.session : session.fromPartition(accountPartition(account.id));
    ses.clearStorageData()
      .then(() => ses.clearCache())
      .then(() => view?.reload());
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
        if (result.ok && mainWindowAlive()) {
          mainWindow.webContents.send('translate:autoApplied', { id: account.id });
        }
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
    if (crashes <= 3 && !wc.isDestroyed()) {
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
  wc.on('focus', () => {
    lastFocusedAccountId = account.id;
  });
  wc.on('before-input-event', (event, input) => {
    if (handleAccountShortcut(input, account)) event.preventDefault();
  });
  wc.on('found-in-page', (_e, result) => {
    if (mainWindow) {
      mainWindow.webContents.send('findbar:result', {
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
    pipActiveAccounts.delete(account.id);
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
  wc.ipc.on('nexa-pip-state', (_e, active) => {
    if (active) pipActiveAccounts.add(account.id);
    else pipActiveAccounts.delete(account.id);
    if (mainWindowAlive()) mainWindow.webContents.send('account:pipState', { id: account.id, active });
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
  ).catch(() => {});
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

// Real per-tab FPS counter — measures the actual page's own render loop
// (whatever it's doing with requestAnimationFrame, including Modo Eco's
// throttle if that account has it on), not nexa-browser's own chrome FPS
// (that's the separate counter already in the status bar, measuring the
// host UI's rAF, not any account's content). Runs for every account, not
// just the game, so the user can see real FPS on any tab. Idempotent via
// window.__nexaFpsOverlay, safe to re-run on every did-finish-load — reuses
// the same badge element instead of appending duplicates. `visible` sets the
// starting display state (data.settings.showFpsOverlay at injection time);
// toggling the setting later without a reload goes through
// setFpsOverlayVisible() below instead of re-injecting.
// Color thresholds mirror what GPU benchmarking overlays (MSI Afterburner/
// RTSS) already do — green is healthy, yellow is a real but survivable
// slowdown (matches Modo Eco's 30fps cap on purpose, not a false alarm),
// red means something is actually wrong.
const FPS_COLOR_SCRIPT = `
    function nexaFpsColor(fps) {
      if (fps >= 45) return '#3ddc57';
      if (fps >= 20) return '#e0c341';
      return '#e05555';
    }
`;
function injectFpsOverlay(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaFpsOverlay) return;
      window.__nexaFpsOverlay = true;
      ${FPS_COLOR_SCRIPT}
      const badge = document.createElement('div');
      badge.id = 'nexa-fps-badge';
      // contain:layout style paint scopes every future text update to just
      // this element's own box — without it, a fixed-position element whose
      // content changes width every second (9 FPS vs 123 FPS) can still make
      // the browser walk up looking for anything that might need to react,
      // on a page that's already busy rendering a real game. This tells it
      // up front that nothing outside this box ever needs to know.
      badge.style.cssText = 'position:fixed;top:6px;right:6px;z-index:2147483647;background:rgba(0,0,0,0.55);color:#3ddc57;font:11px monospace;padding:2px 6px;border-radius:4px;pointer-events:none;contain:layout style paint;display:${visible ? '' : 'none'};';
      badge.textContent = '… FPS';
      (document.body || document.documentElement).appendChild(badge);
      let frames = 0;
      let last = performance.now();
      function loop(now) {
        frames += 1;
        if (now - last >= 1000) {
          badge.textContent = frames + ' FPS';
          badge.style.color = nexaFpsColor(frames);
          frames = 0;
          last = now;
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    })();`
  ).catch(() => {});
}

// Toggles the already-injected FPS badge's visibility live, without
// re-injecting or losing its running rAF counter — used when the user
// flips "Mostrar FPS" in Configuración while accounts are already open.
function setFpsOverlayVisible(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      const el = document.getElementById('nexa-fps-badge');
      if (el) el.style.display = ${visible} ? '' : 'none';
    })();`
  ).catch(() => {});
}

// Real per-tab latency/ping counter — same idea and same visual style as
// injectFpsOverlay above, but bottom-right instead of top-right, and
// measuring round-trip time to the page's own origin instead of render FPS.
// Uses a same-origin HEAD request (no CORS issues on any site, no extra
// content downloaded) timed with performance.now(); a GET fallback covers
// servers that reject HEAD on that route. Runs for every account, not just
// the game — this is a generic "how's my connection to whatever site is
// loaded" indicator. Idempotent via window.__nexaPingOverlay, safe to
// re-run on every did-finish-load. Same green/yellow/red convention as the
// FPS badge, tuned for a HEAD round-trip instead of a frame rate.
const PING_COLOR_SCRIPT = `
    function nexaPingColor(ms) {
      if (ms <= 100) return '#3ddc57';
      if (ms <= 300) return '#e0c341';
      return '#e05555';
    }
`;
function injectPingOverlay(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaPingOverlay) return;
      window.__nexaPingOverlay = true;
      ${PING_COLOR_SCRIPT}
      const badge = document.createElement('div');
      badge.id = 'nexa-ping-badge';
      badge.style.cssText = 'position:fixed;bottom:6px;right:6px;z-index:2147483647;background:rgba(0,0,0,0.55);color:#3ddc57;font:11px monospace;padding:2px 6px;border-radius:4px;pointer-events:none;display:${visible ? '' : 'none'};';
      badge.textContent = '… ms';
      (document.body || document.documentElement).appendChild(badge);
      // Some sites' SPA routing 404s on HEAD for a client-side route (e.g.
      // dragonballidle.online/play — confirmed live: HEAD -> 404, GET -> 200)
      // while GET on that same URL succeeds. Chromium logs that 404 to the
      // console itself at the network layer no matter what the JS around it
      // does, so the very first tick can't avoid it — but remembering the
      // failure and skipping straight to GET afterwards stops it from
      // repeating on every single 2s tick for the rest of the page's life.
      let headUnsupported = false;
      async function measure() {
        // fetch() only supports http(s) — about:blank (every account starts
        // there before its real src loads) and any other scheme throw
        // "Fetch API cannot load ... URL scheme is not supported" as a real
        // console error every 2s regardless of the try/catch around it
        // (Chromium logs the failed request at the network layer, not just
        // as a JS exception) — confirmed live as exactly the spam reported.
        // Skip the tick entirely instead of letting it always fail.
        if (!location.protocol.startsWith('http')) return;
        const url = location.href;
        const start = performance.now();
        let ok = false;
        if (!headUnsupported) {
          try {
            ok = (await fetch(url, { method: 'HEAD', cache: 'no-store' })).ok;
          } catch (e) {
            // network-level failure (offline, blocked) — fall through to GET below.
          }
          if (!ok) headUnsupported = true;
        }
        if (!ok) {
          try {
            ok = (await fetch(url, { method: 'GET', cache: 'no-store' })).ok;
          } catch (e2) {
            // offline or blocked — leave the last known value showing.
          }
        }
        if (!ok) return; // HEAD and GET both failed/non-2xx — don't show a bogus number.
        // Wall-clock around the awaited fetch (the old approach) doesn't
        // measure network time alone — it also includes however long this
        // callback had to wait in line for a free tick on the main thread.
        // On a page doing heavy canvas work (a busy idle-game battle scene,
        // dozens of sprites, already-low FPS) that queueing delay dwarfs the
        // real round-trip and shows a "ping" of tens of seconds that has
        // nothing to do with the network. Resource Timing entries are
        // stamped by the browser's network stack at the moment each event
        // actually happened, independent of when JS gets around to reading
        // them, so pulling the duration from there instead reports real
        // transfer time even while the main thread is starved. Falls back to
        // the wall-clock number if the entry isn't found for some reason
        // (buffer disabled, evicted) rather than showing nothing.
        const entries = performance.getEntriesByType('resource').filter((e) => e.name === url && e.startTime >= start - 50);
        const entry = entries[entries.length - 1];
        const ms = entry ? Math.round(entry.responseEnd - entry.startTime) : Math.round(performance.now() - start);
        performance.clearResourceTimings();
        badge.textContent = ms + ' ms';
        badge.style.color = nexaPingColor(ms);
      }
      measure();
      setInterval(measure, 2000);
    })();`
  ).catch(() => {});
}

// Same live-toggle pattern as setFpsOverlayVisible, for the ping badge.
function setPingOverlayVisible(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      const el = document.getElementById('nexa-ping-badge');
      if (el) el.style.display = ${visible} ? '' : 'none';
    })();`
  ).catch(() => {});
}

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

// Sell-lock: hard-blocks selling specific caught Pokémon (by their unique
// instance id) or specific item types (by name) the user picked, instead of
// PokeGrid's approach of just popping a confirm() the user can click through.
// The game sells via plain fetch() to /api/game/pokemon/sell (body:
// {pokeIds:[...]}) and /api/game/(shop|flint)/sell (body: {items:[{itemId,qty}]}
// or {itemId,qty}) — confirmed live via DevTools. Filters the locked entries
// out of the request body (letting an otherwise-mixed sell of unlocked items
// still go through) and only rejects the fetch outright if every entry in it
// was locked. Idempotent monkey-patch guarded by window.__nexaSellLock so
// repeated calls (toggling the lock list) just update the live sets instead
// of wrapping fetch twice.
function sellLockScript(pokeIds, itemIds) {
  return `(function() {
    const pokeSet = new Set(${JSON.stringify((pokeIds || []).map(String))});
    const itemSet = new Set(${JSON.stringify((itemIds || []).map(Number))});
    if (window.__nexaSellLock) {
      window.__nexaSellLock.pokeSet = pokeSet;
      window.__nexaSellLock.itemSet = itemSet;
      return;
    }
    window.__nexaSellLock = { pokeSet, itemSet };
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        const url = (input && input.url) || input;
        if (typeof url === 'string' && init && typeof init.body === 'string') {
          if (/\\/api\\/game\\/pokemon\\/sell/.test(url)) {
            const body = JSON.parse(init.body);
            const ids = body.pokeIds || [];
            const allowed = ids.filter((id) => !window.__nexaSellLock.pokeSet.has(String(id)));
            if (allowed.length !== ids.length) {
              if (!allowed.length) return Promise.reject(new Error('Venta bloqueada por el candado de Nexa'));
              init = { ...init, body: JSON.stringify({ ...body, pokeIds: allowed }) };
            }
          } else if (/\\/api\\/game\\/(shop|flint)\\/sell/.test(url)) {
            const body = JSON.parse(init.body);
            const items = body.items ? body.items : (body.itemId != null ? [{ itemId: body.itemId, qty: body.qty }] : []);
            const allowed = items.filter((it) => !window.__nexaSellLock.itemSet.has(Number(it.itemId)));
            if (allowed.length !== items.length) {
              if (!allowed.length) return Promise.reject(new Error('Venta bloqueada por el candado de Nexa'));
              const newBody = body.items ? { ...body, items: allowed } : { itemId: allowed[0].itemId, qty: allowed[0].qty };
              init = { ...init, body: JSON.stringify(newBody) };
            }
          }
        }
      } catch (e) {}
      return originalFetch.call(this, input, init);
    };
  })();`;
}

function applySellLock(wc, account) {
  wc.executeJavaScript(sellLockScript(account.sellLockPokeIds, account.sellLockItemIds)).catch(() => {});
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

// Polls briefly for window.__nexaGameSocket (populated by the capture patch
// above, but only once the game itself calls .send() at least once — usually
// near-instant, but not guaranteed to have happened yet right after a fresh
// navigation) before giving up, rather than silently no-op-ing on a race.
function enterHuntScript(slug) {
  return sendGameSocketFrameScript({ type: 'enter-hunt', slug });
}

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
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
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
    const from = translate.isSupportedLanguage(detected) ? detected
      : (translate.isSupportedLanguage(extracted.from) && extracted.from !== to) ? extracted.from
      : 'pt';
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
        if (mainWindowAlive()) mainWindow.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
      }
    });
    if (downloadHappened && mainWindowAlive()) mainWindow.webContents.send('translate:downloadFinished', { id });
    await wc.executeJavaScript(translate.applySelectionTranslationScript(translated, extracted.startIndex));
    finished = true;
    if (!wc.isDestroyed()) wc.executeJavaScript(translate.finishSelectionLoadingScript(translated.length)).catch(() => {});
    return { ok: true, translated: translated.length, from, to };
  } catch (err) {
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
  let hostname = '';
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
    let hostname = '';
    try { hostname = new URL(wc.getURL()).hostname; } catch { /* about:blank etc. */ }
    if (translate.chatSelectorsForHost(hostname)) {
      const account = getAccount(accountId);
      const enabled = !!(account && account.chatAutoTranslate);
      items.push(
        {
          label: mt(lang, enabled ? 'ctx.chatAutoTranslateOff' : 'ctx.chatAutoTranslateOn'),
          click: () => {
            if (!account) return;
            account.chatAutoTranslate = !enabled;
            if (!account.chatAutoTranslate) chatUserLanguageHistory.delete(accountId);
            persist();
          }
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
        const result = await dialog.showSaveDialog(mainWindow, { defaultPath: wc.getTitle() || 'page' });
        if (!result.canceled && result.filePath) wc.savePage(result.filePath, 'HTMLComplete').catch(() => {});
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
  if (mainWindowAlive()) mainWindow.webContents.send('nav:update', { id, url });
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
  if (!mainWindowAlive()) return { x: 0, y: 0, width: 0, height: 0 };
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
  if (!mainWindowAlive()) return;
  const bounds = contentBounds();
  const { cells, maximized } = computeCells(bounds);
  mainWindow.webContents.send('panels:geometry', buildGeometry(cells, maximized));
}

// For changes that only affect a panel's displayed metadata (mute/name/color/
// zoom) — not which accounts are open, the layout mode, or their sizes —
// this is identical to renderLayout() now that neither function touches any
// native view. Kept as a separate name for the (many) call sites that were
// written back when the two functions did meaningfully different amounts of
// work, so this diff doesn't have to also chase down every one of them.
function broadcastGeometryOnly() {
  if (!mainWindowAlive()) return;
  const { cells, maximized } = computeCells(contentBounds());
  mainWindow.webContents.send('panels:geometry', buildGeometry(cells, maximized));
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindowAlive()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[boot] did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[boot] render-process-gone', details);
  });
  mainWindow.on('unresponsive', () => {
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
  mainWindow.on('close', () => {
    appQuitting = true;
  });

  wireDidAttachWebview(mainWindow.webContents);

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  // Explicit capture from the host UI's own window.onerror/unhandledrejection
  // (wired in renderer.js), landing in the same log as everything else here
  // instead of depending on Chromium happening to also print the exception
  // as a console error (which the console-message listener above would then
  // catch, but only incidentally — not guaranteed for every error shape).
  // QA audit finding (2026-08-08): the account webviews already have
  // extensive crash/error coverage (render-process-gone, unresponsive,
  // crash-classifier); the host chrome itself had none of its own.
  ipcMain.on('renderer:error', (_e, info) => {
    console.error('[renderer-error]', info && info.kind, info && info.message, info && info.stack);
  });

  // Right-click Cut/Copy/Paste/Select all for our own chrome's editable
  // fields (address bar, command palette, settings inputs, etc). Electron
  // doesn't provide this by default the way a real browser does — only the
  // account webviews had it (see showPageContextMenu below), so typing a
  // URL had no way to paste via the mouse, only via Ctrl+V.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return;
    const lang = data.settings.language || 'es';
    const wc = mainWindow.webContents;
    Menu.buildFromTemplate([
      { label: mt(lang, 'ctx.cut'), enabled: params.editFlags.canCut, click: () => wc.cut() },
      { label: mt(lang, 'ctx.copy'), enabled: params.editFlags.canCopy, click: () => wc.copy() },
      { label: mt(lang, 'ctx.paste'), enabled: params.editFlags.canPaste, click: () => wc.paste() },
      { type: 'separator' },
      { label: mt(lang, 'ctx.selectAll'), enabled: params.editFlags.canSelectAll, click: () => wc.selectAll() }
    ]).popup({ window: mainWindow });
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
    if (mainWindowAlive()) mainWindow.webContents.send('state:update', data);
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
  if (!account) return { ok: false, error: 'Cuenta no encontrada.' };
  const target = normalizeAddressInput(url);
  // account.url (and the state broadcast the renderer polls) used to be set
  // BEFORE confirming the real <webview> was even wired up yet — if
  // ensureView() returned undefined, the state silently claimed the
  // navigation happened while the actual page never moved. Now the state
  // only advances once there's a real webContents to call loadURL on.
  const wc = ensureView(account);
  if (!wc) return { ok: false, error: 'La vista de esta cuenta todavía no está lista.' };
  account.url = target;
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
  connectionManagers.delete(id);
  gameTelemetry.removeState(id);
  notifiedEventAt.delete(id);
  translateWatching.delete(id);
  translationEnabled.delete(id);
  chatUserLanguageHistory.delete(id);
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

ipcMain.handle('accounts:duplicate', (_e, { id }) => {
  const source = getAccount(id);
  if (!source) return data;
  const copy = {
    id: crypto.randomUUID(),
    name: `${displayName(source)} ${mt(data.settings.language || 'es', 'ctx.copySuffix')}`,
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
  const wc = views.get(id);
  const ses = wc ? wc.session : session.fromPartition(accountPartition(id));
  await ses.clearStorageData();
  await ses.clearCache();
  if (wc) wc.reload();
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
      click: () => mainWindow.webContents.send('ui:promptRenameGroup', { groupId: group.id, currentName: group.name })
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
  menu.popup({ window: mainWindow });
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
    { label: mt(lang, 'ctx.editAccount'), click: () => mainWindow.webContents.send('ui:open-account-editor', { id }) },
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
          click: () => mainWindow.webContents.send('ui:promptNewGroup', { accountId: id, spaceId: account.spaceId })
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
      click: () => {
        const copy = {
          id: crypto.randomUUID(),
          name: `${displayName(account)} ${mt(lang, 'ctx.copySuffix')}`,
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
      label: mt(lang, 'ctx.clearSessionData'),
      click: async () => {
        const wc = views.get(id);
        const ses = wc ? wc.session : session.fromPartition(accountPartition(id));
        await ses.clearStorageData();
        await ses.clearCache();
        if (wc) wc.reload();
      }
    },
    {
      label: mt(lang, 'ctx.deleteAccount'),
      click: () => removeAccountCompletely(id)
    }
  ]);
  menu.popup({ window: mainWindow });
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
    account.proxy = proxy && proxy.server ? proxy : null;
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

// Favorita = the account's own current huntKey (from live telemetry — the
// real slug the server itself reported, not a guess) at the moment the user
// clicks "favoritar". `huntSlug: null` clears it.
ipcMain.handle('accounts:setFavoriteHunt', (_e, { id, huntSlug }) => {
  const account = getAccount(id);
  if (!account) return data;
  account.favoriteHuntSlug = huntSlug || null;
  persist();
  broadcastState();
  return data;
});

// `target: 'favorite' | 'last'` — resolves to account.favoriteHuntSlug or
// the previous-hunt snapshot's huntKey (already tracked for the Hunt
// Comparator, Etapa 1) and sends the real enter-hunt WS frame confirmed live
// (see enterHuntScript above). Returns {ok:false} rather than throwing when
// there's nothing to teleport to yet, or the socket capture hasn't caught a
// live reference — both are normal transient states, not errors.
// `huntKey` (as reported by the game's own field-init frame, and what we
// store as favoriteHuntSlug/previousHunt.huntKey) is NOT the same string the
// `enter-hunt` WS command expects — confirmed live: it's a composite
// "<slug>:<instanceId>" (e.g. "abra:1785826367568", visible directly in the
// Hunt Comparator's own account header), while the captured enter-hunt frame
// from a real click used the bare species slug ("charizard", no suffix).
// Teleporting with the raw huntKey silently no-ops against the server, which
// is why favorite/last-hunt teleport did nothing — strip everything from the
// first colon onward to recover the real slug.
function huntSlugFromKey(huntKey) {
  if (!huntKey) return null;
  const idx = huntKey.indexOf(':');
  return idx === -1 ? huntKey : huntKey.slice(0, idx);
}

ipcMain.handle('accounts:teleportToHunt', async (_e, { id, target }) => {
  const account = getAccount(id);
  const wc = views.get(id);
  if (!account || !wc || wc.isDestroyed() || !gameTelemetry.isGameUrl(wc.getURL())) {
    return { ok: false, error: 'Cuenta no disponible.' };
  }
  let huntKey = null;
  if (target === 'favorite') {
    huntKey = account.favoriteHuntSlug || null;
  } else if (target === 'last') {
    const stats = gameTelemetry.getStats(id);
    huntKey = (stats && stats.previousHunt && stats.previousHunt.huntKey) || null;
  }
  const slug = huntSlugFromKey(huntKey);
  if (!slug) return { ok: false, error: 'No hay hunt guardada todavía.' };
  try {
    const sent = await wc.executeJavaScript(enterHuntScript(slug));
    return sent ? { ok: true } : { ok: false, error: 'No se pudo enviar el teleporte (socket del juego no disponible).' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
    name: `${source.name} ${mt(data.settings.language || 'es', 'ctx.copySuffix')}`,
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
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
  try {
    const image = await wc.capturePage();
    const filePath = writeScreenshotFile(image.toPNG());
    return { ok: true, path: filePath };
  } catch (err) {
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
let activeScreenshotEditorWindow = null;
ipcMain.handle('account:openScreenshotEditor', async (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
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
  } catch (err) {
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
  } catch (err) {
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
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
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
    { label: mt(lang, 'ctx.editSpace'), click: () => mainWindow.webContents.send('ui:open-space-editor', { id }) },
    { label: mt(lang, 'ctx.duplicateSpace'), click: () => duplicateSpace(id) },
    { type: 'separator' },
    {
      label: mt(lang, 'ctx.deleteSpace'),
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

// No-ops now — these used to strip every native WebContentsView out from
// under a modal dialog and re-add them after, because a native view always
// painted above the renderer's own DOM no matter its z-index. <webview>
// elements are real DOM, so a modal with a higher z-index (see style.css)
// already covers them for free; every call site (there are many, across
// modals/dropdowns/drag operations in renderer.js) is left as-is since
// calling a no-op is harmless and touching every one of them isn't worth it.
ipcMain.on('ui:hide-views', () => {});
ipcMain.on('ui:show-views', () => {});

// Live-follows a divider drag: reflects just the one panel's rect straight
// back to the renderer immediately, without touching account data or
// triggering a full renderLayout/persist — those only happen once on
// mouseup (see layout:setSplit) so dragging stays cheap and the real page
// content visibly resizes instead of a placeholder while the user drags.
ipcMain.on('account:setLiveRect', (_e, payload) => {
  if (!payload) return;
  const { id, rect } = payload;
  if (!rect || [rect.x, rect.y, rect.width, rect.height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return;
  if (!mainWindowAlive()) return;
  mainWindow.webContents.send('account:liveRect', {
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
  account.zoom = factor;
  const view = views.get(id);
  if (view) view.setZoomFactor(factor);
  persist();
  broadcastGeometryOnly();
  broadcastState();
  return data;
});

ipcMain.handle('accounts:setZoomAll', (_e, { factor }) => {
  data.accounts.forEach((a) => {
    a.zoom = factor;
  });
  for (const view of views.values()) view.setZoomFactor(factor);
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
  'defaultStartUrl',
  'supportPaypalUrl',
  'defaultZoom',
  'newSpaceDefaultLayout',
  'askDownloadLocation',
  'pokeIdleMarketPrefs',
  'stability',
  'translateMemoryPersist'
]);

ipcMain.handle('settings:update', (_e, fields) => {
  if (!fields || typeof fields !== 'object') return data;
  for (const key of Object.keys(fields)) {
    if (!SETTINGS_UPDATE_WHITELIST.has(key)) continue;
    if (key === 'pokeIdleAlerts' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
    if (key === 'pokeIdleMarketPrefs' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
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
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('settings:chooseDownloadsFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
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
      if (!/^https?:\/\//i.test(b.url)) return; // skip file://, javascript:, data: etc.
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
    if (!rows.length) return { ok: false, error: mt(data.settings.language || 'es', 'main.emptyOrUnrecognizedFile') };
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

ipcMain.handle('autofill:query', (e, origin) => {
  const host = hostnameOf(origin);
  if (!host) return [];
  // Verify that the real sender frame URL matches the claimed origin so a
  // compromised renderer can't request credentials for a different domain.
  const senderHost = hostnameOf(e.senderFrame?.url || '');
  if (senderHost && senderHost !== host) return [];
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
  if (mainWindow && e.sender !== mainWindow.webContents) return [];
  return data.passwords.map((p) => ({ ...p, password: passwordSecrets.get(p.id) || '' }));
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
    const shopTitle = Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map((el) => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
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

async function refreshGameWalletSnapshots() {
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
  if (!wc || wc.isDestroyed()) return { ...report, error: 'webContents no disponible' };
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
  } catch (err) {
    return { ...report, error: String((err && err.message) || err) };
  }
}

ipcMain.handle('gameStats:get', async () => {
  await refreshGameWalletSnapshots();
  return gameTelemetry.getAllStats();
});

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

// Every Market/Tienda/Depot/Venta-masiva/Familia handler below assumes the
// account is actually ON poke.idleworld.online right now — market.js's
// injected scripts use relative fetch('/api/game/...') URLs, which only
// resolve against that origin. An account sitting on the login page,
// about:blank, or literally any other site (these are general-purpose
// browser tabs, not exclusively game tabs) made that fetch throw "Failed
// to parse URL from /api/game/..." straight into the renderer — confirmed
// live. This guard turns that into a normal { ok: false } result with a
// clear message, the same way the market-alert background loop already
// checks isGameUrl() before touching a webContents (see startMarketAlertLoop).
function requireGameWebContents(id) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { error: 'La cuenta no está abierta' };
  if (!gameTelemetry.isGameUrl(wc.getURL())) {
    return { error: 'Esta cuenta no está en el juego ahora mismo — abrí Poke Idle World en esa pestaña primero.' };
  }
  return { wc };
}

// Market tab — browse/buy straight from the account's own session, no travel
// to an in-game NPC needed. See electron/market.js for the confirmed API shape.
ipcMain.handle('market:getListings', async (_e, { id, category }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  try {
    return await wc.executeJavaScript(market.fetchListingsScript(category));
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Tracked so the memory optimizer (Etapa 6) never clears a session's cache
// mid-purchase — a purchase in flight makes several sequential
// executeJavaScript/CDP round-trips against this exact account's webContents,
// and a cache wipe landing in the middle of that is exactly the kind of
// self-inflicted hiccup this whole stability effort exists to eliminate.
const purchaseInFlight = new Set();

ipcMain.handle('market:buy', async (_e, { id, listing }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  purchaseInFlight.add(id);
  try {
  const normalizedListing = listing ? {
    ...listing,
    kind: listing.kind ?? listing.type ?? listing.category ?? listing.slot ?? null,
    currency: String(listing.currency || listing.paymentCurrency || listing.moneyType || 'GOLD').trim().toUpperCase()
  } : listing;
  // Only reject outright when we have no id or price — kind defaults to 'item'
  // via normalizeKindCandidates, and refId is derived from listingId for stack
  // listings (st:…) so requiring it here would silently block all stack buys.
  if (!normalizedListing || normalizedListing.id == null || normalizedListing.price == null) {
    return { ok: false, error: 'Datos del listado incompletos (faltan id o precio)' };
  }
  let freshListing = normalizedListing;
  try {
    let freshResult = await wc.executeJavaScript(market.fetchListingsScript('All'));
    if (freshResult && freshResult.ok && Array.isArray(freshResult.listings)) {
      const freshMatch = freshResult.listings.find((item) => {
        if (normalizedListing.listingId != null && item.listingId != null) return String(item.listingId) === String(normalizedListing.listingId);
        if (normalizedListing.marketId != null && item.marketId != null) return String(item.marketId) === String(normalizedListing.marketId);
        if (normalizedListing.id != null && item.id != null) return String(item.id) === String(normalizedListing.id);
        if (
          normalizedListing.refId != null &&
          item.refId != null &&
          String(normalizedListing.refId) !== '0' &&
          String(item.refId) !== '0'
        ) return String(item.refId) === String(normalizedListing.refId);
        return false;
      });
      if (!freshMatch) {
        return { ok: false, error: 'El listado ya no está disponible en el Market global. Actualiza la tienda.' };
      }
      if (freshMatch) {
        freshListing = {
          ...normalizedListing,
          ...freshMatch,
          kind: freshMatch.kind ?? freshMatch.type ?? freshMatch.category ?? freshMatch.slot ?? normalizedListing.kind,
          currency: String(freshMatch.currency || freshMatch.paymentCurrency || freshMatch.moneyType || normalizedListing.currency || 'GOLD').trim().toUpperCase()
        };
      }
    }
  } catch (e) {
    console.warn('[market] refresh before buy failed', e);
  }
  const listingIdForAttempts = freshListing.listingId ?? freshListing.marketId ?? freshListing.id ?? null;
  const isStackListingForAttempts = typeof listingIdForAttempts === 'string' && listingIdForAttempts.startsWith('st:');
  const attempts = isStackListingForAttempts
    ? [freshListing.kind || freshListing.itemCategory || freshListing.category || 'item']
    : market.normalizeKindCandidates(freshListing).slice(0, 6);
  let result = { ok: false, error: 'Compra fallida' };
  for (const kindCandidate of attempts) {
    const scripts = market.buyListingScripts(freshListing, kindCandidate);
    if (!scripts.length && isStackListingForAttempts) {
      result = { ok: false, status: 404, error: 'Listado agrupado sin anuncio real comprable. Actualiza el Market global.' };
      break;
    }
    for (const script of scripts) {
      try {
        result = await wc.executeJavaScript(script);
      } catch (e) {
        result = { ok: false, error: String((e && e.message) || e) };
      }
      if (result && result.ok) break;
    }
    if (result && result.ok) break;
  }
  if (result && !result.ok) {
    const detail = typeof result.payload === 'string'
      ? result.payload
      : (result.payload && (result.payload.message || result.payload.error || JSON.stringify(result.payload))) || result.error;
    const requestHint = result.requestBody ? ` · body ${JSON.stringify(result.requestBody)}` : '';
    result.error = detail ? `Compra fallida (${result.status || 'sin estado'}): ${detail}${requestHint}` : `Compra fallida (${result.status || 'sin estado'})${requestHint}`;
  }
  // Bought (or attempted) from the alert feed — either way it's stale now,
  // drop it so the same card doesn't linger offering a purchase that either
  // already happened or just failed for a reason retrying won't fix (listing
  // gone).
  if (result && result.ok) {
    const paidCurrency = market.normalizeCurrency(freshListing.currency || freshListing.paymentCurrency || freshListing.moneyType);
    const paidPrice = Number(freshListing.price ?? freshListing.amount ?? 0) || 0;
    if (paidPrice > 0) gameTelemetry.adjustWallet(id, { currency: paidCurrency, delta: -paidPrice });
    try {
      result.postBuySync = await wc.executeJavaScript(market.postBuySyncScript(freshListing));
    } catch (e) {
      result.postBuySync = { ok: false, error: String((e && e.message) || e) };
    }
    result.realtimeSync = await pulseGameRealtimeConnection(wc);
    try {
      result.postBuySyncAfterPulse = await wc.executeJavaScript(market.postBuySyncScript(freshListing));
    } catch (e) {
      result.postBuySyncAfterPulse = { ok: false, error: String((e && e.message) || e) };
    }
    // Full page reload removed: postBuySyncScript + pulseGameRealtimeConnection
    // are enough to deliver the purchased item to the depot. A reload was
    // interrupting gameplay (losing the displayed Pokémon level, mid-battle
    // state, etc.) for no additional benefit.
    result.gameStateReload = { ok: true, reloaded: false, skipped: true };
    marketAlertFeed = marketAlertFeed.filter((a) => a.listing.id !== freshListing.id);
    data.marketPurchases = data.marketPurchases || [];
    data.marketPurchases.unshift({
      accountId: id,
      listingId: freshListing.listingId ?? freshListing.marketId ?? freshListing.id ?? null,
      refId: freshListing.refId ?? null,
      name: freshListing.name || freshListing.title || freshListing.speciesName || freshListing.itemName || freshListing.productName || 'Market listing',
      kind: freshListing.itemCategory || freshListing.kind || freshListing.category || freshListing.type || null,
      currency: paidCurrency,
      price: paidPrice,
      rarity: freshListing.rarity || freshListing.qualityLabel || freshListing.qualityName || null,
      quality: freshListing.quality ?? freshListing.qualityValue ?? null,
      iv: freshListing.iv ?? freshListing.ivTotal ?? freshListing.totalIv ?? null,
      itemId: freshListing.itemId ?? freshListing.productId ?? freshListing.item?.id ?? null,
      speciesId: freshListing.pokeId ?? freshListing.speciesId ?? freshListing.dexId ?? null,
      at: Date.now()
    });
    if (data.marketPurchases.length > 200) data.marketPurchases.length = 200;
    persist();
  }
  return result;
  } finally {
    purchaseInFlight.delete(id);
  }
});

// NPC shop (Mark) — Etapa 5. Simpler than market:buy: no depot-sync dance
// needed since shop purchases land straight in inventory (confirmed live,
// no UI-click simulation required), so this is just fetch + POST, sharing
// purchaseInFlight with the Global Market purchase-in-flight guard.
ipcMain.handle('shop:get', async (_e, { id }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  try {
    return await wc.executeJavaScript(market.fetchShopScript());
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('shop:buy', async (_e, { id, ballId, itemId, qty }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum < 1) return { ok: false, error: 'Cantidad inválida' };
  if (ballId == null && itemId == null) return { ok: false, error: 'Falta el ítem a comprar' };
  purchaseInFlight.add(id);
  try {
    const result = await wc.executeJavaScript(market.buyShopScript({ ballId, itemId, qty: qtyNum }));
    return result;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

// Mass sell (Etapa 6) — endpoints confirmed live (NEXA_DEBUG_NET capture,
// see market.js). `items` is [{itemId,qty}]; `pokeIds` are the game's own
// string ids. Server-side re-filters against the account's own lock lists
// as a second line of defense — the renderer already excludes locked
// entries from its selection UI, but this endpoint could in principle be
// called with a stale/tampered payload, and the lock's whole point is that
// a locked item/pokemon must never sell even by mistake.
ipcMain.handle('items:sell', async (_e, { id, items }) => {
  const account = getAccount(id);
  if (!account) return { ok: false, error: 'La cuenta no está abierta' };
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'Nada para vender' };
  const lockedIds = new Set(account.sellLockItemIds || []);
  const filtered = items.filter((it) => it && Number.isInteger(it.itemId) && !lockedIds.has(it.itemId) && Number.isInteger(it.qty) && it.qty > 0);
  if (!filtered.length) return { ok: false, error: 'Todos los ítems seleccionados están protegidos.' };
  purchaseInFlight.add(id);
  try {
    return await wc.executeJavaScript(market.sellItemsScript(filtered));
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

ipcMain.handle('pokemon:sell', async (_e, { id, pokeIds }) => {
  const account = getAccount(id);
  if (!account) return { ok: false, error: 'La cuenta no está abierta' };
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  if (!Array.isArray(pokeIds) || !pokeIds.length) return { ok: false, error: 'Nada para vender' };
  const lockedIds = new Set(account.sellLockPokeIds || []);
  const filtered = pokeIds.map(String).filter((pid) => !lockedIds.has(pid));
  if (!filtered.length) return { ok: false, error: 'Todos los Pokémon seleccionados están protegidos.' };
  purchaseInFlight.add(id);
  try {
    const result = await wc.executeJavaScript(market.sellPokemonScript(filtered));
    if (result && result.ok) {
      // See sendGameSocketFrameScript's comment: the server never pushes an
      // updated `pokes` frame on its own after a sell, only in response to
      // this explicit request. Actually AWAITING the real response (instead
      // of firing pokes-get and returning immediately) matters — confirmed
      // live that racing a fixed delay against the real round-trip still
      // showed stale, already-sold pokemon in the panel; only resolving once
      // game-telemetry actually processes the fresh `pokes` frame guarantees
      // the caller's refresh (right after this IPC call returns) sees it.
      const waitPromise = gameTelemetry.waitForNextPokes(id);
      await wc.executeJavaScript(sendGameSocketFrameScript({ type: 'pokes-get' })).catch(() => {});
      await waitPromise;
    }
    return result;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

// Depot (Etapa 7) — endpoints confirmed live (NEXA_DEBUG_NET capture): items
// move over REST (POST /api/game/depot/move), pokemon move over the game's
// own WebSocket (poke-store/poke-withdraw), mirroring how sell/teleport
// already work for each of those two systems respectively.
ipcMain.handle('depot:get', async (_e, { id }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  try {
    return await wc.executeJavaScript(market.fetchDepotScript());
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('depot:moveItem', async (_e, { id, itemId, dir }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  if (!Number.isInteger(itemId) || (dir !== 'store' && dir !== 'withdraw')) return { ok: false, error: 'Datos inválidos' };
  purchaseInFlight.add(id);
  try {
    return await wc.executeJavaScript(market.depotMoveItemScript(itemId, dir));
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

ipcMain.handle('depot:movePoke', async (_e, { id, pokeId, dir }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  if (!pokeId || (dir !== 'store' && dir !== 'withdraw')) return { ok: false, error: 'Datos inválidos' };
  purchaseInFlight.add(id);
  try {
    const waitPromise = gameTelemetry.waitForNextPokes(id);
    const sent = await wc.executeJavaScript(sendGameSocketFrameScript({ type: dir === 'store' ? 'poke-store' : 'poke-withdraw', pokeId: String(pokeId) }));
    if (!sent) return { ok: false, error: 'No se pudo enviar el movimiento (socket del juego no disponible).' };
    const confirmed = await waitPromise;
    if (!confirmed) return { ok: false, error: 'El movimiento se envió, pero el servidor no confirmó el cambio a tiempo. Revisa el depot antes de reintentar.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

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
  if (error) return { ok: false, error };
  try {
    const waitPromise = gameTelemetry.waitForNextPokes(id);
    const sent = await wc.executeJavaScript(sendGameSocketFrameScript({ type: 'pokes-get' }));
    if (!sent) return { ok: false, error: 'No se pudo pedir los datos (socket del juego no disponible).' };
    const confirmed = await waitPromise;
    if (!confirmed) return { ok: false, error: 'El servidor no respondió a tiempo. Intenta de nuevo.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Family depot — endpoints confirmed live (NEXA_DEBUG_NET capture, account
// actually in a family this time): everything goes over the game's own
// WebSocket, no REST. {"type":"family-get"} -> {type:"family", family:{...,
// frozen, movesUsed, movesCap, members:[...]}, canCreate, invites, depot:
// {items:[{itemId,quantity,name,icon}], pokes:[{id,speciesId,...}]}}.
// Deposit/withdraw is {"type":"family-action","action":"item"|"poke",
// "dir":"deposit"|"withdraw", itemId+quantity (items) or capturedId
// (pokemon)}, which triggers the exact same `family` frame back — same
// wait-for-the-real-frame pattern as pokemon sell/depot, reusing the now-
// generic waitForFrame() instead of a fixed delay.
ipcMain.handle('family:get', async (_e, { id }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  try {
    const waitPromise = gameTelemetry.waitForFrame(id, 'family');
    const sent = await wc.executeJavaScript(sendGameSocketFrameScript({ type: 'family-get' }));
    if (!sent) return { ok: false, error: 'No se pudo pedir los datos (socket del juego no disponible).' };
    const confirmed = await waitPromise;
    if (!confirmed) return { ok: false, error: 'El servidor no respondió a tiempo. Intenta de nuevo.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('family:moveItem', async (_e, { id, itemId, quantity, dir }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || (dir !== 'deposit' && dir !== 'withdraw')) {
    return { ok: false, error: 'Datos inválidos' };
  }
  purchaseInFlight.add(id);
  try {
    const waitPromise = gameTelemetry.waitForFrame(id, 'family');
    const sent = await wc.executeJavaScript(sendGameSocketFrameScript({ type: 'family-action', action: 'item', dir, itemId, quantity }));
    if (!sent) return { ok: false, error: 'No se pudo enviar el movimiento (socket del juego no disponible).' };
    const confirmed = await waitPromise;
    if (!confirmed) return { ok: false, error: 'El movimiento se envió, pero el servidor no confirmó el cambio a tiempo. Revisa el depot familiar antes de reintentar.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

ipcMain.handle('family:movePoke', async (_e, { id, pokeId, dir }) => {
  const { wc, error } = requireGameWebContents(id);
  if (error) return { ok: false, error };
  if (!pokeId || (dir !== 'deposit' && dir !== 'withdraw')) return { ok: false, error: 'Datos inválidos' };
  purchaseInFlight.add(id);
  try {
    const waitFamily = gameTelemetry.waitForFrame(id, 'family');
    const waitPokes = gameTelemetry.waitForFrame(id, 'pokes');
    const sent = await wc.executeJavaScript(sendGameSocketFrameScript({ type: 'family-action', action: 'poke', dir, capturedId: String(pokeId) }));
    if (!sent) return { ok: false, error: 'No se pudo enviar el movimiento (socket del juego no disponible).' };
    const [familyConfirmed, pokesConfirmed] = await Promise.all([waitFamily, waitPokes]);
    if (!familyConfirmed || !pokesConfirmed) return { ok: false, error: 'El movimiento se envió, pero el servidor no confirmó el cambio a tiempo. Revisa el depot familiar antes de reintentar.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    purchaseInFlight.delete(id);
  }
});

ipcMain.handle('market:getAlertFeed', () => {
  pruneMarketAlertFeed();
  return marketAlertFeed.slice(0, MARKET_ALERT_FEED_CAP);
});
ipcMain.handle('market:dismissAlert', (_e, { alertId }) => {
  const id = String(alertId || '');
  if (!id) {
    pruneMarketAlertFeed();
    return marketAlertFeed.slice(0, MARKET_ALERT_FEED_CAP);
  }
  marketAlertFeed = marketAlertFeed.filter((entry) => String(entry.alertId || marketAlertId(entry.accountId, entry.listing)) !== id);
  pruneMarketAlertFeed();
  broadcastMarketAlertFeed();
  return marketAlertFeed.slice(0, MARKET_ALERT_FEED_CAP);
});
ipcMain.handle('market:getPurchaseHistory', () => data.marketPurchases || []);

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

// Documented in the user's own reference tool: "Oro esperado por kill = Σ
// (chance% × cantidad media × precio NPC del item)" — NOT the species'
// sellValue/capturePrice (that's what you get for CATCHING it, gated by a
// capture chance the game never reveals; killing-for-loot is a completely
// different economy). `chance` in creatures.json's loot entries is out of
// 100000 (confirmed: 71498 there reads as "71.498%"). Each creature —
// including the 10000+ "flavor variant" hunts (Brave X, Furious X, etc.) —
// carries its OWN loot table in the same catalog already cached, so this
// stays correct per-variant without needing a separate lookup.
function lootGoldPerKill(creature, itemPriceByName) {
  if (!Array.isArray(creature.loot) || !itemPriceByName) return 0;
  let total = 0;
  for (const drop of creature.loot) {
    if (!drop || !drop.name) continue;
    const price = itemPriceByName.get(drop.name) || 0;
    const avgCount = ((drop.minCount || 0) + (drop.maxCount || 0)) / 2;
    const chanceFrac = (drop.chance || 0) / 100000;
    total += chanceFrac * avgCount * price;
  }
  return total;
}

// Species documented in the Poképedia but manually confirmed by the user
// (in-game, not just from the catalog) to not actually be spawnable as a
// hunt yet — their catalog entries have placeholder/unreliable loot data
// (that's what caused the anomalously-high gold/h the user first flagged).
// Ported verbatim from their own verified list rather than guessed.
const UNCONFIRMED_HUNT_SPECIES = new Set(['Sentret', 'Furret', 'Ledyba', 'Ledian', 'Yanma', 'Dunsparce', 'Slowking']);

// Caza & XP / Ruta de Farmeo: every huntable species with XP/h, oro/h (using
// a real or estimated kills-per-hour rate) and, if an attacker type was
// given, the damage matchup multiplier against it — same 650 kills/h default
// as the reference site when no real rate is available.
ipcMain.handle('pokeFormulas:getHuntTable', async (_e, payload) => {
  const { attackerType1, attackerType2, killsPerHour } = payload || {};
  await Promise.all([gameTelemetry.ensureCreatureCatalog(), gameTelemetry.ensureItemPriceCatalog()]);
  const kph = killsPerHour && killsPerHour > 0 ? killsPerHour : 650;
  const itemPriceByName = gameTelemetry.getItemPriceByNameMap();
  return gameTelemetry.getCreatureCatalogArray()
    .filter((c) => !UNCONFIRMED_HUNT_SPECIES.has(c.name))
    .map((c) => ({
      pokeId: c.pokeId,
      name: c.name,
      type1: c.type1,
      type2: c.type2 || null,
      rarity: c.rarity,
      huntLevel: c.huntLevel,
      matchup: attackerType1 ? pokeFormulas.matchupFor(attackerType1, c.type1, c.type2) : null,
      matchup2: attackerType2 ? pokeFormulas.matchupFor(attackerType2, c.type1, c.type2) : null,
      xpPerHour: Math.round(pokeFormulas.xpPerHour(c.experience || 0, kph)),
      goldPerHour: Math.round(pokeFormulas.goldPerHour(lootGoldPerKill(c, itemPriceByName), kph))
    }));
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('memory:optimizeStatus', {
    lastOptimizeAt,
    running: optimizeRunning,
    dueIn: Math.max(0, lastOptimizeAt + 24 * 60 * 60 * 1000 - Date.now())
  });
}

// Safe tier — gated per-account by memory-optimizer.js's shouldSkipOptimize:
// skips accounts under the configured cache-growth threshold, mid-purchase,
// mid-page-load, or currently RECOVERING (connection-manager state), instead
// of the old behavior of always clearing every session's cache regardless
// of whether there was anything worth clearing or whether now was a safe
// moment to do it.
async function optimizeMemorySafe() {
  if (optimizeRunning) return { ok: false, reason: 'already running' };
  optimizeRunning = true;
  broadcastOptimizeStatus();
  const thresholdMb = (data.settings.stability && data.settings.stability.memoryGrowthThresholdMb) || memoryOptimizer.DEFAULT_MEMORY_GROWTH_THRESHOLD_MB;
  const result = { sessionsCleaned: 0, sessionsSkipped: 0, viewsPurged: 0, cacheCleared: 0 };
  try {
    const clearedSessions = new Set();
    for (const account of data.accounts) {
      const wc = views.get(account.id);
      const ses = wc && !wc.isDestroyed() ? wc.session : session.fromPartition(accountPartition(account.id));
      const key = ses.storagePath || account.id;
      if (clearedSessions.has(key)) continue;

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
        isLoading: !!(wc && !wc.isDestroyed() && typeof wc.isLoadingMainFrame === 'function' && wc.isLoadingMainFrame()),
        purchaseInFlight: purchaseInFlight.has(account.id)
      });
      if (skip) {
        result.sessionsSkipped++;
        console.log('[optimize] skipping', account.id, '—', reason);
        continue;
      }

      clearedSessions.add(key);
      try {
        // 1. HTTP disk cache — just cached network responses, not auth state
        //    or game data.
        await ses.clearCache();
        // Cache Storage API (service-worker offline caches) — also safe.
        await ses.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] });
        result.sessionsCleaned++;
      } catch {}
    }
    // Also clear the main window's session.
    try {
      await session.defaultSession.clearCache();
      result.cacheCleared++;
    } catch {}

    // 2. For INACTIVE account renderers: ask the renderer to GC its own JS
    //    heap. The active account is left untouched so farming isn't broken.
    const activeId = data.settings.activeAccountId;
    for (const [accountId, wc] of views.entries()) {
      if (accountId === activeId || wc.isDestroyed() || purchaseInFlight.has(accountId)) continue;
      try {
        // Works if the game exposes gc() — best-effort, no CDP involved
        // (game accounts no longer attach the CDP debugger at all since the
        // telemetry capture migrated to a passive JS patch). Renderers never
        // get --js-flags=--expose-gc, so window.gc is realistically always
        // undefined right now — only counting a REAL purge (instead of
        // unconditionally incrementing) keeps viewsPurged from silently
        // claiming JS-heap purges that never happened.
        const purged = await wc.executeJavaScript(
          '(() => { try { if (typeof window.gc === "function") { window.gc(); return true; } return false; } catch (e) { return false; } })()'
        ).catch(() => false);
        if (purged) result.viewsPurged++;
      } catch {}
    }

    lastOptimizeAt = Date.now();
  } finally {
    optimizeRunning = false;
    broadcastOptimizeStatus();
  }
  return { ok: true, ...result };
}

// Deep-clean tier — manual only (never called from the auto-optimize loop),
// more aggressive but still bound by the same hard rule as the safe tier:
// never touches cookies/IndexedDB/localStorage/sessions. The only extra
// thing this does beyond the safe tier is skip the per-account
// growth-threshold gate — every session gets cleared regardless of size —
// which is exactly what "deep clean" should mean versus a size-gated
// routine sweep.
async function optimizeMemoryDeepClean() {
  if (optimizeRunning) return { ok: false, reason: 'already running' };
  optimizeRunning = true;
  broadcastOptimizeStatus();
  const result = { sessionsCleaned: 0, viewsPurged: 0, cacheCleared: 0 };
  try {
    const clearedSessions = new Set();
    for (const account of data.accounts) {
      const wc = views.get(account.id);
      if (purchaseInFlight.has(account.id)) continue; // never mid-purchase, even for a deep clean
      const ses = wc && !wc.isDestroyed() ? wc.session : session.fromPartition(accountPartition(account.id));
      const key = ses.storagePath || account.id;
      if (clearedSessions.has(key)) continue;
      clearedSessions.add(key);
      try {
        await ses.clearCache();
        await ses.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] });
        result.sessionsCleaned++;
      } catch {}
    }
    try {
      await session.defaultSession.clearCache();
      result.cacheCleared++;
    } catch {}
    const activeId = data.settings.activeAccountId;
    for (const [accountId, wc] of views.entries()) {
      if (accountId === activeId || wc.isDestroyed() || purchaseInFlight.has(accountId)) continue;
      try {
        const purged = await wc.executeJavaScript(
          '(() => { try { if (typeof window.gc === "function") { window.gc(); return true; } return false; } catch (e) { return false; } })()'
        ).catch(() => false);
        if (purged) result.viewsPurged++;
      } catch {}
    }
    lastOptimizeAt = Date.now();
  } finally {
    optimizeRunning = false;
    broadcastOptimizeStatus();
  }
  return { ok: true, ...result };
}

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
      console.log('[optimize] system-wide free memory low (', Math.round(freeMb), '/', Math.round(totalMb), 'MB free) — running auto-optimization early (safe tier)');
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stability:update', change);
        }
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
function attachGameCaptureFor(wc, accountId) {
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
    // Reused unchanged — also called directly from the market auto-buy flow
    // (see market listing purchase handler), so its signature/behavior must
    // not change here.
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
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'cuenta no disponible' };
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
    lastGpuCrashAt = now;
    // Never disable permanently off a single crash — only after a real
    // crash-loop (3+ in a 5 min window), and reuses the existing
    // hardwareAcceleration setting (already has a UI toggle) rather than
    // adding a new one, so the user can self-revert from Configuración.
    if (consecutiveGpuCrashes >= 3 && data.settings.hardwareAcceleration !== false) {
      console.error('[crash-global] GPU crashed', consecutiveGpuCrashes, 'times in', GPU_CRASH_LOOP_WINDOW_MS / 1000, 's — disabling hardware acceleration for the next launch');
      data.settings.hardwareAcceleration = false;
      persist();
      try {
        new Notification({
          title: 'Nexa Browser',
          body: 'La GPU falló varias veces seguidas — se desactivó la aceleración por hardware para el próximo inicio. Podés reactivarla en Configuración.'
        }).show();
      } catch { /* Notification unsupported/unavailable — non-fatal */ }
    }
  }
});

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

ipcMain.handle('diagnostics:exportReport', async () => {
  const appMetrics = app.getAppMetrics();
  const byPid = new Map(appMetrics.map((m) => [m.pid, m]));
  const memoryStats = [];
  const accountConnectionStates = [];
  const networkSnapshots = [];
  const adBlockLogFlat = [];

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
    if (gameTelemetry.isGameUrl(wc.getURL())) {
      const snapshot = await networkHealth.checkAccountNetwork(account.id, { hostname: 'poke.idleworld.online' });
      networkSnapshots.push({ accountId: account.id, ...snapshot });
    }
    const log = adblockManager.getLogForAccount(account.id);
    if (log) adBlockLogFlat.push(...log);
  }

  return diagnostics.buildReport({ accountConnectionStates, networkSnapshots, adBlockLog: adBlockLogFlat, memoryStats });
});

let activeNetLogSession = null; // { accountId, path } | null — one capture at a time, kept simple on purpose

ipcMain.handle('diagnostics:startNetLog', async (_e, { id }) => {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'cuenta no disponible' };
  if (activeNetLogSession) return { ok: false, error: `ya hay una captura en curso (${activeNetLogSession.accountId})` };
  const logPath = path.join(app.getPath('userData'), `netlog-${id}-${Date.now()}.json`);
  const result = await networkHealth.startNetLogCapture(wc.session, { path: logPath, maxSizeMb: 20 });
  if (result.ok) activeNetLogSession = { accountId: id, path: logPath };
  return result;
});

ipcMain.handle('diagnostics:stopNetLog', async () => {
  if (!activeNetLogSession) return { ok: false, error: 'no hay una captura en curso' };
  const wc = views.get(activeNetLogSession.accountId);
  const ses = wc && !wc.isDestroyed() ? wc.session : null;
  const result = ses ? await networkHealth.stopNetLogCapture(ses) : { ok: false, error: 'sesión ya no disponible' };
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

// Returns a small result object (not just fire-and-forget) — the watch
// loop below ignores it, but this is also exposed directly over IPC (see
// translate:chatOnce) both to make this independently useful (a manual
// "translate chat now" trigger, e.g. if the 800ms tick hasn't caught up
// yet) and to make it possible to test at all — Playwright can't reach a
// <webview>'s DOM to verify a fire-and-forget effect any other way.
async function translateChatMessages(id) {
  const wc = views.get(id);
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
  let hostname;
  try {
    hostname = new URL(wc.getURL()).hostname;
  } catch {
    return { ok: false, error: 'URL inválida' };
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
      const histEntry = username && history.get(username);
      if (!from && histEntry && histEntry.count >= CHAT_HISTORY_CONFIDENCE_THRESHOLD) {
        // franc couldn't tell on its own (too short) — fall back to what
        // this same player has reliably written in before.
        from = histEntry.lang;
      }
      // Confirmed live: franc has real false positives for short/slangy
      // Portuguese chat text landing on 'es' (e.g. "Onde que vai pora
      // breedar?" detected as Spanish) — since 'es' is also this app's
      // usual target language, that misdetection made the message look
      // "already translated" and skip forever. A confident, already-built
      // history for this exact user in a different supported language is
      // stronger evidence than a single franc guess on a short message.
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
        if (existing && existing.lang === from) existing.count += 1;
        else history.set(username, { lang: from, count: 1 });
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
            if (mainWindowAlive()) mainWindow.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
          }
        });
        entries.forEach((e, i) => translations.push({ index: e.index, text: translated[i] }));
      } catch (err) {
        console.error('[translate] chat group', from, '->', to, 'failed for', id, err);
      }
    }
    if (downloadHappened && mainWindowAlive()) mainWindow.webContents.send('translate:downloadFinished', { id });
    if (translations.length) await wc.executeJavaScript(translate.applyChatTranslationsScript(translations));
    if (!wc.isDestroyed()) wc.executeJavaScript(translate.chatTranslateStatusScript('done', translations.length)).catch(() => {});
    return { ok: true, translated: translations.length, seen: extracted.items.length };
  } catch (err) {
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
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
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
        if (mainWindowAlive()) {
          mainWindow.webContents.send('translate:progress', { id, done: 0, total: pending.fragments.length });
        }
        const { results, translatedCount: groupCount } = await translateFragmentsMixed(pending.fragments, watching.to, watching.pageLang, {
          html: false,
          onProgress: (done, total) => {
            if (mainWindowAlive()) mainWindow.webContents.send('translate:progress', { id, done, total });
          },
          onDownloadProgress: ({ filename, loaded, total }) => {
            if (mainWindowAlive()) mainWindow.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
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

    if (mainWindowAlive()) {
      mainWindow.webContents.send('translate:progress', { id, done: 0, total: priorityFragments.length });
    }
    const { results: translatedPriority, translatedCount: priorityTranslatedCount, from: dominantFrom } = await translateFragmentsMixed(priorityFragments, to, extracted.from, {
      html: false,
      onProgress: (done, total) => {
        if (mainWindowAlive()) mainWindow.webContents.send('translate:progress', { id, done, total });
      },
      onDownloadProgress: ({ filename, loaded, total }) => {
        if (mainWindowAlive()) mainWindow.webContents.send('translate:downloadProgress', { id, filename, loaded, total });
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

    if (!data.settings.hasUsedTranslate) {
      data.settings.hasUsedTranslate = true;
      persist();
    }
    translationEnabled.set(id, to);
    return { ok: true, translated: priorityTranslatedCount, from: dominantFrom || extracted.from, to };
  } catch (err) {
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
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'La cuenta no está abierta' };
  try {
    await wc.executeJavaScript(translate.restorePageTextScript());
    return { ok: true };
  } catch (err) {
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
function startPageTranslateWatchLoop() {
  setInterval(async () => {
    for (const [id, { pageLang, to }] of translateWatching) {
      const wc = views.get(id);
      if (!wc || wc.isDestroyed()) {
        translateWatching.delete(id);
        continue;
      }
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
function startChatAutoTranslateLoop() {
  setInterval(() => {
    for (const account of data.accounts) {
      if (!account.closed && account.chatAutoTranslate) translateChatMessages(account.id);
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
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions');
  let entries;
  try {
    entries = fs.readdirSync(partitionsDir, { withFileTypes: true });
  } catch {
    return; // no Partitions dir yet — nothing to clean
  }
  const liveIds = new Set(data.accounts.map((a) => a.id));
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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
  // Same safeStorage boundary, same "not reliable before whenReady()" reason
  // as the password decrypt right above — see decryptAccountProxies in store.js.
  data.accounts = store.decryptAccountProxies(data.accounts);
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
  });
  gameTelemetry.startHeartbeat();
  gameTelemetry.setBallsLowThreshold(data.settings.pokeIdleAlerts?.ballsThreshold ?? 20);
  startPokeIdleAlertLoop();
  startMarketAlertLoop();
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
    if (!mainWindowAlive()) return;
    mainWindow.webContents.send('update:downloadProgress', {
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
    if (!mainWindowAlive()) return;
    const notes = info.releaseNotes;
    const releaseNotes = typeof notes === 'string'
      ? notes
      : Array.isArray(notes)
        ? notes.map((n) => `## ${n.version}\n${n.note || ''}`).join('\n\n')
        : '';
    mainWindow.webContents.send('update:downloaded', { version: info.version, releaseNotes });
  });
  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    renderLayout();
    broadcastState();
    // Deferred past first paint — see the comment on loadAdBlockEngine().
    loadAdBlockEngine();
    adblockManager.registerCosmeticIpcHandlers();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  } catch (err) {
    console.error('[boot] failed during app.whenReady()', err);
    dialog.showErrorBox('Nexa Browser', String(err && err.stack ? err.stack : err));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  appQuitting = true;
  powerManager.shutdownPowerManager();
  if (data.settings.translateMemoryPersist) translate.savePersistedCache(TRANSLATE_MEMORY_FILE);
  flushPersist();
  // Bergamot's own README is explicit about this: skipping delete() on a
  // NodeJS translator leaves its worker thread listening for messages
  // forever, which can keep the process from exiting cleanly on its own.
  translate.shutdown();
});
