// Pizarra infinita: render en dos capas, herramientas, gestos táctiles, selección y post-its.
import type {
  AudioItem,
  BoxItem,
  ConnectorEnd,
  ConnectorItem,
  LayerItem,
  DocItem,
  FrameItem,
  ImageItem,
  Item,
  LinkItem,
  NoteItem,
  PdfItem,
  ProjectMeta,
  Rect,
  ShapeItem,
  ShapeKind,
  StrokeItem,
  TableItem,
  TextItem,
  TodoItem,
  Tool,
} from '../types';
import { settings, saveSettings } from '../settings';
import { clamp, distToSeg, h, normRect, rectContains, rectsIntersect, toast, uid, unionRect } from '../util';
import { icons } from '../ui/icons';
import { askText } from '../ui/dialogs';
import { BoardDoc } from './doc';
import { StrokeCapture, isPenEraser } from './capture';
import {
  DOC_BASE_H,
  DOC_BASE_W,
  baseBounds,
  drawItem,
  drawStroke,
  itemBounds,
  itemCenter,
  rotatePoint,
  toItemSpace,
  NOTE_COLORS,
  PEN_COLORS,
  renderToCanvas,
  reshapeNote,
  setRedrawHook,
  TEXT_FONT,
  TEXT_LINE,
} from './render';
import { countPages, openDocEditor } from '../docs/editor';
import {
  audioButtonAt,
  commentRadius,
  connectorHit,
  drawConnector,
} from './extra';
import {
  domainOf,
  FRAME_COLORS,
  frameHeader,
  isBox,
  LINK_BASE_H,
  LINK_BASE_W,
  resizeMode,
  shapeHit,
  TODO_BASE_W,
  todoCheckAt,
} from './items';
import { editTable, editTodo } from './editors';
import { importPdfFile } from '../pdf/import';
import { addAsset, downscaleImage, imageSize, uploadPending } from '../assets';
import { platform } from '../updates';
import { IMPORT_ACCEPT, importFile, pickFile, pickFiles } from '../docs/importers';
import { openNoteEditor } from './noteEditor';
import { SyncClient, type SyncStatus } from '../sync';
import { setItemResolver, getPlaying } from './extra';
import { Presence } from '../features/presence';
import { Minimap } from '../features/minimap';
import { loadActiveLayer, openLayers } from '../features/layers';
import { addBookmark, goBookmark, openBookmarks } from '../features/bookmarks';
import { openSearch } from '../features/search';
import { startPresentation } from '../features/present';
import { createComment as createCommentFn, openComment as openCommentFn, openCommentsPanel } from '../features/comments';
import { openHistory } from '../features/history';
import { openShare } from '../features/share';
import { insertVideo, openVideo, recordVoice, toggleAudio as toggleAudioFn } from '../features/media';
import { editMath } from '../features/math';
import { copyCode, createChart, editChart, editCode, pickEmoji } from '../features/content';
import { saveAsTemplate } from '../features/saveTemplate';
import { recognizeStroke } from '../features/recognize';
import { exportAnnotatedPdf, exportBoardPdf, exportDocPdf, saveFile } from '../features/exporter';
import { closePanels } from '../features/panel';
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
  | {
      t: 'resize';
      id: number;
      note: BoxItem;
      sx: number;
      sy: number;
      w: number;
      h: number;
      ax: number; // esquina fija (arriba-izquierda girada) en el mundo
      ay: number;
      nx?: number; // nueva posición calculada
      ny?: number;
    }
  | { t: 'rotate'; id: number; item: Item; cx: number; cy: number; a0: number; rot0: number; rot: number }
  | { t: 'connector'; id: number; from: ConnectorEnd; x1: number; y1: number }
  | { t: 'laser'; id: number }
  | { t: 'place'; id: number; sx: number; sy: number; tool: 'note' | 'text' | 'doc' | 'comment' }
  | { t: 'shape'; id: number; x0: number; y0: number; x1: number; y1: number };

/** Grosores rápidos (px de pantalla); con el deslizador se puede elegir cualquiera. */
const SIZES: Record<'pen' | 'marker' | 'eraser', number[]> = {
  pen: [1.5, 3, 5, 9, 16],
  marker: [8, 14, 22, 36, 56],
  eraser: [10, 20, 32, 56, 96],
};
const BG = '#faf9f6';

export class BoardView {
  root: HTMLElement;
  base: HTMLCanvasElement;
  over: HTMLCanvasElement;
  bctx: CanvasRenderingContext2D;
  octx: CanvasRenderingContext2D;
  dpr = 1;
  w = 0;
  h = 0;
  view: View = { x: 0, y: 0, zoom: 1 };

  tool: Tool = 'pen';
  color = PEN_COLORS[0];
  sizeVal: Record<'pen' | 'marker' | 'eraser', number> = { pen: 3, marker: 22, eraser: 32 };
  selection = new Set<string>();
  shapeKind: ShapeKind = 'rect';
  activeLayer: string | undefined;
  movingConnectors: ConnectorItem[] = [];
  presence: Presence;
  minimap: Minimap;
  presenting = false;
  private animRaf = 0;
  readOnly = false;
  member = false; // proyecto compartido con tu cuenta (en solo lectura también ven tu cursor)
  private shownCache: Item[] | null = null;

  /** Capas ordenadas (la principal no es un elemento: es la de los elementos sin capa). */
  layers(): LayerItem[] {
    return (this.doc.visible().filter((i) => i.kind === 'layer') as LayerItem[]).sort((a, b) => a.order - b.order);
  }

  /** Elementos que se dibujan: sin capas ocultas, ordenados por capa, marcos al fondo y z. */
  shown(): Item[] {
    if (this.shownCache) return this.shownCache;
    const layers = this.layers();
    const order = new Map(layers.map((l) => [l.id, l.order]));
    const hidden = new Set(layers.filter((l) => l.hidden).map((l) => l.id));
    const list = this.doc
      .visible()
      .filter((i) => i.kind !== 'layer' && i.kind !== 'bookmark' && !(i.layer && hidden.has(i.layer)));
    const lo = (i: Item) => (i.layer && order.has(i.layer) ? order.get(i.layer)! : 0);
    list.sort((a, b) => lo(a) - lo(b) || (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1) || a.z - b.z);
    this.shownCache = list;
    return list;
  }

  /** Bloqueado por sí mismo o por su capa. */
  isLocked(it: Item) {
    if (it.locked) return true;
    if (!it.layer) return false;
    const l = this.doc.get(it.layer);
    return l?.kind === 'layer' && l.lockedLayer;
  }

  pointers = new Map<number, { x: number; y: number; type: string }>();
  g: Gesture | null = null;
  hidden = new Set<string>(); // ocultos en la capa base durante mover/borrar
  baseDirty = true;
  raf = 0;
  spaceDown = false;
  hover: [number, number] | null = null;
  lastTap = { id: '', t: 0 };

  sync: SyncClient;
  unsub: () => void;
  els: Record<string, HTMLElement> = {};
  ro: ResizeObserver;
  editing = false;

  constructor(
    public doc: BoardDoc,
    public meta: ProjectMeta,
    private onExit: () => void,
    opts: { readOnly?: boolean; share?: string; member?: boolean } = {},
  ) {
    this.readOnly = !!opts.readOnly;
    this.member = !!opts.member;
    doc.readOnly = this.readOnly;
    this.base = h('canvas', { class: 'layer' });
    this.over = h('canvas', { class: 'layer over' });
    this.bctx = this.base.getContext('2d')!;
    this.octx = this.over.getContext('2d')!;
    this.root = h('div', { class: 'board' }, this.base, this.over);
    this.buildUI();
    this.loadView();

    this.unsub = doc.subscribe(() => {
      this.shownCache = null;
      this.minimap?.update();
      // la selección puede apuntar a elementos borrados remotamente
      for (const id of this.selection) if (!doc.get(id)) this.selection.delete(id);
      this.baseDirty = true;
      this.schedule();
      this.refreshUI();
    });

    this.presence = new Presence(this);
    this.minimap = new Minimap(this);
    setItemResolver((id) => this.doc.get(id));
    doc.defaultLayer = () => this.activeLayer;
    loadActiveLayer(this);
    this.sync = new SyncClient(meta.id, meta.name, {
      onPresence: (m) => this.presence.onMessage(m),
      allItems: () => doc.items.values(),
      applyRemote: (items) => doc.applyRemote(items),
      onStatus: (s) => {
        this.setStatus(s);
        if (s === 'online') uploadPending();
      },
      onMeta: (m) => {
        this.meta = { ...this.meta, name: m.name };
        this.els.title.textContent = m.name;
      },
      onRemoved: () => {
        toast('Este proyecto se eliminó en otro dispositivo');
        this.exit();
      },
      onReadOnly: () => {
        // te han cambiado el permiso a "solo ver" mientras lo tenías abierto
        if (this.readOnly) return;
        toast('Ahora solo tienes permiso para ver este proyecto');
        this.meta = { ...this.meta, access: 'view' };
        this.exit();
      },
    }, opts.share);
    doc.onLocalChange = (items) => this.sync.push(items);
    if (this.readOnly) {
      this.root.classList.add('readonly');
      if (opts.member) this.root.classList.add('member'); // compartido contigo para ver: puede volver a proyectos y exportar
      this.tool = 'hand';
    }

    setRedrawHook(() => {
      this.baseDirty = true;
      this.schedule();
    });
    this.root.append(this.minimap.el);
    this.minimap.el.classList.toggle('hidden', !settings.minimap);
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.root);
  }

  // ------------------------------------------------------------------ UI
  buildUI() {
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
      h('button', { class: 'tb', title: 'Buscar (Ctrl+F)', html: icons.search, onclick: () => openSearch(this) }),
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
    e.insertPanel = this.buildInsertPanel();
    e.insertBtn = h('button', {
      class: 'tb',
      title: 'Insertar: documento, PDF, imagen, tabla, formas…',
      html: icons.insert,
      onclick: (ev: Event) => {
        ev.stopPropagation();
        e.insertPanel.classList.toggle('hidden');
      },
    });
    e.sizes = h('div', { class: 'sizes' });
    const tools = h(
      'div',
      { class: 'toolbar main-tools' },
      toolBtn('pen', icons.pen, 'Lápiz (P)'),
      toolBtn('marker', icons.marker, 'Rotulador (M)'),
      toolBtn('eraser', icons.eraser, 'Borrador (E)'),
      toolBtn('select', icons.select, 'Seleccionar / mover (V)'),
      toolBtn('hand', icons.hand, 'Mover pizarra (H, o espacio)'),
      toolBtn('laser', icons.laser, 'Puntero láser (L): se ve en los demás dispositivos'),
      toolBtn('note', icons.note, 'Post-it (N)'),
      toolBtn('text', icons.text, 'Texto (T)'),
      e.insertBtn,
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
      h('button', {
        class: 'tb',
        title: 'Minimapa',
        html: icons.map,
        onclick: () => {
          settings.minimap = !settings.minimap;
          saveSettings();
          this.minimap.el.classList.toggle('hidden', !settings.minimap);
          this.minimap.draw();
        },
      }),
    );

    e.selbar = h('div', { class: 'selbar hidden' });

    this.root.append(top, tools, zoom, e.selbar, e.insertPanel);
    document.addEventListener('click', this.closeMenu);
    this.refreshUI();
  }

  closeMenu = () => {
    this.els.menu?.classList.add('hidden');
    this.els.insertPanel?.classList.add('hidden');
  };

  /** Panel "Insertar": documentos, contenido y formas. */
  buildInsertPanel() {
    const it = (icon: string, label: string, fn: () => void) =>
      h(
        'button',
        {
          class: 'ip-item',
          onclick: (ev: Event) => {
            ev.stopPropagation();
            this.els.insertPanel.classList.add('hidden');
            fn();
          },
        },
        h('span', { html: icon }),
        h('em', {}, label),
      );
    const shape = (k: ShapeKind, icon: string, label: string) =>
      it(icon, label, () => {
        this.shapeKind = k;
        this.setTool('shape');
        toast('Arrastra en la pizarra para dibujar la forma');
      });
    return h(
      'div',
      { class: 'insert-panel hidden', onclick: (ev: Event) => ev.stopPropagation() },
      h('div', { class: 'ip-title' }, 'Documentos'),
      h(
        'div',
        { class: 'ip-grid' },
        it(icons.doc, 'Documento nuevo', () => this.createDocAt(...this.viewCenter())),
        it(icons.upload, 'Importar Word / PDF', () => this.importDocument()),
        it(icons.image, 'Imagen', () => this.insertImages()),
      ),
      h('div', { class: 'ip-title' }, 'Contenido'),
      h(
        'div',
        { class: 'ip-grid four' },
        it(icons.table, 'Tabla', () => this.insertTable()),
        it(icons.todo, 'Tareas', () => this.insertTodo()),
        it(icons.link, 'Enlace', () => this.insertLink()),
        it(icons.frame, 'Marco', () => this.insertFrame()),
        it(icons.mic, 'Nota de voz', () => recordVoice(this)),
        it(icons.video, 'Vídeo', () => insertVideo(this)),
        it(icons.sigma, 'Fórmula', () => editMath(this)),
        it(icons.code, 'Código', () => editCode(this)),
        it(icons.emoji, 'Emoji', () => pickEmoji(this)),
        it(icons.comment, 'Comentario', () => {
          this.setTool('comment');
          toast('Toca la pizarra donde quieras dejar el comentario');
        }),
        it(icons.text, 'Texto', () => this.setTool('text')),
        it(icons.sticky, 'Post-it', () => this.setTool('note')),
      ),
      h('div', { class: 'ip-title' }, 'Formas y conectores'),
      h(
        'div',
        { class: 'ip-grid shapes' },
        shape('rect', icons.rect, 'Rectángulo'),
        shape('ellipse', icons.ellipse, 'Elipse'),
        shape('diamond', icons.diamond, 'Rombo'),
        shape('triangle', icons.triangle, 'Triángulo'),
        shape('line', icons.line, 'Línea'),
        shape('arrow', icons.arrow, 'Flecha'),
        it(icons.connector, 'Conector', () => {
          this.setTool('connector');
          toast('Arrastra de un elemento a otro para unirlos');
        }),
      ),
    );
  }

  viewCenter(): [number, number] {
    return [this.view.x + this.w / 2 / this.view.zoom, this.view.y + this.h / 2 / this.view.zoom];
  }

  toggleMenu() {
    const m = this.els.menu;
    const item = (icon: string, label: string, fn: () => void) =>
      h('button', { class: 'mi', onclick: () => (this.closeMenu(), fn()) }, h('span', { html: icon }), label);
    const toggle = (icon: string, label: string, on: boolean, fn: () => void) =>
      h('button', { class: 'mi', onclick: () => (this.closeMenu(), fn()) }, h('span', { html: icon }), label, h('b', { class: 'mi-state' }, on ? 'Sí' : 'No'));
    const sep = (t: string) => h('div', { class: 'mi-sep' }, t);
    if (this.readOnly) {
      m.replaceChildren(
        sep('Ver'),
        item(icons.fit, 'Ver todo', () => this.fitContent()),
        item(icons.present, 'Presentar (marcos como diapositivas)', () => startPresentation(this)),
        sep('Archivo'),
        item(icons.fileExport, 'Exportar PDF (toda la pizarra)', () => exportBoardPdf(this, 'all')),
        item(icons.fileExport, 'Exportar PDF (un marco por página)', () => exportBoardPdf(this, 'frames')),
        item(icons.image, 'Exportar PNG', () => this.exportPng()),
      );
      m.classList.toggle('hidden');
      return;
    }
    m.replaceChildren(
      sep('Ver'),
      item(icons.fit, 'Ver todo', () => this.fitContent()),
      item(icons.layers, 'Capas', () => openLayers(this)),
      item(icons.bookmark, 'Vistas guardadas', () => openBookmarks(this)),
      item(icons.present, 'Presentar (marcos como diapositivas)', () => startPresentation(this)),
      toggle(icons.grid, 'Ajustar a la cuadrícula', settings.snap, () => {
        settings.snap = !settings.snap;
        saveSettings();
        toast(settings.snap ? 'Ajuste a la cuadrícula activado' : 'Ajuste a la cuadrícula desactivado');
      }),
      toggle(icons.magic, 'Autoforma al dibujar', settings.autoShape, () => {
        settings.autoShape = !settings.autoShape;
        saveSettings();
        toast(settings.autoShape ? 'Los rectángulos, círculos y líneas dibujados a mano se convierten en formas limpias' : 'Autoforma desactivada');
      }),
      sep('Colaborar'),
      item(icons.comment, 'Comentarios', () => openCommentsPanel(this)),
      item(icons.share, 'Compartir', () => openShare(this)),
      item(icons.history, 'Historial de versiones', () => openHistory(this)),
      sep('Archivo'),
      item(icons.fileExport, 'Exportar PDF (toda la pizarra)', () => exportBoardPdf(this, 'all')),
      item(icons.fileExport, 'Exportar PDF (un marco por página)', () => exportBoardPdf(this, 'frames')),
      item(icons.image, 'Exportar PNG', () => this.exportPng()),
      item(icons.upload, 'Importar Word/PDF', () => this.importDocument()),
      item(icons.template, 'Guardar como plantilla', () => saveAsTemplate(this)),
      item(icons.edit, 'Renombrar proyecto', () => this.rename()),
      sep('Ajustes'),
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

  refreshUI() {
    const e = this.els;
    for (const t of ['pen', 'marker', 'eraser', 'select', 'hand', 'laser', 'note', 'text'] as Tool[])
      e['tool-' + t].classList.toggle('on', this.tool === t);
    e.insertBtn.classList.toggle('on', ['shape', 'doc', 'connector', 'comment'].includes(this.tool));
    e.undo.toggleAttribute('disabled', !this.doc.canUndo());
    e.redo.toggleAttribute('disabled', !this.doc.canRedo());
    e.penOnly.classList.toggle('on', settings.penOnly);
    e.zoomLabel.textContent = Math.round(this.view.zoom * 100) + '%';

    const drawing = ['pen', 'marker', 'eraser', 'shape', 'connector'].includes(this.tool);
    e.colors.style.display = ['pen', 'marker', 'text', 'shape', 'connector', 'laser'].includes(this.tool) ? '' : 'none';
    e.sizes.style.display = drawing ? '' : 'none';
    e.sep1.style.display = e.colors.style.display;
    e.sep2.style.display = e.sizes.style.display;
    const palette = [...PEN_COLORS, ...settings.customColors.filter((c) => !PEN_COLORS.includes(c))];
    const picker = h('input', {
      type: 'color',
      class: 'color-input',
      value: this.color,
      title: 'Otro color',
      oninput: () => (this.color = picker.value),
      onchange: () => {
        const c = picker.value;
        this.color = c;
        settings.customColors = [c, ...settings.customColors.filter((x) => x !== c)].slice(0, 6);
        saveSettings();
        this.refreshUI();
      },
    }) as HTMLInputElement;
    e.colors.replaceChildren(
      ...palette.map((c) =>
        h('button', {
          class: 'sw' + (c === this.color ? ' on' : ''),
          style: `--c:${c}`,
          title: c,
          onclick: () => ((this.color = c), this.refreshUI()),
        }),
      ),
      h('label', { class: 'sw custom' + (palette.includes(this.color) ? '' : ' on'), title: 'Otro color', style: `--c:${this.color}` }, picker),
    );
    if (drawing) {
      const t = (this.tool === 'shape' || this.tool === 'connector' ? 'pen' : this.tool) as 'pen' | 'marker' | 'eraser';
      const cur = this.sizeVal[t];
      const slider = h('input', {
        type: 'range',
        min: t === 'pen' ? 0.5 : 4,
        max: t === 'pen' ? 40 : 140,
        step: 0.5,
        value: cur,
        class: 'size-range',
        title: 'Grosor exacto',
        oninput: () => {
          this.sizeVal[t] = parseFloat(slider.value);
          sizeLabel.textContent = String(Math.round(this.sizeVal[t] * 10) / 10);
        },
        onchange: () => this.refreshUI(),
      }) as HTMLInputElement;
      const sizeLabel = h('span', { class: 'size-label' }, String(cur));
      e.sizes.replaceChildren(
        ...SIZES[t].map((v, i) =>
          h(
            'button',
            {
              class: 'sz' + (Math.abs(cur - v) < 0.01 ? ' on' : ''),
              title: `Grosor ${v}`,
              onclick: () => ((this.sizeVal[t] = v), this.refreshUI()),
            },
            h('span', { style: `width:${4 + i * 3.5}px;height:${4 + i * 3.5}px` }),
          ),
        ),
        h('div', { class: 'size-pop' }, slider, sizeLabel),
      );
    }
    this.refreshSelbar();
  }

  refreshSelbar() {
    const bar = this.els.selbar;
    const sel = [...this.selection].map((id) => this.doc.get(id)).filter(Boolean) as Item[];
    if (!sel.length || (this.g && (this.g.t === 'move' || this.g.t === 'resize'))) {
      bar.classList.add('hidden');
      return;
    }
    const of = <K extends Item['kind']>(k: K) => sel.filter((i) => i.kind === k) as Extract<Item, { kind: K }>[];
    const strokes = of('stroke');
    const notes = of('note');
    const texts = of('text');
    const shapes = of('shape');
    const frames = of('frame');
    const connectors = of('connector');
    const locked = sel.some((i) => i.locked);
    const grouped = sel.some((i) => i.group);
    const one = sel.length === 1 ? sel[0] : null;
    const btn = (icon: string, label: string, fn: () => void, cls = '') =>
      h('button', { class: 'sb ' + cls, title: label, onclick: fn }, h('span', { html: icon }), h('em', {}, label));
    const swatches = (colors: string[], title: string, fn: (c: string) => void, square = false) =>
      h(
        'div',
        { class: 'swatches' },
        ...colors.map((c) => h('button', { class: 'sw' + (square ? ' sq' : ''), style: `--c:${c}`, title, onclick: () => fn(c) })),
      );
    const update = <T extends Item>(list: T[], patch: (it: T) => Partial<T>) =>
      this.doc.commit(
        list.map((it) => this.doc.get(it.id) as T | undefined).filter((x): x is T => !!x).map((it) => ({ ...it, ...patch(it) }) as Item),
      );

    const parts: (HTMLElement | null | false)[] = [
      // acciones del elemento único
      one?.kind === 'note' && btn(icons.edit, 'Dibujar', () => this.editNote(one.id)),
      one?.kind === 'doc' && btn(icons.doc, 'Abrir', () => this.openDoc(one.id)),
      one?.kind === 'pdf' && btn(icons.pdf, 'Abrir PDF', () => this.openPdf(one.id)),
      one?.kind === 'text' && btn(icons.edit, 'Editar', () => this.editText(one.id)),
      one?.kind === 'table' && btn(icons.table, 'Editar tabla', () => this.editTableItem(one.id)),
      one?.kind === 'todo' && btn(icons.todo, 'Editar lista', () => this.editTodoItem(one.id)),
      one?.kind === 'link' && btn(icons.link, 'Abrir enlace', () => this.openExternal(one.url)),
      one?.kind === 'shape' && btn(icons.text, 'Texto', () => this.editShapeLabel(one.id)),
      one?.kind === 'frame' && btn(icons.edit, 'Renombrar', () => this.renameFrame(one.id)),
      one?.kind === 'table' && btn(icons.chart, 'Crear gráfico', () => createChart(this, one)),
      one?.kind === 'chart' && btn(icons.chart, 'Editar gráfico', () => editChart(this, one)),
      one?.kind === 'code' && btn(icons.code, 'Editar', () => editCode(this, one)),
      one?.kind === 'code' && btn(icons.copy, 'Copiar código', () => copyCode(one)),
      one?.kind === 'math' && btn(icons.sigma, 'Editar fórmula', () => editMath(this, one)),
      one?.kind === 'video' && btn(icons.video, 'Reproducir', () => openVideo(one)),
      one?.kind === 'audio' && btn(icons.mic, getPlaying()?.id === one.id && !getPlaying()!.el.paused ? 'Pausa' : 'Reproducir', () => this.toggleAudio(one)),
      one?.kind === 'doc' && btn(icons.fileExport, 'PDF', () => exportDocPdf(one)),
      one?.kind === 'pdf' && btn(icons.fileExport, 'PDF anotado', () => exportAnnotatedPdf(one)),
      one?.kind === 'connector' && btn(icons.text, 'Texto', () => this.editConnectorLabel(one.id)),
      connectors.length > 0 &&
        btn(icons.arrowBoth, 'Puntas', () =>
          update(connectors, (c) => ({ arrow: (c.arrow === 'end' ? 'both' : c.arrow === 'both' ? 'none' : 'end') as ConnectorItem['arrow'] })),
        ),
      connectors.length > 0 && btn(icons.curve, 'Curva', () => update(connectors, (c) => ({ curve: !c.curve }))),
      connectors.length > 0 && swatches(PEN_COLORS.slice(0, 7), 'Color', (c) => update(connectors, () => ({ stroke: c }))),
      strokes.length > 0 && btn(icons.magic, 'A forma', () => this.strokesToShapes()),
      strokes.length > 0 && btn(icons.scanText, 'A texto', () => this.strokesToText()),
      strokes.length > 0 && btn(icons.sticky, 'Hacer post-it', () => this.strokesToNote()),
      texts.length > 0 && btn(icons.minus, 'Letra más pequeña', () => this.scaleText(texts, 1 / 1.25)),
      texts.length > 0 && btn(icons.plus, 'Letra más grande', () => this.scaleText(texts, 1.25)),
      // colores
      notes.length > 0 && swatches(NOTE_COLORS, 'Color del post-it', (c) => update(notes, () => ({ color: c })), true),
      texts.length > 0 && swatches(PEN_COLORS, 'Color del texto', (c) => update(texts, () => ({ color: c }))),
      shapes.length > 0 && swatches(PEN_COLORS.slice(0, 7), 'Color del borde', (c) => update(shapes, (s) => ({ stroke: c, fill: s.fill === 'none' ? 'none' : c + '33' }))),
      shapes.some((s) => s.shape !== 'line' && s.shape !== 'arrow') &&
        btn(icons.fill, 'Relleno', () => update(shapes, (s) => ({ fill: s.fill === 'none' ? s.stroke + '33' : 'none' }))),
      frames.length > 0 && swatches(FRAME_COLORS, 'Color del marco', (c) => update(frames, () => ({ color: c })), true),
      // organizar
      sel.length > 1 && btn(icons.alignL, 'Alinear', () => this.showAlignMenu(bar)),
      sel.length > 1 && !grouped && btn(icons.group, 'Agrupar', () => this.group()),
      grouped && btn(icons.ungroup, 'Desagrupar', () => this.ungroup()),
      !!one?.rot && btn(icons.rotate, 'Enderezar', () => update([one], () => ({ rot: undefined }) as any)),
      btn(locked ? icons.unlock : icons.lock, locked ? 'Desbloquear' : 'Bloquear', () => this.toggleLock()),
      // comunes
      btn(icons.copy, 'Duplicar', () => this.duplicate()),
      btn(icons.front, 'Al frente', () => this.bringToFront()),
      btn(icons.trash, 'Borrar', () => this.deleteSelection(), 'danger'),
    ];
    bar.replaceChildren(...(parts.filter(Boolean) as HTMLElement[]));
    bar.classList.remove('hidden');
  }

  setStatus(s: SyncStatus) {
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
    if (this.readOnly && !['hand', 'select', 'laser'].includes(t)) t = 'hand';
    this.tool = t;
    if (t !== 'select') this.selection.clear();
    this.over.style.cursor = t === 'hand' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    this.refreshUI();
    this.schedule();
  }

  // ------------------------------------------------------------------ vista
  loadView() {
    try {
      const v = JSON.parse(localStorage.getItem('canvaspp.view.' + this.meta.id) || 'null');
      if (v && isFinite(v.zoom)) this.view = v;
    } catch {}
  }
  saveView() {
    try {
      localStorage.setItem('canvaspp.view.' + this.meta.id, JSON.stringify(this.view));
    } catch {}
  }

  resize() {
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

  localXY(cx: number, cy: number): [number, number] {
    const r = this.over.getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  }

  zoomAt(sx: number, sy: number, zoom: number) {
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
    for (const it of this.shown()) r = unionRect(r, itemBounds(it));
    if (!r) {
      this.view = { x: -this.w / 2, y: -this.h / 2, zoom: 1 };
      return this.viewChanged();
    }
    const pad = 80;
    const zoom = clamp(Math.min((this.w - pad * 2) / r.w, (this.h - pad * 2) / r.h), 0.05, 2);
    this.view = { zoom, x: r.x + r.w / 2 - this.w / 2 / zoom, y: r.y + r.h / 2 - this.h / 2 / zoom };
    this.viewChanged();
  }

  viewChanged() {
    this.minimap.update();
    this.baseDirty = true;
    this.els.zoomLabel.textContent = Math.round(this.view.zoom * 100) + '%';
    this.schedule();
    this.saveViewSoon();
  }
  saveViewTimer: any;
  saveViewSoon() {
    clearTimeout(this.saveViewTimer);
    this.saveViewTimer = setTimeout(() => this.saveView(), 300);
  }

  // ------------------------------------------------------------------ render
  schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.renderNow());
  }

  worldViewport(): Rect {
    return { x: this.view.x, y: this.view.y, w: this.w / this.view.zoom, h: this.h / this.view.zoom };
  }

  applyWorld(ctx: CanvasRenderingContext2D) {
    const z = this.view.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, -this.view.x * z, -this.view.y * z);
  }

  renderNow() {
    this.raf = 0;
    if (this.baseDirty) this.renderBase();
    this.renderOverlay();
  }

  renderBase() {
    this.baseDirty = false;
    const ctx = this.bctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    this.drawGrid(ctx);
    this.applyWorld(ctx);
    const vp = this.worldViewport();
    for (const it of this.shown()) {
      if (this.hidden.has(it.id)) continue;
      if (!rectsIntersect(itemBounds(it), vp)) continue;
      drawItem(ctx, it, this.view.zoom);
    }
  }

  drawGrid(ctx: CanvasRenderingContext2D) {
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

  renderOverlay() {
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
        if (it && !this.isLocked(it)) drawItem(ctx, it, z);
      }
      ctx.restore();
      // conectores pegados a lo que se mueve
      const off = (id: string): [number, number] | undefined => (this.selection.has(id) ? [g.dx, g.dy] : undefined);
      for (const c of this.movingConnectors) drawConnector(ctx, c, z, off);
    }
    const preview = this.previewItem();
    if (preview) drawItem(ctx, preview, z);
    if (g?.t === 'shape') drawItem(ctx, this.shapeFromGesture(g), z);
    if (g?.t === 'connector') {
      drawConnector(
        ctx,
        { ...(this.newBase() as any), kind: 'connector', from: g.from, to: { x: g.x1, y: g.y1 }, stroke: this.color, sw: Math.max(1, this.sizeVal.pen) / z, arrow: 'end', curve: false, label: '' },
        z,
      );
    }

    // selección
    if (this.selection.size) {
      const off = g?.t === 'move' ? [g.dx, g.dy] : [0, 0];
      let all: Rect | null = null;
      ctx.lineWidth = 1.5 / z;
      for (const id of this.selection) {
        let it = this.doc.get(id);
        if (!it) continue;
        if (preview && preview.id === id) it = preview;
        const locked = this.isLocked(it);
        ctx.strokeStyle = locked ? '#e5484d' : '#0090ff';
        ctx.setLineDash([4 / z, 4 / z]);
        ctx.save();
        ctx.translate(off[0], off[1]);
        if (it.rot) {
          const b = baseBounds(it);
          const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
          ctx.translate(cx, cy);
          ctx.rotate(it.rot);
          ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
        } else {
          const b = itemBounds(it);
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
        ctx.restore();
        const ib = itemBounds(it);
        all = unionRect(all, { ...ib, x: ib.x + off[0], y: ib.y + off[1] });
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = '#0090ff';
      if (all && this.selection.size > 1) ctx.strokeRect(all.x - 6 / z, all.y - 6 / z, all.w + 12 / z, all.h + 12 / z);
      if (g?.t !== 'move' && !this.readOnly) {
        const single = this.singleSelectedNote();
        if (single && !this.isLocked(single)) {
          const hs = this.handleRect((preview as BoxItem) ?? single);
          ctx.fillStyle = '#fff';
          ctx.fillRect(hs.x, hs.y, hs.w, hs.h);
          ctx.strokeRect(hs.x, hs.y, hs.w, hs.h);
        }
        const rotItem = (preview ?? this.singleRotatable()) as Item | null;
        if (rotItem && this.singleRotatable()) {
          const [hx, hy] = this.rotateHandle(rotItem);
          const [cx, cy] = itemCenter(rotItem);
          const [tx, ty] = rotatePoint(cx, cy - baseBounds(rotItem).h / 2, cx, cy, rotItem.rot ?? 0);
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(hx, hy, 7 / z, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.stroke();
        }
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
    this.drawPresence(ctx);
  }

  /** Versión en curso del elemento que se está redimensionando o girando. */
  previewItem(): Item | null {
    const g = this.g;
    if (g?.t === 'resize') {
      const moved = { x: g.nx ?? g.note.x, y: g.ny ?? g.note.y };
      if (g.note.kind === 'note') return { ...reshapeNote(g.note, g.w, g.h), ...moved };
      return { ...g.note, w: g.w, h: g.h, ...moved } as Item;
    }
    if (g?.t === 'rotate') return { ...g.item, rot: g.rot } as Item;
    return null;
  }

  /** Elemento que se puede girar (uno solo, con caja o texto, y no líneas/flechas). */
  singleRotatable(): Item | null {
    if (this.selection.size !== 1 || this.readOnly) return null;
    const it = this.doc.get([...this.selection][0]);
    if (!it || this.isLocked(it)) return null;
    if (it.kind === 'shape' && (it.shape === 'line' || it.shape === 'arrow')) return null;
    return isBox(it) || it.kind === 'text' ? it : null;
  }

  rotateHandle(it: Item): [number, number] {
    const b = baseBounds(it);
    const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
    return rotatePoint(cx, b.y - 26 / this.view.zoom, cx, cy, it.rot ?? 0);
  }

  // ---------------- cuadrícula ----------------
  gridStep() {
    let step = 32;
    while (step * this.view.zoom < 16) step *= 4;
    return step;
  }
  snapPt(x: number, y: number): [number, number] {
    if (!settings.snap) return [x, y];
    const s = this.gridStep();
    return [Math.round(x / s) * s, Math.round(y / s) * s];
  }
  /** Ajusta un desplazamiento para que la esquina del primer elemento caiga en la rejilla. */
  snapDelta(dx: number, dy: number): [number, number] {
    const first = [...this.selection].map((id) => this.doc.get(id)).find(Boolean);
    if (!first) return [dx, dy];
    const b = itemBounds(first);
    const [sx, sy] = this.snapPt(b.x + dx, b.y + dy);
    return [sx - b.x, sy - b.y];
  }

  layerLocked(it: Item) {
    if (!it.layer) return false;
    const l = this.doc.get(it.layer);
    return l?.kind === 'layer' && l.lockedLayer;
  }

  /** Elemento con caja seleccionado en solitario (tiene tirador para redimensionar). */
  singleSelectedNote(): BoxItem | null {
    if (this.selection.size !== 1) return null;
    const it = this.doc.get([...this.selection][0]);
    return it && isBox(it) ? it : null;
  }

  handleRect(n: BoxItem): Rect {
    const s = 16 / this.view.zoom;
    if (resizeMode(n) === 'endpoint') return { x: n.x + n.w - s / 2, y: n.y + n.h - s / 2, w: s, h: s };
    const b = baseBounds(n);
    const [hx, hy] = rotatePoint(b.x + b.w, b.y + b.h, b.x + b.w / 2, b.y + b.h / 2, n.rot ?? 0);
    return { x: hx - s / 2, y: hy - s / 2, w: s, h: s };
  }

  shapeFromGesture(g: { x0: number; y0: number; x1: number; y1: number }): ShapeItem {
    const line = this.shapeKind === 'line' || this.shapeKind === 'arrow';
    let w = g.x1 - g.x0;
    let hh = g.y1 - g.y0;
    let x = g.x0;
    let y = g.y0;
    if (!line) {
      x = Math.min(g.x0, g.x1);
      y = Math.min(g.y0, g.y1);
      w = Math.abs(w);
      hh = Math.abs(hh);
    }
    return {
      id: 'preview',
      kind: 'shape',
      rev: 0,
      by: '',
      z: 0,
      shape: this.shapeKind,
      x,
      y,
      w,
      h: hh,
      stroke: this.color === '#ffffff' ? PEN_COLORS[0] : this.color,
      fill: 'none',
      sw: this.sizeVal.pen / this.view.zoom,
      label: '',
    };
  }

  // ------------------------------------------------------------------ hit test
  eraserRadius() {
    return this.sizeVal.eraser / 2 / this.view.zoom;
  }

  strokeHit(s: StrokeItem, x: number, y: number, rad: number) {
    const b = itemBounds(s);
    if (x < b.x - rad || x > b.x + b.w + rad || y < b.y - rad || y > b.y + b.h + rad) return false;
    const p = s.pts;
    const tol = rad + s.size / 2;
    if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= tol;
    for (let i = 0; i < p.length - 3; i += 3) if (distToSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= tol) return true;
    return false;
  }

  /** ¿El punto (x, y) toca el elemento? (tiene en cuenta el giro) */
  hits(it: Item, x: number, y: number, tol: number): boolean {
    if (it.kind === 'layer' || it.kind === 'bookmark') return false;
    if (it.kind === 'comment') return Math.hypot(x - it.x, y - it.y) <= commentRadius(this.view.zoom) * 1.2;
    if (it.kind === 'connector') return connectorHit(it, x, y, tol * 1.5);
    const [lx, ly] = toItemSpace(it, x, y);
    if (it.kind === 'stroke') return this.strokeHit(it, lx, ly, tol);
    if (it.kind === 'shape') return shapeHit(it, lx, ly, tol * 1.5);
    const b = baseBounds(it);
    const pad = it.kind === 'text' ? tol : 0;
    return lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad;
  }

  hitTest(x: number, y: number, opts: { includeLocked?: boolean } = {}): Item | null {
    const list = this.shown();
    const tol = 6 / this.view.zoom;
    const lockedLayer = (it: Item) => {
      if (!it.layer) return false;
      const l = this.doc.get(it.layer);
      return l?.kind === 'layer' && l.lockedLayer;
    };
    // comentarios encima de todo
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.kind === 'comment' && this.hits(it, x, y, tol)) return it;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.kind === 'frame' || it.kind === 'comment') continue; // los marcos, al final (están debajo de todo)
      if (lockedLayer(it) && !opts.includeLocked) continue;
      if (this.hits(it, x, y, tol)) return it;
    }
    // un marco solo se coge por su barra de título (así se puede seleccionar dentro de él)
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      if (f.kind !== 'frame' || (lockedLayer(f) && !opts.includeLocked)) continue;
      const [lx, ly] = toItemSpace(f, x, y);
      if (lx >= f.x && lx <= f.x + f.w && ly >= f.y && ly <= f.y + frameHeader(f, this.view.zoom)) return f;
    }
    return null;
  }

  /** Añade a la selección el resto de miembros de los grupos seleccionados. */
  expandGroups() {
    const groups = new Set<string>();
    for (const id of this.selection) {
      const g = this.doc.get(id)?.group;
      if (g) groups.add(g);
    }
    if (!groups.size) return;
    for (const it of this.shown()) if (it.group && groups.has(it.group)) this.selection.add(it.id);
  }

  // ------------------------------------------------------------------ entrada
  bindInput() {
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
      if (it) this.openItem(it);
    });
    // arrastrar un .docx / .pdf a la pizarra lo importa como documento
    this.root.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.root.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const at = this.toWorld(e.clientX, e.clientY);
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (imgs.length) this.insertImages(imgs, at);
      for (const f of files.filter((f) => !f.type.startsWith('image/'))) this.importDocument(f, at);
    });
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
  }

  onDown(e: PointerEvent) {
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
      const size = this.sizeVal[this.tool] / this.view.zoom;
      const cap = new StrokeCapture(e, (x, y) => this.toWorld(x, y), this.color, size, this.tool, 0.6 / this.view.zoom);
      this.g = { t: 'draw', id: e.pointerId, cap, tool: this.tool, start: Date.now() };
      this.schedule();
      return;
    }
    if (this.tool === 'shape') {
      const [sx0, sy0] = this.snapPt(wx, wy);
      this.g = { t: 'shape', id: e.pointerId, x0: sx0, y0: sy0, x1: sx0, y1: sy0 };
      return;
    }
    if (this.tool === 'laser') {
      this.g = { t: 'laser', id: e.pointerId };
      this.laserPoint(wx, wy, true);
      return;
    }
    if (this.tool === 'connector') {
      const hit = this.hitTest(wx, wy);
      const from: ConnectorEnd = hit && hit.kind !== 'stroke' && hit.kind !== 'connector' && hit.kind !== 'comment' ? { id: hit.id, x: wx, y: wy } : { x: wx, y: wy };
      this.g = { t: 'connector', id: e.pointerId, from, x1: wx, y1: wy };
      return;
    }
    if (this.tool === 'comment') {
      this.g = { t: 'place', id: e.pointerId, sx: lx, sy: ly, tool: 'comment' };
      return;
    }
    if (this.tool === 'note' || this.tool === 'text' || this.tool === 'doc') {
      // tocar un texto existente con la herramienta texto lo edita
      if (this.tool === 'text') {
        const hit = this.hitTest(wx, wy);
        if (hit?.kind === 'text') {
          this.editText(hit.id);
          return;
        }
      }
      this.g = { t: 'place', id: e.pointerId, sx: lx, sy: ly, tool: this.tool };
      return;
    }
    if (this.tool === 'select') {
      const rotItem = this.singleRotatable();
      if (rotItem) {
        const [hx, hy] = this.rotateHandle(rotItem);
        if (Math.hypot(wx - hx, wy - hy) <= 14 / this.view.zoom) {
          const [cx, cy] = itemCenter(rotItem);
          this.g = { t: 'rotate', id: e.pointerId, item: rotItem, cx, cy, a0: Math.atan2(wy - cy, wx - cx), rot0: rotItem.rot ?? 0, rot: rotItem.rot ?? 0 };
          this.hidden = new Set([rotItem.id]);
          this.baseDirty = true;
          this.refreshSelbar();
          this.schedule();
          return;
        }
      }
      const single = this.singleSelectedNote();
      if (single && !this.isLocked(single)) {
        const hr = this.handleRect(single);
        const pad = 8 / this.view.zoom;
        if (wx >= hr.x - pad && wx <= hr.x + hr.w + pad && wy >= hr.y - pad && wy <= hr.y + hr.h + pad) {
          const b = baseBounds(single);
          const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
          const [ax, ay] = rotatePoint(single.x, single.y, cx, cy, single.rot ?? 0);
          this.g = { t: 'resize', id: e.pointerId, note: single, sx: wx, sy: wy, w: single.w, h: single.h, ax, ay };
          this.hidden = new Set([single.id]);
          this.baseDirty = true;
          this.refreshSelbar();
          this.schedule();
          return;
        }
      }
      const hit = this.hitTest(wx, wy);
      // casillas de las listas de tareas: se marcan con un toque
      if (hit?.kind === 'todo' && !this.readOnly) {
        const [tx, ty] = toItemSpace(hit, wx, wy);
        const i = todoCheckAt(hit, tx, ty);
        if (i >= 0) {
          const items = hit.items.map((t, j) => (j === i ? { ...t, done: !t.done } : t));
          this.doc.commit([{ ...hit, items }]);
          return;
        }
      }
      if (hit?.kind === 'audio') {
        const [tx, ty] = toItemSpace(hit, wx, wy);
        if (audioButtonAt(hit, tx, ty)) {
          this.toggleAudio(hit);
          return;
        }
      }
      if (hit?.kind === 'comment') {
        this.openComment(hit.id);
        return;
      }
      if (hit) {
        const wasSelected = this.selection.has(hit.id);
        if (!wasSelected) {
          if (!e.shiftKey) this.selection.clear();
          this.selection.add(hit.id);
          this.expandGroups();
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

  startPinch() {
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

  onMove(e: PointerEvent) {
    const [lx, ly] = this.localXY(e.clientX, e.clientY);
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = lx;
      p.y = ly;
    }
    const [wx, wy] = this.toWorld(e.clientX, e.clientY);
    if (e.pointerType !== 'touch') this.hover = [wx, wy];
    if (!this.readOnly || this.member) this.presence.cursor(wx, wy);
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
        if (settings.snap) [g.dx, g.dy] = this.snapDelta(g.dx, g.dy);
        if (!g.moved && Math.hypot(g.dx, g.dy) * this.view.zoom > 4) {
          g.moved = true;
          this.addFrameContents();
          this.hidden = new Set([...this.selection].filter((id) => !this.isLocked(this.doc.get(id)!)));
          this.movingConnectors = this.shown().filter(
            (c): c is ConnectorItem =>
              c.kind === 'connector' && !this.selection.has(c.id) && (this.selection.has(c.from.id ?? '') || this.selection.has(c.to.id ?? '')),
          );
          for (const c of this.movingConnectors) this.hidden.add(c.id);
          this.baseDirty = true;
          this.refreshSelbar();
        }
        break;
      }
      case 'resize': {
        const mode = resizeMode(g.note);
        const min = 30 / this.view.zoom;
        const [px, py] = this.snapPt(wx, wy);
        if (mode === 'endpoint') {
          g.w = px - g.note.x;
          g.h = py - g.note.y;
        } else {
          // tamaño medido en el sistema girado del elemento, con la esquina opuesta fija
          const rot = g.note.rot ?? 0;
          const [vx, vy] = rotatePoint(px - g.ax, py - g.ay, 0, 0, -rot);
          const b0 = baseBounds(g.note);
          const extraW = b0.w - g.note.w; // tablas/listas: el alto se calcula solo
          g.w = Math.max(min, vx - extraW);
          if (mode === 'aspect') g.h = (g.w * g.note.h) / g.note.w;
          else if (mode === 'free') g.h = Math.max(min, vy);
          const hh = mode === 'width' ? baseBounds({ ...g.note, w: g.w } as Item).h : g.h;
          const [ccx, ccy] = rotatePoint(g.ax + g.w / 2, g.ay + hh / 2, g.ax, g.ay, rot);
          g.nx = ccx - g.w / 2;
          g.ny = ccy - hh / 2;
        }
        break;
      }
      case 'shape':
        [g.x1, g.y1] = this.snapPt(wx, wy);
        break;
      case 'rotate': {
        let r = g.rot0 + Math.atan2(wy - g.cy, wx - g.cx) - g.a0;
        const step = Math.PI / 12; // 15°
        const snapped = Math.round(r / step) * step;
        if (e.shiftKey || Math.abs(r - snapped) < 0.05) r = snapped;
        g.rot = r;
        break;
      }
      case 'connector':
        g.x1 = wx;
        g.y1 = wy;
        break;
      case 'laser':
        this.laserPoint(wx, wy, false);
        break;
    }
    this.schedule();
  }

  onUp(e: PointerEvent, cancelled = false) {
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
        const shape = settings.autoShape && g.tool === 'pen' ? recognizeStroke(stroke) : null;
        this.doc.add([shape ?? stroke]);
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
          for (const it of this.shown()) if (this.inMarquee(it, r) && !this.layerLocked(it)) this.selection.add(it.id);
          this.expandGroups();
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
            if (!it || this.isLocked(it)) continue;
            moved.push(translateItem(it, g.dx, g.dy));
          }
          if (moved.length) this.doc.commit(moved);
          else toast('Los elementos bloqueados no se pueden mover');
        } else if (!g.moved && g.tapOn) {
          // toque sobre un post-it ya seleccionado, o doble toque → abrir editor
          const it = this.doc.get(g.tapOn);
          const now = Date.now();
          const dbl = this.lastTap.id === g.tapOn && now - this.lastTap.t < 350;
          this.lastTap = { id: g.tapOn, t: now };
          if (it && it.kind !== 'stroke' && (dbl || (g.wasSelected && e.pointerType !== 'mouse'))) this.openItem(it);
        }
        break;
      }
      case 'resize': {
        this.hidden.clear();
        this.baseDirty = true;
        const cur = this.doc.get(g.note.id) as BoxItem | undefined;
        if (cur && !cancelled) {
          const moved = { x: g.nx ?? cur.x, y: g.ny ?? cur.y };
          // post-it: la zona de dibujo adopta la forma nueva
          if (cur.kind === 'note') this.doc.commit([{ ...reshapeNote(cur, g.w, g.h), ...moved }]);
          else this.doc.commit([{ ...cur, w: g.w, h: g.h, ...moved }]);
        }
        break;
      }
      case 'shape': {
        if (cancelled) break;
        const sh = this.shapeFromGesture(g);
        const line = sh.shape === 'line' || sh.shape === 'arrow';
        const tiny = Math.hypot(sh.w, sh.h) * this.view.zoom < 8;
        if (tiny) {
          // un toque: forma de tamaño estándar
          const d = 140 / this.view.zoom;
          if (line) Object.assign(sh, { w: d, h: 0 });
          else Object.assign(sh, { x: sh.x - d / 2, y: sh.y - (d * 0.65) / 2, w: d, h: d * 0.65 });
        }
        const item: ShapeItem = { ...sh, id: uid(), z: this.doc.nextZ() };
        this.doc.add([item]);
        this.setTool('select');
        this.selection = new Set([item.id]);
        this.refreshUI();
        break;
      }
      case 'rotate': {
        this.hidden.clear();
        this.baseDirty = true;
        const cur = this.doc.get(g.item.id);
        if (cur && !cancelled) this.doc.commit([{ ...cur, rot: Math.abs(g.rot) < 1e-3 ? undefined : g.rot } as Item]);
        break;
      }
      case 'connector': {
        if (cancelled) break;
        const hit = this.hitTest(wx, wy);
        const to: ConnectorEnd =
          hit && hit.id !== g.from.id && hit.kind !== 'stroke' && hit.kind !== 'connector' && hit.kind !== 'comment'
            ? { id: hit.id, x: wx, y: wy }
            : { x: wx, y: wy };
        if (!to.id && !g.from.id && Math.hypot(wx - g.from.x, wy - g.from.y) * this.view.zoom < 10) break;
        const c: ConnectorItem = {
          ...this.newBase(),
          kind: 'connector',
          from: g.from,
          to,
          stroke: this.color === '#ffffff' ? PEN_COLORS[0] : this.color,
          sw: Math.max(1, this.sizeVal.pen) / this.view.zoom,
          arrow: 'end',
          curve: false,
          label: '',
          z: this.doc.nextZ(),
        };
        this.doc.add([c]);
        break;
      }
      case 'laser':
        this.laserPoint(wx, wy, false, true);
        break;
      case 'place': {
        const [lx, ly] = this.localXY(e.clientX, e.clientY);
        if (Math.hypot(lx - g.sx, ly - g.sy) < 10 && !cancelled) {
          if (g.tool === 'comment') this.createComment(wx, wy);
          else if (g.tool === 'note') this.createNoteAt(wx, wy);
          else if (g.tool === 'text') this.createTextAt(wx, wy);
          else this.createDocAt(wx, wy);
        }
        break;
      }
    }
    this.refreshUI();
    this.schedule();
  }

  cancelGesture() {
    const g = this.g;
    this.g = null;
    if (g?.t === 'erase' || g?.t === 'move' || g?.t === 'resize') {
      this.hidden.clear();
      this.baseDirty = true;
    }
    this.schedule();
  }

  inMarquee(it: Item, r: Rect) {
    const b = itemBounds(it);
    if (!rectsIntersect(b, r)) return false;
    if (it.kind === 'frame') return rectContains(r, b); // un marco solo si queda dentro entero
    if (it.kind !== 'stroke') return true;
    for (let i = 0; i < it.pts.length; i += 3) {
      const x = it.pts[i],
        y = it.pts[i + 1];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
  }

  eraseAt(x: number, y: number) {
    if (this.g?.t !== 'erase') return;
    const rad = this.eraserRadius();
    let changed = false;
    for (const it of this.shown()) {
      if (it.kind !== 'stroke' || this.g.hit.has(it.id) || this.isLocked(it)) continue;
      if (this.strokeHit(it, x, y, rad)) {
        this.g.hit.add(it.id);
        this.hidden.add(it.id);
        changed = true;
      }
    }
    if (changed) this.baseDirty = true;
    this.schedule();
  }

  onWheel(e: WheelEvent) {
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

  onKey = (e: KeyboardEvent) => {
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
      for (const it of this.shown()) this.selection.add(it.id);
      this.refreshUI();
    } else if (mod && k === 'd') this.duplicate();
    else if (mod && k === 'f') openSearch(this);
    else if (mod && k === 'g') e.shiftKey ? this.ungroup() : this.group();
    else if (mod && k === 'l') this.toggleLock();
    else if (mod && (k === '0' || k === '1')) this.zoomTo(1);
    else if (mod && (k === '=' || k === '+')) this.zoomBy(1.25);
    else if (mod && k === '-') this.zoomBy(1 / 1.25);
    else if (mod) return;
    else if (e.altKey && /^[1-9]$/.test(e.key)) goBookmark(this, Number(e.key) - 1);
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
    else if (k === 't') this.setTool('text');
    else if (k === 'd') this.setTool('doc');
    else if (k === 'l') this.setTool('laser');
    else if (k === 'c') this.setTool('connector');
    else if (e.altKey && /^[1-9]$/.test(e.key)) goBookmark(this, Number(e.key) - 1);
    else if (e.altKey && k === 'b') addBookmark(this);
    else if (k === 'f') this.fitContent();
    else return;
    e.preventDefault();
    this.schedule();
  };

  onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      this.spaceDown = false;
      this.over.style.cursor = this.tool === 'hand' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
    }
  };

  // ------------------------------------------------------------------ acciones
  async createNoteAt(wx: number, wy: number) {
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

  /** Abre el editor adecuado para un elemento (post-it, texto o documento). */
  openItem(it: Item) {
    if (this.readOnly) {
      // en solo lectura se pueden abrir documentos, PDF, vídeos, audios y enlaces, pero no editar
      if (it.kind === 'doc') this.openDoc(it.id);
      else if (it.kind === 'pdf') this.openPdf(it.id);
      else if (it.kind === 'video') openVideo(it);
      else if (it.kind === 'audio') this.toggleAudio(it);
      else if (it.kind === 'link') this.openExternal(it.url);
      return;
    }
    if (it.kind === 'note') this.editNote(it.id);
    else if (it.kind === 'text') this.editText(it.id);
    else if (it.kind === 'doc') this.openDoc(it.id);
    else if (it.kind === 'pdf') this.openPdf(it.id);
    else if (it.kind === 'table') this.editTableItem(it.id);
    else if (it.kind === 'todo') this.editTodoItem(it.id);
    else if (it.kind === 'link') this.openExternal(it.url);
    else if (it.kind === 'shape') this.editShapeLabel(it.id);
    else if (it.kind === 'frame') this.renameFrame(it.id);
    else if (it.kind === 'video') openVideo(it);
    else if (it.kind === 'audio') this.toggleAudio(it);
    else if (it.kind === 'math') editMath(this, it);
    else if (it.kind === 'code') editCode(this, it);
    else if (it.kind === 'chart') editChart(this, it);
    else if (it.kind === 'comment') this.openComment(it.id);
    else if (it.kind === 'connector') this.editConnectorLabel(it.id);
  }

  async editConnectorLabel(id: string) {
    const c = this.doc.get(id);
    if (c?.kind !== 'connector') return;
    const label = await askText('Texto del conector', c.label, 'Aceptar');
    const cur = this.doc.get(id);
    if (label != null && cur?.kind === 'connector') this.doc.commit([{ ...cur, label }]);
  }

  /** Al mover un marco se mueve también lo que tiene dentro. */
  addFrameContents() {
    const frames = [...this.selection].map((id) => this.doc.get(id)).filter((i): i is FrameItem => i?.kind === 'frame');
    for (const f of frames)
      for (const it of this.shown())
        if (it.id !== f.id && rectContains({ x: f.x, y: f.y, w: f.w, h: f.h }, itemBounds(it))) this.selection.add(it.id);
  }

  openExternal(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    if (platform() === 'android') location.href = url;
    else window.open(url, '_blank', 'noopener');
  }

  // ---------------- insertar contenido ----------------
  /** Añade un elemento en el centro de la vista (sin tapar otros) y lo selecciona. */
  place<T extends BoxItem>(it: T): T {
    const [cx, cy] = this.viewCenter();
    const b = itemBounds(it);
    it.x = cx - b.w / 2;
    it.y = cy - b.h / 2;
    this.moveToFreeSpot(it);
    const [added] = this.doc.add([{ ...it, z: it.kind === 'frame' ? 0 : this.doc.nextZ() }]);
    this.setTool('select');
    this.selection = new Set([added.id]);
    this.refreshUI();
    return added as T;
  }

  newBase() {
    return { id: uid(), rev: 0, by: '', z: 0 };
  }

  async insertImages(files?: File[], at?: [number, number]) {
    if (!files) {
      const f = await pickFiles('image/*');
      files = f;
    }
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    let offset = 0;
    const added: string[] = [];
    for (const file of imgs) {
      const blob = await downscaleImage(file, 2400);
      const asset = await addAsset(blob);
      const dims = await imageSize(blob);
      const maxW = 420 / this.view.zoom;
      const k = Math.min(1, maxW / dims.w, maxW / dims.h) || 1;
      const w = (dims.w * k) || maxW;
      const hh = (dims.h * k) || maxW * 0.75;
      const [cx, cy] = at ?? this.viewCenter();
      const it: ImageItem = { ...this.newBase(), kind: 'image', x: cx - w / 2 + offset, y: cy - hh / 2 + offset, w, h: hh, asset, z: this.doc.nextZ() };
      if (!at) this.moveToFreeSpot(it);
      this.doc.add([it]);
      added.push(it.id);
      offset += 24 / this.view.zoom;
    }
    this.setTool('select');
    this.selection = new Set(added);
    this.refreshUI();
  }

  insertTable() {
    const fs = 15 / this.view.zoom;
    const t = this.place<TableItem>({
      ...this.newBase(),
      kind: 'table',
      x: 0,
      y: 0,
      w: 420 / this.view.zoom,
      h: 0,
      header: true,
      fs,
      cells: [
        ['Columna 1', 'Columna 2', 'Columna 3'],
        ['', '', ''],
        ['', '', ''],
      ],
    });
    this.editTableItem(t.id);
  }

  async editTableItem(id: string) {
    const t = this.doc.get(id);
    if (t?.kind !== 'table' || this.editing) return;
    this.editing = true;
    const r = await editTable(t);
    this.editing = false;
    const cur = this.doc.get(id);
    if (r && cur?.kind === 'table') this.doc.commit([{ ...cur, cells: r.cells, header: r.header }]);
  }

  insertTodo() {
    const t = this.place<TodoItem>({
      ...this.newBase(),
      kind: 'todo',
      x: 0,
      y: 0,
      w: TODO_BASE_W / this.view.zoom,
      h: 0,
      title: 'Tareas',
      items: [{ t: '', done: false }],
    });
    this.editTodoItem(t.id, true);
  }

  async editTodoItem(id: string, isNew = false) {
    const t = this.doc.get(id);
    if (t?.kind !== 'todo' || this.editing) return;
    this.editing = true;
    const r = await editTodo(t);
    this.editing = false;
    const cur = this.doc.get(id);
    if (cur?.kind !== 'todo') return;
    if (r) this.doc.commit([{ ...cur, title: r.title, items: r.items }]);
    else if (isNew) this.doc.remove([id]);
  }

  async insertLink() {
    let url = await askText('Dirección web del enlace', 'https://', 'Añadir');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const title = (await askText('Título (opcional)', domainOf(url), 'Aceptar')) || domainOf(url);
    this.place<LinkItem>({
      ...this.newBase(),
      kind: 'link',
      x: 0,
      y: 0,
      w: LINK_BASE_W / this.view.zoom,
      h: LINK_BASE_H / this.view.zoom,
      url,
      title,
    });
  }

  insertFrame() {
    const w = Math.min(this.w * 0.7, 900) / this.view.zoom;
    const f = this.place<FrameItem>({
      ...this.newBase(),
      kind: 'frame',
      x: 0,
      y: 0,
      w,
      h: w * 0.6,
      title: 'Sección',
      color: FRAME_COLORS[0],
    });
    this.renameFrame(f.id);
  }

  async renameFrame(id: string) {
    const f = this.doc.get(id);
    if (f?.kind !== 'frame') return;
    const title = await askText('Título del marco', f.title);
    const cur = this.doc.get(id);
    if (title != null && cur?.kind === 'frame') this.doc.commit([{ ...cur, title }]);
  }

  async editShapeLabel(id: string) {
    const s = this.doc.get(id);
    if (s?.kind !== 'shape') return;
    const label = await askText('Texto de la forma', s.label, 'Aceptar');
    const cur = this.doc.get(id);
    if (label != null && cur?.kind === 'shape') this.doc.commit([{ ...cur, label }]);
  }

  async openPdf(id: string, page = 0) {
    const p = this.doc.get(id);
    if (p?.kind !== 'pdf' || this.editing) return;
    this.editing = true;
    const { openPdfViewer } = await import('../pdf/viewer');
    const r = await openPdfViewer(p, { page, readOnly: this.readOnly }, (ann) => {
      const cur = this.doc.get(id);
      if (cur?.kind === 'pdf') this.doc.commit([{ ...cur, ann }], false);
    });
    this.editing = false;
    if (r.action === 'delete') {
      this.doc.remove([id]);
      this.selection.clear();
    }
    this.refreshUI();
  }

  /** Pegar: imágenes, enlaces o texto. */
  onPaste = async (e: ClipboardEvent) => {
    if (this.editing || !this.root.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.files];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      return this.insertImages(files);
    }
    const text = cd.getData('text/plain').trim();
    if (!text) return;
    e.preventDefault();
    if (/^https?:\/\/\S+$/i.test(text)) {
      this.place<LinkItem>({
        ...this.newBase(),
        kind: 'link',
        x: 0,
        y: 0,
        w: LINK_BASE_W / this.view.zoom,
        h: LINK_BASE_H / this.view.zoom,
        url: text,
        title: domainOf(text),
      });
    } else {
      const [cx, cy] = this.viewCenter();
      const size = 22 / this.view.zoom;
      const it: TextItem = { ...this.newBase(), kind: 'text', x: cx, y: cy, text, size, color: PEN_COLORS[0], z: this.doc.nextZ() };
      this.doc.add([it]);
      this.setTool('select');
      this.selection = new Set([it.id]);
      this.refreshUI();
    }
  };

  // ---------------- cuadros de texto ----------------
  createTextAt(wx: number, wy: number) {
    const size = 22 / this.view.zoom;
    const t: TextItem = {
      id: uid(),
      kind: 'text',
      rev: 0,
      by: '',
      z: 0,
      x: wx,
      y: wy - (size * TEXT_LINE) / 2,
      text: '',
      size,
      color: this.color === '#ffffff' ? PEN_COLORS[0] : this.color,
    };
    this.textEditor(t, true);
  }

  editText(id: string) {
    const t = this.doc.get(id);
    if (t?.kind === 'text') this.textEditor(t, false);
  }

  /** Edita el texto en el sitio con un <textarea> superpuesto al lienzo. */
  textEditor(t: TextItem, isNew: boolean) {
    if (this.editing) return;
    this.editing = true;
    this.selection.clear();
    this.hidden = new Set([t.id]);
    this.baseDirty = true;
    this.schedule();
    const z = this.view.zoom;
    const ta = h('textarea', { class: 'text-edit', spellcheck: 'true', value: t.text }) as HTMLTextAreaElement;
    ta.style.font = TEXT_FONT(t.size * z);
    ta.style.lineHeight = String(TEXT_LINE);
    ta.style.color = t.color;
    ta.style.left = (t.x - this.view.x) * z + 'px';
    ta.style.top = (t.y - this.view.y) * z + 'px';
    const autosize = () => {
      ta.style.width = '0px';
      ta.style.height = '0px';
      ta.style.width = Math.max(ta.scrollWidth + 4, t.size * z * 2) + 'px';
      ta.style.height = ta.scrollHeight + 'px';
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const text = ta.value.replace(/\s+$/, '');
      ta.remove();
      this.editing = false;
      this.hidden.clear();
      this.baseDirty = true;
      if (!text.trim()) {
        if (!isNew) this.doc.remove([t.id]);
      } else if (isNew) {
        this.doc.add([{ ...t, text, z: this.doc.nextZ() }]);
      } else if (text !== t.text) {
        const cur = this.doc.get(t.id);
        if (cur?.kind === 'text') this.doc.commit([{ ...cur, text }]);
      }
      if (text.trim()) {
        this.selection = new Set([t.id]);
        if (this.tool !== 'text') this.setTool('select');
        this.selection = new Set([t.id]);
      }
      this.refreshUI();
      this.schedule();
    };
    ta.addEventListener('input', autosize);
    ta.addEventListener('blur', finish);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        ta.blur();
      }
    });
    this.root.append(ta);
    autosize();
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  scaleText(texts: TextItem[], f: number) {
    this.doc.commit(
      texts
        .map((t) => this.doc.get(t.id))
        .filter((t): t is TextItem => t?.kind === 'text')
        .map((t) => ({ ...t, size: Math.max(4, t.size * f) })),
    );
  }

  // ---------------- documentos ----------------
  newDoc(wx: number, wy: number, title = 'Documento sin título', html = ''): DocItem {
    const w = DOC_BASE_W / this.view.zoom;
    const hh = DOC_BASE_H / this.view.zoom;
    return {
      id: uid(),
      kind: 'doc',
      rev: 0,
      by: '',
      z: this.doc.nextZ(),
      x: wx - w / 2,
      y: wy - hh / 2,
      w,
      h: hh,
      title,
      html,
      pages: 1,
      preview: { blocks: [] },
    };
  }

  /** Desplaza un documento a la derecha hasta que no tape a otro elemento. */
  moveToFreeSpot(d: BoxItem) {
    const gap = 30 / this.view.zoom;
    for (let i = 0; i < 30; i++) {
      const r = itemBounds({ ...d } as Item);
      if (!this.shown().some((it) => it.kind !== 'frame' && rectsIntersect(itemBounds(it), r))) return;
      d.x += r.w + gap;
    }
  }

  async createDocAt(wx: number, wy: number) {
    const d = this.newDoc(wx, wy);
    this.doc.add([d]);
    this.setTool('select');
    this.selection = new Set([d.id]);
    await this.openDoc(d.id);
  }

  async openDoc(id: string) {
    const d = this.doc.get(id);
    if (d?.kind !== 'doc' || this.editing) return;
    this.editing = true;
    const r = await openDocEditor(
      d,
      (saved) => {
        const cur = this.doc.get(id);
        if (cur?.kind === 'doc') this.doc.commit([{ ...cur, title: saved.title, html: saved.html, pages: saved.pages, preview: saved.preview }], false);
      },
      { readOnly: this.readOnly },
    );
    this.editing = false;
    if (r.action === 'delete') {
      this.doc.remove([id]);
      this.selection.clear();
    } else {
      // documento nuevo que se cierra vacío: se descarta
      const cur = this.doc.get(id);
      if (cur?.kind === 'doc' && !cur.preview.blocks.length && !cur.preview.img && cur.title === 'Documento sin título' && !/<img/.test(cur.html)) {
        this.doc.remove([id]);
        this.selection.clear();
      }
    }
    this.refreshUI();
  }

  /** Importa un Word/PDF como documento nuevo en la pizarra. */
  async importDocument(file?: File | null, at?: [number, number]) {
    file ??= await pickFile(IMPORT_ACCEPT);
    if (!file) return;
    const [wx, wy] = at ?? [this.view.x + this.w / 2 / this.view.zoom, this.view.y + this.h / 2 / this.view.zoom];
    const t = toast(`Importando ${file.name}…`, 60000);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        // los PDF son de solo lectura: se abren en el visor con anotaciones
        const res = await importPdfFile(file, (m) => t && (t.textContent = m));
        const [pw, ph] = res.sizes[0] ?? [595, 842];
        const w = DOC_BASE_W / this.view.zoom;
        const p: PdfItem = {
          ...this.newBase(),
          kind: 'pdf',
          x: wx - w / 2,
          y: wy - (w * ph) / pw / 2,
          w,
          h: (w * ph) / pw,
          title: res.title,
          file: res.file,
          thumb: res.thumb,
          pages: res.pages,
          sizes: res.sizes,
          text: res.text.some((t) => t.trim()) ? res.text : undefined,
          ann: {},
          z: this.doc.nextZ(),
        };
        this.moveToFreeSpot(p);
        this.doc.add([p]);
        this.setTool('select');
        this.selection = new Set([p.id]);
        this.refreshUI();
        toast(`PDF importado: ${file.name}`);
        return;
      }
      const res = await importFile(file, (m) => t && (t.textContent = m));
      const d = this.newDoc(wx, wy, res.title, res.html);
      this.moveToFreeSpot(d);
      // página y vista previa se calculan con el HTML renderizado
      const probe = h('div', { class: 'doc-paper doc-probe' });
      probe.innerHTML = res.html;
      document.body.append(probe);
      const { buildPreview } = await import('../docs/sanitize');
      d.preview = buildPreview(probe);
      d.pages = countPages(probe);
      probe.remove();
      this.doc.add([d]);
      this.setTool('select');
      this.selection = new Set([d.id]);
      this.refreshUI();
      toast(`Importado: ${file.name}`);
    } catch (e: any) {
      toast(e?.message || 'No se pudo importar el archivo', 4000);
    } finally {
      t?.remove();
    }
  }

  // ================================================================== utilidades de vista
  markDirty() {
    this.baseDirty = true;
    this.schedule();
  }

  /** Mueve la vista suavemente hasta `to`. */
  animateView(to: { x: number; y: number; zoom: number }, ms = 350) {
    cancelAnimationFrame(this.animRaf);
    const from = { ...this.view };
    const t0 = performance.now();
    // interpolación en escala logarítmica para que el zoom se vea natural
    const lz0 = Math.log(from.zoom);
    const lz1 = Math.log(clamp(to.zoom, 0.05, 8));
    const cx0 = from.x + this.w / 2 / from.zoom;
    const cy0 = from.y + this.h / 2 / from.zoom;
    const cx1 = to.x + this.w / 2 / to.zoom;
    const cy1 = to.y + this.h / 2 / to.zoom;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const zoom = Math.exp(lz0 + (lz1 - lz0) * e);
      const cx = cx0 + (cx1 - cx0) * e;
      const cy = cy0 + (cy1 - cy0) * e;
      this.view = { zoom, x: cx - this.w / 2 / zoom, y: cy - this.h / 2 / zoom };
      this.viewChanged();
      if (t < 1) this.animRaf = requestAnimationFrame(step);
    };
    this.animRaf = requestAnimationFrame(step);
  }

  fitRect(r: Rect, pad = 60) {
    const zoom = clamp(Math.min((this.w - pad * 2) / Math.max(r.w, 1), (this.h - pad * 2) / Math.max(r.h, 1)), 0.05, 2);
    this.animateView({ zoom, x: r.x + r.w / 2 - this.w / 2 / zoom, y: r.y + r.h / 2 - this.h / 2 / zoom });
  }

  /** Centra un elemento y lo selecciona (búsqueda, comentarios). */
  focusItem(id: string) {
    const it = this.doc.get(id);
    if (!it) return;
    this.setTool('select');
    this.selection = new Set([id]);
    const b = itemBounds(it);
    const zoom = clamp(Math.min(this.view.zoom < 0.5 ? 1 : this.view.zoom, (this.w * 0.7) / Math.max(b.w, 1), (this.h * 0.7) / Math.max(b.h, 1)), 0.05, 4);
    this.animateView({ zoom, x: b.x + b.w / 2 - this.w / 2 / zoom, y: b.y + b.h / 2 - this.h / 2 / zoom });
    this.refreshUI();
  }

  drawPresence(ctx: CanvasRenderingContext2D) {
    this.presence.draw(ctx);
  }

  laserPoint(x: number, y: number, start: boolean, end = false) {
    this.presence.laser(x, y, start, end);
  }

  toggleAudio(a: AudioItem) {
    toggleAudioFn(this, a);
  }

  openComment(id: string) {
    openCommentFn(this, id);
  }

  createComment(x: number, y: number) {
    createCommentFn(this, x, y);
  }

  // ================================================================== organizar
  selectedItems(): Item[] {
    return [...this.selection].map((id) => this.doc.get(id)).filter(Boolean) as Item[];
  }

  group() {
    const sel = this.selectedItems();
    if (sel.length < 2) return;
    const g = uid();
    this.doc.commit(sel.map((it) => ({ ...it, group: g }) as Item));
    toast('Agrupados: se seleccionan y mueven juntos');
  }

  ungroup() {
    const sel = this.selectedItems().filter((i) => i.group);
    if (!sel.length) return;
    this.doc.commit(sel.map((it) => ({ ...it, group: undefined }) as Item));
  }

  toggleLock() {
    const sel = this.selectedItems();
    if (!sel.length) return;
    const lock = sel.some((i) => !i.locked);
    this.doc.commit(sel.map((it) => ({ ...it, locked: lock || undefined }) as Item));
    toast(lock ? 'Bloqueado: no se puede mover ni borrar' : 'Desbloqueado');
  }

  /** Alinear por la caja de cada elemento. */
  align(mode: 'l' | 'ch' | 'r' | 't' | 'cv' | 'b') {
    const sel = this.selectedItems().filter((i) => !this.isLocked(i));
    if (sel.length < 2) return;
    const bs = sel.map((i) => itemBounds(i));
    const minX = Math.min(...bs.map((b) => b.x));
    const maxX = Math.max(...bs.map((b) => b.x + b.w));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxY = Math.max(...bs.map((b) => b.y + b.h));
    this.doc.commit(
      sel.map((it, i) => {
        const b = bs[i];
        let dx = 0;
        let dy = 0;
        if (mode === 'l') dx = minX - b.x;
        if (mode === 'r') dx = maxX - (b.x + b.w);
        if (mode === 'ch') dx = (minX + maxX) / 2 - (b.x + b.w / 2);
        if (mode === 't') dy = minY - b.y;
        if (mode === 'b') dy = maxY - (b.y + b.h);
        if (mode === 'cv') dy = (minY + maxY) / 2 - (b.y + b.h / 2);
        return translateItem(it, dx, dy);
      }),
    );
  }

  /** Reparte con la misma separación (3 o más elementos). */
  distribute(axis: 'h' | 'v') {
    const sel = this.selectedItems().filter((i) => !this.isLocked(i));
    if (sel.length < 3) return toast('Selecciona al menos 3 elementos');
    const withB = sel.map((it) => ({ it, b: itemBounds(it) })).sort((a, c) => (axis === 'h' ? a.b.x - c.b.x : a.b.y - c.b.y));
    const first = withB[0].b;
    const last = withB[withB.length - 1].b;
    const total = withB.reduce((s2, x) => s2 + (axis === 'h' ? x.b.w : x.b.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (withB.length - 1);
    let pos = axis === 'h' ? first.x : first.y;
    this.doc.commit(
      withB.map(({ it, b }) => {
        const d = pos - (axis === 'h' ? b.x : b.y);
        pos += (axis === 'h' ? b.w : b.h) + gap;
        return axis === 'h' ? translateItem(it, d, 0) : translateItem(it, 0, d);
      }),
    );
  }

  showAlignMenu(anchor: HTMLElement) {
    const pop = h('div', { class: 'align-pop', onclick: (e: Event) => e.stopPropagation() });
    const b = (icon: string, title: string, fn: () => void) => h('button', { class: 'tb', title, html: icon, onclick: () => (fn(), pop.remove()) });
    pop.append(
      b(icons.alignL, 'Alinear a la izquierda', () => this.align('l')),
      b(icons.alignCH, 'Centrar en horizontal', () => this.align('ch')),
      b(icons.alignR, 'Alinear a la derecha', () => this.align('r')),
      b(icons.alignT, 'Alinear arriba', () => this.align('t')),
      b(icons.alignCV, 'Centrar en vertical', () => this.align('cv')),
      b(icons.alignB, 'Alinear abajo', () => this.align('b')),
      b(icons.distH, 'Repartir en horizontal', () => this.distribute('h')),
      b(icons.distV, 'Repartir en vertical', () => this.distribute('v')),
    );
    const r = anchor.getBoundingClientRect();
    pop.style.left = r.left + 'px';
    pop.style.top = r.bottom + 6 + 'px';
    document.body.append(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }));
  }

  // ================================================================== lápiz
  strokesToShapes() {
    const strokes = this.selectedItems().filter((i): i is StrokeItem => i.kind === 'stroke');
    const changes: Item[] = [];
    const added: string[] = [];
    for (const s of strokes) {
      const sh = recognizeStroke(s);
      if (!sh) continue;
      changes.push({ ...s, deleted: true }, sh);
      added.push(sh.id);
    }
    if (!added.length) return toast('No reconozco ninguna forma (rectángulo, elipse, triángulo, rombo o línea)');
    this.doc.commit(changes);
    this.selection = new Set(added);
    this.refreshUI();
    toast(`${added.length} forma${added.length === 1 ? '' : 's'} creada${added.length === 1 ? '' : 's'}`);
  }

  async strokesToText() {
    const strokes = this.selectedItems().filter((i): i is StrokeItem => i.kind === 'stroke');
    if (!strokes.length) return;
    const t = toast('Reconociendo escritura…', 120000);
    try {
      const { recognizeHandwriting } = await import('../features/ocr');
      const text = await recognizeHandwriting(strokes, (m) => (t.textContent = 'Reconociendo… ' + m));
      if (!text) return toast('No he podido leer el texto: prueba con letra más clara', 3500);
      let r: Rect | null = null;
      for (const s of strokes) r = unionRect(r, itemBounds(s));
      const lines = text.split('\n').length;
      const size = Math.max(8, r!.h / lines / TEXT_LINE);
      const color = strokes.map((s) => s.color).find((c) => c !== '#ffffff') ?? PEN_COLORS[0];
      const it: TextItem = { ...this.newBase(), kind: 'text', x: r!.x, y: r!.y, text, size, color, z: this.doc.nextZ() };
      this.doc.commit([...strokes.map((s) => ({ ...s, deleted: true }) as Item), it]);
      this.selection = new Set([it.id]);
      this.refreshUI();
      toast('Revisa el texto: toca dos veces para corregirlo', 3000);
    } catch (e: any) {
      toast('No se pudo reconocer: ' + (e?.message || e), 4000);
    } finally {
      t.remove();
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
    const idMap = new Map(sel.map((it) => [it.id, uid()]));
    const groupMap = new Map<string, string>();
    const copies: Item[] = sel
      .sort((a, b) => a.z - b.z)
      .map((it) => {
        const id = idMap.get(it.id)!;
        const z = it.kind === 'frame' ? it.z : this.doc.nextZ();
        let c = { ...translateItem(it, off, off), id, z, deleted: undefined, locked: undefined } as Item;
        if (it.group) {
          if (!groupMap.has(it.group)) groupMap.set(it.group, uid());
          c.group = groupMap.get(it.group);
        }
        if (c.kind === 'connector') {
          // si también se duplican los extremos, la copia une las copias
          const re = (e: ConnectorEnd) => (e.id && idMap.has(e.id) ? { ...e, id: idMap.get(e.id) } : e);
          c = { ...c, from: re(c.from), to: re(c.to) };
        }
        return c;
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
    const ids = [...this.selection].filter((id) => {
      const it = this.doc.get(id);
      return it && !this.isLocked(it);
    });
    if (ids.length < this.selection.size) toast('Los elementos bloqueados no se borran');
    this.doc.remove(ids);
    this.selection.clear();
    this.refreshUI();
  }

  async rename() {
    if (this.readOnly) return;
    const name = await askText('Renombrar proyecto', this.meta.name);
    if (!name || name === this.meta.name) return;
    this.meta = { ...this.meta, name };
    this.els.title.textContent = name;
    await upsertLocalProject({ ...this.meta });
    remote.rename(this.meta.id, name).catch(() => {});
  }

  exportPng() {
    const c = renderToCanvas(this.shown(), 4096);
    if (!c) return toast('La pizarra está vacía');
    c.toBlob((blob) => blob && saveFile(blob, `${this.meta.name || 'canvas'}.png`), 'image/png');
  }


  exiting = false;
  async exit() {
    if (this.exiting) return;
    this.exiting = true;
    await this.saveThumbAndMeta();
    this.destroy();
    this.onExit();
  }

  async saveThumbAndMeta() {
    if (this.readOnly) return;
    this.doc.flush();
    this.saveView();
    const items = this.shown();
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
    window.removeEventListener('paste', this.onPaste);
    closePanels();
    getPlaying()?.el.pause();
    cancelAnimationFrame(this.animRaf);
    document.removeEventListener('click', this.closeMenu);
    this.root.remove();
  }
}

/** Copia de un elemento desplazada (dx, dy) en el mundo. */
export function translateItem(it: Item, dx: number, dy: number): Item {
  if (it.kind === 'layer' || it.kind === 'bookmark') return it;
  if (it.kind === 'connector') {
    // los extremos pegados siguen a su elemento; los sueltos se desplazan
    const mv = (e: ConnectorEnd) => ({ ...e, x: e.x + dx, y: e.y + dy });
    return { ...it, from: mv(it.from), to: mv(it.to) };
  }
  if (it.kind !== 'stroke') return { ...it, x: it.x + dx, y: it.y + dy };
  const pts = it.pts.slice();
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = Math.round((pts[i] + dx) * 100) / 100;
    pts[i + 1] = Math.round((pts[i + 1] + dy) * 100) / 100;
  }
  return { ...it, pts };
}
