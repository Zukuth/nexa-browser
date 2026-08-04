const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const networkHealth = require('../../electron/network-health');

describe('checkAccountNetwork', () => {
  test('populates DNS + HTTPS fields on a fully successful check', async () => {
    const result = await networkHealth.checkAccountNetwork('acc1', {
      hostname: 'poke.idleworld.online',
      isOnlineImpl: () => true,
      resolveImpl: async () => ['1.2.3.4'],
      fetchImpl: async () => ({ status: 200 })
    });

    assert.equal(result.electronOnline, true);
    assert.equal(result.dnsResolved, true);
    assert.deepEqual(result.resolvedAddresses, ['1.2.3.4']);
    assert.equal(result.httpsReachable, true);
    assert.equal(result.httpsStatus, 200);
    assert.equal(result.lastErrorCode, null);
    assert.ok(result.checkedAt);
  });

  test('DNS failure is reported without touching HTTPS success', async () => {
    const result = await networkHealth.checkAccountNetwork('acc1', {
      hostname: 'poke.idleworld.online',
      isOnlineImpl: () => true,
      resolveImpl: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); },
      fetchImpl: async () => ({ status: 200 })
    });

    assert.equal(result.dnsResolved, false);
    assert.equal(result.lastErrorCode, 'ENOTFOUND');
    // A DNS failure doesn't block the HTTPS check from still running/succeeding.
    assert.equal(result.httpsReachable, true);
  });

  test('HTTPS timeout/abort is reported as unreachable, not thrown', async () => {
    const result = await networkHealth.checkAccountNetwork('acc1', {
      hostname: 'poke.idleworld.online',
      timeoutMs: 5,
      isOnlineImpl: () => true,
      resolveImpl: async () => ['1.2.3.4'],
      fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    });

    assert.equal(result.httpsReachable, false);
    assert.equal(result.lastErrorCode, 'AbortError');
  });

  test('non-200 HTTPS response is still reported as reachable with its status', async () => {
    const result = await networkHealth.checkAccountNetwork('acc1', {
      hostname: 'poke.idleworld.online',
      isOnlineImpl: () => true,
      resolveImpl: async () => ['1.2.3.4'],
      fetchImpl: async () => ({ status: 503 })
    });

    assert.equal(result.httpsReachable, true);
    assert.equal(result.httpsStatus, 503);
  });

  test('proxyActive flag is echoed back as passed in', async () => {
    const result = await networkHealth.checkAccountNetwork('acc1', {
      hostname: 'poke.idleworld.online',
      proxyActive: true,
      isOnlineImpl: () => true,
      resolveImpl: async () => ['1.2.3.4'],
      fetchImpl: async () => ({ status: 200 })
    });

    assert.equal(result.proxyActive, true);
  });

  test('missing hostname never throws, returns a diagnosable error result', async () => {
    const result = await networkHealth.checkAccountNetwork('acc1', {});
    assert.equal(result.lastErrorCode, 'NO_HOSTNAME');
    assert.equal(result.dnsResolved, false);
    assert.equal(result.httpsReachable, false);
  });

  test('never throws even when every check fails', async () => {
    await assert.doesNotReject(networkHealth.checkAccountNetwork('acc1', {
      hostname: 'poke.idleworld.online',
      isOnlineImpl: () => { throw new Error('boom'); },
      resolveImpl: async () => { throw new Error('dns boom'); },
      fetchImpl: async () => { throw new Error('fetch boom'); }
    }));
  });
});

describe('startNetLogCapture / stopNetLogCapture', () => {
  test('startNetLogCapture rejects a missing session gracefully', async () => {
    const result = await networkHealth.startNetLogCapture(null, { path: 'x.log' });
    assert.equal(result.ok, false);
  });

  test('startNetLogCapture requires a path', async () => {
    const fakeSession = { netLog: { startLogging: async () => {} } };
    const result = await networkHealth.startNetLogCapture(fakeSession, {});
    assert.equal(result.ok, false);
  });

  test('startNetLogCapture always uses captureMode "default", never includeSensitive/everything', async () => {
    let capturedOptions = null;
    const fakeSession = {
      netLog: {
        startLogging: async (_path, options) => { capturedOptions = options; }
      }
    };

    await networkHealth.startNetLogCapture(fakeSession, { path: 'x.log', maxSizeMb: 20 });

    assert.equal(capturedOptions.captureMode, 'default');
    assert.notEqual(capturedOptions.captureMode, 'includeSensitive');
    assert.notEqual(capturedOptions.captureMode, 'everything');
  });

  test('stopNetLogCapture returns ok:false instead of throwing when logging was never started', async () => {
    const fakeSession = { netLog: { stopLogging: async () => { throw new Error('not started'); } } };
    const result = await networkHealth.stopNetLogCapture(fakeSession);
    assert.equal(result.ok, false);
  });
});
