const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const { createGameTestDoubleServer } = require('../fixtures/game-test-double-server');

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
}

describe('game-test-double-server (never touches the real game)', () => {
  test('serves /game/items.json in the shape ensureItemPriceCatalog expects', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/game/items.json`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.items));
    } finally {
      await server.close();
    }
  });

  test('/error500 and /slow simulate the documented failure modes', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    try {
      const errRes = await fetch(`http://127.0.0.1:${port}/error500`);
      assert.equal(errRes.status, 500);

      const start = Date.now();
      const slowRes = await fetch(`http://127.0.0.1:${port}/slow`);
      assert.equal(slowRes.status, 200);
      assert.ok(Date.now() - start >= 2900);
    } finally {
      await server.close();
    }
  });

  test('a connected client receives broadcast frames in the real game protocol shape', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    let ws;
    try {
      ws = await connectClient(port);
      const framePromise = nextMessage(ws);
      server.sendKillFrame();
      const frame = await framePromise;
      assert.equal(frame.type, 'field-kill');
      assert.equal(typeof frame.xpGained, 'number');
    } finally {
      if (ws) ws.close();
      await server.close();
    }
  });

  test('sendIdleFrame emits a non-gameplay frame type', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    let ws;
    try {
      ws = await connectClient(port);
      const framePromise = nextMessage(ws);
      server.sendIdleFrame();
      const frame = await framePromise;
      assert.equal(frame.type, 'inventory');
    } finally {
      if (ws) ws.close();
      await server.close();
    }
  });

  test('sendHuntReset carries the huntKey the real field-init frame uses', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    let ws;
    try {
      ws = await connectClient(port);
      const framePromise = nextMessage(ws);
      server.sendHuntReset('zone-b');
      const frame = await framePromise;
      assert.equal(frame.type, 'field-init');
      assert.equal(frame.huntKey, 'zone-b');
    } finally {
      if (ws) ws.close();
      await server.close();
    }
  });

  test('closeAllClean closes with code 1000 (graceful)', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    let ws;
    try {
      ws = await connectClient(port);
      const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
      server.closeAllClean();
      const code = await closePromise;
      assert.equal(code, 1000);
    } finally {
      await server.close();
    }
  });

  test('closeAllAbrupt terminates the connection without a graceful handshake', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    let ws;
    try {
      ws = await connectClient(port);
      assert.equal(server.socketCount, 1);
      const closePromise = new Promise((resolve) => ws.once('close', () => resolve()));
      server.closeAllAbrupt();
      await closePromise;
      // The client-side 'close' event and the server's own socket-set cleanup
      // (sockets.delete(ws) in its 'close' handler) are two independent TCP
      // teardown notifications, not synchronized — poll briefly instead of
      // assuming one tick is enough.
      await assert.doesNotReject(() => new Promise((resolve, reject) => {
        const deadline = Date.now() + 2000;
        const check = () => {
          if (server.socketCount === 0) return resolve();
          if (Date.now() > deadline) return reject(new Error('socketCount never reached 0'));
          setTimeout(check, 25);
        };
        check();
      }));
      assert.equal(server.socketCount, 0);
    } finally {
      await server.close();
    }
  });

  test('setLatencyMs delays broadcast delivery by roughly the configured amount', async () => {
    const server = createGameTestDoubleServer();
    server.setLatencyMs(300);
    const port = await server.listen();
    let ws;
    try {
      ws = await connectClient(port);
      const start = Date.now();
      const framePromise = nextMessage(ws);
      server.sendKillFrame();
      await framePromise;
      assert.ok(Date.now() - start >= 280);
    } finally {
      if (ws) ws.close();
      await server.close();
    }
  });

  test('killCount tracks how many kill frames were sent', async () => {
    const server = createGameTestDoubleServer();
    const port = await server.listen();
    try {
      server.sendKillFrame();
      server.sendKillFrame();
      assert.equal(server.killCount, 2);
    } finally {
      await server.close();
    }
  });

  test('each server instance binds to its own ephemeral port (parallel-test-safe)', async () => {
    const serverA = createGameTestDoubleServer();
    const serverB = createGameTestDoubleServer();
    try {
      const portA = await serverA.listen();
      const portB = await serverB.listen();
      assert.notEqual(portA, portB);
    } finally {
      await serverA.close();
      await serverB.close();
    }
  });
});
