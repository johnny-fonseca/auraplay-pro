/* visualizers/particles.js — Nebulosa de partículas (vórtice, constelaciones y estallidos con el beat)
 *
 * Archivo TOTALMENTE independiente: no necesita ningún otro script.
 * Incluye su propio motor (canvas, análisis de audio, paleta de la portada)
 * y el dibujado de este estilo.
 *
 * Uso:
 *   const viz = new AuraVisualizerStyles.particles(canvas, audioGraph);
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

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);

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
      this.style = "particles";
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
      this.sprites = null;
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
        nebula: { parts: [], acc: 0, sweep: 0 }
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
      this._drawNebula(f);
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
      this.sprites = null;
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

    /* ───────────────────────── utilidades de dibujo ───────────────────────── */

    _buildSprites() {
      const make = (inner, mid, outer) => {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 64;
        const g = c.getContext("2d");
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, inner); gr.addColorStop(0.22, mid); gr.addColorStop(1, outer);
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        return c;
      };
      this.sprites = [0, 1, 2].map((i) => make(this._c(i, 18, 1), this._c(i, 0, 0.4), this._c(i, 0, 0)));
      this.sprites.push(make("rgba(255,255,255,1)", "rgba(255,255,255,.35)", "rgba(255,255,255,0)"));
    }

    /* ═════════════════════════════════════════════════════════════
     * 4) NEBULOSA DE PARTÍCULAS (particles)
     * Vórtice de estrellas que nace de la portada, hilos de constelación,
     * estallidos con el beat y un emisor luminoso giratorio.
     * ═════════════════════════════════════════════════════════════ */
    _drawNebula(f) {
      const ctx = this.ctx, a = this.a, s = this.fx.nebula;
      const { cx, cy, base, max } = f.g;
      if (!this.sprites) this._buildSprites();
      const spr = this.sprites;
      s.sweep += f.dt * (1.1 + a.energy * 2.4);
      s.acc += f.dt * (10 + a.energy * 190 + a.highs * 140);

      const spawn = (th, burst) => {
        s.parts.push({
          th, r: base + rand(2, 10),
          vr: burst ? rand(70, 190) + a.bass * 120 : rand(14, 46) + a.energy * 70,
          vth: rand(0.12, 0.5) + a.mids * 0.5,
          life: 0, ttl: rand(1.5, 3.2),
          size: rand(0.7, 2.2) * (burst ? 1.35 : 1),
          c: (Math.random() * 3) | 0, x: cx, y: cy
        });
      };
      if (a.beat) for (let i = 0; i < 34; i++) if (s.parts.length < 520) spawn(rand(0, TAU), true);
      let guard = 0;
      while (s.acc >= 1 && guard++ < 40) {
        s.acc -= 1;
        if (s.parts.length < 460) spawn(s.sweep + rand(-0.7, 0.7), false);
      }
      if (guard >= 40) s.acc = 0;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Emisores luminosos
      const eR = base + 6, eS = 50 + a.bass * 50;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(spr[0], cx + Math.cos(s.sweep) * eR - eS, cy + Math.sin(s.sweep) * eR - eS, eS * 2, eS * 2);
      ctx.globalAlpha = 0.32;
      ctx.drawImage(spr[1], cx + Math.cos(s.sweep + Math.PI) * eR - eS * 0.8, cy + Math.sin(s.sweep + Math.PI) * eR - eS * 0.8, eS * 1.6, eS * 1.6);

      // Actualización + dibujo (compactando en una sola pasada)
      const ps = s.parts;
      let w = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life += f.dt;
        if (p.life >= p.ttl) continue;
        p.r += p.vr * f.dt;
        p.vr *= 1 - f.dt * 0.35;
        p.th += p.vth * f.dt * (base / p.r);
        if (p.r > max * 1.04) continue;
        p.x = cx + Math.cos(p.th) * p.r;
        p.y = cy + Math.sin(p.th) * p.r;
        ps[w++] = p;
        const u = p.life / p.ttl;
        const al = Math.min(1, p.life / 0.18) * Math.pow(1 - u, 0.8);
        const sz = p.size * 5.2 * (1 - 0.35 * u);
        ctx.globalAlpha = al * 0.9;
        ctx.drawImage(spr[p.c], p.x - sz, p.y - sz, sz * 2, sz * 2);
        if (p.size > 1.8) {
          const z = sz * 0.45;
          ctx.globalAlpha = al * 0.8;
          ctx.drawImage(spr[3], p.x - z, p.y - z, z * 2, z * 2);
        }
        if (p.vr > 55) {
          const tr = p.vr * 0.05;
          ctx.globalAlpha = al * 0.5;
          ctx.strokeStyle = this._c(p.c, 16);
          ctx.lineWidth = p.size * 0.8;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(p.th) * (p.r - tr), cy + Math.sin(p.th) * (p.r - tr));
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      }
      ps.length = w;

      // Hilos de constelación entre partículas vecinas
      ctx.beginPath();
      for (let j = 0; j < ps.length - 1; j++) {
        const A = ps[j], B = ps[j + 1];
        const dx = A.x - B.x, dy = A.y - B.y;
        if (dx * dx + dy * dy < 2025) { ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); }
      }
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = this._c(1, 14);
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  global.AuraVisualizerStyles = global.AuraVisualizerStyles || {};
  global.AuraVisualizerStyles.particles = Visualizer;
})(window);
