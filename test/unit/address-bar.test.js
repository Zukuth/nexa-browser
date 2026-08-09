const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddressInput } = require('../../electron/address-bar');

describe('normalizeAddressInput', () => {
  test('passes through an already-protocoled http(s) URL untouched', () => {
    assert.equal(normalizeAddressInput('http://example.com'), 'http://example.com');
    assert.equal(normalizeAddressInput('https://example.com/path?q=1'), 'https://example.com/path?q=1');
  });

  test('passes through about: URLs untouched', () => {
    assert.equal(normalizeAddressInput('about:blank'), 'about:blank');
  });

  test('prepends https:// to a bare domain', () => {
    assert.equal(normalizeAddressInput('example.com'), 'https://example.com');
    assert.equal(normalizeAddressInput('sub.example.co.uk/path'), 'https://sub.example.co.uk/path');
  });

  test('prepends https:// to localhost, with or without a port', () => {
    assert.equal(normalizeAddressInput('localhost'), 'https://localhost');
    assert.equal(normalizeAddressInput('localhost:3000'), 'https://localhost:3000');
  });

  test('prepends https:// to a bare IPv4 address', () => {
    assert.equal(normalizeAddressInput('192.168.1.1'), 'https://192.168.1.1');
    assert.equal(normalizeAddressInput('192.168.1.1:8080'), 'https://192.168.1.1:8080');
  });

  test('falls back to a Google search for a plain phrase with spaces — the exact bug this fixes', () => {
    assert.equal(
      normalizeAddressInput('hello world'),
      'https://www.google.com/search?q=hello%20world'
    );
  });

  test('falls back to a Google search for a bare word with no dot (ambiguous host vs. query)', () => {
    assert.equal(
      normalizeAddressInput('search'),
      'https://www.google.com/search?q=search'
    );
  });

  test('falls back to a Google search for empty/whitespace-only input', () => {
    assert.equal(normalizeAddressInput(''), 'https://www.google.com/search?q=');
    assert.equal(normalizeAddressInput('   '), 'https://www.google.com/search?q=');
  });

  test('trims surrounding whitespace before deciding', () => {
    assert.equal(normalizeAddressInput('  example.com  '), 'https://example.com');
  });

  test('URL-encodes special characters in a search query', () => {
    assert.equal(
      normalizeAddressInput('c++ tutorial & tricks'),
      'https://www.google.com/search?q=c%2B%2B%20tutorial%20%26%20tricks'
    );
  });
});
