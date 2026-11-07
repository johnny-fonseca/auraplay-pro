# Propuesta de limpieza y optimización de CSS

**Proyecto:** AuraPlay Pro  
**Alcance:** hojas base de `css/` y coordinación con `index.html`, JavaScript y estilos de modos/skins.  
**Estado:** limpieza conservadora aplicada en las hojas base; la consolidación de reglas repetidas queda pendiente.

## Resumen

La carpeta `css/` contiene 10 hojas base, de aproximadamente 1.4 a 13.6 KB cada una. Una búsqueda literal en el HTML y JavaScript actuales encontró ocho selectores de clase/ID presentes en CSS pero sin referencias en esas fuentes. Son candidatos a auditoría, no prueba definitiva de código muerto: hay que comprobar también clases creadas indirectamente, contenido de karaoke y vistas generadas, y validar la UI en ejecución antes de borrar reglas.

También se observan bloques repetidos con los mismos selectores en varias hojas. Esto justifica una segunda pasada de consolidación, pero no deben eliminarse por coincidencia textual: algunos bloques pueden estar separados deliberadamente para responsive, estados, overrides o compatibilidad de skins.

## Candidatos iniciales a verificar

No aparecen en `index.html`, `js/` ni las plantillas JavaScript/HTML de `karaoke/` consultadas:

- En `components.css`: `.brand-mark`, `.brand-subtitle`, `.brand-title`, `.btn-primary`, `.glass-strong`.
- En `queue.css`: `.eq-slider`.
- En `components.css` u hojas asociadas: `.search-wrap`.
- En `theme.css`: `#react-root`.

Antes de eliminar cada selector, verificar si se genera desde `innerHTML`, plantillas o código de terceros; si una variante se aplica desde una hoja de skin/estilo; y si existe una ruta de interfaz secundaria que no esté en el documento inicial. Para confirmar el conjunto, usar cobertura de CSS (Chrome DevTools Coverage) en recorridos de UI completos y revisar el DOM tras interacciones.

## Trabajo recomendado

### 1. Inventario y línea base

- Preservar una copia/commit de referencia y registrar el estado actual de `npm run lint:scopes`, `npm run lint:surface-tokens` y `npm run build:production`.
- Enumerar por hoja los selectores, reglas `@media`, `@supports`, keyframes y selectores dependientes de atributos/estados (`data-*`, `[hidden]`, `[aria-*]`, `.active`, `.open`, etc.).
- Ejecutar un recorrido de cobertura que incluya temas claro/oscuro, las skins, los ocho estilos de superficie, playlist/cola, EQ, visualizadores, modales, carga y estados de reproducción, karaoke y tamaños móvil/escritorio.

### 2. Eliminar únicamente código muerto confirmado

- Contrastar los candidatos anteriores con DOM en ejecución y cobertura; quitar solo selectores sin coincidencias ni cobertura en todos los recorridos acordados.
- Tratar por separado los selectores huérfanos incluidos dentro de listas separadas por comas. Si una rama está muerta pero las demás se usan, retirar solo esa rama.
- No borrar automáticamente selectores de pseudoestados, elementos creados por JS o reglas que se activan únicamente bajo media queries.

### 3. Consolidar duplicación con seguridad

La búsqueda detectó repetición textual de selectores en `components.css`, `player.css`, `playlist.css`, `queue.css`, `responsive.css`, `layout.css`, `finish.css`, `theme.css`, `vinyl-interaction.css` y `reset.css`. La repetición no equivale a duplicación inútil. Consolidar solo cuando coincidan las declaraciones, el contexto de cascada y el orden requerido; conservar overrides intencionales y anotar por qué se mantienen.

### 4. Mejoras de mantenimiento

- Mantener como fuente editada los CSS legibles; dejar la minificación al proceso de producción.
- Evitar selectores de atributos genéricos que no aporten estado, salvo que exista una razón clara de compatibilidad; por ejemplo, documentar el propósito de reglas como `html[data-ui]`.
- Añadir una comprobación automatizada que contraste atributos/valores UI emitidos por JavaScript con selectores CSS relevantes, en especial `data-ui`, `data-skin` y `data-theme`.
- No renombrar clases ni cambiar el orden de carga en la misma pasada que la eliminación de CSS muerto.

## Criterios para aceptar los cambios

1. Linters CSS y build de producción terminan sin errores.
2. No quedan errores de consola ni recursos CSS ausentes.
3. Los modos y skins conservan el aspecto y sus estados activo/inactivo.
4. Prueba visual de escritorio y móvil: reproductor, lista, cola, EQ, visualizadores, modales, karaoke y tema claro/oscuro.
5. La cobertura confirma que las reglas retiradas no se activan en los recorridos definidos.
6. Revisar el diff para descartar cambios de formato masivos o modificaciones accidentales a valores visuales.

## Riesgos y límites

- La cobertura solo describe los recorridos ejecutados; una ruta poco frecuente podría depender de una regla que parezca muerta.
- Varias hojas de estilo (`styles/`, `skins/`, karaoke) se cargan además de `css/`; una regla base puede ser necesaria como fallback aunque una vista concreta la sobrescriba.
- El escaneo por texto no reemplaza el análisis del DOM/cascada: selectores dentro de `:is()`, `:not()`, pseudo-elementos o cadenas generadas en tiempo de ejecución requieren revisión contextual.

## Orden de ejecución sugerido

1. Capturar línea base y matriz de pruebas.
2. Comprobar en DevTools los ocho candidatos de la lista.
3. Retirar candidatos confirmados en un diff pequeño por hoja.
4. Consolidar duplicaciones estrictamente equivalentes en un diff aparte.
5. Ejecutar linters, build, pruebas manuales y revisar el diff.
6. Documentar reglas conservadas por depender de estados o vistas dinámicas.
