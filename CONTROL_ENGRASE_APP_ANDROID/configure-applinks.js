// configure-applinks.js
//
// Agrega automáticamente la configuración de "Android App Links" al proyecto,
// para que al escanear el QR (o tocar cualquier link a tu web), Android abra
// la app instalada en vez del navegador.
//
// Corre esto UNA vez, después de "npx cap add android" y ANTES de abrir
// Android Studio a compilar (si ya lo compilaste antes, corre esto y vuelve
// a hacer "npx cap sync android" antes de generar el nuevo APK).
//
//   node configure-applinks.js
//
// No hace falta correrlo de nuevo en cada actualización — solo si alguna vez
// borras y regeneras la carpeta "android" desde cero.

const fs = require('fs');
const path = require('path');

// ⚠️ Si tu web algún día se muda a otro dominio (ya no junivalles-cmd.github.io),
// cambia este valor y vuelve a correr el script.
const WEB_HOST = 'junivalles-cmd.github.io';

const manifestPath = path.join(__dirname, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.error('❌ No se encontró android/app/src/main/AndroidManifest.xml');
  console.error('   Corre primero: npx cap add android');
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, 'utf8');

if (xml.includes(WEB_HOST)) {
  console.log('✅ Ya estaba configurado (encontré "' + WEB_HOST + '" en el manifiesto). No hice cambios.');
  process.exit(0);
}

const appLinkFilter = `        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" android:host="${WEB_HOST}" />
        </intent-filter>
`;

// Se inserta justo antes del cierre de la primera etiqueta </activity> que
// contenga el intent-filter principal (MAIN/LAUNCHER) — así queda dentro de
// la misma actividad que abre la app.
const activityCloseTag = '</activity>';
const idx = xml.indexOf(activityCloseTag);

if (idx === -1) {
  console.error('❌ No se encontró la etiqueta </activity> esperada — el manifiesto no tiene la forma esperada.');
  console.error('   Avísale a Claude con una copia de tu AndroidManifest.xml para ajustarlo a mano.');
  process.exit(1);
}

xml = xml.slice(0, idx) + appLinkFilter + xml.slice(idx);
fs.writeFileSync(manifestPath, xml, 'utf8');

console.log('✅ Listo — se agregó la configuración de App Links para "' + WEB_HOST + '"');
console.log('');
console.log('   Ahora corre: npx cap sync android');
console.log('   Y luego recompila el APK como siempre.');
console.log('');
console.log('   ⚠  IMPORTANTE: para que el QR abra la app y no el navegador, tu sitio web');
console.log('      debe servir este archivo:');
console.log('      https://' + WEB_HOST + '/.well-known/assetlinks.json');
console.log('');
console.log('      Ábrelo en el navegador. Si NO se ve el contenido (da error 404), revisa que');
console.log('      hayas subido a GitHub el archivo .nojekyll junto a index.html. Sin ese archivo,');
console.log('      GitHub Pages ignora la carpeta .well-known y Android no puede verificar el link.');
