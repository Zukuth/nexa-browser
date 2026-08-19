// Real Picture-in-Picture with working controls — built on the browser's
// own native video.requestPictureInPicture(), not a fully custom window.
//
// A fully custom Document Picture-in-Picture window (built and tested first)
// had to be abandoned: confirmed live with direct process logs that the
// window opens successfully and then self-closes within milliseconds
// (pagehide/unload fire almost immediately) whenever it's opened from
// inside a <webview> guest context — this app's account architecture,
// chosen specifically to avoid the Cloudflare Turnstile false-positive a
// WebContentsView-based approach caused (see wireAccountWebContents' own
// comment in main.js). documentPictureInPicture appears to assume its
// opener is a real top-level tab; a <webview> guest doesn't fit that model
// closely enough for Electron/Chromium to keep the window alive.
//
// The native PiP window IS already a real, always-on-top OS window
// independent of which account tab is active in Nexa Browser (see
// account:pipState / onPipState — "Picture-in-Picture cross-account
// persistence" already covers exactly that). What it lacked was working
// controls beyond a bare play/pause. The Media Session API
// (navigator.mediaSession.setActionHandler) is what Chrome itself uses to
// add real skip-back/skip-forward buttons to a native PiP window's chrome —
// confirmed live that it's available inside a <webview>'s page context.
// There is no equivalent standard action for volume, so unlike the
// abandoned custom-window design, the native PiP window here won't get a
// volume slider — that's a real, accepted limitation of building on top of
// the OS's own PiP chrome instead of a fully custom one.
// Confirmed live (screenshot of the actual native PiP window on a real
// YouTube video): registering these handlers ONCE at PiP-request time is
// not enough — YouTube runs its own Media Session integration (confirmed
// live too: navigator.mediaSession.metadata is already YouTube's own video
// title/playbackState before our script ever runs) and keeps re-asserting
// its own action handlers afterward. setActionHandler has last-writer-wins
// semantics with no way to "reserve" an action, so YouTube's later calls
// silently overwrite ours — observed live as an ASYMMETRIC failure (skip
// back kept working, skip forward silently stopped appearing in the native
// PiP window), which is consistent with YouTube re-registering one action
// slightly differently/more often than the other, not any single one-time
// race. Re-asserting ours on an interval for as long as this video stays
// the PiP element outcompetes that instead of trying to win a one-time race.
function setupMediaSessionScript(video) {
  return `
    if ('mediaSession' in navigator) {
      try {
        const nexaApplyMediaSessionHandlers = () => {
          try {
            navigator.mediaSession.setActionHandler('play', () => { ${video}.play().catch(() => {}); });
            navigator.mediaSession.setActionHandler('pause', () => { ${video}.pause(); });
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
              const skip = (details && details.seekOffset) || 10;
              ${video}.currentTime = Math.max(0, ${video}.currentTime - skip);
            });
            navigator.mediaSession.setActionHandler('seekforward', (details) => {
              const skip = (details && details.seekOffset) || 10;
              ${video}.currentTime = Math.min(${video}.duration || Infinity, ${video}.currentTime + skip);
            });
            navigator.mediaSession.setActionHandler('seekto', (details) => {
              if (details && typeof details.seekTime === 'number') ${video}.currentTime = details.seekTime;
            });
          } catch (e) {}
        };
        nexaApplyMediaSessionHandlers();
        const nexaMediaSessionTimer = setInterval(() => {
          if (document.pictureInPictureElement !== ${video}) {
            clearInterval(nexaMediaSessionTimer);
            return;
          }
          nexaApplyMediaSessionHandlers();
        }, 1000);
        ${video}.addEventListener('leavepictureinpicture', () => {
          clearInterval(nexaMediaSessionTimer);
          // Real, documented Chromium/Electron bug (not specific to this
          // app's own code — could not reproduce it against a fresh,
          // unmodified profile either): after native PiP hand-off ends,
          // the <video>'s frame submission can stay suspended while audio,
          // captions and the progress bar keep working normally — visually
          // a black rectangle where the video should be. Re-assigning
          // currentTime to itself is a no-op seek that forces Chromium to
          // submit a fresh decoded frame, the standard workaround for this
          // exact bug class. Runs on a couple of animation frames (not
          // just one) since the hand-off doesn't always finish by the very
          // next frame.
          let attempts = 0;
          const nudge = () => {
            attempts++;
            try {
              const t = ${video}.currentTime;
              ${video}.currentTime = t;
            } catch (e) {}
            if (attempts < 5) requestAnimationFrame(nudge);
          };
          requestAnimationFrame(nudge);
        }, { once: true });
      } catch (e) {}
    }
  `;
}

// x/y given (right-click "Picture-in-Picture" context menu item): finds the
// exact video under the click point first, same as before this feature
// existed. No x/y (toolbar button — no click point to go on): picks
// whichever <video> is largest/most visible on screen right now, since the
// toolbar isn't tied to a specific spot on the page.
function requestPipWithControlsScript({ x, y } = {}) {
  const pointPick = (x != null && y != null)
    ? `
      let video = null;
      const el = document.elementFromPoint(${x}, ${y});
      if (el) video = el.tagName === 'VIDEO' ? el : (el.closest ? el.closest('video') : null);
      if (!video) video = document.querySelector('video');
    `
    : `
      const videos = Array.from(document.querySelectorAll('video'));
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const visible = videos.filter((v) => {
        const r = v.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      });
      const candidates = visible.length ? visible : videos;
      let video = candidates[0] || null;
      let bestArea = 0;
      for (const v of candidates) {
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; video = v; }
      }
    `;
  return `(function() {
    ${pointPick}
    if (!video) return { ok: false, error: 'no-video' };
    if (!document.pictureInPictureEnabled || video.disablePictureInPicture) return { ok: false, error: 'not-supported' };
    ${setupMediaSessionScript('video')}
    return video.requestPictureInPicture().then(() => ({ ok: true })).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
  })();`;
}

module.exports = { requestPipWithControlsScript };
