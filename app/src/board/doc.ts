// Estado del tablero: elementos, deshacer/rehacer, persistencia local y envío al NAS.
import type { Item } from '../types';
import { isNewer } from '../types';
import { settings } from '../settings';
import { debounce, nextRev } from '../util';
import { saveItems } from '../store';

type Change = { before: Item | null; after: Item };

export class BoardDoc {
  items = new Map<string, Item>();
  private sorted: Item[] | null = null;
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private listeners = new Set<(ids: Set<string> | null) => void>();
  /** Se llama con cada cambio local (lo usa SyncClient). */
  onLocalChange: (items: Item[]) => void = () => {};
  maxZ = 0;

  /** Solo lectura (enlace compartido): no se guarda ni se modifica nada. */
  readOnly = false;

  private persist = debounce(() => {
    if (this.readOnly) return;
    saveItems(this.projectId, [...this.items.values()]).catch((e) => console.error(e));
  }, 400);

  constructor(
    public projectId: string,
    initial: Item[],
  ) {
    for (const it of initial) this.setRaw(it);
  }

  private setRaw(it: Item) {
    this.items.set(it.id, it);
    if (it.z > this.maxZ) this.maxZ = it.z;
    this.sorted = null;
  }

  subscribe(fn: (ids: Set<string> | null) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ids: Set<string> | null) {
    for (const l of this.listeners) l(ids);
  }

  /** Elementos visibles ordenados por z. */
  visible(): Item[] {
    if (!this.sorted) {
      this.sorted = [...this.items.values()].filter((i) => !i.deleted).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    }
    return this.sorted;
  }

  get(id: string) {
    const it = this.items.get(id);
    return it && !it.deleted ? it : undefined;
  }

  nextZ() {
    return ++this.maxZ;
  }

  /** Aplica cambios locales. Cada elemento recibe nueva rev y autor. */
  commit(next: Item[], record = true): Item[] {
    if (this.readOnly) return [];
    const changes: Change[] = [];
    const out: Item[] = [];
    for (const n of next) {
      const before = this.items.get(n.id) ?? null;
      const it = { ...n, rev: nextRev(before?.rev), by: settings.clientId } as Item;
      this.setRaw(it);
      changes.push({ before, after: it });
      out.push(it);
    }
    if (!out.length) return out;
    if (record) {
      this.undoStack.push(changes);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.persist();
    this.onLocalChange(out);
    this.emit(new Set(out.map((i) => i.id)));
    return out;
  }

  /** Capa a la que van los elementos nuevos. */
  defaultLayer: () => string | undefined = () => undefined;

  add(items: Item[]) {
    const layer = this.defaultLayer();
    return this.commit(items.map((it) => (layer && !it.layer && it.kind !== 'layer' && it.kind !== 'bookmark' ? { ...it, layer } : it)));
  }

  remove(ids: string[]) {
    const del: Item[] = [];
    for (const id of ids) {
      const it = this.get(id);
      if (it) del.push({ ...it, deleted: true });
    }
    return this.commit(del);
  }

  /** Cambios que llegan del NAS (no entran en deshacer). */
  applyRemote(incoming: Item[]) {
    const changed = new Set<string>();
    for (const it of incoming) {
      if (isNewer(it, this.items.get(it.id))) {
        this.setRaw(it);
        changed.add(it.id);
      }
    }
    if (changed.size) {
      this.persist();
      this.emit(changed);
    }
  }

  private restore(batch: Change[], useBefore: boolean) {
    const items: Item[] = [];
    for (const c of batch) {
      const target = useBefore ? c.before : c.after;
      const cur = this.items.get(c.after.id);
      if (target) items.push(target);
      else if (cur) items.push({ ...cur, deleted: true });
    }
    this.commit(items, false);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const b = this.undoStack.pop();
    if (!b) return;
    this.redoStack.push(b);
    this.restore(b, true);
  }

  redo() {
    const b = this.redoStack.pop();
    if (!b) return;
    this.undoStack.push(b);
    this.restore(b, false);
  }

  flush() {
    this.persist.flush();
  }
}
