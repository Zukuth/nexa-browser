// @ts-check
// Glossary layer for electron/translate.js — the small, hand-verified
// exact-match safety net for cases the MT engine itself gets wrong on
// short, out-of-context game UI strings and chat slang. Split into this
// directory (2026-09-04) once the combined table crossed ~150 entries
// across 9 real chat captures and its own original header comment
// ("intentionally small") stopped being true: one file per source language
// (pt.js/en.js/ru.js) keeps each one navigable, and the shared machinery
// (this file) stays in one place instead of interleaved with the entries.
//
// Confirmed live against baiakidle.com/jogar/ (real logged-in account,
// pt->es): the tiny pten model returns some common short Portuguese words
// completely unchanged (e.g. "inativo" stayed "inativo" instead of becoming
// "inactivo") rather than mistranslating them, and separately mistranslates
// recognizable brand/product names as if they were regular words
// ("Discord" -> "Discordación"). Both are exact-match, single-fragment
// fixes — safe to apply as a lookup because they only ever fire on a
// fragment matching EXACTLY (case-insensitive, trimmed), never partial text
// inside a longer sentence, so there's no risk of this corrupting unrelated
// content. Expand pt.js/en.js/ru.js as more confirmed cases turn up.
const TERM_OVERRIDES = {
  pt: require('./pt'),
  en: require('./en'),
  ru: require('./ru')
};

// Brand/product names (plus game-specific proper nouns/event names that
// behave identically — never a "real" word to translate, just a name the MT
// engine has been observed mangling as if it were one) — passed through
// unchanged instead of sent to the translator at all, regardless of
// source/target language. 'woe' confirmed live: "War of Emperium", a named
// Ragnarok Online event, came back as "aflio" — a fabricated non-word.
const BRAND_NAMES = new Set(['discord', 'youtube', 'facebook', 'instagram', 'twitter', 'x', 'tiktok', 'telegram', 'whatsapp', 'paypal', 'woe']);

// Any run of 3+ "k"s (the Portuguese hard-C laugh spelling), regardless of
// exact length. Used to be three hardcoded pt.js entries (kkk/kkkk/kkkkk) —
// replaced by this regex after confirming live that a length outside those
// three doesn't just fall through untranslated: the real model actively
// HALLUCINATES more k's onto the end ("kkkkkkkkkk", 10 k's, came back as
// "kkkkkkkkkkkkkkkkk", 17 k's) instead of leaving it alone or genuinely
// translating it.
const KKK_LAUGH_RE = /^k{3,}$/i;

// Generalizes informal spelling variants of an already-covered PT word —
// dropped accents ("né"->"ne") and an emphatic repeated trailing letter
// ("naoo"->"não", "valeuu"->"valeu") — the same class of problem
// KKK_LAUGH_RE was added to solve for laughs, applied here to the rest of
// pt.js instead of hand-adding one entry per spelling. Built once at module
// load into a normalized-key -> entry map so a lookup miss on the exact
// table only costs one extra Map.get, not a full rescan.
function normalizeGlossaryKey(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(.)\1+$/, '$1');
}
const NORMALIZED_PT = (() => {
  const map = new Map();
  for (const key of Object.keys(TERM_OVERRIDES.pt)) {
    const norm = normalizeGlossaryKey(key);
    if (!map.has(norm)) map.set(norm, TERM_OVERRIDES.pt[key]);
  }
  return map;
})();

function overrideTranslation(from, to, text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (BRAND_NAMES.has(lower)) return text;
  // Routed through the SAME entry lookup as every dictionary word below
  // (not an early return with its own bare-string result) so a laugh run
  // gets the same capitalization/whitespace preservation as everything
  // else — confirmed live this was lost with an early return: " Kkkkk\n"
  // came back as a flat lowercase "jajaja" with the surrounding whitespace
  // and the emphasis capitalization both dropped.
  const entry = (from === 'pt' && KKK_LAUGH_RE.test(lower))
    ? { es: 'jajaja', en: 'hahaha' }
    : (TERM_OVERRIDES[from] && TERM_OVERRIDES[from][lower])
      || (from === 'pt' && NORMALIZED_PT.get(normalizeGlossaryKey(lower)));
  if (entry && entry[to]) {
    // Preserve the original fragment's leading/trailing whitespace and
    // capitalization style so the override doesn't visibly clash with
    // surrounding untouched text.
    const replacement = trimmed[0] === trimmed[0].toUpperCase()
      ? entry[to][0].toUpperCase() + entry[to].slice(1)
      : entry[to];
    return text.replace(trimmed, replacement);
  }
  return null;
}

// Lets an exact glossary match stand in for real language detection when
// franc has no opinion at all (returns null on short/common-across-
// languages text — confirmed live this is most of a typical chat: "olá",
// "vc", "blz", "boa noite" all came back undetected). A message being
// EXACTLY one of these curated words is much stronger evidence than a
// guess — this table only ever contains hand-verified single
// words/short phrases, so a false match here is effectively impossible,
// unlike trusting an uncertain franc guess. Only meant for the "we have
// nothing else to go on" case; real detection or an already-established
// per-user history (see main.js's chatUserLanguageHistory) should always
// be tried first.
function glossaryLanguageFor(text) {
  const lower = text.trim().toLowerCase();
  if (KKK_LAUGH_RE.test(lower)) return 'pt';
  for (const lang of Object.keys(TERM_OVERRIDES)) {
    if (TERM_OVERRIDES[lang][lower]) return lang;
  }
  if (NORMALIZED_PT.has(normalizeGlossaryKey(lower))) return 'pt';
  return null;
}

// franc's real false-positive case (confirmed live, e.g. "Onde que vai pora
// breedar?" detected as 'es'): a WRONG but confident guess that happens to
// equal the target language is indistinguishable, on its own, from a message
// that's genuinely already in the target language — so it gets skipped as
// "already translated" instead of flagged as mistranslated. glossaryLanguageFor
// was only ever consulted when franc had NO opinion (returned null); a
// confident-but-wrong 'to' guess never reached it. An exact glossary match is
// curated, hand-verified, single-word/short-phrase evidence — stronger than
// franc's guess — so it's allowed to override a from===to result too, not
// just fill in for a null one.
function glossaryOverrideWhenSameAsTarget(from, to, text) {
  if (from !== to) return from;
  const glossaryGuess = glossaryLanguageFor(text);
  return (glossaryGuess && glossaryGuess !== to) ? glossaryGuess : from;
}

module.exports = {
  TERM_OVERRIDES,
  BRAND_NAMES,
  overrideTranslation,
  glossaryLanguageFor,
  glossaryOverrideWhenSameAsTarget
};
