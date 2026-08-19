// uBlock Origin's signature "point at an element, it disappears" picker —
// click-to-hide instead of the engine only ever acting on pre-existing
// filter list rules. Runs entirely inside the page (webview guest) context
// via wc.executeJavaScript(script, true) — the `true` second argument is
// what makes the click that follows carry real user-activation, same
// requirement documented in pip-player.js for requestPictureInPicture().
//
// Generates real Adblock Plus/uBlock Origin cosmetic filter syntax
// (`hostname##selector`) so the resulting rule is portable and inspectable
// in the "Reglas personalizadas" dashboard textarea — not a proprietary
// format only this app understands.
function elementPickerScript(hintText) {
  const hint = JSON.stringify(hintText || 'Haz clic en el elemento que querés bloquear (Esc para cancelar)');
  return `(function() {
    return new Promise((resolve) => {
      if (window.__nexaPickerActive) { resolve({ ok: false, cancelled: true }); return; }
      window.__nexaPickerActive = true;

      const highlight = document.createElement('div');
      highlight.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' +
        'border:2px solid #ff3b6f;background:rgba(255,59,111,0.15);' +
        'box-sizing:border-box;transition:all 0.05s linear;display:none;';
      document.documentElement.appendChild(highlight);

      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
        'z-index:2147483647;background:#1b1e2b;color:#fff;padding:8px 16px;border-radius:8px;' +
        'font:13px -apple-system,Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
        'pointer-events:none;';
      banner.textContent = ${hint};
      document.documentElement.appendChild(banner);

      function isOwnNode(el) {
        return el === highlight || el === banner;
      }

      function elementAt(x, y) {
        const el = document.elementFromPoint(x, y);
        return el && !isOwnNode(el) ? el : null;
      }

      function updateHighlight(el) {
        if (!el) { highlight.style.display = 'none'; return; }
        const r = el.getBoundingClientRect();
        highlight.style.display = 'block';
        highlight.style.left = r.left + 'px';
        highlight.style.top = r.top + 'px';
        highlight.style.width = r.width + 'px';
        highlight.style.height = r.height + 'px';
      }

      // Prefers a stable id; falls back to a short class-based selector,
      // skipping classes that look framework-generated (css-in-JS hashes,
      // styled-components' sc-*, etc.) since those change on every build and
      // would make the saved rule stop matching after the site's next
      // deploy; last resort is a positional nth-child selector.
      function cssSelectorFor(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        const skip = /^(css-|sc-|jsx-|emotion-)|^[a-f0-9]{6,}$/i;
        const classes = Array.from(el.classList || []).filter((c) => c && !skip.test(c));
        const tag = el.tagName.toLowerCase();
        if (classes.length > 0) {
          return tag + '.' + classes.slice(0, 2).map((c) => CSS.escape(c)).join('.');
        }
        const parent = el.parentElement;
        if (!parent) return tag;
        const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        const idx = siblings.indexOf(el) + 1;
        return parent.tagName.toLowerCase() + ' > ' + tag + ':nth-of-type(' + idx + ')';
      }

      function cleanup() {
        window.__nexaPickerActive = false;
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        highlight.remove();
        banner.remove();
      }

      function onMouseMove(e) {
        updateHighlight(elementAt(e.clientX, e.clientY));
      }

      function onClick(e) {
        const el = elementAt(e.clientX, e.clientY);
        e.preventDefault();
        e.stopPropagation();
        if (!el) { cleanup(); resolve({ ok: false, cancelled: true }); return; }
        const selector = cssSelectorFor(el);
        el.style.setProperty('display', 'none', 'important');
        const tag = el.tagName.toLowerCase();
        cleanup();
        resolve({ ok: true, selector, tag });
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          resolve({ ok: false, cancelled: true });
        }
      }

      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
    });
  })();`;
}

module.exports = { elementPickerScript };
