// The origin policy for window.open() from an account page — the one thing
// standing between untrusted third-party game code and a real popup window on
// the account's own session. Extracted from main.js specifically so it could
// be tested; see the header comment in electron/popup-policy.js.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { hostMatchesPopupAllowlist } = require('../../electron/popup-policy');

const GAME = 'poke.idleworld.online';

describe('hostMatchesPopupAllowlist()', () => {
  test('allows the account\'s own host', () => {
    assert.equal(hostMatchesPopupAllowlist(GAME, GAME), true);
  });

  test('allows a subdomain of the account\'s own host', () => {
    assert.equal(hostMatchesPopupAllowlist('shop.poke.idleworld.online', GAME), true);
  });

  test('allows a known login provider regardless of the account host', () => {
    assert.equal(hostMatchesPopupAllowlist('accounts.google.com', GAME), true);
    assert.equal(hostMatchesPopupAllowlist('appleid.apple.com', GAME), true);
    assert.equal(hostMatchesPopupAllowlist('login.live.com', GAME), true);
  });

  test('allows a subdomain of a known login provider', () => {
    assert.equal(hostMatchesPopupAllowlist('eu.accounts.google.com', GAME), true);
  });

  test('denies an unrelated host', () => {
    assert.equal(hostMatchesPopupAllowlist('example.com', GAME), false);
    assert.equal(hostMatchesPopupAllowlist('ads.tracker.net', GAME), false);
  });

  // The domain walk starts at real label boundaries, so a name that merely
  // CONTAINS an allowlisted host as a substring never matches. These are the
  // shapes a malicious page would actually try.
  test('denies a lookalike that only ends with the provider as a substring', () => {
    assert.equal(hostMatchesPopupAllowlist('evil-accounts.google.com.attacker.test', GAME), false);
    assert.equal(hostMatchesPopupAllowlist('accounts.google.com.attacker.test', GAME), false);
  });

  test('denies a lookalike of the account host', () => {
    assert.equal(hostMatchesPopupAllowlist('poke.idleworld.online.attacker.test', GAME), false);
    assert.equal(hostMatchesPopupAllowlist('notpoke.idleworld.online', 'poke.idleworld.online'), false);
  });

  test('denies a bare or empty hostname', () => {
    assert.equal(hostMatchesPopupAllowlist('', GAME), false);
    assert.equal(hostMatchesPopupAllowlist(null, GAME), false);
    assert.equal(hostMatchesPopupAllowlist(undefined, GAME), false);
  });

  test('is case-insensitive on both sides', () => {
    assert.equal(hostMatchesPopupAllowlist('ACCOUNTS.GOOGLE.COM', GAME), true);
    assert.equal(hostMatchesPopupAllowlist('POKE.IdleWorld.Online', GAME), true);
  });

  test('with no account host, only the static allowlist applies', () => {
    assert.equal(hostMatchesPopupAllowlist('accounts.google.com', ''), true);
    assert.equal(hostMatchesPopupAllowlist(GAME, ''), false);
  });
});
