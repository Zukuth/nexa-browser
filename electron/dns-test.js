// DNS speed test — measures real resolution latency against a curated list
// of public DNS resolvers, so the user can pick the fastest one for their
// own network before applying it (this module only measures; it never
// touches the OS's actual DNS configuration — see main.js's dns:test IPC
// handlers and the PowerShell command the UI hands the user to run
// themselves).
//
// Deliberately uses Node's dns.Resolver with setServers(), NOT Chromium's
// net.resolveHost() (compare network-health.js, which explicitly avoids
// Node's resolver for the opposite reason). The two modules test different
// things: network-health.js asks "is DNS broken for the resolver this
// machine is actually configured to use" (so it must go through the same
// path Chromium does); this module asks "how fast does DNS server X
// specifically answer", which requires querying that exact server — the one
// thing only Node's Resolver.setServers() can do here.
const dns = require('dns');

const DEFAULT_TIMEOUT_MS = 4000;
const TEST_HOSTNAME = 'www.cloudflare.com';

const DNS_PROVIDERS = [
  { id: 'cloudflare', name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
  { id: 'quad9-secure', name: 'Quad9 (con seguridad)', servers: ['9.9.9.9', '149.112.112.9'] },
  { id: 'quad9-open', name: 'Quad9 (sin seguridad)', servers: ['9.9.9.10', '149.112.112.10'] },
  { id: 'google', name: 'Google Public DNS', servers: ['8.8.8.8', '8.8.4.4'] },
  { id: 'opendns', name: 'OpenDNS', servers: ['208.67.222.222', '208.67.220.220'] },
  { id: 'adguard', name: 'AdGuard DNS', servers: ['94.140.14.14', '94.140.15.15'] },
  { id: 'cleanbrowsing', name: 'CleanBrowsing', servers: ['185.228.168.9', '185.228.169.9'] }
];

// One timed resolve4() against a single server. null (not a thrown error)
// means "no result" — timeout, refused, whatever — the UI treats that as
// "couldn't measure" rather than crashing the whole test over one bad server.
function timeResolve(server, timeoutMs) {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver({ timeout: timeoutMs });
    resolver.setServers([server]);
    const start = performance.now();
    let settled = false;
    const done = (ms) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ms);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    resolver.resolve4(TEST_HOSTNAME, (err) => {
      done(err ? null : Math.round(performance.now() - start));
    });
  });
}

// Tests every server of every provider in parallel (each provider's two
// servers, and all providers, run concurrently — this is read-only DNS
// queries, not something that needs to be polite/serial) and returns
// {id, name, servers: [{ip, ms}], bestMs} per provider, sorted fastest-first.
// bestMs is null if every server for that provider failed to answer.
async function runSpeedTest(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const results = await Promise.all(
    DNS_PROVIDERS.map(async (provider) => {
      const servers = await Promise.all(
        provider.servers.map(async (ip) => ({ ip, ms: await timeResolve(ip, timeoutMs) }))
      );
      const measured = servers.map((s) => s.ms).filter((ms) => ms != null);
      const bestMs = measured.length ? Math.min(...measured) : null;
      return { id: provider.id, name: provider.name, servers, bestMs };
    })
  );
  results.sort((a, b) => {
    if (a.bestMs == null && b.bestMs == null) return 0;
    if (a.bestMs == null) return 1;
    if (b.bestMs == null) return -1;
    return a.bestMs - b.bestMs;
  });
  return results;
}

// PowerShell the user runs themselves (as Administrator) to actually apply
// a DNS choice — Nexa Browser only ever measures and hands over the exact
// command; it never changes the OS network configuration on its own.
function applyCommandFor(servers) {
  const list = servers.map((ip) => `"${ip}"`).join(',');
  return `Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Set-DnsClientServerAddress -ServerAddresses (${list})`;
}

const RESTORE_COMMAND = "Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Set-DnsClientServerAddress -ResetServerAddresses";

module.exports = { DNS_PROVIDERS, runSpeedTest, applyCommandFor, RESTORE_COMMAND };
