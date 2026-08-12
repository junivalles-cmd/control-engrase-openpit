# Guía completa — Control de Engrase Open Pit
### Desde cero: nada instalado → web funcionando + app Android instalada

Esta guía asume que no tienes nada preparado todavía. Sigue las partes en orden.
No hace falta hacer todo en un solo día — puedes parar después de cada parte.

---

## PARTE 0 — Cuentas que vas a necesitar (todas gratis)

Créalas ahora, te ahorra ir y venir después:

1. **GitHub** (github.com) — para publicar la web
2. **Supabase** (supabase.com) — la base de datos remota
3. **Cuenta de Google** — la vas a necesitar para Android Studio y, más adelante, Firebase

---

## PARTE 1 — Instalar herramientas en tu computadora

### 1.1 Node.js
- Ve a **nodejs.org** → descarga la versión **LTS**
- Instálalo con las opciones por defecto (Next, Next, Next)
- Verifica: abre una terminal (Windows: busca "cmd" o "PowerShell"; Mac: busca "Terminal") y escribe:
  ```
  node -v
  ```
  Debe mostrarte un número de versión, no un error.

### 1.2 Android Studio
- Ve a **developer.android.com/studio** → descarga para tu sistema operativo
- Instálalo con las opciones por defecto ("Standard")
- Ábrelo la primera vez y déjalo terminar de descargar componentes (barra de progreso, 10-15 min)

---

## PARTE 2 — Base de datos remota (Supabase)

1. Entra a **supabase.com** → crea un proyecto nuevo (elige una contraseña de base de datos y guárdala)
2. Espera 1-2 minutos a que termine de crearse
3. Descomprime el archivo **CONTROL_ENGRASE_WEB.zip** que te compartí
4. Dentro encontrarás el archivo **`schema.sql`** en la raíz del zip
5. En tu proyecto de Supabase: menú lateral → **SQL Editor** → pega todo el contenido de `schema.sql` → **Run**
6. Ve a **Project Settings → API** → copia dos datos, los vas a necesitar más adelante:
   - **Project URL**
   - **anon public key**

---

## PARTE 3 — Publicar la versión web (GitHub Pages)

1. En **github.com**, crea un repositorio nuevo con el nombre **exacto**: `tu-usuario.github.io`
   (reemplaza "tu-usuario" por tu nombre de usuario real de GitHub — este nombre especial hace que se publique en la raíz de tu dominio, no en una subcarpeta)
2. En la página del repositorio: **Add file → Upload files** → arrastra **todos** los archivos que están dentro de `CONTROL_ENGRASE_WEB.zip` (ya descomprimido) — deben quedar en la raíz del repo, no dentro de una subcarpeta
3. Asegúrate de subir también el archivo `.nojekyll` (aunque esté vacío) y la carpeta `.well-known` — sin `.nojekyll`, GitHub puede saltarse archivos importantes
4. **Commit changes**
5. Ve a **Settings → Pages** → confirma que la rama sea `main` y la carpeta `/ (root)` → espera 1-2 minutos
6. Tu web va a quedar en: `https://tu-usuario.github.io/`
7. Ábrela y confirma que carga la pantalla de login de la app

---

## PARTE 4 — Conectar la web a la base de datos

1. En tu web recién publicada, entra como **Administrador** (usuario demo: PIN `1111`)
2. Ve a **Configuración → Sincronización**
3. Pega la **Project URL** y la **anon public key** que copiaste en la Parte 2
4. **Guardar y probar conexión** — debe decir "Conexión exitosa"

---

## PARTE 5 — Compilar la app de Android

**Si ya habías creado la carpeta `android/` en una sesión anterior** (para actualizar el ícono que se veía mal, por ejemplo): solo necesitas correr `npm install`, luego `npm run icons`, luego `npx cap sync android`, y recompilar en Android Studio — no hace falta borrar ni empezar de cero.

1. Descomprime **CONTROL_ENGRASE_APP_ANDROID.zip** en una carpeta de tu computadora
2. Abre una terminal **dentro de esa carpeta** (en el Explorador de Windows, escribe `cmd` en la barra de direcciones; en Mac, clic derecho → Nueva terminal en la carpeta)
3. Instala las dependencias:
   ```
   npm install
   ```
4. Crea el proyecto Android:
   ```
   npx cap add android
   ```
5. Genera el ícono nativo real de la app (esto es lo que faltaba antes — sin este paso, Android usa un ícono de plantilla genérico sin importar qué archivos tengas en `www/`):
   ```
   npm run icons
   ```
   Esto lee el archivo `assets/icon.png` que ya viene en el proyecto y genera automáticamente todos los tamaños que Android necesita.
6. Configura que el QR (y cualquier link a la web) abra la app instalada en vez del navegador:
   ```
   npm run applinks
   ```
   Solo hace falta correrlo una vez — si alguna vez borras la carpeta `android` y la vuelves a crear desde cero, corre este paso de nuevo.
7. Copia los archivos de la app al proyecto Android:
   ```
   npx cap sync android
   ```
8. Abre el proyecto en Android Studio:
   ```
   npx cap open android
   ```
   (si no abre solo, abre Android Studio manualmente → Open → selecciona la carpeta `android` dentro de tu proyecto)
9. Espera el "Gradle Sync" (barra de progreso abajo, puede tardar varios minutos la primera vez)
10. **Build → Generate Signed Bundle / APK...** → elige **APK** → Next
11. Como no tienes un keystore todavía, dale **Create new...**
    - Guarda el archivo `.jks` en un lugar seguro
    - Pon una contraseña y **anótala** — la necesitas para futuras actualizaciones de la app
    - Llena los datos (nombre, organización — pueden ser genéricos)
12. Elige **release** → Finish
13. Espera a que compile. Notificación abajo a la derecha: "APK(s) generated successfully" → clic en **"locate"** → ahí está tu `app-release.apk`

---

## PARTE 6 — Instalar la app en el celular

1. Manda el `.apk` al celular (WhatsApp a ti mismo, correo, o cable USB)
2. Ábrelo desde el celular
3. Te va a pedir permiso para "instalar apps de orígenes desconocidos" la primera vez — acéptalo
4. Instalar

---

## PARTE 7 — Conectar la app (Android) a la misma base de datos

1. Abre la app recién instalada, entra como Administrador
2. **Configuración → Sincronización** → pega la misma URL y anon key de la Parte 2
3. Guardar y probar conexión
4. Como ya tienes datos en la web (Parte 4), al conectar aquí se van a descargar automáticamente — no hay que repetir nada

---

## PARTE 8 — Primeros ajustes dentro de la app (ya con todo instalado)

Con el Administrador, antes de dar la app a tu equipo:

1. **Usuarios** → crea las cuentas reales de tus lubricadores, supervisores, planificador (cambia los PIN de demo)
2. **Configuración → Cuadrillas** → ajusta o crea las cuadrillas reales
3. **Configuración → Ubicaciones/Flotas** y **Categorías de equipo** → ajusta si hace falta
4. **Equipos → Importar desde Excel** → sube tu inventario real (o créalos manualmente)
5. **Plan de Engrase** → configura los puntos de engrase por equipo (o usa "Importar puntos de engrase desde Excel")
6. **Configuración → Turnos y umbrales generales** → ajusta horarios de turno si no son 6am/6pm
7. Prueba el flujo completo tú mismo: registra un engrase de prueba, repórtalo, revisa que aparezca en Reportes

---

## PARTE 9 (opcional, para después) — Notificaciones push por celular

Esto no es necesario para que la app funcione — es una mejora aparte. Cuando quieras activarla, sigue el archivo **`GUIA_NOTIFICACIONES_PUSH.md`** que ya te compartí, que explica cómo conectar Firebase.

---

## Resumen de lo que vas a tener al final

- Una web funcionando en `https://tu-usuario.github.io/`
- Una app instalada en los celulares de tus lubricadores
- Ambas conectadas a la misma base de datos en Supabase — lo que se registra en una se ve en la otra
- Todo funciona sin internet y sincroniza solo al recuperar conexión

Si te trabas en cualquier paso, dime exactamente en cuál y qué mensaje de error te sale, y seguimos desde ahí.
