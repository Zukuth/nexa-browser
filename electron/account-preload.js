const { ipcRenderer } = require('electron');

// Reports Picture-in-Picture state to main (see wc.ipc.on('nexa-pip-state', ...)
// in wireAccountWebContents) so the renderer can keep this account's <webview>
// painting off-screen instead of display:none while it's not the active
// panel — a hidden guest stops compositing entirely, which would freeze or
// close the floating PiP window the moment the user switches accounts.
// Capture phase on `document` catches it regardless of which <video> in the
// page fired it, and works across the isolated-world boundary since this is
// plain DOM event dispatch, not something contextIsolation blocks.
document.addEventListener('enterpictureinpicture', () => ipcRenderer.send('nexa-pip-state', true), true);
document.addEventListener('leavepictureinpicture', () => ipcRenderer.send('nexa-pip-state', false), true);

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

// Per-account canvas/WebGL fingerprint noise was removed entirely from here.
// It monkey-patched HTMLCanvasElement.prototype.toDataURL/toBlob and
// CanvasRenderingContext2D.prototype.getImageData (plus, in an earlier
// version, WebGLRenderingContext.prototype.getParameter) in the page's own
// main world. Turnstile failed with error 600010 on fresh installs even
// after the WebGL half was removed — patched native functions no longer
// return "[native code]" from .toString(), a classic, deliberately-checked
// bot signal, so the remaining canvas patching was still enough to trip it
// on its own. Removed rather than partially reworked: this app's job is
// keeping accounts logged in reliably, not defeating a game's own anti-bot
// system — see the CHROME_UA fix in main.js for the actual root cause of
// the reported failure (a stale hardcoded Chrome version in the UA string,
// out of sync with navigator.userAgentData).
