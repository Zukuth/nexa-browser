const listEl = document.getElementById('account-list');
const btnNewTab = document.getElementById('btn-new-tab');
const btnToggleAll = document.getElementById('btn-toggle-all');
const addressInput = document.getElementById('input-address');
const panelHeadersEl = document.getElementById('panel-headers');
const panelWebviewsEl = document.getElementById('panel-webviews');
const railSpacesEl = document.getElementById('rail-spaces');
const btnAddSpace = document.getElementById('btn-add-space');
const spaceNameEl = document.getElementById('space-name');
const btnEditSpace = document.getElementById('btn-edit-space');
const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
const sidebarEl = document.getElementById('sidebar');
const topbarEl = document.getElementById('topbar');
const emptyStateEl = document.getElementById('empty-state');
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
const tbFullscreen = document.getElementById('tb-fullscreen');
const tbDownloads = document.getElementById('tb-downloads');
const tbSettings = document.getElementById('tb-settings');
const tbBookmarks = document.getElementById('tb-bookmarks');
const tbSupport = document.getElementById('tb-support');

const statusSpaceInfo = document.getElementById('status-space-info');
const statusActiveAccount = document.getElementById('status-active-account');
const statusCpu = document.getElementById('status-cpu');
const statusRam = document.getElementById('status-ram');
const statusFps = document.getElementById('status-fps');
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
const huntAttackerEl = document.getElementById('hunt-attacker');
const huntKphEl = document.getElementById('hunt-kph');
const huntSortEl = document.getElementById('hunt-sort');
const huntTableWrapEl = document.getElementById('hunt-table-wrap');
const tierClanEl = document.getElementById('tier-clan');
const tierTypeEl = document.getElementById('tier-type');
const tierRefreshBtn = document.getElementById('tier-refresh');
const tierMetaEl = document.getElementById('tier-meta');
const tierListWrapEl = document.getElementById('tier-list-wrap');
const tierDetailEl = document.getElementById('tier-detail');
const pokeDropsWrapEl = document.getElementById('poke-drops-wrap');
const pokeItemPediaSearchEl = document.getElementById('poke-item-pedia-search');
const pokeItemPediaCategoryEl = document.getElementById('poke-item-pedia-category');
const pokeItemPediaEl = document.getElementById('poke-item-pedia');
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
const setAdblock = document.getElementById('set-adblock');
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

const pokeIdleSummaryEl = document.getElementById('poke-idle-summary');
const pokeSummaryChartEl = document.getElementById('poke-summary-chart');
const pokeChartCurrentEl = document.getElementById('poke-chart-current');
const pokeIdleAccountsEl = document.getElementById('poke-idle-accounts');
const pokeIdleNotableEl = document.getElementById('poke-idle-notable');
const pokeAlertEnabled = document.getElementById('poke-alert-enabled');
const pokeAlertShiny = document.getElementById('poke-alert-shiny');
const pokeAlertRare = document.getElementById('poke-alert-rare');
const pokeAlertDisconnect = document.getElementById('poke-alert-disconnect');
const pokeAlertBalls = document.getElementById('poke-alert-balls');
const pokeAlertBallsThreshold = document.getElementById('poke-alert-balls-threshold');
const pokeAlertMarketIv = document.getElementById('poke-alert-market-iv');
const pokeAlertMarketIvDesktop = document.getElementById('poke-alert-market-iv-desktop');
const pokeAlertMarketIvRareOnly = document.getElementById('poke-alert-market-iv-rare-only');
const pokeAlertMarketIvThreshold = document.getElementById('poke-alert-market-iv-threshold');
const pokeAlertMarketIvMaxPrice = document.getElementById('poke-alert-market-iv-max-price');
const marketAccountSelect = document.getElementById('market-account');
const marketCategoriesEl = document.getElementById('market-categories');
const marketIvFilterEl = document.getElementById('market-iv-filter');
const marketIvMinInput = document.getElementById('market-iv-min');
const marketStatusEl = document.getElementById('market-status');
const marketSearchInput = document.getElementById('market-search');
const marketSortSelect = document.getElementById('market-sort');
const marketRarityFilterSelect = document.getElementById('market-rarity-filter');
const marketShowEpicInput = document.getElementById('market-show-epic');
const marketShowLegendaryInput = document.getElementById('market-show-legendary');
const marketShowDollarInput = document.getElementById('market-show-dollar');
const marketShowDiamondsInput = document.getElementById('market-show-diamonds');
const marketAutoRefreshInput = document.getElementById('market-auto-refresh');
const marketRefreshSecondsInput = document.getElementById('market-refresh-seconds');
const marketDealMaxPriceInput = document.getElementById('market-deal-max-price');
const marketDealNotifyInput = document.getElementById('market-deal-notify');
const marketDealStatusEl = document.getElementById('market-deal-status');
const marketHealthEl = document.getElementById('market-health');
const marketPurchaseHistoryEl = document.getElementById('market-purchase-history');
const marketViewButtons = document.querySelectorAll('.market-view-btn');
const marketRefreshBtn = document.getElementById('market-refresh');
const marketLastUpdatedEl = document.getElementById('market-last-updated');
const marketResultsEl = document.getElementById('market-results');
const marketAlertFeedEl = document.getElementById('market-alert-feed');
const networkListEl = document.getElementById('network-list');
const marketModal = document.getElementById('market-modal');
const marketDetailBodyEl = document.getElementById('market-detail-body');
const marketDetailStatusEl = document.getElementById('market-detail-status');
const btnCloseMarketModal = document.getElementById('btn-close-market-modal');
const btnCloseMarketModal2 = document.getElementById('btn-close-market-modal-2');
const marketDetailBuyBtn = document.getElementById('market-detail-buy');

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
let editingSpaceId = null;

// Same rebuild-mid-drag hazard as dragInProgress above, but for the sidebar
// account list / space rail (native HTML5 drag-and-drop reorder) — those two
// lists get torn down and rebuilt (`innerHTML = ''`) by render()'s 1s
// interval, which would cancel a drag in progress since the dragged element
// is a live DOM node the browser is tracking.
let listDragInProgress = false;
let draggedAccountId = null;
let draggedSpaceId = null;

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
  return div.innerHTML;
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
  }
  if (!shortcutsModal.classList.contains('hidden')) renderShortcutsList();
  if (!bookmarksModal.classList.contains('hidden')) renderBookmarksList();
  if (!downloadsModal.classList.contains('hidden')) renderDownloadsList();
  if (pokeIdlePanel.classList.contains('open')) {
    renderPokeIdle();
    renderPokeIdleNotable();
    renderPokeIdleTeam();
    renderPokeIdleDrops();
    renderPokeAccountSettings();
    renderTierList();
    if (huntTableCache) renderHuntTable();
  }
  if (!cmdkModal.classList.contains('hidden')) renderCmdkResults();
}

function formatDuration(ms) {
  const seconds = Math.max(Math.floor(ms / 1000), 0);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function render() {
  reconcileWebviews();
  // Positions any <webview> just created above. Needed here too (not just
  // in onPanelsGeometry) because panels:geometry can arrive before the
  // account list does at startup — if it does, positionWebviews() runs
  // against an empty #panel-webviews and nothing re-triggers it later,
  // leaving every panel stuck hidden until the next unrelated geometry
  // change (a resize, a layout switch, ...).
  positionWebviews();
  if (!listDragInProgress) renderRail();

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

  const spaceAccounts = currentSpaceAccounts();
  if (!listDragInProgress) {
  listEl.innerHTML = '';
  spaceAccounts.forEach((account, i) => {
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

    const m = metrics[account.id];
    if (!account.closed && m) {
      const metricsRow = document.createElement('div');
      metricsRow.className = 'account-metrics-row';
      metricsRow.innerHTML = `<span>CPU ${m.cpu.toFixed(1)}%</span><span>RAM ${m.memoryMB} MB</span>`;
      item.append(metricsRow);
    }

    // Fase B: only present for accounts on poke.idleworld.online — getGameStats()
    // returns null for every other account, same shape as getMetrics() returning
    // nothing for a closed account above.
    const gs = gameStats[account.id];
    if (!account.closed && gs) {
      const gameRow = document.createElement('div');
      gameRow.className = 'account-game-stats-row';
      gameRow.title = gs.connected ? t('js.gameConnected') : t('js.gameDisconnected');
      const dot = gs.connected ? '🟢' : '⚪';
      const wallet = gs.wallet || {};
      const trustedGoldSource = ['visual-shop', 'visual-hud', 'visual', 'adjusted'].includes(wallet.goldSource);
      const walletHtml = wallet.gold != null && trustedGoldSource
        ? `<span>${marketCurrencySymbol('GOLD')}${formatCompactNumber(wallet.gold)}</span>`
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

    item.onclick = () => window.api.activateAccount(account.id);
    item.oncontextmenu = (e) => {
      e.preventDefault();
      window.api.showAccountMenu(account.id);
    };
    listEl.appendChild(item);
  });
  }

  const allClosed = spaceAccounts.length > 0 && spaceAccounts.every((a) => a.closed);
  btnToggleAll.classList.toggle('all-closed', allClosed);
  btnToggleAll.title = allClosed ? t('sidebar.openAll') : t('sidebar.closeAll');

  const hasOpenAccount = spaceAccounts.some((a) => !a.closed);
  emptyStateEl.classList.toggle('hidden', hasOpenAccount);

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

  const adBlockOn = state.settings.adBlockEnabled !== false;
  tbShield.classList.toggle('muted', adBlockOn);
  tbShield.title = adBlockOn ? t('js.adblockOn') : t('js.adblockOff');
  const activeBlocked = active ? metrics[active.id]?.blocked || 0 : 0;
  tbShieldCount.textContent = activeBlocked > 0 ? String(activeBlocked) : '';

  if (!dragInProgress) renderPanelHeaders();
  renderStatusBar();
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

let fpsFrames = 0;
let fpsLastCheck = performance.now();
function fpsLoop(now) {
  fpsFrames += 1;
  if (now - fpsLastCheck >= 1000) {
    statusFps.textContent = `${fpsFrames} FPS`;
    fpsFrames = 0;
    fpsLastCheck = now;
  }
  requestAnimationFrame(fpsLoop);
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
    // speed regardless of paint visibility.
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
  });
}

// Shows/positions every <webview> the current layout has a cell for, and
// hides (without removing) every other open account's <webview>.
function positionWebviews() {
  const visibleIds = new Set(panelsGeometry.map((p) => p.id));
  Array.from(panelWebviewsEl.children).forEach((el) => {
    if (!visibleIds.has(el.dataset.id)) el.classList.add('hidden-panel');
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
  dragInProgress = true;
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

    window.api.setLiveRect(group[pairIndex].id, rectA);
    window.api.setLiveRect(group[pairIndex + 1].id, rectB);
    if (headerA) { headerA.style.left = rectA.x + 'px'; headerA.style.top = rectA.y + 'px'; headerA.style.width = rectA.width + 'px'; headerA.style.height = headerH + 'px'; }
    if (headerB) { headerB.style.left = rectB.x + 'px'; headerB.style.top = rectB.y + 'px'; headerB.style.width = rectB.width + 'px'; headerB.style.height = headerH + 'px'; }
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragInProgress = false;
    window.api.showViews();
    renderPanelHeaders(); // catch up on any geometry that arrived mid-drag and was held back
    positionWebviews();
    commitSplit(group, field, currentSizes);
  }

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
  dragInProgress = true;
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
    dragInProgress = false;
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
  [pokeSettingsEcoEl, pokeSettingsEcoBenchmarkBtn, pokeSettingsHideChatEl, pokeSettingsHideGameBarEl, pokeSettingsSellLockEl, pokeSettingsSellLockItemPickerEl, pokeSettingsSellLockItemAddEl]
    .forEach((el) => { if (el) el.disabled = !hasAccount; });
  if (!account) {
    renderPokeSettingsLockItems(null);
    return;
  }
  pokeSettingsEcoEl.checked = !!account.ecoMode;
  pokeSettingsHideChatEl.checked = !!account.hideChat;
  pokeSettingsHideGameBarEl.checked = !!account.hideGameBar;
  pokeSettingsSellLockEl.checked = !!account.sellLockOn;
  await populatePokeSettingsItemPicker();
  renderPokeSettingsLockItems(account);
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
});

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

  const adBlockOn = state.settings.adBlockEnabled !== false;
  actions.push(
    {
      icon: '➕', label: t('cmdk.newAccount'), keywords: 'nueva cuenta agregar add account',
      run: () => window.api.quickAddAccount()
    },
    {
      icon: adBlockOn ? '🛡️' : '🚫',
      label: adBlockOn ? t('cmdk.disableAdblock') : t('cmdk.enableAdblock'),
      keywords: 'adblock bloqueador anuncios rastreadores',
      run: () => window.api.updateSettings({ adBlockEnabled: !adBlockOn })
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
  setAdblock.checked = s.adBlockEnabled !== false;
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

  extError.classList.add('hidden');
  extInput.value = '';
  renderExtensions();
  renderPlugins();
  renderPasswords();
  renderNetworkTab();

  settingsModal.classList.remove('hidden');
  if (wasHidden) pushModal();
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  popModal();
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

function loadPokeIdleAlertFields() {
  const cfg = state.settings.pokeIdleAlerts || {};
  pokeAlertEnabled.checked = cfg.enabled !== false;
  pokeAlertShiny.checked = cfg.shiny !== false;
  pokeAlertRare.checked = cfg.rare !== false;
  pokeAlertDisconnect.checked = cfg.disconnect !== false;
  pokeAlertBalls.checked = cfg.ballsLow !== false;
  pokeAlertBallsThreshold.value = cfg.ballsThreshold ?? 20;
  pokeAlertMarketIv.checked = !!cfg.marketIv;
  if (pokeAlertMarketIvDesktop) pokeAlertMarketIvDesktop.checked = cfg.marketIvDesktop !== false;
  if (pokeAlertMarketIvRareOnly) pokeAlertMarketIvRareOnly.checked = cfg.marketIvRareOnly !== false;
  pokeAlertMarketIvThreshold.value = cfg.marketMinIv ?? 150;
  if (pokeAlertMarketIvMaxPrice) pokeAlertMarketIvMaxPrice.value = cfg.marketIvMaxPrice ?? 0;
}

function savePokeIdleAlertFields() {
  window.api.updateSettings({
    pokeIdleAlerts: {
      enabled: pokeAlertEnabled.checked,
      shiny: pokeAlertShiny.checked,
      rare: pokeAlertRare.checked,
      disconnect: pokeAlertDisconnect.checked,
      ballsLow: pokeAlertBalls.checked,
      ballsThreshold: Math.max(0, Number(pokeAlertBallsThreshold.value) || 0),
      marketIv: pokeAlertMarketIv.checked,
      marketIvDesktop: pokeAlertMarketIvDesktop ? pokeAlertMarketIvDesktop.checked : true,
      marketIvRareOnly: pokeAlertMarketIvRareOnly ? pokeAlertMarketIvRareOnly.checked : true,
      marketMinIv: Math.max(0, Number(pokeAlertMarketIvThreshold.value) || 0),
      marketIvMaxPrice: Math.max(0, Number(pokeAlertMarketIvMaxPrice?.value) || 0)
    }
  });
}

[pokeAlertEnabled, pokeAlertShiny, pokeAlertRare, pokeAlertDisconnect, pokeAlertBalls, pokeAlertMarketIv, pokeAlertMarketIvDesktop, pokeAlertMarketIvRareOnly].forEach((el) => {
  if (!el) return;
  el.addEventListener('change', savePokeIdleAlertFields);
});
pokeAlertBallsThreshold.addEventListener('change', savePokeIdleAlertFields);
pokeAlertMarketIvThreshold.addEventListener('change', savePokeIdleAlertFields);
pokeAlertMarketIvMaxPrice?.addEventListener('change', savePokeIdleAlertFields);

// Mirrors RARITY_THRESHOLDS in game-telemetry.js, low to high — used both
// for coloring (below) and to rank-filter "Capturas destacadas" so a flood
// of Comum/Incomum catches doesn't bury the ones actually worth looking at.
const POKE_RARITY_ORDER = ['Fraca', 'Comum', 'Incomum', 'Rara', 'Épica', 'Lendária', 'Mythic', 'Ancient', 'Divine'];
const POKE_NOTABLE_MIN_RANK = POKE_RARITY_ORDER.indexOf('Épica');

const POKE_RARITY_COLORS = {
  'Fraca': '#6b7280',
  'Comum': '#9ca3af',
  'Incomum': '#51cf66',
  'Rara': '#4f8cff',
  'Épica': '#a855f7',
  'Lendária': '#ffb020',
  'Mythic': '#f43f5e',
  'Ancient': '#34d3c4',
  'Divine': '#ff5fa8'
};

const POKE_RARITY_THRESHOLDS = [
  [1.0, 'Fraca'], [1.1, 'Comum'], [1.3, 'Incomum'], [1.5, 'Rara'],
  [1.7, 'Épica'], [2.0, 'Lendária'], [3.0, 'Mythic'], [4.0, 'Ancient']
];
const POKE_NOTABLE_VISIBLE_LIMIT = 30;
const POKE_NOTABLE_CACHE_KEY = 'nexa:poke-notable-captures:v1';
let pokeNotableCache = [];

function loadPokeNotableCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POKE_NOTABLE_CACHE_KEY) || '[]');
    pokeNotableCache = Array.isArray(parsed) ? parsed.slice(0, POKE_NOTABLE_VISIBLE_LIMIT) : [];
  } catch {
    pokeNotableCache = [];
  }
}

function savePokeNotableCache() {
  try {
    localStorage.setItem(POKE_NOTABLE_CACHE_KEY, JSON.stringify(pokeNotableCache.slice(0, POKE_NOTABLE_VISIBLE_LIMIT)));
  } catch {
  }
}

function notableCaptureKey(c) {
  return [
    c.accountId || '',
    c.speciesId ?? '',
    c.name || '',
    c.level ?? '',
    c.ivTotal ?? '',
    c.rarity || '',
    c.at || ''
  ].join(':');
}

function rarityFromQualityClient(q) {
  if (q == null) return '';
  const quality = Number(q);
  if (!Number.isFinite(quality)) return '';
  for (const [max, label] of POKE_RARITY_THRESHOLDS) {
    if (quality < max) return label;
  }
  return 'Divine';
}

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

function normalizePediaText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function itemPediaDropChance(chance) {
  const n = Number(chance);
  if (!Number.isFinite(n) || n <= 0) return '';
  return (n / 1000).toFixed(n >= 1000 ? 1 : 2).replace(/\.?0+$/, '') + '%';
}

function buildItemPediaRows() {
  const items = itemCatalogCache || [];
  const creatures = creatureCatalogCache || [];
  const dropsByName = new Map();
  for (const creature of creatures) {
    for (const drop of creature.loot || []) {
      if (!drop || !drop.name) continue;
      const key = normalizePediaText(drop.name);
      if (!dropsByName.has(key)) dropsByName.set(key, []);
      dropsByName.get(key).push({
        pokemon: creature.name,
        speciesId: creature.pokeId,
        level: creature.huntLevel ?? creature.level ?? null,
        qty: drop.minCount && drop.maxCount && drop.minCount !== drop.maxCount
          ? `${drop.minCount}-${drop.maxCount}`
          : `${drop.minCount || drop.maxCount || 1}`,
        chance: itemPediaDropChance(drop.chance)
      });
    }
  }
  return items.map((item) => {
    const drops = (dropsByName.get(normalizePediaText(item.name)) || [])
      .sort((a, b) => (Number(b.chance.replace('%', '')) || 0) - (Number(a.chance.replace('%', '')) || 0));
    return {
      ...item,
      category: item.category || item.type || item.kind || 'Item',
      icon: item.icon || item.iconUrl || null,
      drops
    };
  });
}

async function renderPokeItemPedia() {
  if (!pokeItemPediaEl) return;
  pokeItemPediaEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.marketLoading')}</div>`;
  await Promise.all([ensureItemCatalogRenderer(), ensureCreatureCatalogRenderer()]).catch(() => {});
  const rows = buildItemPediaRows();
  const categories = ['all', ...Array.from(new Set(rows.map((item) => item.category).filter(Boolean))).sort()];
  const categorySig = categories.join('|');
  if (pokeItemPediaCategoryEl && pokeItemPediaCategoryEl.dataset.categories !== categorySig) {
    const previous = pokeItemPediaCategoryEl.value || 'all';
    pokeItemPediaCategoryEl.innerHTML = categories.map((cat) =>
      `<option value="${escapeHtmlClient(cat)}">${escapeHtmlClient(cat === 'all' ? t('pokeIdle.pokedexItemsAll') : cat)}</option>`
    ).join('');
    pokeItemPediaCategoryEl.value = categories.includes(previous) ? previous : 'all';
    pokeItemPediaCategoryEl.dataset.categories = categorySig;
  }
  const query = normalizePediaText(pokeItemPediaSearchEl?.value || '');
  const category = pokeItemPediaCategoryEl?.value || 'all';
  const filtered = rows.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    if (!query) return true;
    const haystack = [
      item.name,
      item.category,
      item.description,
      ...(item.drops || []).map((drop) => drop.pokemon)
    ].map(normalizePediaText).join(' ');
    return haystack.includes(query);
  }).slice(0, 80);

  if (!filtered.length) {
    pokeItemPediaEl.innerHTML = `<div class="market-empty-state">${t('pokeIdle.pokedexItemsEmpty')}</div>`;
    return;
  }

  pokeItemPediaEl.innerHTML = filtered.map((item) => {
    const drops = item.drops && item.drops.length
      ? item.drops.slice(0, 6).map((drop) => `
        <span class="poke-pedia-drop">
          <img src="${escapeHtmlClient(pokeSpriteUrl(drop.speciesId, drop.pokemon))}" loading="lazy" alt="" onerror="window.pokeSpriteFallback(this,'')" />
          <b>${escapeHtmlClient(drop.pokemon)}</b>
          ${drop.chance ? `<em>${escapeHtmlClient(drop.chance)}</em>` : ''}
        </span>
      `).join('')
      : `<span class="settings-hint">${t('pokeIdle.pokedexItemsNoDrops')}</span>`;
    return `
      <article class="poke-pedia-card">
        <div class="poke-pedia-icon">${item.icon ? `<img src="${escapeHtmlClient(item.icon)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" />` : '▣'}</div>
        <div class="poke-pedia-main">
          <div class="poke-pedia-title">
            <strong>${escapeHtmlClient(item.name || `Item #${item.id}`)}</strong>
            <span>${escapeHtmlClient(item.category || 'Item')}</span>
            ${item.npcPrice != null ? `<b class="poke-pedia-price">$${formatCompactNumber(item.npcPrice)}</b>` : ''}
          </div>
          ${item.description ? `<p>${escapeHtmlClient(item.description)}</p>` : ''}
          <div class="poke-pedia-drops">${drops}</div>
        </div>
      </article>
    `;
  }).join('');
}

function dropsTableHtml(lootBreakdown) {
  if (!lootBreakdown || !lootBreakdown.length) {
    return `<div class="settings-hint">${t('pokeIdle.dropsEmpty')}</div>`;
  }
  const rows = lootBreakdown.map((d) => {
    const icon = d.icon
      ? `<img class="poke-drop-icon" loading="lazy" src="${d.icon}" onerror="this.style.visibility='hidden'" alt="" />`
      : '<span class="poke-drop-icon poke-drop-icon-empty"></span>';
    return `<tr><td><div class="poke-hunt-row-name">${icon}${escapeHtmlClient(d.name)}</div></td><td>×${formatCompactNumber(d.qty)}</td><td>$${formatCompactNumber(d.value)}</td></tr>`;
  }).join('');
  return `<table class="poke-calc-table"><thead><tr><th>${t('pokeIdle.col.item')}</th><th>${t('pokeIdle.col.qty')}</th><th>${t('pokeIdle.col.npcValue')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPokeIdleDrops() {
  if (!pokeDropsWrapEl) return;
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id]);
  if (tracked.length === 0) {
    pokeDropsWrapEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.noAccounts')}</div>`;
    return;
  }
  if (tracked.length === 1) {
    pokeDropsWrapEl.innerHTML = dropsTableHtml(gameStats[tracked[0].id].lootBreakdown);
    return;
  }
  pokeDropsWrapEl.innerHTML = tracked.map((a, ai) =>
    `<div class="settings-subheading">${escapeHtmlClient(displayName(a, ai))}</div>${dropsTableHtml(gameStats[a.id].lootBreakdown)}`
  ).join('');
}

function renderPokeIdleNotable() {
  const el = pokeIdleNotableEl;
  if (!el) return;
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id]);
  const fresh = [];
  tracked.forEach((account, i) => {
    const gs = gameStats[account.id];
    (gs.notableCaptures || []).forEach((c) => fresh.push({ ...c, accountId: account.id, accountName: displayName(account, i) }));
  });
  // Only Épica and above make the cut (shiny always does too, regardless of
  // its stat rarity — a shiny Comum is still worth seeing) so a run of
  // ordinary catches doesn't push out the ones actually worth a look.
  const notable = fresh.filter((c) => c.shiny || POKE_RARITY_ORDER.indexOf(c.rarity) >= POKE_NOTABLE_MIN_RANK);
  if (notable.length) {
    const merged = new Map(pokeNotableCache.map((c) => [notableCaptureKey(c), c]));
    notable.forEach((c) => merged.set(notableCaptureKey(c), c));
    pokeNotableCache = [...merged.values()]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, POKE_NOTABLE_VISIBLE_LIMIT);
    savePokeNotableCache();
  }
  const top = pokeNotableCache.slice(0, POKE_NOTABLE_VISIBLE_LIMIT);

  if (top.length === 0) {
    el.innerHTML = `<div class="settings-hint">${t('pokeIdle.capturasEmpty')}</div>`;
    return;
  }

  el.innerHTML = '';
  const showAccountName = tracked.length > 1 || top.some((c) => c.accountName);
  top.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'poke-notable-card';
    const color = POKE_RARITY_COLORS[c.rarity] || '#ffd84d';
    card.style.setProperty('--rarity-color', color);

    const img = document.createElement('img');
    img.className = 'poke-notable-sprite';
    img.loading = 'lazy';
    img.alt = c.name || '';
    applySpriteWithFallback(img, c.speciesId, c.name);

    const info = document.createElement('div');
    info.className = 'poke-notable-info';
    const quality = typeof c.quality === 'number' ? c.quality.toFixed(3) : '?';
    info.innerHTML = `
      <div class="poke-notable-name">${c.shiny ? '✨' : ''} ${escapeHtmlClient(c.name || '?')} <span style="color:var(--muted); font-weight:400;">Lv.${c.level ?? '?'}</span></div>
      <div class="poke-notable-meta">${showAccountName ? escapeHtmlClient(c.accountName) + ' · ' : ''}Quality ${quality} · IV ${c.ivTotal ?? '?'}/192</div>
    `;

    const rarity = document.createElement('div');
    rarity.className = 'poke-notable-rarity';
    rarity.textContent = c.rarity || (c.shiny ? t('pokeIdle.shiny') : '');

    const time = document.createElement('div');
    time.className = 'poke-notable-time';
    time.textContent = formatRelativeTime(c.at);

    card.append(img, info, rarity, time);
    el.appendChild(card);
  });
}

// Rolling client-side history for the "tendencia" chart — the telemetry
// backend only ever hands over the current rate, not a time series, so this
// keeps its own trailing window. renderPokeIdle() (and so this) actually
// gets called far more often than gameStats itself refreshes — once a
// second via the general render() loop, on top of the dedicated 5s
// gameStats poll — so a new *point* is only recorded when enough time has
// passed since the last one; every other call just redraws the same
// history (cheap, keeps the canvas in sync with e.g. a resize) without
// flooding it with duplicate samples. ~40 points at that ~5s cadence is
// roughly the last 3-4 minutes.
const POKE_CHART_MAX_POINTS = 40;
const POKE_CHART_SAMPLE_MS = 4500;
let pokeKillsHistory = [];
let pokeKillsHistoryLastPushAt = 0;

function drawPokeSummaryChart(value) {
  if (!pokeSummaryChartEl) return;
  const now = Date.now();
  if (now - pokeKillsHistoryLastPushAt >= POKE_CHART_SAMPLE_MS) {
    pokeKillsHistoryLastPushAt = now;
    pokeKillsHistory.push(value);
    if (pokeKillsHistory.length > POKE_CHART_MAX_POINTS) pokeKillsHistory.shift();
  }
  if (pokeChartCurrentEl) pokeChartCurrentEl.textContent = formatCompactNumber(value) + ' ' + t('pokeIdle.killsPerHour');

  const canvas = pokeSummaryChartEl;
  const cssWidth = canvas.clientWidth || 300;
  const cssHeight = canvas.clientHeight || 120;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const points = pokeKillsHistory;
  const padTop = 18, padBottom = 26, padX = 38;
  const plotW = cssWidth - padX * 2;
  const plotH = cssHeight - padTop - padBottom;
  const maxV = Math.max(...points, 1);
  const minV = Math.min(...points, 0);
  const range = Math.max(maxV - minV, 1);

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#4f8cff';
  const cyan = styles.getPropertyValue('--info').trim() || '#22d3ee';
  const border = styles.getPropertyValue('--border').trim() || '#333';
  const muted = styles.getPropertyValue('--muted').trim() || '#888';

  const panelGradient = ctx.createLinearGradient(0, 0, cssWidth, cssHeight);
  panelGradient.addColorStop(0, 'rgba(79,140,255,0.10)');
  panelGradient.addColorStop(1, 'rgba(34,211,238,0.02)');
  ctx.fillStyle = panelGradient;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Gridlines: horizontal scale plus vertical time guides.
  ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';
  ctx.fillStyle = muted;
  for (let i = 0; i <= 3; i++) {
    const y = padTop + (plotH / 3) * i;
    ctx.strokeStyle = border;
    ctx.globalAlpha = i === 3 ? 0.65 : 0.38;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(cssWidth - 12, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const label = formatCompactNumber(Math.round(maxV - (range / 3) * i));
    ctx.fillText(label, 8, y + 3);
  }
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = cyan;
  for (let i = 1; i <= 4; i++) {
    const x = padX + (plotW / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (points.length < 2) return;

  const stepX = plotW / (POKE_CHART_MAX_POINTS - 1);
  const startIdx = POKE_CHART_MAX_POINTS - points.length;
  const xAt = (i) => padX + (startIdx + i) * stepX;
  const yAt = (v) => padTop + plotH - ((v - minV) / range) * plotH;

  // Build the curve once so the glow, fill and latest-point marker align.
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(points[0]));
  for (let i = 1; i < points.length; i++) {
    const midX = (xAt(i - 1) + xAt(i)) / 2;
    const midY = (yAt(points[i - 1]) + yAt(points[i])) / 2;
    ctx.quadraticCurveTo(xAt(i - 1), yAt(points[i - 1]), midX, midY);
  }
  ctx.lineTo(xAt(points.length - 1), yAt(points[points.length - 1]));
  const lineGradient = ctx.createLinearGradient(padX, 0, cssWidth - padX, 0);
  lineGradient.addColorStop(0, cyan);
  lineGradient.addColorStop(1, accent);
  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Gradient fill under the line, down to the plot's bottom edge.
  ctx.lineTo(xAt(points.length - 1), padTop + plotH);
  ctx.lineTo(xAt(0), padTop + plotH);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  gradient.addColorStop(0, 'rgba(79,140,255,0.28)');
  gradient.addColorStop(1, 'rgba(34,211,238,0.00)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Highlight the latest point.
  const lastX = xAt(points.length - 1);
  const lastY = yAt(points[points.length - 1]);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(79,140,255,0.22)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
}

function renderPokeIdle() {
  if (!pokeIdleSummaryEl || !pokeIdleAccountsEl) return;
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id]);

  if (tracked.length === 0) {
    pokeIdleSummaryEl.innerHTML = '';
    pokeIdleAccountsEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.noAccounts')}</div>`;
    return;
  }

  let totalKills = 0, totalXp = 0, totalGold = 0, totalCaptures = 0, totalShiny = 0;
  tracked.forEach((a) => {
    const gs = gameStats[a.id];
    totalKills += gs.killsPerHour || 0;
    totalXp += gs.xpPerHour || 0;
    totalGold += gs.goldPerHour || 0;
    totalCaptures += gs.capturesPerHour || 0;
    totalShiny += gs.shinyCaught || 0;
  });

  pokeIdleSummaryEl.innerHTML = `
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalKills)}</div><div class="poke-summary-label">${t('pokeIdle.killsPerHour')}</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalXp)}</div><div class="poke-summary-label">${t('pokeIdle.xpPerHour')}</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalGold)}</div><div class="poke-summary-label">${t('pokeIdle.goldPerHour')}</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalCaptures)}</div><div class="poke-summary-label">${t('pokeIdle.capturesPerHour')}</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">✨ ${totalShiny}</div><div class="poke-summary-label">${t('pokeIdle.shiny')}</div></div>
  `;
  drawPokeSummaryChart(totalKills);

  pokeIdleAccountsEl.innerHTML = '';
  tracked.forEach((a) => {
    const gs = gameStats[a.id];
    const item = document.createElement('div');
    item.className = 'poke-account-item';
    const dot = gs.connected ? '🟢' : '⚪';
    item.innerHTML = `
      <span class="poke-account-name">${dot} ${escapeHtmlClient(a.name || t('field.name'))}</span>
      <span class="poke-account-stats">
        <span>${formatCompactNumber(gs.killsPerHour)} ${t('pokeIdle.killsPerHour')}</span>
        <span>${formatCompactNumber(gs.xpPerHour)} ${t('pokeIdle.xpPerHour')}</span>
        <span>${formatCompactNumber(gs.goldPerHour)} ${t('pokeIdle.goldPerHour')}</span>
        <span>${formatCompactNumber(gs.capturesPerHour)} ${t('pokeIdle.capturesPerHour')}</span>
        ${gs.shinyCaught ? `<span>✨ ${gs.shinyCaught}</span>` : ''}
      </span>
    `;
    pokeIdleAccountsEl.appendChild(item);
  });
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

pokeItemPediaSearchEl?.addEventListener('input', renderPokeItemPedia);
pokeItemPediaCategoryEl?.addEventListener('change', renderPokeItemPedia);

// The panel is a docked drawer, not a modal: no pushModal()/hideViews()
// here on purpose, since the whole point is being able to keep clicking
// the account underneath while it's open. All 8 sections render once on
// open — there's no lazy per-tab render anymore since nothing is hidden.
function openPokeIdlePanel() {
  pokeIdlePanel.classList.add('open');
  if (![...pokeNavItems].some((item) => item.classList.contains('active'))) {
    pokeNavItems[0]?.classList.add('active');
  }
  renderPokeIdle();
  renderPokeIdleNotable();
  renderPokeIdleTeam();
  renderPokeIdleDrops();
  renderPokeItemPedia();
  renderPokeAccountSettings();
  loadPokeIdleAlertFields();
  renderMarket();
  populateCalcSourceDropdown();
  populateHuntAttackerDropdown();
  runHuntTable();
  populateTierFilters().then(renderTierList);
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
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id] && (gameStats[a.id].team || []).length);

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
        `<span class="poke-team-level">Lv.${p.level ?? '?'}${showAccountName ? ' · ' + escapeHtmlClient(displayName(account, ai)) : ''}</span>` +
        typeBadges +
        `<button type="button" class="poke-team-lock${locked ? ' locked' : ''}" title="${locked ? t('pokeIdle.sellLockRemove') : t('pokeIdle.sellLockAdd')}" data-poke-id="${p.id}" data-account-id="${account.id}">${locked ? '🔒' : '🔓'}</button>`;

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
      ].map(([label, value]) => `<div class="poke-stat-cell"><span>${label}</span><span>${value ?? '?'}</span></div>`).join('');

      const moves = document.createElement('div');
      moves.className = 'poke-moves';
      const moveList = p.moves || [];
      moves.innerHTML = moveList.length
        ? moveList.slice(0, 8).map((m) => `<span class="poke-move-chip">${typeBadgeHtml(m.type)}${escapeHtmlClient(m.name)} · ${m.power ?? '?'} <span class="poke-move-lvl">Lv.${m.learnLevel ?? 1}</span></span>`).join('')
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

// ---- Market (compra directa, sin viajar al NPC) ----

let marketCategory = 'All';

function populateMarketAccountDropdown() {
  // Index must come from the account's position among ALL of the space's
  // accounts (matching the "Pestaña N" numbering shown in the sidebar), not
  // its position in the filtered open-only list — that shifted numbering
  // (e.g. account #2 becomes index 0 once #1 is filtered out) mislabeled the
  // dropdown as "Pestaña 1" for what was actually the account in slot 2.
  const spaceAccounts = currentSpaceAccounts();
  const openAccounts = spaceAccounts.filter((a) => !a.closed);
  const prev = marketAccountSelect.value;
  marketAccountSelect.innerHTML = openAccounts
    .map((a) => `<option value="${a.id}">${escapeHtmlClient(displayName(a, spaceAccounts.indexOf(a)))}</option>`)
    .join('');
  if (openAccounts.some((a) => a.id === prev)) marketAccountSelect.value = prev;
}

// ---- Calculadora Growth/IV (fórmula real portada de pokemon-360.web.app) ----

let marketViewMode = 'grid';
let marketListingsCache = [];
let marketRenderedListings = new Map();
let marketLastUpdatedAt = 0;
let marketSelectedListing = null;
let marketSelectedAccountId = null;
let marketLoadToken = 0;
let marketAutoRefreshTimer = null;
let marketLoadInFlight = false;
let marketPurchaseHistory = [];
const marketPriceBook = new Map();
const marketSeenDealIds = new Set();
const notifiedGameEventKeys = new Set();
const notifiedMarketAlertKeys = new Set();
let marketSoundPollBusy = false;
const MARKET_PREFS_DEFAULTS = {
  rarityFilterVersion: 2,
  showEpic: false,
  showLegendary: false,
  showDollar: true,
  showDiamonds: true,
  autoRefresh: false,
  refreshSeconds: 15,
  dealMaxPrice: 0,
  dealNotify: true
};
let marketPrefs = { ...MARKET_PREFS_DEFAULTS };

const MARKET_BALL_STYLE_BY_NAME = {
  'poke ball': ['#ef4444', '#f8fafc'],
  'pokeball': ['#ef4444', '#f8fafc'],
  'great ball': ['#2563eb', '#f8fafc'],
  'ultra ball': ['#111827', '#facc15'],
  'master ball': ['#7c3aed', '#f472b6'],
  'idle ball': ['#0f172a', '#60a5fa'],
  'premier ball': ['#f8fafc', '#ef4444'],
  'dive ball': ['#0ea5e9', '#f8fafc'],
  'dusk ball': ['#111827', '#22c55e'],
  'fast ball': ['#facc15', '#ef4444'],
  'friend ball': ['#22c55e', '#f8fafc'],
  'heal ball': ['#f9a8d4', '#f8fafc'],
  'heavy ball': ['#334155', '#facc15'],
  'level ball': ['#facc15', '#111827'],
  'love ball': ['#f472b6', '#f8fafc'],
  'lure ball': ['#0ea5e9', '#ef4444'],
  'luxury ball': ['#111827', '#facc15'],
  'moon ball': ['#1e293b', '#facc15'],
  'nest ball': ['#84cc16', '#f8fafc'],
  'net ball': ['#22d3ee', '#111827'],
  'quick ball': ['#38bdf8', '#facc15'],
  'repeat ball': ['#ef4444', '#facc15'],
  'safari ball': ['#84cc16', '#92400e'],
  'timer ball': ['#f8fafc', '#ef4444']
};

function marketBallSpriteDataUri(name) {
  const key = normalizeTextForFilter(name);
  const [top, accent] = MARKET_BALL_STYLE_BY_NAME[key] || ['#4f8cff', '#f8fafc'];
  const label = escapeHtmlClient(String(name || 'Ball').split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <defs>
      <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000" flood-opacity=".35"/>
      </filter>
    </defs>
    <circle cx="48" cy="48" r="38" fill="${top}" filter="url(#s)"/>
    <path d="M11 48h74" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/>
    <path d="M16 52a34 34 0 0 0 64 0Z" fill="${accent}"/>
    <circle cx="48" cy="48" r="15" fill="#0f172a"/>
    <circle cx="48" cy="48" r="9" fill="#f8fafc"/>
    <text x="48" y="84" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11" font-weight="700" fill="#e5e7eb">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function syncMarketPrefsFromState() {
  const stored = (state.settings && state.settings.pokeIdleMarketPrefs) || {};
  const hasCurrentRarityPrefs = stored.rarityFilterVersion === MARKET_PREFS_DEFAULTS.rarityFilterVersion;
  marketPrefs = {
    ...MARKET_PREFS_DEFAULTS,
    ...stored,
    rarityFilterVersion: MARKET_PREFS_DEFAULTS.rarityFilterVersion,
    showEpic: hasCurrentRarityPrefs ? stored.showEpic ?? MARKET_PREFS_DEFAULTS.showEpic : MARKET_PREFS_DEFAULTS.showEpic,
    showLegendary: hasCurrentRarityPrefs ? stored.showLegendary ?? MARKET_PREFS_DEFAULTS.showLegendary : MARKET_PREFS_DEFAULTS.showLegendary,
    showDollar: stored.showDollar ?? MARKET_PREFS_DEFAULTS.showDollar,
    showDiamonds: stored.showDiamonds ?? MARKET_PREFS_DEFAULTS.showDiamonds,
    autoRefresh: stored.autoRefresh ?? MARKET_PREFS_DEFAULTS.autoRefresh,
    refreshSeconds: Math.min(120, Math.max(5, Number(stored.refreshSeconds ?? MARKET_PREFS_DEFAULTS.refreshSeconds) || MARKET_PREFS_DEFAULTS.refreshSeconds)),
    dealMaxPrice: Math.max(0, Number(stored.dealMaxPrice ?? MARKET_PREFS_DEFAULTS.dealMaxPrice) || 0),
    dealNotify: stored.dealNotify ?? MARKET_PREFS_DEFAULTS.dealNotify
  };
  if (!marketPrefs.showDollar && !marketPrefs.showDiamonds) {
    marketPrefs.showDollar = MARKET_PREFS_DEFAULTS.showDollar;
    marketPrefs.showDiamonds = MARKET_PREFS_DEFAULTS.showDiamonds;
    persistMarketPrefs().catch(() => {});
  }
}

function persistMarketPrefs() {
  return window.api.updateSettings({ pokeIdleMarketPrefs: marketPrefs });
}

function setMarketPrefs(next) {
  marketPrefs = { ...marketPrefs, ...next };
  if (!marketPrefs.showDollar && !marketPrefs.showDiamonds) {
    marketPrefs.showDollar = true;
    marketPrefs.showDiamonds = true;
  }
  marketPrefs.refreshSeconds = Math.min(120, Math.max(5, Number(marketPrefs.refreshSeconds) || MARKET_PREFS_DEFAULTS.refreshSeconds));
  marketPrefs.dealMaxPrice = Math.max(0, Number(marketPrefs.dealMaxPrice) || 0);
  syncMarketFilterControls();
  syncMarketAutoRefreshTimer();
  persistMarketPrefs().catch(() => {});
  renderMarketResults();
  renderMarketAlertFeed();
}

function normalizeTextForFilter(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function marketRarityKeyFromText(value) {
  const rarity = normalizeTextForFilter(value);
  if (!rarity) return '';
  if (rarity.includes('divine')) return 'divine';
  if (rarity.includes('ancient')) return 'ancient';
  if (rarity.includes('mythic')) return 'mythic';
  if (rarity.includes('legend')) return 'legendary';
  if (rarity.includes('lendar')) return 'legendary';
  if (rarity.includes('epic')) return 'epic';
  if (rarity.includes('epica')) return 'epic';
  if (rarity.includes('rare')) return 'rare';
  if (rarity.includes('rara')) return 'rare';
  if (rarity.includes('incom')) return 'uncommon';
  if (rarity.includes('comum')) return 'common';
  if (rarity.includes('common')) return 'common';
  return rarity;
}

function marketRaritySortKey(listing) {
  return marketRarityKeyFromText(marketListingRarity(listing));
}

function marketCategoryKeyFromText(value) {
  const text = normalizeTextForFilter(value);
  if (!text || text === 'all') return 'all';
  if (text.includes('pok') && text.includes('mon')) return 'pokemon';
  if (text.includes('stone')) return 'stones';
  if (text.includes('ball')) return 'balls';
  if (text.includes('diamond')) return 'diamonds';
  if (text.includes('item')) return 'items';
  return text;
}

function marketListingCategoryKey(listing) {
  if (!listing || typeof listing !== 'object') return '';
  const rawValues = [listing.itemCategory, listing.kind, listing.category, listing.type, listing.slot].filter(Boolean);
  for (const value of rawValues) {
    const key = marketCategoryKeyFromText(value);
    if (key && key !== 'all') return key;
  }
  if (marketListingSpeciesId(listing) != null) return 'pokemon';
  const name = normalizeTextForFilter(marketListingName(listing));
  if (name.includes('stone')) return 'stones';
  if (name.includes('ball')) return 'balls';
  if (name.includes('diamond')) return 'diamonds';
  return 'items';
}

function marketListingMatchesCategory(listing) {
  const selected = marketCategoryKeyFromText(marketCategory);
  if (!selected || selected === 'all') return true;
  const key = marketListingCategoryKey(listing);
  if (selected === 'items') return !['pokemon', 'stones', 'balls', 'diamonds'].includes(key);
  return key === selected;
}

function marketPokemonAllowedByRarity(listing) {
  const key = marketRaritySortKey(listing);
  const allowsEpic = !!marketPrefs.showEpic;
  const allowsLegendary = !!marketPrefs.showLegendary;
  const selected = [];
  if (allowsEpic) selected.push('epic', 'mythic');
  if (allowsLegendary) selected.push('legendary', 'ancient', 'divine');
  if (!selected.length) return true;
  return selected.includes(key);
}

function marketListingName(listing) {
  if (!listing || typeof listing !== 'object') return t('pokeIdle.marketUnknownListing') || 'Market listing';
  const speciesName = listing.speciesName || listing.pokemonName || listing.creatureName || listing.species?.name;
  const itemName = listing.itemName || listing.productName || listing.item?.name;
  const raw = listing.name || listing.title || speciesName || itemName || listing.label || listing.id;
  return String(raw || t('pokeIdle.marketUnknownListing') || 'Market listing');
}

function marketListingIv(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const direct = listing.iv ?? listing.ivTotal ?? listing.totalIv ?? listing.totalIV ?? listing.ivsTotal ?? listing.ivSum;
  if (direct != null && direct !== '') {
    const value = Number(direct);
    return Number.isFinite(value) ? value : null;
  }
  const stats = listing.ivs || listing.ivStats || listing.statsIv || listing.stats?.iv || listing.pokemon?.ivs;
  if (!stats || typeof stats !== 'object') return null;
  const values = Object.values(stats).map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function marketListingPrice(listing) {
  if (!listing || typeof listing !== 'object') return 0;
  const price = listing.price ?? listing.amount ?? listing.cost ?? 0;
  return Number.isFinite(Number(price)) ? Number(price) : 0;
}

function marketListingOwner(listing) {
  if (!listing || typeof listing !== 'object') return '';
  return listing.ownerName || listing.seller || listing.accountName || listing.author || listing.user || '';
}

function marketListingCategory(listing) {
  if (!listing || typeof listing !== 'object') return '';
  return listing.itemCategory || listing.kind || listing.category || listing.type || listing.slot || '';
}

function marketListingPublished(listing) {
  if (!listing || typeof listing !== 'object') return null;
  return listing.publishedAt || listing.createdAt || listing.listedAt || listing.time || null;
}

function marketListingExpires(listing) {
  if (!listing || typeof listing !== 'object') return null;
  return listing.expiresAt || listing.expireAt || listing.endsAt || listing.until || null;
}

function marketListingDescription(listing) {
  if (!listing || typeof listing !== 'object') return '';
  return listing.description || listing.desc || listing.note || listing.itemDescription || '';
}

function marketListingQuality(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const raw = listing.quality ?? listing.qualityValue ?? listing.pokemonQuality ?? listing.pokemon?.quality ?? listing.species?.quality ?? null;
  if (raw == null || raw === '') return null;
  const quality = Number(raw);
  return Number.isFinite(quality) ? quality : null;
}

function marketListingRarity(listing) {
  if (!listing || typeof listing !== 'object') return '';
  const fromQuality = rarityFromQualityClient(marketListingQuality(listing));
  if (fromQuality) return fromQuality;
  const explicit = listing.rarity || listing.rank || listing.tier || listing.qualityLabel ||
    listing.qualityName || listing.pokemon?.rarity || listing.pokemon?.qualityLabel || listing.pokemon?.qualityName || '';
  if (explicit) return explicit;
  return '';
}

function marketListingSpeciesId(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const raw = listing.pokeId ?? listing.speciesId ?? listing.dexId ?? listing.species?.pokeId ?? null;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw) || null;
}

function marketCreatureForListing(listing) {
  const speciesId = marketListingSpeciesId(listing);
  if (creatureCatalogCache && speciesId != null) {
    const byId = creatureCatalogCache.find((c) => Number(c.pokeId) === Number(speciesId));
    if (byId) return byId;
  }
  const name = normalizeTextForFilter(marketListingName(listing));
  if (creatureCatalogCache && name) {
    const exact = creatureCatalogCache.find((c) => normalizeTextForFilter(c.name) === name);
    if (exact) return exact;
  }
  return null;
}

function marketListingSprite(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const name = marketListingName(listing);
  const speciesId = marketListingSpeciesId(listing);
  const categoryKey = marketListingCategoryKey(listing);
  const direct = listing.icon || listing.iconUrl || listing.sprite || listing.spriteUrl || listing.image || null;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const isPokemon = categoryKey === 'pokemon' || speciesId != null;
  if (isPokemon) {
    return pokeSpriteGifUrl(speciesId, name) || pokeSpriteUrl(speciesId, name) || null;
  }
  if (categoryKey === 'balls') {
    return marketBallSpriteDataUri(name);
  }
  const normalizedName = normalizeTextForFilter(name);
  const nameTokens = normalizedName.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
  const item = (itemCatalogCache || []).find((it) => {
    const candidate = normalizeTextForFilter(it.name);
    const candidateTokens = candidate.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
    return Number(it.id) === Number(listing.itemId) ||
      Number(it.id) === Number(listing.productId) ||
      Number(it.id) === Number(listing.item?.id) ||
      candidate === normalizedName ||
      candidate.includes(normalizedName) ||
      normalizedName.includes(candidate) ||
      (nameTokens.length >= 2 && nameTokens.every((token) => candidateTokens.includes(token)));
  });
  return item ? item.icon || null : null;
}

function applyMarketImageFallback(img) {
  if (!img) return;
  img.addEventListener('error', () => {
    const fallbackSrc = img.dataset.fallbackSrc;
    if (fallbackSrc && img.src !== fallbackSrc) {
      img.src = fallbackSrc;
      img.removeAttribute('data-fallback-src');
      return;
    }
    const isBall = img.dataset.marketCategory === 'balls';
    const fallback = document.createElement('div');
    fallback.className = `market-card-fallback ${isBall ? 'market-card-ball-fallback' : ''}`;
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = isBall ? '●' : '◎';
    if (img.parentNode) {
      img.parentNode.replaceChild(fallback, img);
    } else {
      img.remove();
    }
  }, { once: true });
}

function marketListingCurrency(listing) {
  if (!listing || typeof listing !== 'object') return 'GOLD';
  const raw = String(listing.currency || listing.paymentCurrency || listing.moneyType || 'GOLD').trim();
  const upper = raw.toUpperCase();
  if (upper.includes('DIAM')) return 'DIAMONDS';
  if (upper.includes('GOLD') || upper.includes('DOLLAR') || upper === '$') return 'GOLD';
  return upper || 'GOLD';
}

function marketCurrencySymbol(currency) {
  if (currency === 'DIAMONDS') return '♦';
  return '$';
}

function marketCurrencyLabel(currency) {
  const lang = (state.settings && state.settings.language) || 'es';
  if (currency === 'DIAMONDS') return lang.startsWith('en') ? 'DIAMONDS' : 'DIAMANTES';
  return lang.startsWith('en') ? 'DOLLARS' : 'DÓLARES';
}

function marketPriceKey(listing) {
  return [
    marketListingCategoryKey(listing),
    normalizeTextForFilter(marketListingName(listing)),
    normalizeTextForFilter(marketListingRarity(listing)),
    marketListingCurrency(listing)
  ].join('|');
}

function marketPurchasePriceKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const rarity = entry.rarity || rarityFromQualityClient(entry.quality);
  return [
    normalizeTextForFilter(entry.kind || (entry.speciesId != null ? 'pokemon' : 'item')),
    normalizeTextForFilter(entry.name || ''),
    normalizeTextForFilter(rarity || ''),
    String(entry.currency || 'GOLD').trim().toUpperCase()
  ].join('|');
}

function rememberMarketPrices(listings) {
  for (const listing of listings || []) {
    const price = marketListingPrice(listing);
    if (!Number.isFinite(price) || price <= 0) continue;
    const key = marketPriceKey(listing);
    const values = marketPriceBook.get(key) || [];
    values.push(price);
    if (values.length > 160) values.shift();
    marketPriceBook.set(key, values);
  }
}

function rememberMarketPurchasePrices(entries) {
  for (const entry of entries || []) {
    const price = Number(entry.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const key = marketPurchasePriceKey(entry);
    if (!key) continue;
    const values = marketPriceBook.get(key) || [];
    values.push(price);
    if (values.length > 160) values.shift();
    marketPriceBook.set(key, values);
  }
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function marketPriceSignal(listing) {
  const values = marketPriceBook.get(marketPriceKey(listing)) || [];
  if (values.length < 3) return null;
  const baseline = median(values);
  const price = marketListingPrice(listing);
  if (!baseline || !price) return null;
  const ratio = price / baseline;
  const pct = Math.round((ratio - 1) * 100);
  const absPct = Math.abs(pct);
  const context = t(pct >= 0 ? 'pokeIdle.marketPriceAboveTypical' : 'pokeIdle.marketPriceBelowTypical', {
    pct: absPct,
    price: `${marketCurrencySymbol(marketListingCurrency(listing))}${formatCompactNumber(baseline)}`,
    n: values.length
  });
  if (ratio <= 0.75) return { type: 'cheap', label: `${t('pokeIdle.marketPriceCheap')} -${absPct}%`, baseline, pct, sample: values.length, context };
  if (ratio >= 1.35) return { type: 'expensive', label: `${t('pokeIdle.marketPriceExpensive')} +${absPct}%`, baseline, pct, sample: values.length, context };
  return { type: 'normal', label: `${t('pokeIdle.marketPriceNormal')} ${pct >= 0 ? '+' : '-'}${absPct}%`, baseline, pct, sample: values.length, context };
}

function marketListingStableId(listing) {
  return String(listing?.listingId ?? listing?.marketId ?? listing?.id ?? listing?.refId ?? marketListingRenderKey(listing));
}

function marketListingMatchesDeal(listing) {
  const maxPrice = Number(marketPrefs.dealMaxPrice) || 0;
  if (!maxPrice || marketListingPrice(listing) > maxPrice) return false;
  return shouldShowMarketListing(listing, { includeQuery: true });
}

function scanMarketDeals(listings) {
  if (!marketDealStatusEl) return;
  const maxPrice = Number(marketPrefs.dealMaxPrice) || 0;
  if (!maxPrice) {
    marketDealStatusEl.textContent = t('pokeIdle.marketDealDisabled');
    return;
  }
  const deals = (listings || []).filter(marketListingMatchesDeal);
  marketDealStatusEl.textContent = deals.length
    ? t('pokeIdle.marketDealFound').replace('{n}', deals.length)
    : t('pokeIdle.marketDealWaiting').replace('{price}', `${marketCurrencySymbol('GOLD')}${formatCompactNumber(maxPrice)}`);
  if (!marketPrefs.dealNotify) return;
  const fresh = deals.find((listing) => {
    const id = marketListingStableId(listing);
    if (marketSeenDealIds.has(id)) return false;
    marketSeenDealIds.add(id);
    return true;
  });
  if (fresh && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Nexa Market Sniper', {
      body: `${marketListingName(fresh)} · ${marketCurrencySymbol(marketListingCurrency(fresh))}${formatCompactNumber(marketListingPrice(fresh))}`
    });
  }
}

function marketListingSearchBlob(listing) {
  if (!listing || typeof listing !== 'object') return '';
  const blob = [
    marketListingName(listing),
    marketListingCategory(listing),
    marketListingRarity(listing),
    marketListingOwner(listing),
    marketListingDescription(listing),
    String(marketListingPrice(listing)),
    String(marketListingIv(listing) ?? ''),
    listing.rarity || '',
    listing.race || '',
    listing.species || ''
  ].join(' ');
  return normalizeTextForFilter(blob);
}

function marketListingSortTime(listing) {
  const ts = marketListingPublished(listing);
  const parsed = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketListingMetaLine(listing) {
  const parts = [];
  const owner = marketListingOwner(listing);
  const published = marketListingPublished(listing);
  const expires = marketListingExpires(listing);
  if (owner) parts.push(`${t('pokeIdle.marketSeller')}: ${owner}`);
  if (published) parts.push(`${t('pokeIdle.marketPublished')}: ${formatRelativeTime(published)}`);
  if (expires) parts.push(`${t('pokeIdle.marketExpires')}: ${formatRelativeTime(expires)}`);
  return parts;
}

function marketListingRenderKey(listing, index = 0) {
  return [
    index,
    listing && (listing.refId ?? ''),
    listing && (listing.listingId ?? listing.marketId ?? listing.id ?? ''),
    marketListingName(listing),
    marketListingPrice(listing),
    marketListingIv(listing) ?? '',
    marketListingCurrency(listing)
  ].map((part) => String(part)).join('|');
}

function cloneMarketListing(listing) {
  if (!listing || typeof listing !== 'object') return listing;
  if (typeof structuredClone === 'function') return structuredClone(listing);
  return JSON.parse(JSON.stringify(listing));
}

function shouldShowMarketListing(listing, { includeQuery = true } = {}) {
  if (!listing || typeof listing !== 'object') return false;
  if (!marketListingMatchesCategory(listing)) return false;
  const isPokemonListing = /pok[eé]mon/i.test(marketListingCategory(listing)) || marketListingSpeciesId(listing) != null;
  if (!marketPrefs.showDollar || !marketPrefs.showDiamonds) {
    const currency = marketListingCurrency(listing);
    if (currency === 'DIAMONDS' && !marketPrefs.showDiamonds) return false;
    if (currency !== 'DIAMONDS' && !marketPrefs.showDollar) return false;
  }
  if (isPokemonListing) {
    if (!marketPokemonAllowedByRarity(listing)) return false;
    if (marketRarityFilterSelect && marketRarityFilterSelect.value !== 'all') {
      if (marketRaritySortKey(listing) !== marketRarityKeyFromText(marketRarityFilterSelect.value)) return false;
    }
  }
  if (includeQuery) {
    const query = normalizeTextForFilter(marketSearchInput.value);
    if (query && !marketListingSearchBlob(listing).includes(query)) return false;
    const minIv = marketCategory === 'Pokémon' ? Math.max(0, Number(marketIvMinInput.value) || 0) : 0;
    if (minIv > 0 && (marketListingIv(listing) ?? 0) < minIv) return false;
  }
  return true;
}

function getMarketFilteredListings() {
  let listings = marketListingsCache.slice().filter((listing) => shouldShowMarketListing(listing, { includeQuery: true }));

  const sortKey = marketSortSelect.value || 'recent';
  const decorated = listings.map((listing, index) => ({ listing, index }));
  decorated.sort((a, b) => {
    if (sortKey === 'name-asc') return marketListingName(a.listing).localeCompare(marketListingName(b.listing)) || a.index - b.index;
    if (sortKey === 'price-asc') return marketListingPrice(a.listing) - marketListingPrice(b.listing) || a.index - b.index;
    if (sortKey === 'price-desc') return marketListingPrice(b.listing) - marketListingPrice(a.listing) || a.index - b.index;
    if (sortKey === 'iv-desc') return (marketListingIv(b.listing) ?? -1) - (marketListingIv(a.listing) ?? -1) || a.index - b.index;
    if (sortKey === 'oldest') return marketListingSortTime(a.listing) - marketListingSortTime(b.listing) || a.index - b.index;
    return marketListingSortTime(b.listing) - marketListingSortTime(a.listing) || a.index - b.index;
  });
  return decorated.map((item) => item.listing);
}

function syncMarketViewButtons() {
  marketViewButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === marketViewMode);
  });
}

function syncMarketFilterControls() {
  const isPokemonCategory = marketCategory === 'Pokémon';
  if (marketShowEpicInput) marketShowEpicInput.checked = !!marketPrefs.showEpic;
  if (marketShowLegendaryInput) marketShowLegendaryInput.checked = !!marketPrefs.showLegendary;
  if (marketShowDollarInput) marketShowDollarInput.checked = !!marketPrefs.showDollar;
  if (marketShowDiamondsInput) marketShowDiamondsInput.checked = !!marketPrefs.showDiamonds;
  if (marketAutoRefreshInput) marketAutoRefreshInput.checked = !!marketPrefs.autoRefresh;
  if (marketRefreshSecondsInput) marketRefreshSecondsInput.value = marketPrefs.refreshSeconds ?? MARKET_PREFS_DEFAULTS.refreshSeconds;
  if (marketDealMaxPriceInput) marketDealMaxPriceInput.value = marketPrefs.dealMaxPrice ?? 0;
  if (marketDealNotifyInput) marketDealNotifyInput.checked = marketPrefs.dealNotify !== false;
  if (marketRarityFilterSelect && !marketRarityFilterSelect.value) marketRarityFilterSelect.value = 'all';
  const rarityRow = marketRarityFilterSelect && marketRarityFilterSelect.closest('.settings-row');
  const epicRow = marketShowEpicInput && marketShowEpicInput.closest('.settings-row');
  const legendaryRow = marketShowLegendaryInput && marketShowLegendaryInput.closest('.settings-row');
  if (rarityRow) rarityRow.style.display = isPokemonCategory ? 'flex' : 'none';
  if (epicRow) epicRow.style.display = isPokemonCategory ? 'flex' : 'none';
  if (legendaryRow) legendaryRow.style.display = isPokemonCategory ? 'flex' : 'none';
}

function syncMarketAutoRefreshTimer() {
  if (marketAutoRefreshTimer) {
    clearInterval(marketAutoRefreshTimer);
    marketAutoRefreshTimer = null;
  }
  if (!marketPrefs.autoRefresh) return;
  const seconds = Math.min(120, Math.max(5, Number(marketPrefs.refreshSeconds) || 15));
  marketAutoRefreshTimer = setInterval(() => {
    if (!pokeIdlePanel.classList.contains('open')) return;
    loadMarketListings(true);
  }, seconds * 1000);
}

function renderMarketHealth() {
  if (!marketHealthEl) return;
  const accounts = state.accounts.filter((account) => !account.closed);
  if (!accounts.length) {
    marketHealthEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.marketHealthEmpty')}</div>`;
    return;
  }
  marketHealthEl.innerHTML = accounts.map((account) => {
    const stats = gameStats[account.id];
    const accountIndex = state.accounts.findIndex((item) => item.id === account.id);
    const connected = !!(stats && stats.connected);
    const status = connected ? t('pokeIdle.marketHealthOnline') : t('pokeIdle.marketHealthQuiet');
    const lastEvent = stats && stats.lastEvent ? stats.lastEvent.type : '—';
    const wallet = stats && stats.wallet ? stats.wallet : {};
    const trustedGoldSource = ['visual-shop', 'visual-hud', 'visual', 'adjusted'].includes(wallet.goldSource);
    const gold = wallet.gold != null && trustedGoldSource ? `${marketCurrencySymbol('GOLD')}${formatCompactNumber(wallet.gold)}` : '—';
    return `<div class="market-health-row ${connected ? 'online' : 'quiet'}">
      <span class="market-health-dot"></span>
      <div class="market-health-main">
        <span>${escapeHtmlClient(displayName(account, accountIndex))}</span>
        <small>${escapeHtmlClient(status)} · ${escapeHtmlClient(lastEvent)}</small>
        <div class="market-wallet-row" title="${escapeHtmlClient(t('pokeIdle.marketWalletUpdated'))}">
          <span class="market-wallet-chip market-wallet-gold">${escapeHtmlClient(gold)} <em>${escapeHtmlClient(t('pokeIdle.marketWalletGold'))}</em></span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function renderMarketPurchaseHistory() {
  if (!marketPurchaseHistoryEl) return;
  try {
    marketPurchaseHistory = await window.api.getMarketPurchaseHistory();
    rememberMarketPurchasePrices(marketPurchaseHistory);
  } catch {
    marketPurchaseHistory = [];
  }
  if (!marketPurchaseHistory.length) {
    marketPurchaseHistoryEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.marketHistoryEmpty')}</div>`;
    return;
  }
  marketPurchaseHistoryEl.innerHTML = marketPurchaseHistory.slice(0, 12).map((entry) => {
    const accountIdx = state.accounts.findIndex((a) => a.id === entry.accountId);
    const account = accountIdx >= 0 ? state.accounts[accountIdx] : null;
    const tabLabel = account ? displayName(account, accountIdx) : (entry.accountId ? `Pestaña ?` : 'Cuenta');
    const currency = marketCurrencySymbol(entry.currency);
    return `<div class="market-history-row">
      <div>
        <strong>${escapeHtmlClient(entry.name || 'Market listing')}</strong>
        <span>${escapeHtmlClient(tabLabel)} · ${escapeHtmlClient(entry.kind || 'market')}</span>
      </div>
      <div class="market-history-price">${currency}${formatCompactNumber(entry.price || 0)}</div>
      <time>${escapeHtmlClient(formatRelativeTime(entry.at))}</time>
    </div>`;
  }).join('');
}

function arrangeMarketFilters() {
  if (!marketResultsEl || document.getElementById('market-filter-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'market-filter-panel';
  panel.className = 'market-filter-panel';
  const rows = [
    marketShowEpicInput && marketShowEpicInput.closest('.settings-row'),
    marketShowLegendaryInput && marketShowLegendaryInput.closest('.settings-row'),
    marketShowDollarInput && marketShowDollarInput.closest('.settings-row'),
    marketShowDiamondsInput && marketShowDiamondsInput.closest('.settings-row'),
    marketRarityFilterSelect && marketRarityFilterSelect.closest('.settings-row')
  ].filter(Boolean);
  rows.forEach((row) => {
    row.classList.add('market-filter-row');
    panel.appendChild(row);
  });
  marketResultsEl.parentNode.insertBefore(panel, marketResultsEl);
}

function renderMarketCard(listing, { onBuy, onOpen, listingKey } = {}) {
  const card = document.createElement('article');
  card.className = `poke-market-card ${marketViewMode === 'list' ? 'market-card-list' : 'market-card-grid'}`;
  if (listingKey) card.dataset.listingKey = listingKey;
  const img = marketListingSprite(listing);
  const categoryKey = marketListingCategoryKey(listing);
  const fallbackImg = categoryKey === 'balls'
    ? marketBallSpriteDataUri(marketListingName(listing))
    : (listing.iconUrl || listing.image || listing.spriteUrl || listing.icon || '');
  const fallbackLetterRaw = marketListingCategoryKey(listing) === 'balls'
    ? '●'
    : (marketListingName(listing).trim().charAt(0).toUpperCase() || '◎');
  const fallbackLetter = escapeHtmlClient(fallbackLetterRaw);
  const iv = marketListingIv(listing);
  const price = marketListingPrice(listing);
  const currency = marketListingCurrency(listing);
  const currencySymbol = marketCurrencySymbol(currency);
  const currencyLabel = marketCurrencyLabel(currency);
  const priceSignal = marketPriceSignal(listing);
  const category = marketListingCategory(listing);
  const rarity = marketListingRarity(listing);
  const meta = marketListingMetaLine(listing);
  const owner = marketListingOwner(listing);
  card.innerHTML = `
    <button type="button" class="market-card-open" data-open>${t('pokeIdle.marketOpenDetails')}</button>
    ${img ? `<img src="${escapeHtmlClient(img)}" data-market-category="${escapeHtmlClient(categoryKey)}" ${fallbackImg && fallbackImg !== img ? `data-fallback-src="${escapeHtmlClient(fallbackImg)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="market-card-fallback ${marketListingCategoryKey(listing) === 'balls' ? 'market-card-ball-fallback' : ''}" aria-hidden="true">${fallbackLetter}</div>`}
    <div class="market-card-copy">
      <div class="market-name">${escapeHtmlClient(marketListingName(listing))}</div>
      <div class="market-card-row">
        ${category ? `<span class="market-chip">${escapeHtmlClient(category)}</span>` : ''}
        ${rarity ? `<span class="market-chip market-chip-rarity">${escapeHtmlClient(rarity)}</span>` : ''}
        ${owner ? `<span class="market-chip market-chip-muted">${escapeHtmlClient(owner)}</span>` : ''}
        ${priceSignal ? `<span class="market-chip market-chip-price-${escapeHtmlClient(priceSignal.type)}" title="${escapeHtmlClient(priceSignal.context)}">${escapeHtmlClient(priceSignal.label)}</span>` : ''}
      </div>
      ${iv != null ? `<div class="market-iv">IV ${iv}/192</div>` : ''}
      ${meta.length ? `<div class="market-meta-line">${meta.map((item) => `<span>${escapeHtmlClient(item)}</span>`).join('')}</div>` : ''}
      <div class="market-price">${currencySymbol}${formatCompactNumber(price)} <span class="market-currency-label">${escapeHtmlClient(currencyLabel)}</span></div>
    </div>
    <div class="market-card-actions">
      <button type="button" data-open>${t('pokeIdle.marketOpenDetails')}</button>
      <button type="button" data-buy ${listingKey ? `data-listing-key="${escapeHtmlClient(listingKey)}"` : ''}>${t('pokeIdle.marketBuy')}</button>
    </div>
  `;
  applyMarketImageFallback(card.querySelector('img'));

  card.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => {
    (onOpen || openMarketListing)(listing);
  }));

  const buyBtn = card.querySelector('[data-buy]');
  buyBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const key = event.currentTarget.dataset.listingKey || event.currentTarget.closest('.poke-market-card')?.dataset.listingKey || '';
    const targetListing = key && marketRenderedListings.has(key)
      ? cloneMarketListing(marketRenderedListings.get(key))
      : cloneMarketListing(listing);
    buyBtn.disabled = true;
    buyBtn.textContent = t('pokeIdle.marketBuying');
    marketStatusEl.textContent = `${t('pokeIdle.marketBuying')} ${marketListingName(targetListing)} · ${marketCurrencySymbol(marketListingCurrency(targetListing))}${formatCompactNumber(marketListingPrice(targetListing))}`;
    const res = await (onBuy ? onBuy(targetListing) : buyMarketListing(targetListing));
    if (res && res.ok) {
      markMarketCardBought(card, buyBtn);
      await syncMarketInventoryAfterBuy(targetListing, marketAccountSelect.value, res);
      await renderMarketPurchaseHistory();
      await new Promise((resolve) => setTimeout(resolve, 700));
      await loadMarketListings(true);
    } else {
      buyBtn.disabled = false;
      buyBtn.textContent = t('pokeIdle.marketBuy');
      marketStatusEl.textContent = (res && (res.error || (res.payload && res.payload.message))) || t('pokeIdle.marketBuyFailed');
    }
  });

  card.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    (onOpen || openMarketListing)(listing);
  });

  return card;
}

function renderMarketDetail(listing, accountId) {
  const price = marketListingPrice(listing);
  const iv = marketListingIv(listing);
  const img = marketListingSprite(listing);
  const categoryKey = marketListingCategoryKey(listing);
  const fallbackImg = categoryKey === 'balls'
    ? marketBallSpriteDataUri(marketListingName(listing))
    : (listing.iconUrl || listing.image || listing.spriteUrl || listing.icon || '');
  const rarity = marketListingRarity(listing);
  const quality = marketListingQuality(listing);
  const speciesId = marketListingSpeciesId(listing);
  const currency = marketListingCurrency(listing);
  const currencySymbol = marketCurrencySymbol(currency);
  const currencyLabel = marketCurrencyLabel(currency);
  const priceSignal = marketPriceSignal(listing);
  const rows = [
    [t('pokeIdle.marketSeller'), marketListingOwner(listing) || '—'],
    [t('pokeIdle.marketPublished'), marketListingPublished(listing) ? formatRelativeTime(marketListingPublished(listing)) : '—'],
    [t('pokeIdle.marketExpires'), marketListingExpires(listing) ? formatRelativeTime(marketListingExpires(listing)) : '—'],
    [t('pokeIdle.marketCurrency'), currencyLabel],
    ['ID', listing.id || '—'],
    ['Listing ID', listing.listingId || listing.marketId || '—'],
    ['Ref ID', listing.refId || '—'],
    ['Item ID', listing.itemId || listing.productId || listing.item?.id || '—'],
    ['Stock', listing.quantity ?? '—'],
    ['Kind', marketListingCategory(listing) || '—'],
    ['Rarity', rarity || '—'],
    ['Quality', quality != null ? quality : '—'],
    ['Species', speciesId || '—']
  ];
  marketDetailBodyEl.innerHTML = `
    <div class="market-detail-hero">
      <div class="market-detail-media">
        ${img ? `<img src="${escapeHtmlClient(img)}" data-market-category="${escapeHtmlClient(categoryKey)}" ${fallbackImg && fallbackImg !== img ? `data-fallback-src="${escapeHtmlClient(fallbackImg)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="market-card-fallback market-detail-fallback ${categoryKey === 'balls' ? 'market-card-ball-fallback' : ''}" aria-hidden="true">${categoryKey === 'balls' ? '●' : '◎'}</div>`}
      </div>
      <div class="market-detail-copy">
        <div class="market-detail-title">${escapeHtmlClient(marketListingName(listing))}</div>
        <div class="market-detail-price">${currencySymbol}${formatCompactNumber(price)} <span class="market-currency-label">${escapeHtmlClient(currencyLabel)}</span></div>
        ${priceSignal ? `<div class="market-detail-price-signal market-chip-price-${escapeHtmlClient(priceSignal.type)}" title="${escapeHtmlClient(priceSignal.context)}">${escapeHtmlClient(priceSignal.label)} · ${escapeHtmlClient(priceSignal.context)}</div>` : ''}
        ${rarity ? `<div class="market-detail-rarity">${escapeHtmlClient(rarity)}</div>` : ''}
        ${iv != null ? `<div class="market-detail-iv">IV ${iv}/192</div>` : ''}
        ${marketListingDescription(listing) ? `<div class="market-detail-desc">${escapeHtmlClient(marketListingDescription(listing))}</div>` : `<div class="market-detail-desc market-detail-empty">${t('pokeIdle.marketNoResults')}</div>`}
      </div>
    </div>
    <dl class="market-detail-grid">
      ${rows.map(([label, value]) => `<div><dt>${escapeHtmlClient(label)}</dt><dd>${escapeHtmlClient(value)}</dd></div>`).join('')}
    </dl>
  `;
  applyMarketImageFallback(marketDetailBodyEl.querySelector('img'));
  marketDetailBuyBtn.disabled = !accountId;
  marketDetailBuyBtn.textContent = accountId ? t('pokeIdle.marketBuy') : t('pokeIdle.marketNoAccount');
  marketDetailStatusEl.textContent = accountId ? '' : t('pokeIdle.marketNoAccount');
}

function openMarketListing(listing, accountId = marketAccountSelect.value) {
  marketSelectedListing = listing;
  marketSelectedAccountId = accountId;
  renderMarketDetail(listing, accountId);
  marketModal.classList.remove('hidden');
}

function closeMarketModal() {
  marketModal.classList.add('hidden');
  marketSelectedListing = null;
  marketSelectedAccountId = null;
}

async function buyMarketListing(listing, accountId = marketAccountSelect.value) {
  const targetAccountId = accountId || marketAccountSelect.value;
  if (!targetAccountId) return { ok: false, error: t('pokeIdle.marketNoAccount') };
  return window.api.buyMarketListing(targetAccountId, listing);
}

function renderPokeIdleLivePanels() {
  if (!pokeIdlePanel.classList.contains('open')) return;
  maybePlayGameAlertSounds();
  renderPokeIdle();
  renderPokeIdleNotable();
  renderPokeIdleTeam();
  renderPokeIdleDrops();
  renderMarketAlertFeed();
  renderMarketHealth();
}

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

async function maybePlayMarketAlertSounds() {
  const cfg = state.settings?.pokeIdleAlerts || {};
  if (!cfg.enabled || !cfg.marketIv || marketSoundPollBusy) return;
  marketSoundPollBusy = true;
  try {
    const feed = await window.api.getMarketAlertFeed();
    const entries = Array.isArray(feed) ? feed : [];
    for (const entry of entries) {
      const key = `${entry.accountId || ''}:${entry.at || ''}:${marketListingStableId(entry.listing)}`;
      if (notifiedMarketAlertKeys.has(key)) continue;
      notifiedMarketAlertKeys.add(key);
      if (notifiedMarketAlertKeys.size > 200) notifiedMarketAlertKeys.delete(notifiedMarketAlertKeys.values().next().value);
    }
  } catch {
  } finally {
    marketSoundPollBusy = false;
  }
}

async function refreshGameStatsNow() {
  gameStats = await window.api.getGameStats();
  renderPokeIdleLivePanels();
  return gameStats;
}

async function syncMarketInventoryAfterBuy(listing, accountId = marketAccountSelect.value, buyResult = null) {
  const name = marketListingName(listing);
  marketStatusEl.textContent = `${t('pokeIdle.marketBought')} ${name}. ${t('pokeIdle.marketSyncingInventory')}`;
  const delays = [0, 700, 1500, 3000];
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await refreshGameStatsNow().catch(() => {});
  }
  const stats = gameStats[accountId];
  const categoryKey = marketListingCategoryKey(listing);
  const depotSync = buyResult && (buyResult.postBuySyncAfterPulse || buyResult.postBuySync);
  const realtimeSync = buyResult && buyResult.realtimeSync;
  const gameStateReload = buyResult && buyResult.gameStateReload;
  if (gameStateReload && gameStateReload.ok) {
    marketStatusEl.textContent = `${t('pokeIdle.marketBought')} ${name}. ${t('pokeIdle.marketGameReloadedHint')}`;
  } else if (depotSync && depotSync.depotOpen && depotSync.clickedTargetTab && realtimeSync && realtimeSync.ok) {
    marketStatusEl.textContent = `${t('pokeIdle.marketBought')} ${name}. ${t(categoryKey === 'pokemon' ? 'pokeIdle.marketDepotPokemonHint' : 'pokeIdle.marketDepotItemsHint')}`;
  } else if (realtimeSync && realtimeSync.ok) {
    marketStatusEl.textContent = `${t('pokeIdle.marketBought')} ${name}. ${t('pokeIdle.marketRealtimeSyncHint')}`;
  } else if (categoryKey === 'pokemon' && stats && stats.collectionSize) {
    marketStatusEl.textContent = `${t('pokeIdle.marketBought')} ${name}. ${t('pokeIdle.marketInventorySynced')} (${stats.collectionSize})`;
  } else {
    marketStatusEl.textContent = `${t('pokeIdle.marketBought')} ${name}. ${t('pokeIdle.marketInventoryCheckHint')}`;
  }
}

function markMarketCardBought(card, buyBtn) {
  card.classList.add('market-card-bought');
  if (!card.querySelector('.market-card-purchased-badge')) {
    const badge = document.createElement('div');
    badge.className = 'market-card-purchased-badge';
    badge.textContent = '✓';
    card.appendChild(badge);
  }
  buyBtn.textContent = t('pokeIdle.marketBought');
}

function renderMarketResults() {
  const listings = getMarketFilteredListings();
  marketRenderedListings = new Map();
  marketResultsEl.classList.toggle('market-view-list', marketViewMode === 'list');
  marketResultsEl.classList.toggle('market-view-grid', marketViewMode !== 'list');
  marketResultsEl.innerHTML = '';

  if (!listings.length) {
    marketStatusEl.textContent = t('pokeIdle.marketNoResults');
    marketResultsEl.innerHTML = `<div class="market-empty-state">${t('pokeIdle.marketNoResults')}</div>`;
    return;
  }

  marketStatusEl.textContent = t('pokeIdle.marketResultsCount').replace('{n}', listings.length);
  let rendered = 0;
  let failed = 0;
  listings.slice(0, 60).forEach((listing, index) => {
    try {
      const listingKey = marketListingRenderKey(listing, index);
      marketRenderedListings.set(listingKey, listing);
      marketResultsEl.appendChild(renderMarketCard(listing, {
        onOpen: openMarketListing,
        onBuy: buyMarketListing,
        listingKey
      }));
      rendered += 1;
    } catch (err) {
      failed += 1;
      console.warn('[market] listing render failed', err, listing);
    }
  });
  if (failed) {
    const warning = document.createElement('div');
    warning.className = 'market-render-warning';
    warning.textContent = t('pokeIdle.marketRenderWarning').replace('{n}', failed);
    marketResultsEl.prepend(warning);
  }
  if (!rendered) {
    marketResultsEl.innerHTML = `<div class="market-empty-state">${t('pokeIdle.marketRenderFailed')}</div>`;
  }
}

async function loadMarketListings(forceRefresh = false) {
  if (marketLoadInFlight) return;
  const accountId = marketAccountSelect.value;
  if (!accountId) {
    marketListingsCache = [];
    marketResultsEl.innerHTML = '';
    marketStatusEl.textContent = t('pokeIdle.marketNoAccount');
    marketLastUpdatedEl.textContent = '';
    return;
  }

  const loadToken = ++marketLoadToken;
  marketLoadInFlight = true;
  marketStatusEl.textContent = t('pokeIdle.marketLoading');
  if (forceRefresh) marketRefreshBtn.disabled = true;

  let res;
  try {
    res = await window.api.getMarketListings(accountId, marketCategory);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  } finally {
    marketLoadInFlight = false;
  }
  if (loadToken !== marketLoadToken) return;

  if (
    marketCategory !== 'All' &&
    res &&
    res.ok &&
    Array.isArray(res.listings) &&
    res.listings.length === 0
  ) {
    const fallbackRes = await window.api.getMarketListings(accountId, 'All');
    if (loadToken !== marketLoadToken) return;
    if (fallbackRes && fallbackRes.ok && Array.isArray(fallbackRes.listings) && fallbackRes.listings.length) {
      res = fallbackRes;
    }
  }

  marketRefreshBtn.disabled = false;
  if (!res || !res.ok) {
    marketListingsCache = [];
    marketResultsEl.innerHTML = '';
    marketStatusEl.textContent = (res && res.error) || t('pokeIdle.marketLoadFailed');
    return;
  }

  marketListingsCache = Array.isArray(res.listings) ? res.listings : [];
  rememberMarketPrices(marketListingsCache);
  marketLastUpdatedAt = Date.now();
  marketLastUpdatedEl.textContent = t('pokeIdle.marketLastUpdated').replace('{time}', '0s');
  await ensureItemCatalogRenderer();
  await renderMarketPurchaseHistory();
  if (loadToken !== marketLoadToken) return;
  renderMarketResults();
  scanMarketDeals(marketListingsCache);
  renderMarketHealth();
}

function updateMarketLastUpdatedLabel() {
  if (!marketLastUpdatedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - marketLastUpdatedAt) / 1000));
  marketLastUpdatedEl.textContent = t('pokeIdle.marketLastUpdated').replace('{time}', `${seconds}s`);
}

marketSearchInput.addEventListener('input', renderMarketResults);
marketSortSelect.addEventListener('change', renderMarketResults);
marketRarityFilterSelect.addEventListener('change', renderMarketResults);
marketIvMinInput.addEventListener('input', renderMarketResults);
marketShowEpicInput.addEventListener('change', () => setMarketPrefs({ showEpic: marketShowEpicInput.checked }));
marketShowLegendaryInput.addEventListener('change', () => setMarketPrefs({ showLegendary: marketShowLegendaryInput.checked }));
marketShowDollarInput.addEventListener('change', () => setMarketPrefs({ showDollar: marketShowDollarInput.checked }));
marketShowDiamondsInput.addEventListener('change', () => setMarketPrefs({ showDiamonds: marketShowDiamondsInput.checked }));
marketAutoRefreshInput?.addEventListener('change', () => setMarketPrefs({ autoRefresh: marketAutoRefreshInput.checked }));
marketRefreshSecondsInput?.addEventListener('change', () => setMarketPrefs({ refreshSeconds: Math.max(5, Number(marketRefreshSecondsInput.value) || 15) }));
marketDealMaxPriceInput?.addEventListener('change', () => setMarketPrefs({ dealMaxPrice: Math.max(0, Number(marketDealMaxPriceInput.value) || 0) }));
marketDealNotifyInput?.addEventListener('change', () => {
  if (marketDealNotifyInput.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  setMarketPrefs({ dealNotify: marketDealNotifyInput.checked });
});
marketRefreshBtn.addEventListener('click', () => loadMarketListings(true));
marketCategoriesEl.querySelectorAll('.poke-market-cat').forEach((btn) => {
  btn.addEventListener('click', () => {
    marketCategoriesEl.querySelectorAll('.poke-market-cat').forEach((item) => item.classList.remove('active'));
    btn.classList.add('active');
    marketCategory = btn.dataset.cat || 'All';
    marketIvFilterEl.style.display = marketCategory === 'Pokémon' ? 'flex' : 'none';
    if (marketCategory !== 'Pokémon' && marketRarityFilterSelect) marketRarityFilterSelect.value = 'all';
    syncMarketFilterControls();
    loadMarketListings(true);
  });
});
marketViewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    marketViewMode = btn.dataset.view || 'grid';
    syncMarketViewButtons();
    renderMarketResults();
  });
});
btnCloseMarketModal.addEventListener('click', closeMarketModal);
btnCloseMarketModal2.addEventListener('click', closeMarketModal);
marketModal.addEventListener('click', (event) => {
  if (event.target === marketModal) closeMarketModal();
});
marketDetailBuyBtn.addEventListener('click', async () => {
  if (!marketSelectedListing) return;
  marketDetailBuyBtn.disabled = true;
  marketDetailBuyBtn.textContent = t('pokeIdle.marketBuying');
  const res = await buyMarketListing(marketSelectedListing, marketSelectedAccountId);
  if (res && res.ok) {
    marketDetailStatusEl.textContent = `${t('pokeIdle.marketBought')} ${marketListingName(marketSelectedListing)}. ${t('pokeIdle.marketSyncingInventory')}`;
    marketDetailBuyBtn.textContent = t('pokeIdle.marketBought');
    await syncMarketInventoryAfterBuy(marketSelectedListing, marketSelectedAccountId, res);
    await renderMarketPurchaseHistory();
    marketDetailStatusEl.textContent = marketStatusEl.textContent;
    await loadMarketListings(true);
  } else {
    marketDetailBuyBtn.disabled = false;
    marketDetailBuyBtn.textContent = t('pokeIdle.marketBuy');
    marketDetailStatusEl.textContent = (res && (res.error || (res.payload && res.payload.message))) || t('pokeIdle.marketBuyFailed');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !marketModal.classList.contains('hidden')) closeMarketModal();
});
setInterval(updateMarketLastUpdatedLabel, 1000);

function renderMarket() {
  syncMarketPrefsFromState();
  arrangeMarketFilters();
  populateMarketAccountDropdown();
  syncMarketViewButtons();
  syncMarketFilterControls();
  syncMarketAutoRefreshTimer();
  renderMarketHealth();
  renderMarketPurchaseHistory();
  loadMarketListings();
  renderMarketAlertFeed();
  ensureItemCatalogRenderer().then(() => {
    if (pokeIdlePanel.classList.contains('open')) renderMarketResults();
  }).catch(() => {});
  ensureCreatureCatalogRenderer().then(() => {
    if (pokeIdlePanel.classList.contains('open')) renderMarketResults();
  }).catch(() => {});
}

async function renderMarketAlertFeed() {
  if (!marketAlertFeedEl || !pokeIdlePanel.classList.contains('open')) return;
  const feed = await window.api.getMarketAlertFeed();
  // Alertas IV son una bandeja fija: no deben desaparecer por filtros activos
  // del Market (busqueda, moneda, rareza), porque entonces parece que nunca
  // llegaron aunque la notificacion del sistema si haya salido.
  const visibleFeed = Array.isArray(feed) ? feed.filter((entry) => entry && entry.listing) : [];
  if (!visibleFeed.length) {
    marketAlertFeedEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.marketAlertFeedEmpty')}</div>`;
    return;
  }
  marketAlertFeedEl.innerHTML = '';
  visibleFeed.forEach((entry) => {
    const alertId = entry.alertId || `${entry.accountId || ''}:${marketListingStableId(entry.listing)}`;
    const card = renderMarketCard(entry.listing, {
      onOpen: (listing) => openMarketListing(listing, entry.accountId),
      onBuy: (listing) => window.api.buyMarketListing(entry.accountId, listing)
    });
    card.classList.add('market-alert-card');
    card.dataset.alertId = alertId;
    const iv = marketListingIv(entry.listing);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'market-alert-dismiss';
    dismiss.textContent = '×';
    dismiss.title = t('pokeIdle.marketAlertDismiss');
    dismiss.addEventListener('click', async (event) => {
      event.stopPropagation();
      await window.api.dismissMarketAlert(alertId).catch(() => {});
      renderMarketAlertFeed();
    });
    const badge = document.createElement('div');
    badge.className = 'market-alert-badge';
    badge.textContent = iv != null
      ? t('pokeIdle.marketAlertPinnedIv', { iv, min: entry.threshold ?? state.settings?.pokeIdleAlerts?.marketMinIv ?? '?' })
      : t('pokeIdle.marketAlertPinned');
    // Header row: badge (left) + dismiss X (right) — both inside the card flow
    // so overflow:hidden on the card clips them correctly.
    const alertHeader = document.createElement('div');
    alertHeader.className = 'market-alert-header';
    alertHeader.appendChild(badge);
    alertHeader.appendChild(dismiss);
    card.prepend(alertHeader);
    marketAlertFeedEl.appendChild(card);
  });
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
      renderTierMeta();
      return list;
    });
  }
  return creatureCatalogPromise;
}

async function populateCalcSpeciesDropdown() {
  const catalog = await ensureCreatureCatalogRenderer();
  const sorted = catalog.slice().sort((a, b) => a.name.localeCompare(b.name));
  calcSpeciesEl.innerHTML = `<option value="">${t('pokeIdle.pokemonPlaceholder')}</option>` +
    sorted.map((c) => `<option value="${c.pokeId}">${escapeHtmlClient(c.name)}</option>`).join('');
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

// ---- Caza & XP / Ruta de Farmeo ----

let huntAttackers = [];

function populateHuntAttackerDropdown() {
  const sources = collectLiveCalcSources().filter((s) => s.isTeam);
  huntAttackers = sources;
  const current = huntAttackerEl.value;
  huntAttackerEl.innerHTML = `<option value="">${t('pokeIdle.attackerNone')}</option>` +
    sources.map((s, i) => `<option value="${i}">${escapeHtmlClient(s.label)}</option>`).join('');
  if (current && [...huntAttackerEl.options].some((o) => o.value === current)) huntAttackerEl.value = current;
}

huntAttackerEl.addEventListener('change', () => {
  const idx = huntAttackerEl.value;
  if (idx === '') { runHuntTable(); return; }
  const src = huntAttackers[Number(idx)];
  if (src && src.killsPerHour) huntKphEl.value = src.killsPerHour;
  runHuntTable();
});
huntKphEl.addEventListener('change', runHuntTable);
huntSortEl.addEventListener('change', runHuntTable);

let huntTableCache = [];

function matchupChipClass(m) {
  if (m == null) return '';
  if (m === 0) return 'poke-matchup-x0';
  if (m < 1) return 'poke-matchup-xweak';
  if (m === 1) return 'poke-matchup-x1';
  return 'poke-matchup-xstrong';
}

async function runHuntTable() {
  const idx = huntAttackerEl.value;
  const attacker = idx !== '' ? huntAttackers[Number(idx)] : null;
  const creature = attacker ? (await ensureCreatureCatalogRenderer()).find((c) => c.pokeId === attacker.speciesId) : null;
  const kph = Number(huntKphEl.value) || 650;

  huntTableWrapEl.innerHTML = `<div class="settings-hint">${t('pokeIdle.calculating')}</div>`;
  const rows = await window.api.getHuntTable({
    attackerType1: creature ? creature.type1 : null,
    attackerType2: creature ? creature.type2 : null,
    killsPerHour: kph
  });
  huntTableCache = rows;
  renderHuntTable();
}

function renderHuntTable() {
  const sortMode = huntSortEl.value;
  const rows = huntTableCache.slice().sort((a, b) => {
    if (sortMode === 'gold') return b.goldPerHour - a.goldPerHour;
    if (sortMode === 'matchup') return (b.matchup ?? -1) - (a.matchup ?? -1);
    if (sortMode === 'level') return (a.huntLevel ?? 0) - (b.huntLevel ?? 0);
    return b.xpPerHour - a.xpPerHour;
  });

  const body = rows.map((r) => {
    const typeBadges = [r.type1, r.type2]
      .filter(Boolean)
      .map((t) => `<span class="poke-type-badge" style="background:${POKE_TYPE_COLORS[t] || '#4f8cff'}">${escapeHtmlClient(t)}</span>`)
      .join(' ');
    const matchupHtml = r.matchup != null
      ? `<span class="poke-matchup-chip ${matchupChipClass(r.matchup)}">×${r.matchup}</span>`
      : '—';
    return `<tr>
      <td><div class="poke-hunt-row-name"><img class="poke-hunt-sprite" loading="lazy" src="${pokeSpriteGifUrl(r.pokeId, r.name) || pokeSpriteUrl(r.pokeId, r.name)}" onerror="pokeSpriteFallback(this,'${pokeSpriteUrl(r.pokeId, r.name)}')" alt="" />${escapeHtmlClient(r.name)}</div></td>
      <td>${typeBadges}</td>
      <td class="poke-hunt-num">${r.huntLevel ?? '?'}</td>
      <td>${matchupHtml}</td>
      <td class="poke-hunt-num">${formatCompactNumber(r.xpPerHour)}</td>
      <td class="poke-hunt-num">${formatCompactNumber(r.goldPerHour)}</td>
    </tr>`;
  }).join('');

  huntTableWrapEl.innerHTML = `
    <table class="poke-hunt-table">
      <thead><tr><th>${t('pokeIdle.col.pokemon')}</th><th>${t('pokeIdle.col.type')}</th><th>${t('pokeIdle.col.level')}</th><th>${t('pokeIdle.col.matchup')}</th><th>${t('pokeIdle.col.xpPerHour')}</th><th>${t('pokeIdle.col.goldPerHour')}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

// ---- Tier List (fórmula real portada de pokemon-360.web.app) ----

function bestMatchupClient(atkTypes, defType1, defType2) {
  let best = 0;
  atkTypes.filter(Boolean).forEach((atkType) => {
    const row = POKE_TYPE_CHART[atkType];
    const m1 = row && defType1 in row ? row[defType1] : 1;
    const m2 = defType2 ? (row && defType2 in row ? row[defType2] : 1) : 1;
    const m = m1 * m2;
    if (m > best) best = m;
  });
  return best;
}

const TIER_CLAN_BONUS = 1.30;
const TIER_CLANS = [
  { id: 'fire', key: 'clan.fire', elements: ['FIRE'] },
  { id: 'electric', key: 'clan.electric', elements: ['ELECTRIC'] },
  { id: 'ground_rock', key: 'clan.groundRock', elements: ['GROUND', 'ROCK'] },
  { id: 'grass_bug', key: 'clan.grassBug', elements: ['GRASS', 'BUG'] },
  { id: 'fighting_normal', key: 'clan.fightingNormal', elements: ['FIGHTING', 'NORMAL'] },
  { id: 'steel', key: 'clan.steel', elements: ['STEEL'] },
  { id: 'flying_dragon', key: 'clan.flyingDragon', elements: ['FLYING', 'DRAGON'] },
  { id: 'psychic_fairy', key: 'clan.psychicFairy', elements: ['PSYCHIC', 'FAIRY'] },
  { id: 'water_ice', key: 'clan.waterIce', elements: ['WATER', 'ICE'] },
  { id: 'ghost_poison_dark', key: 'clan.ghostPoisonDark', elements: ['GHOST', 'POISON', 'DARK'] }
];

// Ranking por percentil de stats base (ofensa/bulk/velocidad) — no es un tier
// oficial del juego, es el mismo criterio que usa pokemon-360.web.app.
function tierScoreClient(stats, inClan) {
  const bonus = inClan ? TIER_CLAN_BONUS : 1;
  const offense = Math.max(stats.atk * bonus, stats.spatk * bonus);
  const bulk = (stats.hp + stats.def * bonus + stats.spdef * bonus) / 3;
  return Math.round(offense * 0.40 + bulk * 0.35 + stats.speed * 0.25);
}

function tierCutsClient(count) {
  return {
    S: Math.round(count * 0.10),
    A: Math.round(count * 0.25),
    B: Math.round(count * 0.45),
    C: Math.round(count * 0.65),
    D: Math.round(count * 0.85)
  };
}

function tierLabelForIndexClient(index, cuts) {
  if (index < cuts.S) return 'S';
  if (index < cuts.A) return 'A';
  if (index < cuts.B) return 'B';
  if (index < cuts.C) return 'C';
  if (index < cuts.D) return 'D';
  return 'E';
}

const TIER_COLORS = { S: '#ffb020', A: '#ff6b6b', B: '#a3e635', C: '#51cf66', D: '#4f8cff', E: '#8890a0' };

function renderTierMeta() {
  if (!tierMetaEl) return;
  const count = creatureCatalogMeta?.count ?? (creatureCatalogCache || []).length;
  const maxId = creatureCatalogMeta?.maxId ?? (creatureCatalogCache || []).reduce((max, c) => Math.max(max, Number(c.pokeId) || 0), 0);
  const updated = creatureCatalogMeta?.updatedAt ? formatRelativeTime(creatureCatalogMeta.updatedAt) : '—';
  tierMetaEl.textContent = t('pokeIdle.tierMeta')
    .replace('{count}', count || 0)
    .replace('{maxId}', maxId || 0)
    .replace('{updated}', updated);
}

async function populateTierFilters() {
  const catalog = await ensureCreatureCatalogRenderer();
  const currentClan = tierClanEl.value;
  tierClanEl.innerHTML = `<option value="">${t('pokeIdle.clanNone')}</option>` +
    TIER_CLANS.map((c) => `<option value="${c.id}">${escapeHtmlClient(t(c.key))}</option>`).join('');
  tierClanEl.value = currentClan;
  const currentType = tierTypeEl.value;
  const types = Array.from(new Set(catalog.flatMap((c) => [c.type1, c.type2]).filter(Boolean))).sort();
  tierTypeEl.innerHTML = `<option value="">${t('pokeIdle.typeAll')}</option>` +
    types.map((tp) => `<option value="${tp}">${tp}</option>`).join('');
  tierTypeEl.value = currentType;
}

function computeTierList(clanId) {
  const catalog = creatureCatalogCache || [];
  const clan = TIER_CLANS.find((c) => c.id === clanId);
  const withScore = catalog.map((c) => {
    const inClan = clan ? clan.elements.includes(c.type1) || clan.elements.includes(c.type2) : false;
    const stats = { hp: c.baseHp, atk: c.baseAtk, def: c.baseDef, spatk: c.baseSpAtk, spdef: c.baseSpDef, speed: c.baseSpeed };
    return { creature: c, score: tierScoreClient(stats, inClan) };
  });
  withScore.sort((a, b) => b.score - a.score);
  const cuts = tierCutsClient(withScore.length);
  withScore.forEach((row, i) => { row.tier = tierLabelForIndexClient(i, cuts); });
  return withScore;
}

function renderTierList() {
  if (!tierListWrapEl || !creatureCatalogCache) return;
  const clanId = tierClanEl.value;
  const typeFilter = tierTypeEl.value;
  const fullList = computeTierList(clanId);
  const filtered = typeFilter
    ? fullList.filter((r) => r.creature.type1 === typeFilter || r.creature.type2 === typeFilter)
    : fullList;

  const rows = filtered.map((r) => {
    const c = r.creature;
    const typeBadges = [c.type1, c.type2].filter(Boolean).map(typeBadgeHtml).join(' ');
    return `<tr data-poke-id="${c.pokeId}" class="poke-tier-row">
      <td><span class="poke-tier-chip" style="background:${TIER_COLORS[r.tier]}">${r.tier}</span></td>
      <td><img class="poke-tier-sprite" loading="lazy" src="${pokeSpriteGifUrl(c.pokeId, c.name) || pokeSpriteUrl(c.pokeId, c.name)}" onerror="pokeSpriteFallback(this,'${pokeSpriteUrl(c.pokeId, c.name)}')" alt="" /></td>
      <td>${escapeHtmlClient(c.name)}</td>
      <td>${typeBadges}</td>
      <td class="poke-hunt-num">${r.score}</td>
    </tr>`;
  }).join('');

  tierListWrapEl.innerHTML = `<table class="poke-hunt-table poke-tier-table">
    <thead><tr><th>${t('pokeIdle.col.tier')}</th><th></th><th>${t('pokeIdle.col.name')}</th><th>${t('pokeIdle.col.type')}</th><th>${t('pokeIdle.col.score')}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  tierListWrapEl.querySelectorAll('.poke-tier-row').forEach((row) => {
    row.addEventListener('click', () => renderTierDetail(Number(row.dataset.pokeId)));
  });
}

tierClanEl.addEventListener('change', renderTierList);
tierTypeEl.addEventListener('change', renderTierList);
tierRefreshBtn?.addEventListener('click', async () => {
  tierRefreshBtn.disabled = true;
  tierRefreshBtn.textContent = t('pokeIdle.refreshingCatalog');
  tierListWrapEl.innerHTML = `<div class="market-empty-state">${t('pokeIdle.refreshingCatalog')}</div>`;
  tierDetailEl.innerHTML = '';
  try {
    await ensureCreatureCatalogRenderer(true);
    await populateTierFilters();
    renderTierList();
    renderTierMeta();
  } finally {
    tierRefreshBtn.disabled = false;
    tierRefreshBtn.textContent = t('pokeIdle.refreshCatalog');
  }
});

// Camina la línea evolutiva hacia atrás (buscando quién evoluciona EN este
// pokeId) o hacia adelante (siguiendo su propio evolvesToId), hasta 3 saltos.
function findEvoChain(pokeId, direction) {
  const catalog = creatureCatalogCache || [];
  const chain = [];
  let current = catalog.find((c) => c.pokeId === pokeId);
  for (let i = 0; i < 3 && current; i++) {
    if (direction === 'next') {
      if (current.evolvesToId == null) break;
      const nextC = catalog.find((c) => c.pokeId === current.evolvesToId);
      if (!nextC) break;
      chain.push(nextC);
      current = nextC;
    } else {
      const prevC = catalog.find((c) => c.evolvesToId === current.pokeId);
      if (!prevC) break;
      chain.unshift(prevC);
      current = prevC;
    }
  }
  return chain;
}

function evoChipHtml(c, current) {
  return `<div class="poke-evo-chip${current ? ' poke-evo-current' : ''}">
    <img class="poke-evo-sprite" loading="lazy" src="${pokeSpriteGifUrl(c.pokeId, c.name) || pokeSpriteUrl(c.pokeId, c.name)}" onerror="pokeSpriteFallback(this,'${pokeSpriteUrl(c.pokeId, c.name)}')" alt="" />
    <span>${escapeHtmlClient(c.name)}</span>
  </div>`;
}

function damageRefsHtml(title, list) {
  if (!list.length) {
    return `<div class="poke-tier-refbox"><span class="poke-eff-title">${title}</span><div class="settings-hint" style="margin:0;">${t('pokeIdle.noClearRefs')}</div></div>`;
  }
  const chips = list.map((r) => `<div class="poke-evo-chip">
    <img class="poke-evo-sprite" loading="lazy" src="${pokeSpriteGifUrl(r.creature.pokeId, r.creature.name) || pokeSpriteUrl(r.creature.pokeId, r.creature.name)}" onerror="pokeSpriteFallback(this,'${pokeSpriteUrl(r.creature.pokeId, r.creature.name)}')" alt="" />
    <span>${escapeHtmlClient(r.creature.name)} <b>×${r.mult}</b></span>
  </div>`).join('');
  return `<div class="poke-tier-refbox"><span class="poke-eff-title">${title}</span><div class="poke-evo-row">${chips}</div></div>`;
}

function formatCooldown(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n / 1000)}s`;
}

function tierMovesHtml(creature) {
  const attacks = Array.isArray(creature.attacks) ? [...creature.attacks] : [];
  if (!attacks.length) {
    return `<div class="poke-tier-refbox"><span class="poke-eff-title">${t('pokeIdle.moves')}</span><div class="settings-hint" style="margin:0;">${t('pokeIdle.noMoves')}</div></div>`;
  }
  attacks.sort((a, b) => (Number(a.learnLevel) || 1) - (Number(b.learnLevel) || 1) || (Number(b.power) || 0) - (Number(a.power) || 0));
  const rows = attacks.map((move) => `
    <tr>
      <td>${escapeHtmlClient(move.name || '?')}</td>
      <td>${typeBadgeHtml(move.type || 'NORMAL')}</td>
      <td>${escapeHtmlClient(move.category || '—')}</td>
      <td class="poke-hunt-num">${move.power ?? 0}</td>
      <td class="poke-hunt-num">Lv.${move.learnLevel ?? 1}</td>
      <td class="poke-hunt-num">${formatCooldown(move.cooldownMs)}</td>
    </tr>`).join('');
  return `<div class="poke-tier-refbox poke-tier-moves">
    <span class="poke-eff-title">${t('pokeIdle.moves')} · ${attacks.length}</span>
    <table class="poke-hunt-table poke-tier-moves-table">
      <thead><tr><th>${t('pokeIdle.col.name')}</th><th>${t('pokeIdle.col.type')}</th><th>${t('pokeIdle.moveCategory')}</th><th>Power</th><th>${t('pokeIdle.learnLevel')}</th><th>CD</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderTierDetail(pokeId) {
  const catalog = creatureCatalogCache || [];
  const c = catalog.find((x) => x.pokeId === pokeId);
  if (!c || !tierDetailEl) return;

  const prevChain = findEvoChain(pokeId, 'prev');
  const nextChain = findEvoChain(pokeId, 'next');

  // A qué especies les pega más fuerte (usando sus propios tipos como
  // atacante) — 2-3 referencias, solo si el multiplicador es >1.
  const dealt = catalog
    .filter((x) => x.pokeId !== pokeId)
    .map((x) => ({ creature: x, mult: bestMatchupClient([c.type1, c.type2], x.type1, x.type2) }))
    .filter((r) => r.mult > 1)
    .sort((a, b) => b.mult - a.mult)
    .slice(0, 3);

  // Qué especies le pegan más fuerte a él (usando el tipo de cada candidato
  // como atacante contra la defensa de éste).
  const taken = catalog
    .filter((x) => x.pokeId !== pokeId)
    .map((x) => ({ creature: x, mult: bestMatchupClient([x.type1, x.type2], c.type1, c.type2) }))
    .filter((r) => r.mult > 1)
    .sort((a, b) => b.mult - a.mult)
    .slice(0, 3);

  const typeBadges = [c.type1, c.type2].filter(Boolean).map(typeBadgeHtml).join(' ');
  const chainParts = [...prevChain.map((x) => evoChipHtml(x, false)), evoChipHtml(c, true), ...nextChain.map((x) => evoChipHtml(x, false))];
  const extraRows = [
    [t('pokeIdle.rarity'), c.rarity || '—'],
    [t('pokeIdle.huntLevel'), c.huntLevel ?? '—'],
    ['XP', c.experience ?? '—'],
    [t('pokeIdle.captureBase'), c.captureBase ?? '—'],
    [t('pokeIdle.area'), c.area || '—'],
    ['Orre tier', c.orreTier ?? '—'],
    ['Orre XP', c.orreXpMul ? `x${c.orreXpMul}` : '—']
  ];

  tierDetailEl.innerHTML = `
    <div class="poke-tier-detail-header">
      <img class="poke-tier-detail-sprite" loading="lazy" src="${pokeSpriteGifUrl(c.pokeId, c.name) || pokeSpriteUrl(c.pokeId, c.name)}" onerror="pokeSpriteFallback(this,'${pokeSpriteUrl(c.pokeId, c.name)}')" alt="" />
      <div>
        <div class="poke-team-name">${escapeHtmlClient(c.name)}</div>
        ${typeBadges}
      </div>
    </div>
    <div class="poke-stat-grid">
      ${[['HP', c.baseHp], ['ATK', c.baseAtk], ['DEF', c.baseDef], ['SpA', c.baseSpAtk], ['SpD', c.baseSpDef], ['Vel', c.baseSpeed]]
        .map(([l, v]) => `<div class="poke-stat-cell"><span>${l}</span><span>${v}</span></div>`).join('')}
    </div>
    <div class="poke-stat-grid">
      ${extraRows.map(([l, v]) => `<div class="poke-stat-cell"><span>${escapeHtmlClient(l)}</span><span>${escapeHtmlClient(v)}</span></div>`).join('')}
    </div>
    ${(prevChain.length || nextChain.length) ? `
    <div class="poke-eff-title">${t('pokeIdle.evoLine')}</div>
    <div class="poke-evo-row">${chainParts.join('<span class="poke-evo-arrow">→</span>')}</div>` : ''}
    ${tierMovesHtml(c)}
    ${damageRefsHtml(t('pokeIdle.dealsMoreDamageTo', { name: escapeHtmlClient(c.name) }), dealt)}
    ${damageRefsHtml(t('pokeIdle.takesMoreDamageFrom', { name: escapeHtmlClient(c.name) }), taken)}
  `;
}

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

setAdblock.addEventListener('change', () => {
  window.api.updateSettings({ adBlockEnabled: setAdblock.checked });
});

tbShield.addEventListener('click', () => {
  window.api.updateSettings({ adBlockEnabled: !(state.settings.adBlockEnabled !== false) });
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

window.api.onMarketAlertFeedUpdate?.(() => {
  renderMarketAlertFeed();
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

// Notification click → open panel, scroll to Market, highlight the listing.
window.api.onMarketOpenAlert?.(({ alertId, accountId, listing } = {}) => {
  openPokeIdlePanel();
  // Switch to the Market nav item and scroll to it.
  const marketNavItem = [...pokeNavItems].find((n) => n.dataset.pokeScroll === 'market');
  if (marketNavItem) {
    pokeNavItems.forEach((n) => n.classList.toggle('active', n === marketNavItem));
    setTimeout(() => {
      document.getElementById('poke-section-market')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // After the feed has rendered, pulse-highlight the matching alert card.
      setTimeout(() => {
        const id = alertId || (accountId && listing ? `${accountId}:${marketListingStableId(listing)}` : null);
        if (!id) return;
        const card = marketAlertFeedEl?.querySelector(`[data-alert-id="${CSS.escape(id)}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.classList.add('market-alert-highlight');
        setTimeout(() => card.classList.remove('market-alert-highlight'), 2500);
      }, 400);
    }, 100);
  }
});

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

window.api.onOpenSpaceEditor(({ id }) => {
  const space = state.spaces.find((s) => s.id === id);
  if (space) openSpaceModal(space);
});

window.api.onOpenAccountEditor(({ id }) => {
  const account = state.accounts.find((a) => a.id === id);
  if (account) openAccountModal(account);
});

async function init() {
  appMeta = await window.api.getMeta();
  state = await window.api.getState();
  loadPokeNotableCache();
  applyTheme(state.settings.theme);
  document.documentElement.lang = state.settings.language || 'es';
  translateStaticDom();
  render();
  requestAnimationFrame(fpsLoop);
  if (currentSpaceAccounts().length === 0) {
    await window.api.quickAddAccount();
  }
}

setInterval(async () => {
  metrics = await window.api.getMetrics();
}, 3000);

setInterval(async () => {
  gameStats = await window.api.getGameStats();
  maybePlayGameAlertSounds();
  maybePlayMarketAlertSounds();
  renderPokeIdleLivePanels();
}, 5000);

// Full render() already fires reactively off onStateUpdate (real account/space/
// settings changes) and off the geometry/drag paths above — it doesn't need its
// own ticker. What genuinely needs a per-second refresh is the status bar clock
// and the CPU/RAM readout (metrics arrive on their own 3s poll below with no
// event to hook), and renderStatusBar() alone covers both without rebuilding
// the rail, sidebar, account list, and panel headers every second regardless
// of whether anything changed.
setInterval(renderStatusBar, 1000);

init();
