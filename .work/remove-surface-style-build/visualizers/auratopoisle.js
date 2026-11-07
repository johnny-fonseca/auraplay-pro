/*!
 * AuraPlay Pro — Visualizador "Isla topográfica"  (id técnico: topoIsle)
 * ---------------------------------------------------------------------------
 * Una isla de relieve sombreado con curvas de nivel que respira con la música.
 *
 *   - Graves   -> la isla se hincha: más masa, más altura, sombras más hondas
 *                 y aparecen más curvas de nivel (nuevas isohipsas brotan de las cumbres).
 *   - Medios   -> el terreno se articula: la costa cambia de forma (bahías, penínsulas)
 *                 y las crestas migran (deriva tectónica).
 *   - Agudos   -> detalle fino: rugosidad de alta frecuencia, curvas "menores"
 *                 que aparecen como un entramado fino y algún islote en la costa.
 *   - Beat     -> "marea": el nivel del mar baja ~250 ms, la costa destella con una
 *                 espuma clara y el relieve se ilumina un instante.
 *   - Silencio -> respiración lenta y visible; se mezcla con la señal real.
 *
 * Técnicas (originales, sin dependencias): campo escalar = fBm de ruido de valor 3D
 * (el eje Z es el tiempo) + máscara de isla por distancia; curvas de nivel con
 * marching squares + interpolación lineal; relieve con sombreado direccional.
 *
 * Bandas (fracciones de la longitud del array de frecuencias, NO Hz fijos):
 *   graves  = bins [1 .. 1 %)      medios = [1 % .. 5 %)      agudos = [5 % .. 30 %)
 *
 * Registro global:  window.AuraPlayVisualizers.topoIsle  (la clase Visualizer)
 *
 * API:
 *   const v = new window.AuraPlayVisualizers.topoIsle(canvas, audioGraph);
 *   v.setSensitivity(0.7);   // 0.4–1.2
 *   v.start(); v.stop(); v.stop(true); v.clear(); v.destroy();
 *   v.setPalette(['#2a9d8f','#8ab17d','#e9c46a','#f4a261','#fff1e0']); // opcional
 *
 * Requisitos de integración:
 *   - El canvas debe dimensionarse por CSS (width/height en CSS). El módulo ajusta
 *     el bitmap al tamaño medido; si el canvas no tiene tamaño CSS propio el tope
 *     de bitmap evita un bucle de crecimiento.
 *   - Diseñado para fondos oscuros: el mar es transparente (no pinta fondo).
 *   - No necesita portada. Si se quiere, la portada puede alimentar setPalette().
 *
 * Contrato de audio (puede devolver null, lanzar o no existir):
 *   audioGraph.getDataArray()  -> Uint8Array de frecuencias (0–255) o null
 *   audioGraph.getTimeDomain() -> Uint8Array centrado en ≈128 o null (solo se usa su RMS)
 *
 * Licencia: código original, sin dependencias ni assets externos.
 * Inspiración conceptual (sin copiar código): ver informe de entrega.
 */
(function (global) {
  'use strict';

  var NS = global.AuraPlayVisualizers = global.AuraPlayVisualizers || {};

  // ------------------------------------------------------------------ límites
  var MAX_DPR = 2;          // devicePixelRatio máximo
  var MAX_BITMAP = 1600;    // tope por lado del bitmap del canvas principal
  var MAX_GRID = 80;        // vértices por lado del campo de altura (máx.)
  var MIN_GRID = 32;        // vértices por lado (mín.)
  var MAX_SEG = 24000;      // segmentos máx. por clase de línea (coste acotado)
  var MARGIN = 0.03;        // margen libre alrededor de la isla (fracción del lado menor)
  var LEVEL_STEP = 0.06;    // equidistancia entre curvas de nivel (unidades de altura)
  var QUALITY_SCALE = [1, 0.85, 0.68]; // escala de rejilla por nivel de calidad
  var SHALLOW_W = 0.10;     // anchura (en altura) de la aguas someras translúcidas
  var SHALLOW_A = 0.22;     // opacidad máxima de las aguas someras

  // ------------------------------------------------------------ utilidades
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function nowMs() {
    return (global.performance && typeof global.performance.now === 'function')
      ? global.performance.now() : Date.now();
  }
  // Coeficiente de suavizado independiente del framerate.
  function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
  // Compresión suave por encima de 0.85 (evita saturaciones duras con sensibilidad alta).
  function softClip(v) {
    if (v <= 0.85) return v < 0 ? 0 : v;
    return 0.85 + 0.30 * (1 - Math.exp(-(v - 0.85) / 0.30));
  }
  function safeCall(obj, name) {
    try {
      if (obj && typeof obj[name] === 'function') return obj[name]();
    } catch (e) { /* un audioGraph defectuoso no debe romper el visualizador */ }
    return null;
  }

  // ----------------------------------------------------- ruido de valor 3D
  // Retícula periódica 32×32×32 con valores pseudoaleatorios deterministas
  // (mulberry32). Un acceso por esquina, sin hashing por muestra.
  var LAT = (function () {
    var a = new Float32Array(32768);
    var s = 0x9e3779b9 >>> 0;
    for (var i = 0; i < a.length; i++) {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      a[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
    return a;
  })();

  // Ruido de valor trilineal con fade quíntico; devuelve ≈[-1, 1]. Z = tiempo.
  function noise3(x, y, z) {
    var xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
    var fx = x - xf, fy = y - yf, fz = z - zf;
    var u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    var v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    var w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    var x0 = xf & 31, x1 = (xf + 1) & 31;
    var y0 = (yf & 31) << 5, y1 = ((yf + 1) & 31) << 5;
    var z0 = (zf & 31) << 10, z1 = ((zf + 1) & 31) << 10;
    var a = LAT[z0 | y0 | x0], b = LAT[z0 | y0 | x1];
    var c = LAT[z0 | y1 | x0], d = LAT[z0 | y1 | x1];
    var e = LAT[z1 | y0 | x0], f = LAT[z1 | y0 | x1];
    var g = LAT[z1 | y1 | x0], h = LAT[z1 | y1 | x1];
    var k0 = a + (b - a) * u, k1 = c + (d - c) * u;
    var k2 = e + (f - e) * u, k3 = g + (h - g) * u;
    var m0 = k0 + (k1 - k0) * v, m1 = k2 + (k3 - k2) * v;
    return m0 + (m1 - m0) * w;
  }

  // ---------------------------------------------------------------- paleta
  var DEFAULT_STOPS = ['#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#fff1e0'];

  function parseHex(c) {
    if (typeof c !== 'string') return null;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Tabla de 256 entradas RGB (elevación normalizada 0..1 -> color de tierra).
  function buildLUT(stops, lut) {
    var n = stops.length;
    for (var i = 0; i < 256; i++) {
      var t = (i / 255) * (n - 1);
      var k = Math.min(n - 2, Math.floor(t));
      var f = t - k;
      var A = stops[k], B = stops[k + 1];
      lut[i * 3] = A[0] + (B[0] - A[0]) * f;
      lut[i * 3 + 1] = A[1] + (B[1] - A[1]) * f;
      lut[i * 3 + 2] = A[2] + (B[2] - A[2]) * f;
    }
  }

  // Aristas del marching squares: 0 = arriba, 1 = derecha, 2 = abajo, 3 = izquierda.
  // Tabla (A,B) por caso para los casos de un solo segmento; 5 y 10 son sillas.
  var EDGE_A = [0, 3, 2, 3, 0, 0, 0, 3, 3, 0, 0, 0, 3, 2, 3, 0];
  var EDGE_B = [0, 2, 1, 1, 1, 0, 2, 0, 0, 2, 0, 1, 1, 1, 2, 0];

  // ============================================================== Visualizer
  class Visualizer {
    constructor(canvas, audioGraph) {
      this.canvas = canvas || null;
      this.audioGraph = audioGraph || null;
      this.ctx = null;
      try {
        if (this.canvas && typeof this.canvas.getContext === 'function') {
          this.ctx = this.canvas.getContext('2d');
        }
      } catch (e) { this.ctx = null; }

      this._destroyed = false;
      this._running = false;
      this._stopping = false;
      this._raf = 0;
      this._rafIsTimer = false;
      this._last = 0;
      this._time = 0;
      this._warned = false;
      this._hidden = true;

      this.sens = 0.7;
      this.fade = 0;

      // Tamaños
      this.cssW = 0; this.cssH = 0; this.dpr = 1;
      this.bw = 0; this.bh = 0;
      this.side = 0;          // lado (px de bitmap) del cuadrado donde se dibuja la isla
      this.layerSize = 0;     // = side (unidades de dibujo de la isla)
      this.G = 0;
      this.quality = 0;
      // Rejilla de color (G×G px) que se escala sobre el canvas principal
      this.cellCv = null; this.cellCtx = null; this.cellImg = null;

      // Campo (se asigna en _allocGrid)
      this.F = null; this.px = null; this.py = null; this.rad = null;
      this.s2 = null; this.c2 = null; this.s3 = null; this.c3 = null; this.win = null;

      // Segmentos de curvas de nivel: 0 = costa, 1 = principales, 2 = menores
      this.segs = [null, null, null];
      this.segN = [0, 0, 0];
      this._ex = new Float64Array(4);
      this._ey = new Float64Array(4);

      // Paleta
      this.lut = new Float32Array(256 * 3);
      this.shallow = [60, 190, 180];
      this._applyStops(DEFAULT_STOPS.map(parseHex));

      // Estado de audio
      this.pB = 0.2; this.pM = 0.15; this.pT = 0.08;      // picos adaptativos
      this.presence = 0;
      this.bass = 0; this.mid = 0; this.treb = 0; this.bassSlow = 0; this.energy = 0;
      this.avgE = 0.3; this.prevE = 0;
      this.beat = 0; this.beatHold = 0; this.beatTarget = 0; this.lastBeat = -10;

      // Estado del campo
      this.z = 3.7; this.ox = 0; this.oy = 0; this.ph2 = 0.8; this.ph3 = 2.1;

      // Rendimiento adaptativo
      this.msEma = 6; this._slowT = 0; this._fastT = 0; this._cool = 0;

      var self = this;
      this._onFrame = function (ts) { self._frame(ts); };
      this._onResize = function () { if (!self._destroyed) self._resize(); };
      this._onWindowResize = function () {
        var dpr = Math.min(MAX_DPR, global.devicePixelRatio || 1);
        if (!self._destroyed && (!self._ro || dpr !== self.dpr)) self._resize();
      };

      // ResizeObserver detecta cambios de tamaño/visibilidad del canvas sin
      // consultar geometría en cada frame. El resize de ventana también cubre DPR.
      this._ro = null;
      this._winResize = false;
      try {
        if (typeof global.ResizeObserver === 'function' && this.canvas) {
          this._ro = new global.ResizeObserver(this._onResize);
          this._ro.observe(this.canvas);
        }
      } catch (e) {
        try { if (this._ro) this._ro.disconnect(); } catch (e2) { /* noop */ }
        this._ro = null;
      }
      if (typeof global.addEventListener === 'function') {
        global.addEventListener('resize', this._onWindowResize, { passive: true });
        this._winResize = true;
      }

      this._resize();
    }

    // ---------------------------------------------------------------- API
    setSensitivity(value) {
      if (this._destroyed) return;
      var v = Number(value);
      if (!isFinite(v)) return;
      this.sens = clamp(v, 0.4, 1.2);
    }

    // Opcional: 3–6 colores hex de menor a mayor altitud.
    setPalette(colors) {
      if (this._destroyed || !colors || !colors.length) return;
      var stops = [];
      for (var i = 0; i < colors.length && stops.length < 6; i++) {
        var c = parseHex(colors[i]);
        if (c) stops.push(c);
      }
      if (stops.length >= 2) this._applyStops(stops);
    }

    start() {
      if (this._destroyed || !this.ctx) return;
      this._stopping = false;          // cancela un fundido de salida en curso
      if (!this._running) {
        this._running = true;
        this._last = 0;
        this._resize();
      }
      if (!this._raf) this._schedule();   // un único bucle, nunca duplicado
    }

    stop(immediate) {
      if (this._destroyed) return;
      if (immediate === true) {
        this._halt();
        this._clearCanvas();
        return;
      }
      if (this._running) this._stopping = true;   // fundido ≈350 ms y luego _halt()
    }

    clear() {
      if (this._destroyed) return;
      this._clearCanvas();
    }

    destroy() {
      if (this._destroyed) return;
      this._halt();
      this._clearCanvas();
      this._destroyed = true;
      try { if (this._ro) this._ro.disconnect(); } catch (e) { /* noop */ }
      this._ro = null;
      try {
        if (this._winResize && typeof global.removeEventListener === 'function') {
          global.removeEventListener('resize', this._onWindowResize);
        }
      } catch (e) { /* noop */ }
      this._winResize = false;
      // Liberar capas y búferes
      try { if (this.cellCv) { this.cellCv.width = 0; this.cellCv.height = 0; } } catch (e) { /* noop */ }
      this.cellCv = this.cellCtx = this.cellImg = null;
      this.F = this.px = this.py = this.rad = this.s2 = this.c2 = this.s3 = this.c3 = this.win = null;
      this.segs = [null, null, null];
      this.ctx = null;
      this.canvas = null;
      this.audioGraph = null;
    }

    // ------------------------------------------------------ bucle interno
    _schedule() {
      var raf = global.requestAnimationFrame;
      if (typeof raf === 'function') {
        this._rafIsTimer = false;
        this._raf = raf.call(global, this._onFrame);
      } else {
        this._rafIsTimer = true;
        var self = this;
        this._raf = setTimeout(function () { self._onFrame(nowMs()); }, 16);
      }
    }

    _cancelFrame() {
      if (!this._raf) return;
      try {
        if (this._rafIsTimer) clearTimeout(this._raf);
        else if (typeof global.cancelAnimationFrame === 'function') global.cancelAnimationFrame(this._raf);
      } catch (e) { /* noop */ }
      this._raf = 0;
    }

    _halt() {
      this._running = false;
      this._stopping = false;
      this._cancelFrame();
      this.fade = 0;
      this._last = 0;
    }

    _clearCanvas() {
      var ctx = this.ctx, cv = this.canvas;
      if (!ctx || !cv) return;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, cv.width, cv.height);
      } catch (e) { /* noop */ }
    }

    _frame(ts) {
      this._raf = 0;
      if (this._destroyed || !this._running) return;
      this._schedule();                  // se reprograma primero: un error no mata el bucle
      try {
        this._step(typeof ts === 'number' ? ts : nowMs());
      } catch (e) {
        if (!this._warned) {            // registrar como máximo una vez
          this._warned = true;
          try { console.error('[AuraPlay topoIsle] error en frame:', e); } catch (e2) { /* noop */ }
        }
      }
    }

    _step(ts) {
      var dt = this._last ? clamp((ts - this._last) / 1000, 0.001, 0.05) : 1 / 60;
      this._last = ts;
      this._time += dt;
      // Fundidos de entrada / salida
      if (this._stopping) {
        this.fade -= dt / 0.35;
        if (this.fade <= 0) { this._halt(); this._clearCanvas(); return; }
      } else if (this.fade < 1) {
        this.fade = Math.min(1, this.fade + dt / 0.28);
      }

      // ResizeObserver despierta _resize() al cambiar el tamaño o visibilidad.
      if (this._hidden) return;
      if (!this.F || !this.cellCtx || !this.ctx) return;

      this._analyse(dt, ts / 1000);

      var t0 = nowMs();
      this._updateField(dt);
      this._shade();
      this._contours();
      this._compose();
      this._adapt(nowMs() - t0, dt);
    }

    // ------------------------------------------------------------ tamaño
    _resize() {
      var cv = this.canvas;
      if (this._destroyed || !cv) return false;

      var r;
      try { r = cv.getBoundingClientRect(); } catch (e) { return false; }
      var w = r && r.width, h = r && r.height;
      if (!(w > 1) || !(h > 1)) { this._hidden = true; return false; }

      var dpr = Math.min(MAX_DPR, global.devicePixelRatio || 1);
      if (w === this.cssW && h === this.cssH && dpr === this.dpr) {
        this._hidden = false;
        return true;
      }
      var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      var big = Math.max(bw, bh);
      if (big > MAX_BITMAP) {
        var k = MAX_BITMAP / big;
        bw = Math.max(1, Math.round(bw * k));
        bh = Math.max(1, Math.round(bh * k));
      }
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;

      this.cssW = w; this.cssH = h; this.dpr = dpr;
      this.bw = bw; this.bh = bh;
      this.side = Math.max(48, Math.floor(Math.min(bw, bh) * (1 - 2 * MARGIN)));
      this._hidden = false;
      this._allocLayer();
      return true;
    }

    _newCanvas() {
      var doc = (this.canvas && this.canvas.ownerDocument) || global.document;
      return doc.createElement('canvas');
    }

    // (Re)calcula la rejilla según el tamaño y el nivel de calidad.
    _allocLayer() {
      var L = this.side;
      if (!this.cellCv) {
        this.cellCv = this._newCanvas();
        this.cellCtx = this.cellCv.getContext('2d');
      }
      this.layerSize = L;
      var G = clamp(Math.round((L / 6.4) * QUALITY_SCALE[this.quality]), MIN_GRID, MAX_GRID);
      if (G !== this.G || !this.F) this._allocGrid(G);
      this.msEma = 6; this._slowT = 0; this._fastT = 0;
    }

    _allocGrid(G) {
      this.G = G;
      var N = G * G;
      this.F = new Float32Array(N);
      this.px = new Float32Array(N); this.py = new Float32Array(N);
      this.rad = new Float32Array(N); this.win = new Float32Array(N);
      this.s2 = new Float32Array(N); this.c2 = new Float32Array(N);
      this.s3 = new Float32Array(N); this.c3 = new Float32Array(N);
      for (var j = 0; j < G; j++) {
        for (var i = 0; i < G; i++) {
          var k = j * G + i;
          var x = (i / (G - 1)) * 2 - 1, y = (j / (G - 1)) * 2 - 1;
          var d = Math.sqrt(x * x + y * y);
          var th = Math.atan2(y, x);
          this.px[k] = x; this.py[k] = y; this.rad[k] = d;
          // Ventana de contención: 1 hasta d = 0.60, 0 desde d = 0.93.
          this.win[k] = 1 - smoothstep(0.60, 0.93, d);
          this.s2[k] = Math.sin(2 * th); this.c2[k] = Math.cos(2 * th);
          this.s3[k] = Math.sin(3 * th); this.c3[k] = Math.cos(3 * th);
        }
      }
      this.cellCv.width = G; this.cellCv.height = G;
      this.cellImg = this.cellCtx.createImageData(G, G);
      if (!this.segs[0]) {
        for (var s = 0; s < 3; s++) this.segs[s] = new Float32Array(MAX_SEG * 4);
      }
    }

    _applyStops(stops) {
      buildLUT(stops, this.lut);
      var s = stops[0];
      // Aguas someras: primer color aclarado hacia el blanco.
      this.shallow = [s[0] + (255 - s[0]) * 0.25, s[1] + (255 - s[1]) * 0.25, s[2] + (255 - s[2]) * 0.25];
    }

    // ------------------------------------------------------------- audio
    _analyse(dt, tSec) {
      var g = this.audioGraph;
      var d = safeCall(g, 'getDataArray');
      var td = safeCall(g, 'getTimeDomain');

      var rawB = 0, rawM = 0, rawT = 0, rms = 0;
      if (d && d.length > 8) {
        var L = d.length;
        var bE = Math.max(2, Math.round(L * 0.01));          // graves:  [1, 1 %)
        var mE = Math.max(bE + 2, Math.round(L * 0.05));     // medios:  [1 %, 5 %)
        var tE = Math.min(L, Math.max(mE + 4, Math.round(L * 0.30))); // agudos: [5 %, 30 %)
        var i, s = 0;
        for (i = 1; i < bE; i++) s += d[i];
        rawB = s / ((bE - 1) * 255); s = 0;
        for (i = bE; i < mE; i++) s += d[i];
        rawM = s / ((mE - bE) * 255); s = 0;
        for (i = mE; i < tE; i++) s += d[i];
        rawT = s / ((tE - mE) * 255);
      }
      if (td && td.length > 8) {
        var acc = 0, n = 0;
        for (var j = 0; j < td.length; j += 2) { var v = (td[j] - 128) / 128; acc += v * v; n++; }
        rms = Math.sqrt(acc / n);
      }

      // Presencia de señal (0 = silencio, 1 = música), con histéresis temporal.
      var lvl = Math.max((rawB + rawM + rawT) / 3, rms);
      var pt = smoothstep(0.012, 0.05, lvl);
      this.presence += (pt - this.presence) * ease(dt, pt > this.presence ? 0.08 : 0.6);

      // Razón respecto al pico ANTERIOR (sin recortar a 1, tope 2): sirve para el beat.
      // Si se usara el pico ya actualizado con este frame, un golpe que sube el nivel
      // también subiría su propia referencia y quedaría igual que el colchón sostenido.
      var rB = Math.min(2, rawB / Math.max(this.pB, 0.10));
      var rM = Math.min(2, rawM / Math.max(this.pM, 0.06));

      // Normalización adaptativa: pico con caída lenta (≈5 s) y suelo mínimo.
      var dec = Math.exp(-dt / 5);
      this.pB = Math.max(rawB, this.pB * dec, 0.10);
      this.pM = Math.max(rawM, this.pM * dec, 0.06);
      this.pT = Math.max(rawT, this.pT * dec, 0.035);
      var nB = Math.pow(clamp(rawB / this.pB, 0, 1), 1.2);
      var nM = Math.pow(clamp(rawM / this.pM, 0, 1), 1.2);
      var nT = Math.pow(clamp(rawT / this.pT, 0, 1), 1.2);

      // La sensibilidad actúa sobre la señal ya normalizada (0.7 = ganancia 1).
      var gain = this.sens / 0.7;
      var xB = softClip(nB * gain), xM = softClip(nM * gain), xT = softClip(nT * gain);

      // Reposo: respiración lenta que se mezcla con la señal real.
      var iB = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(tSec * 0.7));
      var iM = 0.07 + 0.04 * (0.5 + 0.5 * Math.sin(tSec * 0.43 + 1.7));
      var iT = 0.02 + 0.02 * (0.5 + 0.5 * Math.sin(tSec * 0.9 + 0.6));
      var p = this.presence;
      var tB = iB + (xB - iB) * p, tM = iM + (xM - iM) * p, tT = iT + (xT - iT) * p;

      // Ataque rápido, caída lenta (independiente del framerate).
      this.bass += (tB - this.bass) * ease(dt, tB > this.bass ? 0.05 : 0.45);
      this.mid += (tM - this.mid) * ease(dt, tM > this.mid ? 0.05 : 0.30);
      this.treb += (tT - this.treb) * ease(dt, tT > this.treb ? 0.03 : 0.16);
      this.bassSlow += (tB - this.bassSlow) * ease(dt, 0.9);
      var en = 0.5 * this.bass + 0.3 * this.mid + 0.2 * this.treb;
      this.energy += (en - this.energy) * ease(dt, 0.25);

      // Beat: energía (graves+medios normalizados) por encima de su media móvil.
      var e = 0.7 * rB + 0.3 * rM;
      this.avgE += (e - this.avgE) * ease(dt, 0.6);
      if (this.presence > 0.35 && (tSec - this.lastBeat) > 0.20 &&
          e > this.avgE * 1.25 + 0.05 && e > this.prevE) {
        this.lastBeat = tSec;
        this.beatHold = 0.05;
        this.beatTarget = clamp(0.30 + 0.70 * gain, 0.55, 1.15);
      }
      this.prevE = e;
      if (this.beatHold > 0) {
        this.beatHold -= dt;
        this.beat += (this.beatTarget - this.beat) * ease(dt, 0.015);
      } else {
        this.beat *= Math.exp(-dt / 0.11);       // ≈ 250 ms hasta casi cero
        if (this.beat < 0.002) this.beat = 0;
      }
    }

    // -------------------------------------------------------------- campo
    _updateField(dt) {
      var m = this.mid, tr = this.treb, bs = this.bassSlow, en = this.energy, be = this.beat;
      var bm = 0.65 * bs + 0.35 * this.bass;       // graves: masa sostenida + golpe

      // Deriva temporal (los medios aceleran la evolución del terreno).
      this.z += dt * (0.09 + 0.30 * m + 0.12 * en);
      this.ox += dt * 0.025;
      this.oy += dt * 0.018;
      this.ph2 += dt * (0.22 + 0.55 * m);
      this.ph3 -= dt * (0.17 + 0.40 * m);

      var mass = 0.60 + 0.62 * bm + 0.10 * be;     // volumen de la isla
      this._sea = 0.36 - 0.10 * be - 0.02 * bm;     // nivel del mar (la marea baja con el beat)
      var A1 = 0.18 + 0.10 * bs;                    // octava grande
      var A2 = 0.06 + 0.32 * m;                     // octava media: articula la costa
      var A3 = 0.02 + 0.12 * m + 0.05 * tr;         // octava fina
      var A4 = 0.11 * tr;                           // detalle de agudos
      var use4 = this.G >= 56 && A4 > 0.006;
      var w2 = 0.09 + 0.05 * m, w3 = 0.06 + 0.04 * m;
      var cp2 = Math.cos(this.ph2), sp2 = Math.sin(this.ph2);
      var cp3 = Math.cos(this.ph3), sp3 = Math.sin(this.ph3);

      var G = this.G, N = G * G;
      var F = this.F, px = this.px, py = this.py, rad = this.rad, win = this.win;
      var s2 = this.s2, c2 = this.c2, s3 = this.s3, c3 = this.c3;
      var z = this.z, ox = this.ox, oy = this.oy;

      for (var k = 0; k < N; k++) {
        var x = px[k], y = py[k];
        // Radio deformado por armónicos angulares: silueta orgánica y no circular.
        var rs = rad[k] * (1 + w2 * (s2[k] * cp2 + c2[k] * sp2) + w3 * (s3[k] * cp3 + c3[k] * sp3));
        var q = rs / 0.8;
        var base = 1 - q * q;
        if (base < -0.4) base = -0.4;
        // fBm de octavas independientes (offsets distintos, frecuencia ≈ ×2).
        var n = A1 * noise3(x * 1.5 + ox, y * 1.5 + oy, z) +
                A2 * noise3(x * 3.1 + 17.3, y * 3.1 + 5.1, z * 1.3 + 9.0) +
                A3 * noise3(x * 6.3 + 41.7, y * 6.3 + 23.9, z * 1.7 + 21.0);
        if (use4) n += A4 * noise3(x * 12.7 + 77.1, y * 12.7 + 61.3, z * 2.3 + 33.0);
        F[k] = (base * mass + n) * win[k];
      }
    }

    // ----------------------------------------------- sombreado del relieve
    _shade() {
      var G = this.G, F = this.F, sea = this._sea, lut = this.lut;
      var d = this.cellImg.data;
      var ks = 3.2 + 2.6 * (0.65 * this.bassSlow + 0.35 * this.bass);  // exageración del relieve
      var lift = 0.14 * this.beat;                                      // destello de beat
      var inv = 1 / 1.1;
      var sr = this.shallow[0], sg = this.shallow[1], sb = this.shallow[2];

      for (var j = 0; j < G; j++) {
        var jm = j > 0 ? j - 1 : 0, jp = j < G - 1 ? j + 1 : G - 1;
        for (var i = 0; i < G; i++) {
          var k = j * G + i, o = k << 2, f = F[k];
          if (f > sea) {
            var im = i > 0 ? i - 1 : 0, ip = i < G - 1 ? i + 1 : G - 1;
            var hx = F[j * G + ip] - F[j * G + im];
            var hy = F[jp * G + i] - F[jm * G + i];
            var t = (f - sea) * inv; if (t > 1) t = 1;
            var li = ((t * 255) | 0) * 3;
            var sh = 0.80 + (hx + hy) * ks + lift + t * 0.10;   // luz desde el noroeste
            if (sh < 0.35) sh = 0.35; else if (sh > 1.35) sh = 1.35;
            d[o] = lut[li] * sh; d[o + 1] = lut[li + 1] * sh; d[o + 2] = lut[li + 2] * sh;
            var cov = (f - sea) * 40;                           // borde de costa suave
            d[o + 3] = cov >= 1 ? 255 : cov * 255;
          } else {
            var dep = sea - f;
            if (dep < SHALLOW_W) {
              var qd = 1 - dep / SHALLOW_W;
              d[o] = sr; d[o + 1] = sg; d[o + 2] = sb;
              d[o + 3] = SHALLOW_A * qd * qd * 255;
            } else {
              d[o + 3] = 0;                                     // mar abierto: transparente
            }
          }
        }
      }
    }

    // ------------------------------------------- curvas de nivel (marching squares)
    _contours() {
      var G = this.G, F = this.F, sea = this._sea;
      var cell = this.layerSize / (G - 1);
      var minorOn = this.layerSize >= 260 && this.quality < 2 && this._minorAlpha() > 0.03;
      var segs = this.segs, segN = this.segN;
      segN[0] = segN[1] = segN[2] = 0;
      var ex = this._ex, ey = this._ey;
      var step = LEVEL_STEP, invStep = 1 / LEVEL_STEP;

      for (var j = 0; j < G - 1; j++) {
        var y0 = j * cell, y1 = y0 + cell, row = j * G;
        for (var i = 0; i < G - 1; i++) {
          var a = F[row + i], b = F[row + i + 1], d = F[row + G + i], c = F[row + G + i + 1];
          var mx = a > b ? a : b; if (c > mx) mx = c; if (d > mx) mx = d;
          if (mx <= sea) continue;
          var mn = a < b ? a : b; if (c < mn) mn = c; if (d < mn) mn = d;
          var kmin = Math.floor((mn - sea) * invStep) + 1; if (kmin < 0) kmin = 0;
          var kmax = Math.floor((mx - sea) * invStep); if (kmax > 64) kmax = 64;
          if (kmin > kmax) continue;
          var x0 = i * cell, x1 = x0 + cell;

          for (var k = kmin; k <= kmax; k++) {
            var cls = k === 0 ? 0 : ((k & 3) === 0 ? 1 : 2);
            if (cls === 2 && !minorOn) continue;
            var L = sea + k * step;
            var idx = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
            if (idx === 0 || idx === 15) continue;

            // Cruces con interpolación lineal en las 4 aristas (solo se usan las válidas).
            ex[0] = x0 + ((L - a) / (b - a)) * cell; ey[0] = y0;            // arriba
            ex[1] = x1; ey[1] = y0 + ((L - b) / (c - b)) * cell;            // derecha
            ex[2] = x0 + ((L - d) / (c - d)) * cell; ey[2] = y1;            // abajo
            ex[3] = x0; ey[3] = y0 + ((L - a) / (d - a)) * cell;            // izquierda

            var buf = segs[cls], n = segN[cls];
            if (n >= MAX_SEG) continue;                                     // límite de complejidad
            var o = n << 2, ea, eb;
            if (idx === 5 || idx === 10) {
              // Casos ambiguos: se resuelven con el valor medio del centro.
              var centerHigh = (a + b + c + d) * 0.25 >= L;
              var s1a, s1b, s2a, s2b;
              if (idx === 5) {
                if (centerHigh) { s1a = 3; s1b = 0; s2a = 2; s2b = 1; }
                else { s1a = 0; s1b = 1; s2a = 3; s2b = 2; }
              } else {
                if (centerHigh) { s1a = 0; s1b = 1; s2a = 3; s2b = 2; }
                else { s1a = 3; s1b = 0; s2a = 2; s2b = 1; }
              }
              buf[o] = ex[s1a]; buf[o + 1] = ey[s1a]; buf[o + 2] = ex[s1b]; buf[o + 3] = ey[s1b];
              n++;
              if (n < MAX_SEG) {
                o = n << 2;
                buf[o] = ex[s2a]; buf[o + 1] = ey[s2a]; buf[o + 2] = ex[s2b]; buf[o + 3] = ey[s2b];
                n++;
              }
            } else {
              ea = EDGE_A[idx]; eb = EDGE_B[idx];
              buf[o] = ex[ea]; buf[o + 1] = ey[ea]; buf[o + 2] = ex[eb]; buf[o + 3] = ey[eb];
              n++;
            }
            segN[cls] = n;
          }
        }
      }
    }

    // Opacidad de las curvas menores: los agudos las hacen aparecer.
    _minorAlpha() { return clamp(0.05 + 0.75 * this.treb, 0, 0.8); }

    // ------------------------------------------------------- composición
    // Se dibuja directamente en el canvas principal (sin capa intermedia): la ventana
    // de contención del campo (win) ya anula la altura antes del borde, de modo que
    // nada se recorta; la costa y el relieve se desvanecen por la propia geometría.
    _compose() {
      var ctx = this.ctx, L = this.side, G = this.G, be = this.beat;
      var cell = L / (G - 1);
      var ox = Math.round((this.bw - L) / 2), oy = Math.round((this.bh - L) / 2);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.bw, this.bh);
      ctx.globalAlpha = clamp(this.fade, 0, 1);       // fundido global de entrada/salida
      ctx.setTransform(1, 0, 0, 1, ox, oy);

      // 1) Relieve sombreado (rejilla de G×G escalada con suavizado bilineal).
      this.cellCtx.putImageData(this.cellImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.cellCv, 0, 0, G, G, -cell * 0.5, -cell * 0.5, G * cell, G * cell);

      // 2) Curvas de nivel.
      var lw = Math.max(0.8, L * 0.0027);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var segN = this.segN, segs = this.segs;

      if (segN[2] > 0) {
        ctx.strokeStyle = 'rgba(16,34,43,' + (this._minorAlpha() * 0.55).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, lw * 0.7);
        this._strokeBuf(ctx, segs[2], segN[2]);
      }
      if (segN[1] > 0) {
        // Las curvas principales se aclaran con el beat (destello del relieve).
        var k = be * 0.7;
        ctx.strokeStyle = 'rgba(' + Math.round(16 + 239 * k) + ',' + Math.round(34 + 214 * k) + ',' +
          Math.round(43 + 187 * k) + ',' + clamp(0.55 + 0.25 * be, 0, 0.85).toFixed(3) + ')';
        ctx.lineWidth = lw * 1.25;
        this._strokeBuf(ctx, segs[1], segN[1]);
      }
      if (segN[0] > 0) {
        // Costa: sombra fina (solo en calidad alta) + espuma clara que destella con el beat.
        if (this.quality === 0) {
          ctx.strokeStyle = 'rgba(16,34,43,0.25)';
          ctx.lineWidth = lw * 2.4;
          this._strokeBuf(ctx, segs[0], segN[0]);
        }
        ctx.strokeStyle = 'rgba(255,250,240,' + clamp(0.55 + 0.45 * be, 0, 1).toFixed(3) + ')';
        ctx.lineWidth = lw * (1.0 + 1.2 * be);
        this._strokeBuf(ctx, segs[0], segN[0]);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }

    _strokeBuf(ctx, buf, n) {
      ctx.beginPath();
      for (var s = 0, o = 0; s < n; s++, o += 4) {
        ctx.moveTo(buf[o], buf[o + 1]);
        ctx.lineTo(buf[o + 2], buf[o + 3]);
      }
      ctx.stroke();
    }

    // -------------------------------------- degradación automática de calidad
    _adapt(ms, dt) {
      this.msEma += (ms - this.msEma) * 0.08;
      if (this._cool > 0) this._cool -= dt;
      if (this.msEma > 13) { this._slowT += dt; this._fastT = 0; }
      else if (this.msEma < 6.5) { this._fastT += dt; this._slowT = 0; }
      else { this._slowT = 0; this._fastT = 0; }

      if (this._cool <= 0) {
        if (this._slowT > 1.2 && this.quality < 2) {
          this.quality++; this._cool = 3; this._allocLayer();
        } else if (this._fastT > 6 && this.quality > 0) {
          this.quality--; this._cool = 3; this._allocLayer();
        }
      }
    }
  }

  Visualizer.meta = {
    id: 'topoIsle',
    name: 'Isla topográfica',
    description: 'Relieve con curvas de nivel que respira con la música.'
  };

  NS.topoIsle = Visualizer;
  if (typeof module === 'object' && module && module.exports) module.exports = Visualizer; // solo pruebas en Node
})(typeof window !== 'undefined' ? window : globalThis);
