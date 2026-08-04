// Pure gating logic for the memory optimizer — extracted so it's testable
// without a real Electron session/cache. The actual cache-clearing actions
// (electron/main.js's optimizeMemorySafe/optimizeMemoryDeepClean) already
// never touch cookies/IndexedDB/localStorage/sessions; the gap this closes
// is the *trigger* condition, which used to be a blind 24h timer with no
// regard for whether an account actually has anything worth clearing, or
// whether clearing right now would be disruptive.

const DEFAULT_MEMORY_GROWTH_THRESHOLD_MB = 200;

// Per-account skip decision. Any one true condition is enough to skip.
function shouldSkipOptimize({
  cacheSizeMb = 0,
  thresholdMb = DEFAULT_MEMORY_GROWTH_THRESHOLD_MB,
  accountState = null, // one of game-connection-manager's STATES, or null if unknown/disabled
  isLoading = false,
  purchaseInFlight = false
} = {}) {
  if (purchaseInFlight) return { skip: true, reason: 'purchase-in-flight' };
  if (isLoading) return { skip: true, reason: 'page-loading' };
  if (accountState === 'RECOVERING') return { skip: true, reason: 'account-recovering' };
  if (typeof cacheSizeMb === 'number' && cacheSizeMb < thresholdMb) return { skip: true, reason: 'below-growth-threshold' };
  return { skip: false, reason: null };
}

module.exports = {
  DEFAULT_MEMORY_GROWTH_THRESHOLD_MB,
  shouldSkipOptimize
};
