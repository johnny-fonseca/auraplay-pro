/* Efectos exclusivos del estilo Cinema. Cargar después de ../shared/karaoke-core.js. */
(function (global) {
  "use strict";
  const core = global.AuraKaraokeCore;
  if (!core) throw new Error("Carga shared/karaoke-core.js antes de los módulos de estilo.");
  const { TAU, clamp, lerp, rand, easeOut, expK, rgba, rgb, mixRgb, seeded, makeCanvas, parseColor, rgbToHsl, hslToRgb, TIERS, SpectrumReader, BandAnalyzer, BarBank, BeatDetector, ParticleSystem, LyricTracker, AdaptiveQuality, K, bit } = core.helpers;
  /** Quadratic-smoothed polyline helpers used by the aurora ribbons. */
  function pathForward(c, X, Y, n) {
    c.moveTo(X[0], Y[0]);
    for (let i = 1; i < n; i++) c.quadraticCurveTo(X[i], Y[i], (X[i] + X[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2);
    c.lineTo(X[n], Y[n]);
  }
  function pathBackward(c, X, Y, n) {
    c.lineTo(X[n], Y[n]);
    for (let i = n - 1; i >= 1; i--) c.quadraticCurveTo(X[i], Y[i], (X[i] + X[i - 1]) / 2, (Y[i] + Y[i - 1]) / 2);
    c.lineTo(X[0], Y[0]);
  }

  /* ---------------------------- A. CINEMA (AURORA) ---------------------------- */
  class CinemaScene {
    constructor() {
      this.mask = bit(K.DUST) | bit(K.SPARK);
      this.ribbons = [
        { y: 0.2, amp: 0.07, th: 0.2, sp: [0.11, 0.07, 0.19], ph: 0.0, c: 0, a: 0.9 },
        { y: 0.3, amp: 0.09, th: 0.24, sp: [0.08, 0.13, 0.05], ph: 2.1, c: 1, a: 0.8 },
        { y: 0.12, amp: 0.05, th: 0.16, sp: [0.14, 0.09, 0.12], ph: 4.2, c: 2, a: 0.6 }
      ];
      this.X = new Float32Array(64); this.T = new Float32Array(64); this.B = new Float32Array(64);
    }
    resize() {}
    draw(c, f) {
      const { w, h, t, bands, beat, pal, q } = f;
      c.globalCompositeOperation = "lighter";

      // 1 — Aurora glow: three drifting radial layers (the soft "sky" behind everything).
      for (let i = 0; i < 3; i++) {
        const col = pal.c[i % pal.c.length];
        const x = w * (0.5 + 0.34 * Math.sin(t * 0.09 + i * 2.3));
        const y = h * (0.3 + 0.12 * Math.cos(t * 0.07 + i * 1.9));
        const r = Math.max(w, h) * (0.4 + 0.04 * Math.sin(t * 0.13 + i) + bands.bass * 0.06);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(col, 0.15 + bands.mid * 0.12 + beat.pulse * 0.05));
        g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }

      // 2 — Flowing ribbons (curtains): bright lower edge, fade upward.
      const n = Math.min(60, Math.max(10, Math.round(36 * q.ribbons)));
      for (let k = 0; k < this.ribbons.length; k++) this._ribbon(c, f, this.ribbons[k], n);

      // 3 — Light flare: anamorphic streak + core + ghost orbs along the axis through centre.
      const fx = w * (0.18 + 0.64 * (0.5 + 0.5 * Math.sin(t * 0.05))), fy = h * 0.16;
      const I = 0.1 + beat.pulse * 0.22 + bands.high * 0.08;
      const warm = pal.warm;
      c.save();
      c.translate(fx, fy);
      c.scale(1, 0.045);
      const sg = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.3);
      sg.addColorStop(0, rgba(warm, I));
      sg.addColorStop(1, rgba(warm, 0));
      c.fillStyle = sg;
      c.fillRect(-w * 0.3, -w * 0.3, w * 0.6, w * 0.6);
      c.restore();
      const cg = c.createRadialGradient(fx, fy, 0, fx, fy, w * 0.05);
      cg.addColorStop(0, rgba(warm, I * 1.2));
      cg.addColorStop(1, rgba(warm, 0));
      c.fillStyle = cg;
      c.fillRect(fx - w * 0.05, fy - w * 0.05, w * 0.1, w * 0.1);
      for (let k = 1; k <= 3; k++) {
        const gx = fx + (w / 2 - fx) * k * 0.7, gy = fy + (h / 2 - fy) * k * 0.7, gr = 14 + k * 12;
        const gg = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
        gg.addColorStop(0, rgba(pal.c[k % pal.c.length], 0.05 * (1 + beat.pulse)));
        gg.addColorStop(1, rgba(pal.c[k % pal.c.length], 0));
        c.fillStyle = gg;
        c.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      }

      // 4 — Organic light leaks: overlapping, slowly breathing blobs hugging two corners.
      const leaks = [{ x: 0, y: 0.1, col: warm, ph: 0 }, { x: 1, y: 0.92, col: pal.a2, ph: 2.4 }];
      for (let l = 0; l < leaks.length; l++) {
        const L = leaks[l], breathe = 0.5 + 0.5 * Math.sin(t * 0.16 + L.ph);
        for (let j = 0; j < 3; j++) {
          const lx = L.x * w + Math.cos(t * 0.05 + j * 2.1 + L.ph) * w * 0.04;
          const ly = L.y * h + Math.sin(t * 0.06 + j * 1.3 + L.ph) * h * 0.05;
          const lr = Math.max(w, h) * (0.26 + j * 0.1);
          const lg = c.createRadialGradient(lx, ly, 0, lx, ly, lr);
          lg.addColorStop(0, rgba(L.col, (0.1 - j * 0.025) * (0.4 + breathe * 0.6) * (1 + beat.pulse * 0.5)));
          lg.addColorStop(1, rgba(L.col, 0));
          c.fillStyle = lg;
          c.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
        }
      }

      // 5 — Dust motes (parallax, twinkle) + glints that ride the lyric sweep.
      if (f.motion) f.particles.ensureDust(Math.round(70 * q.particles), w, h, [2, 3]);
    }
    _ribbon(c, f, rb, n) {
      const { w, h, t, bands, beat, pal } = f;
      const X = this.X, T = this.T, B = this.B;
      const col = pal.c[rb.c % pal.c.length], col2 = pal.c[(rb.c + 1) % pal.c.length];
      const base = h * rb.y, amp = h * rb.amp * (1 + bands.mid * 1.1), th = h * rb.th * (0.8 + bands.bass * 0.35 + beat.pulse * 0.15);
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * w, k = (x / w) * TAU;
        const wave = Math.sin(k * 1.3 + t * rb.sp[0] * TAU * 0.5 + rb.ph) * 0.55 +
                     Math.sin(k * 2.9 - t * rb.sp[1] * TAU * 0.5 + rb.ph * 1.7) * 0.3 +
                     Math.sin(k * 5.7 + t * rb.sp[2] * TAU * 0.5) * 0.15;
        const y = base + wave * amp, thick = th * (0.65 + 0.35 * Math.sin(k * 1.7 + t * 0.15 + rb.ph));
        X[i] = x; T[i] = y; B[i] = y + thick;
      }
      c.beginPath();
      pathForward(c, X, T, n);
      pathBackward(c, X, B, n);
      c.closePath();
      const g = c.createLinearGradient(0, base - amp, 0, base + amp + th);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.55, rgba(col, 0.1 * rb.a + beat.pulse * 0.04));
      g.addColorStop(0.86, rgba(col2, 0.22 * rb.a + bands.bass * 0.06));
      g.addColorStop(1, rgba(col2, 0));
      c.fillStyle = g;
      c.fill();
    }
  }

  core.registerScene("cinema", CinemaScene);
})(typeof window !== "undefined" ? window : globalThis);
