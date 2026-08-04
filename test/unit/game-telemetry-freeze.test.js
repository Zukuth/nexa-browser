const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const gameTelemetry = require('../../electron/game-telemetry');

const THRESHOLD_MS = 4 * 60 * 1000;

function stateWithDeltas(deltas) {
  return { deltas };
}

describe('isLikelyFrozen (freeze-detector regression)', () => {
  test('regression: one early kill then 10min of non-gameplay frames must be flagged frozen', () => {
    // This is the exact bug that shipped: killsPerHour stayed positive for
    // hours after a single kill, so the old check never caught this case.
    const now = Date.now();
    const oldKill = now - 15 * 60 * 1000; // killed 15 minutes ago
    const recentNonGameplayFrame = now - 30 * 1000; // an inventory/balls frame 30s ago
    const state = stateWithDeltas({
      lastAnyFrameAt: recentNonGameplayFrame, // WS still alive, frames still arriving
      lastKillAt: oldKill,
      lastCaptureAt: null,
      lastXpGainAt: oldKill,
      lastHuntResetAt: oldKill
    });

    assert.equal(gameTelemetry.isLikelyFrozen(state, THRESHOLD_MS, now), true);
  });

  test('WS truly silent (no frames at all) for longer than threshold is flagged frozen', () => {
    const now = Date.now();
    const state = stateWithDeltas({
      lastAnyFrameAt: now - 10 * 60 * 1000, // last frame 10 min ago, nothing since
      lastKillAt: null,
      lastCaptureAt: null,
      lastXpGainAt: null,
      lastHuntResetAt: null
    });

    assert.equal(gameTelemetry.isLikelyFrozen(state, THRESHOLD_MS, now), true);
  });

  test('account idling in shop/depot (never had gameplay) is not flagged just for lacking kills', () => {
    const now = Date.now();
    const state = stateWithDeltas({
      lastAnyFrameAt: now - 30 * 1000, // WS alive, recent non-gameplay frame
      lastKillAt: null,
      lastCaptureAt: null,
      lastXpGainAt: null,
      lastHuntResetAt: null
    });

    assert.equal(gameTelemetry.isLikelyFrozen(state, THRESHOLD_MS, now), false);
  });

  test('healthy account with frequent kills is never flagged frozen', () => {
    const now = Date.now();
    const state = stateWithDeltas({
      lastAnyFrameAt: now - 2000,
      lastKillAt: now - 5000,
      lastCaptureAt: now - 60000,
      lastXpGainAt: now - 5000,
      lastHuntResetAt: now - 20 * 60 * 1000
    });

    assert.equal(gameTelemetry.isLikelyFrozen(state, THRESHOLD_MS, now), false);
  });

  test('fresh state with no frames received yet is not flagged (avoids false positive right after attach)', () => {
    const now = Date.now();
    const state = stateWithDeltas({
      lastAnyFrameAt: null,
      lastKillAt: null,
      lastCaptureAt: null,
      lastXpGainAt: null,
      lastHuntResetAt: null
    });

    assert.equal(gameTelemetry.isLikelyFrozen(state, THRESHOLD_MS, now), false);
  });

  test('missing state or missing deltas returns false rather than throwing', () => {
    assert.equal(gameTelemetry.isLikelyFrozen(null, THRESHOLD_MS, Date.now()), false);
    assert.equal(gameTelemetry.isLikelyFrozen({}, THRESHOLD_MS, Date.now()), false);
  });

  test('a real hunt-reset alone counts as gameplay activity, resetting staleness', () => {
    const now = Date.now();
    const state = stateWithDeltas({
      lastAnyFrameAt: now - 30 * 1000,
      lastKillAt: null,
      lastCaptureAt: null,
      lastXpGainAt: null,
      lastHuntResetAt: now - 60 * 1000 // switched hunting zone a minute ago
    });

    assert.equal(gameTelemetry.isLikelyFrozen(state, THRESHOLD_MS, now), false);
  });
});

describe('applyFrame populates deltas (integration with the real frame parser)', () => {
  test('field-kill stamps lastKillAt and lastAnyFrameAt', () => {
    const state = gameTelemetry.emptyLive ? { live: gameTelemetry.emptyLive(), huntKey: null, wallet: {}, deltas: { lastAnyFrameAt: null, lastKillAt: null, lastCaptureAt: null, lastXpGainAt: null, lastHuntResetAt: null } } : null;
    assert.ok(state, 'emptyLive helper must be exported');

    gameTelemetry.applyFrame(state, { type: 'field-kill', xpGained: 42 });

    assert.ok(state.deltas.lastAnyFrameAt);
    assert.ok(state.deltas.lastKillAt);
    assert.ok(state.deltas.lastXpGainAt);
    assert.equal(state.live.kills, 1);
  });

  test('field-init with a changed huntKey stamps lastHuntResetAt', () => {
    const state = {
      live: gameTelemetry.emptyLive(),
      huntKey: 'zone-a',
      wallet: {},
      deltas: { lastAnyFrameAt: null, lastKillAt: null, lastCaptureAt: null, lastXpGainAt: null, lastHuntResetAt: null }
    };

    gameTelemetry.applyFrame(state, { type: 'field-init', huntKey: 'zone-b' });

    assert.equal(state.huntKey, 'zone-b');
    assert.ok(state.deltas.lastHuntResetAt);
  });

  test('non-gameplay frame (balls) stamps lastAnyFrameAt but no gameplay delta', () => {
    const state = {
      live: gameTelemetry.emptyLive(),
      huntKey: 'zone-a',
      wallet: {},
      deltas: { lastAnyFrameAt: null, lastKillAt: null, lastCaptureAt: null, lastXpGainAt: null, lastHuntResetAt: null }
    };

    gameTelemetry.applyFrame(state, { type: 'balls', balls: [] });

    assert.ok(state.deltas.lastAnyFrameAt);
    assert.equal(state.deltas.lastKillAt, null);
    assert.equal(state.deltas.lastCaptureAt, null);
    assert.equal(state.deltas.lastXpGainAt, null);
  });
});
