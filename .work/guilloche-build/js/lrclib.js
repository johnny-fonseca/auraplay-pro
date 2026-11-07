/*!
 * lrclib.js — Cliente completo para la API de LRCLIB (https://lrclib.net/docs)
 * Versión 1.2.0 · ESM · Sin dependencias · Node >= 18 y navegadores modernos
 *
 * Cambios v1.2.0 (corrige errores de v1.1.0 y refuerza el blindaje):
 *  - normalizeTrack: durationMs ya no se vuelve a dividir (duraciones > 1 h correctas).
 *  - Circuit breaker: solo cuentan los fallos reintentables (red, timeout, 429, 5xx).
 *    404 y otros errores de cliente demuestran que el servidor responde.
 *  - PoW: target validado (hex, 1–32 bytes) y comparación segura; verify igual.
 *  - load() no lanza salvo con throwOnError: errores de parseo => status 'error'.
 *  - inflightTimeout respeta el contrato (status 'error', salvo throwOnError/abort).
 *  - ensure() nunca lanza por filas inválidas (salvo throwOnError/abort).
 *  - Lectura de respuesta en streaming con tope real de bytes (no solo content-length).
 *  - Cuerpo cancelado en respuestas descartadas.
 *  - parseLrc: tope de timestamps por línea, de entradas totales y de bytes UTF-8.
 *  - parseLrc: los words de líneas repetidas ya no comparten objetos (offset no se acumula).
 *  - Sanitización de saltos de línea en metadatos y letras al serializar LRC.
 *  - Clave de caché de findLyrics incluye las opciones de búsqueda.
 *  - No se cachea un miss si el presupuesto de peticiones se agotó.
 *  - publish/flag sin reintentos automáticos en 5xx (evita publicaciones duplicadas).
 *  - Scheduler: tareas encoladas se rechazan al abortar, sin esperar su turno.
 *  - Validación de opciones (timeout, retries, concurrency...) con valores seguros.
 *  - Caché persistida recupera su flag de persistencia al cargar.
 *  - LrcSync y formatTimestamp descartan valores no finitos.
 *  - candidatePaths: sin doble barra en rutas raíz.
 */

export const VERSION = '1.2.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof window.document !== 'undefined';

/** Reloj monotónico: inmune a cambios de hora del sistema. */
const now =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** Límites defensivos globales. */
export const LIMITS = Object.freeze({
  RESPONSE_BYTES: 10 * 1024 * 1024,
  RESPONSE_BYTES_MAX: 64 * 1024 * 1024,
  LRC_BYTES: 4 * 1024 * 1024,
  LRC_LINES: 20_000,
  LRC_ENTRIES: 50_000,
  LRC_STAMPS_PER_LINE: 64,
  LRC_WORDS_PER_LINE: 500,
  META_VALUE_MAX: 1_000,
  MIN_DURATION_SEC: 1,
  MAX_DURATION_SEC: 36_000,
  MAX_ITERATIONS_POW: 20_000_000,
  CHALLENGE_PREFIX_MAX: 512,
});

/** Bloqueo de prototype pollution. */
const PROTO_BLOCK = new Set(['__proto__', 'constructor', 'prototype']);

/* ─────────────────────── Utilidades base ─────────────────────── */

/** Copia defensiva ignorando claves peligrosas. */
export function safeAssign(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(source)) if (!PROTO_BLOCK.has(k)) target[k] = source[k];
  return target;
}

/** Sanea un header (anti header injection). */
function sanitizeHeaderValue(v) {
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

/** Sanea un valor de texto para una sola línea LRC (anti inyección de líneas). */
const oneLine = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

/** Bytes UTF-8 de una cadena (fallback a longitud si no hay TextEncoder). */
const utf8Len = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).byteLength : s.length);

/** Número seguro con rango y valor por defecto. */
const num = (v, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Combina señales, prefiriendo AbortSignal.any cuando existe. */
export function linkSignals(...signals) {
  const list = signals.filter(Boolean);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(list);
  }
  const ctl = new AbortController();
  const cleanups = [];
  const fire = (reason) => {
    if (!ctl.signal.aborted) ctl.abort(reason);
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  };
  for (const s of list) {
    if (s.aborted) { fire(s.reason); return ctl.signal; }
    const onAbort = () => fire(s.reason);
    s.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => s.removeEventListener('abort', onAbort));
  }
  return ctl.signal;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AbortedError('Operation aborted', { cause: signal.reason });
}

function assertSafeInteger(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(v) || v < min || v > max) {
    throw new ValidationError(`${name} debe ser un entero entre ${min} y ${max}`, {
      details: { name, value: v },
    });
  }
  return v;
}

/* ───────────────────────────── Tipos (JSDoc) ───────────────────────────── */

/**
 * @typedef {Object} TrackInfo
 * @property {string} [title]
 * @property {string} [artist]
 * @property {string} [album]
 * @property {number} [duration]     Segundos (o ms si es > 36000 y /1000 cabe en el rango)
 * @property {number} [durationMs]   Milisegundos
 * @property {string} [filePath]
 * @property {string} [lrcPath]
 */

/**
 * @typedef {Object} LyricsRecord
 * @property {number} id
 * @property {string} name
 * @property {string} trackName
 * @property {string} artistName
 * @property {string} albumName
 * @property {number} duration
 * @property {boolean} instrumental
 * @property {boolean} [hasWordSync]
 * @property {string|null} plainLyrics
 * @property {string|null} syncedLyrics
 * @property {string} [lyricsfile]
 */

/* ───────────────────────────── Errores ───────────────────────────── */

export class LrclibError extends Error {
  constructor(message, { status, code, details, retryable = false, retryAfterMs, httpStatus, requestId, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LrclibError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.httpStatus = httpStatus ?? status;
    this.requestId = requestId;
    if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, this.constructor);
  }
}
export class NotFoundError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'TrackNotFound', status: 404 }); this.name = 'NotFoundError'; } }
export class ValidationError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'ValidationError', status: o?.status ?? 400 }); this.name = 'ValidationError'; } }
export class RateLimitError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'RateLimitExceeded', status: 429, retryable: true }); this.name = 'RateLimitError'; } }
export class AuthError extends LrclibError { constructor(m, o) { super(m, { ...o, status: o?.status ?? 401 }); this.name = 'AuthError'; } }
export class PublishTokenError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'IncorrectPublishTokenError', status: 400 }); this.name = 'PublishTokenError'; } }
/** Respeta el `retryable` explícito pasado en `o` (501/505 no se reintentan). */
export class ServerError extends LrclibError { constructor(m, o = {}) { super(m, { retryable: true, ...o }); this.name = 'ServerError'; } }
export class NetworkError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'NETWORK', retryable: true }); this.name = 'NetworkError'; } }
export class TimeoutError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'TIMEOUT', retryable: true }); this.name = 'TimeoutError'; } }
export class AbortedError extends LrclibError { constructor(m = 'Operation aborted', o) { super(m, { ...o, code: 'ABORTED' }); this.name = 'AbortedError'; } }
export class ResponseTooLargeError extends LrclibError { constructor(m, o) { super(m, { ...o, code: 'RESPONSE_TOO_LARGE' }); this.name = 'ResponseTooLargeError'; } }

/* ───────────────────── Type guards (posteriores a Error) ───────────────────── */

export const isLrclibError = (e) => e instanceof LrclibError;
export const isLyricsRecord = (x) =>
  !!x && typeof x === 'object' && Number.isSafeInteger(x.id) && typeof x.trackName === 'string';

/* ───────────────────────────── Helpers genéricos ───────────────────────────── */

const sleepRaw = (ms) => new Promise((r) => setTimeout(r, ms));

function sleep(ms, signal) {
  if (!signal) return sleepRaw(ms);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const onAbort = () => { clearTimeout(t); reject(new AbortedError()); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const withJitter = (ms, ratio = 0.3) => Math.round(ms + Math.random() * ms * ratio);
const uniq = (arr) => [...new Set(arr.filter((x) => x !== undefined && x !== null && x !== ''))];
const str = (v) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);

/** Copia datos JSON/POJO para que la caché nunca comparta referencias mutables. */
function cloneData(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fallback below */ }
  }
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function parseRetryAfter(header) {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const d = Date.parse(header);
  return Number.isNaN(d) ? null : Math.max(0, d - Date.now());
}

let _node;
/** Recuperación parcial: si solo uno falla, el otro sigue disponible. */
async function nodeModules() {
  if (_node) return _node;
  const [fsRes, cryptoRes] = await Promise.allSettled([
    import(/* @vite-ignore */ /* webpackIgnore: true */ ['node', 'fs/promises'].join(':')),
    import(/* @vite-ignore */ /* webpackIgnore: true */ ['node', 'crypto'].join(':')),
  ]);
  _node = {
    fs: fsRes.status === 'fulfilled' ? fsRes.value : undefined,
    crypto: cryptoRes.status === 'fulfilled' ? cryptoRes.value : undefined,
  };
  return _node;
}

class Emitter {
  #h = new Map();
  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this.#h.has(event)) this.#h.set(event, new Set());
    this.#h.get(event).add(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) { this.#h.get(event)?.delete(fn); }
  /** Snapshot: listeners pueden desuscribirse durante el emit sin romper. */
  emit(event, payload) {
    for (const key of [event, '*']) {
      const set = this.#h.get(key);
      if (!set) continue;
      const snapshot = [...set];
      for (const fn of snapshot) {
        try {
          const arg = key === '*'
            ? { event, ...(payload && typeof payload === 'object' ? payload : { payload }) }
            : payload;
          fn(arg);
        } catch { /* un listener roto no debe tumbar el cliente */ }
      }
    }
  }
}

/* ───────────────────────────── Normalización y matching ───────────────────────────── */

export function normalizeTrack(t = {}) {
  const src = t && typeof t === 'object' ? t : {};
  const title = str(src.trackName ?? src.track_name ?? src.title ?? src.name);
  const artist = str(
    src.artistName ?? src.artist_name ?? src.artist ?? (Array.isArray(src.artists) ? src.artists.join(', ') : undefined),
  );
  const album = str(src.albumName ?? src.album_name ?? src.album);
  let d;
  if (src.durationMs != null) {
    // Ya viene en ms: solo se convierte, nunca se vuelve a dividir.
    d = num(src.durationMs, NaN) / 1000;
  } else {
    d = num(src.duration ?? src.durationSec, NaN);
    // Solo se asume ms si el valor supera cualquier duración en segundos válida.
    if (Number.isFinite(d) && d > LIMITS.MAX_DURATION_SEC && d / 1000 <= LIMITS.MAX_DURATION_SEC) d /= 1000;
  }
  const duration =
    Number.isFinite(d) && d >= LIMITS.MIN_DURATION_SEC && d <= LIMITS.MAX_DURATION_SEC
      ? Math.round(d)
      : undefined;
  return { title, artist, album, duration };
}

export const normKey = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^the /, '').trim();

const TITLE_NOISE = [
  /\s*[(\[]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\b[^)\]]*[)\]]/gi,
  /\s*[(\[][^)\]]*\b(?:remaster(?:ed)?|deluxe|bonus track|radio edit|single version|album version|mono|stereo|explicit|clean)\b[^)\]]*[)\]]/gi,
  /\s+[-–—]\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|deluxe|bonus track|radio edit|single version|album version|mono|stereo)\b.*$/i,
  /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i,
];

export function cleanTitle(title = '') {
  let out = String(title ?? '');
  for (const re of TITLE_NOISE) out = out.replace(re, '');
  return out.replace(/\s{2,}/g, ' ').trim() || String(title ?? '').trim();
}

export function primaryArtist(artist = '') {
  const raw = String(artist ?? '');
  const first = raw.split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+|\s*;\s*|\s*,\s+/i)[0].trim();
  return first || raw.trim();
}

function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2); const n = grams.get(g);
    if (n > 0) { grams.set(g, n - 1); hits++; }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

export function similarity(a, b) {
  const x = normKey(a), y = normKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const contain = x.includes(y) || y.includes(x)
    ? Math.min(x.length, y.length) / Math.max(x.length, y.length)
    : 0;
  return Math.max(dice(x, y), contain > 0 ? 0.6 + 0.4 * contain : 0);
}

export function scoreCandidate(c, q, { maxDurationDiff = 4, preferSynced = true } = {}) {
  const title = Math.max(similarity(c.trackName, q.title), similarity(c.trackName, cleanTitle(q.title)));
  const artist = Math.max(similarity(c.artistName, q.artist), similarity(c.artistName, primaryArtist(q.artist)));
  const album = q.album ? similarity(c.albumName, q.album) : null;
  const dd = q.duration && c.duration ? Math.abs(c.duration - q.duration) : null;
  const dur = dd === null ? null : dd <= 2 ? 1 : Math.max(0, 1 - (dd - 2) / Math.max(1, maxDurationDiff - 2));
  const parts = [[title, 0.45], [artist, 0.30]];
  if (dur !== null) parts.push([dur, 0.15]);
  if (album !== null) parts.push([album, 0.10]);
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  let score = parts.reduce((s, [v, w]) => s + v * w, 0) / wsum;
  if (preferSynced && c.syncedLyrics) score += 0.03;
  const ok = title >= 0.6 && artist >= 0.5 && (dd === null || dd <= maxDurationDiff);
  return { score, ok, title, artist, album, durationDiff: dd };
}

/* ───────────────────────────── Scheduler (reloj monotónico) ───────────────────────────── */

class Scheduler {
  #queue = [];
  #active = 0;
  #nextAt = 0;
  constructor(minInterval = 250, concurrency = 1) {
    this.minInterval = Math.max(0, num(minInterval, 250, { min: 0 }));
    this.concurrency = Math.max(1, Math.floor(num(concurrency, 1, { min: 1 })));
  }
  pause(ms) { this.#nextAt = Math.max(this.#nextAt, now() + Math.max(0, num(ms, 0))); }
  run(task, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortedError());
      const item = { task, resolve, reject, signal, onAbort: null };
      if (signal) {
        // Si se aborta mientras espera turno, se rechaza de inmediato.
        item.onAbort = () => {
          const i = this.#queue.indexOf(item);
          if (i !== -1) { this.#queue.splice(i, 1); reject(new AbortedError()); }
        };
        signal.addEventListener('abort', item.onAbort, { once: true });
      }
      this.#queue.push(item);
      this.#pump();
    });
  }
  #pump() {
    while (this.#active < this.concurrency && this.#queue.length) {
      const item = this.#queue.shift();
      if (item.signal && item.onAbort) item.signal.removeEventListener('abort', item.onAbort);
      if (item.signal?.aborted) { item.reject(new AbortedError()); continue; }
      this.#active++;
      const startAt = Math.max(now(), this.#nextAt);
      this.#nextAt = startAt + this.minInterval;
      const delay = Math.max(0, startAt - now());
      setTimeout(async () => {
        // El siguiente intervalo se cuenta desde el inicio efectivo, no desde
        // el turno reservado (que puede precederlo si otra tarea sigue activa).
        this.#nextAt = Math.max(this.#nextAt, now() + this.minInterval);
        try {
          throwIfAborted(item.signal);
          item.resolve(await item.task());
        } catch (e) {
          item.reject(e);
        } finally {
          this.#active--;
          this.#pump();
        }
      }, delay);
    }
  }
}

/* ───────────────────────────── Caché LRU con TTL ───────────────────────────── */

export class TTLCache {
  #map = new Map();
  #initPromise = null;
  #timer = null;
  constructor(options = {}) {
    const { max = 500, ttl = 24 * 3600e3, store = null, freeze = false } =
      options && typeof options === 'object' ? options : {};
    this.max = Math.max(0, Math.floor(num(max, 500, { min: 0 })));
    this.ttl = Math.max(0, num(ttl, 24 * 3600e3, { min: 0 }));
    this.store = store && typeof store.load === 'function' && typeof store.save === 'function' ? store : null;
    this.freeze = !!freeze;
  }

  /** Memoizado: sin races cuando varias llamadas concurrentes inicializan. */
  init() {
    if (!this.store) return Promise.resolve();
    if (!this.#initPromise) {
      this.#initPromise = (async () => {
        try {
          const data = await this.store.load();
          if (data && typeof data === 'object') {
            for (const [k, e] of Object.entries(data)) {
              if (
                !PROTO_BLOCK.has(k) &&
                e && typeof e === 'object' &&
                typeof e.exp === 'number' && e.exp > Date.now() &&
                e.value !== undefined
              ) {
                // Las entradas cargadas del store siguen siendo persistentes.
                this.#map.set(k, { ...e, persist: true });
              }
            }
          }
        } catch { /* store ilegible: se ignora */ }
      })();
    }
    return this.#initPromise;
  }

  get(key) {
    const e = this.#map.get(key);
    if (!e) return undefined;
    if (e.exp <= Date.now()) { this.#map.delete(key); return undefined; }
    this.#map.delete(key); this.#map.set(key, e);
    return e.value;
  }

  set(key, value, { ttl = this.ttl, persist = false } = {}) {
    if (this.max === 0) return;
    let stored = value;
    if (this.freeze && value && typeof value === 'object' && !Object.isFrozen(value)) {
      try {
        const cloned = typeof structuredClone === 'function' ? structuredClone(value) : value;
        stored = Object.freeze(cloned);
      } catch { /* freeze imposible: se deja el original */ }
    }
    this.#map.set(key, { value: stored, exp: Date.now() + num(ttl, this.ttl, { min: 0 }), persist: !!persist });
    while (this.#map.size > this.max) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
    if (persist && this.store && !this.#timer) {
      this.#timer = setTimeout(() => { this.#timer = null; this.flush().catch(() => {}); }, 1000);
      this.#timer.unref?.();
    }
  }

  delete(key) { this.#map.delete(key); }
  clear() { this.#map.clear(); }
  get size() { return this.#map.size; }

  async flush() {
    if (!this.store) return;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    const out = Object.create(null);
    for (const [k, e] of this.#map) if (e.persist && e.exp > Date.now()) out[k] = e;
    await this.store.save(out);
  }
}

/* ───────────────────────────── Adaptadores de almacenamiento ───────────────────────────── */

const SEP = /[\\/]/;
const lastSep = (p) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
const dirname = (p) => { const i = lastSep(p); return i <= 0 ? (i === 0 ? p.slice(0, 1) : '.') : p.slice(0, i); };
const basename = (p) => p.slice(lastSep(p) + 1);
const stripExt = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const joinPath = (dir, name) => (/[\\/]$/.test(dir) ? dir + name : dir + (dir.includes('\\') && !dir.includes('/') ? '\\' : '/') + name);
export const sanitizeFilename = (s) =>
  String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 150) || 'lyrics';

export const nodeFs = {
  async exists(p) {
    const { fs } = await nodeModules();
    if (!fs) throw new LrclibError('fs no disponible: pasa un adaptador `fs` propio en este entorno', { code: 'NO_FS' });
    try { await fs.stat(p); return true; } catch { return false; }
  },
  async readText(p) {
    const { fs } = await nodeModules();
    if (!fs) throw new LrclibError('fs no disponible: pasa un adaptador `fs` propio en este entorno', { code: 'NO_FS' });
    return fs.readFile(p, 'utf8');
  },
  async writeText(p, text) {
    const { fs } = await nodeModules();
    if (!fs) throw new LrclibError('fs no disponible: pasa un adaptador `fs` propio en este entorno', { code: 'NO_FS' });
    await fs.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await fs.writeFile(tmp, text, 'utf8');
      await fs.rename(tmp, p);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  },
};

export function createLocalStorageFs(prefix = 'lrclib:file:') {
  return {
    async exists(p) { return localStorage.getItem(prefix + p) !== null; },
    async readText(p) { return localStorage.getItem(prefix + p) ?? ''; },
    async writeText(p, text) { localStorage.setItem(prefix + p, text); },
  };
}

export function createJsonFileStore(path, fsAdapter = nodeFs) {
  return {
    async load() { try { return JSON.parse(await fsAdapter.readText(path)); } catch { return {}; } },
    async save(obj) { await fsAdapter.writeText(path, JSON.stringify(obj)); },
  };
}

export function createLocalStorageStore(key = 'lrclib:cache') {
  return {
    async load() { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } },
    async save(obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* cuota llena */ } },
  };
}

/* ───────────────────────────── SHA-256 + Proof-of-Work ───────────────────────────── */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(bytes); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => odv.setUint32(i * 4, v >>> 0));
  return out;
}

/** Target: hex par, 1–32 bytes (1–64 caracteres). Cualquier otra forma se rechaza. */
function hexToBytes(hex) {
  const clean = typeof hex === 'string' ? hex.trim() : '';
  if (!clean || clean.length > 64 || clean.length % 2 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new LrclibError('Target de desafío inválido', { code: 'BAD_TARGET' });
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Hash <= target (lexicográfico, big-endian). Hash debe tener al menos tantos bytes como target. */
function hashMeetsTarget(hash, target) {
  if (target.length === 0 || hash.length < target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (hash[i] > target[i]) return false;
    if (hash[i] < target[i]) return true;
  }
  return true;
}

function assertChallenge(c) {
  if (
    !c || typeof c !== 'object' ||
    typeof c.prefix !== 'string' || !c.prefix || c.prefix.length > LIMITS.CHALLENGE_PREFIX_MAX ||
    typeof c.target !== 'string'
  ) {
    throw new LrclibError('Respuesta de desafío inválida', { code: 'BAD_CHALLENGE', details: c });
  }
  hexToBytes(c.target); // valida el target o lanza BAD_TARGET
}

/** Hash helper compartido por solve/verify. */
async function hashFactory() {
  const { crypto } = await nodeModules();
  const enc = new TextEncoder();
  return crypto?.createHash
    ? (s) => crypto.createHash('sha256').update(s).digest()
    : (s) => sha256(enc.encode(s));
}

export async function solveChallenge(challenge, { signal, onProgress, maxIterations = Infinity, yieldEvery = 20_000 } = {}) {
  assertChallenge(challenge);
  const { prefix, target } = challenge;
  const targetBytes = hexToBytes(target);
  const hashOf = await hashFactory();
  const limit = maxIterations > 0 ? maxIterations : 0;
  const every = Math.max(1, Math.floor(num(yieldEvery, 20_000, { min: 1 })));
  for (let nonce = 0; nonce < limit; nonce++) {
    if (hashMeetsTarget(hashOf(prefix + nonce), targetBytes)) {
      return { nonce: String(nonce), token: `${prefix}:${nonce}`, iterations: nonce + 1 };
    }
    if (nonce % every === every - 1) {
      throwIfAborted(signal);
      try { onProgress?.({ iterations: nonce + 1 }); } catch { /* el callback no rompe el solver */ }
      await sleepRaw(0);
    }
  }
  throw new LrclibError('No solution found within maxIterations', { code: 'CHALLENGE_UNSOLVED' });
}

/** Verificador post-solve (defensivo, barato). */
export async function verifyChallenge(challenge, nonce) {
  assertChallenge(challenge);
  const n = String(nonce);
  if (!/^\d+$/.test(n)) return false;
  const targetBytes = hexToBytes(challenge.target);
  const hashOf = await hashFactory();
  return hashMeetsTarget(hashOf(challenge.prefix + n), targetBytes);
}

/* ───────────────────────────── Utilidades LRC ───────────────────────────── */

const TS_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TS_TEST_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;
const WORD_RE = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const WORD_TEST_RE = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/;
const META_RE = /^\[([a-zA-Z#][a-zA-Z0-9#_-]*):(.*)\]\s*$/;

const toMs = (m, s, f) => {
  let frac = 0;
  if (f !== undefined) frac = f.length === 1 ? Number(f) * 100 : f.length === 2 ? Number(f) * 10 : Number(f);
  return Number(m) * 60000 + Number(s) * 1000 + frac;
};

export function parseLrc(text, { applyOffset = true } = {}) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  // Primero el tope de caracteres (barato); luego el de bytes UTF-8 reales.
  if (src.length > LIMITS.LRC_BYTES || utf8Len(src) > LIMITS.LRC_BYTES) {
    throw new ValidationError('LRC demasiado grande', { details: { limitBytes: LIMITS.LRC_BYTES } });
  }
  const rawLines = src.split(/\r?\n/);
  if (rawLines.length > LIMITS.LRC_LINES) {
    throw new ValidationError('LRC con demasiadas líneas', { details: { lines: rawLines.length, limit: LIMITS.LRC_LINES } });
  }

  const meta = Object.create(null);
  const lines = [];

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    TS_RE.lastIndex = 0;
    const stamps = [];
    let pos = 0, m;
    while (stamps.length < LIMITS.LRC_STAMPS_PER_LINE && (m = TS_RE.exec(line)) && m.index === pos) {
      stamps.push(toMs(m[1], m[2], m[3]));
      pos = TS_RE.lastIndex;
    }
    if (!stamps.length) {
      const mm = META_RE.exec(line);
      if (mm) {
        const key = mm[1].toLowerCase();
        if (!PROTO_BLOCK.has(key)) meta[key] = mm[2].trim().slice(0, LIMITS.META_VALUE_MAX);
      }
      continue;
    }

    let body = line.slice(pos);
    let words;
    if (WORD_TEST_RE.test(body)) {
      const all = [...body.matchAll(WORD_RE)];
      const marks = all.slice(0, LIMITS.LRC_WORDS_PER_LINE);
      words = marks.map((mk, i) => {
        const start = mk.index + mk[0].length;
        const next = all[i + 1];
        const end = next ? next.index : body.length;
        return { time: toMs(mk[1], mk[2], mk[3]), text: body.slice(start, end) };
      });
      body = body.replace(WORD_RE, '');
    }

    if (lines.length + stamps.length > LIMITS.LRC_ENTRIES) {
      throw new ValidationError('LRC con demasiadas entradas', { details: { limit: LIMITS.LRC_ENTRIES } });
    }
    const content = body.trim();
    for (const t of stamps) {
      // Cada entrada recibe su PROPIA copia de words: el offset no debe acumularse.
      lines.push({ time: t, text: content, ...(words ? { words: words.map((w) => ({ ...w })) } : {}) });
    }
  }

  const offset = Number(meta.offset);
  if (applyOffset && Number.isFinite(offset) && offset !== 0) {
    for (const l of lines) {
      l.time = Math.max(0, l.time - offset);
      if (l.words) for (const w of l.words) w.time = Math.max(0, w.time - offset);
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return { meta, lines, synced: lines.length > 0 };
}

export function formatTimestamp(ms) {
  const v = Number.isFinite(Number(ms)) ? Math.max(0, Math.round(Number(ms) / 10)) : 0;
  const mm = Math.floor(v / 6000), ss = Math.floor((v % 6000) / 100), xx = v % 100;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xx).padStart(2, '0')}`;
}

function formatTimestamp3(ms) {
  const v = Number.isFinite(Number(ms)) ? Math.max(0, Math.round(Number(ms))) : 0;
  const mm = Math.floor(v / 60000), rest = v % 60000;
  return `${String(mm).padStart(2, '0')}:${String(Math.floor(rest / 1000)).padStart(2, '0')}.${String(rest % 1000).padStart(3, '0')}`;
}

export function serializeLrc(lines, meta = {}) {
  const head = Object.entries(meta ?? {})
    .filter(([k, v]) => /^[a-zA-Z#][a-zA-Z0-9#_-]*$/.test(k) && v !== undefined && v !== null && oneLine(v) !== '')
    .map(([k, v]) => `[${k}:${oneLine(v)}]`);
  const body = (Array.isArray(lines) ? lines : [])
    .filter((l) => l && Number.isFinite(l.time))
    .sort((a, b) => a.time - b.time)
    .map((l) => {
      if (Array.isArray(l.words) && l.words.length) {
        const body = l.words.map((word) => {
          let text = String(word?.text ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
          if (word?.space && !/\s$/.test(text)) text += ' ';
          return `[${formatTimestamp3(word?.time)}]${text}`;
        }).join('');
        return `[${formatTimestamp3(l.time)}]${body}`;
      }
      const text = oneLine(l.text);
      return `[${formatTimestamp(l.time)}]${text ? ' ' + text : ''}`;
    });
  return [...head, ...body].join('\n') + '\n';
}

export function lrcToPlain(lrc) {
  const src = String(lrc ?? '').slice(0, LIMITS.LRC_BYTES);
  return src.split(/\r?\n/)
    .filter((l) => {
      const s = l.trim();
      return !(META_RE.test(s) && !/^\[\d/.test(s));
    })
    .map((l) => l.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').replace(WORD_RE, '').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Detección rápida sin parseo completo. */
export const isSyncedLrc = (text) => !!text && TS_TEST_RE.test(String(text));

function withMetadataTags(text, record) {
  const has = (k) => new RegExp(`^\\[${k}:`, 'mi').test(text);
  const tags = [];
  if (!has('ti') && record.trackName) tags.push(`[ti:${oneLine(record.trackName)}]`);
  if (!has('ar') && record.artistName) tags.push(`[ar:${oneLine(record.artistName)}]`);
  if (!has('al') && record.albumName) tags.push(`[al:${oneLine(record.albumName)}]`);
  if (!has('length') && Number.isFinite(Number(record.duration)) && Number(record.duration) > 0) {
    tags.push(`[length:${formatTimestamp(Number(record.duration) * 1000).slice(0, 5)}]`);
  }
  if (!has('by')) tags.push('[by:LRCLIB]');
  return tags.length ? `${tags.join('\n')}\n${text}` : text;
}

export class LrcSync {
  #last = -2;
  constructor(lines = [], { offsetMs = 0 } = {}) {
    this.lines = (Array.isArray(lines) ? lines : [])
      .filter((l) => l && Number.isFinite(l.time))
      .sort((a, b) => a.time - b.time);
    this.offsetMs = num(offsetMs, 0);
  }
  indexAt(timeMs) {
    if (!Number.isFinite(timeMs)) return -1;
    const t = timeMs + this.offsetMs;
    let lo = 0, hi = this.lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  at(timeMs) {
    const index = this.indexAt(timeMs);
    const line = this.lines[index] ?? null;
    const next = this.lines[index + 1] ?? null;
    let progress = 0;
    if (line && next) {
      const span = next.time - line.time;
      progress = span > 0 ? Math.min(1, Math.max(0, (timeMs + this.offsetMs - line.time) / span)) : 0;
    }
    return { index, line, next, progress };
  }
  update(timeMs) {
    const s = this.at(timeMs);
    const changed = s.index !== this.#last;
    this.#last = s.index;
    return { ...s, changed };
  }
  reset() { this.#last = -2; }
}

/* ───────────────────────────── Circuit breaker (opt-in) ───────────────────────────── */

class CircuitBreaker {
  #state = new Map();
  constructor({ threshold = 10, cooldownMs = 60_000 } = {}) {
    this.threshold = Math.max(1, Math.floor(num(threshold, 10, { min: 1 })));
    this.cooldownMs = Math.max(1000, num(cooldownMs, 60_000, { min: 0 }));
  }
  check(key) {
    const s = this.#state.get(key);
    if (!s) return true;
    if (s.openedAt && now() - s.openedAt < this.cooldownMs) return false;
    if (s.openedAt) this.#state.delete(key);
    return true;
  }
  fail(key) {
    const s = this.#state.get(key) ?? { count: 0, openedAt: 0 };
    s.count++;
    if (s.count >= this.threshold) { s.openedAt = now(); s.count = 0; }
    this.#state.set(key, s);
  }
  succeed(key) { this.#state.delete(key); }
  reset() { this.#state.clear(); }
}

/* ───────────────────────────── Cliente LRCLIB ───────────────────────────── */

const DEFAULTS = Object.freeze({
  baseUrl: 'https://lrclib.net',
  userAgent: `LRCLIB.js/${VERSION} (https://lrclib.net)`,
  appId: undefined,
  apiKey: undefined,
  timeout: 15_000,
  retries: 3,
  retryBaseDelay: 600,
  maxRetryAfter: 60_000,
  minInterval: 300,
  concurrency: 1,
  fetch: undefined,
  cache: Object.freeze({}),
  maxResponseBytes: LIMITS.RESPONSE_BYTES,
  circuitBreaker: false,
});

/** Lee el cuerpo descartado para liberar el socket. Nunca lanza. */
async function cancelBody(res) {
  try { await res?.body?.cancel?.(); } catch { /* ya consumido o no cancelable */ }
}

export class LrclibClient extends Emitter {
  #warnedKey = false;
  #reqId = 0;

  constructor(options = {}) {
    super();
    const o = options && typeof options === 'object' ? options : {};
    this.opts = { ...DEFAULTS, ...o };
    this.opts.timeout = num(o.timeout, DEFAULTS.timeout, { min: 1, max: 600_000 });
    this.opts.retries = Math.floor(num(o.retries, DEFAULTS.retries, { min: 0, max: 10 }));
    this.opts.retryBaseDelay = num(o.retryBaseDelay, DEFAULTS.retryBaseDelay, { min: 0, max: 60_000 });
    this.opts.maxRetryAfter = num(o.maxRetryAfter, DEFAULTS.maxRetryAfter, { min: 0, max: 3_600_000 });
    this.opts.minInterval = num(o.minInterval, DEFAULTS.minInterval, { min: 0, max: 60_000 });
    this.opts.concurrency = Math.floor(num(o.concurrency, DEFAULTS.concurrency, { min: 1, max: 64 }));
    this.opts.maxResponseBytes = Math.floor(num(o.maxResponseBytes, LIMITS.RESPONSE_BYTES, { min: 1024, max: LIMITS.RESPONSE_BYTES_MAX }));
    this.opts.userAgent = String(o.userAgent ?? DEFAULTS.userAgent);

    this.baseUrl = String(this.opts.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, '');
    let parsed;
    try { parsed = new URL(this.baseUrl); } catch {
      throw new ValidationError('baseUrl inválida', { details: { baseUrl: this.baseUrl } });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('baseUrl debe ser http(s)', { details: { protocol: parsed.protocol } });
    }
    if (parsed.username || parsed.password) {
      throw new ValidationError('baseUrl no puede incluir credenciales');
    }

    this.scheduler = new Scheduler(this.opts.minInterval, this.opts.concurrency);
    const c = o.cache === undefined || o.cache === null ? {} : o.cache;
    this.cache = c === false ? new TTLCache({ max: 0 }) : new TTLCache(c);
    this.missTtl = num(c && typeof c === 'object' ? c.missTtl : undefined, 6 * 3600e3, { min: 0 });
    this.maxResponseBytes = this.opts.maxResponseBytes;
    this.circuit = this.opts.circuitBreaker
      ? new CircuitBreaker(typeof this.opts.circuitBreaker === 'object' ? this.opts.circuitBreaker : {})
      : null;
  }

  /* ── Transporte ── */

  #headers(extra = {}) {
    const h = { Accept: 'application/json' };
    for (const [k, v] of Object.entries(extra)) h[k] = sanitizeHeaderValue(v);
    if (IS_BROWSER) h['Lrclib-Client'] = sanitizeHeaderValue(this.opts.userAgent);
    else h['User-Agent'] = sanitizeHeaderValue(this.opts.userAgent);
    if (this.opts.appId) h['Lrclib-App-Id'] = sanitizeHeaderValue(this.opts.appId);
    if (this.opts.apiKey) {
      if (IS_BROWSER) {
        if (!this.#warnedKey) { console.warn('[lrclib] apiKey ignorada en navegador: es secreta, usa appId.'); this.#warnedKey = true; }
      } else h['Lrclib-Api-Key'] = sanitizeHeaderValue(this.opts.apiKey);
    }
    return h;
  }

  #url(path, query) {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (PROTO_BLOCK.has(k)) continue;
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  static #toError(status, data, raw, retryAfterMs, requestId) {
    const name = data?.name;
    const message = data?.message || (typeof raw === 'string' && raw.slice(0, 300)) || `HTTP ${status}`;
    const base = {
      status,
      details: data ?? (typeof raw === 'string' ? raw.slice(0, 1000) : undefined),
      retryAfterMs,
      httpStatus: status,
      requestId,
    };
    if (name === 'TrackNotFound' || status === 404) return new NotFoundError(message, base);
    if (name === 'RateLimitExceeded' || status === 429) return new RateLimitError(message, base);
    if (name === 'IncorrectPublishTokenError') return new PublishTokenError(message, base);
    if (name === 'ValidationError' || status === 400) return new ValidationError(message, base);
    if (status === 401) return Object.assign(new AuthError(message, base), { code: name || 'Unauthorized' });
    if (status >= 500) {
      return new ServerError(message, { ...base, code: name || `HTTP_${status}`, retryable: [500, 502, 503, 504].includes(status) });
    }
    return new LrclibError(message, { ...base, code: name || `HTTP_${status}` });
  }

  /** Lee el cuerpo en streaming con tope real de bytes (no confía en content-length). */
  async #readCapped(res) {
    const max = this.maxResponseBytes;
    if (!res.body || typeof res.body.getReader !== 'function') {
      const t = await res.text();
      if (t.length > max) throw new ResponseTooLargeError(`Body excede ${max} bytes`, { status: res.status });
      return t;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
      total += chunk.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new ResponseTooLargeError(`Body excede ${max} bytes`, { status: res.status, details: { received: total } });
      }
      chunks.push(chunk);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(buf);
  }

  async #once(method, url, { body, headers, signal, timeout, requestId }) {
    throwIfAborted(signal);
    const doFetch = this.opts.fetch ?? globalThis.fetch;
    if (typeof doFetch !== 'function') {
      throw new LrclibError('fetch no disponible (Node >= 18 requerido)', { code: 'NO_FETCH', requestId });
    }
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort(new TimeoutError(`Timeout ${timeout} ms`, { requestId }));
    }, timeout);
    const onAbort = () => ctl.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let res;
      try {
        res = await doFetch(url, {
          method,
          headers: this.#headers({ ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }),
          body: body ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
      } catch (e) {
        if (timedOut) throw new TimeoutError(`Timeout tras ${timeout} ms`, { cause: e, requestId });
        if (signal?.aborted) throw new AbortedError('Operation aborted', { cause: signal.reason, requestId });
        throw new NetworkError(`Error de red: ${e?.message ?? e}`, { cause: e, requestId });
      }
      if (!res || typeof res.text !== 'function') {
        throw new LrclibError('Respuesta fetch inválida', { code: 'BAD_RESPONSE', requestId });
      }

      const declared = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
        await cancelBody(res);
        throw new ResponseTooLargeError(`Respuesta excede ${this.maxResponseBytes} bytes`, {
          status: res.status, details: { declared }, requestId,
        });
      }

      let raw;
      try {
        raw = await this.#readCapped(res);
      } catch (e) {
        if (timedOut) throw new TimeoutError('Timeout leyendo cuerpo', { cause: e, requestId });
        if (signal?.aborted) throw new AbortedError('Operation aborted', { cause: signal.reason, requestId });
        if (e instanceof LrclibError) throw e;
        throw new NetworkError('Fallo al leer el cuerpo de la respuesta', { cause: e, requestId });
      }

      let data = null;
      if (raw) { try { data = JSON.parse(raw); } catch { /* texto plano */ } }
      if (!res.ok) {
        throw LrclibClient.#toError(res.status, data, raw, parseRetryAfter(res.headers?.get?.('retry-after')), requestId);
      }
      return data ?? (raw || null);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async #request(method, path, { query, body, headers, signal, retries, timeout } = {}) {
    const url = this.#url(path, query);
    const maxRetries = Number.isSafeInteger(retries) ? Math.max(0, retries) : this.opts.retries;
    const requestId = ++this.#reqId;
    const cbKey = `${method} ${path}`;
    return this.scheduler.run(async () => {
      for (let attempt = 0; ; attempt++) {
        throwIfAborted(signal);
        if (this.circuit && !this.circuit.check(cbKey)) {
          throw new LrclibError('Circuito abierto: demasiados fallos recientes', { code: 'CIRCUIT_OPEN', requestId });
        }
        try {
          const started = now();
          const out = await this.#once(method, url, {
            body, headers, signal, timeout: timeout ?? this.opts.timeout, requestId,
          });
          this.circuit?.succeed(cbKey);
          this.emit('response', { method, path, ms: Math.round(now() - started), requestId });
          return out;
        } catch (raw) {
          const err = raw instanceof LrclibError
            ? raw
            : new LrclibError('Error inesperado en la petición', { code: 'UNEXPECTED', cause: raw, requestId });

          // El circuito solo cuenta fallos reintentables. Un 404 o 400 prueba que el servidor responde.
          if (this.circuit) {
            if (err.retryable) this.circuit.fail(cbKey);
            else if (!(err instanceof AbortedError)) this.circuit.succeed(cbKey);
          }

          if (!err.retryable || attempt >= maxRetries || signal?.aborted) throw err;

          const hint = err.retryAfterMs;
          if (hint != null && hint > this.opts.maxRetryAfter) throw err;
          const base = hint != null ? hint : this.opts.retryBaseDelay * 2 ** Math.min(attempt, 10);
          const wait = Math.min(withJitter(base), this.opts.maxRetryAfter);
          if (err instanceof RateLimitError || err.status === 503) this.scheduler.pause(wait);
          this.emit('retry', { attempt: attempt + 1, wait, error: err, url, status: err.status, requestId });
          await sleep(wait, signal);
        }
      }
    }, signal);
  }

  /* ── Endpoints v1 ── */

  async get(track, { signal } = {}) {
    const t = normalizeTrack(track);
    if (!t.title || !t.artist) throw new ValidationError('Se requieren title/trackName y artist/artistName');
    return this.#request('GET', '/api/get', {
      query: { track_name: t.title, artist_name: t.artist, album_name: t.album, duration: t.duration },
      signal,
    });
  }

  async getById(id, { signal } = {}) {
    const n = assertSafeInteger(Number(id), 'id', { min: 1 });
    return this.#request('GET', `/api/get/${n}`, { signal });
  }

  async search(query, { signal } = {}) {
    const r = await this.#request('GET', '/api/search', { query: this.#searchQuery(query), signal });
    return Array.isArray(r) ? r : [];
  }

  async searchV2(query, { signal } = {}) {
    const r = await this.#request('GET', '/api/v2/search', { query: this.#searchQuery(query), signal });
    return Array.isArray(r) ? r : [];
  }

  #searchQuery(query) {
    if (typeof query === 'string') {
      const q = str(query);
      if (!q) throw new ValidationError('search requiere q no vacío');
      return { q };
    }
    const src = query && typeof query === 'object' ? query : {};
    const t = normalizeTrack(src);
    const q = str(src.q);
    if (!q && !t.title) throw new ValidationError('search requiere q o trackName');
    return q ? { q } : { track_name: t.title, artist_name: t.artist, album_name: t.album };
  }

  /* ── Búsqueda inteligente ── */

  async findLyrics(track, o = {}) {
    const q = normalizeTrack(track);
    if (!q.title || !q.artist) throw new ValidationError('Se requieren title y artist');

    const opts = { preferSynced: true, maxDurationDiff: 4, minScore: 0.72, maxRequests: 8, bypassCache: false, ...(o ?? {}) };
    opts.maxDurationDiff = num(opts.maxDurationDiff, 4, { min: 0, max: 3600 });
    opts.minScore = num(opts.minScore, 0.72, { min: 0, max: 1 });
    opts.maxRequests = Math.floor(num(opts.maxRequests, 8, { min: 1, max: 50 }));
    const { signal } = opts;
    throwIfAborted(signal);
    await this.cache.init();

    // La clave incluye las opciones: dos búsquedas distintas no comparten resultado.
    const key = [
      `find:${normKey(q.title)}`, normKey(q.artist), normKey(q.album), q.duration ?? 0,
      opts.preferSynced ? 1 : 0, opts.maxDurationDiff, opts.minScore,
    ].join('|');
    const writeCache = !opts.bypassCache;
    if (writeCache) {
      const hit = this.cache.get(key);
      if (hit) return hit.miss ? null : { ...cloneData(hit.value), cached: true };
    }

    let requests = 0;
    let budgetHit = false;
    const budgetLeft = () => requests < opts.maxRequests;
    const guarded = async (fn) => {
      if (!budgetLeft()) { budgetHit = true; return null; }
      requests++;
      try { return await fn(); } catch (e) { if (e instanceof NotFoundError) return null; throw e; }
    };

    const rank = (list) => {
      const seen = new Set();
      return (Array.isArray(list) ? list : [])
        .filter((c) => c && typeof c === 'object' && c.id != null && !seen.has(c.id) && seen.add(c.id))
        .map((c) => ({ c, ...scoreCandidate(c, q, opts) }))
        .filter((r) => r.ok && r.score >= opts.minScore)
        .sort((a, b) => b.score - a.score);
    };

    let record = null, via = null, score = 1;

    const titles = uniq([q.title, cleanTitle(q.title)]);
    const artists = uniq([q.artist, primaryArtist(q.artist)]);
    let first = true;
    outer: for (const t of titles) for (const a of artists) {
      if (q.album && first) {
        record = await guarded(() => this.get({ title: t, artist: a, album: q.album, duration: q.duration }, { signal }));
        if (isLyricsRecord(record)) { via = 'get'; break outer; }
        record = null;
      }
      first = false;
      record = await guarded(() => this.get({ title: t, artist: a, duration: q.duration }, { signal }));
      if (isLyricsRecord(record)) { via = 'get'; break outer; }
      record = null;
    }

    const searchPool = async () => {
      const sq = `${primaryArtist(q.artist)} ${cleanTitle(q.title)}`;
      let ranked = rank(await guarded(() => this.search(sq, { signal })));
      if (!ranked.length) {
        ranked = rank(await guarded(() => this.search({ trackName: cleanTitle(q.title), artistName: primaryArtist(q.artist) }, { signal })));
      }
      return ranked;
    };

    if (!record) {
      const ranked = await searchPool();
      const best = ranked.find((r) => r.c.syncedLyrics || r.c.plainLyrics || r.c.instrumental) ?? ranked[0];
      if (best) { record = best.c; via = 'search'; score = best.score; }
    } else if (opts.preferSynced && !record.instrumental && !isSyncedLrc(record.syncedLyrics) && budgetLeft()) {
      const alt = (await searchPool()).find((r) => isSyncedLrc(r.c.syncedLyrics) && r.c.id !== record.id);
      if (alt) { record = alt.c; via = 'search'; score = alt.score; }
    }

    if (!record) {
      // Un miss con presupuesto agotado no es un miss real: no se cachea.
      if (writeCache && !budgetHit) this.cache.set(key, { miss: true }, { ttl: this.missTtl, persist: true });
      this.emit('miss', { track: q });
      return null;
    }
    const result = { record, via, score, requests, cached: false };
    if (writeCache) this.cache.set(key, { value: cloneData(result) });
    return result;
  }

  /* ── Publicación ── */

  async requestChallenge({ signal } = {}) { return this.#request('POST', '/api/request-challenge', { signal }); }

  async getPublishToken({ signal, onProgress, maxIterations = LIMITS.MAX_ITERATIONS_POW } = {}) {
    const challenge = await this.requestChallenge({ signal });
    assertChallenge(challenge);
    const { token, nonce } = await solveChallenge(challenge, { signal, onProgress, maxIterations });
    if (!(await verifyChallenge(challenge, nonce))) {
      throw new LrclibError('Solver produjo un nonce inválido', { code: 'BAD_SOLVER', details: { nonce } });
    }
    return token;
  }

  async publish(data, { signal, onProgress } = {}) {
    if (!data || typeof data !== 'object') throw new ValidationError('publish requiere un objeto');
    const t = normalizeTrack(data);
    const album = str(data.albumName ?? data.album_name ?? data.album);
    if (!t.title || !t.artist || !album || !t.duration) {
      throw new ValidationError(`publish requiere trackName, artistName, albumName y duration (${LIMITS.MIN_DURATION_SEC}–${LIMITS.MAX_DURATION_SEC} s)`);
    }
    const checkSize = (s, name) => {
      if (utf8Len(s) > LIMITS.LRC_BYTES) throw new ValidationError(`${name} excede ${LIMITS.LRC_BYTES} bytes`);
      return s;
    };
    const body = { trackName: t.title, artistName: t.artist, albumName: album, duration: t.duration };
    if (data.lyricsfile) {
      body.lyricsfile = checkSize(String(data.lyricsfile), 'lyricsfile');
    } else {
      const synced = data.syncedLyrics ? checkSize(String(data.syncedLyrics), 'syncedLyrics') : undefined;
      if (synced) body.syncedLyrics = synced;
      const plainIn = data.plainLyrics != null && String(data.plainLyrics).trim() ? String(data.plainLyrics) : undefined;
      const plain = plainIn ?? (synced ? lrcToPlain(synced) : undefined);
      if (plain && plain.trim()) body.plainLyrics = checkSize(plain, 'plainLyrics');
      if (!body.syncedLyrics && !body.plainLyrics) body.instrumental = true;
    }

    for (let attempt = 0; ; attempt++) {
      const token = await this.getPublishToken({ signal, onProgress });
      try {
        // Sin reintentos automáticos: un 5xx tras guardar duplicaría la publicación.
        await this.#request('POST', '/api/publish', { body, headers: { 'X-Publish-Token': token }, signal, retries: 0 });
        this.cache.clear();
        return { ok: true };
      } catch (e) {
        if (e instanceof PublishTokenError && attempt < 1) continue;
        throw e;
      }
    }
  }

  async flag(trackId, content, { signal, onProgress } = {}) {
    const id = assertSafeInteger(Number(trackId), 'trackId', { min: 1 });
    const token = await this.getPublishToken({ signal, onProgress });
    await this.#request('POST', '/api/flag', {
      body: { trackId: id, ...(content ? { content: String(content) } : {}) },
      headers: { 'X-Publish-Token': token },
      signal,
      retries: 0,
    });
    return { ok: true };
  }

  clearCache() { this.cache.clear(); this.circuit?.reset(); }
  flush() { return this.cache.flush(); }
}

/* ───────────────────────────── LyricsManager ───────────────────────────── */

export class LyricsManager extends Emitter {
  #inflight = new Map();

  constructor(options = {}) {
    super();
    const { client, fs = nodeFs, ...rest } = options ?? {};
    this.client = client instanceof LrclibClient ? client : new LrclibClient(client ?? {});
    this.fs = fs;
    this.opts = {
      saveUnsynced: false,
      tagHeader: false,
      writeInstrumentalMarker: false,
      throwOnError: false,
      preferLyricsDir: false,
      inflightTimeout: 0,
      ...rest,
    };
    this.opts.inflightTimeout = num(this.opts.inflightTimeout, 0, { min: 0 });
    this.client.on('retry', (e) => this.emit('retry', e));
  }

  candidatePaths(track) {
    if (!track || typeof track !== 'object') throw new ValidationError('track inválido');
    if (track.lrcPath) return [String(track.lrcPath)];
    if (this.opts.resolvePath) {
      const r = this.opts.resolvePath(track);
      return (Array.isArray(r) ? r : [r]).filter((p) => typeof p === 'string' && p);
    }
    const t = normalizeTrack(track);
    const file = track.filePath ?? track.path ?? track.file;
    const dir = this.opts.lyricsDir;
    const out = [];

    let alongside = null;
    if (file) {
      const s = String(file);
      const i = lastSep(s);
      // i < 0: sin directorio; i === 0: raíz ("/x.mp3"), sin duplicar la barra.
      alongside = `${i >= 0 ? s.slice(0, i + 1) : ''}${stripExt(basename(s))}.lrc`;
    }

    const central = [];
    if (dir) {
      if (file) central.push(joinPath(dir, `${sanitizeFilename(stripExt(basename(String(file))))}.lrc`));
      if (t.artist && t.title) central.push(joinPath(dir, `${sanitizeFilename(`${t.artist} - ${t.title}`)}.lrc`));
    }
    if (this.opts.preferLyricsDir) out.push(...central, ...(alongside ? [alongside] : []));
    else out.push(...(alongside ? [alongside] : []), ...central);
    return uniq(out);
  }

  /** Registra un fallo como resultado (nunca lanza, salvo abort o throwOnError). */
  #settle(track, error) {
    if (error instanceof AbortedError || this.opts.throwOnError) throw error;
    const res = { status: 'error', error };
    this.emit('error', { track, ...res });
    return res;
  }

  async ensure(track, o = {}) {
    let paths;
    try {
      paths = this.candidatePaths(track);
      if (!paths.length) throw new ValidationError('Indica filePath, lrcPath, lyricsDir (con title/artist) o resolvePath');
    } catch (error) {
      return this.#settle(track, error);
    }

    const key = paths[0];
    if (!o.force && this.#inflight.has(key)) return this.#inflight.get(key);

    const p = this.#ensure(track, paths, o).finally(() => {
      if (this.#inflight.get(key) === p) this.#inflight.delete(key);
    });
    this.#inflight.set(key, p);

    if (this.opts.inflightTimeout > 0) {
      let tId;
      const guard = new Promise((_, reject) => {
        tId = setTimeout(
          () => reject(new TimeoutError(`ensure() excedió ${this.opts.inflightTimeout} ms`)),
          this.opts.inflightTimeout,
        );
        // Sin unref(): si se hiciera, Node podría cerrar el proceso con el await pendiente.
        // El finally de abajo limpia el temporizador en cualquier caso.
      });
      return Promise.race([p, guard])
        .catch((error) => this.#settle(track, error))
        .finally(() => clearTimeout(tId));
    }
    return p;
  }

  async #ensure(track, paths, o) {
    const done = (res) => { this.emit(res.status, { track, ...res }); return res; };
    try {
      if (!o.force) {
        for (const p of paths) {
          if (await this.fs.exists(p)) {
            const text = await this.fs.readText(p);
            if (typeof text === 'string' && text.trim()) return done({ status: 'local', path: p, text });
          }
        }
      }
      const { force, ...findOpts } = o;
      const found = await this.client.findLyrics(track, { ...findOpts, bypassCache: !!force });
      if (!found) return done({ status: 'not-found' });
      const { record, via } = found;
      const target = paths[0];

      if (record.instrumental) {
        if (this.opts.writeInstrumentalMarker) {
          const text = '[00:00.00] ♪ Instrumental ♪\n';
          await this.fs.writeText(target, text);
          return done({ status: 'instrumental', path: target, text, record, via });
        }
        return done({ status: 'instrumental', record, via });
      }

      if (isSyncedLrc(record.syncedLyrics)) {
        let text = String(record.syncedLyrics).replace(/\r\n?/g, '\n').trimEnd() + '\n';
        if (this.opts.tagHeader) text = withMetadataTags(text, record);
        await this.fs.writeText(target, text);
        return done({ status: 'downloaded', path: target, text, record, via });
      }

      if (typeof record.plainLyrics === 'string' && record.plainLyrics.trim()) {
        if (this.opts.saveUnsynced === 'txt') {
          const txtPath = target.replace(/\.lrc$/i, '') + '.txt';
          const plain = record.plainLyrics.replace(/\r\n?/g, '\n');
          await this.fs.writeText(txtPath, plain);
          return done({ status: 'unsynced', path: txtPath, text: plain, record, via });
        }
        return done({ status: 'unsynced', text: record.plainLyrics, record, via });
      }
      return done({ status: 'not-found', record, via });
    } catch (error) {
      return this.#settle(track, error);
    }
  }

  async ensureMany(tracks, { onProgress, signal, ...rest } = {}) {
    if (!Array.isArray(tracks)) throw new ValidationError('ensureMany requiere un array de tracks');
    const results = [];
    const counts = { local: 0, downloaded: 0, unsynced: 0, instrumental: 0, 'not-found': 0, error: 0 };
    try {
      for (let i = 0; i < tracks.length; i++) {
        throwIfAborted(signal);
        const result = await this.ensure(tracks[i], { ...rest, signal });
        counts[result.status] = (counts[result.status] || 0) + 1;
        results.push({ track: tracks[i], ...result });
        try { onProgress?.({ index: i + 1, total: tracks.length, track: tracks[i], result }); } catch { /* el callback no rompe el lote */ }
      }
    } finally {
      await this.client.flush().catch(() => {});
    }
    return { results, counts };
  }

  /** Nunca lanza salvo con throwOnError o abort: los fallos de parseo se devuelven como status 'error'. */
  async load(track, o = {}) {
    const res = await this.ensure(track, o);
    const text = res.status === 'local' || res.status === 'downloaded' ? res.text : null;
    if (!text) return { ...res, parsed: null };
    try {
      return { ...res, parsed: parseLrc(text) };
    } catch (error) {
      if (error instanceof AbortedError || this.opts.throwOnError) throw error;
      this.emit('error', { track, status: 'error', error });
      return { ...res, status: 'error', error, parsed: null };
    }
  }
}

/* ───────────────────────────── Fábrica de conveniencia ───────────────────────────── */

export function createLrclib(options = {}) {
  const manager = new LyricsManager(options);
  return {
    client: manager.client,
    manager,
    ensure: (track, o) => manager.ensure(track, o),
    ensureMany: (tracks, o) => manager.ensureMany(tracks, o),
    load: (track, o) => manager.load(track, o),
    find: (track, o) => manager.client.findLyrics(track, o),
    on: (event, fn) => manager.on(event, fn),
    flush: () => manager.client.flush(),
  };
}

export default LrclibClient;
