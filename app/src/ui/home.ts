// Pantalla de proyectos + ajustes de conexión al NAS.
import type { ProjectMeta } from '../types';
import { settings, saveSettings, hasServer, setAccount, serverBase } from '../settings';
import { formatDate, h, toast, uid } from '../util';
import { icons } from './icons';
import { askConfirm, askText } from './dialogs';
import { APP_VERSION, manualCheck } from '../updates';
import { accounts, health, localProjects, remote, removeLocalProject, syncProjectList, testServer, upsertLocalProject } from '../store';
import { avatarColor, initials, openMyAccount, openUsersAdmin } from './account';
import type { LoginView } from './login';

export class HomeView {
  root: HTMLElement;
  private grid: HTMLElement;
  private status: HTMLElement;
  private list: ProjectMeta[] = [];

  private userBtn: HTMLElement;

  constructor(
    private onOpen: (p: ProjectMeta) => void,
    private onLogin: (opts?: ConstructorParameters<typeof LoginView>[1]) => void,
  ) {
    this.grid = h('div', { class: 'projects' });
    this.status = h('div', { class: 'conn' });
    this.userBtn = h('div', { class: 'user-slot' });
    this.renderUser();
    this.root = h(
      'div',
      { class: 'home' },
      h(
        'header',
        { class: 'home-head' },
        h('div', { class: 'brand' }, h('span', { class: 'logo', html: icons.sticky }), h('h1', {}, 'Canvas', h('b', {}, '++'))),
        this.status,
        h('div', { class: 'grow' }),
        h('button', { class: 'tb', title: 'Actualizar', html: icons.refresh, onclick: () => this.refresh() }),
        h('button', { class: 'tb', title: 'Ajustes', html: icons.settings, onclick: () => this.openSettings() }),
        h('button', { class: 'btn primary', onclick: () => this.create() }, h('span', { html: icons.plus }), 'Nuevo proyecto'),
        this.userBtn,
      ),
      this.grid,
    );
    this.refresh();
  }

  async refresh() {
    this.list = await localProjects();
    this.render();
    if (!hasServer()) {
      this.setConn('local', 'Solo local — conecta tu NAS en Ajustes');
      return;
    }
    this.setConn('connecting', 'Conectando…');
    const r = await syncProjectList();
    this.list = r.list;
    this.setConn(
      r.online ? 'online' : 'offline',
      r.online ? 'NAS conectado' : `Sin conexión${r.error ? ' (' + r.error + ')' : ''}`,
    );
    this.render();
  }

  /** Botón con la inicial de la cuenta y su menú (mi cuenta, usuarios, cerrar sesión). */
  private renderUser() {
    const u = settings.user;
    if (!u) return this.userBtn.replaceChildren();
    const menu = h(
      'div',
      { class: 'acct-menu hidden' },
      h('div', { class: 'acct-head' }, h('b', {}, u.name), h('span', { class: 'hint' }, `${u.username}${u.role === 'admin' ? ' · administrador' : ''}`)),
      h('button', { class: 'mi', onclick: () => (menu.classList.add('hidden'), openMyAccount(() => this.renderUser())) }, h('span', { html: icons.user }), 'Mi cuenta'),
      u.role === 'admin' ? h('button', { class: 'mi', onclick: () => (menu.classList.add('hidden'), openUsersAdmin()) }, h('span', { html: icons.users }), 'Usuarios') : '',
      h(
        'button',
        {
          class: 'mi',
          onclick: async () => {
            menu.classList.add('hidden');
            if (!(await askConfirm('¿Cerrar sesión?', 'Tus proyectos siguen guardados en el NAS. En este dispositivo tendrás que volver a entrar.', 'Cerrar sesión'))) return;
            setAccount('', null);
            this.onLogin();
          },
        },
        h('span', { html: icons.logout }),
        'Cerrar sesión',
      ),
    );
    const btn = h(
      'button',
      { class: 'avatar-btn', title: `${u.name} (${u.username})`, onclick: (e: Event) => (e.stopPropagation(), menu.classList.toggle('hidden')) },
      h('span', { class: 'avatar', style: `background:${avatarColor(u.id)}` }, initials(u.name)),
    );
    document.addEventListener('pointerdown', (e) => !menu.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node) && menu.classList.add('hidden'));
    this.userBtn.replaceChildren(btn, menu);
  }

  private setConn(cls: string, text: string) {
    this.status.className = 'conn ' + cls;
    this.status.replaceChildren(h('span', { class: 'status ' + cls }), text);
  }

  private render() {
    if (!this.list.length) {
      this.grid.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-icon', html: icons.sticky }),
          h('p', {}, 'Aún no hay proyectos.'),
          h('button', { class: 'btn primary', onclick: () => this.create() }, 'Crear el primero'),
        ),
      );
      return;
    }
    const mine = this.list.filter((p) => !p.access || p.access === 'owner');
    const shared = this.list.filter((p) => p.access && p.access !== 'owner');
    const section = (title: string, list: ProjectMeta[]) =>
      list.length ? [h('h2', { class: 'section-title' }, title), h('div', { class: 'grid' }, ...list.map((p) => this.card(p)))] : [];
    this.grid.replaceChildren(
      ...(shared.length
        ? mine.length
          ? section('Mis proyectos', mine)
          : [h('h2', { class: 'section-title' }, 'Mis proyectos'), h('p', { class: 'hint empty-mine' }, 'Aún no tienes proyectos propios. Crea uno con "Nuevo proyecto".')]
        : [h('div', { class: 'grid' }, ...mine.map((p) => this.card(p)))]),
      ...section('Compartidos conmigo', shared),
    );
  }

  private card(p: ProjectMeta) {
    const owner = !p.access || p.access === 'owner';
    const badge =
      p.access === 'view' ? h('span', { class: 'badge ro' }, 'Solo ver') : p.access === 'edit' ? h('span', { class: 'badge' }, 'Puede editar') : p.shared ? h('span', { class: 'badge' }, 'Compartido') : '';
    return h(
          'div',
          { class: 'card', onclick: () => this.onOpen(p) },
          h('div', { class: 'thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { html: icons.sticky })),
          h(
            'div',
            { class: 'card-body' },
            h('div', { class: 'card-title' }, p.name),
            h('div', { class: 'card-meta' }, formatDate(p.updatedAt), p.synced ? '' : ' · solo local', !owner && p.ownerName ? ` · de ${p.ownerName}` : ''),
            badge,
          ),
          h(
            'div',
            { class: 'card-actions' },
            p.access !== 'view'
              ? h('button', {
                  class: 'tb small',
                  title: 'Renombrar',
                  html: icons.edit,
                  onclick: (e: Event) => (e.stopPropagation(), this.rename(p)),
                })
              : '',
            owner
              ? h('button', {
                  class: 'tb small danger',
                  title: 'Eliminar',
                  html: icons.trash,
                  onclick: (e: Event) => (e.stopPropagation(), this.remove(p)),
                })
              : h('button', {
                  class: 'tb small danger',
                  title: 'Salir del proyecto',
                  html: icons.logout,
                  onclick: (e: Event) => (e.stopPropagation(), this.leave(p)),
                }),
          ),
        );
  }

  /** Deja de ver un proyecto que te compartieron (el propietario lo conserva). */
  private async leave(p: ProjectMeta) {
    if (!settings.user) return;
    if (!(await askConfirm(`¿Salir de "${p.name}"?`, `Dejarás de verlo. ${p.ownerName ?? 'El propietario'} puede volver a compartirlo contigo.`, 'Salir'))) return;
    try {
      await accounts.removeMember(p.id, settings.user.id);
    } catch (e: any) {
      return toast(e?.message || 'No se puede salir sin conexión con el NAS');
    }
    await removeLocalProject(p.id);
    this.refresh();
  }

  private async create() {
    const name = await askText('Nuevo proyecto', 'Nuevo proyecto', 'Crear');
    if (!name) return;
    const now = Date.now();
    const meta: ProjectMeta = { id: uid(), name, createdAt: now, updatedAt: now, synced: false };
    if (hasServer()) {
      try {
        Object.assign(meta, await remote.create(meta.id, name), { synced: true });
      } catch {
        toast('Sin conexión: el proyecto se subirá al NAS cuando vuelva la conexión');
      }
    }
    await upsertLocalProject(meta);
    this.onOpen(meta);
  }

  private async rename(p: ProjectMeta) {
    const name = await askText('Renombrar proyecto', p.name);
    if (!name || name === p.name) return;
    await upsertLocalProject({ ...p, name });
    if (p.synced) remote.rename(p.id, name).catch(() => toast('No se pudo renombrar en el NAS'));
    this.refresh();
  }

  private async remove(p: ProjectMeta) {
    if (
      !(await askConfirm(
        `¿Eliminar "${p.name}"?`,
        p.synced
          ? 'Se borrará en todos los dispositivos (queda una copia en la papelera del NAS).'
          : 'Solo existe en este dispositivo.',
      ))
    )
      return;
    if (p.synced) {
      try {
        await remote.remove(p.id);
      } catch {
        return toast('No se puede eliminar sin conexión con el NAS');
      }
    }
    await removeLocalProject(p.id);
    this.refresh();
  }

  private openSettings() {
    const url = h('input', {
      type: 'url',
      placeholder: 'http://192.168.1.50:8787',
      value: settings.serverUrl,
    }) as HTMLInputElement;
    const token = h('input', {
      type: 'password',
      placeholder: 'El CANVAS_TOKEN del docker-compose',
      value: settings.token,
    }) as HTMLInputElement;
    const result = h('div', { class: 'test-result' });
    // botón para activar las cuentas si el servidor todavía no las tiene
    const accountsRow = h('div', { class: 'row' });
    if (hasServer() && !settings.user)
      health()
        .then((i) => {
          if (!i.users)
            accountsRow.replaceChildren(
              h(
                'button',
                { class: 'btn', onclick: () => (dlg.remove(), this.onLogin({ mode: 'setup', info: i })) },
                h('span', { html: icons.users }),
                'Activar cuentas de usuario',
              ),
              h('span', { class: 'hint' }, 'Cada persona con su usuario y sus proyectos'),
            );
        })
        .catch(() => {});
    const updResult = h('div', { class: 'test-result' });
    const penOnly = h('input', { type: 'checkbox', checked: settings.penOnly }) as HTMLInputElement;
    const apply = () => {
      const newUrl = url.value.trim().replace(/\/+$/, '');
      if (settings.user && newUrl !== serverBase()) setAccount('', null); // otra dirección: la sesión era de ese servidor
      settings.serverUrl = newUrl;
      if (!settings.user) settings.token = token.value.trim();
      settings.penOnly = penOnly.checked;
      settings.penAutoDetected = true;
      saveSettings();
    };
    const dlg = h(
      'div',
      { class: 'modal-bg', onclick: (e: Event) => e.target === dlg && dlg.remove() },
      h(
        'div',
        { class: 'modal' },
        h('h2', {}, 'Ajustes'),
        h('label', {}, 'Dirección del servidor en el NAS', url),
        settings.user ? h('p', { class: 'hint' }, `Sesión iniciada como ${settings.user.name} (${settings.user.username})`) : h('label', {}, 'Token (servidores sin cuentas de usuario)', token),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                apply();
                result.textContent = 'Probando…';
                result.className = 'test-result';
                try {
                  result.textContent = await testServer();
                  result.className = 'test-result ok';
                } catch (e: any) {
                  result.textContent = 'No se pudo conectar: ' + (e?.message || e);
                  result.className = 'test-result err';
                }
              },
            },
            'Probar conexión',
          ),
          result,
        ),
        accountsRow,
        h(
          'label',
          { class: 'check' },
          penOnly,
          'Modo lápiz: con el dedo solo se mueve y hace zoom (recomendado en tablet con lápiz)',
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                updResult.textContent = 'Buscando…';
                updResult.textContent = await manualCheck();
              },
            },
            'Buscar actualizaciones',
          ),
          updResult,
        ),
        h('p', { class: 'hint' }, `Canvas++ ${APP_VERSION} · ID de este dispositivo: ${settings.clientId}`),
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => dlg.remove() }, 'Cancelar'),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                apply();
                dlg.remove();
                // si el servidor nuevo usa cuentas, hay que iniciar sesión
                if (hasServer() && !settings.user) {
                  const i = await health().catch(() => null);
                  if (i?.users) return this.onLogin({ info: i });
                }
                this.refresh();
              },
            },
            'Guardar',
          ),
        ),
      ),
    );
    document.body.append(dlg);
  }
}
