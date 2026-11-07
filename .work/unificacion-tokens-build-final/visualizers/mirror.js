/* visualizers/mirror.js — Mandala caleidoscopio (pétalos simétricos multicapa)
 *
 * Archivo TOTALMENTE independiente: no necesita ningún otro script.
 * Incluye su propio motor (canvas, análisis de audio, paleta de la portada)
 * y el dibujado de este estilo.
 *
 * Uso:
 *   const viz = new AuraVisualizerStyles.mirror(canvas, audioGraph);
 *   viz.start();               // inicia el bucle (con fundido de entrada)
 *   viz.stop();                // fundido de salida  ·  stop(true) = inmediato
 *   viz.setSensitivity(0.7);   // 0.4 – 1.2
 *   viz.destroy();             // libera observadores
 *
 * audioGraph debe exponer getDataArray() (espectro 0-255) y getTimeDomain().
 * Opcionales en el DOM: #artFrame (marco de la portada) y #artImg (imagen).
 */
(function (global) {
  "use strict";

  const TAU = Math.PI * 2;
  // Sensibilidad base del visualizador; rango útil aproximado: 0.4–1.2.
  const SENSITIVITY = 0.7;
  // Paleta por defecto [h, s%, l%] cuando no hay portada.
  const DEFAULT_PALETTE = [[190, 100, 66], [258, 100, 74], [340, 100, 70]];
  const MANDALA_LAYERS = [
    { K: 12, sc: 1.0, dir: 1, sp: 0.10, off: 0.0 },
    { K: 8, sc: 0.7, dir: -1, sp: 0.16, off: 0.2 },
    { K: 16, sc: 0.46, dir: 1, sp: 0.24, off: 0.1 }
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

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

  class Visualizer {
    constructor(canvas, audioGraph) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });
      this.graph = audioGraph;
      this.style = "mirror";
      this.sensitivity = SENSITIVITY;
      this.running = false;
      this.raf = null;
      this.fadeLevel = 1;
      this.fadeTarget = 1;
      this.w = 0;
      this.h = 0;
      this.smooth = new Float32Array(1024);
      this.palette = DEFAULT_PALETTE.map((c) => c.slice());
      this.coverKey = "";
      this.lastFrame = 0;
      this._errorLogged = false;
      this.a = { bass: 0, mids: 0, highs: 0, energy: 0, bassAvg: 0, beat: false, pulse: 0, lastBeat: 0, flow: 0 };
      this._resetState();
      this._resize = this._resize.bind(this);
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
      this.fadeTarget = 1;
      if (this.running) return;
      this._resize();
      this.running = true;
      this.lastFrame = 0;
      const loop = () => {
        if (!this.running) return;
        try {
          this._draw();
        } catch (err) {
          if (!this._errorLogged) { this._errorLogged = true; console.error("[Visualizer]", err); }
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop(immediate = false) {
      if (immediate) {
        this.fadeTarget = 0;
        this.fadeLevel = 0;
        this.running = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        this.clear();
        return;
      }

      // Keep one short render loop alive so the current style fades naturally
      // instead of vanishing the instant the audio is paused.
      this.fadeTarget = 0;
      if (this.running) return;
      this._resize();
      this.running = true;
      this.lastFrame = 0;
      const loop = () => {
        if (!this.running) return;
        try {
          this._draw();
        } catch (err) {
          if (!this._errorLogged) { this._errorLogged = true; console.error("[Visualizer]", err); }
        }
        if (this.fadeLevel <= 0.005 && this.fadeTarget === 0) {
          this.fadeLevel = 0;
          this.running = false;
          this.raf = null;
          this.clear();
          return;
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    clear() {
      if (this.ctx) this.ctx.clearRect(0, 0, this.w || 0, this.h || 0);
    }

    // Libera observadores y detiene el bucle (úsalo antes de descartar la instancia).
    destroy() {
      this.stop(true);
      if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
      window.removeEventListener("resize", this._resize);
    }

    /* ───────────────────────── estado ───────────────────────── */

    _resetState() {
      const a = this.a;
      a.bassAvg = 0; a.pulse = 0; a.lastBeat = 0; a.beat = false;
      this.fx = {
        mandala: { layers: [new Float32Array(41), new Float32Array(41), new Float32Array(41)], rot: [0, 0, 0] }
      };
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0;
      this.h = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;
    }

    /* ───────────────────────── bucle principal ───────────────────────── */

    _draw() {
      const data = this.graph && this.graph.getDataArray();
      const time = this.graph && this.graph.getTimeDomain();
      if (!data) { this.clear(); return; }
      const g = this._geometry();
      if (!g) { this.clear(); return; }
      this.clear();
      const now = performance.now();
      const dt = clamp((now - (this.lastFrame || now)) / 1000, 0.001, 0.05);
      this.lastFrame = now;
      const usable = Math.min(data.length, this.smooth.length);
      for (let i = 0; i < usable; i++) {
        const target = data[i] / 255;
        this.smooth[i] += (target - this.smooth[i]) * (target > this.smooth[i] ? 0.8 : 0.38);
      }
      this._syncCover();
      this._analyze(data, now, dt);
      const f = { now, dt, g, data, time };
      // Exponential easing feels more organic than an abrupt linear cutoff.
      const fadeRate = this.fadeTarget > this.fadeLevel ? 8 : 5;
      this.fadeLevel += (this.fadeTarget - this.fadeLevel) * (1 - Math.exp(-fadeRate * dt));
      this.ctx.save();
      this.ctx.globalAlpha = this.fadeLevel;
      this._drawMandala(f);
      this.ctx.restore();
    }

    _geometry() {
      const canvasRect = this.canvas.getBoundingClientRect();
      const cover = document.getElementById("artFrame");
      const coverRect = cover && cover.getBoundingClientRect();
      const cx = coverRect ? coverRect.left + coverRect.width / 2 - canvasRect.left : this.w / 2;
      const cy = coverRect ? coverRect.top + coverRect.height / 2 - canvasRect.top : this.h / 2;
      // offsetWidth/Height no cambia con la animación CSS de giro de la portada.
      const coverWidth = cover ? cover.offsetWidth : 0;
      const coverHeight = cover ? cover.offsetHeight : 0;
      const base = cover ? Math.min(coverWidth, coverHeight) / 2 : Math.min(this.w, this.h) * 0.385;
      const max = Math.max(Math.min(this.w, this.h) * 0.49, base + 24);
      if (![cx, cy, base, max, this.w, this.h].every(Number.isFinite) || this.w <= 0 || this.h <= 0 || base <= 0 || max <= 0) {
        return null;
      }
      return { cx, cy, base, max };
    }

    _sample(data, index, count = 96) {
      const position = Math.max(0, Math.min(1, index / Math.max(1, count - 1)));
      const maxBin = Math.min(data.length - 1, this.smooth.length - 1);
      // Reparte los puntos en escala logarítmica y cubre también todo el rango agudo.
      const bin = Math.max(1, Math.round(Math.exp(Math.log(Math.max(1, maxBin)) * position)));
      const level = this.smooth[Math.min(bin, this.smooth.length - 1)] || 0;
      // Compresión perceptual más un realce gráfico específico para extremos del espectro.
      const shaped = Math.pow(level, 1.35);
      const bassBoost = Math.max(0, 1 - position / 0.4) * 0.55;
      const trebleBoost = Math.max(0, (position - 0.7) / 0.3) * 0.7;
      const x = shaped * this.sensitivity * (1.0 + bassBoost + trebleBoost);
      return Math.max(0, Math.min(1, x / (1 + 0.45 * x)));
    }

    // Análisis compartido: bandas, detección de beat y fase de movimiento.
    _analyze(data, now, dt) {
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
      a.pulse *= Math.exp(-dt * 4.5);
      const k = 1 - Math.exp(-dt * 18);
      a.bass += (bass - a.bass) * k;
      a.mids += (mids - a.mids) * k;
      a.highs += (highs - a.highs) * k;
      a.energy += (energy - a.energy) * k;
      a.flow += dt * (0.3 + a.energy * 1.8);
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
    }

    _extractCoverColors(image, key) {
      const fallback = () => { this.palette = DEFAULT_PALETTE.map((c) => c.slice()); };
      if (!image || key === "default" || !image.complete || !image.naturalWidth) { fallback(); return; }
      try {
        const size = 28;
        const sample = document.createElement("canvas");
        sample.width = size; sample.height = size;
        const sctx = sample.getContext("2d", { willReadFrequently: true });
        sctx.drawImage(image, 0, 0, size, size);
        const px = sctx.getImageData(0, 0, size, size).data;
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
        // Normaliza a tonos neón legibles sobre fondo oscuro.
        this.palette = picks.map((c) => [Math.round(c[0]), Math.round(clamp(c[1] * 100, 72, 100)), Math.round(clamp(c[2] * 100, 60, 74))]);
      } catch (_) { fallback(); }
    }

    // Color de paleta i (cíclico) con ajuste de luminosidad y alfa.
    _c(i, dl = 0, alpha = 1) {
      const p = this.palette[((i % 3) + 3) % 3];
      return `hsla(${p[0]},${p[1]}%,${clamp(p[2] + dl, 8, 96)}%,${alpha})`;
    }

    // Color interpolado a lo largo de la paleta (t cíclico 0..1).
    _pal(t, dl = 0, alpha = 1) {
      t = ((t % 1) + 1) % 1;
      const f = t * 3, i = Math.floor(f) % 3, u = f - Math.floor(f);
      const A = this.palette[i], B = this.palette[(i + 1) % 3];
      const dh = ((B[0] - A[0] + 540) % 360) - 180;
      const h = (A[0] + dh * u + 360) % 360;
      return `hsla(${h.toFixed(1)},${lerp(A[1], B[1], u).toFixed(0)}%,${clamp(lerp(A[2], B[2], u) + dl, 8, 96).toFixed(0)}%,${alpha})`;
    }

    /* ═════════════════════════════════════════════════════════════
     * 6) MANDALA CALEIDOSCOPIO (mirror)
     * Tres capas de pétalos simétricos con distinto número de segmentos,
     * giro contrapuesto y degradados de la paleta de la portada.
     * ═════════════════════════════════════════════════════════════ */
    _drawMandala(f) {
      const ctx = this.ctx, a = this.a, s = this.fx.mandala, data = f.data;
      const { cx, cy, base, max } = f.g;
      const rin = base + 5;
      const spanMax = Math.max(14, max - rin - 4);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round";

      for (let L = 0; L < 3; L++) {
        const c = MANDALA_LAYERS[L], arr = s.layers[L], M = arr.length - 1, wedge = TAU / c.K;
        const reach = spanMax * c.sc;
        s.rot[L] += f.dt * c.sp * c.dir * (0.4 + a.energy * 2.2 + a.pulse * 1.2);

        const outer = new Path2D(), vein = new Path2D();
        for (let j = 0; j <= M; j++) {
          const t = Math.abs((2 * j) / M - 1);
          const q = clamp(t * (0.62 + L * 0.18) + L * 0.05, 0, 1);
          arr[j] += (this._sample(data, q * 95, 96) - arr[j]) * 0.5;
          const env = 0.3 + 0.7 * Math.pow(Math.sin((Math.PI * j) / M), 0.8);
          const r = rin + reach * (0.08 + 0.92 * arr[j]) * env + a.pulse * 4 * c.sc;
          const phi = (j / M) * wedge;
          if (j === 0) outer.moveTo(Math.cos(phi) * r, Math.sin(phi) * r);
          else outer.lineTo(Math.cos(phi) * r, Math.sin(phi) * r);
        }
        const tipR = rin + reach * (0.08 + 0.92 * arr[M >> 1]) + a.pulse * 4 * c.sc;
        vein.moveTo(Math.cos(wedge / 2) * rin, Math.sin(wedge / 2) * rin);
        vein.lineTo(Math.cos(wedge / 2) * tipR, Math.sin(wedge / 2) * tipR);
        const fillP = new Path2D(outer);
        fillP.arc(0, 0, rin, wedge, 0, true);
        fillP.closePath();

        const g = ctx.createRadialGradient(0, 0, rin, 0, 0, rin + reach + 6);
        g.addColorStop(0, this._c(L, 0, 0));
        g.addColorStop(0.4, this._c(L, 4, 0.34));
        g.addColorStop(1, this._c(L + 1, 8, 0.12));

        for (let k = 0; k < c.K; k++) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(s.rot[L] + k * wedge + c.off);
          ctx.fillStyle = g;
          ctx.globalAlpha = 0.6 + L * 0.1;
          ctx.fill(fillP);
          ctx.strokeStyle = this._pal(k / c.K + L * 0.2, 12);
          ctx.globalAlpha = 0.12; ctx.lineWidth = 3.5; ctx.stroke(outer);
          ctx.globalAlpha = 0.85; ctx.lineWidth = 1.1; ctx.stroke(outer);
          ctx.globalAlpha = 0.3; ctx.lineWidth = 0.7; ctx.stroke(vein);
          ctx.restore();
        }
      }

      // Anillo de puntos giratorio
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([1.2, 7]);
      ctx.lineDashOffset = -a.flow * 30;
      ctx.strokeStyle = this._c(0, 18);
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, rin + spanMax * 0.04, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  global.AuraVisualizerStyles = global.AuraVisualizerStyles || {};
  global.AuraVisualizerStyles.mirror = Visualizer;
})(window);
