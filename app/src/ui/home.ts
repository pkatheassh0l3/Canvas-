// Pantalla de proyectos + ajustes de conexión al NAS.
import type { ProjectMeta } from '../types';
import { settings, saveSettings, hasServer, setAccount, serverBase } from '../settings';
import { formatDate, h, toast, uid } from '../util';
import { icons } from './icons';
import { askConfirm, askText } from './dialogs';
import { APP_VERSION, manualCheck } from '../updates';
import { accounts, health, localProjects, saveItems, remote, removeLocalProject, syncProjectList, testServer, upsertLocalProject } from '../store';
import { avatarColor, initials, openMyAccount, openUsersAdmin } from './account';
import { openNewProject } from './newProject';
import { folders, FOLDER_COLORS, type Folder } from '../features/folders';
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
    await folders.load();
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

  /** Carpeta abierta (null = raíz). Se recuerda en el dispositivo. */
  private folder: string | null = (() => {
    try {
      return localStorage.getItem('canvaspp.folder') || null;
    } catch {
      return null;
    }
  })();

  private openFolder(id: string | null) {
    this.folder = id;
    try {
      if (id) localStorage.setItem('canvaspp.folder', id);
      else localStorage.removeItem('canvaspp.folder');
    } catch {}
    this.render();
  }

  private render() {
    if (this.folder && !folders.byId(this.folder)) this.folder = null; // la carpeta se borró en otro dispositivo
    const ids = new Set(this.list.map((p) => p.id));
    const here = this.list.filter((p) => folders.folderOf(p.id) === this.folder);
    const subs = folders.children(this.folder);

    // migas de pan: Proyectos › Carpeta › Subcarpeta (también aceptan proyectos arrastrados)
    const crumbs = h('nav', { class: 'crumbs' });
    const crumb = (label: string, id: string | null, current: boolean) => {
      const el = h('button', { class: 'crumb' + (current ? ' current' : ''), onclick: () => this.openFolder(id) }, label);
      this.dropTarget(el, id);
      return el;
    };
    crumbs.append(crumb('Proyectos', null, !this.folder));
    for (const f of folders.path(this.folder)) crumbs.append(h('span', { class: 'crumb-sep' }, '›'), crumb(f.name, f.id, f.id === this.folder));
    const tools = h(
      'div',
      { class: 'crumb-tools' },
      h('button', { class: 'btn ghost small', onclick: () => this.newFolder() }, h('span', { html: icons.folderPlus }), 'Nueva carpeta'),
    );

    const out: Node[] = [h('div', { class: 'crumb-bar' }, crumbs, tools)];
    if (subs.length) out.push(h('div', { class: 'folder-grid' }, ...subs.map((f) => this.folderCard(f, ids))));

    if (!here.length) {
      if (!this.list.length && !this.folder)
        out.push(
          h(
            'div',
            { class: 'empty' },
            h('div', { class: 'empty-icon', html: icons.sticky }),
            h('p', {}, 'Aún no hay proyectos.'),
            h('button', { class: 'btn primary', onclick: () => this.create() }, 'Crear el primero'),
          ),
        );
      else if (!subs.length)
        out.push(h('div', { class: 'empty small' }, h('p', {}, this.folder ? 'Carpeta vacía. Crea un proyecto aquí o arrastra proyectos a esta carpeta.' : 'No hay proyectos sueltos: están todos en carpetas.')));
      this.grid.replaceChildren(...out);
      return;
    }
    const mine = here.filter((p) => !p.access || p.access === 'owner');
    const shared = here.filter((p) => p.access && p.access !== 'owner');
    const section = (title: string, list: ProjectMeta[]) =>
      list.length ? [h('h2', { class: 'section-title' }, title), h('div', { class: 'grid' }, ...list.map((p) => this.card(p)))] : [];
    out.push(
      ...(shared.length
        ? mine.length
          ? section('Mis proyectos', mine)
          : this.folder
            ? []
            : [h('h2', { class: 'section-title' }, 'Mis proyectos'), h('p', { class: 'hint empty-mine' }, 'Aún no tienes proyectos propios. Crea uno con "Nuevo proyecto".')]
        : [h('div', { class: 'grid' }, ...mine.map((p) => this.card(p)))]),
      ...section('Compartidos conmigo', shared),
    );
    this.grid.replaceChildren(...out);
  }

  /** Zona donde soltar un proyecto o carpeta arrastrados. */
  private dropTarget(el: HTMLElement, folderId: string | null) {
    el.addEventListener('dragover', (e) => {
      const t = e.dataTransfer?.types ?? [];
      if (!t.includes('text/x-canvaspp-project') && !t.includes('text/x-canvaspp-folder')) return;
      e.preventDefault();
      el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const pid = e.dataTransfer?.getData('text/x-canvaspp-project');
      const fid = e.dataTransfer?.getData('text/x-canvaspp-folder');
      if (pid) await folders.moveProject(pid, folderId);
      else if (fid && !(await folders.moveFolder(fid, folderId))) toast('No se puede meter una carpeta dentro de sí misma');
      this.render();
    });
  }

  private folderCard(f: Folder, ids: Set<string>) {
    const n = folders.count(f.id, ids);
    const subs = folders.children(f.id).length;
    const el = h(
      'div',
      { class: 'folder-card', draggable: 'true', style: `--fc:${f.color || FOLDER_COLORS[0]}`, onclick: () => this.openFolder(f.id), title: f.name },
      h('span', { class: 'folder-ico', html: icons.folder }),
      h('div', { class: 'folder-body' }, h('b', {}, f.name), h('span', {}, `${n} ${n === 1 ? 'proyecto' : 'proyectos'}${subs ? ` · ${subs} ${subs === 1 ? 'carpeta' : 'carpetas'}` : ''}`)),
      h('button', { class: 'tb small', title: 'Opciones de la carpeta', html: icons.more, onclick: (e: Event) => (e.stopPropagation(), this.folderMenu(f)) }),
    );
    el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/x-canvaspp-folder', f.id));
    this.dropTarget(el, f.id);
    return el;
  }

  private async newFolder() {
    const name = await askText('Nueva carpeta', '', 'Crear');
    if (!name?.trim()) return;
    await folders.create(name.trim(), this.folder);
    this.render();
  }

  private folderMenu(f: Folder) {
    const close = () => bg.remove();
    const colors = h(
      'div',
      { class: 'folder-colors' },
      ...FOLDER_COLORS.map((c) =>
        h('button', {
          class: 'sw' + (c === (f.color || FOLDER_COLORS[0]) ? ' on' : ''),
          style: `--c:${c}`,
          title: 'Color',
          onclick: async () => {
            await folders.update(f.id, { color: c });
            close();
            this.render();
          },
        }),
      ),
    );
    const bg = h(
      'div',
      { class: 'modal-bg', onclick: (e: Event) => e.target === bg && close() },
      h(
        'div',
        { class: 'modal small' },
        h('h2', {}, f.name),
        colors,
        h(
          'div',
          { class: 'menu-list' },
          h(
            'button',
            {
              class: 'mi',
              onclick: async () => {
                close();
                const n = await askText('Renombrar carpeta', f.name, 'Guardar');
                if (n?.trim() && n !== f.name) await folders.update(f.id, { name: n.trim() });
                this.render();
              },
            },
            h('span', { html: icons.edit }),
            'Renombrar',
          ),
          h(
            'button',
            {
              class: 'mi',
              onclick: async () => {
                close();
                const dest = await this.pickFolder(`Mover "${f.name}" a…`, f.parent, f.id);
                if (dest === undefined) return;
                if (!(await folders.moveFolder(f.id, dest))) toast('No se puede meter una carpeta dentro de sí misma');
                this.render();
              },
            },
            h('span', { html: icons.moveIn }),
            'Mover a otra carpeta',
          ),
          h(
            'button',
            {
              class: 'mi danger',
              onclick: async () => {
                close();
                if (!(await askConfirm(`¿Borrar la carpeta "${f.name}"?`, 'Los proyectos y subcarpetas que tenga no se borran: pasan a la carpeta de arriba.', 'Borrar carpeta'))) return;
                await folders.remove(f.id);
                this.render();
              },
            },
            h('span', { html: icons.trash }),
            'Borrar carpeta',
          ),
        ),
      ),
    );
    document.body.append(bg);
  }

  /** Elegir carpeta de destino. Devuelve null para la raíz o undefined si se cancela. */
  private pickFolder(title: string, current: string | null, exclude?: string): Promise<string | null | undefined> {
    return new Promise((resolve) => {
      const banned = new Set(exclude ? [exclude, ...folders.descendants(exclude)] : []);
      const done = (v: string | null | undefined) => {
        bg.remove();
        resolve(v);
      };
      const row = (id: string | null, name: string, depth: number) =>
        h(
          'button',
          { class: 'mi pick' + (id === current ? ' on' : ''), style: `padding-left:${12 + depth * 20}px`, disabled: id ? banned.has(id) : false, onclick: () => done(id) },
          h('span', { html: id ? icons.folder : icons.sticky }),
          name,
          id === current ? h('b', { class: 'mi-state' }, 'aquí') : '',
        );
      const rows: Node[] = [row(null, 'Proyectos (sin carpeta)', 0)];
      const walk = (parent: string | null, depth: number) => {
        for (const f of folders.children(parent)) {
          rows.push(row(f.id, f.name, depth));
          walk(f.id, depth + 1);
        }
      };
      walk(null, 1);
      const bg = h(
        'div',
        { class: 'modal-bg', onclick: (e: Event) => e.target === bg && done(undefined) },
        h(
          'div',
          { class: 'modal small' },
          h('h2', {}, title),
          h('div', { class: 'menu-list folder-pick' }, ...rows),
          h(
            'div',
            { class: 'row end' },
            h(
              'button',
              {
                class: 'btn ghost',
                onclick: async () => {
                  const n = await askText('Nueva carpeta', '', 'Crear');
                  if (!n?.trim()) return;
                  const f = await folders.create(n.trim(), current && !banned.has(current) ? current : null);
                  done(f.id);
                },
              },
              h('span', { html: icons.folderPlus }),
              'Nueva carpeta',
            ),
            h('button', { class: 'btn', onclick: () => done(undefined) }, 'Cancelar'),
          ),
        ),
      );
      document.body.append(bg);
    });
  }

  private async moveProject(p: ProjectMeta) {
    const dest = await this.pickFolder(`Mover "${p.name}" a…`, folders.folderOf(p.id));
    if (dest === undefined) return;
    await folders.moveProject(p.id, dest);
    this.render();
    toast(dest ? `Movido a ${folders.byId(dest)?.name}` : 'Movido a Proyectos');
  }

  private card(p: ProjectMeta) {
    const owner = !p.access || p.access === 'owner';
    const badge =
      p.access === 'view' ? h('span', { class: 'badge ro' }, 'Solo ver') : p.access === 'edit' ? h('span', { class: 'badge' }, 'Puede editar') : p.shared ? h('span', { class: 'badge' }, 'Compartido') : '';
    const el = h(
      'div',
      { class: 'card', draggable: 'true', onclick: () => this.onOpen(p) },
      h('div', { class: 'thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '', draggable: 'false' }) : h('span', { html: icons.sticky })),
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
        h('button', {
          class: 'tb small',
          title: 'Mover a carpeta',
          html: icons.folder,
          onclick: (e: Event) => (e.stopPropagation(), this.moveProject(p)),
        }),
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
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/x-canvaspp-project', p.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    return el;
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
    await folders.forget(p.id);
    this.refresh();
  }

  private async create() {
    const r = await openNewProject();
    if (!r) return;
    const { name, items } = r;
    const now = Date.now();
    const meta: ProjectMeta = { id: uid(), name, createdAt: now, updatedAt: now, synced: false, itemCount: items.length };
    if (items.length) await saveItems(meta.id, items);
    if (hasServer()) {
      try {
        Object.assign(meta, await remote.create(meta.id, name, items.length ? items : undefined), { synced: true });
      } catch {
        toast('Sin conexión: el proyecto se subirá al NAS cuando vuelva la conexión');
      }
    }
    await upsertLocalProject(meta);
    if (this.folder) await folders.moveProject(meta.id, this.folder); // se crea en la carpeta abierta
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
    await folders.forget(p.id);
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
