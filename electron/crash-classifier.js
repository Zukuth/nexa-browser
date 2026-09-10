// @ts-check
// Pure classification of Electron's render-process-gone/child-process-gone
// event details — no Electron APIs touched here, just a lookup over the
// documented `reason`/`type` values, so the orchestration logic in main.js
// (global app.on handlers, GPU crash-loop tracking) can be driven by a
// small, fully-testable decision function instead of ad-hoc if-chains
// scattered at each call site.

const CRITICAL_REASONS = new Set(['oom', 'crashed', 'abnormal-exit', 'killed', 'integrity-failure', 'launch-failed']);

/** @param {{ reason?: string, type?: string }} [details] */
function classifyCrash({ reason, type } = {}) {
  const category = type || 'Renderer'; // render-process-gone events carry no `type` — they're always the renderer
  const normalizedReason = reason || 'unknown';
  let severity = 'warning';
  if (normalizedReason === 'clean-exit') severity = 'info';
  else if (CRITICAL_REASONS.has(normalizedReason)) severity = 'critical';

  // Only a genuine GPU-process failure (not a clean exit) counts toward the
  // "should we consider falling back to software rendering" signal — a
  // single data point isn't enough on its own; main.js tracks a short-window
  // consecutive count before actually acting on this.
  const shouldDisableGpu = category === 'GPU' && normalizedReason !== 'clean-exit';

  return { severity, category, reason: normalizedReason, shouldDisableGpu };
}

// Decides whether repeated GPU failures have earned a fallback to software
// rendering. Two independent triggers, because a GPU fails in two very
// different shapes and the original rule only recognised one:
//
//   - loop: several crashes inside a short window. A driver dying on startup
//     and taking the GPU process with it every few seconds.
//   - drip: a cumulative count over the whole app session, never reset by
//     elapsed time. This is the one that was missing. Confirmed live on a
//     hybrid-graphics laptop: 95 driver resets over two weeks, arriving
//     30-60 minutes apart, so a 5-minute window counter reset to 1 every
//     single time and the fallback never fired once in two weeks.
//
// Pure so both thresholds can be tested without provoking a real GPU crash,
// which is the only other way to reach this code.
function shouldFallBackToSoftwareRendering({
  consecutiveCrashes = 0,
  sessionCrashes = 0,
  loopThreshold = 3,
  sessionThreshold = 4
} = {}) {
  const loop = consecutiveCrashes >= loopThreshold;
  const drip = sessionCrashes >= sessionThreshold;
  return { fallback: loop || drip, trigger: loop ? 'loop' : drip ? 'session' : null };
}

module.exports = { classifyCrash, shouldFallBackToSoftwareRendering };
