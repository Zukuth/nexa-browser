// @ts-check
// Popped-out account window: main sends the account's partition/preload/url
// once (popout:init), this creates a <webview> pointed at about:blank first so
// main's did-attach-webview handler can finish wiring the webContents (session
// config, telemetry, listeners) before the real navigation starts — same
// ordering guarantee the main window's panels use, see wireAccountWebContents
// in electron/main.js.
//
// Lives in its own file rather than inline in popout.html so that page can
// carry the same strict Content-Security-Policy as every other document this
// app owns (index.html, permission-prompt.html, screenshot-editor.html) —
// `script-src 'self'` blocks inline scripts, which is why this was the one
// shell document without a CSP.
// popoutAPI lo expone electron/popout-preload.js vía contextBridge; su tipo
// está declarado en types/globals.d.ts.
const popoutAPI = window.popoutAPI;

popoutAPI.onInit((info) => {
  const wv = document.createElement('webview');
  wv.setAttribute('partition', info.partition);
  wv.setAttribute('preload', info.preload);
  // backgroundThrottling=no matters here for exactly the reason it matters in
  // renderer.js's renderPanelWebviews: a popped-out window that's minimized or
  // sitting behind another window is a backgrounded page as far as Chromium is
  // concerned, so rAF nearly stops and timers get clamped hard after a few
  // minutes — which starves the game's own WebSocket keepalive, the server
  // times the connection out, and the character shows up frozen. Omitting it
  // here meant "pop out this account" quietly reintroduced the freeze bug the
  // main window had already fixed. main.js's syncBackgroundThrottling() takes
  // over once the real URL is known; this is the safe starting default until
  // then.
  wv.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,backgroundThrottling=no');
  wv.setAttribute('allowpopups', '');
  wv.src = 'about:blank';
  document.body.appendChild(wv);

  popoutAPI.onReady((accountId) => {
    if (accountId === info.accountId && info.url && info.url !== 'about:blank') {
      wv.src = info.url;
    }
  });
});
