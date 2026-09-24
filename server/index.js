// Canvas++ — servidor de sincronización
// Guarda cada proyecto como JSON en CANVAS_DATA y sincroniza en tiempo real por WebSocket.
// Resolución de conflictos: last-writer-wins por elemento (rev, by).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.CANVAS_DATA || '/data');
const TOKEN = process.env.CANVAS_TOKEN || '';
const PUBLIC_DIR = path.resolve(process.env.CANVAS_PUBLIC || path.join(__dirname, 'public'));
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
const ASSETS_DIR = path.join(DATA_DIR, 'assets'); // imágenes de documentos (PDF/Word importados)
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(TRASH_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

if (!TOKEN) console.warn('[canvas++] AVISO: CANVAS_TOKEN vacío, el servidor no pide autenticación.');

// ---------- utilidades ----------
function isNewer(a, b) {
  if (!b) return true;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return String(a.by || '') > String(b.by || '');
}

function checkToken(given) {
  if (!TOKEN) return true;
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenFromReq(req, url) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token') || '';
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...corsHeaders(),
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  };
}

async function readBody(req, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('payload demasiado grande');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// ---------- almacenamiento ----------
/** @type {Map<string, {meta: any, items: Map<string, any>, dirty: boolean, timer: any, clients: Set<any>}>} */
const projects = new Map();

function projectFile(id) {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

async function loadAllMeta() {
  const files = (await fsp.readdir(PROJECTS_DIR)).filter((f) => f.endsWith('.json'));
  const metas = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    const p = await getProject(id);
    if (p) metas.push(publicMeta(p));
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

function publicMeta(p) {
  let count = 0;
  for (const it of p.items.values()) if (!it.deleted) count++;
  return { ...p.meta, itemCount: count };
}

async function getProject(id) {
  if (!ID_RE.test(id)) return null;
  if (projects.has(id)) return projects.get(id);
  try {
    const raw = JSON.parse(await fsp.readFile(projectFile(id), 'utf8'));
    const p = {
      meta: raw.meta,
      items: new Map((raw.items || []).map((it) => [it.id, it])),
      dirty: false,
      timer: null,
      clients: new Set(),
    };
    projects.set(id, p);
    return p;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[canvas++] error leyendo', id, e.message);
    return null;
  }
}

async function createProject(id, name) {
  const now = Date.now();
  const p = {
    meta: { id, name: name || 'Sin título', createdAt: now, updatedAt: now },
    items: new Map(),
    dirty: true,
    timer: null,
    clients: new Set(),
  };
  projects.set(id, p);
  await saveNow(id);
  return p;
}

function scheduleSave(id) {
  const p = projects.get(id);
  if (!p) return;
  p.dirty = true;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => saveNow(id).catch((e) => console.error('[canvas++] save', e)), 800);
}

async function saveNow(id) {
  const p = projects.get(id);
  if (!p || !p.dirty) return;
  p.dirty = false;
  const data = JSON.stringify({ meta: p.meta, items: [...p.items.values()] });
  const tmp = projectFile(id) + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, projectFile(id)); // escritura atómica
}

function mergeOps(p, ops) {
  const accepted = [];
  const rejected = [];
  for (const op of ops) {
    if (!op || typeof op.id !== 'string' || typeof op.rev !== 'number') continue;
    const cur = p.items.get(op.id);
    if (isNewer(op, cur)) {
      p.items.set(op.id, op);
      accepted.push(op);
    } else if (cur) {
      rejected.push(cur); // el cliente debe adoptar la versión ganadora
    }
  }
  if (accepted.length) p.meta.updatedAt = Date.now();
  return { accepted, rejected };
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
  try {
    const st = await fsp.stat(file);
    if (st.isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
  } catch {}
  try {
    const html = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(html);
  } catch {
    return send(res, 200, 'Canvas++ server OK. (No hay cliente web compilado en /public)');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);

    if (url.pathname === '/api/health') return send(res, 200, { ok: true, auth: !!TOKEN, version: 1 });
    if (!checkToken(tokenFromReq(req, url))) return send(res, 401, { error: 'token inválido' });

    // ----- assets binarios (imágenes de documentos) -----
    const am = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (am) {
      const aid = am[1];
      if (!ID_RE.test(aid)) return send(res, 400, { error: 'id inválido' });
      const file = path.join(ASSETS_DIR, aid);
      if (req.method === 'GET' || req.method === 'HEAD') {
        try {
          const [st, type] = await Promise.all([
            fsp.stat(file),
            fsp.readFile(file + '.type', 'utf8').catch(() => 'application/octet-stream'),
          ]);
          res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': st.size,
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            ...corsHeaders(),
          });
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(file).pipe(res);
        } catch {
          return send(res, 404, { error: 'no existe' });
        }
      }
      if (req.method === 'PUT') {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 50 * 1024 * 1024) return send(res, 413, { error: 'archivo demasiado grande' });
          chunks.push(c);
        }
        const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
        if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return send(res, 415, { error: 'tipo no permitido' });
        await fsp.writeFile(file + '.tmp', Buffer.concat(chunks));
        await fsp.rename(file + '.tmp', file);
        await fsp.writeFile(file + '.type', type);
        return send(res, 201, { ok: true, id: aid, size });
      }
      return send(res, 405, { error: 'método no permitido' });
    }

    const m = url.pathname.match(/^\/api\/projects(?:\/([^/]+))?$/);
    if (!m) return send(res, 404, { error: 'no encontrado' });
    const id = m[1];

    if (!id && req.method === 'GET') return send(res, 200, await loadAllMeta());

    if (!id && req.method === 'POST') {
      const body = await readBody(req);
      const newId = body.id && ID_RE.test(body.id) ? body.id : crypto.randomUUID();
      let p = await getProject(newId);
      const created = !p;
      if (!p) p = await createProject(newId, String(body.name || '').slice(0, 200));
      // proyecto creado sin conexión: el cliente sube sus elementos al darlo de alta
      if (Array.isArray(body.items) && body.items.length) {
        const { accepted } = mergeOps(p, body.items);
        if (accepted.length) {
          scheduleSave(newId);
          broadcast(p, { t: 'ops', ops: accepted });
        }
      }
      return send(res, created ? 201 : 200, publicMeta(p));
    }

    if (!id) return send(res, 405, { error: 'método no permitido' });
    const p = await getProject(id);
    if (!p) return send(res, 404, { error: 'proyecto no existe' });

    if (req.method === 'GET') {
      return send(res, 200, { meta: publicMeta(p), items: [...p.items.values()] });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (typeof body.name === 'string') p.meta.name = body.name.slice(0, 200);
      p.meta.updatedAt = Date.now();
      scheduleSave(id);
      broadcast(p, { t: 'meta', meta: publicMeta(p) });
      return send(res, 200, publicMeta(p));
    }
    if (req.method === 'DELETE') {
      await saveNow(id);
      for (const c of p.clients) c.close(4404, 'proyecto eliminado');
      projects.delete(id);
      await fsp.rename(projectFile(id), path.join(TRASH_DIR, `${id}-${Date.now()}.json`)).catch(() => {});
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'método no permitido' });
  } catch (e) {
    console.error('[canvas++]', e);
    return send(res, 500, { error: String(e.message || e) });
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

function broadcast(p, msg, except) {
  const data = JSON.stringify(msg);
  for (const c of p.clients) if (c !== except && c.readyState === 1) c.send(data);
}

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  if (!checkToken(url.searchParams.get('token'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  const id = url.searchParams.get('project') || '';
  const name = url.searchParams.get('name') || '';
  let p = await getProject(id);
  if (!p) {
    if (!ID_RE.test(id)) return socket.destroy();
    p = await createProject(id, name); // proyecto creado offline en otro dispositivo
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, p, id, url.searchParams.get('client') || 'anon'));
});

function onConnection(ws, p, id, clientId) {
  p.clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.send(JSON.stringify({ t: 'snapshot', meta: publicMeta(p), items: [...p.items.values()] }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'ops' && Array.isArray(msg.ops)) {
      const { accepted, rejected } = mergeOps(p, msg.ops);
      if (accepted.length) {
        scheduleSave(id);
        broadcast(p, { t: 'ops', ops: accepted }, ws);
      }
      if (rejected.length) ws.send(JSON.stringify({ t: 'ops', ops: rejected }));
      ws.send(JSON.stringify({ t: 'ack', seq: msg.seq }));
    } else if (msg.t === 'cursor') {
      broadcast(p, { t: 'cursor', client: clientId, x: msg.x, y: msg.y, color: msg.color }, ws);
    }
  });

  ws.on('close', () => {
    p.clients.delete(ws);
    broadcast(p, { t: 'leave', client: clientId });
  });
}

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

async function shutdown() {
  clearInterval(heartbeat);
  for (const id of projects.keys()) await saveNow(id).catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`[canvas++] escuchando en :${PORT}  datos=${DATA_DIR}  web=${PUBLIC_DIR}`);
});
