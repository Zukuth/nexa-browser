const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { pruneCrashDumps, DEFAULT_MAX_AGE_MS } = require('../../electron/crash-dumps');

function makeFile(dir, name, ageMs) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, 'dummy');
  const mtime = new Date(Date.now() - ageMs);
  fs.utimesSync(full, mtime, mtime);
  return full;
}

describe('pruneCrashDumps()', () => {
  test('deletes files older than maxAgeMs, keeps newer ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-crash-dumps-test-'));
    const oldFile = makeFile(dir, 'old.dmp', 40 * 24 * 60 * 60 * 1000);
    const newFile = makeFile(dir, 'new.dmp', 1 * 24 * 60 * 60 * 1000);

    const result = pruneCrashDumps(dir, { maxAgeMs: DEFAULT_MAX_AGE_MS });

    assert.equal(result.deleted, 1);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(newFile), true);
  });

  test('recurses into subdirectories (Crashpad-style completed/new/attachments layout) without deleting the directories themselves', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-crash-dumps-test-'));
    const completedDir = path.join(dir, 'completed');
    fs.mkdirSync(completedDir);
    const oldNested = makeFile(completedDir, 'old.dmp', 40 * 24 * 60 * 60 * 1000);

    const result = pruneCrashDumps(dir, { maxAgeMs: DEFAULT_MAX_AGE_MS });

    assert.equal(result.deleted, 1);
    assert.equal(fs.existsSync(oldNested), false);
    assert.equal(fs.existsSync(completedDir), true);
  });

  test('returns { deleted: 0 } instead of throwing when the folder does not exist yet', () => {
    const missing = path.join(os.tmpdir(), 'nexa-crash-dumps-does-not-exist-' + Date.now());
    const result = pruneCrashDumps(missing, { maxAgeMs: DEFAULT_MAX_AGE_MS });
    assert.equal(result.deleted, 0);
  });
});
