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

// Firefox-style trigger: react to how much RAM the whole machine has left,
// not just what our own processes are using. The pre-existing MB threshold
// in main.js (totalAccountMemoryMb() >= MEMORY_PRESSURE_THRESHOLD_MB) only
// sees our own footprint — a user with another heavy app (a video editor, a
// game) eating the machine's RAM never trips it, even though the system is
// genuinely under pressure. This is a second, independent early-trigger
// alongside that one and the 24h timer, not a replacement — whichever fires
// first wins. Percentage-based (not a fixed free-MB number) so it scales
// sensibly across machines with very different total RAM.
// 30%, not 15% — chosen for users with less RAM than a typical dev machine
// (this app targets everyone running 2+ game accounts at once, not just
// high-RAM setups): on an 8GB machine 30% free is still only ~2.4GB, a
// realistic point where several open accounts really are worth relieving,
// while 15% would've meant waiting until just ~1.2GB free on that same
// machine — too close to the edge for users with less headroom to begin
// with.
const DEFAULT_SYSTEM_FREE_THRESHOLD_PCT = 0.3;

function systemMemoryPressureHigh({ freeMb, totalMb, thresholdPct = DEFAULT_SYSTEM_FREE_THRESHOLD_PCT } = {}) {
  if (typeof freeMb !== 'number' || typeof totalMb !== 'number' || totalMb <= 0) return false;
  return freeMb / totalMb < thresholdPct;
}

module.exports = {
  DEFAULT_MEMORY_GROWTH_THRESHOLD_MB,
  shouldSkipOptimize,
  DEFAULT_SYSTEM_FREE_THRESHOLD_PCT,
  systemMemoryPressureHigh
};
