const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const gameTelemetry = require('../../electron/game-telemetry');

// Minimal fake of Electron's webContents.debugger — supports the handful of
// calls attachCapture() actually makes (attach/isAttached/sendCommand/on),
// plus a way to manually fire 'message'/'detach' the way the real debugger
// would. This is the actual surface the confirmed bug lived on: a real
// detach event that used to only get logged, never re-driving a re-attach.
function createFakeDebugger() {
  const listeners = { message: [], detach: [] };
  let attached = false;
  return {
    isAttached: () => attached,
    attach: () => { attached = true; },
    sendCommand: async () => {},
    on: (event, cb) => { if (listeners[event]) listeners[event].push(cb); },
    _emitMessage: (method, params) => listeners.message.forEach((cb) => cb(null, method, params)),
    _emitDetach: (reason) => { attached = false; listeners.detach.forEach((cb) => cb(null, reason)); }
  };
}

function createFakeWc() {
  const dbg = createFakeDebugger();
  const destroyListeners = [];
  return {
    debugger: dbg,
    once: (event, cb) => { if (event === 'destroyed') destroyListeners.push(cb); },
    _destroy: () => destroyListeners.forEach((cb) => cb())
  };
}

describe('attachCapture onDetach/onFrame callback contract', () => {
  test('onDetach fires when the CDP debugger session detaches — this is the fixed bug: previously nothing outside attachCapture ever heard about it', () => {
    const wc = createFakeWc();
    let detachedWith = null;
    gameTelemetry.attachCapture(wc, 'acc-detach-test', {
      onDetach: (reason) => { detachedWith = reason; }
    });

    assert.equal(detachedWith, null); // not called yet
    wc.debugger._emitDetach('replaced_with_devtools');
    assert.equal(detachedWith, 'replaced_with_devtools');
  });

  test('onFrame fires for every real game WS frame after applyFrame has already processed it', () => {
    const wc = createFakeWc();
    const framesSeen = [];
    gameTelemetry.attachCapture(wc, 'acc-frame-test', {
      onFrame: (msg) => framesSeen.push(msg)
    });

    wc.debugger._emitMessage('Network.webSocketFrameReceived', {
      response: { payloadData: JSON.stringify({ type: 'field-kill', xpGained: 10 }) }
    });

    assert.equal(framesSeen.length, 1);
    assert.equal(framesSeen[0].type, 'field-kill');

    // The account's own kill delta must also have been updated by the same
    // frame — proves onFrame doesn't run instead of applyFrame, only after it.
    const deltas = gameTelemetry.getDeltas('acc-frame-test');
    assert.ok(deltas.lastKillAt);
  });

  test('non-JSON WS frame payloads are ignored and never reach onFrame', () => {
    const wc = createFakeWc();
    let called = false;
    gameTelemetry.attachCapture(wc, 'acc-badframe-test', { onFrame: () => { called = true; } });

    wc.debugger._emitMessage('Network.webSocketFrameReceived', { response: { payloadData: 'not json' } });

    assert.equal(called, false);
  });

  test('calling attachCapture a second time while already attached is a no-op — no duplicate listeners, callbacks fire only once per event', () => {
    const wc = createFakeWc();
    let detachCount = 0;
    gameTelemetry.attachCapture(wc, 'acc-dup-test', { onDetach: () => { detachCount += 1; } });
    // Second call — wc.debugger.isAttached() is now true, so attachCapture's
    // own idempotency guard must return immediately without registering a
    // second 'detach' listener.
    gameTelemetry.attachCapture(wc, 'acc-dup-test', { onDetach: () => { detachCount += 1; } });

    wc.debugger._emitDetach('target_closed');
    assert.equal(detachCount, 1);
  });

  test('a thrown onDetach callback is caught and logged, never crashes the debugger event pipeline', () => {
    const wc = createFakeWc();
    gameTelemetry.attachCapture(wc, 'acc-throw-test', { onDetach: () => { throw new Error('boom'); } });
    assert.doesNotThrow(() => wc.debugger._emitDetach('crashed'));
  });

  test('attachCapture without any options object still works exactly as before (backwards compatible call sites)', () => {
    const wc = createFakeWc();
    assert.doesNotThrow(() => gameTelemetry.attachCapture(wc, 'acc-noopts-test'));
    assert.doesNotThrow(() => wc.debugger._emitDetach('some-reason'));
  });
});
