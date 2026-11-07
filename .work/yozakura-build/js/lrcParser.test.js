/* lrcParser.test.js — pruebas de AuraLRC sin dependencias (solo Node ≥ 16)
 *
 * Uso:
 *   node lrcParser.test.js            → unitarias + fuzz + benchmark
 *   node lrcParser.test.js --fast     → sin benchmark, fuzz reducido
 *   FUZZ_ITER=200000 node lrcParser.test.js   → fuzz más pesado
 *   FUZZ_SEED=1234 node lrcParser.test.js     → reproducir una semilla concreta
 *
 * Sale con código 1 si algo falla (útil en CI).
 */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const A = require(path.join(__dirname, "lrcParser.js"));

const FAST = process.argv.includes("--fast");
const FUZZ_ITER = Number(process.env.FUZZ_ITER) || (FAST ? 3000 : 30000);
const SEED = Number(process.env.FUZZ_SEED) || ((Date.now() & 0xffffffff) >>> 0);

let passed = 0;
const failed = [];

function test(name, fn) {
  try { fn(); passed++; console.log("  ✓", name); }
  catch (err) { failed.push(name); console.log("  ✗", name, "\n     ", err.message.split("\n")[0]); }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

/* ───────────────────────── 1) Autodiagnóstico integrado ───────────────────────── */
console.log("\n[1] selfTest() integrado");
test("AuraLRC.selfTest() sin fallos", () => {
  const r = A.selfTest();
  assert.equal(r.ok, true, r.failures.join(" | "));
});

/* ───────────────────────── 2) Unitarias ───────────────────────── */
console.log("\n[2] Unitarias");

test("tolera BOM, \\r\\n, \\r y \\n", () => {
  const r = A.parse("\uFEFF[00:01.00]a\r\n[00:02.00]b\r[00:03.00]c\n[00:04.00]d");
  assert.deepEqual(r.map((l) => l.text), ["a", "b", "c", "d"]);
});

test("conserva etiquetas dentro del texto, quita solo las del inicio", () => {
  const r = A.parse("[00:01.00][Coro] hola (risas) [x]");
  assert.equal(r[0].text, "hola (risas) [x]");
});

test("[offset:] al final del archivo afecta a todas las líneas", () => {
  const r = A.parse("[00:10.00]a\n[00:20.00]b\n[offset:-500]");
  near(r[0].time, 9.5); near(r[1].time, 19.5);
  assert.equal(r.offset, -500);
});

test("invertOffset, applyFileOffset y offset extra", () => {
  const src = "[offset:1000]\n[00:10.00]a";
  near(A.parse(src)[0].time, 11);
  near(A.parse(src, { invertOffset: true })[0].time, 9);
  near(A.parse(src, { applyFileOffset: false })[0].time, 10);
  near(A.parse(src, { offset: 250 })[0].time, 11.25);
});

test("tiempos negativos tras offset se acotan a 0", () => {
  const r = A.parse("[offset:-5000]\n[00:01.00]a");
  assert.equal(r[0].time, 0);
});

test("líneas vacías con tiempo se conservan (instrumentales)", () => {
  const r = A.parse("[00:01.00]a\n[00:05.00]\n[00:09.00]b");
  assert.equal(r.length, 3); assert.equal(r[1].text, "");
});

test("varias etiquetas por línea, orden y duplicados", () => {
  const r = A.parse("[00:30.00][00:10.00][00:10.00]coro");
  assert.deepEqual(r.map((l) => l.time), [10, 30]);
});

test("líneas simultáneas comparten fin", () => {
  const r = A.parse("[00:10.00]hola\n[00:10.00]hello\n[00:20.00]x");
  assert.equal(r[0].end, 20); assert.equal(r[1].end, 20);
});

test("duration fija el fin de la última línea", () => {
  const r = A.parse("[00:10.00]a", { duration: 42 });
  assert.equal(r[0].end, 42);
});

test("LRC mejorado: texto previo, espacios y fin explícito", () => {
  const r = A.parse("[00:10.00]Hi <00:10.50>there<00:11.25>");
  const w = r[0].words;
  assert.equal(r[0].text, "Hi there");
  assert.equal(w.length, 2);
  assert.equal(w[0].text, "Hi"); assert.equal(w[0].space, true);
  near(w[1].end, 11.25);
});

test("LRC mejorado: palabras con tiempos desordenados salen monótonas", () => {
  const w = A.parse("[00:10.00]<00:12.00>a <00:11.00>b")[0].words;
  assert.ok(w[1].time >= w[0].time);
});

test("etiquetas repetidas desplazan las palabras", () => {
  const r = A.parse("[00:10.00][00:50.00]<00:10.00>a <00:11.00>b");
  near(r[1].words[0].time, 50); near(r[1].words[1].time, 51);
});

test("meta: genéricos y bloqueo de claves peligrosas", () => {
  const r = A.parse("[ti:T]\n[ar:Art]\n[by: yo ]\n[constructor:x]\n[00:01.00]a");
  assert.deepEqual({ ...r.meta }, { ti: "T", ar: "Art", by: "yo" });
});

test("límites: stamps por línea, entrada enorme, líneas largas", () => {
  const many = Array.from({ length: 1000 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}.${String(i % 100).padStart(2, "0")}]`).join("") + "x";
  assert.ok(A.parse(many).length <= A.limits.maxStampsPerLine);
  const huge = A.parse("[00:01.00]a\n".repeat(10) + "z".repeat(A.limits.maxChars + 10));
  assert.ok(huge.warnings.length > 0);
  assert.ok(A.parse("[00:01.00]" + "x".repeat(50000))[0].text.length <= A.limits.maxText);
});

test("entrada binaria (Uint8Array/ArrayBuffer) con BOM", () => {
  const bytes = new TextEncoder().encode("\uFEFF[00:01.00]ñandú 🎵");
  assert.equal(A.parse(bytes)[0].text, "ñandú 🎵");
  assert.equal(A.parse(bytes.buffer)[0].text, "ñandú 🎵");
});

test("no corta emojis al recortar", () => {
  const r = A.parse("[00:01.00]" + "🎵".repeat(5000));
  const t = r[0].text;
  assert.ok(!/[\uD800-\uDBFF]$/.test(t));
});

test("stamp/format: bordes y round-trip", () => {
  assert.equal(A.format(59.996), "01:00.00");
  assert.equal(A.format(-5), "00:00.00");
  assert.equal(A.format(1e12), "999:59.99");
  for (const s of [0, 0.01, 59.99, 83.45, 3723.5, 59999.99]) near(A.stamp(A.format(s)), s, 0.0051);
  assert.equal(A.stamp("12"), 12);           // número suelto vía API pública
  assert.equal(A.stamp(""), null);
});

test("findIndex: pista correcta y consistente con la búsqueda binaria", () => {
  const lines = A.parse(Array.from({ length: 200 }, (_, i) => `[${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}.00]l${i}`).join("\n"));
  for (let t = -1; t < 40; t += 0.37) {
    const truth = A.findIndex(lines, t);
    for (const hint of [undefined, -1, 0, 5, 199, 9999, 1.5, NaN]) assert.equal(A.findIndex(lines, t, 0, hint), truth);
  }
});

test("tracker: palabras, progreso, seek y entradas inválidas", () => {
  const lines = A.parse("[00:10.00]<00:10.00>a <00:11.00>b<00:12.00>\n[00:20.00]c");
  const tr = A.createTracker(lines);
  let s = tr.update(10.5);
  assert.equal(s.index, 0); assert.equal(s.wordIndex, 0); assert.equal(s.lineChanged, true);
  near(s.wordProgress, 0.5);
  s = tr.update(11.5); assert.equal(s.wordIndex, 1); assert.equal(s.lineChanged, false);
  s = tr.update(25); assert.equal(s.index, 1); assert.equal(s.wordIndex, -1);
  assert.equal(tr.update(undefined).index, 1);
  assert.equal(tr.seek(0).index, -1);
});

test("marcas bracket: cuatro líneas de karaoke y espacios visuales", () => {
  const lines = A.parse("[00:00.000]4ÆM[00:03.448] [00:06.896]-[00:10.344] [00:13.792]Grimes[00:17.240]\n[00:17.240]Lyrics[00:18.061] [00:18.882]by[00:19.703]：[00:20.524]Ganesh[00:21.345]\n[00:51.742]Ooh[00:51.938]\n[00:55.000]Línea normal");
  assert.equal(lines.length, 4);
  assert.equal(lines.hasWordSync, true);
  assert.deepEqual(lines[0].words.map((word) => [word.text, word.space]), [["4ÆM", true], ["-", true], ["Grimes", false]]);
  assert.equal(lines[1].text, "Lyrics by：Ganesh");
  assert.equal(lines[2].words[0].text, "Ooh");
  assert.equal(lines[3].words, undefined);
  const tracker = A.createTracker(lines);
  const state = tracker.update(8);
  assert.equal(state.index, 0);
  assert.equal(state.wordIndex, 1);
  assert.ok(state.wordProgress > 0 && state.wordProgress < 1);
});

test("normalize repara datos corruptos", () => {
  const r = A.normalize([{ time: "5", text: " b " }, { time: -1 }, { time: Infinity }, null, 7, { time: 2, text: "a", end: 1 }]);
  assert.deepEqual(r.map((l) => l.text), ["a", "b"]);
  assert.ok(r.every((l) => l.end > l.time));
});

test("shift + stringify enhanced + parse conserva la sincronía", () => {
  const src = A.parse("[ti:X]\n[00:10.00]Hi <00:10.50>there<00:11.00>\n[00:20.00]fin");
  const out = A.stringify(A.shift(src, 2), { enhanced: true });
  const back = A.parse(out);
  near(back[0].time, 12, 0.011); near(back[0].words[1].time, 12.5, 0.011);
  assert.equal(back.meta.ti, "X");
});

test("stringify neutraliza saltos de línea y '<tiempos>' en el texto", () => {
  const out = A.stringify([{ time: 1, text: "a\nb <00:01.00>c", end: 2 }]);
  assert.equal(out.trim().split("\n").length, 1);
  assert.equal(A.parse(out)[0].text, "a b c");
});

test("toPlainText y escapeHtml", () => {
  assert.equal(A.toPlainText(A.parse("[00:01.00]a\n[00:02.00]\n[00:03.00]b")), "a\nb");
  assert.equal(A.escapeHtml("<img onerror='x'>"), "&lt;img onerror=&#39;x&#39;&gt;");
});

test("la API está congelada", () => {
  assert.throws(() => { "use strict"; A.parse = null; }, TypeError);
});

/* ───────────────────────── 3) Fuzz determinista ───────────────────────── */
console.log(`\n[3] Fuzz (${FUZZ_ITER} iteraciones, semilla ${SEED})`);

function rng(seed) {                       // mulberry32
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const TOKENS = ["[", "]", "<", ">", ":", ".", ",", "-", "+", "0", "1", "9", "59", "99", "999", "00:00.00", "01:23.45", "1:02:03", "\n", "\r", "\r\n", "\uFEFF", "\u0000", "\u2028",
  "offset", "ti", "ar", "constructor", "__proto__", "prototype", "hola", " ", "  ", "\t", "🎵", "\uD83C", "ñ", "NaN", "Infinity", "1e999", "<00:01.00>", "[00:05.00]", "[offset:500]", "[offset:abc]", "[Coro]"];

function randomDoc() {
  let s = "";
  const n = Math.floor(rand() * 60);
  for (let i = 0; i < n; i++) s += pick(TOKENS);
  return s;
}
function randomValue() {
  return pick([null, undefined, NaN, Infinity, -1, 0, 1.5, "", "x", "[00:01.00]a", {}, [], [null], [{ time: "x" }], [{ time: 1, text: 5, words: "no" }], () => 1, Symbol.iterator.toString(), new Uint8Array([255, 254, 0, 91]), true]);
}
function checkInvariants(lines) {
  assert.ok(Array.isArray(lines));
  assert.ok(lines.meta && typeof lines.meta === "object");
  assert.equal(Object.getPrototypeOf(lines.meta), Object.prototype);
  assert.ok(Array.isArray(lines.warnings));
  let prev = -1;
  for (const l of lines) {
    assert.ok(Number.isFinite(l.time) && l.time >= 0 && l.time <= 59999.99, "time fuera de rango");
    assert.ok(l.time >= prev, "desordenado"); prev = l.time;
    assert.ok(Number.isFinite(l.end) && l.end >= l.time, "end inválido");
    assert.equal(typeof l.text, "string");
    if (l.words) {
      let pw = -1;
      for (const w of l.words) {
        assert.ok(Number.isFinite(w.time) && w.time >= pw && Number.isFinite(w.end) && w.end >= w.time, "palabra inválida");
        pw = w.time; assert.ok(w.text.length > 0);
      }
    }
  }
  assert.equal(A.validate(lines).ok, true);
}

test("parse/normalize/shift/stringify/findIndex/tracker nunca lanzan y respetan invariantes", () => {
  const polluted = Object.prototype.hasOwnProperty.call({}, "evil");
  for (let i = 0; i < FUZZ_ITER; i++) {
    const doc = i % 5 === 0 ? randomValue() : randomDoc();
    const opts = i % 3 === 0 ? { offset: randomValue(), invertOffset: rand() < 0.5, duration: randomValue(), ambiguousColon: rand() < 0.5 ? "fraction" : undefined } : undefined;
    let lines;
    try {
      lines = A.parse(doc, opts);
      checkInvariants(lines);
      checkInvariants(A.normalize(lines));
      checkInvariants(A.shift(lines, randomValue()));
      const txt = A.stringify(lines, { enhanced: rand() < 0.5 });
      checkInvariants(A.parse(txt));
      A.toPlainText(lines);
      const idx = A.findIndex(lines, randomValue(), randomValue(), randomValue());
      assert.ok(Number.isInteger(idx) && idx >= -1 && idx < Math.max(1, lines.length));
      const tr = A.createTracker(rand() < 0.8 ? lines : randomValue(), { offset: randomValue() });
      for (let k = 0; k < 5; k++) tr.update(randomValue() === 1.5 ? 1.5 : rand() * 100 - 10);
      A.validate(randomValue()); A.normalize(randomValue()); A.findWordIndex(randomValue(), randomValue());
      A.stamp(randomValue()); A.format(randomValue());
    } catch (err) {
      err.message = `iteración ${i}, semilla ${SEED}, doc=${JSON.stringify(typeof doc === "string" ? doc.slice(0, 200) : String(doc))}\n${err.message}`;
      throw err;
    }
  }
  assert.equal(Object.prototype.hasOwnProperty.call({}, "evil"), polluted);
  assert.equal(({}).constructor, Object);
});

/* ───────────────────────── 4) Benchmark ───────────────────────── */
if (!FAST) {
  console.log("\n[4] Benchmark");
  const N = 50000;
  let big = "";
  for (let i = 0; i < N; i++) big += `[${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.00]línea número ${i} de la canción\n`;

  let t0 = process.hrtime.bigint();
  const lines = A.parse(big);
  let ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  parse ${N} líneas: ${ms.toFixed(0)} ms (${lines.length} resultantes)`);

  const times = Array.from({ length: 1e6 }, (_, i) => (i / 1e6) * lines[lines.length - 1].time);
  t0 = process.hrtime.bigint();
  for (const t of times) A.findIndex(lines, t);
  ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  findIndex binario ×1e6: ${ms.toFixed(0)} ms`);

  let hint;
  t0 = process.hrtime.bigint();
  for (const t of times) hint = A.findIndex(lines, t, 0, hint);
  ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  findIndex con pista ×1e6: ${ms.toFixed(0)} ms`);

  // Entradas patológicas: deben terminar rápido (sin backtracking catastrófico)
  const evil = ["[".repeat(200000), "[00:01.00]" + "<".repeat(100000), "[ ".repeat(50000) + "x", "[00:01.00]<00:01.00>".repeat(20000), ("[a:" + "b".repeat(100)).repeat(1000)];
  for (const [i, s] of evil.entries()) {
    t0 = process.hrtime.bigint();
    A.parse(s);
    ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`  patológica #${i + 1}: ${ms.toFixed(0)} ms`);
    if (ms > 1500) { failed.push("patológica #" + (i + 1) + " lenta"); console.log("  ✗ demasiado lenta"); }
  }
}

/* ───────────────────────── Resumen ───────────────────────── */
console.log(`\n${failed.length ? "✗" : "✓"} ${passed} pruebas OK, ${failed.length} fallidas${failed.length ? ": " + failed.join(", ") : ""}\n`);
process.exitCode = failed.length ? 1 : 0;
