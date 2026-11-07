/* skin.js — alterna entre las skins Latón, Neón, Esmeralda, Glaciar, Rubí, Titanio y Papel (independiente del tema claro/oscuro) */
(() => {
  const KEY = "skin";
  const LEGACY_KEY = "aura-skin";
  const SKINS = ["brass", "neon", "emerald", "glacier", "ruby", "titanium", "paper", "ulm", "gres", "telar"];
  const root = document.documentElement;
  const btn = document.getElementById("btnSkin");
  const meta = document.querySelector('meta[name="theme-color"]');
  const COLORS = { brass: "#0c0c0f", neon: "#06081a", emerald: "#07100c", glacier: "#070d14", ruby: "#0d0709", titanium: "#090b0f", paper: "#0b0c10", ulm: "#121314", gres: "#121413", telar: "#151219" };
  const NAMES = { brass: "Latón", neon: "Neón", emerald: "Esmeralda", glacier: "Glaciar", ruby: "Rubí", titanium: "Titanio", paper: "Papel", ulm: "Ulm", gres: "Gres", telar: "Telar" };

  const nextOf = (skin) => SKINS[(SKINS.indexOf(skin) + 1) % SKINS.length];

  function apply(skin) {
    if (!SKINS.includes(skin)) skin = "brass";
    root.dataset.skin = skin;
    if (meta) meta.setAttribute("content", COLORS[skin]);
    if (btn) {
      const next = nextOf(skin);
      btn.removeAttribute("aria-pressed");
      btn.dataset.skin = skin;
      btn.setAttribute("aria-label", `Cambiar skin (actual: ${NAMES[skin]})`);
      btn.title = `Skin: ${NAMES[skin]} (clic para ${NAMES[next]})`;
    }
    try {
      if (window.AuraStorage) window.AuraStorage.set(KEY, skin);
      else localStorage.setItem(`auraplay:${KEY}`, JSON.stringify(skin));
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {}
  }

  function toggle() {
    const next = nextOf(root.dataset.skin);
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(() => apply(next));
    } else apply(next);
  }

  apply(root.dataset.skin);
  btn && btn.addEventListener("click", toggle);
})();
