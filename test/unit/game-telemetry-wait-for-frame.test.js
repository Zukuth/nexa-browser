const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const gameTelemetry = require('../../electron/game-telemetry');

const { waitForFrame, resolveFrameWaiters, removeState, _pendingFrameWaiterCount } = gameTelemetry;

describe('waitForFrame (pendingFrameWaiters cleanup)', () => {
  test('a timed-out waiter removes itself instead of sitting in the Map forever', async () => {
    const accountId = `test-acc-${Date.now()}-a`;
    await waitForFrame(accountId, 'family', 5); // tiny timeout, settles almost immediately
    // Give the setTimeout callback a tick to run and clean up after itself.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(_pendingFrameWaiterCount(accountId, 'family'), 0);
  });

  test('a real frame arriving resolves and removes the waiter the same way a timeout would', async () => {
    const accountId = `test-acc-${Date.now()}-b`;
    const pending = waitForFrame(accountId, 'pokes', 4000);
    assert.equal(_pendingFrameWaiterCount(accountId, 'pokes'), 1);
    resolveFrameWaiters(accountId, 'pokes');
    await pending;
    assert.equal(_pendingFrameWaiterCount(accountId, 'pokes'), 0);
  });

  test('multiple concurrent waiters for the same key: one settling only removes itself, not the others', async () => {
    const accountId = `test-acc-${Date.now()}-c`;
    const first = waitForFrame(accountId, 'family', 4000);
    const second = waitForFrame(accountId, 'family', 5); // this one times out fast
    assert.equal(_pendingFrameWaiterCount(accountId, 'family'), 2);
    await second;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(_pendingFrameWaiterCount(accountId, 'family'), 1); // first is still pending
    resolveFrameWaiters(accountId, 'family');
    await first;
    assert.equal(_pendingFrameWaiterCount(accountId, 'family'), 0);
  });

  test('removeState still clears any waiters left for a permanently deleted account', async () => {
    const accountId = `test-acc-${Date.now()}-d`;
    // Short timeout (not a long-lived one) so this test doesn't keep a live
    // timer around after removeState() removes it from the Map — the timer
    // itself still fires later and is harmless (cleanup() no-ops once the
    // key's already gone), but a short one lets the process exit promptly.
    waitForFrame(accountId, 'family', 50);
    assert.equal(_pendingFrameWaiterCount(accountId, 'family'), 1);
    removeState(accountId);
    assert.equal(_pendingFrameWaiterCount(accountId, 'family'), 0);
  });
});
