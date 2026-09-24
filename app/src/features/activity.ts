// Historial de actividad: quién ha hecho qué en el proyecto (añadir, editar, borrar, compartir, restaurar…).
import type { BoardView } from '../board/boardView';
import { hasServer } from '../settings';
import { accounts, type ActivityEntry } from '../store';
import { h, toast } from '../util';
import { itemBounds } from '../board/render';
import { personAvatar } from '../ui/avatar';
import { openPanel } from './panel';

const KINDS: Record<string, [string, string]> = {
  stroke: ['trazo', 'trazos'],
  note: ['post-it', 'post-its'],
  text: ['texto', 'textos'],
  doc: ['documento', 'documentos'],
  image: ['imagen', 'imágenes'],
  table: ['tabla', 'tablas'],
  shape: ['forma', 'formas'],
  frame: ['marco', 'marcos'],
  link: ['enlace', 'enlaces'],
  todo: ['lista de tareas', 'listas de tareas'],
  pdf: ['PDF', 'PDF'],
  connector: ['conector', 'conectores'],
  layer: ['capa', 'capas'],
  bookmark: ['vista guardada', 'vistas guardadas'],
  comment: ['comentario', 'comentarios'],
  audio: ['nota de voz', 'notas de voz'],
  video: ['vídeo', 'vídeos'],
  math: ['fórmula', 'fórmulas'],
  code: ['bloque de código', 'bloques de código'],
  chart: ['gráfico', 'gráficos'],
};
const ORDER = Object.keys(KINDS);

const joinEs = (parts: string[]) => (parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' y ' + parts[parts.length - 1]);
function kindList(m: Record<string, string[]> | undefined, skip: string[] = []): string {
  if (!m) return '';
  const parts = Object.entries(m)
    .filter(([k, ids]) => ids.length && !skip.includes(k))
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([k, ids]) => {
      const [one, many] = KINDS[k] ?? ['elemento', 'elementos'];
      return `${ids.length} ${ids.length === 1 ? one : many}`;
    });
  return joinEs(parts);
}

const q = (s?: string) => `«${s ?? ''}»`;
const ACCESS = { edit: 'puede editar', view: 'solo ver' } as const;

/** Frase en español: "añadió 2 post-its y editó 1 tabla". */
export function describe(e: ActivityEntry): string {
  switch (e.t) {
    case 'create':
      return `creó el proyecto ${q(e.label)}`;
    case 'rename':
      return `cambió el nombre de ${q(e.from)} a ${q(e.label)}`;
    case 'share':
      return `compartió el proyecto con ${e.target ?? 'alguien'} (${ACCESS[e.access ?? 'edit']})`;
    case 'access':
      return `cambió el permiso de ${e.target ?? 'alguien'} a «${ACCESS[e.access ?? 'edit']}»`;
    case 'unshare':
      return `quitó el acceso a ${e.target ?? 'alguien'}`;
    case 'leave':
      return 'salió del proyecto';
    case 'link-on':
      return 'creó un enlace de solo lectura';
    case 'link-off':
      return 'desactivó el enlace de solo lectura';
    case 'version':
      return `guardó la versión ${q(e.label)}`;
    case 'restore':
      return `restauró la versión ${e.label ? q(e.label) : 'del ' + new Date(e.at ?? 0).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`;
  }
  const parts: string[] = [];
  const drew = e.add?.stroke?.length;
  if (drew) parts.push(`dibujó ${drew} ${drew === 1 ? 'trazo' : 'trazos'}`);
  const commented = e.add?.comment?.length;
  if (commented) parts.push(commented === 1 ? 'dejó un comentario' : `dejó ${commented} comentarios`);
  const added = kindList(e.add, ['stroke', 'comment']);
  if (added) parts.push('añadió ' + added);
  const edited = kindList(e.edit);
  if (edited) parts.push('editó ' + edited);
  const deleted = kindList(e.del);
  if (deleted) parts.push('borró ' + deleted);
  return joinEs(parts) || 'hizo cambios';
}

function when(ts: number) {
  const d = Date.now() - ts;
  if (d < 60000) return 'ahora';
  if (d < 3600000) return `hace ${Math.round(d / 60000)} min`;
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === y.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function openActivity(b: BoardView) {
  if (!hasServer()) return toast('El historial de actividad necesita el servidor del NAS');
  let list: ActivityEntry[] | null = null;
  let error = '';
  let more = true;
  let who = '';
  let loading = false;

  async function load(reset: boolean) {
    if (loading) return;
    loading = true;
    try {
      const before = reset || !list?.length ? undefined : list[list.length - 1].ts;
      const page = await accounts.activity(b.meta.id, before);
      list = reset || !list ? page : [...list, ...page];
      more = page.length >= 50;
      error = '';
    } catch (e: any) {
      error = e?.message || String(e);
    } finally {
      loading = false;
    }
    ctl?.refresh();
  }

  /** Enfoca los elementos que se tocaron (los que todavía existen). */
  function show(e: ActivityEntry) {
    const ids = [...Object.values(e.add ?? {}), ...Object.values(e.edit ?? {})].flat().filter((id) => b.doc.get(id));
    if (!ids.length) return toast('Esos elementos ya no están en la pizarra');
    if (ids.length === 1) return b.focusItem(ids[0]);
    let r = itemBounds(b.doc.get(ids[0])!);
    for (const id of ids.slice(1)) {
      const o = itemBounds(b.doc.get(id)!);
      const x = Math.min(r.x, o.x);
      const y = Math.min(r.y, o.y);
      r = { x, y, w: Math.max(r.x + r.w, o.x + o.w) - x, h: Math.max(r.y + r.h, o.y + o.h) - y };
    }
    b.setTool('select');
    b.selection = new Set(ids);
    b.refreshUI();
    b.fitRect(r, 80);
  }

  const ctl = openPanel(
    b,
    'activity',
    'Actividad',
    (c) => {
      const { body } = c;
      if (!list) {
        body.replaceChildren(h('p', { class: 'panel-hint' }, error || 'Cargando…'));
        return;
      }
      const people = [...new Map(list.map((e) => [e.user, e.name])).entries()];
      const filter = h(
        'select',
        { class: 'act-filter', onchange: (ev: Event) => ((who = (ev.target as HTMLSelectElement).value), c.refresh()) },
        h('option', { value: '' }, 'Todas las personas'),
        ...people.map(([id, name]) => h('option', { value: id, selected: id === who }, name)),
      );
      const shown = list.filter((e) => !who || e.user === who);
      const rows: Node[] = [];
      let day = '';
      for (const e of shown) {
        const d = dayLabel(e.ts);
        if (d !== day) {
          day = d;
          rows.push(h('div', { class: 'act-day' }, d));
        }
        const touched = [...Object.values(e.add ?? {}), ...Object.values(e.edit ?? {})].flat().some((id) => b.doc.get(id));
        rows.push(
          h(
            'div',
            { class: 'act-row' + (touched ? ' clickable' : ''), onclick: touched ? () => show(e) : undefined, title: touched ? 'Ver en la pizarra' : '' },
            personAvatar(e.user, e.name, 28, e.avatar),
            h('div', { class: 'act-text' }, h('b', {}, e.name), ' ', describe(e), h('small', {}, when(e.ts))),
          ),
        );
      }
      body.replaceChildren(
        h('p', { class: 'panel-hint' }, 'Quién ha hecho qué en este proyecto. Toca una entrada para ver esos elementos.'),
        people.length > 1 ? filter : '',
        ...(rows.length ? rows : [h('p', { class: 'panel-hint' }, 'Todavía no hay actividad.')]),
        more && shown.length ? h('button', { class: 'btn ghost small act-more', onclick: () => load(false) }, 'Cargar más') : '',
      );
    },
    { live: false },
  );
  if (!ctl) return;
  load(true);
  // se actualiza sola mientras está abierta
  let t: any;
  const unsub = b.doc.subscribe(() => {
    if (!ctl.body.isConnected) return cleanup(); // se cerró al abrir otro panel
    clearTimeout(t);
    t = setTimeout(() => load(true), 2500);
  });
  const timer = setInterval(() => (ctl.body.isConnected ? ctl.refresh() : cleanup()), 30000); // "hace x min"
  function cleanup() {
    unsub();
    clearInterval(timer);
    clearTimeout(t);
  }
  const origClose = ctl.close;
  ctl.close = () => {
    cleanup();
    origClose();
  };
}
