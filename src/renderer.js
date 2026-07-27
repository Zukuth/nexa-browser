const listEl = document.getElementById('account-list');
const btnNewTab = document.getElementById('btn-new-tab');
const btnToggleAll = document.getElementById('btn-toggle-all');
const addressInput = document.getElementById('input-address');
const panelHeadersEl = document.getElementById('panel-headers');
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

const statusSpaceInfo = document.getElementById('status-space-info');
const statusActiveAccount = document.getElementById('status-active-account');
const statusCpu = document.getElementById('status-cpu');
const statusRam = document.getElementById('status-ram');
const statusFps = document.getElementById('status-fps');
const statusTime = document.getElementById('status-time');
const statusVersion = document.getElementById('status-version');

const LAYOUT_LABELS = { single: 'Panel único', grid: 'Cuadrícula automática', columns: 'Columnas', rows: 'Filas', free: 'Libre' };
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
const pokeIdleModal = document.getElementById('poke-idle-modal');
const btnClosePokeIdle = document.getElementById('btn-close-poke-idle');
const tbPokeIdle = document.getElementById('tb-poke-idle');
const pokeNavItems = document.querySelectorAll('.poke-nav-item');
const pokePanes = document.querySelectorAll('.poke-pane');
const pokeIdleTeamEl = document.getElementById('poke-idle-team');
const calcSourceEl = document.getElementById('calc-source');
const calcSpeciesEl = document.getElementById('calc-species');
const calcLevelEl = document.getElementById('calc-level');
const calcQualityEl = document.getElementById('calc-quality');
const calcProjLevelEl = document.getElementById('calc-proj-level');
const calcResultEl = document.getElementById('calc-result');
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
const setDefaultZoom = document.getElementById('set-default-zoom');
const setDefaultLayout = document.getElementById('set-default-layout');
const setDownloadsFolderLabel = document.getElementById('set-downloads-folder-label');
const setChooseFolder = document.getElementById('set-choose-folder');
const setAskDownload = document.getElementById('set-ask-download');
const setAutoUpdate = document.getElementById('set-auto-update');
const setCheckUpdates = document.getElementById('set-check-updates');
const setUpdateStatus = document.getElementById('set-update-status');
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
const pokeIdleAccountsEl = document.getElementById('poke-idle-accounts');
const pokeIdleNotableEl = document.getElementById('poke-idle-notable');
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

function formatDuration(ms) {
  const seconds = Math.max(Math.floor(ms / 1000), 0);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function render() {
  if (!listDragInProgress) renderRail();

  const collapsed = !!state.settings.sidebarCollapsed;
  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  sidebarEl.classList.toggle('collapsed', collapsed);
  sidebarEl.style.width = sidebarWidth + 'px';
  const contentLeft = RAIL_WIDTH + sidebarWidth + 'px';
  topbarEl.style.left = contentLeft;
  emptyStateEl.style.left = contentLeft;
  btnNewTab.textContent = collapsed ? '+' : '+ Nueva pestaña';
  btnCollapseSidebar.title = collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral';

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
    statusText.textContent = account.closed ? 'Cerrada' : 'En línea';
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
      muteIcon.title = 'Silenciada';
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
      gameRow.title = gs.connected ? 'Conectado a Poke Idle World' : 'Sin señal reciente del juego';
      const dot = gs.connected ? '🟢' : '⚪';
      gameRow.innerHTML =
        `<span>${dot} ${formatCompactNumber(gs.killsPerHour)} kills/h</span>` +
        `<span>${formatCompactNumber(gs.xpPerHour)} XP/h</span>` +
        `<span>${formatCompactNumber(gs.goldPerHour)} 🪙/h</span>` +
        (gs.captures ? `<span>${gs.captures} capturas</span>` : '') +
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
  btnToggleAll.title = allClosed ? 'Abrir todas' : 'Cerrar todas';

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
  tbMuteAll.title = state.settings.allMuted ? 'Activar sonido de todo' : 'Silenciar todo';
  tbMuteAll.classList.toggle('muted', !!state.settings.allMuted);

  const adBlockOn = state.settings.adBlockEnabled !== false;
  tbShield.classList.toggle('muted', adBlockOn);
  tbShield.title = adBlockOn ? 'Bloqueador de anuncios activado (clic para desactivar)' : 'Bloqueador de anuncios desactivado (clic para activar)';
  const activeBlocked = active ? metrics[active.id]?.blocked || 0 : 0;
  tbShieldCount.textContent = activeBlocked > 0 ? String(activeBlocked) : '';

  if (!dragInProgress) renderPanelHeaders();
  renderStatusBar();
}

function renderStatusBar() {
  const space = currentSpace();
  const spaceAccounts = currentSpaceAccounts();
  const mode = state.settings.layoutMode || 'single';
  statusSpaceInfo.textContent = `${space?.name || ''} · ${LAYOUT_LABELS[mode] || mode} · ${spaceAccounts.length}`;

  const active = activeAccount();
  statusActiveAccount.textContent = active ? `${displayName(active, spaceAccounts.indexOf(active))} activa` : 'Sin cuenta activa';

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
      dragHandle.title = 'Mover panel';
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
    urlInput.placeholder = 'Escribe una URL...';
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
    muteBtn.title = 'Silenciar';
    muteBtn.onclick = () => window.api.muteAccount(panel.id, !panel.muted);

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '⟳';
    reloadBtn.title = 'Recargar';
    reloadBtn.onclick = () => window.api.reloadAccount(panel.id);

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.textContent = panel.maximized ? '⤡' : '⛶';
    fullscreenBtn.title = panel.maximized ? 'Restaurar' : 'Pantalla completa';
    fullscreenBtn.onclick = () => window.api.toggleMaximize(panel.id);

    const zoomBtn = document.createElement('button');
    zoomBtn.textContent = Math.round((panel.zoom || 1) * 100) + '%';
    zoomBtn.title = 'Zoom de esta pestaña';
    zoomBtn.style.width = 'auto';
    zoomBtn.style.padding = '0 4px';
    zoomBtn.style.fontSize = '10px';
    zoomBtn.onclick = (e) => {
      e.stopPropagation();
      openPanelZoomMenu(zoomBtn, panel.id, panel.zoom || 1);
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Cerrar pestaña';
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
    renderPanelHeaders(); // catch up on any geometry that arrived mid-drag and was held back
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
  spaceInputName.value = space ? space.name : 'Nuevo espacio';
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
    name: spaceInputName.value.trim() || 'Espacio',
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
  accountModalColor = account.color || SPACE_COLORS[0];
  renderAccountSwatches();
  accountModal.classList.remove('hidden');
  pushModal();
  accountInputName.focus();
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
    ecoMode: accountInputEco.checked
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
  applyAll.textContent = 'Aplicar a todo';
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
    bookmarksListEl.innerHTML = '<div class="settings-hint">Todavía no guardaste ningún favorito.</div>';
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
    removeBtn.textContent = 'Quitar';
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
    alert('No se pudieron importar los favoritos: ' + result.error);
  }
});

bmExport.addEventListener('click', async () => {
  try {
    const result = await window.api.exportBookmarks();
    if (!result.ok && result.error) alert('No se pudieron exportar los favoritos: ' + result.error);
  } catch (err) {
    alert('No se pudieron exportar los favoritos: ' + err.message);
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

const DOWNLOAD_STATE_LABELS = {
  progressing: 'Descargando…',
  completed: 'Completada',
  cancelled: 'Cancelada',
  interrupted: 'Interrumpida'
};

function renderDownloadsList() {
  const list = state.downloads || [];
  downloadsListEl.innerHTML = '';
  if (list.length === 0) {
    downloadsListEl.innerHTML = '<div class="settings-hint">Todavía no descargaste nada.</div>';
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
    const stateLabel = d.state === 'progressing' && d.paused ? 'Pausada' : (DOWNLOAD_STATE_LABELS[d.state] || d.state);
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
      openBtn.textContent = 'Abrir';
      openBtn.onclick = () => window.api.openFileDownload(d.id);

      const folderBtn = document.createElement('button');
      folderBtn.className = 'ext-remove';
      folderBtn.textContent = 'Mostrar en carpeta';
      folderBtn.onclick = () => window.api.showDownloadInFolder(d.id);

      actions.append(openBtn, folderBtn);
    }

    if (d.state === 'progressing') {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'ext-remove';
      toggleBtn.textContent = d.paused ? 'Reanudar' : 'Pausar';
      toggleBtn.onclick = () => (d.paused ? window.api.resumeDownload(d.id) : window.api.pauseDownload(d.id));

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ext-remove';
      cancelBtn.textContent = 'Cancelar';
      cancelBtn.onclick = () => window.api.cancelDownload(d.id);

      actions.append(toggleBtn, cancelBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-remove';
    removeBtn.textContent = 'Quitar';
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
      hint: 'Cambiar de cuenta',
      keywords: `cuenta ${displayName(account, i)}`,
      run: () => window.api.activateAccount(account.id)
    });
  });

  state.spaces.forEach((space) => {
    actions.push({
      icon: '🗂️',
      label: space.name,
      hint: 'Cambiar de espacio',
      keywords: `espacio ${space.name}`,
      run: () => window.api.activateSpace(space.id)
    });
  });

  [
    ['general', 'General'], ['navegacion', 'Navegación'], ['descargas', 'Descargas'],
    ['extensiones', 'Extensiones'], ['contrasenas', 'Contraseñas'], ['red', 'Red'],
    ['actualizaciones', 'Actualizaciones'], ['acerca', 'Acerca de']
  ].forEach(([tab, label]) => {
    actions.push({
      icon: '⚙️',
      label: `Configuración: ${label}`,
      keywords: `configuracion settings ${label}`,
      run: () => { openSettingsModal(); activateSettingsTab(tab); }
    });
  });

  const adBlockOn = state.settings.adBlockEnabled !== false;
  actions.push(
    {
      icon: '➕', label: 'Nueva cuenta', keywords: 'nueva cuenta agregar add account',
      run: () => window.api.quickAddAccount()
    },
    {
      icon: adBlockOn ? '🛡️' : '🚫',
      label: adBlockOn ? 'Desactivar bloqueador de anuncios' : 'Activar bloqueador de anuncios',
      keywords: 'adblock bloqueador anuncios rastreadores',
      run: () => window.api.updateSettings({ adBlockEnabled: !adBlockOn })
    },
    {
      icon: '⬇️', label: 'Abrir Descargas', keywords: 'descargas downloads',
      run: () => openDownloadsModal()
    },
    {
      icon: '⭐', label: 'Abrir Favoritos', keywords: 'favoritos bookmarks marcadores',
      run: () => openBookmarksModal()
    },
    {
      icon: '🎮', label: 'Abrir Poke Idle World', keywords: 'poke idle pokemon equipo capturas alertas',
      run: () => openPokeIdleModal()
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
      label: `Ir a: ${query.trim()}`,
      hint: 'Navegar en la cuenta activa',
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
    cmdkListEl.innerHTML = '<div class="cmdk-empty">Sin resultados</div>';
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

async function openShortcutsModal() {
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
    pwListEl.innerHTML = '<div class="settings-hint">No has importado contraseñas todavía.</div>';
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
    copyBtn.textContent = 'Copiar';
    copyBtn.onclick = () => navigator.clipboard.writeText(p.password || '');

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ext-remove';
    removeBtn.textContent = 'Quitar';
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
    pwError.textContent = 'La URL y la contraseña son obligatorias.';
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
  setTheme.value = s.theme || 'system';
  setStartWindows.checked = !!s.startWithWindows;
  setReopenSpace.checked = s.reopenLastSpace !== false;
  setAdblock.checked = s.adBlockEnabled !== false;
  setHwAccel.checked = s.hardwareAcceleration !== false;
  setDefaultUrl.value = s.defaultStartUrl || 'https://www.google.com';
  setDefaultZoom.value = String(s.defaultZoom || 1);
  setDefaultLayout.value = s.newSpaceDefaultLayout || 'single';
  setDownloadsFolderLabel.textContent = s.downloadsFolder || 'Carpeta predeterminada del sistema';
  setAskDownload.checked = !!s.askDownloadLocation;
  setAutoUpdate.checked = s.autoCheckUpdates !== false;
  setUpdateStatus.textContent = '';

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
    extListEl.innerHTML = '<div class="settings-hint">Todavía no instalaste ninguna extensión.</div>';
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
    removeBtn.textContent = 'Quitar';
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
      ${!plugin.enabled ? '<div class="ext-id">No disponible en este equipo</div>' : ''}
    `;

    item.append(icon, info);
    pluginListEl.appendChild(item);
  });
}

function renderNetworkTab() {
  if (!networkListEl) return;
  networkListEl.innerHTML = '';
  if (state.accounts.length === 0) {
    networkListEl.innerHTML = '<div class="settings-hint">Todavía no creaste ninguna cuenta.</div>';
    return;
  }
  state.accounts.forEach((account, i) => {
    const item = document.createElement('div');
    item.className = 'ext-item';
    const proxyText = account.proxy?.server
      ? `${account.proxy.server}${account.proxy.username ? ` (usuario: ${account.proxy.username})` : ''}`
      : 'Sin proxy — usa la conexión directa';
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
  el.addEventListener('change', savePokeIdleAlertFields);
});
pokeAlertBallsThreshold.addEventListener('change', savePokeIdleAlertFields);

// Mirrors RARITY_THRESHOLDS in game-telemetry.js, low to high.
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

// Public sprite CDN keyed by National Pokédex number — the game's own
// creatures.json (checked live) has no image URL, only a numeric `looktype`
// that isn't the dex number; `speciesId` in poke-delta frames IS the real
// dex number (confirmed: 18 = Pidgeot), which this CDN indexes by directly.
function pokeSpriteUrl(speciesId) {
  return speciesId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${speciesId}.png` : '';
}

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

function renderPokeIdleNotable() {
  const el = pokeIdleNotableEl;
  if (!el) return;
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id]);
  const all = [];
  tracked.forEach((account, i) => {
    const gs = gameStats[account.id];
    (gs.notableCaptures || []).forEach((c) => all.push({ ...c, accountName: displayName(account, i) }));
  });
  all.sort((a, b) => b.at - a.at);
  const top = all.slice(0, 20);

  if (top.length === 0) {
    el.innerHTML = '<div class="settings-hint">Todavía no hay capturas en esta sesión.</div>';
    return;
  }

  el.innerHTML = '';
  const showAccountName = tracked.length > 1;
  top.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'poke-notable-card';
    const color = POKE_RARITY_COLORS[c.rarity] || '#ffd84d';
    card.style.setProperty('--rarity-color', color);

    const img = document.createElement('img');
    img.className = 'poke-notable-sprite';
    img.src = pokeSpriteUrl(c.speciesId);
    img.alt = c.name || '';
    img.onerror = () => { img.style.visibility = 'hidden'; };

    const info = document.createElement('div');
    info.className = 'poke-notable-info';
    const quality = typeof c.quality === 'number' ? c.quality.toFixed(3) : '?';
    info.innerHTML = `
      <div class="poke-notable-name">${c.shiny ? '✨' : ''} ${escapeHtmlClient(c.name || '?')} <span style="color:var(--muted); font-weight:400;">Lv.${c.level ?? '?'}</span></div>
      <div class="poke-notable-meta">${showAccountName ? escapeHtmlClient(c.accountName) + ' · ' : ''}Quality ${quality} · IV ${c.ivTotal ?? '?'}/192</div>
    `;

    const rarity = document.createElement('div');
    rarity.className = 'poke-notable-rarity';
    rarity.textContent = c.rarity || (c.shiny ? 'Shiny' : '');

    const time = document.createElement('div');
    time.className = 'poke-notable-time';
    time.textContent = formatRelativeTime(c.at);

    card.append(img, info, rarity, time);
    el.appendChild(card);
  });
}

function renderPokeIdle() {
  if (!pokeIdleSummaryEl || !pokeIdleAccountsEl) return;
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id]);

  if (tracked.length === 0) {
    pokeIdleSummaryEl.innerHTML = '';
    pokeIdleAccountsEl.innerHTML = '<div class="settings-hint">Ninguna cuenta abierta apunta a Poke Idle World todavía.</div>';
    return;
  }

  let totalKills = 0, totalXp = 0, totalGold = 0, totalCaptures = 0, totalShiny = 0;
  tracked.forEach((a) => {
    const gs = gameStats[a.id];
    totalKills += gs.killsPerHour || 0;
    totalXp += gs.xpPerHour || 0;
    totalGold += gs.goldPerHour || 0;
    totalCaptures += gs.captures || 0;
    totalShiny += gs.shinyCaught || 0;
  });

  pokeIdleSummaryEl.innerHTML = `
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalKills)}</div><div class="poke-summary-label">Kills/h</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalXp)}</div><div class="poke-summary-label">XP/h</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">${formatCompactNumber(totalGold)}</div><div class="poke-summary-label">Oro/h</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">${totalCaptures}</div><div class="poke-summary-label">Capturas</div></div>
    <div class="poke-summary-card"><div class="poke-summary-value">✨ ${totalShiny}</div><div class="poke-summary-label">Shiny</div></div>
  `;

  pokeIdleAccountsEl.innerHTML = '';
  tracked.forEach((a) => {
    const gs = gameStats[a.id];
    const item = document.createElement('div');
    item.className = 'poke-account-item';
    const dot = gs.connected ? '🟢' : '⚪';
    item.innerHTML = `
      <span class="poke-account-name">${dot} ${escapeHtmlClient(a.name || 'Cuenta')}</span>
      <span class="poke-account-stats">
        <span>${formatCompactNumber(gs.killsPerHour)} kills/h</span>
        <span>${formatCompactNumber(gs.xpPerHour)} XP/h</span>
        <span>${formatCompactNumber(gs.goldPerHour)} oro/h</span>
        <span>${gs.captures} capturas</span>
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

function activatePokeTab(tab) {
  pokeNavItems.forEach((n) => n.classList.toggle('active', n.dataset.pokeTab === tab));
  pokePanes.forEach((p) => p.classList.toggle('active', p.dataset.pokePane === tab));
}

pokeNavItems.forEach((navItem) => {
  navItem.addEventListener('click', () => activatePokeTab(navItem.dataset.pokeTab));
});

function openPokeIdleModal() {
  pokeIdleModal.classList.remove('hidden');
  pushModal();
  renderPokeIdle();
  renderPokeIdleNotable();
  renderPokeIdleTeam();
  loadPokeIdleAlertFields();
  populateCalcSourceDropdown();
}

function closePokeIdleModal() {
  pokeIdleModal.classList.add('hidden');
  popModal();
}

tbPokeIdle.addEventListener('click', openPokeIdleModal);
btnClosePokeIdle.addEventListener('click', closePokeIdleModal);
pokeIdleModal.addEventListener('mousedown', (e) => {
  if (e.target === pokeIdleModal) closePokeIdleModal();
});

function renderPokeIdleTeam() {
  if (!pokeIdleTeamEl) return;
  const tracked = state.accounts.filter((a) => !a.closed && gameStats[a.id] && (gameStats[a.id].team || []).length);

  if (tracked.length === 0) {
    pokeIdleTeamEl.innerHTML = '<div class="settings-hint">Ninguna cuenta abierta tiene un equipo activo detectado todavía.</div>';
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
      img.src = pokeSpriteUrl(p.speciesId);
      img.alt = p.name || '';
      img.onerror = () => { img.style.visibility = 'hidden'; };

      const main = document.createElement('div');
      main.className = 'poke-team-main';

      const typeBadges = [p.type1, p.type2]
        .filter(Boolean)
        .map((t) => `<span class="poke-type-badge" style="background:${POKE_TYPE_COLORS[t] || '#4f8cff'}">${escapeHtmlClient(t)}</span>`)
        .join(' ');

      const header = document.createElement('div');
      header.className = 'poke-team-header';
      header.innerHTML =
        `<span class="poke-team-name">${p.shiny ? '✨ ' : ''}${escapeHtmlClient(p.name || '?')}${p.leader ? ' 👑' : ''}</span>` +
        `<span class="poke-team-level">Lv.${p.level ?? '?'}${showAccountName ? ' · ' + escapeHtmlClient(displayName(account, ai)) : ''}</span>` +
        typeBadges;

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
        ? moveList.slice(0, 8).map((m) => `<span class="poke-move-chip">${escapeHtmlClient(m.name)} · ${m.power ?? '?'}</span>`).join('')
        : '<span class="poke-move-chip">Sin movimientos detectados</span>';

      main.append(header, quality, hpRow, statGrid, moves);
      card.append(img, main);
      pokeIdleTeamEl.appendChild(card);
    });
  });
}

// ---- Calculadora Growth/IV (fórmula real portada de pokemon-360.web.app) ----

let creatureCatalogCache = null;
let creatureCatalogPromise = null;
function ensureCreatureCatalogRenderer() {
  if (creatureCatalogCache) return Promise.resolve(creatureCatalogCache);
  if (!creatureCatalogPromise) {
    creatureCatalogPromise = window.api.getCreatureCatalog().then((list) => {
      creatureCatalogCache = list;
      return list;
    });
  }
  return creatureCatalogPromise;
}

async function populateCalcSpeciesDropdown() {
  const catalog = await ensureCreatureCatalogRenderer();
  const sorted = catalog.slice().sort((a, b) => a.name.localeCompare(b.name));
  calcSpeciesEl.innerHTML = '<option value="">Elegí un Pokémon…</option>' +
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
        label: `🟢 ${displayName(account, ai)} · ${p.name} Lv.${p.level} (equipo)`,
        speciesId: p.speciesId, level: p.level, quality: p.quality, stats: p.stats
      });
    });
    (gs.notableCaptures || []).slice(0, 15).forEach((c) => {
      if (!c.stats) return;
      sources.push({
        label: `📋 ${displayName(account, ai)} · ${c.name} Lv.${c.level} (${formatRelativeTime(c.at)})`,
        speciesId: c.speciesId, level: c.level, quality: c.quality, stats: c.stats
      });
    });
  });
  return sources;
}

function populateCalcSourceDropdown() {
  calcSources = collectLiveCalcSources();
  const current = calcSourceEl.value;
  calcSourceEl.innerHTML = '<option value="manual">Manual</option>' +
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

async function runCalculator() {
  const speciesId = Number(calcSpeciesEl.value);
  const level = Number(calcLevelEl.value);
  const quality = Number(calcQualityEl.value);
  const observed = {
    hp: Number(calcStatInputs.hp.value), atk: Number(calcStatInputs.atk.value), def: Number(calcStatInputs.def.value),
    spatk: Number(calcStatInputs.spatk.value), spdef: Number(calcStatInputs.spdef.value), speed: Number(calcStatInputs.speed.value)
  };
  if (!speciesId || !level || !quality || Object.values(observed).some((v) => !v)) {
    calcResultEl.innerHTML = '<div class="settings-hint">Elegí una fuente en vivo arriba, o completá especie/nivel/quality/stats a mano.</div>';
    return;
  }

  const catalog = await ensureCreatureCatalogRenderer();
  const creature = catalog.find((c) => c.pokeId === speciesId);
  if (!creature) {
    calcResultEl.innerHTML = '<div class="settings-hint">No encontré esa especie en el catálogo.</div>';
    return;
  }
  const base = {
    hp: creature.baseHp, atk: creature.baseAtk, def: creature.baseDef,
    spatk: creature.baseSpAtk, spdef: creature.baseSpDef, speed: creature.baseSpeed
  };
  const projLevel = Number(calcProjLevelEl.value) || level;

  let ivMin = 0, ivMax = 0, statsSumAtProj = 0;
  const rows = Object.keys(CALC_STAT_LABELS).map((key) => {
    const res = window.pokeFormulas.inferGrowth(base[key], level, quality, observed[key], key);
    const min = Math.min(...res.values), max = Math.max(...res.values);
    const mid = Math.round((min + max) / 2);
    ivMin += min; ivMax += max;
    const projected = window.pokeFormulas.growthStat(base[key], mid, projLevel, quality, key);
    statsSumAtProj += projected;
    const range = min === max ? String(min) : `${min}–${max}`;
    return `<tr><td>${CALC_STAT_LABELS[key]}</td><td>${range}</td><td>${observed[key]}</td><td>${projected}</td></tr>`;
  });

  const projectedPower = window.pokeFormulas.powerFor(statsSumAtProj, quality);
  const band = window.pokeFormulas.qualityBand(quality);
  const clampedQ = Math.max(0.8, Math.min(2.6, quality));
  const markerPct = ((clampedQ - 0.8) / 1.8) * 100;

  calcResultEl.innerHTML = `
    <div class="poke-calc-summary">
      <div><b>${escapeHtmlClient(creature.name)}</b>Especie</div>
      <div><b>${quality.toFixed(3)}</b>Quality (${band.label})</div>
      <div><b>${Math.round(ivMin)}–${Math.round(ivMax)}</b>IV total (6–192)</div>
      <div><b>${projectedPower}</b>Power proyectado Lv.${projLevel}</div>
    </div>
    <div class="poke-calc-quality-gauge"><div class="poke-calc-quality-marker" style="left:${markerPct}%"></div></div>
    <table class="poke-calc-table">
      <thead><tr><th>Stat</th><th>Growth (IV)</th><th>Actual Lv.${level}</th><th>Proyectado Lv.${projLevel}</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

populateCalcSpeciesDropdown();

extInstallBtn.addEventListener('click', async () => {
  const value = extInput.value.trim();
  if (!value) return;
  extError.classList.add('hidden');
  extInstallBtn.disabled = true;
  extInstallBtn.textContent = 'Instalando...';
  const result = await window.api.installExtensionFromStore(value);
  extInstallBtn.disabled = false;
  extInstallBtn.textContent = 'Instalar';
  if (result.ok) {
    extInput.value = '';
    renderExtensions();
  } else {
    extError.textContent = result.error || 'No se pudo instalar la extensión.';
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
  if (confirm('Este cambio requiere reiniciar la app. ¿Reiniciar ahora?')) {
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

setDefaultZoom.addEventListener('change', () => {
  window.api.updateSettings({ defaultZoom: parseFloat(setDefaultZoom.value) });
});

setDefaultLayout.addEventListener('change', () => {
  window.api.updateSettings({ newSpaceDefaultLayout: setDefaultLayout.value });
});

setAskDownload.addEventListener('change', () => {
  window.api.updateSettings({ askDownloadLocation: setAskDownload.checked });
});

setAutoUpdate.addEventListener('change', () => {
  window.api.updateSettings({ autoCheckUpdates: setAutoUpdate.checked });
});

setChooseFolder.addEventListener('click', async () => {
  const data = await window.api.chooseDownloadsFolder();
  setDownloadsFolderLabel.textContent = data.settings.downloadsFolder || 'Carpeta predeterminada del sistema';
});

setCheckUpdates.addEventListener('click', async () => {
  setUpdateStatus.textContent = 'Buscando actualizaciones...';
  const result = await window.api.checkUpdates();
  setUpdateStatus.textContent = result.message;
});

const UPDATE_STATUS_LABELS = {
  checking: 'Buscando actualizaciones...',
  'not-available': 'Estás en la última versión.',
  available: (d) => `Actualización disponible: v${d.version} — descargando...`,
  downloading: (d) => `Descargando actualización... ${d.percent}%`,
  error: (d) => `Error al buscar actualizaciones: ${d.message}`
};

window.api.onUpdateStatus((d) => {
  if (d.status === 'downloaded') {
    setUpdateStatus.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = `Versión ${d.version} lista — `;
    const restartBtn = document.createElement('button');
    restartBtn.textContent = 'Reiniciar para actualizar';
    restartBtn.onclick = () => window.api.installUpdate();
    setUpdateStatus.append(label, restartBtn);
    return;
  }
  const label = UPDATE_STATUS_LABELS[d.status];
  if (!label) return;
  setUpdateStatus.textContent = typeof label === 'function' ? label(d) : label;
});

setExportSpaces.addEventListener('click', async () => {
  try {
    const result = await window.api.exportSpaces();
    if (result.ok) alert('Espacios exportados correctamente.');
    else if (result.error) alert('No se pudieron exportar los espacios: ' + result.error);
  } catch (err) {
    alert('No se pudieron exportar los espacios: ' + err.message);
  }
});

setImportSpaces.addEventListener('click', async () => {
  try {
    const result = await window.api.importSpaces();
    if (result.ok) alert('Espacios importados correctamente.');
    else if (result.error) alert('No se pudieron importar los espacios: ' + result.error);
  } catch (err) {
    alert('No se pudieron importar los espacios: ' + err.message);
  }
});

// ---- IPC listeners ----

window.api.onStateUpdate((data) => {
  state = data;
  applyTheme(state.settings.theme);
  render();
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
  applyTheme(state.settings.theme);
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
  if (!pokeIdleModal.classList.contains('hidden')) {
    renderPokeIdle();
    renderPokeIdleNotable();
    renderPokeIdleTeam();
  }
}, 5000);

setInterval(render, 1000);

init();
