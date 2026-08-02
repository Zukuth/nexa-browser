const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const market = require('../../electron/market');
const gameTelemetry = require('../../electron/game-telemetry');

describe('market helpers', () => {
  test('uses enriched itemCategory as a buy kind candidate', () => {
    const candidates = market.normalizeKindCandidates({
      kind: 'item',
      itemCategory: 'stones',
      name: 'Fire Stone'
    });

    assert.equal(candidates[0], 'stones');
    assert.ok(candidates.includes('item'));
    assert.ok(candidates.includes('Stone'));
  });

  test('keeps pokeball category candidates for ball listings', () => {
    const candidates = market.normalizeKindCandidates({
      kind: 'ball',
      name: 'Ultra Ball'
    });

    assert.ok(candidates.includes('ball'));
    assert.ok(candidates.includes('Poké Balls'));
    assert.ok(candidates.includes('Poke Balls'));
  });

  test('uses itemCategory before generic kind when categorizing listings', () => {
    const candidates = market.normalizeKindCandidates({
      kind: 'item',
      itemCategory: 'stones',
      name: 'Water Stone'
    });

    assert.equal(candidates[0], 'stones');
    assert.ok(candidates.includes('Stone'));
  });

  test('normalizes market currencies', () => {
    assert.equal(market.normalizeCurrency('DIAMONDS'), 'DIAMONDS');
    assert.equal(market.normalizeCurrency('gold'), 'GOLD');
    assert.equal(market.normalizeCurrency('$'), 'GOLD');
  });

  test('buys stack item listings with concrete item refs before synthetic stack ids', () => {
    const bodies = market.buildBuyBodies({
      id: 'st:item:46:10:GOLD',
      listingId: 'st:item:46:10:GOLD',
      marketId: 'st:item:46:10:GOLD',
      kind: 'items',
      itemId: 46,
      price: 10,
      currency: 'GOLD',
      quantity: 1
    }, 'items');

    assert.equal(bodies[0].kind, 'item');
    assert.equal(bodies[0].id, 46);
    assert.equal(bodies[0].refId, 46);
    assert.equal(bodies[0].itemId, 46);
    assert.equal(bodies[0].listingId, undefined);
    assert.equal(bodies.some((body) => body.stackKey === 'st:item:46:10:GOLD'), false);
  });

  test('keeps regular market listing ids unchanged when buying', () => {
    const bodies = market.buildBuyBodies({
      id: 'cms9z02wo0osat1moq6hydrk8',
      listingId: 'cms9z02wo0osat1moq6hydrk8',
      kind: 'pokemon',
      price: 40000,
      currency: 'GOLD',
      refId: 'cms9z02wo0osat1moq6hydrk8'
    }, 'pokemon');

    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].id, 'cms9z02wo0osat1moq6hydrk8');
    assert.equal(bodies[0].kind, 'pokemon');
  });

  test('derives pokemon rarity from quality thresholds', () => {
    assert.equal(gameTelemetry.rarityFromQuality(1.35), 'Rara');
    assert.equal(gameTelemetry.rarityFromQuality(1.7), 'Lendária');
  });

  test('keeps latest inventory quantities in game stats', () => {
    const state = {
      startTs: Date.now(),
      live: gameTelemetry.emptyLive(),
      team: []
    };
    gameTelemetry.applyFrame(state, { type: 'inventory', items: [{ itemId: 42, quantity: 7 }] });
    const stats = gameTelemetry.computeRates(state);

    assert.deepEqual(stats.inventoryItems, [{ itemId: 42, quantity: 7 }]);
  });

  test('normalizes wallet balances from game frames', () => {
    const state = {
      startTs: Date.now(),
      live: gameTelemetry.emptyLive(),
      team: []
    };
    gameTelemetry.applyFrame(state, {
      type: 'player',
      trainer: { gold: '$ 1.254.514', diamonds: '22' }
    });
    const stats = gameTelemetry.computeRates(state);

    assert.equal(stats.wallet.gold, 1254514);
    assert.equal(stats.wallet.diamonds, null);
  });

  test('does not let untrusted tiny gold frames overwrite a large real wallet', () => {
    const state = {
      startTs: Date.now(),
      live: gameTelemetry.emptyLive(),
      team: [],
      wallet: { gold: 12855302, diamonds: null, updatedAt: Date.now() }
    };
    gameTelemetry.applyFrame(state, { type: 'rare_capture', payload: { gold: '$22' } });
    const stats = gameTelemetry.computeRates(state);

    assert.equal(stats.wallet.gold, 12855302);
  });

  test('accepts diamond balances only from the Diamond Store source', () => {
    gameTelemetry.updateWallet('wallet-source-test', { diamonds: '22', diamondsSource: 'diamond-store' });
    const stats = gameTelemetry.getStats('wallet-source-test');

    assert.equal(stats.wallet.diamonds, 22);
  });

  test('ignores impossible diamond balances caused by broad DOM text', () => {
    const state = {
      startTs: Date.now(),
      live: gameTelemetry.emptyLive(),
      team: [],
      wallet: { gold: null, diamonds: 49, updatedAt: Date.now() }
    };
    gameTelemetry.applyFrame(state, { type: 'player', diamonds: '308.1B' });
    const stats = gameTelemetry.computeRates(state);

    assert.equal(stats.wallet.diamonds, 49);
  });

  test('parses compact market wallet amounts', () => {
    assert.equal(gameTelemetry.parseWalletAmount('$40.0K'), 40000);
    assert.equal(gameTelemetry.parseWalletAmount('1.254.514'), 1254514);
    assert.equal(gameTelemetry.parseWalletAmount('2,5M'), 2500000);
    assert.equal(gameTelemetry.parseWalletAmount('49 Diamonds'), 49);
  });

  // Buy path: listings without an explicit refId field (common for regular
  // market items from the API) must still produce a valid buy body rather than
  // silently failing the early-validation gate in market:buy.
  test('builds a buy body for a listing that has no refId field', () => {
    const bodies = market.buildBuyBodies({
      id: 'abc123',
      listingId: 'abc123',
      kind: 'item',
      itemId: 46,
      price: 500,
      currency: 'GOLD'
      // refId intentionally absent
    }, 'item');

    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].id, 'abc123');
    assert.equal(bodies[0].kind, 'item');
    assert.equal(bodies[0].price, 500);
  });

  test('stack listing without refId produces concrete item bodies', () => {
    const bodies = market.buildBuyBodies({
      id: 'st:item:10:50:GOLD',
      listingId: 'st:item:10:50:GOLD',
      kind: 'item',
      itemId: 10,
      price: 50,
      currency: 'GOLD'
    }, 'item');

    // Must produce at least one body with the concrete itemId, not the st: key
    assert.ok(bodies.length >= 1);
    const withItemId = bodies.find((b) => b.id === 10 || b.refId === 10);
    assert.ok(withItemId != null, 'expected a body using the concrete itemId');
  });

  test('adjustWallet correctly debits gold after a purchase', () => {
    gameTelemetry.updateWallet('buy-debit-test', { gold: 100000, goldSource: 'visual-hud' });
    gameTelemetry.adjustWallet('buy-debit-test', { currency: 'GOLD', delta: -500 });
    const stats = gameTelemetry.getStats('buy-debit-test');

    assert.equal(stats.wallet.gold, 99500);
  });

  test('adjustWallet does not go below zero', () => {
    gameTelemetry.updateWallet('buy-floor-test', { gold: 100, goldSource: 'visual-hud' });
    gameTelemetry.adjustWallet('buy-floor-test', { currency: 'GOLD', delta: -999999 });
    const stats = gameTelemetry.getStats('buy-floor-test');

    assert.equal(stats.wallet.gold, 0);
  });

  test('adjustWallet is a no-op when gold is not yet known', () => {
    // Account that has never had a wallet reading — adjusting it should not
    // invent a negative balance or crash.
    gameTelemetry.adjustWallet('buy-unknown-test', { currency: 'GOLD', delta: -500 });
    const stats = gameTelemetry.getStats('buy-unknown-test');

    assert.equal(stats && stats.wallet.gold, null);
  });
});
