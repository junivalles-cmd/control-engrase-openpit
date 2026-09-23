# VALIDACIÓN MANUAL — BASELINE WEB + ANDROID (post FASE A3)

Fecha de preparación: 2026-09-23
Rama: `migration-typescript`
Objetivo: confirmar, con pruebas humanas reales, que la sincronización
automática (`CONTROL_ENGRASE_WEB` → `www` → `npx cap sync android` →
build debug) no rompió nada, antes de avanzar a cualquier limpieza o
migración adicional.

**Ningún resultado en este documento fue inventado.** Todo lo marcado
`PASS`/`FAIL` en las tablas de abajo debe venir de una prueba manual real
hecha por el usuario. Hasta que eso ocurra, todo queda en `NO PROBADO`.

---

## APK de depuración a instalar

```
C:\Users\Planificador\Documents\CONTROL_ENGRASE\CONTROL_ENGRASE_APP_ANDROID\android\app\build\outputs\apk\debug\app-debug.apk
```

Generado por `./gradlew assembleDebug` en la FASE A3. **No es un APK firmado
de producción** — está firmado con el keystore de depuración genérico que
genera Android Studio/Gradle automáticamente (`~/.android/debug.keystore`),
no con `engrase-key.jks`.

---

## Análisis de App Links con el APK DEBUG (antes de pedir la prueba)

Se comparó el certificado real de cada keystore contra el SHA-256 que exige
`.well-known/assetlinks.json`:

| Keystore | SHA-256 |
|---|---|
| `assetlinks.json` (esperado) | `BA:66:FD:8B:F6:5E:B9:9C:21:12:A9:61:F3:91:F6:16:40:A6:0B:F0:66:49:31:F8:F3:CD:B1:DE:54:47:69:57` |
| `engrase-key.jks` (release, producción) | `BA:66:FD:8B:F6:5E:B9:9C:21:12:A9:61:F3:91:F6:16:40:A6:0B:F0:66:49:31:F8:F3:CD:B1:DE:54:47:69:57` ✅ coincide |
| `~/.android/debug.keystore` (usado por `assembleDebug`) | `7D:D0:E9:BE:D0:4C:33:87:C7:D1:E4:70:CB:72:53:79:B5:AD:3C:92:04:F0:AC:15:1F:58:5A:74:BE:56:CB:A7` ❌ NO coincide |

- `package id` (`applicationId`) es el mismo en ambos casos: `com.conequisa.engraseopenpit` — eso no es el problema.
- `android/app/build.gradle` no define un `signingConfig` propio para `debug`, así que usa el keystore de depuración genérico que Android Studio/Gradle crea automáticamente por máquina — nunca el mismo certificado que `engrase-key.jks`.
- `assetlinks.json` fue generado correctamente contra el keystore de **producción**, no contra depuración — esto es lo esperado y correcto para cuando se publique la app real; simplemente significa que el APK debug no puede usarse para validar App Links.

**Conclusión: App Links queda BLOQUEADO EN DEBUG.** El caso AND-27 no se
puede pasar con este APK sin importar qué tan bien esté configurado todo lo
demás — es una limitación esperada del build de depuración, no un bug.
Verificar App Links de verdad requerirá, más adelante, un build firmado con
`engrase-key.jks` (fuera de alcance de esta fase — no se genera APK de
producción aquí).

---

## Cómo instalar el APK de prueba

**Prioridad 1 — ADB (disponible en este entorno):**

```
"C:\Users\Planificador\AppData\Local\Android\Sdk\platform-tools\adb.exe" devices
```

para confirmar que tu teléfono aparece en la lista (con depuración USB
activada y el cable conectado, aceptando el diálogo "¿Confiar en esta
computadora?" si aparece). Ahora mismo no hay ningún dispositivo conectado
(`adb devices` devuelve la lista vacía), así que el primer paso es
conectarlo.

Una vez que el teléfono aparezca en `adb devices`, instalar con:

```
"C:\Users\Planificador\AppData\Local\Android\Sdk\platform-tools\adb.exe" install "C:\Users\Planificador\Documents\CONTROL_ENGRASE\CONTROL_ENGRASE_APP_ANDROID\android\app\build\outputs\apk\debug\app-debug.apk"
```

**Alternativa — Android Studio:** abrir el proyecto
(`CONTROL_ENGRASE_APP_ANDROID\android`), seleccionar el dispositivo USB en la
barra de dispositivos, y usar "Run" con la configuración `app` (build
`debug`).

### Riesgo de pérdida de datos al instalar

- Si en tu teléfono **no** hay ya una versión instalada de "Control de
  Engrase" con el mismo `applicationId` (`com.conequisa.engraseopenpit`), la
  instalación es segura — no hay nada que perder.
- Si **ya existe** una versión instalada firmada con `engrase-key.jks`
  (producción) o con otro certificado, `adb install` (sin `-r` forzado
  entre certificados distintos) o Android Studio pueden pedir desinstalar
  primero, porque Android no permite reemplazar una app firmada con un
  certificado distinto sin desinstalar la anterior. **Desinstalar borra
  IndexedDB y todos los datos locales guardados en el teléfono.**
- **Por eso: si Android te pide desinstalar la versión existente para poder
  instalar la de depuración, DETENTE y avísame antes de aceptar.** Yo no
  voy a ejecutar esa desinstalación por mi cuenta.
- Si no hay ninguna versión previa instalada, no hay nada que decidir — se
  instala directo.

---

## VALIDACIÓN WEB

Fuente a probar: `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\index.html`
(servida por HTTP, no abierta como `file://`, para que el Service Worker
pueda registrarse).

| # | Caso | Resultado | Observaciones |
|---|---|---|---|
| WEB-01 | Abrir aplicación | NO PROBADO | |
| WEB-02 | Login | NO PROBADO | |
| WEB-03 | Dashboard | NO PROBADO | |
| WEB-04 | Equipos | NO PROBADO | |
| WEB-05 | Plan de engrase | NO PROBADO | |
| WEB-06 | Registrar engrase | NO PROBADO | |
| WEB-07 | Horómetro | NO PROBADO | |
| WEB-08 | Anomalía | NO PROBADO | |
| WEB-09 | Historial | NO PROBADO | |
| WEB-10 | Matriz semanal | NO PROBADO | |
| WEB-11 | Reportes | NO PROBADO | |
| WEB-12 | QR | NO PROBADO | |
| WEB-13 | Manifest e íconos | NO PROBADO | (verificado por archivo/hash en FASE A3, pendiente confirmación visual) |
| WEB-14 | Service Worker | NO PROBADO | |
| WEB-15 | Cerrar navegador y volver a abrir | NO PROBADO | |
| WEB-16 | Funcionamiento offline | NO PROBADO | |
| WEB-17 | Volver online y sincronizar | NO PROBADO | |

Valores permitidos en "Resultado": `PASS`, `FAIL`, `NO PROBADO`.

---

## VALIDACIÓN ANDROID

APK: ver ruta arriba. Requiere dispositivo físico o emulador con Android
conectado (actualmente ninguno detectado por `adb devices`).

| # | Caso | Resultado | Observaciones |
|---|---|---|---|
| AND-01 | Instalar APK debug | NO PROBADO | |
| AND-02 | Abrir aplicación | NO PROBADO | |
| AND-03 | Login | NO PROBADO | |
| AND-04 | Dashboard | NO PROBADO | |
| AND-05 | Equipos | NO PROBADO | |
| AND-06 | Registrar engrase | NO PROBADO | |
| AND-07 | Guardar horómetro | NO PROBADO | |
| AND-08 | Crear anomalía | NO PROBADO | |
| AND-09 | IndexedDB conserva datos | NO PROBADO | |
| AND-10 | Cámara | NO PROBADO | |
| AND-11 | Adjuntar fotografía | NO PROBADO | |
| AND-12 | Escanear QR | NO PROBADO | |
| AND-13 | Trabajar sin internet | NO PROBADO | |
| AND-14 | Registrar engrase offline | NO PROBADO | |
| AND-15 | Cerrar aplicación estando offline | NO PROBADO | |
| AND-16 | Abrir aplicación todavía offline | NO PROBADO | |
| AND-17 | Confirmar que el registro sigue presente | NO PROBADO | |
| AND-18 | Recuperar internet | NO PROBADO | |
| AND-19 | Sincronización del registro pendiente | NO PROBADO | |
| AND-20 | Verificar que no se duplique | NO PROBADO | |
| AND-21 | Segundo plano → primer plano | NO PROBADO | |
| AND-22 | Cierre forzado → reapertura | NO PROBADO | |
| AND-23 | OneSignal | NO PROBADO | |
| AND-24 | Notificación local | NO PROBADO | |
| AND-25 | Turno nocturno | NO PROBADO | |
| AND-26 | Cambio de fecha durante turno nocturno | NO PROBADO | |
| AND-27 | App Links | BLOQUEADO EN DEBUG | Certificado del APK debug no coincide con el que exige `assetlinks.json` (ver análisis arriba). Requiere un build firmado con `engrase-key.jks` para probarse de verdad; fuera de alcance de esta fase. |

Valores permitidos en "Resultado": `PASS`, `FAIL`, `NO PROBADO`, `BLOQUEADO`.

---

## Qué hacer con los resultados

Cuando el usuario reporte los resultados reales (uno por uno o en bloque),
se actualizará:

- Este documento (`docs/MANUAL_VALIDATION.md`), con el resultado real y
  observaciones de cada caso.
- `docs/TEST_MATRIX.md`, con el resumen.
- `docs/MIGRATION_STATUS.md`, con el estado general.

Si aparece cualquier `FAIL`, la migración se detiene en ese punto, se
registra como bug en `docs/BUG_REGISTER.md` con severidad `P0`/`P1`/`P2`/`P3`
según impacto, y no se avanza hasta resolverlo o decidir explícitamente
seguir con una excepción documentada.

Si todo lo crítico pasa, se crea un commit de documentación
(`test: record web and android baseline validation`) y, solo entonces, se
propondrá — sin crearlo todavía — un tag local `baseline-web-android-unified`.
