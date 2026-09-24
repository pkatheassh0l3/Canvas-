// Dibujo de trazos y post-its sobre un CanvasRenderingContext2D.
import { getStroke } from 'perfect-freehand';
import type { Item, NoteItem, Rect, StrokeData } from '../types';

const pathCache = new WeakMap<StrokeData, Path2D>();
const boundsCache = new WeakMap<object, Rect>();

export const PEN_COLORS = ['#1f2328', '#e5484d', '#f76b15', '#f5c400', '#30a46c', '#0090ff', '#8e4ec6', '#ffffff'];
export const NOTE_COLORS = ['#fff1a8', '#ffd6e0', '#cfe8ff', '#d3f5d3', '#ffe0c2', '#e6dcff', '#ffffff'];
export const NOTE_FONT = '500 17px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function strokeOptions(s: StrokeData) {
  const marker = s.tool === 'marker';
  return {
    size: s.size,
    thinning: marker ? 0 : s.pressure ? 0.62 : 0.5,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !marker && !s.pressure,
    start: { cap: true },
    end: { cap: true },
    last: true,
  };
}

export function toPoints(pts: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2]]);
  return out;
}

function outlineToPath(outline: number[][]): Path2D {
  const p = new Path2D();
  if (!outline.length) return p;
  // curvas cuadráticas entre puntos medios: contorno suave
  p.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}

export function strokePath(s: StrokeData, live = false): Path2D {
  if (!live) {
    const c = pathCache.get(s);
    if (c) return c;
  }
  const opts = strokeOptions(s);
  const path = outlineToPath(getStroke(toPoints(s.pts), { ...opts, last: !live }));
  if (!live) pathCache.set(s, path);
  return path;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeData, live = false) {
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.tool === 'marker' ? 0.38 : 1;
  ctx.fill(strokePath(s, live));
  ctx.globalAlpha = 1;
}

export function strokeBounds(s: StrokeData): Rect {
  const c = boundsCache.get(s);
  if (c) return c;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    const x = s.pts[i],
      y = s.pts[i + 1];
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  const pad = s.size;
  const r = { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  boundsCache.set(s, r);
  return r;
}

export function itemBounds(it: Item): Rect {
  if (it.kind === 'stroke') return strokeBounds(it);
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxW && line.trim()) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Escala uniforme del sketch del post-it según su tamaño actual. */
export function noteScale(n: NoteItem) {
  return Math.min(n.w / n.baseW, n.h / n.baseH);
}

export function drawNote(ctx: CanvasRenderingContext2D, n: NoteItem, zoom = 1, opts: { hideText?: boolean } = {}) {
  ctx.save();
  // sombra (barata: rectángulo desplazado cuando el zoom es pequeño)
  if (zoom > 0.25) {
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 10 * zoom;
    ctx.shadowOffsetY = 3 * zoom;
  }
  roundRect(ctx, n.x, n.y, n.w, n.h, 6);
  ctx.fillStyle = n.color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1 / zoom;
  ctx.stroke();

  ctx.clip();
  const s = noteScale(n);
  ctx.translate(n.x, n.y);
  ctx.scale(s, s);
  if (zoom * s > 0.12) for (const st of n.strokes) drawStroke(ctx, st);
  if (n.text && !opts.hideText && zoom * s > 0.2) {
    ctx.font = NOTE_FONT;
    ctx.fillStyle = '#1f2328';
    ctx.textBaseline = 'top';
    const lines = wrapText(ctx, n.text, n.baseW - 24);
    lines.forEach((l, i) => ctx.fillText(l, 12, 12 + i * 22));
  }
  ctx.restore();
}

export function drawItem(ctx: CanvasRenderingContext2D, it: Item, zoom: number) {
  if (it.kind === 'stroke') drawStroke(ctx, it);
  else drawNote(ctx, it, zoom);
}

/** Renderiza un conjunto de elementos a un canvas (miniaturas / exportar PNG). */
export function renderToCanvas(items: Item[], maxSize: number, bg = '#faf9f6', pad = 40): HTMLCanvasElement | null {
  let r: Rect | null = null;
  for (const it of items) {
    const b = itemBounds(it);
    r = r ? unionR(r, b) : { ...b };
  }
  if (!r) return null;
  r = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  const scale = Math.min(maxSize / r.w, maxSize / r.h, 2);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * scale));
  c.height = Math.max(1, Math.round(r.h * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  ctx.translate(-r.x, -r.y);
  for (const it of [...items].sort((a, b) => a.z - b.z)) drawItem(ctx, it, scale);
  return c;
}

function unionR(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
