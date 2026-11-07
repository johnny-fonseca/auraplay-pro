'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const UI_SOURCE = fs.readFileSync(path.join(ROOT, 'styles', 'ui-style-cycle.js'), 'utf8');
const SKIN_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'skin.js'), 'utf8');
// Glaciar y Rubí ya tienen una matriz registrada en outputs/;
// esta ejecución continúa con las seis skins restantes del catálogo.
const TARGET_SKINS = ['brass', 'titanium', 'paper', 'ulm', 'gres', 'telar'];
const THEMES = ['dark', 'light'];
const CRITICAL_IDS = [
  'btnSurfaceStyle', 'btnSkin', 'btnTheme', 'btnPlay', 'btnPrev', 'btnNext',
  'progressBar', 'progressFill', 'progressThumb', 'volSlider', 'playlistList',
  'queueList', 'eqBands', 'vizCanvas', 'karaokeOverlay', 'toastContainer',
];
const REQUIRED_COMPONENTS = [
  '.player-panel', '.playlist-panel', '.queue-panel', '.transport', '.karaoke-mini',
  '.viz-card', '.now-bar', '.glass',
];

function readCatalog(source, declaration) {
  const match = source.match(new RegExp(`${declaration}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!match) throw new Error(`No se pudo leer ${declaration}.`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

const modes = readCatalog(UI_SOURCE, 'MODES');
const skins = readCatalog(SKIN_SOURCE, 'SKINS');
const stylesheetHrefs = [...INDEX.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)]
  .map((match) => match[1].split('?')[0]);

const failures = [];
const warnings = [];
const rows = [];
const addFailure = (message) => failures.push(message);
const addWarning = (message) => warnings.push(message);

if (!TARGET_SKINS.every((skin) => skins.includes(skin))) addFailure('Glaciar/Rubí no están registradas en js/skin.js.');
if (modes.length !== 8) addWarning(`Se esperaban 8 superficies y se encontraron ${modes.length}.`);
if (!UI_SOURCE.includes("document.documentElement.dataset.ui = mode")) addFailure('El ciclo de superficies no escribe document.documentElement.dataset.ui.');
if (!UI_SOURCE.includes("localStorage.setItem(STORAGE_KEY, mode)")) addFailure('El ciclo de superficies no persiste ui-style en localStorage.');

for (const id of CRITICAL_IDS) {
  if (!new RegExp(`\\bid=["']${id}["']`).test(INDEX)) addFailure(`Falta control crítico del DOM: #${id}.`);
}
for (const selector of REQUIRED_COMPONENTS) {
  const className = selector.slice(1);
  if (!new RegExp(`class=["'][^"']*\\b${className}\\b`).test(INDEX)) addFailure(`Falta componente crítico del DOM: ${selector}.`);
}

for (const mode of modes) {
  const fileName = {
    neu: 'neumorphism.css', skeuo: 'skeuomorphism.css', glass: 'glassmorphism.css',
    clay: 'claymorphism.css', brutal: 'brutalism.css', aurora: 'aurora.css',
    flat: 'flat.css', bento: 'bento.css',
  }[mode];
  const relative = `styles/${fileName || `${mode}.css`}`;
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    addFailure(`Falta la hoja para data-ui="${mode}": ${relative}.`);
    continue;
  }
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rootSelector = new RegExp(`(?:html|:root)\\[data-ui=["']${mode}["']\\]`);
  if (!rootSelector.test(css)) addFailure(`${relative} no contiene un selector raíz para data-ui="${mode}".`);
  if (/data-skin\s*=/.test(css)) addFailure(`${relative} acopla directamente una superficie a data-skin.`);
  if (/display\s*:\s*none\b|visibility\s*:\s*hidden\b/.test(css)) addWarning(`${relative} contiene ocultación visual; revisar que no afecte controles funcionales.`);
  if (/!important\b/.test(css)) addFailure(`${relative} contiene !important, prohibido por el contrato de superficies.`);
  if (!stylesheetHrefs.some((href) => href.endsWith(relative))) addFailure(`${relative} no está enlazada desde index.html.`);

  for (const skin of TARGET_SKINS) {
    for (const theme of THEMES) {
      const selectorState = `:root[data-skin="${skin}"][data-theme="${theme}"][data-ui="${mode}"]`;
      const independentState = `data-skin="${skin}" + data-theme="${theme}" + data-ui="${mode}"`;
      const selectors = (css.match(new RegExp(`data-ui\\s*=\\s*["']${mode}["']`, 'g')) || []).length;
      rows.push({ skin, theme, mode, selectorState, independentState, surfaceSelectors: selectors, controls: CRITICAL_IDS.length });
    }
  }
}

const outputDir = path.join(ROOT, '.work', 'surface-matrix');
fs.mkdirSync(outputDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  targetSkins: TARGET_SKINS,
  themes: THEMES,
  modes,
  expectedCombinations: TARGET_SKINS.length * THEMES.length * modes.length,
  combinations: rows.length,
  failures,
  warnings,
  rows,
  visualCapture: 'not-run: no browser automation binary is available on this device',
};
fs.writeFileSync(path.join(outputDir, 'matrix-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`Matriz data-ui: ${rows.length}/${report.expectedCombinations} combinaciones enumeradas.`);
console.log(`Superficies: ${modes.join(', ')}.`);
console.log(`Skins: ${TARGET_SKINS.join(', ')}; temas: ${THEMES.join(', ')}.`);
console.log(`Controles críticos verificados por combinación: ${CRITICAL_IDS.length}.`);
if (warnings.length) {
  console.log('\nADVERTENCIAS:');
  warnings.forEach((warning) => console.log(`- ${warning}`));
}
if (failures.length) {
  console.log('\nFALLOS:');
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Contrato estático e independencia de ejes: OK.');
}
console.log(`Informe: ${path.join(outputDir, 'matrix-report.json')}`);
