// Plantillas: kanban, retrospectiva, semana, mapa mental, diagrama de flujo, matriz de Eisenhower…
import type { BoardView } from '../board/boardView';
import type { ConnectorItem, FrameItem, Item, NoteItem, ShapeItem, ShapeKind, TextItem } from '../types';
import { uid } from '../util';
import { FRAME_COLORS } from '../board/items';
import { NOTE_COLORS } from '../board/render';

type Maker = (u: number) => Item[];
const base = () => ({ id: uid(), rev: 0, by: '', z: 0 });

const frame = (x: number, y: number, w: number, h: number, title: string, color = FRAME_COLORS[0]): FrameItem => ({ ...base(), kind: 'frame', x, y, w, h, title, color });
const note = (x: number, y: number, s: number, text: string, color = NOTE_COLORS[0]): NoteItem => ({
  ...base(),
  kind: 'note',
  x,
  y,
  w: s,
  h: s,
  color,
  text,
  baseW: 240,
  baseH: 240,
  strokes: [],
});
const shape = (k: ShapeKind, x: number, y: number, w: number, h: number, label: string, u: number, color = '#0090ff'): ShapeItem => ({
  ...base(),
  kind: 'shape',
  shape: k,
  x,
  y,
  w,
  h,
  stroke: color,
  fill: color + '22',
  sw: 2.5 * u,
  label,
});
const link = (a: Item, b: Item, u: number, label = ''): ConnectorItem => ({
  ...base(),
  kind: 'connector',
  from: { id: a.id, x: 0, y: 0 },
  to: { id: b.id, x: 0, y: 0 },
  stroke: '#6b6f76',
  sw: 2 * u,
  arrow: 'end',
  curve: false,
  label,
});
const title = (x: number, y: number, text: string, u: number): TextItem => ({ ...base(), kind: 'text', x, y, text, size: 34 * u, color: '#1f2328' });

const T: Record<string, { name: string; make: Maker }> = {
  kanban: {
    name: 'Kanban',
    make: (u) => {
      const w = 320 * u;
      const hh = 640 * u;
      const g = 30 * u;
      const cols = ['Por hacer', 'En curso', 'Hecho'];
      const out: Item[] = [title(0, -70 * u, 'Tablero Kanban', u)];
      cols.forEach((c, i) => out.push(frame(i * (w + g), 0, w, hh, c, [FRAME_COLORS[5], FRAME_COLORS[2], FRAME_COLORS[1]][i])));
      out.push(note(40 * u, 80 * u, 240 * u, 'Tarea 1'), note(40 * u, 360 * u, 240 * u, 'Tarea 2', NOTE_COLORS[2]));
      return out;
    },
  },
  retro: {
    name: 'Retrospectiva',
    make: (u) => {
      const w = 360 * u;
      const g = 30 * u;
      const out: Item[] = [title(0, -70 * u, 'Retrospectiva', u)];
      [
        ['Qué fue bien 👍', FRAME_COLORS[1]],
        ['Qué mejorar 🔧', FRAME_COLORS[3]],
        ['Acciones ✅', FRAME_COLORS[0]],
      ].forEach(([t, c], i) => out.push(frame(i * (w + g), 0, w, 560 * u, t, c)));
      return out;
    },
  },
  semana: {
    name: 'Semana',
    make: (u) => {
      const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      const w = 240 * u;
      const g = 16 * u;
      const out: Item[] = [title(0, -70 * u, 'Semana', u)];
      days.forEach((d, i) => out.push(frame(i * (w + g), 0, w, 420 * u, d, i >= 5 ? FRAME_COLORS[4] : FRAME_COLORS[5])));
      return out;
    },
  },
  eisenhower: {
    name: 'Matriz de Eisenhower',
    make: (u) => {
      const s = 380 * u;
      const g = 20 * u;
      return [
        title(0, -70 * u, 'Prioridades', u),
        frame(0, 0, s, s, 'Urgente e importante → Hazlo', FRAME_COLORS[3]),
        frame(s + g, 0, s, s, 'Importante, no urgente → Planifícalo', FRAME_COLORS[0]),
        frame(0, s + g, s, s, 'Urgente, no importante → Delégalo', FRAME_COLORS[2]),
        frame(s + g, s + g, s, s, 'Ni urgente ni importante → Elimínalo', FRAME_COLORS[5]),
      ];
    },
  },
  mindmap: {
    name: 'Mapa mental',
    make: (u) => {
      const c = shape('ellipse', -130 * u, -60 * u, 260 * u, 120 * u, 'Idea central', u, '#8e4ec6');
      const out: Item[] = [c];
      const cols = ['#0090ff', '#30a46c', '#f76b15', '#e5484d', '#12a594', '#d6409f'];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const r = 380 * u;
        const n = shape('rect', Math.cos(a) * r * 1.25 - 100 * u, Math.sin(a) * r - 40 * u, 200 * u, 80 * u, `Rama ${i + 1}`, u, cols[i]);
        out.push(n, { ...link(c, n, u), arrow: 'none', curve: true, stroke: cols[i] });
      }
      return out;
    },
  },
  flujo: {
    name: 'Diagrama de flujo',
    make: (u) => {
      const s1 = shape('ellipse', 0, 0, 200 * u, 80 * u, 'Inicio', u, '#30a46c');
      const s2 = shape('rect', 0, 160 * u, 200 * u, 90 * u, 'Paso', u);
      const s3 = shape('diamond', -10 * u, 320 * u, 220 * u, 150 * u, '¿Condición?', u, '#f76b15');
      const s4 = shape('rect', 0, 540 * u, 200 * u, 90 * u, 'Acción', u);
      const s5 = shape('ellipse', 0, 700 * u, 200 * u, 80 * u, 'Fin', u, '#e5484d');
      return [s1, s2, s3, s4, s5, link(s1, s2, u), link(s2, s3, u), link(s3, s4, u, 'Sí'), link(s4, s5, u), { ...link(s3, s2, u, 'No'), curve: true }];
    },
  },
  ideas: {
    name: 'Lluvia de ideas',
    make: (u) => {
      const out: Item[] = [frame(0, 0, 900 * u, 620 * u, 'Lluvia de ideas 💡', FRAME_COLORS[2])];
      for (let i = 0; i < 6; i++) out.push(note((40 + (i % 3) * 290) * u, (80 + Math.floor(i / 3) * 270) * u, 240 * u, '', NOTE_COLORS[i % NOTE_COLORS.length]));
      return out;
    },
  },
};

export const TEMPLATES = Object.entries(T).map(([k, v]) => ({ key: k, name: v.name }));

export function insertTemplate(b: BoardView, key: string) {
  const t = T[key];
  if (!t) return;
  const u = 1 / b.view.zoom;
  const items = t.make(u);
  // centrar en la vista
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const it of items) {
    if (!('x' in it)) continue;
    const w = 'w' in it ? (it as any).w : 200 * u;
    const hh = 'h' in it ? (it as any).h : 40 * u;
    x1 = Math.min(x1, it.x);
    y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + w);
    y2 = Math.max(y2, it.y + hh);
  }
  const [cx, cy] = b.viewCenter();
  const dx = cx - (x1 + x2) / 2;
  const dy = cy - (y1 + y2) / 2;
  const placed = items.map((it) => {
    const z = it.kind === 'frame' ? 0 : b.doc.nextZ();
    if (it.kind === 'connector') return { ...it, z };
    return { ...it, x: (it as any).x + dx, y: (it as any).y + dy, z } as Item;
  });
  b.doc.add(placed);
  b.setTool('select');
  b.selection = new Set(placed.map((p) => p.id));
  b.refreshUI();
  b.fitRect({ x: x1 + dx, y: y1 + dy, w: x2 - x1, h: y2 - y1 });
}
