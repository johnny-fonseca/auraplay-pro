# Análisis de candidatos restantes a tokens en la capa `skin`

## Resumen ejecutivo

La capa `skin` todavía contiene reglas que seleccionan directamente marca, títulos, controles, progreso, listas, avisos, overlays y componentes optativos. El análisis actual registra **307 reglas y 334 ramas selectoras** en las diez hojas de skin; **273 ramas contienen selectores de clase**. Ese último total incluye componentes reales, clases especiales sin referencias literales en el código, decoración global y el tocadiscos: no debe interpretarse como 273 migraciones necesarias.

La especificidad media en `skin` es `(0, 3.09, 0.34)` y el máximo `(0,6,1)`. La mayor parte de la especificidad extrema viene de condiciones de giro del disco con `:has()`. Esas reglas —plato, vinilo, brazo, eje/pivote, cápsula, carátula y detalles ópticos— son ornamentación identitaria sin equivalente razonable en las superficies y pueden quedarse en `skin`, según la excepción acordada.

La regla de diseño para la migración es: **skin aporta valores visuales como propiedades personalizadas; los consumidores de componentes viven fuera de skin**. Una hoja de superficie incorpora el token solo cuando el tratamiento tiene sentido para esa superficie. Ya hay una prueba de este contrato: Neon y Ruby publican tokens de panel consumidos por Glass; Telar publica `--pattern-image`, que Glass elige consumir.

## Estado de la evidencia

El inventario y las especificidades exactas están en el [informe de selectores por capa](informe-selectores-especificidad-css.md). Se revisaron las diez hojas y las ocho superficies. Además, se buscó literal y recursivamente en fuentes HTML/JavaScript evidencia de uso de `tl-panel`, `tl-btn`, `tl-row`, `paper-sheet`, `brass-glass` y `titanium-glass`: **cero referencias explícitas** para cada término. Es una señal de que son kits/clases optativos o código sin consumidor visible, no prueba absoluta contra nombres construidos dinámicamente o integraciones externas. Hay que confirmar su contrato antes de moverlos o borrarlos.

La capa `skin` precede a `surface`. Por tanto, la especificidad alta de un selector de skin **no** vence una regla normal de superficie: la precedencia de capas se decide primero y la especificidad solo desempatan reglas dentro de una misma capa. Los tokens heredados definidos en el elemento raíz evitan esa pelea y permiten que la superficie elija el consumo.

## Matriz por skin

| Skin | Candidatos que siguen seleccionando componentes | Tokens sugeridos / destino | Mantener en skin |
|---|---|---|---|
| **Brass** — 12 ramas con clase | `.brass-glass` y su `::before` (3 ramas; clases especiales, sin referencia literal en HTML/JS). | Si es un componente real: `--skin-panel-background`, `--skin-panel-border`, `--skin-panel-shadow`, `--skin-panel-highlight`; Glass o Skeuomorphism puede optar por consumirlos. Si no existe consumidor, aislar/deprecar el kit antes que universalizarlo. | Las otras 9 ramas de plato, carátula ornamental, reflejo y brazo. |
| **Emerald** — 32 | `.brand-mark`, `.brand-title`, `.panel-title`, `.modal-title`, `.now-title`, `.now-mini-title`, `.lyric-current`, `.k-line`, `.transport .btn-play`, `.toast`, `.now-bar`, `.karaoke-overlay` y `.aurora-bg`. Hay reglas/variantes repetidas para tema claro. | Tokens por rol: `--skin-brand-mark-shadow`, `--skin-brand-title-*`, `--skin-heading-*`, `--skin-track-title-*`, `--skin-lyric-active-*`, `--skin-play-control-*`, `--skin-notice-background`, `--skin-now-bar-background`, `--skin-karaoke-overlay-background` y `--skin-ambient-*`. Consumidores en reglas comunes de componentes o en superficies que ya pinten esos componentes. | Aproximadamente la docena de ramas restantes del vinilo/plato/brazo, incluido el label central y las condiciones de animación. |
| **Glacier** — 36 | Marca/títulos/eyebrow; `.btn-tab`, `.song-item`, `.song-thumb`; barra, relleno y thumb de progreso; botón play; toast; karaoke overlay; `now-bar`; overlay ambiental de `.player-panel`; `.aurora-bg`. Incluye reglas de tema claro y estado hover. | `--skin-brand-*`, `--skin-heading-*`, `--skin-list-row-*`, `--skin-list-thumb-*`, `--skin-progress-track/fill/thumb-*`, `--skin-play-control-*`, `--skin-notice-background`, `--skin-karaoke-overlay-background`, `--skin-now-bar-background`, `--skin-panel-atmosphere` y `--skin-ambient-*`. Dividir normal/hover/active si los valores difieren. | Las ramas de zafiro/vinilo, reflejos, centro y brazo. |
| **Gres** — 8 | No hay candidatos de componente de interfaz en el inventario: sus ramas son del disco, reflejos, carátula y brazo. | Ninguna migración de componente sugerida por ahora. No crear tokens artificiales sin un consumidor compartido. | Todas las reglas listadas: pertenecen al tocadiscos ornamental. |
| **Neon** — 31 (ya sin `.glass`) | `.brand-mark`, `.brand-title`, `.panel-title`, `.now-title`, progreso (`.progress-fill`, `.progress-thumb`), `.transport .btn-play`, estados activos de `.btn-tab`/`.viz-card`, `.toast`, `.karaoke-overlay`, `.now-bar`, `.aurora-bg`; título y avisos de tema claro. | Completar la familia ya iniciada: `--skin-brand-*`, `--skin-heading-*`, `--skin-track-title-*`, `--skin-progress-*`, `--skin-play-control-*`, `--skin-active-control-*`, `--skin-notice-background`, `--skin-karaoke-overlay-background`, `--skin-now-bar-background`, `--skin-ambient-*`. Glass ya lee `--skin-panel-background` y `--skin-panel-backdrop-filter`. | Las ramas restantes de anillo/plato, carátula, núcleo, brazo y animación de giro. |
| **Paper** — 13 | `.paper-sheet`/`::before` en claro y oscuro (4 ramas según el inventario; no aparece en fuentes HTML/JS). Puede ser un componente editorial opcional, no el panel común. | Si se mantiene como componente: `--skin-sheet-background`, `--skin-sheet-texture`, `--skin-sheet-edge`, `--skin-sheet-shadow` y token por tema para la textura. Un futuro modo de superficie “papel” decidiría aplicarlo; no imponerlo a las demás superficies. Verificar primero el uso. | Las otras 9 ramas de plato, etiqueta, reflejo y brazo. |
| **Ruby** — 42 (ya sin `.glass`) | Aurora/ruido; marca y tipografía; título de canción y eyebrow; letra activa; tabs, chips, filas y miniaturas; progreso, botón play; toast; karaoke overlay; now bar y ambiente del panel. | `--skin-ambient-*`, `--skin-brand-*`, `--skin-heading-*`, `--skin-track-title-*`, `--skin-lyric-active-*`, `--skin-tab-active-*`, `--skin-list-row-*`, `--skin-progress-*`, `--skin-play-control-*`, `--skin-notice-background`, `--skin-karaoke-overlay-background`, `--skin-now-bar-background`. Ya publica `--skin-panel-background` y `--skin-panel-backdrop-filter` para Glass; su tema claro sustituye el fondo del panel por `--glass-bg`. | Las ramas restantes de plato/caratula, centro, brazo y animación. |
| **Telar** — 76 | Cerca de 67 ramas `.tl-*` de panel, botón/estados, range, lista/fila, visualizador, letras, modal, toast y vacío; hay además estilos de foco y scrollbar. La biblioteca `.tl-*` no tiene referencias literales en las fuentes HTML/JS. | Primero decidir si ese kit se conserva. Si sí, separar el contrato estructural del visual: reglas de layout/estados en un módulo de componentes optativo; apariencia con tokens como `--skin-panel-*`, `--skin-control-*`, `--skin-range-*`, `--skin-list-*`, `--skin-lyrics-*`, `--skin-modal-*`, `--skin-notice-*`. `--pattern-image` ya existe; cada superficie que quiera trama la compone. | Los 9 selectores de plato/caratula y brazo; también el ambiente y las decoraciones globales propias de Telar mientras no haya un token global equivalente. Mantener foco visible y reduced-motion/reduced-contrast en sus capas de responsabilidad. |
| **Titanium** — 12 | `.titanium-glass`/`::before` (3 ramas; sin referencia literal en HTML/JS). | Si es una variante de panel real, reutilizar la API común de `--skin-panel-*`; no crear un consumidor `.titanium-glass` dentro de skin. Activarlo solo desde superficies elegidas. | Las otras 9 ramas del tocadiscos y el brazo metálico. |
| **Ulm** — 11 | `.brass-glass` y `::before` (3 ramas; sin referencia literal en HTML/JS), incluyendo una variante clara. | Reutilizar la familia común de panel y definir solo valores en `:root[data-skin="ulm"]` y su variante clara. Confirmar si el componente se usa. | Las otras 8 ramas de vinilo, carátula y brazo. |

Las cantidades de la primera columna son **ramas selectoras con clase**, no cantidad de reglas ni número exacto de cambios. Las listas se solapan entre variantes y pseudo-elementos; el inventario vinculado contiene cada selector y su especificidad.

## Familias de tokens recomendadas

### 1. Paleta semántica — fuente de verdad en skin

Conservar como tokens raíz los colores/roles que ya existen: acento, texto, fondo, superficies semánticas, bordes, tonos de estado y gradientes de marca. Los componentes no deberían volver a seleccionar `[data-skin]` para repetir esos colores: deben leer tokens semánticos comunes (`--accent-*`, `--text-*`, `--bg-*`, `--glass-*`, `--gradient-*`). Antes de crear otro token visual, revisar si ya hay un equivalente; de lo contrario se duplican dos paletas que luego divergen entre claro/oscuro.

### 2. Componentes — apariencia opcional por token

Donde un valor de skin sea verdaderamente distintivo y no se represente ya con la paleta, definir variables de apariencia con prefijo `--skin-` y semántica estable, por ejemplo `--skin-progress-glow`, `--skin-active-row-background` o `--skin-brand-title-shadow`. No codificar nombres de clase CSS en el nombre del token. Agrupar variantes de estado (`hover`, `active`, `disabled`, `focus-visible`) solo cuando las superficies puedan aplicarlas correctamente.

Las reglas que ya poseen el selector del componente se mantienen en un archivo común o de superficie y reciben el token con fallback local. Ejemplo esquemático:

```css
/* skins/neon.css — valores, sin selector de componente */
:root[data-skin="neon"] {
  --skin-progress-fill: var(--gradient-primary);
  --skin-progress-glow: 0 0 16px rgba(var(--accent-rgb), .72);
}

/* superficie que admite ese tratamiento — selector del componente aquí */
:root[data-ui="glass"] .progress-fill {
  background: var(--skin-progress-fill, var(--accent));
  box-shadow: var(--skin-progress-glow, none);
}
```

Cada superficie debe declarar de forma visible si consume la parte estética del token. Para una familia no soportada por una superficie, se deja el token sin usar en vez de obligar un brillo, borde, textura o radio que rompa esa materialidad.

### 3. Textura — token opcional con punto de composición

`--pattern-image` es una imagen de fondo, no una declaración completa del panel. La superficie decide dónde va en el orden de capas, el tamaño, la repetición, la opacidad y si reduce/omite la trama en modo accesible. Ejemplo conceptual:

```css
/* skin: solo define el recurso */
:root[data-skin="telar"] { --pattern-image: var(--tl-weave); }

/* surface: elige consumirlo y controlarlo */
:root[data-ui="glass"] .glass {
  background-image: var(--pattern-image, none), var(--gl-frost), var(--gl-surface);
}
```

No añadir `--pattern-image: none` en todas las skins salvo que se necesite un contrato explícito: el fallback `var(--pattern-image, none)` ya cubre la ausencia. Si otra skin aporta una textura distinta, puede definir el mismo token sin cambiar selectores de componentes.

### 4. Paneles y filtros

Neon y Ruby ya prueban `--skin-panel-background` y `--skin-panel-backdrop-filter` con consumidor en Glass. Para migrar otros paneles, separar `background`, `border`, `shadow`, `backdrop-filter` y overlay atmosférico; no asumir que un único `--skin-panel-background` funciona para las ocho superficies. Revisar `prefers-reduced-transparency`: el fondo de reserva debe ser suficientemente opaco y no depender del filtro.

### 5. Valores estructurales, estados y comportamiento

No convertir indiscriminadamente `display`, `position`, `inset`, `z-index`, `grid-template`, padding, tamaños de interacción, `content`, `pointer-events`, `transform`, `animation` o geometría del artwork en tokens de skin. Si una clase `.tl-*` define la anatomía de un componente propio, su selector y contrato estructural pertenecen al módulo de ese componente; solo su color, textura, sombra, radio o tipografía se tematizan. Animaciones/transiciones y estados accesibles deben mantenerse con sus condiciones correspondientes, sin tokenizar accidentalmente una regla de `prefers-reduced-motion` o focus.

## Orden recomendado de migración

1. **Inventario y pertenencia al DOM.** Marcar cada regla como componente activo, tocadiscos identitario, estilo global/ambiental, componente optativo o huérfano. La búsqueda actual ya detecta como no referenciadas literalmente varias familias especiales y `.tl-*`; verificar plantillas y DOM generado antes de decidir su destino.
2. **Cerrar una familia con consumidor real.** Empezar por componentes compartidos que existen en la app y se repiten entre skins: `toast`, `now-bar`, `brand/title`, progreso, controles y estados activos. Extraer una familia, definir nombres/fallbacks, y refactorizar consumidores en las superficies compatibles.
3. **Unificar variantes de tema.** Llevar valores de skin claro/oscuro a variables en los bloques raíz ya existentes. Reducir selectores redundantes solo después de confirmar si `data-theme` se aplica al root o a subárboles; el CSS actual contiene ambas formas (`:root[...]` y `[data-skin] [data-theme]`). No borrar una cobertura anidada suponiendo que el atributo solo vive en `html`.
4. **Migrar optativos por separado.** Brass/Titanium/Ulm (`*-glass`), Paper (`.paper-sheet`) y Telar (`.tl-*`) no aparecen como texto en las fuentes HTML/JS. Acordar si se integran a la aplicación, se conservan como demo aislada o se eliminan. No diseñar ocho consumidores de superficie para clases que quizá no existen.
5. **Conservar la propiedad del hardware visual.** Dejar en `skin` la pila de gradientes, carátula, groove, glare, spindle, brazo y animación condicionada al giro; son equivalentes directos al tocadiscos, no a una tarjeta o botón genérico.
6. **Validar y borrar el selector original.** Tras mover un caso, buscar el selector en toda la hoja, validar modo claro/oscuro, cada superficie compatible, reduced-transparency/motion y pantallas pequeñas; recién entonces quitar la regla de skin. Al final regenerar el informe de especificidad y comprobar que las ramas bajan en `skin` y suben/continúan en sus capas propietarias.

## Riesgos y decisiones abiertas

- **Incompatibilidad visual entre superficies:** un shadow diseñado para vidrio puede ser impropio en Flat o Brutalism. Los tokens de efectos deben ser opt-in, no valores forzados globalmente.
- **Capas y fallbacks:** declarar un token en `skin` no gana por especificidad frente a reglas en `surface`; gana el selector consumidor en `surface` y su valor llega por la custom property. Evitar duplicar el mismo componente con selectores de skin de mayor especificidad.
- **Tema claro y selectores anidados:** consolidar reglas solo después de comprobar dónde se cambia `data-theme`; si hay subárboles tematizados, usar tokens scoped apropiadamente.
- **Variables con listas de fondos:** una custom property puede contener varias capas separadas por coma; el consumidor debe integrar ese valor en el orden correcto y considerar tamaño/repetición por capa. Inspeccionar que ninguna sustitución rompa el shorthand `background`.
- **DOM no localizado:** clases optativas pueden ser cargadas por contenido externo, constructores o fragmentos de prueba no encontrados por búsqueda literal. Consultar consumidores antes de eliminarlas.
- **Accesibilidad:** no sustituir focus-visible, controles deshabilitados, scrollbar, reduced motion/transparency ni contraste de estados por valores puramente estéticos sin fallback.
- **Alta especificidad del tocadiscos:** mantener los casos `:has()` con estado de giro en las reglas de identidad, pero limitar su alcance a la capa `skin`/`finish` según la función y documentar cualquier `!important`.

## Conclusión

La mejor oportunidad de reducción de fragilidad no es convertir las 273 ramas con clase en tokens de forma mecánica. Es separar tres cosas: **paleta semántica** (skin define), **elección del material y tratamiento visual** (surface consume u omite) y **geometría/identidad del tocadiscos** (skin conserva). Las reglas de UI activas de Emerald, Glacier, Neon y Ruby son la principal ola de migración; los kits Brass/Titanium/Ulm/Paper/Telar requieren primero una decisión de uso. El siguiente cambio aconsejado sería migrar una familia compartida —por ejemplo toast y now-bar— con tokens por estado y consumidores en las superficies donde existan, no trasladar hojas enteras de golpe.
