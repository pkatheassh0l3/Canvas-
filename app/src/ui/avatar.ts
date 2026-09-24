// Foto de perfil (o iniciales de color si no hay foto). Las fotos se piden al NAS con la sesión
// y se guardan en memoria como blob: para no descargarlas cada vez.
import { hasServer, serverBase, settings } from '../settings';
import { h } from '../util';

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}

export function avatarColor(id: string) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 55% 45%)`;
}

const cache = new Map<string, Promise<string | null>>();
function photoUrl(id: string, v: number): Promise<string | null> {
  const k = `${id}:${v}`;
  let p = cache.get(k);
  if (!p) {
    p = fetch(`${serverBase()}/api/avatars/${encodeURIComponent(id)}?v=${v}`, { headers: { Authorization: `Bearer ${settings.token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    cache.set(k, p);
  }
  return p;
}

/** Círculo con la foto de la persona o sus iniciales. */
export function avatarEl(u: { id: string; name: string; avatar?: number }, size = 32): HTMLElement {
  const el = h('span', { class: 'avatar', style: `background:${avatarColor(u.id)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`, title: u.name }, initials(u.name));
  if (u.avatar) {
    photoUrl(u.id, u.avatar).then((url) => {
      if (url) el.replaceChildren(h('img', { src: url, alt: '' }));
    });
  }
  return el;
}

/** Recorta al centro en cuadrado y reduce a 256 px (JPEG ligero para subir). */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(256, side);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo preparar la foto'))), 'image/jpeg', 0.86));
}

// ------------------------------------------------------------------ directorio de personas (nombre y foto actuales)
type Person = { id: string; name: string; avatar?: number };
let people: Promise<Map<string, Person>> | null = null;
let peopleAt = 0;
export function loadPeople(): Promise<Map<string, Person>> {
  if (!people || Date.now() - peopleAt > 60000) {
    peopleAt = Date.now();
    people = !settings.user || !hasServer()
      ? Promise.resolve(new Map())
      : fetch(`${serverBase()}/api/users`, { headers: { Authorization: `Bearer ${settings.token}` } })
          .then((r) => (r.ok ? r.json() : []))
          .then((list: Person[]) => new Map(list.map((p) => [p.id, p])))
          .catch(() => new Map());
  }
  return people;
}

/** Avatar de alguien por su id (se completa con su foto cuando se sabe). */
export function personAvatar(id: string, name: string, size = 28, avatar?: number): HTMLElement {
  const slot = h('span', { class: 'avatar-slot' }, avatarEl({ id, name, avatar }, size));
  if (!avatar)
    loadPeople().then((m) => {
      const p = m.get(id);
      if (p?.avatar) slot.replaceChildren(avatarEl({ id, name: p.name || name, avatar: p.avatar }, size));
    });
  return slot;
}
