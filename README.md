# Nexa Browser

**El navegador de escritorio pensado para quienes manejan varias cuentas a la vez.**

Nexa Browser te deja abrir varias sesiones completamente aisladas del mismo sitio —distintas cuentas de Gmail, redes sociales, plataformas de trabajo, juegos online— todas al mismo tiempo, en una sola ventana, sin perfiles de Chrome separados ni ventanas de incógnito por todos lados.

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

### 🔄 Actualizaciones automáticas
El navegador se actualiza solo — no tenés que estar pendiente de bajar la última versión a mano.

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
