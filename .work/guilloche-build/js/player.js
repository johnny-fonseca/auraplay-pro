/* player.js — núcleo del reproductor AuraPlay Pro */
(function (global) {
  const { AuraUtils: U, AuraStorage: S, AuraToast, AuraLRC, AuraMetadata, AuraAudioGraph, AuraVisualizer } = global;
  const LYRICS_PARSER_VERSION = AuraLRC.version;

  /* ============================================================
     Tonearm · brazo sincronizado con el progreso real del audio
     - El brazo gira sobre un pivote fijo (centro de .tonearm). La aguja recorre el
       disco desde el surco exterior (--groove-start) hasta el surco de cierre
       (--groove-end), ambos como fracción del radio del disco.
     - El radio del surco baja linealmente con currentTime/duration (igual que en un
       LP real) y se convierte en ángulo resolviendo el triángulo
       pivote–centro–aguja con la ley de cosenos. Todo se mide del DOM, así que
       sigue siendo exacto en cualquier tamaño de pantalla o skin.
     - Fases: rest → glide (baja a la pista) → track (lee el surco) → return → rest
     ============================================================ */
  const TONEARM = {
    glide:  { min: 600, max: 1300, perDeg: 20 }, // soporte → surco
    ret:    { min: 500, max: 1400, perDeg: 22 }, // surco → soporte
    seek:   { min: 250, max: 700,  perDeg: 10 }, // salto al arrastrar la barra
    seekDeg: 0.6,                                // desvío que se considera "salto"
    minStep: 0.002,                              // no reescribir CSS por menos de esto (°)
    lookahead: 0.25                              // s máx. de interpolación entre timeupdate
  };
  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  class Tonearm {
    constructor(audio) {
      this.audio = audio;
      this.mode = "rest";
      this.angle = null;          // ángulo actual (°); se inicializa con --rest
      this.applied = NaN;
      this.from = 0; this.t0 = 0; this.dur = 0;
      this.raf = 0;
      this.geo = null; this.dirty = true;
      this.lastCT = -1; this.lastStamp = 0;
      this.observed = null;
      this.manualHold = false;
      this.reduce = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;

      const invalidate = () => { this.dirty = true; };
      global.addEventListener("resize", invalidate);
      if (global.ResizeObserver) this.ro = new ResizeObserver(invalidate);
      if (global.MutationObserver) {
        new MutationObserver(invalidate).observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
      }

      audio.addEventListener("play", () => this._engage());
      // Pausar congela el brazo en el surco actual; al final conserva la aguja
      // en el surco interior para que la posición visual siga coincidiendo con
      // currentTime.
      audio.addEventListener("pause", () => this._hold());
      audio.addEventListener("ended", () => this._release());
      audio.addEventListener("loadedmetadata", () => this._syncStoppedPosition());
      audio.addEventListener("durationchange", () => this._syncStoppedPosition());
      audio.addEventListener("seeked", () => this._syncStoppedPosition());
    }

    _playing() { return !this.audio.paused && !this.audio.ended; }
    beginManualControl() {
      this.manualHold = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.mode = "manual";
    }
    setManualHold(held) {
      this.manualHold = !!held;
      if (this.manualHold) {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.mode = "manual";
      }
    }
    setManualAngle(angle) {
      if (!Number.isFinite(angle)) return;
      const arm = this._el();
      if (!arm) return;
      this.angle = angle;
      this.applied = angle;
      arm.style.setProperty("--tonearm-angle", angle.toFixed(3) + "deg");
      arm.dataset.state = "manual";
    }
    endManualControl() {
      this.manualHold = false;
      this.mode = "manual";
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      // El gesto ya decidió dónde cae la aguja. Si el audio sigue sonando,
      // retomar el seguimiento desde la posición elegida; si está pausado,
      // conservar el ángulo. El retorno al soporte solo corresponde al final
      // de la pista o a una caída fuera del disco.
      if (this._playing()) this._begin("glide");
      else this.mode = "paused";
    }
    _el() { return document.querySelector(".tonearm"); }
    _css(arm, name, fallback) {
      const v = Number.parseFloat(getComputedStyle(arm).getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    }
    _ms(spec, deg) {
      if (this.reduce && this.reduce.matches) return 0;
      return Math.min(spec.max, spec.min + Math.abs(deg) * spec.perDeg);
    }
    _progressOfMotion(now) { return this.dur > 0 ? U.clamp((now - this.t0) / this.dur, 0, 1) : 1; }

    /* Geometría en px de pantalla: pivote P, centro del disco C, radio R, largo del brazo L */
    _geometry(arm) {
      if (!this.dirty && this.geo) return this.geo;
      const frame = document.getElementById("artFrame");
      if (!arm || !frame) return null;
      const ar = arm.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      if (!ar.width || !fr.width) return null;
      if (this.ro && this.observed !== arm) { this.ro.observe(arm); this.ro.observe(frame); this.observed = arm; }
      const scale = ar.width / (arm.offsetWidth || ar.width);      // por si hay zoom/scale en un ancestro
      const R = (frame.offsetWidth / 2) * scale;                    // offsetWidth ignora la rotación del disco
      const px = ar.left + ar.width / 2, py = ar.top + ar.height / 2;
      const cx = fr.left + fr.width / 2, cy = fr.top + fr.height / 2; // el centro no cambia al girar
      const D = Math.hypot(cx - px, cy - py);
      const L = ar.width * this._css(arm, "--arm-reach", 2.16);
      const lo = Math.abs(D - L) + 0.5, hi = D + L - 0.5;           // alcance físico del brazo
      this.geo = {
        D, L, lo, hi, R,
        phi: Math.atan2(cy - py, cx - px) * 180 / Math.PI,          // dirección pivote → centro
        rStart: U.clamp(R * this._css(arm, "--groove-start", 0.95), lo, hi),
        rEnd:   U.clamp(R * this._css(arm, "--groove-end", 0.46), lo, hi)
      };
      this.dirty = false;
      return this.geo;
    }

    getManualArmBounds() {
      const arm = this._el();
      const g = this._geometry(arm);
      if (!g) return null;
      const rest = this._css(arm, "--rest", 62);
      const start = this._angleFor(g, g.rStart);
      const end = this._angleFor(g, g.rEnd);
      return { min: Math.min(rest, start, end) - 2, max: Math.max(rest, start, end) + 2 };
    }

    getManualDropZone(angle) {
      const arm = this._el();
      const g = this._geometry(arm);
      if (!g || !Number.isFinite(angle) || !g.R) return null;
      const a = angle * Math.PI / 180;
      const px = arm.getBoundingClientRect().left + arm.getBoundingClientRect().width / 2;
      const py = arm.getBoundingClientRect().top + arm.getBoundingClientRect().height / 2;
      const x = px + Math.cos(a) * g.L;
      const y = py + Math.sin(a) * g.L;
      const frame = document.getElementById("artFrame");
      const fr = frame.getBoundingClientRect();
      const cx = fr.left + fr.width / 2, cy = fr.top + fr.height / 2;
      const ratio = Math.hypot(x - cx, y - cy) / g.R;
      const outer = this._css(arm, "--groove-start", 0.95);
      const inner = this._css(arm, "--groove-end", 0.46);
      if (ratio > outer) return { zone: angle <= this._css(arm, "--rest", 62) + 4 ? "rest" : "outer", progress: 0, radiusRatio: ratio, point: { x, y } };
      if (ratio < 0.18) return { zone: "invalid", progress: 0, radiusRatio: ratio, point: { x, y } };
      if (ratio < inner - 1e-4) return { zone: "label", progress: 1, radiusRatio: ratio, point: { x, y } };
      return { zone: "record", progress: U.clamp((outer - ratio) / (outer - inner), 0, 1), radiusRatio: ratio, point: { x, y } };
    }

    /* Ángulo (°) con el que la aguja queda a distancia r del centro del disco */
    _angleFor(g, r) {
      const rr = U.clamp(r, g.lo, g.hi);
      const cos = (g.D * g.D + g.L * g.L - rr * rr) / (2 * g.D * g.L);
      return g.phi - Math.acos(U.clamp(cos, -1, 1)) * 180 / Math.PI;
    }

    /* Tiempo de audio estimado: currentTime + interpolación entre actualizaciones */
    _time(now) {
      const a = this.audio, ct = a.currentTime || 0;
      if (ct !== this.lastCT) { this.lastCT = ct; this.lastStamp = now; }
      if (!this._playing()) return ct;
      return ct + Math.min(Math.max(now - this.lastStamp, 0) / 1000 * (a.playbackRate || 1), TONEARM.lookahead);
    }

    /* Ángulo objetivo según el progreso de reproducción (o null si no se puede medir) */
    _target(arm, now) {
      const g = this._geometry(arm);
      if (!g) return null;
      const d = this.audio.duration;
      const p = Number.isFinite(d) && d > 0 ? U.clamp(this._time(now) / d, 0, 1) : 0;
      this.progress = p;
      return this._angleFor(g, g.rStart + (g.rEnd - g.rStart) * p);
    }

    _engage() {
      if (this.mode === "glide" || this.mode === "track") return;
      this._begin("glide");
    }
    _hold() {
      if (this.mode === "rest" || this.mode === "paused") return;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.mode = "paused";
      const arm = this._el();
      if (arm) arm.dataset.state = "paused";
      this._syncStoppedPosition();
    }
    _release() {
      if (this.mode === "rest" || this.mode === "return") return;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      const arm = this._el();
      const target = arm ? this._target(arm, performance.now()) : null;
      if (arm && target !== null) {
        this.mode = "paused";
        this._apply(arm, target);
      } else {
        this._begin("return");
      }
    }
    _syncStoppedPosition() {
      if (this.manualHold || this._playing()) return;
      const arm = this._el();
      if (!arm) return;
      const target = this._target(arm, performance.now());
      if (target === null) return;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.mode = "paused";
      this._apply(arm, target);
    }
    _begin(mode) {
      const arm = this._el();
      if (!arm) return;
      const rest = this._css(arm, "--rest", 62);
      if (this.angle === null) this.angle = rest;
      const now = performance.now();
      const goal = mode === "return" ? rest : this._target(arm, now);
      const spec = mode === "return" ? TONEARM.ret : TONEARM.glide;
      this.mode = mode;
      this.from = this.angle;
      this.t0 = now;
      this.dur = this._ms(spec, goal === null ? 0 : goal - this.angle);
      this._schedule();
    }
    _schedule() { if (!this.raf) this.raf = requestAnimationFrame((t) => this._tick(t)); }

    _tick(now) {
      this.raf = 0;
      const arm = this._el();
      if (!arm) { this.mode = "rest"; return; }
      if (this.manualHold) return;
      const rest = this._css(arm, "--rest", 62);
      if (this.angle === null) this.angle = rest;

      // Red de seguridad: si el audio se detuvo sin que llegara el evento, volver al soporte
      if ((this.mode === "glide" || this.mode === "track") && !this._playing()) this._begin("return");

      let next = this.angle;
      if (this.mode === "return") {
        const u = this._progressOfMotion(now);
        next = this.from + (rest - this.from) * easeInOut(u);
        if (u >= 1) { this.mode = "rest"; next = rest; }
      } else if (this.mode === "glide" || this.mode === "track") {
        const target = this._target(arm, now);
        if (target !== null) {
          if (this.mode === "glide") {
            // La pista se mueve mientras baja: el destino se recalcula cada frame y se alcanza exacto
            const u = this._progressOfMotion(now);
            next = this.from + (target - this.from) * easeInOut(u);
            if (u >= 1) { this.mode = "track"; next = target; }
          } else if (Math.abs(target - this.angle) > TONEARM.seekDeg) {
            // Salto (el usuario arrastró la barra o cambió currentTime): deslizar, no teletransportar
            this.mode = "glide"; this.from = this.angle; this.t0 = now;
            this.dur = this._ms(TONEARM.seek, target - this.angle);
          } else {
            next = target;
          }
        }
      }

      this._apply(arm, next);
      if (this.mode !== "rest") this._schedule();
    }

    _apply(arm, angle) {
      this.angle = angle;
      if (arm.dataset.state !== this.mode) arm.dataset.state = this.mode;
      if (Math.abs(angle - this.applied) < TONEARM.minStep && this.mode !== "rest") return;
      this.applied = angle;
      arm.style.setProperty("--tonearm-angle", angle.toFixed(3) + "deg");
      arm.style.setProperty("--tonearm-progress", (this.mode === "rest" ? 0 : this.progress || 0).toFixed(4));
    }
  }

  class Player {
    constructor() {
      // Audio element
      this.audio = document.getElementById("audio");
      this.tracks = []; // {id, file, url, name, title, artist, album, cover, lyrics, lyricsKey}
      this.lrcMap = new Map(); // basename -> text
      this.fileDirectories = new WeakMap(); // File -> carpeta escribible de origen
      this.audioDurationCache = new WeakMap(); // File -> Promise<number|null>
      this.currentIndex = -1;
      this.isPlaying = false;
      this.tonearm = new Tonearm(this.audio); // brazo autónomo: escucha play/pause/ended

      // Playback state
      const savedShuffle = S.get("shuffle", false);
      this.shuffle = savedShuffle === true || savedShuffle === 1 || savedShuffle === "1" || savedShuffle === "true";
      if (savedShuffle !== this.shuffle) S.set("shuffle", this.shuffle);
      const savedRepeat = Number(S.get("repeat", 0));
      this.repeat = Number.isFinite(savedRepeat)
        ? Math.max(0, Math.min(2, Math.trunc(savedRepeat)))
        : 0; // 0 off, 1 all, 2 one
      // Reescribe valores heredados como texto (por ejemplo, "2") en el
      // formato numérico actual para que las comparaciones sean consistentes.
      if (String(S.get("repeat", 0)) !== String(this.repeat)) S.set("repeat", this.repeat);
      this.volume = U.clamp(S.get("volume", 80), 0, 100);
      this.muted = false;
      this.previousVolume = this.volume;

      // Visualizer
      const savedVizEnabled = S.get("vizEnabled", true);
      this.vizEnabled = savedVizEnabled !== false && savedVizEnabled !== 0 && savedVizEnabled !== "0" && savedVizEnabled !== "false";
      const savedVizStyle = S.get("vizStyle", "bars");
      this.vizStyle = Array.isArray(global.AURA_VIZ_STYLES) && global.AURA_VIZ_STYLES.includes(savedVizStyle)
        ? savedVizStyle
        : "bars";
      this.vizSensitivity = U.clamp(Number(S.get("vizSensitivity", 0.7)) || 0.7, 0.4, 1.2);

      // Karaoke
      this.lyricOffset = 0;
      this.currentLyricIndex = -2;
      this.lyricFrame = 0;
      this.karaokeDomKey = "";
      this.lyricTracker = AuraLRC.createTracker([], { offset: 0 });
      this.lyricTranslationMode = ["both", "original", "translation"].includes(S.get("lyricTranslationMode", "both"))
        ? S.get("lyricTranslationMode", "both")
        : "both";
      this.karaokeFontSize = Number(S.get("karaokeFontSize", 1)) || 1;
      this.karaokeStyle = ["cinema", "neon", "kinetic", "guilloche"].includes(S.get("karaokeStyle", "cinema")) ? S.get("karaokeStyle", "cinema") : "cinema";
      this.karaokeControlsTimer = 0;

      // Audio graph & viz
      this.graph = new AuraAudioGraph(this.audio);
      this.vinyl = global.AuraVinylInteraction ? new global.AuraVinylInteraction({
        artFrame: document.getElementById("artFrame"),
        audio: this.audio,
        player: this,
        audioGraph: this.graph,
        tonearm: document.querySelector(".tonearm"),
        tonearmController: this.tonearm
      }) : null;
      this.viz = null;
      this.karaokeFx = null;

      // EQ
      const savedEqEnabled = S.get("eqEnabled", false);
      this.eqEnabled = savedEqEnabled === true || savedEqEnabled === 1 || savedEqEnabled === "1" || savedEqEnabled === "true";
      const savedBands = S.get("eqBands", []);
      this.eqBands = Array.from({ length: 10 }, (_, i) => U.clamp(Number(savedBands && savedBands[i]) || 0, -12, 12));
      const presetNames = Object.keys(global.AURA_EQ_PRESETS || {});
      const savedPreset = S.get("eqPreset", "flat");
      this.eqPreset = presetNames.includes(savedPreset) ? savedPreset : "flat";

      // Shuffle queue
      this.shuffleQueue = [];

      // Search filter
      this.searchTerm = String(S.get("searchTerm", "") || "").toLowerCase();
      this.lastFolderName = "";

      // Theme
      this.theme = S.get("theme", "dark") === "light" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", this.theme);

      // Object URLs
      this.urls = new Set();
      this._scrollRestored = false;

      this._mount();
      this._bindEvents();
      this._restoreSavedPlaylist();
      this._restoreLocalLibrary();
      this._render();
      this._updateTransport();
      this._setVolume(this.volume, false);
    }

    /* ---------------- Setup ---------------- */
    _mount() {
      // Visualizer
      const canvas = document.getElementById("vizCanvas");
      this.viz = new AuraVisualizer(canvas, this.graph);
      this.viz.setStyle(this.vizStyle);
      this.viz.setSensitivity(this.vizSensitivity);
      this.karaokeFx = new global.AuraKaraokeFx(document.getElementById("kFx"), document.getElementById("karaokeOverlay"));
      this._applyKaraokeStyle(this.karaokeStyle);

      const sensitivitySlider = document.getElementById("vizSensitivity");
      const sensitivityValue = document.getElementById("vizSensitivityValue");
      const updateSensitivity = (value) => {
        this.vizSensitivity = U.clamp(Number(value) || 0.7, 0.4, 1.2);
        this.viz.setSensitivity(this.vizSensitivity);
        sensitivitySlider.value = this.vizSensitivity;
        sensitivityValue.value = `${this.vizSensitivity.toFixed(2)}×`;
        sensitivityValue.textContent = `${this.vizSensitivity.toFixed(2)}×`;
        S.set("vizSensitivity", this.vizSensitivity);
      };
      sensitivitySlider.value = this.vizSensitivity;
      sensitivityValue.value = `${this.vizSensitivity.toFixed(2)}×`;
      sensitivityValue.textContent = `${this.vizSensitivity.toFixed(2)}×`;
      sensitivitySlider.addEventListener("input", (e) => updateSensitivity(e.target.value));

      // EQ UI
      this._renderEQ();

      // Visualizer cards
      document.querySelectorAll("[data-viz]").forEach((card) => {
        card.classList.toggle("active", card.dataset.viz === this.vizStyle);
        card.addEventListener("click", () => this.setVizStyle(card.dataset.viz));
      });

      // Highlight viz toggle
      this._updateVizButton();

      // EQ switch
      const eqSwitch = document.getElementById("eqSwitch");
      eqSwitch.classList.toggle("on", this.eqEnabled);
      eqSwitch.setAttribute("aria-checked", String(this.eqEnabled));
      this.graph.setBands(this.eqBands);
      this.graph.setEnabled(this.eqEnabled);
      this.graph.setOutput(this.volume / 100, this.muted);
    }

    _bindEvents() {
      const audio = this.audio;

      audio.addEventListener("ended", () => {
        // El loop del vinilo tiene prioridad sobre repeat y sobre el avance
        // de la cola; así el evento ended no puede saltar de pista.
        if (this.vinyl && typeof this.vinyl.handleTrackEnded === "function" && this.vinyl.handleTrackEnded()) {
          return;
        }
        if (this.repeat === 2) {
          audio.currentTime = 0;
          this._startPlayback();
          return;
        }
        // Avanzar desde el evento ended mantiene el estado de la cola
        // sincronizado incluso cuando el navegador no vuelve a emitir
        // eventos de carga para una URL de objeto consecutiva.
        this.next(true);
      });

      audio.addEventListener("timeupdate", () => {
        const cur = audio.currentTime || 0;
        const dur = audio.duration || 0;
        const pct = dur ? (cur / dur) * 100 : 0;
        const fill = document.getElementById("progressFill");
        const thumb = document.getElementById("progressThumb");
        fill.style.width = pct + "%";
        thumb.style.left = pct + "%";
        document.getElementById("currentTime").textContent = U.formatTime(cur);
        if (this.currentIndex >= 0) S.set("playbackPosition", cur);
        this._updateLyrics(cur);
        if (this.isPlaying) this._startLyricFrame();
      });

      audio.addEventListener("loadedmetadata", () => {
        document.getElementById("totalTime").textContent = U.formatTime(audio.duration);
      });

      audio.addEventListener("play", () => {
        this.isPlaying = true;
        this._updatePlayButton();
        this._updateArtSpinning();
        this._updateLyrics(audio.currentTime || 0, true);
        this._startLyricFrame();
        if (this.vizEnabled) {
          this.graph.resume().then((ok) => { if (ok) this.viz.start(); }).catch(() => {});
        }
      });

      audio.addEventListener("pause", () => {
        this.isPlaying = false;
        this._updatePlayButton();
        this._updateArtSpinning();
        this._updateLyrics(audio.currentTime || 0, true);
        this._stopLyricFrame();
        this.viz.stop(!this.vizEnabled);
      });

      const resumeOnGesture = () => {
        if (audio.paused || !this.vizEnabled) return;
        this.graph.resume().then((ok) => {
          if (!ok) return;
          this.viz.start();
          document.removeEventListener("pointerdown", resumeOnGesture);
          document.removeEventListener("keydown", resumeOnGesture);
        }).catch(() => {});
      };
      document.addEventListener("pointerdown", resumeOnGesture);
      document.addEventListener("keydown", resumeOnGesture);

      audio.addEventListener("error", () => {
        AuraToast.show("Error al reproducir el archivo", "error");
      });

      // Progress bar click + drag
      const pBar = document.getElementById("progressBar");
      let dragging = false;
      const seekFromX = (clientX) => {
        const rect = pBar.getBoundingClientRect();
        const pct = U.clamp((clientX - rect.left) / rect.width, 0, 1);
        if (this.audio.duration) this.audio.currentTime = this.audio.duration * pct;
      };
      pBar.addEventListener("mousedown", (e) => {
        dragging = true;
        seekFromX(e.clientX);
      });
      window.addEventListener("mousemove", (e) => dragging && seekFromX(e.clientX));
      window.addEventListener("mouseup", () => (dragging = false));

      // Transport buttons
      document.getElementById("btnPlay").addEventListener("click", () => this.togglePlay());
      document.getElementById("btnNext").addEventListener("click", () => this.next());
      document.getElementById("btnPrev").addEventListener("click", () => this.prev());
      document.getElementById("btnShuffle").addEventListener("click", () => this.toggleShuffle());
      document.getElementById("btnRepeat").addEventListener("click", () => this.cycleRepeat());

      // Volume
      const volSlider = document.getElementById("volSlider");
      volSlider.value = this.volume;
      volSlider.addEventListener("input", (e) => this._setVolume(parseInt(e.target.value, 10), true));
      document.getElementById("btnMute").addEventListener("click", () => this.toggleMute());

      // Header actions
      document.getElementById("btnPickFiles").addEventListener("click", () => this._openFilePicker());
      document.getElementById("btnPickFolder").addEventListener("click", () => this._openFolder());
      document.getElementById("btnTheme").addEventListener("click", () => this.toggleTheme());
      document.getElementById("btnHelp").addEventListener("click", () => this.toggleHelp());
      document.getElementById("btnSavePlaylist").addEventListener("click", () => this._savePlaylist());
      document.getElementById("btnLoadPlaylist").addEventListener("click", () => this._loadPlaylistDialog());
      document.getElementById("btnExportPlaylist").addEventListener("click", () => this._exportPlaylist());

      // Search
      const search = document.getElementById("playlistSearch");
      const clearSearch = document.getElementById("clearSearch");
      const applySearch = (value) => {
        this.searchTerm = String(value || "").trim().toLocaleLowerCase();
        S.set("searchTerm", this.searchTerm);
        clearSearch.hidden = !this.searchTerm;
        this._renderPlaylist();
      };
      search.value = this.searchTerm;
      clearSearch.hidden = !this.searchTerm;
      search.addEventListener("input", (e) => applySearch(e.target.value));
      clearSearch.addEventListener("click", () => {
        search.value = "";
        applySearch("");
        search.focus();
      });

      // Playlist actions
      document.getElementById("btnClearPlaylist").addEventListener("click", () => this.clearPlaylist());
      document.getElementById("btnToggleViz").addEventListener("click", () => this.toggleVisualizer());

      // Tabs
      document.querySelectorAll(".btn-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          S.set("activeTab", tab);
          document.querySelectorAll(".btn-tab").forEach((b) => b.classList.toggle("active", b === btn));
          document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === tab));
          if (tab === "viz") requestAnimationFrame(() => requestAnimationFrame(() => this._scrollSelectedVizIntoView()));
        });
      });

      const availableTabs = Array.from(document.querySelectorAll(".btn-tab"), (b) => b.dataset.tab);
      const storedTab = S.get("activeTab", "queue");
      const savedTab = availableTabs.includes(storedTab) ? storedTab : "queue";
      if (savedTab !== storedTab) S.set("activeTab", savedTab);
      document.querySelectorAll(".btn-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === savedTab));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === savedTab));
      if (savedTab === "viz") requestAnimationFrame(() => requestAnimationFrame(() => this._scrollSelectedVizIntoView()));

      const scrollTargets = [
        ["playlistScrollTop", document.getElementById("playlistList")],
        ["queueScrollTop", document.getElementById("queueList")]
      ];
      scrollTargets.forEach(([key, element]) => {
        if (!element) return;
        element.addEventListener("scroll", U.debounce(() => {
          S.set(key, Math.max(0, Math.round(element.scrollTop || 0)));
        }, 120), { passive: true });
      });
      window.addEventListener("scroll", U.debounce(() => {
        S.set("pageScrollY", Math.max(0, Math.round(window.scrollY || 0)));
      }, 120), { passive: true });

      // EQ
      eqSwitch:
      {
        const sw = document.getElementById("eqSwitch");
        sw.addEventListener("click", () => {
          this.eqEnabled = !this.eqEnabled;
          sw.classList.toggle("on", this.eqEnabled);
          sw.setAttribute("aria-checked", String(this.eqEnabled));
          this.graph.setEnabled(this.eqEnabled);
          S.set("eqEnabled", this.eqEnabled);
          AuraToast.show(`Ecualizador ${this.eqEnabled ? "activado" : "desactivado"}`);
        });
      }
      document.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.dataset.preset;
          this.eqPreset = name;
          this.graph.applyPreset(name);
          this.eqBands = this.graph.bands.slice();
          S.set("eqBands", this.eqBands);
          S.set("eqPreset", name);
          document.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b === btn));
          this._renderEQSliders();
        });
      });
      document.getElementById("btnEqReset").addEventListener("click", () => {
        this.graph.applyPreset("flat");
        this.eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        this.eqPreset = "flat";
        S.set("eqBands", this.eqBands);
        S.set("eqPreset", "flat");
        document.querySelectorAll("[data-preset]").forEach((b) =>
          b.classList.toggle("active", b.dataset.preset === "flat")
        );
        this._renderEQSliders();
      });

      // Karaoke
      document.getElementById("btnKaraokeFs").addEventListener("click", () => this.openKaraokeFullscreen());
      document.getElementById("btnKaraokeFs").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.openKaraokeFullscreen(); } });
      document.getElementById("btnLyricVariant").addEventListener("click", () => this.toggleLyricVariant());
      document.getElementById("btnLyricTranslationMode").addEventListener("click", () => this.cycleLyricTranslationMode());
      document.getElementById("btnKaraokeClose").addEventListener("click", () => this.closeKaraokeFullscreen());
      document.getElementById("offsetMinus").addEventListener("click", (e) => this.adjustLyricOffset(e.shiftKey ? -0.5 : -0.1));
      document.getElementById("offsetPlus").addEventListener("click", (e) => this.adjustLyricOffset(e.shiftKey ? 0.5 : 0.1));
      document.getElementById("offsetReset").addEventListener("click", () => this.adjustLyricOffset(0, true));
      document.getElementById("kPlay").addEventListener("click", () => this.togglePlay());
      document.getElementById("kPrev").addEventListener("click", () => this.prev());
      document.getElementById("kNext").addEventListener("click", () => this.next());
      document.getElementById("kFontDown").addEventListener("click", () => this.adjustKaraokeFont(-0.08));
      document.getElementById("kFontUp").addEventListener("click", () => this.adjustKaraokeFont(0.08));
      document.getElementById("kLoadLrc").addEventListener("click", () => document.getElementById("karaokeLrcPicker").click());
      document.getElementById("karaokeLrcPicker").addEventListener("change", (e) => this._loadCurrentLrc(e.target.files && e.target.files[0]));
      document.getElementById("btnKaraokeRealFs").addEventListener("click", () => this.toggleRealFullscreen());
      document.getElementById("kProgress").addEventListener("input", (e) => { if (this.audio.duration) this.audio.currentTime = this.audio.duration * Number(e.target.value) / 100; });
      document.getElementById("kLyrics").addEventListener("click", (e) => { const line = e.target.closest(".k-line"); if (line) this.audio.currentTime = Number(line.dataset.time) - this.lyricOffset; });
      document.querySelectorAll("[data-karaoke-style]").forEach((button) => {
        if (button.classList.contains("k-style-btn")) button.addEventListener("click", () => this.setKaraokeStyle(button.dataset.karaokeStyle));
      });
      document.addEventListener("visibilitychange", () => { if (document.hidden) this._stopLyricFrame(); else if (this.isPlaying) this._startLyricFrame(); });
      ["pointermove", "touchstart", "keydown"].forEach((event) => document.getElementById("karaokeOverlay").addEventListener(event, () => this._showKaraokeControls(), { passive: true }));

      // Modal close
      document.getElementById("helpClose").addEventListener("click", () => this.toggleHelp(false));
      const resetTrigger = document.getElementById("btnResetAllData");
      const resetInput = document.getElementById("resetConfirmInput");
      const resetButton = document.getElementById("btnConfirmReset");
      resetTrigger.addEventListener("click", () => this._showResetConfirmation());
      resetInput.addEventListener("input", () => {
        resetButton.disabled = resetInput.value.trim().toLocaleUpperCase() !== "BORRAR";
        document.getElementById("resetConfirmStatus").textContent = "";
      });
      document.getElementById("btnCancelReset").addEventListener("click", () => this._hideResetConfirmation());
      resetButton.addEventListener("click", () => this._resetAllData());
      document.getElementById("helpBackdrop").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) this.toggleHelp(false);
      });

      // Drag & drop on window
      this._setupDragAndDrop();
    }

    /* ---------------- File loading ---------------- */
    _openFilePicker() {
      const input = document.getElementById("filePicker");
      input.value = "";
      input.click();
      input.onchange = () => this._handleFiles(Array.from(input.files || []));
    }

    async _openFolder() {
      // Siempre abrir el selector permite cambiar de carpeta cuando se desee.
      if (!window.showDirectoryPicker) {
        // Algunos navegadores o contextos (p. ej. file://) no exponen el API
        // moderno, pero sí permiten seleccionar carpetas con webkitdirectory.
        const input = document.getElementById("folderPicker");
        input.value = "";
        input.onchange = () => this._handleFiles(Array.from(input.files || []));
        input.click();
        return;
      }
      try {
        const dirHandle = await window.showDirectoryPicker();
        this.lastFolderName = dirHandle.name || "";
        S.set("lastFolderName", this.lastFolderName);
        S.setLocal("lastFolderHandle", dirHandle).catch(() => {});
        const files = [];
        for await (const item of this._walkDir(dirHandle, dirHandle)) {
          try {
            const f = await item.handle.getFile();
            this.fileDirectories.set(f, item.parent);
            files.push(f);
          } catch (_) {}
        }
        await this._handleFiles(files);
      } catch (e) {
        if (e && e.name !== "AbortError") AuraToast.show("No se pudo abrir la carpeta", "error");
      }
    }

    async *_walkDir(dirHandle, parent = dirHandle) {
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === "file") {
          yield { handle, parent };
        } else if (handle.kind === "directory") {
          yield* this._walkDir(handle, handle);
        }
      }
    }

    _setupDragAndDrop() {
      const overlay = document.getElementById("dropOverlay");
      let depth = 0;
      window.addEventListener("dragenter", (e) => {
        if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
        depth++;
        overlay.classList.add("show");
      });
      window.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      window.addEventListener("dragleave", () => {
        depth = Math.max(0, depth - 1);
        if (!depth) overlay.classList.remove("show");
      });
      window.addEventListener("drop", async (e) => {
        e.preventDefault();
        depth = 0;
        overlay.classList.remove("show");
        const files = [];
        if (e.dataTransfer.items) {
          for (const item of e.dataTransfer.items) {
            const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
            if (entry) {
              await this._readEntry(entry, files);
            } else {
              const f = item.getAsFile && item.getAsFile();
              if (f) files.push(f);
            }
          }
        } else if (e.dataTransfer.files) {
          files.push(...e.dataTransfer.files);
        }
        await this._handleFiles(files);
      });
    }

    _readEntry(entry, files) {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((f) => {
            files.push(f);
            resolve();
          }, resolve);
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readAll = () => {
            reader.readEntries(async (entries) => {
              if (!entries.length) return resolve();
              for (const e of entries) await this._readEntry(e, files);
              readAll();
            }, resolve);
          };
          readAll();
        } else {
          resolve();
        }
      });
    }

    _lyricVariantKeys(baseKey) {
      const normalized = String(baseKey || "").toLowerCase();
      const defaultKey = normalized.replace(/_es$/, "");
      return { defaultKey, esKey: `${defaultKey}_es` };
    }

    _refreshTrackLyrics(track, embeddedLyrics = track.lyrics || []) {
      const keys = this._lyricVariantKeys(track.lyricsKey || U.baseName(track.name));
      const defaultText = this.lrcMap.get(keys.defaultKey);
      const hasSpanish = this.lrcMap.has(keys.esKey);
      const original = defaultText != null ? AuraLRC.parse(defaultText) : AuraLRC.normalize(embeddedLyrics);
      const translation = hasSpanish ? AuraLRC.parse(this.lrcMap.get(keys.esKey)) : null;
      const variants = {
        default: translation ? AuraLRC.attachTranslation(original, translation) : original,
        es: translation,
      };
      track.lyricsKey = keys.defaultKey;
      track.lyricsVariants = variants;
      track.hasSpanishLyrics = hasSpanish;
      track.hasTranslation = !!(variants.default && variants.default.some((line) => Array.isArray(line.translations) && line.translations.length));
      track.activeLyricVariant = track.activeLyricVariant === "es" && hasSpanish ? "es" : "default";
      track.lyrics = variants[track.activeLyricVariant] || [];
      if (track === this.tracks[this.currentIndex]) this._syncLyricTracker(track.lyrics, this.audio.currentTime || 0);
    }

    async _checkLocalLyrics(track) {
      const base = U.baseName(track.name);
      const keys = this._lyricVariantKeys(base);
      // Intento 1: reutilizar una letra ya cargada en la biblioteca.
      const cached = this.lrcMap.get(keys.defaultKey);
      if (typeof cached === "string" && cached.trim()) return cached;

      const dir = this.fileDirectories.get(track.file);
      if (!dir || typeof dir.getFileHandle !== "function") return null;
      // Intento 2: buscar el .lrc hermano directamente (sin solicitar escritura).
      try {
        const handle = await dir.getFileHandle(`${base}.lrc`);
        const text = await (await handle.getFile()).text();
        if (text.trim()) return text;
      } catch (_) {}
      // Intento 3: revalidar permiso de lectura y volver a consultar el directorio.
      try {
        const permission = await dir.queryPermission?.({ mode: "read" });
        if (permission === "granted" || !dir.queryPermission) {
          const handle = await dir.getFileHandle(`${base}.lrc`);
          const text = await (await handle.getFile()).text();
          if (text.trim()) return text;
        }
      } catch (_) {}
      return null;
    }

    async _readAudioDuration(file) {
      if (!file || (typeof file !== "object" && typeof file !== "function")) return null;
      const cached = this.audioDurationCache.get(file);
      if (cached) return cached;
      const pending = new Promise((resolve) => {
        let audio = null;
        let url = null;
        let timer = 0;
        let settled = false;
        const finish = (duration) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (audio) {
            audio.removeEventListener("loadedmetadata", onMetadata);
            audio.removeEventListener("error", onError);
            try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (_) {}
          }
          if (url) { try { URL.revokeObjectURL(url); } catch (_) {} }
          resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
        };
        const onMetadata = () => finish(audio.duration);
        const onError = () => finish(null);
        try {
          if (typeof Audio !== "function" || typeof URL?.createObjectURL !== "function") return finish(null);
          audio = new Audio();
          audio.preload = "metadata";
          audio.addEventListener("loadedmetadata", onMetadata, { once: true });
          audio.addEventListener("error", onError, { once: true });
          timer = setTimeout(() => finish(null), 8000);
          url = URL.createObjectURL(file);
          audio.src = url;
          audio.load();
        } catch (_) { finish(null); }
      });
      this.audioDurationCache.set(file, pending);
      return pending;
    }

    async _lrclibJson(endpoint, params = {}, allowNotFound = false) {
      const url = new URL(`https://lrclib.net/api/${endpoint}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
          if (response.status === 404 && allowNotFound) return null;
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            try { await response.body?.cancel(); } catch (_) {}
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          if (!response.ok) {
            const error = new Error(`LRCLIB respondió HTTP ${response.status}`);
            error.httpStatus = response.status;
            throw error;
          }
          return await response.json();
        } catch (error) {
          if (error?.httpStatus && error.httpStatus !== 429 && error.httpStatus < 500) throw error;
          if (attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        } finally {
          clearTimeout(timer);
        }
      }
      return null;
    }

    async _findLrclibRecord(track) {
      const usable = (record) => record && !record.instrumental &&
        (typeof record.syncedLyrics === "string" && record.syncedLyrics.trim() ||
         typeof record.plainLyrics === "string" && record.plainLyrics.trim());
      // /api/get sin duración evita falsos 404 cuando el archivo y la edición de LRCLIB difieren unos segundos.
      const direct = await this._lrclibJson("get", { track_name: track.title, artist_name: track.artist }, true);
      if (usable(direct)) return direct;

      const results = await this._lrclibJson("search", { q: `${track.artist} ${track.title}` });
      if (!Array.isArray(results)) return null;
      const normalize = (value) => String(value ?? "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ")
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const title = normalize(track.title);
      const artist = normalize(track.artist).split(/\s+(?:feat|ft|featuring|with)\s+/)[0];
      const duration = Number.isFinite(track.duration) && track.duration > 0
        ? track.duration
        : await this._readAudioDuration(track.file);
      return results.filter((record) => {
        if (!usable(record)) return false;
        const candidateTitle = normalize(record.trackName);
        const candidateArtist = normalize(record.artistName);
        const titleMatch = candidateTitle === title || candidateTitle.startsWith(`${title} `) || title.startsWith(`${candidateTitle} `);
        const artistMatch = candidateArtist === artist || candidateArtist.startsWith(`${artist} `) || artist.startsWith(`${candidateArtist} `);
        const durationMatch = !duration || !Number.isFinite(record.duration) || Math.abs(record.duration - duration) <= 12;
        return titleMatch && artistMatch && durationMatch;
      }).sort((a, b) => Math.abs((a.duration || duration || 0) - (duration || a.duration || 0)) -
        Math.abs((b.duration || duration || 0) - (duration || b.duration || 0)))[0] || null;
    }

    async _fetchLyricsFromLrclib(track) {
      try {
        const record = await this._findLrclibRecord(track);
        if (!record) return null;
        const text = record.syncedLyrics || record.plainLyrics;
        if (!text || !text.trim()) return null;
        const base = U.baseName(track.name);
        const dir = this.fileDirectories.get(track.file);
        let saved = false;
        let downloaded = false;
        if (dir?.getFileHandle) {
          let writable;
          try {
            const handle = await dir.getFileHandle(`${base}.lrc`, { create: true });
            writable = await handle.createWritable();
            await writable.write(text.endsWith("\n") ? text : `${text}\n`);
            await writable.close();
            saved = true;
          } catch (error) {
            try { await writable?.abort(); } catch (_) {}
            console.warn("[AuraPlay] Letra encontrada, pero no se pudo guardar junto al audio:", error);
          }
        }
        if (!saved) {
          downloaded = U.download(new Blob([text.endsWith("\n") ? text : `${text}\n`], { type: "text/plain;charset=utf-8" }), `${base}.lrc`);
        }
        this.lrcMap.set(this._lyricVariantKeys(base).defaultKey, text);
        return { text, saved, downloaded, filename: `${base}.lrc` };
      } catch (error) {
        console.warn("[AuraPlay] No se pudo obtener la letra de LRCLIB:", error);
        const reason = error?.httpStatus ? `HTTP ${error.httpStatus}` : (error?.code || error?.name || "error de red");
        AuraToast.show(`LRCLIB falló (${reason}). Reintenta en unos segundos; revisa la consola para más detalles.`, "warn", 7000);
        return { error: true };
      }
    }

    async _autoLoadLyrics(track) {
      if (!track || track.embeddedLyrics || track.lyrics?.length) return;
      const local = await this._checkLocalLyrics(track);
      const downloaded = local ? null : await this._fetchLyricsFromLrclib(track);
      const text = local || downloaded?.text;
      if (!text || !this.tracks.includes(track)) {
        if (!local && !downloaded) AuraToast.show(`No se encontró letra para «${track.title}» (${track.artist}).`, "warn", 4500);
        return;
      }
      this._refreshTrackLyrics(track, AuraLRC.parse(text));
      this._persistLocalLibrary();
      if (this.tracks[this.currentIndex] === track) this._updateLyrics(this.audio.currentTime || 0);
      this._render();
      if (downloaded?.saved) {
        AuraToast.show(`Letra descargada y guardada: ${downloaded.filename}`, "success", 5000);
      } else if (downloaded?.downloaded) {
        AuraToast.show(`Letra descargada como ${downloaded.filename}. El navegador puede guardarla en Descargas.`, "success", 6000);
      } else if (downloaded) {
        AuraToast.show("Letra encontrada, pero el navegador no permitió guardar el archivo .lrc.", "warn", 6000);
      }
    }
    async _handleFiles(files) {
      if (!files || !files.length) return;
      this._showLoading("Procesando archivos...");

      // Split audio vs lrc
      const audioFiles = [];
      for (const f of files) {
        if (U.isAudioFile(f)) audioFiles.push(f);
        else if (U.isLrcFile(f)) {
          try {
            const text = await f.text();
            this.lrcMap.set(U.baseName(f.name), text);
          } catch (_) {}
        }
      }

      let added = 0;
      for (const f of audioFiles) {
        const { tags, picture } = await AuraMetadata.extractTags(f);
        const url = URL.createObjectURL(f);
        this.urls.add(url);
        if (picture) this.urls.add(picture);

        const baseKey = U.baseName(f.name);
        const keys = this._lyricVariantKeys(baseKey);
        const lyricsText = this.lrcMap.get(keys.defaultKey) || null;
        const lyrics = lyricsText ? AuraLRC.parse(lyricsText) : (tags.lyrics ? AuraLRC.parse(tags.lyrics) : []);

        const track = {
          id: U.uid(),
          file: f,
          url,
          name: f.name,
          title: U.pickTitle(tags, f.name),
          artist: U.pickArtist(tags),
          album: U.pickAlbum(tags),
          year: tags.year || "",
          genre: tags.genre || "",
          embeddedLyrics: !lyricsText && !!tags.lyrics,
          cover: picture,
          lyrics,
          lyricsKey: keys.defaultKey,
          activeLyricVariant: "default",
        };
        this._refreshTrackLyrics(track, lyrics);
        this.tracks.push(track);
        added++;
        if (!track.embeddedLyrics && !track.lyrics.length) this._autoLoadLyrics(track);
      }

      // Re-match lyrics for previously added tracks
      this.tracks.forEach((t) => {
        this._refreshTrackLyrics(t, t.lyricsVariants?.default || t.lyrics || []);
      });

      this._hideLoading();
      this._persistLocalLibrary();
      this._render();

      if (added > 0) {
        AuraToast.show(`${added} canción${added === 1 ? "" : "es"} añadida${added === 1 ? "" : "s"}`, "success");
        if (this.currentIndex === -1) this.play(0);
      } else if (!files.length) {
        AuraToast.show("No se detectaron archivos válidos", "warn");
      }
    }

    /* ---------------- Rendering ---------------- */
    _render() {
      this._renderPlaylist();
      this._renderQueue();
      this._renderNowPlaying();
      this._updateCounters();
      this._restoreScrollPositions();
    }

    _restoreScrollPositions() {
      if (this._scrollRestored || !this.tracks.length) return;
      this._scrollRestored = true;
      const restore = () => {
        const playlist = document.getElementById("playlistList");
        const queue = document.getElementById("queueList");
        if (playlist) playlist.scrollTop = Math.max(0, Number(S.get("playlistScrollTop", 0)) || 0);
        if (queue) queue.scrollTop = Math.max(0, Number(S.get("queueScrollTop", 0)) || 0);
        const pageY = Math.max(0, Number(S.get("pageScrollY", 0)) || 0);
        if (pageY && typeof window.scrollTo === "function") window.scrollTo(0, pageY);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
      else restore();
    }

    _updateCounters() {
      document.getElementById("playlistCount").textContent =
        this.tracks.length === 1 ? "1 pista" : `${this.tracks.length} pistas`;
    }

    _renderPlaylist() {
      const list = document.getElementById("playlistList");
      const empty = document.getElementById("playlistEmpty");
      const filtered = this.tracks
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => {
          if (!this.searchTerm) return true;
          return (
            t.title.toLowerCase().includes(this.searchTerm) ||
            t.artist.toLowerCase().includes(this.searchTerm) ||
            (t.album || "").toLowerCase().includes(this.searchTerm)
          );
        });

      if (this.tracks.length === 0) {
        empty.style.display = "grid";
        list.style.display = "none";
        list.innerHTML = "";
        return;
      }
      empty.style.display = "none";
      list.style.display = "flex";

      list.innerHTML = filtered
        .map(({ t, i }) => {
          const active = i === this.currentIndex;
          const cover = t.cover
            ? `<img src="${t.cover}" alt="">`
            : `<svg class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
          const playing = active
            ? `<span class="now-icon" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>`
            : "";
          return `
          <div class="song-item ${active ? "active" : ""}" data-idx="${i}" role="button" tabindex="0">
            <div class="song-thumb">${cover}${playing}</div>
            <div class="song-meta">
              <div class="song-title">${U.escapeHTML(t.title)}</div>
              <div class="song-artist">${U.escapeHTML(t.artist)}</div>
            </div>
            <div class="song-actions">
              <button class="queue-add" data-idx="${i}" title="Añadir a la cola">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button class="remove" data-idx="${i}" title="Eliminar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
              </button>
            </div>
          </div>`;
        })
        .join("");

      list.querySelectorAll(".song-item").forEach((el) => {
        const i = parseInt(el.dataset.idx, 10);
        el.addEventListener("click", (e) => {
          if (e.target.closest(".song-actions")) return;
          this.play(i);
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.play(i);
          }
        });
      });
      list.querySelectorAll(".song-actions .remove").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeTrack(parseInt(b.dataset.idx, 10));
        });
      });
      list.querySelectorAll(".song-actions .queue-add").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const i = parseInt(b.dataset.idx, 10);
          AuraToast.show(`Añadido a la cola: ${this.tracks[i].title}`);
          this._renderQueue();
        });
      });
    }

    _renderQueue() {
      const list = document.getElementById("queueList");
      const empty = document.getElementById("queueEmpty");
      if (this.tracks.length === 0) {
        empty.style.display = "grid";
        list.style.display = "none";
        list.innerHTML = "";
        return;
      }
      empty.style.display = "none";
      list.style.display = "flex";

      // Preproduction queue: symbols, numbers, other characters, then A–Z.
      const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
      const category = (title) => {
        const first = Array.from((title || "").trim())[0] || "";
        if (/^[\p{P}\p{S}]/u.test(first)) return 0;
        if (/^\p{N}/u.test(first)) return 1;
        if (/^\p{L}/u.test(first)) return 3;
        return 2;
      };
      const order = this.tracks
        .map((track, index) => index)
        .sort((a, b) => category(this.tracks[a].title) - category(this.tracks[b].title) ||
          collator.compare(this.tracks[a].title || "", this.tracks[b].title || ""));
      list.innerHTML = order
        .map((i, pos) => {
          const t = this.tracks[i];
          const active = i === this.currentIndex;
          return `
          <div class="queue-item ${active ? "active" : ""}" draggable="true" data-idx="${i}">
            <span class="queue-num">${pos + 1}</span>
            <div class="queue-info">
              <span class="queue-title">${U.escapeHTML(t.title)}</span>
              <span class="queue-artist">${U.escapeHTML(t.artist)}</span>
            </div>
            <span class="queue-handle" aria-label="Arrastrar">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
            </span>
          </div>`;
        })
        .join("");

      // Drag & drop reorder
      let dragIdx = null;
      list.querySelectorAll(".queue-item").forEach((el) => {
        el.addEventListener("click", () => this.play(parseInt(el.dataset.idx, 10)));
        el.addEventListener("dragstart", (e) => {
          dragIdx = parseInt(el.dataset.idx, 10);
          el.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragover", (e) => {
          e.preventDefault();
          el.classList.add("drag-over");
        });
        el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
        el.addEventListener("dragend", () => {
          el.classList.remove("dragging");
          list.querySelectorAll(".drag-over").forEach((x) => x.classList.remove("drag-over"));
        });
        el.addEventListener("drop", (e) => {
          e.preventDefault();
          el.classList.remove("drag-over");
          const targetIdx = parseInt(el.dataset.idx, 10);
          if (dragIdx == null || dragIdx === targetIdx) return;
          this._moveTrack(dragIdx, targetIdx);
          dragIdx = null;
        });
      });
    }

    _getPlayOrder() {
      // Returns array of track indices in play order
      const n = this.tracks.length;
      if (!n) return [];
      const order = [];
      if (this.currentIndex >= 0) order.push(this.currentIndex);
      if (this.shuffle && this.shuffleQueue.length) {
        for (const i of this.shuffleQueue) if (i !== this.currentIndex) order.push(i);
      } else {
        const start = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;
        for (let k = 0; k < n; k++) {
          const i = (start + k) % n;
          if (i !== this.currentIndex) order.push(i);
        }
      }
      return order;
    }

    _moveTrack(fromIdx, toIdx) {
      const moved = this.tracks.splice(fromIdx, 1)[0];
      this.tracks.splice(toIdx, 0, moved);
      // Update currentIndex
      if (this.currentIndex === fromIdx) this.currentIndex = toIdx;
      else if (fromIdx < this.currentIndex && toIdx >= this.currentIndex) this.currentIndex--;
      else if (fromIdx > this.currentIndex && toIdx <= this.currentIndex) this.currentIndex++;
      S.set("currentTrack", this.currentIndex);
      this._persistLocalLibrary();
      if (this.shuffle) this._generateShuffleQueue();
      this._render();
    }

    _renderNowPlaying() {
      const t = this.tracks[this.currentIndex];
      const titleEl = document.getElementById("nowTitle");
      const artistEl = document.getElementById("nowArtist");
      const albumEl = document.getElementById("nowAlbum");
      const tagsEl = document.getElementById("nowTags");
      const artImg = document.getElementById("artImg");
      const artDefault = document.getElementById("artDefault");
      const miniTitle = document.getElementById("nowMiniTitle");

      if (!t) {
        titleEl.textContent = "Selecciona una canción";
        artistEl.textContent = "Carga archivos para empezar";
        albumEl.textContent = "";
        tagsEl.innerHTML = "";
        artImg.style.display = "none";
        artDefault.style.display = "block";
        miniTitle.textContent = "—";
        this._setKaraokeMini("", "", "");
        this._updateLyricVariantButton();
        return;
      }
      titleEl.textContent = t.title;
      artistEl.textContent = t.artist;
      albumEl.textContent = t.album || "";
      miniTitle.textContent = `${t.title} — ${t.artist}`;

      const tags = [];
      if (t.album) tags.push(t.album);
      if (t.year) tags.push(t.year);
      if (t.genre) tags.push(t.genre);
      tagsEl.innerHTML = tags.map((x) => `<span class="tag-chip">${U.escapeHTML(x)}</span>`).join("");

      if (t.cover) {
        artImg.src = t.cover;
        artImg.style.display = "block";
        artDefault.style.display = "none";
      } else {
        artImg.style.display = "none";
        artDefault.style.display = "block";
      }
      this._updateLyricVariantButton();
    }

    _renderEQ() {
      const bands = document.getElementById("eqBands");
      const freqs = global.AURA_EQ_FREQS;
      bands.innerHTML = freqs
        .map((f, i) => {
          const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
          return `
          <div class="eq-band" data-band="${i}">
            <span class="eq-gain" data-gain="${i}">${this.eqBands[i] || 0}dB</span>
            <input type="range" min="-12" max="12" step="0.5" value="${this.eqBands[i] || 0}" data-band-slider="${i}" aria-label="Banda ${label}">
            <span class="eq-freq">${label}</span>
          </div>`;
        })
        .join("");

      bands.querySelectorAll("input[data-band-slider]").forEach((slider) => {
        const idx = parseInt(slider.dataset.bandSlider, 10);
        slider.addEventListener("input", (e) => {
          const v = parseFloat(e.target.value);
          this.eqBands[idx] = v;
          this.graph.setBand(idx, v);
          document.querySelector(`[data-gain="${idx}"]`).textContent = `${v}dB`;
          S.set("eqBands", this.eqBands);
        });
      });

      // Preset highlight
      document
        .querySelectorAll("[data-preset]")
        .forEach((b) => b.classList.toggle("active", b.dataset.preset === this.eqPreset));
    }

    _renderEQSliders() {
      document.querySelectorAll("input[data-band-slider]").forEach((slider) => {
        const idx = parseInt(slider.dataset.bandSlider, 10);
        slider.value = this.eqBands[idx];
        document.querySelector(`[data-gain="${idx}"]`).textContent = `${this.eqBands[idx]}dB`;
      });
    }

    /* ---------------- Playback ---------------- */
    _startPlayback() {
      // Resume Web Audio directly in the same user gesture that starts the media.
      let graphReady;
      try { graphReady = this.graph.resume(); } catch (_) { graphReady = Promise.resolve(false); }
      let playPromise;
      try { playPromise = this.audio.play(); } catch (_) { playPromise = null; }
      if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
      Promise.resolve(graphReady).then((ready) => {
        if (ready && this.vizEnabled) this.viz.start();
        else if (!ready && this.vizEnabled) AuraToast.show("No se pudo activar el analizador de audio", "warn", 3500);
      }).catch(() => {});
    }

    play(idx) {
      if (idx < 0 || idx >= this.tracks.length) return;
      this.currentIndex = idx;
      S.set("currentTrack", idx);
      S.set("playbackPosition", 0);
      const t = this.tracks[idx];
      const offsets = S.get("lyricOffsets", {});
      this.lyricOffset = Number.isFinite(Number(offsets[t.lyricsKey])) ? Number(offsets[t.lyricsKey]) : Number(S.get("lyricOffset", 0)) || 0;
      this._syncLyricTracker(t.lyrics || [], 0);
      document.getElementById("offsetValue").textContent = `${this.lyricOffset >= 0 ? "+" : ""}${this.lyricOffset.toFixed(1)}s`;
      // Cambiar src no siempre inicia una nueva carga en todos los navegadores
      // (especialmente con object URLs). Forzamos la carga antes de reproducir.
      this.audio.pause();
      this.audio.src = t.url;
      this.audio.load();
      this._startPlayback();
        this.currentLyricIndex = -2;
      this._renderNowPlaying();
      this._renderPlaylist();
      this._renderQueue();
      this._updateKaraokeFullscreen();
      this._updateLyrics(this.audio.currentTime || 0);
      if (this.shuffle) this._generateShuffleQueue();
    }

    togglePlay() {
      if (this.currentIndex === -1) {
        if (this.tracks.length > 0) this.play(0);
        else AuraToast.show("Carga canciones para empezar", "info");
        return;
      }
      if (this.audio.paused) this._startPlayback();
      else this.audio.pause();
    }

    next(fromEnded = false) {
      if (this.tracks.length === 0) return;
      let nextIdx;
      if (this.shuffle) {
        if (!this.shuffleQueue.length) this._generateShuffleQueue();
        // Find next in shuffle queue
        const pos = this.shuffleQueue.indexOf(this.currentIndex);
        if (pos === -1 || pos === this.shuffleQueue.length - 1) {
          if (this.repeat === 1) {
            this._generateShuffleQueue();
            nextIdx = this.shuffleQueue[0];
          } else if (fromEnded) {
            this.audio.pause();
            return;
          } else {
            nextIdx = this.shuffleQueue[0];
          }
        } else {
          nextIdx = this.shuffleQueue[pos + 1];
        }
      } else {
        nextIdx = this.currentIndex + 1;
        if (nextIdx >= this.tracks.length) {
          if (this.repeat === 1) nextIdx = 0;
          else if (fromEnded) {
            this.audio.pause();
            return;
          } else nextIdx = 0;
        }
      }
      this.play(nextIdx);
    }

    prev() {
      if (this.tracks.length === 0) return;
      if (this.audio.currentTime > 3) {
        this.audio.currentTime = 0;
        return;
      }
      let prevIdx;
      if (this.shuffle) {
        const pos = this.shuffleQueue.indexOf(this.currentIndex);
        prevIdx = pos > 0 ? this.shuffleQueue[pos - 1] : this.shuffleQueue[this.shuffleQueue.length - 1];
      } else {
        prevIdx = this.currentIndex - 1;
        if (prevIdx < 0) prevIdx = this.tracks.length - 1;
      }
      this.play(prevIdx);
    }

    seek(deltaSec) {
      if (!this.audio.duration) return;
      this.audio.currentTime = U.clamp(this.audio.currentTime + deltaSec, 0, this.audio.duration);
    }

    removeTrack(idx) {
      if (idx < 0 || idx >= this.tracks.length) return;
      const t = this.tracks[idx];
      this.tracks.splice(idx, 1);
      this._persistLocalLibrary();
      if (this.currentIndex === idx) {
        this.audio.pause();
        this.audio.src = "";
        this.currentIndex = -1;
      } else if (idx < this.currentIndex) {
        this.currentIndex--;
      }
      S.set("currentTrack", this.currentIndex);
      if (this.currentIndex < 0) S.set("playbackPosition", 0);
      if (this.shuffle) this._generateShuffleQueue();
      this._render();
      AuraToast.show(`Eliminada: ${t.title}`);
    }

    clearPlaylist() {
      if (this.tracks.length === 0) return;
      this.audio.pause();
      this.audio.src = "";
      this.urls.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch (_) {}
      });
      this.urls.clear();
      this.tracks = [];
      this.currentIndex = -1;
      S.set("currentTrack", -1);
      S.set("playbackPosition", 0);
      S.removeLocal("library").catch(() => {});
      S.removeLocal("lastFolderHandle").catch(() => {});
      S.remove("lastFolderName");
      this.shuffleQueue = [];
      this._render();
      AuraToast.show("Lista vaciada");
    }

    toggleShuffle() {
      this.shuffle = !this.shuffle;
      S.set("shuffle", this.shuffle);
      if (this.shuffle) this._generateShuffleQueue();
      this._updateTransport();
      this._renderQueue();
      AuraToast.show(`Aleatorio ${this.shuffle ? "activado" : "desactivado"}`);
    }

    _generateShuffleQueue() {
      const indices = this.tracks.map((_, i) => i);
      // Fisher-Yates
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      // Place current first
      if (this.currentIndex >= 0) {
        const cIdx = indices.indexOf(this.currentIndex);
        if (cIdx > 0) {
          indices.splice(cIdx, 1);
          indices.unshift(this.currentIndex);
        }
      }
      this.shuffleQueue = indices;
    }

    cycleRepeat() {
      const current = Number(this.repeat);
      this.repeat = Number.isInteger(current) && current >= 0 && current <= 2 ? (current + 1) % 3 : 0;
      S.set("repeat", this.repeat);
      this._updateTransport();
      const labels = ["desactivado", "todas", "una"];
      AuraToast.show(`Repetir: ${labels[this.repeat]}`);
    }

    _setVolume(v, save = true) {
      this.volume = U.clamp(v, 0, 100);
      if (this.volume > 0 && this.muted) this.muted = false;
      if (!this.graph.ctx) {
        this.audio.volume = this.volume / 100;
        this.audio.muted = this.muted;
      }
      this.graph.setOutput(this.volume / 100, this.muted);
      document.getElementById("volSlider").value = this.volume;
      this._updateMuteIcon();
      if (save) S.set("volume", this.volume);
      if (save) S.set("muted", this.muted);
    }

    adjustVolume(delta) {
      this._setVolume(this.volume + delta);
    }

    toggleMute() {
      if (!this.muted) {
        this.previousVolume = this.volume;
        this.muted = true;
      } else {
        this.muted = false;
      }
      if (!this.graph.ctx) this.audio.muted = this.muted;
      this.graph.setOutput(this.volume / 100, this.muted);
      this._updateMuteIcon();
      S.set("muted", this.muted);
    }

    /* ---------------- Visualizer ---------------- */
    toggleVisualizer() {
      this.vizEnabled = !this.vizEnabled;
      S.set("vizEnabled", this.vizEnabled);
      this._updateVizButton();
      if (this.vizEnabled && this.isPlaying) {
        this.graph.resume().then((ready) => {
          if (ready) this.viz.start();
          else AuraToast.show("No se pudo activar el analizador de audio", "warn", 3500);
        });
      } else {
        // Desactivar el visualizador desde el botón sí debe ser inmediato;
        // la pausa del audio usa el fade natural por defecto.
        this.viz.stop(true);
      }
      AuraToast.show(`Visualizador ${this.vizEnabled ? "activado" : "desactivado"}`);
    }

    setVizStyle(style) {
      const value = Array.isArray(global.AURA_VIZ_STYLES) && global.AURA_VIZ_STYLES.includes(style) ? style : "bars";
      this.vizStyle = value;
      this.viz.setStyle(value);
      S.set("vizStyle", value);
      document.querySelectorAll("[data-viz]").forEach((c) => c.classList.toggle("active", c.dataset.viz === value));
      this._scrollSelectedVizIntoView();
    }

    _scrollSelectedVizIntoView() {
      const pane = document.querySelector('.tab-pane[data-pane="viz"]');
      const selected = pane && pane.querySelector(".viz-card.active");
      if (!pane || !selected || !pane.classList.contains("active")) return;
      const grid = pane.querySelector(".viz-grid");
      if (!grid) return;
      const gridRect = grid.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      let delta = 0;
      if (selectedRect.top < gridRect.top) delta = selectedRect.top - gridRect.top;
      else if (selectedRect.bottom > gridRect.bottom) delta = selectedRect.bottom - gridRect.bottom;
      if (delta) grid.scrollTo({ top: grid.scrollTop + delta, behavior: "smooth" });
    }

    _updateVizButton() {
      const b = document.getElementById("btnToggleViz");
      if (!b) return;
      b.classList.toggle("active", this.vizEnabled);
      b.setAttribute("aria-pressed", String(this.vizEnabled));
      b.title = `Visualizador: ${this.vizEnabled ? "activado" : "desactivado"}`;
    }

    /* ---------------- Theme ---------------- */
    toggleTheme() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", this.theme);
      S.set("theme", this.theme);
      const ic = document.querySelector("#btnTheme svg");
      // Just feedback
      AuraToast.show(`Tema ${this.theme === "dark" ? "oscuro" : "claro"}`);
    }

    /* ---------------- Help modal ---------------- */
    toggleHelp(force) {
      const backdrop = document.getElementById("helpBackdrop");
      const open = force == null ? !backdrop.classList.contains("open") : force;
      backdrop.classList.toggle("open", open);
    }

    _showResetConfirmation() {
      const panel = document.getElementById("resetConfirmPanel");
      document.getElementById("btnResetAllData").setAttribute("aria-expanded", "true");
      panel.hidden = false;
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
      document.getElementById("resetConfirmInput").focus({ preventScroll: true });
    }

    _hideResetConfirmation() {
      document.getElementById("resetConfirmPanel").hidden = true;
      document.getElementById("btnResetAllData").setAttribute("aria-expanded", "false");
      document.getElementById("resetConfirmInput").value = "";
      document.getElementById("btnConfirmReset").disabled = true;
      document.getElementById("resetConfirmStatus").textContent = "";
    }

    async _resetAllData() {
      const input = document.getElementById("resetConfirmInput");
      const button = document.getElementById("btnConfirmReset");
      const status = document.getElementById("resetConfirmStatus");
      if (input.value.trim().toLocaleUpperCase() !== "BORRAR" || button.disabled) return;
      button.disabled = true;
      status.textContent = "Borrando datos locales y preparando el reinicio…";

      try {
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
        this.urls.forEach((url) => { try { URL.revokeObjectURL(url); } catch (_) {} });
        this.urls.clear();
        await S.resetAll();
        window.location.reload();
      } catch (error) {
        status.textContent = error && error.message
          ? error.message
          : "No se pudieron borrar los datos. Cierra otras pestañas de AuraPlay e inténtalo de nuevo.";
        button.disabled = input.value !== "BORRAR";
      }
    }

    closeOverlays() {
      this.toggleHelp(false);
      this.closeKaraokeFullscreen();
    }

    /* ---------------- Karaoke ---------------- */
    _lyricsForCurrent() { const t = this.tracks[this.currentIndex]; return t && Array.isArray(t.lyrics) ? t.lyrics : []; }
    _translationText(line) {
      return line && Array.isArray(line.translations) ? line.translations.filter(Boolean).join(" / ") : "";
    }
    _translationVisibility(line) {
      const has = !!this._translationText(line);
      if (!has) return { original: true, translation: false };
      return {
        original: this.lyricTranslationMode === "both" || this.lyricTranslationMode === "original",
        translation: this.lyricTranslationMode === "both" || this.lyricTranslationMode === "translation",
      };
    }
    _translationModeLabel() {
      return ({ both: "Original + traducción", original: "Solo original", translation: "Solo traducción" })[this.lyricTranslationMode] || "Original + traducción";
    }
    _updateLyricTranslationButton() {
      const button = document.getElementById("btnLyricTranslationMode");
      if (!button) return;
      const track = this.tracks[this.currentIndex];
      const source = track && Array.isArray(track.lyricsVariants?.default) ? track.lyricsVariants.default : this._lyricsForCurrent();
      const available = !!(track && track.hasTranslation === true && source.some((line) => !!this._translationText(line)));
      button.classList.toggle("visible", available);
      button.classList.toggle("active", available && this.lyricTranslationMode !== "both");
      button.textContent = "TR";
      button.setAttribute("aria-label", `Modo de traducción: ${this._translationModeLabel()}`);
      button.title = this._translationModeLabel();
      button.setAttribute("aria-pressed", String(available && this.lyricTranslationMode !== "both"));
    }
    cycleLyricTranslationMode() {
      const modes = ["both", "original", "translation"];
      const index = modes.indexOf(this.lyricTranslationMode);
      this.lyricTranslationMode = modes[(index + 1) % modes.length];
      S.set("lyricTranslationMode", this.lyricTranslationMode);
      this.currentLyricIndex = -2;
      this.karaokeDomKey = "";
      this._updateLyricTranslationButton();
      this._updateLyrics(this.audio.currentTime || 0);
    }
    _updateLyricVariantButton() {
      const button = document.getElementById("btnLyricVariant");
      const track = this.tracks[this.currentIndex];
      const available = !!(track && track.hasSpanishLyrics);
      const spanishActive = available && track.activeLyricVariant === "es";
      button.classList.toggle("visible", available);
      button.classList.toggle("active", spanishActive);
      button.setAttribute("aria-pressed", String(spanishActive));
      button.setAttribute("aria-label", spanishActive ? "Cambiar a letras originales" : "Cambiar a letras en español");
      button.title = spanishActive ? "Cambiar a letras originales" : "Cambiar a letras en español";
      this._updateLyricTranslationButton();
    }
    toggleLyricVariant() {
      const track = this.tracks[this.currentIndex];
      if (!track || !track.hasSpanishLyrics) return;
      track.activeLyricVariant = track.activeLyricVariant === "es" ? "default" : "es";
      track.lyrics = track.lyricsVariants[track.activeLyricVariant] || [];
      this._syncLyricTracker(track.lyrics, this.audio.currentTime || 0);
      this.currentLyricIndex = -2;
      this.karaokeDomKey = "";
      this._updateLyricVariantButton();
      this._updateLyrics(this.audio.currentTime || 0);
      this._persistLocalLibrary();
    }
    _startLyricFrame() { if (this.lyricFrame || !this.isPlaying || document.hidden) return; const tick = () => { this.lyricFrame = requestAnimationFrame(tick); this._updateLyrics(this.audio.currentTime || 0, true); }; this.lyricFrame = requestAnimationFrame(tick); }
    _stopLyricFrame() { if (this.lyricFrame) cancelAnimationFrame(this.lyricFrame); this.lyricFrame = 0; }
    _lineProgress(line, time) { const start = Number(line.time) || 0, end = Number(line.end) || start + 3; return U.clamp((time + this.lyricOffset - start) / Math.max(.05, end - start), 0, 1); }
    _syncLyricTracker(lines, time = 0) {
      this.lyricTracker.setLines(Array.isArray(lines) ? lines : []);
      this.lyricTracker.setOffset(this.lyricOffset);
      this.lyricTracker.seek(Number(time) || 0);
    }
    _renderLyricLine(target, line, wordClass = "lyric-word") {
      if (!target) return;
      target.textContent = "";
      const visibility = this._translationVisibility(line);
      if (!visibility.original && !visibility.translation) return;
      if (!visibility.original && visibility.translation) {
        const translated = document.createElement("span");
        translated.className = "lyric-translation";
        translated.textContent = this._translationText(line);
        target.appendChild(translated);
        return;
      }
      const words = line && Array.isArray(line.words) && line.words.length ? line.words : null;
      if (!words) {
        target.textContent = line && line.text ? line.text : "";
      } else {
        words.forEach((word, index) => {
          const span = document.createElement("span");
          span.className = wordClass;
          span.dataset.time = String(Number(word.time) || Number(line.time) || 0);
          span.dataset.end = String(Number(word.end) || Number(words[index + 1]?.time) || Number(line.end) || 0);
          span.textContent = `${word.text || ""}${word.space && index < words.length - 1 ? " " : ""}`;
          target.appendChild(span);
        });
      }
      if (visibility.translation) {
        const translated = document.createElement("span");
        translated.className = "lyric-translation";
        translated.textContent = this._translationText(line);
        target.appendChild(translated);
      }
    }
    _updateActiveLyricProgress(line, state) {
      const active = document.querySelector("#kLyrics .k-line.current");
      if (!active || !line) return;
      active.style.setProperty("--p", line.words && line.words.length ? state.wordProgress : state.lineProgress);
      const words = active.querySelectorAll(".k-word");
      if (!line.words || !line.words.length) return;
      words.forEach((word, index) => {
        const progress = index < state.wordIndex ? 1 : index > state.wordIndex ? 0 : state.wordProgress;
        word.style.setProperty("--p", progress);
      });
      const miniWords = document.querySelectorAll("#lyricCurrent .lyric-word");
      miniWords.forEach((word, index) => {
        const progress = index < state.wordIndex ? 1 : index > state.wordIndex ? 0 : state.wordProgress;
        word.style.setProperty("--p", progress);
      });
    }
    _updateLyrics(currentTime, frameOnly = false) {
      const lines = this._lyricsForCurrent();
      const state = this.lyricTracker.update(currentTime);
      const idx = state.index;
      if (state.lineChanged || idx !== this.currentLyricIndex) {
        this.currentLyricIndex = idx;
        const prev = idx > 0 ? lines[idx - 1] : null;
        const cur = idx >= 0 ? lines[idx] : { text: lines.length ? "Intro instrumental" : "Sin letras sincronizadas" };
        const next = idx >= 0 && idx < lines.length - 1 ? lines[idx + 1] : null;
        this._setKaraokeMini(prev, cur, next);
        this._renderKaraokeFullscreenLines(idx);
      }
      this._updateKaraokeProgress(currentTime);
      this._updateKaraokePause(currentTime, idx);
      if (idx >= 0) this._updateActiveLyricProgress(lines[idx], state);
      if (this.karaokeFx) this.karaokeFx.update(this.karaokeStyle, this.graph, this.isPlaying, global.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    }
    _setKaraokeMini(prev, cur, next) { const els=[document.getElementById("lyricPrev"),document.getElementById("lyricCurrent"),document.getElementById("lyricNext")]; [prev,cur,next].forEach((v,i)=>{this._renderLyricLine(els[i],v);els[i].classList.remove("lyric-swap");void els[i].offsetWidth;els[i].classList.add("lyric-swap");}); }
	    _applyKaraokeStyle(style) { const value = ["cinema", "neon", "kinetic", "guilloche"].includes(style) ? style : "cinema"; const ov = document.getElementById("karaokeOverlay"); this.karaokeStyle = value; ov.dataset.karaokeStyle = value; if (this.karaokeFx && typeof this.karaokeFx.setStyle === "function") this.karaokeFx.setStyle(value); document.querySelectorAll(".k-style-btn").forEach((button) => { const active = button.dataset.karaokeStyle === value; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); }); }
    setKaraokeStyle(style) { this._applyKaraokeStyle(style); S.set("karaokeStyle", this.karaokeStyle); }
    cycleKaraokeStyle() { const styles = ["cinema", "neon", "kinetic", "guilloche"]; const next = styles[(styles.indexOf(this.karaokeStyle) + 1) % styles.length]; this.setKaraokeStyle(next); }
    openKaraokeFullscreen() { const ov=document.getElementById("karaokeOverlay"); ov.classList.add("open"); this._applyKaraokeStyle(this.karaokeStyle); this._showKaraokeControls(); this._updateKaraokeFullscreen(); this._updateLyrics(this.audio.currentTime || 0); this._startLyricFrame(); }
    closeKaraokeFullscreen() { const ov=document.getElementById("karaokeOverlay"); if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.classList.remove("open"); const pause=document.getElementById("kPause"); if(pause){pause.classList.remove("show");pause.setAttribute("aria-hidden","true");} }
    toggleKaraokeFullscreen() { document.getElementById("karaokeOverlay").classList.contains("open") ? this.closeKaraokeFullscreen() : this.openKaraokeFullscreen(); }
    async toggleRealFullscreen() { const ov=document.getElementById("karaokeOverlay"); try { if(document.fullscreenElement) await document.exitFullscreen(); else await ov.requestFullscreen(); } catch(_) { AuraToast.show("Pantalla completa no disponible", "warn"); } }
    _updateKaraokeFullscreen() { const t=this.tracks[this.currentIndex], title=document.getElementById("kTitle"), artist=document.getElementById("kArtist"), art=document.getElementById("kArt"), bg=document.getElementById("kBg"); title.textContent=t?t.title:"—"; artist.textContent=t?t.artist:""; art.src=t&&t.cover?t.cover:""; art.style.display=t&&t.cover?"block":"none"; bg.style.backgroundImage=t&&t.cover?`url("${t.cover}")`:"none"; this._extractKaraokeAccent(t&&t.cover); this._renderKaraokeFullscreenLines(this.currentLyricIndex); }
    _extractKaraokeAccent(src){const root=document.getElementById("karaokeOverlay"); if(!src){root.style.setProperty("--k-accent","#ff5e7e");return;} const image=new Image(); image.onload=()=>{try{const canvas=document.createElement("canvas");canvas.width=24;canvas.height=24;const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0,24,24);const data=ctx.getImageData(0,0,24,24).data;let r=0,g=0,b=0,w=0;for(let i=0;i<data.length;i+=4){const a=data[i+3]/255, mx=Math.max(data[i],data[i+1],data[i+2]), mn=Math.min(data[i],data[i+1],data[i+2]);const sat=(mx-mn)/Math.max(1,mx), weight=a*(.35+sat);r+=data[i]*weight;g+=data[i+1]*weight;b+=data[i+2]*weight;w+=weight;}if(w)root.style.setProperty("--k-accent",`rgb(${Math.round(r/w)},${Math.round(g/w)},${Math.round(b/w)})`);}catch(_){}}; image.src=src; }
    _wordsForLine(line) { const text = String(line.text || "♪").trim(); if (line.words && line.words.length) return line.words.map((w) => ({ time: Number(w.time) || line.time, text: w.text })); const parts = text.split(/\s+/).filter(Boolean); if (!parts.length) return [{ time: line.time, end: line.end, text }]; const weights = parts.map((p) => Math.max(1, p.length)); const total = weights.reduce((a, b) => a + b, 0); let cursor = Number(line.time) || 0; const span = Math.max(.1, (Number(line.end) || cursor + 3) - cursor); return parts.map((word, i) => { const end = cursor + span * weights[i] / total; const out = { time: cursor, end, text: word }; cursor = end; return out; }); }
    _splitKaraokeVisualLines(lineElement) {
      const words = Array.from(lineElement.children);
      if (words.length < 2) return;
      const groups = [];
      words.forEach((word) => {
        const top = word.offsetTop;
        let group = groups[groups.length - 1];
        if (!group || Math.abs(group.top - top) > 1) {
          group = { top, words: [] };
          groups.push(group);
        }
        group.words.push(word);
      });
      if (groups.length < 2) return;
      groups.forEach((group) => {
        const row = document.createElement("span");
        row.className = "k-visual-line";
        group.words.forEach((word) => row.appendChild(word));
        lineElement.appendChild(row);
      });
    }
    _renderKaraokeFullscreenLines(currentIdx) { const wrap=document.getElementById("kLyrics"), lines=this._lyricsForCurrent(), key=`${this.currentIndex}:${lines.length}:${this.tracks[this.currentIndex]?.lyricsKey||""}`; if(!lines.length){ if(wrap.dataset.empty!="1"){wrap.dataset.empty="1";wrap.innerHTML="<div class=\"k-no-lyrics\">Sin letras sincronizadas<span class=\"hint\">Carga un archivo .lrc para disfrutar del karaoke de esta canción.</span><button class=\"k-control\" id=\"kLoadLrcInline\">Cargar .lrc</button></div>"; const b=document.getElementById("kLoadLrcInline"); if(b)b.addEventListener("click",()=>document.getElementById("karaokeLrcPicker").click());} return; } if(key!==this.karaokeDomKey||wrap.dataset.empty==="1"){ this.karaokeDomKey=key; wrap.dataset.empty="0"; wrap.innerHTML=""; lines.forEach((line,i)=>{const el=document.createElement("div");el.className="k-line";el.dataset.line=i;el.dataset.time=line.time;el.style.setProperty("--line-tilt",`${((i*17)%5)-2}deg`);el.tabIndex=0;el.innerHTML="";this._wordsForLine(line).forEach((w,j,words)=>{const span=document.createElement("span");span.className="k-word";span.dataset.time=w.time;span.dataset.end=w.end||words[j+1]?.time||line.end;span.textContent=w.text+(j<words.length-1?" ":"");el.appendChild(span);});wrap.appendChild(el);this._splitKaraokeVisualLines(el);}); } const els=wrap.querySelectorAll(".k-line"); els.forEach((el,i)=>{el.classList.toggle("current",i===currentIdx);el.classList.toggle("near",Math.abs(i-currentIdx)<=2&&i!==currentIdx);}); this._centerKaraokeLine(currentIdx); wrap.style.fontSize=`${this.karaokeFontSize}em`; }
    _renderKaraokeFullscreenLines(currentIdx) {
      const wrap = document.getElementById("kLyrics");
      const lines = this._lyricsForCurrent();
      const key = `${this.currentIndex}:${lines.length}:${this.tracks[this.currentIndex]?.lyricsKey || ""}`;
      if (!lines.length) {
        if (wrap.dataset.empty !== "1") {
          wrap.dataset.empty = "1";
          wrap.innerHTML = "<div class=\"k-no-lyrics\">Sin letras sincronizadas<span class=\"hint\">Carga un archivo .lrc para disfrutar del karaoke de esta canción.</span><button class=\"k-control\" id=\"kLoadLrcInline\">Cargar .lrc</button></div>";
          const button = document.getElementById("kLoadLrcInline");
          if (button) button.addEventListener("click", () => document.getElementById("karaokeLrcPicker").click());
        }
        return;
      }
      if (key !== this.karaokeDomKey || wrap.dataset.empty === "1") {
        this.karaokeDomKey = key;
        wrap.dataset.empty = "0";
        wrap.textContent = "";
        lines.forEach((line, i) => {
          const element = document.createElement("div");
          element.className = "k-line";
          element.dataset.line = i;
          element.dataset.time = line.time;
          element.style.setProperty("--line-tilt", `${((i * 17) % 5) - 2}deg`);
          element.tabIndex = 0;
          this._renderLyricLine(element, line, "k-word");
          const translation = element.querySelector(".lyric-translation");
          if (translation) translation.remove();
          if (line.words && line.words.length) this._splitKaraokeVisualLines(element);
          if (translation) element.appendChild(translation);
          wrap.appendChild(element);
        });
      }
      const elements = wrap.querySelectorAll(".k-line");
      elements.forEach((element, i) => {
        element.classList.toggle("current", i === currentIdx);
        element.classList.toggle("near", Math.abs(i - currentIdx) <= 2 && i !== currentIdx);
      });
      this._centerKaraokeLine(currentIdx);
      wrap.style.fontSize = `${this.karaokeFontSize}em`;
    }
    _centerKaraokeLine(idx){const viewport=document.getElementById("kLyricsViewport"), wrap=document.getElementById("kLyrics"), active=wrap.querySelector(`[data-line="${idx}"]`); if(!active)return; const y=active.offsetTop+active.offsetHeight/2; wrap.style.transform=`translate3d(0,${viewport.clientHeight/2-y}px,0)`;}
    _updateKaraokeProgress(time){const duration=this.audio.duration||0,pct=duration?time/duration*100:0; document.getElementById("kProgress").value=pct; document.getElementById("kCurrentTime").textContent=U.formatTime(time);document.getElementById("kTotalTime").textContent=U.formatTime(duration);document.getElementById("kPlay").textContent=this.isPlaying?"❚❚":"▶";}
    _updateKaraokePause(time,idx){const lines=this._lyricsForCurrent(), pause=document.getElementById("kPause"); if(!pause)return; const adjusted=Number(time)+this.lyricOffset, validTime=Number.isFinite(adjusted), next=idx>=0?lines[idx+1]:lines[0]; let gap=0; if(validTime&&next&&Number.isFinite(Number(next.time))){ if(idx<0) gap=Number(next.time)-adjusted; else { const line=lines[idx], lineTime=Number(line.time), nextTime=Number(next.time); if(Number.isFinite(lineTime)&&Number.isFinite(nextTime)){ const practicalEnd=Math.min(nextTime,lineTime+Math.max(1.5,Math.min(5,(line.text||"").length*.08))); gap=nextTime-practicalEnd; } } } const overlay=document.getElementById("karaokeOverlay"), show=!!(overlay&&overlay.classList.contains("open")&&this.isPlaying&&validTime&&lines.length&&((idx<0&&adjusted<Number(lines[0].time))||gap>5)); pause.classList.toggle("show",show); pause.setAttribute("aria-hidden",String(!show)); const label=document.getElementById("kPauseText"); if(label)label.textContent=""; }
    _showKaraokeControls(){const ov=document.getElementById("karaokeOverlay");ov.classList.remove("controls-hidden");clearTimeout(this.karaokeControlsTimer);this.karaokeControlsTimer=setTimeout(()=>ov.classList.add("controls-hidden"),3000);}
    adjustKaraokeFont(delta){this.karaokeFontSize=U.clamp(Math.round((this.karaokeFontSize+delta)*100)/100,.82,1.35);S.set("karaokeFontSize",this.karaokeFontSize);this._renderKaraokeFullscreenLines(this.currentLyricIndex);}
    async _loadCurrentLrc(file){if(!file||!this.tracks[this.currentIndex])return;try{const text=await file.text(), track=this.tracks[this.currentIndex];this.lrcMap.set(track.lyricsKey,text);track.activeLyricVariant="default";this._refreshTrackLyrics(track,AuraLRC.parse(text));await this._persistLocalLibrary();this.currentLyricIndex=-2;this.karaokeDomKey="";this._updateLyricVariantButton();this._updateKaraokeFullscreen();this._updateLyrics(this.audio.currentTime||0);AuraToast.show("Letras LRC cargadas","success");}catch(_){AuraToast.show("No se pudo leer el archivo LRC","error");}}
    adjustLyricOffset(delta, reset=false){const t=this.tracks[this.currentIndex], key=t&&t.lyricsKey; if(reset){this.lyricOffset=0;} else {this.lyricOffset=Math.round((this.lyricOffset+delta)*10)/10;} if(key){const map=S.get("lyricOffsets",{});map[key]=this.lyricOffset;S.set("lyricOffsets",map);} S.set("lyricOffset",this.lyricOffset);this.lyricTracker.setOffset(this.lyricOffset);this.lyricTracker.seek(this.audio.currentTime||0);document.getElementById("offsetValue").textContent=`${this.lyricOffset>=0?"+":""}${this.lyricOffset.toFixed(1)}s`;this.currentLyricIndex=-2;this._updateLyrics(this.audio.currentTime||0);}
    /* ---------------- Playlist save/load ---------------- */
    _savePlaylist() {
      if (!this.tracks.length) {
        AuraToast.show("Lista vacía", "warn");
        return;
      }
      const name = prompt("Nombre de la lista a guardar:", `Lista ${new Date().toLocaleDateString()}`);
      if (!name) return;
      const data = this.tracks.map((t) => ({
        name: t.name,
        title: t.title,
        artist: t.artist,
        album: t.album,
      }));
      const lists = S.get("playlists", {});
      lists[name] = { savedAt: Date.now(), tracks: data };
      S.set("playlists", lists);
      AuraToast.show(`Lista "${name}" guardada (metadatos)`, "success", 3500);
    }

    _loadPlaylistDialog() {
      const lists = S.get("playlists", {});
      const names = Object.keys(lists);
      if (!names.length) {
        AuraToast.show("No hay listas guardadas", "warn");
        return;
      }
      const choice = prompt(`Listas disponibles:\n\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nEscribe el número o nombre:`);
      if (!choice) return;
      let name = choice;
      const num = parseInt(choice, 10);
      if (!isNaN(num) && num > 0 && num <= names.length) name = names[num - 1];
      const pl = lists[name];
      if (!pl) {
        AuraToast.show("Lista no encontrada", "error");
        return;
      }
      AuraToast.show(`Lista "${name}" cargada. Recarga los archivos para reproducir.`, "info", 4000);
      // Note: actual files cannot be re-loaded from localStorage; this is metadata only
    }

    _exportPlaylist() {
      if (!this.tracks.length) {
        AuraToast.show("Lista vacía", "warn");
        return;
      }
      const m3u = ["#EXTM3U"];
      for (const t of this.tracks) {
        m3u.push(`#EXTINF:-1,${t.artist} - ${t.title}`);
        m3u.push(t.name);
      }
      const blob = new Blob([m3u.join("\n")], { type: "audio/mpegurl" });
      U.download(blob, `auraplay-${Date.now()}.m3u`);
      AuraToast.show("Lista exportada como .m3u", "success");
    }

    async _persistLocalLibrary() {
      try {
        const entries = this.tracks.map((t) => {
          const keys = this._lyricVariantKeys(t.lyricsKey || U.baseName(t.name));
          return {
            file: t.file,
            name: t.name,
            title: t.title,
            artist: t.artist,
            album: t.album,
            year: t.year,
            genre: t.genre,
            lyrics: t.lyrics || [],
            lyricsVariants: t.lyricsVariants || { default: t.lyrics || [], es: null },
            lyricsText: this.lrcMap.has(keys.defaultKey) ? this.lrcMap.get(keys.defaultKey) : null,
            lyricsEsText: this.lrcMap.has(keys.esKey) ? this.lrcMap.get(keys.esKey) : null,
            activeLyricVariant: t.activeLyricVariant || "default",
            lyricsKey: keys.defaultKey,
          };
        });
        await S.setLocal("library", { entries, currentIndex: this.currentIndex, savedAt: Date.now(), lyricsParserVersion: LYRICS_PARSER_VERSION });
      } catch (_) { AuraToast.show("No se pudo guardar la biblioteca local (espacio insuficiente)", "warn", 4000); }
    }

    async _restoreLocalLibrary() {
      try {
        const saved = await S.getLocal("library");
        if (!saved || !Array.isArray(saved.entries) || !saved.entries.length || this.tracks.length) return;
        if (saved.lyricsParserVersion !== LYRICS_PARSER_VERSION) {
          await S.removeLocal("library");
          AuraToast.show("La biblioteca local necesita recargarse para corregir la sincronización de letras", "info", 5000);
          return;
        }
        this._showLoading("Restaurando biblioteca local...");
        for (const item of saved.entries) {
          if (!item.file) continue;
          const file = item.file;
          const { picture } = await AuraMetadata.extractTags(file);
          const url = URL.createObjectURL(file);
          this.urls.add(url);
          if (picture) this.urls.add(picture);
          const key = U.baseName(file.name);
          const keys = this._lyricVariantKeys(item.lyricsKey || key);
          const hasDefaultText = typeof item.lyricsText === "string";
          const hasSpanishText = typeof item.lyricsEsText === "string";
          if (hasDefaultText) this.lrcMap.set(keys.defaultKey, item.lyricsText);
          if (hasSpanishText) this.lrcMap.set(keys.esKey, item.lyricsEsText);
          const legacyLyrics = Array.isArray(item.lyrics) ? item.lyrics : [];
          const restoredOriginal = hasDefaultText ? AuraLRC.parse(item.lyricsText) : AuraLRC.normalize(legacyLyrics);
          const restoredTranslation = hasSpanishText ? AuraLRC.parse(item.lyricsEsText) : (Array.isArray(item.lyricsVariants?.es) ? AuraLRC.normalize(item.lyricsVariants.es) : null);
          const variants = {
            default: restoredTranslation ? AuraLRC.attachTranslation(restoredOriginal, restoredTranslation) : restoredOriginal,
            es: restoredTranslation,
          };
          const activeVariant = item.activeLyricVariant === "es" && variants.es ? "es" : "default";
          this.tracks.push({ id: U.uid(), file, url, name: item.name || file.name, title: item.title || U.pickTitle({}, file.name), artist: item.artist || "Artista desconocido", album: item.album || "", year: item.year || "", genre: item.genre || "", cover: picture, lyrics: variants[activeVariant] || [], lyricsVariants: variants, activeLyricVariant: activeVariant, hasSpanishLyrics: !!variants.es, hasTranslation: !!(variants.default && variants.default.some((line) => Array.isArray(line.translations) && line.translations.length)), lyricsKey: keys.defaultKey });
        }
        const savedIndex = Number(S.get("currentTrack", saved.currentIndex || 0));
        this.currentIndex = Number.isInteger(savedIndex)
          ? Math.min(Math.max(0, savedIndex), this.tracks.length - 1)
          : 0;
        const restoredTrack = this.tracks[this.currentIndex];
        const offsets = S.get("lyricOffsets", {});
        const savedOffset = Number(S.get("lyricOffset", 0));
        this.lyricOffset = restoredTrack && Number.isFinite(Number(offsets[restoredTrack.lyricsKey]))
          ? Number(offsets[restoredTrack.lyricsKey])
          : (Number.isFinite(savedOffset) ? savedOffset : 0);
        this._syncLyricTracker(restoredTrack ? restoredTrack.lyrics : [], 0);
        document.getElementById("offsetValue").textContent = `${this.lyricOffset >= 0 ? "+" : ""}${this.lyricOffset.toFixed(1)}s`;
        this._hideLoading(); this._render();
        const position = Number(S.get("playbackPosition", 0)) || 0;
        if (this.currentIndex >= 0) {
          const audio = this.audio; audio.src = this.tracks[this.currentIndex].url;
          audio.addEventListener("loadedmetadata", () => { audio.currentTime = Math.min(position, audio.duration || position); }, { once: true });
          this._renderNowPlaying();
          this._updateLyrics(position);
        }
        this.lastFolderName = S.get("lastFolderName", "");
        if (this.tracks.length) AuraToast.show(`Biblioteca restaurada: ${this.tracks.length} pistas${this.lastFolderName ? ` · ${this.lastFolderName}` : ""}`, "success", 3500);
      } catch (_) { this._hideLoading(); }
    }

    _restoreSavedPlaylist() {
      const ofs = Number(S.get("lyricOffset", 0));
      const savedMuted = S.get("muted", false);
      this.muted = savedMuted === true || savedMuted === 1 || savedMuted === "1" || savedMuted === "true";
      if (!this.graph.ctx) this.audio.muted = this.muted;
      this.graph.setOutput(this.volume / 100, this.muted);
      const currentKey = this.tracks[this.currentIndex] && this.tracks[this.currentIndex].lyricsKey;
      const perTrack = S.get("lyricOffsets", {});
      this.lyricOffset = currentKey && Number.isFinite(Number(perTrack[currentKey]))
        ? Number(perTrack[currentKey])
        : (Number.isFinite(ofs) ? ofs : 0);
      document.getElementById("offsetValue").textContent = `${this.lyricOffset >= 0 ? "+" : ""}${this.lyricOffset.toFixed(1)}s`;
    }

    /* ---------------- UI updates ---------------- */
    _updatePlayButton() {
      const btn = document.getElementById("btnPlay");
      const playIcon = btn.querySelector(".icon-play");
      const pauseIcon = btn.querySelector(".icon-pause");
      if (this.isPlaying) {
        playIcon.style.display = "none";
        pauseIcon.style.display = "block";
        btn.setAttribute("aria-label", "Pausar");
      } else {
        playIcon.style.display = "block";
        pauseIcon.style.display = "none";
        btn.setAttribute("aria-label", "Reproducir");
      }
    }

    _updateArtSpinning() {
      const frame = document.getElementById("artFrame");
      if (this.isPlaying) {
        frame.classList.add("spinning");
        frame.classList.remove("paused");
      } else {
        // No quitar `spinning`: así el navegador conserva el frame actual de
        // la animación y la carátula no vuelve a su posición inicial.
        frame.classList.add("paused");
      }
    }

    _updateTransport() {
      const shuf = document.getElementById("btnShuffle");
      shuf.classList.toggle("active", this.shuffle);
      shuf.setAttribute("aria-pressed", String(this.shuffle));
      shuf.title = `Aleatorio: ${this.shuffle ? "activado" : "desactivado"} (S)`;

      const rep = document.getElementById("btnRepeat");
      const mode = Number(this.repeat);
      this.repeat = Number.isInteger(mode) && mode >= 0 && mode <= 2 ? mode : 0;
      if (mode !== this.repeat) S.set("repeat", this.repeat);
      rep.classList.remove("active");
      rep.classList.toggle("active", this.repeat !== 0);
      rep.setAttribute("aria-pressed", String(this.repeat !== 0));
      rep.setAttribute("data-repeat", String(this.repeat));
      rep.title = this.repeat === 0 ? "Repetir: desactivado (R)" : `Repetir: ${this.repeat === 1 ? "todas" : "una"} (R)`;
      rep.querySelector(".repeat-one").style.display = this.repeat === 2 ? "block" : "none";
      rep.querySelector(".repeat-all").style.display = this.repeat === 2 ? "none" : "block";
    }

    _updateMuteIcon() {
      const btn = document.getElementById("btnMute");
      const high = btn.querySelector(".vol-high");
      const low = btn.querySelector(".vol-low");
      const mute = btn.querySelector(".vol-mute");
      [high, low, mute].forEach((el) => (el.style.display = "none"));
      if (this.muted || this.volume === 0) mute.style.display = "block";
      else if (this.volume < 50) low.style.display = "block";
      else high.style.display = "block";
      btn.setAttribute("aria-pressed", String(this.muted));
      btn.title = this.muted ? "Activar sonido (M)" : "Silenciar (M)";
    }

    _showLoading(msg = "Cargando...") {
      const ov = document.getElementById("loadingOverlay");
      ov.classList.add("open");
      ov.querySelector(".loader-text").textContent = msg;
    }

    _hideLoading() {
      document.getElementById("loadingOverlay").classList.remove("open");
    }
  }

  global.AuraPlayer = Player;
})(window);


