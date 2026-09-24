// Imágenes de los documentos (páginas de PDF, imágenes de Word…).
// Se guardan como blobs en IndexedDB y se suben al NAS aparte, para no reenviar
// megas de datos cada vez que se edita el texto de un documento.
import { createStore, get, set, del, keys } from 'idb-keyval';
import { hasServer, serverBase, settings } from './settings';
import { uid } from './util';

const store = createStore('canvaspp-assets', 'blobs');
const PENDING = '__pending_uploads';
const urls = new Map<string, string>();
const images = new Map<string, HTMLImageElement>();
const inflight = new Map<string, Promise<Blob | null>>();

// Las escrituras en la lista de pendientes se hacen en serie (evita perder ids si se añaden dos a la vez).
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

export async function addAsset(blob: Blob): Promise<string> {
  const id = 'a' + uid(20);
  await set(id, blob, store);
  await serial(async () => {
    const pending = (await get<string[]>(PENDING, store)) ?? [];
    await set(PENDING, [...pending, id], store);
  });
  uploadPending();
  return id;
}

export async function addAssetFromDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return addAsset(blob);
}

let uploading = false;
let again = false;
/** Sube al NAS las imágenes/PDF creados sin conexión (se reintenta en cada llamada y al reconectar). */
export async function uploadPending(): Promise<void> {
  if (!hasServer() || shareAuth.s) return;
  if (uploading) {
    again = true; // se añadió algo mientras se subía: otra vuelta al terminar
    return;
  }
  uploading = true;
  try {
    do {
      again = false;
      const pending = (await get<string[]>(PENDING, store)) ?? [];
      for (const id of pending) {
        const blob = await get<Blob>(id, store);
        if (blob) {
          const r = await fetch(`${serverBase()}/api/assets/${id}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': blob.type || 'application/octet-stream' },
            body: blob,
          }).catch(() => null);
          if (!r || (!r.ok && r.status !== 415 && r.status !== 413)) return; // sin conexión: se reintentará
        }
        await serial(async () => {
          const cur = (await get<string[]>(PENDING, store)) ?? [];
          await set(PENDING, cur.filter((p) => p !== id), store);
        });
      }
    } while (again);
  } finally {
    uploading = false;
  }
}

async function fetchBlob(id: string): Promise<Blob | null> {
  const local = await get<Blob>(id, store);
  if (local) return local;
  if (!hasServer()) return null;
  try {
    const q = shareAuth.s ? `?s=${encodeURIComponent(shareAuth.s)}&p=${encodeURIComponent(shareAuth.project ?? '')}` : '';
    const r = await fetch(`${serverBase()}/api/assets/${id}${q}`, { headers: shareAuth.s ? {} : { Authorization: `Bearer ${settings.token}` } });
    if (!r.ok) return null;
    const blob = await r.blob();
    await set(id, blob, store);
    return blob;
  } catch {
    return null;
  }
}

export function getAssetBlob(id: string): Promise<Blob | null> {
  let p = inflight.get(id);
  if (!p) {
    p = fetchBlob(id).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

/** URL local (blob:) para un asset, o null si no se puede obtener. */
export async function assetUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return cached;
  const blob = await getAssetBlob(id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/** Imagen lista para dibujar en el canvas; si aún no está cargada devuelve null y llama a onReady al cargar. */
export function assetImage(id: string, onReady: () => void): HTMLImageElement | null {
  const img = images.get(id);
  if (img) return img.complete && img.naturalWidth ? img : null;
  const el = new Image();
  images.set(id, el);
  assetUrl(id).then((u) => {
    if (!u) return images.delete(id);
    el.onload = onReady;
    el.src = u;
  });
  return null;
}

/** Rellena los <img data-asset> de un contenedor con sus URLs locales. */
export async function hydrateImages(root: HTMLElement) {
  const imgs = [...root.querySelectorAll<HTMLImageElement>('img[data-asset]')];
  await Promise.all(
    imgs.map(async (img) => {
      const u = await assetUrl(img.dataset.asset!);
      if (u) img.src = u;
      else img.alt = 'Imagen no disponible sin conexión';
    }),
  );
}

export async function assetCount() {
  return (await keys(store)).length;
}

export async function removeAsset(id: string) {
  await del(id, store);
}

/** Tamaño natural de una imagen. */
export function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const u = URL.createObjectURL(blob);
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(u);
    };
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = u;
  });
}

/** Reduce fotos enormes (p. ej. de la cámara) para no llenar el NAS; GIF y PNG pequeños se dejan tal cual. */
export async function downscaleImage(file: Blob, max: number): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  const { w, h } = await imageSize(file);
  if (!w || (Math.max(w, h) <= max && file.size < 3_000_000)) return file;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const img = new Image();
  const u = URL.createObjectURL(file);
  await new Promise((r) => ((img.onload = r), (img.src = u)));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(u);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((r) => c.toBlob((b) => r(b ?? file), type, 0.88));
}

/** Datos del enlace de solo lectura (visitantes sin token). */
export const shareAuth: { project?: string; s?: string } = {};

/** URL para reproducir un audio/vídeo desde el NAS sin descargarlo entero (admite saltos). */
export async function assetStreamUrl(id: string): Promise<string | null> {
  const local = await get<Blob>(id, store);
  if (local) return assetUrl(id);
  if (!hasServer()) return null;
  const q = shareAuth.s ? `s=${encodeURIComponent(shareAuth.s)}&p=${encodeURIComponent(shareAuth.project ?? '')}` : `token=${encodeURIComponent(settings.token)}`;
  return `${serverBase()}/api/assets/${id}?${q}`;
}

/** Espera a que una imagen esté cargada (para exportar sin huecos). */
export async function ensureImage(id: string): Promise<void> {
  const u = await assetUrl(id);
  if (!u) return;
  let img = images.get(id);
  if (!img) {
    img = new Image();
    images.set(id, img);
  }
  if (!img.src) img.src = u;
  if (img.complete && img.naturalWidth) return;
  await img.decode().catch(() => {});
}
