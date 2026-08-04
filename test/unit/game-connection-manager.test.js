const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const cm = require('../../electron/game-connection-manager');
const { STATES, reduce, nextBackoffMs, shouldResetBackoff, shouldStopRetrying, createAccountConnectionManager } = cm;

describe('reduce — key state transitions', () => {
  test('DNS failure moves to DNS_FAILURE with Level 2 recovery, then recovers to RECOVERING on healthy re-check, then HEALTHY on a real frame', () => {
    let now = 1000;
    let step = reduce(STATES.WS_STALE, { type: 'NETWORK_CHECK', result: { electronOnline: true, dnsResolved: false } }, now);
    assert.equal(step.nextState, STATES.DNS_FAILURE);
    assert.equal(step.recoveryLevel, 2);

    now += 1000;
    step = reduce(step.nextState, { type: 'NETWORK_CHECK', result: { electronOnline: true, dnsResolved: true, httpsReachable: true } }, now);
    assert.equal(step.nextState, STATES.RECOVERING);
    assert.equal(step.recoveryLevel, 2);

    now += 1000;
    step = reduce(step.nextState, { type: 'FRAME_RECEIVED' }, now);
    assert.equal(step.nextState, STATES.HEALTHY);
    assert.equal(step.recoveryLevel, null);
  });

  test('WS_CLOSED (from a CDP detach) recovers through RECOVERING to HEALTHY on a real frame', () => {
    let step = reduce(STATES.HEALTHY, { type: 'WS_DETACHED' });
    assert.equal(step.nextState, STATES.WS_CLOSED);
    assert.equal(step.recoveryLevel, 3);

    step = reduce(step.nextState, { type: 'WS_REATTACHED' });
    assert.equal(step.nextState, STATES.WS_CONNECTING);

    step = reduce(step.nextState, { type: 'FRAME_RECEIVED' });
    assert.equal(step.nextState, STATES.HEALTHY);
  });

  test('RENDERER_CRASHED goes straight to RECOVERY_FAILED territory (Level 4) when exhausted', () => {
    let step = reduce(STATES.HEALTHY, { type: 'RENDERER_CRASHED', reason: 'oom' });
    assert.equal(step.nextState, STATES.RENDERER_CRASHED);
    assert.equal(step.recoveryLevel, 4);
    assert.equal(step.reason, 'oom');

    step = reduce(step.nextState, { type: 'RECOVERY_EXHAUSTED' });
    assert.equal(step.nextState, STATES.RECOVERY_FAILED);
    assert.equal(step.recoveryLevel, 4);
  });

  test('LOGIN_PAGE always resolves to IDLE, never a WS_* state, regardless of prior state', () => {
    for (const prior of Object.values(STATES)) {
      const step = reduce(prior, { type: 'LOGIN_PAGE' });
      assert.equal(step.nextState, STATES.IDLE, `expected IDLE from prior state ${prior}`);
    }
  });

  test('NETWORK_OFFLINE has no recovery level attached (nothing Nexa can do about no network interface)', () => {
    const step = reduce(STATES.HEALTHY, { type: 'NETWORK_CHECK', result: { electronOnline: false } });
    assert.equal(step.nextState, STATES.NETWORK_OFFLINE);
    assert.equal(step.recoveryLevel, null);
  });

  test('FROZEN_DETECTED is a no-op while already RECOVERING or RECOVERY_FAILED (avoids re-triggering mid-attempt)', () => {
    let step = reduce(STATES.RECOVERING, { type: 'FROZEN_DETECTED' });
    assert.equal(step.nextState, STATES.RECOVERING);
    assert.equal(step.recoveryLevel, null);

    step = reduce(STATES.RECOVERY_FAILED, { type: 'FROZEN_DETECTED' });
    assert.equal(step.nextState, STATES.RECOVERY_FAILED);
    assert.equal(step.recoveryLevel, null);
  });

  test('a late FRAME_RECEIVED after RECOVERY_FAILED still recovers to HEALTHY', () => {
    const step = reduce(STATES.RECOVERY_FAILED, { type: 'FRAME_RECEIVED' });
    assert.equal(step.nextState, STATES.HEALTHY);
  });

  test('RENDERER_UNRESPONSIVE / RENDERER_RESPONSIVE round-trip', () => {
    let step = reduce(STATES.HEALTHY, { type: 'RENDERER_UNRESPONSIVE' });
    assert.equal(step.nextState, STATES.RENDERER_UNRESPONSIVE);
    assert.equal(step.recoveryLevel, 1);

    step = reduce(step.nextState, { type: 'RENDERER_RESPONSIVE' });
    assert.equal(step.nextState, STATES.WS_CONNECTING);
  });

  test('invalid/missing event does not throw and does not change state', () => {
    assert.doesNotThrow(() => reduce(STATES.HEALTHY, null));
    assert.doesNotThrow(() => reduce(STATES.HEALTHY, {}));
    const step = reduce(STATES.HEALTHY, { type: 'SOMETHING_UNKNOWN' });
    assert.equal(step.nextState, STATES.HEALTHY);
  });

  test('missing/undefined currentState defaults to INITIALIZING rather than throwing', () => {
    const step = reduce(undefined, { type: 'SOMETHING_UNKNOWN' });
    assert.equal(step.nextState, STATES.INITIALIZING);
  });
});

describe('regression: reduce never derives HEALTHY from cumulative/rate-based data', () => {
  test('a FROZEN_DETECTED event never produces HEALTHY, no matter what extra cumulative fields ride along on the event', () => {
    // Mirrors the exact shape of the original killsPerHour bug: a
    // cumulative-looking field that stays "positive"/truthy for a long
    // time. reduce() must never read anything off the event except `type`
    // and (for NETWORK_CHECK) `result` — it must not be fooled by this.
    const trickyEvent = { type: 'FROZEN_DETECTED', killsPerHour: 999, looksHealthy: true };
    const step = reduce(STATES.HEALTHY, trickyEvent);
    assert.notEqual(step.nextState, STATES.HEALTHY);
    assert.equal(step.nextState, STATES.WS_STALE);
  });

  test('only an explicit FRAME_RECEIVED event can produce HEALTHY', () => {
    const nonFrameEvents = ['FROZEN_DETECTED', 'WS_DETACHED', 'RENDERER_UNRESPONSIVE', 'NETWORK_CHECK'];
    for (const type of nonFrameEvents) {
      const step = reduce(STATES.WS_CLOSED, { type, result: { electronOnline: true, dnsResolved: true, httpsReachable: true } });
      assert.notEqual(step.nextState, STATES.HEALTHY, `${type} must not directly produce HEALTHY`);
    }
  });
});

describe('nextBackoffMs', () => {
  test('follows the 5/10/20/30/60s tiers, jitter always additive (never below the base tier)', () => {
    const expectedBases = [5000, 10000, 20000, 30000, 60000];
    for (let i = 0; i < expectedBases.length; i++) {
      const withNoJitter = nextBackoffMs(i, () => 0);
      const withMaxJitter = nextBackoffMs(i, () => 1);
      assert.equal(withNoJitter, expectedBases[i]);
      assert.ok(withMaxJitter >= expectedBases[i]);
      assert.ok(withMaxJitter <= expectedBases[i] * 1.1 + 1); // +1 for rounding
    }
  });

  test('attempt counts beyond the tier list clamp to the max tier (60s), never grow unbounded', () => {
    const at10 = nextBackoffMs(10, () => 0);
    const at100 = nextBackoffMs(100, () => 0);
    assert.equal(at10, 60000);
    assert.equal(at100, 60000);
  });

  test('negative attempt counts clamp to the first tier rather than throwing/underflowing', () => {
    assert.equal(nextBackoffMs(-5, () => 0), 5000);
  });
});

describe('shouldResetBackoff', () => {
  test('resets after 10 continuous healthy minutes', () => {
    const now = 20 * 60 * 1000;
    const lastHealthyAt = now - 10 * 60 * 1000;
    assert.equal(shouldResetBackoff(lastHealthyAt, now), true);
  });

  test('does not reset before 10 minutes have passed', () => {
    const now = 20 * 60 * 1000;
    const lastHealthyAt = now - 9 * 60 * 1000;
    assert.equal(shouldResetBackoff(lastHealthyAt, now), false);
  });

  test('no reset when there is no healthy baseline yet', () => {
    assert.equal(shouldResetBackoff(null, Date.now()), false);
  });
});

describe('shouldStopRetrying — each condition independently sufficient', () => {
  const base = { closed: false, quitting: false, isLoginPage: false, noInternet: false, userDisabled: false, attemptCount: 1, maxAttempts: 10 };

  test('account closed stops retrying', () => {
    assert.equal(shouldStopRetrying({ ...base, closed: true }).stop, true);
  });
  test('app quitting stops retrying', () => {
    assert.equal(shouldStopRetrying({ ...base, quitting: true }).stop, true);
  });
  test('on login page stops retrying', () => {
    assert.equal(shouldStopRetrying({ ...base, isLoginPage: true }).stop, true);
  });
  test('no internet stops retrying', () => {
    assert.equal(shouldStopRetrying({ ...base, noInternet: true }).stop, true);
  });
  test('user disabled recovery stops retrying', () => {
    assert.equal(shouldStopRetrying({ ...base, userDisabled: true }).stop, true);
  });
  test('max attempts reached stops retrying (no infinite loop)', () => {
    assert.equal(shouldStopRetrying({ ...base, attemptCount: 10, maxAttempts: 10 }).stop, true);
  });
  test('none of the stop conditions true means retrying continues', () => {
    const result = shouldStopRetrying(base);
    assert.equal(result.stop, false);
    assert.equal(result.reason, null);
  });
});

describe('createAccountConnectionManager', () => {
  test('emits onStateChange only when the state actually changes', () => {
    const changes = [];
    const manager = createAccountConnectionManager('acc1', { onStateChange: (c) => changes.push(c) });

    manager.handleEvent({ type: 'FRAME_RECEIVED' }); // INITIALIZING -> HEALTHY
    manager.handleEvent({ type: 'FRAME_RECEIVED' }); // HEALTHY -> HEALTHY, no change event

    assert.equal(changes.length, 1);
    assert.equal(changes[0].currentState, STATES.HEALTHY);
  });

  test('invokes onRecoveryLevel with an increasing attemptCount and a delayMs derived from the backoff tiers', () => {
    const levels = [];
    const manager = createAccountConnectionManager('acc1', { onRecoveryLevel: (l) => levels.push(l) });

    manager.handleEvent({ type: 'WS_DETACHED' }); // Level 3, attempt 1
    manager.handleEvent({ type: 'WS_DETACHED' }); // still WS_CLOSED->WS_CLOSED technically, but recoveryLevel still fires

    assert.equal(levels.length, 2);
    assert.equal(levels[0].attemptCount, 1);
    assert.equal(levels[1].attemptCount, 2);
    // attemptCount 1 -> backoff tier index 0 (5s), attemptCount 2 -> tier index 1 (10s)
    assert.ok(levels[0].delayMs >= 5000 && levels[0].delayMs <= 5500);
    assert.ok(levels[1].delayMs >= 10000 && levels[1].delayMs <= 11000);
  });

  test('regression: attemptCount keeps climbing across repeated recovery cycles while persistently unhealthy — found live, an account stuck for 2+ hours showed "RECOVERING · intentos: 0" forever', () => {
    // Reproduces the exact live bug: the freeze-detector loop (main.js) calls
    // handleEvent({type:'FROZEN_DETECTED'}) roughly once a minute for as long
    // as an account stays stuck. Once it's been unhealthy for more than the
    // 10-minute backoff-reset window, a buggy blanket reset used to zero
    // attemptCount on every single one of those ticks — silently defeating
    // shouldStopRetrying's maxAttempts ceiling forever.
    const levels = [];
    const manager = createAccountConnectionManager('acc1', { onRecoveryLevel: (l) => levels.push(l) });
    let now = 0;

    // First cycle: goes unhealthy, recovery pulses once, network check comes
    // back healthy but no real frame ever arrives (still actually stuck).
    manager.handleEvent({ type: 'FROZEN_DETECTED' }, now); // -> WS_STALE, level 1, attempt 1
    manager.handleEvent({ type: 'NETWORK_CHECK', result: { electronOnline: true, dnsResolved: true, httpsReachable: true } }, now); // -> RECOVERING, level 2, attempt 2

    // Simulate the freeze-detector's ~60s ticks for the next 45 minutes,
    // well past the 10-minute backoff-reset window, still stuck (no
    // FRAME_RECEIVED ever arrives). Each tick is a no-op per reduce()'s
    // "already RECOVERING" guard, but every one of them still runs through
    // handleEvent — which is exactly what re-triggered the bug.
    for (let i = 0; i < 45; i++) {
      now += 60_000;
      manager.handleEvent({ type: 'FROZEN_DETECTED' }, now);
    }

    // attemptCount must NOT have been silently reset to 0 by all those
    // no-op ticks — it should still read exactly what the last real
    // recovery-level transition left it at.
    assert.equal(manager.getState().attemptCount, 2);
    assert.equal(manager.getState().state, STATES.RECOVERING);

    // And critically: shouldStopRetrying must actually see a rising
    // attemptCount so a real caller's maxAttempts ceiling can eventually
    // fire — this is what stops the infinite-retry loop in production.
    const stop = shouldStopRetrying({ closed: false, quitting: false, isLoginPage: false, noInternet: false, userDisabled: false, attemptCount: manager.getState().attemptCount, maxAttempts: 2 });
    assert.equal(stop.stop, true);
    assert.equal(stop.reason, 'max-attempts-reached');
  });

  test('attemptCount resets to 0 once HEALTHY is reached', () => {
    const manager = createAccountConnectionManager('acc1');
    manager.handleEvent({ type: 'WS_DETACHED' });
    manager.handleEvent({ type: 'WS_DETACHED' });
    assert.ok(manager.getState().attemptCount >= 2);

    manager.handleEvent({ type: 'FRAME_RECEIVED' });
    assert.equal(manager.getState().attemptCount, 0);
  });

  test('getState reflects the current state, attemptCount, and lastHealthyAt', () => {
    const manager = createAccountConnectionManager('acc1');
    const now = 5000;
    manager.handleEvent({ type: 'FRAME_RECEIVED' }, now);
    const s = manager.getState();
    assert.equal(s.state, STATES.HEALTHY);
    assert.equal(s.lastHealthyAt, now);
  });

  test('destroy() does not throw', () => {
    const manager = createAccountConnectionManager('acc1');
    assert.doesNotThrow(() => manager.destroy());
  });
});
