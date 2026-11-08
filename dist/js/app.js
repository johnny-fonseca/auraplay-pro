/* app.js — entry point */
(function () {
  const DEFAULT_DEMO_TRACKS = Object.freeze([
    {
      audio: "demo/cancionAuraPlay/Auraplay - Tengo todo, pero no tu corazón.mp3",
      lyrics: "demo/cancionAuraPlay/Auraplay - Tengo todo, pero no tu corazón.lrc"
    },
    {
      audio: "demo/cancionAuraPlay/Donde Suena Mi Aura.mp3",
      lyrics: "demo/cancionAuraPlay/Donde Suena Mi Aura.lrc"
    }
  ]);

  function demoAssetUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol)) return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  async function loadDemoFromUrl(player) {
    const params = new URLSearchParams(window.location.search);
    // Sin parámetros, la demo pública carga las dos canciones y sus letras.
    // Los parámetros existentes siguen permitiendo abrir una sola pareja.
    const requestedAudio = params.get("demoAudio");
    const requestedLyrics = params.get("demoLyrics");
    const demoTracks = requestedAudio || requestedLyrics
      ? [{ audio: requestedAudio, lyrics: requestedLyrics }]
      : DEFAULT_DEMO_TRACKS;
    const assets = demoTracks.map(({ audio, lyrics }) => ({
      audioUrl: demoAssetUrl(audio),
      lyricsUrl: demoAssetUrl(lyrics)
    }));
    if (assets.every(({ audioUrl, lyricsUrl }) => !audioUrl && !lyricsUrl)) return;
    if (assets.some(({ audioUrl, lyricsUrl }) => !audioUrl || !lyricsUrl)) {
      window.AuraToast.show("El enlace de demo necesita audio y letra", "warn", 5000);
      return;
    }

    try {
      const files = [];
      for (const { audioUrl, lyricsUrl } of assets) {
        const [audioResponse, lyricsResponse] = await Promise.all([fetch(audioUrl), fetch(lyricsUrl)]);
        if (!audioResponse.ok || !lyricsResponse.ok) throw new Error("recurso no encontrado");
        const audioBlob = await audioResponse.blob();
        const lyricsText = await lyricsResponse.text();
        const audioName = decodeURIComponent(audioUrl.pathname.split("/").pop() || "demo.mp3");
        const lyricsName = decodeURIComponent(lyricsUrl.pathname.split("/").pop() || "demo.lrc");
        files.push(
          new File([audioBlob], audioName, { type: audioBlob.type || "audio/mpeg" }),
          new File([lyricsText], lyricsName, { type: "text/plain;charset=utf-8" })
        );
      }
      await player._handleFiles(files);
      const firstAudioName = files.find((file) => file.type.startsWith("audio/"))?.name;
      const index = player.tracks.findIndex((track) => track.name === firstAudioName);
      if (index >= 0) player.play(index);
    } catch (_) {
      window.AuraToast.show("No se pudo cargar la canción de la demo", "error", 6000);
    }
  }

  function init() {
    const player = new window.AuraPlayer();
    window.AURA = player;
    window.AuraShortcuts.bind(player);
    // El DOM y los controles ya están montados; no esperar a que el motor de
    // audio se active, porque AudioContext solo puede iniciarse tras interacción.
    window.__auraReady = true;
    // Show a friendly toast
    setTimeout(() => {
      window.AuraToast.show("Bienvenido a AuraPlay Pro — arrastra archivos o pulsa H para ayuda", "info", 4500);
    }, 600);
    loadDemoFromUrl(player);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
