// Saneado del HTML de los documentos. El contenido se sincroniza entre dispositivos,
// así que nunca se inserta HTML sin pasar por aquí (evita scripts, eventos, iframes…).
import type { DocPreview } from '../types';
import { addAssetFromDataUrl } from '../assets';

const ALLOWED_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'CODE',
  'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'MARK', 'SPAN', 'FONT', 'DIV', 'BR', 'HR',
  'UL', 'OL', 'LI', 'A', 'IMG',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL',
]);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'HEAD', 'TITLE', 'META', 'LINK']);
const STYLE_PROPS = new Set([
  'color', 'background-color', 'text-align', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'margin-left', 'padding-left', 'list-style-type', 'vertical-align',
]);

function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop)) continue;
    if (/url\s*\(|expression|javascript:|[<>]/i.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

function cleanNode(node: Node, dataImgs: HTMLImageElement[]) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      cleanNode(el, dataImgs);
      el.replaceWith(...el.childNodes); // conserva el texto, quita la etiqueta
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const v = attr.value;
      let keep = false;
      if (name === 'style') {
        const s = cleanStyle(v);
        if (s) el.setAttribute('style', s);
        continue;
      }
      if (tag === 'A' && name === 'href') keep = /^(https?:|mailto:)/i.test(v.trim());
      else if (tag === 'IMG' && name === 'data-asset') keep = /^[A-Za-z0-9_-]{1,64}$/.test(v);
      else if (tag === 'IMG' && name === 'src') keep = false; // se reconstruye desde data-asset
      else if (tag === 'IMG' && (name === 'width' || name === 'alt')) keep = true;
      else if ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan')) keep = /^\d{1,3}$/.test(v);
      else if (tag === 'FONT' && name === 'color') keep = /^#?[\w]{1,20}$/.test(v);
      else if (name === 'class') keep = /^[\w -]{0,60}$/.test(v) && /\b(pdf-page)\b/.test(v);
      if (tag === 'IMG' && name === 'src' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) {
        dataImgs.push(el as HTMLImageElement);
        (el as HTMLImageElement).dataset.pendingSrc = v;
      }
      if (!keep) el.removeAttribute(attr.name);
    }
    if (tag === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    cleanNode(el, dataImgs);
  }
}

/**
 * Sanea HTML externo (Word importado, pegado del portapapeles…).
 * Las imágenes embebidas (data:) se convierten en assets sincronizables.
 */
export async function sanitizeHtml(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const imgs: HTMLImageElement[] = [];
  cleanNode(doc.body, imgs);
  for (const img of imgs) {
    const src = img.dataset.pendingSrc!;
    delete img.dataset.pendingSrc;
    try {
      img.dataset.asset = await addAssetFromDataUrl(src);
    } catch {
      img.remove();
    }
  }
  // imágenes sin asset (enlaces externos, blob:) no se conservan
  for (const img of doc.body.querySelectorAll('img:not([data-asset])')) img.remove();
  return doc.body.innerHTML;
}

/** Saneado síncrono para HTML que ya viene de otro dispositivo (sin data: nuevas). */
export function sanitizeStored(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  cleanNode(doc.body, []);
  for (const img of doc.body.querySelectorAll('img:not([data-asset])')) img.remove();
  return doc.body.innerHTML;
}

/** HTML listo para guardar a partir del editor (sin src blob:). */
export function serializeEditor(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const img of clone.querySelectorAll('img')) img.removeAttribute('src');
  return sanitizeStored(clone.innerHTML);
}

/** Resumen para dibujar el documento en la pizarra. */
export function buildPreview(root: HTMLElement): DocPreview {
  const blocks: DocPreview['blocks'] = [];
  let chars = 0;
  let img: string | undefined;
  const first = root.querySelector('img[data-asset]') as HTMLImageElement | null;
  if (first) {
    // solo si la imagen está al principio (p. ej. PDF importado)
    const textBefore = (() => {
      const r = document.createRange();
      r.setStart(root, 0);
      r.setEndBefore(first);
      return r.toString().trim();
    })();
    if (!textBefore) img = first.dataset.asset;
  }
  for (const el of root.children) {
    const raw = /^(UL|OL)$/.test(el.tagName)
      ? [...el.children].map((li) => '• ' + (li.textContent ?? '').trim()).join('  ')
      : (el.textContent ?? ''); // textContent: funciona también fuera de pantalla
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    blocks.push({ t: t.slice(0, 400), s: /^H[1-6]$/.test(el.tagName) ? 'h' : 'p' });
    chars += t.length;
    if (chars > 900 || blocks.length >= 14) break;
  }
  return { blocks, img };
}

export function wordCount(root: HTMLElement) {
  const t = root.innerText.trim();
  return t ? t.split(/\s+/).length : 0;
}
