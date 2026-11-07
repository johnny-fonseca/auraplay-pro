# Karaoke modular

## Recursos compartidos (`shared/`)
- `karaoke-core.js`: análisis de audio, partículas, seguimiento de letras, calidad adaptativa y API del motor.
- `karaoke.css`: layout y estructura del overlay.
- `karaoke-common.css`: tipografía, capas, controles, calidad, responsive, movimiento reducido y progreso sincronizado por palabra.

## Estilos
`cinema/`, `neon/`, `kinetico/`, `guilloche/`, `yozakura/` y `palco-esmeralda/` contienen el CSS distintivo y su plugin de efectos. `index.html` enlaza los estilos y botones del selector; los plugins se cargan con `defer` después de `karaoke/shared/karaoke-core.js`. `js/player.js` valida, restaura, persiste y cicla los estilos disponibles. Las escenas dibujan únicamente efectos decorativos; las letras y los controles permanecen en el motor/CSS compartido y cada tema proporciona sus tokens visuales. Palco Esmeralda presenta un palco de ópera en terciopelo esmeralda y latón, con cortinas, bambalina, rampa de lámparas y polvo en suspensión; consulta [su README](palco-esmeralda/README.md).

## Producción
No generes ni guardes variantes `.min` en estas carpetas fuente. Desde la raíz del proyecto, ejecuta `npm ci` y `npm run build:production` al preparar un despliegue. El script crea `dist/`, minifica allí los 15 recursos de Karaoke (7 scripts JS y 8 hojas CSS) y modifica únicamente `dist/index.html` para cargar sus variantes minificadas. Publica el contenido de `dist/`; el proyecto fuente permanece legible e intacto.
