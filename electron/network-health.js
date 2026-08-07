// Real reachability diagnostics — DNS + HTTPS, not just navigator.onLine.
// `net.isOnline()` (and its renderer-side twin `navigator.onLine`) only
// means "some network interface exists" — it says nothing about whether
// poke.idleworld.online itself is actually reachable. This module answers
// that more specific question so recovery logic can tell "your internet is
// down" apart from "the game's server/CDN is down" apart from "DNS is
// broken" instead of guessing from a single boolean.
//
// Never attaches CDP, never touches an account's webContents, never runs on
// /login — this is main-process-only, side-channel diagnostics. Safe to run
// at any time, including while an account sits on /login behind Turnstile.

const { net } = require('electron');

const DEFAULT_TIMEOUT_MS = 5000;

// Chromium's own resolver (net.resolveHost), NOT Node's dns module. Confirmed
// live this was a real bug, not a hypothetical: Node's dns.promises.resolve()
// (c-ares) failed with ECONNREFUSED on a machine where the game itself was
// online and playing fine — Node's resolver doesn't necessarily go through
// the same DNS servers/DNS-over-HTTPS/VPN config Chromium's network stack
// uses, so it can report "DNS broken" while the actual webview (and thus the
// actual game connection) works perfectly. net.resolveHost asks Chromium's
// own network service, so it reflects reality instead of a different,
// possibly-misconfigured-for-this-machine resolution path. Wrapped to keep
// resolveImpl's existing contract (resolves to an array of address strings)
// so the rest of this function — and the existing unit tests, which inject
// their own fake resolveImpl — don't need to change.
async function resolveHostnameViaChromium(hostname) {
  const resolved = await net.resolveHost(hostname);
  return (resolved && resolved.endpoints || []).map((e) => e.address);
}

// accountId is accepted (not otherwise used) purely so future per-account
// context — a per-account proxy, for instance — has an obvious place to
// hang off without changing the call signature everywhere it's used.
async function checkAccountNetwork(accountId, opts = {}) {
  const {
    hostname,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    proxyActive = false,
    // Injectable for unit testing without a real network/Electron runtime.
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    resolveImpl = resolveHostnameViaChromium,
    isOnlineImpl = net && typeof net.isOnline === 'function' ? net.isOnline : null
  } = opts;

  const result = {
    electronOnline: null,
    dnsResolved: false,
    resolvedAddresses: [],
    httpsReachable: false,
    httpsStatus: null,
    lastErrorCode: null,
    lastErrorDescription: null,
    proxyActive: !!proxyActive,
    checkedAt: Date.now()
  };

  if (!hostname) {
    result.lastErrorCode = 'NO_HOSTNAME';
    result.lastErrorDescription = 'checkAccountNetwork requires a hostname';
    return result;
  }

  try {
    result.electronOnline = isOnlineImpl ? !!isOnlineImpl() : null;
  } catch (err) {
    console.error('[network-health] net.isOnline() failed for', accountId, err);
  }

  try {
    const addresses = await resolveImpl(hostname);
    result.dnsResolved = Array.isArray(addresses) && addresses.length > 0;
    result.resolvedAddresses = Array.isArray(addresses) ? addresses : [];
  } catch (err) {
    result.dnsResolved = false;
    result.lastErrorCode = (err && err.code) || 'DNS_ERROR';
    result.lastErrorDescription = (err && err.message) || String(err);
  }

  if (!fetchImpl) {
    // No fetch available (shouldn't happen on Electron 43 / Node 18+, but
    // never throw from a diagnostics helper) — leave httpsReachable false
    // and record why, same as a real failed request would.
    result.lastErrorCode = result.lastErrorCode || 'NO_FETCH_IMPL';
    result.lastErrorDescription = result.lastErrorDescription || 'no fetch implementation available';
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://${hostname}/`, { method: 'HEAD', signal: controller.signal });
    result.httpsReachable = true;
    result.httpsStatus = res.status;
  } catch (err) {
    result.httpsReachable = false;
    // Don't overwrite a DNS-error reason with a generic fetch-abort reason —
    // the DNS failure is the more specific, more useful diagnosis.
    if (!result.lastErrorCode) {
      result.lastErrorCode = (err && err.name) || 'FETCH_ERROR';
      result.lastErrorDescription = (err && err.message) || String(err);
    }
  } finally {
    clearTimeout(timer);
  }

  return result;
}

// netLog capture — diagnostic export only, never for normal operation.
// captureMode is hardcoded to 'default' and never 'includeSensitive' or
// 'everything', which can capture cookies/auth data — callers must not be
// able to override this.
async function startNetLogCapture(ses, { path, maxSizeMb = 20 } = {}) {
  if (!ses || !ses.netLog) return { ok: false, error: 'session sin netLog disponible' };
  if (!path) return { ok: false, error: 'se requiere una ruta de archivo' };
  try {
    await ses.netLog.startLogging(path, {
      captureMode: 'default',
      maxFileSize: Math.max(1, maxSizeMb) * 1024 * 1024
    });
    return { ok: true, path };
  } catch (err) {
    console.error('[network-health] no se pudo iniciar netLog', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function stopNetLogCapture(ses) {
  if (!ses || !ses.netLog) return { ok: false, error: 'session sin netLog disponible' };
  try {
    const path = await ses.netLog.stopLogging();
    return { ok: true, path };
  } catch (err) {
    console.error('[network-health] no se pudo detener netLog', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

module.exports = {
  checkAccountNetwork,
  startNetLogCapture,
  stopNetLogCapture
};
