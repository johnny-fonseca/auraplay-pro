"use strict";
// Pruebas temporales en memoria. No forman parte del proyecto.
var assert = require("assert");

// ---- Entorno simulado ----
var rafQueue = [], rafId = 0, rafNow = 1000, rafCalls = 0, rafCancels = 0;
globalThis.requestAnimationFrame = function (cb) { rafCalls++; rafQueue.push({ id: ++rafId, cb: cb }); return rafId; };
globalThis.cancelAnimationFrame = function (id) { rafCancels++; rafQueue = rafQueue.filter(function (r) { return r.id !== id; }); };
globalThis.addEventListener = function () {};
function stepFrames(n, ms) {
  for (var i = 0; i < n && rafQueue.length; i++) {
    rafNow += ms || 16.67;
    var q = rafQueue; rafQueue = [];
    q.forEach(function (r) { r.cb(rafNow); });
  }
}
function flushRafOnce() { var q = rafQueue; rafQueue = []; q.forEach(function (r) { r.cb(rafNow); }); }

function makeClassList() {
  var s = new Set();
  return {
    add: function () { for (var i = 0; i < arguments.length; i++) s.add(arguments[i]); },
    remove: function () { for (var i = 0; i < arguments.length; i++) s.delete(arguments[i]); },
    toggle: function (c, f) { var on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; },
    contains: function (c) { return s.has(c); },
    _s: s
  };
}
function makeEl(rect, offsetWidth) {
  var el = new EventTarget();
  var attrs = {}, props = {}, captured = new Set();
  el.classList = makeClassList();
  el.dataset = {};
  el.style = {
    setProperty: function (k, v) { props[k] = v; },
    getPropertyValue: function (k) { return props[k] === undefined ? "" : props[k]; },
    removeProperty: function (k) { delete props[k]; },
    _p: props
  };
  el.hasAttribute = function (k) { return k in attrs; };
  el.setAttribute = function (k, v) { attrs[k] = String(v); };
  el.getAttribute = function (k) { return attrs[k]; };
  el.getBoundingClientRect = function () { return rect; };
  el.offsetWidth = offsetWidth || 0;
  el.focus = function () {};
  el.setPointerCapture = function (id) { captured.add(id); };
  el.hasPointerCapture = function (id) { return captured.has(id); };
  el.releasePointerCapture = function (id) { captured.delete(id); };
  el.contains = function (n) { return n === el; };
  el.closest = function () { return null; };
  el._captured = captured;
  return el;
}
function makeAudio() {
  var a = new EventTarget();
  a.duration = 200; a.currentTime = 50; a.paused = true; a.ended = false;
  a.playbackRate = 1; a.src = "x.mp3"; a.currentSrc = "x.mp3";
  a.playCalls = 0; a.pauseCalls = 0; a.rateHistory = [];
  a.play = function () { a.playCalls++; a.paused = false; return Promise.resolve(); };
  a.pause = function () { a.pauseCalls++; a.paused = true; };
  var rate = 1;
  Object.defineProperty(a, "playbackRate", { get: function () { return rate; }, set: function (v) { rate = v; a.rateHistory.push(v); } });
  return a;
}

var VI = require("./vinylInteraction.js");

// Geometría: disco centro (200,200) radio 100; brazo pivote (350,100)
function setup(extra) {
  var artFrame = makeEl({ left: 100, top: 100, width: 200, height: 200 }, 200);
  var tonearm = makeEl({ left: 340, top: 90, width: 20, height: 20 }, 20);
  var audio = makeAudio();
  var v = new VI(Object.assign({ artFrame: artFrame, audio: audio, tonearm: tonearm, showIndicator: false, armReachRatio: 1.8 }, extra || {}));
  return { v: v, el: artFrame, arm: tonearm, audio: audio };
}
// Punto del disco a ángulo (rad) y radio r
function pt(angle, r) { return { clientX: 200 + Math.cos(angle) * r, clientY: 200 + Math.sin(angle) * r }; }
var T = 5000;
function pe(type, p, extra) {
  return Object.assign({ type: type, pointerId: 1, pointerType: "mouse", button: 0, clientX: p.clientX, clientY: p.clientY, timeStamp: T, target: null, preventDefault: function () {} }, extra || {});
}

var tests = [], passed = 0, failed = 0;
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Gira el disco: devuelve el ángulo final. omega rad/s, pasos cada dtMs.
function spin(s, startAngle, omega, steps, dtMs, r) {
  r = r || 80;
  var a = startAngle;
  for (var i = 0; i < steps; i++) {
    a += omega * (dtMs / 1000);
    T += dtMs;
    s.v._onPointerMove(pe("pointermove", pt(a, r)));
    flushRafOnce();
  }
  return a;
}
function startDrag(s, a0, r) {
  r = r || 80;
  T += 100;
  s.v._onPointerDown(pe("pointerdown", pt(a0, r)));
  T += 16;
  s.v._onPointerMove(pe("pointermove", pt(a0 + 0.3, r))); // supera el umbral: arranca
  return a0 + 0.3;
}

// ---------- Fase 1 (regresión) ----------
test("F1: arrastre cambia currentTime y pausa/reanuda", function () {
  var s = setup(); s.audio.paused = false;
  var a = startDrag(s, 0);
  assert.strictEqual(s.audio.pauseCalls, 1);
  spin(s, a, 1.0, 10, 20);
  assert.notStrictEqual(s.audio.currentTime, 50);
  T += 300; // quieto antes de soltar => sin inercia
  s.v._onPointerUp(pe("pointerup", pt(0, 80)));
  assert.strictEqual(s.audio.playCalls, 1);
  assert.strictEqual(s.v.inertia, null);
});
test("F1: clic en el centro hace toggle y arrastre suprime clic posterior", function () {
  var s = setup(); var toggles = 0;
  s.v.opts.togglePlay = function () { toggles++; };
  s.v._onClick({ clientX: 200, clientY: 200, target: s.el });
  assert.strictEqual(toggles, 1);
  var a = startDrag(s, 0); spin(s, a, 1, 3, 20); T += 300;
  s.v._onPointerUp(pe("pointerup", pt(0, 80)));
  s.v._onClick({ clientX: 200, clientY: 200, target: s.el });
  assert.strictEqual(toggles, 1, "clic suprimido");
});
test("F1: cruce +π/-π no genera salto", function () {
  var d = VI.shortestAngleDelta(-3.1, 3.1);
  assert.ok(Math.abs(d) < 0.1);
});
test("F1: teclado y duración inválida", function () {
  var s = setup(); s.audio.duration = NaN;
  s.v._onKeyDown({ target: s.el, key: "ArrowRight", preventDefault: function () {}, stopPropagation: function () {} });
  assert.strictEqual(s.audio.currentTime, 50);
  s.v._onPointerDown(pe("pointerdown", pt(0, 80)));
  assert.strictEqual(s.v.drag, null);
});

// ---------- Scratch ----------
test("1. Baby Scratch hacia delante", function () {
  var s = setup(); s.audio.paused = false;
  var a = startDrag(s, 0);
  spin(s, a, 8, 8, 16);
  assert.ok(s.v.isScratching); assert.strictEqual(s.v.scratchDirection, 1);
  assert.ok(s.el.classList.contains("is-scratching") && s.el.classList.contains("is-scratch-forward"));
  assert.ok(!s.el.classList.contains("is-scratch-reverse"));
  assert.ok(s.audio.currentTime > 50);
  assert.ok(s.v.isScratching);
});
test("2. Baby Scratch hacia atrás con buffer invertido", function () {
  var s = setup(); s.audio.paused = false;
  var reverseHook = 0; s.v._onScratchReverse = function () { reverseHook++; };
  var a = startDrag(s, 0);
  spin(s, a, -8, 8, 16);
  assert.ok(s.v.isScratching); assert.strictEqual(s.v.scratchDirection, -1);
  assert.ok(s.el.classList.contains("is-scratch-reverse") && !s.el.classList.contains("is-scratch-forward"));
  assert.ok(s.audio.currentTime < 50);
  assert.ok(s.audio.rateHistory.every(function (r) { return r > 0; }));
  assert.ok(s.v.isScratching);
});
test("3. Activación por velocidad (lento no activa)", function () {
  var s = setup();
  var a = startDrag(s, 0);
  spin(s, a, 0.1, 1, 16);
  s.v.drag.smoothedVelocity = 0.1;
  s.v._updateScratch(s.v.drag);
  assert.ok(!s.v.isScratching);
  assert.ok(s.audio.rateHistory.length <= 1 && s.audio.rateHistory.every(function (r) { return r === 1; }));
});
test("4. Histéresis", function () {
  var s = setup(); var toggles = [];
  s.v.opts.onScratch = function (st) { toggles.push(st.active); };
  var a = startDrag(s, 0);
  a = spin(s, a, 8, 6, 16); assert.ok(s.v.isScratching);
  // velocidad intermedia entre los umbrales actuales: sigue activo
  var d = s.v.drag; d.smoothedVelocity = (s.v.opts.scratchStartVelocity + s.v.opts.scratchStopVelocity) / 2; s.v._updateScratch(d);
  assert.ok(s.v.isScratching, "no se apaga en banda de histéresis");
  d.smoothedVelocity = s.v.opts.scratchStopVelocity / 2; s.v._updateScratch(d);
  assert.ok(!s.v.isScratching, "se apaga bajo stop");
  d.smoothedVelocity = (s.v.opts.scratchStartVelocity + s.v.opts.scratchStopVelocity) / 2; s.v._updateScratch(d);
  assert.ok(!s.v.isScratching, "no se reenciende en la banda");
  d.smoothedVelocity = s.v.opts.scratchStartVelocity * 1.25; s.v._updateScratch(d);
  assert.ok(s.v.isScratching);
});
test("5. Restauración de playbackRate + clases", function () {
  var s = setup(); s.audio.playbackRate = 1.25; s.audio.paused = false;
  var a = startDrag(s, 0); spin(s, a, 9, 8, 16);
  T += 300; s.v._onPointerUp(pe("pointerup", pt(0, 80)));
  assert.strictEqual(s.audio.playbackRate, 1.25);
  ["is-scratching", "is-scratch-forward", "is-scratch-reverse"].forEach(function (c) { assert.ok(!s.el.classList.contains(c), c); });
});
test("6. Canción pausada permanece pausada", function () {
  var s = setup(); s.audio.paused = true;
  var a = startDrag(s, 0); spin(s, a, 9, 8, 16);
  assert.ok(s.v.isScratching);
  T += 300; s.v._onPointerUp(pe("pointerup", pt(0, 80)));
  assert.strictEqual(s.audio.playCalls, 0);
  assert.ok(s.audio.paused);
});
test("6b. Sonando: no hay play/pause por movimiento", function () {
  var s = setup(); s.audio.paused = false;
  var a = startDrag(s, 0); spin(s, a, 9, 30, 16);
  assert.ok(s.audio.playCalls <= 1, "play llamadas=" + s.audio.playCalls);
  assert.strictEqual(s.audio.pauseCalls, 1);
});

// ---------- Inercia ----------
function releaseWithSpeed(s, omega) {
  var a = startDrag(s, 0);
  a = spin(s, a, omega, 10, 16);
  s.v._onPointerUp(pe("pointerup", pt(a, 80)));
}
test("7. Inercia tras soltar", function () {
  var s = setup(); s.audio.paused = false;
  releaseWithSpeed(s, 4);
  assert.ok(s.v.inertia); assert.ok(rafQueue.length >= 1);
  var t0 = s.audio.currentTime;
  stepFrames(3);
  assert.ok(s.audio.currentTime > t0);
  assert.strictEqual(s.audio.playCalls, 1, "el scratch se escucha durante el gesto");
});
test("7b. Sin inercia si la velocidad es baja o el puntero estaba quieto", function () {
  var s = setup({ inertiaMinVelocity: 3 }); releaseWithSpeed(s, 0.2); assert.strictEqual(s.v.inertia, null);
  var s2 = setup({ inertiaStaleMs: 80 }); var a = startDrag(s2, 0); a = spin(s2, a, 5, 10, 16); T += 300;
  s2.v._onPointerUp(pe("pointerup", pt(a, 80))); assert.strictEqual(s2.v.inertia, null);
});
test("8. Fricción reduce la velocidad y termina sin RAF colgado", function () {
  var s = setup(); s.audio.paused = false;
  releaseWithSpeed(s, 3);
  var v0 = s.v.inertia.velocity;
  stepFrames(5);
  assert.ok(s.v.inertia && Math.abs(s.v.inertia.velocity) < Math.abs(v0));
  stepFrames(200);
  assert.strictEqual(s.v.inertia, null);
  assert.strictEqual(rafQueue.length, 0);
  assert.strictEqual(s.audio.playCalls, 2, "reanuda tras terminar la inercia");
});
test("8b. Duración máxima", function () {
  var s = setup({ inertiaFriction: 1, inertiaMaxDuration: 300 }); s.audio.duration = 2000; s.audio.currentTime = 1000;
  releaseWithSpeed(s, 3);
  stepFrames(60);
  assert.strictEqual(s.v.inertia, null); assert.strictEqual(rafQueue.length, 0);
});
test("9. Límite inferior exacto", function () {
  var s = setup(); s.audio.currentTime = 1; s.audio.paused = false;
  releaseWithSpeed(s, -6);
  stepFrames(30);
  assert.strictEqual(s.audio.currentTime, 0);
  assert.strictEqual(s.v.inertia, null); assert.strictEqual(rafQueue.length, 0);
  assert.strictEqual(s.audio.playCalls, 2);
});
test("10. Límite superior exacto, sin reanudar y nuevo gesto posible", function () {
  var s = setup(); s.audio.currentTime = 199; s.audio.paused = false;
  releaseWithSpeed(s, 6);
  stepFrames(30);
  assert.strictEqual(s.audio.currentTime, 200);
  assert.strictEqual(s.v.inertia, null); assert.strictEqual(rafQueue.length, 0);
  assert.strictEqual(s.audio.playCalls, 1);
  s.v._onPointerDown(pe("pointerdown", pt(0, 80)));
  assert.ok(s.v.drag);
});
test("11. Nuevo pointerdown cancela inercia, sin doble RAF, hereda wasPlaying", function () {
  var s = setup(); s.audio.paused = false;
  releaseWithSpeed(s, 4);
  stepFrames(2);
  var inFlight = rafQueue.length;
  T += 50; s.v._onPointerDown(pe("pointerdown", pt(0, 80)));
  assert.strictEqual(s.v.inertia, null); assert.strictEqual(rafQueue.length, 0);
  assert.ok(inFlight <= 1);
  T += 16; var tPos = s.audio.currentTime;
  s.v._onPointerMove(pe("pointermove", pt(0.3, 80)));
  assert.strictEqual(s.v.drag.wasPlaying, true, "hereda sonando");
  assert.strictEqual(s.v.drag.startTime, tPos, "parte de la posición actual");
  T += 300; s.v._onPointerUp(pe("pointerup", pt(0.3, 80)));
  assert.strictEqual(s.audio.playCalls, 2);
});
test("11b. pointerdown en el centro durante inercia devuelve el audio una vez", function () {
  var s = setup(); s.audio.paused = false;
  releaseWithSpeed(s, 4); stepFrames(1);
  s.v._onPointerDown(pe("pointerdown", { clientX: 200, clientY: 200 }));
  assert.strictEqual(s.v.inertia, null); assert.strictEqual(s.audio.playCalls, 2);
});
test("12. Cancelación al cambiar de canción (loadstart/emptied)", function () {
  ["loadstart", "emptied"].forEach(function (ev) {
    var s = setup(); s.audio.paused = false; s.audio.playbackRate = 1.1;
    releaseWithSpeed(s, 4); stepFrames(1);
    s.audio.dispatchEvent(new Event(ev));
    assert.strictEqual(s.v.inertia, null); assert.strictEqual(rafQueue.length, 0);
    assert.strictEqual(s.audio.playCalls, 1, "la reproducción iniciada por scratch se cancela");
    assert.strictEqual(s.audio.playbackRate, 1.1);
    assert.ok(!s.el.classList.contains("is-scratching"));
  });
  // y durante scratch activo
  var s2 = setup(); s2.audio.paused = false; var a = startDrag(s2, 0); spin(s2, a, 9, 8, 16);
  s2.audio.dispatchEvent(new Event("loadstart"));
  assert.strictEqual(s2.v.drag, null); assert.ok(!s2.v.isScratching); assert.strictEqual(s2.audio.playbackRate, 1);
});

// ---------- Brazo ----------
function armAngleAtRatio(s, ratio) { s.v._geomDirty = true; return s.v._angleForRadiusRatio(ratio); }
function armDown(s, id) {
  var p = s.v._getTonearmPivot();
  // puntero en la dirección actual de la aguja para el ángulo de reposo
  var dir = (s.v._readArmAngle() + s.v.opts.armZeroAngleDeg) * Math.PI / 180;
  return { clientX: p.x + Math.cos(dir) * 100, clientY: p.y + Math.sin(dir) * 100, pointerId: id || 7 };
}
// Mueve el puntero para que el ángulo del brazo sea targetDeg partiendo del inicio actual
function armDragTo(s, targetDeg, id) {
  var p = s.v._armPivot;
  var dir = (targetDeg + s.v.opts.armZeroAngleDeg) * Math.PI / 180;
  // pasos pequeños para no saltar
  var cur = s.v.manualArm.currentArmAngle, n = Math.max(1, Math.ceil(Math.abs(targetDeg - cur) / 5));
  for (var i = 1; i <= n; i++) {
    var ang = (cur + (targetDeg - cur) * i / n + s.v.opts.armZeroAngleDeg) * Math.PI / 180;
    s.v._onArmPointerMove({ pointerId: id || 7, clientX: p.x + Math.cos(ang) * 100, clientY: p.y + Math.sin(ang) * 100 });
  }
}
test("13. pointerdown del brazo", function () {
  var s = setup(); s.audio.paused = false;
  var d = armDown(s);
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0, preventDefault: function () {} }, d));
  var st = s.v.getManualArmState();
  assert.ok(st.active); assert.strictEqual(st.wasPlaying, true); assert.strictEqual(s.audio.pauseCalls, 0);
  assert.strictEqual(s.audio.currentTime, 50, "no cambia currentTime");
  assert.ok(s.arm._captured.has(7));
  assert.strictEqual(s.arm.dataset.state, "manual-dragging");
  assert.ok(s.arm.classList.contains("is-manual") && s.arm.classList.contains("is-lifted") && s.arm.classList.contains("is-dragging"));
  s.v.cancelManualArm();
});
test("13b. El brazo no inicia arrastre del vinilo y viceversa", function () {
  var s = setup(); s.arm.contains = function (n) { return n === s.arm; };
  s.v._onPointerDown(pe("pointerdown", pt(0, 80), { target: s.arm }));
  assert.strictEqual(s.v.drag, null);
  var d = armDown(s);
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, d));
  s.v._onPointerDown(pe("pointerdown", pt(0, 80)));
  assert.strictEqual(s.v.drag, null, "disco ignora mientras el brazo está activo");
  var toggles = 0; s.v.opts.togglePlay = function () { toggles++; };
  s.v._onClick({ clientX: 200, clientY: 200, target: s.arm });
  assert.strictEqual(toggles, 0);
  s.v.cancelManualArm();
  // brazo ignorado si el disco arrastra
  var s2 = setup(); var a = startDrag(s2, 0);
  s2.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s2)));
  assert.ok(!s2.v.manualArm.active);
});
test("13c. Botón secundario ignorado", function () {
  var s = setup();
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 2 }, armDown(s)));
  assert.ok(!s.v.manualArm.active);
});
test("14. Movimiento del brazo", function () {
  var s = setup();
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, 40);
  assert.ok(Math.abs(s.v.manualArm.currentArmAngle - 40) < 1.5);
  assert.ok(/deg$/.test(s.arm.style._p["--tonearm-angle"]));
  s.v.cancelManualArm();
});
test("14b. No se escribe estilo si el cambio es insignificante", function () {
  var s = setup(); var writes = 0;
  var orig = s.arm.style.setProperty; s.arm.style.setProperty = function (k, v) { writes++; orig(k, v); };
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, 30); var w = writes; var before = s.arm.style.getPropertyValue("--tonearm-angle");
  var direction = (30 + s.v.opts.armZeroAngleDeg) * Math.PI / 180;
  s.v._onArmPointerMove({ pointerId: 7, clientX: s.v._armPivot.x + Math.cos(direction) * 100 + 0.01, clientY: s.v._armPivot.y + Math.sin(direction) * 100 });
  assert.strictEqual(writes, w);
  assert.strictEqual(s.arm.style.getPropertyValue("--tonearm-angle"), before);
  s.v.cancelManualArm();
});
test("15. Límite angular (sin windup ni NaN)", function () {
  var s = setup();
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, 110);
  // empuja mucho más allá dando vueltas
  var p = s.v._armPivot;
  for (var i = 0; i < 200; i++) {
    var ang = (110 + i * 7 + 90) * Math.PI / 180;
    s.v._onArmPointerMove({ pointerId: 7, clientX: p.x + Math.cos(ang) * 100, clientY: p.y + Math.sin(ang) * 100 });
  }
  var c = s.v.manualArm.currentArmAngle;
  var bounds = s.v._getManualArmBounds();
  assert.ok(c <= bounds.max && c >= bounds.min && !isNaN(c));
  s.v._onArmPointerMove({ pointerId: 7, clientX: NaN, clientY: NaN });
  assert.ok(!isNaN(s.v.manualArm.currentArmAngle));
  s.v.cancelManualArm();
});
test("16. Detección de surco y conversión de radio a tiempo", function () {
  var s = setup(); s.audio.paused = true;
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  var mid = (0.96 + 0.35) / 2;
  var ang = armAngleAtRatio(s, mid);
  armDragTo(s, ang);
  var z = s.v._getArmDropZone();
  assert.strictEqual(z.zone, "record");
  assert.ok(Math.abs(z.progress - 0.5) < 0.05, "progress=" + z.progress);
  s.v._onArmPointerUp({ pointerId: 7 });
  assert.ok(Math.abs(s.audio.currentTime - z.progress * 200) < 6, "t=" + s.audio.currentTime);
  assert.strictEqual(s.audio.playCalls, 0, "pausado sigue pausado");
  assert.strictEqual(s.arm.dataset.state, "on-record");
  assert.ok(s.arm.classList.contains("is-on-record") && !s.arm.classList.contains("is-dragging"));
});
test("16b. Soltar en surco con música sonando no reinicia la reproducción", function () {
  var s = setup(); s.audio.paused = false;
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, armAngleAtRatio(s, 0.8));
  s.v._onArmPointerUp({ pointerId: 7 });
  assert.strictEqual(s.audio.playCalls, 0); assert.strictEqual(s.audio.pauseCalls, 0);
});
test("17. Detección de etiqueta: encaja en el surco interior", function () {
  var s = setup(); s.audio.paused = true;
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  var ang = armAngleAtRatio(s, 0.25);
  armDragTo(s, ang);
  assert.strictEqual(s.v._getArmDropZone().zone, "label");
  s.v._onArmPointerUp({ pointerId: 7 });
  var finalZone = s.v._getArmDropZone(s.v.manualArm.currentArmAngle);
  assert.ok(finalZone.zone === "record" || finalZone.zone === "label", "no queda fuera del disco");
  assert.ok(s.audio.currentTime <= 0.995 * 200 && s.audio.currentTime > 150);
});
test("17b. Cerca del eje es inválido", function () {
  var s = setup();
  s.v.manualArm.currentArmAngle = armAngleAtRatio(s, 0.0);
  var z = s.v._getArmDropZone();
  assert.ok(z.zone === "invalid" || z.zone === "label");
});
test("18. Detección del soporte / exterior", function () {
  var s = setup(); s.audio.paused = false;
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, -20);
  assert.strictEqual(s.v._getArmDropZone().zone, "rest");
  var t0 = s.audio.currentTime;
  s.v._onArmPointerUp({ pointerId: 7 });
  assert.strictEqual(s.audio.currentTime, t0); assert.ok(!s.audio.paused); assert.strictEqual(s.audio.playCalls, 0);
  assert.strictEqual(s.arm.style.getPropertyValue("--tonearm-angle"), "", "valor automático restaurado");
  // outer
  var s2 = setup();
  s2.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s2)));
  s2.v._geomDirty = true;
  var found = null;
  for (var a = -20; a <= 110; a += 1) { var z = s2.v._getArmDropZone(a); if (z.zone === "outer") { found = a; break; } }
  if (found !== null) { armDragTo(s2, found); assert.strictEqual(s2.v._getArmDropZone().zone, "outer"); }
  s2.v._onArmPointerUp({ pointerId: 7 });
  assert.ok(s2.audio.paused);
});
test("19. Cancelación del brazo (pointercancel y loadstart)", function () {
  var s = setup(); s.audio.paused = false; s.arm.style.setProperty("--tonearm-angle", "-12deg");
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, 50);
  s.v._onArmPointerCancel({ pointerId: 7 });
  assert.ok(!s.v.manualArm.active); assert.ok(!s.arm._captured.has(7));
  assert.strictEqual(s.arm.style.getPropertyValue("--tonearm-angle"), "-12deg");
  assert.strictEqual(s.arm.dataset.state, undefined);
  ["is-manual", "is-lifted", "is-on-record", "is-dragging"].forEach(function (c) { assert.ok(!s.arm.classList.contains(c)); });
  assert.strictEqual(s.audio.playCalls, 0, "pointercancel no duplica play mientras sigue sonando");

  var s2 = setup(); s2.audio.paused = false;
  s2.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s2)));
  s2.audio.dispatchEvent(new Event("loadstart"));
  assert.ok(!s2.v.manualArm.active); assert.strictEqual(s2.audio.playCalls, 0, "no reproduce la canción nueva");
});
test("19b. lostpointercapture tras pointerup no reentra", function () {
  var s = setup(); s.audio.paused = true;
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, armAngleAtRatio(s, 0.7));
  s.v._onArmPointerUp({ pointerId: 7 });
  var st = s.arm.dataset.state;
  s.v._onArmPointerCancel({ pointerId: 7 });
  assert.strictEqual(s.arm.dataset.state, st);
});
test("19c. Adaptador del brazo", function () {
  var s = setup(); var calls = [];
  s.v.setTonearmAdapter({
    setManualAngle: function (a) { calls.push(["angle", a]); },
    beginManualControl: function () { calls.push(["begin"]); },
    endManualControl: function () { calls.push(["end"]); },
    setManualHold: function (v) { calls.push(["hold", v]); }
  });
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, 40);
  s.v._onArmPointerCancel({ pointerId: 7 });
  var names = calls.map(function (c) { return c[0]; });
  assert.ok(names.indexOf("begin") >= 0 && names.indexOf("angle") >= 0 && names.indexOf("end") >= 0);
  assert.strictEqual(s.arm.style.getPropertyValue("--tonearm-angle"), "", "con adaptador no se usa el fallback CSS");
});
test("19d. Inercia se cancela al tomar el brazo", function () {
  var s = setup(); s.audio.paused = false; releaseWithSpeed(s, 4);
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  assert.strictEqual(s.v.inertia, null); assert.strictEqual(rafQueue.length, 0);
  assert.strictEqual(s.v.manualArm.wasPlaying, true);
  s.v.cancelManualArm();
});
test("20. Ausencia de brazo", function () {
  var artFrame = makeEl({ left: 100, top: 100, width: 200, height: 200 }, 200);
  var audio = makeAudio();
  var v = new VI({ artFrame: artFrame, audio: audio, showIndicator: false });
  assert.strictEqual(v.beginManualArm({}), false);
  assert.strictEqual(v.cancelManualArm(), false);
  assert.strictEqual(v.endManualArm(), null);
  assert.strictEqual(v._getArmDropZone().zone, "invalid");
  v.destroy();
});
test("21. Duración inexistente", function () {
  var s = setup(); s.audio.duration = NaN;
  s.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s)));
  armDragTo(s, armAngleAtRatio(s, 0.7));
  assert.doesNotThrow(function () { s.v._onArmPointerUp({ pointerId: 7 }); });
  assert.strictEqual(s.v._startInertia(5, true), false);
});
test("22. Sin listeners duplicados y destroy limpia", function () {
  var count = 0, countArm = 0;
  var origDown = VI.prototype._onPointerDown, origArm = VI.prototype._onArmPointerDown;
  VI.prototype._onPointerDown = function () { count++; };
  VI.prototype._onArmPointerDown = function () { countArm++; };
  try {
    var s = setup();
    var v2 = new VI({ artFrame: s.el, audio: s.audio, tonearm: s.arm, showIndicator: false }); // destruye la anterior
    s.el.dispatchEvent(new Event("pointerdown"));
    s.arm.dispatchEvent(new Event("pointerdown"));
    assert.strictEqual(count, 1); assert.strictEqual(countArm, 1);
    v2.destroy();
    s.el.dispatchEvent(new Event("pointerdown")); s.arm.dispatchEvent(new Event("pointerdown"));
    assert.strictEqual(count, 1); assert.strictEqual(countArm, 1);
  } finally { VI.prototype._onPointerDown = origDown; VI.prototype._onArmPointerDown = origArm; }
});
test("23. destroy en pleno scratch / inercia / brazo", function () {
  var s = setup(); s.audio.paused = false; s.audio.playbackRate = 1.3;
  var a = startDrag(s, 0); spin(s, a, 9, 8, 16);
  s.v.destroy();
  assert.strictEqual(s.audio.playbackRate, 1.3); assert.strictEqual(rafQueue.length, 0);
  ["is-scratching", "is-scratch-forward", "is-scratch-reverse", "is-interactive"].forEach(function (c) { assert.ok(!s.el.classList.contains(c), c); });
  var s2 = setup(); releaseWithSpeed(s2, 4); s2.v.destroy(); assert.strictEqual(rafQueue.length, 0); assert.strictEqual(s2.v.inertia, null);
  var s3 = setup(); s3.v._onArmPointerDown(Object.assign({ pointerType: "mouse", button: 0 }, armDown(s3))); s3.v.destroy();
  assert.ok(!s3.v.manualArm.active); assert.strictEqual(s3.arm.dataset.state, undefined);
  assert.strictEqual(s3.el.__auraVinyl, undefined);
});
test("24. Scratch con idle: puntero quieto suelta el disco", function (done) {
  var s = setup(); s.audio.paused = false;
  var a = startDrag(s, 0); spin(s, a, 9, 8, 16);
  assert.ok(s.v.isScratching);
  return new Promise(function (res) {
    setTimeout(function () {
      assert.ok(!s.v.isScratching); assert.strictEqual(s.audio.playbackRate, 1);
      assert.ok(s.audio.paused, "vuelve a pausa durante el arrastre quieto");
      s.v.destroy(); res();
    }, 200);
  });
});
test("25. Estado de módulo: exports y sin setInterval", function () {
  assert.strictEqual(typeof VI, "function"); assert.strictEqual(globalThis.AuraVinylInteraction, VI);
  var src = require("fs").readFileSync(__dirname + "/vinylInteraction.js", "utf8");
  assert.ok(!/setInterval/.test(src));
});

(async function () {
  for (var i = 0; i < tests.length; i++) {
    try { rafQueue = []; await tests[i].fn(); passed++; console.log("  ok   " + tests[i].name); }
    catch (e) { failed++; console.log("  FAIL " + tests[i].name + "\n       " + (e && e.message)); }
  }
  console.log("\n" + passed + " pasaron, " + failed + " fallaron");
  process.exit(failed ? 1 : 0);
})();
