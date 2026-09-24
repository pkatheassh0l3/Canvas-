// Crear proyecto: en blanco o a partir de una plantilla (incluidas las personalizadas).
import type { Item } from '../types';
import { h, toast } from '../util';
import { icons } from './icons';
import { askConfirm, askText } from './dialogs';
import { renderToCanvas } from '../board/render';
import { buildTemplate, CATEGORIES, cloneWithNewIds, TEMPLATES } from '../features/templates';
import { deleteCustom, listCustom, loadCustom, updateCustom, type CustomTemplate } from '../features/customTemplates';

const thumbs = new Map<string, string>();
function builtinThumb(key: string) {
  let t = thumbs.get(key);
  if (!t) {
    const c = renderToCanvas(buildTemplate(key), 360, '#ffffff', 30);
    t = c ? c.toDataURL('image/png') : '';
    thumbs.set(key, t);
  }
  return t;
}

type Choice = { kind: 'blank' } | { kind: 'builtin'; key: string; name: string } | { kind: 'custom'; t: CustomTemplate };

export function openNewProject(): Promise<{ name: string; items: Item[] } | null> {
  return new Promise((resolve) => {
    let choice: Choice = { kind: 'blank' };
    let filter = 'Todas';
    let custom: CustomTemplate[] = [];
    let customOffline = false;

    const name = h('input', { type: 'text', class: 'np-name', placeholder: 'Nuevo proyecto', maxLength: 200 }) as HTMLInputElement;
    const chips = h('div', { class: 'np-chips' });
    const grid = h('div', { class: 'np-grid' });
    const createBtn = h('button', { class: 'btn primary' }, 'Crear') as HTMLButtonElement;

    const defaultName = () => (choice.kind === 'builtin' ? choice.name : choice.kind === 'custom' ? choice.t.name : 'Nuevo proyecto');
    const select = (c: Choice) => {
      choice = c;
      name.placeholder = defaultName();
      for (const el of grid.querySelectorAll('.np-card')) el.classList.toggle('on', (el as HTMLElement).dataset.k === keyOf(c));
    };
    const keyOf = (c: Choice) => (c.kind === 'blank' ? 'blank' : c.kind === 'builtin' ? 'b:' + c.key : 'c:' + c.t.id);

    const card = (c: Choice, thumb: Node, title: string, desc: string, extra: Node | string = '') =>
      h(
        'div',
        {
          class: 'np-card' + (keyOf(c) === keyOf(choice) ? ' on' : ''),
          'data-k': keyOf(c),
          tabIndex: 0,
          onclick: () => select(c),
          ondblclick: () => (select(c), create()),
          onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && (select(c), create()),
        },
        h('div', { class: 'np-thumb' }, thumb),
        h('div', { class: 'np-card-body' }, h('b', {}, title), h('span', {}, desc)),
        extra,
      );

    const customCard = (t: CustomTemplate) => {
      const actions = t.mine
        ? h(
            'div',
            { class: 'np-actions' },
            h('button', {
              class: 'tb small',
              title: 'Renombrar',
              html: icons.edit,
              onclick: async (e: Event) => {
                e.stopPropagation();
                const n = await askText('Nombre de la plantilla', t.name, 'Guardar');
                if (!n || n === t.name) return;
                try {
                  await updateCustom(t.id, { name: n });
                  t.name = n;
                  render();
                } catch (err: any) {
                  toast(err?.message || String(err));
                }
              },
            }),
            h('button', {
              class: 'tb small danger',
              title: 'Borrar plantilla',
              html: icons.trash,
              onclick: async (e: Event) => {
                e.stopPropagation();
                if (!(await askConfirm(`¿Borrar la plantilla "${t.name}"?`, t.shared ? 'Dejará de estar disponible para todos.' : 'Los proyectos creados con ella no cambian.'))) return;
                try {
                  await deleteCustom(t.id);
                  custom = custom.filter((x) => x.id !== t.id);
                  if (choice.kind === 'custom' && choice.t.id === t.id) choice = { kind: 'blank' };
                  render();
                } catch (err: any) {
                  toast(err?.message || String(err));
                }
              },
            }),
          )
        : '';
      const who = t.mine ? (t.shared ? 'Tuya · compartida con todos' : 'Tuya') : `De ${t.ownerName ?? 'otra persona'}`;
      return card(
        { kind: 'custom', t },
        t.thumb ? h('img', { src: t.thumb, alt: '' }) : h('span', { class: 'np-ico', html: icons.template }),
        t.name,
        who,
        actions,
      );
    };

    function render() {
      const cats = ['Todas', 'Mis plantillas', ...CATEGORIES];
      chips.replaceChildren(
        ...cats.map((c) =>
          h(
            'button',
            {
              class: 'chip' + (filter === c ? ' on' : ''),
              onclick: () => {
                filter = c;
                render();
              },
            },
            c === 'Mis plantillas' && custom.length ? `${c} (${custom.length})` : c,
          ),
        ),
      );
      const out: Node[] = [];
      const section = (t: string, cards: Node[]) => cards.length && out.push(h('h3', { class: 'np-sec' }, t), h('div', { class: 'np-cards' }, ...cards));
      if (filter === 'Todas')
        out.push(h('div', { class: 'np-cards' }, card({ kind: 'blank' }, h('span', { class: 'np-ico big', html: icons.plus }), 'En blanco', 'Pizarra vacía')));
      if (filter === 'Todas' || filter === 'Mis plantillas') {
        const cards = custom.map(customCard);
        if (filter === 'Mis plantillas' && !cards.length)
          out.push(
            h(
              'p',
              { class: 'hint np-empty' },
              customOffline
                ? 'Sin conexión con el NAS: no se pueden cargar tus plantillas.'
                : 'Aún no tienes plantillas propias. Dentro de un proyecto, en el menú ⋯ → "Guardar como plantilla", puedes guardar la pizarra entera o lo que tengas seleccionado.',
            ),
          );
        section('Mis plantillas', cards);
      }
      for (const cat of CATEGORIES) {
        if (filter !== 'Todas' && filter !== cat) continue;
        section(
          cat,
          TEMPLATES.filter((t) => t.category === cat).map((t) => {
            const img = h('img', { alt: '', loading: 'lazy' }) as HTMLImageElement;
            // miniaturas generadas poco a poco para no bloquear la apertura
            queue.push(() => (img.src = builtinThumb(t.key)));
            return card({ kind: 'builtin', key: t.key, name: t.name }, img, t.name, t.desc);
          }),
        );
      }
      grid.replaceChildren(...out);
      pump();
    }

    const queue: (() => void)[] = [];
    let pumping = false;
    function pump() {
      if (pumping) return;
      pumping = true;
      const step = () => {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < 12) queue.shift()!();
        if (queue.length && bg.isConnected) requestAnimationFrame(step);
        else pumping = false;
      };
      requestAnimationFrame(step);
    }

    const close = (r: { name: string; items: Item[] } | null) => {
      document.removeEventListener('keydown', onKey, true);
      bg.remove();
      resolve(r);
    };
    async function create() {
      createBtn.disabled = true;
      try {
        let items: Item[] = [];
        if (choice.kind === 'builtin') items = buildTemplate(choice.key);
        else if (choice.kind === 'custom') items = cloneWithNewIds(await loadCustom(choice.t.id));
        close({ name: name.value.trim() || defaultName(), items });
      } catch (e: any) {
        toast('No se pudo cargar la plantilla: ' + (e?.message || e));
        createBtn.disabled = false;
      }
    }
    createBtn.onclick = create;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter' && e.target === name) create();
    }
    document.addEventListener('keydown', onKey, true);

    const bg = h(
      'div',
      { class: 'modal-bg', onclick: (e: Event) => e.target === bg && close(null) },
      h(
        'div',
        { class: 'modal np' },
        h('div', { class: 'np-head' }, h('h2', {}, 'Nuevo proyecto'), name),
        chips,
        grid,
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancelar'), createBtn),
      ),
    );
    document.body.append(bg);
    render();
    name.focus();
    listCustom().then((r) => {
      custom = r.list;
      customOffline = r.offline;
      if (bg.isConnected) render();
    });
  });
}
