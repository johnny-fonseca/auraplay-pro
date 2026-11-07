/* lrcParser.js — parse, sincronización y utilidades de letras LRC (AuraLRC 2.2.0)
 *
 * API conservada (100 % compatible):
 *   AuraLRC.parse(text)                      → Array<{time,end,text,words?}> con .meta y .offset
 *   AuraLRC.findIndex(lines, t, offset)      → índice de la línea activa (o -1)
 *   AuraLRC.stamp(value)                     → "01:23.45" → 83.45 (o null)
 *   AuraLRC.format(seconds[, decimals])      → 83.45 → "01:23.45" (decimals: 2 por defecto, o 3 → "01:23.450")
 *
 * API nueva:
 *   AuraLRC.parse(text, options)             → opciones: offset, applyFileOffset, invertOffset,
 *                                              ambiguousColon, duration. Añade .warnings, .hasWordSync, .endTime
 *   AuraLRC.findIndex(lines, t, offset, hint)→ pista opcional para O(1) en reproducción lineal
 *   AuraLRC.findWordIndex(lineOrWords, t, offset, hint)
 *   AuraLRC.createTracker(lines, options)    → seguimiento de línea/palabra + progreso (para requestAnimationFrame)
 *   AuraLRC.stringify(lines, options)        → vuelve a generar texto LRC (opcional: LRC mejorado,
 *                                              wordStyle:"angle"|"bracket", precision:2|3)
 *   AuraLRC.normalize(lines)                 → sanea líneas de cualquier origen (JSON, caché, usuario…)
 *   AuraLRC.shift(lines, seconds)            → desplaza todas las líneas y palabras
 *   AuraLRC.validate(lines)                  → informe de problemas, nunca lanza
 *   AuraLRC.toPlainText(lines)               → solo la letra, sin tiempos
 *   AuraLRC.escapeHtml(text)                 → para usar con innerHTML
 *   AuraLRC.attachTranslation(lines, src, o) → añade traducciones (texto LRC o líneas) a unas líneas ya parseadas
 *   AuraLRC.selfTest()                       → autodiagnóstico en runtime
 *
 * Traducciones (cada línea puede traer `translation` —la primera— y `translations` —todas—, solo si las tiene):
 *   La traducción es SOLO TEXTO: si trae marcas de palabra (<> o []) se leen y se descartan, y la línea
 *   conserva la sincronización del original. Da igual la notación de cada lado: original en <> y traducción
 *   en [], o al revés, con o sin marcas.
 *
 *   1) En el mismo archivo (LDDC y similares): la traducción repite la etiqueta de tiempo del original y va
 *      justo debajo. Las líneas con EXACTAMENTE el mismo tiempo se fusionan: la primera es el original.
 *        [00:00.845]<00:00.845>Casablanca <00:01.768>te<00:02.798>
 *        [00:00.845]<00:00.845>卡萨布兰卡 我深爱着你<00:02.798>   → lines[i].translation
 *      Admite varias por línea (romanización + traducción…), multietiqueta ([a][b]texto) y tope de
 *      `limits.maxTranslations`. Una traducción vacía o igual al original se descarta.
 *      Opciones:  translations:false           no fusiona (las líneas simultáneas quedan como líneas propias)
 *                 translationOrder:"before"    la traducción va ANTES del original en el archivo
 *                 translationGap:0.05          (s) fusiona también líneas con tiempos casi iguales (0 por defecto;
 *                                              ojo: con valores altos se fusionarían líneas distintas pegadas)
 *                 translationSeparator:" / "   la traducción va en la MISMA línea tras este separador
 *   2) En un archivo aparte: parse(texto, { translation: lrcDeTraduccion }) —texto, ArrayBuffer o líneas—
 *      empareja cada línea con la más cercana en el tiempo.
 *        translationTolerance:0.5     (s) distancia máxima para emparejar
 *        translationOffset:-1000      (ms) desfase SOLO de la traducción (además de su [offset:] y de `offset`)
 *      Si el archivo de traducción es bilingüe (incluye el original), las líneas iguales se ignoran.
 *      Las líneas sin pareja generan un aviso en .warnings.
 *   3) Sobre líneas ya parseadas: attachTranslation(lines, fuente, opciones) → copia, no muta la entrada.
 *   stringify(lines) escribe las traducciones bajo cada línea (desactívalo con { translations:false });
 *   toPlainText(lines, { translations:true }) las incluye; normalize/shift/validate las respetan.
 *   Ojo: algunos generadores meten como "traducción" de la primera línea un aviso del servicio
 *   (p. ej. "以下歌词翻译由…提供"); se conserva tal cual.
 *
 * Letras con efecto karaoke (palabra a palabra). Se reconocen DOS notaciones, mezclables:
 *   · LRC mejorado:      [00:10.00]<00:10.00>Hel<00:10.50>lo <00:11.00>world<00:12.00>
 *   · Marcas entre []:   [00:00.000]4ÆM[00:03.448] [00:06.896]-[00:10.344] [00:13.792]Grimes[00:17.240]
 *     (cada marca cierra la palabra anterior y abre la siguiente; los espacios entre marcas se conservan
 *      como `space`, y la marca final marca el fin de la última palabra / de la última línea).
 *   Cada línea con palabras trae `words: [{ time, end, text, space }]`; `text` es la línea completa sin marcas.
 *
 * Garantías de robustez:
 *  - parse() NUNCA lanza: ante entrada hostil devuelve una lista (posiblemente vacía) y rellena .warnings.
 *  - Límites duros de tamaño, líneas, etiquetas por línea y metadatos (ver AuraLRC.limits).
 *  - Sin regex con backtracking catastrófico; sin estado global compartido entre llamadas.
 *  - Metadatos protegidos contra claves peligrosas (constructor, prototype, __proto__).
 *  - Todos los tiempos son finitos y están acotados en [0, 59999.99].
 *  - Funciona en navegador, Web Worker y Node (UMD sin dependencias).
 *
 * Nota de seguridad: los textos devueltos son TEXTO PLANO. Si los insertas con innerHTML,
 * pasa antes por AuraLRC.escapeHtml(). Con textContent no hace falta.
 */
(function (factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module && typeof module.exports === "object") module.exports = api;
  const host =
    typeof globalThis !== "undefined" ? globalThis :
    typeof self !== "undefined" ? self :
    typeof window !== "undefined" ? window :
    typeof global !== "undefined" ? global : null;
  if (host) host.AuraLRC = api;
})(function () {
  "use strict";

  /* ───────────────────────────── Constantes ───────────────────────────── */

  const VERSION = "2.2.0";
  const MAX_TIME = 59999.99;      // 999:59.99 — el máximo que cabe en mm:ss.xx de 3 dígitos
  const MIN_LINE = 0.35;          // duración mínima de una línea (s)

  const LIMITS = Object.freeze({
    maxChars: 5000000,            // caracteres de entrada
    maxSourceLines: 100000,       // líneas de entrada
    maxRows: 200000,              // líneas de letra resultantes
    maxStampsPerLine: 128,        // etiquetas de tiempo por línea ([00:10][00:50]…)
    maxRawLine: 20000,            // caracteres por línea de entrada
    maxText: 2000,                // caracteres por línea de letra
    maxWordsPerLine: 5000,
    maxTranslations: 8,           // traducciones por línea
    maxMetaKeys: 64,
    maxMetaValue: 512,
    maxWarnings: 50,
    maxOffsetMs: 3600000,         // ±1 h
  });

  const LEADING_TAGS = /^(?:\s*\[[^\]]*\])+/;
  const TAG = /\[([^\]]*)\]/g;
  const META = /^([a-z]{2,12})\s*:\s*(.*)$/i;
  // Marca de palabra: <mm:ss.xx> (LRC mejorado) o [mm:ss.xxx] (marcas entre corchetes). Exige ":" para no
  // confundirse con "[12]" y sin backtracking catastrófico. Captura: grupo 1 (<>) o grupo 2 ([]).
  const TIME_BODY = "(?:\\d{1,3}:)?\\d{1,3}:\\d{1,2}(?:[.:,]\\d{1,3})?";
  const WORD_TAG = new RegExp("<(" + TIME_BODY + ")>|\\[(" + TIME_BODY + ")\\]", "g");
  const ANY_ANGLE = /<[^>]*>/g;
  const STAMP = /^(?:(\d{1,3}):)?(\d{1,3})(?::(\d{1,2}))?(?:[.:,](\d{1,3}))?$/;
  const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  const BLOCKED_KEYS = new Set(["constructor", "prototype", "__proto__"]);

  /* ───────────────────────────── Utilidades ───────────────────────────── */

  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clampTime = (v) => (Number.isFinite(v) ? clamp(v, 0, MAX_TIME) : 0);

  /** Conversión numérica estricta: null/""/true/[] → NaN (a diferencia de Number()). */
  function num(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") return Number(v);
    return NaN;
  }

  const collapse = (s) => String(s).replace(CONTROL, "").replace(/\s+/g, " ").trim();

  /** Recorta sin partir un par sustituto (emoji). */
  function cap(s, max) {
    if (s.length <= max) return s;
    let r = s.slice(0, max);
    const c = r.charCodeAt(r.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) r = r.slice(0, -1);
    return r;
  }

  function setMeta(meta, key, value) {
    if (BLOCKED_KEYS.has(key)) return;
    const exists = Object.prototype.hasOwnProperty.call(meta, key);
    if (!exists && Object.keys(meta).length >= LIMITS.maxMetaKeys) return;
    meta[key] = cap(collapse(value), LIMITS.maxMetaValue);
  }

  function copyMeta(source) {
    const meta = {};
    if (!source || typeof source !== "object") return meta;
    Object.keys(source).forEach((k) => {
      const v = source[k];
      if (typeof v === "string" || isFiniteNumber(v)) setMeta(meta, String(k).toLowerCase(), String(v));
    });
    return meta;
  }

  function toText(input, warn) {
    if (typeof input === "string") return input;
    if (input == null) return "";
    try {
      const isBuffer = Object.prototype.toString.call(input) === "[object ArrayBuffer]";
      if ((isBuffer || ArrayBuffer.isView(input)) && typeof TextDecoder === "function") {
        return new TextDecoder("utf-8").decode(input);
      }
    } catch (err) {
      warn("No se pudo decodificar el binario como UTF-8.");
    }
    return "";
  }

  /* ─────────────────────────── Tiempo ⇄ texto ─────────────────────────── */

  function parseStamp(value, colonFraction) {
    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 && value <= MAX_TIME ? value : null;
    }
    if (value == null) return null;
    const m = String(value).trim().match(STAMP);
    if (!m) return null;

    let minutes, seconds, fraction;
    if (m[3] != null) {
      if (colonFraction) {
        // a:b:c → mm:ss:xx (algunos generadores antiguos usan ":" antes de las centésimas)
        if (m[4] != null) return null;
        minutes = Number(m[1] || 0);
        seconds = Number(m[2]);
        fraction = Number("0." + m[3]);
      } else {
        // a:b:c → hh:mm:ss
        minutes = Number(m[1] || 0) * 60 + Number(m[2]);
        seconds = Number(m[3]);
        fraction = m[4] == null ? 0 : Number("0." + m[4]);
      }
    } else {
      minutes = Number(m[1] || 0);
      seconds = Number(m[2]);
      fraction = m[4] == null ? 0 : Number("0." + m[4]);
    }
    const total = minutes * 60 + seconds + fraction;
    return Number.isFinite(total) && total >= 0 && total <= MAX_TIME ? total : null;
  }

  /** "01:23.45" → 83.45 · "1:02:03" → 3723 · "00:12,5" → 12.5 · inválido → null.
   *  options.ambiguousColon === "fraction" interpreta a:b:c como mm:ss:xx. */
  function stamp(value, options) {
    return parseStamp(value, !!options && options.ambiguousColon === "fraction");
  }

  /** 83.45 → "01:23.45". Redondea en unidades enteras (nunca produce "00:60.00").
   *  `decimals`: 2 (centésimas, por defecto) o 3 (milésimas: "01:23.450"). */
  function format(seconds, decimals) {
    const d = decimals === 3 ? 3 : 2;
    const scale = d === 3 ? 1000 : 100;
    let s = Number(seconds);
    if (Number.isNaN(s) || s < 0) s = 0;
    if (s > MAX_TIME) s = MAX_TIME;
    const units = Math.round(s * scale);
    const perMinute = 60 * scale;
    const m = Math.floor(units / perMinute);
    const rest = units % perMinute;
    const pad = (n) => String(n).padStart(2, "0");
    return pad(m) + ":" + pad(Math.floor(rest / scale)) + "." + String(rest % scale).padStart(d, "0");
  }

  /* ─────────────────────────── Estructura de salida ─────────────────────────── */

  function makeResult(lines, meta, offset, warnings) {
    lines.meta = meta || {};
    lines.offset = Number.isFinite(offset) ? offset : 0;
    lines.warnings = warnings || [];
    lines.hasWordSync = lines.some((l) => !!l.words);
    lines.hasTranslation = lines.some((l) => !!(l.translations && l.translations.length));
    let end = 0;
    for (const l of lines) if (l.end > end) end = l.end;
    lines.endTime = end;
    return lines;
  }

  const emptyResult = () => makeResult([], {}, 0, []);

  /* ─────────────────────────── LRC mejorado (palabras) ─────────────────────────── */

  const stripMarks = (raw) => raw.replace(WORD_TAG, "").replace(ANY_ANGLE, "");

  function parseWords(lyric, colonFraction) {
    const marks = [];
    for (const m of lyric.matchAll(WORD_TAG)) {
      marks.push({ at: m.index, len: m[0].length, time: parseStamp(m[1] != null ? m[1] : m[2], colonFraction) });
      if (marks.length >= LIMITS.maxWordsPerLine) break;
    }
    if (!marks.length) return null;

    // Texto ANTES de la primera marca: es la primera palabra (empieza en la etiqueta de la línea).
    const rawPre = stripMarks(lyric.slice(0, marks[0].at));
    const pre = collapse(rawPre);
    let preSpace = /\s$/.test(rawPre);

    const words = [];
    marks.forEach((mark, i) => {
      const next = marks[i + 1];
      const raw = stripMarks(lyric.slice(mark.at + mark.len, next ? next.at : lyric.length));
      const text = collapse(raw);

      // Un espacio al inicio del segmento (incluso un segmento que SOLO es un espacio, como en
      // "palabra[00:03.448] [00:06.896]otra") separa la palabra anterior de la siguiente.
      if (/^\s/.test(raw)) {
        if (words.length) words[words.length - 1].space = true;
        else if (pre) preSpace = true;
      }

      if (mark.time == null || !text) return;
      words.push({
        time: mark.time,
        end: next && next.time != null ? next.time : null,
        text: cap(text, LIMITS.maxText),
        space: !!next && /\s$/.test(raw),
      });
    });
    if (!words.length && !pre) return null;

    const firstTime = marks[0].time != null ? marks[0].time : (words.length ? words[0].time : null);
    return { pre, preSpace, firstTime, words };
  }

  /** Palabras de una línea para la etiqueta `t`; si hay varias etiquetas, se desplazan respecto a la primera. */
  function wordsAt(parsed, t, base) {
    const list = [];
    if (parsed.pre) {
      const first = parsed.firstTime;
      list.push({
        time: t,
        end: first == null ? null : t + (first - base),
        text: cap(parsed.pre, LIMITS.maxText),
        space: parsed.preSpace,
      });
    }
    for (const w of parsed.words) {
      list.push({
        time: t + (w.time - base),
        end: w.end == null ? null : t + (w.end - base),
        text: w.text,
        space: w.space,
      });
    }
    return list;
  }

  function buildWords(words, shift, lineEnd) {
    const times = [];
    let floor = 0;
    for (const w of words) {
      floor = Math.max(floor, clampTime(w.time + shift)); // tiempos monótonos
      times.push(floor);
    }
    return words.map((w, k) => {
      const time = times[k];
      const raw = isFiniteNumber(w.end)
        ? clampTime(w.end + shift)
        : k + 1 < times.length ? times[k + 1] : lineEnd;
      return { time, text: w.text, end: Math.max(time, raw), space: !!w.space };
    });
  }

  /* ─────────────────────────── Traducciones ─────────────────────────── */

  /**
   * Filas ya ordenadas. Forman un grupo las que están a ≤ `gap` s de la primera (0 = mismo tiempo exacto).
   * Con orden "after" (por defecto) el original es la primera del grupo; con "before", la última.
   * Si el original no tiene texto el grupo no se toca (salvo que TODAS estén vacías: queda una sola).
   * Las traducciones vacías o idénticas al original se descartan.
   */
  function mergeTranslations(rows, cfg) {
    const gap = cfg && Number.isFinite(cfg.gap) ? cfg.gap : 0;
    const before = !!cfg && cfg.before === true;
    const out = [];
    let i = 0;
    while (i < rows.length) {
      let j = i + 1;
      while (j < rows.length && rows[j].time - rows[i].time <= gap) j++;
      if (j - i === 1) { out.push(rows[i]); i = j; continue; }

      const group = rows.slice(i, j);
      const orig = before ? group[group.length - 1] : group[0];
      if (!group.some((r) => r.text)) {
        out.push(group[0]);
      } else if (!orig.text) {
        group.forEach((r) => out.push(r));
      } else {
        const list = orig.translations ? orig.translations.slice() : [];
        group.forEach((r) => {
          if (r === orig) return;
          const t = r.text;
          if (t && t !== orig.text && !list.includes(t) && list.length < LIMITS.maxTranslations) list.push(t);
        });
        if (list.length) orig.translations = list;
        out.push(orig);
      }
      i = j;
    }
    return out;
  }

  /** Empareja líneas de traducción (de otro archivo) con la línea más cercana en el tiempo. Devuelve cuántas halló pareja. */
  function pairTranslations(lines, trLines, tolerance) {
    let found = 0;
    if (!lines.length || !Array.isArray(trLines)) return found;
    for (const tr of trLines) {
      const text = tr && typeof tr.text === "string" ? tr.text : "";
      const at = tr ? Number(tr.time) : NaN;
      if (!text || !Number.isFinite(at)) continue;

      const i = locate(lines, at);
      let best = -1;
      let bestGap = Infinity;
      for (const c of [i - 1, i, i + 1]) {
        if (c < 0 || c >= lines.length || !lines[c].text) continue;
        const gap = Math.abs(lines[c].time - at);
        if (gap < bestGap) { best = c; bestGap = gap; }
      }
      if (best < 0 || bestGap > tolerance) continue;
      found++;

      const target = lines[best];
      const list = target.translations || (target.translations = []);
      if (list.length < LIMITS.maxTranslations && text !== target.text && !list.includes(text)) list.push(text);
      if (list.length) target.translation = list[0]; else delete target.translations;
    }
    return found;
  }

  /** Carga la fuente de traducción: texto/binario LRC o un array de líneas. Nunca lanza. */
  function loadTranslation(source, options, warn) {
    if (Array.isArray(source)) return normalize(source);
    const o = options && typeof options === "object" ? options : {};
    const base = num(o.offset);
    const extra = num(o.translationOffset);
    const sub = parse(source, {
      offset: (Number.isFinite(base) ? base : 0) + (Number.isFinite(extra) ? extra : 0),
      applyFileOffset: o.applyFileOffset,
      invertOffset: o.invertOffset,
      ambiguousColon: o.ambiguousColon,
      translations: false,
    });
    sub.warnings.forEach((w) => warn("Traducción: " + w));
    return sub;
  }

  function applyTranslationSource(lines, source, opt, rawOptions, warn) {
    const tr = loadTranslation(source, rawOptions, warn);
    const total = tr.filter((l) => l && l.text).length;
    const found = pairTranslations(lines, tr, opt.tolerance);
    if (!total) warn("La traducción no contiene líneas con texto.");
    else if (found < total) warn((total - found) + " de " + total + " líneas de traducción sin correspondencia (tolerancia " + opt.tolerance + " s).");
  }

  /* ─────────────────────────── Núcleo: filas → líneas finales ─────────────────────────── */

  /**
   * rows: [{ time, text, end?, words?, order }] con tiempos SIN desplazar.
   * Ordena, aplica `shift` (s), calcula `end` y normaliza palabras. Compartido por parse/normalize/shift.
   */
  function buildLines(rows, shift, duration, merge) {   // merge: null | { gap, before }
    rows.sort((a, b) => a.time - b.time || a.order - b.order);
    if (merge) rows = mergeTranslations(rows, merge);
    const n = rows.length;

    // Para cada fila: el primer tiempo ESTRICTAMENTE mayor (las líneas simultáneas, p. ej. traducciones, comparten fin).
    const upcoming = new Array(n);
    let nextTime = null;
    for (let i = n - 1; i >= 0; i--) {
      if (i < n - 1 && rows[i + 1].time > rows[i].time) nextTime = rows[i + 1].time;
      upcoming[i] = nextTime;
    }

    const lines = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = rows[i];
      const time = clampTime(row.time + shift);
      // Fin explícito de la última palabra (marca final de la línea), si existe.
      const tail = row.words && row.words.length ? row.words[row.words.length - 1].end : null;
      let end;
      if (isFiniteNumber(row.end) && row.end + shift > time) end = clampTime(row.end + shift);
      else if (upcoming[i] != null) end = Math.max(time + MIN_LINE, clampTime(upcoming[i] + shift));
      else if (isFiniteNumber(tail) && tail + shift > time) end = Math.max(time + MIN_LINE, clampTime(tail + shift));
      else if (isFiniteNumber(duration) && duration > time) end = Math.max(time + MIN_LINE, duration);
      else end = time + clamp(row.text.length * 0.08, 3, 8);

      const line = { time, text: row.text, end };
      if (row.words && row.words.length) line.words = buildWords(row.words, shift, end);
      if (row.translations && row.translations.length) {
        line.translations = row.translations.slice();
        line.translation = line.translations[0];
      }
      lines[i] = line;
    }
    return lines;
  }

  /* ─────────────────────────── parse ─────────────────────────── */

  function readOptions(o) {
    o = o && typeof o === "object" ? o : {};
    const extra = num(o.offset);
    return {
      offset: Number.isFinite(extra) ? clamp(extra, -LIMITS.maxOffsetMs, LIMITS.maxOffsetMs) : 0,
      applyFileOffset: o.applyFileOffset !== false,
      invertOffset: o.invertOffset === true,
      colonFraction: o.ambiguousColon === "fraction",
      duration: num(o.duration),
      mergeTranslations: o.translations !== false,
      mergeGap: Number.isFinite(num(o.translationGap)) ? clamp(num(o.translationGap), 0, 5) : 0,
      translationFirst: o.translationOrder === "before",
      separator: typeof o.translationSeparator === "string" && o.translationSeparator.length <= 16 &&
        o.translationSeparator.trim() !== "" && !/[\[\]<>\r\n]/.test(o.translationSeparator) ? o.translationSeparator : "",
      translation: o.translation,
      tolerance: Number.isFinite(num(o.translationTolerance)) ? clamp(num(o.translationTolerance), 0, 30) : 0.5,
    };
  }

  function parseCore(input, options) {
    const opt = readOptions(options);
    const warnings = [];
    const warn = (msg) => { if (warnings.length < LIMITS.maxWarnings) warnings.push(msg); };

    let text = toText(input, warn);
    if (!text.trim()) return makeResult([], {}, 0, warnings);
    if (text.length > LIMITS.maxChars) {
      text = text.slice(0, LIMITS.maxChars);
      warn("Entrada demasiado grande: se truncó a " + LIMITS.maxChars + " caracteres.");
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const sourceLines = text.split(/\r\n|\r|\n/);
    const total = Math.min(sourceLines.length, LIMITS.maxSourceLines);
    if (sourceLines.length > total) warn("Se ignoraron las líneas posteriores a la " + total + ".");

    const meta = {};
    let fileOffsetMs = 0;
    const rows = [];
    let order = 0;
    let longLineWarned = false;
    let stampCapWarned = false;

    for (let li = 0; li < total; li++) {
      if (rows.length >= LIMITS.maxRows) { warn("Se alcanzó el máximo de " + LIMITS.maxRows + " líneas de letra."); break; }

      let raw = sourceLines[li];
      if (raw.length > LIMITS.maxRawLine) {
        raw = raw.slice(0, LIMITS.maxRawLine);
        if (!longLineWarned) { warn("Línea " + (li + 1) + ": demasiado larga, se recortó."); longLineWarned = true; }
      }

      const lead = raw.match(LEADING_TAGS);
      if (!lead) continue;

      const stamps = [];
      const seen = new Set();
      const metas = [];
      for (const tag of lead[0].matchAll(TAG)) {
        const content = tag[1].trim();
        const info = content.match(META);
        if (info) { metas.push([info[1].toLowerCase(), info[2].trim()]); continue; }
        if (content.indexOf(":") === -1) continue;            // "[12]" no es un tiempo
        const time = parseStamp(content, opt.colonFraction);
        if (time == null || seen.has(time)) continue;
        if (stamps.length >= LIMITS.maxStampsPerLine) {
          if (!stampCapWarned) { warn("Línea " + (li + 1) + ": demasiadas etiquetas de tiempo, se ignoran las sobrantes."); stampCapWarned = true; }
          continue;
        }
        seen.add(time);
        stamps.push(time);
      }

      // Línea sin tiempos: solo aquí los "[clave:valor]" son metadatos (así "[Coro: bis]" no los contamina).
      if (!stamps.length) {
        for (const [key, value] of metas) {
          if (key === "offset") {
            const n = value === "" ? NaN : Number(value);
            if (Number.isFinite(n)) fileOffsetMs = clamp(Math.round(n), -LIMITS.maxOffsetMs, LIMITS.maxOffsetMs);
            else warn("Línea " + (li + 1) + ": [offset:] no es numérico, se ignora.");
          } else {
            setMeta(meta, key, value);
          }
        }
        continue;
      }

      let lyric = raw.slice(lead[0].length).trim();
      // Traducción en la misma línea tras un separador (opt-in): se corta antes de leer las marcas de palabra.
      let inline = "";
      if (opt.separator) {
        const k = lyric.indexOf(opt.separator);
        if (k > 0) { inline = collapse(stripMarks(lyric.slice(k + opt.separator.length))); lyric = lyric.slice(0, k).trim(); }
      }
      const inlineTr = inline ? [cap(inline, LIMITS.maxText)] : null;
      const parsed = parseWords(lyric, opt.colonFraction);
      const clean = cap(collapse(lyric.replace(WORD_TAG, "")), LIMITS.maxText);
      const base = stamps[0];

      for (const t of stamps) {
        if (rows.length >= LIMITS.maxRows) break;
        rows.push({ time: t, text: clean, words: parsed ? wordsAt(parsed, t, base) : null, translations: inlineTr, order: order++ });
      }
    }

    // Offset global (ms): se aplica a TODAS las líneas y palabras, esté donde esté la etiqueta.
    // Por defecto se SUMA (comportamiento histórico). Con invertOffset se resta (convención "positivo = antes").
    const fromFile = opt.applyFileOffset ? (opt.invertOffset ? -fileOffsetMs : fileOffsetMs) : 0;
    const shift = (fromFile + opt.offset) / 1000;

    const lines = buildLines(rows, shift, opt.duration, opt.mergeTranslations ? { gap: opt.mergeGap, before: opt.translationFirst } : null);
    if (opt.translation != null && opt.translation !== "") {
      applyTranslationSource(lines, opt.translation, opt, options, warn);
    }
    return makeResult(lines, meta, fileOffsetMs, warnings);
  }

  /** Nunca lanza. */
  function parse(input, options) {
    try {
      return parseCore(input, options);
    } catch (err) {
      const r = emptyResult();
      r.warnings.push("Error inesperado al analizar: " + (err && err.message ? err.message : String(err)));
      return r;
    }
  }

  /* ─────────────────────────── Búsqueda temporal ─────────────────────────── */

  const timeAt = (items, i) => {
    const item = items[i];
    return item ? Number(item.time) : NaN;
  };

  /** Último índice cuyo `time` ≤ target, o -1. `hint` evita la búsqueda binaria en reproducción lineal. */
  function locate(items, target, hint) {
    const n = items.length;
    if (!n) return -1;

    if (Number.isInteger(hint) && hint >= 0 && hint < n) {
      const here = timeAt(items, hint);
      const next = hint + 1 < n ? timeAt(items, hint + 1) : Infinity;
      if (here <= target && target < next) return hint;
      if (hint + 1 < n && next <= target) {
        const after = hint + 2 < n ? timeAt(items, hint + 2) : Infinity;
        if (target < after) return hint + 1;
      }
      if (target < here && hint > 0 && timeAt(items, hint - 1) <= target) return hint - 1;
    }

    let lo = 0, hi = n - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timeAt(items, mid) <= target) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return found;
  }

  function toTarget(currentTime, offset) {
    const t = Number(currentTime);
    const o = Number(offset);
    const target = t + (Number.isFinite(o) ? o : 0);
    return Number.isFinite(target) ? target : NaN;
  }

  /**
   * Índice de la línea activa en `currentTime + offset`, o -1 si aún no empezó.
   * `hint` (opcional): índice de la última búsqueda.
   */
  function findIndex(lyrics, currentTime, offset = 0, hint) {
    if (!Array.isArray(lyrics) || !lyrics.length) return -1;
    const target = toTarget(currentTime, offset);
    if (Number.isNaN(target)) return -1;
    return locate(lyrics, target, hint);
  }

  /** Índice de la palabra activa dentro de una línea (o de un array de palabras), o -1. */
  function findWordIndex(source, currentTime, offset = 0, hint) {
    const words = Array.isArray(source) ? source : source && source.words;
    if (!Array.isArray(words) || !words.length) return -1;
    const target = toTarget(currentTime, offset);
    if (Number.isNaN(target)) return -1;
    return locate(words, target, hint);
  }

  /* ─────────────────────────── Tracker (para bucles de animación) ─────────────────────────── */

  function progressOf(item, target) {
    if (!item) return 0;
    const s = Number(item.time), e = Number(item.end);
    if (!(e > s)) return target >= s ? 1 : 0;
    return clamp((target - s) / (e - s), 0, 1);
  }

  /**
   * const tracker = AuraLRC.createTracker(lines, { offset: 0 });
   * audio.ontimeupdate / rAF: const s = tracker.update(audio.currentTime);
   * s → { index, line, wordIndex, word, lineProgress, wordProgress, lineChanged, wordChanged, time }
   * Mantiene su propia pista, así que cada update es O(1) en reproducción normal y robusto ante seeks.
   */
  function createTracker(lines, options) {
    const opt = options && typeof options === "object" ? options : {};
    let lyrics = Array.isArray(lines) ? lines : [];
    let offset = Number.isFinite(num(opt.offset)) ? num(opt.offset) : 0;
    let index = -1;
    let wordIndex = -1;
    let state = { index: -1, line: null, wordIndex: -1, word: null, lineProgress: 0, wordProgress: 0, lineChanged: false, wordChanged: false, time: 0 };

    function update(currentTime) {
      const t = Number(currentTime);
      if (!Number.isFinite(t)) return state;           // entrada inválida: conserva el último estado
      const target = t + offset;

      const nextIndex = locate(lyrics, target, index);
      const line = nextIndex >= 0 ? lyrics[nextIndex] : null;
      const lineChanged = nextIndex !== index;
      const prevWord = lineChanged ? -1 : wordIndex;

      let nextWord = -1;
      let word = null;
      if (line && Array.isArray(line.words) && line.words.length) {
        nextWord = locate(line.words, target, prevWord);
        word = nextWord >= 0 ? line.words[nextWord] : null;
      }

      index = nextIndex;
      wordIndex = nextWord;
      state = {
        index: nextIndex,
        line,
        wordIndex: nextWord,
        word,
        lineProgress: progressOf(line, target),
        wordProgress: progressOf(word, target),
        lineChanged,
        wordChanged: nextWord !== prevWord,
        time: t,
      };
      return state;
    }

    return {
      update,
      seek: (time) => { index = -1; wordIndex = -1; return update(time); },
      reset: () => { index = -1; wordIndex = -1; state = { index: -1, line: null, wordIndex: -1, word: null, lineProgress: 0, wordProgress: 0, lineChanged: false, wordChanged: false, time: 0 }; },
      setLines: (next) => { lyrics = Array.isArray(next) ? next : []; index = -1; wordIndex = -1; },
      setOffset: (seconds) => { const n = num(seconds); offset = Number.isFinite(n) ? n : 0; },
      getState: () => state,
    };
  }

  /* ─────────────────────────── Normalizar / desplazar / validar ─────────────────────────── */

  /** Convierte líneas "de cualquier origen" en filas fiables; descarta lo irrecuperable. */
  function rowsFrom(lines) {
    const rows = [];
    if (!Array.isArray(lines)) return rows;
    const n = Math.min(lines.length, LIMITS.maxRows);
    for (let i = 0; i < n; i++) {
      const item = lines[i];
      if (!item || typeof item !== "object") continue;
      const time = num(item.time);
      if (!Number.isFinite(time) || time < 0 || time > MAX_TIME) continue;

      const end = num(item.end);
      const row = {
        time,
        text: typeof item.text === "string" ? cap(collapse(item.text), LIMITS.maxText) : "",
        end: Number.isFinite(end) ? end : null,
        words: null,
        translations: null,
        order: i,
      };

      const trSource = Array.isArray(item.translations) ? item.translations : item.translation != null ? [item.translation] : [];
      const trList = [];
      for (let k = 0; k < trSource.length && trList.length < LIMITS.maxTranslations; k++) {
        if (typeof trSource[k] !== "string") continue;
        const t = cap(collapse(trSource[k]), LIMITS.maxText);
        if (t && !trList.includes(t)) trList.push(t);
      }
      if (trList.length) row.translations = trList;

      if (Array.isArray(item.words)) {
        const words = [];
        const m = Math.min(item.words.length, LIMITS.maxWordsPerLine);
        for (let k = 0; k < m; k++) {
          const w = item.words[k];
          if (!w || typeof w !== "object" || typeof w.text !== "string") continue;
          const wt = num(w.time);
          const text = collapse(w.text);
          if (!Number.isFinite(wt) || wt < 0 || wt > MAX_TIME || !text) continue;
          const we = num(w.end);
          words.push({ time: wt, end: Number.isFinite(we) ? we : null, text: cap(text, LIMITS.maxText), space: !!w.space, k });
        }
        words.sort((a, b) => a.time - b.time || a.k - b.k);
        if (words.length) row.words = words;
      }
      rows.push(row);
    }
    return rows;
  }

  function decorate(lines, source) {
    const isList = Array.isArray(source);
    return makeResult(lines, copyMeta(isList ? source.meta : null), isList ? num(source.offset) : 0, []);
  }

  /** Sanea líneas procedentes de JSON, caché o código de terceros: ordena, repara `end`, filtra basura. */
  function normalize(lines, options) {
    try {
      const o = readOptions(options);
      // En normalize las líneas simultáneas solo se fusionan si se pide expresamente ({ translations: true }).
      const merge = !!options && typeof options === "object" && options.translations === true;
      return decorate(buildLines(rowsFrom(lines), 0, o.duration, merge ? { gap: o.mergeGap, before: o.translationFirst } : null), lines);
    } catch (err) {
      return emptyResult();
    }
  }

  /** Devuelve una copia desplazada `seconds` (puede ser negativa). Tiempos acotados a ≥ 0. */
  function shift(lines, seconds) {
    try {
      const delta = num(seconds);
      return decorate(buildLines(rowsFrom(lines), Number.isFinite(delta) ? delta : 0, NaN), lines);
    } catch (err) {
      return emptyResult();
    }
  }

  /**
   * Devuelve una copia de `lines` con traducciones añadidas desde `source` (texto LRC, binario o array de líneas).
   * `options`: las mismas que parse() para el texto de la traducción (offset, ambiguousColon…) más
   * `translationTolerance` (s, 0.5 por defecto). No modifica la entrada; los avisos quedan en .warnings.
   */
  function attachTranslation(lines, source, options) {
    try {
      const o = readOptions(options);
      const base = normalize(lines, options);
      const warnings = [];
      const warn = (msg) => { if (warnings.length < LIMITS.maxWarnings) warnings.push(msg); };
      applyTranslationSource(base, source, o, options, warn);
      return makeResult(base, base.meta, base.offset, warnings);
    } catch (err) {
      return normalize(lines);
    }
  }

  /** { ok, issues:[{ index, code, message }] } — nunca lanza. */
  function validate(lines) {
    const issues = [];
    const report = (index, code, message) => { if (issues.length < 100) issues.push({ index, code, message }); };
    try {
      if (!Array.isArray(lines)) {
        report(-1, "not-array", "Se esperaba un array de líneas.");
        return { ok: false, issues };
      }
      let prev = -Infinity;
      lines.forEach((line, i) => {
        if (!line || typeof line !== "object") return report(i, "invalid-line", "La línea no es un objeto.");
        const { time, end, text, words } = line;
        if (!isFiniteNumber(time) || time < 0) report(i, "invalid-time", "`time` debe ser un número finito ≥ 0.");
        else { if (time < prev) report(i, "unsorted", "Las líneas no están ordenadas por tiempo."); prev = Math.max(prev, time); }
        if (typeof text !== "string") report(i, "invalid-text", "`text` debe ser una cadena.");
        if (end !== undefined && (!isFiniteNumber(end) || (isFiniteNumber(time) && end < time))) report(i, "invalid-end", "`end` debe ser finito y ≥ `time`.");
        const tr = line.translations;
        if (tr !== undefined && (!Array.isArray(tr) || tr.some((t) => typeof t !== "string"))) report(i, "invalid-translations", "`translations` debe ser un array de cadenas.");
        if (words !== undefined) {
          if (!Array.isArray(words)) return report(i, "invalid-words", "`words` debe ser un array.");
          let pw = -Infinity;
          words.forEach((w, k) => {
            if (!w || !isFiniteNumber(w.time) || typeof w.text !== "string") return report(i, "invalid-word", "Palabra " + k + " inválida.");
            if (w.time < pw) report(i, "words-unsorted", "Palabras desordenadas en la posición " + k + ".");
            pw = Math.max(pw, w.time);
          });
        }
      });
    } catch (err) {
      report(-1, "internal", String(err && err.message ? err.message : err));
    }
    return { ok: issues.length === 0, issues };
  }

  /* ─────────────────────────── Exportación ─────────────────────────── */

  const oneLine = (v) => String(v == null ? "" : v).replace(CONTROL, "").replace(/\s+/g, " ").replace(WORD_TAG, "").trim();

  /** Cuerpo de una línea con palabras. style: "angle" → <t>palabra… · "bracket" → palabra[t] [t]palabra… */
  function wordsBody(line, style, decimals) {
    const words = line.words;
    const fmt = (t) => format(t, decimals);
    // En notación [] la primera palabra empieza en la etiqueta de la línea; si no coincide, se usa <>.
    const bracket = style === "bracket" && fmt(words[0].time) === fmt(line.time);
    let body = "";
    words.forEach((w, i) => {
      const text = oneLine(w.text);
      if (!bracket) {
        body += "<" + fmt(w.time) + ">" + text + (w.space ? " " : "");
        return;
      }
      body += text + "[" + fmt(w.end) + "]" + (w.space ? " " : "");
      const next = words[i + 1];
      if (next && fmt(next.time) !== fmt(w.end)) body += "[" + fmt(next.time) + "]";
    });
    if (!bracket) body += "<" + fmt(words[words.length - 1].end) + ">";
    return body;
  }

  /**
   * Genera texto LRC.
   * options: { enhanced:boolean, wordStyle:"angle"|"bracket", precision:2|3, meta:object, eol:"\n"|"\r\n" }.
   *  · enhanced:true escribe las palabras (por defecto con <t>; wordStyle:"bracket" usa palabra[t] [t]palabra).
   *  · precision:3 conserva milésimas ([00:03.448]); por defecto centésimas.
   * Los tiempos ya incluyen el offset del archivo, por eso no se escribe [offset:].
   */
  function stringify(lines, options) {
    const opt = options && typeof options === "object" ? options : {};
    const eol = opt.eol === "\r\n" ? "\r\n" : "\n";
    const decimals = opt.precision === 3 ? 3 : 2;
    const out = [];

    const meta = opt.meta !== undefined ? opt.meta : lines && lines.meta;
    if (meta && typeof meta === "object") {
      Object.keys(meta).forEach((k) => {
        const key = String(k).toLowerCase();
        if (!/^[a-z]{2,12}$/.test(key) || key === "offset" || BLOCKED_KEYS.has(key)) return;
        out.push("[" + key + ":" + oneLine(meta[k]).replace(/\]/g, ")") + "]");
      });
    }

    normalize(lines).forEach((line) => {
      let body;
      if (opt.enhanced && line.words && line.words.length) {
        body = wordsBody(line, opt.wordStyle, decimals);
      } else {
        body = oneLine(line.text);
      }
      out.push("[" + format(line.time, decimals) + "]" + body);
      // Las traducciones repiten la etiqueta de la línea original (así las vuelve a fusionar parse()).
      if (opt.translations !== false && line.translations) {
        line.translations.forEach((t) => out.push("[" + format(line.time, decimals) + "]" + oneLine(t)));
      }
    });

    return out.length ? out.join(eol) + eol : "";
  }

  function toPlainText(lines, options) {
    if (!Array.isArray(lines)) return "";
    const keepEmpty = !!options && options.keepEmpty === true;
    const withTranslations = !!options && options.translations === true;
    const out = [];
    for (const l of lines) {
      if (!l || typeof l.text !== "string") continue;
      if (keepEmpty || l.text) out.push(l.text);
      if (withTranslations && Array.isArray(l.translations)) {
        for (const t of l.translations) if (typeof t === "string" && t) out.push(t);
      }
    }
    return out.join("\n");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ─────────────────────────── Autodiagnóstico ─────────────────────────── */

  /** Ejecuta comprobaciones internas. Devuelve { ok, passed, total, failures }. Nunca lanza. */
  function selfTest() {
    const failures = [];
    let total = 0;
    const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
    const check = (name, fn) => {
      total++;
      try { if (!fn()) failures.push(name); } catch (err) { failures.push(name + " (lanzó: " + (err && err.message) + ")"); }
    };

    const SAMPLE = "\uFEFF[ti:Song]\r\n[00:01.00]Hola\r\n[00:03.00][00:09.00]Coro\n[offset:500]";
    const lines = parse(SAMPLE);

    check("stamp mm:ss.xx", () => near(stamp("01:23.45"), 83.45));
    check("stamp hh:mm:ss", () => stamp("1:02:03") === 3723);
    check("stamp coma decimal", () => stamp("00:12,5") === 12.5);
    check("stamp inválidos", () => stamp("abc") === null && stamp(null) === null && stamp("99:99:99:99") === null && stamp(-1) === null);
    check("stamp modo fraction", () => near(stamp("01:23:45", { ambiguousColon: "fraction" }), 83.45));
    check("format", () => format(83.45) === "01:23.45");
    check("format sin 00:60", () => format(59.996) === "01:00.00");
    check("format NaN/Infinity", () => format(NaN) === "00:00.00" && format(Infinity) === "999:59.99");

    check("parse longitud", () => lines.length === 3);
    check("parse offset global", () => near(lines[0].time, 1.5) && near(lines[1].time, 3.5) && near(lines[2].time, 9.5));
    check("parse metadatos", () => lines.meta.ti === "Song" && lines.offset === 500);
    check("parse end", () => near(lines[0].end, 3.5));

    const enhanced = parse("[00:10.00]<00:10.00>Hel<00:10.50>lo <00:11.00>world<00:12.00>");
    check("LRC mejorado", () => {
      const l = enhanced[0];
      return l.text === "Hello world" && l.words.length === 3 &&
        l.words[0].space === false && l.words[1].space === true &&
        near(l.words[2].end, 12) && enhanced.hasWordSync === true;
    });

    // Karaoke con marcas entre corchetes y milésimas (el formato de muchos generadores de letras sincronizadas).
    const KARAOKE =
      "[00:00.000]4ÆM[00:03.448] [00:06.896]-[00:10.344] [00:13.792]Grimes[00:17.240]\n" +
      "[00:17.240]Lyrics[00:18.061] [00:18.882]by[00:19.703]：[00:20.524]Ganesh[00:21.345]\n" +
      "[00:51.742]Ooh[00:51.938]";
    const karaoke = parse(KARAOKE);
    check("karaoke []: líneas y texto", () =>
      karaoke.length === 3 && karaoke.hasWordSync === true &&
      karaoke[0].text === "4ÆM - Grimes" && karaoke[1].text === "Lyrics by：Ganesh" && karaoke[2].text === "Ooh");
    check("karaoke []: palabras, tiempos y espacios", () => {
      const w = karaoke[0].words;
      return w.length === 3 &&
        w.map((x) => x.text).join("|") === "4ÆM|-|Grimes" &&
        w.map((x) => x.space).join() === "true,true,false" &&
        near(w[0].time, 0) && near(w[0].end, 3.448) &&
        near(w[1].time, 6.896) && near(w[1].end, 10.344) &&
        near(w[2].time, 13.792) && near(w[2].end, 17.24);
    });
    check("karaoke []: palabra única con marca final", () => {
      const l = karaoke[2];
      return l.words.length === 1 && near(l.words[0].end, 51.938) && l.end >= l.words[0].end && l.end < 53;
    });
    check("karaoke []: tracker (palabra y progreso)", () => {
      const t = createTracker(karaoke);
      const a = t.update(8.62);       // mitad de "-"
      const b = t.update(5);          // hueco entre palabras: sigue la anterior, ya completa
      return a.index === 0 && a.wordIndex === 1 && near(a.wordProgress, 0.5, 0.01) &&
        b.wordIndex === 0 && b.wordProgress === 1;
    });
    check("karaoke []: round-trip exacto en milésimas", () => {
      const text = stringify(karaoke, { enhanced: true, wordStyle: "bracket", precision: 3 });
      return text.split("\n")[0] === KARAOKE.split("\n")[0] && text.trim() === KARAOKE;
    });
    check("karaoke: mezcla con <> y [] no rompe", () => {
      const mixed = parse("[00:01.00]<00:01.00>Hola[00:01.50] mundo[00:02.00]");
      return mixed[0].text === "Hola mundo" && mixed[0].words.length === 2;
    });
    check("corchetes no temporales se conservan en el texto", () => parse("[00:01.00]Hola [bis] [12]")[0].text === "Hola [bis] [12]");
    check("format con 3 decimales", () => format(3.448, 3) === "00:03.448" && format(59.9996, 3) === "01:00.000");

    // Traducciones (formato LDDC: la traducción repite la etiqueta de tiempo de la línea original).
    const LDDC =
      "[ti:Morenito]\n[offset:0]\n" +
      "[00:00.440]<00:00.440>Morenito - <00:00.608>INNA<00:00.619>\n" +
      "[00:00.440]<00:00.440>以下歌词翻译由文曲大模型提供<00:00.618>\n" +
      "[00:00.845]<00:00.845>Casablanca <00:01.768>te <00:01.974>adoraré<00:02.798>\n" +
      "[00:00.845]<00:00.845>卡萨布兰卡 我深爱着你<00:02.798>";
    const lddc = parse(LDDC);
    check("traducciones: fusiona líneas simultáneas", () =>
      lddc.length === 2 && lddc.hasTranslation === true && lddc[1].text === "Casablanca te adoraré" &&
      lddc[1].translation === "卡萨布兰卡 我深爱着你" && lddc[1].translations.length === 1);
    check("traducciones: conserva palabras y fin del original", () =>
      lddc[1].words.length === 3 && near(lddc[1].words[2].end, 2.798) && near(lddc[1].end, 2.798) && near(lddc[0].end, 0.845));
    check("traducciones: translations:false las deja como líneas", () => parse(LDDC, { translations: false }).length === 4);
    check("traducciones: varias por línea", () => {
      const r = parse("[00:01.00]Hola\n[00:01.00]Hello\n[00:01.00]Ola\n[00:03.00]Adiós");
      return r.length === 2 && r[0].translations.join("|") === "Hello|Ola" && r[1].translation === undefined && r[1].translations === undefined;
    });
    check("traducciones: archivo aparte con tolerancia", () => {
      const r = parse("[00:01.00]Hola\n[00:03.00]Adiós\n[00:05.00]Fin", { translation: "[00:01.10]Hello\n[00:03.00]Bye\n[00:20.00]Lejos" });
      return r[0].translation === "Hello" && r[1].translation === "Bye" && r[2].translation === undefined && r.warnings.length === 1;
    });
    check("traducciones: attachTranslation no muta la entrada", () => {
      const src = parse("[00:01.00]Hola");
      const out = attachTranslation(src, "[00:01.00]Hello");
      return out[0].translation === "Hello" && src[0].translation === undefined && out.hasTranslation === true;
    });
    check("traducciones: round-trip con stringify", () => {
      const again = parse(stringify(lddc));
      return again.length === 2 && again[1].translation === "卡萨布兰卡 我深爱着你" && stringify(lddc, { translations: false }).indexOf("卡萨布兰卡") === -1;
    });
    check("traducciones: <> y [] en cualquier combinación", () => {
      const combos = [
        ["[00:01.00]<00:01.00>Hola<00:02.00>", "[00:01.00]<00:01.00>Hello<00:02.00>"],
        ["[00:01.00]Hola[00:02.00]", "[00:01.00]Hello[00:02.00]"],
        ["[00:01.00]<00:01.00>Hola<00:02.00>", "[00:01.00]Hello[00:02.00]"],
        ["[00:01.00]Hola[00:02.00]", "[00:01.00]<00:01.00>Hello<00:02.00>"],
        ["[00:01.00]<00:01.00>Hola<00:02.00>", "[00:01.00]Hello"],
        ["[00:01.00]Hola", "[00:01.00]<00:01.00>Hello<00:02.00>"],
      ];
      return combos.every((c) => { const r = parse(c.join("\n")); return r.length === 1 && r[0].text === "Hola" && r[0].translation === "Hello"; });
    });
    check("traducciones: translationOrder before", () => {
      const r = parse("[00:01.00]Hello\n[00:01.00]Hola", { translationOrder: "before" });
      return r.length === 1 && r[0].text === "Hola" && r[0].translation === "Hello";
    });
    check("traducciones: translationGap (tiempos casi iguales)", () => {
      const s2 = "[00:01.000]Hola\n[00:01.030]Hello";
      return parse(s2).length === 2 && parse(s2, { translationGap: 0.05 }).length === 1 && parse(s2, { translationGap: 0.05 })[0].translation === "Hello";
    });
    check("traducciones: grupo vacío colapsa, original vacío no se toca", () =>
      parse("[00:30.00]\n[00:30.00]").length === 1 && parse("[00:30.00]\n[00:30.00]Voz").length === 2);
    check("traducciones: translationOffset solo afecta a la traducción", () => {
      const r = parse("[00:01.00]Hola", { translation: "[00:02.00]Hello", translationOffset: -1000 });
      return r[0].translation === "Hello" && near(r[0].time, 1) && r.warnings.length === 0;
    });
    check("traducciones: separador en la misma línea (con y sin palabras)", () => {
      const a = parse("[00:01.00]Hola mundo / Hello world", { translationSeparator: " / " })[0];
      const b = parse("[00:01.00]<00:01.00>Hola<00:01.50> mundo<00:02.00> / Hello world", { translationSeparator: " / " })[0];
      const c = parse("[00:01.00]Hola[00:01.50] mundo[00:02.00] | Hello world", { translationSeparator: " | " })[0];
      return a.text === "Hola mundo" && a.translation === "Hello world" &&
        b.text === "Hola mundo" && b.words.length === 2 && b.translation === "Hello world" &&
        c.text === "Hola mundo" && c.words.length === 2 && c.translation === "Hello world" &&
        parse("[00:01.00]a / b")[0].text === "a / b";
    });
    check("traducciones: archivo aparte bilingüe, ArrayBuffer y líneas", () => {
      const bi = parse("[00:01.00]Hola", { translation: "[00:01.00]Hola\n[00:01.00]Hello" });
      const ab = parse("[00:01.00]Hola", { translation: new TextEncoder().encode("[00:01.00]Hello").buffer });
      const ln = parse("[00:01.00]Hola", { translation: [{ time: 1, text: "Hello" }] });
      return bi.length === 1 && bi[0].translation === "Hello" && ab[0].translation === "Hello" && ln[0].translation === "Hello";
    });
    check("traducciones: normalize, validate y toPlainText", () => {
      const n = normalize([{ time: 1, text: "a", translation: " b " }]);
      return n[0].translations[0] === "b" && validate(lddc).ok && validate([{ time: 1, text: "a", translations: [1] }]).ok === false &&
        toPlainText(lddc, { translations: true }).split("\n").length === 4;
    });

    check("hostil: tipos", () => [null, undefined, 123, {}, [], "", "   "].every((v) => Array.isArray(parse(v))));
    check("hostil: enorme", () => Array.isArray(parse("x".repeat(100000))) && Array.isArray(parse("[00:01.00]".repeat(500) + "x")));
    check("hostil: tiempos absurdos", () => parse("[99999:99]x").length === 0 && parse("[12]x").length === 0);
    check("hostil: metadatos", () => {
      const r = parse("[constructor:evil]\n[prototype:evil]\n[00:01.00]a");
      return r.meta.constructor === Object && !Object.prototype.hasOwnProperty.call(r.meta, "prototype");
    });
    check("etiqueta decorativa no es meta", () => !("coro" in parse("[00:01.00][Coro: bis] a").meta));

    check("findIndex", () => findIndex(lines, 0) === -1 && findIndex(lines, 1.5) === 0 && findIndex(lines, 4) === 1 && findIndex(lines, 9.5) === 2);
    check("findIndex con pista", () => findIndex(lines, 4, 0, 0) === 1 && findIndex(lines, 1.6, 0, 2) === 0 && findIndex(lines, 4, 0, 99) === 1);
    check("findIndex entradas inválidas", () => findIndex(null, 1) === -1 && findIndex(lines, NaN) === -1 && findIndex(lines, 4, "x") === 1);

    check("tracker", () => {
      const t = createTracker(lines);
      return t.update(4).index === 1 && t.update(9.6).index === 2 && t.update(0).index === -1 && t.update(NaN).index === -1;
    });

    check("round-trip", () => {
      const again = parse(stringify(lines));
      return again.length === 3 && again.meta.ti === "Song" && near(again[1].time, 3.5, 0.011);
    });
    check("normalize", () => {
      const fixed = normalize([{ time: "5", text: " b " }, { time: -1, text: "x" }, null, { time: 2, text: "a", end: NaN }]);
      return fixed.length === 2 && fixed[0].text === "a" && fixed[1].end > fixed[1].time;
    });
    check("shift", () => near(shift(lines, -2)[0].time, 0) && near(shift(lines, 1)[1].time, 4.5));
    check("validate", () => validate(lines).ok === true && validate([{ time: NaN }]).ok === false && validate(null).ok === false);
    check("escapeHtml", () => escapeHtml('<a href="x">&</a>') === "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");

    return { ok: failures.length === 0, passed: total - failures.length, total, failures };
  }

  /* ─────────────────────────── API pública ─────────────────────────── */

  return Object.freeze({
    version: VERSION,
    limits: LIMITS,
    parse,
    findIndex,
    findWordIndex,
    createTracker,
    stamp,
    format,
    stringify,
    normalize,
    shift,
    attachTranslation,
    validate,
    toPlainText,
    escapeHtml,
    selfTest,
  });
});
