// Plantillas personalizadas: se guardan en el NAS (de cada usuario, o compartidas con todos)
// y se copian en el dispositivo para poder usarlas sin conexión. Sin servidor, solo en el dispositivo.
import { createStore, get, set, del } from 'idb-keyval';
import type { Item } from '../types';
import { accountKey, hasServer } from '../settings';
import { api } from '../store';
import { uid } from '../util';

export interface CustomTemplate {
  id: string;
  name: string;
  category?: string;
  thumb?: string;
  shared: boolean;
  mine: boolean;
  ownerName?: string;
  createdAt: number;
  count: number;
}

const db = createStore('canvaspp-templates', 'kv');
const listKey = () => `list:${accountKey()}`;
const itemsKey = (id: string) => `items:${id}`;
const LOCAL_ONLY = () => !hasServer();

/** Plantillas disponibles. Sin conexión, las que se vieron la última vez. */
export async function listCustom(): Promise<{ list: CustomTemplate[]; offline: boolean }> {
  const cached = (await get<CustomTemplate[]>(listKey(), db)) ?? [];
  if (LOCAL_ONLY()) return { list: cached, offline: false };
  try {
    const list = await api<CustomTemplate[]>('/api/templates');
    await set(listKey(), list, db);
    return { list, offline: false };
  } catch {
    return { list: cached, offline: true };
  }
}

export async function loadCustom(id: string): Promise<Item[]> {
  const local = await get<Item[]>(itemsKey(id), db);
  if (LOCAL_ONLY()) return local ?? [];
  try {
    const t = await api<{ items: Item[] }>(`/api/templates/${id}`);
    await set(itemsKey(id), t.items, db);
    return t.items;
  } catch (e) {
    if (local) return local;
    throw e;
  }
}

export async function saveCustom(t: { name: string; category?: string; thumb?: string; shared: boolean; items: Item[] }): Promise<CustomTemplate> {
  let saved: CustomTemplate;
  if (LOCAL_ONLY()) {
    saved = { id: uid(12), name: t.name, category: t.category, thumb: t.thumb, shared: false, mine: true, createdAt: Date.now(), count: t.items.length };
  } else {
    saved = await api<CustomTemplate>('/api/templates', { method: 'POST', body: JSON.stringify(t) });
  }
  await set(itemsKey(saved.id), t.items, db);
  const list = (await get<CustomTemplate[]>(listKey(), db)) ?? [];
  await set(listKey(), [saved, ...list], db);
  return saved;
}

export async function deleteCustom(id: string) {
  if (!LOCAL_ONLY()) await api(`/api/templates/${id}`, { method: 'DELETE' });
  await del(itemsKey(id), db);
  const list = (await get<CustomTemplate[]>(listKey(), db)) ?? [];
  await set(
    listKey(),
    list.filter((t) => t.id !== id),
    db,
  );
}

export async function updateCustom(id: string, patch: { name?: string; shared?: boolean }) {
  let upd: Partial<CustomTemplate> = patch;
  if (!LOCAL_ONLY()) upd = await api<CustomTemplate>(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  const list = (await get<CustomTemplate[]>(listKey(), db)) ?? [];
  await set(
    listKey(),
    list.map((t) => (t.id === id ? { ...t, ...upd } : t)),
    db,
  );
}
