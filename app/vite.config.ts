import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

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

export default defineConfig({
  base: './', // rutas relativas: necesario para Electron (file://) y Capacitor
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __UPDATE_REPO__: JSON.stringify(pkg.canvaspp?.updateRepo ?? ''),
  },
  plugins: [versionFile()],
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
