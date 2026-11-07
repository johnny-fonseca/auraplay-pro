/* progressWaveform.js — waveform rectificada desde muestras reales de audio */
(function (global) {
  "use strict";

  class AuraProgressWaveform {
    constructor(canvas, graph, audio) {
      this.canvas = canvas;
      this.ctx = canvas && canvas.getContext("2d");
      this.graph = graph;
      this.audio = audio;
      this.frame = 0;
      this.running = false;
      this.lastFrameAt = 0;
      this.frameInterval = 1000 / 30;
      this.data = null;
      this.geometry = [];
      this.width = 0;
      this.height = 0;
      this.baseline = 0;
      this.maxHeight = 0;
      this.playedGradient = null;
      this.idleGradient = null;
      this.resizeObserver = null;
      this.themeObserver = null;
      if (!this.ctx || !this.audio) return;

      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(this.canvas);
      this.themeObserver = new MutationObserver(() => {
        this._buildGradients();
        this.draw();
      });
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "data-skin", "style"]
      });
      this._resize();
      this.audio.addEventListener("play", () => this.start());
      this.audio.addEventListener("pause", () => this.stop());
      this.audio.addEventListener("ended", () => this.stop());
      this.audio.addEventListener("loadedmetadata", () => this.draw());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.stop();
        else if (!this.audio.paused) this.start();
      });
      this.draw();
    }

    _buildGradients() {
      if (!this.ctx || !this.width) return;
      const styles = getComputedStyle(document.documentElement);
      const lo = (styles.getPropertyValue("--tone-lo") || "#59478f").trim();
      const mid = (styles.getPropertyValue("--tone-mid") || "#9c6ce0").trim();
      const hi = (styles.getPropertyValue("--tone-hi") || "#c693ff").trim();
      const makeGradient = () => {
        const gradient = this.ctx.createLinearGradient(0, 0, this.width, 0);
        gradient.addColorStop(0, lo);
        gradient.addColorStop(0.6, mid);
        gradient.addColorStop(1, hi);
        return gradient;
      };
      this.playedGradient = makeGradient();
      this.idleGradient = makeGradient();
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      const mobile = global.matchMedia && global.matchMedia("(max-width: 640px)").matches;
      const maxDpr = mobile ? 1.5 : 2;
      const dpr = Math.min(global.devicePixelRatio || 1, maxDpr);
      this.frameInterval = 1000 / (mobile ? 24 : 30);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.max(1, Math.round(this.width * dpr));
      this.canvas.height = Math.max(1, Math.round(this.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.baseline = this.height - 1;
      this.maxHeight = this.height - 3;
      const bars = Math.max(mobile ? 36 : 48, Math.min(mobile ? 96 : 160, Math.floor(this.width / (mobile ? 5 : 4))));
      const gap = mobile ? 1.5 : 2;
      this.geometry.length = bars;
      for (let i = 0; i < bars; i++) {
        this.geometry[i] = {
          x: i * this.width / bars,
          w: Math.max(1, this.width / bars - gap),
          from: 0,
          to: 0,
          playedAt: (i + 0.5) / bars
        };
      }
      this._setSampleRanges(this.data && this.data.length);
      this._buildGradients();
      this.draw();
    }

    _setSampleRanges(sampleCount) {
      if (!sampleCount) return;
      const bars = this.geometry.length;
      for (let i = 0; i < bars; i++) {
        this.geometry[i].from = Math.floor(i * sampleCount / bars);
        this.geometry[i].to = Math.max(this.geometry[i].from + 1, Math.floor((i + 1) * sampleCount / bars));
      }
    }

    start() {
      if (this.running || document.hidden) return;
      this.running = true;
      const resume = this.graph && typeof this.graph.resume === "function"
        ? this.graph.resume()
        : Promise.resolve(true);
      Promise.resolve(resume).catch(() => false).then(() => {
        if (this.running && !this.audio.paused && !document.hidden && !this.frame) {
          this.frame = global.requestAnimationFrame((time) => this._tick(time));
        }
      });
    }

    _tick(time) {
      this.frame = 0;
      if (!this.running || !this.audio || this.audio.paused || document.hidden) return;
      if (time - this.lastFrameAt >= this.frameInterval) {
        this.lastFrameAt = time;
        if (this.graph && typeof this.graph.getTimeDomain === "function") {
          this.data = this.graph.getTimeDomain();
          if (this.data && this.geometry.length && this.geometry[0].to === 0) this._setSampleRanges(this.data.length);
        }
        this.draw();
      }
      this.frame = global.requestAnimationFrame((nextTime) => this._tick(nextTime));
    }

    stop() {
      this.running = false;
      if (this.frame) global.cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.draw();
    }

    draw() {
      if (!this.ctx || !this.canvas || !this.width || !this.height) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      const samples = this.data;
      const duration = Number(this.audio.duration) || 0;
      const progress = duration ? Math.max(0, Math.min(1, this.audio.currentTime / duration)) : 0;

      // Renderiza solo muestras actuales: el coste no depende de la duración total de la pista.
      for (let i = 0; i < this.geometry.length; i++) {
        const bar = this.geometry[i];
        let amplitude = 0;
        if (samples && samples.length) {
          for (let j = bar.from; j < bar.to; j++) {
            const value = Math.abs((samples[j] - 128) / 128);
            if (value > amplitude) amplitude = value;
          }
        }
        const h = samples ? Math.max(1.5, amplitude * this.maxHeight * 1.35) : 1.5;
        const isPlayed = bar.playedAt <= progress;
        ctx.fillStyle = isPlayed ? this.playedGradient : this.idleGradient;
        ctx.globalAlpha = isPlayed ? 0.98 : 0.48;
        ctx.fillRect(bar.x, this.baseline - h, bar.w, h);
      }
      ctx.globalAlpha = 1;
    }
  }

  global.AuraProgressWaveform = AuraProgressWaveform;
})(window);
