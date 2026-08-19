// Shared by permissions-manager.js and adblock-manager.js — extract a
// hostname from a URL-like string, swallowing parse errors. Distinct from
// main.js's own `hostnameOf()`, which additionally strips a leading `www.`
// and retries with an `https://` prefix for a bare host typed into the
// address bar; the inputs here (webRequest details.url, permission-request
// requestingUrl/requestingOrigin, cosmetic-filter frame url) are always
// already-valid absolute URLs handed over by Chromium itself, so that extra
// normalization was never needed here — kept as a separate, simpler
// function rather than forcing both call sites through one that does more
// than either needs.
function hostnameFromUrlLike(input) {
  try {
    return new URL(String(input || '')).hostname;
  } catch {
    return '';
  }
}

module.exports = { hostnameFromUrlLike };
