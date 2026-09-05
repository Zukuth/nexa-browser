const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { sellLockScript } = require('../../electron/sell-lock');

// sellLockScript returns a string that runs INSIDE the game page and
// monkey-patches window.fetch. Running it against a fake window here is the
// only way to test the actual behavior — it never executes in the main
// process, and Playwright can't reach a <webview>'s guest DOM either.
function runLock({ pokeIds = [], itemIds = [], fetchImpl }) {
  const calls = [];
  const win = {
    fetch: function (input, init) {
      calls.push({ input, init });
      return fetchImpl ? fetchImpl(input, init) : Promise.resolve({ ok: true });
    }
  };
  // The script refers to `window`, so give it one whose properties are the
  // fake object itself (that's how it behaves in a real page).
  const fn = new Function('window', sellLockScript(pokeIds, itemIds));
  fn(win);
  return { win, calls };
}

const SELL_URL = 'https://poke.idleworld.online/api/game/pokemon/sell';
const ITEM_SELL_URL = 'https://poke.idleworld.online/api/game/shop/sell';

describe('sell lock', () => {
  test('blocks a sell whose entries are all locked', async () => {
    const { win, calls } = runLock({ pokeIds: ['p1'] });
    await assert.rejects(() => win.fetch(SELL_URL, { body: JSON.stringify({ pokeIds: ['p1'] }) }));
    assert.equal(calls.length, 0, 'the real fetch must never be reached');
  });

  test('lets an unlocked sell through untouched', async () => {
    const { win, calls } = runLock({ pokeIds: ['p1'] });
    await win.fetch(SELL_URL, { body: JSON.stringify({ pokeIds: ['p2'] }) });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].init.body).pokeIds, ['p2']);
  });

  test('filters just the locked entries out of a mixed sell', async () => {
    const { win, calls } = runLock({ pokeIds: ['p1'] });
    await win.fetch(SELL_URL, { body: JSON.stringify({ pokeIds: ['p1', 'p2'] }) });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].init.body).pokeIds, ['p2'], 'only the unlocked one may be sold');
  });

  // Regression guard for a real "protective feature fails open" bug found by
  // the 2026-09-04 audit: the whole inspection was wrapped in `catch (e) {}`,
  // so if the body couldn't be parsed — a game update changing the sell
  // payload shape being the realistic trigger — the ORIGINAL, unfiltered
  // request went through and a locked Pokemon got sold, silently.
  test('blocks instead of failing open when the sell body cannot be parsed', async () => {
    const { win, calls } = runLock({ pokeIds: ['p1'] });
    await assert.rejects(() => win.fetch(SELL_URL, { body: 'not-json-anymore' }));
    assert.equal(calls.length, 0, 'an unverifiable sell must not reach the real fetch');
  });

  test('same fail-closed rule for item sells', async () => {
    const { win, calls } = runLock({ itemIds: [7] });
    await assert.rejects(() => win.fetch(ITEM_SELL_URL, { body: '{{{ broken' }));
    assert.equal(calls.length, 0);
  });

  // The other half of the rule: failing closed must NEVER block someone who
  // has nothing locked, or an unparseable body on an unrelated endpoint.
  test('an empty lock list never blocks a sell, even an unparseable one', async () => {
    const { win, calls } = runLock({ pokeIds: [], itemIds: [] });
    await win.fetch(SELL_URL, { body: 'not-json-anymore' });
    assert.equal(calls.length, 1, 'nothing is locked, so nothing may be blocked');
  });

  test('non-sell requests pass through even with an unparseable body', async () => {
    const { win, calls } = runLock({ pokeIds: ['p1'] });
    await win.fetch('https://poke.idleworld.online/api/game/state', { body: 'not-json' });
    assert.equal(calls.length, 1);
  });

  test('re-applying the lock updates the sets instead of wrapping fetch twice', async () => {
    const { win, calls } = runLock({ pokeIds: ['p1'] });
    const wrappedOnce = win.fetch;
    new Function('window', sellLockScript(['p9'], []))(win);
    assert.equal(win.fetch, wrappedOnce, 'fetch must not be wrapped a second time');

    await win.fetch(SELL_URL, { body: JSON.stringify({ pokeIds: ['p1'] }) });
    assert.equal(calls.length, 1, 'p1 is no longer locked after the update');
    await assert.rejects(() => win.fetch(SELL_URL, { body: JSON.stringify({ pokeIds: ['p9'] }) }));
  });
});
