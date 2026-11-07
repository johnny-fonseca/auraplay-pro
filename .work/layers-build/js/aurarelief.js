/*!
 * AuraPlay Pro · Visualizador "Relieve estratificado"  (id técnico: relief)
 *
 * Metáfora: una isla de relieve cartográfico vista desde arriba. El audio
 * levanta y erosiona un terreno continuo: curvas de nivel, tintes hipsométricos
 * y sombreado de ladera sobre una masa de contorno redondeado y orgánico.
 *
 * Registro global:   window.AuraPlayVisualizers.relief  (clase)
 * Uso:               const v = new AuraPlayVisualizers.relief(canvas, audioGraph);
 *
 * API: constructor(canvas, audioGraph[, options]), setSensitivity(0.4–1.2),
 *      start(), stop(immediate = false), clear(), destroy()
 *      Extra opcional: setPalette(['#rrggbb', ...])  (colores de tierra, de baja a alta cota)
 *
 * Datos de audio (ambos opcionales, pueden devolver null):
 *      audioGraph.getDataArray()  -> Uint8Array de frecuencias 0–255
 *      audioGraph.getTimeDomain() -> Uint8Array centrado en 128 (solo se usa su RMS;
 *                                    nunca se dibuja como forma de onda)
 *
 * Código 100 % original: sin librerías, CDN, imágenes, fuentes, WebGL ni shaders.
 * Técnicas generales (ruido de gradiente, fBm, deformación de dominio, marching
 * squares) son de dominio común; no se copió código de ningún proyecto.
 */
(function (global) {
  'use strict';

  var NS_NAME = 'AuraPlayVisualizers'; // namespace global donde se registra la clase
  var ID = 'relief';                   // identificador técnico del estilo

  /* ------------------------------------------------------------------ *
   * Utilidades
   * ------------------------------------------------------------------ */
  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  // Suavizado exponencial asimétrico e independiente del framerate.
  function follow(cur, target, dt, up, down) {
    var k = 1 - Math.exp(-dt * (target > cur ? up : down));
    return cur + (target - cur) * k;
  }
  function nowMs() {
    return (global.performance && typeof global.performance.now === 'function')
      ? global.performance.now() : Date.now();
  }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ------------------------------------------------------------------ *
   * Ruido de gradiente 2D (tablas compartidas, semilla fija => estable)
   * ------------------------------------------------------------------ */
  var PERM = new Uint8Array(512);
  var GX = new Float32Array(256);
  var GY = new Float32Array(256);
  (function initNoise() {
    var s = 0x9E3779B9 >>> 0;
    function rnd() { // mulberry32
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var p = [], i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (i = 0; i < 512; i++) PERM[i] = p[i & 255];
    for (i = 0; i < 256; i++) {
      var a = rnd() * TAU;
      GX[i] = Math.cos(a);
      GY[i] = Math.sin(a);
    }
  })();

  /** Ruido de gradiente aprox. en [-1, 1]. */
  function noise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var X = xi & 255, Y = yi & 255;
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var A = PERM[X] + Y, B = PERM[X + 1] + Y;
    var h00 = PERM[A], h10 = PERM[B], h01 = PERM[A + 1], h11 = PERM[B + 1];
    var n00 = GX[h00] * xf + GY[h00] * yf;
    var n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
    var n01 = GX[h01] * xf + GY[h01] * (yf - 1);
    var n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
    var nx0 = n00 + u * (n10 - n00);
    var nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  /* ------------------------------------------------------------------ *
   * Constantes de la escena
   * ------------------------------------------------------------------ */
  var E_MIN = -0.45;          // cota mínima representada en la paleta (fondo marino)
  var E_MAX = 1.55;           // cota máxima representada en la paleta (cumbres)
  var INTERVAL = 0.14;        // equidistancia entre curvas de nivel
  var LINE_FLOOR = -0.3;      // no se dibujan curvas por debajo de esta cota
  var MAJOR_EVERY = 4;        // curva maestra cada N niveles
  var MAX_SEGS = 7000;        // tope de segmentos por clase de línea
  var CELL_PX = 9;            // tamaño objetivo de celda (px CSS) con calidad 1
  var MAX_CELLS = 10500;      // tope de muestras del campo
  var FADE_OUT_S = 0.35;      // duración del fundido de salida
  var FADE_IN_S = 0.45;       // duración del fundido de entrada

  // Tintes de mar (fijos). Las posiciones t son fracciones de [E_MIN, E_MAX].
  var SEA_STOPS = [
    [0.000, '#0a1030'], [0.120, '#12356a'], [0.205, '#1f8fa8'], [0.222, '#35c1bd']
  ];
  // Tintes de tierra por defecto (de la playa a las cumbres).
  var LAND_COLORS = ['#f0dfa8', '#5ab870', '#e2b64a', '#dd7a45', '#c24a62', '#fff2e0'];
  var PALETTE_PRESETS = {
    classic: LAND_COLORS,
    volcanic: ['#f3d6a0', '#b58b62', '#78516b', '#d04e3b', '#ff9b43', '#fff1c2'],
    midnight: ['#b9d5d0', '#559ca5', '#456b9b', '#665b9e', '#b45f91', '#f3c4a2']
  };
  var LAND_START = 0.236;

  function buildLut(landColors) {
    var stops = SEA_STOPS.map(function (s) { return [s[0], hexToRgb(s[1])]; });
    var n = landColors.length;
    for (var i = 0; i < n; i++) {
      stops.push([LAND_START + (1 - LAND_START) * (i / (n - 1)), landColors[i]]);
    }
    var lut = new Uint8ClampedArray(256 * 3);
    var s = 0;
    for (var k = 0; k < 256; k++) {
      var t = k / 255;
      while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
      var a = stops[s], b = stops[s + 1];
      var f = clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
      lut[k * 3] = a[1][0] + (b[1][0] - a[1][0]) * f;
      lut[k * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
      lut[k * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
    }
    return lut;
  }

  function parsePalette(list) {
    if (typeof list === 'string') list = PALETTE_PRESETS[list.toLowerCase()];
    if (!Array.isArray(list) || list.length < 3) return null;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = hexToRgb(list[i]);
      if (!c) return null;
      out.push(c);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Clase principal
   * ------------------------------------------------------------------ */
  class ReliefVisualizer {
    /**
     * @param {HTMLCanvasElement} canvas  Canvas dimensionado por CSS (width/height).
     * @param {{getDataArray?:Function,getTimeDomain?:Function}|null} audioGraph
     * @param {{palette?:string[]}} [options]  palette: ≥3 colores '#rrggbb' opcionales.
     */
    constructor(canvas, audioGraph, options) {
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new TypeError('AuraPlayVisualizers.relief: se requiere un <canvas> válido.');
      }
      this.canvas = canvas;
      this.audioGraph = audioGraph || null;
      this.ctx = canvas.getContext('2d');

      // Ciclo de vida
      this._raf = 0;
      this._running = false;
      this._stopping = false;
      this._destroyed = false;
      this._fade = 0;
      this._last = 0;
      this._time = 0;
      this._frame = 0;
      this._errLogged = false;
      this._boundTick = this._tick.bind(this);
      this._onResize = this._markResize.bind(this);
      this._onVisibility = this._handleVisibility.bind(this);

      // Sensibilidad
      this._sens = 0.7;

      // Geometría / buffers (se asignan en _resize)
      this._w = 0; this._h = 0; this._dpr = 1;
      this._needsResize = true;
      this._cols = 0; this._rows = 0;
      this._E = null; this._U = null; this._V = null;
      this._edgeX = null; this._edgeY = null;
      this._off = null; this._offCtx = null; this._img = null;
      this._quality = 1;
      this._costEma = 0;
      this._lastQChange = 0;
      this._lastCostCheck = 0;

      // Segmentos de curvas de nivel reutilizables: 0 costa, 1 maestras, 2 secundarias
      this._segs = [
        { buf: new Float32Array(MAX_SEGS * 4), n: 0 },
        { buf: new Float32Array(MAX_SEGS * 4), n: 0 },
        { buf: new Float32Array(MAX_SEGS * 4), n: 0 }
      ];

      if (!this.ctx) {
        throw new Error('AuraPlayVisualizers.relief: no se pudo crear el contexto 2D.');
      }

      // Paleta
      this._lut = buildLut((parsePalette(options && options.palette)) || LAND_COLORS.map(hexToRgb));

      // Estado de audio (valores suavizados y auxiliares)
      this._s = { bass: 0.15, mid: 0.17, high: 0.07, hf: 0, energy: 0.1, quake: 0 };
      this._a = { bass: 0, mid: 0, high: 0, hf: 0, energy: 0, sig: 0 };
      this._pk = { bass: 0.3, mid: 0.22, high: 0.1 };
      this._prevHigh = 0;
      this._bAvg = 0;
      this._bPrev = 0;
      this._lastBeat = -10;
      this._ph = 0;      // fase de deriva del terreno (evoluciona con la energía)
      this._phHi = 0;    // fase del detalle fino (evoluciona con los agudos)
      this._p = {};      // parámetros del frame

      // Observadores / listeners
      this._ro = null;
      if (typeof global.ResizeObserver === 'function') {
        try {
          this._ro = new global.ResizeObserver(this._onResize);
          this._ro.observe(canvas);
        } catch (e) { this._ro = null; }
      }
      if (typeof global.addEventListener === 'function') {
        global.addEventListener('resize', this._onResize);
      }
      if (global.document && typeof global.document.addEventListener === 'function') {
        global.document.addEventListener('visibilitychange', this._onVisibility);
      }
    }

    /* ----------------------------- API pública ----------------------------- */

    /** Sensibilidad en [0.4, 1.2]; 0.7 es el valor base. */
    setSensitivity(value) {
      var v = Number(value);
      if (!isFinite(v)) return;
      this._sens = clamp(v, 0.4, 1.2);
    }

    /** Inicia (o reanuda) un único bucle requestAnimationFrame. */
    start() {
      if (this._destroyed || !this.ctx) return;
      this._stopping = false;
      if (!this._running) {
        this._running = true;
        this._fade = 0;
        this._last = 0;
      }
      if (!this._raf && !this._isDocumentHidden()) this._raf = global.requestAnimationFrame(this._boundTick);
    }

    /** stop(): fundido breve y luego detiene. stop(true): detiene y limpia ya. */
    stop(immediate) {
      if (this._destroyed) return;
      if (immediate === true) {
        this._cancelFrame();
        this._running = false;
        this._stopping = false;
        this._fade = 0;
        this.clear();
        return;
      }
      if (this._running) this._stopping = true;
    }

    /** Limpia el canvas de forma segura. */
    clear() {
      var c = this.canvas, ctx = this.ctx;
      if (!c || !ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width || 0, c.height || 0);
    }

    /** Paleta por nombre (classic, volcanic, midnight) o lista de ≥3 colores '#rrggbb'. */
    setPalette(colors) {
      var p = parsePalette(colors);
      if (p) this._lut = buildLut(p);
    }

    /** Detiene todo y libera observadores, listeners y buffers. */
    destroy() {
      if (this._destroyed) return;
      this.stop(true);
      this._destroyed = true;
      if (this._ro) { try { this._ro.disconnect(); } catch (e) { /* noop */ } this._ro = null; }
      if (typeof global.removeEventListener === 'function') {
        global.removeEventListener('resize', this._onResize);
      }
      if (global.document && typeof global.document.removeEventListener === 'function') {
        global.document.removeEventListener('visibilitychange', this._onVisibility);
      }
      this._E = this._U = this._V = this._edgeX = this._edgeY = null;
      this._off = this._offCtx = this._img = null;
      this._segs = null;
      this.audioGraph = null;
      this.ctx = null;
      this.canvas = null;
    }

    /* ------------------------------ Bucle ------------------------------ */

    _cancelFrame() {
      if (this._raf) {
        if (typeof global.cancelAnimationFrame === 'function') global.cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    }

    _markResize() { this._needsResize = true; }

    _isDocumentHidden() {
      return !!(global.document && global.document.visibilityState === 'hidden');
    }

    _handleVisibility() {
      if (this._isDocumentHidden()) {
        this._cancelFrame();
        this._last = 0;
      } else if (this._running && !this._destroyed && !this._raf) {
        this._last = 0;
        this._raf = global.requestAnimationFrame(this._boundTick);
      }
    }

    _tick(ts) {
      this._raf = 0;
      if (!this._running || this._destroyed) return;

      var t0 = nowMs();
      var dt = this._last ? clamp((ts - this._last) / 1000, 0.001, 0.05) : 1 / 60;
      this._last = ts;

      // Fundidos de entrada y salida
      if (this._stopping) {
        this._fade -= dt / FADE_OUT_S;
        if (this._fade <= 0) {
          this._fade = 0;
          this._running = false;
          this._stopping = false;
          this.clear();
          return; // fin del bucle: no se reprograma
        }
      } else if (this._fade < 1) {
        this._fade = Math.min(1, this._fade + dt / FADE_IN_S);
      }

      try {
        if (this._needsResize || (this._w === 0 && (this._frame % 20) === 0)) this._resize();
        if (this._w > 0 && this._h > 0 && this._E) {
          this._update(dt);
          this._computeField();
          this._render();
        }
      } catch (err) {
        if (!this._errLogged && global.console) {
          this._errLogged = true;
          global.console.error('[AuraPlayVisualizers.relief]', err);
        }
      }

      this._frame++;
      this._adaptQuality(nowMs() - t0);
      if (this._running && !this._destroyed && !this._isDocumentHidden()) {
        this._raf = global.requestAnimationFrame(this._boundTick);
      }
    }

    /* --------------------------- Tamaño y buffers --------------------------- */

    _resize() {
      var c = this.canvas;
      this._needsResize = false;
      if (!c) return;
      var rect = typeof c.getBoundingClientRect === 'function' ? c.getBoundingClientRect() : null;
      var cw = (rect && rect.width) || c.clientWidth || 0;
      var ch = (rect && rect.height) || c.clientHeight || 0;
      if (!(cw >= 2 && ch >= 2) || !isFinite(cw) || !isFinite(ch)) {
        this._w = 0; this._h = 0; // oculto o sin tamaño: no se renderiza
        return;
      }
      var dpr = clamp(global.devicePixelRatio || 1, 1, 2);
      var bw = Math.min(4096, Math.round(cw * dpr));
      var bh = Math.min(4096, Math.round(ch * dpr));
      if (c.width !== bw) c.width = bw;
      if (c.height !== bh) c.height = bh;
      this._w = cw; this._h = ch; this._dpr = bw / cw;
      this._allocGrid();
    }

    _allocGrid() {
      var cell = CELL_PX / this._quality;
      var cols = clamp(Math.round(this._w / cell) + 1, 22, 120);
      var rows = clamp(Math.round(this._h / cell) + 1, 22, 120);
      if (cols * rows > MAX_CELLS) {
        var f = Math.sqrt(MAX_CELLS / (cols * rows));
        cols = Math.max(18, Math.round(cols * f));
        rows = Math.max(18, Math.round(rows * f));
      }
      this._cols = cols; this._rows = rows;
      this._E = new Float32Array(cols * rows);
      this._U = new Float32Array(cols);
      this._V = new Float32Array(rows);
      this._edgeX = new Float32Array(cols);
      this._edgeY = new Float32Array(rows);

      var cwp = this._w / cols, chp = this._h / rows;
      var S = 0.5 * Math.min(this._w, this._h);
      var i, j;
      for (i = 0; i < cols; i++) {
        this._U[i] = ((i + 0.5) * cwp - this._w * 0.5) / S;
        this._edgeX[i] = smoothstep(0, 1, Math.min(i, cols - 1 - i) / (0.12 * cols));
      }
      for (j = 0; j < rows; j++) {
        this._V[j] = ((j + 0.5) * chp - this._h * 0.5) / S;
        this._edgeY[j] = smoothstep(0, 1, Math.min(j, rows - 1 - j) / (0.12 * rows));
      }

      // Lienzo fuera de pantalla a resolución de rejilla (se escala con suavizado)
      this._off = null; this._offCtx = null; this._img = null;
      try {
        var doc = global.document;
        var off = doc && doc.createElement ? doc.createElement('canvas') : null;
        if (off) {
          off.width = cols; off.height = rows;
          var octx = off.getContext('2d');
          if (octx) {
            this._off = off; this._offCtx = octx;
            this._img = octx.createImageData(cols, rows);
          }
        }
      } catch (e) { this._off = this._offCtx = this._img = null; }
    }

    /** Ajusta la resolución de la rejilla si el frame cuesta demasiado. */
    _adaptQuality(ms) {
      this._costEma = this._costEma ? this._costEma + (ms - this._costEma) * 0.08 : ms;
      if (this._frame % 45 !== 0 || this._w === 0) return;
      var since = this._frame - this._lastQChange;
      if (since < 180) return;
      if (this._costEma > 13 && this._quality > 0.6) {
        this._quality = Math.max(0.6, this._quality * 0.88);
        this._lastQChange = this._frame;
        this._allocGrid();
      } else if (this._costEma < 3.0 && this._quality < 1) {
        this._quality = Math.min(1, this._quality * 1.08);
        this._lastQChange = this._frame;
        this._allocGrid();
      }
    }

    /* ------------------------------ Audio ------------------------------ */

    _readAudio(dt) {
      var ag = this.audioGraph, freq = null, td = null;
      try { if (ag && typeof ag.getDataArray === 'function') freq = ag.getDataArray(); } catch (e) { freq = null; }
      try { if (ag && typeof ag.getTimeDomain === 'function') td = ag.getTimeDomain(); } catch (e) { td = null; }

      var rb = 0, rm = 0, rh = 0, rms = 0, i;
      if (freq && freq.length >= 16) {
        var n = freq.length;
        var b0 = 1, b1 = Math.max(2, Math.round(n * 0.0075));    // graves   (≈ 20–170 Hz con 1024 bins)
        var m1 = Math.max(b1 + 2, Math.round(n * 0.05));         // medios   (≈ 170–1100 Hz)
        var h1 = Math.max(m1 + 4, Math.min(n, Math.round(n * 0.30))); // agudos (≈ 1.1–6.5 kHz)
        var sum = 0;
        for (i = b0; i < b1; i++) sum += freq[i];
        rb = sum / ((b1 - b0) * 255);
        sum = 0;
        for (i = b1; i < m1; i++) sum += freq[i];
        rm = sum / ((m1 - b1) * 255);
        sum = 0;
        for (i = m1; i < h1; i++) sum += freq[i];
        rh = sum / ((h1 - m1) * 255);
      }
      if (td && td.length >= 16) {
        var stride = Math.max(1, (td.length / 128) | 0), acc = 0, cnt = 0;
        for (i = 0; i < td.length; i += stride) { var d = td[i] - 128; acc += d * d; cnt++; }
        rms = Math.sqrt(acc / Math.max(1, cnt)) / 128;
      }
      if (!isFinite(rb)) rb = 0;
      if (!isFinite(rm)) rm = 0;
      if (!isFinite(rh)) rh = 0;

      // Normalización adaptativa por banda (pico con caída lenta y suelo mínimo)
      var pk = this._pk, decay = Math.exp(-dt * 0.1);
      pk.bass = Math.max(0.30, pk.bass * decay, rb);
      pk.mid = Math.max(0.22, pk.mid * decay, rm);
      pk.high = Math.max(0.10, pk.high * decay, rh);
      var nbRaw = rb / pk.bass;
      var nmRaw = rm / pk.mid;
      var nhRaw = rh / pk.high;

      var g = this._sens / 0.7;
      var a = this._a;
      a.bass = clamp(Math.pow(nbRaw, 1.5) * g, 0, 1);
      a.mid = clamp(Math.pow(nmRaw, 1.4) * g, 0, 1);
      a.high = clamp(Math.pow(nhRaw, 1.3) * g, 0, 1);

      // Flujo de agudos: ataques rápidos (hi-hats, platillos)
      var flux = Math.max(0, nhRaw - this._prevHigh);
      this._prevHigh = nhRaw;
      a.hf = clamp(flux * 5 * g, 0, 1);

      // Presencia de señal: puerta suave para mezclar con la animación de reposo
      var signal = Math.max(rb * 1.1, rm * 1.6, rms * 3);
      a.sig = smoothstep(0.03, 0.16, signal);
      a.energy = clamp((a.bass * 0.5 + a.mid * 0.3 + a.high * 0.2), 0, 1);

      // Detección de pulso sobre el grave
      var t = this._time;
      this._bAvg += (nbRaw - this._bAvg) * (1 - Math.exp(-dt * 2.5));
      var thr = clamp(0.17 / Math.pow(g, 0.7), 0.08, 0.3);
      if (a.sig > 0.35 && nbRaw > 0.45 && nbRaw > this._bPrev &&
          (nbRaw - this._bAvg) > thr && (t - this._lastBeat) > 0.17) {
        this._lastBeat = t;
        this._s.quake = Math.max(this._s.quake, clamp(0.45 + (nbRaw - this._bAvg) * 1.6, 0.45, 1));
      }
      this._bPrev = nbRaw;
    }

    /* ------------------------ Estado y parámetros ------------------------ */

    _update(dt) {
      this._time += dt;
      var t = this._time, s = this._s, a = this._a;
      this._readAudio(dt);

      // Reposo elegante: respiración mínima y visible cuando no hay señal
      var iB = 0.16 + 0.08 * Math.sin(t * 0.8);
      var iM = 0.18 + 0.07 * Math.sin(t * 0.53 + 1.2);
      var iH = 0.07 + 0.04 * Math.sin(t * 1.3 + 2.1);
      var tb = Math.max(iB * 0.6, iB + (a.bass - iB) * a.sig);
      var tm = Math.max(iM * 0.6, iM + (a.mid - iM) * a.sig);
      var th = Math.max(iH * 0.6, iH + (a.high - iH) * a.sig);
      var te = Math.max(0.08, a.energy * a.sig);

      s.bass = clamp(follow(s.bass, tb, dt, 16, 3.2), 0, 1);
      s.mid = clamp(follow(s.mid, tm, dt, 12, 4.0), 0, 1);
      s.high = clamp(follow(s.high, th, dt, 28, 8.0), 0, 1);
      s.hf = clamp(follow(s.hf, a.hf * a.sig, dt, 40, 10), 0, 1);
      s.energy = clamp(follow(s.energy, te, dt, 10, 2.5), 0, 1);
      s.quake *= Math.exp(-dt * 5.5); // el pulso cae en ~180 ms
      if (s.quake < 0.001) s.quake = 0;

      // La energía acelera la evolución del terreno; los agudos, la del detalle fino
      this._ph += dt * (0.035 + 0.16 * s.energy + 0.18 * s.mid + 0.05 * s.quake);
      this._phHi += dt * (0.35 + 2.6 * s.high + 1.5 * s.hf);

      var p = this._p;
      p.R = 0.58 + 0.13 * s.bass + 0.03 * s.quake;          // graves: tamaño de la masa
      p.Wd = 0.60;
      p.Wn = 0.50 + 0.12 * s.mid;                            // medios: relieve articulado
      p.warp = 0.07 + 0.24 * s.mid;                          // medios: torsión del terreno
      p.A2 = 0.03 + 0.09 * s.mid;                            // medios: lóbulos de la silueta
      p.A3 = 0.02 + 0.07 * s.mid;
      p.det = 0.03 + 0.20 * s.high + 0.10 * s.hf;            // agudos: rugosidad fina
      p.hs = 0.82 + 0.50 * s.bass + 0.26 * s.quake + 0.05 * Math.sin(t * 0.45); // graves/pulso: altura
      p.off = -0.02;
      var ph = this._ph;
      p.ph2 = ph * 0.9 + 0.7;
      p.ph3 = -ph * 0.7 + 2.1;
      p.o1x = ph * 0.80; p.o1y = ph * 0.50;
      p.o2x = -ph * 0.60 + 5.2; p.o2y = ph * 0.70 + 1.3;
      p.oAx = ph * 0.55 + 3.1; p.oAy = -ph * 0.35 + 7.7;
      p.oCx = this._phHi * 0.9; p.oCy = -this._phHi * 0.7 + 3.3;
      p.light = -2.3 + 0.35 * Math.sin(ph * 2.2) + 0.5 * s.quake;
      var beatAge = t - this._lastBeat;
      p.ripple = beatAge >= 0 && beatAge < 0.9 ? (1 - beatAge / 0.9) : 0;
      p.rippleCenter = 0.18 + (1 - p.ripple) * 0.95;
      p.rippleAmp = 0.055 * p.ripple;
    }

    /* ----------------------- Campo de elevación E(x,y) ----------------------- */

    _computeField() {
      var cols = this._cols, rows = this._rows, E = this._E, U = this._U, V = this._V;
      var p = this._p;
      var warp = p.warp, invR = 1 / p.R, A2 = p.A2, A3 = p.A3;
      var c2p = Math.cos(p.ph2), s2p = Math.sin(p.ph2);
      var c3p = Math.cos(p.ph3), s3p = Math.sin(p.ph3);
      var Wd = p.Wd, Wn = p.Wn, det = p.det, hs = p.hs, off = p.off;
      var o1x = p.o1x, o1y = p.o1y, o2x = p.o2x, o2y = p.o2y;
      var oAx = p.oAx, oAy = p.oAy, oCx = p.oCx, oCy = p.oCy;
      var idx = 0;
      for (var j = 0; j < rows; j++) {
        var v = V[j];
        for (var i = 0; i < cols; i++) {
          var u = U[i];
          // Deformación de dominio (dos campos de ruido desplazan las coordenadas)
          var pu = u + warp * noise(u * 1.15 + o1x, v * 1.15 + o1y);
          var pv = v + warp * noise(u * 1.15 + o2x, v * 1.15 + o2y);
          // Cúpula con silueta lobulada (armónicos 2 y 3 sin usar atan2)
          var r2 = pu * pu + pv * pv + 1e-6;
          var ir = 1 / Math.sqrt(r2), ir2 = ir * ir;
          var cc2 = (pu * pu - pv * pv) * ir2, ss2 = 2 * pu * pv * ir2;
          var cc3 = (pu * pu * pu - 3 * pu * pv * pv) * ir2 * ir;
          var ss3 = (3 * pu * pu * pv - pv * pv * pv) * ir2 * ir;
          var lobe = A2 * (cc2 * c2p + ss2 * s2p) + A3 * (cc3 * c3p + ss3 * s3p);
          var rn = r2 * ir * invR / (1 + lobe);
          var dome = 1 - rn * rn * Math.sqrt(rn);
          // fBm de 3 octavas + detalle fino
          var nx = pu * 1.9 + oAx, ny = pv * 1.9 + oAy;
          var nf = (noise(nx, ny) + 0.5 * noise(nx * 2.03 + 11.7, ny * 2.03 - 4.3) +
                    0.25 * noise(nx * 4.1 - 7.9, ny * 4.1 + 13.1)) * 0.5714;
          var dn = noise(pu * 7.3 + oCx, pv * 7.3 + oCy);
          var ring = 0;
          if (p.rippleAmp > 0) {
            var ringDelta = (rn - p.rippleCenter) / 0.075;
            ring = p.rippleAmp * Math.exp(-(ringDelta * ringDelta));
          }
          E[idx++] = (Wd * dome + Wn * nf + det * dn + ring + off) * hs;
        }
      }
    }

    /* ------------------------------- Dibujo ------------------------------- */

    /** Pinta tintes hipsométricos y sombreado de ladera en el lienzo pequeño. */
    _shadeTerrain() {
      var img = this._img, octx = this._offCtx;
      if (!img || !octx) return false;
      var cols = this._cols, rows = this._rows, E = this._E, d = img.data, lut = this._lut;
      var S = 0.5 * Math.min(this._w, this._h);
      var du = (this._w / cols) / S;
      var shK = 0.08 / du;
      var la = this._p.light, lx = Math.cos(la), ly = Math.sin(la);
      var q = this._s.quake, flash = 0.28 * q;
      var ex = this._edgeX, ey = this._edgeY;
      var range = 255 / (E_MAX - E_MIN);
      var o = 0;
      for (var j = 0; j < rows; j++) {
        var jm = (j > 0 ? j - 1 : 0) * cols, jp = (j < rows - 1 ? j + 1 : j) * cols, row = j * cols;
        var eyj = ey[j];
        for (var i = 0; i < cols; i++) {
          var im = i > 0 ? i - 1 : 0, ip = i < cols - 1 ? i + 1 : i;
          var e = E[row + i];
          var gx = E[row + ip] - E[row + im];
          var gy = E[jp + i] - E[jm + i];
          var sh = clamp(0.5 - shK * (gx * lx + gy * ly), 0, 1);
          var m = e < 0 ? 0.9 + 0.45 * (sh - 0.5) : 0.62 + 0.9 * sh;
          // Luz secundaria tenue para separar laderas sin usar shadowBlur.
          m += (clamp(0.5 - shK * (gx * 0.6 - gy * 0.8), 0, 1) - 0.5) * 0.08;
          m += flash;
          var li = ((e - E_MIN) * range) | 0;
          li = (li < 0 ? 0 : (li > 255 ? 255 : li)) * 3;
          var coast = Math.max(0, 1 - Math.abs(e) * 12);
          var foam = coast * coast * (58 + 18 * this._s.bass + 12 * this._s.quake) *
            (0.82 + 0.18 * Math.sin(this._time * 2.2 + i * 0.16 + j * 0.11));
          var atmosphere = (1 - ex[i] * eyj) * 0.035;
          d[o] = lut[li] * (m + atmosphere) + foam;
          d[o + 1] = lut[li + 1] * (m + atmosphere) + foam;
          d[o + 2] = lut[li + 2] * (m + atmosphere) + foam;
          d[o + 3] = smoothstep(-0.24, -0.03, e) * 255 * ex[i] * eyj;
          o += 4;
        }
      }
      octx.putImageData(img, 0, 0);
      return true;
    }

    /** Marching squares sobre E: reparte segmentos en costa / maestras / secundarias. */
    _contours() {
      var cols = this._cols, rows = this._rows, E = this._E, segs = this._segs;
      segs[0].n = segs[1].n = segs[2].n = 0;
      var inv = 1 / INTERVAL;
      for (var j = 0; j < rows - 1; j++) {
        var row = j * cols;
        for (var i = 0; i < cols - 1; i++) {
          var a = E[row + i], b = E[row + i + 1];
          var c = E[row + cols + i + 1], d = E[row + cols + i];
          var mx = Math.max(a, b, c, d);
          if (mx < LINE_FLOOR) continue;
          var mn = Math.min(a, b, c, d);
          var k0 = Math.ceil(Math.max(mn, LINE_FLOOR) * inv), k1 = Math.floor(mx * inv);
          for (var k = k0; k <= k1; k++) {
            var L = k * INTERVAL;
            var code = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
            if (code === 0 || code === 15) continue;
            var cls = k === 0 ? 0 : ((k > 0 && (k % MAJOR_EVERY) === 0) ? 1 : 2);
            var s = segs[cls];
            if (s.n >= MAX_SEGS) continue;
            // Puntos de cruce en los cuatro bordes de la celda (coordenadas de rejilla)
            var tX = i + (L - a) / (b - a), tY = j;       // superior
            var rX = i + 1, rY = j + (L - b) / (c - b);   // derecho
            var bX = i + (L - d) / (c - d), bY = j + 1;   // inferior
            var lX = i, lY = j + (L - a) / (d - a);       // izquierdo
            switch (code) {
              case 1: case 14: this._seg(s, lX, lY, bX, bY); break;
              case 2: case 13: this._seg(s, bX, bY, rX, rY); break;
              case 3: case 12: this._seg(s, lX, lY, rX, rY); break;
              case 4: case 11: this._seg(s, tX, tY, rX, rY); break;
              case 6: case 9: this._seg(s, tX, tY, bX, bY); break;
              case 7: case 8: this._seg(s, tX, tY, lX, lY); break;
              case 5:
                if ((a + b + c + d) * 0.25 >= L) { this._seg(s, tX, tY, lX, lY); this._seg(s, rX, rY, bX, bY); }
                else { this._seg(s, tX, tY, rX, rY); this._seg(s, lX, lY, bX, bY); }
                break;
              case 10:
                if ((a + b + c + d) * 0.25 >= L) { this._seg(s, tX, tY, rX, rY); this._seg(s, lX, lY, bX, bY); }
                else { this._seg(s, tX, tY, lX, lY); this._seg(s, rX, rY, bX, bY); }
                break;
              default: break;
            }
          }
        }
      }
    }

    _seg(s, x1, y1, x2, y2) {
      if (s.n >= MAX_SEGS) return;
      var o = s.n * 4, b = s.buf;
      b[o] = x1; b[o + 1] = y1; b[o + 2] = x2; b[o + 3] = y2;
      s.n++;
    }

    _strokeSegs(s, cw, ch) {
      var ctx = this.ctx, b = s.buf, n = s.n * 4;
      if (!s.n) return;
      ctx.beginPath();
      for (var o = 0; o < n; o += 4) {
        ctx.moveTo((b[o] + 0.5) * cw, (b[o + 1] + 0.5) * ch);
        ctx.lineTo((b[o + 2] + 0.5) * cw, (b[o + 3] + 0.5) * ch);
      }
      ctx.stroke();
    }

    /** Destellos sobre curvas maestras y costa; su cantidad la fijan los agudos. */
    _glints(cw, ch, u) {
      var ctx = this.ctx, s = this._s;
      var prob = Math.min(0.26, 0.015 + 0.2 * s.high + 0.12 * s.hf);
      var tick = (this._time * 16) | 0;
      var seed = Math.imul(tick, 0x9E3779B1);
      var total = this._segs[0].n + this._segs[1].n;
      var stride = Math.max(1, Math.ceil(total / 1200));
      ctx.beginPath();
      for (var c = 0; c < 2; c++) {
        var sg = this._segs[c], b = sg.buf;
        var first = c === 0 ? 0 : ((stride - (this._segs[0].n % stride)) % stride);
        for (var n = first; n < sg.n; n += stride) {
          var h = Math.imul(n + c * 9973 ^ seed, 0x85EBCA6B);
          h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
          if (((h >>> 0) / 4294967296) < prob) {
            var o = n * 4;
            var x = ((b[o] + b[o + 2]) * 0.5 + 0.5) * cw;
            var y = ((b[o + 1] + b[o + 3]) * 0.5 + 0.5) * ch;
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.01, y);
          }
        }
      }
      ctx.lineWidth = (1.8 + 1.6 * s.high) * u;
      ctx.strokeStyle = 'rgba(255,255,240,0.9)';
      ctx.stroke();
    }

    _render() {
      var ctx = this.ctx, w = this._w, h = this._h, s = this._s;
      var cols = this._cols, rows = this._rows;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (this._fade <= 0.001) return;
      ctx.globalAlpha = this._fade;
      ctx.globalCompositeOperation = 'source-over';

      // 1) Tintes y sombreado
      if (this._shadeTerrain()) {
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this._off, 0, 0, cols, rows, 0, 0, w, h);
      }

      // 2) Curvas de nivel
      this._contours();
      var cw = w / cols, ch = h / rows;
      var S = 0.5 * Math.min(w, h);
      var u = clamp(S / 320, 0.7, 1.5);
      var q = s.quake;
      var segs = this._segs;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Resplandor suave de maestras y costa (sin shadowBlur)
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = (4 + 4 * q + 2 * s.bass) * u;
      ctx.strokeStyle = 'rgba(255,230,190,' + (0.06 + 0.12 * q).toFixed(3) + ')';
      this._strokeSegs(segs[1], cw, ch);
      this._strokeSegs(segs[0], cw, ch);
      ctx.globalCompositeOperation = 'source-over';

      // Curvas secundarias, como tinta oscura (se omiten en lienzos muy pequeños)
      if (S >= 55) {
        ctx.lineWidth = 0.8 * u;
        ctx.strokeStyle = 'rgba(12,14,36,' + (0.20 + 0.16 * s.high + 0.08 * s.bass).toFixed(3) + ')';
        this._strokeSegs(segs[2], cw, ch);
      }
      // Curvas maestras
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = 'rgba(255,248,235,' + (0.55 + 0.3 * q).toFixed(3) + ')';
      this._strokeSegs(segs[1], cw, ch);
      // Línea de costa
      ctx.lineWidth = (1.8 + 1.2 * q) * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      this._strokeSegs(segs[0], cw, ch);

      // 3) Destellos de agudos
      ctx.globalCompositeOperation = 'lighter';
      this._glints(cw, ch, u);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------------ *
   * Registro en el namespace global
   * ------------------------------------------------------------------ */
  global[NS_NAME] = global[NS_NAME] || {};
  global[NS_NAME][ID] = ReliefVisualizer;

})(typeof window !== 'undefined' ? window : globalThis);
