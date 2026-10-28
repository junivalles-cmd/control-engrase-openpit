# Android release — procedimiento vigente

## Identidad y versionado

- `applicationId`: `com.conequisa.engraseopenpit` (no cambiar: conserva la
  continuidad de actualización sobre instalaciones actuales).
- Release inicial formal: `versionName 1.0.0`, `versionCode 2`.
- Cada release posterior incrementa estrictamente `versionCode`; usar una
  versión semántica nueva en `versionName`.

## SDK

La combinación vigente es `compileSdk/targetSdk 34`, verificada localmente
con Capacitor 6 y AGP 8.2.1 presentes en este proyecto. **No es apta para
nuevos envíos o actualizaciones a Google Play desde el 31 de agosto de 2026**:
Play exige target API 36. No usar la plataforma API 37 preview como sustituto.
El salto a API 36 requiere actualizar y validar en conjunto AGP, Gradle,
Capacitor y la plataforma SDK estable antes de declarar un release para Play.

## Firma de release

Nunca agregar un `.jks`, contraseñas ni `keystore.properties` al repositorio.
Copiar `CONTROL_ENGRASE_APP_ANDROID/android/keystore.properties.example` a
`keystore.properties` local, completar los cuatro campos y protegerlo como
secreto. Alternativamente, definir estas variables solo durante el build:

- `RELEASE_STORE_FILE`
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS`
- `RELEASE_KEY_PASSWORD`

`assembleRelease` y `bundleRelease` fallan explícitamente si falta alguno;
nunca producen un release firmado accidentalmente con la clave debug.

## Build y checksum

Primero generar y validar el WebView actual:

```powershell
npm.cmd run build:web
cd CONTROL_ENGRASE_APP_ANDROID
npx.cmd cap sync android
cd ..
```

Después, con la firma local ya disponible:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-android-local.ps1 -Variant release
powershell -ExecutionPolicy Bypass -File tools\build-android-local.ps1 -Variant bundle
```

El script imprime ruta, tamaño y SHA-256 del APK o AAB. El APK queda en
`android/app/build/outputs/apk/release/app-release.apk`; el AAB en
`android/app/build/outputs/bundle/release/app-release.aab`.

## Instalación y rollback

Instalar update-in-place solo tras confirmar mismo `applicationId`, firma de
release compatible y un `versionCode` mayor:

```powershell
adb -s <serial> install -r android\app\build\outputs\apk\release\app-release.apk
```

No usar `-r` con certificados distintos y no desinstalar para forzar la
instalación: borrar la aplicación elimina IndexedDB y datos locales. Si la
firma no coincide o el dispositivo no está disponible, detenerse y preservar
la versión instalada. Rollback significa instalar un APK previamente firmado
con la misma clave y cuyo `versionCode` Android acepte; validar primero en un
dispositivo de prueba y no borrar datos como atajo.
