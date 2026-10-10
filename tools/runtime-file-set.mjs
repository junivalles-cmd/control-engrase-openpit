// tools/runtime-file-set.mjs
//
// Calcula el set de archivos "runtime" (los que de verdad necesita el
// navegador/WebView para funcionar) de la fuente canónica
// CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB, leyendo lo que index.html,
// manifest.json y sw.js realmente referencian — sin incluir documentación,
// PDFs, SQL ni el código fuente de Supabase.
//
// Sin shebang a propósito (a diferencia de sync-web-to-android.mjs): este
// módulo lo importan tanto el script de sincronización como
// vite.config.js, y esbuild (usado por Vite para cargar su config) no
// tolera un `#!/usr/bin/env node` en un archivo importado — ver
// docs/VITE_MIGRATION.md.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TOOLS_DIR, '..');

export const SRC_DIR = path.join(ROOT_DIR, 'CONTROL_ENGRASE_WEB', 'CONTROL_ENGRASE_WEB');

// Archivos de infraestructura que siempre deben viajar si existen en la
// fuente, aunque ningún otro archivo los referencie por texto (no aparecen
// en <script>/<link> ni en el manifest ni en el precache del Service
// Worker — se usan por convención / los lee un verificador externo):
//   - .nojekyll                    → necesario para que GitHub Pages no oculte .well-known
//   - .well-known/assetlinks.json  → verificación de Android App Links (la lee el propio Android sobre HTTPS, no el WebView local; se sincroniza igual por paridad y porque así se definió en el análisis de Fase 1)
//   - OneSignalSDKWorker.js        → convención de OneSignal Web Push, cargado directamente por su SDK, no referenciado en el HTML
//   - control-engrase-openpit/index.html → compatibilidad QR legacy (lote
//     "COMPATIBILIDAD QR LEGACY ANTES DE MIGRACIÓN PAGES", 2026-10-10):
//     redirige /control-engrase-openpit/#eq=X a /#eq=X para QR físicos
//     impresos antes del renombre de repo a junivalles-cmd.github.io.
export const FIXED_CORE_FILES = [
  'index.html',
  'manifest.json',
  'sw.js',
  'OneSignalSDKWorker.js',
  '.nojekyll',
  '.well-known/assetlinks.json',
  'control-engrase-openpit/index.html',
];

// Defensa adicional (denylist): aunque el cálculo del set runtime es un
// allowlist derivado de lo que el propio index.html/manifest/sw.js declaran
// usar, esta lista de exclusión explícita evita que documentación,
// backend o scripts SQL se cuelen aunque algún día alguien los referencie
// por error desde el HTML.
export const NEVER_SYNC_PATTERNS = [
  /\.md$/i,
  /\.pdf$/i,
  /\.sql$/i,
  /\.txt$/i,
  /^supabase\//i,
];

export function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function isExcludedByDenylist(relPosixPath) {
  return NEVER_SYNC_PATTERNS.some((re) => re.test(relPosixPath));
}

export function readTextIfExists(absPath) {
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
export function extractLocalIconsFromManifest(manifestJson) {
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

export function computeRuntimeFileSet(srcDir) {
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
