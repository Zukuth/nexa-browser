// The rule that decides when repeated GPU failures earn a fallback to
// software rendering. Written after a real case on a hybrid-graphics laptop:
// the Windows event log showed 95 nvlddmkm driver resets over two weeks, each
// one killing Electron's GPU process a second later — and the fallback never
// fired once, because the only trigger was "3 crashes inside a 5-minute
// window" and these arrived 30-60 minutes apart.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { shouldFallBackToSoftwareRendering } = require('../../electron/crash-classifier');

describe('shouldFallBackToSoftwareRendering()', () => {
  test('does nothing for an isolated crash', () => {
    const r = shouldFallBackToSoftwareRendering({ consecutiveCrashes: 1, sessionCrashes: 1 });
    assert.equal(r.fallback, false);
    assert.equal(r.trigger, null);
  });

  test('does nothing for two crashes', () => {
    assert.equal(shouldFallBackToSoftwareRendering({ consecutiveCrashes: 2, sessionCrashes: 2 }).fallback, false);
  });

  test('fires on a fast crash loop', () => {
    const r = shouldFallBackToSoftwareRendering({ consecutiveCrashes: 3, sessionCrashes: 3 });
    assert.equal(r.fallback, true);
    assert.equal(r.trigger, 'loop');
  });

  // The regression this whole function exists for: the window counter resets
  // to 1 on every crash that arrives late, so `consecutive` never climbs.
  // Only the cumulative session count can catch this shape.
  test('fires on a slow drip, where the window counter never climbs past 1', () => {
    const r = shouldFallBackToSoftwareRendering({ consecutiveCrashes: 1, sessionCrashes: 4 });
    assert.equal(r.fallback, true, 'four crashes in a session must trigger even when none were consecutive');
    assert.equal(r.trigger, 'session');
  });

  test('a slow drip below the session threshold still does nothing', () => {
    assert.equal(shouldFallBackToSoftwareRendering({ consecutiveCrashes: 1, sessionCrashes: 3 }).fallback, false);
  });

  test('reports loop as the trigger when both conditions hold at once', () => {
    const r = shouldFallBackToSoftwareRendering({ consecutiveCrashes: 5, sessionCrashes: 9 });
    assert.equal(r.trigger, 'loop', 'the faster, more specific signal names the reason in the log');
  });

  test('thresholds are overridable', () => {
    assert.equal(shouldFallBackToSoftwareRendering({ sessionCrashes: 2, sessionThreshold: 2 }).fallback, true);
    assert.equal(shouldFallBackToSoftwareRendering({ consecutiveCrashes: 9, loopThreshold: 10 }).fallback, false);
  });

  test('no arguments is a safe no-op rather than a throw', () => {
    assert.equal(shouldFallBackToSoftwareRendering().fallback, false);
  });
});
