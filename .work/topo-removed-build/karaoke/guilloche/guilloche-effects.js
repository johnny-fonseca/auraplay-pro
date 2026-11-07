/*!
 * AuraPlay Pro · Karaoke · Guilloché Zafiro
 * slug: guilloche  ·  ruta: karaoke/guilloche/guilloche-effects.js
 *
 * Plugin de escena para AuraKaraokeCore. Script clásico (compatible con `defer`).
 * Debe cargarse DESPUÉS de karaoke/shared/karaoke-core.js.
 *
 * Composición (las letras quedan libres en el centro):
 *   1. Dos rosetas guilloché en esquinas opuestas, cada una con dos capas rotando en
 *      sentidos contrarios: su moiré cambia con los medios (deriva) y los graves (respiración).
 *   2. Un bisel de reloj elíptico con marcas por perímetro. Las marcas se alargan según
 *      graves/medios/agudos y una aguja luminosa con cola las recorre lentamente.
 *   3. Ondas finas que nacen en el bisel con cada golpe de ritmo (máx. 3 a la vez).
 *   4. Destellos lentos (periodo 4–9 s) sobre las rosetas y el bisel, sensibles a agudos.
 *
 * Todo lo costoso (rosetas, sprites de brillo, geometría del bisel) se calcula una vez por
 * tamaño; por frame solo hay blits, ~8 trazos agrupados y un puñado de operaciones.
 */
(function (global) {
  'use strict';

  var SLUG = 'guilloche';
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
    frost: [201, 214, 255],     // platino azulado
    platinum: [238, 241, 248],  // platino
    rose: [232, 170, 144],      // oro rosa
    champagne: [244, 217, 194], // champán
    sapphire: [127, 155, 255]   // zafiro claro (luz ambiental)
  };

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
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
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

  /* ───────────── Roseta guilloché (sprite cacheado) ─────────────
   * Anillos concéntricos con onda senoidal cuyo desfase avanza de anillo en anillo:
   * al cruzarse con sus vecinos forman la red de rombos propia del torneado de motor.
   * Una segunda familia (otra frecuencia), radios finos y una máscara radial que
   * disuelve el borde completan la pieza. */
  function buildRosette(D, detail) {
    var c = newCanvas(D, D);
    var g = c.getContext('2d');
    if (!g) return c;

    var R = D * 0.5;
    var rings = detail === 2 ? 46 : detail === 1 ? 34 : 24;
    var steps = detail === 2 ? 900 : detail === 1 ? 640 : 420;
    var spacing = (R * 0.88) / (rings - 1);
    var hair = Math.max(0.8, D / 1300);
    var pass, j, s, f, base, amp, psi, th, r;

    g.translate(R, R);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = hair;

    // Familia A: 28 ondas por vuelta; anillos pares en platino, impares en oro rosa.
    for (pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (j = pass; j < rings; j += 2) {
        f = j / (rings - 1);
        base = R * 0.08 + R * 0.88 * f;
        amp = spacing * 1.55;
        psi = f * TAU * 1.35;
        for (s = 0; s <= steps; s++) {
          th = (s / steps) * TAU;
          r = base + amp * Math.sin(28 * th + psi);
          if (s === 0) g.moveTo(r * Math.cos(th), r * Math.sin(th));
          else g.lineTo(r * Math.cos(th), r * Math.sin(th));
        }
      }
      g.strokeStyle = pass === 0 ? col(PAL.frost, 0.95) : col(PAL.rose, 0.85);
      g.stroke();
    }

    // Familia B: 19 ondas, desfase inverso; aporta el entramado cruzado.
    if (detail >= 1) {
      var rb = Math.round(rings * 0.5);
      g.globalAlpha = 0.5;
      g.strokeStyle = col(PAL.frost, 0.9);
      g.beginPath();
      for (j = 0; j < rb; j++) {
        f = j / (rb - 1);
        base = R * 0.14 + R * 0.82 * f;
        amp = spacing * 2.2;
        psi = -f * TAU * 0.8;
        for (s = 0; s <= steps; s++) {
          th = (s / steps) * TAU;
          r = base + amp * Math.sin(19 * th + psi);
          if (s === 0) g.moveTo(r * Math.cos(th), r * Math.sin(th));
          else g.lineTo(r * Math.cos(th), r * Math.sin(th));
        }
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // Radios finos (solo en tamaños grandes).
    if (detail === 2) {
      g.strokeStyle = col(PAL.champagne, 0.22);
      g.lineWidth = hair * 0.8;
      g.beginPath();
      for (j = 0; j < 90; j++) {
        th = (j / 90) * TAU;
        g.moveTo(Math.cos(th) * R * 0.3, Math.sin(th) * R * 0.3);
        g.lineTo(Math.cos(th) * R * 0.94, Math.sin(th) * R * 0.94);
      }
      g.stroke();
    }

    // Máscara radial: el dibujo se disuelve hacia el borde del sprite.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    var m = g.createRadialGradient(R, R, 0, R, R, R);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(0.22, 'rgba(0,0,0,0.95)');
    m.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    m.addColorStop(0.78, 'rgba(0,0,0,0.18)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, D, D);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /* ───────────── Escena ───────────── */

  class GuillocheScene {
    constructor() {
      // 0 = la escena no emite partículas del sistema compartido.
      this.mask = 0;

      // Estado de animación propio (evita saltos cuando cambian dt o el estado de reproducción).
      this.phase = 0;
      this.driftA = 0;
      this.driftB = 0;
      this.intro = 0;
      this.S = { bass: 0, mid: 0, high: 0, pulse: 0 };

      // Calidad dinámica 0..2 (con histéresis).
      this.lv = 2;
      this._qMax = 0;
      this._lvT = 0;

      // Ondas de ritmo (pool fijo, sin asignaciones por frame).
      this.ripples = [
        { on: false, age: 0, k: 1 },
        { on: false, age: 0, k: 1 },
        { on: false, age: 0, k: 1 }
      ];
      this._hitPrev = false;
      this._lastRipple = -1e9;

      // Caches dependientes del tamaño.
      this._dirty = true;
      this._bw = 0;
      this._bh = 0;
      this._bsc = 0;
      this.spr = null;
      this.amb = null;
      this.gRose = null;
      this.gFrost = null;
      this.ros = [];
      this.T = null;
      this.glints = [];
      this.unit = 1;
      this.hair = 0.6;
    }

    // El motor avisa de cambios de tamaño/calidad. La reconstrucción se hace en draw(),
    // donde se conoce la escala real del contexto.
    resize() {
      this._dirty = true;
    }

    /* ── Caches ── */

    _build(w, h, sc) {
      var unit = clamp(Math.min(w, h) / 900, 0.6, 1.5);
      var rA = clamp(Math.hypot(w, h) * 0.34, 180, 1100);
      var rB = rA * 0.78;
      var D = clamp(Math.round(rA * 2 * sc), 256, 1536);
      var detail = D >= 900 ? 2 : D >= 520 ? 1 : 0;

      this.spr = buildRosette(D, detail);
      if (!this.amb) {
        this.amb = glowSprite(PAL.sapphire, 128);
        this.gRose = glowSprite(PAL.rose, 64);
        this.gFrost = glowSprite(PAL.platinum, 64);
      }

      this.unit = unit;
      this.hair = Math.max(0.5, unit * 0.9);

      // Centros ligeramente fuera del lienzo: la zona más densa queda recortada.
      this.ros = [
        { x: -rA * 0.06, y: h + rA * 0.06, r: rA },
        { x: w + rB * 0.06, y: -rB * 0.06, r: rB }
      ];

      var rng = mulberry(0x5a17c0de);
      this._layoutTicks(w, h, unit, detail, rng);
      this._layoutGlints(w, h, unit, rng);

      this._bw = w;
      this._bh = h;
      this._bsc = sc;
      this._dirty = false;
    }

    // Marcas equidistantes por longitud de arco sobre una elipse inscrita en el lienzo.
    _layoutTicks(w, h, unit, detail, rng) {
      var inset = Math.max(10, Math.min(w, h) * 0.035);
      var cx = w * 0.5, cy = h * 0.5;
      var rx = Math.max(8, w * 0.5 - inset);
      var ry = Math.max(8, h * 0.5 - inset);
      var N = detail === 2 ? 132 : detail === 1 ? 96 : 72; // múltiplos de 6 (marca mayor cada 6)
      var M = 1440, m, t, i;

      var cum = new Float32Array(M + 1);
      var px = cx, py = cy - ry, total = 0;
      for (m = 1; m <= M; m++) {
        t = -Math.PI / 2 + (m / M) * TAU;
        var x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t);
        total += Math.hypot(x - px, y - py);
        cum[m] = total;
        px = x; py = y;
      }

      var T = {
        n: N, cx: cx, cy: cy, rx: rx, ry: ry,
        x: new Float32Array(N), y: new Float32Array(N),
        nx: new Float32Array(N), ny: new Float32Array(N),
        f: new Float32Array(N), ph: new Float32Array(N), len: new Float32Array(N),
        wb: new Float32Array(N), wm: new Float32Array(N), wh: new Float32Array(N),
        major: new Uint8Array(N), bk: new Uint8Array(N)
      };

      var k = 0;
      for (i = 0; i < N; i++) {
        var target = (total * i) / N;
        while (k < M && cum[k + 1] < target) k++;
        var seg = cum[k + 1] - cum[k];
        var fr = seg > 0 ? (target - cum[k]) / seg : 0;
        t = -Math.PI / 2 + ((k + fr) / M) * TAU;
        var ct = Math.cos(t), st = Math.sin(t);

        T.x[i] = cx + rx * ct;
        T.y[i] = cy + ry * st;
        var gx = ct / rx, gy = st / ry, gl = Math.hypot(gx, gy) || 1;
        T.nx[i] = -gx / gl; // normal interior
        T.ny[i] = -gy / gl;

        var f = i / N;
        T.f[i] = f;
        T.ph[i] = rng() * TAU;
        T.major[i] = i % 6 === 0 ? 1 : 0;

        // Reparto espectral simétrico: graves abajo, agudos arriba.
        var g = Math.abs(2 * f - 1);
        var wb = 1 - smooth(0, 0.55, g);
        var wh = smooth(0.45, 1, g);
        T.wb[i] = wb;
        T.wh[i] = wh;
        T.wm[i] = Math.max(0, 1 - wb - wh);
      }
      this.T = T;
    }

    _layoutGlints(w, h, unit, rng) {
      var list = [];
      var cx = w * 0.5, cy = h * 0.5, i, tries;

      // Sobre las rosetas (solo en el cuarto visible y fuera de la zona de letra).
      for (i = 0; i < 9; i++) {
        var ro = this.ros[i % 2];
        for (tries = 0; tries < 12; tries++) {
          var rho = ro.r * (0.16 + 0.58 * rng());
          var ang = i % 2 === 0 ? -(Math.PI / 2) * rng() : Math.PI / 2 + (Math.PI / 2) * rng();
          var x = ro.x + rho * Math.cos(ang);
          var y = ro.y + rho * Math.sin(ang);
          var ex = (x - cx) / (w * 0.36), ey = (y - cy) / (h * 0.3);
          if (x > w * 0.03 && x < w * 0.97 && y > h * 0.04 && y < h * 0.96 && ex * ex + ey * ey > 1) {
            list.push({
              x: x, y: y, s: unit * (5 + 5 * rng()), per: 4 + 5 * rng(),
              ph: rng() * TAU, warm: i % 2 === 0
            });
            break;
          }
        }
      }

      // Sobre marcas mayores del bisel.
      var T = this.T, majors = Math.floor(T.n / 6);
      for (i = 0; i < 6; i++) {
        var idx = 6 * Math.floor(rng() * majors);
        list.push({
          x: T.x[idx] + T.nx[idx] * unit * 3,
          y: T.y[idx] + T.ny[idx] * unit * 3,
          s: unit * (5 + 4 * rng()), per: 4 + 5 * rng(),
          ph: rng() * TAU, warm: i % 2 === 1
        });
      }
      this.glints = list;
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
        var sc = 1;
        if (typeof ctx.getTransform === 'function') {
          var mtx = ctx.getTransform();
          sc = Math.hypot(mtx.a, mtx.b) || 1;
        } else {
          sc = num(frame.dpr, 1) || 1;
        }
        if (this._dirty || !this.spr || w !== this._bw || h !== this._bh || Math.abs(sc - this._bsc) > 0.01) {
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
        S.bass = follow(S.bass, live ? clamp(num(bands.bass, 0), 0, 1) : 0, dt, 90, 420);
        S.mid = follow(S.mid, live ? clamp(num(bands.mid, 0), 0, 1) : 0, dt, 140, 500);
        S.high = follow(S.high, live ? clamp(num(bands.high, 0), 0, 1) : 0, dt, 70, 260);
        S.pulse = follow(S.pulse, live ? clamp(num(beat.pulse, 0), 0, 1) : 0, dt, 60, 260);
        if (!anim) { S.bass = S.mid = S.high = S.pulse = 0; }

        // Tiempo propio: avanza lento en pausa y se congela con movimiento reducido.
        var play = playing ? 1 : 0.2;
        if (anim) {
          this.phase += dtS * play;
          this.driftA += dtS * (0.01 + 0.03 * S.mid) * play;
          this.driftB -= dtS * (0.007 + 0.022 * S.bass) * play;
        }
        this.intro = anim ? Math.min(1, this.intro + dt / 1600) : 1;
        var fade = this.intro * this.intro * (3 - 2 * this.intro);

        // Ondas de ritmo.
        var hit = !!beat.hit;
        var tm = num(frame.tm, this.phase * 1000);
        if (live && this.lv >= 1 && hit && !this._hitPrev && tm - this._lastRipple > 700 &&
            num(beat.strength, 0.6) > 0.2) {
          this._spawnRipple(clamp(num(beat.strength, 0.6), 0.35, 1));
          this._lastRipple = tm;
        }
        this._hitPrev = hit;
        for (var i = 0; i < 3; i++) {
          var rp = this.ripples[i];
          if (rp.on) { rp.age += dt; if (rp.age > 2800) rp.on = false; }
        }

        // 1) Luz ambiental
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.1 + 0.1 * S.mid) * fade;
        ctx.drawImage(this.amb, w * 0.5 - w * 0.62, -h * 0.46, w * 1.24, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // 2) Rosetas guilloché
        this._drawRosettes(ctx, S, fade);

        // 3) Bisel, aguja y ondas
        var head = anim ? (this.phase * 0.0165) % 1 : 0.16;
        this._drawBezel(ctx, S, fade, anim, head);
        this._drawRipples(ctx, fade);
        this._drawJewel(ctx, S, fade, head);

        // 4) Destellos
        this._drawGlints(ctx, S, fade, anim);
      } finally {
        ctx.restore();
      }
    }

    _spawnRipple(k) {
      for (var i = 0; i < 3; i++) {
        var rp = this.ripples[i];
        if (!rp.on) { rp.on = true; rp.age = 0; rp.k = k; return; }
      }
    }

    _drawRosettes(ctx, S, fade) {
      var two = this.lv >= 1;
      for (var i = 0; i < 2; i++) {
        var ro = this.ros[i];
        var sgn = i === 0 ? 1 : -1;
        this._blitRosette(
          ctx, ro, 0.35 + i * 0.9 + sgn * this.driftA,
          1 + 0.018 * S.bass, 1, (0.3 + 0.16 * S.bass) * fade
        );
        if (two) {
          this._blitRosette(
            ctx, ro, 1.15 + i * 0.6 + sgn * this.driftB,
            1 + 0.012 * S.mid, -1, (0.17 + 0.12 * S.mid) * fade
          );
        }
      }
    }

    // flipX = -1 refleja la capa: su red de rombos queda en contrafase y genera el moiré.
    _blitRosette(ctx, ro, rot, scale, flipX, alpha) {
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(ro.x, ro.y);
      ctx.rotate(rot);
      ctx.scale(scale * flipX, scale);
      ctx.drawImage(this.spr, -ro.r, -ro.r, ro.r * 2, ro.r * 2);
      ctx.restore();
    }

    _drawBezel(ctx, S, fade, anim, head) {
      var T = this.T, N = T.n, unit = this.unit, hair = this.hair;
      var lv = this.lv, phase = this.phase;
      var tail = 0.2, i, d, inten, wave, e, base;

      // Guías: línea exterior y anillo interior (doble filete de reloj).
      ctx.lineCap = 'round';
      ctx.lineWidth = hair;
      ctx.strokeStyle = col(PAL.frost, 0.1 * fade);
      ctx.beginPath();
      ctx.ellipse(T.cx, T.cy, T.rx, T.ry, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = col(PAL.frost, 0.055 * fade);
      ctx.beginPath();
      ctx.ellipse(T.cx, T.cy, Math.max(4, T.rx - unit * 34), Math.max(4, T.ry - unit * 34), 0, 0, TAU);
      ctx.stroke();

      // Longitud e intensidad por marca.
      for (i = 0; i < N; i++) {
        d = head - T.f[i];
        if (d < 0) d += 1;
        inten = d < tail ? Math.pow(1 - d / tail, 1.8) : 0;
        wave = anim ? 0.55 + 0.45 * Math.sin(phase * 1.3 + T.ph[i]) : 0.5;
        e = T.wb[i] * S.bass + T.wm[i] * S.mid + T.wh[i] * S.high;
        base = T.major[i] ? unit * 13 : unit * 6.5;
        T.len[i] = base + e * wave * (T.major[i] ? unit * 16 : unit * 9) + inten * unit * 4;
        T.bk[i] = inten > 0.66 ? 3 : inten > 0.33 ? 2 : inten > 0.06 ? 1 : 0;
      }

      // Marcas menores (todas en una sola ruta).
      ctx.strokeStyle = col(PAL.frost, 0.22 * fade);
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        if (T.major[i] || (lv === 0 && (i & 1))) continue;
        ctx.moveTo(T.x[i], T.y[i]);
        ctx.lineTo(T.x[i] + T.nx[i] * T.len[i], T.y[i] + T.ny[i] * T.len[i]);
      }
      ctx.stroke();

      // Marcas mayores.
      ctx.lineWidth = hair * 1.6;
      ctx.strokeStyle = col(PAL.champagne, 0.5 * fade);
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        if (!T.major[i]) continue;
        ctx.moveTo(T.x[i], T.y[i]);
        ctx.lineTo(T.x[i] + T.nx[i] * T.len[i], T.y[i] + T.ny[i] * T.len[i]);
      }
      ctx.stroke();

      // Cola de la aguja: tres niveles de brillo, una ruta por nivel.
      ctx.lineWidth = hair * 1.5;
      for (var b = 1; b <= 3; b++) {
        ctx.strokeStyle = col(b === 3 ? PAL.champagne : PAL.rose, (b === 1 ? 0.3 : b === 2 ? 0.55 : 0.9) * fade);
        ctx.beginPath();
        var any = false;
        for (i = 0; i < N; i++) {
          if (T.bk[i] !== b) continue;
          any = true;
          ctx.moveTo(T.x[i], T.y[i]);
          ctx.lineTo(T.x[i] + T.nx[i] * T.len[i] * 1.3, T.y[i] + T.ny[i] * T.len[i] * 1.3);
        }
        if (any) ctx.stroke();
      }
    }

    _drawRipples(ctx, fade) {
      var T = this.T;
      ctx.lineWidth = this.hair * 1.2;
      for (var i = 0; i < 3; i++) {
        var rp = this.ripples[i];
        if (!rp.on) continue;
        var x = clamp(rp.age / 2800, 0, 1);
        var e = 1 - Math.pow(1 - x, 3);
        var f = lerp(0.84, 1, e);
        var a = smooth(0, 0.12, x) * Math.pow(1 - x, 1.5) * 0.22 * rp.k * fade;
        if (a < 0.003) continue;
        ctx.strokeStyle = col(PAL.rose, a);
        ctx.beginPath();
        ctx.ellipse(T.cx, T.cy, T.rx * f, T.ry * f, 0, 0, TAU);
        ctx.stroke();
      }
    }

    _drawJewel(ctx, S, fade, head) {
      var T = this.T, N = T.n, unit = this.unit;
      var jf = head * N;
      var i0 = Math.floor(jf) % N, i1 = (i0 + 1) % N, k = jf - Math.floor(jf);
      var jx = lerp(T.x[i0], T.x[i1], k) + T.nx[i0] * unit * 3;
      var jy = lerp(T.y[i0], T.y[i1], k) + T.ny[i0] * unit * 3;
      var s = unit * (26 + 14 * S.pulse);

      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.55 + 0.3 * S.pulse, 0, 1) * fade;
      ctx.drawImage(this.gRose, jx - s / 2, jy - s / 2, s, s);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.9 * fade;
      ctx.fillStyle = col(PAL.platinum, 1);
      ctx.beginPath();
      ctx.arc(jx, jy, unit * 1.6, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    _drawGlints(ctx, S, fade, anim) {
      var G = this.glints;
      var n = this.lv >= 2 ? G.length : this.lv === 1 ? Math.ceil(G.length * 0.6) : Math.min(4, G.length);
      var hair = this.hair;

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = hair;
      for (var i = 0; i < n; i++) {
        var g = G[i], b;
        if (anim) {
          var tw = 0.5 + 0.5 * Math.sin((TAU * this.phase) / g.per + g.ph);
          tw *= tw;
          tw *= tw; // pico estrecho y suave (≈ 1–3 s), sin parpadeo
          b = tw * (0.55 + 0.65 * S.high);
        } else {
          b = 0.32;
        }
        b = clamp(b, 0, 1) * fade;
        if (b < 0.04) continue;

        var s = g.s * (0.7 + 0.5 * b);
        ctx.globalAlpha = b * 0.55;
        ctx.drawImage(g.warm ? this.gRose : this.gFrost, g.x - s * 1.6, g.y - s * 1.6, s * 3.2, s * 3.2);
        ctx.globalAlpha = b * 0.85;
        ctx.strokeStyle = col(g.warm ? PAL.champagne : PAL.platinum, 1);
        ctx.beginPath();
        ctx.moveTo(g.x - s * 1.5, g.y);
        ctx.lineTo(g.x + s * 1.5, g.y);
        ctx.moveTo(g.x, g.y - s * 1.5);
        ctx.lineTo(g.x, g.y + s * 1.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  core.registerScene(SLUG, GuillocheScene);
})(typeof window !== 'undefined' ? window : globalThis);
