// Canvas++ — historial de actividad de cada proyecto: quién ha hecho qué y cuándo.
// Los cambios seguidos de una misma persona (en menos de 3 minutos) se agrupan en una sola entrada:
// "Ana añadió 2 post-its y editó 1 tabla". También se anotan compartir, renombrar, restaurar…
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const GROUP_MS = 3 * 60 * 1000;
const MAX_ENTRIES = 1000;
const MAX_IDS = 100;

export function createActivity(dataDir) {
  const dir = path.join(dataDir, 'activity');
  fs.mkdirSync(dir, { recursive: true });
  /** @type {Map<string, {list: any[], timer: any}>} */
  const cache = new Map();
  const file = (pid) => path.join(dir, `${pid}.json`);

  async function get(pid) {
    let c = cache.get(pid);
    if (!c) {
      const list = await fsp.readFile(file(pid), 'utf8').then(JSON.parse, () => []);
      c = cache.get(pid) ?? { list: Array.isArray(list) ? list : [], timer: null };
      cache.set(pid, c);
    }
    return c;
  }
  function persist(pid, c) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      c.timer = null;
      const data = JSON.stringify(c.list);
      fsp
        .writeFile(file(pid) + '.tmp', data)
        .then(() => fsp.rename(file(pid) + '.tmp', file(pid)))
        .catch((e) => console.error('[canvas++] actividad', e.message));
    }, 1500);
  }
  function trim(c) {
    if (c.list.length > MAX_ENTRIES) c.list.splice(0, c.list.length - MAX_ENTRIES);
  }

  const bucket = (entry, what, kind) => ((entry[what] ??= {})[kind] ??= []);
  const has = (entry, what, kind, id) => !!entry[what]?.[kind]?.includes(id);
  const drop = (entry, what, kind, id) => {
    const l = entry[what]?.[kind];
    if (!l) return;
    const i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) delete entry[what][kind];
  };
  const push = (entry, what, kind, id) => {
    const l = bucket(entry, what, kind);
    if (!l.includes(id) && l.length < MAX_IDS) l.push(id);
  };

  return {
    /** Cambios de elementos: changes = [{ op, prev }] (prev = versión anterior o undefined). */
    async ops(pid, who, changes) {
      if (!changes.length) return;
      const c = await get(pid);
      const now = Date.now();
      let e = c.list[c.list.length - 1];
      if (!e || e.t !== 'edit' || e.user !== who.id || now - e.ts > GROUP_MS) {
        e = { t: 'edit', ts: now, start: now, user: who.id, name: who.name };
        c.list.push(e);
      }
      e.ts = now;
      e.name = who.name;
      for (const { op, prev } of changes) {
        const kind = op.kind || prev?.kind || 'item';
        const existed = prev && !prev.deleted;
        if (op.deleted) {
          if (!existed) continue;
          if (has(e, 'add', kind, op.id)) drop(e, 'add', kind, op.id); // creado y borrado en el mismo rato
          else {
            drop(e, 'edit', kind, op.id);
            push(e, 'del', kind, op.id);
          }
        } else if (!existed) push(e, 'add', kind, op.id);
        else if (!has(e, 'add', kind, op.id)) push(e, 'edit', kind, op.id);
      }
      // una entrada que se ha quedado vacía (creado y borrado) no aporta nada
      if (!e.add && !e.edit && !e.del) c.list.pop();
      else if (!Object.keys(e.add ?? {}).length && !Object.keys(e.edit ?? {}).length && !Object.keys(e.del ?? {}).length) c.list.pop();
      trim(c);
      persist(pid, c);
    },

    /** Evento suelto: compartir, renombrar, restaurar, crear… */
    async event(pid, who, t, detail = {}) {
      const c = await get(pid);
      c.list.push({ t, ts: Date.now(), user: who.id, name: who.name, ...detail });
      trim(c);
      persist(pid, c);
    },

    /** Entradas más recientes primero. */
    async list(pid, before = Infinity, limit = 50) {
      const c = await get(pid);
      const out = [];
      for (let i = c.list.length - 1; i >= 0 && out.length < limit; i--) if (c.list[i].ts < before) out.push(c.list[i]);
      return out;
    },

    async forget(pid) {
      const c = cache.get(pid);
      if (c) clearTimeout(c.timer);
      cache.delete(pid);
      await fsp.rm(file(pid), { force: true });
    },

    async flushAll() {
      for (const [pid, c] of cache) {
        if (!c.timer) continue;
        clearTimeout(c.timer);
        await fsp.writeFile(file(pid), JSON.stringify(c.list)).catch(() => {});
      }
    },
  };
}
