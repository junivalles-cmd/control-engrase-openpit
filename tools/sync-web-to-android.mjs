#!/usr/bin/env node
// tools/sync-web-to-android.mjs
//
// Sincroniza SOLO los archivos runtime del frontend PWA desde la fuente
// canónica web hacia el webDir de Capacitor. Ver docs/SYNC_WEB_ANDROID.md
// para la explicación completa.
//
//   FUENTE:  CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB
//   DESTINO: CONTROL_ENGRASE_APP_ANDROID\www
//
// Modos:
//   node tools/sync-web-to-android.mjs             → dry-run (por defecto, no escribe nada)
//   node tools/sync-web-to-android.mjs --dry-run    → dry-run explícito
//   node tools/sync-web-to-android.mjs --apply      → aplica los cambios (requiere pasar todas las validaciones)
//
// Este script NUNCA toca android\app\src\main\assets\public — esa carpeta
// es responsabilidad exclusiva de "npx cap sync android".
// Este script NUNCA borra archivos en el destino, ni en dry-run ni en --apply
// (los "sobrantes" solo se reportan).

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Rutas (fijas, no configurables desde la línea de comandos a propósito)
// ---------------------------------------------------------------------------

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TOOLS_DIR, '..');

const SRC_DIR = path.join(ROOT_DIR, 'CONTROL_ENGRASE_WEB', 'CONTROL_ENGRASE_WEB');
const ANDROID_PROJECT_DIR = path.join(ROOT_DIR, 'CONTROL_ENGRASE_APP_ANDROID');
const DEST_DIR = path.join(ANDROID_PROJECT_DIR, 'www');
const CAPACITOR_CONFIG_PATH = path.join(ANDROID_PROJECT_DIR, 'capacitor.config.json');

// Archivos de infraestructura que siempre deben viajar si existen en la
// fuente, aunque ningún otro archivo los referencie por texto (no aparecen
// en <script>/<link> ni en el manifest ni en el precache del Service
// Worker — se usan por convención / los lee un verificador externo):
//   - .nojekyll                    → necesario para que GitHub Pages no oculte .well-known
//   - .well-known/assetlinks.json  → verificación de Android App Links (la lee el propio Android sobre HTTPS, no el WebView local; se sincroniza igual por paridad y porque así se definió en el análisis de Fase 1)
//   - OneSignalSDKWorker.js        → convención de OneSignal Web Push, cargado directamente por su SDK, no referenciado en el HTML
const FIXED_CORE_FILES = [
  'index.html',
  'manifest.json',
  'sw.js',
  'OneSignalSDKWorker.js',
  '.nojekyll',
  '.well-known/assetlinks.json',
];

// Defensa adicional (denylist): aunque el cálculo del set runtime es un
// allowlist derivado de lo que el propio index.html/manifest/sw.js declaran
// usar, esta lista de exclusión explícita evita que documentación,
// backend o scripts SQL se cuelen aunque algún día alguien los referencie
// por error desde el HTML.
const NEVER_SYNC_PATTERNS = [
  /\.md$/i,
  /\.pdf$/i,
  /\.sql$/i,
  /\.txt$/i,
  /^supabase\//i,
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function isExcludedByDenylist(relPosixPath) {
  return NEVER_SYNC_PATTERNS.some((re) => re.test(relPosixPath));
}

function sha256File(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walkAllFiles(dir) {
  const result = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        result.push(toPosix(path.relative(dir, abs)));
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return result;
}

function readTextIfExists(absPath) {
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;
}

// Extrae rutas locales (no http/https) de atributos href="" / src="" de un HTML simple.
function extractLocalRefsFromHtml(html) {
  const refs = new Set();
  const attrRegex = /(?:href|src)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = attrRegex.exec(html)) !== null) {
    const value = m[1];
    if (!/^https?:\/\//i.test(value) && !value.startsWith('//')) {
      refs.add(value.replace(/^\.\//, ''));
    }
  }
  return refs;
}

// Extrae "icons[].src" locales de un manifest.json ya parseado.
function extractLocalIconsFromManifest(manifestJson) {
  const refs = new Set();
  for (const icon of manifestJson.icons || []) {
    if (icon && typeof icon.src === 'string' && !/^https?:\/\//i.test(icon.src)) {
      refs.add(icon.src.replace(/^\.\//, ''));
    }
  }
  return refs;
}

// Extrae el array ASSETS de sw.js (lista de precache) mediante una lectura
// tolerante: busca literales de cadena './algo' dentro del bloque ASSETS.
function extractLocalAssetsFromServiceWorker(swText) {
  const refs = new Set();
  const assetsBlockMatch = swText.match(/ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!assetsBlockMatch) return refs;
  const block = assetsBlockMatch[1];
  const stringRegex = /'([^']+)'|"([^"]+)"/g;
  let m;
  while ((m = stringRegex.exec(block)) !== null) {
    const value = m[1] ?? m[2];
    if (!/^https?:\/\//i.test(value)) {
      refs.add(value.replace(/^\.\//, ''));
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Cálculo del set runtime a sincronizar (allowlist derivada de la fuente)
// ---------------------------------------------------------------------------

function computeRuntimeFileSet(srcDir) {
  const candidates = new Set(FIXED_CORE_FILES);

  const html = readTextIfExists(path.join(srcDir, 'index.html'));
  if (html) {
    for (const ref of extractLocalRefsFromHtml(html)) candidates.add(ref);
  }

  const manifestRaw = readTextIfExists(path.join(srcDir, 'manifest.json'));
  if (manifestRaw) {
    try {
      const manifestJson = JSON.parse(manifestRaw);
      for (const ref of extractLocalIconsFromManifest(manifestJson)) candidates.add(ref);
    } catch {
      // Un manifest inválido en la fuente se reporta aparte en las validaciones;
      // aquí simplemente no aportamos íconos adicionales desde él.
    }
  }

  const swText = readTextIfExists(path.join(srcDir, 'sw.js'));
  if (swText) {
    for (const ref of extractLocalAssetsFromServiceWorker(swText)) candidates.add(ref);
  }

  const finalSet = new Set();
  for (const rel of candidates) {
    const posix = toPosix(rel);
    // './' (la raíz/scope del Service Worker) no es un archivo real — se
    // ignora, junto con cualquier otra entrada vacía o que apunte a un
    // directorio (termina en '/').
    if (posix === '' || posix.endsWith('/')) continue;
    if (isExcludedByDenylist(posix)) continue;
    finalSet.add(posix);
  }
  return finalSet;
}

// ---------------------------------------------------------------------------
// Validaciones (obligatorias antes de permitir --apply)
// ---------------------------------------------------------------------------

function runValidations(runtimeSet) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });

  const srcExists = fs.existsSync(SRC_DIR) && fs.statSync(SRC_DIR).isDirectory();
  check('Carpeta fuente existe', srcExists, SRC_DIR);

  const destExists = fs.existsSync(DEST_DIR) && fs.statSync(DEST_DIR).isDirectory();
  check('Carpeta destino existe', destExists, DEST_DIR);

  const indexExists = srcExists && fs.existsSync(path.join(SRC_DIR, 'index.html'));
  check('index.html existe en la fuente', indexExists, path.join(SRC_DIR, 'index.html'));

  const capConfigExists = fs.existsSync(CAPACITOR_CONFIG_PATH);
  check('capacitor.config.json existe', capConfigExists, CAPACITOR_CONFIG_PATH);

  let webDirOk = false;
  let capConfigJson = null;
  if (capConfigExists) {
    try {
      capConfigJson = JSON.parse(fs.readFileSync(CAPACITOR_CONFIG_PATH, 'utf8'));
      webDirOk = capConfigJson.webDir === 'www';
    } catch (e) {
      check('capacitor.config.json es JSON válido', false, String(e.message));
    }
  }
  check('capacitor.config.json tiene webDir = "www"', webDirOk, capConfigJson ? `webDir actual: "${capConfigJson.webDir}"` : 'no se pudo leer');

  // Huella de que la fuente realmente es el proyecto Control de Engrase.
  let looksLikeProject = false;
  let projectDetail = '';
  if (srcExists) {
    const hasCoreFiles = ['app.js', 'db.js', 'sync.js', 'styles.css'].every((f) =>
      fs.existsSync(path.join(SRC_DIR, f)),
    );
    const manifestRaw = readTextIfExists(path.join(SRC_DIR, 'manifest.json'));
    let nameMatches = false;
    if (manifestRaw) {
      try {
        const m = JSON.parse(manifestRaw);
        nameMatches = typeof m.name === 'string' && /control de engrase/i.test(m.name);
      } catch {
        // se reporta en la validación de manifest más abajo
      }
    }
    looksLikeProject = hasCoreFiles && nameMatches;
    projectDetail = `app.js/db.js/sync.js/styles.css presentes: ${hasCoreFiles}; manifest.name coincide: ${nameMatches}`;
  }
  check('La fuente parece el proyecto Control de Engrase', looksLikeProject, projectDetail);

  // manifest.json de la FUENTE debe ser JSON válido.
  let manifestValid = false;
  let manifestJson = null;
  const manifestRaw = readTextIfExists(path.join(SRC_DIR, 'manifest.json'));
  if (manifestRaw === null) {
    check('manifest.json de la fuente existe', false, 'no encontrado');
  } else {
    try {
      manifestJson = JSON.parse(manifestRaw);
      manifestValid = true;
      check('manifest.json de la fuente es JSON válido', true, '');
    } catch (e) {
      check('manifest.json de la fuente es JSON válido', false, String(e.message));
    }
  }

  // Los íconos referenciados por el manifest de la fuente deben existir.
  if (manifestValid) {
    const missingIcons = [];
    for (const ref of extractLocalIconsFromManifest(manifestJson)) {
      if (!fs.existsSync(path.join(SRC_DIR, ref))) missingIcons.push(ref);
    }
    check('Íconos del manifest existen en la fuente', missingIcons.length === 0, missingIcons.join(', '));
  }

  // .well-known/assetlinks.json: si existe, debe ser JSON válido.
  const assetlinksPath = path.join(SRC_DIR, '.well-known', 'assetlinks.json');
  if (fs.existsSync(assetlinksPath)) {
    try {
      JSON.parse(fs.readFileSync(assetlinksPath, 'utf8'));
      check('.well-known/assetlinks.json es JSON válido', true, '');
    } catch (e) {
      check('.well-known/assetlinks.json es JSON válido', false, String(e.message));
    }
  } else {
    check('.well-known/assetlinks.json presente en la fuente', false, 'no encontrado (no bloqueante si el sistema ya no lo usa)');
  }

  const criticalNames = new Set([
    'Carpeta fuente existe',
    'Carpeta destino existe',
    'index.html existe en la fuente',
    'capacitor.config.json existe',
    'capacitor.config.json tiene webDir = "www"',
    'La fuente parece el proyecto Control de Engrase',
    'manifest.json de la fuente es JSON válido',
    'Íconos del manifest existen en la fuente',
  ]);

  const criticalFailures = checks.filter((c) => criticalNames.has(c.name) && !c.ok);
  return { checks, ok: criticalFailures.length === 0, criticalFailures };
}

// ---------------------------------------------------------------------------
// Comparación fuente vs destino
// ---------------------------------------------------------------------------

function compare(runtimeSet) {
  const faltanEnDestino = [];
  const actualizar = [];
  const iguales = [];
  const errores = [];

  for (const rel of [...runtimeSet].sort()) {
    const srcAbs = path.join(SRC_DIR, rel);
    const destAbs = path.join(DEST_DIR, rel);
    try {
      if (!fs.existsSync(srcAbs)) {
        errores.push(`${rel} — referenciado pero no existe en la fuente`);
        continue;
      }
      if (!fs.existsSync(destAbs)) {
        faltanEnDestino.push(rel);
        continue;
      }
      const srcHash = sha256File(srcAbs);
      const destHash = sha256File(destAbs);
      if (srcHash === destHash) {
        iguales.push(rel);
      } else {
        actualizar.push(rel);
      }
    } catch (e) {
      errores.push(`${rel} — error: ${e.message}`);
    }
  }

  const destFiles = walkAllFiles(DEST_DIR);
  const sobranEnDestino = destFiles.filter((rel) => !runtimeSet.has(rel)).sort();

  return { faltanEnDestino, actualizar, iguales, sobranEnDestino, errores };
}

// ---------------------------------------------------------------------------
// Copia segura (temp file + rename) — SOLO se invoca en modo --apply
// ---------------------------------------------------------------------------

function copyFileSafely(srcAbs, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const tmpPath = `${destAbs}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(srcAbs, tmpPath);
  // Verifica que lo escrito coincide con la fuente antes de reemplazar.
  const srcHash = sha256File(srcAbs);
  const tmpHash = sha256File(tmpPath);
  if (srcHash !== tmpHash) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error('hash del archivo temporal no coincide con la fuente, se abortó el reemplazo');
  }
  fs.renameSync(tmpPath, destAbs);
}

function applyChanges(toWrite) {
  const written = [];
  const errores = [];
  for (const rel of toWrite) {
    const srcAbs = path.join(SRC_DIR, rel);
    const destAbs = path.join(DEST_DIR, rel);
    try {
      copyFileSafely(srcAbs, destAbs);
      written.push(rel);
    } catch (e) {
      errores.push(`${rel} — error: ${e.message}`);
    }
  }
  return { written, errores };
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

function printList(title, items) {
  console.log(`\n${title} (${items.length}):`);
  if (items.length === 0) {
    console.log('  (ninguno)');
  } else {
    for (const item of items) console.log(`  - ${item}`);
  }
}

function printValidations(validationResult) {
  console.log('\nVALIDACIONES:');
  for (const c of validationResult.checks) {
    const mark = c.ok ? 'OK ' : 'FALLÓ';
    console.log(`  [${mark}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  console.log('=== sync-web-to-android.mjs ===');
  console.log(`Modo: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Fuente:  ${SRC_DIR}`);
  console.log(`Destino: ${DEST_DIR}`);

  const runtimeSet = computeRuntimeFileSet(SRC_DIR);
  console.log(`\nArchivos runtime detectados en la fuente: ${runtimeSet.size}`);

  const validationResult = runValidations(runtimeSet);
  printValidations(validationResult);

  const { faltanEnDestino, actualizar, iguales, sobranEnDestino, errores } = compare(runtimeSet);

  const totalACopiar = faltanEnDestino.length + actualizar.length;
  console.log(`\nCOPIAR — total de archivos que --apply escribiría: ${totalACopiar}`);
  printList('  FALTAN EN DESTINO (nuevos)', faltanEnDestino);
  printList('  ACTUALIZAR (existen pero difieren por hash SHA-256)', actualizar);
  printList('IGUALES (sin cambios)', iguales);
  printList('SOBRAN EN DESTINO (no se tocan, solo se reportan)', sobranEnDestino);
  printList('ERRORES', errores);

  console.log(`\nAPPLY LISTO: ${validationResult.ok ? 'sí' : 'no'}`);
  if (!validationResult.ok) {
    console.log('Validaciones críticas fallidas:');
    for (const c of validationResult.criticalFailures) {
      console.log(`  - ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
  }

  if (!apply) {
    console.log('\nDRY-RUN: no se escribió ningún archivo.');
    process.exitCode = validationResult.ok ? 0 : 1;
    return;
  }

  if (!validationResult.ok) {
    console.error('\nABORTADO: no se realizó ninguna copia porque fallaron validaciones críticas.');
    process.exitCode = 1;
    return;
  }

  const toWrite = [...faltanEnDestino, ...actualizar];
  const { written, errores: writeErrors } = applyChanges(toWrite);
  console.log(`\nAPPLY: ${written.length} archivo(s) escrito(s).`);
  if (writeErrors.length) {
    console.error(`Errores durante la copia (${writeErrors.length}):`);
    for (const e of writeErrors) console.error(`  - ${e}`);
    process.exitCode = 1;
  }
  if (sobranEnDestino.length) {
    console.log(`\nAVISO: ${sobranEnDestino.length} archivo(s) sobran en destino y NO fueron eliminados (esta versión del script nunca borra).`);
  }
}

main();
