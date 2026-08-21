// Ad/tracker blocking — filter engine, cosmetic filtering, per-page/lifetime
// stats, and the whole adblock:* IPC surface — split out of main.js so this
// one feature (by far the most iterated-on this project has, across several
// sessions) isn't tangled up with window/account bookkeeping.
//
// Same dependency-injection shape as permissions-manager.js: main.js stays
// the single owner of `data`/persist()/broadcastState(), this module only
// ever touches them through the functions it's handed.
const { ipcMain } = require('electron');
const fs = require('fs');
const { hostnameFromUrlLike } = require('./url-utils');
const path = require('path');
const { ElectronBlocker, fetchLists, fetchResources } = require('@ghostery/adblocker-electron');
const ADBLOCKER_COSMETIC_PRELOAD = require.resolve('@ghostery/adblocker-electron-preload');
// adblock-rs = Brave's own native (Rust) adblock-rust engine, used here only
// for the network block/allow decision (perf/architecture pass, 2026-08-21
// — see the header comment on loadNetworkEngine below for why cosmetic
// filtering stays on Ghostery's engine instead of also moving over). Raw
// engine, no Electron-specific glue of its own — unlike
// @ghostery/adblocker-electron, it doesn't know about sessions, webRequest,
// or preload scripts; applyAdBlock below does that wiring by hand.
//
// It's a native module (postinstall runs `cargo build --release` — no
// prebuilt binaries ship in the npm package) — require() throws instead of
// returning if the platform's .node binary isn't there (build failed, wrong
// platform, or a fresh clone that hasn't run `npm install` with a working
// Rust+MSVC toolchain yet). This is exactly the kind of failure the rest of
// the app should survive: loadNetworkEngine() below checks adblockRust and
// throws its own clear error into the *existing* loadAdBlockEngine()
// try/catch (engineStatus becomes 'failed', same UI path as a real network
// fetch failure) instead of this require() crashing the whole main process
// before a single window even opens.
let adblockRust = null;
try {
  adblockRust = require('adblock-rs');
} catch (err) {
  console.error('[adblock] adblock-rs native module failed to load — network ad-blocking will report as failed until this is fixed (see package.json/README for the Rust+MSVC build requirement)', err);
}
const diagnostics = require('./diagnostics');

// Real EasyList/EasyPrivacy-compatible filter engine (Ghostery's
// adblocker-electron, the actively-maintained continuation of the engine
// Brave rewrote in Rust and got a measured 69x speedup from — see project
// history). Subscription categories, Adblock Plus "Filter lists" tab style —
// pick which filter lists build the engine instead of one fixed bundle. URLs
// confirmed live against @ghostery/adblocker-electron's own exported
// adsLists/adsAndTrackingLists/fullLists (the library's own prebuilt
// combos), just split into named categories a user can toggle independently.
// 'ads'+'tracking' together reproduce the exact previous
// fromPrebuiltAdsAndTracking() bundle; 'cookies'+'annoyances' are the extra
// lists fromPrebuiltFull() adds on top (cookie-notice auto-dismiss, social
// widgets/newsletter overlays) — see adBlockFilterLists default in store.js
// for why those two default off.
const FILTER_LIST_CATEGORIES = {
  ads: [
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easylist.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/peter-lowe/serverlist.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/badware.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2020.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2021.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2022.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2023.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2024.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/quick-fixes.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resource-abuse.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/unbreak.txt'
  ],
  tracking: [
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easyprivacy.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/privacy.txt'
  ],
  cookies: [
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/easylist/easylist-cookie.txt',
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/annoyances-cookies.txt'
  ],
  annoyances: [
    'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/annoyances-others.txt'
  ]
};

// Confirmed live: the full engine takes ~1.4s to load on a cold cache (first-
// ever launch, or right after clearing userData) — a request that fires in
// that window would otherwise sail through completely unblocked, unlike the
// old StevenBlack-list implementation, which had a small built-in domain Set
// available synchronously from module load and was never fully unprotected
// even before its fuller list finished fetching. This is that same safety
// net, kept intentionally small (the handful of most common ad/analytics
// hosts) — applyAdBlock only ever consults it while the engine is still
// null, which in practice is a few seconds once per install.
const ADBLOCK_STARTUP_FALLBACK = new Set([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'adservice.google.com', 'connect.facebook.net', 'amazon-adsystem.com',
  'adnxs.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'scorecardresearch.com',
  'quantserve.com', 'hotjar.com', 'mixpanel.com', 'segment.io', 'bat.bing.com', 'analytics.google.com'
]);

const ADBLOCK_ALLOWLIST = new Set([
  'poke.idleworld.online',
  'challenges.cloudflare.com',
  'static.cloudflareinsights.com'
]);

// Shared by every "is this hostname (or one of its parent domains) in this
// set" check below (the static fallback/allowlist Sets, and the paused/
// blocked hostname lists derived from settings) — used to be 4 separate
// copies of this same walk-up-the-domain loop.
function hostMatchesSet(hostname, set) {
  if (!hostname || !set || set.size === 0) return false;
  let h = hostname.toLowerCase();
  while (h.includes('.')) {
    if (set.has(h)) return true;
    h = h.slice(h.indexOf('.') + 1);
  }
  return set.has(h);
}

// Best-effort classification for the dashboard's "qué bloquea" breakdown —
// resourceType alone (script/image/xhr/ping/sub_frame) doesn't say WHY
// something was blocked the way EasyList/EasyPrivacy's own category split
// does, so this maps well-documented real companies/services to the
// category their tracking/ad infrastructure is publicly known for. Anything
// not recognized falls into 'other' rather than being guessed — matches
// this project's live-verification-over-guessing rule.
const HOSTNAME_CATEGORY_MAP = [
  [/(^|\.)doubleclick\.net$|(^|\.)googlesyndication\.com$|(^|\.)googleadservices\.com$|(^|\.)adservice\.google\.|(^|\.)amazon-adsystem\.com$|(^|\.)criteo\.(net|com)$|(^|\.)taboola\.com$|(^|\.)outbrain\.com$|(^|\.)adnxs\.com$|(^|\.)pubmatic\.com$|(^|\.)rubiconproject\.com$|(^|\.)openx\.net$/, 'ads'],
  [/(^|\.)facebook\.net$|(^|\.)facebook\.com$|(^|\.)fbcdn\.net$|(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)tiktok\.com$|(^|\.)linkedin\.com$|(^|\.)pinterest\.com$|(^|\.)reddit\.com$|(^|\.)snapchat\.com$/, 'social'],
  [/(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$|(^|\.)googletagmanager\.com$|(^|\.)hotjar\.com$|(^|\.)mixpanel\.com$|(^|\.)segment\.(io|com)$|(^|\.)scorecardresearch\.com$|(^|\.)quantserve\.com$|(^|\.)amplitude\.com$|(^|\.)bat\.bing\.com$|(^|\.)newrelic\.com$|(^|\.)sentry\.io$/, 'analytics']
];
function categorizeHostname(hostname) {
  if (!hostname) return 'other';
  const h = hostname.toLowerCase();
  for (const [re, category] of HOSTNAME_CATEGORY_MAP) {
    if (re.test(h)) return category;
  }
  return h.includes('track') || h.includes('metric') || h.includes('pixel') ? 'tracking' : 'other';
}

// Electron's webRequest resourceType strings -> the request-type strings
// adblock-rs's Rust core actually parses (confirmed against the upstream
// RequestType::from_str match arms in brave/adblock-rust's src/request.rs,
// not guessed): main_frame/sub_frame/csp_report/websocket use an underscored
// or differently-cased form there; script/image/stylesheet/font/object/
// media/ping/xhr are already identical strings on both sides, so this table
// only needs entries where they diverge — anything else passes through
// unchanged and an unrecognized value already falls back to "other" on the
// Rust side.
const RESOURCE_TYPE_TO_ADBLOCK_RS = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  cspReport: 'csp_report',
  webSocket: 'websocket'
};
function mapElectronResourceType(resourceType) {
  return RESOURCE_TYPE_TO_ADBLOCK_RS[resourceType] || resourceType || 'other';
}

// Simple 3-position preset the shield popup's mode slider drives — see
// adBlockMode's comment in store.js. 'cookies'/'annoyances' are reserved for
// 'super' only — confirmed live this session that a real "video ya no está
// disponible" YouTube page is NOT actually caused by our engine (reproduced
// the exact same page with protectionLevel:'off', same result — it's a real
// takedown on that specific video, unrelated), but those two lists are still
// new/unproven compared to the ads+tracking combo this app has shipped
// safely for months, so 'normal' (the default) deliberately stays at that
// already-proven baseline.
const ADBLOCK_MODE_PRESETS = {
  standard: { protectionLevel: 'standard', filterLists: { ads: true, tracking: false, cookies: false, annoyances: false } },
  normal: { protectionLevel: 'standard', filterLists: { ads: true, tracking: true, cookies: false, annoyances: false } },
  super: { protectionLevel: 'strict', filterLists: { ads: true, tracking: true, cookies: true, annoyances: true } }
};

// How many distinct hostnames data.adBlockStats.byHost keeps — a long-
// running install would otherwise grow this file unbounded, one entry per
// unique blocked hostname ever seen (real sites hit hundreds).
const AD_BLOCK_STATS_HOST_CAP = 200;
// Diagnostic ring buffer, per account — doesn't change any block/allow
// decision, just makes what got blocked inspectable (diagnostics.js export)
// instead of only a running count. Capped so a chatty page can't grow this
// unbounded over a multi-day session.
const AD_BLOCK_LOG_CAP = 500;

function createAdblockManager({ getData, persist, broadcastState, getAccount }) {
  // Two engines, split by what each is actually used for — see the header
  // comment on the adblock-rs require() above:
  //  - networkEngine (adblock-rs / Brave's native engine): the real
  //    block/allow decision for every network request. This is what
  //    isEngineReady()/engineStatus report, and what protectionLevel gates.
  //  - cosmeticEngine (Ghostery's engine, unchanged from before this pass):
  //    CSS-hides leftover ad slots after a request is already blocked.
  //    Doesn't gate protection status — if it fails to load, network
  //    blocking above is completely unaffected, only the visual cleanup is
  //    missing until the next successful rebuild.
  let networkEngine = null;
  let cosmeticEngine = null;
  // Real health state for the popup/diagnostics — isEngineReady() alone
  // (a boolean) can't distinguish "still building on first launch" from
  // "the fetch failed and nothing will ever load until a restart", which
  // looked identical to the UI before this. 'loading' is the state from
  // module init until the first loadAdBlockEngine() call resolves either
  // way; a later rebuild (mode/filter-list change) re-enters 'loading' too,
  // same as the very first load.
  let engineStatus = 'loading'; // 'loading' | 'ready' | 'failed'
  let engineLastError = null;
  const blockedCounts = new Map(); // accountId -> count
  // Distinct hostnames this account's CURRENT page has contacted (blocked or
  // allowed) — reset on every real navigation (resetPageAdBlockStats), never
  // on SPA route changes — a same-page pushState wouldn't actually re-issue
  // most of these requests.
  const pageDomainsSeen = new Map(); // accountId -> Set<hostname>
  const pageDomainsBlocked = new Map(); // accountId -> Set<hostname>
  const pageRequestsTotal = new Map(); // accountId -> count, for the popup's blocked-% figure
  const adBlockLog = new Map(); // accountId -> array of {url, hostname, resourceType, initiator, accountId, timestamp}
  // data.settings.adBlockPausedSites/adBlockManualBlocklist are plain arrays
  // (JSON-serializable for persist()); this WeakMap caches the Set built
  // from whichever array is CURRENTLY assigned there, so isSitePaused/
  // isManuallyBlocked — called on every network request for every open
  // account — don't rebuild a Set from scratch every time. Every write to
  // either array replaces it with a new array (Array.from(list) in
  // toggleHostInList), so the cache invalidates itself for free: the old
  // array (and its cached Set) just becomes garbage.
  const derivedHostSetCache = new WeakMap();

  function hostSetFor(list) {
    if (!list) return null;
    let set = derivedHostSetCache.get(list);
    if (!set) {
      set = new Set(list);
      derivedHostSetCache.set(list, set);
    }
    return set;
  }

  function matchesStartupFallback(hostname) {
    return hostMatchesSet(hostname, ADBLOCK_STARTUP_FALLBACK);
  }
  function isAllowlistedHost(hostname) {
    return hostMatchesSet(hostname, ADBLOCK_ALLOWLIST);
  }
  // User-controlled "pause on this site" list — distinct from
  // ADBLOCK_ALLOWLIST above, which is a fixed safety list the user can't
  // edit. Same subdomain-matching rule as isAllowlistedHost.
  function isSitePaused(hostname) {
    return hostMatchesSet(hostname, hostSetFor(getData().settings.adBlockPausedSites));
  }
  // "Force Block Page" — the opposite of isSitePaused: force-blocks a
  // hostname (network AND the top-level navigation itself) regardless of
  // protectionLevel/adBlockMode, even while master protection is off.
  // Checked first in applyAdBlock, ahead of everything else.
  function isManuallyBlocked(hostname) {
    return hostMatchesSet(hostname, hostSetFor(getData().settings.adBlockManualBlocklist));
  }

  function activeFilterListUrls() {
    const enabled = getData().settings.adBlockFilterLists || {};
    const urls = [];
    for (const key of Object.keys(FILTER_LIST_CATEGORIES)) {
      if (enabled[key]) urls.push(...FILTER_LIST_CATEGORIES[key]);
    }
    // Always at least the ads list — an all-off selection would otherwise
    // silently build an empty engine that matches nothing, indistinguishable
    // from a bug. protectionLevel:'off' is the real way to fully disable.
    return urls.length > 0 ? urls : FILTER_LIST_CATEGORIES.ads;
  }

  // One cache file per distinct category combination (16 possible combos of
  // the 4 booleans) so switching categories back and forth doesn't re-fetch
  // ~15MB of filter lists from GitHub every time — only the very first time
  // a given combination is selected. Shared by both engines, distinguished
  // by `prefix` — their serialize() formats aren't compatible with each
  // other, so a network-engine cache path always needs a different filename
  // than the cosmetic-engine one, or one engine's deserialize() would choke
  // on bytes the other one wrote. The old adblock-engine-cache-*.bin files
  // (Ghostery, pre-existing) and the newer adblock-rs-engine-cache-*.bin
  // ones (adblock-rs) never collide as long as the prefixes stay distinct.
  function cacheFileFor(app, enabled, prefix) {
    const suffix = Object.keys(FILTER_LIST_CATEGORIES)
      .filter((key) => enabled[key])
      .sort()
      .join('-') || 'none';
    return path.join(app.getPath('userData'), `${prefix}-${suffix}.bin`);
  }

  async function fetchFilterListsText(urls) {
    const texts = await Promise.all(urls.map((url) => fetch(url).then((r) => r.text())));
    return texts.join('\n');
  }

  // adblock-rs's own network-matching engine (Brave's native Rust engine —
  // see the require() header comment). Built with RuleTypes.NETWORK_ONLY:
  // cosmetic rules still stay on Ghostery's engine below, so there's no
  // reason to also parse/index them here — that would just double the
  // memory cost of the one thing this pass was supposed to *not* make worse.
  //
  // NOTE — scope cut, deliberate: $redirect=/##+js() scriptlet resources are
  // NOT loaded here (no useResources() call). adblock-rs expects uBlock
  // Origin's raw resource files (web_accessible_resources/, redirect-
  // resources.js, scriptlets.js) as local files, not a couple of fetchable
  // URLs the way filter lists are — mirroring uBO's whole resource-asset
  // layout is real, separate scope, not something to half-build inside this
  // pass. The vast majority of EasyList/uBO rules are plain network block
  // rules and are completely unaffected; only the minority that specify
  // $redirect= won't get their substitution effect until this is revisited.
  async function loadNetworkEngine(app, enabled, customRules) {
    if (!adblockRust) {
      throw new Error('adblock-rs native module is not available (see the require() at the top of this file) — network blocking cannot start');
    }
    if (!customRules) {
      const cachePath = cacheFileFor(app, enabled, 'adblock-rs-engine-cache');
      try {
        const cached = await fs.promises.readFile(cachePath);
        // deserialize() downcasts strictly to a real ArrayBuffer — a Node
        // Buffer (what readFile() returns) is a Uint8Array VIEW over one,
        // not an ArrayBuffer itself, and gets rejected as-is (confirmed live
        // — "failed to downcast any to JsArrayBuffer" — before adding this
        // slice). .buffer alone isn't safe either: Node may back a Buffer
        // with a larger pooled ArrayBuffer, so the slice has to be bounded
        // by byteOffset/byteLength or it'd hand over unrelated pool bytes.
        const cachedArrayBuffer = cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
        const cachedEngine = new adblockRust.Engine(new adblockRust.FilterSet());
        cachedEngine.deserialize(cachedArrayBuffer);
        return cachedEngine;
      } catch {
        // No cache yet (first time this category combo is selected) or the
        // cached bytes are stale/unreadable (e.g. an adblock-rs version
        // bump changed the serialize format) — fall through to a real build.
      }
      const text = await fetchFilterListsText(activeFilterListUrls());
      const filterSet = new adblockRust.FilterSet(false);
      filterSet.addFilters(text, { rule_types: adblockRust.RuleTypes.NETWORK_ONLY });
      const engine = new adblockRust.Engine(filterSet);
      try {
        await fs.promises.writeFile(cachePath, Buffer.from(engine.serialize()));
      } catch (err) {
        console.error('[adblock] failed to write network engine cache (non-fatal — engine still works, just rebuilds every launch)', err);
      }
      return engine;
    }
    // Custom rules can change any time from the dashboard or the element
    // picker, so they can't go through the binary cache — fetch + parse
    // every time, same tradeoff the cosmetic engine below already accepts
    // for the same reason.
    const text = await fetchFilterListsText(activeFilterListUrls());
    const filterSet = new adblockRust.FilterSet(false);
    filterSet.addFilters([text, customRules].join('\n'), { rule_types: adblockRust.RuleTypes.NETWORK_ONLY });
    return new adblockRust.Engine(filterSet);
  }

  // Ghostery's engine, used only for cosmetic filtering now (see the two-
  // engines comment on the networkEngine/cosmeticEngine declarations above)
  // — otherwise identical to how the single engine used to be built before
  // this pass, just relocated into its own function so loadAdBlockEngine can
  // build both engines in parallel.
  async function loadCosmeticEngine(app, enabled, customRules) {
    if (!customRules) {
      return ElectronBlocker.fromLists(fetch, activeFilterListUrls(), {}, {
        path: cacheFileFor(app, enabled, 'adblock-engine-cache'),
        read: (p) => fs.promises.readFile(p),
        write: (p, buf) => fs.promises.writeFile(p, buf)
      });
    }
    const [lists, resources] = await Promise.all([
      fetchLists(fetch, activeFilterListUrls()),
      fetchResources(fetch)
    ]);
    const engine = ElectronBlocker.parse([...lists, customRules].join('\n'));
    if (resources) engine.updateResources(resources, '' + resources.length);
    return engine;
  }

  function emptyCategoryCounts() {
    return { ads: 0, tracking: 0, social: 0, analytics: 0, other: 0 };
  }
  // Per-page breakdown by category (shield popup "qué se bloqueó" detail,
  // Brave-Shields-style) — separate from stats.byCategory in store.js, which
  // is lifetime-since-install and never resets. Reset alongside the other
  // per-page maps below on every real navigation.
  const pageCategoryBlocked = new Map(); // accountId -> {ads,tracking,social,analytics,other}

  function resetPageAdBlockStats(accountId) {
    blockedCounts.set(accountId, 0);
    pageDomainsSeen.set(accountId, new Set());
    pageDomainsBlocked.set(accountId, new Set());
    pageRequestsTotal.set(accountId, 0);
    pageCategoryBlocked.set(accountId, emptyCategoryCounts());
  }

  // recordAdBlockStat used to call the injected persist() (main.js's fast,
  // 400ms-debounced write) directly on every single blocked request — on a
  // page with a steady stream of ads/trackers that meant the FULL store
  // (accounts, history, passwords, settings, not just these counters) kept
  // rewriting to disk every ~400ms for as long as browsing continued. This
  // debounce is deliberately longer (5s) and only covers stat-only changes;
  // anything else that calls the injected persist() directly (a real
  // settings/account change) still gets the fast, snappy 400ms path.
  const STATS_PERSIST_DEBOUNCE_MS = 5000;
  let statsPersistTimer = null;
  function persistStatsDebounced() {
    if (statsPersistTimer) return;
    statsPersistTimer = setTimeout(() => {
      statsPersistTimer = null;
      persist();
    }, STATS_PERSIST_DEBOUNCE_MS);
  }
  // Called from main.js right before flushPersist() on quit — flushPersist()
  // only knows about its own persistDirty/persistTimer, not this module's
  // separate slow debounce, so without this a graceful quit could drop up to
  // 5s of ad-block stats that a crash-safety flush would otherwise catch.
  function flushAdBlockStatsPersist() {
    if (statsPersistTimer) {
      clearTimeout(statsPersistTimer);
      statsPersistTimer = null;
      persist();
    }
  }

  function recordAdBlockStat(hostname, category) {
    const stats = getData().adBlockStats;
    stats.total += 1;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.byHost[hostname] = (stats.byHost[hostname] || 0) + 1;
    const hosts = Object.keys(stats.byHost);
    if (hosts.length > AD_BLOCK_STATS_HOST_CAP) {
      // Drop the least-seen hostnames first — keeps the file bounded without
      // losing the domains that actually matter to the user.
      hosts
        .sort((a, b) => stats.byHost[a] - stats.byHost[b])
        .slice(0, hosts.length - AD_BLOCK_STATS_HOST_CAP)
        .forEach((h) => delete stats.byHost[h]);
    }
    persistStatsDebounced();
  }

  function recordAdBlockEntry(accountId, entry) {
    let log = adBlockLog.get(accountId);
    if (!log) {
      log = [];
      adBlockLog.set(accountId, log);
    }
    diagnostics.pushCapped(log, entry, AD_BLOCK_LOG_CAP);
    recordAdBlockStat(entry.hostname, entry.category);
    let pageCounts = pageCategoryBlocked.get(accountId);
    if (!pageCounts) {
      pageCounts = emptyCategoryCounts();
      pageCategoryBlocked.set(accountId, pageCounts);
    }
    pageCounts[entry.category] = (pageCounts[entry.category] || 0) + 1;
  }

  // Async and called after the first window is up — building/loading the
  // filter engine (parses ~7MB of compiled filter data on a cold cache)
  // shouldn't block the very first paint. Adblock isn't needed until a page
  // actually loads in some account view, well after the window itself has
  // appeared. Until this resolves, applyAdBlock's handler below allows
  // everything through rather than queuing requests on it — a brief
  // unprotected window on first-ever launch (or after clearing the cache
  // file), never on any launch after that since the cache load is ~30ms.
  // Guards against two overlapping loads racing: category-combination cache
  // hits vs. misses (or the custom-rules network-fetch path) have wildly
  // different latencies, so a rebuild triggered by an OLDER settings change
  // can finish after a NEWER one and silently overwrite it — leaving
  // networkEngine/engineStatus reporting 'ready' for a build that no longer
  // matches the currently-selected filter lists. Each call captures its own
  // generation number and only commits its result if no newer call has
  // started in the meantime; a stale result is simply discarded (the newer
  // call is already in flight and will report its own outcome).
  let loadGeneration = 0;

  async function loadAdBlockEngine() {
    const myGeneration = ++loadGeneration;
    engineStatus = 'loading';
    engineLastError = null;
    try {
      const { app } = require('electron');
      const enabled = getData().settings.adBlockFilterLists || {};
      const customRules = (getData().settings.adBlockCustomRules || []).join('\n').trim();

      // Both engines built in parallel — same total wall-clock cost as
      // building just one used to be, not the sum of both. cosmeticEngine is
      // best-effort: a failure there degrades cosmetic hiding only, and
      // shouldn't fail protection outright, since networkEngine is what
      // actually gates protectionLevel/blocking. Promise.allSettled (not
      // Promise.all) is what makes that split possible — an
      // ElectronBlocker.fromLists() rejection can't take networkEngine down
      // with it.
      const [networkResult, cosmeticResult] = await Promise.allSettled([
        loadNetworkEngine(app, enabled, customRules),
        loadCosmeticEngine(app, enabled, customRules)
      ]);

      if (myGeneration !== loadGeneration) return; // superseded by a newer rebuild — discard

      // Commit whichever engine(s) actually succeeded BEFORE checking for a
      // network failure to throw on — cosmeticEngine used to only get
      // assigned after that check, so a machine where adblock-rs's native
      // module never builds (no Rust/MSVC toolchain — loadNetworkEngine()
      // throws on every single call, forever) silently lost cosmetic ad-slot
      // hiding too, even though Ghostery's engine built fine every time.
      if (cosmeticResult.status === 'fulfilled') {
        cosmeticEngine = cosmeticResult.value;
      } else {
        console.error('[adblock] cosmetic engine failed to load (network blocking is unaffected either way)', cosmeticResult.reason);
      }

      if (networkResult.status === 'rejected') throw networkResult.reason;
      networkEngine = networkResult.value;

      engineStatus = 'ready';
      console.log('[adblock] engine ready');
    } catch (err) {
      if (myGeneration !== loadGeneration) return; // superseded by a newer rebuild — discard
      engineStatus = 'failed';
      engineLastError = err && err.message ? err.message : String(err);
      console.error('[adblock] failed to load filter engine', err);
    }
  }

  // Called when the user changes adBlockFilterLists from the dashboard —
  // the old engines keep serving requests (neither is cleared) until the new
  // ones finish loading, so toggling a category never opens the
  // ADBLOCK_STARTUP_FALLBACK gap the way the very first launch does.
  async function rebuildAdBlockEngine() {
    await loadAdBlockEngine();
  }

  // One session per account (persist:account-<id>) — register the cosmetic
  // frame preload at most once per session, since applyAdBlock runs again on
  // stability "profile limpio" resets and other session re-wires.
  const cosmeticPreloadSessions = new WeakSet();
  function enableCosmeticFiltering(ses) {
    if (cosmeticPreloadSessions.has(ses)) return;
    cosmeticPreloadSessions.add(ses);
    ses.registerPreloadScript({ type: 'frame', filePath: ADBLOCKER_COSMETIC_PRELOAD });
  }

  // The two IPC channels the cosmetic preload script talks to are global
  // (channel names, not per-session), so these are registered exactly once —
  // gating (protectionLevel off / allowlisted / paused site) happens here
  // rather than at the preload script itself, since the engine and settings
  // can change after the preload script already loaded into a live page.
  let cosmeticIpcRegistered = false;
  function registerCosmeticIpcHandlers() {
    if (cosmeticIpcRegistered) return;
    cosmeticIpcRegistered = true;
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
      if (!cosmeticEngine) return;
      if ((getData().settings.protectionLevel || 'standard') === 'off') return;
      const hostname = hostnameFromUrlLike(url);
      if (!hostname) return;
      if (isAllowlistedHost(hostname) || isSitePaused(hostname)) return;
      return cosmeticEngine.onInjectCosmeticFilters(event, url, msg);
    });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => {
      return !!(cosmeticEngine && cosmeticEngine.config && cosmeticEngine.config.enableMutationObserver);
    });
  }

  // Three levels instead of a blind on/off, matching the shape of Firefox's
  // Enhanced Tracking Protection (Estándar/Estricto) rather than a single
  // checkbox: 'off' blocks nothing; 'standard' is the previous behavior
  // (known ad/tracker hosts, subresources only — the top-level navigation
  // itself is exempt so a listed host typed directly into the address bar
  // still loads); 'strict' additionally blocks a listed host used AS the
  // navigation target, plus every resourceType 'ping' request regardless of
  // host.
  function applyAdBlock(ses, accountId) {
    enableCosmeticFiltering(ses);
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const hostname = hostnameFromUrlLike(details.url);
      if (!hostname) {
        callback({});
        return;
      }
      // "Domains connected" in the shield popup — real network activity for
      // the current page, tracked regardless of protectionLevel (matches
      // uBlock Origin's own popup: this line describes what the page is
      // doing, not what got blocked). Never touches decisions below.
      let seen = pageDomainsSeen.get(accountId);
      if (!seen) {
        seen = new Set();
        pageDomainsSeen.set(accountId, seen);
      }
      seen.add(hostname);
      pageRequestsTotal.set(accountId, (pageRequestsTotal.get(accountId) || 0) + 1);

      if (isManuallyBlocked(hostname)) {
        blockedCounts.set(accountId, (blockedCounts.get(accountId) || 0) + 1);
        let forcedBlockedSet = pageDomainsBlocked.get(accountId);
        if (!forcedBlockedSet) { forcedBlockedSet = new Set(); pageDomainsBlocked.set(accountId, forcedBlockedSet); }
        forcedBlockedSet.add(hostname);
        recordAdBlockEntry(accountId, {
          url: details.url,
          hostname,
          resourceType: details.resourceType,
          initiator: details.initiator || null,
          accountId,
          timestamp: Date.now(),
          category: categorizeHostname(hostname)
        });
        callback({ cancel: true });
        return;
      }

      const level = getData().settings.protectionLevel || 'standard';
      if (level === 'off') {
        callback({});
        return;
      }
      if (details.resourceType === 'mainFrame' && level !== 'strict') {
        callback({});
        return;
      }
      if (isAllowlistedHost(hostname) || isSitePaused(hostname)) {
        callback({});
        return;
      }
      if (!networkEngine) {
        // Full engine not loaded yet (see the comment on
        // ADBLOCK_STARTUP_FALLBACK) — small built-in list instead of nothing.
        const blocked = matchesStartupFallback(hostname) || (level === 'strict' && details.resourceType === 'ping');
        callback(blocked ? { cancel: true } : {});
        if (blocked) {
          blockedCounts.set(accountId, (blockedCounts.get(accountId) || 0) + 1);
          let blockedSet = pageDomainsBlocked.get(accountId);
          if (!blockedSet) { blockedSet = new Set(); pageDomainsBlocked.set(accountId, blockedSet); }
          blockedSet.add(hostname);
          recordAdBlockEntry(accountId, {
            url: details.url,
            hostname,
            resourceType: details.resourceType,
            initiator: details.initiator || null,
            accountId,
            timestamp: Date.now(),
            category: categorizeHostname(hostname)
          });
        }
        return;
      }
      // details.referrer needs to be there for correct first-party/third-
      // party classification — confirmed live (same finding that used to
      // apply to fromElectronDetails with the old engine) that filter
      // matching silently returns false without it, even for an obviously-ad
      // domain like doubleclick.net. Falls back to the request's own URL on
      // a top-level navigation, where referrer is legitimately empty.
      //
      // networkEngine.check() is a native call that THROWS a real JS
      // exception on a URL/source-URL it can't parse (confirmed against
      // adblock-rs's own Rust source, js/src/lib.rs's engine_check —
      // Request::new(...) returns a Result, and Err maps to
      // cx.throw_error(...)) — a malformed or unusual IDN/punycode hostname
      // is enough to trigger it. Electron's webRequest contract requires
      // callback() to be called no matter what, so an uncaught throw here
      // would leave that one request hanging forever instead of just not
      // being blocked. Fails open (doesn't block that one request) rather
      // than closed — consistent with every other "can't evaluate this
      // request" branch in this function (the ADBLOCK_STARTUP_FALLBACK path
      // above, an unparseable hostname at the top of this handler) already
      // choosing to let a request through over risking one it can't judge.
      let networkMatched = false;
      try {
        networkMatched = networkEngine.check(
          details.url,
          details.referrer || details.url,
          mapElectronResourceType(details.resourceType),
          details.method || 'GET'
        );
      } catch (err) {
        console.error('[adblock] networkEngine.check() threw for', details.url, '— letting this one request through unblocked', err);
      }
      const blocked = networkMatched || (level === 'strict' && details.resourceType === 'ping');
      if (blocked) {
        blockedCounts.set(accountId, (blockedCounts.get(accountId) || 0) + 1);
        let blockedSet = pageDomainsBlocked.get(accountId);
        if (!blockedSet) { blockedSet = new Set(); pageDomainsBlocked.set(accountId, blockedSet); }
        blockedSet.add(hostname);
        recordAdBlockEntry(accountId, {
          url: details.url,
          hostname,
          resourceType: details.resourceType,
          initiator: details.initiator || null,
          accountId,
          timestamp: Date.now(),
          category: categorizeHostname(hostname)
        });
        callback({ cancel: true });
      } else {
        callback({});
      }
    });
  }

  function getBlockedCount(accountId) {
    return blockedCounts.get(accountId) || 0;
  }

  function getLogForAccount(accountId) {
    return adBlockLog.get(accountId) || null;
  }

  // Reports networkEngine's readiness, not cosmeticEngine's — networkEngine
  // is what actually gates block/allow decisions; cosmeticEngine is a
  // best-effort visual extra (see the two-engines comment on their
  // declarations above), so its own failure shouldn't read as "protection
  // isn't working" to the user.
  function isEngineReady() {
    return !!networkEngine;
  }

  function getEngineStatus() {
    return {
      status: engineStatus,
      ready: !!networkEngine,
      lastError: engineLastError
    };
  }

  // Removes every per-account Map entry this module owns — called from
  // removeAccountCompletely() in main.js so an account's bookkeeping doesn't
  // leak for the rest of the process's lifetime.
  function cleanupAccount(accountId) {
    blockedCounts.delete(accountId);
    pageDomainsSeen.delete(accountId);
    pageDomainsBlocked.delete(accountId);
    pageRequestsTotal.delete(accountId);
    pageCategoryBlocked.delete(accountId);
    adBlockLog.delete(accountId);
  }

  // Shared by both toggle handlers below: normalize hostname → toggle its
  // membership in a settings array → persist + broadcast. `settingsKey` is
  // which array (adBlockPausedSites or adBlockManualBlocklist); the caller
  // maps the generic `active` result to whatever field name its own API
  // promises.
  function toggleHostInList(settingsKey, hostname) {
    const data = getData();
    const h = String(hostname || '').toLowerCase().trim();
    if (!h) return { ok: false, active: false };
    const list = new Set(data.settings[settingsKey] || []);
    const wasActive = list.has(h);
    if (wasActive) list.delete(h); else list.add(h);
    data.settings[settingsKey] = Array.from(list);
    persist();
    broadcastState();
    return { ok: true, active: !wasActive };
  }

  function registerIpcHandlers() {
    // Exposes the adBlockLog ring buffer (already collected for
    // diagnostics.js's export report) directly to the toolbar shield icon's
    // dropdown — so "N blocked" isn't just a number, the user can see
    // exactly which hostnames were blocked for the account they're looking
    // at right now.
    ipcMain.handle('adblock:getLog', (_e, { id }) => {
      const log = adBlockLog.get(id) || [];
      return log.slice(-30).reverse();
    });

    ipcMain.handle('adblock:isEngineReady', () => isEngineReady());
    ipcMain.handle('adblock:getEngineStatus', () => getEngineStatus());

    // "Pausar en este sitio" (quick whitelist) — same concept ABP/uBlock
    // expose from their toolbar icon: fully allow one hostname (network +
    // cosmetic) regardless of protectionLevel, without turning protection
    // off everywhere. Also used for the popup's free-text "add to
    // whitelist" input, not just the current site — hostname there comes
    // from whatever the user typed.
    ipcMain.handle('adblock:toggleSitePause', (_e, { hostname }) => {
      const r = toggleHostInList('adBlockPausedSites', hostname);
      return { ok: r.ok, paused: r.active };
    });

    // "Force Block Page" — adds/removes a hostname from adBlockManualBlocklist
    // (see isManuallyBlocked). Unlike toggleSitePause this doesn't need an
    // engine rebuild — isManuallyBlocked is checked directly against
    // data.settings on every request, same as isSitePaused already was.
    ipcMain.handle('adblock:toggleSiteBlock', (_e, { hostname }) => {
      const r = toggleHostInList('adBlockManualBlocklist', hostname);
      return { ok: r.ok, blocked: r.active };
    });

    // Mode slider (Estándar/Normal/Súper Bloqueo) — writes protectionLevel +
    // adBlockFilterLists together from ADBLOCK_MODE_PRESETS. adBlockFilterLists
    // is applied unconditionally (even while master protection is off) so a
    // mode picked while off is already in place — ready the instant the
    // user re-enables — instead of being silently dropped the way
    // protectionLevel is deliberately left at 'off' below (moving the
    // slider shouldn't silently re-enable blocking out from under an
    // explicit off toggle).
    ipcMain.handle('adblock:setMode', async (_e, { mode }) => {
      const data = getData();
      if (!ADBLOCK_MODE_PRESETS[mode]) return { ok: false };
      data.settings.adBlockMode = mode;
      const preset = ADBLOCK_MODE_PRESETS[mode];
      data.settings.adBlockFilterLists = { ...preset.filterLists };
      const masterOn = (data.settings.protectionLevel || 'standard') !== 'off';
      if (masterOn) data.settings.protectionLevel = preset.protectionLevel;
      persist();
      broadcastState();
      if (masterOn) await rebuildAdBlockEngine();
      return { ok: true };
    });

    // The big power toggle — on/off only, independent of which mode is
    // selected. Deliberately does NOT touch adBlockFilterLists — setMode
    // above already keeps it in sync with whichever mode is selected (even
    // while off), so leaving it alone here preserves any "Avanzado"
    // checkbox customization the user layered on top instead of silently
    // reverting it to the mode's preset every time protection is toggled
    // off and back on.
    ipcMain.handle('adblock:setMasterEnabled', async (_e, { enabled }) => {
      const data = getData();
      if (enabled) {
        const preset = ADBLOCK_MODE_PRESETS[data.settings.adBlockMode] || ADBLOCK_MODE_PRESETS.normal;
        data.settings.protectionLevel = preset.protectionLevel;
      } else {
        data.settings.protectionLevel = 'off';
      }
      persist();
      broadcastState();
      await rebuildAdBlockEngine();
      return { ok: true };
    });

    // Whole-text replace, same UX as uBlock Origin's "My filters" box — the
    // renderer sends the full textarea content, split back into one rule
    // per line here. Skips the rebuild while master protection is off —
    // nothing observable changes until the user re-enables protection, and
    // for custom rules a rebuild means a real network refetch of every
    // filter list.
    ipcMain.handle('adblock:setCustomRules', async (_e, { text }) => {
      const data = getData();
      const lines = String(text || '').split('\n').map((l) => l.trimEnd());
      data.settings.adBlockCustomRules = lines.filter((l) => l.trim().length > 0);
      persist();
      broadcastState();
      if ((data.settings.protectionLevel || 'standard') !== 'off') await rebuildAdBlockEngine();
      return { ok: true };
    });

    // "Avanzado" toggles in the shield popup — fine-tune individual filter-
    // list categories beyond the 3 presets the mode slider offers. Writing
    // here doesn't change adBlockMode itself, so the mode slider only shows
    // a preset as active while modeMatchesPreset (getPopupData) still holds.
    ipcMain.handle('adblock:setFilterLists', async (_e, { lists }) => {
      const data = getData();
      if (!lists || typeof lists !== 'object') return { ok: false };
      const next = { ...data.settings.adBlockFilterLists };
      for (const key of Object.keys(FILTER_LIST_CATEGORIES)) {
        if (key in lists) next[key] = !!lists[key];
      }
      data.settings.adBlockFilterLists = next;
      persist();
      broadcastState();
      if ((data.settings.protectionLevel || 'standard') !== 'off') await rebuildAdBlockEngine();
      return { ok: true, filterLists: next };
    });

    // Single call backing the whole shield popup — status/mode, per-page
    // counters (reset on real navigation by resetPageAdBlockStats), lifetime
    // stats, and every list the popup renders (paused sites, manual
    // blocklist, custom rules), so the renderer never has to separately
    // re-derive any of it from state.settings.
    ipcMain.handle('adblock:getPopupData', (_e, { id }) => {
      const data = getData();
      const account = getAccount(id);
      const hostname = account && account.url ? hostnameFromUrlLike(account.url) : '';
      const level = data.settings.protectionLevel || 'standard';
      // A static ADBLOCK_ALLOWLIST entry (Cloudflare Turnstile domains etc.)
      // is NOT something the pause button should offer to "resume" —
      // toggling it would add a redundant user-pause entry for a site that
      // was never actually paused by the user. Shown as always-on and
      // disabled instead.
      const staticallyAllowed = isAllowlistedHost(hostname);
      const mode = data.settings.adBlockMode || 'normal';
      // Whether the live filterLists still match the selected mode's preset
      // — an "Avanzado" checkbox edit can diverge from it without changing
      // adBlockMode itself. The popup only highlights the mode button when
      // this is true, instead of claiming a preset is active when the real
      // configuration no longer matches it.
      const modePreset = ADBLOCK_MODE_PRESETS[mode];
      const currentFilterLists = data.settings.adBlockFilterLists || {};
      const modeMatchesPreset = !!modePreset && Object.keys(FILTER_LIST_CATEGORIES)
        .every((key) => !!currentFilterLists[key] === !!modePreset.filterLists[key]);
      const stats = data.adBlockStats;
      const topHosts = Object.entries(stats.byHost)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([h, count]) => ({ hostname: h, count }));
      return {
        hostname,
        mode,
        modeMatchesPreset,
        masterEnabled: level !== 'off',
        paused: isSitePaused(hostname),
        blocked: isManuallyBlocked(hostname),
        staticallyAllowed,
        blockedOnPage: blockedCounts.get(id) || 0,
        requestsOnPage: pageRequestsTotal.get(id) || 0,
        blockedByCategoryOnPage: { ...(pageCategoryBlocked.get(id) || emptyCategoryCounts()) },
        totalSinceInstall: stats.total,
        byCategory: { ...stats.byCategory },
        topHosts,
        pausedSites: data.settings.adBlockPausedSites || [],
        manualBlocklist: data.settings.adBlockManualBlocklist || [],
        customRules: data.settings.adBlockCustomRules || [],
        filterLists: data.settings.adBlockFilterLists,
        engineReady: !!networkEngine,
        engineStatus: getEngineStatus()
      };
    });
  }

  return {
    applyAdBlock,
    loadAdBlockEngine,
    rebuildAdBlockEngine,
    resetPageAdBlockStats,
    registerCosmeticIpcHandlers,
    registerIpcHandlers,
    getBlockedCount,
    getLogForAccount,
    isEngineReady,
    getEngineStatus,
    cleanupAccount,
    flushAdBlockStatsPersist,
    // Exported for unit tests (test/unit/adblock-stats-persist.test.js) —
    // otherwise recordAdBlockStat/recordAdBlockEntry are only ever called
    // internally, reachable in production only through a real blocked
    // network request inside applyAdBlock's onBeforeRequest handler.
    recordAdBlockStat,
    recordAdBlockEntry,
    getBlockedByCategoryOnPage: (accountId) => ({ ...(pageCategoryBlocked.get(accountId) || emptyCategoryCounts()) })
  };
}

module.exports = { createAdblockManager, FILTER_LIST_CATEGORIES, mapElectronResourceType };
