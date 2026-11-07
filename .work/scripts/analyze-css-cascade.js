'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const roots = ['css', 'skins', 'styles', 'fonts', 'karaoke', 'remote'];
const layerNames = ['base', 'theme', 'skin', 'surface', 'finish'];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.toLowerCase().endsWith('.css')) files.push(full);
  }
}
for (const dir of roots) walk(path.join(root, dir));

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function splitTopLevel(text, delimiter = ',') {
  const out = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') round += 1;
    else if (c === ')') round = Math.max(0, round - 1);
    else if (c === '[') square += 1;
    else if (c === ']') square = Math.max(0, square - 1);
    else if (c === delimiter && round === 0 && square === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

function maxSpecificity(items) {
  return items.reduce((best, item) => compareSpec(item, best) > 0 ? item : best, [0, 0, 0]);
}
function compareSpec(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function addSpec(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function readIdent(text, start) {
  let i = start;
  while (i < text.length) {
    if (/[\w-]/.test(text[i]) || text.charCodeAt(i) >= 128) i += 1;
    else if (text[i] === '\\' && i + 1 < text.length) i += 2;
    else break;
  }
  return i;
}
function matchingParen(text, open) {
  let depth = 1;
  let quote = '';
  for (let i = open + 1; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return i;
  }
  return text.length - 1;
}
function specificity(selector) {
  let result = [0, 0, 0];
  for (let i = 0; i < selector.length;) {
    const c = selector[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '#') { result[0] += 1; i = readIdent(selector, i + 1); continue; }
    if (c === '.') { result[1] += 1; i = readIdent(selector, i + 1); continue; }
    if (c === '[') {
      result[1] += 1;
      let j = i + 1; let quote = '';
      for (; j < selector.length; j += 1) {
        if (quote) { if (selector[j] === '\\') j += 1; else if (selector[j] === quote) quote = ''; }
        else if (selector[j] === '"' || selector[j] === "'") quote = selector[j];
        else if (selector[j] === ']') break;
      }
      i = j + 1; continue;
    }
    if (c === ':') {
      const isElement = selector[i + 1] === ':';
      i += isElement ? 2 : 1;
      const start = i;
      i = readIdent(selector, i);
      const name = selector.slice(start, i).toLowerCase();
      if (selector[i] === '(') {
        const end = matchingParen(selector, i);
        const args = selector.slice(i + 1, end);
        if (isElement) result[2] += 1;
        else if (name === 'where') { /* zero specificity */ }
        else if (name === 'is' || name === 'not' || name === 'has' || name === 'matches' || name === 'any') result = addSpec(result, maxSpecificity(splitTopLevel(args).map(specificity)));
        else if (name === 'nth-child' || name === 'nth-last-child') {
          result[1] += 1;
          const ofMatch = args.match(/\s+of\s+/i);
          if (ofMatch) result = addSpec(result, maxSpecificity(splitTopLevel(args.slice(ofMatch.index + ofMatch[0].length)).map(specificity)));
        } else result[1] += 1;
        i = end + 1; continue;
      }
      if (isElement || ['before', 'after', 'first-line', 'first-letter'].includes(name)) result[2] += 1;
      else result[1] += 1;
      continue;
    }
    if (c === '*' || c === '|' || /\s/.test(c) || /[>+~,]/.test(c)) { i += 1; continue; }
    if (/[\w-]/.test(c) || c.charCodeAt(i) >= 128) {
      const end = readIdent(selector, i);
      // Identifiers in selector position are type selectors, including namespace-qualified names.
      result[2] += 1;
      i = end; continue;
    }
    i += 1;
  }
  return result;
}
function findBlockEnd(text, open) {
  let depth = 1;
  let quote = '';
  for (let i = open + 1; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return i;
  }
  return text.length - 1;
}
function parseRules(source, layer, file, rules) {
  let i = 0;
  while (i < source.length) {
    while (i < source.length && (/[\s;]/.test(source[i]) || source[i] === '}')) i += 1;
    if (i >= source.length) break;
    const start = i;
    let round = 0; let square = 0; let quote = '';
    while (i < source.length) {
      const c = source[i];
      if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '(') round += 1;
      else if (c === ')') round = Math.max(0, round - 1);
      else if (c === '[') square += 1;
      else if (c === ']') square = Math.max(0, square - 1);
      else if (c === '{' && round === 0 && square === 0) break;
      else if (c === ';' && round === 0 && square === 0) break;
      i += 1;
    }
    if (i >= source.length) break;
    const prelude = source.slice(start, i).trim();
    if (source[i] === ';') { i += 1; continue; }
    const close = findBlockEnd(source, i);
    const inner = source.slice(i + 1, close);
    if (prelude.startsWith('@')) {
      if (!/^@(?:-[\w]+-)?keyframes\b/i.test(prelude) && !/^@font-face\b/i.test(prelude) && !/^@page\b/i.test(prelude)) parseRules(inner, layer, file, rules);
    } else if (prelude) {
      const selectors = splitTopLevel(prelude).map((selector) => ({ selector, spec: specificity(selector) }));
      rules.push({ layer, file, selectors });
    }
    i = close + 1;
  }
}
function specificityKey(s) { return `${s[0]},${s[1]},${s[2]}`; }
function esc(value) { return String(value).replaceAll('|', '\\|').replaceAll('\n', ' '); }

const allRules = [];
const fileRows = [];
const errors = [];
for (const file of files.sort()) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const layerMatch = source.match(/^\s*@layer\s+(\w+)\s*\{/);
  if (!layerMatch || !layerNames.includes(layerMatch[1])) { errors.push(`${relative}: capa ausente o desconocida`); continue; }
  const layer = layerMatch[1];
  const close = findBlockEnd(source, source.indexOf('{'));
  const rules = [];
  parseRules(source.slice(source.indexOf('{') + 1, close), layer, relative, rules);
  allRules.push(...rules);
  const selectors = rules.flatMap((rule) => rule.selectors.map((item) => ({ ...item, rule })));
  const histogram = new Map();
  for (const item of selectors) histogram.set(specificityKey(item.spec), (histogram.get(specificityKey(item.spec)) || 0) + 1);
  fileRows.push({ relative, layer, ruleCount: rules.length, selectorCount: selectors.length, histogram, selectors });
}
if (errors.length) throw new Error(errors.join('\n'));

const output = [];
output.push('# Informe de distribución de selectores y especificidad por capa CSS');
output.push('');
output.push(`Generado automáticamente desde ${files.length} hojas fuente CSS bajo \`css/\`, \`skins/\`, \`styles/\`, \`fonts/\`, \`karaoke/\` y \`remote/\`. Se analizaron ${allRules.length} reglas de estilo y ${allRules.reduce((sum, rule) => sum + rule.selectors.length, 0)} ramas selectoras. La especificidad se presenta como (ID, clase/atributo/pseudoclase, tipo/pseudoelemento).`);
output.push('');
output.push('## Resumen global');
output.push('');
output.push('| Capa | Hojas | Reglas | Selectores (ramas) | Promedio (ID, clase, tipo) | Máximo observado |');
output.push('|---|---:|---:|---:|---:|---|');
for (const layer of layerNames) {
  const subset = fileRows.filter((row) => row.layer === layer);
  const sels = subset.flatMap((row) => row.selectors);
  if (!sels.length) continue;
  const sums = sels.reduce((a, item) => a.map((n, i) => n + item.spec[i]), [0, 0, 0]);
  const max = sels.reduce((a, item) => compareSpec(item.spec, a.spec) > 0 ? item : a, sels[0]);
  output.push(`| ${layer} | ${subset.length} | ${subset.reduce((n, row) => n + row.ruleCount, 0)} | ${sels.length} | (${sums.map((n) => (n / sels.length).toFixed(2)).join(', ')}) | \`${max.spec.join(',')}\` · \`${esc(max.selector)}\` |`);
}
output.push('');
output.push('## Histograma de especificidad por capa');
output.push('');
output.push('Cada selector separado por coma cuenta como una rama. Los grupos con cero selectores no se muestran.');
output.push('');
for (const layer of layerNames) {
  const sels = fileRows.filter((row) => row.layer === layer).flatMap((row) => row.selectors);
  if (!sels.length) continue;
  const hist = new Map();
  for (const { spec } of sels) hist.set(specificityKey(spec), (hist.get(specificityKey(spec)) || 0) + 1);
  output.push(`### \`@layer ${layer}\``);
  output.push('');
  output.push('| Especificidad | Selectores | Proporción |');
  output.push('|---|---:|---:|');
  for (const [key, count] of [...hist.entries()].sort((a, b) => compareSpec(a[0].split(',').map(Number), b[0].split(',').map(Number)))) output.push(`| (${key}) | ${count} | ${(count * 100 / sels.length).toFixed(1)}% |`);
  output.push('');
}
output.push('## Desglose por hoja');
output.push('');
output.push('En «histograma compacto», por ejemplo `(0,2,1)×8`, se indica el número de ramas con esa especificidad.');
output.push('');
output.push('| Capa | Archivo | Reglas | Ramas selectoras | Histograma compacto |');
output.push('|---|---|---:|---:|---|');
for (const row of fileRows) {
  const hist = [...row.histogram.entries()].sort((a, b) => compareSpec(a[0].split(',').map(Number), b[0].split(',').map(Number))).map(([key, count]) => `(${key})×${count}`).join('<br>');
  output.push(`| ${row.layer} | \`${row.relative}\` | ${row.ruleCount} | ${row.selectorCount} | ${hist} |`);
}
output.push('');
output.push('## Selectores de skins que tocan componentes');
output.push('');
output.push('Lista reproducible de selectores no-`:root` presentes en las diez skins. Los conteos son ramas selectoras; reglas agrupadas, pseudo-elementos y contextos anidados se conservan como aparecen en la fuente. Este inventario sirve para planificar qué se convierte a tokens; no implica que todo selector deba eliminarse (tocadiscos y ornamentación identitaria permanecen en skin).');
output.push('');
for (const row of fileRows.filter((item) => item.relative.startsWith('skins/'))) {
  const candidates = row.selectors.filter(({ selector }) => /\.[\w-]/.test(selector));
  output.push(`### ${path.basename(row.relative, '.css')} — ${candidates.length} selectores con clase`);
  output.push('');
  if (!candidates.length) { output.push('Sin selectores de componente.'); output.push(''); continue; }
  output.push('| Especificidad | Selector |');
  output.push('|---|---|');
  for (const { selector, spec } of candidates) output.push(`| (${spec.join(',')}) | \`${esc(selector)}\` |`);
  output.push('');
}
output.push('## Extracción a tokens: cambios aplicados y alcance');
output.push('');
output.push('- Los overrides directos de `.glass` de Neon y Ruby se reemplazaron por `--skin-panel-background` y `--skin-panel-backdrop-filter`, definidos en la capa `skin` y consumidos por `styles/glassmorphism.css` en la capa `surface`. Las variantes clara/oscura existentes quedan representadas por el valor del token; el selector que apunta al panel ya no vive en esas dos skins.');
output.push('- Telar expone su patrón de urdimbre como `--pattern-image`. Glass es, por ahora, la superficie que opta por componer ese patrón sobre `.glass`/`.glass-strong`; las otras siete superficies no leen el token. El velo global Telar deja de imponer la trama de urdimbre en toda la pantalla, aunque conserva el slub y los usos identitarios del disco.');
output.push('- Este es un primer corte deliberado, no la extracción completa de todos los estilos de componente: el inventario anterior conserva selectores de tipografía, controles, avisos, overlays y la biblioteca optativa `.tl-*`. En particular, la propia hoja Telar indica que varias clases `.tl-*` son opt-in; hay que verificar su uso real antes de moverlas o eliminarlas. Los selectores del plato, vinilo, carátula, brazo y pivote permanecen por la excepción pedida.');
output.push('- La próxima migración segura es por familia: transferir cada rediseño restante a un token en `:root[data-skin=…]`, agregar el punto de consumo explícito en las superficies que lo elijan y solo entonces borrar la regla de skin. No trasladar ciegamente geometría, estados de interacción, layout ni reglas de accesibilidad.');
output.push('');
output.push('## Interpretación y límites');
output.push('');
output.push('- La capa determina prioridad entre reglas normales de distintas capas; la especificidad solo desempata reglas dentro de la misma capa. Reglas `!important` invierten el orden de las capas y no se resumen como prioridad normal.');
output.push('- Se cuentan selectores en ramas de listas separadas por coma, no declaraciones CSS. Las reglas `@keyframes`, `@font-face` y `@page` no se interpretan como selectores de componentes.');
output.push('- `:where()` aporta cero; `:is()`, `:not()` y `:has()` aportan la especificidad máxima de sus argumentos; `:nth-child(... of ...)` incluye la rama de `of`.');
output.push('- Los nombres `:root`, atributos `data-skin` y pseudo-clases cuentan según CSS Selectors. Anidamiento at-rule como `@media`, `@supports` y `@container` se recorre recursivamente.');
output.push('- El cálculo implementa la especificidad de selectores ordinarios; no se analiza el DOM, el efecto visual, las reglas deshabilitadas ni las propiedades en conflicto. Selectores inválidos se cuentan sintácticamente y requieren validación de navegador.');
output.push('- Se analizan las hojas fuente listadas, no `node_modules/`, builds temporales ni reglas inline de HTML/atributos `style`. El bloque inline de orden de capas no contiene reglas visuales; el CSS crítico inline ya está en `base`.');
output.push('');
const report = path.join(root, 'outputs', 'informe-selectores-especificidad-css.md');
fs.writeFileSync(report, output.join('\n'), 'utf8');
console.log(`Hojas: ${files.length}; reglas: ${allRules.length}; ramas selectoras: ${allRules.reduce((sum, rule) => sum + rule.selectors.length, 0)}`);
console.log(`Informe: ${report}`);
