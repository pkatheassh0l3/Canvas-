// Pantalla de inicio de sesión: entrar, crear cuenta (si el servidor lo permite)
// o crear el primer administrador cuando el servidor todavía no tiene usuarios.
import { saveSettings, serverBase, setAccount, settings } from '../settings';
import { accounts, health, type Health } from '../store';
import { h } from '../util';
import { icons } from './icons';

type Mode = 'login' | 'register' | 'setup';

export class LoginView {
  root: HTMLElement;
  private card: HTMLElement;
  private info: Health | null = null;
  private mode: Mode = 'login';

  constructor(
    private onDone: () => void,
    opts: { mode?: Mode; info?: Health | null; message?: string } = {},
  ) {
    this.card = h('div', { class: 'modal auth-card' });
    this.root = h('div', { class: 'home auth' }, this.card);
    this.info = opts.info ?? null;
    this.mode = opts.mode ?? (this.info && !this.info.users ? 'setup' : 'login');
    this.render(opts.message);
  }

  private render(message = '') {
    const m = this.mode;
    const field = (label: string, input: HTMLInputElement) => h('label', {}, label, input);
    const inp = (type: string, attrs: Record<string, any> = {}) => h('input', { type, ...attrs }) as HTMLInputElement;

    const server = inp('url', { placeholder: 'http://100.x.x.x:8787', value: settings.serverUrl, autocomplete: 'url' });
    const user = inp('text', { autocomplete: 'username', autocapitalize: 'none', spellcheck: false, placeholder: 'p.ej. esther' });
    const name = inp('text', { autocomplete: 'name', placeholder: 'Cómo te verán los demás' });
    const pass = inp('password', { autocomplete: m === 'login' ? 'current-password' : 'new-password' });
    const pass2 = inp('password', { autocomplete: 'new-password' });
    const serverToken = inp('password', { placeholder: 'El CANVAS_TOKEN del docker-compose' });
    const err = h('div', { class: 'test-result err' }, message);
    const submit = h('button', { class: 'btn primary wide', type: 'submit' }, m === 'login' ? 'Entrar' : 'Crear cuenta') as HTMLButtonElement;

    const titles: Record<Mode, [string, string]> = {
      login: ['Inicia sesión', 'Cada persona ve sus proyectos y los que le han compartido.'],
      register: ['Crear cuenta', 'Tu cuenta se guarda en el servidor del NAS.'],
      setup: [
        'Activa las cuentas de usuario',
        'Este servidor aún no tiene usuarios. Crea tu cuenta de administrador: los proyectos que ya existen pasarán a ser tuyos y podrás dar de alta a otras personas.',
      ],
    };

    const form = h(
      'form',
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          err.textContent = '';
          const base = server.value.trim().replace(/\/+$/, '');
          if (!/^https?:\/\//.test(base)) return void (err.textContent = 'Escribe la dirección del servidor (http://…)');
          if (m !== 'login' && pass.value !== pass2.value) return void (err.textContent = 'Las contraseñas no coinciden');
          submit.disabled = true;
          submit.textContent = 'Un momento…';
          try {
            if (base !== serverBase()) {
              settings.serverUrl = base;
              saveSettings();
              this.info = null;
            }
            this.info ??= await health();
            if (m === 'login' && !this.info.users) {
              // el servidor no tiene cuentas: se pasa a crear la del administrador
              this.mode = 'setup';
              return this.render('Este servidor todavía no tiene usuarios: crea el primero.');
            }
            const username = user.value.trim().toLowerCase();
            const s =
              m === 'login'
                ? await accounts.login(username, pass.value)
                : m === 'register'
                  ? await accounts.register({ username, name: name.value.trim(), password: pass.value })
                  : await accounts.setup({ username, name: name.value.trim(), password: pass.value, serverToken: serverToken.value.trim() || undefined });
            setAccount(s.token, s.user);
            this.onDone();
          } catch (e: any) {
            err.textContent = e?.name === 'AbortError' || e instanceof TypeError ? 'No se pudo conectar con el servidor' : e?.message || String(e);
            submit.disabled = false;
            submit.textContent = m === 'login' ? 'Entrar' : 'Crear cuenta';
          }
        },
      },
      field('Servidor', server),
      m !== 'login' ? field('Tu nombre', name) : '',
      field('Usuario', user),
      field('Contraseña', pass),
      m !== 'login' ? field('Repite la contraseña', pass2) : '',
      m === 'setup' && this.info?.setupToken ? field('Token del servidor (para demostrar que es tuyo)', serverToken) : '',
      err,
      submit,
    );

    const links = h('div', { class: 'auth-links' });
    if (m === 'login' && this.info?.signup) links.append(h('button', { class: 'linkish', type: 'button', onclick: () => ((this.mode = 'register'), this.render()) }, 'Crear una cuenta'));
    if (m === 'register') links.append(h('button', { class: 'linkish', type: 'button', onclick: () => ((this.mode = 'login'), this.render()) }, 'Ya tengo cuenta'));
    links.append(
      h(
        'button',
        {
          class: 'linkish muted',
          type: 'button',
          title: 'Los proyectos se quedan solo en este dispositivo',
          onclick: () => {
            settings.serverUrl = '';
            setAccount('', null);
            this.onDone();
          },
        },
        'Usar sin servidor',
      ),
    );

    this.card.replaceChildren(
      h('div', { class: 'brand' }, h('span', { class: 'logo', html: icons.sticky }), h('h1', {}, 'Canvas', h('b', {}, '++'))),
      h('h2', {}, titles[m][0]),
      h('p', { class: 'auth-sub' }, titles[m][1]),
      form,
      links,
    );
    setTimeout(() => (settings.serverUrl ? (m === 'login' ? user : name) : server).focus(), 0);
  }
}
