// Pure classification of Electron's render-process-gone/child-process-gone
// event details — no Electron APIs touched here, just a lookup over the
// documented `reason`/`type` values, so the orchestration logic in main.js
// (global app.on handlers, GPU crash-loop tracking) can be driven by a
// small, fully-testable decision function instead of ad-hoc if-chains
// scattered at each call site.

const CRITICAL_REASONS = new Set(['oom', 'crashed', 'abnormal-exit', 'killed', 'integrity-failure', 'launch-failed']);

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

module.exports = { classifyCrash };
