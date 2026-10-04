/* ============================================================
   chesstable — servidor completo (ZERO dependências, só Node ≥ 16)
   Contas com confirmação por e-mail · banco de dados JSON ·
   matchmaking · partidas validadas no servidor · rating Glicko
   Rodar:  node server.js        (porta: env PORT, padrão 3000)
   ============================================================ */
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const https = require("https");
const net = require("net");
const E = require("./engine.js");

/* ---------------- configuração ---------------- */
// config.json (opcional): { "baseUrl": "https://chesstable.com",
//   "smtp": { "host": "...", "port": 465, "user": "...", "pass": "...", "from": "chesstable <no-reply@chesstable.com>" } }
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (e) {}
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "db.json");
// Variáveis de ambiente (recomendado no Render) têm prioridade sobre o config.json:
//   BASE_URL            ex.: https://chesstable.onrender.com
//   BREVO_API_KEY       envia pela API HTTPS da Brevo (funciona no plano grátis do Render,
//                       que bloqueia as portas SMTP 25/465/587)
//   MAIL_FROM           ex.: chesstable <seu-remetente-verificado@...>
//   MAIL_WEBHOOK_URL    URL de um Google Apps Script que envia pelo seu Gmail (ver README)
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (SMTP direto — só em planos pagos ou fora do Render)
if (process.env.BASE_URL) CFG.baseUrl = process.env.BASE_URL;
if (process.env.SMTP_HOST) CFG.smtp = { host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 465,
  user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM };
const BREVO_KEY = process.env.BREVO_API_KEY || (CFG.brevo && CFG.brevo.apiKey) || "";
const MAIL_FROM = process.env.MAIL_FROM || (CFG.smtp && CFG.smtp.from) || (CFG.brevo && CFG.brevo.from) || "";
const MAIL_WEBHOOK = process.env.MAIL_WEBHOOK_URL || CFG.mailWebhook || "";
const DEV_MAIL = !MAIL_WEBHOOK && !BREVO_KEY && !(CFG.smtp && CFG.smtp.host); // sem e-mail configurado: modo demonstração (link aparece na tela)

/* ---------------- banco de dados ---------------- */
// Com DATABASE_URL definido, os dados ficam no Postgres (sobrevivem a reinícios e
// novas publicações). Sem ele, caem no arquivo db.json, como antes.
const DB_URL = process.env.DATABASE_URL || "";
let pool = null;
if (DB_URL) {
  try {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: DB_URL,
      ssl: /\brender\.com\b/.test(DB_URL) ? { rejectUnauthorized: false } : undefined,
      max: 4
    });
    pool.on("error", (e) => console.log("ERRO BANCO (pool):", e.message));
  } catch (e) {
    console.log("ERRO BANCO: pacote pg indisponível (" + e.message + ") — usando arquivo.");
    pool = null;
  }
}

// Alternativa gratuita: guardar os dados num arquivo do seu Google Drive, pelo
// mesmo Apps Script que envia os e-mails. Precisa de DB_WEBHOOK_URL (ou reaproveita
// MAIL_WEBHOOK_URL) e de DB_KEY, a chave que o script gera.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const DB_WEBHOOK = process.env.DB_WEBHOOK_URL || MAIL_WEBHOOK || "";
const DB_KEY = process.env.DB_KEY || "";
const usandoDrive = !pool && !!DB_WEBHOOK && !!DB_KEY;

function chamarScript(corpo) {
  return new Promise((resolve, reject) => {
    webhookReq(DB_WEBHOOK, JSON.stringify(corpo), (err, _ok, dados) => {
      if (err) reject(err); else resolve(dados);
    });
  });
}

let db = { users: {}, sessions: {} };

async function carregarDB() {
  if (usandoDrive) {
    const r = await chamarScript({ acao: "ler", chave: DB_KEY });
    if (r && r.dados) db = { users: r.dados.users || {}, sessions: r.dados.sessions || {} };
    else { try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) {} await gravarNoDrive(); }
    return "Google Drive (Apps Script)";
  }
  if (!pool) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) {}
    return "arquivo " + DB_FILE;
  }
  await pool.query(
    "CREATE TABLE IF NOT EXISTS estado (id int PRIMARY KEY, dados jsonb NOT NULL, atualizado timestamptz NOT NULL DEFAULT now())"
  );
  const r = await pool.query("SELECT dados FROM estado WHERE id = 1");
  if (r.rows[0] && r.rows[0].dados) {
    const d = r.rows[0].dados;
    db = { users: d.users || {}, sessions: d.sessions || {} };
  } else {
    // primeira vez: aproveita um db.json existente, se houver
    try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) {}
    await gravarNoBanco();
  }
  return "Postgres";
}

let gravandoDrive = false, regravarDrive = false;
async function gravarNoDrive() {
  if (gravandoDrive) { regravarDrive = true; return; }
  gravandoDrive = true;
  try {
    await chamarScript({ acao: "gravar", chave: DB_KEY, dados: db });
  } catch (e) {
    console.log("ERRO DRIVE (gravar):", e.message);
  } finally {
    gravandoDrive = false;
    if (regravarDrive) { regravarDrive = false; gravarNoDrive(); }
  }
}

let gravando = false, regravar = false;
async function gravarNoBanco() {
  if (gravando) { regravar = true; return; }
  gravando = true;
  try {
    await pool.query(
      "INSERT INTO estado (id, dados, atualizado) VALUES (1, $1, now()) " +
      "ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado = now()",
      [JSON.stringify(db)]
    );
  } catch (e) {
    console.log("ERRO BANCO (gravar):", e.message);
  } finally {
    gravando = false;
    if (regravar) { regravar = false; gravarNoBanco(); }
  }
}

// grava o que estiver pendente antes de o Render encerrar o processo
let encerrando = false;
function encerrarComGravacao() {
  if (encerrando) return;
  encerrando = true;
  clearTimeout(saveTimer);
  const fim = () => process.exit(0);
  if (usandoDrive) gravarNoDrive().then(fim, fim);
  else if (pool) gravarNoBanco().then(() => pool.end().catch(() => {})).then(fim, fim);
  else {
    try {
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {}
    fim();
  }
}
process.on("SIGTERM", encerrarComGravacao);
process.on("SIGINT", encerrarComGravacao);

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (usandoDrive) return gravarNoDrive();
    if (pool) return gravarNoBanco();
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, usandoDrive ? 800 : 50);   // no Drive, espaça as gravações
}
const userKey = (nome) => nome.trim().toLowerCase();
function pubUser(u) {
  return { nome: u.nome, rating: Math.round(u.rating), rd: Math.round(u.rd),
           partidas: u.partidas, vitorias: u.vitorias, derrotas: u.derrotas, empates: u.empates };
}

/* ---------------- senhas e sessões ---------------- */
function hashPass(senha, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(senha, salt, 64).toString("hex");
  return { salt, h };
}
function checkPass(senha, u) {
  const h = crypto.scryptSync(senha, u.salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash));
}
function newSession(nome) {
  const tok = crypto.randomBytes(24).toString("hex");
  db.sessions[tok] = { u: userKey(nome), exp: Date.now() + 30 * 24 * 3600e3 };
  save();
  return tok;
}
function sessionUser(tok) {
  const s = tok && db.sessions[tok];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.u] || null;
}

/* ---------------- e-mail (SMTP mínimo, TLS) ---------------- */
function sendMailBrevo(to, subject, text, cb) {
  const m = MAIL_FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const sender = m ? { name: m[1] || "chesstable", email: m[2] } : { name: "chesstable", email: MAIL_FROM.trim() };
  const body = JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text });
  const req = https.request({ host: "api.brevo.com", path: "/v3/smtp/email", method: "POST",
    headers: { "api-key": BREVO_KEY, "content-type": "application/json", "accept": "application/json",
               "content-length": Buffer.byteLength(body) } }, (res) => {
    let out = "";
    res.on("data", (d) => out += d);
    res.on("end", () => res.statusCode < 300 ? cb(null, "sent")
      : cb(new Error("Brevo " + res.statusCode + " " + out.slice(0, 200))));
  });
  req.setTimeout(15000, () => req.destroy(new Error("Brevo timeout")));
  req.on("error", (e) => cb(e));
  req.end(body);
}
// Google Apps Script: POST /exec responde 302 para a URL com o resultado — seguimos com GET.
function webhookReq(url, body, cb, hops) {
  const u = new URL(url);
  const lib = u.protocol === "http:" ? http : https;
  const opt = { method: body ? "POST" : "GET", headers: {} };
  if (body) { opt.headers["content-type"] = "application/json"; opt.headers["content-length"] = Buffer.byteLength(body); }
  const req = lib.request(u, opt, (res) => {
    let out = "";
    res.on("data", (d) => out += d);
    res.on("end", () => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 3)
        return webhookReq(new URL(res.headers.location, u).toString(), null, cb, (hops || 0) + 1);
      let j = null; try { j = JSON.parse(out); } catch (e) {}
      if (res.statusCode < 300 && j && j.ok) return cb(null, "sent", j);
      cb(new Error("Webhook " + res.statusCode + " " + (j ? JSON.stringify(j) : out.slice(0, 120))));
    });
  });
  req.setTimeout(20000, () => req.destroy(new Error("Webhook timeout")));
  req.on("error", (e) => cb(e));
  req.end(body || undefined);
}
function sendMail(to, subject, text, cb, meta) {
  if (DEV_MAIL) return cb(null, "dev");
  if (MAIL_WEBHOOK) return webhookReq(MAIL_WEBHOOK, JSON.stringify({ to, nome: meta && meta.nome, link: meta && meta.link }), cb);
  if (BREVO_KEY) return sendMailBrevo(to, subject, text, cb);
  const S = CFG.smtp;
  const from = (S.from || S.user).match(/<([^>]+)>/) ? S.from.match(/<([^>]+)>/)[1] : (S.from || S.user);
  const lines = [];
  const sock = tls.connect({ host: S.host, port: S.port || 465, servername: S.host }, () => {});
  let step = 0, buf = "";
  const cmds = [
    "EHLO chesstable", "AUTH LOGIN",
    Buffer.from(S.user).toString("base64"), Buffer.from(S.pass).toString("base64"),
    "MAIL FROM:<" + from + ">", "RCPT TO:<" + to + ">", "DATA",
    "From: " + (S.from || S.user) + "\r\nTo: " + to + "\r\nSubject: " + subject +
      "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + text + "\r\n.",
    "QUIT"
  ];
  sock.setTimeout(15000, () => { sock.destroy(); cb(new Error("SMTP timeout")); });
  sock.on("error", (e) => cb(e));
  sock.on("data", (d) => {
    buf += d.toString();
    if (!/\r\n$/.test(buf)) return;
    const code = parseInt(buf, 10);
    buf = "";
    if (code >= 500) { sock.destroy(); return cb(new Error("SMTP " + code)); }
    if (step < cmds.length) sock.write(cmds[step++] + "\r\n");
    else { sock.end(); cb(null, "sent"); }
  });
}
// Confere o token do "Entrar com Google" no endpoint público do próprio Google.
function verificarGoogle(credential, cb) {
  const req = https.request({
    host: "oauth2.googleapis.com",
    path: "/tokeninfo?id_token=" + encodeURIComponent(credential),
    method: "GET"
  }, (res) => {
    let out = "";
    res.on("data", (d) => out += d);
    res.on("end", () => {
      let j = null; try { j = JSON.parse(out); } catch (e) {}
      if (res.statusCode !== 200 || !j || !j.sub) return cb(new Error("token recusado pelo Google"));
      if (GOOGLE_CLIENT_ID && j.aud !== GOOGLE_CLIENT_ID) return cb(new Error("token de outro aplicativo"));
      if (String(j.email_verified) !== "true") return cb(new Error("e-mail não verificado no Google"));
      if (Number(j.exp) * 1000 < Date.now()) return cb(new Error("token vencido"));
      cb(null, j);
    });
  });
  req.setTimeout(15000, () => req.destroy(new Error("Google demorou a responder")));
  req.on("error", (e) => cb(e));
  req.end();
}

function apelidoSugerido(email) {
  let base = String(email || "").split("@")[0].replace(/[^A-Za-z0-9_]/g, "");
  if (base.length < 3) base = "jogador";
  return base.slice(0, 16);
}

function baseUrl(req) {
  if (CFG.baseUrl) return CFG.baseUrl.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "http";
  return proto + "://" + req.headers.host;
}

/* ---------------- rating Glicko (como o chess.com) ---------------- */
const Q = Math.log(10) / 400;
function gRD(rd) { return 1 / Math.sqrt(1 + 3 * Q * Q * rd * rd / (Math.PI * Math.PI)); }
function glicko(u, o, s) { // u joga contra o, resultado s (1/0.5/0)
  const g = gRD(o.rd);
  const Ex = 1 / (1 + Math.pow(10, -g * (u.rating - o.rating) / 400));
  const d2 = 1 / (Q * Q * g * g * Ex * (1 - Ex));
  const denom = 1 / (u.rd * u.rd) + 1 / d2;
  const nr = u.rating + (Q / denom) * g * (s - Ex);
  const nrd = Math.max(50, Math.min(350, Math.sqrt(1 / denom)));
  return { rating: nr, rd: nrd };
}
function applyResult(wName, bName, sWhite) { // sWhite: 1 brancas venceram, 0 perderam, 0.5 empate
  const w = db.users[userKey(wName)], b = db.users[userKey(bName)];
  const oldW = Math.round(w.rating), oldB = Math.round(b.rating);
  const nw = glicko(w, b, sWhite), nb = glicko(b, w, 1 - sWhite);
  w.rating = nw.rating; w.rd = nw.rd; b.rating = nb.rating; b.rd = nb.rd;
  w.partidas++; b.partidas++;
  if (sWhite === 1) { w.vitorias++; b.derrotas++; }
  else if (sWhite === 0) { w.derrotas++; b.vitorias++; }
  else { w.empates++; b.empates++; }
  save();
  return { w: { antes: oldW, depois: Math.round(w.rating) }, b: { antes: oldB, depois: Math.round(b.rating) } };
}

/* ---------------- HTTP: estático + API ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function readBody(req, cb) {
  let b = "";
  req.on("data", (d) => { b += d; if (b.length > 1e6) req.destroy(); });
  req.on("end", () => { try { cb(JSON.parse(b || "{}")); } catch (e) { cb({}); } });
}
function page(res, title, msg) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!DOCTYPE html><html lang='pt-BR'><meta charset='utf-8'><body style=\"font-family:sans-serif;background:#191622;color:#eceaf4;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center\"><div><h1 style='color:#c9a84c'>♞ chesstable</h1><h2>" + title + "</h2><p>" + msg + "</p><p><a href='/' style='color:#8b6ce8'>← Voltar ao jogo</a></p></div></body></html>");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/" || p === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
  }
  if (p === "/privacidade") {
    return page(res, "Política de Privacidade",
      "O chesstable é um jogo gratuito de xadrez com cartas.<br><br>" +
      "<b>O que guardamos:</b> seu nome no jogo, o endereço de e-mail da Conta do Google usada para entrar, " +
      "seu identificador do Google, seu rating e o histórico de vitórias, derrotas e empates.<br><br>" +
      "<b>Para que serve:</b> identificar você entre as partidas e manter o ranking. Nada é vendido, " +
      "compartilhado com terceiros ou usado para publicidade.<br><br>" +
      "<b>Entrar com Google:</b> recebemos do Google apenas seu e-mail e identificador. Nunca temos acesso " +
      "à sua senha nem a outros dados da sua conta.<br><br>" +
      "<b>Apagar seus dados:</b> peça por e-mail para oclaw7072@gmail.com e a conta e o histórico são removidos.<br><br>" +
      "<b>Contato:</b> oclaw7072@gmail.com");
  }

  if (p === "/termos") {
    return page(res, "Termos de Serviço",
      "O chesstable é oferecido gratuitamente, no estado em que se encontra, sem garantia de " +
      "funcionamento contínuo ou de preservação de partidas e ratings.<br><br>" +
      "<b>Uso:</b> jogue de forma respeitosa. Contas usadas para trapaça, abuso ou automação podem ser " +
      "removidas sem aviso.<br><br>" +
      "<b>Conta:</b> o acesso é feito pela sua Conta do Google. Você pode pedir a remoção da sua conta " +
      "a qualquer momento pelo e-mail abaixo.<br><br>" +
      "<b>Mudanças:</b> estes termos podem mudar conforme o jogo evolui.<br><br>" +
      "<b>Contato:</b> oclaw7072@gmail.com");
  }

  // Entrar com Google: o próprio Google confirma quem é a pessoa, sem e-mail nem senha.
  if (p === "/api/google" && req.method === "POST") {
    return readBody(req, (b) => {
      if (!GOOGLE_CLIENT_ID) return json(res, 500, { erro: "Login com Google ainda não configurado no servidor." });
      verificarGoogle(String(b.credential || ""), (err, info) => {
        if (err) return json(res, 400, { erro: "Login do Google recusado: " + err.message });
        const gid = info.sub;
        let k = null;
        for (const chave in db.users) if (db.users[chave].gid === gid) { k = chave; break; }
        if (k) {
          const u = db.users[k];
          return json(res, 200, { ok: true, token: newSession(u.nome), usuario: pubUser(u) });
        }
        // conta antiga criada por e-mail: liga ao Google quando o endereço é o mesmo
        for (const chave in db.users) {
          const u = db.users[chave];
          if (!u.gid && u.email && u.email.toLowerCase() === String(info.email).toLowerCase()) {
            u.gid = gid; u.verificado = true; delete u.vtoken; delete u.salt; delete u.hash; save();
            console.log("[conta ligada ao google]", u.nome, info.email);
            return json(res, 200, { ok: true, token: newSession(u.nome), usuario: pubUser(u) });
          }
        }
        const nome = String(b.nome || "").trim();
        if (!nome) return json(res, 200, { ok: true, precisaNome: true, sugestao: apelidoSugerido(info.email) });
        if (!/^[A-Za-z0-9_]{3,16}$/.test(nome)) return json(res, 400, { erro: "Nome: 3–16 letras, números ou _" });
        const nk = userKey(nome);
        if (db.users[nk]) return json(res, 400, { erro: "Este nome já está em uso." });
        db.users[nk] = { nome, email: info.email, gid, verificado: true,
          rating: 1200, rd: 350, partidas: 0, vitorias: 0, derrotas: 0, empates: 0, criado: Date.now() };
        save();
        console.log("[conta google]", nome, info.email);
        json(res, 200, { ok: true, token: newSession(nome), usuario: pubUser(db.users[nk]) });
      });
    });
  }

  if (p === "/api/config") return json(res, 200, { googleClientId: GOOGLE_CLIENT_ID });

  if (p === "/api/eu") {
    const u = sessionUser(req.headers["x-token"]);
    return u ? json(res, 200, { ok: true, usuario: pubUser(u) }) : json(res, 401, { erro: "Sessão inválida." });
  }
  if (p === "/api/sair" && req.method === "POST") {
    delete db.sessions[req.headers["x-token"]]; save();
    return json(res, 200, { ok: true });
  }
  if (p === "/api/ranking") {
    const top = Object.values(db.users).filter(u => u.verificado)
      .sort((a, b2) => b2.rating - a.rating).slice(0, 10).map(pubUser);
    return json(res, 200, { top });
  }
  res.writeHead(404); res.end("404");
});

/* ---------------- WebSocket (RFC 6455 mínimo) ---------------- */
function wsAccept(key) {
  return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function wsSend(sock, obj) {
  if (!sock || sock.destroyed) return;
  const data = Buffer.from(JSON.stringify(obj));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([header, data]));
}
function wsParse(sock, onMsg, onClose) {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (true) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = buf[1] & 0x80;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (masked) {
        const mask = buf.slice(off - 4, off);
        payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
      }
      buf = buf.slice(off + len);
      if (op === 8) { onClose(); try { sock.end(); } catch (e) {} return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; } // pong
      if (op === 1 && fin) { try { onMsg(JSON.parse(payload.toString())); } catch (e) {} }
    }
  });
  sock.on("close", onClose);
  sock.on("error", onClose);
}


/* ---------------- matchmaking por formato de tempo e partidas ---------------- */
const TCS = [60, 180, 600];                  // formatos: 1, 3 e 10 minutos
const filas = { 60: [], 180: [], 600: [] };  // uma fila por formato
const online = new Map();                    // nome -> {sock, gameId}
const jogos = new Map();                     // id -> {id, w, b, state, tc, clock, lastTick, timer}

function tiraDaFila(nome) {
  for (const tc of TCS) filas[tc] = filas[tc].filter(f => f.nome !== nome);
}

function armaRelogio(g) {
  clearTimeout(g.timer);
  if (g.state.over) return;
  const cur = g.state.turn;
  g.timer = setTimeout(() => {
    if (g.state.over || !jogos.has(g.id)) return;
    g.clock[cur] = 0;
    fimDeJogo(g, cur === "w" ? 0 : 1, "tempo"); // quem estourou o tempo perde
  }, Math.max(0, g.clock[cur]) + 60);
}

function criaJogo(a, b, tc) {
  const brancoPrimeiro = Math.random() < 0.5;
  const wn = brancoPrimeiro ? a.nome : b.nome;
  const bn = brancoPrimeiro ? b.nome : a.nome;
  const id = crypto.randomBytes(8).toString("hex");
  const state = E.initialState();
  const g = { id, w: wn, b: bn, state, tc,
    clock: { w: tc * 1000, b: tc * 1000 }, lastTick: Date.now(), timer: null };
  jogos.set(id, g);
  online.get(wn).gameId = id;
  online.get(bn).gameId = id;
  const uw = pubUser(db.users[userKey(wn)]), ub = pubUser(db.users[userKey(bn)]);
  wsSend(online.get(wn).sock, { t: "match", state, cor: "w", oponente: ub, tc, clock: g.clock });
  wsSend(online.get(bn).sock, { t: "match", state, cor: "b", oponente: uw, tc, clock: g.clock });
  armaRelogio(g);
  console.log("[partida " + tc + "s]", wn, "(brancas) x", bn, "(pretas)");
}

function fimDeJogo(g, sWhite, motivo) {
  clearTimeout(g.timer);
  const ratings = applyResult(g.w, g.b, sWhite);
  for (const par of [[g.w, "w"], [g.b, "b"]]) {
    const nome = par[0], cor = par[1];
    const o = online.get(nome);
    if (o) {
      o.gameId = null;
      wsSend(o.sock, { t: "fim", motivo, sWhite, cor, ratings, clock: g.clock,
        usuario: pubUser(db.users[userKey(nome)]) });
    }
  }
  jogos.delete(g.id);
  console.log("[fim]", g.w, "x", g.b, "→", motivo, sWhite);
}

server.on("upgrade", (req, sock) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return sock.destroy();
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n");
  let nome = null;

  const desconecta = () => {
    if (!nome) return;
    const o = online.get(nome);
    if (o && o.sock === sock) {
      tiraDaFila(nome);
      if (o.gameId && jogos.has(o.gameId)) {
        const g = jogos.get(o.gameId);
        fimDeJogo(g, g.w === nome ? 0 : 1, "abandono"); // quem cai perde
      }
      online.delete(nome);
    }
    nome = null;
  };

  wsParse(sock, (m) => {
    if (m.t === "auth") {
      const u = sessionUser(m.token);
      if (!u) return wsSend(sock, { t: "erro", erro: "Sessão inválida — faça login de novo." });
      if (online.has(u.nome)) { try { online.get(u.nome).sock.end(); } catch (e) {} }
      nome = u.nome;
      online.set(nome, { sock, gameId: null });
      return wsSend(sock, { t: "authed", usuario: pubUser(u) });
    }
    if (!nome) return;
    const o = online.get(nome);

    if (m.t === "buscar") {
      if (o.gameId) return;
      const tc = parseInt(m.tc, 10);
      if (TCS.indexOf(tc) < 0) return wsSend(sock, { t: "erro", erro: "Formato de tempo inválido." });
      tiraDaFila(nome); // troca de fila se já estava em outra
      filas[tc].push({ nome, sock });
      wsSend(sock, { t: "na-fila", tc });
      if (filas[tc].length >= 2) {
        const a = filas[tc].shift(), b = filas[tc].shift();
        criaJogo(a, b, tc);
      }
      return;
    }
    if (m.t === "cancelar-busca") { tiraDaFila(nome); return wsSend(sock, { t: "fora-da-fila" }); }

    const g = o.gameId && jogos.get(o.gameId);
    if (!g) return;
    const minhaCor = g.w === nome ? "w" : "b";
    const opNome = minhaCor === "w" ? g.b : g.w;
    const opSock = online.get(opNome) && online.get(opNome).sock;

    if (m.t === "action") {
      if (g.state.turn !== minhaCor) return wsSend(sock, { t: "invalido", state: g.state, clock: g.clock });
      // desconta o tempo gasto no lance
      const agora = Date.now();
      g.clock[minhaCor] -= (agora - g.lastTick);
      if (g.clock[minhaCor] <= 0) { g.clock[minhaCor] = 0; return fimDeJogo(g, minhaCor === "w" ? 0 : 1, "tempo"); }
      const r = E.applyAction(g.state, m.action);
      if (!r.ok) { g.lastTick = agora; armaRelogio(g); return wsSend(sock, { t: "invalido", state: g.state, clock: g.clock }); }
      g.lastTick = agora;
      wsSend(opSock, { t: "action", action: m.action, clock: g.clock });
      wsSend(sock, { t: "clock", clock: g.clock });
      if (g.state.over) {
        const ov = g.state.over;
        fimDeJogo(g, ov.result === "mate" ? (ov.winner === "w" ? 1 : 0) : 0.5,
          ov.result === "mate" ? "xeque-mate" : "afogamento");
      } else {
        armaRelogio(g);
      }
      return;
    }
    if (m.t === "desistir") return fimDeJogo(g, minhaCor === "w" ? 0 : 1, "desistencia");
    if (m.t === "empate-oferta") return wsSend(opSock, { t: "empate-oferta" });
    if (m.t === "empate-recusa") return wsSend(opSock, { t: "empate-recusa" });
    if (m.t === "empate-aceite") return fimDeJogo(g, 0.5, "empate-acordado");
  }, desconecta);
});

carregarDB().then((onde) => {
  console.log("💾 Dados em: " + onde);
  iniciarServidor();
}).catch((e) => {
  console.log("ERRO BANCO (carregar):", e.message, "— subindo mesmo assim com dados vazios.");
  iniciarServidor();
});

function iniciarServidor() {
server.listen(PORT, () => {
  console.log("♞ chesstable rodando em http://localhost:" + PORT);
  console.log(DEV_MAIL
    ? "✉️  E-mail não configurado: modo demonstração (o link de confirmação aparece na tela e no console)."
    : "✉️  E-mail configurado (" + (MAIL_WEBHOOK ? "Gmail via Apps Script" : BREVO_KEY ? "API Brevo" : "SMTP") + "): confirmações serão enviadas de verdade.");
});
}
