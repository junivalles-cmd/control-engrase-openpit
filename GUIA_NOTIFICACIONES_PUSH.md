# Cómo activar las notificaciones push (con OneSignal — mucho más simple que Firebase)

Esto es lo único que falta para que las notificaciones lleguen aunque nadie
tenga la app abierta. Se hace UNA sola vez, y no necesitas escribir ningún
código — solo copiar y pegar dos llaves.

## Parte 1 — Crear tu cuenta y app en OneSignal

1. Ve a **onesignal.com** → crea una cuenta gratis
2. **New App/Website** → ponle un nombre, ej. "Control de Engrase"
3. Elige la plataforma **Google Android (FCM)**
4. Te va a pedir un "Firebase Server Key" y "Sender ID" — aquí sí hace falta un
   proyecto de Firebase, pero OneSignal te guía paso a paso dentro de su propia
   pantalla (es mucho más corto que lo que hicimos antes a mano):
   - Sigue el asistente de OneSignal, que te lleva directo a crear un proyecto
     de Firebase con 3-4 clics, sin tener que generar cuentas de servicio ni
     escribir código de autenticación — eso es justo lo que OneSignal hace por ti.
5. Cuando termine el asistente, copia el **"OneSignal App ID"** — lo vas a
   necesitar en el paso 3.

## Parte 2 — Copiar tu App ID en el código de la app

1. Abre el archivo `app.js` (dentro del proyecto que descomprimiste)
2. Busca la línea que dice:
   ```
   const ONESIGNAL_APP_ID = '';
   ```
3. Pega tu App ID entre las comillas, por ejemplo:
   ```
   const ONESIGNAL_APP_ID = '12345678-abcd-1234-abcd-1234567890ab';
   ```
4. Guarda el archivo, y súbelo tanto a tu web (GitHub) como a la carpeta del
   proyecto Android antes de recompilar el APK.

## Parte 3 — Instalar el plugin en la app Android

En la terminal, dentro de la carpeta del proyecto:
```
npm install
npx cap sync android
```
(Ya agregamos el plugin de OneSignal al `package.json`, así que `npm install`
lo baja solo.)

Recompila el APK como siempre.

## Parte 4 — Conectar el aviso automático de anomalías (en Supabase)

Necesitas la **REST API Key** de OneSignal (no la confundas con el App ID):
en tu app dentro de OneSignal → **Settings → Keys & IDs** → copia la
"REST API Key".

1. En una terminal, con la CLI de Supabase instalada (`npm install -g supabase`):
   ```
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   ```
2. Configura los 2 datos de OneSignal como secrets:
   ```
   supabase secrets set ONESIGNAL_APP_ID=tu_app_id_de_onesignal
   supabase secrets set ONESIGNAL_REST_API_KEY=tu_rest_api_key_de_onesignal
   ```
3. Despliega las dos funciones (ya vienen listas, no hay que escribir nada):
   ```
   supabase functions deploy notify-push
   supabase functions deploy notify-vencidos
   ```
4. En el Dashboard de Supabase: **Database → Webhooks → Create a new hook**
   → Tabla: `engrase_sync` → Evento: **Insert** → Tipo: **Supabase Edge
   Functions** → Función: `notify-push` → Guardar.

## Parte 5 — Aviso diario de equipos vencidos (opcional)

**Database → Cron Jobs → Create a new cron job** → horario que quieras
(ej. `0 7 * * *` para las 7 AM todos los días) → función `notify-vencidos`.

## Cómo probar que funciona

1. Abre la app instalada con un usuario Administrador — pide permiso de
   notificaciones la primera vez.
2. En **Configuración → Notificaciones push**, ese dispositivo debería
   aparecer listado después de un momento.
3. Desde otro usuario (Lubricador), reporta una anomalía de prueba.
4. Al Administrador le debería llegar la notificación en segundos, aunque
   tenga la app cerrada.

Si algo no llega: Supabase → Edge Functions → notify-push → Logs, ahí se ve
el error exacto. También puedes revisar en OneSignal → tu app → "Delivery"
para ver si el envío llegó a intentarse.
