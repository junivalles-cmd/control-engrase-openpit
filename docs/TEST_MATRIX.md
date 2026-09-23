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
| BUG-004 | Lubricador ve la tabla de escritorio en vez de sus tarjetas tras sincronizar (route-mapping) | CORREGIDO EN CÓDIGO — pendiente de validación funcional del usuario |

Ver `docs/BUG_REGISTER.md` para el detalle completo de causa raíz y corrección de cada uno.

## FASE A4 — NOTIF-ANDROID-001: separar OneSignal Web vs. nativo (2026-09-23)

| Prueba | Resultado |
|---|---|
| Suite automatizada completa | PASS (82 → 88/88, 6 pruebas nuevas: `tests/unit/notificaciones-plataforma.test.js`) |
| `initWebPush()` crea `<script>` del SDK Web solo sin `window.Capacitor` | PASS (test unitario) |
| `initWebPush()` NO crea `<script>` con `window.Capacitor` presente | PASS (test unitario) |
| `initPushNotifications()` usa plugin nativo en Android, nunca el SDK Web | PASS (test unitario) |
| `initPushNotifications()` usa SDK Web en navegador, nunca el plugin nativo | PASS (test unitario) |
| Sin `ONESIGNAL_APP_ID` configurado, no hace nada en ninguna plataforma | PASS (test unitario) |
| Build Android (`./gradlew assembleDebug`) | PASS |
| Instalación en Samsung SM-S938B (`adb install -r`) | PASS (datos preservados, `firstInstallTime` sin cambios) |
| Error `Cannot read properties of undefined (reading 'triggerEvent')` en logcat | ELIMINADO — 11 lanzamientos consecutivos sin reproducirse tras el fix completo (los primeros 2 lanzamientos justo después de subir la versión de `sw.js` aún mostraban el error viejo, por el retraso normal de actualización del Service Worker) |
| Mensaje `Incompatible browser.` (SDK Web) en logcat dentro de Android | ELIMINADO |
| Arranque general, login, pantalla inicial, sin crash | PASS (11 lanzamientos limpios; confirmado también por captura de pantalla, `docs/evidence/NOTIF-ANDROID-001_after_fix.png`) |
| Modo offline | NO RE-PROBADO en esta fase específica (ya validado PASS en la Fase A3 con los mismos archivos de precaché; esta fase solo agregó una entrada de versión a `sw.js`, sin tocar la lógica offline) |
| Push real (Web o Android) | NO PROBADO — `ONESIGNAL_APP_ID` está vacío en el código de producción actual, el envío de push está deshabilitado por configuración, no por este fix |
| Mecanismo Web de OneSignal (`initWebPush`) sigue intacto | PASS por revisión de código — no hay herramienta de automatización de navegador disponible en esta sesión, no se pudo probar en un navegador real |

## FASE A5 — Modularización JS Fase 2: Matriz Semanal y Anomalías (2026-09-23)

| Prueba | Resultado |
|---|---|
| Service Worker v24 offline (antes de tocar código, revalidación corta) | PASS — login offline, Dashboard con datos reales (badge "SIN INTERNET"), Matriz abrió sin errores, sin `FATAL EXCEPTION` en logcat |
| Suite automatizada tras extraer `estadoCelda()` | PASS (88 → 103, 15 pruebas nuevas: `matriz-estado-celda.test.js`) |
| Suite automatizada tras extraer `evaluateAnomalyActions()` | PASS (103 → 125, 22 pruebas nuevas: `anomaly-actions.test.js`) |
| `node --check` en `app.js`, `weekly-matrix.js`, `anomaly-actions.js`, `sw.js` | PASS |
| Sin duplicación de lógica (`estadoCelda`/`evaluateAnomalyActions`/`hayPuntosOAnomaliaHorometro` en un único archivo cada una) | PASS |
| `tools/sync-web-to-android.mjs --dry-run` / `--apply` (2 rondas: Matriz, luego Anomalías) | PASS — detectó los 2 archivos nuevos automáticamente, sin cambios al script |
| `npx cap sync android` | PASS — sin cambios en archivos versionados de Android fuera de `www`/`assets/public` |
| `./gradlew assembleDebug` | PASS |
| Instalación en Samsung SM-S938B (`adb install -r`) | PASS (datos preservados, `firstInstallTime` sin cambios) |
| Smoke test Android: app abre, Dashboard/Matriz/Anomalías abren con datos reales | PASS — sin `FATAL EXCEPTION` ni errores nuevos en `Capacitor/Console` |
| IndexedDB / `sync.js` / Supabase modificados | NO (ninguno de los tres se tocó) |
| Hallazgo nuevo, no relacionado con esta fase: lanzamientos con la pantalla apagada/dozing (charging lock screen de Samsung) producen brevemente `App resumed→paused→stopped` y, en algunos casos, el mismo error `Cannot read properties of undefined (reading 'triggerEvent')` — registrado como bug aparte, ver `docs/BUG_REGISTER.md` (`ANDROID-DOZE-001`) | Documentado, no bloquea esta fase (con la pantalla despierta y desbloqueada, 100% de los lanzamientos probados fueron limpios) |

## FASE VITE 1 — Build paralelo / shadow build (2026-09-23)

| Prueba | Resultado |
|---|---|
| `npm test` tras instalar Vite | PASS (125/125, sin cambios en las pruebas) |
| `npm run build` | PASS |
| 27 archivos runtime en `dist/` idénticos byte a byte a la fuente (`cmp`) | PASS |
| `dist/index.html`: mismo orden/contenido de `<script>`, solo diferencias cosméticas en `<link>` | PASS |
| `.nojekyll` en `dist/` | PASS |
| `.well-known/assetlinks.json` en `dist/` | PASS |
| `manifest.json` en `dist/` con nombre estable (sin hash) | PASS |
| `sw.js` en `dist/`, rutas de `ASSETS` todas resolubles en `dist/` | PASS |
| `src/core/*.js` (6 archivos) en `dist/` con nombre estable | PASS |
| `npm run dev`: recursos clave sirven 200 por HTTP | PASS |
| `npm run preview`: 18 recursos runtime comprobados por HTTP, 0 errores 404 | PASS |
| Interacción real en navegador (login, consola sin errores JS) | NO PROBADO — sin herramienta de automatización de navegador disponible en esta sesión |
| Prueba offline del build Vite (`dist/` online → SW → sin red → recarga) | NO PROBADO — mismo motivo; no bloquea la fase (`sw.js` no se modificó y ya está validado offline sobre la fuente canónica) |
| `capacitor.config.json` / `webDir` | SIN MODIFICAR (`"www"`) |
| `CONTROL_ENGRASE_APP_ANDROID/www` | SIN MODIFICAR |
| GitHub Pages / publicación | SIN TOCAR — nada publicado |
| Supabase / IndexedDB / `sync.js` | SIN MODIFICAR |

## Pruebas automatizadas de lógica (2026-09-23)

Ver `docs/AUTOMATED_TESTS.md` para el detalle completo (framework, estructura,
qué se prueba, qué requiere extracción). Resumen:

| Área | Resultado |
|---|---|
| Suite completa (`npm test`) | PASS — 77/77 pruebas, 8 archivos |
| Turnos (Día/Noche, cruce de medianoche) | PASS — 13 pruebas |
| Estado de engrase / horómetro por frecuencia | PASS — 12 pruebas (incluye 2 que documentan `ENGRASE-001`, un bug real descubierto y no corregido en esta fase) |
| Matriz semanal (plan por día/turno) | PASS — 7 pruebas |
| Anomalías (criticidad, no-duplicado) | PASS — 9 pruebas |
| Validación de horómetro | PASS — 8 pruebas |
| Borrado lógico `active:true/false` | PASS — 9 pruebas |
| Sincronización (reglas documentadas, sin tocar Supabase) | PASS — 8 pruebas |
| Seguridad básica (`esc`, objetos incompletos) | PASS — 11 pruebas |
| `estadoCelda()` de la Matriz Semanal, `createAutoAnomalies()`, `Sync.pushAll/pullAll/fullSync`, `DB.allActive` reales | NO PROBABLE TODAVÍA — requiere extracción durante la modularización (ver `docs/AUTOMATED_TESTS.md`) |
| Suite tras ENGRASE-001 + Modularización JS Fase 1 | PASS — 82/82 pruebas, 8 archivos |

## Validación manual en Android real — Modularización JS Fase 1 (2026-09-23)

**MODULARIZACIÓN JS FASE 1: PROBADA EN ANDROID REAL**
**SERVICE WORKER: PROBADO OFFLINE CON NUEVOS MÓDULOS**

Dispositivo: Samsung SM-S938B. APK debug recompilado tras la modularización,
instalado con `adb install -r` preservando datos (`firstInstallTime` del
perfil principal sin cambios).

| Prueba | Objetivo | Resultado |
|---|---|---|
| M1 — Login y pantalla inicial | Arranque general con los módulos nuevos cargados | PASS |
| M2 — Turno mostrado | `src/core/shifts.js` (`currentShiftId`/`dentroDeSuTurno`) | PASS |
| M3 — Estados de engrase con datos reales | `src/core/lubrication-status.js` (`statusFor`/`weekdayStatusFor`) | PASS — lógica/datos correctos (VENCIDO mostrado correctamente para equipos realmente vencidos); se encontró por separado un problema de **diseño** preexistente, no de lógica (`UI-ANDROID-005`) |
| M4 — Horómetro de un equipo | `src/core/hourmeter.js` | PASS |
| M5 — Anomalías carga normalmente | `src/core/anomalies.js` (`CRITICIDAD_POR_MOTIVO`) | PASS |
| M6 — Cierre completo y reapertura | Arranque limpio desde cero | PASS |
| OFFLINE-01 — Interfaz, turno y estados sin conexión | Precaché de `sw.js` con los 4 módulos nuevos | PASS |
| Logcat (en cada paso anterior) | Sin `FATAL EXCEPTION`, sin 404 en `src/core/*.js`, sin errores del Service Worker | PASS |

**Hallazgos durante esta validación (ambos confirmados NO relacionados con
la modularización, ver `docs/BUG_REGISTER.md`):**
- `NOTIF-ANDROID-001` (P2) — error del SDK Web de OneSignal dentro del
  WebView, preexistente, ocurre antes de que carguen los módulos nuevos.
- `UI-ANDROID-005` (P3 UX) — tabla genérica sin adaptar a tarjeta móvil en
  el Dashboard, confirmado presente desde el commit baseline `c6d6f78`.

**Nota sobre conectividad:** durante parte de esta validación, el
dispositivo no tenía internet real funcionando (confirmado por el monitor
de red del sistema) — `sync.js` reportó `Failed to fetch` de forma
esperada (comportamiento correcto offline-first), sin afectar la validación
de los módulos modularizados en sí.

## FASE VITE 2 — `dist` → Capacitor → Android (2026-09-23)

| Prueba | Resultado |
|---|---|
| `npm test` / `npm run build` (precheck) | PASS (125/125, build OK) |
| Comparación `dist` vs `www` (28 archivos runtime) | PASS — 27 idénticos por hash, solo `index.html` difiere (cosmético, ya documentado); sobrantes históricos de `www` (`icon-180.png`, `schema.sql`) correctamente NO copiados a `dist` |
| Ruta de `webDir` verificada en el código fuente de `@capacitor/cli` (no asumida) | PASS — `../dist` resuelve exactamente a `C:\Users\Planificador\Documents\CONTROL_ENGRASE\dist` |
| `npx cap sync android` usa `dist` (confirmado por su propia salida) | PASS |
| `android/app/src/main/assets/public` — 16 archivos clave idénticos por hash a `dist/` | PASS |
| `assets/public/index.html` distinto de `www/index.html` (confirma que NO vino de `www`) | PASS |
| `./gradlew assembleDebug` | PASS |
| `adb install -r` en Samsung SM-S938B, datos conservados (`firstInstallTime` sin cambios) | PASS |
| Prueba objetiva (hash) de que el APK **instalado en el dispositivo** viene de `dist`, sin texto de debug en la UI | PASS — `assets/public/index.html` del APK extraído del dispositivo (`adb pull` del `base.apk` real) coincide en SHA-256 con `dist/index.html` |
| Smoke test A01–A10 (abre, login, Dashboard, Turno, Equipos, estados de engrase, Matriz, Anomalías, Historial, Reportes) con datos reales | PASS (validado por el usuario) |
| Logcat durante todo el smoke test | Sin `FATAL EXCEPTION`, sin errores de `Capacitor/Console`, sin solicitudes locales fallidas |
| **Offline real con `dist`** (online → varias pantallas → modo avión → cierre completo → reapertura offline → login y navegación offline → vuelta a online) | **PASS** — prueba obligatoria que Fase Vite 1 había dejado NO PROBADO |
| `www` interviene en el flujo nuevo | NO — `git status` sin cambios en `CONTROL_ENGRASE_APP_ANDROID/www` en todo el flujo |
| `tools/sync-web-to-android.mjs` se ejecutó en esta fase | NO |
| `npm test` (post) | PASS (125/125, sin cambios) |
| GitHub Pages / Supabase / IndexedDB / `sync.js` | SIN MODIFICAR |
| Rollback a `www` | Documentado (3 pasos), no ejecutado (no hizo falta) |

## FASE VITE 3 — Validar `dist` para GitHub Pages (2026-09-23)

| Prueba | Resultado |
|---|---|
| `npm test` / `npm run build` (precheck) | PASS (125/125, build OK) |
| Configuración remota de GitHub Pages | Reconstruida de documentación local (no duplicada); **CONFIGURACIÓN REMOTA: NO VERIFICADA** (sin `git remote` hacia `junivalles-cmd.github.io`) |
| Inventario de `dist/` (28 archivos, mínimos pedidos + `src/core/*`) | PASS — todos presentes |
| `.nojekyll` presente, vacío, idéntico a la fuente | PASS |
| `.well-known/assetlinks.json` JSON válido, `package_name` correcto, fingerprint sin tocar, idéntico a la fuente | PASS |
| Rutas absolutas de raíz (`/algo`) en index.html/manifest/styles/sw.js | NINGUNA (todas relativas o `https://`) |
| Decisión `base: './'` confirmada correcta (dominio de usuario, sin subpath) | PASS, documentada |
| `sw.js`: las 24 rutas de `ASSETS` resuelven en `dist/`, scope raíz correcto | PASS |
| `dist/index.html` no carga el SDK Web de OneSignal de forma incondicional | PASS (`NOTIF-ANDROID-001` no reapareció) |
| `OneSignalSDKWorker.js` presente | PASS |
| `npm run preview`: 20 recursos comprobados por HTTP | PASS, 0 errores 404, Content-Type correctos |
| WEB-VITE-01 a 13 (carga, login, 8 pantallas, Service Worker, manifest/íconos, sin errores de consola) | PASS — validado por el usuario en navegador real |
| Offline Web desde `dist` (obligatoria) | PASS — validado por el usuario (SW activo → offline DevTools → recarga → shell y módulos disponibles) |
| Comparación fuente vs. `dist` (27 archivos + índex) | 27/28 idénticos byte a byte; `index.html` con diferencias cosméticas ya documentadas, sin impacto funcional |
| `npm run verify:dist` (nuevo) | PASS — y confirmado que detecta fallos reales (prueba con `.nojekyll` removido temporalmente → falla correctamente, restaurado) |
| `npm run build:web` (test+build+verify encadenados) | PASS |
| `npm test` (post) | PASS (125/125, sin cambios) |
| Android sigue usando `dist` (`capacitor.config.json` sin tocar en esta fase) | CONFIRMADO |
| GitHub Pages / Supabase / IndexedDB / `sync.js` | SIN MODIFICAR — nada publicado |
