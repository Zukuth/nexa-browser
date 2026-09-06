// Portuguese -> {es, en} term overrides. Split out of translate.js into its
// own file (2026-09-04) once this table crossed ~150 entries across 9 real
// chat captures and its own header comment ("intentionally small") stopped
// being true — one file per source language keeps each one navigable and
// makes the git history of "which batch added/changed what" easier to read
// than one growing block shared with en/ru. See electron/glossary/index.js
// for how this plugs into overrideTranslation/glossaryLanguageFor and for
// the shared BRAND_NAMES/KKK_LAUGH_RE/normalizeGlossaryKey machinery.
//
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
module.exports = {
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
  // and left them untouched. See glossaryLanguageFor in index.js, which
  // lets matching ANY of these override entries count as its own "we know
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
  // Laughter (repeated "k" for a hard-C laugh sound) used to be three
  // hardcoded entries here (kkk/kkkk/kkkkk) — replaced by KKK_LAUGH_RE
  // (see index.js), which handles ANY run length, after confirming live
  // that a length outside those three doesn't just fall through
  // untranslated: the real model actively HALLUCINATES more k's onto the
  // end ("kkkkkkkkkk", 10 k's, came back as "kkkkkkkkkkkkkkkkk", 17 k's)
  // instead of leaving it alone.
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
  fmz: { es: 'todo bien', en: 'all good' },
  // Fourth batch — standard-dictionary Portuguese words, added specifically
  // to widen glossaryOverrideWhenSameAsTarget's coverage: the reported bug
  // is franc confidently misreading real Portuguese chat text as Spanish
  // ('es', this app's usual target), which makes it look "already
  // translated" and skip forever. Chosen for having NO Spanish spelling
  // overlap at all (so an exact match here can never misfire on genuine
  // Spanish chat). Confirmed live against the real pt->es/pt->en models
  // afterward: the model already gets every one of these right on its own
  // (e.g. "obrigado" -> "gracias"/"thanks", nothing garbled) — so unlike
  // every other entry in this table, they're kept here purely for the
  // language-detection signal, not because the translation itself needs
  // correcting.
  'então': { es: 'entonces', en: 'so' },
  muito: { es: 'muy', en: 'very' },
  bom: { es: 'bueno', en: 'good' },
  boa: { es: 'buena', en: 'good' },
  onde: { es: 'dónde', en: 'where' },
  'cadê': { es: '¿dónde está?', en: 'where is' },
  // The informal spelling without the accent ("ne") used to be its own
  // duplicate entry here — now covered by NORMALIZED_PT (see index.js's
  // normalizeGlossaryKey), which strips accents before falling back to a
  // lookup, so "né" alone covers both spellings. Still only fixes a
  // message that's EXACTLY this word (like every entry here,
  // overrideTranslation matches the whole fragment, not a substring) — a
  // longer message like "espero ne mano" still goes to the real model,
  // which confirmed live can hallucinate around this word ("Espero que ne
  // zeo") rather than just leaving it be; that's a real-model quality
  // issue this table has no reach into, not something this entry covers.
  'né': { es: '¿no?', en: 'right?' },
  'aí': { es: 'ahí', en: 'there' },
  'irmão': { es: 'hermano', en: 'brother' },
  'também': { es: 'también', en: 'also' },
  adeus: { es: 'adiós', en: 'goodbye' },
  desculpa: { es: 'disculpa', en: 'sorry' },
  obrigado: { es: 'gracias', en: 'thanks' },
  obrigada: { es: 'gracias', en: 'thanks' },
  galera: { es: 'gente', en: 'folks' },
  // Fifth batch — pulled from a real chat capture the user pasted directly
  // from dragonballidle.online and poke.idleworld.online, then each
  // candidate checked live against the actual pt->es/pt->en models (not
  // guessed): "ata"/"tabom"/"ata blz"/"bora"/"nn"/"valeuu"/"rapaziada" all
  // came back completely unchanged (OOV); "nem compensa" -> "ni compensa"
  // (took "nem" too literally, lost the "not worth it" idiom); "hum" ->
  // "Húmedo"/"Humid" (read as the adjective "humid", not the filler
  // sound); "bagulho chato" -> "Salsa aburrida" ("boring sauce" — nonsense,
  // "bagulho" isn't "sauce"); "chega" -> "Llega"/"He arrives" (the literal
  // verb form, not the "enough!"/"stop it" interjection this almost always
  // is as a standalone chat reply); "pow" -> "Vaquero"/"Pow" (translated as
  // an unrelated loanword, not the BR surprise/emphasis interjection).
  // "mano" was deliberately left out despite also coming back unchanged —
  // it collides with the common Spanish word for "hand", so adding it here
  // would risk misclassifying real Spanish chat as Portuguese. "so
  // isso"/"só isso" and "que susto" were also tested and already translate
  // correctly on their own, so no override was needed for those.
  ata: { es: 'ok', en: 'ok' },
  tabom: { es: 'todo bien', en: 'ok' },
  'ata blz': { es: 'todo bien', en: 'ok, cool' },
  bora: { es: 'vamos', en: 'let\'s go' },
  nn: { es: 'no', en: 'no' },
  // "valeuu" (emphatic repeated-letter spelling of "valeu" above) used to
  // be its own duplicate entry — now covered by NORMALIZED_PT, which
  // collapses a repeated trailing letter before falling back to a lookup.
  rapaziada: { es: 'muchachos', en: 'guys' },
  'nem compensa': { es: 'no vale la pena', en: 'not worth it' },
  hum: { es: 'mmm', en: 'hmm' },
  'bagulho chato': { es: 'cosa molesta', en: 'annoying thing' },
  chega: { es: 'basta', en: 'enough' },
  pow: { es: 'uy', en: 'whoa' },
  // Sixth batch — another real chat capture the user pasted, this time
  // from a Ragnarok-style Idle chat and a second Pokémon-idle market
  // channel. Same method: every candidate checked live against the real
  // models first. "orra"/"mlq"/"aff"/"aki"/"eai"/"seloko"/"precinho"/
  // "identificou" (en)/"nemhum"/"brosinho" all came back unchanged (OOV);
  // "carai" -> "Guy Hola"/"Guy Hi" (nonsense, not the "damn!"/"wow"
  // exclamation); "identificou" -> "de la identificación" in Spanish
  // specifically (the noun, not the "¿identificaste?" question this
  // almost always is standalone). Two real bugs were confirmed live but
  // deliberately left OUT for the same reason "mano" was: "compensa"
  // (garbled to "Pagar pagos"/"Payouts") and "topado" (unchanged) are both
  // also real, legitimate Spanish words on their own ("compensa" = "it
  // compensates"/colloquial "is it worth it?"; "topado" = "bumped into",
  // from "topar") — adding either here would risk misclassifying real
  // Spanish chat as Portuguese.
  orra: { es: 'uy', en: 'whoa' },
  carai: { es: 'caramba', en: 'damn' },
  mlq: { es: 'chico', en: 'dude' },
  brabo: { es: 'increíble', en: 'awesome' },
  aff: { es: 'uf', en: 'ugh' },
  // "aki" (informal spelling of "aqui") is sometimes also how Spanish
  // speakers informally spell "aquí" — unlike every other entry in this
  // batch this one isn't fully collision-free, but even in that
  // misclassified case the ES override value ("aquí") is exactly what a
  // genuine Spanish "aki" should read as anyway, so the worst case is a
  // harmless no-op re-translation, not a wrong one.
  aki: { es: 'aquí', en: 'here' },
  eai: { es: 'qué tal', en: 'hey' },
  nemhum: { es: 'ninguno', en: 'none' },
  seloko: { es: 'qué locura', en: 'crazy' },
  precinho: { es: 'precio bajito', en: 'cheap price' },
  identificou: { es: '¿identificaste?', en: 'identified' },
  brosinho: { es: 'amigo', en: 'buddy' },
  // Seventh batch — real Tibia-like idle chat capture, same method: every
  // candidate checked live against the real pt->es model first. "krl" and
  // "poha" (vulgar intensifiers, short for "caralho"/"porra") both came
  // back completely unchanged (OOV) — kept at a comparable register in
  // Spanish rather than softened, since a faithful translation of real
  // chat means translating the informal/vulgar register too, not just the
  // polite half. "zoeira" (joking around) came back as "Zosier" — a
  // fabricated non-word, worse than leaving it alone. "funciona" (it
  // works) came back as "trabaja" (as in a job) — wrong sense; the
  // correct Spanish is the identical cognate "funciona". "vtnc" (a crude
  // brush-off, short for "vai tomar no cu") came back completely
  // unchanged. "funciona" itself was DROPPED from this table after a
  // review caught a real risk the other entries here don't have: it's
  // spelled and means the same thing in Spanish, and this table has no
  // 'es' equivalent of itself, so glossaryLanguageFor() would read a
  // genuine Spanish speaker's own "funciona" as proof of Portuguese and
  // pollute their chatUserLanguageHistory entry — corrupting THEIR later
  // messages, not just this one. Unlike "aki" (also collision-prone but
  // safe because the override value is identical to what a genuine
  // Spanish "aki" should read as anyway), a wrong 'pt' history entry has a
  // delayed, silent blast radius the aki case doesn't.
  krl: { es: 'carajo', en: 'damn' },
  poha: { es: 'mierda', en: 'damn' },
  zoeira: { es: 'broma', en: 'joking around' },
  vtnc: { es: 'vete a la mierda', en: 'get lost' },
  // Real standalone chat message ("Ja Volto Man"), not a guess at a
  // phrase — came back completely unchanged. "man" here is the same
  // English-loanword address term as "mano"/"mlq", dropped in the
  // translation the way a Spanish speaker would actually say this rather
  // than kept as a literal "hombre".
  'ja volto': { es: 'ya vuelvo', en: 'be right back' },
  // Eighth batch — real chat capture from a Ragnarok-Online-style idle
  // (ragnaidle.com.br), same method: checked live first. "naoo" (emphatic
  // repeated-letter spelling of "não" above — now covered by NORMALIZED_PT
  // instead of its own duplicate entry) and "hj" (informal "hoje") both
  // came back completely unchanged (OOV); "hj" is a real standalone
  // message in the capture ("hj a noite." from a player replying to
  // "when's the update"). "att" (common gaming abbreviation for
  // "atualização"/update, also OOV) was DROPPED after a later review:
  // "Att."/"Atte." is a common Spanish formal-message sign-off (short for
  // "Atentamente"), so — same risk as "funciona" above — a genuine
  // Spanish speaker signing off with "att" would get misread as
  // Portuguese and pollute their own chatUserLanguageHistory, not just
  // mistranslate this one message.
  hj: { es: 'hoy', en: 'today' },
  // Ninth batch — second real capture from the same ragnaidle.com.br
  // chat, after chat auto-translate was already confirmed working on
  // most of it live. "neh" (another informal spelling of "né"/"ne",
  // extra vowel) came back completely unchanged. "cabei" (dropped-"a"
  // spelling of "acabei", "I just [did X]") came back as "Me apto" — a
  // fabricated, meaningless phrase. "qnd" (common abbreviation for
  // "quando") also came back completely unchanged.
  neh: { es: '¿no?', en: 'right?' },
  cabei: { es: 'acabo', en: 'I just got' },
  qnd: { es: 'cuándo', en: 'when' },
  // Tenth batch — a real chat capture spanning several of this app's target
  // games (baiakidle.com general/market chat and a Ragnarok-style guild
  // chat with class tags), pasted by the user directly. Every candidate
  // checked live against the real pt->es model first (translate.js's own
  // translateBatch(), run standalone in plain Node with the bundled
  // models — no electron.app dependency for this, same seedBundledModels()
  // the app itself calls at startup): "vcs", "daora", "vei" and "leilao"
  // all came back completely unchanged (OOV), same as "kd" — confirmed as
  // a live, undiscovered case rather than assumed from the abbreviation's
  // resemblance to the already-covered "cadê".
  //
  // "tambem" (unaccented "também") was ALSO tested and deliberately left
  // out: the real model already returns "también" correctly on its own,
  // and glossaryLanguageFor() already recognizes it — NORMALIZED_PT (see
  // index.js) strips the accent before falling back to a lookup, so the
  // existing accented entry already covers this spelling with no new
  // entry needed, the same way "né"/"ne" and "valeu"/"valeuu" are handled.
  vcs: { es: 'ustedes', en: 'you all' },
  daora: { es: 'genial', en: 'cool' },
  // "vei" (informal address, from "velho") is the same register as
  // "mlq"/"brosinho" — kept at "amigo" rather than a literal "hombre" or
  // regional slang, same choice already made for "mlq"/"brosinho" above.
  vei: { es: 'amigo', en: 'dude' },
  leilao: { es: 'subasta', en: 'auction' },
  kd: { es: '¿dónde está?', en: 'where is' }
};
