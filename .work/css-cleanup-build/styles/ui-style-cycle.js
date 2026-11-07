/* ==========================================================================
   AuraPlay Pro · ui-style-cycle.js  (versión de 8 modos)
   Ciclo circular: neu → skeuo → glass → clay → brutal → aurora → flat → bento → neu

   Fragmento NUEVO e integrable. Sustituye a la versión de 5 modos
   (ui-style-cycle.js anterior). No conoce tu código actual: si ya tienes una
   función que cambia de estilo, reutiliza su lógica dentro de applyMode /
   nextMode. No reimplementa los CSS de los otros modos.
   ========================================================================== */
(function () {
  'use strict';

  // ---- Configuración -------------------------------------------------------
  var STORAGE_KEY = 'ui-style';
  var MODES = ['neu', 'skeuo', 'glass', 'clay', 'brutal', 'aurora', 'flat', 'bento'];
  var DEFAULT_MODE = 'neu';

  // >>> CAMBIA ESTE SELECTOR por el del botón REAL de "estilo visual" <<<
  var BUTTON_SELECTOR = '#btnSurfaceStyle';

  var LABELS = {
    neu: 'Neumorfismo',
    skeuo: 'Skeuomorfismo',
    glass: 'Glassmorfismo',
    clay: 'Claymorfismo',
    brutal: 'Neubrutalismo',
    aurora: 'Aurora',
    flat: 'Diseño plano',
    bento: 'Bento'
  };

  // ---- Utilidades ----------------------------------------------------------
  function isValidMode(value) {
    return MODES.indexOf(value) !== -1;
  }

  function readStoredMode() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return isValidMode(stored) ? stored : DEFAULT_MODE;
    } catch (err) {
      return DEFAULT_MODE; // almacenamiento bloqueado o no disponible
    }
  }

  function saveMode(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (err) {
      /* sin persistencia: el modo sigue aplicándose en esta sesión */
    }
  }

  function nextMode(mode) {
    var index = MODES.indexOf(mode);
    return MODES[(index + 1) % MODES.length]; // bento → neu (circular)
  }

  // ---- Aplicar modo + accesibilidad ---------------------------------------
  function updateButton(button, mode) {
    if (!button) return;
    var message = 'Estilo visual: ' + LABELS[mode] +
      '. Activar para cambiar a ' + LABELS[nextMode(mode)] + '.';
    button.setAttribute('aria-label', message);
    button.setAttribute('title', message);
    // Semántica elegida: "pulsado" = hay un estilo distinto del predeterminado.
    // El modo exacto lo comunican aria-label y title.
    button.setAttribute('aria-pressed', String(mode !== DEFAULT_MODE));
  }

  function applyMode(mode, button) {
    document.documentElement.dataset.ui = mode; // <html data-ui="...">
    updateButton(button, mode);
  }

  // ---- Inicio --------------------------------------------------------------
  var current = readStoredMode();
  saveMode(current);        // normaliza un valor inválido guardado previamente
  applyMode(current, null); // aplica ya, antes de que el botón exista (evita parpadeo)

  function wireButton() {
    var button = document.querySelector(BUTTON_SELECTOR);
    if (!button) return;

    updateButton(button, current);

    // >>> AQUÍ se conecta el listener al botón real <<<
    button.addEventListener('click', function () {
      current = nextMode(current);
      saveMode(current);
      applyMode(current, button);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButton);
  } else {
    wireButton();
  }
})();
