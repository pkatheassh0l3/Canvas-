// Comentarios: hilos anclados a un punto de la pizarra, con autor, respuestas y "resuelto".
import { personAvatar } from '../ui/avatar';
import type { BoardView } from '../board/boardView';
import type { CommentItem } from '../types';
import { settings, saveSettings } from '../settings';
import { formatDate, h, uid } from '../util';
import { icons } from '../ui/icons';
import { askText } from '../ui/dialogs';
import { openPanel } from './panel';

export async function ensureName(): Promise<string | null> {
  if (settings.userName) return settings.userName;
  const n = await askText('¿Cómo te llamas?', '', 'Aceptar');
  if (!n) return null;
  settings.userName = n.slice(0, 40);
  saveSettings();
  return settings.userName;
}

export async function createComment(b: BoardView, x: number, y: number) {
  if (!(await ensureName())) return;
  const c: CommentItem = { id: uid(), rev: 0, by: '', z: b.doc.nextZ(), kind: 'comment', x, y, msgs: [], resolved: false };
  b.doc.add([c]);
  b.setTool('select');
  openComment(b, c.id, true);
}

let openEl: HTMLElement | null = null;

export function closeComment() {
  openEl?.remove();
  openEl = null;
}

export function openComment(b: BoardView, id: string, isNew = false) {
  closeComment();
  const input = h('textarea', { class: 'cm-input', rows: 2, placeholder: 'Escribe un comentario…' }) as HTMLTextAreaElement;
  const list = h('div', { class: 'cm-list' });
  const head = h('div', { class: 'cm-head' });
  const pop = h('div', { class: 'comment-pop', onpointerdown: (e: Event) => e.stopPropagation() }, head, list, h('div', { class: 'cm-send' }, input, h('button', { class: 'btn primary', onclick: () => send() }, 'Enviar')));
  openEl = pop;

  const get = () => {
    const c = b.doc.get(id);
    return c?.kind === 'comment' ? c : null;
  };
  const place = () => {
    const c = get();
    if (!c) return;
    const r = b.over.getBoundingClientRect();
    const sx = (c.x - b.view.x) * b.view.zoom + r.left;
    const sy = (c.y - b.view.y) * b.view.zoom + r.top;
    const pw = Math.min(320, window.innerWidth - 24);
    pop.style.width = pw + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - pw - 12, sx + 22)) + 'px';
    pop.style.top = Math.max(70, Math.min(window.innerHeight - pop.offsetHeight - 12, sy - 20)) + 'px';
  };
  const render = () => {
    const c = get();
    if (!c) return close(false);
    head.replaceChildren(
      h('strong', {}, c.msgs.length ? `Comentario · ${c.msgs.length}` : 'Nuevo comentario'),
      h('div', { class: 'grow' }),
      c.msgs.length === 0
        ? ''
        : h('button', {
          class: 'tb small' + (c.resolved ? ' on' : ''),
          title: c.resolved ? 'Reabrir' : 'Marcar como resuelto',
          html: icons.check,
          onclick: () => b.doc.commit([{ ...c, resolved: !c.resolved }]),
        }),
      h('button', { class: 'tb small danger', title: 'Borrar hilo', html: icons.trash, onclick: () => (b.doc.remove([id]), close(false)) }),
      h('button', { class: 'tb small', title: 'Cerrar', html: icons.x, onclick: () => close() }),
    );
    list.replaceChildren(
      ...c.msgs.map((m) =>
        h(
          'div',
          { class: 'cm-msg' },
          h('div', { class: 'cm-meta' }, m.authorId ? personAvatar(m.authorId, m.author, 20) : '', h('b', {}, m.author), ' · ', formatDate(m.at)),
          h('div', { class: 'cm-text' }, m.text),
          (m.authorId ? m.authorId === settings.user?.id : m.author === settings.userName) &&
            h('button', {
              class: 'cm-del',
              title: 'Borrar mensaje',
              onclick: () => {
                const cur = get();
                if (cur) b.doc.commit([{ ...cur, msgs: cur.msgs.filter((x) => x.id !== m.id) }]);
              },
              html: icons.x,
            }),
        ),
      ),
    );
    input.placeholder = c.msgs.length ? 'Responder…' : 'Escribe un comentario…';
    requestAnimationFrame(place);
  };
  const send = async () => {
    const text = input.value.trim();
    const c = get();
    if (!text || !c) return;
    const author = await ensureName();
    if (!author) return;
    b.doc.commit([{ ...c, resolved: false, msgs: [...c.msgs, { id: uid(8), author, authorId: settings.user?.id, text, at: Date.now() }] }]);
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') close();
  });
  const unsub = b.doc.subscribe(() => render());
  const onView = () => place();
  window.addEventListener('resize', onView);
  const close = (removeEmpty = true) => {
    unsub();
    window.removeEventListener('resize', onView);
    pop.remove();
    if (openEl === pop) openEl = null;
    const c = get();
    if (removeEmpty && c && !c.msgs.length) b.doc.remove([id]); // hilo vacío: no se guarda
  };
  (pop as any).close = close;
  b.root.append(pop);
  render();
  setTimeout(() => input.focus(), 30);
  if (isNew) b.selection.clear();
}

export function openCommentsPanel(b: BoardView) {
  openPanel(b, 'comments', 'Comentarios', ({ body }) => {
    const list = b.shown().filter((i): i is CommentItem => i.kind === 'comment' && i.msgs.length > 0);
    const open = list.filter((c) => !c.resolved);
    const done = list.filter((c) => c.resolved);
    const row = (c: CommentItem) =>
      h(
        'button',
        {
          class: 'search-hit' + (c.resolved ? ' resolved' : ''),
          onclick: () => {
            b.animateView({ zoom: Math.max(b.view.zoom, 0.8), x: c.x - b.w / 2 / Math.max(b.view.zoom, 0.8), y: c.y - b.h / 2 / Math.max(b.view.zoom, 0.8) });
            setTimeout(() => openComment(b, c.id), 380);
          },
        },
        h('small', {}, `${c.msgs[0].author} · ${formatDate(c.msgs[c.msgs.length - 1].at)} · ${c.msgs.length} mensaje${c.msgs.length === 1 ? '' : 's'}`),
        h('span', {}, c.msgs[0].text.slice(0, 140)),
      );
    body.replaceChildren(
      h('p', { class: 'panel-hint' }, 'Usa Insertar → Comentario y toca la pizarra donde quieras dejarlo.'),
      ...(open.length ? open.map(row) : [h('p', { class: 'panel-hint' }, 'No hay comentarios abiertos.')]),
      done.length ? h('div', { class: 'ip-title' }, `Resueltos (${done.length})`) : '',
      ...done.map(row),
    );
  });
}
