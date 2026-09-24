// Editores en ventana para tablas y listas de tareas.
import type { TableItem, TodoItem } from '../types';
import { h } from '../util';
import { icons } from '../ui/icons';

function modal(title: string, body: HTMLElement, onSave: () => void, onCancel: () => void, wide = false) {
  const close = () => {
    window.removeEventListener('keydown', key);
    bg.remove();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      onCancel();
    }
  };
  const bg = h(
    'div',
    { class: 'modal-bg' },
    h(
      'div',
      { class: 'modal' + (wide ? ' wide' : '') },
      h('h2', {}, title),
      body,
      h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => (close(), onCancel()) }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: () => (close(), onSave()) }, 'Guardar'),
      ),
    ),
  );
  window.addEventListener('keydown', key);
  document.body.append(bg);
  return bg;
}

/** Edita celdas, filas y columnas. Devuelve la tabla nueva o null si se cancela. */
export function editTable(t: TableItem): Promise<TableItem | null> {
  return new Promise((resolve) => {
    let cells = t.cells.map((r) => [...r]);
    let header = t.header;
    const grid = h('div', { class: 'te-grid' });
    const headerCb = h('input', { type: 'checkbox', checked: header, onchange: () => ((header = headerCb.checked), render()) }) as HTMLInputElement;

    const render = () => {
      const cols = cells[0]?.length ?? 1;
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(90px, 1fr)) 34px`;
      grid.replaceChildren();
      cells.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          const ta = h('textarea', {
            class: 'te-cell' + (header && ri === 0 ? ' head' : ''),
            rows: 1,
            value: cell,
            oninput: () => (cells[ri][ci] = ta.value),
          }) as HTMLTextAreaElement;
          ta.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const all = [...grid.querySelectorAll('textarea')];
              const i = all.indexOf(ta);
              if (i === all.length - 1 && !e.shiftKey) {
                cells.push(new Array(cols).fill(''));
                render();
                (grid.querySelectorAll('textarea')[i + 1] as HTMLTextAreaElement | undefined)?.focus();
              } else all[i + (e.shiftKey ? -1 : 1)]?.focus();
            }
          });
          grid.append(ta);
        });
        grid.append(
          h('button', {
            class: 'tb small danger',
            title: 'Quitar fila',
            html: icons.minus,
            disabled: cells.length <= 1,
            onclick: () => {
              cells.splice(ri, 1);
              render();
            },
          }),
        );
      });
      for (let ci = 0; ci < cols; ci++)
        grid.append(
          h('button', {
            class: 'tb small danger te-colx',
            title: 'Quitar columna',
            html: icons.minus,
            disabled: cols <= 1,
            onclick: () => {
              cells = cells.map((r) => r.filter((_, i) => i !== ci));
              render();
            },
          }),
        );
    };
    const body = h(
      'div',
      {},
      h('div', { class: 'te-wrap' }, grid),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: () => ((cells = [...cells, new Array(cells[0]?.length ?? 1).fill('')]), render()) }, '+ Fila'),
        h('button', { class: 'btn', onclick: () => ((cells = cells.map((r) => [...r, ''])), render()) }, '+ Columna'),
        h('label', { class: 'check inline' }, headerCb, 'Primera fila como cabecera'),
      ),
    );
    render();
    modal(
      'Tabla',
      body,
      () => resolve({ ...t, cells, header }),
      () => resolve(null),
      true,
    );
    setTimeout(() => (grid.querySelector('textarea') as HTMLTextAreaElement | null)?.focus());
  });
}

/** Edita el título y las tareas. */
export function editTodo(t: TodoItem): Promise<TodoItem | null> {
  return new Promise((resolve) => {
    let items = t.items.map((i) => ({ ...i }));
    const title = h('input', { type: 'text', value: t.title, placeholder: 'Título de la lista' }) as HTMLInputElement;
    const list = h('div', { class: 'todo-edit' });
    const render = (focus?: number) => {
      list.replaceChildren(
        ...items.map((it, i) => {
          const cb = h('input', { type: 'checkbox', checked: it.done, onchange: () => (it.done = cb.checked) }) as HTMLInputElement;
          const inp = h('input', { type: 'text', value: it.t, placeholder: 'Tarea', oninput: () => (it.t = inp.value) }) as HTMLInputElement;
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              items.splice(i + 1, 0, { t: '', done: false });
              render(i + 1);
            } else if (e.key === 'Backspace' && !inp.value && items.length > 1) {
              e.preventDefault();
              items.splice(i, 1);
              render(Math.max(0, i - 1));
            }
          });
          return h(
            'div',
            { class: 'todo-row' },
            cb,
            inp,
            h('button', { class: 'tb small danger', title: 'Quitar', html: icons.x, onclick: () => ((items = items.filter((_, j) => j !== i)), render()) }),
          );
        }),
      );
      if (focus != null) (list.querySelectorAll('input[type=text]')[focus] as HTMLInputElement | undefined)?.focus();
    };
    const body = h(
      'div',
      {},
      h('label', {}, 'Título', title),
      list,
      h('button', { class: 'btn', onclick: () => ((items = [...items, { t: '', done: false }]), render(items.length - 1)) }, '+ Añadir tarea'),
    );
    render();
    modal(
      'Lista de tareas',
      body,
      () => resolve({ ...t, title: title.value.trim(), items: items.filter((i) => i.t.trim()) }),
      () => resolve(null),
    );
    setTimeout(() => (items.length ? (list.querySelector('input[type=text]') as HTMLInputElement)?.focus() : title.focus()));
  });
}
