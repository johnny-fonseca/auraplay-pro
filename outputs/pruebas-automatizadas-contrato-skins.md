# Pruebas automatizadas del contrato visual de skins

## Propósito

Detectar temprano que cualquier skin o estilo de superficie rompe el contrato compartido. La suite debe distinguir errores estáticos de autoría CSS, errores de integración en navegador y regresiones visuales. Un screenshot por sí solo no basta: se necesitan validaciones estructurales, tokens calculados, estados funcionales y una matriz de combinaciones.

## Capas de prueba

### 1. Lint estático de autoría CSS (rápido, en cada CI)

Añadir un script Node sin dependencias o con parser CSS si el linter actual no puede analizar reglas anidadas con seguridad. Reutilizar `scripts/lint-css-scopes.js` y `scripts/lint-surface-tokens.js` como base.

Comprobar para cada archivo de `skins/*.css`:

- Todas las reglas de componentes quedan bajo el selector de la skin correspondiente (`:root[data-skin="...\"]`).
- No hay selectores que alcancen otra skin ni reglas globales no acotadas, excepto tokens del contrato dentro del root de la skin.
- No redefinir tokens estructurales prohibidos (`--radius-*`, `--elev-*`, tiempos, easing, alturas o espaciado) en las hojas de skin.
- Toda skin declara las propiedades semánticas requeridas para modo oscuro y claro, directamente o mediante una estrategia explícita de herencia validada.
- No usar colores hex/RGB directos en reglas de componentes comunes; permitirlos en tokens semánticos y reglas decorativas privadas del hardware/ilustración.
- No depender de tokens privados (`--neon-*`, `--emerald-*`) desde CSS común.
- No usar `!important` para resolver precedencia ordinaria.
- No duplicar nombres de `@keyframes` entre skins si el comportamiento no es deliberadamente compartido.

La lista de skins debe derivarse de los CSS presentes y contrastarse con el catálogo de `js/skin.js` para detectar skins sin hoja, hojas huérfanas o skins no cubiertas.

### 2. Prueba de contrato de tokens (Node, en cada CI)

Mantener una fuente de verdad versionada —por ejemplo `scripts/skin-contract.json`— con:

- nombres semánticos requeridos;
- tokens estructurales que una skin no puede redefinir;
- catálogo de skins y modos soportados;
- reglas de excepciones decorativas documentadas.

El validador debe parsear CSS y comprobar que los tokens requeridos se declaran para cada `data-skin` y `data-theme`. Evitar validaciones basadas solo en regex si hay riesgo de confundir comentarios, variables anidadas o bloques `@media`. Ante una declaración duplicada, resolver la cascada en navegador en vez de asumir el resultado por orden textual.

### 3. Pruebas de navegador de valores calculados (Playwright recomendado)

Ejecutar el sitio servido localmente, cargar cada combinación y consultar `getComputedStyle` de raíz y componentes reales. Esto verifica la cascada completa de CSS, que el lint estático no puede simular.

Matriz mínima por pull request:

- Las 10 skins × 2 temas en el estilo de superficie predeterminado.
- Skin Neón × tema oscuro × todos los estilos `data-ui`.
- Skin Esmeralda × tema oscuro/claro × todos los estilos `data-ui`.
- Casos de compatibilidad de `prefers-reduced-motion` y foco de teclado.

Matriz visual ampliada, programada o nocturna:

- Todas las skins × ambos temas × todos los estilos de superficie.

Para cada combinación, verificar:

- Ningún token obligatorio computa como `unset`, `initial`, vacío o valor inválido.
- Fondo, texto y superficie tienen valores computados y el documento no genera errores/recursos CSS faltantes.
- Los componentes comunes clave (panel, botón, input, pista, elemento activo, toast, modal, karaoke) mantienen display/visibilidad, dimensiones funcionales y estilos computados válidos.
- Foco visible y estados disabled/selected/playing no desaparecen.
- Cambio de skin no modifica `data-theme` ni `data-ui`; cambio de tema/estilo tampoco altera `data-skin`.
- El almacenamiento y el ciclo de selección continúan funcionando al recargar.

No fijar snapshots exactos de todos los valores calculados como contrato permanente: validar categorías e invariantes, dejando las decisiones cromáticas a cada skin.

### 4. Pruebas de contraste y accesibilidad

Calcular contraste WCAG de pares semánticos en oscuro y claro: texto principal/superficie, secundario/superficie, texto sobre acento y foco contra superficies adyacentes. Definir umbrales para texto normal y controles según WCAG aplicable. Marcar con reporte reproducible los casos que fallen; no intentar adivinar colores de texto solo a partir de nombres de tokens.

Revisar además:

- navegación por teclado y `:focus-visible`;
- estado activo comunicado de forma que no dependa solo del color;
- `prefers-reduced-motion`;
- zoom/reflow y controles táctiles;
- texto truncado o con contraste insuficiente en títulos, placeholders y overlays.

### 5. Regresión visual con capturas

Tomar screenshots de páginas/estados de referencia con viewport fijo, fuentes cargadas y datos de prueba deterministas. Comparar contra baseline con tolerancia de píxeles adecuada para diferencias de antialiasing. Capturar, como mínimo, pantalla inicial, playlist con selección, reproducción, EQ/visualizador, modal/toast y karaoke.

Las capturas detectan cambios inesperados, pero no deben sustituir las pruebas semánticas ni bloquear cambios de diseño aprobados sin posibilidad de actualizar baseline.

## Organización propuesta

```text
scripts/
  lint-css-scopes.js                 # existente: alcance de selectores y keyframes
  lint-surface-tokens.js             # existente: extender/normalizar reglas
  lint-skin-contract.js              # nuevo: catálogo, tokens obligatorios y prohibidos
  skin-contract.json                 # nuevo: esquema declarativo del contrato
  tests/
    skin-contract.test.js            # pruebas del validador y fixtures buenos/malos
    fixtures/
      valid-skin.css
      missing-token.css
      global-selector.css
      forbidden-radius-override.css
```

Si se adopta Playwright:

```text
tests/
  visual-contract.spec.js            # matriz abreviada y tokens calculados
  visual-regression.spec.js          # capturas de estados representativos
  fixtures/                           # datos UI locales y deterministas
```

## Scripts npm sugeridos

```json
{
  "scripts": {
    "lint:scopes": "node scripts/lint-css-scopes.js",
    "lint:surface-tokens": "node scripts/lint-surface-tokens.js",
    "lint:skin-contract": "node scripts/lint-skin-contract.js",
    "test:skin-contract": "node --test scripts/tests/skin-contract.test.js",
    "test:visual-contract": "playwright test tests/visual-contract.spec.js",
    "test:visual": "playwright test tests/visual-regression.spec.js",
    "test:ci": "npm run lint:scopes && npm run lint:surface-tokens && npm run lint:skin-contract && npm run test:skin-contract && npm run test:visual-contract"
  }
}
```

Instalar Playwright solo si se decide usar pruebas reales de navegador; fijar versión y añadir navegador/configuración CI de forma reproducible. No se recomienda instalarlo hasta aprobar el alcance y presupuesto de dependencias.

## Pipeline CI sugerido

1. Checkout y `npm ci`.
2. Lint de alcance CSS y tokens de superficie.
3. Lint del contrato de skins.
4. Pruebas unitarias del validador, incluyendo CSS válido y casos negativos.
5. Build de producción hacia `dist/` o una ubicación de prueba permitida.
6. Pruebas de navegador con servidor local y matriz abreviada.
7. Publicar screenshots/reportes como artefactos si hay fallo.
8. Matriz visual completa en ejecución programada o cuando cambien hojas de `skins/`, `styles/` o `css/`.

## Casos negativos obligatorios del validador

- [ ] Skin que omite un token semántico requerido.
- [ ] Skin que define tokens de oscuro, pero no tiene variante de claro.
- [ ] Selector global en una hoja `skins/`.
- [ ] Skin que redefine `--radius-md` o `--elev-2`.
- [ ] Componente común que depende de `--neon-*`.
- [ ] Skin registrada en `js/skin.js` sin CSS correspondiente.
- [ ] Hoja CSS presente que no está en el catálogo.
- [ ] Excepción decorativa no anotada o fuera del selector de skin.
- [ ] Regla que elimina foco visible o que oculta un control común.

## Criterio de aceptación

La suite pasa únicamente cuando todas las skins satisfacen el conjunto obligatorio de tokens en oscuro y claro, las reglas de autoría no encuentran overrides estructurales no autorizados, la matriz abreviada calcula valores válidos en navegador, y la combinación Neón oscuro × cualquier estilo de superficie conserva contraste, foco, controles y geometría funcional. Las diferencias de acabado entre skins se permiten cuando están encapsuladas y documentadas.
