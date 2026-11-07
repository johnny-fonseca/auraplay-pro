# Palco Esmeralda (`palco-esmeralda`)

Tema de Karaoke para AuraPlay Pro: un **palco de ópera** en terciopelo esmeralda, latón bruñido y un único rubí de acento. Concepto **nuevo** (no extiende Cinema, Neón, Kinético, Guilloché Zafiro ni Yozakura).

> **Estado:** paquete autocontenido **no conectado ni probado en AuraPlay Pro** (no hubo acceso al repositorio). Para conectarlo, sigue `INTEGRATION.md`.

## Archivos y orden de carga

| Archivo | Rol |
|---|---|
| `karaoke/palco-esmeralda/palco-esmeralda.css` | Tokens, escenario CSS, cabecera, selector, letras, dock, controles, progreso, responsive, accesibilidad |
| `karaoke/palco-esmeralda/palco-esmeralda-effects.js` | Escena Canvas 2D registrada como `palco-esmeralda` (script clásico, IIFE, sin dependencias) |
| `karaoke/palco-esmeralda/README.md` | Este documento |
| `karaoke/palco-esmeralda/INTEGRATION.md` | Guía de conexión para quien tenga el repositorio |

Orden: `karaoke/shared/karaoke-core.js` **→** `palco-esmeralda-effects.js` (ambos `<script defer>`). Si el núcleo falta, el plugin lanza un error con el mensaje de qué cargar y en qué orden. Si el script se incluye dos veces, la segunda carga no vuelve a registrar.

## Dirección de arte (resumen de diseño)

- **Metáfora:** el instante previo a que se alce la voz en un teatro a la italiana: telón recogido con embrasses, bambalina festoneada, luces de rampa. El escenario es la letra.
- **Materialidad:** terciopelo (pliegues cilíndricos, pelusa, brillo de pelo que solo vive en las crestas), latón (filetes, cuentas, cordón, borlas, copas de las lámparas), un rubí cabujón en cada medallón y polvo en suspensión.
- **Luz:** cálida y direccional desde abajo (rampa) y desde los cantos superiores (haces laterales); el esmeralda queda frío y profundo para que el latón y el marfil de la letra lean como la luz del escenario.
- **Composición por planos:** fondo = muro del escenario (CSS, `#kBg` + velo `.k-overlay`); medio = cortinas y haces (Canvas); primer plano = bambalina, borlas, rampa y destellos (Canvas); encima, todo el chrome HTML.
- **Balance asimétrico intencionado:** cortina izquierda un 10 % más ancha y recogida más arriba (60 %) que la derecha (67 %, 10 % más estrecha); semillas de pliegue distintas; el destello de cada lado va desfasado.
- **Centro libre:** el Canvas no dibuja nada sobre la columna central. Las motas conservan un 12 % de su opacidad sobre el eje central y solo alcanzan el 100 % a una distancia del eje ≥ 46 % del ancho (junto a los bordes); los haces y las cortinas viven en el 16–20 % lateral; la luz de rampa se concentra en el borde inferior, detrás del dock (translúcido). El velo `.k-overlay` (≈ 0,90–0,93 de opacidad en el centro) fija el contraste de la letra incluso con carátulas claras.

### Inventario de decisiones visuales

| Decisión | Dónde | Propósito |
|---|---|---|
| Cortinas con pliegues irregulares + sombreado vertical + pelusa | Canvas (caché) | Material creíble, enmarca sin competir |
| Máscara de crestas (`hi`) × banda cálida móvil | Canvas | Brillo de terciopelo real: solo las crestas atrapan luz |
| Filete de latón con cuentas siguiendo el canto interior | Canvas (caché) | Contorno lujoso que delimita el “escenario” |
| Embrasse trenzado + medallón con rubí + borla colgante | Canvas | Detalle de autor; punto de acento reactivo |
| Bambalina festoneada con cordón y flecos | Canvas (caché) | Cierra el marco superior y da un fondo oscuro a la cabecera |
| Rampa de lámparas con brillo viajero | Canvas | Respuesta localizada a graves; ancla el dock |
| Haces laterales | Canvas (`lighter`) | Profundidad atmosférica |
| Polvo en suspensión | Canvas (pool fijo) | Escala y aire; respuesta a agudos |
| Destellos pausados en latón | Canvas (≤ 14 puntos) | Brillo de joyería sin parpadeo |
| Filete de latón que crece bajo la palabra activa | CSS `::after` + `--word-p` | Marca de progreso **no solo cromática** |
| Botón principal de latón, resto en esmeralda translúcido | CSS | Jerarquía clara de controles |
| Cierre con borde y hover rubí | CSS | Acento secundario con función (salida) |

## Mini guía de estilo

### Tipografía por rol (stacks de sistema, sin descargas)

| Rol | Stack (resumen) | Peso / estilo | Tamaño | Interlineado | Tracking | Notas |
|---|---|---|---|---|---|---|
| Letra principal | Palatino Linotype → Book Antiqua → Palatino → Iowan Old Style → URW Palladio → Hiragino Mincho / Yu Mincho / Noto Serif CJK JP → Georgia → Times → `serif` | 600, normal | `clamp(1.6rem, 1.05rem + 2.7vw, 3.1rem)` (≤ 640 px: `clamp(1.4rem, 1rem + 3.4vw, 2rem)`) | 1,22 (1,26 móvil; 1,18 pantalla baja) | 0,004em | Sin mayúsculas forzadas, `font-kerning: normal`, ligaduras discrecionales/históricas desactivadas, `text-wrap: balance`, puntuación intacta |
| Título | Baskerville → Baskerville Old Face → Hoefler Text → Garamond → Mincho/Noto CJK → Times → `serif` | 600, normal | `clamp(1.05rem, .92rem + .7vw, 1.55rem)` | 1,2 | 0,01em | `overflow-wrap: anywhere` |
| Artista | Mismo stack que título | 400, *cursiva* | `clamp(.85rem, .8rem + .3vw, 1.1rem)` | 1,3 | 0,02em | Color latón claro |
| Interfaz / controles | Optima → Candara → Gill Sans → Segoe UI → Calibri → Hiragino Sans / Noto Sans CJK → Helvetica Neue → Arial → `sans-serif` | 400 (primario 700) | `clamp(.85rem, .8rem + .25vw, 1rem)` | — | — | Frase en minúsculas/normal; sin versalitas ni tracking extremo |
| Tiempos | `ui-monospace`, SF Mono, Menlo, Consolas, Liberation Mono → `monospace` | 400 | `clamp(.72rem, .68rem + .2vw, .85rem)` | — | — | `font-variant-numeric: tabular-nums` |

El tamaño de la letra se declara con `:where()` (especificidad 0) para que mande el tamaño del núcleo / botones A−/A+ si ya lo definen. Sin caligrafía decorativa: el ornamento se resuelve con Canvas, no con texto.

### Paleta semántica

| Token | Valor | Uso |
|---|---|---|
| `--pe-abyss` | `#030907` | Fondo más profundo, velo, viñeta |
| `--pe-pine` | `#06150f` | Fondo medio / atmósfera (degradado de `.k-bg`) |
| `--pe-velvet-deep` | `#0a2419` | Terciopelo en sombra; marco de carátula |
| `--pe-velvet` | `#0f3a2a` | Terciopelo medio; base de controles (`--pe-dock-control` a .55) |
| `--pe-velvet-lit` | `#1c6a4b` | Cresta de pliegue; hover (`--pe-dock-hover` a .62) |
| `--pe-brass-deep` | `#7d5f2b` | Latón oscuro: bordes internos, inicio del filete |
| `--pe-brass` | `#c9a45c` | **Acento primario**: bordes, pulgar, botón principal |
| `--pe-brass-lit` | `#ecd49b` | Latón brillante: artista, relleno de progreso, letra cantada inferior |
| `--pe-ivory` | `#f6f0df` | **Texto principal** |
| `--pe-sage` | `#a9bdb0` | Texto secundario (tiempos, etiquetas, línea futura de respaldo) |
| `--pe-ruby` / `--pe-ruby-lit` | `#d1475f` / `#ff8da0` | **Acento secundario**: cierre, destellos de golpe en rubíes |
| `--pe-ink` | `#160f03` | Texto sobre latón (botón principal) |
| `--pe-focus` | `#ffe9a8` | Anillo de foco visible (2 px + separación 2 px + corona oscura 4 px) |
| `--pe-dock` | `rgba(5,17,12,.84)` | Superficie del dock y selector |
| `--pe-dock-control` / `-hover` / `-active` | `rgba(15,58,42,.55)` / `rgba(28,106,75,.62)` / `rgba(125,95,43,.55)` | Superficie de control normal / hover / pulsado |
| `--pe-line` / `--pe-line-strong` | `rgba(201,164,92,.38)` / `rgba(236,212,155,.72)` | Borde normal / hover-activo |
| `--pe-track` / `--pe-track-line` | `rgba(246,240,223,.16)` / `rgba(201,164,92,.30)` | Pista de progreso y su contorno |
| `--pe-halo` / `--pe-shadow` | `rgba(236,212,155,.40)` / `rgba(0,0,0,.58)` | Halos y sombras |
| Decoración Canvas | `abyss, pine, vDeep, velvet, vLit, bDeep, brass, bLit, ivory, warm #ffe2a0, ruby, rubyLit` | Constante `PAL` del plugin (mismos valores que los tokens, más `warm` para luz) |

### Estados de letra

Los tokens se definen en cada `.k-line` (contrato del núcleo); el mecanismo de relleno (`background-clip:text`, `--word-p`) es **el compartido** y no se redefine.

| Estado | Rest (no cantado) top → bot | Sung (cantado) top → bot | Extra |
|---|---|---|---|
| Línea futura / pasada (`.k-line` no actual) | `#a3b9ac → #8aa497` | `#d6c79a → #b9a06a` (la pasada queda más tenue que la actual) | Escala 0,9; color de respaldo `--pe-sage` |
| Línea actual (`.k-line.current`) | `#b9cabe → #9fb7a9` | `#fff6dc → #ecd49b` | Escala 1; sombra oscura + halo latón (`filter: drop-shadow` en la línea, no `text-shadow`, porque este último se pinta sobre el relleno recortado); entrada de 0,6 s |
| Palabra aún no cantada (`data-state="next"`) | `--k-rest-*` de su línea | — | Sin filete |
| Palabra activa (`data-state="active"`) | parte aún sin recorrer | parte recorrida | Borde de luz `--k-edge` = `rgba(255,236,176,.9)`, ancho `0.3em` (`0.56em` con `data-sustain="1"`); filete de latón inferior con el mismo avance (`::after`, ancho = `--word-p`) |
| Palabra ya cantada (`past`) | — | `--k-sung-*` | — |
| Pausa | Igual: el reloj no avanza, el progreso queda congelado | | El Canvas relaja el audio a 0 y ralentiza el ambiente al 30 % |
| Sin progreso por palabra (línea simple) | `color` de línea (`--pe-sage`) | `color` de línea actual (`--pe-ivory`) | No se inventan tiempos |
| Sin `background-clip:text` | `--pe-sage` | `--pe-brass-lit` | `@supports not (...)` con texto sólido |
| Colores forzados | `CanvasText` | `Highlight` (activa) | Sin recorte de texto |

> `--k-edge-w` y `--k-edge-w-sustain` están declarados en `em`. **Contrastar la unidad** con un tema existente (ver `INTEGRATION.md` §1).

### Controles

| Control | Normal | Hover | Active / pressed | Disabled | `:focus-visible` |
|---|---|---|---|---|---|
| `.k-control` | texto `#f6f0df`, fondo esmeralda .55 con brillo superior, borde `--pe-line` | fondo `--pe-dock-hover`, borde `--pe-line-strong`, sube 1 px | fondo `--pe-dock-active`, sombra interior, escala .97 | opacidad .45, sin sombra | anillo `#ffe9a8` 2 px + corona oscura |
| `.k-control.primary` | degradado latón, texto `#160f03` (700), halo suave | más claro, escala 1,03 | más oscuro, escala .96, sombra interior | (igual que control) | igual |
| `.k-close` | borde rubí .55 | fondo rubí .34, borde `#ff8da0` | igual que control | — | igual |
| `.k-style-btn` | transparente, texto sage | fondo hover, borde `--pe-line` | fondo `--pe-dock-active` | — | igual |
| `.k-style-btn[aria-pressed="true"]` | texto marfil, brillo de latón, borde `--pe-line-strong` | — | — | — | igual |
| `#kProgress` | pista 6 px, relleno latón (vía `--pe-progress`), pulgar de latón 16 px | pulgar ×1,2 con halo | pulgar ×1,1 | — | igual |

## Mapeo de movimiento (audio → componente)

| Fuente | Componente | Ataque / relajación | Límite |
|---|---|---|---|
| `bands.bass` + `beat.pulse` | Lámparas de rampa, luz de rampa, haces laterales | 70 ms / 550 ms | Opacidad de haz ≤ 0,16; lámpara ≤ 0,95 |
| `bands.mid` | Balanceo de franjas de cortina (0,5–2,1 px), brillo de pelo, balanceo de borlas | 140 ms / 750 ms | Brillo ≤ 0,65 |
| `bands.high` | Brillo de motas y de los destellos en latón | 90 ms / 450 ms | Destello ≤ 0,85, ciclo 4,5–9,5 s |
| `beat.hit` × `beat.strength` | Barrido del destello por la cortina (+0,18 de altura), rubíes de los medallones | 90 ms / 350 ms (el impulso decae con τ ≈ 0,8 s) | Rubí ≤ 0,9; **sin flashes de pantalla** |
| Reloj ambiental | Deriva de motas, destello lento (periodo ≈ 57 s), ola suave en las lámparas | — | Lento y continuo |
| `playing === false` | Audio → 0; ambiente al 30 % de velocidad | — | — |
| `reduced` o `motion === 0` | Composición **estática y determinista** (reloj fijo, sin balanceo, sin deriva, sin audio) | — | La letra sigue sincronizada |

## Karaoke palabra por palabra

**Este tema depende del efecto compartido; no lo sustituye.**

Flujo esperado (a verificar en el repositorio):

1. La fuente de letras entrega `words: [{ time, end, text, space }]` en **segundos**.
2. El tracker (`AuraLRC.createTracker`) compara `currentTime` del reloj de audio + desfase de letras y produce `wordIndex` y `wordProgress` ∈ [0, 1], equivalente a `clamp((currentTime + offset − word.time) / max(0.05, word.end − word.time), 0, 1)`.
3. `js/player.js` escribe el progreso en la propiedad inline de cada `.k-word`. **Hoy se observa `--p` como fracción 0–1**, mientras que el CSS compartido y el lector del núcleo esperan **`--word-p` en porcentaje (`0%`–`100%`)**.
4. El CSS compartido usa `background-size` ligado a `--word-p` con `background-clip: text` para revelar la capa cantada; el tema solo aporta colores.

**Hay que resolver el puente `--p` ↔ `--word-p` antes de declarar la sincronía integrada**; el tema no puede hacerlo desde CSS decorativo. `INTEGRATION.md` §6 describe cómo.

Requisitos del LRC: solo hay barrido por palabra/sílaba si la fuente trae tiempos por palabra/sílaba y el parser/player los conserva. Con marcas solo por línea, el tema muestra la línea actual completa (color de respaldo) y **no inventa tiempos**.

El tema evita: sobrescribir o reiniciar `--word-p`, fijar `background-size`, tocar `background-image`/`background-clip` de `.k-word`, usar `color`/`-webkit-text-fill-color` que anulen el recorte (salvo en el `@supports not`, las traducciones y colores forzados, donde es intencional), o animaciones temporizadas independientes del audio.

## Contrato del frame y suposiciones

Campos usados: `w`, `h`, `dpr`, `dt` (ms), `bands.bass|mid|high`, `beat.pulse|hit|strength`, `q`, `motion`, `reduced`, `playing`. (`tm` y `beat.bpm` no se usan.) Sin helpers de `core.helpers`: el plugin trae los suyos.

| Suposición | Dónde se ajusta |
|---|---|
| `w`/`h` en px CSS con `ctx` ya escalado por `dpr` | Constante `FRAME_IN_DEVICE_PX` (arriba del plugin) |
| El núcleo no pinta nada antes de la escena en el mismo canvas | Constante `CLEAR_FIRST` |
| `q` es fracción (0–1] o nivel entero 2–4 (4 = máximo), o un objeto con `scale`/`density`/`level` | Función `qualityScale()` |
| `motion === 0` significa “sin movimiento” | `_update()` (variable `calm`) |
| `beat.pulse` ∈ [0, 1], `beat.hit` booleano de un frame | `_update()` |
| `resize(frame)` se llama al cambiar tamaño; además el plugin reconstruye si cambian `w`, `h`, `dpr` o el nivel de calidad | `_prepare()` |

Tres niveles de calidad (según `q`): motas 18/30/46; franjas de cortina 14/22/30; densidad de pliegues, pelusa y flecos reducida; destellos 7/10/14; con el nivel más bajo el destello de pelo se refresca cada 3 frames. Con histéresis para no reconstruir en bucle.

## Contraste (cálculo WCAG 2.x reproducible, colores planos)

Fórmula de luminancia relativa y razón (L1+0,05)/(L2+0,05). Fondo de letra = velo `rgb(8,30,22)` a 0,93 sobre carátula de **peor caso** (blanco → `rgb(25,46,38)`; negro → `rgb(7,28,20)`). Dock = `rgba(5,17,12,.84)` sobre blanco puro (muy conservador → `rgb(45,55,51)`).

| Par | Razón | Mínimo |
|---|---|---|
| Letra futura `#8aa497` / fondo (carátula blanca) | 5,38 | 4,5 ✓ |
| Letra futura de línea actual `#9fb7a9` / fondo | 6,74 | 4,5 ✓ |
| Letra pasada `#b9a06a` / fondo | 5,69 | 4,5 ✓ |
| Letra cantada `#ecd49b` / fondo | 9,92 | 4,5 ✓ |
| Letra cantada `#fff6dc` / fondo | 13,36 | 4,5 ✓ |
| Texto principal `#f6f0df` / fondo (carátula negra) | 15,57 | 4,5 ✓ |
| Artista `#ecd49b` / `#030907` (plano) | 13,82 | 4,5 ✓ |
| Texto de control `#f6f0df` / control | 11,05 | 4,5 ✓ |
| Texto de control / control en hover | 7,38 | 4,5 ✓ |
| Tiempos `#a9bdb0` / dock | 6,20 | 4,5 ✓ |
| Botón principal `#160f03` / latón `#f3dfaa`, `#c9a45c`, `#a8843f` | 14,45 · 8,11 · 5,47 | 4,5 ✓ |
| Foco `#ffe9a8` / dock | 10,24 | 3 ✓ |
| Borde fuerte / dock | 5,22 | 3 ✓ |
| Pulgar `#c9a45c` / pista | 3,29 | 3 ✓ |
| Borde de cierre `#ff8da0` / dock | 5,61 | 3 ✓ |

**Pendiente (no medido en navegador):** contraste real sobre el Canvas en movimiento (el cálculo supone color plano y no incluye cortinas, haces ni motas), con carátulas reales y con el `drop-shadow` activo. No se declara conformidad medida.

## Validaciones: hechas y no hechas

**Hechas (estáticas / entorno de apoyo, sin AuraPlay):**

- `node --check` del plugin: sin errores de sintaxis.
- Arnés de humo en Node con un canvas simulado (no renderiza): `resize`/`draw` con 1280×720, 1920×1080, 390×844, 844×390, pausa, `reduced`, `motion=0`, varios formatos de `q`, frames vacíos/NaN/`dt` negativo o enorme → sin excepciones, sin NaN en operaciones de dibujo, sin `drawImage` de fuentes vacías; la doble carga no registra dos veces; con `reduced` la secuencia de dibujo es idéntica con o sin audio y con distinto `dt`. Con ese canvas simulado: ≈ 190 `drawImage` por frame a calidad máxima y ≈ 90 con `q ≈ 0,5`; cachés ≈ 2,8 Mpx a 1280×720 con dpr 2. **Esas cifras no son tiempos de GPU.**
- CSS: llaves y paréntesis balanceados; las 28 variables `--pe-*`/`--k-*` usadas están definidas; los 95 selectores quedan bajo `#karaokeOverlay[data-karaoke-style="palco-esmeralda"]` salvo la muestra; un solo `@keyframes` (`pe-line-in`); sin `!important`, `url()` ni `@import`; slug uniforme en CSS, JS y nombres de archivo.

**No hechas (requieren el proyecto real):** carga en AuraPlay, selector y persistencia, sincronía palabra por palabra real, build de producción y minificado, renderizado visual, contraste medido en navegador, rendimiento real, pruebas en móvil/landscape reales, lectores de pantalla.

## Notas para quien integre

- Los nombres de los tokens `--k-*` “de estructura” (panel, botón, pista…) son **de mejor esfuerzo**; todos los componentes además se estilan con selectores directos, así que el tema funciona aunque no coincidan. Compara con `karaoke-common.css` y elimina o renombra los alias que sobren.
- `#kProgress` se estila como `<input type="range">`. Si es otro elemento, adapta ese bloque. El relleno en WebKit necesita `--pe-progress` (ver `INTEGRATION.md` §7).
- Las clases de tiempos y de traducción no figuran en el contrato; se cubren de forma genérica (`.k-progress`, `.k-line small`, `[class*="trans"]`). Verifícalas.
- `.k-overlay` se asume como capa de velo entre `#kBg` y `#kFx`. Si es un contenedor, quita su `background` y sube el oscurecimiento a `.k-bg`.
