# Prompt autónomo: crear un tema de Karaoke listo para conectar a AuraPlay Pro

Copia todo el bloque **PROMPT** y entrégalo a una IA que no tiene acceso a AuraPlay Pro ni puede leer archivos del proyecto. La IA debe producir un paquete autocontenido, compatible con el contrato descrito y acompañado de instrucciones de integración suficientemente concretas para que una persona con acceso al repositorio solo tenga que conectar los archivos y ejecutar las verificaciones. No debe afirmar que modificó el proyecto.

---

## PROMPT

Actúa como diseñador/a e ingeniero/a frontend senior especializado/a en interfaces musicales, CSS, Canvas 2D, Web Audio, sincronización de letras, accesibilidad, rendimiento y documentación técnica. **No tienes acceso al repositorio ni a ningún archivo del proyecto. No intentes buscar, abrir, modificar ni afirmar que probaste el código de AuraPlay Pro.** Usa como contrato de integración la información completa de este prompt y marca de forma explícita cualquier incertidumbre o supuesto.

Tu tarea es diseñar e implementar el paquete visual de un tema nuevo para el Karaoke de AuraPlay Pro, y preparar una guía de conexión precisa para otra persona. Esa persona tendrá acceso al repositorio y será responsable de aplicar la guía, adaptar solo los detalles que no coincidan y probar el resultado en la app real. No le dejes la tarea de inventar el diseño, terminar el CSS, implementar la escena, decidir los estados de letras o deducir qué archivos necesita.

## A. Datos del encargo

- Nombre visible: **[NOMBRE; opcional]**
- Slug ASCII en minúsculas: **[slug; opcional]**
- Concepto, ambiente y materiales: **[DESCRIPCIÓN; opcional]**
- Colores preferidos: **[PALETA; opcional]**
- ¿Crear un concepto nuevo o extender un tema existente?: **[NUEVO / EXTENDER / opcional]**

Si faltan valores, elige una dirección original y completa sin preguntar. El slug debe ser seguro para directorios, CSS y atributos HTML: minúsculas ASCII, números o guiones; sin espacios ni acentos. No reutilices slug existente.

## B. Contexto fijo de AuraPlay que debes respetar

AuraPlay Pro usa una app web estática con esta arquitectura de Karaoke:

- El overlay anfitrión es `#karaokeOverlay`, controlado con `data-karaoke-style="[slug]"`.
- El núcleo compartido es `karaoke/shared/karaoke-core.js`. Registra escenas con `window.AuraKaraokeCore.registerScene(slug, SceneClass)` y las consume en el canvas `#kFx.k-fx`.
- El flujo temporal de letras corresponde a `js/lrcParser.js`/`AuraLRC.createTracker`, `js/player.js` y los estilos comunes. Las líneas/palabras usan tiempos en segundos; el tracker consulta el reloj de audio `currentTime` (segundos), suma el desfase de letras y calcula `wordIndex`/`wordProgress` entre el inicio y fin de cada palabra. El reproductor actualiza el DOM con `requestAnimationFrame` durante reproducción y vuelve a sincronizar ante seek/cambio de offset/pausa.
- La escena es un plugin visual Canvas 2D, no un reproductor. No renderiza letras ni controles, no procesa audio propio y no duplica el núcleo.
- CSS compartido: `karaoke/shared/karaoke.css` (estructura del overlay, cabecera, selector, dock y layout) y `karaoke/shared/karaoke-common.css` (tokens de estilo, tipografía, capas de letra sincronizada, controles, barra, responsive, calidad y movimiento reducido).
- Estilos existentes: **Cinema**, **Neón**, **Kinético**, **Guilloché Zafiro**, **Yozakura** y **Palco Esmeralda**. Son referencias para no repetir; sus identidades están descritas más adelante.
- La vista ya cuenta con estas capas/controles. El trabajo nuevo debe darles estilo mediante CSS, no recrearlas: `#kBg.k-bg`, `.k-overlay`, `#kFx.k-fx`, `.k-header`, `.k-track-art`, `.k-track-title`, `.k-track-artist`, `.k-style-picker`, `.k-style-btn`, `.k-style-preview`, `.k-lyrics-viewport`, `.k-lyrics`, `.k-line`, `.k-line.current`, `.k-word`, `.k-footer`, `.k-progress`, `.k-controls`, `.k-control`, `.k-control.primary`, `.k-close`, `.k-offset`, `#kProgress`, `#kPlay`, `#kPrev`, `#kNext`, `#kFontDown`, `#kFontUp`, `#offsetMinus`, `#offsetPlus`, `#offsetReset`, `#kLoadLrc`, `#btnKaraokeRealFs`, `#btnKaraokeClose`.
- El selector tiene botones `.k-style-btn` con atributo `data-karaoke-style`; la muestra usa `.k-style-preview.[slug]`. La persona integradora agregará el botón nuevo y manejará `aria-pressed`.
- Los scripts del núcleo y cada escena se cargan como scripts clásicos con `defer`; el núcleo debe preceder al plugin. `js/player.js` restaura/persiste el estilo y permite cambiarlo desde los botones y el ciclo de estilos.
- Los archivos de tema deben residir en `karaoke/[slug]/`: `[slug].css`, `[slug]-effects.js`, `README.md`. No guardes minificados en fuentes.
- El build usa `scripts/build-production.js`; requiere añadir al inventario de recursos de Karaoke el CSS y JS del tema, limpiar posibles minificados anteriores de su carpeta y reescribir en `dist/index.html` las URL fuente a sus URL `.min.css` y `.min.js`.
- La documentación global está en `karaoke/README.md`.

**No supongas que estos detalles garantizan que todos los archivos vigentes coincidan exactamente.** La persona integradora debe contrastar selectores, orden y allowlists con el repositorio antes de aplicar. Tu paquete debe, sin embargo, proporcionar nombres de archivo, código completo y puntos de inserción inequívocos basados en este contrato.

## C. Identidades visuales existentes: no duplicar

Usa estas descripciones para diseñar una dirección nueva, no para hacer una mera recoloración:

- **Cinema:** paisaje azul profundo, auroras y cintas de luz lentas, destellos anamórficos, grano sutil y letras serif elegantes.
- **Neón:** synthwave magenta/cian, sol retro, rejilla en perspectiva, estrellas, scanlines y letras de tubo luminoso.
- **Kinético:** póster impreso cálido en rojos/naranjas/amarillos, rayos giratorios, anillo de espectro, semitono y letras condensadas con sombras duras.
- **Guilloché Zafiro:** orfebrería de reloj de gala sobre zafiro nocturno; rosetas guilloché en esquinas opuestas, capas contrapuestas con moiré lento, bisel elíptico reactivo al audio, aguja luminosa, ondas finas en golpes y destellos pausados. Paleta abismo `#04060e`, tinta `#070b1d`, zafiro `#0b1433`, platino `#eef1f8`, escarcha `#c9d6ff`, oro rosa `#e8aa90`, champán `#f4d9c2`; serif didona de sistema.
- **Yozakura (夜桜):** hanami nocturno como grabado ukiyo-e por capas; estrellas, luna/halo, bruma dorada, rama de cerezo, Fuji y cordilleras lejanas, pétalos arrastrados por el viento. Graves respiran halo/bruma; medios modulan viento, montañas y rama; agudos iluminan anillos lunares/estrellas; golpes liberan ráfagas con pocos pétalos. Movimiento sereno, sin flashes. Paleta tinta sumi `#05070f`, índigo `#0b1030`, añil `#1a2a5e`, luna `#f1e3b5`, sakura `#f4b6c6`, sakura profundo `#e07a99`, washi `#f6efe0`, oro `#d9b56a`, bermellón `#c8372d`; serif/Mincho de sistema.
- **Palco Esmeralda:** palco de ópera italiano en terciopelo esmeralda profundo, latón bruñido y acentos de rubí; cortinas laterales plegadas con abrazaderas y borlas, bambalina ornamental, rampa cálida de lámparas, haces laterales y polvo suspendido, dejando libre el centro para la letra. Graves hacen respirar la rampa y los haces; medios mecen con suavidad cortinas y borlas; agudos despiertan motas y destellos metálicos pausados; los golpes producen breves acentos de rubí y barridos de luz, sin flashes. Paleta abismo `#030907`, pino `#06150f`, terciopelo `#0f3a2a`, cresta esmeralda `#1c6a4b`, latón `#c9a45c`, latón claro `#ecd49b`, marfil `#f6f0df`, salvia `#a9bdb0` y rubí `#d1475f`; serif editorial y sans de sistema.

Si el encargo pide extender uno de estos temas, conserva su concepto, paleta y composición; no lo conviertas accidentalmente en otro tema. Si pide uno nuevo, evita motivos, composiciones y paletas reconocibles de estas identidades.

## D. Requisito esencial: karaoke palabra por palabra

**Todo tema que generes debe funcionar con el efecto compartido de karaoke palabra por palabra. No basta con cambiar el color de la línea completa.** El reproductor crea spans `.k-word` para líneas que contienen `words: [{time, end, text, space}]` (marcas en segundos), el tracker compara el reloj actual del audio más el offset y produce `wordIndex`/`wordProgress` normalizado de 0 a 1. El player escribe hoy ese progreso en la propiedad inline `--p`; el CSS de capas y el rastreador de escena compartidos leen `--word-p` en porcentaje. **Hay, por tanto, dos nombres/unidades que deben conectarse explícitamente en la integración real**: inspecciona su estado vigente y crea una única conversión coherente (por ejemplo, mapear `--p` a `--word-p: calc(var(--p, 0) * 100%)`, o hacer que el player escriba directamente un `--word-p` porcentual, y actualizar de forma coordinada el lector del core si lo requiere). No supongas que el tema puede resolver por sí solo este puente desde CSS decorativo. La escena compartida usa `data-state="past|active|next"` y lee opcionalmente `data-sustain="1"` para el seguimiento sostenido; confirma quién asigna `data-sustain` antes de depender de ello.

1. Cada palabra debe revelar progresivamente su capa “cantada”, sincronizada con el reloj de audio: para palabra `i`, el progreso esperado es `clamp((currentTime + offset - word.time) / max(0.05, word.end - word.time), 0, 1)`, expresado en la unidad/formato que consuma el CSS. Las palabras anteriores quedan completas, las posteriores vacías y la activa parcial; la siguiente empieza cuando su timestamp lo indique. La luz/borde sigue la palabra cuyo progreso parcial está activo. Respeta pausa (el reloj de audio deja de avanzar), reanudación, seek hacia adelante/atrás y cambios de offset.
2. El motor compartido usa capas de texto con `background-image`, `background-size` vinculado a `--word-p`, `background-clip: text` y `-webkit-background-clip: text`. En el contrato CSS actual `--word-p` es porcentaje (`0%` a `100%`); el player observado escribe `--p` como fracción decimal (`0` a `1`) y el core inspecciona el valor inline `--word-p` para localizar palabra activa. La persona integradora debe verificar ambos lados y asegurar que CSS, player y core usen un puente único, con unidades compatibles y sin contar dos veces la conversión. Los temas suministran tokens visuales, normalmente `--k-sung-top`, `--k-sung-bot`, `--k-rest-top`, `--k-rest-bot`, `--k-edge`, `--k-edge-w` y `--k-edge-w-sustain`. Define valores coherentes con la paleta en cada `.k-line`; no reemplaces el mecanismo común.
3. No sobrescribas ni reinicies `--word-p`, no congeles `background-size`, no uses una regla de `color`/`-webkit-text-fill-color` que haga invisible el texto o anule el recorte, y no hagas que reglas con mayor especificidad ganen sobre el relleno compartido. No reemplaces el sincronizado por una animación temporizada CSS independiente del audio ni inventes clases de estado.
4. Estados del núcleo que se deben considerar: palabra siguiente/no cantada, palabra actual (`data-state="active"`) y palabra ya recorrida (`past`/progreso completo, según la implementación real). El núcleo compartido puede aplicar `--word-p: 0%` a líneas no actuales y `100%` a líneas pasadas. Mantén contraste en todas ellas, durante pausa, seek, cambio de tema y traducción.
5. Añade fallback legible si `background-clip:text` no está disponible. Respeta movimiento reducido sin apagar la lectura ni eliminar la sincronía temporal.
6. Si el audio/LRC solo contiene marcas por línea, no afirmes que hay sincronía real por palabra/sílaba: no inventes timestamps. El barrido detallado funciona cuando la fuente entrega tiempos por palabra/sílaba y el parser/player los conserva.
7. Incluye en la guía de integración el flujo exacto desde timestamps `word.time`/`word.end` (segundos), reloj de audio + offset, tracker (`wordIndex`/`wordProgress` 0–1), propiedad inline que escribe el player y formato porcentual que consume CSS/core. Identifica y resuelve la discrepancia `--p` vs `--word-p` antes de declarar integrada la sincronía. Prueba `--word-p` en 0%, valor parcial y 100%, palabra siguiente, pausa/reanudación, seek atrás/adelante y offset. Señala que hace falta verificación en navegador para aprobar visualmente.

## E. Estándar de dirección de arte: ultra hi-end

Apunta a un producto digital de lujo con acabado editorial/cinematográfico, no a un skin básico hecho de un fondo plano, un gradiente genérico y unos botones recoloreados. La experiencia debe parecer diseñada por un estudio especializado: concepto singular, composición deliberada, detalle y coherencia entre escenario, letras, chrome y microinteracciones. “Premium” significa riqueza controlada y precisión, no saturar la pantalla con brillos.

Antes de codificar, escribe para ti una dirección de arte breve (no hace falta mostrar razonamiento interno): metáfora visual, materialidad, paleta, tipografía, luz, profundidad, movimiento y cómo se reserva el centro para la letra. Refleja el resultado en el README como resumen de diseño.

Criterios mínimos de acabado:

- **Composición por planos:** crea una escena con primer/medio/fondo y profundidad atmosférica; los elementos principales enmarcan la zona de letra y nunca compiten con ella. Define áreas de reposo visual y balance asimétrico intencionado, no decoración dispersa al azar.
- **Materiales creíbles:** traduce el concepto a tratamientos coherentes (por ejemplo metal cepillado, esmalte, papel, vidrio, tinta, seda, piedra o cerámica) con luz direccional, bordes, grano o relieve sutiles. Evita acumular `box-shadow`, blur, glow y gradientes sin función material.
- **Detalle de autor:** incorpora varias familias de detalle complementarias —filetes/ornamentos, patrón fino, motas o partículas controladas, geometría distintiva, acentos reactivos al audio y cambios de estado— con densidad adaptable. Deben leerse como un sistema, no como una colección de efectos aleatorios. Incluye microinteracciones pulidas para selector, hover/pressed, play principal, seek, foco y aparición/cambio de línea.
- **Jerarquía editorial:** da escala y carácter diferentes a título/artista, letra activa, letras vecinas, etiquetas/tiempos y controles. La letra sincronizada siempre domina la jerarquía y mantiene forma abierta, lectura rápida y puntuación intacta.
- **Movimiento con intención:** combina reposo con movimiento lento de ambiente y respuesta musical localizada. Especifica qué banda/transitorio mueve cada componente, suaviza ataque/relajación, limita amplitud y evita parpadeo, jitter o desplazamientos bruscos. El movimiento debe aumentar la sensación de material/espacio, no distraer.
- **Acabado de producto completo:** cabecera, selector, dock, botones, progreso, tiempos, foco, estados vacíos/pausa, móvil y landscape deben pertenecer al mismo lenguaje visual. Ningún componente puede parecer control HTML por defecto o quedar sin diseñar. Conserva feedback visible y accesibilidad.
- **Restricción de calidad:** evita soluciones básicas como un solo radial-gradient, formas geométricas genéricas sin relación con el concepto, emojis como iconografía, texto decorativo ilegible, efectos de neón indiscriminados o un gran canvas detrás de las letras. Cada efecto debe tener propósito descrito.

Entrega en el README un inventario de decisiones visuales (composición, materiales, paleta, tipografía, motion mapping, tratamiento de controles) y una breve explicación de cómo la escena mantiene el centro legible. El nivel visual esperado debe ser claramente más elaborado que una demostración/prototipo, manteniendo código optimizado y accesibilidad.

## E.1. Requisitos de diseño integral

El resultado visual no es solo el canvas. Debe tener una propuesta consistente para:

- fondo/cielo, atmósfera y ornamentación animada;
- cabecera/caratula/título/artista;
- selector de estilo y muestra del botón;
- letras no actuales, línea activa y palabras cantadas/no cantadas;
- dock compartido, barra de progreso y tiempos;
- botones anterior, play/pause, siguiente, tamaño de letra, desfase +/-/reset, carga `.lrc`, pantalla completa y cierre;
- estados hover, active, focus-visible, disabled, pressed y controles ocultos/visibles si los estilos anfitriones los usan;
- responsive móvil, pantalla baja, controles envueltos sin recortar, contraste y movimiento reducido.

El dock y sus acciones siguen perteneciendo al HTML/player anfitrión. No crees un dock paralelo. El selector que genere la guía debe conservar botones existentes y marcar el nuevo con `aria-pressed="false"` inicialmente; la app pondrá el activo al seleccionar.

### Tipografía, color y sistema visual (entrega obligatoria)

Antes de escribir CSS, define una mini guía de estilo y aplícala coherentemente. No basta con elegir una fuente y una paleta: especifica qué rol cumple cada valor y cómo se utiliza.

- **Tipografía por rol:** elige stack de sistema sin descargas para letra principal, título/artista, controles/interfaz y, si aplica, caracteres CJK/japoneses. Declara fallbacks reales (serif/sans/monospace adecuados), pesos, estilo, tamaño relativo, interlineado, tracking, transformación de caja y reglas para diacríticos/puntuación. La letra debe priorizar lectura a distancia; evita fuentes ultrafinas, tracking extremo, mayúsculas obligatorias o ligaduras que dificulten leer la canción. Si el concepto usa caligrafía decorativa, limítala a ornamento/títulos, no al texto sincronizado.
- **Paleta semántica:** presenta una tabla con nombre/token, valor HEX/RGBA y uso: fondo más profundo, fondo medio/atmósfera, superficie del dock, superficie hover/activa, texto principal, texto secundario/no cantado, texto cantado, acento primario, acento secundario, borde, foco visible, progreso/track/thumb, botón primario/etiqueta, sombras/halos y decoración Canvas. Cada token debe tener una función clara; evita reutilizar un color brillante para todos los estados.
- **Estados de letra:** indica exactamente qué color/efecto corresponde a línea futura, línea actual, palabra aún no cantada, palabra activa (incluido borde/halo), palabra ya cantada, pausa y fallback sin progreso por palabra. El texto no cantado debe mantener contraste suficiente; la capa cantada puede ser más brillante pero no debe depender solo del color para comunicar progreso.
- **Controles:** define texto/fondo/borde normal, hover, active/pressed, disabled y focus-visible; el botón principal (play/pause) debe diferenciarse con contraste claro. Define el tratamiento del track, relleno y thumb de progreso y los estados ARIA del selector.
- **Contraste y robustez:** apunta a contraste WCAG 2.2 AA como referencia (4.5:1 para texto normal, 3:1 para texto grande y componentes/contornos relevantes), con una breve tabla o cálculo reproducible de los pares principales. Si no puedes medirlo en navegador, indícalo como comprobación pendiente; no declares conformidad medida sin datos. El diseño debe seguir legible sobre fondos con movimiento, artwork claro/oscuro y brillo de Canvas.
- **Responsive:** define cómo cambia la escala tipográfica y el dock en móvil y pantallas bajas sin truncar letras ni controles. Usa `clamp()` con límites razonables, unidades relativas y wrapping seguro.
- Entrega estos tokens/documentación tanto en el README del tema como en el CSS. No uses variables indefinidas ni dependas de colores que supuestamente proporcione la portada.

Define los tokens `--k-*` que consume la estructura compartida para tipografía, colores, panel/dock, borde/anillo del dock, botón primario, barra/track, thumb, foco, sombras y letras. Verifica coherencia interna de todas las variables y evita referencias no definidas. Los estilos del tema deben quedar bajo `#karaokeOverlay[data-karaoke-style="[slug]"]`, excepto la muestra `#karaokeOverlay .k-style-preview.[slug]` y keyframes con nombres exclusivos. No alteres otros temas.

## F. Plugin Canvas y contrato de datos

Entrega un plugin JavaScript clásico, sin `import`/`export`, sin dependencias externas, encerrado en IIFE y compatible con `<script defer>`. Debe validar el núcleo y registrar exactamente el slug:

```js
(function (global) {
  'use strict';
  var core = global.AuraKaraokeCore;
  if (!core || typeof core.registerScene !== 'function') {
    throw new Error('Mensaje claro: cargar karaoke-core.js antes del plugin [slug].');
  }
  class ThemeScene {
    constructor() { this.mask = 0; }
    resize(frame) { /* reconstruir caches dependientes del tamaño/calidad */ }
    draw(ctx, frame) { /* escena Canvas 2D */ }
  }
  core.registerScene('[slug]', ThemeScene);
})(typeof window !== 'undefined' ? window : globalThis);
```

Adapta sintaxis ES clásica si la compatibilidad lo requiere, pero preserva el contrato. No uses propiedades del frame no declaradas aquí sin indicarlo como supuesto a verificar. Campos disponibles/esperados para plugins: `w`, `h`, `dpr`, `dt` (ms), `tm` (ms), `bands.bass`, `bands.mid`, `bands.high`, `beat.pulse`, `beat.hit`, `beat.strength`, `beat.bpm`, `q` (presupuesto/calidad, por ejemplo barras/partículas), `motion` (0/1), `reduced`, `playing`. Los helpers posibles están bajo `core.helpers` e incluyen `TAU`, `clamp`, `lerp`, `rand`, `easeOut`, `expK`, funciones de color, `seeded`, `makeCanvas`, `K` y `bit`; usa solo los que requieras. La clase devuelve/no emite partículas compartidas con `mask = 0` salvo que verdaderamente necesite un tipo documentado.

Requisitos del canvas:

- dibuja únicamente ornamentación de fondo/contorno; deja la zona central de letras libre;
- movimiento y audio suavizados; implementa pausa y `reduced` de forma determinista;
- cachea sprites/geometría en resize; no crees arrays, gradientes, DOM ni canvases costosos por frame;
- respeta el presupuesto de calidad y baja densidad/coste en niveles inferiores;
- usa `ctx.save()`/`ctx.restore()` con `try/finally`; protege tamaños mínimos, frames incompletos y rutas de error;
- sin imágenes, fuentes, paquetes ni red externa.

## G. Archivos que debes entregar

Entrega el contenido íntegro de todos estos archivos; no uses pseudocódigo, `...`, secciones omitidas ni código que dependa de contexto no entregado:

1. `karaoke/[slug]/[slug].css` — todos los estilos visuales exclusivos, tokens completos, muestra de selector, palabras sincronizadas, controles y accesibilidad.
2. `karaoke/[slug]/[slug]-effects.js` — escena completa y registrada.
3. `karaoke/[slug]/README.md` — concepto, paleta, funcionamiento, orden de carga, contrato, requisitos de LRC, pruebas hechas/no hechas y notas para integrador.
4. `karaoke/[slug]/INTEGRATION.md` — guía paso a paso para la persona con acceso al proyecto. Debe contener:
   - lista de archivos fuente y dependencias;
   - fragmentos exactos a añadir al `<head>` (stylesheet), al `.k-style-picker` (botón) y a la zona de scripts (plugin tras el núcleo), con ubicación anclada al nombre de los elementos/scripts conocidos;
   - lista exacta de los allowlists/funciones del reproductor que debe inspeccionar y actualizar: valor inicial/restauración de `karaokeStyle`, `_applyKaraokeStyle(style)`, `setKaraokeStyle(style)`, `cycleKaraokeStyle()` y actualización ARIA/estado activo; no asumir que sus líneas o forma exacta son inmutables;
   - cambios precisos para `scripts/build-production.js`: arrays de assets JS/CSS, carpeta para limpieza `.min`, y expectativa de reescritura `.min.js`/`.min.css` en `dist/index.html`;
   - actualización recomendada de `karaoke/README.md` y conteo de recursos de Karaoke después de añadir exactamente dos recursos (un JS y un CSS);
   - checklist de pruebas en navegador y build de producción;
   - cualquier supuesto que el integrador deba contrastar en archivos vigentes.

La guía debe ser lo bastante específica para que la persona integradora solo tenga que comprobar el contexto real, insertar las conexiones, ejecutar el build y corregir incompatibilidades puntuales. No inventes números de línea ni presentes fragmentos como si fueran parches aplicados. Si el encargo pide expresamente únicamente un paquete visual desconectado, dilo en el encabezado; de lo contrario, entrega siempre la guía.

## H. Validación que debes hacer antes de responder

No tienes el repositorio, por lo tanto separa claramente validaciones estáticas que sí puedes hacer (autorrevisión del código, llaves/selectores balanceados, consistencia de nombres, slug uniforme, ausencia de dependencias externas) de pruebas que no puedes hacer (ejecución real, build, renderizado, contraste medido en navegador). No afirmes haber ejecutado `node --check`, build, pruebas o navegador si no dispones de entorno real.

Autorrevisión obligatoria:

1. CSS y JS usan exactamente el mismo slug y filenames.
2. El plugin comprueba núcleo, registra una sola vez y respeta el orden de carga descrito.
3. El CSS conserva `--word-p` y el `background-clip`/relleno progresivo compartido, define colores para cantado/no cantado y no vuelve invisible `.k-word`.
4. Todos los tokens consumidos por CSS tienen valores o fallbacks; dock y botones no quedan transparentes, ocultos ni con bajo contraste.
5. `prefers-reduced-motion`, línea simple sin tiempos por palabra y traducción/fallback no rompen la lectura.
6. La guía de integración incluye cada punto anfitrión y build, y no dice que el proyecto ya fue editado.

## I. Formato de respuesta

Empieza con un resumen corto del nombre/slug y del concepto escogido. Después entrega exactamente cuatro bloques de archivo, cada uno con su ruta como encabezado y un bloque de código completo apropiado (`css`, `js` o `md`). Termina con una lista breve de lo que la persona integradora debe verificar en el proyecto real y con una declaración explícita de que los archivos aún no están conectados ni probados en AuraPlay porque no tienes acceso al repositorio.
