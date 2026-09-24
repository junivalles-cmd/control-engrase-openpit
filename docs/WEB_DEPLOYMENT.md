# DESPLIEGUE WEB (GITHUB PAGES) — PROCEDIMIENTO

Este documento describe el flujo para publicar `dist/` (generado por
Vite) como el sitio Web de Control de Engrase en GitHub Pages.

**Estado actual (actualizado en Vite Fase 4, 2026-09-23): `dist/` YA ES
la producción real.** El primer despliegue controlado se ejecutó en la
Fase 4 (commit `d52d43d` sobre `github.com/junivalles-cmd/control-engrase-openpit`,
publicado en `https://junivalles-cmd.github.io/control-engrase-openpit/`
— un Project Page, no la raíz del dominio como este documento asumía
originalmente). Ver `docs/VITE_MIGRATION.md` (Fase 4) para la
configuración remota real y la validación completa en producción. Desde
la Fase 5, además, el flujo legado `www` +
`tools/sync-web-to-android.mjs` ya no existe en el repositorio — `dist/`
es la única salida runtime tanto para esta Web como para Android.

## 0. Contexto que hay que tener claro antes de publicar

- **Repositorio remoto:** `github.com/junivalles-cmd/junivalles-cmd.github.io`
  (repo de GitHub Pages de usuario — se sirve en la raíz del dominio
  `https://junivalles-cmd.github.io/`, rama `main`, carpeta `/ (root)`).
- **Este repositorio local (`CONTROL_ENGRASE`) no está conectado con ese
  remoto** — no hay ningún `git remote` configurado hacia
  `junivalles-cmd.github.io`. Publicar significa subir el CONTENIDO de
  `dist/` a ese otro repositorio (hoy, manualmente — ver más abajo), no
  hacer `git push` desde aquí.
- No existe ningún workflow de GitHub Actions — la publicación es y sigue
  siendo manual a propósito (ver `docs/VITE_MIGRATION.md`, Fase 3: "no
  agregar GitHub Actions si todavía no es necesario").

## 1. Modificar la fuente

Editar únicamente `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` — la fuente
canónica. Nunca editar `dist/` directamente (se regenera en el paso 3 y
cualquier cambio manual ahí se perdería).

## 2. `npm test`

```
npm test
```

Debe dar **0 FAIL**. Si algo falla, no continuar — arreglar primero.

## 3. `npm run build`

```
npm run build
```

Regenera `dist/` desde cero (`emptyOutDir: true`) a partir de la fuente
actual. Debe terminar con `built in ...ms` sin errores.

## 4. Verificar `dist/`

```
npm run verify:dist
```

Comprueba automáticamente que `dist/` tiene todo lo crítico:
`index.html`, el set runtime completo, `.nojekyll` (vacío),
`.well-known/assetlinks.json` (JSON válido), `manifest.json` (con sus
íconos), `sw.js` (con todas sus rutas de precache resolviendo), y que no
volvió a colarse una carga incondicional del SDK Web de OneSignal.

**Si esto falla, NO publicar** — corregir la causa y repetir desde el
paso 2.

Atajo que encadena los pasos 2-4 en un solo comando:
```
npm run build:web
```

## 5. Publicar el contenido de `dist/`

**Manual, como siempre** (no hay Actions todavía):

1. Abrir `C:\Users\Planificador\Documents\CONTROL_ENGRASE\dist` en el
   explorador de archivos.
2. **Activar "Elementos ocultos"** (Vista → Elementos ocultos en el
   Explorador de Windows) — si no, `.nojekyll` y `.well-known/` no se
   ven y es fácil dejarlos fuera por error (el mismo aviso que ya traía
   `README_SUBIR_A_GITHUB.txt` para la fuente sin Vite sigue aplicando
   igual aquí).
3. Subir **todo** el contenido de `dist/` a la **raíz** del repositorio
   `junivalles-cmd.github.io` (reemplazando lo que había), no dentro de
   una subcarpeta.
4. Esperar 1-2 minutos a que GitHub Pages procese el cambio.

## 6. Verificar GitHub Pages tras publicar

- Abrir `https://junivalles-cmd.github.io/` — debe cargar la pantalla de
  login normalmente.
- Abrir `https://junivalles-cmd.github.io/.well-known/assetlinks.json`
  directamente — debe mostrar el JSON (empieza con `[{"relation":`), NO
  un 404. Si da 404: falta `.nojekyll` o `.well-known/` en lo subido.
- DevTools → Application → Service Workers: confirmar que `sw.js` se
  registra y activa.
- DevTools → Application → Manifest: sin errores, íconos visibles.
- Revisar la consola por errores de JavaScript.

## 7. Verificar `.well-known/assetlinks.json` (Android App Links)

Repetir la comprobación que ya documentaba `README_SUBIR_A_GITHUB.txt`:
si el archivo no se sirve correctamente, el código QR de la app abrirá el
navegador en vez de la app instalada. La verificación de Android ocurre
al *instalar* la app — si alguien ya la tenía instalada antes de esta
publicación, tendría que reinstalarla (con internet) para que Android
vuelva a comprobar los App Links.

## 8. Rollback

Si algo sale mal después de publicar `dist/`:

1. **La fuente `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` no cambió** en
   ningún momento de este proceso — sigue siendo la versión conocida y
   estable.
2. Repetir el paso 5 (publicar), pero subiendo el contenido de
   `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` directamente (la fuente sin
   pasar por Vite) en vez de `dist/` — es exactamente el proceso de
   publicación que se usaba antes de esta fase, sigue funcionando igual
   porque nunca se dejó de mantener.
3. Verificar de nuevo con el paso 6.

No hay ninguna base de datos ni estado del lado del servidor involucrado
en este rollback — es solo reemplazar archivos estáticos, sin ningún
efecto sobre Supabase, IndexedDB de los usuarios, ni la app Android
(que usa su propia copia empaquetada en el APK, no lee GitHub Pages en
tiempo de ejecución salvo para `sync.js` → Supabase, que no cambia con
este flujo).

## Versión estable actual

Al momento de escribir esto (2026-09-23), la versión estable y publicada
es el contenido manual de `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` — sin
pasar por Vite. `dist/` está **validado y listo**, pero **no se ha
publicado ninguna vez todavía**. Este documento se actualizará cuando eso
cambie.
