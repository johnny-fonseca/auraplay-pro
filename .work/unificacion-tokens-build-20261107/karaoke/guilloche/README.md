# Guilloché Zafiro · tema Karaoke (`guilloche`)

## Orden de carga

1. **Estilos:** núcleo compartido → CSS común/layout de Karaoke → `karaoke/guilloche/guilloche.css`
2. **Scripts (`defer`):** `karaoke/shared/karaoke-core.js` → `karaoke/guilloche/guilloche-effects.js`

> Este paquete es un **plugin visual**. Todavía debe conectarse al selector y a la lista de estilos del reproductor (botón con `.k-style-preview.guilloche` y `data-karaoke-style="guilloche"` en `#karaokeOverlay`). Aquí no se ha tocado el reproductor.

Si `window.AuraKaraokeCore` no existe, `guilloche-effects.js` lanza un error descriptivo con el orden de carga correcto.

## Concepto

Orfebrería de reloj de gala: **torneado guilloché** sobre zafiro nocturno, con platino y oro rosa.

- **Rosetas guilloché** en dos esquinas opuestas (inferior izquierda y superior derecha). Cada una tiene dos capas que giran en sentidos contrarios; su moiré deriva con los medios y respira con los graves. El centro de la zona de letra queda libre.
- **Bisel de reloj** elíptico con marcas por perímetro. Las marcas se alargan con graves (abajo), medios (laterales) y agudos (arriba). Una aguja luminosa con cola lo recorre en unos 60 s.
- **Ondas de ritmo** finas que nacen en el bisel con cada golpe (máximo 3 a la vez, siempre con entrada y salida suaves).
- **Destellos** lentos (periodo de 4 a 9 s) sobre las rosetas y el bisel. Sin parpadeos.
- **Tipografía:** serif didona de sistema (Bodoni 72 / Didot / Palatino / Georgia). La línea actual va en platino con halo zafiro; las palabras cantadas toman un tono cálido con brillo rosado.

Paleta: abismo `#04060e`, tinta `#070b1d`, zafiro `#0b1433`, platino `#eef1f8`, escarcha `#c9d6ff`, oro rosa `#e8aa90`, champán `#f4d9c2`.

## Archivos

| Archivo | Contenido |
|---|---|
| `guilloche.css` | Reglas exclusivas bajo `#karaokeOverlay[data-karaoke-style="guilloche"]` y la muestra `#karaokeOverlay .k-style-preview.guilloche`. |
| `guilloche-effects.js` | Clase `GuillocheScene`, registrada con `AuraKaraokeCore.registerScene('guilloche', GuillocheScene)`. IIFE, sin módulos ES, sin recursos externos. |
| `README.md` | Este documento. |

## Dependencias del núcleo compartido

- `registerScene(slug, SceneClass)`. Es la única dependencia obligatoria.
- `helpers`: `TAU`, `clamp` y `lerp`, cada uno con respaldo local si faltara.
- Campos de `frame` que se leen: `w`, `h`, `dpr`, `dt`, `tm`, `bands.bass|mid|high`, `beat.pulse|hit|strength`, `q.bars` (como señal relativa de calidad), `motion`, `reduced`, `playing`.
- `mask = 0`: la escena no emite partículas del sistema compartido. No usa `frame.particles`, `spec`, `synthetic` ni `sweep`.
- La paleta es propia; no depende de `frame.pal`.

## Comportamiento

- **Movimiento reducido** (`frame.reduced` o `frame.motion === 0`): composición estática, sin respuesta al audio, sin aguja, sin ondas y con destellos fijos. Las letras mantienen el mismo contraste.
- **En pausa:** el tiempo propio de la escena avanza al 20 % y las bandas decaen a cero.
- **Rendimiento:** rosetas, sprites de brillo y geometría del bisel se cachean una vez por tamaño (se reconstruyen en el siguiente `draw` tras `resize`). Por frame hay 2–4 blits grandes, unos 8 trazos agrupados y un máximo de 15 destellos. La calidad baja por niveles (menos capas, marcas y destellos; sin ondas en el nivel 0), con histéresis de 1,2 s para evitar saltos. No hay `shadowBlur`, ni DOM, ni gradientes creados por frame.
- **Estado de Canvas:** el dibujo va dentro de `save()`/`restore()` con `try/finally`. Un lienzo menor de 48 px o un frame sin datos válidos se manejan sin errores.

## Supuestos a revisar en la integración

- El núcleo no lista los estados de `.k-word`. Las reglas de palabra usan `:where()` (especificidad mínima), de modo que cualquier estado "cantada" que defina el CSS compartido tiene prioridad. Cubren los nombres habituales: `.sung`, `.done`, `.active`, `.lit`, `.on`, `.is-sung`, `.is-active`. Si el núcleo usa otro nombre, basta añadirlo a esa lista en `guilloche.css`.
- `draw` limpia el canvas completo al empezar (`clearRect` con transformación identidad) y asume que `ctx` ya trabaja en el espacio `[0, w] × [0, h]` del frame. La escala real se lee con `ctx.getTransform()`, o con `frame.dpr` si no existe.
- `.k-progress > *` recibe el degradado del tema, y `.k-progress` el color de fondo. Si la barra del núcleo tiene otra estructura, ajusta esa regla.

## Validación realizada

- `node --check guilloche-effects.js`: sintaxis correcta.
- Prueba de humo con un contexto Canvas simulado: 300 frames en 5 tamaños (incluidos 30 × 30 y 3840 × 2160), con movimiento reducido, pausa, frames sin datos y calidad baja. `save`/`restore` quedan balanceados.
- Sin `AuraKaraokeCore`, el módulo falla con un mensaje claro.
- El slug `guilloche` coincide en la ruta, el selector CSS y `registerScene`.
- Sin pruebas visuales en un navegador real (en este entorno solo se pudo ejecutar Node).
