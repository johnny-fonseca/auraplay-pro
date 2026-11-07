/* ============================================================================
   karaoke-fx.js — motor de efectos del overlay de karaoke
   ----------------------------------------------------------------------------
   Drop-in replacement for karaokeFx.js. Public contract is unchanged:

       const fx = new window.AuraKaraokeFx(canvasEl, overlayEl);
       fx.update(style, graph, isPlaying, prefersReducedMotion);   // every frame

   so player.js needs no edits. Rename the <script src> to karaoke-fx.js.

   Modules (all private to this IIFE, also exposed on AuraKaraokeFx.parts):
     1. Utils            math, colour parsing, seeded RNG
     2. SpectrumReader   defensive analyser access, normalises to Float32 0..1
     3. BandAnalyzer     bass / mid / high mapping, AGC, attack/release smoothing
     4. BarBank          log-spaced bars (skyline, spectrum ring), smoothed
     5. BeatDetector     combined-energy onset detector -> pulse + hit events
     6. ParticleSystem   pooled sparks / dust / shards / streaks (typed arrays)
     7. LyricTracker     DOM-side state: past/far classes, --dist/--abs/--depth,
                         per-word data-state, live sweep position
     8. AdaptiveQuality  4 quality tiers, frame-time driven, hysteresis
     9. Scenes           CinemaScene (aurora), NeonScene (synthwave),
                         KineticScene (sunburst + spectrum ring)
    10. KaraokeFx        controller / frame loop

   Rendering is one canvas, zero DOM nodes per frame. The engine runs in lock-
   step with player.js (update() renders synchronously) and falls back to its
   own rAF loop while paused, so visuals decay gracefully instead of freezing.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ======================================================================
     1. UTILS
     ==================================================================== */
  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = Math.random;
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  /** Frame-rate independent one-pole coefficient for time constant `tau` (ms). */
  const expK = (dt, tau) => 1 - Math.exp(-dt / Math.max(1, tau));

  const rgba = (c, a) =>
    "rgba(" + (c.r | 0) + "," + (c.g | 0) + "," + (c.b | 0) + "," + Math.round(clamp(a) * 1000) / 1000 + ")";
  const rgb = (c) => "rgb(" + (c.r | 0) + "," + (c.g | 0) + "," + (c.b | 0) + ")";
  const mixRgb = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });

  /** Parses #rgb, #rrggbb, rgb() and rgba(). Returns null for anything else. */
  function parseColor(str) {
    if (!str) return null;
    str = String(str).trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.replace(/./g, (ch) => ch + ch);
      const n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(str);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }
  function rgbToHsl(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s, l };
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  /** Small deterministic PRNG so static layouts (stars, skyline) never reshuffle. */
  function seeded(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Offscreen canvas that works with or without OffscreenCanvas. */
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  /* ======================================================================
     Quality tiers — index 0 is the richest. See AdaptiveQuality.
     particles/ribbons/bars are multipliers; cull = lyric lines kept visible
     either side of the current line.
     ==================================================================== */
  const TIERS = [
    { name: "high",    dpr: 2,    fps: 60, particles: 1,   ribbons: 1,    bars: 1,   shadow: true,  cull: 7 },
    { name: "medium",  dpr: 1.5,  fps: 60, particles: 0.65, ribbons: 0.75, bars: 0.75, shadow: true,  cull: 6 },
    { name: "low",     dpr: 1.25, fps: 48, particles: 0.35, ribbons: 0.5,  bars: 0.55, shadow: false, cull: 5 },
    { name: "minimal", dpr: 1,    fps: 30, particles: 0.15, ribbons: 0.35, bars: 0.4,  shadow: false, cull: 4 }
  ];

  /* ======================================================================
     2. SPECTRUM READER — never throws, never returns garbage
     ----------------------------------------------------------------------
     Accepts whatever the audio graph offers:
       • graph.getDataArray()  (what player.js' AuraAudioGraph exposes)
       • graph.analyser / analyserNode with getByteFrequencyData()
     Handles Uint8 (0..255), Float32 in 0..1, and Float32 in dB (negative).
     Returns { bins:Float32Array 0..1, sampleRate, silent } or null.
     ==================================================================== */
  class SpectrumReader {
    constructor() {
      this.bins = null;
      this.scratch = null;
      this.sampleRate = 44100;
      this.errors = 0;
      this.muteUntil = 0;
      this.result = { bins: null, sampleRate: 44100, silent: true };
    }
    read(graph, now) {
      if (!graph || now < this.muteUntil) return null;
      let raw = null;
      try {
        if (typeof graph.getDataArray === "function") raw = graph.getDataArray();
        const analyser = graph.analyser || graph.analyserNode || null;
        if ((!raw || !raw.length) && analyser && typeof analyser.getByteFrequencyData === "function") {
          const n = analyser.frequencyBinCount | 0;
          if (n > 0) {
            if (!this.scratch || this.scratch.length !== n) this.scratch = new Uint8Array(n);
            analyser.getByteFrequencyData(this.scratch);
            raw = this.scratch;
          }
        }
        const actx = graph.audioContext || graph.ctx || graph.context || (analyser && analyser.context);
        if (actx && actx.sampleRate > 0) this.sampleRate = actx.sampleRate;
        this.errors = 0;
      } catch (_) {
        // A misbehaving graph must never break lyrics: back off for 2 s after repeated faults.
        if (++this.errors > 5) { this.muteUntil = now + 2000; this.errors = 0; }
        return null;
      }
      if (!raw || typeof raw.length !== "number" || raw.length < 4) return null;

      const n = raw.length;
      if (!this.bins || this.bins.length !== n) this.bins = new Float32Array(n);
      const out = this.bins;
      const isFloat = raw instanceof Float32Array || raw instanceof Float64Array;
      let mode = 255; // divisor, or "db"
      if (isFloat) {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < n; i++) { const v = raw[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        mode = mn < 0 ? "db" : mx > 1.001 ? 255 : 1;
      }
      let sum = 0;
      for (let i = 0; i < n; i++) {
        let v = +raw[i];
        if (!isFinite(v)) v = mode === "db" ? -100 : 0;
        v = mode === "db" ? (v + 100) / 70 : v / mode;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        out[i] = v;
        sum += v;
      }
      const r = this.result;
      r.bins = out;
      r.sampleRate = this.sampleRate;
      r.silent = sum < n * 0.002;
      return r;
    }
  }

  /* ======================================================================
     3. BAND ANALYZER — bass / mid / high with AGC + attack/release
     ----------------------------------------------------------------------
     Bin ranges come from real frequencies (needs sampleRate), so the result
     doesn't depend on fftSize. Each band is normalised against its own slowly
     decaying peak (AGC) so quiet masters still move the visuals.
       slow levels  -> backgrounds, glow, ring size   (release ~250 ms)
       fast levels  -> beat detector                   (release ~90 ms)
     ==================================================================== */
  class BandAnalyzer {
    constructor() {
      this.bass = 0; this.mid = 0; this.high = 0;
      this.bassFast = 0; this.midFast = 0; this.highFast = 0;
      this.peak = { bass: 0.3, mid: 0.3, high: 0.3 };
      this._key = "";
      this._r = null;
    }
    _ranges(n, sr) {
      const key = n + ":" + sr;
      if (key === this._key) return this._r;
      const nyq = sr / 2;
      const idx = (f) => clamp(Math.round((f / nyq) * n), 0, n - 1);
      const b0 = Math.max(1, idx(30)), b1 = Math.max(b0 + 1, idx(150) + 1);
      const m1 = Math.max(b1 + 1, idx(2200) + 1);
      const h1 = Math.min(n, Math.max(m1 + 1, idx(12000) + 1));
      this._key = key;
      this._r = { bass: [b0, Math.min(b1, n)], mid: [Math.min(b1, n - 1), Math.min(m1, n)], high: [Math.min(m1, n - 1), h1] };
      return this._r;
    }
    _avg(bins, r) {
      let sum = 0, mx = 0;
      const lo = r[0], hi = Math.max(lo + 1, r[1]);
      for (let i = lo; i < hi; i++) { const v = bins[i] || 0; sum += v; if (v > mx) mx = v; }
      return (sum / (hi - lo)) * 0.6 + mx * 0.4;
    }
    _agc(name, v, dt) {
      const pk = Math.max(v, this.peak[name] * Math.exp(-dt / 7000), 0.12);
      this.peak[name] = pk;
      return Math.pow(clamp(v / pk), 1.15);
    }
    update(spec, dt, playing, synthetic, t) {
      let rb = 0, rm = 0, rh = 0;
      if (playing && spec && spec.bins && !synthetic) {
        const r = this._ranges(spec.bins.length, spec.sampleRate);
        rb = this._avg(spec.bins, r.bass);
        rm = this._avg(spec.bins, r.mid) * 1.12;
        rh = this._avg(spec.bins, r.high) * 1.5; // highs are physically quieter
      } else if (playing && synthetic) {
        // No usable analyser (CORS-tainted media, no graph…): keep the scene alive with a gentle breath.
        rb = 0.34 + 0.2 * Math.sin(t * 2.1) + 0.08 * Math.sin(t * 5.3);
        rm = 0.3 + 0.12 * Math.sin(t * 1.3 + 1);
        rh = 0.22 + 0.1 * Math.sin(t * 3.1 + 2);
      }
      const b = this._agc("bass", rb, dt), m = this._agc("mid", rm, dt), h = this._agc("high", rh, dt);
      this.bass += (b - this.bass) * expK(dt, b > this.bass ? 45 : 260);
      this.mid += (m - this.mid) * expK(dt, m > this.mid ? 55 : 240);
      this.high += (h - this.high) * expK(dt, h > this.high ? 28 : 150);
      this.bassFast += (b - this.bassFast) * expK(dt, b > this.bassFast ? 14 : 90);
      this.midFast += (m - this.midFast) * expK(dt, m > this.midFast ? 16 : 90);
      this.highFast += (h - this.highFast) * expK(dt, h > this.highFast ? 12 : 80);
    }
  }

  /* ======================================================================
     4. BAR BANK — log-spaced, tilt-compensated, smoothed bars
     ==================================================================== */
  class BarBank {
    constructor(n) { this.peak = 0.4; this.resize(n); }
    resize(n) { this.n = n; this.v = new Float32Array(n); this._key = ""; this.edges = null; }
    _build(len, sr) {
      const key = len + ":" + sr;
      if (key === this._key) return;
      const nyq = sr / 2, fmin = 40, fmax = Math.min(14000, nyq * 0.95), n = this.n;
      const e = new Array(n + 1);
      for (let i = 0; i <= n; i++) e[i] = clamp(Math.floor((fmin * Math.pow(fmax / fmin, i / n) / nyq) * len), 0, len - 1);
      // guarantee at least one bin per bar
      for (let i = 1; i <= n; i++) if (e[i] <= e[i - 1]) e[i] = Math.min(len - 1, e[i - 1] + 1);
      this.edges = e;
      this._key = key;
    }
    update(spec, dt, playing, synthetic, t) {
      const n = this.n, v = this.v;
      const ka = expK(dt, 35), kr = expK(dt, 210);
      let mxT = 0;
      const target = this._t || (this._t = new Float32Array(n));
      if (playing && spec && spec.bins && !synthetic) {
        const bins = spec.bins;
        this._build(bins.length, spec.sampleRate);
        const e = this.edges;
        for (let i = 0; i < n; i++) {
          const lo = e[i], hi = Math.max(lo + 1, e[i + 1]);
          let sum = 0, mx = 0;
          for (let k = lo; k < hi; k++) { const b = bins[k]; sum += b; if (b > mx) mx = b; }
          const val = (mx * 0.55 + (sum / (hi - lo)) * 0.45) * (1 + (i / n) * 0.9); // +tilt
          target[i] = val;
          if (val > mxT) mxT = val;
        }
        this.peak = Math.max(mxT, this.peak * Math.exp(-dt / 6000), 0.3);
        const g = 1 / this.peak;
        for (let i = 0; i < n; i++) target[i] = clamp(target[i] * g);
      } else if (playing && synthetic) {
        for (let i = 0; i < n; i++) target[i] = clamp(0.2 + 0.14 * Math.sin(t * 1.4 + i * 0.7) + 0.1 * Math.sin(t * 2.3 - i * 0.31));
      } else target.fill(0);
      for (let i = 0; i < n; i++) v[i] += (target[i] - v[i]) * (target[i] > v[i] ? ka : kr);
    }
  }

  /* ======================================================================
     5. BEAT DETECTOR
     ----------------------------------------------------------------------
     Works on the *fast-smoothed* band levels, combined into one energy value
     (bass-heavy). A beat fires when all hold:
        • positive flux (energy rising) beats an adaptive threshold
        • energy sits above its slow running average
        • refractory period elapsed (190 ms ≈ 315 bpm ceiling)
     Outputs: hit (this frame), strength 0..1, pulse (decaying), bpm estimate.
     ==================================================================== */
  class BeatDetector {
    constructor() { this.reset(); }
    reset() {
      this.prev = 0; this.slow = 0; this.fluxAvg = 0.015; this.cool = 0;
      this.pulse = 0; this.hit = false; this.strength = 0; this.count = 0; this.lastT = 0; this.bpm = 0;
    }
    update(b, dt, now, active) {
      this.hit = false;
      const e = b.bassFast * 0.58 + b.midFast * 0.3 + b.highFast * 0.12;
      const flux = Math.max(0, e - this.prev) * (16.7 / Math.max(4, dt));
      this.prev = e;
      this.slow += (e - this.slow) * expK(dt, 700);
      this.fluxAvg += (flux - this.fluxAvg) * expK(dt, 900);
      this.cool -= dt;
      if (active && this.cool <= 0 && flux > this.fluxAvg * 2 + 0.012 && e > this.slow * 1.08 + 0.03 && e > 0.14) {
        const rel = clamp((e - this.slow) / Math.max(0.15, this.slow));
        this.strength = clamp(0.35 + rel * 0.9 + flux * 4, 0.35, 1);
        this.hit = true;
        this.count++;
        this.pulse = Math.max(this.pulse, this.strength);
        this.cool = 190;
        if (this.lastT) {
          const iv = now - this.lastT;
          if (iv > 250 && iv < 1100) this.bpm = this.bpm ? lerp(this.bpm, 60000 / iv, 0.25) : 60000 / iv;
        }
        this.lastT = now;
      }
      this.pulse *= Math.exp(-dt / 230);
      if (this.pulse < 0.002) this.pulse = 0;
    }
  }

  /* ======================================================================
     6. PARTICLE SYSTEM — structure-of-arrays pool, no allocation per frame
     ----------------------------------------------------------------------
     SPARK   short-lived streak with drag + slight gravity
     DUST    persistent, parallax drift, twinkles, wraps around the screen
     SHARD   spinning triangle, sharp, fades out
     STREAK  fast shooting star with a long trail
     Positions are CSS pixels; velocities are px per 16.7 ms frame.
     ==================================================================== */
  const K = { SPARK: 0, DUST: 1, SHARD: 2, STREAK: 3 };
  const bit = (k) => 1 << k;

  class ParticleSystem {
    constructor(cap) {
      this.cap = cap; this.limit = cap; this.cursor = 0;
      const F = () => new Float32Array(cap);
      this.x = F(); this.y = F(); this.vx = F(); this.vy = F(); this.life = F(); this.max = F();
      this.size = F(); this.rot = F(); this.vr = F(); this.alpha = F(); this.z = F();
      this.kind = new Uint8Array(cap); this.col = new Uint8Array(cap); this.alive = new Uint8Array(cap);
      this.counts = [0, 0, 0, 0];
    }
    setBudget(mult) {
      this.limit = Math.max(48, Math.floor(this.cap * mult));
      for (let i = this.limit; i < this.cap; i++) this.alive[i] = 0;
      this.cursor %= this.limit;
    }
    clear() { this.alive.fill(0); this.counts = [0, 0, 0, 0]; }
    spawn(kind, x, y, vx, vy, life, size, col, rot, vr, z, alpha) {
      const lim = this.limit;
      let i = -1;
      for (let k = 0; k < 12; k++) { const j = (this.cursor + k) % lim; if (!this.alive[j]) { i = j; break; } }
      if (i < 0) { if (kind === K.DUST) return -1; i = this.cursor % lim; } // pool full: recycle oldest-ish
      this.cursor = (i + 1) % lim;
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      this.life[i] = life; this.max[i] = life; this.size[i] = size;
      this.rot[i] = rot || 0; this.vr[i] = vr || 0; this.z[i] = z == null ? 1 : z; this.alpha[i] = alpha == null ? 1 : alpha;
      this.kind[i] = kind; this.col[i] = col; this.alive[i] = 1;
      return i;
    }
    /** Keeps exactly ~target dust motes alive (spawns a few per frame to avoid pops). */
    ensureDust(target, w, h, colors) {
      const have = this.counts[K.DUST];
      if (have < target) {
        const n = Math.min(4, target - have);
        for (let k = 0; k < n; k++) {
          this.spawn(K.DUST, rand() * w, rand() * h, (rand() - 0.5) * 0.14, -(0.03 + rand() * 0.16), 1e9,
            0.6 + rand() * 1.7, colors[(rand() * colors.length) | 0], rand() * TAU, 0, 0.35 + rand() * 0.65, 0.3 + rand() * 0.6);
        }
      } else if (have > target + 8) {
        let kill = have - target;
        for (let i = 0; i < this.limit && kill > 0; i++) if (this.alive[i] && this.kind[i] === K.DUST) { this.alive[i] = 0; kill--; }
      }
    }
    update(dt, t, w, h) {
      const f = dt / 16.667, dSpark = Math.pow(0.955, f), dShard = Math.pow(0.975, f);
      const cnt = this.counts;
      cnt[0] = cnt[1] = cnt[2] = cnt[3] = 0;
      for (let i = 0; i < this.limit; i++) {
        if (!this.alive[i]) continue;
        const k = this.kind[i];
        if (k === K.DUST) {
          const z = this.z[i];
          this.x[i] += this.vx[i] * f * z + Math.sin(t * 0.0007 + this.rot[i]) * 0.05 * f;
          this.y[i] += this.vy[i] * f * z;
          if (this.y[i] < -12) { this.y[i] = h + 12; this.x[i] = rand() * w; } else if (this.y[i] > h + 12) this.y[i] = -12;
          if (this.x[i] < -12) this.x[i] = w + 12; else if (this.x[i] > w + 12) this.x[i] = -12;
        } else {
          this.life[i] -= dt;
          if (this.life[i] <= 0) { this.alive[i] = 0; continue; }
          if (k === K.SPARK) { this.vx[i] *= dSpark; this.vy[i] = this.vy[i] * dSpark + 0.05 * f; }
          else if (k === K.SHARD) { this.vx[i] *= dShard; this.vy[i] *= dShard; this.rot[i] += this.vr[i] * f; }
          this.x[i] += this.vx[i] * f; this.y[i] += this.vy[i] * f;
        }
        cnt[k]++;
      }
    }
    /** mask = OR of bit(K.*) for the kinds a scene wants drawn. Batched per palette colour. */
    draw(c, pal, t, mask) {
      const parts = pal.parts, np = parts.length, lim = this.limit, cnt = this.counts;
      c.save();
      c.globalCompositeOperation = "lighter";

      if ((mask & bit(K.DUST)) && cnt[K.DUST]) {
        for (let ci = 0; ci < np; ci++) {
          c.fillStyle = parts[ci];
          for (let i = 0; i < lim; i++) {
            if (!this.alive[i] || this.kind[i] !== K.DUST || this.col[i] !== ci) continue;
            const tw = 0.5 + 0.5 * Math.sin(t * 0.0013 + this.rot[i]);
            c.globalAlpha = this.alpha[i] * (0.25 + 0.75 * tw);
            const r = this.size[i] * (0.6 + 0.4 * this.z[i]);
            if (r < 1.1) c.fillRect(this.x[i] - r, this.y[i] - r, r * 2, r * 2);
            else { c.beginPath(); c.arc(this.x[i], this.y[i], r, 0, TAU); c.fill(); }
          }
        }
      }
      if (mask & (bit(K.SPARK) | bit(K.STREAK))) {
        c.lineCap = "round";
        for (let ci = 0; ci < np; ci++) {
          c.strokeStyle = parts[ci];
          for (let i = 0; i < lim; i++) {
            if (!this.alive[i] || this.col[i] !== ci) continue;
            const k = this.kind[i];
            if (k !== K.SPARK && k !== K.STREAK) continue;
            if (!(mask & bit(k))) continue;
            const lf = this.life[i] / this.max[i], trail = k === K.STREAK ? 9 : 2.2;
            c.globalAlpha = this.alpha[i] * Math.min(1, lf * 1.6);
            c.lineWidth = this.size[i] * (0.5 + 0.5 * lf);
            c.beginPath();
            c.moveTo(this.x[i] - this.vx[i] * trail, this.y[i] - this.vy[i] * trail);
            c.lineTo(this.x[i], this.y[i]);
            c.stroke();
          }
        }
      }
      if ((mask & bit(K.SHARD)) && cnt[K.SHARD]) {
        c.globalCompositeOperation = "source-over";
        for (let ci = 0; ci < np; ci++) {
          c.fillStyle = parts[ci];
          for (let i = 0; i < lim; i++) {
            if (!this.alive[i] || this.kind[i] !== K.SHARD || this.col[i] !== ci) continue;
            const lf = this.life[i] / this.max[i], s = this.size[i] * (0.6 + 0.4 * lf);
            const co = Math.cos(this.rot[i]), si = Math.sin(this.rot[i]), x = this.x[i], y = this.y[i];
            c.globalAlpha = this.alpha[i] * Math.min(1, lf * 2);
            // Elongated triangle: sharp tip + two trailing corners.
            c.beginPath();
            c.moveTo(x + co * s * 1.8, y + si * s * 1.8);
            c.lineTo(x + (-co * 0.8 - si * 0.7) * s, y + (-si * 0.8 + co * 0.7) * s);
            c.lineTo(x + (-co * 0.8 + si * 0.7) * s, y + (-si * 0.8 - co * 0.7) * s);
            c.closePath();
            c.fill();
          }
        }
      }
      c.restore();
    }
  }

  /* ======================================================================
     7. LYRIC TRACKER
     ----------------------------------------------------------------------
     player.js owns the lyric DOM (.k-line / .k-word, .current/.near, --word-p).
     This module *layers extra state on top* without touching player.js:

       per line   .past / .far classes, --dist (signed), --abs, --depth (0..1)
       per word   data-state="past|active|next" (active = leading word)
       current    --k-beat / --k-bass (quantised, for gradient pumping only)
       sweep      screen position of the active word's leading edge (for sparks)

     Everything is event-driven (written only when something changed) except the
     word scan, which reads one line's worth of inline styles per frame.
     ==================================================================== */
  class LyricTracker {
    constructor(overlay) {
      this.overlay = overlay;
      this.wrap = null; this.lines = null;
      this.cur = null; this.first = null;
      this.words = []; this.states = []; this.activeIdx = -1;
      this.cull = 6; this.force = true;
      this._rectWord = null; this._wordRect = null; this._rectDirty = true; this._rectAt = 0;
      this._beatQ = -1; this._bassQ = -1;
      this.sweep = { x: 0, y: 0, h: 0, p: 0, active: false, sustain: false, valid: false };
    }
    bind() {
      if (this.wrap && this.wrap.isConnected !== false) return true;
      this.wrap = this.overlay.querySelector("#kLyrics") || this.overlay.querySelector(".k-lyrics");
      this.lines = this.wrap ? this.wrap.getElementsByClassName("k-line") : null;
      this.force = true;
      return !!this.wrap;
    }
    setCull(n) { if (n !== this.cull) { this.cull = n; this.force = true; } }
    invalidate() { this.force = true; this.invalidateLayout(); }
    invalidateLayout() { this._rectDirty = true; }

    sync(readSweep, ovRect, beat, bass) {
      if (!this.bind()) { this.sweep.active = false; return; }
      const cur = this.wrap.querySelector(".k-line.current");
      const first = this.wrap.firstElementChild;
      const depthChanged = this.force || cur !== this.cur || first !== this.first;
      if (depthChanged) this._applyDepth(cur, first);
      // _applyDepth writes styles/classes. Let the browser commit those changes
      // before measuring the new active word on the following frame.
      this._trackWord(readSweep && !depthChanged, ovRect);
      this._pushAudio(beat, bass);
    }

    /** Distance-based depth for every line. Runs only when the current line changes. */
    _applyDepth(cur, first) {
      const prev = this.cur;
      if (prev && prev !== cur) {
        for (let i = 0; i < this.words.length; i++) this.words[i].removeAttribute("data-state");
        prev.style.removeProperty("--k-beat");
        prev.style.removeProperty("--k-bass");
      }
      this.cur = cur; this.first = first; this.force = false;
      this._beatQ = this._bassQ = -1;
      this.words = cur ? Array.prototype.slice.call(cur.querySelectorAll(".k-word")) : [];
      this.states = new Array(this.words.length).fill("");
      this.activeIdx = -1;
      this.sweep.valid = false;
      this.invalidateLayout();

      const lines = this.lines, n = lines.length;
      const ci = cur ? parseInt(cur.dataset.line, 10) || 0 : -1;
      for (let i = 0; i < n; i++) {
        const el = lines[i];
        const idx = parseInt(el.dataset.line, 10);
        const d = (isNaN(idx) ? i : idx) - ci, ad = Math.abs(d);
        const depth = 1 - Math.exp(-ad * 0.55); // 0 current → ~0.98 five lines away
        const s = el.style;
        s.setProperty("--dist", d);
        s.setProperty("--abs", ad);
        s.setProperty("--depth", depth.toFixed(3));
        el.classList.toggle("past", d < 0);
        el.classList.toggle("far", ad >= this.cull); // far-line culling (CSS hides + stops painting)
      }
    }

    /** Finds the leading word of the current line and where its sweep edge is on screen. */
    _trackWord(readSweep, ov) {
      const words = this.words, sw = this.sweep;
      if (!words.length) { sw.active = false; sw.valid = false; return; }
      let act = -1, lastFull = -1, actP = 0;
      for (let i = 0; i < words.length; i++) {
        const p = parseFloat(words[i].style.getPropertyValue("--word-p")) || 0;
        if (p >= 99.9) lastFull = i;
        else if (p > 0.05 && act < 0) { act = i; actP = p; }
      }
      this.activeIdx = act;
      if (act < 0) { sw.active = false; sw.valid = false; return; }
      sw.active = true;
      sw.p = actP / 100;
      const activeWord = words[act];
      sw.sustain = activeWord.dataset.sustain === "1";
      const now = performance.now();
      const rectExpired = now - this._rectAt >= 48;
      if (ov && (this._rectDirty || activeWord !== this._rectWord || (readSweep && rectExpired))) {
        const r = activeWord.getBoundingClientRect();
        this._wordRect = { left: r.left, top: r.top, width: r.width, height: r.height };
        this._rectWord = activeWord;
        this._rectAt = now;
        this._rectDirty = false;
      }
      // Read geometry before writing data-state attributes to avoid a
      // read-after-write forced layout in this frame.
      for (let i = 0; i < words.length; i++) {
        const s = i < act ? "past" : i === act ? "active" : "next";
        if (this.states[i] !== s) { words[i].dataset.state = s; this.states[i] = s; }
      }
      if (ov && this._wordRect && this._rectWord === activeWord) {
        const r = this._wordRect;
        const x = r.left - ov.left + r.width * sw.p, y = r.top - ov.top + r.height * 0.5;
        if (!sw.valid || Math.abs(x - sw.x) + Math.abs(y - sw.y) > 160) { sw.x = x; sw.y = y; } // snap on jumps / wraps
        else { sw.x += (x - sw.x) * 0.6; sw.y += (y - sw.y) * 0.6; }
        sw.h = r.height; sw.valid = true;
      }
    }

    /** Audio level as CSS vars on the current line only (≤ a handful of nodes restyled). */
    _pushAudio(beat, bass) {
      if (!this.cur) return;
      const bq = Math.round(beat * 20) / 20, sq = Math.round(bass * 20) / 20;
      if (bq !== this._beatQ) { this.cur.style.setProperty("--k-beat", bq); this._beatQ = bq; }
      if (sq !== this._bassQ) { this.cur.style.setProperty("--k-bass", sq); this._bassQ = sq; }
    }
  }

  /* ======================================================================
     8. ADAPTIVE QUALITY
     ----------------------------------------------------------------------
     Starts from a device guess, then watches two EMAs: time between drawn
     frames and our own draw cost. Slow → drop a tier fast (≈1.2 s).
     Healthy for 6 s → climb one tier. A failed climb blocks further climbs
     for a minute (hysteresis), so we never oscillate.
     ==================================================================== */
  class AdaptiveQuality {
    constructor() {
      this.tier = this._initial();
      this.dtEma = 16.7; this.costEma = 2;
      this.slowMs = 0; this.fastMs = 0;
      this.lastChange = 0; this.lastUp = -1e9; this.blockUp = 0;
      this.locked = false;
    }
    _initial() {
      const nav = global.navigator || {};
      let t = 0;
      if ((nav.hardwareConcurrency || 8) <= 4) t = 1;
      if ((nav.deviceMemory || 8) <= 2) t = 2;
      if (global.matchMedia && global.matchMedia("(pointer:coarse)").matches) t = Math.max(t, 1);
      return t;
    }
    /** Returns the (possibly new) tier. */
    sample(dt, cost, now) {
      if (this.locked || dt > 250) return this.tier; // ignore tab-switch hitches
      this.dtEma += (dt - this.dtEma) * 0.08;
      this.costEma += (cost - this.costEma) * 0.08;
      const expected = 1000 / TIERS[this.tier].fps;
      const slow = this.dtEma > expected * 1.4 || this.costEma > 9;
      const fast = this.dtEma < expected * 1.12 && this.costEma < 3.2;
      this.slowMs = slow ? this.slowMs + dt : 0;
      this.fastMs = fast ? this.fastMs + dt : 0;
      if (this.slowMs > 1200 && this.tier < TIERS.length - 1) {
        if (now - this.lastUp < 15000) this.blockUp = now + 60000; // we climbed too eagerly
        this._move(+1, now);
      } else if (this.fastMs > 6000 && this.tier > 0 && now > this.blockUp && now - this.lastChange > 8000) {
        this.lastUp = now;
        this._move(-1, now);
      }
      return this.tier;
    }
    _move(dir, now) {
      this.tier = clamp(this.tier + dir, 0, TIERS.length - 1);
      this.lastChange = now; this.slowMs = this.fastMs = 0;
      this.dtEma = 1000 / TIERS[this.tier].fps; this.costEma = 3;
    }
  }

  /* ======================================================================
     9. SCENES
     ----------------------------------------------------------------------
     A scene draws one skin onto the shared canvas. Contract:
        resize(f)  – (re)build size-dependent caches
        draw(c, f) – paint; may spawn particles; must leave ctx state clean
        mask       – particle kinds the controller should draw afterwards
     `f` is the shared frame state (see KaraokeFx._frame).
     ==================================================================== */

  /* ======================================================================
     10. CONTROLLER
     ==================================================================== */

  /** Identity colours per skin. The cover accent tints them when it's colourful enough. */
  const IDENTITY = {
    cinema:  { a1: { r: 111, g: 143, b: 255 }, a2: { r: 255, g: 107, b: 145 } },
    neon:    { a1: { r: 255, g: 43,  b: 214 }, a2: { r: 0,   g: 229, b: 255 } },
    kinetic: { a1: { r: 255, g: 90,  b: 60  }, a2: { r: 255, g: 185, b: 56  } }
  };
  const EXTRA = {
    teal: { r: 94, g: 234, b: 212 }, white: { r: 255, g: 255, b: 255 }, warm: { r: 255, g: 170, b: 110 },
    yellow: { r: 255, g: 214, b: 102 }, violet: { r: 139, g: 92, b: 255 }, cream: { r: 255, g: 244, b: 224 }, tealK: { r: 25, g: 195, b: 180 }
  };
  /** Which palette slots sweep-sparks use per skin, and how many per second at tier 0. */
  const SWEEP = { cinema: { cols: [2, 3], rate: 18 }, neon: { cols: [1, 0], rate: 45 }, kinetic: { cols: [0, 1, 2], rate: 70 } };
  const SCENES = Object.create(null);

  class KaraokeFx {
    constructor(canvas, overlay) {
      this.canvas = canvas;
      this.overlay = overlay;
      this.ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;

      this.reader = new SpectrumReader();
      this.bands = new BandAnalyzer();
      this.beat = new BeatDetector();
      this.particles = new ParticleSystem(480);
      this.lyrics = new LyricTracker(overlay);
      this.quality = new AdaptiveQuality();
      this.q = TIERS[this.quality.tier];
      this.scenes = Object.fromEntries(Object.entries(SCENES).map(([name, Scene]) => [name, new Scene()]));
      if (!Object.keys(this.scenes).length) throw new Error("Carga al menos un módulo de estilo Karaoke antes del núcleo.");

      this.state = { style: "cinema", graph: null, playing: false, reduced: false };
      this.activeStyle = "";
      this.pal = null; this._themeKey = ""; this._accentRaw = null; this._themeTick = 0;
      this.w = 0; this.h = 0; this.dpr = 1; this.ov = { left: 0, top: 0 };
      this.sceneDirty = true;
      this.clock = 0; this.last = 0; this.lastDraw = 0; this.lastExternal = 0;
      this.silentMs = 0; this.synthetic = false;
      this._sweepAcc = 0; this._progAt = 0; this._progQ = ""; this._prog = null; this._sweepFrame = 0;
      this.raf = 0; this.timer = 0; this.destroyed = false;
      this.fps = 0; this._fpsAcc = 0; this._fpsN = 0;

      this.frame = {
        t: 0, tm: 0, dt: 16.7, w: 0, h: 0, dpr: 1, q: this.q, motion: 1, reduced: false, playing: false,
        bands: this.bands, beat: this.beat, spec: null, synthetic: false, sweep: this.lyrics.sweep,
        pal: null, particles: this.particles
      };

      this.particles.setBudget(this.q.particles);
      this.lyrics.setCull(this.q.cull);
      overlay.dataset.fx = "on";
      overlay.dataset.fxQuality = String(this.quality.tier);

      this._onResize = () => { this._sizeDirty = true; };
      this._sizeDirty = true;
      global.addEventListener("resize", this._onResize, { passive: true });
      if (typeof global.ResizeObserver === "function") {
        this._ro = new global.ResizeObserver(this._onResize);
        this._ro.observe(overlay);
      }
      this._loop = this._loop.bind(this);
      this.raf = global.requestAnimationFrame ? global.requestAnimationFrame(this._loop) : 0;
      this.resize();
    }

    /* ---------- public API ---------- */

	    /** Called by player.js each lyric frame. Renders synchronously so lyrics and FX stay in lock-step. */
	    update(style, graph, playing, reduced) {
	      const st = this.state;
	      st.style = style; st.graph = graph; st.playing = !!playing; st.reduced = !!reduced;
	      const now = performance.now();
	      this.lastExternal = now;
	      this._tick(now);
	    }
	    /** Updates the active scene immediately, including while playback is paused. */
	    setStyle(style) {
	      const value = this.scenes[style] ? style : this.defaultStyle;
	      this.state.style = value;
	      if (value !== this.activeStyle) this._setStyle(value);
	      this._sizeDirty = true;

	      // Let the fallback loop render the new scene with the current playback state.
	      if (this._isOpen()) this._tick(performance.now());

	      return value;
	    }
	    /** Force a tier (0..3) or pass null to hand control back to the adaptive governor. */
    setQuality(tier) {
      if (tier == null) { this.quality.locked = false; return; }
      this.quality.locked = true;
      this.quality.tier = clamp(tier | 0, 0, TIERS.length - 1);
      this._applyTier();
    }
    getStats() {
      return { tier: this.q.name, fps: Math.round(this.fps), cost: +this.quality.costEma.toFixed(2), particles: this.particles.counts.slice(), bpm: Math.round(this.beat.bpm), synthetic: this.synthetic };
    }
    resize() {
      if (!this.canvas || !this.overlay) return;
      this._sizeDirty = false;
      const r = this.overlay.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        this.w = 0;
        this.h = 0;
        this._sizeDirty = true;
        return;
      } // overlay hidden — keep retrying when it opens
      const dpr = Math.min(global.devicePixelRatio || 1, this.q.dpr);
      this.ov.left = r.left; this.ov.top = r.top;
      if (r.width === this.w && r.height === this.h && dpr === this.dpr) return;
      this.w = r.width; this.h = r.height; this.dpr = dpr;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.canvas.style.width = this.w + "px";
      this.canvas.style.height = this.h + "px";
      this.sceneDirty = true;
    }
    destroy() {
      this.destroyed = true;
      if (this.raf && global.cancelAnimationFrame) global.cancelAnimationFrame(this.raf);
      clearTimeout(this.timer);
      global.removeEventListener("resize", this._onResize);
      if (this._ro) this._ro.disconnect();
    }

    /* ---------- internals ---------- */

    _isOpen() { return this.overlay.classList.contains("open"); }

    /** Fallback driver: renders while player.js isn't calling update() (paused), and polls cheaply when closed. */
    _loop(now) {
      if (this.destroyed) return;
      if (!this._isOpen()) {
        this.raf = 0;
        this.timer = setTimeout(() => { this.timer = 0; if (!this.destroyed) this.raf = global.requestAnimationFrame(this._loop); }, 400);
        return;
      }
      this.raf = global.requestAnimationFrame(this._loop);
      if (now - this.lastExternal > 90) this._tick(now);
    }

    _applyTier() {
      this.q = TIERS[this.quality.tier];
      this.frame.q = this.q;
      this.overlay.dataset.fxQuality = String(this.quality.tier);
      this.particles.setBudget(this.q.particles);
      this.lyrics.setCull(this.q.cull);
      this.sceneDirty = true;
      this._sizeDirty = true;
    }

    _setStyle(style) {
      this.activeStyle = style;
      this.particles.clear();
      this.beat.reset();
      if (this.scenes.kinetic && this.scenes.kinetic.rings) this.scenes.kinetic.rings.length = 0;
      this.sceneDirty = true;
      this._themeKey = "";
      this.lyrics.invalidate();
    }

    /** Derives the working palette from the cover accent and publishes --k-a1/--k-a2 + data-accent for CSS. */
    _theme(style) {
      let raw = this.overlay.style.getPropertyValue("--k-accent");
      if (!raw && global.getComputedStyle) raw = global.getComputedStyle(this.overlay).getPropertyValue("--k-accent");
      raw = (raw || "").trim();
      const key = style + "|" + raw;
      if (key === this._themeKey) return;
      this._themeKey = key;

      const id = IDENTITY[style] || IDENTITY.cinema, acc = parseColor(raw);
      const hsl = acc ? rgbToHsl(acc) : null;
      // Grey / near-black / near-white covers carry no hue: fall back to the skin's identity colours.
      const vivid = !!hsl && hsl.s >= 0.22 && hsl.l > 0.12 && hsl.l < 0.92;
      let a1 = id.a1, a2 = id.a2;
      if (vivid) {
        const boosted = hslToRgb(hsl.h, clamp(hsl.s, 0.62, 0.95), clamp(hsl.l, 0.56, 0.7));
        if (style === "neon") a1 = mixRgb(id.a1, boosted, 0.28); // synthwave keeps its magenta/cyan identity
        else { a1 = boosted; a2 = hslToRgb(hsl.h + 48, 0.8, 0.62); }
      }
      const E = EXTRA;
      this.pal = { a1, a2, warm: E.warm, yellow: E.yellow, violet: E.violet, cream: E.cream, c: [a1, a2, E.teal] };
      let parts;
      if (style === "cinema") parts = [a1, a2, E.white, { r: 255, g: 214, b: 170 }];
      else if (style === "neon") parts = [a1, a2, E.yellow, E.violet];
      else parts = [a1, a2, E.cream, E.tealK];
      this.pal.parts = parts.map(rgb);
      this.frame.pal = this.pal;

      const ov = this.overlay;
      ov.style.setProperty("--k-a1", rgb(a1));
      ov.style.setProperty("--k-a2", rgb(a2));
      ov.dataset.accent = vivid ? "vivid" : "neutral";
    }

    /** Mirrors the range input's value into --k-pct so CSS can paint a filled track (WebKit has no ::progress). */
    _syncProgress(now) {
      if (now - this._progAt < 100) return;
      this._progAt = now;
      const el = this._prog && this._prog.isConnected !== false ? this._prog : (this._prog = this.overlay.querySelector("#kProgress"));
      if (!el) return;
      const mn = +el.min || 0, mx = +el.max || 100;
      const p = (clamp((+el.value - mn) / Math.max(1e-6, mx - mn)) * 100).toFixed(2) + "%";
      if (p !== this._progQ) { el.style.setProperty("--k-pct", p); this._progQ = p; }
    }

    _emitSweep(f) {
      const sw = f.sweep;
      if (!sw.active || !f.motion || !f.playing) { this._sweepAcc = 0; return; }
      const cfg = SWEEP[this.activeStyle] || SWEEP.cinema;
      this._sweepAcc += (f.dt / 1000) * cfg.rate * f.q.particles * (sw.sustain ? 1.8 : 1);
      let n = 0;
      while (this._sweepAcc >= 1 && n < 6) {
        this._sweepAcc -= 1; n++;
        this.particles.spawn(K.SPARK, sw.x, sw.y + (rand() - 0.5) * sw.h * 0.5, 0.3 + rand() * 1.2, -(0.3 + rand() * 1.6),
          380 + rand() * 420, 0.8 + rand() * 1.6, cfg.cols[(rand() * cfg.cols.length) | 0], 0, 0, 1, 0.9);
      }
      if (this._sweepAcc > 6) this._sweepAcc = 0;
    }

    _tick(now) {
      if (this.destroyed || !this._isOpen()) return;
      const st = this.state, q = this.q, reduced = st.reduced;

      // Frame pacing: cap the *canvas* rate (the player's loop runs at display refresh).
      const interval = reduced ? 160 : (1000 / q.fps) * 0.62;
      if (now - this.lastDraw < interval) return;
      const t0 = performance.now();
      let dt = this.lastDraw ? now - this.lastDraw : 16.7;
      if (dt > 1000) { this.particles.clear(); this.beat.reset(); }   // coming back from a long pause
      const dtRaw = dt;
      dt = clamp(dt, 1, 50);
      this.lastDraw = now;

      if (this._sizeDirty) this.resize();
      if (!this.w || !this.ctx) { this.lyrics.sync(false, this.ov, 0, 0); return; }
      const style = this.scenes[st.style] ? st.style : this.defaultStyle;
      if (style !== this.activeStyle) this._setStyle(style);
      if (!this.pal || ++this._themeTick > 20) { this._themeTick = 0; this._theme(style); }
      this._syncProgress(now);

      const motion = reduced ? 0 : 1;
      this.clock += dt * motion;
      const t = this.clock / 1000;

      // ---- audio -> bands -> beat ----
      const spec = this.reader.read(st.graph, now);
      this.silentMs = st.playing && (!spec || spec.silent) ? this.silentMs + dt : 0;
      this.synthetic = this.silentMs > 1200;
      this.bands.update(spec, dt, st.playing, this.synthetic, t);
      this.beat.update(this.bands, dt, now, st.playing && !this.synthetic && !reduced);
      if (reduced) { // keep a hint of reactivity, no pulsing
        this.beat.pulse = 0; this.beat.hit = false;
      }

      // ---- frame state shared with scenes ----
      const f = this.frame;
      f.t = t; f.tm = this.clock; f.dt = dt; f.w = this.w; f.h = this.h; f.dpr = this.dpr; f.q = q;
      f.motion = motion; f.reduced = reduced; f.playing = st.playing; f.spec = spec; f.synthetic = this.synthetic;

      // ---- lyrics: depth/word state every frame; sweep rect every 1–3 frames depending on tier ----
      const readSweep = !reduced && (this._sweepFrame++ % (this.quality.tier >= 3 ? 3 : this.quality.tier === 2 ? 2 : 1) === 0);
      this.lyrics.sync(readSweep, this.ov, this.beat.pulse, this.bands.bass);

      // ---- paint ----
      const c = this.ctx, scene = this.scenes[style];
      if (this.sceneDirty) { scene.resize(f); this.sceneDirty = false; }
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.w, this.h);
      c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.shadowBlur = 0;
      scene.draw(c, f);
      if (motion) {
        this._emitSweep(f);
        this.particles.update(dt, this.clock, this.w, this.h);
        this.particles.draw(c, this.pal, this.clock, scene.mask);
      }

      // ---- quality governor + fps counter ----
      const cost = performance.now() - t0;
      this._fpsAcc += dtRaw; this._fpsN++;
      if (this._fpsAcc > 500) { this.fps = (this._fpsN * 1000) / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
      if (!reduced && st.playing) {
        const before = this.quality.tier;
        if (this.quality.sample(dtRaw, cost, now) !== before) this._applyTier();
      }
    }
  }

  KaraokeFx.parts = { SpectrumReader, BandAnalyzer, BarBank, BeatDetector, ParticleSystem, LyricTracker, AdaptiveQuality, TIERS };
  global.AuraKaraokeCore = {
    registerScene(name, Scene) { if (SCENES[name]) throw new Error("Escena ya registrada: " + name); SCENES[name] = Scene; },
    get styles() { return Object.keys(SCENES); },
    createScene(name) { const Scene = SCENES[name]; if (!Scene) throw new Error("Estilo no cargado: " + name); return new Scene(); },
    helpers: { TAU, clamp, lerp, rand, easeOut, expK, rgba, rgb, mixRgb, seeded, makeCanvas, parseColor, rgbToHsl, hslToRgb, TIERS, SpectrumReader, BandAnalyzer, BarBank, BeatDetector, ParticleSystem, LyricTracker, AdaptiveQuality, K, bit }
  };
  global.AuraKaraokeFx = KaraokeFx;
  global.KaraokeFx = KaraokeFx;
})(typeof window !== "undefined" ? window : globalThis);
