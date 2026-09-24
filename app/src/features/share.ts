// Enlace de solo lectura: cualquiera que llegue al NAS puede ver la pizarra en directo, sin editar.
import type { BoardView } from '../board/boardView';
import { hasServer, serverBase, settings } from '../settings';
import { h, toast } from '../util';
import { icons } from '../ui/icons';
import { askConfirm } from '../ui/dialogs';
import { accounts, type Member } from '../store';
import { avatarColor, initials } from '../ui/account';
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
  let members: Member[] | null = null;
  let people: HTMLElement | null = null;
  if (settings.user) {
    people = h('div', { class: 'people' }, h('p', { class: 'panel-hint' }, 'Cargando…'));
    const isOwner = () => !b.meta.access || b.meta.access === 'owner';
    const renderPeople = () => {
      if (!people || !members) return;
      const rows = members.map((m) => {
        const me = m.id === settings.user?.id;
        const sel =
          isOwner() && m.access !== 'owner'
            ? (h(
                'select',
                {
                  onchange: async (ev: Event) => {
                    try {
                      members = await accounts.addMember(b.meta.id, m.username, (ev.target as HTMLSelectElement).value as 'edit' | 'view');
                      renderPeople();
                    } catch (e: any) {
                      toast(e?.message || String(e));
                    }
                  },
                },
                h('option', { value: 'edit', selected: m.access === 'edit' }, 'Puede editar'),
                h('option', { value: 'view', selected: m.access === 'view' }, 'Solo ver'),
              ) as HTMLSelectElement)
            : h('span', { class: 'hint' }, m.access === 'owner' ? 'Propietario' : m.access === 'edit' ? 'Puede editar' : 'Solo ver');
        return h(
          'div',
          { class: 'user-row' },
          h('span', { class: 'avatar', style: `background:${avatarColor(m.id)}` }, initials(m.name)),
          h('div', { class: 'grow' }, h('b', {}, m.name, me ? ' (tú)' : ''), h('div', { class: 'hint' }, m.username)),
          sel,
          isOwner() && m.access !== 'owner'
            ? h('button', {
                class: 'tb small danger',
                title: 'Quitar acceso',
                html: icons.x,
                onclick: async () => {
                  try {
                    members = await accounts.removeMember(b.meta.id, m.id);
                    renderPeople();
                  } catch (e: any) {
                    toast(e?.message || String(e));
                  }
                },
              })
            : '',
        );
      });
      const add: (Node | string)[] = [];
      if (isOwner()) {
        const who = h('input', { type: 'text', placeholder: 'Usuario', list: 'cpp-users', autocapitalize: 'none', spellcheck: false, class: 'people-input' }) as HTMLInputElement;
        const dl = h('datalist', { id: 'cpp-users' });
        accounts
          .users()
          .then((us) => dl.replaceChildren(...us.filter((u) => !members!.some((m) => m.id === u.id)).map((u) => h('option', { value: u.username }, u.name))))
          .catch(() => {});
        const acc = h('select', {}, h('option', { value: 'edit' }, 'Puede editar'), h('option', { value: 'view' }, 'Solo ver')) as HTMLSelectElement;
        const go = async () => {
          if (!who.value.trim()) return;
          try {
            members = await accounts.addMember(b.meta.id, who.value.trim().toLowerCase(), acc.value as 'edit' | 'view');
            renderPeople();
            toast('Compartido: lo verá en "Compartidos conmigo"');
          } catch (e: any) {
            toast(e?.message || String(e));
          }
        };
        who.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') go();
        });
        add.push(h('div', { class: 'people-add' }, who, dl, acc, h('button', { class: 'btn primary', onclick: go }, 'Añadir')));
      }
      people.replaceChildren(
        h('p', { class: 'panel-hint' }, isOwner() ? 'Comparte con otras cuentas del NAS: lo verán en "Compartidos conmigo".' : 'Personas con acceso a este proyecto.'),
        ...add,
        ...rows,
      );
    };
    accounts
      .members(b.meta.id)
      .then((m) => ((members = m), renderPeople()))
      .catch((e) => people?.replaceChildren(h('p', { class: 'panel-hint' }, 'No se pudo cargar: ' + (e?.message || e))));
  }
  openPanel(
    b,
    'share',
    'Compartir',
    (ctl) => {
      const { body } = ctl;
      const head: Node[] = people ? [h('div', { class: 'mi-sep' }, 'Personas'), people, h('div', { class: 'mi-sep' }, 'Enlace de solo lectura')] : [];
      if (token === undefined) {
        body.replaceChildren(...head, h('p', { class: 'panel-hint' }, 'Cargando…'));
        api('GET', b.meta.id)
          .then((r) => ((token = r.token), ctl.refresh()))
          .catch(() => ((token = null), ctl.refresh()));
        return;
      }
      const url = token ? shareUrl(b.meta.id, token) : '';
      const input = h('input', { type: 'text', readOnly: true, value: url, class: 'share-url', onclick: () => input.select() }) as HTMLInputElement;
      body.replaceChildren(
        ...head,
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
