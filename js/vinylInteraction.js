/*
 * AuraPlay Pro — Vinilo interactivo, fases 1 a 5
 *
 * Fase 1: arrastre del disco => búsqueda de posición. Clic en el centro => play/pausa.
 *         Teclado (role="slider").
 * Fase 2: scratch (velocidad angular + histéresis), inercia tras soltar el disco
 *         y control manual del brazo.
 * Fase 3: performance DJ (loops, hot cues, pitch bend, freno/arranque, momentary).
 * Fase 5: perfiles de respuesta, curva de velocidad, seek avanzado y backspin.
 *
 * API pública: window.AuraVinylInteraction (clase)
 *   const vinyl = new AuraVinylInteraction({ artFrame, audio, player, tonearm, audioGraph });
 *   vinyl.destroy();
 *
 *   Brazo manual (para conexión posterior desde player.js):
 *   vinyl.beginManualArm(info) / vinyl.endManualArm(options) /
 *   vinyl.cancelManualArm(options) / vinyl.getManualArmState() /
 *   vinyl.setTonearmAdapter(adapter)
 *
 * Unidades: las velocidades angulares están en rad/s; los ángulos del brazo en grados.
 * `audio.currentTime` es siempre la única fuente de verdad de la posición.
 */
(function (global) {
  "use strict";

  const TWO_PI = Math.PI * 2;
  const DEG = Math.PI / 180;

  const DEFAULTS = {
    // ---- Fase 1 ----
    // Cuántos grados de giro equivalen a la duración completa de la canción.
    degreesPerFullTrack: 360,
    // Desplazamiento mínimo (px) para considerar que hay arrastre y no un clic.
    dragThresholdPx: 6,
    // Radio de la zona central de play/pausa, como fracción del radio del disco.
    centerRadiusRatio: 0.28,
    keyStepSeconds: 5,
    keyStepShiftSeconds: 15,
    // Evita que shortcuts.js reaccione dos veces a teclas ya gestionadas aquí.
    stopKeyPropagation: true,
    showIndicator: true,
    ariaLabel: "Posición de reproducción",
    // Adaptadores opcionales; si no se pasan se usan los métodos de `player`
    // (play/pause/togglePlay) y, en su defecto, el elemento <audio>.
    play: null,
    pause: null,
    togglePlay: null,
    seek: null,      // (seconds) => void. Por defecto: audio.currentTime = seconds
    onSeek: null,    // (seconds) => void. Hook opcional tras cada seek

    // ---- Fase 2: interruptores ----
    scratchEnabled: true,
    inertiaEnabled: true,
    manualArmEnabled: true,

    // ---- Fase 2: scratch (velocidades en rad/s) ----
    // Umbrales bajos a propósito: el motor ya sigue la velocidad real del disco
    // (lento = grave y suave, parado = silencio), así que no hace falta un
    // "arranque" brusco. Con 2.4/1.4 rad/s el sonido tardaba en entrar y se
    // cortaba en los movimientos lentos.
    scratchStartVelocity: 0.4,   // se activa con |v| >= este valor
    scratchStopVelocity: 0.15,   // se desactiva con |v| <= este valor (histéresis)
    scratchMaxRate: 2.4,         // tope de playbackRate durante el scratch
    scratchMinRate: 0.35,        // suelo de playbackRate durante el scratch
    scratchRateFactor: 0.15,     // rate = 1 + |v| * factor
    scratchSmoothing: 0.22,      // 0..1, mayor = menos suavizado (al frenar). Referido a eventos de ~16 ms
    scratchAttackSmoothing: 0.8, // idem al acelerar o invertir: respuesta casi directa
    scratchWhenPaused: true,     // arrastrar con la pista en pausa también suena (como en un plato real)
    rawPointerUpdates: true,     // usa pointerrawupdate (sin alinear a rAF) cuando el navegador lo soporta
    coalescedPointerEvents: true,// procesa getCoalescedEvents() para tener varias muestras por frame
    scratchIdleMs: 100,          // sin movimiento durante este tiempo => se suelta el disco
    velocityMinDtMs: 4,          // evita velocidades absurdas con eventos casi simultáneos
    velocityClamp: 60,           // |v| máximo aceptado (rad/s)
    onScratch: null,             // ({active, direction, velocity, rate}) => void. Hook (audio invertido)

    // ---- Fase 5: scratch avanzado ----
    advancedScratchEnabled: true,
    scratchProfile: "classic",  // classic | soft | aggressive | precision
    scratchCurveExponent: 1,     // respuesta no lineal de la velocidad angular
    scratchResponseGain: 1,      // ganancia aplicada antes del clamp
    scratchSeekMultiplier: 1,    // sensibilidad temporal del gesto
    scratchMaxSeekStep: 0.12,    // máximo avance temporal por evento de puntero
    backspinEnabled: true,
    backspinDurationMs: 420,
    backspinInitialVelocity: 7.5,
    backspinFriction: 0.86,
    backspinMinVelocity: 0.08,

    // ---- Fase 2: inercia ----
    inertiaFriction: 0.90,       // factor por cada 1/60 s
    inertiaMinVelocity: 0.4,     // rad/s; por debajo no hay inercia y ahí se detiene
    inertiaMaxDuration: 900,     // ms
    inertiaMaxStep: 0.08,        // s máximos por frame
    inertiaStaleMs: 80,          // si el puntero estuvo quieto más de esto, la velocidad final es 0

    // ---- Fase 2: brazo manual (ángulos en grados) ----
    armMinAngle: -20,
    armMaxAngle: 110,
    armRestAngle: null,          // null => armMinAngle
    armRestTolerance: 4,         // grados alrededor del reposo que cuentan como "soporte"
    armCenterDeadZone: 0.18,     // fracción del radio; más cerca del eje => "invalid"
    armLabelRatio: 0.30,
    armRecordInnerRatio: 0.35,   // surco interior (fin de la canción)
    armRecordOuterRatio: 0.96,   // surco exterior (inicio de la canción)
    armMaxProgress: 0.995,       // al soltar en la etiqueta no se salta al final exacto
    armReachRatio: 1.5,          // longitud aproximada del brazo, en radios del disco
    armZeroAngleDeg: 0,          // el CSS rota desde el eje horizontal real (igual que Tonearm)
    armPivotXRatio: 0.5,         // pivote dentro del rect del brazo
    armPivotYRatio: 0.5,
    armMinMoveDeg: 0.05,         // no se escribe estilo si el cambio es menor
    armPivot: null,              // () => {x, y} sobreescribe el pivote
    armNeedlePoint: null,        // (angleDeg, pivot) => {x, y} sobreescribe la geometría de la aguja
    tonearmController: null,     // adaptador opcional (ver setTonearmAdapter)

    // ---- Fase 3: performance ----
    loopEnabled: true,
    loopMinDuration: 0.25,
    loopMaxDuration: 60,
    loopQuantizeSeconds: 0,
    hotCueEnabled: true,
    hotCueCount: 8,
    hotCueOverwrite: true,
    pitchBendEnabled: true,
    pitchBendMaxRate: 1.5,
    pitchBendMinRate: 0.5,
    pitchBendReturnMs: 180,
    brakeEnabled: true,
    brakeDurationMs: 700,
    startDurationMs: 500,
    minTurntableRate: 0.05,
    momentaryEnabled: true,
    momentaryMaxRate: 2.5,
    momentaryMinRate: 0.25
  };

  const SCRATCH_CLASSES = ["is-scratching", "is-scratch-forward", "is-scratch-reverse"];

  const SCRATCH_PROFILES = {
    classic:    { exponent: 1,    gain: 1,    seek: 1 },
    soft:       { exponent: 1.35, gain: 0.72, seek: 0.82 },
    aggressive: { exponent: 0.78, gain: 1.18, seek: 1.24 },
    precision:  { exponent: 1.15, gain: 0.58, seek: 0.62 }
  };

  // Teclas de salto relativo: +1 avanza, -1 retrocede.
  const KEY_SEEK_DIRECTION = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

  // ---------- Utilidades ----------

  /** Diferencia angular normalizada a (-PI, PI]. 179° -> -179° da +2°. */
  function shortestAngleDelta(current, previous) {
    const d = ((current - previous + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
    return d === -Math.PI ? Math.PI : d;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function isNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function isValidDuration(d) {
    return isNum(d) && d > 0;
  }

  function nowMs() {
    return global.performance && typeof global.performance.now === "function"
      ? global.performance.now()
      : Date.now();
  }

  function formatTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  }

  function hasRaf() {
    return typeof global.requestAnimationFrame === "function";
  }

  function cancelRaf(id) {
    if (id && typeof global.cancelAnimationFrame === "function") global.cancelAnimationFrame(id);
  }

  /** playbackRate actual si es válido y positivo; si no, 1. */
  function positiveRate(audio) {
    return isNum(audio.playbackRate) && audio.playbackRate > 0 ? audio.playbackRate : 1;
  }

  function isPlaying(audio) {
    return !audio.paused && !audio.ended;
  }

  /** Silencia el rechazo de las promesas de play()/togglePlay() (autoplay bloqueado, etc.). */
  function swallow(result) {
    if (result && typeof result.catch === "function") result.catch(function () {});
  }

  function VinylInteraction(options) {
    this.opts = Object.assign({}, DEFAULTS, options);
    this.artFrame = this.opts.artFrame;
    this.audio = this.opts.audio;
    this.player = this.opts.player || null;
    this.audioGraph = this.opts.audioGraph || null;
    this.babyScratch = typeof global.BabyScratchEngine === "function"
      ? new global.BabyScratchEngine({ audio: this.audio, audioGraph: this.audioGraph })
      : null;
    this.tonearm = this.opts.tonearm || null;

    this.drag = null;
    this.suppressNextClick = false;
    this._suppressTimer = 0;
    this._rafId = 0;
    this._pendingTime = null;
    this._geomDirty = true;
    this._cx = 0;
    this._cy = 0;
    this._radius = 0;
    this.visualStates = {
      restored: null,
      paused: null,
      playing: null,
      scratch: { active: false, angle: null, origin: null }
    };
    this._lastPct = -1;
    this._lastProgress = -1;
    this._hoverCenter = false;
    this._ac = null;
    this._overlay = null;
    this._ro = null;
    this.disabled = false;

    // Fase 2: scratch
    this.isScratching = false;
    this.scratchDirection = 0;
    this.scratchVelocity = 0;
    this._savedRate = null;
    this._lastRate = null;
    this._scratchIdleTimer = 0;
    this._scratchTargets = null;
    this.advancedScratch = {
      enabled: this.opts.advancedScratchEnabled !== false,
      profile: this.opts.scratchProfile,
      rawVelocity: 0,
      responseVelocity: 0,
      seekMultiplier: this.opts.scratchSeekMultiplier
    };
    this.backspin = null;
    this._backspinRaf = 0;
    if (this.opts.scratchProfile && this.opts.scratchProfile !== "classic") {
      this._applyScratchProfile(this.opts.scratchProfile);
    }

    // Fase 2: inercia
    this.inertia = null;
    this._inertiaRaf = 0;

    // Fase 2: brazo
    this.manualArm = {
      active: false,
      pointerId: null,
      startPointerAngle: 0,
      previousPointerAngle: 0,
      startArmAngle: 0,
      currentArmAngle: 0,
      wasPlaying: false,
      onRecord: false,
      lifted: false
    };
    this._armAdapter = null;
    this._armPivot = null;
    this._armAccum = 0;          // radianes acumulados del puntero
    this._armSavedProp = null;   // valor inline previo de --tonearm-angle
    this._armAppliedAngle = NaN;

    // Fase 3: performance
    this.performance = {
      enabled: true,
      rateOwned: false,
      loop: { active: false, start: null, end: null, duration: 0 },
      hotCues: [],
      pitchBend: { active: false, direction: 0, amount: 0, baseRate: 1, currentRate: 1, returnRaf: 0 },
      turntable: { mode: "normal", active: false, startedAt: 0, duration: 0, baseRate: 1, raf: 0, wasPlaying: false },
      momentary: { active: false, direction: 0, amount: 0, baseRate: 1, startedAt: 0, raf: 0, wasPlaying: false }
    };

    if (!this.artFrame || !this.audio) {
      if (global.console) console.warn("[AuraVinylInteraction] Faltan artFrame o audio; módulo desactivado.");
      this.disabled = true;
      return;
    }

    // Evita instancias duplicadas si el reproductor se reinicializa.
    if (this.artFrame.__auraVinyl && this.artFrame.__auraVinyl !== this) {
      this.artFrame.__auraVinyl.destroy();
    }
    this.artFrame.__auraVinyl = this;
    this.bind();
  }

  const proto = VinylInteraction.prototype;

  // ---------- Ciclo de vida ----------

  proto.bind = function () {
    if (this.disabled || this._ac) return;
    const el = this.artFrame;
    this._ac = new AbortController();

    this._useRawPointer = this.opts.rawPointerUpdates !== false && ("onpointerrawupdate" in el);

    // Semántica y estado visual
    el.classList.add("is-interactive");
    if (!el.hasAttribute("role")) el.setAttribute("role", "slider");
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", this.opts.ariaLabel);
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.setAttribute("aria-valuenow", "0");

    this._bindRecordListeners();
    this._bindTonearmListeners();
    this._bindAudioListeners();
    this._bindGeometryListeners();
    this._bindOverlayListeners();
    this._syncProgress();
  };

  proto._bindOptions = function (passive) {
    return passive ? { signal: this._ac.signal, passive: true } : { signal: this._ac.signal };
  };

  proto._listenBound = function (target, handlers, options) {
    if (!target) return;
    const listenerOptions = options || this._bindOptions(false);
    for (const type in handlers) target.addEventListener(type, handlers[type], listenerOptions);
  };

  proto._bindRecordListeners = function () {
    const el = this.artFrame;
    this._listenBound(el, {
      pointerdown: (e) => this._onPointerDown(e),
      // pointermove llega alineado al frame (hasta ~16 ms de retraso en Chrome).
      // Donde existe, pointerrawupdate entrega el movimiento en cuanto se produce;
      // entonces pointermove solo se usa para el hover y para navegadores sin él.
      pointermove: (e) => {
        if (this._useRawPointer && this.drag && this.drag.active) return;
        this._onPointerMove(e);
      },
      pointerrawupdate: (e) => { if (this._useRawPointer && this.drag) this._onPointerMove(e); },
      pointerup: (e) => this._onPointerUp(e),
      pointercancel: (e) => this._onPointerCancel(e),
      lostpointercapture: (e) => this._onPointerCancel(e),
      pointerleave: () => this._setHoverCenter(false),
      click: (e) => this._onClick(e),
      keydown: (e) => this._onKeyDown(e),
      // Evita que la imagen central inicie un drag nativo o abra menú contextual al mantener pulsado.
      dragstart: (e) => e.preventDefault(),
      contextmenu: (e) => { if (this.drag && this.drag.active) e.preventDefault(); }
    });
  };

  proto._bindTonearmListeners = function () {
    if (this.tonearm && this.opts.manualArmEnabled) {
      this._listenBound(this.tonearm, {
        pointerdown: (e) => this._onArmPointerDown(e),
        pointermove: (e) => this._onArmPointerMove(e),
        pointerup: (e) => this._onArmPointerUp(e),
        pointercancel: (e) => this._onArmPointerCancel(e),
        lostpointercapture: (e) => this._onArmPointerCancel(e)
      });
    }
  };

  proto._bindAudioListeners = function () {
    const sync = () => { this._syncProgress(); this._handlePerformanceTime(); };
    this._listenBound(this.audio, {
      timeupdate: sync,
      seeked: sync,
      durationchange: sync,
      loadedmetadata: () => {
        sync();
        if (this.babyScratch) this.babyScratch.prepare(this.audio.currentSrc || this.audio.src);
      },
      ended: () => { this._handlePerformanceEnded(); this._syncProgress(); },
      emptied: () => { this._cancelAll(); this.clearPerformanceState(); this._syncProgress(); },
      loadstart: () => { this._cancelAll(); this.clearPerformanceState(); }
    });
  };

  proto._bindGeometryListeners = function () {
    const onResize = () => { this._geomDirty = true; this._layoutOverlay(); };
    const passive = this._bindOptions(true);
    global.addEventListener("resize", onResize, passive);
    global.addEventListener("scroll", () => { this._geomDirty = true; }, passive);
    if (typeof global.ResizeObserver === "function") {
      this._ro = new global.ResizeObserver(onResize);
      this._ro.observe(this.artFrame);
    }
  };

  proto._bindOverlayListeners = function () {
    if (this.opts.showIndicator) this._createOverlay();
  };

  proto.destroy = function () {
    if (!this._ac) return;
    this._cancelAll();
    this._resetArmVisual();
    this._ac.abort();
    this._ac = null;
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
    this._overlay = null;
    clearTimeout(this._suppressTimer);
    const el = this.artFrame;
    el.classList.remove("is-interactive", "is-dragging", "is-seeking", "is-clickable");
    this._setScratchClasses(false, 0);
    if (el.__auraVinyl === this) delete el.__auraVinyl;
  };

  /** Cancela de golpe todo gesto en curso (cambio de canción, destroy). Nunca reanuda. */
  proto._cancelAll = function () {
    this._cancelDrag(false);
    this._stopInertia(false);
    this.cancelBackspin({ resume: false });
    this.cancelManualArm({ resume: false });
    this._restoreRate();
    this._clearScratchIdle();
    this.isScratching = false;
    this.scratchDirection = 0;
    this.scratchVelocity = 0;
    this._setScratchClasses(false, 0);
    this._resetVinylFx();
    if (this.babyScratch) this.babyScratch.stop();
    this._cancelPerformanceRafs();
    this._restorePerformanceRate();
  };

  /** Fuerza la relectura de centro y radio en el siguiente uso. */
  proto.refreshGeometry = function () {
    this._geomDirty = true;
    this._layoutOverlay();
  };

  // ---------- Geometría ----------

  proto._readGeometry = function () {
    if (!this._geomDirty && this._radius > 0) return;
    const rect = this.artFrame.getBoundingClientRect();
    // El centro del rect de un elemento que gira sobre su centro no cambia.
    // El radio sale de offsetWidth: no se ve afectado por la rotación CSS.
    this._cx = rect.left + rect.width / 2;
    this._cy = rect.top + rect.height / 2;
    this._radius = (this.artFrame.offsetWidth || rect.width) / 2;
    this._geomDirty = false;
  };

  proto._pointerAngle = function (e) {
    return Math.atan2(e.clientY - this._cy, e.clientX - this._cx);
  };

  proto._isCenter = function (e) {
    const dist = Math.hypot(e.clientX - this._cx, e.clientY - this._cy);
    return dist <= this._radius * this.opts.centerRadiusRatio;
  };

  /** true si el evento nació dentro del brazo (que puede estar anidado en el disco). */
  proto._isArmTarget = function (e) {
    const t = this.tonearm;
    return !!(t && e && e.target && typeof t.contains === "function" && t.contains(e.target));
  };

  proto._eventTime = function (e) {
    const ts = e && e.timeStamp;
    return isNum(ts) && ts > 0 ? ts : nowMs();
  };

  /** Segundos de audio que equivale a un radián de giro del disco. */
  proto._secondsPerRadian = function (duration) {
    return duration / ((this.opts.degreesPerFullTrack * Math.PI) / 180);
  };

  /** Elementos que reciben las clases de estado: artFrame y, si existe, su .art-wrap. */
  proto._classTargets = function () {
    const el = this.artFrame;
    const wrap = el && typeof el.closest === "function" ? el.closest(".art-wrap") : null;
    return wrap && wrap !== el ? [el, wrap] : [el];
  };

  /** Ángulo actual del disco, incluyendo la animación CSS si estaba girando. */
  proto._readVinylAngle = function () {
    if (!this.artFrame || typeof global.getComputedStyle !== "function") return 0;
    try {
      const transform = global.getComputedStyle(this.artFrame).transform;
      if (!transform || transform === "none") return 0;
      const match = transform.match(/^matrix(3d)?\(([^)]+)\)$/);
      if (!match) return 0;
      const values = match[2].split(",").map(Number);
      if (match[1] === "3d") {
        if (values.length < 2 || !isNum(values[0]) || !isNum(values[1])) return 0;
        return Math.atan2(values[1], values[0]) / DEG;
      }
      if (values.length < 2 || !isNum(values[0]) || !isNum(values[1])) return 0;
      return Math.atan2(values[1], values[0]) / DEG;
    } catch (_) { return 0; }
  };

  /** Aplica el giro físico del disco mientras la animación normal está pausada. */
  proto._setVinylScratchAngle = function (angle) {
    if (!this.artFrame || !this.artFrame.style || !isNum(angle)) return;
    this.artFrame.style.setProperty("--vinyl-scratch-angle", angle + "deg");
  };

  /** Estado RESTORED: fija la portada al punto recuperado tras Ctrl+R. */
  proto.restoreVisualStateFromAudio = function () {
    if (this._isTransientMotionActive()) return false;
    const duration = this.audio && this.audio.duration;
    if (!isValidDuration(duration) || !this.artFrame || !this.artFrame.style) return false;
    const angle = clamp((this.audio.currentTime || 0) / duration, 0, 1) * 360;
    this.visualStates.restored = angle;
    this.visualStates.paused = angle;
    this.visualStates.playing = null;
    this._setVinylScratchAngle(angle);
    const playing = !this.audio.paused && !this.audio.ended;
    this.artFrame.classList.toggle("spinning", playing);
    this.artFrame.classList.toggle("paused", !playing);
    if (this.artFrame.classList && this.artFrame.classList.contains("spinning")) {
      this.artFrame.style.transform = "";
      this._preserveVinylAnimationPhase(angle);
    } else {
      this.artFrame.style.transform = "rotate(" + angle + "deg)";
    }
    return true;
  };

  /** Estado PAUSED: conserva solo el ángulo visible al entrar en pausa. */
  proto.enterPausedVisualState = function (explicitAngle) {
    if (this._isTransientMotionActive()) return false;
    const angle = isNum(explicitAngle) ? explicitAngle : this._readVinylAngle();
    this.visualStates.paused = angle;
    // En una pausa normal, `playing` puede contener la fase de la última
    // reproducción y ya no representa el ángulo visible. Se invalida para
    // que el siguiente play use el ángulo recién guardado en `paused`.
    // El scratch pasa un ángulo explícito y conserva ambos estados separados.
    if (!isNum(explicitAngle)) this.visualStates.playing = null;
    this.visualStates.restored = null;
    this.artFrame.classList.add("paused");
    if (this.artFrame.classList.contains("spinning")) {
      this._preserveVinylAnimationPhase(angle);
      this.artFrame.style.transform = "";
    } else {
      this.artFrame.style.transform = "rotate(" + angle + "deg)";
    }
    return true;
  };

  /** Estado PLAYING: reanuda desde el ángulo propio de reproducción. */
  proto.enterPlayingVisualState = function (explicitAngle) {
    if (this._isTransientMotionActive()) return false;
    const angle = isNum(explicitAngle)
      ? explicitAngle
      : isNum(this.visualStates.playing)
      ? this.visualStates.playing
      : (isNum(this.visualStates.paused) ? this.visualStates.paused : this._readVinylAngle());
    this.visualStates.playing = angle;
    this.visualStates.restored = null;
    this.artFrame.classList.add("spinning");
    this.artFrame.classList.remove("paused");
    this._preserveVinylAnimationPhase(angle);
    this.artFrame.style.transform = "";
    return true;
  };

  proto._isTransientMotionActive = function () {
    return !!(this.visualStates.scratch.active || this.inertia || this.backspin);
  };

  /**
   * Transfiere el ángulo manual a la línea de tiempo de la animación CSS.
   * Al quitar `is-seeking`, el navegador deja de usar la transformación manual
   * y, sin esta fase negativa, la animación vuelve a empezar desde 0 grados.
   */
  proto._preserveVinylAnimationPhase = function (angle) {
    if (!this.artFrame || !this.artFrame.style || !isNum(angle)) return;
    if (typeof global.getComputedStyle !== "function") return;
    try {
      const computed = global.getComputedStyle(this.artFrame);
      const durationMatch = String(computed.animationDuration || "").match(/^([\d.]+)s$/);
      const duration = durationMatch ? Number(durationMatch[1]) : 0;
      if (!(duration > 0)) return;
      const phase = ((angle % 360) + 360) % 360 / 360;
      const style = this.artFrame.style;
      const delay = (-phase * duration) + "s";

      // Cambiar solo animation-delay no siempre reinicia la instancia CSS:
      // Chrome/Edge pueden conservar el tiempo interno anterior y volver a 0°.
      // Desactivar el nombre, forzar un reflow y restaurarlo crea una instancia
      // nueva que empieza exactamente en la fase guardada.
      style.animationDelay = delay;
      style.animationName = "none";
      void this.artFrame.offsetWidth;
      style.animationName = "";
      void this.artFrame.offsetWidth;
    } catch (_) { /* el giro visual no debe interrumpir el gesto */ }
  };

  // ---------- Puntero (disco) ----------

  proto._onPointerDown = function (e) {
    if (this.drag) return; // ignora un segundo puntero
    if (this.manualArm.active) return;
    if (this._isArmTarget(e)) return; // el brazo tiene su propio gesto
    if (e.pointerType === "mouse" && e.button !== 0) return;

    clearTimeout(this._suppressTimer);
    this.suppressNextClick = false;

    // Un gesto nuevo cancela inercia/backspin y parte de la posición actual.
    this.cancelBackspin({ resume: true });
    const cancelled = this._stopInertia(false);
    const inherited = cancelled ? !!cancelled.wasPlaying : null;

    // Fuerza lectura fresca: el layout pudo cambiar desde el último evento.
    this._geomDirty = true;
    this._readGeometry();

    try { this.artFrame.focus({ preventScroll: true }); } catch (_) { /* noop */ }

    // El centro se resuelve por clic; no inicia arrastre.
    if (this._isCenter(e) || !isValidDuration(this.audio.duration)) {
      if (inherited) this._play(); // la inercia había pausado el audio: se devuelve una vez
      return;
    }

    this.drag = {
      pointerId: e.pointerId,
      downX: e.clientX,
      downY: e.clientY,
      active: false,
      previousAngle: 0,
      accumulated: 0,
      startTime: 0,
      wasPlaying: false,
      inherited: inherited,

      downAngle: this._pointerAngle(e),
      downTs: this._eventTime(e),

      previousTimestamp: 0,
      lastMoveTime: 0,
      pendingDelta: 0,
      angularVelocity: 0,
      smoothedVelocity: 0,
      velocitySeeded: false,
      direction: 1,
      scratchActive: false,
      scratchAudioPlaying: false,   // true solo si el <audio> hizo de respaldo del scratch
      headPosition: null,           // última posición de lectura del motor (continuidad)
      originalPlaybackRate: null,
      vinylAngle: 0
    };
    try { this.artFrame.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }

    // Al tocar el disco el contexto de audio se despierta ya (gesto del usuario):
    // reanuda, calienta la salida y asegura el buffer. El primer sonido no paga
    // el coste de `resume()` ni de la primera creación de nodos.
    if (this.babyScratch && this.opts.scratchEnabled && typeof this.babyScratch.warm === "function") {
      try { this.babyScratch.warm(this.audio.currentSrc || this.audio.src); } catch (_) { /* noop */ }
    }
  };

  proto._onPointerMove = function (e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) {
      if (!d && (e.pointerType === "mouse" || e.pointerType === "pen")) {
        this._readGeometry();
        this._setHoverCenter(this._isCenter(e));
      }
      return;
    }

    const duration = this.audio.duration;
    if (!isValidDuration(duration)) { this._cancelDrag(false); return; }

    // Varias muestras por evento: con pointermove el navegador junta en un solo
    // evento todo lo ocurrido en el frame; getCoalescedEvents() las devuelve.
    let list = null;
    if (this.opts.coalescedPointerEvents !== false && typeof e.getCoalescedEvents === "function") {
      try { list = e.getCoalescedEvents(); } catch (_) { list = null; }
    }
    if (!list || !list.length) list = [e];
    for (let i = 0; i < list.length; i++) {
      if (this.drag !== d) break; // el gesto pudo terminar dentro del procesado
      this._processDragMove(d, list[i], duration);
    }
  };

  proto._processDragMove = function (d, e, duration) {
    const ts = this._eventTime(e);

    if (!d.active) {
      if (!this._beginDragMove(d, e, ts)) return;
      this._updateDragVelocity(d, ts);
      return;
    }

    const angle = this._pointerAngle(e);
    const delta = shortestAngleDelta(angle, d.previousAngle);
    d.accumulated += delta * this._scratchSeekMultiplier();
    this._updateDragVisualState(d, delta);
    d.previousAngle = angle;
    d.pendingDelta += delta;
    if (delta !== 0) d.lastMoveTime = ts;
    this._updateDragVelocity(d, ts);
    this._applyDragSeek(d, duration);
  };

  proto._beginDragMove = function (d, e, ts) {
    const moved = Math.hypot(e.clientX - d.downX, e.clientY - d.downY);
    if (moved < this.opts.dragThresholdPx) return false;
    // Arranca el arrastre. La referencia de POSICIÓN se toma AQUÍ (no en
    // pointerdown) para que no haya salto por la distancia ya recorrida.
    d.active = true;
    d.wasPlaying = d.inherited !== null ? d.inherited : isPlaying(this.audio);
    d.startTime = this.audio.currentTime || 0;
    d.vinylAngle = this._readVinylAngle();
    this.visualStates.scratch = {
      active: true,
      angle: d.vinylAngle,
      origin: d.wasPlaying ? "playing" : "paused"
    };
    this._setVinylScratchAngle(d.vinylAngle);
    d.previousAngle = this._pointerAngle(e);
    d.accumulated = 0;
    d.lastMoveTime = ts;
    // La VELOCIDAD sí cuenta el recorrido desde pointerdown.
    if (ts - d.downTs <= 120) {
      d.pendingDelta = shortestAngleDelta(d.previousAngle, d.downAngle);
      d.previousTimestamp = d.downTs;
    } else {
      d.pendingDelta = 0;
      d.previousTimestamp = ts;
    }
    this._updateDragVisualState(d, d.pendingDelta);
    this._setHoverCenter(false);
    this.artFrame.classList.add("is-dragging", "is-seeking");
    if (this._overlay) this._overlay.classList.add("is-active");
    if (d.wasPlaying && !this.audio.paused) this._pause();
    return true;
  };

  proto._updateDragVisualState = function (d, deltaRadians) {
    d.vinylAngle += deltaRadians * 180 / Math.PI;
    this.visualStates.scratch.angle = d.vinylAngle;
    this._setVinylScratchAngle(d.vinylAngle);
  };

  proto._updateDragVelocity = function (d, ts) {
    this._updateVelocity(d, ts);
  };

  proto._applyDragSeek = function (d, duration) {
    const secondsPerRadian = this._secondsPerRadian(duration);
    // Recorta el acumulado al rango alcanzable: al invertir el giro tras
    // chocar con 0 o con el final, la respuesta es inmediata.
    const lo = -d.startTime / secondsPerRadian;
    const hi = (duration - d.startTime) / secondsPerRadian;
    d.accumulated = clamp(d.accumulated, lo, hi);

    // El motor ya recibe su velocidad (con la curva del perfil) desde
    // _updateScratch -> _applyScratchAudio.
    this._queueSeek(clamp(d.startTime + d.accumulated * secondsPerRadian, 0, duration));
  };

  proto._onPointerUp = function (e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this._endDrag(true, this._eventTime(e));
  };

  // Cancelar y soltar cierran el gesto igual (reanudando si procede).
  proto._onPointerCancel = proto._onPointerUp;

  proto._endDrag = function (resume, ts) {
    const d = this.drag;
    if (!d) return;
    this.drag = null; // primero: así lostpointercapture no reentra
    this._cleanupDragPointer(d);
    this._finishDragVisualState(d);
    const scratchPlaying = this._finishDragAudio(d);
    this._finishDragInertia(d, resume, ts, scratchPlaying);
  };

  proto._cleanupDragPointer = function (d) {
    this._flushSeek();
    this._clearScratchIdle();
    try {
      if (this.artFrame.hasPointerCapture && this.artFrame.hasPointerCapture(d.pointerId)) {
        this.artFrame.releasePointerCapture(d.pointerId);
      }
    } catch (_) { /* noop */ }
  };

  proto._finishDragVisualState = function (d) {

    // Primero sincroniza la fase CSS con el último ángulo manual; si se quita
    // `is-seeking` antes, la portada puede reaparecer en su posición inicial.
    if (d.active) {
      this._preserveVinylAnimationPhase(d.vinylAngle);
      const scratchOrigin = this.visualStates.scratch.origin || (d.wasPlaying ? "playing" : "paused");
      this.visualStates.scratch.active = false;
      this.visualStates.scratch.angle = d.vinylAngle;
      if (scratchOrigin === "playing") this.visualStates.playing = d.vinylAngle;
      else this.visualStates.paused = d.vinylAngle;
      this.visualStates.restored = null;
      if (scratchOrigin === "playing") this.enterPlayingVisualState(d.vinylAngle);
      else this.enterPausedVisualState(d.vinylAngle);
    }
    this.visualStates.scratch.active = false;
    this.visualStates.scratch.origin = null;
    this.artFrame.classList.remove("is-dragging", "is-seeking");
    if (this._overlay) this._overlay.classList.remove("is-active");

  };

  proto._finishDragAudio = function (d) {
    // Fin del scratch. Si el scratch había reanudado el audio, lo decidimos en
    // la fase de inercia para no encadenar pause() + play().
    const scratchPlaying = d.scratchAudioPlaying;
    this._endScratch(d, false);
    return scratchPlaying;
  };

  proto._finishDragInertia = function (d, resume, ts, scratchPlaying) {
    // Velocidad final: si el puntero llevaba quieto un rato, no hay inercia.
    const endTs = isNum(ts) ? ts : nowMs();
    const velocity = endTs - d.lastMoveTime > this.opts.inertiaStaleMs ? 0 : d.smoothedVelocity;

    if (d.active) {
      // Ese arrastre no debe convertirse en un clic de play/pausa.
      this.suppressNextClick = true;
      clearTimeout(this._suppressTimer);
      this._suppressTimer = setTimeout(() => { this.suppressNextClick = false; }, 120);

      if (resume) {
        if (this._startInertia(velocity, d.wasPlaying)) {
          if (scratchPlaying) this._pause(); // la inercia avanza con el audio en pausa
          return;
        }
        if (d.wasPlaying && !scratchPlaying) this._play();
      }
      // Sin `resume` (cambio de canción, destroy) no se toca play/pause.
    } else if (resume && d.inherited) {
      this._play(); // pointerdown sin arrastre tras una inercia que había pausado
    }
  };

  proto._cancelDrag = function (resume) {
    if (this.drag) this._endDrag(resume);
    this._cancelRaf();
    this._pendingTime = null;
  };

  // ---------- Scratch ----------

  proto._scratchSeekMultiplier = function () {
    if (!this.advancedScratch || !this.advancedScratch.enabled) return 1;
    return clamp(Number(this.advancedScratch.seekMultiplier) || 1, 0.1, 4);
  };

  proto._scratchResponse = function (velocity) {
    const o = this.opts;
    const gain = clamp(Number(o.scratchResponseGain) || 1, 0.05, 8);
    const exponent = clamp(Number(o.scratchCurveExponent) || 1, 0.25, 3);
    const magnitude = Math.pow(Math.abs(velocity), exponent) * gain;
    return (velocity < 0 ? -1 : 1) * clamp(magnitude, 0, o.velocityClamp);
  };

  proto._applyScratchProfile = function (profile) {
    const p = SCRATCH_PROFILES[profile];
    if (!p) return false;
    this.opts.scratchProfile = profile;
    this.opts.scratchCurveExponent = p.exponent;
    this.opts.scratchResponseGain = p.gain;
    this.opts.scratchSeekMultiplier = p.seek;
    if (this.advancedScratch) {
      this.advancedScratch.profile = profile;
      this.advancedScratch.seekMultiplier = p.seek;
    }
    return true;
  };

  /** Velocidad angular real (rad/s) = delta angular normalizado / delta tiempo. */
  proto._updateVelocity = function (d, ts) {
    const dtMs = ts - d.previousTimestamp;
    if (dtMs < 0) { d.previousTimestamp = ts; return; }      // reloj retrocedió
    if (dtMs < this.opts.velocityMinDtMs) return;            // acumula en pendingDelta
    const lim = this.opts.velocityClamp;
    const raw = clamp(d.pendingDelta / (dtMs / 1000), -lim, lim);
    d.pendingDelta = 0;
    d.previousTimestamp = ts;
    d.angularVelocity = raw;
    if (!d.velocitySeeded) {
      // Primera muestra: se toma tal cual. Partir de 0 con un EMA de 0.22 daba
      // solo el 22 % de la velocidad real y obligaba a esperar varios eventos.
      d.smoothedVelocity = raw;
      d.velocitySeeded = true;
    } else {
      // Ataque rápido (acelerar o invertir) y caída más suave (frenar). Los
      // coeficientes están definidos por evento de ~16 ms; se convierten a
      // tiempo para que dependan poco de la frecuencia de muestreo.
      const o = this.opts;
      const release = clamp(o.scratchSmoothing, 0, 1);
      const attack = clamp(isNum(o.scratchAttackSmoothing) ? o.scratchAttackSmoothing : release, 0, 1);
      const accelerating = Math.abs(raw) >= Math.abs(d.smoothedVelocity) || raw * d.smoothedVelocity < 0;
      const s = accelerating ? attack : release;
      const alpha = 1 - Math.pow(1 - s, dtMs / 16);
      d.smoothedVelocity = d.smoothedVelocity + (raw - d.smoothedVelocity) * alpha;
    }
    d.direction = d.smoothedVelocity >= 0 ? 1 : -1;
    this._updateScratch(d);
  };

  /** Histéresis: se enciende con |v| >= start y se apaga con |v| <= stop. */
  proto._updateScratch = function (d) {
    if (!this.opts.scratchEnabled) return;
    const v = Math.abs(d.smoothedVelocity);
    this.advancedScratch.rawVelocity = d.smoothedVelocity;
    this.advancedScratch.responseVelocity = this._scratchResponse(d.smoothedVelocity);
    if (!d.scratchActive) {
      if (v >= this.opts.scratchStartVelocity) this._startScratch(d);
    } else if (v <= this.opts.scratchStopVelocity) {
      this._endScratch(d, true);
      return;
    }
    if (d.scratchActive) {
      this.scratchVelocity = d.smoothedVelocity;
      if (d.direction !== this.scratchDirection) {
        this.scratchDirection = d.direction;
        this._setScratchClasses(true, d.direction);
      }
      this._applyScratchAudio(d);
      this._armScratchIdle();
    }
  };

  proto._startScratch = function (d) {
    d.scratchActive = true;
    this.isScratching = true;
    this.scratchDirection = d.direction;
    this.scratchVelocity = d.smoothedVelocity;

    // Guarda la velocidad normal ANTES de tocarla.
    if (this._savedRate === null) this._savedRate = this.audio.playbackRate || 1;
    d.originalPlaybackRate = this._savedRate;

    // El elemento <audio> se mantiene pausado: BabyScratchEngine lee el
    // AudioBuffer con una voz continua (con buffer invertido para el sentido
    // inverso). `start()` es síncrono: la voz suena en este mismo evento.
    if (d.wasPlaying || this.opts.scratchWhenPaused) {
      if (!this.audio.paused) this._pause();
      // Continuidad: si el scratch ya había sonado en este gesto, sigue desde
      // donde quedó la cabeza de lectura y no desde donde empezó el arrastre.
      const position = isNum(d.headPosition) ? d.headPosition : (d.startTime || this.audio.currentTime || 0);
      let ready = false;
      if (this.babyScratch) {
        try {
          ready = !!this.babyScratch.start(position, this._scratchResponse(d.smoothedVelocity));
        } catch (_) { ready = false; }
      }
      // Respaldo: buffer aún sin decodificar => que suene el <audio> mientras llega.
      if (!ready && d.wasPlaying) {
        d.scratchAudioPlaying = true;
        this._play();
      }
    }
    this._setScratchClasses(true, d.direction);
  };

  /**
   * Fin del scratch. `pauseAudio` => si el scratch había reanudado el audio, se
   * vuelve a pausar (el arrastre normal mantiene el audio en pausa).
   */
  proto._endScratch = function (d, pauseAudio) {
    this._clearScratchIdle();
    const was = d && d.scratchActive;
    if (d) d.scratchActive = false;
    this._restoreRate();
    this.isScratching = false;
    this.scratchDirection = 0;
    this.scratchVelocity = 0;
    this._setScratchClasses(false, 0);
    this._resetVinylFx();
    if (this.babyScratch) {
      // Guarda dónde quedó la cabeza de lectura para retomar sin saltos.
      if (d && was && typeof this.babyScratch.isActive === "function" && this.babyScratch.isActive()) {
        d.headPosition = this.babyScratch.getPosition();
      }
      this.babyScratch.stop();
    }
    if (pauseAudio && d && d.scratchAudioPlaying) {
      d.scratchAudioPlaying = false;
      this._pause();
    }
    if (was) this._emitScratch(false, 0, 0, 1);
  };

  /**
   * Respuesta de audio. playbackRate nunca es negativo: el sentido inverso se
   * resuelve con currentTime (ya lo hace el arrastre) y deja un hook para un
   * futuro audio invertido (`_onScratchReverse` / opts.onScratch).
   */
  proto._applyScratchAudio = function (d) {
    const o = this.opts;
    const responseVelocity = this.advancedScratch && this.advancedScratch.enabled
      ? this._scratchResponse(d.smoothedVelocity) : d.smoothedVelocity;
    const rate = clamp(1 + Math.abs(responseVelocity) * o.scratchRateFactor, o.scratchMinRate, o.scratchMaxRate);
    const position = this._pendingTime !== null ? this._pendingTime : (this.audio.currentTime || 0);
    if (this.babyScratch) this.babyScratch.update(position, responseVelocity);
    this._emitScratch(true, d.direction, responseVelocity, rate, d.smoothedVelocity);
  };

  /** Hook vacío: aquí se conectará un buffer invertido en el futuro. */
  proto._onScratchReverse = function (/* state */) {};

  proto._emitScratch = function (active, direction, velocity, rate, rawVelocity) {
    if (typeof this.opts.onScratch !== "function") return;
    try {
      this.opts.onScratch({
        active: active,
        direction: direction,
        velocity: velocity,
        rawVelocity: isNum(rawVelocity) ? rawVelocity : velocity,
        rate: rate,
        profile: this.advancedScratch && this.advancedScratch.profile
      });
    } catch (_) { /* un hook externo no debe romper el gesto */ }
  };

  proto._restoreRate = function () {
    if (this._savedRate !== null) {
      try { this.audio.playbackRate = this._savedRate || 1; } catch (_) { /* noop */ }
      this._savedRate = null;
    }
    this._lastRate = null;
  };

  proto._setVinylFx = function (state) {
    if (!this.audioGraph || typeof this.audioGraph.setVinylFx !== "function") return false;
    try { return this.audioGraph.setVinylFx(state) !== false; } catch (_) { return false; }
  };

  proto._resetVinylFx = function () {
    if (!this.audioGraph || typeof this.audioGraph.resetVinylFx !== "function") return false;
    try { return this.audioGraph.resetVinylFx() !== false; } catch (_) { return false; }
  };

  proto._armScratchIdle = function () {
    clearTimeout(this._scratchIdleTimer);
    this._scratchIdleTimer = setTimeout(() => {
      this._scratchIdleTimer = 0;
      const d = this.drag;
      if (d && d.scratchActive) {
        // Puntero quieto: el disco "se sujeta"; la velocidad cae a cero.
        d.smoothedVelocity = 0;
        d.pendingDelta = 0;
        this._endScratch(d, true);
      }
    }, this.opts.scratchIdleMs);
    // No mantener vivo un proceso Node al ejecutar los arneses; en navegador
    // los timers no tienen unref y esta rama simplemente no hace nada.
    if (this._scratchIdleTimer && typeof this._scratchIdleTimer.unref === "function") {
      this._scratchIdleTimer.unref();
    }
  };

  proto._clearScratchIdle = function () {
    clearTimeout(this._scratchIdleTimer);
    this._scratchIdleTimer = 0;
  };

  /** Clases en artFrame y, si se localiza de forma segura, en .art-wrap. */
  proto._setScratchClasses = function (on, direction) {
    for (const target of this._classTargets()) {
      const cl = target.classList;
      if (!on) {
        cl.remove.apply(cl, SCRATCH_CLASSES);
      } else {
        cl.add("is-scratching");
        cl.toggle("is-scratch-forward", direction > 0);
        cl.toggle("is-scratch-reverse", direction < 0);
      }
    }
  };

  // ---------- Inercia ----------

  /** Devuelve true si arrancó. velocity en rad/s (positivo = hacia delante en el tiempo). */
  proto._startInertia = function (velocity, wasPlaying) {
    const o = this.opts;
    if (!o.inertiaEnabled) return false;
    if (!isNum(velocity) || Math.abs(velocity) < o.inertiaMinVelocity) return false;
    if (!isValidDuration(this.audio.duration)) return false;
    if (!hasRaf()) return false;
    this._stopInertia(false); // jamás dos rAF a la vez
    this.inertia = {
      velocity: velocity,
      startedAt: null,         // se fija en el primer frame (mismo dominio de tiempo que rAF)
      lastTimestamp: null,
      wasPlaying: !!wasPlaying,
      startTime: this.audio.currentTime || 0
    };
    this._inertiaRaf = global.requestAnimationFrame((ts) => this._tickInertia(ts));
    return true;
  };

  proto._tickInertia = function (timestamp) {
    this._inertiaRaf = 0;
    const st = this.inertia;
    if (!st) return;
    const o = this.opts;
    const audio = this.audio;
    const duration = audio.duration;
    if (!isValidDuration(duration)) { this._stopInertia(false); return; }

    if (st.startedAt === null) { st.startedAt = timestamp; st.lastTimestamp = timestamp; }
    if (timestamp - st.startedAt > o.inertiaMaxDuration) { this._stopInertia(true); return; }

    const dt = clamp((timestamp - st.lastTimestamp) / 1000, 0, o.inertiaMaxStep);
    st.lastTimestamp = timestamp;

    const next = (audio.currentTime || 0) + st.velocity * dt * this._secondsPerRadian(duration);

    if (next <= 0) {                 // límite inferior: exacto y se detiene
      this._seekTo(0);
      this._stopInertia(true);
      return;
    }
    if (next >= duration) {          // límite superior: exacto; no se reanuda (play() en
      this._seekTo(duration);        // un medio terminado reiniciaría la pista desde 0)
      this._stopInertia(false);
      return;
    }
    this._seekTo(next);

    st.velocity *= Math.pow(o.inertiaFriction, dt * 60);
    if (Math.abs(st.velocity) < o.inertiaMinVelocity) { this._stopInertia(true); return; }

    this._inertiaRaf = global.requestAnimationFrame((ts) => this._tickInertia(ts));
  };

  /** Detiene la inercia. Devuelve el estado que tenía (o null). */
  proto._stopInertia = function (shouldResume) {
    const st = this.inertia;
    cancelRaf(this._inertiaRaf);
    this._inertiaRaf = 0;
    if (!st) return null;
    this.inertia = null;
    this._restoreRate();
    this._setScratchClasses(false, 0);
    if (shouldResume && st.wasPlaying) this._play(); // una sola vez
    return st;
  };

  // ---------- Fase 5: scratch avanzado ----------

  proto.setAdvancedScratchEnabled = function (enabled) {
    this.advancedScratch.enabled = enabled !== false;
    return this.advancedScratch.enabled;
  };

  proto.isAdvancedScratchEnabled = function () {
    return !!(this.advancedScratch && this.advancedScratch.enabled);
  };

  proto.setScratchProfile = function (profile) {
    return this._applyScratchProfile(String(profile || "").toLowerCase());
  };

  proto.getScratchProfile = function () {
    return this.advancedScratch ? this.advancedScratch.profile : "classic";
  };

  proto.getScratchState = function () {
    const adv = this.advancedScratch;
    return {
      enabled: this.isAdvancedScratchEnabled(),
      profile: this.getScratchProfile(),
      active: !!this.isScratching,
      direction: this.scratchDirection,
      velocity: adv ? adv.responseVelocity : this.scratchVelocity,
      rawVelocity: adv ? adv.rawVelocity : this.scratchVelocity,
      backspin: !!this.backspin
    };
  };

  proto._setBackspinFx = function (velocity, intensity) {
    this._setVinylFx({
      active: true,
      intensity: intensity,
      direction: velocity < 0 ? -1 : 1,
      profile: this.getScratchProfile(),
      backspin: true
    });
  };

  proto.triggerBackspin = function (options) {
    const o = this.opts;
    if (!o.backspinEnabled || !this.isAdvancedScratchEnabled() || this.disabled || this.drag || this.manualArm.active) return false;
    if (!isValidDuration(this.audio.duration) || !hasRaf()) return false;
    options = options || {};
    this.cancelBackspin({ resume: false });
    this._stopInertia(false);
    let velocity = isNum(options.velocity) ? options.velocity : -Math.abs(o.backspinInitialVelocity);
    if (velocity === 0) velocity = -Math.abs(o.backspinInitialVelocity);
    const wasPlaying = isPlaying(this.audio);
    this.backspin = {
      velocity: velocity,
      startedAt: null,
      lastTimestamp: null,
      duration: clamp(Number(options.durationMs) || o.backspinDurationMs, 40, 5000),
      wasPlaying: wasPlaying
    };
    if (wasPlaying) this._pause();
    this._setBackspinClass(true);
    this._setBackspinFx(velocity, 0.85);
    this._backspinRaf = global.requestAnimationFrame((ts) => this._tickBackspin(ts));
    return true;
  };

  proto._tickBackspin = function (timestamp) {
    this._backspinRaf = 0;
    const st = this.backspin;
    if (!st) return;
    const o = this.opts;
    const duration = this.audio.duration;
    if (!isValidDuration(duration)) { this.cancelBackspin({ resume: false }); return; }
    if (st.startedAt === null) { st.startedAt = timestamp; st.lastTimestamp = timestamp; }
    if (timestamp - st.startedAt >= st.duration) { this.cancelBackspin({ resume: true }); return; }
    const dt = clamp((timestamp - st.lastTimestamp) / 1000, 0, 0.08);
    st.lastTimestamp = timestamp;
    const next = (this.audio.currentTime || 0) + st.velocity * dt * this._secondsPerRadian(duration);
    if (next <= 0) { this._seekTo(0); this.cancelBackspin({ resume: true }); return; }
    if (next >= duration) { this._seekTo(duration); this.cancelBackspin({ resume: false }); return; }
    this._seekTo(next);
    this._setBackspinFx(st.velocity, clamp(Math.abs(st.velocity) / Math.max(o.backspinInitialVelocity, 0.001), 0, 1));
    st.velocity *= Math.pow(clamp(o.backspinFriction, 0.5, 0.999), dt * 60);
    if (Math.abs(st.velocity) < o.backspinMinVelocity) { this.cancelBackspin({ resume: true }); return; }
    this._backspinRaf = global.requestAnimationFrame((ts) => this._tickBackspin(ts));
  };

  proto.cancelBackspin = function (options) {
    const st = this.backspin;
    cancelRaf(this._backspinRaf);
    this._backspinRaf = 0;
    this.backspin = null;
    this._setBackspinClass(false);
    this._resetVinylFx();
    if (st && options && options.resume && st.wasPlaying) this._play();
    return st;
  };

  proto._setBackspinClass = function (on) {
    for (const target of this._classTargets()) target.classList.toggle("is-backspin", !!on);
  };

  // ---------- Clic ----------

  proto._onClick = function (e) {
    if (this._isArmTarget(e)) return;
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      clearTimeout(this._suppressTimer);
      return;
    }
    this._readGeometry();
    if (!this._isCenter(e)) return;
    this._togglePlay();
  };

  proto._setHoverCenter = function (on) {
    if (on === this._hoverCenter) return;
    this._hoverCenter = on;
    this.artFrame.classList.toggle("is-clickable", on);
  };

  // ---------- Teclado ----------

  proto._onKeyDown = function (e) {
    if (e.target !== this.artFrame) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const audio = this.audio;
    const duration = audio.duration;
    const validDuration = isValidDuration(duration);
    const step = e.shiftKey ? this.opts.keyStepShiftSeconds : this.opts.keyStepSeconds;
    const direction = KEY_SEEK_DIRECTION[e.key];

    // Una tecla durante la inercia la cancela (se devuelve el audio si sonaba).
    this._stopInertia(true);

    if (direction) {
      if (validDuration) this._seekTo(clamp((audio.currentTime || 0) + direction * step, 0, duration));
    } else if (e.key === "Home") {
      if (validDuration) this._seekTo(0);
    } else if (e.key === "End") {
      if (validDuration) this._seekTo(duration);
    } else if (e.key === " " || e.key === "Spacebar") {
      this._togglePlay();
    } else {
      return; // tecla no gestionada: no se bloquea ni se detiene su propagación
    }

    e.preventDefault();
    if (this.opts.stopKeyPropagation) e.stopPropagation();
  };

  // ---------- Seek (coalescido en un rAF solo mientras dura el arrastre) ----------

  proto._queueSeek = function (t) {
    this._pendingTime = t;
    if (this._rafId) return;
    if (!hasRaf()) { this._flushSeek(); return; }
    this._rafId = global.requestAnimationFrame(() => {
      this._rafId = 0;
      this._flushSeek();
    });
  };

  proto._flushSeek = function () {
    this._cancelRaf();
    if (this._pendingTime === null) return;
    const t = this._pendingTime;
    this._pendingTime = null;
    this._seekTo(t);
  };

  proto._cancelRaf = function () {
    cancelRaf(this._rafId);
    this._rafId = 0;
  };

  proto._seekTo = function (t) {
    const duration = this.audio.duration;
    if (!isValidDuration(duration)) return;
    t = clamp(t, 0, duration);
    if (typeof this.opts.seek === "function") this.opts.seek(t);
    else this.audio.currentTime = t;
    if (typeof this.opts.onSeek === "function") this.opts.onSeek(t);
    this._syncProgress();
  };

  // ---------- Reproducción (reutiliza el reproductor existente) ----------

  proto._play = function () {
    let result;
    if (typeof this.opts.play === "function") result = this.opts.play();
    else if (this.player && typeof this.player._startPlayback === "function") result = this.player._startPlayback();
    else if (this.player && typeof this.player.play === "function") {
      result = typeof this.player.currentIndex === "number"
        ? this.player.play(this.player.currentIndex)
        : this.player.play();
    }
    else result = this.audio.play();
    swallow(result);
    return result;
  };

  proto._pause = function () {
    let result;
    if (typeof this.opts.pause === "function") result = this.opts.pause();
    else if (this.player && typeof this.player.pause === "function") result = this.player.pause();
    else result = this.audio.pause();
    return result;
  };

  proto._togglePlay = function () {
    if (typeof this.opts.togglePlay === "function") {
      swallow(this.opts.togglePlay());
    } else if (this.player && typeof this.player.togglePlay === "function") {
      swallow(this.player.togglePlay());
    } else {
      if (!this.audio.currentSrc && !this.audio.src) return; // sin canción cargada
      if (this.audio.paused) this._play(); else this._pause();
    }
  };

  // ---------- Brazo manual ----------

  /**
   * Adaptador opcional (puede añadirse más adelante desde player.js):
   *   { setManualAngle(angle), beginManualControl(), endManualControl(), setManualHold(value) }
   * Cada método es opcional. Sin ellos se usa --tonearm-angle en el elemento.
   */
  proto.setTonearmAdapter = function (adapter) {
    this._armAdapter = adapter || null;
  };

  proto._armCtl = function () {
    return this._armAdapter || this.opts.tonearmController || null;
  };

  proto._armCall = function (name, arg) {
    const c = this._armCtl();
    if (c && typeof c[name] === "function") {
      try { c[name](arg); return true; } catch (_) { /* cae al fallback */ }
    }
    return false;
  };

  proto._armValue = function (name, arg) {
    const c = this._armCtl();
    if (c && typeof c[name] === "function") {
      try { return c[name](arg); } catch (_) { /* usa la geometría local */ }
    }
    return null;
  };

  proto._armRestAngle = function () {
    if (isNum(this.opts.armRestAngle)) return this.opts.armRestAngle;
    return this._readArmCssNumber("--rest", this.opts.armMinAngle);
  };

  proto._getTonearmPivot = function () {
    if (typeof this.opts.armPivot === "function") {
      const p = this.opts.armPivot();
      if (p && isNum(p.x) && isNum(p.y)) return { x: p.x, y: p.y };
    }
    const rect = this.tonearm.getBoundingClientRect();
    return {
      x: rect.left + rect.width * this.opts.armPivotXRatio,
      y: rect.top + rect.height * this.opts.armPivotYRatio
    };
  };

  /** Pivote del gesto en curso o, si no hay, el actual. */
  proto._currentArmPivot = function () {
    return this.manualArm.active && this._armPivot ? this._armPivot : this._getTonearmPivot();
  };

  proto._readArmAngle = function () {
    const o = this.opts;
    const bounds = this._getManualArmBounds();
    let v = NaN;
    try {
      if (typeof global.getComputedStyle === "function") {
        v = parseFloat(global.getComputedStyle(this.tonearm).getPropertyValue("--tonearm-angle"));
      }
    } catch (_) { /* noop */ }
    if (!isNum(v) && this.tonearm.style) v = parseFloat(this.tonearm.style.getPropertyValue("--tonearm-angle"));
    return isNum(v) ? clamp(v, bounds.min, bounds.max) : clamp(this._armRestAngle(), bounds.min, bounds.max);
  };

  proto._readArmCssNumber = function (name, fallback) {
    let v = NaN;
    try {
      if (typeof global.getComputedStyle === "function") {
        v = parseFloat(global.getComputedStyle(this.tonearm).getPropertyValue(name));
      }
    } catch (_) { /* noop */ }
    if (!isNum(v) && this.tonearm && this.tonearm.style) {
      v = parseFloat(this.tonearm.style.getPropertyValue(name));
    }
    return isNum(v) ? v : fallback;
  };

  proto._getArmReach = function () {
    const rect = this.tonearm.getBoundingClientRect();
    const cssReach = this._readArmCssNumber("--arm-reach", NaN);
    return isNum(cssReach) && rect.width > 0
      ? rect.width * cssReach
      : this.opts.armReachRatio * this._radius;
  };

  /** Punto de la aguja en pantalla para un ángulo del brazo. */
  proto._getNeedlePoint = function (pivot, angleDeg) {
    if (typeof this.opts.armNeedlePoint === "function") {
      const p = this.opts.armNeedlePoint(angleDeg, pivot);
      if (p && isNum(p.x) && isNum(p.y)) return { x: p.x, y: p.y };
    }
    const reach = this._getArmReach();
    const dir = (angleDeg + this.opts.armZeroAngleDeg) * DEG;
    return { x: pivot.x + Math.cos(dir) * reach, y: pivot.y + Math.sin(dir) * reach };
  };

  proto._getManualArmBounds = function () {
    const o = this.opts;
    const fallback = { min: o.armMinAngle, max: o.armMaxAngle };
    const shared = this._armValue("getManualArmBounds");
    if (shared && isNum(shared.min) && isNum(shared.max) && shared.min < shared.max) return shared;
    this._readGeometry();
    if (!(this._radius > 0)) return fallback;

    const pivot = this._currentArmPivot();
    const reach = this._getArmReach();
    if (!pivot || !isNum(reach) || reach <= 0) return fallback;

    const dx = this._cx - pivot.x;
    const dy = this._cy - pivot.y;
    const distance = Math.hypot(dx, dy);
    if (!isNum(distance) || distance <= 0) return fallback;

    const outer = this._readArmCssNumber("--groove-start", o.armRecordOuterRatio);
    const inner = this._readArmCssNumber("--groove-end", o.armRecordInnerRatio);
    const phi = Math.atan2(dy, dx);
    const minReach = Math.abs(distance - reach) + 0.5;
    const maxReach = distance + reach - 0.5;
    const angleForRatio = (ratio) => {
      const r = clamp(this._radius * ratio, minReach, maxReach);
      const cos = (distance * distance + reach * reach - r * r) / (2 * distance * reach);
      return phi - Math.acos(clamp(cos, -1, 1));
    };

    const angles = [
      this._armRestAngle() * DEG,
      angleForRatio(outer),
      angleForRatio(inner)
    ].filter(isNum);
    if (angles.length < 2) return fallback;

    const margin = 2 * DEG;
    return {
      min: Math.min.apply(Math, angles) / DEG - margin / DEG,
      max: Math.max.apply(Math, angles) / DEG + margin / DEG
    };
  };

  /**
   * Zona bajo la aguja: "rest" | "outer" | "record" | "label" | "invalid".
   * progress: 0 (surco exterior) .. 1 (interior). Sin parámetro usa el ángulo actual.
   */
  proto._getArmDropZone = function (angleDeg) {
    const o = this.opts;
    const invalid = { zone: "invalid", progress: 0, radiusRatio: 0, point: { x: NaN, y: NaN } };
    if (!this.tonearm) return invalid;
    const angle = isNum(angleDeg) ? angleDeg : this.manualArm.currentArmAngle;
    if (!isNum(angle)) return invalid;

    const shared = this._armValue("getManualDropZone", angle);
    if (shared && typeof shared.zone === "string" && isNum(shared.progress)) return shared;

    this._readGeometry();
    if (!(this._radius > 0)) return invalid;
    const pt = this._getNeedlePoint(this._currentArmPivot(), angle);
    if (!isNum(pt.x) || !isNum(pt.y)) return invalid;

    const ratio = Math.hypot(pt.x - this._cx, pt.y - this._cy) / this._radius;
    const inner = this._readArmCssNumber("--groove-end", o.armRecordInnerRatio);
    const outer = this._readArmCssNumber("--groove-start", o.armRecordOuterRatio);
    const out = { zone: "invalid", progress: 0, radiusRatio: ratio, point: pt };

    if (ratio > outer) {
      out.zone = angle <= this._armRestAngle() + o.armRestTolerance ? "rest" : "outer";
      return out;
    }
    if (ratio < o.armCenterDeadZone) return out; // junto al eje: posición imposible
    if (ratio < Math.max(o.armLabelRatio, inner) - 1e-4) {
      out.zone = "label";
      out.progress = 1;
      return out;
    }
    out.zone = "record";
    out.progress = clamp((outer - ratio) / (outer - inner), 0, 1);
    return out;
  };

  /** Ángulo (dentro de [armMin, armMax]) cuya aguja queda más cerca de `ratio` del radio. */
  proto._angleForRadiusRatio = function (ratio) {
    const o = this.opts;
    const bounds = this._getManualArmBounds();
    this._readGeometry();
    const pivot = this._currentArmPivot();
    let best = bounds.min;
    let bestErr = Infinity;
    for (let a = bounds.min; a <= bounds.max + 1e-9; a += 0.25) {
      const p = this._getNeedlePoint(pivot, a);
      const err = Math.abs(Math.hypot(p.x - this._cx, p.y - this._cy) / this._radius - ratio);
      if (err < bestErr) { bestErr = err; best = a; }
    }
    return best;
  };

  proto._applyArmAngle = function (angle, force) {
    if (!isNum(angle)) return;
    if (!force && isNum(this._armAppliedAngle) &&
        Math.abs(angle - this._armAppliedAngle) < this.opts.armMinMoveDeg) return;
    this._armAppliedAngle = angle;
    if (!this._armCall("setManualAngle", angle) && this.tonearm && this.tonearm.style) {
      this.tonearm.style.setProperty("--tonearm-angle", angle + "deg");
    }
  };

  proto._restoreArmAutomatic = function () {
    this._armCall("setManualHold", false);
    const viaAdapter = this._armCall("endManualControl");
    if (!viaAdapter && this.tonearm && this.tonearm.style && this._armSavedProp !== null) {
      if (this._armSavedProp === "") this.tonearm.style.removeProperty("--tonearm-angle");
      else this.tonearm.style.setProperty("--tonearm-angle", this._armSavedProp);
    }
    this._armSavedProp = null;
    this._armAppliedAngle = NaN;
  };

  proto._setArmVisual = function (state, f) {
    const t = this.tonearm;
    if (!t) return;
    f = f || {};
    t.classList.toggle("is-manual", !!f.manual);
    t.classList.toggle("is-lifted", !!f.lifted);
    t.classList.toggle("is-on-record", !!f.onRecord);
    t.classList.toggle("is-dragging", !!f.dragging);
    if (state) t.dataset.state = state; else delete t.dataset.state;
  };

  proto._resetArmVisual = function () {
    if (this.tonearm) this._setArmVisual(null, null);
  };

  proto._releaseArmCapture = function (pointerId) {
    try {
      if (this.tonearm && this.tonearm.hasPointerCapture && this.tonearm.hasPointerCapture(pointerId)) {
        this.tonearm.releasePointerCapture(pointerId);
      }
    } catch (_) { /* noop */ }
  };

  /** Inicio del control manual. `info`: { pointerId, clientX, clientY }. */
  proto.beginManualArm = function (info) {
    if (this.disabled || !this.tonearm || !this.opts.manualArmEnabled) return false;
    const m = this.manualArm;
    if (m.active) return false;
    info = info || {};

    // Cancela inercia y conserva si sonaba antes de tomar el brazo.
    // El audio no se pausa: el brazo se comporta como una aguja de DJ y la
    // reproducción continúa mientras el usuario busca una nueva posición.
    const cancelled = this._stopInertia(false);
    const wasPlaying = cancelled ? !!cancelled.wasPlaying : isPlaying(this.audio);

    this._geomDirty = true;
    this._readGeometry();
    this._armPivot = this._getTonearmPivot();

    this._armSavedProp = this.tonearm.style ? this.tonearm.style.getPropertyValue("--tonearm-angle") : "";
    const startArm = this._readArmAngle();

    m.active = true;
    m.pointerId = isNum(info.pointerId) ? info.pointerId : null;
    m.startPointerAngle = (isNum(info.clientX) && isNum(info.clientY))
      ? Math.atan2(info.clientY - this._armPivot.y, info.clientX - this._armPivot.x)
      : 0;
    m.previousPointerAngle = m.startPointerAngle;
    m.startArmAngle = startArm;
    m.currentArmAngle = startArm;
    m.wasPlaying = wasPlaying;
    m.onRecord = false;
    m.lifted = true;
    this._armAccum = 0;
    this._armAppliedAngle = NaN;

    if (m.pointerId !== null) {
      try { this.tonearm.setPointerCapture(m.pointerId); } catch (_) { /* noop */ }
    }
    this._armCall("beginManualControl");
    this._armCall("setManualHold", true);
    this._setArmVisual("manual-dragging", { manual: true, lifted: true, dragging: true });
    return true; // no se toca audio.currentTime
  };

  /**
   * Suelta el brazo y aplica la zona. options: { angle?: grados }.
   * Devuelve la información de zona usada o null si no había gesto.
   */
  proto.endManualArm = function (options) {
    const m = this.manualArm;
    if (!m.active) return null;
    options = options || {};
    const o = this.opts;
    if (isNum(options.angle)) {
      const bounds = this._getManualArmBounds();
      m.currentArmAngle = clamp(options.angle, bounds.min, bounds.max);
    }

    const info = this._getArmDropZone();
    const pointerId = m.pointerId;
    const wasPlaying = m.wasPlaying;
    m.active = false;          // primero: lostpointercapture no reentra
    m.lifted = false;
    this._releaseArmCapture(pointerId);
    m.pointerId = null;

    const duration = this.audio.duration;
    const zone = info.zone;

    if (zone === "record" || zone === "label") {
      let progress = info.progress;
      if (zone === "label") {
        // Nunca dejar la aguja sobre la etiqueta: surco interior más cercano.
        const innerRatio = this._readArmCssNumber("--groove-end", o.armRecordInnerRatio);
        const snapped = this._angleForRadiusRatio(innerRatio);
        m.currentArmAngle = snapped;
        this._applyArmAngle(snapped, true);
        progress = 1;
      }
      progress = clamp(progress, 0, o.armMaxProgress);
      if (isValidDuration(duration)) this._seekTo(progress * duration);
      m.onRecord = true;
      // La aguja se queda donde se soltó; el brazo automático retoma el control.
      this._armCall("setManualHold", false);
      this._armCall("endManualControl");
      this._armSavedProp = null;
      this._setArmVisual("on-record", { onRecord: true });
      if (wasPlaying && this.audio.paused) this._play(); // normalmente ya sigue sonando
    } else {
      // rest / outer / invalid: vuelve al soporte sin detener la reproducción.
      m.onRecord = false;
      this._restoreArmAutomatic();
      this._setArmVisual("rest", {});
    }
    return info;
  };

  /** Cancela el control manual sin aplicar zona. options: { resume } (por defecto false). */
  proto.cancelManualArm = function (options) {
    const m = this.manualArm;
    if (!m.active) {
      // Estado visual residual (p. ej. "on-record") se limpia en cambios de canción.
      if (this.tonearm && this.tonearm.dataset && this.tonearm.dataset.state) this._resetArmVisual();
      return false;
    }
    const resume = !!(options && options.resume);
    const pointerId = m.pointerId;
    const wasPlaying = m.wasPlaying;
    m.active = false;
    m.lifted = false;
    m.onRecord = false;
    this._releaseArmCapture(pointerId);
    m.pointerId = null;
    this._restoreArmAutomatic();
    this._resetArmVisual();
    this._restoreRate();
    if (resume && wasPlaying && this.audio.paused) this._play();
    return true;
  };

  proto.getManualArmState = function () {
    return Object.assign({}, this.manualArm);
  };

  // ---- Eventos del brazo ----

  proto._onArmPointerDown = function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (this.drag || this.manualArm.active) return;
    if (this.beginManualArm({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY })) {
      if (typeof e.preventDefault === "function") e.preventDefault();
    }
  };

  proto._onArmPointerMove = function (e) {
    const m = this.manualArm;
    if (!m.active || e.pointerId !== m.pointerId || !this._armPivot) return;
    const o = this.opts;

    const pa = Math.atan2(e.clientY - this._armPivot.y, e.clientX - this._armPivot.x);
    if (!isNum(pa)) return;
    this._armAccum += shortestAngleDelta(pa, m.previousPointerAngle);
    m.previousPointerAngle = pa;

    // Sin windup: el acumulado se recorta al rango alcanzable.
    const bounds = this._getManualArmBounds();
    const lo = (bounds.min - m.startArmAngle) * DEG;
    const hi = (bounds.max - m.startArmAngle) * DEG;
    this._armAccum = clamp(this._armAccum, lo, hi);

    const angle = clamp(m.startArmAngle + this._armAccum / DEG, bounds.min, bounds.max);
    if (!isNum(angle)) return;
    if (isNum(this._armAppliedAngle) && Math.abs(angle - this._armAppliedAngle) < o.armMinMoveDeg) return;

    m.currentArmAngle = angle;
    this._applyArmAngle(angle, false);

    const zone = this._getArmDropZone().zone;
    const onRecord = zone === "record" || zone === "label";
    if (onRecord !== m.onRecord) {
      m.onRecord = onRecord;
      this.tonearm.classList.toggle("is-on-record", onRecord);
    }
  };

  proto._onArmPointerUp = function (e) {
    const m = this.manualArm;
    if (!m.active || e.pointerId !== m.pointerId) return;
    this.endManualArm();
  };

  proto._onArmPointerCancel = function (e) {
    const m = this.manualArm;
    if (!m.active || e.pointerId !== m.pointerId) return;
    this.cancelManualArm({ resume: true }); // mismo tema: se devuelve el audio si sonaba
  };

  // ---------- Fase 3: performance DJ ----------

  proto._performanceReady = function () {
    return !this.disabled && this.performance && this.performance.enabled;
  };

  proto._performanceTime = function (value) {
    if (isNum(value)) return value;
    return isNum(this.audio.currentTime) ? this.audio.currentTime : 0;
  };

  /** Duración válida del audio o 0. */
  proto._safeDuration = function () {
    const d = this.audio.duration;
    return isValidDuration(d) ? d : 0;
  };

  proto._quantizePerformanceTime = function (value) {
    const q = Number(this.opts.loopQuantizeSeconds);
    return q > 0 && isFinite(q) ? Math.round(value / q) * q : value;
  };

  proto._validLoop = function (start, end) {
    const d = this.audio.duration;
    if (!isValidDuration(d) || !isNum(start) || !isNum(end)) return false;
    const min = Math.max(0, Number(this.opts.loopMinDuration) || 0);
    const max = Math.max(min, Number(this.opts.loopMaxDuration) || d);
    return start >= 0 && end <= d && end > start && end - start >= min && end - start <= max;
  };

  proto._commitLoop = function (start, end) {
    if (!this._performanceReady() || !this.opts.loopEnabled) return false;
    const duration = this.audio.duration;
    if (!isValidDuration(duration)) return false;
    start = clamp(this._quantizePerformanceTime(start), 0, duration);
    end = clamp(this._quantizePerformanceTime(end), 0, duration);
    if (!this._validLoop(start, end)) return false;
    this.performance.loop = { active: true, start: start, end: end, duration: end - start };
    return true;
  };

  proto.setLoopStart = function (time) {
    if (!this._performanceReady() || !this.opts.loopEnabled) return false;
    const end = this.performance.loop.end;
    const start = clamp(this._performanceTime(time), 0, this._safeDuration());
    if (isNum(end)) return this._commitLoop(start, end);
    this.performance.loop = { active: false, start: start, end: null, duration: 0 };
    return start;
  };

  proto.setLoopEnd = function (time) {
    if (!this._performanceReady() || !this.opts.loopEnabled) return false;
    const start = this.performance.loop.start;
    const end = clamp(this._performanceTime(time), 0, this._safeDuration());
    if (isNum(start)) return this._commitLoop(start, end);
    this.performance.loop = { active: false, start: null, end: end, duration: 0 };
    return end;
  };

  proto.setLoop = function (start, end) {
    return this._commitLoop(this._performanceTime(start), this._performanceTime(end));
  };

  proto.clearLoop = function () {
    const loop = this.performance && this.performance.loop;
    const had = !!(loop && (loop.start !== null || loop.end !== null));
    this.performance.loop = { active: false, start: null, end: null, duration: 0 };
    return had;
  };

  proto.toggleLoop = function () {
    const loop = this.performance.loop;
    if (!isNum(loop.start) || !isNum(loop.end)) return false;
    loop.active = !loop.active;
    return loop.active;
  };

  proto.isLoopActive = function () { return !!(this.performance.loop && this.performance.loop.active); };
  proto.getLoop = function () { return Object.assign({}, this.performance.loop); };

  proto._handlePerformanceTime = function () {
    if (!this._performanceReady()) return;
    const l = this.performance.loop;
    if (l.active && this._validLoop(l.start, l.end) && this.audio.currentTime >= l.end - 0.002) {
      this._seekTo(l.start);
    }
  };

  proto._handlePerformanceEnded = function () {
    const l = this.performance && this.performance.loop;
    if (this._performanceReady() && l && l.active && this._validLoop(l.start, l.end)) {
      this._seekTo(l.start);
      this._play();
      return true;
    }
    return false;
  };

  // API pública para que Player pueda consumir ended antes de repeat/next.
  proto.handleTrackEnded = function () {
    return this._handlePerformanceEnded();
  };

  proto._cueIndex = function (index) {
    index = Number(index);
    return Number.isInteger(index) && index >= 0 && index < Math.max(0, Math.floor(this.opts.hotCueCount));
  };

  proto.setHotCue = function (index, time) {
    if (!this._performanceReady() || !this.opts.hotCueEnabled || !this._cueIndex(index) || !isValidDuration(this.audio.duration)) return false;
    const t = clamp(this._performanceTime(time), 0, this.audio.duration);
    this.performance.hotCues[index] = { index: index, time: t, active: true, color: null };
    return true;
  };

  proto.captureHotCue = function (index) { return this.setHotCue(index); };

  proto.getHotCue = function (index) {
    if (!this._cueIndex(index) || !this.performance.hotCues[index]) return null;
    return Object.assign({}, this.performance.hotCues[index]);
  };

  proto.getHotCues = function () {
    const out = [];
    for (let i = 0; i < this.performance.hotCues.length; i++) out[i] = this.getHotCue(i);
    return out;
  };

  proto.clearHotCue = function (index) {
    if (!this._cueIndex(index)) return false;
    const had = !!this.performance.hotCues[index];
    delete this.performance.hotCues[index];
    return had;
  };

  proto.clearHotCues = function () {
    const had = this.performance.hotCues.some(function (cue) { return !!cue; });
    this.performance.hotCues = [];
    return had;
  };

  proto.triggerHotCue = function (index) {
    const cue = this.getHotCue(index);
    if (!cue || !isValidDuration(this.audio.duration)) return false;
    const playing = isPlaying(this.audio);
    this._cancelPerformanceRafs();
    this.endPitchBend();
    this._stopInertia(false);
    if (this.isScratching) return false;
    this._seekTo(cue.time);
    if (playing && this.audio.paused) this._play();
    return true;
  };

  proto.beginPitchBend = function (direction, amount) {
    const perf = this.performance;
    if (!this._performanceReady() || !this.opts.pitchBendEnabled || this.isScratching || perf.turntable.active || perf.momentary.active) return false;
    const p = perf.pitchBend;
    perf.rateOwned = true;
    if (!p.active) p.baseRate = positiveRate(this.audio);
    p.active = true;
    this.updatePitchBend(direction, amount);
    return true;
  };

  proto.updatePitchBend = function (direction, amount) {
    const o = this.opts;
    const p = this.performance.pitchBend;
    if (!p.active || this.isScratching) return false;
    p.direction = Number(direction) < 0 ? -1 : 1;
    p.amount = clamp(Number(amount) || 0, 0, 1);
    const range = p.direction > 0 ? o.pitchBendMaxRate - p.baseRate : p.baseRate - o.pitchBendMinRate;
    p.currentRate = clamp(p.baseRate + p.direction * p.amount * range, o.pitchBendMinRate, o.pitchBendMaxRate);
    if (p.currentRate > 0) this.audio.playbackRate = p.currentRate;
    return p.currentRate;
  };

  proto.endPitchBend = function () {
    const p = this.performance.pitchBend;
    if (!p.active) return false;
    cancelRaf(p.returnRaf);
    p.returnRaf = 0;
    const audio = this.audio;
    const from = isNum(audio.playbackRate) ? audio.playbackRate : p.baseRate;
    const started = nowMs();
    const duration = Math.max(0, Number(this.opts.pitchBendReturnMs) || 0);
    if (!duration || !hasRaf()) {
      audio.playbackRate = p.baseRate;
      p.active = false;
      p.currentRate = p.baseRate;
      return true;
    }
    const tick = (ts) => {
      if (!p.active) return;
      const u = clamp((ts - started) / duration, 0, 1);
      const rate = from + (p.baseRate - from) * u;
      if (rate > 0) audio.playbackRate = rate;
      if (u >= 1) {
        p.active = false;
        p.currentRate = p.baseRate;
        p.returnRaf = 0;
        audio.playbackRate = p.baseRate;
      } else {
        p.returnRaf = global.requestAnimationFrame(tick);
      }
    };
    p.returnRaf = global.requestAnimationFrame(tick);
    return true;
  };

  proto.getPitchBend = function () { return Object.assign({}, this.performance.pitchBend, { returnRaf: 0 }); };

  proto._cancelPerformanceRafs = function () {
    const p = this.performance;
    if (!p) return;
    cancelRaf(p.pitchBend.returnRaf);
    cancelRaf(p.turntable.raf);
    cancelRaf(p.momentary.raf);
    p.pitchBend.returnRaf = p.turntable.raf = p.momentary.raf = 0;
    p.pitchBend.active = false;
    p.turntable.active = false; p.turntable.mode = "normal";
    p.momentary.active = false; p.momentary.direction = 0;
  };

  proto._restorePerformanceRate = function () {
    const p = this.performance;
    if (!p || !p.rateOwned) return;
    const rate = p.pitchBend.baseRate || p.turntable.baseRate || p.momentary.baseRate || 1;
    if (rate > 0) { try { this.audio.playbackRate = rate; } catch (_) { /* noop */ } }
    p.pitchBend.currentRate = rate;
    p.rateOwned = false;
  };

  proto._animateTurntable = function (mode) {
    const audio = this.audio;
    const p = this.performance.turntable;
    const started = p.startedAt;
    const duration = p.duration;
    const minRate = this.opts.minTurntableRate;
    const tick = (ts) => {
      if (!p.active) return;
      const u = clamp((ts - started) / duration, 0, 1);
      const eased = mode === "brake" ? 1 - u : u;
      const rate = minRate + (p.baseRate - minRate) * eased;
      if (rate > 0) audio.playbackRate = rate;
      if (u >= 1) {
        p.raf = 0;
        p.active = false;
        p.mode = "normal";
        audio.playbackRate = p.baseRate;
        if (mode === "brake") this._pause();
      } else {
        p.raf = global.requestAnimationFrame(tick);
      }
    };
    p.raf = global.requestAnimationFrame(tick);
  };

  proto.brake = function () {
    if (!this._performanceReady() || !this.opts.brakeEnabled || this.isScratching) return false;
    const p = this.performance.turntable;
    this.performance.rateOwned = true;
    this._cancelPerformanceRafs();
    p.baseRate = positiveRate(this.audio);
    if (this.audio.paused) return false;
    p.mode = "brake";
    p.active = true;
    p.startedAt = nowMs();
    p.duration = Math.max(0, Number(this.opts.brakeDurationMs) || 0);
    if (!p.duration) { this._pause(); return true; }
    this._animateTurntable("brake");
    return true;
  };

  proto.startTurntable = function () {
    if (!this._performanceReady() || !this.opts.brakeEnabled || this.isScratching) return false;
    const p = this.performance.turntable;
    if (p.active && p.mode === "start") return true;
    this._cancelPerformanceRafs();
    this.performance.rateOwned = true;
    p.baseRate = 1;
    p.mode = "start";
    p.active = true;
    p.startedAt = nowMs();
    p.duration = Math.max(0, Number(this.opts.startDurationMs) || 0);
    this.audio.playbackRate = Math.max(0.01, this.opts.minTurntableRate);
    if (this.audio.paused) this._play();
    if (!p.duration) {
      this.audio.playbackRate = p.baseRate;
      p.active = false;
      p.mode = "normal";
      return true;
    }
    this._animateTurntable("start");
    return true;
  };

  proto.cancelTurntableMotion = function () {
    const active = this.performance.turntable.active;
    this._cancelPerformanceRafs();
    this._restorePerformanceRate();
    return active;
  };

  proto.getTurntableState = function () { return Object.assign({}, this.performance.turntable, { raf: 0 }); };

  proto.beginMomentary = function (direction, amount) {
    const perf = this.performance;
    if (!this._performanceReady() || !this.opts.momentaryEnabled || this.isScratching || perf.turntable.active) return false;
    const o = this.opts;
    const m = perf.momentary;
    perf.rateOwned = true;
    if (!m.active) {
      m.baseRate = positiveRate(this.audio);
      m.wasPlaying = !this.audio.paused;
    }
    m.active = true;
    m.direction = Number(direction) < 0 ? -1 : 1;
    m.amount = clamp(Number(amount) || 1, 0, 1);
    m.startedAt = nowMs();
    if (m.direction > 0) {
      this.audio.playbackRate = clamp(m.baseRate + m.amount * (o.momentaryMaxRate - m.baseRate), o.momentaryMinRate, o.momentaryMaxRate);
    } else {
      this._tickMomentary(nowMs());
    }
    return true;
  };

  proto.updateMomentary = function (direction, amount) { return this.beginMomentary(direction, amount); };

  proto._tickMomentary = function () {
    const m = this.performance.momentary;
    if (!m.active || m.direction >= 0) return;
    const duration = this.audio.duration;
    if (isValidDuration(duration)) {
      this._seekTo(clamp((this.audio.currentTime || 0) - 0.05 * m.amount, 0, duration));
    }
    if (hasRaf()) m.raf = global.requestAnimationFrame((ts) => this._tickMomentary(ts));
  };

  proto.endMomentary = function () {
    const m = this.performance.momentary;
    if (!m.active) return false;
    cancelRaf(m.raf);
    m.raf = 0;
    m.active = false;
    m.direction = 0;
    this.audio.playbackRate = m.baseRate || 1;
    return true;
  };

  proto.getMomentaryState = function () { return Object.assign({}, this.performance.momentary, { raf: 0 }); };

  proto.clearPerformanceState = function (options) {
    options = options || {};
    this._cancelPerformanceRafs();
    this._restorePerformanceRate();
    if (!options.keepLoop) this.clearLoop();
    if (!options.keepHotCues) this.clearHotCues();
  };

  proto.setPerformanceEnabled = function (enabled) {
    this.performance.enabled = !!enabled;
    if (!this.performance.enabled) this.clearPerformanceState();
    return this.performance.enabled;
  };

  proto.isPerformanceEnabled = function () { return !!this.performance.enabled; };

  proto.getPerformanceState = function () {
    return {
      enabled: this.performance.enabled,
      loop: this.getLoop(),
      hotCues: this.getHotCues(),
      pitchBend: this.getPitchBend(),
      turntable: this.getTurntableState(),
      momentary: this.getMomentaryState()
    };
  };

  // ---------- Indicador de posición ----------

  proto._createOverlay = function () {
    const host = this.artFrame.offsetParent || this.artFrame.parentElement;
    const doc = this.artFrame.ownerDocument;
    if (!host || !doc) return;
    const ring = doc.createElement("div");
    ring.className = "vinyl-progress-ring";
    ring.setAttribute("aria-hidden", "true");
    const marker = doc.createElement("span");
    marker.className = "vinyl-progress-marker";
    ring.appendChild(marker);
    host.appendChild(ring);
    this._overlay = ring;
    this._layoutOverlay();
  };

  /** Alinea el anillo con el disco. Solo se ejecuta al cambiar el tamaño. */
  proto._layoutOverlay = function () {
    const o = this._overlay;
    if (!o) return;
    const el = this.artFrame;
    o.style.left = el.offsetLeft + "px";
    o.style.top = el.offsetTop + "px";
    o.style.width = el.offsetWidth + "px";
    o.style.height = el.offsetHeight + "px";
  };

  proto._syncProgress = function () {
    const audio = this.audio;
    const duration = audio.duration;
    const valid = isValidDuration(duration);
    const p = valid ? clamp((audio.currentTime || 0) / duration, 0, 1) : 0;

    if (this._overlay) {
      this._overlay.classList.toggle("is-visible", valid);
      const rounded = Math.round(p * 10000) / 10000;
      if (rounded !== this._lastProgress) {
        this._lastProgress = rounded;
        this._overlay.style.setProperty("--vinyl-progress", String(rounded));
      }
    }

    const pct = Math.round(p * 100);
    if (pct !== this._lastPct) {
      this._lastPct = pct;
      this.artFrame.setAttribute("aria-valuenow", String(pct));
      this.artFrame.setAttribute(
        "aria-valuetext",
        valid ? formatTime(audio.currentTime) + " de " + formatTime(duration) : "Sin canción"
      );
    }
  };

  VinylInteraction.shortestAngleDelta = shortestAngleDelta;
  VinylInteraction.DEFAULTS = DEFAULTS;

  global.AuraVinylInteraction = VinylInteraction;
  if (typeof module !== "undefined" && module.exports) module.exports = VinylInteraction;
})(typeof window !== "undefined" ? window : globalThis);
