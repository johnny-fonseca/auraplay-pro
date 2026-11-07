# AuraPlay Pro — resumen del estado actual para ideación de producto

## Contexto del proyecto
AuraPlay Pro es un reproductor de música local ejecutado en el navegador, con interfaz en español y estética premium orientada a una experiencia de tocadiscos. Está implementado como una aplicación front-end en HTML, CSS y JavaScript, organizada por módulos. El proyecto actual no muestra una arquitectura de backend ni cuentas de usuario: su propuesta central es escuchar archivos que aporta la persona usuaria, procesarlos en el navegador y conservar preferencias/biblioteca en el dispositivo.

## Qué ofrece actualmente

### Reproducción y biblioteca
- Importación de múltiples archivos de audio, selección de carpetas y arrastrar/soltar archivos; también admite archivos `.lrc`.
- Biblioteca/cola con búsqueda, añadir o quitar pistas, reordenación, reproducción anterior/siguiente, shuffle, repetición, volumen y mute.
- Lectura de metadatos y carátulas; interfaz de “reproduciendo ahora”. El README declara MP3, M4A, WAV, OGG, FLAC, AAC, OPUS y WMA, aunque el soporte efectivo depende del navegador/codec, por lo que no conviene prometer idéntica compatibilidad en todas las plataformas.
- Guardado/carga de listas, exportación M3U, persistencia de biblioteca local y preferencias. Usa almacenamiento del navegador (localStorage y mecanismos de biblioteca local); no hay sincronización multiusuario/nube identificada en el proyecto.
- Modos de carga de carpeta condicionados por las APIs y permisos del navegador.

### Audio e interacción de tocadiscos
- Cadena Web Audio con ecualizador gráfico de 10 bandas, presets, analyser y volumen.
- El motor `audioGraph.js` implementa además procesamiento DSP avanzado: filtro pasa-altos, compensación/headroom automático, saturación, realce armónico de graves, exciter de agudos, anchura estéreo/mono-bass, reverberación, compresión, limitador y perfiles de mastering. Importante: estas capacidades aparecen implementadas en el motor, pero la interfaz principal observada solo expone la EQ de 10 bandas y sus presets básicos; comprobar/exponer controles de mastering sería una oportunidad antes de anunciarlas como funciones de producto accesibles.
- Interacción del disco y brazo: arrastre para buscar en la pista, brazo visual sincronizado, gesto de scratch, inercia y motor Baby Scratch con reproducción invertida; el motor contempla AudioWorklet y fallback.
- Ocho implementaciones de visualizador detectadas: bars, circular, coverAura, halo, mirror, particles, prism y tunnel. Hay además una fachada `visualizer.js`. La selección efectiva disponible en la interfaz debe confirmarse: la documentación enumera seis y no está completamente alineada con el código.

### Letras y karaoke
- Parser LRC con soporte de sincronización avanzada, offsets, variantes/letras y seguimiento de palabras; panel mini con línea anterior/actual/siguiente.
- Carga de letras locales `.lrc` y búsqueda/descarga automática desde LRCLIB; vista karaoke a pantalla completa, estilos visuales, scroll y sincronización; ajuste de offset.
- Varias funciones de interfaz/código para tratamiento de variantes y karaoke dinámico basado en carátula.

### Diseño y accesibilidad
- Tema claro/oscuro y diez skins: Latón, Neón, Esmeralda, Glaciar, Rubí, Titanio, Papel, Ulm, Gres y Telar.
- Diseño glassmorphism/aurora, SVGs propios, diseño adaptable y recursos de ayuda.
- Se observan etiquetas ARIA, roles de tabs/switch, live regions, skip-link y soporte de movimiento reducido en parte de la experiencia. Es razonable proponer una auditoría completa de accesibilidad, teclado y lectores de pantalla.
- Atajos de teclado para reproducción, búsqueda/seek, navegación, mute, shuffle, repeat, visualizador, karaoke, tema, ayuda y offset de letras.

## Arquitectura y estado técnico
- `index.html` alberga la estructura de la aplicación; estilos separados en `css/` y skins en `skins/`.
- `js/player.js` coordina biblioteca, reproducción, interfaz, letras y estado; módulos separados cubren Web Audio (`audioGraph.js`), scratch (`BabyScratchEngine.js`, `vinylInteraction.js`), parsing LRC, metadatos, almacenamiento, atajos y notificaciones.
- Visualizadores separados en `visualizers/`; marca/íconos en `svg/`.
- Hay cinco archivos de pruebas en `js/` (parser LRC, LRCLIB, utilidades, vinilo e interacción del vinilo), con unas 329 definiciones de pruebas detectadas por búsqueda estática. Esto no garantiza por sí solo que todas las pruebas pasen: no se ejecutaron en esta revisión.
- Arranque sin backend, mediante `index.html` o servidor estático local. El README indica dependencia de red inicial para fuentes de Google y jsmediatags; LRCLIB también requiere red para búsqueda de letras.

## Diferencias/precauciones encontradas
1. El README parece desactualizado frente al código: anuncia seis estilos de visualizador, mientras hay ocho módulos; declara nueve presets de EQ, mientras el motor conoce presets adicionales. La disponibilidad concreta en UI debe verificarse.
2. Hay funciones DSP internas más ambiciosas que la interfaz de usuario visible. Separar “ya implementado internamente” de “terminado y utilizable por el usuario” al proponer mejoras.
3. Es una experiencia centrada en archivos locales y navegador, no un servicio de streaming ni una plataforma social. Sin backend, catálogo licenciado o sincronización remota identificados.
4. No se hizo una prueba funcional visual completa, auditoría de seguridad, rendimiento, compatibilidad cruzada ni validación de reproducción real en esta revisión.

## Petición para la otra IA
Actúa como **product strategist, diseñador UX/UI senior y arquitecto de software especializado en reproductores de audio premium**. Usa el inventario anterior como línea base y propón mejoras que hagan AuraPlay Pro más completo, distintivo, fiable y “hi-end / ultra-pro”, pero evita sugerencias genéricas o repetir funciones que ya existen.

Entrega las ideas en estas categorías:
- Mejoras inmediatas de experiencia y pulido premium.
- Funciones de audio/DJ y mastering profesional, distinguiendo controles de UI pendientes de capacidades ya presentes en el motor.
- Biblioteca, metadatos, organización y gestión de colecciones locales.
- Letras, karaoke y visuales.
- Accesibilidad, privacidad, seguridad, estabilidad y compatibilidad.
- Arquitectura, rendimiento y estrategia de evolución del producto.

Para cada propuesta indica: valor para el usuario, prioridad (P0/P1/P2), complejidad aproximada (S/M/L), dependencias o riesgos, y cómo validar que está bien implementada. Prioriza primero una lista corta de las 10 mejoras de mayor impacto y luego agrega una visión de roadmap por fases. Distingue claramente qué es mejora incremental, qué requiere rediseño/arquitectura o backend, y qué podría tener costos/licencias/limitaciones de navegador. No asumas acceso a catálogos musicales, servicios de pago, sincronización cloud, IA integrada ni formatos/codecs universales. Recomienda cómo conciliar el README/documentación con las capacidades reales antes de añadir funciones nuevas.
