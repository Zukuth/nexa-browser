const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldSkipOptimize,
  DEFAULT_MEMORY_GROWTH_THRESHOLD_MB,
  systemMemoryPressureHigh,
  DEFAULT_SYSTEM_FREE_THRESHOLD_PCT
} = require('../../electron/memory-optimizer');

describe('shouldSkipOptimize', () => {
  test('skips when a purchase is in flight, regardless of everything else', () => {
    const result = shouldSkipOptimize({ cacheSizeMb: 9999, purchaseInFlight: true });
    assert.equal(result.skip, true);
    assert.equal(result.reason, 'purchase-in-flight');
  });

  test('skips while the page is loading', () => {
    const result = shouldSkipOptimize({ cacheSizeMb: 9999, isLoading: true });
    assert.equal(result.skip, true);
    assert.equal(result.reason, 'page-loading');
  });

  test('skips while the account is RECOVERING', () => {
    const result = shouldSkipOptimize({ cacheSizeMb: 9999, accountState: 'RECOVERING' });
    assert.equal(result.skip, true);
    assert.equal(result.reason, 'account-recovering');
  });

  test('skips when cache size is below the growth threshold', () => {
    const result = shouldSkipOptimize({ cacheSizeMb: 10, thresholdMb: 200 });
    assert.equal(result.skip, true);
    assert.equal(result.reason, 'below-growth-threshold');
  });

  test('does not skip when cache size is at/above the threshold and nothing else blocks it', () => {
    const result = shouldSkipOptimize({ cacheSizeMb: 250, thresholdMb: 200 });
    assert.equal(result.skip, false);
    assert.equal(result.reason, null);
  });

  test('uses the default threshold when none is provided', () => {
    const below = shouldSkipOptimize({ cacheSizeMb: DEFAULT_MEMORY_GROWTH_THRESHOLD_MB - 1 });
    const above = shouldSkipOptimize({ cacheSizeMb: DEFAULT_MEMORY_GROWTH_THRESHOLD_MB + 1 });
    assert.equal(below.skip, true);
    assert.equal(above.skip, false);
  });

  test('a healthy, non-RECOVERING account state never blocks optimization on its own', () => {
    const result = shouldSkipOptimize({ cacheSizeMb: 300, thresholdMb: 200, accountState: 'HEALTHY' });
    assert.equal(result.skip, false);
  });

  test('no arguments at all still returns a well-formed, safe (skip) result rather than throwing', () => {
    assert.doesNotThrow(() => shouldSkipOptimize());
    const result = shouldSkipOptimize();
    assert.equal(typeof result.skip, 'boolean');
  });
});

describe('systemMemoryPressureHigh', () => {
  test('true when free memory is below the threshold percentage of total', () => {
    assert.equal(systemMemoryPressureHigh({ freeMb: 1000, totalMb: 10000, thresholdPct: 0.15 }), true);
  });

  test('false when free memory is at/above the threshold percentage of total', () => {
    assert.equal(systemMemoryPressureHigh({ freeMb: 2000, totalMb: 10000, thresholdPct: 0.15 }), false);
  });

  test('uses the default 30% threshold when none is provided', () => {
    assert.equal(systemMemoryPressureHigh({ freeMb: 2000, totalMb: 10000 }), true);
    assert.equal(systemMemoryPressureHigh({ freeMb: 4000, totalMb: 10000 }), false);
    assert.equal(DEFAULT_SYSTEM_FREE_THRESHOLD_PCT, 0.3);
  });

  test('scales with total RAM instead of using a fixed free-MB number', () => {
    // 15GB free on a 64GB machine is only 23.4% free (pressured), while 3GB
    // free on an 8GB machine is 37.5% free (not pressured) — more raw free
    // MB on the 8GB machine but comfortably fine relative to its total. A
    // fixed free-MB threshold would get this backwards.
    assert.equal(systemMemoryPressureHigh({ freeMb: 15000, totalMb: 64000 }), true);
    assert.equal(systemMemoryPressureHigh({ freeMb: 3000, totalMb: 8000 }), false);
  });

  test('returns false instead of throwing on missing or invalid input', () => {
    assert.doesNotThrow(() => systemMemoryPressureHigh());
    assert.equal(systemMemoryPressureHigh(), false);
    assert.equal(systemMemoryPressureHigh({ freeMb: 100 }), false); // no totalMb
    assert.equal(systemMemoryPressureHigh({ freeMb: 100, totalMb: 0 }), false); // avoid divide-by-zero
  });
});
