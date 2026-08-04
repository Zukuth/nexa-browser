const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { shouldSkipOptimize, DEFAULT_MEMORY_GROWTH_THRESHOLD_MB } = require('../../electron/memory-optimizer');

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
