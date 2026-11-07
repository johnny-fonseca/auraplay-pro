/* Efectos exclusivos del estilo Neón. Cargar después de ../shared/karaoke-core.js. */
(function (global) {
  "use strict";
  const core = global.AuraKaraokeCore;
  if (!core) throw new Error("Carga shared/karaoke-core.js antes de los módulos de estilo.");
  const { TAU, clamp, lerp, rand, easeOut, expK, rgba, rgb, mixRgb, seeded, makeCanvas, parseColor, rgbToHsl, hslToRgb, TIERS, SpectrumReader, BandAnalyzer, BarBank, BeatDetector, ParticleSystem, LyricTracker, AdaptiveQuality, K, bit } = core.helpers;
  /* ---------------------------- B. NEON (SYNTHWAVE) ---------------------------- */
  class NeonScene {
    constructor() {
      this.mask = bit(K.SPARK) | bit(K.STREAK);
      const r = seeded(7);
      this.stars = Array.from({ length: 110 }, () => ({ x: r(), y: Math.pow(r(), 1.3) * 0.9, z: 0.3 + r() * 0.7, ph: r() * TAU, sp: 0.6 + r() * 1.6, s: 0.5 + r() * 1.3 }));
      this.bank = new BarBank(48);
      this.vari = new Float32Array(48);
      this.scroll = 0;
    }
    resize(f) {
      const n = Math.round(56 * f.q.bars) + 10;
      this.bank.resize(n);
      const r = seeded(21);
      this.vari = new Float32Array(n);
      for (let i = 0; i < n; i++) this.vari[i] = 0.5 + r() * 0.5;
    }
    draw(c, f) {
      const { w, h, t, dt, bands, beat, pal, q, motion } = f;
      const cx = w / 2, hz = h * 0.68, mag = pal.a1, cyan = pal.a2, yel = pal.yellow, vio = pal.violet;
      const glow = 0.35 + bands.bass * 0.4 + beat.pulse * 0.35;
      this.bank.update(f.spec, dt, f.playing, f.synthetic, t);

      // — Floor tint (under the grid) —
      const fg = c.createLinearGradient(0, hz, 0, h);
      fg.addColorStop(0, rgba(vio, 0.12));
      fg.addColorStop(1, rgba({ r: 8, g: 0, b: 24 }, 0.6));
      c.fillStyle = fg;
      c.fillRect(0, hz, w, h - hz);

      // — Star field: parallax drift, highs make them shimmer (all stars live above the horizon) —
      c.save();
      const sc = Math.round(this.stars.length * Math.max(0.4, q.particles));
      for (let i = 0; i < sc; i++) {
        const s = this.stars[i];
        const x = (((s.x + t * 0.0006 * s.z) % 1) + 1) % 1 * w, y = s.y * hz;
        const tw = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(t * s.sp + s.ph), 2);
        c.globalAlpha = clamp(tw * (0.55 + bands.high * 0.9) * (0.5 + s.z * 0.5));
        c.fillStyle = s.z > 0.8 ? rgb(cyan) : "#e8fbff";
        const r = s.s * (0.7 + s.z * 0.5);
        c.fillRect(x - r / 2, y - r / 2, r, r);
      }
      c.restore();

      // — Sun: halo + body, both clipped to the sky so it sets *into* the horizon —
      const R = Math.min(w, h) * 0.27 * (1 + bands.bass * 0.04 + beat.pulse * 0.035), sy = hz - R * 0.28;
      c.save();
      c.beginPath(); c.rect(0, 0, w, hz); c.clip();
      c.globalCompositeOperation = "lighter";
      const halo = c.createRadialGradient(cx, sy, R * 0.8, cx, sy, R * 2.4);
      halo.addColorStop(0, rgba(mag, 0.4 + bands.bass * 0.2));
      halo.addColorStop(0.5, rgba(vio, 0.16));
      halo.addColorStop(1, rgba(vio, 0));
      c.fillStyle = halo;
      c.fillRect(0, 0, w, hz);
      c.globalCompositeOperation = "source-over";
      c.beginPath(); c.arc(cx, sy, R, 0, TAU); c.clip();
      const sg = c.createLinearGradient(0, sy - R, 0, sy + R);
      sg.addColorStop(0, rgb(yel)); sg.addColorStop(0.5, "#ff8a3d"); sg.addColorStop(1, rgb(mag));
      c.fillStyle = sg;
      // Sun stripes: solid upper body, then bands separated by gaps that widen toward the horizon
      // (gaps breathe on the beat). Only the bands are filled, so gaps stay transparent.
      c.fillRect(cx - R, sy - R, R * 2, R * 1.02);
      let y = sy + R * 0.02;
      while (y < hz && y < sy + R) {
        const u = clamp((y - sy) / R);
        const gap = R * (0.025 + 0.085 * u) * (1 + beat.pulse * 0.5), solid = R * (0.16 - 0.08 * u);
        c.fillRect(cx - R, y + gap, R * 2, solid);
        y += gap + solid;
      }
      c.restore();

      // — Spectrum skyline (silhouette + neon outline) with a faint floor reflection —
      const n = this.bank.n, bw = w / n, maxH = h * 0.2, v = this.bank.v;
      c.save();
      c.beginPath();
      for (let i = 0; i < n; i++) { const bh = maxH * (0.06 + 0.94 * v[i]) * this.vari[i]; c.rect(i * bw + 1, hz - bh, bw - 2, bh); }
      c.fillStyle = "rgba(10,2,28,.94)";
      c.fill();
      if (q.shadow) { c.shadowBlur = 8; }
      c.lineWidth = 1.2;
      for (let pass = 0; pass < 2; pass++) {
        const col = pass ? mag : cyan;
        c.strokeStyle = rgba(col, 0.85);
        c.shadowColor = rgb(col);
        c.beginPath();
        for (let i = pass; i < n; i += 2) {
          const bh = maxH * (0.06 + 0.94 * v[i]) * this.vari[i], x0 = i * bw + 1, x1 = (i + 1) * bw - 1;
          c.moveTo(x0, hz); c.lineTo(x0, hz - bh); c.lineTo(x1, hz - bh); c.lineTo(x1, hz);
        }
        c.stroke();
      }
      c.shadowBlur = 0;
      c.globalAlpha = 0.12;
      c.fillStyle = rgb(mag);
      c.beginPath();
      for (let i = 0; i < n; i++) { const bh = maxH * (0.06 + 0.94 * v[i]) * this.vari[i] * 0.45; c.rect(i * bw + 1, hz + 2, bw - 2, bh); }
      c.fill();
      c.restore();

      // — Horizon glow + line —
      c.save();
      c.globalCompositeOperation = "lighter";
      const hg = c.createLinearGradient(0, hz - 80, 0, hz + 60);
      hg.addColorStop(0, rgba(mag, 0));
      hg.addColorStop(0.55, rgba(mag, 0.45 * glow));
      hg.addColorStop(0.62, rgba(cyan, 0.3 * glow));
      hg.addColorStop(1, rgba(cyan, 0));
      c.fillStyle = hg;
      c.fillRect(0, hz - 80, w, 140);
      c.strokeStyle = rgba(cyan, 0.8);
      c.lineWidth = 1.5;
      if (q.shadow) { c.shadowBlur = 10; c.shadowColor = rgb(cyan); }
      c.beginPath(); c.moveTo(0, hz); c.lineTo(w, hz); c.stroke();
      c.restore();

      // — Perspective floor grid: converging verticals + horizontals that scroll toward the viewer —
      this.scroll += motion * dt * 0.001 * (0.5 + bands.bass * 1.4 + beat.pulse * 1.2);
      const L = 14;
      this.scroll %= L;
      c.save();
      c.globalAlpha = 0.6 + beat.pulse * 0.4;
      const M = Math.round(22 * q.bars) + 8, sx = (w * 2.2) / M;
      const vg = c.createLinearGradient(0, hz, 0, h);
      vg.addColorStop(0, rgba(mag, 0)); vg.addColorStop(1, rgba(mag, 0.55));
      c.strokeStyle = vg; c.lineWidth = 1.1;
      c.beginPath();
      for (let i = -M / 2; i <= M / 2; i++) { c.moveTo(cx, hz); c.lineTo(cx + i * sx, h); }
      c.stroke();
      const hg2 = c.createLinearGradient(0, hz, 0, h);
      hg2.addColorStop(0, rgba(cyan, 0)); hg2.addColorStop(1, rgba(cyan, 0.5));
      c.strokeStyle = hg2;
      c.beginPath();
      for (let k = 0; k < L; k++) {
        const z = ((k + this.scroll) % L) / L, yy = hz + (h - hz) * Math.pow(z, 2.4);
        c.moveTo(0, yy); c.lineTo(w, yy);
      }
      c.stroke();
      c.restore();

      // — Light pillars: tall additive beams flanking the scene, each fed by a different spectrum slice —
      c.save();
      c.globalCompositeOperation = "lighter";
      const pil = [0.08, 0.19, 0.31, 0.69, 0.81, 0.92], pw = clamp(w * 0.006, 4, 10);
      for (let k = 0; k < pil.length; k++) {
        const lvl = v[Math.min(n - 1, Math.floor((k / (pil.length - 1)) * n * 0.8))] || 0;
        const H = h * (0.18 + 0.5 * lvl), px = pil[k] * w, col = k % 2 ? mag : cyan;
        const pg = c.createLinearGradient(0, hz, 0, hz - H);
        pg.addColorStop(0, rgba(col, 0.55 * (0.4 + lvl)));
        pg.addColorStop(1, rgba(col, 0));
        c.fillStyle = pg;
        c.fillRect(px - pw / 2, hz - H, pw, H);
        c.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.5 * (0.3 + lvl));
        c.fillRect(px - 0.75, hz - H * 0.8, 1.5, H * 0.8);
      }
      c.restore();

      // — Events: sparks leap off the skyline on beats, occasional shooting star on hard hits —
      if (motion && beat.hit) {
        const ns = Math.round(6 * beat.strength * q.particles + 1);
        for (let i = 0; i < ns; i++) {
          const bi = (rand() * n) | 0, bx = bi * bw + bw / 2, by = hz - maxH * (0.06 + 0.94 * v[bi]) * this.vari[bi];
          f.particles.spawn(K.SPARK, bx, by, (rand() - 0.5) * 1.2, -(1.5 + rand() * 3), 450 + rand() * 500, 1.2 + rand() * 1.6, rand() < 0.5 ? 0 : 1, 0, 0, 1, 1);
        }
        if (beat.strength > 0.75 && bands.high > 0.28 && rand() < 0.35) {
          const a = 0.35 + rand() * 0.3, sp = 12 + rand() * 9;
          f.particles.spawn(K.STREAK, rand() * w * 0.8, rand() * hz * 0.4, Math.cos(a) * sp, Math.sin(a) * sp, 520, 1.6, rand() < 0.6 ? 1 : 2, 0, 0, 1, 1);
        }
      }
    }
  }

  core.registerScene("neon", NeonScene);
})(typeof window !== "undefined" ? window : globalThis);
