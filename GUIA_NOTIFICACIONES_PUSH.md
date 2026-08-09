# Cómo activar las notificaciones push (Firebase + Supabase)

Esto es lo único que falta para que las notificaciones lleguen aunque nadie
tenga la app abierta. Se hace UNA sola vez.

## Parte 1 — Crear el proyecto de Firebase

1. Ve a **console.firebase.google.com** → "Agregar proyecto" → nómbralo (ej.
   "control-engrase-openpit") → puedes desactivar Google Analytics, no hace falta.
2. Dentro del proyecto: ícono de Android → "Agregar app" →
   - **Nombre del paquete Android**: escribe exactamente `com.conequisa.engraseopenpit`
     (el mismo que usaste en PWABuilder/Capacitor)
   - Descarga el archivo **google-services.json** que te da al final.
3. En tu proyecto Capacitor (esta carpeta), copia ese archivo a:
   `android/app/google-services.json`
   (la carpeta `android/` la crea `npx cap add android` — si no la has corrido
   todavía, corre primero `npm install` y `npx cap add android`, y luego copia el archivo).
4. Abre `android/build.gradle` y agrega esta línea dentro de `dependencies { }`:
   ```
   classpath 'com.google.gms:google-services:4.4.2'
   ```
5. Abre `android/app/build.gradle` y agrega esta línea **hasta el final del archivo**:
   ```
   apply plugin: 'com.google.gms.google-services'
   ```
6. Corre `npm install` de nuevo (para bajar el plugin `@capacitor/push-notifications`
   que ya está en el `package.json`) y luego `npx cap sync android`.
7. Recompila el `.apk` en Android Studio como ya sabes hacerlo.

## Parte 2 — Generar la cuenta de servicio (para que el servidor pueda enviar)

1. En Firebase Console → ⚙️ (Configuración del proyecto) → pestaña
   **"Cuentas de servicio"**.
2. Botón **"Generar nueva clave privada"** → descarga un archivo `.json`.
3. Ábrelo con un editor de texto. Necesitas 3 valores de ahí:
   - `project_id`
   - `client_email`
   - `private_key`

## Parte 3 — Desplegar las funciones en Supabase

Necesitas la CLI de Supabase instalada (`npm install -g supabase`).

1. En una terminal, dentro de la carpeta de tu proyecto (donde está la carpeta
   `supabase/` que te entregué):
   ```
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   ```
   (el `TU_PROJECT_REF` lo ves en la URL de tu proyecto de Supabase)

2. Configura los 3 datos de Firebase como "secrets" (nunca se suben al código):
   ```
   supabase secrets set FIREBASE_PROJECT_ID=el_project_id_de_firebase
   supabase secrets set FIREBASE_CLIENT_EMAIL=el_client_email_de_firebase
   supabase secrets set FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----"
   ```
   (copia el `private_key` completo, tal cual viene en el JSON, entre comillas)

3. Despliega las dos funciones:
   ```
   supabase functions deploy notify-push
   supabase functions deploy notify-vencidos
   ```

## Parte 4 — Conectar el aviso automático de anomalías

1. En el Dashboard de Supabase: **Database → Webhooks → Create a new hook**.
2. Tabla: `engrase_sync`. Evento: **Insert**. Tipo: **Supabase Edge Functions**.
   Función: `notify-push`.
3. Guardar.

Desde ese momento, cada vez que se guarda una fila nueva en esa tabla (lo que
incluye engrases, anomalías, equipos, todo), se llama la función — ella misma
revisa adentro si es una anomalía o no, así que no hay que filtrar nada más
aquí.

## Parte 5 — Aviso diario de equipos vencidos (opcional)

1. **Database → Cron Jobs → Create a new cron job**.
2. Horario: el que quieras, ej. `0 7 * * *` (todos los días 7:00 AM).
3. Función a llamar: `notify-vencidos`.

## Cómo probar que funciona

1. Abre la app instalada en un celular con un usuario Administrador — debería
   pedir permiso de notificaciones la primera vez.
2. En **Configuración → Notificaciones push**, deberías ver ese dispositivo
   listado después de un momento (se sincroniza solo).
3. Desde otro usuario (Lubricador), reporta una anomalía de prueba.
4. Al Administrador le debería llegar la notificación en unos segundos —
   aunque tenga la app cerrada.

Si algo no llega, revisa en Supabase → Edge Functions → notify-push → Logs,
ahí se ve el error exacto.
