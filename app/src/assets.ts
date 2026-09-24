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

export async function addAsset(blob: Blob): Promise<string> {
  const id = 'a' + uid(20);
  await set(id, blob, store);
  const pending = ((await get<string[]>(PENDING, store)) ?? []).concat(id);
  await set(PENDING, pending, store);
  uploadPending();
  return id;
}

export async function addAssetFromDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return addAsset(blob);
}

let uploading = false;
/** Sube al NAS las imágenes creadas sin conexión (se reintenta en cada llamada). */
export async function uploadPending() {
  if (uploading || !hasServer()) return;
  uploading = true;
  try {
    let pending = (await get<string[]>(PENDING, store)) ?? [];
    for (const id of [...pending]) {
      const blob = await get<Blob>(id, store);
      if (blob) {
        const r = await fetch(`${serverBase()}/api/assets/${id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': blob.type || 'image/png' },
          body: blob,
        }).catch(() => null);
        if (!r || !r.ok) break; // sin conexión: se reintentará
      }
      pending = pending.filter((p) => p !== id);
      await set(PENDING, pending, store);
    }
  } finally {
    uploading = false;
  }
}

async function fetchBlob(id: string): Promise<Blob | null> {
  const local = await get<Blob>(id, store);
  if (local) return local;
  if (!hasServer()) return null;
  try {
    const r = await fetch(`${serverBase()}/api/assets/${id}`, { headers: { Authorization: `Bearer ${settings.token}` } });
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
