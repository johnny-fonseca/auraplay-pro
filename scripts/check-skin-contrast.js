'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const skinSource = fs.readFileSync(path.join(root, 'js', 'skin.js'), 'utf8');
const catalogMatch = skinSource.match(/const SKINS\s*=\s*\[([^\]]+)\]/);
if (!catalogMatch) throw new Error('No se pudo leer el catálogo SKINS desde js/skin.js.');
const skins = [...catalogMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
const themes = ['dark', 'light'];
const semanticPairs = [
  ['texto principal / canvas', 'color-text-primary', 'color-canvas', 4.5],
  ['texto secundario / canvas', 'color-text-secondary', 'color-canvas', 4.5],
  ['texto muted / canvas', 'color-text-muted', 'color-canvas', 4.5],
  ['texto principal / surface-bg', 'color-text-primary', 'surface-bg', 4.5],
  ['texto secundario / surface-bg', 'color-text-secondary', 'surface-bg', 4.5],
  ['texto muted / surface-bg', 'color-text-muted', 'surface-bg', 4.5],
  ['on-accent / accent', 'color-on-accent', 'color-accent', 4.5],
  ['accent / canvas (indicador)', 'color-accent', 'color-canvas', 3],
  ['focus / canvas', 'color-focus', 'color-canvas', 3],
  ['focus / surface-bg', 'color-focus', 'surface-bg', 3],
];
const declarationsPattern = /--([\w-]+)\s*:\s*([^;}]+)\s*;?/g;

function declarations(css) {
  const result = {};
  for (const match of css.matchAll(declarationsPattern)) result[match[1]] = match[2].trim();
  return result;
}

function matchingBlocks(css, skin) {
  const result = [];
  const selectorPattern = /:root\s*\[\s*data-skin\s*=\s*["']([^"']+)["']\s*\]([^{}]*)\{/g;
  let match;
  while ((match = selectorPattern.exec(css))) {
    if (match[1] !== skin) continue;
    const open = selectorPattern.lastIndex - 1;
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth > 0) {
      if (css[close] === '{') depth += 1;
      else if (css[close] === '}') depth -= 1;
      close += 1;
    }
    if (depth !== 0) throw new Error(`Bloque CSS sin cerrar en skins/${skin}.css.`);
    const prelude = match[2].replace(/:not\([^)]*\)/g, '');
    const isLight = /\[\s*data-theme\s*=\s*["']light["']\s*\]/.test(prelude);
    result.push({ isLight, declarations: declarations(css.slice(open + 1, close - 1)) });
    selectorPattern.lastIndex = close;
  }
  return result;
}

function parseColor(value, variables, seen = new Set()) {
  if (!value) return null;
  const reference = value.match(/^var\(\s*--([\w-]+)\s*(?:,\s*([^)]*))?\)$/);
  if (reference) {
    if (seen.has(reference[1])) return null;
    const next = new Set(seen);
    next.add(reference[1]);
    return parseColor(variables[reference[1]] || reference[2], variables, next);
  }

  let match = value.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((digit) => digit + digit).join('');
    return {
      rgb: [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)),
      alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (match) {
    const alpha = match[4]
      ? (match[4].endsWith('%') ? parseFloat(match[4]) / 100 : Number(match[4]))
      : 1;
    return { rgb: [1, 2, 3].map((index) => Math.round(Number(match[index]))), alpha };
  }
  if (value === 'white') return { rgb: [255, 255, 255], alpha: 1 };
  if (value === 'black') return { rgb: [0, 0, 0], alpha: 1 };
  return null;
}

function composite(foreground, background) {
  const alpha = foreground.alpha ?? 1;
  return foreground.rgb.map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha)));
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function findDefaultTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const match = clean.match(/:root\s*\{([\s\S]*?)\}/);
  if (!match) throw new Error('No se encontró :root con fallbacks en css/skin-contract.css.');
  return declarations(match[1]);
}

const contract = fs.readFileSync(path.join(root, 'css', 'skin-contract.css'), 'utf8');
const defaults = findDefaultTokens(contract);
const failures = [];
const unresolved = [];
const rows = [];

for (const skin of skins) {
  const file = path.join(root, 'skins', `${skin}.css`);
  if (!fs.existsSync(file)) {
    unresolved.push(`${skin}: falta skins/${skin}.css`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = matchingBlocks(source, skin);
  for (const theme of themes) {
    const variables = { ...defaults };
    for (const block of blocks) {
      if (!block.isLight || theme === 'light') Object.assign(variables, block.declarations);
    }

    const resolved = (name) => parseColor(variables[name], variables);
    const canvas = resolved('color-canvas');
    const surface = resolved('surface-bg');
    if (!canvas) {
      unresolved.push(`${skin}/${theme}: no se resuelve --color-canvas (${variables['color-canvas'] || 'vacío'}).`);
      continue;
    }
    const surfaceBackground = surface ? composite(surface, canvas.rgb) : canvas.rgb;
    const row = { skin, theme, minText: Infinity, onAccent: null, focus: null };

    for (const [label, foregroundName, backgroundName, threshold] of semanticPairs) {
      const foreground = resolved(foregroundName);
      const background = backgroundName === 'color-canvas'
        ? canvas
        : backgroundName === 'surface-bg'
          ? { rgb: surfaceBackground, alpha: 1 }
          : resolved(backgroundName);
      if (!foreground || !background) {
        unresolved.push(`${skin}/${theme}: no se resuelve ${label} (${variables[foregroundName] || 'vacío'} / ${variables[backgroundName] || 'vacío'}).`);
        continue;
      }
      const foregroundRgb = foreground.alpha < 1 ? composite(foreground, background.rgb) : foreground.rgb;
      const value = contrast(foregroundRgb, background.rgb);
      if (label.startsWith('texto ')) row.minText = Math.min(row.minText, value);
      if (label === 'on-accent / accent') row.onAccent = value;
      if (label === 'focus / canvas') row.focus = value;
      if (value + 1e-8 < threshold) {
        failures.push({ skin, theme, pair: label, contrast: Number(value.toFixed(2)), required: threshold });
      }
    }
    rows.push(row);
  }
}

console.log('Contraste de tokens semánticos (WCAG): 4.5:1 texto normal; 3:1 indicador/acento.');
console.log('Nota: los controles deshabilitados no se usan como criterio de fallo; WCAG exime controles inactivos.');
console.log('Skin      Tema   Texto mínimo   On-accent   Foco');
for (const row of rows) {
  const text = Number.isFinite(row.minText) ? `${row.minText.toFixed(2)}:1` : 'n/d';
  const accent = row.onAccent === null ? 'n/d' : `${row.onAccent.toFixed(2)}:1`;
  const focus = row.focus === null ? 'n/d' : `${row.focus.toFixed(2)}:1`;
  console.log(`${row.skin.padEnd(9)} ${row.theme.padEnd(6)} ${text.padStart(12)} ${accent.padStart(11)} ${focus.padStart(8)}`);
}
if (failures.length) {
  console.log('\nFALLOS:');
  for (const item of failures) console.log(`- ${item.skin}/${item.theme}: ${item.pair} ${item.contrast}:1 (mínimo ${item.required}:1)`);
}
if (unresolved.length) {
  console.log('\nNO RESUELTOS:');
  for (const item of unresolved) console.log(`- ${item}`);
}
console.log(`\nResumen: ${rows.length}/${skins.length * themes.length} combinaciones calculadas; ${failures.length} fallos de contraste; ${unresolved.length} valores no resolubles.`);
if (rows.length !== skins.length * themes.length || failures.length || unresolved.length) process.exitCode = 1;
