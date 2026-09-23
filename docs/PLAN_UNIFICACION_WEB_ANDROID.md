# PLAN DE UNIFICACIÓN WEB / ANDROID

Fecha de análisis: 2026-09-23
Rama: `migration-typescript`
Este documento es **solo análisis y diseño**. Ningún paso descrito aquí fue
ejecutado. No se movió, copió ni modificó ningún archivo de código.

---

## 1. Estructura actual

```
CONTROL_ENGRASE/
├── CONTROL_ENGRASE_WEB/
│   └── CONTROL_ENGRASE_WEB/        ← fuente web "de facto" (se sube a mano a GitHub)
│       ├── index.html, app.js, db.js, sync.js, styles.css, sw.js
│       ├── manifest.json, OneSignalSDKWorker.js
│       ├── icon-*.png (72,96,128,144,152,192,384,512,maskable-192,maskable-512)
│       ├── .nojekyll, .well-known/assetlinks.json
│       ├── schema.sql, borrar_datos_prueba.sql
│       ├── supabase/functions/{notify-push,notify-vencidos}/index.ts
│       ├── supabase/LIMPIAR_DATOS_DE_PRUEBA.sql
│       └── documentación (ESTADO_DEL_PROYECTO.md, guías, manuales PDF)
│
└── CONTROL_ENGRASE_APP_ANDROID/
    ├── www/                         ← COPIA MANUAL del frontend (webDir de Capacitor)
    │   └── (mismo set de archivos de negocio que CONTROL_ENGRASE_WEB)
    ├── android/                     ← proyecto nativo Android Studio / Gradle
    │   └── app/src/main/assets/public/   ← COPIA AUTOMÁTICA generada por "npx cap sync android"
    ├── icons/, assets/              ← salida de "npx capacitor-assets generate" (splash/launcher icons nativos)
    ├── capacitor.config.json        (webDir: "www")
    ├── package.json                 (scripts: sync, open:android, icons, applinks)
    ├── configure-applinks.js        (inyecta intent-filter de App Links en AndroidManifest.xml, ya aplicado)
    ├── supabase/, borrar_datos_prueba.sql, documentación (duplicados de los de WEB, a nivel raíz del proyecto Android, no dentro de www)
    └── ESTADO_DEL_PROYECTO.md, guías, manuales PDF (duplicados de los de WEB)
```

## 2. Duplicados detectados

| Archivo/carpeta | En WEB | En www | Nivel raíz APP_ANDROID |
|---|---|---|---|
| app.js, db.js, sync.js, styles.css, index.html, sw.js, OneSignalSDKWorker.js, schema.sql, .nojekyll, .well-known/assetlinks.json | ✅ | ✅ (idéntico) | — |
| manifest.json | ✅ | ✅ (**diferente**, ver §Diferencias) | — |
| icon-72/96/128/180/192/512/maskable-192/maskable-512.png | ✅ | ✅ (mismo tamaño, **contenido distinto**) | — |
| icon-144.png, icon-152.png, icon-384.png | ✅ | ❌ (no existen en www) | — |
| ESTADO_DEL_PROYECTO.md, GUIA_COMPLETA_INSTALACION.md, GUIA_NOTIFICACIONES_PUSH.md, MANUAL_NOTIFICACIONES.pdf, MANUAL_SUPABASE_PUSH.pdf, borrar_datos_prueba.sql | ✅ | ❌ | ✅ (duplicado como archivo de proyecto, no como parte de www) |
| supabase/functions/notify-push, notify-vencidos, LIMPIAR_DATOS_DE_PRUEBA.sql | ✅ | ❌ | ✅ (duplicado como archivo de proyecto, no como parte de www) |
| README_SUBIR_A_GITHUB.txt | ✅ | ❌ | ❌ (no existe copia; es exclusivo de WEB, tiene sentido porque documenta cómo publicar WEB) |

**Conclusión de duplicados:** existen dos tipos de duplicación:
1. **Duplicación de código de negocio** entre `CONTROL_ENGRASE_WEB` y `www` (el problema central que hay que resolver).
2. **Duplicación de documentación/backend** (guías, manuales, scripts SQL, Edge Functions) entre la raíz de `CONTROL_ENGRASE_WEB` y la raíz de `CONTROL_ENGRASE_APP_ANDROID`. Esta segunda duplicación es de menor riesgo (no afecta producción directamente) pero también deberá resolverse cuando se decida la carpeta única.

## 3. Comparación WEB vs. www (verificada con SHA-256)

- **WEB y www NO son 100% idénticos.**
- **Archivos de lógica de negocio: 100% idénticos** (mismo hash SHA-256): `app.js`, `db.js`, `sync.js`, `styles.css`, `index.html`, `sw.js`, `OneSignalSDKWorker.js`, `schema.sql`, `.nojekyll`, `.well-known/assetlinks.json`. La copia manual, para el código que controla el comportamiento de la app, se ha mantenido correctamente sincronizada hasta ahora.
- **Solo en WEB (no en www):** `icon-144.png`, `icon-152.png`, `icon-384.png`, y todos los archivos de documentación/backend listados en la tabla anterior (que sí existen en APP_ANDROID pero fuera de `www`).
- **Solo en www:** ninguno (www es subconjunto de WEB).
- **Diferencia oculta relevante para producción — `manifest.json`:**
  - `www/manifest.json` tiene `"background_color": "'#14171A'"` — con comillas simples literales dentro del string JSON (defecto de edición manual, valor de color inválido).
  - `www/manifest.json` referencia íconos como `"../icons/icon-48.webp"`, `"../icons/icon-256.webp"`, etc. — rutas que suben un nivel **fuera** de la carpeta servida (`www`/`assets/public`), apuntando a `CONTROL_ENGRASE_APP_ANDROID/icons/` (generada por `npx capacitor-assets generate`, pensada para íconos nativos, no para el manifest web). Estas rutas relativas no son accesibles cuando `www` se sirve como raíz web (ni en GitHub Pages ni dentro del WebView de Capacitor), por lo que el manifest de la copia `www` referencia íconos rotos.
  - `WEB/manifest.json` referencia correctamente íconos PNG dentro de la misma carpeta y cubre más tamaños (72 a 512 + maskable).
  - **Impacto:** bajo pero real — afecta el ícono/color mostrado al "instalar" la PWA (Add to Home Screen) desde el navegador dentro del WebView o si alguna vez se sirve `www` directamente; no afecta la lógica funcional de la app (login, sync, engrase, notificaciones), que vive en `app.js`/`db.js`/`sync.js` y esos están intactos.
- **Diferencia menor — íconos PNG con mismo tamaño de archivo pero contenido distinto:** 10 íconos (`icon-72/96/128/180/192/512/maskable-192/maskable-512.png`, `favicon.png`, `apple-touch-icon.png`) tienen el mismo tamaño en bytes en ambas copias pero hash SHA-256 distinto (verificado a nivel de bytes en `icon-96.png`: 358 de 8646 bytes difieren). Son visualmente equivalentes pero fueron exportados/comprimidos en momentos distintos — no hay evidencia de que esto rompa nada, pero confirma que las copias han divergido en detalles sin que nadie lo notara, que es exactamente el riesgo que motiva esta unificación.

## 4. Cómo funciona actualmente la publicación WEB

- **Sin build, sin bundler:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` son archivos estáticos servidos tal cual (HTML/CSS/JS planos, sin proceso de compilación).
- **Publicación manual:** según `README_SUBIR_A_GITHUB.txt`, el flujo es subir TODO el contenido de la carpeta a la **raíz** del repositorio `junivalles-cmd.github.io` (repo de GitHub Pages de usuario, no un repo de proyecto con subcarpeta `/docs`), arrastrando los archivos por la interfaz web de GitHub. No existe ningún script de publicación ni workflow de GitHub Actions (no hay carpeta `.github/workflows` en ninguno de los dos proyectos; los únicos `.github/` encontrados están dentro de `node_modules` de paquetes npm de terceros y son irrelevantes).
- **No existe `CNAME`** en ningún lado — no hay dominio propio configurado, se usa el subdominio por defecto `junivalles-cmd.github.io`.
- **Dominio confirmado por documentación local:** `https://junivalles-cmd.github.io/` (referenciado en `ESTADO_DEL_PROYECTO.md`, `GUIA_NOTIFICACIONES_PUSH.md`, `README_SUBIR_A_GITHUB.txt` y hardcodeado como `WEB_HOST` en `configure-applinks.js`).
- **Archivos críticos para que la publicación funcione:**
  - `.nojekyll` (vacío): sin él, GitHub Pages usa Jekyll, que **ignora carpetas que empiezan con punto** — por eso `.well-known/` desaparecería del sitio publicado.
  - `.well-known/assetlinks.json`: debe quedar accesible en `https://junivalles-cmd.github.io/.well-known/assetlinks.json` para que Android verifique los App Links (si falta, el QR abre el navegador en vez de la app instalada).
- **Ni `CONTROL_ENGRASE_WEB` ni `CONTROL_ENGRASE_APP_ANDROID` tienen su propio repositorio Git** (no se encontró ninguna carpeta `.git` anidada) — es decir, el repositorio Git recién creado en `CONTROL_ENGRASE` (raíz de este monorepo local) **no está conectado de ninguna forma** con el repositorio remoto `junivalles-cmd.github.io` que sirve la web en producción. Son, hoy, dos mundos totalmente desacoplados.

**CONFIGURACIÓN REMOTA DE GITHUB PAGES:**
**NO SE PUDO VERIFICAR CONFIGURACIÓN REMOTA DE GITHUB PAGES.** Todo lo anterior proviene de documentación local (`README_SUBIR_A_GITHUB.txt`, `ESTADO_DEL_PROYECTO.md`, `GUIA_*.md`) y de una constante hardcodeada en `configure-applinks.js`. No hay acceso ni evidencia local de la configuración real del repositorio remoto `junivalles-cmd.github.io` (rama de publicación, si usa GitHub Actions, si tiene dominio personalizado activado en Settings, etc.). No se hizo ningún `git remote`, `fetch` ni consulta a GitHub para esta fase.

## 5. Cómo funciona Capacitor actualmente

**`package.json` — scripts disponibles:**
| Script | Comando | Qué hace |
|---|---|---|
| `sync` | `npx cap sync android` | Copia `www` → `android/app/src/main/assets/public` y sincroniza plugins nativos |
| `open:android` | `npx cap open android` | Abre el proyecto en Android Studio |
| `icons` | `npx capacitor-assets generate ...` | Genera íconos/splash nativos (`icons/`, `assets/`, `android/app/src/main/res/mipmap-*`, `drawable-*`) a partir de un ícono fuente — **no toca `www/manifest.json`** |
| `applinks` | `node configure-applinks.js` | Inyecta el `intent-filter` de App Links en `AndroidManifest.xml` (ya ejecutado — verificado presente en el manifest actual) |

**`capacitor.config.json` — `webDir`:** `"www"` → Capacitor toma literalmente la carpeta `CONTROL_ENGRASE_APP_ANDROID\www` como única entrada para generar los assets Android.

**Plugins instalados (dependencias):** `@capacitor/android`, `@capacitor/core`, `@capacitor/camera`, `@capacitor/local-notifications`, `@capawesome/capacitor-badge`, `onesignal-cordova-plugin`. DevDependencies: `@capacitor/cli`, `@capacitor/assets`.

**Qué llega a `android\app\src\main\assets\public` (verificado en disco):** copia completa y actual de `www` (`index.html`, `app.js`, `db.js`, `sync.js`, `styles.css`, `sw.js`, `manifest.json`, íconos, `OneSignalSDKWorker.js`, `schema.sql`, `.nojekyll`, `.well-known/assetlinks.json`) **más** los archivos que agrega el propio Capacitor: `cordova.js`, `cordova_plugins.js`, `plugins/onesignal-cordova-plugin/dist/index.cjs`. Además, en `android/app/src/main/assets/` (un nivel arriba de `public/`) se generan `capacitor.config.json` y `capacitor.plugins.json`; y en `android/app/src/main/res/xml/` se genera `config.xml`.

**Qué debe existir para App Links:** el `intent-filter` con `android:host="junivalles-cmd.github.io"` en `AndroidManifest.xml` (ya presente) **y** que la web publicada sirva `.well-known/assetlinks.json` correctamente (depende de GitHub Pages + `.nojekyll`, sección 4).

**Comportamiento de `.well-known` y `.nojekyll` dentro de Capacitor:** se copian igual que cualquier otro archivo de `www` — Capacitor no les da tratamiento especial; el problema de Jekyll ignorando carpetas con punto es exclusivo de GitHub Pages, no afecta al WebView de Android.

**Qué se copia MANUALMENTE vs. qué se genera AUTOMÁTICAMENTE:**
| Ruta | Origen |
|---|---|
| `CONTROL_ENGRASE_APP_ANDROID\www` | **MANUAL** — alguien copia a mano desde `CONTROL_ENGRASE_WEB` cada vez que cambia el frontend |
| `CONTROL_ENGRASE_APP_ANDROID\android\app\src\main\assets\public` | **AUTOMÁTICO** — generado por `npx cap sync android` a partir de `www` |
| `CONTROL_ENGRASE_APP_ANDROID\android\app\src\main\assets\capacitor.config.json` / `capacitor.plugins.json` | **AUTOMÁTICO** — generado por `cap sync` |
| `CONTROL_ENGRASE_APP_ANDROID\android\app\src\main\res\xml\config.xml` | **AUTOMÁTICO** — generado por `cap sync` |
| `CONTROL_ENGRASE_APP_ANDROID\icons`, `assets\icon.png`, íconos nativos en `android\app\src\main\res\mipmap-*` | **AUTOMÁTICO** (pero bajo demanda) — generado por `npm run icons` (`capacitor-assets generate`), no por `cap sync` |
| `AndroidManifest.xml` (intent-filter de App Links) | **MANUAL, una sola vez** — generado por `node configure-applinks.js`, ya aplicado; no se repite en cada sync |

---

## 6. Evaluación de las tres arquitecturas

### OPCIÓN A — `CONTROL_ENGRASE_WEB` como fuente principal; `www` se genera desde ahí

**Ventajas:**
- Cero herramientas nuevas: un script simple (Node o PowerShell, ya hay `package.json`/Node disponible en `APP_ANDROID`) que copie `CONTROL_ENGRASE_WEB → www` reemplaza la copia manual, sin tocar cómo se publica GitHub Pages hoy (sigue siendo drag-and-drop de archivos planos).
- Mismo patrón que ya funciona: `www → assets/public` ya es automático vía `cap sync`; esto solo extiende la cadena un eslabón más atrás: `WEB → www → assets/public`, ambos pasos automáticos.
- Riesgo mínimo: no cambia ni el `webDir` de Capacitor, ni el formato de los archivos, ni el flujo de publicación web.
- Compatible con el 100% de coincidencia ya comprobada en el código de negocio — no hay que resolver conflictos de contenido, solo dejar de copiar a mano.
- Deja la puerta abierta a evolucionar el "script de copia" hacia un "build de Vite" más adelante sin cambiar de arquitectura otra vez (el mismo lugar en la cadena donde hoy iría un `cp`, mañana podría ir un `vite build`).

**Desventajas:**
- No resuelve todavía la duplicación de documentación/backend (guías, manuales, SQL, Edge Functions) entre las raíces de ambos proyectos.
- `CONTROL_ENGRASE_WEB` sigue teniendo una estructura "plana" (todo en una carpeta), no una organizada en `src/`/`public/` pensando en Vite/TypeScript a futuro — ese reordenamiento quedaría pendiente para una fase posterior.

**Riesgos:** bajo. El script de copia es trivial de escribir, probar y revertir (si falla, `www` simplemente no se actualiza, no se corrompe).

**Complejidad:** baja.

---

### OPCIÓN B — `www` como fuente principal; WEB se publica desde ahí

**Ventajas:**
- `www` ya es, hoy, el `webDir` de Capacitor — cero cambios en `capacitor.config.json` ni en el flujo Android.

**Desventajas:**
- Invierte la relación conceptual actual: hoy `CONTROL_ENGRASE_WEB` es semánticamente "la web pública" (tiene su propio README de publicación, su propia documentación) y `www` es una carpeta técnica interna del proyecto Android. Convertir `www` en la fuente obliga a mover la "identidad pública" del proyecto dentro de la carpeta del proyecto Android, lo cual es conceptualmente confuso para quien mantenga esto (¿por qué la web pública vive dentro de "APP_ANDROID"?).
- El flujo de publicación a GitHub Pages tendría que apuntar a una subcarpeta anidada (`CONTROL_ENGRASE_APP_ANDROID\www`) en lugar de una carpeta de nivel superior dedicada a la web — más fricción para quien hace el drag-and-drop manual, y más fácil subir por error archivos de más (o de menos).
- No aporta ninguna ventaja técnica real sobre la Opción A; solo cambia cuál de las dos carpetas ya existentes se declara "canónica", con peor ergonomía.

**Riesgos:** medio — mayor probabilidad de error humano al publicar (carpeta anidada, nombre "www" poco descriptivo para quien sube a GitHub).

**Complejidad:** baja, pero con peor relación beneficio/riesgo que A.

---

### OPCIÓN C — Fuente única `src/ + public/` con build (`Vite`) → `dist/` para ambas plataformas

**Ventajas:**
- Es la arquitectura "correcta" a largo plazo: una sola fuente, un solo build, mismo `dist/` sirve tanto a GitHub Pages como a `capacitor.config.json` (`webDir: "dist"`). Elimina el 100% de la duplicación, incluida la de documentación/backend si se organiza bien.
- Prepara directamente el terreno para TypeScript (Vite tiene soporte nativo).
- Es el destino natural mencionado explícitamente como objetivo futuro en `docs/LINEA_BASE.md`.

**Desventajas / Riesgos:**
- Requiere introducir Vite y cambiar el flujo de publicación de GitHub Pages: hoy es "subir archivos planos sin build" — pasar a "hay que ejecutar `npm run build` antes de publicar" es un cambio de proceso real, que además debería automatizarse con GitHub Actions para no depender de que alguien recuerde compilar antes de subir (y hoy no existe ningún workflow de CI/CD, ver sección 4).
- Reorganizar todo el código existente en `src/`/`public/` toca, aunque sea moviendo sin reescribir lógica, **todos** los archivos protegidos explícitamente en esta fase (`app.js`, `db.js`, `sync.js`, `index.html`, `styles.css`, `sw.js`) y rutas relativas que hoy asumen que todo vive en la raíz servida (rutas de íconos, del Service Worker, de `manifest.json`, de `OneSignalSDKWorker.js` que por spec de Service Workers de Push típicamente debe servirse desde la raíz del scope).
- Mayor superficie de fallo simultáneo: si algo sale mal, se arriesga a la vez la publicación web y la compilación Android, justo lo que esta fase busca evitar ("minimizar el riesgo de romper el sistema actual").
- Es una arquitectura *conceptual* todavía no validada contra las particularidades reales de este proyecto (Service Worker con rutas absolutas, IndexedDB, OneSignal Web SDK cargado por `<script src="https://cdn.onesignal.com/...">`, etc.) — adoptarla de un salto, sin haber probado antes un paso intermedio, es la opción de mayor riesgo de las tres.

**Complejidad de migración:** alta si se hace de una vez; se vuelve manejable si se llega a ella *después* de haber consolidado primero la fuente única con la Opción A (ver recomendación).

---

## 7. Recomendación

**Se recomienda la OPCIÓN A como siguiente paso ejecutable**, con la Opción C documentada explícitamente como **destino final** al que la Opción A migra de forma natural más adelante, sin necesidad de rehacer la arquitectura otra vez.

**Motivo:** las dos restricciones más fuertes del enunciado son "evitar una reescritura" y "minimizar el riesgo de romper el sistema actual". Ya se comprobó (sección 3) que el código que realmente importa (`app.js`, `db.js`, `sync.js`, `styles.css`, `index.html`, `sw.js`) **ya es idéntico** entre `CONTROL_ENGRASE_WEB` y `www` — el problema no es que el contenido esté desincronizado hoy, es que **nada impide que se desincronice mañana** por depender de que alguien copie bien a mano. Automatizar esa copia (Opción A) resuelve el riesgo real y actual sin tocar ni GitHub Pages ni Capacitor ni ningún archivo de negocio, y sin instalar nada nuevo. La Opción C sigue siendo el objetivo correcto a futuro (Vite + TypeScript, pedido explícitamente como preparación), pero adoptarla de inmediato mezclaría "dejar de copiar a mano" con "cambiar el sistema de build y el flujo de publicación", dos cambios de naturaleza distinta que es más seguro separar en fases.

## 8. Arquitectura futura propuesta (destino final, no inmediato)

```
CONTROL_ENGRASE/
├── src/                     ← app.js, db.js, sync.js reorganizados (futuro, con TypeScript)
├── public/                  ← manifest.json, íconos, .well-known/, .nojekyll, sw.js, OneSignalSDKWorker.js
├── package.json
├── vite.config.ts
├── dist/                    ← salida única del build (git-ignorada, como assets/public hoy)
├── CONTROL_ENGRASE_APP_ANDROID/
│   ├── capacitor.config.json   (webDir apuntando a "../dist" o equivalente)
│   └── android/
└── docs/
```

Flujo futuro:
```
src/ + public/  →  npm run build  →  dist/  ─┬─→ GitHub Pages (publicación, manual o vía Action)
                                              └─→ npx cap sync android → Android Studio
```

Esta estructura **no se crea en esta fase**. Es el punto de llegada documentado para cuando, en una fase posterior ya validada, se decida introducir Vite/TypeScript.

## 9. Plan de migración (diseño, sin ejecutar)

**ESTADO ACTUAL:** dos copias del frontend (`CONTROL_ENGRASE_WEB` y `www`), sincronizadas hoy pero mantenidas a mano; `www → assets/public` ya automático vía `cap sync`.

**FASE A1 — Elegir y fijar la fuente única (sin mover archivos todavía)**
→ Documentar formalmente que `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` es la fuente canónica (este documento ya lo hace).
→ PRUEBA: revisar que no hay ningún proceso (script, guía, memoria del equipo) que asuma lo contrario.
→ COMMIT: `docs: designate CONTROL_ENGRASE_WEB as canonical frontend source` (solo documentación).

**FASE A2 — Crear el script de sincronización automática `WEB → www`**
→ Crear un script (por ejemplo `CONTROL_ENGRASE_APP_ANDROID/sync-www-from-web.js` o similar, a definir en su momento) que copie el contenido de `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` hacia `www`, reemplazando archivo por archivo, sin tocar `www` fuera de ese script.
→ Agregar un script npm (`"sync:web": "node sync-www-from-web.js"`) en `CONTROL_ENGRASE_APP_ANDROID/package.json`.
→ PRUEBA: ejecutar el script contra una copia de prueba (no la real) y comparar por hash contra `CONTROL_ENGRASE_WEB`; confirmar que el resultado es 100% idéntico, incluidos los 3 íconos que hoy faltan en `www` y el `manifest.json` correcto.
→ COMMIT: `feat: add automated sync script from WEB to www`.

**FASE A3 — Ejecutar el script una vez sobre `www` real y validar**
→ Ejecutar el script real (esto SÍ modifica `www`, por eso se hace en su propia fase, con confirmación explícita antes).
→ PRUEBA: `npx cap sync android` (ya permitido en esa fase, no en esta), abrir en Android Studio, compilar un APK de depuración, instalar y probar login, registro de engrase, sincronización con Supabase, notificaciones, cámara/QR, modo offline.
→ PRUEBA WEB: servir `CONTROL_ENGRASE_WEB` localmente (o revisar visualmente) para confirmar que nada cambió ahí.
→ COMMIT: `chore: resync www from WEB via automated script (icons + manifest fixed)`.

**FASE A4 — Eliminar la duplicación de documentación/backend**
→ Decidir una única ubicación para guías, manuales, scripts SQL y Edge Functions (hoy duplicados entre las raíces de `CONTROL_ENGRASE_WEB` y `CONTROL_ENGRASE_APP_ANDROID`).
→ PRUEBA: confirmar que ambos flujos (deploy web, build Android) siguen encontrando lo que necesitan.
→ COMMIT: `docs: consolidate duplicated project documentation`.

*(A partir de aquí, "UNA FUENTE DE CÓDIGO + WEB + ANDROID" ya está lograda sin Vite ni TypeScript — este es un punto de parada seguro y funcional.)*

**FASE C1 (futura, posterior, requiere aprobación explícita aparte) — Introducir Vite**
→ Reorganizar `CONTROL_ENGRASE_WEB` en `src/` + `public/` dentro de una nueva carpeta raíz compartida.
→ PRUEBA exhaustiva de rutas relativas (Service Worker, manifest, OneSignal, íconos).
→ COMMIT por partes.

**FASE C2 (futura) — Migrar `app.js`/`db.js`/`sync.js` a TypeScript**, archivo por archivo, con pruebas después de cada uno.

## Carpetas: estado final por fase

| Carpeta | Después de Fase A (recomendado ahora) | Después de Fase C (futuro) |
|---|---|---|
| `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` | **Activa** — fuente única editable | Reemplazada conceptualmente por `src/`+`public/` (de respaldo temporal hasta validar) |
| `CONTROL_ENGRASE_APP_ANDROID\www` | **Generada automáticamente** (ya no se edita a mano) | Eliminable solo después de validar que `dist/` la reemplaza sin pérdidas |
| `CONTROL_ENGRASE_APP_ANDROID\android\app\src\main\assets\public` | Generada automáticamente (sin cambio, ya lo es) | Sin cambio |
| Documentación/backend duplicados en ambas raíces | Consolidados en una ubicación (Fase A4) | Sin cambio adicional |

**Ninguna carpeta se elimina en esta fase ni en la Fase A.** La eliminación de `www` como copia manual solo ocurriría, como mucho, después de la Fase C, y solo tras validación completa — y seguiría existiendo como carpeta generada automáticamente incluso entonces, porque Capacitor necesita un `webDir` físico en disco.

## 10. Riesgos

- **Riesgo de manifest/íconos ya presente hoy** (independiente de la migración): `www/manifest.json` tiene un `background_color` inválido y rutas de íconos rotas. No se corrige en esta fase (no se toca código), pero queda documentado para `docs/BUG_REGISTER.md`.
- **Riesgo de romper GitHub Pages:** cualquier fase que toque el flujo de publicación (especialmente Fase C) puede romper la web en producción si no se prueba antes de subir. Mitigado probando localmente antes de cada "subida" manual.
- **Riesgo de romper App Links:** si al reorganizar archivos se pierde `.nojekyll` o `.well-known/assetlinks.json`, o cambian de ubicación relativa a la raíz servida, el QR vuelve a abrir el navegador en vez de la app. Mitigado manteniendo ambos archivos siempre en la raíz de lo publicado, en cada fase.
- **Riesgo de desincronización durante la transición:** mientras exista la Fase A (script de copia) y no se haya llegado a la Fase C, sigue habiendo dos carpetas físicas; si alguien edita `www` a mano "por apuro", se vuelve a romper la fuente única. Mitigado documentando claramente (y, en una fase de implementación futura, opcionalmente protegiendo `www` de ediciones directas).
- **Riesgo humano en la publicación manual a GitHub Pages:** sigue siendo un proceso manual de arrastrar archivos; no se resuelve en esta fase (fuera de alcance: no se toca configuración de GitHub Pages).

## Rollback

- Cada fase de la sección 9 es un commit independiente sobre `migration-typescript` — revertir cualquier fase es `git revert <hash>` o volver al commit anterior, sin afectar `master` ni el commit baseline `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc`.
- Ninguna fase de este plan modifica el repositorio remoto de GitHub Pages ni el proyecto Android compilado — todo el rollback ocurre dentro de este repositorio local hasta que se decida explícitamente publicar/desplegar.
- Como esta fase (Fase 1 del proyecto de migración) es puramente de análisis y documentación, su "rollback" es simplemente no continuar con la Fase A2 en adelante.
