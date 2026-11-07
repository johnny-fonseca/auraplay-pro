/* surfaceStyle.js — ciclo persistente entre los modos visuales. */
(() => {
  const KEY = "ui-style";
  const MODES = ["neu", "skeuo", "glass", "clay", "brutal", "aurora", "flat", "bento"];
  const root = document.documentElement;
  const button = document.getElementById("btnSurfaceStyle");
  const names = {
    neu: "Neumorfismo",
    skeuo: "Skeuomorfismo",
    glass: "Glassmorfismo",
    clay: "Claymorfismo",
    brutal: "Neubrutalismo",
    aurora: "Aurora",
    flat: "Diseño plano",
    bento: "Bento",
  };

  function apply(style) {
    if (!MODES.includes(style)) style = "neu";
    root.dataset.ui = style;
    if (button) {
      const next = MODES[(MODES.indexOf(style) + 1) % MODES.length];
      button.setAttribute("aria-pressed", String(style !== "neu"));
      button.setAttribute("aria-label", `Cambiar estilo de superficie; actual: ${names[style]}`);
      button.title = `Estilo de superficie: ${names[style]} (clic para ${names[next]})`;
    }
    try { localStorage.setItem(KEY, style); } catch (_) {}
  }

  apply(root.dataset.ui || "neu");
  if (button) button.addEventListener("click", () => {
    const index = MODES.indexOf(root.dataset.ui);
    apply(MODES[(index + 1) % MODES.length]);
  });
})();
