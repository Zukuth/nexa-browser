// Regression guard for the shield popup's per-page category breakdown
// (Brave-Shields-style — "Nexa vs Firefox/Brave" comparison, 2026-08-21):
// blockedByCategoryOnPage should count blocks since the last real navigation
// only, split by category, and reset cleanly on the next one. Same
// mock.module('electron', ...) setup as adblock-stats-persist.test.js.
const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');

mock.module('electron', {
  exports: {
    ipcMain: { handle() {}, on() {}, removeHandler() {} }
  }
});

const { createAdblockManager } = require('../../electron/adblock-manager');

function freshData() {
  return {
    adBlockStats: { total: 0, byCategory: { ads: 0, tracking: 0, social: 0, analytics: 0, other: 0 }, byHost: {} },
    settings: { adBlockPausedSites: [], adBlockManualBlocklist: [] }
  };
}

function makeManager() {
  const data = freshData();
  return createAdblockManager({
    getData: () => data,
    persist: () => {},
    broadcastState: () => {},
    getAccount: () => null
  });
}

describe('per-page ad-block category breakdown', () => {
  test('counts blocked entries by category for the current page', () => {
    const manager = makeManager();
    manager.resetPageAdBlockStats('acc1');
    manager.recordAdBlockEntry('acc1', { hostname: 'doubleclick.net', category: 'ads' });
    manager.recordAdBlockEntry('acc1', { hostname: 'google-analytics.com', category: 'analytics' });
    manager.recordAdBlockEntry('acc1', { hostname: 'facebook.net', category: 'social' });
    manager.recordAdBlockEntry('acc1', { hostname: 'doubleclick.net', category: 'ads' });

    const counts = manager.getBlockedByCategoryOnPage('acc1');
    assert.deepEqual(counts, { ads: 2, tracking: 0, social: 1, analytics: 1, other: 0 });
  });

  test('resetPageAdBlockStats() clears the per-page breakdown (real navigation)', () => {
    const manager = makeManager();
    manager.resetPageAdBlockStats('acc1');
    manager.recordAdBlockEntry('acc1', { hostname: 'doubleclick.net', category: 'ads' });
    assert.equal(manager.getBlockedByCategoryOnPage('acc1').ads, 1);

    manager.resetPageAdBlockStats('acc1'); // simulates did-navigate
    assert.deepEqual(manager.getBlockedByCategoryOnPage('acc1'), { ads: 0, tracking: 0, social: 0, analytics: 0, other: 0 });
  });

  test('is scoped per account — one account never sees another\'s counts', () => {
    const manager = makeManager();
    manager.resetPageAdBlockStats('acc1');
    manager.resetPageAdBlockStats('acc2');
    manager.recordAdBlockEntry('acc1', { hostname: 'doubleclick.net', category: 'ads' });

    assert.equal(manager.getBlockedByCategoryOnPage('acc1').ads, 1);
    assert.equal(manager.getBlockedByCategoryOnPage('acc2').ads, 0);
  });

  test('an account with no activity yet returns all-zero counts, not undefined/throw', () => {
    const manager = makeManager();
    assert.deepEqual(manager.getBlockedByCategoryOnPage('never-seen'), { ads: 0, tracking: 0, social: 0, analytics: 0, other: 0 });
  });

  test('still feeds the lifetime stats.byCategory total the same as before (recordAdBlockStat unaffected)', () => {
    const data = freshData();
    const manager = createAdblockManager({
      getData: () => data,
      persist: () => {},
      broadcastState: () => {},
      getAccount: () => null
    });
    manager.resetPageAdBlockStats('acc1');
    manager.recordAdBlockEntry('acc1', { hostname: 'doubleclick.net', category: 'ads' });
    manager.recordAdBlockEntry('acc1', { hostname: 'doubleclick.net', category: 'ads' });
    assert.equal(data.adBlockStats.byCategory.ads, 2);
    assert.equal(data.adBlockStats.total, 2);
  });
});
