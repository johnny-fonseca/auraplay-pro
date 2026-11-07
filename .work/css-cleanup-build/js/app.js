/* app.js — entry point */
(function () {
  function init() {
    const player = new window.AuraPlayer();
    window.AURA = player;
    window.AuraShortcuts.bind(player);
    // El DOM y los controles ya están montados; no esperar a que el motor de
    // audio se active, porque AudioContext solo puede iniciarse tras interacción.
    window.__auraReady = true;
    // Show a friendly toast
    setTimeout(() => {
      window.AuraToast.show("Bienvenido a AuraPlay Pro — arrastra archivos o pulsa H para ayuda", "info", 4500);
    }, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
