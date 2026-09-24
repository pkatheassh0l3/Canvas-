// Dibujo, medidas y comportamiento de los elementos "de caja":
// imágenes, tablas, formas, marcos, enlaces, listas de tareas y PDF.
import type {
  BoxItem,
  FrameItem,
  ImageItem,
  Item,
  LinkItem,
  PdfAnnotation,
  PdfItem,
  Rect,
  ShapeItem,
  TableItem,
  TodoItem,
} from '../types';
import { assetImage } from '../assets';
import { drawStroke, getRedrawHook, sheet, wrapText } from './render';
import { drawExtra, extraBounds } from './extra';

const FONT = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const layoutCache = new WeakMap<object, { rows: number[]; h: number; lines: string[][][] }>();
let mctx: CanvasRenderingContext2D | null = null;
const measure = () => (mctx ??= document.createElement('canvas').getContext('2d')!);

export const BOX_KINDS = new Set(['note', 'doc', 'image', 'table', 'shape', 'frame', 'link', 'todo', 'pdf', 'audio', 'video', 'math', 'code', 'chart']);
export function isBox(it: Item): it is BoxItem {
  return BOX_KINDS.has(it.kind);
}

/** Cómo se redimensiona cada tipo con el tirador. */
export function resizeMode(it: BoxItem): 'free' | 'aspect' | 'width' | 'endpoint' {
  if (['doc', 'image', 'pdf', 'audio', 'video', 'math'].includes(it.kind)) return 'aspect';
  if (it.kind === 'table' || it.kind === 'todo' || it.kind === 'code') return 'width';
  if (it.kind === 'shape' && (it.shape === 'line' || it.shape === 'arrow')) return 'endpoint';
  return 'free';
}

// ------------------------------------------------------------------ tablas
export const TABLE_PAD = 0.45; // en múltiplos del tamaño de letra

export function tableLayout(t: TableItem) {
  const c = layoutCache.get(t);
  if (c) return c;
  const ctx = measure();
  const cols = Math.max(1, t.cells[0]?.length ?? 1);
  const colW = t.w / cols;
  const pad = t.fs * TABLE_PAD;
  const lh = t.fs * 1.3;
  const rows: number[] = [];
  const lines: string[][][] = [];
  t.cells.forEach((row, ri) => {
    ctx.font = FONT(ri === 0 && t.header ? 650 : 400, t.fs);
    const rl = row.map((cell) => wrapText(ctx, cell || '', Math.max(10, colW - pad * 2)));
    lines.push(rl);
    rows.push(Math.max(1, ...rl.map((l) => l.length)) * lh + pad * 2);
  });
  const res = { rows, h: rows.reduce((a, b) => a + b, 0), lines };
  layoutCache.set(t, res);
  return res;
}

function drawTable(ctx: CanvasRenderingContext2D, t: TableItem, zoom: number) {
  const L = tableLayout(t);
  const cols = Math.max(1, t.cells[0]?.length ?? 1);
  const colW = t.w / cols;
  const pad = t.fs * TABLE_PAD;
  const lh = t.fs * 1.3;
  ctx.fillStyle = '#fff';
  ctx.fillRect(t.x, t.y, t.w, L.h);
  if (t.header && L.rows.length) {
    ctx.fillStyle = '#f1efe9';
    ctx.fillRect(t.x, t.y, t.w, L.rows[0]);
  }
  ctx.textBaseline = 'top';
  let y = t.y;
  L.lines.forEach((row, ri) => {
    if (zoom * t.fs > 3) {
      ctx.font = FONT(ri === 0 && t.header ? 650 : 400, t.fs);
      ctx.fillStyle = '#1f2328';
      row.forEach((cl, ci) => cl.forEach((l, li) => ctx.fillText(l, t.x + ci * colW + pad, y + pad + li * lh + (lh - t.fs) / 2)));
    }
    y += L.rows[ri];
  });
  // rejilla
  ctx.strokeStyle = '#cfcbc2';
  ctx.lineWidth = Math.max(1 / zoom, t.fs * 0.06);
  ctx.beginPath();
  let yy = t.y;
  for (let r = 0; r <= L.rows.length; r++) {
    ctx.moveTo(t.x, yy);
    ctx.lineTo(t.x + t.w, yy);
    yy += L.rows[r] ?? 0;
  }
  for (let c = 0; c <= cols; c++) {
    ctx.moveTo(t.x + c * colW, t.y);
    ctx.lineTo(t.x + c * colW, t.y + L.h);
  }
  ctx.stroke();
}

// ------------------------------------------------------------------ lista de tareas
export const TODO_BASE_W = 260;
const TODO_HEAD = 42;
const TODO_ROW = 30;

export function todoHeight(t: TodoItem) {
  return (TODO_HEAD + t.items.length * TODO_ROW + 12) * (t.w / TODO_BASE_W);
}

/** Índice de la tarea cuya casilla está en (x, y), o -1. */
export function todoCheckAt(t: TodoItem, x: number, y: number) {
  const s = t.w / TODO_BASE_W;
  const lx = (x - t.x) / s;
  const ly = (y - t.y) / s - TODO_HEAD;
  if (lx < 6 || lx > 40 || ly < 0) return -1;
  const i = Math.floor(ly / TODO_ROW);
  return i < t.items.length ? i : -1;
}

function drawTodo(ctx: CanvasRenderingContext2D, t: TodoItem, zoom: number) {
  const s = t.w / TODO_BASE_W;
  const h = todoHeight(t);
  ctx.save();
  if (zoom > 0.25) {
    ctx.shadowColor = 'rgba(0,0,0,0.14)';
    ctx.shadowBlur = 8 * zoom;
    ctx.shadowOffsetY = 2 * zoom;
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(t.x, t.y, t.w, h, 10 * s);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.roundRect(t.x, t.y, t.w, h, 10 * s);
  ctx.stroke();
  if (zoom * s < 0.15) return;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.scale(s, s);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1f2328';
  ctx.font = FONT(700, 16);
  const done = t.items.filter((i) => i.done).length;
  ctx.fillText(wrapText(ctx, t.title || 'Tareas', TODO_BASE_W - 80)[0] ?? '', 14, 22);
  ctx.font = FONT(500, 12);
  ctx.fillStyle = '#6b6f76';
  const prog = `${done}/${t.items.length}`;
  ctx.fillText(prog, TODO_BASE_W - 14 - ctx.measureText(prog).width, 22);
  t.items.forEach((it, i) => {
    const y = TODO_HEAD + i * TODO_ROW + TODO_ROW / 2;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = it.done ? '#30a46c' : '#a3a6ab';
    ctx.fillStyle = it.done ? '#30a46c' : '#fff';
    ctx.beginPath();
    ctx.roundRect(14, y - 8, 16, 16, 4);
    ctx.fill();
    ctx.stroke();
    if (it.done) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(17.5, y);
      ctx.lineTo(20.5, y + 3.5);
      ctx.lineTo(26.5, y - 3.5);
      ctx.stroke();
    }
    ctx.font = FONT(400, 14);
    ctx.fillStyle = it.done ? '#8a8e94' : '#1f2328';
    const txt = wrapText(ctx, it.t, TODO_BASE_W - 56)[0] ?? '';
    ctx.fillText(txt, 40, y);
    if (it.done) {
      ctx.fillRect(40, y, ctx.measureText(txt).width, 1.2);
    }
  });
  ctx.restore();
}

// ------------------------------------------------------------------ enlaces
export const LINK_BASE_W = 280;
export const LINK_BASE_H = 72;

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function drawLink(ctx: CanvasRenderingContext2D, l: LinkItem, zoom: number) {
  const s = l.w / LINK_BASE_W;
  ctx.save();
  if (zoom > 0.25) {
    ctx.shadowColor = 'rgba(0,0,0,0.14)';
    ctx.shadowBlur = 8 * zoom;
    ctx.shadowOffsetY = 2 * zoom;
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(l.x, l.y, l.w, l.h, 10 * s);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(l.x, l.y, l.w, l.h, 10 * s);
  ctx.clip();
  ctx.fillStyle = '#0090ff';
  ctx.fillRect(l.x, l.y, 5 * s, l.h);
  ctx.translate(l.x, l.y);
  ctx.scale(s, s);
  const bh = l.h / s;
  // icono de globo
  ctx.strokeStyle = '#0090ff';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(34, bh / 2, 12, 0, Math.PI * 2);
  ctx.moveTo(22, bh / 2);
  ctx.lineTo(46, bh / 2);
  ctx.ellipse(34, bh / 2, 5.5, 12, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (zoom * s > 0.2) {
    ctx.textBaseline = 'middle';
    ctx.font = FONT(650, 14);
    ctx.fillStyle = '#1f2328';
    ctx.fillText(wrapText(ctx, l.title || domainOf(l.url), LINK_BASE_W - 72)[0] ?? '', 58, bh / 2 - 9);
    ctx.font = FONT(400, 12);
    ctx.fillStyle = '#0070d0';
    ctx.fillText(wrapText(ctx, domainOf(l.url), LINK_BASE_W - 72)[0] ?? '', 58, bh / 2 + 11);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ formas
export function shapeRect(s: ShapeItem): Rect {
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}

function arrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
  ctx.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeItem, zoom: number) {
  ctx.save();
  ctx.lineWidth = s.sw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = s.stroke;
  ctx.fillStyle = s.fill === 'none' ? 'transparent' : s.fill;
  const r = shapeRect(s);
  if (s.shape === 'line' || s.shape === 'arrow') {
    const x2 = s.x + s.w;
    const y2 = s.y + s.h;
    const head = s.sw * 3 + 8 / zoom;
    const len = Math.hypot(s.w, s.h) || 1;
    // la línea termina antes para que no asome por la punta de la flecha
    const k = s.shape === 'arrow' ? Math.max(0, 1 - (head * 0.8) / len) : 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.w * k, s.y + s.h * k);
    ctx.stroke();
    if (s.shape === 'arrow') {
      ctx.fillStyle = s.stroke;
      arrowHead(ctx, s.x, s.y, x2, y2, head);
    }
  } else {
    ctx.beginPath();
    if (s.shape === 'rect') ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.06);
    else if (s.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else if (s.shape === 'triangle') {
      ctx.moveTo(r.x + r.w / 2, r.y);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.lineTo(r.x, r.y + r.h);
      ctx.closePath();
    } else {
      ctx.moveTo(r.x + r.w / 2, r.y);
      ctx.lineTo(r.x + r.w, r.y + r.h / 2);
      ctx.lineTo(r.x + r.w / 2, r.y + r.h);
      ctx.lineTo(r.x, r.y + r.h / 2);
      ctx.closePath();
    }
    if (s.fill !== 'none') ctx.fill();
    ctx.stroke();
  }
  if (s.label) {
    const fs = Math.max(8, Math.min(r.h * 0.28, 22 * (s.sw / 3 || 1), r.w * 0.2)) || 16;
    ctx.font = FONT(550, fs);
    ctx.fillStyle = s.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const inner = s.shape === 'diamond' || s.shape === 'triangle' ? r.w * 0.55 : r.w * 0.85;
    const lines = wrapText(ctx, s.label, Math.max(20, inner));
    const lh = fs * 1.25;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, cy + i * lh));
  }
  ctx.restore();
}

/** Distancia a una línea/flecha para seleccionarla. */
export function shapeHit(s: ShapeItem, x: number, y: number, tol: number) {
  if (s.shape === 'line' || s.shape === 'arrow') {
    const dx = s.w;
    const dy = s.h;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - s.x) * dx + (y - s.y) * dy) / l2));
    return Math.hypot(s.x + t * dx - x, s.y + t * dy - y) <= tol + s.sw;
  }
  const r = shapeRect(s);
  return x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;
}

// ------------------------------------------------------------------ marcos
export const FRAME_COLORS = ['#e8f2ff', '#eaf7ea', '#fff5d6', '#fde8ee', '#efe9ff', '#f1efe9'];

export function frameHeader(f: FrameItem, zoom: number) {
  return Math.max(28 / zoom, Math.min(f.h * 0.08, 60));
}

function drawFrame(ctx: CanvasRenderingContext2D, f: FrameItem, zoom: number) {
  const hh = frameHeader(f, zoom);
  ctx.save();
  ctx.fillStyle = f.color;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.roundRect(f.x, f.y, f.w, f.h, 14 / zoom);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = FONT(700, hh * 0.55);
  ctx.fillStyle = '#3d4148';
  ctx.textBaseline = 'middle';
  ctx.fillText(wrapText(ctx, f.title || 'Sección', f.w - hh)[0] ?? '', f.x + hh * 0.45, f.y + hh / 2 + 2 / zoom);
  ctx.restore();
}

// ------------------------------------------------------------------ imágenes
function drawImage(ctx: CanvasRenderingContext2D, im: ImageItem, zoom: number) {
  const img = assetImage(im.asset, getRedrawHook());
  if (img) ctx.drawImage(img, im.x, im.y, im.w, im.h);
  else {
    ctx.fillStyle = '#ecebe6';
    ctx.fillRect(im.x, im.y, im.w, im.h);
    ctx.strokeStyle = '#d0cdc5';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(im.x, im.y, im.w, im.h);
  }
}

// ------------------------------------------------------------------ PDF
export function drawPdfAnnotations(ctx: CanvasRenderingContext2D, anns: PdfAnnotation[] | undefined, scale: number) {
  if (!anns?.length) return;
  ctx.save();
  ctx.scale(scale, scale);
  for (const a of anns) {
    if (a.t === 'ink') drawStroke(ctx, a);
    else {
      ctx.fillStyle = a.color;
      for (const [x, y, w, h] of a.rects) {
        if (a.style === 'highlight') {
          ctx.globalAlpha = 0.38;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
        } else if (a.style === 'underline') ctx.fillRect(x, y + h - Math.max(1.4, h * 0.09), w, Math.max(1.4, h * 0.09));
        else ctx.fillRect(x, y + h * 0.52, w, Math.max(1.4, h * 0.08));
      }
    }
  }
  ctx.restore();
}

function drawPdf(ctx: CanvasRenderingContext2D, p: PdfItem, zoom: number) {
  const s = p.w / 252;
  const extra = Math.min(2, Math.max(0, p.pages - 1));
  for (let i = extra; i >= 1; i--) {
    ctx.save();
    ctx.translate(p.x + p.w / 2 + i * 5 * s, p.y + p.h / 2 + i * 4 * s);
    ctx.rotate(((i % 2 ? 1.6 : -1.2) * Math.PI) / 180);
    sheet(ctx, -p.w / 2, -p.h / 2, p.w, p.h, true, zoom);
    ctx.restore();
  }
  sheet(ctx, p.x, p.y, p.w, p.h, true, zoom);
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  const img = assetImage(p.thumb, getRedrawHook());
  if (img) ctx.drawImage(img, p.x, p.y, p.w, p.h);
  ctx.translate(p.x, p.y);
  drawPdfAnnotations(ctx, p.ann?.['0'], p.w / 1000);
  // etiqueta PDF + páginas
  const detail = zoom * s;
  if (detail > 0.15) {
    ctx.scale(s, s);
    const label = `PDF · ${p.pages} ${p.pages === 1 ? 'pág.' : 'págs.'}`;
    ctx.font = FONT(650, 8.5);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(229,72,77,0.92)';
    ctx.beginPath();
    ctx.roundRect(252 - tw - 22, p.h / s - 24, tw + 12, 15, 7);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 252 - tw - 16, p.h / s - 16.5);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ despacho
export function boxBounds(it: BoxItem): Rect {
  const ex = extraBounds(it);
  if (ex) return ex;
  if (it.kind === 'shape') {
    const r = shapeRect(it);
    const p = it.sw / 2 + (it.shape === 'arrow' ? it.sw * 3 : 0);
    return { x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 };
  }
  if (it.kind === 'table') return { x: it.x, y: it.y, w: it.w, h: tableLayout(it).h };
  if (it.kind === 'todo') return { x: it.x, y: it.y, w: it.w, h: todoHeight(it) };
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

export function drawBox(ctx: CanvasRenderingContext2D, it: Item, zoom: number): boolean {
  if (drawExtra(ctx, it, zoom)) return true;
  switch (it.kind) {
    case 'image':
      drawImage(ctx, it, zoom);
      return true;
    case 'table':
      drawTable(ctx, it, zoom);
      return true;
    case 'shape':
      drawShape(ctx, it, zoom);
      return true;
    case 'frame':
      drawFrame(ctx, it, zoom);
      return true;
    case 'link':
      drawLink(ctx, it, zoom);
      return true;
    case 'todo':
      drawTodo(ctx, it, zoom);
      return true;
    case 'pdf':
      drawPdf(ctx, it, zoom);
      return true;
  }
  return false;
}
