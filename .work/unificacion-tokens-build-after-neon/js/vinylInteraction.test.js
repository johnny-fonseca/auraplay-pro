"use strict";
const assert = require("assert");
global.window = global; // el módulo usa window si existe
global.addEventListener = () => {}; // stub de resize/scroll
const rafQueue = [];
global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
global.cancelAnimationFrame = () => {};
const runRaf = () => { while (rafQueue.length) rafQueue.shift()(); };

const Vinyl = require("../js/vinylInteraction.js");

function makeEl(tag) {
  const el = new EventTarget();
  const attrs = {}; const classes = new Set();
  Object.assign(el, {
    tag, children: [], parentNode: null, offsetLeft: 0, offsetTop: 0, offsetWidth: 400,
    style: { _v: {}, setProperty(k, v) { this._v[k] = v; } },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { (on ? classes.add(c) : classes.delete(c)); },
      contains: (c) => classes.has(c)
    },
    _classes: classes, _attrs: attrs, captured: new Set(),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => attrs[k],
    hasAttribute: (k) => k in attrs,
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 400 }),
    setPointerCapture(id) { el.captured.add(id); },
    releasePointerCapture(id) { el.captured.delete(id); },
    hasPointerCapture: (id) => el.captured.has(id),
    focus() {}
  });
  return el;
}

function setup(opts = {}) {
  const host = makeEl("div");
  const artFrame = makeEl("div");
  artFrame.offsetParent = host; artFrame.ownerDocument = { createElement: makeEl };
  const audio = new EventTarget();
  Object.assign(audio, { duration: 200, currentTime: 50, paused: false, ended: false, currentSrc: "x.mp3", src: "x.mp3",
    play() { this.paused = false; this.plays++; return Promise.resolve(); },
    pause() { this.paused = true; this.pauses++; }, plays: 0, pauses: 0 });
  const v = new Vinyl(Object.assign({ artFrame, audio, scratchEnabled: false, inertiaEnabled: false }, opts));
  return { v, artFrame, audio, host };
}

// Centro del disco simulado: (300,300), radio 200.
const P = (type, x, y, extra) => Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0 }, extra);
const polar = (deg, r = 150) => [300 + r * Math.cos(deg * Math.PI / 180), 300 + r * Math.sin(deg * Math.PI / 180)];
const fire = (el, type, [x, y], extra) => el.dispatchEvent(P(type, x, y, extra));

let n = 0; const test = (name, fn) => { fn(); n++; console.log("ok -", name); };

test("shortestAngleDelta: 179° -> -179° = +2°", () => {
  const d = Vinyl.shortestAngleDelta(-179 * Math.PI / 180, 179 * Math.PI / 180);
  assert(Math.abs(d - 2 * Math.PI / 180) < 1e-9);
  const back = Vinyl.shortestAngleDelta(179 * Math.PI / 180, -179 * Math.PI / 180);
  assert(Math.abs(back + 2 * Math.PI / 180) < 1e-9);
});

test("bind: atributos ARIA, clase y overlay", () => {
  const { artFrame, host } = setup();
  assert(artFrame._classes.has("is-interactive"));
  assert.strictEqual(artFrame.getAttribute("role"), "slider");
  assert.strictEqual(artFrame.getAttribute("tabindex"), "0");
  assert.strictEqual(artFrame.getAttribute("aria-valuenow"), "25");
  assert.strictEqual(host.children.length, 1);
});

test("arrastre sin salto inicial y con pausa/reanudación", () => {
  const { artFrame, audio } = setup();
  fire(artFrame, "pointerdown", polar(0));
  assert.strictEqual(audio.currentTime, 50, "pointerdown no cambia posición");
  fire(artFrame, "pointermove", polar(2));           // < 6px: aún no es arrastre
  assert.strictEqual(audio.pauses, 0);
  fire(artFrame, "pointermove", polar(10));          // supera umbral: activa, sin seek
  assert.strictEqual(audio.pauses, 1, "pausa al activar");
  assert(audio._classes === undefined);
  runRaf(); assert.strictEqual(audio.currentTime, 50, "activar no mueve la posición");
  fire(artFrame, "pointermove", polar(100));         // +90° => +50 s (200 s por vuelta)
  runRaf();
  assert(Math.abs(audio.currentTime - 100) < 0.01, "got " + audio.currentTime);
  fire(artFrame, "pointerup", polar(100));
  assert.strictEqual(audio.plays, 1, "reanuda");
  assert(!artFrame._classes.has("is-dragging"));
  assert.strictEqual(artFrame.captured.size, 0);
});

test("cruce ±180° sin salto", () => {
  const { artFrame, audio } = setup();
  audio.currentTime = 100;
  fire(artFrame, "pointerdown", polar(170));
  fire(artFrame, "pointermove", polar(179));
  fire(artFrame, "pointermove", polar(-179));  // +2° => +1.11 s
  fire(artFrame, "pointermove", polar(-170));
  runRaf();
  // 170 -> 179 se usa como activación; luego -179 (+2°) y -170 (+9°) = +11° = +6.11 s
  assert(Math.abs(audio.currentTime - (100 + 11 / 360 * 200)) < 0.01, "got " + audio.currentTime);
  fire(artFrame, "pointerup", polar(-170));
});

test("límites 0 y duración + respuesta inmediata al invertir", () => {
  const { artFrame, audio } = setup();
  audio.currentTime = 10; audio.paused = true;
  fire(artFrame, "pointerdown", polar(0));
  fire(artFrame, "pointermove", polar(8));
  let a = 8;
  for (let i = 0; i < 40; i++) { a -= 10; fire(artFrame, "pointermove", polar(a)); } // hacia atrás de sobra
  runRaf(); assert.strictEqual(audio.currentTime, 0);
  fire(artFrame, "pointermove", polar(a + 18));  // invertir 18° => +10 s inmediatos
  runRaf(); assert(Math.abs(audio.currentTime - 10) < 0.01, "got " + audio.currentTime);
  for (let i = 0; i < 60; i++) { a += 10; fire(artFrame, "pointermove", polar(a)); }
  runRaf(); assert.strictEqual(audio.currentTime, 200);
  fire(artFrame, "pointerup", polar(a));
  assert.strictEqual(audio.plays, 0, "estaba pausada: sigue pausada");
});

test("clic tras arrastre se suprime; clic central alterna", () => {
  const { artFrame, audio } = setup();
  fire(artFrame, "pointerdown", polar(0));
  fire(artFrame, "pointermove", polar(20));
  fire(artFrame, "pointerup", polar(20));
  const before = audio.pauses;
  fire(artFrame, "click", [300, 300]);              // centro, pero justo tras arrastre
  assert.strictEqual(audio.pauses, before, "clic suprimido");
  audio.paused = false;
  fire(artFrame, "click", [300, 300]);              // ahora sí
  assert.strictEqual(audio.pauses, before + 1, "pausa por clic central");
  audio.paused = true;
  fire(artFrame, "click", [300, 300]);
  assert.strictEqual(audio.plays > 0, true, "play por clic central");
});

test("clic en el exterior no hace nada", () => {
  const { artFrame, audio } = setup();
  fire(artFrame, "pointerdown", polar(0, 180)); fire(artFrame, "pointerup", polar(0, 180));
  fire(artFrame, "click", polar(0, 180));
  assert.strictEqual(audio.pauses + audio.plays, 0);
});

test("duración inválida: arrastre ignorado", () => {
  const { artFrame, audio } = setup();
  audio.duration = NaN;
  fire(artFrame, "pointerdown", polar(0)); fire(artFrame, "pointermove", polar(90));
  runRaf(); assert.strictEqual(audio.currentTime, 50); assert.strictEqual(audio.pauses, 0);
});

test("clic derecho no inicia arrastre", () => {
  const { artFrame, audio } = setup();
  fire(artFrame, "pointerdown", polar(0), { button: 2 }); fire(artFrame, "pointermove", polar(90));
  runRaf(); assert.strictEqual(audio.currentTime, 50);
});

test("pointercancel limpia y reanuda", () => {
  const { artFrame, audio } = setup();
  fire(artFrame, "pointerdown", polar(0)); fire(artFrame, "pointermove", polar(20));
  fire(artFrame, "pointercancel", polar(20));
  assert(!artFrame._classes.has("is-seeking")); assert.strictEqual(audio.plays, 1);
});

test("teclado: flechas, Shift, Home, End, Espacio", () => {
  const { artFrame, audio } = setup();
  const key = (k, extra) => { const e = Object.assign(new Event("keydown", { cancelable: true }), { key: k }, extra); artFrame.dispatchEvent(e); return e; };
  key("ArrowRight"); assert.strictEqual(audio.currentTime, 55);
  key("ArrowLeft", { shiftKey: true }); assert.strictEqual(audio.currentTime, 40);
  key("End"); assert.strictEqual(audio.currentTime, 200);
  key("ArrowRight"); assert.strictEqual(audio.currentTime, 200);
  key("Home"); assert.strictEqual(audio.currentTime, 0);
  key("ArrowLeft"); assert.strictEqual(audio.currentTime, 0);
  const e = key(" "); assert.strictEqual(e.defaultPrevented, true); assert.strictEqual(audio.pauses, 1);
});

test("usa los métodos del player cuando existen", () => {
  const calls = [];
  const player = { play: () => calls.push("play"), pause: () => calls.push("pause"), togglePlay: () => calls.push("toggle") };
  const { artFrame } = setup({ player });
  fire(artFrame, "pointerdown", polar(0)); fire(artFrame, "pointermove", polar(20)); fire(artFrame, "pointerup", polar(20));
  assert.deepStrictEqual(calls, ["pause", "play"]);
  fire(artFrame, "pointerdown", [300, 300]); fire(artFrame, "pointerup", [300, 300]); 
  setTimeout(() => {}, 0);
});

test("sin listeners duplicados al reinicializar", () => {
  const { artFrame, audio, v } = setup();
  const v2 = new Vinyl({ artFrame, audio });
  assert.strictEqual(v._ac, null, "la instancia previa se destruyó");
  fire(artFrame, "pointerdown", polar(0)); fire(artFrame, "pointermove", polar(20)); fire(artFrame, "pointerup", polar(20));
  assert.strictEqual(audio.pauses, 1, "una sola reacción");
  v2.destroy();
  assert(!artFrame._classes.has("is-interactive"));
});

test("cambio de canción durante arrastre lo cancela", () => {
  const { artFrame, audio } = setup();
  fire(artFrame, "pointerdown", polar(0)); fire(artFrame, "pointermove", polar(20));
  audio.dispatchEvent(new Event("loadstart"));
  assert(!artFrame._classes.has("is-dragging"));
  assert.strictEqual(audio.plays, 0, "no reanuda sobre la canción nueva");
});

console.log("\n" + n + " pruebas OK");
if (typeof process !== "undefined" && process.exit) process.exit(0);
