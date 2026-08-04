const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const powerManager = require('../../electron/power-manager');

describe('computeBlockerAction', () => {
  test('starts the blocker when needed and not currently running', () => {
    const { action } = powerManager.computeBlockerAction({ currentlyStarted: false, needed: true });
    assert.equal(action, 'start');
  });

  test('stops the blocker when no longer needed but currently running', () => {
    const { action } = powerManager.computeBlockerAction({ currentlyStarted: true, needed: false });
    assert.equal(action, 'stop');
  });

  test('no-ops when already running and still needed (never duplicates)', () => {
    const { action } = powerManager.computeBlockerAction({ currentlyStarted: true, needed: true });
    assert.equal(action, 'noop');
  });

  test('no-ops when not running and not needed', () => {
    const { action } = powerManager.computeBlockerAction({ currentlyStarted: false, needed: false });
    assert.equal(action, 'noop');
  });
});

describe('module surface', () => {
  test('exports the expected lifecycle functions', () => {
    assert.equal(typeof powerManager.initPowerManager, 'function');
    assert.equal(typeof powerManager.updateBlockerNeed, 'function');
    assert.equal(typeof powerManager.getPowerState, 'function');
    assert.equal(typeof powerManager.shutdownPowerManager, 'function');
  });

  test('getPowerState returns a well-shaped object even before init (Electron APIs absent outside runtime)', () => {
    const state = powerManager.getPowerState();
    assert.equal(state.blockerActive, false);
    assert.equal(state.blockerId, null);
    assert.equal(state.suspended, false);
  });
});
