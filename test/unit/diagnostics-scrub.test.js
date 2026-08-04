const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scrubReport, buildReport, scrubUrlLike } = require('../../electron/diagnostics');

describe('scrubReport — PII categories', () => {
  test('cookies are redacted by key name', () => {
    const out = scrubReport({ cookie: 'session=abc123' });
    assert.equal(out.cookie, '[redactado]');
  });

  test('tokens are redacted by key name', () => {
    const out = scrubReport({ authToken: 'xyz', accessToken: 'abc' });
    assert.equal(out.authToken, '[redactado]');
    assert.equal(out.accessToken, '[redactado]');
  });

  test('authorization headers are redacted', () => {
    const out = scrubReport({ headers: { Authorization: 'Bearer secret-value' } });
    assert.equal(out.headers.Authorization, '[redactado]');
  });

  test('passwords are redacted', () => {
    const out = scrubReport({ password: 'hunter2', passwd: 'x' });
    assert.equal(out.password, '[redactado]');
    assert.equal(out.passwd, '[redactado]');
  });

  test('emails embedded anywhere in string values are redacted', () => {
    const out = scrubReport({ note: 'contact me at user@example.com please' });
    assert.ok(!out.note.includes('user@example.com'));
    assert.ok(out.note.includes('[email redactado]'));
  });

  test('username/email/login-identity fields are redacted by key name even without @ in the value', () => {
    const out = scrubReport({ username: 'Zukuth', email: 'x', accountName: 'Zukuth123' });
    assert.equal(out.username, '[redactado]');
    assert.equal(out.email, '[redactado]');
    assert.equal(out.accountName, '[redactado]');
  });

  test('login request bodies are redacted wholesale, not recursed into', () => {
    const out = scrubReport({ loginBody: { password: 'x', email: 'y@z.com' } });
    assert.equal(out.loginBody, '[redactado]');
  });

  test('generic request bodies are redacted wholesale', () => {
    const out = scrubReport({ requestBody: { anything: 'here' }, body: { also: 'here' } });
    assert.equal(out.requestBody, '[redactado]');
    assert.equal(out.body, '[redactado]');
  });

  test('session-related keys are redacted', () => {
    const out = scrubReport({ sessionId: 'abc', marketSessionToken: 'xyz' });
    assert.equal(out.sessionId, '[redactado]');
    assert.equal(out.marketSessionToken, '[redactado]');
  });

  test('URL fields have their query string and fragment stripped (common leak vector for tokens/session ids)', () => {
    const out = scrubReport({ url: 'https://poke.idleworld.online/api/buy?sessionToken=abc123&x=1#frag' });
    assert.equal(out.url, 'https://poke.idleworld.online/api/buy');
  });

  test('nested objects and arrays are scrubbed recursively', () => {
    const out = scrubReport({
      accountConnectionStates: [
        { accountId: 'a1', password: 'x', nested: { email: 'y@z.com', ok: true } }
      ]
    });
    assert.equal(out.accountConnectionStates[0].password, '[redactado]');
    assert.equal(out.accountConnectionStates[0].nested.email, '[redactado]');
    assert.equal(out.accountConnectionStates[0].nested.ok, true);
  });

  test('non-sensitive fields pass through unchanged', () => {
    const out = scrubReport({ state: 'HEALTHY', attemptCount: 2, cpu: 4.2 });
    assert.equal(out.state, 'HEALTHY');
    assert.equal(out.attemptCount, 2);
    assert.equal(out.cpu, 4.2);
  });

  test('null/undefined/primitive inputs never throw', () => {
    assert.doesNotThrow(() => scrubReport(null));
    assert.doesNotThrow(() => scrubReport(undefined));
    assert.doesNotThrow(() => scrubReport(42));
    assert.doesNotThrow(() => scrubReport('plain string'));
  });
});

describe('scrubUrlLike', () => {
  test('strips query string', () => {
    assert.equal(scrubUrlLike('https://x.com/path?a=1&b=2'), 'https://x.com/path');
  });
  test('strips hash fragment', () => {
    assert.equal(scrubUrlLike('https://x.com/path#section'), 'https://x.com/path');
  });
  test('leaves a clean URL untouched', () => {
    assert.equal(scrubUrlLike('https://x.com/path'), 'https://x.com/path');
  });
  test('non-string input passes through unchanged', () => {
    assert.equal(scrubUrlLike(42), 42);
  });
});

describe('buildReport', () => {
  test('assembles all four sections and scrubs the whole thing', () => {
    const report = buildReport({
      accountConnectionStates: [{ accountId: 'a1', state: 'HEALTHY' }],
      networkSnapshots: [{ accountId: 'a1', dnsResolved: true }],
      adBlockLog: [{ url: 'https://ads.example.com/x?track=1', accountId: 'a1' }],
      memoryStats: [{ accountId: 'a1', cpu: 1, memoryMB: 100 }]
    });

    assert.ok(report.generatedAt);
    assert.equal(report.accountConnectionStates[0].state, 'HEALTHY');
    assert.equal(report.adBlockLog[0].url, 'https://ads.example.com/x');
  });

  test('missing sections default to empty arrays rather than throwing', () => {
    assert.doesNotThrow(() => buildReport());
    const report = buildReport();
    assert.deepEqual(report.accountConnectionStates, []);
    assert.deepEqual(report.networkSnapshots, []);
    assert.deepEqual(report.adBlockLog, []);
    assert.deepEqual(report.memoryStats, []);
  });
});
