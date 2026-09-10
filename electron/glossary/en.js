// @ts-check
// English -> {es} term overrides. Split out of translate.js's TERM_OVERRIDES
// into its own file (2026-09-04) — see electron/glossary/pt.js for why, and
// electron/glossary/index.js for how this plugs back in.
//
// This app's UI/game targets also include English pages, so from=en, to=es
// needs the same treatment as pt. Confirmed live the same way: several of
// these came back as an incomplete/garbled word ("unequip" -> "desequip",
// "redeem" -> "rediem"), the wrong part of speech for a button label
// ("claim" -> "Reclamación" instead of the verb "Reclamar"), or a
// literal-but-wrong sense for gaming context ("loot" -> "botas", i.e.
// "boots" — the footwear, not "botín").
module.exports = {
  claim: { es: 'reclamar' },
  redeem: { es: 'canjear' },
  unequip: { es: 'desequipar' },
  upgrade: { es: 'mejorar' },
  unlock: { es: 'desbloquear' },
  locked: { es: 'bloqueado' },
  'sold out': { es: 'agotado' },
  grind: { es: 'grindear' },
  farm: { es: 'farmear' },
  loot: { es: 'botín' },
  quest: { es: 'misión' },
  raid: { es: 'incursión' },
  'log out': { es: 'cerrar sesión' },
  'sign in': { es: 'iniciar sesión' },
  'rank up': { es: 'subir de rango' }
};
