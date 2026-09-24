// Búsqueda de texto en toda la pizarra (textos, post-its, documentos, PDF, tablas, tareas, código…).
import { computeTable } from '../sheet/format';
import type { BoardView } from '../board/boardView';
import type { Item } from '../types';
import { h } from '../util';
import { icons } from '../ui/icons';
import { openPanel } from './panel';

const KIND_LABEL: Record<string, string> = {
  text: 'Texto',
  note: 'Post-it',
  doc: 'Documento',
  pdf: 'PDF',
  table: 'Tabla',
  todo: 'Tareas',
  link: 'Enlace',
  shape: 'Forma',
  frame: 'Marco',
  code: 'Código',
  math: 'Fórmula',
  chart: 'Gráfico',
  comment: 'Comentario',
  audio: 'Nota de voz',
  video: 'Vídeo',
  connector: 'Conector',
};

const htmlText = new WeakMap<object, string>();
function stripHtml(it: object, html: string) {
  let t = htmlText.get(it);
  if (t == null) {
    t = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    htmlText.set(it, t);
  }
  return t;
}

/** Trozos de texto buscables de un elemento (con página, para los PDF). */
export function searchable(it: Item): { text: string; page?: number }[] {
  switch (it.kind) {
    case 'text':
      return [{ text: it.text }];
    case 'note':
      return [{ text: it.text }];
    case 'doc':
      return [{ text: it.title }, { text: stripHtml(it, it.html) }];
    case 'pdf':
      return [{ text: it.title }, ...(it.text ?? []).map((t, i) => ({ text: t, page: i + 1 }))];
    case 'table':
      return [{ text: computeTable(it).text.map((r) => r.join(' · ')).join('\n') }];
    case 'todo':
      return [{ text: it.title }, ...it.items.map((i) => ({ text: i.t }))];
    case 'link':
      return [{ text: it.title + ' ' + it.url }];
    case 'shape':
      return [{ text: it.label }];
    case 'frame':
      return [{ text: it.title }];
    case 'code':
      return [{ text: it.code }];
    case 'math':
      return [{ text: it.tex }];
    case 'chart':
      return [{ text: it.title }];
    case 'comment':
      return it.msgs.map((m) => ({ text: `${m.author}: ${m.text}` }));
    case 'audio':
    case 'video':
      return [{ text: it.title }];
    case 'connector':
      return [{ text: it.label }];
  }
  return [];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function openSearch(b: BoardView) {
  let q = '';
  const input = h('input', { type: 'search', class: 'panel-search', placeholder: 'Buscar en la pizarra…', autofocus: true }) as HTMLInputElement;
  const results = h('div', { class: 'search-results' });
  const run = () => {
    q = input.value.trim();
    if (q.length < 2) {
      results.replaceChildren(h('p', { class: 'panel-hint' }, 'Escribe al menos 2 letras. Busca en textos, post-its, documentos, PDF, tablas, tareas, código y comentarios.'));
      return;
    }
    const nq = norm(q);
    const out: HTMLElement[] = [];
    for (const it of b.shown()) {
      for (const chunk of searchable(it)) {
        const nt = norm(chunk.text);
        const idx = nt.indexOf(nq);
        if (idx < 0) continue;
        const start = Math.max(0, idx - 40);
        const snippet = chunk.text.slice(start, idx + q.length + 60).replace(/\s+/g, ' ');
        const rel = idx - start;
        out.push(
          h(
            'button',
            {
              class: 'search-hit',
              onclick: () => {
                b.focusItem(it.id);
                if (it.kind === 'pdf' && chunk.page) b.openPdf(it.id, chunk.page - 1);
              },
            },
            h('small', {}, (KIND_LABEL[it.kind] ?? it.kind) + (chunk.page ? ` · pág. ${chunk.page}` : '')),
            h('span', {}, start > 0 ? '…' : '', snippet.slice(0, rel), h('mark', {}, snippet.slice(rel, rel + q.length)), snippet.slice(rel + q.length)),
          ),
        );
        break; // un resultado por elemento (salvo PDF con varias páginas)
      }
      if (out.length > 200) break;
    }
    results.replaceChildren(out.length ? h('p', { class: 'panel-hint' }, `${out.length} resultado${out.length === 1 ? '' : 's'}`) : h('p', { class: 'panel-hint' }, 'Sin resultados'), ...out);
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') (results.querySelector('.search-hit') as HTMLButtonElement | null)?.click();
  });
  const ctl = openPanel(
    b,
    'search',
    'Buscar',
    ({ body }) => {
      if (!body.contains(input)) body.replaceChildren(h('div', { class: 'search-box' }, h('span', { html: icons.search }), input), results);
      run();
    },
    { live: true },
  );
  if (ctl) setTimeout(() => input.focus(), 30);
}
