// On-device page translation via Bergamot (the same open-source engine
// Firefox uses for its native "Translate this page" feature). Runs entirely
// locally in a WASM worker thread — no API key, no account, no per-user
// quota, and no page text ever leaves the machine.
//
// @browsermt/bergamot-translator is ESM-only, so it's loaded via dynamic
// import() from this CommonJS module. It also hasn't been published in
// ~4 years and ships with several bugs that only surface on modern
// Node.js/Windows (ESM globals used where only CommonJS provides them, and
// a broken file:// URL-to-path conversion on Windows) — those are fixed via
// patches/@browsermt+bergamot-translator+*.patch (applied automatically by
// patch-package on every `npm install`, see package.json's postinstall).
// Confirmed working end-to-end (real model download + real translation)
// before wiring this up — see project history for the verification.
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// Bundled inside the installer (electron/bundled-models/, ~42MB — real,
// confirmed size, not an estimate) so the two most likely first uses —
// translating one of this app's Portuguese games into Spanish or English,
// its two other UI languages — are instant from the very first click
// instead of needing a live download. Directly answers a real complaint: a
// user on slow internet reported nearly a minute waiting on the first
// translation. pt->es isn't a direct model — Bergamot pivots it through
// English (confirmed live: translating pt->es downloads BOTH the pten and
// enes model sets) — so bundling just those two covers pt->en directly and
// pt->es via the same pivot, without needing every direction separately.
// Same on-disk cache the normal download path uses (see translator.js's
// patched fetch()), keyed the identical way (sha1 of the real registry
// URL) — from that cache's point of view a seeded file is indistinguishable
// from one it downloaded itself, so this needs no changes to the actual
// translation code, only to get the bytes there before the first request.
const BUNDLED_MODEL_CACHE_DIR = path.join(os.tmpdir(), 'nexa-bergamot-cache');
const BUNDLED_MODELS = [
  { url: 'https://bergamot.s3.amazonaws.com/models/pten/vocab.pten.spm', file: 'pten-vocab.spm' },
  { url: 'https://bergamot.s3.amazonaws.com/models/pten/lex.50.50.pten.s2t.bin', file: 'pten-lex.bin' },
  { url: 'https://bergamot.s3.amazonaws.com/models/pten/model.pten.intgemm.alphas.bin', file: 'pten-model.bin' },
  { url: 'https://bergamot.s3.amazonaws.com/models/enes/vocab.esen.spm', file: 'enes-vocab.spm' },
  { url: 'https://bergamot.s3.amazonaws.com/models/enes/lex.50.50.enes.s2t.bin', file: 'enes-lex.bin' },
  { url: 'https://bergamot.s3.amazonaws.com/models/enes/model.enes.intgemm.alphas.bin', file: 'enes-model.bin' }
];

// Fire-and-forget, called once at app startup. Never throws outward — a
// failed seed just means that pair falls back to a live download on first
// use, same as before bundling existed.
function seedBundledModels() {
  try {
    fs.mkdirSync(BUNDLED_MODEL_CACHE_DIR, { recursive: true });
    for (const { url, file } of BUNDLED_MODELS) {
      const cachePath = path.join(BUNDLED_MODEL_CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex'));
      if (fs.existsSync(cachePath)) continue; // already downloaded or seeded earlier
      const bundledPath = path.join(__dirname, 'bundled-models', file);
      fs.copyFileSync(bundledPath, cachePath);
    }
  } catch (err) {
    console.error('[translate] failed to seed bundled models', err);
  }
}

// Content-based language detection (franc-min, ESM-only like bergamot —
// same dynamic-import pattern) — used ONLY as a fallback when a page
// doesn't declare <html lang> at all. Deliberately never overrides a
// declared lang, even one that looks wrong: a site's own declaration is
// still more trustworthy than guessing from a sample of visible text, and
// second-guessing it risks mistranslating pages that specify an unusual
// but correct lang. franc returns ISO 639-3; Bergamot/our registry uses
// ISO 639-1, so only languages actually verified working this session (or
// obviously mappable) are listed — anything else falls through to the
// existing 'pt' default rather than guessing at a code nothing downstream
// recognizes.
const FRANC_TO_ISO1 = {
  eng: 'en', spa: 'es', por: 'pt', rus: 'ru', fra: 'fr', deu: 'de', ita: 'it',
  nld: 'nl', pol: 'pl', tur: 'tr', ukr: 'uk', ces: 'cs', ell: 'el', swe: 'sv',
  fin: 'fi', dan: 'da', ron: 'ro', hun: 'hu', bul: 'bg', ind: 'id', vie: 'vi',
  jpn: 'ja', kor: 'ko', cmn: 'zh', arb: 'ar', hin: 'hi'
};

// Confirmed live: the registry at bergamot.s3.amazonaws.com/models/index.json
// only has en<->pt, en<->es, and en<->ru pairs (checked directly — see
// project history), so a detected language OUTSIDE this set has no model
// path at all, direct or pivoted through English. detectLanguage() itself
// (via franc) recognizes dozens of languages neither this app nor Bergamot
// can actually translate — real bug hit live: a chat message franc
// detected as Swedish ('sv') made translateBatch throw
// "No model available to translate from 'sv' to 'es'", and because that
// happened mid-loop over several per-language groups in one chat-translate
// pass, the whole pass aborted and NOTHING got applied — not even the
// other groups that were perfectly translatable. Anywhere a detected
// language feeds directly into translateBatch without first going through
// <html lang> (which only ever names a language a REAL page declares, so
// it doesn't need this guard) must check this first.
const SUPPORTED_TRANSLATE_LANGUAGES = new Set(['en', 'pt', 'es', 'ru']);
function isSupportedLanguage(lang) {
  return SUPPORTED_TRANSLATE_LANGUAGES.has(lang);
}

let francFn = null;
async function loadFranc() {
  if (!francFn) {
    const mod = await import('franc-min');
    francFn = mod.franc;
  }
  return francFn;
}

// Returns a 2-letter code, or null if detection is too uncertain to trust
// (franc's own 'und' — usually not enough text, or genuinely ambiguous).
async function detectLanguage(text) {
  try {
    const franc = await loadFranc();
    const code = franc((text || '').slice(0, 2000));
    return FRANC_TO_ISO1[code] || null;
  } catch (err) {
    console.error('[translate] language detection failed', err);
    return null;
  }
}

// One translator instance per language pair, created lazily and reused —
// each instance keeps its model loaded in a worker thread, so recreating it
// per request would mean re-downloading/re-loading the model every time.
const translators = new Map();

// Each extra worker is a full second copy of the model loaded in its own
// thread — real RAM/CPU cost (~20-30MB per worker for a "tiny" model), not
// free parallelism. Capped at 2 (down from 3 — explicit user call: with
// several account webviews already rendering a real game at once, a third
// translation worker competing for the same CPU cores made things feel MORE
// saturated, not faster). Also scaled down by how many accounts are
// currently open: 1 worker once 3+ accounts are open (translation
// contending with 3+ live game renderers is exactly the scenario that
// motivated startTranslateTempEco's throttle in main.js too), 2 otherwise.
// Machines with only 1 core always get 1 worker regardless.
let openAccountCountForWorkers = 1;
function setOpenAccountCount(count) {
  openAccountCountForWorkers = Math.max(1, count || 1);
}
function currentWorkerCount() {
  const coreCap = Math.max(1, Math.min(2, os.cpus().length - 1));
  if (openAccountCountForWorkers >= 3) return 1;
  return coreCap;
}

// BatchTranslator, not LatencyOptimisedTranslator: the latter is meant for a
// single interactive query and cancels any still-pending translation as soon
// as a new one comes in (SupersededError) — exactly what happens when we
// fire off every text node on a page concurrently. BatchTranslator is the
// one built for "translate a large number of strings at once".
let BatchTranslatorClass = null;
async function loadTranslatorClass() {
  if (!BatchTranslatorClass) {
    const mod = await import('@browsermt/bergamot-translator/translator.js');
    BatchTranslatorClass = mod.BatchTranslator;
  }
  return BatchTranslatorClass;
}

function getTranslator(from, to) {
  const key = `${from}-${to}`;
  if (!translators.has(key)) {
    // Worker count is read once, at the moment this language pair's
    // translator is actually created (usually the first time it's ever
    // used) — Bergamot has no API to resize an already-running worker pool,
    // so a pair that's already loaded keeps whatever count it started with
    // even if the number of open accounts changes afterward. New pairs (or
    // this same pair after an app restart) always pick up the current
    // count.
    translators.set(key, (async () => {
      const BatchTranslator = await loadTranslatorClass();
      return new BatchTranslator({ workers: currentWorkerCount() });
    })());
  }
  return translators.get(key);
}

// Fire-and-forget: kicks off loading (downloading, if not cached yet — see
// translator.js's patched on-disk cache) a language pair's model in the
// background, so it's already warm by the time the user's first real
// translate:page call comes in. Never awaited by the caller and never
// throws outward — a failed preload just means the first real translation
// falls back to loading it on demand, same as before this existed.
function preload(from, to) {
  if (from === to) return;
  getTranslator(from, to).catch((err) => {
    console.error('[translate] preload failed', from, '->', to, err);
  });
}

// Real download progress for the very first (uncached) load of a language
// pair — confirmed live this matters: a user on slow internet reported
// nearly a minute of the translate modal just sitting there with no
// feedback while ~20MB of model files downloaded. The patched translator.js
// (patches/@browsermt+bergamot-translator+*.patch) streams each file's
// bytes and calls this global hook as they arrive; only one callback is
// active at a time since translateBatch below sets/clears it around its own
// call, which is fine in practice — model loading only ever happens once
// per pair (translators are cached, see getTranslator) and this app
// realistically only has one translation starting up at a time.
let activeDownloadProgressCallback = null;
globalThis.__nexaDownloadProgress = (url, loaded, total) => {
  if (!activeDownloadProgressCallback) return;
  activeDownloadProgressCallback({ filename: String(url).split('/').pop(), loaded, total });
};

// Translates a batch of text/HTML fragments in one language pair. Bergamot
// only speaks one pair per translator, and pivots through English by default
// if there's no direct model (e.g. es->pt goes es->en->pt automatically).
// onProgress(done, total) fires once per fragment as it resolves (including
// empty ones, counted immediately) — the only granularity Bergamot exposes;
// there's no sub-fragment/byte-level progress from the WASM worker.
// onDownloadProgress(info) fires repeatedly ONLY while a language pair's
// model is still being downloaded for the first time — never fires again
// for that pair afterward (cached to disk, see translator.js's patch).
async function translateBatch(from, to, fragments, { html = true, onProgress, onDownloadProgress } = {}) {
  if (from === to) return fragments.slice();
  activeDownloadProgressCallback = onDownloadProgress || null;
  try {
    return await translateBatchInner(from, to, fragments, { html, onProgress });
  } finally {
    activeDownloadProgressCallback = null;
  }
}

// Small, hand-verified safety net for cases the MT engine itself gets
// wrong on short, out-of-context game UI strings — confirmed live against
// baiakidle.com/jogar/ (real logged-in account, pt->es): the tiny pten
// model returns some common short Portuguese words completely unchanged
// (e.g. "inativo" stayed "inativo" instead of becoming "inactivo") rather
// than mistranslating them, and separately mistranslates recognizable
// brand/product names as if they were regular words ("Discord" ->
// "Discordación"). Both are exact-match, single-fragment fixes — safe to
// apply as a lookup because they only ever fire on a fragment matching
// EXACTLY (case-insensitive, trimmed), never partial text inside a longer
// sentence, so there's no risk of this corrupting unrelated content.
// Expand this list as more confirmed cases turn up; it's intentionally
// small rather than a guess at every possible mistranslation.
const TERM_OVERRIDES = {
  // Confirmed live against the real translator (pt->es), not guessed: each
  // entry here either came back unchanged (OOV — the model doesn't know the
  // word at all, common for gaming slang like "upar"/"farmar"), came back in
  // the wrong language entirely ("vender" -> "Sell"), or came back
  // grammatically nonsensical for a UI label ("sair" -> "Deja la licencia",
  // "resgatar" -> "Rescate" instead of the "claim reward" meaning it has in
  // every one of this app's target games). These are exactly the short,
  // context-free action verbs and status words that show up constantly on
  // game UI buttons, so getting ahead of them here avoids the same class of
  // bug "inativo" was for future translations on pages not tested yet.
  pt: {
    inativo: { es: 'inactivo', en: 'inactive' },
    ativo: { es: 'activo', en: 'active' },
    desligado: { es: 'desactivado', en: 'off' },
    indisponivel: { es: 'indisponible', en: 'unavailable' },
    esgotado: { es: 'agotado', en: 'sold out' },
    gratis: { es: 'gratis', en: 'free' },
    atualizar: { es: 'actualizar', en: 'update' },
    sair: { es: 'salir', en: 'exit' },
    comprar: { es: 'comprar', en: 'buy' },
    vender: { es: 'vender', en: 'sell' },
    trocar: { es: 'intercambiar', en: 'trade' },
    reivindicar: { es: 'reclamar', en: 'claim' },
    resgatar: { es: 'canjear', en: 'redeem' },
    coletar: { es: 'recolectar', en: 'collect' },
    equipar: { es: 'equipar', en: 'equip' },
    desequipar: { es: 'desequipar', en: 'unequip' },
    abrir: { es: 'abrir', en: 'open' },
    // Gaming slang/loanwords the formal MT model has no vocabulary for at
    // all (came back completely unchanged) — translated to the equivalent
    // slang term the Spanish-speaking gaming community actually uses,
    // rather than a literal dictionary translation nobody would recognize.
    upar: { es: 'subir de nivel', en: 'level up' },
    farmar: { es: 'farmear', en: 'farm' },
    grindar: { es: 'grindear', en: 'grind' },
    critico: { es: 'crítico', en: 'critical' },
    // Real CHAT messages (not game UI) confirmed live against
    // dragonballidle.online's actual chat panel — these are exactly the
    // words the per-message chat translator was silently skipping: franc's
    // detectLanguage() can't confidently classify most of them at all
    // (returns null — they're too short/common across languages), and
    // without a detected 'from' the chat translator had nothing to go on
    // and left them untouched. See glossaryLanguageFor below, which lets
    // matching ANY of these override entries count as its own "we know
    // this is Portuguese" signal even when franc has no opinion.
    'olá': { es: 'hola', en: 'hi' },
    oi: { es: 'hola', en: 'hi' },
    'bom dia': { es: 'buenos días', en: 'good morning' },
    'boa tarde': { es: 'buenas tardes', en: 'good afternoon' },
    'boa noite': { es: 'buenas noches', en: 'good night' },
    tchau: { es: 'chau', en: 'bye' },
    vc: { es: 'tú', en: 'you' },
    // "beleza"/"blz" (its own common abbreviation) as a standalone reply is
    // Brazilian slang for "cool"/"alright", NOT the literal noun "beauty" —
    // confirmed live the model translates the bare word literally
    // ("beleza" -> "Belleza"), which reads as nonsensical in a chat reply.
    beleza: { es: 'genial', en: 'cool' },
    blz: { es: 'genial', en: 'cool' },
    // Interjection expressing mild surprise/concern — completely OOV for
    // the model (came back unchanged).
    ixi: { es: 'uy', en: 'oh no' },
    // Common gaming-chat taunt ("cry" as an imperative, mocking someone who
    // lost/complained) — confirmed live the model garbles this
    // ("chora" -> "Llosos", not a real word).
    chora: { es: 'llora', en: 'cry' },
    // Second confirmed batch — same method (checked live, not guessed):
    // basic yes/no and a handful more came back either unchanged (OOV) or
    // outright wrong ("brigado" -> "El freno", i.e. "the brake"; "valeu" ->
    // "el Valled", a nonsense word; "nossa" -> "la nuestra", the literal
    // possessive instead of the interjection "wow").
    'não': { es: 'no', en: 'no' },
    sim: { es: 'sí', en: 'yes' },
    vlw: { es: 'gracias', en: 'thanks' },
    valeu: { es: 'gracias', en: 'thanks' },
    brigado: { es: 'gracias', en: 'thanks' },
    flw: { es: 'chau', en: 'bye' },
    // Laughter — kept as the equivalent SLANG a Spanish-speaking chat
    // actually uses, not a literal transliteration of the Portuguese
    // typing convention (repeated "k" for a hard-C laugh sound).
    kkk: { es: 'jaja', en: 'haha' },
    kkkk: { es: 'jajaja', en: 'hahaha' },
    kkkkk: { es: 'jajajaja', en: 'hahahaha' },
    rs: { es: 'jeje', en: 'haha' },
    rsrs: { es: 'jeje', en: 'haha' },
    pq: { es: 'porque', en: 'because' },
    td: { es: 'todo', en: 'everything' },
    tb: { es: 'también', en: 'also' },
    tbm: { es: 'también', en: 'also' },
    mto: { es: 'muy', en: 'very' },
    vdd: { es: 'verdad', en: 'truth' },
    nossa: { es: 'wow', en: 'wow' },
    eita: { es: 'uy', en: 'whoa' },
    poxa: { es: 'uf', en: 'ugh' },
    eae: { es: 'qué tal', en: 'hey' },
    pfv: { es: 'por favor', en: 'please' },
    // Third batch — pulled straight from a real trading-chat sample on
    // poke.idleworld.online (item offers, price haggling, thanks/greetings)
    // and checked live the same way as every entry above. "ta" is the
    // stand-out real bug here: the model didn't just leave it unchanged, it
    // returned "A O's" — a nonsense fragment with no relation to the word.
    obg: { es: 'gracias', en: 'thanks' },
    pra: { es: 'para', en: 'for' },
    agr: { es: 'ahora', en: 'now' },
    msm: { es: 'mismo', en: 'same' },
    vo: { es: 'voy', en: 'gonna' },
    ta: { es: 'ok', en: 'ok' },
    mds: { es: 'dios mío', en: 'omg' },
    pfvr: { es: 'por favor', en: 'please' },
    tmb: { es: 'también', en: 'also' },
    'td bem': { es: 'todo bien', en: 'all good' },
    dnv: { es: 'de nuevo', en: 'again' },
    glr: { es: 'gente', en: 'guys' },
    fmz: { es: 'todo bien', en: 'all good' }
  },
  // English source — this app's UI/game targets also include English pages,
  // so from=en, to=es needs the same treatment. Confirmed live the same
  // way: several of these came back as an incomplete/garbled word
  // ("unequip" -> "desequip", "redeem" -> "rediem"), the wrong part of
  // speech for a button label ("claim" -> "Reclamación" instead of the verb
  // "Reclamar"), or a literal-but-wrong sense for gaming context ("loot" ->
  // "botas", i.e. "boots" — the footwear, not "botín").
  en: {
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
  },
  // Russian source — confirmed live this is where the bundled model is
  // weakest: nearly every short isolated word came back either wrong
  // ("фармить"/"to farm" -> "La farmacia", i.e. "the pharmacy") or wrapped
  // in extra filler words a button label shouldn't have ("получить" ->
  // "Consíguelo." instead of "Reclamar"). Far more entries needed here than
  // pt/en for that reason, not because more Russian words were checked.
  ru: {
    'активно': { es: 'activo' },
    'неактивно': { es: 'inactivo' },
    'заблокировано': { es: 'bloqueado' },
    'разблокировано': { es: 'desbloqueado' },
    'обновить': { es: 'actualizar' },
    'выйти': { es: 'salir' },
    'войти': { es: 'iniciar sesión' },
    'купить': { es: 'comprar' },
    'продать': { es: 'vender' },
    'обменять': { es: 'intercambiar' },
    'получить': { es: 'reclamar' },
    'собрать': { es: 'recolectar' },
    'экипировать': { es: 'equipar' },
    'снять': { es: 'desequipar' },
    'прокачать': { es: 'subir de nivel' },
    'фармить': { es: 'farmear' },
    'гринд': { es: 'grindear' },
    'критический': { es: 'crítico' },
    'гильдия': { es: 'gremio' },
    'клан': { es: 'clan' },
    'босс': { es: 'jefe' },
    'рейд': { es: 'incursión' },
    'задание': { es: 'misión' },
    'добыча': { es: 'botín' }
  }
};
// Brand/product names the MT engine has been observed mistranslating as if
// they were ordinary words — passed through unchanged instead of sent to
// the translator at all, regardless of source/target language.
const BRAND_NAMES = new Set(['discord', 'youtube', 'facebook', 'instagram', 'twitter', 'x', 'tiktok', 'telegram', 'whatsapp', 'paypal']);

function overrideTranslation(from, to, text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (BRAND_NAMES.has(lower)) return text;
  const entry = TERM_OVERRIDES[from] && TERM_OVERRIDES[from][lower];
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
  for (const lang of Object.keys(TERM_OVERRIDES)) {
    if (TERM_OVERRIDES[lang][lower]) return lang;
  }
  return null;
}

// Generic safety net for the MT engine repeating itself ("Diario diario",
// "Comunidad comunitaria") — collapses an immediately-repeated word
// (case-insensitive) in the TRANSLATED result, but only when the ORIGINAL
// text didn't already have that same repetition (so genuinely repeated
// words in the source, e.g. "muy muy grande", are left alone).
//
// Tokenizes on whitespace and compares with toLocaleLowerCase() instead of
// a \w-based regex — confirmed live this matters: JavaScript's \w is
// ASCII-only, so it doesn't match accented Spanish letters at all
// ("Crítica" only matches as far as "Cr" before í breaks it), which meant
// this safety net silently did nothing for accented duplicates like
// "Crítica crítica" — exactly the target language this whole feature
// translates INTO.
function hasAdjacentDuplicateWord(text) {
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    if (words[i].toLocaleLowerCase() === words[i - 1].toLocaleLowerCase()) return true;
  }
  return false;
}

function collapseRepeatedWord(original, translated) {
  if (hasAdjacentDuplicateWord(original)) return translated;
  const tokens = translated.split(/(\s+)/); // keep whitespace runs as their own entries
  const out = [];
  let lastWord = null;
  for (const tok of tokens) {
    if (/^\s+$/.test(tok) || tok === '') { out.push(tok); continue; }
    if (lastWord !== null && tok.toLocaleLowerCase() === lastWord.toLocaleLowerCase()) {
      out.pop(); // drop the whitespace run we just pushed before this duplicate
      continue;
    }
    out.push(tok);
    lastWord = tok;
  }
  return out.join('');
}

// Session-lifetime, in-memory only (never persisted to disk — unlike the
// model .bin files, an arbitrary page's translated STRINGS could go stale
// if the game's own wording changes between sessions, so this is safe to
// throw away on every app restart rather than something worth caching
// permanently). Real UI text repeats constantly — the same menu label
// shows up across every panel, every tab, every account — so a plain
// text->translation lookup here means the WASM translator only ever sees
// each unique string once per (from,to) pair for the life of the app,
// no matter how many times it actually appears on screen.
const translationCache = new Map();
function cacheKey(from, to, text) {
  return `${from} ${to} ${text}`;
}

// Opt-in (default off — see data.settings.translateMemoryPersist in
// store.js) persistence for the ABOVE session cache across app restarts.
// The whole snapshot carries one savedAt timestamp rather than one per
// entry — coarser than per-string staleness, but far simpler and safe
// enough for the actual risk here: a page's wording changing between one
// app session and the next. If the whole snapshot is older than maxAgeMs
// it's discarded entirely rather than loaded, so a stale memory file never
// silently reintroduces outdated translations after the user hasn't
// opened the app in a while.
const DEFAULT_MEMORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function loadPersistedCache(filePath, maxAgeMs = DEFAULT_MEMORY_MAX_AGE_MS) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.savedAt !== 'number') return;
    if (Date.now() - raw.savedAt > maxAgeMs) return;
    for (const [key, text] of Object.entries(raw.entries)) {
      translationCache.set(key, text);
    }
  } catch (err) {
    console.error('[translate] failed to load persisted translation memory', err);
  }
}

function savePersistedCache(filePath) {
  try {
    const entries = Object.fromEntries(translationCache);
    fs.writeFileSync(filePath, JSON.stringify({ savedAt: Date.now(), entries }), 'utf8');
  } catch (err) {
    console.error('[translate] failed to save persisted translation memory', err);
  }
}

async function translateBatchInner(from, to, fragments, { html, onProgress }) {
  const translator = await getTranslator(from, to);
  const results = new Array(fragments.length);
  const total = fragments.length;
  let done = 0;
  const report = () => onProgress && onProgress(done, total);

  // First pass: resolve everything already known (cache hit, or empty/
  // whitespace-only) without touching the translator at all, and group
  // every remaining fragment by its exact text so an on-page duplicate
  // ("Casa" appearing 5 times) is only ever sent to the translator once.
  const pending = new Map(); // text -> array of fragment indices
  fragments.forEach((text, i) => {
    if (!text.trim()) { results[i] = text; done++; return; }
    const key = cacheKey(from, to, text);
    if (translationCache.has(key)) {
      results[i] = translationCache.get(key);
      done++;
      return;
    }
    const overridden = overrideTranslation(from, to, text);
    if (overridden !== null) {
      translationCache.set(key, overridden);
      results[i] = overridden;
      done++;
      return;
    }
    if (!pending.has(text)) pending.set(text, []);
    pending.get(text).push(i);
  });
  report();

  await Promise.all(
    [...pending.entries()].map(([text, indices]) =>
      translator.translate({ from, to, text, html }).then((r) => {
        const translatedText = collapseRepeatedWord(text, r.target.text);
        translationCache.set(cacheKey(from, to, text), translatedText);
        indices.forEach((i) => { results[i] = translatedText; });
        done += indices.length;
        report();
      })
    )
  );

  return results;
}

function shutdown() {
  for (const pending of translators.values()) {
    pending.then((t) => t.delete()).catch(() => {});
  }
  translators.clear();
}

// Injected into the webview's page context via executeJavaScript (main
// world — same technique used by market.js/game-socket-capture.js). Walks
// visible text nodes, stashes the originals on `window` (survives across
// separate executeJavaScript calls as long as the page doesn't navigate) so
// a later restore call can undo it, and returns the fragments to translate
// plus a guessed source language from <html lang>.
//
// Also installs a MutationObserver that keeps the page translated through
// its OWN later DOM writes — confirmed live (see project history) that a
// game updating a live counter via .textContent, or re-rendering a
// component via .innerHTML, both destroy the old text node and create a
// new one, silently orphaning whatever was translated into the old one and
// reverting that spot back to the original language with no visible error.
// Both APIs fire as MutationObserver records, so newly-appeared/changed
// text nodes get queued into __nexaPendingNodesRef here; main.js's
// translate-watch loop periodically drains that queue via
// drainPendingScript/applyPendingScript and translates it the same way,
// for as long as translateWatching has this account (see main.js).
function extractPageTextScript() {
  return `(() => {
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
    const isEligible = (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return false;
      const el = node.parentElement;
      if (!el || SKIP_TAGS.has(el.tagName)) return false;
      if (el.closest('[contenteditable="true"]')) return false;
      // Confirmed live: without this, the FPS/ping overlays this app
      // injects into every page (#nexa-fps-badge, #nexa-ping-badge — both
      // tick their text every second) get swept up by the same
      // MutationObserver that watches for real page content changing, so
      // the watch loop never stops finding "new" text to translate even on
      // a completely static page. '[id^="nexa-"]' covers those and any
      // future Nexa-injected overlay the same way.
      if (el.closest('[id^="nexa-"]')) return false;
      return true;
    };

    if (window.__nexaObserver) window.__nexaObserver.disconnect();
    window.__nexaKnownNodes = new WeakSet();
    window.__nexaTranslateOriginals = [];
    window.__nexaPendingNodesRef = [];
    window.__nexaDrainedNodesRef = [];

    // A node counts as "visible" if its element is inside the current
    // viewport right now — cheap (one getBoundingClientRect per node, no
    // layout thrash since nothing is being written yet) and lets main.js
    // translate what the user can actually see first, applying the rest
    // afterward in the background instead of making the whole page wait on
    // content currently scrolled out of view or behind a closed tab/panel.
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => isEligible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const visibleEntries = [];
    const hiddenEntries = [];
    let node;
    while ((node = walker.nextNode())) {
      const entry = { node, text: node.nodeValue };
      window.__nexaKnownNodes.add(node);
      (isVisible(node.parentElement) ? visibleEntries : hiddenEntries).push(entry);
    }

    // Tooltips (title=) and image alt text never show up in the text-node
    // walker above — they're attributes, not rendered content — so without
    // this, hovering a translated page's icons/buttons still shows the
    // original-language tooltip even after everything visible has been
    // translated. Scoped to just these two attributes (not a general
    // attribute translator) since they're the only ones that are both
    // user-facing text AND common on this app's target game UIs. Static at
    // extraction time only — unlike text nodes, attribute changes aren't
    // tracked by the MutationObserver below, so a tooltip that changes
    // AFTER translation runs won't retranslate until the next full
    // translate call. Element visibility (not the attribute) decides
    // visible vs hidden, same reasoning as text nodes above.
    const attrEligible = (el, attr) => {
      const value = el.getAttribute(attr);
      if (!value || !value.trim()) return false;
      if (SKIP_TAGS.has(el.tagName)) return false;
      if (el.closest('[id^="nexa-"]')) return false;
      return true;
    };
    document.body.querySelectorAll('[title]').forEach((el) => {
      if (!attrEligible(el, 'title')) return;
      const entry = { node: el, text: el.getAttribute('title'), attr: 'title' };
      (isVisible(el) ? visibleEntries : hiddenEntries).push(entry);
    });
    document.body.querySelectorAll('img[alt]').forEach((el) => {
      if (!attrEligible(el, 'alt')) return;
      const entry = { node: el, text: el.getAttribute('alt'), attr: 'alt' };
      (isVisible(el) ? visibleEntries : hiddenEntries).push(entry);
    });

    // Visible entries first — see performTranslate in main.js, which
    // translates/applies only the first visibleCount fragments before
    // resolving (closing the modal), then keeps going with the rest.
    window.__nexaTranslateOriginals = visibleEntries.concat(hiddenEntries);
    const fragments = window.__nexaTranslateOriginals.map((e) => e.text);
    const visibleCount = visibleEntries.length;

    // Nodes already in __nexaKnownNodes are skipped here — that covers both
    // the initial batch above (once translated, their writes shouldn't
    // re-queue themselves) and anything the watch loop already queued.
    const queue = (textNode) => {
      if (!isEligible(textNode) || window.__nexaKnownNodes.has(textNode)) return;
      window.__nexaKnownNodes.add(textNode);
      window.__nexaPendingNodesRef.push(textNode);
    };
    window.__nexaObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          queue(m.target);
        } else if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === Node.TEXT_NODE) { queue(n); return; }
            if (n.nodeType !== Node.ELEMENT_NODE) return;
            const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, {
              acceptNode: (t) => isEligible(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
            });
            let t;
            while ((t = w.nextNode())) queue(t);
          });
        }
      }
    });
    // documentElement (<html>), not document.body — confirmed live against a
    // real game (baiakidle.com) that opening a big new panel can be heavy
    // enough churn that some frameworks replace the body element itself
    // rather than mutating inside it, which would silently detach an
    // observer watching the old body reference. <html> itself is for all
    // practical purposes never replaced, so this survives that case too.
    window.__nexaObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    return {
      // No 'pt' fallback here anymore — an empty string means "not
      // declared", which main.js's translate:page handler resolves via
      // real content-based detection (see detectLanguage) before falling
      // back to 'pt' itself as the last resort.
      from: (document.documentElement.lang || '').slice(0, 2).toLowerCase(),
      fragments,
      visibleCount
    };
  })()`;
}

// startIndex lets main.js apply translations to a SLICE of
// __nexaTranslateOriginals instead of assuming translations[] always
// covers the whole thing — used to write the visible batch back the
// moment it's ready, then the off-screen batch separately once it
// finishes translating in the background (see performTranslate).
function applyTranslatedTextScript(translations, startIndex = 0) {
  return `(() => {
    const originals = window.__nexaTranslateOriginals || [];
    const translations = ${JSON.stringify(translations)};
    const startIndex = ${JSON.stringify(startIndex)};
    // Disconnect/reconnect around our own writes, same guard
    // extractPageTextScript uses at setup time. Necessary here too:
    // performTranslate now applies the visible batch and the off-screen
    // "rest" batch as two SEPARATE executeJavaScript calls (see main.js),
    // with the observer already live and watching in between them. Even
    // though every node written here is already in __nexaKnownNodes (so
    // queue() should skip it), confirmed via a flaky e2e failure that a
    // characterData mutation firing on our own write can still land in
    // __nexaPendingNodesRef under the right timing — disconnecting removes
    // the race entirely instead of relying on the known-node check alone.
    if (window.__nexaObserver) window.__nexaObserver.disconnect();
    translations.forEach((text, i) => {
      const entry = originals[startIndex + i];
      if (!entry || !entry.node.isConnected) return;
      if (entry.attr) entry.node.setAttribute(entry.attr, text);
      else entry.node.nodeValue = text;
    });
    window.__nexaTranslated = true;
    if (window.__nexaObserver) window.__nexaObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  })()`;
}

// Pulls whatever new/changed text nodes the MutationObserver queued since
// the last drain, snapshotting {node, text} pairs (the ORIGINAL, untranslated
// text) into __nexaDrainedNodesRef so applyPendingScript can both write the
// translation and restorePage can still undo it later.
function drainPendingScript() {
  return `(() => {
    const nodes = window.__nexaPendingNodesRef || [];
    window.__nexaPendingNodesRef = [];
    window.__nexaDrainedNodesRef = nodes.map((node) => ({ node, text: node.nodeValue }));
    return { fragments: window.__nexaDrainedNodesRef.map((e) => e.text) };
  })()`;
}

function applyPendingScript(translations) {
  return `(() => {
    const entries = window.__nexaDrainedNodesRef || [];
    const translations = ${JSON.stringify(translations)};
    // Same disconnect/reconnect guard as applyTranslatedTextScript — these
    // nodes are already in __nexaKnownNodes (added when they were first
    // queued, see extractPageTextScript's queue()), so writing here
    // shouldn't re-queue them, but disconnecting removes any timing-
    // dependent risk of that instead of relying on the known-node check
    // alone racing against a concurrent drain/apply cycle.
    if (window.__nexaObserver) window.__nexaObserver.disconnect();
    translations.forEach((text, i) => {
      const entry = entries[i];
      // Node may have already been replaced again by the page since this
      // batch was drained (e.g. a counter that ticks faster than the watch
      // loop runs) — isConnected guards that; the replacement node will
      // simply get queued fresh on a later mutation and caught next drain.
      if (entry && entry.node.isConnected) {
        entry.node.nodeValue = text;
        window.__nexaTranslateOriginals.push(entry);
      }
    });
    window.__nexaDrainedNodesRef = [];
    if (window.__nexaObserver) window.__nexaObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  })()`;
}

// Small floating "⏳ Traduciendo…" badge pinned near the right-clicked
// point — lets the user actually SEE the extraction → detect → translate →
// apply pipeline doing something instead of the page just sitting there
// for however long a fresh model download or a slow translateBatch call
// takes. id starts with "nexa-" like every other Nexa-injected overlay, so
// isEligible()'s own exclusion filter (see extractElementAtPointScript
// above) already keeps this from ever being picked up as translatable
// content itself.
function showSelectionLoadingScript(x, y) {
  return `(() => {
    let el = document.getElementById('nexa-selection-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nexa-selection-loading';
      el.style.cssText = 'position:fixed;z-index:2147483647;background:rgba(0,0,0,0.75);color:#fff;font:11px sans-serif;padding:3px 8px;border-radius:10px;pointer-events:none;white-space:nowrap;contain:layout paint;';
      document.body.appendChild(el);
    }
    el.textContent = '⏳ Traduciendo…';
    el.style.left = (${x} + 8) + 'px';
    el.style.top = (${y} - 24) + 'px';
    el.style.display = '';
  })()`;
}

function hideSelectionLoadingScript() {
  return `(() => {
    const el = document.getElementById('nexa-selection-loading');
    if (el) el.remove();
  })()`;
}

// Replaces the "⏳ Traduciendo…" badge with a brief result instead of just
// vanishing — confirmed live this mattered: a repeat right-click on text
// already covered by an earlier translation on this page correctly (and
// silently) does nothing per extractElementAtPointScript's own
// __nexaSelectionKnown dedup, and with the spinner just disappearing that
// looked indistinguishable from the feature being broken. Seeing
// "— ya estaba traducido" instead of nothing makes the dedup behavior
// visible instead of looking like a failure.
function finishSelectionLoadingScript(count) {
  return `(() => {
    const el = document.getElementById('nexa-selection-loading');
    if (!el) return;
    const count = ${JSON.stringify(count)};
    el.textContent = count > 0 ? ('✅ Traducido') : '— ya estaba traducido';
    setTimeout(() => { el.remove(); }, 1500);
  })()`;
}

// Same idea as showSelectionLoadingScript above but for chat auto-
// translate — a small, unobtrusive corner badge (matching the existing
// FPS/ping overlay style, see injectFpsOverlay in main.js) instead of
// something pinned to a specific point, since a chat translate pass isn't
// tied to one click. Only ever shown when there's actually new content to
// translate (see translateChatMessages in main.js, which skips calling
// this at all on an empty tick) — with chat auto-translate polling every
// 800ms, showing this on EVERY tick regardless of whether anything
// happened would just be visual noise.
function chatTranslateStatusScript(phase, count) {
  return `(() => {
    let el = document.getElementById('nexa-chat-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nexa-chat-status';
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;background:rgba(0,0,0,0.65);color:#fff;font:11px monospace;padding:3px 7px;border-radius:5px;pointer-events:none;contain:layout paint;transition:opacity 250ms ease;';
      document.body.appendChild(el);
    }
    if (window.__nexaChatStatusTimeout) { clearTimeout(window.__nexaChatStatusTimeout); window.__nexaChatStatusTimeout = null; }
    const phase = ${JSON.stringify(phase)};
    const count = ${JSON.stringify(count)};
    el.style.opacity = '1';
    if (phase === 'loading') {
      el.textContent = '🌐 Traduciendo chat…';
    } else {
      el.textContent = count > 0 ? ('✅ ' + count + ' mensaje' + (count === 1 ? '' : 's') + ' traducido' + (count === 1 ? '' : 's')) : '— nada nuevo para traducir';
      window.__nexaChatStatusTimeout = setTimeout(() => { el.style.opacity = '0'; }, 2500);
    }
  })()`;
}

// Right-click "translate this text" — a scoped, one-off translation of
// whatever the user actually clicked on, tracked in its OWN separate state
// (window.__nexaSelectionOriginals/__nexaSelectionKnown) rather than
// reusing __nexaTranslateOriginals/__nexaKnownNodes. Deliberately kept
// isolated from the full-page translate flow: extractPageTextScript resets
// and re-walks the WHOLE page unconditionally every time it runs, reading
// whatever text is CURRENTLY on the page as "the original" — if a selection
// translation shared the same tracking state, a later full-page translate
// would read the already-translated text as if it were original content
// and translate it a second time, corrupting it exactly the way repeat
// full-page translates did before that got fixed (see translateWatching in
// main.js). Keeping this on a separate WeakSet/array sidesteps that whole
// class of bug instead of trying to reconcile the two flows.
function extractElementAtPointScript(x, y) {
  return `(() => {
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
    const isEligible = (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return false;
      const el = node.parentElement;
      if (!el || SKIP_TAGS.has(el.tagName)) return false;
      if (el.closest('[contenteditable="true"]')) return false;
      if (el.closest('[id^="nexa-"]')) return false;
      return true;
    };
    const findTextNodes = (root) => {
      if (!root) return [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => isEligible(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      return nodes;
    };
    // Real bug hit live against a game with a full-screen <canvas>
    // (dragonballidle.online): document.elementFromPoint(x, y) returned the
    // canvas instead of the chat panel actually visible on top of it —
    // confirmed this isn't a narrow one-pixel miss: elementFromPoint AND a
    // nearby ring of offsets returned the canvas EVERYWHERE across the
    // whole chat message's bounding box, and elementsFromPoint at the same
    // point didn't even list the chat panel in its hit-test stack (not a
    // z-index ordering issue — the panel's position:fixed elements simply
    // never win the browser's native hit test against that canvas on this
    // page, for reasons that don't matter here). Try the fast path first
    // (exact point, then a small ring), and only pay for the slow path —
    // a manual geometric scan that ignores native hit-testing entirely —
    // when both come back empty. This makes right-click translate resilient
    // to WHATEVER a given page's rendering quirks turn out to be, not just
    // the one confirmed here.
    let nodes = findTextNodes(document.elementFromPoint(${x}, ${y}));
    if (!nodes.length) {
      const offsets = [[-6,0],[6,0],[0,-6],[0,6],[-10,-10],[10,-10],[-10,10],[10,10]];
      for (const [dx, dy] of offsets) {
        nodes = findTextNodes(document.elementFromPoint(${x} + dx, ${y} + dy));
        if (nodes.length) break;
      }
    }
    if (!nodes.length) {
      // Smallest (most specific) element whose own rendered box actually
      // contains the click point wins — checking every element's rect is
      // real cost (forces layout), but this only ever runs on a right-click,
      // never in a hot loop, so a few tens of milliseconds here is fine.
      let bestArea = Infinity;
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (${x} < r.left || ${x} > r.right || ${y} < r.top || ${y} > r.bottom) continue;
        const area = r.width * r.height;
        if (area >= bestArea) continue;
        const found = findTextNodes(el);
        if (!found.length) continue;
        bestArea = area;
        nodes = found;
      }
    }
    if (!nodes.length) return { fragments: [], from: '', startIndex: 0 };

    if (!window.__nexaSelectionKnown) window.__nexaSelectionKnown = new WeakSet();
    if (!window.__nexaSelectionOriginals) window.__nexaSelectionOriginals = [];
    const startIndex = window.__nexaSelectionOriginals.length;
    nodes.forEach((node) => {
      // Already translated by an earlier right-click on an overlapping
      // spot — skip it instead of translating it a second time.
      if (window.__nexaSelectionKnown.has(node)) return;
      window.__nexaSelectionKnown.add(node);
      window.__nexaSelectionOriginals.push({ node, text: node.nodeValue });
    });
    return {
      from: (document.documentElement.lang || '').slice(0, 2).toLowerCase(),
      fragments: window.__nexaSelectionOriginals.slice(startIndex).map((e) => e.text),
      startIndex
    };
  })()`;
}

function applySelectionTranslationScript(translations, startIndex) {
  return `(() => {
    const originals = window.__nexaSelectionOriginals || [];
    const translations = ${JSON.stringify(translations)};
    const startIndex = ${JSON.stringify(startIndex)};
    translations.forEach((text, i) => {
      const entry = originals[startIndex + i];
      if (entry && entry.node.isConnected) entry.node.nodeValue = text;
    });
  })()`;
}

// Undoes every right-click selection translation on the page at once
// (there's no per-spot undo UI — see the context menu in main.js) rather
// than tracking which specific paragraph a later right-click's "ver
// original" click refers to.
function restoreSelectionTranslationsScript() {
  return `(() => {
    const originals = window.__nexaSelectionOriginals || [];
    originals.forEach(({ node, text }) => { if (node.isConnected) node.nodeValue = text; });
    window.__nexaSelectionOriginals = [];
    window.__nexaSelectionKnown = new WeakSet();
  })()`;
}

// Chat auto-translate — a base implementation to build on, not the final
// feature (see main.js's chat-translate wiring for the "per-user language
// history" part this exists to feed). Scoped per-domain rather than a
// generic "find anything chat-shaped" heuristic: confirmed live against
// Dragon Ball Idle's real chat panel (.msgs .msg, with a .who button for
// the author and a separate .txt span for the message body — author and
// text are NEVER in the same element there) that a generic heuristic would
// have to guess at this exact separation per site anyway, so there's
// nothing generic to gain by trying. Add an entry here per game as its
// chat DOM gets confirmed the same way, rather than guessing at markup for
// sites nobody has inspected yet.
const CHAT_SITE_SELECTORS = {
  'dragonballidle.online': { message: '.msgs .msg', who: '.who', text: '.txt' },
  // Confirmed live against a real logged-in poke.idleworld.online session —
  // different markup shape than Dragon Ball Idle (.chat-from/.chat-body
  // instead of .who/.txt, and .chat-body wraps its text in a further
  // nested <span> rather than holding it directly), but textContent
  // recurses through children regardless, so the same generic extraction
  // logic works unchanged — only the selectors differ per site.
  'poke.idleworld.online': { message: '.chat-list .chat-msg', who: '.chat-from', text: '.chat-body' },
  // Lets e2e tests exercise the real extraction/translation pipeline
  // against a local fixture server that mirrors dragonballidle.online's
  // confirmed markup (see test/fixtures/dbz-chat.html) — 'localhost' is
  // never a real game domain, so this can't accidentally activate chat
  // auto-translate against an actual site by coincidence, and the feature
  // stays opt-in per account regardless (account.chatAutoTranslate).
  'localhost': { message: '.msgs .msg', who: '.who', text: '.txt' }
};

function chatSelectorsForHost(hostname) {
  return CHAT_SITE_SELECTORS[hostname] || null;
}

// Extracts whatever chat messages are currently rendered and haven't been
// picked up by a previous call (tracked via window.__nexaChatKnownTxt, a
// WeakSet keyed on the .txt element itself — a chat re-renders old
// messages out of the DOM as new ones arrive, so this only ever needs to
// remember "have I already seen this exact element", not a full history).
// Username extraction strips the clan-tag element's own text (e.g. "ALFA")
// out of the .who button's combined textContent, leaving just "PlayerName
// [90]:" — trimmed further to drop the level/colon suffix so the SAME
// player is recognized as the same key across messages even if their
// level changes between them.
function extractChatMessagesScript(selectors) {
  return `(() => {
    const sel = ${JSON.stringify(selectors)};
    if (!window.__nexaChatKnownTxt) window.__nexaChatKnownTxt = new WeakSet();
    if (!window.__nexaChatOriginals) window.__nexaChatOriginals = [];
    const startIndex = window.__nexaChatOriginals.length;
    const messages = document.querySelectorAll(sel.message);
    // Both games' chat panels can be minimized/closed via their own UI
    // (Dragon Ball Idle's collapse arrow, Poke Idle World's .chat-min)
    // WITHOUT removing the messages from the DOM — just hiding them via
    // CSS. Translating messages nobody can currently see wastes real
    // WASM/CPU work for no visible benefit, so this checks whether the
    // FIRST matched message actually has a rendered size before doing
    // anything else; if the whole panel is hidden, every message in it
    // will be zero-size too. Only the first is checked (not every
    // message) — bailing out early is the whole point here.
    if (messages.length && messages[0].getBoundingClientRect().height === 0) {
      return { items: [], startIndex, hidden: true };
    }
    const newItems = [];
    messages.forEach((msgEl) => {
      const textEl = msgEl.querySelector(sel.text);
      if (!textEl || !textEl.textContent || !textEl.textContent.trim()) return;
      if (window.__nexaChatKnownTxt.has(textEl)) return;
      window.__nexaChatKnownTxt.add(textEl);
      const whoEl = msgEl.querySelector(sel.who);
      const tagEl = whoEl ? whoEl.querySelector('.tag-nome, [class*="tag"]') : null;
      let username = whoEl ? whoEl.textContent : '';
      if (tagEl && tagEl.textContent) username = username.replace(tagEl.textContent, '');
      // Strips a trailing " [123]:" level/colon suffix so "Zukuth [90]:"
      // and a later "Zukuth [91]:" (leveled up between messages) both key
      // to the same "Zukuth".
      username = username.replace(/\\s*\\[\\d+\\]\\s*:?\\s*$/, '').trim();
      const entry = { node: textEl, text: textEl.textContent, username: username || null };
      window.__nexaChatOriginals.push(entry);
      newItems.push(entry);
    });
    return {
      items: newItems.map((e) => ({ username: e.username, text: e.text })),
      startIndex
    };
  })()`;
}

// translations here is an array of {index, text} rather than a flat array
// like applyTranslatedTextScript — chat messages are translated in
// per-detected-language GROUPS (see main.js's translateChatMessages), so
// the results don't arrive back in the same contiguous order they were
// extracted in.
function applyChatTranslationsScript(translations) {
  return `(() => {
    const originals = window.__nexaChatOriginals || [];
    const translations = ${JSON.stringify(translations)};
    translations.forEach(({ index, text }) => {
      const entry = originals[index];
      // entry.node here is the .txt ELEMENT itself (from
      // msgEl.querySelector(sel.text) in extractChatMessagesScript), not a
      // text node — unlike every other translate flow in this file, which
      // walks to actual Text nodes via a TreeWalker. Element.nodeValue is
      // always null and silently no-ops on assignment (it's only ever
      // meaningful on Text/Comment/CDATA nodes) — confirmed live this was
      // exactly why chat translate looked like it did nothing: extraction,
      // detection, and translateBatch all genuinely succeeded, but this
      // write never landed. textContent is correct for an element whose
      // real DOM shape is confirmed to be a plain <span> with no nested
      // markup (see CHAT_SITE_SELECTORS' source comment).
      if (entry && entry.node.isConnected) entry.node.textContent = text;
    });
  })()`;
}

function restorePageTextScript() {
  return `(() => {
    if (window.__nexaObserver) { window.__nexaObserver.disconnect(); window.__nexaObserver = null; }
    const originals = window.__nexaTranslateOriginals || [];
    originals.forEach(({ node, text, attr }) => {
      if (!node.isConnected) return;
      if (attr) node.setAttribute(attr, text);
      else node.nodeValue = text;
    });
    window.__nexaTranslateOriginals = [];
    window.__nexaPendingNodesRef = [];
    window.__nexaDrainedNodesRef = [];
    window.__nexaKnownNodes = new WeakSet();
    window.__nexaTranslated = false;
  })()`;
}

module.exports = {
  translateBatch,
  shutdown,
  preload,
  seedBundledModels,
  detectLanguage,
  setOpenAccountCount,
  isSupportedLanguage,
  glossaryLanguageFor,
  loadPersistedCache,
  savePersistedCache,
  showSelectionLoadingScript,
  hideSelectionLoadingScript,
  finishSelectionLoadingScript,
  chatTranslateStatusScript,
  extractElementAtPointScript,
  applySelectionTranslationScript,
  restoreSelectionTranslationsScript,
  chatSelectorsForHost,
  extractChatMessagesScript,
  applyChatTranslationsScript,
  extractPageTextScript,
  applyTranslatedTextScript,
  drainPendingScript,
  applyPendingScript,
  restorePageTextScript
};
