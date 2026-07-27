// Pure Poke Idle World game-math — no Electron APIs, no side effects, safe to
// require from plain Node (mirrors layout-utils.js). Every formula here was
// extracted verbatim from the user's own reference tool (pokemon-360.web.app,
// "by-Zuku"), which the user shared as C:\Users\Zukuth\Documents\Pokemon
// 360°.html and which documents its own verification against real game data
// (Global Market listings, an external calculator, piwtools.vercel.app/hunt).
// Nothing here is a guess — it's a port, not an approximation.

// Standard type chart: TYPE_CHART[attackType][defenseType] = multiplier
// (only non-1 entries listed; missing pairs default to 1).
const TYPE_CHART = {
  NORMAL:   { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
  FIRE:     { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
  WATER:    { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
  ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
  GRASS:    { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
  ICE:      { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
  FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
  POISON:   { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
  GROUND:   { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
  FLYING:   { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
  PSYCHIC:  { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
  BUG:      { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
  ROCK:     { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
  GHOST:    { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
  DRAGON:   { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
  DARK:     { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
  STEEL:    { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
  FAIRY:    { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 }
};

function typeMult(atkType, defType) {
  const row = TYPE_CHART[atkType];
  if (!row || !(defType in row)) return 1;
  return row[defType];
}

// "Reinforced Hunt" amplification — verified against piwtools.vercel.app/hunt.
function amplify(base) {
  if (base === 0) return 0;
  if (base === 4) return 5.5;
  if (base === 2) return 2.5;
  if (base === 1) return 1;
  if (base === 0.5) return 0.33;
  if (base === 0.25) return 0.17;
  return base;
}

function matchupFor(atkType, defType1, defType2) {
  const base = typeMult(atkType, defType1) * (defType2 ? typeMult(atkType, defType2) : 1);
  return amplify(base);
}

// Confirmed in the game's own Poképedia · Combate: a wild hits ~1.8x harder
// than in a normal fight (on top of its 5x HP).
const WILD_DMG_MULT = 1.8;
function riskDmgFor(movePower, risk) {
  return (movePower != null && risk != null) ? Math.round(movePower * risk * WILD_DMG_MULT) : null;
}

// Per-stat IV ("growth" in the reference tool's own terms) ranges 1-32, not
// the official games' 0-31 — total IV range is 6-192, not 186. The Quality
// exponent is NOT flat across stats — verified by comparing against another
// external calculator until all 6 stats matched exactly.
const QUALITY_EXP = { hp: 0.95, atk: 0.80, def: 0.80, spatk: 0.80, spdef: 0.80, speed: 0.95 };
const GROWTH_MIN = 1;
const GROWTH_MAX = 32;

function growthStat(base, growth, level, quality, statKey) {
  const qFactor = quality != null && statKey ? Math.pow(quality, QUALITY_EXP[statKey]) : 1;
  return Math.round((base + 2 * growth) * level / 100 * qFactor);
}

// Reverse-solves which growth value(s) 1-32 could have produced an observed
// stat, given base/level/quality — returns every exact match (usually one,
// sometimes a couple when rounding collides).
function inferGrowth(base, level, quality, observed, statKey) {
  const matches = [];
  for (let g = GROWTH_MIN; g <= GROWTH_MAX; g++) {
    if (growthStat(base, g, level, quality, statKey) === observed) matches.push(g);
  }
  if (matches.length) return { exact: true, values: matches };
  let best = null, bestDiff = Infinity;
  for (let g = GROWTH_MIN; g <= GROWTH_MAX; g++) {
    const diff = Math.abs(growthStat(base, g, level, quality, statKey) - observed);
    if (diff < bestDiff) { bestDiff = diff; best = g; }
  }
  return { exact: false, values: [best] };
}

function powerFor(statsSum, quality) {
  return Math.round(statsSum * quality);
}

function qualityBand(q) {
  if (q < 1.0) return { label: 'Weak', cls: 'common' };
  if (q < 1.1) return { label: 'Common', cls: 'common' };
  if (q < 1.3) return { label: 'Uncommon', cls: 'uncommon' };
  if (q < 1.5) return { label: 'Rare', cls: 'rare' };
  if (q < 1.7) return { label: 'Epic', cls: 'epic' };
  return { label: 'Legendary', cls: 'legendary' };
}

// Tier List scoring — a percentile ranking of the whole roster's raw base
// stats, weighted toward offense/bulk/speed. This is the reference tool's
// OWN estimate, not an official in-game tier ("no representa un tier oficial
// del juego"), ported as-is.
const CLAN_BONUS = 1.30;
const CLANS = [
  { id: 'fire', label: 'Clan de Fuego', elements: ['FIRE'] },
  { id: 'electric', label: 'Clan de Eléctrico', elements: ['ELECTRIC'] },
  { id: 'ground_rock', label: 'Clan de Tierra/Roca', elements: ['GROUND', 'ROCK'] },
  { id: 'grass_bug', label: 'Clan de Planta/Bicho', elements: ['GRASS', 'BUG'] },
  { id: 'fighting_normal', label: 'Clan de Lucha/Normal', elements: ['FIGHTING', 'NORMAL'] },
  { id: 'steel', label: 'Clan de Acero', elements: ['STEEL'] },
  { id: 'flying_dragon', label: 'Clan de Volador/Dragón', elements: ['FLYING', 'DRAGON'] },
  { id: 'psychic_fairy', label: 'Clan de Psíquico/Hada', elements: ['PSYCHIC', 'FAIRY'] },
  { id: 'water_ice', label: 'Clan de Agua/Hielo', elements: ['WATER', 'ICE'] },
  { id: 'ghost_poison_dark', label: 'Clan de Fantasma/Veneno/Siniestro', elements: ['GHOST', 'POISON', 'DARK'] }
];

function tierScore(stats, inClan) {
  const bonus = inClan ? CLAN_BONUS : 1;
  const offense = Math.max(stats.atk * bonus, stats.spatk * bonus);
  const bulk = (stats.hp + stats.def * bonus + stats.spdef * bonus) / 3;
  return Math.round(offense * 0.40 + bulk * 0.35 + stats.speed * 0.25);
}

// Percentile cuts (S=top 10%, A=25%, B=45%, C=65%, D=85%, rest=E), applied to
// a list already sorted descending by score.
function tierCuts(sortedCount) {
  return {
    S: Math.round(sortedCount * 0.10),
    A: Math.round(sortedCount * 0.25),
    B: Math.round(sortedCount * 0.45),
    C: Math.round(sortedCount * 0.65),
    D: Math.round(sortedCount * 0.85)
  };
}

function tierLabelForIndex(index, cuts) {
  if (index < cuts.S) return 'S';
  if (index < cuts.A) return 'A';
  if (index < cuts.B) return 'B';
  if (index < cuts.C) return 'C';
  if (index < cuts.D) return 'D';
  return 'E';
}

function xpPerHour(xp, killsPerHour, boostMult = 1) {
  return xp * killsPerHour * boostMult;
}

function goldPerHour(gold, killsPerHour, boostMult = 1) {
  return gold * killsPerHour * boostMult;
}

module.exports = {
  TYPE_CHART,
  typeMult,
  amplify,
  matchupFor,
  riskDmgFor,
  QUALITY_EXP,
  GROWTH_MIN,
  GROWTH_MAX,
  growthStat,
  inferGrowth,
  powerFor,
  qualityBand,
  CLAN_BONUS,
  CLANS,
  tierScore,
  tierCuts,
  tierLabelForIndex,
  xpPerHour,
  goldPerHour
};
