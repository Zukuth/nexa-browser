// Per-tab FPS/ping diagnostic overlays — split out of main.js (perf/
// maintainability pass, 2026-08-21) as the first slice of that file's
// too-big-to-safely-edit problem, following the same one-feature-per-module
// pattern already used for adblock-manager.js/extensions-manager.js. Unlike
// those two, this module needs no access to main.js's `data`/persist()/
// broadcastState() — every function here only ever touches the one
// WebContents it's handed — so there's no factory/dependency-injection
// wrapper, just plain exported functions.

// Real per-tab FPS counter — measures the actual page's own render loop
// (whatever it's doing with requestAnimationFrame, including Modo Eco's
// throttle if that account has it on), not nexa-browser's own chrome FPS
// (that's the separate counter already in the status bar, measuring the
// host UI's rAF, not any account's content). Runs for every account, not
// just the game, so the user can see real FPS on any tab. Idempotent via
// window.__nexaFpsOverlay, safe to re-run on every did-finish-load — reuses
// the same badge element instead of appending duplicates. `visible` sets the
// starting display state (data.settings.showFpsOverlay at injection time);
// toggling the setting later without a reload goes through
// setFpsOverlayVisible() below instead of re-injecting.
// Color thresholds mirror what GPU benchmarking overlays (MSI Afterburner/
// RTSS) already do — green is healthy, yellow is a real but survivable
// slowdown (matches Modo Eco's 30fps cap on purpose, not a false alarm),
// red means something is actually wrong.
const FPS_COLOR_SCRIPT = `
    function nexaFpsColor(fps) {
      if (fps >= 45) return '#3ddc57';
      if (fps >= 20) return '#e0c341';
      return '#e05555';
    }
`;
function injectFpsOverlay(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaFpsOverlay) return;
      window.__nexaFpsOverlay = true;
      ${FPS_COLOR_SCRIPT}
      const badge = document.createElement('div');
      badge.id = 'nexa-fps-badge';
      // contain:layout style paint scopes every future text update to just
      // this element's own box — without it, a fixed-position element whose
      // content changes width every second (9 FPS vs 123 FPS) can still make
      // the browser walk up looking for anything that might need to react,
      // on a page that's already busy rendering a real game. This tells it
      // up front that nothing outside this box ever needs to know.
      badge.style.cssText = 'position:fixed;top:6px;right:6px;z-index:2147483647;background:rgba(0,0,0,0.55);color:#3ddc57;font:11px monospace;padding:2px 6px;border-radius:4px;pointer-events:none;contain:layout style paint;display:${visible ? '' : 'none'};';
      badge.textContent = '… FPS';
      (document.body || document.documentElement).appendChild(badge);
      let frames = 0;
      let last = performance.now();
      // Toggling the setting off used to only hide the badge with
      // display:none — the rAF loop itself kept running forever underneath,
      // still doing real work (a callback every single frame, competing with
      // the game's own canvas rendering) for an account nobody could even see
      // a counter on. window.__nexaFpsSetRunning lets setFpsOverlayVisible
      // below actually stop/restart the loop instead of just hiding its output.
      let running = ${visible};
      function loop(now) {
        if (!running) return;
        frames += 1;
        if (now - last >= 1000) {
          badge.textContent = frames + ' FPS';
          badge.style.color = nexaFpsColor(frames);
          frames = 0;
          last = now;
        }
        requestAnimationFrame(loop);
      }
      window.__nexaFpsSetRunning = (on) => {
        const wasRunning = running;
        running = on;
        badge.style.display = on ? '' : 'none';
        if (on && !wasRunning) {
          frames = 0;
          last = performance.now();
          requestAnimationFrame(loop);
        }
      };
      if (running) requestAnimationFrame(loop);
    })();`
  ).catch(() => {});
}

// Toggles the already-injected FPS badge on/off, and — unlike the old
// display:none-only version — actually stops the rAF loop while off instead
// of leaving it running invisibly. Used when the user flips "Mostrar FPS" in
// Configuración while accounts are already open.
function setFpsOverlayVisible(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaFpsSetRunning) window.__nexaFpsSetRunning(${visible});
    })();`
  ).catch(() => {});
}

// Real per-tab latency/ping counter — same idea and same visual style as
// injectFpsOverlay above, but bottom-right instead of top-right, and
// measuring round-trip time to the page's own origin instead of render FPS.
// Uses a same-origin HEAD request (no CORS issues on any site, no extra
// content downloaded) timed with performance.now(); a GET fallback covers
// servers that reject HEAD on that route. Runs for every account, not just
// the game — this is a generic "how's my connection to whatever site is
// loaded" indicator. Idempotent via window.__nexaPingOverlay, safe to
// re-run on every did-finish-load. Same green/yellow/red convention as the
// FPS badge, tuned for a HEAD round-trip instead of a frame rate.
const PING_COLOR_SCRIPT = `
    function nexaPingColor(ms) {
      if (ms <= 100) return '#3ddc57';
      if (ms <= 300) return '#e0c341';
      return '#e05555';
    }
`;
function injectPingOverlay(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaPingOverlay) return;
      window.__nexaPingOverlay = true;
      ${PING_COLOR_SCRIPT}
      const badge = document.createElement('div');
      badge.id = 'nexa-ping-badge';
      // contain:layout style paint — same reasoning as the FPS badge above:
      // scopes this element's own text updates to its own box instead of
      // Chromium walking outward looking for anything that might react, on a
      // page already busy rendering a real game.
      badge.style.cssText = 'position:fixed;bottom:6px;right:6px;z-index:2147483647;background:rgba(0,0,0,0.55);color:#3ddc57;font:11px monospace;padding:2px 6px;border-radius:4px;pointer-events:none;contain:layout style paint;display:${visible ? '' : 'none'};';
      badge.textContent = '… ms';
      (document.body || document.documentElement).appendChild(badge);
      // Some sites' SPA routing 404s on HEAD for a client-side route (e.g.
      // dragonballidle.online/play — confirmed live: HEAD -> 404, GET -> 200)
      // while GET on that same URL succeeds. Chromium logs that 404 to the
      // console itself at the network layer no matter what the JS around it
      // does, so the very first tick can't avoid it — but remembering the
      // failure and skipping straight to GET afterwards stops it from
      // repeating on every single 2s tick for the rest of the page's life.
      let headUnsupported = false;
      // A site that accepts the connection but never responds would otherwise
      // leave fetch() pending forever — since this measure() runs off a plain
      // setInterval (not waited on), the NEXT tick fires 3s later regardless
      // and starts another fetch on top of it, piling up concurrent hung
      // requests for as long as the account stays open. inFlight skips a tick
      // outright if the previous one hasn't resolved yet, and the 2.5s abort
      // timeout (under the 3s tick interval) guarantees each one gives up
      // before the next tick would've started anyway.
      let inFlight = false;
      async function fetchWithTimeout(url, opts) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 2500);
        try {
          return await fetch(url, { ...opts, signal: ac.signal });
        } finally {
          clearTimeout(timer);
        }
      }
      async function measure() {
        // fetch() only supports http(s) — about:blank (every account starts
        // there before its real src loads) and any other scheme throw
        // "Fetch API cannot load ... URL scheme is not supported" as a real
        // console error every 2s regardless of the try/catch around it
        // (Chromium logs the failed request at the network layer, not just
        // as a JS exception) — confirmed live as exactly the spam reported.
        // Skip the tick entirely instead of letting it always fail.
        if (!location.protocol.startsWith('http')) return;
        if (inFlight) return;
        inFlight = true;
        const url = location.href;
        const start = performance.now();
        let ok = false;
        try {
        if (!headUnsupported) {
          try {
            ok = (await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store' })).ok;
          } catch (e) {
            // network-level failure, timeout, or abort — fall through to GET below.
          }
          if (!ok) headUnsupported = true;
        }
        if (!ok) {
          try {
            ok = (await fetchWithTimeout(url, { method: 'GET', cache: 'no-store' })).ok;
          } catch (e2) {
            // offline, blocked, or timed out — leave the last known value showing.
          }
        }
        if (!ok) return; // HEAD and GET both failed/non-2xx — don't show a bogus number.
        // Wall-clock around the awaited fetch (the old approach) doesn't
        // measure network time alone — it also includes however long this
        // callback had to wait in line for a free tick on the main thread.
        // On a page doing heavy canvas work (a busy idle-game battle scene,
        // dozens of sprites, already-low FPS) that queueing delay dwarfs the
        // real round-trip and shows a "ping" of tens of seconds that has
        // nothing to do with the network. Resource Timing entries are
        // stamped by the browser's network stack at the moment each event
        // actually happened, independent of when JS gets around to reading
        // them, so pulling the duration from there instead reports real
        // transfer time even while the main thread is starved. Falls back to
        // the wall-clock number if the entry isn't found for some reason
        // (buffer disabled, evicted) rather than showing nothing.
        const entries = performance.getEntriesByType('resource').filter((e) => e.name === url && e.startTime >= start - 50);
        const entry = entries[entries.length - 1];
        const ms = entry ? Math.round(entry.responseEnd - entry.startTime) : Math.round(performance.now() - start);
        performance.clearResourceTimings();
        badge.textContent = ms + ' ms';
        badge.style.color = nexaPingColor(ms);
        } finally {
          inFlight = false;
        }
      }
      // Same problem as the FPS badge above: display:none alone left this
      // setInterval firing a real network request every 3s forever, even
      // for an account whose ping counter the user explicitly turned off.
      // window.__nexaPingSetRunning actually starts/stops the timer.
      // 3000ms, not the original 2000ms — a status badge doesn't need
      // sub-3s freshness to read as live, and this is one fewer real fetch()
      // per account per 6s competing with the game's own canvas rendering
      // on that same thread (same reasoning as the hunt-telemetry poll
      // interval bump in game-telemetry.js, see POLL_BASE_INTERVAL_MS).
      let intervalId = null;
      function start() {
        if (intervalId) return;
        measure();
        intervalId = setInterval(measure, 3000);
      }
      function stop() {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
      window.__nexaPingSetRunning = (on) => {
        badge.style.display = on ? '' : 'none';
        if (on) start(); else stop();
      };
      if (${visible}) start();
    })();`
  ).catch(() => {});
}

// Same live-toggle pattern as setFpsOverlayVisible, for the ping badge —
// actually stops the 2s network-request timer while off, not just the
// visible display.
function setPingOverlayVisible(wc, visible) {
  wc.executeJavaScript(
    `(function() {
      if (window.__nexaPingSetRunning) window.__nexaPingSetRunning(${visible});
    })();`
  ).catch(() => {});
}

module.exports = { injectFpsOverlay, setFpsOverlayVisible, injectPingOverlay, setPingOverlayVisible };
