const { app, BrowserWindow, ipcMain, session, Menu, shell, dialog, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const store = require('./store');
const { autoUpdater } = require('electron-updater');
const { GAP, GRID_MAX_PANELS, MIN_SPLIT_FRAC, resolveFracs, cellsForMode, freeCells, normalizeFracsWithMin } = require('./layout-utils');
const gameTelemetry = require('./game-telemetry');
const pokeFormulas = require('./poke-formulas');
// Catálogo único de traducciones compartido con el renderer — ver el comentario
// de cabecera en src/i18n-data.js. El proceso main no tiene sandbox, así que
// requerir un archivo bajo src/ funciona igual que con game-telemetry.js.
const I18N = require('../src/i18n-data.js');
function mt(lang, key, vars) {
  let str = (I18N[lang] && I18N[lang][key]) ?? I18N.es[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) str = str.replace(`{${k}}`, vars[k]);
  return str;
}

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

// Must run before app.whenReady() — can't be toggled live, only at the next launch.
if (data.settings.hardwareAcceleration === false) {
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

// Live DownloadItem handles, keyed by the same id as its `data.downloads`
// record — the item only exists as a closure variable inside 'will-download'
// otherwise, so pause/resume/cancel from the renderer has nothing to call
// without this. Cleared once a download finishes (success, cancel, or
// interruption); pause/resume/cancel only make sense while it's live.
const downloadItems = new Map();

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
    enabled: true
  };
  data.settings.extensions.push(entry);
  persist();
  broadcastState();
  return entry;
}

// IV Helper (Poke IdleWorld) used to be auto-seeded into fresh profiles as a
// stopgap before Nexa had its own IV/Growth tooling (Calculadora IV, Tier
// List, Caza & XP — see poke-formulas.js). Now that those exist natively,
// the extension (and the in-game Gengar button that toggled its panel, see
// removed injectGameOverlayButtons code) is redundant — this removes it from
// any profile that still has it from that earlier seeding, one time.
const RETIRED_EXTENSION_IDS = ['cpapjpndggpeepabijbaikmapdceldnl']; // IV Helper (Poke IdleWorld)
function removeRetiredExtensions() {
  let changed = false;
  for (const id of RETIRED_EXTENSION_IDS) {
    const ext = data.settings.extensions.find((e) => e.id === id);
    if (!ext) continue;
    unloadExtensionFromAllSessions(id);
    try {
      if (ext.path.startsWith(EXTENSIONS_DIR)) fs.rmSync(ext.path, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    data.settings.extensions = data.settings.extensions.filter((e) => e.id !== id);
    changed = true;
  }
  if (changed) persist();
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
  { combo: 'Ctrl + Shift + Supr', key: 'shortcut.clearSessionData' }
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

  wc.session.setSpellCheckerLanguages(['es-419', 'en-US']);
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
  applyPermissionHandler(wc.session);
  applyProxy(wc.session, account);
  data.settings.extensions
    .filter((e) => e.enabled !== false)
    .forEach((e) => {
      wc.session.extensions
        .loadExtension(e.path, { allowFileAccess: true })
        .then(() => console.log('[ext] loaded', e.name, 'into', account.id))
        .catch((err) => console.error('[ext] FAILED to load', e.name, 'into', account.id, err));
    });
  // Must attach before the real navigation starts — CDP's Network.enable
  // needs to be on before the game's own page connects its WebSocket, or the
  // connection (and the frames right after it) is missed entirely. The
  // renderer creates every <webview> pointed at about:blank first and only
  // sets the real `src` after receiving 'webview:ready' below, specifically
  // so this always runs before that real navigation, for every account (not
  // just game ones — keeps a single, uniform creation path). Only ever
  // attaches for accounts already pointed at the game, per the telemetry
  // feature's scoping rule (main.js never runs this for a random account
  // someone happens to point elsewhere).
  if (account.url && gameTelemetry.isGameUrl(account.url)) {
    gameTelemetry.attachCapture(wc, account.id);
  }
  wc.on('did-navigate', (_e, url) => notifyNav(account.id, url));
  wc.on('did-navigate-in-page', (_e, url) => {
    notifyNav(account.id, url);
    // poke.idleworld.online routes from /login to /play client-side (History
    // API, no full reload) after a successful sign-in, so did-finish-load
    // below never fires again for that transition and the overlay buttons
    // used to never appear until the next full reload. injectGameOverlayButtons
    // already no-ops off the URL check and off window.__cbOverlayWatchdog
    // already existing, so calling it here too is safe and idempotent.
    injectGameOverlayButtons(wc);
    stopGameOverlayWatchdogIfLeft(wc, url);
    // Same /login → /play client-side transition: did-finish-load won't
    // fire again to trigger the telemetry attach below, so it has to be
    // done here too. isGameUrl() now excludes /login on purpose (see
    // game-telemetry.js) so this only actually attaches once the user is
    // past the Turnstile challenge.
    if (gameTelemetry.isGameUrl(url)) {
      gameTelemetry.attachCapture(wc, account.id);
    }
  });
  // Chromium resets zoom on full page loads/reloads — reassert the account's
  // chosen zoom (or the app default) so it survives reload/repartition and
  // only ever changes via the user picking a new one or closing the tab.
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(account.zoom || data.settings.defaultZoom || 1);
    if (account.ecoMode) enableEcoMode(wc);
    injectGameOverlayButtons(wc);
    // Covers an account that started elsewhere and only just navigated to
    // the game — attachCapture() is idempotent (checks debugger.isAttached())
    // so this is a no-op for accounts that already attached before loadURL.
    if (gameTelemetry.isGameUrl(wc.getURL())) {
      gameTelemetry.attachCapture(wc, account.id);
    }
  });
  wc.on('page-title-updated', (_e, title) => updateHistoryTitle(wc.getURL(), title));
  wc.on('render-process-gone', (_e, details) => {
    console.error('[crash] renderer gone for', account.id, details.reason);
    const crashes = (crashCounts.get(account.id) || 0) + 1;
    crashCounts.set(account.id, crashes);
    if (crashes <= 3 && !wc.isDestroyed()) {
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.reload();
      }, 1000);
    } else {
      console.error('[crash]', account.id, 'crashed', crashes, 'times — giving up on auto-reload');
    }
  });
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
    if (!account.closed) {
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

// Site-specific enhancement: on poke.idleworld.online's /play page only, add a
// floating Pokéball button top-right that manually collapses/expands the
// game's own top toolbar. Purely user-controlled, no auto-hide.
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
          if (el.id === 'cb-toggle-ball') continue;
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

      // Self-healing: re-adds the button if the page's own re-renders ever
      // strip it out, so it survives both reloads and in-page SPA routing
      // without us having to detect that from the outside.
      window.__cbOverlayWatchdog = function() {
        ensureToggleBall();
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

  wireDidAttachWebview(mainWindow.webContents);

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
  if (!mainWindowAlive()) return;
  mainWindow.webContents.send('state:update', data);
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
  gameTelemetry.removeState(id);
  notifiedEventAt.delete(id);
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

ipcMain.handle('accounts:update', (_e, { id, name, color, url, proxy, ecoMode }) => {
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
  persist();
  broadcastGeometryOnly();
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
  'defaultZoom',
  'newSpaceDefaultLayout',
  'askDownloadLocation',
  'autoCheckUpdates'
]);

ipcMain.handle('settings:update', (_e, fields) => {
  if (!fields || typeof fields !== 'object') return data;
  for (const key of Object.keys(fields)) {
    if (!SETTINGS_UPDATE_WHITELIST.has(key)) continue;
    if (key === 'pokeIdleAlerts' && (typeof fields[key] !== 'object' || fields[key] === null)) continue;
    if (key === 'language' && !Object.prototype.hasOwnProperty.call(I18N, fields[key])) continue;
    data.settings[key] = fields[key];
  }
  if (fields.pokeIdleAlerts && typeof fields.pokeIdleAlerts.ballsThreshold === 'number') {
    gameTelemetry.setBallsLowThreshold(fields.pokeIdleAlerts.ballsThreshold);
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
  if (mainWindowAlive()) mainWindow.webContents.send('update:status', { status, ...extra });
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'));
autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', { version: info.version }));
autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: err?.message || String(err) }));

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

ipcMain.handle('settings:checkUpdates', () => {
  if (!app.isPackaged) return { devMode: true };
  autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus('error', { message: err?.message || String(err) }));
  return { checking: true };
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
ipcMain.handle('gameStats:get', () => gameTelemetry.getAllStats());

// For the Tier List / Comparador / Caza & XP tools — works even if the user
// opens them before any account has attached to the game (triggers the same
// cached fetch attachCapture() would have).
ipcMain.handle('pokeFormulas:getCreatureCatalog', async () => {
  await gameTelemetry.ensureCreatureCatalog();
  return gameTelemetry.getCreatureCatalogArray();
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
  removeRetiredExtensions();
  gameTelemetry.startHeartbeat();
  gameTelemetry.setBallsLowThreshold(data.settings.pokeIdleAlerts?.ballsThreshold ?? 20);
  startPokeIdleAlertLoop();
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

app.on('before-quit', () => {
  appQuitting = true;
  flushPersist();
});
