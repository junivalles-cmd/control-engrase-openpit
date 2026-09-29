# P0-3 — Storage privado/autenticado (`engrase-photos`)

Estado: **preparado, NO aplicado**. El bucket sigue público en producción.
Nada de este documento ni del código que describe cambia el comportamiento
visible hoy — es la preparación para cuando se autorice explícitamente el
cutover de Storage (después del cutover de Auth/RLS, ver
`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`).

## 1. Auditoría — estado actual (confirmado en código, sin tocar producción)

- Bucket `engrase-photos`: **público** (`public = true`), creado fuera de
  este repo (dashboard de Supabase). El SQL original que lo creó y sus 3
  policies está documentado en `docs/AUTH_RLS_MIGRATION_DESIGN.md` §10:
  lectura pública sin restricción, subida/actualización "con anon key" (que
  en la práctica es pública también — la anon key vive en el bundle del
  cliente).
- `sync.js` construye la URL a mano (`fetch` directo, sin SDK de Supabase):
  `${cfg.url}/storage/v1/object/public/${PHOTO_BUCKET}/${path}` — nunca usa
  `getPublicUrl()`/`createSignedUrl()` de `@supabase/supabase-js` porque esa
  librería no se usa en este proyecto.
- **Uploads** (`Sync.uploadPhotoIfNeeded`/`Sync.uploadSignatureIfNeeded`,
  ambos genéricos para CUALQUIER store con campo `.photo`/`.photos`/
  `.signatureLocal` — no solo evidencia operativa):
  - path = `` `${store}/${row.id}_${i}.${ext}` `` (fotos) o
    `` `${store}/${row.id}.${ext}` `` (firma, un solo archivo).
  - Hasta este lote, `Authorization` era siempre `cfg.anonKey` — nunca el
    JWT real, a diferencia de `engrase_sync` (ya arreglado en P0-2).
  - El registro LOCAL conserva el base64 completo PARA SIEMPRE (nunca se
    borra) — la copia "para el servidor" (con la URL) nunca se guarda local,
    solo se envía. `pullAll()` además preserva el base64 local si ya existe
    y lo que llega del servidor es solo un link (ver sync.js, comentario
    "Si ya tenemos localmente las fotos completas...") — el offline-first
    real ya estaba bien resuelto antes de este lote, no se tocó esa parte.
- **Descarga/visualización**: siempre `<img src="valorGuardado">` directo,
  sin pasar por ningún mecanismo de autenticación — funciona hoy porque el
  bucket es público. Sitios reales que usan esto:
  - Reportes → galería de evidencia fotográfica (`drawPhotoReport` →
    `pintarTanda()`, app.js) — engrase + anomalías, cargadas en tandas de 24.
  - Validación de engrase → firma (`openValidationDetailModal`/
    `openValidationConflictModal`, app.js).
  - Miniaturas de puntos de checklist (`lubrication_plans`) y diagramas de
    ayuda de familia de equipo (dentro del store `settings`, documento
    `help_content`) — **NO son evidencia operativa**, son contenido de
    referencia configurado por un Administrador.

## 2. Clasificación de contenido en el bucket

| Contenido | Store (prefijo del path) | ¿Es evidencia? |
|---|---|---|
| Fotos de engrase | `lubrication_records/` | Sí |
| Fotos de anomalías | `anomalies/` | Sí |
| Firma de validación | `grease_validations/` | Sí — **contenido sensible/identificable** |
| Fotos de puntos de checklist (plan) | `lubrication_plans/` | No — referencia, configurada por Admin |
| Diagramas de ayuda de familia de equipo | `settings/` (doc `help_content`) | No — referencia, configurada por Admin |

## 3. Diseño objetivo

- Bucket **privado**. Lectura/escritura solo con sesión Auth real (JWT) →
  policy de `storage.objects` → autorizado.
- Nunca `service_role` en el cliente (ya era así, no cambia).
- Nunca una URL pública permanente nueva. Para ver un archivo: **signed URL
  temporal** (`POST /storage/v1/object/sign/<bucket>/<path>`, expira en 1h
  por defecto).
- El signed URL **nunca se persiste** (ni en IndexedDB ni en el payload que
  se sube a `engrase_sync`) — se pide de nuevo cada vez que hace falta
  mostrar la imagen.

## 4. Compatibilidad con registros existentes (decisión clave)

**No se cambió el formato de escritura.** `uploadPhotoIfNeeded`/
`uploadSignatureIfNeeded` siguen guardando la URL pública completa
(`.../storage/v1/object/public/<bucket>/<path>`), exactamente igual que
antes — para TODOS los stores, no solo los 3 de evidencia.

¿Por qué, si el pedido pedía "preferir que nuevos registros guarden
`storagePath`"? Porque cambiar el formato de escritura HOY habría obligado
a actualizar TODO sitio que hace `<img src="${row.photo}">` (miniaturas de
checklist, diagramas de familia — ver tabla arriba) para que supieran
resolver un path suelto en vez de una URL — con riesgo real de romper
alguno en silencio, ANTES de que el bucket siquiera se vuelva privado. En
vez de eso:

- `resolvePhotoStoragePath(value)` (sync.js) **extrae** el path desde la
  URL pública ya guardada (o lo acepta tal cual si en el futuro se decide
  escribir un path suelto — el modelo ya lo soporta). Así el "storagePath"
  siempre es derivable de inmediato desde cualquier valor guardado, viejo o
  nuevo, sin migrar ni un solo registro.
- `Sync.getSignedPhotoUrl(value, cfg)` usa ese resolver internamente —
  funciona igual para una URL guardada hace un año que para una subida hoy.

Esto es la "función compatible" que pedía el punto 5 del pedido original —
implementada como resolución en el momento de leer, no como migración de
datos.

## 5. Auth en Storage (mismo criterio que `engrase_sync`, P0-2)

`syncAuthHeaders(cfg)` (ya existía para `engrase_sync`) ahora también
gobierna las 3 requests de Storage:

- `uploadPhotoIfNeeded()` / `uploadSignatureIfNeeded()` (subida).
- `getSignedPhotoUrl()` (firmado para lectura).

En `AUTH_MODE='legacy'` (hoy, en producción): siempre `cfg.anonKey`, sin
ningún cambio de comportamiento. En `AUTH_MODE='supabase'` con sesión
válida: el JWT real de la persona, nunca el anon key. Sin sesión válida en
modo supabase: `getSignedPhotoUrl()` devuelve `null` sin hacer ninguna
request (mismo gate que `pushAll()`/`pullAll()`) — nunca hay fallback anon.

## 6. Offline

Sin cambios — ya funcionaba bien (ver §1). `resolveEvidenceSrc()` (app.js)
es la única pieza nueva del lado de lectura: si el valor es base64
(`data:image...`), se muestra directo, **sin ninguna request de red** —
la foto/firma local sigue viéndose sin internet exactamente igual que hoy.

## 7. Dónde se conectó `getSignedPhotoUrl()`

**Actualizado — gap cerrado** (lote PIN+sync+storage, post a4ba3e9): las
dos pantallas documentadas abajo como "NO conectado" ya están resueltas.

Conectado (evidencia operativa + todo renderer directo del mismo bucket):

- `openValidationDetailModal()` / `openValidationConflictModal()` — la
  firma, tratada como contenido sensible.
- `drawPhotoReport()` → `pintarTanda()` — galería de Reportes (fotos de
  engrase + anomalías), resuelta por tanda de 24 (se mantiene el
  lazy-loading existente, nunca se piden cientos de signed URLs de golpe).
- `pointRow()` (miniatura de un punto de checklist en Plan de Engrase →
  Configurar) — `openPlanForm()` resuelve todos los puntos en paralelo
  antes de armar la lista.
- `familyCardHTML()` (diagrama de familia de equipo + miniaturas de sus
  puntos, "Ayuda y soporte") — `renderAyuda()` resuelve todas las familias
  en paralelo.
- `photoThumbsHTML()`/`resolvePhotoThumbSrcs()` (fotos de engrase/anomalías
  en Historial por equipo, Historial global y Anomalías) — cada tabla
  resuelve las filas visibles en paralelo antes de dibujarse.

**Limitación conocida restante (documentada a propósito, NO cerrada):** el
editor de familias de equipo (`openFamilyEditForm()`, solo Administrador —
la vista previa al editar una familia existente) sigue usando el valor
crudo directo. Es una superficie admin-only, de uso poco frecuente (editar
una familia ya creada), con mayor complejidad de refactor (formulario con
re-render en caliente al agregar/quitar zonas/puntos) — se prioriza cerrar
primero las pantallas de uso diario/multi-rol. Mientras el bucket siga
público (estado actual) funciona igual que hoy; antes de aplicar 0005 hace
falta aplicarle el mismo tratamiento.

## 7b. Reintento único + placeholder + cache (§38-40 del pedido original)

- **Cache en memoria** (`Sync._signedUrlCache`, nunca IndexedDB): dentro de
  la ventana de vigencia (expiresIn menos 60s de margen) reutiliza la misma
  URL sin pedir otra; `force: true` la ignora.
- **`evidenceValueAttr(rawValue)`** — marca cada `<img>` de evidencia con
  `data-evidence-value="<valor crudo>"` (nunca el signed URL ya usado).
- **`wireEvidenceImgFallbackOnce()`** — un único listener de `error` a nivel
  de documento (capturado, ver por qué en el propio código: `error` en
  `<img>` no burbujea), wireado una vez en `boot()`. Primer fallo de
  cualquier `<img>` marcado: pide un signed URL nuevo (`force: true`) y
  reintenta; si ese reintento también falla, reemplaza el `<img>` por un
  placeholder ("Imagen no disponible sin conexión") — nunca un ícono de
  imagen rota, nunca un segundo reintento (sin loop).
- Cubre TODAS las pantallas de §7 de una sola vez (un solo listener a nivel
  de documento) — no hace falta wirear cada pantalla por separado.

## 8. Firmas — tratamiento especial

`grease_validations.signatureUrl`/`signatureLocal` es la única evidencia
"identificable" de por sí (una firma manuscrita). Se prioriza siempre la
copia local (`signatureLocal`, base64) cuando existe; si no, se pide un
signed URL — nunca se muestra la URL pública cruda una vez el bucket sea
privado. Cubierto en `openValidationDetailModal()`/
`openValidationConflictModal()` (ver §7) y probado en
`tests/ui/storage-privacy-evidence.spec.js` (bloque "G").

## 9. Roles y policies de Storage — por qué SIN granularidad por rol

`app_store_permissions` (0002) modela permisos por store para FILAS de
`engrase_sync` — no es directamente reutilizable para objetos de Storage
sin romper algo: `settings` (donde vive `help_content`, los diagramas de
familia) tiene `can_read = false` para VISOR/LUBRICADOR/SUPERVISOR/
PLANIFICADOR en esa matriz, pero **"Ayuda y soporte" es una pantalla visible
para cualquier rol** — aplicar la matriz tal cual a Storage bloquearía esa
pantalla para casi todos los roles reales, una regresión real y no
buscada.

Diseñar la granularidad correcta requeriría auditar TODOS los prefijos de
path del bucket primero (no solo los 3 de evidencia) — fuera de alcance de
este lote. La política preparada (`0005_storage_privacy_PREPARED.sql`) usa
en cambio `current_app_active()` sola: **cualquier persona con una cuenta
Auth real y un `app_profile` activo puede leer y subir cualquier objeto del
bucket** — sin distinción de rol. Hoy Storage no tiene NINGUNA distinción
de rol (es público); esto ya es una mejora real de privacidad sin inventar
una granularidad que el modelo actual no aplica en ningún lado.

## 10. Reportes / carga por tandas

Sin cambios de comportamiento visible: `POR_TANDA = 24` se mantiene tal
cual, `pintarTanda()` ahora resuelve los signed URLs de la tanda actual en
paralelo (`Promise.all`, nunca uno a la vez) antes de insertar el HTML —
nunca se piden signed URLs de fotos que todavía no se muestran.

## 11. Cache / Service Worker

`sw.js` no cachea nada relacionado a fotos/firmas de usuario (solo
ASSETS estáticos de la app) — confirmado, sin cambios necesarios. Ningún
signed URL se guarda en ningún lado más allá de la variable local que lo
usa para pintar un `<img>`.

## 12. Migration preparada

`supabase/migrations/0005_storage_privacy_PREPARED.sql` +
`0005_storage_privacy_ROLLBACK.sql` — **NO aplicadas**. Ver el propio
archivo para el detalle completo y el orden de precondiciones (requiere el
cutover de Auth/RLS ya aplicado primero).

## 13. Tests

- `tests/unit/storage-privacy.test.js` — `resolvePhotoStoragePath()`,
  `Sync.getSignedPhotoUrl()` (éxito, sin sesión, offline/base64, sin
  config, falla de red, `!resp.ok`, nunca persiste, cache en memoria +
  `force`), headers de Storage con JWT real vs. anon key (legacy),
  reintento tras fallo.
- `tests/ui/storage-privacy-evidence.spec.js` — `resolveEvidenceSrc()` +
  `openValidationDetailModal()`/`openValidationConflictModal()` reales
  (Playwright), firma local vs. remota, conflicto con 2 firmas resueltas en
  paralelo sin mezclarse.
- `tests/ui/storage-privacy-gap-closure.spec.js` — `pointRow()`/
  `familyCardHTML()`/`photoThumbsHTML()`/`resolvePhotoThumbSrcs()` reales
  (Playwright) resolviendo signed URLs; reintento único + placeholder
  (`wireEvidenceImgFallbackOnce()`) con fallas de red simuladas vía
  `page.route().abort()` (determinista, sin depender de timing de DNS).
- `tests/ui/grease-validation.spec.js` / `tests/ui/mis-engrases-flow.spec.js`
  actualizados (agregan `resolveEvidenceSrc` a la extracción; sin
  regresiones — el fallback silencioso a la URL original cuando `Sync`/
  `DB.getConfig` no existen en esos mocks mantiene el comportamiento
  anterior exacto).

## 14. Producción

Nada de este lote tocó producción: sin SQL ejecutado, sin bucket
modificado, sin objetos borrados/movidos, sin deploy, sin push.
