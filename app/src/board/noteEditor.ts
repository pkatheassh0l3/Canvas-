// Editor a pantalla completa para dibujar el sketch de un post-it (pensado para tablet + lápiz).
import type { NoteItem, StrokeData } from '../types';
import { settings } from '../settings';
import { distToSeg, h } from '../util';
import { icons } from '../ui/icons';
import { StrokeCapture, isPenEraser } from './capture';
import { drawStroke, NOTE_COLORS, NOTE_FONT, PEN_COLORS, wrapText } from './render';
import { mergeSet, mergeValue, strokeKey } from '../sync/merge';

export interface NoteEditorResult {
  action: 'save' | 'cancel' | 'delete';
  note?: NoteItem;
}

type NoteState = Pick<NoteItem, 'strokes' | 'text' | 'color'>;

export function openNoteEditor(
  note: NoteItem,
  opts: {
    isNew: boolean;
    /** Guardado en vivo (lo ven los demás dispositivos). */
    onChange?: (s: NoteState) => void;
    /** Cambios que llegan de otro dispositivo mientras está abierto. */
    subscribe?: (fn: (n: NoteItem) => void) => () => void;
  },
): Promise<NoteEditorResult> {
  return new Promise((resolve) => {
    const draft: NoteItem = { ...note, strokes: [...note.strokes] };
    // ---- tiempo real: última versión común y lo que ha llegado de fuera (para "Cancelar" sin perderlo)
    const snap = (): NoteState => ({ strokes: draft.strokes, text: text.value, color: draft.color });
    const sameState = (a: NoteState, b: NoteState) => a.text === b.text && a.color === b.color && a.strokes.length === b.strokes.length && a.strokes.every((x, i) => x === b.strokes[i] || strokeKey(x) === strokeKey(b.strokes[i]));
    let base: NoteState = { strokes: [...note.strokes], text: note.text, color: note.color };
    const remoteAdded = new Map<string, StrokeData>();
    const remoteRemoved = new Set<string>();
    let remoteText: string | null = null;
    let remoteColor: string | null = null;
    let liveTimer: any = null;
    const sendNow = (s: NoteState = snap()) => {
      clearTimeout(liveTimer);
      liveTimer = null;
      if (!opts.onChange || sameState(s, base)) return;
      base = { strokes: [...s.strokes], text: s.text, color: s.color };
      opts.onChange(base);
    };
    const pushLive = () => {
      if (!opts.onChange) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => sendNow(), 400);
    };
    const undo: StrokeData[][] = [];
    const redo: StrokeData[][] = [];
    let tool: 'pen' | 'marker' | 'eraser' = 'pen';
    let color = PEN_COLORS[0];
    const sizes = { pen: [2, 4, 8], marker: [10, 18, 28], eraser: [10, 20, 40] };
    let sizeIdx = 1;
    let k = 1; // px de pantalla por unidad del post-it

    const canvas = h('canvas', { class: 'ne-canvas' });
    const ctx = canvas.getContext('2d')!;
    const text = h('textarea', {
      class: 'ne-text',
      placeholder: 'Texto del post-it (opcional)',
      rows: 2,
      value: draft.text,
    }) as HTMLTextAreaElement;
    text.addEventListener('input', () => {
      draft.text = text.value;
      paint();
      pushLive();
    });

    const toolBtns: Record<string, HTMLButtonElement> = {};
    const mkTool = (t: typeof tool, icon: string, title: string) =>
      (toolBtns[t] = h('button', { class: 'tb', title, html: icon, onclick: () => setTool(t) }));

    const colorWrap = h('div', { class: 'swatches' });
    const renderColors = () => {
      colorWrap.replaceChildren(
        ...PEN_COLORS.map((c) =>
          h('button', {
            class: 'sw' + (c === color ? ' on' : ''),
            style: `--c:${c}`,
            title: c,
            onclick: () => {
              color = c;
              if (tool === 'eraser') setTool('pen');
              renderColors();
            },
          }),
        ),
      );
    };
    const sizeWrap = h('div', { class: 'sizes' });
    const renderSizes = () => {
      sizeWrap.replaceChildren(
        ...[0, 1, 2].map((i) =>
          h(
            'button',
            { class: 'sz' + (i === sizeIdx ? ' on' : ''), onclick: () => ((sizeIdx = i), renderSizes()) },
            h('span', { style: `width:${6 + i * 5}px;height:${6 + i * 5}px` }),
          ),
        ),
      );
    };
    const noteColorWrap = h('div', { class: 'swatches note-sw' });
    const renderNoteColors = () => {
      noteColorWrap.replaceChildren(
        ...NOTE_COLORS.map((c) =>
          h('button', {
            class: 'sw sq' + (c === draft.color ? ' on' : ''),
            style: `--c:${c}`,
            title: 'Color del post-it',
            onclick: () => {
              draft.color = c;
              renderNoteColors();
              paint();
              pushLive();
            },
          }),
        ),
      );
    };

    const btnUndo = h('button', { class: 'tb', title: 'Deshacer', html: icons.undo, onclick: () => doUndo() });
    const btnRedo = h('button', { class: 'tb', title: 'Rehacer', html: icons.redo, onclick: () => doRedo() });

    const finish = (r: NoteEditorResult) => {
      if (r.action === 'save') sendNow();
      else if (r.action === 'cancel' && opts.onChange) {
        // se deshace solo lo mío: lo que llegó de otros dispositivos se queda
        const strokes = note.strokes.filter((st) => !remoteRemoved.has(strokeKey(st)));
        for (const [k2, st] of remoteAdded) if (!strokes.some((x) => strokeKey(x) === k2)) strokes.push(st);
        sendNow({ strokes, text: remoteText ?? note.text, color: remoteColor ?? note.color });
      }
      unsub?.();
      clearTimeout(liveTimer);
      window.removeEventListener('resize', layout);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(r);
    };

    const root = h(
      'div',
      { class: 'ne-root' },
      h(
        'div',
        { class: 'ne-top' },
        h('button', { class: 'btn ghost', onclick: () => finish({ action: 'cancel' }) }, 'Cancelar'),
        noteColorWrap,
        h(
          'div',
          { class: 'row' },
          !opts.isNew &&
            h('button', {
              class: 'tb danger',
              title: 'Eliminar post-it',
              html: icons.trash,
              onclick: () => finish({ action: 'delete' }),
            }),
          h(
            'button',
            { class: 'btn primary', onclick: () => finish({ action: 'save', note: { ...draft, text: text.value } }) },
            'Hecho',
          ),
        ),
      ),
      h('div', { class: 'ne-stage' }, canvas),
      text,
      h(
        'div',
        { class: 'toolbar ne-tools' },
        mkTool('pen', icons.pen, 'Lápiz (P)'),
        mkTool('marker', icons.marker, 'Rotulador (M)'),
        mkTool('eraser', icons.eraser, 'Borrador (E)'),
        h('div', { class: 'sep' }),
        colorWrap,
        h('div', { class: 'sep' }),
        sizeWrap,
        h('div', { class: 'sep' }),
        btnUndo,
        btnRedo,
        h('button', {
          class: 'tb',
          title: 'Borrar todo el dibujo',
          html: icons.trash,
          onclick: () => {
            if (!draft.strokes.length) return;
            undo.push(draft.strokes);
            draft.strokes = [];
            paint();
            pushLive();
          },
        }),
      ),
    );

    function setTool(t: typeof tool) {
      tool = t;
      for (const [k2, b] of Object.entries(toolBtns)) b.classList.toggle('on', k2 === t);
    }

    function doUndo() {
      const prev = undo.pop();
      if (!prev) return;
      redo.push(draft.strokes);
      draft.strokes = prev;
      paint();
      pushLive();
    }
    function doRedo() {
      const n = redo.pop();
      if (!n) return;
      undo.push(draft.strokes);
      draft.strokes = n;
      paint();
      pushLive();
    }

    let live: StrokeCapture | null = null;
    let erasing = false;
    let activePointer = -1;

    function layout() {
      const stage = canvas.parentElement!;
      const r = stage.getBoundingClientRect();
      k = Math.min(r.width / draft.baseW, r.height / draft.baseH);
      const w = draft.baseW * k;
      const hh = draft.baseH * k;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = w + 'px';
      canvas.style.height = hh + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
      paint();
    }

    function paint() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = draft.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      if (draft.text) {
        ctx.font = NOTE_FONT;
        ctx.fillStyle = 'rgba(31,35,40,0.55)';
        ctx.textBaseline = 'top';
        wrapText(ctx, draft.text, draft.baseW - 24).forEach((l, i) => ctx.fillText(l, 12, 12 + i * 22));
      }
      for (const s of draft.strokes) drawStroke(ctx, s);
      if (live) drawStroke(ctx, live.data, true);
    }

    const toLocal = (cx: number, cy: number): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [(cx - r.left) / k, (cy - r.top) / k];
    };

    function eraseAt(e: PointerEvent) {
      const [x, y] = toLocal(e.clientX, e.clientY);
      const rad = sizes.eraser[sizeIdx] / 2 / k;
      const keep = draft.strokes.filter((s) => {
        for (let i = 0; i < s.pts.length - 3; i += 3) {
          if (distToSeg(x, y, s.pts[i], s.pts[i + 1], s.pts[i + 3], s.pts[i + 4]) <= rad + s.size / 2) return false;
        }
        return true;
      });
      if (keep.length !== draft.strokes.length) {
        draft.strokes = keep;
        paint();
      }
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (activePointer !== -1) return;
      if (e.pointerType === 'pen' && !settings.penAutoDetected) {
        settings.penOnly = true;
        settings.penAutoDetected = true;
      }
      if (settings.penOnly && e.pointerType === 'touch') return; // palm rejection
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      activePointer = e.pointerId;
      undo.push(draft.strokes);
      redo.length = 0;
      if (tool === 'eraser' || isPenEraser(e)) {
        erasing = true;
        eraseAt(e);
      } else {
        live = new StrokeCapture(e, toLocal, color, sizes[tool][sizeIdx] / k, tool, 0.6 / k);
        paint();
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointer) return;
      if (erasing) eraseAt(e);
      else if (live) {
        live.move(e);
        paint();
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      activePointer = -1;
      if (live) {
        draft.strokes = [...draft.strokes, live.finish()];
        live = null;
      } else if (erasing) {
        erasing = false;
        if (undo[undo.length - 1] === draft.strokes) undo.pop(); // no borró nada
      }
      paint();
      pushLive();
    };

    // ---- cambios que llegan de otro dispositivo: se mezclan con lo que estoy dibujando
    const unsub = opts.subscribe?.((n) => {
      const theirs: NoteState = { strokes: n.strokes, text: n.text, color: n.color };
      if (sameState(theirs, base)) return;
      const bk = new Set(base.strokes.map(strokeKey));
      const tk = new Set(theirs.strokes.map(strokeKey));
      for (const st of theirs.strokes) {
        const k2 = strokeKey(st);
        if (!bk.has(k2)) {
          remoteAdded.set(k2, st);
          remoteRemoved.delete(k2);
        }
      }
      for (const st of base.strokes) {
        const k2 = strokeKey(st);
        if (!tk.has(k2)) {
          remoteRemoved.add(k2);
          remoteAdded.delete(k2);
        }
      }
      if (theirs.text !== base.text) remoteText = theirs.text;
      if (theirs.color !== base.color) remoteColor = theirs.color;
      draft.strokes = mergeSet(base.strokes, draft.strokes, theirs.strokes, strokeKey);
      const t = mergeValue(base.text, text.value, theirs.text);
      if (t !== text.value && document.activeElement !== text) text.value = t;
      draft.text = text.value;
      draft.color = mergeValue(base.color, draft.color, theirs.color);
      if (n.baseW !== draft.baseW || n.baseH !== draft.baseH) {
        draft.baseW = n.baseW;
        draft.baseH = n.baseH;
        layout();
      }
      base = { strokes: [...theirs.strokes], text: theirs.text, color: theirs.color };
      renderNoteColors();
      paint();
      pushLive();
    });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function onKey(e: KeyboardEvent) {
      if (e.target === text) {
        if (e.key === 'Escape') text.blur();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') finish({ action: 'cancel' });
      else if (mod && e.key.toLowerCase() === 'z') e.shiftKey ? doRedo() : doUndo();
      else if (mod && e.key.toLowerCase() === 'y') doRedo();
      else if (e.key === 'p') setTool('pen');
      else if (e.key === 'm') setTool('marker');
      else if (e.key === 'e') setTool('eraser');
      else if (mod && e.key === 'Enter') finish({ action: 'save', note: { ...draft, text: text.value } });
      else return;
      e.preventDefault();
      e.stopPropagation();
    }

    document.body.append(root);
    setTool('pen');
    renderColors();
    renderSizes();
    renderNoteColors();
    window.addEventListener('resize', layout);
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(layout);
  });
}
