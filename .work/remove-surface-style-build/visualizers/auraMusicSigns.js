/**
 * AuraPlay Pro — Visualizador «Constelación musical» (id técnico: `capsules`)
 * ---------------------------------------------------------------------------
 * Una constelación de signos musicales en retícula escalonada, dentro de
 * una masa con forma de squircle. Cada signo se orienta según un campo de
 * flujo suave. El audio controla volumen, torsión del campo, destellos y una
 * ola de giros de 90° en cada beat.
 *
 * Namespace global:
 *   window.AuraPlayVisualizers.capsules        -> clase Visualizer
 *   window.AuraPlayVisualizers.meta.capsules   -> { id, name, description }
 *
 * Uso:
 *   const v = new AuraPlayVisualizers.capsules(canvas, audioGraph);
 *   v.setSensitivity(0.7); v.start(); v.stop(); v.stop(true); v.clear(); v.destroy();
 *
 * Requisitos del host:
 *   - El canvas debe tener tamaño definido por CSS (p. ej. width/height: 100%).
 *     El módulo ajusta width/height del buffer, nunca el tamaño CSS.
 *   - audioGraph.getDataArray() -> Uint8Array de frecuencias (0-255) | null
 *   - audioGraph.getTimeDomain() -> Uint8Array centrado en ~128 | null
 *
 * Código 100 % original, sin dependencias externas. Canvas 2D únicamente.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ Constantes
  var ID = 'capsules';
  var TAU = Math.PI * 2;
  var HALF_PI = Math.PI / 2;
  var MAX_DPR = 2;
  var MAX_CELLS = 900;            // tope duro de signos
  var SENS_MIN = 0.4, SENS_MAX = 1.2, SENS_BASE = 0.7;

  var HUE_N = 8, LIGHT_N = 3, SIZE_N = 3;
  var BUCKET_N = HUE_N * LIGHT_N * SIZE_N;       // 72 cubos de color/grosor

  // Paleta a lo largo de la diagonal (0 = graves, 1 = agudos)
  var HUE_T = [0, 0.3, 0.55, 0.78, 1];
  var HUE_V = [8, 40, 158, 214, 282];            // coral, ámbar, jade, azur, violeta
  var SIZE_MUL = [0.5, 0.78, 1];                 // grosor por clase de tamaño
  var LIGHT_L = [34, 49, 64];                    // luminosidad por nivel
  var GLINT_ALPHA = [0, 0.26, 0.5, 0.82];
  // Sensibilidad por familia: negra, corcheas, blanca, silencio y doble bandera.
  var GLYPH_BASS = [0.72, 0.12, 0.48, 0.08, 0.18];
  var GLYPH_MID  = [0.12, 0.55, 0.2, 0.32, 0.16];
  var GLYPH_TRE  = [0.08, 0.18, 0.1, 0.18, 0.72];

  var HUE_BASE = (function () {
    var out = [];
    for (var k = 0; k < HUE_N; k++) out.push(hueAt((k + 0.5) / HUE_N));
    return out;
  })();

  // ------------------------------------------------------------------ Utilidades
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hueAt(t) {
    for (var i = 1; i < HUE_T.length; i++) {
      if (t <= HUE_T[i]) {
        var f = (t - HUE_T[i - 1]) / (HUE_T[i] - HUE_T[i - 1]);
        return HUE_V[i - 1] + (HUE_V[i] - HUE_V[i - 1]) * f;
      }
    }
    return HUE_V[HUE_V.length - 1];
  }

  /** Media normalizada (0-1) de arr[a..b). Seguro ante límites. */
  function avgRange(arr, a, b) {
    if (b > arr.length) b = arr.length;
    if (b <= a) return 0;
    var s = 0;
    for (var i = a; i < b; i++) s += arr[i];
    return s / ((b - a) * 255);
  }

  /** Normaliza una banda: autoganancia suave + sensibilidad + curva. */
  function shapeBand(raw, ref, gain) {
    var v = (raw / Math.max(ref, 0.3)) * gain;
    if (v > 1.15) v = 1.15;
    return v > 0 ? Math.pow(v, 1.3) : 0;
  }

  /** Genera un tono HSL en cadena con valores enteros. */
  function hsl(h, s, l) {
    return 'hsl(' + ((h % 360 + 360) % 360).toFixed(0) + ',' + s + '%,' + l.toFixed(0) + '%)';
  }

  /** Dibuja un glifo musical compacto, orientado por el campo de flujo. */
  function drawMusicGlyph(ctx, x, y, hx, hy, size, kind) {
    var angle = Math.atan2(hy, hx);
    var s = Math.max(1.25, Math.min(3.4, size));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.75, s * 0.52);
    ctx.beginPath();
    if (kind === 0) {
      ctx.ellipse(-s * 0.48, s * 0.62, s * 0.58, s * 0.38, -0.25, 0, TAU);
      ctx.moveTo(0, s * 0.52); ctx.lineTo(0, -s * 1.65);
      ctx.quadraticCurveTo(s * 1.0, -s * 1.45, s * 1.18, -s * 0.7);
      ctx.stroke(); ctx.fill();
    } else if (kind === 1) {
      ctx.ellipse(-s * 0.95, s * 0.62, s * 0.55, s * 0.36, -0.22, 0, TAU);
      ctx.ellipse(s * 0.75, s * 0.62, s * 0.55, s * 0.36, -0.22, 0, TAU);
      ctx.moveTo(-s * 0.48, s * 0.52); ctx.lineTo(-s * 0.48, -s * 1.35);
      ctx.moveTo(s * 1.22, s * 0.52); ctx.lineTo(s * 1.22, -s * 1.35);
      ctx.moveTo(-s * 0.48, -s * 1.35); ctx.lineTo(s * 1.22, -s * 1.35);
      ctx.stroke(); ctx.fill();
    } else if (kind === 2) {
      ctx.ellipse(-s * 0.45, s * 0.7, s * 0.72, s * 0.42, -0.28, 0, TAU);
      ctx.moveTo(s * 0.18, s * 0.6); ctx.lineTo(s * 0.18, -s * 1.7);
      ctx.stroke(); ctx.fill();
    } else if (kind === 3) {
      ctx.moveTo(-s * 1.15, -s * 0.75);
      ctx.lineTo(-s * 0.25, -s * 0.15);
      ctx.lineTo(-s * 0.82, s * 0.5);
      ctx.lineTo(s * 0.15, s * 1.05);
      ctx.lineTo(s * 0.95, s * 0.35);
      ctx.stroke();
    } else {
      ctx.ellipse(-s * 0.42, s * 0.58, s * 0.55, s * 0.36, -0.2, 0, TAU);
      ctx.moveTo(s * 0.05, s * 0.5); ctx.lineTo(s * 0.05, -s * 1.7);
      ctx.quadraticCurveTo(s * 0.9, -s * 1.55, s * 1.2, -s * 0.95);
      ctx.moveTo(s * 0.1, -s * 1.35); ctx.quadraticCurveTo(s * 0.95, -s * 1.2, s * 1.3, -s * 0.58);
      ctx.stroke(); ctx.fill();
    }
    ctx.restore();
  }

  /** Distribuye cinco familias por todo el mosaico, sin agruparlas por banda o zona. */
  function glyphKindFor(seed) {
    return Math.min(4, (seed * 5) | 0);
  }

  // Precalculadas una sola vez: cadenas rgba de destello.
  var GLINT_STYLE = [];
  for (var gi = 0; gi < GLINT_ALPHA.length; gi++) {
    GLINT_STYLE.push('rgba(255,246,228,' + GLINT_ALPHA[gi] + ')');
  }

  // ------------------------------------------------------------------ Clase
  class Visualizer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{getDataArray:Function,getTimeDomain:Function}} audioGraph
     */
    constructor(canvas, audioGraph) {
      this.canvas = canvas || null;
      this.audioGraph = audioGraph || null;
      this._ctx = null;
      try { this._ctx = canvas ? canvas.getContext('2d') : null; } catch (e) { this._ctx = null; }

      this._sens = SENS_BASE;
      this._hueShift = 0;

      // ciclo de vida
      this._running = false;
      this._stopping = false;
      this._destroyed = false;
      this._raf = 0;
      this._last = 0;
      this._fade = 0;
      this._fadeTarget = 0;
      this._errLogged = false;

      // tamaño
      this._w = 0; this._h = 0; this._dpr = 1; this._ready = false;
      this._a = 0; this._b = 0; this._pitch = 8; this._n = 0;
      this._ro = null;

      // rendimiento adaptativo
      this._costEma = 6;
      this._lowQ = false;

      this._tick = this._tick.bind(this);
      this._onResize = this._onResize.bind(this);

      this._allocate();
      this._resetState();
      this._attach();
      this._resize();
    }

    // ---------------------------------------------------------------- API pública
    /** Sensibilidad 0.4–1.2 (base 0.7). */
    setSensitivity(value) {
      var v = Number(value);
      if (!isFinite(v)) v = SENS_BASE;
      this._sens = clamp(v, SENS_MIN, SENS_MAX);
    }

    /** Opcional: rota la paleta (grados) por si se quiere teñir con la portada. */
    setHueShift(deg) {
      var v = Number(deg);
      this._hueShift = isFinite(v) ? v : 0;
    }

    /** Inicia un único bucle rAF. Llamarlo varias veces no duplica bucles. */
    start() {
      if (this._destroyed || !this._ctx) return;
      this._running = true;
      this._stopping = false;
      this._fadeTarget = 1;
      if (!this._raf) {
        this._last = 0;
        this._raf = requestAnimationFrame(this._tick);
      }
    }

    /** stop(): fundido breve y luego se detiene. stop(true): inmediato y limpia. */
    stop(immediate) {
      if (immediate === true) {
        this._halt();
        this._fade = 0;
        this._fadeTarget = 0;
        this._resetState();
        this.clear();
        return;
      }
      if (!this._running) { this.clear(); return; }
      this._stopping = true;
      this._fadeTarget = 0;
    }

    /** Limpia el canvas de forma segura. */
    clear() {
      var c = this.canvas, ctx = this._ctx;
      if (!c || !ctx) return;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, c.width, c.height);
      } catch (e) { /* canvas inválido: nada que limpiar */ }
    }

    /** Detiene todo, desconecta observadores y elimina listeners. */
    destroy() {
      if (this._destroyed) return;
      this._halt();
      this.clear();
      this._destroyed = true;
      if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
      window.removeEventListener('resize', this._onResize);
      this.audioGraph = null;
      this._ctx = null;
      this.canvas = null;
    }

    // ---------------------------------------------------------------- Interno: ciclo
    _halt() {
      this._running = false;
      this._stopping = false;
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    }

    _attach() {
      if (!this.canvas) return;
      if (typeof ResizeObserver === 'function') {
        try {
          this._ro = new ResizeObserver(this._onResize);
          this._ro.observe(this.canvas);
        } catch (e) { this._ro = null; }
      }
      window.addEventListener('resize', this._onResize);
    }

    _onResize() { this._resize(); }

    _tick(ts) {
      this._raf = 0;
      if (!this._running || this._destroyed) return;

      var dt = this._last ? (ts - this._last) / 1000 : 1 / 60;
      this._last = ts;
      if (!(dt > 0)) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;       // evita saltos tras pestañas en segundo plano

      // Fundido de entrada/salida
      var speed = this._fadeTarget > this._fade ? 1 / 0.28 : 1 / 0.38;
      if (this._fade < this._fadeTarget) this._fade = Math.min(this._fadeTarget, this._fade + dt * speed);
      else if (this._fade > this._fadeTarget) this._fade = Math.max(this._fadeTarget, this._fade - dt * speed);

      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      try {
        // Si el DPR cambió (p. ej. cambio de monitor) se reajusta.
        var dprNow = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        if (dprNow !== this._dpr) this._resize();
        this._frame(dt);
      } catch (e) {
        if (!this._errLogged) {
          this._errLogged = true;
          if (typeof console !== 'undefined') console.warn('[capsules] error de render:', e);
        }
      }
      if (t0) {
        var cost = performance.now() - t0;
        this._costEma = this._costEma * 0.9 + cost * 0.1;
        if (!this._lowQ && this._costEma > 18) this._lowQ = true;
        else if (this._lowQ && this._costEma < 9) this._lowQ = false;
      }

      if (this._stopping && this._fade <= 0.004) {
        this._halt();
        this._fade = 0;
        this.clear();
        return;
      }
      if (this._running && !this._raf) this._raf = requestAnimationFrame(this._tick);
    }

    // ---------------------------------------------------------------- Interno: tamaño
    _resize() {
      var c = this.canvas;
      if (!c || this._destroyed) return;
      var w = c.clientWidth, h = c.clientHeight;
      if (!(w > 1 && h > 1)) {
        var r = c.getBoundingClientRect();
        w = r.width; h = r.height;
      }
      var dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      if (!(w > 1 && h > 1)) { this._ready = false; this._w = 0; this._h = 0; return; }
      var pw = Math.max(1, Math.round(w * dpr));
      var ph = Math.max(1, Math.round(h * dpr));
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
      var changed = (w !== this._w || h !== this._h || dpr !== this._dpr || !this._ready);
      this._w = w; this._h = h; this._dpr = dpr; this._ready = true;
      if (changed) this._layout();
    }

    // ---------------------------------------------------------------- Interno: memoria
    _allocate() {
      var N = MAX_CELLS;
      var F = function () { return new Float32Array(N); };
      // geometría fija por celda
      this.X = F(); this.Y = F(); this.U = F(); this.V = F();
      this.Q0 = F(); this.T = F(); this.TT = F(); this.SEED = F(); this.W0 = F();
      this.S2 = F(); this.C2 = F(); this.S3 = F(); this.C3 = F();
      // estado dinámico por celda
      this.ACT = F(); this.TURN = F(); this.TGT = F(); this.FL = F();
      this.BID = new Int32Array(N);
      // salida por frame
      this.CX = F(); this.CY = F(); this.HX = F(); this.HY = F();
      this.BK = new Uint8Array(N);
      this.SC = new Uint8Array(N);
      this.GL = new Uint8Array(N);
      this.ORDER = new Uint16Array(N);
      this.bCount = new Int32Array(BUCKET_N + 1);
      this.bStart = new Int32Array(BUCKET_N + 1);
      this.bFill = new Int32Array(BUCKET_N);
      this.colors = new Array(HUE_N * LIGHT_N);
    }

    _resetState() {
      this._t = 0;
      this._phase = 0;
      this._bass = 0; this._mid = 0; this._tre = 0; this._energy = 0;
      this._refB = 0.3; this._refM = 0.3; this._refT = 0.3; this._refS = 0.3;
      this._kickAvg = 0; this._kickPrev = 0; this._lastBeat = -10;
      this._beatEnv = 0; this._beatKick = 1; this._beatId = 0;
      this._front = 9; this._wdx = 1; this._wdy = 0;
      this._binGain = 1;
      this._freq = null; this._nBins = 0;
      if (this.ACT) {
        for (var i = 0; i < MAX_CELLS; i++) {
          this.ACT[i] = 0; this.TURN[i] = 0; this.TGT[i] = 0; this.FL[i] = 0; this.BID[i] = 0;
        }
      }
    }

    // ---------------------------------------------------------------- Interno: layout
    /** Construye la retícula escalonada dentro de un límite redondeado ajustado al canvas. */
    _layout() {
      var w = this._w, h = this._h;
      var a = w * 0.43, b = h * 0.43;
      var maxAspect = 1.3;
      if (a > b * maxAspect) a = b * maxAspect;
      else if (b > a * maxAspect) b = a * maxAspect;
      this._a = a; this._b = b;

      var D = Math.min(a, b) * 2;
      var pitch = Math.max(6, D / 19);
      var rowH = pitch * 0.88;
      this._pitch = pitch;

      var rows = Math.ceil((b * 1.22) / rowH);
      var cols = Math.ceil((a * 1.22) / pitch);
      var count = 0;
      var rng = 12345;

      for (var r = -rows; r <= rows && count < MAX_CELLS; r++) {
        var y = r * rowH;
        var xo = (r & 1) ? pitch * 0.5 : 0;
        for (var c = -cols; c <= cols; c++) {
          if (count >= MAX_CELLS) break;
          var x = c * pitch + xo;
          var u = x / a, v = y / b;
          var q = u * u * u * u + v * v * v * v;
          // Margen exterior ampliado: el mosaico queda más contenido hacia el centro.
          if (q > 0.64) continue;

          var i = count++;
          rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
          var seed = rng / 4294967296;

          this.X[i] = x; this.Y[i] = y; this.U[i] = u; this.V[i] = v;
          this.Q0[i] = q;
          this.SEED[i] = seed;
          this.W0[i] = Math.exp(-(u * u + v * v) * 1.8);

          // Posición diagonal: abajo-izquierda = graves, arriba-derecha = agudos
          var t = ((u - v) * 0.5 + 1) * 0.5 + (seed - 0.5) * 0.06;
          t = clamp(t, 0, 0.999);
          this.T[i] = t;
          this.TT[i] = Math.pow(t, 1.6);

          var th = Math.atan2(v, u);
          this.S2[i] = Math.sin(2 * th); this.C2[i] = Math.cos(2 * th);
          this.S3[i] = Math.sin(3 * th); this.C3[i] = Math.cos(3 * th);

          this.ACT[i] = 0; this.TURN[i] = 0; this.TGT[i] = 0; this.FL[i] = 0;
          this.BID[i] = this._beatId;
        }
      }
      this._n = count;
    }

    // ---------------------------------------------------------------- Interno: audio
    /** Lee el audio, calcula bandas suavizadas, energía y detecta el beat. */
    _analyse(dt) {
      var g = this.audioGraph, f = null, td = null;
      try {
        if (g) {
          if (typeof g.getDataArray === 'function') f = g.getDataArray();
          if (typeof g.getTimeDomain === 'function') td = g.getTimeDomain();
        }
      } catch (e) { f = null; td = null; }

      var n = (f && f.length) ? f.length : 0;
      var have = n >= 16;
      this._freq = have ? f : null;
      this._nBins = have ? n : 0;

      var bassR = 0, midR = 0, trebR = 0, kickR = 0, specR = 0;
      if (have) {
        var hz = 22050 / n;                       // ancho de bin aproximado (44,1 kHz)
        var i1 = Math.max(1, Math.round(35 / hz));
        var i2 = Math.max(i1 + 1, Math.round(150 / hz));
        var i3 = Math.max(i2 + 1, Math.round(2000 / hz));
        var i4 = Math.max(i3 + 1, Math.round(9000 / hz));
        var ik = Math.max(i1 + 2, Math.round(250 / hz));
        bassR = avgRange(f, i1, i2);
        kickR = avgRange(f, i1, ik);
        midR = avgRange(f, i2, i3);
        trebR = avgRange(f, i3, i4);
        specR = avgRange(f, 1, Math.round(6000 / hz));
      }

      // RMS del dominio temporal: solo como indicador de volumen (no se dibuja)
      var rms = 0;
      if (td && td.length >= 32) {
        var step = Math.max(1, td.length >> 8), s = 0, cnt = 0;
        for (var k = 0; k < td.length; k += step) { var d = td[k] - 128; s += d * d; cnt++; }
        rms = Math.sqrt(s / cnt) / 128;
      }

      // Autoganancia: el pico de referencia decae lento
      var decay = Math.exp(-dt * 0.1);
      this._refB = Math.max(this._refB * decay, bassR);
      this._refM = Math.max(this._refM * decay, midR);
      this._refT = Math.max(this._refT * decay, trebR);
      this._refS = Math.max(this._refS * decay, specR);

      var gain = this._sens / SENS_BASE;
      var bT = shapeBand(bassR, this._refB, gain);
      var mT = shapeBand(midR, this._refM, gain);
      var tT = shapeBand(trebR, this._refT, gain);
      var sT = shapeBand(specR, this._refS, gain);
      var eT = clamp(0.38 * sT + 0.24 * bT + 0.2 * mT + 0.08 * tT + 0.1 * clamp(rms * 3 * gain, 0, 1), 0, 1);

      this._binGain = gain * 0.85 / Math.max(this._refS, 0.3);

      // Suavizado asimétrico (ataque rápido, caída lenta)
      this._bass = this._smooth(this._bass, bT, 24, 4.2, dt);
      this._mid = this._smooth(this._mid, mT, 22, 5.5, dt);
      this._tre = this._smooth(this._tre, tT, 34, 10, dt);
      this._energy = this._smooth(this._energy, eT, 12, 2.2, dt);

      // Detección de beat por flujo en graves (35-250 Hz)
      this._kickAvg += (kickR - this._kickAvg) * (1 - Math.exp(-dt / 0.5));
      var mul = 1.34 - 0.2 * ((this._sens - SENS_MIN) / (SENS_MAX - SENS_MIN));
      if (kickR > 0.2 &&
          kickR > this._kickAvg * mul + 0.045 &&
          kickR >= this._kickPrev &&
          this._t - this._lastBeat > 0.22) {
        this._lastBeat = this._t;
        this._beatEnv = 1;
        this._beatKick = 0.6 + 0.4 * clamp((kickR - this._kickAvg) * 4, 0, 1);
        this._beatId++;
        var ang = this._beatId * 2.399963;         // ángulo áureo: la dirección varía
        this._wdx = Math.cos(ang); this._wdy = Math.sin(ang);
        this._front = -1.6;
      }
      this._kickPrev = kickR;
      this._beatEnv *= Math.exp(-dt * 5.5);
    }

    _smooth(cur, target, rateUp, rateDown, dt) {
      var r = target > cur ? rateUp : rateDown;
      return cur + (target - cur) * (1 - Math.exp(-r * dt));
    }

    // ---------------------------------------------------------------- Interno: render
    _frame(dt) {
      var ctx = this._ctx, canvas = this.canvas;
      if (!ctx || !canvas) return;

      // Siempre limpiamos con la identidad para no arrastrar transformaciones.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!this._ready || this._n === 0) { this._analyse(dt); this._t += dt; return; }

      this._analyse(dt);
      this._t += dt;

      var t = this._t, n = this._n, dpr = this._dpr;
      var bass = this._bass, mid = this._mid, tre = this._tre, energy = this._energy;
      var beatEnv = this._beatEnv;
      var idleAmt = 1 - clamp(energy * 2.5, 0, 1) * 0.55;

      // Fases del campo de flujo (avanzan más rápido con la energía)
      this._phase += dt * (0.24 + energy * 1.45 + mid * 0.9 + bass * 0.5 + tre * 0.35);
      var ph = this._phase;
      var p1 = ph * 0.9, p2 = ph * 0.63 + 2.1, p3 = ph * 1.3 + 4.2;
      var dph2 = ph * 0.4, dph3 = ph * 0.27 + 1;
      var cosA = Math.cos(dph2), sinA = Math.sin(dph2);
      var cosB = Math.cos(dph3), sinB = Math.sin(dph3);

      var S = 1 + bass * 0.13 + beatEnv * 0.09 * this._beatKick + energy * 0.025 + 0.012 * Math.sin(t * 0.7) * idleAmt;
      var S4 = S * S * S * S;
      var defA = 0.035 + mid * 0.16, defB = 0.025 + mid * 0.11;
      var twist = 0.85 + mid * 2.8 + energy * 0.7 + tre * 0.35;
      var bulge = bass * 0.24 + beatEnv * 0.12 * this._beatKick;
      var pitch = this._pitch;
      var tb = pitch * 0.40 * S * (0.78 + bass * 0.3 + energy * 0.18);   // escala base de los signos
      var lenBase = pitch * S * (1 + tre * 0.18 + beatEnv * 0.15);

      // Ola del beat
      var waveOn = this._front < 1.7;
      if (waveOn) this._front += dt * 8.5;
      var front = this._front, wdx = this._wdx, wdy = this._wdy, beatId = this._beatId;

      // Constantes de suavizado por frame
      var kA = 1 - Math.exp(-dt * 22), kR = 1 - Math.exp(-dt * 6);
      var kT = 1 - Math.exp(-dt * 11);
      var flDecay = Math.exp(-dt * 5);

      // Mapeo de bins (de ~40 Hz a ~9 kHz sobre la diagonal)
      var f = this._freq, nb = this._nBins;
      var span = Math.max(2, Math.floor(nb * 0.42) - 4);
      var binGain = this._binGain;

      var ACT = this.ACT, TURN = this.TURN, TGT = this.TGT, FL = this.FL, BID = this.BID;
      var U = this.U, V = this.V, T = this.T, TT = this.TT, SEED = this.SEED, W0 = this.W0;
      var X = this.X, Y = this.Y, Q0 = this.Q0;
      var S2A = this.S2, C2A = this.C2, S3A = this.S3, C3A = this.C3;
      var CX = this.CX, CY = this.CY, HX = this.HX, HY = this.HY;
      var BK = this.BK, SC = this.SC, GL = this.GL;
      var bCount = this.bCount;
      for (var z = 0; z <= BUCKET_N; z++) bCount[z] = 0;

      var visible = 0;
      for (var i = 0; i < n; i++) {
        // --- actividad espectral de la celda
        var tt = TT[i];
        var e = 0;
        if (f) {
          var bin = 2 + ((tt * span) | 0);
          e = (f[bin - 1] + 2 * f[bin] + f[bin + 1]) * (1 / 1020);
          e *= binGain * (1 + tt * 1.15) * (1.15 + energy * 0.35 + bass * 0.25);
          if (e > 1) e = 1;
          e = e * (0.5 + 0.5 * e);
        }
        var act = ACT[i];
        act += (e - act) * (e > act ? kA : kR);
        ACT[i] = act;

        // --- silueta: squircle deformado suavemente
        var rf = 1 + defA * (S2A[i] * cosA + C2A[i] * sinA) + defB * (S3A[i] * cosB + C3A[i] * sinB);
        var r2 = rf * rf;
        var q = Q0[i] / (S4 * r2 * r2);

        // --- giro del beat (se procesa aunque la celda esté fuera, para coherencia)
        var u = U[i], v = V[i];
        if (waveOn && BID[i] < beatId && front >= (u * wdx + v * wdy)) {
          BID[i] = beatId; TGT[i] += 1; FL[i] = 1;
        }
        var tv = TURN[i];
        tv += (TGT[i] - tv) * kT;
        TURN[i] = tv;
        var fl = FL[i] * flDecay;
        FL[i] = fl;

        if (q >= 1) { BK[i] = 255; continue; }
        var xm = (1 - q) * 2.6;
        if (xm > 1) xm = 1;
        var m = xm * xm * (3 - 2 * xm);
        if (m < 0.05) { BK[i] = 255; continue; }

        // --- actividad total (con brillo de reposo)
        var seed = SEED[i];
        var ai = act + idleAmt * (0.14 + 0.12 * Math.sin(t * 0.9 + T[i] * 5.2 + seed * 1.7)) + beatEnv * (0.28 + bass * 0.35);
        if (ai > 1) ai = 1;

        var glyphKind = glyphKindFor(seed);
        var glyphTone = bass * GLYPH_BASS[glyphKind] + mid * GLYPH_MID[glyphKind] + tre * GLYPH_TRE[glyphKind];

        // --- ángulo: campo de flujo + giros del beat + respuesta propia del signo
        var flow = Math.sin(u * 1.7 + v * 1.2 + p1) * 0.9 +
                   Math.cos(v * 2.1 - u * 0.9 + p2) * 0.7 +
                   Math.sin(u * v * 2.6 + p3) * 0.4;
        var toneWobble = tre * GLYPH_TRE[glyphKind] + mid * GLYPH_MID[glyphKind];
        var ang = flow * twist + tv * HALF_PI + toneWobble * 0.3 * Math.sin(t * (12 + tre * 18) + seed * 60);

        // --- posición con domo de graves
        var w0 = W0[i];
        var sc = S * (1 + bulge * w0);
        var cx = X[i] * sc, cy = Y[i] * sc;

        // --- escala del signo (los agudos añaden variación fina)
        var bandWeight = glyphTone * 0.52 + bass * (1 - tt) * 0.18 + tre * tt * 0.18;
        var L = lenBase * (0.30 + 0.44 * ai) * (0.55 + 0.45 * m) * (1 + bandWeight + bass * 0.3 * w0) *
                (1 + tre * 0.12 * Math.sin(t * 13 + seed * 50));
        var hx = Math.cos(ang) * L * 0.5, hy = Math.sin(ang) * L * 0.5;

        CX[i] = cx; CY[i] = cy; HX[i] = hx; HY[i] = hy;

        // --- destello (agudos rápidos + beat)
        var gn = 0.5 + 0.5 * Math.sin(t * (7 + 11 * tre) + seed * 37 + T[i] * 9);
        var gl = ai * 0.4 + fl * 0.7 + tre * 1.25 * gn * gn;
        GL[i] = gl > 0.75 ? 3 : (gl > 0.5 ? 2 : (gl > 0.28 ? 1 : 0));

        // --- cubo de color / grosor
        var lt = ai + fl * 0.55 + beatEnv * 0.12;
        var lv = lt > 0.62 ? 2 : (lt > 0.32 ? 1 : 0);
        var hb = (T[i] * HUE_N) | 0;
        if (hb > HUE_N - 1) hb = HUE_N - 1;
        var szc = m < 0.35 ? 0 : (m < 0.75 ? 1 : 2);
        SC[i] = szc;
        var bk = (hb * LIGHT_N + lv) * SIZE_N + szc;
        BK[i] = bk;
        bCount[bk + 1]++;
        visible++;
      }

      // Orden por cubos (counting sort, sin asignaciones)
      var bStart = this.bStart, bFill = this.bFill, ORDER = this.ORDER;
      bStart[0] = 0;
      for (var b = 0; b < BUCKET_N; b++) {
        bStart[b + 1] = bStart[b] + bCount[b + 1];
        bFill[b] = bStart[b];
      }
      for (var j = 0; j < n; j++) {
        var kk = BK[j];
        if (kk !== 255) ORDER[bFill[kk]++] = j;
      }

      // Colores del frame (24 cadenas)
      var drift = 22 * Math.sin(t * 0.05) + this._hueShift;
      for (var hbI = 0; hbI < HUE_N; hbI++) {
        var hue = HUE_BASE[hbI] + drift;
        for (var lvI = 0; lvI < LIGHT_N; lvI++) {
          this.colors[hbI * LIGHT_N + lvI] = hsl(hue, 78, LIGHT_L[lvI] + energy * 6);
        }
      }

      // ------------------------------------------------------------ Dibujo
      var fade = this._fade;
      fade = fade * fade * (3 - 2 * fade);
      ctx.setTransform(dpr, 0, 0, dpr, this._w * 0.5 * dpr, this._h * 0.5 * dpr);
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // El límite es implícito en la retícula; no se dibuja ninguna línea blanca.

      var cnt = bStart[BUCKET_N];
      var lowQ = this._lowQ;
      var k, s0, e0, idx;

      // Las cinco familias están mezcladas por toda la retícula; cada una mantiene su sensibilidad tonal.
      for (var bi = 0; bi < BUCKET_N; bi++) {
        s0 = bStart[bi]; e0 = bStart[bi + 1];
        if (s0 === e0) continue;
        var color = this.colors[(bi / SIZE_N) | 0];
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        for (k = s0; k < e0; k++) {
          idx = ORDER[k];
          var kind = glyphKindFor(SEED[idx]);
          var tone = bass * GLYPH_BASS[kind] + mid * GLYPH_MID[kind] + tre * GLYPH_TRE[kind];
          if (!lowQ && GL[idx] >= 2) {
            ctx.save();
            ctx.translate(pitch * S * 0.035, pitch * S * 0.06);
            ctx.globalAlpha = fade * 0.24;
            ctx.strokeStyle = 'rgba(6,4,18,0.8)';
            drawMusicGlyph(ctx, CX[idx], CY[idx], HX[idx], HY[idx], tb * SIZE_MUL[bi % SIZE_N] * (1.5 + tone * 0.45), kind);
            ctx.restore();
            ctx.globalAlpha = fade;
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
          }
          drawMusicGlyph(ctx, CX[idx], CY[idx], HX[idx], HY[idx], tb * SIZE_MUL[bi % SIZE_N] * (1.5 + tone * 0.45), kind);
        }
      }

      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // ------------------------------------------------------------------ Registro
  var NS = (window.AuraPlayVisualizers = window.AuraPlayVisualizers || {});
  NS.meta = NS.meta || {};
  NS[ID] = Visualizer;
  NS.meta[ID] = {
    id: ID,
    name: 'Constelación musical',
    description: 'Notas, acordes y signos musicales que giran y se iluminan con el ritmo'
  };
})();
