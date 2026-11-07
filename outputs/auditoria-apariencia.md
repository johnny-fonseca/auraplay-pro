# Auditoría de opciones de apariencia — AuraPlay Pro

Fecha: 2026-11-06

## Resumen

La apariencia de AuraPlay Pro se controla con tres ejes independientes y combinables, casi todos presentacionales, y la revisión encontró ocho puntos a corregir, de los cuales dos son baratos y visibles.

1. **Tres ejes combinables.** Tema (claro/oscuro), skin (10 opciones) y superficie (8 opciones) se aplican como atributos de `<html>` (`data-theme`, `data-skin`, `data-ui`). Dan 2 × 10 × 8 = 160 combinaciones posibles.
2. **Solo cambian lo visual.** No tocan audio, biblioteca, cola ni ecualización. Sí cambian tocadiscos, fondo, tipografía, controles, tarjetas y estados.
3. **Los problemas principales** son un ciclo de superficie duplicado en dos archivos, un `theme-color` que no sigue al tema ni a la skin, una persistencia con claves de distinto estilo y una semántica `aria-pressed` inconsistente. El detalle está en la sección siguiente.

### Glosario

| Término | Botón | Atributo | Qué controla |
| --- | --- | --- | --- |
| Tema | `#btnTheme` | `data-theme` | Paleta clara u oscura y las reglas que dependen de ella |
| Estilo visual (skin) | `#btnSkin` | `data-skin` | Paleta, acento, tipografía, materiales y acabado del vinilo |
| Estilo de superficie | `#btnSurfaceStyle` | `data-ui` | Tratamiento gráfico de paneles, botones, campos, listas y otros componentes |
| Visualizador de audio | Control propio del reproductor | Estado propio, no es `data-ui` | Tipo de visualización que reacciona al audio; ninguno de los tres botones anteriores lo cambia |

## Hallazgos priorizados

Primero van dos correcciones baratas y visibles (eliminar el ciclo de superficie duplicado y sincronizar `theme-color`); el resto es mantenimiento y verificación. El esfuerzo es una estimación a ojo, no medida.

| # | Prioridad | Hallazgo | Riesgo | Esfuerzo | Acción recomendada | Referencia |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Alta | Resuelto: se eliminó `js/surfaceStyle.js`, implementación duplicada no cargada; `styles/ui-style-cycle.js` queda como implementación activa | Riesgo de editar el archivo equivocado o que las copias diverjan | Bajo | Mantener un único dueño canónico: `styles/ui-style-cycle.js` | `index.html` 1017–1055; `styles/ui-style-cycle.js` 1–100 |
| 2 | Alta | `js/skin.js` escribe solo el primer `meta[name="theme-color"]`; `index.html` define dos (oscuro y claro) y cambiar de tema no actualiza ninguno | El color de la barra del navegador no coincide con la combinación tema/skin activa | Bajo | Actualizar ambas etiquetas, o una sola dinámica, al cambiar tema y al cambiar skin | `js/skin.js` 1–40; `index.html` (etiquetas `theme-color`) |
| 3 | Media | Tema y skin se guardan con `AuraStorage` y prefijo `auraplay:`; la superficie usa la clave `ui-style` sin prefijo | Limpieza, migración y diagnóstico más difíciles | Bajo a medio | Pasar a `auraplay:ui-style` vía `AuraStorage`, leer la clave antigua una vez al migrar y ajustar el script inline del `head` | `styles/ui-style-cycle.js`; `index.html` 80–109 |
| 4 | Media | Skin quita `aria-pressed`; superficie lo expone como «distinto del predeterminado», no como selección | La semántica no equivale a elegir una opción de un grupo | Medio | Decidir un patrón único (botón con nombre accesible que incluya el modo, o menú con selección) y aplicarlo a los dos controles | `js/skin.js`; `styles/ui-style-cycle.js` |
| 5 | Media | El botón de skin se llama «estilo visual», el vecino «estilo de superficie», y el README usa «Temas» como encabezado general | Confusión entre controles y con el visualizador de audio | Bajo | Renombrar (por ejemplo «Paleta» y «Materiales») o agruparlos en un menú de apariencia; alinear el README | `index.html` 340–372 |
| 6 | Media | Resuelto: el CSS de la aplicación se asigna a `@layer base, theme, skin, surface, finish`; la prioridad entre familias ya no depende del orden de carga ni de la especificidad entre capas | Las capas solo ordenan reglas normales declaradas dentro de ellas; estilos inline y reglas `!important` requieren atención aparte | Bajo | Mantener cada nueva hoja o bloque CSS dentro de su capa funcional; revisar selectores globales con la matriz de pruebas | `index.html`; hojas en `css/`, `skins/`, `styles/`, `fonts/`, `karaoke/` y `remote/` |
| 7 | Media | La verificación fue solo estática: no se compararon capturas, no se midió contraste WCAG y no se probaron las 160 combinaciones | Texto ilegible, bordes ausentes o controles ocultos en combinaciones no vistas | Medio | Automatizar el recorrido de las 160 combinaciones (ver checklist) | — |
| 8 | Baja | Algunas hojas de superficie superan mil líneas y todas se descargan y parsean al inicio | Costo de carga; no es un fallo probado | Medio a alto | Medir primero; si pesa, cargar solo la hoja activa cuidando el parpadeo inicial | `index.html` 151–187 |

## Checklist de pruebas

Probar estas seis combinaciones antes de publicar cambios de apariencia; marca ✓ en cada celda al revisar. Recarga la página en cada una y confirma que se restauran el tema, la skin y la superficie.

| Combinación | Paneles y botones | Inputs y rangos | Barra inferior | Modal y toast | Carátula y vinilo girando | Recarga restaura los 3 estados |
| --- | --- | --- | --- | --- | --- | --- |
| Latón · oscuro · Neumorfismo (base) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Neón · oscuro · Glassmorfismo | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Esmeralda · claro · Diseño plano | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Papel · claro · Bento | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Telar · oscuro · Skeuomorfismo | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Glaciar · claro · Claymorfismo | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

### Pruebas adicionales

- [ ] Almacenamiento bloqueado: la app arranca con los valores por defecto (oscuro, Latón, Neumorfismo).
- [ ] Movimiento reducido activado.
- [ ] Anchos móviles.
- [ ] Color de la barra del navegador en claro y oscuro, con varias skins (verifica el hallazgo 2).
- [ ] Cobertura completa: recorrer automáticamente las 160 combinaciones (2 temas × 10 skins × 8 superficies), comparar capturas y detectar texto ilegible, bordes ausentes y controles ocultos.

## Anexo A: controles, cableado y persistencia

Cada control escribe un atributo en `<html>`, lo guarda en el navegador y lo recupera al iniciar; los tres primeros no comparten la misma estrategia de lectura.

| Control | Botón y manejador | Atributo en `<html>` | Almacenamiento | Lectura al iniciar |
| --- | --- | --- | --- | --- |
| Tema | `#btnTheme`; `toggleTheme()` en `js/player.js`; atajo `T` en `js/shortcuts.js` | `data-theme` = `dark` o `light` | `AuraStorage`, clave lógica `theme` (normalmente `auraplay:theme`) | Script crítico de `index.html` lee `auraplay:theme` e intenta parsear JSON; luego el constructor del reproductor usa `S.get("theme", "dark")` |
| Estilo visual (skin) | `#btnSkin`; `js/skin.js` | `data-skin` | `AuraStorage`, clave lógica `skin` (normalmente `auraplay:skin`); migra y elimina `aura-skin` | Script crítico lee `auraplay:skin` (JSON) y, si no es válido, `aura-skin`; por defecto `brass`; después `js/skin.js` aplica y guarda |
| Estilo de superficie | `#btnSurfaceStyle`; `styles/ui-style-cycle.js` (el script que se carga realmente) | `data-ui` | `localStorage["ui-style"]`, cadena simple sin prefijo | Script inline del `head` y `ui-style-cycle.js` leen el valor y lo normalizan a uno de ocho; por defecto `neu` |
| Visualizador de audio | Control propio; `js/player.js` y `visualizers/*.js` | Ninguno (no usa `data-ui`) | Estado propio, independiente | Independiente de los tres anteriores |

### Cómo se aplican

- **Carga de CSS:** `index.html` carga todas las hojas al inicio y no descarga nada al pulsar; las reglas se activan por selector. Las hojas y el CSS crítico inline están dentro de capas. El orden declarado es `base, theme, skin, surface, finish`: en declaraciones normales entre capas gana la posterior, con independencia de la especificidad; dentro de una misma capa siguen aplicando las reglas CSS habituales.
- **Hidratación sin parpadeo:** tema y skin se leen en scripts críticos del `<head>`; el modo de superficie también se preestablece antes de cargar las hojas.
- **Skin y superficie:** la skin aporta identidad y paleta; la superficie aporta geometría y materialidad del componente. Una regla de superficie puede reemplazar fondos, sombras, bordes o radios definidos por la skin en ciertos componentes, y la skin sigue aportando los tokens de color y fuente que esa regla usa.
- **Qué cambia el tema:** `css/theme.css` (fondo del `body` y opacidad de la aurora), las skins con reglas por `data-theme`, `css/finish.css` (viñeta y borde especular del cristal en claro), varias hojas de superficie (fondos, aurora, modal) y `js/progressWaveform.js`, que observa `data-theme` y `data-skin` y vuelve a dibujar el degradado de la forma de onda.
- **Qué no toca ninguno:** reproducción, archivos, orden de pistas, volumen ni ecualizador.
- **Visualizadores** (en `visualizers/`): barras, forma de onda, anillo, partículas, túnel, espejo, prisma, halo y micelio. La entrada `Pebbles.js` y el inventario o la documentación pueden diferir.

## Anexo B: skins (estilo visual)

Las diez skins cambian más que el color: definen o ajustan tokens (`--bg-base`, `--accent-rgb`, `--text-*`, `--gradient-*`, `--glass-*`, `--shadow-*`) y fuentes, y varias rediseñan selectores concretos como títulos, paneles, botones, barra inferior, arte del álbum, anillo, plato y brazo. El ciclo sigue el orden de la tabla y vuelve a Latón al final; un valor inválido cae a `brass`.

| Opción | Clave | Archivo | Qué cambia | Particularidades |
| --- | --- | --- | --- | --- |
| Latón | `brass` | `skins/brass.css` | Identidad cálida: tokens de fondo y mesh, acentos dorados, texto y tipografía, vidrios y sombras; acabado y piezas del vinilo y tocadiscos | Es el fallback; valores distintos en claro y oscuro |
| Neón | `neon` | `skins/neon.css` | Tokens oscuros, acentos eléctricos, brillo e iluminación propios; acabado de vinilo asociado | `css/finish.css` agrega el giro del disco y reglas para conservar el brillo sin pulsación |
| Esmeralda | `emerald` | `skins/emerald.css` | Acentos verdes y oro, paleta y texto, tipografía, paneles y estados; acabado propio de disco | Reglas de claro y oscuro |
| Glaciar | `glacier` | `skins/glacier.css` | Paleta fría azul y gris, mesh, tokens de vidrio y sombra, texto y controles; acabado de vinilo | Tiene variante clara |
| Rubí | `ruby` | `skins/ruby.css` | Gama rojo y rubí, acentos, texto, materiales y sombras; acabados propios del reproductor y del vinilo | Gama oscura |
| Titanio | `titanium` | `skins/titanium.css` | Gama metálica fría, tokens y superficies; detalle de carátula, plato y brazo | Reglas de tema claro |
| Papel | `paper` | `skins/paper.css` | Tratamiento cálido tipo papel: fondo, textos, acentos, superficies, contornos y sombras | Estilos adaptados al tema |
| Ulm | `ulm` | `skins/ulm.css` | Identidad editorial y geométrica: contrastes, bordes y detalles del reproductor y del vinilo | Paletas claras y oscuras |
| Gres | `gres` | `skins/gres.css` | Materialidad cerámica: tokens de fondo y superficies, detalles de componentes y de disco | Claro y oscuro |
| Telar | `telar` | `skins/telar.css` | Identidad textil o de tapiz: patrones y tejido, tratamiento de componentes y de disco | La hoja más extensa del grupo, con numerosos overrides y tokens |

## Anexo C: estilos de superficie

Los ocho modos cambian la geometría y el material de los componentes y se recorren en este orden: `neu` → `skeuo` → `glass` → `clay` → `brutal` → `aurora` → `flat` → `bento` → `neu`. Las hojas difieren en longitud y cantidad de overrides: la tabla resume el propósito que declara cada una, no que cambie todos los elementos ni que todos los navegadores representen filtros y sombras igual.

| Opción | Clave | Archivo | Qué cambia | Particularidades |
| --- | --- | --- | --- | --- |
| Neumorfismo | `neu` | `styles/neumorphism.css` | Sombras de luz y de sombra y relieve suave derivado del fondo y del acento activos; paneles, controles, campos, barras y otros componentes | Valor por defecto; tiene exclusiones para que skeuo y glass no se mezclen con sus reglas |
| Skeuomorfismo | `skeuo` | `styles/skeuomorphism.css` | Aspecto de equipo hi-fi: metal, texturas, teclas elevadas y estados pulsados, paneles, rangos y barra de progreso | Variación clara y oscura |
| Glassmorfismo | `glass` | `styles/glassmorphism.css` | Superficies translúcidas, desenfoque de fondo, bordes especulares y brillos en paneles, botones y modal | Contempla tema claro y usa tokens de skin |
| Claymorfismo | `clay` | `styles/claymorphism.css` | Volúmenes redondeados tipo plastilina, colores pastel, sombras internas y externas, paneles y botones | También ajusta fondo y aurora |
| Neubrutalismo | `brutal` | `styles/brutalism.css` | Contrastes, contornos y sombras duras y planas | Reglas acotadas en su mayoría por `data-ui="brutal"` |
| Aurora | `aurora` | `styles/aurora.css` | Fondo y superficies con gradientes y color ambiental, formas redondeadas, acentos | Reglas visuales limitadas a `data-ui="aurora"` |
| Diseño plano | `flat` | `styles/flat.css` | Colores sólidos y formas simples; minimiza o elimina sombras, degradados, desenfoques y profundidad decorativa | Según el encabezado de la hoja |
| Bento | `bento` | `styles/bento.css` | Composición tipo Bento en header, biblioteca, reproductor, cola y barra inferior | Limitada al modo Bento; no reordena ni oculta controles |

## Referencias y alcance

La auditoría es una inspección estática del HTML, JavaScript y CSS fuente: no se modificó el código, no se automatizó un navegador y no se probó ninguna de las 160 combinaciones. Las observaciones corresponden al código inspeccionado.

- `index.html`: scripts de inicialización en 80–109 y 188–196; CSS en 151–187; botones de apariencia en 340–372; scripts activos en 1012–1045.
- `js/player.js`: carga y cambio de tema en 366–368 y 1634–1642; registro del clic en 548.
- `js/skin.js`: ciclo, atributo, etiquetas y persistencia en 1–40.
- `styles/ui-style-cycle.js`: ciclo cargado de ocho modos, almacenamiento, accesibilidad y listener en 1–100.
- `js/surfaceStyle.js`: eliminada; la implementación activa es `styles/ui-style-cycle.js`.
- `css/theme.css` y `css/finish.css`: tokens y reglas transversales.
- `skins/*.css`: paleta e identidad por skin.
- `styles/*.css`: tratamiento de componentes por estilo de superficie.
- `js/progressWaveform.js`: observación de cambios de tema y skin en 29–35.
- `js/shortcuts.js`: atajo `T` en 28.
