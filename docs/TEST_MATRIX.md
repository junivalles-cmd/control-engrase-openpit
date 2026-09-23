# MATRIZ DE PRUEBAS

Este archivo registra qué se probó (y qué no se pudo probar) en cada fase de
la migración, para distinguir claramente lo verificado de lo asumido.

## FASE A3 — Primera sincronización real WEB → www → Android (2026-09-23)

### Herramienta de sincronización
| Prueba | Resultado |
|---|---|
| Dry-run no modifica archivos | PASS (`git status` idéntico antes/después) |
| `--apply` copia/actualiza solo el set runtime calculado | PASS (13 archivos: 10 actualizados, 3 nuevos, 0 errores) |
| Dry-run posterior al apply queda en 0/0 | PASS (22/22 idénticos por hash SHA-256) |
| Sobrantes (`schema.sql`, `icon-180.png`) no se tocan | PASS |
| Ruta de fuente inexistente → error controlado | PASS (probado en copia aislada, no en el proyecto real) |
| Manifest inválido en la fuente → aborta `--apply` | PASS (probado en copia aislada, no en el proyecto real) |
| Fuente WEB no modificada por el script | PASS (`git diff` sin cambios en `CONTROL_ENGRASE_WEB`) |

### Web (`CONTROL_ENGRASE_WEB`)
| Prueba | Resultado |
|---|---|
| Archivos runtime servidos con HTTP 200 (servidor estático local) | PASS (`index.html`, `manifest.json`, `sw.js`, `.well-known/assetlinks.json`, íconos, `app.js`, `styles.css`, `OneSignalSDKWorker.js`) |
| Sintaxis válida de `app.js`, `db.js`, `sync.js`, `sw.js` (`node --check`) | PASS |
| `manifest.json` JSON válido, íconos existen | PASS |
| Carga inicial en navegador real | NO PROBADO (sin extensión de automatización de navegador instalada en esta sesión) |
| Consola del navegador sin errores | NO PROBADO |
| Login | NO PROBADO |
| Navegación entre pantallas | NO PROBADO |
| IndexedDB | NO PROBADO |
| Registro del Service Worker en un navegador real | NO PROBADO |
| Modo offline real | NO PROBADO |

### Android
| Prueba | Resultado |
|---|---|
| `npx cap sync android` sin errores | PASS |
| `assets/public` coincide por hash con `www` (archivos runtime) | PASS |
| Ningún archivo versionado de Android modificado por `cap sync` | PASS (`git status` limpio fuera de `www`) |
| Build debug (`./gradlew assembleDebug`) | PASS (tras `./gradlew clean` para resolver un `AccessDeniedException` de Windows en artefactos de build obsoletos — no relacionado con el código sincronizado) |
| Instalación en dispositivo/emulador | NO PROBADO EN DISPOSITIVO (sin dispositivo ni emulador conectado — `adb devices` vacío) |
| Arranque de la app | NO PROBADO EN DISPOSITIVO |
| IndexedDB en el WebView | NO PROBADO EN DISPOSITIVO |
| Interfaz / íconos | NO PROBADO EN DISPOSITIVO |
| Modo offline | NO PROBADO EN DISPOSITIVO |
| QR / App Links | NO PROBADO EN DISPOSITIVO (verificado en archivos: `.nojekyll` y `.well-known/assetlinks.json` idénticos entre fuente y destino, sin romperse) |
| Cámara | NO PROBADO EN DISPOSITIVO |
| OneSignal | NO PROBADO EN DISPOSITIVO |
| Notificaciones locales | NO PROBADO EN DISPOSITIVO |
