// Reconocimiento de formas: convierte un garabato en rectángulo, elipse, triángulo, rombo o línea.
import type { ShapeItem, StrokeItem } from '../types';
import { uid } from '../util';

type P = [number, number];

function hull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function area(poly: P[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Devuelve la forma limpia que mejor encaja con el trazo, o null si no se parece a ninguna. */
export function recognizeStroke(s: StrokeItem): ShapeItem | null {
  const pts: P[] = [];
  for (let i = 0; i < s.pts.length; i += 3) pts.push([s.pts[i], s.pts[i + 1]]);
  if (pts.length < 4) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const size = Math.max(w, h);
  if (size < s.size * 3) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const base = { id: uid(), rev: 0, by: '', z: s.z, kind: 'shape' as const, stroke: s.color, fill: 'none', sw: Math.max(s.size * 0.6, 1), label: '', layer: s.layer };

  // abierto y casi recto → línea
  if (gap / len > 0.9) return { ...base, shape: 'line', x: first[0], y: first[1], w: last[0] - first[0], h: last[1] - first[1] };
  // tiene que estar (casi) cerrado para ser una figura
  if (gap > size * 0.28 || len < size * 2) return null;

  const hp = hull(pts);
  const fill = area(hp) / Math.max(1, w * h);
  const near = (px: number, py: number) => pts.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < size * 0.14);
  const corners = [near(x, y), near(x + w, y), near(x, y + h), near(x + w, y + h)].filter(Boolean).length;
  const box = { x, y, w, h };
  if (fill > 0.86 && corners >= 3) return { ...base, shape: 'rect', ...box };
  if (fill > 0.66 && corners <= 1) return { ...base, shape: 'ellipse', ...box };
  if (fill > 0.38 && fill < 0.66) {
    const bottomCorners = [near(x, y + h), near(x + w, y + h)].filter(Boolean).length;
    if (bottomCorners === 2 && near(x + w / 2, y)) return { ...base, shape: 'triangle', ...box };
    if (corners === 0 && near(x + w / 2, y) && near(x + w, y + h / 2) && near(x + w / 2, y + h) && near(x, y + h / 2)) return { ...base, shape: 'diamond', ...box };
  }
  if (fill > 0.8) return { ...base, shape: 'rect', ...box };
  return null;
}
