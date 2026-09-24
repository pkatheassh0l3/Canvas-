// Vistas guardadas: marcadores de zonas de la pizarra (sincronizados).
import type { BoardView } from '../board/boardView';
import type { BookmarkItem } from '../types';
import { h, uid } from '../util';
import { icons } from '../ui/icons';
import { askText } from '../ui/dialogs';
import { openPanel } from './panel';

export function bookmarks(b: BoardView): BookmarkItem[] {
  return (b.doc.visible().filter((i) => i.kind === 'bookmark') as BookmarkItem[]).sort((a, c) => a.order - c.order);
}

export async function addBookmark(b: BoardView) {
  const list = bookmarks(b);
  const name = await askText('Guardar esta vista', `Vista ${list.length + 1}`, 'Guardar');
  if (!name) return;
  const bm: BookmarkItem = { id: uid(), rev: 0, by: '', z: 0, kind: 'bookmark', name, x: b.view.x, y: b.view.y, zoom: b.view.zoom, order: (list[list.length - 1]?.order ?? 0) + 1 };
  b.doc.commit([bm]);
}

/** Ir a la vista guardada nº i (atajos Alt+1…9). */
export function goBookmark(b: BoardView, i: number) {
  const bm = bookmarks(b)[i];
  if (bm) b.animateView({ x: bm.x, y: bm.y, zoom: bm.zoom });
}

export function openBookmarks(b: BoardView) {
  openPanel(b, 'bookmarks', 'Vistas guardadas', ({ body }) => {
    const list = bookmarks(b);
    body.replaceChildren(
      h('p', { class: 'panel-hint' }, 'Guarda zonas de la pizarra para volver a ellas con un toque (o con Alt + 1…9).'),
      ...list.map((bm, i) =>
        h(
          'div',
          { class: 'list-row' },
          h(
            'button',
            { class: 'list-main', onclick: () => b.animateView({ x: bm.x, y: bm.y, zoom: bm.zoom }) },
            h('span', { class: 'kbd' }, i < 9 ? String(i + 1) : '·'),
            h('strong', {}, bm.name),
            h('small', {}, `${Math.round(bm.zoom * 100)}%`),
          ),
          h('button', {
            class: 'tb small',
            title: 'Actualizar con la vista actual',
            html: icons.refresh,
            onclick: () => b.doc.commit([{ ...bm, x: b.view.x, y: b.view.y, zoom: b.view.zoom }]),
          }),
          h('button', {
            class: 'tb small',
            title: 'Renombrar',
            html: icons.edit,
            onclick: async () => {
              const name = await askText('Nombre de la vista', bm.name);
              if (name) b.doc.commit([{ ...bm, name }]);
            },
          }),
          h('button', { class: 'tb small danger', title: 'Borrar', html: icons.trash, onclick: () => b.doc.remove([bm.id]) }),
        ),
      ),
      h('button', { class: 'btn', onclick: () => addBookmark(b) }, h('span', { html: icons.bookmark }), 'Guardar vista actual'),
    );
  });
}
