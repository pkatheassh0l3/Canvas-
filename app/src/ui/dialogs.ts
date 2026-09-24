// Diálogos propios (Electron no soporta window.prompt).
import { h } from '../util';

export function askText(title: string, value = '', okLabel = 'Aceptar'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value }) as HTMLInputElement;
    const done = (v: string | null) => {
      bg.remove();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
    const bg = h(
      'div',
      { class: 'modal-bg', onclick: (e: Event) => e.target === bg && done(null) },
      h(
        'div',
        { class: 'modal small' },
        h('h2', {}, title),
        input,
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Cancelar'),
          h('button', { class: 'btn primary', onclick: () => done(input.value.trim() || null) }, okLabel),
        ),
      ),
    );
    document.body.append(bg);
    setTimeout(() => {
      input.focus();
      input.select();
    });
  });
}

export function askConfirm(title: string, text: string, okLabel = 'Eliminar'): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      bg.remove();
      resolve(v);
    };
    const bg = h(
      'div',
      { class: 'modal-bg', onclick: (e: Event) => e.target === bg && done(false) },
      h(
        'div',
        { class: 'modal small' },
        h('h2', {}, title),
        text ? h('p', {}, text) : null,
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancelar'),
          h('button', { class: 'btn danger', onclick: () => done(true) }, okLabel),
        ),
      ),
    );
    document.body.append(bg);
  });
}
