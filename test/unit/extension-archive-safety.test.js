// The CRX/zip extraction guards in extensions-manager.js defend against a
// real, unfixed path-traversal in extract-zip (GHSA-jmr9-qjv8-65gv): a
// malicious archive smuggles a symlink entry that later entries write through,
// landing files outside destDir. They were the most security-critical code in
// the repo with no test at all — while security.test.js covered
// isAllowedBookmarkUrl, a far less consequential predicate.
//
// extensions-manager.js calls app.getPath('userData') at module load, so the
// electron module is mocked before requiring it, the same way store.test.js
// does.
const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-ext-test-'));

mock.module('electron', {
  exports: {
    app: { getPath: () => tmpRoot },
    dialog: {},
    ipcMain: { handle: () => {} }
  }
});

const {
  zipEntryIsSymlink,
  assertZipEntryPathSafe,
  crxToZip
} = require('../../electron/extensions-manager');

// Unix mode bits live in the high 16 bits of externalFileAttributes; S_IFLNK
// is 0o120000. A regular file is S_IFREG (0o100000).
const entryWithMode = (mode) => ({ externalFileAttributes: (mode << 16) >>> 0, fileName: 'x' });

describe('zipEntryIsSymlink()', () => {
  test('flags an entry whose mode says symlink', () => {
    assert.equal(zipEntryIsSymlink(entryWithMode(0o120777)), true);
  });

  test('does not flag a regular file', () => {
    assert.equal(zipEntryIsSymlink(entryWithMode(0o100644)), false);
  });

  test('does not flag a directory', () => {
    assert.equal(zipEntryIsSymlink(entryWithMode(0o040755)), false);
  });

  test('does not flag an entry with no unix mode at all (a DOS-attribute zip)', () => {
    assert.equal(zipEntryIsSymlink({ externalFileAttributes: 0, fileName: 'x' }), false);
  });
});

describe('assertZipEntryPathSafe()', () => {
  const dest = path.join(tmpRoot, 'ext-dest');

  test('accepts a plain file at the root of the archive', () => {
    assert.doesNotThrow(() => assertZipEntryPathSafe(dest, 'manifest.json'));
  });

  test('accepts a nested path', () => {
    assert.doesNotThrow(() => assertZipEntryPathSafe(dest, 'js/background/worker.js'));
  });

  test('accepts a path that merely CONTAINS .. as part of a name', () => {
    assert.doesNotThrow(() => assertZipEntryPathSafe(dest, 'weird..name.js'));
  });

  test('rejects a parent-directory escape', () => {
    assert.throws(() => assertZipEntryPathSafe(dest, '../evil.js'), /outside its own folder/);
  });

  test('rejects a deep parent-directory escape', () => {
    assert.throws(() => assertZipEntryPathSafe(dest, 'a/b/../../../../evil.js'), /outside its own folder/);
  });

  // An absolute-looking entry name is not an escape: path.join() normalizes it
  // into destDir on both platforms ('/etc/evil' becomes '<dest>/etc/evil'), so
  // the file still lands inside the extension's own folder. Asserted
  // explicitly because "absolute path" reads like it ought to be rejected —
  // it's the resolved location, not the shape of the string, that matters.
  test('normalizes an absolute-looking entry into the destination instead of escaping', () => {
    assert.doesNotThrow(() => assertZipEntryPathSafe(dest, '/etc/evil'));
    const resolved = path.normalize(path.join(dest, '/etc/evil'));
    assert.ok(resolved.startsWith(dest), `${resolved} should be inside ${dest}`);
  });

  test('rejects an absolute path that climbs out with ..', () => {
    assert.throws(() => assertZipEntryPathSafe(dest, '/../../evil'), /outside its own folder/);
  });

  test('rejects a sibling directory that shares the destination prefix', () => {
    // path.relative() is what makes this safe — a naive startsWith() check on
    // the joined string would accept "<dest>-evil" as being inside "<dest>".
    assert.throws(() => assertZipEntryPathSafe(dest, '../ext-dest-evil/payload.js'), /outside its own folder/);
  });
});

describe('crxToZip()', () => {
  const header = (version, extra) => {
    const head = Buffer.alloc(12);
    head.write('Cr24', 0, 'utf8');
    head.writeUInt32LE(version, 4);
    head.writeUInt32LE(extra, 8);
    return head;
  };

  test('rejects a file without the Cr24 magic number', () => {
    assert.throws(() => crxToZip(Buffer.from('PKnot-a-crx')));
  });

  test('rejects an unsupported CRX version', () => {
    const buf = Buffer.concat([header(4, 0), Buffer.from('body')]);
    assert.throws(() => crxToZip(buf));
  });

  test('strips a CRX3 header and returns the zip payload', () => {
    const payload = Buffer.from('PKzip-bytes');
    // CRX3: magic, version, headerLen, then headerLen bytes, then the zip.
    const buf = Buffer.concat([header(3, 5), Buffer.alloc(5), payload]);
    assert.deepEqual(crxToZip(buf), payload);
  });

  test('strips a CRX2 header (pubKeyLen + sigLen) and returns the zip payload', () => {
    const payload = Buffer.from('PKzip-bytes');
    const head = Buffer.alloc(16);
    head.write('Cr24', 0, 'utf8');
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(3, 8); // pubKeyLen
    head.writeUInt32LE(4, 12); // sigLen
    const buf = Buffer.concat([head, Buffer.alloc(3 + 4), payload]);
    assert.deepEqual(crxToZip(buf), payload);
  });
});
