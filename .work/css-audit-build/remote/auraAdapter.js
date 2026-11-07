/* auraAdapter.js — puente específico entre AuraPlay Pro y Aura Remote. */
(function (global) {
  "use strict";

  function getPlayer() { return global.AURA || null; }
  function getAudio(p) { return p && p.audio && typeof p.audio === "object" ? p.audio : null; }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  let coverSource = "";
  let coverData = "";
  let coverImage = null;
  function compactCover(source) {
    if (typeof source !== "string" || !source) { coverSource = ""; coverData = ""; coverImage = null; return ""; }
    if (source === coverSource) return coverData;
    coverSource = source;
    coverData = "";
    const image = new Image();
    coverImage = image;
    image.onload = function () {
      if (coverImage !== image) return;
      try {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.62;
        let result = canvas.toDataURL("image/jpeg", quality);
        while (result.length > 12000 && quality > 0.3) { quality -= 0.1; result = canvas.toDataURL("image/jpeg", quality); }
        if (result.length <= 12000) coverData = result;
      } catch (_e) { coverData = ""; }
    };
    image.onerror = function () { if (coverImage === image) coverData = ""; };
    image.src = source;
    return "";
  }

  function createAdapter() {
    function currentTrack(p) {
      if (!p || !Array.isArray(p.tracks)) return null;
      const i = Number(p.currentIndex);
      return Number.isInteger(i) && i >= 0 && i < p.tracks.length ? p.tracks[i] : null;
    }
    function repeatMode(p) {
      return ["off", "all", "one"][Number(p && p.repeat)] || "off";
    }
    function call(p, name, args) {
      if (!p || typeof p[name] !== "function") return false;
      return p[name].apply(p, args || []);
    }

    return {
      getSnapshot: function () {
        const p = getPlayer();
        const audio = getAudio(p);
        const track = currentTrack(p);
        const lyrics = track && Array.isArray(track.lyrics) ? track.lyrics : [];
        const lyricIndex = lyrics.length && global.AuraLRC && typeof global.AuraLRC.findIndex === "function"
          ? global.AuraLRC.findIndex(lyrics, audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0, Number(p && p.lyricOffset) || 0)
          : -1;
        const lyricElement = global.document && global.document.getElementById("lyricCurrent");
        const displayedLyric = lyricElement && typeof lyricElement.textContent === "string" ? lyricElement.textContent.trim() : "";
        return {
          track: track ? {
            title: typeof track.title === "string" && track.title ? track.title : (track.name || ""),
            artist: typeof track.artist === "string" ? track.artist : "",
            cover: compactCover(track.cover),
            lyric: displayedLyric || (lyricIndex >= 0 && lyrics[lyricIndex] && typeof lyrics[lyricIndex].text === "string"
              ? lyrics[lyricIndex].text
              : (lyrics.length ? "♪" : "Sin letra sincronizada"))
          } : null,
          playing: audio ? !audio.paused && !audio.ended : !!(p && p.isPlaying),
          currentTime: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
          duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
          volume: p && Number.isFinite(p.volume) ? p.volume : (audio ? audio.volume * 100 : 70),
          muted: p ? p.muted === true : !!(audio && audio.muted),
          shuffle: !!(p && p.shuffle),
          repeat: repeatMode(p)
        };
      },

      playPause: function () { return call(getPlayer(), "togglePlay"); },
      previous: function () { return call(getPlayer(), "prev"); },
      next: function () { return call(getPlayer(), "next"); },

      // AuraPlayer.seek(delta) es relativo; el slider remoto envía segundos absolutos.
      seek: function (seconds) {
        const audio = getAudio(getPlayer());
        if (!audio || !Number.isFinite(seconds)) return false;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.MAX_SAFE_INTEGER;
        try { audio.currentTime = clamp(seconds, 0, duration); return true; }
        catch (_e) { return false; }
      },

      setVolume: function (volume) {
        const p = getPlayer();
        if (!p || !Number.isFinite(volume)) return false;
        const value = clamp(volume, 0, 100);
        if (typeof p._setVolume === "function") { p._setVolume(value, true); return true; }
        const audio = getAudio(p);
        if (!audio) return false;
        audio.volume = value / 100;
        return true;
      },

      toggleMute: function () { return call(getPlayer(), "toggleMute"); },

      setShuffle: function (enabled) {
        const p = getPlayer();
        if (!p || typeof enabled !== "boolean" || typeof p.shuffle !== "boolean") return false;
        if (p.shuffle !== enabled) return call(p, "toggleShuffle");
        return true;
      },

      setRepeat: function (mode) {
        const p = getPlayer();
        const target = ["off", "all", "one"].indexOf(mode);
        if (!p || target < 0 || !Number.isInteger(Number(p.repeat))) return false;
        for (let i = 0; i < 3; i++) {
          if (Number(p.repeat) === target) return true;
          if (typeof p.cycleRepeat !== "function") return false;
          p.cycleRepeat();
        }
        return Number(p.repeat) === target;
      },

      subscribe: function (notify) {
        const audio = getAudio(getPlayer());
        if (!audio || typeof audio.addEventListener !== "function") return function () {};
        const events = ["loadstart", "emptied", "loadedmetadata", "durationchange", "play", "pause", "ended", "seeked", "volumechange"];
        events.forEach(function (type) { audio.addEventListener(type, notify); });
        return function () { events.forEach(function (type) { audio.removeEventListener(type, notify); }); };
      },
      sourceId: function () { return getAudio(getPlayer()); }
    };
  }

  const config = global.AURA_REMOTE_HOST_CONFIG && typeof global.AURA_REMOTE_HOST_CONFIG === "object"
    ? global.AURA_REMOTE_HOST_CONFIG : {};
  const defaults = createAdapter();
  config.adapter = Object.assign(defaults, config.adapter && typeof config.adapter === "object" ? config.adapter : {});
  global.AURA_REMOTE_HOST_CONFIG = config;
  global.AuraPlayRemoteAdapter = config.adapter;
})(window);
