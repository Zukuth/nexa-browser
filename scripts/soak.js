#!/usr/bin/env node
// Automated soak test for the CORE stability logic (game-connection-manager
// + network-health + backoff), run against the local test-double server for
// a sustained period of simulated churn (frames, disconnects, latency,
// server outages). This does NOT drive the full Electron app/real
// <webview>/CDP stack — that requires a running window and real GPU/render
// processes, which isn't practical to script headlessly here. What this DOES
// give real coverage of: the exact reducer/backoff/network-check code paths
// main.js wires into live accounts, exercised under sustained repeated
// failure injection instead of a handful of discrete unit-test cases.
//
// The multi-account, multi-hour, minimized-window, suspend/resume soak the
// full plan calls for remains a MANUAL procedure against the real app and
// the real game — see the plan doc's "Etapa 10" verification notes. This
// script is the automated, short/compressed-timeline complement, not a
// replacement for that manual pass.
//
// Usage: node scripts/soak.js
// Duration: NEXA_SOAK_DURATION_MS env var (default 30000 — CI-friendly;
// pass e.g. 7200000 for a real 2h local run).

const { createGameTestDoubleServer } = require('../test/fixtures/game-test-double-server');
const { createAccountConnectionManager } = require('../electron/game-connection-manager');
const { checkAccountNetwork } = require('../electron/network-health');

const DURATION_MS = Number(process.env.NEXA_SOAK_DURATION_MS) || 30_000;
const ACCOUNT_COUNT = 4;
const TICK_MS = 250;

async function main() {
  const server = createGameTestDoubleServer();
  const port = await server.listen();
  console.log(`[soak] test-double server listening on 127.0.0.1:${port}`);
  console.log(`[soak] running for ${DURATION_MS}ms with ${ACCOUNT_COUNT} simulated accounts`);

  const errors = [];
  const stateChanges = [];
  const managers = [];
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const accountId = `soak-account-${i}`;
    const manager = createAccountConnectionManager(accountId, {
      onStateChange: (change) => stateChanges.push(change),
      onRecoveryLevel: async ({ level, accountId: id, reason }) => {
        try {
          if (level === 1) {
            const result = await checkAccountNetwork(id, {
              hostname: 'localhost',
              resolveImpl: async () => ['127.0.0.1'],
              fetchImpl: async () => {
                const res = await fetch(`http://127.0.0.1:${port}/`);
                return { status: res.status };
              }
            });
            manager.handleEvent({ type: 'NETWORK_CHECK', result });
          } else if (level === 2 || level === 3) {
            manager.handleEvent({ type: 'RECOVERY_LEVEL_2_DONE' });
          }
        } catch (err) {
          errors.push({ accountId: id, level, reason, err: String(err) });
        }
      }
    });
    managers.push(manager);
  }

  const startedAt = Date.now();
  const startMem = process.memoryUsage().heapUsed;
  let tick = 0;
  let serverDown = false;

  await new Promise((resolve) => {
    const interval = setInterval(async () => {
      tick += 1;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= DURATION_MS) {
        clearInterval(interval);
        resolve();
        return;
      }

      try {
        // Cycle through normal frames, an occasional abrupt disconnect, and
        // a periodic full server outage — the three failure modes the
        // connection manager actually has to handle in production.
        const phase = tick % 40;
        if (phase < 30) {
          server.sendKillFrame();
          for (const m of managers) m.handleEvent({ type: 'FRAME_RECEIVED' });
        } else if (phase === 30) {
          server.closeAllAbrupt();
          for (const m of managers) m.handleEvent({ type: 'WS_DETACHED', reason: 'soak-simulated' });
        } else if (phase === 35 && !serverDown) {
          serverDown = true;
          await server.close();
        } else if (phase === 38 && serverDown) {
          // Server comes back — new instance since close() tears down the
          // listener; same port isn't guaranteed but that's fine, this soak
          // only cares about the manager's own state, not port stability.
          await server.listen(port).catch(() => server.listen());
          serverDown = false;
        }
      } catch (err) {
        errors.push({ tick, err: String(err) });
      }
    }, TICK_MS);
  });

  const endMem = process.memoryUsage().heapUsed;
  const memGrowthMb = (endMem - startMem) / (1024 * 1024);

  console.log(`[soak] done — ${stateChanges.length} state changes, ${errors.length} errors, heap growth ${memGrowthMb.toFixed(2)}MB`);
  if (errors.length > 0) {
    console.error('[soak] errors encountered:', errors.slice(0, 10));
  }

  // QA audit finding (2026-08-08): the old log line here claimed "expected:
  // some" — that was never actually reachable by this script. RECOVERY_FAILED
  // only comes from a RECOVERY_EXHAUSTED event, which is emitted by main.js's
  // real runRecoveryLevel() once shouldStopRetrying() hits maxAttempts — logic
  // this simplified harness never wires in (it only drives levels 1-3 via the
  // onRecoveryLevel callback above). On top of that, every 40-tick cycle's
  // FRAME_RECEIVED barrage (ticks 0-29) resets any manager straight back to
  // HEALTHY before enough consecutive failures could accumulate anyway. 0/4
  // here is the manager behaving correctly given what's actually simulated,
  // not a sign anything is stuck.
  const stuckInRecoveryFailed = managers.filter((m) => m.getState().state === 'RECOVERY_FAILED');
  console.log(`[soak] managers currently in RECOVERY_FAILED: ${stuckInRecoveryFailed.length}/${ACCOUNT_COUNT} (expected: 0 — this harness never wires RECOVERY_EXHAUSTED, see comment above)`);

  await server.close().catch(() => {});

  if (errors.length > 0) {
    console.error('[soak] FAILED — unexpected errors during the run');
    process.exitCode = 1;
    return;
  }
  if (memGrowthMb > 50) {
    console.error(`[soak] FAILED — heap grew by ${memGrowthMb.toFixed(2)}MB, over the 50MB sanity ceiling for this short run`);
    process.exitCode = 1;
    return;
  }
  console.log('[soak] PASSED');
}

main().catch((err) => {
  console.error('[soak] fatal error', err);
  process.exitCode = 1;
});
