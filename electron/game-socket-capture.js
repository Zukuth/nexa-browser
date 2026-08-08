// Passive WebSocket telemetry capture for the game's own webview. Replaced
// an earlier CDP-based implementation (wc.debugger.attach + Network.enable)
// after CDP caused a real bug in production: a debugger detach silently
// froze an account's telemetry until a full reload, with nothing to recover
// it. Validated side-by-side against CDP before the cutover — 136/136
// frames matched in a shadow-mode comparison, then 240/240 frames captured
// cleanly in a real play session as the sole capture mechanism (see
// game-telemetry.js's attachCaptureViaJs, the only caller of this module).
//
// This script is injected into the game's own webview MAIN world via
// wc.executeJavaScript() — NOT via account-preload.js. account-preload.js
// runs in an isolated world (webview has contextIsolation=yes, confirmed in
// src/renderer.js), and isolated worlds do not share built-in object
// instances (WebSocket, etc.) with the page's real main world — patching
// WebSocket there would silently do nothing to the game's real socket. This
// is why every WS-send patch that already works in this app (teleport,
// depot moves, family actions — all in main.js) is injected via
// executeJavaScript instead: that runs in the main world, confirmed live
// every time one of those features actually moves something in-game.

// Patches WebSocket.prototype (not a single instance) so it retroactively
// affects any socket already created before this runs — mitigates (but
// doesn't provably eliminate) the race condition inherent to injecting
// after page load instead of before it, which was CDP's original
// justification. Idempotent via window.__nexaFrameCapture.
function frameCaptureScript() {
  return `(function() {
    if (window.__nexaFrameCapture) return;
    window.__nexaFrameCapture = true;
    window.__nexaFrameQueue = window.__nexaFrameQueue || [];
    const push = (data, socket) => {
      try {
        window.__nexaFrameQueue.push({ t: Date.now(), data: String(data) });
        // Piggybacks the game's own socket reference (needed to send our
        // own outgoing frames — family-get, pokes-get, depot moves,
        // teleport) onto this same, already-proven-reliable capture path
        // instead of the separate send-only patch in main.js's
        // gameSocketCaptureScript. That one only grabs a reference when the
        // PAGE itself calls .send(), which real accounts confirmed live can
        // go quiet on for a while (sitting connected but idle, or right
        // after an internal reconnect) — leaving every outgoing frame we
        // send failing as "socket del juego no disponible" even though the
        // account was clearly connected. Incoming messages, by contrast,
        // arrive constantly and reliably on every account (this exact
        // mechanism is what the 136/136 · 240/240 · 382/382 frame-parity
        // checks were run against), so grabbing the reference here as well
        // covers the idle-client gap.
        if (socket) window.__nexaGameSocket = socket;
      } catch (e) {}
    };
    const proto = WebSocket.prototype;
    const originalAddEventListener = proto.addEventListener;
    proto.addEventListener = function(type, listener, options) {
      if (type === 'message' && typeof listener === 'function') {
        const wrapped = function(event) {
          push(event && event.data, this);
          return listener.apply(this, arguments);
        };
        return originalAddEventListener.call(this, type, wrapped, options);
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
    // Some code assigns ws.onmessage = fn directly instead of
    // addEventListener — cover that path too via the property setter.
    const onmessageDescriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (onmessageDescriptor && onmessageDescriptor.set) {
      Object.defineProperty(proto, 'onmessage', {
        configurable: true,
        set(fn) {
          const wrapped = typeof fn === 'function' ? function(event) {
            push(event && event.data, this);
            return fn.apply(this, arguments);
          } : fn;
          onmessageDescriptor.set.call(this, wrapped);
        },
        get() {
          return onmessageDescriptor.get.call(this);
        }
      });
    }
  })();`;
}

// Drains window.__nexaFrameQueue — polled from the main process at a fixed
// interval instead of pushed in real time, since there's no Node/IPC access
// from the page's main world (that's what account-preload.js's isolated
// world is for, and it can't see this data — see the module comment above).
// Confirmed live: a few hundred ms of staging latency here is not something
// a user would ever notice — even the "Drops en vivo" panel only polls
// gameStats every 5s.
function drainFrameQueueScript() {
  return `(function() {
    if (!window.__nexaFrameQueue) return [];
    return window.__nexaFrameQueue.splice(0);
  })();`;
}

module.exports = { frameCaptureScript, drainFrameQueueScript };
