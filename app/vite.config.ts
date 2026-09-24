import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const BUILD_ID = `${pkg.version}-${Date.now().toString(36)}`;

/** Publica dist/version.json para que el cliente web servido desde el NAS detecte versiones nuevas. */
function versionFile(): Plugin {
  return {
    name: 'canvaspp-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version, build: BUILD_ID }),
      });
    },
  };
}

/** Copia a dist/ocr los archivos del reconocedor de escritura (Tesseract) para que funcione sin conexión. */
function ocrAssets(): Plugin {
  const files: [string, string][] = [
    ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'spa.traineddata.gz'],
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ];
  return {
    name: 'canvaspp-ocr',
    apply: 'build',
    generateBundle() {
      for (const [src, name] of files) {
        const pkg = src.startsWith('@') ? src.split('/').slice(0, 2).join('/') : src.split('/')[0];
        const dir = path.dirname(require.resolve(pkg + '/package.json'));
        const rel = src.slice(pkg.length + 1);
        this.emitFile({ type: 'asset', fileName: 'ocr/' + name, source: readFileSync(path.join(dir, rel)) });
      }
    },
  };
}

export default defineConfig({
  base: './', // rutas relativas: necesario para Electron (file://) y Capacitor
  define: {
    // MathJax lee su versión de package.json con require() si no está definida (no existe en el navegador)
    PACKAGE_VERSION: JSON.stringify("3.2.1"),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __UPDATE_REPO__: JSON.stringify(pkg.canvaspp?.updateRepo ?? ''),
  },
  plugins: [versionFile(), ocrAssets()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // el worker de pdf.js se publica como .js: algunos servidores (WebView de Android) no conocen .mjs
        assetFileNames: (info) =>
          (info.names?.[0] ?? info.name ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      // en desarrollo, `npm run dev` + servidor local en :8787
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
