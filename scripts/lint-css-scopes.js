#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  { directory: 'skins', attribute: 'data-skin' },
  { directory: 'styles', attribute: 'data-ui' },
];
const keyframes = new Map();

function removeComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function splitSelectors(prelude) {
  const selectors = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = '';
  for (let i = 0; i < prelude.length; i += 1) {
    const ch = prelude[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') round += 1;
    else if (ch === ')') round -= 1;
    else if (ch === '[') square += 1;
    else if (ch === ']') square -= 1;
    else if (ch === ',' && round === 0 && square === 0) {
      selectors.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  selectors.push(prelude.slice(start).trim());
  return selectors.filter(Boolean);
}

function lintFile(file, attribute) {
  const source = removeComments(fs.readFileSync(file, 'utf8'));
  const errors = [];
  const expected = new RegExp(`\\[\\s*${attribute}\\s*=`);

  function scan(start, end, inKeyframes = false) {
    let cursor = start;
    while (cursor < end) {
      while (cursor < end && (/\s/.test(source[cursor]) || source[cursor] === ';')) cursor += 1;
      if (cursor >= end) break;
      const preludeStart = cursor;
      let round = 0;
      let square = 0;
      let quote = '';
      while (cursor < end) {
        const ch = source[cursor];
        if (quote) {
          if (ch === '\\') cursor += 1;
          else if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') round += 1;
        else if (ch === ')') round -= 1;
        else if (ch === '[') square += 1;
        else if (ch === ']') square -= 1;
        else if ((ch === '{' || ch === ';' || ch === '}') && round === 0 && square === 0) break;
        cursor += 1;
      }
      const prelude = source.slice(preludeStart, cursor).trim();
      if (cursor >= end || source[cursor] === '}') return;
      if (source[cursor] === ';') {
        cursor += 1;
        continue;
      }

      const open = cursor;
      let depth = 1;
      cursor += 1;
      let innerQuote = '';
      while (cursor < end && depth > 0) {
        const ch = source[cursor];
        if (innerQuote) {
          if (ch === '\\') cursor += 1;
          else if (ch === innerQuote) innerQuote = '';
        } else if (ch === '"' || ch === "'") innerQuote = ch;
        else if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        cursor += 1;
      }
      const close = cursor - 1;
      if (depth !== 0) {
        const line = source.slice(0, preludeStart).split('\n').length;
        errors.push(`${path.relative(ROOT, file)}:${line}: unclosed CSS block`);
        return;
      }

      if (prelude.startsWith('@')) {
        const keyframeMatch = prelude.match(/^@(?:-[\w]+-)?keyframes\s+([\w-]+)/i);
        if (keyframeMatch) {
          const name = keyframeMatch[1];
          const files = keyframes.get(name) || new Set();
          files.add(path.relative(ROOT, file));
          keyframes.set(name, files);
        }
        // Recurse through @media/@supports/@layer and other grouping at-rules;
        // ignore from/to/percentage selectors inside keyframes (they are not selectors).
        scan(open + 1, close, inKeyframes || Boolean(keyframeMatch));
      } else if (!inKeyframes && prelude) {
        const line = source.slice(0, preludeStart).split('\n').length;
        for (const selector of splitSelectors(prelude)) {
          if (!expected.test(selector)) {
            errors.push(`${path.relative(ROOT, file)}:${line}: selector must contain [${attribute}="…"]: ${selector}`);
          }
        }
      }
    }
  }

  scan(0, source.length);
  return errors;
}

let errors = [];
for (const { directory, attribute } of TARGETS) {
  const folder = path.join(ROOT, directory);
  if (!fs.existsSync(folder)) continue;
  const files = fs.readdirSync(folder).filter((name) => name.endsWith('.css')).sort();
  for (const name of files) {
    errors = errors.concat(lintFile(path.join(folder, name), attribute));
  }
}

for (const [name, files] of keyframes) {
  if (files.size > 1) errors.push(`@keyframes name collision "${name}" in ${[...files].join(', ')}`);
}

if (errors.length) {
  console.error(`CSS scope lint failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
} else {
  console.log('CSS scope lint passed: every selector uses the correct folder attribute; no cross-file keyframe collisions.');
}
