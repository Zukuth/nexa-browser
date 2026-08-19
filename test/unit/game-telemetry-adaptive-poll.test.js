const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const gameTelemetry = require('../../electron/game-telemetry');

const { shouldPollTick, POLL_IDLE_STREAK_THRESHOLD, POLL_IDLE_SKIP_TICKS } = gameTelemetry;

describe('shouldPollTick (adaptive 250ms telemetry polling)', () => {
  test('polls every single tick while the queue has been active recently (below the idle streak threshold)', () => {
    for (let tick = 1; tick <= 20; tick++) {
      assert.equal(shouldPollTick(tick, 0), true);
      assert.equal(shouldPollTick(tick, POLL_IDLE_STREAK_THRESHOLD - 1), true);
    }
  });

  test('backs off to polling only every Nth tick once the empty streak reaches the threshold', () => {
    const results = [];
    for (let tick = 1; tick <= POLL_IDLE_SKIP_TICKS * 3; tick++) {
      results.push(shouldPollTick(tick, POLL_IDLE_STREAK_THRESHOLD));
    }
    // Exactly 1 in every POLL_IDLE_SKIP_TICKS ticks should poll.
    const polledCount = results.filter(Boolean).length;
    assert.equal(polledCount, 3);
  });

  test('a frame arriving resets emptyStreak to 0, which snaps back to polling every tick immediately', () => {
    // Simulates the real loop: idle for a while, then a frame shows up.
    assert.equal(shouldPollTick(40, POLL_IDLE_STREAK_THRESHOLD), true); // 40 % 4 === 0, was due anyway
    // Right after a frame arrives, emptyStreak resets to 0 — next tick must poll regardless of tickCount.
    assert.equal(shouldPollTick(41, 0), true);
    assert.equal(shouldPollTick(42, 0), true);
  });

  test('respects custom thresholds passed explicitly', () => {
    assert.equal(shouldPollTick(2, 5, { idleStreakThreshold: 3, idleSkipTicks: 2 }), true); // 2 % 2 === 0
    assert.equal(shouldPollTick(3, 5, { idleStreakThreshold: 3, idleSkipTicks: 2 }), false); // 3 % 2 !== 0
    assert.equal(shouldPollTick(3, 2, { idleStreakThreshold: 3, idleSkipTicks: 2 }), true); // below threshold, always polls
  });
});
