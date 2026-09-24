// Canvas++ — cuentas de usuario.
// - Usuarios en DATA/users.json con contraseña derivada con scrypt (nunca se guarda en claro).
// - Sesiones firmadas con HMAC (clave en DATA/secret.key): "s1.<usuario>.<versión>.<caduca>.<firma>".
//   Cambiar la contraseña o "cerrar todas las sesiones" sube la versión e invalida las anteriores.
// - Mientras no exista ningún usuario el servidor funciona como antes (CANVAS_TOKEN único).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 180;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export function createAuth(dataDir, legacyToken) {
  const usersFile = path.join(dataDir, 'users.json');
  const secretFile = path.join(dataDir, 'secret.key');

  let secret;
  try {
    secret = fs.readFileSync(secretFile);
  } catch {
    secret = crypto.randomBytes(32);
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  }

  /** @type {Array<{id:string, username:string, name:string, role:'admin'|'user', salt:string, hash:string, tv:number, createdAt:number}>} */
  let users = [];
  try {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  } catch {}

  let saving = Promise.resolve();
  function save() {
    const data = JSON.stringify(users, null, 1);
    saving = saving.then(async () => {
      await fsp.writeFile(usersFile + '.tmp', data, { mode: 0o600 });
      await fsp.rename(usersFile + '.tmp', usersFile);
    });
    return saving;
  }

  const eq = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  async function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
    const key = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
    return { salt, hash: key.toString('base64') };
  }

  function sign(payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function issue(u) {
    const exp = Date.now() + SESSION_DAYS * 86400000;
    const payload = `s1.${u.id}.${u.tv}.${exp}`;
    return `${payload}.${sign(payload)}`;
  }

  const publicUser = (u) => u && { id: u.id, username: u.username, name: u.name, role: u.role };
  const byId = (id) => users.find((u) => u.id === id);
  const byName = (n) => users.find((u) => u.username === String(n || '').trim().toLowerCase());

  function checkPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 6) throw httpError(400, 'La contraseña debe tener al menos 6 caracteres');
    if (pw.length > 200) throw httpError(400, 'Contraseña demasiado larga');
  }
  function checkUsername(n) {
    const u = String(n || '').trim().toLowerCase();
    if (!USERNAME_RE.test(u)) throw httpError(400, 'Usuario no válido: 2-32 letras minúsculas, números, punto, guion o guion bajo');
    if (byName(u)) throw httpError(409, 'Ese nombre de usuario ya existe');
    return u;
  }

  // freno a los ataques por fuerza bruta: tras 5 fallos seguidos desde una IP, espera creciente
  const fails = new Map();
  function throttle(ip) {
    const f = fails.get(ip);
    if (f && f.n >= 5 && Date.now() < f.until) throw httpError(429, `Demasiados intentos. Espera ${Math.ceil((f.until - Date.now()) / 1000)} s`);
  }
  function failed(ip) {
    const f = fails.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60000, 30000 * 2 ** (f.n - 5));
    fails.set(ip, f);
  }

  return {
    get hasUsers() {
      return users.length > 0;
    },
    publicUser,
    byId,
    byName,
    list: () => users.map(publicUser),
    firstAdmin: () => users.find((u) => u.role === 'admin'),

    /**
     * Quién hace la petición.
     * @returns {{user: any} | {legacy: true} | null}
     */
    identify(token) {
      if (!users.length) {
        // modo antiguo: sin cuentas, un único token (o ninguno) para todo
        if (!legacyToken || eq(token || '', legacyToken)) return { legacy: true };
        return null;
      }
      const parts = String(token || '').split('.');
      if (parts.length !== 5 || parts[0] !== 's1') return null;
      const payload = parts.slice(0, 4).join('.');
      if (!eq(sign(payload), parts[4])) return null;
      const u = byId(parts[1]);
      if (!u || String(u.tv) !== parts[2] || Number(parts[3]) < Date.now()) return null;
      return { user: u };
    },

    /** Primer usuario (administrador). Si el servidor tenía CANVAS_TOKEN, hay que darlo para demostrar que eres el dueño. */
    async setup(body) {
      if (users.length) throw httpError(409, 'Ya hay usuarios creados');
      if (legacyToken && !eq(body.serverToken || '', legacyToken)) throw httpError(403, 'El token del servidor no es correcto');
      return this.create({ ...body, role: 'admin' });
    },

    async create({ username, password, name, role }) {
      const uname = checkUsername(username);
      checkPassword(password);
      const u = {
        id: 'u' + crypto.randomBytes(8).toString('hex'),
        username: uname,
        name: String(name || uname).trim().slice(0, 60) || uname,
        role: role === 'admin' ? 'admin' : 'user',
        ...(await hashPassword(password)),
        tv: 1,
        createdAt: Date.now(),
      };
      users.push(u);
      await save();
      return u;
    },

    async login(username, password, ip) {
      throttle(ip);
      const u = byName(username);
      // se calcula el hash aunque el usuario no exista, para no delatar qué usuarios hay por el tiempo de respuesta
      const { hash } = await hashPassword(password || '', u?.salt || 'x');
      if (!u || !eq(hash, u.hash)) {
        failed(ip);
        throw httpError(401, 'Usuario o contraseña incorrectos');
      }
      fails.delete(ip);
      return u;
    },

    issue,

    async setPassword(u, password) {
      checkPassword(password);
      Object.assign(u, await hashPassword(password));
      u.tv++; // cierra las sesiones abiertas con la contraseña antigua
      await save();
    },

    async verifyPassword(u, password) {
      const { hash } = await hashPassword(password || '', u.salt);
      return eq(hash, u.hash);
    },

    async logoutAll(u) {
      u.tv++;
      await save();
    },

    async update(u, { name, role }) {
      if (typeof name === 'string' && name.trim()) u.name = name.trim().slice(0, 60);
      if (role === 'admin' || role === 'user') {
        if (u.role === 'admin' && role === 'user' && users.filter((x) => x.role === 'admin').length === 1)
          throw httpError(400, 'Tiene que quedar al menos un administrador');
        u.role = role;
      }
      await save();
    },

    async remove(u) {
      if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length === 1) throw httpError(400, 'No se puede borrar el último administrador');
      users = users.filter((x) => x !== u);
      await save();
    },
  };
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
