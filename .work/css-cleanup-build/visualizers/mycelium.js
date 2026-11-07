/* visualizers/mycelium.js — Micelio (organismo vivo con hifas definidas, anastomosis y decadencia)
 *
 * Archivo TOTALMENTE independiente: no necesita ningún otro script.
 * Incluye su propio motor (canvas, análisis de audio, paleta de la portada)
 * y el dibujado de este estilo.
 *
 * Uso:
 *   const viz = new AuraVisualizerStyles.mycelium(canvas, audioGraph);
 *   viz.start();               // inicia el bucle (con fundido de entrada)
 *   viz.stop();                // fundido de salida  ·  stop(true) = inmediato
 *   viz.setSensitivity(0.7);   // 0.4 – 1.2
 *   viz.clear();               // borra el lienzo (el organismo se conserva)
 *   viz.destroy();             // libera observadores, bucle y buffers
 *
 * audioGraph debe exponer getDataArray() (espectro 0-255) y getTimeDomain().
 * Ambos son opcionales en tiempo de ejecución: si faltan o devuelven null el
 * organismo entra en "silencio" (metabolismo mínimo) en lugar de romperse.
 * Opcionales en el DOM: #artFrame (marco de la portada) y #artImg (imagen).
 *
 * ── Modelo ───────────────────────────────────────────────────────────────
 *  · Las hifas son SEGMENTOS vectoriales (typed arrays) con grosor, salud,
 *    jerarquía y linaje: se dibujan nítidas, no como una mancha de píxeles.
 *  · Una rejilla Float32Array de feromonas (3 especies + sustrato) guía a
 *    los agentes (sensores tipo Physarum), impone la exclusión mutua entre
 *    especies y decide el contraste/grosor de cada vena.
 *  · Tres especies de agentes:
 *      0 · Graves  → cordones micelares (troncos gruesos, puntas hiperactivas)
 *      1 · Medios  → ramificaciones conectoras (meandros, abanicos, fractales)
 *      2 · Agudos  → microhifas capilares y esporas (vida muy corta)
 *  · Anastomosis: cuando una punta toca una hifa de su especie se funde con
 *    ella, cierra un bucle y refuerza (engrosa) toda la ruta hacia la raíz.
 *  · Decadencia: sin energía musical en su zona la hifa se adelgaza, se
 *    fragmenta en trozos y se reabsorbe (devuelve nutriente al organismo).
 *  · Frontera orgánica: radio dinámico que "respira" con los graves; cerca
 *    del borde las puntas frenan, se adelgazan y se repliegan hacia dentro.
 */
(function (global) {
  "use strict";

  const TAU = Math.PI * 2;
  const PI = Math.PI;
  // Sensibilidad base del visualizador; rango útil aproximado: 0.4–1.2.
  const SENSITIVITY = 0.7;
  // Paleta por defecto [h, s%, l%]: neón sobre latón / cobre envejecido.
  //   graves = latón incandescente · medios = cardenillo (cobre oxidado) · agudos = cobre al rojo
  const DEFAULT_PALETTE = [[44, 100, 62], [162, 100, 56], [14, 100, 64]];

  const SP_BASS = 0, SP_MID = 1, SP_HIGH = 2;

  // Capacidades fijas (todo vive en typed arrays preasignados: cero GC en el bucle).
  const MAX_SEG = 15000;
  const MAX_TIP = 700;
  const MAX_NODE = 220;
  const MAX_SPORE = 200;
  const MAX_PULSE = 7;
  const MAX_STRUCT = 1000;      // segmentos "venas principales" que no mueren en silencio
  const SECTORS = 28;           // parches de energía alrededor del organismo
  const RT = 256;               // resolución de la tabla de frontera (potencia de 2)

  // Cubos de dibujo: anchura × especie × opacidad, para agrupar trazos en pocos stroke().
  const NB = 7;
  const WIDTHS = [0.5, 0.8, 1.15, 1.6, 2.2, 3.0, 4.0];   // px de diseño (se escalan con `unit`)
  const ALPHAS = [0.42, 0.72, 1.0];
  const NKEY = NB * 9;

  // Parámetros por especie [graves, medios, agudos]
  const SPEED = [30, 34, 46];              // px/s de diseño
  const STEP = [5.2, 4.3, 3.4];            // longitud de segmento
  const W0 = [2.4, 1.2, 0.55];             // grosor inicial
  const WMAX = [3.6, 2.0, 0.85];            // grosor máximo tras refuerzos
  const WMIN = [1.0, 0.55, 0.32];
  const GAIN = [0.9, 0.7, 0.3];            // cuánto sostiene la música a cada hifa (segmento)
  const TIPGAIN = [1.3, 1.0, 0.7];         // cuánto alimenta la música a cada punta en crecimiento
  const DECAY = [0.05, 0.14, 1.0];         // degradación química base (1/s)
  const DRAIN = [0.07, 0.11, 0.55];        // gasto de energía de la punta (1/s)
  const WANDER = [0.4, 1.5, 3.2];          // nerviosismo del rumbo
  const BIAS = [1.0, 0.22, 0.5];           // tendencia a mantener rumbo/hacia la periferia
  const COST_SPAWN = [3, 1.6, 0.5];        // nutriente por brote nuevo
  const COST_STEP = [0.016, 0.011, 0.006]; // nutriente por segmento

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
    return d;
  };

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  // h en grados, s y l en 0–1 → [r, g, b] 0–255
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  class MyceliumVisualizer {
    constructor(canvas, audioGraph) {
      if (!canvas || typeof canvas.getContext !== "function") {
        throw new TypeError("[Mycelium] Se requiere un <canvas> válido.");
      }
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("[Mycelium] No se pudo obtener el contexto 2D.");
      this.canvas = canvas;
      this.ctx = ctx;
      this.graph = audioGraph || null;
      this.style = "mycelium";
      this.sensitivity = SENSITIVITY;
      this.running = false;
      this.destroyed = false;
      this.raf = null;
      this.fadeLevel = 0;
      this.fadeTarget = 1;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.lastFrame = 0;
      this.frameNo = 0;
      this.time = 0;
      this._errorLogged = false;
      this.smooth = new Float32Array(1024);
      this.silence = new Uint8Array(512);
      this._data = this.silence;
      this._time = null;
      this.palette = DEFAULT_PALETTE.map((c) => c.slice());
      this.paletteIsDefault = true;
      this.coverKey = "";
      this.styles = null;
      // geometría (se rellena en _geometry)
      this.cx = 0; this.cy = 0; this.core = 0; this.maxR = 0; this.unit = 1;
      this.geoValid = false; this.gCx = 0; this.gCy = 0; this.gCore = 0; this.gMax = 0;
      // rejilla química
      this.P = null; this.Q = null; this.cellSeg = null; this.grain = null;
      this.gw = 0; this.gh = 0; this.N = 0; this.cs = 6; this.invCs = 1 / 6;
      this.subCanvas = null; this.subCtx = null; this.subImg = null;
      this.diffAcc = 0;
      this.budget = 1;
      this.load = 0;
      this.softCap = 5600; this.tipCap = 120; this.pressure = 0;
      this.breath = 0.8;
      this._hx = 0; this._hy = 0;
      this.a = {
        bass: 0, mids: 0, highs: 0, energy: 0, bassAvg: 0, bassSlow: 0, highsAvg: 0,
        beat: false, hiTrans: false, pulse: 0, lastBeat: 0, lastHi: 0,
        level: 0, quiet: 1, flow: 0
      };
      this._alloc();
      this._resetOrganism();
      this._resize = this._resize.bind(this);
      this._tick = this._tick.bind(this);
      const artFrame = document.getElementById("artFrame");
      if (typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(this._resize);
        this.resizeObserver.observe(this.canvas);
        if (artFrame) this.resizeObserver.observe(artFrame);
      } else {
        window.addEventListener("resize", this._resize);
      }
      this._resize();
    }

    /* ───────────────────────── API pública ───────────────────────── */

    setSensitivity(v) {
      if (Number.isFinite(v)) this.sensitivity = Math.max(0.4, Math.min(1.2, v));
    }

    start() {
      if (this.destroyed) return;
      this.fadeTarget = 1;
      if (this.running) return;
      this._resize();
      this.running = true;
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this._tick);
    }

    stop(immediate = false) {
      if (this.destroyed) return;
      if (immediate) {
        this.fadeTarget = 0;
        this.fadeLevel = 0;
        this.running = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        this.clear();
        return;
      }
      // Mantiene un bucle corto para que el organismo se desvanezca con suavidad.
      this.fadeTarget = 0;
      if (this.running) return;
      if (this.fadeLevel <= 0.005) return;
      this._resize();
      this.running = true;
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this._tick);
    }

    clear() {
      if (this.ctx) this.ctx.clearRect(0, 0, this.w || 0, this.h || 0);
    }

    // Detiene el bucle, libera observadores y vacía todos los buffers.
    destroy() {
      if (this.destroyed) return;
      this.stop(true);
      this.destroyed = true;
      if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
      window.removeEventListener("resize", this._resize);
      for (const key of Object.keys(this)) {
        const v = this[key];
        if (ArrayBuffer.isView(v)) { v.fill(0); this[key] = null; }
        else if (Array.isArray(v)) { v.length = 0; this[key] = null; }
      }
      this.styles = null;
      this.subImg = null;
      if (this.subCanvas) { this.subCanvas.width = 1; this.subCanvas.height = 1; }
      this.subCtx = null;
      this.subCanvas = null;
      this.graph = null;
      this._data = null;
      this._time = null;
      this.ctx = null;
      this.canvas = null;
    }

    /* ───────────────────────── bucle ───────────────────────── */

    _tick() {
      this.raf = null;
      if (!this.running || this.destroyed) return;
      try {
        this._draw();
      } catch (err) {
        if (!this._errorLogged) { this._errorLogged = true; console.error("[Mycelium]", err); }
      }
      if (this.fadeTarget === 0 && this.fadeLevel <= 0.005) {
        this.fadeLevel = 0;
        this.running = false;
        this.clear();
        return;
      }
      if (this.running && !this.destroyed) this.raf = requestAnimationFrame(this._tick);
    }

    _draw() {
      if (this.destroyed || !this.ctx) return;
      if (!this._geometry()) { this.clear(); return; }
      const t0 = performance.now();
      const dt = clamp((t0 - (this.lastFrame || t0)) / 1000, 0.001, 0.05);
      this.lastFrame = t0;
      this.frameNo++;
      this.time += dt;

      this._readAudio();
      const data = this._data;
      const usable = Math.min(data.length, this.smooth.length);
      for (let i = 0; i < usable; i++) {
        const raw = data[i];
        const target = (Number.isFinite(raw) ? raw : 0) / 255;
        this.smooth[i] += (target - this.smooth[i]) * (target > this.smooth[i] ? 0.8 : 0.38);
      }
      if (usable < this.smooth.length) {
        for (let i = usable; i < this.smooth.length; i++) this.smooth[i] *= 0.9;
      }
      this._syncCover();
      this._analyze(data, this._time, t0, dt);
      this._ensureWorld();

      const fadeRate = this.fadeTarget > this.fadeLevel ? 8 : 5;
      this.fadeLevel += (this.fadeTarget - this.fadeLevel) * (1 - Math.exp(-fadeRate * dt));

      this._update(dt);
      this.clear();
      this._render();

      // Gobernador de rendimiento: si el cuadro se encarece, el organismo se vuelve más austero.
      const work = performance.now() - t0;
      this.load += (work - this.load) * 0.06;
      if (this.load > 13) this.budget = Math.max(0.45, this.budget - dt * 0.15);
      else if (this.load < 7) this.budget = Math.min(1, this.budget + dt * 0.05);
    }

    _resize() {
      if (this.destroyed || !this.canvas || !this.ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const cw = Math.max(1, Math.round(rect.width * dpr));
      const ch = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== cw) this.canvas.width = cw;
      if (this.canvas.height !== ch) this.canvas.height = ch;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dpr = dpr;
      this.w = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0;
      this.h = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;
    }

    /* ───────────────────────── memoria de la simulación ───────────────────────── */

    _alloc() {
      const f32 = (n) => new Float32Array(n);
      // Segmentos (hifas)
      this.sx0 = f32(MAX_SEG); this.sy0 = f32(MAX_SEG); this.sx1 = f32(MAX_SEG); this.sy1 = f32(MAX_SEG);
      this.sW = f32(MAX_SEG); this.sH = f32(MAX_SEG); this.sAge = f32(MAX_SEG);
      this.sDist = f32(MAX_SEG); this.sTh = f32(MAX_SEG);
      this.sSp = new Uint8Array(MAX_SEG); this.sFl = new Uint8Array(MAX_SEG); this.sRnd = new Uint8Array(MAX_SEG);
      this.sSer = new Uint32Array(MAX_SEG); this.sOwn = new Uint32Array(MAX_SEG); this.sPSer = new Uint32Array(MAX_SEG);
      this.sPar = new Int32Array(MAX_SEG);
      this.freeSeg = new Int32Array(MAX_SEG);
      // Puntas activas (agentes)
      this.tx = f32(MAX_TIP); this.ty = f32(MAX_TIP); this.tAng = f32(MAX_TIP); this.tHdg = f32(MAX_TIP);
      this.tW = f32(MAX_TIP); this.tE = f32(MAX_TIP); this.tAge = f32(MAX_TIP); this.tTtl = f32(MAX_TIP);
      this.tDist = f32(MAX_TIP); this.tTrav = f32(MAX_TIP); this.tBr = f32(MAX_TIP); this.tTurn = f32(MAX_TIP);
      this.tPh = f32(MAX_TIP); this.tHyper = f32(MAX_TIP); this.tAcc = f32(MAX_TIP); this.tOff = f32(MAX_TIP);
      this.tPar = new Int32Array(MAX_TIP); this.tUid = new Uint32Array(MAX_TIP);
      this.tSp = new Uint8Array(MAX_TIP); this.tAct = new Uint8Array(MAX_TIP);
      this.tStruct = new Uint8Array(MAX_TIP); this.tGen = new Uint8Array(MAX_TIP);
      this.tSide = new Int8Array(MAX_TIP);
      this.freeTip = new Int32Array(MAX_TIP);
      // Nodos de interconexión (brillan con el calor)
      this.nX = f32(MAX_NODE); this.nY = f32(MAX_NODE); this.nHeat = f32(MAX_NODE);
      this.nSeg = new Int32Array(MAX_NODE); this.nSer = new Uint32Array(MAX_NODE);
      this.nSp = new Uint8Array(MAX_NODE); this.nAct = new Uint8Array(MAX_NODE);
      // Esporas luminosas
      this.spX = f32(MAX_SPORE); this.spY = f32(MAX_SPORE); this.spVX = f32(MAX_SPORE); this.spVY = f32(MAX_SPORE);
      this.spLife = f32(MAX_SPORE); this.spTtl = f32(MAX_SPORE); this.spSz = f32(MAX_SPORE);
      this.spSp = new Uint8Array(MAX_SPORE); this.spAct = new Uint8Array(MAX_SPORE);
      // Ondas de nutriente (pulsos que recorren las venas con cada golpe de graves)
      this.pAge = f32(MAX_PULSE); this.pStr = f32(MAX_PULSE);
      this._pf = f32(MAX_PULSE); this._ps = f32(MAX_PULSE);
      // Tablas auxiliares
      this.rTab = f32(RT);
      this.sec = f32(SECTORS);
      this.order = new Int32Array(MAX_SEG);
      this.bucketOf = new Int16Array(MAX_SEG);
      this.hot = new Int32Array(MAX_SEG);
      this.glow = f32(MAX_SEG);
      this.counts = new Int32Array(NKEY + 1);
      this.offsets = new Int32Array(NKEY + 1);
    }

    _resetOrganism() {
      this.sFl.fill(0);
      this.tAct.fill(0);
      this.nAct.fill(0);
      this.spAct.fill(0);
      this.sec.fill(0);
      this.nextSeg = 0; this.segHigh = 0; this.freeSegTop = 0; this.segCount = 0; this.structCount = 0;
      this.nextTip = 0; this.tipHigh = 0; this.freeTipTop = 0; this.tipCount = 0; this.trunkTips = 0;
      this.nodeNext = 0; this.sporeNext = 0; this.pCount = 0;
      this.serial = 0; this.uid = 0;
      this.nutrient = 45;
      this.sproutAcc = 0; this.hiAcc = 0; this.rootAcc = 0;
      this.needSeed = true;
    }

    /* ───────────────────────── entrada de audio ───────────────────────── */

    _readAudio() {
      const g = this.graph;
      let data = null, time = null;
      try { if (g && typeof g.getDataArray === "function") data = g.getDataArray(); } catch (_) { data = null; }
      try { if (g && typeof g.getTimeDomain === "function") time = g.getTimeDomain(); } catch (_) { time = null; }
      if (!data || typeof data.length !== "number" || data.length < 4) data = this.silence;
      if (!time || typeof time.length !== "number" || time.length < 4) time = null;
      this._data = data;
      this._time = time;
    }

    _sample(data, index, count) {
      const position = clamp(index / Math.max(1, count - 1), 0, 1);
      const maxBin = Math.min(data.length - 1, this.smooth.length - 1);
      // Reparte los puntos en escala logarítmica y cubre también todo el rango agudo.
      const bin = Math.max(1, Math.round(Math.exp(Math.log(Math.max(1, maxBin)) * position)));
      const level = this.smooth[Math.min(bin, this.smooth.length - 1)] || 0;
      const shaped = Math.pow(level, 1.35);
      const bassBoost = Math.max(0, 1 - position / 0.4) * 0.55;
      const trebleBoost = Math.max(0, (position - 0.7) / 0.3) * 0.7;
      const x = shaped * this.sensitivity * (1.0 + bassBoost + trebleBoost);
      return Math.max(0, Math.min(1, x / (1 + 0.45 * x)));
    }

    _rms(time) {
      if (!time) return 0;
      const n = time.length, step = Math.max(1, (n / 256) | 0);
      const f = time instanceof Float32Array || time instanceof Float64Array;
      let sum = 0, c = 0;
      for (let i = 0; i < n; i += step) {
        const v = f ? time[i] : (time[i] - 128) / 128;
        if (v === v) { sum += v * v; c++; }
      }
      return c ? Math.sqrt(sum / c) : 0;
    }

    // Bandas, picos (graves y agudos), volumen global y parches de energía.
    _analyze(data, time, now, dt) {
      const a = this.a;
      let bass = 0, mids = 0, highs = 0, energy = 0;
      for (let i = 0; i < 14; i++) bass += this._sample(data, i, 96);
      for (let i = 20; i < 44; i++) mids += this._sample(data, i, 96);
      for (let i = 58; i < 90; i++) highs += this._sample(data, i, 96);
      for (let i = 0; i < 40; i++) energy += this._sample(data, i, 96);
      bass /= 14; mids /= 24; highs /= 32; energy /= 40;

      a.bassAvg += (bass - a.bassAvg) * Math.min(1, dt * 1.6);
      a.beat = false;
      if (bass > a.bassAvg * 1.22 + 0.035 && bass > 0.12 && now - a.lastBeat > 190) {
        a.beat = true;
        a.lastBeat = now;
        a.pulse = 1;
      }
      a.highsAvg += (highs - a.highsAvg) * Math.min(1, dt * 3.2);
      a.hiTrans = false;
      if (highs > a.highsAvg * 1.32 + 0.035 && highs > 0.1 && now - a.lastHi > 90) {
        a.hiTrans = true;
        a.lastHi = now;
      }
      a.pulse *= Math.exp(-dt * 4.5);

      const k = 1 - Math.exp(-dt * 18);
      a.bass += (bass - a.bass) * k;
      a.mids += (mids - a.mids) * k;
      a.highs += (highs - a.highs) * k;
      a.energy += (energy - a.energy) * k;
      a.bassSlow += (bass - a.bassSlow) * (1 - Math.exp(-dt * (bass > a.bassSlow ? 4 : 1.2)));

      // Volumen global (RMS temporal + energía espectral) → metabolismo.
      const rl = this._rms(time) * 3.0 * this.sensitivity;
      const rmsLevel = rl / (1 + 0.45 * rl);
      const target = Math.max(rmsLevel, energy * 0.9);
      a.level += (target - a.level) * (1 - Math.exp(-dt * (target > a.level ? 7 : 1.6)));
      a.quiet = 1 - smooth(0.02, 0.10, a.level);
      a.flow += dt * (0.3 + a.energy * 1.8);

      // Parches de energía: cada sector del contorno escucha una banda distinta
      // (reparto áureo, deriva lenta) → zonas del organismo que viven o se apagan.
      const kk = 1 - Math.exp(-dt * 13);
      const drift = a.flow * 0.012;
      for (let s = 0; s < SECTORS; s++) {
        const p = (s * 0.6180339887 + 0.07 + drift) % 1;
        const tgt = this._sample(data, (p * 92) | 0, 96);
        this.sec[s] += (tgt - this.sec[s]) * kk;
      }
    }

    // Energía musical local (0–1.2) en la posición angular u y radial rn.
    _zone(u, rn) {
      const a = this.a;
      const x = u * SECTORS;
      const i0 = x | 0;
      const f = x - i0;
      const s0 = this.sec[i0 % SECTORS], s1 = this.sec[(i0 + 1) % SECTORS];
      const sm = f * f * (3 - 2 * f);
      const loc = s0 + (s1 - s0) * sm;
      const rad = a.bass * Math.max(0, 1 - rn * 1.6)
        + a.mids * Math.max(0, 1 - Math.abs(rn - 0.5) * 2.2)
        + a.highs * Math.max(0, (rn - 0.3) / 0.7);
      const z = 0.5 * loc + 0.55 * rad + 0.2 * a.level;
      return z > 1.2 ? 1.2 : z;
    }

    /* ───────────────────────── geometría y mundo ───────────────────────── */

    _geometry() {
      if (!this.canvas) return false;
      const canvasRect = this.canvas.getBoundingClientRect();
      const cover = document.getElementById("artFrame");
      const coverRect = cover && cover.getBoundingClientRect();
      const w = this.w, h = this.h;
      const cx = coverRect ? coverRect.left + coverRect.width / 2 - canvasRect.left : w / 2;
      const cy = coverRect ? coverRect.top + coverRect.height / 2 - canvasRect.top : h / 2;
      const cw = cover ? cover.offsetWidth : 0;
      const ch = cover ? cover.offsetHeight : 0;
      const minSide = Math.min(w, h);
      const base = cover ? Math.min(cw, ch) / 2 : minSide * 0.12;
      const core = base * (cover ? 0.98 : 1);
      const max = Math.max(minSide * 0.495, core + 30);
      if (![cx, cy, core, max, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || core <= 0 || max <= 0) return false;
      this.cx = cx; this.cy = cy; this.core = core; this.maxR = max;
      this.unit = clamp(minSide / 760, 0.6, 1.5);
      return true;
    }

    // Reajusta rejilla, escala del organismo y siembra inicial ante cualquier cambio.
    _ensureWorld() {
      const w = this.w, h = this.h;
      let cs = clamp(Math.ceil(Math.max(w, h) / 180), 3, 8);
      while (Math.ceil(w / cs) * Math.ceil(h / cs) > 45000) cs++;
      const gw = Math.ceil(w / cs), gh = Math.ceil(h / cs);
      let rebuild = false;
      if (!this.P || gw !== this.gw || gh !== this.gh || cs !== this.cs) {
        this._allocGrid(gw, gh, cs);
        rebuild = true;
      }
      if (this.geoValid) {
        const dC = Math.abs(this.cx - this.gCx) + Math.abs(this.cy - this.gCy);
        const dK = Math.abs(this.core - this.gCore) + Math.abs(this.maxR - this.gMax);
        if (dC > 0.6 || dK > 0.8) {
          this._remap();
          if (dK > 0.02 * this.maxR || dC > 1.5 * cs) rebuild = true;
        }
      }
      this.gCx = this.cx; this.gCy = this.cy; this.gCore = this.core; this.gMax = this.maxR; this.geoValid = true;
      if (rebuild) this._rasterize();
      this.softCap = clamp(8000 * this.unit * this.unit, 3200, 11000) * this.budget;
      if (this.needSeed) { this._seedRoots(); this.needSeed = false; }
    }

    _allocGrid(gw, gh, cs) {
      const N = gw * gh;
      this.gw = gw; this.gh = gh; this.cs = cs; this.invCs = 1 / cs; this.N = N;
      this.P = new Float32Array(N * 4);   // planos: 0 graves · 1 medios · 2 agudos · 3 sustrato
      this.Q = new Float32Array(N * 4);
      this.cellSeg = new Int32Array(N).fill(-1);
      this.grain = new Float32Array(N);
      for (let i = 0; i < N; i++) this.grain[i] = Math.random();
      if (!this.subCanvas) this.subCanvas = document.createElement("canvas");
      this.subCanvas.width = gw;
      this.subCanvas.height = gh;
      this.subCtx = this.subCanvas.getContext("2d");
      this.subImg = this.subCtx ? this.subCtx.createImageData(gw, gh) : null;
    }

    // Reproyecta el organismo cuando cambia la escala/posición del canvas o de la portada.
    _remap() {
      const ocx = this.gCx, ocy = this.gCy, ocore = this.gCore;
      const k = (this.maxR - this.core) / Math.max(1, this.gMax - ocore);
      const ncx = this.cx, ncy = this.cy, ncore = this.core;
      const fix = (arrX, arrY, i) => {
        const dx = arrX[i] - ocx, dy = arrY[i] - ocy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < 1e-3) { arrX[i] = ncx; arrY[i] = ncy; return; }
        const r2 = Math.max(ncore * 0.5, ncore + (r - ocore) * k);
        const f = r2 / r;
        arrX[i] = ncx + dx * f; arrY[i] = ncy + dy * f;
      };
      for (let i = 0; i < this.segHigh; i++) {
        if (!(this.sFl[i] & 1)) continue;
        fix(this.sx0, this.sy0, i);
        fix(this.sx1, this.sy1, i);
      }
      for (let i = 0; i < this.tipHigh; i++) if (this.tAct[i]) fix(this.tx, this.ty, i);
      for (let i = 0; i < MAX_NODE; i++) if (this.nAct[i]) fix(this.nX, this.nY, i);
      this.spAct.fill(0);
    }

    // Vuelve a pintar las feromonas a partir de las hifas vivas (tras redimensionar la rejilla).
    _rasterize() {
      const N = this.N, P = this.P;
      P.fill(0); this.Q.fill(0); this.cellSeg.fill(-1);
      for (let i = 0; i < this.segHigh; i++) {
        if (!(this.sFl[i] & 1)) continue;
        const sp = this.sSp[i];
        const amt = 0.35 * this.sH[i] * (0.5 + 0.2 * this.sW[i]);
        const mx = (this.sx0[i] + this.sx1[i]) * 0.5, my = (this.sy0[i] + this.sy1[i]) * 0.5;
        const pts = [mx, my, this.sx1[i], this.sy1[i]];
        for (let k = 0; k < 4; k += 2) {
          const idx = this._cell(pts[k], pts[k + 1]);
          if (idx < 0) continue;
          this.cellSeg[idx] = i;
          P[sp * N + idx] = Math.min(2.2, P[sp * N + idx] + amt);
          P[3 * N + idx] = Math.min(3, P[3 * N + idx] + amt * 0.6);
        }
      }
    }

    _cell(x, y) {
      if (x < 0 || y < 0) return -1;
      const gx = (x * this.invCs) | 0, gy = (y * this.invCs) | 0;
      if (gx >= this.gw || gy >= this.gh) return -1;
      return gy * this.gw + gx;
    }

    _u(x, y) {
      let th = Math.atan2(y - this.cy, x - this.cx);
      if (th < 0) th += TAU;
      return th / TAU;
    }

    /* ───────────────────────── colores de portada ───────────────────────── */

    _syncCover() {
      const art = document.getElementById("artImg");
      const visible = !!art && art.style.display !== "none";
      const source = visible ? art.currentSrc || art.src || "default" : "default";
      const key = `${source}:${visible ? art.naturalWidth || 0 : 0}`;
      if (key === this.coverKey) return;
      this.coverKey = key;
      this._extractCoverColors(visible ? art : null, source);
      this.styles = null;
    }

    _extractCoverColors(image, key) {
      const fallback = () => {
        this.palette = DEFAULT_PALETTE.map((c) => c.slice());
        this.paletteIsDefault = true;
      };
      if (!image || key === "default" || !image.complete || !image.naturalWidth) { fallback(); return; }
      try {
        const size = 28;
        const sample = document.createElement("canvas");
        sample.width = size; sample.height = size;
        const sctx = sample.getContext("2d", { willReadFrequently: true });
        sctx.drawImage(image, 0, 0, size, size);
        const px = sctx.getImageData(0, 0, size, size).data;   // lanza SecurityError si hay CORS
        const bins = new Map();
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 200) continue;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx < 40 || mx - mn < 22) continue;
          const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
          const e = bins.get(k) || { w: 0, r: 0, g: 0, b: 0 };
          const wt = 0.4 + (mx - mn) / 255;
          e.w += wt; e.r += r * wt; e.g += g * wt; e.b += b * wt;
          bins.set(k, e);
        }
        const entries = [...bins.values()].sort((x, y) => y.w - x.w).map((e) => rgbToHsl(e.r / e.w, e.g / e.w, e.b / e.w));
        const picks = [];
        for (const c of entries) {
          if (picks.every((p) => Math.abs(((c[0] - p[0] + 540) % 360) - 180) >= 32)) picks.push(c);
          if (picks.length === 3) break;
        }
        if (!picks.length) { fallback(); return; }
        while (picks.length < 3) {
          const b = picks[0];
          picks.push([(b[0] + (picks.length === 1 ? 52 : -64) + 360) % 360, b[1], b[2]]);
        }
        // Tonos neón legibles sobre sustrato oscuro.
        this.palette = picks.map((c) => [Math.round(c[0]), Math.round(clamp(c[1] * 100, 78, 100)), Math.round(clamp(c[2] * 100, 56, 70))]);
        this.paletteIsDefault = false;
      } catch (_) { fallback(); }
    }

    _makeSprite(rgb) {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 64;
      const g = c.getContext("2d");
      if (!g) return c;
      const hi = rgb.map((v) => Math.round(v + (255 - v) * 0.55));
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${hi[0]},${hi[1]},${hi[2]},1)`);
      gr.addColorStop(0.2, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`);
      gr.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return c;
    }

    _buildStyles() {
      const pal = this.palette;
      const st = { body: [], halo: [], core: [], hot: [], rgb: [], sprites: [], brass: null, copper: null };
      for (let i = 0; i < 3; i++) {
        const p = pal[i];
        const h = p[0], s = p[1], l = p[2];
        st.body.push(`hsl(${h},${s}%,${l}%)`);
        st.halo.push(`hsl(${h},${s}%,${clamp(l - 6, 20, 90)}%)`);
        st.core.push(`hsl(${h},${Math.round(s * 0.55)}%,${clamp(l + 27, 40, 96)}%)`);
        st.hot.push(`hsl(${h},${Math.round(s * 0.35)}%,94%)`);
        const rgb = hslToRgb(h, s / 100, l / 100);
        st.rgb.push(rgb);
        st.sprites.push(this._makeSprite(rgb));
      }
      st.sprites.push(this._makeSprite([255, 255, 255]));
      if (this.paletteIsDefault) {
        st.brass = [46, 36, 20];    // latón oscuro
        st.copper = [58, 30, 20];   // cobre envejecido
      } else {
        st.brass = hslToRgb(pal[0][0], 0.30, 0.12);
        st.copper = hslToRgb(pal[1][0], 0.28, 0.10);
      }
      this.styles = st;
    }

    /* ───────────────────────── actualización ───────────────────────── */

    _update(dt) {
      const a = this.a;
      this.pressure = smooth(0.55, 1.0, this.segCount / Math.max(1, this.softCap));
      this.tipCap = Math.max(50, (110 + 520 * a.level) * this.budget * this.unit * this.unit);
      this.nutrient = Math.min(120, this.nutrient + dt * (3.5 + 140 * a.level));

      this._updateFrontier(dt);
      this.diffAcc += dt;
      if (this.diffAcc >= 0.032) { this._diffuse(this.diffAcc); this.diffAcc = 0; }

      if (a.beat) this._onBeat();
      if (a.hiTrans) this._sporeBurst();
      this._ambient(dt);
      this._growTips(dt);
      this._updateSegments(dt);
      this._updateNodes(dt);
      this._updatePulses(dt);
      this._updateSpores(dt);

      while (this.segHigh > 0 && !(this.sFl[this.segHigh - 1] & 1)) this.segHigh--;
      while (this.tipHigh > 0 && !this.tAct[this.tipHigh - 1]) this.tipHigh--;
    }

    // Frontera orgánica: radio por ángulo que respira con los graves.
    _updateFrontier(dt) {
      const a = this.a;
      const target = 0.8 + 0.2 * a.bassSlow + 0.07 * a.pulse;
      this.breath += (target - this.breath) * (1 - Math.exp(-dt * (target > this.breath ? 5 : 1.4)));
      const t = this.time, span = this.maxR - this.core, core = this.core;
      for (let k = 0; k < RT; k++) {
        const th = (k / RT) * TAU;
        const shape = 1
          + 0.100 * Math.sin(2 * th + t * 0.13 + 0.7)
          + 0.075 * Math.sin(3 * th - t * 0.09 + 2.1)
          + 0.050 * Math.sin(5 * th + t * 0.17 + 4.0)
          + 0.030 * Math.sin(8 * th - t * 0.23);
        this.rTab[k] = core + span * Math.min(1.05, this.breath * shape);
      }
    }

    // Difusión + evaporación de feromonas (a menor volumen, mayor evaporación).
    _diffuse(dt) {
      const gw = this.gw, gh = this.gh, N = this.N;
      const P = this.P, Q = this.Q;
      const ev = 0.95 - 0.62 * this.a.level;
      const kEv = Math.exp(-ev * dt), kSub = Math.exp(-0.05 * dt);
      for (let pl = 0; pl < 4; pl++) {
        const b = pl * N;
        const D = pl < 3 ? 0.22 : 0.42, kk = pl < 3 ? kEv : kSub;
        for (let gy = 1; gy < gh - 1; gy++) {
          let i = b + gy * gw + 1;
          for (let gx = 1; gx < gw - 1; gx++, i++) {
            const c = P[i];
            const avg = (P[i - 1] + P[i + 1] + P[i - gw] + P[i + gw]) * 0.25;
            const v = (c + (avg - c) * D) * kk;
            Q[i] = v < 0.0006 ? 0 : v;
          }
        }
        for (let gx = 0; gx < gw; gx++) { Q[b + gx] = 0; Q[b + (gh - 1) * gw + gx] = 0; }
        for (let gy = 0; gy < gh; gy++) { Q[b + gy * gw] = 0; Q[b + gy * gw + gw - 1] = 0; }
      }
      this.P = Q;
      this.Q = P;
    }

    // Depósito de feromona con exclusión mutua ligera entre especies.
    _stamp(x, y, seg, sp, amt) {
      const idx = this._cell(x, y);
      if (idx < 0) return;
      const N = this.N, P = this.P;
      if (seg >= 0) this.cellSeg[idx] = seg;
      const v = P[sp * N + idx] + amt;
      P[sp * N + idx] = v > 2.2 ? 2.2 : v;
      const s = P[3 * N + idx] + amt * 0.55;
      P[3 * N + idx] = s > 3 ? 3 : s;
      P[((sp + 1) % 3) * N + idx] *= 0.9;
      P[((sp + 2) % 3) * N + idx] *= 0.9;
    }

    // Valor químico percibido por un sensor de la especie sp.
    _sense(x, y, sp) {
      if (x < 0 || y < 0) return -1;
      const gx = (x * this.invCs) | 0, gy = (y * this.invCs) | 0;
      if (gx >= this.gw || gy >= this.gh) return -1;
      const i = gy * this.gw + gx, N = this.N, P = this.P;
      const own = P[sp * N + i];
      const oth = P[((sp + 1) % 3) * N + i] + P[((sp + 2) % 3) * N + i];
      // Atracción a la propia especie con saturación (evita colapsar en una masa).
      let v = own < 0.55 ? own : 0.55 - (own - 0.55) * 1.4;
      if (sp === 0) v *= 0.45; else if (sp === 1) v *= 1.25;   // las conectoras tienden a converger y fundirse
      // Exclusión: las otras especies repelen; a distancia suave se "encapsula" (corre en paralelo).
      if (oth < 0.12) { if (sp > 0) v += oth * 0.5; }
      else v += (sp > 0 ? 0.06 : 0) - (oth - 0.12) * 1.8;
      return v;
    }

    /* ───────────────────────── segmentos ───────────────────────── */

    _newSeg() {
      let i;
      if (this.freeSegTop > 0) i = this.freeSeg[--this.freeSegTop];
      else if (this.nextSeg < MAX_SEG) i = this.nextSeg++;
      else return -1;
      if (i >= this.segHigh) this.segHigh = i + 1;
      return i;
    }

    _freeSegment(i) {
      const fl = this.sFl[i];
      if (!(fl & 1)) return;
      if (fl & 2) this.structCount--;
      this.sFl[i] = 0;
      this.segCount--;
      this.freeSeg[this.freeSegTop++] = i;
    }

    // fl: bit1 = vena estructural · bit2 = puente de anastomosis
    _addSeg(x0, y0, x1, y1, sp, w, fl, par, own, dist) {
      const i = this._newSeg();
      if (i < 0) return -1;
      this.sx0[i] = x0; this.sy0[i] = y0; this.sx1[i] = x1; this.sy1[i] = y1;
      this.sSp[i] = sp; this.sW[i] = w; this.sH[i] = 1; this.sAge[i] = 0; this.sDist[i] = dist;
      this.sTh[i] = this._u((x0 + x1) * 0.5, (y0 + y1) * 0.5);
      this.sFl[i] = 1 | fl;
      this.sRnd[i] = (Math.random() * 256) | 0;
      this.sSer[i] = ++this.serial;
      this.sOwn[i] = own;
      this.sPar[i] = par;
      this.sPSer[i] = par >= 0 ? this.sSer[par] : 0;
      this.segCount++;
      if (fl & 2) this.structCount++;
      return i;
    }

    // Refuerza (engrosa y revitaliza) la ruta de ancestros de un segmento.
    _reinforce(seg, steps, dh, kw) {
      let s = seg;
      for (let k = 0; k < steps && s >= 0; k++) {
        if (!(this.sFl[s] & 1)) break;
        const sp = this.sSp[s];
        this.sH[s] = Math.min(1, this.sH[s] + dh);
        const w = this.sW[s] * (1 + kw);
        this.sW[s] = w > WMAX[sp] ? WMAX[sp] : w;
        const p = this.sPar[s];
        if (p < 0 || this.sSer[p] !== this.sPSer[s]) break;
        s = p;
      }
    }

    _updateSegments(dt) {
      const a = this.a, level = a.level, N = this.N, P = this.P;
      const cx = this.cx, cy = this.cy, core = this.core, rTab = this.rTab;
      const press = this.pressure;
      const decLevel = 1.65 - 1.2 * level;        // mayor volumen → menor evaporación química
      const slice = this.frameNo & 3;
      const hi = this.segHigh;
      const sx0 = this.sx0, sy0 = this.sy0, sx1 = this.sx1, sy1 = this.sy1;
      const sH = this.sH, sW = this.sW, sSp = this.sSp, sFl = this.sFl, sTh = this.sTh, sAge = this.sAge;
      for (let i = 0; i < hi; i++) {
        const fl = sFl[i];
        if (!(fl & 1)) continue;
        const sp = sSp[i];
        const mx = (sx0[i] + sx1[i]) * 0.5, my = (sy0[i] + sy1[i]) * 0.5;
        const dx = mx - cx, dy = my - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        const u = sTh[i];
        const R = rTab[(u * RT) & (RT - 1)];
        const d = (r - core) / Math.max(10, R - core);
        const zone = this._zone(u, d < 0 ? 0 : d > 1 ? 1 : d);
        let h = sH[i];
        const supply = zone * (0.35 + 0.9 * level) * GAIN[sp];
        let decay = DECAY[sp] * decLevel * (1 + 4 * press) / (0.75 + 0.3 * sW[i]);
        if (d > 1) decay += (d - 1) * 1.8;          // el borde agota los recursos
        h += (supply - decay) * dt;
        if (h > 1) h = 1;
        if ((fl & 2) && d < 1.5 && h < 0.58) h = 0.58;   // las venas principales sobreviven al silencio
        sAge[i] += dt;
        if (h <= 0.02) {
          this.nutrient += 0.02 + 0.03 * sW[i];     // reabsorción del tejido muerto
          this._freeSegment(i);
          continue;
        }
        sH[i] = h;
        if ((i & 3) === slice) {                    // mantenimiento químico de la vena
          const idx = this._cell(mx, my);
          if (idx >= 0) {
            const amt = 4 * dt * (0.12 + 0.1 * sW[i]) * h * 1.4;
            const v = P[sp * N + idx] + amt;
            P[sp * N + idx] = v > 2.2 ? 2.2 : v;
            const s = P[3 * N + idx] + amt * 0.5;
            P[3 * N + idx] = s > 3 ? 3 : s;
            this.cellSeg[idx] = i;
          }
        }
      }
    }

    /* ───────────────────────── puntas (agentes) ───────────────────────── */

    _spawnTip(x, y, ang, sp, w, e, gen, par, dist, struct, hdg, hyper) {
      let i;
      if (this.freeTipTop > 0) i = this.freeTip[--this.freeTipTop];
      else if (this.nextTip < MAX_TIP) i = this.nextTip++;
      else return -1;
      if (i >= this.tipHigh) this.tipHigh = i + 1;
      this.tAct[i] = 1; this.tSp[i] = sp;
      this.tx[i] = x; this.ty[i] = y; this.tAng[i] = ang; this.tHdg[i] = hdg;
      this.tW[i] = w; this.tE[i] = e; this.tAge[i] = 0;
      this.tTtl[i] = sp === 2 ? rand(0.9, 2.4) : sp === 1 ? rand(10, 30) : rand(14, 40);
      this.tDist[i] = dist; this.tTrav[i] = 0; this.tAcc[i] = 0;
      this.tBr[i] = this._nextBranch(sp) * rand(0.6, 1.4);
      this.tTurn[i] = 0; this.tPh[i] = rand(0, TAU); this.tHyper[i] = hyper;
      this.tOff[i] = rand(-0.5, 0.5);
      this.tPar[i] = par; this.tUid[i] = ++this.uid;
      this.tStruct[i] = struct ? 1 : 0; this.tGen[i] = Math.min(255, gen);
      this.tSide[i] = Math.random() < 0.5 ? -1 : 1;
      this.tipCount++;
      return i;
    }

    _killTip(i) {
      if (!this.tAct[i]) return;
      this.tAct[i] = 0;
      this.freeTip[this.freeTipTop++] = i;
      this.tipCount--;
    }

    _nextBranch(sp) {
      return (sp === 0 ? rand(18, 42) : sp === 1 ? rand(10, 27) : rand(8, 18)) * this.unit;
    }

    // Raíces nuevas que nacen en el borde de la portada, donde hay más energía.
    _spawnRoot(hyper) {
      if (this.tipCount >= MAX_TIP - 4) return false;
      let bestU = Math.random(), bestZ = -1;
      for (let k = 0; k < 6; k++) {
        const u = Math.random();
        const z = this._zone(u, 0.05) + Math.random() * 0.15;
        if (z > bestZ) { bestZ = z; bestU = u; }
      }
      const th = bestU * TAU;
      const r = this.core * rand(1.0, 1.04);
      const x = this.cx + Math.cos(th) * r, y = this.cy + Math.sin(th) * r;
      if (x < 4 || y < 4 || x > this.w - 4 || y > this.h - 4) return false;
      const t = this._spawnTip(x, y, th + rand(-0.5, 0.5), SP_BASS, W0[0] * rand(0.85, 1.05), 1, 0, -1, 0,
        this.structCount < MAX_STRUCT, th, hyper ? 1.2 : 0);
      if (t >= 0) this.nutrient -= COST_SPAWN[0];
      return t >= 0;
    }

    _seedRoots() {
      const n = 12;
      const phase = Math.random() * TAU;
      for (let k = 0; k < n; k++) {
        const th = phase + ((k + rand(-0.4, 0.4)) / n) * TAU;
        const r = this.core * rand(0.99, 1.03);
        const x = this.cx + Math.cos(th) * r, y = this.cy + Math.sin(th) * r;
        if (x < 4 || y < 4 || x > this.w - 4 || y > this.h - 4) continue;
        this._spawnTip(x, y, th + rand(-0.45, 0.45), SP_BASS, W0[0] * rand(0.85, 1.05), 1, 0, -1, 0, 1, th, 0);
      }
      for (let k = 0; k < 8; k++) {
        const th = Math.random() * TAU;
        const r = this.core * rand(0.99, 1.03);
        const x = this.cx + Math.cos(th) * r, y = this.cy + Math.sin(th) * r;
        if (x < 4 || y < 4 || x > this.w - 4 || y > this.h - 4) continue;
        this._spawnTip(x, y, th + rand(-0.8, 0.8), SP_MID, W0[1], 1, 1, -1, 0, 0, th, 0);
      }
    }

    // Punta de contacto: busca una hifa más antigua de la misma especie al alcance.
    _findHit(i, nx, ny, ang, sp) {
      if (this.tTrav[i] < 24 * this.unit) return -1;
      const cs = this.cs, own = this.tUid[i];
      const reach = cs * 1.0 + 1.2 * this.unit;
      const ra2 = reach * reach;
      const qx = nx + Math.cos(ang) * cs * 0.45, qy = ny + Math.sin(ang) * cs * 0.45;
      let best = -1, bd = 1e9;
      for (let k = 0; k < 3; k++) {
        const aa = ang + (k - 1) * 0.55;
        const dd = k === 1 ? 1.3 : 0.9;
        const idx = this._cell(nx + Math.cos(aa) * cs * dd, ny + Math.sin(aa) * cs * dd);
        if (idx < 0) continue;
        const s = this.cellSeg[idx];
        if (s < 0 || !(this.sFl[s] & 1) || this.sSp[s] !== sp || this.sOwn[s] === own || this.sH[s] < 0.3) continue;
        const x0 = this.sx0[s], y0 = this.sy0[s];
        const vx = this.sx1[s] - x0, vy = this.sy1[s] - y0;
        const l2 = vx * vx + vy * vy;
        let t = l2 > 0 ? ((qx - x0) * vx + (qy - y0) * vy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x0 + vx * t, py = y0 + vy * t;
        const ex = qx - px, ey = qy - py;
        const d2 = ex * ex + ey * ey;
        if (d2 < ra2 && d2 < bd) { bd = d2; best = s; this._hx = px; this._hy = py; }
      }
      return best;
    }

    _addNode(x, y, seg, sp, heat) {
      if (seg < 0) return;
      const k = this.nodeNext;
      this.nodeNext = (k + 1) % MAX_NODE;
      this.nX[k] = x; this.nY[k] = y; this.nHeat[k] = heat;
      this.nSeg[k] = seg; this.nSer[k] = this.sSer[seg]; this.nSp[k] = sp; this.nAct[k] = 1;
    }

    // Ramificación lateral o bifurcación; devuelve el giro que se aplica a la punta madre.
    _branch(i, x, y, ang, seg) {
      if (this.tipCount >= this.tipCap || this.nutrient < 2 || seg < 0) return 0;
      const sp = this.tSp[i];
      const side = this.tSide[i];
      this.tSide[i] = -side;                         // alternancia → abanicos y peines
      const roll = Math.random();
      const gen = this.tGen[i] + 1;
      let nsp = -1, nang = 0, nw = 0, turn = 0, struct = 0;
      if (sp === SP_BASS) {
        if (roll < 0.05 && gen < 3 && this.structCount < MAX_STRUCT) {
          nsp = 0; nang = ang + side * rand(0.55, 0.95); nw = Math.max(1.6, this.tW[i] * 0.66); struct = this.tStruct[i];
        } else {
          nsp = 1; nang = ang + side * rand(0.7, 1.25); nw = W0[1] * rand(0.85, 1.15);
        }
      } else if (sp === SP_MID) {
        if (roll < 0.62) {
          nsp = 1; nang = ang + side * rand(0.55, 1.1); nw = Math.min(W0[1], this.tW[i] * 0.92);
        } else {
          nsp = 1; nang = ang + side * rand(0.4, 0.65); nw = this.tW[i] * 0.9; turn = -side * 0.3;
        }
      } else {
        if (roll < 0.22) { nsp = 2; nang = ang + side * rand(0.6, 1.1); nw = this.tW[i] * 0.85; }
        else return 0;
      }
      const cost = COST_SPAWN[nsp];
      if (this.nutrient < cost) return 0;
      const t = this._spawnTip(x, y, nang, nsp, Math.max(WMIN[nsp], nw), Math.min(1, this.tE[i] * 0.85), gen, seg,
        this.tDist[i], struct, nang, 0);
      if (t >= 0) {
        this.nutrient -= cost;
        this._reinforce(seg, 10, 0.03, 0.02);        // los troncos engrosan donde nacen ramas
        if (Math.random() < 0.08) this._addNode(x, y, seg, sp, 0.6);
      }
      return turn;
    }

    _growTips(dt) {
      const a = this.a;
      const nf = clamp(this.nutrient / 14, 0.12, 1);
      const metab = 0.28 + 1.05 * a.level;          // el volumen acelera el ciclo vital
      let trunks = 0;
      for (let i = 0; i < this.tipHigh; i++) {
        if (!this.tAct[i]) continue;
        if (this.tSp[i] === SP_BASS) trunks++;
        this._stepTip(i, dt, nf, metab);
      }
      this.trunkTips = trunks;
      // Mantiene siempre un mínimo de raíces vivas (incluso en silencio, a ritmo mínimo).
      this.rootAcc += dt * 0.5;
      if (this.rootAcc >= 1) {
        this.rootAcc = 0;
        if (this.trunkTips < 4 && this.nutrient > 8) this._spawnRoot(false);
      }
    }

    _stepTip(i, dt, nf, metab) {
      const a = this.a;
      const sp = this.tSp[i];
      const unit = this.unit;
      let x = this.tx[i], y = this.ty[i], ang = this.tAng[i];
      const dxc = x - this.cx, dyc = y - this.cy;
      const r = Math.sqrt(dxc * dxc + dyc * dyc) + 1e-6;
      let th = Math.atan2(dyc, dxc);
      const u = (th < 0 ? th + TAU : th) / TAU;
      const R = this.rTab[(u * RT) & (RT - 1)];
      const span = Math.max(10, R - this.core);
      const d = (r - this.core) / span;                // 0 en la portada · 1 en la frontera
      const edge = smooth(0.55, 1.0, d);
      const zone = this._zone(u, d < 0 ? 0 : d > 1 ? 1 : d);

      // Energía de la punta: la música de su zona la alimenta, el borde la agota.
      let e = this.tE[i];
      e += dt * (zone * (0.5 + 0.8 * a.level) * TIPGAIN[sp] - DRAIN[sp] * (1 + 0.8 * edge));
      // Agotamiento de recursos en el extremo: las puntas se extinguen en vez de orbitar la frontera.
      e -= dt * (sp === 0 ? 2.2 : 0.7) * smooth(0.78, 1.02, d);
      if (e > 1.25) e = 1.25;
      this.tAge[i] += dt;
      if (e <= 0 || this.tAge[i] > this.tTtl[i]) { this._killTip(i); return; }
      this.tE[i] = e;

      let hy = this.tHyper[i];
      if (hy > 0) { hy -= dt; this.tHyper[i] = hy > 0 ? hy : 0; }

      // Velocidad: metabolismo · nutriente · energía local · frenado en la frontera · pico de graves.
      let spd = SPEED[sp] * unit * (0.22 + 0.78 * metab) * nf * (1 - 0.9 * edge) * (0.55 + 0.7 * Math.min(zone, 1));
      if (hy > 0) spd *= 1 + 2.6 * Math.min(1, hy);

      // Repliegue hacia el interior al acercarse a la frontera; repulsión de la portada.
      const inw = smooth(0.82, 1.08, d);
      if (inw > 0 && sp !== 0) ang += clamp(angDiff(ang, th + PI), -1, 1) * inw * dt * 1.8;   // las finas se repliegan en gancho
      if (d < 0) ang += angDiff(ang, th) * clamp(-d * 8, 0, 1) * dt * 5;

      const sl = STEP[sp] * unit;
      let acc = this.tAcc[i] + spd * dt;
      const pref = sp === SP_BASS ? th + this.tOff[i] : this.tHdg[i];
      const sd = this.cs * 2.2;
      let n = 0;
      while (acc >= sl && n < 4) {
        acc -= sl; n++;
        const dtS = Math.min(0.12, sl / Math.max(spd, 5));

        // Sensores tipo Physarum: los medios abren/cierran el ángulo según su energía.
        const phi = sp === 0 ? 0.30 : sp === 1 ? 0.26 + 1.05 * a.mids : 0.5;
        const rot = sp === 0 ? 0.16 : sp === 1 ? 0.10 + 0.5 * a.mids : 0.45;
        const vL = this._sense(x + Math.cos(ang - phi) * sd, y + Math.sin(ang - phi) * sd, sp);
        const vC = this._sense(x + Math.cos(ang) * sd, y + Math.sin(ang) * sd, sp);
        const vR = this._sense(x + Math.cos(ang + phi) * sd, y + Math.sin(ang + phi) * sd, sp);
        let turn = clamp((vR - vL) * 1.6, -rot, rot);
        if (vC > vL && vC > vR) turn *= 0.3;

        // Ruido de rumbo suave (proceso de Ornstein-Uhlenbeck) → curvatura orgánica.
        let tw = this.tTurn[i];
        tw += -tw * dtS * 3 + (Math.random() * 2 - 1) * WANDER[sp] * Math.sqrt(dtS) * 1.7;
        this.tTurn[i] = tw;

        let steer = tw + angDiff(ang, pref) * BIAS[sp] * (sp === 0 ? 1 - 0.55 * smooth(0.4, 0.9, d) : 1) * (hy > 0 ? 2 : 1);
        if (sp === SP_MID) {   // meandros / abanicos moldeados por la energía de los medios
          steer += Math.sin(this.tPh[i] + this.tAge[i] * (1.6 + 5 * a.mids)) * (0.3 + 2.6 * a.mids);
        }
        ang += turn + steer * dtS;

        const nx = x + Math.cos(ang) * sl, ny = y + Math.sin(ang) * sl;
        if (nx < 2 || ny < 2 || nx > this.w - 2 || ny > this.h - 2) { this._killTip(i); return; }

        // Anastomosis: fusión con una hifa de la misma especie.
        const hit = this._findHit(i, nx, ny, ang, sp);
        if (hit >= 0 && Math.random() < 0.9) {
          const hx = this._hx, hy2 = this._hy;
          const len = Math.hypot(hx - x, hy2 - y);
          const bw = Math.max(WMIN[sp], this.tW[i] * 0.8);
          const bi = this._addSeg(x, y, hx, hy2, sp, bw, 4, this.tPar[i], this.tUid[i], this.tDist[i] + len);
          if (bi >= 0) {
            this._stamp((x + hx) * 0.5, (y + hy2) * 0.5, bi, sp, 0.3);
            this._reinforce(bi, 30, 0.22, 0.04);      // el bucle refuerza toda la ruta hasta la raíz
            this._addNode(hx, hy2, hit, sp, 1);
          }
          this._reinforce(hit, 18, 0.12, 0.03);
          this.nutrient = Math.min(120, this.nutrient + 0.8);
          this._killTip(i);
          return;
        }

        // Crecimiento: nuevo segmento vectorial.
        const wSeg = clamp(this.tW[i] * (0.55 + 0.45 * Math.min(1, e)) * (1 - 0.5 * edge) * (hy > 0 ? 1.12 : 1), 0.3, WMAX[sp]);
        const dist = this.tDist[i] + sl;
        const fl = this.tStruct[i] && this.structCount < MAX_STRUCT ? 2 : 0;
        if (this.segCount > MAX_SEG - 80) { this._killTip(i); return; }
        const seg = this._addSeg(x, y, nx, ny, sp, wSeg, fl, this.tPar[i], this.tUid[i], dist);
        if (seg < 0) { this._killTip(i); return; }
        const dep = 0.16 + 0.07 * wSeg;
        this._stamp((x + nx) * 0.5, (y + ny) * 0.5, seg, sp, dep);
        this._stamp(nx, ny, seg, sp, dep * 0.7);
        this.tPar[i] = seg;
        this.tDist[i] = dist;
        this.tTrav[i] += sl;
        this.nutrient -= COST_STEP[sp];
        const tw2 = this.tW[i] * (sp === 0 ? 0.9985 : sp === 1 ? 0.996 : 0.99);
        this.tW[i] = tw2 < WMIN[sp] ? WMIN[sp] : tw2;
        x = nx; y = ny;

        // Densidad excesiva de la propia especie → la punta cesa (evita masas homogéneas).
        const cIdx = this._cell(x, y);
        if (sp !== 0 && cIdx >= 0 && this.P[sp * this.N + cIdx] > 1.3 && Math.random() < 0.25) { this._killTip(i); return; }

        this.tBr[i] -= sl;
        if (this.tBr[i] <= 0) {
          const zm = 0.6 + 0.8 / (0.5 + zone);
          this.tBr[i] = this._nextBranch(sp) * zm * (sp === 1 ? 1 - 0.5 * a.mids : 1);
          ang += this._branch(i, x, y, ang, seg);
        }
      }
      if (acc > sl * 3) acc = 0;
      this.tAcc[i] = acc;
      this.tx[i] = x; this.ty[i] = y; this.tAng[i] = ang;
    }

    /* ───────────────────────── eventos musicales ───────────────────────── */

    _addPulse(str) {
      if (this.pCount >= MAX_PULSE) {
        for (let k = 1; k < MAX_PULSE; k++) { this.pAge[k - 1] = this.pAge[k]; this.pStr[k - 1] = this.pStr[k]; }
        this.pCount = MAX_PULSE - 1;
      }
      this.pAge[this.pCount] = 0;
      this.pStr[this.pCount] = str;
      this.pCount++;
    }

    _updatePulses(dt) {
      const decay = Math.exp(-dt * 0.55);
      const reach = this.maxR * 2.6;
      const vel = (200 + 160 * this.a.level) * this.unit;
      let w = 0;
      for (let k = 0; k < this.pCount; k++) {
        const age = this.pAge[k] + dt, str = this.pStr[k] * decay;
        if (str < 0.06 || age * vel > reach) continue;
        this.pAge[w] = age; this.pStr[w] = str; w++;
      }
      this.pCount = w;
    }

    // Golpe de graves: pico metabólico → puntas hiperactivas hacia la periferia.
    _onBeat() {
      const a = this.a;
      const str = clamp(0.55 + a.bass * 1.1, 0.55, 1.5);
      this._addPulse(str);
      for (let i = 0; i < this.tipHigh; i++) {
        if (this.tAct[i] && this.tSp[i] === SP_BASS) {
          this.tHyper[i] = 0.8 + 0.6 * str;
          this.tE[i] = Math.min(1.25, this.tE[i] + 0.3);
        }
      }
      const n = 1 + (str > 1.1 && Math.random() < 0.6 ? 1 : 0);
      const maxTrunks = 8 + 12 * a.level;
      for (let k = 0; k < n; k++) {
        if (this.trunkTips >= maxTrunks || this.tipCount >= this.tipCap * 1.2 || this.nutrient < COST_SPAWN[0]) break;
        if (!this._explorer(str)) this._spawnRoot(true);
      }
    }

    // Brota una punta exploradora hiperactiva desde un cordón de la mitad interna.
    _explorer(str) {
      const hi = this.segHigh;
      if (!hi) return false;
      for (let t = 0; t < 24; t++) {
        const s = (Math.random() * hi) | 0;
        if (!(this.sFl[s] & 1) || this.sSp[s] !== SP_BASS || this.sH[s] < 0.5) continue;
        const mx = (this.sx0[s] + this.sx1[s]) * 0.5, my = (this.sy0[s] + this.sy1[s]) * 0.5;
        const r = Math.hypot(mx - this.cx, my - this.cy);
        const u = this.sTh[s];
        const d = (r - this.core) / Math.max(10, this.rTab[(u * RT) & (RT - 1)] - this.core);
        if (d > 0.62) continue;
        const out = u * TAU;
        const ang = out + rand(-0.8, 0.8);
        const st = this.structCount < MAX_STRUCT ? 1 : 0;
        const tip = this._spawnTip(mx, my, ang, SP_BASS, W0[0] * 0.8, 1, 1, s, this.sDist[s], st, out, 1.0 + 0.5 * str);
        if (tip >= 0) {
          this.nutrient -= COST_SPAWN[0];
          this._reinforce(s, 12, 0.05, 0.02);
          return true;
        }
      }
      return false;
    }

    // Transitorio agudo: brote de esporas luminosas con microhifas radiales.
    _sporeBurst() {
      const a = this.a;
      const bursts = 1 + (a.highs > 0.45 ? 1 : 0);
      for (let b = 0; b < bursts; b++) {
        const hi = this.segHigh;
        let found = -1, ax = 0, ay = 0, base = 0;
        for (let t = 0; t < 18 && hi > 0; t++) {
          const s = (Math.random() * hi) | 0;
          if (!(this.sFl[s] & 1) || this.sSp[s] < 1 || this.sH[s] < 0.45) continue;
          const mx = (this.sx0[s] + this.sx1[s]) * 0.5, my = (this.sy0[s] + this.sy1[s]) * 0.5;
          const r = Math.hypot(mx - this.cx, my - this.cy);
          const u = this.sTh[s];
          const d = (r - this.core) / Math.max(10, this.rTab[(u * RT) & (RT - 1)] - this.core);
          if (d < 0.38 || d > 1.0) continue;
          found = s; ax = mx; ay = my; base = Math.atan2(my - this.cy, mx - this.cx);
          break;
        }
        if (found < 0) continue;
        const n = 4 + ((a.highs * 7 + Math.random() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const ang = base + ((k + rand(-0.3, 0.3)) / n) * TAU;
          if (this.tipCount < this.tipCap * 1.3 && this.nutrient > COST_SPAWN[2]) {
            const tip = this._spawnTip(ax, ay, ang, SP_HIGH, W0[2] * rand(0.85, 1.1), 1, 3, found, this.sDist[found], 0, ang, 0);
            if (tip >= 0) this.nutrient -= COST_SPAWN[2];
          }
          this._addSpore(ax, ay, ang, rand(30, 90) * this.unit, 2);
        }
        this._addNode(ax, ay, found, this.sSp[found], 1);
      }
    }

    // Brotes intersticiales: nuevas ramas desde hifas existentes, donde hay energía.
    _ambient(dt) {
      const a = this.a;
      if (this.tipCount >= this.tipCap) return;
      this.sproutAcc += dt * (0.5 + 22 * a.level);
      let guard = 0;
      while (this.sproutAcc >= 1 && guard++ < 6) {
        this.sproutAcc -= 1;
        if (this.nutrient > COST_SPAWN[1]) this._sprout(SP_MID, 0.0, 0.95);
      }
      this.hiAcc += dt * (0.2 + 26 * a.highs * a.highs);
      guard = 0;
      while (this.hiAcc >= 1 && guard++ < 6) {
        this.hiAcc -= 1;
        if (this.nutrient > COST_SPAWN[2]) this._sprout(SP_HIGH, 0.3, 1.0);
      }
    }

    _sprout(sp, dMin, dMax) {
      const hi = this.segHigh;
      if (!hi) return false;
      for (let t = 0; t < 14; t++) {
        const s = (Math.random() * hi) | 0;
        if (!(this.sFl[s] & 1)) continue;
        const ssp = this.sSp[s];
        if (sp === SP_MID && ssp > 1) continue;
        if (sp === SP_HIGH && ssp === 0 && Math.random() < 0.6) continue;
        if (this.sH[s] < 0.55 || this.sAge[s] < 0.5) continue;
        const mx = (this.sx0[s] + this.sx1[s]) * 0.5, my = (this.sy0[s] + this.sy1[s]) * 0.5;
        const u = this.sTh[s];
        const r = Math.hypot(mx - this.cx, my - this.cy);
        const d = (r - this.core) / Math.max(10, this.rTab[(u * RT) & (RT - 1)] - this.core);
        if (d < dMin || d > dMax) continue;
        const zone = this._zone(u, clamp(d, 0, 1));
        if (zone < 0.12 && Math.random() < 0.8) continue;
        const dir = Math.atan2(this.sy1[s] - this.sy0[s], this.sx1[s] - this.sx0[s]);
        const side = Math.random() < 0.5 ? -1 : 1;
        const nang = dir + side * rand(0.8, 1.45);
        const tip = this._spawnTip(mx, my, nang, sp, W0[sp] * rand(0.85, 1.1), 0.9, 2, s, this.sDist[s], 0, nang, 0);
        if (tip >= 0) { this.nutrient -= COST_SPAWN[sp]; return true; }
      }
      return false;
    }

    /* ───────────────────────── nodos y esporas ───────────────────────── */

    _updateNodes(dt) {
      const target = 0.1 + 0.75 * this.a.level;       // a más volumen, más incandescencia
      const k = 1 - Math.exp(-dt * 0.9);
      for (let i = 0; i < MAX_NODE; i++) {
        if (!this.nAct[i]) continue;
        const s = this.nSeg[i];
        if (!(this.sFl[s] & 1) || this.sSer[s] !== this.nSer[i]) { this.nAct[i] = 0; continue; }
        this.nHeat[i] += (target * (0.6 + 0.4 * this.sH[s]) - this.nHeat[i]) * k;
      }
    }

    _addSpore(x, y, ang, speed, sp) {
      const k = this.sporeNext;
      this.sporeNext = (k + 1) % MAX_SPORE;
      this.spX[k] = x; this.spY[k] = y;
      this.spVX[k] = Math.cos(ang) * speed; this.spVY[k] = Math.sin(ang) * speed;
      this.spLife[k] = 0; this.spTtl[k] = rand(0.5, 1.3);
      this.spSz[k] = rand(2.2, 4.2) * this.unit;
      this.spSp[k] = sp; this.spAct[k] = 1;
    }

    _updateSpores(dt) {
      const damp = Math.exp(-dt * 1.8);
      for (let i = 0; i < MAX_SPORE; i++) {
        if (!this.spAct[i]) continue;
        this.spLife[i] += dt;
        if (this.spLife[i] >= this.spTtl[i]) { this.spAct[i] = 0; continue; }
        this.spX[i] += this.spVX[i] * dt; this.spY[i] += this.spVY[i] * dt;
        this.spVX[i] *= damp; this.spVY[i] *= damp;
      }
    }

    /* ───────────────────────── dibujo ───────────────────────── */

    _render() {
      const F = this.fadeLevel;
      if (F <= 0.002 || !this.P) return;
      if (!this.styles) this._buildStyles();
      const ctx = this.ctx;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      this._drawSubstrate(F);
      this._drawNetwork(F);
      this._drawNodes(F);
      this._drawTips(F);
      this._drawSpores(F);
      ctx.restore();
    }

    // Sustrato metálico (latón/cobre) que se oscurece donde el micelio ha colonizado.
    _drawSubstrate(F) {
      if (!this.subImg || !this.subCtx) return;
      if ((this.frameNo & 1) === 0) {
        const st = this.styles, N = this.N, P = this.P, d = this.subImg.data, gr = this.grain;
        const b = st.brass, c = st.copper, r0 = st.rgb[0], r1 = st.rgb[1], r2 = st.rgb[2];
        for (let i = 0, j = 0; i < N; i++, j += 4) {
          const s = P[3 * N + i];
          if (s < 0.02) { d[j + 3] = 0; continue; }
          const t = s > 1.1 ? 1 : s * 0.909;
          const q = gr[i];
          const p0 = P[i], p1 = P[N + i], p2 = P[2 * N + i];
          d[j] = b[0] + (c[0] - b[0]) * q + (r0[0] * p0 + r1[0] * p1 + r2[0] * p2) * 0.08;
          d[j + 1] = b[1] + (c[1] - b[1]) * q + (r0[1] * p0 + r1[1] * p1 + r2[1] * p2) * 0.08;
          d[j + 2] = b[2] + (c[2] - b[2]) * q + (r0[2] * p0 + r1[2] * p1 + r2[2] * p2) * 0.08;
          d[j + 3] = (t * 150) | 0;
        }
        this.subCtx.putImageData(this.subImg, 0, 0);
      }
      const ctx = this.ctx;
      ctx.globalAlpha = F;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.subCanvas, 0, 0, this.gw * this.cs, this.gh * this.cs);
    }

    _drawNetwork(F) {
      const ctx = this.ctx, st = this.styles, a = this.a;
      const hi = this.segHigh, N = this.N, P = this.P, unit = this.unit;
      const counts = this.counts, offsets = this.offsets, bucketOf = this.bucketOf, order = this.order;
      const sx0 = this.sx0, sy0 = this.sy0, sx1 = this.sx1, sy1 = this.sy1;
      const sH = this.sH, sW = this.sW, sSp = this.sSp, sFl = this.sFl, sRnd = this.sRnd, sAge = this.sAge, sDist = this.sDist;
      counts.fill(0);

      // Frentes de las ondas de nutriente (pulsos que viajan por las venas).
      const pf = this._pf, ps = this._ps;
      const vel = (200 + 160 * a.level) * unit, bandInv = 1 / (30 * unit);
      const np = this.pCount;
      for (let p = 0; p < np; p++) { pf[p] = this.pAge[p] * vel; ps[p] = this.pStr[p]; }
      const inc = 0.62 + 0.55 * a.level;          // incandescencia global con el volumen
      let hotN = 0;

      for (let i = 0; i < hi; i++) {
        if (!(sFl[i] & 1)) { bucketOf[i] = -1; continue; }
        const h = sH[i];
        // Fragmentación: al perder salud la hifa se rompe en trozos antes de desvanecerse.
        if (h < 0.42 && sRnd[i] * (1 / 255) > h * 2.38) { bucketOf[i] = -1; continue; }
        const sp = sSp[i];
        const idx = this._cell((sx0[i] + sx1[i]) * 0.5, (sy0[i] + sy1[i]) * 0.5);
        const phi = idx >= 0 ? P[sp * N + idx] : 0;
        const pc = phi > 1 ? 1 : phi;
        // Contraste: las venas con más feromona acumulada se ven más gruesas y brillantes.
        const w = sW[i] * (0.5 + 0.5 * Math.sqrt(h > 1 ? 1 : h)) * (0.82 + 0.5 * pc);
        let b = 0;
        while (b < NB - 1 && w > WIDTHS[b] * 1.12) b++;
        const age = sAge[i];
        const vis = (0.4 + 0.6 * Math.min(1, h * 1.6)) * Math.min(1, age * 7) * inc * (0.72 + 0.38 * pc);
        const ab = vis > 0.8 ? 2 : vis > 0.52 ? 1 : 0;

        let gl = 0;
        const sd = sDist[i];
        for (let p = 0; p < np; p++) {
          const dd = (sd - pf[p]) * bandInv;
          if (dd > -3 && dd < 3) gl += ps[p] * Math.exp(-dd * dd);
        }
        if (age < 0.5) { const young = (1 - age * 2) * 0.9; if (young > gl) gl = young; }   // frente de crecimiento
        if (gl > 0.3) { this.hot[hotN++] = i; this.glow[i] = gl; }

        const key = (b * 3 + sp) * 3 + ab;
        bucketOf[i] = key;
        counts[key]++;
      }

      let sum = 0;
      for (let k = 0; k < NKEY; k++) { offsets[k] = sum; sum += counts[k]; }
      offsets[NKEY] = sum;
      for (let k = 0; k < NKEY; k++) counts[k] = offsets[k];
      for (let i = 0; i < hi; i++) {
        const key = bucketOf[i];
        if (key >= 0) order[counts[key]++] = i;
      }

      // Pasadas: halo aditivo · cuerpo nítido · brillo especular en las venas gruesas.
      for (let b = 0; b < NB; b++) {
        const lw = Math.max(0.5, WIDTHS[b] * unit);
        for (let sp = 0; sp < 3; sp++) {
          for (let ab = 0; ab < 3; ab++) {
            const key = (b * 3 + sp) * 3 + ab;
            const s0 = offsets[key], s1 = offsets[key + 1];
            if (s1 <= s0) continue;
            ctx.beginPath();
            for (let k = s0; k < s1; k++) {
              const i = order[k];
              ctx.moveTo(sx0[i], sy0[i]);
              ctx.lineTo(sx1[i], sy1[i]);
            }
            const al = F * ALPHAS[ab];
            if (b >= 2) {
              ctx.globalCompositeOperation = "lighter";
              ctx.globalAlpha = al * 0.16;
              ctx.lineWidth = lw * 2.8;
              ctx.strokeStyle = st.halo[sp];
              ctx.stroke();
            }
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = al;
            ctx.lineWidth = lw;
            ctx.strokeStyle = st.body[sp];
            ctx.stroke();
            if (b >= 3) {
              ctx.globalAlpha = al * 0.85;
              ctx.lineWidth = lw * 0.34;
              ctx.strokeStyle = st.core[sp];
              ctx.stroke();
            }
          }
        }
      }

      // Pasada caliente: ondas de nutriente y puntas jóvenes incandescentes.
      if (hotN > 0) {
        ctx.globalCompositeOperation = "lighter";
        for (let sp = 0; sp < 3; sp++) {
          for (let lvl = 0; lvl < 2; lvl++) {
            ctx.beginPath();
            let cnt = 0;
            for (let k = 0; k < hotN; k++) {
              const i = this.hot[k];
              if (sSp[i] !== sp) continue;
              if ((this.glow[i] > 0.7 ? 1 : 0) !== lvl) continue;
              ctx.moveTo(sx0[i], sy0[i]);
              ctx.lineTo(sx1[i], sy1[i]);
              cnt++;
            }
            if (!cnt) continue;
            ctx.globalAlpha = F * (lvl ? 0.28 : 0.14);
            ctx.lineWidth = 3.4 * unit;
            ctx.strokeStyle = st.halo[sp];
            ctx.stroke();
            ctx.globalAlpha = F * (lvl ? 0.95 : 0.55);
            ctx.lineWidth = Math.max(0.9, 1.2 * unit);
            ctx.strokeStyle = st.hot[sp];
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // Nodos de interconexión: brillan con el calor del volumen.
    _drawNodes(F) {
      const ctx = this.ctx, st = this.styles, unit = this.unit;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < MAX_NODE; i++) {
        if (!this.nAct[i]) continue;
        const heat = this.nHeat[i];
        if (heat < 0.04) continue;
        const sz = (2.4 + 3.0 * heat) * unit;
        ctx.globalAlpha = F * clamp(0.2 + 0.7 * heat, 0, 0.95);
        ctx.drawImage(st.sprites[this.nSp[i]], this.nX[i] - sz, this.nY[i] - sz, sz * 2, sz * 2);
        if (heat > 0.5) {
          const z = sz * 0.38;
          ctx.globalAlpha = F * (heat - 0.3);
          ctx.drawImage(st.sprites[3], this.nX[i] - z, this.nY[i] - z, z * 2, z * 2);
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Puntas exploradoras: luz en el extremo de cada hifa en crecimiento.
    _drawTips(F) {
      const ctx = this.ctx, st = this.styles, unit = this.unit;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.tipHigh; i++) {
        if (!this.tAct[i]) continue;
        const sp = this.tSp[i];
        const hy = this.tHyper[i] > 0 ? 1 : 0;
        const sz = (sp === 0 ? 6.5 : sp === 1 ? 4.8 : 3.8) * unit * (1 + 0.8 * hy);
        ctx.globalAlpha = F * clamp(0.3 + 0.4 * Math.min(1, this.tE[i]) + 0.25 * hy, 0, 0.95);
        ctx.drawImage(st.sprites[sp], this.tx[i] - sz, this.ty[i] - sz, sz * 2, sz * 2);
        if (hy || sp === 2) {
          const z = sz * 0.4;
          ctx.globalAlpha = F * 0.7;
          ctx.drawImage(st.sprites[3], this.tx[i] - z, this.ty[i] - z, z * 2, z * 2);
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    _drawSpores(F) {
      const ctx = this.ctx, st = this.styles;
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < MAX_SPORE; i++) {
        if (!this.spAct[i]) continue;
        const u = this.spLife[i] / this.spTtl[i];
        const sz = this.spSz[i] * (1 - 0.4 * u);
        ctx.globalAlpha = F * Math.min(1, this.spLife[i] / 0.08) * Math.pow(1 - u, 0.9);
        ctx.drawImage(st.sprites[this.spSp[i]], this.spX[i] - sz, this.spY[i] - sz, sz * 2, sz * 2);
        const z = sz * 0.35;
        ctx.drawImage(st.sprites[3], this.spX[i] - z, this.spY[i] - z, z * 2, z * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  global.AuraVisualizerStyles = global.AuraVisualizerStyles || {};
  global.AuraVisualizerStyles["mycelium"] = MyceliumVisualizer;
})(window);
