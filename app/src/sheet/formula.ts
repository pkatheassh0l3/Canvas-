// Motor de fórmulas estilo Excel: referencias (A1, $A$1, A1:B5, A:A), operadores y funciones
// con nombre en inglés o en español (SUM/SUMA, IF/SI, VLOOKUP/BUSCARV…).
// Acepta "," o ";" entre argumentos; con ";" también se admite la coma decimal (3,5).

// ------------------------------------------------------------------ valores
export type ErrCode = 'DIV0' | 'VALUE' | 'REF' | 'NAME' | 'NA' | 'NUM' | 'CIRC';
export class SheetError {
  constructor(public code: ErrCode) {}
  toString() {
    return ERR_TEXT[this.code];
  }
}
export const ERR_TEXT: Record<ErrCode, string> = {
  DIV0: '#¡DIV/0!',
  VALUE: '#¡VALOR!',
  REF: '#¡REF!',
  NAME: '#¿NOMBRE?',
  NA: '#N/D',
  NUM: '#¡NUM!',
  CIRC: '#¡CIRC!',
};
const ERR_LITERALS: Record<string, ErrCode> = {
  '#DIV/0!': 'DIV0',
  '#¡DIV/0!': 'DIV0',
  '#VALUE!': 'VALUE',
  '#¡VALOR!': 'VALUE',
  '#REF!': 'REF',
  '#¡REF!': 'REF',
  '#NAME?': 'NAME',
  '#¿NOMBRE?': 'NAME',
  '#N/A': 'NA',
  '#N/D': 'NA',
  '#NUM!': 'NUM',
  '#¡NUM!': 'NUM',
};

export type Scalar = number | string | boolean | SheetError | null; // null = celda vacía
export type Matrix = Scalar[][];
type Val = Scalar | Matrix;

const err = (c: ErrCode) => new SheetError(c);
export const isErr = (v: unknown): v is SheetError => v instanceof SheetError;
const isMatrix = (v: Val): v is Matrix => Array.isArray(v);

// ------------------------------------------------------------------ referencias
export function colName(c: number): string {
  let s = '';
  c++;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const cellName = (r: number, c: number) => colName(c) + (r + 1);
export function parseCellName(s: string): [number, number] | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s.trim());
  return m ? [parseInt(m[2], 10) - 1, colIndex(m[1])] : null;
}

// ------------------------------------------------------------------ fechas (número de serie de Excel)
const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - EPOCH) / 86400000;
export function serialToDate(n: number) {
  const d = new Date(EPOCH + Math.floor(n) * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
}
function nowSerial() {
  const n = new Date();
  return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate()) + (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
}

// ------------------------------------------------------------------ tokens
type Tok =
  | { k: 'num'; v: number; s: number; e: number }
  | { k: 'str'; v: string; s: number; e: number }
  | { k: 'ref'; v: string; s: number; e: number } // A1, $A$1
  | { k: 'col'; v: string; s: number; e: number } // A (en A:A)
  | { k: 'row'; v: string; s: number; e: number } // 1 (en 1:1)
  | { k: 'name'; v: string; s: number; e: number }
  | { k: 'err'; v: string; s: number; e: number }
  | { k: 'op'; v: string; s: number; e: number };

/** ¿Usa ";" como separador? Entonces "3,5" es un número decimal. */
function semicolonMode(src: string) {
  let q = false;
  for (const ch of src) {
    if (ch === '"') q = !q;
    else if (ch === ';' && !q) return true;
  }
  return false;
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const semi = semicolonMode(src);
  let i = 0;
  const numRe = semi ? /^(\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/ : /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += src[j++];
      }
      out.push({ k: 'str', v, s: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      const m = /^#(?:¡DIV\/0!|DIV\/0!|¡VALOR!|VALUE!|¡REF!|REF!|¿NOMBRE\?|NAME\?|N\/A|N\/D|¡NUM!|NUM!)/i.exec(src.slice(i));
      if (m) {
        out.push({ k: 'err', v: m[0].toUpperCase(), s: i, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    const rest = src.slice(i);
    // referencia de celda (antes que los nombres: "A1" no es una función)
    const rm = /^\$?[A-Za-z]{1,3}\$?\d+(?![\w.(])/.exec(rest);
    if (rm) {
      out.push({ k: 'ref', v: rm[0], s: i, e: i + rm[0].length });
      i += rm[0].length;
      continue;
    }
    // columna entera: A:A
    const cm = /^\$?[A-Za-z]{1,3}(?=\s*:\s*\$?[A-Za-z]{1,3}(?![\w(]))/.exec(rest);
    const prevColon = out.length && out[out.length - 1].k === 'op' && out[out.length - 1].v === ':' && out[out.length - 2]?.k === 'col';
    if (cm || (prevColon && /^\$?[A-Za-z]{1,3}(?![\w(.])/.test(rest))) {
      const m = cm ?? /^\$?[A-Za-z]{1,3}/.exec(rest)!;
      out.push({ k: 'col', v: m[0], s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    // fila entera: 1:1
    const prevRowColon = out.length && out[out.length - 1].k === 'op' && out[out.length - 1].v === ':' && out[out.length - 2]?.k === 'row';
    const rowm = /^\$?\d+(?=\s*:\s*\$?\d+)/.exec(rest) ?? (prevRowColon ? /^\$?\d+/.exec(rest) : null);
    if (rowm) {
      out.push({ k: 'row', v: rowm[0], s: i, e: i + rowm[0].length });
      i += rowm[0].length;
      continue;
    }
    const nm = numRe.exec(rest);
    if (nm) {
      out.push({ k: 'num', v: parseFloat(nm[0].replace(',', '.')), s: i, e: i + nm[0].length });
      i += nm[0].length;
      continue;
    }
    const idm = /^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*/.exec(rest);
    if (idm) {
      out.push({ k: 'name', v: idm[0], s: i, e: i + idm[0].length });
      i += idm[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ k: 'op', v: two, s: i, e: i + 2 });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>(),;:%{}'.includes(ch)) {
      out.push({ k: 'op', v: ch === ';' ? ',' : ch, s: i, e: i + 1 });
      i++;
      continue;
    }
    throw new Error('Carácter no válido: ' + ch);
  }
  return out;
}

// ------------------------------------------------------------------ árbol
type RefNode = { t: 'ref'; r: number; c: number };
type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: ErrCode }
  | RefNode
  | { t: 'range'; r1: number; c1: number; r2: number; c2: number } // -1 = fila/columna entera
  | { t: 'fn'; name: string; args: Node[] }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'un'; op: string; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'array'; rows: Node[][] };

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => toks[p]?.k === 'op' && toks[p].v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Falta "${v}"`);
    p++;
  };
  const bin = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    while (toks[p]?.k === 'op' && ops.includes(toks[p].v as string)) {
      const op = toks[p++].v as string;
      a = { t: 'bin', op, a, b: next() };
    }
    return a;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error('Fórmula incompleta');
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'err') return { t: 'err', v: ERR_LITERALS[t.v] ?? 'VALUE' };
    if (t.k === 'ref') {
      const [r, c] = parseCellName(t.v)!;
      if (isOp(':') && toks[p + 1]?.k === 'ref') {
        p++;
        const [r2, c2] = parseCellName(toks[p++].v as string)!;
        return { t: 'range', r1: Math.min(r, r2), c1: Math.min(c, c2), r2: Math.max(r, r2), c2: Math.max(c, c2) };
      }
      return { t: 'ref', r, c };
    }
    if (t.k === 'col') {
      expect(':');
      const t2 = toks[p++];
      if (t2?.k !== 'col') throw new Error('Rango no válido');
      const a = colIndex(t.v.replace('$', ''));
      const b = colIndex(t2.v.replace('$', ''));
      return { t: 'range', r1: -1, c1: Math.min(a, b), r2: -1, c2: Math.max(a, b) };
    }
    if (t.k === 'row') {
      expect(':');
      const t2 = toks[p++];
      if (t2?.k !== 'row') throw new Error('Rango no válido');
      const a = parseInt(t.v.replace('$', ''), 10) - 1;
      const b = parseInt(t2.v.replace('$', ''), 10) - 1;
      return { t: 'range', r1: Math.min(a, b), c1: -1, r2: Math.max(a, b), c2: -1 };
    }
    if (t.k === 'name') {
      const name = normName(t.v);
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          for (;;) {
            // argumento vacío: SI(A1;;2)
            if (isOp(',') || isOp(')')) args.push({ t: 'str', v: '' });
            else args.push(expr());
            if (isOp(',')) {
              p++;
              continue;
            }
            break;
          }
        }
        expect(')');
        return { t: 'fn', name, args };
      }
      if (name === 'TRUE' || name === 'VERDADERO') return { t: 'bool', v: true };
      if (name === 'FALSE' || name === 'FALSO') return { t: 'bool', v: false };
      return { t: 'err', v: 'NAME' };
    }
    if (t.k === 'op' && t.v === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (t.k === 'op' && t.v === '{') {
      const rows: Node[][] = [[]];
      for (;;) {
        rows[rows.length - 1].push(expr());
        if (isOp(',')) {
          p++;
          continue;
        }
        break;
      }
      expect('}');
      return { t: 'array', rows };
    }
    throw new Error('Fórmula no válida');
  };
  const postfix = (): Node => {
    let a = primary();
    while (isOp('%')) {
      p++;
      a = { t: 'pct', a };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-') || isOp('+')) {
      const op = toks[p++].v as string;
      return { t: 'un', op, a: unary() };
    }
    return postfix();
  };
  const power = bin(unary, ['^']);
  const term = bin(power, ['*', '/']);
  const additive = bin(term, ['+', '-']);
  const concat = bin(additive, ['&']);
  const comparison = bin(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const expr = comparison;
  const n = expr();
  if (p < toks.length) throw new Error('Sobra algo en la fórmula: ' + (peek() as any).v);
  return n;
}

function normName(s: string) {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^_XLFN\./, '');
}

// ------------------------------------------------------------------ conversión de valores
/** Interpreta lo escrito en una celda: número (3,5 · 1.234,5 · 15% · 12 €), fecha (24/09/2026) o texto. */
export function parseInput(raw: string): { v: Scalar; kind?: 'percent' | 'currency' | 'date' } {
  const s = raw.trim();
  if (!s) return { v: null };
  if (/^(verdadero|true)$/i.test(s)) return { v: true };
  if (/^(falso|false)$/i.test(s)) return { v: false };
  const num = (t: string): number | null => {
    t = t.replace(/\s/g, '');
    if (!/^[+-]?(\d{1,3}([.,]\d{3})*|\d+)([.,]\d+)?$/.test(t) && !/^[+-]?[.,]\d+$/.test(t)) return null;
    const lastSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    if (lastSep < 0) return parseFloat(t);
    const dec = t[lastSep];
    const other = dec === ',' ? '.' : ',';
    // "1.234" (miles) frente a "1.5" (decimal): 3 cifras tras un único separador → miles si es punto
    const after = t.length - lastSep - 1;
    const count = t.split(dec).length - 1;
    if (after === 3 && count === 1 && !t.includes(other) && dec === '.') return parseFloat(t.replace(/\./g, ''));
    if (count > 1) return parseFloat(t.split(dec).join('')); // 1.234.567
    return parseFloat(t.split(other).join('').replace(dec, '.'));
  };
  let m = /^(.*?)\s*%$/.exec(s);
  if (m) {
    const n = num(m[1]);
    if (n != null) return { v: n / 100, kind: 'percent' };
  }
  m = /^(?:€\s*(.+)|(.+?)\s*€)$/.exec(s);
  if (m) {
    const n = num(m[1] ?? m[2]);
    if (n != null) return { v: n, kind: 'currency' };
  }
  const n = num(s);
  if (n != null) return { v: n };
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = +m[1];
    const mo = +m[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: dateToSerial(y, mo, d), kind: 'date' };
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return { v: dateToSerial(+m[1], +m[2], +m[3]), kind: 'date' };
  return { v: s };
}

function toNum(v: Scalar): number | SheetError {
  if (isErr(v)) return v;
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const p = parseInput(v).v;
  return typeof p === 'number' ? p : err('VALUE');
}
function toStr(v: Scalar): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'number') return fmtNumPlain(v);
  return String(v);
}
export function fmtNumPlain(n: number) {
  if (!isFinite(n)) return '#¡NUM!';
  const r = Math.round(n * 1e10) / 1e10;
  return String(r).replace('.', ',');
}
function toBool(v: Scalar): boolean | SheetError {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null || v === '') return false;
  if (/^(verdadero|true)$/i.test(v)) return true;
  if (/^(falso|false)$/i.test(v)) return false;
  return err('VALUE');
}
const scalar = (v: Val): Scalar => (isMatrix(v) ? (v[0]?.[0] ?? null) : v);
const flat = (v: Val): Scalar[] => (isMatrix(v) ? v.flat() : [v]);

// ------------------------------------------------------------------ hoja
export interface SheetData {
  /** Contenido escrito (lo que el usuario teclea, con "=" para fórmulas). */
  get(r: number, c: number): string;
  rows: number;
  cols: number;
}

export class Sheet {
  private cache = new Map<number, Scalar>();
  private visiting = new Set<number>();
  private asts = new Map<string, Node | Error>();
  constructor(public data: SheetData) {}

  invalidate() {
    this.cache.clear();
  }

  private key(r: number, c: number) {
    return r * 16384 + c;
  }

  /** Valor calculado de una celda. */
  value(r: number, c: number): Scalar {
    if (r < 0 || c < 0 || r >= this.data.rows || c >= this.data.cols) return null;
    const k = this.key(r, c);
    if (this.cache.has(k)) return this.cache.get(k)!;
    if (this.visiting.has(k)) return err('CIRC');
    const raw = this.data.get(r, c);
    let v: Scalar;
    if (raw.startsWith('=') && raw.length > 1) {
      this.visiting.add(k);
      try {
        v = scalar(this.evalFormula(raw.slice(1), r, c));
        if (v == null) v = 0; // =A1 con A1 vacía da 0, como en Excel
      } finally {
        this.visiting.delete(k);
      }
    } else if (raw.startsWith("'")) v = raw.slice(1);
    else v = parseInput(raw).v;
    this.cache.set(k, v);
    return v;
  }

  /** Evalúa una fórmula suelta (sin el "="), p.ej. para la barra de estado. */
  evalFormula(src: string, r = 0, c = 0): Val {
    let ast = this.asts.get(src);
    if (!ast) {
      try {
        ast = parse(src);
      } catch (e: any) {
        ast = e instanceof Error ? e : new Error(String(e));
      }
      this.asts.set(src, ast);
    }
    if (ast instanceof Error) return err('NAME');
    try {
      return this.ev(ast, { r, c });
    } catch (e) {
      if (e instanceof SheetError) return e;
      return err('VALUE');
    }
  }

  private range(n: Extract<Node, { t: 'range' }>): Matrix {
    const r1 = n.r1 < 0 ? 0 : n.r1;
    const r2 = n.r2 < 0 ? this.data.rows - 1 : Math.min(n.r2, this.data.rows - 1);
    const c1 = n.c1 < 0 ? 0 : n.c1;
    const c2 = n.c2 < 0 ? this.data.cols - 1 : Math.min(n.c2, this.data.cols - 1);
    const out: Matrix = [];
    for (let r = r1; r <= Math.max(r1, r2); r++) {
      const row: Scalar[] = [];
      for (let c = c1; c <= Math.max(c1, c2); c++) row.push(this.value(r, c));
      out.push(row);
    }
    return out;
  }

  ev(n: Node, at: { r: number; c: number }): Val {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'bool':
        return n.v;
      case 'err':
        return err(n.v);
      case 'ref':
        return this.value(n.r, n.c);
      case 'range':
        return this.range(n);
      case 'array':
        return n.rows.map((row) => row.map((x) => scalar(this.ev(x, at))));
      case 'pct': {
        const v = toNum(scalar(this.ev(n.a, at)));
        return isErr(v) ? v : v / 100;
      }
      case 'un': {
        const v = toNum(scalar(this.ev(n.a, at)));
        return isErr(v) ? v : n.op === '-' ? -v : v;
      }
      case 'bin':
        return this.binop(n.op, scalar(this.ev(n.a, at)), scalar(this.ev(n.b, at)));
      case 'fn': {
        const f = FUNCS[ALIASES[n.name] ?? n.name];
        if (!f) return err('NAME');
        return f(n.args, this, at);
      }
    }
  }

  private binop(op: string, a: Scalar, b: Scalar): Scalar {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (op === '&') return toStr(a) + toStr(b);
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
      const c = compare(a, b);
      return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
    }
    const x = toNum(a);
    const y = toNum(b);
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    switch (op) {
      case '+':
        return x + y;
      case '-':
        return x - y;
      case '*':
        return x * y;
      case '/':
        return y === 0 ? err('DIV0') : x / y;
      case '^': {
        const r = Math.pow(x, y);
        return isFinite(r) ? r : err('NUM');
      }
    }
    return err('VALUE');
  }
}

/** Compara como Excel: números < textos < lógicos; textos sin distinguir mayúsculas. */
function compare(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar) => (typeof v === 'number' || v == null ? 0 : typeof v === 'string' ? 1 : 2);
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
}

// ------------------------------------------------------------------ criterios (SUMAR.SI, CONTAR.SI…)
function criterion(c: Scalar): (v: Scalar) => boolean {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => compare(v, c) === 0 && v != null;
  const s = toStr(c);
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)!;
  const op = m[1] || '=';
  const rhsRaw = m[2];
  const rhs = parseInput(rhsRaw).v;
  if (typeof rhs === 'string' && (op === '=' || op === '<>') && /[*?]/.test(rhs)) {
    const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return (v) => re.test(toStr(v)) === (op === '=');
  }
  return (v) => {
    if (rhsRaw === '') return op === '=' ? v == null || v === '' : !(v == null || v === '');
    if (typeof rhs === 'number' && typeof v !== 'number') {
      if (typeof v === 'string') {
        const n = parseInput(v).v;
        if (typeof n !== 'number') return op === '<>';
        v = n;
      } else return op === '<>';
    }
    const k = compare(v, rhs);
    return op === '=' ? k === 0 : op === '<>' ? k !== 0 : op === '<' ? k < 0 : op === '>' ? k > 0 : op === '<=' ? k <= 0 : k >= 0;
  };
}

// ------------------------------------------------------------------ funciones
type Fn = (args: Node[], sh: Sheet, at: { r: number; c: number }) => Val;

const A = (sh: Sheet, n: Node | undefined, at: { r: number; c: number }): Val => (n ? sh.ev(n, at) : null);
const S = (sh: Sheet, n: Node | undefined, at: { r: number; c: number }): Scalar => scalar(A(sh, n, at));
function N(sh: Sheet, n: Node | undefined, at: { r: number; c: number }, def?: number): number {
  if (!n && def !== undefined) return def;
  const v = toNum(S(sh, n, at));
  if (isErr(v)) throw v;
  return v;
}
const STR = (sh: Sheet, n: Node | undefined, at: { r: number; c: number }) => {
  const v = S(sh, n, at);
  if (isErr(v)) throw v;
  return toStr(v);
};
const M = (sh: Sheet, n: Node | undefined, at: { r: number; c: number }): Matrix => {
  const v = A(sh, n, at);
  return isMatrix(v) ? v : [[v]];
};

/** Números de los argumentos: de rangos solo cuentan las celdas con número; los escritos directamente se convierten. */
function nums(args: Node[], sh: Sheet, at: { r: number; c: number }): number[] {
  const out: number[] = [];
  for (const a of args) {
    const v = sh.ev(a, at);
    if (isMatrix(v)) {
      for (const x of v.flat()) {
        if (isErr(x)) throw x;
        if (typeof x === 'number') out.push(x);
      }
    } else {
      if (isErr(v)) throw v;
      if (v == null) continue;
      const n = toNum(v);
      if (isErr(n)) throw n;
      out.push(n);
    }
  }
  return out;
}

const wrap =
  (f: Fn): Fn =>
  (args, sh, at) => {
    try {
      const v = f(args, sh, at);
      if (typeof v === 'number' && !isFinite(v)) return err('NUM');
      return v;
    } catch (e) {
      if (e instanceof SheetError) return e;
      throw e;
    }
  };

function roundTo(x: number, d: number, mode: 'round' | 'up' | 'down') {
  const f = Math.pow(10, d);
  const v = x * f;
  const r = mode === 'round' ? Math.sign(v) * Math.round(Math.abs(v) + 1e-9) : mode === 'up' ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : Math.sign(v) * Math.floor(Math.abs(v) + 1e-9);
  return r / f;
}

function ifsPairs(args: Node[], sh: Sheet, at: { r: number; c: number }, start: number) {
  const tests: { range: Scalar[]; test: (v: Scalar) => boolean }[] = [];
  for (let i = start; i + 1 < args.length; i += 2) tests.push({ range: M(sh, args[i], at).flat(), test: criterion(S(sh, args[i + 1], at)) });
  return tests;
}
function matchAll(tests: { range: Scalar[]; test: (v: Scalar) => boolean }[], i: number) {
  return tests.every((t) => t.test(t.range[i] ?? null));
}

function lookupIndex(needle: Scalar, list: Scalar[], mode: number): number {
  if (mode === 0) {
    const test = typeof needle === 'string' && /[*?]/.test(needle) ? criterion(needle) : (v: Scalar) => compare(v, needle) === 0 && v != null;
    return list.findIndex(test);
  }
  if (mode === 1) {
    // lista ordenada ascendente: el mayor valor <= buscado
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i] == null) continue;
      if (compare(list[i], needle) <= 0) best = i;
      else break;
    }
    return best;
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] == null) continue;
    if (compare(list[i], needle) >= 0) best = i;
    else break;
  }
  return best;
}

const FUNCS: Record<string, Fn> = {};
const ALIASES: Record<string, string> = {};
/** Descripción para la ayuda y el autocompletado: [categoría, sintaxis, descripción]. */
export const FUNC_INFO: Record<string, [string, string, string]> = {};

function def(names: string[], cat: string, syntax: string, desc: string, f: Fn) {
  const [main, ...alias] = names;
  FUNCS[main] = wrap(f);
  for (const a of alias) ALIASES[normName(a)] = main;
  FUNC_INFO[names[names.length > 1 ? 1 : 0]] = [cat, syntax, desc];
}

// --- matemáticas
def(['SUM', 'SUMA'], 'Matemáticas', 'SUMA(número1; [número2]; …)', 'Suma los números', (a, sh, at) => nums(a, sh, at).reduce((x, y) => x + y, 0));
def(['AVERAGE', 'PROMEDIO'], 'Estadística', 'PROMEDIO(número1; …)', 'Media aritmética', (a, sh, at) => {
  const n = nums(a, sh, at);
  return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err('DIV0');
});
def(['MIN'], 'Estadística', 'MIN(número1; …)', 'Valor mínimo', (a, sh, at) => {
  const n = nums(a, sh, at);
  return n.length ? Math.min(...n) : 0;
});
def(['MAX'], 'Estadística', 'MAX(número1; …)', 'Valor máximo', (a, sh, at) => {
  const n = nums(a, sh, at);
  return n.length ? Math.max(...n) : 0;
});
def(['COUNT', 'CONTAR'], 'Estadística', 'CONTAR(valor1; …)', 'Cuenta las celdas con números', (a, sh, at) => a.flatMap((x) => flat(sh.ev(x, at))).filter((v) => typeof v === 'number').length);
def(['COUNTA', 'CONTARA'], 'Estadística', 'CONTARA(valor1; …)', 'Cuenta las celdas no vacías', (a, sh, at) => a.flatMap((x) => flat(sh.ev(x, at))).filter((v) => v != null && v !== '').length);
def(['COUNTBLANK', 'CONTAR.BLANCO'], 'Estadística', 'CONTAR.BLANCO(rango)', 'Cuenta las celdas vacías', (a, sh, at) => M(sh, a[0], at).flat().filter((v) => v == null || v === '').length);
def(['PRODUCT', 'PRODUCTO'], 'Matemáticas', 'PRODUCTO(número1; …)', 'Multiplica los números', (a, sh, at) => nums(a, sh, at).reduce((x, y) => x * y, 1));
def(['ROUND', 'REDONDEAR'], 'Matemáticas', 'REDONDEAR(número; decimales)', 'Redondea', (a, sh, at) => roundTo(N(sh, a[0], at), N(sh, a[1], at, 0), 'round'));
def(['ROUNDUP', 'REDONDEAR.MAS'], 'Matemáticas', 'REDONDEAR.MAS(número; decimales)', 'Redondea hacia arriba', (a, sh, at) => roundTo(N(sh, a[0], at), N(sh, a[1], at, 0), 'up'));
def(['ROUNDDOWN', 'REDONDEAR.MENOS'], 'Matemáticas', 'REDONDEAR.MENOS(número; decimales)', 'Redondea hacia abajo', (a, sh, at) => roundTo(N(sh, a[0], at), N(sh, a[1], at, 0), 'down'));
def(['INT', 'ENTERO'], 'Matemáticas', 'ENTERO(número)', 'Parte entera (hacia abajo)', (a, sh, at) => Math.floor(N(sh, a[0], at)));
def(['TRUNC', 'TRUNCAR'], 'Matemáticas', 'TRUNCAR(número; [decimales])', 'Quita decimales', (a, sh, at) => roundTo(N(sh, a[0], at), N(sh, a[1], at, 0), 'down'));
def(['ABS'], 'Matemáticas', 'ABS(número)', 'Valor absoluto', (a, sh, at) => Math.abs(N(sh, a[0], at)));
def(['SQRT', 'RAIZ'], 'Matemáticas', 'RAIZ(número)', 'Raíz cuadrada', (a, sh, at) => {
  const x = N(sh, a[0], at);
  return x < 0 ? err('NUM') : Math.sqrt(x);
});
def(['POWER', 'POTENCIA'], 'Matemáticas', 'POTENCIA(número; potencia)', 'Eleva a una potencia', (a, sh, at) => Math.pow(N(sh, a[0], at), N(sh, a[1], at)));
def(['MOD', 'RESIDUO'], 'Matemáticas', 'RESIDUO(número; divisor)', 'Resto de la división', (a, sh, at) => {
  const x = N(sh, a[0], at);
  const d = N(sh, a[1], at);
  return d === 0 ? err('DIV0') : x - d * Math.floor(x / d);
});
def(['PI'], 'Matemáticas', 'PI()', 'El número π', () => Math.PI);
def(['RAND', 'ALEATORIO'], 'Matemáticas', 'ALEATORIO()', 'Número aleatorio entre 0 y 1', () => Math.random());
def(['RANDBETWEEN', 'ALEATORIO.ENTRE'], 'Matemáticas', 'ALEATORIO.ENTRE(inferior; superior)', 'Entero aleatorio entre dos valores', (a, sh, at) => {
  const lo = Math.ceil(N(sh, a[0], at));
  const hi = Math.floor(N(sh, a[1], at));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
});
def(['LN'], 'Matemáticas', 'LN(número)', 'Logaritmo natural', (a, sh, at) => Math.log(N(sh, a[0], at)));
def(['LOG'], 'Matemáticas', 'LOG(número; [base])', 'Logaritmo', (a, sh, at) => Math.log(N(sh, a[0], at)) / Math.log(N(sh, a[1], at, 10)));
def(['LOG10'], 'Matemáticas', 'LOG10(número)', 'Logaritmo en base 10', (a, sh, at) => Math.log10(N(sh, a[0], at)));
def(['EXP'], 'Matemáticas', 'EXP(número)', 'e elevado a un número', (a, sh, at) => Math.exp(N(sh, a[0], at)));
def(['SIGN', 'SIGNO'], 'Matemáticas', 'SIGNO(número)', '1, 0 o -1 según el signo', (a, sh, at) => Math.sign(N(sh, a[0], at)));
def(['CEILING', 'MULTIPLO.SUPERIOR'], 'Matemáticas', 'MULTIPLO.SUPERIOR(número; múltiplo)', 'Redondea hacia arriba al múltiplo', (a, sh, at) => {
  const m = N(sh, a[1], at, 1);
  return m === 0 ? 0 : Math.ceil(N(sh, a[0], at) / m - 1e-12) * m;
});
def(['FLOOR', 'MULTIPLO.INFERIOR'], 'Matemáticas', 'MULTIPLO.INFERIOR(número; múltiplo)', 'Redondea hacia abajo al múltiplo', (a, sh, at) => {
  const m = N(sh, a[1], at, 1);
  return m === 0 ? 0 : Math.floor(N(sh, a[0], at) / m + 1e-12) * m;
});
def(['MROUND', 'REDOND.MULT'], 'Matemáticas', 'REDOND.MULT(número; múltiplo)', 'Redondea al múltiplo más cercano', (a, sh, at) => {
  const m = N(sh, a[1], at);
  return m === 0 ? 0 : Math.round(N(sh, a[0], at) / m) * m;
});
def(['SUMPRODUCT', 'SUMAPRODUCTO'], 'Matemáticas', 'SUMAPRODUCTO(matriz1; matriz2; …)', 'Suma de los productos', (a, sh, at) => {
  const ms = a.map((x) => M(sh, x, at).flat());
  const len = ms[0]?.length ?? 0;
  if (ms.some((m) => m.length !== len)) return err('VALUE');
  let s = 0;
  for (let i = 0; i < len; i++) s += ms.reduce((p, m) => p * (typeof m[i] === 'number' ? (m[i] as number) : 0), 1);
  return s;
});
def(['SUMSQ', 'SUMA.CUADRADOS'], 'Matemáticas', 'SUMA.CUADRADOS(número1; …)', 'Suma de cuadrados', (a, sh, at) => nums(a, sh, at).reduce((x, y) => x + y * y, 0));
def(['FACT'], 'Matemáticas', 'FACT(número)', 'Factorial', (a, sh, at) => {
  let n = Math.floor(N(sh, a[0], at));
  if (n < 0) return err('NUM');
  let r = 1;
  while (n > 1) r *= n--;
  return r;
});
def(['GCD', 'M.C.D'], 'Matemáticas', 'M.C.D(número1; …)', 'Máximo común divisor', (a, sh, at) => nums(a, sh, at).map(Math.floor).reduce((x, y) => {
  while (y) [x, y] = [y, x % y];
  return Math.abs(x);
}));
def(['LCM', 'M.C.M'], 'Matemáticas', 'M.C.M(número1; …)', 'Mínimo común múltiplo', (a, sh, at) => nums(a, sh, at).map(Math.floor).reduce((x, y) => {
  let g = x;
  let h = y;
  while (h) [g, h] = [h, g % h];
  return g ? Math.abs(x * y) / g : 0;
}));
def(['SIN', 'SENO'], 'Matemáticas', 'SENO(ángulo)', 'Seno (radianes)', (a, sh, at) => Math.sin(N(sh, a[0], at)));
def(['COS'], 'Matemáticas', 'COS(ángulo)', 'Coseno (radianes)', (a, sh, at) => Math.cos(N(sh, a[0], at)));
def(['TAN'], 'Matemáticas', 'TAN(ángulo)', 'Tangente (radianes)', (a, sh, at) => Math.tan(N(sh, a[0], at)));
def(['RADIANS', 'RADIANES'], 'Matemáticas', 'RADIANES(grados)', 'Grados a radianes', (a, sh, at) => (N(sh, a[0], at) * Math.PI) / 180);
def(['DEGREES', 'GRADOS'], 'Matemáticas', 'GRADOS(radianes)', 'Radianes a grados', (a, sh, at) => (N(sh, a[0], at) * 180) / Math.PI);

// --- estadística
def(['MEDIAN', 'MEDIANA'], 'Estadística', 'MEDIANA(número1; …)', 'Valor central', (a, sh, at) => {
  const n = nums(a, sh, at).sort((x, y) => x - y);
  if (!n.length) return err('NUM');
  const m = n.length >> 1;
  return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
});
def(['MODE', 'MODA', 'MODE.SNGL', 'MODA.UNO'], 'Estadística', 'MODA(número1; …)', 'Valor que más se repite', (a, sh, at) => {
  const n = nums(a, sh, at);
  const count = new Map<number, number>();
  let best: number | null = null;
  let bc = 1;
  for (const x of n) {
    const c = (count.get(x) ?? 0) + 1;
    count.set(x, c);
    if (c > bc) (bc = c), (best = x);
  }
  return best ?? err('NA');
});
const variance = (n: number[], sample: boolean) => {
  if (n.length < (sample ? 2 : 1)) return NaN;
  const m = n.reduce((x, y) => x + y, 0) / n.length;
  return n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - (sample ? 1 : 0));
};
def(['STDEV', 'DESVEST', 'STDEV.S', 'DESVEST.M'], 'Estadística', 'DESVEST(número1; …)', 'Desviación estándar (muestra)', (a, sh, at) => Math.sqrt(variance(nums(a, sh, at), true)));
def(['STDEVP', 'DESVESTP', 'STDEV.P', 'DESVEST.P'], 'Estadística', 'DESVEST.P(número1; …)', 'Desviación estándar (población)', (a, sh, at) => Math.sqrt(variance(nums(a, sh, at), false)));
def(['VAR', 'VAR.S'], 'Estadística', 'VAR(número1; …)', 'Varianza (muestra)', (a, sh, at) => variance(nums(a, sh, at), true));
def(['VARP', 'VAR.P'], 'Estadística', 'VAR.P(número1; …)', 'Varianza (población)', (a, sh, at) => variance(nums(a, sh, at), false));
def(['LARGE', 'K.ESIMO.MAYOR'], 'Estadística', 'K.ESIMO.MAYOR(matriz; k)', 'El k-ésimo mayor', (a, sh, at) => {
  const n = nums([a[0]], sh, at).sort((x, y) => y - x);
  const k = Math.floor(N(sh, a[1], at));
  return k >= 1 && k <= n.length ? n[k - 1] : err('NUM');
});
def(['SMALL', 'K.ESIMO.MENOR'], 'Estadística', 'K.ESIMO.MENOR(matriz; k)', 'El k-ésimo menor', (a, sh, at) => {
  const n = nums([a[0]], sh, at).sort((x, y) => x - y);
  const k = Math.floor(N(sh, a[1], at));
  return k >= 1 && k <= n.length ? n[k - 1] : err('NUM');
});
def(['RANK', 'JERARQUIA', 'RANK.EQ', 'JERARQUIA.EQV'], 'Estadística', 'JERARQUIA(número; ref; [orden])', 'Posición de un número en una lista', (a, sh, at) => {
  const x = N(sh, a[0], at);
  const n = nums([a[1]], sh, at);
  const asc = N(sh, a[2], at, 0) !== 0;
  if (!n.includes(x)) return err('NA');
  return n.filter((v) => (asc ? v < x : v > x)).length + 1;
});
def(['PERCENTILE', 'PERCENTIL', 'PERCENTILE.INC', 'PERCENTIL.INC'], 'Estadística', 'PERCENTIL(matriz; k)', 'Percentil k (0 a 1)', (a, sh, at) => {
  const n = nums([a[0]], sh, at).sort((x, y) => x - y);
  const k = N(sh, a[1], at);
  if (!n.length || k < 0 || k > 1) return err('NUM');
  const pos = (n.length - 1) * k;
  const lo = Math.floor(pos);
  return n[lo] + (n[Math.min(lo + 1, n.length - 1)] - n[lo]) * (pos - lo);
});

// --- condicionales
def(['SUMIF', 'SUMAR.SI'], 'Condicionales', 'SUMAR.SI(rango; criterio; [rango_suma])', 'Suma lo que cumple un criterio', (a, sh, at) => {
  const range = M(sh, a[0], at).flat();
  const test = criterion(S(sh, a[1], at));
  const sum = a[2] ? M(sh, a[2], at).flat() : range;
  let s = 0;
  range.forEach((v, i) => test(v) && typeof sum[i] === 'number' && (s += sum[i] as number));
  return s;
});
def(['COUNTIF', 'CONTAR.SI'], 'Condicionales', 'CONTAR.SI(rango; criterio)', 'Cuenta lo que cumple un criterio', (a, sh, at) => {
  const test = criterion(S(sh, a[1], at));
  return M(sh, a[0], at).flat().filter(test).length;
});
def(['AVERAGEIF', 'PROMEDIO.SI'], 'Condicionales', 'PROMEDIO.SI(rango; criterio; [rango_promedio])', 'Media de lo que cumple un criterio', (a, sh, at) => {
  const range = M(sh, a[0], at).flat();
  const test = criterion(S(sh, a[1], at));
  const src = a[2] ? M(sh, a[2], at).flat() : range;
  const n = range.map((v, i) => (test(v) && typeof src[i] === 'number' ? (src[i] as number) : null)).filter((x): x is number => x != null);
  return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err('DIV0');
});
def(['SUMIFS', 'SUMAR.SI.CONJUNTO'], 'Condicionales', 'SUMAR.SI.CONJUNTO(rango_suma; rango1; criterio1; …)', 'Suma con varios criterios', (a, sh, at) => {
  const sum = M(sh, a[0], at).flat();
  const tests = ifsPairs(a, sh, at, 1);
  let s = 0;
  sum.forEach((v, i) => typeof v === 'number' && matchAll(tests, i) && (s += v));
  return s;
});
def(['COUNTIFS', 'CONTAR.SI.CONJUNTO'], 'Condicionales', 'CONTAR.SI.CONJUNTO(rango1; criterio1; …)', 'Cuenta con varios criterios', (a, sh, at) => {
  const tests = ifsPairs(a, sh, at, 0);
  const len = tests[0]?.range.length ?? 0;
  let n = 0;
  for (let i = 0; i < len; i++) if (matchAll(tests, i)) n++;
  return n;
});
def(['AVERAGEIFS', 'PROMEDIO.SI.CONJUNTO'], 'Condicionales', 'PROMEDIO.SI.CONJUNTO(rango_promedio; rango1; criterio1; …)', 'Media con varios criterios', (a, sh, at) => {
  const src = M(sh, a[0], at).flat();
  const tests = ifsPairs(a, sh, at, 1);
  const n = src.filter((v, i) => typeof v === 'number' && matchAll(tests, i)) as number[];
  return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err('DIV0');
});
def(['MAXIFS', 'MAX.SI.CONJUNTO'], 'Condicionales', 'MAX.SI.CONJUNTO(rango_max; rango1; criterio1; …)', 'Máximo con criterios', (a, sh, at) => {
  const src = M(sh, a[0], at).flat();
  const tests = ifsPairs(a, sh, at, 1);
  const n = src.filter((v, i) => typeof v === 'number' && matchAll(tests, i)) as number[];
  return n.length ? Math.max(...n) : 0;
});
def(['MINIFS', 'MIN.SI.CONJUNTO'], 'Condicionales', 'MIN.SI.CONJUNTO(rango_min; rango1; criterio1; …)', 'Mínimo con criterios', (a, sh, at) => {
  const src = M(sh, a[0], at).flat();
  const tests = ifsPairs(a, sh, at, 1);
  const n = src.filter((v, i) => typeof v === 'number' && matchAll(tests, i)) as number[];
  return n.length ? Math.min(...n) : 0;
});

// --- lógicas
def(['IF', 'SI'], 'Lógicas', 'SI(prueba; valor_si_verdadero; [valor_si_falso])', 'Elige un valor según una condición', (a, sh, at) => {
  const t = toBool(S(sh, a[0], at));
  if (isErr(t)) return t;
  return t ? A(sh, a[1], at) ?? true : a.length > 2 ? A(sh, a[2], at) : false;
});
def(['IFS', 'SI.CONJUNTO'], 'Lógicas', 'SI.CONJUNTO(prueba1; valor1; prueba2; valor2; …)', 'Primera condición que se cumple', (a, sh, at) => {
  for (let i = 0; i + 1 < a.length; i += 2) {
    const t = toBool(S(sh, a[i], at));
    if (isErr(t)) return t;
    if (t) return A(sh, a[i + 1], at);
  }
  return err('NA');
});
def(['AND', 'Y'], 'Lógicas', 'Y(lógico1; lógico2; …)', 'VERDADERO si todas se cumplen', (a, sh, at) => {
  for (const v of a.flatMap((x) => flat(sh.ev(x, at)))) {
    if (v == null) continue;
    const b = toBool(v);
    if (isErr(b)) return b;
    if (!b) return false;
  }
  return true;
});
def(['OR', 'O'], 'Lógicas', 'O(lógico1; lógico2; …)', 'VERDADERO si alguna se cumple', (a, sh, at) => {
  for (const v of a.flatMap((x) => flat(sh.ev(x, at)))) {
    if (v == null) continue;
    const b = toBool(v);
    if (isErr(b)) return b;
    if (b) return true;
  }
  return false;
});
def(['XOR', 'XO'], 'Lógicas', 'XO(lógico1; …)', 'VERDADERO si se cumple un número impar', (a, sh, at) => a.flatMap((x) => flat(sh.ev(x, at))).filter((v) => v != null && toBool(v) === true).length % 2 === 1);
def(['NOT', 'NO'], 'Lógicas', 'NO(lógico)', 'Invierte VERDADERO/FALSO', (a, sh, at) => {
  const b = toBool(S(sh, a[0], at));
  return isErr(b) ? b : !b;
});
def(['IFERROR', 'SI.ERROR'], 'Lógicas', 'SI.ERROR(valor; valor_si_error)', 'Otro valor si hay un error', (a, sh, at) => {
  const v = S(sh, a[0], at);
  return isErr(v) ? A(sh, a[1], at) : v;
});
def(['IFNA', 'SI.ND'], 'Lógicas', 'SI.ND(valor; valor_si_nd)', 'Otro valor si da #N/D', (a, sh, at) => {
  const v = S(sh, a[0], at);
  return isErr(v) && v.code === 'NA' ? A(sh, a[1], at) : v;
});
def(['SWITCH', 'CAMBIAR'], 'Lógicas', 'CAMBIAR(expresión; valor1; resultado1; …; [predeterminado])', 'Resultado según el valor', (a, sh, at) => {
  const x = S(sh, a[0], at);
  let i = 1;
  for (; i + 1 < a.length; i += 2) if (compare(x, S(sh, a[i], at)) === 0) return A(sh, a[i + 1], at);
  return i < a.length ? A(sh, a[i], at) : err('NA');
});
def(['TRUE', 'VERDADERO'], 'Lógicas', 'VERDADERO()', 'El valor VERDADERO', () => true);
def(['FALSE', 'FALSO'], 'Lógicas', 'FALSO()', 'El valor FALSO', () => false);

// --- información
def(['ISBLANK', 'ESBLANCO'], 'Información', 'ESBLANCO(valor)', '¿Está vacía?', (a, sh, at) => {
  const v = S(sh, a[0], at);
  return v == null;
});
def(['ISNUMBER', 'ESNUMERO'], 'Información', 'ESNUMERO(valor)', '¿Es un número?', (a, sh, at) => typeof S(sh, a[0], at) === 'number');
def(['ISTEXT', 'ESTEXTO'], 'Información', 'ESTEXTO(valor)', '¿Es texto?', (a, sh, at) => typeof S(sh, a[0], at) === 'string');
def(['ISERROR', 'ESERROR'], 'Información', 'ESERROR(valor)', '¿Es un error?', (a, sh, at) => isErr(S(sh, a[0], at)));
def(['ISEVEN', 'ES.PAR'], 'Información', 'ES.PAR(número)', '¿Es par?', (a, sh, at) => Math.floor(N(sh, a[0], at)) % 2 === 0);
def(['ISODD', 'ES.IMPAR'], 'Información', 'ES.IMPAR(número)', '¿Es impar?', (a, sh, at) => Math.abs(Math.floor(N(sh, a[0], at)) % 2) === 1);
def(['NA', 'NOD'], 'Información', 'NOD()', 'Devuelve #N/D', () => err('NA'));

// --- texto
def(['CONCAT', 'CONCAT'], 'Texto', 'CONCAT(texto1; …)', 'Une textos', (a, sh, at) => a.flatMap((x) => flat(sh.ev(x, at))).map(toStr).join(''));
def(['CONCATENATE', 'CONCATENAR'], 'Texto', 'CONCATENAR(texto1; …)', 'Une textos', (a, sh, at) => a.map((x) => STR(sh, x, at)).join(''));
def(['TEXTJOIN', 'UNIRCADENAS'], 'Texto', 'UNIRCADENAS(separador; ignorar_vacías; texto1; …)', 'Une textos con separador', (a, sh, at) => {
  const sep = STR(sh, a[0], at);
  const skip = toBool(S(sh, a[1], at)) === true;
  return a
    .slice(2)
    .flatMap((x) => flat(sh.ev(x, at)))
    .map(toStr)
    .filter((s) => !skip || s !== '')
    .join(sep);
});
def(['LEN', 'LARGO'], 'Texto', 'LARGO(texto)', 'Número de caracteres', (a, sh, at) => STR(sh, a[0], at).length);
def(['LEFT', 'IZQUIERDA'], 'Texto', 'IZQUIERDA(texto; [núm_caracteres])', 'Caracteres del principio', (a, sh, at) => STR(sh, a[0], at).slice(0, N(sh, a[1], at, 1)));
def(['RIGHT', 'DERECHA'], 'Texto', 'DERECHA(texto; [núm_caracteres])', 'Caracteres del final', (a, sh, at) => {
  const s = STR(sh, a[0], at);
  const n = N(sh, a[1], at, 1);
  return n <= 0 ? '' : s.slice(-n);
});
def(['MID', 'EXTRAE'], 'Texto', 'EXTRAE(texto; posición; núm_caracteres)', 'Caracteres del medio', (a, sh, at) => {
  const s = STR(sh, a[0], at);
  const p = N(sh, a[1], at);
  return p < 1 ? err('VALUE') : s.substr(p - 1, N(sh, a[2], at));
});
def(['UPPER', 'MAYUSC'], 'Texto', 'MAYUSC(texto)', 'A mayúsculas', (a, sh, at) => STR(sh, a[0], at).toUpperCase());
def(['LOWER', 'MINUSC'], 'Texto', 'MINUSC(texto)', 'A minúsculas', (a, sh, at) => STR(sh, a[0], at).toLowerCase());
def(['PROPER', 'NOMPROPIO'], 'Texto', 'NOMPROPIO(texto)', 'Primera letra de cada palabra en mayúscula', (a, sh, at) => STR(sh, a[0], at).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, l) => p + l.toUpperCase()));
def(['TRIM', 'ESPACIOS'], 'Texto', 'ESPACIOS(texto)', 'Quita espacios sobrantes', (a, sh, at) => STR(sh, a[0], at).trim().replace(/\s+/g, ' '));
def(['SUBSTITUTE', 'SUSTITUIR'], 'Texto', 'SUSTITUIR(texto; texto_original; texto_nuevo; [núm_instancia])', 'Cambia un texto por otro', (a, sh, at) => {
  const s = STR(sh, a[0], at);
  const o = STR(sh, a[1], at);
  const n = STR(sh, a[2], at);
  if (!o) return s;
  if (!a[3]) return s.split(o).join(n);
  const k = N(sh, a[3], at);
  let i = -1;
  for (let j = 0; j < k; j++) {
    i = s.indexOf(o, i + 1);
    if (i < 0) return s;
  }
  return s.slice(0, i) + n + s.slice(i + o.length);
});
def(['REPLACE', 'REEMPLAZAR'], 'Texto', 'REEMPLAZAR(texto; posición; núm_caracteres; texto_nuevo)', 'Reemplaza parte de un texto', (a, sh, at) => {
  const s = STR(sh, a[0], at);
  const p = N(sh, a[1], at) - 1;
  return s.slice(0, p) + STR(sh, a[3], at) + s.slice(p + N(sh, a[2], at));
});
def(['FIND', 'ENCONTRAR'], 'Texto', 'ENCONTRAR(texto_buscado; dentro_de; [inicio])', 'Posición (distingue mayúsculas)', (a, sh, at) => {
  const i = STR(sh, a[1], at).indexOf(STR(sh, a[0], at), N(sh, a[2], at, 1) - 1);
  return i < 0 ? err('VALUE') : i + 1;
});
def(['SEARCH', 'HALLAR'], 'Texto', 'HALLAR(texto_buscado; dentro_de; [inicio])', 'Posición (sin distinguir mayúsculas)', (a, sh, at) => {
  const i = STR(sh, a[1], at).toLowerCase().indexOf(STR(sh, a[0], at).toLowerCase(), N(sh, a[2], at, 1) - 1);
  return i < 0 ? err('VALUE') : i + 1;
});
def(['REPT', 'REPETIR'], 'Texto', 'REPETIR(texto; veces)', 'Repite un texto', (a, sh, at) => STR(sh, a[0], at).repeat(Math.max(0, Math.min(10000, N(sh, a[1], at)))));
def(['EXACT', 'IGUAL'], 'Texto', 'IGUAL(texto1; texto2)', '¿Son idénticos?', (a, sh, at) => STR(sh, a[0], at) === STR(sh, a[1], at));
def(['VALUE', 'VALOR'], 'Texto', 'VALOR(texto)', 'Convierte texto en número', (a, sh, at) => toNum(S(sh, a[0], at)));
def(['TEXT', 'TEXTO'], 'Texto', 'TEXTO(valor; formato)', 'Da formato a un número ("0,00", "0%", "dd/mm/aaaa")', (a, sh, at) => formatWithPattern(N(sh, a[0], at), STR(sh, a[1], at)));
def(['CHAR', 'CARACTER'], 'Texto', 'CARACTER(número)', 'Carácter por su código', (a, sh, at) => String.fromCharCode(N(sh, a[0], at)));
def(['CODE', 'CODIGO'], 'Texto', 'CODIGO(texto)', 'Código del primer carácter', (a, sh, at) => STR(sh, a[0], at).charCodeAt(0) || err('VALUE'));

// --- búsqueda y referencia
def(['VLOOKUP', 'BUSCARV'], 'Búsqueda', 'BUSCARV(valor; matriz; columna; [aproximado])', 'Busca en la primera columna y devuelve otra', (a, sh, at) => {
  const needle = S(sh, a[0], at);
  const m = M(sh, a[1], at);
  const col = N(sh, a[2], at);
  const approx = a[3] ? toBool(S(sh, a[3], at)) === true : true;
  if (col < 1 || col > (m[0]?.length ?? 0)) return err('REF');
  const i = lookupIndex(needle, m.map((r) => r[0]), approx ? 1 : 0);
  return i < 0 ? err('NA') : m[i][col - 1];
});
def(['HLOOKUP', 'BUSCARH'], 'Búsqueda', 'BUSCARH(valor; matriz; fila; [aproximado])', 'Busca en la primera fila y devuelve otra', (a, sh, at) => {
  const needle = S(sh, a[0], at);
  const m = M(sh, a[1], at);
  const row = N(sh, a[2], at);
  const approx = a[3] ? toBool(S(sh, a[3], at)) === true : true;
  if (row < 1 || row > m.length) return err('REF');
  const i = lookupIndex(needle, m[0], approx ? 1 : 0);
  return i < 0 ? err('NA') : m[row - 1][i];
});
def(['XLOOKUP', 'BUSCARX'], 'Búsqueda', 'BUSCARX(valor; matriz_buscar; matriz_devolver; [si_no_encontrado])', 'Busca y devuelve el valor correspondiente', (a, sh, at) => {
  const needle = S(sh, a[0], at);
  const look = M(sh, a[1], at).flat();
  const ret = M(sh, a[2], at).flat();
  const i = lookupIndex(needle, look, 0);
  if (i < 0) return a[3] ? A(sh, a[3], at) : err('NA');
  return ret[i] ?? err('REF');
});
def(['MATCH', 'COINCIDIR'], 'Búsqueda', 'COINCIDIR(valor; matriz; [tipo])', 'Posición de un valor en una lista', (a, sh, at) => {
  const i = lookupIndex(S(sh, a[0], at), M(sh, a[1], at).flat(), a[2] ? N(sh, a[2], at) : 1);
  return i < 0 ? err('NA') : i + 1;
});
def(['INDEX', 'INDICE'], 'Búsqueda', 'INDICE(matriz; fila; [columna])', 'Valor en una posición', (a, sh, at) => {
  const m = M(sh, a[0], at);
  let r = N(sh, a[1], at);
  let c = N(sh, a[2], at, 1);
  if (m.length === 1 && !a[2]) (c = r), (r = 1);
  if (r < 1 || c < 1 || r > m.length || c > (m[0]?.length ?? 0)) return err('REF');
  return m[r - 1][c - 1];
});
def(['CHOOSE', 'ELEGIR'], 'Búsqueda', 'ELEGIR(índice; valor1; valor2; …)', 'Elige un valor de la lista', (a, sh, at) => {
  const i = Math.floor(N(sh, a[0], at));
  return i >= 1 && i < a.length ? A(sh, a[i], at) : err('VALUE');
});
def(['ROWS', 'FILAS'], 'Búsqueda', 'FILAS(matriz)', 'Número de filas', (a, sh, at) => M(sh, a[0], at).length);
def(['COLUMNS', 'COLUMNAS'], 'Búsqueda', 'COLUMNAS(matriz)', 'Número de columnas', (a, sh, at) => M(sh, a[0], at)[0]?.length ?? 0);
def(['ROW', 'FILA'], 'Búsqueda', 'FILA([ref])', 'Número de fila', (a, _sh, at) => (a[0]?.t === 'ref' ? a[0].r : a[0]?.t === 'range' ? Math.max(0, a[0].r1) : at.r) + 1);
def(['COLUMN', 'COLUMNA'], 'Búsqueda', 'COLUMNA([ref])', 'Número de columna', (a, _sh, at) => (a[0]?.t === 'ref' ? a[0].c : a[0]?.t === 'range' ? Math.max(0, a[0].c1) : at.c) + 1);

// --- fechas
def(['TODAY', 'HOY'], 'Fecha y hora', 'HOY()', 'Fecha de hoy', () => Math.floor(nowSerial()));
def(['NOW', 'AHORA'], 'Fecha y hora', 'AHORA()', 'Fecha y hora actuales', () => nowSerial());
def(['DATE', 'FECHA'], 'Fecha y hora', 'FECHA(año; mes; día)', 'Crea una fecha', (a, sh, at) => dateToSerial(N(sh, a[0], at), N(sh, a[1], at), N(sh, a[2], at)));
def(['YEAR', 'AÑO', 'ANO'], 'Fecha y hora', 'AÑO(fecha)', 'Año de una fecha', (a, sh, at) => serialToDate(N(sh, a[0], at)).y);
def(['MONTH', 'MES'], 'Fecha y hora', 'MES(fecha)', 'Mes (1-12)', (a, sh, at) => serialToDate(N(sh, a[0], at)).m);
def(['DAY', 'DIA'], 'Fecha y hora', 'DIA(fecha)', 'Día del mes', (a, sh, at) => serialToDate(N(sh, a[0], at)).d);
def(['WEEKDAY', 'DIASEM'], 'Fecha y hora', 'DIASEM(fecha; [tipo])', 'Día de la semana (1=domingo; tipo 2: 1=lunes)', (a, sh, at) => {
  const wd = serialToDate(N(sh, a[0], at)).wd;
  const t = N(sh, a[1], at, 1);
  return t === 2 ? ((wd + 6) % 7) + 1 : t === 3 ? (wd + 6) % 7 : wd + 1;
});
def(['WEEKNUM', 'NUM.DE.SEMANA'], 'Fecha y hora', 'NUM.DE.SEMANA(fecha; [tipo])', 'Número de semana del año', (a, sh, at) => {
  const s = N(sh, a[0], at);
  const { y } = serialToDate(s);
  const jan1 = dateToSerial(y, 1, 1);
  const start = N(sh, a[1], at, 1) === 2 ? 1 : 0;
  const off = (serialToDate(jan1).wd - start + 7) % 7;
  return Math.floor((Math.floor(s) - jan1 + off) / 7) + 1;
});
def(['ISOWEEKNUM', 'ISO.NUM.DE.SEMANA'], 'Fecha y hora', 'ISO.NUM.DE.SEMANA(fecha)', 'Semana ISO', (a, sh, at) => {
  const { y, m, d } = serialToDate(N(sh, a[0], at));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((dt.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
});
def(['HOUR', 'HORA'], 'Fecha y hora', 'HORA(hora)', 'Hora (0-23)', (a, sh, at) => Math.floor(((N(sh, a[0], at) % 1) * 24) + 1e-9));
def(['MINUTE', 'MINUTO'], 'Fecha y hora', 'MINUTO(hora)', 'Minutos', (a, sh, at) => Math.floor((((N(sh, a[0], at) % 1) * 24 * 60) % 60) + 1e-9));
def(['SECOND', 'SEGUNDO'], 'Fecha y hora', 'SEGUNDO(hora)', 'Segundos', (a, sh, at) => Math.round(((N(sh, a[0], at) % 1) * 86400) % 60));
def(['TIME', 'NSHORA'], 'Fecha y hora', 'NSHORA(hora; minuto; segundo)', 'Crea una hora', (a, sh, at) => (N(sh, a[0], at) * 3600 + N(sh, a[1], at) * 60 + N(sh, a[2], at)) / 86400);
def(['DAYS', 'DIAS'], 'Fecha y hora', 'DIAS(fecha_final; fecha_inicial)', 'Días entre dos fechas', (a, sh, at) => Math.floor(N(sh, a[0], at)) - Math.floor(N(sh, a[1], at)));
def(['DATEDIF', 'SIFECHA'], 'Fecha y hora', 'SIFECHA(inicio; fin; "D"|"M"|"Y")', 'Diferencia en días, meses o años', (a, sh, at) => {
  const s = N(sh, a[0], at);
  const e = N(sh, a[1], at);
  if (e < s) return err('NUM');
  const u = STR(sh, a[2], at).toUpperCase();
  const A1 = serialToDate(s);
  const B1 = serialToDate(e);
  let months = (B1.y - A1.y) * 12 + (B1.m - A1.m);
  if (B1.d < A1.d) months--;
  if (u === 'D') return Math.floor(e) - Math.floor(s);
  if (u === 'M') return months;
  if (u === 'Y' || u === 'A') return Math.floor(months / 12);
  return err('NUM');
});
def(['EDATE', 'FECHA.MES'], 'Fecha y hora', 'FECHA.MES(fecha; meses)', 'Misma fecha n meses después', (a, sh, at) => {
  const { y, m, d } = serialToDate(N(sh, a[0], at));
  const k = Math.trunc(N(sh, a[1], at));
  const last = serialToDate(dateToSerial(y, m + k + 1, 0)).d;
  return dateToSerial(y, m + k, Math.min(d, last));
});
def(['EOMONTH', 'FIN.MES'], 'Fecha y hora', 'FIN.MES(fecha; meses)', 'Último día del mes', (a, sh, at) => {
  const { y, m } = serialToDate(N(sh, a[0], at));
  return dateToSerial(y, m + Math.trunc(N(sh, a[1], at)) + 1, 0);
});
def(['NETWORKDAYS', 'DIAS.LAB'], 'Fecha y hora', 'DIAS.LAB(inicio; fin; [festivos])', 'Días laborables entre dos fechas', (a, sh, at) => {
  let s = Math.floor(N(sh, a[0], at));
  let e = Math.floor(N(sh, a[1], at));
  const sign = e < s ? -1 : 1;
  if (e < s) [s, e] = [e, s];
  const hol = new Set(a[2] ? nums([a[2]], sh, at).map(Math.floor) : []);
  let n = 0;
  for (let d = s; d <= e; d++) {
    const wd = serialToDate(d).wd;
    if (wd !== 0 && wd !== 6 && !hol.has(d)) n++;
  }
  return n * sign;
});
def(['WORKDAY', 'DIA.LAB'], 'Fecha y hora', 'DIA.LAB(inicio; días; [festivos])', 'Fecha tras n días laborables', (a, sh, at) => {
  let d = Math.floor(N(sh, a[0], at));
  let k = Math.trunc(N(sh, a[1], at));
  const hol = new Set(a[2] ? nums([a[2]], sh, at).map(Math.floor) : []);
  const step = k < 0 ? -1 : 1;
  while (k !== 0) {
    d += step;
    const wd = serialToDate(d).wd;
    if (wd !== 0 && wd !== 6 && !hol.has(d)) k -= step;
  }
  return d;
});

// --- financieras
def(['PMT', 'PAGO'], 'Financieras', 'PAGO(tasa; núm_pagos; valor_actual; [valor_futuro]; [tipo])', 'Cuota de un préstamo', (a, sh, at) => {
  const r = N(sh, a[0], at);
  const n = N(sh, a[1], at);
  const pv = N(sh, a[2], at);
  const fv = N(sh, a[3], at, 0);
  const t = N(sh, a[4], at, 0);
  if (r === 0) return -(pv + fv) / n;
  const f = Math.pow(1 + r, n);
  return (-(pv * f + fv) * r) / ((1 + r * t) * (f - 1));
});
def(['FV', 'VF'], 'Financieras', 'VF(tasa; núm_pagos; pago; [valor_actual]; [tipo])', 'Valor futuro de una inversión', (a, sh, at) => {
  const r = N(sh, a[0], at);
  const n = N(sh, a[1], at);
  const p = N(sh, a[2], at);
  const pv = N(sh, a[3], at, 0);
  const t = N(sh, a[4], at, 0);
  if (r === 0) return -(pv + p * n);
  const f = Math.pow(1 + r, n);
  return -(pv * f + (p * (1 + r * t) * (f - 1)) / r);
});
def(['PV', 'VA'], 'Financieras', 'VA(tasa; núm_pagos; pago; [valor_futuro]; [tipo])', 'Valor actual', (a, sh, at) => {
  const r = N(sh, a[0], at);
  const n = N(sh, a[1], at);
  const p = N(sh, a[2], at);
  const fv = N(sh, a[3], at, 0);
  const t = N(sh, a[4], at, 0);
  if (r === 0) return -(fv + p * n);
  const f = Math.pow(1 + r, n);
  return -(fv + (p * (1 + r * t) * (f - 1)) / r) / f;
});
def(['NPV', 'VNA'], 'Financieras', 'VNA(tasa; valor1; …)', 'Valor neto actual', (a, sh, at) => {
  const r = N(sh, a[0], at);
  return nums(a.slice(1), sh, at).reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0);
});
def(['IRR', 'TIR'], 'Financieras', 'TIR(valores; [estimación])', 'Tasa interna de retorno', (a, sh, at) => {
  const v = nums([a[0]], sh, at);
  let r = N(sh, a[1], at, 0.1);
  for (let k = 0; k < 100; k++) {
    let f = 0;
    let d = 0;
    v.forEach((x, i) => {
      f += x / Math.pow(1 + r, i);
      d -= (i * x) / Math.pow(1 + r, i + 1);
    });
    if (Math.abs(d) < 1e-12) break;
    const nr = r - f / d;
    if (Math.abs(nr - r) < 1e-10) return nr;
    r = nr;
  }
  return err('NUM');
});

/** Lista de funciones para el autocompletado (nombre en español cuando lo hay). */
export function functionList() {
  return Object.entries(FUNC_INFO)
    .map(([name, [cat, syntax, desc]]) => ({ name, cat, syntax, desc }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ formato "TEXTO(valor; patrón)"
export function formatWithPattern(n: number, pat: string): string {
  const p = pat.toLowerCase();
  if (/[dmay]/.test(p) && !/0/.test(p)) {
    const { y, m, d } = serialToDate(n);
    return pat
      .replace(/aaaa|yyyy/gi, String(y))
      .replace(/aa|yy/gi, String(y).slice(-2))
      .replace(/mm/gi, String(m).padStart(2, '0'))
      .replace(/dd/gi, String(d).padStart(2, '0'));
  }
  const pct = p.includes('%');
  const v = pct ? n * 100 : n;
  const dec = (/[.,](0+)/.exec(pat)?.[1].length ?? 0) as number;
  const thousands = /#[.,]##/.test(pat) || /0[.,]000/.test(pat);
  let s = v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: thousands });
  if (pct) s += '%';
  if (pat.includes('€')) s += ' €';
  return s;
}

// ------------------------------------------------------------------ mover referencias
/**
 * Reescribe las referencias relativas de una fórmula al copiarla dr filas y dc columnas
 * (las absolutas con $ se mantienen). Lo que se sale de la hoja pasa a #¡REF!.
 */
export function shiftFormula(src: string, dr: number, dc: number): string {
  if (!src.startsWith('=')) return src;
  return rewriteRefs(src, (ref) => {
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref)!;
    let c = colIndex(m[2]);
    let r = parseInt(m[4], 10) - 1;
    if (!m[1]) c += dc;
    if (!m[3]) r += dr;
    if (r < 0 || c < 0) return '#¡REF!';
    return `${m[1]}${colName(c)}${m[3]}${r + 1}`;
  });
}

/**
 * Ajusta las referencias al insertar (count > 0) o borrar (count < 0) filas o columnas a partir de "at".
 * Afecta también a las absolutas, como en Excel.
 */
export function adjustForInsert(src: string, axis: 'row' | 'col', at: number, count: number): string {
  if (!src.startsWith('=')) return src;
  return rewriteRefs(src, (ref, kind) => {
    if (kind === 'col' || kind === 'row') {
      if ((kind === 'col') !== (axis === 'col')) return ref;
      const abs = ref.startsWith('$') ? '$' : '';
      let i = kind === 'col' ? colIndex(ref.replace('$', '')) : parseInt(ref.replace('$', ''), 10) - 1;
      if (count < 0 && i >= at && i < at - count) return null;
      if (i >= at) i += count;
      return abs + (kind === 'col' ? colName(i) : String(i + 1));
    }
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref)!;
    let c = colIndex(m[2]);
    let r = parseInt(m[4], 10) - 1;
    let i = axis === 'row' ? r : c;
    if (count < 0 && i >= at && i < at - count) return '#¡REF!';
    if (i >= at) i += count;
    if (axis === 'row') r = i;
    else c = i;
    return `${m[1]}${colName(c)}${m[3]}${r + 1}`;
  });
}

/** Aplica fn a cada referencia (celda, columna o fila) conservando el resto del texto tal cual. */
function rewriteRefs(src: string, fn: (ref: string, kind: 'ref' | 'col' | 'row') => string | null): string {
  let toks: Tok[];
  try {
    toks = tokenize(src.slice(1));
  } catch {
    return src;
  }
  let out = '';
  let last = 0;
  const body = src.slice(1);
  for (const t of toks) {
    if (t.k !== 'ref' && t.k !== 'col' && t.k !== 'row') continue;
    const r = fn(t.v, t.k);
    out += body.slice(last, t.s) + (r ?? '#¡REF!');
    last = t.e;
  }
  return '=' + out + body.slice(last);
}

/** Referencias de una fórmula (para resaltarlas con colores mientras se escribe). */
export function formulaRefs(src: string): { s: number; e: number; r1: number; c1: number; r2: number; c2: number }[] {
  if (!src.startsWith('=')) return [];
  let toks: Tok[];
  try {
    toks = tokenize(src.slice(1));
  } catch {
    return [];
  }
  const out: { s: number; e: number; r1: number; c1: number; r2: number; c2: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== 'ref') continue;
    const a = parseCellName(t.v)!;
    const nx = toks[i + 1];
    const nn = toks[i + 2];
    if (nx?.k === 'op' && nx.v === ':' && nn?.k === 'ref') {
      const b = parseCellName(nn.v)!;
      out.push({ s: t.s + 1, e: nn.e + 1, r1: Math.min(a[0], b[0]), c1: Math.min(a[1], b[1]), r2: Math.max(a[0], b[0]), c2: Math.max(a[1], b[1]) });
      i += 2;
    } else out.push({ s: t.s + 1, e: t.e + 1, r1: a[0], c1: a[1], r2: a[0], c2: a[1] });
  }
  return out;
}

/** Fórmula en el formato que guarda Excel en .xlsx (nombres en inglés, "," y punto decimal), sin "=". */
export function toExcelFormula(src: string): string {
  if (!src.startsWith('=')) return src;
  let toks: Tok[];
  try {
    toks = tokenize(src.slice(1));
  } catch {
    return src.slice(1);
  }
  const ERR_EN: Record<ErrCode, string> = { DIV0: '#DIV/0!', VALUE: '#VALUE!', REF: '#REF!', NAME: '#NAME?', NA: '#N/A', NUM: '#NUM!', CIRC: '#REF!' };
  let out = '';
  toks.forEach((t, i) => {
    switch (t.k) {
      case 'num':
        out += String(t.v);
        break;
      case 'str':
        out += '"' + t.v.replace(/"/g, '""') + '"';
        break;
      case 'err':
        out += ERR_EN[ERR_LITERALS[t.v] ?? 'VALUE'];
        break;
      case 'name': {
        const n = normName(t.v);
        const isCall = toks[i + 1]?.k === 'op' && toks[i + 1].v === '(';
        if (isCall) out += ALIASES[n] ?? n;
        else out += n === 'VERDADERO' ? 'TRUE' : n === 'FALSO' ? 'FALSE' : n;
        break;
      }
      default:
        out += t.v;
    }
  });
  return out;
}

/** Nombre de función en español para mostrarla (si el usuario la escribió en inglés se respeta). */
export function isKnownFunction(name: string) {
  const n = normName(name);
  return !!(FUNCS[n] || ALIASES[n]);
}
