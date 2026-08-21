const test = require('node:test');
const assert = require('node:assert/strict');
const translate = require('../../electron/translate');

// franc (content-based language detection) has a real, confirmed-live false
// positive: short/slangy Portuguese chat text sometimes lands confidently on
// 'es', which is also this app's usual target language. That made the
// message look "already translated" and skip forever instead of being
// flagged as mistranslated. glossaryOverrideWhenSameAsTarget lets an exact,
// curated glossary match override that specific case.
test('glossaryOverrideWhenSameAsTarget()', async (t) => {
  await t.test('overrides a from===to guess when the text is an exact Portuguese glossary match', () => {
    assert.equal(translate.glossaryOverrideWhenSameAsTarget('es', 'es', 'olá'), 'pt');
    assert.equal(translate.glossaryOverrideWhenSameAsTarget('es', 'es', 'obrigado'), 'pt');
    assert.equal(translate.glossaryOverrideWhenSameAsTarget('es', 'es', 'Não'), 'pt');
  });

  await t.test('leaves from unchanged when from already differs from to', () => {
    assert.equal(translate.glossaryOverrideWhenSameAsTarget('pt', 'es', 'olá'), 'pt');
    assert.equal(translate.glossaryOverrideWhenSameAsTarget(null, 'es', 'hello'), null);
  });

  await t.test('leaves from===to unchanged when the text has no exact glossary match', () => {
    assert.equal(translate.glossaryOverrideWhenSameAsTarget('es', 'es', 'una frase cualquiera en español'), 'es');
  });

  await t.test('does not override toward the target language itself', () => {
    // A glossary word whose OWN language equals `to` would be a no-op match
    // anyway (glossaryLanguageFor would return `to`, same as `from`) — this
    // just confirms the guard doesn't flip anything in that case.
    assert.equal(translate.glossaryOverrideWhenSameAsTarget('pt', 'pt', 'gracias'), 'pt');
  });
});
