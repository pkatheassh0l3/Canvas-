// Carga perezosa de pdf.js (build "legacy": funciona en WebViews de Android más antiguos).
let mod: Promise<any> | null = null;

export function loadPdfjs(): Promise<any> {
  mod ??= (async () => {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerUrl: string = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  })();
  return mod;
}
