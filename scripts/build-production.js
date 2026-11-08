'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { minify: minifyJavaScript } = require('terser');
const CleanCSS = require('clean-css');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--out-dir');
const outputName = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'dist';
if (!outputName || outputName.startsWith('--')) throw new Error('Uso: node scripts/build-production.js [--out-dir carpeta]');
const dist = path.resolve(root, outputName);
const outputRelative = path.relative(root, dist);
if (outputRelative !== 'dist' && !outputRelative.startsWith(`.work${path.sep}`)) {
  throw new Error('La salida debe ser dist/ (producción) o una subcarpeta de .work/ (pruebas).');
}
const runtimeEntries = [
  'index.html',
  'Abrir AuraPlay.bat',
  'css',
  'js',
  'karaoke',
  'remote',
  'skins',
  'styles',
  'svg',
  'visualizers',
  'fonts',
  'demo',
  '__aura',
];
const karaokeAssets = [
  'karaoke/shared/karaoke-core.js',
  'karaoke/cinema/cinema-effects.js',
  'karaoke/neon/neon-effects.js',
  'karaoke/kinetico/kinetic-effects.js',
  'karaoke/guilloche/guilloche-effects.js',
  'karaoke/yozakura/yozakura-effects.js',
  'karaoke/palco-esmeralda/palco-esmeralda-effects.js',
  'karaoke/shared/karaoke.css',
  'karaoke/shared/karaoke-common.css',
  'karaoke/cinema/cinema.css',
  'karaoke/neon/neon.css',
  'karaoke/kinetico/kinetic.css',
  'karaoke/guilloche/guilloche.css',
  'karaoke/yozakura/yozakura.css',
  'karaoke/palco-esmeralda/palco-esmeralda.css',
];

function copyRuntime() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  for (const entry of runtimeEntries) {
    const source = path.join(root, entry);
    if (!fs.existsSync(source)) throw new Error(`Falta un recurso requerido: ${entry}`);
    fs.cpSync(source, path.join(dist, entry), { recursive: true });
  }
  fs.writeFileSync(path.join(dist, '.nojekyll'), '', 'utf8');
}

function removeOldMinifiedCopies() {
  for (const entry of runtimeEntries.filter((item) => item === 'karaoke')) {
    const base = path.join(dist, entry);
    for (const folder of ['shared', 'cinema', 'neon', 'kinetico', 'guilloche', 'yozakura', 'palco-esmeralda']) {
      const directory = path.join(base, folder);
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory)) {
        if (/\.min\.(?:js|css)(?:\.map)?$/.test(file)) {
          fs.rmSync(path.join(directory, file), { force: true });
        }
      }
    }
  }
}

async function minifyAssets() {
  let sourceBytes = 0;
  let minifiedBytes = 0;
  for (const relative of karaokeAssets) {
    const sourcePath = path.join(root, relative);
    const outputPath = path.join(dist, relative.replace(/\.(js|css)$/, '.min.$1'));
    const source = fs.readFileSync(sourcePath, 'utf8');
    let minified;

    if (relative.endsWith('.js')) {
      const result = await minifyJavaScript(source, {
        compress: { passes: 2 },
        mangle: true,
        format: { comments: /@license|@preserve/ },
      });
      if (!result.code) throw new Error(`Terser no produjo salida para ${relative}`);
      minified = result.code;
    } else {
      const result = new CleanCSS({ level: 1 }).minify(source);
      if (result.errors.length) throw new Error(`${relative}: ${result.errors.join('; ')}`);
      if (result.warnings.length) {
        console.warn(`Avisos Clean-CSS (${relative}): ${result.warnings.join('; ')}`);
      }
      minified = result.styles;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, minified, 'utf8');
    sourceBytes += Buffer.byteLength(source);
    minifiedBytes += Buffer.byteLength(minified);
  }
  return { sourceBytes, minifiedBytes };
}

function pointProductionIndexAtMinifiedAssets() {
  const indexPath = path.join(dist, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  for (const relative of karaokeAssets) {
    const url = `./${relative}`;
    if (!html.includes(url)) throw new Error(`index.html no contiene la referencia esperada: ${url}`);
    html = html.replaceAll(url, url.replace(/\.(js|css)$/, '.min.$1'));
  }
  fs.writeFileSync(indexPath, html, 'utf8');
}

(async () => {
  copyRuntime();
  removeOldMinifiedCopies();
  const { sourceBytes, minifiedBytes } = await minifyAssets();
  pointProductionIndexAtMinifiedAssets();
  const reduction = ((1 - minifiedBytes / sourceBytes) * 100).toFixed(1);
  console.log(`Build de producción listo: ${dist}`);
  console.log(`Recursos karaoke: ${sourceBytes.toLocaleString()} -> ${minifiedBytes.toLocaleString()} bytes (${reduction}% menos).`);
  console.log('Publica únicamente la carpeta dist/; index.html de desarrollo conserva las fuentes legibles.');
})().catch((error) => {
  console.error('Falló el build de producción:', error);
  process.exitCode = 1;
});
