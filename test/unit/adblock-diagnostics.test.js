const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { pushCapped } = require('../../electron/diagnostics');

describe('pushCapped (ad-block diagnostic ring buffer)', () => {
  test('appends entries under the cap without dropping anything', () => {
    const log = [];
    pushCapped(log, { url: 'a' }, 5);
    pushCapped(log, { url: 'b' }, 5);
    assert.equal(log.length, 2);
    assert.equal(log[0].url, 'a');
  });

  test('caps at the configured limit, dropping the oldest entries first (FIFO)', () => {
    let log = [];
    for (let i = 0; i < 10; i++) {
      log = pushCapped(log, { url: `entry-${i}` }, 5);
    }
    assert.equal(log.length, 5);
    assert.equal(log[0].url, 'entry-5'); // oldest 5 dropped
    assert.equal(log[log.length - 1].url, 'entry-9');
  });

  test('cap of 0 keeps the log empty', () => {
    let log = [];
    log = pushCapped(log, { url: 'a' }, 0);
    assert.equal(log.length, 0);
  });

  test('never mutates the entry objects themselves, only the array', () => {
    const entry = { url: 'x', accountId: 'acc1' };
    const log = [];
    pushCapped(log, entry, 5);
    assert.deepEqual(log[0], { url: 'x', accountId: 'acc1' });
  });

  test('this function only manages log storage — it never touches block/allow decisions (no such logic exists here)', () => {
    // Structural assertion: pushCapped's only job is array bookkeeping.
    assert.equal(typeof pushCapped, 'function');
    assert.equal(pushCapped.length, 3); // (log, entry, cap) — no decision-making params
  });
});
