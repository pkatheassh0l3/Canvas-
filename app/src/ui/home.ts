// Pantalla de proyectos + ajustes de conexión al NAS.
import type { ProjectMeta } from '../types';
import { settings, saveSettings, hasServer } from '../settings';
import { formatDate, h, toast, uid } from '../util';
import { icons } from './icons';
import { askConfirm, askText } from './dialogs';
import { localProjects, remote, removeLocalProject, syncProjectList, testServer, upsertLocalProject } from '../store';

export class HomeView {
  root: HTMLElement;
  private grid: HTMLElement;
  private status: HTMLElement;
  private list: ProjectMeta[] = [];

  constructor(private onOpen: (p: ProjectMeta) => void) {
    this.grid = h('div', { class: 'grid' });
    this.status = h('div', { class: 'conn' });
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
    this.grid.replaceChildren(
      ...this.list.map((p) =>
        h(
          'div',
          { class: 'card', onclick: () => this.onOpen(p) },
          h('div', { class: 'thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { html: icons.sticky })),
          h(
            'div',
            { class: 'card-body' },
            h('div', { class: 'card-title' }, p.name),
            h('div', { class: 'card-meta' }, formatDate(p.updatedAt), p.synced ? '' : ' · solo local'),
          ),
          h(
            'div',
            { class: 'card-actions' },
            h('button', {
              class: 'tb small',
              title: 'Renombrar',
              html: icons.edit,
              onclick: (e: Event) => (e.stopPropagation(), this.rename(p)),
            }),
            h('button', {
              class: 'tb small danger',
              title: 'Eliminar',
              html: icons.trash,
              onclick: (e: Event) => (e.stopPropagation(), this.remove(p)),
            }),
          ),
        ),
      ),
    );
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
    const penOnly = h('input', { type: 'checkbox', checked: settings.penOnly }) as HTMLInputElement;
    const apply = () => {
      settings.serverUrl = url.value.trim();
      settings.token = token.value.trim();
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
        h('label', {}, 'Token', token),
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
        h(
          'label',
          { class: 'check' },
          penOnly,
          'Modo lápiz: con el dedo solo se mueve y hace zoom (recomendado en tablet con lápiz)',
        ),
        h('p', { class: 'hint' }, `ID de este dispositivo: ${settings.clientId}`),
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => dlg.remove() }, 'Cancelar'),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                apply();
                dlg.remove();
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
