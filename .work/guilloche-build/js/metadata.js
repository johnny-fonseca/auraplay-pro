/* metadata.js — extracción de tags y carátulas con jsmediatags (AuraMetadata)
 * API pública conservada: AuraMetadata.extractTags(file) → Promise<{ tags, picture }>
 *   tags: { title, artist, album, year, genre, lyrics }  (+ albumArtist, track, disc, composer)
 *   picture: URL de objeto (blob:) o null. Nunca rechaza la promesa.
 * Mejoras:
 *  - Tiempo límite: un archivo corrupto no deja la promesa colgada.
 *  - Detecta el tipo real de la carátula por firma (PNG/JPEG/WebP/GIF/BMP) en lugar de fiarse del tag.
 *  - Soporta letras USLT como objeto ({ lyrics }) además de texto.
 *  - Limpia nulos, espacios y valores numéricos; cada llamada crea su propia URL de carátula.
 *  - release(url) para liberar carátulas que ya no se usan.
 */
(function (global) {
  "use strict";

  const READ_TIMEOUT_MS = 12000;
  const EMPTY = () => ({ tags: {}, picture: null });

  function text(value) {
    if (value == null) return null;
    if (typeof value === "object") {
      if (typeof value.data === "string") value = value.data;
      else if (typeof value.text === "string") value = value.text;
      else return null;
    }
    const s = String(value).replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
    return s || null;
  }

  function lyricsOf(tags) {
    const candidates = [tags.lyrics, tags.USLT && tags.USLT.data, tags.unsynchronisedLyrics];
    for (const c of candidates) {
      if (!c) continue;
      const raw = typeof c === "string" ? c : typeof c.lyrics === "string" ? c.lyrics : typeof c.text === "string" ? c.text : null;
      if (raw && raw.trim()) return raw.replace(/\u0000/g, "");
    }
    return null;
  }

  function sniffMime(bytes, declared) {
    const b = bytes;
    if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
    if (b.length > 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
    if (b.length > 1 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
    const d = String(declared || "").toLowerCase();
    if (d === "jpg" || d === "image/jpg") return "image/jpeg";
    return d.startsWith("image/") ? d : "image/jpeg";
  }

  function pictureURL(pic) {
    if (!pic || !pic.data || !pic.data.length) return null;
    try {
      const bytes = pic.data instanceof Uint8Array ? pic.data : Uint8Array.from(pic.data);
      const blob = new Blob([bytes], { type: sniffMime(bytes, pic.format) });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn("[AuraMetadata] carátula ilegible:", e);
      return null;
    }
  }

  function extractTags(file) {
    return new Promise((resolve) => {
      if (!file || !global.jsmediatags) { resolve(EMPTY()); return; }

      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => {
        console.warn("[AuraMetadata] tiempo agotado leyendo tags de", file.name || "archivo");
        finish(EMPTY());
      }, READ_TIMEOUT_MS);

      try {
        global.jsmediatags.read(file, {
          onSuccess(result) {
            try {
              const raw = (result && result.tags) || {};
              const year = text(raw.year);
              finish({
                tags: {
                  title: text(raw.title),
                  artist: text(raw.artist),
                  album: text(raw.album),
                  year: year && /^\d{4}/.test(year) ? year.slice(0, 4) : year,
                  genre: text(raw.genre),
                  lyrics: lyricsOf(raw),
                  albumArtist: text(raw.TPE2 && raw.TPE2.data),
                  composer: text(raw.TCOM && raw.TCOM.data),
                  track: text(raw.track),
                  disc: text(raw.TPOS && raw.TPOS.data),
                },
                picture: pictureURL(raw.picture),
              });
            } catch (e) {
              console.warn("[AuraMetadata] tags inesperados:", e);
              finish(EMPTY());
            }
          },
          onError() { finish(EMPTY()); },
        });
      } catch (_) {
        finish(EMPTY());
      }
    });
  }

  /** Libera una URL de carátula creada por extractTags cuando ya no se necesita. */
  function release(url) {
    if (typeof url === "string" && url.startsWith("blob:")) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  }

  global.AuraMetadata = { extractTags, release };
})(window);
