# Matriz de integración: skins restantes

## Alcance

Esta tanda continúa la matriz previa de Glaciar y Rubí y cubre las seis skins restantes del catálogo definido en el TODO:

- **Skins:** Brass, Titanium, Paper, Ulm, Gres y Telar.
- **Temas:** oscuro y claro.
- **Superficies:** `neu`, `skeuo`, `glass`, `clay`, `brutal`, `aurora`, `flat` y `bento`.

La matriz contiene **96 combinaciones**: 6 skins × 2 temas × 8 superficies.

## Resultado

`npm run check:surface-matrix` pasó con **96/96 combinaciones enumeradas**, sin fallos.

El arnés verificó por combinación:

1. La superficie está registrada en `styles/ui-style-cycle.js` y enlazada desde `index.html`.
2. La hoja de superficie usa el selector raíz correspondiente a `data-ui`.
3. Ninguna superficie se acopla directamente a `data-skin`.
4. El ciclo de superficies escribe y persiste `data-ui` sin mezclar los ejes.
5. Los 16 controles/componentes críticos del reproductor están presentes: skin, tema, superficie, reproducción, navegación, progreso, volumen, biblioteca, cola, EQ, visualizador, karaoke y toast.
6. Se conservan estados independientes para cada combinación (`data-skin`, `data-theme`, `data-ui`).

## Validaciones complementarias

- `npm run lint:scopes`: correcto.
- `npm run lint:surface-tokens`: correcto.
- `npm run check:a11y:skins`: **20/20 combinaciones** de skins/temas calculadas, **0 fallos** de contraste y **0 valores no resolubles**.
- `npm run build:production`: correcto; el build se generó en `dist/`.

## Advertencia conocida

La matriz conserva una advertencia para `styles/aurora.css` porque contiene una regla de ocultación visual. La regla corresponde a pseudo-elementos decorativos en `forced-colors: active`, no a controles funcionales; debe mantenerse en la revisión manual de esquema de colores forzados.

## Limitación

Estas son pruebas estáticas y de contrato. Este equipo no dispone de un navegador automatizable, por lo que no se generaron capturas ni se ejecutaron clics reales, `focus-visible`, hover, teclado, reproducción, karaoke o cambios de superficie dentro de un navegador. El informe JSON reproducible queda en `.work/surface-matrix/matrix-report.json`.

## Comando reproducible

```text
npm.cmd run check:surface-matrix
npm.cmd run lint:scopes
npm.cmd run lint:surface-tokens
npm.cmd run check:a11y:skins
npm.cmd run build:production
```
