// Local HTTP+WS test double for poke.idleworld.online — NEVER connects to
// the real game. Used by network/renderer-recovery e2e specs so connection
// loss, stalls, and reconnects can be exercised deterministically instead
// of depending on the real server's actual uptime/behavior. Emits frames in
// the real game's own protocol shapes (field-kill/poke-delta/field-init —
// see electron/game-telemetry.js's applyFrame switch) so the same parsing
// code under test sees realistic data.
//
// devDependency only (`ws`, added just for this) — never bundled into the
// shipped app (electron-builder's `files` config only packages electron/**
// and src/**, this lives under test/).

const http = require('node:http');
const { WebSocketServer } = require('ws');

function createGameTestDoubleServer() {
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.pathname === '/game/items.json') {
      // Matches ensureItemPriceCatalog()'s expected shape (electron/game-telemetry.js)
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    if (url.pathname === '/slow') {
      setTimeout(() => { res.writeHead(200); res.end('slow-ok'); }, 3000);
      return;
    }
    if (url.pathname === '/error500') {
      res.writeHead(500);
      res.end('simulated server error');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });

  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set();
  let latencyMs = 0;
  let killCount = 0;

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on('close', () => sockets.delete(ws));
      ws.on('error', () => sockets.delete(ws));
    });
  });

  function send(ws, msg) {
    const payload = JSON.stringify(msg);
    const doSend = () => { if (ws.readyState === ws.OPEN) ws.send(payload); };
    if (latencyMs > 0) setTimeout(doSend, latencyMs);
    else doSend();
  }

  function broadcast(msg) {
    for (const ws of sockets) send(ws, msg);
  }

  // Realistic combat frame — matches applyFrame's 'field-kill' case shape.
  function sendKillFrame(overrides = {}) {
    killCount += 1;
    broadcast({ type: 'field-kill', xpGained: 10, leveledUp: false, loot: [], ...overrides });
  }

  // Non-gameplay frame — keeps lastAnyFrameAt fresh without advancing any
  // gameplay delta, exactly the shape that used to fool the old
  // killsPerHour-based freeze check.
  function sendIdleFrame() {
    broadcast({ type: 'inventory', items: [] });
  }

  function sendHuntReset(huntKey) {
    broadcast({ type: 'field-init', huntKey });
  }

  // Clean WS close (code 1000) — the game's own "logged out" / normal
  // disconnect shape.
  function closeAllClean() {
    for (const ws of sockets) ws.close(1000, 'clean-close');
  }

  // Abrupt close — no close handshake, simulates a dropped connection /
  // server crash rather than a graceful logout.
  function closeAllAbrupt() {
    for (const ws of sockets) ws.terminate();
  }

  function setLatencyMs(ms) {
    latencyMs = Math.max(0, ms);
  }

  function listen(port = 0) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    });
  }

  function close() {
    return new Promise((resolve) => {
      closeAllAbrupt();
      wss.close(() => server.close(() => resolve()));
    });
  }

  return {
    listen,
    close,
    broadcast,
    sendKillFrame,
    sendIdleFrame,
    sendHuntReset,
    closeAllClean,
    closeAllAbrupt,
    setLatencyMs,
    get socketCount() { return sockets.size; },
    get killCount() { return killCount; }
  };
}

module.exports = { createGameTestDoubleServer };
