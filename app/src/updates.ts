// Aviso de actualizaciones.
// - Android / Windows: consulta la última Release del repositorio de GitHub.
// - Web servida desde el NAS: compara con /version.json del servidor (tras actualizar el contenedor).
import { h } from './util';

export const APP_VERSION = __APP_VERSION__;
const REPO = __UPDATE_REPO__;
const CHECK_EVERY = 6 * 60 * 60 * 1000;
const DISMISS_KEY = 'canvaspp.update.dismissed';

export type Platform = 'android' | 'windows' | 'web';

export function platform(): Platform {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android') return 'android';
  if (/Electron/i.test(navigator.userAgent)) return 'windows';
  return 'web';
}

export interface UpdateInfo {
  version: string;
  url: string; // página o archivo a abrir
  label: string; // texto del botón
  notes?: string;
  reload?: boolean; // web: basta con recargar
}

/** Compara versiones semver simples ("1.2.10" > "1.2.9"). */
export function isNewerVersion(a: string, b: string) {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, headers });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function checkGithub(p: Platform): Promise<UpdateInfo | null> {
  if (!REPO) return null;
  const rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`, {
    Accept: 'application/vnd.github+json',
  });
  if (!rel?.tag_name || !isNewerVersion(rel.tag_name, APP_VERSION)) return null;
  const assets: { name: string; browser_download_url: string }[] = rel.assets || [];
  const pick =
    p === 'android'
      ? assets.find((a) => a.name.endsWith('.apk'))
      : assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => a.name.endsWith('.exe'));
  return {
    version: rel.tag_name.replace(/^v/, ''),
    url: pick?.browser_download_url || rel.html_url,
    label: pick ? 'Descargar' : 'Ver versión',
    notes: typeof rel.body === 'string' ? rel.body.trim().slice(0, 400) : undefined,
  };
}

async function checkWeb(): Promise<UpdateInfo | null> {
  if (!/^https?:$/.test(location.protocol)) return null;
  const v = await fetchJson(new URL('version.json', location.href).toString());
  if (!v?.build || v.build === __BUILD_ID__) return null;
  return { version: v.version, url: location.href, label: 'Recargar', reload: true };
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const p = platform();
  return p === 'web' ? checkWeb() : checkGithub(p);
}

function openExternal(url: string) {
  if (platform() === 'android') location.href = url; // Capacitor lo abre en el navegador del sistema
  else window.open(url, '_blank');
}

function showBanner(u: UpdateInfo) {
  document.getElementById('update-banner')?.remove();
  const close = () => banner.remove();
  const banner = h(
    'div',
    { id: 'update-banner', class: 'update-banner', role: 'status' },
    h(
      'div',
      { class: 'ub-text' },
      h('strong', {}, u.reload ? 'Canvas++ se ha actualizado' : `Nueva versión ${u.version}`),
      h('span', {}, u.reload ? 'Recarga para usar la última versión.' : `Tienes la ${APP_VERSION}.`),
    ),
    h(
      'button',
      {
        class: 'btn primary',
        onclick: () => {
          if (u.reload) location.reload();
          else openExternal(u.url);
          close();
        },
      },
      u.label,
    ),
    h(
      'button',
      {
        class: 'btn ghost',
        onclick: () => {
          try {
            localStorage.setItem(DISMISS_KEY, u.version + (u.reload ? '-web' : ''));
          } catch {}
          close();
        },
      },
      'Más tarde',
    ),
  );
  document.body.append(banner);
}

let lastCheck = 0;
async function run(force = false) {
  if (!force && Date.now() - lastCheck < CHECK_EVERY) return;
  lastCheck = Date.now();
  const u = await checkForUpdate();
  if (!u) return;
  let dismissed = '';
  try {
    dismissed = localStorage.getItem(DISMISS_KEY) || '';
  } catch {}
  if (dismissed === u.version + (u.reload ? '-web' : '')) return;
  showBanner(u);
}

/** Comprueba al arrancar, cada 6 h y al volver a la app. */
export function startUpdateChecks() {
  setTimeout(() => run(true), 3000);
  setInterval(() => run(), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
}

/** Para el botón "Buscar actualizaciones" de Ajustes. */
export async function manualCheck(): Promise<string> {
  const u = await checkForUpdate();
  if (!u) return `Tienes la última versión (${APP_VERSION}).`;
  showBanner(u);
  return u.reload ? 'Hay una versión nueva de la web.' : `Disponible la versión ${u.version}.`;
}
