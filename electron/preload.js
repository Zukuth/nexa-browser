const { contextBridge, ipcRenderer } = require('electron');

// NOTE: this preload runs with sandbox:true (main window webPreferences), so
// it can ONLY require('electron') and Electron's own polyfilled built-ins —
// require()'ing another project file (e.g. './poke-formulas') throws and
// silently kills the WHOLE preload script before it ever reaches
// contextBridge.exposeInMainWorld('api', ...) below, leaving window.api
// undefined for everything (confirmed live: this broke basically the whole
// app, not just the one feature that used it). Poke-formulas math is
// computed in main.js instead (unsandboxed, requires it fine) and exposed
// through the pokeFormulas:* IPC channels below.

// Registers an ipcRenderer.on listener and returns an unsubscribe function —
// none of the onX(cb) methods below used to return one, so a caller had no
// way to stop listening short of the whole window going away. Not an active
// leak today (this preload backs the one long-lived main window, wired up
// once at startup and never re-run), but the app already has other windows
// with their own shorter lifetimes (screenshot editor, popout) and any
// future one that reuses this onX pattern — or a hot-reload during dev —
// would silently pile up duplicate listeners without this. Every call site
// below already only ever used a single data argument (or none), so one
// generic wrapper covers all of them instead of hand-rolling 27 near-
// identical listener/remove pairs.
function onIpc(channel, cb) {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  isPasswordEncryptionAvailable: () => ipcRenderer.invoke('security:passwordEncryptionAvailable'),
  getSitePermissions: () => ipcRenderer.invoke('permissions:getSitePermissions'),
  revokeSitePermission: (hostname, permission) => ipcRenderer.invoke('permissions:revoke', { hostname, permission }),
  clearAllSitePermissions: () => ipcRenderer.invoke('permissions:clearAll'),
  getVersions: () => ({ app: ipcRenderer.sendSync('app:getVersionSync'), electron: process.versions.electron, chrome: process.versions.chrome }),
  addAccount: (payload) => ipcRenderer.invoke('accounts:add', payload),
  quickAddAccount: () => ipcRenderer.invoke('accounts:quickAdd'),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', { id }),
  closeAllAccounts: () => ipcRenderer.invoke('accounts:closeAll'),
  closeAccount: (id) => ipcRenderer.invoke('accounts:closeOne', { id }),
  openAllAccounts: () => ipcRenderer.invoke('accounts:openAll'),
  activateAccount: (id) => ipcRenderer.invoke('accounts:activate', { id }),
  toggleMaximize: (id) => ipcRenderer.invoke('accounts:toggleMaximize', { id }),
  openInNewWindow: (id) => ipcRenderer.invoke('accounts:openInNewWindow', { id }),
  navigateAccount: (id, url) => ipcRenderer.invoke('account:navigate', { id, url }),
  setLayout: (mode) => ipcRenderer.invoke('layout:set', { mode }),
  reloadAccount: (id) => ipcRenderer.invoke('account:reload', { id }),
  reloadAccountHard: (id) => ipcRenderer.invoke('account:reloadHard', { id }),
  captureScreenshot: (id) => ipcRenderer.invoke('account:captureScreenshot', { id }),
  openScreenshotEditor: (id) => ipcRenderer.invoke('account:openScreenshotEditor', { id }),
  openMiniPlayer: (id) => ipcRenderer.invoke('account:openMiniPlayer', { id }),
  getEcoSavings: () => ipcRenderer.invoke('eco:getSavings'),
  isAdBlockEngineReady: () => ipcRenderer.invoke('adblock:isEngineReady'),
  getAdBlockEngineStatus: () => ipcRenderer.invoke('adblock:getEngineStatus'),
  runDnsSpeedTest: () => ipcRenderer.invoke('dns:test'),
  getDnsApplyCommand: (servers) => ipcRenderer.invoke('dns:getApplyCommand', { servers }),
  getDnsRestoreCommand: () => ipcRenderer.invoke('dns:getRestoreCommand'),
  copyDnsCommand: (command) => ipcRenderer.invoke('dns:copyCommand', { command }),
  translatePage: (id, to) => ipcRenderer.invoke('translate:page', { id, to }),
  restorePage: (id) => ipcRenderer.invoke('translate:restore', { id }),
  translateSelectionAt: (id, x, y) => ipcRenderer.invoke('translate:selectionAt', { id, x, y }),
  restoreTranslatedSelections: (id) => ipcRenderer.invoke('translate:restoreSelections', { id }),
  translateChatOnce: (id) => ipcRenderer.invoke('translate:chatOnce', { id }),
  onTranslateProgress: (cb) => onIpc('translate:progress', cb),
  onTranslateDownloadProgress: (cb) => onIpc('translate:downloadProgress', cb),
  onTranslateDownloadFinished: (cb) => onIpc('translate:downloadFinished', cb),
  onTranslateAutoApplied: (cb) => onIpc('translate:autoApplied', cb),
  onUpdateDownloaded: (cb) => onIpc('update:downloaded', cb),
  onUpdateDownloadProgress: (cb) => onIpc('update:downloadProgress', cb),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateStatus: () => ipcRenderer.invoke('update:getStatus'),
  reopenLastClosed: () => ipcRenderer.invoke('accounts:reopenLastClosed'),
  findInPage: (id, text, opts) => ipcRenderer.send('account:findInPage', { id, text, ...opts }),
  stopFindInPage: (id) => ipcRenderer.send('account:stopFindInPage', { id }),
  onFindbarOpen: (cb) => onIpc('findbar:open', cb),
  onFindbarClose: (cb) => onIpc('findbar:close', cb),
  onFindbarResult: (cb) => onIpc('findbar:result', cb),
  goBack: (id) => ipcRenderer.send('account:goBack', { id }),
  goForward: (id) => ipcRenderer.send('account:goForward', { id }),
  getMeta: () => ipcRenderer.invoke('app:getMeta'),
  getShortcuts: () => ipcRenderer.invoke('shortcuts:list'),
  onShortcutSelectPanel: (cb) => onIpc('shortcut:selectPanel', cb),
  onShortcutNextPanel: (cb) => onIpc('shortcut:nextPanel', cb),
  onShortcutFocusAddress: (cb) => onIpc('shortcut:focusAddress', cb),
  onShortcutOpenSettings: (cb) => onIpc('shortcut:openSettings', cb),
  muteAccount: (id, muted) => ipcRenderer.invoke('account:mute', { id, muted }),
  addSpace: (payload) => ipcRenderer.invoke('spaces:add', payload),
  updateSpace: (id, fields) => ipcRenderer.invoke('spaces:update', { id, ...fields }),
  removeSpace: (id) => ipcRenderer.invoke('spaces:remove', { id }),
  activateSpace: (id) => ipcRenderer.invoke('spaces:activate', { id }),
  duplicateAccount: (id) => ipcRenderer.invoke('accounts:duplicate', { id }),
  updateAccount: (id, fields) => ipcRenderer.invoke('accounts:update', { id, ...fields }),
  reorderAccounts: (orderedIds) => ipcRenderer.invoke('accounts:reorder', orderedIds),
  reorderSpaces: (orderedIds) => ipcRenderer.invoke('spaces:reorder', orderedIds),
  clearSession: (id) => ipcRenderer.invoke('account:clearSession', { id }),
  showAccountMenu: (id) => ipcRenderer.send('accounts:contextmenu', { id }),
  showGroupMenu: (id) => ipcRenderer.send('groups:contextmenu', { id }),
  createGroup: (spaceId, name) => ipcRenderer.invoke('groups:create', { spaceId, name }),
  renameGroup: (id, name) => ipcRenderer.invoke('groups:rename', { id, name }),
  removeGroup: (id) => ipcRenderer.invoke('groups:remove', { id }),
  toggleGroupCollapsed: (id) => ipcRenderer.invoke('groups:toggleCollapsed', { id }),
  setAccountGroup: (id, groupId) => ipcRenderer.invoke('accounts:setGroup', { id, groupId }),
  onPromptNewGroup: (cb) => onIpc('ui:promptNewGroup', cb),
  onPromptRenameGroup: (cb) => onIpc('ui:promptRenameGroup', cb),
  showSpaceMenu: (id) => ipcRenderer.send('spaces:contextmenu', { id }),
  duplicateSpace: (id) => ipcRenderer.invoke('spaces:duplicate', { id }),
  setFreeRect: (id, rect) => ipcRenderer.invoke('account:setFreeRect', { id, rect }),
  setSplit: (ids, fracs, field) => ipcRenderer.invoke('layout:setSplit', { ids, fracs, field }),
  setLiveRect: (id, rect) => ipcRenderer.send('account:setLiveRect', { id, rect }),
  toggleSidebar: () => ipcRenderer.invoke('sidebar:toggle'),
  // The main-process side of these (ui:hide-views/ui:show-views) is now a
  // no-op — <webview> is real DOM so a modal's own z-index already covers
  // it, no more compositing hack needed for that. But <webview> guests are
  // still a genuinely separate, hit-testable surface: a mousemove that
  // crosses over one mid-drag (dragging a split divider, a free-mode panel,
  // a URL-suggestion dropdown open over a panel) gets captured by the guest
  // instead of continuing to reach the host document's own mousemove
  // listener, silently truncating the drag. Toggling pointer-events here —
  // entirely renderer-local, no round-trip needed — is what actually fixes
  // that now; the IPC send is kept only so nothing breaks if main ever
  // needs this signal again.
  hideViews: () => {
    document.getElementById('panel-webviews')?.classList.add('drag-inert');
    ipcRenderer.send('ui:hide-views');
  },
  showViews: () => {
    document.getElementById('panel-webviews')?.classList.remove('drag-inert');
    ipcRenderer.send('ui:show-views');
  },
  setZoom: (id, factor) => ipcRenderer.invoke('account:setZoom', { id, factor }),
  setZoomAll: (factor) => ipcRenderer.invoke('accounts:setZoomAll', { factor }),
  toggleFullscreen: () => ipcRenderer.send('app:toggleFullscreen'),
  relaunchApp: () => ipcRenderer.send('app:relaunch'),
  openDownloads: () => ipcRenderer.send('app:openDownloads'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
  openFileDownload: (id) => ipcRenderer.invoke('downloads:openFile', { id }),
  showDownloadInFolder: (id) => ipcRenderer.invoke('downloads:showInFolder', { id }),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', { id }),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', { id }),
  resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', { id }),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', { id }),
  muteAllAccounts: (muted) => ipcRenderer.invoke('accounts:muteAll', { muted }),
  updateSettings: (fields) => ipcRenderer.invoke('settings:update', fields),
  chooseDownloadsFolder: () => ipcRenderer.invoke('settings:chooseDownloadsFolder'),
  getPlugins: () => ipcRenderer.invoke('plugins:list'),
  addPassword: (entry) => ipcRenderer.invoke('passwords:add', entry),
  exportSpaces: () => ipcRenderer.invoke('settings:exportSpaces'),
  importSpaces: () => ipcRenderer.invoke('settings:importSpaces'),
  installExtensionFromStore: (input) => ipcRenderer.invoke('extensions:installFromStore', { input }),
  loadUnpackedExtension: () => ipcRenderer.invoke('extensions:loadUnpacked'),
  toggleExtension: (id, enabled) => ipcRenderer.invoke('extensions:toggle', { id, enabled }),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', { id }),
  getMetrics: () => ipcRenderer.invoke('metrics:get'),
  getAdBlockLog: (id) => ipcRenderer.invoke('adblock:getLog', { id }),
  toggleAdBlockSitePause: (hostname) => ipcRenderer.invoke('adblock:toggleSitePause', { hostname }),
  toggleAdBlockSiteBlock: (hostname) => ipcRenderer.invoke('adblock:toggleSiteBlock', { hostname }),
  setAdBlockMode: (mode) => ipcRenderer.invoke('adblock:setMode', { mode }),
  setAdBlockMasterEnabled: (enabled) => ipcRenderer.invoke('adblock:setMasterEnabled', { enabled }),
  getAdBlockPopupData: (id) => ipcRenderer.invoke('adblock:getPopupData', { id }),
  pickAdBlockElement: (id) => ipcRenderer.invoke('adblock:pickElement', { id }),
  setAdBlockCustomRules: (text) => ipcRenderer.invoke('adblock:setCustomRules', { text }),
  setAdBlockFilterLists: (lists) => ipcRenderer.invoke('adblock:setFilterLists', { lists }),
  setFavoriteHunt: (id, huntSlug) => ipcRenderer.invoke('accounts:setFavoriteHunt', { id, huntSlug }),
  teleportToHunt: (id, target) => ipcRenderer.invoke('accounts:teleportToHunt', { id, target }),
  getShop: (id) => ipcRenderer.invoke('shop:get', { id }),
  buyShopItem: (id, { ballId, itemId, qty }) => ipcRenderer.invoke('shop:buy', { id, ballId, itemId, qty }),
  sellItems: (id, items) => ipcRenderer.invoke('items:sell', { id, items }),
  sellPokemon: (id, pokeIds) => ipcRenderer.invoke('pokemon:sell', { id, pokeIds }),
  getDepot: (id) => ipcRenderer.invoke('depot:get', { id }),
  getPokes: (id) => ipcRenderer.invoke('pokes:get', { id }),
  moveDepotItem: (id, itemId, dir) => ipcRenderer.invoke('depot:moveItem', { id, itemId, dir }),
  moveDepotPoke: (id, pokeId, dir) => ipcRenderer.invoke('depot:movePoke', { id, pokeId, dir }),
  getFamily: (id) => ipcRenderer.invoke('family:get', { id }),
  moveFamilyItem: (id, itemId, quantity, dir) => ipcRenderer.invoke('family:moveItem', { id, itemId, quantity, dir }),
  moveFamilyPoke: (id, pokeId, dir) => ipcRenderer.invoke('family:movePoke', { id, pokeId, dir }),
  openExtensionPopup: (id) => ipcRenderer.invoke('extensions:openPopup', { id }),
  exportDiagnosticsReport: () => ipcRenderer.invoke('diagnostics:exportReport'),
  startNetLog: (id) => ipcRenderer.invoke('diagnostics:startNetLog', { id }),
  stopNetLog: () => ipcRenderer.invoke('diagnostics:stopNetLog'),
  getStabilityAccountState: (id) => ipcRenderer.invoke('stability:getAccountState', { id }),
  manualReconnectAccount: (id) => ipcRenderer.invoke('stability:manualReconnect', { id }),
  testStabilityNetwork: (id) => ipcRenderer.invoke('stability:testNetwork', { id }),
  onStabilityUpdate: (cb) => onIpc('stability:update', cb),
  optimizeMemory: () => ipcRenderer.invoke('memory:optimize'),
  deepCleanMemory: () => ipcRenderer.invoke('memory:deepClean'),
  getOptimizeStatus: () => ipcRenderer.invoke('memory:getOptimizeStatus'),
  onOptimizeStatusUpdate: (cb) => onIpc('memory:optimizeStatus', cb),
  getGameStats: () => ipcRenderer.invoke('gameStats:get'),
  getCreatureCatalog: (forceRefresh = false) => ipcRenderer.invoke('pokeFormulas:getCreatureCatalog', { forceRefresh }),
  getItemCatalog: () => ipcRenderer.invoke('pokeFormulas:getItemCatalog'),
  computeGrowthCalc: (payload) => ipcRenderer.invoke('pokeFormulas:computeGrowth', payload),
  getHuntTable: (payload) => ipcRenderer.invoke('pokeFormulas:getHuntTable', payload),
  toggleSellLockPoke: (id, pokeId) => ipcRenderer.invoke('account:toggleSellLockPoke', { id, pokeId }),
  setSellLockItems: (id, itemIds) => ipcRenderer.invoke('account:setSellLockItems', { id, itemIds }),
  getMarketListings: (id, category) => ipcRenderer.invoke('market:getListings', { id, category }),
  buyMarketListing: (id, listing) => ipcRenderer.invoke('market:buy', { id, listing }),
  getMarketAlertFeed: () => ipcRenderer.invoke('market:getAlertFeed'),
  dismissMarketAlert: (alertId) => ipcRenderer.invoke('market:dismissAlert', { alertId }),
  onMarketAlertFeedUpdate: (cb) => onIpc('market:alertFeedUpdated', cb),
  onMarketOpenAlert: (cb) => onIpc('market:openAlert', cb),
  getMarketPurchaseHistory: () => ipcRenderer.invoke('market:getPurchaseHistory'),
  addBookmark: (payload) => ipcRenderer.invoke('bookmarks:add', payload),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', { id }),
  exportBookmarks: () => ipcRenderer.invoke('bookmarks:export'),
  importBookmarks: () => ipcRenderer.invoke('bookmarks:import'),
  importPasswords: () => ipcRenderer.invoke('passwords:import'),
  removePassword: (id) => ipcRenderer.invoke('passwords:remove', { id }),
  getPasswords: () => ipcRenderer.invoke('passwords:list'),
  onStateUpdate: (cb) => onIpc('state:update', cb),
  onNavUpdate: (cb) => onIpc('nav:update', cb),
  onPanelsGeometry: (cb) => onIpc('panels:geometry', cb),
  // Fired once per account after main has finished wiring its <webview>'s
  // webContents (session, telemetry, listeners — see wireAccountWebContents
  // in main.js) — the renderer only sets the real `src` on that account's
  // <webview> element after this, so CDP/telemetry attach always wins the
  // race against the real navigation.
  onWebviewReady: (cb) => onIpc('webview:ready', cb),
  // Fired whenever an account's page enters/leaves native Picture-in-Picture
  // (see account-preload.js + wc.ipc.on('nexa-pip-state') in main.js) — lets
  // positionWebviews() keep that account's <webview> off-screen instead of
  // display:none while it's not the active panel.
  onPipState: (cb) => onIpc('account:pipState', cb),
  // Live-follows a divider drag: main reflects the dragged panel's content
  // rect straight back so the renderer can resize that one <webview>
  // element immediately, without waiting for a full panels:geometry
  // broadcast (see account:setLiveRect / 'account:liveRect' in main.js).
  onAccountLiveRect: (cb) => onIpc('account:liveRect', cb),
  onOpenSpaceEditor: (cb) => onIpc('ui:open-space-editor', cb),
  onOpenAccountEditor: (cb) => onIpc('ui:open-account-editor', cb),
  // One-way fire-and-forget (send, not invoke) — the host UI's own error
  // handlers below must never await a round-trip or throw themselves.
  reportError: (info) => ipcRenderer.send('renderer:error', info)
});
