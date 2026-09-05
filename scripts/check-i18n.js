#!/usr/bin/env node
// Two checks over src/i18n-data.js, both run by hand (see package.json) and in
// CI (test.yml).
//
// 1. CROSS-LANGUAGE PARITY. Confirms es/pt-BR/en-US carry exactly the same set
//    of keys. Nacio de un bug real encontrado a mano en la auditoria general
//    (3 bloques de claves duplicadas dentro del MISMO idioma en i18n-data.js,
//    una de ellas con contenido distinto entre las dos copias) -- ese tipo de
//    desincronizacion no se nota mirando el archivo, se nota corriendo esto.
//
// 2. KEYS THAT DON'T EXIST. Parity alone can't catch a typo'd key: t('topbar.bak')
//    is missing from all three languages equally, so it passes check 1 and then
//    renders the literal string "topbar.bak" to the user, because both t() and
//    mt() fall back to returning the key itself. That fallback is the right
//    runtime behaviour (better a raw key than a crash) and exactly why nothing
//    ever surfaced it. This walks the real call sites instead.
//
// Deliberately NOT checked: unused keys. Several call sites build a key by
// concatenation (t('layout.' + mode), t('protection.' + level)), so "nothing
// references this literal" doesn't mean "nothing uses it", and a check that
// cries wolf gets ignored.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DICTIONARIES = require(path.join(ROOT, 'src', 'i18n-data.js'));
const LANGS = Object.keys(DICTIONARIES);

const keysByLang = Object.fromEntries(LANGS.map((lang) => [lang, new Set(Object.keys(DICTIONARIES[lang]))]));
const allKeys = new Set(LANGS.flatMap((lang) => [...keysByLang[lang]]));

let hasProblems = false;

// ---- 1. parity ----
for (const key of [...allKeys].sort()) {
  const missingFrom = LANGS.filter((lang) => !keysByLang[lang].has(key));
  if (missingFrom.length) {
    hasProblems = true;
    console.error(`[i18n] "${key}" falta en: ${missingFrom.join(', ')}`);
  }
}

// ---- 2. keys referenced from code that don't exist ----
const SCANNED = [
  'electron/main.js',
  'electron/extensions-manager.js',
  'electron/permissions-manager.js',
  'electron/adblock-manager.js',
  'src/renderer.js',
  'src/screenshot-editor.js',
  'src/index.html'
];

// Only keys given as a COMPLETE literal argument. The trailing [,)] is what
// excludes a concatenated key — t('js.protection' + level), t('downloads.state'
// + state) — where the literal is a prefix and the real key is only known at
// runtime. Checking those would report a key that is correct by construction.
const PATTERNS = [
  /\bt\(\s*['"]([^'"]+)['"]\s*[,)]/g, // renderer/screenshot-editor: t('key') / t('key', vars)
  /\bmt\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*[,)]/g, // main and managers: mt(lang, 'key') / mt(lang, 'key', vars)
  /data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g // index.html: data-i18n / data-i18n-title
];

const missingKeys = new Map(); // key -> [file, ...]
for (const rel of SCANNED) {
  let code;
  try {
    code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    continue; // a scanned file was renamed/removed — not this check's problem
  }
  for (const pattern of PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const key = match[1];
      // A key ending in '.' is the literal half of a concatenation; a key with
      // no '.' at all is not one of ours (the catalog is entirely "area.name").
      if (key.endsWith('.') || !key.includes('.')) continue;
      if (allKeys.has(key)) continue;
      if (!missingKeys.has(key)) missingKeys.set(key, []);
      if (!missingKeys.get(key).includes(rel)) missingKeys.get(key).push(rel);
    }
  }
}

for (const [key, files] of [...missingKeys].sort()) {
  hasProblems = true;
  console.error(`[i18n] "${key}" se usa en ${files.join(', ')} pero no existe en el catalogo`);
}

if (hasProblems) {
  console.error(`\n[i18n] Revisa src/i18n-data.js -- cada idioma (${LANGS.join(', ')}) debe tener el mismo set de claves, y toda clave usada desde el codigo debe existir.`);
  process.exit(1);
} else {
  console.log(`[i18n] OK -- ${allKeys.size} claves, ${LANGS.length} idiomas (${LANGS.join(', ')}), todas sincronizadas y todas las claves referenciadas existen.`);
}
