/*!
 * lrclib.test.js — Suite de pruebas para lrclib.js v1.2.0
 *
 * Runner: node:test (integrado en Node >= 18, sin dependencias).
 * Ejecutar:   node --test lrclib.test.js
 *
 * Toda la red se simula con un fetch falso: no se hace ninguna petición real.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import LrclibDefault, {
  VERSION,
  LIMITS,
  safeAssign,
  linkSignals,
  LrclibError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  AuthError,
  PublishTokenError,
  ServerError,
  NetworkError,
  TimeoutError,
  AbortedError,
  ResponseTooLargeError,
  isLrclibError,
  isLyricsRecord,
  normalizeTrack,
  normKey,
  cleanTitle,
  primaryArtist,
  similarity,
  scoreCandidate,
  TTLCache,
  sanitizeFilename,
  nodeFs,
  createLocalStorageFs,
  createJsonFileStore,
  createLocalStorageStore,
  sha256,
  solveChallenge,
  verifyChallenge,
  parseLrc,
  formatTimestamp,
  serializeLrc,
  lrcToPlain,
  isSyncedLrc,
  LrcSync,
  LrclibClient,
  LyricsManager,
  createLrclib,
} from './lrclib.js';

/* ═════════════════════════ Helpers de prueba ═════════════════════════ */

const jsonRes = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const notFoundRes = () =>
  jsonRes({ name: 'TrackNotFound', message: 'Failed to find specified track', statusCode: 404 }, 404);

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

const hangUntilAbort = (signal) =>
  new Promise((_, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

/**
 * fetch falso. `handler(call, n)` puede devolver un Response, un objeto (=> 200 JSON)
 * o lanzar. Las llamadas quedan registradas en `fetch.calls`.
 */
function createMockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = {
      url: new URL(url),
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    };
    calls.push(call);
    if (init.signal?.aborted) throw init.signal.reason;
    const out = await handler(call, calls.length);
    return out instanceof Response ? out : jsonRes(out);
  };
  fn.calls = calls;
  fn.count = (pathname) => calls.filter((c) => c.url.pathname === pathname).length;
  return fn;
}

const BASE_OPTS = { minInterval: 0, retryBaseDelay: 1, retries: 0 };

function makeClient(handler, extra = {}) {
  const fetch = createMockFetch(handler);
  const client = new LrclibClient({ ...BASE_OPTS, fetch, ...extra });
  return { client, fetch };
}

const rec = (o = {}) => ({
  id: 1,
  name: 'Song',
  trackName: 'Song',
  artistName: 'Artist',
  albumName: 'Album',
  duration: 200,
  instrumental: false,
  plainLyrics: 'plain',
  syncedLyrics: '[00:01.00]hello',
  ...o,
});

/** Handler estándar de lyrics: /api/get devuelve `getResult`, /api/search devuelve `searchResult`. */
const lyricsHandler = ({ getResult = rec(), searchResult = [] } = {}) => (call) => {
  if (call.url.pathname === '/api/get') return getResult ?? notFoundRes();
  if (call.url.pathname === '/api/search') return searchResult;
  return notFoundRes();
};

function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async exists(p) { return files.has(p); },
    async readText(p) {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    async writeText(p, t) { files.set(p, t); },
  };
}

function makeManager(handler, { fs = memFs(), client = {}, ...rest } = {}) {
  const fetch = createMockFetch(handler);
  const manager = new LyricsManager({ client: { ...BASE_OPTS, fetch, ...client }, fs, ...rest });
  return { manager, fetch, fs };
}

const TRACK = {
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  filePath: '/music/song.mp3',
};

const rejectsWith = (promise, Cls, props = {}) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof Cls, `esperaba ${Cls.name}, llegó ${e?.name}: ${e?.message}`);
    for (const [k, v] of Object.entries(props)) assert.deepEqual(e[k], v, `propiedad ${k}`);
    return true;
  });

/* ═════════════════════════ Generales ═════════════════════════ */

describe('exports generales', () => {
  it('expone VERSION y el export por defecto', () => {
    assert.equal(VERSION, '1.2.0');
    assert.equal(LrclibDefault, LrclibClient);
  });

  it('LIMITS está congelado y tiene valores coherentes', () => {
    assert.ok(Object.isFrozen(LIMITS));
    assert.ok(LIMITS.RESPONSE_BYTES < LIMITS.RESPONSE_BYTES_MAX);
    assert.ok(LIMITS.MIN_DURATION_SEC < LIMITS.MAX_DURATION_SEC);
  });
});

describe('safeAssign', () => {
  it('copia propiedades normales', () => {
    assert.deepEqual(safeAssign({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  });

  it('ignora claves de prototype pollution', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","prototype":"y","ok":1}');
    const target = safeAssign({}, evil);
    assert.equal(target.ok, 1);
    assert.equal(({}).polluted, undefined);
    assert.equal(target.polluted, undefined);
    assert.equal(Object.getPrototypeOf(target), Object.prototype);
    assert.equal(Object.hasOwn(target, 'constructor'), false);
    assert.equal(Object.hasOwn(target, 'prototype'), false);
  });

  it('tolera origen no objeto', () => {
    const t = { a: 1 };
    assert.equal(safeAssign(t, null), t);
    assert.equal(safeAssign(t, 'str'), t);
    assert.deepEqual(t, { a: 1 });
  });
});

describe('linkSignals', () => {
  it('devuelve undefined sin señales y la misma señal si hay una', () => {
    assert.equal(linkSignals(), undefined);
    assert.equal(linkSignals(null, undefined), undefined);
    const ac = new AbortController();
    assert.equal(linkSignals(ac.signal), ac.signal);
  });

  it('aborta cuando cualquiera de las señales aborta', () => {
    const a = new AbortController();
    const b = new AbortController();
    const linked = linkSignals(a.signal, b.signal);
    assert.equal(linked.aborted, false);
    b.abort(new Error('boom'));
    assert.equal(linked.aborted, true);
  });

  it('funciona sin AbortSignal.any (fallback manual)', () => {
    const original = AbortSignal.any;
    AbortSignal.any = undefined;
    try {
      const a = new AbortController();
      const b = new AbortController();
      const linked = linkSignals(a.signal, b.signal);
      assert.equal(linked.aborted, false);
      a.abort('razón');
      assert.equal(linked.aborted, true);
      assert.equal(linked.reason, 'razón');

      const pre = new AbortController();
      pre.abort('previa');
      const linked2 = linkSignals(new AbortController().signal, pre.signal);
      assert.equal(linked2.aborted, true);
    } finally {
      AbortSignal.any = original;
    }
  });
});

/* ═════════════════════════ Errores ═════════════════════════ */

describe('jerarquía de errores', () => {
  it('todos extienden LrclibError y Error', () => {
    const all = [
      new NotFoundError('x'), new ValidationError('x'), new RateLimitError('x'),
      new AuthError('x'), new PublishTokenError('x'), new ServerError('x'),
      new NetworkError('x'), new TimeoutError('x'), new AbortedError(),
      new ResponseTooLargeError('x'),
    ];
    for (const e of all) {
      assert.ok(e instanceof LrclibError);
      assert.ok(e instanceof Error);
      assert.ok(isLrclibError(e));
    }
    assert.equal(isLrclibError(new Error('x')), false);
    assert.equal(isLrclibError(null), false);
  });

  it('valores por defecto de cada clase', () => {
    assert.deepEqual(
      [new NotFoundError('x').status, new NotFoundError('x').code],
      [404, 'TrackNotFound'],
    );
    assert.equal(new ValidationError('x').status, 400);
    assert.equal(new ValidationError('x', { status: 422 }).status, 422);
    assert.equal(new RateLimitError('x').retryable, true);
    assert.equal(new RateLimitError('x').status, 429);
    assert.equal(new AuthError('x').status, 401);
    assert.equal(new PublishTokenError('x').code, 'IncorrectPublishTokenError');
    assert.equal(new NetworkError('x').retryable, true);
    assert.equal(new TimeoutError('x').code, 'TIMEOUT');
    assert.equal(new AbortedError().retryable, false);
    assert.equal(new AbortedError().message, 'Operation aborted');
    assert.equal(new ResponseTooLargeError('x').retryable, false);
  });

  it('ServerError es reintentable salvo que se indique lo contrario', () => {
    assert.equal(new ServerError('x').retryable, true);
    assert.equal(new ServerError('x', { retryable: false }).retryable, false);
  });

  it('LrclibError conserva cause, details, requestId y httpStatus', () => {
    const cause = new Error('origen');
    const e = new LrclibError('msg', { status: 502, details: { a: 1 }, requestId: 7, cause });
    assert.equal(e.name, 'LrclibError');
    assert.equal(e.cause, cause);
    assert.deepEqual(e.details, { a: 1 });
    assert.equal(e.requestId, 7);
    assert.equal(e.httpStatus, 502);
  });

  it('cada subclase fija su name', () => {
    assert.equal(new NotFoundError('x').name, 'NotFoundError');
    assert.equal(new TimeoutError('x').name, 'TimeoutError');
    assert.equal(new AbortedError().name, 'AbortedError');
  });
});

describe('isLyricsRecord', () => {
  it('acepta registros válidos y rechaza el resto', () => {
    assert.equal(isLyricsRecord(rec()), true);
    assert.equal(isLyricsRecord({ id: 1.5, trackName: 'x' }), false);
    assert.equal(isLyricsRecord({ id: 1 }), false);
    assert.equal(isLyricsRecord(null), false);
    assert.equal(isLyricsRecord('x'), false);
    assert.equal(isLyricsRecord({ message: 'nope' }), false);
  });
});

/* ═════════════════════════ Normalización y matching ═════════════════════════ */

describe('normalizeTrack', () => {
  it('acepta alias de campos', () => {
    assert.deepEqual(
      normalizeTrack({ track_name: ' Song ', artist_name: 'Artist', album_name: 'Album', duration: 200 }),
      { title: 'Song', artist: 'Artist', album: 'Album', duration: 200 },
    );
    assert.deepEqual(
      normalizeTrack({ trackName: 'T', artistName: 'A', albumName: 'B', duration: 10 }),
      { title: 'T', artist: 'A', album: 'B', duration: 10 },
    );
    assert.equal(normalizeTrack({ name: 'N' }).title, 'N');
  });

  it('une el array de artistas', () => {
    assert.equal(normalizeTrack({ title: 'x', artists: ['A', 'B'] }).artist, 'A, B');
  });

  it('durationMs solo se convierte una vez (duraciones > 1 h correctas)', () => {
    assert.equal(normalizeTrack({ durationMs: 200_000 }).duration, 200);
    assert.equal(normalizeTrack({ durationMs: 4_000_000 }).duration, 4000);
  });

  it('infiere milisegundos solo cuando el valor excede cualquier duración válida', () => {
    assert.equal(normalizeTrack({ duration: 200_000 }).duration, 200);
    assert.equal(normalizeTrack({ duration: 4000 }).duration, 4000);
    assert.equal(normalizeTrack({ duration: 36_000 }).duration, 36_000);
  });

  it('redondea y descarta duraciones fuera de rango o inválidas', () => {
    assert.equal(normalizeTrack({ duration: 200.6 }).duration, 201);
    assert.equal(normalizeTrack({ duration: 0 }).duration, undefined);
    assert.equal(normalizeTrack({ duration: -5 }).duration, undefined);
    assert.equal(normalizeTrack({ duration: 'abc' }).duration, undefined);
    assert.equal(normalizeTrack({ duration: '' }).duration, undefined);
    assert.equal(normalizeTrack({ duration: Infinity }).duration, undefined);
    assert.equal(normalizeTrack({ duration: '180' }).duration, 180);
  });

  it('tolera entradas nulas o sin campos', () => {
    const empty = { title: undefined, artist: undefined, album: undefined, duration: undefined };
    assert.deepEqual(normalizeTrack(), empty);
    assert.deepEqual(normalizeTrack(null), empty);
    assert.deepEqual(normalizeTrack('texto'), empty);
    assert.equal(normalizeTrack({ title: '   ' }).title, undefined);
  });
});

describe('normKey, cleanTitle, primaryArtist', () => {
  it('normKey quita acentos, símbolos y artículo inicial', () => {
    assert.equal(normKey('Beyoncé & Jay-Z'), 'beyonce and jay z');
    assert.equal(normKey('The Beatles'), 'beatles');
    assert.equal(normKey(null), '');
    assert.equal(normKey('  ¡Hola, Mundo!  '), 'hola mundo');
  });

  it('cleanTitle elimina ruido típico', () => {
    assert.equal(cleanTitle('Song (feat. Guest)'), 'Song');
    assert.equal(cleanTitle('Song [ft. Guest]'), 'Song');
    assert.equal(cleanTitle('Song - 2011 Remastered'), 'Song');
    assert.equal(cleanTitle('Song (Deluxe Edition)'), 'Song');
    assert.equal(cleanTitle('Song [Remastered 2009]'), 'Song');
    assert.equal(cleanTitle('Song feat. Someone'), 'Song');
    assert.equal(cleanTitle('Plain Song'), 'Plain Song');
  });

  it('cleanTitle no devuelve vacío si todo era ruido', () => {
    assert.equal(cleanTitle('(feat. X)'), '(feat. X)');
    assert.equal(cleanTitle(), '');
  });

  it('primaryArtist toma el artista principal', () => {
    assert.equal(primaryArtist('Artist feat. Guest'), 'Artist');
    assert.equal(primaryArtist('Artist ft. Guest'), 'Artist');
    assert.equal(primaryArtist('A; B'), 'A');
    assert.equal(primaryArtist('A, B'), 'A');
    assert.equal(primaryArtist('AC/DC'), 'AC/DC');
    assert.equal(primaryArtist(''), '');
  });
});

describe('similarity y scoreCandidate', () => {
  it('similarity: casos básicos', () => {
    assert.equal(similarity('Song', 'song'), 1);
    assert.equal(similarity('Beyoncé', 'beyonce'), 1);
    assert.equal(similarity('', 'x'), 0);
    assert.equal(similarity(null, null), 0);
    assert.ok(similarity('abc', 'xyz') < 0.1);
  });

  it('similarity: la contención puntúa alto pero menos que la igualdad', () => {
    const s = similarity('Love', 'Love Story');
    assert.ok(s > 0.7 && s < 1, `s=${s}`);
  });

  it('scoreCandidate: coincidencia perfecta', () => {
    const r = scoreCandidate(rec(), { title: 'Song', artist: 'Artist', album: 'Album', duration: 200 });
    assert.equal(r.ok, true);
    assert.ok(r.score > 0.99);
    assert.equal(r.durationDiff, 0);
  });

  it('scoreCandidate: artista distinto => no ok', () => {
    const r = scoreCandidate(
      rec({ artistName: 'Totally Different' }),
      { title: 'Song', artist: 'Artist', duration: 200 },
    );
    assert.equal(r.ok, false);
  });

  it('scoreCandidate: diferencia de duración fuera de rango => no ok', () => {
    const q = { title: 'Song', artist: 'Artist', duration: 200 };
    assert.equal(scoreCandidate(rec({ duration: 203 }), q).ok, true);
    assert.equal(scoreCandidate(rec({ duration: 210 }), q).ok, false);
    assert.equal(scoreCandidate(rec({ duration: 210 }), q, { maxDurationDiff: 20 }).ok, true);
  });

  it('scoreCandidate: sin duración en la consulta no penaliza', () => {
    const r = scoreCandidate(rec({ duration: 999 }), { title: 'Song', artist: 'Artist' });
    assert.equal(r.durationDiff, null);
    assert.equal(r.ok, true);
  });

  it('scoreCandidate: preferSynced suma un bonus', () => {
    const q = { title: 'Song', artist: 'Artist', duration: 200 };
    const withSync = scoreCandidate(rec(), q, { preferSynced: true });
    const without = scoreCandidate(rec(), q, { preferSynced: false });
    assert.ok(withSync.score > without.score);
  });

  it('scoreCandidate: limpia sufijos del título de la consulta', () => {
    const r = scoreCandidate(rec(), { title: 'Song (feat. Guest)', artist: 'Artist', duration: 200 });
    assert.equal(r.ok, true);
    assert.ok(r.title > 0.99);
  });
});

/* ═════════════════════════ TTLCache ═════════════════════════ */

describe('TTLCache', () => {
  it('set/get/delete/clear/size', () => {
    const c = new TTLCache();
    c.set('a', 1);
    c.set('b', 2);
    assert.equal(c.get('a'), 1);
    assert.equal(c.size, 2);
    c.delete('a');
    assert.equal(c.get('a'), undefined);
    c.clear();
    assert.equal(c.size, 0);
  });

  it('expira por TTL', async () => {
    const c = new TTLCache();
    c.set('a', 1, { ttl: 10 });
    c.set('b', 2, { ttl: 0 });
    assert.equal(c.get('b'), undefined);
    await delay(30);
    assert.equal(c.get('a'), undefined);
    assert.equal(c.size, 0);
  });

  it('desaloja la entrada menos usada (LRU)', () => {
    const c = new TTLCache({ max: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('a'), 1);
    assert.equal(c.get('c'), 3);
  });

  it('max = 0 desactiva la caché', () => {
    const c = new TTLCache({ max: 0 });
    c.set('a', 1);
    assert.equal(c.get('a'), undefined);
    assert.equal(c.size, 0);
  });

  it('opciones inválidas usan valores seguros', () => {
    const c = new TTLCache({ max: -1, ttl: 'abc' });
    assert.equal(c.max, 500);
    assert.equal(c.ttl, 24 * 3600e3);
    assert.doesNotThrow(() => new TTLCache(null));
  });

  it('freeze devuelve un clon congelado', () => {
    const c = new TTLCache({ freeze: true });
    const original = { a: { b: 1 } };
    c.set('k', original);
    const got = c.get('k');
    assert.ok(Object.isFrozen(got));
    assert.notEqual(got, original);
    assert.deepEqual(got, original);
    original.a.b = 99;
    assert.equal(c.get('k').a.b, 1);
  });

  describe('persistencia', () => {
    it('init carga entradas válidas, descarta caducadas y bloquea claves peligrosas', async () => {
      const data = JSON.parse(
        `{"ok":{"value":1,"exp":${Date.now() + 100_000}},
          "old":{"value":2,"exp":1},
          "bad":{"value":3},
          "__proto__":{"value":4,"exp":${Date.now() + 100_000}}}`,
      );
      const c = new TTLCache({ store: { load: async () => data, save: async () => {} } });
      await c.init();
      assert.equal(c.get('ok'), 1);
      assert.equal(c.get('old'), undefined);
      assert.equal(c.get('bad'), undefined);
      assert.equal(c.get('__proto__'), undefined);
    });

    it('init es memoizado: el store se carga una sola vez', async () => {
      let loads = 0;
      const c = new TTLCache({ store: { load: async () => { loads++; return {}; }, save: async () => {} } });
      await Promise.all([c.init(), c.init(), c.init()]);
      await c.init();
      assert.equal(loads, 1);
    });

    it('init ignora un store que falla', async () => {
      const c = new TTLCache({ store: { load: async () => { throw new Error('x'); }, save: async () => {} } });
      await assert.doesNotReject(c.init());
    });

    it('flush guarda solo entradas persistentes y vigentes', async () => {
      let saved;
      const c = new TTLCache({ store: { load: async () => ({}), save: async (o) => { saved = o; } } });
      c.set('p', 1, { persist: true });
      c.set('np', 2);
      c.set('expired', 3, { persist: true, ttl: 0 });
      await c.flush();
      assert.deepEqual(Object.keys(saved), ['p']);
      assert.equal(saved.p.persist, true);
    });

    it('las entradas cargadas del store siguen siendo persistentes', async () => {
      let saved;
      const data = { k: { value: 'v', exp: Date.now() + 100_000 } };
      const c = new TTLCache({ store: { load: async () => data, save: async (o) => { saved = o; } } });
      await c.init();
      await c.flush();
      assert.ok(saved.k);
      assert.equal(saved.k.value, 'v');
    });

    it('flush sin store no hace nada', async () => {
      await assert.doesNotReject(new TTLCache().flush());
    });
  });
});

/* ═════════════════════════ Adaptadores de almacenamiento ═════════════════════════ */

describe('sanitizeFilename', () => {
  it('reemplaza caracteres peligrosos y recorta', () => {
    assert.equal(sanitizeFilename('a/b:c*'), 'a_b_c_');
    assert.equal(sanitizeFilename('..hidden'), 'hidden');
    assert.equal(sanitizeFilename(''), 'lyrics');
    assert.equal(sanitizeFilename('   '), 'lyrics');
    assert.equal(sanitizeFilename('x'.repeat(200)).length, 150);
    assert.equal(sanitizeFilename('a   b'), 'a b');
  });
});

describe('nodeFs', () => {
  it('escribe de forma atómica, crea directorios y lee', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lrclib-test-'));
    try {
      const file = join(dir, 'a', 'b', 'song.lrc');
      assert.equal(await nodeFs.exists(file), false);
      await nodeFs.writeText(file, 'hola ♪');
      assert.equal(await nodeFs.exists(file), true);
      assert.equal(await nodeFs.readText(file), 'hola ♪');
      assert.equal(await readFile(file, 'utf8'), 'hola ♪');
      const left = await readdir(join(dir, 'a', 'b'));
      assert.deepEqual(left, ['song.lrc'], 'no deben quedar temporales');
      await nodeFs.writeText(file, 'nuevo');
      assert.equal(await nodeFs.readText(file), 'nuevo');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('readText de un archivo inexistente rechaza', async () => {
    await assert.rejects(nodeFs.readText(join(tmpdir(), 'no-existe-lrclib', 'x.lrc')));
  });
});

describe('createJsonFileStore', () => {
  it('guarda y carga JSON; si falta devuelve {}', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lrclib-test-'));
    try {
      const store = createJsonFileStore(join(dir, 'cache.json'));
      assert.deepEqual(await store.load(), {});
      await store.save({ a: 1, b: [2] });
      assert.deepEqual(await store.load(), { a: 1, b: [2] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('JSON corrupto => {}', async () => {
    const fs = memFs({ 'c.json': '{no es json' });
    assert.deepEqual(await createJsonFileStore('c.json', fs).load(), {});
  });
});

describe('adaptadores de localStorage', () => {
  const withLocalStorage = async (fn) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const data = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)); },
      },
    });
    try {
      await fn(data);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  };

  it('createLocalStorageFs', async () => {
    await withLocalStorage(async (data) => {
      const fs = createLocalStorageFs('p:');
      assert.equal(await fs.exists('x.lrc'), false);
      await fs.writeText('x.lrc', 'texto');
      assert.equal(data.get('p:x.lrc'), 'texto');
      assert.equal(await fs.exists('x.lrc'), true);
      assert.equal(await fs.readText('x.lrc'), 'texto');
      assert.equal(await fs.readText('otro.lrc'), '');
    });
  });

  it('createLocalStorageStore: roundtrip y tolerancia a JSON corrupto', async () => {
    await withLocalStorage(async (data) => {
      const store = createLocalStorageStore('k');
      assert.deepEqual(await store.load(), {});
      await store.save({ a: 1 });
      assert.deepEqual(await store.load(), { a: 1 });
      data.set('k', '{roto');
      assert.deepEqual(await store.load(), {});
    });
  });

  it('createLocalStorageStore: cuota llena no lanza', async () => {
    await withLocalStorage(async () => {
      globalThis.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
      await assert.doesNotReject(createLocalStorageStore().save({ a: 1 }));
    });
  });
});

/* ═════════════════════════ SHA-256 y Proof-of-Work ═════════════════════════ */

describe('sha256', () => {
  const hex = (u8) => Buffer.from(u8).toString('hex');

  it('vectores conocidos', () => {
    assert.equal(hex(sha256(new Uint8Array())), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hex(sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('coincide con node:crypto para varias longitudes (límites de bloque)', () => {
    for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) & 0xff);
      assert.equal(hex(sha256(bytes)), createHash('sha256').update(bytes).digest('hex'), `len=${len}`);
    }
  });
});

describe('solveChallenge / verifyChallenge', () => {
  const sha0 = (s) => createHash('sha256').update(s).digest()[0];

  it('resuelve un desafío y el resultado es verificable', async () => {
    const challenge = { prefix: 'test', target: '0fff' };
    const { nonce, token, iterations } = await solveChallenge(challenge);
    assert.equal(token, `test:${nonce}`);
    assert.equal(iterations, Number(nonce) + 1);
    assert.ok(sha0(`test${nonce}`) <= 0x0f);
    assert.equal(await verifyChallenge(challenge, nonce), true);
  });

  it('un target de 32 bytes todo ff se resuelve con el nonce 0', async () => {
    const r = await solveChallenge({ prefix: 'p', target: 'f'.repeat(64) });
    assert.equal(r.nonce, '0');
  });

  it('verifyChallenge rechaza nonces mal formados o incorrectos', async () => {
    const strict = { prefix: 'test', target: '00000000' };
    assert.equal(await verifyChallenge(strict, '0'), false);
    assert.equal(await verifyChallenge(strict, 'x1'), false);
    assert.equal(await verifyChallenge(strict, '-1'), false);
    assert.equal(await verifyChallenge(strict, '1.5'), false);
  });

  it('valida el target (hex par, 1–32 bytes)', async () => {
    for (const target of ['zz', 'abc', '', 'f'.repeat(66), 123, null]) {
      await rejectsWith(solveChallenge({ prefix: 'p', target }), LrclibError, {
        code: target === 123 || target === null ? 'BAD_CHALLENGE' : 'BAD_TARGET',
      });
    }
  });

  it('valida la forma del desafío', async () => {
    for (const bad of [null, {}, { prefix: '', target: 'ff' }, { prefix: 5, target: 'ff' }]) {
      await rejectsWith(solveChallenge(bad), LrclibError, { code: 'BAD_CHALLENGE' });
    }
    await rejectsWith(solveChallenge({ prefix: 'x'.repeat(LIMITS.CHALLENGE_PREFIX_MAX + 1), target: 'ff' }), LrclibError, { code: 'BAD_CHALLENGE' });
  });

  it('respeta maxIterations', async () => {
    const hard = { prefix: 'p', target: '0000000000' };
    await rejectsWith(solveChallenge(hard, { maxIterations: 10 }), LrclibError, { code: 'CHALLENGE_UNSOLVED' });
    await rejectsWith(solveChallenge(hard, { maxIterations: 0 }), LrclibError, { code: 'CHALLENGE_UNSOLVED' });
  });

  it('se puede abortar', async () => {
    const ac = new AbortController();
    ac.abort();
    await rejectsWith(
      solveChallenge({ prefix: 'p', target: '0000000000' }, { signal: ac.signal, yieldEvery: 5 }),
      AbortedError,
    );
  });

  it('onProgress se invoca y un callback que lanza no rompe el solver', async () => {
    let calls = 0;
    await rejectsWith(
      solveChallenge({ prefix: 'p', target: '0000000000' }, {
        maxIterations: 12,
        yieldEvery: 5,
        onProgress: () => { calls++; throw new Error('listener roto'); },
      }),
      LrclibError,
      { code: 'CHALLENGE_UNSOLVED' },
    );
    assert.equal(calls, 2);
  });
});

/* ═════════════════════════ LRC ═════════════════════════ */

describe('parseLrc', () => {
  it('parsea líneas con timestamps y metadatos', () => {
    const { meta, lines, synced } = parseLrc('[ti:Title]\n[ar:Someone]\n[00:12.00]Hello\n[01:02.50]World');
    assert.equal(meta.ti, 'Title');
    assert.equal(meta.ar, 'Someone');
    assert.equal(synced, true);
    assert.deepEqual(lines, [
      { time: 12000, text: 'Hello' },
      { time: 62500, text: 'World' },
    ]);
  });

  it('interpreta fracciones de 1, 2 y 3 dígitos y la ausencia de fracción', () => {
    const { lines } = parseLrc('[00:01.5]a\n[00:02.50]b\n[00:03.500]c\n[00:04]d\n[00:05:25]e');
    assert.deepEqual(lines.map((l) => l.time), [1500, 2500, 3500, 4000, 5250]);
  });

  it('múltiples timestamps por línea generan varias entradas ordenadas', () => {
    const { lines } = parseLrc('[00:20.00][00:10.00]Coro\n[00:15.00]Verso');
    assert.deepEqual(lines.map((l) => [l.time, l.text]), [[10000, 'Coro'], [15000, 'Verso'], [20000, 'Coro']]);
  });

  it('acepta BOM, CRLF y líneas vacías', () => {
    const { lines } = parseLrc('\uFEFF[00:01.00]a\r\n\r\n[00:02.00]b\r\n');
    assert.equal(lines.length, 2);
  });

  it('conserva líneas con texto vacío', () => {
    const { lines } = parseLrc('[00:01.00]\n[00:02.00]x');
    assert.deepEqual(lines[0], { time: 1000, text: '' });
  });

  it('texto sin timestamps => synced false', () => {
    const r = parseLrc('solo texto\nsin tiempos');
    assert.equal(r.synced, false);
    assert.deepEqual(r.lines, []);
  });

  it('entradas nulas o vacías', () => {
    assert.deepEqual(parseLrc(null).lines, []);
    assert.deepEqual(parseLrc('').lines, []);
    assert.equal(parseLrc(undefined).synced, false);
  });

  describe('offset', () => {
    it('se aplica por defecto (positivo adelanta, negativo retrasa)', () => {
      assert.deepEqual(parseLrc('[offset:500]\n[00:01.00]a\n[00:00.20]b').lines.map((l) => l.time), [0, 500]);
      assert.deepEqual(parseLrc('[offset:-500]\n[00:01.00]a').lines.map((l) => l.time), [1500]);
    });

    it('applyOffset=false lo ignora', () => {
      assert.equal(parseLrc('[offset:500]\n[00:01.00]a', { applyOffset: false }).lines[0].time, 1000);
    });

    it('un offset no numérico se ignora', () => {
      assert.equal(parseLrc('[offset:abc]\n[00:01.00]a').lines[0].time, 1000);
    });
  });

  describe('word-sync (LRC enhanced)', () => {
    it('extrae palabras y limpia el texto', () => {
      const { lines } = parseLrc('[00:10.00]<00:10.00>Hel<00:10.50>lo');
      assert.equal(lines[0].text, 'Hello');
      assert.deepEqual(lines[0].words, [
        { time: 10000, text: 'Hel' },
        { time: 10500, text: 'lo' },
      ]);
    });

    it('las líneas repetidas no comparten objetos y el offset no se acumula', () => {
      const { lines } = parseLrc('[offset:500]\n[00:10.00][00:20.00]<00:10.00>a<00:11.00>b');
      assert.equal(lines.length, 2);
      assert.notEqual(lines[0].words, lines[1].words);
      assert.notEqual(lines[0].words[0], lines[1].words[0]);
      assert.equal(lines[0].words[0].time, 9500);
      assert.equal(lines[1].words[0].time, 9500);
      assert.equal(lines[1].words[1].time, 10500);
    });
  });

  describe('límites defensivos', () => {
    it('limita los timestamps por línea', () => {
      const { lines } = parseLrc('[00:01.00]'.repeat(100) + 'x');
      assert.equal(lines.length, LIMITS.LRC_STAMPS_PER_LINE);
    });

    it('rechaza texto demasiado grande (caracteres)', () => {
      assert.throws(() => parseLrc('a'.repeat(LIMITS.LRC_BYTES + 1)), ValidationError);
    });

    it('rechaza texto demasiado grande (bytes UTF-8 reales)', () => {
      // 1.5M caracteres de 3 bytes: bajo el tope en caracteres, sobre el tope en bytes.
      assert.throws(() => parseLrc('€'.repeat(1_500_000)), ValidationError);
    });

    it('rechaza demasiadas líneas', () => {
      assert.throws(() => parseLrc('[00:01.00]a\n'.repeat(LIMITS.LRC_LINES + 1)), ValidationError);
    });

    it('rechaza demasiadas entradas (timestamps múltiples)', () => {
      const line = '[00:01.00][00:02.00][00:03.00]x\n';
      assert.throws(() => parseLrc(line.repeat(Math.ceil(LIMITS.LRC_ENTRIES / 3) + 10)), ValidationError);
    });

    it('trunca valores de metadatos largos', () => {
      const { meta } = parseLrc(`[ti:${'x'.repeat(5000)}]`);
      assert.equal(meta.ti.length, LIMITS.META_VALUE_MAX);
    });

    it('no admite claves de metadatos peligrosas y meta no tiene prototipo', () => {
      const { meta } = parseLrc('[constructor:evil]\n[prototype:evil]\n[ti:ok]');
      assert.equal(Object.getPrototypeOf(meta), null);
      assert.deepEqual(Object.keys(meta), ['ti']);
    });
  });
});

describe('formatTimestamp', () => {
  it('formatea mm:ss.xx', () => {
    assert.equal(formatTimestamp(0), '00:00.00');
    assert.equal(formatTimestamp(61_230), '01:01.23');
    assert.equal(formatTimestamp(15), '00:00.02');
    assert.equal(formatTimestamp(200_000), '03:20.00');
    assert.equal(formatTimestamp(6_000_000), '100:00.00');
  });

  it('valores negativos o no finitos => 0', () => {
    for (const v of [-100, NaN, Infinity, -Infinity, undefined, 'abc']) {
      assert.equal(formatTimestamp(v), '00:00.00', String(v));
    }
  });

  it('es coherente con parseLrc (ida y vuelta)', () => {
    for (const ms of [0, 10, 1230, 59_990, 61_230, 3_599_990]) {
      assert.equal(parseLrc(`[${formatTimestamp(ms)}]x`).lines[0].time, ms);
    }
  });
});

describe('serializeLrc', () => {
  it('serializa metadatos y líneas ordenadas', () => {
    const out = serializeLrc(
      [{ time: 1000, text: 'Hi' }, { time: 0, text: 'First' }],
      { ti: 'T', ar: 'A' },
    );
    assert.equal(out, '[ti:T]\n[ar:A]\n[00:00.00] First\n[00:01.00] Hi\n');
  });

  it('sanea saltos de línea (anti inyección de líneas)', () => {
    const out = serializeLrc(
      [{ time: 0, text: 'a\nb\u2028c' }],
      { ar: 'X\n[00:00.00] evil' },
    );
    const rows = out.trimEnd().split('\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0], '[ar:X [00:00.00] evil]');
    assert.equal(rows[1], '[00:00.00] a b c');
  });

  it('descarta claves inválidas, valores vacíos y líneas sin tiempo finito', () => {
    const out = serializeLrc(
      [{ time: NaN, text: 'x' }, null, { time: 500, text: '' }],
      { 'bad key': 'v', ti: '', ar: null, al: 'ok' },
    );
    assert.equal(out, '[al:ok]\n[00:00.50]\n');
  });

  it('tolera entradas inválidas', () => {
    assert.equal(serializeLrc(null, null), '\n');
    assert.equal(serializeLrc('x'), '\n');
  });

  it('ida y vuelta con parseLrc', () => {
    const lines = [{ time: 12_340, text: 'Hola' }, { time: 20_000, text: 'Mundo' }];
    const parsed = parseLrc(serializeLrc(lines, { ti: 'T' }));
    assert.equal(parsed.meta.ti, 'T');
    assert.deepEqual(parsed.lines, lines);
  });
});

describe('lrcToPlain e isSyncedLrc', () => {
  it('quita metadatos, timestamps y marcas de palabra', () => {
    const plain = lrcToPlain('[ti:T]\n[00:01.00]Hello\n[00:02.00]<00:02.00>Wor<00:02.50>ld\n\n\n\n[00:05.00]End');
    assert.equal(plain, 'Hello\nWorld\n\nEnd');
  });

  it('tolera entradas nulas', () => {
    assert.equal(lrcToPlain(null), '');
    assert.equal(lrcToPlain(''), '');
  });

  it('isSyncedLrc', () => {
    assert.equal(isSyncedLrc('[00:01.00]x'), true);
    assert.equal(isSyncedLrc('[1:5]x'), true);
    assert.equal(isSyncedLrc('texto plano'), false);
    assert.equal(isSyncedLrc('[ti:Title]'), false);
    assert.equal(isSyncedLrc(''), false);
    assert.equal(isSyncedLrc(null), false);
  });
});

describe('LrcSync', () => {
  const lines = [{ time: 3000, text: 'c' }, { time: 1000, text: 'a' }, { time: 2000, text: 'b' }];

  it('ordena y filtra líneas inválidas', () => {
    const s = new LrcSync([...lines, { time: NaN, text: 'x' }, null]);
    assert.deepEqual(s.lines.map((l) => l.text), ['a', 'b', 'c']);
    assert.deepEqual(new LrcSync(null).lines, []);
  });

  it('indexAt', () => {
    const s = new LrcSync(lines);
    assert.equal(s.indexAt(0), -1);
    assert.equal(s.indexAt(1000), 0);
    assert.equal(s.indexAt(2500), 1);
    assert.equal(s.indexAt(99_999), 2);
    assert.equal(s.indexAt(NaN), -1);
    assert.equal(s.indexAt(Infinity), -1);
  });

  it('at calcula línea, siguiente y progreso', () => {
    const s = new LrcSync(lines);
    const r = s.at(1500);
    assert.equal(r.index, 0);
    assert.equal(r.line.text, 'a');
    assert.equal(r.next.text, 'b');
    assert.equal(r.progress, 0.5);
    const last = s.at(5000);
    assert.equal(last.next, null);
    assert.equal(last.progress, 0);
    const before = s.at(0);
    assert.equal(before.line, null);
  });

  it('update detecta cambios de línea y reset reinicia', () => {
    const s = new LrcSync(lines);
    assert.equal(s.update(1100).changed, true);
    assert.equal(s.update(1500).changed, false);
    assert.equal(s.update(2100).changed, true);
    s.reset();
    assert.equal(s.update(2100).changed, true);
  });

  it('offsetMs desplaza el tiempo de consulta', () => {
    const s = new LrcSync(lines, { offsetMs: 500 });
    assert.equal(s.indexAt(500), 0);
    assert.equal(s.indexAt(400), -1);
    assert.equal(new LrcSync(lines, { offsetMs: 'abc' }).offsetMs, 0);
  });
});

/* ═════════════════════════ LrclibClient: construcción ═════════════════════════ */

describe('LrclibClient: construcción y opciones', () => {
  it('valida baseUrl', () => {
    assert.throws(() => new LrclibClient({ baseUrl: 'no es url' }), ValidationError);
    assert.throws(() => new LrclibClient({ baseUrl: 'ftp://example.com' }), ValidationError);
    assert.throws(() => new LrclibClient({ baseUrl: 'https://user:pw@example.com' }), ValidationError);
  });

  it('quita barras finales de baseUrl', () => {
    assert.equal(new LrclibClient({ baseUrl: 'https://example.com///' }).baseUrl, 'https://example.com');
  });

  it('opciones inválidas caen a valores por defecto seguros', () => {
    const { opts } = new LrclibClient({
      timeout: -5, retries: 99, concurrency: 0, minInterval: 'abc', retryBaseDelay: NaN,
    });
    assert.equal(opts.timeout, 15_000);
    assert.equal(opts.retries, 3);
    assert.equal(opts.concurrency, 1);
    assert.equal(opts.minInterval, 300);
    assert.equal(opts.retryBaseDelay, 600);
  });

  it('acepta opciones nulas', () => {
    assert.doesNotThrow(() => new LrclibClient(null));
    assert.doesNotThrow(() => new LrclibClient({ cache: null }));
    assert.doesNotThrow(() => new LrclibClient({ cache: false }));
  });
});

/* ═════════════════════════ LrclibClient: transporte ═════════════════════════ */

describe('LrclibClient: peticiones y cabeceras', () => {
  it('get() construye la URL y la query correctamente', async () => {
    const { client, fetch } = makeClient(() => rec());
    const r = await client.get({ title: 'Song', artist: 'Artist', album: 'Album', duration: 200 });
    assert.equal(r.id, 1);
    const c = fetch.calls[0];
    assert.equal(c.method, 'GET');
    assert.equal(c.url.pathname, '/api/get');
    assert.equal(c.url.searchParams.get('track_name'), 'Song');
    assert.equal(c.url.searchParams.get('artist_name'), 'Artist');
    assert.equal(c.url.searchParams.get('album_name'), 'Album');
    assert.equal(c.url.searchParams.get('duration'), '200');
  });

  it('omite parámetros vacíos', async () => {
    const { client, fetch } = makeClient(() => rec());
    await client.get({ title: 'Song', artist: 'Artist' });
    assert.equal(fetch.calls[0].url.searchParams.has('album_name'), false);
    assert.equal(fetch.calls[0].url.searchParams.has('duration'), false);
  });

  it('respeta una baseUrl con prefijo de ruta', async () => {
    const { client, fetch } = makeClient(() => rec(), { baseUrl: 'https://example.com/prefix/' });
    await client.getById(1);
    assert.equal(fetch.calls[0].url.origin, 'https://example.com');
    assert.equal(fetch.calls[0].url.pathname, '/prefix/api/get/1');
  });

  it('get() exige title y artist', async () => {
    const { client, fetch } = makeClient(() => rec());
    await rejectsWith(client.get({ title: 'x' }), ValidationError);
    await rejectsWith(client.get({ artist: 'x' }), ValidationError);
    await rejectsWith(client.get(), ValidationError);
    assert.equal(fetch.calls.length, 0);
  });

  it('getById valida el id', async () => {
    const { client, fetch } = makeClient(() => rec());
    for (const bad of [0, -1, 1.5, 'abc', NaN, null]) {
      await rejectsWith(client.getById(bad), ValidationError);
    }
    assert.equal(fetch.calls.length, 0);
    await client.getById('42');
    assert.equal(fetch.calls[0].url.pathname, '/api/get/42');
  });

  it('search con cadena, con objeto y con q; valida entradas', async () => {
    const { client, fetch } = makeClient(() => [rec()]);
    assert.equal((await client.search('  hola  ')).length, 1);
    assert.equal(fetch.calls[0].url.searchParams.get('q'), 'hola');

    await client.search({ trackName: 'Song', artistName: 'Artist' });
    assert.equal(fetch.calls[1].url.searchParams.get('track_name'), 'Song');
    assert.equal(fetch.calls[1].url.searchParams.get('artist_name'), 'Artist');

    await client.search({ q: 'consulta', trackName: 'ignorado' });
    assert.equal(fetch.calls[2].url.searchParams.get('q'), 'consulta');
    assert.equal(fetch.calls[2].url.searchParams.has('track_name'), false);

    await rejectsWith(client.search('   '), ValidationError);
    await rejectsWith(client.search({}), ValidationError);
    await rejectsWith(client.search(null), ValidationError);
  });

  it('searchV2 usa /api/v2/search y siempre devuelve un array', async () => {
    const { client, fetch } = makeClient(() => ({ no: 'array' }));
    assert.deepEqual(await client.searchV2('x'), []);
    assert.equal(fetch.calls[0].url.pathname, '/api/v2/search');
    assert.deepEqual(await client.search('x'), []);
  });

  it('envía User-Agent (Node), Accept, appId y apiKey', async () => {
    const { client, fetch } = makeClient(() => rec(), { appId: 'mi-app', apiKey: 'secreto' });
    await client.getById(1);
    const h = fetch.calls[0].headers;
    assert.equal(h.Accept, 'application/json');
    assert.match(h['User-Agent'], /^LRCLIB\.js\/1\.2\.0/);
    assert.equal(h['Lrclib-App-Id'], 'mi-app');
    assert.equal(h['Lrclib-Api-Key'], 'secreto');
    assert.equal('Lrclib-Client' in h, false);
  });

  it('sanea cabeceras (anti header injection)', async () => {
    const { client, fetch } = makeClient(() => rec(), { userAgent: 'a\r\nX-Evil: 1', appId: 'x\ny' });
    await client.getById(1);
    for (const v of Object.values(fetch.calls[0].headers)) assert.doesNotMatch(v, /[\r\n]/);
    assert.equal(fetch.calls[0].headers['User-Agent'], 'a X-Evil: 1');
  });

  it('devuelve texto si la respuesta no es JSON y null si está vacía', async () => {
    const { client } = makeClient((_, n) => (n === 1 ? new Response('hola', { status: 200 }) : new Response('', { status: 200 })));
    assert.equal(await client.getById(1), 'hola');
    assert.equal(await client.getById(1), null);
  });

  it('emite el evento response', async () => {
    const { client } = makeClient(() => rec());
    const events = [];
    client.on('response', (e) => events.push(e));
    await client.getById(5);
    assert.equal(events.length, 1);
    assert.equal(events[0].method, 'GET');
    assert.equal(events[0].path, '/api/get/5');
    assert.equal(typeof events[0].ms, 'number');
    assert.equal(typeof events[0].requestId, 'number');
  });

  it('rechaza una respuesta fetch inválida', async () => {
    const client = new LrclibClient({ ...BASE_OPTS, fetch: async () => ({}) });
    await rejectsWith(client.getById(1), LrclibError, { code: 'BAD_RESPONSE' });
  });
});

describe('LrclibClient: mapeo de errores HTTP', () => {
  const run = (response) => makeClient(() => response).client.getById(1);

  it('404 => NotFoundError', async () => {
    await rejectsWith(run(notFoundRes()), NotFoundError, { status: 404, code: 'TrackNotFound' });
  });

  it('404 sin cuerpo JSON también es NotFoundError', async () => {
    await rejectsWith(run(new Response('nope', { status: 404 })), NotFoundError);
  });

  it('400 => ValidationError', async () => {
    await rejectsWith(run(jsonRes({ name: 'ValidationError', message: 'mal' }, 400)), ValidationError, { message: 'mal' });
  });

  it('429 => RateLimitError reintentable con retryAfterMs', async () => {
    const e = await run(jsonRes({}, 429, { 'retry-after': '3' })).catch((x) => x);
    assert.ok(e instanceof RateLimitError);
    assert.equal(e.retryable, true);
    assert.equal(e.retryAfterMs, 3000);
  });

  it('401 => AuthError con code Unauthorized', async () => {
    await rejectsWith(run(jsonRes({}, 401)), AuthError, { code: 'Unauthorized' });
  });

  it('IncorrectPublishTokenError => PublishTokenError', async () => {
    await rejectsWith(run(jsonRes({ name: 'IncorrectPublishTokenError', message: 'x' }, 400)), PublishTokenError);
  });

  it('5xx => ServerError; 501/505 no son reintentables', async () => {
    for (const status of [500, 502, 503, 504]) {
      await rejectsWith(run(jsonRes({}, status)), ServerError, { retryable: true, status });
    }
    for (const status of [501, 505]) {
      await rejectsWith(run(jsonRes({}, status)), ServerError, { retryable: false, status });
    }
  });

  it('cuerpo de error en texto plano se usa como mensaje', async () => {
    await rejectsWith(run(new Response('Bad gateway', { status: 502 })), ServerError, { message: 'Bad gateway' });
  });

  it('otros 4xx => LrclibError genérico', async () => {
    const e = await run(jsonRes({}, 418)).catch((x) => x);
    assert.ok(e instanceof LrclibError);
    assert.equal(e.code, 'HTTP_418');
    assert.equal(e.retryable, false);
  });

  it('los errores llevan requestId', async () => {
    const e = await run(notFoundRes()).catch((x) => x);
    assert.equal(typeof e.requestId, 'number');
  });
});

describe('LrclibClient: reintentos', () => {
  it('reintenta un 503 y termina bien; emite retry', async () => {
    const { client, fetch } = makeClient((_, n) => (n === 1 ? jsonRes({}, 503) : rec()), { retries: 2 });
    const retries = [];
    client.on('retry', (e) => retries.push(e));
    const r = await client.getById(1);
    assert.equal(r.id, 1);
    assert.equal(fetch.calls.length, 2);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].attempt, 1);
    assert.equal(retries[0].status, 503);
  });

  it('respeta Retry-After en un 429', async () => {
    const { client, fetch } = makeClient(
      (_, n) => (n === 1 ? jsonRes({}, 429, { 'retry-after': '0' }) : rec()),
      { retries: 1 },
    );
    assert.equal((await client.getById(1)).id, 1);
    assert.equal(fetch.calls.length, 2);
  });

  it('no espera si Retry-After supera maxRetryAfter', async () => {
    const { client, fetch } = makeClient(() => jsonRes({}, 429, { 'retry-after': '5' }), { retries: 3, maxRetryAfter: 1000 });
    await rejectsWith(client.getById(1), RateLimitError);
    assert.equal(fetch.calls.length, 1);
  });

  it('agota los reintentos y lanza el último error', async () => {
    const { client, fetch } = makeClient(() => jsonRes({}, 503), { retries: 2 });
    await rejectsWith(client.getById(1), ServerError);
    assert.equal(fetch.calls.length, 3);
  });

  it('no reintenta errores no reintentables (404, 400, 501)', async () => {
    for (const res of [notFoundRes, () => jsonRes({}, 400), () => jsonRes({}, 501)]) {
      const { client, fetch } = makeClient(res, { retries: 3 });
      await client.getById(1).catch(() => {});
      assert.equal(fetch.calls.length, 1);
    }
  });

  it('reintenta errores de red', async () => {
    const { client, fetch } = makeClient((_, n) => { if (n === 1) throw new Error('boom'); return rec(); }, { retries: 1 });
    assert.equal((await client.getById(1)).id, 1);
    assert.equal(fetch.calls.length, 2);
  });

  it('error de red sin reintentos => NetworkError con cause', async () => {
    const { client } = makeClient(() => { throw new Error('ECONNRESET'); });
    const e = await client.getById(1).catch((x) => x);
    assert.ok(e instanceof NetworkError);
    assert.match(e.message, /ECONNRESET/);
    assert.equal(e.cause.message, 'ECONNRESET');
  });
});

describe('LrclibClient: timeout, abort y tamaño', () => {
  it('timeout => TimeoutError', async () => {
    const { client } = makeClient((call) => hangUntilAbort(call.signal), { timeout: 30 });
    await rejectsWith(client.getById(1), TimeoutError, { retryable: true });
  });

  it('timeout reintentable se reintenta', async () => {
    const { client, fetch } = makeClient(
      (call, n) => (n === 1 ? hangUntilAbort(call.signal) : rec()),
      { timeout: 30, retries: 1 },
    );
    assert.equal((await client.getById(1)).id, 1);
    assert.equal(fetch.calls.length, 2);
  });

  it('señal ya abortada => AbortedError sin llamar a fetch', async () => {
    const { client, fetch } = makeClient(() => rec());
    const ac = new AbortController();
    ac.abort();
    await rejectsWith(client.getById(1, { signal: ac.signal }), AbortedError);
    assert.equal(fetch.calls.length, 0);
  });

  it('abortar durante la petición => AbortedError (no se reintenta)', async () => {
    const { client, fetch } = makeClient((call) => delay(500, call.signal), { retries: 3 });
    const ac = new AbortController();
    const p = client.getById(1, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await rejectsWith(p, AbortedError);
    assert.equal(fetch.calls.length, 1);
  });

  it('abortar durante la espera entre reintentos', async () => {
    const { client } = makeClient(() => jsonRes({}, 503), { retries: 3, retryBaseDelay: 5000, maxRetryAfter: 10_000 });
    const ac = new AbortController();
    const p = client.getById(1, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    await rejectsWith(p, AbortedError);
  });

  it('rechaza por content-length declarado excesivo', async () => {
    const { client } = makeClient(
      () => new Response('{}', { status: 200, headers: { 'content-length': '999999' } }),
      { maxResponseBytes: 2048 },
    );
    await rejectsWith(client.getById(1), ResponseTooLargeError, { retryable: false });
  });

  it('rechaza por tope real de bytes en streaming (sin content-length)', async () => {
    const { client } = makeClient(() => new Response('x'.repeat(5000), { status: 200 }), { maxResponseBytes: 2048 });
    await rejectsWith(client.getById(1), ResponseTooLargeError);
  });

  it('acepta cuerpos dentro del límite', async () => {
    const { client } = makeClient(() => new Response('y'.repeat(1000), { status: 200 }), { maxResponseBytes: 2048 });
    assert.equal((await client.getById(1)).length, 1000);
  });
});

describe('LrclibClient: scheduler', () => {
  it('con concurrency=1 las peticiones se serializan', async () => {
    let active = 0, max = 0;
    const { client } = makeClient(async () => {
      active++; max = Math.max(max, active);
      await delay(15);
      active--;
      return rec();
    });
    await Promise.all([1, 2, 3, 4, 5].map((i) => client.getById(i)));
    assert.equal(max, 1);
  });

  it('con concurrency=3 hay paralelismo acotado', async () => {
    let active = 0, max = 0;
    const { client } = makeClient(async () => {
      active++; max = Math.max(max, active);
      await delay(30);
      active--;
      return rec();
    }, { concurrency: 3 });
    await Promise.all([1, 2, 3, 4, 5, 6].map((i) => client.getById(i)));
    assert.ok(max >= 2 && max <= 3, `max=${max}`);
  });

  it('minInterval separa las peticiones', async () => {
    const stamps = [];
    const { client } = makeClient(() => { stamps.push(performance.now()); return rec(); }, { minInterval: 60 });
    await Promise.all([client.getById(1), client.getById(2)]);
    assert.ok(stamps[1] - stamps[0] >= 50, `delta=${stamps[1] - stamps[0]}`);
  });

  it('una tarea encolada se rechaza al abortar sin esperar su turno', async () => {
    const { client, fetch } = makeClient(async (call) => { await delay(80, call.signal); return rec(); });
    const ac = new AbortController();
    const first = client.getById(1);
    const second = client.getById(2, { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const started = performance.now();
    await rejectsWith(second, AbortedError);
    assert.ok(performance.now() - started < 60, 'debe rechazar antes de que termine la primera');
    await first;
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url.pathname, '/api/get/1');
  });
});

describe('LrclibClient: circuit breaker', () => {
  it('se abre tras N fallos reintentables y bloquea sin llamar a fetch', async () => {
    const { client, fetch } = makeClient(() => jsonRes({}, 503), { circuitBreaker: { threshold: 2, cooldownMs: 60_000 } });
    await client.getById(1).catch(() => {});
    await client.getById(1).catch(() => {});
    assert.equal(fetch.calls.length, 2);
    await rejectsWith(client.getById(1), LrclibError, { code: 'CIRCUIT_OPEN' });
    assert.equal(fetch.calls.length, 2);
  });

  it('los 404 y errores de cliente no cuentan como fallos', async () => {
    const { client, fetch } = makeClient(notFoundRes, { circuitBreaker: { threshold: 2 } });
    for (let i = 0; i < 5; i++) await client.getById(1).catch(() => {});
    assert.equal(fetch.calls.length, 5);
  });

  it('un éxito reinicia la cuenta de fallos', async () => {
    const { client } = makeClient((_, n) => (n === 2 ? rec() : jsonRes({}, 503)), { circuitBreaker: { threshold: 2 } });
    await client.getById(1).catch(() => {}); // fallo 1
    await client.getById(1);                  // éxito => reinicia
    await client.getById(1).catch(() => {}); // fallo 1 de nuevo
    await rejectsWith(client.getById(1), ServerError); // sigue cerrado (2.º fallo abre al terminar)
  });

  it('clearCache() reinicia el circuito', async () => {
    const { client, fetch } = makeClient(() => jsonRes({}, 503), { circuitBreaker: { threshold: 1, cooldownMs: 60_000 } });
    await client.getById(1).catch(() => {});
    await rejectsWith(client.getById(1), LrclibError, { code: 'CIRCUIT_OPEN' });
    client.clearCache();
    await rejectsWith(client.getById(1), ServerError);
    assert.equal(fetch.calls.length, 2);
  });

  it('está desactivado por defecto', async () => {
    const { client, fetch } = makeClient(() => jsonRes({}, 503));
    for (let i = 0; i < 15; i++) await client.getById(1).catch(() => {});
    assert.equal(fetch.calls.length, 15);
  });
});

describe('Emitter (vía LrclibClient)', () => {
  it('on devuelve un desuscriptor y off funciona', () => {
    const { client } = makeClient(() => rec());
    let n = 0;
    const off = client.on('x', () => n++);
    client.emit('x');
    off();
    client.emit('x');
    assert.equal(n, 1);
  });

  it('el comodín * recibe el nombre del evento y el payload', () => {
    const { client } = makeClient(() => rec());
    const seen = [];
    client.on('*', (e) => seen.push(e));
    client.emit('a', { v: 1 });
    client.emit('b', 5);
    assert.deepEqual(seen, [{ event: 'a', v: 1 }, { event: 'b', payload: 5 }]);
  });

  it('un listener que lanza no rompe a los demás', () => {
    const { client } = makeClient(() => rec());
    let ok = false;
    client.on('x', () => { throw new Error('roto'); });
    client.on('x', () => { ok = true; });
    assert.doesNotThrow(() => client.emit('x'));
    assert.equal(ok, true);
  });

  it('un listener puede desuscribirse durante el emit', () => {
    const { client } = makeClient(() => rec());
    const calls = [];
    const off = client.on('x', () => { calls.push('a'); off(); });
    client.on('x', () => calls.push('b'));
    client.emit('x');
    client.emit('x');
    assert.deepEqual(calls, ['a', 'b', 'b']);
  });

  it('on con un no-función devuelve un desuscriptor inofensivo', () => {
    const { client } = makeClient(() => rec());
    assert.doesNotThrow(() => client.on('x', null)());
  });
});

/* ═════════════════════════ findLyrics ═════════════════════════ */

describe('findLyrics', () => {
  const QUERY = { title: 'Song', artist: 'Artist', album: 'Album', duration: 200 };

  it('valida title y artist', async () => {
    const { client } = makeClient(lyricsHandler());
    await rejectsWith(client.findLyrics({ title: 'x' }), ValidationError);
    await rejectsWith(client.findLyrics({}), ValidationError);
  });

  it('encuentra por /api/get (con álbum primero)', async () => {
    const { client, fetch } = makeClient(lyricsHandler());
    const r = await client.findLyrics(QUERY);
    assert.equal(r.via, 'get');
    assert.equal(r.record.id, 1);
    assert.equal(r.cached, false);
    assert.equal(r.requests, 1);
    assert.equal(fetch.calls[0].url.searchParams.get('album_name'), 'Album');
    assert.equal(fetch.calls[0].url.searchParams.get('duration'), '200');
  });

  it('segunda llamada sale de caché; bypassCache fuerza la red', async () => {
    const { client, fetch } = makeClient(lyricsHandler());
    await client.findLyrics(QUERY);
    const n = fetch.calls.length;
    const again = await client.findLyrics(QUERY);
    assert.equal(again.cached, true);
    assert.equal(fetch.calls.length, n);
    const fresh = await client.findLyrics(QUERY, { bypassCache: true });
    assert.equal(fresh.cached, false);
    assert.ok(fetch.calls.length > n);
  });

  it('la clave de caché incluye las opciones de búsqueda', async () => {
    const { client, fetch } = makeClient(lyricsHandler());
    await client.findLyrics(QUERY);
    const n = fetch.calls.length;
    await client.findLyrics(QUERY, { preferSynced: false });
    assert.ok(fetch.calls.length > n, 'otra opción => otra entrada de caché');
  });

  it('el resultado en caché no es mutable por el llamador', async () => {
    const { client } = makeClient(lyricsHandler());
    const first = await client.findLyrics(QUERY);
    first.via = 'manipulado';
    assert.equal((await client.findLyrics(QUERY)).via, 'get');
  });

  it('cae a /api/search cuando get no encuentra', async () => {
    const { client, fetch } = makeClient(lyricsHandler({
      getResult: null,
      searchResult: [
        rec({ id: 6, trackName: 'Something Else', artistName: 'Other Band' }),
        rec({ id: 5 }),
      ],
    }));
    const r = await client.findLyrics(QUERY);
    assert.equal(r.via, 'search');
    assert.equal(r.record.id, 5);
    assert.ok(r.score > 0.72);
    const search = fetch.calls.find((c) => c.url.pathname === '/api/search');
    assert.equal(search.url.searchParams.get('q'), 'Artist Song');
  });

  it('segunda búsqueda estructurada si la primera no da candidatos', async () => {
    let searches = 0;
    const { client, fetch } = makeClient((call) => {
      if (call.url.pathname === '/api/get') return notFoundRes();
      searches++;
      return searches === 1 ? [] : [rec({ id: 9 })];
    });
    const r = await client.findLyrics({ title: 'Song', artist: 'Artist', duration: 200 });
    assert.equal(r.record.id, 9);
    assert.equal(r.requests, 3);
    const second = fetch.calls.filter((c) => c.url.pathname === '/api/search')[1];
    assert.equal(second.url.searchParams.get('track_name'), 'Song');
    assert.equal(second.url.searchParams.get('artist_name'), 'Artist');
  });

  it('prueba con el título limpio (sin feat./remaster)', async () => {
    const { client, fetch } = makeClient((call) =>
      call.url.pathname === '/api/get' && call.url.searchParams.get('track_name') === 'Song' ? rec() : notFoundRes());
    const r = await client.findLyrics({ title: 'Song (feat. Guest)', artist: 'Artist', duration: 200 });
    assert.equal(r.via, 'get');
    assert.ok(fetch.calls.some((c) => c.url.searchParams.get('track_name') === 'Song (feat. Guest)'));
  });

  it('descarta candidatos con duración muy distinta', async () => {
    const { client } = makeClient(lyricsHandler({ getResult: null, searchResult: [rec({ duration: 300 })] }));
    assert.equal(await client.findLyrics(QUERY), null);
  });

  it('preferSynced reemplaza un registro sin sincronizar por uno sincronizado', async () => {
    const { client } = makeClient(lyricsHandler({
      getResult: rec({ id: 1, syncedLyrics: null }),
      searchResult: [rec({ id: 2, syncedLyrics: '[00:01.00]sync' })],
    }));
    const r = await client.findLyrics(QUERY);
    assert.equal(r.record.id, 2);
    assert.equal(r.via, 'search');
  });

  it('preferSynced=false conserva el registro de get', async () => {
    const { client } = makeClient(lyricsHandler({
      getResult: rec({ id: 1, syncedLyrics: null }),
      searchResult: [rec({ id: 2 })],
    }));
    const r = await client.findLyrics(QUERY, { preferSynced: false });
    assert.equal(r.record.id, 1);
  });

  it('un registro instrumental no se busca en sincronizado', async () => {
    const { client, fetch } = makeClient(lyricsHandler({ getResult: rec({ instrumental: true, syncedLyrics: null, plainLyrics: null }) }));
    const r = await client.findLyrics(QUERY);
    assert.equal(r.record.instrumental, true);
    assert.equal(fetch.count('/api/search'), 0);
  });

  it('miss: devuelve null, emite miss y lo cachea', async () => {
    const { client, fetch } = makeClient(lyricsHandler({ getResult: null, searchResult: [] }));
    const misses = [];
    client.on('miss', (e) => misses.push(e));
    assert.equal(await client.findLyrics(QUERY), null);
    assert.equal(misses.length, 1);
    assert.equal(misses[0].track.title, 'Song');
    const n = fetch.calls.length;
    assert.equal(await client.findLyrics(QUERY), null);
    assert.equal(fetch.calls.length, n, 'el miss se sirve de caché');
  });

  it('no cachea un miss cuando se agotó el presupuesto de peticiones', async () => {
    const { client, fetch } = makeClient(lyricsHandler({ getResult: null, searchResult: [] }));
    const q = { title: 'Song', artist: 'Artist' };
    assert.equal(await client.findLyrics(q, { maxRequests: 1 }), null);
    const n = fetch.calls.length;
    assert.equal(n, 1);
    await client.findLyrics(q, { maxRequests: 1 });
    assert.equal(fetch.calls.length, n + 1, 'no hubo miss cacheado');
  });

  it('respeta maxRequests', async () => {
    const { client, fetch } = makeClient(lyricsHandler({ getResult: null, searchResult: [] }));
    await client.findLyrics(QUERY, { maxRequests: 2 });
    assert.equal(fetch.calls.length, 2);
  });

  it('errores no-404 se propagan', async () => {
    const { client } = makeClient(() => jsonRes({}, 500));
    await rejectsWith(client.findLyrics(QUERY), ServerError);
  });

  it('señal abortada => AbortedError', async () => {
    const { client } = makeClient(lyricsHandler());
    const ac = new AbortController();
    ac.abort();
    await rejectsWith(client.findLyrics(QUERY, { signal: ac.signal }), AbortedError);
  });

  it('cache:false desactiva la caché', async () => {
    const { client, fetch } = makeClient(lyricsHandler(), { cache: false });
    await client.findLyrics(QUERY);
    const n = fetch.calls.length;
    await client.findLyrics(QUERY);
    assert.ok(fetch.calls.length > n);
  });
});

/* ═════════════════════════ Publicación ═════════════════════════ */

describe('publish / flag', () => {
  const CHALLENGE = { prefix: 'pre', target: 'f'.repeat(64) };
  const DATA = { trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 200 };

  const publishHandler = (publishRes = () => new Response('', { status: 201 })) => (call, n) => {
    if (call.url.pathname === '/api/request-challenge') return CHALLENGE;
    if (call.url.pathname === '/api/publish' || call.url.pathname === '/api/flag') return publishRes(call, n);
    return notFoundRes();
  };

  it('requestChallenge hace POST a /api/request-challenge', async () => {
    const { client, fetch } = makeClient(publishHandler());
    assert.deepEqual(await client.requestChallenge(), CHALLENGE);
    assert.equal(fetch.calls[0].method, 'POST');
  });

  it('getPublishToken resuelve el desafío', async () => {
    const { client } = makeClient(publishHandler());
    assert.equal(await client.getPublishToken(), 'pre:0');
  });

  it('getPublishToken rechaza desafíos inválidos', async () => {
    const bad = makeClient(() => ({ prefix: '', target: 'ff' })).client;
    await rejectsWith(bad.getPublishToken(), LrclibError, { code: 'BAD_CHALLENGE' });
    const badTarget = makeClient(() => ({ prefix: 'a', target: 'zz' })).client;
    await rejectsWith(badTarget.getPublishToken(), LrclibError, { code: 'BAD_TARGET' });
  });

  it('publica letra sincronizada y deriva la plana', async () => {
    const { client, fetch } = makeClient(publishHandler());
    const out = await client.publish({ ...DATA, syncedLyrics: '[00:01.00]hello\n[00:02.00]world' });
    assert.deepEqual(out, { ok: true });
    const call = fetch.calls.find((c) => c.url.pathname === '/api/publish');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['X-Publish-Token'], 'pre:0');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.deepEqual(call.body, {
      trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 200,
      syncedLyrics: '[00:01.00]hello\n[00:02.00]world',
      plainLyrics: 'hello\nworld',
    });
  });

  it('usa plainLyrics explícita cuando se da', async () => {
    const { client, fetch } = makeClient(publishHandler());
    await client.publish({ ...DATA, plainLyrics: 'solo plana' });
    const body = fetch.calls.find((c) => c.url.pathname === '/api/publish').body;
    assert.equal(body.plainLyrics, 'solo plana');
    assert.equal(body.syncedLyrics, undefined);
    assert.equal(body.instrumental, undefined);
  });

  it('sin letras publica como instrumental', async () => {
    const { client, fetch } = makeClient(publishHandler());
    await client.publish(DATA);
    assert.equal(fetch.calls.find((c) => c.url.pathname === '/api/publish').body.instrumental, true);
  });

  it('lyricsfile excluye los demás campos de letra', async () => {
    const { client, fetch } = makeClient(publishHandler());
    await client.publish({ ...DATA, lyricsfile: 'contenido', plainLyrics: 'x' });
    const body = fetch.calls.find((c) => c.url.pathname === '/api/publish').body;
    assert.equal(body.lyricsfile, 'contenido');
    assert.equal('plainLyrics' in body, false);
    assert.equal('instrumental' in body, false);
  });

  it('acepta alias de campos y milisegundos', async () => {
    const { client, fetch } = makeClient(publishHandler());
    await client.publish({ track_name: 'Song', artist_name: 'Artist', album_name: 'Album', durationMs: 200_000, plainLyrics: 'x' });
    const body = fetch.calls.find((c) => c.url.pathname === '/api/publish').body;
    assert.equal(body.duration, 200);
    assert.equal(body.albumName, 'Album');
  });

  it('valida los campos obligatorios antes de tocar la red', async () => {
    const { client, fetch } = makeClient(publishHandler());
    await rejectsWith(client.publish(null), ValidationError);
    await rejectsWith(client.publish({ ...DATA, albumName: '' }), ValidationError);
    await rejectsWith(client.publish({ ...DATA, duration: 0 }), ValidationError);
    await rejectsWith(client.publish({ ...DATA, artistName: undefined }), ValidationError);
    assert.equal(fetch.calls.length, 0);
  });

  it('rechaza letras que exceden el tamaño máximo', async () => {
    const { client, fetch } = makeClient(publishHandler());
    const huge = 'a'.repeat(LIMITS.LRC_BYTES + 1);
    await rejectsWith(client.publish({ ...DATA, syncedLyrics: `[00:01.00]${huge}` }), ValidationError);
    await rejectsWith(client.publish({ ...DATA, plainLyrics: huge }), ValidationError);
    await rejectsWith(client.publish({ ...DATA, lyricsfile: huge }), ValidationError);
    assert.equal(fetch.calls.length, 0);
  });

  it('vacía la caché tras publicar', async () => {
    const { client } = makeClient(publishHandler());
    client.cache.set('k', 1);
    await client.publish(DATA);
    assert.equal(client.cache.size, 0);
  });

  it('reintenta una vez con un token nuevo si el token era incorrecto', async () => {
    const { client, fetch } = makeClient(publishHandler((_, n) =>
      (fetch_publishes(n) === 1
        ? jsonRes({ name: 'IncorrectPublishTokenError', message: 'bad' }, 400)
        : new Response('', { status: 201 }))));
    // n cuenta todas las llamadas; los publishes son las llamadas pares tras cada desafío.
    function fetch_publishes(n) { return n === 2 ? 1 : 2; }
    assert.deepEqual(await client.publish(DATA), { ok: true });
    assert.equal(fetch.count('/api/request-challenge'), 2);
    assert.equal(fetch.count('/api/publish'), 2);
  });

  it('si el token vuelve a fallar, lanza PublishTokenError', async () => {
    const { client, fetch } = makeClient(publishHandler(() =>
      jsonRes({ name: 'IncorrectPublishTokenError', message: 'bad' }, 400)));
    await rejectsWith(client.publish(DATA), PublishTokenError);
    assert.equal(fetch.count('/api/publish'), 2);
  });

  it('un 5xx al publicar NO se reintenta (evita duplicados)', async () => {
    const { client, fetch } = makeClient(publishHandler(() => jsonRes({}, 503)), { retries: 3 });
    await rejectsWith(client.publish(DATA), ServerError);
    assert.equal(fetch.count('/api/publish'), 1);
  });

  it('flag envía trackId y content con el token', async () => {
    const { client, fetch } = makeClient(publishHandler());
    assert.deepEqual(await client.flag(5, 'spam'), { ok: true });
    const call = fetch.calls.find((c) => c.url.pathname === '/api/flag');
    assert.deepEqual(call.body, { trackId: 5, content: 'spam' });
    assert.equal(call.headers['X-Publish-Token'], 'pre:0');

    await client.flag('7');
    const second = fetch.calls.filter((c) => c.url.pathname === '/api/flag')[1];
    assert.deepEqual(second.body, { trackId: 7 });
  });

  it('flag valida trackId y no hace peticiones si es inválido', async () => {
    const { client, fetch } = makeClient(publishHandler());
    for (const bad of [0, -3, 'abc', 1.5, NaN]) await rejectsWith(client.flag(bad), ValidationError);
    assert.equal(fetch.calls.length, 0);
  });

  it('flag no reintenta un 5xx', async () => {
    const { client, fetch } = makeClient(publishHandler(() => jsonRes({}, 500)), { retries: 3 });
    await rejectsWith(client.flag(1), ServerError);
    assert.equal(fetch.count('/api/flag'), 1);
  });
});

/* ═════════════════════════ LyricsManager ═════════════════════════ */

describe('LyricsManager.candidatePaths', () => {
  const mgr = (opts = {}) => new LyricsManager({ client: { ...BASE_OPTS, fetch: async () => jsonRes({}) }, fs: memFs(), ...opts });

  it('lrcPath tiene prioridad absoluta', () => {
    assert.deepEqual(mgr({ resolvePath: () => '/x.lrc' }).candidatePaths({ lrcPath: '/a/b.lrc', filePath: '/c.mp3' }), ['/a/b.lrc']);
  });

  it('junto al archivo de audio', () => {
    const m = mgr();
    assert.deepEqual(m.candidatePaths({ filePath: '/music/a/song.mp3' }), ['/music/a/song.lrc']);
    assert.deepEqual(m.candidatePaths({ filePath: 'song.mp3' }), ['song.lrc']);
    assert.deepEqual(m.candidatePaths({ path: '/m/x.flac' }), ['/m/x.lrc']);
    assert.deepEqual(m.candidatePaths({ file: '/m/y.ogg' }), ['/m/y.lrc']);
  });

  it('rutas en la raíz no duplican la barra', () => {
    assert.deepEqual(mgr().candidatePaths({ filePath: '/x.mp3' }), ['/x.lrc']);
  });

  it('rutas de Windows conservan los separadores', () => {
    assert.deepEqual(mgr().candidatePaths({ filePath: 'C:\\Music\\song.mp3' }), ['C:\\Music\\song.lrc']);
  });

  it('lyricsDir añade rutas centralizadas después de la contigua', () => {
    const paths = mgr({ lyricsDir: '/lyr' }).candidatePaths({ filePath: '/m/song.mp3', title: 'Song', artist: 'Artist' });
    assert.deepEqual(paths, ['/m/song.lrc', '/lyr/song.lrc', '/lyr/Artist - Song.lrc']);
  });

  it('preferLyricsDir invierte el orden', () => {
    const paths = mgr({ lyricsDir: '/lyr', preferLyricsDir: true }).candidatePaths({ filePath: '/m/song.mp3', title: 'Song', artist: 'Artist' });
    assert.deepEqual(paths, ['/lyr/song.lrc', '/lyr/Artist - Song.lrc', '/m/song.lrc']);
  });

  it('lyricsDir sin archivo usa "Artista - Título.lrc"', () => {
    assert.deepEqual(mgr({ lyricsDir: 'lyrics' }).candidatePaths({ title: 'Song', artist: 'Artist' }), ['lyrics/Artist - Song.lrc']);
    assert.deepEqual(mgr({ lyricsDir: 'C:\\L' }).candidatePaths({ title: 'S', artist: 'A' }), ['C:\\L\\A - S.lrc']);
    assert.deepEqual(mgr({ lyricsDir: '/lyr/' }).candidatePaths({ title: 'S', artist: 'A' }), ['/lyr/A - S.lrc']);
  });

  it('sanea nombres de archivo en lyricsDir', () => {
    const paths = mgr({ lyricsDir: '/lyr' }).candidatePaths({ title: 'AC/DC: Live?', artist: 'Band*' });
    assert.deepEqual(paths, ['/lyr/Band_ - AC_DC_ Live_.lrc']);
  });

  it('resolvePath acepta cadena o array y filtra vacíos', () => {
    assert.deepEqual(mgr({ resolvePath: (t) => `/x/${t.title}.lrc` }).candidatePaths({ title: 'S' }), ['/x/S.lrc']);
    assert.deepEqual(mgr({ resolvePath: () => ['/a.lrc', '', null, '/b.lrc'] }).candidatePaths({ title: 'S' }), ['/a.lrc', '/b.lrc']);
  });

  it('track inválido => ValidationError', () => {
    assert.throws(() => mgr().candidatePaths(null), ValidationError);
    assert.throws(() => mgr().candidatePaths('x'), ValidationError);
  });

  it('sin información suficiente devuelve lista vacía', () => {
    assert.deepEqual(mgr().candidatePaths({ title: 'S', artist: 'A' }), []);
  });
});

describe('LyricsManager.ensure', () => {
  const SYNCED = '[00:01.00]hello\r\n[00:02.00]world';

  it('usa el archivo local si existe (sin red)', async () => {
    const fs = memFs({ '/music/song.lrc': '[00:01.00]local' });
    const { manager, fetch } = makeManager(lyricsHandler(), { fs });
    const r = await manager.ensure(TRACK);
    assert.equal(r.status, 'local');
    assert.equal(r.path, '/music/song.lrc');
    assert.equal(r.text, '[00:01.00]local');
    assert.equal(fetch.calls.length, 0);
  });

  it('ignora archivos locales vacíos o en blanco', async () => {
    const fs = memFs({ '/music/song.lrc': '  \n ' });
    const { manager } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: '[00:01.00]x' }) }), { fs });
    assert.equal((await manager.ensure(TRACK)).status, 'downloaded');
  });

  it('descarga, normaliza CRLF y guarda el .lrc', async () => {
    const { manager, fs } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: SYNCED }) }));
    const r = await manager.ensure(TRACK);
    assert.equal(r.status, 'downloaded');
    assert.equal(r.via, 'get');
    assert.equal(r.path, '/music/song.lrc');
    assert.equal(r.text, '[00:01.00]hello\n[00:02.00]world\n');
    assert.equal(fs.files.get('/music/song.lrc'), r.text);
    assert.equal(r.record.id, 1);
  });

  it('tagHeader añade metadatos sin duplicar los existentes', async () => {
    const { manager } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: '[00:01.00]hello' }) }), { tagHeader: true });
    const r = await manager.ensure(TRACK);
    assert.equal(r.text, '[ti:Song]\n[ar:Artist]\n[al:Album]\n[length:03:20]\n[by:LRCLIB]\n[00:01.00]hello\n');

    const { manager: m2 } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: '[ti:Custom]\n[by:me]\n[00:01.00]hi' }) }), { tagHeader: true });
    const t = (await m2.ensure(TRACK)).text;
    assert.equal((t.match(/\[ti:/g) || []).length, 1);
    assert.equal((t.match(/\[by:/g) || []).length, 1);
    assert.match(t, /\[ar:Artist\]/);
  });

  it('solo letra plana => unsynced (sin escribir por defecto)', async () => {
    const { manager, fs } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: null, plainLyrics: 'l1\nl2' }) }));
    const r = await manager.ensure(TRACK);
    assert.equal(r.status, 'unsynced');
    assert.equal(r.text, 'l1\nl2');
    assert.equal(r.path, undefined);
    assert.equal(fs.files.size, 0);
  });

  it('saveUnsynced="txt" guarda un .txt', async () => {
    const { manager, fs } = makeManager(
      lyricsHandler({ getResult: rec({ syncedLyrics: null, plainLyrics: 'l1\r\nl2' }) }),
      { saveUnsynced: 'txt' },
    );
    const r = await manager.ensure(TRACK);
    assert.equal(r.status, 'unsynced');
    assert.equal(r.path, '/music/song.txt');
    assert.equal(fs.files.get('/music/song.txt'), 'l1\nl2');
  });

  it('instrumental: sin archivo por defecto, con marcador si se pide', async () => {
    const instr = rec({ instrumental: true, syncedLyrics: null, plainLyrics: null });
    const a = makeManager(lyricsHandler({ getResult: instr }));
    const r1 = await a.manager.ensure(TRACK);
    assert.equal(r1.status, 'instrumental');
    assert.equal(a.fs.files.size, 0);

    const b = makeManager(lyricsHandler({ getResult: instr }), { writeInstrumentalMarker: true });
    const r2 = await b.manager.ensure(TRACK);
    assert.equal(r2.status, 'instrumental');
    assert.equal(r2.text, '[00:00.00] ♪ Instrumental ♪\n');
    assert.equal(b.fs.files.get('/music/song.lrc'), r2.text);
  });

  it('not-found cuando no hay resultados o el registro no tiene letra', async () => {
    const a = makeManager(lyricsHandler({ getResult: null }));
    assert.equal((await a.manager.ensure(TRACK)).status, 'not-found');

    const b = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: '', plainLyrics: '' }) }));
    const r = await b.manager.ensure(TRACK);
    assert.equal(r.status, 'not-found');
    assert.equal(r.record.id, 1);
  });

  it('force ignora el archivo local y la caché', async () => {
    const fs = memFs({ '/music/song.lrc': '[00:01.00]viejo' });
    const { manager, fetch } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: '[00:01.00]nuevo' }) }), { fs });
    const r = await manager.ensure(TRACK, { force: true });
    assert.equal(r.status, 'downloaded');
    assert.equal(fs.files.get('/music/song.lrc'), '[00:01.00]nuevo\n');
    assert.ok(fetch.calls.length > 0);
  });

  it('errores de red => status "error" (no lanza) y emite error', async () => {
    const { manager } = makeManager(() => jsonRes({}, 500));
    const events = [];
    manager.on('error', (e) => events.push(e));
    const r = await manager.ensure(TRACK);
    assert.equal(r.status, 'error');
    assert.ok(r.error instanceof ServerError);
    assert.equal(events.length, 1);
    assert.equal(events[0].track, TRACK);
  });

  it('throwOnError relanza el error', async () => {
    const { manager } = makeManager(() => jsonRes({}, 500), { throwOnError: true });
    await rejectsWith(manager.ensure(TRACK), ServerError);
  });

  it('falta de datos (sin rutas / sin title-artist / track nulo) => error por resultado', async () => {
    const { manager } = makeManager(lyricsHandler());
    const noPath = await manager.ensure({ title: 'S', artist: 'A' });
    assert.equal(noPath.status, 'error');
    assert.ok(noPath.error instanceof ValidationError);

    const noMeta = await manager.ensure({ filePath: '/m/x.mp3' });
    assert.equal(noMeta.status, 'error');

    const nul = await manager.ensure(null);
    assert.equal(nul.status, 'error');
  });

  it('un fallo de lectura del archivo local se reporta como error', async () => {
    const fs = memFs({ '/music/song.lrc': 'x' });
    fs.readText = async () => { throw new Error('EACCES'); };
    const { manager } = makeManager(lyricsHandler(), { fs });
    assert.equal((await manager.ensure(TRACK)).status, 'error');
  });

  it('abortar siempre lanza AbortedError (aun sin throwOnError)', async () => {
    const { manager } = makeManager(lyricsHandler());
    const ac = new AbortController();
    ac.abort();
    await rejectsWith(manager.ensure(TRACK, { signal: ac.signal }), AbortedError);
  });

  it('deduplica llamadas concurrentes a la misma ruta', async () => {
    const { manager, fetch } = makeManager(async (call) => {
      await delay(30);
      return lyricsHandler()(call);
    });
    const [a, b, c] = await Promise.all([manager.ensure(TRACK), manager.ensure(TRACK), manager.ensure(TRACK)]);
    assert.equal(fetch.count('/api/get'), 1);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    // Tras terminar, ya no hay una promesa en vuelo: la siguiente llamada lee el archivo local.
    assert.equal((await manager.ensure(TRACK)).status, 'local');
  });

  it('emite un evento por estado con el track', async () => {
    const { manager } = makeManager(lyricsHandler());
    const seen = [];
    manager.on('downloaded', (e) => seen.push(e));
    await manager.ensure(TRACK);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].status, 'downloaded');
    assert.equal(seen[0].track, TRACK);
  });

  it('reenvía los eventos retry del cliente', async () => {
    const { manager } = makeManager(
      (call, n) => (n === 1 ? jsonRes({}, 503) : lyricsHandler()(call)),
      { client: { retries: 1 } },
    );
    const retries = [];
    manager.on('retry', (e) => retries.push(e));
    assert.equal((await manager.ensure(TRACK)).status, 'downloaded');
    assert.equal(retries.length, 1);
  });

  describe('inflightTimeout', () => {
    it('devuelve status "error" con TimeoutError', async () => {
      const { manager } = makeManager(async (call) => { await delay(150, call.signal); return rec(); }, { inflightTimeout: 25 });
      const r = await manager.ensure(TRACK);
      assert.equal(r.status, 'error');
      assert.ok(r.error instanceof TimeoutError);
    });

    it('con throwOnError rechaza con TimeoutError', async () => {
      const { manager } = makeManager(async (call) => { await delay(150, call.signal); return rec(); }, { inflightTimeout: 25, throwOnError: true });
      await rejectsWith(manager.ensure(TRACK), TimeoutError);
    });

    it('si termina a tiempo no interfiere', async () => {
      const { manager } = makeManager(lyricsHandler(), { inflightTimeout: 5000 });
      assert.equal((await manager.ensure(TRACK)).status, 'downloaded');
    });
  });
});

describe('LyricsManager.load', () => {
  it('devuelve el LRC parseado al descargar', async () => {
    const { manager } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: '[00:01.00]a\n[00:02.00]b' }) }));
    const r = await manager.load(TRACK);
    assert.equal(r.status, 'downloaded');
    assert.equal(r.parsed.lines.length, 2);
    assert.equal(r.parsed.synced, true);
  });

  it('parsea también el archivo local', async () => {
    const fs = memFs({ '/music/song.lrc': '[ti:T]\n[00:01.00]x' });
    const { manager } = makeManager(lyricsHandler(), { fs });
    const r = await manager.load(TRACK);
    assert.equal(r.status, 'local');
    assert.equal(r.parsed.meta.ti, 'T');
  });

  it('parsed es null sin letra sincronizada', async () => {
    const { manager } = makeManager(lyricsHandler({ getResult: rec({ syncedLyrics: null, plainLyrics: 'x' }) }));
    const r = await manager.load(TRACK);
    assert.equal(r.status, 'unsynced');
    assert.equal(r.parsed, null);
  });

  it('un LRC que no se puede parsear => status "error" sin lanzar', async () => {
    const fs = memFs({ '/music/song.lrc': 'a'.repeat(LIMITS.LRC_BYTES + 1) });
    const { manager } = makeManager(lyricsHandler(), { fs });
    const events = [];
    manager.on('error', (e) => events.push(e));
    const r = await manager.load(TRACK);
    assert.equal(r.status, 'error');
    assert.ok(r.error instanceof ValidationError);
    assert.equal(r.parsed, null);
    assert.equal(events.length, 1);
  });

  it('con throwOnError el fallo de parseo se lanza', async () => {
    const fs = memFs({ '/music/song.lrc': 'a'.repeat(LIMITS.LRC_BYTES + 1) });
    const { manager } = makeManager(lyricsHandler(), { fs, throwOnError: true });
    await rejectsWith(manager.load(TRACK), ValidationError);
  });

  it('propaga errores de ensure como resultado', async () => {
    const { manager } = makeManager(() => jsonRes({}, 500));
    const r = await manager.load(TRACK);
    assert.equal(r.status, 'error');
    assert.equal(r.parsed, null);
  });
});

describe('LyricsManager.ensureMany', () => {
  const handler = (call) => {
    if (call.url.pathname === '/api/get') {
      return call.url.searchParams.get('track_name') === 'Found' ? rec({ trackName: 'Found', name: 'Found' }) : notFoundRes();
    }
    return [];
  };
  const tracks = [
    { title: 'Local', artist: 'Artist', filePath: '/m/local.mp3' },
    { title: 'Found', artist: 'Artist', filePath: '/m/found.mp3' },
    { title: 'Missing', artist: 'Artist', filePath: '/m/missing.mp3' },
  ];

  it('procesa el lote, cuenta estados y notifica progreso', async () => {
    const fs = memFs({ '/m/local.lrc': '[00:01.00]x' });
    const { manager } = makeManager(handler, { fs });
    const progress = [];
    const { results, counts } = await manager.ensureMany(tracks, { onProgress: (p) => progress.push(p) });
    assert.deepEqual(results.map((r) => r.status), ['local', 'downloaded', 'not-found']);
    assert.equal(results[0].track, tracks[0]);
    assert.deepEqual(counts, { local: 1, downloaded: 1, unsynced: 0, instrumental: 0, 'not-found': 1, error: 0 });
    assert.deepEqual(progress.map((p) => [p.index, p.total]), [[1, 3], [2, 3], [3, 3]]);
  });

  it('un onProgress que lanza no rompe el lote', async () => {
    const { manager } = makeManager(handler);
    const { results } = await manager.ensureMany(tracks, { onProgress: () => { throw new Error('roto'); } });
    assert.equal(results.length, 3);
  });

  it('los errores individuales se cuentan y el lote continúa', async () => {
    const { manager } = makeManager((call) => (call.url.searchParams.get('track_name') === 'Local' ? jsonRes({}, 500) : handler(call)));
    const { counts, results } = await manager.ensureMany(tracks);
    assert.equal(counts.error, 1);
    assert.equal(results.length, 3);
  });

  it('valida que reciba un array', async () => {
    const { manager } = makeManager(handler);
    await rejectsWith(manager.ensureMany('no array'), ValidationError);
    await rejectsWith(manager.ensureMany(null), ValidationError);
  });

  it('lote vacío', async () => {
    const { manager } = makeManager(handler);
    assert.deepEqual(await manager.ensureMany([]), {
      results: [],
      counts: { local: 0, downloaded: 0, unsynced: 0, instrumental: 0, 'not-found': 0, error: 0 },
    });
  });

  it('abortar interrumpe el lote con AbortedError', async () => {
    const { manager } = makeManager(handler);
    const ac = new AbortController();
    await rejectsWith(
      manager.ensureMany(tracks, { signal: ac.signal, onProgress: () => ac.abort() }),
      AbortedError,
    );
  });

  it('vacía la caché persistente del cliente al terminar (flush)', async () => {
    let saved = 0;
    const store = { load: async () => ({}), save: async () => { saved++; } };
    const { manager } = makeManager(handler, { client: { cache: { store } } });
    await manager.ensureMany([tracks[2]]); // un miss se cachea con persist
    assert.equal(saved, 1);
  });
});

/* ═════════════════════════ createLrclib ═════════════════════════ */

describe('createLrclib', () => {
  it('devuelve una API compacta y funcional', async () => {
    const fetch = createMockFetch(lyricsHandler());
    const api = createLrclib({ client: { ...BASE_OPTS, fetch }, fs: memFs() });
    assert.ok(api.client instanceof LrclibClient);
    assert.ok(api.manager instanceof LyricsManager);
    for (const fn of ['ensure', 'ensureMany', 'load', 'find', 'on', 'flush']) assert.equal(typeof api[fn], 'function');

    const found = await api.find(TRACK);
    assert.equal(found.record.id, 1);

    const seen = [];
    api.on('downloaded', (e) => seen.push(e));
    assert.equal((await api.ensure(TRACK)).status, 'downloaded');
    assert.equal(seen.length, 1);
    assert.equal((await api.load(TRACK)).status, 'local');
    await assert.doesNotReject(api.flush());
  });

  it('acepta una instancia de LrclibClient ya creada', () => {
    const client = new LrclibClient({ ...BASE_OPTS, fetch: async () => jsonRes({}) });
    const api = createLrclib({ client, fs: memFs() });
    assert.equal(api.client, client);
  });

  it('funciona sin argumentos', () => {
    assert.doesNotThrow(() => createLrclib());
  });
});
