/*! AuraPlay Pro · Karaoke · Yozakura (night hanami) — escena Canvas 2D
 *  Archivo : karaoke/yozakura/yozakura-effects.js
 *  Orden   : <script defer> DESPUES de karaoke/shared/karaoke-core.js
 *  Registro: window.AuraKaraokeCore.registerScene('yozakura', Scene)
 *
 *  Solo ornamentacion de fondo y contorno. No dibuja letras ni controles, no
 *  procesa audio propio y no usa core.helpers (utilidades locales). Todo se
 *  construye en resize() y se compone con drawImage; por frame no se crean
 *  arrays, gradientes, lienzos ni DOM.
 *
 *  SUPUESTOS (verificar en el repositorio, ver INTEGRATION.md):
 *   - frame: w, h, dpr, dt (ms), tm (ms), bands.{bass,mid,high} 0..1,
 *     beat.{pulse,hit,strength,bpm}, q, motion (0/1), reduced, playing.
 *   - q: numero 0..1, numero >1 (presupuesto, se normaliza /60) u objeto con
 *     .particles / .level / .quality. Ajustar tierOf() si el formato difiere.
 *   - La escala real del lienzo se deduce de ctx.canvas.width / frame.w, asi
 *     que no importa si el nucleo ya aplico ctx.scale(dpr, dpr).
 *   - Se hace clearRect al inicio de draw(): redundante si el nucleo ya limpia.
 */
(function (global) {
  'use strict';

  var core = global.AuraKaraokeCore;
  if (!core || typeof core.registerScene !== 'function') {
    throw new Error('[yozakura] AuraKaraokeCore no esta disponible: carga karaoke/shared/karaoke-core.js antes de karaoke/yozakura/yozakura-effects.js (ambos con defer, el nucleo primero).');
  }
  if (global.__auraYozakuraRegistered) { return; }

  var SLUG = 'yozakura';
  var TAU = Math.PI * 2;
  var STILL_T = 11.0;                 // fase fija de la composicion en movimiento reducido
  var MAX_PETALS = 44;
  var MAX_RINGS = 4;
  var PETALS_BY_TIER = [12, 26, 44];
  var GLINTS_BY_TIER = [4, 7, 10];
  var RINGS_BY_TIER = [1, 2, 3];
  var LANTERNS_BY_TIER = [2, 3, 3];
  var PETAL_TONES = [
    ['#e283a6', '#f6b9cb', '#fde6ee'],
    ['#d9709a', '#f9c9d7', '#fff0f4'],
    ['#cf6a93', '#f2a9c0', '#fbd9e5']
  ];

  /* ------------------------------------------------------------------ util */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function follow(cur, target, dt, up, down) {
    return cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down)));
  }
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function valueNoise(rand) {
    var tbl = new Float32Array(256), i;
    for (i = 0; i < 256; i++) { tbl[i] = rand(); }
    return function (x) {
      var i0 = Math.floor(x), f = x - i0, u = f * f * (3 - 2 * f);
      var a = tbl[i0 & 255], b = tbl[(i0 + 1) & 255];
      return a + (b - a) * u;
    };
  }
  function fbm(nz, x) {
    return nz(x) * 0.56 + nz(x * 2.13 + 11.7) * 0.29 + nz(x * 4.37 + 23.1) * 0.15;
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // Nivel de calidad 0 (bajo), 1 (medio), 2 (alto) a partir de frame.q
  function tierOf(frame) {
    var q = frame.q, v = 1;
    if (typeof q === 'number') { v = q; }
    else if (q && typeof q === 'object') { v = num(q.particles, num(q.level, num(q.quality, 1))); }
    if (!isFinite(v)) { v = 1; }
    if (v > 1) { v = v / 60; }
    v = clamp(v, 0, 1);
    return v >= 0.7 ? 2 : (v >= 0.4 ? 1 : 0);
  }

  // Lienzo fuera de pantalla en coordenadas logicas (w x h) con escala cs
  function layer(w, h, cs) {
    var c = global.document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * cs));
    c.height = Math.max(1, Math.ceil(h * cs));
    var g = c.getContext('2d');
    if (!g) { throw new Error('contexto 2d no disponible'); }
    g.scale(cs, cs);
    return { c: c, g: g, w: w, h: h };
  }

  /* ------------------------------------------------- constructores de capas */

  function buildStars(w, h, cs, mx, my, mr) {
    var hh = Math.ceil(h * 0.5), o = layer(w, hh, cs), g = o.g, rand = seeded(7);
    var i, x, y, r, a, dx, dy;
    for (i = 0; i < 70; i++) {
      x = rand() * w; y = Math.pow(rand(), 1.6) * hh; r = 0.4 + rand() * 0.9; a = 0.25 + rand() * 0.55;
      dx = x - mx; dy = y - my;
      if (dx * dx + dy * dy < mr * mr * 9) { continue; }
      g.fillStyle = 'rgba(236,232,255,' + a.toFixed(2) + ')';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    return { c: o.c, h: hh };
  }

  function buildHalo(mr, cs) {
    var R = mr * 5, d = Math.ceil(R * 2), o = layer(d, d, cs), g = o.g, c = d / 2;
    var gr = g.createRadialGradient(c, c, mr * 0.9, c, c, R);
    gr.addColorStop(0, 'rgba(244,236,214,0.34)');
    gr.addColorStop(0.22, 'rgba(244,236,214,0.12)');
    gr.addColorStop(1, 'rgba(244,236,214,0)');
    g.fillStyle = gr; g.fillRect(0, 0, d, d);
    g.strokeStyle = 'rgba(244,236,214,0.10)';          // anillo tenue alrededor de la luna
    g.lineWidth = Math.max(1, mr * 0.05);
    g.beginPath(); g.arc(c, c, mr * 2.1, 0, TAU); g.stroke();
    return { c: o.c, r: R };
  }

  function buildMoon(mr, cs) {
    var d = Math.ceil(mr * 2 + 4), o = layer(d, d, cs), g = o.g, c = d / 2, rand = seeded(31);
    var i, bx, by, br, bg;
    var gr = g.createRadialGradient(c - mr * 0.28, c - mr * 0.3, mr * 0.1, c, c, mr);
    gr.addColorStop(0, '#fffaf0'); gr.addColorStop(0.65, '#f1e8d0'); gr.addColorStop(1, '#d9ccab');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, mr, 0, TAU); g.fill();
    g.save();
    g.beginPath(); g.arc(c, c, mr, 0, TAU); g.clip();
    for (i = 0; i < 6; i++) {
      bx = c + (rand() - 0.5) * mr * 1.2; by = c + (rand() - 0.5) * mr * 1.2; br = mr * (0.16 + rand() * 0.2);
      bg = g.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(184,166,134,0.30)'); bg.addColorStop(1, 'rgba(184,166,134,0)');
      g.fillStyle = bg; g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    g.restore();
    return { c: o.c, d: d };
  }

  // Cresta de colinas (ruido fbm, mas baja en el centro para dejar libre la letra)
  function buildRidge(w, cs, o) {
    var top = Math.max(0, Math.floor(o.base - o.amp * 1.25));
    var hh = Math.max(2, Math.ceil(o.bottom - top));
    var l = layer(w, hh, cs), g = l.g, nz = valueNoise(seeded(o.seed));
    var step = 4, n = Math.ceil(w / step) + 1, prof = new Float32Array(n), i, x, e, y, gr;
    g.beginPath(); g.moveTo(0, hh);
    for (i = 0; i < n; i++) {
      x = Math.min(w, i * step);
      e = 0.45 + 0.75 * Math.pow(Math.abs(2 * x / w - 1), 1.4);
      y = o.base - o.amp * (0.25 + 0.75 * fbm(nz, x * o.freq)) * e - top;
      prof[i] = y;
      g.lineTo(x, y);
    }
    g.lineTo(w, hh); g.closePath();
    gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, o.c0); gr.addColorStop(1, o.c1);
    g.fillStyle = gr; g.fill();
    if (o.rim) {
      g.strokeStyle = o.rim; g.lineWidth = 1; g.beginPath();
      for (i = 0; i < n; i++) { if (i === 0) { g.moveTo(0, prof[0]); } else { g.lineTo(Math.min(w, i * step), prof[i]); } }
      g.stroke();
    }
    if (o.after) { o.after(g, prof, step); }
    return { c: l.c, y: top, h: hh };
  }

  // Fuji lejano: perfil concavo, cima truncada, nieve irregular
  function buildFuji(cs, fx, baseY, Hf, halfW) {
    var top = Math.floor(baseY - Hf - 4), hh = Math.ceil(baseY - top) + 2, wl = Math.ceil(halfW * 2);
    var l = layer(wl, hh, cs), g = l.g, cx = halfW, nz = valueNoise(seeded(4242)), rand = seeded(88);
    var dx, k, p, y, gr, sg, i, gx;
    g.beginPath(); g.moveTo(0, hh);
    for (dx = -halfW; dx <= halfW; dx += 3) {
      k = Math.abs(dx) / halfW;
      p = Math.max(0, k - 0.035) / (1 - 0.035);
      y = baseY - Hf * Math.pow(1 - p, 1.65) + (nz(dx * 0.045 + 5) - 0.5) * Hf * 0.03 * (1 - k);
      g.lineTo(cx + dx, y - top);
    }
    g.lineTo(wl, hh); g.closePath();
    gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#3a3450'); gr.addColorStop(1, '#2c2839');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    sg = g.createLinearGradient(0, 0, 0, Hf * 0.5);
    sg.addColorStop(0, 'rgba(246,238,246,0.78)'); sg.addColorStop(1, 'rgba(214,200,226,0.22)');
    g.fillStyle = sg;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(wl, 0);
    for (dx = halfW; dx >= -halfW; dx -= 3) {
      y = Hf * (0.17 + 0.10 * nz(dx * 0.03 + 9) + 0.045 * Math.abs(Math.sin(dx * 0.11))) + 4;
      g.lineTo(cx + dx, y);
    }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(246,238,246,0.10)'; g.lineWidth = 1;
    for (i = 0; i < 9; i++) {                       // surcos de nieve bajo la linea
      gx = cx + (rand() - 0.5) * halfW * 0.5;
      g.beginPath(); g.moveTo(gx, Hf * 0.2 + 4);
      g.lineTo(gx + (gx - cx) * 0.35, Hf * (0.38 + rand() * 0.2) + 4); g.stroke();
    }
    g.restore();
    return { c: l.c, x: fx - halfW, y: top, w: wl, h: hh };
  }

  function pagodaRoof(g, cx, y, tw, th) {
    var hw = tw / 2, lip = th * 0.55;
    g.beginPath();
    g.moveTo(cx - hw, y - lip);
    g.quadraticCurveTo(cx - hw * 0.8, y + th * 0.05, cx - hw * 0.5, y);
    g.lineTo(cx + hw * 0.5, y);
    g.quadraticCurveTo(cx + hw * 0.8, y + th * 0.05, cx + hw, y - lip);
    g.quadraticCurveTo(cx + hw * 0.55, y - th * 0.35, cx + hw * 0.2, y - th);
    g.lineTo(cx - hw * 0.2, y - th);
    g.quadraticCurveTo(cx - hw * 0.55, y - th * 0.35, cx - hw, y - lip);
    g.closePath(); g.fill();
  }

  // Pagoda de cinco pisos en silueta, con ventanas encendidas
  function drawPagoda(g, cx, by, H) {
    var tiers = 5, unit = H / (tiers * 1.12 + 0.9), wBase = H * 0.60;
    var bodyH = unit * 0.62, roofT = unit * 0.52, k, y, tw;
    g.fillStyle = '#08070c';
    g.beginPath();
    g.moveTo(cx - wBase * 0.95, by + 14); g.lineTo(cx - wBase * 0.62, by - unit * 0.1);
    g.lineTo(cx + wBase * 0.62, by - unit * 0.1); g.lineTo(cx + wBase * 0.95, by + 14);
    g.closePath(); g.fill();
    y = by - unit * 0.1;
    for (k = 0; k < tiers; k++) {
      tw = wBase * (1 - k * 0.15);
      g.fillStyle = '#08070c';
      g.fillRect(cx - tw * 0.30, y - bodyH, tw * 0.60, bodyH);
      g.fillStyle = 'rgba(244,200,140,0.55)';
      g.fillRect(cx - tw * 0.05, y - bodyH * 0.72, tw * 0.10, bodyH * 0.44);
      g.fillStyle = '#08070c';
      y -= bodyH;
      pagodaRoof(g, cx, y, tw, roofT);
      y -= roofT * 0.55;
    }
    g.fillRect(cx - H * 0.007, y - unit * 1.05, H * 0.014, unit * 1.05);
    for (k = 0; k < 4; k++) { g.fillRect(cx - H * 0.02, y - unit * (0.3 + k * 0.2), H * 0.04, H * 0.008); }
  }

  // Banda de bruma tipo kasumi, teselable en horizontal
  function buildBand(bw, bh, tint, alpha, seed, cs) {
    var o = layer(bw, bh, cs), g = o.g, rand = seeded(seed), i, j, cx, cy, rx, ry, gr, m;
    for (i = 0; i < 8; i++) {
      cx = rand() * bw; cy = bh * (0.5 + (rand() - 0.5) * 0.3);
      rx = bw * (0.09 + rand() * 0.12); ry = bh * (0.28 + rand() * 0.22);
      for (j = -1; j <= 1; j++) {
        g.save();
        g.translate(cx + j * bw, cy); g.scale(1, ry / rx);
        gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, rgba(tint, alpha)); gr.addColorStop(1, rgba(tint, 0));
        g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2);
        g.restore();
      }
    }
    g.globalCompositeOperation = 'destination-in';     // bordes superior/inferior planos y suaves
    m = g.createLinearGradient(0, 0, 0, bh);
    m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.38, 'rgba(0,0,0,1)');
    m.addColorStop(0.62, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, bw, bh);
    g.globalCompositeOperation = 'source-over';
    return o.c;
  }

  function buildWater(w, hh, cs) {
    var o = layer(w, hh, cs), g = o.g, gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#16121c'); gr.addColorStop(1, '#08070b');
    g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    g.fillStyle = 'rgba(240,228,214,0.10)'; g.fillRect(0, 0, w, 1);
    return o.c;
  }

  // Seigaiha: olas concentricas solapadas, con degradado de aparicion
  function buildSea(w, hh, cs, r) {
    var tile = r * 2, ww = w + tile * 2, o = layer(ww, hh, cs), g = o.g, m;
    var rows = Math.ceil(hh / (r * 0.5)) + 3, cols = Math.ceil(ww / tile) + 2, i, j, k, cx, cy;
    g.lineWidth = Math.max(0.7, r * 0.05);
    for (j = 0; j < rows; j++) {
      cy = j * r * 0.5;
      for (i = -1; i < cols; i++) {
        cx = i * tile + ((j & 1) ? r : 0);
        g.fillStyle = '#0c0b12';
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
        for (k = 0; k < 4; k++) {
          g.strokeStyle = k === 0 ? 'rgba(190,216,214,0.22)' : 'rgba(190,216,214,0.14)';
          g.beginPath(); g.arc(cx, cy, r * (1 - k * 0.22), Math.PI, TAU); g.stroke();
        }
      }
    }
    g.globalCompositeOperation = 'destination-in';
    m = g.createLinearGradient(0, 0, 0, hh);
    m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.35, 'rgba(0,0,0,0.85)'); m.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = m; g.fillRect(0, 0, ww, hh);
    g.globalCompositeOperation = 'source-over';
    return o.c;
  }

  function petalPath(g, r) {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-r * 0.62, -r * 0.18, -r * 0.66, -r * 0.92, -r * 0.16, -r * 1.0);
    g.lineTo(0, -r * 0.86);
    g.lineTo(r * 0.16, -r * 1.0);
    g.bezierCurveTo(r * 0.66, -r * 0.92, r * 0.62, -r * 0.18, 0, 0);
    g.closePath();
  }

  function buildPetal(cs, tone) {
    var d = 36, r = 15, o = layer(d, d, cs), g = o.g, gr;
    g.translate(d / 2, d / 2 + r / 2);
    gr = g.createRadialGradient(0, -r * 0.1, r * 0.05, 0, -r * 0.55, r);
    gr.addColorStop(0, tone[0]); gr.addColorStop(0.5, tone[1]); gr.addColorStop(1, tone[2]);
    g.fillStyle = gr; petalPath(g, r); g.fill();
    return o.c;
  }

  function drawBlossom(g, x, y, r, rot, tone, rand) {
    var k, gr, a;
    g.save(); g.translate(x, y); g.rotate(rot);
    for (k = 0; k < 5; k++) {
      g.save(); g.rotate(k * TAU / 5);
      gr = g.createRadialGradient(0, -r * 0.08, r * 0.04, 0, -r * 0.55, r * 0.95);
      gr.addColorStop(0, tone[0]); gr.addColorStop(0.45, tone[1]); gr.addColorStop(1, tone[2]);
      g.fillStyle = gr; petalPath(g, r); g.fill();
      g.strokeStyle = 'rgba(176,72,110,0.22)'; g.lineWidth = Math.max(0.4, r * 0.035);
      g.beginPath(); g.moveTo(0, -r * 0.1); g.lineTo(0, -r * 0.62); g.stroke();
      g.restore();
    }
    g.strokeStyle = 'rgba(190,70,108,0.75)'; g.lineWidth = Math.max(0.4, r * 0.04);
    g.fillStyle = '#9c2f58';
    for (k = 0; k < 7; k++) {
      a = rand() * TAU;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34); g.stroke();
      g.beginPath(); g.arc(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, Math.max(0.4, r * 0.035), 0, TAU); g.fill();
    }
    g.restore();
  }

  function bez(a, b, c, d, t) {
    var u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    return { x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, y: w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y };
  }
  function bezD(a, b, c, d, t) {
    var u = 1 - t;
    return {
      x: 3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
      y: 3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y)
    };
  }

  // Rama de cerezo que entra por el borde derecho; devuelve tambien los puntos
  // de anclaje (relativos a la raiz) de los chochin
  function buildBranch(L0, cs) {
    var bw = Math.ceil(L0 * 1.4), bh = Math.ceil(L0 * 1.15), rx = bw + 10, ry = bh * 0.45;
    var o = layer(bw, bh, cs), g = o.g, rand = seeded(2024);
    var P0 = { x: rx, y: ry }, P1 = { x: rx - 0.30 * L0, y: ry - 0.22 * L0 };
    var P2 = { x: rx - 0.66 * L0, y: ry + 0.16 * L0 }, P3 = { x: rx - L0, y: ry + 0.05 * L0 };
    var blossoms = [], anchors = [], tw = [0.14, 0.28, 0.42, 0.56, 0.70, 0.84];
    var N = 40, i, k, t, p, d, prev, side = 1, ang, tl, ex, ey, cx, cy, m, wdt, b, ta = [0.50, 0.70, 0.88];
    g.lineCap = 'round'; g.lineJoin = 'round';
    prev = bez(P0, P1, P2, P3, 0);
    for (i = 1; i <= N; i++) {
      t = i / N; p = bez(P0, P1, P2, P3, t); wdt = lerp(0.030, 0.0065, t) * L0;
      g.strokeStyle = '#1b1217'; g.lineWidth = wdt;
      g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(p.x, p.y); g.stroke();
      g.strokeStyle = 'rgba(150,104,126,0.30)'; g.lineWidth = Math.max(0.5, wdt * 0.22);
      g.beginPath(); g.moveTo(prev.x - 0.7, prev.y - 0.9); g.lineTo(p.x - 0.7, p.y - 0.9); g.stroke();
      prev = p;
    }
    for (i = 0; i < tw.length; i++) {
      t = tw[i]; p = bez(P0, P1, P2, P3, t); d = bezD(P0, P1, P2, P3, t);
      ang = Math.atan2(d.y, d.x) + side * (0.55 + rand() * 0.5); side = -side;
      tl = L0 * (0.15 + rand() * 0.14) * (1 - t * 0.25);
      ex = p.x + Math.cos(ang) * tl; ey = p.y + Math.sin(ang) * tl;
      cx = p.x + Math.cos(ang) * tl * 0.5 - Math.sin(ang) * tl * 0.2 * (rand() - 0.3);
      cy = p.y + Math.sin(ang) * tl * 0.5 + Math.cos(ang) * tl * 0.2 * (rand() - 0.3);
      g.strokeStyle = '#1b1217'; g.lineWidth = L0 * lerp(0.0105, 0.004, t);
      g.beginPath(); g.moveTo(p.x, p.y); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
      m = 3 + Math.floor(rand() * 3);
      for (k = 0; k < m; k++) {
        blossoms.push({ x: ex + (rand() - 0.5) * tl * 0.7, y: ey + (rand() - 0.5) * tl * 0.7,
          r: L0 * (0.028 + rand() * 0.018), a: rand() * TAU, tone: Math.floor(rand() * 3) });
      }
      blossoms.push({ x: (p.x + ex) * 0.5 + (rand() - 0.5) * tl * 0.3, y: (p.y + ey) * 0.5 + (rand() - 0.5) * tl * 0.3,
        r: L0 * (0.022 + rand() * 0.012), a: rand() * TAU, tone: Math.floor(rand() * 3) });
    }
    for (k = 0; k < 6; k++) {                          // racimo en la punta de la rama
      blossoms.push({ x: P3.x + (rand() - 0.5) * L0 * 0.14, y: P3.y + (rand() - 0.5) * L0 * 0.14,
        r: L0 * (0.03 + rand() * 0.02), a: rand() * TAU, tone: Math.floor(rand() * 3) });
    }
    g.fillStyle = '#c85f8d';
    for (k = 0; k < 16; k++) {                         // capullos
      b = blossoms[Math.floor(rand() * blossoms.length)];
      g.beginPath(); g.arc(b.x + (rand() - 0.5) * L0 * 0.08, b.y + (rand() - 0.5) * L0 * 0.08, Math.max(1, L0 * 0.008), 0, TAU); g.fill();
    }
    for (k = 0; k < blossoms.length; k++) {
      b = blossoms[k];
      drawBlossom(g, b.x, b.y, b.r, b.a, PETAL_TONES[b.tone], rand);
    }
    for (k = 0; k < ta.length; k++) {
      p = bez(P0, P1, P2, P3, ta[k]);
      anchors.push({ x: p.x - rx, y: p.y - ry });
    }
    return { c: o.c, w: bw, h: bh, rx: rx, ry: ry, anchors: anchors };
  }

  // Chochin: cuerpo de papel bermellon con costillas, tapas lacadas y borla
  function buildLantern(lw, lh, cs) {
    var o = layer(lw, lh, cs), g = o.g, bodyH = lh * 0.9, cap = bodyH * 0.09, i, yy, gr;
    gr = g.createLinearGradient(0, 0, lw, 0);
    gr.addColorStop(0, '#8f2415'); gr.addColorStop(0.28, '#d9442f'); gr.addColorStop(0.5, '#ff9a62');
    gr.addColorStop(0.72, '#d9442f'); gr.addColorStop(1, '#8f2415');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(lw * 0.2, cap);
    g.bezierCurveTo(-lw * 0.04, bodyH * 0.22, -lw * 0.04, bodyH * 0.78, lw * 0.2, bodyH - cap);
    g.lineTo(lw * 0.8, bodyH - cap);
    g.bezierCurveTo(lw * 1.04, bodyH * 0.78, lw * 1.04, bodyH * 0.22, lw * 0.8, cap);
    g.closePath(); g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(74,14,8,0.5)'; g.lineWidth = Math.max(0.6, lw * 0.022);
    for (i = 1; i < 8; i++) {
      yy = cap + (bodyH - cap * 2) * i / 8;
      g.beginPath(); g.moveTo(0, yy); g.quadraticCurveTo(lw / 2, yy + bodyH * 0.02, lw, yy); g.stroke();
    }
    g.restore();
    g.fillStyle = '#17100f';
    g.fillRect(lw * 0.22, 0, lw * 0.56, cap);
    g.fillRect(lw * 0.22, bodyH - cap, lw * 0.56, cap);
    g.strokeStyle = '#d9442f'; g.lineWidth = Math.max(0.6, lw * 0.03);
    for (i = -1; i <= 1; i++) {
      g.beginPath(); g.moveTo(lw / 2, bodyH); g.lineTo(lw / 2 + i * lw * 0.07, lh); g.stroke();
    }
    return o.c;
  }

  function buildGlow(R, cs) {
    var d = Math.ceil(R * 2), o = layer(d, d, cs), g = o.g, gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0, 'rgba(255,150,96,0.55)'); gr.addColorStop(0.35, 'rgba(255,120,80,0.16)');
    gr.addColorStop(1, 'rgba(255,120,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, d, d);
    return o.c;
  }

  /* ----------------------------------------------------------------- escena */

  class YozakuraScene {
    constructor() {
      this.mask = 0;                      // sin particulas compartidas del nucleo
      this.w = 0; this.h = 0; this.cs = 1; this.tier = 2;
      this.L = null;
      this.t = STILL_T;                   // reloj ambiental (s)
      this.bass = 0; this.mid = 0; this.high = 0; this.pulse = 0; this.pulseS = 0;
      this.lastHit = -1e9;
      this.rand = seeded(90210);
      this.P = {
        x: new Float32Array(MAX_PETALS), y: new Float32Array(MAX_PETALS), rot: new Float32Array(MAX_PETALS),
        vr: new Float32Array(MAX_PETALS), sz: new Float32Array(MAX_PETALS), ph: new Float32Array(MAX_PETALS),
        fall: new Float32Array(MAX_PETALS), age: new Float32Array(MAX_PETALS), kind: new Uint8Array(MAX_PETALS)
      };
      this.ring = [];
      for (var i = 0; i < MAX_RINGS; i++) { this.ring.push({ on: false, x: 0, y: 0, age: 0 }); }
    }

    resize(frame) {
      var w = Math.round(num(frame && frame.w, 0)), h = Math.round(num(frame && frame.h, 0));
      this.w = w; this.h = h; this.L = null;
      if (w < 64 || h < 64 || !global.document) { return; }
      this.cs = clamp(num(frame.dpr, 1), 1, 2);
      try {
        this.L = this.build(w, h, this.cs);
        this.seedPetals(w, h, this.L.S);
      } catch (err) {
        this.L = null;
        if (global.console && global.console.warn) {
          global.console.warn('[yozakura] no se pudo construir la cache de la escena:', err);
        }
      }
    }

    build(w, h, cs) {
      var S = Math.min(w, h * 1.7), portrait = h > w * 1.05, wy = Math.round(h * 0.85);
      var mr = S * (portrait ? 0.09 : 0.052), mx = w * (portrait ? 0.24 : 0.14), my = h * (portrait ? 0.27 : 0.31);
      var L = { S: S, portrait: portrait, wy: wy, mx: mx, my: my, mr: mr };
      var pgx = w * 0.80, Hp = Math.max(46, S * (portrait ? 0.15 : 0.10)), bandW = Math.ceil(w * 1.25);
      var st = buildStars(w, h, cs, mx, my, mr), mo = buildMoon(mr, cs), r, L0, lw, lh;

      L.stars = st.c; L.starsH = st.h;
      L.halo = buildHalo(mr, cs);
      L.moon = mo.c; L.moonD = mo.d;
      L.fuji = buildFuji(cs, w * 0.30, h * 0.80, h * (portrait ? 0.17 : 0.22), S * (portrait ? 0.50 : 0.22));
      L.r1 = buildRidge(w, cs, { base: h * 0.775, amp: h * 0.075, freq: 6 / w, seed: 11, bottom: h * 0.88,
        c0: '#2a2636', c1: '#1e1b28', rim: 'rgba(240,200,214,0.12)' });
      L.r2 = buildRidge(w, cs, { base: h * 0.835, amp: h * 0.055, freq: 8 / w, seed: 23, bottom: h * 0.87,
        c0: '#16141e', c1: '#0c0b11', rim: 'rgba(240,200,214,0.08)',
        after: function (g, prof, step) {
          var idx = Math.min(prof.length - 1, Math.max(0, Math.round(pgx / step)));
          drawPagoda(g, pgx, prof[idx] + 2, Hp);
        } });
      L.bandW = bandW;
      L.bands = [
        { c: buildBand(bandW, Math.ceil(h * 0.17), [238, 208, 168], 0.22, 307, cs), y: h * 0.65, h: h * 0.17, sp: 0.0045, al: 0.55, tier: 0 },
        { c: buildBand(bandW, Math.ceil(h * 0.15), [226, 200, 214], 0.26, 301, cs), y: h * 0.74, h: h * 0.15, sp: -0.0065, al: 0.5, tier: 0 },
        { c: buildBand(bandW, Math.ceil(h * 0.12), [226, 200, 214], 0.22, 313, cs), y: h * 0.80, h: h * 0.12, sp: 0.0085, al: 0.4, tier: 1 }
      ];
      L.water = buildWater(w, h - wy, cs);
      r = clamp(S * 0.021, 12, 30);
      L.seiTile = r * 2; L.seiV = r * 0.12; L.sea = buildSea(w, h - wy, cs, r);
      L.petal = [buildPetal(cs, PETAL_TONES[0]), buildPetal(cs, PETAL_TONES[1]), buildPetal(cs, PETAL_TONES[2])];
      L0 = S * (portrait ? 0.38 : 0.34);
      L.branch = buildBranch(L0, cs);
      L.root = { x: w + 10, y: h * (portrait ? 0.28 : 0.27) };
      lw = Math.max(16, S * 0.034); lh = lw * 1.4;
      L.lw = lw; L.lh = lh; L.lantern = buildLantern(lw, lh, cs);
      L.glowR = lw * 2.8; L.glow = buildGlow(L.glowR, cs);
      L.ropes = [S * 0.045, S * 0.085, S * 0.060];
      return L;
    }

    seedPetals(w, h, S) {
      var P = this.P, r = seeded(555), i;
      for (i = 0; i < MAX_PETALS; i++) {
        P.x[i] = r() * w; P.y[i] = r() * h * 0.95; P.rot[i] = r() * TAU; P.vr[i] = (r() - 0.5) * 2.2;
        P.sz[i] = S * (0.0085 + r() * 0.0075); P.ph[i] = r() * TAU; P.fall[i] = 0.7 + r() * 0.6;
        P.age[i] = 9; P.kind[i] = Math.floor(r() * 3);
      }
    }

    spawnRing(w, h) {
      var i, rg;
      for (i = 0; i < MAX_RINGS; i++) {
        rg = this.ring[i];
        if (!rg.on) {
          rg.on = true; rg.age = 0;
          rg.x = w * (0.06 + 0.88 * this.rand());
          rg.y = h * (0.885 + 0.08 * this.rand());
          return;
        }
      }
    }

    stepRings(dts) {
      var i, rg;
      for (i = 0; i < MAX_RINGS; i++) {
        rg = this.ring[i];
        if (rg.on) { rg.age += dts; if (rg.age > 2.2) { rg.on = false; } }
      }
    }

    stepPetals(dts, w, h) {
      var P = this.P, S = this.L.S, n = PETALS_BY_TIER[this.tier], i;
      var wind = S * (0.018 + 0.014 * this.mid), flutter = S * 0.010 * (0.6 + 1.9 * this.high);
      for (i = 0; i < n; i++) {
        P.ph[i] += dts * (1.1 + 2.2 * this.high);
        P.x[i] += (-wind * (0.7 + 0.5 * P.fall[i]) + Math.sin(P.ph[i] * 1.7 + i) * flutter) * dts;
        P.y[i] += S * 0.020 * P.fall[i] * dts;
        P.rot[i] += P.vr[i] * dts * (1 + this.high * 2);
        P.age[i] += dts;
        if (P.y[i] > h * 0.97 || P.x[i] < -P.sz[i] * 2) {
          P.x[i] = w * (0.60 + 0.42 * this.rand());
          P.y[i] = h * (0.10 + 0.34 * this.rand());
          P.age[i] = 0;
        }
      }
    }

    // Suaviza audio, reloj y particulas. Pausa y movimiento reducido son deterministas.
    step(frame, w, h) {
      var dt = clamp(num(frame.dt, 16), 0, 64), dts = dt / 1000;
      var still = !!frame.reduced || frame.motion === 0;
      var playing = frame.playing === undefined ? true : !!frame.playing;
      var live = playing && !still;
      var bd = frame.bands || {}, be = frame.beat || {};
      var tm = num(frame.tm, this.t * 1000);
      this.tier = tierOf(frame);
      this.bass = follow(this.bass, live ? clamp(num(bd.bass, 0), 0, 1) : 0, dt, 90, 380);
      this.mid = follow(this.mid, live ? clamp(num(bd.mid, 0), 0, 1) : 0, dt, 140, 520);
      this.high = follow(this.high, live ? clamp(num(bd.high, 0), 0, 1) : 0, dt, 70, 260);
      if (live && be.hit && tm - this.lastHit > 260) {
        this.lastHit = tm;
        this.pulse = Math.max(this.pulse, clamp(num(be.strength, 0.8), 0.4, 1));
        this.spawnRing(w, h);
      } else {
        this.pulse *= Math.exp(-dt / 420);
      }
      this.pulseS = follow(this.pulseS, this.pulse, dt, 70, 260);
      if (still) { this.t = STILL_T; } else if (playing) { this.t += dts; }
      if (live) { this.stepPetals(dts, w, h); this.stepRings(dts); }
    }

    drawBand(ctx, L, b, w) {
      if (this.tier < b.tier) { return; }
      var off = (((this.t * b.sp * w) % L.bandW) + L.bandW) % L.bandW;
      ctx.globalAlpha = clamp(b.al * (1 + 0.35 * this.bass), 0, 1);
      ctx.drawImage(b.c, -off, b.y, L.bandW, b.h);
      ctx.drawImage(b.c, L.bandW - off, b.y, L.bandW, b.h);
    }

    paint(ctx, L, w, h, sc) {
      var t = this.t, S = L.S, tier = this.tier, i, k, x, y, a, f, gw, gn, u, rx, rg;
      var P = this.P, n, sz, dx, dy, d, cf, al, c, s, sy;
      var hs = 1 + 0.07 * this.bass;

      // Cielo alto y luna
      if (tier >= 1) { ctx.globalAlpha = 0.9; ctx.drawImage(L.stars, 0, 0, w, L.starsH); }
      ctx.globalAlpha = clamp(0.64 + 0.30 * this.bass, 0, 1);
      ctx.drawImage(L.halo.c, L.mx - L.halo.r * hs, L.my - L.halo.r * hs, L.halo.r * 2 * hs, L.halo.r * 2 * hs);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.moon, L.mx - L.moonD / 2, L.my - L.moonD / 2, L.moonD, L.moonD);

      // Montanas y bruma por planos
      ctx.drawImage(L.fuji.c, L.fuji.x, L.fuji.y, L.fuji.w, L.fuji.h);
      this.drawBand(ctx, L, L.bands[0], w);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.r1.c, 0, L.r1.y, w, L.r1.h);
      this.drawBand(ctx, L, L.bands[1], w);
      ctx.globalAlpha = 1;
      ctx.drawImage(L.r2.c, 0, L.r2.y, w, L.r2.h);
      this.drawBand(ctx, L, L.bands[2], w);

      // Agua, seigaiha y reflejo de luna
      ctx.globalAlpha = 1;
      ctx.drawImage(L.water, 0, L.wy, w, h - L.wy);
      ctx.globalAlpha = clamp(0.55 + 0.32 * this.mid, 0, 1);
      ctx.drawImage(L.sea, -L.seiTile + ((t * L.seiV) % L.seiTile), L.wy, w + L.seiTile * 2, h - L.wy);
      gn = GLINTS_BY_TIER[tier];
      ctx.fillStyle = '#f6ead0';
      for (k = 0; k < gn; k++) {
        f = gn > 1 ? k / (gn - 1) : 0;
        y = L.wy + (h - L.wy) * (0.10 + 0.74 * f);
        gw = L.mr * (0.30 + 0.95 * f) * (0.75 + 0.25 * Math.sin(t * 1.1 + k * 1.7));
        x = L.mx + Math.sin(t * 0.7 + k * 2.3) * L.mr * (0.10 + 0.30 * f);
        a = (0.10 + 0.44 * this.high * (0.5 + 0.5 * Math.sin(t * 3.1 + k * 5.3))) * (1 - 0.35 * f);
        ctx.globalAlpha = clamp(a, 0, 0.7);
        ctx.fillRect(x - gw / 2, y, gw, 1.3 + f);
      }

      // Ondas de golpe (hamon)
      ctx.strokeStyle = '#cfe6e2'; ctx.lineWidth = 1.1;
      for (i = 0; i < RINGS_BY_TIER[tier]; i++) {
        rg = this.ring[i];
        if (!rg.on) { continue; }
        u = rg.age / 2.2; rx = lerp(S * 0.008, S * 0.07, easeOut(u));
        ctx.globalAlpha = (1 - u) * (1 - u) * 0.34;
        ctx.beginPath(); ctx.ellipse(rg.x, rg.y, rx, rx * 0.2, 0, 0, TAU); ctx.stroke();
        if (u > 0.12) {
          ctx.globalAlpha = (1 - u) * (1 - u) * 0.24;
          ctx.beginPath(); ctx.ellipse(rg.x, rg.y, rx * 0.62, rx * 0.124, 0, 0, TAU); ctx.stroke();
        }
      }

      // Rama de cerezo (balanceo con los medios) y chochin
      var th = (Math.sin(t * 0.55 + 0.4) * 0.010 + Math.sin(t * 1.3 + 1.1) * 0.004) * (1 + 2.2 * this.mid);
      var ct = Math.cos(th), st = Math.sin(th), B = L.branch, an, ax, ay, ang, rope, cnt;
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(L.root.x, L.root.y); ctx.rotate(th);
      ctx.drawImage(B.c, -B.rx, -B.ry, B.w, B.h);
      ctx.restore();
      cnt = Math.min(B.anchors.length, L.portrait ? 2 : LANTERNS_BY_TIER[tier]);
      for (i = 0; i < cnt; i++) {
        an = B.anchors[i];
        ax = L.root.x + an.x * ct - an.y * st; ay = L.root.y + an.x * st + an.y * ct;
        ang = Math.sin(t * (0.8 + 0.13 * i) + i * 2.1) * (0.045 + 0.05 * this.mid) + 0.015 * Math.sin(t * 0.31 + i);
        rope = L.ropes[i];
        ctx.save();
        ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(30,20,26,0.9)'; ctx.lineWidth = Math.max(1, S * 0.0012);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, rope); ctx.stroke();
        ctx.drawImage(L.lantern, -L.lw / 2, rope, L.lw, L.lh);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(0.30 + 0.34 * this.bass + 0.30 * this.pulseS, 0, 0.85);
        ctx.drawImage(L.glow, -L.glowR, rope + L.lh * 0.5 - L.glowR, L.glowR * 2, L.glowR * 2);
        ctx.restore();
      }

      // Petalos (atenuados sobre la zona de la letra)
      n = PETALS_BY_TIER[tier];
      for (i = 0; i < n; i++) {
        sz = P.sz[i];
        dx = (P.x[i] - w * 0.5) / (w * 0.34); dy = (P.y[i] - h * 0.5) / (h * 0.26);
        d = dx * dx + dy * dy; cf = d < 1 ? 0.26 + 0.74 * d : 1;
        al = cf * Math.min(1, P.age[i] / 1.2) * 0.92;
        if (P.y[i] > h * 0.9) { al *= clamp((h * 0.97 - P.y[i]) / (h * 0.07), 0, 1); }
        if (al < 0.02) { continue; }
        c = Math.cos(P.rot[i]); s = Math.sin(P.rot[i]);
        sy = 0.38 + 0.62 * Math.abs(Math.cos(P.ph[i] * 0.9 + i));
        ctx.globalAlpha = al;
        ctx.setTransform(c * sc, s * sc, -s * sy * sc, c * sy * sc, P.x[i] * sc, P.y[i] * sc);
        ctx.drawImage(L.petal[P.kind[i]], -sz * 0.5, -sz * 0.5, sz, sz);
      }
      ctx.setTransform(sc, 0, 0, sc, 0, 0);
      ctx.globalAlpha = 1;
    }

    draw(ctx, frame) {
      if (!ctx || !frame) { return; }
      var w = Math.round(num(frame.w, 0)), h = Math.round(num(frame.h, 0));
      if (w < 64 || h < 64) { return; }
      var cs = clamp(num(frame.dpr, 1), 1, 2);
      if (this.w !== w || this.h !== h || this.cs !== cs) { this.resize(frame); }
      var cv = ctx.canvas, sc = (cv && cv.width > 0) ? cv.width / num(frame.w, w) : cs;
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv && cv.width ? cv.width : w * sc, cv && cv.height ? cv.height : h * sc);
        ctx.setTransform(sc, 0, 0, sc, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (this.L) {
          this.step(frame, w, h);
          this.paint(ctx, this.L, w, h, sc);
        }
      } finally {
        ctx.restore();
      }
    }
  }

  core.registerScene(SLUG, YozakuraScene);
  global.__auraYozakuraRegistered = true;
})(typeof window !== 'undefined' ? window : globalThis);
