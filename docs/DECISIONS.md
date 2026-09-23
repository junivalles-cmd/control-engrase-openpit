# DECISIONES — FASE 0

## 1. Raíz del repositorio Git
**Decisión:** `C:\Users\Planificador\Documents\CONTROL_ENGRASE` (carpeta que
contiene tanto `CONTROL_ENGRASE_WEB` como `CONTROL_ENGRASE_APP_ANDROID`).
**Razón:** proteger ambas versiones actuales bajo el mismo historial desde el
inicio, sin favorecer una sobre la otra antes de decidir cómo unificarlas.

## 2. Exclusión de `android\app\src\main\assets\public`
**Decisión:** excluida del control de versiones.
**Evidencia que respalda la decisión:**
- Es contenido copiado automáticamente por `npx cap sync android` a partir de
  `www` (declarado como `webDir` en `capacitor.config.json`). No se edita a
  mano — cualquier cambio ahí se pierde en el siguiente `cap sync`.
- El propio Capacitor, al agregar la plataforma Android, generó
  `CONTROL_ENGRASE_APP_ANDROID\android\.gitignore`, y ese archivo **ya**
  excluye explícitamente `app/src/main/assets/public`,
  `app/src/main/assets/capacitor.config.json`,
  `app/src/main/assets/capacitor.plugins.json` y
  `app/src/main/res/xml/config.xml`. Esta es la convención estándar de
  cualquier proyecto Capacitor/Cordova, no una decisión arbitraria de esta
  fase.
- Android Studio no depende de que esa carpeta esté en el repositorio para
  compilar: la genera Gradle/Capacitor en cada sync/build a partir de `www`.
  Versionarla solo duplicaría contenido que ya vive en `www` y generaría
  conflictos de merge sin aportar nada.
**Lo que esto NO significa:** no se está decidiendo todavía cuál será la
fuente única a futuro (`www` vs. `CONTROL_ENGRASE_WEB` vs. una carpeta nueva).
Solo se excluye un artefacto de build, consistente con cómo el propio
ecosistema Capacitor ya trata esa carpeta.

## 3. Exclusión de material de firma (`*.jks`, `*.keystore`, `CONTRASENA_KEYSTORE.txt`)
**Decisión:** excluidos del control de versiones, pero **NO eliminados del
disco**.
**Razón:** `engrase-key.jks` es la clave privada de firma de la app Android;
`CONTRASENA_KEYSTORE.txt` contiene su contraseña en texto plano. Versionar
cualquiera de los dos —incluso en un repositorio local sin remoto— crea el
hábito de que ese material termine expuesto el día que se agregue un
`git remote` o se comparta el repositorio. Se mantiene el archivo físico
intacto en `CONTROL_ENGRASE_APP_ANDROID\` para que Android Studio y los
procesos de firma sigan funcionando sin cambios.
**Pendiente de revisión humana:** confirmar si esta contraseña ya se usó
para firmar builds de producción; si es así, no requiere rotación solo por
este cambio (el archivo nunca estuvo en Git), pero conviene guardar una copia
de respaldo del `.jks` y su contraseña fuera del repositorio (gestor de
contraseñas o almacenamiento cifrado), ya que si se pierde no se puede volver
a firmar actualizaciones de la misma app en Play Store.

## 4. Clave anónima de Supabase hardcodeada en `sync.js`
**Decisión:** se deja tal cual, versionada, sin acción en esta fase.
**Razón:** es la "anon public key" de Supabase, diseñada por Supabase para
vivir en código cliente; la seguridad real depende de las políticas de Row
Level Security (RLS) configuradas en la base de datos, no de ocultar esta
llave. Clasificada como CLIENTE/PÚBLICO.
**Pendiente de revisión humana:** confirmar que las tablas expuestas vía esta
key tienen RLS activado y políticas correctas — ver `docs/BUG_REGISTER.md` /
seguimiento aparte si se detecta algo. Esto es una recomendación de
seguridad general, no un bloqueante para el control de versiones.

## 5. Nombre de la rama de trabajo
**Decisión:** `migration-typescript`, creada desde el commit baseline sobre
`master`.
**Razón:** instrucción explícita para esta fase; todavía no implica que la
migración a TypeScript esté decidida o en curso — solo reserva el nombre de
rama para cuando se planifique ese trabajo.
