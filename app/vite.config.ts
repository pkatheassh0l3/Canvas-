import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // rutas relativas: necesario para Electron (file://) y Capacitor
  build: { target: 'es2020', outDir: 'dist' },
  server: {
    proxy: {
      // en desarrollo, `npm run dev` + servidor local en :8787
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
