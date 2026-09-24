// Dibujo de trazos y post-its sobre un CanvasRenderingContext2D.
import { getStroke } from 'perfect-freehand';
import type { BoxItem, DocItem, Item, NoteItem, Rect, StrokeData, TextItem } from '../types';
import { assetImage } from '../assets';
import { boxBounds, drawBox } from './items';
import { connectorBounds, setBoundsFn } from './extra';

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

/** Caja sin girar del elemento. */
export function baseBounds(it: Item): Rect {
  if (it.kind === 'stroke') return strokeBounds(it);
  if (it.kind === 'text') return textBounds(it);
  if (it.kind === 'note' || it.kind === 'doc') return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (it.kind === 'connector') return connectorBounds(it); // depende de otros elementos: sin caché
  const c = boundsCache.get(it);
  if (c) return c;
  const r = boxBounds(it as BoxItem);
  boundsCache.set(it, r);
  return r;
}

export function itemCenter(it: Item): [number, number] {
  const b = baseBounds(it);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Gira (x, y) un ángulo a alrededor de (cx, cy). */
export function rotatePoint(x: number, y: number, cx: number, cy: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

/** Punto del mundo pasado al sistema sin girar del elemento. */
export function toItemSpace(it: Item, x: number, y: number): [number, number] {
  if (!it.rot) return [x, y];
  const [cx, cy] = itemCenter(it);
  return rotatePoint(x, y, cx, cy, -it.rot);
}

const rotCache = new WeakMap<object, Rect>();
/** Caja envolvente en el mundo (tiene en cuenta el giro). */
export function itemBounds(it: Item): Rect {
  const b = baseBounds(it);
  if (!it.rot) return b;
  const c = rotCache.get(it);
  if (c && it.kind !== 'connector') return c;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const pts = [
    rotatePoint(b.x, b.y, cx, cy, it.rot),
    rotatePoint(b.x + b.w, b.y, cx, cy, it.rot),
    rotatePoint(b.x, b.y + b.h, cx, cy, it.rot),
    rotatePoint(b.x + b.w, b.y + b.h, cx, cy, it.rot),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  rotCache.set(it, r);
  return r;
}

// ---------------- cuadros de texto ----------------
export const TEXT_FONT = (size: number) => `500 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
export const TEXT_LINE = 1.3;
let measureCtx: CanvasRenderingContext2D | null = null;

export function textBounds(t: TextItem): Rect {
  const c = boundsCache.get(t);
  if (c) return c;
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = TEXT_FONT(t.size);
  const lines = (t.text || ' ').split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l || ' ').width);
  const r = { x: t.x, y: t.y, w: Math.max(w, t.size * 0.6), h: lines.length * t.size * TEXT_LINE };
  boundsCache.set(t, r);
  return r;
}

export function drawText(ctx: CanvasRenderingContext2D, t: TextItem) {
  ctx.font = TEXT_FONT(t.size);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  const lh = t.size * TEXT_LINE;
  const pad = (lh - t.size) / 2;
  t.text.split('\n').forEach((l, i) => ctx.fillText(l, t.x, t.y + pad + i * lh));
}

// ---------------- documentos (pila de folios) ----------------
export const DOC_BASE_W = 252; // proporción A4
export const DOC_BASE_H = 356;
let redrawHook: () => void = () => {};
/** La pizarra registra aquí cómo repintarse cuando termina de cargar una imagen. */
export function setRedrawHook(fn: () => void) {
  redrawHook = fn;
}
export function getRedrawHook() {
  return () => redrawHook();
}

export function sheet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shadow: boolean, zoom: number) {
  ctx.save();
  if (shadow && zoom > 0.2) {
    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = 8 * zoom;
    ctx.shadowOffsetY = 2 * zoom;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(x, y, w, h);
}

export function drawDoc(ctx: CanvasRenderingContext2D, d: DocItem, zoom = 1) {
  const s = d.w / DOC_BASE_W;
  // folios de debajo: se ven como una pila cuando hay más de una página
  const extra = Math.min(2, Math.max(0, d.pages - 1));
  for (let i = extra; i >= 1; i--) {
    ctx.save();
    ctx.translate(d.x + d.w / 2 + i * 5 * s, d.y + d.h / 2 + i * 4 * s);
    ctx.rotate(((i % 2 ? 1.6 : -1.2) * Math.PI) / 180);
    sheet(ctx, -d.w / 2, -d.h / 2, d.w, d.h, true, zoom);
    ctx.restore();
  }
  sheet(ctx, d.x, d.y, d.w, d.h, true, zoom);

  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  ctx.translate(d.x, d.y);
  ctx.scale(s, s);
  const detail = zoom * s;
  if (d.preview?.img) {
    const img = assetImage(d.preview.img, redrawHook);
    if (img) {
      const k = Math.min(DOC_BASE_W / img.naturalWidth, DOC_BASE_H / img.naturalHeight);
      ctx.drawImage(img, 0, 0, img.naturalWidth * k, img.naturalHeight * k);
    }
  } else if (detail > 0.18) {
    const m = 20;
    let y = m;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1f2328';
    ctx.font = '700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (const l of wrapText(ctx, d.title || 'Documento sin título', DOC_BASE_W - m * 2).slice(0, 2)) {
      ctx.fillText(l, m, y);
      y += 19;
    }
    y += 6;
    for (const b of d.preview?.blocks ?? []) {
      const head = b.s === 'h';
      ctx.font = head ? '700 9.5px system-ui, sans-serif' : '400 8px system-ui, sans-serif';
      ctx.fillStyle = head ? '#1f2328' : '#4a4f57';
      for (const l of wrapText(ctx, b.t, DOC_BASE_W - m * 2)) {
        if (y > DOC_BASE_H - 34) break;
        ctx.fillText(l, m, y);
        y += head ? 13 : 11;
      }
      y += 4;
      if (y > DOC_BASE_H - 34) break;
    }
  } else {
    // muy alejado: líneas grises en lugar de texto
    ctx.fillStyle = '#d6d3cc';
    ctx.fillRect(20, 20, 150, 12);
    for (let i = 0; i < 14; i++) ctx.fillRect(20, 46 + i * 18, i % 4 === 3 ? 120 : 210, 6);
  }
  // etiqueta con el número de páginas
  if (detail > 0.15) {
    const label = d.pages > 1 ? `${d.pages} págs.` : '1 pág.';
    ctx.font = '600 8.5px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(31,35,40,0.75)';
    ctx.beginPath();
    ctx.roundRect(DOC_BASE_W - tw - 22, DOC_BASE_H - 24, tw + 12, 15, 7);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, DOC_BASE_W - tw - 16, DOC_BASE_H - 16.5);
  }
  ctx.restore();
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
  if (it.rot) {
    const [cx, cy] = itemCenter(it);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(it.rot);
    ctx.translate(-cx, -cy);
    drawItemRaw(ctx, it, zoom);
    ctx.restore();
  } else drawItemRaw(ctx, it, zoom);
}

function drawItemRaw(ctx: CanvasRenderingContext2D, it: Item, zoom: number) {
  if (it.kind === 'stroke') drawStroke(ctx, it);
  else if (it.kind === 'note') drawNote(ctx, it, zoom);
  else if (it.kind === 'text') drawText(ctx, it);
  else if (it.kind === 'doc') drawDoc(ctx, it, zoom);
  else drawBox(ctx, it, zoom);
}

/** Orden de pintado: los marcos siempre debajo del resto. */
export function paintOrder(items: Item[]): Item[] {
  const frames = items.filter((i) => i.kind === 'frame');
  return frames.length ? [...frames, ...items.filter((i) => i.kind !== 'frame')] : items;
}

/** Renderiza un conjunto de elementos a un canvas (miniaturas / exportar PNG). */
export function renderToCanvas(items: Item[], maxSize: number, bg = '#faf9f6', pad = 40): HTMLCanvasElement | null {
  let r: Rect | null = null;
  items = items.filter((i) => i.kind !== 'layer' && i.kind !== 'bookmark' && i.kind !== 'comment');
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
  for (const it of paintOrder([...items].sort((a, b) => a.z - b.z))) drawItem(ctx, it, scale);
  return c;
}

function unionR(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

setBoundsFn(itemBounds);
