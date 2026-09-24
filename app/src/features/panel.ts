// Panel lateral genérico (capas, vistas, comentarios, búsqueda, historial, compartir).
import type { BoardView } from '../board/boardView';
import { h } from '../util';
import { icons } from '../ui/icons';

let current: { close: () => void; key: string } | null = null;

export interface PanelCtl {
  body: HTMLElement;
  refresh: () => void;
  close: () => void;
}

/**
 * Abre un panel a la derecha. `render` se vuelve a llamar cuando cambian los elementos de la pizarra.
 * Si ya estaba abierto el mismo panel, lo cierra (botón conmutador).
 */
export function openPanel(b: BoardView, key: string, title: string, render: (ctl: PanelCtl) => void, opts: { live?: boolean } = { live: true }): PanelCtl | null {
  if (current?.key === key) {
    current.close();
    return null;
  }
  current?.close();
  const body = h('div', { class: 'panel-body' });
  const el = h(
    'aside',
    { class: 'side-panel', onpointerdown: (e: Event) => e.stopPropagation() },
    h('div', { class: 'panel-head' }, h('h3', {}, title), h('button', { class: 'tb small', title: 'Cerrar', html: icons.x, onclick: () => ctl.close() })),
    body,
  );
  let unsub: (() => void) | null = null;
  const ctl: PanelCtl = {
    body,
    refresh: () => render(ctl),
    close: () => {
      unsub?.();
      el.remove();
      if (current?.key === key) current = null;
    },
  };
  b.root.append(el);
  render(ctl);
  if (opts.live !== false) {
    let t: any;
    unsub = b.doc.subscribe(() => {
      clearTimeout(t);
      t = setTimeout(() => render(ctl), 120);
    }) as () => void;
  }
  current = { close: ctl.close, key };
  return ctl;
}

export function closePanels() {
  current?.close();
}
