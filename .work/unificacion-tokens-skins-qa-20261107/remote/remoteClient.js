/*!
 * remoteClient.js — Mando remoto móvil de AuraPlay Pro
 * ---------------------------------------------------------------------------
 * Corre en la página móvil (remote/remote.html). NO accede a window.AURA:
 * habla con la PC únicamente por WebSocket (JSON).
 *
 * USO
 *   <script src="./remoteClient.js" defer></script>
 *
 * CONFIGURACIÓN DE LA URL WEBSOCKET (prioridad de mayor a menor)
 *   1. AuraRemote.connect({ url: "ws://192.168.1.20:8765" })   (API en runtime)
 *   2. Query string:  remote.html?ws=ws%3A%2F%2F192.168.1.20%3A8765
 *                     (parámetro "ws", valor codificado con encodeURIComponent)
 *   3. Objeto global definido ANTES de cargar este script:
 *        window.AURA_REMOTE_CONFIG = { url: "ws://192.168.1.20:8765" };
 *   4. Derivar del host de la página (opt-in, ver DERIVE_FROM_PAGE_HOST):
 *        ws(s)://<location.host><DERIVED_WS_PATH>
 *   5. CONFIG.DEFAULT_WS_URL (vacío a propósito: "localhost" en el móvil NO es la PC).
 *   Opcional: parámetro "session" (?session=abc123) o AURA_REMOTE_CONFIG.session;
 *   se envía dentro del mensaje "hello".
 *   Si no hay URL válida NO se intenta conectar: se muestra
 *   «Falta configurar conexión» y la ayuda correspondiente.
 *
 * PROTOCOLO (JSON, un objeto por mensaje de texto, versión 1)
 *
 * CLIENTE → SERVIDOR
 *   { "type": "hello", "client": "auraplay-remote", "version": 1, "session": "opcional" }
 *   { "type": "command", "action": "playPause" }
 *   { "type": "command", "action": "previous" }
 *   { "type": "command", "action": "next" }
 *   { "type": "command", "action": "seek", "position": 42.5 }        // segundos
 *   { "type": "command", "action": "setVolume", "volume": 70 }       // 0..100
 *   { "type": "command", "action": "toggleMute" }
 *   { "type": "command", "action": "setShuffle", "enabled": true }
 *   { "type": "command", "action": "setRepeat", "mode": "off"|"all"|"one" }
 *   { "type": "command", "action": "getState" }   // el servidor DEBE responder con "state" completo
 *   { "type": "ping", "t": 1700000000000 }        // heartbeat; el servidor puede responder {type:"pong"}
 *
 * SERVIDOR → CLIENTE
 *   Estado (completo o PARCIAL; los campos ausentes no se modifican):
 *   {
 *     "type": "state",
 *     "track": { "title": "Título", "artist": "Artista" },   // o null si no hay pista
 *     "playback": { "playing": true, "currentTime": 42.5, "duration": 210 },
 *     "volume": 70,          // 0..100
 *     "muted": false,
 *     "shuffle": true,
 *     "repeat": "all"        // "off" | "all" | "one"
 *   }
 *   Progreso ligero (alta frecuencia):
 *   { "type": "progress", "currentTime": 43.5, "duration": 210 }
 *   Heartbeat: { "type": "ping" } (el cliente responde pong) y { "type": "pong" }.
 *
 *   El servidor debería emitir un "state" completo tras recibir "hello" y "getState",
 *   y un "state" (o parcial) tras ejecutar cada comando.
 *   Cierres con código 1008, 4401 o 4403 se interpretan como "sesión rechazada"
 *   y NO se reintentan automáticamente.
 *
 * Este cliente solo aplica actualizaciones de estado validadas; jamás ejecuta
 * comandos ni contenido recibido del servidor. Todo texto remoto se inserta con
 * textContent.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Si el script se carga dos veces, limpia la instancia anterior.
  if (window.AuraRemote && typeof window.AuraRemote.destroy === "function") {
    try { window.AuraRemote.destroy(); } catch (_e) { /* ignorar */ }
  }

  /* ========================================================================
   * 1. CONFIGURACIÓN CENTRALIZADA (todo lo adaptable está aquí)
   * ====================================================================== */
  const CONFIG = {
    DEFAULT_WS_URL: "",               // Ej.: "ws://192.168.1.20:8765". Vacío = obligar a configurar.
    QUERY_PARAM_URL: "ws",            // ?ws=<url codificada>
    QUERY_PARAM_SESSION: "session",   // ?session=<id>
    GLOBAL_CONFIG_KEY: "AURA_REMOTE_CONFIG",
    DERIVE_FROM_PAGE_HOST: false,     // true: si la página la sirve la PC, usar su host.
    DERIVED_WS_PATH: "/ws",

    CLIENT_ID: "auraplay-remote",
    PROTOCOL_VERSION: 1,

    RECONNECT_BASE_MS: 1000,          // backoff exponencial: base * 2^intento
    RECONNECT_MAX_MS: 30000,          // tope
    CONNECT_TIMEOUT_MS: 10000,        // un intento colgado se descarta
    HEARTBEAT_INTERVAL_MS: 20000,     // 0 = sin ping periódico
    RESUME_PROBE_TIMEOUT_MS: 4000,    // al volver a primer plano: getState y espera respuesta (0 = sin sonda)

    VOLUME_THROTTLE_MS: 100,          // máximo 1 mensaje de volumen cada 100 ms durante el arrastre
    SEEK_SETTLE_MS: 700,              // tras soltar el seek, ignora el estado remoto este tiempo
    VOLUME_SETTLE_MS: 500,

    MAX_MESSAGE_CHARS: 65536,
    MAX_TEXT_LENGTH: 200,
    MAX_SESSION_LENGTH: 128,
    MAX_TIME_SECONDS: 360000,         // 100 h

    // false: con conexión, play/prev/next quedan activos aunque aún no haya pista
    // (el servidor puede tener cola). true: exigir pista para esos botones.
    TRANSPORT_REQUIRES_TRACK: false,

    NON_RETRIABLE_CLOSE_CODES: [1008, 4401, 4403],
    DEBUG: false
  };

  const PROTOCOL = Object.freeze({
    OUT: Object.freeze({ HELLO: "hello", COMMAND: "command", PING: "ping", PONG: "pong" }),
    IN: Object.freeze({ STATE: "state", PROGRESS: "progress", PING: "ping", PONG: "pong" }),
    ACTIONS: Object.freeze({
      PLAY_PAUSE: "playPause",
      PREVIOUS: "previous",
      NEXT: "next",
      SEEK: "seek",
      SET_VOLUME: "setVolume",
      TOGGLE_MUTE: "toggleMute",
      SET_SHUFFLE: "setShuffle",
      SET_REPEAT: "setRepeat",
      GET_STATE: "getState"
    }),
    REPEAT_MODES: Object.freeze(["off", "all", "one"])
  });
  const ACTION_SET = new Set(Object.keys(PROTOCOL.ACTIONS).map(function (k) { return PROTOCOL.ACTIONS[k]; }));

  /* Textos de interfaz (español) */
  const TEXT = {
    idleLabel: "Sin conectar",
    idleHelp: "Abre AuraPlay en tu dispositivo principal para comenzar.",
    connectingLabel: "Conectando…",
    connectingHelp: "Buscando AuraPlay en tu dispositivo principal…",
    reconnectingLabel: "Reconectando…",
    reconnectingHelp: function (n) { return "Intentando recuperar la conexión (intento " + n + ")…"; },
    connectedLabel: "Conectado",
    connectedHelp: "Mando conectado a AuraPlay en tu dispositivo principal.",
    disconnectedLabel: "Desconectado",
    errorLabel: "Error de conexión",
    retryHelp: function (secs, failed) {
      return failed
        ? "No se pudo conectar. Reintentando en " + secs + " s. Comprueba que AuraPlay esté abierto en la PC y que ambos equipos estén en la misma red."
        : "Se perdió la conexión. Reintentando en " + secs + " s…";
    },
    offlineLabel: "Sin red",
    offlineHelp: "Tu móvil no tiene conexión de red. Se reconectará automáticamente al volver.",
    manualHelp: "Conexión cerrada. Recarga la página o usa AuraRemote.connect() para volver a conectar.",
    unloadHelp: "Página en segundo plano; se reconectará al volver.",
    rejectedLabel: "Conexión rechazada",
    rejectedHelp: function (code) {
      return "El servidor rechazó la sesión (código " + code + "). Vuelve a abrir el enlace o QR del mando desde AuraPlay.";
    },
    missingLabel: "Falta configurar conexión",
    missingHelp: "Proporciona la URL WebSocket de la PC, por ejemplo: ?ws=ws%3A%2F%2F192.168.1.20%3A8765 (la dirección debe ser la IP de la PC, no localhost).",
    invalidLabel: "URL de conexión no válida",
    configHelp: function (reason) {
      switch (reason) {
        case "protocol": return "La URL debe empezar por ws:// o wss://.";
        case "mixed": return "Esta página usa HTTPS: el navegador bloquea ws://. Usa una URL wss:// o abre el mando por HTTP.";
        case "loopback": return "«localhost» en el móvil no es la PC. Usa la IP de la PC en la red local (ej. ws://192.168.1.20:8765).";
        case "ctor": return "El navegador rechazó la URL WebSocket. Revisa el formato, el puerto y el protocolo.";
        default: return "La URL WebSocket no tiene un formato válido.";
      }
    },
    idleTitle: "Elige una canción",
    idleArtist: "Tu música aparecerá aquí",
    unknownTitle: "Título desconocido",
    unknownArtist: "Artista desconocido",
    stateIdle: "En espera",
    stateSyncing: "Sincronizando…",
    stateNoTrack: "Sin pista",
    statePlaying: "Reproduciendo",
    statePaused: "Pausado"
  };

  const REPEAT_META = {
    off: { label: "Repetir: no", title: "Repetición: desactivada" },
    all: { label: "Repetir: todo", title: "Repetición: todas las pistas" },
    one: { label: "Repetir: una", title: "Repetición: una pista" }
  };

  const DOM_IDS = {
    connectionStatus: "connectionStatus",
    connectionLabel: "connectionLabel",
    connectionHelp: "connectionHelp",
    cover: "track-cover",
    lyric: "currentLyric",
    theme: "btnTheme",
    themeSun: "theme-sun",
    themeMoon: "theme-moon",
    title: "track-title",
    artist: "track-artist",
    playbackState: "playbackState",
    seek: "seek",
    elapsed: "elapsed",
    durationLabel: "duration",
    btnPrevious: "btnPrevious",
    btnPlayPause: "btnPlayPause",
    btnNext: "btnNext",
    btnShuffle: "btnShuffle",
    btnRepeat: "btnRepeat",
    repeatLabel: "repeatLabel",
    btnMute: "btnMute",
    volume: "volume",
    volumeValue: "volumeValue"
  };

  const UNSAFE_TEXT_RE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

  /* ========================================================================
   * 2. ESTADO INTERNO
   * ====================================================================== */
  let dom = null;

  /** Último estado conocido del reproductor (según el servidor + gestos locales). */
  const model = {
    synced: false,      // ¿ya llegó algún estado válido en esta conexión?
    hasTrack: false,
    title: "",
    artist: "",
    cover: "",
    lyric: "",
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 70,
    muted: false,
    shuffle: false,
    repeat: "off"
  };

  /** Estado de la conexión. */
  const conn = {
    status: "disconnected",   // connecting | connected | disconnected | error
    socket: null,
    handlers: null,
    generation: 0,            // invalida eventos de sockets antiguos
    opened: false,
    errored: false,
    attempt: 0,
    reconnectTimer: null,
    connectTimer: null,
    heartbeatTimer: null,
    probeTimer: null,
    lastMessageAt: 0,
    manualClose: false,       // el usuario/API cerró explícitamente
    unloading: false,         // la página se está descargando / pasó a bfcache
    fatal: false,             // config inválida o sesión rechazada: no reintentar sola
    destroyed: false,
    safeUrl: ""               // URL sin query (para getState sin filtrar tokens)
  };

  const runtimeOverride = { url: "", session: "" };
  const registeredListeners = [];
  let rafId = 0;
  let renderDirty = false;

  /* ========================================================================
   * 3. UTILIDADES
   * ====================================================================== */
  function logDebug() {
    if (!CONFIG.DEBUG || !window.console) return;
    console.debug.apply(console, ["[AuraRemote]"].concat(Array.prototype.slice.call(arguments)));
  }
  function logWarn() {
    if (window.console) console.warn.apply(console, ["[AuraRemote]"].concat(Array.prototype.slice.call(arguments)));
  }
  function logError() {
    if (window.console) console.error.apply(console, ["[AuraRemote]"].concat(Array.prototype.slice.call(arguments)));
  }

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  /** Envuelve un handler para que una excepción no deje el cliente inoperable. */
  function safely(label, fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (err) { logError("Error en " + label + ":", err); }
    };
  }

  /** addEventListener con registro para poder limpiar todo en destroy(). */
  function listen(target, type, handler, label) {
    const wrapped = safely(label || type, handler);
    target.addEventListener(type, wrapped);
    registeredListeners.push({ target: target, type: type, handler: wrapped });
  }
  function removeAllListeners() {
    while (registeredListeners.length) {
      const l = registeredListeners.pop();
      try { l.target.removeEventListener(l.type, l.handler); } catch (_e) { /* ignorar */ }
    }
  }

  /** Cadena segura: sin caracteres de control/bidi, espacios colapsados y longitud limitada. */
  function cleanText(value, maxLen) {
    if (typeof value !== "string") return null;
    let t = value.replace(UNSAFE_TEXT_RE, " ").replace(/\s+/g, " ").trim();
    if (t.length > maxLen) t = t.slice(0, maxLen - 1).trimEnd() + "…";
    return t;
  }

  /** Segundos finitos >= 0 y razonables, o undefined. */
  function readTime(v) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > CONFIG.MAX_TIME_SECONDS) return undefined;
    return v;
  }
  /** Porcentaje finito dentro de 0..100, o undefined (fuera de rango = ignorar). */
  function readPercent(v) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return undefined;
    return v;
  }

  /** Formato m:ss, o h:mm:ss si hay horas (o si forceHours). */
  function formatTime(seconds, forceHours) {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = s < 10 ? "0" + s : String(s);
    if (h > 0 || forceHours) return h + ":" + (m < 10 ? "0" + m : m) + ":" + ss;
    return m + ":" + ss;
  }

  function readSlider(el, min, max) {
    const n = Number(el.value);
    return Number.isFinite(n) ? clamp(n, min, max) : min;
  }

  /* Helpers de DOM con "diff": solo se toca el DOM si algo cambió. */
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function setAttr(el, name, value) { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }
  function setDisabled(el, disabled) { if (el.disabled !== disabled) el.disabled = disabled; }
  function setSliderValue(el, value) {
    const v = Math.round(value * 10) / 10;
    if (Number(el.value) !== v) el.value = String(v);
  }

  /* ========================================================================
   * 4. DOM
   * ====================================================================== */
  function collectDom() {
    const refs = {};
    const missing = [];
    Object.keys(DOM_IDS).forEach(function (key) {
      const el = document.getElementById(DOM_IDS[key]);
      if (el) refs[key] = el; else missing.push(DOM_IDS[key]);
    });
    if (missing.length) {
      logError("Faltan elementos requeridos en remote.html (ids): " + missing.join(", ") + ". El mando no se iniciará.");
      return null;
    }
    refs.playIcon = refs.btnPlayPause.querySelector(".play-icon");
    refs.pauseIcon = refs.btnPlayPause.querySelector(".pause-icon"); // opcional
    return refs;
  }

  /* ========================================================================
   * 5. GUARDAS DE GESTO (evitan que el estado remoto pise lo que el usuario arrastra)
   * ====================================================================== */
  function createGuard(settleMs) {
    let active = false;
    let until = 0;
    let settleTimer = 0;
    let endTimer = 0;

    function clearTimers() {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      if (endTimer) { clearTimeout(endTimer); endTimer = 0; }
    }
    function end() {
      active = false;
      until = Date.now() + settleMs;
      clearTimers();
      // Al terminar la ventana de gracia, aplica el estado remoto.
      settleTimer = setTimeout(function () { settleTimer = 0; scheduleRender(); }, settleMs + 20);
    }
    return {
      begin: function () { active = true; clearTimers(); },
      end: end,
      /** Fin diferido: si 'change' no llegó (toque sin cambio / cancelación), libera igualmente. */
      endLater: function (delay) {
        if (endTimer) clearTimeout(endTimer);
        endTimer = setTimeout(function () { endTimer = 0; if (active) end(); }, delay);
      },
      isActive: function () { return active; },
      isHeld: function () { return active || Date.now() < until; },
      reset: function () { active = false; until = 0; clearTimers(); }
    };
  }
  const seekGuard = createGuard(CONFIG.SEEK_SETTLE_MS);
  const volumeGuard = createGuard(CONFIG.VOLUME_SETTLE_MS);

  /* ========================================================================
   * 6. PARSEO Y VALIDACIÓN DE MENSAJES ENTRANTES
   * ====================================================================== */
  /** Devuelve un objeto con "type" string, o null si el mensaje no es utilizable. */
  function parseIncoming(data) {
    if (typeof data !== "string") return null;                       // ignora binarios
    if (data.length === 0 || data.length > CONFIG.MAX_MESSAGE_CHARS) return null;
    let msg;
    try { msg = JSON.parse(data); } catch (_e) { return null; }
    if (!isPlainObject(msg) || typeof msg.type !== "string") return null;
    return msg;
  }

  /** Valida {playing, currentTime, duration}. Devuelve objeto parcial o null. */
  function normalizePlayback(obj) {
    if (!isPlainObject(obj)) return null;
    const out = {};
    let any = false;
    if (typeof obj.playing === "boolean") { out.playing = obj.playing; any = true; }
    const ct = readTime(obj.currentTime);
    if (ct !== undefined) { out.currentTime = ct; any = true; }
    if (hasOwn(obj, "duration")) {
      if (obj.duration === null) { out.duration = 0; any = true; }   // duración desconocida
      else {
        const d = readTime(obj.duration);
        if (d !== undefined) { out.duration = d; any = true; }
      }
    }
    return any ? out : null;
  }

  /** Convierte un mensaje "state" en un parche validado, o null si no hay nada válido. */
  function buildStatePatch(msg) {
    const patch = {};
    let any = false;

    if (hasOwn(msg, "track")) {
      if (msg.track === null) { patch.track = null; any = true; }
      else if (isPlainObject(msg.track)) {
        const cover = typeof msg.track.cover === "string" && msg.track.cover.length <= 12000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(msg.track.cover) ? msg.track.cover : "";
        patch.track = {
          title: cleanText(msg.track.title, CONFIG.MAX_TEXT_LENGTH) || "",
          artist: cleanText(msg.track.artist, CONFIG.MAX_TEXT_LENGTH) || "",
          cover: cover,
          lyric: cleanText(msg.track.lyric, CONFIG.MAX_TEXT_LENGTH * 4) || ""
        };
        any = true;
      }
    }
    if (hasOwn(msg, "playback")) {
      const pb = normalizePlayback(msg.playback);
      if (pb) { patch.playback = pb; any = true; }
    }
    if (hasOwn(msg, "volume")) {
      const v = readPercent(msg.volume);
      if (v !== undefined) { patch.volume = Math.round(v); any = true; }
    }
    if (typeof msg.muted === "boolean") { patch.muted = msg.muted; any = true; }
    if (typeof msg.shuffle === "boolean") { patch.shuffle = msg.shuffle; any = true; }
    if (typeof msg.repeat === "string" && PROTOCOL.REPEAT_MODES.indexOf(msg.repeat) !== -1) {
      patch.repeat = msg.repeat; any = true;
    }
    return any ? patch : null;
  }

  /** Aplica un parche YA validado al modelo. */
  function applyPatch(patch) {
    if (hasOwn(patch, "track")) {
      if (patch.track === null) {
        model.hasTrack = false;
        model.title = "";
        model.artist = "";
        model.cover = "";
        model.lyric = "";
        model.playing = false;
        model.currentTime = 0;
        model.duration = 0;
      } else {
        model.hasTrack = true;
        model.title = patch.track.title;
        model.artist = patch.track.artist;
        model.cover = patch.track.cover;
        model.lyric = patch.track.lyric;
      }
    }
    if (patch.playback) {
      const pb = patch.playback;
      if (hasOwn(pb, "playing")) model.playing = pb.playing;
      if (hasOwn(pb, "currentTime")) model.currentTime = pb.currentTime;
      if (hasOwn(pb, "duration")) model.duration = pb.duration;
    }
    if (hasOwn(patch, "volume")) model.volume = patch.volume;
    if (hasOwn(patch, "muted")) model.muted = patch.muted;
    if (hasOwn(patch, "shuffle")) model.shuffle = patch.shuffle;
    if (hasOwn(patch, "repeat")) model.repeat = patch.repeat;
    model.synced = true;
  }

  function handleIncoming(data) {
    const msg = parseIncoming(data);
    if (!msg) { logDebug("Mensaje ignorado (malformado)"); return; }

    switch (msg.type) {
      case PROTOCOL.IN.STATE: {
        const patch = buildStatePatch(msg);
        if (patch) { applyPatch(patch); scheduleRender(); }
        break;
      }
      case PROTOCOL.IN.PROGRESS: {
        const pb = normalizePlayback(msg);
        if (pb) { applyPatch({ playback: pb }); scheduleRender(); }
        break;
      }
      case PROTOCOL.IN.PING:
        send({ type: PROTOCOL.OUT.PONG });
        break;
      case PROTOCOL.IN.PONG:
        break;
      default:
        logDebug("Tipo de mensaje desconocido ignorado:", msg.type);
    }
  }

  /* ========================================================================
   * 7. RENDER DE LA INTERFAZ (solo actualiza atributos/texto existentes)
   * ====================================================================== */
  function isConnected() {
    return conn.status === "connected" && !!conn.socket && conn.socket.readyState === WebSocket.OPEN;
  }

  /** Agrupa varios cambios en un único repintado por frame. */
  function scheduleRender() {
    if (conn.destroyed) return;
    if (document.hidden) { renderDirty = true; return; }   // se pinta al volver a primer plano
    if (rafId) return;
    rafId = window.requestAnimationFrame(function () { rafId = 0; render(); });
  }

  function renderVolumeLabel(v) {
    setText(dom.volumeValue, v + "%");
    setAttr(dom.volume, "aria-valuetext", v + "%" + (model.muted ? ", silenciado" : ""));
  }

  function render() {
    if (conn.destroyed || !dom) return;
    renderDirty = false;

    const connected = isConnected();
    const hasTrack = model.hasTrack;
    const duration = model.duration > 0 ? model.duration : 0;

    // --- Pista ---
    setText(dom.title, hasTrack ? (model.title || TEXT.unknownTitle) : TEXT.idleTitle);
    setText(dom.artist, hasTrack ? (model.artist || TEXT.unknownArtist) : TEXT.idleArtist);
    const coverUrl = hasTrack ? model.cover : "";
    if (dom.cover.getAttribute("src") !== coverUrl) {
      if (coverUrl) setAttr(dom.cover, "src", coverUrl);
      else dom.cover.removeAttribute("src");
    }
    dom.cover.hidden = !coverUrl;
    dom.cover.parentElement.classList.toggle("has-cover", !!coverUrl);
    setText(dom.lyric, hasTrack ? (model.lyric || "♪") : "");
    dom.lyric.parentElement.hidden = !hasTrack;

    // --- Estado de reproducción ---
    let stateText;
    if (!connected) stateText = TEXT.stateIdle;
    else if (!model.synced) stateText = TEXT.stateSyncing;
    else if (!hasTrack) stateText = TEXT.stateNoTrack;
    else stateText = model.playing ? TEXT.statePlaying : TEXT.statePaused;
    setText(dom.playbackState, stateText);

    // --- Transporte ---
    const transportOn = connected && (!CONFIG.TRANSPORT_REQUIRES_TRACK || hasTrack);
    setDisabled(dom.btnPrevious, !transportOn);
    setDisabled(dom.btnPlayPause, !transportOn);
    setDisabled(dom.btnNext, !transportOn);
    setAttr(dom.btnPrevious, "aria-label", "Pista anterior");
    setAttr(dom.btnPrevious, "title", "Pista anterior");
    setAttr(dom.btnNext, "aria-label", "Pista siguiente");
    setAttr(dom.btnNext, "title", "Pista siguiente");

    const playing = hasTrack && model.playing;
    const ppLabel = playing ? "Pausar" : "Reproducir";
    setAttr(dom.btnPlayPause, "aria-label", ppLabel);
    setAttr(dom.btnPlayPause, "title", ppLabel);
    setAttr(dom.btnPlayPause, "data-playing", playing ? "true" : "false");
    dom.btnPlayPause.classList.toggle("is-playing", playing);
    if (dom.pauseIcon && dom.playIcon) {
      // Solo se alterna visibilidad si la maqueta ya trae un icono de pausa (.pause-icon).
      const playDisplay = playing ? "none" : "";
      const pauseDisplay = playing ? "" : "none";
      if (dom.playIcon.style.display !== playDisplay) dom.playIcon.style.display = playDisplay;
      if (dom.pauseIcon.style.display !== pauseDisplay) dom.pauseIcon.style.display = pauseDisplay;
    }

    // --- Progreso ---
    const seekable = connected && hasTrack && duration > 0;
    setDisabled(dom.seek, !seekable);
    const cur = duration > 0 ? Math.min(model.currentTime, duration) : model.currentTime;
    const hours = Math.max(duration, cur) >= 3600;
    if (!seekGuard.isHeld()) {
      const elapsedText = formatTime(cur, hours);
      const durationText = formatTime(duration, hours);
      setText(dom.elapsed, elapsedText);
      setText(dom.durationLabel, durationText);
      setSliderValue(dom.seek, duration > 0 ? clamp((cur / duration) * 100, 0, 100) : 0);
      setAttr(dom.seek, "aria-valuetext", elapsedText + " de " + durationText);
    } else {
      setText(dom.durationLabel, formatTime(duration, duration >= 3600));
    }

    // --- Aleatorio ---
    const shuffleText = "Aleatorio: " + (model.shuffle ? "activado" : "desactivado");
    setDisabled(dom.btnShuffle, !connected);
    setAttr(dom.btnShuffle, "aria-pressed", model.shuffle ? "true" : "false");
    setAttr(dom.btnShuffle, "aria-label", shuffleText);
    setAttr(dom.btnShuffle, "title", shuffleText);

    // --- Repetición ---
    const meta = REPEAT_META[model.repeat] || REPEAT_META.off;
    setDisabled(dom.btnRepeat, !connected);
    setAttr(dom.btnRepeat, "data-mode", model.repeat);
    setAttr(dom.btnRepeat, "aria-pressed", model.repeat === "off" ? "false" : "true");
    setAttr(dom.btnRepeat, "aria-label", meta.title);
    setAttr(dom.btnRepeat, "title", meta.title);
    setText(dom.repeatLabel, meta.label);

    // --- Silencio ---
    const muteText = model.muted ? "Reactivar sonido" : "Silenciar";
    setDisabled(dom.btnMute, !connected);
    setAttr(dom.btnMute, "aria-pressed", model.muted ? "true" : "false");
    setAttr(dom.btnMute, "aria-label", muteText);
    setAttr(dom.btnMute, "title", muteText);

    // --- Volumen ---
    setDisabled(dom.volume, !connected);
    if (!volumeGuard.isHeld()) {
      if (Number(dom.volume.value) !== model.volume) dom.volume.value = String(model.volume);
      renderVolumeLabel(model.volume);
    }
  }

  /** Cambia el estado visual de conexión y repinta los controles. */
  function setConnection(state, label, help) {
    conn.status = state;
    if (!dom) return;
    setAttr(dom.connectionStatus, "data-state", state);
    setText(dom.connectionLabel, label);
    setText(dom.connectionHelp, help);
    render();
  }

  /* ========================================================================
   * 8. ENVÍO DE MENSAJES
   * ====================================================================== */
  function send(message) {
    const s = conn.socket;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    try {
      s.send(JSON.stringify(message));
      return true;
    } catch (err) {
      logWarn("No se pudo enviar el mensaje:", err);
      return false;
    }
  }

  /** Envía un comando de la lista blanca. Devuelve true si se envió. */
  function sendCommand(action, payload) {
    if (!ACTION_SET.has(action) || !isConnected()) return false;
    const msg = Object.assign({ type: PROTOCOL.OUT.COMMAND, action: action }, payload || {});
    return send(msg);
  }

  function sendHello() {
    const msg = { type: PROTOCOL.OUT.HELLO, client: CONFIG.CLIENT_ID, version: CONFIG.PROTOCOL_VERSION };
    const session = resolveSession();
    if (session) msg.session = session;
    send(msg);
  }

  /* ========================================================================
   * 9. CONFIGURACIÓN DE URL
   * ====================================================================== */
  function readQuery(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (_e) { return null; }
  }
  function readGlobalConfig() {
    const c = window[CONFIG.GLOBAL_CONFIG_KEY];
    return isPlainObject(c) ? c : {};
  }
  function isLoopbackHost(h) {
    return h === "localhost" || /\.localhost$/.test(h) || h === "[::1]" || h === "::1" || /^127\./.test(h);
  }

  function resolveSession() {
    const g = readGlobalConfig();
    const raw = runtimeOverride.session || readQuery(CONFIG.QUERY_PARAM_SESSION) || (typeof g.session === "string" ? g.session : "");
    return cleanText(raw, CONFIG.MAX_SESSION_LENGTH) || "";
  }

  /** Devuelve { ok:true, url, safeUrl } o { ok:false, reason }. */
  function resolveConfig() {
    const g = readGlobalConfig();
    let raw = "";

    if (runtimeOverride.url) raw = runtimeOverride.url;
    if (!raw) { const q = readQuery(CONFIG.QUERY_PARAM_URL); if (q) raw = q.trim(); }
    if (!raw && typeof g.url === "string") raw = g.url.trim();
    if (!raw) {
      const derive = typeof g.deriveFromPageHost === "boolean" ? g.deriveFromPageHost : CONFIG.DERIVE_FROM_PAGE_HOST;
      if (derive && /^https?:$/.test(window.location.protocol) && window.location.host) {
        const path = typeof g.wsPath === "string" && g.wsPath.charAt(0) === "/" ? g.wsPath : CONFIG.DERIVED_WS_PATH;
        raw = (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + path;
      }
    }
    if (!raw) raw = CONFIG.DEFAULT_WS_URL;
    if (!raw) return { ok: false, reason: "missing" };

    let u;
    try { u = new URL(raw); } catch (_e) { return { ok: false, reason: "invalid" }; }
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return { ok: false, reason: "protocol" };

    const pageHost = window.location.hostname;
    const loopback = isLoopbackHost(u.hostname);
    if (loopback && !isLoopbackHost(pageHost)) return { ok: false, reason: "loopback" };
    if (window.location.protocol === "https:" && u.protocol === "ws:" && !loopback) return { ok: false, reason: "mixed" };

    return { ok: true, url: u.href, safeUrl: u.protocol + "//" + u.host + u.pathname };
  }

  /* ========================================================================
   * 10. CONEXIÓN Y RECUPERACIÓN
   * ====================================================================== */
  function shouldReconnect() {
    return !conn.destroyed && !conn.manualClose && !conn.unloading && !conn.fatal;
  }

  function clearReconnectTimer() { if (conn.reconnectTimer) { clearTimeout(conn.reconnectTimer); conn.reconnectTimer = null; } }
  function clearConnectTimer() { if (conn.connectTimer) { clearTimeout(conn.connectTimer); conn.connectTimer = null; } }
  function clearProbe() { if (conn.probeTimer) { clearTimeout(conn.probeTimer); conn.probeTimer = null; } }
  function stopHeartbeat() { if (conn.heartbeatTimer) { clearInterval(conn.heartbeatTimer); conn.heartbeatTimer = null; } }

  function startHeartbeat() {
    stopHeartbeat();
    if (CONFIG.HEARTBEAT_INTERVAL_MS <= 0) return;
    conn.heartbeatTimer = setInterval(safely("heartbeat", function () {
      if (isConnected()) send({ type: PROTOCOL.OUT.PING, t: Date.now() });
    }), CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  /** Backoff exponencial con tope y jitter ("equal jitter": 50%–100% del valor). */
  function computeBackoffDelay(attempt) {
    const cap = Math.min(CONFIG.RECONNECT_MAX_MS, CONFIG.RECONNECT_BASE_MS * Math.pow(2, attempt));
    return Math.max(500, Math.round(cap * (0.5 + Math.random() * 0.5)));
  }

  /** Quita listeners del socket actual, lo desreferencia e invalida su generación. */
  function releaseSocket() {
    const s = conn.socket;
    const h = conn.handlers;
    conn.socket = null;
    conn.handlers = null;
    conn.generation += 1;
    if (s && h) {
      try {
        s.removeEventListener("open", h.open);
        s.removeEventListener("message", h.message);
        s.removeEventListener("error", h.error);
        s.removeEventListener("close", h.close);
      } catch (_e) { /* ignorar */ }
    }
    return s;
  }

  /** Cierra el socket actual SIN que sus eventos tardíos afecten al estado. */
  function closeSocket(code, reason) {
    clearConnectTimer();
    clearProbe();
    stopHeartbeat();
    const s = releaseSocket();
    conn.opened = false;
    if (s) {
      try {
        if (s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN) s.close(code || 1000, reason || "");
      } catch (_e) { /* ignorar */ }
    }
  }

  function scheduleReconnect(state) {
    if (conn.reconnectTimer || !shouldReconnect()) return;
    const delay = computeBackoffDelay(conn.attempt);
    conn.attempt += 1;
    const secs = Math.max(1, Math.round(delay / 1000));
    const failed = state === "error";
    setConnection(
      state,
      failed ? TEXT.errorLabel : TEXT.disconnectedLabel,
      TEXT.retryHelp(secs, failed)
    );
    conn.reconnectTimer = setTimeout(safely("reconnect", function () {
      conn.reconnectTimer = null;
      if (shouldReconnect()) openSocket();
    }), delay);
  }

  /** Descarta el socket actual (muerto/colgado) y programa recuperación. */
  function dropSocketAndRecover(reason, state) {
    closeSocket(1000, reason);
    if (shouldReconnect()) scheduleReconnect(state || "disconnected");
    else setConnection("disconnected", TEXT.disconnectedLabel, TEXT.manualHelp);
  }

  function onSocketOpen(gen) {
    if (gen !== conn.generation) return;
    clearConnectTimer();
    conn.opened = true;
    conn.errored = false;
    conn.attempt = 0;
    conn.lastMessageAt = Date.now();
    model.synced = false;
    setConnection("connected", TEXT.connectedLabel, TEXT.connectedHelp);
    sendHello();
    startHeartbeat();
  }

  function onSocketMessage(gen, ev) {
    if (gen !== conn.generation) return;
    conn.lastMessageAt = Date.now();
    handleIncoming(ev.data);
  }

  function onSocketError(gen) {
    if (gen !== conn.generation) return;
    conn.errored = true;   // el detalle no está disponible; el "close" posterior decide el estado
    logDebug("Evento error en WebSocket");
  }

  function onSocketClose(gen, ev) {
    if (gen !== conn.generation) return;           // cierre tardío de un socket antiguo
    const code = ev && typeof ev.code === "number" ? ev.code : 0;
    const failedToOpen = !conn.opened || conn.errored;
    clearConnectTimer();
    clearProbe();
    stopHeartbeat();
    releaseSocket();
    conn.opened = false;

    if (CONFIG.NON_RETRIABLE_CLOSE_CODES.indexOf(code) !== -1) {
      conn.fatal = true;
      setConnection("error", TEXT.rejectedLabel, TEXT.rejectedHelp(code));
      return;
    }
    if (!shouldReconnect()) {
      setConnection("disconnected", TEXT.disconnectedLabel, conn.unloading ? TEXT.unloadHelp : TEXT.manualHelp);
      return;
    }
    scheduleReconnect(failedToOpen ? "error" : "disconnected");
  }

  function onConnectTimeout(gen) {
    if (gen !== conn.generation || conn.opened) return;
    logWarn("Tiempo de espera agotado al conectar.");
    conn.errored = true;
    dropSocketAndRecover("connect-timeout", "error");
  }

  /** Abre un WebSocket (idempotente: no crea otro si ya hay uno activo o en curso). */
  function openSocket() {
    if (conn.destroyed) return false;

    const existing = conn.socket;
    if (existing) {
      if (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN) return true;
      closeSocket(1000, "reset");
    }
    clearReconnectTimer();

    const cfg = resolveConfig();
    if (!cfg.ok) {
      if (cfg.reason === "missing") setConnection("error", TEXT.missingLabel, TEXT.missingHelp);
      else setConnection("error", TEXT.invalidLabel, TEXT.configHelp(cfg.reason));
      return false;                                // no se reintenta una configuración imposible
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setConnection("disconnected", TEXT.offlineLabel, TEXT.offlineHelp);
      return false;                                // el evento "online" retomará
    }

    if (conn.attempt > 0) setConnection("connecting", TEXT.reconnectingLabel, TEXT.reconnectingHelp(conn.attempt));
    else setConnection("connecting", TEXT.connectingLabel, TEXT.connectingHelp);

    let socket;
    try {
      socket = new WebSocket(cfg.url);
    } catch (err) {
      logError("No se pudo crear el WebSocket:", err);
      conn.fatal = true;                           // SyntaxError/SecurityError: reintentar no sirve
      setConnection("error", TEXT.invalidLabel, TEXT.configHelp("ctor"));
      return false;
    }

    const gen = ++conn.generation;
    conn.socket = socket;
    conn.opened = false;
    conn.errored = false;
    conn.safeUrl = cfg.safeUrl;
    conn.handlers = {
      open: safely("socket.open", function () { onSocketOpen(gen); }),
      message: safely("socket.message", function (ev) { onSocketMessage(gen, ev); }),
      error: safely("socket.error", function () { onSocketError(gen); }),
      close: safely("socket.close", function (ev) { onSocketClose(gen, ev); })
    };
    socket.addEventListener("open", conn.handlers.open);
    socket.addEventListener("message", conn.handlers.message);
    socket.addEventListener("error", conn.handlers.error);
    socket.addEventListener("close", conn.handlers.close);

    clearConnectTimer();
    conn.connectTimer = setTimeout(safely("connectTimeout", function () { onConnectTimeout(gen); }), CONFIG.CONNECT_TIMEOUT_MS);
    return true;
  }

  /** Sonda al volver a primer plano: pide estado y, si no hay respuesta, reconecta. */
  function probeConnection() {
    clearProbe();
    if (!isConnected()) return;
    const sentAt = Date.now();
    if (!sendCommand(PROTOCOL.ACTIONS.GET_STATE)) { dropSocketAndRecover("probe-send-failed"); return; }
    if (CONFIG.RESUME_PROBE_TIMEOUT_MS > 0) {
      const gen = conn.generation;
      conn.probeTimer = setTimeout(safely("probe", function () {
        conn.probeTimer = null;
        if (gen === conn.generation && isConnected() && conn.lastMessageAt < sentAt) {
          logWarn("Sin respuesta tras volver a primer plano; reconectando.");
          dropSocketAndRecover("probe-timeout");
        }
      }), CONFIG.RESUME_PROBE_TIMEOUT_MS);
    }
  }

  /* --- Eventos de ventana/documento --- */
  function onOnline() {
    if (!shouldReconnect() || conn.socket) return;
    conn.attempt = 0;
    clearReconnectTimer();
    openSocket();
  }

  function onOffline() {
    if (conn.destroyed || conn.manualClose) return;
    clearReconnectTimer();
    closeSocket(1000, "offline");
    setConnection("disconnected", TEXT.offlineLabel, TEXT.offlineHelp);
  }

  function onVisibilityChange() {
    if (conn.destroyed || document.hidden) return;
    render();
    if (conn.unloading) return;
    if (isConnected()) probeConnection();
    else if (!conn.socket && shouldReconnect()) {
      conn.attempt = 0;
      clearReconnectTimer();
      openSocket();
    }
  }

  function onPageHide() {
    conn.unloading = true;
    clearReconnectTimer();
    flushVolume();
    closeSocket(1000, "pagehide");
    setConnection("disconnected", TEXT.disconnectedLabel, TEXT.unloadHelp);
  }

  function onPageShow(ev) {
    if (ev && ev.persisted) {                      // restauración desde bfcache
      conn.unloading = false;
      if (shouldReconnect()) { conn.attempt = 0; openSocket(); }
    }
  }

  /* ========================================================================
   * 11. INTERACCIÓN: BOTONES Y SLIDERS
   * ====================================================================== */
  function onPlayPause() { sendCommand(PROTOCOL.ACTIONS.PLAY_PAUSE); }
  function onPrevious() { sendCommand(PROTOCOL.ACTIONS.PREVIOUS); }
  function onNext() { sendCommand(PROTOCOL.ACTIONS.NEXT); }

  // Shuffle / repeat / mute: actualización optimista (evita perder toques rápidos);
  // el siguiente "state" del servidor es la fuente de verdad y corrige cualquier desvío.
  function onShuffle() {
    const next = !model.shuffle;
    if (sendCommand(PROTOCOL.ACTIONS.SET_SHUFFLE, { enabled: next })) { model.shuffle = next; scheduleRender(); }
  }
  function onRepeat() {
    const modes = PROTOCOL.REPEAT_MODES;
    const idx = modes.indexOf(model.repeat);
    const next = modes[(idx + 1) % modes.length];
    if (sendCommand(PROTOCOL.ACTIONS.SET_REPEAT, { mode: next })) { model.repeat = next; scheduleRender(); }
  }
  function onMute() {
    if (sendCommand(PROTOCOL.ACTIONS.TOGGLE_MUTE)) { model.muted = !model.muted; scheduleRender(); }
  }

  function applyTheme(theme, persist) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    if (dom) {
      const next = value === "dark" ? "claro" : "oscuro";
      dom.themeSun.hidden = value !== "dark";
      dom.themeMoon.hidden = value === "dark";
      setAttr(dom.theme, "aria-label", "Cambiar a tema " + next);
      setAttr(dom.theme, "title", "Cambiar a tema " + next);
    }
    if (persist) { try { localStorage.setItem("auraplay.remote.theme", value); } catch (_e) { /* almacenamiento no disponible */ } }
  }
  function onTheme() { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true); }

  /* --- Seek: vista previa local durante el arrastre; un solo comando al confirmar --- */
  function canSeek() {
    return isConnected() && model.hasTrack && model.duration > 0 && !dom.seek.disabled;
  }

  function onSeekPointerDown() { if (!dom.seek.disabled) seekGuard.begin(); }
  function onSeekPointerEnd() { seekGuard.endLater(80); }

  function onSeekInput() {
    if (!canSeek()) return;
    seekGuard.begin();
    const dur = model.duration;
    const secs = (dur * readSlider(dom.seek, 0, 100)) / 100;
    const hours = dur >= 3600;
    const elapsedText = formatTime(secs, hours);
    setText(dom.elapsed, elapsedText);
    setAttr(dom.seek, "aria-valuetext", elapsedText + " de " + formatTime(dur, hours));
  }

  function onSeekChange() {
    if (!canSeek()) { seekGuard.end(); scheduleRender(); return; }
    const dur = model.duration;
    const seconds = clamp((dur * readSlider(dom.seek, 0, 100)) / 100, 0, dur);
    if (sendCommand(PROTOCOL.ACTIONS.SEEK, { position: Math.round(seconds * 1000) / 1000 })) {
      model.currentTime = seconds;                 // optimista
    }
    seekGuard.end();
    scheduleRender();
  }

  /* --- Volumen: etiqueta inmediata + envío con throttle + valor final al soltar --- */
  const volumeSend = { lastSentAt: 0, timer: null, pending: null };

  function flushVolume() {
    if (volumeSend.timer) { clearTimeout(volumeSend.timer); volumeSend.timer = null; }
    if (volumeSend.pending === null) return;
    const v = volumeSend.pending;
    volumeSend.pending = null;
    if (sendCommand(PROTOCOL.ACTIONS.SET_VOLUME, { volume: v })) volumeSend.lastSentAt = Date.now();
  }

  function queueVolume(v) {
    volumeSend.pending = v;
    const wait = CONFIG.VOLUME_THROTTLE_MS - (Date.now() - volumeSend.lastSentAt);
    if (wait <= 0) flushVolume();
    else if (!volumeSend.timer) volumeSend.timer = setTimeout(safely("volumeThrottle", flushVolume), wait);
  }

  function onVolumePointerDown() { if (!dom.volume.disabled) volumeGuard.begin(); }
  function onVolumePointerEnd() { volumeGuard.endLater(80); }

  function onVolumeInput() {
    if (!isConnected() || dom.volume.disabled) return;
    volumeGuard.begin();
    const v = Math.round(readSlider(dom.volume, 0, 100));
    model.volume = v;
    renderVolumeLabel(v);
    queueVolume(v);
  }

  function onVolumeChange() {
    if (!isConnected() || dom.volume.disabled) { volumeGuard.end(); return; }
    const v = Math.round(readSlider(dom.volume, 0, 100));
    model.volume = v;
    renderVolumeLabel(v);
    volumeSend.pending = v;
    flushVolume();                                 // el valor final SIEMPRE se envía
    volumeGuard.end();
  }

  /* ========================================================================
   * 12. API PÚBLICA, LIMPIEZA E INICIALIZACIÓN
   * ====================================================================== */
  function connect(options) {
    if (conn.destroyed) return false;
    if (isPlainObject(options)) {
      if (typeof options.url === "string" && options.url.trim() && options.url.trim() !== runtimeOverride.url) {
        runtimeOverride.url = options.url.trim();
        closeSocket(1000, "reconfigure");
      }
      if (typeof options.session === "string") runtimeOverride.session = options.session;
    }
    conn.manualClose = false;
    conn.fatal = false;
    conn.attempt = 0;
    clearReconnectTimer();
    return openSocket();
  }

  function disconnect() {
    if (conn.destroyed) return;
    conn.manualClose = true;
    clearReconnectTimer();
    flushVolume();
    closeSocket(1000, "client disconnect");
    setConnection("disconnected", TEXT.disconnectedLabel, TEXT.manualHelp);
  }

  function destroy() {
    if (conn.destroyed) return;
    conn.manualClose = true;
    clearReconnectTimer();
    if (volumeSend.timer) { clearTimeout(volumeSend.timer); volumeSend.timer = null; }
    volumeSend.pending = null;
    closeSocket(1000, "destroy");
    setConnection("disconnected", TEXT.disconnectedLabel, TEXT.manualHelp);  // deja los controles deshabilitados
    conn.destroyed = true;
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    seekGuard.reset();
    volumeGuard.reset();
    removeAllListeners();
    if (window.AuraRemote === api) {
      try { delete window.AuraRemote; } catch (_e) { window.AuraRemote = undefined; }
    }
  }

  function getState() {
    const s = conn.socket;
    return {
      connection: conn.status,
      readyState: s ? s.readyState : WebSocket.CLOSED,
      reconnectAttempt: conn.attempt,
      manualClose: conn.manualClose,
      destroyed: conn.destroyed,
      url: conn.safeUrl,                           // sin query string (puede contener tokens)
      model: Object.assign({}, model)
    };
  }

  const api = Object.freeze({
    connect: connect,
    disconnect: disconnect,
    destroy: destroy,
    getState: getState,
    protocol: PROTOCOL,
    version: CONFIG.PROTOCOL_VERSION
  });

  function init() {
    if (conn.destroyed || dom) return;
    if (typeof WebSocket === "undefined") { logError("Este navegador no soporta WebSocket."); return; }

    dom = collectDom();
    if (!dom) return;

    // Botones: solo "click" (cubre toque, ratón y teclado sin doble disparo).
    listen(dom.btnPlayPause, "click", onPlayPause, "btnPlayPause");
    listen(dom.btnPrevious, "click", onPrevious, "btnPrevious");
    listen(dom.btnNext, "click", onNext, "btnNext");
    listen(dom.btnShuffle, "click", onShuffle, "btnShuffle");
    listen(dom.btnRepeat, "click", onRepeat, "btnRepeat");
    listen(dom.btnMute, "click", onMute, "btnMute");
    listen(dom.theme, "click", onTheme, "btnTheme");
    let savedTheme = "dark";
    try { savedTheme = localStorage.getItem("auraplay.remote.theme") || "dark"; } catch (_e) { /* usar tema oscuro */ }
    applyTheme(savedTheme, false);

    // Seek
    listen(dom.seek, "pointerdown", onSeekPointerDown, "seek.pointerdown");
    listen(dom.seek, "pointerup", onSeekPointerEnd, "seek.pointerup");
    listen(dom.seek, "pointercancel", onSeekPointerEnd, "seek.pointercancel");
    listen(dom.seek, "input", onSeekInput, "seek.input");
    listen(dom.seek, "change", onSeekChange, "seek.change");

    // Volumen
    listen(dom.volume, "pointerdown", onVolumePointerDown, "volume.pointerdown");
    listen(dom.volume, "pointerup", onVolumePointerEnd, "volume.pointerup");
    listen(dom.volume, "pointercancel", onVolumePointerEnd, "volume.pointercancel");
    listen(dom.volume, "input", onVolumeInput, "volume.input");
    listen(dom.volume, "change", onVolumeChange, "volume.change");

    // Red / ciclo de vida de la página
    listen(window, "online", onOnline, "online");
    listen(window, "offline", onOffline, "offline");
    listen(document, "visibilitychange", onVisibilityChange, "visibilitychange");
    listen(window, "pagehide", onPageHide, "pagehide");
    listen(window, "pageshow", onPageShow, "pageshow");

    // Estado inicial: desconectado, controles deshabilitados.
    setConnection("disconnected", TEXT.idleLabel, TEXT.idleHelp);

    window.AuraRemote = api;
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safely("init", init), { once: true });
  } else {
    safely("init", init)();
  }
})();
