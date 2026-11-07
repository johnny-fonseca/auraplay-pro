/* player.js — núcleo del reproductor AuraPlay Pro
 *
 * Estructura del archivo
 *   1. Dependencias y constantes
 *   2. Utilidades puras (sin estado)
 *   3. Tonearm — brazo del tocadiscos sincronizado con el audio
 *   4. Player  — controlador principal, organizado en secciones:
 *        · Construcción e inicialización de estado
 *        · Montaje de la UI y enlace de eventos
 *        · Carga de archivos
 *        · Letras (locales y LRCLIB)
 *        · Renderizado (biblioteca, cola, ahora suena, ecualizador)
 *        · Reproducción y volumen
 *        · Visualizador, tema, ayuda y reinicio de datos
 *        · Karaoke
 *        · Listas y persistencia
 *        · Actualizaciones menores de UI
 *
 * La API pública (nombres de métodos y claves de almacenamiento) se conserva
 * intacta: otros módulos (vinylInteraction, shortcuts, remote/auraAdapter…)
 * dependen de ella.
 */
(function (global) {
  "use strict";

  /* ======================================================================
     1. DEPENDENCIAS Y CONSTANTES
     ====================================================================== */
  const { AuraUtils: U, AuraStorage: S, AuraToast, AuraLRC, AuraMetadata, AuraAudioGraph, AuraVisualizer } = global;
  const LYRICS_PARSER_VERSION = AuraLRC.version;

  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

  /** Ajustes de movimiento del brazo (ver sección Tonearm). */
  const TONEARM = Object.freeze({
    glide: { min: 600, max: 1300, perDeg: 20 }, // soporte → surco
    ret: { min: 500, max: 1400, perDeg: 22 },   // surco → soporte
    seek: { min: 250, max: 700, perDeg: 10 },   // salto al arrastrar la barra
    seekDeg: 0.6,                               // desvío que se considera "salto"
    minStep: 0.002,                             // no reescribir CSS por menos de esto (°)
    lookahead: 0.25                             // s máx. de interpolación entre timeupdate
  });

  const KARAOKE_STYLES = Object.freeze(["cinema", "neon", "kinetic", "guilloche", "yozakura", "palco-esmeralda"]);
  const KARAOKE_FONT = Object.freeze({ min: 0.82, max: 1.35 });
  const KARAOKE_CONTROLS_HIDE_MS = 3000;
  const KARAOKE_ACCENT_FALLBACK = "#ff5e7e";

  const TRANSLATION_MODES = Object.freeze(["both", "original", "translation"]);
  const TRANSLATION_LABELS = Object.freeze({
    both: "Original + traducción",
    original: "Solo original",
    translation: "Solo traducción"
  });

  const REPEAT = Object.freeze({ OFF: 0, ALL: 1, ONE: 2 });
  const REPEAT_LABELS = Object.freeze(["desactivado", "todas", "una"]);

  const VIZ_SENSITIVITY = Object.freeze({ min: 0.4, max: 1.2, fallback: 0.7 });
  const DEFAULT_VIZ_STYLE = "bars";

  const EQ_BAND_COUNT = 10;
  const EQ_GAIN_LIMIT = 12;

  const RESET_PHRASE = "BORRAR";

  const LRCLIB = Object.freeze({
    endpoint: "https://lrclib.net/api/",
    timeoutMs: 15000,
    attempts: 3,
    backoffMs: 500,
    durationToleranceSec: 12
  });
  const AUDIO_DURATION_TIMEOUT_MS = 8000;

  const NOW_PLAYING_LABELS = Object.freeze({
    empty: "Añade una canción",
    ready: "Lista para reproducir",
    playing: "Escuchando ahora",
    paused: "En pausa",
    loading: "Cargando audio…",
    error: "No se pudo reproducir"
  });

  const ICONS = Object.freeze({
    defaultCover: `<svg class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    add: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    remove: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
    handle: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>`,
    nowPlaying: `<span class="now-icon" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>`
  });

  /* ======================================================================
     2. UTILIDADES PURAS
     ====================================================================== */
  const byId = (id) => document.getElementById(id);
  const on = (id, type, handler, options) => byId(id).addEventListener(type, handler, options);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Valores "verdadero" heredados de versiones que guardaban texto o números. */
  const isTruthyFlag = (v) => v === true || v === 1 || v === "1" || v === "true";
  const isFalsyFlag = (v) => v === false || v === 0 || v === "0" || v === "false";

  const isValidRepeat = (n) => Number.isInteger(n) && n >= 0 && n <= 2;
  const clampSensitivity = (v) => U.clamp(Number(v) || VIZ_SENSITIVITY.fallback, VIZ_SENSITIVITY.min, VIZ_SENSITIVITY.max);
  const normalizeKaraokeStyle = (style) => (KARAOKE_STYLES.includes(style) ? style : KARAOKE_STYLES[0]);
  const formatOffset = (offset) => `${offset >= 0 ? "+" : ""}${offset.toFixed(1)}s`;
  const wordProgressAt = (index, state) => (index < state.wordIndex ? 1 : index > state.wordIndex ? 0 : state.wordProgress);

  /** Normaliza títulos/artistas para compararlos con resultados de LRCLIB. */
  const normalizeForMatch = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();

  /** Coincidencia exacta o por prefijo de palabra completa. */
  const matchesLoosely = (a, b) => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);

  const nonEmptyString = (value) => typeof value === "string" && value.trim() !== "";
  const isUsableLrclibRecord = (record) =>
    !!record && !record.instrumental && (nonEmptyString(record.syncedLyrics) || nonEmptyString(record.plainLyrics));

  const withTrailingNewline = (text) => (text.endsWith("\n") ? text : `${text}\n`);

  /** Orden de la cola: símbolos, números, otros caracteres y finalmente letras. */
  const QUEUE_COLLATOR = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  const queueCategory = (title) => {
    const first = Array.from((title || "").trim())[0] || "";
    if (/^[\p{P}\p{S}]/u.test(first)) return 0;
    if (/^\p{N}/u.test(first)) return 1;
    if (/^\p{L}/u.test(first)) return 3;
    return 2;
  };

  /** Color de acento: promedio ponderado por saturación de una miniatura 24×24. */
  function computeAccentColor(image) {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const saturation = (max - min) / Math.max(1, max);
      const weight = alpha * (0.35 + saturation);
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
      total += weight;
    }
    return total ? `rgb(${Math.round(r / total)},${Math.round(g / total)},${Math.round(b / total)})` : null;
  }

  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  /* ======================================================================
     3. TONEARM · brazo sincronizado con el progreso real del audio
     ----------------------------------------------------------------------
     - El brazo gira sobre un pivote fijo (centro de .tonearm). La aguja recorre
       el disco desde el surco exterior (--groove-start) hasta el surco de cierre
       (--groove-end), ambos como fracción del radio del disco.
     - El radio del surco baja linealmente con currentTime/duration (igual que en
       un LP real) y se convierte en ángulo resolviendo el triángulo
       pivote–centro–aguja con la ley de cosenos. Todo se mide del DOM, así que
       sigue siendo exacto en cualquier tamaño de pantalla o skin.
     - Fases: rest → glide (baja a la pista) → track (lee el surco) → return → rest
       Además: paused (congelado) y manual (controlado por el gesto del vinilo).
     ====================================================================== */
  class Tonearm {
    constructor(audio) {
      this.audio = audio;
      this.mode = "rest";
      this.angle = null;          // ángulo actual (°); se inicializa con --rest
      this.applied = NaN;         // último ángulo escrito en CSS
      this.progress = 0;
      this.from = 0;
      this.t0 = 0;
      this.dur = 0;
      this.raf = 0;
      this.geo = null;
      this.dirty = true;
      this.lastCT = -1;
      this.lastStamp = 0;
      this.observed = null;
      this.manualHold = false;
      this.reduce = global.matchMedia ? global.matchMedia(REDUCED_MOTION_QUERY) : null;

      this._observeLayoutChanges();
      this._bindAudioEvents();
    }

    /* ---------- Cableado ---------- */
    _observeLayoutChanges() {
      const invalidate = () => { this.dirty = true; };
      global.addEventListener("resize", invalidate);
      if (global.ResizeObserver) this.ro = new ResizeObserver(invalidate);
      if (global.MutationObserver) {
        new MutationObserver(invalidate).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-skin"]
        });
      }
    }

    _bindAudioEvents() {
      const audio = this.audio;
      audio.addEventListener("play", () => this._engage());
      // Pausar congela el brazo en el surco actual; al final conserva la aguja
      // en el surco interior para que la posición visual siga coincidiendo con
      // currentTime.
      audio.addEventListener("pause", () => this._hold());
      audio.addEventListener("ended", () => this._release());
      ["loadedmetadata", "durationchange", "seeked"].forEach((type) =>
        audio.addEventListener(type, () => this._syncStoppedPosition())
      );
    }

    /* ---------- Helpers ---------- */
    _playing() { return !this.audio.paused && !this.audio.ended; }
    _el() { return document.querySelector(".tonearm"); }
    _cancelFrame() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    _css(arm, name, fallback) {
      const value = Number.parseFloat(getComputedStyle(arm).getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    }
    _ms(spec, deg) {
      if (this.reduce && this.reduce.matches) return 0;
      return Math.min(spec.max, spec.min + Math.abs(deg) * spec.perDeg);
    }
    _progressOfMotion(now) { return this.dur > 0 ? U.clamp((now - this.t0) / this.dur, 0, 1) : 1; }
    _rectCenter(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

    /* ---------- Control manual (gesto del vinilo) ---------- */
    beginManualControl() {
      this.manualHold = true;
      this._cancelFrame();
      this.mode = "manual";
    }

    setManualHold(held) {
      this.manualHold = !!held;
      if (this.manualHold) {
        this._cancelFrame();
        this.mode = "manual";
      }
    }

    setManualAngle(angle) {
      if (!Number.isFinite(angle)) return;
      const arm = this._el();
      if (!arm) return;
      this.angle = angle;
      this.applied = angle;
      arm.style.setProperty("--tonearm-angle", angle.toFixed(3) + "deg");
      arm.dataset.state = "manual";
    }

    endManualControl() {
      this.manualHold = false;
      this.mode = "manual";
      this._cancelFrame();
      // El gesto ya decidió dónde cae la aguja. Si el audio sigue sonando,
      // retomar el seguimiento desde la posición elegida; si está pausado,
      // conservar el ángulo. El retorno al soporte solo corresponde al final
      // de la pista o a una caída fuera del disco.
      if (this._playing()) this._begin("glide");
      else this.mode = "paused";
    }

    /** Rango de ángulos que el usuario puede arrastrar el brazo. */
    getManualArmBounds() {
      const arm = this._el();
      const g = this._geometry(arm);
      if (!g) return null;
      const rest = this._css(arm, "--rest", 62);
      const start = this._angleFor(g, g.rStart);
      const end = this._angleFor(g, g.rEnd);
      return { min: Math.min(rest, start, end) - 2, max: Math.max(rest, start, end) + 2 };
    }

    /** Dónde cae la aguja para un ángulo dado: soporte, disco, etiqueta, etc. */
    getManualDropZone(angle) {
      const arm = this._el();
      const g = this._geometry(arm);
      if (!g || !Number.isFinite(angle) || !g.R) return null;
      const frame = document.getElementById("artFrame");
      if (!arm || !frame) return null;

      const rad = angle * Math.PI / 180;
      const pivot = this._rectCenter(arm.getBoundingClientRect());
      const center = this._rectCenter(frame.getBoundingClientRect());
      const x = pivot.x + Math.cos(rad) * g.L;
      const y = pivot.y + Math.sin(rad) * g.L;
      const ratio = Math.hypot(x - center.x, y - center.y) / g.R;
      const point = { x, y };
      const outer = this._css(arm, "--groove-start", 0.95);
      const inner = this._css(arm, "--groove-end", 0.46);

      if (ratio > outer) {
        const zone = angle <= this._css(arm, "--rest", 62) + 4 ? "rest" : "outer";
        return { zone, progress: 0, radiusRatio: ratio, point };
      }
      if (ratio < 0.18) return { zone: "invalid", progress: 0, radiusRatio: ratio, point };
      if (ratio < inner - 1e-4) return { zone: "label", progress: 1, radiusRatio: ratio, point };
      return { zone: "record", progress: U.clamp((outer - ratio) / (outer - inner), 0, 1), radiusRatio: ratio, point };
    }

    /* ---------- Geometría ---------- */
    /** Geometría en px de pantalla: pivote P, centro del disco C, radio R, largo del brazo L. */
    _geometry(arm) {
      if (!this.dirty && this.geo) return this.geo;
      const frame = document.getElementById("artFrame");
      if (!arm || !frame) return null;
      const armRect = arm.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      if (!armRect.width || !frameRect.width) return null;
      if (this.ro && this.observed !== arm) {
        this.ro.observe(arm);
        this.ro.observe(frame);
        this.observed = arm;
      }
      const scale = armRect.width / (arm.offsetWidth || armRect.width); // por si hay zoom/scale en un ancestro
      const R = (frame.offsetWidth / 2) * scale;                        // offsetWidth ignora la rotación del disco
      const pivot = this._rectCenter(armRect);
      const center = this._rectCenter(frameRect);                       // el centro no cambia al girar
      const D = Math.hypot(center.x - pivot.x, center.y - pivot.y);
      const L = armRect.width * this._css(arm, "--arm-reach", 2.16);
      const lo = Math.abs(D - L) + 0.5;
      const hi = D + L - 0.5;                                           // alcance físico del brazo
      this.geo = {
        D, L, lo, hi, R,
        phi: Math.atan2(center.y - pivot.y, center.x - pivot.x) * 180 / Math.PI, // dirección pivote → centro
        rStart: U.clamp(R * this._css(arm, "--groove-start", 0.95), lo, hi),
        rEnd: U.clamp(R * this._css(arm, "--groove-end", 0.46), lo, hi)
      };
      this.dirty = false;
      return this.geo;
    }

    /** Ángulo (°) con el que la aguja queda a distancia r del centro del disco. */
    _angleFor(g, r) {
      const rr = U.clamp(r, g.lo, g.hi);
      const cos = (g.D * g.D + g.L * g.L - rr * rr) / (2 * g.D * g.L);
      return g.phi - Math.acos(U.clamp(cos, -1, 1)) * 180 / Math.PI;
    }

    /** Tiempo de audio estimado: currentTime + interpolación entre actualizaciones. */
    _time(now) {
      const audio = this.audio;
      const ct = audio.currentTime || 0;
      if (ct !== this.lastCT) { this.lastCT = ct; this.lastStamp = now; }
      if (!this._playing()) return ct;
      const elapsed = Math.max(now - this.lastStamp, 0) / 1000 * (audio.playbackRate || 1);
      return ct + Math.min(elapsed, TONEARM.lookahead);
    }

    /** Ángulo objetivo según el progreso de reproducción (o null si no se puede medir). */
    _target(arm, now) {
      const g = this._geometry(arm);
      if (!g) return null;
      const d = this.audio.duration;
      const p = Number.isFinite(d) && d > 0 ? U.clamp(this._time(now) / d, 0, 1) : 0;
      this.progress = p;
      return this._angleFor(g, g.rStart + (g.rEnd - g.rStart) * p);
    }

    /* ---------- Transiciones de estado ---------- */
    _engage() {
      if (this.mode === "glide" || this.mode === "track") return;
      this._begin("glide");
    }

    _hold() {
      if (this.mode === "rest" || this.mode === "paused") return;
      this._cancelFrame();
      this.mode = "paused";
      const arm = this._el();
      if (arm) arm.dataset.state = "paused";
      this._syncStoppedPosition();
    }

    _release() {
      if (this.mode === "rest" || this.mode === "return") return;
      this._cancelFrame();
      const arm = this._el();
      const target = arm ? this._target(arm, performance.now()) : null;
      if (arm && target !== null) {
        this.mode = "paused";
        this._apply(arm, target);
      } else {
        this._begin("return");
      }
    }

    _syncStoppedPosition() {
      if (this.manualHold || this._playing()) return;
      const arm = this._el();
      if (!arm) return;
      const target = this._target(arm, performance.now());
      if (target === null) return;
      this._cancelFrame();
      this.mode = "paused";
      this._apply(arm, target);
    }

    _begin(mode) {
      const arm = this._el();
      if (!arm) return;
      const rest = this._css(arm, "--rest", 62);
      if (this.angle === null) this.angle = rest;
      const now = performance.now();
      const goal = mode === "return" ? rest : this._target(arm, now);
      const spec = mode === "return" ? TONEARM.ret : TONEARM.glide;
      this.mode = mode;
      this.from = this.angle;
      this.t0 = now;
      this.dur = this._ms(spec, goal === null ? 0 : goal - this.angle);
      this._schedule();
    }

    /* ---------- Bucle de animación ---------- */
    _schedule() {
      if (!this.raf) this.raf = requestAnimationFrame((t) => this._tick(t));
    }

    _tick(now) {
      this.raf = 0;
      const arm = this._el();
      if (!arm) { this.mode = "rest"; return; }
      if (this.manualHold) return;

      const rest = this._css(arm, "--rest", 62);
      if (this.angle === null) this.angle = rest;

      // Red de seguridad: si el audio se detuvo sin que llegara el evento, volver al soporte
      if ((this.mode === "glide" || this.mode === "track") && !this._playing()) this._begin("return");

      let next = this.angle;
      if (this.mode === "return") {
        const u = this._progressOfMotion(now);
        next = this.from + (rest - this.from) * easeInOut(u);
        if (u >= 1) { this.mode = "rest"; next = rest; }
      } else if (this.mode === "glide" || this.mode === "track") {
        const target = this._target(arm, now);
        if (target !== null) next = this._followTarget(target, now, next);
      }

      this._apply(arm, next);
      if (this.mode !== "rest") this._schedule();
    }

    /** Calcula el siguiente ángulo mientras se baja a la pista o se lee el surco. */
    _followTarget(target, now, current) {
      if (this.mode === "glide") {
        // La pista se mueve mientras baja: el destino se recalcula cada frame y se alcanza exacto
        const u = this._progressOfMotion(now);
        if (u >= 1) { this.mode = "track"; return target; }
        return this.from + (target - this.from) * easeInOut(u);
      }
      if (Math.abs(target - this.angle) > TONEARM.seekDeg) {
        // Salto (el usuario arrastró la barra o cambió currentTime): deslizar, no teletransportar
        this.mode = "glide";
        this.from = this.angle;
        this.t0 = now;
        this.dur = this._ms(TONEARM.seek, target - this.angle);
        return current;
      }
      return target;
    }

    _apply(arm, angle) {
      this.angle = angle;
      if (arm.dataset.state !== this.mode) arm.dataset.state = this.mode;
      if (Math.abs(angle - this.applied) < TONEARM.minStep && this.mode !== "rest") return;
      this.applied = angle;
      arm.style.setProperty("--tonearm-angle", angle.toFixed(3) + "deg");
      arm.style.setProperty("--tonearm-progress", (this.mode === "rest" ? 0 : this.progress || 0).toFixed(4));
    }
  }

  /* ======================================================================
     4. PLAYER
     ====================================================================== */
  class Player {
    /* ------------------------------------------------------------------
       4.1 Construcción e inicialización de estado
       ------------------------------------------------------------------ */
    constructor() {
      this.audio = byId("audio");
      this.tracks = [];                        // {id, file, url, name, title, artist, album, cover, lyrics, lyricsKey}
      this.lrcMap = new Map();                 // nombre base -> texto LRC
      this.fileDirectories = new WeakMap();    // File -> carpeta escribible de origen
      this.audioDurationCache = new WeakMap(); // File -> Promise<number|null>
      this.currentIndex = -1;
      this.isPlaying = false;
      this.tonearm = new Tonearm(this.audio);  // brazo autónomo: escucha play/pause/ended

      this._initPlaybackState();
      this._initVisualizerState();
      this._initKaraokeState();
      this._initAudioSubsystems();
      this._initEqState();
      this._initLibraryState();
      this._initTheme();

      this.urls = new Set();                   // object URLs a liberar al vaciar la biblioteca
      this._scrollRestored = false;

      this._mount();
      this._bindEvents();
      this._restoreSavedPlaylist();
      this._restoreLocalLibrary();
      this._render();
      this._updateTransport();
      this._setVolume(this.volume, false);
    }

    _initPlaybackState() {
      const savedShuffle = S.get("shuffle", false);
      this.shuffle = isTruthyFlag(savedShuffle);
      if (savedShuffle !== this.shuffle) S.set("shuffle", this.shuffle);

      const savedRepeat = Number(S.get("repeat", 0));
      this.repeat = Number.isFinite(savedRepeat) ? Math.max(REPEAT.OFF, Math.min(REPEAT.ONE, Math.trunc(savedRepeat))) : REPEAT.OFF;
      // Reescribe valores heredados como texto (p. ej. "2") en el formato
      // numérico actual para que las comparaciones sean consistentes.
      if (String(S.get("repeat", 0)) !== String(this.repeat)) S.set("repeat", this.repeat);

      this.volume = U.clamp(S.get("volume", 80), 0, 100);
      this.muted = false;
      this.previousVolume = this.volume;
    }

    _initVisualizerState() {
      this.vizEnabled = !isFalsyFlag(S.get("vizEnabled", true));
      this.vizStyle = this._normalizeVizStyle(S.get("vizStyle", DEFAULT_VIZ_STYLE));
      this.vizSensitivity = clampSensitivity(S.get("vizSensitivity", VIZ_SENSITIVITY.fallback));
    }

    _initKaraokeState() {
      this.lyricOffset = 0;
      this.currentLyricIndex = -2;
      this.lyricFrame = 0;
      this.karaokeDomKey = "";
      this.lyricTracker = AuraLRC.createTracker([], { offset: 0 });
      const savedMode = S.get("lyricTranslationMode", "both");
      this.lyricTranslationMode = TRANSLATION_MODES.includes(savedMode) ? savedMode : "both";
      this.karaokeFontSize = Number(S.get("karaokeFontSize", 1)) || 1;
      this.karaokeStyle = normalizeKaraokeStyle(S.get("karaokeStyle", KARAOKE_STYLES[0]));
      this.karaokeControlsTimer = 0;
      this.reduceMotion = global.matchMedia ? global.matchMedia(REDUCED_MOTION_QUERY) : null;
    }

    _initAudioSubsystems() {
      this.graph = new AuraAudioGraph(this.audio);
      this.vinyl = global.AuraVinylInteraction
        ? new global.AuraVinylInteraction({
            artFrame: byId("artFrame"),
            audio: this.audio,
            player: this,
            audioGraph: this.graph,
            tonearm: document.querySelector(".tonearm"),
            tonearmController: this.tonearm
          })
        : null;
      this.viz = null;       // se crea en _mount()
      this.karaokeFx = null; // se crea en _mount()
    }

    _initEqState() {
      this.eqEnabled = isTruthyFlag(S.get("eqEnabled", false));
      const savedBands = S.get("eqBands", []);
      this.eqBands = Array.from({ length: EQ_BAND_COUNT }, (_, i) =>
        U.clamp(Number(savedBands && savedBands[i]) || 0, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT)
      );
      const presetNames = Object.keys(global.AURA_EQ_PRESETS || {});
      const savedPreset = S.get("eqPreset", "flat");
      this.eqPreset = presetNames.includes(savedPreset) ? savedPreset : "flat";
    }

    _initLibraryState() {
      this.shuffleQueue = [];
      this.searchTerm = String(S.get("searchTerm", "") || "").toLowerCase();
      this.lastFolderName = "";
      this._queueDragIdx = null;
    }

    _initTheme() {
      this.theme = S.get("theme", "dark") === "light" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", this.theme);
    }

    _normalizeVizStyle(style) {
      return Array.isArray(global.AURA_VIZ_STYLES) && global.AURA_VIZ_STYLES.includes(style) ? style : DEFAULT_VIZ_STYLE;
    }

    /* ------------------------------------------------------------------
       4.2 Montaje de la UI
       ------------------------------------------------------------------ */
    _mount() {
      this.viz = new AuraVisualizer(byId("vizCanvas"), this.graph);
      this.progressWaveform = global.AuraProgressWaveform
        ? new global.AuraProgressWaveform(byId("progressWaveform"), this.graph, this.audio)
        : null;
      this.viz.setStyle(this.vizStyle);
      this.viz.setSensitivity(this.vizSensitivity);
      this.karaokeFx = new global.AuraKaraokeFx(byId("kFx"), byId("karaokeOverlay"));
      this._applyKaraokeStyle(this.karaokeStyle);

      this._mountSensitivityControl();
      this._renderEQ();
      this._mountVisualizerCards();
      this._updateVizButton();
      this._mountEqSwitch();
    }

    _mountSensitivityControl() {
      const slider = byId("vizSensitivity");
      this._renderSensitivity();
      slider.addEventListener("input", (e) => {
        this.vizSensitivity = clampSensitivity(e.target.value);
        this.viz.setSensitivity(this.vizSensitivity);
        this._renderSensitivity();
        S.set("vizSensitivity", this.vizSensitivity);
      });
    }

    _renderSensitivity() {
      const label = `${this.vizSensitivity.toFixed(2)}×`;
      const output = byId("vizSensitivityValue");
      byId("vizSensitivity").value = this.vizSensitivity;
      output.value = label;
      output.textContent = label;
    }

    _mountVisualizerCards() {
      document.querySelectorAll("[data-viz]").forEach((card) => {
        card.classList.toggle("active", card.dataset.viz === this.vizStyle);
        card.addEventListener("click", () => this.setVizStyle(card.dataset.viz));
      });
    }

    _mountEqSwitch() {
      const sw = byId("eqSwitch");
      sw.classList.toggle("on", this.eqEnabled);
      sw.setAttribute("aria-checked", String(this.eqEnabled));
      this.graph.setBands(this.eqBands);
      this.graph.setEnabled(this.eqEnabled);
      this.graph.setOutput(this.volume / 100, this.muted);
    }

    /* ------------------------------------------------------------------
       4.3 Enlace de eventos
       ------------------------------------------------------------------ */
    _bindEvents() {
      this._bindAudioEvents();
      this._bindProgressEvents();
      this._bindTransportEvents();
      this._bindVolumeEvents();
      this._bindHeaderEvents();
      this._bindSearchEvents();
      this._bindPlaylistEvents();
      this._bindTabEvents();
      this._bindEqualizerEvents();
      this._bindKaraokeEvents();
      this._bindModalEvents();
      this._bindDragDropEvents();
    }

    _bindAudioEvents() {
      const audio = this.audio;
      audio.addEventListener("ended", () => this._handleEnded());
      audio.addEventListener("timeupdate", () => this._handleTimeUpdate());
      audio.addEventListener("loadedmetadata", () => {
        byId("totalTime").textContent = U.formatTime(audio.duration);
      });
      audio.addEventListener("play", () => this._handlePlay());
      audio.addEventListener("pause", () => this._handlePause());
      audio.addEventListener("waiting", () => this._updateNowPlayingStatus("loading"));
      audio.addEventListener("stalled", () => this._updateNowPlayingStatus("loading"));
      audio.addEventListener("canplay", () => this._updateNowPlayingStatus(this.isPlaying ? "playing" : "ready"));
      audio.addEventListener("error", () => {
        this._updateNowPlayingStatus("error");
        AuraToast.show("Error al reproducir el archivo", "error");
      });
      this._bindAudioContextResume();
    }

    _handleEnded() {
      // El loop del vinilo tiene prioridad sobre repeat y sobre el avance de la
      // cola; así el evento ended no puede saltar de pista.
      if (this.vinyl && typeof this.vinyl.handleTrackEnded === "function" && this.vinyl.handleTrackEnded()) return;
      if (this.repeat === REPEAT.ONE) {
        this.audio.currentTime = 0;
        this._startPlayback();
        return;
      }
      // Avanzar desde el evento ended mantiene el estado de la cola sincronizado
      // incluso cuando el navegador no vuelve a emitir eventos de carga para una
      // URL de objeto consecutiva.
      this.next(true);
    }

    _handleTimeUpdate() {
      const cur = this.audio.currentTime || 0;
      const dur = this.audio.duration || 0;
      this._setProgressUI(dur ? (cur / dur) * 100 : 0);
      byId("currentTime").textContent = U.formatTime(cur);
      if (this.currentIndex >= 0) S.set("playbackPosition", cur);
      this._updateLyrics(cur);
      if (this.isPlaying) this._startLyricFrame();
    }

    _handlePlay() {
      this.isPlaying = true;
      this._updateNowPlayingStatus("playing");
      this._updatePlayButton();
      if (!this._isVinylVisualTransitionBlocked()) this._updateArtSpinning();
      this._updateLyrics(this.audio.currentTime || 0);
      this._startLyricFrame();
      if (this.vizEnabled) {
        this.graph.resume().then((ok) => { if (ok) this.viz.start(); }).catch(() => {});
      }
    }

    _handlePause() {
      this.isPlaying = false;
      this._updateNowPlayingStatus("paused");
      this._updatePlayButton();
      if (!this._isVinylVisualTransitionBlocked()) this._updateArtSpinning();
      this._updateLyrics(this.audio.currentTime || 0);
      this._stopLyricFrame();
      this.viz.stop(!this.vizEnabled);
    }

    /** Los navegadores exigen un gesto del usuario antes de activar Web Audio. */
    _bindAudioContextResume() {
      const resumeOnGesture = () => {
        if (this.audio.paused || !this.vizEnabled) return;
        this.graph.resume().then((ok) => {
          if (!ok) return;
          this.viz.start();
          document.removeEventListener("pointerdown", resumeOnGesture);
          document.removeEventListener("keydown", resumeOnGesture);
        }).catch(() => {});
      };
      document.addEventListener("pointerdown", resumeOnGesture);
      document.addEventListener("keydown", resumeOnGesture);
    }

    _setProgressUI(pct) {
      byId("progressFill").style.width = pct + "%";
      byId("progressThumb").style.left = pct + "%";
    }

    /** Barra de progreso: clic y arrastre. */
    _bindProgressEvents() {
      const bar = byId("progressBar");
      let dragging = false;
      const seekFromX = (clientX) => {
        const rect = bar.getBoundingClientRect();
        const pct = U.clamp((clientX - rect.left) / rect.width, 0, 1);
        if (!this.audio.duration) return;
        this.audio.currentTime = this.audio.duration * pct;
        this._setProgressUI(pct * 100);
      };
      const finishSeek = () => {
        dragging = false;
        bar.classList.remove("is-dragging");
      };
      bar.addEventListener("pointerdown", (e) => {
        dragging = true;
        bar.classList.add("is-dragging");
        if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
        seekFromX(e.clientX);
      });
      bar.addEventListener("pointermove", (e) => { if (dragging) seekFromX(e.clientX); });
      bar.addEventListener("pointerup", finishSeek);
      bar.addEventListener("pointercancel", finishSeek);
    }

    _bindTransportEvents() {
      on("btnPlay", "click", () => this.togglePlay());
      on("btnNext", "click", () => this.next());
      on("btnPrev", "click", () => this.prev());
      on("btnShuffle", "click", () => this.toggleShuffle());
      on("btnRepeat", "click", () => this.cycleRepeat());
    }

    _bindVolumeEvents() {
      const slider = byId("volSlider");
      slider.value = this.volume;
      slider.addEventListener("input", (e) => this._setVolume(parseInt(e.target.value, 10), true));
      on("btnMute", "click", () => this.toggleMute());
    }

    _bindHeaderEvents() {
      on("btnPickFiles", "click", () => this._openFilePicker());
      on("btnPickFolder", "click", () => this._openFolder());
      on("btnTheme", "click", () => this.toggleTheme());
      on("btnHelp", "click", () => this.toggleHelp());
      on("btnSavePlaylist", "click", () => this._savePlaylist());
      on("btnLoadPlaylist", "click", () => this._loadPlaylistDialog());
      on("btnExportPlaylist", "click", () => this._exportPlaylist());
    }

    _bindSearchEvents() {
      const search = byId("playlistSearch");
      const clear = byId("clearSearch");
      const applySearch = (value) => {
        this.searchTerm = String(value || "").trim().toLocaleLowerCase();
        S.set("searchTerm", this.searchTerm);
        clear.hidden = !this.searchTerm;
        this._renderPlaylist();
      };
      search.value = this.searchTerm;
      clear.hidden = !this.searchTerm;
      search.addEventListener("input", (e) => applySearch(e.target.value));
      clear.addEventListener("click", () => {
        search.value = "";
        applySearch("");
        search.focus();
      });
    }

    /** Acciones de lista + delegación de eventos de biblioteca y cola. */
    _bindPlaylistEvents() {
      on("btnClearPlaylist", "click", () => this.clearPlaylist());
      on("btnToggleViz", "click", () => this.toggleVisualizer());
      this._bindLibraryListEvents(byId("playlistList"));
      this._bindQueueListEvents(byId("queueList"));
    }

    _bindLibraryListEvents(list) {
      if (!list) return;
      list.addEventListener("click", (e) => {
        const item = e.target.closest(".song-item");
        if (!item) return;
        const idx = parseInt(item.dataset.idx, 10);
        if (e.target.closest(".song-actions .remove")) {
          e.stopPropagation();
          this.removeTrack(idx);
        } else if (e.target.closest(".song-actions .queue-add")) {
          e.stopPropagation();
          AuraToast.show(`Añadido a la cola: ${this.tracks[idx].title}`);
          this._renderQueue();
        } else if (!e.target.closest(".song-actions")) {
          this.play(idx);
        }
      });
      list.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const item = e.target.closest(".song-item");
        // Solo cuando el foco está en la fila; los botones internos conservan su comportamiento.
        if (!item || e.target !== item) return;
        e.preventDefault();
        this.play(parseInt(item.dataset.idx, 10));
      });
    }

    _bindQueueListEvents(list) {
      if (!list) return;
      const itemOf = (e) => e.target.closest(".queue-item");
      list.addEventListener("click", (e) => {
        const item = itemOf(e);
        if (item) this.play(parseInt(item.dataset.idx, 10));
      });
      list.addEventListener("dragstart", (e) => {
        const item = itemOf(e);
        if (!item) return;
        this._queueDragIdx = parseInt(item.dataset.idx, 10);
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      list.addEventListener("dragover", (e) => {
        const item = itemOf(e);
        if (!item) return;
        e.preventDefault();
        item.classList.add("drag-over");
      });
      list.addEventListener("dragleave", (e) => {
        const item = itemOf(e);
        if (item) item.classList.remove("drag-over");
      });
      list.addEventListener("dragend", (e) => {
        const item = itemOf(e);
        if (item) item.classList.remove("dragging");
        list.querySelectorAll(".drag-over").forEach((x) => x.classList.remove("drag-over"));
        this._queueDragIdx = null;
      });
      list.addEventListener("drop", (e) => {
        const item = itemOf(e);
        if (!item) return;
        e.preventDefault();
        item.classList.remove("drag-over");
        const targetIdx = parseInt(item.dataset.idx, 10);
        const fromIdx = this._queueDragIdx;
        this._queueDragIdx = null;
        if (fromIdx == null || fromIdx === targetIdx) return;
        this._moveTrack(fromIdx, targetIdx);
      });
    }

    _bindTabEvents() {
      document.querySelectorAll(".btn-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          S.set("activeTab", tab);
          this._setActiveTab(tab);
          if (tab === "viz") this._scrollVizTabIntoViewSoon();
        });
      });

      const availableTabs = Array.from(document.querySelectorAll(".btn-tab"), (b) => b.dataset.tab);
      const storedTab = S.get("activeTab", "queue");
      const savedTab = availableTabs.includes(storedTab) ? storedTab : "queue";
      if (savedTab !== storedTab) S.set("activeTab", savedTab);
      this._setActiveTab(savedTab);
      if (savedTab === "viz") this._scrollVizTabIntoViewSoon();

      this._bindScrollPersistence();
    }

    _setActiveTab(tab) {
      document.querySelectorAll(".btn-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab));
    }

    _scrollVizTabIntoViewSoon() {
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollSelectedVizIntoView()));
    }

    _bindScrollPersistence() {
      [["playlistScrollTop", byId("playlistList")], ["queueScrollTop", byId("queueList")]].forEach(([key, element]) => {
        if (!element) return;
        element.addEventListener("scroll", U.debounce(() => {
          S.set(key, Math.max(0, Math.round(element.scrollTop || 0)));
        }, 120), { passive: true });
      });
      window.addEventListener("scroll", U.debounce(() => {
        S.set("pageScrollY", Math.max(0, Math.round(window.scrollY || 0)));
      }, 120), { passive: true });
    }

    _bindEqualizerEvents() {
      const sw = byId("eqSwitch");
      sw.addEventListener("click", () => {
        this.eqEnabled = !this.eqEnabled;
        sw.classList.toggle("on", this.eqEnabled);
        sw.setAttribute("aria-checked", String(this.eqEnabled));
        this.graph.setEnabled(this.eqEnabled);
        S.set("eqEnabled", this.eqEnabled);
        AuraToast.show(`Ecualizador ${this.eqEnabled ? "activado" : "desactivado"}`);
      });

      document.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.dataset.preset;
          this.eqPreset = name;
          this.graph.applyPreset(name);
          this.eqBands = this.graph.bands.slice();
          S.set("eqBands", this.eqBands);
          S.set("eqPreset", name);
          this._markActivePreset(name);
          this._renderEQSliders();
        });
      });

      on("btnEqReset", "click", () => {
        this.graph.applyPreset("flat");
        this.eqBands = new Array(EQ_BAND_COUNT).fill(0);
        this.eqPreset = "flat";
        S.set("eqBands", this.eqBands);
        S.set("eqPreset", "flat");
        this._markActivePreset("flat");
        this._renderEQSliders();
      });
    }

    _markActivePreset(name) {
      document.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b.dataset.preset === name));
    }

    _bindKaraokeEvents() {
      const overlay = byId("karaokeOverlay");

      // Apertura / cierre / pantalla completa
      on("btnKaraokeFs", "click", () => this.openKaraokeFullscreen());
      on("btnKaraokeFs", "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.openKaraokeFullscreen(); }
      });
      on("btnKaraokeClose", "click", () => this.closeKaraokeFullscreen());
      on("btnKaraokeRealFs", "click", () => this.toggleRealFullscreen());

      // Variantes de letra y traducción
      on("btnLyricVariant", "click", () => this.toggleLyricVariant());
      on("btnLyricTranslationMode", "click", () => this.cycleLyricTranslationMode());

      // Desfase
      on("offsetMinus", "click", (e) => this.adjustLyricOffset(e.shiftKey ? -0.5 : -0.1));
      on("offsetPlus", "click", (e) => this.adjustLyricOffset(e.shiftKey ? 0.5 : 0.1));
      on("offsetReset", "click", () => this.adjustLyricOffset(0, true));

      // Controles propios del overlay
      on("kPlay", "click", () => this.togglePlay());
      on("kPrev", "click", () => this.prev());
      on("kNext", "click", () => this.next());
      on("kFontDown", "click", () => this.adjustKaraokeFont(-0.08));
      on("kFontUp", "click", () => this.adjustKaraokeFont(0.08));
      on("kProgress", "input", (e) => {
        if (this.audio.duration) this.audio.currentTime = this.audio.duration * Number(e.target.value) / 100;
      });
      on("kLyrics", "click", (e) => {
        const line = e.target.closest(".k-line");
        if (line) this.audio.currentTime = Number(line.dataset.time) - this.lyricOffset;
      });

      // Carga manual de .lrc
      on("kLoadLrc", "click", () => byId("karaokeLrcPicker").click());
      on("karaokeLrcPicker", "change", (e) => this._loadCurrentLrc(e.target.files && e.target.files[0]));

      // Estilos
      document.querySelectorAll(".k-style-btn[data-karaoke-style]").forEach((button) => {
        button.addEventListener("click", () => this.setKaraokeStyle(button.dataset.karaokeStyle));
      });

      // Ahorro de recursos y auto-ocultado de controles
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this._stopLyricFrame();
        else if (this.isPlaying) this._startLyricFrame();
      });
      ["pointermove", "touchstart", "keydown"].forEach((type) =>
        overlay.addEventListener(type, () => this._showKaraokeControls(), { passive: true })
      );
    }

    _bindModalEvents() {
      const input = byId("resetConfirmInput");
      const confirmButton = byId("btnConfirmReset");

      on("helpClose", "click", () => this.toggleHelp(false));
      on("helpBackdrop", "click", (e) => { if (e.target === e.currentTarget) this.toggleHelp(false); });

      on("btnResetAllData", "click", () => this._showResetConfirmation());
      on("btnCancelReset", "click", () => this._hideResetConfirmation());
      confirmButton.addEventListener("click", () => this._resetAllData());
      input.addEventListener("input", () => {
        confirmButton.disabled = !this._isResetPhraseValid();
        byId("resetConfirmStatus").textContent = "";
      });
    }

    _bindDragDropEvents() {
      this._setupDragAndDrop();
    }

    /* ------------------------------------------------------------------
       4.4 Carga de archivos
       ------------------------------------------------------------------ */
    _openFilePicker() {
      const input = byId("filePicker");
      input.value = "";
      input.onchange = () => this._handleFiles(Array.from(input.files || []));
      input.click();
    }

    async _openFolder() {
      // Siempre abrir el selector permite cambiar de carpeta cuando se desee.
      if (!global.showDirectoryPicker) {
        // Algunos navegadores o contextos (p. ej. file://) no exponen el API
        // moderno, pero sí permiten seleccionar carpetas con webkitdirectory.
        const input = byId("folderPicker");
        input.value = "";
        input.onchange = () => this._handleFiles(Array.from(input.files || []));
        input.click();
        return;
      }
      try {
        const dirHandle = await global.showDirectoryPicker();
        this.lastFolderName = dirHandle.name || "";
        S.set("lastFolderName", this.lastFolderName);
        S.setLocal("lastFolderHandle", dirHandle).catch(() => {});
        const files = [];
        for await (const item of this._walkDir(dirHandle, dirHandle)) {
          try {
            const file = await item.handle.getFile();
            this.fileDirectories.set(file, item.parent);
            files.push(file);
          } catch (_) { /* archivo inaccesible: se omite */ }
        }
        await this._handleFiles(files);
      } catch (e) {
        if (e && e.name !== "AbortError") AuraToast.show("No se pudo abrir la carpeta", "error");
      }
    }

    async *_walkDir(dirHandle, parent = dirHandle) {
      for await (const [, handle] of dirHandle.entries()) {
        if (handle.kind === "file") yield { handle, parent };
        else if (handle.kind === "directory") yield* this._walkDir(handle, handle);
      }
    }

    _setupDragAndDrop() {
      const overlay = byId("dropOverlay");
      let depth = 0;
      window.addEventListener("dragenter", (e) => {
        if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
        depth++;
        overlay.classList.add("show");
      });
      window.addEventListener("dragover", (e) => e.preventDefault());
      window.addEventListener("dragleave", () => {
        depth = Math.max(0, depth - 1);
        if (!depth) overlay.classList.remove("show");
      });
      window.addEventListener("drop", async (e) => {
        e.preventDefault();
        depth = 0;
        overlay.classList.remove("show");
        await this._handleFiles(await this._collectDroppedFiles(e.dataTransfer));
      });
    }

    async _collectDroppedFiles(dataTransfer) {
      const files = [];
      if (dataTransfer.items) {
        for (const item of dataTransfer.items) {
          const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
          if (entry) {
            await this._readEntry(entry, files);
          } else {
            const file = item.getAsFile && item.getAsFile();
            if (file) files.push(file);
          }
        }
      } else if (dataTransfer.files) {
        files.push(...dataTransfer.files);
      }
      return files;
    }

    _readEntry(entry, files) {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((file) => { files.push(file); resolve(); }, resolve);
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readAll = () => {
            reader.readEntries(async (entries) => {
              if (!entries.length) return resolve();
              for (const child of entries) await this._readEntry(child, files);
              readAll();
            }, resolve);
          };
          readAll();
        } else {
          resolve();
        }
      });
    }

    async _handleFiles(files) {
      if (!files || !files.length) return;
      this._showLoading("Procesando archivos...");

      let added = 0;
      let lrcLoaded = 0;
      try {
        const audioFiles = [];
        for (const file of files) {
          if (U.isAudioFile(file)) audioFiles.push(file);
          else if (U.isLrcFile(file) && (await this._registerLrcFile(file))) lrcLoaded++;
        }

        for (const file of audioFiles) {
          const track = await this._createTrack(file);
          this.tracks.push(track);
          added++;
          if (!track.embeddedLyrics && !track.lyrics.length) this._autoLoadLyrics(track);
        }

        // Re-asocia letras a las pistas anteriores por si llegó un .lrc nuevo
        this.tracks.forEach((t) => this._refreshTrackLyrics(t, t.lyricsVariants?.default || t.lyrics || []));
      } finally {
        this._hideLoading();
      }

      this._persistLocalLibrary();
      this._render();

      if (added > 0) {
        AuraToast.show(`${added} canción${added === 1 ? "" : "es"} añadida${added === 1 ? "" : "s"}`, "success");
        if (this.currentIndex === -1) this.play(0);
      } else if (!lrcLoaded) {
        AuraToast.show("No se detectaron archivos válidos", "warn");
      }
    }

    async _registerLrcFile(file) {
      try {
        this.lrcMap.set(U.baseName(file.name), await file.text());
        return true;
      } catch (_) {
        return false;
      }
    }

    async _createTrack(file) {
      const { tags, picture } = await AuraMetadata.extractTags(file);
      const url = URL.createObjectURL(file);
      this.urls.add(url);
      if (picture) this.urls.add(picture);

      const keys = this._lyricVariantKeys(U.baseName(file.name));
      const lyricsText = this.lrcMap.get(keys.defaultKey) || null;
      const lyrics = lyricsText ? AuraLRC.parse(lyricsText) : (tags.lyrics ? AuraLRC.parse(tags.lyrics) : []);

      const track = {
        id: U.uid(),
        file,
        url,
        name: file.name,
        title: U.pickTitle(tags, file.name),
        artist: U.pickArtist(tags),
        album: U.pickAlbum(tags),
        year: tags.year || "",
        genre: tags.genre || "",
        embeddedLyrics: !lyricsText && !!tags.lyrics,
        cover: picture,
        lyrics,
        lyricsKey: keys.defaultKey,
        activeLyricVariant: "default"
      };
      this._refreshTrackLyrics(track, lyrics);
      return track;
    }

    /* ------------------------------------------------------------------
       4.5 Letras (variantes, archivos locales y LRCLIB)
       ------------------------------------------------------------------ */
    _lyricVariantKeys(baseKey) {
      const normalized = String(baseKey || "").toLowerCase();
      const defaultKey = normalized.replace(/_es$/, "");
      return { defaultKey, esKey: `${defaultKey}_es` };
    }

    _refreshTrackLyrics(track, embeddedLyrics = track.lyrics || []) {
      const keys = this._lyricVariantKeys(track.lyricsKey || U.baseName(track.name));
      const defaultText = this.lrcMap.get(keys.defaultKey);
      const hasSpanish = this.lrcMap.has(keys.esKey);
      const original = defaultText != null ? AuraLRC.parse(defaultText) : AuraLRC.normalize(embeddedLyrics);
      const translation = hasSpanish ? AuraLRC.parse(this.lrcMap.get(keys.esKey)) : null;
      const variants = {
        default: translation ? AuraLRC.attachTranslation(original, translation) : original,
        es: translation
      };
      track.lyricsKey = keys.defaultKey;
      track.lyricsVariants = variants;
      track.hasSpanishLyrics = hasSpanish;
      track.hasTranslation = !!(variants.default && variants.default.some((line) => Array.isArray(line.translations) && line.translations.length));
      track.activeLyricVariant = track.activeLyricVariant === "es" && hasSpanish ? "es" : "default";
      track.lyrics = variants[track.activeLyricVariant] || [];
      if (track === this.tracks[this.currentIndex]) this._syncLyricTracker(track.lyrics, this.audio.currentTime || 0);
    }

    /** Lee `<base>.lrc` de la carpeta de origen; devuelve null si no existe o está vacío. */
    async _readSiblingLrc(dir, base) {
      const handle = await dir.getFileHandle(`${base}.lrc`);
      const text = await (await handle.getFile()).text();
      return text.trim() ? text : null;
    }

    async _checkLocalLyrics(track) {
      const base = U.baseName(track.name);
      const keys = this._lyricVariantKeys(base);

      // 1) Reutilizar una letra ya cargada en la biblioteca.
      const cached = this.lrcMap.get(keys.defaultKey);
      if (typeof cached === "string" && cached.trim()) return cached;

      const dir = this.fileDirectories.get(track.file);
      if (!dir || typeof dir.getFileHandle !== "function") return null;

      // 2) Buscar el .lrc hermano directamente (sin solicitar escritura).
      try {
        const text = await this._readSiblingLrc(dir, base);
        if (text) return text;
      } catch (_) { /* no existe */ }

      // 3) Revalidar permiso de lectura y volver a consultar el directorio.
      try {
        const permission = await dir.queryPermission?.({ mode: "read" });
        if (permission === "granted" || !dir.queryPermission) {
          const text = await this._readSiblingLrc(dir, base);
          if (text) return text;
        }
      } catch (_) { /* sin permiso */ }
      return null;
    }

    async _readAudioDuration(file) {
      if (!file || (typeof file !== "object" && typeof file !== "function")) return null;
      const cached = this.audioDurationCache.get(file);
      if (cached) return cached;

      const pending = new Promise((resolve) => {
        let audio = null;
        let url = null;
        let timer = 0;
        let settled = false;
        const finish = (duration) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (audio) {
            audio.removeEventListener("loadedmetadata", onMetadata);
            audio.removeEventListener("error", onError);
            try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (_) {}
          }
          if (url) { try { URL.revokeObjectURL(url); } catch (_) {} }
          resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
        };
        const onMetadata = () => finish(audio.duration);
        const onError = () => finish(null);
        try {
          if (typeof Audio !== "function" || typeof URL?.createObjectURL !== "function") return finish(null);
          audio = new Audio();
          audio.preload = "metadata";
          audio.addEventListener("loadedmetadata", onMetadata, { once: true });
          audio.addEventListener("error", onError, { once: true });
          timer = setTimeout(() => finish(null), AUDIO_DURATION_TIMEOUT_MS);
          url = URL.createObjectURL(file);
          audio.src = url;
          audio.load();
        } catch (_) {
          finish(null);
        }
      });
      this.audioDurationCache.set(file, pending);
      return pending;
    }

    /** GET JSON contra LRCLIB con timeout y reintentos (429 / 5xx / red). */
    async _lrclibJson(endpoint, params = {}, allowNotFound = false) {
      const url = new URL(`${LRCLIB.endpoint}${endpoint}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
      for (let attempt = 0; attempt < LRCLIB.attempts; attempt++) {
        const isLastAttempt = attempt === LRCLIB.attempts - 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LRCLIB.timeoutMs);
        try {
          const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
          if (response.status === 404 && allowNotFound) return null;
          if ((response.status === 429 || response.status >= 500) && !isLastAttempt) {
            try { await response.body?.cancel(); } catch (_) {}
            await sleep(LRCLIB.backoffMs * (attempt + 1));
            continue;
          }
          if (!response.ok) {
            const error = new Error(`LRCLIB respondió HTTP ${response.status}`);
            error.httpStatus = response.status;
            throw error;
          }
          return await response.json();
        } catch (error) {
          const permanentHttpError = error?.httpStatus && error.httpStatus !== 429 && error.httpStatus < 500;
          if (permanentHttpError || isLastAttempt) throw error;
          await sleep(LRCLIB.backoffMs * (attempt + 1));
        } finally {
          clearTimeout(timer);
        }
      }
      return null;
    }

    async _findLrclibRecord(track) {
      // /api/get sin duración evita falsos 404 cuando el archivo y la edición de LRCLIB difieren unos segundos.
      const direct = await this._lrclibJson("get", { track_name: track.title, artist_name: track.artist }, true);
      if (isUsableLrclibRecord(direct)) return direct;

      const results = await this._lrclibJson("search", { q: `${track.artist} ${track.title}` });
      if (!Array.isArray(results)) return null;

      const title = normalizeForMatch(track.title);
      const artist = normalizeForMatch(track.artist).split(/\s+(?:feat|ft|featuring|with)\s+/)[0];
      const duration = Number.isFinite(track.duration) && track.duration > 0
        ? track.duration
        : await this._readAudioDuration(track.file);

      const matches = (record) => {
        if (!isUsableLrclibRecord(record)) return false;
        const titleMatch = matchesLoosely(normalizeForMatch(record.trackName), title);
        const artistMatch = matchesLoosely(normalizeForMatch(record.artistName), artist);
        const durationMatch = !duration || !Number.isFinite(record.duration) ||
          Math.abs(record.duration - duration) <= LRCLIB.durationToleranceSec;
        return titleMatch && artistMatch && durationMatch;
      };
      const distance = (record) => Math.abs((record.duration || duration || 0) - (duration || record.duration || 0));

      return results.filter(matches).sort((a, b) => distance(a) - distance(b))[0] || null;
    }

    /** Escribe el .lrc junto al audio si hay permiso; devuelve true si se guardó. */
    async _saveLyricsNextToAudio(dir, base, text) {
      if (!dir?.getFileHandle) return false;
      let writable;
      try {
        const handle = await dir.getFileHandle(`${base}.lrc`, { create: true });
        writable = await handle.createWritable();
        await writable.write(withTrailingNewline(text));
        await writable.close();
        return true;
      } catch (error) {
        try { await writable?.abort(); } catch (_) {}
        console.warn("[AuraPlay] Letra encontrada, pero no se pudo guardar junto al audio:", error);
        return false;
      }
    }

    async _fetchLyricsFromLrclib(track) {
      try {
        const record = await this._findLrclibRecord(track);
        if (!record) return null;
        const text = record.syncedLyrics || record.plainLyrics;
        if (!text || !text.trim()) return null;

        const base = U.baseName(track.name);
        const filename = `${base}.lrc`;
        const saved = await this._saveLyricsNextToAudio(this.fileDirectories.get(track.file), base, text);
        const downloaded = saved
          ? false
          : U.download(new Blob([withTrailingNewline(text)], { type: "text/plain;charset=utf-8" }), filename);

        this.lrcMap.set(this._lyricVariantKeys(base).defaultKey, text);
        return { text, saved, downloaded, filename };
      } catch (error) {
        console.warn("[AuraPlay] No se pudo obtener la letra de LRCLIB:", error);
        const reason = error?.httpStatus ? `HTTP ${error.httpStatus}` : (error?.code || error?.name || "error de red");
        AuraToast.show(`LRCLIB falló (${reason}). Reintenta en unos segundos; revisa la consola para más detalles.`, "warn", 7000);
        return { error: true };
      }
    }

    async _autoLoadLyrics(track) {
      if (!track || track.embeddedLyrics || track.lyrics?.length) return;
      const local = await this._checkLocalLyrics(track);
      const downloaded = local ? null : await this._fetchLyricsFromLrclib(track);
      const text = local || downloaded?.text;

      if (!text || !this.tracks.includes(track)) {
        if (!local && !downloaded) AuraToast.show(`No se encontró letra para «${track.title}» (${track.artist}).`, "warn", 4500);
        return;
      }

      this._refreshTrackLyrics(track, AuraLRC.parse(text));
      this._persistLocalLibrary();
      if (this.tracks[this.currentIndex] === track) this._updateLyrics(this.audio.currentTime || 0);
      this._render();

      if (downloaded?.saved) {
        AuraToast.show(`Letra descargada y guardada: ${downloaded.filename}`, "success", 5000);
      } else if (downloaded?.downloaded) {
        AuraToast.show(`Letra descargada como ${downloaded.filename}. El navegador puede guardarla en Descargas.`, "success", 6000);
      } else if (downloaded) {
        AuraToast.show("Letra encontrada, pero el navegador no permitió guardar el archivo .lrc.", "warn", 6000);
      }
    }

    /* ------------------------------------------------------------------
       4.6 Renderizado
       ------------------------------------------------------------------ */
    _render() {
      this._renderPlaylist();
      this._renderQueue();
      this._renderNowPlaying();
      this._updateCounters();
      this._restoreScrollPositions();
    }

    _restoreScrollPositions() {
      if (this._scrollRestored || !this.tracks.length) return;
      this._scrollRestored = true;
      const restore = () => {
        const playlist = byId("playlistList");
        const queue = byId("queueList");
        if (playlist) playlist.scrollTop = Math.max(0, Number(S.get("playlistScrollTop", 0)) || 0);
        if (queue) queue.scrollTop = Math.max(0, Number(S.get("queueScrollTop", 0)) || 0);
        const pageY = Math.max(0, Number(S.get("pageScrollY", 0)) || 0);
        if (pageY && typeof window.scrollTo === "function") window.scrollTo(0, pageY);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
      else restore();
    }

    _updateCounters() {
      byId("playlistCount").textContent = this.tracks.length === 1 ? "1 pista" : `${this.tracks.length} pistas`;
    }

    /** Muestra la lista o su estado vacío; devuelve true si hay que renderizar elementos. */
    _toggleListEmptyState(list, empty, isEmpty) {
      empty.style.display = isEmpty ? "grid" : "none";
      list.style.display = isEmpty ? "none" : "flex";
      if (isEmpty) list.innerHTML = "";
      return !isEmpty;
    }

    _trackMatchesSearch(track) {
      if (!this.searchTerm) return true;
      return (
        track.title.toLowerCase().includes(this.searchTerm) ||
        track.artist.toLowerCase().includes(this.searchTerm) ||
        (track.album || "").toLowerCase().includes(this.searchTerm)
      );
    }

    _renderPlaylist() {
      const list = byId("playlistList");
      if (!this._toggleListEmptyState(list, byId("playlistEmpty"), this.tracks.length === 0)) return;
      list.innerHTML = this.tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => this._trackMatchesSearch(track))
        .map(({ track, index }) => this._playlistItemHTML(track, index))
        .join("");
    }

    _playlistItemHTML(track, index) {
      const active = index === this.currentIndex;
      const cover = track.cover ? `<img src="${track.cover}" alt="">` : ICONS.defaultCover;
      return `
        <div class="song-item ${active ? "active" : ""}" data-idx="${index}" role="button" tabindex="0">
          <div class="song-thumb">${cover}${active ? ICONS.nowPlaying : ""}</div>
          <div class="song-meta">
            <div class="song-title">${U.escapeHTML(track.title)}</div>
            <div class="song-artist">${U.escapeHTML(track.artist)}</div>
          </div>
          <div class="song-actions">
            <button class="queue-add" data-idx="${index}" title="Añadir a la cola">${ICONS.add}</button>
            <button class="remove" data-idx="${index}" title="Eliminar">${ICONS.remove}</button>
          </div>
        </div>`;
    }

    /** Índices de pistas ordenados para mostrarlos en la cola. */
    _queueDisplayOrder() {
      return this.tracks
        .map((_, index) => index)
        .sort((a, b) =>
          queueCategory(this.tracks[a].title) - queueCategory(this.tracks[b].title) ||
          QUEUE_COLLATOR.compare(this.tracks[a].title || "", this.tracks[b].title || "")
        );
    }

    _renderQueue() {
      const list = byId("queueList");
      if (!this._toggleListEmptyState(list, byId("queueEmpty"), this.tracks.length === 0)) return;
      list.innerHTML = this._queueDisplayOrder()
        .map((trackIndex, position) => this._queueItemHTML(trackIndex, position))
        .join("");
    }

    _queueItemHTML(trackIndex, position) {
      const track = this.tracks[trackIndex];
      const active = trackIndex === this.currentIndex;
      return `
        <div class="queue-item ${active ? "active" : ""}" draggable="true" data-idx="${trackIndex}">
          <span class="queue-num">${position + 1}</span>
          <div class="queue-info">
            <span class="queue-title">${U.escapeHTML(track.title)}</span>
            <span class="queue-artist">${U.escapeHTML(track.artist)}</span>
          </div>
          <span class="queue-handle" aria-label="Arrastrar">${ICONS.handle}</span>
        </div>`;
    }

    /** Orden de reproducción previsto (índices de pista). */
    _getPlayOrder() {
      const n = this.tracks.length;
      if (!n) return [];
      const order = [];
      if (this.currentIndex >= 0) order.push(this.currentIndex);
      if (this.shuffle && this.shuffleQueue.length) {
        for (const i of this.shuffleQueue) if (i !== this.currentIndex) order.push(i);
      } else {
        const start = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;
        for (let k = 0; k < n; k++) {
          const i = (start + k) % n;
          if (i !== this.currentIndex) order.push(i);
        }
      }
      return order;
    }

    _moveTrack(fromIdx, toIdx) {
      const moved = this.tracks.splice(fromIdx, 1)[0];
      this.tracks.splice(toIdx, 0, moved);
      if (this.currentIndex === fromIdx) this.currentIndex = toIdx;
      else if (fromIdx < this.currentIndex && toIdx >= this.currentIndex) this.currentIndex--;
      else if (fromIdx > this.currentIndex && toIdx <= this.currentIndex) this.currentIndex++;
      S.set("currentTrack", this.currentIndex);
      this._persistLocalLibrary();
      if (this.shuffle) this._generateShuffleQueue();
      this._render();
    }

    _updateNowPlayingStatus(status) {
      const eyebrow = byId("nowEyebrow");
      if (!eyebrow) return;
      const hasTrack = this.currentIndex >= 0 && !!this.tracks[this.currentIndex];
      const next = hasTrack ? (status || (this.isPlaying ? "playing" : "ready")) : "empty";
      eyebrow.textContent = NOW_PLAYING_LABELS[next] || NOW_PLAYING_LABELS.ready;
      eyebrow.dataset.state = next;
      // Reinicia la animación CSS forzando un reflow
      eyebrow.classList.remove("status-changing");
      void eyebrow.offsetWidth;
      eyebrow.classList.add("status-changing");
    }

    _renderNowPlaying() {
      const track = this.tracks[this.currentIndex];
      const artImg = byId("artImg");
      const artDefault = byId("artDefault");

      if (!track) {
        this._updateNowPlayingStatus("empty");
        byId("nowTitle").textContent = "Selecciona una canción";
        byId("nowArtist").textContent = "Carga archivos para empezar";
        byId("nowAlbum").textContent = "";
        byId("nowTags").innerHTML = "";
        artImg.style.display = "none";
        artDefault.style.display = "block";
        byId("nowMiniTitle").textContent = "—";
        this._setKaraokeMini("", "", "");
        this._updateLyricVariantButton();
        return;
      }

      this._updateNowPlayingStatus();
      byId("nowTitle").textContent = track.title;
      byId("nowArtist").textContent = track.artist;
      byId("nowAlbum").textContent = track.album || "";
      byId("nowMiniTitle").textContent = `${track.title} — ${track.artist}`;

      const tags = [track.album, track.year, track.genre].filter(Boolean);
      byId("nowTags").innerHTML = tags.map((x) => `<span class="tag-chip">${U.escapeHTML(x)}</span>`).join("");

      if (track.cover) artImg.src = track.cover;
      artImg.style.display = track.cover ? "block" : "none";
      artDefault.style.display = track.cover ? "none" : "block";
      this._updateLyricVariantButton();
    }

    _renderEQ() {
      const container = byId("eqBands");
      container.innerHTML = global.AURA_EQ_FREQS
        .map((freq, i) => {
          const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
          const gain = this.eqBands[i] || 0;
          return `
          <div class="eq-band" data-band="${i}">
            <span class="eq-gain" data-gain="${i}">${gain}dB</span>
            <input type="range" min="-${EQ_GAIN_LIMIT}" max="${EQ_GAIN_LIMIT}" step="0.5" value="${gain}" data-band-slider="${i}" aria-label="Banda ${label}">
            <span class="eq-freq">${label}</span>
          </div>`;
        })
        .join("");

      container.querySelectorAll("input[data-band-slider]").forEach((slider) => {
        const idx = parseInt(slider.dataset.bandSlider, 10);
        slider.addEventListener("input", (e) => {
          const value = parseFloat(e.target.value);
          this.eqBands[idx] = value;
          this.graph.setBand(idx, value);
          document.querySelector(`[data-gain="${idx}"]`).textContent = `${value}dB`;
          S.set("eqBands", this.eqBands);
        });
      });

      this._markActivePreset(this.eqPreset);
    }

    _renderEQSliders() {
      document.querySelectorAll("input[data-band-slider]").forEach((slider) => {
        const idx = parseInt(slider.dataset.bandSlider, 10);
        slider.value = this.eqBands[idx];
        document.querySelector(`[data-gain="${idx}"]`).textContent = `${this.eqBands[idx]}dB`;
      });
    }

    /* ------------------------------------------------------------------
       4.7 Reproducción y volumen
       ------------------------------------------------------------------ */
    _startPlayback() {
      // Reanuda Web Audio en el mismo gesto del usuario que inicia el medio.
      let graphReady;
      try { graphReady = this.graph.resume(); } catch (_) { graphReady = Promise.resolve(false); }
      let playPromise;
      try { playPromise = this.audio.play(); } catch (_) { playPromise = null; }
      if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
      Promise.resolve(graphReady).then((ready) => {
        if (ready && this.vizEnabled) this.viz.start();
        else if (!ready && this.vizEnabled) AuraToast.show("No se pudo activar el analizador de audio", "warn", 3500);
      }).catch(() => {});
    }

    play(idx) {
      if (idx < 0 || idx >= this.tracks.length) return;
      this.currentIndex = idx;
      S.set("currentTrack", idx);
      S.set("playbackPosition", 0);

      const track = this.tracks[idx];
      this.lyricOffset = this._resolveLyricOffset(track);
      this._syncLyricTracker(track.lyrics || [], 0);
      this._updateOffsetLabel();

      // Cambiar src no siempre inicia una nueva carga en todos los navegadores
      // (especialmente con object URLs). Se fuerza la carga antes de reproducir.
      this.audio.pause();
      // Una canción nueva empieza con el disco en 0°; el reinicio visual pasa
      // por la misma transición usada al restaurar tras Ctrl+R.
      this.audio.currentTime = 0;
      this._restoreVinylVisualState();
      this.audio.src = track.url;
      this.audio.load();
      this._startPlayback();

      this.currentLyricIndex = -2;
      this._renderNowPlaying();
      this._renderPlaylist();
      this._renderQueue();
      this._updateKaraokeFullscreen();
      this._updateLyrics(this.audio.currentTime || 0);
      if (this.shuffle) this._generateShuffleQueue();
    }

    togglePlay() {
      if (this.currentIndex === -1) {
        if (this.tracks.length > 0) this.play(0);
        else AuraToast.show("Carga canciones para empezar", "info");
        return;
      }
      if (this.audio.paused) this._startPlayback();
      else this.audio.pause();
    }

    /** Pasa a la siguiente pista. `fromEnded` evita reiniciar la lista cuando no hay repetición. */
    next(fromEnded = false) {
      if (this.tracks.length === 0) return;
      const nextIdx = this.shuffle ? this._nextShuffleIndex(fromEnded) : this._nextSequentialIndex(fromEnded);
      if (nextIdx === null) {
        this.audio.pause();
        return;
      }
      this.play(nextIdx);
    }

    /** Siguiente índice en modo aleatorio, o null si la lista terminó. */
    _nextShuffleIndex(fromEnded) {
      if (!this.shuffleQueue.length) this._generateShuffleQueue();
      const pos = this.shuffleQueue.indexOf(this.currentIndex);
      const atEnd = pos === -1 || pos === this.shuffleQueue.length - 1;
      if (!atEnd) return this.shuffleQueue[pos + 1];
      if (this.repeat === REPEAT.ALL) {
        this._generateShuffleQueue();
        return this.shuffleQueue[0];
      }
      return fromEnded ? null : this.shuffleQueue[0];
    }

    /** Siguiente índice en orden de lista, o null si la lista terminó. */
    _nextSequentialIndex(fromEnded) {
      const nextIdx = this.currentIndex + 1;
      if (nextIdx < this.tracks.length) return nextIdx;
      if (this.repeat === REPEAT.ALL) return 0;
      return fromEnded ? null : 0;
    }

    prev() {
      if (this.tracks.length === 0) return;
      if (this.audio.currentTime > 3) {
        this.audio.currentTime = 0;
        return;
      }
      let prevIdx;
      if (this.shuffle) {
        const pos = this.shuffleQueue.indexOf(this.currentIndex);
        prevIdx = pos > 0 ? this.shuffleQueue[pos - 1] : this.shuffleQueue[this.shuffleQueue.length - 1];
      } else {
        prevIdx = this.currentIndex - 1;
        if (prevIdx < 0) prevIdx = this.tracks.length - 1;
      }
      this.play(prevIdx);
    }

    seek(deltaSec) {
      if (!this.audio.duration) return;
      this.audio.currentTime = U.clamp(this.audio.currentTime + deltaSec, 0, this.audio.duration);
    }

    removeTrack(idx) {
      if (idx < 0 || idx >= this.tracks.length) return;
      const removed = this.tracks[idx];
      this.tracks.splice(idx, 1);
      this._persistLocalLibrary();
      if (this.currentIndex === idx) {
        this.audio.pause();
        this.audio.src = "";
        this.currentIndex = -1;
      } else if (idx < this.currentIndex) {
        this.currentIndex--;
      }
      S.set("currentTrack", this.currentIndex);
      if (this.currentIndex < 0) S.set("playbackPosition", 0);
      if (this.shuffle) this._generateShuffleQueue();
      this._render();
      AuraToast.show(`Eliminada: ${removed.title}`);
    }

    clearPlaylist() {
      if (this.tracks.length === 0) return;
      this.audio.pause();
      this.audio.src = "";
      this.urls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (_) {}
      });
      this.urls.clear();
      this.tracks = [];
      this.currentIndex = -1;
      S.set("currentTrack", -1);
      S.set("playbackPosition", 0);
      S.removeLocal("library").catch(() => {});
      S.removeLocal("lastFolderHandle").catch(() => {});
      S.remove("lastFolderName");
      this.shuffleQueue = [];
      this._render();
      AuraToast.show("Lista vaciada");
    }

    toggleShuffle() {
      this.shuffle = !this.shuffle;
      S.set("shuffle", this.shuffle);
      if (this.shuffle) this._generateShuffleQueue();
      this._updateTransport();
      this._renderQueue();
      AuraToast.show(`Aleatorio ${this.shuffle ? "activado" : "desactivado"}`);
    }

    /** Fisher-Yates; la pista actual queda en primer lugar. */
    _generateShuffleQueue() {
      const indices = this.tracks.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      if (this.currentIndex >= 0) {
        const pos = indices.indexOf(this.currentIndex);
        if (pos > 0) {
          indices.splice(pos, 1);
          indices.unshift(this.currentIndex);
        }
      }
      this.shuffleQueue = indices;
    }

    cycleRepeat() {
      const current = Number(this.repeat);
      this.repeat = isValidRepeat(current) ? (current + 1) % 3 : REPEAT.OFF;
      S.set("repeat", this.repeat);
      this._updateTransport();
      AuraToast.show(`Repetir: ${REPEAT_LABELS[this.repeat]}`);
    }

    _setVolume(v, save = true) {
      this.volume = U.clamp(v, 0, 100);
      if (this.volume > 0 && this.muted) this.muted = false;
      if (!this.graph.ctx) {
        this.audio.volume = this.volume / 100;
        this.audio.muted = this.muted;
      }
      this.graph.setOutput(this.volume / 100, this.muted);
      byId("volSlider").value = this.volume;
      this._updateMuteIcon();
      if (save) {
        S.set("volume", this.volume);
        S.set("muted", this.muted);
      }
    }

    adjustVolume(delta) {
      this._setVolume(this.volume + delta);
    }

    toggleMute() {
      if (!this.muted) {
        this.previousVolume = this.volume;
        this.muted = true;
      } else {
        this.muted = false;
      }
      if (!this.graph.ctx) this.audio.muted = this.muted;
      this.graph.setOutput(this.volume / 100, this.muted);
      this._updateMuteIcon();
      S.set("muted", this.muted);
    }

    /* ------------------------------------------------------------------
       4.8 Visualizador, tema, ayuda y reinicio de datos
       ------------------------------------------------------------------ */
    toggleVisualizer() {
      this.vizEnabled = !this.vizEnabled;
      S.set("vizEnabled", this.vizEnabled);
      this._updateVizButton();
      if (this.vizEnabled && this.isPlaying) {
        this.graph.resume().then((ready) => {
          if (ready) this.viz.start();
          else AuraToast.show("No se pudo activar el analizador de audio", "warn", 3500);
        });
      } else {
        // Desactivarlo desde el botón sí debe ser inmediato; la pausa del
        // audio usa el fade natural por defecto.
        this.viz.stop(true);
      }
      AuraToast.show(`Visualizador ${this.vizEnabled ? "activado" : "desactivado"}`);
    }

    setVizStyle(style) {
      const value = this._normalizeVizStyle(style);
      this.vizStyle = value;
      this.viz.setStyle(value);
      S.set("vizStyle", value);
      document.querySelectorAll("[data-viz]").forEach((card) => card.classList.toggle("active", card.dataset.viz === value));
      this._scrollSelectedVizIntoView();
    }

    _scrollSelectedVizIntoView() {
      const pane = document.querySelector('.tab-pane[data-pane="viz"]');
      const selected = pane && pane.querySelector(".viz-card.active");
      if (!pane || !selected || !pane.classList.contains("active")) return;
      const grid = pane.querySelector(".viz-grid");
      if (!grid) return;
      const gridRect = grid.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      let delta = 0;
      if (selectedRect.top < gridRect.top) delta = selectedRect.top - gridRect.top;
      else if (selectedRect.bottom > gridRect.bottom) delta = selectedRect.bottom - gridRect.bottom;
      if (delta) grid.scrollTo({ top: grid.scrollTop + delta, behavior: "smooth" });
    }

    _updateVizButton() {
      const button = byId("btnToggleViz");
      if (!button) return;
      button.classList.toggle("active", this.vizEnabled);
      button.setAttribute("aria-pressed", String(this.vizEnabled));
      button.title = `Visualizador: ${this.vizEnabled ? "activado" : "desactivado"}`;
    }

    toggleTheme() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", this.theme);
      S.set("theme", this.theme);
      AuraToast.show(`Tema ${this.theme === "dark" ? "oscuro" : "claro"}`);
    }

    toggleHelp(force) {
      const backdrop = byId("helpBackdrop");
      const open = force == null ? !backdrop.classList.contains("open") : force;
      backdrop.classList.toggle("open", open);
    }

    closeOverlays() {
      this.toggleHelp(false);
      this.closeKaraokeFullscreen();
    }

    _isResetPhraseValid() {
      return byId("resetConfirmInput").value.trim().toLocaleUpperCase() === RESET_PHRASE;
    }

    _showResetConfirmation() {
      const panel = byId("resetConfirmPanel");
      byId("btnResetAllData").setAttribute("aria-expanded", "true");
      panel.hidden = false;
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
      byId("resetConfirmInput").focus({ preventScroll: true });
    }

    _hideResetConfirmation() {
      byId("resetConfirmPanel").hidden = true;
      byId("btnResetAllData").setAttribute("aria-expanded", "false");
      byId("resetConfirmInput").value = "";
      byId("btnConfirmReset").disabled = true;
      byId("resetConfirmStatus").textContent = "";
    }

    async _resetAllData() {
      const button = byId("btnConfirmReset");
      const status = byId("resetConfirmStatus");
      if (!this._isResetPhraseValid() || button.disabled) return;
      button.disabled = true;
      status.textContent = "Borrando datos locales y preparando el reinicio…";

      try {
        await S.resetAll();
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
        this.urls.forEach((url) => { try { URL.revokeObjectURL(url); } catch (_) {} });
        this.urls.clear();
        window.location.reload();
      } catch (error) {
        status.textContent = error && error.message
          ? error.message
          : "No se pudieron borrar los datos. Cierra otras pestañas de AuraPlay e inténtalo de nuevo.";
        button.disabled = !this._isResetPhraseValid();
      }
    }

    /* ------------------------------------------------------------------
       4.9 Karaoke
       ------------------------------------------------------------------ */

    /* ---- Datos de letras ---- */
    _lyricsForCurrent() {
      const track = this.tracks[this.currentIndex];
      return track && Array.isArray(track.lyrics) ? track.lyrics : [];
    }

    _translationText(line) {
      return line && Array.isArray(line.translations) ? line.translations.filter(Boolean).join(" / ") : "";
    }

    _translationVisibility(line) {
      if (!this._translationText(line)) return { original: true, translation: false };
      const mode = this.lyricTranslationMode;
      return {
        original: mode === "both" || mode === "original",
        translation: mode === "both" || mode === "translation"
      };
    }

    _translationModeLabel() {
      return TRANSLATION_LABELS[this.lyricTranslationMode] || TRANSLATION_LABELS.both;
    }

    _updateLyricTranslationButton() {
      const button = byId("btnLyricTranslationMode");
      if (!button) return;
      const track = this.tracks[this.currentIndex];
      const source = track && Array.isArray(track.lyricsVariants?.default) ? track.lyricsVariants.default : this._lyricsForCurrent();
      const available = !!(track && track.hasTranslation === true && source.some((line) => !!this._translationText(line)));
      const filtered = available && this.lyricTranslationMode !== "both";
      button.classList.toggle("visible", available);
      button.classList.toggle("active", filtered);
      button.textContent = "TR";
      button.setAttribute("aria-label", `Modo de traducción: ${this._translationModeLabel()}`);
      button.title = this._translationModeLabel();
      button.setAttribute("aria-pressed", String(filtered));
    }

    cycleLyricTranslationMode() {
      const index = TRANSLATION_MODES.indexOf(this.lyricTranslationMode);
      this.lyricTranslationMode = TRANSLATION_MODES[(index + 1) % TRANSLATION_MODES.length];
      S.set("lyricTranslationMode", this.lyricTranslationMode);
      this._invalidateLyricRender();
      this._updateLyricTranslationButton();
      this._updateLyrics(this.audio.currentTime || 0);
    }

    _updateLyricVariantButton() {
      const button = byId("btnLyricVariant");
      const track = this.tracks[this.currentIndex];
      const available = !!(track && track.hasSpanishLyrics);
      const spanishActive = available && track.activeLyricVariant === "es";
      const label = spanishActive ? "Cambiar a letras originales" : "Cambiar a letras en español";
      button.classList.toggle("visible", available);
      button.classList.toggle("active", spanishActive);
      button.setAttribute("aria-pressed", String(spanishActive));
      button.setAttribute("aria-label", label);
      button.title = label;
      this._updateLyricTranslationButton();
    }

    toggleLyricVariant() {
      const track = this.tracks[this.currentIndex];
      if (!track || !track.hasSpanishLyrics) return;
      track.activeLyricVariant = track.activeLyricVariant === "es" ? "default" : "es";
      track.lyrics = track.lyricsVariants[track.activeLyricVariant] || [];
      this._syncLyricTracker(track.lyrics, this.audio.currentTime || 0);
      this._invalidateLyricRender();
      this._updateLyricVariantButton();
      this._updateLyrics(this.audio.currentTime || 0);
      this._persistLocalLibrary();
    }

    /** Fuerza a reconstruir las líneas de letra en el siguiente `_updateLyrics`. */
    _invalidateLyricRender() {
      this.currentLyricIndex = -2;
      this.karaokeDomKey = "";
    }

    /* ---- Offset y seguimiento ---- */
    /** Offset guardado para la pista (por clave) o, si no hay, el global. */
    _resolveLyricOffset(track) {
      const offsets = S.get("lyricOffsets", {}) || {};
      const perTrack = track ? Number(offsets[track.lyricsKey]) : NaN;
      if (Number.isFinite(perTrack)) return perTrack;
      const global_ = Number(S.get("lyricOffset", 0));
      return Number.isFinite(global_) ? global_ : 0;
    }

    _updateOffsetLabel() {
      byId("offsetValue").textContent = formatOffset(this.lyricOffset);
    }

    adjustLyricOffset(delta, reset = false) {
      const track = this.tracks[this.currentIndex];
      const key = track && track.lyricsKey;
      this.lyricOffset = reset ? 0 : Math.round((this.lyricOffset + delta) * 10) / 10;
      if (key) {
        const map = S.get("lyricOffsets", {});
        map[key] = this.lyricOffset;
        S.set("lyricOffsets", map);
      }
      S.set("lyricOffset", this.lyricOffset);
      this.lyricTracker.setOffset(this.lyricOffset);
      this.lyricTracker.seek(this.audio.currentTime || 0);
      this._updateOffsetLabel();
      this.currentLyricIndex = -2;
      this._updateLyrics(this.audio.currentTime || 0);
    }

    _syncLyricTracker(lines, time = 0) {
      this.lyricTracker.setLines(Array.isArray(lines) ? lines : []);
      this.lyricTracker.setOffset(this.lyricOffset);
      this.lyricTracker.seek(Number(time) || 0);
    }

    _startLyricFrame() {
      if (this.lyricFrame || !this.isPlaying || document.hidden) return;
      const tick = () => {
        this.lyricFrame = requestAnimationFrame(tick);
        this._updateLyrics(this.audio.currentTime || 0);
      };
      this.lyricFrame = requestAnimationFrame(tick);
    }

    _stopLyricFrame() {
      if (this.lyricFrame) cancelAnimationFrame(this.lyricFrame);
      this.lyricFrame = 0;
    }

    /* ---- Renderizado de líneas ---- */
    _renderLyricLine(target, line, wordClass = "lyric-word") {
      if (!target) return;
      target.textContent = "";
      const visibility = this._translationVisibility(line);
      if (!visibility.original && !visibility.translation) return;

      const appendTranslation = () => {
        const translated = document.createElement("span");
        translated.className = "lyric-translation";
        translated.textContent = this._translationText(line);
        target.appendChild(translated);
      };

      if (!visibility.original) {
        appendTranslation();
        return;
      }

      const words = line && Array.isArray(line.words) && line.words.length ? line.words : null;
      if (!words) {
        target.textContent = line && line.text ? line.text : "";
      } else {
        words.forEach((word, index) => {
          const span = document.createElement("span");
          span.className = wordClass;
          span.dataset.time = String(Number(word.time) || Number(line.time) || 0);
          span.dataset.end = String(Number(word.end) || Number(words[index + 1]?.time) || Number(line.end) || 0);
          span.textContent = `${word.text || ""}${word.space && index < words.length - 1 ? " " : ""}`;
          target.appendChild(span);
        });
      }
      if (visibility.translation) appendTranslation();
    }

    _setKaraokeMini(prev, cur, next) {
      const targets = [byId("lyricPrev"), byId("lyricCurrent"), byId("lyricNext")];
      [prev, cur, next].forEach((line, i) => {
        const el = targets[i];
        this._renderLyricLine(el, line);
        // Reinicia la animación de cambio de línea en el siguiente frame
        if (el._lyricSwapRaf) cancelAnimationFrame(el._lyricSwapRaf);
        el.classList.remove("lyric-swap");
        el._lyricSwapRaf = requestAnimationFrame(() => {
          el._lyricSwapRaf = 0;
          if (el.isConnected) el.classList.add("lyric-swap");
        });
      });
    }

    _updateLyrics(currentTime) {
      const lines = this._lyricsForCurrent();
      const state = this.lyricTracker.update(currentTime);
      const idx = state.index;

      if (state.lineChanged || idx !== this.currentLyricIndex) {
        this.currentLyricIndex = idx;
        const prev = idx > 0 ? lines[idx - 1] : null;
        const cur = idx >= 0 ? lines[idx] : { text: lines.length ? "Intro instrumental" : "Sin letras sincronizadas" };
        const next = idx >= 0 && idx < lines.length - 1 ? lines[idx + 1] : null;
        this._setKaraokeMini(prev, cur, next);
        this._renderKaraokeFullscreenLines(idx);
      }

      // Los efectos leen la geometría de la palabra activa antes de que este tick escriba el progreso.
      if (this.karaokeFx) {
        this.karaokeFx.update(this.karaokeStyle, this.graph, this.isPlaying, !!(this.reduceMotion && this.reduceMotion.matches));
      }
      this._updateKaraokeProgress(currentTime);
      this._updateKaraokePause(currentTime, idx);
      if (idx >= 0) this._updateActiveLyricProgress(lines[idx], state);
    }

    _updateActiveLyricProgress(line, state) {
      const active = document.querySelector("#kLyrics .k-line.current");
      if (!active || !line) return;
      const hasWords = !!(line.words && line.words.length);
      active.style.setProperty("--p", hasWords ? state.wordProgress : state.lineProgress);
      if (!hasWords) return;

      active.querySelectorAll(".k-word").forEach((word, index) => {
        const progress = wordProgressAt(index, state);
        word.style.setProperty("--p", progress);
        word.style.setProperty("--word-p", `${(progress * 100).toFixed(1)}%`);
      });
      document.querySelectorAll("#lyricCurrent .lyric-word").forEach((word, index) => {
        word.style.setProperty("--p", wordProgressAt(index, state));
      });
    }

    _renderKaraokeFullscreenLines(currentIdx) {
      const wrap = byId("kLyrics");
      const lines = this._lyricsForCurrent();
      const key = `${this.currentIndex}:${lines.length}:${this.tracks[this.currentIndex]?.lyricsKey || ""}`;

      if (!lines.length) {
        this._renderKaraokeEmptyState(wrap);
        return;
      }
      if (key !== this.karaokeDomKey || wrap.dataset.empty === "1") {
        this.karaokeDomKey = key;
        wrap.dataset.empty = "0";
        this._buildKaraokeLines(wrap, lines);
      }

      wrap.querySelectorAll(".k-line").forEach((element, i) => {
        element.classList.toggle("current", i === currentIdx);
        element.classList.toggle("near", Math.abs(i - currentIdx) <= 2 && i !== currentIdx);
      });
      this._centerKaraokeLine(currentIdx);
      wrap.style.fontSize = `${this.karaokeFontSize}em`;
    }

    _renderKaraokeEmptyState(wrap) {
      if (wrap.dataset.empty === "1") return;
      wrap.dataset.empty = "1";
      wrap.innerHTML =
        "<div class=\"k-no-lyrics\">Sin letras sincronizadas" +
        "<span class=\"hint\">Carga un archivo .lrc para disfrutar del karaoke de esta canción.</span>" +
        "<button class=\"k-control\" id=\"kLoadLrcInline\">Cargar .lrc</button></div>";
      const button = byId("kLoadLrcInline");
      if (button) button.addEventListener("click", () => byId("karaokeLrcPicker").click());
    }

    _buildKaraokeLines(wrap, lines) {
      wrap.textContent = "";
      lines.forEach((line, i) => {
        const element = document.createElement("div");
        element.className = "k-line";
        element.dataset.line = i;
        element.dataset.time = line.time;
        element.style.setProperty("--line-tilt", `${((i * 17) % 5) - 2}deg`);
        element.tabIndex = 0;
        this._renderLyricLine(element, line, "k-word");
        // La traducción queda fuera del reparto en líneas visuales
        const translation = element.querySelector(".lyric-translation");
        if (translation) translation.remove();
        if (line.words && line.words.length) this._splitKaraokeVisualLines(element);
        if (translation) element.appendChild(translation);
        wrap.appendChild(element);
      });
    }

    /** Agrupa las palabras en filas visuales según su posición vertical (saltos de línea del navegador). */
    _splitKaraokeVisualLines(lineElement) {
      const words = Array.from(lineElement.children);
      if (words.length < 2) return;
      const groups = [];
      words.forEach((word) => {
        const top = word.offsetTop;
        let group = groups[groups.length - 1];
        if (!group || Math.abs(group.top - top) > 1) {
          group = { top, words: [] };
          groups.push(group);
        }
        group.words.push(word);
      });
      if (groups.length < 2) return;
      groups.forEach((group) => {
        const row = document.createElement("span");
        row.className = "k-visual-line";
        group.words.forEach((word) => row.appendChild(word));
        lineElement.appendChild(row);
      });
    }

    _centerKaraokeLine(idx) {
      const viewport = byId("kLyricsViewport");
      const wrap = byId("kLyrics");
      const active = wrap.querySelector(`[data-line="${idx}"]`);
      if (!active) return;
      const y = active.offsetTop + active.offsetHeight / 2;
      wrap.style.transform = `translate3d(0,${viewport.clientHeight / 2 - y}px,0)`;
    }

    _updateKaraokeProgress(time) {
      const duration = this.audio.duration || 0;
      const pct = duration ? time / duration * 100 : 0;
      const progress = byId("kProgress");
      progress.value = pct;
      progress.style.setProperty("--k-pct", `${pct}%`);
      byId("kCurrentTime").textContent = U.formatTime(time);
      byId("kTotalTime").textContent = U.formatTime(duration);
      byId("kPlay").textContent = this.isPlaying ? "❚❚" : "▶";
    }

    /** Muestra la pausa instrumental mientras suena la intro previa a la primera línea. */
    _updateKaraokePause(time, idx) {
      const pause = byId("kPause");
      if (!pause) return;
      const lines = this._lyricsForCurrent();
      const adjusted = Number(time) + this.lyricOffset;
      const overlay = byId("karaokeOverlay");
      const firstTime = lines.length ? Number(lines[0].time) : NaN;
      const beforeFirstLyric = idx < 0 && Number.isFinite(firstTime) && adjusted < firstTime;
      const show = !!(overlay && overlay.classList.contains("open") && this.isPlaying && Number.isFinite(adjusted) && beforeFirstLyric);
      pause.classList.toggle("show", show);
      pause.setAttribute("aria-hidden", String(!show));
      const label = byId("kPauseText");
      if (label) label.textContent = "";
    }

    /* ---- Overlay a pantalla completa ---- */
    _applyKaraokeStyle(style) {
      const value = normalizeKaraokeStyle(style);
      this.karaokeStyle = value;
      byId("karaokeOverlay").dataset.karaokeStyle = value;
      if (this.karaokeFx && typeof this.karaokeFx.setStyle === "function") this.karaokeFx.setStyle(value);
      document.querySelectorAll(".k-style-btn").forEach((button) => {
        const active = button.dataset.karaokeStyle === value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    setKaraokeStyle(style) {
      this._applyKaraokeStyle(style);
      S.set("karaokeStyle", this.karaokeStyle);
    }

    cycleKaraokeStyle() {
      const next = KARAOKE_STYLES[(KARAOKE_STYLES.indexOf(this.karaokeStyle) + 1) % KARAOKE_STYLES.length];
      this.setKaraokeStyle(next);
    }

    openKaraokeFullscreen() {
      byId("karaokeOverlay").classList.add("open");
      this._applyKaraokeStyle(this.karaokeStyle);
      this._showKaraokeControls();
      this._updateKaraokeFullscreen();
      this._updateLyrics(this.audio.currentTime || 0);
      this._startLyricFrame();
    }

    closeKaraokeFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      byId("karaokeOverlay").classList.remove("open");
      const pause = byId("kPause");
      if (pause) {
        pause.classList.remove("show");
        pause.setAttribute("aria-hidden", "true");
      }
    }

    toggleKaraokeFullscreen() {
      if (byId("karaokeOverlay").classList.contains("open")) this.closeKaraokeFullscreen();
      else this.openKaraokeFullscreen();
    }

    async toggleRealFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await byId("karaokeOverlay").requestFullscreen();
      } catch (_) {
        AuraToast.show("Pantalla completa no disponible", "warn");
      }
    }

    _updateKaraokeFullscreen() {
      const track = this.tracks[this.currentIndex];
      const cover = track && track.cover;
      byId("kTitle").textContent = track ? track.title : "—";
      byId("kArtist").textContent = track ? track.artist : "";
      const art = byId("kArt");
      art.src = cover || "";
      art.style.display = cover ? "block" : "none";
      byId("kBg").style.backgroundImage = cover ? `url("${cover}")` : "none";
      this._extractKaraokeAccent(cover);
      this._renderKaraokeFullscreenLines(this.currentLyricIndex);
    }

    _extractKaraokeAccent(src) {
      const root = byId("karaokeOverlay");
      if (!src) {
        root.style.setProperty("--k-accent", KARAOKE_ACCENT_FALLBACK);
        return;
      }
      const image = new Image();
      image.onload = () => {
        try {
          const color = computeAccentColor(image);
          if (color) root.style.setProperty("--k-accent", color);
        } catch (_) { /* lienzo contaminado o imagen ilegible: se conserva el acento actual */ }
      };
      image.src = src;
    }

    _showKaraokeControls() {
      const overlay = byId("karaokeOverlay");
      overlay.classList.remove("controls-hidden");
      clearTimeout(this.karaokeControlsTimer);
      this.karaokeControlsTimer = setTimeout(() => overlay.classList.add("controls-hidden"), KARAOKE_CONTROLS_HIDE_MS);
    }

    adjustKaraokeFont(delta) {
      this.karaokeFontSize = U.clamp(Math.round((this.karaokeFontSize + delta) * 100) / 100, KARAOKE_FONT.min, KARAOKE_FONT.max);
      S.set("karaokeFontSize", this.karaokeFontSize);
      this._renderKaraokeFullscreenLines(this.currentLyricIndex);
    }

    async _loadCurrentLrc(file) {
      const track = this.tracks[this.currentIndex];
      if (!file || !track) return;
      try {
        const text = await file.text();
        this.lrcMap.set(track.lyricsKey, text);
        track.activeLyricVariant = "default";
        this._refreshTrackLyrics(track, AuraLRC.parse(text));
        await this._persistLocalLibrary();
        this._invalidateLyricRender();
        this._updateLyricVariantButton();
        this._updateKaraokeFullscreen();
        this._updateLyrics(this.audio.currentTime || 0);
        AuraToast.show("Letras LRC cargadas", "success");
      } catch (_) {
        AuraToast.show("No se pudo leer el archivo LRC", "error");
      }
    }

    /* ---- Utilidades heredadas ----
       Sin uso interno actual; se conservan por compatibilidad con módulos externos. */
    _lineProgress(line, time) {
      const start = Number(line.time) || 0;
      const end = Number(line.end) || start + 3;
      return U.clamp((time + this.lyricOffset - start) / Math.max(0.05, end - start), 0, 1);
    }

    _wordsForLine(line) {
      const text = String(line.text || "♪").trim();
      if (line.words && line.words.length) return line.words.map((w) => ({ time: Number(w.time) || line.time, text: w.text }));
      const parts = text.split(/\s+/).filter(Boolean);
      if (!parts.length) return [{ time: line.time, end: line.end, text }];
      const weights = parts.map((p) => Math.max(1, p.length));
      const total = weights.reduce((a, b) => a + b, 0);
      let cursor = Number(line.time) || 0;
      const span = Math.max(0.1, (Number(line.end) || cursor + 3) - cursor);
      return parts.map((word, i) => {
        const end = cursor + span * weights[i] / total;
        const out = { time: cursor, end, text: word };
        cursor = end;
        return out;
      });
    }

    /* ------------------------------------------------------------------
       4.10 Listas y persistencia
       ------------------------------------------------------------------ */
    _savePlaylist() {
      if (!this.tracks.length) {
        AuraToast.show("Lista vacía", "warn");
        return;
      }
      const name = prompt("Nombre de la lista a guardar:", `Lista ${new Date().toLocaleDateString()}`);
      if (!name) return;
      const tracks = this.tracks.map((t) => ({ name: t.name, title: t.title, artist: t.artist, album: t.album }));
      const lists = S.get("playlists", {});
      lists[name] = { savedAt: Date.now(), tracks };
      S.set("playlists", lists);
      AuraToast.show(`Lista "${name}" guardada (metadatos)`, "success", 3500);
    }

    /** Solo selecciona una lista guardada: los archivos no pueden reconstruirse desde localStorage. */
    _loadPlaylistDialog() {
      const lists = S.get("playlists", {});
      const names = Object.keys(lists);
      if (!names.length) {
        AuraToast.show("No hay listas guardadas", "warn");
        return;
      }
      const options = names.map((n, i) => `${i + 1}. ${n}`).join("\n");
      const choice = prompt(`Listas disponibles:\n\n${options}\n\nEscribe el número o nombre:`);
      if (!choice) return;
      const num = parseInt(choice, 10);
      const name = !isNaN(num) && num > 0 && num <= names.length ? names[num - 1] : choice;
      if (!lists[name]) {
        AuraToast.show("Lista no encontrada", "error");
        return;
      }
      AuraToast.show(`Lista "${name}" cargada. Recarga los archivos para reproducir.`, "info", 4000);
    }

    _exportPlaylist() {
      if (!this.tracks.length) {
        AuraToast.show("Lista vacía", "warn");
        return;
      }
      const m3u = ["#EXTM3U"];
      for (const t of this.tracks) {
        m3u.push(`#EXTINF:-1,${t.artist} - ${t.title}`, t.name);
      }
      U.download(new Blob([m3u.join("\n")], { type: "audio/mpegurl" }), `auraplay-${Date.now()}.m3u`);
      AuraToast.show("Lista exportada como .m3u", "success");
    }

    async _persistLocalLibrary() {
      try {
        const entries = this.tracks.map((t) => {
          const keys = this._lyricVariantKeys(t.lyricsKey || U.baseName(t.name));
          return {
            file: t.file,
            name: t.name,
            title: t.title,
            artist: t.artist,
            album: t.album,
            year: t.year,
            genre: t.genre,
            lyrics: t.lyrics || [],
            lyricsVariants: t.lyricsVariants || { default: t.lyrics || [], es: null },
            lyricsText: this.lrcMap.has(keys.defaultKey) ? this.lrcMap.get(keys.defaultKey) : null,
            lyricsEsText: this.lrcMap.has(keys.esKey) ? this.lrcMap.get(keys.esKey) : null,
            activeLyricVariant: t.activeLyricVariant || "default",
            lyricsKey: keys.defaultKey
          };
        });
        await S.setLocal("library", {
          entries,
          currentIndex: this.currentIndex,
          savedAt: Date.now(),
          lyricsParserVersion: LYRICS_PARSER_VERSION
        });
      } catch (_) {
        AuraToast.show("No se pudo guardar la biblioteca local (espacio insuficiente)", "warn", 4000);
      }
    }

    async _restoreLocalLibrary() {
      try {
        const saved = await S.getLocal("library");
        if (!saved || !Array.isArray(saved.entries) || !saved.entries.length || this.tracks.length) return;
        if (saved.lyricsParserVersion !== LYRICS_PARSER_VERSION) {
          await S.removeLocal("library");
          AuraToast.show("La biblioteca local necesita recargarse para corregir la sincronización de letras", "info", 5000);
          return;
        }
        this._showLoading("Restaurando biblioteca local...");
        await this._restoreLocalLibraryEntries(saved.entries);
        this._restoreLocalLibrarySelection(saved);
        this._hideLoading();
        this._render();
        this._restoreLocalLibraryPlayback();
        this._finishLocalLibraryRestore();
      } catch (_) {
        this._hideLoading();
      }
    }

    async _restoreLocalLibraryEntries(entries) {
      for (const item of entries) {
        if (!item.file) continue;
        this.tracks.push(await this._restoreTrack(item));
      }
    }

    async _restoreTrack(item) {
      const file = item.file;
      const { picture } = await AuraMetadata.extractTags(file);
      const url = URL.createObjectURL(file);
      this.urls.add(url);
      if (picture) this.urls.add(picture);

      const keys = this._lyricVariantKeys(item.lyricsKey || U.baseName(file.name));
      const hasDefaultText = typeof item.lyricsText === "string";
      const hasSpanishText = typeof item.lyricsEsText === "string";
      if (hasDefaultText) this.lrcMap.set(keys.defaultKey, item.lyricsText);
      if (hasSpanishText) this.lrcMap.set(keys.esKey, item.lyricsEsText);

      const legacyLyrics = Array.isArray(item.lyrics) ? item.lyrics : [];
      const original = hasDefaultText ? AuraLRC.parse(item.lyricsText) : AuraLRC.normalize(legacyLyrics);
      const translation = hasSpanishText
        ? AuraLRC.parse(item.lyricsEsText)
        : (Array.isArray(item.lyricsVariants?.es) ? AuraLRC.normalize(item.lyricsVariants.es) : null);
      const variants = {
        default: translation ? AuraLRC.attachTranslation(original, translation) : original,
        es: translation
      };
      const activeVariant = item.activeLyricVariant === "es" && variants.es ? "es" : "default";

      return {
        id: U.uid(),
        file,
        url,
        name: item.name || file.name,
        title: item.title || U.pickTitle({}, file.name),
        artist: item.artist || "Artista desconocido",
        album: item.album || "",
        year: item.year || "",
        genre: item.genre || "",
        cover: picture,
        lyrics: variants[activeVariant] || [],
        lyricsVariants: variants,
        activeLyricVariant: activeVariant,
        hasSpanishLyrics: !!variants.es,
        hasTranslation: !!(variants.default && variants.default.some((line) => Array.isArray(line.translations) && line.translations.length)),
        lyricsKey: keys.defaultKey
      };
    }

    _restoreLocalLibrarySelection(saved) {
      const savedIndex = Number(S.get("currentTrack", saved.currentIndex || 0));
      this.currentIndex = Number.isInteger(savedIndex)
        ? Math.min(Math.max(0, savedIndex), this.tracks.length - 1)
        : 0;
      const restoredTrack = this.tracks[this.currentIndex];
      this.lyricOffset = this._resolveLyricOffset(restoredTrack);
      this._syncLyricTracker(restoredTrack ? restoredTrack.lyrics : [], 0);
      this._updateOffsetLabel();
      return restoredTrack;
    }

    _restoreLocalLibraryPlayback() {
      if (this.currentIndex < 0 || !this.tracks[this.currentIndex]) return;
      const position = Number(S.get("playbackPosition", 0)) || 0;
      const audio = this.audio;
      audio.src = this.tracks[this.currentIndex].url;
      audio.addEventListener("loadedmetadata", () => {
        audio.currentTime = Math.min(position, audio.duration || position);
        // El CSS reinicia su animación después de Ctrl+R; fija la portada al
        // mismo punto que el audio antes del primer Baby Scratch.
        this._restoreVinylVisualState();
      }, { once: true });
      this._renderNowPlaying();
      this._updateLyrics(position);
    }

    _finishLocalLibraryRestore() {
      this.lastFolderName = S.get("lastFolderName", "");
      if (!this.tracks.length) return;
      const folder = this.lastFolderName ? ` · ${this.lastFolderName}` : "";
      AuraToast.show(`Biblioteca restaurada: ${this.tracks.length} pistas${folder}`, "success", 3500);
    }

    /** Restaura volumen silenciado y desfase de letras guardados. */
    _restoreSavedPlaylist() {
      this.muted = isTruthyFlag(S.get("muted", false));
      if (!this.graph.ctx) this.audio.muted = this.muted;
      this.graph.setOutput(this.volume / 100, this.muted);
      this.lyricOffset = this._resolveLyricOffset(this.tracks[this.currentIndex]);
      this._updateOffsetLabel();
    }

    /* ------------------------------------------------------------------
       4.11 Actualizaciones menores de UI
       ------------------------------------------------------------------ */
    _updatePlayButton() {
      const button = byId("btnPlay");
      const playIcon = button.querySelector(".icon-play");
      const pauseIcon = button.querySelector(".icon-pause");
      playIcon.style.display = this.isPlaying ? "none" : "block";
      pauseIcon.style.display = this.isPlaying ? "block" : "none";
      button.setAttribute("aria-label", this.isPlaying ? "Pausar" : "Reproducir");
    }

    _isVinylVisualTransitionBlocked() {
      return !!(this.vinyl && typeof this.vinyl._isTransientMotionActive === "function" && this.vinyl._isTransientMotionActive());
    }

    _restoreVinylVisualState() {
      if (this.vinyl && typeof this.vinyl.restoreVisualStateFromAudio === "function") {
        this.vinyl.restoreVisualStateFromAudio();
      }
    }

    _updateArtSpinning() {
      if (!this.vinyl) return;
      if (this.isPlaying && typeof this.vinyl.enterPlayingVisualState === "function") {
        this.vinyl.enterPlayingVisualState();
      } else if (!this.isPlaying && typeof this.vinyl.enterPausedVisualState === "function") {
        this.vinyl.enterPausedVisualState();
      }
    }

    _updateTransport() {
      const shuffle = byId("btnShuffle");
      shuffle.classList.toggle("active", this.shuffle);
      shuffle.setAttribute("aria-pressed", String(this.shuffle));
      shuffle.title = `Aleatorio: ${this.shuffle ? "activado" : "desactivado"} (S)`;

      const mode = Number(this.repeat);
      this.repeat = isValidRepeat(mode) ? mode : REPEAT.OFF;
      if (mode !== this.repeat) S.set("repeat", this.repeat);

      const repeat = byId("btnRepeat");
      const repeating = this.repeat !== REPEAT.OFF;
      repeat.classList.toggle("active", repeating);
      repeat.setAttribute("aria-pressed", String(repeating));
      repeat.setAttribute("data-repeat", String(this.repeat));
      repeat.title = repeating ? `Repetir: ${REPEAT_LABELS[this.repeat]} (R)` : "Repetir: desactivado (R)";
      repeat.querySelector(".repeat-one").style.display = this.repeat === REPEAT.ONE ? "block" : "none";
      repeat.querySelector(".repeat-all").style.display = this.repeat === REPEAT.ONE ? "none" : "block";
    }

    _updateMuteIcon() {
      const button = byId("btnMute");
      const high = button.querySelector(".vol-high");
      const low = button.querySelector(".vol-low");
      const mute = button.querySelector(".vol-mute");
      [high, low, mute].forEach((el) => (el.style.display = "none"));
      if (this.muted || this.volume === 0) mute.style.display = "block";
      else if (this.volume < 50) low.style.display = "block";
      else high.style.display = "block";
      button.setAttribute("aria-pressed", String(this.muted));
      button.title = this.muted ? "Activar sonido (M)" : "Silenciar (M)";
    }

    _showLoading(msg = "Cargando...") {
      const overlay = byId("loadingOverlay");
      overlay.classList.add("open");
      overlay.querySelector(".loader-text").textContent = msg;
    }

    _hideLoading() {
      byId("loadingOverlay").classList.remove("open");
    }
  }

  global.AuraPlayer = Player;
})(window);