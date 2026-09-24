// Visor de PDF de solo lectura con anotaciones: seleccionar texto, resaltar/subrayar/tachar,
// lápiz, rotulador y borrador. Las anotaciones se guardan en el elemento y se sincronizan.
import 'pdfjs-dist/web/pdf_viewer.css';
import type { PdfAnnotation, PdfItem } from '../types';
import { settings } from '../settings';
import { debounce, distToSeg, h, toast, uid } from '../util';
import { icons } from '../ui/icons';
import { askConfirm } from '../ui/dialogs';
import { getAssetBlob } from '../assets';
import { StrokeCapture, isPenEraser } from '../board/capture';
import { drawStroke, PEN_COLORS } from '../board/render';
import { drawPdfAnnotations } from '../board/items';
import { loadPdfjs } from './pdfjs';

type Ann = Record<string, PdfAnnotation[]>;
type VTool = 'text' | 'pen' | 'marker' | 'eraser';

export interface PdfViewerResult {
  action: 'close' | 'delete';
}

const MARK_COLORS = ['#ffd400', '#7ee07e', '#7cc4ff', '#ff8fb1', '#c9a7ff'];
const SIZES = { pen: [2, 3.5, 6], marker: [12, 18, 28], eraser: [10, 20, 40] };

interface PageView {
  el: HTMLDivElement;
  render: HTMLCanvasElement;
  ann: HTMLCanvasElement;
  text: HTMLDivElement;
  renderedAt: number; // ancho con el que se pintó (0 = sin pintar)
  rendering: boolean;
}

export function openPdfViewer(item: PdfItem, onSave: (ann: Ann) => void): Promise<PdfViewerResult> {
  return new Promise((resolve) => {
    let ann: Ann = JSON.parse(JSON.stringify(item.ann || {}));
    const undo: string[] = [];
    const redo: string[] = [];
    let tool: VTool = 'text';
    let color = PEN_COLORS[1];
    let markColor = MARK_COLORS[0];
    let sizeIdx = 1;
    let zoom = 1;
    let pdf: any = null;
    let task: any = null;
    let pdfjs: any = null;
    let live: { page: number; cap: StrokeCapture } | null = null;
    let erasing: { page: number } | null = null;
    let scrollTouch: { y: number; x: number } | null = null;
    let activePointer = -1;
    const pages: PageView[] = [];

    const save = debounce(() => onSave(ann), 700);
    const snapshot = () => {
      undo.push(JSON.stringify(ann));
      if (undo.length > 100) undo.shift();
      redo.length = 0;
      refreshButtons();
    };

    // ---------------- estructura ----------------
    const scroller = h('div', { class: 'pv-scroll' });
    const column = h('div', { class: 'pv-column' });
    scroller.append(column);
    const pageLabel = h('span', { class: 'pv-pagelabel' }, '');
    const zoomLabel = h('span', { class: 'pv-zoom' }, '100%');
    const selBar = h('div', { class: 'pv-selbar hidden' });
    const loading = h('div', { class: 'doc-busy' }, 'Abriendo PDF…');

    const toolBtns: Partial<Record<VTool, HTMLButtonElement>> = {};
    const mkTool = (t: VTool, icon: string, title: string) =>
      (toolBtns[t] = h('button', { class: 'tb', title, html: icon, onclick: () => setTool(t) }));
    const colorWrap = h('div', { class: 'swatches' });
    const sizeWrap = h('div', { class: 'sizes' });
    const btnUndo = h('button', { class: 'tb', title: 'Deshacer (Ctrl+Z)', html: icons.undo, onclick: () => doUndo() });
    const btnRedo = h('button', { class: 'tb', title: 'Rehacer (Ctrl+Y)', html: icons.redo, onclick: () => doRedo() });

    const toolbar = h(
      'div',
      { class: 'doc-toolbar pv-toolbar' },
      mkTool('text', icons.cursorText, 'Seleccionar texto (resaltar, subrayar, copiar)'),
      mkTool('pen', icons.pen, 'Lápiz'),
      mkTool('marker', icons.marker, 'Rotulador'),
      mkTool('eraser', icons.eraser, 'Borrador de anotaciones'),
      h('div', { class: 'sep' }),
      colorWrap,
      sizeWrap,
      h('div', { class: 'sep' }),
      btnUndo,
      btnRedo,
      h('div', { class: 'grow' }),
      h('button', { class: 'tb', title: 'Alejar', html: icons.minus, onclick: () => setZoom(zoom / 1.2) }),
      zoomLabel,
      h('button', { class: 'tb', title: 'Acercar', html: icons.plus, onclick: () => setZoom(zoom * 1.2) }),
      h('button', { class: 'tb', title: 'Ajustar al ancho', html: icons.fit, onclick: () => setZoom(1) }),
    );

    const root = h(
      'div',
      { class: 'doc-root pv-root mode-text' },
      h(
        'div',
        { class: 'doc-top' },
        h('button', { class: 'tb', title: 'Volver a la pizarra', html: icons.back, onclick: () => close() }),
        h('span', { class: 'doc-icon pdf', html: icons.pdf }),
        h('span', { class: 'pv-title' }, item.title),
        pageLabel,
        h('div', { class: 'grow' }),
        h('button', { class: 'tb', title: 'Descargar el PDF original', html: icons.download, onclick: () => download() }),
        h('button', {
          class: 'tb danger',
          title: 'Eliminar PDF de la pizarra',
          html: icons.trash,
          onclick: async () => {
            if (await askConfirm('¿Eliminar este PDF?', 'Se quitará de la pizarra en todos los dispositivos, con sus anotaciones.')) {
              finish({ action: 'delete' });
            }
          },
        }),
        h('button', { class: 'btn primary', onclick: () => close() }, 'Hecho'),
      ),
      toolbar,
      scroller,
      selBar,
      loading,
    );

    // ---------------- herramientas ----------------
    function renderPickers() {
      const list = tool === 'text' ? MARK_COLORS : PEN_COLORS;
      const cur = tool === 'text' ? markColor : color;
      colorWrap.style.display = tool === 'eraser' ? 'none' : '';
      colorWrap.replaceChildren(
        ...list.map((c) =>
          h('button', {
            class: 'sw' + (c === cur ? ' on' : ''),
            style: `--c:${c}`,
            title: c,
            onclick: () => {
              if (tool === 'text') markColor = c;
              else color = c;
              renderPickers();
            },
          }),
        ),
      );
      sizeWrap.style.display = tool === 'text' ? 'none' : '';
      sizeWrap.replaceChildren(
        ...[0, 1, 2].map((i) =>
          h(
            'button',
            { class: 'sz' + (i === sizeIdx ? ' on' : ''), onclick: () => ((sizeIdx = i), renderPickers()) },
            h('span', { style: `width:${6 + i * 5}px;height:${6 + i * 5}px` }),
          ),
        ),
      );
    }
    function setTool(t: VTool) {
      tool = t;
      for (const [k, b] of Object.entries(toolBtns)) b!.classList.toggle('on', k === t);
      root.classList.toggle('mode-text', t === 'text');
      root.classList.toggle('mode-ink', t !== 'text');
      if (t !== 'text') window.getSelection()?.removeAllRanges();
      hideSelBar();
      renderPickers();
    }
    function refreshButtons() {
      btnUndo.toggleAttribute('disabled', !undo.length);
      btnRedo.toggleAttribute('disabled', !redo.length);
    }
    function doUndo() {
      const prev = undo.pop();
      if (!prev) return;
      redo.push(JSON.stringify(ann));
      ann = JSON.parse(prev);
      redrawAll();
      save();
      refreshButtons();
    }
    function doRedo() {
      const n = redo.pop();
      if (!n) return;
      undo.push(JSON.stringify(ann));
      ann = JSON.parse(n);
      redrawAll();
      save();
      refreshButtons();
    }

    // ---------------- páginas ----------------
    const pageWidth = () => Math.max(200, Math.min(scroller.clientWidth - 32, 980) * zoom);

    function buildPages() {
      column.replaceChildren();
      pages.length = 0;
      item.sizes.forEach((_, i) => {
        const render = h('canvas', { class: 'pv-render' }) as HTMLCanvasElement;
        const text = h('div', { class: 'textLayer' }) as HTMLDivElement;
        const annC = h('canvas', { class: 'pv-ann' }) as HTMLCanvasElement;
        const el = h('div', { class: 'pv-page', 'data-page': String(i) }, render, annC, text) as HTMLDivElement;
        pages.push({ el, render, ann: annC, text, renderedAt: 0, rendering: false });
        column.append(el);
        bindInk(annC, i);
      });
      layout();
    }

    function layout() {
      const W = pageWidth();
      const dpr = window.devicePixelRatio || 1;
      pages.forEach((p, i) => {
        const [pw, ph] = item.sizes[i];
        const H = (W * ph) / pw;
        p.el.style.width = W + 'px';
        p.el.style.height = H + 'px';
        p.ann.width = Math.round(W * dpr);
        p.ann.height = Math.round(H * dpr);
        p.ann.style.width = W + 'px';
        p.ann.style.height = H + 'px';
        drawAnn(i);
      });
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
      queueVisible();
    }

    function setZoom(z: number) {
      const rel = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
      zoom = Math.min(4, Math.max(0.4, z));
      layout();
      scroller.scrollTop = rel * scroller.scrollHeight;
    }

    async function renderPage(i: number) {
      const p = pages[i];
      const W = pageWidth();
      if (!pdf || p.rendering || p.renderedAt === W) return;
      p.rendering = true;
      try {
        const page = await pdf.getPage(i + 1);
        const [pw] = item.sizes[i];
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const vp = page.getViewport({ scale: W / pw });
        const vpHi = page.getViewport({ scale: (W / pw) * dpr });
        const c = document.createElement('canvas');
        c.width = Math.round(vpHi.width);
        c.height = Math.round(vpHi.height);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vpHi, canvas: c }).promise;
        // se sustituye de golpe para que no parpadee al hacer zoom
        c.className = 'pv-render';
        c.style.width = '100%';
        c.style.height = '100%';
        p.render.replaceWith(c);
        p.render = c;
        // capa de texto (para seleccionar, copiar y resaltar)
        p.text.replaceChildren();
        p.text.style.setProperty('--scale-factor', String(vp.scale));
        p.text.style.setProperty('--total-scale-factor', String(vp.scale));
        const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: p.text, viewport: vp });
        await tl.render();
        p.renderedAt = W;
      } catch (e) {
        console.error(e);
      } finally {
        p.rendering = false;
      }
      if (p.renderedAt !== pageWidth()) queueVisible();
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) renderPage(Number((e.target as HTMLElement).dataset.page));
      },
      { root: scroller, rootMargin: '800px 0px' },
    );
    function queueVisible() {
      const top = scroller.scrollTop - 800;
      const bottom = scroller.scrollTop + scroller.clientHeight + 800;
      pages.forEach((p, i) => {
        const y = p.el.offsetTop;
        if (y + p.el.offsetHeight >= top && y <= bottom) renderPage(i);
      });
    }

    function drawAnn(i: number) {
      const p = pages[i];
      const ctx = p.ann.getContext('2d')!;
      const dpr = p.ann.width / (parseFloat(p.ann.style.width) || 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, p.ann.width, p.ann.height);
      const W = parseFloat(p.ann.style.width);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPdfAnnotations(ctx, ann[String(i)], W / 1000);
      if (live && live.page === i) {
        ctx.save();
        ctx.scale(W / 1000, W / 1000);
        drawStroke(ctx, live.cap.data, true);
        ctx.restore();
      }
    }
    function redrawAll() {
      pages.forEach((_, i) => drawAnn(i));
    }

    function updatePageLabel() {
      const mid = scroller.scrollTop + scroller.clientHeight / 3;
      let cur = 0;
      pages.forEach((p, i) => {
        if (p.el.offsetTop <= mid) cur = i;
      });
      pageLabel.textContent = `${cur + 1} / ${pages.length}`;
    }
    scroller.addEventListener('scroll', () => {
      updatePageLabel();
      hideSelBar();
    });

    // ---------------- dibujo ----------------
    function toNorm(annC: HTMLCanvasElement, cx: number, cy: number): [number, number] {
      const r = annC.getBoundingClientRect();
      return [((cx - r.left) / r.width) * 1000, ((cy - r.top) / r.width) * 1000];
    }

    function eraseAt(page: number, x: number, y: number, W: number) {
      const list = ann[String(page)];
      if (!list?.length) return false;
      const rad = (SIZES.eraser[sizeIdx] / 2) * (1000 / W);
      const keep = list.filter((a) => {
        if (a.t === 'mark') return !a.rects.some(([rx, ry, rw, rh]) => x >= rx - rad && x <= rx + rw + rad && y >= ry - rad && y <= ry + rh + rad);
        const p = a.pts;
        const tol = rad + a.size / 2;
        if (p.length <= 3) return Math.hypot(p[0] - x, p[1] - y) > tol;
        for (let i = 0; i < p.length - 3; i += 3) if (distToSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= tol) return false;
        return true;
      });
      if (keep.length === list.length) return false;
      ann[String(page)] = keep;
      drawAnn(page);
      return true;
    }

    function bindInk(annC: HTMLCanvasElement, page: number) {
      annC.addEventListener('pointerdown', (e) => {
        if (tool === 'text' || activePointer !== -1) return;
        e.preventDefault();
        annC.setPointerCapture(e.pointerId);
        activePointer = e.pointerId;
        if (e.pointerType === 'touch' && settings.penOnly) {
          scrollTouch = { x: e.clientX, y: e.clientY }; // con lápiz, el dedo desplaza
          return;
        }
        const W = annC.getBoundingClientRect().width;
        snapshot();
        if (tool === 'eraser' || isPenEraser(e)) {
          erasing = { page };
          const [x, y] = toNorm(annC, e.clientX, e.clientY);
          eraseAt(page, x, y, W);
          return;
        }
        const t = tool === 'marker' ? 'marker' : 'pen';
        const size = SIZES[t][sizeIdx] * (1000 / W);
        live = { page, cap: new StrokeCapture(e, (cx, cy) => toNorm(annC, cx, cy), color, size, t, 0.5 * (1000 / W)) };
        drawAnn(page);
      });
      annC.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activePointer) return;
        if (scrollTouch) {
          scroller.scrollTop -= e.clientY - scrollTouch.y;
          scroller.scrollLeft -= e.clientX - scrollTouch.x;
          scrollTouch = { x: e.clientX, y: e.clientY };
          return;
        }
        if (erasing) {
          const [x, y] = toNorm(annC, e.clientX, e.clientY);
          eraseAt(erasing.page, x, y, annC.getBoundingClientRect().width);
        } else if (live) {
          live.cap.move(e);
          drawAnn(live.page);
        }
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== activePointer) return;
        activePointer = -1;
        if (scrollTouch) {
          scrollTouch = null;
          return;
        }
        if (live) {
          const data = live.cap.finish();
          const key = String(live.page);
          (ann[key] ??= []).push({ t: 'ink', id: uid(10), ...data });
          const pg = live.page;
          live = null;
          drawAnn(pg);
          save();
        } else if (erasing) {
          erasing = null;
          if (undo[undo.length - 1] === JSON.stringify(ann)) undo.pop(); // no borró nada
          refreshButtons();
          save();
        }
      };
      annC.addEventListener('pointerup', end);
      annC.addEventListener('pointercancel', end);
    }

    // ---------------- selección de texto ----------------
    function hideSelBar() {
      selBar.classList.add('hidden');
    }
    function currentRange(): Range | null {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      return column.contains(r.commonAncestorContainer) ? r : null;
    }
    const showSelBarSoon = debounce(() => {
      if (tool !== 'text') return;
      const r = currentRange();
      if (!r) return hideSelBar();
      const rect = r.getBoundingClientRect();
      const btn = (label: string, fn: () => void, extra: Record<string, any> = {}) =>
        h('button', { class: 'sb', onmousedown: (e: Event) => e.preventDefault(), onclick: fn, ...extra }, label);
      selBar.replaceChildren(
        ...MARK_COLORS.slice(0, 4).map((c) =>
          h('button', {
            class: 'sw',
            style: `--c:${c}`,
            title: 'Resaltar',
            onmousedown: (e: Event) => e.preventDefault(),
            onclick: () => addMark('highlight', c),
          }),
        ),
        h('div', { class: 'sep' }),
        btn('Subrayar', () => addMark('underline', '#e5484d')),
        btn('Tachar', () => addMark('strike', '#e5484d')),
        btn('Copiar', async () => {
          const t = window.getSelection()?.toString() ?? '';
          try {
            await navigator.clipboard.writeText(t);
            toast('Texto copiado');
          } catch {
            document.execCommand('copy');
          }
          hideSelBar();
        }),
      );
      selBar.classList.remove('hidden');
      const bw = selBar.offsetWidth;
      selBar.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, rect.left + rect.width / 2 - bw / 2)) + 'px';
      const top = rect.top - selBar.offsetHeight - 10;
      selBar.style.top = (top < 110 ? rect.bottom + 10 : top) + 'px';
    }, 180);
    document.addEventListener('selectionchange', showSelBarSoon);

    function addMark(style: 'highlight' | 'underline' | 'strike', c: string) {
      const r = currentRange();
      if (!r) return;
      const rects = [...r.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
      const byPage = new Map<number, [number, number, number, number][]>();
      pages.forEach((p, i) => {
        const pr = p.el.getBoundingClientRect();
        const k = 1000 / pr.width;
        for (const x of rects) {
          const cy = x.top + x.height / 2;
          if (cy < pr.top || cy > pr.bottom) continue;
          const list = byPage.get(i) ?? [];
          list.push([(x.left - pr.left) * k, (x.top - pr.top) * k, x.width * k, x.height * k]);
          byPage.set(i, list);
        }
      });
      if (!byPage.size) return;
      snapshot();
      for (const [i, list] of byPage) {
        // une trozos de la misma línea para que el resaltado quede continuo
        list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        const merged: [number, number, number, number][] = [];
        for (const q of list) {
          const last = merged[merged.length - 1];
          if (last && Math.abs(last[1] - q[1]) < q[3] * 0.5 && q[0] <= last[0] + last[2] + q[3]) {
            const x2 = Math.max(last[0] + last[2], q[0] + q[2]);
            const y1 = Math.min(last[1], q[1]);
            const y2 = Math.max(last[1] + last[3], q[1] + q[3]);
            last[2] = x2 - last[0];
            last[1] = y1;
            last[3] = y2 - y1;
          } else merged.push([...q]);
        }
        const rounded = merged.map((m) => m.map((v) => Math.round(v * 10) / 10) as [number, number, number, number]);
        (ann[String(i)] ??= []).push({ t: 'mark', id: uid(10), style, color: c, rects: rounded });
        drawAnn(i);
      }
      window.getSelection()?.removeAllRanges();
      hideSelBar();
      save();
    }

    // ---------------- otros ----------------
    async function download() {
      const blob = await getAssetBlob(item.file);
      if (!blob) return toast('El PDF no está disponible sin conexión');
      const a = h('a', { href: URL.createObjectURL(blob), download: `${item.title || 'documento'}.pdf` });
      document.body.append(a);
      a.click();
      a.remove();
    }

    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') close();
      else if (mod && e.key.toLowerCase() === 'z') e.shiftKey ? doRedo() : doUndo();
      else if (mod && e.key.toLowerCase() === 'y') doRedo();
      else if (mod && (e.key === '+' || e.key === '=')) setZoom(zoom * 1.2);
      else if (mod && e.key === '-') setZoom(zoom / 1.2);
      else if (!mod && e.key === 'p') setTool('pen');
      else if (!mod && e.key === 'm') setTool('marker');
      else if (!mod && e.key === 'e') setTool('eraser');
      else if (!mod && e.key === 'v') setTool('text');
      else return e.stopPropagation();
      e.preventDefault();
      e.stopPropagation();
    }
    scroller.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoom(zoom * Math.exp(-e.deltaY * 0.01));
      },
      { passive: false },
    );

    const ro = new ResizeObserver(() => layout());
    function finish(r: PdfViewerResult) {
      save.flush?.();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('selectionchange', showSelBarSoon);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      task?.destroy?.();
      resolve(r);
    }
    function close() {
      finish({ action: 'close' });
    }

    // ---------------- arranque ----------------
    document.body.append(root);
    window.addEventListener('keydown', onKey, true);
    setTool('text');
    refreshButtons();
    buildPages();
    ro.observe(scroller);
    updatePageLabel();
    (async () => {
      try {
        pdfjs = await loadPdfjs();
        const blob = await getAssetBlob(item.file);
        if (!blob) throw new Error('El PDF no está disponible sin conexión con el NAS');
        task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        pdf = await task.promise;
        loading.remove();
        pages.forEach((p) => io.observe(p.el));
        queueVisible();
      } catch (e: any) {
        loading.textContent = e?.message || 'No se pudo abrir el PDF';
      }
    })();
  });
}
