import './style.css';
import type { ProjectMeta } from './types';
import { autodetectServer } from './settings';
import { HomeView } from './ui/home';
import { BoardView } from './board/boardView';
import { BoardDoc } from './board/doc';
import { loadItems } from './store';

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

if (location.hash) history.replaceState(null, '', location.pathname);
autodetectServer().finally(showHome);
