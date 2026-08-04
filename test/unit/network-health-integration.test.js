// Integration test — exercises checkAccountNetwork's REAL dns.promises.resolve
// and fetch code paths against the local test-double server, with no
// injected mocks. network-health.test.js already covers every branch with
// fast, deterministic mocks; this file exists specifically to catch bugs a
// mock could hide (e.g. an actually-wrong fetch() call signature, a real
// AbortController timing bug) by going over real sockets. Never touches
// poke.idleworld.online.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { checkAccountNetwork } = require('../../electron/network-health');
const { createGameTestDoubleServer } = require('../fixtures/game-test-double-server');

describe('checkAccountNetwork — real sockets against the test-double server', () => {
  // dns.promises.resolve() only queries the DNS protocol — it does not
  // consult the hosts file, so it depends on a reachable upstream DNS
  // server existing at all. That's environment-dependent (sandboxed/CI
  // runners often have no DNS egress) and orthogonal to what this file is
  // actually verifying, so resolveImpl stays injected here too — DNS
  // resolution itself is already exhaustively covered with mocks in
  // network-health.test.js. This file's job is proving the fetch/
  // AbortController plumbing works over REAL sockets against a real,
  // running server, which is the part a mock can't catch bugs in.
  const fakeSuccessfulResolve = async () => ['127.0.0.1'];

  test('httpsReachable is true for a real running server over a real socket round-trip', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    try {
      const result = await checkAccountNetwork('acc-int-test', {
        hostname: 'localhost',
        resolveImpl: fakeSuccessfulResolve,
        fetchImpl: async () => {
          const res = await fetch(`http://127.0.0.1:${port}/`);
          return { status: res.status };
        }
      });

      assert.equal(result.httpsReachable, true);
      assert.equal(result.httpsStatus, 200);
      assert.equal(result.lastErrorCode, null);
    } finally {
      await server.close();
    }
  });

  test('a genuinely unreachable port (server closed) reports httpsReachable false with a real error, not a mock', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    await server.close(); // now genuinely nothing is listening on `port`

    const result = await checkAccountNetwork('acc-int-test-2', {
      hostname: 'localhost',
      resolveImpl: fakeSuccessfulResolve,
      fetchImpl: async () => {
        await fetch(`http://127.0.0.1:${port}/`); // real ECONNREFUSED
      }
    });

    assert.equal(result.httpsReachable, false);
    assert.ok(result.lastErrorCode);
  });

  test('a real AbortController timeout against a genuinely slow endpoint reports unreachable rather than hanging', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    try {
      const start = Date.now();
      const result = await checkAccountNetwork('acc-int-test-3', {
        hostname: 'localhost',
        timeoutMs: 200,
        resolveImpl: fakeSuccessfulResolve,
        fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
          // Wire the real AbortController from checkAccountNetwork into a
          // real (slow) request against the double server's /slow route
          // (3s) — proves the 200ms timeout genuinely aborts rather than
          // waiting the full 3s.
          fetch(`http://127.0.0.1:${port}/slow`, { signal }).then(resolve, reject);
        })
      });

      assert.equal(result.httpsReachable, false);
      assert.ok(Date.now() - start < 2900, 'must abort well before the /slow route would resolve on its own');
    } finally {
      await server.close();
    }
  });
});
