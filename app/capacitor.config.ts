import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.estherpka.canvaspp',
  appName: 'Canvas++',
  webDir: 'dist',
  server: {
    // El NAS normalmente va por http:// en la red local: servimos la app por http
    // para que el WebView permita conectar a ws:// sin bloquear "mixed content".
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
