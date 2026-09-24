// Aviso de actualizaciones.
// - Android / Windows: consulta la última Release del repositorio de GitHub.
// - Web servida desde el NAS: compara con /version.json del servidor (tras actualizar el contenedor).
import { h } from './util';

export const APP_VERSION = __APP_VERSION__;
const REPO = __UPDATE_REPO__;
const CHECK_EVERY = 6 * 60 * 60 * 1000;
const DISMISS_KEY = 'canvaspp.update.dismissed';

export type Platform = 'android' | 'windows' | 'linux' | 'web';

export function platform(): Platform {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android') return 'android';
  if (/Electron/i.test(navigator.userAgent)) return /Linux/i.test(navigator.userAgent) ? 'linux' : 'windows';
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
  const inApp = (p === 'windows' || p === 'linux') && !!(await desktop()?.supported().catch(() => false));
  const pick =
    p === 'android'
      ? assets.find((a) => a.name.endsWith('.apk'))
      : p === 'linux'
        ? // AppImage (se actualiza sola) o, si se instaló con .deb, el paquete nuevo
          (inApp ? assets.find((a) => /\.AppImage$/i.test(a.name)) : assets.find((a) => /\.deb$/i.test(a.name))) || assets.find((a) => /\.AppImage$/i.test(a.name))
        : assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => a.name.endsWith('.exe'));
  // la versión portable de Windows descarga el portable nuevo
  const portable = p === 'windows' && !inApp && assets.find((a) => /portable.*\.exe$/i.test(a.name));
  return {
    version: rel.tag_name.replace(/^v/, ''),
    url: (portable || pick)?.browser_download_url || rel.html_url,
    label: pick ? 'Actualizar' : 'Ver versión',
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

// ------------------------------------------------------------------ instalar desde la app
type Progress = (pct: number | null, text: string) => void;

interface DesktopUpdater {
  supported(): Promise<boolean>;
  download(): Promise<string | null>;
  install(): Promise<void>;
  onProgress(fn: (p: { percent: number; transferred: number; total: number }) => void): () => void;
}
const desktop = (): DesktopUpdater | undefined => (window as any).canvasUpdater;

/** ¿Esta versión puede descargarse e instalarse sin salir de la app? */
async function canInstallInApp(): Promise<boolean> {
  const p = platform();
  if (p === 'android') return true;
  if (p === 'windows' || p === 'linux') return !!(await desktop()?.supported().catch(() => false));
  return false;
}

const mb = (n: number) => (n / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** Windows y Linux (AppImage): descarga con electron-updater (solo lo que cambia) y reinicia. */
async function installDesktop(progress: Progress) {
  const up = desktop()!;
  const off = up.onProgress((p) => progress(p.percent, `Descargando… ${mb(p.transferred)} de ${mb(p.total)} MB`));
  try {
    progress(null, 'Preparando la descarga…');
    const v = await up.download();
    if (!v) throw new Error('No se encontró la actualización en GitHub');
    progress(100, `Versión ${v} lista`);
    return async () => {
      progress(100, 'Reiniciando para instalar…');
      await up.install();
    };
  } finally {
    off();
  }
}

/** Android: descarga el APK y abre el instalador del sistema. */
async function installAndroid(u: UpdateInfo, progress: Progress) {
  const [{ Filesystem, Directory }, { FileOpener }] = await Promise.all([import('@capacitor/filesystem'), import('@capawesome-team/capacitor-file-opener')]);
  const listener = await Filesystem.addListener('progress', (p: { bytes: number; contentLength: number }) => {
    const pct = p.contentLength ? (p.bytes / p.contentLength) * 100 : null;
    progress(pct, p.contentLength ? `Descargando… ${mb(p.bytes)} de ${mb(p.contentLength)} MB` : `Descargando… ${mb(p.bytes)} MB`);
  });
  try {
    progress(null, 'Preparando la descarga…');
    await Filesystem.deleteFile({ path: 'update.apk', directory: Directory.Cache }).catch(() => {});
    const r = await Filesystem.downloadFile({ url: u.url, path: 'update.apk', directory: Directory.Cache, progress: true });
    const path = r.path ?? (await Filesystem.getUri({ path: 'update.apk', directory: Directory.Cache })).uri;
    progress(100, `Versión ${u.version} descargada`);
    return async () => {
      // Android pide confirmar la instalación (y la primera vez, permitir instalar desde Canvas++)
      await FileOpener.openFile({ path, mimeType: 'application/vnd.android.package-archive' });
    };
  } finally {
    listener.remove();
  }
}

/** inApp: se puede descargar e instalar sin salir de la app (se calcula antes, para no perder el clic). */
function showBanner(u: UpdateInfo, inApp: boolean) {
  document.getElementById('update-banner')?.remove();
  const close = () => banner.remove();
  const title = h('strong', {}, u.reload ? 'Canvas++ se ha actualizado' : `Nueva versión ${u.version}`);
  const sub = h('span', {}, u.reload ? 'Recarga para usar la última versión.' : `Tienes la ${APP_VERSION}.`);
  const bar = h('div', { class: 'ub-progress hidden' }, h('div', { class: 'ub-fill' }));
  const fill = bar.firstElementChild as HTMLElement;
  const notes = u.notes ? h('div', { class: 'ub-notes hidden' }, u.notes) : null;
  const main = h('button', { class: 'btn primary' }, u.reload ? 'Recargar' : 'Actualizar') as HTMLButtonElement;
  const later = h(
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
  ) as HTMLButtonElement;
  const progress: Progress = (pct, text) => {
    bar.classList.remove('hidden');
    bar.classList.toggle('indeterminate', pct == null);
    fill.style.width = (pct ?? 30) + '%';
    sub.textContent = text;
  };

  main.onclick = async () => {
    if (u.reload) return location.reload();
    if (!inApp) {
      // versión portable de Windows o navegador: se descarga el archivo nuevo
      openExternal(u.url);
      return close();
    }
    main.disabled = true;
    later.textContent = 'Ocultar';
    title.textContent = `Actualizando a ${u.version}`;
    try {
      const install = platform() === 'android' ? await installAndroid(u, progress) : await installDesktop(progress);
      title.textContent = `Versión ${u.version} lista`;
      sub.textContent = platform() === 'android' ? 'Pulsa Instalar y confirma en la ventana de Android.' : 'Se cerrará Canvas++, se instalará y volverá a abrirse.';
      main.textContent = platform() === 'android' ? 'Instalar' : 'Reiniciar y actualizar';
      main.disabled = false;
      later.textContent = 'Más tarde';
      main.onclick = async () => {
        main.disabled = true;
        try {
          await install();
          if (platform() === 'android') main.disabled = false; // por si cancela el instalador
        } catch (e: any) {
          main.disabled = false;
          sub.textContent = 'No se pudo abrir el instalador: ' + (e?.message || e);
        }
      };
    } catch (e: any) {
      title.textContent = 'No se pudo actualizar';
      sub.textContent = (e?.message || String(e)) + ' — puedes descargarla a mano.';
      bar.classList.add('hidden');
      main.disabled = false;
      main.textContent = 'Descargar';
      main.onclick = () => (openExternal(u.url), close());
    }
  };

  const banner = h(
    'div',
    { id: 'update-banner', class: 'update-banner', role: 'status' },
    h(
      'div',
      { class: 'ub-text' },
      title,
      sub,
      bar,
      notes
        ? h('button', { class: 'linkish ub-more', onclick: () => notes.classList.toggle('hidden') }, 'Novedades')
        : '',
      notes ?? '',
    ),
    main,
    later,
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
  showBanner(u, await canInstallInApp());
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
  showBanner(u, await canInstallInApp());
  return u.reload ? 'Hay una versión nueva de la web.' : `Disponible la versión ${u.version}.`;
}
