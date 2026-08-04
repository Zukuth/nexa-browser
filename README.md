# Nexa Browser

**El navegador de escritorio pensado para quienes manejan varias cuentas a la vez.**

Nexa Browser te deja abrir varias sesiones completamente aisladas del mismo sitio —distintas cuentas de Gmail, redes sociales, plataformas de trabajo, juegos online— todas al mismo tiempo, en una sola ventana, sin perfiles de Chrome separados ni ventanas de incógnito por todos lados.

[![VirusTotal](https://img.shields.io/badge/VirusTotal-0%2F66%20detections-brightgreen?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/529da74d5400672edb009ce3ca8efff2a81dbab6c52e2b642e629056166f3bf6/detection)

**Escaneado en VirusTotal: 0/66 motores antivirus lo marcaron como malicioso** ([ver análisis completo](https://www.virustotal.com/gui/file/529da74d5400672edb009ce3ca8efff2a81dbab6c52e2b642e629056166f3bf6/detection)) — análisis hecho sobre `Nexa Browser-Setup-0.2.1-x64.exe`, el instalador tal cual se publica en [Releases](https://github.com/Zukuth/nexa-browser/releases/latest).

## Por qué instalarlo

Si alguna vez tuviste que:
- Abrir cinco ventanas de incógnito para manejar cinco cuentas del mismo sitio,
- Perder tiempo cerrando sesión y volviendo a entrar solo para revisar otra cuenta,
- O simplemente querés un navegador liviano que no te coma la PC mientras tenés todo eso abierto a la vez,

Nexa Browser está armado exactamente para ese problema.

## Ventajas principales

### 🗂️ Multi-cuenta real, no pestañas disfrazadas
Cada cuenta corre en su propia sesión aislada de Chromium: cookies, almacenamiento local y login completamente separados entre sí. Podés tener 5 Gmail, 3 cuentas de un juego o varias redes sociales abiertas en simultáneo sin que se pisen entre ellas.

### 🧩 Organización en Espacios y layouts flexibles
Agrupá tus cuentas en Espacios (trabajo, personal, gaming, lo que necesites) y elegí cómo verlas: panel único, cuadrícula automática, columnas, filas, o modo libre con paneles que arrastrás y redimensionás a tu gusto.

### ⚡ Bajo consumo, sin sacrificar fluidez
El motor interno está optimizado a propósito: los guardados se agrupan en vez de escribir a disco en cada clic, el redimensionado de ventana no recompone todo de una, y cada cuenta solo se re-renderiza cuando realmente cambia algo. Resultado: varias cuentas abiertas a la vez sin que la PC se ponga pesada.

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

## 🎮 Poke Idle World — panel de herramientas integrado

Para quienes juegan [Poke Idle World](https://poke.idleworld.online), Nexa Browser trae un panel propio (botón 🎮 en la barra superior) que lee en vivo los datos que el propio juego transmite — **de solo lectura: nunca automatiza capturas ni toca el captcha**.

- **📊 Resumen en vivo**: muertes/hora, XP/hora, oro/hora, capturas/hora y shinies, sumado en tiempo real por cada cuenta abierta.
- **🧬 Calculadora de Growth/IV y Quality**: la fórmula real del juego, portada y verificada — elegí una captura o un Pokémon del equipo para autocompletar, sin tipear nada, y mirá el veredicto (Excepcional a Bajo) según el % de IV real.
- **🏆 Tier List**: ranking del roster completo por percentil de stats base, con bono de Clan opcional. Al elegir un Pokémon se muestra su línea evolutiva y sus matchups de tipo más fuertes y más débiles.
- **⚔️ Caza & XP**: XP/hora y oro/hora reales de cada especie cazable, con el multiplicador de daño de tu atacante actual contra cada tipo.
- **💰 Drops en vivo**: todo lo que sueltan tus kills en la sesión actual, con ícono e valor real a precio NPC — separado por cuenta si tenés varias abiertas.
- **✨ Capturas destacadas**: log en tiempo real de todo lo capturado en la sesión, con sprite, quality e IV.
- **🔔 Alertas nativas**: notificaciones de Windows para shiny, capturas raras, desconexión/reconexión y pocas balls, configurables una por una.

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

---

## Changelog

### v0.3.0 — Market Sniper, Optimizador de Memoria y Correcciones Mayores

#### Correcciones críticas

**Saldo siempre mostraba "—"**
El saldo de oro de cada cuenta se leía desde frames WebSocket del tipo `player` que el juego envía de forma constante, pero esas frames no se reconocían como fuente confiable. El renderer solo muestra datos provenientes de `visual-hud`, `visual-shop`, `visual` y `adjusted`. Se añadió un conjunto `WALLET_FRAME_TYPES` en `game-telemetry.js` que marca automáticamente como confiables las frames de tipo `player`, `balance`, `wallet`, `trainer` y `account`. El saldo ahora aparece en tiempo real desde que abrís la pestaña, sin necesidad de visitar la tienda ni recargar.

**Compras recargaban la página e interrumpían el farmeo**
Después de cada compra exitosa en el Market, el sistema llamaba a `wc.reload()` para "refrescar el estado del juego". Esto cortaba el movimiento del personaje, reseteaba el nivel visible del Pokémon en pantalla y obligaba al usuario a esperar el re-login. Se eliminó esa llamada por completo. El ítem ahora llega al depósito vía sincronización WebSocket silenciosa, sin recargas ni interrupciones.

**"Pestaña NaN" en el historial de compras**
La función `displayName(account)` se llamaba sin pasar el índice del array, lo que resultaba en `undefined + 1 = NaN`. Se corrigió usando `findIndex` para obtener el índice real y pasarlo correctamente.

**Botones X flotaban fuera de las tarjetas de alerta**
Los badges y botones de cerrar en las tarjetas del Market usaban `position: absolute` con `z-index` alto, lo que los sacaba del flujo de `overflow: hidden` de la tarjeta y aparecían superpuestos sobre el modal. Se envolvieron en un `div.market-alert-header` con `display: flex`, eliminando el posicionamiento absoluto.

---

#### Market Sniper — mejoras completas

**Feed ampliado y TTL extendido**
El feed de alertas pasó de 5 a **20 entradas**, y el tiempo de vida de cada alerta subió de 5 a **30 minutos**. Las alertas más viejas se descarten automáticamente al vencerse o cuando el feed se llena.

**Filtro de precio máximo**
Se agregó un campo "Precio máximo (sniper)" en la sección de Alertas. Si se configura un valor mayor que 0, el sniper solo genera alertas para Pokémon cuyo precio de venta en el Market esté por debajo de ese límite. Los listings más caros se ignoran silenciosamente, reduciendo el ruido en el feed.

**Click en notificación navega directo al Pokémon**
Antes, hacer click en la notificación de escritorio de Windows solo abría la app. Ahora abre el panel lateral, desplaza automáticamente hasta la sección Market y resalta con un pulso visual azul (tres destellos) exactamente la tarjeta del Pokémon alertado. Desde ahí podés ver los detalles o comprarlo directamente.

---

#### Optimizador de memoria ⚡

Se agregó un botón **⚡ Optimizar** en la barra de estado inferior. Al pulsarlo, el navegador limpia la caché HTTP y la Cache Storage de todas las sesiones activas sin cerrar ninguna cuenta ni borrar cookies, localStorage ni datos de sesión. Los usuarios siguen logueados y el farmeo no se interrumpe.

**Auto-optimización a las 24 horas**: si el navegador lleva más de 24 horas sin optimizar, el botón se ilumina en amarillo para avisar que hay memoria acumulada. La limpieza también se ejecuta automáticamente en segundo plano al llegar a ese umbral.

---

#### Detector de personaje congelado

Si una cuenta lleva más de 4 minutos sin registrar actividad (kills/XP = 0) estando conectada, el navegador pulsa la conexión WebSocket del juego mediante CDP para forzar la reconexión al servidor. También despacha los eventos `focus` y `nexa-reconnect` para despertar el ciclo de React del juego. El proceso es completamente silencioso — no hay notificación, no se recarga la página — y opera máximo una vez cada 5 minutos por cuenta.

---

#### Otras mejoras

- **URL por defecto**: las nuevas pestañas abren en `poke.idleworld.online/login` en lugar de Google.
- **`fs.watch` en el archivo de datos**: si algo modifica el archivo de configuración fuera del proceso (un editor de texto, un script externo), el navegador detecta el cambio y registra una advertencia en consola.
- **Eventos post-compra saneados**: se eliminaron `online` y `visibilitychange` de los eventos que el script de sincronización post-compra dispara en el contexto del juego. Esos eventos disparaban reconexiones WebSocket innecesarias.
