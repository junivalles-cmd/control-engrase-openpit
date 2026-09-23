// tools/verify-dist.mjs
//
// Verifica que dist/ (generado por `npm run build`) está completo y listo
// para publicarse en GitHub Pages, ANTES de subir nada — ver
// docs/WEB_DEPLOYMENT.md. No modifica nada, solo lee y reporta.
//
// Reutiliza computeRuntimeFileSet() (la misma allowlist que ya usa
// tools/sync-web-to-android.mjs y vite.config.js) en vez de mantener una
// lista de archivos aparte.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SRC_DIR, computeRuntimeFileSet } from './runtime-file-set.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let failed = false;
function ok(msg) { console.log(`  OK    ${msg}`); }
function fail(msg) { console.error(`  FALLÓ ${msg}`); failed = true; }

console.log('=== verify-dist.mjs ===');
console.log(`dist: ${DIST}\n`);

if (!fs.existsSync(DIST)) {
  console.error('FALLÓ: dist/ no existe — ejecuta "npm run build" primero.');
  process.exit(1);
}

// 1. index.html
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  ok('index.html existe');
} else {
  fail('index.html falta en dist/');
}

// 2. Todo el set runtime calculado sobre la fuente existe en dist con el mismo nombre
const runtimeSet = computeRuntimeFileSet(SRC_DIR);
const missingRuntime = [...runtimeSet].filter((rel) => rel !== 'index.html' && !fs.existsSync(path.join(DIST, rel)));
if (missingRuntime.length) {
  fail(`archivos runtime faltantes en dist/: ${missingRuntime.join(', ')}`);
} else {
  ok(`los ${runtimeSet.size - 1} archivos runtime (aparte de index.html) existen en dist/`);
}

// 3. .nojekyll — crítico: sin él, GitHub Pages usa Jekyll y oculta .well-known/
const nojekyllPath = path.join(DIST, '.nojekyll');
if (!fs.existsSync(nojekyllPath)) {
  fail('.nojekyll falta en dist/ — GitHub Pages ocultaría .well-known/ (rompe Android App Links)');
} else if (fs.statSync(nojekyllPath).size !== 0) {
  fail('.nojekyll no está vacío (se esperaban 0 bytes)');
} else {
  ok('.nojekyll existe y está vacío');
}

// 4. .well-known/assetlinks.json — JSON válido con la forma esperada
const assetlinksPath = path.join(DIST, '.well-known', 'assetlinks.json');
if (!fs.existsSync(assetlinksPath)) {
  fail('.well-known/assetlinks.json falta en dist/ (rompe Android App Links)');
} else {
  try {
    const json = JSON.parse(fs.readFileSync(assetlinksPath, 'utf8'));
    if (Array.isArray(json) && json[0]?.target?.package_name) {
      ok(`.well-known/assetlinks.json válido (package_name: ${json[0].target.package_name})`);
    } else {
      fail('.well-known/assetlinks.json no tiene la forma esperada (falta target.package_name)');
    }
  } catch (e) {
    fail(`.well-known/assetlinks.json no es JSON válido: ${e.message}`);
  }
}

// 5. manifest.json — JSON válido, íconos referenciados existen
const manifestPath = path.join(DIST, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  fail('manifest.json falta en dist/');
} else {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const icons = manifest.icons || [];
    const missingIcons = icons.filter((i) => !fs.existsSync(path.join(DIST, i.src)));
    if (missingIcons.length) {
      fail(`manifest.json referencia íconos que faltan en dist/: ${missingIcons.map((i) => i.src).join(', ')}`);
    } else {
      ok(`manifest.json válido, ${icons.length} íconos presentes`);
    }
  } catch (e) {
    fail(`manifest.json no es JSON válido: ${e.message}`);
  }
}

// 6. sw.js — cada ruta de ASSETS (precache) existe en dist/
const swPath = path.join(DIST, 'sw.js');
if (!fs.existsSync(swPath)) {
  fail('sw.js falta en dist/');
} else {
  const swText = fs.readFileSync(swPath, 'utf8');
  const assetsMatch = swText.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!assetsMatch) {
    fail('no se pudo leer el bloque ASSETS de sw.js (¿cambió su formato?)');
  } else {
    const entries = [...assetsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== './');
    const missingAssets = entries.filter((p) => !fs.existsSync(path.join(DIST, p.replace(/^\.\//, ''))));
    if (missingAssets.length) {
      fail(`sw.js precachea rutas que no existen en dist/: ${missingAssets.join(', ')}`);
    } else {
      ok(`sw.js: las ${entries.length} rutas de ASSETS existen en dist/`);
    }
  }
}

// 7. OneSignalSDKWorker.js
if (fs.existsSync(path.join(DIST, 'OneSignalSDKWorker.js'))) {
  ok('OneSignalSDKWorker.js existe');
} else {
  fail('OneSignalSDKWorker.js falta en dist/ (rompe el push web)');
}

// 8. src/core/*.js
const coreDir = path.join(DIST, 'src', 'core');
if (fs.existsSync(coreDir)) {
  const modules = fs.readdirSync(coreDir).filter((f) => f.endsWith('.js'));
  ok(`src/core/: ${modules.length} módulos presentes (${modules.join(', ')})`);
} else {
  fail('src/core/ falta en dist/');
}

// 9. index.html no debe cargar el SDK Web de OneSignal de forma incondicional
const indexPath = path.join(DIST, 'index.html');
if (fs.existsSync(indexPath)) {
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const loadsOneSignalUnconditionally = /<script[^>]+src="[^"]*onesignal\.com[^"]*"/i.test(indexHtml);
  if (loadsOneSignalUnconditionally) {
    fail('index.html carga el SDK Web de OneSignal de forma incondicional (ver NOTIF-ANDROID-001 en docs/BUG_REGISTER.md)');
  } else {
    ok('index.html no carga el SDK Web de OneSignal de forma incondicional');
  }
}

console.log('');
if (failed) {
  console.error('verify:dist FALLÓ — revisa los puntos marcados arriba antes de publicar.');
  process.exitCode = 1;
} else {
  console.log('verify:dist: TODO OK — dist/ está listo para publicarse.');
}
