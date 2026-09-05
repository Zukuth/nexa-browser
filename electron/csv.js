// @ts-check
// RFC-4180-style CSV parsing, used by the passwords:import IPC handler in
// main.js to read a password manager's export.
//
// Extracted from main.js for the same reason url-utils.js, address-bar.js,
// crash-classifier.js, sell-lock.js and layout-utils.js were: it's pure logic
// with no Electron dependency, and it handles a file the user was handed by
// something else (Chrome, Bitwarden, 1Password) that decides how every saved
// credential gets read. That combination — untrusted input, security-relevant
// output, no way to reach it from a test while it lived inside main.js — is
// exactly what that rule exists for.
//
// Handles: quoted fields, escaped "" inside a quoted field, embedded commas
// and newlines inside quotes, and CRLF/LF/CR line endings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const source = String(text ?? '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // Skips a row that is a single empty field — i.e. a blank line, which
      // both a trailing newline and a double newline in the middle produce.
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

module.exports = { parseCsv };
