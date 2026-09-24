// Pizarra infinita: render en dos capas, herramientas, gestos táctiles, selección y post-its.
import type { Item, NoteItem, ProjectMeta, Rect, StrokeItem, Tool } from '../types';
import { settings, saveSettings } from '../settings';
import { clamp, distToSeg, h, normRect, rectsIntersect, toast, uid, unionRect } from '../util';
import { icons } from '../ui/icons';
import { askText } from '../ui/dialogs';
import { BoardDoc } from './doc';
import { StrokeCapture, isPenEraser } from './capture';
import { drawItem, drawStroke, itemBounds, NOTE_COLORS, PEN_COLORS, renderToCanvas } from './render';
import { openNoteEditor } from './noteEditor';
import { SyncClient, type SyncStatus } from '../sync';
import { remote, upsertLocalProject } from '../store';

interface View {
  x: number; // mundo visible en la esquina superior izquierda
  y: number;
  zoom: number;
}

type Gesture =
  | { t: 'draw'; id: number; cap: StrokeCapture; tool: 'pen' | 'marker'; start: number }
  | { t: 'erase'; id: number; hit: Set<string> }
  | { t: 'pan'; id: number; sx: number; sy: number; vx: number; vy: number }
  | { t: 'pinch'; startDist: number; startZoom: number; world: [number, number] }
  | { t: 'marquee'; id: number; x0: number; y0: number; x1: number; y1: number }
  | {
      t: 'move';
      id: number;
      sx: number;
      sy: number;
      dx: number;
      dy: number;
      moved: boolean;
      tapOn?: string;
      wasSelected: boolean;
    }
  | { t: 'resize'; id: number; note: NoteItem; sx: number; sy: number; w: number; h: number }
  | { t: 'note'; id: number; sx: number; sy: number };

const SIZES: Record<'pen' | 'marker' | 'eraser', number[]> = {
  pen: [2, 4, 8],
  marker: [12, 22, 36],
  eraser: [12, 28, 56],
};
const BG = '#faf9f6';

export class BoardView {
  root: HTMLElement;
  private base: HTMLCanvasElement;
  private over: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  view: View = { x: 0, y: 0, zoom: 1 };

  tool: Tool = 'pen';
  color = PEN_COLORS[0];
  sizeIdx: Record<'pen' | 'marker' | 'eraser', number> = { pen: 1, marker: 1, eraser: 1 };
  selection = new Set<string>();

  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private g: Gesture | null = null;
  private hidden = new Set<string>(); // ocultos en la capa base durante mover/borrar
  private baseDirty = true;
  private raf = 0;
  private spaceDown = false;
  private hover: [number, number] | null = null;
  private lastTap = { id: '', t: 0 };

  private sync: SyncClient;
  private unsub: () => void;
  private els: Record<string, HTMLElement> = {};
  private ro: ResizeObserver;
  private editing = false;

  constructor(
    public doc: BoardDoc,
    public meta: ProjectMeta,
    private onExit: () => void,
  ) {
    this.base = h('canvas', { class: 'layer' });
    this.over = h('canvas', { class: 'layer over' });
    this.bctx = this.base.getContext('2d')!;
    this.octx = this.over.getContext('2d')!;
    this.root = h('div', { class: 'board' }, this.base, this.over);
    this.buildUI();
    this.loadView();

    this.unsub = doc.subscribe(() => {
      // la selección puede apuntar a elementos borrados remotamente
      for (const id of this.selection) if (!doc.get(id)) this.selection.delete(id);
      this.baseDirty = true;
      this.schedule();
      this.refreshUI();
    });

    this.sync = new SyncClient(meta.id, meta.name, {
      allItems: () => doc.items.values(),
      applyRemote: (items) => doc.applyRemote(items),
      onStatus: (s) => this.setStatus(s),
      onMeta: (m) => {
        this.meta = { ...this.meta, name: m.name };
        this.els.title.textContent = m.name;
      },
      onRemoved: () => {
        toast('Este proyecto se eliminó en otro dispositivo');
        this.exit();
      },
    });
    doc.onLocalChange = (items) => this.sync.push(items);

    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.root);
  }

  // ------------------------------------------------------------------ UI
  private buildUI() {
    const e = this.els;
    const toolBtn = (t: Tool, icon: string, title: string) =>
      (e['tool-' + t] = h('button', { class: 'tb', title, html: icon, onclick: () => this.setTool(t) }));

    e.title = h('button', { class: 'title', title: 'Renombrar', onclick: () => this.rename() }, this.meta.name);
    e.status = h('span', { class: 'status', title: '' });
    e.undo = h('button', { class: 'tb', title: 'Deshacer (Ctrl+Z)', html: icons.undo, onclick: () => this.doc.undo() });
    e.redo = h('button', { class: 'tb', title: 'Rehacer (Ctrl+Y)', html: icons.redo, onclick: () => this.doc.redo() });
    e.penOnly = h('button', {
      class: 'tb',
      title: 'Modo lápiz: el dedo solo mueve la pizarra',
      html: icons.stylus,
      onclick: () => {
        settings.penOnly = !settings.penOnly;
        settings.penAutoDetected = true;
        saveSettings();
        toast(settings.penOnly ? 'Modo lápiz: dibuja con el lápiz, mueve con el dedo' : 'Modo dedo: el dedo también dibuja');
        this.refreshUI();
      },
    });
    e.menu = h('div', { class: 'menu hidden' });

    const top = h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'tb', title: 'Proyectos', html: icons.back, onclick: () => this.exit() }),
      e.title,
      e.status,
      h('div', { class: 'grow' }),
      e.undo,
      e.redo,
      e.penOnly,
      h(
        'div',
        { class: 'menu-wrap' },
        h('button', {
          class: 'tb',
          title: 'Más',
          html: icons.more,
          onclick: (ev: Event) => (ev.stopPropagation(), this.toggleMenu()),
        }),
        e.menu,
      ),
    );

    e.colors = h('div', { class: 'swatches' });
    e.sizes = h('div', { class: 'sizes' });
    const tools = h(
      'div',
      { class: 'toolbar main-tools' },
      toolBtn('pen', icons.pen, 'Lápiz (P)'),
      toolBtn('marker', icons.marker, 'Rotulador (M)'),
      toolBtn('eraser', icons.eraser, 'Borrador (E)'),
      toolBtn('select', icons.select, 'Seleccionar / mover (V)'),
      toolBtn('hand', icons.hand, 'Mover pizarra (H, o espacio)'),
      toolBtn('note', icons.note, 'Post-it (N)'),
      (e.sep1 = h('div', { class: 'sep' })),
      e.colors,
      (e.sep2 = h('div', { class: 'sep' })),
      e.sizes,
    );

    e.zoomLabel = h('button', { class: 'zoom-label', title: 'Restablecer zoom', onclick: () => this.zoomTo(1) }, '100%');
    const zoom = h(
      'div',
      { class: 'zoombar' },
      h('button', { class: 'tb', title: 'Alejar', html: icons.minus, onclick: () => this.zoomBy(1 / 1.25) }),
      e.zoomLabel,
      h('button', { class: 'tb', title: 'Acercar', html: icons.plus, onclick: () => this.zoomBy(1.25) }),
      h('button', { class: 'tb', title: 'Ver todo', html: icons.fit, onclick: () => this.fitContent() }),
    );

    e.selbar = h('div', { class: 'selbar hidden' });

    this.root.append(top, tools, zoom, e.selbar);
    document.addEventListener('click', this.closeMenu);
    this.refreshUI();
  }

  private closeMenu = () => this.els.menu?.classList.add('hidden');

  private toggleMenu() {
    const m = this.els.menu;
    const item = (icon: string, label: string, fn: () => void) =>
      h('button', { class: 'mi', onclick: () => (this.closeMenu(), fn()) }, h('span', { html: icon }), label);
    m.replaceChildren(
      item(icons.fit, 'Ver todo', () => this.fitContent()),
      item(icons.image, 'Exportar PNG', () => this.exportPng()),
      item(icons.edit, 'Renombrar proyecto', () => this.rename()),
      h('div', { class: 'mi-sep' }),
      h(
        'label',
        { class: 'mi' },
        h('span', { html: icons.settings }),
        'Rueda del ratón: ',
        h(
          'select',
          {
            onchange: (ev: Event) => {
              settings.wheel = (ev.target as HTMLSelectElement).value as any;
              saveSettings();
            },
            onclick: (ev: Event) => ev.stopPropagation(),
          },
          h('option', { value: 'zoom', selected: settings.wheel === 'zoom' }, 'zoom'),
          h('option', { value: 'pan', selected: settings.wheel === 'pan' }, 'desplazar'),
        ),
      ),
    );
    m.classList.toggle('hidden');
  }

  private refreshUI() {
    const e = this.els;
    for (const t of ['pen', 'marker', 'eraser', 'select', 'hand', 'note'] as Tool[])
      e['tool-' + t].classList.toggle('on', this.tool === t);
    e.undo.toggleAttribute('disabled', !this.doc.canUndo());
    e.redo.toggleAttribute('disabled', !this.doc.canRedo());
    e.penOnly.classList.toggle('on', settings.penOnly);
    e.zoomLabel.textContent = Math.round(this.view.zoom * 100) + '%';

    const drawing = this.tool === 'pen' || this.tool === 'marker' || this.tool === 'eraser';
    e.colors.style.display = this.tool === 'pen' || this.tool === 'marker' ? '' : 'none';
    e.sizes.style.display = drawing ? '' : 'none';
    e.sep1.style.display = e.colors.style.display;
    e.sep2.style.display = e.sizes.style.display;
    e.colors.replaceChildren(
      ...PEN_COLORS.map((c) =>
        h('button', {
          class: 'sw' + (c === this.color ? ' on' : ''),
          style: `--c:${c}`,
          title: c,
          onclick: () => ((this.color = c), this.refreshUI()),
        }),
      ),
    );
    if (drawing) {
      const t = this.tool as 'pen' | 'marker' | 'eraser';
      e.sizes.replaceChildren(
        ...[0, 1, 2].map((i) =>
          h(
            'button',
            {
              class: 'sz' + (this.sizeIdx[t] === i ? ' on' : ''),
              title: `Grosor ${i + 1}`,
              onclick: () => ((this.sizeIdx[t] = i), this.refreshUI()),
            },
            h('span', { style: `width:${6 + i * 5}px;height:${6 + i * 5}px` }),
          ),
        ),
      );
    }
    this.refreshSelbar();
  }

  private refreshSelbar() {
    const bar = this.els.selbar;
    const sel = [...this.selection].map((id) => this.doc.get(id)).filter(Boolean) as Item[];
    if (!sel.length || (this.g && (this.g.t === 'move' || this.g.t === 'resize'))) {
      bar.classList.add('hidden');
      return;
    }
    const strokes = sel.filter((i) => i.kind === 'stroke') as StrokeItem[];
    const notes = sel.filter((i) => i.kind === 'note') as NoteItem[];
    const btn = (icon: string, label: string, fn: () => void, cls = '') =>
      h('button', { class: 'sb ' + cls, title: label, onclick: fn }, h('span', { html: icon }), h('em', {}, label));
    bar.replaceChildren(
      ...[
        notes.length === 1 && sel.length === 1 ? btn(icons.edit, 'Dibujar', () => this.editNote(notes[0].id)) : null,
        strokes.length ? btn(icons.sticky, 'Hacer post-it', () => this.strokesToNote()) : null,
      ].filter((x): x is HTMLButtonElement => !!x),
      ...(notes.length
        ? [
            h(
              'div',
              { class: 'swatches' },
              ...NOTE_COLORS.map((c) =>
                h('button', {
                  class: 'sw sq',
                  style: `--c:${c}`,
                  title: 'Color del post-it',
                  onclick: () => this.doc.commit(notes.map((n) => ({ ...(this.doc.get(n.id) as NoteItem), color: c }))),
                }),
              ),
            ),
          ]
        : []),
      btn(icons.copy, 'Duplicar', () => this.duplicate()),
      btn(icons.front, 'Al frente', () => this.bringToFront()),
      btn(icons.trash, 'Borrar', () => this.deleteSelection(), 'danger'),
    );
    bar.classList.remove('hidden');
  }

  private setStatus(s: SyncStatus) {
    const labels: Record<SyncStatus, string> = {
      local: 'Solo en este dispositivo (configura el NAS en Ajustes)',
      connecting: 'Conectando con el NAS…',
      online: 'Sincronizado con el NAS',
      offline: 'Sin conexión: los cambios se guardan y se subirán al reconectar',
    };
    this.els.status.className = 'status ' + s;
    this.els.status.title = labels[s];
  }

  setTool(t: Tool) {
    this.tool = t;
    if (t !== 'select') this.selection.clear();
    this.over.style.cursor = t === 'hand' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    this.refreshUI();
    this.schedule();
  }

  // ------------------------------------------------------------------ vista
  private loadView() {
    try {
      const v = JSON.parse(localStorage.getItem('canvaspp.view.' + this.meta.id) || 'null');
      if (v && isFinite(v.zoom)) this.view = v;
    } catch {}
  }
  private saveView() {
    try {
      localStorage.setItem('canvaspp.view.' + this.meta.id, JSON.stringify(this.view));
    } catch {}
  }

  private resize() {
    const r = this.root.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    for (const c of [this.base, this.over]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
      c.style.width = r.width + 'px';
      c.style.height = r.height + 'px';
    }
    this.baseDirty = true;
    this.renderNow();
  }

  toWorld(cx: number, cy: number): [number, number] {
    const r = this.over.getBoundingClientRect();
    return [(cx - r.left) / this.view.zoom + this.view.x, (cy - r.top) / this.view.zoom + this.view.y];
  }

  private localXY(cx: number, cy: number): [number, number] {
    const r = this.over.getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  }

  private zoomAt(sx: number, sy: number, zoom: number) {
    zoom = clamp(zoom, 0.05, 8);
    const wx = sx / this.view.zoom + this.view.x;
    const wy = sy / this.view.zoom + this.view.y;
    this.view = { zoom, x: wx - sx / zoom, y: wy - sy / zoom };
    this.viewChanged();
  }

  zoomBy(f: number) {
    this.zoomAt(this.w / 2, this.h / 2, this.view.zoom * f);
  }
  zoomTo(z: number) {
    this.zoomAt(this.w / 2, this.h / 2, z);
  }

  fitContent() {
    let r: Rect | null = null;
    for (const it of this.doc.visible()) r = unionRect(r, itemBounds(it));
    if (!r) {
      this.view = { x: -this.w / 2, y: -this.h / 2, zoom: 1 };
      return this.viewChanged();
    }
    const pad = 80;
    const zoom = clamp(Math.min((this.w - pad * 2) / r.w, (this.h - pad * 2) / r.h), 0.05, 2);
    this.view = { zoom, x: r.x + r.w / 2 - this.w / 2 / zoom, y: r.y + r.h / 2 - this.h / 2 / zoom };
    this.viewChanged();
  }

  private viewChanged() {
    this.baseDirty = true;
    this.els.zoomLabel.textContent = Math.round(this.view.zoom * 100) + '%';
    this.schedule();
    this.saveViewSoon();
  }
  private saveViewTimer: any;
  private saveViewSoon() {
    clearTimeout(this.saveViewTimer);
    this.saveViewTimer = setTimeout(() => this.saveView(), 300);
  }

  // ------------------------------------------------------------------ render
  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.renderNow());
  }

  private worldViewport(): Rect {
    return { x: this.view.x, y: this.view.y, w: this.w / this.view.zoom, h: this.h / this.view.zoom };
  }

  private applyWorld(ctx: CanvasRenderingContext2D) {
    const z = this.view.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, -this.view.x * z, -this.view.y * z);
  }

  private renderNow() {
    this.raf = 0;
    if (this.baseDirty) this.renderBase();
    this.renderOverlay();
  }

  private renderBase() {
    this.baseDirty = false;
    const ctx = this.bctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    this.drawGrid(ctx);
    this.applyWorld(ctx);
    const vp = this.worldViewport();
    for (const it of this.doc.visible()) {
      if (this.hidden.has(it.id)) continue;
      if (!rectsIntersect(itemBounds(it), vp)) continue;
      drawItem(ctx, it, this.view.zoom);
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    let step = 32;
    while (step * this.view.zoom < 16) step *= 4;
    const s = step * this.view.zoom * this.dpr;
    const ox = (-this.view.x * this.view.zoom * this.dpr) % s;
    const oy = (-this.view.y * this.view.zoom * this.dpr) % s;
    ctx.fillStyle = '#d9d6cf';
    const r = Math.max(1, 1.1 * this.dpr);
    for (let x = ox < 0 ? ox + s : ox; x < this.base.width; x += s)
      for (let y = oy < 0 ? oy + s : oy; y < this.base.height; y += s) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }

  private renderOverlay() {
    const ctx = this.octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.over.width, this.over.height);
    this.applyWorld(ctx);
    const z = this.view.zoom;
    const g = this.g;

    if (g?.t === 'draw') drawStroke(ctx, g.cap.data, true);

    // elementos en movimiento
    if (g?.t === 'move' && g.moved) {
      ctx.save();
      ctx.translate(g.dx, g.dy);
      for (const id of this.selection) {
        const it = this.doc.get(id);
        if (it) drawItem(ctx, it, z);
      }
      ctx.restore();
    }
    if (g?.t === 'resize') drawItem(ctx, { ...g.note, w: g.w, h: g.h }, z);

    // selección
    if (this.selection.size) {
      const off = g?.t === 'move' ? [g.dx, g.dy] : [0, 0];
      let all: Rect | null = null;
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = '#0090ff';
      for (const id of this.selection) {
        const it = this.doc.get(id);
        if (!it) continue;
        let b = itemBounds(it);
        if (g?.t === 'resize' && g.note.id === id) b = { ...b, w: g.w, h: g.h };
        b = { ...b, x: b.x + off[0], y: b.y + off[1] };
        all = unionRect(all, b);
        ctx.setLineDash([4 / z, 4 / z]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
      ctx.setLineDash([]);
      if (all && this.selection.size > 1) ctx.strokeRect(all.x - 6 / z, all.y - 6 / z, all.w + 12 / z, all.h + 12 / z);
      const single = this.singleSelectedNote();
      if (single && g?.t !== 'move') {
        const hs = this.handleRect(single, g?.t === 'resize' ? g : undefined);
        ctx.fillStyle = '#fff';
        ctx.fillRect(hs.x, hs.y, hs.w, hs.h);
        ctx.strokeRect(hs.x, hs.y, hs.w, hs.h);
      }
    }

    if (g?.t === 'marquee') {
      const r = normRect(g.x0, g.y0, g.x1, g.y1);
      ctx.fillStyle = 'rgba(0,144,255,0.08)';
      ctx.strokeStyle = '#0090ff';
      ctx.lineWidth = 1 / z;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    // cursor del borrador
    if (this.hover && (this.tool === 'eraser' || g?.t === 'erase')) {
      ctx.beginPath();
      ctx.arc(this.hover[0], this.hover[1], this.eraserRadius(), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1 / z;
      ctx.stroke();
    }
  }

  private singleSelectedNote(): NoteItem | null {
    if (this.selection.size !== 1) return null;
    const it = this.doc.get([...this.selection][0]);
    return it?.kind === 'note' ? it : null;
  }

  private handleRect(n: NoteItem, rs?: { w: number; h: number }): Rect {
    const s = 16 / this.view.zoom;
    const w = rs ? rs.w : n.w;
    const hh = rs ? rs.h : n.h;
    return { x: n.x + w - s / 2, y: n.y + hh - s / 2, w: s, h: s };
  }

  // ------------------------------------------------------------------ hit test
  private eraserRadius() {
    return SIZES.eraser[this.sizeIdx.eraser] / 2 / this.view.zoom;
  }

  private strokeHit(s: StrokeItem, x: number, y: number, rad: number) {
    const b = itemBounds(s);
    if (x < b.x - rad || x > b.x + b.w + rad || y < b.y - rad || y > b.y + b.h + rad) return false;
    const p = s.pts;
    const tol = rad + s.size / 2;
    if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= tol;
    for (let i = 0; i < p.length - 3; i += 3) if (distToSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= tol) return true;
    return false;
  }

  private hitTest(x: number, y: number): Item | null {
    const list = this.doc.visible();
    const tol = 6 / this.view.zoom;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.kind === 'note') {
        if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it;
      } else if (this.strokeHit(it, x, y, tol)) return it;
    }
    return null;
  }

  // ------------------------------------------------------------------ entrada
  private bindInput() {
    const c = this.over;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.schedule();
    });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dblclick', (e) => {
      const [x, y] = this.toWorld(e.clientX, e.clientY);
      const it = this.hitTest(x, y);
      if (it?.kind === 'note') this.editNote(it.id);
    });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onDown(e: PointerEvent) {
    if (this.editing) return;
    this.closeMenu();
    this.over.setPointerCapture(e.pointerId);
    const [lx, ly] = this.localXY(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, { x: lx, y: ly, type: e.pointerType });

    // detección automática de lápiz → activar modo lápiz (rechazo de palma)
    if (e.pointerType === 'pen' && !settings.penAutoDetected) {
      settings.penAutoDetected = true;
      settings.penOnly = true;
      saveSettings();
      toast('Lápiz detectado: dibuja con el lápiz y mueve con el dedo');
      this.refreshUI();
    }

    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (e.pointerType === 'touch' && touches.length >= 2) {
      // segundo dedo: cancelar lo que hiciera el primero y empezar pellizco
      if (this.g?.t === 'draw' && Date.now() - this.g.start > 400) {
        // trazo largo con un dedo: se conserva, el segundo dedo se ignora
        return;
      }
      this.cancelGesture();
      this.startPinch();
      return;
    }
    if (this.g) return; // ya hay un gesto en curso con otro puntero

    const [wx, wy] = this.toWorld(e.clientX, e.clientY);
    const panButton = e.button === 1 || (e.pointerType === 'mouse' && e.button === 2);
    const touchPans = e.pointerType === 'touch' && settings.penOnly;

    if (panButton || this.spaceDown || this.tool === 'hand' || touchPans) {
      this.g = { t: 'pan', id: e.pointerId, sx: lx, sy: ly, vx: this.view.x, vy: this.view.y };
      this.over.style.cursor = 'grabbing';
      return;
    }
    if (isPenEraser(e) || this.tool === 'eraser') {
      this.g = { t: 'erase', id: e.pointerId, hit: new Set() };
      this.hover = [wx, wy];
      this.eraseAt(wx, wy);
      return;
    }
    if (this.tool === 'pen' || this.tool === 'marker') {
      const size = SIZES[this.tool][this.sizeIdx[this.tool]] / this.view.zoom;
      const cap = new StrokeCapture(e, (x, y) => this.toWorld(x, y), this.color, size, this.tool, 0.6 / this.view.zoom);
      this.g = { t: 'draw', id: e.pointerId, cap, tool: this.tool, start: Date.now() };
      this.schedule();
      return;
    }
    if (this.tool === 'note') {
      this.g = { t: 'note', id: e.pointerId, sx: lx, sy: ly };
      return;
    }
    if (this.tool === 'select') {
      const single = this.singleSelectedNote();
      if (single) {
        const hr = this.handleRect(single);
        const pad = 8 / this.view.zoom;
        if (wx >= hr.x - pad && wx <= hr.x + hr.w + pad && wy >= hr.y - pad && wy <= hr.y + hr.h + pad) {
          this.g = { t: 'resize', id: e.pointerId, note: single, sx: wx, sy: wy, w: single.w, h: single.h };
          this.hidden = new Set([single.id]);
          this.baseDirty = true;
          this.refreshSelbar();
          this.schedule();
          return;
        }
      }
      const hit = this.hitTest(wx, wy);
      if (hit) {
        const wasSelected = this.selection.has(hit.id);
        if (!wasSelected) {
          if (!e.shiftKey) this.selection.clear();
          this.selection.add(hit.id);
        }
        this.g = { t: 'move', id: e.pointerId, sx: wx, sy: wy, dx: 0, dy: 0, moved: false, tapOn: hit.id, wasSelected };
      } else {
        if (!e.shiftKey) this.selection.clear();
        this.g = { t: 'marquee', id: e.pointerId, x0: wx, y0: wy, x1: wx, y1: wy };
      }
      this.refreshSelbar();
      this.schedule();
    }
  }

  private startPinch() {
    const pts = [...this.pointers.values()].filter((p) => p.type === 'touch').slice(0, 2);
    const [a, b] = pts;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.g = {
      t: 'pinch',
      startDist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      startZoom: this.view.zoom,
      world: [mx / this.view.zoom + this.view.x, my / this.view.zoom + this.view.y],
    };
  }

  private onMove(e: PointerEvent) {
    const [lx, ly] = this.localXY(e.clientX, e.clientY);
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = lx;
      p.y = ly;
    }
    const [wx, wy] = this.toWorld(e.clientX, e.clientY);
    if (e.pointerType !== 'touch') this.hover = [wx, wy];
    const g = this.g;
    if (!g) {
      if (this.tool === 'eraser') this.schedule();
      return;
    }
    if (g.t === 'pinch') {
      const pts = [...this.pointers.values()].filter((q) => q.type === 'touch').slice(0, 2);
      if (pts.length < 2) return;
      const [a, b] = pts;
      const zoom = clamp((g.startZoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.startDist, 0.05, 8);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.view = { zoom, x: g.world[0] - mx / zoom, y: g.world[1] - my / zoom };
      this.viewChanged();
      return;
    }
    if (e.pointerId !== g.id) return;
    switch (g.t) {
      case 'draw':
        g.cap.move(e);
        break;
      case 'erase':
        this.hover = [wx, wy];
        this.eraseAt(wx, wy);
        break;
      case 'pan':
        this.view = { ...this.view, x: g.vx - (lx - g.sx) / this.view.zoom, y: g.vy - (ly - g.sy) / this.view.zoom };
        this.viewChanged();
        break;
      case 'marquee':
        g.x1 = wx;
        g.y1 = wy;
        break;
      case 'move': {
        g.dx = wx - g.sx;
        g.dy = wy - g.sy;
        if (!g.moved && Math.hypot(g.dx, g.dy) * this.view.zoom > 4) {
          g.moved = true;
          this.hidden = new Set(this.selection);
          this.baseDirty = true;
          this.refreshSelbar();
        }
        break;
      }
      case 'resize':
        g.w = Math.max(60, g.note.w + (wx - g.sx));
        g.h = Math.max(60, g.note.h + (wy - g.sy));
        break;
    }
    this.schedule();
  }

  private onUp(e: PointerEvent, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.t === 'pinch') {
      const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
      if (touches.length < 2) this.g = null;
      return;
    }
    if (e.pointerId !== g.id) return;
    this.g = null;
    const [wx, wy] = this.toWorld(e.clientX, e.clientY);

    switch (g.t) {
      case 'draw': {
        if (cancelled) break;
        const data = g.cap.finish();
        const stroke: StrokeItem = { id: uid(), kind: 'stroke', rev: 0, by: '', z: this.doc.nextZ(), ...data };
        this.doc.add([stroke]);
        break;
      }
      case 'erase':
        this.hidden.clear();
        if (g.hit.size) this.doc.remove([...g.hit]);
        this.baseDirty = true;
        break;
      case 'pan':
        this.over.style.cursor = this.tool === 'hand' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
        break;
      case 'marquee': {
        const r = normRect(g.x0, g.y0, g.x1, g.y1);
        if (r.w * this.view.zoom > 3 || r.h * this.view.zoom > 3) {
          for (const it of this.doc.visible()) if (this.inMarquee(it, r)) this.selection.add(it.id);
        }
        break;
      }
      case 'move': {
        this.hidden.clear();
        this.baseDirty = true;
        if (g.moved && !cancelled) {
          const moved: Item[] = [];
          for (const id of this.selection) {
            const it = this.doc.get(id);
            if (!it) continue;
            if (it.kind === 'note') moved.push({ ...it, x: it.x + g.dx, y: it.y + g.dy });
            else {
              const pts = it.pts.slice();
              for (let i = 0; i < pts.length; i += 3) {
                pts[i] = Math.round((pts[i] + g.dx) * 100) / 100;
                pts[i + 1] = Math.round((pts[i + 1] + g.dy) * 100) / 100;
              }
              moved.push({ ...it, pts });
            }
          }
          this.doc.commit(moved);
        } else if (!g.moved && g.tapOn) {
          // toque sobre un post-it ya seleccionado, o doble toque → abrir editor
          const it = this.doc.get(g.tapOn);
          const now = Date.now();
          const dbl = this.lastTap.id === g.tapOn && now - this.lastTap.t < 350;
          this.lastTap = { id: g.tapOn, t: now };
          if (it?.kind === 'note' && (dbl || (g.wasSelected && e.pointerType !== 'mouse'))) this.editNote(it.id);
        }
        break;
      }
      case 'resize': {
        this.hidden.clear();
        this.baseDirty = true;
        const cur = this.doc.get(g.note.id) as NoteItem | undefined;
        if (cur && !cancelled) this.doc.commit([{ ...cur, w: g.w, h: g.h }]);
        break;
      }
      case 'note': {
        const [lx, ly] = this.localXY(e.clientX, e.clientY);
        if (Math.hypot(lx - g.sx, ly - g.sy) < 10 && !cancelled) this.createNoteAt(wx, wy);
        break;
      }
    }
    this.refreshUI();
    this.schedule();
  }

  private cancelGesture() {
    const g = this.g;
    this.g = null;
    if (g?.t === 'erase' || g?.t === 'move' || g?.t === 'resize') {
      this.hidden.clear();
      this.baseDirty = true;
    }
    this.schedule();
  }

  private inMarquee(it: Item, r: Rect) {
    const b = itemBounds(it);
    if (!rectsIntersect(b, r)) return false;
    if (it.kind === 'note') return true;
    for (let i = 0; i < it.pts.length; i += 3) {
      const x = it.pts[i],
        y = it.pts[i + 1];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
  }

  private eraseAt(x: number, y: number) {
    if (this.g?.t !== 'erase') return;
    const rad = this.eraserRadius();
    let changed = false;
    for (const it of this.doc.visible()) {
      if (it.kind !== 'stroke' || this.g.hit.has(it.id)) continue;
      if (this.strokeHit(it, x, y, rad)) {
        this.g.hit.add(it.id);
        this.hidden.add(it.id);
        changed = true;
      }
    }
    if (changed) this.baseDirty = true;
    this.schedule();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const [lx, ly] = this.localXY(e.clientX, e.clientY);
    const pinch = e.ctrlKey || e.metaKey; // pellizco en touchpad llega como ctrl+wheel
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
    if (pinch || (settings.wheel === 'zoom' && !e.shiftKey)) {
      this.zoomAt(lx, ly, this.view.zoom * Math.exp(-dy * (pinch ? 0.01 : 0.0015)));
    } else {
      const sx = e.shiftKey && !dx ? dy : dx;
      const sy = e.shiftKey && !dx ? 0 : dy;
      this.view = { ...this.view, x: this.view.x + sx / this.view.zoom, y: this.view.y + sy / this.view.zoom };
      this.viewChanged();
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.editing) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.over.style.cursor = 'grab';
      }
    } else if (mod && k === 'z') e.shiftKey ? this.doc.redo() : this.doc.undo();
    else if (mod && k === 'y') this.doc.redo();
    else if (mod && k === 'a') {
      this.setTool('select');
      for (const it of this.doc.visible()) this.selection.add(it.id);
      this.refreshUI();
    } else if (mod && k === 'd') this.duplicate();
    else if (mod && (k === '0' || k === '1')) this.zoomTo(1);
    else if (mod && (k === '=' || k === '+')) this.zoomBy(1.25);
    else if (mod && k === '-') this.zoomBy(1 / 1.25);
    else if (mod) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelection();
    else if (e.key === 'Escape') {
      this.selection.clear();
      this.refreshUI();
    } else if (k === 'p') this.setTool('pen');
    else if (k === 'm') this.setTool('marker');
    else if (k === 'e') this.setTool('eraser');
    else if (k === 'v') this.setTool('select');
    else if (k === 'h') this.setTool('hand');
    else if (k === 'n') this.setTool('note');
    else if (k === 'f') this.fitContent();
    else return;
    e.preventDefault();
    this.schedule();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      this.spaceDown = false;
      this.over.style.cursor = this.tool === 'hand' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
    }
  };

  // ------------------------------------------------------------------ acciones
  private async createNoteAt(wx: number, wy: number) {
    const size = 240 / this.view.zoom;
    const note: NoteItem = {
      id: uid(),
      kind: 'note',
      rev: 0,
      by: '',
      z: 0,
      x: wx - size / 2,
      y: wy - size / 2,
      w: size,
      h: size,
      color: NOTE_COLORS[0],
      text: '',
      baseW: 240,
      baseH: 240,
      strokes: [],
    };
    this.editing = true;
    const r = await openNoteEditor(note, { isNew: true });
    this.editing = false;
    if (r.action === 'save' && r.note && (r.note.strokes.length || r.note.text.trim())) {
      const saved = { ...r.note, z: this.doc.nextZ() };
      this.doc.add([saved]);
      this.setTool('select');
      this.selection = new Set([saved.id]);
      this.refreshUI();
    }
  }

  async editNote(id: string) {
    const n = this.doc.get(id);
    if (n?.kind !== 'note' || this.editing) return;
    this.editing = true;
    const r = await openNoteEditor(n, { isNew: false });
    this.editing = false;
    const cur = this.doc.get(id) as NoteItem | undefined;
    if (!cur) return;
    if (r.action === 'save' && r.note) {
      this.doc.commit([{ ...cur, strokes: r.note.strokes, text: r.note.text, color: r.note.color }]);
    } else if (r.action === 'delete') {
      this.doc.remove([id]);
    }
  }

  /** Convierte los trazos seleccionados en un post-it que los contiene. */
  strokesToNote() {
    const strokes = [...this.selection].map((id) => this.doc.get(id)).filter((i): i is StrokeItem => i?.kind === 'stroke');
    if (!strokes.length) return;
    let r: Rect | null = null;
    for (const s of strokes) r = unionRect(r, itemBounds(s));
    const pad = 16 / this.view.zoom;
    r = {
      x: r!.x - pad,
      y: r!.y - pad,
      w: Math.max(r!.w + pad * 2, 80 / this.view.zoom),
      h: Math.max(r!.h + pad * 2, 80 / this.view.zoom),
    };
    const note: NoteItem = {
      id: uid(),
      kind: 'note',
      rev: 0,
      by: '',
      z: this.doc.nextZ(),
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      color: NOTE_COLORS[0],
      text: '',
      baseW: r.w,
      baseH: r.h,
      strokes: strokes
        .sort((a, b) => a.z - b.z)
        .map((s) => ({
          color: s.color === '#ffffff' ? '#1f2328' : s.color,
          size: s.size,
          tool: s.tool,
          pressure: s.pressure,
          pts: s.pts.map((v, i) =>
            i % 3 === 0 ? Math.round((v - r!.x) * 100) / 100 : i % 3 === 1 ? Math.round((v - r!.y) * 100) / 100 : v,
          ),
        })),
    };
    this.doc.commit([...strokes.map((s) => ({ ...s, deleted: true }) as Item), note]);
    this.selection = new Set([note.id]);
    this.refreshUI();
    toast('Sketch convertido en post-it');
  }

  duplicate() {
    const sel = [...this.selection].map((id) => this.doc.get(id)).filter(Boolean) as Item[];
    if (!sel.length) return;
    const off = 24 / this.view.zoom;
    const copies: Item[] = sel
      .sort((a, b) => a.z - b.z)
      .map((it) => {
        const id = uid();
        const z = this.doc.nextZ();
        if (it.kind === 'note') return { ...it, id, z, x: it.x + off, y: it.y + off, deleted: undefined };
        return { ...it, id, z, deleted: undefined, pts: it.pts.map((v, i) => (i % 3 === 2 ? v : v + off)) };
      });
    this.doc.add(copies);
    this.selection = new Set(copies.map((c) => c.id));
    this.refreshUI();
  }

  bringToFront() {
    const sel = [...this.selection].map((id) => this.doc.get(id)).filter(Boolean) as Item[];
    this.doc.commit(sel.sort((a, b) => a.z - b.z).map((it) => ({ ...it, z: this.doc.nextZ() })));
  }

  deleteSelection() {
    if (!this.selection.size) return;
    this.doc.remove([...this.selection]);
    this.selection.clear();
    this.refreshUI();
  }

  private async rename() {
    const name = await askText('Renombrar proyecto', this.meta.name);
    if (!name || name === this.meta.name) return;
    this.meta = { ...this.meta, name };
    this.els.title.textContent = name;
    await upsertLocalProject({ ...this.meta });
    remote.rename(this.meta.id, name).catch(() => {});
  }

  private exportPng() {
    const c = renderToCanvas(this.doc.visible(), 4096);
    if (!c) return toast('La pizarra está vacía');
    const a = h('a', { href: c.toDataURL('image/png'), download: `${this.meta.name || 'canvas'}.png` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  private exiting = false;
  async exit() {
    if (this.exiting) return;
    this.exiting = true;
    await this.saveThumbAndMeta();
    this.destroy();
    this.onExit();
  }

  async saveThumbAndMeta() {
    this.doc.flush();
    this.saveView();
    const items = this.doc.visible();
    const c = renderToCanvas(items, 360);
    await upsertLocalProject({
      ...this.meta,
      updatedAt: Date.now(),
      itemCount: items.length,
      thumb: c ? c.toDataURL('image/jpeg', 0.75) : undefined,
    });
  }

  destroy() {
    this.sync.close();
    this.unsub();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('click', this.closeMenu);
    this.root.remove();
  }
}
