// Catches uncaught exceptions/rejections in the HOST chrome UI itself (this
// file) — not account webviews, which already have their own extensive
// crash/error coverage in main.js (render-process-gone, unresponsive,
// crash-classifier). Before this, an uncaught error here only surfaced if
// Chromium happened to also log it as a console error, which main.js's
// console-message forwarder would catch — real but incidental, not
// guaranteed for every error shape. Fire-and-forget (window.api.reportError
// is a plain ipcRenderer.send, no round-trip) so a broken error handler
// can never itself throw or hang the page.
window.addEventListener('error', (e) => {
  window.api.reportError({
    kind: 'error',
    message: e.message,
    stack: e.error && e.error.stack,
    source: `${e.filename}:${e.lineno}:${e.colno}`
  });
});
window.addEventListener('unhandledrejection', (e) => {
  window.api.reportError({
    kind: 'unhandledrejection',
    message: e.reason && e.reason.message ? e.reason.message : String(e.reason),
    stack: e.reason && e.reason.stack
  });
});

const listEl = document.getElementById('account-list');
const btnNewTab = document.getElementById('btn-new-tab');
const btnToggleAll = document.getElementById('btn-toggle-all');
const addressInput = document.getElementById('input-address');
const panelHeadersEl = document.getElementById('panel-headers');
const panelWebviewsEl = document.getElementById('panel-webviews');
// accountId -> 'connecting' | 'loading', only while that panel's <webview>
// is actively navigating — read by renderPanelHeaders() to show a small
// phase badge instead of a generic spinner, so a slow connection reads as
// "still working" through named phases rather than an ambiguous blank wait.
// Host-UI-only: never touches the webview's own timers/throttling, so it
// has zero effect on how fast a backgrounded game account keeps farming.
const panelLoadingPhase = new Map();
const railSpacesEl = document.getElementById('rail-spaces');
const btnAddSpace = document.getElementById('btn-add-space');
const spaceNameEl = document.getElementById('space-name');
const spaceColorDotEl = document.getElementById('space-color-dot');
const btnEditSpace = document.getElementById('btn-edit-space');
const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
const sidebarEl = document.getElementById('sidebar');
const topbarEl = document.getElementById('topbar');
const emptyStateEl = document.getElementById('empty-state');
const gameAccountsHintEl = document.getElementById('game-accounts-hint');
const btnEmptyAdd = document.getElementById('btn-empty-add');

const tbBack = document.getElementById('tb-back');
const tbForward = document.getElementById('tb-forward');
const tbHome = document.getElementById('tb-home');
const tbCopyUrl = document.getElementById('tb-copy-url');
const tbReload = document.getElementById('tb-reload');
const tbReload2 = document.getElementById('tb-reload-2');
const tbMute = document.getElementById('tb-mute');
const tbMuteAll = document.getElementById('tb-mute-all');
const tbShield = document.getElementById('tb-shield');
const tbShieldCount = document.getElementById('tb-shield-count');
const tbScreenshot = document.getElementById('tb-screenshot');
const tbMiniplayer = document.getElementById('tb-miniplayer');
const tbFullscreen = document.getElementById('tb-fullscreen');
const tbDownloads = document.getElementById('tb-downloads');
const tbSettings = document.getElementById('tb-settings');
const tbBookmarks = document.getElementById('tb-bookmarks');
const tbSupport = document.getElementById('tb-support');
const tbDns = document.getElementById('tb-dns');
const tbTranslate = document.getElementById('tb-translate');

const statusSpaceInfo = document.getElementById('status-space-info');
const statusActiveAccount = document.getElementById('status-active-account');
const statusUpdateProgress = document.getElementById('status-update-progress');
const statusCpu = document.getElementById('status-cpu');
const statusRam = document.getElementById('status-ram');
const statusTime = document.getElementById('status-time');
const statusVersion = document.getElementById('status-version');
const btnOptimize = document.getElementById('btn-optimize');

function layoutLabel(mode) {
  return t('layout.' + mode);
}
let appMeta = { startTime: Date.now(), version: '0.1.0' };
const bookmarksModal = document.getElementById('bookmarks-modal');
const bookmarksListEl = document.getElementById('bookmarks-list');
const btnCloseBookmarks = document.getElementById('btn-close-bookmarks');
const bmAddCurrent = document.getElementById('bm-add-current');
const bmImport = document.getElementById('bm-import');
const bmExport = document.getElementById('bm-export');

const shortcutsModal = document.getElementById('shortcuts-modal');
const shortcutsListEl = document.getElementById('shortcuts-list');
const btnCloseShortcuts = document.getElementById('btn-close-shortcuts');
const setShowShortcuts = document.getElementById('set-show-shortcuts');

const downloadsModal = document.getElementById('downloads-modal');
const downloadsListEl = document.getElementById('downloads-list');
const btnCloseDownloads = document.getElementById('btn-close-downloads');
const dlOpenFolder = document.getElementById('dl-open-folder');
const dlClear = document.getElementById('dl-clear');


const dnsModal = document.getElementById('dns-modal');
const dnsResultsEl = document.getElementById('dns-results');
const dnsRunBtn = document.getElementById('dns-run-test');
const dnsCopyRestoreBtn = document.getElementById('dns-copy-restore');
const btnCloseDns = document.getElementById('btn-close-dns');

const translateModal = document.getElementById('translate-modal');
const translateModalTitle = document.getElementById('translate-modal-title');
const translateProgressFill = document.getElementById('translate-progress-fill');
const translateProgressLabel = document.getElementById('translate-progress-label');
const translateDownloadHint = document.getElementById('translate-download-hint');
const translateErrorEl = document.getElementById('translate-error');
const btnCloseTranslate = document.getElementById('btn-close-translate');

const updateModal = document.getElementById('update-modal');
const updateVersionEl = document.getElementById('update-version');
const updateNotesEl = document.getElementById('update-notes');
const updateLaterBtn = document.getElementById('update-later');
const updateRestartBtn = document.getElementById('update-restart');

const cmdkModal = document.getElementById('cmdk-modal');
const cmdkInput = document.getElementById('cmdk-input');
const cmdkListEl = document.getElementById('cmdk-list');
const pokeIdlePanel = document.getElementById('poke-idle-panel');
const btnClosePokeIdle = document.getElementById('btn-close-poke-idle');
const tbPokeIdle = document.getElementById('tb-poke-idle');
const pokeNavItems = document.querySelectorAll('.poke-drawer-nav .poke-nav-item');
const pokeIdleTeamEl = document.getElementById('poke-idle-team');
const calcSourceEl = document.getElementById('calc-source');
const calcSpeciesEl = document.getElementById('calc-species');
const calcLevelEl = document.getElementById('calc-level');
const calcQualityEl = document.getElementById('calc-quality');
const calcProjLevelEl = document.getElementById('calc-proj-level');
const calcResultEl = document.getElementById('calc-result');
const pokeSettingsAccountEl = document.getElementById('poke-settings-account');
const pokeSettingsTabs = document.querySelectorAll('.poke-settings-tab');
const pokeSettingsPanels = document.querySelectorAll('.poke-settings-panel');
const pokeSettingsEmptyEl = document.getElementById('poke-settings-empty');
const pokeSettingsEcoEl = document.getElementById('poke-settings-eco');
const pokeSettingsEcoBenchmarkBtn = document.getElementById('poke-settings-eco-benchmark');
const pokeSettingsEcoBenchmarkResultEl = document.getElementById('poke-settings-eco-benchmark-result');
const pokeSettingsHideChatEl = document.getElementById('poke-settings-hide-chat');
const pokeSettingsHideGameBarEl = document.getElementById('poke-settings-hide-gamebar');
const pokeSettingsSellLockEl = document.getElementById('poke-settings-selllock');
const pokeSettingsSellLockItemsEl = document.getElementById('poke-settings-selllock-items');
const pokeSettingsSellLockItemPickerEl = document.getElementById('poke-settings-selllock-item-picker');
const pokeSettingsSellLockItemAddEl = document.getElementById('poke-settings-selllock-item-add');
const pokeSettingsCleanProfileEl = document.getElementById('poke-settings-clean-profile');
const stabilityEnabledEl = document.getElementById('stability-enabled');
const stabilityKeepaliveEl = document.getElementById('stability-keepalive');
const stabilityAutoRecoveryEl = document.getElementById('stability-auto-recovery');
const stabilityLastResortReloadEl = document.getElementById('stability-last-resort-reload');
const stabilityNotifyEl = document.getElementById('stability-notify');
const stabilityAccountStatusEl = document.getElementById('stability-account-status');
const stabilityManualReconnectBtn = document.getElementById('stability-manual-reconnect');
const stabilityTestNetworkBtn = document.getElementById('stability-test-network');
const stabilityNetworkTestResultEl = document.getElementById('stability-network-test-result');
const stabilityExportReportBtn = document.getElementById('stability-export-report');
const stabilityStartNetlogBtn = document.getElementById('stability-start-netlog');
const stabilityStopNetlogBtn = document.getElementById('stability-stop-netlog');
const calcStatInputs = {
  hp: document.getElementById('calc-stat-hp'),
  atk: document.getElementById('calc-stat-atk'),
  def: document.getElementById('calc-stat-def'),
  spatk: document.getElementById('calc-stat-spatk'),
  spdef: document.getElementById('calc-stat-spdef'),
  speed: document.getElementById('calc-stat-speed')
};
const btnLayoutMenu = document.getElementById('btn-layout-menu');
const layoutMenu = document.getElementById('layout-menu');
const layoutOptions = document.querySelectorAll('.layout-option');
const btnZoomMenu = document.getElementById('btn-zoom-menu');
const zoomMenu = document.getElementById('zoom-menu');

const urlSuggestionsEl = document.getElementById('url-suggestions');
let activeSuggestFor = null; // null | 'address' | accountId

function computeSuggestions(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set();
  const items = [];
  (state.bookmarks || []).forEach((b) => {
    if (seen.has(b.url)) return;
    if (b.url.toLowerCase().includes(q) || (b.title || '').toLowerCase().includes(q)) {
      seen.add(b.url);
      items.push({ type: 'bookmark', title: b.title, url: b.url });
    }
  });
  (state.history || []).forEach((h) => {
    if (seen.has(h.url)) return;
    if (h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)) {
      seen.add(h.url);
      items.push({ type: 'history', title: h.title, url: h.url });
    }
  });
  return items.slice(0, 8);
}

function showSuggestions(inputEl, forId) {
  const items = computeSuggestions(inputEl.value);
  if (items.length === 0) {
    hideSuggestions();
    return;
  }
  urlSuggestionsEl.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'url-suggestion-item';
    row.innerHTML =
      `<span class="url-suggestion-badge">${item.type === 'bookmark' ? '⭐' : '🕒'}</span>` +
      `<span class="url-suggestion-text">` +
      `<span class="url-suggestion-title">${escapeHtmlClient(item.title)}</span>` +
      `<span class="url-suggestion-url">${escapeHtmlClient(item.url)}</span>` +
      `</span>`;
    row.onmousedown = (e) => {
      e.preventDefault();
      inputEl.value = item.url;
      const targetId = forId === 'address' ? activeAccount()?.id : forId;
      if (targetId) window.api.navigateAccount(targetId, item.url);
      hideSuggestions();
      inputEl.blur();
    };
    urlSuggestionsEl.appendChild(row);
  });
  const rect = inputEl.getBoundingClientRect();
  urlSuggestionsEl.style.left = Math.round(rect.left) + 'px';
  urlSuggestionsEl.style.top = Math.round(rect.bottom + 4) + 'px';
  urlSuggestionsEl.style.width = Math.max(Math.round(rect.width), 260) + 'px';
  urlSuggestionsEl.classList.remove('hidden');
  if (activeSuggestFor === null) window.api.hideViews();
  activeSuggestFor = forId;
}

function hideSuggestions() {
  if (urlSuggestionsEl.classList.contains('hidden')) return;
  urlSuggestionsEl.classList.add('hidden');
  activeSuggestFor = null;
  window.api.showViews();
}

const RAIL_WIDTH = 56;
const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 64;
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const spaceModal = document.getElementById('space-modal');
const spaceInputName = document.getElementById('space-input-name');
const spaceColorsEl = document.getElementById('space-colors');
const spaceIconsEl = document.getElementById('space-icons');
const spaceInputUrl = document.getElementById('space-input-url');
const spaceInputLayout = document.getElementById('space-input-layout');
const btnSaveSpace = document.getElementById('btn-save-space');
const btnCancelSpace = document.getElementById('btn-cancel-space');
const btnDeleteSpace = document.getElementById('btn-delete-space');

const accountModal = document.getElementById('account-modal');
const accountInputName = document.getElementById('account-input-name');
const accountColorsEl = document.getElementById('account-colors');
const accountInputUrl = document.getElementById('account-input-url');
const accountInputProxy = document.getElementById('account-input-proxy');
const accountInputProxyUser = document.getElementById('account-input-proxy-user');
const accountInputProxyPass = document.getElementById('account-input-proxy-pass');
const accountInputEco = document.getElementById('account-input-eco');
const accountInputHideChat = document.getElementById('account-input-hide-chat');
const accountInputHideGameBar = document.getElementById('account-input-hide-gamebar');
const accountInputSellLock = document.getElementById('account-input-selllock');
const accountSellLockItemsEl = document.getElementById('account-selllock-items');
const accountSellLockItemPicker = document.getElementById('account-selllock-item-picker');
const accountSellLockItemAdd = document.getElementById('account-selllock-item-add');
const btnSaveAccount = document.getElementById('btn-save-account');
const btnCancelAccount = document.getElementById('btn-cancel-account');

const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const settingsPanes = document.querySelectorAll('.settings-pane');
const setLanguage = document.getElementById('set-language');
const setTheme = document.getElementById('set-theme');
const setStartWindows = document.getElementById('set-start-windows');
const setReopenSpace = document.getElementById('set-reopen-space');
const setProtectionLevel = document.getElementById('set-protection-level');
const setAutoEcoEnabled = document.getElementById('set-auto-eco-enabled');
const setAutoEcoMinutes = document.getElementById('set-auto-eco-minutes');
const ecoSavingsHint = document.getElementById('eco-savings-hint');
const setShowFpsOverlay = document.getElementById('set-show-fps');
const setShowPingOverlay = document.getElementById('set-show-ping');
const setShowAccountMetrics = document.getElementById('set-show-account-metrics');
const setHuntTelemetry = document.getElementById('set-hunt-telemetry');
const setTranslateMemoryPersist = document.getElementById('set-translate-memory-persist');
const setHwAccel = document.getElementById('set-hw-accel');
const setExportSpaces = document.getElementById('set-export-spaces');
const setImportSpaces = document.getElementById('set-import-spaces');
const setDefaultUrl = document.getElementById('set-default-url');
const setSupportPaypalUrl = document.getElementById('set-support-paypal-url');
const supportOpenPaypal = document.getElementById('support-open-paypal');
const setDefaultZoom = document.getElementById('set-default-zoom');
const setDefaultLayout = document.getElementById('set-default-layout');
const setDownloadsFolderLabel = document.getElementById('set-downloads-folder-label');
const setChooseFolder = document.getElementById('set-choose-folder');
const setAskDownload = document.getElementById('set-ask-download');
const verApp = document.getElementById('ver-app');
const verElectron = document.getElementById('ver-electron');
const verChrome = document.getElementById('ver-chrome');
const verUpdateStatus = document.getElementById('ver-update-status');

const extInput = document.getElementById('ext-input');
const extInstallBtn = document.getElementById('ext-install');
const extError = document.getElementById('ext-error');
const extLoadUnpacked = document.getElementById('ext-load-unpacked');
const extOpenStore = document.getElementById('ext-open-store');
const extListEl = document.getElementById('ext-list');
const pluginListEl = document.getElementById('plugin-list');

const pwImportBtn = document.getElementById('pw-import');
const pwError = document.getElementById('pw-error');
const pwListEl = document.getElementById('pw-list');
const pwAddName = document.getElementById('pw-add-name');
const pwAddUrl = document.getElementById('pw-add-url');
const pwAddUser = document.getElementById('pw-add-user');
const pwAddPass = document.getElementById('pw-add-pass');
const pwAddSave = document.getElementById('pw-add-save');

const pokeAlertEnabled = document.getElementById('poke-alert-enabled');
const pokeAlertShiny = document.getElementById('poke-alert-shiny');
const pokeAlertRare = document.getElementById('poke-alert-rare');
const pokeAlertDisconnect = document.getElementById('poke-alert-disconnect');
const pokeAlertBalls = document.getElementById('poke-alert-balls');
const pokeAlertBallsThreshold = document.getElementById('poke-alert-balls-threshold');
const networkListEl = document.getElementById('network-list');

const SPACE_COLORS = ['#4f8cff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#f06595', '#22b8cf'];
const SPACE_ICONS = ['grid', 'gamepad', 'swords', 'shield', 'flame', 'leaf', 'droplet', 'bolt', 'star', 'crown', 'ghost', 'rocket'];
const SPACE_ICON_SVGS = {
  grid: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  gamepad: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9h12a4 4 0 0 1 4 4.5l-.6 3a2.5 2.5 0 0 1-4.4 1.1L15 15H9l-2 2.6a2.5 2.5 0 0 1-4.4-1.1L2 13.5A4 4 0 0 1 6 9Z"/><line x1="7" y1="11.5" x2="7" y2="14.5"/><line x1="5.5" y1="13" x2="8.5" y2="13"/><circle cx="15.5" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="17.5" cy="14" r="0.8" fill="currentColor" stroke="none"/></svg>',
  swords: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6 6M5 3l1 5-5-1 4-4z"/><path d="M11 9 3 17l1 3 3 1 8-8"/><path d="M19 3l-6 6M19 3l-1 5 5-1-4-4z"/><path d="M13 9l8 8-1 3-3 1-8-8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>',
  flame: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c1 1 2 2.5 2 4.5A5 5 0 0 1 7 15c0-3 2-4 2-7-2 1-4 3-4 6.5A7 7 0 0 0 12 22a7 7 0 0 0 7-7c0-5-3-6-4-9-.5 2-2 2.5-2 4.5A2 2 0 0 1 9 10c0-3 3-4 3-8z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 4C10 4 4 10 4 18v2h2c8 0 14-6 14-16z"/><path d="M6 20 20 4"/></svg>',
  droplet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3s7 7.5 7 12.5A7 7 0 0 1 5 15.5C5 10.5 12 3 12 3z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L2 9.2l7.1-.6L12 2z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8z"/></svg>',
  ghost: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 21V11a7 7 0 0 1 14 0v10l-2.5-2-2 2-2.5-2-2 2-2.5-2L5 21z"/><circle cx="9.5" cy="11" r="0.8" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="0.8" fill="currentColor" stroke="none"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14.5 3.5c3 0 5 2 5 5-3 0-6.5 1.5-9 4l-3-3c2.5-2.5 4-6 7-6z"/><path d="M10.5 12.5 6 17l-3 1 1-3 4.5-4.5"/><circle cx="15.5" cy="8.5" r="1.2"/><path d="M9 18c-1 1-4 1.5-5 1-.5-1 0-4 1-5"/></svg>'
};

let state = { spaces: [], accounts: [], bookmarks: [], passwords: [], history: [], downloads: [], settings: {} };
let metrics = {};
let gameStats = {}; // Fase B: {[accountId]: {killsPerHour, xpPerHour, goldPerHour, captures, ...} | null}

const POKE_GAME_HOSTNAME = 'poke.idleworld.online';
// An account can point at the game (URL matches, not on /login) for a while
// before game-telemetry.js has a stats entry for it — the debugger attaches
// on navigation, but the state only gets created once the first WS frame
// arrives. Every poke-* live panel used to lump that "still connecting"
// window in with "no account points to the game at all", which showed the
// wrong hint (implying the user needs to open an account, when one is
// already open and just hasn't sent data yet). This distinguishes the two.
function isPokeGameAccount(account) {
  if (!account || account.closed || !account.url) return false;
  try {
    const u = new URL(account.url);
    return u.hostname === POKE_GAME_HOSTNAME && !u.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

// Shared loading/empty resolver for the poke-* live panels: returns
// `{ gameAccounts, tracked }` where `gameAccounts` is every open account
// pointing at the game and `tracked` is the subset game-telemetry has
// produced stats for yet. Callers render three distinct states from this —
// no account at all, account(s) open but still connecting, and real data —
// instead of collapsing the first two into one misleading message.
function pokeLiveAccountsStatus() {
  const gameAccounts = state.accounts.filter(isPokeGameAccount);
  const tracked = gameAccounts.filter((a) => gameStats[a.id]);
  return { gameAccounts, tracked };
}

// Mi Equipo (gs.team), Depot's Pokémon subtab (gs.collection) and Venta
// masiva's Pokémon subtab (gs.collection) all read data that only gets
// populated when the server pushes a `pokes` frame on its own — if that
// hasn't happened yet this session (right after connecting, before any
// capture/sale/level-up), all three show empty even with real Pokémon
// in-game. Confirmed live: the game's own in-page team HUD (a separate,
// independent data path) showed the real team while these panels — which
// go through gameStats instead — showed nothing. One active pokes-get per
// open game account (best-effort — an account mid-navigation or off the
// game page just no-ops) covers all three at once instead of duplicating
// the request per panel.
// On-demand refresh of `gameStats` — the setInterval below only polls every
// 5s, which is too slow right after an action (a pokes-get request, an
// account switch) that needs the caller to see up-to-date stats immediately
// rather than waiting for the next tick.
async function refreshGameStatsNow() {
  gameStats = await window.api.getGameStats();
}

async function refreshPokesForOpenAccounts() {
  const { gameAccounts } = pokeLiveAccountsStatus();
  await Promise.all(gameAccounts.map((a) => window.api.getPokes(a.id).catch(() => {})));
  await refreshGameStatsNow();
}

function pokeLoadingOrEmptyHtml(gameAccounts) {
  if (gameAccounts.length === 0) return `<div class="settings-hint">${t('pokeIdle.noAccounts')}</div>`;
  return `<div class="settings-hint poke-skeleton-hint">${t('pokeIdle.statsLoading')}</div>`;
}
let panelsGeometry = [];
// While a drag (divider or free-mode move/resize) is in progress, the panel
// headers being dragged are live DOM elements this code updates directly on
// every mousemove. renderPanelHeaders() rebuilds the whole header list from
// scratch (innerHTML = ''), so if a geometry update arrives mid-drag for an
// unrelated reason (another account closing, etc.), rebuilding right then
// would detach those elements out from under the drag — later onMove calls
// would keep "succeeding" against a DOM node no longer on screen, while the
// freshly rebuilt one just sits at the pre-drag position, a visible jump.
// Geometry keeps updating in the background either way; the rebuild is only
// deferred, and runs once immediately after the drag ends.
let dragInProgress = false;
// CSS transitions on panel rects (see .layout-animated in style.css) make
// opening/closing an account slide instead of jump — but the exact same
// transition would fight a live divider/free-panel drag, easing every
// per-frame rect update instead of tracking the mouse instantly. Toggling
// this class off for the duration of any drag keeps the two features from
// interfering: smooth animated layout changes when panels are added or
// removed, zero added latency while the user is actively dragging.
function setDragInProgress(value) {
  dragInProgress = value;
  document.body.classList.toggle('layout-animated', !value);
}
// Set by startSplitDrag/startFreeDrag to their own onUp() for the duration of
// the drag, cleared when onUp runs normally. A drag's mouseup/mousemove
// listeners live on `document`, which never fires if the user releases the
// mouse button outside the OS window (drags off-window and lets go over
// another app) -- with no mouseup, dragInProgress is stuck `true` forever,
// and onPanelsGeometry's `if (dragInProgress) return;` silently stops
// applying every future panels:geometry push. Sidebar highlighting still
// works (broadcastState is a separate channel), so the only visible symptom
// is clicking an account highlighting it as active while the panel content
// never actually swaps -- no exception anywhere, since nothing throws.
// Releasing the mouse outside the window normally also blurs the window, so
// that's the recovery hook below actually runs the drag's own cleanup.
let activeDragCleanup = null;
let editingSpaceId = null;

// Same rebuild-mid-drag hazard as dragInProgress above, but for the sidebar
// account list / space rail (native HTML5 drag-and-drop reorder) — those two
// lists get torn down and rebuilt (`innerHTML = ''`) by render(), which would
// cancel a drag in progress since the dragged element is a live DOM node the
// browser is tracking. (render() no longer runs on its own ticker — see the
// comment above the metrics/gameStats setInterval calls near init() — it
// fires reactively off onStateUpdate instead, which is still frequent enough
// mid-drag to matter.)
let listDragInProgress = false;
let draggedAccountId = null;
let draggedSpaceId = null;
// See the sidebarSignature comment inside render() — lets it skip rebuilding
// the account-list DOM when nothing about the accounts/groups themselves
// changed since the last time it actually rebuilt.
let lastSidebarSignature = null;

function reorderIds(ids, draggedId, targetId) {
  const next = ids.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex === -1 ? next.length : targetIndex, 0, draggedId);
  return next;
}
let modalColor = SPACE_COLORS[0];
let modalIcon = SPACE_ICONS[0];

function palette(i) {
  const colors = ['#4f8cff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#22b8cf'];
  return colors[i % colors.length];
}

// Reference-counted hideViews()/showViews() for the app's modal dialogs
// (settings, shortcuts, bookmarks, downloads, command palette, space/account
// editors). Each account's WebContentsView is a native layer that always
// paints above the shell's own DOM, so hideViews() has to stay in effect for
// as long as ANY modal is open. Calling showViews() independently from each
// modal's own close function — which every one of them used to do — broke as
// soon as two modals opened at once (e.g. "Ver atajos de teclado" from
// inside Configuración): closing the inner one called showViews()
// unconditionally, popping the account views back on top of the outer modal
// that was still open, which then visually blocked every click.
let openModalCount = 0;
function pushModal() {
  openModalCount++;
  if (openModalCount === 1) window.api.hideViews();
}
function popModal() {
  openModalCount = Math.max(openModalCount - 1, 0);
  if (openModalCount === 0) window.api.showViews();
}

function currentSpace() {
  return state.spaces.find((s) => s.id === state.settings.currentSpaceId) || state.spaces[0];
}

function currentSpaceAccounts() {
  const space = currentSpace();
  return state.accounts.filter((a) => a.spaceId === space?.id);
}

function activeAccount() {
  return state.accounts.find((a) => a.id === state.settings.activeAccountId);
}

function displayName(account, index) {
  return account.name || `Pestaña ${index + 1}`;
}

function escapeHtmlClient(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  // div.innerHTML already escapes &/</> for text-node safety, but a bare
  // quote is never special there — this function is also used inside HTML
  // attributes (src="...", title="...") with values that can come straight
  // from the game's own market listings (icon/iconUrl), which any player
  // can publish. Without escaping quotes too, a crafted listing could break
  // out of an attribute and inject markup into this privileged renderer.
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Guards a numeric-looking field from the game's own remote API (level,
// stats, power, IV totals — never developer-controlled) against being
// interpolated into a template literal as-is: a crafted non-numeric string
// there could inject markup the same way an unescaped id/name would.
// escapeHtmlClient() above handles arbitrary text; this is the equivalent
// for the "should always be a plain number" case, where the correct
// behavior is a safe display fallback, not HTML-escaping a string that was
// never supposed to be a string.
function numOr(value, fallback = '?') {
  return Number.isFinite(value) ? value : fallback;
}

// 'system' = sin atributo, sigue prefers-color-scheme (ver style.css);
// 'dark'/'light' fuerzan el tema explícitamente.
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// window.NEXA_I18N viene de i18n-data.js, cargado como <script> clásico
// ANTES que este archivo — no pasa por preload.js, así que no le afecta el
// sandbox del renderer (a diferencia del intento fallido de requerir
// poke-formulas.js desde preload.js).
function t(key, vars) {
  const dict = (window.NEXA_I18N && window.NEXA_I18N[state.settings.language]) || {};
  let str = dict[key] ?? (window.NEXA_I18N && window.NEXA_I18N.es[key]) ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) str = str.replace(`{${k}}`, vars[k]);
  }
  return str;
}

let alertAudioContext = null;
function playAlertTone(kind) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    alertAudioContext = alertAudioContext || new AudioCtx();
    const ctx = alertAudioContext;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(kind === 'shiny' ? 0.13 : 0.09, now + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'shiny' ? 0.72 : 0.42));
    master.connect(ctx.destination);
    const notes = kind === 'shiny'
      ? [[1046.5, 0], [1318.5, 0.12], [1760, 0.24]]
      : [[440, 0], [659.25, 0.09], [523.25, 0.18]];
    notes.forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'shiny' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.9, now + offset + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + (kind === 'shiny' ? 0.32 : 0.18));
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + offset);
      osc.stop(now + offset + (kind === 'shiny' ? 0.36 : 0.22));
    });
  } catch (err) {
    console.warn('[audio] playAlertTone falló:', err);
  }
}

function translateStaticDom() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

// Re-renderiza todo el texto visible sin recargar la página — el mismo
// mecanismo que ya usa el polling de 5s del modal de Poke Idle (las
// funciones render* son idempotentes), solo que disparado a demanda.
function applyLanguage(lang) {
  document.documentElement.lang = lang;
  translateStaticDom();
  render();
  renderRail();
  if (!settingsModal.classList.contains('hidden')) {
    renderExtensions();
    renderPlugins();
    renderPasswords();
    renderNetworkTab();
    renderPermissionsTab();
  }
  if (!shortcutsModal.classList.contains('hidden')) renderShortcutsList();
  if (!bookmarksModal.classList.contains('hidden')) renderBookmarksList();
  if (!downloadsModal.classList.contains('hidden')) renderDownloadsList();
  if (pokeIdlePanel.classList.contains('open')) {
    renderPokeIdleTeam();
    renderPokeAccountSettings();
  }
  if (!cmdkModal.classList.contains('hidden')) renderCmdkResults();
}

function formatDuration(ms) {
  const seconds = Math.max(Math.floor(ms / 1000), 0);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Qualitative read for the per-account CPU row (inspired by Firefox's
// about:performance "Energy Impact" column) — a bare "7.3%" doesn't say much
// on its own next to a dozen other accounts; bajo/medio/alto reads at a
// glance. Thresholds are a starting point (per-account renderer CPU%, not
// system-wide), not measured against a specific workload.
function cpuImpactLevel(cpuPercent) {
  if (cpuPercent < 5) return { key: 'low', labelKey: 'js.metricsImpactLow' };
  if (cpuPercent < 15) return { key: 'medium', labelKey: 'js.metricsImpactMedium' };
  return { key: 'high', labelKey: 'js.metricsImpactHigh' };
}

// Opt-in timing log (localStorage.nexaPerfLog = '1', toggled from devtools)
// for measuring the real effect of the sidebar-rebuild-skip and other perf
// work instead of guessing — silent by default, no console noise in normal
// use.
const PERF_LOG = localStorage.getItem('nexaPerfLog') === '1';

// Rebuilds just the CPU/RAM row, game-stats row, and "open for Xm Ys" text
// inside each existing .account-item, without touching the rest of the item
// (name, drag handlers, status dot...) or requiring the full sidebar rebuild
// that sidebarSignature otherwise skips. Cheap: a handful of small elements
// touched per open account, not a teardown of the whole list.
//
// Called from two places, deliberately: render() (line ~915, whenever it
// actually runs) AND the existing 1s renderStatusBar ticker below — not just
// render(). metrics/gameStats update on their OWN independent 6s/5s polls
// that don't call render() themselves (confirmed live — a session sitting
// idle with several accounts farming and no other UI interaction produces
// no onStateUpdate broadcast for long stretches), and account.openedAt never
// changes after an account opens, so sidebarSignature correctly never flags
// it as "structural". Without a periodic call independent of render(), the
// CPU/RAM chip, kills/xp/gold-per-hour row, and "open for Xm Ys" text would
// all freeze at whatever value was on screen at the last unrelated state
// broadcast — for the exact "leave several accounts farming" use case this
// app is built around. The 1s ticker already exists for the status bar
// clock, so piggybacking on it costs nothing extra to schedule.
function refreshAccountMetricsRows() {
  listEl.querySelectorAll('.account-item[data-account-id]').forEach((item) => {
    item.querySelector('.account-metrics-row')?.remove();
    item.querySelector('.account-game-stats-row')?.remove();

    const accountId = item.dataset.accountId;
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account || account.closed) return;

    // sidebarSignature includes `closed`, so any open<->closed transition
    // already forces a full rebuild — meaning this span reliably exists
    // already whenever we get here with an open, openedAt-having account.
    if (account.openedAt) {
      const durationEl = item.querySelector('.account-open-duration');
      if (durationEl) durationEl.textContent = formatDuration(Date.now() - account.openedAt);
    }

    const m = metrics[accountId];
    if (m && state.settings.showAccountMetrics !== false) {
      const metricsRow = document.createElement('div');
      metricsRow.className = 'account-metrics-row';
      const impact = cpuImpactLevel(m.cpu);
      metricsRow.innerHTML =
        `<span>CPU ${m.cpu.toFixed(1)}%</span>` +
        `<span class="metrics-impact ${impact.key}">${t(impact.labelKey)}</span>` +
        `<span>RAM ${m.memoryMB} MB</span>`;
      item.append(metricsRow);
    }

    // Fase B: only present for accounts on poke.idleworld.online — getGameStats()
    // returns null for every other account, same shape as getMetrics() returning
    // nothing for a closed account above.
    const gs = gameStats[accountId];
    if (gs) {
      const gameRow = document.createElement('div');
      gameRow.className = 'account-game-stats-row';
      gameRow.title = gs.connected ? t('js.gameConnected') : t('js.gameDisconnected');
      const dot = gs.connected ? '🟢' : '⚪';
      const wallet = gs.wallet || {};
      const trustedGoldSource = ['visual-shop', 'visual-hud', 'visual', 'adjusted'].includes(wallet.goldSource);
      const walletHtml = wallet.gold != null && trustedGoldSource
        ? `<span>${currencySymbol('GOLD')}${formatCompactNumber(wallet.gold)}</span>`
        : '';
      gameRow.innerHTML =
        `<span>${dot} ${formatCompactNumber(gs.killsPerHour)} ${t('pokeIdle.killsPerHour')}</span>` +
        `<span>${formatCompactNumber(gs.xpPerHour)} ${t('pokeIdle.xpPerHour')}</span>` +
        `<span>${formatCompactNumber(gs.goldPerHour)} 🪙/h</span>` +
        walletHtml +
        (gs.captures ? `<span>${gs.captures} ${t('pokeIdle.captures')}</span>` : '') +
        (gs.shinyCaught ? `<span>✨ ${gs.shinyCaught}</span>` : '');
      item.append(gameRow);
    }
  });
}

function render() {
  const __perfStart = PERF_LOG ? performance.now() : 0;
  reconcileWebviews();
  updateTranslateButton();
  // Positions any <webview> just created above. Needed here too (not just
  // in onPanelsGeometry) because panels:geometry can arrive before the
  // account list does at startup — if it does, positionWebviews() runs
  // against an empty #panel-webviews and nothing re-triggers it later,
  // leaving every panel stuck hidden until the next unrelated geometry
  // change (a resize, a layout switch, ...).
  positionWebviews();
  if (!listDragInProgress) renderRail();
  renderExtensionToolbar();

  const collapsed = !!state.settings.sidebarCollapsed;
  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  sidebarEl.classList.toggle('collapsed', collapsed);
  sidebarEl.style.width = sidebarWidth + 'px';
  const contentLeft = RAIL_WIDTH + sidebarWidth + 'px';
  topbarEl.style.left = contentLeft;
  emptyStateEl.style.left = contentLeft;
  btnNewTab.textContent = collapsed ? '+' : t('sidebar.newTab');
  btnCollapseSidebar.title = collapsed ? t('js.expandSidebar') : t('js.collapseSidebar');

  const space = currentSpace();
  spaceNameEl.textContent = space?.name || '';
  // Extends the color the rail icon already used (space.color, only place it
  // was applied before this) into the sidebar itself — a dot next to the
  // space name, and an accent CSS var the active-account highlight below
  // picks up. Same idea as Firefox Containers' colored tab indicator: which
  // Space you're in should read at a glance, not just from the rail icon.
  const spaceAccentColor = space?.color || '#4f8cff';
  spaceColorDotEl.style.background = spaceAccentColor;
  sidebarEl.style.setProperty('--space-accent', spaceAccentColor);

  const spaceAccounts = currentSpaceAccounts();
  const spaceAccountIndex = new Map(spaceAccounts.map((a, i) => [a.id, i]));

  // render() fires reactively off onStateUpdate — every account/space change,
  // but also every unrelated one (a permission grant, an ad-block stat tick,
  // any settings toggle) — yet used to tear down and rebuild every single
  // account-list DOM node (`innerHTML = ''` below) regardless of whether
  // anything about the accounts/groups themselves actually changed. This
  // signature captures everything buildAccountItem's structure/text actually
  // depends on (order, membership, closed/muted state, color, name, which
  // group, group collapse state, active account, language); skip the full
  // rebuild when it's identical to last time, which is most calls in
  // practice. Deliberately excludes live metrics/gameStats — those already
  // only ever refresh opportunistically on whatever render() happens to run
  // next (their own polls don't call render()), so leaving them out of the
  // signature doesn't change that existing behavior.
  const sidebarSignature = JSON.stringify({
    lang: state.settings.language,
    spaceId: space?.id,
    activeId: state.settings.activeAccountId,
    showAccountMetrics: state.settings.showAccountMetrics !== false,
    accounts: spaceAccounts.map((a) => [a.id, a.groupId || '', a.closed ? 1 : 0, a.muted ? 1 : 0, a.color || '', a.name || '']),
    groups: (state.groups || []).filter((g) => g.spaceId === space?.id).map((g) => [g.id, g.name, g.collapsed ? 1 : 0])
  });
  const sidebarListStale = sidebarSignature !== lastSidebarSignature;

  if (!listDragInProgress && sidebarListStale) {
  lastSidebarSignature = sidebarSignature;
  listEl.innerHTML = '';
  function buildAccountItem(account) {
    const i = spaceAccountIndex.get(account.id);
    const item = document.createElement('div');
    item.className = 'account-item'
      + (account.id === state.settings.activeAccountId ? ' active' : '')
      + (account.closed ? ' closed' : '');
    item.draggable = true;
    item.dataset.accountId = account.id;
    item.ondragstart = (e) => {
      draggedAccountId = account.id;
      listDragInProgress = true;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    };
    item.ondragover = (e) => {
      if (!draggedAccountId || draggedAccountId === account.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    };
    item.ondrop = (e) => {
      e.preventDefault();
      if (!draggedAccountId || draggedAccountId === account.id) return;
      const spaceIds = spaceAccounts.map((a) => a.id);
      const reordered = reorderIds(spaceIds, draggedAccountId, account.id);
      let idx = 0;
      const fullOrder = state.accounts.map((a) =>
        a.spaceId === space?.id ? reordered[idx++] : a.id
      );
      window.api.reorderAccounts(fullOrder);
    };
    item.ondragend = () => {
      draggedAccountId = null;
      listDragInProgress = false;
      render(); // catch up on anything held back during the drag
    };

    const statusDot = document.createElement('div');
    statusDot.className = 'account-status-dot' + (account.closed ? '' : ' online');

    const header = document.createElement('div');
    header.className = 'account-item-header';

    const dot = document.createElement('div');
    dot.className = 'account-dot';
    dot.style.background = account.color || palette(i);

    const name = document.createElement('div');
    name.className = 'account-name';
    name.textContent = displayName(account, i);

    const remove = document.createElement('button');
    remove.className = 'account-remove';
    remove.textContent = '✕';
    remove.onclick = (e) => {
      e.stopPropagation();
      window.api.removeAccount(account.id);
    };

    header.append(dot, name, remove);
    item.append(statusDot, header);

    const metaRow = document.createElement('div');
    metaRow.className = 'account-meta-row';
    const statusText = document.createElement('span');
    statusText.textContent = account.closed ? t('js.accountClosed') : t('js.accountOnline');
    metaRow.append(statusText);
    if (!account.closed && account.openedAt) {
      const timeText = document.createElement('span');
      timeText.className = 'account-open-duration';
      timeText.textContent = formatDuration(Date.now() - account.openedAt);
      metaRow.append(timeText);
    }
    if (account.muted) {
      const muteIcon = document.createElement('span');
      muteIcon.className = 'account-mute-indicator';
      muteIcon.textContent = '🔇';
      muteIcon.title = t('js.muted');
      metaRow.append(muteIcon);
    }
    item.append(metaRow);

    // Metrics/game-stats rows are NOT built here — metrics and gameStats
    // update on their own polls independent of any account/group change, so
    // building them once at item-creation time would go stale for as long
    // as the sidebar list itself doesn't need a rebuild (see
    // refreshAccountMetricsRows(), called unconditionally on every render()
    // right after this block, which fills them in for every item — freshly
    // built or reused).

    item.onclick = () => window.api.activateAccount(account.id);
    item.oncontextmenu = (e) => {
      e.preventDefault();
      window.api.showAccountMenu(account.id);
    };
    return item;
  }

  // Collapsible sub-groups within this space (browser-inspired idea #11) —
  // ungrouped accounts render first exactly as before this existed, then
  // each group as a header followed by its accounts, hidden while collapsed.
  const spaceGroups = (state.groups || []).filter((g) => g.spaceId === space?.id);
  const groupedAccounts = new Map(spaceGroups.map((g) => [g.id, []]));
  const ungroupedAccounts = [];
  spaceAccounts.forEach((account) => {
    if (account.groupId && groupedAccounts.has(account.groupId)) groupedAccounts.get(account.groupId).push(account);
    else ungroupedAccounts.push(account);
  });

  ungroupedAccounts.forEach((account) => listEl.appendChild(buildAccountItem(account)));
  spaceGroups.forEach((group) => {
    const accountsInGroup = groupedAccounts.get(group.id);
    const header = document.createElement('div');
    header.className = 'account-group-header';
    const caret = document.createElement('span');
    caret.className = 'group-caret';
    caret.textContent = group.collapsed ? '▸' : '▾';
    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String(accountsInGroup.length);
    header.append(caret, name, count);
    header.onclick = () => window.api.toggleGroupCollapsed(group.id);
    header.oncontextmenu = (e) => {
      e.preventDefault();
      window.api.showGroupMenu(group.id);
    };
    listEl.appendChild(header);
    if (!group.collapsed) accountsInGroup.forEach((account) => listEl.appendChild(buildAccountItem(account)));
  });
  }

  // Runs every render() regardless of whether the block above actually
  // rebuilt the list — metrics/gameStats arrive on their own polls (see the
  // comment near those setInterval calls further down) and would otherwise
  // only ever refresh when something structural also happened to change.
  if (!listDragInProgress) refreshAccountMetricsRows();

  const allClosed = spaceAccounts.length > 0 && spaceAccounts.every((a) => a.closed);
  btnToggleAll.classList.toggle('all-closed', allClosed);
  btnToggleAll.title = allClosed ? t('sidebar.openAll') : t('sidebar.closeAll');

  const hasOpenAccount = spaceAccounts.some((a) => !a.closed);
  emptyStateEl.classList.toggle('hidden', hasOpenAccount);

  // gameStats is only ever populated for accounts main.js has attached game
  // telemetry to (see game-telemetry.js's isGameUrl scoping) — the same set
  // of accounts that get the always-on-background-throttling exemption in
  // syncBackgroundThrottling, so this is a faithful, already-available proxy
  // for "how many accounts are paying that real CPU cost right now" without
  // needing a dedicated IPC call just for this hint. Counts across every
  // space, not just the one being viewed, since the CPU cost isn't scoped to
  // whichever space happens to be on screen.
  const openGameAccountCount = (state.accounts || []).filter((a) => !a.closed && gameStats[a.id]).length;
  gameAccountsHintEl.classList.toggle('hidden', openGameAccountCount < 3);
  if (openGameAccountCount >= 3) {
    gameAccountsHintEl.textContent = t('sidebar.gameAccountsHint', { n: openGameAccountCount });
    gameAccountsHintEl.title = t('sidebar.gameAccountsHintTitle');
  }

  if (!settingsModal.classList.contains('hidden')) {
    renderExtensions();
    renderPasswords();
  }
  if (!bookmarksModal.classList.contains('hidden')) renderBookmarksList();
  if (!downloadsModal.classList.contains('hidden')) renderDownloadsList();

  const mode = state.settings.layoutMode || 'single';
  layoutOptions.forEach((opt) => opt.classList.toggle('active', opt.dataset.mode === mode));

  const active = activeAccount();
  if (document.activeElement !== addressInput) {
    addressInput.value = active && active.url !== 'about:blank' ? active.url : '';
  }

  tbMute.textContent = active?.muted ? '🔇' : '🔊';
  tbMute.classList.toggle('muted', !!active?.muted);
  tbMuteAll.textContent = state.settings.allMuted ? '🔇' : '🔊';
  tbMuteAll.title = state.settings.allMuted ? t('js.soundOnAll') : t('topbar.muteAll');
  tbMuteAll.classList.toggle('muted', !!state.settings.allMuted);

  const protectionLevel = state.settings.protectionLevel || 'standard';
  tbShield.classList.toggle('muted', protectionLevel !== 'off');
  tbShield.title = t('js.protection' + protectionLevel[0].toUpperCase() + protectionLevel.slice(1));
  const activeBlocked = active ? metrics[active.id]?.blocked || 0 : 0;
  tbShieldCount.textContent = activeBlocked > 0 ? String(activeBlocked) : '';

  if (!dragInProgress) renderPanelHeaders();
  renderStatusBar();
  if (PERF_LOG) {
    console.log(`[perf] render() took ${(performance.now() - __perfStart).toFixed(1)}ms (sidebar list ${sidebarListStale ? 'rebuilt' : 'skipped'})`);
  }
}

function renderStatusBar() {
  const space = currentSpace();
  const spaceAccounts = currentSpaceAccounts();
  const mode = state.settings.layoutMode || 'single';
  statusSpaceInfo.textContent = `${space?.name || ''} · ${layoutLabel(mode)} · ${spaceAccounts.length}`;

  const active = activeAccount();
  statusActiveAccount.textContent = active ? t('js.activeAccountSuffix', { name: displayName(active, spaceAccounts.indexOf(active)) }) : t('js.noActiveAccount');

  let totalCpu = 0;
  let totalRam = 0;
  Object.values(metrics).forEach((m) => {
    if (!m) return;
    totalCpu += m.cpu;
    totalRam += m.memoryMB;
  });
  statusCpu.textContent = `${totalCpu.toFixed(1)}%`;
  statusRam.textContent = `${totalRam} MB`;
  statusVersion.textContent = `Versión ${appMeta.version}`;

  // "Tiempo total de uso": the oldest currently-open account's timer, so it reflects
  // real usage instead of just how long the app window has been sitting open.
  const openTimes = state.accounts.filter((a) => !a.closed && a.openedAt).map((a) => a.openedAt);
  const oldest = openTimes.length ? Math.min(...openTimes) : appMeta.startTime;
  statusTime.textContent = formatDuration(Date.now() - oldest);
}

function renderRail() {
  railSpacesEl.innerHTML = '';
  state.spaces.forEach((space) => {
    const icon = document.createElement('div');
    icon.className = 'space-icon' + (space.id === state.settings.currentSpaceId ? ' active' : '');
    icon.style.background = space.color || '#4f8cff';
    icon.innerHTML = SPACE_ICON_SVGS[space.icon] || SPACE_ICON_SVGS.grid;
    icon.title = space.name;
    icon.onclick = () => window.api.activateSpace(space.id);
    icon.oncontextmenu = (e) => {
      e.preventDefault();
      window.api.showSpaceMenu(space.id);
    };
    icon.draggable = true;
    icon.ondragstart = (e) => {
      draggedSpaceId = space.id;
      listDragInProgress = true;
      e.dataTransfer.effectAllowed = 'move';
      icon.classList.add('dragging');
    };
    icon.ondragover = (e) => {
      if (!draggedSpaceId || draggedSpaceId === space.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    };
    icon.ondrop = (e) => {
      e.preventDefault();
      if (!draggedSpaceId || draggedSpaceId === space.id) return;
      const order = reorderIds(state.spaces.map((s) => s.id), draggedSpaceId, space.id);
      window.api.reorderSpaces(order);
    };
    icon.ondragend = () => {
      draggedSpaceId = null;
      listDragInProgress = false;
      render();
    };

    const count = state.accounts.filter((a) => a.spaceId === space.id).length;
    if (count > 0) {
      const badge = document.createElement('div');
      badge.className = 'space-badge';
      badge.textContent = count;
      icon.appendChild(badge);
    }

    railSpacesEl.appendChild(icon);
  });
}

function renderPanelHeaders() {
  const focused = document.activeElement;
  const isUrlFocused = focused && focused.classList && focused.classList.contains('panel-url');
  const focusedPanelId = isUrlFocused ? focused.dataset.id : null;
  const focusedValue = isUrlFocused ? focused.value : null;
  const focusedSelStart = isUrlFocused ? focused.selectionStart : null;
  const focusedSelEnd = isUrlFocused ? focused.selectionEnd : null;

  panelHeadersEl.innerHTML = '';
  const isFree = state.settings.layoutMode === 'free';
  panelsGeometry.forEach((panel, i) => {
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.dataset.id = panel.id;
    header.style.left = panel.rect.x + 'px';
    header.style.top = panel.rect.y + 'px';
    header.style.width = panel.rect.width + 'px';
    header.style.height = panel.rect.height + 'px';
    header.oncontextmenu = (e) => {
      e.preventDefault();
      window.api.showAccountMenu(panel.id);
    };

    if (isFree && !panel.maximized) {
      const dragHandle = document.createElement('button');
      dragHandle.textContent = '⠿';
      dragHandle.className = 'drag-handle';
      dragHandle.title = t('js.movePanel');
      dragHandle.onmousedown = (e) => startFreeDrag(e, panel.id, 'move');
      header.appendChild(dragHandle);
    }

    const dot = document.createElement('div');
    dot.className = 'account-dot';
    dot.style.background = panel.color || palette(i);

    const name = document.createElement('div');
    name.className = 'panel-name';
    name.textContent = panel.name;

    const loadPhase = panelLoadingPhase.get(panel.id);
    if (loadPhase) {
      const phaseBadge = document.createElement('span');
      phaseBadge.className = 'panel-load-phase';
      phaseBadge.textContent = t(loadPhase === 'connecting' ? 'js.phaseConnecting' : 'js.phaseLoading');
      name.appendChild(phaseBadge);
    }

    const urlInput = document.createElement('input');
    urlInput.className = 'panel-url';
    urlInput.type = 'text';
    urlInput.placeholder = t('js.newTabPlaceholder');
    urlInput.dataset.id = panel.id;
    urlInput.value =
      panel.id === focusedPanelId ? focusedValue : panel.url && panel.url !== 'about:blank' ? panel.url : '';
    urlInput.onclick = (e) => e.stopPropagation();
    urlInput.onmousedown = (e) => e.stopPropagation();
    urlInput.onkeydown = (e) => {
      if (e.key === 'Escape') {
        hideSuggestions();
        return;
      }
      if (e.key !== 'Enter') return;
      const value = urlInput.value.trim();
      if (value) window.api.navigateAccount(panel.id, value);
      hideSuggestions();
      urlInput.blur();
    };
    urlInput.oninput = () => showSuggestions(urlInput, panel.id);
    urlInput.addEventListener('blur', () => setTimeout(hideSuggestions, 100));
    if (panel.id === focusedPanelId) {
      requestAnimationFrame(() => {
        urlInput.focus();
        urlInput.setSelectionRange(focusedSelStart, focusedSelEnd);
        if (activeSuggestFor === panel.id) showSuggestions(urlInput, panel.id);
      });
    }

    const muteBtn = document.createElement('button');
    muteBtn.textContent = panel.muted ? '🔇' : '🔊';
    muteBtn.className = panel.muted ? 'muted' : '';
    muteBtn.title = t('topbar.mute');
    muteBtn.onclick = () => window.api.muteAccount(panel.id, !panel.muted);

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '⟳';
    reloadBtn.title = t('topbar.reload');
    reloadBtn.onclick = () => window.api.reloadAccount(panel.id);

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.textContent = panel.maximized ? '⤡' : '⛶';
    fullscreenBtn.title = panel.maximized ? t('js.restore') : t('topbar.fullscreen');
    fullscreenBtn.onclick = () => window.api.toggleMaximize(panel.id);

    const zoomBtn = document.createElement('button');
    zoomBtn.textContent = Math.round((panel.zoom || 1) * 100) + '%';
    zoomBtn.title = t('js.zoomTab');
    zoomBtn.style.width = 'auto';
    zoomBtn.style.padding = '0 4px';
    zoomBtn.style.fontSize = '10px';
    zoomBtn.onclick = (e) => {
      e.stopPropagation();
      openPanelZoomMenu(zoomBtn, panel.id, panel.zoom || 1);
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = t('js.closeTab');
    closeBtn.onclick = () => window.api.closeAccount(panel.id);

    header.append(dot, name, urlInput, muteBtn, reloadBtn, zoomBtn, fullscreenBtn, closeBtn);
    panelHeadersEl.appendChild(header);

    if (isFree && !panel.maximized) {
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.style.left = (panel.fullRect.x + panel.fullRect.width - 14) + 'px';
      resizeHandle.style.top = (panel.fullRect.y + panel.fullRect.height - 14) + 'px';
      resizeHandle.onmousedown = (e) => startFreeDrag(e, panel.id, 'resize');
      panelHeadersEl.appendChild(resizeHandle);
    }
  });

  renderSplitDividers();
}

// ---- Account <webview> elements ----
// Each open account gets a real <webview> in the DOM now (see the plan doc
// for why: WebContentsView, the native-view API this used to composite
// account pages with, is what caused Cloudflare Turnstile to flag the
// game's login page as a bot — <webview> doesn't trip that check). Existence
// tracks state.accounts (an account keeps its <webview> alive in the
// background even while hidden by the current layout — same lifetime a
// WebContentsView used to have); visibility/position tracks panelsGeometry
// (only the panels the current layout mode actually shows).

function applyContentRect(el, rect) {
  el.style.left = rect.x + 'px';
  el.style.top = rect.y + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
}

// Creates a <webview> for every open account that doesn't have one yet, and
// removes elements for accounts that are closed or gone. Cheap to call
// often — the per-account check is just a DOM lookup.
function reconcileWebviews() {
  const openIds = new Set(state.accounts.filter((a) => !a.closed).map((a) => a.id));
  Array.from(panelWebviewsEl.children).forEach((el) => {
    if (!openIds.has(el.dataset.id)) el.remove();
  });
  state.accounts.forEach((account) => {
    if (account.closed || document.getElementById('wv-' + account.id)) return;
    const wv = document.createElement('webview');
    wv.id = 'wv-' + account.id;
    wv.className = 'panel-webview hidden-panel';
    wv.dataset.id = account.id;
    wv.setAttribute('partition', 'persist:account-' + account.id);
    wv.setAttribute('preload', appMeta.accountPreloadUrl);
    // backgroundThrottling=no: inactive-panel <webview>s go display:none
    // (see .hidden-panel in style.css), and Chromium's default background
    // throttling treats that like any hidden/backgrounded page — rAF nearly
    // stops and setInterval/setTimeout clamp down hard after a few minutes
    // hidden. That silently starves the game's own WS keepalive/ping timer,
    // the server times the connection out, and the character shows up
    // "frozen" next time that panel is viewed. poke-idle-launcher (the
    // reference project cited in game-telemetry.js) hits the same problem
    // and fixes it the same way: keep the renderer's timers running at full
    // speed regardless of paint visibility. Just the safe starting default
    // for the initial about:blank load — main.js's syncBackgroundThrottling()
    // (wireAccountWebContents) takes over dynamically once the account's
    // real URL is known, re-enabling normal throttling for non-game pages
    // (e.g. sitting on /login) since those don't need full-speed hidden
    // timers and idle CPU adds up across several open accounts.
    wv.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,backgroundThrottling=no');
    // <webview> blocks window.open()/new-window entirely by default, no
    // matter what setWindowOpenHandler on the main-process side returns —
    // this attribute is the separate, additional opt-in <webview> itself
    // needs. Without it, "Continue with Google" (and any other
    // window.open()-based popup, e.g. some payment flows) silently never
    // opens a window at all.
    wv.setAttribute('allowpopups', '');
    // Starts on about:blank on purpose — main's did-attach-webview handler
    // (wireAccountWebContents) needs to finish wiring this webContents
    // (session, CDP telemetry, listeners) before the real navigation
    // starts, or the game's own WebSocket connection can be missed
    // entirely. window.api.onWebviewReady below sets the real `src` once
    // main confirms that's done.
    wv.src = 'about:blank';
    panelWebviewsEl.appendChild(wv);

    // Named phases instead of a plain spinner: "Conectando…" while waiting
    // on the network/server, "Cargando…" once the page's own DOM exists but
    // scripts/assets are still coming in. Purely cosmetic — reading these
    // events doesn't change how the webview itself loads or throttles.
    wv.addEventListener('did-start-loading', () => {
      panelLoadingPhase.set(account.id, 'connecting');
      renderPanelHeaders();
    });
    wv.addEventListener('dom-ready', () => {
      if (!panelLoadingPhase.has(account.id)) return;
      panelLoadingPhase.set(account.id, 'loading');
      renderPanelHeaders();
    });
    wv.addEventListener('did-stop-loading', () => {
      if (panelLoadingPhase.delete(account.id)) renderPanelHeaders();
    });
  });
}

// Shows/positions every <webview> the current layout has a cell for, and
// hides (without removing) every other open account's <webview> — except an
// account with an active Picture-in-Picture session (see onPipState below),
// which stays off-screen instead of display:none. A hidden guest stops
// compositing entirely, and the OS-level PiP window freezes/closes the
// moment its source page stops painting, so switching away from that
// account can't hide it the normal way while PiP is active.
function positionWebviews() {
  const visibleIds = new Set(panelsGeometry.map((p) => p.id));
  Array.from(panelWebviewsEl.children).forEach((el) => {
    if (visibleIds.has(el.dataset.id)) return;
    if (el.classList.contains('pip-active')) {
      el.classList.remove('hidden-panel');
      el.style.left = '-10000px';
      el.style.top = '-10000px';
    } else {
      el.classList.add('hidden-panel');
    }
  });
  panelsGeometry.forEach((panel) => {
    const el = document.getElementById('wv-' + panel.id);
    if (!el) return;
    el.classList.remove('hidden-panel');
    applyContentRect(el, panel.contentRect);
  });
}

// ---- Resizable dividers (columns/rows/grid) ----
// Lets the user drag the gap between panels to make one bigger at another's expense,
// instead of only the equal split. Sizes are stored per-account as widthFrac/heightFrac
// (see resolveFracs in main.js) so they persist and survive account add/remove.
const SPLIT_GAP = 4; // must match GAP in electron/main.js

function renderSplitDividers() {
  const mode = state.settings.layoutMode;
  if (mode !== 'columns' && mode !== 'rows' && mode !== 'grid') return;
  if (panelsGeometry.length < 2 || panelsGeometry.some((p) => p.maximized)) return;

  if (mode === 'columns') {
    renderDividersForGroup(panelsGeometry, 'widthFrac');
  } else if (mode === 'rows') {
    renderDividersForGroup(panelsGeometry, 'heightFrac');
  } else {
    const rows = [];
    panelsGeometry.forEach((p) => {
      const last = rows[rows.length - 1];
      if (last && last[0].fullRect.y === p.fullRect.y) last.push(p);
      else rows.push([p]);
    });
    rows.forEach((row) => renderDividersForGroup(row, 'widthFrac'));
    if (rows.length > 1) renderDividersForGroup(rows.map((row) => row[0]), 'heightFrac');
  }
}

function renderDividersForGroup(group, field) {
  const isWidth = field === 'widthFrac';
  for (let i = 0; i < group.length - 1; i++) {
    const a = group[i];
    const div = document.createElement('div');
    div.className = 'split-divider ' + (isWidth ? 'split-divider-v' : 'split-divider-h');
    if (isWidth) {
      div.style.left = (a.fullRect.x + a.fullRect.width + SPLIT_GAP / 2 - 5) + 'px';
      div.style.top = a.fullRect.y + 'px';
      div.style.height = a.fullRect.height + 'px';
    } else {
      div.style.left = a.fullRect.x + 'px';
      div.style.top = (a.fullRect.y + a.fullRect.height + SPLIT_GAP / 2 - 5) + 'px';
      div.style.width = a.fullRect.width + 'px';
    }
    div.onmousedown = (e) => startSplitDrag(e, group, field, i);
    div.ondblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetSplitPair(group, field, i);
    };
    panelHeadersEl.appendChild(div);
  }
}

function startSplitDrag(e, group, field, pairIndex) {
  e.preventDefault();
  e.stopPropagation();
  setDragInProgress(true);
  // A <webview> is real, hit-testable content — without this, a mousemove
  // that crosses over one mid-drag gets captured by the guest instead of
  // reaching this function's own document-level mousemove listener,
  // silently truncating the drag distance the moment the cursor enters a
  // panel. WebContentsView never needed this here (see hideViews()/
  // showViews() in preload.js for the actual pointer-events toggle).
  window.api.hideViews();
  const isWidth = field === 'widthFrac';
  const dividerEl = e.currentTarget;

  // Unlike free-drag (which floats a whole panel and needs a placeholder since the
  // native view can't be dragged smoothly), a divider only resizes two views in
  // place — so instead of hiding everything behind a ghost, the real page content
  // is resized live on every mousemove via setLiveRect, and only the final commit
  // (persisted fracs + a full renderLayout) happens on mouseup.
  const headerA = panelHeadersEl.querySelector(`.panel-header[data-id="${group[pairIndex].id}"]`);
  const headerB = panelHeadersEl.querySelector(`.panel-header[data-id="${group[pairIndex + 1].id}"]`);
  const headerH = group[pairIndex].rect.height;

  // startSizes stays untouched for the whole drag — every onMove computes the new
  // size from this fixed baseline plus the total delta-from-start, never from the
  // previous frame's (already-adjusted) size. Accumulating onto a mutated size here
  // compounds with every mousemove event and blows up almost instantly.
  const startSizes = group.map((p) => (isWidth ? p.fullRect.width : p.fullRect.height));
  const currentSizes = [...startSizes];
  const startX = e.clientX;
  const startY = e.clientY;
  const minPx = 140;

  // mousemove fires far more often than the display can repaint (sometimes
  // 100+ times/sec) — sending window.api.setLiveRect for both panels on
  // every single event means that many IPC round-trips to main.js per
  // second, most of which the compositor was never going to show anyway.
  // Batching to one flush per animation frame keeps the drag visually just
  // as smooth (the divider line and headers still update synchronously
  // below) while cutting the actual IPC traffic to the display's real
  // refresh rate.
  let pendingRects = null;
  let rafId = null;
  function flushLiveRect() {
    rafId = null;
    if (!pendingRects) return;
    window.api.setLiveRect(group[pairIndex].id, pendingRects.rectA);
    window.api.setLiveRect(group[pairIndex + 1].id, pendingRects.rectB);
    pendingRects = null;
  }

  function onMove(ev) {
    const delta = isWidth ? ev.clientX - startX : ev.clientY - startY;
    let a = startSizes[pairIndex] + delta;
    let b = startSizes[pairIndex + 1] - delta;
    if (a < minPx) { b -= minPx - a; a = minPx; }
    if (b < minPx) { a -= minPx - b; b = minPx; }
    currentSizes[pairIndex] = Math.max(a, 40);
    currentSizes[pairIndex + 1] = Math.max(b, 40);

    const fullA = group[pairIndex].fullRect;
    const fullB = group[pairIndex + 1].fullRect;
    let rectA, rectB;
    if (isWidth) {
      rectA = { x: fullA.x, y: fullA.y, width: currentSizes[pairIndex], height: fullA.height };
      rectB = { x: fullA.x + currentSizes[pairIndex] + SPLIT_GAP, y: fullB.y, width: currentSizes[pairIndex + 1], height: fullB.height };
      dividerEl.style.left = rectB.x - SPLIT_GAP / 2 - 5 + 'px';
    } else {
      rectA = { x: fullA.x, y: fullA.y, width: fullA.width, height: currentSizes[pairIndex] };
      rectB = { x: fullB.x, y: fullA.y + currentSizes[pairIndex] + SPLIT_GAP, width: fullB.width, height: currentSizes[pairIndex + 1] };
      dividerEl.style.top = rectB.y - SPLIT_GAP / 2 - 5 + 'px';
    }

    pendingRects = { rectA, rectB };
    if (rafId === null) rafId = requestAnimationFrame(flushLiveRect);
    if (headerA) { headerA.style.left = rectA.x + 'px'; headerA.style.top = rectA.y + 'px'; headerA.style.width = rectA.width + 'px'; headerA.style.height = headerH + 'px'; }
    if (headerB) { headerB.style.left = rectB.x + 'px'; headerB.style.top = rectB.y + 'px'; headerB.style.width = rectB.width + 'px'; headerB.style.height = headerH + 'px'; }
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (rafId !== null) { cancelAnimationFrame(rafId); flushLiveRect(); }
    activeDragCleanup = null;
    setDragInProgress(false);
    window.api.showViews();
    renderPanelHeaders(); // catch up on any geometry that arrived mid-drag and was held back
    positionWebviews();
    commitSplit(group, field, currentSizes);
  }

  activeDragCleanup = onUp;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function resetSplitPair(group, field, pairIndex) {
  const isWidth = field === 'widthFrac';
  const sizes = group.map((p) => (isWidth ? p.fullRect.width : p.fullRect.height));
  const total = sizes[pairIndex] + sizes[pairIndex + 1];
  sizes[pairIndex] = total / 2;
  sizes[pairIndex + 1] = total / 2;
  commitSplit(group, field, sizes);
}

function commitSplit(group, field, sizes) {
  const total = sizes.reduce((s, v) => s + v, 0);
  const fracs = sizes.map((v) => v / total);
  const ids = group.map((p) => p.id);
  window.api.setSplit(ids, fracs, field).then(() => window.api.showViews());
}

function openPanelZoomMenu(btn, panelId, currentZoom) {
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu panel-zoom-menu';
  ZOOM_LEVELS.forEach((level) => {
    const opt = document.createElement('div');
    opt.className = 'zoom-option' + (Math.abs(currentZoom - level) < 0.01 ? ' active' : '');
    opt.textContent = `${Math.round(level * 100)}%`;
    opt.onmousedown = (e) => {
      e.preventDefault();
      window.api.setZoom(panelId, level);
      closeMenu();
    };
    menu.appendChild(opt);
  });
  const rect = btn.getBoundingClientRect();
  menu.style.left = Math.round(rect.left) + 'px';
  menu.style.top = Math.round(rect.bottom + 4) + 'px';
  document.body.appendChild(menu);
  window.api.hideViews();

  function onOutside(e) {
    if (!menu.contains(e.target)) closeMenu();
  }
  function closeMenu() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside);
    window.api.showViews();
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
}

function getContentBounds() {
  const collapsed = !!state.settings.sidebarCollapsed;
  const left = RAIL_WIDTH + (collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED);
  const top = 44;
  const bottom = 26;
  return {
    x: left,
    y: top,
    width: Math.max(window.innerWidth - left, 0),
    height: Math.max(window.innerHeight - top - bottom, 0)
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(v, Math.max(min, max)));
}

function startFreeDrag(e, id, mode) {
  e.preventDefault();
  e.stopPropagation();
  const panel = panelsGeometry.find((p) => p.id === id);
  if (!panel) return;
  setDragInProgress(true);
  const bounds = getContentBounds();
  window.api.hideViews();

  const overlay = document.createElement('div');
  overlay.id = 'free-drag-overlay';
  document.body.appendChild(overlay);

  let activeGhost = null;
  panelsGeometry.forEach((p) => {
    const g = document.createElement('div');
    g.className = 'free-ghost' + (p.id === id ? ' active' : '');
    g.style.left = p.fullRect.x + 'px';
    g.style.top = p.fullRect.y + 'px';
    g.style.width = p.fullRect.width + 'px';
    g.style.height = p.fullRect.height + 'px';
    g.textContent = p.name;
    overlay.appendChild(g);
    if (p.id === id) activeGhost = g;
  });

  const startRect = { ...panel.fullRect };
  const startX = e.clientX;
  const startY = e.clientY;

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (mode === 'move') {
      const x = clamp(startRect.x + dx, bounds.x, bounds.x + bounds.width - startRect.width);
      const y = clamp(startRect.y + dy, bounds.y, bounds.y + bounds.height - startRect.height);
      activeGhost.style.left = x + 'px';
      activeGhost.style.top = y + 'px';
    } else {
      const w = clamp(startRect.width + dx, 220, bounds.x + bounds.width - startRect.x);
      const h = clamp(startRect.height + dy, 160, bounds.y + bounds.height - startRect.y);
      activeGhost.style.width = w + 'px';
      activeGhost.style.height = h + 'px';
    }
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    activeDragCleanup = null;
    setDragInProgress(false);
    renderPanelHeaders(); // catch up on any geometry that arrived mid-drag and was held back
    positionWebviews();
    const finalX = parseFloat(activeGhost.style.left);
    const finalY = parseFloat(activeGhost.style.top);
    const finalW = parseFloat(activeGhost.style.width);
    const finalH = parseFloat(activeGhost.style.height);
    overlay.remove();
    const rect = {
      x: (finalX - bounds.x) / bounds.width,
      y: (finalY - bounds.y) / bounds.height,
      width: finalW / bounds.width,
      height: finalH / bounds.height
    };
    window.api.setFreeRect(id, rect).then(() => window.api.showViews());
  }

  activeDragCleanup = onUp;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ---- Space modal ----

function openSpaceModal(space) {
  editingSpaceId = space ? space.id : null;
  spaceInputName.value = space ? space.name : t('js.newSpaceDefaultName');
  modalColor = space?.color || SPACE_COLORS[0];
  modalIcon = space?.icon || SPACE_ICONS[0];
  spaceInputUrl.value = space?.defaultUrl || 'https://www.google.com';
  spaceInputLayout.value = space?.defaultLayout || 'single';
  const isFirstSpace = space && state.spaces[0]?.id === space.id;
  btnDeleteSpace.style.display = space && state.spaces.length > 1 && !isFirstSpace ? 'inline-block' : 'none';
  renderSwatches();
  spaceModal.classList.remove('hidden');
  pushModal();
  spaceInputName.focus();
}

function closeSpaceModal() {
  spaceModal.classList.add('hidden');
  editingSpaceId = null;
  popModal();
}

function renderSwatches() {
  spaceColorsEl.innerHTML = '';
  SPACE_COLORS.forEach((color) => {
    const sw = document.createElement('div');
    sw.className = 'swatch-color' + (color === modalColor ? ' selected' : '');
    sw.style.background = color;
    sw.onclick = () => {
      modalColor = color;
      renderSwatches();
    };
    spaceColorsEl.appendChild(sw);
  });

  spaceIconsEl.innerHTML = '';
  SPACE_ICONS.forEach((icon) => {
    const sw = document.createElement('div');
    sw.className = 'swatch-icon' + (icon === modalIcon ? ' selected' : '');
    sw.innerHTML = SPACE_ICON_SVGS[icon];
    sw.onclick = () => {
      modalIcon = icon;
      renderSwatches();
    };
    spaceIconsEl.appendChild(sw);
  });
}

btnAddSpace.addEventListener('click', () => {
  // Instant creation with a random color/icon — no form to fill in first;
  // rename or restyle later via the pencil icon if you want.
  const color = SPACE_COLORS[Math.floor(Math.random() * SPACE_COLORS.length)];
  const icon = SPACE_ICONS[Math.floor(Math.random() * SPACE_ICONS.length)];
  window.api.addSpace({ name: `Espacio ${state.spaces.length + 1}`, color, icon });
});
btnEditSpace.addEventListener('click', () => openSpaceModal(currentSpace()));

window.api.onPromptNewGroup(async ({ accountId, spaceId }) => {
  const name = prompt(t('groupPrompt.name'));
  if (!name || !name.trim()) return;
  const group = await window.api.createGroup(spaceId, name.trim());
  if (group && group.id) window.api.setAccountGroup(accountId, group.id);
});

window.api.onPromptRenameGroup(({ groupId, currentName }) => {
  const name = prompt(t('groupPrompt.name'), currentName || '');
  if (name && name.trim()) window.api.renameGroup(groupId, name.trim());
});
btnCancelSpace.addEventListener('click', closeSpaceModal);
btnCollapseSidebar.addEventListener('click', () => window.api.toggleSidebar());

btnToggleAll.addEventListener('click', () => {
  const spaceAccounts = currentSpaceAccounts();
  const allClosed = spaceAccounts.length > 0 && spaceAccounts.every((a) => a.closed);
  if (allClosed) window.api.openAllAccounts();
  else window.api.closeAllAccounts();
});

btnSaveSpace.addEventListener('click', async () => {
  const payload = {
    name: spaceInputName.value.trim() || t('js.spaceDefaultName'),
    color: modalColor,
    icon: modalIcon,
    defaultUrl: spaceInputUrl.value.trim() || 'https://www.google.com',
    defaultLayout: spaceInputLayout.value
  };
  if (editingSpaceId) {
    await window.api.updateSpace(editingSpaceId, payload);
  } else {
    await window.api.addSpace(payload);
  }
  closeSpaceModal();
});

btnDeleteSpace.addEventListener('click', async () => {
  if (editingSpaceId) await window.api.removeSpace(editingSpaceId);
  closeSpaceModal();
});

// ---- Account modal ----

let editingAccountId = null;
let accountModalColor = SPACE_COLORS[0];

function openAccountModal(account) {
  if (!account) return;
  editingAccountId = account.id;
  accountInputName.value = account.name || '';
  accountInputUrl.value = account.url || '';
  accountInputProxy.value = account.proxy?.server || '';
  accountInputProxyUser.value = account.proxy?.username || '';
  accountInputProxyPass.value = account.proxy?.password || '';
  accountInputEco.checked = !!account.ecoMode;
  accountInputHideChat.checked = !!account.hideChat;
  accountInputHideGameBar.checked = !!account.hideGameBar;
  accountInputSellLock.checked = !!account.sellLockOn;
  accountModalColor = account.color || SPACE_COLORS[0];
  renderAccountSwatches();
  renderSellLockItems(account);
  populateSellLockItemPicker();
  accountModal.classList.remove('hidden');
  pushModal();
  accountInputName.focus();
}

let itemCatalogCache = null;
let itemCatalogPromise = null;
async function ensureItemCatalogRenderer() {
  if (itemCatalogCache) return itemCatalogCache;
  if (!itemCatalogPromise) {
    itemCatalogPromise = window.api.getItemCatalog()
      .then((list) => {
        itemCatalogCache = Array.isArray(list) ? list : [];
        return itemCatalogCache;
      })
      .catch(() => {
        itemCatalogPromise = null;
        return [];
      });
  }
  return itemCatalogPromise;
}

async function populateSellLockItemPicker() {
  await ensureItemCatalogRenderer();
  accountSellLockItemPicker.innerHTML = itemCatalogCache
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((it) => `<option value="${it.id}">${escapeHtmlClient(it.name)}</option>`)
    .join('');
}

function renderSellLockItems(account) {
  const ids = account.sellLockItemIds || [];
  if (!ids.length) {
    accountSellLockItemsEl.innerHTML = `<span class="settings-hint">${t('pokeIdle.sellLockItemsEmpty')}</span>`;
    return;
  }
  const byId = new Map((itemCatalogCache || []).map((it) => [it.id, it.name]));
  accountSellLockItemsEl.innerHTML = ids
    .map((id) => `<span class="selllock-chip" data-id="${id}">${escapeHtmlClient(byId.get(id) || `#${id}`)}<button type="button" data-remove="${id}">×</button></span>`)
    .join('');
  accountSellLockItemsEl.querySelectorAll('button[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!editingAccountId) return;
      const account2 = getAccount(editingAccountId);
      const next = (account2.sellLockItemIds || []).filter((id) => id !== Number(btn.dataset.remove));
      account2.sellLockItemIds = next;
      await window.api.setSellLockItems(editingAccountId, next);
      renderSellLockItems(account2);
    });
  });
}

async function populatePokeSettingsItemPicker() {
  if (!pokeSettingsSellLockItemPickerEl) return;
  await ensureItemCatalogRenderer();
  pokeSettingsSellLockItemPickerEl.innerHTML = (itemCatalogCache || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((it) => `<option value="${it.id}">${escapeHtmlClient(it.name)}</option>`)
    .join('');
}

function renderPokeSettingsLockItems(account) {
  if (!pokeSettingsSellLockItemsEl) return;
  const ids = account?.sellLockItemIds || [];
  if (!ids.length) {
    pokeSettingsSellLockItemsEl.innerHTML = `<span class="settings-hint">${t('pokeIdle.sellLockItemsEmpty')}</span>`;
    return;
  }
  const byId = new Map((itemCatalogCache || []).map((it) => [it.id, it.name]));
  pokeSettingsSellLockItemsEl.innerHTML = ids
    .map((id) => `<span class="selllock-chip" data-id="${id}">${escapeHtmlClient(byId.get(id) || `#${id}`)}<button type="button" data-remove="${id}">×</button></span>`)
    .join('');
}

function selectedPokeSettingsAccount() {
  const selectedId = pokeSettingsAccountEl?.value || state.settings.activeAccountId || state.accounts.find((a) => !a.closed)?.id || state.accounts[0]?.id;
  return selectedId ? getAccount(selectedId) : null;
}

async function renderPokeAccountSettings() {
  if (!pokeSettingsAccountEl) return;
  const accounts = state.accounts || [];
  const previous = pokeSettingsAccountEl.value || state.settings.activeAccountId || '';
  const nextId = accounts.some((a) => a.id === previous)
    ? previous
    : (accounts.find((a) => !a.closed)?.id || accounts[0]?.id || '');
  pokeSettingsAccountEl.innerHTML = accounts.map((account, index) =>
    `<option value="${escapeHtmlClient(account.id)}">${escapeHtmlClient(displayName(account, index))}${account.closed ? ' · cerrada' : ''}</option>`
  ).join('');
  pokeSettingsAccountEl.value = nextId;

  const account = selectedPokeSettingsAccount();
  const hasAccount = !!account;
  pokeSettingsEmptyEl?.classList.toggle('hidden', hasAccount);
  [pokeSettingsEcoEl, pokeSettingsEcoBenchmarkBtn, pokeSettingsHideChatEl, pokeSettingsHideGameBarEl, pokeSettingsSellLockEl, pokeSettingsSellLockItemPickerEl, pokeSettingsSellLockItemAddEl, pokeSettingsCleanProfileEl]
    .forEach((el) => { if (el) el.disabled = !hasAccount; });
  if (!account) {
    renderPokeSettingsLockItems(null);
    return;
  }
  pokeSettingsEcoEl.checked = !!account.ecoMode;
  pokeSettingsHideChatEl.checked = !!account.hideChat;
  pokeSettingsHideGameBarEl.checked = !!account.hideGameBar;
  pokeSettingsSellLockEl.checked = !!account.sellLockOn;
  if (pokeSettingsCleanProfileEl) pokeSettingsCleanProfileEl.checked = !!account.cleanGameProfile;
  await populatePokeSettingsItemPicker();
  renderPokeSettingsLockItems(account);
  refreshStabilityAccountStatus();
}

const STABILITY_STATE_CHIP = {
  HEALTHY: '🟢', IDLE: '🟡', WS_CONNECTING: '🔵', RECOVERING: '🔵',
  NETWORK_OFFLINE: '🔴', DNS_FAILURE: '🔴', SERVER_UNREACHABLE: '🔴',
  WS_STALE: '🟠', WS_CLOSED: '🟠', RENDERER_UNRESPONSIVE: '🟠',
  RENDERER_CRASHED: '⚫', RECOVERY_FAILED: '⚫', INITIALIZING: '🟡'
};

function renderStabilityGlobalSettings() {
  const s = (state.settings && state.settings.stability) || {};
  if (stabilityEnabledEl) stabilityEnabledEl.checked = !!s.enabled;
  if (stabilityKeepaliveEl) stabilityKeepaliveEl.checked = !!s.backgroundKeepalive;
  if (stabilityAutoRecoveryEl) stabilityAutoRecoveryEl.checked = s.autoRecovery !== false;
  if (stabilityLastResortReloadEl) stabilityLastResortReloadEl.checked = !!s.lastResortAutoReload;
  if (stabilityNotifyEl) stabilityNotifyEl.checked = s.disconnectNotifications !== false;
}

async function updateStabilitySettings(fields) {
  const current = (state.settings && state.settings.stability) || {};
  const next = { ...current, ...fields };
  state.settings.stability = next;
  await window.api.updateSettings({ stability: next });
}

async function refreshStabilityAccountStatus() {
  if (!stabilityAccountStatusEl) return;
  const account = selectedPokeSettingsAccount();
  if (!account || !state.settings?.stability?.enabled) {
    stabilityAccountStatusEl.textContent = t('stability.accountStatusEmpty');
    return;
  }
  try {
    const s = await window.api.getStabilityAccountState(account.id);
    if (!s) {
      stabilityAccountStatusEl.textContent = t('stability.accountStatusEmpty');
      return;
    }
    const chip = STABILITY_STATE_CHIP[s.state] || '⚪';
    const lastHealthy = s.lastHealthyAt ? new Date(s.lastHealthyAt).toLocaleTimeString() : '—';
    stabilityAccountStatusEl.textContent = `${chip} ${s.state} · intentos: ${s.attemptCount} · última vez sana: ${lastHealthy}`;
  } catch {
    stabilityAccountStatusEl.textContent = t('stability.accountStatusEmpty');
  }
}

async function updatePokeSettingsAccount(fields) {
  const account = selectedPokeSettingsAccount();
  if (!account) return;
  Object.assign(account, fields);
  await window.api.updateAccount(account.id, fields);
  renderPokeAccountSettings();
}

const ECO_BENCHMARK_SAMPLE_MS = 12000;
const ECO_BENCHMARK_WARMUP_MS = 1200;
const ECO_BENCHMARK_TICK_MS = 1000;
let ecoBenchmarkRunning = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function averageEcoMetric(samples, field) {
  const values = samples.map((sample) => Number(sample[field]) || 0).filter((value) => value >= 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ecoBenchmarkDelta(before, after) {
  if (!before || before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}

async function collectEcoBenchmarkSamples(accountId) {
  const samples = [];
  const deadline = Date.now() + ECO_BENCHMARK_SAMPLE_MS;
  while (Date.now() < deadline) {
    const snapshot = await window.api.getMetrics().catch(() => null);
    if (snapshot) {
      metrics = snapshot;
      const accountMetrics = snapshot[accountId];
      if (accountMetrics) {
        samples.push({
          cpu: Number(accountMetrics.cpu) || 0,
          memoryMB: Number(accountMetrics.memoryMB) || 0
        });
      }
      renderStatusBar();
    }
    await wait(ECO_BENCHMARK_TICK_MS);
  }
  return {
    samples: samples.length,
    cpu: averageEcoMetric(samples, 'cpu'),
    memoryMB: averageEcoMetric(samples, 'memoryMB')
  };
}

function renderEcoBenchmarkResult(before, after) {
  if (!pokeSettingsEcoBenchmarkResultEl) return;
  const cpuDelta = ecoBenchmarkDelta(before.cpu, after.cpu);
  const ramDelta = ecoBenchmarkDelta(before.memoryMB, after.memoryMB);
  const cpuClass = cpuDelta > 0 ? 'good' : (cpuDelta < 0 ? 'bad' : 'flat');
  const ramClass = ramDelta > 0 ? 'good' : (ramDelta < 0 ? 'bad' : 'flat');
  pokeSettingsEcoBenchmarkResultEl.innerHTML = `
    <div class="poke-eco-benchmark-grid">
      <span>${escapeHtmlClient(t('pokeIdle.ecoBenchmarkOff'))}</span>
      <b>${before.cpu.toFixed(1)}% CPU</b>
      <b>${Math.round(before.memoryMB)} MB</b>
      <span>${escapeHtmlClient(t('pokeIdle.ecoBenchmarkOn'))}</span>
      <b>${after.cpu.toFixed(1)}% CPU</b>
      <b>${Math.round(after.memoryMB)} MB</b>
      <span>${escapeHtmlClient(t('pokeIdle.ecoBenchmarkImprovement'))}</span>
      <b class="${cpuClass}">${cpuDelta > 0 ? '-' : '+'}${Math.abs(cpuDelta)}% CPU</b>
      <b class="${ramClass}">${ramDelta > 0 ? '-' : '+'}${Math.abs(ramDelta)}% RAM</b>
    </div>
    <p>${escapeHtmlClient(t('pokeIdle.ecoBenchmarkFrameHint'))}</p>
  `;
}

async function runEcoBenchmark() {
  const account = selectedPokeSettingsAccount();
  if (!account || ecoBenchmarkRunning) return;
  ecoBenchmarkRunning = true;
  const originalEcoMode = !!account.ecoMode;
  if (pokeSettingsEcoBenchmarkBtn) {
    pokeSettingsEcoBenchmarkBtn.disabled = true;
    pokeSettingsEcoBenchmarkBtn.textContent = t('pokeIdle.ecoBenchmarkRunning');
  }
  if (pokeSettingsEcoBenchmarkResultEl) {
    pokeSettingsEcoBenchmarkResultEl.textContent = t('pokeIdle.ecoBenchmarkMeasuringOff');
  }
  try {
    account.ecoMode = false;
    if (pokeSettingsEcoEl) pokeSettingsEcoEl.checked = false;
    await window.api.updateAccount(account.id, { ecoMode: false });
    await wait(ECO_BENCHMARK_WARMUP_MS);
    const before = await collectEcoBenchmarkSamples(account.id);

    if (pokeSettingsEcoBenchmarkResultEl) {
      pokeSettingsEcoBenchmarkResultEl.textContent = t('pokeIdle.ecoBenchmarkMeasuringOn');
    }
    account.ecoMode = true;
    if (pokeSettingsEcoEl) pokeSettingsEcoEl.checked = true;
    await window.api.updateAccount(account.id, { ecoMode: true });
    await wait(ECO_BENCHMARK_WARMUP_MS);
    const after = await collectEcoBenchmarkSamples(account.id);

    if (!before.samples || !after.samples) {
      throw new Error(t('pokeIdle.ecoBenchmarkNoSamples'));
    }
    renderEcoBenchmarkResult(before, after);
  } catch (err) {
    if (pokeSettingsEcoBenchmarkResultEl) {
      pokeSettingsEcoBenchmarkResultEl.textContent = err?.message || t('pokeIdle.ecoBenchmarkFailed');
    }
  } finally {
    account.ecoMode = originalEcoMode;
    if (pokeSettingsEcoEl) pokeSettingsEcoEl.checked = originalEcoMode;
    await window.api.updateAccount(account.id, { ecoMode: originalEcoMode }).catch(() => {});
    if (pokeSettingsEcoBenchmarkBtn) {
      pokeSettingsEcoBenchmarkBtn.disabled = false;
      pokeSettingsEcoBenchmarkBtn.textContent = t('pokeIdle.ecoBenchmarkRun');
    }
    ecoBenchmarkRunning = false;
  }
}

accountSellLockItemAdd.addEventListener('click', async () => {
  if (!editingAccountId) return;
  const account = getAccount(editingAccountId);
  if (!account) return;
  const itemId = Number(accountSellLockItemPicker.value);
  if (!Number.isInteger(itemId)) return;
  const ids = new Set(account.sellLockItemIds || []);
  ids.add(itemId);
  account.sellLockItemIds = [...ids];
  await window.api.setSellLockItems(editingAccountId, account.sellLockItemIds);
  renderSellLockItems(account);
});

pokeSettingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.pokeSettingsTab;
    pokeSettingsTabs.forEach((item) => item.classList.toggle('active', item === tab));
    pokeSettingsPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.pokeSettingsPanel === target));
  });
});

pokeSettingsAccountEl?.addEventListener('change', renderPokeAccountSettings);
pokeSettingsEcoEl?.addEventListener('change', () => updatePokeSettingsAccount({ ecoMode: pokeSettingsEcoEl.checked }));
pokeSettingsEcoBenchmarkBtn?.addEventListener('click', runEcoBenchmark);
pokeSettingsHideChatEl?.addEventListener('change', () => updatePokeSettingsAccount({ hideChat: pokeSettingsHideChatEl.checked }));
pokeSettingsHideGameBarEl?.addEventListener('change', () => updatePokeSettingsAccount({ hideGameBar: pokeSettingsHideGameBarEl.checked }));
pokeSettingsSellLockEl?.addEventListener('change', () => updatePokeSettingsAccount({ sellLockOn: pokeSettingsSellLockEl.checked }));
pokeSettingsCleanProfileEl?.addEventListener('change', () => updatePokeSettingsAccount({ cleanGameProfile: pokeSettingsCleanProfileEl.checked }));
stabilityEnabledEl?.addEventListener('change', () => updateStabilitySettings({ enabled: stabilityEnabledEl.checked }).then(refreshStabilityAccountStatus));
stabilityKeepaliveEl?.addEventListener('change', () => updateStabilitySettings({ backgroundKeepalive: stabilityKeepaliveEl.checked }));
stabilityAutoRecoveryEl?.addEventListener('change', () => updateStabilitySettings({ autoRecovery: stabilityAutoRecoveryEl.checked }));
stabilityLastResortReloadEl?.addEventListener('change', () => updateStabilitySettings({ lastResortAutoReload: stabilityLastResortReloadEl.checked }));
stabilityNotifyEl?.addEventListener('change', () => updateStabilitySettings({ disconnectNotifications: stabilityNotifyEl.checked }));
stabilityManualReconnectBtn?.addEventListener('click', async () => {
  const account = selectedPokeSettingsAccount();
  if (!account) return;
  stabilityManualReconnectBtn.disabled = true;
  try {
    await window.api.manualReconnectAccount(account.id);
    setTimeout(refreshStabilityAccountStatus, 1500);
  } finally {
    stabilityManualReconnectBtn.disabled = false;
  }
});
// Turns the raw checkAccountNetwork() result (network.js — the same probe
// Level 1 recovery already runs on its own) into a plain-language verdict,
// worst-problem-first: no point saying "DNS is fine" if there's no network
// interface at all. Points at "Reconectar cuenta" as the fix action — reuses
// the existing recovery levels instead of inventing a new one, since the
// test IS exactly what that button's own Level 1 check already does.
function formatNetworkTestResult(result) {
  if (!result) return t('stability.networkTestFailed');
  if (result.electronOnline === false) return `🔴 ${t('stability.networkTestNoInternet')}`;
  if (!result.dnsResolved) return `🔴 ${t('stability.networkTestDnsFailed')}`;
  if (!result.httpsReachable) {
    return `🟠 ${t('stability.networkTestHttpsFailed', { detail: result.lastErrorDescription || result.httpsStatus || '?' })}`;
  }
  return `🟢 ${t('stability.networkTestOk', { status: result.httpsStatus ?? '?', n: (result.resolvedAddresses || []).length })}`;
}

stabilityTestNetworkBtn?.addEventListener('click', async () => {
  const account = selectedPokeSettingsAccount();
  if (!account || !stabilityNetworkTestResultEl) return;
  stabilityTestNetworkBtn.disabled = true;
  stabilityNetworkTestResultEl.textContent = t('stability.networkTestRunning');
  try {
    const result = await window.api.testStabilityNetwork(account.id);
    stabilityNetworkTestResultEl.textContent = formatNetworkTestResult(result);
  } catch (err) {
    stabilityNetworkTestResultEl.textContent = t('stability.networkTestFailed');
  } finally {
    stabilityTestNetworkBtn.disabled = false;
  }
});

stabilityExportReportBtn?.addEventListener('click', async () => {
  try {
    const report = await window.api.exportDiagnosticsReport();
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    stabilityExportReportBtn.textContent = t('stability.exportReportDone');
    setTimeout(() => { stabilityExportReportBtn.textContent = t('stability.exportReport'); }, 2000);
  } catch (err) {
    console.error('[stability] failed to export diagnostics report', err);
  }
});
stabilityStartNetlogBtn?.addEventListener('click', async () => {
  const account = selectedPokeSettingsAccount();
  if (!account) return;
  const result = await window.api.startNetLog(account.id);
  if (!result.ok) console.error('[stability] startNetLog failed', result.error);
});
stabilityStopNetlogBtn?.addEventListener('click', async () => {
  const result = await window.api.stopNetLog();
  if (!result.ok) console.error('[stability] stopNetLog failed', result.error);
});
window.api.onStabilityUpdate?.(() => refreshStabilityAccountStatus());
pokeSettingsSellLockItemAddEl?.addEventListener('click', async () => {
  const account = selectedPokeSettingsAccount();
  if (!account) return;
  const itemId = Number(pokeSettingsSellLockItemPickerEl?.value);
  if (!Number.isInteger(itemId)) return;
  const ids = new Set(account.sellLockItemIds || []);
  ids.add(itemId);
  account.sellLockItemIds = [...ids];
  await window.api.setSellLockItems(account.id, account.sellLockItemIds);
  renderPokeSettingsLockItems(account);
});
pokeSettingsSellLockItemsEl?.addEventListener('click', async (event) => {
  const removeBtn = event.target.closest('button[data-remove]');
  if (!removeBtn) return;
  const account = selectedPokeSettingsAccount();
  if (!account) return;
  const next = (account.sellLockItemIds || []).filter((id) => id !== Number(removeBtn.dataset.remove));
  account.sellLockItemIds = next;
  await window.api.setSellLockItems(account.id, next);
  renderPokeSettingsLockItems(account);
});

function getAccount(id) {
  return state.accounts.find((a) => a.id === id);
}

function closeAccountModal() {
  accountModal.classList.add('hidden');
  editingAccountId = null;
  popModal();
}

function renderAccountSwatches() {
  accountColorsEl.innerHTML = '';
  SPACE_COLORS.forEach((color) => {
    const sw = document.createElement('div');
    sw.className = 'swatch-color' + (color === accountModalColor ? ' selected' : '');
    sw.style.background = color;
    sw.onclick = () => {
      accountModalColor = color;
      renderAccountSwatches();
    };
    accountColorsEl.appendChild(sw);
  });
}

btnSaveAccount.addEventListener('click', async () => {
  if (!editingAccountId) return;
  const proxyServer = accountInputProxy.value.trim();
  await window.api.updateAccount(editingAccountId, {
    name: accountInputName.value.trim(),
    color: accountModalColor,
    url: accountInputUrl.value.trim(),
    proxy: proxyServer
      ? { server: proxyServer, username: accountInputProxyUser.value.trim(), password: accountInputProxyPass.value }
      : null,
    ecoMode: accountInputEco.checked,
    hideChat: accountInputHideChat.checked,
    hideGameBar: accountInputHideGameBar.checked,
    sellLockOn: accountInputSellLock.checked
  });
  closeAccountModal();
});

btnCancelAccount.addEventListener('click', closeAccountModal);

btnNewTab.addEventListener('click', async () => {
  await window.api.quickAddAccount();
  addressInput.focus();
});

btnEmptyAdd.addEventListener('click', async () => {
  await window.api.quickAddAccount();
  addressInput.focus();
});

// ---- Layout dropdown ----

btnLayoutMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllMenus({ keepZoom: false, keepLayout: true });
  const opening = layoutMenu.classList.contains('hidden');
  layoutMenu.classList.toggle('hidden', !opening);
  btnLayoutMenu.classList.toggle('open', opening);
  if (opening) window.api.hideViews();
  else window.api.showViews();
});

layoutOptions.forEach((opt) => {
  opt.addEventListener('click', () => {
    window.api.setLayout(opt.dataset.mode);
    layoutMenu.classList.add('hidden');
    btnLayoutMenu.classList.remove('open');
    window.api.showViews();
  });
});

// ---- Zoom dropdown ----

function renderZoomMenu() {
  zoomMenu.innerHTML = '';
  const active = activeAccount();
  const currentFactor = active?.zoom || 1;
  ZOOM_LEVELS.forEach((level) => {
    const opt = document.createElement('div');
    opt.className = 'zoom-option' + (Math.abs(currentFactor - level) < 0.01 ? ' active' : '');
    opt.textContent = `${Math.round(level * 100)}%`;
    opt.onclick = () => {
      const acc = activeAccount();
      if (acc) window.api.setZoom(acc.id, level);
      zoomMenu.classList.add('hidden');
      btnZoomMenu.classList.remove('open');
      window.api.showViews();
    };
    zoomMenu.appendChild(opt);
  });
  const sep = document.createElement('div');
  sep.className = 'zoom-menu-sep';
  zoomMenu.appendChild(sep);

  const applyAll = document.createElement('div');
  applyAll.className = 'zoom-apply-all';
  applyAll.textContent = t('js.applyToAll');
  applyAll.onclick = () => {
    window.api.setZoomAll(currentFactor);
    zoomMenu.classList.add('hidden');
    btnZoomMenu.classList.remove('open');
    window.api.showViews();
  };
  zoomMenu.appendChild(applyAll);
}

btnZoomMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllMenus({ keepZoom: true, keepLayout: false });
  const opening = zoomMenu.classList.contains('hidden');
  if (opening) renderZoomMenu();
  zoomMenu.classList.toggle('hidden', !opening);
  btnZoomMenu.classList.toggle('open', opening);
  if (opening) window.api.hideViews();
  else window.api.showViews();
});

function closeAllMenus({ keepZoom, keepLayout } = {}) {
  if (!keepLayout && !layoutMenu.classList.contains('hidden')) {
    layoutMenu.classList.add('hidden');
    btnLayoutMenu.classList.remove('open');
  }
  if (!keepZoom && !zoomMenu.classList.contains('hidden')) {
    zoomMenu.classList.add('hidden');
    btnZoomMenu.classList.remove('open');
  }
}

document.addEventListener('click', () => {
  const wasOpen = !layoutMenu.classList.contains('hidden') || !zoomMenu.classList.contains('hidden');
  closeAllMenus({});
  if (wasOpen) window.api.showViews();
  if (shieldMenu && !shieldMenu.classList.contains('hidden')) {
    shieldMenu.classList.add('hidden');
    tbShield.classList.remove('open');
    window.api.showViews();
  }
});

// ---- Shield popup (Cyber-Shield design) ----
// One unified popup replaces what used to be three separate pieces: the
// off/standard/strict level-picker dropdown, the compact "what got
// blocked" dropdown, and the full-page adblock dashboard modal. Everything
// lives here now — status + master on/off, the 3-mode intensity slider,
// per-page stats, per-site pause/force-block, quick whitelist, and custom
// filter rules — sized as a dropdown rather than a full page.
const shieldMenu = document.getElementById('shield-menu');
const ADBLOCK_MODES = ['standard', 'normal', 'super'];
const ADVANCED_FILTER_LIST_KEYS = ['ads', 'tracking', 'cookies', 'annoyances'];
const ADVANCED_FILTER_LIST_LABELS = {
  ads: 'js.adblockListAds',
  tracking: 'js.adblockListTracking',
  cookies: 'js.adblockListCookies',
  annoyances: 'js.adblockListAnnoyances'
};

function shieldModeLabel(mode) {
  return t('js.adblockMode' + mode.charAt(0).toUpperCase() + mode.slice(1));
}

// Shared by the whitelist and custom-rules sections below — both are a text
// input + "+" button, submit on click or Enter, that clears the input and
// re-renders the whole popup after `onAdd` resolves. `hidden` starts the
// row collapsed (the custom-rules row toggles open via its own "+ Nueva
// regla" button instead of always showing).
function createAddInputRow({ placeholder, hidden, onAdd }) {
  const row = document.createElement('div');
  row.className = 'shield-input-row' + (hidden ? ' hidden' : '');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  const submit = async () => {
    const val = input.value.trim();
    if (!val) return;
    await onAdd(val);
    input.value = '';
    renderShieldPopup();
  };
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') submit();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  row.append(input, addBtn);
  return { row, input };
}

async function renderShieldPopup() {
  const active = activeAccount();
  shieldMenu.innerHTML = '';
  const popup = await window.api.getAdBlockPopupData(active ? active.id : null);

  // Hero: shield icon + Protected/Unprotected + master toggle
  const hero = document.createElement('div');
  hero.className = 'shield-hero';
  const heroIcon = document.createElement('div');
  heroIcon.className = 'shield-hero-icon' + (popup.masterEnabled ? ' active' : '');
  heroIcon.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>';
  const heroText = document.createElement('div');
  heroText.className = 'shield-hero-status';
  heroText.textContent = popup.masterEnabled ? t('js.adblockProtected') : t('js.adblockUnprotected');
  hero.append(heroIcon, heroText);
  shieldMenu.appendChild(hero);

  // Engine health banner — only shown while the filter engine isn't ready
  // yet (a few seconds on first-ever launch) or genuinely failed to load
  // (e.g. no network for the very first filter-list fetch). Silent in the
  // normal case so it doesn't clutter the popup every time it's opened.
  const engineStatus = popup.engineStatus;
  if (engineStatus && engineStatus.status !== 'ready') {
    const banner = document.createElement('div');
    banner.className = 'shield-engine-banner' + (engineStatus.status === 'failed' ? ' error' : '');
    banner.textContent = engineStatus.status === 'failed'
      ? t('js.adblockEngineFailed', { error: engineStatus.lastError || '' })
      : t('js.adblockEngineLoading');
    shieldMenu.appendChild(banner);
  }

  const toggleRow = document.createElement('div');
  toggleRow.className = 'shield-toggle-row';
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = t('js.adblockSystemStatus');
  const toggleSwitch = document.createElement('button');
  toggleSwitch.type = 'button';
  toggleSwitch.className = 'shield-switch' + (popup.masterEnabled ? ' on' : '');
  toggleSwitch.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.setAdBlockMasterEnabled(!popup.masterEnabled);
    renderShieldPopup();
  });
  toggleRow.append(toggleLabel, toggleSwitch);
  shieldMenu.appendChild(toggleRow);

  // Mode slider — Estándar / Normal / Súper Bloqueo
  const modeSlider = document.createElement('div');
  modeSlider.className = 'shield-mode-slider';
  ADBLOCK_MODES.forEach((mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shield-mode-btn' + (popup.mode === mode && popup.modeMatchesPreset ? ' active' : '');
    btn.textContent = shieldModeLabel(mode);
    btn.disabled = !popup.masterEnabled;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.setAdBlockMode(mode);
      renderShieldPopup();
    });
    modeSlider.appendChild(btn);
  });
  shieldMenu.appendChild(modeSlider);

  // Stats row
  const statsRow = document.createElement('div');
  statsRow.className = 'shield-stats-row';
  [
    [popup.blockedOnPage, 'js.adblockBlockedOnPage'],
    [popup.totalSinceInstall, 'js.adblockTotalSinceInstall']
  ].forEach(([value, labelKey]) => {
    const card = document.createElement('div');
    card.className = 'shield-stat-card';
    const num = document.createElement('div');
    num.className = 'shield-stat-number';
    num.textContent = String(value);
    const label = document.createElement('div');
    label.className = 'shield-stat-label';
    label.textContent = t(labelKey);
    card.append(num, label);
    statsRow.appendChild(card);
  });
  shieldMenu.appendChild(statsRow);

  // Per-page breakdown by category (Brave-Shields-style — its popup splits
  // ads/trackers/scripts instead of one bare count). getAdBlockPopupData's
  // blockedByCategoryOnPage resets on every real navigation, same scope as
  // blockedOnPage above; only shown when there's at least one blocked
  // request this page, sorted highest-first so the biggest offender leads.
  const categoryCounts = popup.blockedByCategoryOnPage || {};
  const categoryEntries = Object.entries({
    ads: 'js.adblockCategoryAds',
    tracking: 'js.adblockCategoryTracking',
    social: 'js.adblockCategorySocial',
    analytics: 'js.adblockCategoryAnalytics',
    other: 'js.adblockCategoryOther'
  })
    .map(([key, labelKey]) => ({ key, labelKey, count: categoryCounts[key] || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
  if (categoryEntries.length > 0) {
    const categorySection = document.createElement('div');
    categorySection.className = 'shield-section';
    const categoryTitle = document.createElement('div');
    categoryTitle.className = 'shield-section-title';
    categoryTitle.textContent = t('js.adblockByCategoryTitle');
    categorySection.appendChild(categoryTitle);
    const categoryList = document.createElement('div');
    categoryList.className = 'shield-list';
    categoryEntries.forEach(({ labelKey, count }) => {
      const row = document.createElement('div');
      row.className = 'shield-list-row';
      const name = document.createElement('span');
      name.textContent = t(labelKey);
      const num = document.createElement('span');
      num.className = 'shield-list-count';
      num.textContent = String(count);
      row.append(name, num);
      categoryList.appendChild(row);
    });
    categorySection.appendChild(categoryList);
    shieldMenu.appendChild(categorySection);
  }

  // Top blocked hosts — already computed server-side for every popup open
  // (getAdBlockPopupData's topHosts/byCategory), but had no consumer here
  // until now. Shown only when there's at least one, right below the raw
  // counters above.
  if (popup.topHosts && popup.topHosts.length > 0) {
    const topHostsSection = document.createElement('div');
    topHostsSection.className = 'shield-section';
    const topHostsTitle = document.createElement('div');
    topHostsTitle.className = 'shield-section-title';
    topHostsTitle.textContent = t('js.adblockTopHosts');
    topHostsSection.appendChild(topHostsTitle);
    const topHostsList = document.createElement('div');
    topHostsList.className = 'shield-list';
    popup.topHosts.slice(0, 5).forEach(({ hostname, count }) => {
      const row = document.createElement('div');
      row.className = 'shield-list-row';
      const name = document.createElement('span');
      name.textContent = hostname;
      const num = document.createElement('span');
      num.className = 'shield-list-count';
      num.textContent = String(count);
      row.append(name, num);
      topHostsList.appendChild(row);
    });
    topHostsSection.appendChild(topHostsList);
    shieldMenu.appendChild(topHostsSection);
  }

  // Current page — pause (whitelist) / force-block, only when there's an
  // actual hostname to act on.
  if (popup.hostname) {
    const pageSection = document.createElement('div');
    pageSection.className = 'shield-section';
    const title = document.createElement('div');
    title.className = 'shield-section-title';
    title.textContent = t('js.adblockCurrentPage');
    const host = document.createElement('div');
    host.className = 'shield-current-host';
    host.textContent = popup.hostname;
    pageSection.append(title, host);

    const btnRow = document.createElement('div');
    btnRow.className = 'shield-page-actions';

    const blockBtn = document.createElement('button');
    blockBtn.type = 'button';
    blockBtn.className = 'shield-btn-primary' + (popup.blocked ? ' active' : '');
    blockBtn.textContent = popup.blocked ? t('js.adblockUnblockSite') : t('js.adblockForceBlockPage');
    blockBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.toggleAdBlockSiteBlock(popup.hostname);
      renderShieldPopup();
    });

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'shield-btn-secondary';
    pauseBtn.disabled = popup.staticallyAllowed;
    pauseBtn.title = popup.staticallyAllowed ? t('js.adblockStaticallyAllowed', { host: popup.hostname }) : '';
    pauseBtn.textContent = popup.paused ? t('js.adblockResume') : t('js.adblockPauseHere');
    pauseBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.toggleAdBlockSitePause(popup.hostname);
      renderShieldPopup();
    });

    btnRow.append(blockBtn, pauseBtn);
    pageSection.appendChild(btnRow);
    shieldMenu.appendChild(pageSection);
  }

  // Quick whitelist — free-text add, not just the current site
  const wlSection = document.createElement('div');
  wlSection.className = 'shield-section';
  const wlTitle = document.createElement('div');
  wlTitle.className = 'shield-section-title';
  wlTitle.textContent = t('js.adblockQuickWhitelist');
  wlSection.appendChild(wlTitle);

  const { row: wlInputRow } = createAddInputRow({
    placeholder: 'example.com',
    onAdd: (val) => window.api.toggleAdBlockSitePause(val.toLowerCase().replace(/^https?:\/\//, '').split('/')[0])
  });
  wlSection.appendChild(wlInputRow);

  const wlList = document.createElement('div');
  wlList.className = 'shield-list';
  if (!popup.pausedSites || popup.pausedSites.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'settings-hint';
    hint.textContent = t('js.adblockNoPausedSites');
    wlList.appendChild(hint);
  } else {
    popup.pausedSites.forEach((hostname) => {
      const row = document.createElement('div');
      row.className = 'shield-list-row';
      const span = document.createElement('span');
      span.textContent = hostname;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'shield-list-remove';
      rm.textContent = '×';
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.api.toggleAdBlockSitePause(hostname);
        renderShieldPopup();
      });
      row.append(span, rm);
      wlList.appendChild(row);
    });
  }
  wlSection.appendChild(wlList);
  shieldMenu.appendChild(wlSection);

  // Custom filters — each non-empty rule as its own toggleable/deletable
  // row. A rule "disabled" by the toggle is just prefixed with '! ' (real
  // Adblock Plus/uBlock comment syntax), same array the engine already
  // reads — no separate on/off bookkeeping needed.
  const rulesSection = document.createElement('div');
  rulesSection.className = 'shield-section';
  const rulesHeader = document.createElement('div');
  rulesHeader.className = 'shield-section-header';
  const rulesTitle = document.createElement('div');
  rulesTitle.className = 'shield-section-title';
  rulesTitle.textContent = t('js.adblockCustomFilters');
  const newRuleBtn = document.createElement('button');
  newRuleBtn.type = 'button';
  newRuleBtn.className = 'shield-new-rule-btn';
  newRuleBtn.textContent = '+ ' + t('js.adblockNewRule');
  rulesHeader.append(rulesTitle, newRuleBtn);
  rulesSection.appendChild(rulesHeader);

  const rules = (popup.customRules || []).filter((r) => r.trim());
  async function saveRules(nextRules) {
    await window.api.setAdBlockCustomRules(nextRules.join('\n'));
    renderShieldPopup();
  }

  const { row: rulesInputRow, input: rulesInput } = createAddInputRow({
    placeholder: 'dominio.com##.selector',
    hidden: true,
    onAdd: (val) => saveRules([...rules, val])
  });
  newRuleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    rulesInputRow.classList.toggle('hidden');
    if (!rulesInputRow.classList.contains('hidden')) rulesInput.focus();
  });
  rulesSection.appendChild(rulesInputRow);

  const rulesList = document.createElement('div');
  rulesList.className = 'shield-rules-list';
  if (rules.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'settings-hint';
    hint.textContent = t('js.adblockNoCustomRules');
    rulesList.appendChild(hint);
  } else {
    rules.forEach((rule, idx) => {
      const isDisabled = rule.trim().startsWith('!');
      const row = document.createElement('div');
      row.className = 'shield-rule-card';
      const code = document.createElement('code');
      code.className = 'shield-rule-text';
      code.textContent = isDisabled ? rule.replace(/^!\s*/, '') : rule;
      const rowActions = document.createElement('div');
      rowActions.className = 'shield-rule-actions';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !isDisabled;
      toggle.addEventListener('click', (e) => e.stopPropagation());
      toggle.addEventListener('change', async () => {
        const next = [...rules];
        next[idx] = toggle.checked ? rule.replace(/^!\s*/, '') : '! ' + rule.replace(/^!\s*/, '');
        await saveRules(next);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'shield-rule-delete';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await saveRules(rules.filter((_, i) => i !== idx));
      });
      rowActions.append(toggle, del);
      row.append(code, rowActions);
      rulesList.appendChild(row);
    });
  }
  rulesSection.appendChild(rulesList);
  shieldMenu.appendChild(rulesSection);

  // Advanced — individual filter-list categories, for fine-tuning beyond
  // what the 3-mode slider offers. Collapsed by default so it doesn't
  // compete with the simpler controls above for a casual user.
  const advSection = document.createElement('div');
  advSection.className = 'shield-section';
  const advToggle = document.createElement('button');
  advToggle.type = 'button';
  advToggle.className = 'shield-advanced-toggle';
  advToggle.textContent = '▸ ' + t('js.adblockAdvanced');
  const advBody = document.createElement('div');
  advBody.className = 'shield-advanced-body hidden';
  ADVANCED_FILTER_LIST_KEYS.forEach((key) => {
    const row = document.createElement('label');
    row.className = 'shield-advanced-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!(popup.filterLists && popup.filterLists[key]);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      await window.api.setAdBlockFilterLists({ [key]: checkbox.checked });
      checkbox.disabled = false;
    });
    const label = document.createElement('span');
    label.textContent = t(ADVANCED_FILTER_LIST_LABELS[key]);
    row.append(checkbox, label);
    advBody.appendChild(row);
  });
  advToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    advBody.classList.toggle('hidden');
    advToggle.textContent = (advBody.classList.contains('hidden') ? '▸ ' : '▾ ') + t('js.adblockAdvanced');
  });
  advSection.append(advToggle, advBody);
  shieldMenu.appendChild(advSection);

  // Element picker quick action
  if (active) {
    const pickerBtn = document.createElement('button');
    pickerBtn.type = 'button';
    pickerBtn.className = 'shield-picker-btn';
    pickerBtn.textContent = '🎯 ' + t('ctx.blockElement');
    pickerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      shieldMenu.classList.add('hidden');
      tbShield.classList.remove('open');
      window.api.showViews();
      await window.api.pickAdBlockElement(active.id);
    });
    shieldMenu.appendChild(pickerBtn);
  }
}

function openShieldPopup() {
  closeAllMenus({});
  shieldMenu.classList.remove('hidden');
  tbShield.classList.add('open');
  window.api.hideViews();
  renderShieldPopup();
}

function closeShieldPopup() {
  shieldMenu.classList.add('hidden');
  tbShield.classList.remove('open');
  window.api.showViews();
}

// tb-shield-count is a child <span> inside #tb-shield — clicking it bubbles
// into this same handler, so one listener covers both the icon and the
// count badge.
tbShield.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!shieldMenu.classList.contains('hidden')) {
    closeShieldPopup();
  } else {
    openShieldPopup();
  }
});

shieldMenu.addEventListener('click', (e) => e.stopPropagation());

// ---- Toolbar ----

tbBack.addEventListener('click', () => {
  const active = activeAccount();
  if (active) window.api.goBack(active.id);
});

tbForward.addEventListener('click', () => {
  const active = activeAccount();
  if (active) window.api.goForward(active.id);
});

tbHome.addEventListener('click', () => {
  const active = activeAccount();
  if (active) window.api.navigateAccount(active.id, 'https://www.google.com/');
});

tbCopyUrl.addEventListener('click', () => {
  const active = activeAccount();
  if (active?.url) navigator.clipboard.writeText(active.url);
});

tbReload.addEventListener('click', () => {
  const active = activeAccount();
  if (active) window.api.reloadAccount(active.id);
});

tbReload2.addEventListener('click', () => {
  const active = activeAccount();
  if (active) window.api.reloadAccount(active.id);
});

tbMute.addEventListener('click', () => {
  const active = activeAccount();
  if (active) window.api.muteAccount(active.id, !active.muted);
});

tbMuteAll.addEventListener('click', () => {
  window.api.muteAllAccounts(!state.settings.allMuted);
});

tbFullscreen.addEventListener('click', () => window.api.toggleFullscreen());

tbScreenshot.addEventListener('click', async () => {
  const active = activeAccount();
  if (!active) return;
  const result = await window.api.openScreenshotEditor(active.id);
  if (result && !result.ok) alert(t('js.screenshotEditorError', { message: result.error || '?' }));
});

// Picture-in-Picture from the toolbar (no click point to go on, unlike the
// right-click menu item) — see electron/pip-player.js for why this builds
// on the native requestPictureInPicture() + Media Session API (real
// skip-back/skip-forward buttons on the OS's own PiP window) instead of a
// fully custom window: the custom-window approach self-closed within
// milliseconds every time when opened from inside a <webview>, confirmed
// live via direct process logs.
tbMiniplayer?.addEventListener('click', async () => {
  const active = activeAccount();
  if (!active) return;
  const result = await window.api.openMiniPlayer(active.id);
  if (!result || result.ok) return;
  if (result.error === 'no-video') alert(t('js.miniplayerNoVideo'));
  else alert(t('js.miniplayerError', { message: result.error || '?' }));
});

// On-device translation (Bergamot, see electron/translate.js) — tracked
// per-account since each webview keeps its own DOM. Not persisted across
// reloads/navigations on purpose: a stale "translated" flag after the page
// changes underneath it just makes the next restore a harmless no-op (see
// translate.js's restorePageTextScript), so we don't need to hook every
// navigation event to keep this in sync.
const translatedAccounts = new Set();

function updateTranslateButton() {
  const active = activeAccount();
  const isTranslated = !!active && translatedAccounts.has(active.id);
  // Deliberately its own class, not the shared .active/--accent one other
  // toolbar toggles (mute, shield) use — the neon green here means
  // specifically "this page is translated", nothing else.
  tbTranslate.classList.toggle('translated', isTranslated);
  tbTranslate.title = t(isTranslated ? 'topbar.translateActive' : 'topbar.translate');
}

// Fires when main.js auto-reapplies translation after a real navigation
// (e.g. a login redirect) for an account that had it on before — see
// translationEnabled in main.js. Keeps the neon-green icon in sync with
// state the click handler below never directly caused.
window.api.onTranslateAutoApplied(({ id }) => {
  translatedAccounts.add(id);
  updateTranslateButton();
});

window.api.onTranslateProgress(({ id, done, total }) => {
  if (id !== translatingAccountId || !total) return;
  translateModalTitle.textContent = t('translateModal.title');
  translateDownloadHint.classList.add('hidden');
  const pct = Math.round((done / total) * 100);
  translateProgressFill.style.width = pct + '%';
  translateProgressLabel.textContent = pct + '%';
});

// Only fires while a language pair's model is downloading for the very
// first time (see translate.js's onDownloadProgress) — real MB/MB, not a
// guess, so a user on slow internet sees why it's taking a while instead of
// a modal that just sits at 0% (confirmed this was a real complaint).
// Every later translation for that same pair skips this entirely since the
// model is cached to disk after the first download.
//
// Not gated to translatingAccountId anymore — right-click "Traducir este
// texto" and chat auto-translate both need a model download exactly as
// often as the main toolbar button does, but neither of them opens this
// modal themselves. If a download starts for an account we're not already
// tracking, that means one of those OTHER flows triggered it, so this
// opens the same modal on its own rather than the download silently
// happening with zero visible feedback. autoOpenedTranslateModal marks
// that WE opened it (vs. the user's own toolbar click) so
// onTranslateDownloadFinished below knows it's safe to close automatically.
let autoOpenedTranslateModal = false;
window.api.onTranslateDownloadProgress(({ id, loaded, total }) => {
  if (id !== translatingAccountId) {
    if (translatingAccountId) return; // a real user-initiated translate is already in flight for a different account — don't steal its modal
    translatingAccountId = id;
    autoOpenedTranslateModal = true;
    openTranslateModal();
  }
  translateModalTitle.textContent = t('translateModal.downloading');
  translateDownloadHint.classList.remove('hidden');
  if (total) {
    const pct = Math.round((loaded / total) * 100);
    translateProgressFill.style.width = pct + '%';
    translateProgressLabel.textContent = pct + '%';
    translateDownloadHint.textContent = `${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
  } else {
    translateDownloadHint.textContent = `${(loaded / 1024 / 1024).toFixed(1)} MB`;
  }
});

// Fires once the download(s) that triggered the auto-open above finish —
// main.js only sends this after a translateBatch call that actually
// reported a download (see downloadHappened in translateSelectionAt/
// translateChatMessages), never for a normal already-cached translation,
// so this can't accidentally close a modal the user's own toolbar click
// opened for an unrelated reason.
window.api.onTranslateDownloadFinished(({ id }) => {
  if (id === translatingAccountId && autoOpenedTranslateModal) {
    autoOpenedTranslateModal = false;
    setTimeout(() => { if (translatingAccountId === id) closeTranslateModal(); }, 400);
  }
});

let translatingAccountId = null;

function openTranslateModal() {
  translateModalTitle.textContent = t('translateModal.title');
  translateProgressFill.style.width = '0%';
  translateProgressLabel.textContent = '0%';
  translateDownloadHint.classList.add('hidden');
  translateDownloadHint.textContent = '';
  translateErrorEl.classList.add('hidden');
  translateErrorEl.textContent = '';
  btnCloseTranslate.classList.add('hidden');
  translateModal.classList.remove('hidden');
}

function closeTranslateModal() {
  translateModal.classList.add('hidden');
  translatingAccountId = null;
  autoOpenedTranslateModal = false;
}

btnCloseTranslate.addEventListener('click', closeTranslateModal);

tbTranslate.addEventListener('click', async () => {
  const active = activeAccount();
  if (!active || tbTranslate.disabled) return;
  tbTranslate.disabled = true;
  try {
    if (translatedAccounts.has(active.id)) {
      await window.api.restorePage(active.id);
      translatedAccounts.delete(active.id);
    } else {
      translatingAccountId = active.id;
      openTranslateModal();
      // Detects the page's own language (see extractPageTextScript's use of
      // <html lang>) and always translates INTO whichever language Nexa's
      // own interface is currently set to — that's the language the user
      // reads, so it's the only sensible default target.
      const targetLang = (state.settings.language || 'es').slice(0, 2);
      const result = await window.api.translatePage(active.id, targetLang);
      if (result?.ok) {
        translatedAccounts.add(active.id);
        translateProgressFill.style.width = '100%';
        translateProgressLabel.textContent = '100%';
        setTimeout(() => { if (translatingAccountId === active.id) closeTranslateModal(); }, 400);
      } else {
        translateErrorEl.textContent = t('translateModal.error') + (result?.error ? `: ${result.error}` : '');
        translateErrorEl.classList.remove('hidden');
        btnCloseTranslate.classList.remove('hidden');
        console.error('[translate] failed', result?.error);
      }
    }
  } finally {
    tbTranslate.disabled = false;
    updateTranslateButton();
  }
});

// ---- Bookmarks modal ----

function renderBookmarksList() {
  const list = state.bookmarks || [];
  bookmarksListEl.innerHTML = '';
  if (list.length === 0) {
    bookmarksListEl.innerHTML = `<div class="settings-hint">${t('bookmarks.empty')}</div>`;
    return;
  }
  list.forEach((b) => {
    const item = document.createElement('div');
    item.className = 'ext-item bookmark-item';

    const info = document.createElement('div');
    info.className = 'ext-info';
    info.innerHTML = `<div class="ext-name">${escapeHtmlClient(b.title)}</div><div class="ext-id">${escapeHtmlClient(b.url)}</div>`;
    info.onclick = () => {
      const active = activeAccount();
      if (active) window.api.navigateAccount(active.id, b.url);
      closeBookmarksModal();
    };

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-remove';
    removeBtn.textContent = t('settings.remove');
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      window.api.removeBookmark(b.id);
    };

    item.append(info, removeBtn);
    bookmarksListEl.appendChild(item);
  });
}

function openBookmarksModal() {
  renderBookmarksList();
  bookmarksModal.classList.remove('hidden');
  pushModal();
}

function closeBookmarksModal() {
  bookmarksModal.classList.add('hidden');
  popModal();
}

tbBookmarks.addEventListener('click', openBookmarksModal);
btnCloseBookmarks.addEventListener('click', closeBookmarksModal);

bmAddCurrent.addEventListener('click', () => {
  const active = activeAccount();
  if (!active || !active.url || active.url === 'about:blank') return;
  window.api.addBookmark({ title: displayName(active, currentSpaceAccounts().indexOf(active)), url: active.url });
});

bmImport.addEventListener('click', async () => {
  const result = await window.api.importBookmarks();
  if (result.ok) {
    renderBookmarksList();
  } else if (result.error) {
    alert(t('bookmarks.importError', { message: result.error }));
  }
});

bmExport.addEventListener('click', async () => {
  try {
    const result = await window.api.exportBookmarks();
    if (!result.ok && result.error) alert(t('bookmarks.exportError', { message: result.error }));
  } catch (err) {
    alert(t('bookmarks.exportError', { message: err.message }));
  }
});

// ---- Downloads modal ----

// Compact K/M/B suffix for the game-stats row — xp/h routinely runs into
// the millions on high-level accounts, and the raw digit count doesn't fit
// a sidebar row.
// Currency symbol for the sidebar's per-account gold/hour wallet display.
function currencySymbol(currency) {
  return currency === 'DIAMONDS' ? '♦' : '$';
}

function formatCompactNumber(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function formatBytes(n) {
  if (!n && n !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function downloadStateLabel(downloadState) {
  return t('downloads.state' + downloadState.charAt(0).toUpperCase() + downloadState.slice(1));
}

function renderDownloadsList() {
  const list = state.downloads || [];
  downloadsListEl.innerHTML = '';
  if (list.length === 0) {
    downloadsListEl.innerHTML = `<div class="settings-hint">${t('downloads.empty')}</div>`;
    return;
  }
  list.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'ext-item';

    const info = document.createElement('div');
    info.className = 'ext-info';
    const sizeText =
      d.state === 'progressing'
        ? `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes) || '?'}`
        : formatBytes(d.totalBytes || d.receivedBytes);
    const stateLabel = d.state === 'progressing' && d.paused ? t('downloads.statePaused') : downloadStateLabel(d.state);
    info.innerHTML = `
      <div class="ext-name">${escapeHtmlClient(d.filename)}</div>
      <div class="ext-desc">${stateLabel} · ${sizeText}</div>
      <div class="ext-id">${escapeHtmlClient(d.path || '')}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'ext-actions';

    if (d.state === 'completed') {
      const openBtn = document.createElement('button');
      openBtn.className = 'ext-remove';
      openBtn.textContent = t('downloads.open');
      openBtn.onclick = () => window.api.openFileDownload(d.id);

      const folderBtn = document.createElement('button');
      folderBtn.className = 'ext-remove';
      folderBtn.textContent = t('downloads.showInFolder');
      folderBtn.onclick = () => window.api.showDownloadInFolder(d.id);

      actions.append(openBtn, folderBtn);
    }

    if (d.state === 'progressing') {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'ext-remove';
      toggleBtn.textContent = d.paused ? t('downloads.resume') : t('downloads.pause');
      toggleBtn.onclick = () => (d.paused ? window.api.resumeDownload(d.id) : window.api.pauseDownload(d.id));

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ext-remove';
      cancelBtn.textContent = t('downloads.cancel');
      cancelBtn.onclick = () => window.api.cancelDownload(d.id);

      actions.append(toggleBtn, cancelBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-remove';
    removeBtn.textContent = t('downloads.remove');
    removeBtn.onclick = () => window.api.removeDownload(d.id);
    actions.append(removeBtn);

    item.append(info, actions);
    downloadsListEl.appendChild(item);
  });
}

function openDownloadsModal() {
  renderDownloadsList();
  downloadsModal.classList.remove('hidden');
  pushModal();
}

function closeDownloadsModal() {
  downloadsModal.classList.add('hidden');
  popModal();
}

// ---- DNS speed test ----
// Only ever measures. Applying a result is a real OS network-config change,
// which this app deliberately never does on its own (see dns-test.js) — the
// "Aplicar" button copies the exact PowerShell command to the clipboard
// instead, so the user runs it (as Administrator) themselves.
function dnsColor(ms) {
  if (ms == null) return 'var(--muted)';
  if (ms <= 30) return '#3ddc57';
  if (ms <= 80) return '#e0c341';
  return '#e05555';
}

function renderDnsResults(results) {
  dnsResultsEl.replaceChildren();
  const bestMs = results.reduce((min, r) => (r.bestMs != null && (min == null || r.bestMs < min) ? r.bestMs : min), null);
  results.forEach((provider, i) => {
    const row = document.createElement('div');
    row.className = 'dns-row' + (provider.bestMs != null && provider.bestMs === bestMs ? ' dns-best' : '');

    const rank = document.createElement('div');
    rank.className = 'dns-rank';
    rank.textContent = String(i + 1);

    const info = document.createElement('div');
    info.className = 'dns-info';
    const name = document.createElement('div');
    name.className = 'dns-name';
    name.textContent = provider.name;
    const servers = document.createElement('div');
    servers.className = 'dns-servers';
    servers.textContent = provider.servers.map((s) => `${s.ip} (${s.ms == null ? t('dnsModal.noResponse') : s.ms + 'ms'})`).join('  ·  ');
    info.append(name, servers);

    const ms = document.createElement('div');
    ms.className = 'dns-ms';
    ms.style.color = dnsColor(provider.bestMs);
    ms.textContent = provider.bestMs == null ? '—' : provider.bestMs + ' ms';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'dns-apply';
    applyBtn.textContent = t('dnsModal.copyCommand');
    applyBtn.disabled = provider.bestMs == null;
    applyBtn.onclick = async () => {
      const ips = provider.servers.map((s) => s.ip);
      const command = await window.api.getDnsApplyCommand(ips);
      await window.api.copyDnsCommand(command);
      applyBtn.textContent = t('dnsModal.copied');
      setTimeout(() => { applyBtn.textContent = t('dnsModal.copyCommand'); }, 1500);
    };

    row.append(rank, info, ms, applyBtn);
    dnsResultsEl.appendChild(row);
  });
}

async function runDnsTest() {
  dnsRunBtn.disabled = true;
  dnsResultsEl.replaceChildren();
  const testing = document.createElement('div');
  testing.className = 'dns-testing';
  testing.textContent = t('dnsModal.testing');
  dnsResultsEl.appendChild(testing);
  try {
    const results = await window.api.runDnsSpeedTest();
    renderDnsResults(results);
  } finally {
    dnsRunBtn.disabled = false;
  }
}

function openDnsModal() {
  dnsModal.classList.remove('hidden');
  pushModal();
}

function closeDnsModal() {
  dnsModal.classList.add('hidden');
  popModal();
}

// ---- Update changelog ----
// Shown once electron-updater finishes downloading an update in the
// background (main.js's autoUpdater.on('update-downloaded', ...)) — before
// this, the only signal was the native OS notification from
// checkForUpdatesAndNotify(), with no way to see what actually changed.
function openUpdateModal({ version, releaseNotes }) {
  updateVersionEl.textContent = t('updateModal.version', { version });
  updateNotesEl.textContent = releaseNotes || t('updateModal.noNotes');
  updateModal.classList.remove('hidden');
  pushModal();
}

function closeUpdateModal() {
  updateModal.classList.add('hidden');
  popModal();
}

// ---- Command palette (Ctrl+K) ----

let cmdkResults = [];
let cmdkSelectedIndex = 0;

function getCommandActions() {
  const actions = [];

  currentSpaceAccounts().forEach((account, i) => {
    actions.push({
      icon: account.closed ? '⚪' : '🟢',
      label: displayName(account, i),
      hint: t('cmdk.changeAccount'),
      keywords: `cuenta ${displayName(account, i)}`,
      run: () => window.api.activateAccount(account.id)
    });
  });

  state.spaces.forEach((space) => {
    actions.push({
      icon: '🗂️',
      label: space.name,
      hint: t('cmdk.changeSpace'),
      keywords: `espacio ${space.name}`,
      run: () => window.api.activateSpace(space.id)
    });
  });

  ['general', 'navegacion', 'descargas', 'extensiones', 'contrasenas', 'red', 'actualizaciones', 'acerca'].forEach((tab) => {
    actions.push({
      icon: '⚙️',
      label: `${t('settings.title')}: ${t('settings.tab.' + tab)}`,
      keywords: `configuracion settings ${t('settings.tab.' + tab)}`,
      run: () => { openSettingsModal(); activateSettingsTab(tab); }
    });
  });

  const protectionLevel = state.settings.protectionLevel || 'standard';
  actions.push(
    {
      icon: '➕', label: t('cmdk.newAccount'), keywords: 'nueva cuenta agregar add account',
      run: () => window.api.quickAddAccount()
    },
    ...['off', 'standard', 'strict']
      .filter((level) => level !== protectionLevel)
      .map((level) => ({
        icon: level === 'off' ? '🚫' : '🛡️',
        label: `${t('cmdk.protection')}: ${t('protection.' + level)}`,
        keywords: 'adblock proteccion rastreadores bloqueador tracking',
        run: () => window.api.updateSettings({ protectionLevel: level })
      })),
    {
      icon: '📷', label: t('cmdk.screenshot'), keywords: 'captura pantalla screenshot',
      run: () => { const acc = activeAccount(); if (acc) window.api.captureScreenshot(acc.id); }
    },
    {
      icon: '⬇️', label: t('cmdk.openDownloads'), keywords: 'descargas downloads',
      run: () => openDownloadsModal()
    },
    {
      icon: '⭐', label: t('cmdk.openBookmarks'), keywords: 'favoritos bookmarks marcadores',
      run: () => openBookmarksModal()
    },
    {
      icon: '🎮', label: t('cmdk.openPokeIdle'), keywords: 'poke idle pokemon equipo capturas alertas',
      run: () => openPokeIdlePanel()
    }
  );

  return actions;
}

function filterCommandActions(query) {
  const q = query.trim().toLowerCase();
  const all = getCommandActions();
  const filtered = q
    ? all.filter((a) => a.label.toLowerCase().includes(q) || (a.keywords || '').toLowerCase().includes(q))
    : all;
  if (q) {
    filtered.push({
      icon: '🔗',
      label: t('cmdk.goTo', { query: query.trim() }),
      hint: t('js.navigateActiveAccount'),
      run: () => {
        const active = activeAccount();
        if (active) window.api.navigateAccount(active.id, query.trim());
      }
    });
  }
  return filtered;
}

function renderCmdkResults() {
  cmdkListEl.innerHTML = '';
  if (cmdkResults.length === 0) {
    cmdkListEl.innerHTML = `<div class="cmdk-empty">${t('cmdk.noResults')}</div>`;
    return;
  }
  cmdkResults.forEach((action, i) => {
    const item = document.createElement('div');
    item.className = 'cmdk-item' + (i === cmdkSelectedIndex ? ' selected' : '');
    item.innerHTML =
      `<span class="cmdk-item-icon">${action.icon || ''}</span>` +
      `<span class="cmdk-item-label">${escapeHtmlClient(action.label)}</span>` +
      (action.hint ? `<span class="cmdk-item-hint">${escapeHtmlClient(action.hint)}</span>` : '');
    item.onmousemove = () => {
      if (cmdkSelectedIndex !== i) {
        cmdkSelectedIndex = i;
        renderCmdkResults();
      }
    };
    item.onclick = () => executeCmdkSelection();
    cmdkListEl.appendChild(item);
  });
}

function executeCmdkSelection() {
  const action = cmdkResults[cmdkSelectedIndex];
  if (!action) return;
  closeCommandPalette();
  action.run();
}

function openCommandPalette() {
  cmdkInput.value = '';
  cmdkResults = filterCommandActions('');
  cmdkSelectedIndex = 0;
  renderCmdkResults();
  cmdkModal.classList.remove('hidden');
  pushModal();
  cmdkInput.focus();
}

function closeCommandPalette() {
  cmdkModal.classList.add('hidden');
  popModal();
}

cmdkInput.addEventListener('input', () => {
  cmdkResults = filterCommandActions(cmdkInput.value);
  cmdkSelectedIndex = 0;
  renderCmdkResults();
});

cmdkInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdkSelectedIndex = Math.min(cmdkSelectedIndex + 1, cmdkResults.length - 1);
    renderCmdkResults();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdkSelectedIndex = Math.max(cmdkSelectedIndex - 1, 0);
    renderCmdkResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCmdkSelection();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  }
});

cmdkModal.addEventListener('mousedown', (e) => {
  if (e.target === cmdkModal) closeCommandPalette();
});

// ---- Shortcuts modal ----

async function renderShortcutsList() {
  const shortcuts = await window.api.getShortcuts();
  shortcutsListEl.innerHTML = '';
  shortcuts.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const label = document.createElement('span');
    label.textContent = s.label;
    const keys = document.createElement('span');
    keys.className = 'shortcut-keys';
    const parts = s.combo.split('+').map((p) => p.trim());
    parts.forEach((part, i) => {
      if (i > 0) {
        const plus = document.createElement('span');
        plus.className = 'plus';
        plus.textContent = '+';
        keys.appendChild(plus);
      }
      const kbd = document.createElement('span');
      kbd.className = 'kbd';
      kbd.textContent = part;
      keys.appendChild(kbd);
    });
    row.append(label, keys);
    shortcutsListEl.appendChild(row);
  });
}

async function openShortcutsModal() {
  await renderShortcutsList();
  shortcutsModal.classList.remove('hidden');
  pushModal();
}

function closeShortcutsModal() {
  shortcutsModal.classList.add('hidden');
  popModal();
}

setShowShortcuts.addEventListener('click', openShortcutsModal);
btnCloseShortcuts.addEventListener('click', closeShortcutsModal);

tbDownloads.addEventListener('click', openDownloadsModal);
btnCloseDownloads.addEventListener('click', closeDownloadsModal);

tbDns.addEventListener('click', openDnsModal);
btnCloseDns.addEventListener('click', closeDnsModal);
dnsRunBtn.addEventListener('click', runDnsTest);
dnsCopyRestoreBtn.addEventListener('click', async () => {
  const command = await window.api.getDnsRestoreCommand();
  await window.api.copyDnsCommand(command);
  dnsCopyRestoreBtn.textContent = t('dnsModal.copied');
  setTimeout(() => { dnsCopyRestoreBtn.textContent = t('dnsModal.restore'); }, 1500);
});

updateLaterBtn.addEventListener('click', closeUpdateModal);
updateRestartBtn.addEventListener('click', () => window.api.installUpdate());
window.api.onUpdateDownloaded((data) => {
  statusUpdateProgress.classList.add('hidden');
  openUpdateModal(data);
});
window.api.onUpdateDownloadProgress(({ percent }) => {
  statusUpdateProgress.classList.remove('hidden');
  statusUpdateProgress.textContent = `⬇ ${t('status.updating')} ${Math.round(percent)}%`;
});
dlOpenFolder.addEventListener('click', () => window.api.openDownloads());
dlClear.addEventListener('click', async () => {
  await window.api.clearDownloads();
  renderDownloadsList();
});

// ---- Passwords (Settings) ----

// Fetches the real password list on demand instead of reading state.passwords —
// the app no longer keeps real password values in the state object broadcast
// on every change, only id/name/url/username (see passwordSecrets in main.js).
async function renderPasswords() {
  const list = await window.api.getPasswords();
  pwListEl.innerHTML = '';
  if (list.length === 0) {
    pwListEl.innerHTML = `<div class="settings-hint">${t('settings.pwEmpty')}</div>`;
    return;
  }
  list.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'ext-item';

    const info = document.createElement('div');
    info.className = 'ext-info';
    info.innerHTML = `
      <div class="ext-name">${escapeHtmlClient(p.name || p.url)}</div>
      <div class="ext-desc">${escapeHtmlClient(p.username || '')} · ••••••••</div>
      <div class="ext-id">${escapeHtmlClient(p.url)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'ext-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ext-remove';
    copyBtn.textContent = t('settings.copy');
    copyBtn.onclick = () => navigator.clipboard.writeText(p.password || '');

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-remove';
    removeBtn.textContent = t('settings.remove');
    removeBtn.onclick = () => window.api.removePassword(p.id);

    actions.append(copyBtn, removeBtn);
    item.append(info, actions);
    pwListEl.appendChild(item);
  });
}

pwImportBtn.addEventListener('click', async () => {
  pwError.classList.add('hidden');
  const result = await window.api.importPasswords();
  if (result.ok) {
    renderPasswords();
  } else if (result.error) {
    pwError.textContent = result.error;
    pwError.classList.remove('hidden');
  }
});

pwAddSave.addEventListener('click', async () => {
  pwError.classList.add('hidden');
  const url = pwAddUrl.value.trim();
  const password = pwAddPass.value;
  if (!url || !password) {
    pwError.textContent = t('settings.pwUrlPassRequired');
    pwError.classList.remove('hidden');
    return;
  }
  const result = await window.api.addPassword({
    name: pwAddName.value.trim(),
    url,
    username: pwAddUser.value.trim(),
    password
  });
  if (result.ok) {
    pwAddName.value = '';
    pwAddUrl.value = '';
    pwAddUser.value = '';
    pwAddPass.value = '';
    renderPasswords();
  } else if (result.error) {
    pwError.textContent = result.error;
    pwError.classList.remove('hidden');
  }
});

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideSuggestions();
    return;
  }
  if (e.key !== 'Enter') return;
  const active = activeAccount();
  if (!active || !addressInput.value.trim()) return;
  window.api.navigateAccount(active.id, addressInput.value.trim());
  hideSuggestions();
});

addressInput.addEventListener('input', () => showSuggestions(addressInput, 'address'));
addressInput.addEventListener('blur', () => setTimeout(hideSuggestions, 100));

// Every real browser selects the whole URL when the address bar gains
// focus, so typing immediately replaces it — confirmed live this one
// didn't: a plain mouse click just placed the caret at the click position
// like a normal <input>, leaving the rest of the URL in place, so typing
// silently inserted characters into the middle of it instead of replacing
// anything (looked exactly like "the address bar won't let me type"). The
// setTimeout defers past the click's own native caret-placement for this
// same event cycle, so our full-text selection is what actually wins.
addressInput.addEventListener('focus', () => {
  setTimeout(() => addressInput.select(), 0);
});

// ---- Settings modal ----

function openSettingsModal() {
  // Idempotent: the command palette can call this to jump straight to a tab
  // while Settings is already open, without going through closeSettingsModal()
  // first — pushModal() must only fire on an actual closed-to-open transition,
  // or the counter drifts and views never come back.
  const wasHidden = settingsModal.classList.contains('hidden');
  const s = state.settings;
  setLanguage.value = s.language || 'es';
  setTheme.value = s.theme || 'system';
  setStartWindows.checked = !!s.startWithWindows;
  setReopenSpace.checked = s.reopenLastSpace !== false;
  setProtectionLevel.value = s.protectionLevel || 'standard';
  setAutoEcoEnabled.checked = !!(s.autoEco && s.autoEco.enabled);
  setAutoEcoMinutes.value = String((s.autoEco && s.autoEco.minutes) || 30);
  setShowFpsOverlay.checked = s.showFpsOverlay !== false;
  setShowPingOverlay.checked = s.showPingOverlay !== false;
  setShowAccountMetrics.checked = s.showAccountMetrics !== false;
  setHuntTelemetry.checked = s.huntTelemetryEnabled !== false;
  setTranslateMemoryPersist.checked = !!s.translateMemoryPersist;
  setHwAccel.checked = s.hardwareAcceleration !== false;
  setDefaultUrl.value = s.defaultStartUrl || 'https://www.google.com';
  if (setSupportPaypalUrl) setSupportPaypalUrl.value = s.supportPaypalUrl || '';
  setDefaultZoom.value = String(s.defaultZoom || 1);
  setDefaultLayout.value = s.newSpaceDefaultLayout || 'single';
  setDownloadsFolderLabel.textContent = s.downloadsFolder || t('settings.downloadsFolderDefault');
  setAskDownload.checked = !!s.askDownloadLocation;

  const versions = window.api.getVersions();
  verApp.textContent = versions.app;
  verElectron.textContent = versions.electron;
  verChrome.textContent = versions.chrome;
  if (verUpdateStatus) {
    window.api.getUpdateStatus().then((s) => {
      const labelKey = {
        idle: 'settings.updateStatusIdle',
        checking: 'settings.updateStatusChecking',
        'up-to-date': 'settings.updateStatusUpToDate',
        downloading: 'settings.updateStatusDownloading',
        downloaded: 'settings.updateStatusDownloaded',
        error: 'settings.updateStatusError'
      }[s.state] || 'settings.updateStatusIdle';
      verUpdateStatus.textContent = s.state === 'error' && s.lastError
        ? `${t(labelKey)} (${s.lastError})`
        : t(labelKey);
    });
  }

  extError.classList.add('hidden');
  extInput.value = '';
  renderExtensions();
  renderPlugins();
  renderPasswords();
  renderNetworkTab();
  renderPermissionsTab();

  settingsModal.classList.remove('hidden');
  if (wasHidden) pushModal();
  refreshEcoSavingsHint();
  if (!ecoSavingsInterval) ecoSavingsInterval = setInterval(refreshEcoSavingsHint, 5000);
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  popModal();
  if (ecoSavingsInterval) {
    clearInterval(ecoSavingsInterval);
    ecoSavingsInterval = null;
  }
}

// Real measured CPU%, not an estimate — see eco:getSavings in main.js,
// which compares each auto-eco'd account's actual CPU reading right before
// throttling kicked in against its latest reading now.
let ecoSavingsInterval = null;
async function refreshEcoSavingsHint() {
  if (settingsModal.classList.contains('hidden')) return;
  try {
    const s = await window.api.getEcoSavings();
    if (!s.throttledCount) {
      ecoSavingsHint.textContent = t('settings.autoEcoSavingsNone');
    } else if (s.savingsPercent == null) {
      ecoSavingsHint.textContent = t('settings.autoEcoSavingsMeasuring').replace('{n}', s.throttledCount);
    } else {
      ecoSavingsHint.textContent = t('settings.autoEcoSavingsActive')
        .replace('{percent}', s.savingsPercent)
        .replace('{n}', s.sampledCount);
    }
  } catch {
    // Non-fatal — just leave the hint at whatever it last said.
  }
}

// Persistent toolbar icon per enabled extension — the settings-modal list
// (renderExtensions below) already lets the user install/toggle/remove, but
// had no way to actually USE an extension without leaving the app's own
// browsing chrome, unlike every real browser. Clicking an icon opens (or,
// if already open, closes) the extension's real chrome-extension://
// popup.html in a small floating window (see extensions:openPopup, main.js)
// — extensions with no popup (background-only, e.g. some ad blockers) get a
// disabled-looking icon instead of silently doing nothing on click.
const extToolbarEl = document.getElementById('ext-toolbar');
function renderExtensionToolbar() {
  const list = (state.settings.extensions || []).filter((e) => e.enabled !== false);
  extToolbarEl.innerHTML = '';
  list.forEach((ext) => {
    const btn = document.createElement('button');
    const hasPopup = !!(ext.action && ext.action.popup);
    btn.className = 'ext-toolbar-btn' + (hasPopup ? '' : ' no-popup');
    btn.title = (ext.action && ext.action.title) || ext.name;
    if (ext.action && ext.action.icon) {
      const img = document.createElement('img');
      img.src = `file://${ext.action.icon.replace(/\\/g, '/')}`;
      img.onerror = () => {
        img.remove();
        btn.textContent = '🧩';
      };
      btn.appendChild(img);
    } else {
      btn.textContent = '🧩';
    }
    btn.onclick = () => {
      if (!hasPopup) return; // nothing to open — this extension runs in the background only
      window.api.openExtensionPopup(ext.id);
    };
    extToolbarEl.appendChild(btn);
  });
}

function renderExtensions() {
  const list = state.settings.extensions || [];
  extListEl.innerHTML = '';
  if (list.length === 0) {
    extListEl.innerHTML = `<div class="settings-hint">${t('settings.extEmpty')}</div>`;
    return;
  }
  list.forEach((ext) => {
    const item = document.createElement('div');
    item.className = 'ext-item';

    const icon = document.createElement('div');
    icon.className = 'ext-icon';
    if (ext.path) {
      const img = document.createElement('img');
      img.src = `file://${ext.path.replace(/\\/g, '/')}/icons/icon48.png`;
      img.onerror = () => {
        icon.innerHTML = '';
        icon.textContent = '🧩';
      };
      icon.appendChild(img);
    } else {
      icon.textContent = '🧩';
    }

    const desc = ext.description && !ext.description.startsWith('__MSG_') ? ext.description : '';
    const info = document.createElement('div');
    info.className = 'ext-info';
    info.innerHTML = `
      <div class="ext-name">${escapeHtmlClient(ext.name)} <span class="ext-version">${escapeHtmlClient(ext.version || '')}</span></div>
      ${desc ? `<div class="ext-desc">${escapeHtmlClient(desc)}</div>` : ''}
      <div class="ext-id">ID: ${escapeHtmlClient(ext.id)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'ext-actions';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'switch';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = ext.enabled !== false;
    toggleInput.onchange = () => window.api.toggleExtension(ext.id, toggleInput.checked);
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggleLabel.append(toggleInput, slider);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-remove';
    removeBtn.textContent = t('settings.remove');
    removeBtn.onclick = () => window.api.removeExtension(ext.id);

    actions.append(toggleLabel, removeBtn);
    item.append(icon, info, actions);
    extListEl.appendChild(item);
  });
}

async function renderPlugins() {
  const list = await window.api.getPlugins();
  pluginListEl.innerHTML = '';
  list.forEach((plugin) => {
    const item = document.createElement('div');
    item.className = 'ext-item';
    if (!plugin.enabled) item.style.opacity = '0.55';

    const icon = document.createElement('div');
    icon.className = 'ext-icon';
    icon.textContent = '🧩';

    const info = document.createElement('div');
    info.className = 'ext-info';
    info.innerHTML = `
      <div class="ext-name">${escapeHtmlClient(plugin.name)} ${plugin.version ? `<span class="ext-version">${escapeHtmlClient(plugin.version)}</span>` : ''}</div>
      <div class="ext-desc">${escapeHtmlClient(plugin.description)}</div>
      ${!plugin.enabled ? `<div class="ext-id">${t('settings.pluginNotAvailable')}</div>` : ''}
    `;

    item.append(icon, info);
    pluginListEl.appendChild(item);
  });
}

function renderNetworkTab() {
  if (!networkListEl) return;
  networkListEl.innerHTML = '';
  if (state.accounts.length === 0) {
    networkListEl.innerHTML = `<div class="settings-hint">${t('settings.networkEmpty')}</div>`;
    return;
  }
  state.accounts.forEach((account, i) => {
    const item = document.createElement('div');
    item.className = 'ext-item';
    const proxyText = account.proxy?.server
      ? `${account.proxy.server}${account.proxy.username ? t('settings.networkProxyUser', { user: account.proxy.username }) : ''}`
      : t('settings.networkNoProxy');
    item.innerHTML = `
      <div class="ext-info">
        <div class="ext-name">${escapeHtmlClient(displayName(account, i))}</div>
        <div class="ext-desc">${escapeHtmlClient(proxyText)}</div>
      </div>
    `;
    networkListEl.appendChild(item);
  });
}

const PERMISSION_KEYS = ['media', 'notifications', 'geolocation'];
const permissionsListEl = document.getElementById('permissions-list');
const permissionsClearAllBtn = document.getElementById('permissions-clear-all');

permissionsClearAllBtn?.addEventListener('click', async () => {
  await window.api.clearAllSitePermissions();
  renderPermissionsTab();
});

async function renderPermissionsTab() {
  if (!permissionsListEl) return;
  const sitePermissions = await window.api.getSitePermissions();
  const hostnames = Object.keys(sitePermissions || {}).sort();
  permissionsListEl.innerHTML = '';
  if (permissionsClearAllBtn) permissionsClearAllBtn.classList.toggle('hidden', hostnames.length === 0);
  if (hostnames.length === 0) {
    permissionsListEl.innerHTML = `<div class="settings-hint">${t('permissions.empty')}</div>`;
    return;
  }
  hostnames.forEach((hostname) => {
    PERMISSION_KEYS.forEach((permission) => {
      const decision = sitePermissions[hostname][permission];
      if (!decision) return;
      const item = document.createElement('div');
      item.className = 'ext-item';
      const info = document.createElement('div');
      info.className = 'ext-info';
      const name = document.createElement('div');
      name.className = 'ext-name';
      name.textContent = hostname;
      const desc = document.createElement('div');
      desc.className = 'ext-desc';
      desc.textContent = `${t(`permission.${permission}`)} — ${t(decision === 'allow' ? 'permissions.allow' : 'permissions.deny')}`;
      info.append(name, desc);
      const revokeBtn = document.createElement('button');
      revokeBtn.type = 'button';
      revokeBtn.textContent = t('permissions.revoke');
      revokeBtn.addEventListener('click', async () => {
        await window.api.revokeSitePermission(hostname, permission);
        renderPermissionsTab();
      });
      item.append(info, revokeBtn);
      permissionsListEl.appendChild(item);
    });
  });
}

function loadPokeIdleAlertFields() {
  const cfg = state.settings.pokeIdleAlerts || {};
  pokeAlertEnabled.checked = cfg.enabled !== false;
  pokeAlertShiny.checked = cfg.shiny !== false;
  pokeAlertRare.checked = cfg.rare !== false;
  pokeAlertDisconnect.checked = cfg.disconnect !== false;
  pokeAlertBalls.checked = cfg.ballsLow !== false;
  pokeAlertBallsThreshold.value = cfg.ballsThreshold ?? 20;
}

function savePokeIdleAlertFields() {
  window.api.updateSettings({
    pokeIdleAlerts: {
      enabled: pokeAlertEnabled.checked,
      shiny: pokeAlertShiny.checked,
      rare: pokeAlertRare.checked,
      disconnect: pokeAlertDisconnect.checked,
      ballsLow: pokeAlertBalls.checked,
      ballsThreshold: Math.max(0, Number(pokeAlertBallsThreshold.value) || 0)
    }
  });
}

[pokeAlertEnabled, pokeAlertShiny, pokeAlertRare, pokeAlertDisconnect, pokeAlertBalls].forEach((el) => {
  if (!el) return;
  el.addEventListener('change', savePokeIdleAlertFields);
});
pokeAlertBallsThreshold.addEventListener('change', savePokeIdleAlertFields);

const POKE_NOTABLE_VISIBLE_LIMIT = 30;

// Public sprite CDN keyed by National Pokédex number — the game's own
// creatures.json (checked live) has no image URL, only a numeric `looktype`
// that isn't the dex number; `speciesId` in poke-delta frames IS the real
// dex number (confirmed: 18 = Pidgeot), which this CDN indexes by directly.
// Confirmed live against the game's own creatures.json: "boosted hunt"
// variants (e.g. pokeId 10501 "Brave Blastoise") use custom ids way outside
// the real Pokédex range, so the PokeAPI sprite CDN 404s for them — but
// their name is always "{Adjective} {RealSpeciesName}", and the real species
// (e.g. plain "Blastoise") is itself somewhere else in the SAME catalog with
// a normal id. Resolve by matching the name's trailing word(s) against every
// normal-range name already in the cached catalog, so this works for any
// prefix the game adds later, not just the ones seen so far.
let speciesNameToDexIdCache = null;
function getSpeciesNameToDexIdMap() {
  if (speciesNameToDexIdCache || !creatureCatalogCache) return speciesNameToDexIdCache;
  const map = new Map();
  for (const c of creatureCatalogCache) {
    if (c.pokeId < 10000 && c.name) map.set(c.name, c.pokeId);
  }
  speciesNameToDexIdCache = map;
  return map;
}

function resolveSpriteDexId(pokeId, name) {
  if (pokeId != null && pokeId < 10000) return pokeId;
  const nameMap = getSpeciesNameToDexIdMap();
  if (!name || !nameMap) return null;
  if (nameMap.has(name)) return nameMap.get(name);
  // Strip one leading "{Prefix}{separator}" at a time — the prefix word can
  // be separator by a space ("Brave Blastoise") or a hyphen ("Milch-Miltank"
  // confirmed live), so split on whichever comes first rather than assuming
  // one or the other.
  let rest = name;
  let match;
  while ((match = rest.match(/^[^\s-]+[\s-]+(.+)$/))) {
    rest = match[1];
    if (nameMap.has(rest)) return nameMap.get(rest);
  }
  // Some forms name the base species FIRST and the form descriptor last
  // instead — confirmed live with a game update that added "Castform Fire"
  // (base "Castform", suffix "Fire"), the opposite order from "Mega
  // Blastoise"/"Brave Blastoise" above. Try stripping a trailing word too.
  rest = name;
  while ((match = rest.match(/^(.+)[\s-][^\s-]+$/))) {
    rest = match[1];
    if (nameMap.has(rest)) return nameMap.get(rest);
  }
  return null;
}

function pokeSpriteUrl(pokeId, name) {
  const dexId = resolveSpriteDexId(pokeId, name);
  return dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexId}.png` : '';
}

// Animated sprite (gen-5 style), primary source — falls back to the static
// PNG (via applySpriteWithFallback / window.pokeSpriteFallback below) since
// not every dex id has an animated frame in PokeAPI's sprite repo.
function pokeSpriteGifUrl(pokeId, name) {
  const dexId = resolveSpriteDexId(pokeId, name);
  return dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${dexId}.gif` : '';
}

function applySpriteWithFallback(img, pokeId, name) {
  const png = pokeSpriteUrl(pokeId, name);
  const gif = pokeSpriteGifUrl(pokeId, name);
  img.src = gif || png;
  img.onerror = () => {
    if (png && img.src !== png) { img.src = png; }
    else { img.style.visibility = 'hidden'; }
  };
}

// Used from inline onerror= in template-string-built rows (hunt table),
// where a closure isn't available — mirrors applySpriteWithFallback's logic.
window.pokeSpriteFallback = function pokeSpriteFallback(img, pngSrc) {
  if (img.dataset.fallbackTried) { img.style.visibility = 'hidden'; return; }
  img.dataset.fallbackTried = '1';
  if (pngSrc) { img.src = pngSrc; } else { img.style.visibility = 'hidden'; }
};

function formatRelativeTime(ts) {
  const diff = Math.max(Date.now() - ts, 0);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

const POKE_TYPE_COLORS = {
  NORMAL: '#a8a878', FIRE: '#f08030', WATER: '#6890f0', ELECTRIC: '#f8d030',
  GRASS: '#78c850', ICE: '#98d8d8', FIGHTING: '#c03028', POISON: '#a040a0',
  GROUND: '#e0c068', FLYING: '#a890f0', PSYCHIC: '#f85888', BUG: '#a8b820',
  ROCK: '#b8a038', GHOST: '#705898', DRAGON: '#7038f8', DARK: '#705848',
  STEEL: '#b8b8d0', FAIRY: '#ee99ac'
};

// Mismo type chart que electron/poke-formulas.js (attack multipliers), pero
// duplicado acá porque poke-formulas.js corre en main.js (sin sandbox) y no
// se puede exponer al renderer sandboxeado — ver nota en pokeSpriteUrl y en
// el módulo original. Solo se usa acá para el recuadro "daño x2 a".
const POKE_TYPE_CHART = {
  NORMAL:   { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
  FIRE:     { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
  WATER:    { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
  ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
  GRASS:    { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
  ICE:      { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
  FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
  POISON:   { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
  GROUND:   { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
  FLYING:   { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
  PSYCHIC:  { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
  BUG:      { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
  ROCK:     { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
  GHOST:    { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
  DRAGON:   { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
  DARK:     { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
  STEEL:    { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
  FAIRY:    { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 }
};

function typeBadgeHtml(t) {
  return `<span class="poke-type-badge" style="background:${POKE_TYPE_COLORS[t] || '#4f8cff'}">${escapeHtmlClient(t)}</span>`;
}

// Recuadro "a qué tipos les hace x2 de daño" según los tipos propios del
// Pokémon (STAB) — lo que el usuario pidió mostrar como en la imagen de
// referencia ("Rock le hace daño extra a Fire, Ice...").
function effectivenessBoxHtml(type1, type2) {
  const types = [type1, type2].filter(Boolean);
  if (!types.length) return '';
  const targets = new Set();
  types.forEach((t) => {
    const row = POKE_TYPE_CHART[t];
    if (!row) return;
    Object.entries(row).forEach(([defType, mult]) => { if (mult > 1) targets.add(defType); });
  });
  if (!targets.size) return '';
  const chips = Array.from(targets).map(typeBadgeHtml).join('');
  return `<div class="poke-eff-box"><span class="poke-eff-title">${t('pokeIdle.damageBoxTitle')}</span><div class="poke-eff-chips">${chips}</div></div>`;
}

// Every section lives in the drawer at once now — the nav pills just
// scroll to their section instead of switching which pane is visible.
pokeNavItems.forEach((navItem) => {
  navItem.addEventListener('click', () => {
    pokeNavItems.forEach((item) => item.classList.toggle('active', item === navItem));
    document.getElementById('poke-section-' + navItem.dataset.pokeScroll)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// The panel is a docked drawer, not a modal: no pushModal()/hideViews()
// here on purpose, since the whole point is being able to keep clicking
// the account underneath while it's open. All sections render once on
// open — there's no lazy per-tab render since nothing is hidden.
function openPokeIdlePanel() {
  pokeIdlePanel.classList.add('open');
  if (![...pokeNavItems].some((item) => item.classList.contains('active'))) {
    pokeNavItems[0]?.classList.add('active');
  }
  renderPokeIdleTeam();
  renderPokeAccountSettings();
  renderStabilityGlobalSettings();
  loadPokeIdleAlertFields();
  populateCalcSourceDropdown();
  // Paint instantly from whatever's cached above, then bring Mi Equipo up to
  // date in the background — see refreshPokesForOpenAccounts()'s comment for
  // why this is needed at all.
  refreshPokesForOpenAccounts().then(() => {
    renderPokeIdleTeam();
  });
}

function closePokeIdlePanel() {
  pokeIdlePanel.classList.remove('open');
}

tbPokeIdle.addEventListener('click', () => {
  if (pokeIdlePanel.classList.contains('open')) closePokeIdlePanel();
  else openPokeIdlePanel();
});
btnClosePokeIdle.addEventListener('click', closePokeIdlePanel);

function renderPokeIdleTeam() {
  if (!pokeIdleTeamEl) return;
  const { gameAccounts, tracked: statsTracked } = pokeLiveAccountsStatus();
  if (statsTracked.length === 0) {
    pokeIdleTeamEl.innerHTML = pokeLoadingOrEmptyHtml(gameAccounts);
    return;
  }
  const tracked = statsTracked.filter((a) => (gameStats[a.id].team || []).length);

  if (tracked.length === 0) {
    pokeIdleTeamEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.equipoEmpty')}</div>`;
    return;
  }

  const showAccountName = tracked.length > 1;
  pokeIdleTeamEl.innerHTML = '';
  tracked.forEach((account, ai) => {
    const gs = gameStats[account.id];
    (gs.team || []).forEach((p) => {
      const card = document.createElement('div');
      card.className = 'poke-team-card';

      const img = document.createElement('img');
      img.className = 'poke-team-sprite';
      img.loading = 'lazy';
      img.alt = p.name || '';
      applySpriteWithFallback(img, p.speciesId, p.name);

      const main = document.createElement('div');
      main.className = 'poke-team-main';

      const typeBadges = [p.type1, p.type2].filter(Boolean).map(typeBadgeHtml).join(' ');

      const locked = (account.sellLockPokeIds || []).includes(String(p.id));
      const header = document.createElement('div');
      header.className = 'poke-team-header';
      header.innerHTML =
        `<span class="poke-team-name">${p.shiny ? '✨ ' : ''}${escapeHtmlClient(p.name || '?')}${p.leader ? ' 👑' : ''}</span>` +
        `<span class="poke-team-level">Lv.${numOr(p.level)}${showAccountName ? ' · ' + escapeHtmlClient(displayName(account, ai)) : ''}</span>` +
        typeBadges +
        `<button type="button" class="poke-team-lock${locked ? ' locked' : ''}" title="${locked ? t('pokeIdle.sellLockRemove') : t('pokeIdle.sellLockAdd')}" data-poke-id="${escapeHtmlClient(String(p.id))}" data-account-id="${escapeHtmlClient(String(account.id))}">${locked ? '🔒' : '🔓'}</button>`;

      const quality = document.createElement('div');
      quality.className = 'poke-team-quality';
      const q = typeof p.quality === 'number' ? p.quality.toFixed(3) : '?';
      quality.textContent = `Quality ${q} · IV ${p.ivTotal ?? '?'}/192 · Power ${p.power ?? '?'}`;

      const hpPct = p.maxHp ? Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100)) : 0;
      const hpRow = document.createElement('div');
      hpRow.className = 'poke-hp-row';
      hpRow.innerHTML =
        `<span class="poke-hp-label">HP</span>` +
        `<span class="poke-hp-track"><span class="poke-hp-fill" style="width:${hpPct}%"></span></span>` +
        `<span class="poke-hp-value">${formatCompactNumber(p.hp)} / ${formatCompactNumber(p.maxHp)}</span>`;

      const stats = p.stats || {};
      const statGrid = document.createElement('div');
      statGrid.className = 'poke-stat-grid';
      statGrid.innerHTML = [
        ['ATK', stats.atk], ['DEF', stats.def], ['SpA', stats.spAtk],
        ['SpD', stats.spDef], ['Vel', stats.speed]
      ].map(([label, value]) => `<div class="poke-stat-cell"><span>${label}</span><span>${numOr(value)}</span></div>`).join('');

      const moves = document.createElement('div');
      moves.className = 'poke-moves';
      const moveList = p.moves || [];
      moves.innerHTML = moveList.length
        ? moveList.slice(0, 8).map((m) => `<span class="poke-move-chip">${typeBadgeHtml(m.type)}${escapeHtmlClient(m.name)} · ${numOr(m.power)} <span class="poke-move-lvl">Lv.${numOr(m.learnLevel, 1)}</span></span>`).join('')
        : `<span class="poke-move-chip">${t('pokeIdle.noMoves')}</span>`;

      const effBox = document.createElement('div');
      effBox.innerHTML = effectivenessBoxHtml(p.type1, p.type2);

      main.append(header, quality, hpRow, statGrid, moves, ...effBox.children);
      card.append(img, main);
      pokeIdleTeamEl.appendChild(card);
    });
  });

  pokeIdleTeamEl.querySelectorAll('.poke-team-lock').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.api.toggleSellLockPoke(btn.dataset.accountId, btn.dataset.pokeId);
      renderPokeIdleTeam();
    });
  });
}

function renderPokeIdleLivePanels() {
  if (!pokeIdlePanel.classList.contains('open')) return;
  maybePlayGameAlertSounds();
  renderPokeIdleTeam();
}

// Caps at 200 entries (see the .size check below) so a long session doesn't
// grow this unbounded — only recent keys matter for dedup anyway.
const notifiedGameEventKeys = new Set();

function maybePlayGameAlertSounds() {
  const cfg = state.settings?.pokeIdleAlerts || {};
  if (!cfg.enabled) return;
  for (const [accountId, stats] of Object.entries(gameStats || {})) {
    const event = stats && stats.lastEvent;
    if (!event || !event.at) continue;
    const key = `${accountId}:${event.type}:${event.at}`;
    if (notifiedGameEventKeys.has(key)) continue;
    notifiedGameEventKeys.add(key);
    if (notifiedGameEventKeys.size > 200) notifiedGameEventKeys.delete(notifiedGameEventKeys.values().next().value);
    if ((event.type === 'shiny_capture' || event.type === 'shiny_wild') && cfg.shiny !== false) {
      playAlertTone('shiny');
    }
  }
}
let creatureCatalogCache = null;
let creatureCatalogMeta = null;
let creatureCatalogPromise = null;
function ensureCreatureCatalogRenderer(forceRefresh = false) {
  if (forceRefresh) {
    creatureCatalogCache = null;
    creatureCatalogMeta = null;
    creatureCatalogPromise = null;
  }
  if (creatureCatalogCache) return Promise.resolve(creatureCatalogCache);
  if (!creatureCatalogPromise) {
    creatureCatalogPromise = window.api.getCreatureCatalog(forceRefresh).then((payload) => {
      const list = Array.isArray(payload) ? payload : (payload && payload.creatures) || [];
      creatureCatalogMeta = Array.isArray(payload) ? null : (payload && payload.meta) || null;
      creatureCatalogCache = list;
      return list;
    });
  }
  return creatureCatalogPromise;
}

async function populateCalcSpeciesDropdown() {
  const catalog = await ensureCreatureCatalogRenderer();
  const sorted = catalog.slice().sort((a, b) => a.name.localeCompare(b.name));
  calcSpeciesEl.innerHTML = `<option value="">${t('pokeIdle.pokemonPlaceholder')}</option>` +
    sorted.map((c) => `<option value="${escapeHtmlClient(String(c.pokeId))}">${escapeHtmlClient(c.name)}</option>`).join('');
}

let calcSources = [];

function collectLiveCalcSources() {
  const sources = [];
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id]);
  tracked.forEach((account, ai) => {
    const gs = gameStats[account.id];
    (gs.team || []).forEach((p) => {
      sources.push({
        label: `🟢 ${displayName(account, ai)} · ${p.name} Lv.${p.level} (${t('pokeIdle.teamSuffix')})`,
        isTeam: true,
        speciesId: p.speciesId, level: p.level, quality: p.quality, stats: p.stats,
        killsPerHour: gs.killsPerHour
      });
    });
    (gs.notableCaptures || []).slice(0, POKE_NOTABLE_VISIBLE_LIMIT).forEach((c) => {
      if (!c.stats) return;
      sources.push({
        label: `📋 ${displayName(account, ai)} · ${c.name} Lv.${c.level} (${formatRelativeTime(c.at)})`,
        isTeam: false,
        speciesId: c.speciesId, level: c.level, quality: c.quality, stats: c.stats
      });
    });
  });
  return sources;
}

function populateCalcSourceDropdown() {
  calcSources = collectLiveCalcSources();
  const current = calcSourceEl.value;
  calcSourceEl.innerHTML = `<option value="manual">${t('pokeIdle.sourceManual')}</option>` +
    calcSources.map((s, i) => `<option value="${i}">${escapeHtmlClient(s.label)}</option>`).join('');
  if (current && [...calcSourceEl.options].some((o) => o.value === current)) calcSourceEl.value = current;
}

calcSourceEl.addEventListener('change', () => {
  const idx = calcSourceEl.value;
  if (idx === 'manual') return;
  const src = calcSources[Number(idx)];
  if (!src) return;
  calcSpeciesEl.value = src.speciesId;
  calcLevelEl.value = src.level ?? '';
  calcQualityEl.value = src.quality ?? '';
  const st = src.stats || {};
  calcStatInputs.hp.value = st.hp ?? '';
  calcStatInputs.atk.value = st.atk ?? '';
  calcStatInputs.def.value = st.def ?? '';
  calcStatInputs.spatk.value = st.spAtk ?? st.spatk ?? '';
  calcStatInputs.spdef.value = st.spDef ?? st.spdef ?? '';
  calcStatInputs.speed.value = st.speed ?? '';
  calcProjLevelEl.value = src.level ?? 100;
  runCalculator();
});

[calcSpeciesEl, calcLevelEl, calcQualityEl, calcProjLevelEl, ...Object.values(calcStatInputs)].forEach((el) => {
  el.addEventListener('input', runCalculator);
});

const CALC_STAT_LABELS = { hp: 'HP', atk: 'ATK', def: 'DEF', spatk: 'SpA', spdef: 'SpD', speed: 'Vel' };

const QUALITY_BAND_KEYS = {
  Weak: 'pokeIdle.qualityBand.bad', Common: 'pokeIdle.qualityBand.normal', Uncommon: 'pokeIdle.qualityBand.normal',
  Rare: 'pokeIdle.qualityBand.good', Epic: 'pokeIdle.qualityBand.good', Legendary: 'pokeIdle.qualityBand.excellent'
};
function qualityBandLabel(bandLabel) {
  const key = QUALITY_BAND_KEYS[bandLabel];
  return key ? t(key) : bandLabel;
}
// Tabla de evaluación por potencial de IV (%) tal como la pasó el usuario —
// mismos 6 tramos y umbrales, sin combinar con Quality (esa se sigue
// mostrando aparte).
function pokeVerdict(ivMin, ivMax) {
  const ivPct = ((ivMin + ivMax) / 2) / 192 * 100;
  if (ivPct >= 95) return { text: t('pokeIdle.verdict.exceptional'), color: '#34d3c4' };
  if (ivPct >= 85) return { text: t('pokeIdle.verdict.excellent'), color: '#4f8cff' };
  if (ivPct >= 72) return { text: t('pokeIdle.verdict.veryGood'), color: '#51cf66' };
  if (ivPct >= 58) return { text: t('pokeIdle.verdict.good'), color: '#a3e635' };
  if (ivPct >= 42) return { text: t('pokeIdle.verdict.medium'), color: '#ffb020' };
  return { text: t('pokeIdle.verdict.low'), color: '#ff6b6b' };
}

async function runCalculator() {
  const speciesId = Number(calcSpeciesEl.value);
  const level = Number(calcLevelEl.value);
  const quality = Number(calcQualityEl.value);
  const observed = {
    hp: Number(calcStatInputs.hp.value), atk: Number(calcStatInputs.atk.value), def: Number(calcStatInputs.def.value),
    spatk: Number(calcStatInputs.spatk.value), spdef: Number(calcStatInputs.spdef.value), speed: Number(calcStatInputs.speed.value)
  };
  if (!speciesId || !level || !quality || Object.values(observed).some((v) => !v)) {
    calcResultEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.calcNeedsFields')}</div>`;
    return;
  }

  const projLevel = Number(calcProjLevelEl.value) || level;
  const result = await window.api.computeGrowthCalc({ speciesId, level, quality, observed, projLevel });
  if (!result || result.error) {
    calcResultEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.calcNotFound')}</div>`;
    return;
  }

  const rowsHtml = result.rows.map((r) => {
    const range = r.min === r.max ? String(r.min) : `${r.min}–${r.max}`;
    return `<tr><td>${CALC_STAT_LABELS[r.key]}</td><td>${range}</td><td>${r.observed}</td><td>${r.projected}</td></tr>`;
  }).join('');

  const clampedQ = Math.max(0.8, Math.min(2.6, quality));
  const markerPct = ((clampedQ - 0.8) / 1.8) * 100;
  const verdict = pokeVerdict(result.ivMin, result.ivMax);

  calcResultEl.innerHTML = `
    <div class="poke-calc-summary">
      <div><b>${escapeHtmlClient(result.creatureName)}</b>${t('pokeIdle.species')}</div>
      <div><b style="color:${verdict.color}">${verdict.text}</b>${t('pokeIdle.verdict')}</div>
      <div><b>${quality.toFixed(3)}</b>Quality (${qualityBandLabel(result.band.label)})</div>
      <div><b>${Math.round(result.ivMin)}–${Math.round(result.ivMax)}</b>${t('pokeIdle.ivTotal')}</div>
      <div><b>${result.projectedPower}</b>${t('pokeIdle.projectedPower', { level: projLevel })}</div>
    </div>
    <div class="poke-calc-quality-gauge"><div class="poke-calc-quality-marker" style="left:${markerPct}%"></div></div>
    <table class="poke-calc-table">
      <thead><tr><th>${t('pokeIdle.col.stat')}</th><th>${t('pokeIdle.col.growth')}</th><th>${t('pokeIdle.col.actualLv', { level })}</th><th>${t('pokeIdle.col.projectedLv', { level: projLevel })}</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

populateCalcSpeciesDropdown();

extInstallBtn.addEventListener('click', async () => {
  const value = extInput.value.trim();
  if (!value) return;
  extError.classList.add('hidden');
  extInstallBtn.disabled = true;
  extInstallBtn.textContent = t('settings.extInstalling');
  const result = await window.api.installExtensionFromStore(value);
  extInstallBtn.disabled = false;
  extInstallBtn.textContent = t('settings.extInstall');
  if (result.ok) {
    extInput.value = '';
    renderExtensions();
  } else {
    extError.textContent = result.error || t('js.extInstallFailed');
    extError.classList.remove('hidden');
  }
});

extLoadUnpacked.addEventListener('click', async () => {
  extError.classList.add('hidden');
  const result = await window.api.loadUnpackedExtension();
  if (result.ok) {
    renderExtensions();
  } else if (result.error) {
    extError.textContent = result.error;
    extError.classList.remove('hidden');
  }
});

extOpenStore.addEventListener('click', () => {
  const active = activeAccount();
  if (active) {
    window.api.navigateAccount(active.id, 'https://chromewebstore.google.com/');
    closeSettingsModal();
  }
});

tbSettings.addEventListener('click', openSettingsModal);
btnCloseSettings.addEventListener('click', closeSettingsModal);

function activateSettingsTab(tab) {
  settingsNavItems.forEach((n) => n.classList.toggle('active', n.dataset.tab === tab));
  settingsPanes.forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
}

settingsNavItems.forEach((navItem) => {
  navItem.addEventListener('click', () => activateSettingsTab(navItem.dataset.tab));
});

setLanguage.addEventListener('change', () => {
  state.settings.language = setLanguage.value;
  applyLanguage(setLanguage.value);
  window.api.updateSettings({ language: setLanguage.value });
});

setTheme.addEventListener('change', () => {
  applyTheme(setTheme.value);
  window.api.updateSettings({ theme: setTheme.value });
});

setStartWindows.addEventListener('change', () => {
  window.api.updateSettings({ startWithWindows: setStartWindows.checked });
});

setReopenSpace.addEventListener('change', () => {
  window.api.updateSettings({ reopenLastSpace: setReopenSpace.checked });
});

setHwAccel.addEventListener('change', async () => {
  await window.api.updateSettings({ hardwareAcceleration: setHwAccel.checked });
  if (confirm(t('settings.restartConfirm'))) {
    window.api.relaunchApp();
  }
});

setProtectionLevel.addEventListener('change', () => {
  window.api.updateSettings({ protectionLevel: setProtectionLevel.value });
});

setAutoEcoEnabled.addEventListener('change', () => {
  window.api.updateSettings({
    autoEco: { enabled: setAutoEcoEnabled.checked, minutes: Number(setAutoEcoMinutes.value) || 30 }
  });
});

setAutoEcoMinutes.addEventListener('change', () => {
  const minutes = Math.min(60, Math.max(1, Number(setAutoEcoMinutes.value) || 30));
  setAutoEcoMinutes.value = String(minutes);
  window.api.updateSettings({ autoEco: { enabled: setAutoEcoEnabled.checked, minutes } });
});

setShowFpsOverlay.addEventListener('change', () => {
  window.api.updateSettings({ showFpsOverlay: setShowFpsOverlay.checked });
});

setShowPingOverlay.addEventListener('change', () => {
  window.api.updateSettings({ showPingOverlay: setShowPingOverlay.checked });
});

setShowAccountMetrics.addEventListener('change', () => {
  window.api.updateSettings({ showAccountMetrics: setShowAccountMetrics.checked });
  if (!setShowAccountMetrics.checked) metrics = {};
  render();
});

setHuntTelemetry.addEventListener('change', () => {
  window.api.updateSettings({ huntTelemetryEnabled: setHuntTelemetry.checked });
});

setTranslateMemoryPersist.addEventListener('change', () => {
  window.api.updateSettings({ translateMemoryPersist: setTranslateMemoryPersist.checked });
});

setDefaultUrl.addEventListener('change', () => {
  window.api.updateSettings({ defaultStartUrl: setDefaultUrl.value.trim() || 'https://www.google.com' });
});

function normalizedSupportPaypalUrl() {
  const url = (state.settings?.supportPaypalUrl || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function paypalHostedButtonUrl(id) {
  const clean = String(id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(clean)) return '';
  return `https://www.paypal.com/ncp/payment/${encodeURIComponent(clean)}`;
}

function extractSupportPaypalUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return '';
    if (!/(^|\.)paypal\.com$/i.test(parsed.hostname) && !/(^|\.)paypal\.me$/i.test(parsed.hostname)) return '';
    return parsed.toString();
  } catch {
    // The PayPal hosted-button embed includes hostedButtonId in a second
    // script block. We convert it to an external PayPal checkout URL instead
    // of injecting remote scripts into Nexa's chrome UI.
  }
  const hostedId =
    value.match(/hostedButtonId\s*:\s*['"]([^'"]+)['"]/i)?.[1] ||
    value.match(/hosted_button_id=([A-Za-z0-9_-]+)/i)?.[1] ||
    value.match(/data-hosted-button-id=['"]([^'"]+)['"]/i)?.[1];
  return paypalHostedButtonUrl(hostedId);
}

function openSupportPaypal() {
  const url = normalizedSupportPaypalUrl();
  if (url) {
    window.api.openExternal(url);
    return;
  }
  openSettingsModal();
  activateSettingsTab('acerca');
  setSupportPaypalUrl?.focus();
}

tbSupport?.addEventListener('click', openSupportPaypal);
supportOpenPaypal?.addEventListener('click', openSupportPaypal);
setSupportPaypalUrl?.addEventListener('change', async () => {
  const raw = setSupportPaypalUrl.value.trim();
  if (!raw) {
    await window.api.updateSettings({ supportPaypalUrl: '' });
    state.settings.supportPaypalUrl = '';
    return;
  }
  const url = extractSupportPaypalUrl(raw);
  if (!url) {
    setSupportPaypalUrl.focus();
    return;
  }
  await window.api.updateSettings({ supportPaypalUrl: url });
  state.settings.supportPaypalUrl = url;
  setSupportPaypalUrl.value = url;
});

setDefaultZoom.addEventListener('change', () => {
  window.api.updateSettings({ defaultZoom: parseFloat(setDefaultZoom.value) });
});

setDefaultLayout.addEventListener('change', () => {
  window.api.updateSettings({ newSpaceDefaultLayout: setDefaultLayout.value });
});

setAskDownload.addEventListener('change', () => {
  window.api.updateSettings({ askDownloadLocation: setAskDownload.checked });
});

setChooseFolder.addEventListener('click', async () => {
  const data = await window.api.chooseDownloadsFolder();
  setDownloadsFolderLabel.textContent = data.settings.downloadsFolder || t('settings.downloadsFolderDefault');
});

setExportSpaces.addEventListener('click', async () => {
  try {
    const result = await window.api.exportSpaces();
    if (result.ok) alert(t('spaces.exportOk'));
    else if (result.error) alert(t('spaces.exportError', { message: result.error }));
  } catch (err) {
    alert(t('spaces.exportError', { message: err.message }));
  }
});

setImportSpaces.addEventListener('click', async () => {
  try {
    const result = await window.api.importSpaces();
    if (result.ok) alert(t('spaces.importOk'));
    else if (result.error) alert(t('spaces.importError', { message: result.error }));
  } catch (err) {
    alert(t('spaces.importError', { message: err.message }));
  }
});

// ---- IPC listeners ----

window.api.onStateUpdate((data) => {
  state = data;
  applyTheme(state.settings.theme);
  document.documentElement.lang = state.settings.language || 'es';
  render();
  if (pokeIdlePanel.classList.contains('open')) renderPokeAccountSettings();
});

// ── Memory optimizer UI ──────────────────────────────────────────────────────
const OPTIMIZE_DUE_MS = 24 * 60 * 60 * 1000;

function applyOptimizeStatus({ running, lastOptimizeAt, dueIn } = {}) {
  if (!btnOptimize) return;
  if (running) {
    btnOptimize.textContent = '⚡ Optimizando…';
    btnOptimize.disabled = true;
    btnOptimize.classList.remove('optimize-due');
    return;
  }
  btnOptimize.disabled = false;
  const due = dueIn != null ? dueIn <= 0 : (!lastOptimizeAt || Date.now() - lastOptimizeAt >= OPTIMIZE_DUE_MS);
  if (due) {
    btnOptimize.textContent = '⚡ Optimizar ●';
    btnOptimize.classList.add('optimize-due');
    btnOptimize.title = 'Llevas más de 24 h sin optimizar — click para liberar RAM y caché';
  } else {
    const hoursAgo = lastOptimizeAt ? Math.floor((Date.now() - lastOptimizeAt) / 3600000) : null;
    btnOptimize.textContent = '⚡ Optimizar';
    btnOptimize.classList.remove('optimize-due');
    btnOptimize.title = hoursAgo != null
      ? `Última optimización hace ${hoursAgo}h — libera caché y RAM sin cerrar sesiones`
      : 'Optimizar memoria — libera caché y RAM sin cerrar sesiones';
  }
}

btnOptimize?.addEventListener('click', async () => {
  applyOptimizeStatus({ running: true });
  try {
    await window.api.optimizeMemory();
  } catch {}
});

window.api.onOptimizeStatusUpdate?.(applyOptimizeStatus);

// Fetch initial status on load.
window.api.getOptimizeStatus?.().then(applyOptimizeStatus).catch(() => {});
// ─────────────────────────────────────────────────────────────────────────────

window.api.onNavUpdate(({ id, url }) => {
  const account = state.accounts.find((a) => a.id === id);
  if (account) account.url = url;
  if (id === state.settings.activeAccountId && document.activeElement !== addressInput) {
    addressInput.value = url;
  }
  const panel = panelsGeometry.find((p) => p.id === id);
  if (panel) {
    panel.url = url;
    if (!dragInProgress) renderPanelHeaders();
  }
});

const findbarEl = document.getElementById('findbar');
const findbarInput = document.getElementById('findbar-input');
const findbarCount = document.getElementById('findbar-count');
const findbarPrev = document.getElementById('findbar-prev');
const findbarNext = document.getElementById('findbar-next');
const findbarClose = document.getElementById('findbar-close');
let findbarAccountId = null;

function openFindbar(id) {
  findbarAccountId = id;
  findbarEl.classList.remove('hidden');
  findbarCount.textContent = '';
  findbarInput.focus();
  findbarInput.select();
}

function closeFindbar() {
  if (findbarAccountId) window.api.stopFindInPage(findbarAccountId);
  findbarAccountId = null;
  findbarEl.classList.add('hidden');
  findbarInput.value = '';
  findbarCount.textContent = '';
}

function runFind(opts) {
  if (!findbarAccountId || !findbarInput.value) return;
  window.api.findInPage(findbarAccountId, findbarInput.value, opts);
}

findbarInput.addEventListener('input', () => runFind({ forward: true, findNext: false }));
findbarInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runFind({ forward: !e.shiftKey, findNext: true });
  else if (e.key === 'Escape') closeFindbar();
});
findbarPrev.addEventListener('click', () => runFind({ forward: false, findNext: true }));
findbarNext.addEventListener('click', () => runFind({ forward: true, findNext: true }));
findbarClose.addEventListener('click', closeFindbar);

window.api.onFindbarOpen(({ id }) => openFindbar(id));
window.api.onFindbarClose(({ id }) => {
  if (id === findbarAccountId) closeFindbar();
});
window.api.onFindbarResult(({ id, matches, activeMatchOrdinal }) => {
  if (id !== findbarAccountId) return;
  findbarCount.textContent = matches > 0 ? `${activeMatchOrdinal}/${matches}` : '0/0';
});

window.api.onShortcutSelectPanel(({ n }) => {
  const list = currentSpaceAccounts().filter((a) => !a.closed);
  const account = list[n - 1];
  if (account) window.api.activateAccount(account.id);
});

window.api.onShortcutNextPanel(() => {
  const list = currentSpaceAccounts().filter((a) => !a.closed);
  if (list.length === 0) return;
  const idx = list.findIndex((a) => a.id === state.settings.activeAccountId);
  const next = list[(idx + 1) % list.length];
  if (next) window.api.activateAccount(next.id);
});

window.api.onShortcutFocusAddress(() => {
  addressInput.focus();
  addressInput.select();
});

window.api.onShortcutOpenSettings(() => {
  if (settingsModal.classList.contains('hidden')) openSettingsModal();
});

// Same shortcuts as the main-process dispatcher (electron/main.js
// handleAccountShortcut), for when focus is on our own chrome (address bar,
// sidebar) rather than inside an account's page — that's a separate input
// context a WebContentsView keydown never reaches.
// Every entry here is a real, already-wired shortcut from the handler
// below — this list exists purely so a user can discover them, it doesn't
// define new behavior. Keep new entries in sync if a shortcut is added.
const SHORTCUTS_OVERLAY_ENTRIES = [
  ['Ctrl+1…9', 'js.shortcutSwitchAccount'],
  ['Ctrl+Tab', 'js.shortcutNextAccount'],
  ['Ctrl+N', 'js.shortcutNewAccount'],
  ['Ctrl+Shift+N', 'js.shortcutNewSpace'],
  ['Ctrl+L', 'js.shortcutAddressBar'],
  ['Ctrl+K', 'js.shortcutCommandPalette'],
  ['Ctrl+B', 'js.shortcutSidebar'],
  ['Ctrl+,', 'js.shortcutSettings'],
  ['Ctrl+W', 'js.shortcutCloseAccount'],
  ['Ctrl+Shift+T', 'js.shortcutReopenClosed'],
  ['Ctrl+R', 'js.shortcutReload'],
  ['Ctrl+M', 'js.shortcutMute'],
  ['Ctrl+D', 'js.shortcutBookmark'],
  ['Ctrl+ +/-/0', 'js.shortcutZoom']
];
let shortcutsOverlayEl = null;
function closeShortcutsOverlay() {
  if (shortcutsOverlayEl) { shortcutsOverlayEl.remove(); shortcutsOverlayEl = null; }
}
function toggleShortcutsOverlay() {
  if (shortcutsOverlayEl) { closeShortcutsOverlay(); return; }
  const overlay = document.createElement('div');
  overlay.className = 'shortcuts-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeShortcutsOverlay(); };
  const card = document.createElement('div');
  card.className = 'shortcuts-overlay-card';
  const title = document.createElement('h3');
  title.textContent = t('js.shortcutsOverlayTitle');
  card.appendChild(title);
  const list = document.createElement('div');
  list.className = 'shortcuts-overlay-list';
  SHORTCUTS_OVERLAY_ENTRIES.forEach(([keys, labelKey]) => {
    const row = document.createElement('div');
    row.className = 'shortcuts-overlay-row';
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    const label = document.createElement('span');
    label.textContent = t(labelKey);
    row.appendChild(kbd);
    row.appendChild(label);
    list.appendChild(row);
  });
  card.appendChild(list);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  shortcutsOverlayEl = overlay;
}

document.addEventListener('keydown', (e) => {
  if (e.key === '?' && !e.ctrlKey && !e.altKey) {
    const target = e.target;
    const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (!isTyping) {
      e.preventDefault();
      toggleShortcutsOverlay();
      return;
    }
  }
  if (e.key === 'Escape' && shortcutsOverlayEl) {
    closeShortcutsOverlay();
    return;
  }
});

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const key = e.key.toLowerCase();

  if (ctrl && !shift && !alt && /^[1-9]$/.test(key)) {
    e.preventDefault();
    const list = currentSpaceAccounts().filter((a) => !a.closed);
    const account = list[Number(key) - 1];
    if (account) window.api.activateAccount(account.id);
    return;
  }
  if (ctrl && !shift && !alt && key === 'tab') {
    e.preventDefault();
    const list = currentSpaceAccounts().filter((a) => !a.closed);
    if (list.length > 0) {
      const idx = list.findIndex((a) => a.id === state.settings.activeAccountId);
      const next = list[(idx + 1) % list.length];
      if (next) window.api.activateAccount(next.id);
    }
    return;
  }
  if (ctrl && shift && !alt && key === 'n') {
    e.preventDefault();
    const color = SPACE_COLORS[Math.floor(Math.random() * SPACE_COLORS.length)];
    const icon = SPACE_ICONS[Math.floor(Math.random() * SPACE_ICONS.length)];
    window.api.addSpace({ name: `Espacio ${state.spaces.length + 1}`, color, icon });
    return;
  }
  if (ctrl && !shift && !alt && key === 'n') {
    e.preventDefault();
    window.api.quickAddAccount();
    return;
  }
  if (ctrl && !shift && !alt && key === 'l') {
    e.preventDefault();
    addressInput.focus();
    addressInput.select();
    return;
  }
  if (ctrl && !shift && !alt && key === ',') {
    e.preventDefault();
    if (settingsModal.classList.contains('hidden')) openSettingsModal();
    return;
  }
  if (ctrl && !shift && !alt && key === 'k') {
    e.preventDefault();
    if (cmdkModal.classList.contains('hidden')) openCommandPalette();
    else closeCommandPalette();
    return;
  }
  if (ctrl && !shift && !alt && key === 'b') {
    e.preventDefault();
    window.api.toggleSidebar();
    return;
  }
  if (ctrl && shift && !alt && key === 't') {
    e.preventDefault();
    window.api.reopenLastClosed();
    return;
  }

  const active = activeAccount();
  if (!active) return;
  if (ctrl && shift && !alt && key === 'r') {
    e.preventDefault();
    window.api.reloadAccountHard(active.id);
  } else if (ctrl && !shift && alt && key === 'r') {
    e.preventDefault();
    currentSpaceAccounts()
      .filter((a) => !a.closed)
      .forEach((a) => window.api.reloadAccount(a.id));
  } else if (ctrl && !shift && !alt && key === 'r') {
    e.preventDefault();
    window.api.reloadAccount(active.id);
  } else if (ctrl && shift && !alt && key === 'm') {
    e.preventDefault();
    window.api.muteAllAccounts(!state.settings.allMuted);
  } else if (ctrl && !shift && !alt && key === 'm') {
    e.preventDefault();
    window.api.muteAccount(active.id, !active.muted);
  } else if (ctrl && !shift && !alt && (key === '=' || key === '+')) {
    e.preventDefault();
    window.api.setZoom(active.id, Math.min(2, Math.round(((active.zoom || 1) + 0.1) * 100) / 100));
  } else if (ctrl && !shift && !alt && key === '-') {
    e.preventDefault();
    window.api.setZoom(active.id, Math.max(0.5, Math.round(((active.zoom || 1) - 0.1) * 100) / 100));
  } else if (ctrl && !shift && !alt && key === '0') {
    e.preventDefault();
    window.api.setZoom(active.id, 1);
  } else if (ctrl && !shift && !alt && key === 'w') {
    e.preventDefault();
    window.api.closeAccount(active.id);
  } else if (ctrl && !shift && !alt && key === 'd') {
    e.preventDefault();
    if (active.url && active.url !== 'about:blank') {
      window.api.addBookmark({ title: displayName(active, currentSpaceAccounts().indexOf(active)), url: active.url });
    }
  } else if (ctrl && shift && !alt && key === 'delete') {
    e.preventDefault();
    window.api.clearSession(active.id);
  }
});

window.api.onPanelsGeometry((geometry) => {
  panelsGeometry = geometry;
  if (dragInProgress) return;
  renderPanelHeaders();
  positionWebviews();
});

// Recovery net for the "released the mouse outside the window" hazard
// described where dragInProgress/activeDragCleanup are declared: a divider
// or free-panel drag only clears dragInProgress via a `mouseup` on
// `document`, which never fires if the button comes up outside this window.
// Losing the drag that way normally also blurs the window (focus moves to
// whatever the user clicked instead), so running the drag's own onUp() here
// recovers exactly as if mouseup had fired normally -- same cleanup, same
// renderPanelHeaders()/positionWebviews() catch-up, just triggered by blur
// instead of mouseup.
window.addEventListener('blur', () => {
  if (activeDragCleanup) activeDragCleanup();
});

window.api.onWebviewReady((accountId) => {
  const el = document.getElementById('wv-' + accountId);
  if (!el) return;
  const account = state.accounts.find((a) => a.id === accountId);
  if (account && account.url && account.url !== 'about:blank') {
    el.src = account.url;
  }
});

window.api.onAccountLiveRect(({ id, contentRect }) => {
  const el = document.getElementById('wv-' + id);
  if (el) applyContentRect(el, contentRect);
});

window.api.onPipState(({ id, active }) => {
  const el = document.getElementById('wv-' + id);
  if (!el) return;
  el.classList.toggle('pip-active', active);
  positionWebviews();
});

window.api.onOpenSpaceEditor(({ id }) => {
  const space = state.spaces.find((s) => s.id === id);
  if (space) openSpaceModal(space);
});

window.api.onOpenAccountEditor(({ id }) => {
  const account = state.accounts.find((a) => a.id === id);
  if (account) openAccountModal(account);
});

const PASSWORD_ENCRYPTION_WARNING_DISMISSED_KEY = 'nexa:passwordEncryptionWarningDismissed';

async function checkPasswordEncryptionWarning() {
  if (localStorage.getItem(PASSWORD_ENCRYPTION_WARNING_DISMISSED_KEY) === '1') return;
  const available = await window.api.isPasswordEncryptionAvailable();
  if (available) return;
  document.getElementById('security-warning-modal').classList.remove('hidden');
}

document.getElementById('btn-close-security-warning').addEventListener('click', () => {
  document.getElementById('security-warning-modal').classList.add('hidden');
});
document.getElementById('btn-dismiss-security-warning').addEventListener('click', () => {
  localStorage.setItem(PASSWORD_ENCRYPTION_WARNING_DISMISSED_KEY, '1');
  document.getElementById('security-warning-modal').classList.add('hidden');
});

async function init() {
  appMeta = await window.api.getMeta();
  state = await window.api.getState();
  applyTheme(state.settings.theme);
  document.documentElement.lang = state.settings.language || 'es';
  translateStaticDom();
  render();
  if (currentSpaceAccounts().length === 0) {
    await window.api.quickAddAccount();
  }
  checkPasswordEncryptionWarning();
}

// 6s, not the original 3s — each tick's IPC round-trip triggers a real
// app.getAppMetrics() call in main.js (a CPU/memory sample across every
// open account + the GPU + utility process, not a cheap local read), and the
// sidebar's CPU/RAM readout doesn't need sub-5s freshness to be useful. This
// alone halves that specific cost app-wide, for every account, all the time.
setInterval(async () => {
  // settings.showAccountMetrics off skips the expensive app.getAppMetrics()
  // sampling (real cost proportional to account count) in favor of the
  // lighter getBlockedCounts(), which still feeds the topbar shield badge —
  // a different, still-wanted feature — without paying for CPU/RAM numbers
  // nobody's displaying.
  metrics = state.settings.showAccountMetrics === false
    ? await window.api.getBlockedCounts()
    : await window.api.getMetrics();
}, 6000);

setInterval(async () => {
  gameStats = await window.api.getGameStats();
  maybePlayGameAlertSounds();
  renderPokeIdleLivePanels();
}, 5000);

// Full render() already fires reactively off onStateUpdate (real account/space/
// settings changes) and off the geometry/drag paths above — it doesn't need its
// own ticker. What genuinely needs a per-second refresh is the status bar clock
// (renderStatusBar — the topbar's own aggregate, not any per-account UI) and,
// separately, the per-account CPU/RAM chip, game-stats row, and "open for Xm
// Ys" text — see the comment on refreshAccountMetricsRows() for why those
// specifically need their own tick independent of render(). Neither rebuilds
// the rail, sidebar list, or panel headers — this is real work avoided, not
// just deferred.
setInterval(() => {
  renderStatusBar();
  if (!listDragInProgress) refreshAccountMetricsRows();
}, 1000);

init();
