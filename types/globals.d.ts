// Declaraciones de tipo para lo que los preloads cuelgan de `window` vía
// contextBridge.exposeInMainWorld(). NO es código: TypeScript lo lee solo
// para el chequeo (`npm run typecheck`), nunca se empaqueta ni se ejecuta —
// misma categoría que jsconfig.json, no rompe la decisión de que el proyecto
// sea Electron/Node/vanilla JS sin build step.
//
// Por qué existe: contextBridge cruza el límite de contexto en runtime, así
// que TypeScript no tiene forma de saber que `window.api` existe. Sin esto,
// cada uno de los 236 usos de window.api en renderer.js era un error
// "Property 'api' does not exist on type 'Window'" — 235 errores, el 20% de
// todo lo que reportaba ese archivo, ahogando los errores de null que sí
// importan.
//
// `api` y `screenshotEditorAPI` van como `any` A PROPÓSITO, no por descuido:
// preload.js expone 157 métodos y enumerarlos acá crearía un segundo lugar
// donde mantener esa lista sincronizada a mano, que se desactualiza en
// silencio la primera vez que alguien agregue un método y se olvide. El
// valor de este archivo es sacar el ruido para que se vean los errores
// reales; tipar los 157 métodos es un proyecto aparte y de valor marginal
// menor (esas llamadas fallan por problemas de IPC en runtime, no de tipo).

interface Window {
  /** electron/preload.js — el puente IPC principal del renderer (157 métodos). */
  api: any;

  /** electron/screenshot-editor-preload.js — solo en screenshot-editor.html. */
  screenshotEditorAPI: any;

  /** electron/popout-preload.js — solo en popout.html. */
  popoutAPI: any;

  /**
   * src/i18n-data.js, cargado como <script> clásico antes que renderer.js.
   * Catálogo plano por idioma: NEXA_I18N['es']['topbar.back'].
   */
  NEXA_I18N: Record<string, Record<string, string>>;

  /** Fallback de sprites del panel de Poke Idle World (src/renderer.js). */
  pokeSpriteFallback?: (img: HTMLImageElement) => void;

  /** Prefijo viejo de WebKit — sigue existiendo en Chromium. */
  webkitAudioContext?: typeof AudioContext;
}
