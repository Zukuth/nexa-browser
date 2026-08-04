// Fase A del motor de telemetría en tiempo real para cuentas de
// poke.idleworld.online. Lee los frames WebSocket que el propio juego ya
// transmite (protocolo JSON documentado, no DOM) vía el debugger CDP de
// Chromium — igual que hace https://github.com/AntonioFleck/poke-idle-launcher.
// Cada cuenta es un <webview> real (ver wireAccountWebContents en main.js);
// attachCapture() recibe su webContents directo. Nunca inyecta comandos,
// nunca automatiza clicks/capturas: es observación de red de solo lectura.
//
// Por qué CDP y no un parche de window.WebSocket (como hace PokeGrid): CDP se
// adjunta ANTES de loadURL() y Network.enable ve toda la actividad de red a
// nivel de proceso, así que no depende de ganarle una carrera a la propia
// conexión WebSocket del juego. Un parche inyectado después de did-finish-load
// puede perderse la conexión si el juego ya conectó antes de que el script
// corra.
//
// `goldPerHour` = oro de capturas (sellValue, del frame poke-delta) + oro de
// vender el loot de las kills - costo de las bolas gastadas — el mismo
// "Balance (Loot + Captures - Supply)" que ya muestra el propio "Hunt
// Analyzer" del juego. Los precios de venta de items NO vienen en los
// frames de WebSocket; se confirmó que el juego los sirve como JSON
// estático en /game/items.json (mismo origen, sin auth) — verificado
// contra el propio Hunt Analyzer real (Bird Beak: npcPrice 30 × 212 =
// $6.360, exacto). El costo de bolas usa el catálogo de precios que sí
// viaja por WS en el frame `balls` (priceGold por ballId), cruzado con
// cuántas se gastaron por catch-result — también verificado exacto
// (575 Ultra Ball × $130 = $74.750).

const GAME_HOSTNAME = 'poke.idleworld.online';
const HEARTBEAT_STALE_MS = 60_000;
const HEARTBEAT_CHECK_MS = 15_000;
const MAX_REASONABLE_DIAMONDS = 10_000_000;

// Configurable from the "Poke Idle" settings tab (Fase C alerts).
let ballsLowThreshold = 20;
function setBallsLowThreshold(n) {
  if (typeof n === 'number' && n >= 0) ballsLowThreshold = n;
}

// Umbrales oficiales de rareza del juego (pokepedia /systems/quality),
// replicados del schema documentado en el launcher de referencia.
const RARITY_THRESHOLDS = [
  [1.0, 'Fraca'], [1.1, 'Comum'], [1.3, 'Incomum'], [1.5, 'Rara'],
  [1.7, 'Épica'], [2.0, 'Lendária'], [3.0, 'Mythic'], [4.0, 'Ancient']
];

function rarityFromQuality(q) {
  if (q == null) return null;
  for (const [max, label] of RARITY_THRESHOLDS) {
    if (q < max) return label;
  }
  return 'Divine';
}

function isGameUrl(url) {
  try {
    const u = new URL(url);
    // Excludes /login on purpose: attaching the CDP debugger there is what
    // was causing Cloudflare Turnstile's error 600010 on every fresh
    // install. Turnstile's own anti-debugging check treats a debugger
    // session (CDP or DevTools, same underlying mechanism) as a bot signal
    // and hard-fails the challenge — documented behavior, not specific to
    // this app. The game's WebSocket only exists after login anyway, so
    // there's nothing to capture on /login and no reason to attach there.
    return u.hostname === GAME_HOSTNAME && !u.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

function emptyLive() {
  return {
    attempts: 0,
    captures: 0,
    kills: 0,
    xp: 0,
    levelUps: 0,
    byRarity: {},
    loot: {},
    namedLoot: {}, // item name -> qty, for events that give a name but no itemId (e.g. profession-photo)
    ballsUsed: {},
    captureGold: 0,
    shinyCaught: 0,
    shinyLost: 0,
    ballsOnShiny: 0,
    // Most-recent-first, capped — every capture (any rarity), each with
    // enough detail for a real capture-log UI card, à la the game's own
    // "Capture Log" panel.
    notableCaptures: []
  };
}

const NOTABLE_CAPTURE_CAP = 30;
const HUNT_HISTORY_CAP = 20;
const NOTABLE_RARITIES = new Set(['Lendária', 'Mythic', 'Ancient', 'Divine']);

// One of these per account id that's ever matched isGameUrl().
function newState() {
  return {
    startTs: Date.now(),
    live: emptyLive(),
    huntKey: null,
    // Snapshot of computeRates() for the hunt that just ended, captured right
    // before the reset below wipes `live`/`startTs` — lets the "Comparador
    // de hunts" panel show current vs. previous without needing its own
    // separate tracking. `huntHistory` keeps the last HUNT_HISTORY_CAP of
    // these (most-recent-first) for the same panel's session list.
    previousHunt: null,
    huntHistory: [],
    team: [],
    wallet: { gold: null, goldSource: null, diamonds: null, diamondsSource: null, updatedAt: null },
    lastFrameTs: null,
    lastEvent: null, // {type, at, payload} — most recent alert-worthy thing, for Fase C
    // Instant liveness signals, separate from the cumulative `live` counters
    // above. `live.kills / sessionHours` (killsPerHour) stays positive for
    // hours after a single early kill, so it's useless as a "is this
    // account frozen right now" check — isLikelyFrozen() below reads these
    // deltas instead. All null until the first matching frame arrives.
    deltas: {
      lastAnyFrameAt: null,
      lastKillAt: null,
      lastCaptureAt: null,
      lastXpGainAt: null,
      lastHuntResetAt: null
    }
  };
}

const stateByAccount = new Map();
const attachedAccounts = new Set();

function getOrCreateState(accountId) {
  let s = stateByAccount.get(accountId);
  if (!s) {
    s = newState();
    stateByAccount.set(accountId, s);
  }
  return s;
}

// Called when an account is permanently deleted (removeAccountCompletely in
// main.js) — without this, stateByAccount/attachedAccounts grow forever
// across the app's lifetime as accounts are created and deleted, since
// nothing else in this module ever removes an entry.
function removeState(accountId) {
  stateByAccount.delete(accountId);
  attachedAccounts.delete(accountId);
}

// Fetched once (shared across every account — it's the same game server for
// all of them) and cached for the app's lifetime: item prices don't change
// mid-session. If the fetch ever fails, loot just contributes 0 to
// goldPerHour instead of throwing — same honest-undercount policy as the
// xpGained fallback above.
let itemPriceCatalog = null; // itemId -> npcPrice
let itemPriceByName = null; // item name -> npcPrice (some events only give a name, e.g. profession-photo)
let itemNameById = null; // itemId -> name, for resolving field-kill loot (which only carries itemId+qty) into a readable drops list
let itemIconById = null; // itemId -> icon URL, for the "Drops en vivo" panel
let itemIconByName = null; // item name -> icon URL, for namedLoot (profession-photo)
let itemCatalogItems = null; // enriched raw item rows for UI tools such as Pokepedia drops
let itemPriceCatalogPromise = null;
function ensureItemPriceCatalog() {
  if (itemPriceCatalog || itemPriceCatalogPromise) return itemPriceCatalogPromise;
  itemPriceCatalogPromise = fetch(`https://${GAME_HOSTNAME}/game/items.json`)
    .then((res) => res.json())
    .then((data) => {
      const byId = new Map();
      const byName = new Map();
      const nameById = new Map();
      const iconById = new Map();
      const iconByName = new Map();
      const enrichedItems = [];
      for (const item of (data && data.items) || []) {
        if (item && item.id != null && typeof item.npcPrice === 'number') {
          let iconUrl = null;
          byId.set(item.id, item.npcPrice);
          if (item.name) { byName.set(item.name, item.npcPrice); nameById.set(item.id, item.name); }
          // The game's own items.json serves icon in three different shapes:
          // a full external URL (pokexguides.com), a path already rooted at
          // the game's own origin (/assets/stones/...), or — the common
          // case, confirmed against a live fetch: 294 of 295 items — a bare
          // filename with no leading slash at all (e.g. "dragon_tooth.png").
          // Naively concatenating GAME_HOSTNAME + item.icon for that last
          // case produced "https://poke.idleworld.onlinedragon_tooth.png"
          // (no separating slash) — a malformed URL that silently 404s,
          // which is why every non-stone item's icon showed as broken in
          // the "Drops en vivo" panel. The bare-filename case isn't actually
          // served at the origin root either — verified live: the game
          // serves those specifically under /assets/items/ (HTTP 200 for
          // /assets/items/dragon_tooth.png, 404 at the bare root path).
          if (item.icon) {
            if (/^https?:\/\//.test(item.icon)) {
              iconUrl = item.icon;
            } else if (item.icon.startsWith('/')) {
              iconUrl = `https://${GAME_HOSTNAME}${item.icon}`;
            } else {
              iconUrl = `https://${GAME_HOSTNAME}/assets/items/${item.icon}`;
            }
            iconById.set(item.id, iconUrl);
            if (item.name) iconByName.set(item.name, iconUrl);
          }
          enrichedItems.push({
            ...item,
            icon: iconUrl,
            iconUrl,
            category: item.category || item.type || item.kind || null,
            description: item.description || item.desc || ''
          });
        }
      }
      itemPriceCatalog = byId;
      itemPriceByName = byName;
      itemNameById = nameById;
      itemIconById = iconById;
      itemIconByName = iconByName;
      itemCatalogItems = enrichedItems;
    })
    .catch((err) => {
      console.error('[game-telemetry] no se pudo cargar el catálogo de precios de items', err);
      itemPriceCatalogPromise = null; // allow a retry on the next attachCapture
    });
  return itemPriceCatalogPromise;
}

// Same fetch-once-and-cache pattern as the item price catalog above, for
// /game/creatures.json — used both to show which attacks a team member has
// likely learned by now (creatures.json's per-species `attacks` array has a
// `learnLevel` per move; the game's own WS frames don't carry a "currently
// equipped moves" field for an individual owned poke, so this is the closest
// derivable approximation from data the game actually publishes) and to feed
// the Tier List / Comparador / Caza & XP tools (poke-formulas.js), which need
// the full per-species record (base stats, type, huntLevel, sellValue,
// experience, loot), not just name/rarity/attacks.
let creatureCatalog = null; // pokeId (== speciesId in poke-delta/pokes frames) -> full creatures.json record
let creatureCatalogPromise = null;
let creatureCatalogUpdatedAt = null;
function ensureCreatureCatalog(forceRefresh = false) {
  if (forceRefresh) {
    creatureCatalog = null;
    creatureCatalogPromise = null;
    creatureCatalogUpdatedAt = null;
  }
  if (creatureCatalog || creatureCatalogPromise) return creatureCatalogPromise;
  creatureCatalogPromise = fetch(`https://${GAME_HOSTNAME}/game/creatures.json`)
    .then((res) => res.json())
    .then((data) => {
      const byId = new Map();
      for (const c of (data && data.creatures) || []) {
        if (c && c.pokeId != null) byId.set(c.pokeId, c);
      }
      creatureCatalog = byId;
      creatureCatalogUpdatedAt = Date.now();
    })
    .catch((err) => {
      console.error('[game-telemetry] no se pudo cargar el catálogo de criaturas', err);
      creatureCatalogPromise = null;
    });
  return creatureCatalogPromise;
}

function getCreatureCatalogArray() {
  return creatureCatalog ? Array.from(creatureCatalog.values()) : [];
}

function getCreatureCatalogMeta() {
  const list = getCreatureCatalogArray();
  const maxId = list.reduce((max, c) => Math.max(max, Number(c.pokeId) || 0), 0);
  return {
    count: list.length,
    maxId,
    updatedAt: creatureCatalogUpdatedAt
  };
}

function getItemPriceByNameMap() {
  return itemPriceByName;
}

// For the sell-lock item picker (main.js) — needs id+name+icon together,
// which the three separate itemXById/itemXByName maps above don't give in
// one shape. Only meaningful after ensureItemPriceCatalog() has resolved.
function getItemCatalogArray() {
  if (itemCatalogItems) return itemCatalogItems.map((item) => ({ ...item }));
  if (!itemNameById) return [];
  return Array.from(itemNameById.entries()).map(([id, name]) => ({
    id,
    name,
    icon: itemIconById.get(id) || null,
    iconUrl: itemIconById.get(id) || null,
    npcPrice: itemPriceCatalog.get(id) ?? null,
    category: null,
    description: ''
  }));
}

function learnedMoves(speciesId, level) {
  const creature = creatureCatalog && creatureCatalog.get(speciesId);
  if (!creature) return [];
  return creature.attacks
    .filter((a) => (a.learnLevel || 1) <= (level || 1))
    .sort((a, b) => (b.power || 0) - (a.power || 0));
}

// Mirrors the documented frame-type behavior of game-parse.js — not its code.
// Unknown/future frame types are ignored rather than throwing: the game is
// under active development and its schema can change without notice.
function parseWalletAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const suffix = raw.match(/[kmb]$/i)?.[0]?.toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  const cleaned = raw
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * multiplier) : null;
}

function mergeWallet(state, wallet) {
  if (!state || !wallet || typeof wallet !== 'object') return;
  const gold = parseWalletAmount(wallet.gold ?? wallet.money ?? wallet.cash ?? wallet.dollars ?? wallet.ouro);
  const diamonds = parseWalletAmount(wallet.diamonds ?? wallet.diamond ?? wallet.diamantes);
  if (gold == null && diamonds == null) return;
  state.wallet = state.wallet || { gold: null, goldSource: null, diamonds: null, diamondsSource: null, updatedAt: null };
  let changed = false;
  if (gold != null) {
    const existingGold = Number(state.wallet.gold);
    const trustedGold = wallet.goldSource === 'visual-shop' || wallet.goldSource === 'visual-hud' || wallet.walletSource === 'visual';
    const suspiciousDrop = Number.isFinite(existingGold) && existingGold >= 100_000 && gold < existingGold * 0.1 && !trustedGold;
    if (!suspiciousDrop) {
      state.wallet.gold = gold;
      state.wallet.goldSource = trustedGold ? (wallet.goldSource || 'visual') : 'frame';
      changed = true;
    }
  }
  if (
    wallet.diamondsSource === 'diamond-store' &&
    diamonds != null &&
    diamonds >= 0 &&
    diamonds <= MAX_REASONABLE_DIAMONDS
  ) {
    state.wallet.diamonds = diamonds;
    state.wallet.diamondsSource = 'diamond-store';
    changed = true;
  }
  if (changed) state.wallet.updatedAt = Date.now();
}

function extractWalletFromObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  const wallet = {};
  for (const [key, raw] of Object.entries(value)) {
    const low = key.toLowerCase();
    if (raw != null && typeof raw !== 'object') {
      if (['gold', 'money', 'cash', 'dollars', 'ouro'].includes(low)) wallet.gold = raw;
      if (['diamonds', 'diamond', 'diamantes'].includes(low)) wallet.diamonds = raw;
    }
    if (raw && typeof raw === 'object') {
      const nested = extractWalletFromObject(raw, depth + 1);
      if (nested) {
        if (wallet.gold == null && nested.gold != null) wallet.gold = nested.gold;
        if (wallet.diamonds == null && nested.diamonds != null) wallet.diamonds = nested.diamonds;
      }
    }
  }
  return wallet.gold != null || wallet.diamonds != null ? wallet : null;
}

// Frame types that explicitly carry the player's own wallet balance (not
// market prices or reward amounts that look like wallet values).
const WALLET_FRAME_TYPES = new Set(['player', 'balance', 'wallet', 'trainer', 'account']);

function applyFrame(state, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  const L = state.live;
  if (!state.deltas) state.deltas = newState().deltas; // guard for states created before this field existed
  state.deltas.lastAnyFrameAt = Date.now();
  const walletExtract = extractWalletFromObject(msg);
  if (walletExtract && WALLET_FRAME_TYPES.has(msg.type)) {
    // Mark as trusted so the renderer shows it instead of hiding it as a
    // potentially-spurious frame value. These frame types come straight from
    // the server's player-state push, not from item rewards or market events.
    walletExtract.goldSource = 'visual-hud';
    walletExtract.walletSource = 'visual';
  }
  mergeWallet(state, walletExtract);

  switch (msg.type) {
    case 'field-init': {
      const huntKey = msg.huntKey ?? msg.hunt ?? null;
      if (huntKey !== state.huntKey) {
        // Only snapshot if there was an actual previous hunt (not the very
        // first field-init of a fresh session, where there's nothing yet to
        // compare against).
        if (state.huntKey != null) {
          const prev = computeRates(state);
          const snapshot = {
            huntKey: state.huntKey,
            endedAt: Date.now(),
            durationMs: prev.durationMs,
            netGold: prev.netGold,
            goldPerHour: prev.goldPerHour,
            xp: prev.xp,
            xpPerHour: prev.xpPerHour,
            kills: prev.kills,
            killsPerHour: prev.killsPerHour,
            captures: prev.captures
          };
          state.previousHunt = snapshot;
          state.huntHistory = state.huntHistory || [];
          state.huntHistory.unshift(snapshot);
          if (state.huntHistory.length > HUNT_HISTORY_CAP) state.huntHistory.length = HUNT_HISTORY_CAP;
        }
        state.huntKey = huntKey;
        state.startTs = Date.now();
        state.live = emptyLive();
        state.lastEvent = { type: 'hunt-reset', at: Date.now() };
        state.deltas.lastHuntResetAt = Date.now();
      }
      break;
    }
    case 'catch-result': {
      L.attempts += 1;
      if (msg.ballId) L.ballsUsed[msg.ballId] = (L.ballsUsed[msg.ballId] || 0) + 1;
      if (msg.fieldShiny) L.ballsOnShiny += 1;
      break;
    }
    case 'poke-delta': {
      // Confirmed against a real frame: the caught poke is nested under
      // `poke`, not spread on the message itself —
      // {"type":"poke-delta","poke":{"id":...,"sellValue":...,"quality":...}}.
      // Represents a new entry actually added to the player's collection —
      // may read lower than the game's own "Captured" counter (which
      // appears to count every successful catch-result, including ones
      // auto-processed without a full box entry), but every count here is a
      // real, fully-detailed capture.
      const poke = msg.poke;
      if (!poke) break;
      const id = poke.id;
      const alreadyKnown = id != null && state._knownIds && state._knownIds.has(id);
      if (!state._knownIds) state._knownIds = new Set();
      if (id != null) state._knownIds.add(id);
      if (alreadyKnown) break; // update to an existing poke, not a new capture

      L.captures += 1;
      state.deltas.lastCaptureAt = Date.now();
      if (typeof poke.sellValue === 'number') L.captureGold += poke.sellValue;
      const rarity = rarityFromQuality(poke.quality) || poke.rarity;
      if (rarity) L.byRarity[rarity] = (L.byRarity[rarity] || 0) + 1;
      {
        L.notableCaptures.unshift({
          name: poke.name,
          speciesId: poke.speciesId,
          level: poke.level,
          quality: poke.quality,
          ivTotal: poke.ivTotal,
          stats: poke.stats,
          rarity,
          shiny: !!poke.shiny,
          sellValue: poke.sellValue,
          at: Date.now()
        });
        if (L.notableCaptures.length > NOTABLE_CAPTURE_CAP) L.notableCaptures.length = NOTABLE_CAPTURE_CAP;
      }
      if (poke.shiny) {
        L.shinyCaught += 1;
        state.lastEvent = { type: 'shiny_capture', at: Date.now(), payload: { name: poke.name, rarity } };
      } else if (NOTABLE_RARITIES.has(rarity)) {
        state.lastEvent = { type: 'rare_capture', at: Date.now(), payload: { name: poke.name, rarity } };
      }
      break;
    }
    case 'field-kill': {
      L.kills += 1;
      state.deltas.lastKillAt = Date.now();
      // Confirmed against real frames (Fase A live testing): xpGained is the
      // actual per-kill delta; totalXp is the character's lifetime XP
      // counter (hundreds of millions at high level) and would silently
      // wreck the rate math if ever used as a fallback here. No fallback —
      // if a future game update ever drops xpGained, better to undercount
      // (add 0) than to add a multi-hundred-million-XP number by mistake.
      const xpGained = typeof msg.xpGained === 'number' ? msg.xpGained : 0;
      L.xp += xpGained;
      if (xpGained > 0) state.deltas.lastXpGainAt = Date.now();
      if (msg.leveledUp) L.levelUps += 1;
      if (Array.isArray(msg.loot)) {
        // Confirmed against real frames: loot is an array of {itemId,name,qty},
        // not a plain {itemId: qty} map.
        for (const drop of msg.loot) {
          if (!drop || drop.itemId == null) continue;
          L.loot[drop.itemId] = (L.loot[drop.itemId] || 0) + (Number(drop.qty) || 0);
        }
      } else if (msg.loot && typeof msg.loot === 'object') {
        for (const [itemId, qty] of Object.entries(msg.loot)) {
          L.loot[itemId] = (L.loot[itemId] || 0) + (Number(qty) || 0);
        }
      }
      if (msg.shiny) {
        L.shinyLost += 1;
        state.lastEvent = { type: 'shiny_wild', at: Date.now(), payload: { name: msg.name } };
      }
      break;
    }
    case 'pokes': {
      // Confirmed against a real frame: the array is under `list` (the full
      // collection, each entry flagged `team:true/false`), not `team`.
      if (Array.isArray(msg.list)) {
        // Seeds _knownIds from the player's WHOLE existing collection (not
        // just the team) — without this, the first poke-delta update to any
        // pokemon the player already owned before this session (a level-up,
        // a stat resync, etc.) had never been seen as an id before and got
        // logged as a brand new capture. Confirmed live: the user's own
        // long-owned team member (Golem) showed up in the capture log after
        // it leveled up mid-hunt.
        if (!state._knownIds) state._knownIds = new Set();
        for (const p of msg.list) {
          if (p && p.id != null) state._knownIds.add(p.id);
        }
        const activeTeam = msg.list.filter((p) => p.team);
        const wasAlive = state.team.some((p) => p.hp > 0);
        const leader = activeTeam[0];
        if (wasAlive && leader && leader.hp <= 0) {
          state.lastEvent = { type: 'died', at: Date.now(), payload: { name: leader.name } };
        }
        state.team = activeTeam;
        state.collectionSize = msg.list.length;
        // Species the player has ever owned (team or box) — the whole list,
        // not just activeTeam, since a captured-but-boxed pokemon still
        // counts as "captured" for the Pokédex filter. Derived from data we
        // already receive instead of a new API call.
        state.capturedSpeciesIds = new Set(msg.list.map((p) => p && p.speciesId).filter((id) => id != null));
        // Full collection (team + box), kept as-is (same per-poke shape as
        // poke-delta's `poke` object: id, name, speciesId, level, quality,
        // ivTotal, sellValue, stats, team) — needed for the mass-sell panel
        // (Etapa 6), which lists every owned pokemon, not just the active
        // team.
        state.collection = msg.list;
      }
      break;
    }
    case 'balls': {
      // Confirmed against a real frame: this is the static ball catalog
      // ({id,name,catchRate,priceGold,...}), not the player's current ball
      // counts — real counts come from the `inventory` frame instead
      // (`{itemId,quantity}`, same itemId space as loot). Kept for a future
      // phase (ball buy-price lookups); no low/out alert here since this
      // frame was never player-state to begin with.
      if (Array.isArray(msg.catalog)) state.ballCatalog = msg.catalog;
      break;
    }
    case 'inventory': {
      // Real per-item quantities ({itemId, quantity}), same itemId space as
      // loot/balls — cross-referenced against the ball catalog (from the
      // 'balls' frame above) to get the real ball count for the low/out alert.
      if (Array.isArray(msg.items)) {
        state.inventoryItems = msg.items
          .filter((it) => it && it.itemId != null)
          .map((it) => ({ itemId: it.itemId, quantity: Number(it.quantity) || 0 }));
      }
      if (Array.isArray(msg.items) && state.ballCatalog) {
        const ballIds = new Set(state.ballCatalog.map((b) => b.id));
        const total = msg.items
          .filter((it) => it && ballIds.has(it.itemId))
          .reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
        if (total <= 0) {
          state.lastEvent = { type: 'balls_out', at: Date.now() };
        } else if (total <= ballsLowThreshold) {
          state.lastEvent = { type: 'balls_low', at: Date.now(), payload: { total } };
        }
      }
      break;
    }
    case 'session-replaced': {
      state.lastEvent = { type: 'session_replaced', at: Date.now() };
      break;
    }
    case 'profession-photo': {
      // Confirmed against a real frame (at the time): gives an itemName
      // (e.g. "Rare Pokémon Picture"), not an itemId — a separate income
      // source from field-kill loot (the game's own Hunt Analyzer includes
      // it in "Loot"), so it needs its own name-keyed bucket.
      //
      // Widened defensively: a user reported "Rare Pokémon Picture" (a real,
      // catalog-confirmed item — id 59195, $5000 NPC price) showing up in
      // the game's own Hunt Analyzer but never in ours, on an account that
      // was actively getting them. The strict `msg.ok && msg.itemName` check
      // requiring that exact field pairing is the prime suspect — the
      // game's own protocol isn't versioned/documented, so a field rename
      // (itemName -> name/item/label, or ok being dropped/renamed) would
      // silently zero out this entire counter with no error anywhere. Now
      // accepts common name-field variants and only treats an *explicit*
      // false success flag as a real failure (msg.ok/success/successful
      // being simply absent no longer discards the event) — the win from
      // being lenient (matching the item the user actually confirmed
      // dropping) outweighs the small risk of over-counting a field that
      // isn't actually there.
      const photoName = msg.itemName ?? msg.name ?? msg.item ?? msg.label ?? msg.itemLabel;
      const explicitFailure = msg.ok === false || msg.success === false || msg.successful === false;
      if (photoName && !explicitFailure) {
        L.namedLoot[photoName] = (L.namedLoot[photoName] || 0) + 1;
      }
      break;
    }
    default:
      // analyzer / inventory / boosts / mail-badge / shiny-global / chat /
      // anything else — no counters depend on these for Fase A.
      break;
  }
}

function computeRates(state) {
  const hrs = Math.max((Date.now() - state.startTs) / 3_600_000, 1 / 3600);
  const L = state.live;

  let lootGold = 0;
  // Per-item breakdown (name/qty/value), for a real-time "session drops" list
  // — mirrors the game's own Hunt Analyzer panel, built from the same raw
  // per-item counters that already feed lootGold above.
  const lootBreakdown = [];
  if (itemPriceCatalog) {
    for (const [itemId, qty] of Object.entries(L.loot)) {
      const price = itemPriceCatalog.get(Number(itemId)) || 0;
      lootGold += price * qty;
      const name = (itemNameById && itemNameById.get(Number(itemId))) || `Item #${itemId}`;
      const icon = itemIconById && itemIconById.get(Number(itemId));
      lootBreakdown.push({ name, qty, value: Math.round(price * qty), icon: icon || null });
    }
  }
  if (itemPriceByName) {
    for (const [name, qty] of Object.entries(L.namedLoot)) {
      const price = itemPriceByName.get(name) || 0;
      lootGold += price * qty;
      const icon = itemIconByName && itemIconByName.get(name);
      lootBreakdown.push({ name, qty, value: Math.round(price * qty), icon: icon || null });
    }
  }
  lootBreakdown.sort((a, b) => b.value - a.value);

  let supplyCost = 0;
  if (state.ballCatalog) {
    const priceByBallId = new Map(state.ballCatalog.map((b) => [b.id, b.priceGold]));
    for (const [ballId, qty] of Object.entries(L.ballsUsed)) {
      supplyCost += (priceByBallId.get(Number(ballId)) || 0) * qty;
    }
  }

  const netGold = L.captureGold + lootGold - supplyCost;

  return {
    killsPerHour: Math.round(L.kills / hrs),
    xpPerHour: Math.round(L.xp / hrs),
    goldPerHour: Math.round(netGold / hrs),
    capturesPerHour: Math.round(L.captures / hrs),
    attempts: L.attempts,
    captures: L.captures,
    kills: L.kills,
    xp: L.xp,
    levelUps: L.levelUps,
    byRarity: L.byRarity,
    ballsUsed: L.ballsUsed,
    captureGold: L.captureGold,
    lootGold: Math.round(lootGold),
    lootBreakdown,
    supplyCost: Math.round(supplyCost),
    netGold: Math.round(netGold),
    shinyCaught: L.shinyCaught,
    shinyLost: L.shinyLost,
    notableCaptures: L.notableCaptures,
    team: (state.team || []).map((p) => ({ ...p, moves: learnedMoves(p.speciesId, p.level) })),
    collectionSize: state.collectionSize || 0,
    inventoryItems: state.inventoryItems || [],
    ballCatalog: state.ballCatalog || [],
    wallet: state.wallet || { gold: null, goldSource: null, diamonds: null, diamondsSource: null, updatedAt: null },
    lastEvent: state.lastEvent,
    connected: state.lastFrameTs != null && Date.now() - state.lastFrameTs < HEARTBEAT_STALE_MS,
    durationMs: Date.now() - state.startTs,
    huntKey: state.huntKey || null,
    previousHunt: state.previousHunt || null,
    huntHistory: state.huntHistory || [],
    capturedSpeciesIds: state.capturedSpeciesIds ? Array.from(state.capturedSpeciesIds) : [],
    collection: state.collection || []
  };
}

function updateWallet(accountId, wallet) {
  const state = getOrCreateState(accountId);
  mergeWallet(state, wallet);
}

function adjustWallet(accountId, { currency, delta }) {
  const state = getOrCreateState(accountId);
  const amount = Number(delta);
  if (!Number.isFinite(amount) || !currency) return;
  state.wallet = state.wallet || { gold: null, goldSource: null, diamonds: null, diamondsSource: null, updatedAt: null };
  const key = String(currency).toUpperCase().includes('DIAM') ? 'diamonds' : 'gold';
  if (state.wallet[key] == null) return;
  state.wallet[key] = Math.max(0, state.wallet[key] + amount);
  if (key === 'gold' && !state.wallet.goldSource) state.wallet.goldSource = 'adjusted';
  if (key === 'diamonds' && !state.wallet.diamondsSource) state.wallet.diamondsSource = 'adjusted';
  state.wallet.updatedAt = Date.now();
}

// Attaches once per account webContents' lifetime — idempotent, safe to call
// again on every navigation (mirrors how injectGameOverlayButtons is already
// called repeatedly and no-ops harmlessly). Only ever attaches for accounts
// actually on the game's domain, per the port plan's scoping rule. Takes the
// webContents directly (not a WebContentsView wrapper — accounts are real
// <webview> elements now, see wireAccountWebContents in main.js).
function attachCapture(wc, accountId, { onDetach, onFrame } = {}) {
  if (wc.debugger.isAttached()) return;

  try {
    wc.debugger.attach('1.3');
  } catch (err) {
    console.error('[game-telemetry] debugger.attach failed for', accountId, err);
    return;
  }

  wc.debugger.sendCommand('Network.enable').catch((err) => {
    console.error('[game-telemetry] Network.enable failed for', accountId, err);
  });

  const state = getOrCreateState(accountId);
  attachedAccounts.add(accountId);
  ensureItemPriceCatalog();
  ensureCreatureCatalog();

  wc.debugger.on('message', (_event, method, params) => {
    // Debug instrumentation (NEXA_DEBUG_NET=1, off by default, zero cost
    // when off) — logs outgoing REST calls, WS frames, and GET response
    // bodies for the game's own account/inventory-management endpoints, so
    // real endpoints (teleport, shop, depot, family) get confirmed live
    // instead of guessed. Kept around (not deleted after Etapa 4/5) since
    // Etapa 7 (Depot) needs the exact same technique.
    if (process.env.NEXA_DEBUG_NET === '1') {
      // Writes synchronously straight to disk instead of console.log — a
      // redirected stdout pipe for a GUI (non-TTY) Electron process buffers
      // heavily and doesn't flush until a clean process exit, which force-
      // killing (needed to close the app between test runs) never triggers.
      // Confirmed live: an entire capture session produced zero visible
      // output via `> out.txt` redirection for exactly this reason.
      let line = null;
      if (method === 'Network.requestWillBeSent' && params.request && /idleworld\.online/.test(params.request.url || '')) {
        line = `[REQUEST] ${params.request.method} ${params.request.url} ${params.request.postData || ''}`;
      } else if (method === 'Network.webSocketFrameSent') {
        line = `[WS-SENT] ${(params.response && params.response.payloadData) || ''}`;
      } else if (method === 'Network.responseReceived' && params.response && /\/api\/game\/(shop|depot|family)(\?|\/|$)/.test(params.response.url || '')) {
        const logPath = require('path').join(__dirname, '..', 'netdebug.log');
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((body) => {
            try { require('fs').appendFileSync(logPath, `[BODY ${params.response.url}] ${body.body}\n`); } catch {}
          }).catch((err) => {
            try { require('fs').appendFileSync(logPath, `[BODY-ERROR ${params.response.url}] ${err.message}\n`); } catch {}
          });
      }
      if (line) {
        try { require('fs').appendFileSync(require('path').join(__dirname, '..', 'netdebug.log'), line + '\n'); } catch {}
      }
    }
    if (method !== 'Network.webSocketFrameReceived') return;
    const payload = params.response && params.response.payloadData;
    if (!payload) return;
    state.lastFrameTs = Date.now();
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return; // not JSON — not one of the game's own protocol frames
    }
    applyFrame(state, msg);
    if (typeof onFrame === 'function') {
      try { onFrame(msg); } catch (err) { console.error('[game-telemetry] onFrame handler failed for', accountId, err); }
    }
  });

  wc.debugger.on('detach', (_event, reason) => {
    console.log('[game-telemetry] debugger detached for', accountId, reason);
    attachedAccounts.delete(accountId);
    // Previously this only logged — nothing ever re-attached automatically,
    // so a detach (confirmed live: opening regular DevTools on an account
    // triggers one, since Chromium only allows one CDP client per target;
    // there may be other silent causes too) permanently froze this
    // account's telemetry until a full page reload happened to come along.
    // onDetach lets the connection-manager wiring (main.js, gated behind
    // settings.stability.enabled) drive an actual re-attach attempt instead.
    if (typeof onDetach === 'function') {
      try { onDetach(reason); } catch (err) { console.error('[game-telemetry] onDetach handler failed for', accountId, err); }
    }
  });

  wc.once('destroyed', () => {
    attachedAccounts.delete(accountId);
  });
}

function getStats(accountId) {
  const state = stateByAccount.get(accountId);
  if (!state) return null;
  return computeRates(state);
}

function getAllStats() {
  const result = {};
  for (const accountId of stateByAccount.keys()) {
    result[accountId] = getStats(accountId);
  }
  return result;
}

// Background heartbeat check — flags accounts whose capture went quiet
// (game likely disconnected/crashed) without needing a poller in the
// renderer. Fase C wires this into an actual OS notification.
function startHeartbeat() {
  setInterval(() => {
    const now = Date.now();
    for (const [accountId, state] of stateByAccount.entries()) {
      if (state.lastFrameTs == null) continue;
      const stale = now - state.lastFrameTs > HEARTBEAT_STALE_MS;
      const wasStale = state.lastEvent && state.lastEvent.type === 'disconnected';
      if (stale && !wasStale) {
        state.lastEvent = { type: 'disconnected', at: now };
      } else if (!stale && wasStale) {
        state.lastEvent = { type: 'reconnected', at: now };
      }
    }
  }, HEARTBEAT_CHECK_MS);
}

// Instant liveness check for the freeze detector — replaces the old
// `killsPerHour > 0` check (a cumulative rate that stays positive for hours
// after a single early kill, so it never actually detects a freeze). Pure
// function: takes deltas + a threshold, no Electron/Date.now() side effects
// beyond the injectable `now`, so it's fully unit-testable.
//
// Two independent staleness checks, not one:
//   1. lastAnyFrameAt stale → the WS itself has gone silent (or our CDP
//      capture detached) regardless of what the account was doing. Strong
//      signal on its own.
//   2. lastAnyFrameAt fresh (frames still arriving) but every gameplay
//      delta (kill/capture/xp/hunt-reset) is stale → this is the exact bug
//      case: non-gameplay frames (inventory syncs, etc.) kept the old
//      killsPerHour-based check fooled into reporting "alive".
//
// An account that has NEVER had a gameplay frame (fresh state, or
// legitimately idle in shop/depot/pokedex since it was opened) is never
// flagged by check #2 — only check #1 (WS truly silent) can catch it, which
// is correct: browsing the shop isn't a freeze, a dead WS is.
function isLikelyFrozen(state, thresholdMs, now = Date.now()) {
  if (!state || !state.deltas) return false;
  const d = state.deltas;
  if (!d.lastAnyFrameAt) return false; // no frame ever received yet — not enough info
  if (now - d.lastAnyFrameAt > thresholdMs) return true;
  const lastGameplayAt = Math.max(
    d.lastKillAt || 0,
    d.lastCaptureAt || 0,
    d.lastXpGainAt || 0,
    d.lastHuntResetAt || 0
  );
  if (lastGameplayAt > 0 && now - lastGameplayAt > thresholdMs) return true;
  return false;
}

module.exports = {
  isGameUrl,
  attachCapture,
  getStats,
  getAllStats,
  removeState,
  startHeartbeat,
  setBallsLowThreshold,
  isLikelyFrozen,
  getDeltas: (accountId) => stateByAccount.get(accountId)?.deltas || null,
  updateWallet,
  adjustWallet,
  ensureCreatureCatalog,
  getCreatureCatalogArray,
  getCreatureCatalogMeta,
  ensureItemPriceCatalog,
  getItemPriceByNameMap,
  getItemCatalogArray,
  // exported for unit testing
  rarityFromQuality,
  parseWalletAmount,
  applyFrame,
  computeRates,
  emptyLive
};
