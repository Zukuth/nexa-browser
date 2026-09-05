// parseCsv reads the password-manager export handed to passwords:import —
// untrusted input that decides how every imported credential is split into
// url / username / password. Extracted from main.js so it can be tested at
// all; see the header comment in electron/csv.js.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv } = require('../../electron/csv');

describe('parseCsv()', () => {
  test('parses a plain header + row', () => {
    assert.deepEqual(
      parseCsv('url,username,password\nhttps://a.test,ana,hunter2'),
      [['url', 'username', 'password'], ['https://a.test', 'ana', 'hunter2']]
    );
  });

  test('handles CRLF line endings (what a Windows export produces)', () => {
    assert.deepEqual(
      parseCsv('a,b\r\n1,2\r\n'),
      [['a', 'b'], ['1', '2']]
    );
  });

  test('handles lone CR line endings', () => {
    assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
  });

  test('keeps a comma that is inside a quoted field', () => {
    assert.deepEqual(
      parseCsv('name,url\n"Acme, Inc.",https://a.test'),
      [['name', 'url'], ['Acme, Inc.', 'https://a.test']]
    );
  });

  test('unescapes a doubled quote inside a quoted field', () => {
    assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
  });

  // A password can legitimately contain a newline, and a quoted field is how
  // every exporter represents that — treating it as a row break would split
  // one credential across two rows and silently corrupt the import.
  test('keeps a newline that is inside a quoted field', () => {
    assert.deepEqual(
      parseCsv('pw\n"line1\nline2"'),
      [['pw'], ['line1\nline2']]
    );
  });

  test('preserves empty fields', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
  });

  test('skips blank lines rather than emitting empty rows', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
  });

  test('returns the last row even without a trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  test('returns no rows for empty or nullish input', () => {
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv(null), []);
    assert.deepEqual(parseCsv(undefined), []);
  });
});
