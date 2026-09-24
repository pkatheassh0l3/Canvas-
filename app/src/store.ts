// Almacenamiento local (IndexedDB) + API REST del NAS.
import { createStore, get, set, del } from 'idb-keyval';
import type { Item, ProjectMeta } from './types';
import { isNewer } from './types';
import { hasServer, serverBase, settings } from './settings';

const db = createStore('canvaspp', 'kv');

// ---------- local ----------
export async function localProjects(): Promise<ProjectMeta[]> {
  return (await get<ProjectMeta[]>('projects', db)) ?? [];
}

export async function saveLocalProjects(list: ProjectMeta[]) {
  await set('projects', list, db);
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
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (r.status === 401) throw new Error('Token incorrecto');
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function testServer(): Promise<string> {
  const h = await api<{ ok: boolean; auth: boolean }>('/api/health');
  await api('/api/projects'); // valida el token
  return h.auth ? 'Conectado (con token)' : 'Conectado (servidor sin token)';
}

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
