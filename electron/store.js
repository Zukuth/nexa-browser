const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DATA_FILE = path.join(app.getPath('userData'), 'chilean-browser-data.json');
const TMP_FILE = DATA_FILE + '.tmp';

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
    { id: 'default', name: 'General', color: '#4f8cff', icon: 'grid', defaultUrl: 'https://www.google.com', defaultLayout: 'single' }
  ],
  accounts: [],
  bookmarks: [],
  passwords: [],
  history: [],
  downloads: [],
  // IDs of bundled default extensions (electron/default-extensions/) already
  // seeded into this profile at least once — see seedDefaultExtensions() in
  // main.js. Tracked separately from settings.extensions so that a user who
  // removes the extension later doesn't get it silently reinstalled on next launch.
  seededExtensions: [],
  settings: {
    theme: 'dark',
    layoutMode: 'single',
    activeAccountId: null,
    currentSpaceId: 'default',
    sidebarWidth: 260,
    sidebarCollapsed: false,
    language: 'es',
    theme: 'dark',
    startWithWindows: false,
    reopenLastSpace: true,
    defaultStartUrl: 'https://www.google.com',
    defaultZoom: 1,
    newSpaceDefaultLayout: 'grid',
    downloadsFolder: null,
    askDownloadLocation: false,
    autoCheckUpdates: true,
    allMuted: false,
    extensions: [],
    maximizedAccountId: null,
    adBlockEnabled: true,
    hardwareAcceleration: true
  }
};

function load() {
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

module.exports = { load, save, decryptStoredPasswords, DATA_FILE };
