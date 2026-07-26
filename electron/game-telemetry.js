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
// Limitación honesta de esta primera versión: `goldPerHour` solo cuenta el
// oro de venta de capturas (`sellValue` viene directo en el frame poke-delta),
// no el oro de vender el loot de las kills — eso requeriría el catálogo de
// precios de items del propio juego (que el launcher de referencia trae
// aparte vía polling a su API), no algo que venga en los frames de WebSocket
// en sí. Se puede sumar en una fase posterior sin romper nada de esto.

const GAME_HOSTNAME = 'poke.idleworld.online';
const HEARTBEAT_STALE_MS = 60_000;
const HEARTBEAT_CHECK_MS = 15_000;

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
    ballsUsed: {},
    captureGold: 0,
    shinyCaught: 0,
    shinyLost: 0,
    ballsOnShiny: 0
  };
}

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
      const id = msg.id ?? msg.pokeId;
      const alreadyKnown = id != null && state._knownIds && state._knownIds.has(id);
      if (!state._knownIds) state._knownIds = new Set();
      if (id != null) state._knownIds.add(id);
      if (alreadyKnown) break; // update to an existing poke, not a new capture

      L.captures += 1;
      if (typeof msg.sellValue === 'number') L.captureGold += msg.sellValue;
      const rarity = msg.rarity || rarityFromQuality(msg.quality);
      if (rarity) L.byRarity[rarity] = (L.byRarity[rarity] || 0) + 1;
      if (msg.shiny) {
        state.lastEvent = { type: 'shiny_capture', at: Date.now(), payload: { name: msg.name, rarity } };
      } else if (rarity === 'Lendária' || rarity === 'Mythic' || rarity === 'Ancient' || rarity === 'Divine') {
        state.lastEvent = { type: 'rare_capture', at: Date.now(), payload: { name: msg.name, rarity } };
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
      if (Array.isArray(msg.team)) {
        const wasAlive = state.team.some((p) => p.hp > 0);
        const leader = msg.team[0];
        if (wasAlive && leader && leader.hp <= 0) {
          state.lastEvent = { type: 'died', at: Date.now(), payload: { name: leader.name } };
        }
        state.team = msg.team;
      }
      break;
    }
    case 'balls': {
      state.balls = msg.balls || msg;
      const total = sumNumericValues(state.balls);
      if (total != null && total <= 0) {
        state.lastEvent = { type: 'balls_out', at: Date.now() };
      } else if (total != null && total <= 20) {
        state.lastEvent = { type: 'balls_low', at: Date.now(), payload: { total } };
      }
      break;
    }
    case 'session-replaced': {
      state.lastEvent = { type: 'session_replaced', at: Date.now() };
      break;
    }
    default:
      // analyzer / inventory / boosts / mail-badge / shiny-global / chat /
      // anything else — no counters depend on these for Fase A.
      break;
  }
}

function sumNumericValues(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let total = 0;
  let any = false;
  for (const v of Object.values(obj)) {
    if (typeof v === 'number') {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function computeRates(state) {
  const hrs = Math.max((Date.now() - state.startTs) / 3_600_000, 1 / 3600);
  const L = state.live;
  return {
    killsPerHour: Math.round(L.kills / hrs),
    xpPerHour: Math.round(L.xp / hrs),
    goldPerHour: Math.round(L.captureGold / hrs),
    capturesPerHour: Math.round(L.captures / hrs),
    attempts: L.attempts,
    captures: L.captures,
    kills: L.kills,
    xp: L.xp,
    levelUps: L.levelUps,
    byRarity: L.byRarity,
    ballsUsed: L.ballsUsed,
    captureGold: L.captureGold,
    shinyCaught: L.shinyCaught,
    shinyLost: L.shinyLost,
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

// TEMPORARY — Fase A manual verification aid. Logs a compact one-line
// summary per tracked account to the main process console (visible in the
// terminal that ran `npm start`), so the numbers can be sanity-checked
// against the game's own analyzer panel without needing DevTools access on
// an account WebContentsView (which the app's own context menu doesn't
// expose an "Inspect" entry for). Remove once Fase B's real UI panel ships.
function startDebugLogger() {
  setInterval(() => {
    if (stateByAccount.size === 0) return;
    for (const [accountId, state] of stateByAccount.entries()) {
      const r = computeRates(state);
      console.log(
        `[game-telemetry] ${accountId.slice(0, 8)} — kills/h=${r.killsPerHour} xp/h=${r.xpPerHour} ` +
        `gold/h=${r.goldPerHour} captures=${r.captures} attempts=${r.attempts} ` +
        `connected=${r.connected} lastEvent=${r.lastEvent ? r.lastEvent.type : 'none'}`
      );
    }
  }, 10_000);
}

module.exports = {
  isGameUrl,
  attachCapture,
  getStats,
  getAllStats,
  startHeartbeat,
  startDebugLogger,
  // exported for unit testing
  rarityFromQuality,
  applyFrame,
  computeRates,
  emptyLive
};
