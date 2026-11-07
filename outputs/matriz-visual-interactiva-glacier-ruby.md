# Matriz visual/interactiva: Glaciar y Rubí

## Alcance

Se implementó un arnés reproducible con `npm run check:surface-matrix` para verificar la combinación independiente de:

- **Skins:** Glaciar y Rubí.
- **Temas:** oscuro y claro.
- **Superficies:** `neu`, `skeuo`, `glass`, `clay`, `brutal`, `aurora`, `flat` y `bento`.

La matriz contiene **32 combinaciones**: 2 skins × 2 temas × 8 superficies.

## Comprobaciones automatizadas

El arnés valida para cada combinación que:

1. La superficie está registrada en `styles/ui-style-cycle.js` y su hoja CSS está enlazada desde `index.html`.
2. La hoja utiliza el selector raíz correspondiente a `data-ui`.
3. La superficie no se acopla directamente a `data-skin`.
4. El ciclo de superficie escribe `document.documentElement.dataset.ui`, persiste `ui-style` y normaliza el modo.
5. Los 16 controles/componentes críticos del reproductor están presentes en el DOM: skin, tema, superficie, reproducción, navegación, progreso, volumen, biblioteca, cola, EQ, visualizador, karaoke y toast.
6. La matriz conserva estados independientes, representados como `data-skin + data-theme + data-ui`.

Resultado: **32/32 combinaciones enumeradas, sin fallos**.

## Cambios adicionales

- Se eliminó `!important` de `styles/claymorphism.css`; la precedencia de `@layer surface` es suficiente para que Clay prevalezca sobre las skins sin romper la cascada.
- Se mantiene una advertencia controlada para `styles/aurora.css`: `display: none` solo se aplica a pseudo-elementos decorativos durante `forced-colors: active`, no a controles funcionales.

## Validaciones complementarias

- `lint:scopes`: correcto.
- `lint:surface-tokens`: correcto.
- `check:a11y:skins`: 20/20 combinaciones de skins/temas sin fallos de contraste.
- `build:production`: correcto.

## Limitación actual

Este equipo no dispone de un navegador automatizable, por lo que todavía no se generaron capturas ni se ejecutaron clics reales, focus-visible, hover, teclado, reproducción, karaoke o cambios de superficie dentro de un navegador. El informe JSON completo queda en `.work/surface-matrix/matrix-report.json` para conectarlo posteriormente a Playwright o a una sesión de navegador.
