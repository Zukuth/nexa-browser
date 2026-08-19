#!/usr/bin/env node
// Manual verification that translate.js's watch loop keeps a page translated
// through the page's OWN later DOM updates — not just at the moment
// "Traducir página" was clicked. Playwright can't read a <webview>'s content
// directly (see test/e2e/picture-in-picture.spec.js's note on the same
// limitation), so this drives a real throwaway Electron instance over raw
// CDP instead, against test/fixtures/dynamic-game-mock.html — a mock page
// that mimics two patterns real game UIs use and that both silently orphan
// a translated text node if nothing re-catches them: a live counter updated
// via .textContent (every 1.2s) and a list re-rendered via .innerHTML
// (every 2.5s).
//
// Usage: node scripts/verify-translate-dynamic.js

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const WebSocket = require('ws');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'dynamic-game-mock.html');
const HTTP_PORT = 8931;
const CDP_PORT = 9333;

function serveFixture() {
  return new Promise((resolve) => {
    const html = fs.readFileSync(FIXTURE);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(HTTP_PORT, () => resolve(server));
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function rpc(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        ws.off('message', handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalOn(ws, expression) {
  const result = await rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function findTarget(pred, tries = 40, delayMs = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = JSON.parse(await httpGet(`http://localhost:${CDP_PORT}/json/list`));
      const found = list.find(pred);
      if (found) return found;
    } catch {
      // CDP port not listening yet — keep retrying.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('target not found in time');
}

async function connectWebview() {
  let ws;
  let href = '';
  for (let attempt = 0; attempt < 15 && !href.includes(`localhost:${HTTP_PORT}`); attempt++) {
    let target;
    try {
      target = await findTarget((t) => t.url.includes(`localhost:${HTTP_PORT}`) || t.url === 'about:blank', 6);
    } catch {
      continue;
    }
    if (ws) ws.close();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, rej) => { ws.once('open', r); ws.once('error', rej); });
    await rpc(ws, 'Runtime.enable', {});
    try {
      for (let i = 0; i < 10; i++) {
        if ((await evalOn(ws, `document.readyState`)) === 'complete') break;
        await new Promise((r) => setTimeout(r, 300));
      }
      href = await evalOn(ws, `location.href`);
    } catch {
      href = '';
    }
    if (!href.includes(`localhost:${HTTP_PORT}`)) await new Promise((r) => setTimeout(r, 500));
  }
  if (!href.includes(`localhost:${HTTP_PORT}`)) throw new Error('never landed on the fixture page, last href=' + href);
  return ws;
}

async function main() {
  const server = await serveFixture();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-translate-verify-'));
  fs.writeFileSync(
    path.join(userDataDir, 'nexa-browser-data.json'),
    JSON.stringify({
      spaces: [{ id: 'default', name: 'General', color: '#4f8cff', icon: 'grid', defaultUrl: 'about:blank', defaultLayout: 'single' }],
      settings: { defaultStartUrl: 'about:blank', hasUsedTranslate: true }
    }, null, 2)
  );

  const electronPath = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
  const child = spawn(electronPath, [
    PROJECT_ROOT,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu', '--disable-software-rasterizer', '--disable-gpu-compositing',
    '--in-process-gpu', '--disable-features=UseSkiaRenderer,Vulkan,CanvasOopRasterization',
    '--use-gl=swiftshader', '--use-angle=swiftshader'
  ], { cwd: PROJECT_ROOT, stdio: 'ignore', env: { ...process.env, NEXA_FORCE_SOFTWARE: '1' } });

  let exitCode = 0;
  try {
    const hostTarget = await findTarget((t) => t.type === 'page' && /index\.html/.test(t.url));
    const hostWs = new WebSocket(hostTarget.webSocketDebuggerUrl);
    await new Promise((r) => hostWs.once('open', r));
    await rpc(hostWs, 'Runtime.enable', {});

    let activeId = null;
    for (let i = 0; i < 20 && !activeId; i++) {
      activeId = await evalOn(hostWs, `window.api.getState().then(s => s.settings.activeAccountId)`);
      if (!activeId) await new Promise((r) => setTimeout(r, 500));
    }
    if (!activeId) throw new Error('no account ever appeared');

    await evalOn(hostWs, `window.api.navigateAccount('${activeId}', 'http://localhost:${HTTP_PORT}')`);
    const wvWs = await connectWebview();

    const result = await evalOn(hostWs, `window.api.translatePage('${activeId}', 'es')`);
    console.log('translatePage:', JSON.stringify(result));
    if (!result.ok) throw new Error('translatePage failed: ' + result.error);

    // Sample both dynamic elements a few times, long enough to span several
    // re-render + drain cycles (drain runs every 800ms — see startTranslateWatchLoop).
    let sawGoldTranslated = false;
    let sawShopTranslated = false;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const gold = await evalOn(wvWs, `document.getElementById('gold-counter').textContent`);
      const shop = await evalOn(wvWs, `document.getElementById('shop-list').textContent`);
      if (gold.startsWith('Oro:')) sawGoldTranslated = true;
      if (shop.includes('Poción')) sawShopTranslated = true;
      console.log(`  [t+${(i + 1) * 1.5}s] gold="${gold}" shop="${shop.slice(0, 40)}..."`);
    }

    console.log('\nResult:');
    console.log('  live counter (.textContent swap) caught by watch loop at least once:', sawGoldTranslated);
    console.log('  re-rendered list (.innerHTML swap) caught by watch loop at least once:', sawShopTranslated);
    if (!sawGoldTranslated || !sawShopTranslated) {
      console.error('\nFAIL: the translate-watch loop did not catch one of the dynamic updates in time.');
      exitCode = 1;
    } else {
      console.log('\nOK: both dynamic-update patterns stayed translated through at least one re-render cycle.');
    }
  } finally {
    child.kill();
    server.close();
    await new Promise((r) => setTimeout(r, 1000));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // Windows can briefly hold a file handle open right after the
      // process exits — non-fatal, just a leftover temp dir.
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
