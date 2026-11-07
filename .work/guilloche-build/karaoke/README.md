# Karaoke modular

## Recursos compartidos (`shared/`)
- `karaoke-core.js`: análisis de audio, partículas, seguimiento de letras, calidad adaptativa y API del motor.
- `karaoke.css`: layout y estructura del overlay.
- `karaoke-common.css`: tipografía, capas, controles, calidad, responsive y movimiento reducido.

## Estilos
`cinema/`, `neon/` y `kinetico/` contienen el CSS distintivo y el módulo JS de efectos de su estilo. `index.html` carga los archivos fuente completos en desarrollo, primero el núcleo compartido y después las tres escenas.

## Producción
No generes ni guardes variantes `.min` en estas carpetas. Desde la raíz del proyecto, ejecuta `npm ci` y `npm run build:production` al preparar un despliegue. El script crea `dist/`, minifica allí los nueve recursos de Karaoke y modifica únicamente el `dist/index.html` para cargar las variantes minificadas. Publica el contenido de `dist/`; el proyecto fuente permanece legible e intacto.
