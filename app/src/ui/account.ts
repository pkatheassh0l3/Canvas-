// Mi cuenta (nombre, contraseña, sesiones) y gestión de usuarios para el administrador.
import { setAccount, settings, type Account } from '../settings';
import { accounts } from '../store';
import { h, toast } from '../util';
import { icons } from './icons';
import { askConfirm } from './dialogs';
import { avatarEl, prepareAvatar } from './avatar';

function modal(title: string, ...content: (Node | string)[]) {
  const bg = h('div', { class: 'modal-bg', onclick: (e: Event) => e.target === bg && bg.remove() }, h('div', { class: 'modal' }, h('h2', {}, title), ...content));
  document.body.append(bg);
  return { bg, close: () => bg.remove() };
}

const input = (type: string, attrs: Record<string, any> = {}) => h('input', { type, ...attrs }) as HTMLInputElement;

/** Botón que muestra "…" mientras trabaja y el error debajo si algo falla. */
function action(label: string, cls: string, err: HTMLElement, fn: () => Promise<void>) {
  const b = h('button', { class: 'btn ' + cls }, label) as HTMLButtonElement;
  b.onclick = async () => {
    err.textContent = '';
    b.disabled = true;
    try {
      await fn();
    } catch (e: any) {
      err.textContent = e?.message || String(e);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

export function openMyAccount(onChange: () => void) {
  const u = settings.user;
  if (!u) return;
  const name = input('text', { value: u.name });
  const old = input('password', { autocomplete: 'current-password' });
  const pw = input('password', { autocomplete: 'new-password' });
  const pw2 = input('password', { autocomplete: 'new-password' });
  const err = h('div', { class: 'test-result err' });
  // foto de perfil
  const photoSlot = h('div', { class: 'acct-photo-img' }, avatarEl(u, 72));
  const refreshPhoto = () => photoSlot.replaceChildren(avatarEl(settings.user!, 72));
  const pickPhoto = () => {
    const i = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
    i.onchange = async () => {
      const f = i.files?.[0];
      if (!f) return;
      err.textContent = '';
      try {
        const me = await accounts.uploadAvatar(await prepareAvatar(f));
        setAccount(settings.token, me);
        refreshPhoto();
        onChange();
        toast('Foto de perfil actualizada');
      } catch (e: any) {
        err.textContent = e?.message || String(e);
      }
    };
    i.click();
  };
  const removeBtn = h('button', {
    class: 'btn ghost',
    onclick: async () => {
      try {
        const me = await accounts.deleteAvatar();
        setAccount(settings.token, me);
        refreshPhoto();
        onChange();
      } catch (e: any) {
        err.textContent = e?.message || String(e);
      }
    },
  }, 'Quitar');
  const { close } = modal(
    'Mi cuenta',
    h(
      'div',
      { class: 'acct-photo' },
      photoSlot,
      h(
        'div',
        {},
        h('b', {}, u.name),
        h('p', {}, `Usuario: ${u.username}${u.role === 'admin' ? ' · administrador' : ''}`),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: pickPhoto }, 'Cambiar foto'), removeBtn),
      ),
    ),
    h('label', {}, 'Nombre (lo ven los demás en comentarios y cursores)', name),
    h(
      'div',
      { class: 'row end' },
      action('Guardar nombre', '', err, async () => {
        const me = await accounts.rename(name.value.trim());
        setAccount(settings.token, me);
        toast('Nombre guardado');
        onChange();
      }),
    ),
    h('div', { class: 'mi-sep' }, 'Cambiar contraseña'),
    h('label', {}, 'Contraseña actual', old),
    h('label', {}, 'Contraseña nueva (mínimo 6 caracteres)', pw),
    h('label', {}, 'Repite la nueva', pw2),
    h(
      'div',
      { class: 'row end' },
      action('Cambiar contraseña', 'primary', err, async () => {
        if (pw.value !== pw2.value) throw new Error('Las contraseñas nuevas no coinciden');
        const r = await accounts.changePassword(old.value, pw.value);
        setAccount(r.token, settings.user);
        old.value = pw.value = pw2.value = '';
        toast('Contraseña cambiada. Los demás dispositivos tendrán que volver a entrar.');
      }),
    ),
    h('div', { class: 'mi-sep' }, 'Sesiones'),
    h(
      'div',
      { class: 'row' },
      action('Cerrar sesión en los demás dispositivos', '', err, async () => {
        if (!(await askConfirm('¿Cerrar las demás sesiones?', 'Tendrás que volver a entrar en tus otros dispositivos.', 'Cerrar sesiones'))) return;
        const r = await accounts.logoutAll();
        setAccount(r.token, settings.user);
        toast('Sesiones cerradas en los demás dispositivos');
      }),
    ),
    err,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cerrar')),
  );
}

export function openUsersAdmin() {
  const list = h('div', { class: 'user-list' }, h('p', { class: 'hint' }, 'Cargando…'));
  const err = h('div', { class: 'test-result err' });
  const load = async () => {
    try {
      const users = await accounts.users();
      list.replaceChildren(...users.map((u) => row(u as Account)));
    } catch (e: any) {
      err.textContent = e?.message || String(e);
    }
  };
  const row = (u: Account) => {
    const me = u.id === settings.user?.id;
    const role = h(
      'select',
      {
        disabled: me,
        title: me ? 'No puedes quitarte a ti mismo el rol de administrador' : 'Rol',
        onchange: async () => {
          try {
            await accounts.updateUser(u.id, { role: role.value });
            toast(`${u.name}: ${role.value === 'admin' ? 'administrador' : 'usuario'}`);
          } catch (e: any) {
            toast(e?.message || String(e));
            load();
          }
        },
      },
      h('option', { value: 'user', selected: u.role === 'user' }, 'Usuario'),
      h('option', { value: 'admin', selected: u.role === 'admin' }, 'Administrador'),
    ) as HTMLSelectElement;
    return h(
      'div',
      { class: 'user-row' },
      avatarEl(u, 32),
      h('div', { class: 'grow' }, h('b', {}, u.name, me ? ' (tú)' : ''), h('div', { class: 'hint' }, u.username)),
      role,
      h('button', {
        class: 'tb small',
        title: 'Poner contraseña nueva',
        html: icons.key,
        onclick: () => resetPassword(u),
      }),
      me
        ? ''
        : h('button', {
            class: 'tb small danger',
            title: 'Borrar usuario',
            html: icons.trash,
            onclick: async () => {
              if (!(await askConfirm(`¿Borrar a ${u.name}?`, 'Sus proyectos pasarán a ser tuyos y dejará de tener acceso a los compartidos.'))) return;
              try {
                await accounts.deleteUser(u.id);
                load();
              } catch (e: any) {
                toast(e?.message || String(e));
              }
            },
          }),
    );
  };

  const nName = input('text', { placeholder: 'Nombre' });
  const nUser = input('text', { placeholder: 'usuario', autocapitalize: 'none', spellcheck: false });
  const nPass = input('password', { placeholder: 'Contraseña inicial', autocomplete: 'new-password' });
  const nRole = h('select', {}, h('option', { value: 'user' }, 'Usuario'), h('option', { value: 'admin' }, 'Administrador')) as HTMLSelectElement;
  const { close } = modal(
    'Usuarios',
    h('p', {}, 'Cada persona entra con su usuario y ve sus proyectos y los que le compartan. Tú, como administrador, das de alta y de baja las cuentas.'),
    list,
    h('div', { class: 'mi-sep' }, 'Nuevo usuario'),
    h('div', { class: 'new-user' }, nName, nUser, nPass, nRole),
    err,
    h(
      'div',
      { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Cerrar'),
      action('Crear usuario', 'primary', err, async () => {
        const username = nUser.value.trim().toLowerCase();
        await accounts.createUser({ username, name: nName.value.trim() || username, password: nPass.value, role: nRole.value });
        toast(`Usuario ${username} creado. Pásale su usuario y contraseña.`);
        nName.value = nUser.value = nPass.value = '';
        load();
      }),
    ),
  );
  load();
}

function resetPassword(u: Account) {
  const pw = input('password', { autocomplete: 'new-password', placeholder: 'Mínimo 6 caracteres' });
  const err = h('div', { class: 'test-result err' });
  const { close } = modal(
    `Contraseña nueva para ${u.name}`,
    h('p', {}, 'Se cerrarán sus sesiones abiertas y tendrá que entrar con esta contraseña.'),
    h('label', {}, 'Contraseña', pw),
    err,
    h(
      'div',
      { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancelar'),
      action('Guardar', 'primary', err, async () => {
        await accounts.updateUser(u.id, { password: pw.value });
        toast('Contraseña cambiada');
        close();
      }),
    ),
  );
  pw.focus();
}

export { initials, avatarColor } from './avatar';
