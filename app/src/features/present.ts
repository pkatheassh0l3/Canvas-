// Modo presentación: recorre los marcos de la pizarra como si fueran diapositivas.
import type { BoardView } from '../board/boardView';
import type { FrameItem } from '../types';
import { h, toast } from '../util';
import { icons } from '../ui/icons';

/** Marcos en orden de lectura: por filas (de arriba abajo) y dentro de cada fila de izquierda a derecha. */
export function slides(b: BoardView): FrameItem[] {
  const frames = b.shown().filter((i): i is FrameItem => i.kind === 'frame');
  if (!frames.length) return [];
  const rowH = Math.min(...frames.map((f) => f.h)) * 0.5;
  return frames.sort((a, c) => Math.round(a.y / rowH) - Math.round(c.y / rowH) || a.x - c.x);
}

export function startPresentation(b: BoardView) {
  const list = slides(b);
  if (!list.length) {
    toast('Añade marcos (Insertar → Marco / sección): cada marco es una diapositiva', 4000);
    return;
  }
  const prevView = { ...b.view };
  const prevTool = b.tool;
  let i = 0;
  const counter = h('span', { class: 'pres-count' });
  const title = h('span', { class: 'pres-title' });
  const laserBtn = h('button', {
    class: 'tb',
    title: 'Puntero láser (L)',
    html: icons.laser,
    onclick: () => {
      b.setTool(b.tool === 'laser' ? 'hand' : 'laser');
      laserBtn.classList.toggle('on', b.tool === 'laser');
    },
  });
  const bar = h(
    'div',
    { class: 'pres-bar' },
    h('button', { class: 'tb', title: 'Anterior (←)', html: icons.back, onclick: () => go(i - 1) }),
    counter,
    h('button', { class: 'tb', title: 'Siguiente (→)', html: icons.next, onclick: () => go(i + 1) }),
    title,
    laserBtn,
    h('button', { class: 'tb', title: 'Salir (Esc)', html: icons.x, onclick: () => stop() }),
  );
  const go = (n: number) => {
    const cur = slides(b);
    if (!cur.length) return stop();
    i = Math.max(0, Math.min(cur.length - 1, n));
    const f = cur[i];
    const pad = Math.min(b.w, b.h) * 0.04;
    const zoom = Math.min((b.w - pad * 2) / f.w, (b.h - pad * 2) / f.h);
    b.animateView({ zoom, x: f.x + f.w / 2 - b.w / 2 / zoom, y: f.y + f.h / 2 - b.h / 2 / zoom }, 450);
    counter.textContent = `${i + 1} / ${cur.length}`;
    title.textContent = f.title;
  };
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) go(i + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(1e9);
    else if (e.key === 'Escape') stop();
    else if (e.key.toLowerCase() === 'l') laserBtn.click();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // deslizar con el dedo para pasar de diapositiva
  let sx = 0;
  const down = (e: PointerEvent) => {
    sx = e.clientX;
  };
  const up = (e: PointerEvent) => {
    if (b.tool === 'laser') return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 60) go(i + (dx < 0 ? 1 : -1));
    else if (Math.abs(dx) < 6 && e.target === b.over) go(i + (e.clientX > b.w / 2 ? 1 : -1));
  };
  const stop = () => {
    window.removeEventListener('keydown', onKey, true);
    b.over.removeEventListener('pointerdown', down);
    b.over.removeEventListener('pointerup', up);
    bar.remove();
    b.root.classList.remove('presenting');
    b.presenting = false;
    b.setTool(prevTool);
    b.animateView(prevView, 350);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  b.presenting = true;
  b.selection.clear();
  b.root.classList.add('presenting');
  b.root.append(bar);
  b.setTool('hand');
  window.addEventListener('keydown', onKey, true);
  b.over.addEventListener('pointerdown', down);
  b.over.addEventListener('pointerup', up);
  document.documentElement.requestFullscreen?.().catch(() => {});
  setTimeout(() => go(0), 120);
}
