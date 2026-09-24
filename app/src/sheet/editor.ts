// Hoja de cálculo a pantalla completa (estilo Excel): barra de fórmulas, selección de rangos, controlador de relleno,
// copiar/pegar con Excel, insertar/eliminar filas y columnas, ordenar, formatos e importar/exportar CSV y XLSX.
// Los cambios se guardan en vivo (los ven los demás dispositivos) y los que llegan de fuera se mezclan celda a celda.
import type { CellFmt, TableItem } from '../types';
import { h, toast } from '../util';
import { icons } from '../ui/icons';
import { askConfirm } from '../ui/dialogs';
import {
  adjustForInsert,
  cellName,
  colName,
  formulaRefs,
  functionList,
  isErr,
  parseCellName,
  shiftFormula,
  type Scalar,
  Sheet,
} from './formula';
import { alignOf, display, fmtKey, NUM_FORMATS } from './format';

export interface SheetState {
  cells: string[][];
  fmt: Record<string, CellFmt>;
  colW: number[];
  header: boolean;
}

export interface SheetEditorOpts {
  readOnly?: boolean;
  /** Cambios en vivo (se llama como mucho cada ~0,4 s). */
  onChange?: (s: SheetState) => void;
  /** Cambios que llegan de otros dispositivos. Devuelve la función para dejar de escuchar. */
  subscribe?: (fn: (t: TableItem) => void) => () => void;
}

const BASE_COL = 110; // px por unidad de ancho
const ROW_H = 28;
const REF_COLORS = ['#0090ff', '#e5484d', '#8e4ec6', '#30a46c', '#f76b15', '#d6409f', '#12a594'];
const TEXT_COLORS = ['#1f2328', '#e5484d', '#f76b15', '#b58a00', '#30a46c', '#0090ff', '#8e4ec6', '#6b6f76'];
const FILL_COLORS = ['', '#fff1a8', '#ffd6e0', '#cfe8ff', '#d3f5d3', '#ffe0c2', '#e6dcff', '#eeeeee'];
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DAYS3 = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Pos = { r: number; c: number };
type Range = { r1: number; c1: number; r2: number; c2: number };

const clone = (s: SheetState): SheetState => ({ cells: s.cells.map((r) => [...r]), fmt: { ...s.fmt }, colW: [...s.colW], header: s.header });
const same = (a: SheetState, b: SheetState) => JSON.stringify(a) === JSON.stringify(b);

export function openSheetEditor(t: TableItem, opts: SheetEditorOpts = {}): Promise<SheetState> {
  return new Promise((resolve) => {
    const ro = !!opts.readOnly;
    const cols0 = Math.max(1, ...t.cells.map((r) => r.length));
    let st: SheetState = {
      cells: t.cells.map((r) => Array.from({ length: cols0 }, (_, i) => r[i] ?? '')),
      fmt: { ...(t.fmt ?? {}) },
      colW: Array.from({ length: cols0 }, (_, i) => t.colW?.[i] ?? 1),
      header: t.header,
    };
    const origR = st.cells.length;
    const origC = cols0;
    let base = clone(st); // último estado sincronizado (para mezclar cambios remotos)
    const undo: string[] = [];
    const redo: string[] = [];

    let sel: Pos = { r: 0, c: 0 };
    let anchor: Pos = { r: 0, c: 0 };
    let editing: { r: number; c: number; src: 'cell' | 'bar'; orig: string } | null = null;
    let pointRef: { s: number; e: number } | null = null; // referencia insertada con el ratón mientras se escribe
    let GR = 0;
    let GC = 0;
    let tds: HTMLTableCellElement[][] = [];
    let sheet = new Sheet({ get: () => '', rows: 0, cols: 0 });
    let values: Scalar[][] = [];

    const R = () => st.cells.length;
    const C = () => st.cells[0]?.length ?? 1;
    const raw = (r: number, c: number) => st.cells[r]?.[c] ?? '';
    const fmt = (r: number, c: number): CellFmt => st.fmt[fmtKey(r, c)] ?? {};
    const range = (): Range => ({ r1: Math.min(sel.r, anchor.r), c1: Math.min(sel.c, anchor.c), r2: Math.max(sel.r, anchor.r), c2: Math.max(sel.c, anchor.c) });

    // ------------------------------------------------------------ DOM
    const nameBox = h('input', { class: 'ss-name', spellcheck: false, title: 'Celda o rango (escribe p.ej. B7 y pulsa Intro)' }) as HTMLInputElement;
    const bar = h('input', { class: 'ss-bar', spellcheck: false, placeholder: ro ? '' : 'Escribe un valor o una fórmula (empieza por =)' }) as HTMLInputElement;
    const hint = h('div', { class: 'ss-hint hidden' });
    const ac = h('div', { class: 'ss-ac hidden' });
    const table = h('table', { class: 'ss-table' });
    const selBox = h('div', { class: 'ss-sel' });
    const activeBox = h('div', { class: 'ss-active' });
    const fillHandle = h('div', { class: 'ss-fill', title: 'Arrastra para rellenar' });
    const fillPreview = h('div', { class: 'ss-fillprev hidden' });
    const refLayer = h('div', { class: 'ss-refs' });
    const cellEdit = h('textarea', { class: 'ss-edit hidden', spellcheck: false, rows: 1 }) as HTMLTextAreaElement;
    const inner = h('div', { class: 'ss-inner' }, table, refLayer, selBox, activeBox, fillHandle, fillPreview, cellEdit);
    const scroller = h('div', { class: 'ss-scroll', tabIndex: 0 }, inner);
    const status = h('div', { class: 'ss-status' });
    const saved = h('span', { class: 'doc-status' }, 'Guardado');
    const numSel = h(
      'select',
      { class: 'doc-select', title: 'Formato de número', onchange: () => setFmt({ nf: numSel.value as CellFmt['nf'] }) },
      ...NUM_FORMATS.map((f) => h('option', { value: f.v }, f.label)),
    ) as HTMLSelectElement;
    const headerCb = h('input', { type: 'checkbox', checked: st.header, onchange: () => mutate(() => (st.header = headerCb.checked)) }) as HTMLInputElement;

    const tb = (icon: string, title: string, fn: () => void, cls = '') =>
      h('button', { class: 'tb ' + cls, title, html: icon, onmousedown: (e: Event) => e.preventDefault(), onclick: fn });
    const txt = (label: string, style = '') => `<span style="font-weight:700;font-size:15px;${style}">${label}</span>`;
    const pop = (btn: HTMLElement, content: HTMLElement) => {
      const p = h('div', { class: 'doc-pop hidden' }, content);
      const wrap = h('div', { class: 'doc-pop-wrap' }, btn, p);
      btn.addEventListener('click', () => p.classList.toggle('hidden'));
      content.addEventListener('click', () => p.classList.add('hidden'));
      return wrap;
    };
    const swatches = (list: string[], apply: (c: string) => void) =>
      h(
        'div',
        { class: 'ss-swatches' },
        ...list.map((c) => h('button', { class: 'sw' + (c ? '' : ' none'), style: `--c:${c || '#fff'}`, title: c || 'Sin relleno', onmousedown: (e: Event) => e.preventDefault(), onclick: () => apply(c) })),
      );

    const toolbar = h(
      'div',
      { class: 'doc-toolbar ss-toolbar' },
      tb(icons.undo, 'Deshacer (Ctrl+Z)', () => doUndo()),
      tb(icons.redo, 'Rehacer (Ctrl+Y)', () => doRedo()),
      h('div', { class: 'sep' }),
      tb(txt('N'), 'Negrita (Ctrl+B)', () => toggleFmt('b')),
      tb(txt('K', 'font-style:italic;font-family:serif'), 'Cursiva (Ctrl+I)', () => toggleFmt('i')),
      tb(txt('S', 'text-decoration:underline'), 'Subrayado (Ctrl+U)', () => toggleFmt('u')),
      tb(txt('ab', 'text-decoration:line-through;font-weight:500'), 'Tachado', () => toggleFmt('s')),
      pop(tb(txt('A', 'border-bottom:3px solid #e5484d;line-height:1'), 'Color del texto', () => {}), swatches(TEXT_COLORS, (c) => setFmt({ color: c === '#1f2328' ? undefined : c }))),
      pop(tb(icons.fill, 'Color de relleno', () => {}), swatches(FILL_COLORS, (c) => setFmt({ bg: c || undefined }))),
      h('div', { class: 'sep' }),
      tb(icons.alignLeft, 'Alinear a la izquierda', () => setFmt({ al: 'left' })),
      tb(icons.alignCenter, 'Centrar', () => setFmt({ al: 'center' })),
      tb(icons.alignRight, 'Alinear a la derecha', () => setFmt({ al: 'right' })),
      h('div', { class: 'sep' }),
      numSel,
      tb(txt('€'), 'Moneda', () => setFmt({ nf: 'currency' })),
      tb(txt('%'), 'Porcentaje', () => setFmt({ nf: 'percent' })),
      tb(txt('.0←', 'font-size:12px'), 'Menos decimales', () => changeDec(-1)),
      tb(txt('.00→', 'font-size:12px'), 'Más decimales', () => changeDec(1)),
      h('div', { class: 'sep' }),
      pop(
        tb(txt('+ Fila', 'font-size:13px'), 'Insertar filas', () => {}),
        h(
          'div',
          { class: 'menu-list' },
          h('button', { class: 'mi', onclick: () => insertRows(range().r1, range().r2 - range().r1 + 1) }, 'Insertar fila arriba'),
          h('button', { class: 'mi', onclick: () => insertRows(range().r2 + 1, range().r2 - range().r1 + 1) }, 'Insertar fila debajo'),
          h('button', { class: 'mi', onclick: () => insertCols(range().c1, range().c2 - range().c1 + 1) }, 'Insertar columna a la izquierda'),
          h('button', { class: 'mi', onclick: () => insertCols(range().c2 + 1, range().c2 - range().c1 + 1) }, 'Insertar columna a la derecha'),
        ),
      ),
      pop(
        tb(txt('− Fila', 'font-size:13px'), 'Eliminar filas o columnas', () => {}),
        h(
          'div',
          { class: 'menu-list' },
          h('button', { class: 'mi', onclick: () => deleteRows(range().r1, range().r2 - range().r1 + 1) }, 'Eliminar filas seleccionadas'),
          h('button', { class: 'mi', onclick: () => deleteCols(range().c1, range().c2 - range().c1 + 1) }, 'Eliminar columnas seleccionadas'),
        ),
      ),
      tb(txt('A→Z', 'font-size:12px'), 'Ordenar de menor a mayor', () => sortBy(true)),
      tb(txt('Z→A', 'font-size:12px'), 'Ordenar de mayor a menor', () => sortBy(false)),
      h('div', { class: 'sep' }),
      tb(icons.sigma, 'Autosuma', () => autoSum()),
      tb(txt('fx', 'font-style:italic;font-family:serif'), 'Insertar función', () => openFunctionPicker()),
      h('label', { class: 'ss-check', title: 'Primera fila como cabecera' }, headerCb, 'Cabecera'),
    );

    const formulaBar = h('div', { class: 'ss-fbar' }, nameBox, h('span', { class: 'ss-fx' }, 'fx'), h('div', { class: 'ss-bar-wrap' }, bar, ac, hint));

    const importBtn = h('button', { class: 'btn ghost', onclick: () => importFile() }, h('span', { html: icons.upload }), 'Importar');
    const exportWrap = pop(
      h('button', { class: 'btn ghost' }, h('span', { html: icons.download }), 'Exportar'),
      h(
        'div',
        { class: 'menu-list' },
        h('button', { class: 'mi', onclick: () => exportXlsx() }, 'Excel (.xlsx)'),
        h('button', { class: 'mi', onclick: () => exportCsv() }, 'CSV'),
      ),
    );

    const root = h(
      'div',
      { class: 'doc-root ss-root' + (ro ? ' ss-ro' : '') },
      h(
        'div',
        { class: 'doc-top' },
        h('button', { class: 'tb', title: 'Volver a la pizarra', html: icons.back, onclick: () => close() }),
        h('span', { class: 'doc-icon', html: icons.table }),
        h('b', { class: 'ss-title' }, 'Hoja de cálculo'),
        ro ? h('span', { class: 'ro-badge' }, 'Solo lectura') : saved,
        h('div', { class: 'grow' }),
        ro ? '' : importBtn,
        exportWrap,
        h('button', { class: 'btn primary', onclick: () => close() }, 'Hecho'),
      ),
      ro ? '' : toolbar,
      formulaBar,
      scroller,
      status,
    );

    // ------------------------------------------------------------ cálculo y pintado
    function recompute() {
      sheet = new Sheet({ get: raw, rows: R(), cols: C() });
      values = st.cells.map((row, r) => row.map((_, c) => sheet.value(r, c)));
    }

    /** Rejilla visible: los datos más un margen de filas y columnas vacías (solo crece). */
    function buildGrid() {
      GR = Math.max(GR, R() + 20, 40);
      GC = Math.max(GC, C() + 4, 12);
      rebuildExact();
    }
    function growTo(r: number, c: number) {
      if (r < GR - 5 && c < GC - 2) return;
      GR = Math.max(GR, r + 20);
      GC = Math.max(GC, c + 4);
      rebuildExact();
      paint();
    }

    function paint() {
      recompute();
      if (R() + 5 > GR || C() + 2 > GC) buildGrid();
      for (let r = 0; r < GR; r++) {
        for (let c = 0; c < GC; c++) {
          const td = tds[r][c];
          const inside = r < R() && c < C();
          const v = inside ? values[r][c] : null;
          const f = inside ? fmt(r, c) : {};
          const text = inside ? display(v, f, raw(r, c)) : '';
          if (td.textContent !== text) td.textContent = text;
          const al = alignOf(v, f);
          const cls = ['a-' + al];
          if (f.b || (st.header && r === 0 && inside)) cls.push('b');
          if (f.i) cls.push('i');
          if (f.u) cls.push('u');
          if (f.s) cls.push('s');
          if (isErr(v)) cls.push('err');
          if (st.header && r === 0) cls.push('hdr');
          if (!inside) cls.push('out');
          td.className = cls.join(' ');
          td.style.color = f.color ?? '';
          td.style.background = f.bg ?? '';
        }
      }
      paintSelection();
    }

    function cellRect(r: number, c: number) {
      const td = tds[r]?.[c];
      if (!td) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: td.offsetLeft, y: td.offsetTop, w: td.offsetWidth, h: td.offsetHeight };
    }
    function boxFor(rg: Range) {
      const a = cellRect(rg.r1, rg.c1);
      const b = cellRect(Math.min(rg.r2, GR - 1), Math.min(rg.c2, GC - 1));
      return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
    }
    const place = (el: HTMLElement, b: { x: number; y: number; w: number; h: number }) => {
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
      el.style.width = b.w + 'px';
      el.style.height = b.h + 'px';
    };

    function paintSelection() {
      const rg = range();
      place(selBox, boxFor(rg));
      selBox.classList.toggle('multi', rg.r1 !== rg.r2 || rg.c1 !== rg.c2);
      place(activeBox, cellRect(anchor.r, anchor.c));
      const b = boxFor(rg);
      fillHandle.style.left = b.x + b.w - 4 + 'px';
      fillHandle.style.top = b.y + b.h - 4 + 'px';
      fillHandle.classList.toggle('hidden', ro || !!editing);
      for (const th of table.querySelectorAll<HTMLElement>('.ss-ch')) {
        const c = +th.dataset.c!;
        th.classList.toggle('on', c >= rg.c1 && c <= rg.c2);
      }
      for (const th of table.querySelectorAll<HTMLElement>('.ss-rh')) {
        const r = +th.dataset.r!;
        th.classList.toggle('on', r >= rg.r1 && r <= rg.r2);
      }
      nameBox.value = rg.r1 === rg.r2 && rg.c1 === rg.c2 ? cellName(anchor.r, anchor.c) : `${cellName(rg.r1, rg.c1)}:${cellName(rg.r2, rg.c2)}`;
      if (!editing) bar.value = raw(anchor.r, anchor.c);
      const f = fmt(anchor.r, anchor.c);
      numSel.value = f.nf ?? 'general';
      paintStatus();
      paintRefs();
    }

    function paintStatus() {
      const rg = range();
      const nums: number[] = [];
      let count = 0;
      for (let r = rg.r1; r <= Math.min(rg.r2, R() - 1); r++)
        for (let c = rg.c1; c <= Math.min(rg.c2, C() - 1); c++) {
          const v = values[r]?.[c];
          if (v != null && v !== '') count++;
          if (typeof v === 'number') nums.push(v);
        }
      const f = (n: number) => display(n, { dec: Number.isInteger(n) ? undefined : 2 }, '');
      const multi = rg.r1 !== rg.r2 || rg.c1 !== rg.c2;
      status.replaceChildren(
        h('span', {}, `${R()} filas × ${C()} columnas`),
        h('div', { class: 'grow' }),
        ...(multi && count
          ? [
              h('span', {}, `Recuento: ${count}`),
              ...(nums.length
                ? [
                    h('span', {}, `Suma: ${f(nums.reduce((a, b) => a + b, 0))}`),
                    h('span', {}, `Promedio: ${f(nums.reduce((a, b) => a + b, 0) / nums.length)}`),
                    h('span', {}, `Mín: ${f(Math.min(...nums))}`),
                    h('span', {}, `Máx: ${f(Math.max(...nums))}`),
                  ]
                : []),
            ]
          : []),
      );
    }

    /** Recuadros de colores sobre las celdas que usa la fórmula que se está escribiendo. */
    function paintRefs() {
      const text = editing ? currentText() : '';
      const refs = editing ? formulaRefs(text) : [];
      refLayer.replaceChildren(
        ...refs.map((rf, i) => {
          const d = h('div', { class: 'ss-ref', style: `--rc:${REF_COLORS[i % REF_COLORS.length]}` });
          place(d, boxFor({ r1: rf.r1, c1: rf.c1, r2: Math.min(rf.r2, GR - 1), c2: Math.min(rf.c2, GC - 1) }));
          return d;
        }),
      );
    }

    function scrollIntoView(r: number, c: number) {
      const b = cellRect(r, c);
      const head = 30;
      const left = 46;
      if (b.y - head < scroller.scrollTop) scroller.scrollTop = b.y - head;
      else if (b.y + b.h > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = b.y + b.h - scroller.clientHeight;
      if (b.x - left < scroller.scrollLeft) scroller.scrollLeft = b.x - left;
      else if (b.x + b.w > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = b.x + b.w - scroller.clientWidth;
    }

    // ------------------------------------------------------------ cambios, deshacer y guardado en vivo
    let liveTimer: any = null;
    function emit() {
      saved.textContent = 'Guardando…';
      clearTimeout(liveTimer);
      liveTimer = setTimeout(flush, 400);
    }
    function flush() {
      clearTimeout(liveTimer);
      liveTimer = null;
      if (ro) return;
      const out = clone(st);
      base = clone(out);
      opts.onChange?.(out);
      saved.textContent = 'Guardado';
    }
    /** Aplica un cambio guardando antes el estado para deshacer. */
    function mutate(fn: () => void) {
      if (ro) return;
      const before = JSON.stringify(st);
      fn();
      if (JSON.stringify(st) === before) return;
      undo.push(before);
      if (undo.length > 150) undo.shift();
      redo.length = 0;
      paint();
      emit();
    }
    function restore(json: string) {
      st = JSON.parse(json);
      headerCb.checked = st.header;
      buildGrid();
      paint();
      emit();
    }
    function doUndo() {
      if (editing) return;
      const s = undo.pop();
      if (!s) return;
      redo.push(JSON.stringify(st));
      restore(s);
    }
    function doRedo() {
      if (editing) return;
      const s = redo.pop();
      if (!s) return;
      undo.push(JSON.stringify(st));
      restore(s);
    }

    /** Asegura que la hoja llega hasta (r, c). */
    function ensure(r: number, c: number) {
      while (st.cells.length <= r) st.cells.push(Array.from({ length: C() }, () => ''));
      if (c >= C()) {
        const n = c + 1;
        st.cells = st.cells.map((row) => [...row, ...Array.from({ length: n - row.length }, () => '')]);
        while (st.colW.length < n) st.colW.push(1);
      }
    }
    function setRaw(r: number, c: number, v: string) {
      if (v === raw(r, c)) return;
      ensure(r, c);
      st.cells[r][c] = v;
    }

    // ------------------------------------------------------------ cambios remotos (mezcla por celda)
    const unsub = opts.subscribe?.((remote) => {
      const theirs: SheetState = { cells: remote.cells.map((r) => [...r]), fmt: { ...(remote.fmt ?? {}) }, colW: [...(remote.colW ?? [])], header: remote.header };
      if (same(theirs, base)) return;
      if (same(st, base)) {
        // no tengo cambios pendientes: se adopta tal cual (incluidas filas o columnas borradas)
        base = theirs;
        st = clone(theirs);
        headerCb.checked = st.header;
        if (editing) ensure(editing.r, editing.c);
        buildGrid();
        paint();
        return;
      }
      // celdas que he cambiado yo (respecto a la última versión común)
      let myR = 0;
      let myC = 0;
      for (let r = 0; r < st.cells.length; r++)
        for (let c = 0; c < C(); c++)
          if ((st.cells[r]?.[c] ?? '') !== (base.cells[r]?.[c] ?? '')) {
            myR = Math.max(myR, r + 1);
            myC = Math.max(myC, c + 1);
          }
      const R2 = Math.max(theirs.cells.length, myR, 1);
      const C2 = Math.max(Math.max(1, ...theirs.cells.map((r) => r.length)), myC);
      const merged: string[][] = [];
      for (let r = 0; r < R2; r++) {
        const row: string[] = [];
        for (let c = 0; c < C2; c++) {
          const mine = st.cells[r]?.[c] ?? '';
          const b = base.cells[r]?.[c] ?? '';
          const th = theirs.cells[r]?.[c] ?? '';
          row.push(mine === b ? th : mine); // lo que yo no he tocado se actualiza; lo mío se conserva
        }
        merged.push(row);
      }
      const fmtKeys = new Set([...Object.keys(st.fmt), ...Object.keys(base.fmt), ...Object.keys(theirs.fmt)]);
      const mf: Record<string, CellFmt> = {};
      for (const k of fmtKeys) {
        const mine = JSON.stringify(st.fmt[k] ?? null);
        const pick = mine === JSON.stringify(base.fmt[k] ?? null) ? theirs.fmt[k] : st.fmt[k];
        if (pick) mf[k] = pick;
      }
      const colW = Array.from({ length: C2 }, (_, i) => ((st.colW[i] ?? 1) === (base.colW[i] ?? 1) ? (theirs.colW[i] ?? 1) : st.colW[i] ?? 1));
      const header = st.header === base.header ? theirs.header : st.header;
      const mergedState: SheetState = { cells: merged, fmt: mf, colW, header };
      base = theirs;
      st = mergedState;
      headerCb.checked = st.header;
      if (editing && (editing.r >= R() || editing.c >= C())) ensure(editing.r, editing.c);
      paint();
      if (!same(st, theirs)) emit(); // había cambios míos sin enviar
    });

    // ------------------------------------------------------------ formato
    function eachCell(fn: (r: number, c: number) => void) {
      const rg = range();
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) fn(r, c);
    }
    function setFmt(p: Partial<CellFmt>) {
      mutate(() => {
        const rg = range();
        ensure(rg.r2, rg.c2);
        eachCell((r, c) => {
          const k = fmtKey(r, c);
          const nf: CellFmt = { ...(st.fmt[k] ?? {}), ...p };
          for (const key of Object.keys(nf) as (keyof CellFmt)[]) if (nf[key] === undefined || nf[key] === false || (key === 'nf' && nf.nf === 'general')) delete nf[key];
          if (Object.keys(nf).length) st.fmt[k] = nf;
          else delete st.fmt[k];
        });
      });
    }
    function toggleFmt(k: 'b' | 'i' | 'u' | 's') {
      const on = !fmt(anchor.r, anchor.c)[k];
      setFmt({ [k]: on || undefined });
    }
    function changeDec(d: number) {
      const f = fmt(anchor.r, anchor.c);
      const v = values[anchor.r]?.[anchor.c];
      let cur = f.dec;
      if (cur == null) {
        if (f.nf === 'number' || f.nf === 'currency') cur = 2;
        else if (typeof v === 'number') cur = (String(v).split('.')[1] ?? '').length;
        else cur = 0;
      }
      setFmt({ dec: Math.max(0, Math.min(10, cur + d)), nf: f.nf ?? (typeof v === 'number' ? 'number' : undefined) });
    }

    // ------------------------------------------------------------ edición de celdas
    const currentText = () => (editing?.src === 'bar' ? bar.value : cellEdit.value);

    function startEdit(initial?: string, src: 'cell' | 'bar' = 'cell') {
      if (ro) return;
      const r = anchor.r;
      const c = anchor.c;
      sel = { ...anchor }; // la celda activa es el ancla, como en Excel
      editing = { r, c, src, orig: raw(r, c) };
      const text = initial ?? raw(r, c);
      cellEdit.value = text;
      bar.value = text;
      pointRef = null;
      const b = cellRect(r, c);
      const f = fmt(r, c);
      cellEdit.style.left = b.x + 'px';
      cellEdit.style.top = b.y + 'px';
      cellEdit.style.minWidth = b.w + 'px';
      cellEdit.style.height = b.h + 'px';
      cellEdit.style.fontWeight = f.b || (st.header && r === 0) ? '650' : '';
      cellEdit.style.fontStyle = f.i ? 'italic' : '';
      cellEdit.style.textAlign = f.al ?? 'left';
      cellEdit.classList.remove('hidden');
      sizeEditor();
      paintSelection();
      if (src === 'cell') {
        cellEdit.focus();
        cellEdit.setSelectionRange(cellEdit.value.length, cellEdit.value.length);
      }
      updateAssist();
    }
    function sizeEditor() {
      cellEdit.style.width = '0px';
      cellEdit.style.width = Math.max(parseFloat(cellEdit.style.minWidth) || 0, cellEdit.scrollWidth + 12) + 'px';
    }
    function commitEdit(move?: [number, number]) {
      if (!editing) return;
      let v = currentText();
      // cierra paréntesis que falten, como Excel
      if (v.startsWith('=')) {
        const open = (v.match(/\(/g) ?? []).length - (v.match(/\)/g) ?? []).length;
        if (open > 0 && (v.match(/"/g) ?? []).length % 2 === 0) v += ')'.repeat(open);
      }
      const { r, c } = editing;
      editing = null;
      pointRef = null;
      cellEdit.classList.add('hidden');
      hideAssist();
      mutate(() => {
        setRaw(r, c, v);
        // una fórmula de fecha u hora recibe ese formato si la celda no tenía ninguno, como en Excel
        const k = fmtKey(r, c);
        if (!st.fmt[k]?.nf && v.startsWith('=')) {
          const nf = /^=\s*(AHORA|NOW)\s*\(/i.test(v)
            ? 'datetime'
            : /^=\s*(NSHORA|TIME)\s*\(/i.test(v)
              ? 'time'
              : /^=\s*(FECHA|DATE|HOY|TODAY|FECHA\.MES|EDATE|FIN\.MES|EOMONTH|DIA\.LAB|WORKDAY)\s*\(/i.test(v)
                ? 'date'
                : null;
          if (nf) st.fmt[k] = { ...(st.fmt[k] ?? {}), nf };
        }
      });
      if (move) moveSel(move[0], move[1], false);
      else paintSelection();
      scroller.focus({ preventScroll: true });
    }
    function cancelEdit() {
      if (!editing) return;
      editing = null;
      pointRef = null;
      cellEdit.classList.add('hidden');
      hideAssist();
      paintSelection();
      scroller.focus({ preventScroll: true });
    }

    function syncFromCell() {
      bar.value = cellEdit.value;
      sizeEditor();
      pointRef = null;
      updateAssist();
      paintRefs();
    }
    function syncFromBar() {
      cellEdit.value = bar.value;
      sizeEditor();
      pointRef = null;
      updateAssist();
      paintRefs();
    }
    cellEdit.addEventListener('input', syncFromCell);
    bar.addEventListener('input', () => {
      if (!editing) startEdit(bar.value, 'bar');
      syncFromBar();
    });
    bar.addEventListener('focus', () => {
      if (ro) return bar.blur();
      if (!editing) startEdit(undefined, 'bar');
      else if (editing.src === 'cell') editing.src = 'bar';
    });
    cellEdit.addEventListener('focus', () => editing && (editing.src = 'cell'));

    // ¿Se puede insertar una referencia con el ratón en la posición del cursor?
    function canPoint(): boolean {
      if (!editing) return false;
      const el = editing.src === 'bar' ? bar : cellEdit;
      const text = el.value;
      if (!text.startsWith('=')) return false;
      const pos = el.selectionStart ?? text.length;
      if (pointRef && pos === pointRef.e) return true;
      const before = text.slice(0, pos).trimEnd();
      return /[=(;,+\-*/^&<>:]$/.test(before);
    }
    function insertRef(ref: string) {
      if (!editing) return;
      const el = editing.src === 'bar' ? bar : cellEdit;
      let text = el.value;
      let pos = el.selectionStart ?? text.length;
      if (pointRef && pos === pointRef.e) {
        text = text.slice(0, pointRef.s) + text.slice(pointRef.e);
        pos = pointRef.s;
      }
      el.value = text.slice(0, pos) + ref + text.slice(pos);
      pointRef = { s: pos, e: pos + ref.length };
      el.setSelectionRange(pointRef.e, pointRef.e);
      if (el === bar) cellEdit.value = bar.value;
      else bar.value = cellEdit.value;
      const keep = pointRef;
      sizeEditor();
      updateAssist();
      pointRef = keep;
      paintRefs();
      el.focus();
    }

    // ------------------------------------------------------------ autocompletado y ayuda de funciones
    const FUNCS = functionList();
    let acItems: typeof FUNCS = [];
    let acIndex = 0;
    function updateAssist() {
      if (!editing) return hideAssist();
      const el = editing.src === 'bar' ? bar : cellEdit;
      const text = el.value;
      const pos = el.selectionStart ?? text.length;
      if (!text.startsWith('=')) return hideAssist();
      const before = text.slice(0, pos);
      const m = /(?:^=|[=(;,+\-*/^&<>\s])([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ.]*)$/.exec(before);
      if (m && !/^[A-Za-z]{1,3}\d+$/.test(m[1])) {
        const q = m[1].toUpperCase();
        const nq = q.normalize('NFD').replace(/[̀-ͯ]/g, '');
        acItems = FUNCS.filter((f) => f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(nq)).slice(0, 8);
        acIndex = 0;
        if (acItems.length) {
          ac.replaceChildren(
            ...acItems.map((f, i) =>
              h(
                'div',
                { class: 'ss-ac-item' + (i === 0 ? ' on' : ''), onmousedown: (e: Event) => (e.preventDefault(), acceptAc(i)) },
                h('b', {}, f.name),
                h('span', {}, f.desc),
              ),
            ),
          );
          positionAssist(ac);
          ac.classList.remove('hidden');
        } else ac.classList.add('hidden');
      } else ac.classList.add('hidden');
      // función en la que está el cursor → sintaxis
      let depth = 0;
      let fname = '';
      for (let i = before.length - 1; i >= 0; i--) {
        const ch = before[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
          if (depth === 0) {
            fname = /([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ.]*)$/.exec(before.slice(0, i))?.[1] ?? '';
            break;
          }
          depth--;
        }
      }
      const info = fname && FUNCS.find((f) => f.name === fname.toUpperCase());
      if (info) {
        hint.replaceChildren(h('b', {}, info.syntax), h('span', {}, ' — ' + info.desc));
        positionAssist(hint);
        hint.classList.remove('hidden');
      } else hint.classList.add('hidden');
    }
    function positionAssist(el: HTMLElement) {
      if (editing?.src === 'bar') {
        el.style.left = '0px';
        el.style.top = '100%';
        el.style.position = 'absolute';
        formulaBar.querySelector('.ss-bar-wrap')!.append(el);
      } else {
        const b = cellRect(editing!.r, editing!.c);
        el.style.position = 'absolute';
        el.style.left = b.x + 'px';
        el.style.top = b.y + b.h + 2 + (el === hint && !ac.classList.contains('hidden') ? ac.offsetHeight + 4 : 0) + 'px';
        inner.append(el);
      }
    }
    function hideAssist() {
      ac.classList.add('hidden');
      hint.classList.add('hidden');
    }
    function acceptAc(i: number) {
      const f = acItems[i];
      if (!f || !editing) return;
      const el = editing.src === 'bar' ? bar : cellEdit;
      const text = el.value;
      const pos = el.selectionStart ?? text.length;
      const m = /([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ.]*)$/.exec(text.slice(0, pos))!;
      const start = pos - m[1].length;
      el.value = text.slice(0, start) + f.name + '(' + text.slice(pos);
      const np = start + f.name.length + 1;
      el.setSelectionRange(np, np);
      if (el === bar) cellEdit.value = bar.value;
      else bar.value = cellEdit.value;
      ac.classList.add('hidden');
      updateAssist();
      paintRefs();
    }
    function acKey(e: KeyboardEvent): boolean {
      if (ac.classList.contains('hidden') || !acItems.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
        [...ac.children].forEach((c, i) => c.classList.toggle('on', i === acIndex));
        return true;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        acceptAc(acIndex);
        return true;
      }
      if (e.key === 'Escape') {
        ac.classList.add('hidden');
        return true;
      }
      return false;
    }

    function openFunctionPicker() {
      const q = h('input', { type: 'text', placeholder: 'Buscar función (p.ej. suma, buscar, fecha)…' }) as HTMLInputElement;
      const list = h('div', { class: 'ss-fn-list' });
      const cats = [...new Set(FUNCS.map((f) => f.cat))];
      let cat = '';
      const catSel = h('select', { onchange: () => ((cat = catSel.value), render()) }, h('option', { value: '' }, 'Todas las categorías'), ...cats.map((c) => h('option', { value: c }, c))) as HTMLSelectElement;
      const render = () => {
        const s = q.value.trim().toLowerCase();
        list.replaceChildren(
          ...FUNCS.filter((f) => (!cat || f.cat === cat) && (!s || f.name.toLowerCase().includes(s) || f.desc.toLowerCase().includes(s))).map((f) =>
            h(
              'button',
              {
                class: 'ss-fn',
                onclick: () => {
                  bg.remove();
                  const cur = raw(anchor.r, anchor.c);
                  if (editing) {
                    insertAtCaret(f.name + '(');
                  } else startEdit(cur.startsWith('=') ? cur + '+' + f.name + '(' : '=' + f.name + '(');
                },
              },
              h('b', {}, f.syntax),
              h('span', {}, f.desc),
            ),
          ),
        );
      };
      q.addEventListener('input', render);
      q.addEventListener('keydown', (e) => e.stopPropagation());
      const bg = h(
        'div',
        { class: 'modal-bg', onclick: (e: Event) => e.target === bg && bg.remove() },
        h('div', { class: 'modal wide' }, h('h2', {}, 'Insertar función'), h('div', { class: 'row' }, q, catSel), list, h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => bg.remove() }, 'Cerrar'))),
      );
      document.body.append(bg);
      render();
      q.focus();
    }
    function insertAtCaret(s: string) {
      if (!editing) return;
      const el = editing.src === 'bar' ? bar : cellEdit;
      const pos = el.selectionStart ?? el.value.length;
      el.value = el.value.slice(0, pos) + s + el.value.slice(el.selectionEnd ?? pos);
      el.setSelectionRange(pos + s.length, pos + s.length);
      if (el === bar) cellEdit.value = bar.value;
      else bar.value = cellEdit.value;
      el.focus();
      updateAssist();
      paintRefs();
    }

    // ------------------------------------------------------------ selección y teclado
    function moveSel(dr: number, dc: number, extend: boolean) {
      sel = { r: Math.max(0, sel.r + dr), c: Math.max(0, sel.c + dc) };
      if (!extend) anchor = { ...sel };
      growTo(sel.r, sel.c);
      paintSelection();
      scrollIntoView(sel.r, sel.c);
    }
    function rebuildExact() {
      const gr = GR;
      const gc = GC;
      const colgroup = h('colgroup', {}, h('col', { style: 'width:46px' }), ...Array.from({ length: gc }, (_, c) => h('col', { style: `width:${Math.round(BASE_COL * (st.colW[c] ?? 1))}px` })));
      const head = h(
        'tr',
        {},
        h('th', { class: 'ss-corner', title: 'Seleccionar todo', onmousedown: (e: MouseEvent) => (e.preventDefault(), selectAll()) }),
        ...Array.from({ length: gc }, (_, c) => h('th', { class: 'ss-ch', 'data-c': c }, colName(c), ro ? '' : h('span', { class: 'ss-resize', 'data-c': c }))),
      );
      tds = [];
      const body = h('tbody');
      for (let r = 0; r < gr; r++) {
        const tr = h('tr', { style: `height:${ROW_H}px` }, h('th', { class: 'ss-rh', 'data-r': r }, String(r + 1)));
        const row: HTMLTableCellElement[] = [];
        for (let c = 0; c < gc; c++) {
          const td = h('td', { 'data-r': r, 'data-c': c });
          row.push(td);
          tr.append(td);
        }
        tds.push(row);
        body.append(tr);
      }
      table.replaceChildren(colgroup, h('thead', {}, head), body);
    }
    function selectAll() {
      if (editing) commitEdit();
      anchor = { r: 0, c: 0 };
      sel = { r: Math.max(0, R() - 1), c: Math.max(0, C() - 1) };
      paintSelection();
    }
    /** Ctrl+flecha: salta al borde del bloque de datos. */
    function jump(dr: number, dc: number) {
      let { r, c } = sel;
      const filled = (r: number, c: number) => raw(r, c) !== '';
      const startFilled = filled(r, c);
      const nextFilled = filled(r + dr, c + dc);
      if (startFilled && nextFilled) {
        while (r + dr >= 0 && c + dc >= 0 && r + dr < R() && c + dc < C() && filled(r + dr, c + dc)) (r += dr), (c += dc);
      } else {
        r += dr;
        c += dc;
        while (r >= 0 && c >= 0 && r < R() && c < C() && !filled(r, c)) (r += dr), (c += dc);
        if (r < 0 || c < 0 || r >= R() || c >= C()) {
          r = dr < 0 ? 0 : dr > 0 ? Math.max(0, R() - 1) : sel.r;
          c = dc < 0 ? 0 : dc > 0 ? Math.max(0, C() - 1) : sel.c;
        }
      }
      return { r: Math.max(0, r), c: Math.max(0, c) };
    }

    function onKey(e: KeyboardEvent) {
      if (!root.isConnected) return;
      const target = e.target as HTMLElement;
      if (target.closest('.modal-bg')) return; // un diálogo encima
      const mod = e.ctrlKey || e.metaKey;
      if (target === nameBox) {
        if (e.key === 'Enter') {
          e.preventDefault();
          goTo(nameBox.value);
        } else if (e.key === 'Escape') paintSelection();
        e.stopPropagation();
        return;
      }
      if (editing) {
        e.stopPropagation();
        if (acKey(e)) return void e.preventDefault();
        if (e.key === 'Enter' && e.altKey) {
          // salto de línea dentro de la celda
          e.preventDefault();
          insertAtCaret('\n');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit([e.shiftKey ? -1 : 1, 0]);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commitEdit([0, e.shiftKey ? -1 : 1]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        } else if (e.key === 'F4') {
          // alterna $ en la referencia bajo el cursor
          e.preventDefault();
          toggleAbsolute();
        } else if (editing.src === 'cell' && !cellEdit.value.startsWith('=') && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          commitEdit([e.key === 'ArrowUp' ? -1 : 1, 0]);
        }
        return;
      }
      if (target === bar || target.tagName === 'SELECT' || (target.tagName === 'INPUT' && target !== bar)) return;
      e.stopPropagation();
      const k = e.key;
      if (mod && k.toLowerCase() === 'z') return void (e.preventDefault(), e.shiftKey ? doRedo() : doUndo());
      if (mod && k.toLowerCase() === 'y') return void (e.preventDefault(), doRedo());
      if (mod && k.toLowerCase() === 'a') return void (e.preventDefault(), selectAll());
      if (mod && k.toLowerCase() === 'b') return void (e.preventDefault(), toggleFmt('b'));
      if (mod && k.toLowerCase() === 'i') return void (e.preventDefault(), toggleFmt('i'));
      if (mod && k.toLowerCase() === 'u') return void (e.preventDefault(), toggleFmt('u'));
      if (mod && k.toLowerCase() === 'd') return void (e.preventDefault(), fillDownRight('down'));
      if (mod && k.toLowerCase() === 'r') return void (e.preventDefault(), fillDownRight('right'));
      if (mod && (k === 'c' || k === 'x' || k === 'v' || k === 'C' || k === 'X' || k === 'V')) return; // los gestionan copy/cut/paste
      const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[k]) {
        e.preventDefault();
        const [dr, dc] = arrows[k];
        if (mod) {
          const p = jump(dr, dc);
          if (e.shiftKey) sel = p;
          else sel = anchor = p;
          paintSelection();
          scrollIntoView(sel.r, sel.c);
        } else moveSel(dr, dc, e.shiftKey);
        return;
      }
      if (k === 'Tab') return void (e.preventDefault(), moveSel(0, e.shiftKey ? -1 : 1, false));
      if (k === 'Enter') return void (e.preventDefault(), e.shiftKey ? moveSel(-1, 0, false) : moveSel(1, 0, false));
      if (k === 'Home') {
        e.preventDefault();
        sel = anchor = mod ? { r: 0, c: 0 } : { r: sel.r, c: 0 };
        paintSelection();
        scrollIntoView(sel.r, sel.c);
        return;
      }
      if (k === 'End' && mod) {
        e.preventDefault();
        sel = anchor = { r: Math.max(0, R() - 1), c: Math.max(0, C() - 1) };
        paintSelection();
        scrollIntoView(sel.r, sel.c);
        return;
      }
      if (k === 'PageDown' || k === 'PageUp') {
        e.preventDefault();
        moveSel((k === 'PageDown' ? 1 : -1) * Math.floor(scroller.clientHeight / ROW_H), 0, e.shiftKey);
        return;
      }
      if (k === 'Escape') {
        e.preventDefault();
        if (clip?.cut) clip = null;
        close();
        return;
      }
      if (ro) return;
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        mutate(() => eachCell((r, c) => r < R() && c < C() && setRaw(r, c, '')));
        return;
      }
      if (k === 'F2') return void (e.preventDefault(), startEdit());
      if (k.length === 1 && !mod && !e.altKey) {
        e.preventDefault();
        startEdit(k);
      }
    }

    function goTo(ref: string) {
      const parts = ref.trim().toUpperCase().split(':');
      const a = parseCellName(parts[0] ?? '');
      if (!a) return toast('Escribe una celda como B7 o un rango como A1:C5');
      const b = parts[1] ? parseCellName(parts[1]) : a;
      if (!b) return;
      anchor = { r: a[0], c: a[1] };
      sel = { r: b[0], c: b[1] };
      growTo(sel.r, sel.c);
      paintSelection();
      scrollIntoView(sel.r, sel.c);
      scroller.focus({ preventScroll: true });
    }

    function toggleAbsolute() {
      if (!editing) return;
      const el = editing.src === 'bar' ? bar : cellEdit;
      const text = el.value;
      const pos = el.selectionStart ?? text.length;
      const refs = formulaRefs(text);
      // referencia (o rango) bajo el cursor
      const re = /\$?[A-Za-z]{1,3}\$?\d+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = m.index;
        const e2 = s + m[0].length;
        if (pos >= s && pos <= e2 && refs.some((rf) => s >= rf.s && e2 <= rf.e)) {
          const p = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(m[0])!;
          const state = (p[1] ? 2 : 0) + (p[3] ? 1 : 0); // A1 → $A$1 → A$1 → $A1 → A1
          const next = { 0: '$C$R', 3: 'C$R', 1: '$CR', 2: 'CR' }[state as 0 | 1 | 2 | 3]!;
          const rep = next.replace('C', p[2]).replace('R', p[4]);
          el.value = text.slice(0, s) + rep + text.slice(e2);
          el.setSelectionRange(s + rep.length, s + rep.length);
          if (el === bar) cellEdit.value = bar.value;
          else bar.value = cellEdit.value;
          paintRefs();
          return;
        }
      }
    }

    // ------------------------------------------------------------ ratón
    type Drag = { t: 'sel' } | { t: 'point'; start: Pos } | { t: 'fill'; src: Range; to: Range | null } | { t: 'col'; c: number; x0: number; w0: number } | { t: 'rows' } | { t: 'cols' };
    let drag: Drag | null = null;
    const cellAt = (e: MouseEvent): Pos | null => {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('td');
      if (!el || !table.contains(el)) return null;
      return { r: +el.dataset.r!, c: +el.dataset.c! };
    };
    let lastTap = { t: 0, r: -1, c: -1 };

    inner.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      const t = e.target as HTMLElement;
      if (t === cellEdit) return;
      if (t.classList.contains('ss-resize')) {
        const c = +t.dataset.c!;
        drag = { t: 'col', c, x0: e.clientX, w0: st.colW[c] ?? 1 };
        e.preventDefault();
        return;
      }
      if (t === fillHandle) {
        if (editing) commitEdit();
        drag = { t: 'fill', src: range(), to: null };
        e.preventDefault();
        return;
      }
      const ch = t.closest('.ss-ch') as HTMLElement | null;
      if (ch) {
        if (editing) commitEdit();
        const c = +ch.dataset.c!;
        if (e.shiftKey) sel = { r: Math.max(R() - 1, 0), c };
        else {
          anchor = { r: 0, c };
          sel = { r: Math.max(R() - 1, 0), c };
        }
        drag = { t: 'cols' };
        paintSelection();
        e.preventDefault();
        return;
      }
      const rh = t.closest('.ss-rh') as HTMLElement | null;
      if (rh) {
        if (editing) commitEdit();
        const r = +rh.dataset.r!;
        if (e.shiftKey) sel = { r, c: Math.max(C() - 1, 0) };
        else {
          anchor = { r, c: 0 };
          sel = { r, c: Math.max(C() - 1, 0) };
        }
        drag = { t: 'rows' };
        paintSelection();
        e.preventDefault();
        return;
      }
      const p = cellAt(e);
      if (!p) return;
      e.preventDefault();
      if (editing && canPoint()) {
        drag = { t: 'point', start: p };
        insertRef(cellName(p.r, p.c));
        return;
      }
      if (editing) commitEdit();
      const now = Date.now();
      const dbl = now - lastTap.t < 400 && lastTap.r === p.r && lastTap.c === p.c;
      lastTap = { t: now, r: p.r, c: p.c };
      if (e.shiftKey) sel = p;
      else sel = anchor = p;
      drag = { t: 'sel' };
      paintSelection();
      scroller.focus({ preventScroll: true });
      if (dbl && !ro) {
        drag = null;
        startEdit();
      }
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    function onMove(e: PointerEvent) {
      if (!drag) return;
      if (drag.t === 'col') {
        const w = Math.max(0.3, drag.w0 + (e.clientX - drag.x0) / BASE_COL);
        ensure(0, drag.c);
        st.colW[drag.c] = Math.round(w * 100) / 100;
        const col = table.querySelectorAll('col')[drag.c + 1] as HTMLElement | undefined;
        if (col) col.style.width = Math.round(BASE_COL * w) + 'px';
        paintSelection();
        return;
      }
      const p = cellAt(e);
      if (!p) return;
      if (drag.t === 'sel') {
        if (p.r !== sel.r || p.c !== sel.c) {
          sel = p;
          paintSelection();
        }
      } else if (drag.t === 'rows') {
        sel = { r: p.r, c: Math.max(C() - 1, 0) };
        paintSelection();
      } else if (drag.t === 'cols') {
        sel = { r: Math.max(R() - 1, 0), c: p.c };
        paintSelection();
      } else if (drag.t === 'point') {
        const a = drag.start;
        const ref = a.r === p.r && a.c === p.c ? cellName(a.r, a.c) : `${cellName(Math.min(a.r, p.r), Math.min(a.c, p.c))}:${cellName(Math.max(a.r, p.r), Math.max(a.c, p.c))}`;
        insertRef(ref);
      } else if (drag.t === 'fill') {
        const s = drag.src;
        let to: Range | null = null;
        const down = p.r - s.r2;
        const up = s.r1 - p.r;
        const right = p.c - s.c2;
        const left = s.c1 - p.c;
        const best = Math.max(down, up, right, left);
        if (best > 0) {
          if (best === down) to = { ...s, r2: p.r };
          else if (best === up) to = { ...s, r1: p.r };
          else if (best === right) to = { ...s, c2: p.c };
          else to = { ...s, c1: p.c };
        }
        drag.to = to;
        fillPreview.classList.toggle('hidden', !to);
        if (to) place(fillPreview, boxFor(to));
      }
    }
    function onUp() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.t === 'col') {
        const w = st.colW[d.c];
        st.colW[d.c] = d.w0;
        mutate(() => (st.colW[d.c] = w));
      } else if (d.t === 'fill') {
        fillPreview.classList.add('hidden');
        if (d.to) fillRange(d.src, d.to);
      }
    }
    inner.addEventListener('dblclick', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('ss-resize')) {
        // doble clic en el borde: ancho automático
        const c = +t.dataset.c!;
        let max = 40;
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = '14px system-ui';
        for (let r = 0; r < R(); r++) max = Math.max(max, ctx.measureText(tds[r]?.[c]?.textContent ?? '').width + 20);
        mutate(() => {
          ensure(0, c);
          st.colW[c] = Math.round((max / BASE_COL) * 100) / 100;
        });
        buildGrid();
        paint();
      }
    });

    // menú contextual
    inner.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = cellAt(e);
      if (p) {
        const rg = range();
        if (p.r < rg.r1 || p.r > rg.r2 || p.c < rg.c1 || p.c > rg.c2) {
          if (editing) commitEdit();
          sel = anchor = p;
          paintSelection();
        }
      }
      showContext(e.clientX, e.clientY);
    });
    function showContext(x: number, y: number) {
      document.querySelector('.ss-ctx')?.remove();
      const rg = range();
      const nr = rg.r2 - rg.r1 + 1;
      const nc = rg.c2 - rg.c1 + 1;
      const it = (label: string, fn: () => void, disabled = false) =>
        h('button', { class: 'mi', disabled, onclick: () => (menu.remove(), fn()) }, label);
      const menu = h(
        'div',
        { class: 'ss-ctx menu-list' },
        it('Copiar', () => copySel(false)),
        ro ? '' : it('Cortar', () => copySel(true)),
        ro ? '' : it('Pegar', () => pasteFromClipboardApi()),
        ...(ro
          ? []
          : [
              h('div', { class: 'mi-sep' }),
              it(`Insertar ${nr > 1 ? nr + ' filas' : 'fila'} arriba`, () => insertRows(rg.r1, nr)),
              it(`Insertar ${nr > 1 ? nr + ' filas' : 'fila'} debajo`, () => insertRows(rg.r2 + 1, nr)),
              it(`Insertar ${nc > 1 ? nc + ' columnas' : 'columna'} a la izquierda`, () => insertCols(rg.c1, nc)),
              it(`Insertar ${nc > 1 ? nc + ' columnas' : 'columna'} a la derecha`, () => insertCols(rg.c2 + 1, nc)),
              h('div', { class: 'mi-sep' }),
              it(`Eliminar ${nr > 1 ? nr + ' filas' : 'fila'}`, () => deleteRows(rg.r1, nr), rg.r1 >= R()),
              it(`Eliminar ${nc > 1 ? nc + ' columnas' : 'columna'}`, () => deleteCols(rg.c1, nc), rg.c1 >= C()),
              it('Borrar contenido', () => mutate(() => eachCell((r, c) => r < R() && c < C() && setRaw(r, c, '')))),
              it('Borrar formato', () =>
                mutate(() =>
                  eachCell((r, c) => {
                    delete st.fmt[fmtKey(r, c)];
                  }),
                ),
              ),
              h('div', { class: 'mi-sep' }),
              it('Ordenar de menor a mayor', () => sortBy(true)),
              it('Ordenar de mayor a menor', () => sortBy(false)),
            ]),
      );
      menu.style.left = Math.min(x, window.innerWidth - 260) + 'px';
      menu.style.top = Math.min(y, window.innerHeight - 420) + 'px';
      document.body.append(menu);
      const off = (ev: Event) => {
        if (!menu.contains(ev.target as Node)) {
          menu.remove();
          window.removeEventListener('pointerdown', off, true);
        }
      };
      setTimeout(() => window.addEventListener('pointerdown', off, true));
    }

    // ------------------------------------------------------------ relleno (controlador y Ctrl+D / Ctrl+R)
    function seriesOf(src: string[]): ((i: number) => string) | null {
      // números: progresión aritmética
      const nums = src.map((s) => (s.startsWith('=') ? NaN : Number(String(s).replace(',', '.'))));
      if (src.length >= 2 && nums.every((n) => !isNaN(n) && src.every((s) => s.trim() !== ''))) {
        const step = nums[nums.length - 1] - nums[nums.length - 2];
        const last = nums[nums.length - 1];
        return (i) => String(Math.round((last + step * (i + 1)) * 1e10) / 1e10).replace('.', ',');
      }
      if (src.length !== 1 && src.length !== 2) return null;
      const s0 = src[src.length - 1];
      // días y meses
      for (const list of [DAYS, DAYS3, MONTHS, MONTHS3]) {
        const idx = list.indexOf(s0.toLowerCase());
        if (idx >= 0) {
          const cap = s0[0] === s0[0].toUpperCase();
          return (i) => {
            const w = list[(idx + i + 1) % list.length];
            return cap ? w[0].toUpperCase() + w.slice(1) : w;
          };
        }
      }
      // texto acabado en número: "Semana 1" → "Semana 2"
      const m = /^(.*?)(\d+)$/.exec(s0);
      if (m && m[1] && !s0.startsWith('=')) return (i) => m[1] + String(+m[2] + i + 1);
      return null;
    }
    function fillRange(src: Range, to: Range) {
      mutate(() => {
        ensure(Math.max(to.r2, src.r2), Math.max(to.c2, src.c2));
        const vertical = to.r1 !== src.r1 || to.r2 !== src.r2;
        const forward = vertical ? to.r2 > src.r2 : to.c2 > src.c2;
        if (vertical) {
          const n = src.r2 - src.r1 + 1;
          for (let c = src.c1; c <= src.c2; c++) {
            const col = Array.from({ length: n }, (_, i) => raw(src.r1 + i, c));
            const ser = forward ? seriesOf(col) : null;
            const targets = forward ? range_(src.r2 + 1, to.r2) : range_(to.r1, src.r1 - 1).reverse();
            targets.forEach((r, i) => {
              const k = forward ? i % n : n - 1 - (i % n);
              const from = src.r1 + k;
              const v = col[k];
              setRaw(r, c, ser ? ser(i) : v.startsWith('=') ? shiftFormula(v, r - from, 0) : v);
              copyFmt(from, c, r, c);
            });
          }
        } else {
          const n = src.c2 - src.c1 + 1;
          for (let r = src.r1; r <= src.r2; r++) {
            const row = Array.from({ length: n }, (_, i) => raw(r, src.c1 + i));
            const ser = forward ? seriesOf(row) : null;
            const targets = forward ? range_(src.c2 + 1, to.c2) : range_(to.c1, src.c1 - 1).reverse();
            targets.forEach((c, i) => {
              const k = forward ? i % n : n - 1 - (i % n);
              const from = src.c1 + k;
              const v = row[k];
              setRaw(r, c, ser ? ser(i) : v.startsWith('=') ? shiftFormula(v, 0, c - from) : v);
              copyFmt(r, from, r, c);
            });
          }
        }
        anchor = { r: to.r1, c: to.c1 };
        sel = { r: to.r2, c: to.c2 };
      });
    }
    const range_ = (a: number, b: number) => (b < a ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i));
    function copyFmt(r0: number, c0: number, r1: number, c1: number) {
      const f = st.fmt[fmtKey(r0, c0)];
      if (f) st.fmt[fmtKey(r1, c1)] = { ...f };
      else delete st.fmt[fmtKey(r1, c1)];
    }
    function fillDownRight(dir: 'down' | 'right') {
      const rg = range();
      if (dir === 'down') {
        if (rg.r1 === rg.r2) {
          if (rg.r1 === 0) return;
          fillRange({ ...rg, r1: rg.r1 - 1, r2: rg.r1 - 1 }, { ...rg, r1: rg.r1 - 1 });
        } else fillRange({ ...rg, r2: rg.r1 }, rg);
      } else if (rg.c1 === rg.c2) {
        if (rg.c1 === 0) return;
        fillRange({ ...rg, c1: rg.c1 - 1, c2: rg.c1 - 1 }, { ...rg, c1: rg.c1 - 1 });
      } else fillRange({ ...rg, c2: rg.c1 }, rg);
    }

    // ------------------------------------------------------------ autosuma
    function autoSum() {
      const { r, c } = anchor;
      // números encima; si no hay, a la izquierda
      let r0 = r - 1;
      while (r0 >= 0 && typeof values[r0]?.[c] === 'number') r0--;
      if (r0 < r - 1) {
        mutate(() => setRaw(r, c, `=SUMA(${cellName(r0 + 1, c)}:${cellName(r - 1, c)})`));
        return;
      }
      let c0 = c - 1;
      while (c0 >= 0 && typeof values[r]?.[c0] === 'number') c0--;
      if (c0 < c - 1) mutate(() => setRaw(r, c, `=SUMA(${cellName(r, c0 + 1)}:${cellName(r, c - 1)})`));
      else startEdit('=SUMA()');
    }

    // ------------------------------------------------------------ filas y columnas
    function remapFmt(fn: (r: number, c: number) => [number, number] | null) {
      const out: Record<string, CellFmt> = {};
      for (const [k, v] of Object.entries(st.fmt)) {
        const [r, c] = k.split(',').map(Number);
        const n = fn(r, c);
        if (n) out[fmtKey(n[0], n[1])] = v;
      }
      st.fmt = out;
    }
    const adjustAll = (axis: 'row' | 'col', at: number, count: number) => {
      st.cells = st.cells.map((row) => row.map((v) => (v.startsWith('=') ? adjustForInsert(v, axis, at, count) : v)));
    };
    function insertRows(at: number, n: number) {
      mutate(() => {
        ensure(at - 1, 0);
        adjustAll('row', at, n);
        st.cells.splice(at, 0, ...Array.from({ length: n }, () => Array.from({ length: C() }, () => '')));
        remapFmt((r, c) => [r >= at ? r + n : r, c]);
      });
    }
    function deleteRows(at: number, n: number) {
      if (at >= R()) return;
      n = Math.min(n, R() - at);
      if (R() - n < 1) return toast('La tabla necesita al menos una fila');
      mutate(() => {
        adjustAll('row', at, -n);
        st.cells.splice(at, n);
        remapFmt((r, c) => (r >= at && r < at + n ? null : [r >= at + n ? r - n : r, c]));
        anchor = sel = { r: Math.min(at, R() - 1), c: sel.c };
      });
    }
    function insertCols(at: number, n: number) {
      mutate(() => {
        ensure(0, at - 1);
        adjustAll('col', at, n);
        st.cells = st.cells.map((row) => [...row.slice(0, at), ...Array.from({ length: n }, () => ''), ...row.slice(at)]);
        st.colW.splice(at, 0, ...Array.from({ length: n }, () => 1));
        remapFmt((r, c) => [r, c >= at ? c + n : c]);
      });
      buildGrid();
      paint();
    }
    function deleteCols(at: number, n: number) {
      if (at >= C()) return;
      n = Math.min(n, C() - at);
      if (C() - n < 1) return toast('La tabla necesita al menos una columna');
      mutate(() => {
        adjustAll('col', at, -n);
        st.cells = st.cells.map((row) => row.filter((_, i) => i < at || i >= at + n));
        st.colW.splice(at, n);
        remapFmt((r, c) => (c >= at && c < at + n ? null : [r, c >= at + n ? c - n : c]));
        anchor = sel = { r: sel.r, c: Math.min(at, C() - 1) };
      });
      buildGrid();
      paint();
    }

    // ------------------------------------------------------------ ordenar
    function sortBy(asc: boolean) {
      let rg = range();
      const col = anchor.c;
      if (rg.r1 === rg.r2) {
        // una sola celda: toda la tabla (sin la cabecera)
        rg = { r1: st.header ? 1 : 0, c1: 0, r2: R() - 1, c2: C() - 1 };
      }
      if (rg.r2 <= rg.r1) return;
      mutate(() => {
        const rows = range_(rg.r1, Math.min(rg.r2, R() - 1));
        const key = (r: number) => values[r]?.[col] ?? null;
        const order = [...rows].sort((a, b) => {
          const x = key(a);
          const y = key(b);
          const ex = x == null || x === '';
          const ey = y == null || y === '';
          if (ex || ey) return ex === ey ? a - b : ex ? 1 : -1; // vacías al final
          const rank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
          let d = rank(x) - rank(y);
          if (!d) d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { sensitivity: 'base', numeric: true });
          return (asc ? d : -d) || a - b;
        });
        const oldCells = rows.map((r) => [...st.cells[r]]);
        const oldFmt = { ...st.fmt };
        order.forEach((from, i) => {
          const to = rows[i];
          for (let c = rg.c1; c <= Math.min(rg.c2, C() - 1); c++) {
            const v = oldCells[from - rg.r1][c];
            st.cells[to][c] = v.startsWith('=') ? shiftFormula(v, to - from, 0) : v;
            const f = oldFmt[fmtKey(from, c)];
            if (f) st.fmt[fmtKey(to, c)] = f;
            else delete st.fmt[fmtKey(to, c)];
          }
        });
      });
    }

    // ------------------------------------------------------------ portapapeles (compatible con Excel)
    let clip: { tsv: string; cells: string[][]; fmt: (CellFmt | undefined)[][]; r: number; c: number; cut: boolean } | null = null;
    function selectionTsv() {
      const rg = range();
      const out: string[] = [];
      for (let r = rg.r1; r <= rg.r2; r++) {
        const row: string[] = [];
        for (let c = rg.c1; c <= rg.c2; c++) {
          const t = r < R() && c < C() ? display(values[r][c], fmt(r, c), raw(r, c)) : '';
          row.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
        }
        out.push(row.join('\t'));
      }
      return out.join('\n');
    }
    function copySel(cut: boolean) {
      const rg = range();
      const cells: string[][] = [];
      const fm: (CellFmt | undefined)[][] = [];
      for (let r = rg.r1; r <= rg.r2; r++) {
        cells.push(range_(rg.c1, rg.c2).map((c) => raw(r, c)));
        fm.push(range_(rg.c1, rg.c2).map((c) => st.fmt[fmtKey(r, c)]));
      }
      clip = { tsv: selectionTsv(), cells, fmt: fm, r: rg.r1, c: rg.c1, cut };
      navigator.clipboard?.writeText(clip.tsv).catch(() => {});
      toast(cut ? 'Cortado' : 'Copiado', 900);
    }
    function parseTsv(text: string): string[][] {
      const rows: string[][] = [];
      let row: string[] = [];
      let cell = '';
      let q = false;
      text = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
          if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
          else if (ch === '"') q = false;
          else cell += ch;
        } else if (ch === '"' && cell === '') q = true;
        else if (ch === '\t') row.push(cell), (cell = '');
        else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
        else cell += ch;
      }
      row.push(cell);
      rows.push(row);
      return rows;
    }
    function pasteText(text: string) {
      if (ro) return;
      const rg = range();
      mutate(() => {
        if (clip && text === clip.tsv) {
          // desde esta hoja: se conservan fórmulas (ajustadas) y formato
          const src = clip;
          const reps = rg.r1 === rg.r2 && rg.c1 === rg.c2 ? { nr: src.cells.length, nc: src.cells[0].length } : { nr: Math.max(src.cells.length, rg.r2 - rg.r1 + 1), nc: Math.max(src.cells[0].length, rg.c2 - rg.c1 + 1) };
          if (src.cut) for (let r = 0; r < src.cells.length; r++) for (let c = 0; c < src.cells[0].length; c++) setRaw(src.r + r, src.c + c, '');
          for (let r = 0; r < reps.nr; r++)
            for (let c = 0; c < reps.nc; c++) {
              const v = src.cells[r % src.cells.length][c % src.cells[0].length];
              const tr = rg.r1 + r;
              const tc = rg.c1 + c;
              const fromR = src.r + (r % src.cells.length);
              const fromC = src.c + (c % src.cells[0].length);
              setRaw(tr, tc, v.startsWith('=') && !src.cut ? shiftFormula(v, tr - fromR, tc - fromC) : v.startsWith('=') && src.cut ? shiftFormula(v, 0, 0) : v);
              const f = src.fmt[r % src.cells.length][c % src.cells[0].length];
              if (f) st.fmt[fmtKey(tr, tc)] = { ...f };
              else delete st.fmt[fmtKey(tr, tc)];
            }
          if (src.cut) clip = null;
          anchor = { r: rg.r1, c: rg.c1 };
          sel = { r: rg.r1 + reps.nr - 1, c: rg.c1 + reps.nc - 1 };
        } else {
          const rows = parseTsv(text);
          rows.forEach((row, r) => row.forEach((v, c) => setRaw(rg.r1 + r, rg.c1 + c, v)));
          anchor = { r: rg.r1, c: rg.c1 };
          sel = { r: rg.r1 + rows.length - 1, c: rg.c1 + Math.max(...rows.map((x) => x.length)) - 1 };
        }
      });
    }
    async function pasteFromClipboardApi() {
      try {
        const text = await navigator.clipboard.readText();
        pasteText(text);
      } catch {
        if (clip) pasteText(clip.tsv);
        else toast('Usa Ctrl+V para pegar');
      }
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!root.isConnected || editing || (e.target as HTMLElement)?.closest?.('input,textarea,.modal-bg')) return;
      e.preventDefault();
      copySel(false);
      e.clipboardData?.setData('text/plain', clip!.tsv);
    };
    const onCut = (e: ClipboardEvent) => {
      if (!root.isConnected || editing || ro || (e.target as HTMLElement)?.closest?.('input,textarea,.modal-bg')) return;
      e.preventDefault();
      copySel(true);
      e.clipboardData?.setData('text/plain', clip!.tsv);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!root.isConnected || editing || ro || (e.target as HTMLElement)?.closest?.('input,textarea,.modal-bg')) return;
      e.preventDefault();
      pasteText(e.clipboardData?.getData('text/plain') ?? '');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);

    // ------------------------------------------------------------ importar / exportar
    async function importFile() {
      const f = await new Promise<File | null>((res) => {
        const i = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) as HTMLInputElement;
        i.onchange = () => res(i.files?.[0] ?? null);
        i.click();
      });
      if (!f) return;
      const empty = st.cells.every((r) => r.every((v) => !v.trim()));
      if (!empty && !(await askConfirm('¿Sustituir el contenido?', `Se cambiará lo que hay en la tabla por el contenido de "${f.name}". Podrás deshacerlo.`, 'Sustituir'))) return;
      try {
        const { importSheetFile } = await import('./io');
        const data = await importSheetFile(f);
        mutate(() => {
          st = { cells: data.cells, fmt: data.fmt, colW: data.colW, header: st.header };
          anchor = sel = { r: 0, c: 0 };
        });
        buildGrid();
        paint();
        toast(`Importado: ${f.name}`);
      } catch (e: any) {
        toast('No se pudo importar: ' + (e?.message || e), 4000);
      }
    }
    async function exportXlsx() {
      const { exportXlsx: ex } = await import('./io');
      await ex(st, values, 'Tabla');
    }
    async function exportCsv() {
      const { exportCsv: ex } = await import('./io');
      ex(st, values, 'Tabla');
    }

    // ------------------------------------------------------------ cierre
    function close() {
      if (editing) commitEdit();
      // filas y columnas añadidas al final que se han quedado vacías
      const emptyRow = (r: number) => st.cells[r].every((v, c) => !v && !st.fmt[fmtKey(r, c)]);
      const emptyCol = (c: number) => st.cells.every((row, r) => !row[c] && !st.fmt[fmtKey(r, c)]);
      let changed = false;
      while (st.cells.length > Math.max(1, origR) && emptyRow(st.cells.length - 1)) (st.cells.pop(), (changed = true));
      while (C() > Math.max(1, origC) && emptyCol(C() - 1)) {
        st.cells = st.cells.map((r) => r.slice(0, -1));
        st.colW.pop();
        changed = true;
      }
      if (changed || liveTimer || !same(st, base)) flush();
      unsub?.();
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.querySelector('.ss-ctx')?.remove();
      root.remove();
      resolve(clone(st));
    }

    window.addEventListener('keydown', onKey, true);
    document.body.append(root);
    buildGrid();
    paint();
    requestAnimationFrame(() => {
      paintSelection();
      scroller.focus({ preventScroll: true });
    });
    if (ro) numSel.disabled = true;
  });
}
