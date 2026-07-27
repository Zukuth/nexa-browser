// Fase A del motor de telemetría en tiempo real para cuentas de
// poke.idleworld.online. Lee los frames WebSocket que el propio juego ya
// transmite (protocolo JSON documentado, no DOM) vía el debugger CDP de
// Chromium — igual que hace https://github.com/AntonioFleck/poke-idle-launcher,
// adaptado a WebContentsView (no <webview>). Nunca inyecta comandos, nunca
// automatiza clicks/capturas: es observación de red de solo lectura.
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
    return new URL(url).hostname === GAME_HOSTNAME;
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

const NOTABLE_CAPTURE_CAP = 100;
const NOTABLE_RARITIES = new Set(['Lendária', 'Mythic', 'Ancient', 'Divine']);

// One of these per account id that's ever matched isGameUrl().
function newState() {
  return {
    startTs: Date.now(),
    live: emptyLive(),
    huntKey: null,
    team: [],
    lastFrameTs: null,
    lastEvent: null // {type, at, payload} — most recent alert-worthy thing, for Fase C
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

// Fetched once (shared across every account — it's the same game server for
// all of them) and cached for the app's lifetime: item prices don't change
// mid-session. If the fetch ever fails, loot just contributes 0 to
// goldPerHour instead of throwing — same honest-undercount policy as the
// xpGained fallback above.
let itemPriceCatalog = null; // itemId -> npcPrice
let itemPriceByName = null; // item name -> npcPrice (some events only give a name, e.g. profession-photo)
let itemPriceCatalogPromise = null;
function ensureItemPriceCatalog() {
  if (itemPriceCatalog || itemPriceCatalogPromise) return itemPriceCatalogPromise;
  itemPriceCatalogPromise = fetch(`https://${GAME_HOSTNAME}/game/items.json`)
    .then((res) => res.json())
    .then((data) => {
      const byId = new Map();
      const byName = new Map();
      for (const item of (data && data.items) || []) {
        if (item && item.id != null && typeof item.npcPrice === 'number') {
          byId.set(item.id, item.npcPrice);
          if (item.name) byName.set(item.name, item.npcPrice);
        }
      }
      itemPriceCatalog = byId;
      itemPriceByName = byName;
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
function ensureCreatureCatalog() {
  if (creatureCatalog || creatureCatalogPromise) return creatureCatalogPromise;
  creatureCatalogPromise = fetch(`https://${GAME_HOSTNAME}/game/creatures.json`)
    .then((res) => res.json())
    .then((data) => {
      const byId = new Map();
      for (const c of (data && data.creatures) || []) {
        if (c && c.pokeId != null) byId.set(c.pokeId, c);
      }
      creatureCatalog = byId;
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
function applyFrame(state, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  const L = state.live;

  switch (msg.type) {
    case 'field-init': {
      const huntKey = msg.huntKey ?? msg.hunt ?? null;
      if (huntKey !== state.huntKey) {
        state.huntKey = huntKey;
        state.startTs = Date.now();
        state.live = emptyLive();
        state.lastEvent = { type: 'hunt-reset', at: Date.now() };
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
      if (typeof poke.sellValue === 'number') L.captureGold += poke.sellValue;
      const rarity = poke.rarity || rarityFromQuality(poke.quality);
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
      // Confirmed against real frames (Fase A live testing): xpGained is the
      // actual per-kill delta; totalXp is the character's lifetime XP
      // counter (hundreds of millions at high level) and would silently
      // wreck the rate math if ever used as a fallback here. No fallback —
      // if a future game update ever drops xpGained, better to undercount
      // (add 0) than to add a multi-hundred-million-XP number by mistake.
      const xpGained = typeof msg.xpGained === 'number' ? msg.xpGained : 0;
      L.xp += xpGained;
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
      // Confirmed against a real frame: gives an itemName (e.g. "Rare
      // Pokémon Picture"), not an itemId — a separate income source from
      // field-kill loot (the game's own Hunt Analyzer includes it in
      // "Loot"), so it needs its own name-keyed bucket.
      if (msg.ok && msg.itemName) {
        L.namedLoot[msg.itemName] = (L.namedLoot[msg.itemName] || 0) + 1;
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
  if (itemPriceCatalog) {
    for (const [itemId, qty] of Object.entries(L.loot)) {
      lootGold += (itemPriceCatalog.get(Number(itemId)) || 0) * qty;
    }
  }
  if (itemPriceByName) {
    for (const [name, qty] of Object.entries(L.namedLoot)) {
      lootGold += (itemPriceByName.get(name) || 0) * qty;
    }
  }

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
    supplyCost: Math.round(supplyCost),
    netGold: Math.round(netGold),
    shinyCaught: L.shinyCaught,
    shinyLost: L.shinyLost,
    notableCaptures: L.notableCaptures,
    team: (state.team || []).map((p) => ({ ...p, moves: learnedMoves(p.speciesId, p.level) })),
    collectionSize: state.collectionSize || 0,
    lastEvent: state.lastEvent,
    connected: state.lastFrameTs != null && Date.now() - state.lastFrameTs < HEARTBEAT_STALE_MS
  };
}

// Attaches once per WebContentsView's lifetime — idempotent, safe to call
// again on every navigation (mirrors how injectGameOverlayButtons is already
// called repeatedly and no-ops harmlessly). Only ever attaches for accounts
// actually on the game's domain, per the port plan's scoping rule.
function attachCapture(view, accountId) {
  const wc = view.webContents;
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
  });

  wc.debugger.on('detach', (_event, reason) => {
    console.log('[game-telemetry] debugger detached for', accountId, reason);
    attachedAccounts.delete(accountId);
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

module.exports = {
  isGameUrl,
  attachCapture,
  getStats,
  getAllStats,
  startHeartbeat,
  setBallsLowThreshold,
  ensureCreatureCatalog,
  getCreatureCatalogArray,
  // exported for unit testing
  rarityFromQuality,
  applyFrame,
  computeRates,
  emptyLive
};
