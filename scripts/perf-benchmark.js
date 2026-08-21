#!/usr/bin/env node
// Automates the manual benchmark protocol documented in README.md's
// "Rendimiento por versión" table: N accounts freshly opened, all pointed at
// the game's real login screen, a stabilization delay, then a real
// app.getAppMetrics() read via the same metrics:get IPC the sidebar's own
// CPU/RAM row uses. Existed as a manual, hand-run procedure before this
// (see the README note asking to re-run it before every release) — this
// script is that same protocol, scriptable and repeatable, per the perf
// audit's own recommendation to stop re-deriving it by hand each time.
//
// Usage: node scripts/perf-benchmark.js [accountCount] [stabilizeMs]
// Defaults match the README protocol: 3 accounts, 25s stabilization.

const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const ACCOUNT_COUNT = Number(process.argv[2]) || 3;
const STABILIZE_MS = Number(process.argv[3]) || 25_000;
const GAME_LOGIN_URL = 'https://poke.idleworld.online/login';

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-benchmark-'));
  const dataFile = path.join(userDataDir, 'nexa-browser-data.json');
  fs.writeFileSync(dataFile, JSON.stringify({ settings: {} }, null, 2), 'utf-8');

  console.log(`[benchmark] launching app (${ACCOUNT_COUNT} accounts on ${GAME_LOGIN_URL}, ${STABILIZE_MS}ms stabilization)...`);
  const app = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
    executablePath: require('electron')
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Point the first auto-added account at the game login instead of
    // whatever default it opened with, then add the rest fresh.
    await page.evaluate((url) => window.api.updateSpace('default', { defaultUrl: url }), GAME_LOGIN_URL);
    const state0 = await page.evaluate(() => window.api.getState());
    const firstId = state0.accounts[0].id;
    await page.evaluate(({ id, url }) => window.api.navigateAccount(id, url), { id: firstId, url: GAME_LOGIN_URL });
    for (let i = 1; i < ACCOUNT_COUNT; i += 1) {
      await page.evaluate(() => window.api.quickAddAccount());
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const s = await page.evaluate(() => window.api.getState());
      if (s.accounts.filter((a) => !a.closed).length >= ACCOUNT_COUNT) break;
      await page.waitForTimeout(500);
    }

    console.log(`[benchmark] stabilizing for ${STABILIZE_MS}ms...`);
    await page.waitForTimeout(STABILIZE_MS);

    const metrics = await page.evaluate(() => window.api.getMetrics());
    const perAccount = Object.values(metrics);
    const totalRamMb = perAccount.reduce((sum, m) => sum + (m.memoryMB || 0), 0);
    const totalCpu = perAccount.reduce((sum, m) => sum + (m.cpu || 0), 0);

    // app.getAppMetrics() covers every OS process (main + every renderer +
    // GPU + utility), not just the account webContents metrics:get reports —
    // matches the README table's "Procesos" column exactly.
    const allProcessMetrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());

    console.log('');
    console.log('=== RESULT ===');
    console.log(`Accounts open: ${perAccount.length}`);
    console.log(`Processes (app.getAppMetrics().length): ${allProcessMetrics.length}`);
    console.log(`RAM total (sum of per-account memoryMB): ${totalRamMb} MB`);
    console.log(`CPU total (sum of per-account cpu%): ${totalCpu.toFixed(1)}%`);
    console.log(JSON.stringify({ accounts: perAccount.length, processes: allProcessMetrics.length, ramMb: totalRamMb, cpuPercent: Number(totalCpu.toFixed(1)) }));
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error('[benchmark] fatal error', err);
  process.exitCode = 1;
});
