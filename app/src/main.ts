import './style.css';
import type { ProjectMeta } from './types';
import { autodetectServer, hasServer, setAccount, settings } from './settings';
import { shareAuth } from './assets';
import { h } from './util';
import { HomeView } from './ui/home';
import { BoardView } from './board/boardView';
import { BoardDoc } from './board/doc';
import { health, loadItems } from './store';
import { LoginView } from './ui/login';
import { startUpdateChecks } from './updates';

const app = document.getElementById('app')!;
let board: BoardView | null = null;

function showHome() {
  board = null;
  if (location.hash.length > 1) history.back(); // quita la entrada del proyecto del historial
  app.replaceChildren(new HomeView(openProject, showLogin).root);
}

/** Pantalla de inicio de sesión (cierra la pizarra abierta, que ya está guardada en el dispositivo). */
async function showLogin(opts: ConstructorParameters<typeof LoginView>[1] = {}) {
  if (board) {
    const b = board;
    board = null;
    await b.saveThumbAndMeta();
    b.destroy();
    if (location.hash.length > 1) history.back();
  }
  app.replaceChildren(new LoginView(showHome, opts).root);
}

// la sesión caducó o se cerró desde otro dispositivo (cambio de contraseña…)
let authPrompt = false;
window.addEventListener('canvaspp:auth', async () => {
  if (authPrompt || !hasServer()) return;
  authPrompt = true;
  try {
    const info = await health();
    if (info.users) {
      setAccount('', null);
      await showLogin({ info, message: 'Tu sesión ha caducado o se cerró. Vuelve a entrar.' });
    }
  } catch {
  } finally {
    authPrompt = false;
  }
});

async function start() {
  await autodetectServer();
  if (hasServer()) {
    try {
      const info = await health();
      // el servidor usa cuentas y aún no has entrado → pantalla de inicio de sesión
      if (info.users && !settings.user) return showLogin({ info });
      if (!info.users && settings.user) setAccount('', null); // el servidor ya no tiene esa cuenta
    } catch {
      // sin conexión: se sigue con la cuenta y los proyectos guardados en el dispositivo
    }
  }
  showHome();
}

async function openProject(meta: ProjectMeta) {
  const items = await loadItems(meta.id);
  const doc = new BoardDoc(meta.id, items);
  // compartido contigo solo para ver: se abre en modo lectura (el servidor tampoco aceptaría cambios)
  board = new BoardView(doc, meta, showHome, meta.access === 'view' ? { readOnly: true, member: true } : {});
  history.pushState(null, '', '#' + meta.id);
  app.replaceChildren(board.root);
  (window as any).__board = board; // útil para depurar
}

// guarda miniatura/estado al cerrar o mandar la app a segundo plano
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') board?.saveThumbAndMeta();
});

// botón "atrás" de Android: volver a proyectos
window.addEventListener('popstate', () => board?.exit());

/** Enlace compartido de solo lectura: #view=<proyecto>&s=<clave> */
async function openShared(id: string, s: string) {
  settings.serverUrl = location.origin; // la web se sirve desde el propio NAS
  shareAuth.project = id;
  shareAuth.s = s;
  app.replaceChildren(h('div', { class: 'home' }, h('p', { class: 'panel-hint' }, 'Abriendo pizarra compartida…')));
  try {
    const r = await fetch(`${location.origin}/api/view/${encodeURIComponent(id)}?s=${encodeURIComponent(s)}`);
    if (!r.ok) throw new Error('El enlace no es válido o se ha desactivado');
    const { meta, items } = await r.json();
    const doc = new BoardDoc(id, items);
    board = new BoardView(doc, { ...meta, synced: true }, () => location.reload(), { readOnly: true, share: s });
    app.replaceChildren(board.root);
    (window as any).__board = board;
    board.fitContent();
  } catch (e: any) {
    app.replaceChildren(h('div', { class: 'home' }, h('div', { class: 'empty' }, h('p', {}, e?.message || String(e)))));
  }
}

const shared = /^#view=([^&]+)&s=(.+)$/.exec(location.hash);
if (shared) {
  openShared(decodeURIComponent(shared[1]), decodeURIComponent(shared[2]));
} else {
  if (location.hash) history.replaceState(null, '', location.pathname);
  start();
  startUpdateChecks();
}
