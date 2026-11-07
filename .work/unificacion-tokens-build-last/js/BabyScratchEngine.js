/* BabyScratchEngine.js — motor de scratch para AuraPlay Pro (v4 · extra high-end)
 *
 * Modelo: un plato de verdad. Hay UNA voz continua leyendo el audio y su
 * velocidad de lectura sigue la velocidad angular del disco:
 *
 *     rate = velocidad_angular (rad/s) / velocidad_del_plato (rad/s a 33⅓ rpm)
 *
 * Girar el disco a la velocidad de un vinilo real suena a 1x; más rápido sube
 * el tono, más lento lo baja, y detener la mano calla el sonido.
 *
 * ── Dos backends, elegidos solos ──────────────────────────────────────────
 *
 *  1) "worklet" (preferido): el núcleo corre en el hilo de audio (AudioWorklet).
 *     - Posición EXACTA a nivel de muestra (se acabó el modelo analítico).
 *     - Suavizado del rate muestra a muestra (sin k-rate ni cuantización de
 *       128 muestras) y compuerta/fundidos también por muestra.
 *     - Lectura en reversa directa: no hay buffer invertido, ni crossfades ni
 *       voces nuevas al cambiar de sentido (cero artefactos). La caché guarda
 *       1 copia por pista en vez de 2; el worklet retiene solo la pista activa.
 *     - Interpolación Hermite cúbica a rate ≤ 1 y sinc con ventana Hann
 *       (antialiasing real) a rate > 1: sin aliasing en scratches rápidos.
 *     - "Mano quieta" medida en el hilo de audio (sample-accurate, inmune a
 *       los temporizadores estrangulados de pestañas en segundo plano).
 *
 *  2) "legacy": el motor v3 con AudioBufferSourceNode (buffer invertido,
 *     crossfade al cambiar de sentido). Se usa solo si el navegador no tiene
 *     AudioWorklet o si el CSP bloquea los blob: URLs. Misma API, mismo sonido
 *     "de siempre".
 *
 * Además (v3): automatización limpia, fundidos modelados, carga cancelable,
 * bus con bloqueo de DC → paso bajo → limitador → volumen, reconfiguración en
 * caliente, eventos, diagnóstico y recuperación de contexto.
 *
 * API (100 % compatible con v2/v3):
 *   new BabyScratchEngine({ audio, audioGraph, ...opciones })
 *   warm(url) -> boolean               prepara contexto/bus/worklet (pointerdown)
 *   prepare(url) -> Promise<boolean>   decodifica y cachea
 *   start(position[, velocity]) -> boolean   false si aún no está listo
 *   update(position, velocity)         velocity en rad/s (con signo)
 *   stop() -> number                   posición final estimada (s)
 *   destroy()
 *   getPosition() / getRate() / isReady(url) / isActive()
 *   configure(opciones) · setVolume(0..2) · syncAudio()
 *   on(evento, fn) -> off() / off(evento, fn)
 *   getStats() / getLatency() / getBackend()
 *   BabyScratchEngine.clearCache() / .cacheBytes() / .supportsWorklet()
 *
 * Eventos: ready, error, start, stop, edge, backend, settled
 *   settled = posición EXACTA tras el fundido de salida (backend worklet).
 *
 * Opciones (todas opcionales):
 *   backend "auto" | "worklet" | "legacy"   (solo al crear)
 *   rpm 33.3333 · maxRate 8 · rateSmoothingMs 9 · holdMs 45 · idleReleaseMs 1500
 *   deadband 0.03 · gateFullRate 0.12 · fadeInMs 3 · swapFadeMs 6 · releaseMs 14
 *   outputGain 1.15 · toneHz 16000 (0 = off) · dcBlockHz 18 (0 = off)
 *   limiter true · volume 1 · followAudioVolume false · debug false
 *   onReady / onError / onEdge (callbacks)
 */
(function (global) {
  "use strict";

  const VERSION = "4.0.0";
  const WORKLET_NAME = "baby-scratch-processor-v4";
  const TWO_PI = Math.PI * 2;
  const GATE_TAU = 0.004;        // s · constante de la compuerta de baja velocidad
  const SWAP_START_RATE = 0.04;  // (legacy) rate con el que nace la voz nueva al invertir
  const EDGE_EPS = 0.002;        // s · margen de los extremos del buffer (legacy)

  const DEFAULTS = {
    backend: "auto",
    rpm: 33.3333,
    maxRate: 8,
    rateSmoothingMs: 9,
    holdMs: 45,
    idleReleaseMs: 1500,
    deadband: 0.03,
    gateFullRate: 0.12,
    fadeInMs: 3,
    swapFadeMs: 6,
    releaseMs: 14,
    outputGain: 1.15,
    toneHz: 16000,
    dcBlockHz: 18,
    limiter: true,
    volume: 1,
    followAudioVolume: false,
    debug: false
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function noop() {}

  function nowMs() {
    return (global.performance && typeof global.performance.now === "function")
      ? global.performance.now()
      : Date.now();
  }

  function yieldToMain() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /** decodeAudioData con promesa o callbacks (Safari antiguo). */
  function decode(ctx, data) {
    return new Promise(function (resolve, reject) {
      let p;
      try { p = ctx.decodeAudioData(data, resolve, reject); } catch (e) { reject(e); return; }
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
  }

  /**
   * (legacy) Parte del valor actual del modelo y persigue `target` con
   * constante `tau`. Mantiene la línea de tiempo corta y el modelo sincronizado.
   */
  function ramp(param, current, target, now, tau) {
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
      param.setTargetAtTime(target, now, tau);
    } catch (_) { /* noop */ }
  }

  // ======================================================================
  // Núcleo en el hilo de audio (AudioWorkletGlobalScope)
  //
  // Esta función NO se ejecuta en el hilo principal: se serializa con
  // toString() y se carga como módulo. Solo puede usar globales del
  // AudioWorkletGlobalScope (sampleRate, currentFrame, currentTime,
  // AudioWorkletProcessor, registerProcessor).
  // ======================================================================
  function workletMain(name) {
    "use strict";

    // Núcleo sinc con ventana Hann, tabulado: K cruces por cero, R puntos/unidad.
    const K = 3;
    const R = 256;
    const TABLE = new Float64Array(K * R + 2);
    for (let i = 0; i < TABLE.length; i++) {
      const u = i / R;
      const s = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const w = u >= K ? 0 : 0.5 * (1 + Math.cos(Math.PI * u / K));
      TABLE[i] = s * w;
    }
    const MAX_SCALE = 32;

    function at(a, k, len) {
      return (k >= 0 && k < len) ? a[k] : 0;
    }

    /** Hermite cúbico (Catmull-Rom) para lectura a rate <= 1. */
    function hermite(a, p, len) {
      const i = Math.floor(p);
      const f = p - i;
      let y0, y1, y2, y3;
      if (i >= 1 && i < len - 2) {
        y0 = a[i - 1]; y1 = a[i]; y2 = a[i + 1]; y3 = a[i + 2];
      } else {
        y0 = at(a, i - 1, len); y1 = at(a, i, len); y2 = at(a, i + 1, len); y3 = at(a, i + 2, len);
      }
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    }

    class BabyScratchProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.ch = [];
        this.len = 0;
        this.id = "";
        this.ratio = 1;          // sampleRate_fuente / sampleRate_contexto
        this.pos = 0;            // cabeza de lectura, en muestras de la fuente
        this.rate = 0;           // rate suavizado, con signo (1 = normal)
        this.target = 0;
        this.gate = 0;
        this.env = 0;
        this.envTarget = 0;
        this.active = false;
        this.stopping = false;
        this.fresh = false;
        this.held = false;
        this.lastInput = 0;
        this.edgeSent = 0;
        this.blocks = 0;
        this.oL = 0;
        this.oR = 0;
        this.cfg = { tau: 0.009, gateFull: 0.12, fadeIn: 0.003, release: 0.014, holdMs: 45, maxRate: 8 };
        this.calc();
        this.port.onmessage = (e) => this.onMessage(e.data);
      }

      calc() {
        const c = this.cfg;
        const sr = sampleRate;
        this.aRate = 1 - Math.exp(-1 / (c.tau * sr));
        this.aGate = 1 - Math.exp(-1 / (0.004 * sr));
        this.aIn = 1 - Math.exp(-1 / ((c.fadeIn / 3) * sr));
        this.aOut = 1 - Math.exp(-1 / ((c.release / 3) * sr));
        this.holdFrames = (c.holdMs / 1000) * sr;
      }

      onMessage(d) {
        if (!d) return;
        switch (d.t) {
          case "load":
            this.ch = d.channels || [];
            this.len = d.length | 0;
            this.id = d.id;
            this.ratio = (d.sampleRate || sampleRate) / sampleRate;
            this.pos = 0; this.rate = 0; this.target = 0; this.gate = 0;
            this.env = 0; this.envTarget = 0;
            this.active = false; this.stopping = false;
            this.port.postMessage({ t: "loaded", id: d.id });
            break;
          case "start":
            this.pos = Math.min(Math.max(+d.pos || 0, 0), Math.max(0, this.len - 1));
            this.rate = 0; this.target = 0; this.gate = 0;
            this.active = true; this.stopping = false;
            this.fresh = true; this.held = false;
            this.envTarget = 1;
            this.lastInput = currentFrame;
            this.edgeSent = 0;
            break;
          case "rate": {
            let v = +d.v;
            if (!isFinite(v)) v = 0;
            const m = this.cfg.maxRate;
            v = v > m ? m : (v < -m ? -m : v);
            this.target = v;
            this.lastInput = currentFrame;
            this.held = false;
            // Primera velocidad tras start(): arranca ya a su rate (inmediato).
            if (this.fresh && v !== 0) {
              this.rate = v;
              this.gate = Math.min(1, Math.abs(v) / this.cfg.gateFull);
              this.fresh = false;
            }
            break;
          }
          case "stop":
            this.active = false;
            this.stopping = true;
            this.envTarget = 0;
            break;
          case "cfg":
            Object.assign(this.cfg, d.cfg || {});
            this.calc();
            break;
          case "unload":
            this.ch = []; this.len = 0; this.id = "";
            this.active = false; this.stopping = false;
            this.env = 0; this.envTarget = 0; this.gate = 0; this.rate = 0; this.target = 0;
            break;
          default:
            break;
        }
      }

      /** Lectura con antialiasing (rate > 1): sinc-Hann de ancho proporcional al rate. */
      readSinc(a, b, p, s, len) {
        if (s > MAX_SCALE) s = MAX_SCALE;
        const span = K * s;
        const k0 = Math.ceil(p - span);
        const k1 = Math.floor(p + span);
        const inv = 1 / s;
        const same = (a === b);
        let sw = 0, sl = 0, sr = 0;
        for (let k = k0; k <= k1; k++) {
          const u = (k - p) * inv;
          const idx = (u < 0 ? -u : u) * R;
          const j = idx | 0;
          const w = TABLE[j] + (TABLE[j + 1] - TABLE[j]) * (idx - j);
          sw += w;
          if (k >= 0 && k < len) {
            sl += a[k] * w;
            if (!same) sr += b[k] * w;
          }
        }
        if (sw > 1e-9) {
          this.oL = sl / sw;
          this.oR = same ? this.oL : sr / sw;
        } else {
          this.oL = 0;
          this.oR = 0;
        }
      }

      process(inputs, outputs) {
        const out = outputs[0];
        const chL = this.ch[0];
        if (!out || !out.length || !chL) return true;
        if (!this.active && !this.stopping) return true; // reposo: la salida ya es silencio

        const outL = out[0];
        const outR = out[1] || out[0];
        const n = outL.length;
        const chR = this.ch[1] || chL;
        const mono = (chR === chL);
        const len = this.len;
        const lenM1 = len - 1;
        const ratio = this.ratio;
        const gf = this.cfg.gateFull;
        const aR = this.aRate;
        const aG = this.aGate;
        const envT = this.envTarget;
        const aE = envT > this.env ? this.aIn : this.aOut;

        // Mano quieta: sin mensajes de velocidad durante holdMs => rate objetivo 0.
        let tgt = this.target;
        if (this.active && (currentFrame - this.lastInput) > this.holdFrames) {
          tgt = 0;
          this.held = true;
        }

        let pos = this.pos, rate = this.rate, gate = this.gate, env = this.env, hit = 0;

        for (let i = 0; i < n; i++) {
          let t = tgt;
          // Aguja fuera del surco: no se puede seguir leyendo hacia ese extremo.
          if ((t > 0 && pos >= lenM1) || (t < 0 && pos <= 0)) t = 0;
          rate += (t - rate) * aR;
          const mag = rate < 0 ? -rate : rate;
          gate += ((mag >= gf ? 1 : mag / gf) - gate) * aG;
          env += (envT - env) * aE;

          let l = 0, r = 0;
          if (gate > 1e-5 && env > 1e-5) {
            const step = mag * ratio;
            if (step <= 1) {
              l = hermite(chL, pos, len);
              r = mono ? l : hermite(chR, pos, len);
            } else {
              this.readSinc(chL, chR, pos, step, len);
              l = this.oL;
              r = this.oR;
            }
            const g = gate * env;
            l *= g;
            r *= g;
          }
          outL[i] = l;
          if (outR !== outL) outR[i] = r;

          pos += rate * ratio;
          if (pos >= lenM1) {
            pos = lenM1;
            if (rate > 0) { rate = 0; hit = 1; }
          } else if (pos <= 0) {
            pos = 0;
            if (rate < 0) { rate = 0; hit = -1; }
          }
        }

        this.pos = pos; this.rate = rate; this.gate = gate; this.env = env;

        if (hit !== 0 && this.edgeSent !== hit) {
          this.edgeSent = hit;
          this.port.postMessage({ t: "edge", edge: hit > 0 ? "end" : "start", pos: pos });
        } else if (hit === 0 && this.edgeSent !== 0 && pos > 1 && pos < lenM1 - 1) {
          this.edgeSent = 0;
        }

        if (this.stopping && env < 1e-4) {
          this.stopping = false;
          this.env = 0; this.gate = 0; this.rate = 0; this.target = 0;
          this.port.postMessage({ t: "stopped", pos: pos });
          return true;
        }

        // Informe de posición (~86 Hz) para getPosition()/UI en el hilo principal.
        if ((++this.blocks & 3) === 0) {
          this.port.postMessage({
            t: "pos", pos: pos, rate: rate,
            time: currentTime + n / sampleRate, held: this.held
          });
        }
        return true;
      }
    }

    try { registerProcessor(name, BabyScratchProcessor); } catch (_) { /* ya registrado */ }
  }

  const WORKLET_SOURCE = "(" + workletMain.toString() + ")(" + JSON.stringify(WORKLET_NAME) + ");";

  // ======================================================================
  // Motor
  // ======================================================================
  class BabyScratchEngine {
    constructor(options) {
      options = options || {};
      this.audio = options.audio || null;
      this.graph = options.audioGraph || null;

      this._opts = Object.assign({}, DEFAULTS);
      this._listeners = Object.create(null);

      // ---- Estado ----
      this.ctx = null;
      this._ownsCtx = false;
      this.output = null;
      this.bus = null;
      this._busCtx = null;
      this._busOutput = null;
      this._busSig = "";
      this._primedCtx = null;
      this._volumeBound = false;
      this._onVolume = null;

      this._mode = null;            // null (sin decidir) | "worklet" | "legacy"
      this._backendPromise = null;
      this._w = null;               // { node, loadedUrl, buffer, pos, rate, time, held }

      this.buffer = null;
      this.reverseBuffer = null;    // solo backend legacy
      this.sourceUrl = "";
      this.loading = null;
      this._loadingUrl = "";
      this._loadToken = 0;
      this._abort = null;

      this.active = false;
      this.position = 0;       // cabeza de lectura (s, tiempo "hacia delante")
      this.handPosition = 0;   // última posición recibida (informativa)
      this.rate = 0;           // rate con signo
      this.lastVelocity = 0;
      this.voice = null;       // solo backend legacy

      this._watchTimer = 0;
      this._lastInput = 0;
      this._held = false;
      this._lastResume = 0;
      this._destroyed = false;

      this.configure(options);
      if (typeof options.onReady === "function") this.on("ready", options.onReady);
      if (typeof options.onError === "function") this.on("error", options.onError);
      if (typeof options.onEdge === "function") this.on("edge", options.onEdge);
    }

    // ------------------------------------------------------------------
    // Configuración y eventos
    // ------------------------------------------------------------------

    /** Aplica opciones (también en caliente, con el motor sonando). */
    configure(patch) {
      patch = patch || {};
      const o = this._opts;
      Object.keys(DEFAULTS).forEach(function (k) {
        if (patch[k] !== undefined) o[k] = patch[k];
      });

      this.rpm = clamp(finite(o.rpm, DEFAULTS.rpm), 10, 90);
      this.radPerSecAt1x = (this.rpm / 60) * TWO_PI;
      this.maxRate = clamp(finite(o.maxRate, DEFAULTS.maxRate), 1, 16);
      this.rateTau = clamp(finite(o.rateSmoothingMs, DEFAULTS.rateSmoothingMs), 2, 60) / 1000;
      this.holdMs = clamp(finite(o.holdMs, DEFAULTS.holdMs), 15, 300);
      this.idleReleaseMs = clamp(finite(o.idleReleaseMs, DEFAULTS.idleReleaseMs), 200, 60000);
      this.deadband = clamp(finite(o.deadband, DEFAULTS.deadband), 0, 0.5);
      this.gateFullRate = clamp(finite(o.gateFullRate, DEFAULTS.gateFullRate), 0.02, 1);
      this.fadeInSec = clamp(finite(o.fadeInMs, DEFAULTS.fadeInMs), 1, 20) / 1000;
      this.swapFadeSec = clamp(finite(o.swapFadeMs, DEFAULTS.swapFadeMs), 2, 30) / 1000;
      this.releaseSec = clamp(finite(o.releaseMs, DEFAULTS.releaseMs), 4, 80) / 1000;
      this.outputGain = clamp(finite(o.outputGain, DEFAULTS.outputGain), 0.1, 3);
      this.toneHz = clamp(finite(o.toneHz, DEFAULTS.toneHz), 0, 22000);
      this.dcBlockHz = clamp(finite(o.dcBlockHz, DEFAULTS.dcBlockHz), 0, 120);
      this.limiter = o.limiter !== false;
      this.volume = clamp(finite(o.volume, DEFAULTS.volume), 0, 2);
      this.followAudioVolume = !!o.followAudioVolume;
      this.debug = !!o.debug;

      this._bindVolume();
      if (this.ctx && this.output && !this._destroyed) {
        this._ensureBus();
        if (this.bus) {
          try { this.bus.input.gain.setTargetAtTime(this.outputGain, this.ctx.currentTime, 0.01); } catch (_) { /* noop */ }
        }
        this._applyMaster();
        this._postConfig();
      }
      return this;
    }

    on(type, fn) {
      if (typeof fn !== "function") return noop;
      (this._listeners[type] || (this._listeners[type] = [])).push(fn);
      const self = this;
      return function () { self.off(type, fn); };
    }

    off(type, fn) {
      const list = this._listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }

    _emit(type, detail) {
      const list = this._listeners[type];
      if (!list || !list.length) return;
      list.slice().forEach((fn) => {
        try { fn(detail, this); } catch (e) { if (global.console) console.error("[BabyScratchEngine] listener:", e); }
      });
    }

    _log() {
      if (this.debug && global.console) console.log.apply(console, ["[BabyScratchEngine]"].concat([].slice.call(arguments)));
    }

    /** "worklet" | "legacy" | null (aún sin decidir). */
    getBackend() {
      return this._mode;
    }

    static supportsWorklet() {
      return !!(global.AudioContext || global.webkitAudioContext) &&
        typeof global.AudioWorkletNode !== "undefined" &&
        typeof global.Blob !== "undefined" &&
        !!(global.URL && typeof global.URL.createObjectURL === "function");
    }

    // ------------------------------------------------------------------
    // Contexto y bus de salida
    // ------------------------------------------------------------------

    _ensureContext() {
      if (this._destroyed) return false;
      if (this.graph && typeof this.graph.ensure === "function") {
        try { this.graph.ensure(); } catch (_) { /* noop */ }
      }
      let ctx = (this.graph && this.graph.ctx) || this.ctx;
      if (ctx && ctx.state === "closed") {
        if (this.graph && this.graph.ctx === ctx) return false; // lo gestiona el dueño del grafo
        ctx = null;
      }
      if (!ctx) {
        const Ctor = global.AudioContext || global.webkitAudioContext;
        if (!Ctor) return false;
        try { ctx = new Ctor({ latencyHint: "interactive" }); }
        catch (_) { try { ctx = new Ctor(); } catch (e) { return false; } }
        this._ownsCtx = true;
      }
      if (this.ctx && this.ctx !== ctx) this._disposeBackend(); // el contexto cambió
      this.ctx = ctx;
      this.output = (this.graph && this.graph.analyser) ? this.graph.analyser : ctx.destination;
      this._ensureBus();
      if (!this.bus) return false;
      this._initBackend();
      return true;
    }

    _resume() {
      const ctx = this.ctx;
      if (!ctx || ctx.state === "running" || typeof ctx.resume !== "function") return;
      const t = nowMs();
      if (t - this._lastResume < 250) return;
      this._lastResume = t;
      try { const r = ctx.resume(); if (r && r.catch) r.catch(noop); } catch (_) { /* noop */ }
    }

    _busSignature() {
      return [this.toneHz, this.dcBlockHz, this.limiter ? 1 : 0].join("|");
    }

    _ensureBus() {
      const sig = this._busSignature();
      if (this.bus && this._busCtx === this.ctx && this._busOutput === this.output && this._busSig === sig) return;

      const prev = this.bus;
      const prevCtx = this._busCtx;
      this._disposeBus();

      const ctx = this.ctx;
      const nodes = [];
      const input = ctx.createGain();
      input.gain.value = this.outputGain;
      nodes.push(input);
      let tail = input;

      // Bloqueo de DC / subsónico: evita "thump" al arrancar o invertir.
      if (this.dcBlockHz > 0 && typeof ctx.createBiquadFilter === "function") {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = this.dcBlockHz;
        hp.Q.value = 0.707;
        tail.connect(hp);
        tail = hp;
        nodes.push(hp);
      }
      // Paso bajo (cartucho).
      if (this.toneHz > 0 && typeof ctx.createBiquadFilter === "function") {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = Math.min(this.toneHz, ctx.sampleRate * 0.49);
        lp.Q.value = 0.5;
        tail.connect(lp);
        tail = lp;
        nodes.push(lp);
      }
      // Limitador: scratch rápido + ganancia puede pasar de 0 dBFS.
      if (this.limiter && typeof ctx.createDynamicsCompressor === "function") {
        const lim = ctx.createDynamicsCompressor();
        try {
          lim.threshold.value = -4;
          lim.knee.value = 0;
          lim.ratio.value = 20;
          lim.attack.value = 0.002;
          lim.release.value = 0.06;
        } catch (_) { /* noop */ }
        tail.connect(lim);
        tail = lim;
        nodes.push(lim);
      }
      // Volumen maestro (post-limitador).
      const master = ctx.createGain();
      master.gain.value = this._masterGain();
      tail.connect(master);
      master.connect(this.output);
      nodes.push(master);

      this.bus = { input: input, master: master, nodes: nodes };
      this._busCtx = ctx;
      this._busOutput = this.output;
      this._busSig = sig;

      // Si el bus se reconstruye con algo sonando, se reengancha.
      if (prev && prevCtx === ctx) {
        const w = this._w;
        if (w && w.node) {
          try { w.node.disconnect(); w.node.connect(input); } catch (_) { /* noop */ }
        }
        const v = this.voice;
        if (v && !v.dead) {
          try { v.env.disconnect(); v.env.connect(input); } catch (_) { /* noop */ }
        }
      }
    }

    _disposeBus() {
      if (!this.bus) return;
      this.bus.nodes.forEach(function (n) { try { n.disconnect(); } catch (_) { /* noop */ } });
      this.bus = null;
      this._busCtx = null;
      this._busOutput = null;
      this._busSig = "";
    }

    _masterGain() {
      let g = this.volume;
      if (this.followAudioVolume && this.audio) {
        const av = Number(this.audio.volume);
        if (Number.isFinite(av)) g *= clamp(av, 0, 1);
      }
      return g;
    }

    _applyMaster() {
      if (!this.bus || !this.ctx) return;
      try { this.bus.master.gain.setTargetAtTime(this._masterGain(), this.ctx.currentTime, 0.015); } catch (_) { /* noop */ }
    }

    _bindVolume() {
      const want = this.followAudioVolume && this.audio && typeof this.audio.addEventListener === "function";
      if (want && !this._volumeBound) {
        this._onVolume = () => this._applyMaster();
        this.audio.addEventListener("volumechange", this._onVolume);
        this._volumeBound = true;
      } else if (!want && this._volumeBound) {
        try { this.audio.removeEventListener("volumechange", this._onVolume); } catch (_) { /* noop */ }
        this._volumeBound = false;
        this._onVolume = null;
      }
    }

    /** Volumen del motor (0..2), independiente del <audio>. */
    setVolume(value) {
      this._opts.volume = clamp(finite(value, 1), 0, 2);
      this.volume = this._opts.volume;
      this._applyMaster();
      return this.volume;
    }

    // ------------------------------------------------------------------
    // Backend (worklet / legacy)
    // ------------------------------------------------------------------

    /** Registra el procesador una sola vez por AudioContext. */
    static _registerWorklet(ctx) {
      const store = BabyScratchEngine._workletReg;
      const hit = store.get(ctx);
      if (hit) return hit;
      let p;
      // En file:// o en un origen opaco, createObjectURL produce blob:null y
      // el navegador bloquea addModule por política de origen. Usa legacy sin
      // hacer una petición que inevitablemente fallará.
      const opaqueOrigin = !global.location || global.location.origin === "null" || global.location.protocol === "file:";
      if (opaqueOrigin || !ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== "function" || !BabyScratchEngine.supportsWorklet()) {
        p = Promise.resolve(false);
      } else {
        p = (async () => {
          let url = "";
          try {
            url = global.URL.createObjectURL(new global.Blob([WORKLET_SOURCE], { type: "application/javascript" }));
            await ctx.audioWorklet.addModule(url);
            return true;
          } catch (error) {
            if (global.console) console.warn("[BabyScratchEngine] AudioWorklet no disponible, uso backend legacy:", error);
            return false;
          } finally {
            if (url) { try { global.URL.revokeObjectURL(url); } catch (_) { /* noop */ } }
          }
        })();
      }
      store.set(ctx, p);
      return p;
    }

    _initBackend() {
      if (this._backendPromise) return this._backendPromise;
      const ctx = this.ctx;
      const want = this._opts.backend;
      this._backendPromise = (async () => {
        let ok = false;
        if (want !== "legacy") ok = await BabyScratchEngine._registerWorklet(ctx);
        if (this.ctx !== ctx || this._destroyed) return this._mode; // el contexto cambió mientras tanto
        if (ok) ok = this._createNode();
        this._mode = ok ? "worklet" : "legacy";
        this._log("backend:", this._mode);
        this._emit("backend", { mode: this._mode });
        return this._mode;
      })();
      return this._backendPromise;
    }

    _createNode() {
      const ctx = this.ctx;
      if (!ctx || !this.bus) return false;
      try {
        const node = new global.AudioWorkletNode(ctx, WORKLET_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        node.port.onmessage = (e) => this._onWorkletMessage(e.data);
        node.onprocessorerror = (e) => this._fallbackToLegacy(e);
        node.connect(this.bus.input);
        this._w = { node: node, loadedUrl: "", buffer: null, pos: 0, rate: 0, time: 0, held: false };
        this._postConfig();
        return true;
      } catch (error) {
        if (global.console) console.warn("[BabyScratchEngine] no se pudo crear el AudioWorkletNode:", error);
        this._w = null;
        return false;
      }
    }

    _postConfig() {
      const w = this._w;
      if (!w || !w.node) return;
      try {
        w.node.port.postMessage({
          t: "cfg",
          cfg: {
            tau: this.rateTau,
            gateFull: this.gateFullRate,
            fadeIn: this.fadeInSec,
            release: this.releaseSec,
            holdMs: this.holdMs,
            maxRate: this.maxRate
          }
        });
      } catch (_) { /* noop */ }
    }

    _disposeBackend() {
      const w = this._w;
      if (w && w.node) {
        try { w.node.port.onmessage = null; w.node.onprocessorerror = null; } catch (_) { /* noop */ }
        try { w.node.port.postMessage({ t: "unload" }); } catch (_) { /* noop */ }
        try { w.node.disconnect(); } catch (_) { /* noop */ }
      }
      this._w = null;
      this._mode = null;
      this._backendPromise = null;
      this.voice = null;
      this.active = false;
      this._clearWatch();
    }

    /** Si el procesador falla en el hilo de audio, se continúa con el backend v3. */
    _fallbackToLegacy(error) {
      if (this._mode !== "worklet") return;
      this._emit("error", { error: error || new Error("AudioWorklet processor error") });
      const url = this.sourceUrl;
      const was = this.active;
      this.active = false;
      const w = this._w;
      if (w && w.node) {
        try { w.node.port.onmessage = null; w.node.onprocessorerror = null; w.node.disconnect(); } catch (_) { /* noop */ }
      }
      this._w = null;
      this._mode = "legacy";
      this.reverseBuffer = null;
      this._emit("backend", { mode: "legacy", fallback: true });
      if (was) this._emit("stop", { position: this.position });
      if (url) this.prepare(url); // reconstruye el buffer invertido en segundo plano
    }

    _onWorkletMessage(d) {
      const w = this._w;
      if (!w || !d) return;
      const sr = this.buffer ? this.buffer.sampleRate : (this.ctx ? this.ctx.sampleRate : 44100);
      switch (d.t) {
        case "pos":
          w.pos = d.pos; w.rate = d.rate; w.time = d.time; w.held = !!d.held;
          break;
        case "edge":
          w.pos = d.pos;
          this.position = d.pos / sr;
          this._emit("edge", { edge: d.edge, position: this.position });
          break;
        case "stopped":
          w.pos = d.pos; w.rate = 0; w.held = false;
          this.position = d.pos / sr;
          this._emit("settled", { position: this.position });
          break;
        default:
          break;
      }
    }

    /** Copia los canales al worklet (transferibles). Solo 1-2 canales. */
    _loadIntoWorklet(url, buffer) {
      const w = this._w;
      if (!w || !w.node) return false;
      if (w.loadedUrl === url && w.buffer === buffer) return true;
      const n = Math.min(2, buffer.numberOfChannels);
      const channels = [];
      const transfer = [];
      for (let c = 0; c < n; c++) {
        const copy = buffer.getChannelData(c).slice();
        channels.push(copy);
        transfer.push(copy.buffer);
      }
      try {
        w.node.port.postMessage({
          t: "load", id: url, channels: channels, length: buffer.length, sampleRate: buffer.sampleRate
        }, transfer);
      } catch (error) {
        this._emit("error", { url: url, error: error });
        return false;
      }
      w.loadedUrl = url;
      w.buffer = buffer;
      w.pos = 0;
      w.rate = 0;
      w.held = false;
      return true;
    }

    // ------------------------------------------------------------------
    // Carga y caché
    // ------------------------------------------------------------------

    _resolveUrl(url) {
      return String(url || (this.audio && (this.audio.currentSrc || this.audio.src)) || "");
    }

    /** ¿Hay datos listos para sonar (sin comparar URL)? */
    _hasData() {
      if (!this.buffer) return false;
      if (this._mode === "worklet") {
        const w = this._w;
        return !!(w && w.node && w.loadedUrl === this.sourceUrl);
      }
      return !!(this._mode === "legacy" && this.reverseBuffer);
    }

    isReady(url) {
      url = this._resolveUrl(url);
      return this.sourceUrl === url && this._hasData();
    }

    isActive() {
      return this.active;
    }

    /**
     * Prepara todo lo que puede retrasar el primer sonido. Se llama en el
     * pointerdown (gesto del usuario, antes de que el disco se mueva):
     *  - reanuda el AudioContext si está suspendido,
     *  - crea el bus de salida y carga el AudioWorklet,
     *  - reproduce un frame silencioso para despertar la salida de audio,
     *  - lanza la decodificación si el buffer aún no está listo.
     * Devuelve true si el buffer ya está listo para sonar de inmediato.
     */
    warm(url) {
      if (!this._ensureContext()) return false;
      const ctx = this.ctx;
      this._resume();
      if (this._primedCtx !== ctx && this.bus) {
        try {
          const silent = ctx.createBufferSource();
          silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          silent.connect(this.bus.input);
          silent.start(0);
          this._primedCtx = ctx;
        } catch (_) { /* noop */ }
      }
      url = this._resolveUrl(url);
      const ready = this.isReady(url);
      if (!ready) this.prepare(url);
      return ready;
    }

    _abortLoad() {
      this._loadToken++;
      if (this._abort) { try { this._abort.abort(); } catch (_) { /* noop */ } }
      this._abort = null;
      this.loading = null;
      this._loadingUrl = "";
    }

    /** Fija el audio cargado en el backend activo. */
    _adopt(url, decoded, reversed, cached) {
      this.sourceUrl = url;
      this.buffer = decoded;
      if (this._mode === "worklet") {
        this.reverseBuffer = null; // la lectura inversa es directa: no hace falta
        this._loadIntoWorklet(url, decoded);
      } else {
        this.reverseBuffer = reversed || null;
      }
      this._emit("ready", { url: url, cached: !!cached, duration: decoded.duration, backend: this._mode });
    }

    prepare(url) {
      url = this._resolveUrl(url);
      if (!url || !this._ensureContext()) return Promise.resolve(false);
      if (this.isReady(url)) return Promise.resolve(true);
      if (this.loading && this._loadingUrl === url) return this.loading;

      this._abortLoad(); // cancela la descarga de la canción anterior
      this.sourceUrl = url;
      this.buffer = null;
      this.reverseBuffer = null;

      const cached = BabyScratchEngine._recall(url);
      const knownMode = this._mode;
      if (cached && knownMode && (knownMode === "worklet" || cached.reverseBuffer)) {
        this._adopt(url, cached.buffer, cached.reverseBuffer, true);
        return Promise.resolve(true);
      }

      const token = this._loadToken;
      const ctx = this.ctx;
      const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      this._abort = ctl;
      this._loadingUrl = url;

      const job = (async () => {
        try {
          const mode = knownMode || (await this._backendPromise) || this._mode || "legacy";
          let decoded;
          let reversed = null;
          if (cached) {
            decoded = cached.buffer;
            reversed = cached.reverseBuffer;
          } else {
            const response = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
            if (!response.ok) throw new Error("No se pudo cargar el audio para Baby Scratch (HTTP " + response.status + ")");
            const data = await response.arrayBuffer();
            if (token !== this._loadToken) return false;
            decoded = await decode(ctx, data);
          }
          if (mode === "legacy" && !reversed) reversed = await BabyScratchEngine._reverse(ctx, decoded);
          BabyScratchEngine._remember(url, decoded, reversed);
          if (token !== this._loadToken) return false; // cambió la canción mientras cargaba
          this._adopt(url, decoded, reversed, !!cached);
          return true;
        } catch (error) {
          if (token === this._loadToken) {
            this.buffer = null;
            this.reverseBuffer = null;
            if (!(error && error.name === "AbortError")) {
              if (global.console) console.warn("[BabyScratchEngine] decode falló:", error);
              this._emit("error", { url: url, error: error });
            }
          }
          return false;
        } finally {
          if (token === this._loadToken) {
            this.loading = null;
            this._loadingUrl = "";
            this._abort = null;
          }
        }
      })();
      this.loading = job;
      return job;
    }

    /** (legacy) Invierte el buffer cediendo el hilo entre canales. */
    static async _reverse(ctx, source) {
      const channels = source.numberOfChannels;
      const reversed = ctx.createBuffer(channels, source.length, source.sampleRate);
      for (let c = 0; c < channels; c++) {
        const out = reversed.getChannelData(c);
        out.set(source.getChannelData(c));
        out.reverse();
        if (c < channels - 1) await yieldToMain();
      }
      return reversed;
    }

    static _recall(url) {
      const hit = BabyScratchEngine.cache.get(url);
      if (!hit) return null;
      BabyScratchEngine.cache.delete(url); // refresca el orden LRU
      BabyScratchEngine.cache.set(url, hit);
      return hit;
    }

    static _remember(url, buffer, reverseBuffer) {
      const cache = BabyScratchEngine.cache;
      cache.delete(url);
      cache.set(url, {
        buffer: buffer,
        reverseBuffer: reverseBuffer || null,
        bytes: (reverseBuffer ? 2 : 1) * buffer.length * buffer.numberOfChannels * 4
      });
      let total = BabyScratchEngine.cacheBytes();
      while (cache.size > 1 && total > BabyScratchEngine.maxCacheBytes) {
        const oldest = cache.keys().next().value;
        total -= (cache.get(oldest).bytes || 0);
        cache.delete(oldest);
      }
    }

    static cacheBytes() {
      let total = 0;
      BabyScratchEngine.cache.forEach(function (entry) { total += entry.bytes || 0; });
      return total;
    }

    static clearCache() {
      BabyScratchEngine.cache.clear();
    }

    // ------------------------------------------------------------------
    // Control
    // ------------------------------------------------------------------

    /**
     * Empieza el scratch en `position` (s). Síncrono: si el audio no está listo
     * devuelve false (y lo prepara en segundo plano) para que el llamador deje
     * sonar el <audio> mientras tanto. `velocity` (rad/s) es opcional: si se
     * pasa, el sonido arranca ya en esta misma llamada.
     */
    start(position, velocity) {
      if (!this._ensureContext()) return false;
      const url = this.audio && (this.audio.currentSrc || this.audio.src);
      if (!this._hasData() || (url && this.sourceUrl !== url)) {
        this.prepare(url);
        return false;
      }
      this._resume();
      this.active = true;
      this._held = false;
      this.position = clamp(finite(position, this.audio ? this.audio.currentTime : 0), 0, this.buffer.duration);
      this.handPosition = this.position;
      this.rate = 0;
      this.lastVelocity = 0;
      this._lastInput = nowMs();
      this._applyMaster();

      if (this._mode === "worklet") {
        const w = this._w;
        w.pos = this.position * this.buffer.sampleRate;
        w.rate = 0;
        w.held = false;
        w.time = this.ctx.currentTime;
        try { w.node.port.postMessage({ t: "start", pos: w.pos }); } catch (_) { /* noop */ }
      } else {
        this._dropVoice(0.006);
      }

      this._emit("start", { position: this.position });
      if (Number.isFinite(Number(velocity)) && Number(velocity) !== 0) {
        this.update(this.position, velocity);
      }
      return true;
    }

    /** `velocity`: velocidad angular del disco en rad/s, con signo (+ = hacia delante). */
    update(position, velocity) {
      if (!this.active || !this.ctx || !this._hasData()) return false;
      if (this.ctx.state !== "running") this._resume();
      this.handPosition = finite(position, this.handPosition);
      const v = finite(velocity, 0);
      this.lastVelocity = v;
      let rate = clamp(v / this.radPerSecAt1x, -this.maxRate, this.maxRate);
      if (Math.abs(rate) < this.deadband) rate = 0;

      if (this._mode === "worklet") {
        try { this._w.node.port.postMessage({ t: "rate", v: rate }); } catch (_) { return false; }
        return true;
      }

      const now = this.ctx.currentTime;
      this._advance(now);
      this._held = false;
      this._setRate(rate, now);
      this._touch();
      return true;
    }

    /** Detiene el scratch y devuelve la posición final estimada (s). */
    stop() {
      const was = this.active;
      if (this._mode === "worklet" && this._w) {
        if (was) {
          this.position = this._workletPosition();
          this.active = false;
          try { this._w.node.port.postMessage({ t: "stop" }); } catch (_) { /* noop */ }
        }
      } else {
        this.active = false;
        this._clearWatch();
        if (this.ctx && this.voice) {
          this._advance(this.ctx.currentTime);
          this._dropVoice(this.releaseSec);
        }
      }
      this.rate = 0;
      this.lastVelocity = 0;
      this._held = false;
      if (was) this._emit("stop", { position: this.position });
      return this.position;
    }

    destroy() {
      this.stop();
      this._abortLoad();
      this._destroyed = true;
      this._disposeBackend();
      this.buffer = null;
      this.reverseBuffer = null;
      this.followAudioVolume = false;
      this._bindVolume();
      this._disposeBus();
      this._listeners = Object.create(null);
      if (this._ownsCtx && this.ctx && typeof this.ctx.close === "function") {
        try { const r = this.ctx.close(); if (r && r.catch) r.catch(noop); } catch (_) { /* noop */ }
      }
      this.ctx = null;
    }

    /** Posición estimada de la cabeza (worklet): último informe + rate · Δt de reloj de audio. */
    _workletPosition() {
      const w = this._w;
      if (!w || !this.buffer || !this.ctx || !this.active) return this.position;
      const dt = clamp(this.ctx.currentTime - w.time, 0, 0.1);
      const p = clamp(w.pos / this.buffer.sampleRate + w.rate * dt, 0, this.buffer.duration);
      this.position = p;
      return p;
    }

    /** Posición actual de la cabeza de lectura (s). */
    getPosition() {
      if (this._mode === "worklet") return this._workletPosition();
      if (this.active && this.ctx) this._advance(this.ctx.currentTime);
      return this.position;
    }

    /** Velocidad de lectura actual con signo (1 = normal). */
    getRate() {
      if (this._mode === "worklet") {
        this.rate = (this.active && this._w) ? this._w.rate : 0;
        return this.rate;
      }
      if (this.active && this.ctx) this._advance(this.ctx.currentTime);
      return this.rate;
    }

    /** Copia la posición de la cabeza al <audio> (útil al soltar el disco). */
    syncAudio() {
      const pos = this.getPosition();
      if (this.audio) { try { this.audio.currentTime = pos; } catch (_) { /* noop */ } }
      return pos;
    }

    /** Latencia de salida estimada (s). */
    getLatency() {
      const c = this.ctx;
      if (!c) return 0;
      return finite(c.baseLatency, 0) + finite(c.outputLatency, 0);
    }

    getStats() {
      const c = this.ctx;
      return {
        version: VERSION,
        backend: this._mode,
        active: this.active,
        ready: this.isReady(),
        position: this.getPosition(),
        rate: this.getRate(),
        duration: this.buffer ? this.buffer.duration : 0,
        contextState: c ? c.state : "none",
        sampleRate: c ? c.sampleRate : 0,
        latencyMs: this.getLatency() * 1000,
        held: (this._mode === "worklet") ? !!(this._w && this._w.held) : this._held,
        cacheEntries: BabyScratchEngine.cache.size,
        cacheBytes: BabyScratchEngine.cacheBytes()
      };
    }

    // ------------------------------------------------------------------
    // Núcleo legacy (backend v3, AudioBufferSourceNode)
    // ------------------------------------------------------------------

    /**
     * Integra la cabeza de lectura hasta `now` con el mismo modelo que WebAudio
     * aplica a setTargetAtTime: m(t) = T + (m0 - T)·e^(-dt/tau). También avanza
     * el modelo de la compuerta, para poder re-sincronizar la automatización.
     */
    _advance(now) {
      const v = this.voice;
      if (!v || v.dead || !this.buffer) return;
      const dt = now - v.t;
      if (!(dt > 0)) return;
      const tau = v.tau;
      const k = Math.exp(-dt / tau);
      const dist = v.target * dt + (v.mag - v.target) * tau * (1 - k);
      v.mag = v.target + (v.mag - v.target) * k;
      v.g = v.gTarget + (v.g - v.gTarget) * Math.exp(-dt / GATE_TAU);
      v.t = now;
      this.position += v.dir * dist;
      this.rate = v.dir * v.mag;

      const dur = this.buffer.duration;
      if (this.position >= dur - 0.001 && v.dir > 0) {
        this.position = dur;
        this._finishVoice(v, now, 1);
      } else if (this.position <= 0.001 && v.dir < 0) {
        this.position = 0;
        this._finishVoice(v, now, -1);
      } else {
        this.position = clamp(this.position, 0, dur);
      }
    }

    _edgeBlocked(dir) {
      const dur = this.buffer.duration;
      return (dir > 0 && this.position >= dur - EDGE_EPS) || (dir < 0 && this.position <= EDGE_EPS);
    }

    _setRate(rate, now) {
      const mag = Math.abs(rate);
      if (mag > 0) {
        const dir = rate > 0 ? 1 : -1;
        const cur = this.voice;
        if (!cur || cur.dead || cur.dir !== dir) {
          if (this._edgeBlocked(dir)) { // aguja fuera del surco: silencio
            this._dropVoice(0.006);
            this.rate = 0;
            return;
          }
          if (!this._spawnVoice(dir, mag, now)) return;
        }
      }
      const v = this.voice;
      if (!v || v.dead) return;
      v.target = mag;
      v.tau = this.rateTau;
      v.gTarget = clamp(mag / this.gateFullRate, 0, 1);
      ramp(v.source.playbackRate, v.mag, v.target, now, v.tau);
      ramp(v.gate.gain, v.g, v.gTarget, now, GATE_TAU);
    }

    _spawnVoice(dir, mag, now) {
      const ctx = this.ctx;
      const buf = dir > 0 ? this.buffer : this.reverseBuffer;
      if (!buf || !this.bus) return false;
      const dur = this.buffer.duration;
      const old = this.voice;
      const swapping = !!(old && !old.dead);

      const pos = clamp(this.position, 0, Math.max(0, dur - EDGE_EPS));
      // El buffer invertido está espejado: t_adelante = dur - t_invertido.
      const offset = dir > 0 ? pos : clamp(dur - pos, 0, Math.max(0, buf.duration - EDGE_EPS));
      // Primera voz: arranca ya a su velocidad (inmediato). Al invertir, el plato
      // pasa por cero y vuelve a acelerar en el otro sentido.
      const startMag = swapping ? Math.min(mag, SWAP_START_RATE) : mag;
      const g0 = clamp(startMag / this.gateFullRate, 0, 1);
      const tauIn = this.fadeInSec / 3;

      const source = ctx.createBufferSource();
      const gate = ctx.createGain();
      const env = ctx.createGain();
      try {
        source.buffer = buf;
        source.playbackRate.value = startMag;
        gate.gain.value = g0;
        env.gain.value = 0;
        env.gain.setValueAtTime(0, now);
        env.gain.setTargetAtTime(1, now, tauIn);
        source.connect(gate);
        gate.connect(env);
        env.connect(this.bus.input);
        source.start(now, offset);
      } catch (error) {
        try { source.disconnect(); gate.disconnect(); env.disconnect(); } catch (_) { /* noop */ }
        this._emit("error", { error: error });
        return false;
      }

      const voice = {
        dir: dir, source: source, gate: gate, env: env,
        mag: startMag, target: mag, tau: this.rateTau,
        g: g0, gTarget: g0, t: now,
        envV0: 0, envT0: now, envTarget: 1, envTau: tauIn,
        dead: false, stopping: false
      };
      source.onended = function () {
        voice.dead = true;
        try { source.disconnect(); gate.disconnect(); env.disconnect(); } catch (_) { /* noop */ }
      };

      if (swapping) {
        // La voz anterior frena mientras se funde con la nueva.
        ramp(old.source.playbackRate, old.mag, 0, now, this.swapFadeSec / 2);
        this._killVoice(old, now, this.swapFadeSec);
      }
      this.voice = voice;
      return true;
    }

    /** Valor actual de la envolvente de la voz según su modelo exponencial. */
    _envValue(v, now) {
      const dt = Math.max(0, now - v.envT0);
      return v.envTarget + (v.envV0 - v.envTarget) * Math.exp(-dt / v.envTau);
    }

    _killVoice(v, now, fadeSec) {
      if (!v || v.stopping) return;
      v.stopping = true;
      v.dead = true;
      // Se parte del valor REAL de la envolvente (puede estar a mitad de fade-in).
      ramp(v.env.gain, this._envValue(v, now), 0, now, Math.max(0.001, fadeSec / 3));
      try { v.source.stop(now + fadeSec + 0.02); } catch (_) { /* noop */ }
    }

    _finishVoice(v, now, dir) {
      // La lectura llegó a un extremo del buffer: se apaga con un fundido corto.
      this._killVoice(v, now, 0.006);
      this.rate = 0;
      this._emit("edge", { edge: dir > 0 ? "end" : "start", position: this.position });
    }

    _dropVoice(fadeSec) {
      const v = this.voice;
      this.voice = null;
      if (v && !v.dead && this.ctx) this._killVoice(v, this.ctx.currentTime, fadeSec);
    }

    // ------------------------------------------------------------------
    // (legacy) Vigilante de mano quieta: un solo temporizador
    // ------------------------------------------------------------------

    _touch() {
      this._lastInput = nowMs();
      if (!this._watchTimer) this._schedule(this.holdMs);
    }

    _schedule(ms) {
      this._watchTimer = setTimeout(() => this._watch(), Math.max(1, ms));
      if (this._watchTimer && typeof this._watchTimer.unref === "function") this._watchTimer.unref();
    }

    _watch() {
      this._watchTimer = 0;
      if (!this.active || !this.ctx || this._mode === "worklet") return;
      const idle = nowMs() - this._lastInput;
      if (!this._held) {
        if (idle < this.holdMs - 1) { this._schedule(this.holdMs - idle); return; }
        // Mano quieta: el plato queda sujeto (rate 0).
        const now = this.ctx.currentTime;
        this._advance(now);
        this.lastVelocity = 0;
        this._held = true;
        this._setRate(0, now);
        this._schedule(this.idleReleaseMs - idle);
      } else if (idle >= this.idleReleaseMs) {
        // Inactividad larga: se libera la voz (el siguiente update la recrea).
        this._advance(this.ctx.currentTime);
        this._dropVoice(this.releaseSec);
        this.rate = 0;
      } else {
        this._schedule(this.idleReleaseMs - idle);
      }
    }

    _clearWatch() {
      if (this._watchTimer) clearTimeout(this._watchTimer);
      this._watchTimer = 0;
    }
  }

  BabyScratchEngine.VERSION = VERSION;
  BabyScratchEngine.cache = new Map();
  BabyScratchEngine._workletReg = new WeakMap();
  BabyScratchEngine._workletSource = WORKLET_SOURCE;
  BabyScratchEngine._workletName = WORKLET_NAME;
  // Presupuesto de memoria de la caché (buffer normal [+ invertido en legacy] por pista).
  BabyScratchEngine.maxCacheBytes = 360 * 1024 * 1024;

  global.BabyScratchEngine = BabyScratchEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = BabyScratchEngine;
})(typeof window !== "undefined" ? window : globalThis);
