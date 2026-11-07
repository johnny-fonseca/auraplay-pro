#!/usr/bin/env node
/*!
 * AuraPlayRelayNode.js — Relay local del mando remoto de AuraPlay Pro
 * ---------------------------------------------------------------------------
 * Corre en la PC (Node.js >= 16, SIN dependencias: solo módulos incluidos).
 * Un único puerto (por defecto 8765) hace tres cosas:
 *
 *   1. RELAY WebSocket en  ws://<ip>:8765/ws
 *        [Móvil: remoteClient.js] <--> [este relay] <--> [PC: remoteServer.js]
 *      Enruta mensajes por SESIÓN. No ejecuta nada: solo valida y reenvía.
 *   2. SERVIDOR ESTÁTICO de la carpeta del proyecto (para que el móvil pueda abrir
 *      remote/remote.html por la red). Desactívalo con --no-static si ya tienes uno.
 *   3. CONFIGURACIÓN AUTOMÁTICA para remoteServer.js en  /__aura/config.js
 *      (detecta la IP de la PC en la red local y define RELAY_URL,
 *      MOBILE_RELAY_URL y PUBLIC_BASE_URL). Así el QR sale completo.
 *
 * USO
 *   node remote/AuraPlayRelayNode.js --root .      # desde la raíz del proyecto
 *   node remote/AuraPlayRelayNode.js --root . --port 9000 --lan-ip 192.168.1.20
 *   node remote/AuraPlayRelayNode.js --help
 *
 * EN LA PÁGINA DEL REPRODUCTOR (PC), antes de remoteServer.js:
 *   <script src="/__aura/config.js"></script>
 *   <script src="./qrcode.min.js"></script>
 *   <script src="./remoteServer.js" defer></script>
 *   y abre el reproductor en  http://localhost:8765/
 *   (config.js solo rellena lo que no hayas definido tú en window.AURA_REMOTE_HOST_CONFIG).
 *
 * PROTOCOLO (JSON de texto, versión 1; compatible con remoteServer.js y remoteClient.js)
 *   Todo cliente DEBE enviar primero un "hello" con la sesión (hex de 16 a 128 caracteres):
 *     PC:    { "type":"hello", "role":"host", "client":"auraplay-host", "version":1, "session":"<hex>" }
 *     Móvil: { "type":"hello", "client":"auraplay-remote", "version":1, "session":"<hex>" }
 *   Reglas de enrutado:
 *     - Un único host por sesión. Si llega otro, REEMPLAZA al anterior (este recibe 4403).
 *     - Móvil -> host: solo hello, command, ping, pong (se reenvía el texto tal cual).
 *       Cualquier otro tipo (state, presence, keepalive…) se descarta: un móvil no puede
 *       suplantar al relay ni al host.
 *     - Host -> móviles: solo state, progress, pong. "hello" y "keepalive" los consume el relay.
 *     - Relay -> host: { "type":"presence", "clients":<n> } al entrar/salir móviles o el host.
 *   Códigos de cierre: 4401 = sesión/hello inválidos, 4403 = host reemplazado,
 *   1008 = versión no soportada (todos "no reintentar" en los clientes);
 *   4408 = sin hello a tiempo, 4429 = demasiados mensajes, 1013 = sesión llena/saturado
 *   (los clientes reintentan solos).
 *
 * SEGURIDAD
 *   - Por defecto SOLO acepta conexiones de direcciones privadas (192.168/16, 10/8,
 *     172.16/12, 100.64/10, loopback, enlace local, IPv6 ULA). --allow-public lo desactiva.
 *   - La clave de sesión (128 bits, generada por la PC) es el secreto: sin ella no se puede
 *     unir a una sesión. El relay nunca la imprime completa ni la expone en /__aura/health.
 *   - Valida la cabecera Host (anti DNS-rebinding), limita tamaños, ritmo de mensajes,
 *     conexiones por IP, móviles por sesión y sesiones totales.
 *   - El servidor estático solo sirve extensiones conocidas, nunca archivos o carpetas que
 *     empiecen por "." ni node_modules, y no sale de la carpeta raíz (ni por enlaces simbólicos).
 *   - No hay TLS: es HTTP/WS en tu red doméstica. No expongas el puerto a Internet.
 */
"use strict";

const http = require("http");
const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream");

/* ========================================================================
 * 1. CONFIGURACIÓN
 * ====================================================================== */
const PROTOCOL_VERSION = 1;
const WS_PATH = "/ws";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const INTERNAL_PREFIX = "/__aura/";
const SESSION_RE = /^[0-9a-f]{16,128}$/;

const LIMITS = Object.freeze({
  HELLO_TIMEOUT_MS: 5000,        // tiempo máximo para recibir el hello
  PING_INTERVAL_MS: 30000,       // ping de WebSocket para detectar móviles dormidos
  PRE_HELLO_MAX_BYTES: 1024,
  MOBILE_MAX_BYTES: 4096,
  HOST_MAX_BYTES: 16384,
  MAX_MOBILES_PER_SESSION: 8,
  MAX_SESSIONS: 32,
  MAX_CONNS_PER_IP: 24,
  MAX_BACKLOG_BYTES: 512 * 1024, // cliente lento: se cierra
  MAX_STRIKES: 200               // mensajes descartados por ritmo antes de cerrar
});
const RATES = Object.freeze({
  pre: { perSec: 5, burst: 10 },
  mobile: { perSec: 40, burst: 80 },
  host: { perSec: 100, burst: 200 }
});

const MOBILE_TYPES = new Set(["hello", "command", "ping", "pong"]);
const HOST_BROADCAST_TYPES = new Set(["state", "progress", "pong"]);

const CLOSE = Object.freeze({
  NORMAL: 1000, GOING_AWAY: 1001, PROTOCOL: 1002, UNSUPPORTED: 1003, BAD_DATA: 1007,
  POLICY: 1008, TOO_BIG: 1009, TRY_LATER: 1013,
  BAD_SESSION: 4401, REPLACED: 4403, HELLO_TIMEOUT: 4408, RATE: 4429
});

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".xml": "text/xml; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".webm": "video/webm", ".mp4": "video/mp4", ".wasm": "application/wasm"
});

const HELP = [
  "AuraPlay Pro · relay local del mando remoto",
  "",
  "Uso: node remote/AuraPlayRelayNode.js --root . [opciones]",
  "",
  "  -p, --port <n>        Puerto HTTP+WebSocket (por defecto 8765)",
  "      --host <addr>     Dirección donde escuchar (por defecto todas las interfaces)",
  "      --root <carpeta>  Carpeta que se sirve por HTTP (por defecto la de este archivo)",
  "      --no-static       No servir archivos; solo relay y /__aura/config.js",
  "      --lan-ip <ipv4>   Fuerza la IP de la PC que se pondrá en el QR",
  "      --allow-host <h>  Permite otro nombre de host en la cabecera Host (repetible)",
  "      --allow-public    Acepta también conexiones desde IPs no privadas (no recomendado)",
  "      --debug           Registro detallado",
  "  -h, --help            Esta ayuda",
  "",
  "Variables de entorno equivalentes: AURA_RELAY_PORT, AURA_RELAY_HOST, AURA_RELAY_ROOT,",
  "AURA_RELAY_STATIC=0, AURA_LAN_IP, AURA_RELAY_ALLOW_HOSTS=a,b, AURA_RELAY_ALLOW_PUBLIC=1,",
  "AURA_RELAY_DEBUG=1."
].join("\n");

function parseArgs(argv, env) {
  const o = {
    port: Number(env.AURA_RELAY_PORT || env.PORT || 8765),
    host: env.AURA_RELAY_HOST || "",
    root: env.AURA_RELAY_ROOT || __dirname,
    serveStatic: env.AURA_RELAY_STATIC !== "0",
    lanIp: env.AURA_LAN_IP || "",
    allowPublic: env.AURA_RELAY_ALLOW_PUBLIC === "1",
    allowHosts: (env.AURA_RELAY_ALLOW_HOSTS || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean),
    debug: env.AURA_RELAY_DEBUG === "1",
    help: false
  };
  function need(i, flag) {
    if (i >= argv.length) throw new Error("Falta el valor de " + flag);
    return argv[i];
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h": case "--help": o.help = true; break;
      case "-p": case "--port": o.port = Number(need(++i, a)); break;
      case "--host": o.host = need(++i, a); break;
      case "--root": o.root = need(++i, a); break;
      case "--no-static": o.serveStatic = false; break;
      case "--lan-ip": o.lanIp = need(++i, a); break;
      case "--allow-host": o.allowHosts.push(need(++i, a).toLowerCase()); break;
      case "--allow-public": o.allowPublic = true; break;
      case "--debug": o.debug = true; break;
      default: throw new Error("Opción desconocida: " + a);
    }
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error("Puerto no válido.");
  if (o.lanIp && !net.isIPv4(o.lanIp)) throw new Error("--lan-ip debe ser una dirección IPv4.");
  return o;
}

let opts;
try { opts = parseArgs(process.argv.slice(2), process.env); }
catch (err) { console.error("Error: " + err.message + "\n\n" + HELP); process.exit(1); }
if (opts.help) { console.log(HELP); process.exit(0); }

const ROOT = path.resolve(opts.root);
let ROOT_REAL = ROOT;
if (opts.serveStatic) {
  try { ROOT_REAL = fs.realpathSync(ROOT); }
  catch (_e) { console.error("Error: la carpeta raíz no existe: " + ROOT); process.exit(1); }
}

/* ========================================================================
 * 2. UTILIDADES DE RED
 * ====================================================================== */
function logDebug() { if (opts.debug) console.log.apply(console, ["[relay]"].concat([].slice.call(arguments))); }
function logWarn() { console.warn.apply(console, ["[relay]"].concat([].slice.call(arguments))); }
function short(id) { return typeof id === "string" ? id.slice(0, 6) + "…" : "?"; }

function normalizeIp(addr) {
  if (!addr) return "";
  return String(addr).replace(/%.*$/, "").replace(/^::ffff:/i, "");
}

function isPrivateAddress(addr) {
  const a = normalizeIp(addr);
  if (net.isIPv4(a)) {
    const p = a.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127);   // CGNAT / Tailscale
  }
  if (net.isIPv6(a)) {
    const l = a.toLowerCase();
    return l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return false;
}

function isLoopbackHost(h) {
  return h === "localhost" || /\.localhost$/.test(h) || h === "::1" || /^127\./.test(h);
}

/** Interpreta la cabecera Host. Devuelve { hostname, port } o null si no es segura. */
function parseAuthority(h) {
  if (typeof h !== "string" || h.length === 0 || h.length > 255) return null;
  const m = /^(\[[0-9A-Za-z:.%_-]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(h);
  if (!m) return null;
  return { hostname: m[1].replace(/^\[|\]$/g, "").toLowerCase(), port: m[2] || "" };
}

const OWN_HOSTNAMES = new Set([os.hostname().toLowerCase(), os.hostname().toLowerCase().split(".")[0]]);

/** Anti DNS-rebinding: solo IPs literales, localhost, *.local, el nombre de esta PC o --allow-host. */
function isAllowedHost(h) {
  const a = parseAuthority(h);
  if (!a) return false;
  const n = a.hostname;
  return !!net.isIP(n) || isLoopbackHost(n) || /\.local$/.test(n) ||
    OWN_HOSTNAMES.has(n) || opts.allowHosts.indexOf(n) !== -1;
}

function isAllowedClient(socket) {
  return opts.allowPublic || isPrivateAddress(socket.remoteAddress);
}

const VIRTUAL_IFACE_RE = /^(docker|br-|veth|virbr|vmnet|vboxnet|vethernet|utun|awdl|llw|lo$)/i;

/** IPs privadas IPv4 de la PC, la más probable de ser la Wi‑Fi/Ethernet doméstica primero. */
function detectLanIps() {
  const found = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    if (VIRTUAL_IFACE_RE.test(name)) return;
    (nets[name] || []).forEach(function (a) {
      const v4 = a.family === "IPv4" || a.family === 4;
      if (!v4 || a.internal || /^169\.254\./.test(a.address) || !isPrivateAddress(a.address)) return;
      const rank = /^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : /^172\./.test(a.address) ? 2 : 3;
      found.push({ name: name, address: a.address, rank: rank });
    });
  });
  found.sort(function (x, y) { return x.rank - y.rank; });
  return found;
}
function primaryLanIp() {
  if (opts.lanIp) return opts.lanIp;
  const l = detectLanIps();
  return l.length ? l[0].address : "";
}

/* ========================================================================
 * 3. WEBSOCKET (RFC 6455, mínimo: texto, ping/pong, cierre, fragmentación)
 * ====================================================================== */
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.allocUnsafe(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.allocUnsafe(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.allocUnsafe(10); header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

const sessions = new Map();     // id -> { id, host: Peer|null, mobiles: Set<Peer> }
const allPeers = new Set();
const ipCounts = new Map();

class Peer {
  constructor(socket, ip) {
    this.socket = socket;
    this.ip = ip;
    this.buf = Buffer.alloc(0);
    this.role = null;
    this.session = null;
    this.maxBytes = LIMITS.PRE_HELLO_MAX_BYTES;
    this.rate = RATES.pre;
    this.tokens = RATES.pre.burst;
    this.refillAt = Date.now();
    this.strikes = 0;
    this.frag = null;
    this.alive = true;
    this.closing = false;
    this.closed = false;
    this.helloTimer = null;
    this.destroyTimer = null;
  }

  rawSend(buf) {
    try {
      if (!this.socket.destroyed && this.socket.writable) { this.socket.write(buf); return true; }
    } catch (_e) { /* ignorar */ }
    return false;
  }

  sendFrame(buf) {
    if (this.closing || this.closed) return false;
    if (this.socket.writableLength > LIMITS.MAX_BACKLOG_BYTES) { this.close(CLOSE.TRY_LATER, "slow consumer"); return false; }
    return this.rawSend(buf);
  }
  send(text) { return this.sendFrame(encodeFrame(0x1, Buffer.from(text, "utf8"))); }

  /** Cierre ordenado. Los motivos son ASCII para no cortar caracteres UTF-8. */
  close(code, reason) {
    if (this.closing || this.closed) return;
    this.closing = true;
    clearTimeout(this.helloTimer);
    const r = Buffer.from(String(reason || ""), "ascii").subarray(0, 120);
    const p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.rawSend(encodeFrame(0x8, p));
    try { this.socket.end(); } catch (_e) { /* ignorar */ }
    const s = this.socket;
    this.destroyTimer = setTimeout(function () { try { s.destroy(); } catch (_e) { /* ignorar */ } }, 2000);
  }
  terminate() { try { this.socket.destroy(); } catch (_e) { /* ignorar */ } }

  takeToken() {
    const now = Date.now();
    this.tokens = Math.min(this.rate.burst, this.tokens + ((now - this.refillAt) / 1000) * this.rate.perSec);
    this.refillAt = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    if (++this.strikes > LIMITS.MAX_STRIKES) this.close(CLOSE.RATE, "rate limit");
    return false;
  }

  /** Acumula bytes y extrae tramas completas. */
  feed(chunk) {
    if (this.closing || this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2 && !this.closing) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      if ((b0 & 0x70) !== 0 || (b1 & 0x80) === 0) return this.close(CLOSE.PROTOCOL, "bad frame");   // RSV o sin máscara
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) break;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) break;
        if (this.buf.readUInt32BE(2) !== 0) return this.close(CLOSE.TOO_BIG, "too big");
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (op >= 8 && (!fin || len > 125)) return this.close(CLOSE.PROTOCOL, "bad control frame");
      if (len > this.maxBytes) return this.close(CLOSE.TOO_BIG, "too big");
      if (this.buf.length < off + 4 + len) break;
      const payload = Buffer.allocUnsafe(len);
      const m0 = this.buf[off], m1 = this.buf[off + 1], m2 = this.buf[off + 2], m3 = this.buf[off + 3];
      const mask = [m0, m1, m2, m3];
      for (let i = 0; i < len; i++) payload[i] = this.buf[off + 4 + i] ^ mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.onFrame(fin, op, payload);
    }
  }

  onFrame(fin, op, payload) {
    this.alive = true;
    switch (op) {
      case 0x8: {                                         // close
        let code = CLOSE.NORMAL;
        if (payload.length === 1) code = CLOSE.PROTOCOL;
        else if (payload.length >= 2) {
          const c = payload.readUInt16BE(0);
          code = (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) || (c >= 3000 && c <= 4999) ? c : CLOSE.PROTOCOL;
        }
        return this.close(code, "");
      }
      case 0x9: this.rawSend(encodeFrame(0xA, payload)); return;   // ping -> pong
      case 0xA: return;                                             // pong
      case 0x1: case 0x2:
        if (this.frag) return this.close(CLOSE.PROTOCOL, "bad fragment");
        if (fin) return this.onMessage(op === 0x1, payload);
        this.frag = { text: op === 0x1, parts: [payload], size: payload.length };
        return;
      case 0x0: {
        if (!this.frag) return this.close(CLOSE.PROTOCOL, "bad continuation");
        this.frag.size += payload.length;
        if (this.frag.size > this.maxBytes) return this.close(CLOSE.TOO_BIG, "too big");
        this.frag.parts.push(payload);
        if (fin) {
          const f = this.frag;
          this.frag = null;
          return this.onMessage(f.text, Buffer.concat(f.parts));
        }
        return;
      }
      default: return this.close(CLOSE.PROTOCOL, "bad opcode");
    }
  }

  onMessage(isText, buf) {
    if (!isText) return this.close(CLOSE.UNSUPPORTED, "text only");
    if (!this.takeToken()) return;
    let text;
    try { text = utf8Decoder.decode(buf); }
    catch (_e) { return this.close(CLOSE.BAD_DATA, "invalid utf8"); }
    handleText(this, text);
  }
}

/* ========================================================================
 * 4. SESIONES Y ENRUTADO
 * ====================================================================== */
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function sendPresence(s) {
  if (s.host) s.host.send(JSON.stringify({ type: "presence", clients: s.mobiles.size }));
}
function gcSession(s) {
  if (!s.host && s.mobiles.size === 0 && sessions.get(s.id) === s) sessions.delete(s.id);
}

function handleText(peer, text) {
  let msg;
  try { msg = JSON.parse(text); } catch (_e) { return; }          // malformado: se ignora
  if (!isObj(msg) || typeof msg.type !== "string") return;

  if (!peer.role) return handleHello(peer, msg);
  if (peer.role === "host") return handleHostMessage(peer, msg, text);
  return handleMobileMessage(peer, msg, text);
}

function handleHello(peer, msg) {
  if (msg.type !== "hello") return peer.close(CLOSE.BAD_SESSION, "hello required");
  if (msg.version !== undefined && msg.version !== PROTOCOL_VERSION) return peer.close(CLOSE.POLICY, "unsupported version");
  const sid = msg.session;
  if (typeof sid !== "string" || !SESSION_RE.test(sid)) return peer.close(CLOSE.BAD_SESSION, "invalid session");

  let role;
  if (msg.role === "host") role = "host";
  else if (msg.role === undefined || msg.role === "mobile" || msg.role === "remote") role = "mobile";
  else return peer.close(CLOSE.BAD_SESSION, "invalid role");

  let s = sessions.get(sid);
  if (!s) {
    if (sessions.size >= LIMITS.MAX_SESSIONS) return peer.close(CLOSE.TRY_LATER, "too many sessions");
    s = { id: sid, host: null, mobiles: new Set() };
    sessions.set(sid, s);
  }

  if (role === "host") {
    const old = s.host;
    s.host = peer;
    peer.role = "host";
    peer.session = s;
    peer.maxBytes = LIMITS.HOST_MAX_BYTES;
    peer.rate = RATES.host;
    peer.tokens = RATES.host.burst;
    clearTimeout(peer.helloTimer);
    if (old && old !== peer) old.close(CLOSE.REPLACED, "host replaced");
    logDebug("host unido a la sesión", short(sid));
    sendPresence(s);
    return;
  }

  if (s.mobiles.size >= LIMITS.MAX_MOBILES_PER_SESSION) {
    gcSession(s);
    return peer.close(CLOSE.TRY_LATER, "session full");
  }
  s.mobiles.add(peer);
  peer.role = "mobile";
  peer.session = s;
  peer.maxBytes = LIMITS.MOBILE_MAX_BYTES;
  peer.rate = RATES.mobile;
  peer.tokens = RATES.mobile.burst;
  clearTimeout(peer.helloTimer);
  logDebug("móvil unido a la sesión", short(sid), "(" + s.mobiles.size + ")");
  if (s.host) s.host.send(JSON.stringify(msg));                    // el host responde con el estado completo
  sendPresence(s);
}

function handleMobileMessage(peer, msg) {
  if (!MOBILE_TYPES.has(msg.type)) return;                         // no suplantar state/presence/keepalive
  const host = peer.session.host;
  if (host) host.send(JSON.stringify(msg));
}

function handleHostMessage(peer, msg, text) {
  if (peer.session.host !== peer) return;
  if (!HOST_BROADCAST_TYPES.has(msg.type)) return;                 // hello/keepalive: los consume el relay
  const frame = encodeFrame(0x1, Buffer.from(text, "utf8"));
  peer.session.mobiles.forEach(function (m) { m.sendFrame(frame); });
}

function removePeer(peer) {
  const s = peer.session;
  if (!s) return;
  if (peer.role === "host") { if (s.host === peer) s.host = null; }
  else if (s.mobiles.delete(peer)) sendPresence(s);
  gcSession(s);
}

/* ========================================================================
 * 5. HTTP: configuración, salud y archivos estáticos
 * ====================================================================== */
function sendText(res, status, text, extra) {
  const body = Buffer.from(text + "\n", "utf8");
  res.writeHead(status, Object.assign({
    "Content-Type": "text/plain; charset=utf-8", "Content-Length": body.length,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
  }, extra || {}));
  res.end(body);
}

function fmtHost(ip) { return net.isIPv6(ip) ? "[" + ip + "]" : ip; }

/** Script que define window.AURA_REMOTE_HOST_CONFIG para remoteServer.js (lo ya definido por ti gana). */
function buildConfigScript(req) {
  const port = server.address() ? server.address().port : opts.port;
  const raw = req.headers.host;
  const a = parseAuthority(raw);
  const pcAuthority = a ? raw : "localhost:" + port;
  const cfg = { RELAY_URL: "ws://" + pcAuthority + WS_PATH };

  // El móvil necesita una IP alcanzable: si la página se abrió por IP LAN se reutiliza;
  // si se abrió por localhost o por un nombre, se usa la IP LAN detectada.
  let mobileAuthority = "";
  if (a && net.isIP(a.hostname) && !isLoopbackHost(a.hostname)) mobileAuthority = raw;
  else { const ip = primaryLanIp(); if (ip) mobileAuthority = fmtHost(ip) + ":" + port; }
  if (mobileAuthority) {
    cfg.MOBILE_RELAY_URL = "ws://" + mobileAuthority + WS_PATH;
    cfg.PUBLIC_BASE_URL = "http://" + mobileAuthority + "/";
  }
  return "/* AuraPlay · generado por AuraPlayRelayNode.js */\n" +
    "(function(){var d=" + JSON.stringify(cfg) + ";var u=window.AURA_REMOTE_HOST_CONFIG;" +
    "window.AURA_REMOTE_HOST_CONFIG=Object.assign(d,u&&typeof u==='object'?u:{});})();\n";
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;             // formato no soportado: se sirve completo
  let start, end;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return { unsat: true };
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return { unsat: true };
  return { start: start, end: end };
}

function sendFile(req, res, file, st, type) {
  const lastModified = st.mtime.toUTCString();
  const etag = 'W/"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"';
  const headers = {
    "Content-Type": type, "Accept-Ranges": "bytes", "Last-Modified": lastModified, "ETag": etag,
    "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"
  };

  const inm = req.headers["if-none-match"];
  const ims = Date.parse(req.headers["if-modified-since"] || "");
  if ((inm && inm.split(/\s*,\s*/).indexOf(etag) !== -1) ||
      (!inm && ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(ims / 1000))) {
    res.writeHead(304, headers);
    return res.end();
  }

  let start = 0, end = st.size - 1, status = 200;
  const rh = req.headers.range;
  const ir = req.headers["if-range"];
  if (rh && (!ir || ir === etag || ir === lastModified)) {
    const r = parseRange(rh, st.size);
    if (r && r.unsat) {
      headers["Content-Range"] = "bytes */" + st.size;
      res.writeHead(416, headers);
      return res.end();
    }
    if (r) {
      start = r.start; end = r.end; status = 206;
      headers["Content-Range"] = "bytes " + start + "-" + end + "/" + st.size;
    }
  }
  headers["Content-Length"] = st.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD" || st.size === 0) return res.end();
  pipeline(fs.createReadStream(file, { start: start, end: end }), res, function () { /* cliente cortó: ok */ });
}

function isInsideRoot(real) {
  return real === ROOT_REAL || real.indexOf(ROOT_REAL + path.sep) === 0;
}

function serveFile(req, res, abs, ctx, depth) {
  fs.realpath(abs, function (err, real) {
    if (err || !isInsideRoot(real)) return sendText(res, 404, "No encontrado");
    fs.stat(real, function (err2, st) {
      if (err2) return sendText(res, 404, "No encontrado");
      if (st.isDirectory()) {
        if (depth > 0) return sendText(res, 404, "No encontrado");
        if (!ctx.trailingSlash) {                                  // /remote -> /remote/ (rutas relativas)
          return sendText(res, 301, "Redirigiendo", { "Location": ctx.canonical + "/" });
        }
        return serveFile(req, res, path.join(real, "index.html"), ctx, depth + 1);
      }
      const type = st.isFile() ? MIME[path.extname(real).toLowerCase()] : null;
      if (!type) return sendText(res, 404, "No encontrado");
      sendFile(req, res, real, st, type);
    });
  });
}

function serveStatic(req, res, rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch (_e) { return sendText(res, 400, "Ruta no válida"); }
  if (decoded.indexOf("\0") !== -1 || decoded.indexOf("\\") !== -1) return sendText(res, 400, "Ruta no válida");
  const segs = decoded.split("/").filter(function (s) { return s && s !== "."; });
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].charAt(0) === "." || segs[i].toLowerCase() === "node_modules") return sendText(res, 404, "No encontrado");
  }
  const ctx = {
    trailingSlash: segs.length === 0 || decoded.charAt(decoded.length - 1) === "/",
    canonical: "/" + segs.map(encodeURIComponent).join("/")
  };
  if (ctx.canonical === "/") ctx.canonical = "";
  serveFile(req, res, path.join.apply(path, [ROOT].concat(segs)), ctx, 0);
}

function onRequest(req, res) {
  req.on("error", function () { /* ignorar */ });
  if (!isAllowedClient(req.socket)) return sendText(res, 403, "Solo se permiten conexiones de la red local.");
  if (!isAllowedHost(req.headers.host)) return sendText(res, 403, "Host no permitido (usa la IP de la PC o añade --allow-host).");
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Método no permitido", { "Allow": "GET, HEAD" });

  const rawPath = String(req.url || "").split("?")[0].split("#")[0];
  if (rawPath.charAt(0) !== "/") return sendText(res, 400, "Ruta no válida");

  if (rawPath === INTERNAL_PREFIX + "config.js") {
    const body = Buffer.from(buildConfigScript(req), "utf8");
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8", "Content-Length": body.length,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    });
    return res.end(req.method === "HEAD" ? undefined : body);
  }
  if (rawPath === INTERNAL_PREFIX + "health") {
    const body = Buffer.from(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, sessions: sessions.size }), "utf8");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
    return res.end(req.method === "HEAD" ? undefined : body);
  }
  if (rawPath.indexOf(INTERNAL_PREFIX) === 0 || !opts.serveStatic) return sendText(res, 404, "No encontrado");
  serveStatic(req, res, rawPath);
}

/* ========================================================================
 * 6. UPGRADE A WEBSOCKET
 * ====================================================================== */
function rejectUpgrade(socket, status, text) {
  try {
    socket.end("HTTP/1.1 " + status + " " + text + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  } catch (_e) { socket.destroy(); }
}

function onUpgrade(req, socket, head) {
  socket.on("error", function () { /* ignorar */ });
  const ip = normalizeIp(socket.remoteAddress);

  if (!isAllowedClient(socket)) return rejectUpgrade(socket, 403, "Forbidden");
  if (!isAllowedHost(req.headers.host)) return rejectUpgrade(socket, 403, "Forbidden");
  const pathname = String(req.url || "").split("?")[0];
  const key = req.headers["sec-websocket-key"];
  const ok = req.method === "GET" && pathname === WS_PATH &&
    String(req.headers.upgrade || "").toLowerCase() === "websocket" &&
    /(^|,)\s*upgrade\s*(,|$)/i.test(String(req.headers.connection || "")) &&
    req.headers["sec-websocket-version"] === "13" &&
    typeof key === "string" && /^[A-Za-z0-9+/]{22}==$/.test(key);
  if (!ok) return rejectUpgrade(socket, 400, "Bad Request");

  const count = ipCounts.get(ip) || 0;
  if (count >= LIMITS.MAX_CONNS_PER_IP) return rejectUpgrade(socket, 429, "Too Many Requests");
  ipCounts.set(ip, count + 1);

  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n");
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);
  socket.setTimeout(0);

  const peer = new Peer(socket, ip);
  allPeers.add(peer);
  peer.helloTimer = setTimeout(function () { peer.close(CLOSE.HELLO_TIMEOUT, "hello timeout"); }, LIMITS.HELLO_TIMEOUT_MS);

  socket.on("data", function (chunk) {
    try { peer.feed(chunk); }
    catch (err) { logWarn("Error procesando datos de " + ip + ":", err.message); peer.terminate(); }
  });
  socket.on("end", function () { try { socket.end(); } catch (_e) { /* ignorar */ } });
  socket.on("close", function () {
    peer.closed = true;
    clearTimeout(peer.helloTimer);
    clearTimeout(peer.destroyTimer);
    allPeers.delete(peer);
    const n = (ipCounts.get(ip) || 1) - 1;
    if (n <= 0) ipCounts.delete(ip); else ipCounts.set(ip, n);
    try { removePeer(peer); } catch (err) { logWarn("Error al limpiar la conexión:", err.message); }
  });

  if (head && head.length) {
    try { peer.feed(head); } catch (_e) { peer.terminate(); }
  }
}

/* ========================================================================
 * 7. ARRANQUE Y APAGADO
 * ====================================================================== */
const server = http.createServer(onRequest);
server.on("upgrade", onUpgrade);
server.on("clientError", function (_err, socket) {
  try { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); } catch (_e) { /* ignorar */ }
});
server.on("error", function (err) {
  if (err && err.code === "EADDRINUSE") console.error("Error: el puerto " + opts.port + " ya está en uso. Prueba con --port <otro>.");
  else console.error("Error del servidor:", err);
  process.exit(1);
});

// Ping de WebSocket: elimina conexiones muertas (p. ej. móviles que se durmieron).
const heartbeat = setInterval(function () {
  allPeers.forEach(function (p) {
    if (!p.alive) { p.terminate(); return; }
    p.alive = false;
    p.rawSend(encodeFrame(0x9, Buffer.alloc(0)));
  });
}, LIMITS.PING_INTERVAL_MS);
if (heartbeat.unref) heartbeat.unref();

function onListening() {
  const port = server.address().port;
  const lan = detectLanIps();
  const ip = primaryLanIp();
  console.log("AuraPlay Pro · relay local");
  console.log("  Reproductor (PC):  http://localhost:" + port + "/" + (opts.serveStatic ? "" : "   (estático desactivado)"));
  console.log("  WebSocket:         ws://" + (ip ? ip + ":" + port : "<ip-de-la-pc>:" + port) + WS_PATH);
  console.log("  Mando (móvil):     http://" + (ip ? ip + ":" + port : "<ip-de-la-pc>:" + port) + "/remote/remote.html   (el QR ya la incluye)");
  if (!ip) console.log("  ⚠ No se detectó una IP de red local. Conecta la PC a la red o usa --lan-ip.");
  else if (!opts.lanIp && lan.length > 1) {
    console.log("  Otras IPs detectadas: " + lan.slice(1).map(function (x) { return x.address + " (" + x.name + ")"; }).join(", ") + " — usa --lan-ip si la elegida no es la correcta.");
  }
  if (opts.allowPublic) console.log("  ⚠ --allow-public activo: se aceptan conexiones de IPs no privadas.");
  console.log("  Si el móvil no conecta, permite Node.js en el firewall para redes privadas. Ctrl+C para salir.");
}
if (opts.host) server.listen(opts.port, opts.host, onListening);
else server.listen(opts.port, onListening);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  allPeers.forEach(function (p) { p.close(CLOSE.GOING_AWAY, "server shutdown"); });
  server.close();
  setTimeout(function () { process.exit(0); }, 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
