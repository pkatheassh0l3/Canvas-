// Importa un PDF como elemento de solo lectura: se guarda el archivo original y una miniatura.
import { addAsset } from '../assets';
import { loadPdfjs } from './pdfjs';

export interface ImportedPdf {
  title: string;
  file: string;
  thumb: string;
  pages: number;
  sizes: [number, number][];
  text: string[];
}

export async function importPdfFile(file: File, onProgress?: (m: string) => void): Promise<ImportedPdf> {
  const pdfjs = await loadPdfjs();
  onProgress?.('Leyendo PDF…');
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data: data.slice() });
  const pdf = await task.promise;
  const sizes: [number, number][] = [];
  const text: string[] = [];
  let total = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const vp = pg.getViewport({ scale: 1 });
    sizes.push([Math.round(vp.width * 100) / 100, Math.round(vp.height * 100) / 100]);
    // texto de la página para poder buscar en él (con un límite para no inflar la pizarra)
    let t = '';
    if (total < 400_000) {
      try {
        const tc = await pg.getTextContent();
        t = tc.items.map((it: any) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').slice(0, 30_000);
      } catch {}
    }
    total += t.length;
    text.push(t);
    if (i % 10 === 0) onProgress?.(`Leyendo página ${i} de ${pdf.numPages}…`);
  }
  onProgress?.('Creando miniatura…');
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 700 / vp1.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const thumbBlob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.85));
  await task.destroy();
  onProgress?.('Guardando…');
  const [fileId, thumb] = await Promise.all([
    addAsset(new Blob([data], { type: 'application/pdf' })),
    addAsset(thumbBlob),
  ]);
  return { title: file.name.replace(/\.pdf$/i, ''), file: fileId, thumb, pages: sizes.length, sizes, text };
}
