// Assembles a shareable diagnostic report (connection-manager state +
// network-health snapshots + ad-block log + memory stats) and scrubs it
// before it's ever written to disk or shown — cookies, tokens, auth
// headers, passwords, emails, usernames, login bodies, and market/account
// identifiers must never leak into an exported report, even by accident
// through a URL query string or a field added later without this file
// being updated.

const SENSITIVE_KEY_PATTERN = /cookie|token|password|passwd|auth|secret|credential|session|apikey|api_key/i;
const USER_IDENTITY_KEY_PATTERN = /^(email|username|user|login|displayName|accountName|ownerName)$/i;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const REDACTED = '[redactado]';

// Strips query strings and hash fragments from any URL-shaped string field —
// covers the realistic leak vector in this report (ad-block log entries
// carry raw request URLs, which can embed tokens/session ids as query
// params) without needing to know every possible param name in advance.
function scrubUrlLike(value) {
  if (typeof value !== 'string') return value;
  const qIndex = value.indexOf('?');
  const hIndex = value.indexOf('#');
  let cut = value.length;
  if (qIndex !== -1) cut = Math.min(cut, qIndex);
  if (hIndex !== -1) cut = Math.min(cut, hIndex);
  return value.slice(0, cut);
}

function scrubString(value) {
  return value.replace(EMAIL_PATTERN, '[email redactado]');
}

// accountId is this app's own internal random UUID (see accounts:add in
// main.js), not the user's real game username/email — but the file's own
// stated promise above is that account identifiers never leak, and the raw
// UUID persists across every report this app ever exports, which is still
// worth not handing out verbatim (e.g. correlating it against a future
// support request that DOES include real identifying info). Pseudonymized
// consistently within a single report (same UUID -> same "cuenta-N" label
// every time it appears) instead of a flat redaction, so different sections
// of the SAME report (connection state vs. adblock log) can still be
// correlated by account — a flat REDACTED for every accountId would make
// that correlation impossible and the report far less useful for debugging.
function pseudonymizeAccountIds(input, labelByAccountId, keyHint) {
  if (input == null) return input;
  if (Array.isArray(input)) return input.map((item) => pseudonymizeAccountIds(item, labelByAccountId, keyHint));
  if (typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === 'accountId' && typeof value === 'string') {
        if (!labelByAccountId.has(value)) labelByAccountId.set(value, `cuenta-${labelByAccountId.size + 1}`);
        out[key] = labelByAccountId.get(value);
        continue;
      }
      out[key] = pseudonymizeAccountIds(value, labelByAccountId, key);
    }
    return out;
  }
  return input;
}

function scrubReport(input, keyHint) {
  if (input == null) return input;
  if (Array.isArray(input)) return input.map((item) => scrubReport(item, keyHint));
  if (typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (SENSITIVE_KEY_PATTERN.test(key) || USER_IDENTITY_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      if ((key === 'url' || key === 'initiator') && typeof value === 'string') {
        out[key] = scrubUrlLike(value);
        continue;
      }
      if (key === 'requestBody' || key === 'body' || key === 'loginBody') {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubReport(value, key);
    }
    return out;
  }
  if (typeof input === 'string') return scrubString(input);
  return input;
}

// accountConnectionStates: array of {accountId, ...manager.getState()}
// networkSnapshots: array of network-health.checkAccountNetwork results
// adBlockLog: array of {url, hostname, resourceType, initiator, accountId, timestamp}
// memoryStats: whatever shape app.getAppMetrics()-derived data already has
function buildReport({ accountConnectionStates = [], networkSnapshots = [], adBlockLog = [], memoryStats = [] } = {}) {
  const raw = {
    generatedAt: Date.now(),
    accountConnectionStates,
    networkSnapshots,
    adBlockLog,
    memoryStats
  };
  return scrubReport(pseudonymizeAccountIds(raw, new Map()));
}

// Pure ring-buffer push, extracted so the ad-block diagnostic log's cap
// behavior (main.js's recordAdBlockEntry) is directly unit-testable without
// requiring main.js. Mutates and returns `log` for convenience — never
// changes any block/allow decision, purely bookkeeping.
function pushCapped(log, entry, cap) {
  log.push(entry);
  while (log.length > cap) log.shift();
  return log;
}

module.exports = {
  buildReport,
  scrubReport,
  scrubUrlLike,
  pushCapped
};
