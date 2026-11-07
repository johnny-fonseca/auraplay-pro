/* utils.js — helpers compartidos (AuraUtils) · versión reforzada
 *
 * API pública conservada: formatTime, escapeHTML, cleanName, pickTitle, pickArtist,
 * pickAlbum, clamp, debounce, isAudioFile, isLrcFile, baseName, uid, download.
 * Añadidos: throttle, rafThrottle, sleep, formatBytes, safeFileName, once.
 *
 * Garantías:
 *  - Ninguna función lanza por entradas inválidas (undefined, null, NaN, Symbol, BigInt,
 *    objetos sin prototipo, Proxies hostiles, getters que lanzan, strings enormes…).
 *  - Los métodos no dependen de `this`: se pueden desestructurar (`const { clamp } = AuraUtils`).
 *  - Funciona sin DOM (Node, workers, tests) y sin crypto / requestAnimationFrame.
 *  - Los callbacks de debounce/throttle/rafThrottle/once nunca rompen el temporizador si fallan.
 */
(function (root) {
  "use strict";

  /* ───────────── constantes ───────────── */

  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  const HTML_RE = /[&<>"'`]/g;
  const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|wav|wave|ogg|oga|opus|flac|wma|weba|webm|aif|aiff|aifc|mka|amr|caf)$/i;
  const AUDIO_MIME_EXTRA = /^(application\/ogg|video\/webm|video\/mp4|application\/x-flac)$/i;
  const LRC_EXT = /\.lrc$/i;

  // Extensión = último ".algo" sin espacios ni separadores (evita que "Mr. Brightside" pierda texto).
  const EXT_RE = /\.[^.\s\\/]{1,10}$/;
  const CTRL_RE = /[\u0000-\u001f\u007f-\u009f]+/g;
  const INVISIBLE_RE = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
  const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\.|$)/i;

  const MAX_TIMER = 2147483647;      // setTimeout dispara de inmediato si se supera
  const MAX_PATH = 4096;
  const MAX_NAME = 1000;
  const MAX_TAG = 500;
  const MAX_FILE_NAME = 180;
  const REVOKE_DELAY = 30000;

  /* ───────────── helpers internos ───────────── */

  const noop = function () {};
  const isFn = (f) => typeof f === "function";
  const isNum = (n) => typeof n === "number" && Number.isFinite(n);

  function log(level, ...args) {
    try { if (root.console && isFn(root.console[level])) root.console[level](...args); } catch (_) { /* nada */ }
  }

  /** Number() que nunca lanza (Symbol, objetos con valueOf que lanza, Proxies…). */
  function toNum(v) {
    if (typeof v === "number") return v;
    try { return Number(v); } catch (_) { return NaN; }
  }

  /** String() que nunca lanza; null/undefined → "". */
  function toStr(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try { return String(v); } catch (_) { return ""; }
  }

  /** Lectura de propiedad que nunca lanza (getters hostiles, Proxies). */
  function safeGet(obj, key) {
    try { return obj == null ? undefined : obj[key]; } catch (_) { return undefined; }
  }

  /** Milisegundos válidos para setTimeout: entero finito en [0, MAX_TIMER]. */
  function delay(ms) {
    ms = toNum(ms);
    if (!isNum(ms) || ms < 0) return 0;
    return Math.min(MAX_TIMER, Math.floor(ms));
  }

  const now = () => {
    try {
      const p = root.performance;
      if (p && isFn(p.now)) return p.now();
    } catch (_) { /* cae a Date */ }
    return Date.now();
  };

  /** Unicode bien formado + NFC (macOS entrega NFD; Windows/Linux NFC). */
  function normalizeText(s) {
    try { if (isFn(s.toWellFormed)) s = s.toWellFormed(); } catch (_) { /* nada */ }
    try { s = s.normalize("NFC"); } catch (_) { /* nada */ }
    return s;
  }

  /** Controles → espacio, invisibles/bidi fuera, espacios colapsados. */
  function tidy(s) {
    return s.replace(CTRL_RE, " ").replace(INVISIBLE_RE, "").replace(/\s+/g, " ").trim();
  }

  /** Último segmento de una ruta con "/" o "\". */
  function lastSegment(s) {
    if (s.length > MAX_PATH) s = s.slice(-MAX_PATH);
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function tagText(tags, key) {
    const v = safeGet(tags, key);
    const s = typeof v === "string" ? v : isNum(v) ? String(v) : "";
    return s ? tidy(normalizeText(s)).slice(0, MAX_TAG).trim() : "";
  }

  function isBlob(b) {
    if (b == null || typeof b !== "object") return false;
    try {
      if (typeof Blob !== "undefined" && b instanceof Blob) return true;
    } catch (_) { /* nada */ }
    return /^\[object (Blob|File)\]$/.test(Object.prototype.toString.call(b));
  }

  function abortError(signal) {
    const reason = safeGet(signal, "reason");
    if (reason !== undefined) return reason;
    const e = new Error("Aborted");
    e.name = "AbortError";
    return e;
  }

  /* ───────────── formato ───────────── */

  /** 0 → "0:00" · 65 → "1:05" · 3725 → "1:02:05". Tolera NaN, Infinity, negativos, strings, BigInt. */
  function formatTime(sec) {
    sec = toNum(sec);
    if (!isNum(sec) || sec < 0) return "0:00";
    const total = Math.min(Math.floor(sec), Number.MAX_SAFE_INTEGER);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = s < 10 ? "0" + s : String(s);
    if (h > 0) return `${h}:${m < 10 ? "0" : ""}${m}:${ss}`;
    return `${m}:${ss}`;
  }

  function formatBytes(bytes, digits = 1) {
    bytes = toNum(bytes);
    if (!isNum(bytes) || bytes <= 0) return "0 B";
    let d = toNum(digits);
    d = isNum(d) ? Math.min(6, Math.max(0, Math.floor(d))) : 1;

    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    if (i === 0) return `${Math.round(v)} B`;

    let text = v.toFixed(d);
    // 1023.99 KB redondea a "1024.0": subir de unidad en vez de mostrar "1024.0 KB".
    if (parseFloat(text) >= 1024 && i < units.length - 1) {
      v /= 1024; i++;
      text = v.toFixed(d);
    }
    return `${text} ${units[i]}`;
  }

  function escapeHTML(str) {
    return toStr(str).replace(HTML_RE, (c) => HTML_ESCAPES[c]);
  }

  /* ───────────── nombres y metadatos ───────────── */

  /** "01_mi-cancion.final.mp3" → "01 mi cancion.final" (solo se quita la extensión final). */
  function cleanName(filename) {
    const name = tidy(normalizeText(lastSegment(toStr(filename))));
    return name
      .replace(EXT_RE, "")
      .slice(0, MAX_NAME)
      .replace(/_+/g, " ")
      .replace(/(\S)-+(?=\S)/g, "$1 ")                // "mi-cancion" → "mi cancion"; "Artista - Tema" se conserva
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Separa formatos habituales «Artista - Título», con prefijo opcional de pista. */
  function filenameArtistTitle(filename) {
    let clean = cleanName(filename);
    clean = clean.replace(/^\d{1,3}\s*[.)_-]?\s+/, "");
    const match = clean.match(/^(.{2,100}?)\s+-\s+(.{1,200})$/);
    if (!match || /^\d+$/.test(match[1].trim())) return { title: clean };
    return { artist: match[1].trim(), title: match[2].trim() };
  }

  function pickTitle(tags, filename) {
    return tagText(tags, "title") || filenameArtistTitle(filename)?.title || cleanName(filename) || "Sin título";
  }

  /** Si no hay tag y se pasa el nombre de archivo, intenta "Artista - Título". */
  function pickArtist(tags, filename) {
    const a = tagText(tags, "artist");
    if (a) return a;
    return filenameArtistTitle(filename)?.artist || "Artista desconocido";
  }

  function pickAlbum(tags) {
    return tagText(tags, "album");
  }

  /** Nombre sin extensión, en minúsculas y normalizado: empareja "tema.mp3" con "Tema.LRC". */
  function baseName(name) {
    const n = tidy(normalizeText(lastSegment(toStr(name))));
    return n.replace(EXT_RE, "").trim().toLowerCase();
  }

  /** Nombre de archivo seguro entre sistemas (sin caracteres reservados, sin puntos finales). */
  function sanitizeFileName(name) {
    let s = normalizeText(toStr(name))
      .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]+/g, "_")
      .replace(INVISIBLE_RE, "")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "");

    const cps = Array.from(s);
    if (cps.length > MAX_FILE_NAME) {
      const m = s.match(/\.[A-Za-z0-9]{1,10}$/);
      const ext = m ? m[0] : "";
      const base = ext ? s.slice(0, s.length - ext.length) : s;
      s = Array.from(base).slice(0, MAX_FILE_NAME - ext.length).join("") + ext;
      s = s.replace(/^[.\s]+|[.\s]+$/g, "");
    }
    if (s && WIN_RESERVED.test(s)) s = "_" + s;       // CON, NUL, COM1… no son válidos en Windows
    return s;
  }

  function safeFileName(name, fallback = "archivo") {
    return sanitizeFileName(name) || sanitizeFileName(fallback) || "archivo";
  }

  /* ───────────── numéricos ───────────── */

  /** Limita v a [min, max]. NaN/no numérico → min. Tolera min > max y límites inválidos. */
  function clamp(v, min, max) {
    v = toNum(v); min = toNum(min); max = toNum(max);
    if (Number.isNaN(min)) min = -Infinity;
    if (Number.isNaN(max)) max = Infinity;
    if (min > max) { const t = min; min = max; max = t; }
    if (Number.isNaN(v)) return Number.isFinite(min) ? min : Number.isFinite(max) ? max : 0;
    return Math.max(min, Math.min(max, v));
  }

  /* ───────────── control de frecuencia ───────────── */

  /** Retrasa fn hasta que pasen `wait` ms sin llamadas. Incluye .cancel(), .flush() y .pending(). */
  function debounce(fn, wait = 200) {
    if (!isFn(fn)) { log("warn", "[AuraUtils] debounce: se esperaba una función"); fn = noop; }
    const ms = delay(wait);
    let timer = null, lastArgs = null, lastThis = null;

    const run = () => {
      timer = null;
      const a = lastArgs, t = lastThis;
      lastArgs = lastThis = null;
      try { return fn.apply(t, a || []); }
      catch (e) { log("error", "[AuraUtils] debounce: el callback falló:", e); }
    };
    function debounced(...args) {
      lastArgs = args; lastThis = this;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, ms);
    }
    debounced.cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; lastArgs = lastThis = null; };
    debounced.flush = () => { if (timer !== null) { clearTimeout(timer); return run(); } };
    debounced.pending = () => timer !== null;
    return debounced;
  }

  /** Ejecuta fn como máximo una vez cada `wait` ms (primer y último evento incluidos). */
  function throttle(fn, wait = 100) {
    if (!isFn(fn)) { log("warn", "[AuraUtils] throttle: se esperaba una función"); fn = noop; }
    const ms = delay(wait);
    let last = null, timer = null, lastArgs = null, lastThis = null;

    const invoke = () => {
      last = now();
      timer = null;
      const a = lastArgs, t = lastThis;
      lastArgs = lastThis = null;
      try { fn.apply(t, a || []); }
      catch (e) { log("error", "[AuraUtils] throttle: el callback falló:", e); }
    };
    function throttled(...args) {
      lastArgs = args; lastThis = this;
      const elapsed = last === null ? Infinity : now() - last;
      const remaining = elapsed < 0 ? 0 : ms - elapsed;       // reloj hacia atrás → no bloquear
      if (remaining <= 0) {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        invoke();
      } else if (timer === null) {
        timer = setTimeout(invoke, remaining);
      }
    }
    throttled.cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; lastArgs = lastThis = null; };
    throttled.flush = () => { if (timer !== null) { clearTimeout(timer); invoke(); } };
    return throttled;
  }

  /** Agrupa llamadas en un único requestAnimationFrame (usa los últimos argumentos). */
  function rafThrottle(fn) {
    if (!isFn(fn)) { log("warn", "[AuraUtils] rafThrottle: se esperaba una función"); fn = noop; }
    let handle = null, viaRaf = false, lastArgs = null, lastThis = null;

    const run = () => {
      handle = null;
      const a = lastArgs, t = lastThis;
      lastArgs = lastThis = null;
      try { fn.apply(t, a || []); }
      catch (e) { log("error", "[AuraUtils] rafThrottle: el callback falló:", e); }
    };
    const clear = () => {
      if (handle === null) return;
      try { viaRaf ? root.cancelAnimationFrame(handle) : clearTimeout(handle); } catch (_) { /* nada */ }
      handle = null;
    };
    function wrapped(...args) {
      lastArgs = args; lastThis = this;
      if (handle !== null) return;
      if (isFn(root.requestAnimationFrame) && isFn(root.cancelAnimationFrame)) {
        viaRaf = true;
        handle = root.requestAnimationFrame(run);
      } else {
        viaRaf = false;                                        // sin rAF (tests, SSR, workers)
        handle = setTimeout(run, 16);
      }
    }
    wrapped.cancel = () => { clear(); lastArgs = lastThis = null; };
    wrapped.flush = () => { if (handle !== null) { clear(); run(); } };
    return wrapped;
  }

  /** Promesa que resuelve tras `ms`. Con AbortSignal opcional, rechaza al abortar. */
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError(signal)); return; }
      let timer = null;
      const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
      timer = setTimeout(() => {
        try { if (signal && isFn(signal.removeEventListener)) signal.removeEventListener("abort", onAbort); } catch (_) { /* nada */ }
        resolve();
      }, delay(ms));
      try { if (signal && isFn(signal.addEventListener)) signal.addEventListener("abort", onAbort, { once: true }); } catch (_) { /* nada */ }
    });
  }

  /** Ejecuta fn una sola vez. Si lanza, no se marca como hecha y se puede reintentar. */
  function once(fn) {
    if (!isFn(fn)) return noop;
    let done = false, running = false, value;
    return function (...args) {
      if (done || running) return value;
      running = true;
      try {
        value = fn.apply(this, args);
        done = true;
      } finally {
        running = false;
      }
      return value;
    };
  }

  /* ───────────── archivos ───────────── */

  function isAudioFile(file) {
    if (!file) return false;
    const type = toStr(safeGet(file, "type"));
    if (type.startsWith("audio/") || AUDIO_MIME_EXTRA.test(type)) return true;
    return AUDIO_EXT.test(toStr(safeGet(file, "name")));
  }

  function isLrcFile(file) {
    return !!file && LRC_EXT.test(toStr(safeGet(file, "name")));
  }

  /** Descarga un Blob. Devuelve true si se disparó la descarga. */
  function download(blob, filename) {
    let url = null;
    try {
      if (typeof document === "undefined" || typeof URL === "undefined" || !isFn(URL.createObjectURL)) return false;
      if (typeof blob === "string" || blob instanceof ArrayBuffer || ArrayBuffer.isView(blob)) blob = new Blob([blob]);
      if (!isBlob(blob)) return false;

      const name = safeFileName(filename, "descarga");

      const nav = root.navigator;
      if (nav && isFn(nav.msSaveOrOpenBlob)) {                 // Edge/IE legado
        nav.msSaveOrOpenBlob(blob, name);
        return true;
      }

      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      a.style.display = "none";
      const host = document.body || document.documentElement;
      host.appendChild(a);
      try { a.click(); } finally { a.remove(); }

      const toRevoke = url;
      url = null;
      setTimeout(() => { try { URL.revokeObjectURL(toRevoke); } catch (_) { /* nada */ } }, REVOKE_DELAY);
      return true;
    } catch (e) {
      log("error", "[AuraUtils] download falló:", e);
      if (url) { try { URL.revokeObjectURL(url); } catch (_) { /* nada */ } }
      return false;
    }
  }

  /* ───────────── ids ───────────── */

  let uidCounter = 0;

  /** Id único con prefijo "id-". Usa crypto cuando existe; el contador garantiza unicidad en la sesión. */
  function uid() {
    let rand = "";
    try {
      const c = root.crypto;
      if (c && isFn(c.randomUUID)) {
        rand = String(c.randomUUID()).replace(/-/g, "").slice(0, 12);
      } else if (c && isFn(c.getRandomValues)) {
        const b = new Uint8Array(6);
        c.getRandomValues(b);
        rand = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      }
    } catch (_) { /* cae al fallback */ }
    if (!/^[0-9a-f]{12}$/i.test(rand)) {
      const part = () => Math.random().toString(16).slice(2).padEnd(6, "0").slice(0, 6);
      rand = part() + part();
    }
    uidCounter = uidCounter >= Number.MAX_SAFE_INTEGER ? 1 : uidCounter + 1;
    return "id-" + rand + uidCounter.toString(36);
  }

  /* ───────────── export ───────────── */

  const Utils = {
    formatTime, formatBytes, escapeHTML,
    cleanName, pickTitle, pickArtist, pickAlbum, baseName, safeFileName,
    clamp,
    debounce, throttle, rafThrottle, sleep, once,
    isAudioFile, isLrcFile, download,
    uid,
  };

  root.AuraUtils = Utils;
  if (typeof module === "object" && module && module.exports) module.exports = Utils;
})(
  typeof globalThis !== "undefined" ? globalThis :
  typeof window !== "undefined" ? window :
  typeof self !== "undefined" ? self : this
);
