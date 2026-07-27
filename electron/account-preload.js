const { ipcRenderer, contextBridge } = require('electron');

const ACCOUNT_ID = (() => {
  const arg = process.argv.find((a) => a.startsWith('--account-id='));
  return arg ? arg.slice('--account-id='.length) : 'default';
})();

// Injected into every account WebContentsView (and its popups, e.g. Google OAuth
// windows) to offer autofill suggestions from passwords imported in Configuración →
// Contraseñas. It never fills anything automatically — it only shows a dropdown the
// user has to click, matched strictly by page origin.

function classifyField(input) {
  const type = (input.type || '').toLowerCase();
  if (type === 'password') return 'password';
  const hint = `${input.name || ''} ${input.id || ''} ${input.autocomplete || ''}`.toLowerCase();
  if (type === 'email' || hint.includes('email') || hint.includes('user') || hint.includes('login')) return 'username';
  return null;
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) descriptor.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillFrom(input, entry) {
  const form = input.closest('form') || document;
  const userField =
    form.querySelector('input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i]') ||
    (classifyField(input) === 'username' ? input : null);
  const passField = form.querySelector('input[type="password"]');
  if (userField && entry.username) setNativeValue(userField, entry.username);
  if (passField && entry.password) setNativeValue(passField, entry.password);
  if (!passField && classifyField(input) === 'username' && entry.username) setNativeValue(input, entry.username);
  if (!userField && classifyField(input) === 'password' && entry.password) setNativeValue(input, entry.password);
}

let host = null;
let shadow = null;

function ensureHost() {
  if (host && document.body.contains(host)) return;
  host = document.createElement('div');
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .box { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#fff; color:#1a1a1a;
      border:1px solid #dadce0; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.25);
      min-width:220px; max-width:320px; overflow:hidden; }
    .row { display:flex; flex-direction:column; gap:2px; padding:9px 12px; cursor:pointer; }
    .row:hover { background:#f1f3f4; }
    .row + .row { border-top:1px solid #f0f0f0; }
    .user { font-size:13px; font-weight:600; }
    .src { font-size:11px; color:#5f6368; }
  `;
  shadow.appendChild(style);
}

let openForInput = null;

function hideDropdown() {
  if (host) host.style.display = 'none';
  openForInput = null;
}

function removeDropdown() {
  if (host && document.documentElement.contains(host)) host.remove();
  host = null;
  shadow = null;
  openForInput = null;
}

async function showDropdown(input) {
  let matches;
  try {
    matches = await ipcRenderer.invoke('autofill:query', location.origin);
  } catch {
    return;
  }
  if (!matches || matches.length === 0) return;

  ensureHost();
  const box = shadow.querySelector('.box') || document.createElement('div');
  box.className = 'box';
  // Not box.innerHTML = '' — pages with a strict Trusted Types CSP (Google's
  // sign-in pages included) block any innerHTML assignment app-wide, even
  // from an injected preload script, and silently threw here every time,
  // which is why the autofill dropdown never appeared on accounts.google.com.
  // replaceChildren() clears the same way without touching innerHTML at all.
  box.replaceChildren();
  matches.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'row';
    const user = document.createElement('div');
    user.className = 'user';
    user.textContent = entry.username || entry.name || entry.url;
    const src = document.createElement('div');
    src.className = 'src';
    src.textContent = 'Contraseña guardada';
    row.append(user, src);
    row.onmousedown = (e) => {
      e.preventDefault();
      fillFrom(input, entry);
      hideDropdown();
    };
    box.appendChild(row);
  });
  if (!shadow.contains(box)) shadow.appendChild(box);

  const rect = input.getBoundingClientRect();
  host.style.left = Math.round(rect.left) + 'px';
  host.style.top = Math.round(rect.bottom + 4) + 'px';
  host.style.display = 'block';
  openForInput = input;
}

// A single delegated mousedown listener drives everything — it's far more
// reliable than focus/blur here, since some sites' own JS re-renders their
// login inputs on focus (replacing the element), which fired blur instantly
// and closed the dropdown before the user could read it. Pressing a matched
// field (re)opens it; pressing anywhere else — except the dropdown itself,
// whose own rows handle their own mousedown — closes it.
document.addEventListener(
  'mousedown',
  (e) => {
    const target = e.target;
    if (target && target.tagName === 'INPUT' && classifyField(target)) {
      showDropdown(target);
      return;
    }
    const insideDropdown = host && host.contains(target);
    if (!insideDropdown && openForInput) hideDropdown();
  },
  true
);

window.addEventListener('scroll', hideDropdown, true);
window.addEventListener('beforeunload', removeDropdown);

// Per-account fingerprint noise — each account gets a small, deterministic
// (same every time for that account, different between accounts) amount of
// canvas/WebGL variance, so sites can't tell "these 5 accounts" apart just by
// reading back an identical canvas/GPU fingerprint. Two things keep this safe:
// what's drawn on screen is never touched (canvas noise is applied to a
// throwaway copy, only the *returned data* differs), and any failure falls
// back to the untouched original rather than breaking the page.
//
// This MUST run via contextBridge.executeInMainWorld, not as a plain preload
// IIFE: with contextIsolation on, a preload script executes in Chromium's
// isolated world, a separate JS realm from the page's main world where the
// page's own scripts (and any real fingerprinting library) actually run.
// HTMLCanvasElement.prototype etc. are not shared objects between the two
// worlds, so patching them here alone never touched what the page calls —
// verified empirically (two accounts produced byte-identical toDataURL()
// output when called from the page's own context before this fix).
// executeInMainWorld's function cannot close over outer variables, so
// everything it needs is self-contained inside it and accountId is passed
// as an explicit arg.
function installFingerprintNoise(accountId) {
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const canvasRand = mulberry32(hashSeed(accountId + ':canvas'));
  const NOISE_POINTS = 24;
  const offsets = [];
  for (let i = 0; i < NOISE_POINTS; i++) {
    const delta = Math.floor(canvasRand() * 3) - 1;
    offsets.push({ dx: Math.floor(canvasRand() * 4999), dy: Math.floor(canvasRand() * 4999), delta: delta || 1 });
  }

  function applyNoise(buf, width, height) {
    offsets.forEach(({ dx, dy, delta }) => {
      const x = dx % width;
      const y = dy % height;
      const idx = (y * width + x) * 4;
      if (idx < buf.length) buf[idx] = Math.max(0, Math.min(255, buf[idx] + delta));
    });
  }

  function noisyClone(canvas) {
    if (canvas.width < 16 || canvas.height < 16) return canvas; // skip tiny canvases (icons) — no point risking visible distortion
    try {
      const clone = document.createElement('canvas');
      clone.width = canvas.width;
      clone.height = canvas.height;
      const cctx = clone.getContext('2d');
      cctx.drawImage(canvas, 0, 0);
      const imgData = cctx.getImageData(0, 0, clone.width, clone.height);
      applyNoise(imgData.data, clone.width, clone.height);
      cctx.putImageData(imgData, 0, 0);
      return clone;
    } catch {
      return canvas; // e.g. a cross-origin-tainted canvas — leave it exactly as-is
    }
  }

  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      return origToDataURL.apply(noisyClone(this), args);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return origToBlob.apply(noisyClone(this), [callback, ...args]);
    };

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const imgData = origGetImageData.apply(this, args);
      if (this.canvas.width >= 16 && this.canvas.height >= 16) applyNoise(imgData.data, imgData.width, imgData.height);
      return imgData;
    };
  } catch {
    // if the page already froze/replaced these prototypes, just skip noise rather than throw
  }

  // GPU vendor/renderer spoofing via WebGL getParameter() was removed here —
  // it claimed a fake GPU (e.g. "AMD Radeon RX 580") while every OTHER WebGL
  // capability (extensions, getInternalformatParameter, etc.) still reported
  // the real underlying GPU, an internally-inconsistent fingerprint that is
  // itself a strong bot signal. Confirmed live: this was the direct cause of
  // Cloudflare Turnstile failing with error 600010 (and a flood of "WebGL:
  // INVALID_ENUM: getInternalformatParameter" console errors) on fresh
  // installs trying to log into poke.idleworld.online — Turnstile's own
  // challenge relies on WebGL behavior being self-consistent. The canvas
  // pixel-noise above stays: it only perturbs readback data, never touches
  // WebGL state, and never caused a Turnstile failure.
}

try {
  contextBridge.executeInMainWorld({ func: installFingerprintNoise, args: [ACCOUNT_ID] });
} catch (err) {
  console.error('[fingerprint-noise] failed to install in main world:', err);
}
