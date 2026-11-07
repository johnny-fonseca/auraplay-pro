"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Uso: node test_utils.js [ruta/a/utils.js]   (por defecto ./utils.js junto a este archivo)
const UTILS_PATH = require("path").resolve(process.argv[2] || require("path").join(__dirname, "utils.js"));
const U = require(UTILS_PATH);
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error("FALLA:", name, "\n ", e.message); process.exitCode = 1; } };
const eq = (a, b) => assert.strictEqual(a, b);

/* ---------- formatTime ---------- */
t("formatTime básico", () => {
  eq(U.formatTime(0), "0:00"); eq(U.formatTime(65), "1:05"); eq(U.formatTime(3725), "1:02:05");
  eq(U.formatTime("65"), "1:05"); eq(U.formatTime(10n), "0:10");
});
t("formatTime hostil", () => {
  for (const v of [NaN, Infinity, -Infinity, -5, -0.4, null, undefined, {}, [], Symbol("x"),
    { valueOf() { throw new Error("x"); } }]) eq(U.formatTime(v), "0:00");
  assert.match(U.formatTime(1e30), /^\d+:\d\d:\d\d$/);
});

/* ---------- formatBytes ---------- */
t("formatBytes", () => {
  eq(U.formatBytes(0), "0 B"); eq(U.formatBytes(1023), "1023 B"); eq(U.formatBytes(1024), "1.0 KB");
  eq(U.formatBytes(1536), "1.5 KB"); eq(U.formatBytes(1048575), "1.0 MB");
  eq(U.formatBytes(Infinity), "0 B"); eq(U.formatBytes(-3), "0 B");
  assert.ok(!/undefined|NaN/.test(U.formatBytes(0.5)));
  assert.ok(U.formatBytes(1e30).endsWith("TB"));
  assert.doesNotThrow(() => U.formatBytes(5000, 999));
  assert.doesNotThrow(() => U.formatBytes(5000, -4));
  eq(U.formatBytes(5000, "x"), "4.9 KB");
});

/* ---------- escapeHTML ---------- */
t("escapeHTML", () => {
  eq(U.escapeHTML(`<a href="x">'&\``), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#96;");
  eq(U.escapeHTML(null), ""); eq(U.escapeHTML(undefined), ""); eq(U.escapeHTML(0), "0");
  eq(U.escapeHTML(Object.create(null)), "");
});

/* ---------- cleanName / pick* ---------- */
t("cleanName", () => {
  eq(U.cleanName("01_mi-cancion.final.mp3"), "01 mi cancion.final");
  eq(U.cleanName("Mr. Brightside"), "Mr. Brightside");
  eq(U.cleanName("C:\\music\\a_b.mp3"), "a b");
  eq(U.cleanName("/x/y/Artista - Tema.mp3"), "Artista - Tema");
  eq(U.cleanName("  tema.mp3  "), "tema");
  eq(U.cleanName("a\tb\nc.mp3"), "a b c");
  eq(U.cleanName(null), ""); eq(U.cleanName(Object.create(null)), "");
  eq(U.cleanName(123), "123");
  assert.doesNotThrow(() => U.cleanName("a-".repeat(200000)));
  assert.doesNotThrow(() => U.cleanName("-".repeat(200000)));
});
t("pickTitle", () => {
  eq(U.pickTitle({ title: "  X " }, "a.mp3"), "X");
  eq(U.pickTitle(null, "Inna - Morenito.mp3"), "Morenito");
  eq(U.pickTitle(null, "01 - Queen - Bohemian.mp3"), "Bohemian");
  eq(U.pickTitle(null, "01 - Tema.mp3"), "Tema");
  eq(U.pickTitle(null, ""), "Sin título");
  eq(U.pickTitle({ get title() { throw new Error("boom"); } }, "z.mp3"), "z");
  eq(U.pickTitle({ title: 1999 }, "z.mp3"), "1999");
  eq(U.pickTitle("string", undefined), "Sin título");
});
t("pickArtist", () => {
  eq(U.pickArtist(null, "01 - Tema.mp3"), "Artista desconocido");
  eq(U.pickArtist(null, "Inna - Morenito.mp3"), "Inna");
  eq(U.pickArtist(null, "Queen - Bohemian.mp3"), "Queen");
  eq(U.pickArtist(null, "01 - Queen - Bohemian.mp3"), "Queen");
  eq(U.pickArtist({ artist: " A " }, "x - y.mp3"), "A");
  eq(U.pickArtist(undefined), "Artista desconocido");
  assert.doesNotThrow(() => U.pickArtist(null, "a ".repeat(100000) + " - x"));
});
t("pickAlbum", () => { eq(U.pickAlbum({ album: " Z " }), "Z"); eq(U.pickAlbum(null), ""); eq(U.pickAlbum({ album: {} }), ""); });

/* ---------- clamp ---------- */
t("clamp", () => {
  eq(U.clamp(5, 0, 3), 3); eq(U.clamp(NaN, 1, 2), 1); eq(U.clamp(5, 3, 0), 3);
  eq(U.clamp(Infinity, 0, 1), 1); eq(U.clamp(-Infinity, 0, 1), 0);
  eq(U.clamp(1, NaN, NaN), 1); eq(U.clamp("x", undefined, undefined), 0);
  eq(U.clamp(Symbol("s"), 2, 4), 2); eq(U.clamp(7, undefined, 4), 4);
});

/* ---------- baseName / safeFileName ---------- */
t("baseName", () => {
  eq(U.baseName("Tema.LRC"), "tema"); eq(U.baseName("dir\\tema.mp3"), "tema");
  eq(U.baseName("Tema.LRC"), U.baseName("tema.mp3"));
  eq(U.baseName("e\u0301.mp3"), U.baseName("\u00e9.MP3"));
  eq(U.baseName(null), "");
});
t("safeFileName", () => {
  eq(U.safeFileName("a/b:c?.mp3"), "a_b_c_.mp3");
  eq(U.safeFileName("CON"), "_CON"); eq(U.safeFileName("con.txt"), "_con.txt");
  eq(U.safeFileName(""), "archivo"); eq(U.safeFileName("..."), "archivo"); eq(U.safeFileName(null), "archivo");
  eq(U.safeFileName(null, "otro"), "otro"); eq(U.safeFileName(null, "CON"), "_CON");
  eq(U.safeFileName("x\u202eevil"), "xevil");
  const long = U.safeFileName("a".repeat(500) + ".mp3");
  assert.ok(long.endsWith(".mp3") && long.length <= 180);
  const emoji = U.safeFileName("😀".repeat(400));
  assert.ok(Array.from(emoji).length <= 180);
  assert.doesNotThrow(() => encodeURIComponent(emoji));        // sin sustitutos huérfanos
  eq(U.safeFileName(Object.create(null)), "archivo");
});

/* ---------- archivos ---------- */
t("isAudioFile / isLrcFile", () => {
  eq(U.isAudioFile({ name: "a.MP3", type: "" }), true);
  eq(U.isAudioFile({ name: "a.txt", type: "text/plain" }), false);
  eq(U.isAudioFile({ name: "a.mp4", type: "video/mp4" }), true);
  eq(U.isAudioFile({ name: "x", type: "audio/x-m4a" }), true);
  eq(U.isAudioFile(null), false); eq(U.isAudioFile(undefined), false); eq(U.isAudioFile("a.mp3"), false);
  eq(U.isAudioFile({ get type() { throw new Error("b"); }, get name() { throw new Error("b"); } }), false);
  eq(U.isLrcFile({ name: "x.LRC" }), true); eq(U.isLrcFile({ name: "x.mp3" }), false); eq(U.isLrcFile(null), false);
});
t("download sin DOM", () => {
  eq(U.download(null, "x"), false); eq(U.download({}, "x"), false); eq(U.download("hola", "x"), false);
});

/* ---------- uid ---------- */
t("uid único (10 000)", () => {
  const s = new Set();
  for (let i = 0; i < 10000; i++) s.add(U.uid());
  eq(s.size, 10000);
  for (const id of s) { assert.match(id, /^id-[0-9a-f]{12}[0-9a-z]+$/); break; }
});

/* ---------- once ---------- */
t("once", () => {
  let n = 0; const f = U.once(() => ++n);
  f(); f(); eq(n, 1); eq(f(), 1);
  let tries = 0; const g = U.once(() => { if (++tries < 2) throw new Error("x"); return "ok"; });
  assert.throws(() => g()); eq(g(), "ok"); eq(g(), "ok");
  eq(typeof U.once(null), "function");
});

/* ---------- asíncronos ---------- */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error("FALLA:", name, "\n ", e.message); process.exitCode = 1; } };

  await check("debounce agrupa y usa últimos args", async () => {
    const calls = []; const d = U.debounce((x) => calls.push(x), 30);
    d(1); d(2); d(3); assert.ok(d.pending()); await sleep(80);
    assert.deepStrictEqual(calls, [3]); assert.ok(!d.pending());
  });
  await check("debounce cancel / flush", async () => {
    const calls = []; const d = U.debounce((x) => { calls.push(x); return x * 2; }, 30);
    d(1); d.cancel(); await sleep(60); eq(calls.length, 0);
    d(5); eq(d.flush(), 10); await sleep(60); assert.deepStrictEqual(calls, [5]);
  });
  await check("debounce robusto", async () => {
    assert.doesNotThrow(() => U.debounce(null)());
    assert.doesNotThrow(() => U.debounce(() => {}, NaN)());
    let n = 0; const d = U.debounce(() => { n++; throw new Error("cb"); }, 5);
    const origErr = console.error; console.error = () => {};
    d(); await sleep(30); d(); await sleep(30); console.error = origErr;
    eq(n, 2);                                              // sigue funcionando tras un fallo
    let big = 0; const e = U.debounce(() => big++, 1e12); e(); await sleep(30); eq(big, 0);   // no dispara de inmediato
    e.cancel();
  });
  await check("debounce conserva this", async () => {
    let seen; const o = { v: 7, m: U.debounce(function () { seen = this.v; }, 5) };
    o.m(); await sleep(30); eq(seen, 7);
  });
  await check("throttle primero inmediato + último trailing", async () => {
    const calls = []; const th = U.throttle((x) => calls.push(x), 50);
    th(1); th(2); th(3); assert.deepStrictEqual(calls, [1]);
    await sleep(100); assert.deepStrictEqual(calls, [1, 3]);
  });
  await check("throttle cancel / robusto", async () => {
    const calls = []; const th = U.throttle((x) => calls.push(x), 50);
    th(1); th(2); th.cancel(); await sleep(80); assert.deepStrictEqual(calls, [1]);
    assert.doesNotThrow(() => U.throttle(undefined)());
    const origErr = console.error; console.error = () => {};
    const bad = U.throttle(() => { throw new Error("cb"); }, 1);
    assert.doesNotThrow(() => { bad(); bad(); }); console.error = origErr;
  });
  await check("rafThrottle (sin rAF)", async () => {
    const calls = []; const r = U.rafThrottle((x) => calls.push(x));
    r(1); r(2); r(3); await sleep(60); assert.deepStrictEqual(calls, [3]);
    r(4); r.cancel(); await sleep(60); assert.deepStrictEqual(calls, [3]);
    r(5); r.flush(); assert.deepStrictEqual(calls, [3, 5]);
  });
  await check("sleep", async () => {
    const t0 = Date.now(); await U.sleep(40); assert.ok(Date.now() - t0 >= 30);
    await U.sleep(NaN); await U.sleep(undefined); await U.sleep(-5);
  });
  await check("sleep con AbortSignal", async () => {
    const ac = new AbortController(); const p = U.sleep(1000, ac.signal); ac.abort();
    await assert.rejects(p);
    const ac2 = new AbortController(); ac2.abort();
    await assert.rejects(U.sleep(10, ac2.signal));
    await U.sleep(5, new AbortController().signal);
  });

  /* ---------- fuzz: ninguna función lanza con valores hostiles ---------- */
  await check("fuzz", async () => {
    const hostile = new Proxy({}, { get() { throw new Error("boom"); }, has() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } });
    const bag = [undefined, null, NaN, Infinity, -Infinity, 0, -0, -1, 1e308, 2 ** 53, "", "  ", "x".repeat(1e6), "\u0000\u202e\ud800",
      true, false, 10n, Symbol("s"), {}, [], [1, 2], () => {}, function () {}, new Date(NaN), /re/g, Object.create(null),
      hostile, { toString() { throw new Error("x"); }, valueOf() { throw new Error("x"); } },
      { name: Object.create(null), type: hostile }, new Map(), new Uint8Array(3)];
    const sync = ["formatTime", "formatBytes", "escapeHTML", "cleanName", "pickTitle", "pickArtist", "pickAlbum",
      "clamp", "isAudioFile", "isLrcFile", "baseName", "safeFileName", "download"];
    let runs = 0;
    for (const name of sync) for (const a of bag) for (const b of bag.slice(0, 12)) {
      const r = U[name](a, b, a); runs++;
      if (["formatTime", "formatBytes", "escapeHTML", "cleanName", "pickTitle", "pickArtist", "pickAlbum", "baseName", "safeFileName"].includes(name))
        assert.strictEqual(typeof r, "string", `${name} debe devolver string`);
    }
    for (const a of bag) {
      for (const name of ["debounce", "throttle", "rafThrottle", "once"]) { const f = U[name](a, a); if (typeof f === "function") { f(a); f.cancel && f.cancel(); } }
      U.sleep(a, a).catch(() => {});
    }
    eq(U.uid().startsWith("id-"), true);
    console.log(`  fuzz: ${runs} llamadas sin excepción`);
  });

  /* ---------- entorno limpio: sin window / document / crypto / rAF ---------- */
  await check("vm sin globals (fallback uid, export a global)", async () => {
    const ctx = vm.createContext({ console, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync(UTILS_PATH, "utf8"), ctx);
    const A = ctx.AuraUtils;
    assert.ok(A && typeof A.formatTime === "function");
    const ids = new Set(); for (let i = 0; i < 5000; i++) ids.add(A.uid());
    eq(ids.size, 5000);
    for (const id of ids) { assert.match(id, /^id-[0-9a-f]{12}[0-9a-z]+$/); break; }
    const { clamp, formatTime } = A;                        // desestructurado: no depende de this
    eq(clamp(9, 0, 5), 5); eq(formatTime(61), "1:01");
    eq(A.download(new Uint8Array(1), "x"), false);
  });

  /* ---------- download con DOM simulado ---------- */
  await check("download con DOM simulado", async () => {
    const events = [];
    const anchor = { style: {}, click() { events.push("click:" + this.download); }, remove() { events.push("remove"); } };
    const ctx = vm.createContext({
      console, setTimeout, clearTimeout, Blob,
      URL: { createObjectURL: () => { events.push("create"); return "blob:x"; }, revokeObjectURL: () => events.push("revoke") },
      document: { createElement: () => anchor, body: { appendChild: () => events.push("append") }, documentElement: {} },
    });
    vm.runInContext(fs.readFileSync(UTILS_PATH, "utf8"), ctx);
    eq(ctx.AuraUtils.download(new Blob(["hola"]), "a/b?.txt"), true);
    assert.deepStrictEqual(events, ["create", "append", "click:a_b_.txt", "remove"]);
    eq(ctx.AuraUtils.download("texto", "t.txt"), true);     // string → se envuelve en Blob
    eq(ctx.AuraUtils.download(12345, "t.txt"), false);
    // si click lanza: devuelve false y revoca la URL
    events.length = 0; anchor.click = () => { throw new Error("nope"); };
    const origErr = console.error; console.error = () => {};
    eq(ctx.AuraUtils.download(new Blob(["x"]), "x"), false); console.error = origErr;
    assert.ok(events.includes("revoke") && events.includes("remove"));
  });

  console.log(`\n${process.exitCode ? "HAY FALLOS" : "OK"} — ${passed} grupos de pruebas pasados`);
  process.exit(process.exitCode || 0);   // el fuzz deja timers largos (sleep(Infinity)) a propósito
})();
