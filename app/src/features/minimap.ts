// Minimapa: vista general de toda la pizarra; tocar o arrastrar para ir a esa zona.
import type { BoardView } from '../board/boardView';
import type { Rect } from '../types';
import { h, unionRect } from '../util';
import { itemBounds } from '../board/render';

const W = 200;
const H = 130;
const COLORS: Record<string, string> = {
  note: '#f5d76e',
  frame: '#cfe3ff',
  doc: '#ffffff',
  pdf: '#ffd9d9',
  image: '#c9c4ba',
  table: '#ffffff',
  todo: '#ffffff',
  shape: '#b9d4f5',
  code: '#2a2f37',
  chart: '#ffffff',
  video: '#2a2f37',
};

export class Minimap {
  el: HTMLElement;
  private c: HTMLCanvasElement;
  private world: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private k = 1;
  private timer: any = null;

  constructor(private b: BoardView) {
    this.c = h('canvas', { width: W * 2, height: H * 2 }) as HTMLCanvasElement;
    this.c.style.width = W + 'px';
    this.c.style.height = H + 'px';
    this.el = h('div', { class: 'minimap' }, this.c);
    const go = (e: PointerEvent) => {
      const r = this.c.getBoundingClientRect();
      const wx = this.world.x + (e.clientX - r.left) / this.k;
      const wy = this.world.y + (e.clientY - r.top) / this.k;
      const v = this.b.view;
      this.b.view = { ...v, x: wx - this.b.w / 2 / v.zoom, y: wy - this.b.h / 2 / v.zoom };
      this.b.viewChanged();
    };
    let dragging = false;
    this.c.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragging = true;
      this.c.setPointerCapture(e.pointerId);
      go(e);
    });
    this.c.addEventListener('pointermove', (e) => dragging && go(e));
    this.c.addEventListener('pointerup', () => (dragging = false));
  }

  /** Repinta como mucho ~6 veces por segundo. */
  update() {
    if (this.timer || this.el.classList.contains('hidden')) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.draw();
    }, 150);
  }

  draw() {
    const b = this.b;
    const vp: Rect = { x: b.view.x, y: b.view.y, w: b.w / b.view.zoom, h: b.h / b.view.zoom };
    let r: Rect | null = { ...vp };
    const items = b.shown().filter((i) => i.kind !== 'comment');
    for (const it of items) r = unionRect(r, itemBounds(it));
    const pad = Math.max(r!.w, r!.h) * 0.05;
    this.world = { x: r!.x - pad, y: r!.y - pad, w: r!.w + pad * 2, h: r!.h + pad * 2 };
    this.k = Math.min(W / this.world.w, H / this.world.h);
    const ctx = this.c.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(250,249,246,0.96)';
    ctx.fillRect(0, 0, W, H);
    const tx = (x: number) => (x - this.world.x) * this.k;
    const ty = (y: number) => (y - this.world.y) * this.k;
    for (const it of items) {
      const bb = itemBounds(it);
      const w = Math.max(1, bb.w * this.k);
      const hh = Math.max(1, bb.h * this.k);
      if (it.kind === 'stroke') {
        ctx.fillStyle = it.color === '#ffffff' ? '#ddd' : it.color;
        ctx.globalAlpha = 0.55;
      } else {
        ctx.fillStyle = (it.kind === 'note' ? it.color : COLORS[it.kind]) ?? '#dcd8cf';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(tx(bb.x), ty(bb.y), w, hh);
      if (it.kind !== 'stroke' && w > 3) {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(tx(bb.x), ty(bb.y), w, hh);
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#0090ff';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(0,144,255,0.08)';
    ctx.fillRect(tx(vp.x), ty(vp.y), vp.w * this.k, vp.h * this.k);
    ctx.strokeRect(tx(vp.x), ty(vp.y), vp.w * this.k, vp.h * this.k);
  }
}
