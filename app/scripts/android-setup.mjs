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
  console.log('✓ usesCleartextTraffic activado (conexión http:// al NAS en la red local)');
}
// micrófono para las notas de voz
for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
  if (!xml.includes(perm)) xml = xml.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`);
}
fs.writeFileSync(manifest, xml);

// versionName / versionCode desde package.json (necesario para que el APK nuevo se instale encima del anterior)
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [maj, min, pat] = version.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
const code = maj * 10000 + min * 100 + pat;
const gradle = 'android/app/build.gradle';
let g = fs.readFileSync(gradle, 'utf8');
g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradle, g);
console.log(`✓ Android versionName ${version} (versionCode ${code})`);
