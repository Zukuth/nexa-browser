const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DATA_FILE = path.join(app.getPath('userData'), 'nexa-browser-data.json');
// Pre-rebrand filename — the project was called "chilean-browser" before it
// became Nexa Browser. Kept only so load() can migrate existing installs
// that still have data under the old name (see migrateLegacyDataFile below).
const LEGACY_DATA_FILE = path.join(app.getPath('userData'), 'chilean-browser-data.json');
const TMP_FILE = DATA_FILE + '.tmp';

// One-time migration: if this install still only has data under the old
// pre-rebrand filename, copy it to the new name before load() reads it — so
// renaming the file doesn't make an existing user's accounts/spaces/passwords
// silently disappear. Never deletes the legacy file, just in case.
function migrateLegacyDataFile() {
  try {
    if (!fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_DATA_FILE)) {
      fs.copyFileSync(LEGACY_DATA_FILE, DATA_FILE);
    }
  } catch (err) {
    console.error('[store] failed to migrate legacy chilean-browser-data.json', err);
  }
}

// Encrypts saved passwords at rest using the OS keychain (DPAPI on Windows,
// Keychain on macOS, libsecret/kwallet on Linux) via Electron's safeStorage —
// so the JSON file on disk no longer holds them as plain text. Everything
// outside store.js keeps working with plain-text data.passwords[].password
// in memory exactly as before; the encrypt/decrypt round-trip only happens
// at this load/save boundary. Best-effort by design: if safeStorage isn't
// available on this system (or a value fails to decrypt), the password is
// carried through as-is rather than blocking a save or losing data.
const ENC_PREFIX = 'enc:v1:';

let warnedPlaintextFallback = false;
function encryptPassword(plain) {
  if (typeof plain !== 'string' || !plain) return plain;
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      // Silent before this — a user on a system where the OS keychain isn't
      // available (a locked-down environment, etc.) had no way to know their
      // saved passwords were sitting on disk in plain text. Once per process
      // is enough; this isn't expected to flip mid-session.
      if (!warnedPlaintextFallback) {
        warnedPlaintextFallback = true;
        console.warn('[store] safeStorage encryption is not available on this system — saved passwords will be stored in plain text');
      }
      return plain;
    }
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

function decryptPassword(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored; // legacy plain text, or never got encrypted
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return ''; // can't recover this one — an empty field beats throwing
  }
}

// safeStorage is unreliable before app.whenReady() resolves (its OS-keychain
// backend isn't guaranteed to be initialized yet), but load() below runs at
// module load time, before ready, because other early-boot settings
// (hardwareAcceleration) need to be read before app.whenReady() too. So
// load() intentionally leaves passwords in whatever form they were stored in
// (encrypted or legacy plain text) and the caller must call this once, after
// app.whenReady(), before anything reads data.passwords.
function decryptStoredPasswords(passwords) {
  return (passwords || []).map((p) => ({ ...p, password: decryptPassword(p.password) }));
}

// Per-account proxy credentials (account.proxy.username/.password) went
// through no encryption at all — every saved password does, via the same
// safeStorage round-trip, but this field was added later and missed it,
// so proxy passwords sat on disk in plain text in data.json. Reuses the
// exact same encrypt/decrypt boundary as the passwords array: called once,
// after app.whenReady(), same as decryptStoredPasswords above.
function decryptAccountProxies(accounts) {
  return (accounts || []).map((a) => (
    a && a.proxy && a.proxy.password
      ? { ...a, proxy: { ...a.proxy, password: decryptPassword(a.proxy.password) } }
      : a
  ));
}

const DEFAULT_DATA = {
  spaces: [
    { id: 'default', name: 'General', color: '#4f8cff', icon: 'grid', defaultUrl: 'https://poke.idleworld.online/login', defaultLayout: 'single' }
  ],
  accounts: [],
  // Collapsible sub-groups of accounts within a single Space (browser-inspired
  // idea #11 — Edge's collapsible vertical-tab groups). Each group belongs to
  // exactly one space via spaceId; an account opts into a group via its own
  // groupId field (null/absent = ungrouped, rendered at the top of the
  // sidebar same as before this existed).
  groups: [],
  bookmarks: [],
  passwords: [],
  history: [],
  downloads: [],
  marketPurchases: [],
  // Lifetime ad/tracker-blocking counters — unlike adBlockLog in main.js
  // (an in-memory, 500-entry-capped ring buffer per account that resets on
  // every restart), this survives restarts so the dashboard can show a real
  // "blocked since install" total the way ABP/uBlock do. byHost is capped
  // to the top 200 hostnames by count (see pruneAdBlockStatsByHost in
  // main.js) so a long-running install can't grow this file unbounded.
  adBlockStats: {
    total: 0,
    byCategory: { ads: 0, tracking: 0, social: 0, analytics: 0, other: 0 },
    byHost: {}
  },
  settings: {
    // 'system' sigue la preferencia del SO (prefers-color-scheme); 'dark'/'light'
    // fuerzan el tema explícitamente, elegido por el usuario en Configuración.
    theme: 'system',
    layoutMode: 'single',
    activeAccountId: null,
    currentSpaceId: 'default',
    sidebarWidth: 260,
    sidebarCollapsed: false,
    language: 'es',
    startWithWindows: false,
    reopenLastSpace: true,
    defaultStartUrl: 'https://poke.idleworld.online/login',
    supportPaypalUrl: 'https://paypal.me/Zukuth',
    defaultZoom: 1,
    newSpaceDefaultLayout: 'grid',
    downloadsFolder: null,
    askDownloadLocation: false,
    allMuted: false,
    extensions: [],
    maximizedAccountId: null,
    protectionLevel: 'standard', // 'off' | 'standard' | 'strict' — see applyAdBlock() in main.js
    // Hostnames the user explicitly paused ad/tracker blocking for (network
    // AND cosmetic), independent of protectionLevel — same "pause on this
    // site" concept ABP/uBlock expose, toggled from the shield dropdown.
    // Subdomains match their registered domain, same rule as ADBLOCK_ALLOWLIST
    // in main.js.
    adBlockPausedSites: [],
    // Which filter-list categories build the ad-blocking engine — same
    // subscription-picker concept as Adblock Plus's "Filter lists" tab.
    // 'ads'/'tracking' on by default matches the previous single bundled
    // list (fromPrebuiltAdsAndTracking); 'cookies' (auto-dismiss cookie
    // banners) and 'annoyances' (social widgets, newsletter overlays) are
    // new capabilities so they default off — auto-clicking through a
    // banner is exactly the kind of thing that could silently break a
    // game's own consent flow, opt-in only. See FILTER_LIST_CATEGORIES in
    // main.js for the actual list URLs per category.
    adBlockFilterLists: { ads: true, tracking: true, cookies: false, annoyances: false },
    // Simple 3-position intensity preset shown as a slider in the shield
    // popup — 'normal' is the recommended everyday default (adds
    // cookie-notice auto-dismiss on top of the old 'standard' baseline).
    // See ADBLOCK_MODE_PRESETS in main.js for exactly what each maps to
    // (protectionLevel + adBlockFilterLists); moving the slider writes both
    // at once. Independent of the master on/off toggle (protectionLevel
    // 'off') — turning protection back on re-applies whichever mode was
    // last selected here.
    adBlockMode: 'normal', // 'standard' | 'normal' | 'super'
    // Hostnames force-blocked outright (network AND the top-level
    // navigation itself), regardless of protectionLevel/adBlockMode — the
    // "Force Block Page" concept from the reference design, opposite of
    // adBlockPausedSites. Checked first, before any other adblock logic, in
    // applyAdBlock() in main.js.
    adBlockManualBlocklist: [],
    // User-authored filter rules in real Adblock Plus/uBlock Origin syntax
    // (network rules like `||example.com^`, cosmetic hides like
    // `example.com##.ad-slot`) — one rule per array entry. Populated either
    // by hand from the dashboard's "Reglas personalizadas" textarea, or
    // automatically by the element picker (see electron/element-picker.js),
    // which appends a `hostname##selector` cosmetic rule per picked element.
    adBlockCustomRules: [],
    // Remembered per-site decisions for the "promptable" web permissions
    // (camera/mic, notifications, geolocation) — { [hostname]: { [permission]:
    // 'allow'|'deny' } }. Populated when the user answers the live prompt
    // window with "remember this decision" checked (see promptSitePermission
    // in main.js); revocable from Configuración > Permisos.
    sitePermissions: {},
    // "Modo Eco automático" (off by default) — auto-throttles an account's
    // rAF once it's gone `minutes` without being the focused panel, on top
    // of (never instead of) the per-account manual ecoMode toggle. See
    // startAutoEcoLoop() in main.js.
    autoEco: { enabled: false, minutes: 30 },
    // Per-tab FPS/ping badges (electron/main.js's injectFpsOverlay/
    // injectPingOverlay) — on by default since they shipped on by default;
    // both user-toggleable independently in Configuración.
    showFpsOverlay: true,
    showPingOverlay: true,
    hardwareAcceleration: true,
    // Set true the first time translate:page ever succeeds for this user —
    // gates the startup model preload in main.js so a fresh install never
    // silently downloads a ~20MB language model in the background before
    // the user has ever touched the translate button once.
    hasUsedTranslate: false,
    // Opt-in: keeps the translation memory (see translationCache in
    // translate.js) on disk across app restarts instead of losing it every
    // time the app closes. Off by default — a fresh install shouldn't
    // silently start writing files nobody asked for.
    translateMemoryPersist: false,
    pokeIdleAlerts: {
      enabled: true,
      shiny: true,
      rare: true,
      ballsLow: true,
      disconnect: true,
      ballsThreshold: 20,
      marketIv: false,
      marketIvDesktop: true,
      marketIvRareOnly: true,
      marketMinIv: 150
    },
    pokeIdleMarketPrefs: {
      rarityFilterVersion: 2,
      showEpic: false,
      showLegendary: false,
      showDollar: true,
      showDiamonds: true,
      autoRefresh: false,
      refreshSeconds: 15,
      dealMaxPrice: 0,
      dealNotify: true,
      dealsOnly: false
    },
    // Stability/connection-manager overhaul — everything here defaults to
    // off/safe so existing installs behave exactly as before until a user
    // opts in from Configuración → Poke Idle World → Estabilidad.
    stability: {
      enabled: false, // master toggle for the connection-manager recovery pipeline
      backgroundKeepalive: false, // powerSaveBlocker('prevent-app-suspension') while >=1 game account is open
      autoRecovery: true, // recovery levels 1-3 run automatically once `enabled` is true
      lastResortAutoReload: false, // level 4+ automatic full page reload — opt-in, default OFF
      ecoForHiddenPanels: false,
      disconnectNotifications: true,
      advancedDiagnostics: false,
      memoryGrowthThresholdMb: 200
    }
  }
};

function load() {
  migrateLegacyDataFile();
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf-8');
  } catch {
    // No file yet (first run) — nothing to back up, just start fresh.
    return structuredClone(DEFAULT_DATA);
  }
  try {
    const parsed = JSON.parse(raw);
    const merged = {
      ...DEFAULT_DATA,
      ...parsed,
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) }
    };
    if (!merged.settings.supportPaypalUrl) merged.settings.supportPaypalUrl = DEFAULT_DATA.settings.supportPaypalUrl;
    // One-time migration (2026-08-08): adBlockEnabled (on/off) replaced by
    // protectionLevel ('off'|'standard'|'strict') — only migrate a save file
    // that still has the old field and never saved the new one, so an
    // already-migrated file (or a fresh install) is left untouched.
    const oldSettings = parsed.settings || {};
    if (oldSettings.adBlockEnabled !== undefined && oldSettings.protectionLevel === undefined) {
      merged.settings.protectionLevel = oldSettings.adBlockEnabled === false ? 'off' : 'standard';
    }
    delete merged.settings.adBlockEnabled;
    // Shallow settings spread above replaces settings.stability wholesale if
    // an older save file has a partial object — merge its sub-fields
    // explicitly so a save written before a new stability field existed
    // doesn't end up with that field as `undefined`.
    merged.settings.stability = { ...DEFAULT_DATA.settings.stability, ...((parsed.settings && parsed.settings.stability) || {}) };
    merged.settings.autoEco = { ...DEFAULT_DATA.settings.autoEco, ...((parsed.settings && parsed.settings.autoEco) || {}) };
    merged.settings.adBlockFilterLists = { ...DEFAULT_DATA.settings.adBlockFilterLists, ...((parsed.settings && parsed.settings.adBlockFilterLists) || {}) };
    merged.adBlockStats = {
      ...DEFAULT_DATA.adBlockStats,
      ...(parsed.adBlockStats || {}),
      byCategory: { ...DEFAULT_DATA.adBlockStats.byCategory, ...((parsed.adBlockStats && parsed.adBlockStats.byCategory) || {}) },
      byHost: (parsed.adBlockStats && parsed.adBlockStats.byHost) || {}
    };
    // Passwords are decrypted later via decryptStoredPasswords(), once
    // app.whenReady() has resolved — see the comment on that function.
    return merged;
  } catch (err) {
    // The file exists but isn't valid JSON — e.g. the process died mid-write
    // before save() below wrote atomically, or external corruption. Back it
    // up instead of silently discarding it: resetting to defaults here would
    // otherwise erase every saved account/password/bookmark with no trace.
    try {
      const backupPath = `${DATA_FILE}.corrupt-${Date.now()}.json`;
      fs.writeFileSync(backupPath, raw, 'utf-8');
      console.error('[store] data file was corrupt, backed up to', backupPath, err);
    } catch (backupErr) {
      console.error('[store] data file was corrupt AND the backup attempt also failed', backupErr);
    }
    return structuredClone(DEFAULT_DATA);
  }
}

// Content of the last save() this process made, so watchDataFile can tell its
// own write (the renameSync below fires fs.watch same as any other change)
// apart from an actual external edit or a second instance — see the comment
// on watchDataFile for why a time-based guess isn't good enough here.
let lastSavedJson = null;

function save(data) {
  // Write to a temp file then rename over the real one — renameSync within the
  // same directory is atomic, so a crash/power-loss mid-save leaves either the
  // old complete file or the new complete file, never a half-written one.
  // Encrypt passwords in the copy being written, not in the live `data` object
  // the rest of the app keeps using in memory.
  const toWrite = {
    ...data,
    passwords: (data.passwords || []).map((p) => ({ ...p, password: encryptPassword(p.password) })),
    accounts: (data.accounts || []).map((a) => (
      a && a.proxy && a.proxy.password
        ? { ...a, proxy: { ...a.proxy, password: encryptPassword(a.proxy.password) } }
        : a
    ))
  };
  const json = JSON.stringify(toWrite, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf-8');
  fs.renameSync(TMP_FILE, DATA_FILE);
  lastSavedJson = json;
}

// Watches the data file for external modifications (e.g. a second app instance
// or a manual edit) and logs a warning so stale in-memory state is visible in
// the logs. Returns the watcher so the caller can close it on quit.
//
// save() above renames a temp file over DATA_FILE, which fires this same
// fs.watch — a time-based debounce alone can't tell that apart from a real
// external write (the rename can legitimately take longer than any fixed
// window under disk/AV load). Comparing against the content save() actually
// wrote is exact instead of a guess: if the file now matches what this
// process itself last saved, it's our own rename, not an external change.
function watchDataFile(onChange) {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    let debounce = null;
    const watcher = fs.watch(DATA_FILE, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        let current;
        try {
          current = fs.readFileSync(DATA_FILE, 'utf-8');
        } catch {
          return; // mid-rename read miss — the next watch event will catch the settled file.
        }
        if (current === lastSavedJson) return; // our own save(), not an external change.
        console.warn('[store] data file was modified outside this process — in-memory state may be stale');
        if (typeof onChange === 'function') onChange();
      }, 300);
    });
    watcher.on('error', (err) => console.warn('[store] fs.watch error', err));
    return watcher;
  } catch (err) {
    console.warn('[store] could not start fs.watch on data file', err);
    return null;
  }
}

function isPasswordEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

module.exports = { load, save, decryptStoredPasswords, decryptAccountProxies, watchDataFile, DATA_FILE, isPasswordEncryptionAvailable };
