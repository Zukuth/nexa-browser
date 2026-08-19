const DICT = {
  es: { crop: 'Recortá arrastrando, después tocá ✂ de nuevo para aplicar', arrow: 'Arrastrá para dibujar una flecha', text: 'Tocá donde querés poner el texto', save: 'Guardar', cancel: 'Cancelar' },
  pt: { crop: 'Arraste para selecionar, depois toque em ✂ de novo para aplicar', arrow: 'Arraste para desenhar uma seta', text: 'Toque onde quer colocar o texto', save: 'Salvar', cancel: 'Cancelar' },
  en: { crop: 'Drag to select, then click ✂ again to apply', arrow: 'Drag to draw an arrow', text: 'Click where you want the text', save: 'Save', cancel: 'Cancel' }
};
let lang = 'es';
const t = (k) => (DICT[lang] || DICT.es)[k] || k;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const hintEl = document.getElementById('hint');
const btnCrop = document.getElementById('tool-crop');
const btnArrow = document.getElementById('tool-arrow');
const btnText = document.getElementById('tool-text');
const btnUndo = document.getElementById('tool-undo');
const btnSave = document.getElementById('btn-save');
const btnCancel = document.getElementById('btn-cancel');

let baseImage = null; // the current flattened base (starts as the screenshot, grows as annotations are committed)
let annotations = []; // stack of {type:'arrow'|'text', ...} not yet flattened — kept so undo can pop them
let tool = null; // 'crop' | 'arrow' | 'text' | null
let dragStart = null;
let dragCurrent = null;
let pendingCropRect = null;

function setTool(next) {
  tool = tool === next ? null : next;
  pendingCropRect = null;
  [btnCrop, btnArrow, btnText].forEach((b) => b.classList.remove('active'));
  if (tool === 'crop') { btnCrop.classList.add('active'); hintEl.textContent = t('crop'); }
  else if (tool === 'arrow') { btnArrow.classList.add('active'); hintEl.textContent = t('arrow'); }
  else if (tool === 'text') { btnText.classList.add('active'); hintEl.textContent = t('text'); }
  else hintEl.textContent = '';
  redraw();
}

function redraw() {
  canvas.width = baseImage.width;
  canvas.height = baseImage.height;
  ctx.drawImage(baseImage, 0, 0);
  for (const a of annotations) drawAnnotation(a);
  if (dragStart && dragCurrent) {
    if (tool === 'crop') {
      ctx.save();
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const r = rectFrom(dragStart, dragCurrent);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (tool === 'arrow') {
      drawAnnotation({ type: 'arrow', x1: dragStart.x, y1: dragStart.y, x2: dragCurrent.x, y2: dragCurrent.y });
    }
  }
  if (pendingCropRect) {
    ctx.save();
    ctx.strokeStyle = '#39ff88';
    ctx.lineWidth = 2;
    ctx.strokeRect(pendingCropRect.x, pendingCropRect.y, pendingCropRect.w, pendingCropRect.h);
    ctx.restore();
  }
}

function rectFrom(p1, p2) {
  return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
}

function drawAnnotation(a) {
  if (a.type === 'arrow') {
    ctx.save();
    ctx.strokeStyle = '#ff5c5c';
    ctx.fillStyle = '#ff5c5c';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x1, a.y1);
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
    const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    const headLen = 14;
    ctx.beginPath();
    ctx.moveTo(a.x2, a.y2);
    ctx.lineTo(a.x2 - headLen * Math.cos(angle - Math.PI / 7), a.y2 - headLen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(a.x2 - headLen * Math.cos(angle + Math.PI / 7), a.y2 - headLen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (a.type === 'text') {
    ctx.save();
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ff5c5c';
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 4;
    ctx.strokeText(a.text, a.x, a.y);
    ctx.fillText(a.text, a.x, a.y);
    ctx.restore();
  }
}

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', (e) => {
  const p = canvasPoint(e);
  if (tool === 'crop') {
    if (pendingCropRect) {
      // Second click while a region is already marked — apply it.
      applyCrop(pendingCropRect);
      return;
    }
    dragStart = p;
    dragCurrent = p;
  } else if (tool === 'arrow') {
    dragStart = p;
    dragCurrent = p;
  } else if (tool === 'text') {
    const text = prompt(lang === 'pt' ? 'Texto:' : lang === 'en' ? 'Text:' : 'Texto:');
    if (text) {
      annotations.push({ type: 'text', x: p.x, y: p.y, text });
      redraw();
    }
  }
});
canvas.addEventListener('mousemove', (e) => {
  if (!dragStart) return;
  dragCurrent = canvasPoint(e);
  redraw();
});
window.addEventListener('mouseup', (e) => {
  if (!dragStart) return;
  const p = canvasCoordsClamped(e);
  if (tool === 'crop') {
    const r = rectFrom(dragStart, p);
    if (r.w > 4 && r.h > 4) pendingCropRect = r;
    dragStart = null;
    dragCurrent = null;
  } else if (tool === 'arrow') {
    if (Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 4) {
      annotations.push({ type: 'arrow', x1: dragStart.x, y1: dragStart.y, x2: p.x, y2: p.y });
    }
    dragStart = null;
    dragCurrent = null;
  }
  redraw();
});

function canvasCoordsClamped(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, e.clientX - rect.left)),
    y: Math.max(0, Math.min(canvas.height, e.clientY - rect.top))
  };
}

function applyCrop(r) {
  const cropped = document.createElement('canvas');
  cropped.width = Math.round(r.w);
  cropped.height = Math.round(r.h);
  // Flatten current canvas (base + annotations so far) then crop that.
  redrawWithoutOverlay();
  cropped.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    annotations = [];
    pendingCropRect = null;
    setTool(null);
  };
  img.src = cropped.toDataURL('image/png');
}

function redrawWithoutOverlay() {
  canvas.width = baseImage.width;
  canvas.height = baseImage.height;
  ctx.drawImage(baseImage, 0, 0);
  for (const a of annotations) drawAnnotation(a);
}

btnCrop.addEventListener('click', () => setTool('crop'));
btnArrow.addEventListener('click', () => setTool('arrow'));
btnText.addEventListener('click', () => setTool('text'));
btnUndo.addEventListener('click', () => {
  if (pendingCropRect) { pendingCropRect = null; }
  else annotations.pop();
  redraw();
});
btnCancel.addEventListener('click', () => window.screenshotEditorAPI.cancel());
btnSave.addEventListener('click', async () => {
  redrawWithoutOverlay();
  btnSave.disabled = true;
  // Awaiting the IPC round-trip (not a fixed delay on the main-process
  // side) is what actually guarantees the reply reached this renderer
  // before the window closes — confirmed live this raced intermittently
  // when main.js instead used a setImmediate() before closing, since that
  // only delays by one Node tick and isn't tied to the real cross-process
  // IPC delivery at all.
  const result = await window.screenshotEditorAPI.save(canvas.toDataURL('image/png'));
  if (!result || !result.ok) {
    btnSave.disabled = false;
    alert((result && result.error) || 'Error');
    return;
  }
  window.close();
});

window.screenshotEditorAPI.onImage(({ dataUrl, lang: l }) => {
  lang = l || 'es';
  btnSave.textContent = t('save');
  btnCancel.title = t('cancel');
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    redraw();
  };
  img.src = dataUrl;
});
