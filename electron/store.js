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

function encryptPassword(plain) {
  if (typeof plain !== 'string' || !plain) return plain;
  try {
    if (!safeStorage.isEncryptionAvailable()) return plain;
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

const DEFAULT_DATA = {
  spaces: [
    { id: 'default', name: 'General', color: '#4f8cff', icon: 'grid', defaultUrl: 'https://poke.idleworld.online/login', defaultLayout: 'single' }
  ],
  accounts: [],
  bookmarks: [],
  passwords: [],
  history: [],
  downloads: [],
  marketPurchases: [],
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
    adBlockEnabled: true,
    hardwareAcceleration: true,
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
      dealNotify: true
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
      memoryGrowthThresholdMb: 200,
      // Etapa C of the CDP -> passive-JS telemetry migration — off by
      // default so nothing changes until explicitly opted into. Validated
      // in shadow mode first (136/136 frames matched CDP exactly in a real
      // play session, including a hunt teleport) before this flag existed.
      useJsFrameCapture: false
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
    // Shallow settings spread above replaces settings.stability wholesale if
    // an older save file has a partial object — merge its sub-fields
    // explicitly so a save written before a new stability field existed
    // doesn't end up with that field as `undefined`.
    merged.settings.stability = { ...DEFAULT_DATA.settings.stability, ...((parsed.settings && parsed.settings.stability) || {}) };
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

function save(data) {
  // Write to a temp file then rename over the real one — renameSync within the
  // same directory is atomic, so a crash/power-loss mid-save leaves either the
  // old complete file or the new complete file, never a half-written one.
  // Encrypt passwords in the copy being written, not in the live `data` object
  // the rest of the app keeps using in memory.
  const toWrite = {
    ...data,
    passwords: (data.passwords || []).map((p) => ({ ...p, password: encryptPassword(p.password) }))
  };
  const json = JSON.stringify(toWrite, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf-8');
  fs.renameSync(TMP_FILE, DATA_FILE);
}

// Watches the data file for external modifications (e.g. a second app instance
// or a manual edit) and logs a warning so stale in-memory state is visible in
// the logs. Returns the watcher so the caller can close it on quit.
function watchDataFile(onChange) {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    let debounce = null;
    const watcher = fs.watch(DATA_FILE, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
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

module.exports = { load, save, decryptStoredPasswords, watchDataFile, DATA_FILE };
