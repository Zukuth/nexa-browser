// Tiny local server for the auto-retranslate-on-navigation e2e test — two
// distinct real pages under one origin, so navigating between them is a
// genuine full navigation (did-navigate), not an in-page route change.
const http = require('http');

function createTwoPagesServer(port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/second') {
      res.end('<!doctype html><html lang="en"><body><p>This is the second page, after a real navigation.</p></body></html>');
    } else {
      res.end('<!doctype html><html lang="en"><body><p>This is the first page, before navigating away.</p></body></html>');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { createTwoPagesServer };
