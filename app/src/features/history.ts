// Historial de versiones guardado en el NAS: ver, guardar con nombre y restaurar.
import type { BoardView } from '../board/boardView';
import type { Item } from '../types';
import { hasServer, serverBase, settings } from '../settings';
import { formatDate, h, toast } from '../util';
import { icons } from '../ui/icons';
import { askConfirm, askText } from '../ui/dialogs';
import { renderToCanvas } from '../board/render';
import { openPanel } from './panel';

interface Version {
  ts: number;
  label: string;
  items: number;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(serverBase() + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
  });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json();
}

export function openHistory(b: BoardView) {
  if (!hasServer()) {
    toast('El historial se guarda en el NAS: configura la conexión en Ajustes');
    return;
  }
  let versions: Version[] | null = null;
  let error = '';
  const load = async (ctl: { refresh: () => void }) => {
    try {
      versions = await api<Version[]>(`/api/projects/${b.meta.id}/history`);
      error = '';
    } catch (e: any) {
      error = e?.message || String(e);
    }
    ctl.refresh();
  };
  openPanel(
    b,
    'history',
    'Historial de versiones',
    (ctl) => {
      const { body } = ctl;
      if (versions == null && !error) {
        body.replaceChildren(h('p', { class: 'panel-hint' }, 'Cargando…'));
        load(ctl);
        return;
      }
      const rows = (versions ?? []).map((v) =>
        h(
          'div',
          { class: 'list-row' },
          h(
            'div',
            { class: 'list-main static' },
            h('strong', {}, v.label || 'Automática'),
            h('small', {}, `${formatDate(v.ts)} · ${v.items} elementos`),
          ),
          h('button', { class: 'tb small', title: 'Vista previa', html: icons.eye, onclick: () => preview(b, v) }),
          h('button', {
            class: 'tb small',
            title: 'Restaurar esta versión',
            html: icons.history,
            onclick: async () => {
              if (!(await askConfirm('¿Restaurar esta versión?', `La pizarra volverá a como estaba el ${formatDate(v.ts)} en todos los dispositivos. Antes se guarda una copia del estado actual.`, 'Restaurar'))) return;
              try {
                await api(`/api/projects/${b.meta.id}/history/${v.ts}/restore`, { method: 'POST' });
                toast('Versión restaurada');
                versions = null;
                ctl.refresh();
              } catch (e: any) {
                toast('No se pudo restaurar: ' + (e?.message || e));
              }
            },
          }),
        ),
      );
      body.replaceChildren(
        h('p', { class: 'panel-hint' }, 'El NAS guarda una copia automática cada 10 minutos mientras hay cambios. Puedes guardar versiones con nombre, que no se borran nunca.'),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const label = await askText('Nombre de la versión', 'Versión ' + new Date().toLocaleDateString('es-ES'), 'Guardar');
              if (!label) return;
              try {
                await api(`/api/projects/${b.meta.id}/history`, { method: 'POST', body: JSON.stringify({ label }) });
                toast('Versión guardada');
                versions = null;
                ctl.refresh();
              } catch (e: any) {
                toast('No se pudo guardar: ' + (e?.message || e));
              }
            },
          },
          h('span', { html: icons.plus }),
          'Guardar versión ahora',
        ),
        error ? h('p', { class: 'panel-hint err' }, 'Sin conexión con el NAS: ' + error) : '',
        ...(rows.length ? rows : [h('p', { class: 'panel-hint' }, 'Todavía no hay versiones guardadas.')]),
      );
    },
    { live: false },
  );
}

async function preview(b: BoardView, v: Version) {
  try {
    const { items } = await api<{ items: Item[] }>(`/api/projects/${b.meta.id}/history/${v.ts}`);
    const c = renderToCanvas(items.filter((i) => !i.deleted), 1400);
    const bg = h(
      'div',
      { class: 'modal-bg', onclick: () => bg.remove() },
      h(
        'div',
        { class: 'modal wide preview-modal' },
        h('h2', {}, `${v.label || 'Versión automática'} · ${formatDate(v.ts)}`),
        c ? h('img', { src: c.toDataURL('image/png'), class: 'preview-img' }) : h('p', {}, 'Versión vacía'),
      ),
    );
    document.body.append(bg);
  } catch (e: any) {
    toast('No se pudo cargar: ' + (e?.message || e));
  }
}
