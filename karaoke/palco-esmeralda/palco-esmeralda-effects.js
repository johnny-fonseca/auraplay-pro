/*!
 * Palco Esmeralda — escena Canvas 2D para el Karaoke de AuraPlay Pro.
 *
 * Plugin visual puro: no renderiza letras ni controles, no analiza audio y no
 * duplica el núcleo. Dibuja solo ornamentación de fondo y de contorno
 * (cortinas de terciopelo, bambalina, luces de rampa, polvo en suspensión) y
 * deja libre la columna central donde vive la letra sincronizada.
 *
 * Orden de carga: karaoke/shared/karaoke-core.js  →  este archivo
 * (ambos como <script defer>, en ese orden).
 *
 * Contrato del frame que consume (ver README.md, "Contrato del frame"):
 *   w, h, dpr, dt (ms), tm (ms), bands.{bass,mid,high}, beat.{pulse,hit,strength,bpm},
 *   q, motion, reduced, playing.
 */
(function (global) {
  'use strict';

  var SLUG = 'palco-esmeralda';
  var core = global.AuraKaraokeCore;
  if (!core || typeof core.registerScene !== 'function') {
    throw new Error(
      '[' + SLUG + '] AuraKaraokeCore no está disponible: carga karaoke/shared/karaoke-core.js ' +
      'antes de karaoke/' + SLUG + '/' + SLUG + '-effects.js (ambos con <script defer>, núcleo primero).'
    );
  }
  // Evita registrar dos veces si el script se incluye por error en duplicado.
  if (global.__auraKaraokeScenePalcoEsmeralda) { return; }
  global.__auraKaraokeScenePalcoEsmeralda = true;

  /* ------------------------------------------------------------------ *
   *  Suposiciones del contrato (verificar en el proyecto real; ver
   *  INTEGRATION.md §1). Son los únicos dos interruptores del plugin.
   * ------------------------------------------------------------------ */
  // true  → frame.w/h están en píxeles de dispositivo y el ctx NO está escalado por dpr.
  // false → frame.w/h están en píxeles CSS y el núcleo ya aplicó ctx.setTransform(dpr,…).
  var FRAME_IN_DEVICE_PX = false;
  // true → la escena limpia el canvas al empezar cada frame (inofensivo si el núcleo ya lo hace).
  var CLEAR_FIRST = true;

  var TAU = Math.PI * 2;

  /* ------------------------------ paleta ----------------------------- */
  var PAL = {
    abyss:   [3, 9, 7],
    pine:    [6, 21, 15],
    vDeep:   [10, 36, 25],
    velvet:  [15, 58, 42],
    vLit:    [28, 106, 75],
    bDeep:   [125, 95, 43],
    brass:   [201, 164, 92],
    bLit:    [236, 212, 155],
    ivory:   [246, 240, 223],
    warm:    [255, 226, 160],
    ruby:    [209, 71, 95],
    rubyLit: [255, 141, 160]
  };

  /* ----------------------------- utilidades -------------------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
  }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  // Seguimiento exponencial con ataque/relajación distintos (suaviza el audio).
  function follow(cur, target, dt, up, down) {
    var tau = target > cur ? up : down;
    return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 0.001)));
  }
  // PRNG determinista (mulberry32): mismas cortinas/motas en cada resize.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(w, h) {
    var c = global.document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctx2d(c) {
    var x = c.getContext('2d');
    if (!x) { throw new Error('[' + SLUG + '] Canvas 2D no disponible.'); }
    return x;
  }

  // q = presupuesto de calidad. SUPUESTO: número en (0,1] como fracción, o nivel
  // entero 2–4 (4 = máximo); también acepta un objeto con scale/density/level.
  // Ajustar solo esta función si el núcleo usa otra escala.
  function qualityScale(q) {
    var v = q;
    if (v && typeof v === 'object') {
      v = typeof v.scale === 'number' ? v.scale :
          typeof v.density === 'number' ? v.density :
          typeof v.level === 'number' ? v.level : 1;
    }
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) { return 1; }
    if (v > 1) { v = v / 4; }
    return clamp(v, 0.3, 1);
  }

  /* ------------------------------------------------------------------ *
   *  Construcción de sprites y cachés (solo en resize / cambio de tier)
   * ------------------------------------------------------------------ */

  function glowSprite(size, c0, a0, c1, a1) {
    var cv = makeCanvas(size, size), c = ctx2d(cv), r = size / 2;
    var g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, rgba(c0, a0));
    g.addColorStop(0.35, rgba(c0, a0 * 0.45));
    g.addColorStop(1, rgba(c1, a1));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    return cv;
  }

  function starSprite(size) {
    var cv = makeCanvas(size, size), c = ctx2d(cv), r = size / 2, g, i;
    g = c.createRadialGradient(r, r, 0, r, r, r * 0.55);
    g.addColorStop(0, rgba(PAL.ivory, 0.95));
    g.addColorStop(1, rgba(PAL.warm, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    for (i = 0; i < 2; i++) {
      c.save();
      c.translate(r, r);
      c.rotate(i * Math.PI / 2);
      g = c.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, rgba(PAL.warm, 0));
      g.addColorStop(0.5, rgba(PAL.ivory, 0.9));
      g.addColorStop(1, rgba(PAL.warm, 0));
      c.fillStyle = g;
      c.fillRect(-r, -0.7, size, 1.4);
      c.restore();
    }
    return cv;
  }

  function sheenSprite() {
    var cv = makeCanvas(8, 128), c = ctx2d(cv);
    var g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, rgba(PAL.warm, 0));
    g.addColorStop(0.5, rgba(PAL.warm, 1));
    g.addColorStop(1, rgba(PAL.warm, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 128);
    return cv;
  }

  // Haz de luz lateral: trapecio con caída vertical (se dibuja con 'lighter').
  function beamSprite() {
    var cv = makeCanvas(96, 256), c = ctx2d(cv);
    var g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, rgba(PAL.warm, 0.9));
    g.addColorStop(0.55, rgba(PAL.warm, 0.28));
    g.addColorStop(1, rgba(PAL.warm, 0));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(17, 0); c.lineTo(96, 256); c.lineTo(14, 256);
    c.closePath();
    c.fill();
    // Suaviza los flancos para que no se lea como polígono.
    c.globalCompositeOperation = 'destination-in';
    var h = c.createLinearGradient(0, 0, 96, 0);
    h.addColorStop(0, 'rgba(0,0,0,0.25)');
    h.addColorStop(0.35, 'rgba(0,0,0,1)');
    h.addColorStop(0.8, 'rgba(0,0,0,1)');
    h.addColorStop(1, 'rgba(0,0,0,0.15)');
    c.fillStyle = h;
    c.fillRect(0, 0, 96, 256);
    return cv;
  }

  function vignetteCanvas(W, H) {
    var vw = 160, vh = clamp(Math.round(160 * H / W), 90, 360);
    var cv = makeCanvas(vw, vh), c = ctx2d(cv), g;
    g = c.createRadialGradient(vw * 0.5, vh * 0.46, Math.min(vw, vh) * 0.28, vw * 0.5, vh * 0.46, Math.max(vw, vh) * 0.78);
    g.addColorStop(0, rgba(PAL.abyss, 0));
    g.addColorStop(0.62, rgba(PAL.abyss, 0.18));
    g.addColorStop(1, rgba(PAL.abyss, 0.72));
    c.fillStyle = g;
    c.fillRect(0, 0, vw, vh);
    g = c.createLinearGradient(0, vh * 0.72, 0, vh);
    g.addColorStop(0, rgba(PAL.abyss, 0));
    g.addColorStop(1, rgba(PAL.abyss, 0.5));
    c.fillStyle = g;
    c.fillRect(0, vh * 0.72, vw, vh * 0.28);
    return cv;
  }

  // Luz de rampa difusa que sube desde el borde inferior (elipse cálida).
  function uplightCanvas() {
    var cv = makeCanvas(128, 64), c = ctx2d(cv);
    c.setTransform(1, 0, 0, 0.9, 64, 64);
    var g = c.createRadialGradient(0, 0, 0, 0, 0, 64);
    g.addColorStop(0, rgba(PAL.bLit, 0.60));
    g.addColorStop(0.45, rgba(PAL.brass, 0.20));
    g.addColorStop(1, rgba(PAL.brass, 0));
    c.fillStyle = g;
    c.fillRect(-64, -72, 128, 80);
    return cv;
  }

  function medallion(c, x, y, r) {
    var g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, rgba(PAL.bLit, 1));
    g.addColorStop(0.55, rgba(PAL.brass, 1));
    g.addColorStop(1, rgba(PAL.bDeep, 1));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = rgba(PAL.abyss, 0.6); c.lineWidth = 1;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    var i, a;
    c.fillStyle = rgba(PAL.bLit, 0.9);
    for (i = 0; i < 10; i++) {
      a = i * TAU / 10;
      c.beginPath(); c.arc(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, Math.max(0.7, r * 0.09), 0, TAU); c.fill();
    }
    c.fillStyle = rgba(PAL.bDeep, 1);
    c.beginPath(); c.arc(x, y, r * 0.5, 0, TAU); c.fill();
    g = c.createRadialGradient(x - r * 0.12, y - r * 0.14, 0, x, y, r * 0.4);
    g.addColorStop(0, rgba(PAL.rubyLit, 1));
    g.addColorStop(0.55, rgba(PAL.ruby, 1));
    g.addColorStop(1, rgba([90, 12, 30], 1));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r * 0.4, 0, TAU); c.fill();
  }

  // Borla (tassel) colgante; se dibuja rotada desde su punto de sujeción.
  function tasselSprite(k) {
    var w = Math.round(30 * k), h = Math.round(104 * k), s = 2;
    var cv = makeCanvas(w * s, h * s), c = ctx2d(cv), i, g, x;
    c.scale(s, s);
    var cx = w / 2;
    // cordón y cabeza
    c.strokeStyle = rgba(PAL.bDeep, 1); c.lineWidth = 2 * k;
    c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, 14 * k); c.stroke();
    g = c.createRadialGradient(cx - 2 * k, 18 * k, 1, cx, 20 * k, 8 * k);
    g.addColorStop(0, rgba(PAL.bLit, 1)); g.addColorStop(0.6, rgba(PAL.brass, 1)); g.addColorStop(1, rgba(PAL.bDeep, 1));
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, 20 * k, 7 * k, 0, TAU); c.fill();
    // falda de flecos
    var top = 27 * k, bot = h - 2 * k, n = 15;
    for (i = 0; i < n; i++) {
      x = (i / (n - 1) - 0.5);
      g = c.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, rgba(PAL.bDeep, 1));
      g.addColorStop(0.55, rgba(PAL.brass, 1));
      g.addColorStop(1, rgba(PAL.bLit, 0.95));
      c.strokeStyle = g;
      c.lineWidth = 1.5 * k;
      c.beginPath();
      c.moveTo(cx + x * 5 * k, top);
      c.quadraticCurveTo(cx + x * 17 * k, top + (bot - top) * 0.55, cx + x * 21 * k, bot);
      c.stroke();
    }
    // collar
    g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgba(PAL.bDeep, 1)); g.addColorStop(0.5, rgba(PAL.bLit, 1)); g.addColorStop(1, rgba(PAL.bDeep, 1));
    c.fillStyle = g;
    c.fillRect(cx - 7 * k, top + (bot - top) * 0.22, 14 * k, 3.5 * k);
    return cv;
  }

  /* --------------------------- cortina lateral ------------------------ */
  // Construye una cortina "izquierda" (muro en x=0). La derecha se dibuja
  // espejada en tiempo de ejecución. Devuelve tres cachés del mismo tamaño:
  //   base  → terciopelo con pliegues, filete de latón, cordón y medallón
  //   hi    → solo las crestas de los pliegues (máscara de brillo de pelo)
  //   light → lienzo de trabajo para el destello móvil
  function buildCurtain(scene, side) {
    var W = scene.W, H = scene.H, cs = scene.cs, tier = scene.tier;
    var portrait = W < H * 0.85;
    var cw = Math.round(clamp(W * (portrait ? 0.14 : 0.165), 36, 300) * (side < 0 ? 1.1 : 0.9));
    var M = 4, R = 6;
    var tie = side < 0 ? 0.60 : 0.67;
    var depth = side < 0 ? 0.36 : 0.30;
    var rnd = rng(side < 0 ? 7117 : 9931);
    var pw = Math.ceil((cw + M + R) * cs), ph = Math.ceil(H * cs);
    var base = makeCanvas(pw, ph), hi = makeCanvas(pw, ph), light = makeCanvas(pw, ph);
    var bc = ctx2d(base), hc = ctx2d(hi), lc = ctx2d(light);
    bc.setTransform(cs, 0, 0, cs, M * cs, 0);
    hc.setTransform(cs, 0, 0, cs, M * cs, 0);

    function edge(t) {
      var g = Math.exp(-Math.pow((t - tie) / 0.15, 2));
      var fl = smooth(tie + 0.05, 1, t);
      return clamp(cw * (0.9 - depth * g + 0.14 * fl), cw * 0.42, cw * 0.94);
    }

    var step = Math.max(6, Math.round(H / 90));
    var ys = [], ed = [], y, j;
    for (y = 0; y < H; y += step) { ys.push(y); ed.push(edge(y / H)); }
    ys.push(H); ed.push(edge(1));
    var minEdge = cw, maxEdge = 0;
    for (j = 0; j < ed.length; j++) { minEdge = Math.min(minEdge, ed[j]); maxEdge = Math.max(maxEdge, ed[j]); }

    // Límites de pliegue irregulares.
    var nf = clamp(Math.round(cw / (tier === 0 ? 17 : tier === 1 ? 12 : 9)), 5, 26);
    var ws = [], acc = 0, run = 0, i;
    for (i = 0; i < nf; i++) { ws.push(0.7 + 0.6 * rnd()); acc += ws[i]; }
    var U = [0];
    for (i = 0; i < nf; i++) { run += ws[i]; U.push(run / acc); }

    function stripPath(c, u0, u1, first) {
      var k;
      c.beginPath();
      for (k = 0; k < ys.length; k++) {
        var x0 = first ? -M : u0 * ed[k];
        if (k === 0) { c.moveTo(x0, ys[k]); } else { c.lineTo(x0, ys[k]); }
      }
      for (k = ys.length - 1; k >= 0; k--) { c.lineTo(u1 * ed[k] + 0.8, ys[k]); }
      c.closePath();
    }

    var shadow = mix(PAL.abyss, PAL.vDeep, 0.5);
    var crestWarm = [255, 242, 205];
    for (i = 0; i < nf; i++) {
      var u0 = U[i], u1 = U[i + 1];
      var b = (0.30 + 0.70 * Math.pow(rnd(), 0.8)) * (0.55 + 0.45 * u1);
      var xmin = i === 0 ? -M : u0 * minEdge;
      var xmax = u1 * maxEdge + 0.8;
      var g = bc.createLinearGradient(xmin, 0, xmax, 0);
      g.addColorStop(0, rgba(shadow, 1));
      g.addColorStop(0.28, rgba(mix(PAL.vDeep, PAL.velvet, b), 1));
      g.addColorStop(0.50, rgba(mix(PAL.velvet, PAL.vLit, b), 1));
      g.addColorStop(0.78, rgba(mix(PAL.vDeep, PAL.velvet, b * 0.7), 1));
      g.addColorStop(1, rgba(shadow, 1));
      bc.fillStyle = g;
      stripPath(bc, u0, u1, i === 0);
      bc.fill();

      var a = clamp(b * b * 0.9, 0, 0.9);
      var hg = hc.createLinearGradient(xmin, 0, xmax, 0);
      hg.addColorStop(0, rgba(crestWarm, 0));
      hg.addColorStop(0.34, rgba(crestWarm, 0));
      hg.addColorStop(0.50, rgba(crestWarm, a));
      hg.addColorStop(0.66, rgba(crestWarm, 0));
      hg.addColorStop(1, rgba(crestWarm, 0));
      hc.fillStyle = hg;
      stripPath(hc, u0, u1, i === 0);
      hc.fill();
    }

    // Sombreado vertical + pelusa del terciopelo, recortados a la silueta.
    bc.save();
    bc.beginPath();
    bc.moveTo(-M, 0);
    for (j = 0; j < ys.length; j++) { bc.lineTo(ed[j], ys[j]); }
    bc.lineTo(-M, H);
    bc.closePath();
    bc.clip();
    var vs = bc.createLinearGradient(0, 0, 0, H);
    vs.addColorStop(0, rgba(PAL.abyss, 0.62));
    vs.addColorStop(0.16, rgba(PAL.abyss, 0.12));
    vs.addColorStop(Math.max(0.2, tie - 0.12), rgba(PAL.abyss, 0.30));
    vs.addColorStop(tie, rgba(PAL.abyss, 0.05));
    vs.addColorStop(1, rgba(PAL.abyss, 0.55));
    bc.fillStyle = vs;
    bc.fillRect(-M, 0, cw + M + R, H);
    var nap = Math.round(clamp(cw * H / 220, 300, 4200) * (tier === 0 ? 0.4 : tier === 1 ? 0.7 : 1));
    for (i = 0; i < nap; i++) {
      bc.fillStyle = rnd() < 0.5 ? 'rgba(255,240,200,0.05)' : 'rgba(0,0,0,0.09)';
      bc.fillRect(-M + rnd() * (cw + M), rnd() * H, 1, 1 + rnd() * 3);
    }
    bc.restore();

    // Filete de latón sobre el canto interior (sombra, cuerpo, brillo, cuentas).
    function edgePath(c, dx) {
      var k;
      c.beginPath();
      for (k = 0; k < ys.length; k++) {
        if (k === 0) { c.moveTo(ed[k] + dx, ys[k]); } else { c.lineTo(ed[k] + dx, ys[k]); }
      }
    }
    bc.lineJoin = 'round';
    edgePath(bc, 2); bc.strokeStyle = 'rgba(0,0,0,0.38)'; bc.lineWidth = 4; bc.stroke();
    var fg = bc.createLinearGradient(0, 0, 0, H);
    fg.addColorStop(0, rgba(PAL.bDeep, 1));
    fg.addColorStop(0.3, rgba(PAL.brass, 1));
    fg.addColorStop(tie, rgba(PAL.bLit, 1));
    fg.addColorStop(0.8, rgba(PAL.brass, 1));
    fg.addColorStop(1, rgba(PAL.bDeep, 1));
    edgePath(bc, 0); bc.strokeStyle = fg; bc.lineWidth = 2.4; bc.stroke();
    edgePath(bc, -0.7); bc.strokeStyle = 'rgba(255,246,214,0.65)'; bc.lineWidth = 0.9; bc.stroke();
    bc.fillStyle = rgba(PAL.bLit, 0.9);
    for (j = 1; j < ys.length - 1; j += 2) {
      bc.beginPath(); bc.arc(ed[j] + 0.4, ys[j], 1.5, 0, TAU); bc.fill();
    }

    // Cordón de recogida (embrasse) con torsión.
    var ty = tie * H, ex = edge(tie);
    var P0x = -M, P0y = ty - 8, P1x = ex + 1, P1y = ty - 1, Qx = ex * 0.5, Qy = ty + 12;
    function quad() { bc.beginPath(); bc.moveTo(P0x, P0y); bc.quadraticCurveTo(Qx, Qy, P1x, P1y); }
    bc.lineCap = 'round';
    quad(); bc.strokeStyle = rgba(PAL.abyss, 0.55); bc.lineWidth = 12; bc.stroke();
    quad(); bc.strokeStyle = rgba(PAL.bDeep, 1); bc.lineWidth = 8.5; bc.stroke();
    quad(); bc.strokeStyle = rgba(PAL.brass, 1); bc.lineWidth = 6; bc.stroke();
    bc.save(); bc.translate(0, -1.6);
    quad(); bc.strokeStyle = rgba(PAL.bLit, 0.85); bc.lineWidth = 1.3; bc.stroke();
    bc.restore();
    bc.strokeStyle = rgba(PAL.bDeep, 0.6); bc.lineWidth = 1;
    var t, px, py, tx, tyv, tl, nx, ny;
    for (t = 0.02; t < 1; t += 0.045) {
      px = (1 - t) * (1 - t) * P0x + 2 * (1 - t) * t * Qx + t * t * P1x;
      py = (1 - t) * (1 - t) * P0y + 2 * (1 - t) * t * Qy + t * t * P1y;
      tx = 2 * (1 - t) * (Qx - P0x) + 2 * t * (P1x - Qx);
      tyv = 2 * (1 - t) * (Qy - P0y) + 2 * t * (P1y - Qy);
      tl = Math.sqrt(tx * tx + tyv * tyv) || 1;
      tx /= tl; tyv /= tl; nx = -tyv; ny = tx;
      bc.beginPath();
      bc.moveTo(px - nx * 3 - tx * 1.6, py - ny * 3 - tyv * 1.6);
      bc.lineTo(px + nx * 3 + tx * 1.6, py + ny * 3 + tyv * 1.6);
      bc.stroke();
    }
    medallion(bc, P1x, P1y, 12.5);

    return { base: base, hi: hi, light: light, lc: lc, cw: cw, M: M, pw: pw, ph: ph, ex: ex, ty: ty,
             edgeAt: edge, lastSheen: -1 };
  }

  /* ----------------------- bambalina (pelmet) superior ---------------- */
  function buildPelmet(scene) {
    var W = scene.W, H = scene.H, s = scene.s2, tier = scene.tier;
    var ph = Math.round(clamp(H * 0.055, 24, 58));
    var sd = Math.round(ph * 0.55);
    var fr = Math.round(clamp(H * 0.016, 8, 16));
    var total = ph + sd + fr + 4;
    var ns = Math.max(3, Math.round(W / clamp(W / 6, 110, 190)));
    var sw = W / ns;
    var cv = makeCanvas(W * s, total * s), c = ctx2d(cv), i, k, g;
    c.setTransform(s, 0, 0, s, 0, 0);
    var rnd = rng(4417);
    var sites = [];

    // Cuerpo de la bambalina y festones; cada festón con su propio abombado.
    for (i = 0; i < ns; i++) {
      var x0 = i * sw, x1 = x0 + sw, xm = (x0 + x1) / 2;
      var center = 1 - Math.abs(xm / W - 0.5) * 1.6;
      var bright = clamp(center, 0.2, 1);
      g = c.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, rgba(PAL.abyss, 1));
      g.addColorStop(0.3, rgba(mix(PAL.vDeep, PAL.velvet, bright), 1));
      g.addColorStop(0.55, rgba(mix(PAL.velvet, PAL.vLit, bright * 0.8), 1));
      g.addColorStop(1, rgba(PAL.abyss, 1));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x0 - 0.5, 0);
      c.lineTo(x1 + 0.5, 0);
      c.lineTo(x1 + 0.5, ph);
      c.quadraticCurveTo(xm, ph + sd * 2, x0 - 0.5, ph);
      c.closePath();
      c.fill();
    }
    g = c.createLinearGradient(0, 0, 0, ph + sd);
    g.addColorStop(0, rgba(PAL.abyss, 0.85));
    g.addColorStop(0.5, rgba(PAL.abyss, 0.12));
    g.addColorStop(1, rgba(PAL.abyss, 0.45));
    c.fillStyle = g;
    c.fillRect(0, 0, W, ph + sd);
    // Pelusa
    var nap = Math.round(clamp(W * ph / 260, 200, 3000) * (tier === 0 ? 0.4 : 1));
    for (i = 0; i < nap; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,240,200,0.045)' : 'rgba(0,0,0,0.08)';
      c.fillRect(rnd() * W, rnd() * ph, 1, 1 + rnd() * 2);
    }
    // Cordón de latón, flecos y cuentas en las uniones.
    var fgr = c.createLinearGradient(0, ph - 2, 0, ph + sd);
    fgr.addColorStop(0, rgba(PAL.bLit, 1));
    fgr.addColorStop(1, rgba(PAL.brass, 1));
    var fringeStep = tier === 0 ? 0.12 : 0.07;
    for (i = 0; i < ns; i++) {
      var xa = i * sw, xb = xa + sw, xc = (xa + xb) / 2;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(xa, ph); c.quadraticCurveTo(xc, ph + sd * 2, xb, ph);
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 4; c.save(); c.translate(0, 1.6); c.stroke(); c.restore();
      c.strokeStyle = fgr; c.lineWidth = 2.4; c.stroke();
      c.strokeStyle = 'rgba(255,246,214,0.6)'; c.lineWidth = 0.8; c.save(); c.translate(0, -0.8); c.stroke(); c.restore();
      var t, fx, fy, fl;
      for (t = fringeStep; t < 1 - fringeStep / 2; t += fringeStep) {
        fx = (1 - t) * (1 - t) * xa + 2 * (1 - t) * t * xc + t * t * xb;
        fy = (1 - t) * (1 - t) * ph + 2 * (1 - t) * t * (ph + sd * 2) + t * t * ph;
        fl = fr * (0.55 + 0.45 * rnd());
        c.strokeStyle = rgba(PAL.bDeep, 0.95); c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(fx, fy + 1); c.lineTo(fx + (t - 0.5) * 2, fy + fl); c.stroke();
        c.fillStyle = rgba(PAL.bLit, 0.9);
        c.beginPath(); c.arc(fx + (t - 0.5) * 2, fy + fl, 1.1, 0, TAU); c.fill();
      }
      if (i > 0) {
        g = c.createRadialGradient(xa - 0.8, ph - 0.8, 0.3, xa, ph, 3.6);
        g.addColorStop(0, rgba(PAL.bLit, 1)); g.addColorStop(0.7, rgba(PAL.brass, 1)); g.addColorStop(1, rgba(PAL.bDeep, 1));
        c.fillStyle = g;
        c.beginPath(); c.arc(xa, ph, 3.4, 0, TAU); c.fill();
        sites.push({ x: xa, y: ph });
      }
    }
    return { cv: cv, h: total, sites: sites, ph: ph };
  }

  /* ------------------ rampa inferior (lámparas de pie) ---------------- */
  function buildLip(scene, inner0, inner1) {
    var W = scene.W, s = scene.s2;
    var h = 40;
    var cv = makeCanvas(W * s, h * s), c = ctx2d(cv), i, g;
    c.setTransform(s, 0, 0, s, 0, 0);
    var nl = clamp(Math.round((inner1 - inner0) / 58), 6, 30);
    var lamps = [];
    // Carril de latón
    g = c.createLinearGradient(0, 24, 0, 31);
    g.addColorStop(0, rgba(PAL.bLit, 1)); g.addColorStop(0.5, rgba(PAL.brass, 1)); g.addColorStop(1, rgba(PAL.bDeep, 1));
    c.fillStyle = g;
    c.fillRect(0, 24, W, 5);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, 29, W, 2);
    for (i = 0; i < nl; i++) {
      var x = inner0 + (i + 0.5) * (inner1 - inner0) / nl;
      lamps.push(x);
      // copa
      g = c.createRadialGradient(x - 2, 19, 0.5, x, 22, 9);
      g.addColorStop(0, rgba(PAL.bLit, 1)); g.addColorStop(0.6, rgba(PAL.brass, 1)); g.addColorStop(1, rgba(PAL.bDeep, 1));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(x - 8, 24); c.quadraticCurveTo(x, 8, x + 8, 24); c.closePath(); c.fill();
      // bombilla
      g = c.createRadialGradient(x, 17, 0, x, 17, 4.2);
      g.addColorStop(0, 'rgba(255,248,225,1)'); g.addColorStop(1, rgba(PAL.warm, 0.9));
      c.fillStyle = g;
      c.beginPath(); c.arc(x, 17, 3.6, 0, TAU); c.fill();
    }
    return { cv: cv, h: h, lamps: lamps };
  }

  /* ------------------------------------------------------------------ *
   *  Escena
   * ------------------------------------------------------------------ */
  class PalcoEsmeraldaScene {
    constructor() {
      this.mask = 0;                // no emite partículas compartidas
      this.key = '';
      this.built = false;
      this.W = 0; this.H = 0; this.cs = 1; this.s2 = 1; this.tier = 2;
      this.failed = false;
      this.t = 0; this.frameNo = 0;
      this.env = { bass: 0, mid: 0, high: 0, hit: 0, pulse: 0 };
      this.hitRaw = 0;
      this.sheenL = 0.35; this.sheenR = 0.5;
      this.curL = null; this.curR = null;
      this.pelmet = null; this.lip = null;
      this.sprites = null;
      this.sites = [];
      this.motes = null; this.moteN = 0;
      this.tassel = null; this.tasselW = 0; this.tasselH = 0;
      this.stageX0 = 0; this.stageX1 = 0;
    }

    resize(frame) { this._prepare(frame); }

    _prepare(frame) {
      var w = Math.round(num(frame.w, 0)), h = Math.round(num(frame.h, 0));
      if (w < 2 || h < 2 || !global.document) { return false; }
      var dpr = clamp(num(frame.dpr, 1), 1, 3);
      var qs = qualityScale(frame.q);
      var tier = qs >= 0.85 ? 2 : (qs >= 0.55 ? 1 : 0);
      // Histéresis: baja de nivel enseguida, pero solo sube con margen (evita reconstruir en bucle).
      if (this.built && tier > this.tier) {
        tier = qs >= (tier === 2 ? 0.93 : 0.63) ? tier : this.tier;
      }
      var cs = FRAME_IN_DEVICE_PX ? 1 : Math.min(dpr, 1.5);
      var s2 = FRAME_IN_DEVICE_PX ? 1 : Math.min(dpr, 2);
      var key = w + 'x' + h + '@' + cs + '/' + s2 + '#' + tier;
      if (key === this.key) { return !this.failed; }
      this.key = key;
      this.W = w; this.H = h; this.cs = cs; this.s2 = s2; this.tier = tier;
      this.failed = false;
      this.built = true;
      try {
        this._build();
      } catch (err) {
        this.failed = true;
        if (global.console && global.console.warn) { global.console.warn('[' + SLUG + '] no se pudo construir la escena:', err); }
      }
      return !this.failed;
    }

    _build() {
      var W = this.W, H = this.H, tier = this.tier, i;
      this.curL = buildCurtain(this, -1);
      this.curR = buildCurtain(this, 1);
      this.stageX0 = this.curL.cw;
      this.stageX1 = W - this.curR.cw;
      this.pelmet = buildPelmet(this);
      this.lip = buildLip(this, Math.round(this.stageX0 * 0.9), Math.round(this.stageX1 + this.curR.cw * 0.1));

      if (!this.sprites) {
        this.sprites = {
          dot: glowSprite(16, PAL.warm, 1, PAL.warm, 0),
          lamp: glowSprite(64, PAL.warm, 0.95, PAL.brass, 0),
          ruby: glowSprite(48, PAL.rubyLit, 0.95, PAL.ruby, 0),
          star: starSprite(48),
          sheen: sheenSprite(),
          beam: beamSprite()
        };
      }
      this.sprites.vig = vignetteCanvas(W, H);
      this.sprites.up = uplightCanvas();

      var k = clamp(H / 900, 0.7, 1.25);
      this.tassel = tasselSprite(k);
      this.tasselW = Math.round(30 * k);
      this.tasselH = Math.round(104 * k);

      // Motas de polvo: pool fijo con posiciones deterministas.
      var n = tier === 0 ? 18 : (tier === 1 ? 30 : 46);
      var rnd = rng(1313);
      this.moteN = n;
      this.motes = new Float32Array(n * 7); // x,y,r,vx,vy,phase,freq
      for (i = 0; i < n; i++) {
        var o = i * 7;
        this.motes[o] = rnd() * W;
        this.motes[o + 1] = rnd() * H;
        this.motes[o + 2] = 1.1 + rnd() * 2.2;
        this.motes[o + 3] = (rnd() - 0.5) * 5;
        this.motes[o + 4] = -2 + (rnd() - 0.5) * 6;
        this.motes[o + 5] = rnd() * TAU;
        this.motes[o + 6] = 0.35 + rnd() * 0.9;
      }

      // Puntos de destello: cuentas de la bambalina, borlas y cantos de cortina.
      var sites = [], sp = this.pelmet.sites, maxSites = tier === 0 ? 7 : (tier === 1 ? 10 : 14), r2 = rng(2718);
      var stepS = Math.max(1, Math.floor(sp.length / Math.max(1, maxSites - 5)));
      for (i = 0; i < sp.length && sites.length < maxSites - 4; i += stepS) { sites.push({ x: sp[i].x, y: sp[i].y }); }
      sites.push({ x: this.curL.ex, y: this.curL.ty + this.tasselH * 0.9 });
      sites.push({ x: W - this.curR.ex, y: this.curR.ty + this.tasselH * 0.9 });
      sites.push({ x: this.curL.edgeAt(0.22), y: H * 0.22 });
      sites.push({ x: W - this.curR.edgeAt(0.84), y: H * 0.84 });
      for (i = 0; i < sites.length; i++) {
        sites[i].size = 16 + r2() * 14;
        sites[i].period = 4.5 + r2() * 5;
        sites[i].phase = r2();
      }
      this.sites = sites;
      // Fuerza el recálculo del destello en el siguiente frame.
      this.curL.lastSheen = -1; this.curR.lastSheen = -1;
    }

    _update(frame) {
      var dtms = num(frame.dt, 16.7);
      dtms = clamp(dtms, 0, 64);
      var dt = dtms / 1000;
      var calm = !!frame.reduced || frame.motion === 0 || frame.motion === false;
      var live = !calm && frame.playing !== false;
      var b = frame.bands || {}, beat = frame.beat || {}, e = this.env;

      var tb = live ? clamp(num(b.bass, 0), 0, 1) : 0;
      var tm = live ? clamp(num(b.mid, 0), 0, 1) : 0;
      var th = live ? clamp(num(b.high, 0), 0, 1) : 0;
      var tp = live ? clamp(num(beat.pulse, 0), 0, 1) : 0;
      if (calm) {
        e.bass = e.mid = e.high = e.hit = e.pulse = 0; this.hitRaw = 0;
      } else {
        e.bass = follow(e.bass, tb, dt, 0.07, 0.55);
        e.mid = follow(e.mid, tm, dt, 0.14, 0.75);
        e.high = follow(e.high, th, dt, 0.09, 0.45);
        e.pulse = follow(e.pulse, tp, dt, 0.06, 0.40);
        if (live && beat.hit) { this.hitRaw = Math.max(this.hitRaw, clamp(num(beat.strength, 0.7), 0.25, 1)); }
        this.hitRaw = follow(this.hitRaw, 0, dt, 0.01, 0.8);
        e.hit = follow(e.hit, this.hitRaw, dt, 0.09, 0.35);
        this.t += dt * (frame.playing === false ? 0.3 : 1);
      }
      this.calm = calm;
      var T = calm ? 12.3 : this.t;
      this.T = T;

      var tgtL = 0.20 + 0.55 * (0.5 + 0.5 * Math.sin(T * 0.11)) + 0.18 * e.hit;
      var tgtR = 0.20 + 0.55 * (0.5 + 0.5 * Math.sin(T * 0.11 + 2.2)) + 0.18 * e.hit;
      if (calm) { this.sheenL = 0.40; this.sheenR = 0.52; }
      else {
        this.sheenL = follow(this.sheenL, tgtL, dt, 1.2, 1.2);
        this.sheenR = follow(this.sheenR, tgtR, dt, 1.2, 1.2);
      }
      this.dt = dt;
    }

    // Dibuja una caché de cortina en franjas horizontales con oscilación suave.
    _swayed(ctx, src, cur, amp, T, phase, n) {
      var cs = this.cs, pw = src.width, ph = src.height;
      var wl = pw / cs, i, sy, sy1, hh, dx;
      for (i = 0; i < n; i++) {
        sy = Math.round(i * ph / n);
        sy1 = Math.min(ph, Math.round((i + 1) * ph / n) + (i < n - 1 ? 1 : 0));
        hh = sy1 - sy;
        if (hh <= 0) { continue; }
        dx = -cur.M + (amp ? amp * Math.sin(T * 0.55 + i * 0.42 + phase) : 0);
        ctx.drawImage(src, 0, sy, pw, hh, dx, sy / cs, wl, hh / cs);
      }
    }

    _curtain(ctx, cur, mirror, sheenPos, amp, T, phase, sheenAlpha, n) {
      var W = this.W, H = this.H, cs = this.cs;
      ctx.save();
      try {
        if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
        this._swayed(ctx, cur.base, cur, amp, T, phase, n);
        if (sheenAlpha > 0.01) {
          // Destello de pelo: banda cálida × máscara de crestas.
          var redo = Math.abs(sheenPos - cur.lastSheen) > 0.0015 || (this.tier === 0 && (this.frameNo % 3 === 0));
          if (redo) {
            var lc = cur.lc, pw = cur.pw, ph = cur.ph, bh = H * 0.42 * cs, by = sheenPos * H * cs - bh / 2;
            lc.globalAlpha = 1;
            lc.globalCompositeOperation = 'source-over';
            lc.clearRect(0, 0, pw, ph);
            lc.drawImage(this.sprites.sheen, 0, by, pw, bh);
            lc.globalCompositeOperation = 'destination-in';
            lc.drawImage(cur.hi, 0, 0);
            lc.globalCompositeOperation = 'source-over';
            cur.lastSheen = sheenPos;
          }
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = sheenAlpha;
          this._swayed(ctx, cur.light, cur, amp, T, phase, n);
        }
      } finally {
        ctx.restore();
      }
    }

    draw(ctx, frame) {
      if (!ctx || !frame || this.failed) { return; }
      if (!this._prepare(frame)) { return; }
      this._update(frame);
      this.frameNo++;

      var W = this.W, H = this.H, e = this.env, T = this.T, calm = this.calm, dt = this.dt;
      var sp = this.sprites, tier = this.tier, i, o;

      if (CLEAR_FIRST) { ctx.clearRect(0, 0, num(frame.w, W) + 1, num(frame.h, H) + 1); }

      ctx.save();
      try {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.imageSmoothingEnabled = true;

        var amp = calm ? 0 : 0.5 + 1.6 * e.mid;
        var nStrips = tier === 0 ? 14 : (tier === 1 ? 22 : 30);
        var sheenA = calm ? 0.20 : clamp(0.16 + 0.40 * e.mid + 0.30 * e.hit, 0, 0.65);

        // 1. Cortinas con destello de pelo (mid → balanceo y brillo, hit → barrido).
        this._curtain(ctx, this.curL, false, this.sheenL, amp, T, 0, sheenA, nStrips);
        this._curtain(ctx, this.curR, true, this.sheenR, amp, T, 1.7, sheenA * 0.85, nStrips);

        // 2. Luz de rampa difusa (bass).
        var upA = calm ? 0.45 : clamp(0.42 + 0.34 * e.bass + 0.2 * e.pulse, 0, 0.95);
        var upH = H * 0.34;
        ctx.globalAlpha = upA;
        ctx.drawImage(sp.up, this.stageX0 * 0.55, H - upH, Math.max(2, W - this.stageX0 * 0.55 - this.curR.cw * 0.55), upH);

        // 3. Haces laterales (bass + hit), dibujados con 'lighter'.
        ctx.globalCompositeOperation = 'lighter';
        var beamA = calm ? 0.05 : clamp(0.05 + 0.07 * e.bass + 0.03 * e.hit, 0, 0.16);
        var bw = W * 0.2, bhh = H * 0.9;
        ctx.globalAlpha = beamA;
        ctx.drawImage(sp.beam, W * 0.03, H * 0.04, bw, bhh);
        ctx.save();
        ctx.translate(W, 0); ctx.scale(-1, 1);
        ctx.globalAlpha = beamA * 0.7;
        ctx.drawImage(sp.beam, W * 0.05, H * 0.04, bw * 0.85, bhh);
        ctx.restore();

        // 4. Polvo en suspensión (high → destello; más tenue en la columna central).
        var motes = this.motes, hi = e.high;
        ctx.globalAlpha = 1;
        for (i = 0; i < this.moteN; i++) {
          o = i * 7;
          if (!calm) {
            motes[o] += motes[o + 3] * dt;
            motes[o + 1] += motes[o + 4] * dt;
            if (motes[o] < -6) { motes[o] = W + 6; } else if (motes[o] > W + 6) { motes[o] = -6; }
            if (motes[o + 1] < -6) { motes[o + 1] = H + 6; } else if (motes[o + 1] > H + 6) { motes[o + 1] = -6; }
          }
          var dx = Math.abs(motes[o] / W - 0.5);
          var side = 0.12 + 0.88 * smooth(0.16, 0.46, dx);
          var tw = 0.55 + 0.45 * Math.sin(T * motes[o + 6] + motes[o + 5]);
          var a = clamp(0.30 * side * tw * (0.7 + 0.9 * hi), 0, 0.5);
          if (a < 0.015) { continue; }
          ctx.globalAlpha = a;
          var r = motes[o + 2] * 2.2;
          ctx.drawImage(sp.dot, motes[o] - r, motes[o + 1] - r, r * 2, r * 2);
        }

        // 5. Viñeta y bambalina (marcos fijos).
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(sp.vig, 0, 0, W, H);
        ctx.drawImage(this.pelmet.cv, 0, 0, W, this.pelmet.h);

        // 6. Borlas (mid → balanceo) y rubíes (hit → destello).
        var k = clamp(H / 900, 0.7, 1.25);
        var tw2 = this.tasselW, th2 = this.tasselH;
        for (i = 0; i < 2; i++) {
          var cur = i === 0 ? this.curL : this.curR;
          var px = i === 0 ? cur.ex + 1 : W - cur.ex - 1;
          var py = cur.ty - 1;
          var ang = calm ? 0 : Math.sin(T * 0.8 + i * 1.9) * 0.03 + e.mid * 0.05 * Math.sin(T * 2.1 + i);
          ctx.save();
          ctx.translate(px, py + 8 * k);
          ctx.rotate(ang);
          ctx.drawImage(this.tassel, -tw2 / 2, 0, tw2, th2);
          ctx.restore();
          var ra = calm ? 0.18 : clamp(0.16 + 0.70 * e.hit, 0, 0.9);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = ra;
          var rr = 20 * k;
          ctx.drawImage(sp.ruby, px - rr, py - rr, rr * 2, rr * 2);
          ctx.globalCompositeOperation = 'source-over';
        }

        // 7. Rampa de lámparas: carril fijo + brillo viajero (bass/pulse).
        var lipY = H - this.lip.h;
        ctx.globalAlpha = 1;
        ctx.drawImage(this.lip.cv, 0, lipY, W, this.lip.h);
        ctx.globalCompositeOperation = 'lighter';
        var g = clamp(W * 0.03, 22, 46);
        var lamps = this.lip.lamps;
        for (i = 0; i < lamps.length; i++) {
          var li = calm ? 0.40 : 0.20 + 0.60 * e.bass + 0.25 * e.pulse + 0.10 * Math.sin(T * 1.1 - i * 0.6);
          ctx.globalAlpha = clamp(li, 0, 0.95) * 0.9;
          ctx.drawImage(sp.lamp, lamps[i] - g, lipY + 17 - g, g * 2, g * 2);
        }

        // 8. Destellos pausados en latón (high). Ciclo lento, sin parpadeo.
        var sites = this.sites;
        for (i = 0; i < sites.length; i++) {
          var s = sites[i];
          var ph = calm ? s.phase : (T / s.period + s.phase);
          var v = Math.sin((ph - Math.floor(ph)) * Math.PI);
          v = Math.pow(v, 14);
          var ga = calm ? (i % 3 === 0 ? 0.35 : 0) : v * clamp(0.35 + 1.0 * hi, 0, 1) * 0.85;
          if (ga < 0.03) { continue; }
          ctx.globalAlpha = ga;
          ctx.drawImage(sp.star, s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
        }
      } finally {
        ctx.restore();
      }
    }
  }

  core.registerScene(SLUG, PalcoEsmeraldaScene);
})(typeof window !== 'undefined' ? window : globalThis);
