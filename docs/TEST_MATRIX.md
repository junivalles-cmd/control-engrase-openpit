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
| Instalación en dispositivo/emulador | PASS (Samsung SM-S938B real, vía `adb install`/`adb install -r`, actualizado desde el 2026-09-23 posterior a la Fase A3) |
| Arranque de la app | PASS (proceso vivo, `ResumedActivity` = `MainActivity`, sin `FATAL EXCEPTION`/`AndroidRuntime` en logcat) |
| IndexedDB en el WebView | NO PROBADO EN DISPOSITIVO |
| Interfaz / íconos | PASS parcial — se confirmó y corrigió `UI-ANDROID-001` (buscador superpuesto) y `UI-ANDROID-003` (topbar de Administrador, ambos PASS validado); `UI-ANDROID-002` (ícono de logout de Lubricador) con corrección enviada, validación visual del usuario aún pendiente; el resto de pantallas todavía sin revisar (ver bloque ADMINISTRADOR abajo) |
| Modo offline | NO PROBADO EN DISPOSITIVO |
| QR / App Links | NO PROBADO EN DISPOSITIVO (verificado en archivos: `.nojekyll` y `.well-known/assetlinks.json` idénticos entre fuente y destino, sin romperse; además confirmado que el certificado del APK debug NO coincide con el de `assetlinks.json` — ver `docs/MANUAL_VALIDATION.md`, App Links queda BLOQUEADO EN DEBUG hasta probar con un build firmado de release) |
| Cámara | NO PROBADO EN DISPOSITIVO |
| OneSignal | NO PROBADO EN DISPOSITIVO |
| Notificaciones locales | NO PROBADO EN DISPOSITIVO |

## Bugs de UI detectados y corregidos en validación manual (2026-09-23)

| ID | Descripción | Estado |
|---|---|---|
| UI-ANDROID-001 | Buscador superior superpuesto con otros controles en Android | CORREGIDO — PASS, validado visualmente por el usuario en Samsung SM-S938B |
| UI-ANDROID-002 | Ícono de cerrar sesión del Lubricador usaba carácter Unicode en vez del sistema de íconos | CORREGIDO EN CÓDIGO — pendiente de validación visual del usuario |
| UI-ANDROID-003 | Topbar de Administrador excesivamente alto en móvil (2 filas constantes por `flex-wrap`) | CORREGIDO — PASS, validado visualmente por el usuario en Samsung SM-S938B |

Ver `docs/BUG_REGISTER.md` para el detalle completo de causa raíz y corrección de cada uno.
