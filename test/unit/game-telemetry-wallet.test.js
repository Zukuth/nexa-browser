const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const gameTelemetry = require('../../electron/game-telemetry');

describe('game-telemetry wallet/inventory helpers', () => {
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
});
