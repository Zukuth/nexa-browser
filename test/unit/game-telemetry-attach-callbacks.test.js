const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const gameTelemetry = require('../../electron/game-telemetry');

// Minimal fake of Electron's webContents — supports the handful of calls
// attachCapture()'s JS-based path actually makes (executeJavaScript to
// inject the patch, then poll it every POLL_BASE_INTERVAL_MS; isDestroyed/
// once for teardown). _queueFrame lets a test push a raw WS payload the way
// the injected page-side patch would, for the next poll tick to pick up.
// _destroy() both fires the 'destroyed' listener (as Electron would) and
// must be called at the end of every test here — attachCapture's poll
// interval is a REAL setInterval, and a real timer left running keeps
// node:test's process alive forever instead of exiting after the run.
function createFakeWc() {
  let queue = [];
  const destroyListeners = [];
  return {
    _queueFrame: (data) => queue.push({ t: Date.now(), data }),
    isDestroyed: () => false,
    executeJavaScript: async (script) => {
      // Only the drain call (game-socket-capture.js's drainFrameQueueScript)
      // needs a real return value here — the inject call's result is never
      // read by attachCaptureViaJs, so any string is fine for it.
      if (typeof script === 'string' && script.includes('__nexaFrameQueue.splice')) {
        const drained = queue;
        queue = [];
        return drained;
      }
      return null;
    },
    once: (event, cb) => { if (event === 'destroyed') destroyListeners.push(cb); },
    _destroy: () => destroyListeners.forEach((cb) => cb())
  };
}

// The interval-based poll runs every POLL_BASE_INTERVAL_MS — wait a bit past
// that so the fake's queued frame gets drained and processed. Derived from
// the real exported constant (not a hardcoded number) so this doesn't
// silently start racing the poll interval again the next time it's tuned.
function waitForPoll(ms = gameTelemetry.POLL_BASE_INTERVAL_MS + 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('attachCapture onFrame callback contract (JS-based capture)', () => {
  test('onFrame fires for every real game WS frame after applyFrame has already processed it', async () => {
    const wc = createFakeWc();
    const framesSeen = [];
    gameTelemetry.attachCapture(wc, 'acc-frame-test', {
      onFrame: (msg) => framesSeen.push(msg)
    });

    wc._queueFrame(JSON.stringify({ type: 'field-kill', xpGained: 10 }));
    await waitForPoll();
    wc._destroy();

    assert.equal(framesSeen.length, 1);
    assert.equal(framesSeen[0].type, 'field-kill');

    // The account's own kill delta must also have been updated by the same
    // frame — proves onFrame doesn't run instead of applyFrame, only after it.
    const deltas = gameTelemetry.getDeltas('acc-frame-test');
    assert.ok(deltas.lastKillAt);
  });

  test('non-JSON WS frame payloads are ignored and never reach onFrame', async () => {
    const wc = createFakeWc();
    let called = false;
    gameTelemetry.attachCapture(wc, 'acc-badframe-test', { onFrame: () => { called = true; } });

    wc._queueFrame('not json');
    await waitForPoll();
    wc._destroy();

    assert.equal(called, false);
  });

  test('calling attachCapture a second time while already attached is a no-op — no duplicate polling interval', async () => {
    const wc = createFakeWc();
    let frameCount = 0;
    gameTelemetry.attachCapture(wc, 'acc-dup-test', { onFrame: () => { frameCount += 1; } });
    // Second call — the interval-exists guard must return immediately
    // without starting a second poller.
    gameTelemetry.attachCapture(wc, 'acc-dup-test', { onFrame: () => { frameCount += 1; } });

    wc._queueFrame(JSON.stringify({ type: 'balls', balls: [] }));
    await waitForPoll();
    wc._destroy();

    assert.equal(frameCount, 1);
  });

  test('a thrown onFrame callback is caught and logged, never crashes the poll loop', async () => {
    const wc = createFakeWc();
    gameTelemetry.attachCapture(wc, 'acc-throw-test', { onFrame: () => { throw new Error('boom'); } });

    wc._queueFrame(JSON.stringify({ type: 'balls', balls: [] }));
    await assert.doesNotReject(waitForPoll());
    wc._destroy();
  });

  test('attachCapture without any options object still works exactly as before (backwards compatible call sites)', async () => {
    const wc = createFakeWc();
    assert.doesNotThrow(() => gameTelemetry.attachCapture(wc, 'acc-noopts-test'));
    wc._queueFrame(JSON.stringify({ type: 'balls', balls: [] }));
    await assert.doesNotReject(waitForPoll());
    wc._destroy();
  });

  test('reattachCapture forces a fresh poll cycle — used by connection-manager recovery level 3', async () => {
    const wc = createFakeWc();
    const framesSeen = [];
    gameTelemetry.attachCapture(wc, 'acc-reattach-test', { onFrame: (msg) => framesSeen.push(msg) });

    gameTelemetry.reattachCapture(wc, 'acc-reattach-test', { onFrame: (msg) => framesSeen.push(msg) });

    wc._queueFrame(JSON.stringify({ type: 'field-kill', xpGained: 1 }));
    await waitForPoll();
    wc._destroy();

    assert.equal(framesSeen.length, 1);
  });
});
