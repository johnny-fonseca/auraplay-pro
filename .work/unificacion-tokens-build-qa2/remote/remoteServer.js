/*!
 * remoteServer.js — Lado PC del mando remoto de AuraPlay Pro
 * ---------------------------------------------------------------------------
 * Corre en la página del reproductor (la que tiene window.AURA).
 *
 * LIMITACIÓN DEL NAVEGADOR
 *   Una página web NO puede abrir un servidor WebSocket ni escuchar un puerto.
 *   Este módulo se conecta como CLIENTE (rol "host") a un RELAY WebSocket de la
 *   red local; el móvil (remoteClient.js) se conecta al mismo relay con la misma
 *   sesión. El relay solo enruta mensajes por sesión; el reproductor se controla
 *   aquí, validando cada comando.
 *
 *     [Móvil: remoteClient.js] <--ws--> [RELAY] <--ws--> [PC: remoteServer.js] --> window.AURA
 *
 * USO (en la página del reproductor; qrcode.min.js ANTES o DESPUÉS, da igual)
 *   <script src="./qrcode.min.js"></script>
 *   <script>
 *     window.AURA_REMOTE_HOST_CONFIG = {
 *       RELAY_URL: "ws://localhost:8765",        // obligatorio (lo que usa la PC)
 *       // PUBLIC_BASE_URL: "http://192.168.1.20:3000/",  // opcional, ver abajo
 *       // adapter: { ... }                       // opcional, ver "ADAPTADOR"
 *     };
 *   </script>
 *   <script src="./remoteServer.js" defer></script>
 *
 * CONFIGURACIÓN (window.AURA_REMOTE_HOST_CONFIG; mismas claves que DEFAULTS)
 *   RELAY_URL         URL ws(s):// del relay, accesible desde la PC. Obligatoria.
 *   MOBILE_RELAY_URL  URL del relay vista desde el móvil. Si se omite se usa RELAY_URL
 *                     y, si su host es localhost, se sustituye por la IP LAN de la PC.
 *   PUBLIC_BASE_URL   URL base de la web de la PC vista desde el móvil. Si se omite
 *                     y la página corre en localhost, el panel pide la IP LAN de la PC
 *                     (se guarda en localStorage de la PC).
 *   REMOTE_PAGE_PATH  Ruta de la página móvil (por defecto "remote/remote.html").
 *
 * PROTOCOLO (JSON, versión 1) — extiende el de remoteClient.js
 *   PC → RELAY (solo para el relay; el relay NO debe reenviarlos):
 *     { "type":"hello", "client":"auraplay-host", "role":"host", "version":1, "session":"<hex>" }
 *     { "type":"keepalive", "t":1700000000000 }
 *   RELAY → PC (opcional):
 *     { "type":"presence", "clients":<n> }          // móviles conectados a la sesión
 *   MÓVIL → PC (el relay los reenvía tal cual a la PC):
 *     hello | command{action,...} | ping | pong       (ver remoteClient.js)
 *   PC → MÓVIL (el relay los difunde a todos los móviles de la sesión):
 *     { "type":"state", "track":{title,artist}|null, "playback":{playing,currentTime,duration},
 *       "volume":0..100, "muted":bool, "shuffle":bool, "repeat":"off"|"all"|"one" }  // completo o parcial
 *     { "type":"progress", "currentTime":43.5, "duration":210 }
 *     { "type":"pong" }
 *   Reglas del relay: registrar un único host por sesión; reenviar al host los
 *   mensajes de los móviles; difundir a los móviles los del host salvo
 *   hello/keepalive. Cierre 1008/4401/4403 = sesión rechazada (no se reintenta).
 *
 * ADAPTADOR (ÚNICO punto a adaptar a window.AURA)
 *   No se conoce la API de window.AURA, así que el adaptador por defecto prueba
 *   nombres habituales y, si no, usa el <audio> del reproductor. Puedes sobrescribir
 *   cualquier método con AURA_REMOTE_HOST_CONFIG.adapter:
 *     adapter: {
 *       getSnapshot() → { track:{title,artist}|null, playing, currentTime(s), duration(s),
 *                         volume(0..100), muted, shuffle, repeat:"off"|"all"|"one" },
 *       playPause(), previous(), next(), seek(segundos), setVolume(0..100),
 *       toggleMute(), setShuffle(bool), setRepeat("off"|"all"|"one"),
 *       subscribe(notify) → función de baja   // opcional; notify() fuerza un refresco
 *     }
 *   Cada método puede devolver true/false o una Promise. false = no soportado.
 *
 * QR
 *   Usa la librería local qrcode.min.js, detectando su API: node-qrcode
 *   (QRCode.toCanvas), qrcodejs (new QRCode(el, opts)) o qrcode-generator
 *   (window.qrcode). Sin innerHTML: todo con DOM/textContent/canvas.
 *   Si existe un elemento #remoteQrContainer, el panel se monta allí; si no, se crea
 *   un panel flotante. Botón de apertura: #btnRemote si existe; si no, un botón
 *   flotante (AUTO_BUTTON).
 *
 * SEGURIDAD
 *   - La sesión (128 bits aleatorios) es el secreto compartido: quien tenga el QR
 *     controla el reproductor. Usa "Generar nuevo código" para rotarla.
 *   - Cada comando se valida contra una lista blanca, con tipos y rangos, y hay
 *     límite de comandos por segundo. Nada recibido se ejecuta como código.
 *   - En redes no confiables usa wss:// (y un relay con TLS).
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  if (window.AuraRemoteHost && typeof window.AuraRemoteHost.destroy === "function") {
    try { window.AuraRemoteHost.destroy(); } catch (_e) { /* ignorar */ }
  }

  /* ========================================================================
   * 1. CONFIGURACIÓN CENTRALIZADA
   * ====================================================================== */
  const USER = (function () {
    const c = window.AURA_REMOTE_HOST_CONFIG;
    return c !== null && typeof c === "object" && !Array.isArray(c) ? c : {};
  })();

  const DEFAULTS = {
    RELAY_URL: "",                    // Ej.: "ws://localhost:8765". Vacío = falta configurar.
    MOBILE_RELAY_URL: "",
    PUBLIC_BASE_URL: "",
    REMOTE_PAGE_PATH: "remote/remote.html",
    QUERY_PARAM_URL: "ws",            // debe coincidir con remoteClient.js
    QUERY_PARAM_SESSION: "session",   // debe coincidir con remoteClient.js

    CLIENT_ID: "auraplay-host",
    PROTOCOL_VERSION: 1,
    SESSION_BYTES: 16,                // 128 bits
    STORAGE_SESSION_KEY: "auraplay.remote.session",
    STORAGE_HOST_KEY: "auraplay.remote.lanHost",

    RECONNECT_BASE_MS: 1000,
    RECONNECT_MAX_MS: 30000,
    CONNECT_TIMEOUT_MS: 10000,
    KEEPALIVE_MS: 25000,              // 0 = sin keepalive
    NON_RETRIABLE_CLOSE_CODES: [1008, 4401, 4403],

    POLL_INTERVAL_MS: 400,            // sondeo del estado de AURA (con diff)
    PROGRESS_INTERVAL_MS: 1000,       // 1 mensaje "progress" por segundo mientras suena
    BROADCAST_DELAY_MS: 80,           // espera tras un comando antes de emitir el estado
    MAX_COMMANDS_PER_SECOND: 40,
    MAX_MESSAGE_CHARS: 4096,
    MAX_TEXT_LENGTH: 200,
    MAX_TIME_SECONDS: 360000,

    AURA_GLOBAL: "AURA",
    AURA_VOLUME_MAX: 1,               // escala de volumen de AURA: 1 (0..1) o 100 (0..100)

    AUTO_CONNECT: true,               // conectar al relay al cargar
    AUTO_BUTTON: true,                // crear botón flotante si no existe #btnRemote
    OPEN_BUTTON_ID: "btnRemote",
    QR_CONTAINER_ID: "remoteQrContainer",
    STATUS_ID: "remoteStatus",
    QR_SIZE: 220,
    DEBUG: false
  };

  const CFG = (function () {
    const out = Object.assign({}, DEFAULTS);
    Object.keys(DEFAULTS).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(USER, k) && typeof USER[k] === typeof DEFAULTS[k]) out[k] = USER[k];
    });
    return out;
  })();

  const PROTOCOL = Object.freeze({
    TO_RELAY: Object.freeze({ HELLO: "hello", KEEPALIVE: "keepalive" }),
    FROM_RELAY: Object.freeze({ PRESENCE: "presence" }),
    FROM_MOBILE: Object.freeze({ HELLO: "hello", COMMAND: "command", PING: "ping", PONG: "pong" }),
    TO_MOBILE: Object.freeze({ STATE: "state", PROGRESS: "progress", PONG: "pong" }),
    ACTIONS: Object.freeze({
      PLAY_PAUSE: "playPause", PREVIOUS: "previous", NEXT: "next", SEEK: "seek",
      SET_VOLUME: "setVolume", TOGGLE_MUTE: "toggleMute", SET_SHUFFLE: "setShuffle",
      SET_REPEAT: "setRepeat", GET_STATE: "getState"
    }),
    REPEAT_MODES: Object.freeze(["off", "all", "one"])
  });

  /** Valor que se envía a AURA.setRepeat(...) por cada modo (ajústalo si AURA usa otros). */
  const REPEAT_TO_AURA = { off: "off", all: "all", one: "one" };

  const UNSAFE_TEXT_RE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

  const TEXT = {
    idle: "Mando remoto detenido.",
    connecting: "Conectando con el relay…",
    reconnecting: function (n) { return "Reconectando con el relay (intento " + n + ")…"; },
    waiting: "Esperando al móvil… Escanea el código QR.",
    paired: "Móvil conectado.",
    pairedNoPresence: "Móvil vinculado.",
    retry: function (s) { return "Sin conexión con el relay. Reintentando en " + s + " s…"; },
    offline: "La PC no tiene red. Se reconectará al volver.",
    rejected: function (c) { return "El relay rechazó la sesión (código " + c + "). Genera un nuevo código."; },
    relayMissing: "Falta configurar el relay: define RELAY_URL en window.AURA_REMOTE_HOST_CONFIG.",
    relayInvalid: "RELAY_URL no es válida (debe ser ws:// o wss://).",
    relayMixed: "Esta página usa HTTPS: el relay debe ser wss://.",
    ctor: "El navegador rechazó la URL del relay.",
    noCrypto: "Este navegador no puede generar una clave de sesión segura.",
    unload: "Página en segundo plano."
  };

  /* ========================================================================
   * 2. UTILIDADES
   * ====================================================================== */
  function logDebug() {
    if (CFG.DEBUG && window.console) console.debug.apply(console, ["[AuraRemoteHost]"].concat([].slice.call(arguments)));
  }
  function logWarn() {
    if (window.console) console.warn.apply(console, ["[AuraRemoteHost]"].concat([].slice.call(arguments)));
  }
  function logError() {
    if (window.console) console.error.apply(console, ["[AuraRemoteHost]"].concat([].slice.call(arguments)));
  }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function isThenable(v) { return v !== null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function"; }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function safely(label, fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (err) { logError("Error en " + label + ":", err); }
    };
  }

  const registeredListeners = [];
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

  function cleanText(value, maxLen) {
    if (typeof value !== "string") return null;
    let t = value.replace(UNSAFE_TEXT_RE, " ").replace(/\s+/g, " ").trim();
    if (t.length > maxLen) t = t.slice(0, maxLen - 1).trimEnd() + "…";
    return t;
  }
  function readTime(v) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > CFG.MAX_TIME_SECONDS) return undefined;
    return v;
  }
  function readPercent(v) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return undefined;
    return v;
  }
  function isLoopbackHost(h) {
    return h === "localhost" || /\.localhost$/.test(h) || h === "[::1]" || h === "::1" || /^127\./.test(h);
  }
  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (_e) { return null; } }
  function storageSet(key, v) { try { window.localStorage.setItem(key, v); } catch (_e) { /* ignorar */ } }
  function sessionGet(key) { try { return window.sessionStorage.getItem(key); } catch (_e) { return null; } }
  function sessionSet(key, v) { try { window.sessionStorage.setItem(key, v); } catch (_e) { /* ignorar */ } }

  function el(tag, text, style) {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (style) Object.assign(n.style, style);
    return n;
  }
  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ========================================================================
   * 3. ADAPTADOR HACIA window.AURA (ver cabecera)
   * ====================================================================== */
  function normalizeRepeat(v) {
    if (typeof v === "boolean") return v ? "all" : "off";
    if (typeof v !== "string") return undefined;
    switch (v.toLowerCase()) {
      case "off": case "none": case "no": case "false": case "disabled": return "off";
      case "all": case "playlist": case "context": case "queue": case "list": return "all";
      case "one": case "track": case "single": case "song": case "1": return "one";
      default: return undefined;
    }
  }

  /** Lee la primera propiedad existente (llamándola si es una función sin parámetros). */
  function read(obj, names) {
    if (!obj) return undefined;
    for (let i = 0; i < names.length; i++) {
      let v;
      try { v = obj[names[i]]; } catch (_e) { continue; }
      if (typeof v === "function") {
        if (v.length !== 0) continue;
        try { v = v.call(obj); } catch (_e) { continue; }
      }
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }
  /** Invoca el primer método existente. Devuelve { found, value }. */
  function call(obj, names, args) {
    if (obj) {
      for (let i = 0; i < names.length; i++) {
        const f = obj[names[i]];
        if (typeof f === "function") return { found: true, value: f.apply(obj, args || []) };
      }
    }
    return { found: false, value: undefined };
  }
  function done(r) { return r.found ? (isThenable(r.value) ? r.value : true) : false; }

  function createDefaultAdapter() {
    function aura() { return window[CFG.AURA_GLOBAL]; }
    function media() {
      const a = aura();
      if (a) {
        const cands = [a.audio, a.audioEl, a.audioElement, a.media, a.player, a.el];
        for (let i = 0; i < cands.length; i++) {
          if (typeof HTMLMediaElement !== "undefined" && cands[i] instanceof HTMLMediaElement) return cands[i];
        }
      }
      return document.querySelector("audio");
    }
    function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : undefined; }

    function readTrack(a) {
      let t = read(a, ["currentTrack", "track", "nowPlaying", "getCurrentTrack"]);
      if (!isPlainObject(t) && a && isPlainObject(a.state)) t = read(a.state, ["currentTrack", "track"]);
      if (!isPlainObject(t)) return null;
      let artist = t.artist !== undefined ? t.artist : (t.artists !== undefined ? t.artists : t.author);
      if (Array.isArray(artist)) artist = artist.join(", ");
      const title = t.title !== undefined ? t.title : (t.name !== undefined ? t.name : t.songName);
      return { title: title, artist: artist };
    }

    return {
      getSnapshot: function () {
        const a = aura();
        const m = media();
        const playingRaw = read(a, ["isPlaying", "playing"]);
        const volRaw = num(read(a, ["volume", "getVolume"]));
        const mutedRaw = read(a, ["muted", "isMuted"]);
        const shuffleRaw = read(a, ["shuffle", "isShuffle", "shuffleEnabled", "isShuffled"]);
        const ct = num(read(a, ["currentTime", "getCurrentTime", "position"]));
        const du = num(read(a, ["duration", "getDuration"]));
        return {
          track: readTrack(a),
          playing: typeof playingRaw === "boolean" ? playingRaw : (m ? !m.paused && !m.ended : false),
          currentTime: ct !== undefined ? ct : (m ? m.currentTime : 0),
          duration: du !== undefined ? du : (m ? m.duration : 0),
          volume: volRaw !== undefined ? (volRaw / CFG.AURA_VOLUME_MAX) * 100 : (m ? m.volume * 100 : undefined),
          muted: typeof mutedRaw === "boolean" ? mutedRaw : (m ? m.muted : false),
          shuffle: typeof shuffleRaw === "boolean" ? shuffleRaw : false,
          repeat: normalizeRepeat(read(a, ["repeat", "repeatMode", "loop"]))
        };
      },

      playPause: function () {
        const a = aura();
        const m = media();
        let r = call(a, ["togglePlay", "togglePlayPause", "playPause", "toggle"]);
        if (r.found) return done(r);
        const playing = read(a, ["isPlaying", "playing"]);
        if (typeof playing === "boolean") {
          r = call(a, playing ? ["pause"] : ["play"]);
          if (r.found) return done(r);
        }
        if (m) { return m.paused ? m.play() : (m.pause(), true); }
        return false;
      },
      previous: function () { return done(call(aura(), ["previous", "prev", "playPrevious", "previousTrack", "prevTrack"])); },
      next: function () { return done(call(aura(), ["next", "playNext", "nextTrack"])); },
      seek: function (seconds) {
        const r = call(aura(), ["seek", "seekTo", "setCurrentTime", "setPosition"], [seconds]);
        if (r.found) return done(r);
        const m = media();
        if (m) { m.currentTime = seconds; return true; }
        return false;
      },
      setVolume: function (v100) {
        const r = call(aura(), ["setVolume"], [(v100 * CFG.AURA_VOLUME_MAX) / 100]);
        if (r.found) return done(r);
        const m = media();
        if (m) { m.volume = clamp(v100 / 100, 0, 1); return true; }
        return false;
      },
      toggleMute: function () {
        const a = aura();
        let r = call(a, ["toggleMute"]);
        if (r.found) return done(r);
        const cur = read(a, ["muted", "isMuted"]);
        if (typeof cur === "boolean") {
          r = call(a, ["setMuted"], [!cur]);
          if (r.found) return done(r);
        }
        const m = media();
        if (m) { m.muted = !m.muted; return true; }
        return false;
      },
      setShuffle: function (enabled) {
        const a = aura();
        let r = call(a, ["setShuffle"], [enabled]);
        if (r.found) return done(r);
        const cur = read(a, ["shuffle", "isShuffle", "shuffleEnabled", "isShuffled"]);
        if (typeof cur === "boolean") {
          if (cur === enabled) return true;
          r = call(a, ["toggleShuffle"]);
          if (r.found) return done(r);
        }
        return false;
      },
      setRepeat: function (mode) {
        const a = aura();
        let r = call(a, ["setRepeat", "setRepeatMode"], [REPEAT_TO_AURA[mode]]);
        if (r.found) return done(r);
        for (let i = 0; i < PROTOCOL.REPEAT_MODES.length; i++) {   // ciclar hasta coincidir
          if (normalizeRepeat(read(a, ["repeat", "repeatMode", "loop"])) === mode) return true;
          r = call(a, ["cycleRepeat", "toggleRepeat"]);
          if (!r.found) return false;
        }
        return true;
      },

      /** Suscripción opcional a eventos del <audio> para refrescar sin esperar al sondeo. */
      subscribe: function (notify) {
        const m = media();
        if (!m) return function () {};
        const evts = ["play", "pause", "ended", "seeked", "volumechange", "loadedmetadata", "durationchange"];
        evts.forEach(function (e) { m.addEventListener(e, notify); });
        return function () { evts.forEach(function (e) { m.removeEventListener(e, notify); }); };
      },
      /** Identidad del origen de eventos (para re-suscribir si el <audio> cambia). */
      sourceId: function () { return media(); }
    };
  }

  function buildAdapter() {
    const adapter = createDefaultAdapter();
    const custom = isPlainObject(USER.adapter) ? USER.adapter : {};
    Object.keys(custom).forEach(function (k) {
      if (typeof custom[k] === "function") adapter[k] = custom[k].bind(custom);
    });
    return adapter;
  }

  /* ========================================================================
   * 4. SNAPSHOT NORMALIZADO Y DIFUSIÓN DE ESTADO
   * ====================================================================== */
  let adapter = null;
  let session = "";
  let lastSent = null;                         // último snapshot enviado
  let lastProgress = { time: 0, at: 0, playing: false };
  let snapshotWarned = false;
  let broadcastTimer = 0;

  function normalizeSnapshot(raw) {
    if (!isPlainObject(raw) || isThenable(raw)) return null;
    let track = null;
    if (isPlainObject(raw.track)) {
      track = {
        title: cleanText(typeof raw.track.title === "string" ? raw.track.title : "", CFG.MAX_TEXT_LENGTH) || "",
        artist: cleanText(typeof raw.track.artist === "string" ? raw.track.artist : "", CFG.MAX_TEXT_LENGTH) || "",
        cover: typeof raw.track.cover === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.track.cover) && raw.track.cover.length <= 12000 ? raw.track.cover : "",
        lyric: cleanText(typeof raw.track.lyric === "string" ? raw.track.lyric : "", CFG.MAX_TEXT_LENGTH) || ""
      };
    }
    const vol = readPercent(raw.volume);
    const rep = typeof raw.repeat === "string" && PROTOCOL.REPEAT_MODES.indexOf(raw.repeat) !== -1 ? raw.repeat : "off";
    return {
      track: track,
      playing: track !== null && raw.playing === true,
      currentTime: readTime(raw.currentTime) || 0,
      duration: readTime(raw.duration) || 0,
      volume: vol === undefined ? 70 : Math.round(vol),
      muted: raw.muted === true,
      shuffle: raw.shuffle === true,
      repeat: rep
    };
  }

  function takeSnapshot() {
    if (!adapter) return null;
    let raw;
    try { raw = adapter.getSnapshot(); }
    catch (err) {
      if (!snapshotWarned) { snapshotWarned = true; logWarn("No se pudo leer el estado del reproductor:", err); }
      return null;
    }
    const snap = normalizeSnapshot(raw);
    if (!snap && !snapshotWarned) { snapshotWarned = true; logWarn("getSnapshot() no devolvió un objeto válido."); }
    return snap;
  }

  function sameTrack(a, b) {
    if (a === null || b === null) return a === b;
    return a.title === b.title && a.artist === b.artist && a.cover === b.cover && a.lyric === b.lyric;
  }

  function buildFullState(s) {
    return {
      type: PROTOCOL.TO_MOBILE.STATE,
      track: s.track,
      playback: { playing: s.playing, currentTime: s.currentTime, duration: s.duration },
      volume: s.volume, muted: s.muted, shuffle: s.shuffle, repeat: s.repeat
    };
  }

  function markProgress(s, now) { lastProgress = { time: s.currentTime, at: now, playing: s.playing }; }

  /** Publica el estado. force=true envía el estado completo; si no, solo cambios. */
  function publish(force) {
    if (!isRelayOpen()) return;
    if (!force && link.presenceKnown && link.peers === 0) return;   // nadie escucha
    const s = takeSnapshot();
    if (!s) return;
    const now = Date.now();

    if (force || !lastSent) {
      if (send(buildFullState(s))) { lastSent = s; markProgress(s, now); }
      return;
    }

    const msg = { type: PROTOCOL.TO_MOBILE.STATE };
    let any = false;
    let playbackChanged = false;
    if (!sameTrack(s.track, lastSent.track)) { msg.track = s.track; any = true; playbackChanged = true; }
    if (s.playing !== lastSent.playing || Math.abs(s.duration - lastSent.duration) > 0.01) playbackChanged = true;
    if (playbackChanged) {
      msg.playback = { playing: s.playing, currentTime: s.currentTime, duration: s.duration };
      any = true;
    }
    if (s.volume !== lastSent.volume) { msg.volume = s.volume; any = true; }
    if (s.muted !== lastSent.muted) { msg.muted = s.muted; any = true; }
    if (s.shuffle !== lastSent.shuffle) { msg.shuffle = s.shuffle; any = true; }
    if (s.repeat !== lastSent.repeat) { msg.repeat = s.repeat; any = true; }

    if (any) {
      if (send(msg)) { lastSent = s; markProgress(s, now); }
      return;
    }

    // Solo cambió el tiempo: "progress" ligero (1/s mientras suena, o al saltar/buscar).
    const expected = lastProgress.playing ? lastProgress.time + (now - lastProgress.at) / 1000 : lastProgress.time;
    const drift = Math.abs(s.currentTime - expected);
    const due = now - lastProgress.at >= CFG.PROGRESS_INTERVAL_MS;
    if (drift > 1.2 || (s.playing && due) || (!s.playing && drift > 0.25)) {
      if (send({ type: PROTOCOL.TO_MOBILE.PROGRESS, currentTime: s.currentTime, duration: s.duration })) {
        lastSent = s;
        markProgress(s, now);
      }
    }
  }

  /** Emite el estado completo poco después de un evento/comando (agrupa ráfagas). */
  function scheduleBroadcast() {
    if (broadcastTimer || link.destroyed) return;
    broadcastTimer = setTimeout(safely("broadcast", function () {
      broadcastTimer = 0;
      publish(true);
    }), CFG.BROADCAST_DELAY_MS);
  }

  /* --- Sondeo y suscripción a eventos del reproductor --- */
  let pollTimer = null;
  let unsubscribe = null;
  let subscribedSource = null;

  function ensureSubscription() {
    if (!adapter || typeof adapter.subscribe !== "function") return;
    const src = typeof adapter.sourceId === "function" ? adapter.sourceId() : "static";
    if (src === subscribedSource && unsubscribe) return;
    if (unsubscribe) { try { unsubscribe(); } catch (_e) { /* ignorar */ } unsubscribe = null; }
    subscribedSource = src;
    try { unsubscribe = adapter.subscribe(function () { scheduleBroadcast(); }) || null; }
    catch (err) { logWarn("subscribe() falló:", err); }
  }
  function startPolling() {
    stopPolling();
    ensureSubscription();
    pollTimer = setInterval(safely("poll", function () {
      ensureSubscription();
      publish(false);
    }), CFG.POLL_INTERVAL_MS);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function teardownSubscription() {
    if (unsubscribe) { try { unsubscribe(); } catch (_e) { /* ignorar */ } }
    unsubscribe = null;
    subscribedSource = null;
  }

  /* ========================================================================
   * 5. COMANDOS ENTRANTES (validación estricta; lista blanca)
   * ====================================================================== */
  let rateWindowStart = 0;
  let rateCount = 0;
  function allowCommand() {
    const now = Date.now();
    if (now - rateWindowStart >= 1000) { rateWindowStart = now; rateCount = 0; }
    rateCount += 1;
    return rateCount <= CFG.MAX_COMMANDS_PER_SECOND;
  }

  function runCommand(action, fn) {
    let result;
    try { result = fn(); }
    catch (err) { logWarn("Error al ejecutar '" + action + "':", err); scheduleBroadcast(); return; }
    Promise.resolve(result).then(
      function (r) { if (r === false) logWarn("El reproductor no soporta la acción '" + action + "' (revisa el adaptador)."); },
      function (err) { logWarn("Error asíncrono en '" + action + "':", err); }
    ).then(scheduleBroadcast);
  }

  function handleCommand(msg) {
    const A = PROTOCOL.ACTIONS;
    switch (msg.action) {
      case A.PLAY_PAUSE: runCommand(msg.action, function () { return adapter.playPause(); }); break;
      case A.PREVIOUS: runCommand(msg.action, function () { return adapter.previous(); }); break;
      case A.NEXT: runCommand(msg.action, function () { return adapter.next(); }); break;
      case A.SEEK: {
        let pos = readTime(msg.position);
        if (pos === undefined) return;
        const s = takeSnapshot();
        if (!s || !s.track) return;
        if (s.duration > 0) pos = Math.min(pos, s.duration);
        runCommand(msg.action, function () { return adapter.seek(pos); });
        break;
      }
      case A.SET_VOLUME: {
        const v = readPercent(msg.volume);
        if (v === undefined) return;
        const vol = Math.round(v);
        runCommand(msg.action, function () { return adapter.setVolume(vol); });
        break;
      }
      case A.TOGGLE_MUTE: runCommand(msg.action, function () { return adapter.toggleMute(); }); break;
      case A.SET_SHUFFLE:
        if (typeof msg.enabled !== "boolean") return;
        runCommand(msg.action, function () { return adapter.setShuffle(msg.enabled); });
        break;
      case A.SET_REPEAT:
        if (typeof msg.mode !== "string" || PROTOCOL.REPEAT_MODES.indexOf(msg.mode) === -1) return;
        runCommand(msg.action, function () { return adapter.setRepeat(msg.mode); });
        break;
      case A.GET_STATE: publish(true); break;
      default: logDebug("Acción desconocida ignorada:", msg.action);
    }
  }

  function handleIncoming(data) {
    if (typeof data !== "string" || data.length === 0 || data.length > CFG.MAX_MESSAGE_CHARS) return;
    let msg;
    try { msg = JSON.parse(data); } catch (_e) { return; }
    if (!isPlainObject(msg) || typeof msg.type !== "string") return;

    // Defensa en profundidad: si el mensaje trae sesión y no es la nuestra, se ignora.
    if (typeof msg.session === "string" && msg.session !== session) return;

    switch (msg.type) {
      case PROTOCOL.FROM_MOBILE.HELLO:
        link.peers = Math.max(link.peers, 1);
        updatePairedStatus();
        publish(true);                          // el móvil recién llegado necesita el estado completo
        break;
      case PROTOCOL.FROM_MOBILE.COMMAND:
        if (!allowCommand()) { logWarn("Límite de comandos excedido; se ignora."); return; }
        if (typeof msg.action === "string") handleCommand(msg);
        break;
      case PROTOCOL.FROM_MOBILE.PING:
        send({ type: PROTOCOL.TO_MOBILE.PONG });
        break;
      case PROTOCOL.FROM_MOBILE.PONG:
        break;
      case PROTOCOL.FROM_RELAY.PRESENCE: {
        const n = msg.clients;
        if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1000) {
          const joined = n > link.peers;
          link.presenceKnown = true;
          link.peers = n;
          updatePairedStatus();
          if (joined) publish(true);
        }
        break;
      }
      default:
        logDebug("Mensaje desconocido ignorado:", msg.type);
    }
  }

  /* ========================================================================
   * 6. CONEXIÓN CON EL RELAY
   * ====================================================================== */
  const link = {
    status: "idle", statusText: TEXT.idle,
    socket: null, handlers: null, generation: 0,
    opened: false, errored: false, attempt: 0,
    reconnectTimer: null, connectTimer: null, keepaliveTimer: null,
    manualClose: true, unloading: false, fatal: false, destroyed: false,
    peers: 0, presenceKnown: false
  };

  function isRelayOpen() {
    return !!link.socket && link.socket.readyState === WebSocket.OPEN && link.opened;
  }
  function shouldReconnect() {
    return !link.destroyed && !link.manualClose && !link.unloading && !link.fatal;
  }

  function setStatus(status, text) {
    link.status = status;
    link.statusText = text;
    renderStatus();
  }
  function updatePairedStatus() {
    if (!isRelayOpen()) return;
    if (link.peers > 0) setStatus("paired", link.presenceKnown ? TEXT.paired : TEXT.pairedNoPresence);
    else setStatus("waiting", TEXT.waiting);
  }

  function send(message) {
    const s = link.socket;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    try { s.send(JSON.stringify(message)); return true; }
    catch (err) { logWarn("No se pudo enviar:", err); return false; }
  }

  function resolveRelay() {
    const raw = CFG.RELAY_URL.trim();
    if (!raw) return { ok: false, reason: "missing" };
    let u;
    try { u = new URL(raw); } catch (_e) { return { ok: false, reason: "invalid" }; }
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return { ok: false, reason: "invalid" };
    if (window.location.protocol === "https:" && u.protocol === "ws:" && !isLoopbackHost(u.hostname)) {
      return { ok: false, reason: "mixed" };
    }
    return { ok: true, url: u };
  }

  function clearReconnectTimer() { if (link.reconnectTimer) { clearTimeout(link.reconnectTimer); link.reconnectTimer = null; } }
  function clearConnectTimer() { if (link.connectTimer) { clearTimeout(link.connectTimer); link.connectTimer = null; } }
  function stopKeepalive() { if (link.keepaliveTimer) { clearInterval(link.keepaliveTimer); link.keepaliveTimer = null; } }
  function startKeepalive() {
    stopKeepalive();
    if (CFG.KEEPALIVE_MS <= 0) return;
    link.keepaliveTimer = setInterval(safely("keepalive", function () {
      if (isRelayOpen()) send({ type: PROTOCOL.TO_RELAY.KEEPALIVE, t: Date.now() });
    }), CFG.KEEPALIVE_MS);
  }

  function computeBackoffDelay(attempt) {
    const cap = Math.min(CFG.RECONNECT_MAX_MS, CFG.RECONNECT_BASE_MS * Math.pow(2, attempt));
    return Math.max(500, Math.round(cap * (0.5 + Math.random() * 0.5)));
  }

  function releaseSocket() {
    const s = link.socket;
    const h = link.handlers;
    link.socket = null;
    link.handlers = null;
    link.generation += 1;                      // invalida eventos tardíos del socket anterior
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

  function closeSocket(code, reason) {
    clearConnectTimer();
    stopKeepalive();
    stopPolling();
    const s = releaseSocket();
    link.opened = false;
    link.peers = 0;
    link.presenceKnown = false;
    lastSent = null;
    if (s) {
      try {
        if (s.readyState === WebSocket.CONNECTING || s.readyState === WebSocket.OPEN) s.close(code || 1000, reason || "");
      } catch (_e) { /* ignorar */ }
    }
  }

  function scheduleReconnect() {
    if (link.reconnectTimer || !shouldReconnect()) return;
    const delay = computeBackoffDelay(link.attempt);
    link.attempt += 1;
    setStatus("error", TEXT.retry(Math.max(1, Math.round(delay / 1000))));
    link.reconnectTimer = setTimeout(safely("reconnect", function () {
      link.reconnectTimer = null;
      if (shouldReconnect()) openRelay();
    }), delay);
  }

  function onRelayOpen(gen) {
    if (gen !== link.generation) return;
    clearConnectTimer();
    link.opened = true;
    link.errored = false;
    link.attempt = 0;
    send({
      type: PROTOCOL.TO_RELAY.HELLO, client: CFG.CLIENT_ID, role: "host",
      version: CFG.PROTOCOL_VERSION, session: session
    });
    startKeepalive();
    startPolling();
    updatePairedStatus();
    publish(true);
  }
  function onRelayMessage(gen, ev) {
    if (gen !== link.generation) return;
    handleIncoming(ev.data);
  }
  function onRelayError(gen) {
    if (gen !== link.generation) return;
    link.errored = true;
  }
  function onRelayClose(gen, ev) {
    if (gen !== link.generation) return;
    const code = ev && typeof ev.code === "number" ? ev.code : 0;
    clearConnectTimer();
    stopKeepalive();
    stopPolling();
    releaseSocket();
    link.opened = false;
    link.peers = 0;
    link.presenceKnown = false;
    lastSent = null;

    if (CFG.NON_RETRIABLE_CLOSE_CODES.indexOf(code) !== -1) {
      link.fatal = true;
      setStatus("error", TEXT.rejected(code));
      return;
    }
    if (!shouldReconnect()) {
      setStatus("disconnected", link.unloading ? TEXT.unload : TEXT.idle);
      return;
    }
    scheduleReconnect();
  }
  function onConnectTimeout(gen) {
    if (gen !== link.generation || link.opened) return;
    logWarn("Tiempo de espera agotado al conectar con el relay.");
    closeSocket(1000, "connect-timeout");
    scheduleReconnect();
  }

  /** Abre el WebSocket hacia el relay (idempotente). */
  function openRelay() {
    if (link.destroyed || !session) return false;
    const existing = link.socket;
    if (existing) {
      if (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN) return true;
      closeSocket(1000, "reset");
    }
    clearReconnectTimer();

    const cfg = resolveRelay();
    if (!cfg.ok) {
      link.fatal = true;                       // configuración imposible: no reintentar
      setStatus("error", cfg.reason === "missing" ? TEXT.relayMissing : cfg.reason === "mixed" ? TEXT.relayMixed : TEXT.relayInvalid);
      return false;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus("disconnected", TEXT.offline);
      return false;                            // el evento "online" retomará
    }

    setStatus("connecting", link.attempt > 0 ? TEXT.reconnecting(link.attempt) : TEXT.connecting);

    let socket;
    try { socket = new WebSocket(cfg.url.href); }
    catch (err) {
      logError("No se pudo crear el WebSocket:", err);
      link.fatal = true;
      setStatus("error", TEXT.ctor);
      return false;
    }

    const gen = ++link.generation;
    link.socket = socket;
    link.opened = false;
    link.errored = false;
    link.handlers = {
      open: safely("relay.open", function () { onRelayOpen(gen); }),
      message: safely("relay.message", function (ev) { onRelayMessage(gen, ev); }),
      error: safely("relay.error", function () { onRelayError(gen); }),
      close: safely("relay.close", function (ev) { onRelayClose(gen, ev); })
    };
    socket.addEventListener("open", link.handlers.open);
    socket.addEventListener("message", link.handlers.message);
    socket.addEventListener("error", link.handlers.error);
    socket.addEventListener("close", link.handlers.close);

    clearConnectTimer();
    link.connectTimer = setTimeout(safely("connectTimeout", function () { onConnectTimeout(gen); }), CFG.CONNECT_TIMEOUT_MS);
    return true;
  }

  /* --- Ciclo de vida --- */
  function onOnline() {
    if (!shouldReconnect() || link.socket) return;
    link.attempt = 0;
    clearReconnectTimer();
    openRelay();
  }
  function onOffline() {
    if (link.destroyed || link.manualClose) return;
    clearReconnectTimer();
    closeSocket(1000, "offline");
    setStatus("disconnected", TEXT.offline);
  }
  function onVisibilityChange() {
    if (link.destroyed || document.hidden) return;
    if (!link.socket && shouldReconnect()) { link.attempt = 0; clearReconnectTimer(); openRelay(); }
    else publish(true);
  }
  function onPageHide() {
    link.unloading = true;
    clearReconnectTimer();
    closeSocket(1000, "pagehide");
    setStatus("disconnected", TEXT.unload);
  }
  function onPageShow(ev) {
    if (ev && ev.persisted) {                  // bfcache
      link.unloading = false;
      if (shouldReconnect()) { link.attempt = 0; openRelay(); }
    }
  }

  /* ========================================================================
   * 7. SESIÓN Y ENLACE DE EMPAREJAMIENTO
   * ====================================================================== */
  function generateSession() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") return null;
    const bytes = new Uint8Array(CFG.SESSION_BYTES);
    window.crypto.getRandomValues(bytes);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return hex;
  }
  function loadOrCreateSession() {
    const stored = sessionGet(CFG.STORAGE_SESSION_KEY);
    if (stored && /^[0-9a-f]{16,128}$/.test(stored)) return stored;
    const fresh = generateSession();
    if (fresh) sessionSet(CFG.STORAGE_SESSION_KEY, fresh);
    return fresh;
  }

  function readStoredHost() {
    const v = storageGet(CFG.STORAGE_HOST_KEY);
    return typeof v === "string" && /^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(v) ? v : "";
  }

  /** Dirección base de la web de la PC tal como la ve el móvil. */
  function resolveBase() {
    if (CFG.PUBLIC_BASE_URL) {
      try { return { ok: true, url: new URL(CFG.PUBLIC_BASE_URL, window.location.href) }; }
      catch (_e) { return { ok: false, reason: "base-invalid" }; }
    }
    if (!/^https?:$/.test(window.location.protocol)) return { ok: false, reason: "need-public-base" };
    if (!isLoopbackHost(window.location.hostname)) return { ok: true, url: new URL(window.location.href) };
    const stored = readStoredHost();
    if (!stored) return { ok: false, reason: "need-lan-host" };
    const u = new URL(window.location.href);
    u.host = stored;
    if (isLoopbackHost(u.hostname)) return { ok: false, reason: "need-lan-host" };
    return { ok: true, url: u };
  }

  /** Calcula el enlace del QR. Devuelve { ok, url, reason }. */
  function buildPairing() {
    if (!session) return { ok: false, reason: "no-session" };
    const base = resolveBase();
    if (!base.ok) return base;
    if (isLoopbackHost(base.url.hostname)) return { ok: false, reason: "need-lan-host" };

    let wsUrl;
    try {
      if (CFG.MOBILE_RELAY_URL) {
        wsUrl = new URL(CFG.MOBILE_RELAY_URL);
      } else {
        const relay = resolveRelay();
        if (!relay.ok) return { ok: false, reason: "relay-" + relay.reason };
        wsUrl = new URL(relay.url.href);
        if (isLoopbackHost(wsUrl.hostname)) wsUrl.hostname = base.url.hostname;   // localhost del móvil ≠ PC
      }
    } catch (_e) { return { ok: false, reason: "relay-invalid" }; }
    if (wsUrl.protocol !== "ws:" && wsUrl.protocol !== "wss:") return { ok: false, reason: "relay-invalid" };
    if (isLoopbackHost(wsUrl.hostname)) return { ok: false, reason: "need-lan-host" };

    let pageUrl;
    try { pageUrl = new URL(CFG.REMOTE_PAGE_PATH, base.url); } catch (_e) { return { ok: false, reason: "base-invalid" }; }
    pageUrl.search = "";
    pageUrl.hash = "";
    if (pageUrl.protocol === "https:" && wsUrl.protocol === "ws:") return { ok: false, reason: "mixed" };

    pageUrl.searchParams.set(CFG.QUERY_PARAM_URL, wsUrl.href);
    pageUrl.searchParams.set(CFG.QUERY_PARAM_SESSION, session);
    return { ok: true, url: pageUrl.href };
  }

  const PAIRING_MESSAGES = {
    "no-session": TEXT.noCrypto,
    "relay-missing": TEXT.relayMissing,
    "relay-invalid": TEXT.relayInvalid,
    "mixed": "La página usa HTTPS: el móvil bloquearía ws://. Usa un relay wss://.",
    "need-lan-host": "Indica la IP de la PC en tu red local (el móvil no puede usar «localhost»).",
    "need-public-base": "Esta página no se sirve por HTTP(S). Define PUBLIC_BASE_URL con la dirección de la PC.",
    "base-invalid": "PUBLIC_BASE_URL o REMOTE_PAGE_PATH no son válidos."
  };
  const DEFAULT_NOTE = "Escanea el código con tu móvil (misma red Wi‑Fi). El enlace contiene una clave: no lo compartas.";

  /* ========================================================================
   * 8. INTERFAZ (panel + QR)
   * ====================================================================== */
  const ui = {
    built: false, floating: false, visible: false,
    root: null, statusEl: null, qrBox: null, noteEl: null, linkInput: null, copyBtn: null,
    hostRow: null, hostInput: null, hostMsg: null, openBtn: null, autoBtn: null,
    externalStatus: null, lastQr: "", copyTimer: null
  };

  function renderStatus() {
    if (ui.statusEl) ui.statusEl.textContent = link.statusText;
    const ext = ui.externalStatus || document.getElementById(CFG.STATUS_ID);
    if (ext) {
      ui.externalStatus = ext;
      if (ext.textContent !== link.statusText) ext.textContent = link.statusText;
      ext.setAttribute("data-state", link.status);
    }
  }

  function styleButton(b) {
    Object.assign(b.style, {
      font: "inherit", padding: "6px 10px", borderRadius: "8px", border: "1px solid #bbb",
      background: "#f4f4f4", color: "#111", cursor: "pointer"
    });
    b.type = "button";
  }

  /** Dibuja módulos en canvas (para qrcode-generator, sin innerHTML). */
  function drawModules(canvas, count, isDark, size) {
    const cell = Math.max(1, Math.floor(size / count));
    const px = cell * count;
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  /** Renderiza el QR con la librería local, detectando su API. */
  function renderQr(box, text) {
    clearChildren(box);
    const size = CFG.QR_SIZE;
    const lib = window.QRCode;
    try {
      if (lib && typeof lib.toCanvas === "function") {                 // node-qrcode
        const canvas = document.createElement("canvas");
        box.appendChild(canvas);
        lib.toCanvas(canvas, text, {
          width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" }
        }, function (err) { if (err) logWarn("QR: error de la librería:", err); });
        return true;
      }
      if (typeof lib === "function") {                                  // qrcodejs
        const holder = document.createElement("div");
        box.appendChild(holder);
        new lib(holder, {
          text: text, width: size, height: size, colorDark: "#000000", colorLight: "#ffffff",
          correctLevel: lib.CorrectLevel ? lib.CorrectLevel.M : undefined
        });
        holder.removeAttribute("title");                                // qrcodejs copia el texto en title
        return true;
      }
      if (typeof window.qrcode === "function") {                        // qrcode-generator
        const qr = window.qrcode(0, "M");
        qr.addData(text);
        qr.make();
        const canvas = document.createElement("canvas");
        canvas.style.maxWidth = "100%";
        drawModules(canvas, qr.getModuleCount(), function (r, c) { return qr.isDark(r, c); }, size);
        box.appendChild(canvas);
        return true;
      }
    } catch (err) {
      logWarn("No se pudo generar el QR:", err);
      clearChildren(box);
      return false;
    }
    logWarn("No se encontró una librería QR (qrcode.min.js) compatible.");
    return false;
  }

  function refreshPairing() {
    if (!ui.built) return;
    const p = buildPairing();
    const needsHost = (!p.ok && p.reason === "need-lan-host") || (!!readStoredHost() && !CFG.PUBLIC_BASE_URL);
    ui.hostRow.style.display = needsHost ? "" : "none";

    if (!p.ok) {
      clearChildren(ui.qrBox);
      ui.lastQr = "";
      ui.linkInput.value = "";
      ui.copyBtn.disabled = true;
      ui.noteEl.textContent = PAIRING_MESSAGES[p.reason] || "No se pudo preparar el enlace del mando.";
      return;
    }
    ui.linkInput.value = p.url;
    ui.copyBtn.disabled = false;
    if (ui.floating && !ui.visible) return;                // no dibujar mientras está oculto
    if (ui.lastQr === p.url && ui.qrBox.firstChild) return;
    if (renderQr(ui.qrBox, p.url)) {
      ui.lastQr = p.url;
      ui.noteEl.textContent = DEFAULT_NOTE;
    } else {
      ui.lastQr = "";
      ui.noteEl.textContent = "No se pudo dibujar el QR. Copia el enlace y ábrelo en el móvil.";
    }
  }

  function applyHost() {
    const v = ui.hostInput.value.trim();
    if (!/^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(v) || isLoopbackHost(v.split(":")[0])) {
      ui.hostMsg.textContent = "Escribe una IP o nombre de host válido, p. ej. 192.168.1.20 (no localhost).";
      return;
    }
    storageSet(CFG.STORAGE_HOST_KEY, v);
    ui.hostMsg.textContent = "Guardado.";
    ui.lastQr = "";
    refreshPairing();
  }

  function copyLink() {
    const text = ui.linkInput.value;
    if (!text) return;
    function flash(msg) {
      ui.copyBtn.textContent = msg;
      if (ui.copyTimer) clearTimeout(ui.copyTimer);
      ui.copyTimer = setTimeout(function () { ui.copyTimer = null; ui.copyBtn.textContent = "Copiar"; }, 1500);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash("Copiado"); }, function () { ui.linkInput.select(); flash("Selecciona y copia"); });
        return;
      }
    } catch (_e) { /* continuar con selección manual */ }
    ui.linkInput.select();
    flash("Selecciona y copia");
  }

  function ensureUi() {
    if (ui.built || link.destroyed) return;
    const external = document.getElementById(CFG.QR_CONTAINER_ID);
    let parent;
    if (external) {
      ui.floating = false;
      parent = external;
    } else {
      ui.floating = true;
      const root = el("div", "", {
        position: "fixed", right: "16px", bottom: "64px", zIndex: "2147483000", width: "280px",
        maxWidth: "calc(100vw - 32px)", boxSizing: "border-box", padding: "16px", background: "#fff",
        color: "#111", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,.35)",
        font: "14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif", display: "none"
      });
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "Mando remoto móvil");
      document.body.appendChild(root);
      ui.root = root;
      parent = root;
    }

    parent.appendChild(el("div", "Mando remoto móvil", { fontWeight: "600", marginBottom: "8px" }));

    ui.statusEl = el("div", link.statusText, { fontSize: "13px", marginBottom: "8px" });
    ui.statusEl.setAttribute("role", "status");
    ui.statusEl.setAttribute("aria-live", "polite");
    parent.appendChild(ui.statusEl);

    ui.qrBox = el("div", "", {
      display: "flex", justifyContent: "center", alignItems: "center", background: "#fff",
      padding: "12px", borderRadius: "8px", border: "1px solid #ddd", minHeight: "60px"
    });
    parent.appendChild(ui.qrBox);

    ui.noteEl = el("div", DEFAULT_NOTE, { fontSize: "12px", color: "#444", margin: "8px 0" });
    parent.appendChild(ui.noteEl);

    // IP de la PC (solo si la página corre en localhost)
    ui.hostRow = el("div", "", { margin: "8px 0", display: "none" });
    const hostLabel = el("label", "IP de la PC en la red local", { display: "block", fontSize: "12px", marginBottom: "4px" });
    ui.hostInput = el("input", "", { width: "100%", boxSizing: "border-box", padding: "6px", font: "inherit", marginBottom: "4px" });
    ui.hostInput.type = "text";
    ui.hostInput.placeholder = "192.168.1.20";
    ui.hostInput.autocomplete = "off";
    ui.hostInput.value = readStoredHost();
    ui.hostInput.id = "auraRemoteHostInput";
    hostLabel.setAttribute("for", ui.hostInput.id);
    const hostBtn = el("button", "Aplicar");
    styleButton(hostBtn);
    ui.hostMsg = el("div", "", { fontSize: "12px", marginTop: "4px", color: "#444" });
    ui.hostRow.appendChild(hostLabel);
    ui.hostRow.appendChild(ui.hostInput);
    ui.hostRow.appendChild(hostBtn);
    ui.hostRow.appendChild(ui.hostMsg);
    parent.appendChild(ui.hostRow);

    // Enlace + copiar
    const linkRow = el("div", "", { display: "flex", gap: "6px", margin: "8px 0" });
    ui.linkInput = el("input", "", { flex: "1", minWidth: "0", padding: "6px", font: "12px monospace" });
    ui.linkInput.type = "text";
    ui.linkInput.readOnly = true;
    ui.linkInput.setAttribute("aria-label", "Enlace del mando remoto");
    ui.copyBtn = el("button", "Copiar");
    styleButton(ui.copyBtn);
    linkRow.appendChild(ui.linkInput);
    linkRow.appendChild(ui.copyBtn);
    parent.appendChild(linkRow);

    const actions = el("div", "", { display: "flex", gap: "8px", flexWrap: "wrap" });
    const newBtn = el("button", "Generar nuevo código");
    styleButton(newBtn);
    actions.appendChild(newBtn);
    let closeBtn = null;
    if (ui.floating) {
      closeBtn = el("button", "Cerrar");
      styleButton(closeBtn);
      actions.appendChild(closeBtn);
    }
    parent.appendChild(actions);

    listen(hostBtn, "click", applyHost, "applyHost");
    listen(ui.hostInput, "keydown", function (ev) { if (ev.key === "Enter") applyHost(); }, "hostEnter");
    listen(ui.copyBtn, "click", copyLink, "copyLink");
    listen(newBtn, "click", function () { newSession(); }, "newSession");
    if (closeBtn) listen(closeBtn, "click", hideQr, "closePanel");

    ui.built = true;
    refreshPairing();
  }

  function showQr() {
    if (link.destroyed) return;
    ensureUi();
    if (ui.floating) { ui.root.style.display = "block"; ui.visible = true; }
    refreshPairing();
    renderStatus();
    if (link.manualClose && !link.socket && !link.fatal) start();
  }
  function hideQr() {
    if (ui.floating && ui.root) { ui.root.style.display = "none"; ui.visible = false; }
  }
  function toggleQr() { if (ui.floating && ui.visible) hideQr(); else showQr(); }

  function setupOpenButton() {
    const existing = document.getElementById(CFG.OPEN_BUTTON_ID);
    if (existing) {
      ui.openBtn = existing;
      listen(existing, "click", toggleQr, "openButton");
      return;
    }
    if (!CFG.AUTO_BUTTON) return;
    const b = el("button", "📱 Mando remoto", {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483000", padding: "10px 14px",
      borderRadius: "999px", border: "0", background: "#111", color: "#fff", cursor: "pointer",
      font: "14px system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,.35)"
    });
    b.type = "button";
    b.setAttribute("aria-label", "Abrir el mando remoto móvil");
    document.body.appendChild(b);
    ui.autoBtn = b;
    listen(b, "click", toggleQr, "autoButton");
  }

  /* ========================================================================
   * 9. API PÚBLICA, LIMPIEZA E INICIALIZACIÓN
   * ====================================================================== */
  function start() {
    if (link.destroyed) return false;
    link.manualClose = false;
    link.fatal = false;
    link.unloading = false;
    link.attempt = 0;
    clearReconnectTimer();
    return openRelay();
  }

  function stop() {
    if (link.destroyed) return;
    link.manualClose = true;
    clearReconnectTimer();
    closeSocket(1000, "host stop");
    setStatus("disconnected", TEXT.idle);
  }

  /** Genera una clave nueva (invalida el QR anterior) y reconecta si estaba activo. */
  function newSession() {
    if (link.destroyed) return;
    const fresh = generateSession();
    if (!fresh) { setStatus("error", TEXT.noCrypto); return; }
    session = fresh;
    sessionSet(CFG.STORAGE_SESSION_KEY, fresh);
    ui.lastQr = "";
    const wasRunning = !link.manualClose;
    clearReconnectTimer();
    closeSocket(1000, "new-session");
    refreshPairing();
    if (wasRunning) start();
  }

  function destroy() {
    if (link.destroyed) return;
    link.manualClose = true;
    clearReconnectTimer();
    if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = 0; }
    if (ui.copyTimer) { clearTimeout(ui.copyTimer); ui.copyTimer = null; }
    closeSocket(1000, "destroy");
    teardownSubscription();
    link.destroyed = true;
    removeAllListeners();
    if (ui.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
    if (ui.autoBtn && ui.autoBtn.parentNode) ui.autoBtn.parentNode.removeChild(ui.autoBtn);
    if (window.AuraRemoteHost === api) {
      try { delete window.AuraRemoteHost; } catch (_e) { window.AuraRemoteHost = undefined; }
    }
  }

  /** Estado de diagnóstico. NO incluye la clave de sesión. */
  function getState() {
    return {
      status: link.status,
      text: link.statusText,
      peers: link.peers,
      presenceKnown: link.presenceKnown,
      readyState: link.socket ? link.socket.readyState : WebSocket.CLOSED,
      reconnectAttempt: link.attempt,
      manualClose: link.manualClose,
      destroyed: link.destroyed
    };
  }

  /** Enlace completo de emparejamiento (contiene la clave: trátalo como secreto). */
  function getPairingUrl() {
    const p = buildPairing();
    return p.ok ? p.url : "";
  }

  const api = Object.freeze({
    start: start,
    stop: stop,
    destroy: destroy,
    showQr: showQr,
    hideQr: hideQr,
    newSession: newSession,
    getState: getState,
    getPairingUrl: getPairingUrl,
    protocol: PROTOCOL,
    version: CFG.PROTOCOL_VERSION
  });

  function init() {
    if (link.destroyed || adapter) return;
    if (typeof WebSocket === "undefined") { logError("Este navegador no soporta WebSocket."); return; }

    adapter = buildAdapter();
    session = loadOrCreateSession() || "";
    window.AuraRemoteHost = api;

    setupOpenButton();
    listen(window, "online", onOnline, "online");
    listen(window, "offline", onOffline, "offline");
    listen(document, "visibilitychange", onVisibilityChange, "visibilitychange");
    listen(window, "pagehide", onPageHide, "pagehide");
    listen(window, "pageshow", onPageShow, "pageshow");
    listen(document, "keydown", function (ev) { if (ev.key === "Escape") hideQr(); }, "escape");

    if (!session) { setStatus("error", TEXT.noCrypto); return; }
    setStatus("disconnected", TEXT.idle);
    if (CFG.AUTO_CONNECT) start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safely("init", init), { once: true });
  } else {
    safely("init", init)();
  }
})();
