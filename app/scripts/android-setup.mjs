// Genera/actualiza el proyecto Android de Capacitor y permite http:// hacia el NAS.
// Uso: npm run android:sync   (funciona igual en Windows, macOS y Linux)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
if (!fs.existsSync('android')) run('npx cap add android');
run('npx cap sync android');

const manifest = 'android/app/src/main/AndroidManifest.xml';
let xml = fs.readFileSync(manifest, 'utf8');
if (!xml.includes('usesCleartextTraffic')) {
  xml = xml.replace('<application', '<application android:usesCleartextTraffic="true"');
  fs.writeFileSync(manifest, xml);
  console.log('✓ usesCleartextTraffic activado (conexión http:// al NAS en la red local)');
}
