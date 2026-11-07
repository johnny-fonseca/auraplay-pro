# Prompt autónomo para crear un visualizador nuevo de AuraPlay Pro (v2)

## 0. Cómo leer este prompt

- Este documento es **autocontenido**. No tienes acceso al repositorio ni a archivos del proyecto. Todo lo necesario sale de aquí.
- Las secciones marcadas **[OBLIGATORIO]** son requisitos de aceptación. Las marcadas **[REFERENCIA]** describen cosas que ya existen y sirven para **evitarlas**, no para imitarlas.
- Si dos instrucciones parecen chocar, prevalece la sección 4 (restricción de no repetición) sobre cualquier estética de la sección 12.
- Sé honesto sobre lo que hiciste y lo que no: no afirmes haber editado, abierto, ejecutado o probado nada que no hayas hecho realmente (ver sección 10).

---

## 1. Objetivo [OBLIGATORIO]

Diseña e implementa **un visualizador de música nuevo** para **AuraPlay Pro**, un reproductor web local de audio. Debe poder integrarse después en un reproductor existente.

No rehagas el reproductor, no inventes que inspeccionaste el proyecto y no dependas de archivos internos que no se describen aquí. La temática, la metáfora visual y el nombre final los decides tú, **después** de investigar.

---

## 2. Investigación previa [OBLIGATORIO]

Antes de proponer ninguna temática, busca en Internet inspiración en visualización musical, arte generativo, Canvas 2D, Web Audio API o visuales audiovisuales interactivos.

1. Consulta **al menos tres** proyectos, demos, artículos o experimentos reales y distintos entre sí.
2. Prefiere fuentes originales o páginas de sus autores, no imágenes de buscadores.
3. Abre o lee de verdad cada fuente que cites. No cites una página solo por su título en un resultado de búsqueda.
4. Anota, para cada fuente: enlace, **una frase** con la idea visual o técnica que tomaste y cómo la adaptaste sin copiarla.
5. Explora **al menos tres direcciones candidatas** y descarta explícitamente las que se acerquen a los estilos existentes (sección 4) antes de elegir una.
6. Revisa la licencia si reutilizas código o assets. Por defecto, escribe una implementación **original y sin dependencias**; las técnicas generales de dominio común (ruido, fBm, marching squares, etc.) no requieren atribución de código, pero sí cita el artículo que te inspiró.
7. Si no tienes navegación web, dilo claramente y trabaja con una propuesta original. **No inventes fuentes ni enlaces.**

---

## 3. Restricción principal: no repetir lo existente [OBLIGATORIO]

AuraPlay Pro ya cuenta con estos once estilos **[REFERENCIA]**. La propuesta nueva debe ser reconociblemente distinta en metáfora, silueta, geometría, composición y comportamiento:

1. **Ferrofluido líquido**: metal líquido, muelles físicos, gotas, salpicaduras, ondas de choque y crestas alrededor de la portada.
2. **Aurora cromática**: cintas o bandas de luz curvas, fluidas y deformadas.
3. **Reactor espectral**: espectro LED segmentado, picos, barras radiales, anillos y elementos HUD circulares.
4. **Nebulosa de partículas**: vórtice de estrellas, partículas, constelaciones y explosiones con el beat.
5. **Túnel hiperespacial**: punto de fuga, viaje hacia el centro, anillos, estelas, warp y aberración cromática.
6. **Mandala caleidoscopio**: simetría radial, pétalos, reflejos y capas rotatorias.
7. **Prisma cristalino**: cristales facetados, polígonos de vidrio, refracción, dispersión y haces de luz.
8. **Halo osciloscópico**: waveform real, ecos de la forma de onda, halo circular y brillo anamórfico.
9. **Micelio bioluminiscente**: red orgánica de hifas, ramificaciones, anastomosis, nodos, puntas y esporas.
10. **Constelación musical**: retícula orgánica de signos musicales grandes (negras, blancas, pares de corcheas, silencios y notas con banderas) **mezclados por toda la retícula** y animados con el audio según la familia de cada signo (ver Anexo A).
11. **Mosaico de guijarros**: módulos redondeados tipo guijarro en un mosaico reactivo al sonido.

### 3.1 Elementos que no pueden ser el lenguaje principal

- círculos concéntricos, anillos, mandalas o simetría radial;
- barras verticales, columnas LED o un ecualizador tradicional;
- partículas, estrellas, polvo, esporas o lluvia de puntos;
- redes ramificadas, venas, micelio, grafos o constelaciones;
- cintas ondulantes tipo aurora;
- cristales, polígonos facetados o refracción;
- túneles, zoom hacia el centro, warp o punto de fuga central;
- una forma de onda dibujada literalmente;
- notación musical o glifos de partituras;
- mosaicos de guijarros o módulos ovalados como composición principal;
- metal líquido, gotas, salpicaduras, muelles o blobs gelatinosos;
- una portada rodeada por un aura circular como composición principal;
- **un resplandor perimetral uniforme alrededor de la forma**, que la haga leerse como un halo.

Los efectos secundarios de la lista (p. ej. unos destellos puntuales) pueden aparecer como acento, nunca como lo que define la identidad. Si descubres que tu propuesta se parece a alguno de los estilos, **cambia la metáfora y la composición antes de escribir código**.

### 3.2 Prueba de silueta

Antes de implementar, comprueba mentalmente que, reducida a una miniatura de 120 px y vista como una mancha de un solo color, tu propuesta **no** se confunde con un anillo, un halo, un mandala ni un ecualizador.

---

## 4. Forma obligatoria [OBLIGATORIO]

La composición general debe tener una **forma redondeada, orgánica o suavemente curvada**: silueta, bordes, volúmenes, masas, contornos o módulos suaves y continuos, sin esquinas agresivas.

Esto **no** significa un círculo, un anillo ni una composición radial. No uses la redondez como excusa para reutilizar geometrías circulares ya existentes. La forma debe mantener identidad propia y una lectura visual distinta.

La composición debe quedar **contenida dentro del canvas** con margen, incluso con graves fuertes y sensibilidad máxima. Si algo se acerca al borde, debe desvanecerse suavemente en lugar de recortarse en seco.

---

## 5. Comportamiento musical [OBLIGATORIO]

El visualizador debe reaccionar de forma clara y musicalmente legible, y mantener una animación estable tanto con música como en silencio.

### 5.1 Fuentes de datos (contrato)

```js
audioGraph.getDataArray();   // Uint8Array de frecuencias, 0–255, o null
audioGraph.getTimeDomain();  // Uint8Array centrado ≈128, o null
```

- Ambos métodos pueden devolver `null`, lanzar una excepción o no existir. El visualizador no debe fallar en ninguno de esos casos.
- No conoces la frecuencia de muestreo. **Define las bandas como fracciones de la longitud del array** (por ejemplo, graves ≈ primer 1 %, medios ≈ hasta el 5 %, agudos ≈ hasta el 30 %), no en Hz fijos, y documenta tus fracciones.
- Normaliza las bandas de forma adaptativa (pico con caída lenta y un suelo mínimo) para que funcione con pistas de distinto volumen, y aplica la sensibilidad sobre esa señal normalizada.

### 5.2 Mapeo requerido

- **Graves:** estructuras grandes, volumen, expansión o peso visual.
- **Medios:** cambios de forma, articulación o movimiento intermedio.
- **Agudos:** detalle, textura, precisión o actividad fina.
- **Energía total:** intensidad general y velocidad de evolución.
- **Beat:** un evento reconocible, breve (≈150–300 ms) y controlado. Detéctalo con un umbral relativo a una media móvil, con tiempo de reposo entre disparos.
- **Silencio o señal débil:** animación mínima, elegante y visible, que se mezcla suavemente con la señal real.
- **Suavizado:** ataque rápido y caída lenta, interpolación independiente del framerate, límites y easing. Nada debe parpadear ni saltar entre frames.

No dibujes `getTimeDomain()` como waveform si eso acerca la propuesta al Halo osciloscópico. Úsalo solo si aporta una reacción compatible con la identidad elegida (p. ej. su RMS como medida de presencia).

### 5.3 Prueba de distinción

Un **grave sostenido**, un **conjunto de agudos rápidos** y un **beat aislado** deben producir respuestas visualmente distintas entre sí. Describe en la entrega qué verá el usuario en cada caso.

---

## 6. Entorno técnico y API [OBLIGATORIO]

El código debe funcionar en un navegador moderno con **JavaScript y Canvas 2D**, sin framework ni compilación. Sin librerías externas, CDN, imágenes remotas, fuentes remotas, WebGL ni shaders. Evita `shadowBlur` intensivo; prioriza gradientes, trazos multicapa y operaciones acotadas.

El reproductor monta el visualizador con una API equivalente a:

```js
const visualizer = new Visualizer(canvas, audioGraph);
visualizer.setSensitivity(0.7);
visualizer.start();
visualizer.stop();        // fundido breve y luego detiene
visualizer.stop(true);    // detiene ya y limpia
visualizer.clear();
visualizer.destroy();
```

Implementa una clase con al menos:

```js
class Visualizer {
  constructor(canvas, audioGraph) {}
  setSensitivity(value) {}   // rango 0.4–1.2; base 0.7
  start() {}
  stop(immediate = false) {}
  clear() {}
  destroy() {}
}
```

Puedes añadir métodos opcionales (por ejemplo `setPalette(colores)`), siempre que la API mínima funcione sin ellos.

El reproductor usa un canvas dedicado y un `AnalyserNode` normalmente con `fftSize = 2048` (≈1024 bins), `smoothingTimeConstant = 0.5` y `requestAnimationFrame`.

**Tamaño del canvas:** asume que el canvas tiene tamaño dado por CSS. Ajusta su bitmap al tamaño medido (`getBoundingClientRect`), limita `devicePixelRatio` a 2 y pon un tope máximo al tamaño del bitmap para evitar bucles de crecimiento. Documenta en la guía de integración que el canvas debe dimensionarse por CSS.

**Portada:** puede existir una imagen de portada en el DOM, pero el visualizador debe funcionar sin ella. Si usas sus colores, trátalos como una paleta opcional, nunca como el centro geométrico obligatorio.

---

## 7. Ciclo de vida y rendimiento [OBLIGATORIO]

1. `start()` inicia un **único** bucle `requestAnimationFrame`; llamarlo varias veces no crea bucles duplicados, y reanudar tras un fundido de salida debe funcionar.
2. `stop()` hace un fundido breve (≈300–400 ms) y después detiene el render sin reprogramar frames.
3. `stop(true)` cancela el frame pendiente y limpia el canvas de inmediato.
4. `destroy()` detiene todo, desconecta `ResizeObserver`, elimina listeners y libera referencias. Tras `destroy()`, cualquier otra llamada debe ser inofensiva.
5. Datos de audio ausentes o `null`: sin errores, con animación de reposo o limpieza segura.
6. Canvas de tamaño cero u oculto: sin divisiones inválidas ni excepciones; debe reanudar el dibujo cuando pase a ser visible.
7. Respuesta a cambios de tamaño; `devicePixelRatio` limitado a 2.
8. Reutiliza arrays, buffers y estructuras; no crees miles de objetos por frame.
9. Define **límites de complejidad explícitos** (nº máximo de elementos, muestras o segmentos) y, si es posible, una degradación automática de calidad cuando el frame sea caro. Objetivo: fluido a 60 fps en un portátil normal.
10. El cambio de estilo debe liberar por completo el visualizador anterior.
11. Un error dentro de un frame no debe romper el bucle ni inundar la consola (registra como máximo una vez).
12. El diseño debe seguir siendo reconocible en un canvas pequeño (p. ej. 120–180 px): reduce detalle fino antes que perder la silueta.

---

## 8. Qué debes entregar [OBLIGATORIO]

### 8.1 Entregables

1. **Investigación e inspiración:** fuentes, idea tomada de cada una, cómo la adaptaste sin copiarla, y licencias relevantes o confirmación de que el código es original.
2. **Decisión de diseño:** las direcciones candidatas que descartaste y por qué, la orientación elegida, la forma redondeada resultante, la composición, la paleta, qué ocurre con graves, medios, agudos, energía y beat, y por qué se diferencia de los once estilos.
3. **Auditoría de no repetición:** compara tu resultado, uno por uno, con **cada uno de los once estilos existentes** y explica por qué difiere en forma, composición, elementos, movimiento y respuesta al audio.
4. **Módulo JavaScript completo**, como un archivo independiente:
   - envuelto en una IIFE con modo estricto;
   - registrado en un namespace global claramente documentado (por ejemplo `window.AuraPlayVisualizers.<id>`);
   - con la API completa de la sección 6;
   - sin depender de otros archivos salvo el `audioGraph` y el canvas;
   - con comentarios útiles y sin pseudocódigo ni partes omitidas.
   Usa un identificador técnico nuevo, corto y descriptivo. **No reutilices** `bars`, `coverAura`, `circular`, `particles`, `tunnel`, `mirror`, `prism`, `halo`, `mycelium`, `cymatics`, ni ningún otro identificador de los once estilos existentes (por ejemplo, el de la Constelación musical o el del Mosaico de guijarros, cuyos nombres técnicos no se indican aquí).
5. **Guía de integración independiente**, con marcadores genéricos:
   - nombre técnico a registrar;
   - etiqueta `<script defer>` y su orden relativo respecto al adaptador o fachada que instancia visualizadores;
   - entrada para el selector de estilos;
   - tarjeta o botón de la interfaz;
   - icono SVG sencillo y redondeado como vista previa;
   - nombre y descripción cortos;
   - cambios necesarios en CSS, si los hay.
   No supongas nombres de archivos que no aparecen aquí. Si das ejemplos, márcalos como **ejemplo** y di qué debe adaptar el usuario.
6. **Pruebas manuales** para: ausencia de audio; graves dominantes; agudos rápidos; beat marcado; pausa y reanudación; cambio entre estilos; redimensionamiento; DPR alto; pista con y sin portada; sensibilidad 0.4, 0.7 y 1.2; cambio repetido de estilo sin fugas; consola sin errores; un solo `requestAnimationFrame` activo.
7. **Notas de rendimiento, compatibilidad y licencias.**

### 8.2 Orden de la respuesta

1. Fuentes web consultadas e inspiración.
2. Orientación visual elegida y justificación.
3. **Auditoría de no repetición** (con ese título exacto).
4. Módulo JavaScript completo.
5. Guía de integración con ejemplos genéricos.
6. Pruebas manuales.
7. Notas de rendimiento, compatibilidad y licencias.

### 8.3 Formato de entrega

- Si dispones de herramientas para crear archivos, entrega el módulo como **archivo** y resume el resto en la respuesta. Si no, entrégalo completo en un bloque de código.
- Responde en el idioma de este prompt (español).

---

## 9. Criterios de aceptación [OBLIGATORIO]

La propuesta **no** está terminada si:

- parece una copia o variación evidente de cualquiera de los once estilos;
- la forma redondeada se reduce a un círculo, halo, anillo o mandala, o tiene un resplandor perimetral que la hace leerse como halo;
- la reacción al audio es decorativa o no musicalmente legible, o grave sostenido, agudos rápidos y beat aislado se ven iguales;
- depende de una librería, asset o servicio externo innecesario;
- el código es pseudocódigo o tiene partes omitidas;
- requiere conocer archivos internos que no aparecen en este prompt;
- tiene fugas de listeners, timers o bucles de animación;
- parpadea, satura el rendimiento, se sale del canvas o falla sin audio;
- la portada es imprescindible para que funcione;
- se citan fuentes que no se consultaron.

---

## 10. Verificación y honestidad [OBLIGATORIO]

Antes de entregar, **verifica lo que puedas** con las herramientas disponibles y distingue en el informe entre lo verificado y lo no verificado:

- comprobación de sintaxis del módulo;
- prueba con un canvas simulado: un solo RAF tras varios `start()`, `stop()` con fundido, `stop(true)`, `destroy()` (RO desconectado, listener eliminado), audio `null`/que lanza/sin métodos, canvas de tamaño cero, 100 ciclos de crear y destruir sin fugas;
- si hay un navegador sin interfaz disponible, capturas con audio sintético (silencio, grave, agudos, pulsos, mezcla) y una instancia pequeña de ~180 px; revisa que la composición no se recorte y que la silueta sea reconocible.

Declara con claridad qué **no** pudiste probar (audio real, integración en el reproductor real, otros navegadores).

---

## Anexo A [REFERENCIA — solo si la tarea es revisar o modificar `auraMusicSigns.js`]

Este anexo describe un estilo **existente** (Constelación musical). Si estás creando un visualizador nuevo, **no lo uses como plantilla**: sirve para evitar parecerte a él. Si la tarea es diseñar o revisar ese visualizador, conserva estas decisiones validadas en AuraPlay Pro:

- **Composición:** retícula escalonada de signos musicales claramente legibles, orientados por un campo de flujo; la masa general debe sentirse compacta, orgánica y de límite redondeado.
- **Tamaño:** signos visiblemente grandes y legibles incluso en pantallas pequeñas, con escala suficiente para distinguir cabeza, plica y banderas.
- **Familias distribuidas:** al menos cinco signos claramente distintos —negra, blanca, par de corcheas, silencio y nota con banderas múltiples— **mezclados por toda la retícula**, no separados en zonas espaciales ni en bandas de frecuencia.
- **Respuesta musical por familia:** cada tipo de signo tiene sensibilidad propia a graves, medios y agudos. Por ejemplo, negras y blancas enfatizan graves, los pares de corcheas responden más a medios y las notas con banderas múltiples a agudos; todos conservan alguna respuesta a las demás bandas.
- **Respuesta global:** graves impulsan expansión y peso; medios controlan torsión y movimiento; agudos generan actividad rápida y destellos. El beat provoca un evento breve reconocible además de la respuesta tonal continua.
- **Reactividad:** priorizar ataques perceptibles y caídas suaves. En silencio, una respiración mínima que no compita con la música.
- **Lectura en tamaños pequeños:** reducir la densidad en los bordes antes que recortar los signos; reservar espacio alrededor de cada glifo.
- **Icono SVG:** varias notas de distintas familias, con orientación variada y sin fondo adicional.