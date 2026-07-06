// Finanse Tracker - backend (czysty Node.js, bez zaleznosci)
// Odbiera dane z moda (POST /api/ingest) i serwuje dashboard + API (/api/data).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Konfiguracja ----------
function loadConfig() {
  let cfg = {
    port: Number(process.env.PORT) || 3000,
    apiKey: process.env.FINANSE_API_KEY || '',
    retainDays: 30,
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('[config] blad odczytu config.json:', e.message);
  }
  // env ma pierwszenstwo
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.FINANSE_API_KEY) cfg.apiKey = process.env.FINANSE_API_KEY;

  // wygeneruj klucz przy pierwszym uruchomieniu
  if (!cfg.apiKey) {
    cfg.apiKey = crypto.randomBytes(12).toString('hex');
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch {}
  } else if (!fs.existsSync(CONFIG_FILE)) {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch {}
  }
  return cfg;
}
const CONFIG = loadConfig();

// ---------- Historia (wielu graczy) ----------
// Struktura: { players: { "<nick>": { points: [{t,v}], latest: {t,v,p,raw} } } }
let db = { players: {} };
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    if (raw && raw.players) {
      db = raw;
    } else if (raw && Array.isArray(raw.points)) {
      // migracja ze starego formatu (jeden gracz) na nowy
      const name = (raw.latest && raw.latest.p) || 'gracz';
      db = { players: { [name]: { points: raw.points, latest: raw.latest || null } } };
    }
  }
} catch (e) {
  console.error('[history] blad odczytu, zaczynam od zera:', e.message);
  db = { players: {} };
}

let writeTimer = null;
function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(db));
    } catch (e) {
      console.error('[history] blad zapisu:', e.message);
    }
  }, 3000);
}

function prune(p) {
  const cutoff = Date.now() - CONFIG.retainDays * 86400_000;
  if (p.points.length && p.points[0].t < cutoff) {
    p.points = p.points.filter((x) => x.t >= cutoff);
  }
  const MAX = 200_000;
  if (p.points.length > MAX) {
    p.points = p.points.slice(p.points.length - MAX);
  }
}

function cleanName(s) {
  if (typeof s !== 'string') return 'gracz';
  const n = s.trim().slice(0, 32);
  return n || 'gracz';
}

function addPoint(value, raw, player) {
  const now = Date.now();
  const name = cleanName(player);
  let p = db.players[name];
  if (!p) { p = { points: [], latest: null }; db.players[name] = p; }

  p.latest = { t: now, v: value, p: name, raw: raw || null };
  const last = p.points[p.points.length - 1];
  if (!last || last.v !== value || now - last.t >= 60_000) {
    p.points.push({ t: now, v: value });
    prune(p);
  }
  scheduleSave();
}

function isConn(p, now) {
  return !!(p && p.latest && (now - p.latest.t) < 30_000);
}

// lista graczy posortowana wg ostatniej aktywnosci
function playerList(now) {
  return Object.entries(db.players)
    .map(([name, p]) => ({
      name,
      lastTs: p.latest ? p.latest.t : 0,
      value: p.latest ? p.latest.v : null,
      connected: isConn(p, now),
    }))
    .sort((a, b) => b.lastTs - a.lastTs);
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // CORS (na wypadek gdyby strona byla hostowana gdzie indziej)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url === '/api/ingest' && req.method === 'POST') {
    // autoryzacja
    if (CONFIG.apiKey && req.headers['x-api-key'] !== CONFIG.apiKey) {
      return sendJson(res, 401, { ok: false, error: 'zly api key' });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'zly JSON' });
    }
    const value = Number(body.value);
    if (!isFinite(value)) return sendJson(res, 400, { ok: false, error: 'brak/zla wartosc' });
    addPoint(value, typeof body.raw === 'string' ? body.raw.slice(0, 80) : null, body.player);
    return sendJson(res, 200, { ok: true });
  }

  if (url === '/api/players' && req.method === 'GET') {
    return sendJson(res, 200, { players: playerList(Date.now()) });
  }

  if (url === '/api/data' && req.method === 'GET') {
    const now = Date.now();
    const q = new URL(req.url, 'http://x').searchParams;
    let name = q.get('player');
    let p = name ? db.players[name] : null;
    // brak/nieznany gracz -> wybierz ostatnio aktywnego
    if (!p) {
      const list = playerList(now);
      name = list.length ? list[0].name : null;
      p = name ? db.players[name] : null;
    }
    return sendJson(res, 200, {
      now,
      player: name,
      connected: isConn(p, now),
      latest: p ? p.latest : null,
      points: p ? p.points : [],
      players: playerList(now),
    });
  }

  if (url === '/api/health') {
    const total = Object.values(db.players).reduce((s, p) => s + p.points.length, 0);
    return sendJson(res, 200, { ok: true, players: Object.keys(db.players).length, points: total });
  }

  if (req.method === 'GET') return serveStatic(req, res);

  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(CONFIG.port, () => {
  console.log('==================================================');
  console.log('  FINANSE TRACKER - serwer wystartowal');
  console.log('  Dashboard:  http://localhost:' + CONFIG.port);
  console.log('  Endpoint dla moda:  http://localhost:' + CONFIG.port + '/api/ingest');
  console.log('  API KEY:  ' + CONFIG.apiKey);
  console.log('  (wpisz ten sam API KEY w GUI moda w Minecrafcie)');
  console.log('==================================================');
});
