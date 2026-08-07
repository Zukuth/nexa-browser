// store.js does `require('electron')` and calls `app.getPath('userData')` at
// MODULE LOAD TIME (before anything else runs), so it can't be require()'d
// directly from plain Node without a real Electron `app`. mock.module fakes
// the 'electron' module before store.js is ever required, giving it a fake
// `app.getPath` (a real temp dir) and a controllable `safeStorage` stub.
// Requires --experimental-test-module-mocks (see package.json's "test" script).
const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-store-test-'));

// Mutable, not a fixed snapshot — store.js's own functions call
// safeStorage.isEncryptionAvailable()/encryptString()/decryptString() live on
// every call, so a test can flip `encryptionAvailable` and the very next
// store.save()/load() call sees the new value, even though store.js itself
// is only require()'d (and its module-scope DATA_FILE only computed) once
// for this whole file.
const safeStorageStub = {
  encryptionAvailable: true,
  isEncryptionAvailable() { return safeStorageStub.encryptionAvailable; },
  encryptString(plain) { return Buffer.from('ENC:' + plain, 'utf-8'); },
  decryptString(buf) {
    const s = buf.toString('utf-8');
    if (!s.startsWith('ENC:')) throw new Error('bad ciphertext');
    return s.slice(4);
  }
};

mock.module('electron', {
  exports: {
    app: { getPath: () => tmpDir },
    safeStorage: safeStorageStub
  }
});

const store = require('../../electron/store.js');

function resetDataDir() {
  for (const f of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, f), { force: true, recursive: true });
  }
  safeStorageStub.encryptionAvailable = true;
}

describe('store.load()', () => {
  beforeEach(resetDataDir);

  test('returns a fresh copy of DEFAULT_DATA when no file exists yet', () => {
    const data = store.load();
    assert.equal(data.spaces[0].id, 'default');
    assert.equal(data.settings.theme, 'system');
    assert.equal(data.settings.stability.enabled, false);
  });

  test('two calls to load() return independent objects, not shared references', () => {
    const a = store.load();
    const b = store.load();
    a.settings.theme = 'dark';
    assert.equal(b.settings.theme, 'system');
  });

  test('merges a saved file over the defaults, keeping settings the file did not specify', () => {
    fs.writeFileSync(store.DATA_FILE, JSON.stringify({ settings: { theme: 'dark' } }), 'utf-8');
    const data = store.load();
    assert.equal(data.settings.theme, 'dark');
    assert.equal(data.settings.language, 'es'); // untouched default survives
  });

  test('merges settings.stability sub-fields instead of replacing the whole object wholesale', () => {
    // Regression guard: a shallow {...DEFAULT.settings, ...saved.settings}
    // would wipe every stability field the saved file didn't have — this
    // must merge one level deeper (see the comment on this exact line in
    // store.js's load()).
    fs.writeFileSync(store.DATA_FILE, JSON.stringify({ settings: { stability: { enabled: true } } }), 'utf-8');
    const data = store.load();
    assert.equal(data.settings.stability.enabled, true);
    assert.equal(data.settings.stability.autoRecovery, true); // default preserved
  });

  test('restores supportPaypalUrl if a saved file has it blank', () => {
    fs.writeFileSync(store.DATA_FILE, JSON.stringify({ settings: { supportPaypalUrl: '' } }), 'utf-8');
    const data = store.load();
    assert.equal(data.settings.supportPaypalUrl, 'https://paypal.me/Zukuth');
  });

  test('corrupt JSON falls back to defaults and backs up the bad file instead of losing data silently', () => {
    fs.writeFileSync(store.DATA_FILE, '{ not valid json', 'utf-8');
    const data = store.load();
    assert.equal(data.settings.theme, 'system');
    const backups = fs.readdirSync(tmpDir).filter((f) => f.includes('.corrupt-'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(tmpDir, backups[0]), 'utf-8'), '{ not valid json');
  });

  test('migrates data from the legacy chilean-browser-data.json filename when the new one does not exist yet', () => {
    const legacyPath = path.join(tmpDir, 'chilean-browser-data.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ settings: { theme: 'dark' }, bookmarks: [{ url: 'x' }] }), 'utf-8');
    const data = store.load();
    assert.equal(data.settings.theme, 'dark');
    assert.equal(data.bookmarks.length, 1);
    assert.ok(fs.existsSync(legacyPath)); // legacy file is copied, never deleted
  });

  test('does not let legacy data overwrite an already-migrated new-format file', () => {
    fs.writeFileSync(path.join(tmpDir, 'chilean-browser-data.json'), JSON.stringify({ settings: { theme: 'dark' } }), 'utf-8');
    fs.writeFileSync(store.DATA_FILE, JSON.stringify({ settings: { theme: 'light' } }), 'utf-8');
    const data = store.load();
    assert.equal(data.settings.theme, 'light');
  });
});

describe('store.save() / load() round trip', () => {
  beforeEach(resetDataDir);

  test('save() then load() preserves plain data untouched', () => {
    const data = store.load();
    data.settings.theme = 'dark';
    data.bookmarks.push({ title: 'x', url: 'https://example.com' });
    store.save(data);
    const reloaded = store.load();
    assert.equal(reloaded.settings.theme, 'dark');
    assert.equal(reloaded.bookmarks.length, 1);
  });

  test('save() encrypts passwords at rest when safeStorage is available — the raw file never has the plaintext', () => {
    const data = store.load();
    data.passwords.push({ site: 'example.com', username: 'u', password: 'super-secret-pw' });
    store.save(data);
    const raw = fs.readFileSync(store.DATA_FILE, 'utf-8');
    assert.ok(!raw.includes('super-secret-pw'));
    assert.ok(raw.includes('enc:v1:'));
  });

  test('decryptStoredPasswords() reverses exactly what save() encrypted', () => {
    const data = store.load();
    data.passwords.push({ site: 'example.com', username: 'u', password: 'super-secret-pw' });
    store.save(data);
    const reloaded = store.load();
    const decrypted = store.decryptStoredPasswords(reloaded.passwords);
    assert.equal(decrypted[0].password, 'super-secret-pw');
  });

  test('falls back to plain text if safeStorage is unavailable, instead of losing or blocking the save', () => {
    safeStorageStub.encryptionAvailable = false;
    const data = store.load();
    data.passwords.push({ site: 'example.com', username: 'u', password: 'plain-pw' });
    store.save(data);
    const reloaded = store.load();
    const decrypted = store.decryptStoredPasswords(reloaded.passwords);
    assert.equal(decrypted[0].password, 'plain-pw');
  });

  test('decryptStoredPasswords() passes legacy plain-text passwords through untouched (never double-encrypted)', () => {
    const decrypted = store.decryptStoredPasswords([{ site: 'x', password: 'old-plain-text' }]);
    assert.equal(decrypted[0].password, 'old-plain-text');
  });

  test('decryptStoredPasswords() returns an empty string instead of throwing on corrupt ciphertext', () => {
    const decrypted = store.decryptStoredPasswords([{ site: 'x', password: 'enc:v1:not-real-ciphertext' }]);
    assert.equal(decrypted[0].password, '');
  });
});
