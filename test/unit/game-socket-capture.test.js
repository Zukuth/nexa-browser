const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { frameCaptureScript, drainFrameQueueScript } = require('../../electron/game-socket-capture');

// These two functions only ever return script SOURCE (to be run inside the
// game's webview via wc.executeJavaScript() — see electron/game-telemetry.js's
// attachCaptureViaJs, the only real caller). Since this is now the app's
// sole telemetry transport (CDP was fully removed), a syntax slip here would
// silently break live telemetry for every account with no error anywhere in
// this process — so these tests actually RUN the returned script against a
// fake WebSocket/window, the same way the real webview would, instead of
// just checking the string contents.

// Minimal fake of what the injected script touches: `window` (== the
// sandbox's global object, like a real browser) and a WebSocket class whose
// prototype gets patched, mirroring the real DOM API surface (addEventListener,
// and an accessor-property `onmessage`, both inherited via the prototype).
function makeSandbox() {
  class FakeWebSocket {
    constructor() {
      this._listeners = [];
    }
    addEventListener(type, listener) {
      if (type === 'message') this._listeners.push(listener);
    }
    emitMessage(data) {
      const event = { data };
      for (const listener of this._listeners) listener(event);
      if (typeof this.onmessage === 'function') this.onmessage(event);
    }
  }
  // A real WebSocket.prototype has an accessor `onmessage` property (that's
  // exactly what frameCaptureScript's Object.getOwnPropertyDescriptor/
  // defineProperty dance depends on) — define one here so the patch has a
  // real setter to wrap, matching the DOM spec instead of a plain data prop.
  let onmessageBacking = new WeakMap();
  Object.defineProperty(FakeWebSocket.prototype, 'onmessage', {
    configurable: true,
    get() { return onmessageBacking.get(this) || null; },
    set(fn) { onmessageBacking.set(this, fn); }
  });

  const sandbox = { WebSocket: FakeWebSocket, Date, console };
  sandbox.window = sandbox; // window === global scope, like a real page
  vm.createContext(sandbox);
  return sandbox;
}

function run(sandbox, script) {
  return vm.runInContext(script, sandbox);
}

describe('frameCaptureScript + drainFrameQueueScript (executed like the real webview would)', () => {
  test('captures a message frame delivered via addEventListener("message", ...)', () => {
    const sandbox = makeSandbox();
    run(sandbox, frameCaptureScript());
    const ws = new sandbox.WebSocket();
    let sawEvent = false;
    ws.addEventListener('message', () => { sawEvent = true; });
    ws.emitMessage('{"type":"field-kill"}');
    assert.equal(sawEvent, true); // the original listener still fires — patch is transparent

    const drained = run(sandbox, drainFrameQueueScript());
    assert.equal(drained.length, 1);
    assert.equal(drained[0].data, '{"type":"field-kill"}');
    assert.ok(typeof drained[0].t === 'number');
  });

  test('also captures a message frame delivered via the ws.onmessage = fn property setter', () => {
    const sandbox = makeSandbox();
    run(sandbox, frameCaptureScript());
    const ws = new sandbox.WebSocket();
    let sawEvent = false;
    ws.onmessage = () => { sawEvent = true; };
    ws.emitMessage('{"type":"balls"}');
    assert.equal(sawEvent, true);

    const drained = run(sandbox, drainFrameQueueScript());
    assert.equal(drained.length, 1);
    assert.equal(drained[0].data, '{"type":"balls"}');
  });

  test('patches WebSocket.prototype (not an instance) — a socket created BEFORE the patch runs is still captured', () => {
    const sandbox = makeSandbox();
    const preExisting = new sandbox.WebSocket();
    preExisting.addEventListener('message', () => {});
    run(sandbox, frameCaptureScript()); // patch installs after the listener was already registered...
    // ...but a NEW addEventListener call on the same instance, after the patch, is what gets wrapped:
    preExisting.addEventListener('message', () => {});
    preExisting.emitMessage('{"type":"inventory"}');
    const drained = run(sandbox, drainFrameQueueScript());
    assert.equal(drained.length, 1);
  });

  test('drain empties the queue — a second drain with nothing new returns an empty array', () => {
    const sandbox = makeSandbox();
    run(sandbox, frameCaptureScript());
    const ws = new sandbox.WebSocket();
    ws.addEventListener('message', () => {});
    ws.emitMessage('{"type":"chat"}');

    const first = run(sandbox, drainFrameQueueScript());
    assert.equal(first.length, 1);
    const second = run(sandbox, drainFrameQueueScript());
    assert.equal(second.length, 0);
  });

  test('drain before any capture ran at all returns an empty array instead of throwing', () => {
    const sandbox = makeSandbox();
    const drained = run(sandbox, drainFrameQueueScript());
    // Not assert.deepEqual([]) — `drained` is an Array from the vm sandbox's
    // own realm, a different Array constructor than this test's, which trips
    // Node's cross-realm deepStrictEqual quirk for empty arrays. Length is
    // exactly what this test cares about anyway.
    assert.equal(Array.isArray(drained), true);
    assert.equal(drained.length, 0);
  });

  test('running frameCaptureScript() twice is idempotent — no double-counted frames', () => {
    const sandbox = makeSandbox();
    run(sandbox, frameCaptureScript());
    run(sandbox, frameCaptureScript()); // second injection, e.g. on a re-navigation
    const ws = new sandbox.WebSocket();
    ws.addEventListener('message', () => {});
    ws.emitMessage('{"type":"field"}');
    const drained = run(sandbox, drainFrameQueueScript());
    assert.equal(drained.length, 1); // not 2
  });

  test('a non-function assigned to onmessage (e.g. null, to remove a handler) does not throw', () => {
    const sandbox = makeSandbox();
    run(sandbox, frameCaptureScript());
    const ws = new sandbox.WebSocket();
    assert.doesNotThrow(() => { ws.onmessage = null; });
    assert.equal(ws.onmessage, null);
  });
});
