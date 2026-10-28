# Instalación Android — Control de Engrase

**CURRENT.** Esta guía reemplaza las instrucciones históricas de PIN/Quick
Unlock. La versión actual usa autenticación vigente y no debe asumirse que
existe un bloqueo local de 4 horas.

Para un APK/AAB firmado y actualización de campo, seguir además
`docs/ANDROID_RELEASE.md`.

Guía para generar e instalar el APK desde el código fuente. Un solo
APK/una sola Web universal — nunca un build distinto por ubicación,
cuadrilla, turno, usuario o tipo de dispositivo.

## Prerrequisitos

- Node.js + npm (repo raíz y `CONTROL_ENGRASE_APP_ANDROID/` tienen cada
  uno su propio `package.json` — instalar dependencias en ambos con
  `npm install` si es la primera vez).
- Android SDK (platform-tools) con `adb` — típicamente en
  `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. No hace falta que
  esté en el PATH, basta con conocer la ruta completa.
- JDK 17 (JetBrains Runtime) — por defecto
  `%USERPROFILE%\.jdks\jbr-17.0.14`.
- Un dispositivo Android con depuración USB habilitada, o un emulador.

Verificar que `adb` ve el dispositivo:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
```

Debe listar el dispositivo con estado `device` (no `unauthorized` ni
vacío). Si está vacío, revisar el cable/depuración USB antes de seguir.

## 1. Build web

Desde la raíz del repo:

```powershell
npm run build
node tools/verify-dist.mjs
```

`verify-dist.mjs` debe terminar en `TODO OK`. Genera `dist/` en la raíz
del repo — es la fuente que Capacitor empaqueta (nunca se edita a mano).

## 2. Capacitor sync

Desde `CONTROL_ENGRASE_APP_ANDROID/` (tiene su propio `@capacitor/cli`,
por eso no se corre desde la raíz):

```powershell
cd CONTROL_ENGRASE_APP_ANDROID
npx cap sync android
```

Copia `dist/` a `android/app/src/main/assets/public/` y actualiza los
plugins nativos. **Después de este paso, revisar
`android/app/src/main/AndroidManifest.xml`**: `cap sync` reintroduce un
mojibake (acentos corruptos) en un comentario cerca del widget de
pantalla de inicio. Es cosmético (no afecta el APK compilado — AAPT
descarta comentarios XML), pero conviene restaurarlo antes de commitear
cualquier cambio al manifest.

## 3. Build del APK (workaround AF_UNIX ya validado)

El JDK no puede conectar sus sockets `AF_UNIX` bajo la carpeta `TEMP` de
este entorno — por eso existe `tools/build-android-local.ps1`: crea una
carpeta de sockets dedicada y corta (`node_modules/.cache/android-java-sockets`
por defecto) y le pasa esa ruta al JDK vía
`-Djdk.net.unixdomain.tmpdir`, sin tocar `TEMP`, el JDK global ni Gradle
global. Usarlo siempre en vez de `gradlew assembleDebug` directo:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-android-local.ps1
```

Parámetros opcionales: `-JdkHome <ruta>` si el JDK no está en la ruta por
defecto, `-SocketDirectory <ruta corta>` si la ruta del repo es muy larga
(el socket falla si la ruta completa supera ~108 bytes en UTF-8).

El script imprime un objeto con `APK_PATH`, `APK_SIZE` y
`BUILD_TIMESTAMP_UTC` al terminar.

### Ubicación del APK

```
CONTROL_ENGRASE_APP_ANDROID\android\app\build\outputs\apk\debug\app-debug.apk
```

## 4. Instalar en el dispositivo

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s <serial> install -r "CONTROL_ENGRASE_APP_ANDROID\android\app\build\outputs\apk\debug\app-debug.apk"
```

- **`-r` siempre** (reinstala conservando datos) para actualizar una
  instalación existente.
- **NO usar `adb uninstall`** para actualizar normalmente — borra
  IndexedDB y datos locales de la aplicación.
- **NO limpiar datos de la app** (`adb shell pm clear <appId>`, o
  Ajustes → Apps → Control de Engrase → Almacenamiento → Borrar datos)
  salvo que soporte técnico lo autorice explícitamente (ver
  `docs/SUPPORT_SYNC.md`) — es una acción destructiva para el usuario.

## 5. Verificar la instalación

```powershell
& $adb -s <serial> shell am start -n com.conequisa.engraseopenpit/.MainActivity
& $adb -s <serial> logcat -d *:E AndroidRuntime:E | Select-String "FATAL|conequisa"
```

Sin líneas `FATAL EXCEPTION` para `com.conequisa.engraseopenpit` = arrancó
bien. Una captura de pantalla (`adb shell screencap -p /sdcard/x.png` +
`adb pull`) confirma visualmente que cargó una pantalla real (no quedó en
"Cargando Control de Engrase...").

## 6. Obtener el SHA256 del APK

```powershell
Get-FileHash "CONTROL_ENGRASE_APP_ANDROID\android\app\build\outputs\apk\debug\app-debug.apk" -Algorithm SHA256
```

o en PowerShell/Bash equivalente (`sha256sum`). Comparar siempre contra el
valor documentado en `docs/RELEASE_v1.0.0-rc1.md` / `docs/evidence/` antes
de distribuir un APK — confirma que es exactamente el build esperado.
