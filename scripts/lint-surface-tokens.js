#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  'styles/claymorphism.css',
  'styles/glassmorphism.css',
  'styles/flat.css',
];
const OBSOLETE = [
  { pattern: /--r-(?:xs|sm|md|lg|xl|pill)\b/gi, label: 'alias o declaración de radio --r-*; usar --radius-*' },
  { pattern: /--fl-(?:radius(?:-lg)?|pill)\b/gi, label: 'token privado de radio Flat --fl-radius/--fl-pill; usar --radius-*' },
  { pattern: /var\(\s*--shadow-(?:soft|panel|strong)\b/gi, label: 'token de elevación heredado --shadow-*; usar --elev-*' },
  { pattern: /var\(\s*--glass-blur\b/gi, label: 'alias de blur --glass-blur; usar --blur' },
];

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

const errors = [];
for (const relative of TARGETS) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    errors.push(`${relative}: archivo requerido no encontrado`);
    continue;
  }
  const source = withoutComments(fs.readFileSync(file, 'utf8'));

  // Radios dimensionales se expresan con tokens. Se permiten radios circulares
  // (50%), cero, inherit y valores ya tokenizados con var().
  const radiusDeclaration = /border-radius\s*:\s*([^;}]+)\s*;?/gi;
  for (const match of source.matchAll(radiusDeclaration)) {
    const value = match[1].trim();
    if (/\b\d*\.?\d+(?:px|rem|em|ch|vw|vh|vmin|vmax)\b/i.test(value)) {
      errors.push(`${relative}:${lineAt(source, match.index)}: radio literal "${value}"; usar --radius-* (círculo 50% y cero se permiten)`);
    }
  }

  for (const rule of OBSOLETE) {
    for (const match of source.matchAll(rule.pattern)) {
      errors.push(`${relative}:${lineAt(source, match.index)}: ${rule.label}`);
    }
  }
}

if (errors.length) {
  console.error(`Surface-token lint failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
} else {
  console.log('Surface-token lint passed: Clay, Glass and Flat use semantic radius and surface tokens.');
}
