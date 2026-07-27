const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  GAP,
  GRID_MAX_PANELS,
  MIN_SPLIT_FRAC,
  resolveFracs,
  cellsForMode,
  freeCells,
  normalizeFracsWithMin
} = require('../../electron/layout-utils.js');

const BOUNDS = { x: 0, y: 0, width: 1000, height: 800 };

function makeAccounts(n, extra) {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, ...(extra ? extra(i) : {}) }));
}

describe('resolveFracs', () => {
  test('returns an empty array for an empty list', () => {
    assert.deepEqual(resolveFracs([], 'widthFrac'), []);
  });

  test('splits evenly when no account has an explicit frac', () => {
    const fracs = resolveFracs(makeAccounts(4), 'widthFrac');
    assert.deepEqual(fracs, [0.25, 0.25, 0.25, 0.25]);
  });

  test('falls back to an equal split when only some accounts have an explicit frac', () => {
    const accounts = [{ widthFrac: 0.7 }, { widthFrac: 0.3 }, {}];
    const fracs = resolveFracs(accounts, 'widthFrac');
    assert.deepEqual(fracs, [1 / 3, 1 / 3, 1 / 3]);
  });

  test('ignores a zero or negative frac as not explicit', () => {
    const accounts = [{ widthFrac: 0 }, { widthFrac: 0.5 }];
    const fracs = resolveFracs(accounts, 'widthFrac');
    assert.deepEqual(fracs, [0.5, 0.5]);
  });

  test('normalizes explicit fracs that do not already sum to 1', () => {
    const accounts = [{ widthFrac: 1 }, { widthFrac: 3 }];
    const fracs = resolveFracs(accounts, 'widthFrac');
    assert.deepEqual(fracs, [0.25, 0.75]);
  });
});

describe('cellsForMode — columns', () => {
  test('splits the bounds width evenly across accounts with a GAP between each', () => {
    const accounts = makeAccounts(2);
    const cells = cellsForMode('columns', accounts, BOUNDS);
    assert.equal(cells.length, 2);
    const availW = BOUNDS.width - GAP;
    assert.equal(cells[0].rect.width, Math.floor(availW / 2));
    assert.equal(cells[0].rect.x, 0);
    assert.equal(cells[1].rect.x, cells[0].rect.width + GAP);
    cells.forEach((c) => {
      assert.equal(c.rect.y, BOUNDS.y);
      assert.equal(c.rect.height, BOUNDS.height);
    });
  });

  test('a single account fills the full width with no gap applied', () => {
    const cells = cellsForMode('columns', makeAccounts(1), BOUNDS);
    assert.equal(cells[0].rect.width, BOUNDS.width);
    assert.equal(cells[0].rect.x, BOUNDS.x);
  });

  test('honors explicit widthFrac when every account has one', () => {
    const accounts = [{ id: 'a', widthFrac: 0.75 }, { id: 'b', widthFrac: 0.25 }];
    const cells = cellsForMode('columns', accounts, BOUNDS);
    const availW = BOUNDS.width - GAP;
    assert.equal(cells[0].rect.width, Math.floor(0.75 * availW));
    assert.equal(cells[1].rect.width, Math.floor(0.25 * availW));
  });

  test('preserves account identity and order in the output', () => {
    const accounts = makeAccounts(3);
    const cells = cellsForMode('columns', accounts, BOUNDS);
    assert.deepEqual(cells.map((c) => c.account.id), ['a0', 'a1', 'a2']);
  });
});

describe('cellsForMode — rows', () => {
  test('splits the bounds height evenly across accounts with a GAP between each', () => {
    const accounts = makeAccounts(2);
    const cells = cellsForMode('rows', accounts, BOUNDS);
    const availH = BOUNDS.height - GAP;
    assert.equal(cells[0].rect.height, Math.floor(availH / 2));
    assert.equal(cells[0].rect.y, 0);
    assert.equal(cells[1].rect.y, cells[0].rect.height + GAP);
    cells.forEach((c) => {
      assert.equal(c.rect.x, BOUNDS.x);
      assert.equal(c.rect.width, BOUNDS.width);
    });
  });

  test('honors explicit heightFrac when every account has one', () => {
    const accounts = [{ id: 'a', heightFrac: 0.6 }, { id: 'b', heightFrac: 0.4 }];
    const cells = cellsForMode('rows', accounts, BOUNDS);
    const availH = BOUNDS.height - GAP;
    assert.equal(cells[0].rect.height, Math.floor(0.6 * availH));
    assert.equal(cells[1].rect.height, Math.floor(0.4 * availH));
  });
});

describe('cellsForMode — grid', () => {
  test('lays out 4 accounts as a 2x2 grid', () => {
    const cells = cellsForMode('grid', makeAccounts(4), BOUNDS);
    assert.equal(cells.length, 4);
    const rowYs = [...new Set(cells.map((c) => c.rect.y))];
    assert.equal(rowYs.length, 2);
    const colXs = [...new Set(cells.map((c) => c.rect.x))];
    assert.equal(colXs.length, 2);
  });

  test('a half-full last row stretches evenly across the width instead of leaving a gap', () => {
    // 3 accounts -> cols=ceil(sqrt(3))=2, rows=2 -> row 0 has 2, row 1 has 1
    const cells = cellsForMode('grid', makeAccounts(3), BOUNDS);
    const row1 = cells.filter((c) => c.rect.y === cells[cells.length - 1].rect.y);
    assert.equal(row1.length, 1);
    assert.equal(row1[0].rect.width, BOUNDS.width);
  });

  test('caps visible panels at GRID_MAX_PANELS even when more accounts are passed', () => {
    const cells = cellsForMode('grid', makeAccounts(GRID_MAX_PANELS + 5), BOUNDS);
    assert.equal(cells.length, GRID_MAX_PANELS);
  });

  test('no two cells overlap for an odd account count', () => {
    const cells = cellsForMode('grid', makeAccounts(5), BOUNDS);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i].rect;
        const b = cells[j].rect;
        const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
        assert.ok(!(overlapX && overlapY), `cells ${i} and ${j} overlap`);
      }
    }
  });

  test('a single account fills the entire bounds', () => {
    const cells = cellsForMode('grid', makeAccounts(1), BOUNDS);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].rect.width, BOUNDS.width);
    assert.equal(cells[0].rect.height, BOUNDS.height);
  });
});

describe('freeCells', () => {
  test('gives every account a default tiled position when none has a freeRect', () => {
    const cells = freeCells(makeAccounts(4), BOUNDS);
    assert.equal(cells.length, 4);
    cells.forEach((c) => {
      assert.ok(c.rect.width >= 220);
      assert.ok(c.rect.height >= 160);
    });
  });

  test('default tiles for 3+ never-dragged accounts do not all land on top of each other', () => {
    const cells = freeCells(makeAccounts(3), BOUNDS);
    const positions = new Set(cells.map((c) => `${c.rect.x},${c.rect.y}`));
    assert.equal(positions.size, 3);
  });

  test('respects an explicit freeRect (fractions of bounds) for an account', () => {
    const accounts = [{ id: 'a', freeRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }];
    const cells = freeCells(accounts, BOUNDS);
    assert.equal(cells[0].rect.x, BOUNDS.x + Math.round(0.1 * BOUNDS.width));
    assert.equal(cells[0].rect.y, BOUNDS.y + Math.round(0.2 * BOUNDS.height));
    assert.equal(cells[0].rect.width, Math.round(0.3 * BOUNDS.width));
    assert.equal(cells[0].rect.height, Math.round(0.4 * BOUNDS.height));
  });

  test('enforces a minimum tile size of 220x160 even for a tiny freeRect', () => {
    const accounts = [{ id: 'a', freeRect: { x: 0, y: 0, width: 0.01, height: 0.01 } }];
    const cells = freeCells(accounts, BOUNDS);
    assert.equal(cells[0].rect.width, 220);
    assert.equal(cells[0].rect.height, 160);
  });

  test('clamps a freeRect that would place the panel outside bounds back inside', () => {
    const accounts = [{ id: 'a', freeRect: { x: 1.5, y: 1.5, width: 0.5, height: 0.5 } }];
    const cells = freeCells(accounts, BOUNDS);
    const { x, y, width, height } = cells[0].rect;
    assert.ok(x + width <= BOUNDS.x + BOUNDS.width);
    assert.ok(y + height <= BOUNDS.y + BOUNDS.height);
    assert.ok(x >= BOUNDS.x);
    assert.ok(y >= BOUNDS.y);
  });

  test('an invalid freeRect (missing numeric x) falls back to the default tile position', () => {
    const accounts = [{ id: 'a', freeRect: { x: 'nope' } }];
    const cells = freeCells(accounts, BOUNDS);
    assert.equal(typeof cells[0].rect.x, 'number');
    assert.ok(Number.isFinite(cells[0].rect.x));
  });
});

describe('normalizeFracsWithMin', () => {
  test('leaves fracs that already respect the minimum untouched (already normalized)', () => {
    const result = normalizeFracsWithMin([0.5, 0.5], MIN_SPLIT_FRAC);
    assert.deepEqual(result, [0.5, 0.5]);
  });

  test('pins a value under the minimum and redistributes the rest — the naive clamp-then-normalize bug case', () => {
    // Naive clamp-then-normalize: [0.95, 0.05] -> clamp -> [0.95, 0.12] -> sum 1.07
    // -> normalize -> [0.888, 0.112], which pushes the clamped value back under 0.12.
    const result = normalizeFracsWithMin([0.95, 0.05], 0.12);
    assert.ok(result[1] >= 0.12 - 1e-9, `expected second value >= 0.12, got ${result[1]}`);
    const sum = result.reduce((s, f) => s + f, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  test('every returned value respects the minimum', () => {
    const result = normalizeFracsWithMin([0.01, 0.01, 0.01, 0.97], 0.12);
    result.forEach((f) => assert.ok(f >= 0.12 - 1e-9));
    const sum = result.reduce((s, f) => s + f, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  test('falls back to an equal split when more panels than the minimum can fit', () => {
    // 9 panels * 0.12 = 1.08 > 1, so no split can respect the minimum for all.
    const fracs = Array(9).fill(1 / 9);
    const result = normalizeFracsWithMin(fracs, 0.12);
    result.forEach((f) => assert.ok(Math.abs(f - 1 / 9) < 1e-9));
  });

  test('treats negative input fracs as zero rather than propagating them', () => {
    const result = normalizeFracsWithMin([-0.5, 1.5], 0.12);
    result.forEach((f) => assert.ok(f >= 0));
    const sum = result.reduce((s, f) => s + f, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });
});
