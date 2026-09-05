#!/usr/bin/env node
// Confirms es/pt-BR/en-US carry exactly the same set of keys. Nacio de un bug
// real encontrado a mano en la auditoria general (3 bloques de claves
// duplicadas dentro del MISMO idioma en i18n-data.js, una de ellas con
// contenido distinto entre las dos copias) -- ese tipo de desincronizacion
// no se nota mirando el archivo, se nota corriendo esto. Se corre a mano
// (ver package.json) y en CI (test.yml), asi que una clave nueva agregada
// solo a un idioma nunca vuelve a pasar desapercibida.
const path = require('path');

const DICTIONARIES = require(path.join(__dirname, '..', 'src', 'i18n-data.js'));
const LANGS = Object.keys(DICTIONARIES);

const keysByLang = Object.fromEntries(LANGS.map((lang) => [lang, new Set(Object.keys(DICTIONARIES[lang]))]));
const allKeys = new Set(LANGS.flatMap((lang) => [...keysByLang[lang]]));

let hasProblems = false;
for (const key of [...allKeys].sort()) {
  const missingFrom = LANGS.filter((lang) => !keysByLang[lang].has(key));
  if (missingFrom.length) {
    hasProblems = true;
    console.error(`[i18n] "${key}" falta en: ${missingFrom.join(', ')}`);
  }
}

if (hasProblems) {
  console.error(`\n[i18n] Revisa src/i18n-data.js -- cada idioma (${LANGS.join(', ')}) debe tener el mismo set de claves.`);
  process.exit(1);
} else {
  console.log(`[i18n] OK -- ${allKeys.size} claves, ${LANGS.length} idiomas (${LANGS.join(', ')}), todas sincronizadas.`);
}
