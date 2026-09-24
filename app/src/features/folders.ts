// Carpetas para organizar proyectos. Cada cuenta tiene las suyas (se guardan en el NAS y en el dispositivo);
// los proyectos compartidos contigo también se pueden meter en tus carpetas sin afectar a nadie.
import { createStore, get, set } from 'idb-keyval';
import { accountKey, hasServer } from '../settings';
import { api } from '../store';
import { uid } from '../util';

export interface Folder {
  id: string;
  name: string;
  parent: string | null;
  color?: string;
}

export interface FolderState {
  folders: Folder[];
  assign: Record<string, string>; // proyecto → carpeta
  updatedAt: number;
  dirty?: boolean; // cambios hechos sin conexión, pendientes de subir
}

export const FOLDER_COLORS = ['#8a8f98', '#0090ff', '#30a46c', '#f5a524', '#f76b15', '#e5484d', '#d6409f', '#8e4ec6'];

const db = createStore('canvaspp-folders', 'kv');
const key = () => `folders:${accountKey()}`;
let state: FolderState = { folders: [], assign: {}, updatedAt: 0 };

export const folders = {
  get state() {
    return state;
  },

  /** Carga las carpetas (primero las del dispositivo; luego, si hay NAS, se sincronizan). */
  async load(): Promise<FolderState> {
    state = (await get<FolderState>(key(), db)) ?? { folders: [], assign: {}, updatedAt: 0 };
    if (!hasServer()) return state;
    try {
      if (state.dirty) await push();
      else {
        const remote = await api<FolderState>('/api/folders');
        state = { ...remote, dirty: false };
        await set(key(), state, db);
      }
    } catch {
      // sin conexión: se usa la copia local
    }
    return state;
  },

  children(parent: string | null) {
    return state.folders.filter((f) => f.parent === parent).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  },

  byId(id: string | null) {
    return id ? state.folders.find((f) => f.id === id) : undefined;
  },

  /** Ruta desde la raíz hasta la carpeta (para las migas de pan). */
  path(id: string | null): Folder[] {
    const out: Folder[] = [];
    let f = this.byId(id);
    const seen = new Set<string>();
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.unshift(f);
      f = this.byId(f.parent);
    }
    return out;
  },

  folderOf(projectId: string): string | null {
    const f = state.assign[projectId];
    return f && this.byId(f) ? f : null;
  },

  /** Número de proyectos dentro (incluidas subcarpetas). */
  count(id: string, projectIds: Set<string>): number {
    const inside = new Set([id, ...this.descendants(id)]);
    let n = 0;
    for (const [p, f] of Object.entries(state.assign)) if (inside.has(f) && projectIds.has(p)) n++;
    return n;
  },

  descendants(id: string): string[] {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const f of state.folders) if (f.parent === p && !out.includes(f.id)) (out.push(f.id), walk(f.id));
    };
    walk(id);
    return out;
  },

  async create(name: string, parent: string | null): Promise<Folder> {
    const f: Folder = { id: uid(12), name: name.slice(0, 80), parent, color: FOLDER_COLORS[0] };
    state.folders.push(f);
    await save();
    return f;
  },

  async update(id: string, patch: Partial<Pick<Folder, 'name' | 'color'>>) {
    const f = this.byId(id);
    if (!f) return;
    Object.assign(f, patch);
    await save();
  },

  /** Borra la carpeta: lo que tenía dentro (proyectos y subcarpetas) sube a la carpeta de arriba. */
  async remove(id: string) {
    const f = this.byId(id);
    if (!f) return;
    for (const c of state.folders) if (c.parent === id) c.parent = f.parent;
    for (const [p, fid] of Object.entries(state.assign)) {
      if (fid !== id) continue;
      if (f.parent) state.assign[p] = f.parent;
      else delete state.assign[p];
    }
    state.folders = state.folders.filter((x) => x.id !== id);
    await save();
  },

  async moveProject(projectId: string, folderId: string | null) {
    if (folderId) state.assign[projectId] = folderId;
    else delete state.assign[projectId];
    await save();
  },

  /** Mueve una carpeta dentro de otra (no se puede meter dentro de sí misma ni de sus subcarpetas). */
  async moveFolder(id: string, parent: string | null) {
    const f = this.byId(id);
    if (!f || id === parent || (parent && this.descendants(id).includes(parent))) return false;
    f.parent = parent;
    await save();
    return true;
  },

  async forget(projectId: string) {
    if (!(projectId in state.assign)) return;
    delete state.assign[projectId];
    await save();
  },
};

async function push() {
  const r = await api<FolderState>('/api/folders', { method: 'PUT', body: JSON.stringify({ folders: state.folders, assign: state.assign }) });
  state = { ...r, dirty: false };
  await set(key(), state, db);
}

async function save() {
  state.updatedAt = Date.now();
  state.dirty = hasServer();
  await set(key(), state, db);
  if (hasServer()) await push().catch(() => {}); // sin conexión: se sube en la próxima carga
}
