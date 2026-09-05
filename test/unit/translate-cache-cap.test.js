const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const translate = require('../../electron/translate');

// Regression guard for a real unbounded-growth bug found by the 2026-09-04
// audit: translationCache had no cap, no eviction and no delete anywhere.
// Its header comment justified that with "real UI text repeats constantly",
// which is true for menu labels — but chat auto-translate (a new, unique
// chat line every 800ms poll) and the page-translate watch loop (a ticking
// gold/XP/timer counter whose replacement text node is a brand-new string
// every tick) both feed it strings that are never looked up again. An
// account left translating overnight grew the Map forever, and with
// translateMemoryPersist enabled the whole thing also got JSON.stringify'd
// synchronously at quit and read back at startup.
//
// translationCache isn't exported (nor should it be just for a test), so this
// drives the cap through the real public API: loadPersistedCache() fills it
// via the same cacheTranslation() path every other writer uses, and
// savePersistedCache() writes out exactly what the Map holds.
describe('translation cache cap', () => {
  test('loading a persisted cache larger than the cap evicts instead of growing forever', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-translate-cache-'));
    const file = path.join(dir, 'memory.json');

    const OVERSIZED = 6000; // deliberately above the 5000 cap
    const entries = {};
    for (let i = 0; i < OVERSIZED; i += 1) entries[`pt es unique-string-${i}`] = `traduccion-${i}`;
    fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), entries }), 'utf8');

    translate.loadPersistedCache(file);

    const outFile = path.join(dir, 'out.json');
    translate.savePersistedCache(outFile);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    const count = Object.keys(written.entries).length;

    assert.ok(count < OVERSIZED, `cache must not keep all ${OVERSIZED} entries, kept ${count}`);
    assert.ok(count <= 5000, `cache must stay at or under its 5000 cap, kept ${count}`);

    // Eviction is oldest-first, so the most recently inserted keys survive.
    assert.ok(
      Object.prototype.hasOwnProperty.call(written.entries, `pt es unique-string-${OVERSIZED - 1}`),
      'the newest entry must survive eviction'
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
