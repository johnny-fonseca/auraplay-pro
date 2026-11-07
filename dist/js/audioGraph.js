/* audioGraph.js — Web Audio API: context, pro EQ + mastering chain, vinyl FX, analyser
 *
 * Signal flow:
 *   source -> rumble HPF -> 10-band EQ -> preamp/auto-headroom
 *          -> saturation -> bass enhancer -> air exciter -> M/S stereo
 *          -> reverb -> glue compressor (parallel) -> vinyl FX -> limiter
 *          -> analyser -> output volume
 */
(function (global) {
  const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rock: [5, 3, -2, -3, -1, 2, 4, 6, 6, 5],
    pop: [-1, 2, 5, 6, 3, 0, -1, -1, 1, 2],
    jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
    classical: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4],
    electronic: [4, 3, 0, -2, -3, 0, 2, 4, 6, 6],
    bass: [7, 6, 4, 2, 0, -2, -3, -3, -2, -1],
    treble: [-3, -3, -2, 0, 2, 4, 5, 6, 7, 7],
    vocal: [-2, -3, -2, 1, 4, 4, 3, 1, -1, -2],
    // --- pro additions ---
    loudness: [5, 4, 2, 0, -1, -1, 0, 2, 3, 4],
    warm: [3, 3, 2, 1, 0, -1, -2, -3, -3, -3],
    air: [-1, 0, 0, 0, 0, 1, 2, 4, 6, 7],
    acoustic: [4, 4, 3, 1, 1, 1, 3, 3, 3, 2],
    hiphop: [6, 5, 2, 3, -1, -1, 2, 0, 2, 3],
    cinema: [5, 4, 1, -1, 0, 1, 2, 3, 3, 3],
    vshape: [5, 3, 0, -2, -3, -2, 1, 3, 5, 5],
  };

  // Reverb room models: length (s) and decay-curve exponent.
  const REVERB_SIZES = {
    room: { sec: 0.9, decay: 4 },
    plate: { sec: 1.8, decay: 5 },
    hall: { sec: 2.8, decay: 5 },
    cathedral: { sec: 5, decay: 5.5 },
  };

  const dbToLin = (db) => Math.pow(10, db / 20);
  const toDb = (v) => (v > 1e-5 ? 20 * Math.log10(v) : -100);
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : (fallback === undefined ? lo : fallback)));
  };

  // Neutral (transparent) state of the pro chain.
  const defaultPro = () => ({
    highpass: 20, // Hz, rumble/infrasonic filter
    autoGain: true, // lower preamp automatically when EQ boosts
    preamp: 0, // dB
    saturation: { mix: 0, drive: 1.5 }, // tape/tube-style soft saturation
    bass: { amount: 0, freq: 110 }, // harmonic bass enhancer
    exciter: { amount: 0, freq: 5500 }, // harmonic "air" exciter
    stereo: { width: 1, monoBass: 0 }, // width 0..2 (1 = untouched), monoBass in Hz (0 = off)
    reverb: { mix: 0, size: "hall", preDelay: 0.02, damping: 0.5 },
    comp: {
      enabled: false, threshold: -20, ratio: 2.5, attack: 0.015, release: 0.25,
      knee: 14, makeup: 0, autoMakeup: true, mix: 1,
    },
    limiter: { enabled: true, ceiling: -0.5, release: 0.08 },
  });

  // One-click mastering profiles: EQ curve + full chain settings.
  const MASTER_PRESETS = {
    flat: { eq: "flat" },
    studio: {
      eq: "flat",
      saturation: { mix: 0.1, drive: 1.2 },
      bass: { amount: 0.1, freq: 110 },
      exciter: { amount: 0.12, freq: 6000 },
      stereo: { width: 1.12, monoBass: 100 },
      comp: { enabled: true, threshold: -18, ratio: 2, attack: 0.03, release: 0.3, knee: 20, mix: 0.7 },
    },
    warm: {
      eq: "warm",
      saturation: { mix: 0.3, drive: 2.2 },
      bass: { amount: 0.25, freq: 100 },
      exciter: { amount: 0.05, freq: 5000 },
      stereo: { width: 1, monoBass: 90 },
      reverb: { mix: 0.06, size: "room", damping: 0.7, preDelay: 0.01 },
      comp: { enabled: true, threshold: -22, ratio: 2.5, attack: 0.02, release: 0.3, knee: 18, mix: 0.6 },
    },
    club: {
      eq: "electronic",
      saturation: { mix: 0.15, drive: 2 },
      bass: { amount: 0.4, freq: 90 },
      exciter: { amount: 0.2, freq: 6500 },
      stereo: { width: 1.3, monoBass: 120 },
      comp: { enabled: true, threshold: -16, ratio: 4, attack: 0.005, release: 0.12, knee: 8, mix: 0.8 },
    },
    crystal: {
      eq: "air",
      saturation: { mix: 0.05, drive: 1.2 },
      bass: { amount: 0.05, freq: 120 },
      exciter: { amount: 0.4, freq: 7500 },
      stereo: { width: 1.25, monoBass: 110 },
      reverb: { mix: 0.05, size: "plate", damping: 0.3, preDelay: 0.015 },
      comp: { enabled: true, threshold: -20, ratio: 2, attack: 0.03, release: 0.3, knee: 20, mix: 0.5 },
    },
    cinema: {
      eq: "cinema",
      saturation: { mix: 0.08, drive: 1.5 },
      bass: { amount: 0.3, freq: 80 },
      exciter: { amount: 0.1, freq: 6000 },
      stereo: { width: 1.45, monoBass: 80 },
      reverb: { mix: 0.12, size: "hall", damping: 0.5, preDelay: 0.03 },
      comp: { enabled: true, threshold: -24, ratio: 3, attack: 0.02, release: 0.25, knee: 16, mix: 0.5 },
    },
    vocal: {
      eq: "vocal",
      saturation: { mix: 0.1, drive: 1.5 },
      exciter: { amount: 0.15, freq: 5000 },
      reverb: { mix: 0.05, size: "plate", damping: 0.5, preDelay: 0.02 },
      comp: { enabled: true, threshold: -22, ratio: 3, attack: 0.01, release: 0.18, knee: 12, mix: 0.7 },
    },
  };

  class AudioGraph {
    constructor(audioEl) {
      this.audio = audioEl;
      this.ctx = null;
      this.source = null;
      this.analyser = null;
      this.filters = [];
      this.gain = null;
      this.outGain = null;
      this.limiter = null;
      this.stages = null;
      this.vinylFx = null;
      this.vinylFxState = { active: false, intensity: 0, direction: 1, profile: "classic", backspin: false };
      this.enabled = false;
      this.failed = false;
      this.outputVolume = 1;
      this.outputMuted = false;
      this.bands = PRESETS.flat.slice();
      this.bandQ = EQ_FREQS.map(() => 1);
      this.pro = defaultPro();
      this.proBypass = false;
    }

    // ---------- curves ----------

    _makeDriveCurve(amount) {
      const n = 1024;
      const curve = new Float32Array(n);
      const drive = Math.max(0, Math.min(18, Number(amount) || 0));
      if (!drive) {
        for (let i = 0; i < n; i++) curve[i] = i * 2 / (n - 1) - 1;
        return curve;
      }
      const k = drive * 8;
      const norm = Math.atan(k);
      for (let i = 0; i < n; i++) {
        const x = i * 2 / (n - 1) - 1;
        curve[i] = Math.atan(k * x) / norm;
      }
      return curve;
    }

    // Soft tanh saturator with unity small-signal gain (level-matched).
    // A small bias adds even harmonics (tube-like warmth); DC is removed downstream.
    _makeHarmonicCurve(k, bias) {
      const n = 2048;
      const curve = new Float32Array(n);
      const kk = Math.max(0.1, Number(k) || 1);
      const b = Math.min(0.5 / kk, Math.max(0, Number(bias) || 0));
      const t0 = Math.tanh(kk * b);
      const slope = kk * (1 - t0 * t0);
      for (let i = 0; i < n; i++) {
        const x = i * 2 / (n - 1) - 1;
        curve[i] = (Math.tanh(kk * (x + b)) - t0) / slope;
      }
      return curve;
    }

    // Procedural stereo impulse response: decorrelated noise, exponential decay,
    // high frequencies decaying faster as `damping` rises.
    _makeImpulse(ctx, size, damping) {
      const spec = REVERB_SIZES[size] || REVERB_SIZES.hall;
      const rate = ctx.sampleRate;
      const len = Math.max(64, Math.floor(rate * spec.sec));
      const buf = ctx.createBuffer(2, len, rate);
      const damp = clamp(damping, 0, 1, 0.5);
      const fade = Math.floor(rate * 0.004);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const k = Math.max(0.05, 1 - damp * (0.35 + 0.6 * t));
          lp += (Math.random() * 2 - 1 - lp) * k;
          d[i] = lp * Math.pow(1 - t, spec.decay) * (i < fade ? i / fade : 1);
        }
      }
      return buf;
    }

    _ramp(param, value, tc) {
      if (!param) return;
      if (!this.ctx) { param.value = value; return; }
      const now = this.ctx.currentTime;
      try {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(value, now, tc || 0.03);
      } catch (_) {
        param.value = value;
      }
    }

    // ---------- graph construction ----------

    _buildStages(ctx) {
      const g = () => ctx.createGain();
      const bq = (type, f, q) => {
        const n = ctx.createBiquadFilter();
        n.type = type;
        n.frequency.value = f;
        n.Q.value = q === undefined ? 0.707 : q;
        return n;
      };
      const shaper = (k, bias) => {
        const s = ctx.createWaveShaper();
        s.oversample = "2x";
        s.curve = this._makeHarmonicCurve(k, bias);
        return s;
      };
      const st = {};

      st.hp = bq("highpass", 20);

      // Saturation (parallel crossfade, level-matched)
      {
        const input = g(), output = g(), dry = g(), wet = g();
        const sh = shaper(1.5, 0.06);
        wet.gain.value = 0;
        input.connect(dry); dry.connect(output);
        input.connect(sh); sh.connect(wet); wet.connect(output);
        st.sat = { input, output, dry, wet, shaper: sh, drive: 1.5 };
      }

      // Bass enhancer: lowpass -> saturate -> band-limit -> add (psychoacoustic bass)
      {
        const input = g(), output = g(), amt = g();
        const lp1 = bq("lowpass", 110);
        const sh = shaper(4, 0.08);
        const hp = bq("highpass", 35);
        const lp2 = bq("lowpass", 385);
        amt.gain.value = 0;
        input.connect(output);
        input.connect(lp1); lp1.connect(sh); sh.connect(hp); hp.connect(lp2); lp2.connect(amt); amt.connect(output);
        st.bass = { input, output, lp1, lp2, amt };
      }

      // Air exciter: highpass -> saturate -> highpass -> add (adds sparkle without raw EQ boost)
      {
        const input = g(), output = g(), amt = g();
        const hp1 = bq("highpass", 5500);
        const sh = shaper(5, 0.08);
        const hp2 = bq("highpass", 5500);
        amt.gain.value = 0;
        input.connect(output);
        input.connect(hp1); hp1.connect(sh); sh.connect(hp2); hp2.connect(amt); amt.connect(output);
        st.exciter = { input, output, hp1, hp2, amt };
      }

      // Mid/Side stereo width with optional mono-bass (side highpass).
      // Input is forced to stereo so mono files are upmixed to L=R instead of left-only.
      {
        const input = g();
        input.channelCount = 2;
        input.channelCountMode = "explicit";
        input.channelInterpretation = "speakers";
        const split = ctx.createChannelSplitter(2);
        const merge = ctx.createChannelMerger(2);
        const mid = g(), sideL = g(), sideR = g(), side = g(), sideInv = g();
        const sideHp = bq("highpass", 10);
        mid.gain.value = 0.5; sideL.gain.value = 0.5; sideR.gain.value = -0.5;
        side.gain.value = 1; sideInv.gain.value = -1;
        input.connect(split);
        split.connect(mid, 0); split.connect(mid, 1);     // M = (L+R)/2
        split.connect(sideL, 0); split.connect(sideR, 1); // S = (L-R)/2
        sideL.connect(sideHp); sideR.connect(sideHp);
        sideHp.connect(side); side.connect(sideInv);
        mid.connect(merge, 0, 0); mid.connect(merge, 0, 1);
        side.connect(merge, 0, 0);    // L = M + S*w
        sideInv.connect(merge, 0, 1); // R = M - S*w
        st.stereo = { input, output: merge, side, sideHp };
      }

      // Reverb send (pre-delay -> convolver -> HPF/LPF -> wet)
      {
        const input = g(), output = g(), dry = g(), wet = g();
        const pre = ctx.createDelay(0.2);
        const hp = bq("highpass", 200);
        const lp = bq("lowpass", 9000);
        wet.gain.value = 0;
        input.connect(dry); dry.connect(output);
        input.connect(pre);
        hp.connect(lp); lp.connect(wet); wet.connect(output);
        st.reverb = { input, output, dry, wet, pre, hp, lp, conv: null, key: "" };
        this._setConvolver(ctx, st.reverb, "hall", 0.5);
      }

      // Glue compressor with dry/wet (parallel) mix.
      // DynamicsCompressorNode has ~6 ms lookahead, so the dry path is delayed to stay phase-aligned.
      {
        const input = g(), output = g(), dry = g(), wet = g(), makeup = g();
        const dryDelay = ctx.createDelay(0.05);
        dryDelay.delayTime.value = 0.006;
        const node = ctx.createDynamicsCompressor();
        wet.gain.value = 0;
        input.connect(dryDelay); dryDelay.connect(dry); dry.connect(output);
        input.connect(node); node.connect(makeup); makeup.connect(wet); wet.connect(output);
        st.comp = { input, output, dry, wet, makeup, node };
      }

      return st;
    }

    // Replacing the node avoids InvalidStateError on browsers that forbid re-setting convolver.buffer.
    _setConvolver(ctx, rv, size, damping) {
      const conv = ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = this._makeImpulse(ctx, size, damping);
      if (rv.conv) {
        try { rv.pre.disconnect(rv.conv); } catch (_) {}
        try { rv.conv.disconnect(rv.hp); } catch (_) {}
      }
      rv.pre.connect(conv);
      conv.connect(rv.hp);
      rv.conv = conv;
      rv.key = size + ":" + clamp(damping, 0, 1, 0.5).toFixed(2);
    }

    ensure() {
      if (this.ctx || this.failed) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      let ctx = null;
      try {
        ctx = new Ctx();
        const source = ctx.createMediaElementSource(this.audio);
        const stages = this._buildStages(ctx);

        // Build EQ chain
        const filters = EQ_FREQS.map((freq, idx) => {
          const f = ctx.createBiquadFilter();
          if (idx === 0) f.type = "lowshelf";
          else if (idx === EQ_FREQS.length - 1) f.type = "highshelf";
          else f.type = "peaking";
          f.frequency.value = freq;
          f.Q.value = this.bandQ[idx];
          f.gain.value = this.enabled ? this.bands[idx] : 0;
          return f;
        });

        const gain = ctx.createGain();
        gain.gain.value = 1;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.minDecibels = -88;
        analyser.maxDecibels = -8;
        analyser.smoothingTimeConstant = 0.5;
        const outGain = ctx.createGain();
        outGain.gain.value = this.outputMuted ? 0 : this.outputVolume;

        // Output limiter (peak protection)
        const limiter = ctx.createDynamicsCompressor();
        limiter.knee.value = 0;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.08;
        limiter.ratio.value = 20;
        limiter.threshold.value = -1.5;

        const fxDry = ctx.createGain();
        const fxWet = ctx.createGain();
        const fxMix = ctx.createGain();
        const fxFilter = ctx.createBiquadFilter();
        fxFilter.type = "lowpass";
        fxFilter.frequency.value = 20000;
        fxFilter.Q.value = 0.7;
        const fxDrive = ctx.createWaveShaper();
        fxDrive.oversample = "2x";
        fxDrive.curve = this._makeDriveCurve(0);
        const fxDelay = ctx.createDelay(0.25);
        fxDelay.delayTime.value = 0.035;
        const fxFeedback = ctx.createGain();
        fxFeedback.gain.value = 0;
        fxDry.gain.value = 1;
        fxWet.gain.value = 0;
        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const timeData = new Uint8Array(analyser.fftSize);

        // source -> HPF -> EQ -> preamp
        source.connect(stages.hp);
        let prev = stages.hp;
        filters.forEach((f) => {
          prev.connect(f);
          prev = f;
        });
        prev.connect(gain);

        // preamp -> pro stages
        let node = gain;
        [stages.sat, stages.bass, stages.exciter, stages.stereo, stages.reverb, stages.comp].forEach((s) => {
          node.connect(s.input);
          node = s.output;
        });

        // pro stages -> dry + vinyl FX -> mix -> limiter -> analyser -> outGain
        node.connect(fxDry);
        node.connect(fxFilter);
        fxFilter.connect(fxDrive);
        fxDrive.connect(fxDelay);
        fxDelay.connect(fxFeedback);
        fxFeedback.connect(fxDelay);
        fxDelay.connect(fxWet);
        fxDry.connect(fxMix);
        fxWet.connect(fxMix);
        fxMix.connect(limiter);
        limiter.connect(analyser);
        analyser.connect(outGain);
        outGain.connect(ctx.destination);

        this.ctx = ctx;
        this.source = source;
        this.filters = filters;
        this.gain = gain;
        this.analyser = analyser;
        this.outGain = outGain;
        this.limiter = limiter;
        this.stages = stages;
        this.vinylFx = { dry: fxDry, wet: fxWet, mix: fxMix, filter: fxFilter, drive: fxDrive, delay: fxDelay, feedback: fxFeedback };
        this.frequencyData = frequencyData;
        this.timeData = timeData;
        this.audio.volume = 1;
        this.audio.muted = false;
        this._applyPro();
      } catch (e) {
        if (ctx && typeof ctx.close === "function") ctx.close().catch(() => {});
        this.ctx = null;
        this.stages = null;
        this.failed = true;
        console.error("AudioGraph init failed:", e);
      }
    }

    async resume() {
      this.ensure();
      if (!this.ctx || !this.analyser) return false;
      if (this.ctx && this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch (e) {
          console.error("AudioContext resume failed:", e);
          return false;
        }
      }
      return this.ctx.state === "running";
    }

    setOutput(volume01, muted) {
      this.outputVolume = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 1));
      this.outputMuted = !!muted;
      if (this.outGain) this.outGain.gain.value = this.outputMuted ? 0 : this.outputVolume;
    }

    // ---------- pro chain ----------

    // Estimated peak boost of the EQ curve (adjacent bands overlap), used for auto-headroom.
    _headroomDb() {
      const pos = this.bands.map((v) => Math.max(0, Number(v) || 0));
      let est = 0;
      for (let i = 0; i < pos.length; i++) {
        const v = pos[i] + 0.25 * (pos[i - 1] || 0) + 0.25 * (pos[i + 1] || 0);
        if (v > est) est = v;
      }
      return -Math.min(14, est * 0.8);
    }

    // Pushes the whole pro state to the audio nodes (cheap, smoothed to avoid zipper noise).
    _applyPro() {
      const s = this.stages;
      if (!this.ctx || !s) return;
      const p = this.proBypass ? Object.assign(defaultPro(), { limiter: this.pro.limiter }) : this.pro;
      const r = (param, v, tc) => this._ramp(param, v, tc);

      // rumble filter + preamp (with auto headroom for EQ boosts)
      r(s.hp.frequency, clamp(p.highpass, 10, 120, 20));
      const head = this.enabled && p.autoGain ? this._headroomDb() : 0;
      r(this.gain.gain, dbToLin(clamp(p.preamp, -24, 12, 0) + head));

      // saturation
      {
        const mix = clamp(p.saturation.mix, 0, 1, 0);
        const drive = clamp(p.saturation.drive, 0.5, 6, 1.5);
        r(s.sat.wet.gain, mix);
        r(s.sat.dry.gain, 1 - mix);
        if (drive !== s.sat.drive) {
          s.sat.shaper.curve = this._makeHarmonicCurve(drive, 0.06);
          s.sat.drive = drive;
        }
      }

      // bass enhancer
      {
        const f = clamp(p.bass.freq, 50, 250, 110);
        r(s.bass.lp1.frequency, f);
        r(s.bass.lp2.frequency, f * 3.5);
        r(s.bass.amt.gain, clamp(p.bass.amount, 0, 1, 0) * 0.7);
      }

      // exciter
      {
        const f = clamp(p.exciter.freq, 3000, 10000, 5500);
        r(s.exciter.hp1.frequency, f);
        r(s.exciter.hp2.frequency, f);
        r(s.exciter.amt.gain, clamp(p.exciter.amount, 0, 1, 0) * 0.6);
      }

      // stereo
      {
        const mb = Number(p.stereo.monoBass) || 0;
        r(s.stereo.side.gain, clamp(p.stereo.width, 0, 2, 1));
        r(s.stereo.sideHp.frequency, mb > 0 ? clamp(mb, 40, 300, 100) : 10);
      }

      // reverb
      {
        const rv = p.reverb;
        const size = REVERB_SIZES[rv.size] ? rv.size : "hall";
        const damp = clamp(rv.damping, 0, 1, 0.5);
        const key = size + ":" + damp.toFixed(2);
        if (key !== s.reverb.key) this._setConvolver(this.ctx, s.reverb, size, damp);
        const mix = clamp(rv.mix, 0, 1, 0);
        r(s.reverb.wet.gain, mix * 0.6);
        r(s.reverb.pre.delayTime, clamp(rv.preDelay, 0, 0.1, 0.02));
        r(s.reverb.lp.frequency, 14000 - damp * 9000);
      }

      // compressor
      {
        const c = p.comp;
        const thr = clamp(c.threshold, -60, 0, -20);
        const ratio = clamp(c.ratio, 1, 20, 2.5);
        r(s.comp.node.threshold, thr);
        r(s.comp.node.ratio, ratio);
        r(s.comp.node.knee, clamp(c.knee, 0, 40, 14));
        r(s.comp.node.attack, clamp(c.attack, 0, 0.2, 0.015));
        r(s.comp.node.release, clamp(c.release, 0.01, 1, 0.25));
        const auto = c.autoMakeup ? Math.abs(thr) * (1 - 1 / ratio) * 0.35 : 0;
        r(s.comp.makeup.gain, dbToLin(clamp(c.makeup, -12, 24, 0) + auto));
        const cm = c.enabled ? clamp(c.mix, 0, 1, 1) : 0;
        r(s.comp.wet.gain, cm);
        r(s.comp.dry.gain, 1 - cm);
      }

      // limiter
      {
        const l = p.limiter;
        r(this.limiter.threshold, l.enabled ? clamp(l.ceiling, -12, 0, -0.5) - 1 : 0, 0.01);
        r(this.limiter.ratio, l.enabled ? 20 : 1, 0.01);
        r(this.limiter.release, clamp(l.release, 0.01, 0.5, 0.08));
      }
    }

    _section(name, opts) {
      if (opts && typeof opts === "object") Object.assign(this.pro[name], opts);
      this._applyPro();
      return Object.assign({}, this.pro[name]);
    }

    setHighpass(hz) { this.pro.highpass = clamp(hz, 10, 120, 20); this._applyPro(); }
    setPreamp(db) { this.pro.preamp = clamp(db, -24, 12, 0); this._applyPro(); }
    setAutoGain(on) { this.pro.autoGain = !!on; this._applyPro(); }
    setSaturation(o) { return this._section("saturation", o); }
    setBass(o) { return this._section("bass", o); }
    setExciter(o) { return this._section("exciter", o); }
    setStereo(o) { return this._section("stereo", o); }
    setReverb(o) { return this._section("reverb", o); }
    setCompressor(o) { return this._section("comp", o); }
    setLimiter(o) { return this._section("limiter", o); }

    // Bypass the whole pro chain (A/B test). The safety limiter stays on.
    setProBypass(on) { this.proBypass = !!on; this._applyPro(); }

    resetPro() {
      const limiter = this.pro.limiter;
      this.pro = defaultPro();
      this.pro.limiter = limiter;
      this._applyPro();
    }

    getProState() {
      return JSON.parse(JSON.stringify(this.pro));
    }

    // One-click mastering profile: sets EQ curve, enables EQ and loads the full chain.
    applyMaster(name) {
      const m = MASTER_PRESETS[name];
      if (!m) return false;
      const next = defaultPro();
      ["saturation", "bass", "exciter", "stereo", "reverb", "comp"].forEach((k) => {
        if (m[k]) Object.assign(next[k], m[k]);
      });
      next.limiter = this.pro.limiter;
      next.autoGain = this.pro.autoGain;
      this.pro = next;
      this.proBypass = false;
      (PRESETS[m.eq] || PRESETS.flat).forEach((v, i) => this._setBandRaw(i, v));
      this.enabled = true;
      this.filters.forEach((f, i) => this._ramp(f.gain, this.bands[i]));
      this._applyPro();
      return true;
    }

    // ---------- vinyl FX ----------

    setVinylFx(state = {}) {
      this.ensure();
      if (!this.ctx || !this.vinylFx) return false;
      const active = !!state.active;
      const intensity = Math.max(0, Math.min(1, Number(state.intensity) || 0));
      const backspin = !!state.backspin;
      const now = this.ctx.currentTime;
      const smooth = (param, value, time = 0.045) => {
        try { param.cancelScheduledValues(now); param.setTargetAtTime(value, now, time); } catch (_) { param.value = value; }
      };
      const cutoff = active ? Math.max(900, 20000 - intensity * (backspin ? 15200 : 10500)) : 20000;
      const wet = active ? Math.min(0.28, 0.025 + intensity * (backspin ? 0.22 : 0.13)) : 0;
      const drive = active ? intensity * (backspin ? 7 : 3.5) : 0;
      const delay = backspin ? 0.075 : 0.035;
      const feedback = active ? Math.min(0.38, intensity * (backspin ? 0.32 : 0.16)) : 0;
      smooth(this.vinylFx.filter.frequency, cutoff);
      smooth(this.vinylFx.wet.gain, wet);
      smooth(this.vinylFx.dry.gain, active ? Math.max(0.78, 1 - intensity * 0.12) : 1);
      smooth(this.vinylFx.delay.delayTime, delay);
      smooth(this.vinylFx.feedback.gain, feedback);
      try { this.vinylFx.drive.curve = this._makeDriveCurve(drive); } catch (_) {}
      this.vinylFxState = { active, intensity, direction: state.direction < 0 ? -1 : 1, profile: state.profile || "classic", backspin };
      return true;
    }

    resetVinylFx() {
      return this.setVinylFx({ active: false });
    }

    getVinylFxState() {
      return Object.assign({}, this.vinylFxState);
    }

    // ---------- EQ ----------

    _setBandRaw(index, value) {
      const v = clamp(value, -18, 18, 0);
      this.bands[index] = v;
      if (this.filters[index]) this._ramp(this.filters[index].gain, this.enabled ? v : 0);
    }

    setBand(index, value) {
      this._setBandRaw(index, value);
      this._applyPro();
    }

    setBands(values) {
      values.forEach((v, i) => this._setBandRaw(i, v));
      this._applyPro();
    }

    // Q for peaking bands (shelf filters ignore Q in Web Audio).
    setBandQ(index, q) {
      const v = clamp(q, 0.1, 12, 1);
      this.bandQ[index] = v;
      const f = this.filters[index];
      if (f && f.type === "peaking") this._ramp(f.Q, v);
    }

    applyPreset(name) {
      const p = PRESETS[name];
      if (!p) return;
      this.setBands(p);
    }

    setEnabled(on) {
      this.enabled = !!on;
      this.filters.forEach((f, i) => {
        this._ramp(f.gain, this.enabled ? this.bands[i] : 0);
      });
      this._applyPro();
    }

    // Live combined EQ response (dB) for drawing the curve. 20 Hz – 20 kHz, log-spaced.
    getEqCurve(points = 128) {
      if (!this.filters.length) return null;
      const n = Math.max(8, points | 0);
      const freqs = new Float32Array(n);
      for (let i = 0; i < n; i++) freqs[i] = 20 * Math.pow(1000, i / (n - 1));
      const db = new Float32Array(n);
      const mag = new Float32Array(n);
      const phase = new Float32Array(n);
      this.filters.forEach((f) => {
        f.getFrequencyResponse(freqs, mag, phase);
        for (let i = 0; i < n; i++) db[i] += 20 * Math.log10(Math.max(1e-6, mag[i]));
      });
      return { freqs, db };
    }

    // ---------- analysis ----------

    getDataArray() {
      if (!this.analyser) return null;
      this.analyser.getByteFrequencyData(this.frequencyData);
      return this.frequencyData;
    }

    getTimeDomain() {
      if (!this.analyser) return null;
      this.analyser.getByteTimeDomainData(this.timeData);
      return this.timeData;
    }

    // Meters: peak/RMS (dBFS) and gain reduction (dB, negative) of compressor and limiter.
    getLevels() {
      const t = this.getTimeDomain();
      if (!t || !this.stages) return null;
      let peak = 0, sum = 0;
      for (let i = 0; i < t.length; i++) {
        const v = (t[i] - 128) / 128;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
      }
      const red = (n) => {
        const r = n && n.reduction;
        return typeof r === "number" ? r : (r && typeof r.value === "number" ? r.value : 0);
      };
      return {
        peakDb: toDb(peak),
        rmsDb: toDb(Math.sqrt(sum / t.length)),
        compReduction: red(this.stages.comp.node),
        limiterReduction: red(this.limiter),
      };
    }
  }

  global.AuraAudioGraph = AudioGraph;
  global.AURA_EQ_FREQS = EQ_FREQS;
  global.AURA_EQ_PRESETS = PRESETS;
  global.AURA_MASTER_PRESETS = MASTER_PRESETS;
  global.AURA_REVERB_SIZES = Object.keys(REVERB_SIZES);
})(window);
