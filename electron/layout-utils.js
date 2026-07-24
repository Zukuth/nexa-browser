// Pure layout math — no Electron APIs, no side effects, safe to require from
// plain Node (including test/unit/*.test.js via `node --test`, with no app
// to launch). Kept separate from main.js specifically so this logic — the
// part that has actually had real bugs (MIN_SPLIT_FRAC not being enforced,
// free-mode tiles overlapping for 3+ panels) — can be unit-tested directly
// instead of only ever being exercised by driving the whole running app.

const GAP = 4;
const GRID_MAX_PANELS = 6;
const MIN_SPLIT_FRAC = 0.12;

// Per-account widthFrac/heightFrac (set by dragging a divider, persisted like freeRect)
// override the default equal split for columns/rows/grid layouts. Only used when
// every member of the group being sized has an explicit value — a single missing
// value (new account, or one that's never been dragged) falls back to an equal
// split for the whole group rather than a lopsided mix of explicit/implicit sizes.
function resolveFracs(list, field) {
  const n = list.length;
  if (n === 0) return [];
  const explicit = list.every((a) => typeof a[field] === 'number' && a[field] > 0);
  if (!explicit) return list.map(() => 1 / n);
  const sum = list.reduce((s, a) => s + a[field], 0);
  return list.map((a) => a[field] / sum);
}

function cellsForMode(mode, accounts, bounds) {
  if (mode === 'columns') {
    const n = accounts.length;
    const availW = bounds.width - GAP * (n - 1);
    const fracs = resolveFracs(accounts, 'widthFrac');
    let x = bounds.x;
    return accounts.map((account, i) => {
      const width = Math.floor(fracs[i] * availW);
      const rect = { x, y: bounds.y, width, height: bounds.height };
      x += width + GAP;
      return { account, rect };
    });
  }
  if (mode === 'rows') {
    const n = accounts.length;
    const availH = bounds.height - GAP * (n - 1);
    const fracs = resolveFracs(accounts, 'heightFrac');
    let y = bounds.y;
    return accounts.map((account, i) => {
      const height = Math.floor(fracs[i] * availH);
      const rect = { x: bounds.x, y, width: bounds.width, height };
      y += height + GAP;
      return { account, rect };
    });
  }
  // grid — auto-partitions to fit the account count (row-based, so a half-full
  // last row still stretches evenly across the width instead of leaving a gap),
  // capped at 6 visible panels so tiles never get too small to use. Row heights and
  // each row's column widths default to an equal split but honor per-account
  // widthFrac/heightFrac once the user drags a divider (see resolveFracs above).
  const list = accounts.slice(0, GRID_MAX_PANELS);
  const n = list.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  const rowGroups = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const itemsInRow = Math.min(cols, n - r * cols);
    rowGroups.push(list.slice(idx, idx + itemsInRow));
    idx += itemsInRow;
  }

  const availH = bounds.height - GAP * (rows - 1);
  const rowFracs = resolveFracs(rowGroups.map((row) => row[0]), 'heightFrac');

  const cells = [];
  let y = bounds.y;
  rowGroups.forEach((row, r) => {
    const rowH = Math.floor(rowFracs[r] * availH);
    const availW = bounds.width - GAP * (row.length - 1);
    const colFracs = resolveFracs(row, 'widthFrac');
    let x = bounds.x;
    row.forEach((account, c) => {
      const cellW = Math.floor(colFracs[c] * availW);
      cells.push({ account, rect: { x, y, width: cellW, height: rowH } });
      x += cellW + GAP;
    });
    y += rowH + GAP;
  });
  return cells;
}

function freeCells(accounts, bounds) {
  const n = accounts.length;
  const cols = Math.max(Math.ceil(Math.sqrt(n)), 1);
  const rows = Math.max(Math.ceil(n / cols), 1);
  // Tile size scales with how many panels need to fit — the old fixed 0.42x0.45
  // (sized for roughly a 2x2 layout) barely offset panels from each other for
  // any other count, so 3+ never-dragged accounts landed almost fully stacked
  // on top of one another instead of actually tiling.
  const tileW = 0.94 / cols;
  const tileH = 0.9 / rows;
  return accounts.map((account, i) => {
    let fr = account.freeRect;
    if (!fr || typeof fr.x !== 'number') {
      const col = i % cols;
      const row = Math.floor(i / cols);
      fr = { x: 0.03 + col * tileW, y: 0.03 + row * tileH, width: tileW * 0.92, height: tileH * 0.92 };
    }
    const width = Math.max(Math.round(fr.width * bounds.width), 220);
    const height = Math.max(Math.round(fr.height * bounds.height), 160);
    const x = Math.min(bounds.x + Math.round(fr.x * bounds.width), bounds.x + bounds.width - width);
    const y = Math.min(bounds.y + Math.round(fr.y * bounds.height), bounds.y + bounds.height - height);
    return { account, rect: { x: Math.max(x, bounds.x), y: Math.max(y, bounds.y), width, height } };
  });
}

// Clamping each value to MIN_SPLIT_FRAC and then normalizing by the new sum
// doesn't actually guarantee the minimum: e.g. [0.95, 0.05] clamps to
// [0.95, 0.12], which sums to 1.07, and dividing back down to sum 1 pushes the
// clamped one back under 0.12. This instead pins any value under the minimum
// and redistributes the rest, repeating until nothing is left under it (at
// most one pass per value, since each iteration pins at least one more).
function normalizeFracsWithMin(fracs, min) {
  const n = fracs.length;
  if (n * min >= 1) return fracs.map(() => 1 / n); // more panels than the minimum can fit — equal split is the only sane fallback
  let arr = fracs.map((f) => Math.max(f, 0));
  const initialSum = arr.reduce((s, f) => s + f, 0) || 1;
  arr = arr.map((f) => f / initialSum);

  const pinned = new Array(n).fill(false);
  for (let iter = 0; iter < n; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!pinned[i] && arr[i] < min) {
        pinned[i] = true;
        changed = true;
      }
    }
    if (!changed) break;
    const pinnedCount = pinned.filter(Boolean).length;
    const remaining = 1 - pinnedCount * min;
    const freeSum = arr.reduce((s, f, i) => (pinned[i] ? s : s + f), 0) || 1;
    arr = arr.map((f, i) => (pinned[i] ? min : (f / freeSum) * remaining));
  }
  return arr;
}

module.exports = {
  GAP,
  GRID_MAX_PANELS,
  MIN_SPLIT_FRAC,
  resolveFracs,
  cellsForMode,
  freeCells,
  normalizeFracsWithMin
};
