// Windows suspend/resume/lock/battery lifecycle — previously handled nowhere
// in the app (confirmed: zero usage of powerSaveBlocker/powerMonitor before
// this module existed). A farming browser left running for hours/days needs
// to know when Windows suspends or the screen locks, and must never assume
// a WebSocket survived that transition — it only reports the event here;
// actual re-validation is the connection manager's job (game-connection-manager.js).
//
// The blocker itself only prevents *app* suspension (screen can still turn
// off) and only runs while at least one open account is actually on the
// game — never unconditionally, never duplicated.

const { powerSaveBlocker, powerMonitor } = require('electron');

let blockerId = null;
let monitorWired = false;
let onBattery = false;
let suspended = false;

// Pure — the "should the blocker be running" decision, extracted so it's
// unit-testable without a real Electron powerSaveBlocker.
function computeBlockerAction({ currentlyStarted, needed }) {
  if (needed && !currentlyStarted) return { action: 'start' };
  if (!needed && currentlyStarted) return { action: 'stop' };
  return { action: 'noop' };
}

function isBlockerActive() {
  return blockerId != null && powerSaveBlocker.isStarted(blockerId);
}

// Recomputed from account lifecycle events (account added/removed/navigated),
// not polled — call this whenever the set of open game accounts could have
// changed.
function updateBlockerNeed(hasActiveGameAccount) {
  const { action } = computeBlockerAction({ currentlyStarted: isBlockerActive(), needed: !!hasActiveGameAccount });
  if (action === 'start') {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (action === 'stop') {
    try {
      powerSaveBlocker.stop(blockerId);
    } catch (err) {
      console.error('[power-manager] failed to stop powerSaveBlocker', err);
    }
    blockerId = null;
  }
}

function initPowerManager({
  onSuspend, onResume, onLockScreen, onUnlockScreen, onACPower, onBatteryPower, onSpeedLimitChange
} = {}) {
  if (monitorWired) return; // idempotent — safe to call again without duplicating listeners
  monitorWired = true;

  powerMonitor.on('suspend', () => {
    suspended = true;
    try { onSuspend && onSuspend(); } catch (err) { console.error('[power-manager] onSuspend handler failed', err); }
  });
  powerMonitor.on('resume', () => {
    suspended = false;
    try { onResume && onResume(); } catch (err) { console.error('[power-manager] onResume handler failed', err); }
  });
  powerMonitor.on('lock-screen', () => {
    try { onLockScreen && onLockScreen(); } catch (err) { console.error('[power-manager] onLockScreen handler failed', err); }
  });
  powerMonitor.on('unlock-screen', () => {
    try { onUnlockScreen && onUnlockScreen(); } catch (err) { console.error('[power-manager] onUnlockScreen handler failed', err); }
  });
  powerMonitor.on('on-ac', () => {
    onBattery = false;
    try { onACPower && onACPower(); } catch (err) { console.error('[power-manager] onACPower handler failed', err); }
  });
  powerMonitor.on('on-battery', () => {
    onBattery = true;
    try { onBatteryPower && onBatteryPower(); } catch (err) { console.error('[power-manager] onBatteryPower handler failed', err); }
  });
  // Not all platforms emit this — guard defensively, it's not in every
  // Electron/OS combination's powerMonitor.
  if (typeof powerMonitor.on === 'function') {
    powerMonitor.on('speed-limit-change', (limit) => {
      try { onSpeedLimitChange && onSpeedLimitChange(limit); } catch (err) { console.error('[power-manager] onSpeedLimitChange handler failed', err); }
    });
  }
}

function getPowerState() {
  return { blockerActive: isBlockerActive(), blockerId, onBattery, suspended };
}

function shutdownPowerManager() {
  if (blockerId != null) {
    try { powerSaveBlocker.stop(blockerId); } catch { /* already stopped, nothing to clean up */ }
    blockerId = null;
  }
  // powerMonitor listeners intentionally stay registered — this only runs
  // at app shutdown, and Electron tears the process down right after.
}

module.exports = {
  initPowerManager,
  updateBlockerNeed,
  getPowerState,
  shutdownPowerManager,
  // exported for unit testing
  computeBlockerAction
};
