// Importar y exportar hojas: CSV (con ";" o "," y coma decimal) y Excel .xlsx (fórmulas, formato y anchos).
import type { CellFmt } from '../types';
import { saveFile } from '../features/exporter';
import { dateToSerial, isErr, parseInput, shiftFormula, toExcelFormula, type Scalar } from './formula';
import { fmtKey } from './format';
import type { SheetState } from './editor';

type Imported = { cells: string[][]; fmt: Record<string, CellFmt>; colW: number[] };

export async function importSheetFile(f: File): Promise<Imported> {
  if (/\.(xlsx|xlsm)$/i.test(f.name)) return importXlsx(f);
  return importCsv(await f.text());
}

// ------------------------------------------------------------------ CSV
function importCsv(text: string): Imported {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = count('\t') > 0 ? '\t' : count(';') >= count(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return { cells: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')), fmt: {}, colW: Array.from({ length: cols }, () => 1) };
}

function csvText(st: SheetState, values: Scalar[][]) {
  const q = (s: string) => (/[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  return (
    '﻿' + // para que Excel en español lo abra con acentos y separado por ";"
    st.cells
      .map((row, r) =>
        row
          .map((raw, c) => {
            const v = values[r]?.[c];
            if (v == null) return '';
            if (typeof v === 'number') return String(v).replace('.', ',');
            if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
            if (isErr(v)) return v.toString();
            return q(String(v ?? raw));
          })
          .join(';'),
      )
      .join('\r\n')
  );
}

export function exportCsv(st: SheetState, values: Scalar[][], name: string) {
  saveFile(new Blob([csvText(st, values)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

// ------------------------------------------------------------------ XLSX
async function excel() {
  const m: any = await import('exceljs');
  return m.default ?? m;
}

const argb = (hex?: string) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? 'FF' + hex.slice(1).toUpperCase() : undefined);
const hexOf = (argb?: string) => (argb && /^[0-9a-f]{8}$/i.test(argb) ? '#' + argb.slice(2).toLowerCase() : undefined);

function numFmtFor(f: CellFmt): string | undefined {
  const d = f.dec;
  const decs = (n: number) => (n > 0 ? '.' + '0'.repeat(n) : '');
  switch (f.nf) {
    case 'number':
      return '#,##0' + decs(d ?? 2);
    case 'currency':
      return '#,##0' + decs(d ?? 2) + ' "€"';
    case 'percent':
      return '0' + decs(d ?? 0) + '%';
    case 'date':
      return 'dd/mm/yyyy';
    case 'datetime':
      return 'dd/mm/yyyy hh:mm';
    case 'time':
      return 'hh:mm';
    case 'text':
      return '@';
  }
  return d != null ? '0' + decs(d) : undefined;
}

function fmtFromNumFmt(nf?: string): Partial<CellFmt> {
  if (!nf || nf === 'General') return {};
  const dec = (/\.(0+)/.exec(nf)?.[1].length ?? 0) as number;
  if (nf.includes('%')) return { nf: 'percent', dec };
  if (/[€$£]/.test(nf)) return { nf: 'currency', dec };
  if (/h+:m+/i.test(nf) && /[dy]/i.test(nf)) return { nf: 'datetime' };
  if (/h+:m+/i.test(nf)) return { nf: 'time' };
  if (/[dy]/i.test(nf) || /m+[/-]/i.test(nf)) return { nf: 'date' };
  if (nf === '@') return { nf: 'text' };
  if (/0/.test(nf)) return /,/.test(nf) ? { nf: 'number', dec } : { dec };
  return {};
}

async function importXlsx(f: File): Promise<Imported> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await f.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas');
  const rows = Math.min(ws.rowCount || 1, 2000);
  const cols = Math.min(ws.columnCount || 1, 200);
  const cells: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
  const fmt: Record<string, CellFmt> = {};
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      const v = cell.value;
      let out = '';
      if (v == null) out = '';
      else if (typeof v === 'object' && 'formula' in v && v.formula) out = '=' + v.formula;
      else if (typeof v === 'object' && 'sharedFormula' in v && v.sharedFormula) {
        // fórmula compartida: la del original desplazada
        const master = ws.getCell(v.sharedFormula);
        const mf = master.value?.formula;
        out = mf ? shiftFormula('=' + mf, r - Number(master.row), c - Number(master.col)) : String(v.result ?? '');
      } else if (v instanceof Date) {
        out = String(dateToSerial(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) + (v.getUTCHours() * 3600 + v.getUTCMinutes() * 60) / 86400);
        fmt[fmtKey(r - 1, c - 1)] = { nf: v.getUTCHours() || v.getUTCMinutes() ? 'datetime' : 'date' };
      } else if (typeof v === 'object' && 'richText' in v) out = v.richText.map((x: any) => x.text).join('');
      else if (typeof v === 'object' && 'text' in v) out = String(v.text);
      else if (typeof v === 'object' && 'error' in v) out = String(v.error);
      else if (typeof v === 'number') out = String(v);
      else if (typeof v === 'boolean') out = v ? 'VERDADERO' : 'FALSO';
      else out = String(v);
      // texto que parecería un número o fórmula: se guarda como texto
      if (typeof v === 'string' && (v.startsWith('=') || typeof parseInput(v).v === 'number')) out = "'" + v;
      cells[r - 1][c - 1] = out;
      const f: CellFmt = { ...(fmt[fmtKey(r - 1, c - 1)] ?? {}), ...fmtFromNumFmt(cell.numFmt) };
      const font = cell.font ?? {};
      if (font.bold) f.b = true;
      if (font.italic) f.i = true;
      if (font.underline) f.u = true;
      if (font.strike) f.s = true;
      const color = hexOf(font.color?.argb);
      if (color && color !== '#000000') f.color = color;
      const fill = cell.fill;
      const bg = fill?.type === 'pattern' && fill.pattern === 'solid' ? hexOf(fill.fgColor?.argb) : undefined;
      if (bg && bg !== '#ffffff') f.bg = bg;
      const al = cell.alignment?.horizontal;
      if (al === 'left' || al === 'center' || al === 'right') f.al = al;
      if (Object.keys(f).length) fmt[fmtKey(r - 1, c - 1)] = f;
    }
  }
  // quita filas y columnas vacías del final
  while (cells.length > 1 && cells[cells.length - 1].every((x) => !x)) cells.pop();
  let used = cols;
  while (used > 1 && cells.every((row) => !row[used - 1])) used--;
  const trimmed = cells.map((row) => row.slice(0, used));
  const colW = Array.from({ length: used }, (_, i) => {
    const w = ws.getColumn(i + 1).width;
    return w ? Math.max(0.4, Math.round(((w * 7.5) / 110) * 100) / 100) : 1;
  });
  return { cells: trimmed, fmt, colW };
}

export async function exportXlsx(st: SheetState, values: Scalar[][], name: string) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Canvas++';
  const ws = wb.addWorksheet(name.slice(0, 31) || 'Hoja1');
  st.cells.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (!raw && !st.fmt[fmtKey(r, c)]) return;
      const cell = ws.getCell(r + 1, c + 1);
      const v = values[r]?.[c];
      if (raw.startsWith('=')) {
        const result = v == null || isErr(v) ? undefined : v;
        cell.value = { formula: toExcelFormula(raw), result };
      } else if (raw.startsWith("'")) cell.value = raw.slice(1);
      else if (v != null && !isErr(v)) cell.value = v;
      const f = st.fmt[fmtKey(r, c)] ?? {};
      const kind = raw.startsWith('=') ? undefined : parseInput(raw).kind;
      const nf = numFmtFor(f.nf ? f : kind ? { ...f, nf: kind } : f);
      if (nf) cell.numFmt = nf;
      const bold = f.b || (st.header && r === 0);
      if (bold || f.i || f.u || f.s || f.color) cell.font = { bold: !!bold, italic: !!f.i, underline: !!f.u, strike: !!f.s, color: f.color ? { argb: argb(f.color) } : undefined };
      if (f.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(f.bg) } };
      if (f.al) cell.alignment = { horizontal: f.al };
    }),
  );
  st.colW.forEach((w, i) => (ws.getColumn(i + 1).width = Math.round(((w * 110) / 7.5) * 10) / 10));
  if (st.header) ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
}
