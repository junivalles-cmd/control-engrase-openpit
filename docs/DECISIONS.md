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

## 6. Baja de `PLAN_MANTENIMIENTO_MAYOR_D8T_05-68.xlsx` del repositorio
**Decisión:** eliminado del seguimiento de Git (commit `e5af5ff`) y agregado
a `.gitignore` (`/PLAN_MANTENIMIENTO_MAYOR_D8T_05-68.xlsx`), sin restaurar el
archivo físicamente.
**Razón:** el usuario confirmó que ese archivo no pertenece al sistema
Control de Engrase — se coló en el commit baseline por estar suelto en la
misma carpeta raíz. No se usó `git reset --hard` ni `git clean`; se hizo un
commit explícito de limpieza para no reescribir el commit baseline.
**Verificación:** tras la baja, se revisó el resto de la raíz del repositorio
en busca de otros archivos evidentemente ajenos (`.xlsx`, `.xls`, `.docx`,
`.pptx`, PDFs administrativos) y no se encontró ninguno más.

## 7. Arquitectura recomendada para la fuente única (FASE 1)
**Decisión:** recomendar la Opción A (`CONTROL_ENGRASE_WEB` como fuente
canónica, `www` generado automáticamente por script) como siguiente fase
ejecutable, dejando la Opción C (Vite + TypeScript, `src/`+`public/`→`dist/`)
documentada como destino final para una fase posterior, no inmediata.
**Razón:** el análisis con hashes SHA-256 (ver
`docs/PLAN_UNIFICACION_WEB_ANDROID.md`, sección 3) mostró que el código de
negocio ya es 100% idéntico entre `CONTROL_ENGRASE_WEB` y `www` — el riesgo
real no es que estén desincronizados hoy, sino que nada impide que se
desincronicen mañana por depender de una copia manual. Automatizar esa copia
resuelve el riesgo real sin tocar GitHub Pages, Capacitor, ni ningún archivo
de negocio, cumpliendo las restricciones explícitas de "evitar una
reescritura" y "minimizar el riesgo de romper el sistema actual". Adoptar
Vite/TypeScript de inmediato (Opción C) mezclaría ese cambio de bajo riesgo
con uno de alto riesgo (nuevo sistema de build, nuevo flujo de publicación),
que es más seguro separar en una fase posterior y validada aparte.
**Esta es una decisión de análisis, no ejecutada:** no se creó ningún script,
no se movió ningún archivo. Ver plan detallado en
`docs/PLAN_UNIFICACION_WEB_ANDROID.md`.

## 8. Modularización JS: scripts clásicos, no ES modules (sin Vite todavía)
**Decisión:** los archivos nuevos de `src/core/` (turnos, horómetro, estado
de engrase, criticidad de anomalías) se escribieron como scripts clásicos
comunes (sin `export`/`import`), cargados con `<script src="...">` en
`index.html` antes de `app.js` — exactamente el mismo patrón que ya usan
`db.js`/`sync.js`/`app.js`. Sus funciones quedan disponibles como globales
compartidos entre todos los scripts de la página, así que `app.js` no
cambió ni un solo punto de llamada.
**Razón:** se evaluó usar ES modules nativos (`<script type="module">`,
soportados sin bundler por navegadores modernos y por el WebView de
Capacitor), pero habría obligado a convertir `app.js` también a módulo o a
mantener un puente global igual de manual que la alternativa elegida, con
más riesgo de romper el orden de carga de los `<script>` de terceros
(Chart.js, xlsx, jsPDF, QRious, jsQR, OneSignal) — más cambio del que esta
fase pedía explícitamente ("no gran refactor", "no introduzcas una
estructura de imports que rompa index.html/GitHub Pages/Capacitor").
**Consecuencia aceptada:** `sw.js` tuvo que actualizarse (se agregaron las
4 rutas nuevas a la lista de precaché `ASSETS`) para que el modo offline
siga sirviendo estos archivos — es el único punto donde esta fase tocó el
Service Worker, y solo se agregaron entradas a una lista de datos, sin
tocar su lógica de cacheo/fetch/activate. Ver `docs/MODULARIZATION.md`
para el detalle completo, incluida la tabla de riesgo por función.

## 9. Corrección de ENGRASE-001 sin coerción de tipos
**Decisión:** `statusFor()` ahora exige `Number.isFinite(equipment.hourmeter)`
— un `number` real y finito — antes de calcular el estado de engrase. Un
horómetro `undefined`, cadena de texto (incluida una numérica como
`"1200"`), `NaN`, u otro tipo se trata como dato inconsistente, sin excepción.
**Razón:** el pedido explícito fue evitar "coerción peligrosa" que pudiera
repetir el patrón que causó el bug original (donde comparaciones implícitas
trataban `null`/`""` como `0`, ocultando el problema en vez de señalarlo).
`Number.isFinite()` no convierte nada — es la opción más simple, explícita
y sin excepciones, aunque signifique que un horómetro que llegue como
string numérico también se marque como inconsistente (el formulario real
siempre entrega un `number`, así que ese caso no debería ocurrir en uso
normal; si llega como string, es en sí mismo una señal de dato corrupto).
