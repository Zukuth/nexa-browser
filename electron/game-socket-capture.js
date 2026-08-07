// Etapa A of the CDP -> passive-JS telemetry migration (see the plan the
// user approved: replace wc.debugger/CDP with a PokeGrid-style passive
// WebSocket.prototype patch, because CDP is structurally heavier and has
// already caused a real bug this session — a debugger detach that froze
// telemetry until a full reload).
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
//
// Right now (Etapa A) this ONLY feeds a comparison log against the existing
// CDP capture — it does not affect any real telemetry. See
// startFrameCaptureShadowPoll in main.js.

// Patches WebSocket.prototype (not a single instance) so it retroactively
// affects any socket already created before this runs, same reasoning as
// the existing send-capture patch. Idempotent via window.__nexaFrameCapture.
function frameCaptureShadowScript() {
  return `(function() {
    if (window.__nexaFrameCapture) return;
    window.__nexaFrameCapture = true;
    window.__nexaFrameQueue = window.__nexaFrameQueue || [];
    const push = (data) => {
      try { window.__nexaFrameQueue.push({ t: Date.now(), data: String(data) }); } catch (e) {}
    };
    const proto = WebSocket.prototype;
    const originalAddEventListener = proto.addEventListener;
    proto.addEventListener = function(type, listener, options) {
      if (type === 'message' && typeof listener === 'function') {
        const wrapped = function(event) {
          push(event && event.data);
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
            push(event && event.data);
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
// Good enough for validation: even the real Drops en vivo panel only polls
// gameStats every 5s today, so a few hundred ms of extra staging latency
// here is not something a user would ever notice once this becomes the real
// transport in a later stage.
function drainFrameQueueScript() {
  return `(function() {
    if (!window.__nexaFrameQueue) return [];
    return window.__nexaFrameQueue.splice(0);
  })();`;
}

module.exports = { frameCaptureShadowScript, drainFrameQueueScript };
