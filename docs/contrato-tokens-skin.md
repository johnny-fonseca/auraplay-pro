# Contrato de tokens de tema, skin y superficie

AuraPlay separa la paleta e identidad de cada skin de los materiales de superficie, la geometría global y los estilos de los componentes. La API vive en `css/skin-contract.css`; los valores base están en `css/theme.css`, las paletas en `skins/*.css` y las variantes de material en `styles/*.css`.

## Tokens semánticos

Los componentes comunes deben consumir nombres por función, no variables privadas de una skin ni aliases históricos.

| Grupo | Tokens canónicos |
| --- | --- |
| Fondo | `--color-canvas`, `--color-canvas-raised`, `--color-canvas-sunken` |
| Texto | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-disabled` |
| Acento | `--color-accent`, `--color-accent-strong`, `--color-accent-soft`, `--color-accent-rgb`, `--color-accent-soft-rgb`, `--color-on-accent`, `--color-focus` |
| Estados | `--color-success`, `--color-warning`, `--color-danger`, `--color-info` y sus variantes `--color-on-*` |
| Superficie | `--surface-bg`, `--surface-bg-hover`, `--surface-bg-active`, `--surface-bg-selected`, `--surface-bg-disabled`, `--surface-border`, `--surface-border-strong` |
| Acabado | `--gradient-accent`, `--gradient-accent-secondary`, `--ambient-1` a `--ambient-4`, `--shadow-focus`, `--shadow-surface`, `--shadow-accent` |
| Estructura/ritmo | `--radius-*`, `--elev-*`, `--blur`, `--t-*`, `--ease-*` |

Los colores RGB son canales separados por comas, por ejemplo `rgba(var(--color-accent-rgb), .25)` o `rgb(var(--color-accent-soft-rgb))`.

## Responsabilidades y precedencia

- `skins/<id>.css` declara los valores semánticos de la paleta para `:root[data-skin="<id>"]` y los ajustes de tema claro cuando difieran. Puede publicar valores iniciales de superficie para conservar su material característico.
- `styles/*.css` ajusta materiales, radios y elevaciones en el eje `data-ui`; si una combinación necesita texto de contraste, usa roles semánticos como `--color-text-primary`, no aliases como `--text-primary`.
- `css/skin-contract.css` contiene los fallbacks semánticos, los consumidores comunes de tokens `--skin-*` y los mínimos de foco/texto. No traduce nombres antiguos.
- `css/theme.css` contiene estructura y reglas compartidas. Las capas declaradas en `index.html` ordenan base, tema, skin, superficie y finish; respeta ese orden al añadir reglas.
- Los componentes comunes no deben volver a seleccionar por skin (`[data-skin="..."]`) para aplicar presentación estándar. Cuando una identidad requiera un acabado propio, publícalo como token `--skin-*` y consúmelo desde la capa propietaria del componente.

## Añadir o migrar una skin

1. Define la paleta en el selector raíz de la skin con nombres canónicos; añade overrides en `:root[data-skin="<id>"][data-theme="light"]` cuando existan valores distintos.
2. Si alguna regla compartida requiere un tratamiento de marca, declara un token `--skin-*` en la skin y reutiliza el consumidor común existente. No copies reglas de componentes a la hoja de skin.
3. Conserva en la skin solo excepciones decorativas locales (por ejemplo, arte del vinilo o adornos), sin cambiar geometría ni comportamiento común.
4. Busca referencias antes de eliminar cualquier propiedad: `var(--nombre)` debe apuntar a una variable definida en la API canónica, no a una capa de compatibilidad.

Los antiguos nombres `--bg-*`, `--text-*`, `--accent-*`, `--glass-*`, `--gradient-*`, `--mesh-*`, `--focus-ring`, `--shadow-panel` y `--r-*` ya no forman parte de la API. No los reintroduzcas; usa el rol semántico correspondiente, como `--radius-md`.

## Validación

Desde la raíz del repositorio, ejecuta:

```bash
npm run lint:scopes
npm run lint:surface-tokens
npm run check:a11y:skins
npm run build:production
```

`check:a11y:skins` calcula contraste de tokens base para las diez skins en oscuro y claro: texto normal (4.5:1), texto sobre acento (4.5:1), acento e indicador de foco (3:1). Es una auditoría estática; no sustituye la revisión visual ni las pruebas con `data-ui`, estados interactivos o colores forzados. `--color-focus` sigue el acento activo salvo override de skin.

Las reglas de alto contraste de Papel viven en `skins/paper-accessibility.css`, cargada después de `skins/paper.css`; mantenerlas separadas evita la incompatibilidad de CleanCSS 5.3.3 con el bloque anidado dentro de la hoja extensa.

Para una skin nueva, comprueba tema oscuro y claro y las combinaciones con las superficies disponibles, prestando atención a contraste, foco visible, estados activos y barra del reproductor. El build de producción se escribe en `dist/`; no uses ese directorio para pruebas que deban conservar la salida publicada.
