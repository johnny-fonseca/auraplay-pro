/* storage.js — persistencia local de preferencias y biblioteca (AuraStorage)
 * API pública conservada: get, set, remove, keys, getLocal, setLocal, removeLocal.
 * Mejoras:
 *  - localStorage con respaldo en memoria si no está disponible (modo privado, cuotas, políticas).
 *  - Serialización uniforme en JSON (se siguen leyendo los valores antiguos guardados como texto plano).
 *  - IndexedDB resiliente: reabre tras errores/cierres, espera a tx.oncomplete y gestiona versionchange.
 *  - Extras: has, clear, isPersistent, persist, estimate, onChange.
 */
(function (global) {
  "use strict";

  const PREFIX = "auraplay:";
  const DB_NAME = "auraplay-local";
  const DB_VERSION = 1;
  const STORE = "state";

  /* ---------- localStorage + memoria ---------- */
  const memory = new Map();
  let lsOK = null;

  function localAvailable() {
    if (lsOK !== null) return lsOK;
    try {
      const k = PREFIX + "__probe__";
      global.localStorage.setItem(k, "1");
      global.localStorage.removeItem(k);
      lsOK = true;
    } catch (_) {
      lsOK = false;
    }
    return lsOK;
  }

  function parse(raw, fallback) {
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return raw; } // valores antiguos en texto plano
  }

  const listeners = new Set();
  function emit(key, value) {
    listeners.forEach((fn) => { try { fn(key, value); } catch (e) { console.error("[AuraStorage] listener:", e); } });
  }

  /* ---------- IndexedDB ---------- */
  let dbPromise = null;

  function openDB() {
    if (!global.indexedDB) return Promise.reject(new Error("IndexedDB no disponible"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Si otra pestaña actualiza el esquema o el navegador cierra la conexión, se reabre al siguiente uso.
        db.onversionchange = () => { try { db.close(); } catch (_) {} dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error("No se pudo abrir IndexedDB"));
      req.onblocked = () => console.warn("[AuraStorage] apertura de IndexedDB bloqueada por otra pestaña");
    }).catch((err) => { dbPromise = null; throw err; });
    return dbPromise;
  }

  function idb(method, key, value) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      let tx, result;
      try {
        tx = db.transaction(STORE, method === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore(STORE);
        const req = method === "get" ? store.get(key) : method === "delete" ? store.delete(key) : store.put(value, key);
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
      } catch (e) {
        dbPromise = null; // conexión inválida: se reabrirá
        reject(e);
        return;
      }
      // Las escrituras solo son seguras cuando la transacción termina (no cuando la request responde).
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Transacción fallida"));
      tx.onabort = () => reject(tx.error || new DOMException("Transacción abortada (¿cuota llena?)", "AbortError"));
    }));
  }

  /* ---------- API ---------- */
  const Storage = {
    get(key, fallback = null) {
      const k = PREFIX + key;
      if (memory.has(k)) return parse(memory.get(k), fallback);   // espejo siempre al día (incluye escrituras que no cupieron)
      if (localAvailable()) {
        try {
          const raw = global.localStorage.getItem(k);
          if (raw != null) memory.set(k, raw);
          return parse(raw, fallback);
        } catch (_) { /* sin acceso: valor por defecto */ }
      }
      return fallback;
    },

    /** Guarda cualquier valor serializable. Devuelve true si quedó en almacenamiento persistente. */
    set(key, value) {
      if (value === undefined) { Storage.remove(key); return true; }
      const k = PREFIX + key;
      let raw;
      try { raw = JSON.stringify(value); } catch (e) { console.error("[AuraStorage] valor no serializable:", key, e); return false; }
      memory.set(k, raw);                                   // espejo: sigue funcionando si localStorage falla
      let persisted = false;
      if (localAvailable()) {
        try { global.localStorage.setItem(k, raw); persisted = true; }
        catch (e) { console.warn("[AuraStorage] localStorage lleno o bloqueado; se mantiene en memoria:", key); }
      }
      emit(key, value);
      return persisted;
    },

    has(key) {
      const k = PREFIX + key;
      try { if (localAvailable() && global.localStorage.getItem(k) != null) return true; } catch (_) {}
      return memory.has(k);
    },

    remove(key) {
      const k = PREFIX + key;
      memory.delete(k);
      try { if (localAvailable()) global.localStorage.removeItem(k); } catch (_) {}
      emit(key, undefined);
    },

    keys() {
      const out = new Set();
      try {
        if (localAvailable()) {
          for (let i = 0; i < global.localStorage.length; i++) {
            const k = global.localStorage.key(i);
            if (k && k.startsWith(PREFIX)) out.add(k.slice(PREFIX.length));
          }
        }
      } catch (_) {}
      memory.forEach((_, k) => { if (k.startsWith(PREFIX)) out.add(k.slice(PREFIX.length)); });
      return Array.from(out);
    },

    /** Borra todas las preferencias de AuraPlay (no toca IndexedDB). */
    clear() { Storage.keys().forEach((k) => Storage.remove(k)); },

    /** Borra preferencias y toda la base de datos local de AuraPlay. */
    async resetAll() {
      if (global.indexedDB) {
        if (dbPromise) {
          try { (await dbPromise).close(); } catch (_) {}
          dbPromise = null;
        }
        await new Promise((resolve, reject) => {
          let req;
          try { req = global.indexedDB.deleteDatabase(DB_NAME); }
          catch (e) { reject(e); return; }
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error || new Error("No se pudo borrar la base de datos"));
          req.onblocked = () => reject(new Error("Cierra las otras pestañas de AuraPlay e inténtalo de nuevo"));
        });
      }
      Storage.clear();
    },

    /** true si localStorage funciona; false si solo hay memoria (los datos se perderán al cerrar). */
    isPersistent() { return localAvailable(); },

    /** Observa cambios hechos desde este contexto. Devuelve la función para cancelar. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /* ----- IndexedDB (valores grandes: biblioteca, handles de carpeta, File/Blob) ----- */
    getLocal: (key) => idb("get", key),
    setLocal: (key, value) => idb("put", key, value),
    removeLocal: (key) => idb("delete", key),

    /** Pide al navegador que no expulse los datos bajo presión de almacenamiento. */
    async persist() {
      try { return !!(global.navigator.storage && global.navigator.storage.persist && await global.navigator.storage.persist()); }
      catch (_) { return false; }
    },

    /** { usage, quota } en bytes, o null si el navegador no lo expone. */
    async estimate() {
      try {
        if (global.navigator.storage && global.navigator.storage.estimate) {
          const { usage, quota } = await global.navigator.storage.estimate();
          return { usage, quota };
        }
      } catch (_) {}
      return null;
    },
  };

  // Sincroniza el espejo en memoria cuando otra pestaña cambia una preferencia.
  global.addEventListener("storage", (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    if (e.newValue == null) memory.delete(e.key); else memory.set(e.key, e.newValue);
    emit(key, e.newValue == null ? undefined : parse(e.newValue));
  });

  global.AuraStorage = Storage;
})(window);
