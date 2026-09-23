# LÍNEA BASE — FASE 0

Fecha de la línea base: 2026-09-23
Commit baseline: `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc` (rama `master`)
Rama de trabajo creada a partir de la línea base: `migration-typescript`

Este documento describe el estado EXACTO del proyecto en el momento en que se
protegió con Git, antes de cualquier intento de unificación de frontends.
Ningún archivo fue movido, copiado, renombrado ni modificado para llegar a
este estado — es una fotografía de lo que ya existía.

## Fuentes de código identificadas

### 1. FUENTE WEB ACTUAL (versión original, publicada en GitHub Pages)
```
CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB
```
Contiene `index.html`, `app.js`, `db.js`, `sync.js`, `styles.css`, `sw.js`,
`manifest.json`, íconos, `OneSignalSDKWorker.js`, `.well-known/assetlinks.json`,
`supabase/` (Edge Functions `notify-push` y `notify-vencidos`), scripts SQL
(`schema.sql`, `borrar_datos_prueba.sql`, `LIMPIAR_DATOS_DE_PRUEBA.sql`) y
documentación (`ESTADO_DEL_PROYECTO.md`, guías, manuales PDF).

### 2. COPIA MANUAL PARA CAPACITOR (mantenida a mano)
```
CONTROL_ENGRASE_APP_ANDROID\www
```
Copia byte a byte del frontend web anterior, mantenida manualmente para que
Capacitor tenga un `webDir` propio. Contiene el mismo conjunto de archivos
(`index.html`, `app.js`, `db.js`, `sync.js`, etc.) que la fuente web actual.
No hay ningún script ni proceso automático que sincronice `www` desde
`CONTROL_ENGRASE_WEB`: la copia se hace a mano.

### 3. COPIA GENERADA POR CAPACITOR (build artifact)
```
CONTROL_ENGRASE_APP_ANDROID\android\app\src\main\assets\public
```
Generada automáticamente por `npx cap sync android`, que copia el contenido
de `www` (el `webDir` declarado en `capacitor.config.json`) dentro del
proyecto Android, y además agrega ahí mismo los archivos propios de Capacitor
(`cordova.js`, `cordova_plugins.js`, `plugins/`, `capacitor.config.json`,
`capacitor.plugins.json`). Se puede regenerar en cualquier momento ejecutando
`npx cap sync android` de nuevo — nunca se edita a mano.

## Configuración de Capacitor

```
CONTROL_ENGRASE_APP_ANDROID\capacitor.config.json
```
```json
{
  "appId": "com.conequisa.engraseopenpit",
  "appName": "Control de Engrase",
  "webDir": "www",
  "backgroundColor": "#14171A",
  "android": { "allowMixedContent": false },
  "server": { "androidScheme": "https" }
}
```
`webDir: "www"` confirma que Capacitor toma `CONTROL_ENGRASE_APP_ANDROID\www`
como única fuente para generar `android\app\src\main\assets\public`.

## Cadena de dependencia actual

```
CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB   (fuente original, GitHub Pages)
        │
        │  (copia manual, sin automatizar)
        ▼
CONTROL_ENGRASE_APP_ANDROID\www           (webDir de Capacitor)
        │
        │  npx cap sync android (automático, regenerable)
        ▼
CONTROL_ENGRASE_APP_ANDROID\android\app\src\main\assets\public   (build artifact)
```

## Objetivo futuro (NO ejecutado en esta fase)

El objetivo a futuro es tener **una sola fuente de código** que sirva tanto a:
- **Web / GitHub Pages** (despliegue actual de `CONTROL_ENGRASE_WEB`)
- **Capacitor / Android Studio** (app empaquetada de `CONTROL_ENGRASE_APP_ANDROID`)

eliminando la necesidad de mantener `www` como copia manual. Esa unificación
requerirá decidir una estructura común, posiblemente con herramientas de build
(Vite, TypeScript, etc.), pero **eso queda fuera del alcance de esta fase**.
Esta fase (FASE 0) solo protege el estado actual con Git para poder avanzar
con seguridad más adelante.
