// Capas: ocultar/bloquear grupos de elementos y decidir qué va encima.
import type { BoardView } from '../board/boardView';
import type { Item, LayerItem } from '../types';
import { h, uid } from '../util';
import { icons } from '../ui/icons';
import { askConfirm, askText } from '../ui/dialogs';
import { openPanel } from './panel';

const KEY = (pid: string) => 'canvaspp.layer.' + pid;

export function loadActiveLayer(b: BoardView) {
  try {
    const id = localStorage.getItem(KEY(b.meta.id)) || undefined;
    b.activeLayer = id && b.doc.get(id)?.kind === 'layer' ? id : undefined;
  } catch {}
}

function setActive(b: BoardView, id: string | undefined) {
  b.activeLayer = id;
  try {
    if (id) localStorage.setItem(KEY(b.meta.id), id);
    else localStorage.removeItem(KEY(b.meta.id));
  } catch {}
}

export function openLayers(b: BoardView) {
  openPanel(b, 'layers', 'Capas', ({ body, refresh }) => {
    const layers = b.layers();
    if (b.activeLayer && !layers.some((l) => l.id === b.activeLayer)) setActive(b, undefined);
    const count = (id: string | undefined) => b.doc.visible().filter((i) => i.kind !== 'layer' && i.kind !== 'bookmark' && i.layer === id).length;
    const sel = [...b.selection];
    const moveSel = (id: string | undefined) => {
      const items = sel.map((s) => b.doc.get(s)).filter(Boolean) as Item[];
      b.doc.commit(items.map((it) => ({ ...it, layer: id }) as Item));
    };
    const row = (l: LayerItem | null, idx: number) => {
      const id = l?.id;
      const active = b.activeLayer === id;
      return h(
        'div',
        { class: 'layer-row' + (active ? ' active' : '') },
        h('input', { type: 'radio', name: 'active-layer', checked: active, title: 'Dibujar en esta capa', onchange: () => (setActive(b, id), refresh()) }),
        h(
          'div',
          { class: 'layer-name', ondblclick: () => l && renameLayer(b, l) },
          h('strong', {}, l ? l.name : 'Principal'),
          h('small', {}, `${count(id)} elementos`),
        ),
        l &&
          h('button', {
            class: 'tb small' + (l.hidden ? ' off' : ''),
            title: l.hidden ? 'Mostrar' : 'Ocultar',
            html: l.hidden ? icons.eyeOff : icons.eye,
            onclick: () => b.doc.commit([{ ...l, hidden: !l.hidden }]),
          }),
        l &&
          h('button', {
            class: 'tb small' + (l.lockedLayer ? ' on' : ''),
            title: l.lockedLayer ? 'Desbloquear' : 'Bloquear',
            html: l.lockedLayer ? icons.lock : icons.unlock,
            onclick: () => b.doc.commit([{ ...l, lockedLayer: !l.lockedLayer }]),
          }),
        l && idx < layers.length - 1 && h('button', { class: 'tb small', title: 'Subir', html: icons.up, onclick: () => swap(b, layers, idx, idx + 1) }),
        l && idx > 0 && h('button', { class: 'tb small', title: 'Bajar', html: icons.down, onclick: () => swap(b, layers, idx, idx - 1) }),
        sel.length > 0 && h('button', { class: 'tb small', title: 'Mover la selección aquí', html: icons.moveIn, onclick: () => moveSel(id) }),
        l && h('button', { class: 'tb small', title: 'Renombrar', html: icons.edit, onclick: () => renameLayer(b, l) }),
        l && h('button', { class: 'tb small danger', title: 'Eliminar capa', html: icons.trash, onclick: () => deleteLayer(b, l) }),
      );
    };
    body.replaceChildren(
      h('p', { class: 'panel-hint' }, 'Lo nuevo se dibuja en la capa marcada. Las capas de arriba tapan a las de abajo.'),
      ...[...layers].reverse().map((l) => row(l, layers.indexOf(l))),
      row(null, -1),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            const name = await askText('Nueva capa', `Capa ${layers.length + 1}`, 'Crear');
            if (!name) return;
            const l: LayerItem = { id: uid(), rev: 0, by: '', z: 0, kind: 'layer', name, order: (layers[layers.length - 1]?.order ?? 0) + 1, hidden: false, lockedLayer: false };
            setActive(b, l.id);
            b.doc.commit([l]);
          },
        },
        h('span', { html: icons.plus }),
        'Nueva capa',
      ),
    );
  });
}

function swap(b: BoardView, layers: LayerItem[], i: number, j: number) {
  const a = layers[i];
  const c = layers[j];
  b.doc.commit([
    { ...a, order: c.order },
    { ...c, order: a.order },
  ]);
}

async function renameLayer(b: BoardView, l: LayerItem) {
  const name = await askText('Nombre de la capa', l.name);
  const cur = b.doc.get(l.id);
  if (name && cur?.kind === 'layer') b.doc.commit([{ ...cur, name }]);
}

async function deleteLayer(b: BoardView, l: LayerItem) {
  if (!(await askConfirm(`¿Eliminar la capa "${l.name}"?`, 'Sus elementos pasan a la capa Principal.', 'Eliminar'))) return;
  const items = b.doc.visible().filter((i) => i.layer === l.id);
  b.doc.commit([...items.map((i) => ({ ...i, layer: undefined }) as Item), { ...l, deleted: true }]);
  if (b.activeLayer === l.id) setActive(b, undefined);
}
