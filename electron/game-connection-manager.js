// Per-account connection state machine — pure logic only in this file. No
// Electron APIs, no webContents, no CDP: everything here is a plain
// function of (state, event) -> nextState, fully unit-testable without a
// running app. The Electron-facing glue (feeding real events in, actually
// invoking recovery levels) lives in main.js/game-telemetry.js, not here.
//
// Two-layer design: a network/renderer layer (works identically whether or
// not the JS frame capture is attached, including on /login, where it must
// never attach — see isGameUrl()'s login exclusion in game-telemetry.js)
// and a WS layer that only means anything once game-telemetry.attachCapture()
// has actually attached. States like WS_CONNECTING/WS_STALE/WS_CLOSED are
// simply never reached pre-login; LOGIN_PAGE always resolves to IDLE instead.

const STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  HEALTHY: 'HEALTHY',
  IDLE: 'IDLE',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  DNS_FAILURE: 'DNS_FAILURE',
  SERVER_UNREACHABLE: 'SERVER_UNREACHABLE',
  WS_CONNECTING: 'WS_CONNECTING',
  WS_STALE: 'WS_STALE',
  WS_CLOSED: 'WS_CLOSED',
  RENDERER_UNRESPONSIVE: 'RENDERER_UNRESPONSIVE',
  RENDERER_CRASHED: 'RENDERER_CRASHED',
  RECOVERING: 'RECOVERING',
  RECOVERY_FAILED: 'RECOVERY_FAILED'
});

// Recovery levels: 0 observe (no-op) · 1 revalidate (network-health) ·
// 2 non-destructive wake (pulseGameRealtimeConnection, unchanged) ·
// 3 force a clean re-poll of the JS frame capture (gameTelemetry.reattachCapture)
// · 4 visible alert / manual reconnect / last-resort reload (default OFF).
// `null` means "no recovery action needed for this transition".

// Pure reducer — the testable heart of this module. Never reads Date.now()
// itself for decisions (the caller passes `now`), never touches any
// cumulative/rate-based signal (killsPerHour and friends) — only discrete
// events, so a "looks healthy on average" input can never fool it into
// reporting HEALTHY. Only an explicit FRAME_RECEIVED event does that.
function reduce(currentState, event, now = Date.now()) {
  const state = currentState || STATES.INITIALIZING;
  if (!event || typeof event.type !== 'string') {
    return { nextState: state, recoveryLevel: null, reason: 'invalid-event' };
  }

  switch (event.type) {
    case 'ACCOUNT_CLOSED':
      return { nextState: state, recoveryLevel: null, reason: 'account-closed-no-transition' };

    case 'LOGIN_PAGE':
      // No WS layer exists pre-login and the capture script must never
      // attach here — model this as IDLE, not any WS_* state.
      return { nextState: STATES.IDLE, recoveryLevel: null, reason: 'on-login-page' };

    case 'FRAME_RECEIVED':
      // The strongest possible "this account is fine" signal — wins from
      // any prior state, including RECOVERY_FAILED (a late frame after
      // giving up still means it's actually alive now).
      return { nextState: STATES.HEALTHY, recoveryLevel: null, reason: 'frame-received' };

    case 'FROZEN_DETECTED':
      // First response to a suspected freeze is always Level 1 (revalidate
      // network) — never jump straight to a destructive action. No-op while
      // already recovering or already given up, to avoid re-triggering.
      if (state === STATES.RECOVERING || state === STATES.RECOVERY_FAILED) {
        return { nextState: state, recoveryLevel: null, reason: 'already-recovering-or-failed' };
      }
      return { nextState: STATES.WS_STALE, recoveryLevel: 1, reason: 'frozen-detected' };

    case 'NETWORK_CHECK': {
      const r = event.result || {};
      if (r.electronOnline === false) {
        return { nextState: STATES.NETWORK_OFFLINE, recoveryLevel: null, reason: 'no-network-interface' };
      }
      if (r.dnsResolved === false) {
        return { nextState: STATES.DNS_FAILURE, recoveryLevel: 2, reason: 'dns-failed' };
      }
      if (r.httpsReachable === false) {
        return { nextState: STATES.SERVER_UNREACHABLE, recoveryLevel: 2, reason: 'https-unreachable' };
      }
      // Network layer itself is fine. If we got here chasing a WS-level or
      // network-level symptom, move on to Level 2 (non-destructive wake);
      // if we were just idle/healthy already, don't manufacture a change.
      if (state === STATES.WS_STALE || state === STATES.NETWORK_OFFLINE ||
          state === STATES.DNS_FAILURE || state === STATES.SERVER_UNREACHABLE) {
        return { nextState: STATES.RECOVERING, recoveryLevel: 2, reason: 'network-healthy-trying-non-destructive-wake' };
      }
      return { nextState: state, recoveryLevel: null, reason: 'network-healthy-no-change' };
    }

    case 'WS_DETACHED':
      // Originally modeled a CDP debugger session dying with nothing ever
      // re-attaching it — the confirmed, previously-unfixed bug. CDP capture
      // is gone now (see game-telemetry.js), but the same event/level still
      // fires for other capture-layer disruptions (e.g. a Network Service
      // process crash — main.js's app.on('child-process-gone')), where
      // Level 3 now means "force a clean re-poll of the JS capture" instead
      // of "re-attach the debugger".
      return { nextState: STATES.WS_CLOSED, recoveryLevel: 3, reason: 'capture-layer-disrupted' };

    case 'WS_REATTACHED':
      return { nextState: STATES.WS_CONNECTING, recoveryLevel: null, reason: 'capture-reattached-awaiting-frames' };

    case 'RECOVERY_LEVEL_2_DONE':
      // A non-destructive wake was sent — do NOT assume it worked. Stay in
      // RECOVERING until a real FRAME_RECEIVED event proves it.
      return { nextState: STATES.RECOVERING, recoveryLevel: null, reason: 'awaiting-verification' };

    case 'RECOVERY_EXHAUSTED':
      return { nextState: STATES.RECOVERY_FAILED, recoveryLevel: 4, reason: 'all-levels-exhausted' };

    case 'RENDERER_UNRESPONSIVE':
      return { nextState: STATES.RENDERER_UNRESPONSIVE, recoveryLevel: 1, reason: 'renderer-unresponsive' };

    case 'RENDERER_RESPONSIVE':
      return { nextState: STATES.WS_CONNECTING, recoveryLevel: null, reason: 'renderer-responsive-again' };

    case 'RENDERER_CRASHED':
      return { nextState: STATES.RENDERER_CRASHED, recoveryLevel: 4, reason: event.reason || 'renderer-process-gone' };

    case 'RENDERER_RELOADED':
      return { nextState: STATES.WS_CONNECTING, recoveryLevel: null, reason: 'renderer-reloaded' };

    default:
      return { nextState: state, recoveryLevel: null, reason: 'unhandled-event' };
  }
}

// Backoff — 5/10/20/30/60s tiers, jitter always additive (0-10% on top of
// the tier, never faster than the tier itself, so a jittered attempt can
// never look like a tighter retry loop than intended).
const BACKOFF_TIERS_MS = [5000, 10000, 20000, 30000, 60000];
const BACKOFF_RESET_AFTER_MS = 10 * 60 * 1000; // 10 continuous healthy minutes

function nextBackoffMs(attemptCount, rand = Math.random) {
  const idx = Math.min(Math.max(attemptCount, 0), BACKOFF_TIERS_MS.length - 1);
  const base = BACKOFF_TIERS_MS[idx];
  const jitter = base * 0.1 * rand();
  return Math.round(base + jitter);
}

function shouldResetBackoff(lastHealthyAt, now = Date.now()) {
  if (!lastHealthyAt) return false;
  return now - lastHealthyAt >= BACKOFF_RESET_AFTER_MS;
}

// Every stop condition is independent — any one of them alone is sufficient
// to stop retrying. No infinite reconnect loops: maxAttempts is a hard
// ceiling regardless of backoff/reset behavior elsewhere.
function shouldStopRetrying({ closed, quitting, isLoginPage, noInternet, userDisabled, attemptCount, maxAttempts } = {}) {
  if (closed) return { stop: true, reason: 'account-closed' };
  if (quitting) return { stop: true, reason: 'app-quitting' };
  if (isLoginPage) return { stop: true, reason: 'on-login-page' };
  if (noInternet) return { stop: true, reason: 'no-internet' };
  if (userDisabled) return { stop: true, reason: 'user-disabled-recovery' };
  if (typeof maxAttempts === 'number' && attemptCount >= maxAttempts) return { stop: true, reason: 'max-attempts-reached' };
  return { stop: false, reason: null };
}

// Thin stateful wrapper around reduce() — holds per-account state, attempt
// count, and last-healthy timestamp; not itself the thing under heavy test
// (reduce()/backoff helpers are), but exercised indirectly by the wiring
// tests once Etapa 5 lands.
function createAccountConnectionManager(accountId, { getWc, onRecoveryLevel, onStateChange } = {}) {
  let state = STATES.INITIALIZING;
  let attemptCount = 0;
  let lastHealthyAt = null;

  function handleEvent(event, now = Date.now()) {
    const prevState = state;
    const { nextState, recoveryLevel, reason } = reduce(state, event, now);

    // BUG FIXED (found live): this used to call shouldResetBackoff(lastHealthyAt, now)
    // unconditionally on every event, regardless of current state. lastHealthyAt only
    // gets touched when actually HEALTHY, so once an account has been stuck unhealthy
    // for more than BACKOFF_RESET_AFTER_MS (10 min) — exactly the case a real freeze
    // produces — "now - lastHealthyAt >= 10min" is true on EVERY subsequent tick,
    // pinning attemptCount at 0 forever. That silently defeated shouldStopRetrying's
    // maxAttempts ceiling in main.js's runRecoveryLevel: the account could sit in
    // RECOVERING indefinitely, endlessly repeating Level 2, never escalating to
    // Level 3/4 or giving up. Confirmed live: an account stuck 2+ hours still showed
    // "RECOVERING · intentos: 0". The 10-minutes-of-continuous-health reset this was
    // meant to express is already achieved by the immediate reset below the moment
    // HEALTHY is (re)entered — that's the only place attemptCount should ever drop
    // back to 0.
    if (nextState === STATES.HEALTHY) {
      lastHealthyAt = now;
      attemptCount = 0;
    }

    state = nextState;
    if (prevState !== nextState && typeof onStateChange === 'function') {
      onStateChange({ accountId, previousState: prevState, currentState: nextState, reason, changedAt: now, lastHealthyAt, recoveryAttempt: attemptCount });
    }
    if (recoveryLevel != null) {
      attemptCount += 1;
      if (typeof onRecoveryLevel === 'function') {
        onRecoveryLevel({
          accountId,
          level: recoveryLevel,
          attemptCount,
          delayMs: nextBackoffMs(attemptCount - 1),
          wc: typeof getWc === 'function' ? getWc() : null,
          reason
        });
      }
    }
    return { state, attemptCount, lastHealthyAt };
  }

  function getState() {
    return { state, attemptCount, lastHealthyAt };
  }

  function destroy() {
    // No timers/listeners owned directly by this object yet — placeholder
    // kept for symmetry with the wiring layer added in a later stage, so
    // callers already have a stable teardown hook to call.
  }

  return { handleEvent, getState, destroy };
}

module.exports = {
  STATES,
  reduce,
  nextBackoffMs,
  shouldResetBackoff,
  shouldStopRetrying,
  createAccountConnectionManager
};
