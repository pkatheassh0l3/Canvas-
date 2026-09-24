// Formato de celdas (número, moneda, porcentaje, fecha…) y cálculo de la tabla completa.
import type { CellFmt, TableItem } from '../types';
import { isErr, parseInput, serialToDate, Sheet, type Scalar } from './formula';

export type NumFmt = NonNullable<CellFmt['nf']>;

export const NUM_FORMATS: { v: NumFmt; label: string }[] = [
  { v: 'general', label: 'General' },
  { v: 'number', label: 'Número' },
  { v: 'currency', label: 'Moneda (€)' },
  { v: 'percent', label: 'Porcentaje' },
  { v: 'date', label: 'Fecha' },
  { v: 'datetime', label: 'Fecha y hora' },
  { v: 'time', label: 'Hora' },
  { v: 'text', label: 'Texto' },
];

const key = (r: number, c: number) => `${r},${c}`;
export const fmtOf = (t: Pick<TableItem, 'fmt'>, r: number, c: number): CellFmt => t.fmt?.[key(r, c)] ?? {};
export { key as fmtKey };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Texto que se ve en la celda. */
export function display(v: Scalar, f: CellFmt, raw: string): string {
  if (v == null) return '';
  if (isErr(v)) return v.toString();
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'string') return v;
  // número
  let nf = f.nf ?? 'general';
  if (nf === 'general' && !raw.startsWith('=')) {
    // lo escrito como "15%", "12 €" o "24/09/2026" conserva ese aspecto
    const k = parseInput(raw).kind;
    if (k) nf = k;
  }
  const dec = f.dec;
  switch (nf) {
    case 'number':
      return v.toLocaleString('es-ES', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2, useGrouping: true });
    case 'currency':
      return v.toLocaleString('es-ES', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2, useGrouping: true }) + ' €';
    case 'percent':
      return (v * 100).toLocaleString('es-ES', { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 2 }) + '%';
    case 'date':
    case 'datetime': {
      const { y, m, d } = serialToDate(v);
      const date = `${pad2(d)}/${pad2(m)}/${y}`;
      return nf === 'date' ? date : `${date} ${timeText(v)}`;
    }
    case 'time':
      return timeText(v);
    case 'text':
      return raw;
  }
  // general: hasta 10 cifras significativas, sin separador de miles
  if (dec != null) return v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false });
  if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-9 && v !== 0)) return v.toExponential(4).replace('.', ',');
  return String(parseFloat(v.toPrecision(12))).replace('.', ',');
}

function timeText(v: number) {
  const s = Math.round((v - Math.floor(v)) * 86400);
  return `${pad2(Math.floor(s / 3600) % 24)}:${pad2(Math.floor(s / 60) % 60)}`;
}

/** Alineación por defecto como en Excel: números a la derecha, texto a la izquierda, lógicos y errores al centro. */
export function alignOf(v: Scalar, f: CellFmt): 'left' | 'center' | 'right' {
  if (f.al) return f.al;
  if (typeof v === 'number') return 'right';
  if (typeof v === 'boolean' || isErr(v)) return 'center';
  return 'left';
}

// ------------------------------------------------------------------ cálculo de la tabla (con caché)
export interface Computed {
  sheet: Sheet;
  values: Scalar[][];
  text: string[][];
}
const cache = new WeakMap<string[][], Computed>();

export function sheetFor(cells: string[][]): Sheet {
  return new Sheet({
    get: (r, c) => cells[r]?.[c] ?? '',
    rows: cells.length,
    cols: Math.max(1, ...cells.map((r) => r.length)),
  });
}

/** Valores calculados y textos visibles de una tabla (se recalcula solo si cambian las celdas o el formato). */
export function computeTable(t: Pick<TableItem, 'cells' | 'fmt'>): Computed {
  const c = cache.get(t.cells);
  if (c && (c as any).fmt === t.fmt) return c;
  const sheet = sheetFor(t.cells);
  const values = t.cells.map((row, r) => row.map((_, ci) => sheet.value(r, ci)));
  const text = values.map((row, r) => row.map((v, ci) => display(v, fmtOf(t, r, ci), t.cells[r][ci] ?? '')));
  const out: Computed = { sheet, values, text };
  (out as any).fmt = t.fmt;
  cache.set(t.cells, out);
  return out;
}

/** ¿Tiene alguna fórmula que dependa de la hora (HOY, AHORA, ALEATORIO)? Entonces no se cachea entre sesiones. */
export const hasVolatile = (cells: string[][]) => cells.some((r) => r.some((x) => x.startsWith('=') && /\b(HOY|AHORA|TODAY|NOW|ALEATORIO|RAND)/i.test(x)));
