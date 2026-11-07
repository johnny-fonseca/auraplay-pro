/* Efectos exclusivos del estilo Kinético. Cargar después de ../shared/karaoke-core.js. */
(function (global) {
  "use strict";
  const core = global.AuraKaraokeCore;
  if (!core) throw new Error("Carga shared/karaoke-core.js antes de los módulos de estilo.");
  const { TAU, clamp, lerp, rand, easeOut, expK, rgba, rgb, mixRgb, seeded, makeCanvas, parseColor, rgbToHsl, hslToRgb, TIERS, SpectrumReader, BandAnalyzer, BarBank, BeatDetector, ParticleSystem, LyricTracker, AdaptiveQuality, K, bit } = core.helpers;
  /* ---------------------------- C. KINETIC (SUNBURST + RING) ---------------------------- */
  class KineticScene {
    constructor() {
      this.mask = bit(K.SPARK) | bit(K.SHARD);
      this.bank = new BarBank(72);
      this.rings = [];
      this.rot = 0;
      this.deep = null; this.deepKey = "";
      this.orbits = [
        { r: 1.38, w: 0.22, dash: [3, 12], lw: 1.2, dir: 1, flow: 34 },
        { r: 1.66, w: -0.15, dash: [18, 10], lw: 1, dir: -1, flow: 22 },
        { r: 1.96, w: 0.1, dash: [2, 9], lw: 1.4, dir: 1, flow: 16 }
      ];
    }
    resize(f) {
      this.bank.resize(Math.max(24, Math.round((72 * f.q.bars) / 2) * 2));
      this._buildDeep(f);
    }
    /** Static "deep texture": halftone dots hugging the edges + paper fibres. Rendered once per size. */
    _buildDeep(f) {
      const { w, h, dpr } = f;
      const key = w + "x" + h + "@" + dpr;
      if (key === this.deepKey) return;
      this.deepKey = key;
      const cv = makeCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
      const g = cv.getContext("2d");
      if (!g) { this.deep = null; return; }
      g.scale(dpr, dpr);
      const tile = makeCanvas(14, 14), tg = tile.getContext("2d");
      tg.fillStyle = "rgba(255,150,90,.55)";
      tg.beginPath(); tg.arc(7, 7, 1.7, 0, TAU); tg.fill();
      g.fillStyle = g.createPattern(tile, "repeat");
      g.fillRect(0, 0, w, h);
      // Fibres: short random hairlines.
      const rr = seeded(99), count = Math.min(900, Math.round((w * h) / 9000));
      g.strokeStyle = "rgba(255,220,180,.05)"; g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < count; i++) { const x = rr() * w, y = rr() * h, a = rr() * TAU, l = 6 + rr() * 16; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
      g.stroke();
      // Knock the centre out so the texture only lives at the edges.
      g.globalCompositeOperation = "destination-out";
      const kg = g.createRadialGradient(w / 2, h * 0.48, Math.min(w, h) * 0.22, w / 2, h * 0.48, Math.max(w, h) * 0.7);
      kg.addColorStop(0, "rgba(0,0,0,1)"); kg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = kg;
      g.fillRect(0, 0, w, h);
      this.deep = cv;
    }
    draw(c, f) {
      const { w, h, t, dt, bands, beat, pal, q, motion } = f;
      const cx = w / 2, cy = h * 0.47, R0 = Math.min(w, h) * 0.27, L = Math.hypot(w, h);
      this.bank.update(f.spec, dt, f.playing, f.synthetic, t);

      // — Deep texture —
      if (this.deep) { c.globalAlpha = 0.55; c.drawImage(this.deep, 0, 0, w, h); c.globalAlpha = 1; }

      // — Sunburst rays: two interleaved fans, radially faded; rotation speeds up with bass —
      this.rot += motion * dt * (0.00003 + bands.bass * 0.00012);
      c.save();
      c.translate(cx, cy); c.rotate(this.rot);
      const N = 20, ra = 0.07 + bands.bass * 0.05 + beat.pulse * 0.05;
      for (let parity = 0; parity < 2; parity++) {
        const col = parity ? pal.a2 : pal.a1;
        const g = c.createRadialGradient(0, 0, R0 * 0.6, 0, 0, L * 0.7);
        g.addColorStop(0, rgba(col, ra)); g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g;
        c.beginPath();
        for (let i = parity; i < N; i += 2) {
          const a0 = (i * TAU) / N, a1 = ((i + 1) * TAU) / N;
          c.moveTo(0, 0); c.lineTo(Math.cos(a0) * L, Math.sin(a0) * L); c.lineTo(Math.cos(a1) * L, Math.sin(a1) * L); c.closePath();
        }
        c.fill();
      }
      c.restore();

      // — Central glow —
      c.save();
      c.globalCompositeOperation = "lighter";
      const gr = R0 * 2.4, cg = c.createRadialGradient(cx, cy, 0, cx, cy, gr);
      cg.addColorStop(0, rgba(pal.a1, 0.2 + bands.bass * 0.28 + beat.pulse * 0.22));
      cg.addColorStop(1, rgba(pal.a1, 0));
      c.fillStyle = cg;
      c.fillRect(cx - gr, cy - gr, gr * 2, gr * 2);

      // — Spectrum ring: mirrored left/right so there's no seam; lows at the bottom —
      const N2 = this.bank.n, v = this.bank.v, r0 = R0 * (1 + bands.bass * 0.05 + beat.pulse * 0.07), maxLen = R0 * 0.62;
      c.lineCap = "round";
      c.lineWidth = Math.max(2, ((TAU * r0) / N2) * 0.45);
      c.strokeStyle = rgba(pal.a1, 0.92);
      if (q.shadow) { c.shadowBlur = 12; c.shadowColor = rgb(pal.a1); }
      c.beginPath();
      for (let i = 0; i < N2; i++) {
        const j = i < N2 / 2 ? i : N2 - 1 - i, a = Math.PI / 2 + (i * TAU) / N2, len = maxLen * (0.05 + 0.95 * v[j]);
        c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        c.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      }
      c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = rgba(pal.cream, 0.85); c.lineWidth = 1.4;
      c.beginPath();
      for (let i = 0; i < N2; i++) { // hot tips
        const j = i < N2 / 2 ? i : N2 - 1 - i, a = Math.PI / 2 + (i * TAU) / N2, len = maxLen * (0.05 + 0.95 * v[j]);
        c.moveTo(cx + Math.cos(a) * (r0 + len * 0.82), cy + Math.sin(a) * (r0 + len * 0.82));
        c.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      }
      c.stroke();
      c.strokeStyle = rgba(pal.cream, 0.3); c.lineWidth = 1;
      c.beginPath(); c.arc(cx, cy, r0 * 0.96, 0, TAU); c.stroke();

      // — Shock rings: one per beat, expanding and thinning out —
      if (motion && beat.hit && this.rings.length < 6) {
        this.rings.push({ age: 0, life: 900 + 300 * beat.strength, reach: R0 * 1.9 * (0.7 + beat.strength * 0.5), lw: 3 + 4 * beat.strength, amber: rand() < 0.35 });
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const rg = this.rings[i];
        rg.age += dt;
        const p = rg.age / rg.life;
        if (p >= 1) { this.rings.splice(i, 1); continue; }
        c.strokeStyle = rgba(rg.amber ? pal.a2 : pal.a1, Math.pow(1 - p, 1.6) * 0.75);
        c.lineWidth = Math.max(0.6, rg.lw * (1 - p * 0.8));
        c.beginPath(); c.arc(cx, cy, r0 + rg.reach * easeOut(p), 0, TAU); c.stroke();
      }

      // — Dashed orbits with satellites (dash flow + satellite angle follow the animation clock) —
      for (let i = 0; i < this.orbits.length; i++) {
        const o = this.orbits[i], rr = R0 * o.r * (1 + bands.mid * 0.03);
        c.setLineDash(o.dash);
        c.lineDashOffset = -t * o.dir * o.flow;
        c.lineWidth = o.lw;
        c.strokeStyle = rgba(pal.cream, 0.22 + bands.high * 0.1);
        c.beginPath(); c.arc(cx, cy, rr, 0, TAU); c.stroke();
        c.setLineDash([]);
        const a = t * o.w + i * 2.1, sr = 2.5 + bands.high * 3;
        c.fillStyle = rgba(pal.cream, 0.9);
        c.beginPath(); c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, sr, 0, TAU); c.fill();
      }
      c.restore();

      // — Beat events: radial sparks from the ring, sharp shards on strong hits —
      if (motion && beat.hit) {
        const ns = Math.round((8 + 26 * beat.strength) * q.particles);
        for (let i = 0; i < ns; i++) {
          const a = rand() * TAU, sp = 2.5 + rand() * 6.5 * (0.6 + beat.strength);
          f.particles.spawn(K.SPARK, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, Math.cos(a) * sp, Math.sin(a) * sp, 500 + rand() * 600, 1.2 + rand() * 2.2, (rand() * 4) | 0, 0, 0, 1, 1);
        }
        if (beat.strength > 0.72) {
          const nsh = Math.round((3 + 4 * beat.strength) * q.particles);
          for (let i = 0; i < nsh; i++) {
            const a = rand() * TAU, sp = 3 + rand() * 4;
            f.particles.spawn(K.SHARD, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, Math.cos(a) * sp, Math.sin(a) * sp, 900 + rand() * 500, 6 + rand() * 10, (rand() * 3) | 0, a, (rand() - 0.5) * 0.4, 1, 0.95);
          }
        }
      }
    }
  }

  core.registerScene("kinetic", KineticScene);
})(typeof window !== "undefined" ? window : globalThis);
