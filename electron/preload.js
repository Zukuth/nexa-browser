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

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
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
  reopenLastClosed: () => ipcRenderer.invoke('accounts:reopenLastClosed'),
  findInPage: (id, text, opts) => ipcRenderer.send('account:findInPage', { id, text, ...opts }),
  stopFindInPage: (id) => ipcRenderer.send('account:stopFindInPage', { id }),
  onFindbarOpen: (cb) => ipcRenderer.on('findbar:open', (_e, data) => cb(data)),
  onFindbarClose: (cb) => ipcRenderer.on('findbar:close', (_e, data) => cb(data)),
  onFindbarResult: (cb) => ipcRenderer.on('findbar:result', (_e, data) => cb(data)),
  goBack: (id) => ipcRenderer.send('account:goBack', { id }),
  goForward: (id) => ipcRenderer.send('account:goForward', { id }),
  getMeta: () => ipcRenderer.invoke('app:getMeta'),
  getShortcuts: () => ipcRenderer.invoke('shortcuts:list'),
  onShortcutSelectPanel: (cb) => ipcRenderer.on('shortcut:selectPanel', (_e, data) => cb(data)),
  onShortcutNextPanel: (cb) => ipcRenderer.on('shortcut:nextPanel', () => cb()),
  onShortcutFocusAddress: (cb) => ipcRenderer.on('shortcut:focusAddress', () => cb()),
  onShortcutOpenSettings: (cb) => ipcRenderer.on('shortcut:openSettings', () => cb()),
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
  onStabilityUpdate: (cb) => ipcRenderer.on('stability:update', (_e, data) => cb(data)),
  optimizeMemory: () => ipcRenderer.invoke('memory:optimize'),
  deepCleanMemory: () => ipcRenderer.invoke('memory:deepClean'),
  getOptimizeStatus: () => ipcRenderer.invoke('memory:getOptimizeStatus'),
  onOptimizeStatusUpdate: (cb) => ipcRenderer.on('memory:optimizeStatus', (_e, s) => cb(s)),
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
  onMarketAlertFeedUpdate: (cb) => ipcRenderer.on('market:alertFeedUpdated', (_e, feed) => cb(feed)),
  onMarketOpenAlert: (cb) => ipcRenderer.on('market:openAlert', (_e, data) => cb(data)),
  getMarketPurchaseHistory: () => ipcRenderer.invoke('market:getPurchaseHistory'),
  addBookmark: (payload) => ipcRenderer.invoke('bookmarks:add', payload),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', { id }),
  exportBookmarks: () => ipcRenderer.invoke('bookmarks:export'),
  importBookmarks: () => ipcRenderer.invoke('bookmarks:import'),
  importPasswords: () => ipcRenderer.invoke('passwords:import'),
  removePassword: (id) => ipcRenderer.invoke('passwords:remove', { id }),
  getPasswords: () => ipcRenderer.invoke('passwords:list'),
  onStateUpdate: (cb) => ipcRenderer.on('state:update', (_e, data) => cb(data)),
  onNavUpdate: (cb) => ipcRenderer.on('nav:update', (_e, data) => cb(data)),
  onPanelsGeometry: (cb) => ipcRenderer.on('panels:geometry', (_e, data) => cb(data)),
  // Fired once per account after main has finished wiring its <webview>'s
  // webContents (session, telemetry, listeners — see wireAccountWebContents
  // in main.js) — the renderer only sets the real `src` on that account's
  // <webview> element after this, so CDP/telemetry attach always wins the
  // race against the real navigation.
  onWebviewReady: (cb) => ipcRenderer.on('webview:ready', (_e, accountId) => cb(accountId)),
  // Fired whenever an account's page enters/leaves native Picture-in-Picture
  // (see account-preload.js + wc.ipc.on('nexa-pip-state') in main.js) — lets
  // positionWebviews() keep that account's <webview> off-screen instead of
  // display:none while it's not the active panel.
  onPipState: (cb) => ipcRenderer.on('account:pipState', (_e, data) => cb(data)),
  // Live-follows a divider drag: main reflects the dragged panel's content
  // rect straight back so the renderer can resize that one <webview>
  // element immediately, without waiting for a full panels:geometry
  // broadcast (see account:setLiveRect / 'account:liveRect' in main.js).
  onAccountLiveRect: (cb) => ipcRenderer.on('account:liveRect', (_e, data) => cb(data)),
  onOpenSpaceEditor: (cb) => ipcRenderer.on('ui:open-space-editor', (_e, data) => cb(data)),
  onOpenAccountEditor: (cb) => ipcRenderer.on('ui:open-account-editor', (_e, data) => cb(data)),
  // One-way fire-and-forget (send, not invoke) — the host UI's own error
  // handlers below must never await a round-trip or throw themselves.
  reportError: (info) => ipcRenderer.send('renderer:error', info)
});
