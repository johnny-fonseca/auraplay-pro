# TODO: contrato visual unificado para temas, skins y estilos de superficie

## Objetivo

Asegurar que todas las skins de AuraPlay compartan el mismo esqueleto, comportamiento, estados y niveles de contraste, mientras cada una conserva su identidad estética. La combinación de referencia es **tema oscuro + skin Neón + cualquier estilo de superficie**.

La selección de skin (`data-skin`), tema (`data-theme`) y estilo de superficie (`data-ui`) debe seguir siendo independiente:

- **Tema:** define el modo claro/oscuro y sus requisitos de legibilidad.
- **Skin:** define la paleta de marca, tipografías y decoración propia.
- **Estilo de superficie:** define el tratamiento de paneles y controles (relieve, vidrio, plano, bento, etc.).
- **Componentes base:** conservan geometría, distribución, interacción y accesibilidad comunes.

## Estado inicial observado

- `index.html` declara las capas `base, theme, skin, surface, finish`.
- `css/theme.css` ya contiene tokens estructurales como radios, elevaciones, blur y glass, y señala que las skins no deberían redefinirlos.
- `skins/neon.css` y `skins/emerald.css` definen paletas propias, pero también incluyen reglas directas de componentes como títulos, botón Play, toast y karaoke.
- `skins/emerald.css` redefine alias `--r-*` además de los tokens canónicos `--radius-*`; comprobar si ambos sistemas siguen siendo necesarios.
- `js/skin.js` persiste la selección y actualiza el atributo `data-skin`; `js/surfaceStyle.js` gestiona `data-ui` por separado.
- Hay diez skins registradas: `brass`, `neon`, `emerald`, `glacier`, `ruby`, `titanium`, `paper`, `ulm`, `gres` y `telar`.

---

# 1. Definir y documentar el contrato de tokens

## 1.1 Tokens estructurales (propiedad de `theme.css`)

- [ ] Mantener una sola escala canónica para geometría y movimiento:
  - `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-pill`
  - `--space-*` (si se decide centralizar espaciado; primero inventariar usos existentes)
  - `--control-height-sm`, `--control-height-md`, `--control-height-lg` (si son necesarios para controles uniformes)
  - `--t-fast`, `--t-med`, `--t-slow`, `--ease-out`, `--ease-in-out`
- [ ] Mantener una sola escala de elevación: `--elev-1`, `--elev-2`, `--elev-3` y/o los tokens de sombra ya usados, evitando duplicados con significados distintos.
- [ ] Documentar que las skins no deben redefinir geometría, espaciado, transiciones, tamaños ni elevaciones estructurales.
- [ ] Resolver aliases existentes (`--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-pill`) de forma explícita: mantenerlos como aliases de compatibilidad o migrar los consumidores a `--radius-*` y retirarlos tras búsqueda global.

## 1.2 Tokens semánticos de color (propiedad de cada skin y sus variantes de tema)

Cada skin debe proporcionar valores para los mismos nombres; los componentes no deben conocer colores de una skin concreta.

- [ ] **Fondo:** `--color-canvas`, `--color-canvas-raised`, `--color-canvas-sunken`.
- [ ] **Texto:** `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-disabled`.
- [ ] **Bordes:** `--color-border`, `--color-border-strong`, `--color-divider`.
- [ ] **Acentos:** `--color-accent`, `--color-accent-strong`, `--color-accent-soft`, `--color-on-accent`.
- [ ] **Estados:** `--color-success`, `--color-warning`, `--color-danger`, `--color-info` y sus equivalentes `--color-on-*` donde haya texto sobre relleno.
- [ ] **Foco:** `--color-focus` y `--shadow-focus` (anillo perceptible en claro y oscuro).
- [ ] **Superficies:** `--surface-bg`, `--surface-bg-hover`, `--surface-bg-active`, `--surface-bg-selected`, `--surface-bg-disabled`, `--surface-border`, `--surface-border-strong`.
- [ ] **Gradientes:** `--gradient-accent` y `--gradient-accent-secondary`; mantener gradientes decorativos adicionales como tokens privados de la skin.
- [ ] **Ambiente:** `--ambient-1`…`--ambient-4` (o un único contrato acordado) para aurora, resplandor y fondos ambientales.
- [ ] **Contraste:** definir combinaciones de texto/relleno y validar estados, sin asumir que un acento brillante sirve automáticamente como color de texto.

## 1.3 Tokens visuales de skin (propiedad de cada skin)

- [ ] Limitar la skin a identidad estética: `--font-display`, `--font-body`, acentos, texturas, materiales, brillos y tokens decorativos propios.
- [ ] Nombrar tokens privados con prefijo específico, por ejemplo `--neon-*` o `--emerald-*`, cuando no sean parte del contrato compartido.
- [ ] Mantener las reglas del tocadiscos (vinilo, brazo, etiqueta, bisel) específicas de cada skin, pero dentro del ámbito de selector de esa skin.
- [ ] Evitar que tokens decorativos propios se conviertan en dependencias obligatorias de componentes comunes.

## 1.4 Tokens de superficie (propiedad de `styles/`)

- [ ] Los estilos `data-ui` deben personalizar exclusivamente la representación de superficies y controles acordada: textura/material, borde, radios visuales, sombra, blur y elevación.
- [ ] Deben consumir la paleta semántica de la skin activa, no sustituirla por una paleta propia fija.
- [ ] No deben definir tipografía de marca, alterar estructura/layout, ocultar controles ni cambiar estados funcionales.
- [ ] Asegurar compatibilidad entre cada skin y cada estilo de superficie; revisar especialmente selectores o valores de `styles/aurora.css` que asuman colores o propiedades no presentes en la app.

---

# 2. Definir la cascada y el alcance de los estilos

- [ ] Conservar y documentar el orden: `base → theme → skin → surface → finish`.
- [ ] Establecer propiedad única por categoría: base define estructura; tema establece modo; skin publica identidad y paleta; superficie controla material; finish añade acabados compartidos.
- [ ] Acotar todas las reglas de una skin a `:root[data-skin="nombre"] …` (y variantes del mismo selector para el tema claro cuando sean necesarias).
- [ ] Acotar reglas de superficie a `html[data-ui="nombre"] …` y evitar selectores hipotéticos o clases que no existan en el DOM.
- [ ] No usar `!important` para resolver conflictos ordinarios de cascada.
- [ ] Evitar estilos duplicados en componentes comunes. Una skin puede tener una excepción decorativa intencional, documentada y localizada.
- [ ] Revisar selectores agrupados de tema claro, como `:root[data-skin="neon"][data-theme="light"], [data-skin="neon"] [data-theme="light"]`; confirmar cuál corresponde al DOM real (el atributo de tema está en `<html>`) y simplificarlos si procede.
- [ ] No tocar `data-skin`, `data-theme` ni `data-ui` desde CSS ni acoplar la persistencia de sus controles.

---

# 3. Inventariar y normalizar los tokens actuales

- [ ] Buscar en `css/`, `skins/` y `styles/` todos los usos y declaraciones de `--bg-*`, `--accent-*`, `--text-*`, `--glass-*`, `--shadow-*`, `--focus-ring`, `--gradient-*`, `--radius-*`, `--r-*`, `--tone-*`, `--mesh-*` y tokens de nombres de skin.
- [ ] Crear una tabla de correspondencia de los nombres existentes a los nombres semánticos nuevos antes de cambiar consumidores.
- [ ] Definir precedencia clara entre fondo del tema y fondo de skin: la skin publica valores para modo claro/oscuro; no crear una regla global que fuerce oscuridad cuando `data-theme="light"` está seleccionado.
- [ ] Decidir si `--bg-base` y otros tokens antiguos se conservan temporalmente como aliases, por ejemplo `--bg-base: var(--color-canvas)`, para migrar sin romper componentes.
- [ ] Identificar propiedades estructurales actualmente redefinidas por skins (radios, tamaños, blur, sombras, fuentes y tipografía de títulos) y clasificarlas como tokens estructurales, tokens de superficie o identidad de skin.
- [ ] No cambiar simultáneamente el nombre de tokens y el aspecto visual sin una validación visual de referencia.

---

# 4. Refactorizar Neón

## 4.1 Paleta y modos

- [ ] En `skins/neon.css`, mantener una única sección de tokens para Neón oscuro y otra para Neón claro.
- [ ] Mapear sus variables actuales (`--bg-base`, `--accent-rgb`, `--accent2-rgb`, `--text-*`, `--glass-*`, `--gradient-primary`, `--focus-ring`, etc.) al contrato semántico.
- [ ] Conservar magenta/cian como identidad de Neón; suministrar valores con contraste suficiente para ambos temas.
- [ ] Asegurar que la variante oscura de Neón se usa únicamente cuando `data-theme` es oscuro o no está definido según el comportamiento predeterminado real.
- [ ] No permitir que la regla de Neón claro se active por una estructura DOM hipotética distinta a la app.

## 4.2 Componentes comunes

- [ ] Convertir reglas de `.brand-mark`, `.brand-title`, `.panel-title`, `.now-title`, `.progress-fill`, `.progress-thumb`, `.btn-play`, `.btn-tab.active`, `.viz-card.active`, `.toast`, `.karaoke-overlay` y `.now-bar` para que consuman tokens semánticos compartidos.
- [ ] Eliminar de la skin los valores de tamaño/espaciado/altura de control si alteran la geometría común; conservar solo decisiones tipográficas de marca permitidas y probar que no causen saltos de layout.
- [ ] Si un componente realmente necesita una decoración exclusiva de Neón, definirla con `--neon-*` y documentar por qué no pertenece al estilo de superficie.
- [ ] Asegurar que play, seleccionado, hover, disabled y foco siguen estados comunes; no depender solo de color para comunicar estado.
- [ ] Adaptar el toast y el escenario de karaoke a tokens de superficie/texto en vez de fondos oscuros codificados que impidan compatibilidad con el tema claro.
- [ ] Mantener la ornamentación del tocadiscos (vinilo y brazo) como excepciones de skin; comprobar que su geometría y animación base no cambian.

## 4.3 Muestra de destino (esquema ilustrativo)

> Es una guía de estructura, no un reemplazo literal: primero acordar los nombres canónicos y revisar todas las dependencias.

```css
@layer skin {
  :root[data-skin="neon"] {
    --color-canvas: #06081a;
    --color-canvas-raised: #0d1030;
    --color-canvas-sunken: #03040e;
    --color-text-primary: #f4f2ff;
    --color-text-secondary: #c6c9e8;
    --color-text-muted: #8991bd;
    --color-text-disabled: #565d88;
    --color-accent: #ff2bd6;
    --color-accent-strong: #ff73e3;
    --color-accent-soft: #6b3cff;
    --color-on-accent: #17051a;
    --color-focus: #00e5ff;
    --surface-bg: rgba(10, 12, 42, .52);
    --surface-bg-hover: rgba(20, 22, 68, .68);
    --surface-bg-active: rgba(34, 30, 86, .82);
    --surface-border: rgba(164, 220, 255, .16);
    --surface-border-strong: rgba(0, 229, 255, .42);
    --gradient-accent: linear-gradient(135deg, #ffd6f5, #ff2bd6 45%, #7a3cff);

    --neon-platter: #090b22;
    --neon-glow: 0 0 28px rgba(0, 229, 255, .42);
  }

  :root[data-skin="neon"][data-theme="light"] {
    --color-canvas: #eef2ff;
    --color-canvas-raised: #f7f8ff;
    --color-canvas-sunken: #e1e7fb;
    --color-text-primary: #171735;
    --color-text-secondary: #3e4670;
    --color-text-muted: #667099;
    --color-text-disabled: #929abd;
    --color-accent: #c11a9d;
    --color-accent-strong: #a61087;
    --color-accent-soft: #4d43c8;
    --color-on-accent: #fff;
    --color-focus: #007ba6;
    --surface-bg: rgba(255, 255, 255, .62);
    --surface-bg-hover: rgba(255, 255, 255, .80);
    --surface-bg-active: rgba(255, 255, 255, .94);
    --surface-border: rgba(35, 38, 100, .14);
    --surface-border-strong: rgba(0, 123, 166, .38);
  }

  :root[data-skin="neon"] .btn-play {
    box-shadow: var(--shadow-play, var(--neon-glow));
  }
}
```

- [ ] Revisar el esquema anterior contra los componentes reales; no añadir aliases como `--shadow-play` hasta confirmar si se necesitan.
- [ ] Mantener los selectores reales de AuraPlay (por ejemplo `.transport .btn-play` si esa es la clase existente) y no copiar nombres de ejemplo que no existan.

---

# 5. Refactorizar Esmeralda

## 5.1 Paleta y modos

- [ ] Publicar el mismo conjunto completo de tokens semánticos que Neón, con paleta bosque/esmeralda y acento secundario oro/bronce.
- [ ] Crear explícitamente valores claros y oscuros; evitar depender de valores heredados de Latón u otra skin.
- [ ] Eliminar o justificar `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`; no redefinir geometría global desde una skin.
- [ ] Mantener tokens de material propios —madera, cristal, bronce— bajo prefijo `--emerald-*`.

## 5.2 Componentes comunes

- [ ] Refactorizar las reglas directas para `.brand-mark`, `.brand-title`, `.panel-title`, `.modal-title`, `.now-title`, `.progress-meta .now-mini-title`, `.karaoke-mini .lyric-current`, `.k-line`, `.transport .btn-play`, `.karaoke-overlay` y `.toast`.
- [ ] Retirar ajustes de `font-size`, `line-height` y dimensiones que cambien la jerarquía tipográfica o el layout compartido; conservar la fuente de marca si no degrada legibilidad ni produce desbordes.
- [ ] Reemplazar colores opacos codificados de toast/karaoke por tokens semánticos que respeten tema claro/oscuro y el estilo de superficie.
- [ ] Conservar acabados exclusivos de vinilo, brazo, madera y cristal, limitados a la skin.

## 5.3 Muestra de destino (esquema ilustrativo)

```css
@layer skin {
  :root[data-skin="emerald"] {
    --color-canvas: #07100c;
    --color-canvas-raised: #0e1a14;
    --color-canvas-sunken: #040a07;
    --color-text-primary: #edf2e9;
    --color-text-secondary: #c3cdbf;
    --color-text-muted: #86938a;
    --color-text-disabled: #56635b;
    --color-accent: #3dc98c;
    --color-accent-strong: #62d9a5;
    --color-accent-soft: #17805a;
    --color-on-accent: #04140c;
    --color-focus: #e9b860;
    --surface-bg: rgba(15, 30, 22, .72);
    --surface-bg-hover: rgba(23, 45, 33, .82);
    --surface-bg-active: rgba(32, 59, 43, .92);
    --surface-border: rgba(190, 220, 196, .14);
    --surface-border-strong: rgba(61, 201, 140, .42);
    --gradient-accent: linear-gradient(135deg, #9aedc6, #3dc98c 50%, #16845a);

    --emerald-wood: #1b120a;
    --emerald-bronze: #d4a24c;
  }

  :root[data-skin="emerald"][data-theme="light"] {
    --color-canvas: #e6ece4;
    --color-canvas-raised: #f1f4ee;
    --color-canvas-sunken: #dce4da;
    --color-text-primary: #13211a;
    --color-text-secondary: #3c4a42;
    --color-text-muted: #5f6c64;
    --color-text-disabled: #93a098;
    --color-accent: #0f7a4c;
    --color-accent-strong: #0b633e;
    --color-accent-soft: #8a5f1c;
    --color-on-accent: #fff;
    --color-focus: #0f7a4c;
    --surface-bg: rgba(255, 255, 255, .55);
    --surface-bg-hover: rgba(255, 255, 255, .75);
    --surface-bg-active: rgba(255, 255, 255, .92);
    --surface-border: rgba(20, 40, 28, .10);
    --surface-border-strong: rgba(138, 95, 28, .35);
  }
}
```

- [ ] Revisar accesibilidad y contraste de estos ejemplos antes de declararlos definitivos; no asumir que son valores finales por estar en el ejemplo.

---

# 6. Migrar consumidores comunes

- [ ] En `css/theme.css` y el resto de `css/*.css`, sustituir gradualmente los colores concretos por tokens semánticos.
- [ ] Mantener fallbacks seguros durante la migración, por ejemplo `color: var(--color-text-primary, var(--text-primary))`.
- [ ] Asegurar que componentes comunes no lean tokens privados `--neon-*` ni `--emerald-*`.
- [ ] Aplicar el contrato a biblioteca, cola, reproductor, botones, EQ, visualizadores, inputs, modales, toasts, karaoke y estados vacíos.
- [ ] Confirmar que el estilo de superficie opera sobre esos tokens semánticos y no necesita reglas particulares para cada skin.
- [ ] Revisar componentes que dibujan colores desde JavaScript o Canvas: suministrar los colores semánticos de forma consistente cuando aplique, sin acoplarlos a nombres de skin.

---

# 7. Validación y pruebas

## 7.1 Pruebas funcionales

- [ ] Probar persistencia y cambio de skin, tema y estilo, incluyendo recarga y datos inválidos en almacenamiento.
- [ ] Confirmar que cambiar un eje no cambia accidentalmente los otros dos.
- [ ] Confirmar que no desaparecen controles ni se rompen reproducción, visualizador, EQ, playlist, karaoke o mando remoto.

## 7.2 Matriz visual mínima

- [ ] Validar las diez skins en tema oscuro y tema claro.
- [ ] Validar cada estilo `data-ui` con, al menos, Neón y Esmeralda en oscuro y claro.
- [ ] Para la combinación objetivo, validar **Neón oscuro** con todos los estilos de superficie.
- [ ] Comprobar escritorio y móvil: tamaños, overflow, texto truncado, botones táctiles y controles superpuestos.
- [ ] Revisar estados normal, hover, active/selected, playing, disabled, focus-visible, error y carga.
- [ ] Comprobar `prefers-reduced-motion`, teclado, lector de pantalla y esquema de colores forzados si ya forman parte del soporte del producto.

## 7.3 Accesibilidad y calidad de estilos

- [ ] Medir contraste de texto normal, texto pequeño, controles, foco y estados activos en ambos temas.
- [ ] No comunicar seleccionado/activo/error solo con color; conservar señal visual adicional.
- [ ] Revisar legibilidad de placeholders, texto deshabilitado y overlays.
- [ ] Verificar que los selectores de cada skin no alcanzan otras skins.
- [ ] Ejecutar las pruebas CSS/lint existentes y el build de producción; confirmar que el build solo modifica `dist/` según la documentación del proyecto.
- [ ] Comparar capturas antes/después y registrar regresiones aceptadas o corregirlas antes de extender el contrato a las otras skins.

---

# 8. Orden recomendado de ejecución

1. [x] Inventariar declaraciones y consumidores actuales; decidir los nombres canónicos.
2. [x] Añadir/documentar el contrato y aliases temporales en la capa de tema.
3. [x] Migrar consumidores comunes para leer tokens semánticos.
4. [ ] Refactorizar Neón y verificar Neón oscuro con todos los `data-ui`.
5. [ ] Refactorizar Esmeralda y verificar ambos temas.
6. [ ] Resolver tokens estructurales duplicados y retirar reglas de componente que sean innecesarias.
7. [ ] Aplicar el contrato al resto de skins, una por una, conservando sus excepciones decorativas.
8. [ ] Ejecutar matriz visual, accesibilidad, pruebas y build de producción.
9. [x] Retirar aliases antiguos solo cuando no queden usos y añadir la guía del contrato a la documentación del proyecto.

## Avance de ejecución (2026-11-07)

- [x] Neón ya publica tokens `--skin-*` y sus componentes compartidos usan consumidores comunes; la combinación visual con cada `data-ui` sigue pendiente.
- [x] Esmeralda trasladó sus ajustes compartidos de marca, títulos, reproducción, karaoke, toasts y barra móvil a tokens; `emerald.css` ya no contiene esos selectores comunes.
- [x] `npm run check:a11y:skins` calcula 20 combinaciones (10 skins × 2 temas) y no detecta fallos en los pares de tokens auditados.
- [x] `paper.css` y `paper-accessibility.css` pasan CleanCSS 5.3.3 niveles 0 y 1 sin errores ni warnings; los overrides `prefers-contrast` permanecen en la hoja complementaria.
- [x] `lint:scopes`, `lint:surface-tokens` y build de producción en `.work/unificacion-tokens-skins-final-20261107` pasaron; el build temporal incluye `paper-accessibility.css` y no se escribió en `dist/`.
- [ ] El inventario estructural detectó reglas compartidas aún directas en Glaciar y Rubí; quedan para el siguiente lote.
- [ ] Las capturas/matriz visual, pruebas interactivas, lector de pantalla, colores forzados y combinaciones con `data-ui` no se ejecutaron en esta tanda.

## Criterio de terminado

- [ ] Todas las skins publican el conjunto obligatorio de tokens semánticos para tema oscuro y claro.
- [ ] Los componentes comunes no tienen colores de marca codificados directamente ni dependen de tokens privados de una skin.
- [ ] Las superficies pueden combinarse con cualquier skin sin destruir su identidad, contraste, foco ni estados.
- [ ] Cambiar skin, tema o estilo solo modifica su propio eje visual.
- [ ] Neón oscuro mantiene su identidad al combinarse con todos los estilos de superficie, con layout y comportamiento invariantes.
- [ ] Las excepciones decorativas son locales, documentadas y no alteran geometría ni funcionalidad comunes.
