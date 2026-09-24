// Bloques de código, gráficos a partir de tablas y emojis/stickers.
import { computeTable } from '../sheet/format';
import type { BoardView } from '../board/boardView';
import type { ChartItem, ChartKind, CodeItem, TableItem, TextItem } from '../types';
import { h, toast, uid } from '../util';
import { CODE_BASE_W, CODE_LANGS } from '../board/extra';
import { itemBounds } from '../board/render';

function modal(title: string, body: HTMLElement[], onSave: () => void, saveLabel = 'Guardar', wide = true) {
  const close = () => bg.remove();
  const bg = h(
    'div',
    { class: 'modal-bg' },
    h(
      'div',
      { class: 'modal' + (wide ? ' wide' : '') },
      h('h2', {}, title),
      ...body,
      h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: () => (onSave(), close()) }, saveLabel),
      ),
    ),
  );
  document.body.append(bg);
  return close;
}

// ------------------------------------------------------------------ código
export function editCode(b: BoardView, existing?: CodeItem) {
  const ta = h('textarea', {
    class: 'code-input',
    rows: 14,
    spellcheck: false,
    value: existing?.code ?? '',
    placeholder: '// Escribe o pega código aquí',
  }) as HTMLTextAreaElement;
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    }
  });
  const lang = h(
    'select',
    { class: 'doc-select' },
    ...CODE_LANGS.map(([k, l]) => h('option', { value: k, selected: k === (existing?.lang ?? 'js') }, l)),
  ) as HTMLSelectElement;
  modal('Bloque de código', [h('label', {}, 'Lenguaje ', lang), ta], () => {
    const code = ta.value.replace(/\s+$/, '');
    if (!code) return;
    if (existing) {
      const cur = b.doc.get(existing.id);
      if (cur?.kind === 'code') b.doc.commit([{ ...cur, code, lang: lang.value }]);
      return;
    }
    const [cx, cy] = b.viewCenter();
    const w = CODE_BASE_W / b.view.zoom;
    const c: CodeItem = { id: uid(), rev: 0, by: '', z: b.doc.nextZ(), kind: 'code', x: cx - w / 2, y: cy - 80 / b.view.zoom, w, h: 0, code, lang: lang.value };
    b.doc.add([c]);
    b.setTool('select');
    b.selection = new Set([c.id]);
    b.refreshUI();
  });
  setTimeout(() => ta.focus());
}

export async function copyCode(c: CodeItem) {
  try {
    await navigator.clipboard.writeText(c.code);
    toast('Código copiado');
  } catch {
    toast('No se pudo copiar');
  }
}

// ------------------------------------------------------------------ gráficos
export function createChart(b: BoardView, t: TableItem) {
  const tb = itemBounds(t);
  const w = 400 / b.view.zoom;
  const ch: ChartItem = {
    id: uid(),
    rev: 0,
    by: '',
    z: b.doc.nextZ(),
    kind: 'chart',
    x: tb.x + tb.w + 40 / b.view.zoom,
    y: tb.y,
    w,
    h: w * 0.65,
    chart: 'bar',
    table: t.id,
    data: computeTable(t).text.map((r) => [...r]),
    title: t.cells[0]?.slice(1).join(', ') || 'Gráfico',
  };
  b.doc.add([ch]);
  b.setTool('select');
  b.selection = new Set([ch.id]);
  b.refreshUI();
  toast('El gráfico se actualiza solo cuando cambias la tabla');
}

export function editChart(b: BoardView, ch: ChartItem) {
  const title = h('input', { type: 'text', value: ch.title }) as HTMLInputElement;
  const types: [ChartKind, string][] = [
    ['bar', 'Barras'],
    ['line', 'Líneas'],
    ['pie', 'Circular (1.ª serie)'],
  ];
  const sel = h('select', { class: 'doc-select' }, ...types.map(([k, l]) => h('option', { value: k, selected: k === ch.chart }, l))) as HTMLSelectElement;
  modal(
    'Gráfico',
    [h('label', {}, 'Título', title), h('label', {}, 'Tipo ', sel), h('p', { class: 'panel-hint' }, 'Los datos salen de la tabla: la 1.ª columna son las etiquetas y cada columna numérica es una serie.')],
    () => {
      const cur = b.doc.get(ch.id);
      if (cur?.kind === 'chart') b.doc.commit([{ ...cur, title: title.value, chart: sel.value as ChartKind }]);
    },
    'Guardar',
    false,
  );
}

// ------------------------------------------------------------------ emojis y stickers
const EMOJI: [string, string[]][] = [
  ['Caras', ['😀', '😂', '😊', '😍', '🤔', '😎', '😴', '😮', '😢', '😡', '🥳', '🤯', '🙃', '😬', '🤩', '😇']],
  ['Gestos', ['👍', '👎', '👏', '🙌', '👌', '✌️', '🤞', '💪', '👀', '🙏', '👋', '☝️', '✍️', '🤝', '🫶', '👉']],
  ['Símbolos', ['❤️', '⭐', '🔥', '✨', '💡', '⚡', '✅', '❌', '⚠️', '❓', '❗', '💯', '🎯', '🔒', '📌', '🏁']],
  ['Objetos', ['📅', '⏰', '📎', '📝', '📚', '💻', '📱', '🖊️', '🔧', '🧩', '🎨', '📷', '🎵', '💰', '🏠', '🚀']],
  ['Naturaleza', ['🌱', '🌳', '🌸', '🌞', '🌙', '🌧️', '❄️', '🌊', '🐱', '🐶', '🦊', '🐝', '🍀', '🍎', '☕', '🍕']],
  ['Flechas', ['⬆️', '⬇️', '⬅️', '➡️', '↗️', '↘️', '↩️', '🔄', '➕', '➖', '✖️', '➗', '🔴', '🟡', '🟢', '🔵']],
];

export function pickEmoji(b: BoardView) {
  const close = () => bg.remove();
  const place = (e: string) => {
    close();
    const [cx, cy] = b.viewCenter();
    const size = 64 / b.view.zoom;
    const t: TextItem = { id: uid(), rev: 0, by: '', z: b.doc.nextZ(), kind: 'text', x: cx - size / 2, y: cy - size / 2, text: e, size, color: '#1f2328' };
    b.doc.add([t]);
    b.setTool('select');
    b.selection = new Set([t.id]);
    b.refreshUI();
  };
  const bg = h(
    'div',
    { class: 'modal-bg', onclick: (ev: Event) => ev.target === bg && close() },
    h(
      'div',
      { class: 'modal emoji-modal' },
      h('h2', {}, 'Emojis y stickers'),
      ...EMOJI.flatMap(([cat, list]) => [
        h('div', { class: 'ip-title' }, cat),
        h('div', { class: 'emoji-grid' }, ...list.map((e) => h('button', { class: 'emoji', onclick: () => place(e) }, e))),
      ]),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, 'Cerrar')),
    ),
  );
  document.body.append(bg);
}
