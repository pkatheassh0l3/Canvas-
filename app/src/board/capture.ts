// Captura de trazos desde PointerEvents (con presión y eventos coalescidos para máxima fluidez).
import type { StrokeData } from '../types';
import { round2 } from '../util';

export class StrokeCapture {
  data: StrokeData;
  private lastX = NaN;
  private lastY = NaN;

  constructor(
    e: PointerEvent,
    private toLocal: (x: number, y: number) => [number, number],
    color: string,
    size: number,
    tool: 'pen' | 'marker',
    private minDist: number,
  ) {
    const pressure = e.pointerType === 'pen' && tool === 'pen';
    this.data = { pts: [], color, size, tool, pressure };
    this.add(e);
  }

  private add(e: PointerEvent) {
    const [x, y] = this.toLocal(e.clientX, e.clientY);
    if (Math.hypot(x - this.lastX, y - this.lastY) < this.minDist) return;
    this.lastX = x;
    this.lastY = y;
    const p = this.data.pressure ? e.pressure || 0.5 : 0.5;
    this.data.pts.push(round2(x), round2(y), round2(p));
  }

  move(e: PointerEvent) {
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (evs.length) for (const ce of evs) this.add(ce);
    else this.add(e);
  }

  /** Un toque sin movimiento debe dejar un punto visible. */
  finish(): StrokeData {
    if (this.data.pts.length === 3) {
      const [x, y, p] = this.data.pts;
      this.data.pts.push(x + 0.01, y + 0.01, p);
    }
    return this.data;
  }
}

/** ¿Es el extremo borrador del lápiz o el botón lateral? */
export function isPenEraser(e: PointerEvent) {
  return e.pointerType === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5 || (e.buttons & 2) !== 0);
}
