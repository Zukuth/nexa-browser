// Regression guard for the ad-block stats persist debounce (perf audit
// 2026-08-21, see adblock-manager.js's recordAdBlockStat/persistStatsDebounced):
// before this, every single blocked request called the injected persist()
// (main.js's fast, 400ms-debounced full-store write) directly, so a page
// with a steady stream of ads/trackers kept the whole store rewriting to
// disk continuously. recordAdBlockStat now batches through its own much
// slower (5s) debounce instead. mock.module('electron', ...) follows the
// same pattern test/unit/store.test.js already uses — adblock-manager.js
// only needs `ipcMain` from 'electron' at require time (registerIpcHandlers/
// registerCosmeticIpcHandlers, neither called here, are the only things that
// actually invoke it).
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

describe('recordAdBlockStat persist debounce', () => {
  test('many stat updates within the debounce window call persist() once, not once per update', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const data = freshData();
      let persistCalls = 0;
      const manager = createAdblockManager({
        getData: () => data,
        persist: () => { persistCalls += 1; },
        broadcastState: () => {},
        getAccount: () => null
      });

      manager.recordAdBlockStat('ads.example.com', 'ads');
      manager.recordAdBlockStat('tracker.example.com', 'tracking');
      manager.recordAdBlockStat('ads.example.com', 'ads');
      assert.equal(persistCalls, 0); // still batching, nothing flushed yet
      assert.equal(data.adBlockStats.total, 3); // but the in-memory counters update immediately

      mock.timers.tick(4999);
      assert.equal(persistCalls, 0); // just under the 5s debounce
      mock.timers.tick(1);
      assert.equal(persistCalls, 1); // debounce fired — exactly one write for all three updates
    } finally {
      mock.timers.reset();
    }
  });

  test('a burst that spans two debounce windows calls persist() twice, not once for everything', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const data = freshData();
      let persistCalls = 0;
      const manager = createAdblockManager({
        getData: () => data,
        persist: () => { persistCalls += 1; },
        broadcastState: () => {},
        getAccount: () => null
      });

      manager.recordAdBlockStat('ads.example.com', 'ads');
      mock.timers.tick(5000);
      assert.equal(persistCalls, 1);

      manager.recordAdBlockStat('ads.example.com', 'ads');
      mock.timers.tick(5000);
      assert.equal(persistCalls, 2);
    } finally {
      mock.timers.reset();
    }
  });

  test('flushAdBlockStatsPersist() forces a pending debounce to persist immediately', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const data = freshData();
      let persistCalls = 0;
      const manager = createAdblockManager({
        getData: () => data,
        persist: () => { persistCalls += 1; },
        broadcastState: () => {},
        getAccount: () => null
      });

      manager.recordAdBlockStat('ads.example.com', 'ads');
      assert.equal(persistCalls, 0);
      manager.flushAdBlockStatsPersist(); // simulates the before-quit call in main.js
      assert.equal(persistCalls, 1);

      // Nothing pending — calling it again should be a no-op, not a second write.
      manager.flushAdBlockStatsPersist();
      assert.equal(persistCalls, 1);
    } finally {
      mock.timers.reset();
    }
  });
});
