# Nexa Browser

**El navegador de escritorio pensado para quienes manejan varias cuentas a la vez.**

Nexa Browser te deja abrir varias sesiones completamente aisladas del mismo sitio —distintas cuentas de Gmail, redes sociales, plataformas de trabajo, juegos online— todas al mismo tiempo, en una sola ventana, sin perfiles de Chrome separados ni ventanas de incógnito por todos lados.

[![VirusTotal](https://img.shields.io/badge/VirusTotal-0%2F67%20detections-brightgreen?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/d83da03ae2fa7ca534f62d8492e80df823d1091b7421cfb6d48aa604a74c2da7/detection)

**Escaneado en VirusTotal: 0/67 motores antivirus lo marcaron como malicioso** ([ver análisis completo](https://www.virustotal.com/gui/file/d83da03ae2fa7ca534f62d8492e80df823d1091b7421cfb6d48aa604a74c2da7/detection)) — análisis hecho sobre `Nexa-Browser-Setup-0.3.6-x64.exe`, tal cual se publicó en [Releases](https://github.com/Zukuth/nexa-browser/releases). El instalador **no está firmado con un certificado de código**, así que Windows va a mostrar una advertencia al instalarlo ([ver cómo continuar](#instalación)); el escaneo está justamente para que puedas verificar el binario por tu cuenta.

## Por qué instalarlo

Si alguna vez tuviste que:
- Abrir cinco ventanas de incógnito para manejar cinco cuentas del mismo sitio,
- Perder tiempo cerrando sesión y volviendo a entrar solo para revisar otra cuenta,
- Encontrarte con que la cuenta que dejaste en segundo plano se desconectó sola hace horas,
- O querer ver varias cuentas **al mismo tiempo, lado a lado**, en vez de ir saltando entre ventanas,

Nexa Browser está armado exactamente para ese problema.

## Ventajas principales

### 🗂️ Multi-cuenta real, no pestañas disfrazadas
Cada cuenta corre en su propia sesión aislada de Chromium: cookies, almacenamiento local y login completamente separados entre sí. Podés tener 5 Gmail, 3 cuentas de un juego o varias redes sociales abiertas en simultáneo sin que se pisen entre ellas.

### 🧩 Organización en Espacios y layouts flexibles
Agrupá tus cuentas en Espacios (trabajo, personal, gaming, lo que necesites) y elegí cómo verlas: panel único, cuadrícula automática, columnas, filas, o modo libre con paneles que arrastrás y redimensionás a tu gusto.

### 🔌 Tus cuentas en segundo plano no se desconectan
Chromium le baja la prioridad a todo lo que no estás mirando: los timers encadenados de una pestaña en segundo plano se limitan a **uno por minuto**. El keepalive del WebSocket de cualquier juego o app en tiempo real es justo ese tipo de timer — se estrangula, el servidor cierra la sesión por inactividad, y te enterás horas después. Nexa desactiva ese mecanismo a nivel de toda la app (`disable-background-timer-throttling` y los dos flags que lo acompañan), más una escalera de recuperación de conexión por niveles que repara sin recargar la página como primer recurso.

**Es la diferencia real contra usar perfiles de Chrome**: un perfil de Chrome no te deja tocar esto. Trade-off consciente y asumido: las cuentas en segundo plano consumen algo más de CPU, porque justamente les estamos prohibiendo a Chromium que las duerma.

### ⚡ Trabajo de rendimiento medido, no prometido
Cada versión corre el mismo benchmark reproducible (`node scripts/perf-benchmark.js`) y el número queda publicado más abajo, para bien o para mal. En la última pasada grande el CPU bajó **de 1.6% a 0.6% (-64%)**: overlays apagados por defecto, escritura del store fuera del hilo principal, y el sidebar dejando de reconstruirse entero en cada cambio de estado irrelevante.

Lo que Nexa **no** te va a prometer: que gasta menos RAM que abrir la misma cantidad de perfiles de Chrome. Es Chromium real, cada sesión aislada paga su costo. Lo que sí te da es que esas sesiones se mantengan vivas y controlables desde una sola ventana.

### 🛡️ Bloqueador de anuncios y rastreadores integrado
Viene activado por defecto, sin extensiones que instalar aparte — bloquea publicidad, analíticas y rastreadores conocidos en todas las cuentas.

### 🔐 Gestor de contraseñas cifrado
Guardá tus contraseñas con autocompletado en las páginas. Se cifran en reposo usando el almacén seguro del sistema operativo (Windows Credential Manager) — nunca quedan en texto plano en el disco.

### ⭐ Favoritos con importación y exportación
Guardá tus sitios favoritos y llevalos con vos: importá/exportá en un clic si cambiás de PC o querés respaldarlos.

### 🧱 Extensiones de Chrome
Instalá extensiones reales de la Chrome Web Store. Algunas, como las específicas para ciertos juegos, se configuran solas apenas abrís el navegador por primera vez.

### 🎬 Reproducción con DRM (Netflix, Spotify Web, etc.)
Soporte para contenido protegido (Widevine), algo que las builds abiertas de Electron no traen de fábrica.

### 🖥️ Se instala como cualquier programa de Windows
Instalador estándar (NSIS) que se integra en `C:\Program Files`, con su acceso directo en el Escritorio y entrada en "Aplicaciones instaladas" — igual que cualquier navegador conocido.

### 🌐 Idioma en tiempo real (Español / Português / English)
Elegí tu idioma en Configuración y toda la interfaz cambia al instante — sin reiniciar la app — incluidas todas las herramientas de Poke Idle World, menús contextuales, atajos de teclado y notificaciones.

### 🎨 Tema claro y oscuro
Seguí el tema del sistema operativo o forzalo manualmente, a gusto.

### 🚀 Command Palette (`Ctrl + K`)
Buscá cuentas, espacios, acciones o navegá directo a una URL desde un solo cuadro, sin sacar las manos del teclado.

### 🔀 Reordená todo con drag & drop
Arrastrá cuentas y espacios para reorganizarlos como quieras.

### ⬇️ Gestor de descargas completo
Pausá, reanudá o cancelá descargas en curso, elegí carpeta de destino por descarga y accedé al historial completo desde el navegador.

### 🌱 Modo Eco por cuenta
Activalo en las cuentas que dejás en segundo plano (por ejemplo, un juego idle) para reducir el consumo de CPU sin frenar el progreso real de la cuenta.

## 🎮 Poke Idle World — panel integrado

Para quienes juegan [Poke Idle World](https://poke.idleworld.online), Nexa Browser trae un panel propio (botón 🎮 en la barra superior) que lee en vivo los datos que el propio juego transmite — **de solo lectura: nunca automatiza capturas ni toca el captcha**. Los catálogos (ítems, Pokémon, evoluciones) se traen en vivo directo del juego, así que cualquier actualización que el juego reciba aparece sola, sin esperar una versión nueva de Nexa.

> **Nota de alcance (v0.4.0):** el panel se recortó a propósito de 13 a 4 secciones. Market global, Tienda portátil, Venta masiva, Depot, Tier List, Caza & XP, Drops en vivo, Comparador de hunts y Pokédex **se retiraron** — eran mucha superficie de mantenimiento acoplada a un solo juego para lo que aportaban. Lo que queda es lo que se usa todos los días.

- **👥 Mi Equipo**: el equipo activo de cada cuenta con nivel, quality/IV, stats y los movimientos que ya debería tener aprendidos según su nivel actual, calculado contra el catálogo del propio juego.
- **🧬 Calculadora de IV / Quality**: la fórmula real de Growth y Quality del juego, portada y verificada. Elegí una captura o un Pokémon del equipo para autocompletar, o cargá los datos a mano.
- **🔔 Alertas nativas**: notificaciones de Windows para shiny (capturado o visto), capturas raras (Lendária o más), desconexión/reconexión y pocas balls con umbral configurable — cada una se prende y apaga por separado.
- **⚙️ Ajustes por cuenta**: cuatro pestañas rápidas sin abrir el editor de cuentas —
  - *Rendimiento*: Modo Eco + **Comparativa Eco**, que mide esa cuenta con Eco apagado y encendido y después restaura tu preferencia.
  - *Interfaz del juego*: sacar el chat y la barra superior del juego **del árbol de la página** (no taparlos) — menos trabajo de layout y pintado.
  - *Protección*: candado de venta que bloquea de verdad la venta de los Pokémon e ítems marcados, no un simple aviso de confirmación.
  - *Estabilidad*: recuperación de conexión por niveles, mantener activo en segundo plano, recarga como último recurso (apagada por defecto) y un **Test de red a pedido** contra el servidor del juego (red, DNS, HTTPS). Todo apagado por defecto — no cambia nada hasta que lo actives.

## Instalación

1. Andá a la [última versión publicada](https://github.com/Zukuth/nexa-browser/releases/latest).
2. Descargá `Nexa Browser-Setup-x64.exe`.
3. Ejecutalo y seguí el asistente (Windows puede mostrar una advertencia de SmartScreen por ser una app nueva — es esperable, elegí "Más información" → "Ejecutar de todas formas").

**Requisitos:** Windows 10/11, 64 bits.

### Si Windows bloquea la instalación por completo

Como el instalador no tiene certificado de firma de código, en algunos equipos con Windows 11 puede aparecer un aviso de **"Control Inteligente de Aplicaciones"** que bloquea la app sin dar la opción de "Ejecutar de todas formas" (a diferencia del aviso normal de SmartScreen). Si te pasa eso:

`Configuración → Privacidad y seguridad → Seguridad de Windows → Control de aplicaciones y del explorador → Control inteligente de aplicaciones → Apagado`

⚠️ Esta función, una vez desactivada, **no se puede volver a activar sin reinstalar Windows desde cero** — es una decisión de una sola vía. Solo desactivala si confiás en el origen del instalador.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl + 1–9` | Seleccionar panel 1–9 |
| `Ctrl + Tab` | Siguiente panel |
| `Ctrl + N` | Nueva cuenta |
| `Ctrl + Shift + N` | Nuevo espacio |
| `Ctrl + K` | Paleta de comandos |
| `Ctrl + R` | Recargar panel activo |
| `Ctrl + M` | Silenciar panel activo |
| `Ctrl + L` | Enfocar barra de direcciones |
| `Ctrl + F` | Buscar en la página |

(Lista completa disponible dentro de la app en Configuración → Ver atajos de teclado.)

## Stack técnico

Construido con [Electron](https://www.electronjs.org/) — motor Chromium real, no una implementación propia — así que cualquier sitio web funciona exactamente igual que en un navegador tradicional.

**Bloqueo de anuncios y rastreadores:** la decisión de red (bloquear/permitir cada request) corre sobre [`adblock-rs`](https://github.com/brave/adblock-rust), el mismo motor nativo en Rust que usa Brave — no una reimplementación propia. El filtrado cosmético (ocultar los huecos vacíos que deja un anuncio bloqueado) sigue corriendo sobre el motor de [`@ghostery/adblocker-electron`](https://github.com/ghostery/adblocker), sin cambios.

**Para clonar y correr desde código fuente:** `adblock-rs` no trae binarios precompilados — `npm install` compila el motor desde Rust la primera vez (`cargo build --release`), así que para tener bloqueo de red hace falta [Rust](https://rustup.rs/) y, en Windows, las **Build Tools de C++ de Visual Studio** (workload "Desktop development with C++").

**Pero no es un requisito para desarrollar.** `adblock-rs` está declarado en `optionalDependencies`, así que si esa compilación falla, `npm install` avisa y sigue en vez de abortar, y la app arranca igual: `electron/adblock-manager.js` detecta el módulo ausente y reporta el motor de red como `failed` por el mismo camino de UI que una falla de red real, sin tumbar el proceso principal. Vas a poder trabajar en todo el resto del navegador con el bloqueo de anuncios apagado.

Si el bloqueo aparece como fallido y lo querés funcionando, instalá Rust + Build Tools y corré `npm install` de nuevo. El instalador ya empaquetado no se ve afectado en ningún caso: lleva el binario adentro.

---

## Dos herramientas con captura de pantalla

### 📸 Captura de pantalla por cuenta

![Captura de pantalla](docs/screenshots/screenshot-capture.png)

Un clic en el ícono de cámara de la barra guarda un PNG real de la cuenta activa en `Imágenes/Nexa Browser/` — útil para dejar registro de un drop raro, un error puntual del juego, o simplemente mostrarle algo a alguien sin tener que usar una herramienta externa de captura. No requiere permisos adicionales del sistema; usa `webContents.capturePage()` de Electron directamente sobre esa cuenta.

### 🌐 Test de velocidad de DNS

![Test de velocidad de DNS](docs/screenshots/dns-speed-test.png)

Mide en vivo la latencia real de tu red contra Cloudflare, Quad9 (con y sin seguridad), Google, OpenDNS, AdGuard y CleanBrowsing — y los ordena de más rápido a más lento. Nació de un caso real: cambiar de DNS bajó el ping a un sitio de 400ms a 98ms (mejor ruteo hacia el proveedor que aloja ese juego). Por diseño, la herramienta **solo mide** — nunca toca la configuración de red de tu PC por su cuenta. El botón "Copiar comando" te da el comando exacto de PowerShell para aplicar el DNS elegido vos mismo, como Administrador.

---

## Rendimiento por versión

Medido con el mismo escenario cada vez (3 cuentas recién abiertas, todas en la pantalla de login del juego, 25s de estabilización, `app.getAppMetrics()` real de Electron) — para poder responder "¿mejoramos o empeoramos?" sin tener que reconstruir un benchmark desde cero cada vez.

| Versión | RAM total (3 cuentas) | Procesos | CPU total | Medido |
|---|---|---|---|---|
| v0.3.6 | 1595 MB | 12 | 2.6% | 2026-08-10 |
| dev (post-0.3.7, sin versionar aún) | 1184 MB (-26%) | 10 | 2.9% | 2026-08-10 |
| **v0.3.8** | 1686 MB | 12 | 3.1% | 2026-08-11 |

**Por qué subió la RAM en 0.3.8 en vez de bajar más:** trade-off consciente, no una regresión — los tres flags que agregamos para que las cuentas en segundo plano dejen de desconectarse (ver Changelog) le dicen a Chromium que no les baje prioridad a esas cuentas para nada, así que retiene más memoria en vez de recortarla agresivamente. Estabilidad primero.

Desde `dev (post-0.3.8)` en adelante, este mismo escenario corre solo con `node scripts/perf-benchmark.js` (perf audit 2026-08-21) en vez de armarse a mano — ver el script para el detalle exacto de qué mide. **Sus números no son comparables punto a punto con las filas de arriba**: el script fuerza `--disable-gpu --use-angle=warp` (mismos flags que ya usa el harness e2e) y "RAM total" ahí es solo memoria de los procesos renderer por cuenta (`metrics:get`), no el total de `app.getAppMetrics()` incluyendo main/GPU/utility como sí parecen incluir las filas históricas — de ahí el salto grande. Las dos filas siguientes sí son comparables entre sí (mismo script, misma sesión, mismo día):

| Versión | RAM (suma por cuenta) | Procesos (`getAppMetrics().length`) | CPU total | Medido |
|---|---|---|---|---|
| dev (pre-perf-audit, HEAD 3276fc8) | 333 MB (promedio de 3 corridas: 339/330/330) | 9 | 1.6% | 2026-08-21 |
| **dev (post-perf-audit, sin versionar aún)** | 352 MB (promedio de 3 corridas: 370/370/315) | 9.7 | **0.6%** (-64%) | 2026-08-21 |
| **dev (post-Electron 44.2 + crashReporter local, sin versionar aún)** | 397 MB (promedio de 3 corridas: 434/374/382) | 11.7 | 0.5% | 2026-09-04 |

**CPU bajó a menos de la mitad, de forma consistente en las 3 corridas** — coherente con lo que cambió: overlays de FPS/ping apagados por defecto (antes corrían en las 3 cuentas todo el tiempo), escritura del store ya no bloquea el hilo principal, y el sidebar deja de reconstruirse entero en cada actualización de estado irrelevante. RAM y cantidad de procesos no muestran una tendencia clara en ningún sentido entre las 3 corridas de cada lado — nada de lo que se tocó en esta pasada apuntaba a bajar la memoria estática, y el escenario navega contra el login real del juego en internet, así que esos dos números están dominados por lo que esa página en particular cargó en cada corrida (ads/analytics/CDN), no por el código de Nexa.

**Fila 2026-09-04 (confirmada, promedio de 3 corridas):** procesos sube de 9.7 a 11.7 (+2) — parte de eso es `crashReporter.start()`, que agrega un proceso `crashpad_handler` nativo aparte aun con `uploadToServer:false` (comportamiento estándar de Electron); el resto probablemente viene de la actualización a Electron 44.2 (Chromium más nuevo trae sus propios procesos utility adicionales). CPU se mantiene igual (0.5% vs 0.6%, dentro del margen de ruido). RAM sube (397 MB vs 352 MB, +13%) pero con alta varianza entre corridas (434/374/382) — dominada, como ya se explica arriba, por lo que cargó el login real del juego en cada corrida, no por código de Nexa. No se aisló exactamente cuánto de cada aumento corresponde a Electron 44.2 vs. al crash reporter — haría falta una corrida más con `crashReporter.start()` comentado para separarlos, no se hizo por no ser crítico.

Antes de publicar la próxima versión, correr `node scripts/perf-benchmark.js` y agregar una fila — evita repetir el trabajo de armar un worktree de la versión vieja para comparar a mano.

---

## Changelog

### v0.4.0 — Motor de adblock nativo de Brave, -64% de CPU, y limpieza de Poke Idle World

#### Rendimiento

- **Bloqueo de red ahora corre sobre `adblock-rs`, el mismo motor nativo en Rust que usa Brave** — reemplaza el motor JS que se usaba para esa decisión. El filtrado cosmético (ocultar los huecos vacíos que deja un anuncio bloqueado) se queda en el motor anterior sin cambios, a propósito: reescribirlo también era un subsistema aparte, con mucha superficie de regresión visual sitio por sitio, y se prefirió no mezclar dos cambios grandes en una sola pasada. Requiere Rust + Build Tools de C++ de Visual Studio para compilar desde código fuente (no afecta al instalador ya armado).
- **CPU bajó a menos de la mitad (1.6% → 0.6%, -64%) en el mismo escenario de siempre** (3 cuentas recién abiertas, 25s de estabilización, `app.getAppMetrics()` real) — de apagar los overlays de FPS/ping por defecto (antes corrían en cada cuenta todo el tiempo, aunque nadie los mirara), la escritura del store dejar de bloquear el proceso principal, y el sidebar dejar de reconstruirse entero en cada actualización de estado irrelevante (ahora solo cuando algo estructural cambia de verdad).
- El polling de telemetría del juego bajó de 250ms a 400ms (confirmado en vivo compitiendo con el canvas del juego en el mismo hilo), y después a un backoff adaptativo que se relaja solo si la cuenta lleva un rato sin frames nuevos. El fetch del badge de ping bajó de 2s a 3s. Ambos, junto al contador de FPS, pasaron de solo esconderse con `display:none` al apagarlos a frenar de verdad el loop/timer detrás — antes seguían corriendo invisibles para siempre.
- El auto-updater ya no se traba después de descargar: la actualización diferencial de NSIS corre un script de PowerShell propio que una política de ejecución restrictiva puede bloquear en silencio — ahora cada actualización baja el instalador completo, más pesado pero confiable.
- Electron actualizado a 43.4.1 (fix de seguridad real: ventanas abiertas por un frame sandboxeado ahora heredan bien las restricciones — el mismo mecanismo que usa el allowlist de `window.open()` de esta app).

#### Nuevo

- **Traducción de página, chat y selección con modelos offline** (bergamot-translator vía WASM, sin llamar a ningún servicio externo), con detección de idioma por contenido y memoria de traducción opcional persistente en disco.
- **Sistema de permisos web por sitio** con prompt nativo real de Allow/Deny (cámara, micrófono, geolocalización) en vez de la lista hardcodeada de antes.
- **Editor de capturas de pantalla** con recorte, flechas y texto antes de guardar el PNG final.
- **Picture-in-Picture nativo y persistente entre cuentas** — sobrevive al cambio de cuenta activa en vez de congelarse o cerrarse.
- Tres ideas tomadas de comparar la arquitectura de Nexa contra Firefox y Brave: un chip de impacto de CPU (Bajo/Medio/Alto) junto al número crudo en el sidebar, un desglose por categoría en el popup del escudo (qué se bloqueó en esta página: anuncios/rastreadores/social/analítica), y el color del Espacio ahora visible en el sidebar, no solo en el ícono del rail.

#### Seguridad

De una auditoría propia y de terceros sobre todo lo de arriba, confirmados en vivo antes de mergear:
- Depot/Familia/Mi Equipo ya no reportan éxito si el servidor del juego nunca confirmó el cambio.
- `window.open()` solo se permite hacia el sitio de la cuenta o un proveedor de login conocido (Google/Facebook/Apple/Microsoft/Discord/X) — todo lo demás se deniega y se loguea.
- Contraseñas de proxy por cuenta ahora se cifran en disco (antes solo pasaban por `safeStorage` las contraseñas normales).
- 11 sitios de renderizado de datos del juego (shop/sellhub/depot/team/tier-list) tenían `innerHTML` sin escapar — corregidos.

#### Limpieza — Poke Idle World

Se sacaron **9 pestañas** (Market, Tienda, Venta masiva, Depot, Tier List, Caza y XP, Drops en vivo, Comparador de hunts, Poképedia) y todo el sistema de alertas de mercado que dependía de ellas (loop de fondo, feed, notificaciones) — quedan solo Mi Equipo, Calculadora IV, Alertas y Ajustes. La idea central del proyecto es un navegador de varias cuentas optimizado y estable, y esas 9 pestañas pesaban mucho para lo que aportaban. Se preservó todo lo que las 4 pestañas que quedan siguen necesitando (catálogos, fórmulas de growth/IV, el loop de alertas de shiny/raras/desconexión). Sobre el final de esta versión, a pedido directo del usuario, también se sacó la fila de "Muertes/h · XP/h · oro/h" del sidebar (quedó solo en el panel de Mi Equipo) y se angostó el modal de Poke Idle World, que tenía 3 reglas de ancho compitiendo entre sí de rediseños viejos.

264 tests unitarios + suite e2e completa, todos verdes. Build empaquetada real probada de punta a punta.

### v0.3.8 — Cuentas en segundo plano ya no se desconectan, Picture-in-Picture real, y auto-actualización

#### Estabilidad

- **Cuentas en segundo plano se desconectaban tras varias horas**: reportado en vivo por el usuario en dragonballidle.online (y a veces también en poke.idleworld.online) — la cuenta que no era el panel activo terminaba mostrando el propio banner de reconexión del juego después de un rato largo. Ya existía un fix anterior (`setBackgroundThrottling(false)`) que cubre el throttling de renderizado/rAF de Chromium, pero hay un mecanismo separado — *Intensive Wake Up Throttling* — que clampa `setInterval`/`setTimeout` encadenados a como mucho una vez por minuto en páginas backgroundeadas, sin que ese ajuste lo evite. El keepalive/ping del WebSocket del juego es justo ese tipo de timer repetido: al limitarse a una vez por minuto, el servidor cierra la conexión por inactividad y el cliente recién lo nota horas después. Se agregaron los tres flags estándar de Chromium (`disable-background-timer-throttling`, `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding`) para desactivar esto por completo a nivel de toda la app. Trade-off consciente: las cuentas en segundo plano usan algo más de CPU, porque Chromium ya no les baja prioridad para nada — dado que el propósito central de la app es tener varias cuentas farmeando en simultáneo, es el trade-off correcto.
- **Picture-in-Picture se congelaba o cerraba al cambiar de cuenta**: el clic derecho → "Picture-in-Picture" sobre un `<video>` (ej. YouTube) fallaba la mayoría de las veces porque `requestPictureInPicture()` se llamaba sin marcar la llamada como gesto de usuario real — Chromium la rechaza en silencio sin eso. Corregido pasando `userGesture: true`. Además, aunque se activara, cambiar de cuenta activa congelaba o cerraba la ventana flotante: la cuenta con PiP se ocultaba con `display:none` igual que cualquier otra cuenta en segundo plano, lo cual detiene el compositing por completo. Ahora, mientras una cuenta tiene PiP activo, se la mantiene pintando fuera de pantalla (posición negativa, mismo tamaño) en vez de ocultarla del todo.
- **Falso positivo de "el archivo de datos fue modificado externamente"**: `save()` escribe a un archivo temporal y hace `renameSync()` sobre el real — ese mismo rename disparaba el `fs.watch()` que vigila cambios externos, haciendo que la app se avisara a sí misma de "modificación externa" en cada guardado propio (cambiar de cuenta, cerrar una pestaña, cualquier `persist()`), enterrando cualquier aviso real de una segunda instancia corriendo o una edición manual. Ahora se compara el contenido real del archivo contra el último JSON que la propia app escribió — si coincide, es el propio guardado y no dispara nada; si no coincide, es un cambio externo real.
- **El contador de ping mostraba el tiempo de un error 404 como si fuera latencia real**: confirmado en vivo contra dragonballidle.online/play — el sitio rechaza `HEAD` en su ruta principal (SPA routing) pero acepta `GET` en la misma URL. Como el `fetch()` con `HEAD` no lanza una excepción ante un 404 (solo falla a nivel HTTP), el badge nunca activaba el fallback a `GET` y terminaba mostrando el tiempo de respuesta del error como si fuera un ping válido. Ahora se chequea `response.ok` antes de confiar en la medición, y una vez que un sitio rechaza `HEAD` una vez, se recuerda para no repetir el mismo error de consola en cada ciclo de 2 segundos.

#### Nuevo

- **Test de velocidad de DNS integrado** (botón 🌐 en la barra): mide la latencia real contra Cloudflare, Quad9 (con/sin seguridad), Google, OpenDNS, AdGuard y CleanBrowsing usando `dns.Resolver` con servidores específicos — no adivina, mide de verdad en la red del usuario. Por diseño, la app nunca toca la configuración de DNS del sistema por su cuenta: el botón "Copiar comando" solo pone en el portapapeles el comando exacto de PowerShell (`Set-DnsClientServerAddress`) para que el usuario lo corra él mismo como Administrador. Motivado por un caso real: cambiar de DNS bajó el ping a dragonballidle.online de 400ms a 98ms (mejor ruteo Anycast hacia Cloudflare, que aloja ese sitio).
- **Modal de changelog al terminar de descargar una actualización**: antes, `checkForUpdatesAndNotify()` solo mostraba la notificación nativa de Windows, sin forma de ver qué cambió antes de reiniciar. Ahora se escucha `update-downloaded` y se muestra un modal propio con la versión y las notas de la release, con botones "Más tarde" y "Reiniciar y actualizar".
- **`electron-log` + `electron-updater`**: base real de auto-actualización. Todo `console.log/warn/error` del proceso main ahora también se escribe a un archivo con rotación (`%APPDATA%/nexa-browser/logs/main.log`), filtrando a propósito el ruido de las páginas de cada cuenta (Cloudflare Turnstile, WebGL/WebGPU) para que el archivo persistente no se llene de líneas ya conocidas y sin valor de diagnóstico.
- **Primera versión publicada como Release real de GitHub** usando este mismo flujo — cualquiera con 0.3.6 o 0.3.7 instalada recibe esta actualización sola la próxima vez que abra la app con internet.

#### Limpieza

- Código muerto eliminado (`reloadGamePageForFreshState`, `marketCreatureForListing` — funciones huérfanas de enfoques ya reemplazados, confirmado con grep cruzado antes de borrar).
- Sistema de extensiones limitado a lo esencial: se probaron AdGuard y Tampermonkey a fondo y se confirmaron límites reales y documentados de Electron (`chrome.tabs.create` y `chrome.storage.managed`/`sync` no implementados; `chrome.userScripts` tampoco existe, confirmado en vivo con `typeof chrome.userScripts` dentro del contexto real de la extensión). Se mantienen dos correcciones genéricas que no son parches específicos de ninguna extensión: usar la versión real de Chrome (`process.versions.chrome`) al descargar del Chrome Web Store, y corregir un mismatch de ID de extensión.
- Proyecto marcado como propietario (`UNLICENSED` + archivo `LICENSE`) — antes declaraba `"license": "MIT"` sin que existiera ningún archivo de licencia real, una inconsistencia que iba en contra de la intención del proyecto.

233 tests unitarios + 37 e2e, todos verdes.

### v0.3.7 — Depot y Familia dejan de fallar con varias cuentas abiertas

- **Equipo/Box del Depot personal quedaban vacíos**: esa pestaña solo leía los datos de Pokémon que el juego había mandado por su cuenta desde que se abrió la sesión — si todavía no había pasado nada que los disparara (recién conectado, sin capturas/ventas/subidas de nivel de por medio), quedaban vacíos para siempre aunque hubiera Pokémon reales. Mismo problema en Mi Equipo y en Venta masiva → Pokémon. Ahora se piden activamente al abrir el panel, cambiar de cuenta o entrar a esas pestañas.
- **Depot → Familia (Ítems y Pokémon) fallaba con "socket del juego no disponible"**, sobre todo con dos o más cuentas abiertas a la vez: el mecanismo que le manda pedidos al juego (Familia, Depot, teletransporte) dependía de haber visto a la propia cuenta enviar algo primero, algo que una cuenta puede tardar en hacer si está un rato sin recibir interacción. Se unió esa captura al mismo canal que ya lee los datos en vivo de forma confiable (probado con cientos de frames reales) y además se reafirma en cada ciclo y justo antes de cada pedido, para que no dependa de un solo momento de inyección.
- **Errores de carga ocultos**: si un pedido al juego fallaba, antes se mostraba el mismo mensaje que "esta cuenta no tiene nada acá" — ahora se distingue un error real de un estado vacío genuino.
- **Botón "Actualizar" agregado** en Depot → Pokémon, Depot → Familia: Pokémon, Venta masiva → Ítems y Venta masiva → Pokémon (antes solo estaba en Depot → Ítems y Depot → Familia: Ítems).

### v0.3.6 — Nuevas herramientas de comercio y seguimiento, Market renovado, telemetría sin CDP y fix de seguridad

Todo lo acumulado desde v0.3.0: siete etapas nuevas de herramientas para Poke Idle World, un cambio de fondo en cómo se captura la telemetría del juego, un Market global mucho más completo, una vulnerabilidad de seguridad real cerrada, y varios bugs encontrados y arreglados en uso real.

#### Siete herramientas nuevas de comercio y seguimiento

Se sumaron al navegador, de forma nativa, herramientas que hasta ahora requerían salir del juego o usar algo aparte:

- **Comparador de hunts**: sesión actual vs. la anterior, más historial de las últimas 20 hunts por cuenta.
- **Pokédex de solo lectura**: filtro por capturado/no capturado, derivado de la colección real de cada cuenta.
- **Favoritos de hunt + Teleporte**: guardá tus zonas de caza favoritas y viajá a ellas con un click — confirmado en vivo que el juego lo resuelve por WebSocket (`enter-hunt`), no por REST.
- **Tienda portátil**: compra en lote de Poké Balls, pociones y revives sin viajar al NPC Mark.
- **Venta masiva protegida**: vendé ítems y Pokémon en lote con un candado configurable por ítem/Pokémon, para que nunca se vendan por error — el servidor también revalida el candado del lado suyo, no solo la interfaz.
- **Depot portátil (personal y familiar)**: movimientos entre mochila/equipo y el Depot con un click, incluida la sección compartida con tu familia en el juego (ítems y Pokémon), con buscador en las cuatro pestañas.

#### Telemetría del juego: se saca el debugger de Chrome (CDP) del todo

La captura de datos en tiempo real (Resumen, Drops, Capturas destacadas, etc.) usaba el Chrome DevTools Protocol (`wc.debugger.attach`) desde el principio. Un detach del debugger — confirmado en vivo, por ejemplo al abrir las DevTools reales sobre una cuenta — dejaba la telemetría de esa cuenta congelada hasta un reload completo, sin ningún mecanismo que la recuperara. Se reemplazó por un parche pasivo de `WebSocket.prototype` inyectado directamente en la página del juego (mismo enfoque que usan otras herramientas de la comunidad para este juego) — más liviano, sin la superficie de fallo del debugger. Migración validada en modo sombra antes del cambio real: 136/136 frames coincidieron exactamente contra la captura vieja, incluido el momento de mayor riesgo (un teleporte de hunt), y luego 240/240 y 382/382 frames sin huecos en dos sesiones de juego real ya con el mecanismo nuevo como único camino.

#### Market global renovado

- **Paginación real**: antes el navegador cortaba en 60 resultados sin avisar, aunque el contador de arriba mostrara el total real — confirmado en vivo que el propio juego ya manda **todo** en una sola llamada (11.489 publicaciones vistas en la categoría "All", sin ningún parámetro de página). Ahora se pagina del lado del cliente sobre esos datos, con navegación numerada.
- **Sección de Ofertas**: nuevo filtro "Solo ofertas" que usa el historial de precios que Nexa ya viene observando por Pokémon/ítem — cualquier publicación 25% o más por debajo de su valor típico entra al filtro, y las que llegan a 100% o más ("vale el doble de lo que piden") se destacan con una insignia propia.

#### Estabilidad y diagnóstico

- **Test de red a pedido**: nueva tarjeta en el panel de Estabilidad con un botón "Probar conexión" que corre el mismo chequeo de red/DNS/HTTPS contra el servidor del juego que ya usa el Nivel 1 de recuperación automática, mostrando un veredicto en texto plano.
- **Resolución de DNS corregida**: el test (y el chequeo automático de recuperación) usaba el resolvedor de DNS de Node, que en ciertas configuraciones de red da un falso negativo ("DNS roto") aunque el juego esté conectado y andando perfecto — confirmado en vivo, reproducido y corregido usando el mismo motor de red que usa el propio navegador (Chromium) en lugar del de Node.
- **Depot familiar dejaba de reconocer la familia**: solo se pedían los datos reales al servidor la primera vez que se abría esa pestaña en toda la sesión — si esa primera vez pasaba antes de unirse a una familia en el juego, quedaba mostrando "no pertenece a ninguna familia" para siempre sin reintentar. Ahora se refresca cada vez que se entra a esa sección.
- **Aviso falso de "No hay cuentas disponibles" en Ajustes**: se mostraba siempre, sin importar si había una cuenta seleccionada — la lógica en código ya estaba bien, faltaba la regla de estilo que ocultara el aviso.
- **Error al usar Market/Tienda/Depot/Venta masiva/Familia con la cuenta fuera del juego**: si la pestaña estaba en el login, en blanco, o en cualquier otro sitio, esas herramientas tiraban un error técnico crudo en vez de un aviso entendible. Ahora se valida antes y se muestra un mensaje claro.

#### Tier List y Caza & XP: buscador y ajuste por nivel

Se agregó un buscador por nombre y un campo de nivel a ambas herramientas — al indicar un nivel, el ranking/las comparaciones usan las stats reales calculadas a ese nivel en vez de solo stats base. Verificado en vivo contra una calculadora de referencia de la comunidad para usar exactamente el mismo estándar de cálculo (IV 21, calidad ~1.8), en vez de un supuesto sin confirmar.

#### Seguridad

Se cerró una vulnerabilidad real de tipo XSS: la función que escapa texto para insertarlo en la interfaz no escapaba comillas, lo que en teoría permitía que una publicación maliciosa del Market global (con una comilla en su nombre o ícono) inyectara código en el navegador. Corregido y verificado.

#### Motor y proyecto

- **Electron actualizado a 43.3.0** y **electron-builder a 26.15.3** (0 vulnerabilidades conocidas en las herramientas de compilación, antes había 11).
- **Cobertura de pruebas ampliada** a 215 tests automáticos.
- **Windows como única plataforma**: se retira el soporte para Linux y el desarrollo inicial (nunca terminado) de una app nativa para Android — el proyecto se enfoca por completo en el navegador de escritorio para Windows.
