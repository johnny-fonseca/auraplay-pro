/*!
 * AuraPlay Pro · Karaoke · Yozakura 夜桜
 * slug: yozakura  ·  ruta: karaoke/yozakura/yozakura-effects.js
 *
 * Plugin de escena para AuraKaraokeCore. Script clásico (compatible con `defer`).
 * Debe cargarse DESPUÉS de karaoke/shared/karaoke-core.js.
 *
 * Un hanami nocturno compuesto como un grabado ukiyo-e (de atrás hacia delante):
 *   estrellas → luna con halo → bruma dorada (suyari-gasumi) → rama de cerezo en flor
 *   → Fuji lejano → cordilleras en tres planos con bruma entre ellas → pétalos.
 *
 * Respuesta al audio (siempre suavizada, sin destellos):
 *   graves  → respiración del halo de la luna y de la bruma
 *   medios  → intensidad del viento: pétalos, deriva de montañas y balanceo de la rama
 *   agudos  → brillo de los anillos lunares y de las estrellas
 *   ritmo   → ráfaga de viento y hasta 3 pétalos que se desprenden de la rama
 *
 * Todo lo costoso (luna, rama, montañas, bruma, pétalos) son sprites que se construyen una
 * vez por tamaño; por frame solo hay blits y como mucho ~40 pétalos pequeños.
 */
(function (global) {
  'use strict';

  var SLUG = 'yozakura';
  var core = global.AuraKaraokeCore;

  if (!core || typeof core.registerScene !== 'function') {
    throw new Error(
      '[AuraPlay · Karaoke · ' + SLUG + '] No se encontró window.AuraKaraokeCore.registerScene. ' +
      'Carga karaoke/shared/karaoke-core.js antes de karaoke/' + SLUG + '/' + SLUG +
      '-effects.js (ambos con defer, en ese orden). Este módulo es solo un plugin visual y no ' +
      'implementa su propio motor.'
    );
  }

  /* ───────────── Auxiliares del núcleo (con respaldo local) ───────────── */

  var helpers = core.helpers || {};
  var TAU = helpers.TAU || Math.PI * 2;
  var clamp = typeof helpers.clamp === 'function'
    ? helpers.clamp
    : function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var lerp = typeof helpers.lerp === 'function'
    ? helpers.lerp
    : function (a, b, t) { return a + (b - a) * t; };

  /* ───────────── Paleta propia (no depende de frame.pal) ───────────── */

  var PAL = {
    moon: [241, 227, 181],
    sakura: [244, 182, 198],
    pale: [253, 232, 238],
    mist: [240, 226, 190],
    gold: [217, 181, 106]
  };

  // Tintes del pétalo: [base, medio, punta].
  var TINTS = [
    [[244, 182, 198], [250, 214, 224], [254, 240, 244]],
    [[232, 140, 168], [244, 182, 198], [252, 222, 232]],
    [[214, 104, 140], [238, 150, 176], [250, 200, 214]]
  ];

  var POOL = 72; // pétalos reservados; solo una parte está viva según calidad

  function col(c, a) {
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
  }

  function num(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : d;
  }

  function smooth(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Seguimiento exponencial con ataque y relajación distintos (ms).
  function follow(cur, target, dtMs, attack, release) {
    var tau = target > cur ? attack : release;
    return cur + (target - cur) * (1 - Math.exp(-dtMs / tau));
  }

  function mulberry(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function glowSprite(rgb, size) {
    var c = newCanvas(size, size);
    var g = c.getContext('2d');
    if (!g) return c;
    var r = size / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, col(rgb, 1));
    grad.addColorStop(0.18, col(rgb, 0.55));
    grad.addColorStop(0.5, col(rgb, 0.12));
    grad.addColorStop(1, col(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /* ───────────── Pétalo y flor ───────────── */

  // Pétalo de cerezo con la muesca característica, base en (0,0) y punta en (0,-r).
  function petalPath(g, r) {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-r * 0.62, -r * 0.28, -r * 0.58, -r * 0.98, -r * 0.16, -r * 1.02);
    g.quadraticCurveTo(-r * 0.04, -r * 0.94, 0, -r * 0.84);
    g.quadraticCurveTo(r * 0.04, -r * 0.94, r * 0.16, -r * 1.02);
    g.bezierCurveTo(r * 0.58, -r * 0.98, r * 0.62, -r * 0.28, 0, 0);
    g.closePath();
  }

  function petalFill(g, r, tint, alpha) {
    var gr = g.createLinearGradient(0, 0, 0, -r);
    gr.addColorStop(0, col(tint[0], alpha));
    gr.addColorStop(0.4, col(tint[1], alpha));
    gr.addColorStop(1, col(tint[2], alpha));
    return gr;
  }

  // Pétalo que cae. `soft` = versión con resplandor, para los planos cercanos (efecto bokeh).
  function buildPetalSprite(tintIdx, soft) {
    var S = 64;
    var c = newCanvas(S, S);
    var g = c.getContext('2d');
    if (!g) return c;
    var r = S * (soft ? 0.5 : 0.62);
    g.translate(S / 2, S / 2 + r / 2);
    if (soft) {
      g.shadowColor = col(PAL.sakura, 0.95);
      g.shadowBlur = 9;
    }
    petalPath(g, r);
    g.fillStyle = petalFill(g, r, TINTS[tintIdx], soft ? 0.9 : 1);
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
    if (!soft) {
      g.strokeStyle = 'rgba(200,90,125,0.26)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -r * 0.12);
      g.lineTo(0, -r * 0.68);
      g.stroke();
    }
    return c;
  }

  // Flor de cinco pétalos con centro profundo y estambres dorados.
  function buildFlower(tintIdx, rng) {
    var S = 64;
    var c = newCanvas(S, S);
    var g = c.getContext('2d');
    if (!g) return c;
    var r = S * 0.36, i, a, l;
    g.translate(S / 2, S / 2);
    var rot0 = rng() * TAU;
    for (i = 0; i < 5; i++) {
      g.save();
      g.rotate(rot0 + (i * TAU) / 5);
      petalPath(g, r);
      g.fillStyle = petalFill(g, r, TINTS[tintIdx], 1);
      g.fill();
      g.lineWidth = 0.8;
      g.strokeStyle = col(PAL.pale, 0.35);
      g.stroke();
      g.restore();
    }
    var cg = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.32);
    cg.addColorStop(0, col([200, 70, 110], 0.95));
    cg.addColorStop(1, col([224, 122, 153], 0));
    g.fillStyle = cg;
    g.beginPath();
    g.arc(0, 0, r * 0.32, 0, TAU);
    g.fill();
    g.lineWidth = 0.7;
    g.strokeStyle = col([226, 190, 110], 0.9);
    g.fillStyle = col(PAL.gold, 1);
    for (i = 0; i < 9; i++) {
      a = rng() * TAU;
      l = r * (0.35 + 0.25 * rng());
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * l, Math.sin(a) * l);
      g.stroke();
      g.beginPath();
      g.arc(Math.cos(a) * l, Math.sin(a) * l, 1.1, 0, TAU);
      g.fill();
    }
    return c;
  }

  /* ───────────── Luna ───────────── */

  function buildMoon(D, rng) {
    var c = newCanvas(D, D);
    var g = c.getContext('2d');
    if (!g) return c;
    var R = D / 2, i;

    var body = g.createRadialGradient(R * 0.84, R * 0.8, 0, R, R, R);
    body.addColorStop(0, 'rgba(252,246,222,1)');
    body.addColorStop(0.55, 'rgba(244,230,186,1)');
    body.addColorStop(1, 'rgba(222,200,150,1)');
    g.fillStyle = body;
    g.beginPath();
    g.arc(R, R, R * 0.985, 0, TAU);
    g.fill();

    // Mares lunares: manchas muy suaves recortadas al disco.
    g.save();
    g.beginPath();
    g.arc(R, R, R * 0.985, 0, TAU);
    g.clip();
    for (i = 0; i < 8; i++) {
      var a = rng() * TAU, d = R * 0.6 * Math.sqrt(rng()), rr = R * (0.1 + 0.2 * rng());
      var mx = R + Math.cos(a) * d, my = R + Math.sin(a) * d;
      var mg = g.createRadialGradient(mx, my, 0, mx, my, rr);
      mg.addColorStop(0, 'rgba(176,146,98,0.14)');
      mg.addColorStop(1, 'rgba(176,146,98,0)');
      g.fillStyle = mg;
      g.fillRect(mx - rr, my - rr, rr * 2, rr * 2);
    }
    // Oscurecimiento del limbo.
    var limb = g.createRadialGradient(R, R, R * 0.78, R, R, R);
    limb.addColorStop(0, 'rgba(190,160,110,0)');
    limb.addColorStop(1, 'rgba(190,160,110,0.32)');
    g.fillStyle = limb;
    g.fillRect(0, 0, D, D);
    g.restore();
    return c;
  }

  /* ───────────── Rama de cerezo (sprite) ─────────────
   * Silueta de tinta con filo de luz lunar, ramillas con bifurcaciones y flores en
   * racimos. Nace fuera del borde derecho y cuelga hacia la izquierda. */
  function buildBranch(W, H, k, rng, art, detail, shed) {
    var c = newCanvas(W * k, H * k);
    var g = c.getContext('2d');
    if (!g) return c;
    g.scale(k, k);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    var bw = clamp(H * 0.052, 5, 24);
    var INK = 'rgba(8,10,24,0.96)';
    var EDGE = 'rgba(160,176,236,0.30)';
    var nodes = [], tips = [], i, j, s, f;

    function bez(p0, p1, p2, p3, t) {
      var u = 1 - t;
      return [
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
      ];
    }
    function qua(p0, p1, p2, t) {
      var u = 1 - t;
      return [
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
      ];
    }
    // Trazo cónico: primero la tinta, luego el filo de luz.
    function taper(pts, w0, w1, edge) {
      var n = pts.length - 1, k2, wd;
      for (k2 = 1; k2 <= n; k2++) {
        wd = w0 + (w1 - w0) * (k2 / n);
        g.lineWidth = wd;
        g.strokeStyle = INK;
        g.beginPath();
        g.moveTo(pts[k2 - 1][0], pts[k2 - 1][1]);
        g.lineTo(pts[k2][0], pts[k2][1]);
        g.stroke();
      }
      if (!edge) return;
      for (k2 = 1; k2 <= n; k2++) {
        wd = w0 + (w1 - w0) * (k2 / n);
        if (wd < 2.2) break;
        g.lineWidth = wd * 0.28;
        g.strokeStyle = EDGE;
        g.beginPath();
        g.moveTo(pts[k2 - 1][0] - wd * 0.22, pts[k2 - 1][1] - wd * 0.28);
        g.lineTo(pts[k2][0] - wd * 0.22, pts[k2][1] - wd * 0.28);
        g.stroke();
      }
    }

    // Tronco principal.
    var P0 = [W + 16, H * 0.09], P1 = [W * 0.8, H * 0.21], P2 = [W * 0.52, H * 0.15], P3 = [W * 0.1, H * 0.5];
    var main = [];
    for (i = 0; i <= 56; i++) main.push(bez(P0, P1, P2, P3, i / 56));
    taper(main, bw, bw * 0.2, true);
    for (i = 0; i < 6; i++) {
      var pm = bez(P0, P1, P2, P3, 0.16 + 0.11 * i);
      nodes.push([pm[0] + (rng() - 0.5) * 8, pm[1] + (rng() - 0.5) * 8]);
    }

    // Ramillas y bifurcaciones.
    var nTw = detail >= 1 ? 7 : 5;
    for (i = 0; i < nTw; i++) {
      var t0 = Math.min(0.86, 0.1 + (0.74 * (i + rng() * 0.7)) / nTw);
      var s0 = bez(P0, P1, P2, P3, t0);
      var L = W * (0.1 + 0.14 * rng());
      var ang = rng() < 0.2 ? Math.PI * (1.1 + 0.25 * rng()) : Math.PI * (0.52 + 0.3 * rng());
      var e = [s0[0] + Math.cos(ang) * L, s0[1] + Math.sin(ang) * L];
      var mid = [(s0[0] + e[0]) / 2 + (rng() - 0.5) * L * 0.5, (s0[1] + e[1]) / 2 + (rng() - 0.5) * L * 0.5];
      var tw = [];
      for (j = 0; j <= 22; j++) tw.push(qua(s0, mid, e, j / 22));
      var w0 = bw * (0.56 - 0.26 * t0);
      taper(tw, w0, 0.9, false);
      for (j = 1; j <= 5; j++) nodes.push(qua(s0, mid, e, j / 5));
      tips.push(e);

      for (s = 0; s < 2; s++) {
        var sp = qua(s0, mid, e, 0.45 + 0.3 * s);
        var a2 = ang + (s ? 0.6 : -0.6) * (0.7 + 0.6 * rng());
        var L2 = L * (0.35 + 0.2 * rng());
        var e2 = [sp[0] + Math.cos(a2) * L2, sp[1] + Math.sin(a2) * L2];
        var m2 = [(sp[0] + e2[0]) / 2 + (rng() - 0.5) * L2 * 0.4, (sp[1] + e2[1]) / 2 + (rng() - 0.5) * L2 * 0.4];
        var sub = [];
        for (j = 0; j <= 14; j++) sub.push(qua(sp, m2, e2, j / 14));
        taper(sub, w0 * 0.55, 0.7, false);
        for (j = 1; j <= 3; j++) nodes.push(qua(sp, m2, e2, j / 3));
        tips.push(e2);
      }
    }

    // Mezcla de nodos (Fisher–Yates) para repartir las flores sin patrón.
    for (i = nodes.length - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      f = nodes[i]; nodes[i] = nodes[j]; nodes[j] = f;
    }
    var maxF = detail === 2 ? 90 : detail === 1 ? 64 : 40;
    var nF = Math.min(nodes.length, maxF);
    var fk = clamp(H / 450, 0.7, 1.5);

    // Resplandor bajo las flores (la luz de la luna las enciende).
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.1;
    for (i = 0; i < nF; i++) g.drawImage(art.glow, nodes[i][0] - 35 * fk, nodes[i][1] - 35 * fk, 70 * fk, 70 * fk);
    g.globalCompositeOperation = 'source-over';

    // Capullos en las puntas.
    g.fillStyle = 'rgba(224,104,140,0.95)';
    for (i = 0; i < tips.length; i++) {
      g.beginPath();
      g.ellipse(tips[i][0], tips[i][1], 2.6 * fk, 3.6 * fk, rng() * TAU, 0, TAU);
      g.fill();
    }

    // Flores en racimos de 1 a 3.
    for (i = 0; i < nF; i++) {
      var nd = nodes[i];
      var cl = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
      for (j = 0; j < cl; j++) {
        var fs = (13 + 12 * rng()) * fk;
        g.save();
        g.translate(nd[0] + (rng() - 0.5) * fs * 0.9, nd[1] + (rng() - 0.5) * fs * 0.9);
        g.rotate(rng() * TAU);
        g.globalAlpha = 0.94;
        g.drawImage(art.flowers[(rng() * art.flowers.length) | 0], -fs / 2, -fs / 2, fs, fs);
        g.restore();
      }
      if (shed.length < 14 && rng() < 0.35) shed.push([nd[0], nd[1]]);
    }
    return c;
  }

  /* ───────────── Montañas y bruma ───────────── */

  // Cordillera periódica (sin costura) para poder desplazarla en bucle. El plano lejano
  // (`fuji`) lleva además un cono con la cima nevada.
  function buildRidge(w, Hs, k, spec, rng, fuji) {
    var c = newCanvas(w * k, Hs * k);
    var g = c.getContext('2d');
    if (!g) return c;
    g.scale(k, k);

    var p1 = rng() * TAU, p2 = rng() * TAU, p3 = rng() * TAU, n = spec.n, x;
    function yAt(px) {
      var u = (px / w) * TAU;
      var v = 0.55 + 0.26 * Math.sin(n[0] * u + p1) + 0.17 * Math.sin(n[1] * u + p2) -
        0.13 * Math.abs(Math.sin(n[2] * u * 0.5 + p3));
      v = clamp(v, 0, 1);
      return Hs * (1 - (spec.lo + (spec.hi - spec.lo) * Math.pow(v, 1.25)));
    }

    g.beginPath();
    g.moveTo(0, Hs);
    for (x = 0; x <= w; x += 4) g.lineTo(x, yAt(x));
    g.lineTo(w, yAt(w));
    g.lineTo(w, Hs);
    g.closePath();
    var gr = g.createLinearGradient(0, 0, 0, Hs);
    gr.addColorStop(0, spec.top);
    gr.addColorStop(1, spec.bot);
    g.fillStyle = gr;
    g.fill();

    if (fuji) {
      var hw = fuji.bw / 2, ay = Hs - fuji.fh, cx = fuji.x;
      var cone = function () {
        g.beginPath();
        g.moveTo(cx - hw, Hs);
        g.quadraticCurveTo(cx - hw * 0.5, Hs - fuji.fh * 0.1, cx - hw * 0.1, ay);
        g.quadraticCurveTo(cx, ay - fuji.fh * 0.025, cx + hw * 0.1, ay);
        g.quadraticCurveTo(cx + hw * 0.5, Hs - fuji.fh * 0.1, cx + hw, Hs);
        g.closePath();
      };
      cone();
      var fg = g.createLinearGradient(0, ay, 0, Hs);
      fg.addColorStop(0, 'rgba(150,166,215,0.46)');
      fg.addColorStop(1, 'rgba(60,76,140,0.36)');
      g.fillStyle = fg;
      g.fill();

      // Nieve de la cima con borde irregular.
      g.save();
      g.beginPath();
      g.moveTo(cx - hw, ay - 4);
      var steps = 9, i;
      for (i = 0; i <= steps; i++) {
        g.lineTo(cx - hw + (hw * 2 * i) / steps, ay + fuji.fh * (0.2 + 0.09 * Math.sin(i * 2.3 + 0.8) + 0.04 * Math.sin(i * 5.1)));
      }
      g.lineTo(cx + hw, ay - 4);
      g.closePath();
      g.clip();
      cone();
      g.fillStyle = 'rgba(240,244,255,0.26)';
      g.fill();
      g.restore();
    }

    // Filo de luz lunar en la cresta.
    g.beginPath();
    g.moveTo(0, yAt(0));
    for (x = 4; x <= w; x += 4) g.lineTo(x, yAt(x));
    g.lineWidth = 1.2;
    g.strokeStyle = col(PAL.moon, spec.rim);
    g.stroke();
    return c;
  }

  // Banda de bruma dorada de las estampas: extremos en punta y degradado vertical.
  function buildBand(W, H, k) {
    var c = newCanvas(W * k, H * k);
    var g = c.getContext('2d');
    if (!g) return c;
    g.scale(k, k);
    g.beginPath();
    g.moveTo(0, H * 0.55);
    g.lineTo(W * 0.06, H * 0.02);
    g.lineTo(W * 0.94, H * 0.02);
    g.lineTo(W, H * 0.55);
    g.lineTo(W * 0.94, H * 0.98);
    g.lineTo(W * 0.06, H * 0.98);
    g.closePath();
    var gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, col(PAL.mist, 0));
    gr.addColorStop(0.5, col(PAL.mist, 0.7));
    gr.addColorStop(1, col(PAL.mist, 0));
    g.fillStyle = gr;
    g.fill();
    g.globalCompositeOperation = 'destination-in';
    var hg = g.createLinearGradient(0, 0, W, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(0.08, 'rgba(0,0,0,1)');
    hg.addColorStop(0.92, 'rgba(0,0,0,1)');
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /* ───────────── Escena ───────────── */

  class YozakuraScene {
    constructor() {
      // 0 = la escena no emite partículas del sistema compartido (los pétalos son propios).
      this.mask = 0;

      // Estado de animación propio.
      this.phase = 0;
      this.intro = 0;
      this.gust = 0;
      this.S = { bass: 0, mid: 0, high: 0, pulse: 0 };
      this._play = 1;

      // Calidad dinámica 0..2 (con histéresis).
      this.lv = 2;
      this._qMax = 0;
      this._lvT = 0;

      this._hitPrev = false;
      this._lastHit = -1e9;
      this._spawnT = 0;
      this.rng = mulberry(0x2b9e5a11);

      // Sprites estáticos (no dependen del tamaño).
      this.petalSpr = null;
      this.gSakura = null;
      this.halo = null;
      this.flowers = null;

      // Caches dependientes del tamaño.
      this._dirty = true;
      this._bw = 0;
      this._bh = 0;
      this._bsc = 0;
      this.unit = 1;
      this.hair = 0.6;
      this.moon = null; this.moonR = 30; this.mx = 0; this.my = 0;
      this.branch = null; this.bW = 0; this.bH = 0; this.bY0 = 0; this.shed = [];
      this.ridges = [];
      this.band = null; this.bands = [];
      this.stars = [];
      this.petals = [];
      this.aliveN = 0;
    }

    // El motor avisa de cambios de tamaño/calidad. La reconstrucción se hace en draw(),
    // donde se conoce la escala real del contexto.
    resize() {
      this._dirty = true;
    }

    /* ── Caches ── */

    _build(w, h, sc) {
      var rng = mulberry(0x7a30c0de), i;
      var unit = clamp(Math.min(w, h) / 900, 0.6, 1.5);
      var area = w * h;
      var detail = area > 600000 ? 2 : area > 250000 ? 1 : 0;
      this.unit = unit;
      this.hair = Math.max(0.5, unit * 0.9);

      // Sprites que no dependen del tamaño: se crean una sola vez.
      if (!this.petalSpr) {
        this.petalSpr = [];
        for (i = 0; i < 3; i++) this.petalSpr.push([buildPetalSprite(i, false), buildPetalSprite(i, true)]);
        this.gSakura = glowSprite(PAL.sakura, 64);
        this.halo = glowSprite(PAL.moon, 256);
        this.flowers = [buildFlower(0, rng), buildFlower(1, rng), buildFlower(2, rng)];
      }

      // Luna.
      this.moonR = clamp(Math.min(w, h) * 0.095, 30, 130);
      this.mx = w * 0.78;
      this.my = h * 0.18;
      this.moon = buildMoon(clamp(Math.round(this.moonR * 2 * sc * 1.1), 64, 512), rng);

      // Rama (anclada al borde derecho).
      var portrait = w < h;
      var Wb = w * (portrait ? 0.52 : 0.58);
      var Hb = Math.min(h * 0.42, Wb * 0.7);
      var kb = Math.min(sc, 1600 / Wb);
      var shedLocal = [];
      this.branch = buildBranch(Wb, Hb, kb, rng, { flowers: this.flowers, glow: this.gSakura }, detail, shedLocal);
      this.bW = Wb;
      this.bH = Hb;
      this.bY0 = portrait ? Math.max(h * 0.04, 104) : h * 0.04;
      this.shed = [];
      for (i = 0; i < shedLocal.length; i++) this.shed.push([w - Wb + shedLocal[i][0], this.bY0 + shedLocal[i][1]]);

      // Montañas: lejana (estática, con Fuji), media y cercana (con deriva leve).
      var kr = Math.min(sc, 2560 / w);
      var HsF = h * 0.42, HsM = h * 0.34, HsN = h * 0.24;
      var fbw = clamp(Math.max(w * 0.3, HsF * 1.0), 120, w * 0.8);
      var fuji = {
        x: w * (w < h ? 0.3 : 0.2),
        bw: fbw,
        fh: Math.min(HsF * 0.78, fbw * 0.4)
      };
      this.ridges = [
        {
          spr: buildRidge(w, HsF, kr, {
            n: [2, 5, 9], lo: 0.35, hi: 0.62,
            top: 'rgba(120,138,190,0.26)', bot: 'rgba(40,52,100,0.5)', rim: 0.2
          }, rng, fuji),
          Hs: HsF, speed: 0
        },
        {
          spr: buildRidge(w, HsM, kr, {
            n: [3, 7, 11], lo: 0.3, hi: 0.6,
            top: 'rgba(60,78,140,0.5)', bot: 'rgba(18,26,66,0.78)', rim: 0.12
          }, rng, null),
          Hs: HsM, speed: 4
        },
        {
          spr: buildRidge(w, HsN, kr, {
            n: [2, 6, 13], lo: 0.22, hi: 0.55,
            top: 'rgba(24,34,84,0.74)', bot: 'rgba(6,9,24,0.94)', rim: 0.06
          }, rng, null),
          Hs: HsN, speed: 7
        }
      ];

      // Bruma dorada.
      var bandW = w * 0.9, bandH = Math.max(18, h * 0.075);
      this.band = buildBand(bandW, bandH, Math.min(sc, 2));
      this.bands = [
        { y: h * 0.2, W: bandW, H: bandH, v: 7, o: w * 0.15, a: 0.11 },   // vela la luna
        { y: h * 0.62, W: bandW * 1.1, H: bandH * 1.1, v: -5, o: w * 0.6, a: 0.09 },
        { y: h * 0.77, W: bandW * 0.85, H: bandH, v: 9, o: w * 0.4, a: 0.12 }
      ];

      // Estrellas.
      this.stars = [];
      for (i = 0; i < 36; i++) {
        this.stars.push({
          x: rng() * w, y: rng() * h * 0.5,
          s: (0.8 + rng() * 0.9) * Math.max(0.7, unit * 0.9),
          a: 0.25 + rng() * 0.4, ph: rng() * TAU
        });
      }

      // Pétalos: z ascendente (los lejanos primero) para pintar de atrás hacia delante.
      this.petals = [];
      for (i = 0; i < POOL; i++) {
        var z = (i + rng()) / POOL;
        this.petals.push({
          alive: 0, z: z,
          x: rng() * (w + 100) - 20, y: rng() * (h + 60) - 30,
          vx: -(10 + 20 * z) * unit, vy: (14 + 20 * z) * unit,
          s: unit * (15 + 11 * rng()) * (0.5 + 0.9 * z),
          rot: rng() * TAU, rv: (0.6 + 1.2 * rng()) * (rng() < 0.5 ? -1 : 1),
          fp: rng() * TAU, fv: 1.5 + 1.7 * rng(), sp: rng() * TAU,
          tint: Math.min(2, Math.floor(rng() * 3 * (1.15 - z * 0.3))),
          soft: z > 0.8 ? 1 : 0
        });
      }
      this.aliveN = 0;
      this._bw = w;
      this._bh = h;
      this._bsc = sc;
      var target = this._targetPetals();
      for (i = 0; i < POOL && this.aliveN < target; i++) {
        if (rng() < target / POOL * 1.3) { this.petals[i].alive = 1; this.aliveN++; }
      }
      for (i = 0; i < POOL && this.aliveN < target; i++) {
        if (!this.petals[i].alive) { this.petals[i].alive = 1; this.aliveN++; }
      }

      this._dirty = false;
    }

    _targetPetals() {
      var base = clamp(Math.round((this._bw * this._bh) / 26000), 14, 42);
      return Math.max(8, Math.round(base * (this.lv === 2 ? 1 : this.lv === 1 ? 0.65 : 0.4)));
    }

    /* ── Calidad dinámica ──
     * q.bars se usa como señal relativa (normalizada contra el máximo visto), así no
     * importa en qué escala la entregue el motor. Cambia de nivel tras 1,2 s estables. */
    _quality(frame, dt) {
      var q = frame.q;
      var v = q ? num(q.bars, num(q.ribbons, NaN)) : NaN;
      var cand = 2;
      if (v === v) {
        if (v > this._qMax) this._qMax = v;
        var ratio = this._qMax > 0 ? v / this._qMax : 1;
        cand = ratio >= 0.75 ? 2 : ratio >= 0.4 ? 1 : 0;
      }
      if (cand !== this.lv) {
        this._lvT += dt;
        if (this._lvT > 1200) { this.lv = cand; this._lvT = 0; }
      } else {
        this._lvT = 0;
      }
    }

    /* ── Pétalos ── */

    _respawn(p, fromBranch) {
      var r = this.rng, unit = this.unit;
      if (fromBranch && this.shed.length) {
        var s = this.shed[(r() * this.shed.length) | 0];
        p.x = s[0] + (r() - 0.5) * 10;
        p.y = s[1] + (r() - 0.5) * 10;
        p.vx = -(40 + 60 * r()) * unit;
        p.vy = (8 + 20 * r()) * unit;
      } else {
        p.x = this._bw * (0.2 + 0.85 * r());
        p.y = -(10 + 50 * r());
        p.vx = -(10 + 20 * p.z) * unit;
        p.vy = (14 + 20 * p.z) * unit;
      }
    }

    _activate(fromBranch) {
      var P = this.petals, n = P.length, i0 = (this.rng() * n) | 0;
      for (var k = 0; k < n; k++) {
        var p = P[(i0 + k) % n];
        if (!p.alive) {
          p.alive = 1;
          this.aliveN++;
          this._respawn(p, fromBranch);
          return;
        }
      }
    }

    _updatePetals(dt, S) {
      var P = this.petals, w = this._bw, h = this._bh, unit = this.unit;
      var dtS = (dt / 1000) * this._play;
      var target = this._targetPetals();
      var kw = 1 - Math.exp(-dt / 700), kv = 1 - Math.exp(-dt / 600);
      var gust = this.gust, ph = this.phase, i, p, z, wt;

      for (i = 0; i < P.length; i++) {
        p = P[i];
        if (!p.alive) continue;
        z = p.z;
        // Viento hacia la izquierda (como sopla desde la rama) con ondulaciones y ráfagas.
        wt = -(12 + 22 * z) * unit * (1 + 1.3 * S.mid) - gust * (40 + 70 * z) * unit +
          Math.sin(ph * 0.6 + p.y * 0.006 + p.sp) * (10 + 8 * z) * unit * (0.5 + S.mid);
        p.vx += (wt - p.vx) * kw;
        p.vy += ((20 + 34 * z) * unit * (1 - 0.25 * S.pulse) - p.vy) * kv;
        p.x += p.vx * dtS;
        p.y += p.vy * dtS;
        p.rot += p.rv * dtS * (1 + S.mid);
        p.fp += p.fv * dtS * (1 + 0.5 * S.mid);
        if (p.y > h + 30 || p.x < -50 || p.x > w + 80) {
          if (this.aliveN > target) { p.alive = 0; this.aliveN--; }
          else this._respawn(p, false);
        }
      }

      if (this.aliveN < target) {
        this._spawnT += dt;
        if (this._spawnT > 160) { this._spawnT = 0; this._activate(false); }
      }
    }

    // Dibuja los pétalos vivos con índices [from, to). `step` > 1 simplifica (movimiento reducido).
    _drawPetals(ctx, base, from, to, step, fade) {
      var P = this.petals, w = this._bw, h = this._bh;
      var cx = w * 0.5, cy = h * 0.5, ba = base.a, bd = base.d, be = base.e, bf = base.f;
      ctx.save();
      for (var i = from; i < to; i += step) {
        var p = P[i];
        if (!p.alive) continue;
        var cr = Math.cos(p.rot), sr = Math.sin(p.rot);
        var sy = 0.28 + 0.72 * Math.abs(Math.cos(p.fp));
        // Atenuación sobre la zona de letra.
        var ex = (p.x - cx) / (w * 0.34), ey = (p.y - cy) / (h * 0.3);
        var att = 0.4 + 0.6 * smooth(0.5, 1.4, ex * ex + ey * ey);
        ctx.globalAlpha = clamp((0.66 + 0.34 * p.z) * att * (0.72 + 0.28 * sy) * fade, 0, 1);
        ctx.setTransform(ba * cr, bd * sr, -ba * sr * sy, bd * cr * sy, be + ba * p.x, bf + bd * p.y);
        ctx.drawImage(this.petalSpr[p.tint][p.soft], -p.s / 2, -p.s / 2, p.s, p.s);
      }
      ctx.restore();
    }

    /* ── Dibujo ── */

    draw(ctx, frame) {
      if (!ctx || !frame) return;

      // Limpieza independiente de la transformación activa.
      var cv = ctx.canvas;
      if (cv) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.restore();
      }

      var w = num(frame.w, 0), h = num(frame.h, 0);
      if (w < 48 || h < 48) return;

      ctx.save();
      try {
        var sc = 1, base = { a: 1, d: 1, e: 0, f: 0 };
        if (typeof ctx.getTransform === 'function') {
          var mtx = ctx.getTransform();
          sc = Math.hypot(mtx.a, mtx.b) || 1;
          base = { a: num(mtx.a, 1), d: num(mtx.d, 1), e: num(mtx.e, 0), f: num(mtx.f, 0) };
        } else {
          sc = num(frame.dpr, 1) || 1;
          base = { a: sc, d: sc, e: 0, f: 0 };
        }
        if (this._dirty || !this.moon || w !== this._bw || h !== this._bh || Math.abs(sc - this._bsc) > 0.01) {
          this._build(w, h, sc);
        }

        var S = this.S;
        var bands = frame.bands || {};
        var beat = frame.beat || {};
        var playing = frame.playing !== false;
        var anim = frame.motion === 0 || frame.reduced ? 0 : 1;
        var dt = clamp(num(frame.dt, 16.7), 0, 100);
        var dtS = dt / 1000;
        var live = anim && playing;

        this._quality(frame, dt);

        // Audio suavizado (ataque rápido, relajación lenta: sin parpadeos).
        S.bass = follow(S.bass, live ? clamp(num(bands.bass, 0), 0, 1) : 0, dt, 110, 480);
        S.mid = follow(S.mid, live ? clamp(num(bands.mid, 0), 0, 1) : 0, dt, 160, 560);
        S.high = follow(S.high, live ? clamp(num(bands.high, 0), 0, 1) : 0, dt, 80, 300);
        S.pulse = follow(S.pulse, live ? clamp(num(beat.pulse, 0), 0, 1) : 0, dt, 70, 300);
        if (!anim) { S.bass = S.mid = S.high = S.pulse = 0; this.gust = 0; }

        // Tiempo propio: lento en pausa, congelado con movimiento reducido.
        this._play = playing ? 1 : 0.2;
        if (anim) this.phase += dtS * this._play;
        this.intro = anim ? Math.min(1, this.intro + dt / 1800) : 1;
        var fade = this.intro * this.intro * (3 - 2 * this.intro);
        var ph = this.phase, hair = this.hair, i;

        // Ritmo → ráfaga de viento y pétalos que se desprenden de la rama.
        var hit = !!beat.hit;
        var tm = num(frame.tm, ph * 1000);
        this.gust *= Math.exp(-dt / 900);
        if (live && this.lv >= 1 && hit && !this._hitPrev && tm - this._lastHit > 450 &&
            num(beat.strength, 0.6) > 0.2) {
          this.gust = Math.min(1.6, this.gust + 0.7 * clamp(num(beat.strength, 0.6), 0.35, 1));
          for (i = 0; i < 3; i++) this._activate(true);
          this._lastHit = tm;
        }
        this._hitPrev = hit;
        if (anim) this._updatePetals(dt, S);

        // 1) Estrellas
        if (this.lv >= 1) {
          var ns = this.lv === 2 ? this.stars.length : 20;
          ctx.fillStyle = col(PAL.pale, 1);
          for (i = 0; i < ns; i++) {
            var st = this.stars[i];
            var tw = anim ? 0.55 + 0.45 * Math.sin(ph * 0.5 + st.ph) : 0.8;
            ctx.globalAlpha = clamp(st.a * tw * (0.8 + 0.5 * S.high), 0, 1) * fade;
            ctx.fillRect(st.x, st.y, st.s, st.s);
          }
          ctx.globalAlpha = 1;
        }

        // 2) Luna: halo que respira con los graves, anillos con los agudos y disco.
        var mx = this.mx, my = this.my, R = this.moonR;
        var hs = R * 7 * (1 + 0.03 * S.bass);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp((0.3 + 0.25 * S.bass + 0.12 * S.pulse) * fade, 0, 1);
        ctx.drawImage(this.halo, mx - hs / 2, my - hs / 2, hs, hs);
        ctx.globalCompositeOperation = 'source-over';
        if (this.lv >= 1) {
          ctx.lineWidth = hair;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = col(PAL.moon, (0.07 + 0.09 * S.high) * fade);
          ctx.beginPath(); ctx.arc(mx, my, R * 1.55, 0, TAU); ctx.stroke();
          ctx.strokeStyle = col(PAL.moon, (0.04 + 0.05 * S.bass) * fade);
          ctx.beginPath(); ctx.arc(mx, my, R * 2.2, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 0.9 * fade;
        ctx.drawImage(this.moon, mx - R, my - R, R * 2, R * 2);
        ctx.globalAlpha = 1;

        // 3) Bruma que vela la luna
        this._drawBand(ctx, 0, w, S, fade, anim);

        // 4) Rama de cerezo (se balancea con el viento)
        var sway = anim
          ? Math.sin(ph * 0.45) * 0.004 + Math.sin(ph * 1.1 + 1) * 0.0025 + (S.mid * 0.004 + this.gust * 0.004) * Math.sin(ph * 1.7)
          : 0;
        var pvY = this.bY0 + this.bH * 0.09;
        ctx.save();
        ctx.translate(w, pvY);
        ctx.rotate(sway);
        ctx.globalAlpha = fade;
        ctx.drawImage(this.branch, -this.bW, -this.bH * 0.09, this.bW, this.bH);
        ctx.restore();

        // 5) Plano lejano (Fuji) y pétalos lejanos
        var farEnd = Math.floor(POOL * 0.35);
        var step = anim ? 1 : 3;
        this._drawRidge(ctx, 0, w, h, fade, anim);
        this._drawPetals(ctx, base, 0, farEnd, step, fade);

        // 6) Bruma y cordillera media
        if (this.lv >= 1) this._drawBand(ctx, 1, w, S, fade, anim);
        this._drawRidge(ctx, 1, w, h, fade, anim);

        // 7) Bruma baja y cordillera cercana
        this._drawBand(ctx, 2, w, S, fade, anim);
        this._drawRidge(ctx, 2, w, h, fade, anim);

        // 8) Pétalos cercanos
        this._drawPetals(ctx, base, farEnd, POOL, step, fade);
      } finally {
        ctx.restore();
      }
    }

    _drawRidge(ctx, idx, w, h, fade, anim) {
      if (idx === 1 && this.lv === 0) return;
      var r = this.ridges[idx];
      var off = anim && r.speed ? (this.phase * r.speed) % w : 0;
      var y = h - r.Hs;
      ctx.globalAlpha = fade;
      ctx.drawImage(r.spr, -off, y, w, r.Hs);
      if (off > 0) ctx.drawImage(r.spr, w - off, y, w, r.Hs);
      ctx.globalAlpha = 1;
    }

    _drawBand(ctx, idx, w, S, fade, anim) {
      if (this.lv === 0 && idx !== 2) return;
      var b = this.bands[idx];
      var P = w + b.W;
      var pos = anim ? (((this.phase * b.v + b.o) % P) + P) % P : b.o % P;
      ctx.globalAlpha = clamp((b.a + 0.05 * S.bass) * fade, 0, 1);
      ctx.drawImage(this.band, pos - b.W, b.y, b.W, b.H);
      ctx.globalAlpha = 1;
    }
  }

  core.registerScene(SLUG, YozakuraScene);
})(typeof window !== 'undefined' ? window : globalThis);
