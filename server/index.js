// Canvas++ — servidor de sincronización
// Guarda cada proyecto como JSON en CANVAS_DATA y sincroniza en tiempo real por WebSocket.
// Resolución de conflictos: last-writer-wins por elemento (rev, by).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { createAuth, httpError } from './auth.js';
import { createActivity } from './activity.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.CANVAS_DATA || '/data');
const TOKEN = process.env.CANVAS_TOKEN || '';
const PUBLIC_DIR = path.resolve(process.env.CANVAS_PUBLIC || path.join(__dirname, 'public'));
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
const ASSETS_DIR = path.join(DATA_DIR, 'assets'); // imágenes, PDF, audio y vídeo
const HISTORY_DIR = path.join(DATA_DIR, 'history'); // versiones anteriores de cada proyecto
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates'); // plantillas personalizadas
const FOLDERS_DIR = path.join(DATA_DIR, 'folders'); // carpetas de cada usuario para organizar sus proyectos
const AVATARS_DIR = path.join(DATA_DIR, 'avatars'); // fotos de perfil
const SNAPSHOT_EVERY = Number(process.env.CANVAS_SNAPSHOT_MIN || 10) * 60 * 1000;
const MAX_AUTO_SNAPSHOTS = 150;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNUP = process.env.CANVAS_SIGNUP === '1'; // permitir que cualquiera se cree una cuenta

fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(TRASH_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });
fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
fs.mkdirSync(FOLDERS_DIR, { recursive: true });
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const auth = createAuth(DATA_DIR, TOKEN);
const activity = createActivity(DATA_DIR);
/** Quién aparece en el historial de actividad. */
const actor = (who) => (who?.user ? { id: who.user.id, name: who.user.name } : { id: 'legacy', name: 'Alguien' });
if (!TOKEN && !auth.hasUsers) console.warn('[canvas++] AVISO: sin CANVAS_TOKEN ni usuarios, el servidor no pide autenticación.');

// ---------- utilidades ----------
function isNewer(a, b) {
  if (!b) return true;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return String(a.by || '') > String(b.by || '');
}

/**
 * Permiso de alguien sobre un proyecto: 'owner' | 'edit' | 'view' | null.
 * who = { legacy: true } (servidor sin cuentas) o { user }.
 */
function accessOf(p, who) {
  if (!who) return null;
  if (who.legacy) return 'owner';
  const owner = p.meta.owner || auth.firstAdmin()?.id; // proyectos de antes de crear cuentas
  if (owner === who.user.id) return 'owner';
  const r = p.meta.members?.[who.user.id];
  return r === 'edit' || r === 'view' ? r : null;
}
const canEdit = (a) => a === 'owner' || a === 'edit';

/** Metadatos que ve cada persona: sin la clave del enlace si no puede gestionarlo. */
function metaFor(p, who) {
  const access = accessOf(p, who);
  const { shareToken, members, ...m } = publicMeta(p);
  const owner = auth.byId(p.meta.owner || auth.firstAdmin()?.id || '');
  return { ...m, access, ownerName: owner?.name, shared: !!members && Object.keys(members).length > 0 };
}

function clientIp(req) {
  // detrás de un proxy inverso de confianza se puede usar la cabecera X-Forwarded-For (CANVAS_TRUST_PROXY=1)
  if (process.env.CANVAS_TRUST_PROXY === '1') return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  return req.socket.remoteAddress || '';
}

/** Cierra las conexiones en vivo de un usuario en un proyecto (p.ej. al quitarle el acceso): al reconectar recibe el permiso nuevo. */
function kick(p, userId) {
  for (const c of p.clients) if (c.userId === userId) c.close(4403, 'permisos cambiados');
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
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Range',
    'Access-Control-Expose-Headers': 'Content-Range,Accept-Ranges,Content-Length',
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

async function allProjects() {
  const files = (await fsp.readdir(PROJECTS_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const p = await getProject(f.slice(0, -5));
    if (p) out.push(p);
  }
  return out;
}

async function loadAllMeta(who) {
  const metas = [];
  for (const p of await allProjects()) if (accessOf(p, who)) metas.push(metaFor(p, who));
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

async function createProject(id, name, owner) {
  const now = Date.now();
  const p = {
    meta: { id, name: name || 'Sin título', createdAt: now, updatedAt: now, ...(owner ? { owner } : {}) },
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
  if (Date.now() - (await lastSnapshotAt(id)) > SNAPSHOT_EVERY) await snapshot(id, data, '').catch((e) => console.error('[canvas++] historial', e));
}

// ---------- historial de versiones ----------
function historyDir(id) {
  return path.join(HISTORY_DIR, id);
}
async function readIndex(id) {
  try {
    return JSON.parse(await fsp.readFile(path.join(historyDir(id), 'index.json'), 'utf8'));
  } catch {
    return [];
  }
}
async function lastSnapshotAt(id) {
  const p = projects.get(id);
  if (p?.lastSnap != null) return p.lastSnap;
  const idx = await readIndex(id);
  const t = idx.length ? idx[idx.length - 1].ts : 0;
  if (p) p.lastSnap = t;
  return t;
}
/** Guarda una copia comprimida del proyecto. label vacío = automática. */
async function snapshot(id, data, label) {
  const dir = historyDir(id);
  await fsp.mkdir(dir, { recursive: true });
  const ts = Date.now();
  await fsp.writeFile(path.join(dir, `${ts}.json.gz`), await gzip(data));
  const items = JSON.parse(data).items.filter((i) => !i.deleted).length;
  let idx = await readIndex(id);
  idx.push({ ts, label: String(label || '').slice(0, 100), items });
  // se conservan todas las versiones con nombre y las últimas automáticas
  const autos = idx.filter((v) => !v.label);
  const drop = new Set(autos.slice(0, Math.max(0, autos.length - MAX_AUTO_SNAPSHOTS)).map((v) => v.ts));
  for (const t of drop) await fsp.rm(path.join(dir, `${t}.json.gz`), { force: true });
  idx = idx.filter((v) => !drop.has(v.ts));
  await fsp.writeFile(path.join(dir, 'index.json'), JSON.stringify(idx));
  const p = projects.get(id);
  if (p) p.lastSnap = ts;
  return { ts, label, items };
}
async function readSnapshot(id, ts) {
  if (!/^\d{10,16}$/.test(String(ts))) return null;
  try {
    return JSON.parse((await gunzip(await fsp.readFile(path.join(historyDir(id), `${ts}.json.gz`)))).toString('utf8'));
  } catch {
    return null;
  }
}

// ---------- enlaces de solo lectura ----------
function checkShare(p, s) {
  const t = p?.meta?.shareToken;
  if (!t || typeof s !== 'string') return false;
  const a = Buffer.from(s);
  const b = Buffer.from(t);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

    if (url.pathname === '/api/health')
      return send(res, 200, { ok: true, auth: !!TOKEN || auth.hasUsers, users: auth.hasUsers, setupToken: !auth.hasUsers && !!TOKEN, signup: SIGNUP, version: 2 });

    // ----- cuentas: alta del primer administrador, inicio de sesión y registro -----
    if (url.pathname === '/api/auth/setup' && req.method === 'POST') {
      const body = await readBody(req, 64 * 1024);
      const u = await auth.setup(body);
      // los proyectos que ya había pasan a ser del administrador
      for (const p of await allProjects()) {
        if (!p.meta.owner) {
          p.meta.owner = u.id;
          p.dirty = true;
          await saveNow(p.meta.id);
        }
      }
      return send(res, 201, { token: auth.issue(u), user: auth.publicUser(u) });
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req, 64 * 1024);
      const u = await auth.login(body.username, body.password, clientIp(req));
      return send(res, 200, { token: auth.issue(u), user: auth.publicUser(u) });
    }
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      if (!SIGNUP || !auth.hasUsers) return send(res, 403, { error: 'El registro está cerrado: pide una cuenta al administrador' });
      const body = await readBody(req, 64 * 1024);
      const u = await auth.create({ username: body.username, password: body.password, name: body.name, role: 'user' });
      return send(res, 201, { token: auth.issue(u), user: auth.publicUser(u) });
    }

    // ----- acceso de solo lectura con enlace compartido (sin token) -----
    const shareKey = url.searchParams.get('s');
    const vm = url.pathname.match(/^\/api\/view\/([^/]+)$/);
    if (vm && req.method === 'GET') {
      const p = await getProject(vm[1]);
      if (!p || !checkShare(p, shareKey)) return send(res, 404, { error: 'enlace no válido' });
      const { shareToken, ...meta } = publicMeta(p);
      return send(res, 200, { meta, items: [...p.items.values()].filter((i) => !i.deleted) });
    }
    let shareOk = false;
    if (shareKey && url.pathname.startsWith('/api/assets/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const p = await getProject(url.searchParams.get('p') || '');
      const aid = url.pathname.split('/').pop();
      // solo assets que aparecen en ese proyecto
      shareOk = !!p && checkShare(p, shareKey) && JSON.stringify([...p.items.values()]).includes(aid);
    }
    const who = shareOk ? null : auth.identify(tokenFromReq(req, url));
    if (!shareOk && !who) return send(res, 401, { error: auth.hasUsers ? 'sesión caducada o no válida' : 'token inválido' });

    // ----- mi cuenta -----
    if (url.pathname.startsWith('/api/auth/')) {
      if (!who.user) return send(res, 400, { error: 'El servidor no tiene cuentas de usuario todavía' });
      const u = who.user;
      if (url.pathname === '/api/auth/me' && req.method === 'GET') return send(res, 200, auth.publicUser(u));
      if (url.pathname === '/api/auth/me' && req.method === 'PATCH') {
        const body = await readBody(req, 64 * 1024);
        await auth.update(u, { name: body.name });
        return send(res, 200, auth.publicUser(u));
      }
      if (url.pathname === '/api/auth/password' && req.method === 'POST') {
        const body = await readBody(req, 64 * 1024);
        if (!(await auth.verifyPassword(u, body.old))) return send(res, 403, { error: 'La contraseña actual no es correcta' });
        await auth.setPassword(u, body.password);
        return send(res, 200, { token: auth.issue(u) }); // las demás sesiones quedan cerradas
      }
      if (url.pathname === '/api/auth/avatar' && req.method === 'PUT') {
        const type = String(req.headers['content-type'] || '');
        if (!/^image\/(jpeg|png|webp)$/.test(type)) return send(res, 415, { error: 'La foto debe ser JPG, PNG o WebP' });
        const chunks = [];
        let size = 0;
        for await (const ch of req) {
          size += ch.length;
          if (size > 1024 * 1024) return send(res, 413, { error: 'La foto es demasiado grande (máx. 1 MB)' });
          chunks.push(ch);
        }
        await fsp.writeFile(path.join(AVATARS_DIR, u.id), Buffer.concat(chunks));
        await fsp.writeFile(path.join(AVATARS_DIR, u.id + '.type'), type);
        await auth.setAvatar(u, Date.now());
        return send(res, 200, auth.publicUser(u));
      }
      if (url.pathname === '/api/auth/avatar' && req.method === 'DELETE') {
        await fsp.rm(path.join(AVATARS_DIR, u.id), { force: true });
        await auth.setAvatar(u, null);
        return send(res, 200, auth.publicUser(u));
      }
      if (url.pathname === '/api/auth/logout-all' && req.method === 'POST') {
        await auth.logoutAll(u);
        return send(res, 200, { token: auth.issue(u) });
      }
      return send(res, 404, { error: 'no encontrado' });
    }

    // ----- fotos de perfil -----
    const avm = url.pathname.match(/^\/api\/avatars\/([^/]+)$/);
    if (avm && req.method === 'GET') {
      if (!ID_RE.test(avm[1])) return send(res, 400, { error: 'id inválido' });
      const f = path.join(AVATARS_DIR, avm[1]);
      try {
        const [buf, type] = await Promise.all([fsp.readFile(f), fsp.readFile(f + '.type', 'utf8').catch(() => 'image/jpeg')]);
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ...corsHeaders() });
        return res.end(buf);
      } catch {
        return send(res, 404, { error: 'sin foto' });
      }
    }

    // ----- usuarios (el administrador los gestiona; los demás solo ven el directorio para compartir) -----
    const um = url.pathname.match(/^\/api\/users(?:\/([^/]+))?$/);
    if (um) {
      const me = who.user;
      if (!me) return send(res, 400, { error: 'El servidor no tiene cuentas de usuario todavía' });
      const isAdmin = me.role === 'admin';
      if (!um[1] && req.method === 'GET') {
        return send(res, 200, isAdmin ? auth.list() : auth.list().map(({ id, username, name, avatar }) => ({ id, username, name, avatar })));
      }
      if (!isAdmin) return send(res, 403, { error: 'Solo el administrador puede gestionar usuarios' });
      if (!um[1] && req.method === 'POST') {
        const body = await readBody(req, 64 * 1024);
        return send(res, 201, auth.publicUser(await auth.create(body)));
      }
      const target = auth.byId(um[1]);
      if (!target) return send(res, 404, { error: 'usuario no existe' });
      if (req.method === 'PATCH') {
        const body = await readBody(req, 64 * 1024);
        await auth.update(target, body);
        if (body.password) await auth.setPassword(target, body.password);
        return send(res, 200, auth.publicUser(target));
      }
      if (req.method === 'DELETE') {
        if (target === me) return send(res, 400, { error: 'No puedes borrar tu propia cuenta' });
        const heir = me;
        await auth.remove(target);
        await fsp.rm(path.join(AVATARS_DIR, target.id), { force: true });
        // sus proyectos pasan al administrador que la borra; se le quita de los compartidos
        for (const p of await allProjects()) {
          let changed = false;
          if (p.meta.owner === target.id) (p.meta.owner = heir.id), (changed = true);
          if (p.meta.members?.[target.id]) delete p.meta.members[target.id], (changed = true);
          if (changed) {
            kick(p, target.id);
            p.dirty = true;
            await saveNow(p.meta.id);
          }
        }
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'método no permitido' });
    }

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
          const headers = {
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': 'sandbox', // un PDF o imagen abierto directamente no puede ejecutar nada
            ...corsHeaders(),
          };
          // peticiones parciales: necesarias para avanzar/retroceder en audio y vídeo
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          if (range && (range[1] || range[2])) {
            let start = range[1] ? parseInt(range[1], 10) : st.size - parseInt(range[2], 10);
            let end = range[1] && range[2] ? parseInt(range[2], 10) : st.size - 1;
            start = Math.max(0, start);
            end = Math.min(st.size - 1, end);
            if (start > end) {
              res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, ...corsHeaders() });
              return res.end();
            }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
            if (req.method === 'HEAD') return res.end();
            return fs.createReadStream(file, { start, end }).pipe(res);
          }
          res.writeHead(200, { ...headers, 'Content-Length': st.size });
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(file).pipe(res);
        } catch {
          return send(res, 404, { error: 'no existe' });
        }
      }
      if (req.method === 'PUT') {
        // los archivos no se sobrescriben nunca (si ya existe, es un reintento del mismo cliente)
        if (await fsp.stat(file).then(() => true, () => false)) return send(res, 200, { ok: true, id: aid, existed: true });
        const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
        if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf|audio\/(webm|ogg|mp4|mpeg|wav|aac|x-m4a)|video\/(mp4|webm|quicktime|ogg))(;.*)?$/.test(type)) return send(res, 415, { error: 'tipo no permitido' });
        // se escribe en disco a medida que llega (vídeos grandes sin llenar la memoria)
        let size = 0;
        const out = fs.createWriteStream(file + '.tmp');
        try {
          for await (const c of req) {
            size += c.length;
            if (size > 500 * 1024 * 1024) throw Object.assign(new Error('grande'), { code: 413 });
            if (!out.write(c)) await new Promise((r) => out.once('drain', r));
          }
          await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
        } catch (e) {
          out.destroy();
          await fsp.rm(file + '.tmp', { force: true });
          return send(res, e.code === 413 ? 413 : 500, { error: e.code === 413 ? 'archivo demasiado grande' : 'error al guardar' });
        }
        await fsp.rename(file + '.tmp', file);
        await fsp.writeFile(file + '.type', type);
        return send(res, 201, { ok: true, id: aid, size });
      }
      return send(res, 405, { error: 'método no permitido' });
    }

    // ----- historial y compartir -----
    // ----- carpetas: cada usuario organiza sus proyectos (y los compartidos con él) a su manera -----
    if (url.pathname === '/api/folders') {
      const file = path.join(FOLDERS_DIR, `${who.user?.id || 'legacy'}.json`);
      if (req.method === 'GET') {
        const data = await fsp.readFile(file, 'utf8').then(JSON.parse, () => ({ folders: [], assign: {}, updatedAt: 0 }));
        return send(res, 200, data);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req, 2 * 1024 * 1024);
        const folders = (Array.isArray(body.folders) ? body.folders : [])
          .filter((f) => f && ID_RE.test(String(f.id)))
          .slice(0, 2000)
          .map((f) => ({ id: String(f.id), name: String(f.name || 'Carpeta').slice(0, 80), parent: f.parent && ID_RE.test(String(f.parent)) ? String(f.parent) : null, color: String(f.color || '').slice(0, 20) }));
        const ids = new Set(folders.map((f) => f.id));
        const assign = {};
        for (const [pid, fid] of Object.entries(body.assign || {})) if (ID_RE.test(pid) && ids.has(String(fid))) assign[pid] = String(fid);
        const data = { folders, assign, updatedAt: Date.now() };
        await fsp.writeFile(file + '.tmp', JSON.stringify(data));
        await fsp.rename(file + '.tmp', file);
        return send(res, 200, data);
      }
      return send(res, 405, { error: 'método no permitido' });
    }

    // ----- plantillas personalizadas (de cada usuario; pueden compartirse con todos) -----
    const tm = url.pathname.match(/^\/api\/templates(?:\/([^/]+))?$/);
    if (tm) {
      const me = who.user?.id || 'legacy';
      const file = (id) => path.join(TEMPLATES_DIR, `${id}.json`);
      const read = async (id) => JSON.parse(await fsp.readFile(file(id), 'utf8'));
      const visible = (t) => t.owner === me || t.shared || who.legacy;
      const summary = (t) => {
        const owner = auth.byId(t.owner);
        return { id: t.id, name: t.name, category: t.category, thumb: t.thumb, shared: !!t.shared, createdAt: t.createdAt, mine: t.owner === me || !!who.legacy, ownerName: owner?.name, count: t.items.length };
      };
      if (!tm[1] && req.method === 'GET') {
        const out = [];
        for (const f of (await fsp.readdir(TEMPLATES_DIR)).filter((f) => f.endsWith('.json'))) {
          const t = await read(f.slice(0, -5)).catch(() => null);
          if (t && visible(t)) out.push(summary(t));
        }
        return send(res, 200, out.sort((a, b) => b.createdAt - a.createdAt));
      }
      if (!tm[1] && req.method === 'POST') {
        const body = await readBody(req);
        if (!Array.isArray(body.items) || !body.items.length) return send(res, 400, { error: 'La plantilla está vacía' });
        const t = {
          id: crypto.randomBytes(9).toString('base64url'),
          name: String(body.name || 'Plantilla').slice(0, 80),
          category: String(body.category || '').slice(0, 40),
          thumb: typeof body.thumb === 'string' && body.thumb.startsWith('data:image/') && body.thumb.length < 400000 ? body.thumb : '',
          shared: !!body.shared,
          owner: me,
          createdAt: Date.now(),
          items: body.items.filter((i) => i && typeof i.id === 'string' && !i.deleted),
        };
        await fsp.writeFile(file(t.id), JSON.stringify(t));
        return send(res, 201, summary(t));
      }
      if (!tm[1] || !ID_RE.test(tm[1])) return send(res, 404, { error: 'no encontrado' });
      const t = await read(tm[1]).catch(() => null);
      if (!t || !visible(t)) return send(res, 404, { error: 'La plantilla no existe' });
      if (req.method === 'GET') return send(res, 200, { ...summary(t), items: t.items });
      if (t.owner !== me && !who.legacy && who.user?.role !== 'admin') return send(res, 403, { error: 'Solo quien la creó puede cambiarla' });
      if (req.method === 'PATCH') {
        const body = await readBody(req, 64 * 1024);
        if (typeof body.name === 'string' && body.name.trim()) t.name = body.name.trim().slice(0, 80);
        if (typeof body.shared === 'boolean') t.shared = body.shared;
        await fsp.writeFile(file(t.id), JSON.stringify(t));
        return send(res, 200, summary(t));
      }
      if (req.method === 'DELETE') {
        await fsp.rm(file(t.id), { force: true });
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'método no permitido' });
    }

    // ----- historial de actividad (quién ha hecho qué) -----
    const acm = url.pathname.match(/^\/api\/projects\/([^/]+)\/activity$/);
    if (acm && req.method === 'GET') {
      const p = await getProject(acm[1]);
      if (!p || !accessOf(p, who)) return send(res, 404, { error: 'proyecto no existe' });
      const before = Number(url.searchParams.get('before')) || Infinity;
      const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
      const list = await activity.list(acm[1], before, limit);
      // nombre y foto actuales de cada persona
      return send(res, 200, list.map((e) => {
        const u = auth.byId(e.user);
        return u ? { ...e, name: u.name, avatar: u.avatar } : e;
      }));
    }

    // ----- personas con acceso a un proyecto -----
    const mm = url.pathname.match(/^\/api\/projects\/([^/]+)\/members(?:\/([^/]+))?$/);
    if (mm) {
      const p = await getProject(mm[1]);
      const access = p && accessOf(p, who);
      if (!access) return send(res, 404, { error: 'proyecto no existe' });
      if (!who.user) return send(res, 400, { error: 'El servidor no tiene cuentas de usuario todavía' });
      const list = () => {
        const owner = auth.byId(p.meta.owner || auth.firstAdmin()?.id || '');
        const out = owner ? [{ ...auth.publicUser(owner), access: 'owner' }] : [];
        for (const [uid, r] of Object.entries(p.meta.members || {})) {
          const u = auth.byId(uid);
          if (u) out.push({ ...auth.publicUser(u), access: r });
        }
        return out.map(({ role, ...x }) => x);
      };
      if (!mm[2] && req.method === 'GET') return send(res, 200, list());
      if (!mm[2] && req.method === 'POST') {
        if (access !== 'owner') return send(res, 403, { error: 'Solo quien creó el proyecto puede compartirlo' });
        const body = await readBody(req, 64 * 1024);
        const u = auth.byName(body.username) || auth.byId(String(body.id || ''));
        if (!u) return send(res, 404, { error: 'No existe ese usuario' });
        if (u.id === (p.meta.owner || auth.firstAdmin()?.id)) return send(res, 400, { error: 'Ya es el propietario' });
        const r = body.access === 'view' ? 'view' : 'edit';
        const had = p.meta.members?.[u.id];
        p.meta.members = { ...(p.meta.members || {}), [u.id]: r };
        p.dirty = true;
        await saveNow(p.meta.id);
        kick(p, u.id);
        if (had !== r) activity.event(p.meta.id, actor(who), had ? 'access' : 'share', { target: u.name, access: r });
        return send(res, 200, list());
      }
      if (mm[2] && req.method === 'DELETE') {
        // el propietario quita a alguien, o alguien sale de un proyecto compartido
        if (access !== 'owner' && mm[2] !== who.user.id) return send(res, 403, { error: 'No permitido' });
        if (p.meta.members?.[mm[2]]) {
          const target = auth.byId(mm[2]);
          activity.event(p.meta.id, actor(who), mm[2] === who.user.id ? 'leave' : 'unshare', { target: target?.name });
          delete p.meta.members[mm[2]];
          p.dirty = true;
          await saveNow(p.meta.id);
          kick(p, mm[2]);
        }
        return send(res, 200, list());
      }
      return send(res, 405, { error: 'método no permitido' });
    }

    const hm = url.pathname.match(/^\/api\/projects\/([^/]+)\/(history|share)(?:\/(\d+))?(?:\/(restore))?$/);
    if (hm) {
      const [, pid, what, ts, restore] = hm;
      const p = await getProject(pid);
      const access = p && accessOf(p, who);
      if (!access) return send(res, 404, { error: 'proyecto no existe' });
      if (!canEdit(access)) return send(res, 403, { error: 'Solo lectura: no puedes cambiar esto' });
      if (what === 'share') {
        if (req.method === 'POST') {
          if (!p.meta.shareToken) activity.event(pid, actor(who), 'link-on');
          p.meta.shareToken = p.meta.shareToken || crypto.randomBytes(18).toString('base64url');
          p.dirty = true;
          await saveNow(pid);
          return send(res, 200, { token: p.meta.shareToken });
        }
        if (req.method === 'DELETE') {
          if (p.meta.shareToken) activity.event(pid, actor(who), 'link-off');
          delete p.meta.shareToken;
          p.dirty = true;
          await saveNow(pid);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET') return send(res, 200, { token: p.meta.shareToken || null });
        return send(res, 405, { error: 'método no permitido' });
      }
      if (!ts && req.method === 'GET') return send(res, 200, (await readIndex(pid)).slice().reverse());
      if (!ts && req.method === 'POST') {
        const body = await readBody(req);
        p.dirty = true;
        await saveNow(pid);
        const data = await fsp.readFile(projectFile(pid), 'utf8');
        const snap = await snapshot(pid, data, String(body.label || 'Versión guardada'));
        activity.event(pid, actor(who), 'version', { label: snap.label });
        return send(res, 201, snap);
      }
      const snap = ts && (await readSnapshot(pid, ts));
      if (!snap) return send(res, 404, { error: 'versión no encontrada' });
      if (!restore && req.method === 'GET') return send(res, 200, { items: snap.items.filter((i) => !i.deleted) });
      if (restore && req.method === 'POST') {
        // antes de restaurar se guarda el estado actual por si acaso
        p.dirty = true;
        await saveNow(pid);
        await snapshot(pid, await fsp.readFile(projectFile(pid), 'utf8'), 'Antes de restaurar');
        const now = Date.now();
        const old = new Map(snap.items.map((i) => [i.id, i]));
        const ops = [];
        for (const cur of p.items.values()) {
          if (!old.has(cur.id) && !cur.deleted) ops.push({ ...cur, deleted: true, rev: Math.max(now, cur.rev + 1), by: 'restore' });
        }
        for (const it of old.values()) {
          const cur = p.items.get(it.id);
          ops.push({ ...it, rev: Math.max(now, (cur?.rev ?? 0) + 1), by: 'restore' });
        }
        const { accepted } = mergeOps(p, ops);
        scheduleSave(pid);
        broadcast(p, { t: 'ops', ops: accepted });
        const idx = await readIndex(pid);
        activity.event(pid, actor(who), 'restore', { label: idx.find((v) => String(v.ts) === String(ts))?.label || '', at: Number(ts) });
        return send(res, 200, { ok: true, changed: accepted.length });
      }
      return send(res, 405, { error: 'método no permitido' });
    }

    const m = url.pathname.match(/^\/api\/projects(?:\/([^/]+))?$/);
    if (!m) return send(res, 404, { error: 'no encontrado' });
    const id = m[1];

    if (!id && req.method === 'GET') return send(res, 200, await loadAllMeta(who));

    if (!id && req.method === 'POST') {
      const body = await readBody(req);
      const newId = body.id && ID_RE.test(body.id) ? body.id : crypto.randomUUID();
      let p = await getProject(newId);
      const created = !p;
      if (p && !canEdit(accessOf(p, who))) return send(res, 403, { error: 'No tienes permiso sobre ese proyecto' });
      if (!p) {
        p = await createProject(newId, String(body.name || '').slice(0, 200), who.user?.id);
        activity.event(newId, actor(who), 'create', { label: p.meta.name });
      }
      // proyecto creado sin conexión: el cliente sube sus elementos al darlo de alta
      if (Array.isArray(body.items) && body.items.length) {
        const { accepted } = mergeOps(p, body.items);
        if (accepted.length) {
          scheduleSave(newId);
          broadcast(p, { t: 'ops', ops: accepted });
        }
      }
      return send(res, created ? 201 : 200, metaFor(p, who));
    }

    if (!id) return send(res, 405, { error: 'método no permitido' });
    const p = await getProject(id);
    const access = p && accessOf(p, who);
    if (!access) return send(res, 404, { error: 'proyecto no existe' });

    if (req.method === 'GET') {
      return send(res, 200, { meta: metaFor(p, who), items: [...p.items.values()] });
    }
    if (req.method === 'PATCH') {
      if (!canEdit(access)) return send(res, 403, { error: 'Solo lectura' });
      const body = await readBody(req);
      if (typeof body.name === 'string' && body.name.slice(0, 200) !== p.meta.name) {
        activity.event(id, actor(who), 'rename', { from: p.meta.name, label: body.name.slice(0, 200) });
        p.meta.name = body.name.slice(0, 200);
      }
      p.meta.updatedAt = Date.now();
      scheduleSave(id);
      const { shareToken, members, ...m } = publicMeta(p);
      broadcast(p, { t: 'meta', meta: m });
      return send(res, 200, metaFor(p, who));
    }
    if (req.method === 'DELETE') {
      if (access !== 'owner') return send(res, 403, { error: 'Solo quien creó el proyecto puede borrarlo' });
      await saveNow(id);
      for (const c of p.clients) c.close(4404, 'proyecto eliminado');
      projects.delete(id);
      await fsp.rename(projectFile(id), path.join(TRASH_DIR, `${id}-${Date.now()}.json`)).catch(() => {});
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'método no permitido' });
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
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
  const id = url.searchParams.get('project') || '';
  const name = url.searchParams.get('name') || '';
  const share = url.searchParams.get('share');
  if (share) {
    // enlace de solo lectura: recibe cambios en vivo pero no puede enviar
    const p = await getProject(id);
    if (!p || !checkShare(p, share)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    return wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, p, id, 'viewer-' + crypto.randomBytes(3).toString('hex'), true));
  }
  const who = auth.identify(url.searchParams.get('token'));
  if (!who) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  let p = await getProject(id);
  if (!p) {
    if (!ID_RE.test(id)) return socket.destroy();
    p = await createProject(id, name, who.user?.id); // proyecto creado offline en otro dispositivo
  }
  const access = accessOf(p, who);
  if (!access) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = who.user?.id;
    ws.userName = who.user?.name;
    onConnection(ws, p, id, url.searchParams.get('client') || 'anon', access === 'view');
  });
});

function onConnection(ws, p, id, clientId, readOnly = false) {
  p.clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  const { shareToken, members, ...meta } = publicMeta(p);
  if (readOnly) ws.send(JSON.stringify({ t: 'readonly' }));
  ws.send(JSON.stringify({ t: 'snapshot', meta, items: [...p.items.values()] }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (readOnly && !(ws.userId && (msg.t === 'cursor' || msg.t === 'laser'))) return; // solo lectura: no puede modificar nada
    if (msg.t === 'ops' && Array.isArray(msg.ops)) {
      const prev = new Map(msg.ops.filter((o) => o && typeof o.id === 'string').map((o) => [o.id, p.items.get(o.id)]));
      const { accepted, rejected } = mergeOps(p, msg.ops);
      if (accepted.length) {
        scheduleSave(id);
        broadcast(p, { t: 'ops', ops: accepted }, ws);
        const who = ws.userId ? { id: ws.userId, name: ws.userName } : { id: 'dev:' + clientId, name: 'Dispositivo ' + String(clientId).slice(0, 4) };
        activity.ops(id, who, accepted.map((op) => ({ op, prev: prev.get(op.id) }))).catch(() => {});
      }
      if (rejected.length) ws.send(JSON.stringify({ t: 'ops', ops: rejected }));
      ws.send(JSON.stringify({ t: 'ack', seq: msg.seq }));
    } else if (msg.t === 'cursor' || msg.t === 'laser') {
      // mensajes efímeros: cursores y puntero láser de cada dispositivo
      const out = { t: msg.t, client: clientId, name: String(ws.userName || msg.name || '').slice(0, 40), color: String(msg.color || '').slice(0, 20) };
      if (msg.t === 'cursor') Object.assign(out, { x: +msg.x || 0, y: +msg.y || 0, tool: String(msg.tool || '').slice(0, 20) });
      else Object.assign(out, { pts: Array.isArray(msg.pts) ? msg.pts.slice(0, 200).map(Number) : [], end: !!msg.end });
      broadcast(p, out, ws);
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
  await activity.flushAll();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`[canvas++] escuchando en :${PORT}  datos=${DATA_DIR}  web=${PUBLIC_DIR}`);
});
