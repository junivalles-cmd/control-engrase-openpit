import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeRuntimeFileSet, SRC_DIR } from './tools/runtime-file-set.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, 'dist');

// Referencias que Vite reescribe/hashea porque index.html las carga con
// <link href="...">: sw.js las precachea por NOMBRE EXACTO (./manifest.json,
// ./styles.css, etc.), así que no pueden terminar en assets/xxx-HASH.ext.
// Ver docs/VITE_MIGRATION.md.
const STABLE_HTML_REFS = [
  [/\.\/assets\/manifest-[\w-]+\.json/, './manifest.json'],
  [/\.\/assets\/favicon-[\w-]+\.png/, './favicon.png'],
  [/\.\/assets\/apple-touch-icon-[\w-]+\.png/, './apple-touch-icon.png'],
  [/\.\/assets\/index-[\w-]+\.css/, './styles.css'],
];

// FASE VITE 1 (build paralelo/shadow build) — ver docs/VITE_MIGRATION.md.
//
// Vite NO puede "bundlear" los <script src="..."> clásicos (sin
// type="module") de este proyecto — los deja tal cual en el HTML de salida
// (comprobado empíricamente), pero tampoco copia el ARCHIVO al que apuntan.
// Y para los <link href="manifest.json"/"favicon.png"/"apple-touch-icon.png">
// y el <link rel="stylesheet">, sí los procesa y les pone un nombre con
// hash — lo cual rompería el precache de sw.js si dist se sirviera tal cual.
//
// Por eso este plugin, después de que Vite arma dist/:
//   1. Copia, con nombre ESTABLE (sin hash), exactamente el mismo set
//      runtime que ya calcula tools/sync-web-to-android.mjs para Android
//      (misma allowlist derivada de index.html/manifest.json/sw.js, mismo
//      denylist de docs/PDF/SQL/supabase) — sin duplicar esa lógica.
//   2. Reescribe en dist/index.html las 4 referencias que Vite hasheó, de
//      vuelta a su nombre estable (que ya existe gracias al paso 1).
//   3. Borra los archivos hasheados que quedaron huérfanos en dist/assets/.
function copyStableRuntimeFiles() {
  return {
    name: 'copy-stable-runtime-files',
    apply: 'build',
    closeBundle() {
      const runtimeSet = computeRuntimeFileSet(SRC_DIR);
      for (const rel of runtimeSet) {
        if (rel === 'index.html') continue; // Vite ya lo procesó/minificó — no sobrescribir.
        const srcAbs = path.join(SRC_DIR, rel);
        const destAbs = path.join(OUT_DIR, rel);
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        fs.copyFileSync(srcAbs, destAbs);
      }

      const indexPath = path.join(OUT_DIR, 'index.html');
      let html = fs.readFileSync(indexPath, 'utf8');
      for (const [pattern, replacement] of STABLE_HTML_REFS) {
        html = html.replace(pattern, replacement);
      }
      fs.writeFileSync(indexPath, html);

      // Cualquier archivo que haya quedado en dist/assets/ a esta altura es
      // un duplicado hasheado de algo que el paso 1 ya copió con nombre
      // estable (manifest/favicon/apple-touch-icon/css, y a veces un ícono
      // adicional que Vite copia por su cuenta al leer el manifest) — en
      // esta fase no hay ningún <script type="module"> que genere un chunk
      // real ahí, así que es seguro limpiar la carpeta entera.
      const assetsDir = path.join(OUT_DIR, 'assets');
      if (fs.existsSync(assetsDir)) {
        fs.rmSync(assetsDir, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  root: SRC_DIR,
  base: './',
  publicDir: false, // el copiado real lo hace copyStableRuntimeFiles(), con la allowlist del proyecto
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
  },
  plugins: [copyStableRuntimeFiles()],
});
