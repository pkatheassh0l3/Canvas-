// Exportar: pizarra a PDF (entera o un marco por página), documento a PDF y PDF con anotaciones.
// En Android los archivos se comparten (Guardar en Archivos, Drive, enviar…); en el resto se descargan.
import type { BoardView } from '../board/boardView';
import type { DocItem, FrameItem, Item, PdfItem, Rect } from '../types';
import { ensureImage, getAssetBlob, hydrateImages } from '../assets';
import { drawItem, itemBounds, strokePath } from '../board/render';
import { h, toast } from '../util';
import { platform } from '../updates';
import { sanitizeStored } from '../docs/sanitize';
import { PAGE_H, PAGE_W } from '../docs/editor';
import { getStroke } from 'perfect-freehand';
import { strokeOptions, toPoints } from '../board/render';

export async function saveFile(blob: Blob, filename: string) {
  if (platform() === 'android') {
    try {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
      const data: string = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(String(fr.result).split(',')[1]);
        fr.readAsDataURL(blob);
      });
      const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
      await Share.share({ title: filename, url: res.uri, dialogTitle: 'Guardar o compartir' });
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const safeName = (s: string) => (s || 'canvas').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

async function preload(items: Item[]) {
  const ids = new Set<string>();
  for (const it of items) {
    if (it.kind === 'image') ids.add(it.asset);
    if (it.kind === 'pdf') ids.add(it.thumb);
    if (it.kind === 'doc' && it.preview?.img) ids.add(it.preview.img);
    if (it.kind === 'video' && it.thumb) ids.add(it.thumb);
  }
  await Promise.all([...ids].map((id) => ensureImage(id)));
}

function renderRegion(items: Item[], r: Rect, maxPx: number, bg = '#ffffff'): HTMLCanvasElement {
  const k = Math.min(maxPx / r.w, maxPx / r.h, 4);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * k));
  c.height = Math.max(1, Math.round(r.h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(k, k);
  ctx.translate(-r.x, -r.y);
  for (const it of items) drawItem(ctx, it, k);
  return c;
}

/** Pizarra a PDF: una página con todo, o una página por marco (como una presentación). */
export async function exportBoardPdf(b: BoardView, mode: 'all' | 'frames'): Promise<void> {
  const items = b.shown().filter((i) => i.kind !== 'comment');
  if (!items.length) {
    toast('La pizarra está vacía');
    return;
  }
  const t = toast('Generando PDF…', 60000);
  try {
    const { jsPDF } = await import('jspdf');
    await preload(items);
    let regions: { r: Rect; title?: string }[];
    if (mode === 'frames') {
      const frames = items.filter((i): i is FrameItem => i.kind === 'frame');
      if (!frames.length) {
        t.remove();
        toast('No hay marcos: exporto la pizarra entera', 3000);
        return exportBoardPdf(b, 'all');
      }
      const { slides } = await import('./present');
      regions = slides(b).map((f) => ({ r: { x: f.x, y: f.y, w: f.w, h: f.h }, title: f.title }));
    } else {
      let r: Rect | null = null;
      for (const it of items) {
        const bb = itemBounds(it);
        r = r ? { x: Math.min(r.x, bb.x), y: Math.min(r.y, bb.y), w: Math.max(r.x + r.w, bb.x + bb.w) - Math.min(r.x, bb.x), h: Math.max(r.y + r.h, bb.y + bb.h) - Math.min(r.y, bb.y) } : { ...bb };
      }
      const pad = Math.max(r!.w, r!.h) * 0.03;
      regions = [{ r: { x: r!.x - pad, y: r!.y - pad, w: r!.w + pad * 2, h: r!.h + pad * 2 } }];
    }
    let pdf: any = null;
    for (const reg of regions) {
      const c = renderRegion(items, reg.r, 2400);
      const w = 842; // puntos (A4 apaisado de ancho)
      const hh = (w * c.height) / c.width;
      const orient = hh > w ? 'p' : 'l';
      if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [w, hh] });
      else pdf.addPage([w, hh], orient);
      pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, w, hh);
    }
    await saveFile(pdf.output('blob'), safeName(b.meta.name) + '.pdf');
  } catch (e: any) {
    toast('No se pudo exportar: ' + (e?.message || e), 4000);
  } finally {
    t.remove();
  }
}

/** Documento de texto a PDF A4 (se maqueta como en el editor). */
export async function exportDocPdf(d: DocItem) {
  const t = toast('Generando PDF…', 60000);
  const holder = h('div', { class: 'doc-export-holder' });
  const paper = h('div', { class: 'doc-paper doc-export' });
  paper.innerHTML = sanitizeStored(d.html);
  holder.append(paper);
  document.body.append(holder);
  try {
    await hydrateImages(paper);
    await Promise.all([...paper.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
    const canvas = await html2canvas(paper, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const sliceH = Math.round((canvas.width * PAGE_H) / PAGE_W);
    for (let y = 0, i = 0; y < canvas.height; y += sliceH, i++) {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = Math.min(sliceH, canvas.height - y);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(canvas, 0, -y);
      if (i) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, (pw * c.height) / c.width);
      if (c.height < 40) break;
    }
    void ph;
    await saveFile(pdf.output('blob'), safeName(d.title) + '.pdf');
  } catch (e: any) {
    toast('No se pudo exportar: ' + (e?.message || e), 4000);
  } finally {
    holder.remove();
    t.remove();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  const v = parseInt(n, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** PDF original con las anotaciones dibujadas encima (vectoriales, el texto sigue siendo seleccionable). */
export async function exportAnnotatedPdf(p: PdfItem) {
  const t = toast('Generando PDF…', 60000);
  try {
    const blob = await getAssetBlob(p.file);
    if (!blob) throw new Error('el PDF no está disponible sin conexión');
    const { PDFDocument, rgb } = await import('pdf-lib');
    const pdf = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    const pages = pdf.getPages();
    for (const [key, anns] of Object.entries(p.ann ?? {})) {
      const page = pages[Number(key)];
      if (!page || !anns?.length) continue;
      const { width, height } = page.getSize();
      const k = width / 1000;
      for (const a of anns) {
        const [r, g, bl] = hexToRgb(a.t === 'ink' ? a.color : a.color);
        const color = rgb(r, g, bl);
        if (a.t === 'mark') {
          for (const [x, y, w, hh] of a.rects) {
            if (a.style === 'highlight') page.drawRectangle({ x: x * k, y: height - (y + hh) * k, width: w * k, height: hh * k, color, opacity: 0.38 });
            else {
              const th = Math.max(0.8, hh * 0.08 * k);
              const yy = a.style === 'underline' ? y + hh : y + hh * 0.56;
              page.drawRectangle({ x: x * k, y: height - yy * k, width: w * k, height: th, color });
            }
          }
        } else {
          const outline = getStroke(toPoints(a.pts), strokeOptions(a));
          if (outline.length < 3) continue;
          const d = 'M ' + outline.map(([x, y]) => `${(x * k).toFixed(2)} ${(y * k).toFixed(2)}`).join(' L ') + ' Z';
          page.drawSvgPath(d, { x: 0, y: height, color, opacity: a.tool === 'marker' ? 0.38 : 1, borderWidth: 0 });
        }
      }
    }
    const bytes = await pdf.save();
    await saveFile(new Blob([bytes as BlobPart], { type: 'application/pdf' }), safeName(p.title) + ' (anotado).pdf');
  } catch (e: any) {
    toast('No se pudo exportar: ' + (e?.message || e), 4000);
  } finally {
    t.remove();
  }
}

export { strokePath };
