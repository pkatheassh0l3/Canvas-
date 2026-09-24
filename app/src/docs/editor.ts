// Editor de documentos a pantalla completa: folios A4 deslizables con formato estilo Word.
import type { DocItem } from '../types';
import { h, toast, debounce } from '../util';
import { icons } from '../ui/icons';
import { askConfirm } from '../ui/dialogs';
import { addAsset, hydrateImages } from '../assets';
import { buildPreview, sanitizeHtml, sanitizeStored, serializeEditor, wordCount } from './sanitize';
import { DOC_IMPORT_ACCEPT, importFile, pickFile } from './importers';
import { mergeBlocks, mergeValue } from '../sync/merge';

export const PAGE_W = 794; // A4 a 96 ppp
export const PAGE_H = 1123;
const PAGE_GAP = 24;

/** Páginas según dónde acaba el último bloque con contenido (no cuenta líneas vacías finales). */
export function countPages(paper: HTMLElement) {
  let bottom = 0;
  for (const el of paper.children) {
    const e = el as HTMLElement;
    const has = e.textContent?.trim() || e.querySelector('img,hr,table');
    if (has) bottom = Math.max(bottom, e.offsetTop + e.offsetHeight);
  }
  return Math.max(1, Math.ceil((bottom + 1) / (PAGE_H + PAGE_GAP)));
}

export interface DocEditorResult {
  action: 'close' | 'delete';
  doc?: DocItem;
}

type SaveFn = (doc: DocItem) => void;

const TEXT_COLORS = ['#1f2328', '#e5484d', '#f76b15', '#30a46c', '#0090ff', '#8e4ec6', '#6b6f76'];
const HIGHLIGHTS = ['transparent', '#fff1a8', '#d3f5d3', '#cfe8ff', '#ffd6e0', '#e6dcff'];

/** Bloques de primer nivel (párrafos, títulos, listas…) de un HTML guardado. */
function blocksOf(html: string): string[] {
  const d = document.createElement('div');
  d.innerHTML = html;
  return [...d.childNodes].map((n) => (n.nodeType === 1 ? (n as Element).outerHTML : (n.textContent ?? ''))).filter((x) => x !== '');
}

export function openDocEditor(
  doc: DocItem,
  onSave: SaveFn,
  opts: { readOnly?: boolean; subscribe?: (fn: (d: DocItem) => void) => () => void } = {},
): Promise<DocEditorResult> {
  return new Promise((resolve) => {
    let current: DocItem = { ...doc };
    let dirty = false;

    const paper = h('div', {
      class: 'doc-paper',
      contenteditable: 'true',
      spellcheck: 'true',
      'data-placeholder': 'Empieza a escribir…',
    });
    paper.innerHTML = sanitizeStored(doc.html || '');
    if (!paper.innerHTML.trim()) paper.innerHTML = '<p><br></p>';
    hydrateImages(paper).then(() => updatePages());

    const title = h('input', { class: 'doc-title', value: doc.title, placeholder: 'Documento sin título' }) as HTMLInputElement;
    const status = h('span', { class: 'doc-status' }, 'Guardado');
    const footer = h('div', { class: 'doc-footer' });
    const scroller = h('div', { class: 'doc-scroll' });
    const pagesWrap = h('div', { class: 'doc-pages' }, paper);
    scroller.append(pagesWrap);
    const busy = h('div', { class: 'doc-busy hidden' });

    // ---------------- guardado ----------------
    const snapshot = (): DocItem => {
      const pages = updatePages();
      return {
        ...current,
        title: title.value.trim() || 'Documento sin título',
        html: serializeEditor(paper),
        pages,
        preview: buildPreview(paper),
      };
    };
    // última versión común con los demás dispositivos (para mezclar lo que llegue)
    let base = { title: doc.title, html: sanitizeStored(doc.html || '') };
    const save = () => {
      if (!dirty || opts.readOnly) return;
      dirty = false;
      current = snapshot();
      base = { title: current.title, html: current.html };
      onSave(current);
      status.textContent = 'Guardado';
    };
    const autosave = debounce(save, 500);

    // ---------------- cambios que llegan de otro dispositivo ----------------
    /** Posición del cursor como (bloque, carácter dentro del bloque). */
    function caret(): { block: number; offset: number } | null {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !paper.contains(sel.anchorNode)) return null;
      let node: Node | null = sel.anchorNode;
      while (node && node.parentNode !== paper) node = node.parentNode;
      if (!node) return null;
      const block = [...paper.childNodes].indexOf(node as ChildNode);
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(sel.anchorNode!, sel.anchorOffset);
      return { block, offset: r.toString().length };
    }
    function placeCaret(block: number, offset: number) {
      const node = paper.childNodes[Math.min(block, paper.childNodes.length - 1)];
      if (!node) return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let left = offset;
      let t: Node | null;
      let last: Node | null = null;
      while ((t = walker.nextNode())) {
        last = t;
        const len = t.textContent?.length ?? 0;
        if (left <= len) {
          const r = document.createRange();
          r.setStart(t, left);
          r.collapse(true);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(r);
          return;
        }
        left -= len;
      }
      const r = document.createRange();
      if (last) r.setStart(last, last.textContent?.length ?? 0);
      else r.setStart(node, 0);
      r.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    }
    const unsub = opts.subscribe?.((d) => {
      const theirs = { title: d.title, html: sanitizeStored(d.html || '') };
      if (theirs.html === base.html && theirs.title === base.title) return;
      const mineHtml = serializeEditor(paper);
      const B = blocksOf(base.html);
      const M = blocksOf(mineHtml);
      const T = blocksOf(theirs.html);
      const { merged, mineAt } = mergeBlocks(B, M, T);
      const html = merged.join('');
      const focused = document.activeElement === paper;
      const pos = focused ? caret() : null;
      const scroll = scroller.scrollTop;
      if (html !== mineHtml) {
        paper.innerHTML = sanitizeStored(html) || '<p><br></p>';
        hydrateImages(paper).then(() => updatePages());
        if (pos) {
          const at = mineAt[pos.block];
          placeCaret(at >= 0 ? at : Math.max(0, pos.block), pos.offset);
        }
        scroller.scrollTop = scroll;
      }
      const newTitle = mergeValue(base.title, title.value.trim() || 'Documento sin título', theirs.title);
      if (newTitle !== (title.value.trim() || 'Documento sin título') && document.activeElement !== title) title.value = newTitle;
      base = theirs;
      // si lo mezclado no es igual a lo que llegó, hay cambios míos que enviar
      if (html !== theirs.html || newTitle !== theirs.title) {
        dirty = true;
        autosave();
      }
      updatePages();
    });
    const markDirty = () => {
      dirty = true;
      status.textContent = 'Guardando…';
      autosave();
    };

    // ---------------- páginas ----------------
    function updatePages() {
      const pages = countPages(paper);
      paper.style.minHeight = pages * PAGE_H + (pages - 1) * PAGE_GAP + 'px';
      const words = wordCount(paper);
      footer.textContent = `${pages} ${pages === 1 ? 'página' : 'páginas'} · ${words} ${words === 1 ? 'palabra' : 'palabras'}`;
      return pages;
    }

    function fitWidth() {
      const avail = scroller.clientWidth - 24;
      const z = Math.min(1, avail / (PAGE_W + 2));
      pagesWrap.style.setProperty('zoom', String(z));
    }

    // ---------------- comandos de formato ----------------
    const exec = (cmd: string, value?: string) => {
      paper.focus();
      document.execCommand(cmd, false, value);
      markDirty();
      refreshState();
    };
    const tbtn = (icon: string, title: string, fn: () => void, id?: string) => {
      const b = h('button', { class: 'tb', title, html: icon, onmousedown: (e: Event) => e.preventDefault(), onclick: fn });
      if (id) b.dataset.cmd = id;
      return b;
    };
    const txt = (label: string, style = '') => `<span style="font-weight:700;font-size:15px;${style}">${label}</span>`;

    const blockSel = h(
      'select',
      {
        class: 'doc-select',
        title: 'Estilo de párrafo',
        onchange: () => exec('formatBlock', blockSel.value),
      },
      h('option', { value: 'p' }, 'Normal'),
      h('option', { value: 'h1' }, 'Título 1'),
      h('option', { value: 'h2' }, 'Título 2'),
      h('option', { value: 'h3' }, 'Título 3'),
      h('option', { value: 'blockquote' }, 'Cita'),
      h('option', { value: 'pre' }, 'Código'),
    ) as HTMLSelectElement;

    const sizeSel = h(
      'select',
      { class: 'doc-select small', title: 'Tamaño de letra', onchange: () => exec('fontSize', sizeSel.value) },
      ...[
        ['2', 'Pequeña'],
        ['3', 'Normal'],
        ['4', 'Grande'],
        ['5', 'Muy grande'],
      ].map(([v, l]) => h('option', { value: v, selected: v === '3' }, l)),
    ) as HTMLSelectElement;

    const colorMenu = (list: string[], cmd: string, label: string, icon: string) => {
      const pop = h('div', { class: 'doc-pop hidden' });
      for (const c of list)
        pop.append(
          h('button', {
            class: 'sw',
            style: `--c:${c === 'transparent' ? '#fff' : c}`,
            title: c === 'transparent' ? 'Sin resaltado' : c,
            onmousedown: (e: Event) => e.preventDefault(),
            onclick: () => {
              pop.classList.add('hidden');
              exec(cmd, c);
            },
          }),
        );
      const wrap = h(
        'div',
        { class: 'doc-pop-wrap' },
        tbtn(icon, label, () => pop.classList.toggle('hidden')),
        pop,
      );
      return wrap;
    };

    const toolbar = h(
      'div',
      { class: 'doc-toolbar' },
      tbtn(icons.undo, 'Deshacer (Ctrl+Z)', () => exec('undo')),
      tbtn(icons.redo, 'Rehacer (Ctrl+Y)', () => exec('redo')),
      h('div', { class: 'sep' }),
      blockSel,
      sizeSel,
      h('div', { class: 'sep' }),
      tbtn(txt('N'), 'Negrita (Ctrl+B)', () => exec('bold'), 'bold'),
      tbtn(txt('K', 'font-style:italic;font-family:serif'), 'Cursiva (Ctrl+I)', () => exec('italic'), 'italic'),
      tbtn(txt('S', 'text-decoration:underline'), 'Subrayado (Ctrl+U)', () => exec('underline'), 'underline'),
      tbtn(txt('ab', 'text-decoration:line-through;font-weight:500'), 'Tachado', () => exec('strikeThrough'), 'strikeThrough'),
      colorMenu(TEXT_COLORS, 'foreColor', 'Color del texto', txt('A', 'border-bottom:3px solid #e5484d;line-height:1')),
      colorMenu(HIGHLIGHTS, 'hiliteColor', 'Resaltar', icons.marker),
      h('div', { class: 'sep' }),
      tbtn(icons.listUl, 'Lista con viñetas', () => exec('insertUnorderedList'), 'insertUnorderedList'),
      tbtn(icons.listOl, 'Lista numerada', () => exec('insertOrderedList'), 'insertOrderedList'),
      tbtn(icons.alignLeft, 'Alinear a la izquierda', () => exec('justifyLeft'), 'justifyLeft'),
      tbtn(icons.alignCenter, 'Centrar', () => exec('justifyCenter'), 'justifyCenter'),
      tbtn(icons.alignRight, 'Alinear a la derecha', () => exec('justifyRight'), 'justifyRight'),
      tbtn(icons.alignJustify, 'Justificar', () => exec('justifyFull'), 'justifyFull'),
      h('div', { class: 'sep' }),
      tbtn(icons.image, 'Insertar imagen', () => insertImage()),
      tbtn(icons.pageBreak, 'Salto de página', () => insertPageBreak()),
      tbtn(icons.eraserText, 'Quitar formato', () => exec('removeFormat')),
    );

    function refreshState() {
      for (const b of toolbar.querySelectorAll<HTMLButtonElement>('[data-cmd]')) {
        let on = false;
        try {
          on = document.queryCommandState(b.dataset.cmd!);
        } catch {}
        b.classList.toggle('on', on);
      }
      try {
        const v = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase();
        blockSel.value = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(v) ? v : 'p';
      } catch {}
    }
    document.addEventListener('selectionchange', refreshState);

    // ---------------- imágenes / importar ----------------
    async function insertImage() {
      const f = await pickFile('image/png,image/jpeg,image/webp,image/gif');
      if (!f) return;
      const id = await addAsset(f);
      const url = URL.createObjectURL(f);
      exec('insertHTML', `<img data-asset="${id}" src="${url}" alt="">`);
    }

    function insertPageBreak() {
      // rellena con párrafos vacíos hasta el principio de la página siguiente
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const pr = paper.getBoundingClientRect();
      const z = parseFloat(pagesWrap.style.getPropertyValue('zoom') || '1') || 1;
      const y = (r.bottom - pr.top) / z;
      const pageEnd = Math.ceil(y / (PAGE_H + PAGE_GAP)) * (PAGE_H + PAGE_GAP);
      const n = Math.max(1, Math.round((pageEnd - y + 72) / 36));
      exec('insertHTML', '<p><br></p>'.repeat(n));
    }

    async function importInto() {
      const f = await pickFile(DOC_IMPORT_ACCEPT);
      if (!f) return;
      busy.classList.remove('hidden');
      try {
        const res = await importFile(f, (m) => (busy.textContent = m));
        paper.focus();
        const empty = !paper.innerText.trim() && !paper.querySelector('img');
        if (empty) {
          paper.innerHTML = res.html;
          if (!title.value.trim() || title.value === 'Documento sin título') title.value = res.title;
        } else document.execCommand('insertHTML', false, res.html);
        await hydrateImages(paper);
        markDirty();
        toast(`Importado: ${f.name}`);
      } catch (e: any) {
        toast(e?.message || 'No se pudo importar el archivo', 4000);
      } finally {
        busy.classList.add('hidden');
        busy.textContent = '';
      }
    }

    paper.addEventListener('paste', async (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const file = [...cd.files].find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (file) {
        const id = await addAsset(file);
        document.execCommand('insertHTML', false, `<img data-asset="${id}" src="${URL.createObjectURL(file)}" alt="">`);
      } else if (cd.types.includes('text/html')) {
        const clean = await sanitizeHtml(cd.getData('text/html'));
        document.execCommand('insertHTML', false, clean);
        await hydrateImages(paper);
      } else {
        document.execCommand('insertText', false, cd.getData('text/plain'));
      }
      markDirty();
    });
    paper.addEventListener('drop', async (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      if (f.type.startsWith('image/')) {
        const id = await addAsset(f);
        document.execCommand('insertHTML', false, `<img data-asset="${id}" src="${URL.createObjectURL(f)}" alt="">`);
        markDirty();
      }
    });
    paper.addEventListener('input', () => {
      if (!paper.firstElementChild) paper.innerHTML = '<p><br></p>';
      markDirty();
    });
    paper.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank');
    });
    title.addEventListener('input', markDirty);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        paper.focus();
      }
    });

    // ---------------- cierre ----------------
    const finish = (r: DocEditorResult) => {
      autosave.flush?.();
      unsub?.();
      document.removeEventListener('selectionchange', refreshState);
      window.removeEventListener('resize', fitWidth);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(r);
    };
    const close = () => {
      dirty = true; // asegura título/vista previa actualizados al salir
      save();
      finish({ action: 'close', doc: current });
    };

    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        dirty = true;
        save();
      }
      e.stopPropagation(); // los atajos de la pizarra no deben dispararse aquí
    }

    const root = h(
      'div',
      { class: 'doc-root' },
      h(
        'div',
        { class: 'doc-top' },
        h('button', { class: 'tb', title: 'Volver a la pizarra', html: icons.back, onclick: close }),
        h('span', { class: 'doc-icon', html: icons.doc }),
        title,
        status,
        h('div', { class: 'grow' }),
        h('button', {
          class: 'tb',
          title: 'Exportar a PDF',
          html: icons.fileExport,
          onclick: async () => {
            dirty = true;
            if (!opts.readOnly) save();
            const { exportDocPdf } = await import('../features/exporter');
            exportDocPdf(opts.readOnly ? doc : current);
          },
        }),
        opts.readOnly ? '' : h('button', { class: 'btn ghost', onclick: importInto }, h('span', { html: icons.upload }), 'Importar Word'),
        opts.readOnly
          ? h('span', { class: 'ro-badge' }, 'Solo lectura')
          : h('button', {
          class: 'tb danger',
          title: 'Eliminar documento',
          html: icons.trash,
          onclick: async () => {
            if (await askConfirm('¿Eliminar este documento?', 'Se borrará de la pizarra en todos los dispositivos.')) {
              autosave.flush?.();
              finish({ action: 'delete' });
            }
          },
        }),
        h('button', { class: 'btn primary', onclick: close }, 'Hecho'),
      ),
      toolbar,
      scroller,
      footer,
      busy,
    );

    if (opts.readOnly) {
      paper.setAttribute('contenteditable', 'false');
      title.readOnly = true;
      toolbar.remove();
    }
    document.body.append(root);
    window.addEventListener('resize', fitWidth);
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      fitWidth();
      updatePages();
      if (!doc.html) title.focus();
      else paper.focus();
    });
    new ResizeObserver(() => updatePages()).observe(paper);
  });
}
