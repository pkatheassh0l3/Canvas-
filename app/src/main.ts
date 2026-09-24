import './style.css';
import type { ProjectMeta } from './types';
import { autodetectServer, settings } from './settings';
import { shareAuth } from './assets';
import { h } from './util';
import { HomeView } from './ui/home';
import { BoardView } from './board/boardView';
import { BoardDoc } from './board/doc';
import { loadItems } from './store';
import { startUpdateChecks } from './updates';

const app = document.getElementById('app')!;
let board: BoardView | null = null;

function showHome() {
  board = null;
  if (location.hash.length > 1) history.back(); // quita la entrada del proyecto del historial
  app.replaceChildren(new HomeView(openProject).root);
}

async function openProject(meta: ProjectMeta) {
  const items = await loadItems(meta.id);
  const doc = new BoardDoc(meta.id, items);
  board = new BoardView(doc, meta, showHome);
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
  autodetectServer().finally(showHome);
  startUpdateChecks();
}
