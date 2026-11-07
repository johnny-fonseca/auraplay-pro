# AuraPlay Pro
## Guía de fuentes: qué fuente corresponde a cada skin, estilo y karaoke

**Complementa a:** `AuraPlay-guia-de-skins-estilos-y-karaoke.md`
**Se genera con:** `descargar_fuentes_auraplay.py`
**Cobertura:** latin + latin-ext (español, francés, portugués, italiano, alemán). Chino, japonés y coreano son opcionales con `--cjk`.

---

## 1. Cómo se organiza

La guía de personalización separa tres niveles, y las fuentes siguen esa separación:

- **Skins:** definen la tipografía general del reproductor (títulos y cuerpo).
- **Estilos de interfaz:** cambian la forma de los componentes y se combinan con un skin.
- **Karaoke fullscreen:** tiene su propia tipografía, solo para la escena de pantalla completa.

**Cuando se combinan skin y estilo (recomendación):** que ganen las fuentes del skin, para que "Neon + Glassmorfismo" siga usando Orbitron. Solo dos estilos deberían imponer su fuente porque es parte de su identidad:

- **Neubrutalismo:** títulos en Archivo peso 900.
- **Skeuomorfismo:** pantalla VFD en VT323.

Los demás estilos heredan `--font-display` y `--font-body` de la skin activa,
incluido su fallback global cuando no hay skin seleccionada.

---

## 2. Skins

| Skin | Títulos | Cuerpo y controles |
|---|---|---|
| Brass | Playfair Display | Inter |
| Emerald | Cormorant Garamond | DM Sans |
| Glacier | Outfit (mayúsculas, espaciado amplio) | DM Sans |
| Gres | Zen Old Mincho | DM Sans |
| Neon | Orbitron | Exo 2 |
| Paper | Source Serif 4 | Inter |
| Ruby | Playfair Display Italic | DM Sans |
| Telar | Fraunces | Nunito |
| Titanium | Barlow Condensed | Barlow |
| Ulm | Archivo | Archivo |

*Paper Accessibility* no es un skin completo, solo una capa de contraste, así que no lleva fuentes propias.

---

## 3. Estilos de interfaz

| Estilo | Fuente | Nota |
|---|---|---|
| Neumorfismo | Hereda de la skin activa | Redondeada mediante materiales suaves |
| Skeuomorfismo | Barlow Condensed (etiquetas) + VT323 (pantalla VFD) | VT323 solo para el display |
| Glassmorfismo | Hereda de la skin activa | Neutra, no compite con el cristal |
| Claymorfismo | Hereda de la skin activa | Redondeada y juguetona mediante formas y sombras |
| Neubrutalismo | Archivo 900 (títulos) + Space Grotesk (cuerpo) | Títulos en mayúsculas |
| Aurora | Hereda de la skin activa | Geométrica y fluida |
| Diseño plano | Hereda de la skin activa | Máxima claridad |
| Bento | Hereda de la skin activa | Estilo dashboard |

---

## 4. Karaoke a pantalla completa

| Estilo | Letras | Títulos / dock | Observaciones |
|---|---|---|---|
| Cinema | Playfair Display | Cormorant Garamond | Peso moderado, línea amplia |
| Guilloché Zafiro | Bodoni Moda | Cormorant Garamond | Solo en la línea grande: los trazos finos se pierden en tamaños chicos |
| Kinético | Anton | Barlow Condensed 800 | Anton en MAYÚSCULAS (`text-transform: uppercase`), como pide el estilo |
| Neon | Tilt Neon | Orbitron | Tilt Neon para el efecto tubo de neón; Orbitron para el dock/HUD |
| Palco Esmeralda | EB Garamond | Cormorant Garamond + DM Sans (controles) | Marfil y dorado |
| Yozakura | Zen Old Mincho | Zen Old Mincho | Añade Noto Serif JP como respaldo si habrá japonés |

---

## 5. Lista de familias (23 + respaldos)

| Familia | Dónde se usa |
|---|---|
| Playfair Display | Brass, Ruby (cursiva), Karaoke Cinema |
| Cormorant Garamond | Emerald, Karaoke Cinema / Guilloché / Palco Esmeralda (dock y títulos) |
| EB Garamond | Karaoke Palco Esmeralda (letras) |
| Bodoni Moda | Karaoke Guilloché Zafiro (letras) |
| Source Serif 4 | Paper |
| Fraunces | Telar (títulos) |
| Zen Old Mincho | Gres, Karaoke Yozakura |
| Inter | Brass y Paper (cuerpo), Glassmorfismo |
| DM Sans | Emerald, Glacier, Gres, Ruby (cuerpo), Karaoke Palco Esmeralda (controles) |
| Outfit | Glacier, Aurora |
| Exo 2 | Neon (cuerpo) |
| Nunito | Telar (cuerpo), Neumorfismo |
| Barlow | Titanium (cuerpo) |
| Barlow Condensed | Titanium (títulos), Skeuomorfismo (etiquetas), Karaoke Kinético (respaldo) |
| Archivo | Ulm, Neubrutalismo (títulos, peso 900) |
| Space Grotesk | Neubrutalismo (cuerpo) |
| VT323 | Skeuomorfismo (pantalla VFD) |
| Orbitron | Neon (títulos), Karaoke Neon (dock/HUD) |
| Tilt Neon | Karaoke Neon (letras) |
| Anton | Karaoke Kinético (letras) |
| **Noto Sans Symbols 2** | Respaldo para ♪ y símbolos en las letras LRC |
| **Noto Sans / Serif JP, SC, TC, KR** | Opcionales con `--cjk`: japonés, chino simplificado, chino tradicional y coreano |

---

## 6. Acentos y caracteres

- **Español y otros idiomas con alfabeto latino:** se incluyen latin y latin-ext (á é í ó ú ñ ü ¿ ¡, mayúsculas acentuadas, francés, portugués, italiano, alemán).
- **Verificado en las fuentes originales:** Orbitron, Tilt Neon, Anton y Zen Old Mincho. Las otras 19 familias son estándar de Google Fonts con latin-ext, pero no se comprobaron una por una. Ejecuta el script con `--check` para confirmarlo.
- **Chino, japonés y coreano:** no vienen por defecto. Con `--cjk` se añaden Noto Sans/Serif en peso 400. Solo Zen Old Mincho tiene kana y kanji propios, y el script no descarga ese subset.
- **El símbolo ♪:** muchas de estas fuentes no lo traen. Deja Noto Sans Symbols 2 al final de cada `font-family`.

---

## 7. Pesos y estilos

- **Un solo peso:** Anton, VT323 y Tilt Neon tienen solo peso 400 (Tilt Neon varía por inclinación, no por peso). Con `font-weight: bold` el navegador fabrica una negrita falsa; usa `font-weight: 400`.
- **Fuentes variables:** el script prefiere la versión variable cuando existe (un archivo para todos los pesos). Las que no la tienen se descargan por pesos.
- **Nombres normalizados:** en `fonts.css` los nombres quedan limpios ("Inter", no "Inter Variable").
- **CJK:** solo peso 400, repartido en fragmentos con `unicode-range`; el navegador baja únicamente los que necesita.

---

## 8. Uso en el proyecto

**Orden recomendado del `font-family`:** fuente de diseño → Noto Sans Symbols 2 → fuentes CJK → genérica.

```css
/* Karaoke Yozakura */
font-family: "Zen Old Mincho", "Noto Serif JP", "Noto Sans Symbols 2", serif;

/* Skin Brass con soporte CJK */
font-family: "Playfair Display", "Noto Sans Symbols 2", "Noto Sans JP", serif;
```

El navegador cambia de fuente carácter por carácter, así que las fuentes de respaldo solo se usan para lo que la primera no tenga.

**Estructura del zip:**

```text
AuraPlay-fonts/
├── fonts.css          # @font-face listos (woff2)
├── LEEME.txt          # mapa de fuentes y notas
├── families/<id>/     # archivos .woff2 + LICENSE de cada familia
└── ttf/<Familia>/     # solo con --ttf
```

`fonts.css` usa rutas relativas (`./families/...`): conserva la estructura de carpetas.

**Enlace en el reproductor:**

```html
<link rel="stylesheet" href="fonts/fonts.css">
```

---

## 9. El script

```bash
# Recomendado: con prueba de glifos y fuentes CJK
python descargar_fuentes_auraplay.py --check --cjk

# Solo japonés y coreano
python descargar_fuentes_auraplay.py --cjk ja,ko

# Solo algunas familias
python descargar_fuentes_auraplay.py --only "Inter,Orbitron"

# Añadir TTF para instalar en el PC (endpoint no oficial de Google, puede fallar)
python descargar_fuentes_auraplay.py --ttf
```

| Opción | Efecto |
|---|---|
| `--check` | Prueba de glifos con fontTools (`pip install fonttools brotli`) |
| `--cjk [ja,sc,tc,ko]` | Añade fuentes CJK en peso 400; sin valor, trae los cuatro idiomas |
| `--ttf` | Descarga también TTF desde Google Fonts |
| `--only "A,B"` | Solo esas familias |
| `--no-symbols` | Omite Noto Sans Symbols 2 |
| `--out CARPETA` | Cambia la carpeta de salida |
| `--no-zip` | No crea el ZIP |

**Fuente de los archivos:** los `.woff2` salen de los paquetes npm de Fontsource y se verifican con el checksum SHA-1 del registro.

**Aviso:** el script se probó con paquetes simulados, no contra internet real. Si una familia falla, lo informa al final y continúa con las demás. En macOS, si hay un error de certificado SSL con Python de python.org, ejecuta primero "Install Certificates.command".

---

## 10. Licencias

Todas las fuentes son de licencia abierta (SIL OFL 1.1 o Apache 2.0, según la familia) y aptas para uso comercial. La OFL exige que cada copia de la fuente conserve su aviso y licencia: **no borres los archivos `LICENSE` de `families/`** si distribuyes el reproductor.
