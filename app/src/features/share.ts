// Enlace de solo lectura: cualquiera que llegue al NAS puede ver la pizarra en directo, sin editar.
import type { BoardView } from '../board/boardView';
import { hasServer, serverBase, settings } from '../settings';
import { h, toast } from '../util';
import { icons } from '../ui/icons';
import { askConfirm } from '../ui/dialogs';
import { openPanel } from './panel';

async function api(method: string, id: string) {
  const r = await fetch(`${serverBase()}/api/projects/${id}/share`, { method, headers: { Authorization: `Bearer ${settings.token}` } });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json();
}

export function shareUrl(projectId: string, token: string) {
  return `${serverBase()}/#view=${encodeURIComponent(projectId)}&s=${encodeURIComponent(token)}`;
}

export function openShare(b: BoardView) {
  if (!hasServer()) {
    toast('Para compartir hace falta el servidor del NAS (Ajustes)');
    return;
  }
  let token: string | null | undefined;
  openPanel(
    b,
    'share',
    'Compartir (solo lectura)',
    (ctl) => {
      const { body } = ctl;
      if (token === undefined) {
        body.replaceChildren(h('p', { class: 'panel-hint' }, 'Cargando…'));
        api('GET', b.meta.id)
          .then((r) => ((token = r.token), ctl.refresh()))
          .catch(() => ((token = null), ctl.refresh()));
        return;
      }
      const url = token ? shareUrl(b.meta.id, token) : '';
      const input = h('input', { type: 'text', readOnly: true, value: url, class: 'share-url', onclick: () => input.select() }) as HTMLInputElement;
      body.replaceChildren(
        h(
          'p',
          { class: 'panel-hint' },
          'Crea un enlace para que otra persona vea esta pizarra en directo desde el navegador, sin poder cambiar nada. Funciona para quien pueda llegar a tu NAS (red de casa o Tailscale).',
        ),
        token
          ? h(
              'div',
              {},
              input,
              h(
                'div',
                { class: 'row' },
                h(
                  'button',
                  {
                    class: 'btn primary',
                    onclick: async () => {
                      try {
                        await navigator.clipboard.writeText(url);
                        toast('Enlace copiado');
                      } catch {
                        input.select();
                        document.execCommand('copy');
                        toast('Enlace copiado');
                      }
                    },
                  },
                  h('span', { html: icons.copy }),
                  'Copiar enlace',
                ),
                h(
                  'button',
                  {
                    class: 'btn',
                    onclick: async () => {
                      if (!(await askConfirm('¿Desactivar el enlace?', 'Quien lo tenga dejará de poder ver la pizarra.', 'Desactivar'))) return;
                      await api('DELETE', b.meta.id).catch(() => toast('No se pudo desactivar'));
                      token = null;
                      ctl.refresh();
                    },
                  },
                  'Desactivar',
                ),
              ),
            )
          : h(
              'button',
              {
                class: 'btn primary',
                onclick: async () => {
                  try {
                    token = (await api('POST', b.meta.id)).token;
                    ctl.refresh();
                  } catch (e: any) {
                    toast('No se pudo crear el enlace: ' + (e?.message || e));
                  }
                },
              },
              h('span', { html: icons.share }),
              'Crear enlace de solo lectura',
            ),
      );
    },
    { live: false },
  );
}
