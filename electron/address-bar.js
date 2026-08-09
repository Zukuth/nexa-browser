// Pure address-bar input normalization — extracted so it's unit-testable
// without Electron (mirrors how security.test.js already tests
// isAllowedBookmarkUrl as pure logic). Used by account:navigate's IPC
// handler in main.js.
//
// The old logic was `/^https?:\/\/|^about:/.test(url) ? url : 'https://' + url`
// — anything without an explicit protocol got 'https://' blindly prepended,
// including plain search phrases. Confirmed live (QA audit, 2026-08-08):
// typing "hello world" produced the URL "https://hello world" (a literal
// space in the host), which fails to load with no explanation — a real
// browser's address bar falls back to a search engine for exactly this
// input shape. This adds that fallback: anything that doesn't look like a
// URL or a bare host now becomes a Google search instead of a broken URL.
function looksLikeHost(input) {
  if (/\s/.test(input)) return false;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(input)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(input)) return true;
  // Requires at least one dot before any path/port — bare single words
  // ("hello", "search") fall through to the search-engine branch below,
  // matching how modern browser omniboxes treat them (a bare word is
  // ambiguous between an intranet hostname and a search query, and a
  // search query is overwhelmingly the more common real-world intent).
  return /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(input);
}

function normalizeAddressInput(rawInput) {
  const input = String(rawInput ?? '').trim();
  if (/^https?:\/\/|^about:/.test(input)) return input;
  if (looksLikeHost(input)) return `https://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

module.exports = { normalizeAddressInput, looksLikeHost };
