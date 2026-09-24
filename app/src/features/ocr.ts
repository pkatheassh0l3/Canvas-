// Escritura a mano → texto. Usa el reconocedor nativo del sistema si existe (Chrome/ChromeOS);
// si no, Tesseract (sin conexión, incluido en la app) sobre una imagen de los trazos.
import type { StrokeItem } from '../types';
import { drawStroke, strokeBounds } from '../board/render';

let worker: Promise<any> | null = null;

function simdSupported() {
  try {
    // módulo wasm mínimo con una instrucción SIMD
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

function getWorker(onProgress?: (m: string) => void) {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const base = new URL('./ocr/', location.href).href;
    return createWorker(['spa', 'eng'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + (simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
      langPath: base.replace(/\/$/, ''),
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m: any) => m.status && onProgress?.(`${m.status} ${Math.round((m.progress || 0) * 100)}%`),
    });
  })();
  worker.catch(() => (worker = null));
  return worker;
}

async function nativeRecognize(strokes: StrokeItem[]): Promise<string | null> {
  const nav = navigator as any;
  if (!nav.createHandwritingRecognizer) return null;
  try {
    const rec = await nav.createHandwritingRecognizer({ languages: ['es'] });
    const drawing = rec.startDrawing({ recognitionType: 'text', inputType: 'stylus' });
    let t = 0;
    for (const s of strokes) {
      const hs = new (window as any).HandwritingStroke();
      for (let i = 0; i < s.pts.length; i += 3) hs.addPoint({ x: s.pts[i], y: s.pts[i + 1], t: (t += 10) });
      drawing.addStroke(hs);
    }
    const res = await drawing.getPrediction();
    rec.finish?.();
    return res?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

/** Imagen en blanco y negro de los trazos, escalada para que la letra mida ~60 px. */
function rasterize(strokes: StrokeItem[]): HTMLCanvasElement {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const s of strokes) {
    const b = strokeBounds(s);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  // altura de línea estimada: mediana de las alturas de los trazos
  const hs = strokes.map((s) => strokeBounds(s).h).sort((a, b) => a - b);
  const lineH = Math.max(hs[Math.floor(hs.length / 2)] || 40, 10);
  const k = Math.min(60 / lineH, 3000 / Math.max(1, x2 - x1));
  const pad = 30;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x2 - x1) * k + pad * 2);
  c.height = Math.ceil((y2 - y1) * k + pad * 2);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(pad, pad);
  ctx.scale(k, k);
  ctx.translate(-x1, -y1);
  for (const s of strokes) drawStroke(ctx, { ...s, color: '#000', tool: 'pen', size: Math.max(s.size, 3 / k) });
  return c;
}

export async function recognizeHandwriting(strokes: StrokeItem[], onProgress?: (m: string) => void): Promise<string> {
  const native = await nativeRecognize(strokes);
  if (native) return native.trim();
  onProgress?.('Cargando reconocedor…');
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(rasterize(strokes));
  return String(data.text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
