// Importación de Word (.docx) y PDF. Las librerías se cargan solo cuando hacen falta.
import { addAsset } from '../assets';
import { sanitizeHtml } from './sanitize';

export interface Imported {
  title: string;
  html: string;
}

export const IMPORT_ACCEPT =
  '.docx,.pdf,.txt,.md,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'Documento';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

async function importDocx(file: File): Promise<Imported> {
  const mod: any = await import('mammoth/mammoth.browser.js');
  const mammoth = mod.default ?? mod;
  const res = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote:fresh"],
    },
  );
  return { title: baseName(file.name), html: await sanitizeHtml(res.value) };
}

async function importPdf(file: File, onProgress?: (msg: string) => void): Promise<Imported> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl: string = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const total = Math.min(pdf.numPages, 150);
  const parts: string[] = [];
  for (let i = 1; i <= total; i++) {
    onProgress?.(`Importando página ${i} de ${total}…`);
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 1300 / vp1.width); // ~150 ppp en A4
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.82));
    const id = await addAsset(blob);
    parts.push(`<p class="pdf-page"><img class="pdf-page" data-asset="${id}" alt="Página ${i}"></p>`);
    page.cleanup();
  }
  if (pdf.numPages > total) parts.push(`<p><em>(Se han importado las primeras ${total} páginas de ${pdf.numPages}.)</em></p>`);
  await task.destroy();
  // la primera línea editable permite escribir notas debajo del PDF
  parts.push('<p><br></p>');
  return { title: baseName(file.name), html: parts.join('') };
}

async function importText(file: File): Promise<Imported> {
  const text = await file.text();
  if (/\.html?$/i.test(file.name)) return { title: baseName(file.name), html: await sanitizeHtml(text) };
  const html = text
    .split(/\n{2,}/)
    .map((p) => {
      const m = p.match(/^(#{1,3})\s+(.*)$/);
      if (m) return `<h${m[1].length}>${escapeHtml(m[2])}</h${m[1].length}>`;
      return `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  return { title: baseName(file.name), html };
}

export async function importFile(file: File, onProgress?: (msg: string) => void): Promise<Imported> {
  const n = file.name.toLowerCase();
  if (n.endsWith('.docx')) return importDocx(file);
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return importPdf(file, onProgress);
  if (/\.(txt|md|html?)$/.test(n) || file.type.startsWith('text/')) return importText(file);
  if (n.endsWith('.doc')) throw new Error('El formato .doc antiguo no es compatible: guárdalo como .docx en Word');
  throw new Error('Formato no compatible (usa .docx, .pdf o .txt)');
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
