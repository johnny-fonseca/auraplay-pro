/* shortcuts.js — atajos de teclado (versión robusta) */
(function (global) {
  "use strict";

  const SEEK_STEP = 5;
  const SEEK_STEP_SHIFT = 10;
  const LYRIC_OFFSET_STEP = 0.5;

  // Roles ARIA que equivalen a campos de texto.
  const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

  // Tabla de atajos: code -> { method, args(e), repeat, prevent, when(e) }
  //  - repeat:  permitir auto-repetición al mantener la tecla pulsada
  //  - prevent: llamar a preventDefault() (evita scroll, foco, etc.)
  //  - when:    condición extra opcional
  const KEYMAP = {
    Space:        { method: "togglePlay", repeat: false, prevent: true },
    ArrowRight:   { method: "seek", args: (e) => [e.shiftKey ? SEEK_STEP_SHIFT : SEEK_STEP], repeat: true, prevent: true },
    ArrowLeft:    { method: "seek", args: (e) => [e.shiftKey ? -SEEK_STEP_SHIFT : -SEEK_STEP], repeat: true, prevent: true },
    ArrowUp:      { method: "prev", repeat: false, prevent: true },
    ArrowDown:    { method: "next", repeat: false, prevent: true },
    KeyM:         { method: "toggleMute", repeat: false },
    KeyS:         { method: "toggleShuffle", repeat: false },
    KeyR:         { method: "cycleRepeat", repeat: false },
    KeyV:         { method: "toggleVisualizer", repeat: false },
    KeyK:         { method: "toggleKaraokeFullscreen", repeat: false },
    KeyC:         { method: "cycleKaraokeStyle", repeat: false },
    KeyT:         { method: "toggleTheme", repeat: false },
    KeyH:         { method: "toggleHelp", repeat: false },
    Slash:        { method: "toggleHelp", repeat: false, when: (e) => e.shiftKey },
    BracketLeft:  { method: "adjustLyricOffset", args: () => [-LYRIC_OFFSET_STEP], repeat: true },
    BracketRight: { method: "adjustLyricOffset", args: () => [LYRIC_OFFSET_STEP], repeat: true },
    Escape:       { method: "closeOverlays", repeat: false },
  };

  const HELP_ACTION = KEYMAP.KeyH;
  const warned = new Set();

  function warnOnce(key, ...msg) {
    if (warned.has(key)) return;
    warned.add(key);
    try { console.warn("[AuraShortcuts]", ...msg); } catch (_) { /* consola no disponible */ }
  }

  // ¿El foco está en un control donde el usuario escribe / usa sus propias teclas?
  function isBlockedTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    const tag = String(target.tagName || "").toLowerCase();

    if (tag === "textarea" || tag === "select") return true;

    if (tag === "input") {
      // El slider de progreso del karaoke delega sus flechas en este módulo.
      const isKaraokeProgress = target.type === "range" && target.id === "kProgress";
      return !isKaraokeProgress;
    }

    if (target.isContentEditable) return true;

    const role = typeof target.getAttribute === "function" ? target.getAttribute("role") : null;
    return !!role && EDITABLE_ROLES.has(role.toLowerCase());
  }

  function resolveAction(e) {
    // "?" según el layout del teclado (ES, LATAM, etc. lo ponen en otra tecla).
    if (e.key === "?") return HELP_ACTION;
    const action = Object.prototype.hasOwnProperty.call(KEYMAP, e.code) ? KEYMAP[e.code] : null;
    if (!action) return null;
    if (typeof action.when === "function" && !action.when(e)) return null;
    return action;
  }

  function runAction(player, action, e) {
    const fn = player[action.method];
    if (typeof fn !== "function") {
      warnOnce(action.method, `player.${action.method}() no existe; atajo ignorado.`);
      return;
    }
    try {
      const args = typeof action.args === "function" ? action.args(e) : [];
      fn.apply(player, args);
    } catch (err) {
      // Un fallo del reproductor nunca debe tumbar el listener de atajos.
      try { console.error(`[AuraShortcuts] Error en player.${action.method}():`, err); } catch (_) { /* noop */ }
    }
  }

  let unbindCurrent = null;

  function bind(player) {
    if (typeof document === "undefined") return function noop() {};
    if (!player || (typeof player !== "object" && typeof player !== "function")) {
      warnOnce("badplayer", "bind() requiere un objeto player válido.");
      return function noop() {};
    }

    // Idempotente: si ya había atajos enlazados, se reemplazan (sin duplicar).
    if (unbindCurrent) unbindCurrent();

    let swallowSpaceKeyup = false;

    function onKeyDown(e) {
      try {
        if (!e || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;

        // Respetar atajos del navegador/sistema (Ctrl+Shift+R, Cmd+R, Alt+Flecha...).
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // AltGr (Windows) se reporta como Ctrl+Alt; getModifierState lo cubre igualmente.
        if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return;

        if (isBlockedTarget(e.target)) return;

        const action = resolveAction(e);
        if (!action) return;

        if (action.prevent) e.preventDefault();

        // Evita que mantener pulsada una tecla dispare toggles repetidos.
        if (e.repeat && !action.repeat) return;

        // Espacio sobre un botón con foco: el navegador haría "click" en keyup.
        if (e.code === "Space") swallowSpaceKeyup = true;

        runAction(player, action, e);
      } catch (err) {
        try { console.error("[AuraShortcuts] Error inesperado:", err); } catch (_) { /* noop */ }
      }
    }

    function onKeyUp(e) {
      if (swallowSpaceKeyup && e && e.code === "Space") {
        swallowSpaceKeyup = false;
        try { e.preventDefault(); } catch (_) { /* noop */ }
      }
    }

    function resetState() { swallowSpaceKeyup = false; }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    if (typeof window !== "undefined") window.addEventListener("blur", resetState);

    let active = true;
    function unbind() {
      if (!active) return;
      active = false;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      if (typeof window !== "undefined") window.removeEventListener("blur", resetState);
      if (unbindCurrent === unbind) unbindCurrent = null;
    }

    unbindCurrent = unbind;
    return unbind;
  }

  function unbind() {
    if (unbindCurrent) unbindCurrent();
  }

  const api = { bind, unbind };

  if (global) global.AuraShortcuts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);