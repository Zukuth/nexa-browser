const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const pf = require('../../electron/poke-formulas');

describe('typeMult / matchupFor', () => {
  test('a type pair with no explicit entry defaults to 1x (neutral)', () => {
    assert.equal(pf.typeMult('NORMAL', 'NORMAL'), 1);
  });

  test('super-effective and not-very-effective pairs match the type chart', () => {
    assert.equal(pf.typeMult('FIRE', 'GRASS'), 2);
    assert.equal(pf.typeMult('FIRE', 'WATER'), 0.5);
    assert.equal(pf.typeMult('NORMAL', 'GHOST'), 0);
  });

  test('matchupFor multiplies both defense types together before amplifying', () => {
    // FIRE vs GRASS/BUG: 2 (grass) * 2 (bug) = 4 base -> amplified.
    assert.equal(pf.matchupFor('FIRE', 'GRASS', 'BUG'), pf.amplify(4));
  });

  test('matchupFor with a single defense type (no second type) does not multiply by an extra factor', () => {
    assert.equal(pf.matchupFor('FIRE', 'GRASS', null), pf.amplify(2));
  });
});

describe('amplify — "Reinforced Hunt" curve', () => {
  test('maps every documented base multiplier to its amplified value', () => {
    assert.equal(pf.amplify(0), 0);
    assert.equal(pf.amplify(0.25), 0.17);
    assert.equal(pf.amplify(0.5), 0.33);
    assert.equal(pf.amplify(1), 1);
    assert.equal(pf.amplify(2), 2.5);
    assert.equal(pf.amplify(4), 5.5);
  });

  test('an undocumented base value (e.g. a quadruple-resist stacking to 0.125) passes through unchanged', () => {
    assert.equal(pf.amplify(0.125), 0.125);
  });
});

describe('growthStat / inferGrowth', () => {
  test('growthStat with quality=1 (or no statKey) applies no quality scaling', () => {
    const base = 50, growth = 16, level = 20;
    const noQuality = pf.growthStat(base, growth, level, null, null);
    const neutralQuality = pf.growthStat(base, growth, level, 1, 'atk');
    assert.equal(noQuality, Math.round((base + 2 * growth) * level / 100));
    assert.equal(neutralQuality, noQuality);
  });

  test('a higher quality strictly increases the resulting stat', () => {
    const low = pf.growthStat(50, 16, 30, 1.0, 'atk');
    const high = pf.growthStat(50, 16, 30, 1.5, 'atk');
    assert.ok(high > low);
  });

  test('inferGrowth recovers the exact growth value that produced an observed stat', () => {
    const base = 60, level = 25, quality = 1.2, statKey = 'spatk';
    const trueGrowth = 22;
    const observed = pf.growthStat(base, trueGrowth, level, quality, statKey);
    const result = pf.inferGrowth(base, level, quality, observed, statKey);
    assert.equal(result.exact, true);
    assert.ok(result.values.includes(trueGrowth));
  });

  test('inferGrowth falls back to the closest non-exact match when no growth 1-32 reproduces the observed stat exactly', () => {
    // An observed value far outside anything growthStat can produce for this
    // base/level/quality forces the "closest guess" branch.
    const result = pf.inferGrowth(50, 5, 1, 999999, 'atk');
    assert.equal(result.exact, false);
    assert.equal(result.values.length, 1);
    assert.ok(result.values[0] >= pf.GROWTH_MIN && result.values[0] <= pf.GROWTH_MAX);
  });
});

describe('qualityBand', () => {
  test('bands follow the documented quality thresholds', () => {
    assert.equal(pf.qualityBand(0.9).label, 'Weak');
    assert.equal(pf.qualityBand(1.0).label, 'Common');
    assert.equal(pf.qualityBand(1.05).label, 'Common');
    assert.equal(pf.qualityBand(1.1).label, 'Uncommon');
    assert.equal(pf.qualityBand(1.3).label, 'Rare');
    assert.equal(pf.qualityBand(1.5).label, 'Epic');
    assert.equal(pf.qualityBand(1.7).label, 'Legendary');
    assert.equal(pf.qualityBand(3.0).label, 'Legendary');
  });
});

describe('powerFor', () => {
  test('rounds the product of the stat sum and quality', () => {
    assert.equal(pf.powerFor(300, 1.234), Math.round(300 * 1.234));
  });
});

describe('tierScore / tierCuts / tierLabelForIndex', () => {
  test('a clan bonus strictly increases the score of an otherwise-identical stat block', () => {
    const stats = { atk: 100, spatk: 80, hp: 100, def: 70, spdef: 70, speed: 90 };
    const withoutBonus = pf.tierScore(stats, false);
    const withBonus = pf.tierScore(stats, true);
    assert.ok(withBonus > withoutBonus);
  });

  test('tierCuts splits a sorted roster into the documented percentile bands', () => {
    const cuts = pf.tierCuts(100);
    assert.deepEqual(cuts, { S: 10, A: 25, B: 45, C: 65, D: 85 });
  });

  test('tierLabelForIndex assigns S for the very top and E for anything past the D cut', () => {
    const cuts = pf.tierCuts(100);
    assert.equal(pf.tierLabelForIndex(0, cuts), 'S');
    assert.equal(pf.tierLabelForIndex(9, cuts), 'S');
    assert.equal(pf.tierLabelForIndex(10, cuts), 'A');
    assert.equal(pf.tierLabelForIndex(99, cuts), 'E');
  });
});

describe('xpPerHour / goldPerHour', () => {
  test('scale linearly with kills-per-hour and an optional boost multiplier', () => {
    assert.equal(pf.xpPerHour(50, 120), 6000);
    assert.equal(pf.xpPerHour(50, 120, 2), 12000);
    assert.equal(pf.goldPerHour(1000, 60), 60000);
    assert.equal(pf.goldPerHour(1000, 60, 1.5), 90000);
  });
});

describe('CLANS', () => {
  test('every clan has a unique id and at least one element', () => {
    const ids = pf.CLANS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const clan of pf.CLANS) {
      assert.ok(Array.isArray(clan.elements) && clan.elements.length > 0);
    }
  });
});
