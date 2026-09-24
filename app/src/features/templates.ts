// Plantillas para empezar un proyecto: planificación, ideas, análisis, reuniones, diagramas, estudio y personal.
// Cada plantilla genera elementos nuevos (ids nuevos cada vez) en coordenadas del mundo a partir de (0, 0).
import type { ConnectorItem, FrameItem, Item, NoteItem, ShapeItem, ShapeKind, TableItem, TextItem, TodoItem } from '../types';
import { uid } from '../util';
import { FRAME_COLORS, TODO_BASE_W } from '../board/items';
import { NOTE_COLORS } from '../board/render';
import { settings } from '../settings';

// ---------------------------------------------------------------- piezas
const base = () => ({ id: uid(), rev: 1, by: settings.clientId, z: 0 });
const F = { blue: FRAME_COLORS[0], green: FRAME_COLORS[1], yellow: FRAME_COLORS[2], pink: FRAME_COLORS[3], purple: FRAME_COLORS[4], grey: FRAME_COLORS[5] };
const N = { yellow: NOTE_COLORS[0], pink: NOTE_COLORS[1], blue: NOTE_COLORS[2], green: NOTE_COLORS[3], orange: NOTE_COLORS[4], purple: NOTE_COLORS[5], white: NOTE_COLORS[6] };
const C = { ink: '#1f2328', muted: '#6b6f76', blue: '#0090ff', green: '#30a46c', orange: '#f76b15', red: '#e5484d', purple: '#8e4ec6', teal: '#12a594', pink: '#d6409f', yellow: '#f5c400' };

const frame = (x: number, y: number, w: number, h: number, title: string, color = F.blue): FrameItem => ({ ...base(), kind: 'frame', x, y, w, h, title, color });
const note = (x: number, y: number, text: string, color = N.yellow, w = 220, h = w): NoteItem => ({
  ...base(),
  kind: 'note',
  x,
  y,
  w,
  h,
  color,
  text,
  baseW: 240,
  baseH: (240 * h) / w,
  strokes: [],
});
const shape = (k: ShapeKind, x: number, y: number, w: number, h: number, label = '', color = C.blue, fill = true): ShapeItem => ({
  ...base(),
  kind: 'shape',
  shape: k,
  x,
  y,
  w,
  h,
  stroke: color,
  fill: fill ? color + '22' : 'none',
  sw: 2.5,
  label,
});
const line = (x1: number, y1: number, x2: number, y2: number, color = C.muted, arrow = false, sw = 2.5): ShapeItem => ({
  ...shape(arrow ? 'arrow' : 'line', x1, y1, x2 - x1, y2 - y1, '', color, false),
  sw,
});
const link = (a: Item, b: Item, label = '', o: Partial<ConnectorItem> = {}): ConnectorItem => ({
  ...base(),
  kind: 'connector',
  from: { id: a.id, x: 0, y: 0 },
  to: { id: b.id, x: 0, y: 0 },
  stroke: C.muted,
  sw: 2,
  arrow: 'end',
  curve: false,
  label,
  ...o,
});
const text = (x: number, y: number, t: string, size = 20, color = C.ink): TextItem => ({ ...base(), kind: 'text', x, y, text: t, size, color });
const title = (x: number, y: number, t: string, size = 40) => text(x, y, t, size);
const table = (x: number, y: number, w: number, cells: string[][], fs = 16, header = true): TableItem => ({ ...base(), kind: 'table', x, y, w, h: 0, cells, header, fs });
const todo = (x: number, y: number, t: string, items: string[], w = TODO_BASE_W): TodoItem => ({
  ...base(),
  kind: 'todo',
  x,
  y,
  w,
  h: 0,
  title: t,
  items: items.map((i) => ({ t: i, done: false })),
});
const range = (n: number) => [...Array(n).keys()];

// ---------------------------------------------------------------- catálogo
export interface TemplateDef {
  key: string;
  name: string;
  category: string;
  desc: string;
  make: () => Item[];
}

export const CATEGORIES = ['Planificación', 'Ideas', 'Análisis y estrategia', 'Reuniones', 'Diagramas', 'Estudio', 'Personal'];

const T: TemplateDef[] = [
  // ============================== Planificación
  {
    key: 'kanban',
    name: 'Kanban',
    category: 'Planificación',
    desc: 'Por hacer, en curso y hecho',
    make: () => {
      const w = 320;
      const cols: [string, string][] = [
        ['Por hacer', F.grey],
        ['En curso', F.yellow],
        ['Revisión', F.purple],
        ['Hecho', F.green],
      ];
      return [
        title(0, -80, 'Tablero Kanban'),
        ...cols.map(([t, c], i) => frame(i * (w + 30), 0, w, 700, t, c)),
        note(50, 80, 'Tarea 1'),
        note(50, 330, 'Tarea 2', N.blue),
        note(w + 30 + 50, 80, 'Tarea en marcha', N.orange),
      ];
    },
  },
  {
    key: 'semana',
    name: 'Planificador semanal',
    category: 'Planificación',
    desc: 'Una columna por día',
    make: () => {
      const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      return [
        title(0, -80, 'Semana del …'),
        ...days.map((d, i) => frame(i * 256, 0, 240, 520, d, i >= 5 ? F.purple : F.blue)),
        todo(0, 560, 'Prioridades de la semana', ['', '', ''], 360),
        frame(400, 560, 1392, 260, 'Notas', F.grey),
      ];
    },
  },
  {
    key: 'mes',
    name: 'Calendario mensual',
    category: 'Planificación',
    desc: 'Cuadrícula de 5 semanas',
    make: () => {
      const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const out: Item[] = [title(0, -110, 'Mes')];
      days.forEach((d, i) => out.push(text(i * 210 + 10, -44, d, 22, C.muted)));
      range(35).forEach((n) => out.push(frame((n % 7) * 210, Math.floor(n / 7) * 180, 200, 170, n < 31 ? String(n + 1) : ' ', n % 7 >= 5 ? F.purple : F.grey)));
      return out;
    },
  },
  {
    key: 'dia',
    name: 'Planificador diario',
    category: 'Planificación',
    desc: 'Horario, prioridades y notas',
    make: () => {
      const hours = range(13).map((i) => [`${String(8 + i).padStart(2, '0')}:00`, '']);
      return [
        title(0, -80, 'Hoy'),
        table(0, 0, 520, [['Hora', 'Plan'], ...hours], 16),
        todo(580, 0, '3 prioridades', ['', '', ''], 340),
        todo(580, 220, 'Otras tareas', ['', '', '', ''], 340),
        frame(580, 440, 340, 300, 'Notas', F.yellow),
      ];
    },
  },
  {
    key: 'roadmap',
    name: 'Hoja de ruta',
    category: 'Planificación',
    desc: 'Trimestres por líneas de trabajo',
    make: () => {
      const qs = ['T1', 'T2', 'T3', 'T4'];
      const lanes: [string, string][] = [
        ['Producto', F.blue],
        ['Diseño', F.purple],
        ['Marketing', F.yellow],
      ];
      const out: Item[] = [title(0, -80, 'Hoja de ruta')];
      qs.forEach((q, i) => out.push(text(220 + i * 380 + 150, -10, q, 28, C.muted)));
      lanes.forEach(([l, c], r) => {
        out.push(frame(0, 40 + r * 260, 200 + 4 * 380, 240, l, c));
        out.push(note(240 + r * 380, 110 + r * 260, 'Hito', [N.blue, N.purple, N.orange][r], 320, 140));
      });
      return out;
    },
  },
  {
    key: 'gantt',
    name: 'Cronograma (Gantt)',
    category: 'Planificación',
    desc: 'Tareas por semanas',
    make: () => {
      const weeks = 8;
      const tasks = ['Investigación', 'Diseño', 'Desarrollo', 'Pruebas', 'Lanzamiento'];
      const cols = [C.blue, C.purple, C.orange, C.teal, C.green];
      const out: Item[] = [title(0, -80, 'Cronograma'), table(0, 0, 260 + weeks * 110, [['Tarea', ...range(weeks).map((w) => `S${w + 1}`)], ...tasks.map((t) => [t, ...range(weeks).map(() => '')])], 16)];
      tasks.forEach((_, i) => {
        const start = [0, 1, 2, 5, 7][i];
        const len = [2, 2, 4, 2, 1][i];
        out.push(shape('rect', 260 + start * 110 + 8, 48 + i * 37 + 6, len * 110 - 16, 22, '', cols[i]));
      });
      return out;
    },
  },
  {
    key: 'okr',
    name: 'Objetivos y resultados (OKR)',
    category: 'Planificación',
    desc: 'Objetivo con resultados clave medibles',
    make: () => {
      const out: Item[] = [title(0, -80, 'OKR del trimestre')];
      range(3).forEach((i) => {
        out.push(frame(i * 460, 0, 440, 620, `Objetivo ${i + 1}`, [F.blue, F.green, F.purple][i]));
        out.push(note(i * 460 + 30, 70, 'Qué queremos conseguir', N.white, 380, 110));
        out.push(todo(i * 460 + 30, 210, 'Resultados clave', ['KR1: … de X a Y', 'KR2: …', 'KR3: …'], 380));
      });
      return out;
    },
  },
  {
    key: 'proyecto',
    name: 'Plan de proyecto',
    category: 'Planificación',
    desc: 'Objetivo, alcance, equipo, riesgos y tareas',
    make: () => [
      title(0, -80, 'Plan de proyecto'),
      frame(0, 0, 560, 300, 'Objetivo', F.blue),
      note(30, 60, '¿Qué problema resolvemos y para quién?', N.white, 500, 200),
      frame(590, 0, 560, 300, 'Alcance', F.green),
      note(620, 60, 'Incluye / no incluye', N.white, 500, 200),
      frame(0, 330, 560, 300, 'Equipo y roles', F.purple),
      table(30, 390, 500, [['Persona', 'Rol'], ['', ''], ['', ''], ['', '']]),
      frame(590, 330, 560, 300, 'Riesgos', F.pink),
      table(620, 390, 500, [['Riesgo', 'Plan'], ['', ''], ['', '']]),
      todo(1180, 0, 'Próximos pasos', ['', '', '', '', ''], 360),
      frame(1180, 330, 360, 300, 'Fechas clave', F.yellow),
    ],
  },
  // ============================== Ideas
  {
    key: 'ideas',
    name: 'Lluvia de ideas',
    category: 'Ideas',
    desc: 'Pregunta central y post-its',
    make: () => {
      const out: Item[] = [frame(0, 0, 1000, 700, 'Lluvia de ideas 💡', F.yellow), note(390, 70, '¿Cuál es la pregunta?', N.white, 220, 120)];
      const cols = [N.yellow, N.pink, N.blue, N.green, N.orange, N.purple];
      range(8).forEach((i) => out.push(note(40 + (i % 4) * 240, 240 + Math.floor(i / 4) * 230, '', cols[i % cols.length], 200)));
      return out;
    },
  },
  {
    key: 'mindmap',
    name: 'Mapa mental',
    category: 'Ideas',
    desc: 'Idea central con ramas',
    make: () => {
      const c = shape('ellipse', -130, -60, 260, 120, 'Idea central', C.purple);
      const out: Item[] = [c];
      const cols = [C.blue, C.green, C.orange, C.red, C.teal, C.pink];
      cols.forEach((col, i) => {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const n = shape('rect', Math.cos(a) * 475 - 100, Math.sin(a) * 380 - 40, 200, 80, `Rama ${i + 1}`, col);
        out.push(n, link(c, n, '', { arrow: 'none', curve: true, stroke: col }));
      });
      return out;
    },
  },
  {
    key: 'afinidad',
    name: 'Diagrama de afinidad',
    category: 'Ideas',
    desc: 'Agrupa ideas por temas',
    make: () => {
      const out: Item[] = [title(0, -80, 'Agrupación por temas'), frame(0, 0, 1500, 260, 'Ideas sin clasificar', F.grey)];
      range(6).forEach((i) => out.push(note(30 + i * 240, 60, '', N.yellow, 180)));
      range(4).forEach((i) => out.push(frame(i * 380, 300, 360, 520, `Tema ${i + 1}`, [F.blue, F.green, F.pink, F.purple][i])));
      return out;
    },
  },
  {
    key: 'crazy8',
    name: 'Crazy 8',
    category: 'Ideas',
    desc: '8 bocetos rápidos en 8 minutos',
    make: () => [
      title(0, -80, 'Crazy 8 · un boceto por minuto'),
      ...range(8).map((i) => note((i % 4) * 300, Math.floor(i / 4) * 300, String(i + 1), N.white, 280)),
    ],
  },
  {
    key: 'storyboard',
    name: 'Storyboard',
    category: 'Ideas',
    desc: 'Viñetas con descripción',
    make: () => {
      const out: Item[] = [title(0, -80, 'Storyboard')];
      range(6).forEach((i) => {
        const x = (i % 3) * 440;
        const y = Math.floor(i / 3) * 460;
        out.push(note(x, y, '', N.white, 420, 280), text(x, y + 300, `Escena ${i + 1}: …`, 20, C.muted));
      });
      return out;
    },
  },
  {
    key: 'moodboard',
    name: 'Moodboard',
    category: 'Ideas',
    desc: 'Inspiración: imágenes, colores y palabras',
    make: () => [
      title(0, -80, 'Moodboard'),
      frame(0, 0, 900, 620, 'Imágenes (arrastra aquí)', F.grey),
      frame(930, 0, 420, 300, 'Colores', F.purple),
      ...[C.blue, C.teal, C.yellow, C.orange, C.pink].map((c, i) => shape('ellipse', 960 + i * 76, 90, 62, 62, '', c)),
      frame(930, 320, 420, 300, 'Palabras clave', F.yellow),
      note(960, 380, '', N.white, 160, 100),
      note(1150, 380, '', N.white, 160, 100),
    ],
  },
  {
    key: 'scamper',
    name: 'SCAMPER',
    category: 'Ideas',
    desc: 'Siete preguntas para mejorar una idea',
    make: () => {
      const q: [string, string][] = [
        ['Sustituir', '¿Qué puedo cambiar por otra cosa?'],
        ['Combinar', '¿Qué puedo unir?'],
        ['Adaptar', '¿Qué puedo copiar o ajustar?'],
        ['Modificar', '¿Qué puedo agrandar, reducir, cambiar?'],
        ['Poner otros usos', '¿Para qué más sirve?'],
        ['Eliminar', '¿Qué sobra?'],
        ['Reordenar', '¿Y si lo hago al revés?'],
      ];
      const out: Item[] = [title(0, -80, 'SCAMPER')];
      q.forEach(([t, d], i) => {
        const x = (i % 4) * 360;
        const y = Math.floor(i / 4) * 420;
        out.push(frame(x, y, 340, 400, t, FRAME_COLORS[i % 5]), text(x + 20, y + 60, d, 18, C.muted));
      });
      return out;
    },
  },
  // ============================== Análisis y estrategia
  {
    key: 'dafo',
    name: 'DAFO',
    category: 'Análisis y estrategia',
    desc: 'Debilidades, amenazas, fortalezas y oportunidades',
    make: () => [
      title(0, -80, 'Análisis DAFO'),
      text(0, -24, 'Internas', 20, C.muted),
      frame(0, 10, 520, 440, 'Fortalezas', F.green),
      frame(540, 10, 520, 440, 'Debilidades', F.pink),
      frame(0, 470, 520, 440, 'Oportunidades', F.blue),
      frame(540, 470, 520, 440, 'Amenazas', F.yellow),
      text(0, 920, 'Externas', 20, C.muted),
    ],
  },
  {
    key: 'eisenhower',
    name: 'Matriz de Eisenhower',
    category: 'Análisis y estrategia',
    desc: 'Urgente frente a importante',
    make: () => [
      title(0, -80, 'Prioridades'),
      frame(0, 0, 420, 420, 'Urgente e importante → Hazlo', F.pink),
      frame(440, 0, 420, 420, 'Importante, no urgente → Planifícalo', F.blue),
      frame(0, 440, 420, 420, 'Urgente, no importante → Delégalo', F.yellow),
      frame(440, 440, 420, 420, 'Ni urgente ni importante → Elimínalo', F.grey),
    ],
  },
  {
    key: 'impacto',
    name: 'Impacto / esfuerzo',
    category: 'Análisis y estrategia',
    desc: 'Qué hacer primero',
    make: () => [
      title(0, -80, 'Impacto / esfuerzo'),
      frame(0, 0, 420, 420, 'Victorias rápidas', F.green),
      frame(440, 0, 420, 420, 'Grandes proyectos', F.blue),
      frame(0, 440, 420, 420, 'Rellenos', F.grey),
      frame(440, 440, 420, 420, 'Evitar', F.pink),
      line(-40, 880, -40, -20, C.muted, true),
      text(-150, 400, 'Impacto', 20, C.muted),
      line(-20, 900, 880, 900, C.muted, true),
      text(400, 915, 'Esfuerzo', 20, C.muted),
    ],
  },
  {
    key: 'proscontras',
    name: 'Pros y contras',
    category: 'Análisis y estrategia',
    desc: 'Para tomar una decisión',
    make: () => [
      title(0, -80, 'Decisión: …'),
      frame(0, 0, 480, 600, 'A favor 👍', F.green),
      frame(500, 0, 480, 600, 'En contra 👎', F.pink),
      note(0, 630, 'Conclusión', N.white, 980, 140),
    ],
  },
  {
    key: 'bmc',
    name: 'Business Model Canvas',
    category: 'Análisis y estrategia',
    desc: 'Los 9 bloques del modelo de negocio',
    make: () => {
      const W = 300;
      return [
        title(0, -80, 'Business Model Canvas'),
        frame(0, 0, W, 640, 'Socios clave', F.blue),
        frame(W + 10, 0, W, 315, 'Actividades clave', F.blue),
        frame(W + 10, 325, W, 315, 'Recursos clave', F.blue),
        frame(2 * (W + 10), 0, W, 640, 'Propuesta de valor', F.yellow),
        frame(3 * (W + 10), 0, W, 315, 'Relación con clientes', F.green),
        frame(3 * (W + 10), 325, W, 315, 'Canales', F.green),
        frame(4 * (W + 10), 0, W, 640, 'Segmentos de clientes', F.green),
        frame(0, 650, 2.5 * W + 15, 260, 'Estructura de costes', F.pink),
        frame(2.5 * W + 25, 650, 2.5 * W + 15, 260, 'Fuentes de ingresos', F.purple),
      ];
    },
  },
  {
    key: 'lean',
    name: 'Lean Canvas',
    category: 'Análisis y estrategia',
    desc: 'Modelo de negocio para ideas nuevas',
    make: () => {
      const W = 300;
      return [
        title(0, -80, 'Lean Canvas'),
        frame(0, 0, W, 640, 'Problema', F.pink),
        frame(W + 10, 0, W, 315, 'Solución', F.blue),
        frame(W + 10, 325, W, 315, 'Métricas clave', F.blue),
        frame(2 * (W + 10), 0, W, 640, 'Propuesta de valor única', F.yellow),
        frame(3 * (W + 10), 0, W, 315, 'Ventaja diferencial', F.green),
        frame(3 * (W + 10), 325, W, 315, 'Canales', F.green),
        frame(4 * (W + 10), 0, W, 640, 'Clientes', F.green),
        frame(0, 650, 2.5 * W + 15, 260, 'Costes', F.grey),
        frame(2.5 * W + 25, 650, 2.5 * W + 15, 260, 'Ingresos', F.purple),
      ];
    },
  },
  {
    key: 'empatia',
    name: 'Mapa de empatía',
    category: 'Análisis y estrategia',
    desc: 'Qué piensa, siente, dice y hace',
    make: () => {
      const p = shape('ellipse', 380, 330, 240, 240, 'Persona', C.purple);
      return [
        title(0, -80, 'Mapa de empatía'),
        frame(0, 0, 490, 440, 'Piensa y siente', F.blue),
        frame(510, 0, 490, 440, 'Ve', F.green),
        frame(0, 460, 490, 440, 'Dice y hace', F.yellow),
        frame(510, 460, 490, 440, 'Oye', F.purple),
        p,
        frame(0, 920, 490, 260, 'Frustraciones', F.pink),
        frame(510, 920, 490, 260, 'Deseos', F.green),
      ];
    },
  },
  {
    key: 'journey',
    name: 'Customer journey',
    category: 'Análisis y estrategia',
    desc: 'Etapas, acciones, emociones y oportunidades',
    make: () => {
      const st = ['Descubre', 'Compara', 'Compra', 'Usa', 'Recomienda'];
      const rows = ['Acciones', 'Pensamientos', 'Emociones', 'Oportunidades'];
      const out: Item[] = [title(0, -80, 'Customer journey')];
      st.forEach((s, i) => out.push(shape('rect', 200 + i * 300, 0, 280, 70, s, C.blue)));
      rows.forEach((r, j) => {
        out.push(text(0, 120 + j * 220, r, 22, C.muted));
        st.forEach((_, i) => out.push(note(210 + i * 300, 100 + j * 220, '', [N.yellow, N.blue, N.pink, N.green][j], 260, 190)));
      });
      return out;
    },
  },
  {
    key: 'porques',
    name: '5 porqués',
    category: 'Análisis y estrategia',
    desc: 'Llegar a la causa raíz',
    make: () => {
      const p = shape('rect', 0, 0, 360, 100, 'Problema', C.red);
      const out: Item[] = [title(0, -80, '5 porqués'), p];
      let prev: Item = p;
      range(5).forEach((i) => {
        const n = note(0, 160 + i * 190, `¿Por qué? ${i + 1}`, i === 4 ? N.green : N.yellow, 360, 130);
        out.push(n, link(prev, n));
        prev = n;
      });
      out.push(text(400, 160 + 4 * 190 + 40, '← causa raíz', 20, C.green));
      return out;
    },
  },
  {
    key: 'ishikawa',
    name: 'Espina de pescado',
    category: 'Análisis y estrategia',
    desc: 'Diagrama de Ishikawa (causa y efecto)',
    make: () => {
      const cats = ['Personas', 'Métodos', 'Máquinas', 'Materiales', 'Medidas', 'Entorno'];
      const out: Item[] = [title(0, -80, 'Causa y efecto'), line(0, 400, 1200, 400, C.ink, true, 4), shape('rect', 1220, 340, 260, 120, 'Efecto / problema', C.red)];
      cats.forEach((c, i) => {
        const x = 200 + (i % 3) * 360;
        const top = i < 3;
        const y = top ? 120 : 680;
        out.push(line(x, y, x + 160, 400, C.muted, false, 3), text(x - 40, top ? y - 40 : y + 10, c, 22, C.ink));
      });
      return out;
    },
  },
  {
    key: 'competencia',
    name: 'Análisis de competidores',
    category: 'Análisis y estrategia',
    desc: 'Tabla comparativa',
    make: () => [
      title(0, -80, 'Competidores'),
      table(0, 0, 1100, [['', 'Nosotros', 'Competidor A', 'Competidor B', 'Competidor C'], ['Precio', '', '', '', ''], ['Público', '', '', '', ''], ['Fortalezas', '', '', '', ''], ['Debilidades', '', '', '', ''], ['Canales', '', '', '', '']], 18),
      note(0, 360, 'Conclusiones', N.white, 1100, 180),
    ],
  },
  {
    key: 'decision',
    name: 'Árbol de decisión',
    category: 'Análisis y estrategia',
    desc: 'Opciones y consecuencias',
    make: () => {
      const r = shape('diamond', 380, 0, 240, 150, '¿Decisión?', C.orange);
      const a = shape('rect', 80, 260, 240, 90, 'Opción A', C.blue);
      const b = shape('rect', 680, 260, 240, 90, 'Opción B', C.blue);
      const a1 = shape('rect', 0, 460, 180, 80, 'Resultado', C.green);
      const a2 = shape('rect', 220, 460, 180, 80, 'Resultado', C.red);
      const b1 = shape('rect', 600, 460, 180, 80, 'Resultado', C.green);
      const b2 = shape('rect', 820, 460, 180, 80, 'Resultado', C.red);
      return [title(0, -100, 'Árbol de decisión'), r, a, b, a1, a2, b1, b2, link(r, a, 'Sí'), link(r, b, 'No'), link(a, a1), link(a, a2), link(b, b1), link(b, b2)];
    },
  },
  // ============================== Reuniones
  {
    key: 'retro',
    name: 'Retrospectiva',
    category: 'Reuniones',
    desc: 'Qué fue bien, qué mejorar y acciones',
    make: () => [
      title(0, -80, 'Retrospectiva'),
      frame(0, 0, 380, 600, 'Qué fue bien 👍', F.green),
      frame(400, 0, 380, 600, 'Qué mejorar 🔧', F.pink),
      frame(800, 0, 380, 600, 'Acciones ✅', F.blue),
    ],
  },
  {
    key: 'ssc',
    name: 'Empezar, dejar, seguir',
    category: 'Reuniones',
    desc: 'Start, stop, continue',
    make: () => [
      title(0, -80, 'Empezar · Dejar · Seguir'),
      frame(0, 0, 380, 600, 'Empezar a hacer', F.green),
      frame(400, 0, 380, 600, 'Dejar de hacer', F.pink),
      frame(800, 0, 380, 600, 'Seguir haciendo', F.blue),
    ],
  },
  {
    key: 'acta',
    name: 'Reunión',
    category: 'Reuniones',
    desc: 'Orden del día, notas, acuerdos y tareas',
    make: () => [
      title(0, -80, 'Reunión · fecha'),
      table(0, 0, 400, [['Asistentes'], [''], [''], [''], ['']], 16),
      todo(0, 260, 'Orden del día', ['', '', ''], 400),
      frame(440, 0, 560, 560, 'Notas', F.grey),
      frame(1040, 0, 420, 260, 'Acuerdos', F.green),
      table(1040, 300, 420, [['Tarea', 'Quién', 'Cuándo'], ['', '', ''], ['', '', ''], ['', '', '']], 15),
    ],
  },
  {
    key: 'daily',
    name: 'Daily',
    category: 'Reuniones',
    desc: 'Ayer, hoy y bloqueos',
    make: () => [
      title(0, -80, 'Daily'),
      frame(0, 0, 380, 520, 'Ayer', F.grey),
      frame(400, 0, 380, 520, 'Hoy', F.blue),
      frame(800, 0, 380, 520, 'Bloqueos', F.pink),
    ],
  },
  {
    key: 'pregunta',
    name: 'Tablero de preguntas',
    category: 'Reuniones',
    desc: 'Preguntas, respuestas y temas pendientes',
    make: () => [
      title(0, -80, 'Preguntas'),
      frame(0, 0, 520, 600, 'Preguntas', F.yellow),
      frame(540, 0, 520, 600, 'Respondidas', F.green),
      frame(1080, 0, 380, 600, 'Para otro día', F.grey),
    ],
  },
  // ============================== Diagramas
  {
    key: 'flujo',
    name: 'Diagrama de flujo',
    category: 'Diagramas',
    desc: 'Inicio, pasos, decisión y fin',
    make: () => {
      const s1 = shape('ellipse', 0, 0, 200, 80, 'Inicio', C.green);
      const s2 = shape('rect', 0, 160, 200, 90, 'Paso', C.blue);
      const s3 = shape('diamond', -10, 320, 220, 150, '¿Condición?', C.orange);
      const s4 = shape('rect', 0, 540, 200, 90, 'Acción', C.blue);
      const s5 = shape('ellipse', 0, 700, 200, 80, 'Fin', C.red);
      return [s1, s2, s3, s4, s5, link(s1, s2), link(s2, s3), link(s3, s4, 'Sí'), link(s4, s5), link(s3, s2, 'No', { curve: true })];
    },
  },
  {
    key: 'organigrama',
    name: 'Organigrama',
    category: 'Diagramas',
    desc: 'Estructura de un equipo',
    make: () => {
      const top = shape('rect', 480, 0, 240, 90, 'Dirección', C.purple);
      const mids = range(3).map((i) => shape('rect', 80 + i * 400, 200, 240, 90, `Área ${i + 1}`, C.blue));
      const out: Item[] = [title(0, -100, 'Organigrama'), top, ...mids];
      mids.forEach((m, i) => {
        out.push(link(top, m, '', { arrow: 'none' }));
        range(2).forEach((j) => {
          const p = shape('rect', 20 + i * 400 + j * 190, 400, 170, 80, 'Persona', C.teal);
          out.push(p, link(m, p, '', { arrow: 'none' }));
        });
      });
      return out;
    },
  },
  {
    key: 'timeline',
    name: 'Línea de tiempo',
    category: 'Diagramas',
    desc: 'Hitos en orden',
    make: () => {
      const out: Item[] = [title(0, -80, 'Línea de tiempo'), line(0, 300, 1600, 300, C.ink, true, 4)];
      range(6).forEach((i) => {
        const x = 100 + i * 250;
        const up = i % 2 === 0;
        out.push(shape('ellipse', x - 14, 286, 28, 28, '', C.blue), line(x, up ? 286 : 314, x, up ? 200 : 400), note(x - 100, up ? 20 : 400, `Hito ${i + 1} · fecha`, [N.blue, N.yellow][i % 2], 200, 180));
      });
      return out;
    },
  },
  {
    key: 'venn',
    name: 'Diagrama de Venn',
    category: 'Diagramas',
    desc: 'Qué tienen en común',
    make: () => [
      title(0, -80, 'Comparación'),
      shape('ellipse', 0, 0, 520, 520, '', C.blue),
      shape('ellipse', 320, 0, 520, 520, '', C.pink),
      text(120, 240, 'A', 40, C.blue),
      text(680, 240, 'B', 40, C.pink),
      text(385, 250, 'Ambos', 24, C.ink),
    ],
  },
  {
    key: 'ciclo',
    name: 'Ciclo',
    category: 'Diagramas',
    desc: 'Proceso circular en 4 pasos',
    make: () => {
      const pos: [number, number][] = [
        [300, 0],
        [600, 300],
        [300, 600],
        [0, 300],
      ];
      const cols = [C.blue, C.green, C.orange, C.purple];
      const s = pos.map(([x, y], i) => shape('ellipse', x, y, 220, 140, `Paso ${i + 1}`, cols[i]));
      return [title(0, -100, 'Ciclo'), ...s, ...s.map((a, i) => link(a, s[(i + 1) % 4], '', { curve: true }))];
    },
  },
  {
    key: 'piramide',
    name: 'Pirámide',
    category: 'Diagramas',
    desc: 'Niveles de importancia',
    make: () => {
      const out: Item[] = [title(0, -80, 'Pirámide'), shape('triangle', 0, 0, 900, 700, '', C.orange)];
      range(3).forEach((i) => out.push(line(450 - (i + 1) * 112, (i + 1) * 175, 450 + (i + 1) * 112, (i + 1) * 175, C.orange, false, 2.5)));
      ['Nivel 1', 'Nivel 2', 'Nivel 3', 'Nivel 4'].forEach((l, i) => out.push(text(410 - i * 8, 100 + i * 175, l, 22)));
      return out;
    },
  },
  {
    key: 'wireframe',
    name: 'Boceto de app / web',
    category: 'Diagramas',
    desc: 'Pantallas de móvil y escritorio',
    make: () => {
      const phone = (x: number, t: string): Item[] => [
        shape('rect', x, 0, 300, 600, '', C.ink, false),
        shape('rect', x + 20, 20, 260, 44, t, C.muted),
        shape('rect', x + 20, 84, 260, 160, 'Imagen', C.muted),
        shape('rect', x + 20, 264, 260, 30, '', C.muted),
        shape('rect', x + 20, 304, 200, 30, '', C.muted),
        shape('rect', x + 60, 520, 180, 50, 'Botón', C.blue),
      ];
      return [
        title(0, -80, 'Bocetos'),
        ...phone(0, 'Inicio'),
        ...phone(340, 'Detalle'),
        shape('rect', 700, 0, 900, 600, '', C.ink, false),
        shape('rect', 720, 20, 860, 50, 'Menú', C.muted),
        shape('rect', 720, 90, 560, 300, 'Contenido', C.muted),
        shape('rect', 1300, 90, 280, 490, 'Lateral', C.muted),
        shape('rect', 720, 410, 560, 170, '', C.muted),
      ];
    },
  },
  {
    key: 'sitemap',
    name: 'Mapa del sitio',
    category: 'Diagramas',
    desc: 'Páginas de una web',
    make: () => {
      const home = shape('rect', 520, 0, 220, 80, 'Inicio', C.purple);
      const pages = ['Servicios', 'Productos', 'Blog', 'Contacto'].map((p, i) => shape('rect', 60 + i * 300, 180, 220, 80, p, C.blue));
      const out: Item[] = [title(0, -100, 'Mapa del sitio'), home, ...pages];
      pages.forEach((p, i) => {
        out.push(link(home, p, '', { arrow: 'none' }));
        if (i < 3) {
          const sub = shape('rect', 80 + i * 300, 340, 180, 70, 'Subpágina', C.teal);
          out.push(sub, link(p, sub, '', { arrow: 'none' }));
        }
      });
      return out;
    },
  },
  // ============================== Estudio
  {
    key: 'cornell',
    name: 'Apuntes Cornell',
    category: 'Estudio',
    desc: 'Preguntas clave, notas y resumen',
    make: () => [
      title(0, -80, 'Tema:'),
      frame(0, 0, 320, 820, 'Preguntas / ideas clave', F.yellow),
      frame(340, 0, 760, 820, 'Apuntes', F.grey),
      frame(0, 840, 1100, 260, 'Resumen', F.blue),
    ],
  },
  {
    key: 'conceptual',
    name: 'Mapa conceptual',
    category: 'Estudio',
    desc: 'Conceptos unidos por relaciones',
    make: () => {
      const a = shape('rect', 400, 0, 240, 90, 'Concepto', C.purple);
      const b = shape('rect', 60, 260, 220, 80, 'Concepto', C.blue);
      const c = shape('rect', 420, 260, 220, 80, 'Concepto', C.blue);
      const d = shape('rect', 780, 260, 220, 80, 'Concepto', C.blue);
      const e = shape('rect', 240, 500, 220, 80, 'Ejemplo', C.green);
      const f = shape('rect', 620, 500, 220, 80, 'Ejemplo', C.green);
      return [title(0, -100, 'Mapa conceptual'), a, b, c, d, e, f, link(a, b, 'incluye'), link(a, c, 'tiene'), link(a, d, 'produce'), link(b, e, 'p. ej.'), link(c, f, 'p. ej.')];
    },
  },
  {
    key: 'flashcards',
    name: 'Tarjetas de estudio',
    category: 'Estudio',
    desc: 'Pregunta y respuesta',
    make: () => {
      const out: Item[] = [title(0, -80, 'Tarjetas'), text(0, -24, 'Pregunta', 20, C.muted), text(540, -24, 'Respuesta', 20, C.muted)];
      range(5).forEach((i) => out.push(note(0, 20 + i * 200, '', N.blue, 500, 170), note(540, 20 + i * 200, '', N.green, 500, 170)));
      return out;
    },
  },
  {
    key: 'comparativa',
    name: 'Tabla comparativa',
    category: 'Estudio',
    desc: 'Comparar dos o más cosas',
    make: () => [title(0, -80, 'Comparativa'), table(0, 0, 900, [['Aspecto', 'A', 'B', 'C'], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], 18)],
  },
  {
    key: 'estudio',
    name: 'Plan de estudio',
    category: 'Estudio',
    desc: 'Temas, fechas de examen y repaso',
    make: () => [
      title(0, -80, 'Plan de estudio'),
      table(0, 0, 700, [['Tema', 'Fecha', 'Estado'], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']], 16),
      todo(740, 0, 'Esta semana', ['', '', '', ''], 360),
      frame(740, 260, 360, 300, 'Exámenes', F.pink),
      frame(0, 330, 700, 230, 'Dudas para clase', F.yellow),
    ],
  },
  // ============================== Personal
  {
    key: 'habitos',
    name: 'Registro de hábitos',
    category: 'Personal',
    desc: 'Marca cada día de la semana',
    make: () => [
      title(0, -80, 'Hábitos'),
      table(0, 0, 1000, [['Hábito', 'L', 'M', 'X', 'J', 'V', 'S', 'D'], ['💧 Beber agua', '', '', '', '', '', '', ''], ['🚶 Caminar', '', '', '', '', '', '', ''], ['📖 Leer', '', '', '', '', '', '', ''], ['😴 Dormir 8 h', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '']], 18),
    ],
  },
  {
    key: 'anual',
    name: 'Objetivos del año',
    category: 'Personal',
    desc: 'Áreas de vida con metas',
    make: () => {
      const areas: [string, string][] = [
        ['Salud', F.green],
        ['Trabajo', F.blue],
        ['Relaciones', F.pink],
        ['Aprender', F.purple],
        ['Dinero', F.yellow],
        ['Ocio', F.grey],
      ];
      return [title(0, -80, 'Objetivos del año'), ...areas.flatMap(([a, c], i) => [frame((i % 3) * 420, Math.floor(i / 3) * 420, 400, 400, a, c), todo((i % 3) * 420 + 30, Math.floor(i / 3) * 420 + 70, 'Metas', ['', '', ''], 340)])];
    },
  },
  {
    key: 'viaje',
    name: 'Viaje',
    category: 'Personal',
    desc: 'Itinerario, maleta y presupuesto',
    make: () => [
      title(0, -80, 'Viaje a …'),
      table(0, 0, 640, [['Día', 'Plan', 'Alojamiento'], ['1', '', ''], ['2', '', ''], ['3', '', ''], ['4', '', '']], 16),
      todo(680, 0, 'Maleta', ['Documentación', 'Cargadores', 'Ropa', 'Neceser'], 320),
      table(0, 260, 640, [['Gasto', 'Importe'], ['Transporte', ''], ['Alojamiento', ''], ['Comida', ''], ['Total', '']], 16),
      frame(680, 260, 320, 300, 'Ideas y sitios', F.yellow),
    ],
  },
  {
    key: 'diario',
    name: 'Diario',
    category: 'Personal',
    desc: 'Gratitud, lo mejor del día y mañana',
    make: () => [
      title(0, -80, 'Diario · fecha'),
      frame(0, 0, 480, 340, 'Agradezco…', F.green),
      frame(500, 0, 480, 340, 'Lo mejor de hoy', F.yellow),
      frame(0, 360, 480, 340, 'Aprendí…', F.blue),
      frame(500, 360, 480, 340, 'Mañana quiero…', F.purple),
    ],
  },
  {
    key: 'compra',
    name: 'Menú y lista de la compra',
    category: 'Personal',
    desc: 'Comidas de la semana',
    make: () => [
      title(0, -80, 'Menú semanal'),
      table(0, 0, 900, [['', 'Comida', 'Cena'], ...['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d) => [d, '', ''])], 16),
      todo(940, 0, 'Lista de la compra', ['', '', '', '', '', ''], 320),
    ],
  },
];

export const TEMPLATES = T;

/** Elementos nuevos de una plantilla: los marcos quedan debajo del resto. */
export function buildTemplate(key: string): Item[] {
  const t = T.find((x) => x.key === key);
  if (!t) return [];
  const items = t.make();
  let z = 0;
  for (const it of items) if (it.kind === 'frame') it.z = ++z;
  for (const it of items) if (it.kind !== 'frame') it.z = ++z;
  return items;
}

/** Copia de elementos con ids nuevos (enlaces de conectores, grupos, capas y gráficos incluidos). */
export function cloneWithNewIds(items: Item[]): Item[] {
  const ids = new Map<string, string>();
  for (const it of items) {
    ids.set(it.id, uid());
    const g = (it as any).group;
    if (g && !ids.has(g)) ids.set(g, uid());
  }
  // los ids son aleatorios y únicos: basta con sustituirlos allí donde aparezcan como valor
  const json = JSON.stringify(items).replace(/"([A-Za-z0-9_-]{6,64})"/g, (m, id) => (ids.has(id) ? `"${ids.get(id)}"` : m));
  return (JSON.parse(json) as Item[]).map((it) => ({ ...it, rev: 1, by: settings.clientId }));
}
