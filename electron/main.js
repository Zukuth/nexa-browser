const { app, BrowserWindow, ipcMain, session, Menu, shell, dialog, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const store = require('./store');
const { GAP, GRID_MAX_PANELS, MIN_SPLIT_FRAC, resolveFracs, cellsForMode, freeCells, normalizeFracsWithMin } = require('./layout-utils');
const gameTelemetry = require('./game-telemetry');
const pokeFormulas = require('./poke-formulas');
const market = require('./market');
const networkHealth = require('./network-health');
const powerManager = require('./power-manager');
const gameConnectionManager = require('./game-connection-manager');
const memoryOptimizer = require('./memory-optimizer');
const { classifyCrash } = require('./crash-classifier');
const diagnostics = require('./diagnostics');
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
const GAME_STATE_RELOAD_TIMEOUT_MS = 12000;

// app.getPath('userData') is derived from package.json's "name" field
// ("nexa-browser" since the rebrand) — do not change that field again without
// a migration step, or existing spaces/accounts/passwords/extensions become
// invisible to the app (new empty folder, old one orphaned). The data file
// itself went through exactly this migration — see LEGACY_DATA_FILE in store.js.
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
const ADBLOCK_ALLOWLIST = new Set([
  'poke.idleworld.online',
  'challenges.cloudflare.com',
  'static.cloudflareinsights.com'
]);

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
  if (ADBLOCK_ALLOWLIST.has(h)) return false;
  while (h.includes('.')) {
    if (ADBLOCK_ALLOWLIST.has(h)) return false;
    if (blockedDomains.has(h)) return true;
    h = h.slice(h.indexOf('.') + 1);
  }
  return false;
}

// Diagnostic ring buffer, per account — doesn't change any block/allow
// decision, just makes what got blocked inspectable (diagnostics.js export,
// Etapa 8) instead of only a running count. Capped so a chatty page can't
// grow this unbounded over a multi-day session.
const AD_BLOCK_LOG_CAP = 500;
const adBlockLog = new Map(); // accountId -> array of {url, hostname, resourceType, initiator, accountId, timestamp}

function recordAdBlockEntry(accountId, entry) {
  let log = adBlockLog.get(accountId);
  if (!log) {
    log = [];
    adBlockLog.set(accountId, log);
  }
  diagnostics.pushCapped(log, entry, AD_BLOCK_LOG_CAP);
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
      recordAdBlockEntry(accountId, {
        url: details.url,
        hostname,
        resourceType: details.resourceType,
        initiator: details.initiator || null,
        accountId,
        timestamp: Date.now()
      });
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

// Poke Idle World has no legitimate use for a camera, microphone, or the
// player's real-world location — narrowing the default for that domain
// specifically (instead of the same blanket ALLOWED_PERMISSIONS every other
// site gets) cuts attack surface and avoids spurious OS permission prompts,
// without touching normal browsing, where camera/mic requests are expected
// (video calls, etc.).
const GAME_DENIED_PERMISSIONS = new Set(['media', 'geolocation']);

function isAllowedExternalSupportUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)paypal\.com$/i.test(parsed.hostname) || /(^|\.)paypal\.me$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function applyPermissionHandler(ses, account) {
  const isGameAccount = !!(account && account.url && gameTelemetry.isGameUrl(account.url));
  const allow = (permission) => ALLOWED_PERMISSIONS.has(permission) && !(isGameAccount && GAME_DENIED_PERMISSIONS.has(permission));
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allow(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allow(permission));
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
const poppedOutIds = new Set();
const poppedOutWindows = new Map();
// One open popup window per extension at a time, keyed by extension id —
// clicking its toolbar icon again while already open just closes it,
// matching how a real browser's extension popup toggles.
const extensionPopupWindows = new Map();

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
      if (redirects > 5) return reject(new Error(mt(data.settings.language || 'es', 'main.tooManyRedirects')));
      https
        .get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            get(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(mt(data.settings.language || 'es', 'main.downloadFailed', { status: res.statusCode })));
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
  if (buf.toString('utf8', 0, 4) !== 'Cr24') throw new Error(mt(data.settings.language || 'es', 'main.invalidCrxFile'));
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
    throw new Error(mt(data.settings.language || 'es', 'main.unsupportedCrxVersion'));
  }
  return buf.subarray(offset);
}

async function loadExtensionOnAllSessions(dir) {
  let result = null;
  for (const view of views.values()) {
    try {
      result = await view.session.extensions.loadExtension(dir, { allowFileAccess: true });
    } catch {
      // session may already have it loaded, or view may be closing — ignore
    }
  }
  return result;
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
  if (!id) throw new Error(mt(data.settings.language || 'es', 'main.noValidExtensionId'));
  if (data.settings.extensions.some((e) => e.id === id)) throw new Error(mt(data.settings.language || 'es', 'main.extensionAlreadyInstalled'));

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
    action: extractExtensionAction(manifest, dir),
    enabled: true
  };
  data.settings.extensions.push(entry);
  persist();
  broadcastState();
  return entry;
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

const SPACE_COLORS = ['#4f8cff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#f06595', '#22b8cf'];
const SPACE_ICON_KEYS = ['grid', 'gamepad', 'swords', 'shield', 'flame', 'leaf', 'droplet', 'bolt', 'star', 'crown', 'ghost', 'rocket'];

const SHORTCUTS = [
  { combo: 'Ctrl + 1–9', key: 'shortcut.selectPanel' },
  { combo: 'Ctrl + Tab', key: 'shortcut.nextPanel' },
  { combo: 'Ctrl + Shift + N', key: 'shortcut.newSpace' },
  { combo: 'Ctrl + N', key: 'shortcut.newAccount' },
  { combo: 'Ctrl + R', key: 'shortcut.reloadActive' },
  { combo: 'Ctrl + Shift + R', key: 'shortcut.reloadHardActive' },
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
function syncBackgroundThrottling(wc, url) {
  if (!wc || wc.isDestroyed()) return;
  wc.setBackgroundThrottling(!gameTelemetry.isGameUrl(url));
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
  // isolated session and autofill preload as their opener.
  wc.setWindowOpenHandler(() => ({
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
  }));
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
        await wc.session.extensions.loadExtension(e.path, { allowFileAccess: true });
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
  wc.on('did-navigate', (_e, url) => notifyNav(account.id, url));
  wc.on('did-navigate-in-page', (_e, url) => {
    notifyNav(account.id, url);
    syncBackgroundThrottling(wc, url);
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
    wc.setZoomFactor(account.zoom || data.settings.defaultZoom || 1);
    syncBackgroundThrottling(wc, wc.getURL());
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
  wc.on('context-menu', (_e, params) => showPageContextMenu(wc, params));
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
    console.log(`[page:${account.id}] ${message} (${sourceId}:${line})`);
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

  if (!hostWebContents.isDestroyed()) hostWebContents.send('webview:ready', account.id);
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
// to call again on every full page load.
const ECO_MODE_FPS = 15;
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

function showPageContextMenu(wc, params) {
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
    items.push({ label: mt(lang, 'ctx.copy'), click: () => clipboard.writeText(params.selectionText) }, { type: 'separator' });
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
  if (!account) return;
  const target = /^https?:\/\/|^about:/.test(url) ? url : `https://${url}`;
  account.url = target;
  persist();
  ensureView(account)?.loadURL(target);
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
  blockedCounts.delete(id);
  crashCounts.delete(id);
  adBlockLog.delete(id);
  connectionManagers.delete(id);
  gameTelemetry.removeState(id);
  notifiedEventAt.delete(id);
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

ipcMain.handle('accounts:update', (_e, { id, name, color, url, proxy, ecoMode, hideChat, hideGameBar, sellLockOn, cleanGameProfile }) => {
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
// actually has that extension loaded, so this reuses the currently active
// account's session (falling back to any open account) rather than a
// dedicated session, matching where the extension is actually running.
ipcMain.handle('extensions:openPopup', (_e, { id }) => {
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

  const popup = new BrowserWindow({
    width: 380,
    height: 560,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    title: ext.action.title || ext.name,
    webPreferences: { session: wc.session }
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    const b = mainWindow.getBounds();
    popup.setPosition(Math.round(b.x + b.width - 400), Math.round(b.y + 90));
  }
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
  const ext = data.settings.extensions.find((e) => e.id === id);
  if (!ext) return data;
  ext.enabled = enabled;
  if (enabled) {
    for (const view of views.values()) {
      view.session.extensions
        .loadExtension(ext.path, { allowFileAccess: true })
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
  'adBlockEnabled',
  'defaultStartUrl',
  'supportPaypalUrl',
  'defaultZoom',
  'newSpaceDefaultLayout',
  'askDownloadLocation',
  'pokeIdleMarketPrefs',
  'stability'
]);

ipcMain.handle('settings:update', (_e, fields) => {
  if (!fields || typeof fields !== 'object') return data;
  for (const key of Object.keys(fields)) {
    if (!SETTINGS_UPDATE_WHITELIST.has(key)) continue;
    if (key === 'pokeIdleAlerts' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
    if (key === 'pokeIdleMarketPrefs' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
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

function reloadGamePageForFreshState(wc) {
  return new Promise((resolve) => {
    const report = { ok: false, reloaded: false };
    if (!wc || wc.isDestroyed()) {
      resolve({ ...report, error: 'webContents no disponible' });
      return;
    }
    let settled = false;
    const done = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wc.removeListener('did-finish-load', onLoad);
      wc.removeListener('did-fail-load', onFail);
      resolve(payload);
    };
    const onLoad = () => done({ ok: true, reloaded: true });
    const onFail = (_event, errorCode, errorDescription) => done({
      ok: false,
      reloaded: true,
      error: `${errorCode || ''} ${errorDescription || 'reload fallido'}`.trim()
    });
    const timer = setTimeout(() => done({ ok: false, reloaded: true, error: 'timeout esperando recarga del juego' }), GAME_STATE_RELOAD_TIMEOUT_MS);
    wc.once('did-finish-load', onLoad);
    wc.once('did-fail-load', onFail);
    try {
      wc.reload();
    } catch (err) {
      done({ ok: false, reloaded: false, error: String((err && err.message) || err) });
    }
  });
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
    await waitPromise;
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
    await waitPromise;
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
    await waitPromise;
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
    await waitPromise;
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
    await Promise.all([waitFamily, waitPokes]);
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
        // telemetry capture migrated to a passive JS patch).
        await wc.executeJavaScript('try{window.gc&&window.gc()}catch(e){}').catch(() => {});
        result.viewsPurged++;
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
        await wc.executeJavaScript('try{window.gc&&window.gc()}catch(e){}').catch(() => {});
        result.viewsPurged++;
      } catch {}
    }
    lastOptimizeAt = Date.now();
  } finally {
    optimizeRunning = false;
    broadcastOptimizeStatus();
  }
  return { ok: true, ...result };
}

// Deprecated alias — kept for one release so nothing that still calls the
// old name breaks; new code should call optimizeMemorySafe directly. Safe
// to delete once nothing references optimizeMemory() anymore.
async function optimizeMemory() {
  return optimizeMemorySafe();
}

// Auto-optimize: check every 30 min, fire when 24 h have elapsed.
function startAutoOptimizeLoop() {
  setInterval(async () => {
    if (optimizeRunning) return;
    const elapsed = Date.now() - lastOptimizeAt;
    if (elapsed >= 24 * 60 * 60 * 1000) {
      console.log('[optimize] 24 h threshold reached — running auto-optimization (safe tier)');
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
      blocked: blockedCounts.get(id) || 0
    };
  }
  return result;
});

// Exposes the adBlockLog ring buffer (already collected for diagnostics.js's
// export report, Etapa 8) directly to the toolbar shield icon's dropdown —
// so "N blocked" isn't just a number, the user can see exactly which
// hostnames were blocked for the account they're looking at right now.
ipcMain.handle('adblock:getLog', (_e, { id }) => {
  const log = adBlockLog.get(id) || [];
  return log.slice(-30).reverse();
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
    const log = adBlockLog.get(account.id);
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
  startFreezeDetectorLoop();
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
  flushPersist();
});
