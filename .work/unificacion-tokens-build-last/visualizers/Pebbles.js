/*!
 * AuraPlay Pro — Visualizador "Mosaico de guijarros"
 * Identificador técnico: pebbles
 *
 * Un cojín de cantos rodados (módulos redondeados tipo "squircle") dispuestos en
 * una retícula hexagonal y recortados por una silueta de superelipse suave.
 * Cada guijarro se eleva, se ilumina y cambia de color según una zona espectral
 * que migra lentamente por el mosaico. Todo se dibuja con Canvas 2D.
 *
 *   graves  -> la silueta entera se expande ("respira"), una ola ancha y lenta
 *              levanta zonas grandes y los guijarros cálidos se vuelven pesados.
 *   medios  -> la silueta cambia de exponente (más o menos cuadrada), rota la
 *              dirección de la ola media y cambia su longitud de onda.
 *   agudos  -> textura fina: ola corta y rápida, giros pequeños y destellos en
 *              los guijarros fríos.
 *   energía -> velocidad de evolución, mezcla de brillo y velocidad de las olas.
 *   beat    -> un frente de luz LINEAL cruza el mosaico (la dirección cambia con
 *              cada beat) + un breve "golpe" de expansión y brillo.
 *   silencio-> respiración suave y destellos lentos: la animación sigue visible.
 *
 * Registro global:
 *   window.AuraPlayVisualizers.pebbles  -> clase Visualizer
 *   (metadatos estáticos: Visualizer.id, Visualizer.label, Visualizer.description)
 *
 * Dependencias: ninguna. Solo el <canvas> y un objeto `audioGraph` con
 *   getDataArray()  -> Uint8Array de frecuencias (0-255) o null
 *   getTimeDomain() -> Uint8Array centrado en ~128 o null
 *
 * Código 100 % original, sin librerías, assets ni fuentes externas.
 */
(function (global) {
  'use strict';

  var NS = global.AuraPlayVisualizers = global.AuraPlayVisualizers || {};

  // ---------------------------------------------------------------- constantes
  var TAU = Math.PI * 2;
  var MAX_DPR = 2;
  var SENS_MIN = 0.4, SENS_MAX = 1.2, SENS_DEF = 0.7;
  var NB = 24;                 // bandas espectrales logarítmicas
  var F_LO = 30, F_HI = 14000; // rango analizado (Hz)
  var F_BASS = 160, F_MID = 2600; // límites graves / medios / agudos
  var MAX_PEBBLES = 420;       // tope duro de módulos almacenados
  var PAL_LEN = 48;            // entradas de la paleta precalculada
  var LX = -0.58, LY = -0.81;  // dirección hacia la luz (arriba-izquierda)
  var KAPPA_CIRCLE = 0.5523;

  // Paleta por defecto: cálida (graves) -> fría (agudos)
  var DEFAULT_STOPS = [
    [255, 112, 76],   // coral
    [255, 176, 86],   // ámbar
    [228, 92, 168],   // rosa orquídea
    [142, 112, 255],  // pervinca
    [62, 226, 208]    // agua
  ];

  // ------------------------------------------------------------------ helpers
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // smoothstep generalizado (admite a > b para curvas descendentes)
  function smooth(a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }
  // seguidor de envolvente independiente de la tasa de frames
  function follow(cur, target, dt, tauUp, tauDown) {
    var tau = target > cur ? tauUp : tauDown;
    return cur + (target - cur) * (1 - Math.exp(-dt / tau));
  }
  // onda triangular continua 0..1 (evita saltos al migrar zonas)
  function tri(v) { return 1 - Math.abs(2 * (v - Math.floor(v)) - 1); }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Trazo de un guijarro: superelipse aproximada con 4 curvas de Bézier.
  // kappa 0.5523 = elipse; ~0.8 = squircle blando.
  function pebblePath(ctx, cx, cy, rx, ry, rot, k) {
    var cs = Math.cos(rot), sn = Math.sin(rot);
    var kx = k * rx, ky = k * ry;
    ctx.beginPath();
    ctx.moveTo(cx + rx * cs, cy + rx * sn);
    ctx.bezierCurveTo(
      cx + rx * cs - ky * sn, cy + rx * sn + ky * cs,
      cx + kx * cs - ry * sn, cy + kx * sn + ry * cs,
      cx - ry * sn, cy + ry * cs);
    ctx.bezierCurveTo(
      cx - kx * cs - ry * sn, cy - kx * sn + ry * cs,
      cx - rx * cs - ky * sn, cy - rx * sn + ky * cs,
      cx - rx * cs, cy - rx * sn);
    ctx.bezierCurveTo(
      cx - rx * cs + ky * sn, cy - rx * sn - ky * cs,
      cx - kx * cs + ry * sn, cy - kx * sn - ry * cs,
      cx + ry * sn, cy - ry * cs);
    ctx.bezierCurveTo(
      cx + kx * cs + ry * sn, cy + kx * sn - ry * cs,
      cx + rx * cs + ky * sn, cy + rx * sn - ky * cs,
      cx + rx * cs, cy + rx * sn);
    ctx.closePath();
  }

  // Cadenas precalculadas para brillos y sombras (evita crear strings por frame)
  var GLOSS = [], SHADOW = [], i0;
  for (i0 = 0; i0 < 8; i0++) {
    GLOSS.push('rgba(255,255,255,' + (0.05 + i0 * 0.085).toFixed(3) + ')');
  }
  for (i0 = 0; i0 < 6; i0++) {
    SHADOW.push('rgba(6,4,18,' + (0.10 + i0 * 0.065).toFixed(3) + ')');
  }

  // ===========================================================================
  class Visualizer {
    /**
     * @param {HTMLCanvasElement} canvas  Canvas dimensionado por CSS.
     * @param {object} audioGraph         Debe exponer getDataArray() y getTimeDomain().
     */
    constructor(canvas, audioGraph) {
      this._canvas = canvas || null;
      this._audio = audioGraph || null;
      this._ctx = null;
      try {
        this._ctx = this._canvas && this._canvas.getContext ? this._canvas.getContext('2d') : null;
      } catch (e) { this._ctx = null; }

      this._sens = SENS_DEF;
      this._srOverride = 0;

      // ciclo de vida
      this._running = false;
      this._stopping = false;
      this._destroyed = false;
      this._raf = 0;
      this._last = 0;
      this._alpha = 0;
      this._probe = 0;
      this._warned = false;

      // geometría
      this._w = 0; this._h = 0; this._dpr = 1;
      this._n = 0; this._pitch = 0;
      this._X0 = this._Y0 = this._NX = this._NY = this._AX = this._AY = null;
      this._U = this._H1 = this._H2 = this._H3 = this._ES = this._PS = null;

      // análisis de audio (arrays reutilizados)
      this._binLen = 0; this._sr = 0;
      this._edges = new Float32Array(NB + 1);
      this._bandLo = new Int32Array(NB);
      this._bandHi = new Int32Array(NB);
      this._bandRaw = new Float32Array(NB);
      this._bandInst = new Float32Array(NB);
      this._bandEnv = new Float32Array(NB);
      this._peak = new Float32Array(NB);
      this._gB = []; this._gM = []; this._gT = [];
      for (var b = 0; b <= NB; b++) {
        this._edges[b] = F_LO * Math.pow(F_HI / F_LO, b / NB);
      }
      for (b = 0; b < NB; b++) {
        var fc = Math.sqrt(this._edges[b] * this._edges[b + 1]);
        (fc < F_BASS ? this._gB : (fc < F_MID ? this._gM : this._gT)).push(b);
      }

      this._resetState();

      // paleta
      this._palR = new Float32Array(PAL_LEN);
      this._palG = new Float32Array(PAL_LEN);
      this._palB = new Float32Array(PAL_LEN);
      this._buildPalette(DEFAULT_STOPS);

      // listeners
      this._onTick = this._tick.bind(this);
      this._onResize = this._resize.bind(this);
      this._ro = null;
      this._winResize = false;
      if (this._canvas) {
        if (typeof ResizeObserver !== 'undefined') {
          this._ro = new ResizeObserver(this._onResize);
          this._ro.observe(this._canvas);
        } else if (global.addEventListener) {
          global.addEventListener('resize', this._onResize);
          this._winResize = true;
        }
      }
      this._resize();
    }

    // ------------------------------------------------------------- API pública
    /** Sensibilidad 0.4–1.2 (base 0.7). */
    setSensitivity(value) {
      var v = Number(value);
      if (!isFinite(v)) v = SENS_DEF;
      this._sens = clamp(v, SENS_MIN, SENS_MAX);
    }

    /** Inicia (o reanuda) el único bucle requestAnimationFrame. */
    start() {
      if (this._destroyed) return;
      this._stopping = false;
      this._running = true;
      if (!this._raf) {
        this._last = 0;
        this._raf = requestAnimationFrame(this._onTick);
      }
    }

    /** stop(): fundido breve y parada. stop(true): parada inmediata + limpieza. */
    stop(immediate) {
      if (this._destroyed) return;
      if (immediate === true) {
        this._halt();
        return;
      }
      if (this._running) this._stopping = true;
      else this._clearCanvas();
    }

    /** Limpia el canvas y devuelve el estado dinámico al reposo. */
    clear() {
      if (this._destroyed) return;
      this._resetState();
      this._clearCanvas();
    }

    /** Libera bucle, observer y listeners. Tras esto la instancia queda inerte. */
    destroy() {
      if (this._destroyed) return;
      this._halt();
      this._destroyed = true;
      if (this._ro) { try { this._ro.disconnect(); } catch (e) { /* noop */ } this._ro = null; }
      if (this._winResize && global.removeEventListener) {
        global.removeEventListener('resize', this._onResize);
        this._winResize = false;
      }
      this._audio = null;
      this._ctx = null;
      this._canvas = null;
      this._X0 = this._Y0 = this._NX = this._NY = this._AX = this._AY = null;
      this._U = this._H1 = this._H2 = this._H3 = this._ES = this._PS = null;
      this._n = 0;
    }

    // --------------------------------------------------- extras opcionales
    /** Fuerza la frecuencia de muestreo si el audioGraph no la expone. */
    setSampleRate(hz) {
      var v = Number(hz);
      this._srOverride = (v > 8000 && v < 400000) ? v : 0;
      this._binLen = 0; // fuerza recálculo de bandas
    }

    /** Paleta propia: 3–6 colores [r,g,b] o '#rrggbb', de graves a agudos. */
    setPalette(stops) {
      var list = [];
      if (stops && stops.length) {
        for (var i = 0; i < stops.length; i++) {
          var c = this._parseColor(stops[i]);
          if (c) list.push(c);
        }
      }
      this._buildPalette(list.length >= 2 ? list : DEFAULT_STOPS);
    }

    /**
     * Paleta opcional a partir de una imagen (portada). Nunca es obligatoria:
     * si la imagen es ilegible, tiene CORS o es muy gris, conserva la paleta actual.
     * @returns {boolean} true si la paleta cambió.
     */
    setPaletteFromImage(img) {
      try {
        if (!img || !img.width || typeof document === 'undefined') return false;
        var c = document.createElement('canvas');
        c.width = 12; c.height = 12;
        var x = c.getContext('2d');
        x.drawImage(img, 0, 0, 12, 12);
        var d = x.getImageData(0, 0, 12, 12).data;
        var picks = [];
        for (var i = 0; i < d.length; i += 4) {
          var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          var l = (mx + mn) / 2, dd = mx - mn;
          if (dd < 0.12 || l < 0.22 || l > 0.85) continue;
          var s = dd / (1 - Math.abs(2 * l - 1));
          if (s < 0.3) continue;
          var hh = mx === r ? ((g - b) / dd + 6) % 6 : (mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4);
          picks.push({ h: hh, c: [d[i], d[i + 1], d[i + 2]] });
        }
        if (picks.length < 5) return false;
        picks.sort(function (p, q) { return p.h - q.h; });
        var out = [];
        for (var k = 0; k < 5; k++) {
          out.push(picks[Math.min(picks.length - 1, Math.round(k * (picks.length - 1) / 4))].c);
        }
        this._buildPalette(out);
        return true;
      } catch (e) {
        return false;
      }
    }

    // ------------------------------------------------------- estado interno
    _resetState() {
      this._time = 0; this._tw = 0;
      this._ph1 = 0; this._ph2 = 0; this._ph3 = 0; this._drift = 0;
      this._cb = 0; this._cm = 0; this._ct = 0; this._ce = 0;
      this._idle = 1;
      this._fast = 0; this._slow = 0;
      this._sinceBeat = 1; this._beatT = 1; this._beatAmp = 0; this._beatCount = 0;
      this._kick = 0;
      if (this._bandEnv) {
        this._bandEnv.fill(0); this._bandInst.fill(0); this._bandRaw.fill(0); this._peak.fill(0);
      }
      if (this._ES) { this._ES.fill(0); this._PS.fill(0); }
    }

    _clearCanvas() {
      var ctx = this._ctx, c = this._canvas;
      if (!ctx || !c) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width || 0, c.height || 0);
    }

    _halt() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
      this._running = false;
      this._stopping = false;
      this._alpha = 0;
      this._last = 0;
      this._clearCanvas();
    }

    _parseColor(c) {
      if (c && c.length >= 3 && typeof c !== 'string') {
        return [clamp(c[0] | 0, 0, 255), clamp(c[1] | 0, 0, 255), clamp(c[2] | 0, 0, 255)];
      }
      if (typeof c === 'string') {
        var m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
        if (m) {
          var n = parseInt(m[1], 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
      }
      return null;
    }

    _buildPalette(stops) {
      var L = stops.length - 1;
      for (var i = 0; i < PAL_LEN; i++) {
        var t = i / (PAL_LEN - 1) * L;
        var a = Math.min(L - 1, Math.floor(t)), f = t - a;
        f = f * f * (3 - 2 * f);
        this._palR[i] = lerp(stops[a][0], stops[a + 1][0], f);
        this._palG[i] = lerp(stops[a][1], stops[a + 1][1], f);
        this._palB[i] = lerp(stops[a][2], stops[a + 1][2], f);
      }
    }

    // ------------------------------------------------------ tamaño y diseño
    _resize() {
      var c = this._canvas;
      if (!c || this._destroyed) return;
      var rect = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
      var cw = (rect && rect.width) || c.clientWidth || 0;
      var ch = (rect && rect.height) || c.clientHeight || 0;
      var dpr = Math.min(MAX_DPR, global.devicePixelRatio || 1);
      if (!(cw > 1 && ch > 1) || !isFinite(cw) || !isFinite(ch)) {
        this._w = 0; this._h = 0; this._n = 0; // oculto o sin tamaño: no dibujar
        return;
      }
      var pw = Math.max(1, Math.round(cw * dpr));
      var ph = Math.max(1, Math.round(ch * dpr));
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
      var changed = cw !== this._w || ch !== this._h;
      this._dpr = dpr; this._w = cw; this._h = ch;
      if (changed || !this._n) this._layout();
    }

    /** Genera la retícula hexagonal de guijarros para el tamaño actual. */
    _layout() {
      var w = this._w, h = this._h;
      var side = Math.min(w, h);
      var ax = Math.min(w * 0.42, h * 0.42 * 1.5);
      var ay = h * 0.42;
      var target = side < 200 ? 70 : (side < 380 ? 115 : (side < 700 ? 170 : 220));
      var p = Math.sqrt(3.45 * ax * ay / (target * 0.866));
      var xs = [], ys = [];
      var guard = 0;
      for (;;) {
        xs.length = 0; ys.length = 0;
        var rowH = p * 0.866, ext = 1.22;
        var row = 0;
        for (var y = -ay * ext; y <= ay * ext; y += rowH, row++) {
          var off = (row & 1) ? p * 0.5 : 0;
          var x0 = -Math.ceil(ax * ext / p) * p + off;
          for (var x = x0; x <= ax * ext; x += p) {
            var m = Math.pow(Math.pow(Math.abs(x / ax), 2.45) + Math.pow(Math.abs(y / ay), 2.45), 1 / 2.45);
            if (m <= 1.14) { xs.push(x); ys.push(y); }
          }
        }
        if (xs.length <= MAX_PEBBLES || ++guard > 10) break;
        p *= 1.06;
      }
      var n = Math.min(xs.length, MAX_PEBBLES);
      this._n = n; this._pitch = p;
      this._X0 = new Float32Array(n); this._Y0 = new Float32Array(n);
      this._NX = new Float32Array(n); this._NY = new Float32Array(n);
      this._AX = new Float32Array(n); this._AY = new Float32Array(n);
      this._U = new Float32Array(n);
      this._H1 = new Float32Array(n); this._H2 = new Float32Array(n); this._H3 = new Float32Array(n);
      this._ES = new Float32Array(n); this._PS = new Float32Array(n);
      var rnd = mulberry32(20240611);
      for (var i = 0; i < n; i++) {
        var X = xs[i] / ax, Y = ys[i] / ay;
        this._X0[i] = xs[i]; this._Y0[i] = ys[i];
        this._NX[i] = X; this._NY[i] = Y;
        this._AX[i] = Math.abs(X); this._AY[i] = Math.abs(Y);
        // zonas espectrales: parches suaves (suma de senos), no ruido aleatorio
        this._U[i] = clamp01(0.5 + 0.30 * Math.sin(2.3 * X + 1.1 * Y + 0.7) +
          0.22 * Math.sin(-1.6 * X + 2.7 * Y + 2.1) + 0.14 * Math.sin(3.4 * X + 0.6 * Y + 4.0));
        this._H1[i] = rnd(); this._H2[i] = rnd(); this._H3[i] = rnd();
      }
    }

    // ---------------------------------------------------------------- bucle
    _tick(ts) {
      this._raf = 0;
      if (this._destroyed || !this._running) return;
      var now = (typeof ts === 'number' ? ts : (global.performance ? global.performance.now() : Date.now())) / 1000;
      var dt = this._last ? clamp(now - this._last, 0.001, 0.05) : 1 / 60;
      this._last = now;
      try {
        this._frame(dt);
      } catch (e) {
        if (!this._warned) { this._warned = true; if (global.console) console.warn('[pebbles] frame error:', e); }
      }
      if (this._running && !this._destroyed) this._raf = requestAnimationFrame(this._onTick);
    }

    _frame(dt) {
      if (!this._ctx) return;
      var dprNow = Math.min(MAX_DPR, global.devicePixelRatio || 1);
      if (dprNow !== this._dpr || (this._w <= 0 && ((++this._probe) & 15) === 0)) this._resize();
      if (this._w > 0 && this._h > 0 && this._n > 0) {
        this._analyse(dt);
        this._render(dt);
      }
      // fundido de entrada / salida
      if (this._stopping) {
        this._alpha -= dt / 0.45;
        if (this._alpha <= 0.004) { this._halt(); }
      } else if (this._alpha < 1) {
        this._alpha = Math.min(1, this._alpha + dt / 0.35);
      }
    }

    // -------------------------------------------------------------- análisis
    _sampleRate() {
      var g = this._audio, c = [];
      if (this._srOverride) return this._srOverride;
      try {
        if (g) {
          c.push(g.sampleRate,
            g.audioContext && g.audioContext.sampleRate,
            g.context && g.context.sampleRate,
            g.ctx && g.ctx.sampleRate,
            g.analyser && g.analyser.context && g.analyser.context.sampleRate,
            typeof g.getSampleRate === 'function' ? g.getSampleRate() : 0);
        }
      } catch (e) { /* noop */ }
      for (var i = 0; i < c.length; i++) {
        if (typeof c[i] === 'number' && c[i] > 8000 && c[i] < 400000) return c[i];
      }
      return 44100;
    }

    _buildBands(len, sr) {
      var binHz = (sr * 0.5) / len;
      for (var b = 0; b < NB; b++) {
        var lo = Math.min(len - 1, Math.max(1, Math.round(this._edges[b] / binHz)));
        var hi = Math.min(len, Math.max(lo + 1, Math.round(this._edges[b + 1] / binHz)));
        this._bandLo[b] = lo; this._bandHi[b] = hi;
      }
      this._binLen = len; this._sr = sr;
    }

    _group(arr, idx) {
      var s = 0, mx = 0;
      for (var i = 0; i < idx.length; i++) {
        var v = arr[idx[i]];
        s += v; if (v > mx) mx = v;
      }
      return idx.length ? 0.6 * (s / idx.length) + 0.4 * mx : 0;
    }

    /** Lee el audio, normaliza por banda y actualiza envolventes suavizadas. */
    _analyse(dt) {
      var g = this._audio, data = null, td = null;
      try { if (g && typeof g.getDataArray === 'function') data = g.getDataArray(); } catch (e) { data = null; }
      try { if (g && typeof g.getTimeDomain === 'function') td = g.getTimeDomain(); } catch (e) { td = null; }

      var gain = this._sens / SENS_DEF;
      var sensN = (this._sens - SENS_MIN) / (SENS_MAX - SENS_MIN);
      var has = !!(data && data.length >= 32);
      var raw = this._bandRaw, inst = this._bandInst, env = this._bandEnv, peak = this._peak;
      var b, loud = 0;

      if (has) {
        var sr = this._sampleRate();
        if (data.length !== this._binLen || sr !== this._sr) this._buildBands(data.length, sr);
        for (b = 0; b < NB; b++) {
          var s = 0, lo = this._bandLo[b], hi = this._bandHi[b];
          for (var k = lo; k < hi; k++) s += data[k];
          raw[b] = s / ((hi - lo) * 255);
        }
      } else {
        raw.fill(0);
      }

      var kPeak = Math.exp(-dt / 7);
      for (b = 0; b < NB; b++) {
        var r = raw[b];
        loud += r;
        var pk = peak[b] * kPeak;
        if (r > pk) pk = r;
        peak[b] = pk;
        var rel = r / Math.max(pk, 0.2);                // relativo al máximo reciente
        var x = clamp01((0.4 * r + 0.6 * rel) * gain);  // mezcla absoluto/relativo
        x = Math.pow(x, 1.3);                           // contraste: golpes más legibles
        inst[b] = x;
        var fz = b / (NB - 1);
        env[b] = follow(env[b], x, dt, lerp(0.045, 0.015, fz), lerp(0.42, 0.12, fz));
      }
      loud /= NB;

      // energía RMS del dominio temporal (solo como magnitud, nunca como forma de onda)
      var rms = 0;
      if (td && td.length >= 32) {
        var sum = 0, cnt = 0;
        for (var j = 0; j < td.length; j += 4) { var d = (td[j] - 128) / 128; sum += d * d; cnt++; }
        rms = Math.sqrt(sum / cnt);
      }
      var rmsN = clamp01(rms * 3.2 * gain);

      var bassI = this._group(inst, this._gB);
      var midI = this._group(inst, this._gM);
      var trebI = this._group(inst, this._gT);
      this._cb = follow(this._cb, bassI, dt, 0.06, 0.45);
      this._cm = follow(this._cm, midI, dt, 0.05, 0.30);
      this._ct = follow(this._ct, trebI, dt, 0.02, 0.12);
      var eInst = clamp01(0.35 * bassI + 0.25 * midI + 0.15 * trebI + 0.25 * rmsN);
      this._ce = follow(this._ce, eInst, dt, 0.09, 0.60);

      // silencio / señal débil -> mezcla de reposo
      var idleT = has ? 1 - smooth(0.02, 0.07, Math.max(loud, rms * 0.8)) : 1;
      this._idle = follow(this._idle, idleT, dt, 0.5, 0.5);

      // detección de beat (flujo de graves, con refractario)
      this._fast = follow(this._fast, bassI, dt, 0.04, 0.04);
      this._slow = follow(this._slow, bassI, dt, 0.55, 0.55);
      var onset = this._fast - this._slow;
      var thr = 0.17 - 0.10 * sensN;
      this._sinceBeat += dt;
      if (onset > thr && this._sinceBeat > 0.22 && loud > 0.03 && has) {
        this._sinceBeat = 0;
        this._beatT = 0;
        this._beatAmp = clamp01(0.45 + onset * 2.2);
        this._beatCount++;
        this._kick = Math.max(this._kick, this._beatAmp);
      }
      this._kick = follow(this._kick, 0, dt, 0.1, 0.17);
      if (this._beatT < 1) this._beatT = Math.min(1, this._beatT + dt / 0.9);
    }

    // ---------------------------------------------------------------- dibujo
    _render(dt) {
      var ctx = this._ctx, w = this._w, h = this._h, dpr = this._dpr, n = this._n;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (this._alpha <= 0.003) return;

      this._time += dt;
      var time = this._time;
      var im = this._idle;
      var breath = 0.5 + 0.5 * Math.sin(time * 0.9);
      var cb = Math.max(this._cb, im * (0.16 + 0.10 * breath));
      var cm = Math.max(this._cm, im * 0.28);
      var ct = Math.max(this._ct, im * 0.14);
      var ce = Math.max(this._ce, im * 0.22);
      var kick = this._kick;

      // fases continuas (velocidad modulada por la energía, sin saltos)
      this._tw += dt * (0.45 + 1.4 * ce);
      this._ph1 += dt * (0.9 + 1.8 * cm + 0.8 * ce);
      this._ph2 += dt * (2.6 + 6.0 * ct);
      this._ph3 += dt * (0.5 + 0.6 * cb);
      this._drift += dt * (0.010 + 0.020 * ce);
      var tw = this._tw, ph1 = this._ph1, ph2 = this._ph2, ph3 = this._ph3, drift = this._drift;

      // silueta: superelipse que respira con los graves y cambia con los medios
      var S = 1 + 0.075 * cb + 0.035 * kick + 0.010 * breath * im;
      var nExp = 2.45 + 1.0 * cm + 0.15 * Math.sin(time * 0.17);
      var invN = 1 / nExp;
      var ang = 0.04 * Math.sin(time * 0.13) + 0.03 * Math.sin(ph3 * 0.7);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var cx = w * 0.5, cy = h * 0.5;
      var Rb = 0.5 * this._pitch * S * 0.93;

      // olas que forman el relieve
      var th1 = 0.55 + 0.45 * Math.sin(tw * 0.17), c1 = Math.cos(th1), s1 = Math.sin(th1);
      var th2 = th1 + 1.9 + 0.5 * Math.sin(tw * 0.37), c2 = Math.cos(th2), s2 = Math.sin(th2);
      var th3 = -0.7 + 0.3 * Math.sin(tw * 0.11), c3 = Math.cos(th3), s3 = Math.sin(th3);
      var k1 = 3.8 + 1.6 * cm, k2 = 7.5 + 6.0 * ct, k3 = 1.9;
      var A1 = 0.30 + 0.85 * cm, A2 = 0.10 + 0.62 * ct, A3 = 0.15 + 0.85 * cb;

      // frente lineal del beat
      var bActive = this._beatT < 1;
      var bAng = this._beatCount * 2.399963, bc = Math.cos(bAng), bs = Math.sin(bAng);
      var bp = this._beatT;
      var bFront = -1.5 + 3.0 * (1 - (1 - bp) * (1 - bp));
      var bAmp = this._beatAmp * (1 - bp * 0.4);
      var bw = 0.38, invBw = 1 / bw;

      var X0 = this._X0, Y0 = this._Y0, NX = this._NX, NY = this._NY, AX = this._AX, AY = this._AY;
      var U = this._U, H1 = this._H1, H2 = this._H2, H3 = this._H3, ES = this._ES, PS = this._PS;
      var bandEnv = this._bandEnv;
      var palR = this._palR, palG = this._palG, palB = this._palB;
      var aE = 1 - Math.exp(-dt * 16);
      var NBm = NB - 1;
      var hueWob = 0.06 * Math.sin(time * 0.11);

      ctx.globalAlpha = this._alpha;

      for (var i = 0; i < n; i++) {
        // 1) ¿está dentro de la silueta actual? (borde suave: los guijarros aparecen/desaparecen)
        var m = Math.pow(Math.pow(AX[i], nExp) + Math.pow(AY[i], nExp), invN) / S;
        var sc = smooth(1.0, 0.80, m);
        if (sc < 0.03) continue;

        var X = NX[i], Y = NY[i];
        var hh1 = H1[i], hh2 = H2[i], hh3 = H3[i];
        var px = cx + S * (X0[i] * ca - Y0[i] * sa);
        var py = cy + S * (X0[i] * sa + Y0[i] * ca);

        // 2) zona espectral del guijarro (migra despacio) -> color y banda asignada
        var z = tri(U[i] * 0.9 + drift);
        var f = z * NBm, b0 = f | 0, b1 = b0 < NBm ? b0 + 1 : b0, fr = f - b0;
        var v = bandEnv[b0] * (1 - fr) + bandEnv[b1] * fr;
        var idleV = im * 0.22 * (0.5 + 0.5 * Math.sin(time * 1.1 + hh1 * TAU + z * 3));
        if (idleV > v) v = idleV;
        PS[i] += (v - PS[i]) * (1 - Math.exp(-dt * (6 + 16 * z)));   // graves: más inercia
        var pop = PS[i];

        // 3) relieve: tres olas + frente del beat
        var p1 = k1 * (X * c1 + Y * s1) - ph1;
        var p2 = k2 * (X * c2 + Y * s2) - ph2;
        var p3 = k3 * (X * c3 + Y * s3) - ph3 * 0.6;
        var sn1 = Math.sin(p1), cs1 = Math.cos(p1), sn2 = Math.sin(p2), cs2 = Math.cos(p2);
        var sn3 = Math.sin(p3), cs3 = Math.cos(p3);
        var hgt = A1 * sn1 + A2 * sn2 + A3 * cs3;
        var gX = A1 * k1 * c1 * cs1 + A2 * k2 * c2 * cs2 - A3 * k3 * c3 * sn3;
        var gY = A1 * k1 * s1 * cs1 + A2 * k2 * s2 * cs2 - A3 * k3 * s3 * sn3;
        var bump = 0;
        if (bActive) {
          var d = ((X * bc + Y * bs) - bFront) * invBw;
          bump = Math.exp(-d * d) * bAmp;
          var dh = -2 * d * invBw * bump * 0.9;
          gX += bc * dh; gY += bs * dh;
        }
        var e = clamp01(0.5 + 0.2 * hgt);
        var tgt = clamp(e * 0.5 + pop * 0.62 + bump * 0.85, 0, 1.3);
        var E = ES[i] += (tgt - ES[i]) * aE;

        // 4) iluminación a partir de la pendiente del relieve
        var lit = -(gX * LX + gY * LY) * 0.11;
        var shade = clamp01(0.55 + lit * 0.6 + (E - 0.4) * 0.25);
        var tx = clamp(-gX * 0.12, -1, 1), ty = clamp(-gY * 0.12, -1, 1);

        // 5) tamaño, forma y giro
        var zh = smooth(0.45, 1, z);
        var heavy = cb * (1 - smooth(0.1, 0.5, z));
        var R = Rb * sc * (0.84 + 0.32 * E) * (1 + 0.10 * heavy);
        var asp = 0.10 * (hh2 - 0.5);
        var rx = R * (1 + asp), ry = R * (1 - asp);
        var rot = (hh3 - 0.5) * 0.8 + ct * zh * 0.35 * Math.sin(ph2 * 1.7 + hh2 * TAU);
        var kap = 0.74 + 0.06 * hh1;

        // 6) color (paleta cálida→fría) y capas
        var ki = (clamp01(z + hueWob) * (PAL_LEN - 1) + 0.5) | 0;
        var cr = palR[ki], cg = palG[ki], cbl = palB[ki];
        var bk = 0.34 + 0.20 * shade + 0.14 * E;
        var mk = 0.80 + 0.14 * shade;
        var wh = 0.04 + 0.20 * E * shade + 0.14 * kick;
        var sparkle = ct * zh * Math.max(0, Math.sin(ph2 * 2.2 + hh2 * 40));
        var gq = 0.10 + 0.42 * shade * (0.55 + 0.45 * E) + 0.30 * kick * sc + 0.30 * sparkle;
        var gl = (clamp01(gq) * 7.99) | 0;
        var sq = (clamp01(0.15 + E * 0.7) * 5.99) | 0;
        var sdx = -LX * R * (0.08 + 0.40 * E), sdy = -LY * R * (0.08 + 0.40 * E);

        pebblePath(ctx, px + sdx, py + sdy, rx, ry, rot, kap);
        ctx.fillStyle = SHADOW[sq]; ctx.fill();

        pebblePath(ctx, px, py, rx, ry, rot, kap);
        ctx.fillStyle = 'rgb(' + ((cr * bk) | 0) + ',' + ((cg * bk) | 0) + ',' + ((cbl * bk) | 0) + ')';
        ctx.fill();

        pebblePath(ctx, px + LX * R * 0.10, py + LY * R * 0.10, rx * 0.86, ry * 0.86, rot, kap);
        ctx.fillStyle = 'rgb(' + Math.min(255, (cr * mk + 255 * wh) | 0) + ',' +
          Math.min(255, (cg * mk + 255 * wh) | 0) + ',' + Math.min(255, (cbl * mk + 255 * wh) | 0) + ')';
        ctx.fill();

        pebblePath(ctx, px + LX * R * 0.34 + tx * R * 0.12, py + LY * R * 0.34 + ty * R * 0.12,
          rx * 0.26, ry * 0.18, rot - 0.5, KAPPA_CIRCLE);
        ctx.fillStyle = GLOSS[gl]; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Metadatos para el selector de estilos del reproductor
  Visualizer.id = 'pebbles';
  Visualizer.label = 'Mosaico de guijarros';
  Visualizer.description = 'Cantos rodados que se elevan, brillan y cambian de color con la música.';

  NS.pebbles = Visualizer;
  global.AuraVisualizerStyles = global.AuraVisualizerStyles || {};
  global.AuraVisualizerStyles.pebbles = Visualizer;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
