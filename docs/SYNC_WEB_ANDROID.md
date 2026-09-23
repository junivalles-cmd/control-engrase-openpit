# HERRAMIENTA DE SINCRONIZACIÓN WEB → ANDROID

Script: `tools/sync-web-to-android.mjs`
Fase: A2 del plan de unificación (`docs/PLAN_UNIFICACION_WEB_ANDROID.md`, §9).
Estado: **creado y probado en dry-run. Nunca ejecutado en modo `--apply`.**

## Objetivo

Reemplazar la copia manual de `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` hacia
`CONTROL_ENGRASE_APP_ANDROID\www` por un proceso automático, repetible y
auditable, que copie **solo** los archivos que el frontend realmente necesita
para ejecutarse — nunca documentación, scripts SQL ni backend.

## Fuente y destino

- **Fuente:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`
- **Destino:** `CONTROL_ENGRASE_APP_ANDROID\www`

Estas rutas están fijas dentro del script (no son parámetros de línea de
comandos) para evitar que una ejecución accidental apunte a un lugar
equivocado. El script se resuelve a sí mismo relativo a su propia ubicación
(`tools/`), así que siempre calcula la raíz del repositorio correctamente sin
importar desde qué carpeta se invoque `node`.

El script **nunca** escribe en `android\app\src\main\assets\public` — esa
carpeta sigue siendo responsabilidad exclusiva de `npx cap sync android`.

## Modos de uso

```
node tools/sync-web-to-android.mjs             # dry-run (por defecto)
node tools/sync-web-to-android.mjs --dry-run    # dry-run explícito
node tools/sync-web-to-android.mjs --apply      # aplica cambios (requiere pasar validaciones)
```

Sin `--apply`, el script **nunca** escribe, borra ni sobrescribe nada — solo
analiza y reporta.

## Cómo se decide qué archivos sincronizar (Paso 3 del análisis)

En vez de copiar toda la carpeta fuente a ciegas, el script calcula un
**allowlist derivado de lo que el propio proyecto declara usar**:

1. Lee `index.html` y extrae todas las referencias locales (`href=`/`src=`)
   que no sean URLs externas (`http://`, `https://`) — esto captura
   `styles.css`, `db.js`, `sync.js`, `app.js`, `manifest.json`,
   `favicon.png`, `apple-touch-icon.png`.
2. Lee `manifest.json` de la fuente y extrae los `icons[].src` locales.
3. Lee `sw.js` y extrae el array `ASSETS` (la lista de precache que el propio
   Service Worker ya declara).
4. Agrega un conjunto fijo de archivos de infraestructura que ningún archivo
   de texto referencia directamente pero que son necesarios por convención:
   - `.nojekyll` — necesario para que GitHub Pages no oculte `.well-known/`.
   - `.well-known/assetlinks.json` — verificación de Android App Links (la
     lee Android sobre HTTPS contra el dominio publicado, no el archivo local
     dentro del WebView; se sincroniza igual por paridad, tal como se definió
     en el análisis de Fase 1).
   - `OneSignalSDKWorker.js` — convención de OneSignal Web Push, cargado
     directamente por su SDK, no referenciado en el HTML.
   - `index.html`, `manifest.json`, `sw.js` (ellos mismos).
5. Aplica un filtro de exclusión (denylist) de seguridad adicional que
   descarta cualquier candidato que termine en `.md`, `.pdf`, `.sql`, `.txt`
   o que empiece con `supabase/`, por si algún día alguno de esos archivos
   terminara referenciado por error desde el HTML.

### Archivos incluidos (runtime del frontend)

`index.html`, `app.js`, `db.js`, `sync.js`, `styles.css`, `sw.js`,
`manifest.json`, `OneSignalSDKWorker.js`, `favicon.png`,
`apple-touch-icon.png`, los 10 íconos PWA (`icon-72/96/128/144/152/192/384/512`
+ `icon-maskable-192/512.png`), `.nojekyll`, `.well-known/assetlinks.json`.

### Archivos EXCLUIDOS deliberadamente (no son runtime del frontend)

- `ESTADO_DEL_PROYECTO.md`, `GUIA_COMPLETA_INSTALACION.md`,
  `GUIA_NOTIFICACIONES_PUSH.md`, `README_SUBIR_A_GITHUB.txt` — documentación
  para humanos, nunca cargada por el navegador ni por Capacitor.
- `MANUAL_NOTIFICACIONES.pdf`, `MANUAL_SUPABASE_PUSH.pdf` — manuales, ídem.
- `schema.sql`, `borrar_datos_prueba.sql` — se ejecutan a mano en el SQL
  Editor de Supabase; el frontend nunca los solicita.
- `supabase/functions/notify-push/index.ts`,
  `supabase/functions/notify-vencidos/index.ts`,
  `supabase/LIMPIAR_DATOS_DE_PRUEBA.sql` — Edge Functions y scripts que se
  despliegan directamente a Supabase (por CLI o dashboard), nunca forman
  parte del bundle que corre en el navegador o el WebView.

**Hallazgo durante la primera ejecución en dry-run:** `www` actualmente
contiene `schema.sql` (una copia manual antigua) que, según este análisis, no
debería estar ahí — el script lo reporta como "sobra en destino" pero no lo
borra (ver sección siguiente).

## Validaciones antes de permitir `--apply`

El script corre siempre estas comprobaciones (en dry-run y en apply) y solo
permite escribir si TODAS las críticas pasan:

1. La carpeta fuente existe.
2. La carpeta destino existe.
3. `index.html` existe en la fuente.
4. `capacitor.config.json` existe en `CONTROL_ENGRASE_APP_ANDROID`.
5. `capacitor.config.json` tiene `webDir: "www"`.
6. La fuente "parece" el proyecto Control de Engrase (`app.js`, `db.js`,
   `sync.js`, `styles.css` presentes **y** `manifest.json.name` contiene
   "Control de Engrase").
7. `manifest.json` de la fuente es JSON válido.
8. Todos los íconos que el manifest de la fuente referencia existen
   físicamente en la fuente.
9. `.well-known/assetlinks.json` de la fuente, si existe, es JSON válido (no
   bloqueante si no existe, solo se avisa).

Si cualquiera de las validaciones 1–8 falla, `--apply` se **aborta por
completo sin escribir ningún archivo** (no hay copia parcial). El resultado
de las validaciones se muestra siempre, también en dry-run, bajo
`APPLY LISTO: sí/no`.

## Comparación y reporte

Para cada archivo del set runtime calculado, el script compara fuente vs.
destino por **hash SHA-256** (no solo por tamaño ni fecha) y lo clasifica en:

- **FALTAN EN DESTINO** — no existe en `www` todavía, se copiaría como nuevo.
- **ACTUALIZAR** — existe en ambos lados pero el contenido difiere.
- **IGUALES** — existe en ambos lados con hash idéntico, no se toca.
- **COPIAR** — total combinado de "faltan en destino" + "actualizar": lo que
  `--apply` efectivamente escribiría.

Además, recorre **todo** `www` (no solo el set runtime esperado) y reporta:

- **SOBRAN EN DESTINO** — archivos presentes en `www` que no forman parte del
  set runtime calculado desde la fuente actual.

Y cualquier fallo puntual de lectura/escritura se reporta en **ERRORES**, sin
ocultarlo ni detener el resto del análisis.

## Manejo de sobrantes

En esta primera versión, el script **nunca borra archivos**, ni en dry-run ni
en `--apply`. Los "sobrantes en destino" solo se listan como advertencia. La
eliminación automática de sobrantes se evaluará en una fase posterior, una
vez validado el proceso de sincronización en la práctica.

## Copia segura (para cuando se use `--apply`)

Cada archivo se copia primero a un archivo temporal (`<archivo>.tmp-<pid>-<timestamp>`)
en el mismo destino, se recalcula su hash SHA-256 y se compara contra el hash
de la fuente; solo si coinciden se hace `rename` al nombre final. Si algo
falla a mitad de camino, el archivo temporal se descarta y el archivo de
destino original queda intacto — nunca se deja un archivo truncado o a medio
escribir.

## Pruebas realizadas

1. **Dry-run contra el proyecto real:** no modificó ningún archivo (`git status`
   antes y después del dry-run es idéntico).
2. **Ruta de fuente inexistente:** probado en una copia aislada del script
   dentro de una carpeta temporal (no se tocó el proyecto real). El script
   reportó las validaciones fallidas correctamente, `APPLY LISTO: no`, y al
   forzar `--apply` abortó sin escribir nada (exit code 1).
3. **`manifest.json` de la fuente inválido:** probado igualmente en una copia
   aislada temporal, con un manifest JSON malformado a propósito (comillas
   simples + coma colgante, imitando el defecto real ya conocido de
   `www/manifest.json`). El script detectó el error de parseo, marcó
   `APPLY LISTO: no`, y `--apply` abortó sin escribir nada — la carpeta de
   destino de prueba quedó vacía.

## Rollback

- El script en sí no requiere rollback mientras no se use `--apply`: en modo
  dry-run es de solo lectura.
- Cuando en una fase futura se ejecute `--apply` por primera vez, el cambio
  quedará capturado en un commit propio de Git sobre `www` — revertirlo es
  `git revert` de ese commit, o `git checkout` del `www` anterior desde el
  commit previo.
- El script nunca toca `android\app\src\main\assets\public` ni el repositorio
  remoto de GitHub Pages, así que ninguna ejecución de esta herramienta
  (dry-run o apply) puede romper la publicación en producción ni el build de
  Android por sí sola — esos siguen dependiendo de que, aparte, se ejecute
  `npx cap sync android` y se vuelva a subir la web manualmente.
