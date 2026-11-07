/* visualizer.js — fachada de compatibilidad (opcional)
 *
 * Mantiene exactamente la API pública anterior:
 *   new AuraVisualizer(canvas, audioGraph)
 *   .setStyle(key) · .setSensitivity(v) · .start() · .stop(immediate) · .clear()
 *   window.AURA_VIZ_STYLES
 *
 * No dibuja nada por sí misma: delega en el estilo activo, que vive en su propio
 * archivo independiente (visualizers/<estilo>.js) y se registra en
 * window.AuraVisualizerStyles. Cada estilo funciona también sin esta fachada.
 *
 * Claves públicas:
 *   bars       → visualizers/bars.js       Ferrofluido líquido
 *   coverAura  → visualizers/coverAura.js  Aurora cromática
 *   circular   → visualizers/circular.js   Reactor espectral
 *   particles  → visualizers/particles.js  Nebulosa de partículas
 *   tunnel     → visualizers/tunnel.js     Túnel hiperespacial
 *   mirror     → visualizers/mirror.js     Mandala caleidoscopio
 *   prism      → visualizers/prism.js      Prisma cristalino
 *   halo       → visualizers/halo.js       Halo osciloscópico
 *   mycelium   → visualizers/mycelium.js   Micelio bioluminiscente
 *   capsules   → visualizers/auraMusicSigns.js Constelación musical
 *   pebbles    → visualizers/Pebbles.js   Mosaico de guijarros
 *   relief     → js/aurarelief.js         Relieve estratificado
 */
(function (global) {
  "use strict";

  const STYLES = ["bars", "coverAura", "circular", "particles", "tunnel", "mirror", "prism", "halo", "mycelium", "capsules", "pebbles", "relief"];
  const DEFAULT_SENSITIVITY = 0.7;

  class Visualizer {
    constructor(canvas, audioGraph) {
      this.canvas = canvas;
      this.graph = audioGraph;
      this.style = "bars";
      this.impl = null;
      this._sens = null;
      this._mount("bars");
    }

    get sensitivity() {
      return this._sens === null ? DEFAULT_SENSITIVITY : this._sens;
    }

    get running() {
      return !!this.impl && !!(this.impl.running || this.impl._running || this.impl.isRunning);
    }

    /* ───────────────────────── API pública ───────────────────────── */

    setStyle(style) {
      if (!STYLES.includes(style)) return;
      this.style = style;
      this._mount(style);
    }

    setSensitivity(v) {
      if (!Number.isFinite(v)) return;
      this._sens = Math.max(0.4, Math.min(1.2, v));
      if (this.impl) this.impl.setSensitivity(this._sens);
    }

    start() { if (this.impl) this.impl.start(); }

    stop(immediate = false) { if (this.impl) this.impl.stop(immediate); }

    clear() { if (this.impl) this.impl.clear(); }

    destroy() {
      if (this.impl) this.impl.destroy();
      this.impl = null;
    }

    /* ───────────────────────── interno ───────────────────────── */

    // Sustituye la instancia activa conservando ejecución, fundido y sensibilidad.
    _mount(style) {
      const registry = global.AuraVisualizerStyles || {};
      const Ctor = registry[style];
      if (typeof Ctor !== "function") {
        console.warn(`[Visualizer] El estilo "${style}" no está cargado (falta visualizers/${style}.js).`);
        return;
      }
      const prev = this.impl;
      const next = new Ctor(this.canvas, this.graph);
      if (this._sens !== null) next.setSensitivity(this._sens);
      if (prev) {
        const wasRunning = !!(prev.running || prev._running || prev.isRunning);
        prev.destroy();
        this.impl = next;
        if (wasRunning) next.start();
        return;
      }
      this.impl = next;
    }
  }

  // Los módulos nuevos mantienen su registro histórico en AuraPlayVisualizers;
  // aquí se exponen también bajo el contrato moderno de la aplicación.
  const legacy = global.AuraPlayVisualizers || {};
  global.AuraVisualizerStyles = global.AuraVisualizerStyles || {};
  Object.assign(global.AuraVisualizerStyles, {
    capsules: legacy.capsules,
    pebbles: legacy.pebbles,
    relief: legacy.relief
  });

  global.AuraVisualizer = Visualizer;
  global.AURA_VIZ_STYLES = STYLES;
})(window);
