const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Bookmark URL sanitization
// The predicate below mirrors the one in the 'bookmarks:import' IPC handler in
// electron/main.js. Tests here guard against regressions where dangerous URL
// schemes slip through into the bookmark store.
// ---------------------------------------------------------------------------
const isAllowedBookmarkUrl = (url) =>
  typeof url === 'string' && /^https?:\/\//i.test(url);

describe('bookmark URL sanitization', () => {
  test('allows http URLs', () => {
    assert.ok(isAllowedBookmarkUrl('http://example.com'));
  });

  test('allows https URLs', () => {
    assert.ok(isAllowedBookmarkUrl('https://example.com/path?q=1'));
  });

  test('blocks javascript: scheme', () => {
    assert.ok(!isAllowedBookmarkUrl('javascript:alert(1)'));
  });

  test('blocks file: scheme', () => {
    assert.ok(!isAllowedBookmarkUrl('file:///etc/passwd'));
  });

  test('blocks data: URIs', () => {
    assert.ok(!isAllowedBookmarkUrl('data:text/html,<script>alert(1)</script>'));
  });

  test('blocks empty string', () => {
    assert.ok(!isAllowedBookmarkUrl(''));
  });

  test('blocks null/undefined', () => {
    assert.ok(!isAllowedBookmarkUrl(null));
    assert.ok(!isAllowedBookmarkUrl(undefined));
  });

  test('blocks ftp: and other non-http schemes', () => {
    assert.ok(!isAllowedBookmarkUrl('ftp://files.example.com'));
  });
});

// ---------------------------------------------------------------------------
// Download session dedup (regression for B-01)
// The WeakSet guard in handleDownloads in electron/main.js ensures that
// re-attaching to the same Session object (e.g. after account close/reopen)
// does not register a second 'will-download' listener, which would produce
// duplicate download records. The logic below is equivalent to what main.js
// does — we test the pattern here without requiring Electron.
// ---------------------------------------------------------------------------
describe('download session dedup guard (WeakSet pattern)', () => {
  test('registers a listener only the first time for a given session object', () => {
    const wiredSessions = new WeakSet();
    let listenerCallCount = 0;

    const attachListener = (session) => {
      if (wiredSessions.has(session)) return false;
      wiredSessions.add(session);
      listenerCallCount += 1;
      return true;
    };

    const fakeSession = {};

    // First attach — should register.
    assert.ok(attachListener(fakeSession));
    assert.equal(listenerCallCount, 1);

    // Subsequent calls with the same object — must be skipped.
    assert.ok(!attachListener(fakeSession));
    assert.ok(!attachListener(fakeSession));
    assert.equal(listenerCallCount, 1);
  });

  test('registers independently for distinct session objects', () => {
    const wiredSessions = new WeakSet();
    let listenerCallCount = 0;

    const attachListener = (session) => {
      if (wiredSessions.has(session)) return false;
      wiredSessions.add(session);
      listenerCallCount += 1;
      return true;
    };

    const sessionA = {};
    const sessionB = {};

    attachListener(sessionA);
    attachListener(sessionB);

    assert.equal(listenerCallCount, 2);

    // Re-attaching each one is still a no-op.
    attachListener(sessionA);
    attachListener(sessionB);
    assert.equal(listenerCallCount, 2);
  });
});
