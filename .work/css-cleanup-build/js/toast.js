/* toast.js — notificaciones efímeras (AuraToast)
 * API pública conservada: AuraToast.show(message, type = "info", duration = 2800)
 * Mejoras:
 *  - Crea el contenedor si falta y lo declara como región aria-live.
 *  - Evita duplicados: un mensaje idéntico reinicia el temporizador y muestra un contador (×2).
 *  - Límite de toasts visibles, pausa al pasar el ratón/enfocar, cierre con clic o Escape.
 *  - Respeta prefers-reduced-motion. Devuelve un manejador { close, update, el }.
 *  - Atajos: success / error / warn / info, y clear().
 */
(function (global) {
  "use strict";

  const MAX_VISIBLE = 4;
  const EXIT_MS = 320;
  const TYPES = new Set(["info", "success", "warn", "error"]);

  const active = new Map(); // clave "tipo|mensaje" → registro

  const reducedMotion = () => !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function container() {
    let c = document.getElementById("toastContainer");
    if (c) return c;
    if (!document.body) return null;
    c = document.querySelector(".toast-container");
    if (!c) {
      c = document.createElement("div");
      c.className = "toast-container";
      document.body.appendChild(c);
    }
    c.id = "toastContainer";
    c.setAttribute("aria-live", "polite");
    c.setAttribute("aria-relevant", "additions");
    return c;
  }

  function dismiss(rec) {
    if (rec.closing) return;
    rec.closing = true;
    clearTimeout(rec.timer);
    active.delete(rec.key);
    const { el } = rec;
    if (reducedMotion()) { el.remove(); return; }
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), EXIT_MS);
  }

  function arm(rec) {
    clearTimeout(rec.timer);
    if (!(rec.duration > 0)) return;                 // duración 0 / negativa: queda fijo hasta cerrarlo
    rec.remaining = rec.duration;
    rec.startedAt = Date.now();
    rec.timer = setTimeout(() => dismiss(rec), rec.remaining);
  }

  function pause(rec) {
    if (!(rec.duration > 0) || rec.closing) return;
    clearTimeout(rec.timer);
    rec.remaining = Math.max(600, rec.remaining - (Date.now() - rec.startedAt));
  }

  function resume(rec) {
    if (!(rec.duration > 0) || rec.closing) return;
    rec.startedAt = Date.now();
    rec.timer = setTimeout(() => dismiss(rec), rec.remaining);
  }

  function showToast(message, type = "info", duration = 2800) {
    const c = container();
    const text = message == null ? "" : String(message);
    if (!c || !text) return { close() {}, update() {}, el: null };
    if (!TYPES.has(type)) type = "info";
    duration = Number(duration);
    if (!Number.isFinite(duration)) duration = 2800;

    const key = type + "|" + text;
    const existing = active.get(key);
    if (existing && !existing.closing) {              // duplicado → contador + reinicio
      existing.count += 1;
      existing.badge.textContent = "×" + existing.count;
      existing.badge.style.display = "";
      existing.el.classList.remove("toast-bump");
      void existing.el.offsetWidth;                   // reinicia la animación
      existing.el.classList.add("toast-bump");
      existing.duration = duration;
      arm(existing);
      return existing.handle;
    }

    // Límite de toasts: retira los más antiguos
    const visible = Array.from(active.values()).filter((r) => !r.closing);
    while (visible.length >= MAX_VISIBLE) dismiss(visible.shift());

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.setAttribute("role", type === "error" || type === "warn" ? "alert" : "status");
    el.innerHTML = '<span class="toast-dot"></span><span class="toast-msg"></span><span class="toast-count"></span>';
    const msg = el.querySelector(".toast-msg");
    const badge = el.querySelector(".toast-count");
    msg.textContent = text;
    badge.style.cssText = "display:none;margin-left:8px;opacity:.7;font-variant-numeric:tabular-nums;font-size:.85em";

    const rec = { key, el, badge, count: 1, duration, timer: 0, remaining: duration, startedAt: 0, closing: false };
    rec.handle = {
      el,
      close: () => dismiss(rec),
      update: (newText) => { msg.textContent = String(newText); },
    };
    active.set(key, rec);

    el.addEventListener("click", () => dismiss(rec));
    el.addEventListener("mouseenter", () => pause(rec));
    el.addEventListener("mouseleave", () => resume(rec));
    el.addEventListener("focusin", () => pause(rec));
    el.addEventListener("focusout", () => resume(rec));

    c.appendChild(el);
    arm(rec);
    return rec.handle;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && active.size) clear();
  });

  function clear() { Array.from(active.values()).forEach(dismiss); }

  global.AuraToast = {
    show: showToast,
    info: (m, d) => showToast(m, "info", d),
    success: (m, d) => showToast(m, "success", d),
    warn: (m, d) => showToast(m, "warn", d),
    error: (m, d) => showToast(m, "error", d === undefined ? 5000 : d),
    clear,
  };
})(window);
