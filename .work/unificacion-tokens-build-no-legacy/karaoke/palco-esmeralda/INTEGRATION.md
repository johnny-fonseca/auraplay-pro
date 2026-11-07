# Integración de Palco Esmeralda en AuraPlay Pro

> **Estado actual:** estos archivos **no han sido conectados ni probados en AuraPlay Pro**. Quien los preparó no tuvo acceso al repositorio. Los fragmentos de abajo son **propuestas ancladas a nombres conocidos**, no parches aplicados; no hay números de línea porque los archivos vigentes pueden haber cambiado. Todo lo que dependa del código real está marcado como **verificar**.

Slug: `palco-esmeralda` · Nombre visible: **Palco Esmeralda** · Recursos nuevos de Karaoke: exactamente **2** (1 CSS + 1 JS).

## 0. Archivos y dependencias

| Archivo | Dependencias |
|---|---|
| `karaoke/palco-esmeralda/palco-esmeralda.css` | `karaoke/shared/karaoke.css` y `karaoke/shared/karaoke-common.css` (el tema se apoya en su mecanismo de relleno por palabra) |
| `karaoke/palco-esmeralda/palco-esmeralda-effects.js` | `karaoke/shared/karaoke-core.js` cargado **antes** (expone `window.AuraKaraokeCore.registerScene`) |
| `README.md`, `INTEGRATION.md` | Documentación; no se cargan en la app ni se minifican |

Copiar la carpeta completa a `karaoke/palco-esmeralda/` en el repositorio. No guardar minificados en esa carpeta de fuentes.

## 1. Contrastar suposiciones con los archivos vigentes (antes de editar)

Comandos de apoyo (ajusta rutas si difieren):

```sh
grep -rn "data-karaoke-style\|karaokeStyle\|_applyKaraokeStyle\|setKaraokeStyle\|cycleKaraokeStyle" js index.html karaoke
grep -rn "word-p\|--p\b\|data-sustain\|data-state" js karaoke
grep -rn "registerScene\|bands\b\|beat\.\|reduced\|\.q\b" karaoke/shared/karaoke-core.js
grep -rn "yozakura" scripts/build-production.js index.html js karaoke/README.md
```

| # | Suposición | Si no coincide |
|---|---|---|
| 1 | Los frames traen `w`/`h` en px CSS y el núcleo ya escala el `ctx` por `dpr` | Poner `FRAME_IN_DEVICE_PX = true` en el plugin |
| 2 | El núcleo limpia el canvas por frame, o no pinta nada antes de la escena | Si pinta algo antes que deba conservarse, poner `CLEAR_FIRST = false` |
| 3 | `q` es fracción (0–1] o nivel 2–4 | Editar `qualityScale()` |
| 4 | `motion === 0` equivale a “sin movimiento” | Editar `calm` en `_update()` |
| 5 | `beat.pulse` ∈ [0,1], `beat.hit` booleano | Normalizar en `_update()` |
| 6 | `--k-edge-w` / `--k-edge-w-sustain` admiten `em` | Copiar la unidad que usa un tema existente (p. ej. Yozakura) en `.k-line` |
| 7 | Los tokens “de estructura” (`--k-panel`, `--k-btn-bg`, `--k-track`, …) existen con esos nombres | Renombrar/eliminar los alias del primer bloque del CSS; los componentes ya están estilados por selector directo |
| 8 | `.k-overlay` es la capa de velo entre `#kBg` y `#kFx` | Si es un contenedor, quitar su `background` en el CSS y mover el oscurecimiento a `.k-bg` |
| 9 | `#kProgress` es `<input type="range">` | Adaptar el bloque “Progreso” |
| 10 | `.k-controls` y `.k-footer` son contenedores flex/bloque compatibles con `flex-wrap` y bordes | Ajustar en el bloque “Dock” |
| 11 | `data-state="past|active|next"` lo asigna el núcleo; `data-sustain="1"` también | **Verificar quién asigna `data-sustain`** antes de depender de él; sin él solo se pierde el filete más grueso |
| 12 | No hay otro tema con el slug `palco-esmeralda` | Elegir otro slug y reemplazarlo en **todos** los archivos |

## 2. `<head>`: hoja de estilo

En `index.html`, junto a las demás hojas de Karaoke, **después** de `karaoke/shared/karaoke.css`, `karaoke/shared/karaoke-common.css` y del CSS del último tema existente:

```html
<link rel="stylesheet" href="karaoke/palco-esmeralda/palco-esmeralda.css">
```

## 3. `.k-style-picker`: botón del selector

Dentro de `.k-style-picker`, **después del último `.k-style-btn` existente**. **Copia la estructura exacta de un botón existente** (p. ej. el de Yozakura) y cambia solo slug, etiqueta y clase de la muestra. Forma esperada:

```html
<button type="button" class="k-style-btn" data-karaoke-style="palco-esmeralda" aria-pressed="false">
  <span class="k-style-preview palco-esmeralda" aria-hidden="true"></span>
  <span>Palco Esmeralda</span>
</button>
```

Mantén `aria-pressed="false"` inicial: `js/player.js` debe poner `true` en el activo (§5). No elimines ni reordenes los botones existentes.

## 4. Zona de scripts: plugin tras el núcleo

Junto a los scripts de las escenas existentes, **después** de `karaoke/shared/karaoke-core.js` y, por orden, tras el último plugin de tema:

```html
<script src="karaoke/palco-esmeralda/palco-esmeralda-effects.js" defer></script>
```

El núcleo debe estar antes; si no, el plugin lanza un error explícito en consola.

## 5. `js/player.js`: qué inspeccionar y actualizar

No asumas líneas ni forma exacta. Busca **todo** lugar donde aparezcan los slugs de los otros cinco temas (Cinema, Neón, Kinético, Guilloché Zafiro, Yozakura) y añade `'palco-esmeralda'` donde corresponda:

| Punto | Qué comprobar / cambiar |
|---|---|
| Valor inicial y restauración de `karaokeStyle` | La lectura desde almacenamiento debe validar contra la lista de estilos permitidos; añadir `'palco-esmeralda'` a esa lista/Set/objeto. Un valor guardado inválido debe caer al estilo por defecto sin error |
| `_applyKaraokeStyle(style)` | Allowlist de estilos válidos; asigna `data-karaoke-style` en `#karaokeOverlay`; actualiza `aria-pressed` y estado activo de todos los `.k-style-btn` (el del slug → `"true"`, el resto → `"false"`); selecciona/instancia la escena registrada con ese slug |
| `setKaraokeStyle(style)` | Allowlist; persiste la elección; delega en `_applyKaraokeStyle` |
| `cycleKaraokeStyle()` | Array ordenado de estilos: añadir `'palco-esmeralda'` en la posición deseada (p. ej. al final); comprobar que el ciclo vuelve al primero |
| Manejador de clic de `.k-style-btn` | Normalmente lee `dataset.karaokeStyle`; confirmar que no tiene lista propia |

Forma típica del cambio (ilustrativa; adaptar a la estructura real):

```js
// Antes (ejemplo): ['cinema', 'neon', 'kinetic', 'guilloche', 'yozakura']
// Después:         ['cinema', 'neon', 'kinetic', 'guilloche', 'yozakura', 'palco-esmeralda']
```

## 6. Puente `--p` ↔ `--word-p` (crítico para la sincronía por palabra)

**Observado según el encargo (a verificar):**

- El player escribe el progreso por palabra como `--p` en **fracción** (`0`–`1`).
- El CSS compartido y el rastreador del núcleo leen `--word-p` en **porcentaje** (`0%`–`100%`) y el núcleo inspecciona el valor **inline** de `--word-p` para localizar la palabra activa.

Este tema **no resuelve** ese puente. Antes de dar la sincronía por integrada, comprueba los tres puntos y deja **una sola conversión**:

1. **Escritor** (`js/player.js`): ¿qué propiedad inline escribe y en qué unidad?
2. **Consumidor CSS** (`karaoke-common.css`): ¿`background-size` usa `--word-p`? ¿en `%`?
3. **Lector del núcleo** (`karaoke-core.js`): ¿lee `--word-p` inline con `parseFloat` y espera porcentaje?

**Opción A (recomendada):** que el player escriba directamente `--word-p` en porcentaje, sin tocar el CSS compartido ni el núcleo si ya esperan `%`:

```js
// Donde hoy se hace algo como: wordEl.style.setProperty('--p', progress);
wordEl.style.setProperty('--word-p', (progress * 100).toFixed(1) + '%');
// Si nada más usa --p, elimínalo para no tener dos fuentes de verdad.
```

**Opción B:** mantener `--p` y derivar el porcentaje en CSS compartido (no en el tema):

```css
#karaokeOverlay .k-word { --word-p: calc(var(--p, 0) * 100%); }
```

Solo es válida si **el núcleo deja de depender del `--word-p` inline** (hay que actualizar su lector para usar `--p` o `data-state`), porque con esta opción no existe valor inline de `--word-p`. No combines A y B: sería contar la conversión dos veces.

**Prueba del puente** (consola, con una letra con tiempos por palabra):

```js
const w = document.querySelector('#karaokeOverlay .k-line.current .k-word[data-state="active"]');
getComputedStyle(w).getPropertyValue('--word-p'); // esperado: un porcentaje entre 0% y 100%
```

Verifica `--word-p` en **0 %** (palabra siguiente), **valor parcial** (activa) y **100 %** (cantada), y que el filete de latón bajo la activa crece con él.

## 7. Relleno de la barra de progreso (opcional, recomendado)

El relleno en WebKit se pinta con `--pe-progress` (porcentaje). Si el player ya publica una variable equivalente, apunta el CSS a ella. Si no, en la función que actualiza la posición de `#kProgress`:

```js
progressEl.style.setProperty('--pe-progress', pct + '%'); // pct = valor 0–100 de la barra
```

Sin esto la barra funciona igualmente (el pulgar indica la posición); solo falta el relleno de latón en Chrome/Safari. Firefox lo rellena con `::-moz-range-progress`.

## 8. `scripts/build-production.js`

Busca dónde aparece `yozakura` (o el último tema) y replica **exactamente** su tratamiento en los tres sitios:

1. **Inventario de recursos de Karaoke:** añadir a los arrays de assets
   - CSS: `karaoke/palco-esmeralda/palco-esmeralda.css`
   - JS: `karaoke/palco-esmeralda/palco-esmeralda-effects.js`
2. **Limpieza de minificados previos:** incluir la carpeta `karaoke/palco-esmeralda/` en la lista de carpetas donde se borran `.min.*` antiguos antes de minificar.
3. **Reescritura en `dist/index.html`:** que las URL fuente pasen a
   - `karaoke/palco-esmeralda/palco-esmeralda.min.css`
   - `karaoke/palco-esmeralda/palco-esmeralda.min.js`

Forma ilustrativa (no literal):

```js
// assets JS de karaoke
'karaoke/yozakura/yozakura-effects.js',
'karaoke/palco-esmeralda/palco-esmeralda-effects.js',   // + nuevo
// assets CSS de karaoke
'karaoke/yozakura/yozakura.css',
'karaoke/palco-esmeralda/palco-esmeralda.css',          // + nuevo
```

Expectativas tras el build: ambos `.min` existen en `dist/karaoke/palco-esmeralda/`; `dist/index.html` referencia solo las URL `.min`; la carpeta de fuentes queda sin `.min`; el JS minificado sigue lanzando el error claro si falta el núcleo (no se debe renombrar `AuraKaraokeCore`).

## 9. Documentación global: `karaoke/README.md`

- Añadir **Palco Esmeralda** a la lista/tabla de estilos con una línea: *palco de ópera en terciopelo esmeralda y latón; cortinas, bambalina, rampa de lámparas y polvo en suspensión*.
- Si el README indica un conteo de recursos de Karaoke, **súmale exactamente 2** (un JS y un CSS). Si no hay conteo, no inventes uno.
- Enlazar a `karaoke/palco-esmeralda/README.md`.

## 10. Checklist de pruebas en navegador

**Carga y selector**
- [ ] Sin errores en consola; el plugin se registra (el núcleo lo encuentra por slug).
- [ ] El botón nuevo aparece con su muestra; `aria-pressed` pasa a `true` solo en el activo y vuelve a `false` en el resto.
- [ ] El estilo persiste tras recargar; el ciclo de estilos incluye Palco Esmeralda y vuelve al primero.
- [ ] Un valor guardado inválido no rompe la carga.
- [ ] Cambiar de/hacia otros temas no deja estilos ni escena residual.

**Letra palabra por palabra** (con una pista con tiempos por palabra)
- [ ] Puente `--p`/`--word-p` resuelto (§6); `--word-p` en 0 %, parcial y 100 %.
- [ ] La palabra activa se rellena de izquierda a derecha al compás del audio; las anteriores completas, las posteriores vacías.
- [ ] Pausa congela el barrido; reanudar continúa; seek atrás y adelante recoloca estados; cambiar el desfase +/−/reset reajusta.
- [ ] Línea con marcas solo por línea: se lee completa con el color de respaldo, sin barrido inventado.
- [ ] Con traducción activa y al cambiar de tema a mitad de canción el texto sigue legible.
- [ ] Contraste legible con carátula muy clara y muy oscura (medir con herramientas del navegador; ver tabla de `README.md`).

**Chrome y controles**
- [ ] Cabecera, selector, dock, botones (anterior, play/pausa, siguiente, A−/A+, desfase +/−/reset, carga `.lrc`, pantalla completa, cierre) con hover, pulsado, deshabilitado y foco visible por teclado (Tab).
- [ ] Barra de progreso: arrastre, foco, pulgar; relleno si se aplicó §7.
- [ ] Ningún control queda recortado ni como HTML por defecto.

**Responsive y accesibilidad**
- [ ] 320 px de ancho y 360×640; 667×375 y 844×390 en horizontal: letras sin truncar, controles envueltos.
- [ ] Zoom del 200 %.
- [ ] Emulación `prefers-reduced-motion: reduce`: escena estática, sin entrada animada de línea, la letra sigue sincronizada.
- [ ] Emulación `forced-colors: active` y `prefers-contrast: more`.

**Escena y rendimiento**
- [ ] El centro queda libre; cortinas, bambalina y rampa visibles; sin parpadeos ni saltos.
- [ ] Reacción a graves (rampa/haces), medios (cortinas/borlas), agudos (motas/destellos), golpes (rubíes y barrido); sin flashes de pantalla.
- [ ] Pausa y reanudación suaves; redimensionar la ventana y girar el móvil reconstruye sin artefactos.
- [ ] Perfil de rendimiento a 60 fps en un equipo medio y en móvil; memoria estable tras varios cambios de tema.
- [ ] Forzar los tres niveles de calidad (`q`) y comprobar que baja la densidad.

**Build**
- [ ] Ejecutar el build de producción del proyecto (comando habitual del repositorio, p. ej. `node scripts/build-production.js`).
- [ ] `dist/index.html` apunta a `palco-esmeralda.min.css` / `palco-esmeralda.min.js`; ambos archivos existen; repetir las pruebas anteriores sobre `dist/`.

## 11. Si algo no coincide

- **Letra sin barrido:** casi seguro el puente de §6 (unidad o nombre) o una regla del tema que gana en especificidad al relleno compartido. El tema no declara `background-image`, `background-size` ni `background-clip` en `.k-word` (solo en el `@supports not` y en colores forzados).
- **Texto de la línea actual borroso:** el `filter: drop-shadow` de `.k-line.current` se puede quitar sin otras consecuencias.
- **Velo demasiado oscuro o claro:** ajustar el alfa del `radial-gradient` de `.k-overlay` conservando ≥ 0,86 en el centro para mantener el contraste con carátulas claras.
- **Cortinas demasiado anchas en pantallas muy anchas:** se limitan a 300 px (`clamp` en `buildCurtain`).
- **Rendimiento bajo:** reducir `q` en el núcleo o bajar el tope `Math.min(dpr, 1.5)` de caché (`cs`) en `_prepare()`.
