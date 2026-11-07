# AuraPlay Pro

Reproductor de música web con visualizador, ecualizador de 10 bandas, karaoke en pantalla completa y soporte de letras LRC.

## Cómo usar

Tienes **3 formas** de ejecutarlo:

### 1) Abrir directamente (más simple)
Haz doble clic en `index.html`. Funciona en Chrome, Edge y Firefox modernos.

> ⚠️ Algunos navegadores bloquean el `file://` para audio o el File System Access API.
> Si carga la interfaz pero los archivos no reproducen, usa la opción 2.

### 2) Servidor local con Python (recomendado)
Abre una terminal en esta carpeta y ejecuta:

```bash
python3 -m http.server 8080
```

Luego abre http://localhost:8080 en el navegador.

### 3) Servidor local con Node
```bash
npx serve .
```

### Build para producción
El proyecto y `index.html` usan los archivos fuente completos durante el desarrollo. Solo al preparar un despliegue, instala las herramientas fijadas y genera la copia minificada:

```bash
npm ci
npm run build:production
```

Publica el contenido de `dist/`. El script minifica CSS/JS únicamente dentro de esa carpeta y cambia el `index.html` de producción para que use esas salidas; no modifica los archivos fuente ni el `index.html` de desarrollo.

## Tokens de tema, skin y superficie

Los nombres canónicos, responsabilidades por capa y pasos para añadir una skin están documentados en [el contrato de tokens](docs/contrato-tokens-skin.md).

## Estructura

```
auraplay-pro/
├── index.html              # UI principal
├── Abrir AuraPlay.bat      # inicia el relay y abre la app con un clic
├── package.json            # Comando build:production y minificadores
├── package-lock.json       # Versiones reproducibles del build
├── scripts/
│   └── build-production.js # Copia runtime y minifica solo hacia dist/
├── css/
│   ├── reset.css           # Reset + scrollbar
│   ├── theme.css           # Tokens + aurora bg + tema claro/oscuro
│   ├── layout.css          # Grid principal
│   ├── components.css      # Botones, modal, toast, loader
│   ├── playlist.css        # Panel biblioteca
│   ├── queue.css           # Cola + EQ + visualizadores
│   ├── player.css          # Reproductor + controles
│   └── responsive.css      # Breakpoints
├── karaoke/                # Karaoke modular; desarrollo usa fuentes completas
│   ├── shared/              # Núcleo, layout y CSS compartidos
│   ├── cinema/              # Skin y efectos Cinema
│   ├── neon/                # Skin y efectos Neón
│   └── kinetico/            # Skin y efectos Kinético
├── skins/                 # Skins intercambiables
│   ├── brass.css
│   ├── neon.css
│   ├── emerald.css
│   ├── glacier.css
│   ├── ruby.css
│   ├── titanium.css
│   ├── paper.css
│   ├── ulm.css
│   ├── gres.css
│   └── telar.css
├── visualizers/            # Estilos independientes + fachada compatible
│   ├── bars.js
│   ├── coverAura.js
│   ├── circular.js
│   ├── particles.js
│   ├── tunnel.js
│   ├── mirror.js
│   ├── prism.js
│   ├── halo.js
│   ├── mycelium.js
│   ├── cymatics.js
│   └── visualizer.js
├── remote/                  # Mando móvil, relay LAN y host del reproductor
│   ├── remote.html          # Interfaz para abrir desde el teléfono
│   ├── remoteClient.js      # Cliente móvil
│   ├── remoteServer.js      # Adaptador del reproductor + QR
│   ├── auraAdapter.js       # Mapea los controles al API real de AuraPlayer
│   ├── AuraPlayRelayNode.js  # Relay WS + servidor HTTP estático/configuración (Node)
│   ├── AuraPlayRelayPShell.ps1 # Alternativa integrada para Windows PowerShell/.NET
│   └── qrcode.min.js        # Generador local de QR
└── js/
    ├── utils.js            # Helpers (formato, escape, etc.)
    ├── storage.js          # localStorage wrapper
    ├── toast.js            # Notificaciones
    ├── lrcParser.js        # Parser LRC sincronizado
    ├── metadata.js         # Tags ID3 (usa jsmediatags CDN)
    ├── audioGraph.js       # Web Audio + EQ + analyser
    ├── BabyScratchEngine.js # Motor granular Baby Scratch con buffer invertido
    ├── shortcuts.js        # Atajos de teclado
    ├── player.js           # Núcleo del reproductor
    └── app.js              # Entry point
```

## Funcionalidades

### Reproducción
- Drag & drop ventana completa para audio y `.lrc`
- Selector de archivos múltiples y de carpetas (File System Access API)
- Formatos: MP3, M4A, WAV, OGG, FLAC, AAC, OPUS, WMA
- Shuffle, repetir (off/all/one), búsqueda, volumen, mute

### Visualizador (10 estilos)
- Barras radiales
- Forma de onda
- Anillo pulsante
- Partículas explosivas
- Túnel hiperespacial
- Curva espejo
- Prisma cristalino: cristales facetados y haces de luz que recorren el espectro
- Halo osciloscópico: ecos de la forma de onda con resplandor anamórfico
- Micelio bioluminiscente: red de filamentos vivos y esporas que responde al audio
- Cimática: placa de Chladni viva con arena, nodos y ondas de choque

### Ecualizador de 10 bandas
- 60Hz a 16kHz, ±12dB por banda
- 9 presets: Plano, Rock, Pop, Jazz, Clásica, Electrónica, Bass+, Agudos+, Vocal
- Switch on/off, ajustes persistentes

### Karaoke
- Letras sincronizadas con archivos `.lrc` (mismo nombre que el audio)
- Karaoke mini en el reproductor (línea previa, actual, siguiente)
- **Modo pantalla completa** con fondo borroso de carátula, scroll automático y gradiente coral en la línea activa
- Offset ajustable con `[` y `]` o botones ±

Para descargar letras sincronizadas palabra por palabra, recomiendo [LDDC](https://github.com/chenmozhijin/LDDC). AuraPlay Pro también incluye un descargador automático de letras sincronizadas línea a línea.

### Listas
- Guardar listas (metadatos) en localStorage
- Exportar como `.m3u` descargable
- Reordenar la cola con drag & drop
- Añadir/eliminar pistas individualmente

### Temas
- Oscuro (Glassmorphism premium con aurora mesh)
- Claro (paleta cálida cream/beige)
- Skins: Latón, Neón, Esmeralda, Glaciar, Rubí, Titanio, Papel, Ulm, Gres (gres cerámico) y Telar (tapiz jacquard)
- Persistente

### Mando remoto móvil

El botón con icono de teléfono abre el panel del mando y su código QR. Para iniciar todo con un clic, abre `Abrir AuraPlay.bat`: usa Node.js como primera opción y, si no está instalado, inicia `remote/AuraPlayRelayPShell.ps1` con Windows PowerShell/.NET. Si ya hay un relay respondiendo en el puerto `8765`, lo reutiliza; para cambiar de backend, detén primero la instancia anterior. Ambos usan el puerto `8765`, sirven AuraPlay, el relay WebSocket y la configuración automática del QR, sin paquetes ni descargas. El relay no necesita Internet; la PC y el teléfono sí deben compartir una red local.

Inicio manual con Node.js:

```powershell
node remote/AuraPlayRelayNode.js --root . --port 8765
```

Inicio manual sin Node.js, usando Windows PowerShell 5.1/.NET:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\remote\AuraPlayRelayPShell.ps1 -Root . -Port 8765
```

En la PC abre `http://localhost:8765/`. El relay detecta la IP local y prepara automáticamente el enlace QR. Escanéalo desde el teléfono conectado a la misma red Wi‑Fi o punto de acceso. La PC debe permanecer encendida con el servidor en ejecución. Si Windows lo solicita, permite el programa correspondiente (Node.js o PowerShell) en redes privadas. El servicio limita el acceso a direcciones locales/privadas; no expongas el puerto a Internet. El QR incluye una clave aleatoria de sesión: compártelo solo con personas autorizadas y genera uno nuevo para revocar el anterior. Ayuda: `node remote/AuraPlayRelayNode.js --help` o `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\remote\AuraPlayRelayPShell.ps1 -Help`.

## Atajos de teclado

| Acción | Tecla |
|---|---|
| Play / Pausa | Espacio |
| Buscar en la pista | â† â†’ |
| Saltar Â±10s | Shift + â† â†’ |
| Pista anterior / siguiente | ↑ ↓ |
| Silenciar | M |
| Aleatorio | S |
| Repetir | R |
| Visualizador | V |
| Karaoke pantalla completa | K |
| Cambiar tema | T |
| Ayuda | H |
| Cerrar modales | Esc |
| Ajustar offset letras | [ ] |

## Requisitos

- Navegador moderno (Chrome 89+, Edge 89+, Firefox 90+, Safari 15+)
- Conexión inicial para fuentes Google y `jsmediatags` (después funciona offline)

## Notas técnicas

- El reproductor funciona en el navegador sin backend; el mando remoto usa el relay local opcional descrito arriba
- Datos persistentes en `localStorage` con prefijo `auraplay:`
- Object URLs limpiados al vaciar lista
- Web Audio API para EQ + visualizador
- Baby Scratch granular con AudioBuffer y reproducción invertida real
- Variable de oscilación de letras con offset persistente
- Mando remoto móvil mediante relay WebSocket local con Node.js o Windows PowerShell/.NET (`remote/AuraPlayRelayNode.js`, `remote/AuraPlayRelayPShell.ps1`)

Licencia: uso personal libre.

