// @ts-check
// Los elementos existen siempre: este script solo se carga desde
// permission-prompt.html, que los define de forma estática. El helper `el()`
// convierte esa garantía implícita en uno explícita — si alguna vez alguien
// renombra un id en el HTML, esto tira un error claro en vez de un
// "Cannot set properties of null" a mitad de camino.
/** @param {string} id */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[permission-prompt] falta el elemento #${id} en permission-prompt.html`);
  return node;
}

// api lo expone electron/permission-prompt-preload.js vía contextBridge.
/** @type {{ respond: (decision: string, remember: boolean) => void }} */
const api = (/** @type {any} */ (window)).api;

const params = new URLSearchParams(location.search);
el('msg').textContent = params.get('msg') || '';
el('allow').textContent = params.get('allowLabel') || 'Permitir';
el('deny').textContent = params.get('denyLabel') || 'Bloquear';
el('rememberLabel').textContent = params.get('rememberLabel') || 'Recordar esta decisión';

const remember = () => /** @type {HTMLInputElement} */ (el('remember')).checked;

el('allow').addEventListener('click', () => api.respond('allow', remember()));
el('deny').addEventListener('click', () => api.respond('deny', remember()));
