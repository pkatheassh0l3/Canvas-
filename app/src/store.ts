// Almacenamiento local (IndexedDB) + API REST del NAS.
import { createStore, get, set, del } from 'idb-keyval';
import type { Item, ProjectMeta } from './types';
import { isNewer } from './types';
import { accountKey, hasServer, serverBase, settings, type Account } from './settings';

const db = createStore('canvaspp', 'kv');

// ---------- local ----------
// Cada cuenta tiene su propia lista en el dispositivo (la de antes de existir cuentas es "projects").
const listKey = () => (accountKey() === 'local' ? 'projects' : `projects:${accountKey()}`);

export async function localProjects(): Promise<ProjectMeta[]> {
  const key = listKey();
  const list = await get<ProjectMeta[]>(key, db);
  if (list) return list;
  if (key !== 'projects') {
    // primera vez con cuenta en este dispositivo: se adoptan los proyectos que había sin cuenta
    const legacy = await get<ProjectMeta[]>('projects', db);
    if (legacy?.length) {
      await set(key, legacy, db);
      await del('projects', db);
      return legacy;
    }
  }
  return [];
}

export async function saveLocalProjects(list: ProjectMeta[]) {
  await set(listKey(), list, db);
}

export async function upsertLocalProject(meta: ProjectMeta) {
  const list = await localProjects();
  const i = list.findIndex((p) => p.id === meta.id);
  if (i >= 0) list[i] = { ...list[i], ...meta };
  else list.push(meta);
  await saveLocalProjects(list);
}

export async function removeLocalProject(id: string) {
  await saveLocalProjects((await localProjects()).filter((p) => p.id !== id));
  await del(`items:${id}`, db);
}

export async function loadItems(id: string): Promise<Item[]> {
  return (await get<Item[]>(`items:${id}`, db)) ?? [];
}

export async function saveItems(id: string, items: Item[]) {
  await set(`items:${id}`, items, db);
}

// ---------- servidor ----------
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Petición al servidor. Si la sesión ya no vale, avisa a la app para pedir otra vez usuario y contraseña. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(serverBase() + path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.token}`,
        ...(init.headers || {}),
      },
    });
    if (!r.ok) {
      const msg = await r
        .json()
        .then((j) => j?.error as string)
        .catch(() => '');
      if (r.status === 401 && !path.startsWith('/api/auth/')) {
        window.dispatchEvent(new CustomEvent('canvaspp:auth'));
        throw new ApiError(401, settings.user ? 'La sesión ha caducado' : 'Token incorrecto');
      }
      throw new ApiError(r.status, msg || `Error ${r.status}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface Health {
  ok: boolean;
  auth: boolean;
  users?: boolean; // el servidor tiene cuentas de usuario
  setupToken?: boolean; // para crear el primer administrador hace falta el CANVAS_TOKEN
  signup?: boolean; // registro abierto
  version?: number;
}

export async function health(base = serverBase()): Promise<Health> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/api/health', { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function testServer(): Promise<string> {
  const h = await health();
  if (h.users && !settings.user) return 'Conectado: el servidor usa cuentas, inicia sesión';
  await api('/api/projects'); // valida la sesión o el token
  if (settings.user) return `Conectado como ${settings.user.name}`;
  return h.auth ? 'Conectado (con token)' : 'Conectado (servidor sin token)';
}

export type Member = { id: string; username: string; name: string; access: 'owner' | 'edit' | 'view' };
type Session = { token: string; user: Account };
const post = (body: object) => ({ method: 'POST', body: JSON.stringify(body) });

/** Cuentas de usuario y personas con acceso a cada proyecto. */
export const accounts = {
  login: (username: string, password: string) => api<Session>('/api/auth/login', post({ username, password })),
  setup: (b: { username: string; name: string; password: string; serverToken?: string }) => api<Session>('/api/auth/setup', post(b)),
  register: (b: { username: string; name: string; password: string }) => api<Session>('/api/auth/register', post(b)),
  me: () => api<Account>('/api/auth/me'),
  rename: (name: string) => api<Account>('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
  changePassword: (old: string, password: string) => api<{ token: string }>('/api/auth/password', post({ old, password })),
  logoutAll: () => api<{ token: string }>('/api/auth/logout-all', post({})),
  users: () => api<(Account & { role?: Account['role'] })[]>('/api/users'),
  createUser: (b: { username: string; name: string; password: string; role: string }) => api<Account>('/api/users', post(b)),
  updateUser: (id: string, b: { name?: string; role?: string; password?: string }) =>
    api<Account>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteUser: (id: string) => api(`/api/users/${id}`, { method: 'DELETE' }),
  members: (pid: string) => api<Member[]>(`/api/projects/${pid}/members`),
  addMember: (pid: string, username: string, access: 'edit' | 'view') => api<Member[]>(`/api/projects/${pid}/members`, post({ username, access })),
  removeMember: (pid: string, uid: string) => api<Member[]>(`/api/projects/${pid}/members/${uid}`, { method: 'DELETE' }),
};

export const remote = {
  list: () => api<ProjectMeta[]>('/api/projects'),
  create: (id: string, name: string, items?: Item[]) =>
    api<ProjectMeta>('/api/projects', { method: 'POST', body: JSON.stringify({ id, name, items }) }),
  rename: (id: string, name: string) =>
    api<ProjectMeta>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  remove: (id: string) => api(`/api/projects/${id}`, { method: 'DELETE' }),
};

/**
 * Reconcilia la lista de proyectos local con la del NAS.
 * - Proyectos del NAS que no están aquí → se añaden.
 * - Proyectos locales nunca subidos → se suben (con sus elementos).
 * - Proyectos que estaban sincronizados y ya no existen en el NAS → se borraron en otro dispositivo.
 */
export async function syncProjectList(): Promise<{ list: ProjectMeta[]; online: boolean; error?: string }> {
  const local = await localProjects();
  if (!hasServer()) return { list: local, online: false };
  let serverList: ProjectMeta[];
  try {
    serverList = await remote.list();
  } catch (e: any) {
    return { list: local, online: false, error: e?.message || String(e) };
  }
  const byId = new Map(serverList.map((p) => [p.id, p]));
  const out: ProjectMeta[] = [];
  for (const lp of local) {
    const sp = byId.get(lp.id);
    if (sp) {
      out.push({ ...lp, ...sp, thumb: lp.thumb, synced: true });
      byId.delete(lp.id);
    } else if (!lp.synced) {
      try {
        const items = await loadItems(lp.id);
        const created = await remote.create(lp.id, lp.name, items);
        out.push({ ...lp, ...created, thumb: lp.thumb, synced: true });
      } catch {
        out.push(lp);
      }
    } else {
      await del(`items:${lp.id}`, db); // borrado en otro dispositivo
    }
  }
  for (const sp of byId.values()) out.push({ ...sp, synced: true });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  await saveLocalProjects(out);
  return { list: out, online: true };
}

export function mergeItemLists(local: Item[], incoming: Item[]): Item[] {
  const m = new Map(local.map((i) => [i.id, i]));
  for (const it of incoming) if (isNewer(it, m.get(it.id))) m.set(it.id, it);
  return [...m.values()];
}
