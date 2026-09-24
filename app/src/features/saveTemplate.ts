// "Guardar como plantilla": la pizarra entera o lo seleccionado (con lo que haya dentro de los marcos elegidos).
import type { BoardView } from '../board/boardView';
import type { Item } from '../types';
import { hasServer, settings } from '../settings';
import { h, toast } from '../util';
import { itemBounds, renderToCanvas } from '../board/render';
import { saveCustom } from './customTemplates';
import { CATEGORIES } from './templates';

function selectedItems(b: BoardView): Item[] {
  b.expandGroups();
  const set = new Set(b.selection);
  const all = b.shown();
  // lo que está dentro de un marco seleccionado va con él
  for (const f of all) {
    if (f.kind !== 'frame' || !set.has(f.id)) continue;
    for (const it of all) {
      if (set.has(it.id) || it.kind === 'connector') continue;
      const r = itemBounds(it);
      if (r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h) set.add(it.id);
    }
  }
  // conectores que unen dos elementos incluidos
  for (const c of all) if (c.kind === 'connector' && c.from.id && c.to.id && set.has(c.from.id) && set.has(c.to.id)) set.add(c.id);
  // sin capa: en el proyecto nuevo esas capas no existen
  return all.filter((i) => set.has(i.id)).map(({ layer, ...rest }) => rest as Item);
}

function boardItems(b: BoardView): Item[] {
  return b.doc.visible().filter((i) => i.kind !== 'comment' && i.kind !== 'bookmark');
}

export function saveAsTemplate(b: BoardView) {
  const hasSel = b.selection.size > 0;
  const name = h('input', { type: 'text', value: b.meta.name, maxLength: 80 }) as HTMLInputElement;
  const cat = h('select', {}, h('option', { value: '' }, 'Sin categoría'), ...CATEGORIES.map((c) => h('option', { value: c }, c))) as HTMLSelectElement;
  const whole = h('input', { type: 'radio', name: 'tplscope', checked: !hasSel }) as HTMLInputElement;
  const sel = h('input', { type: 'radio', name: 'tplscope', checked: hasSel, disabled: !hasSel }) as HTMLInputElement;
  const shared = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const err = h('div', { class: 'test-result err' });
  const save = h('button', { class: 'btn primary' }, 'Guardar plantilla') as HTMLButtonElement;
  const close = () => bg.remove();

  save.onclick = async () => {
    const items = sel.checked ? selectedItems(b) : boardItems(b);
    if (!items.length) return void (err.textContent = 'No hay nada que guardar');
    save.disabled = true;
    try {
      const c = renderToCanvas(items, 360, '#ffffff', 30);
      await saveCustom({
        name: name.value.trim() || 'Plantilla',
        category: cat.value || undefined,
        thumb: c ? c.toDataURL('image/jpeg', 0.8) : undefined,
        shared: shared.checked,
        items,
      });
      toast('Plantilla guardada: aparecerá al crear un proyecto nuevo');
      close();
    } catch (e: any) {
      err.textContent = e?.message || String(e);
      save.disabled = false;
    }
  };

  const bg = h(
    'div',
    { class: 'modal-bg', onclick: (e: Event) => e.target === bg && close() },
    h(
      'div',
      { class: 'modal' },
      h('h2', {}, 'Guardar como plantilla'),
      h('p', {}, 'Podrás elegirla al crear un proyecto nuevo.'),
      h('label', {}, 'Nombre', name),
      h('label', {}, 'Categoría', cat),
      h('label', { class: 'check inline' }, whole, 'Toda la pizarra'),
      h('label', { class: 'check inline' + (hasSel ? '' : ' disabled') }, sel, hasSel ? `Solo lo seleccionado (${b.selection.size})` : 'Solo lo seleccionado (no hay nada seleccionado)'),
      settings.user && hasServer() ? h('label', { class: 'check' }, shared, 'Compartir con todos los usuarios del NAS') : '',
      !hasServer() ? h('p', { class: 'hint' }, 'Sin servidor, la plantilla se guarda solo en este dispositivo.') : '',
      err,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'), save),
    ),
  );
  document.body.append(bg);
  name.select();
  name.addEventListener('keydown', (e) => e.stopPropagation());
}
