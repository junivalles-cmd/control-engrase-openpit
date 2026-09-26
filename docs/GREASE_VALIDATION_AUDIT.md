# Validación del engrase con firma — auditoría del modelo actual + persistencia real

> **Aclaración (2026-09-25):** en una respuesta anterior este DOCUMENTO
> apareció listado como "archivo tocado" y, en la misma respuesta, se dijo
> que "grease_validations NO estaba creado aún" — no es una contradicción,
> son dos cosas distintas: el ARCHIVO `docs/GREASE_VALIDATION_AUDIT.md` sí
> existía (esta auditoría), pero la ENTIDAD/store `grease_validations` que
> describe no estaba implementada todavía. Esa segunda parte ya cambió: ver
> "Estado" abajo.

Fecha: 2026-09-25. **Estado ACTUALIZADO: `grease_validations` IMPLEMENTADO**
(store real de IndexedDB, sync real vía `sync.js`, sin campos redundantes) —
ver la sección "9. Implementación real" al final de este documento.
Lo que sigue (secciones 1-8) es la auditoría ORIGINAL que motivó las
decisiones tomadas; se conserva sin reescribir como registro de por qué se
eligió cada cosa.

## 1. `lubrication_records` — estructura real (leída de `app.js`, creación del registro)

```js
{
  id, equipmentId, planId, date, shiftId, hourmeter,
  userId, userName,                 // el LUBRICADOR que hizo el trabajo
  greaseType, qty, condition, notes, details,
  photos, photo,                    // array + primero (compat)
  sinHorometro, noHourmeterReason, retroactivo, capturadoPor, synced,
  // agregados por stamp() (db.js):
  createdAt, updatedAt, createdBy, active,
  _pushedVersion                    // agregado por sync.js al confirmar el push
}
```
Todos los datos que la pantalla de validación debe mostrar ANTES de firmar
(código/modelo del equipo, fecha/hora, lubricador, turno, horómetro,
cantidad de grasa) **ya existen** en este objeto — no falta ningún campo
para esa parte.

## 2. Roles reales del sistema — "Operador"/"Encargado" NO son roles de app

`PERMISSIONS`/`App.currentUser.role` solo reconoce `ADMINISTRADOR`,
`PLANIFICADOR`, `SUPERVISOR`, `LUBRICADOR`, `VISOR`. "Operador" y
"Encargado" (quien firma en la pantalla) son personas del lado operativo del
equipo, casi nunca con usuario en el sistema — por eso el formulario de
validación pide **nombre libre + rol (Operador/Encargado)**, no un login.
Si quien sostiene el dispositivo al momento de capturar la firma SÍ tiene
sesión (`App.currentUser`), se propone guardar `signerUserId` como metadato
de responsabilidad del dispositivo — nunca como reemplazo del nombre/firma
de la persona real.

## 3. Blobs/fotos — mecanismo YA existente, reutilizable tal cual para la firma

`app.js`: las fotos se capturan como **base64 (`data:image/...`) guardado
directo en el registro**, funcionando 100% offline (IndexedDB no tiene
límite de tipo de campo). `sync.js` (`uploadPhotoIfNeeded(store, row, cfg)`,
genérico — recibe el nombre del store como parámetro):
- Al sincronizar, sube cada foto que siga en base64 al bucket de Supabase
  Storage `engrase-photos` (`PHOTO_BUCKET`) y **reemplaza el base64 por la
  URL pública** en el campo, marcando `photoUploaded: true` para no
  reintentar.
- Si no hay internet, el base64 quedó guardado local y se reintenta en la
  próxima sincronización — offline-first real, ya probado en producción.

**La firma manuscrita (un PNG de canvas) es exactamente el mismo tipo de
dato que una foto** — la recomendación es capturarla igual: `canvas.toDataURL()`
→ base64 local → mismo `uploadPhotoIfNeeded()` (generalizado para revisar
también un campo `signature`, o reutilizando `photos` con una convención de
nombre) → URL de Storage al sincronizar. **Cero código nuevo de subida** —
se extiende el que ya existe.

## 4. `sync.js`/`db.js` — hallazgo clave: NO hay tablas separadas en Supabase

`DB_NAME='engrase_openpit'`, `STORES` es un array fijo (`db.js`), y **cada
store de IndexedDB sincroniza contra la MISMA tabla genérica de Supabase**
`engrase_sync` (`{store, id, payload, updated_at, deleted}` — visto en
`sync.js: pushAll()`, `POST .../engrase_sync?on_conflict=store,id`). Esto
significa que **agregar un store nuevo (`grease_validations`) NO requiere
crear una tabla SQL nueva en Supabase** — solo:
1. Subir `DB_VERSION` en `db.js` y agregar `'grease_validations'` a `STORES`
   (crea el `objectStore` en el `onupgradeneeded` de IndexedDB).
2. Nada más del lado de Supabase — `engrase_sync` ya lo acepta con
   `store: 'grease_validations'`.

Esto **reduce mucho el costo de la Opción B** frente a lo que parecería a
primera vista (no es "crear una tabla" en el sentido tradicional).

## 5. Soft delete / versionado — convención ya establecida, se reutiliza igual

`stamp()` (`db.js`) ya agrega `id`, `createdAt`, `updatedAt`, `createdBy`,
`active: true` a CUALQUIER objeto — `DB.allActive()` filtra `active !== false`
en cualquier store. `sync.js` usa `updatedAt` vs `_pushedVersion` para saber
qué subir, y `deleted: r.active === false` al empujar. **Una entidad
`grease_validations` heredaría este mismo mecanismo sin cambios.**

## 6. Recomendación: A (campos en `lubrication_records`) vs B (`grease_validations` separada)

**Recomendado: B — entidad separada `grease_validations`, relacionada por
`lubricationRecordId`.**

| Criterio | A: campos en el registro | B: entidad separada |
|---|---|---|
| Offline | OK, mismo objeto | OK — mismo patrón, sin diferencia real dado el hallazgo del punto 4 |
| Sincronización | **Riesgo:** el Lubricador y el validador pueden editar el MISMO row en momentos distintos (a veces offline en dispositivos distintos) → más chance de pisarse campos por `updatedAt` (last-write-wins de `sync.js`) | Cada actor escribe SU PROPIO row — nunca se pisan entre sí |
| Auditoría | Mezcla autoría del Lubricador (`userName`) con la del validador en el mismo objeto — confuso para reportes | Autoría separada y explícita por entidad |
| Revalidaciones futuras | Requeriría campos `validationHistory[]` dentro del registro (crece sin límite claro) | Naturalmente: una fila nueva por intento, `active:false` en la anterior si se corrige — mismo patrón que ya usa el resto del sistema |
| "No sobrescribir datos del lubricador" (pedido explícito) | Alto riesgo — cualquier update al registro para validar toca el mismo objeto que escribió el Lubricador | Cero riesgo — el registro del Lubricador nunca se vuelve a escribir |
| Costo de implementación | Ninguno (no toca `STORES`) | Bajo — 1 línea en `STORES` + subir `DB_VERSION` (ver punto 4, sin SQL nuevo) |

La única ventaja real de A es "cero cambio de esquema", pero el hallazgo del
punto 4 hace que el costo de B sea mínimo — y B es claramente más segura
para el requisito explícito de no perder ni pisar la autoría del Lubricador.

## 7. Esquema mínimo propuesto para `grease_validations` (NO creado todavía)

```js
{
  id,                      // uid('val'), igual que el resto
  lubricationRecordId,     // FK lógica al registro validado
  equipmentId,             // duplicado a propósito: permite listar/filtrar sin join
  signerName,              // texto libre, obligatorio
  signerRole,              // 'OPERADOR' | 'ENCARGADO'
  reason,                  // obligatorio SOLO si signerRole === 'ENCARGADO'
  signedAt,                // ISO, automático al confirmar
  validationStatus,        // 'VALIDADO_OPERADOR' | 'VALIDADO_ENCARGADO'
  signature,                // base64 local → URL de Storage al sincronizar (igual que `photo`)
  signerUserId,             // OPCIONAL: App.currentUser.id de quien capturó en el dispositivo
  // agregados por stamp(): createdAt, updatedAt, createdBy, active
}
```
`PENDIENTE_VALIDACION` NO es un estado guardado — es la ausencia de una
`grease_validation` activa para ese `lubricationRecordId` (se deriva, no se
persiste; evita un estado que pueda desincronizarse del hecho real).

## 8. Offline — confirmado que ya funciona con el patrón existente

Firma capturada offline → guardada en IndexedDB como base64 (como cualquier
foto hoy) → sincroniza cuando hay señal, subiendo a Storage y reemplazando
por URL — **sin cambios de arquitectura**, reutilizando `uploadPhotoIfNeeded()`.

## 9. Implementación real (2026-09-25) — qué cambió respecto a la auditoría

**`db.js`:** `DB_VERSION` 5→6, `'grease_validations'` agregado a `STORES`
(sincroniza igual que el resto; `onupgradeneeded` ya lo crea genéricamente,
sin código nuevo ahí).

**Esquema final guardado** (sin `validationStatus` — se deriva siempre de
`signerRole` vía `statusForSignerRole()`, nunca se guarda por separado):
```js
{
  id, lubricationRecordId, equipmentId,
  signerName, signerRole,          // 'OPERADOR' | 'ENCARGADO'
  reason,                          // solo si signerRole === 'ENCARGADO'
  signerUserId,                    // opcional, App.currentUser de quien capturó (no el firmante)
  signedAt,
  signatureLocal, signatureUrl,    // base64 local → URL remota (igual patrón que photo/photos)
  signatureUploaded,               // flag de sync, igual que photoUploaded
  // + stamp(): createdAt, updatedAt, createdBy, active (soft delete: active:false)
  // + sync.js: _pushedVersion
}
```

**`sync.js`:** nuevo `Sync.uploadSignatureIfNeeded(store, row, cfg)` —
mismo mecanismo que `uploadPhotoIfNeeded()` pero para UN campo singular
(`signatureLocal`), mismo bucket `PHOTO_BUCKET` (sin bucket nuevo), prefijo
natural `grease_validations/<id>.<ext>`. Encadenado en `pushAll()` justo
después de `uploadPhotoIfNeeded()`. `pullAll()` gana el mismo guard que ya
tenían las fotos: si el dispositivo ya tiene `signatureLocal` real, nunca lo
reemplaza por el eco del propio push (`signatureLocal:null` + `signatureUrl`).

**`app.js`:** `openValidationModal()` ahora persiste con
`DB.put('grease_validations', ...)` (offline-first: escribe en IndexedDB de
inmediato, nunca toca `lubrication_records`); re-chequea, justo antes de
guardar, que no exista ya una validación activa (máximo una por
`lubricationRecordId`, sin revalidación todavía) — si existe, cierra y abre
`openValidationDetailModal()` (solo lectura: nombre/rol/fecha/motivo/firma)
en su lugar. Dashboard e Historial leen `DB.allActive('grease_validations')`
real (ya no `App.mockValidations`, que se eliminó).

**Pendiente antes de habilitar en producción:** ver la respuesta de esta
sesión (riesgos) — nunca se ejecutó `Sync.pushAll()`/`pullAll()` contra
Supabase real, todo se probó con `DB`/`fetch` fake en memoria.

## 10. Doble validación offline/multidispositivo — auditoría (2026-09-25) → IMPLEMENTADO (2026-09-25, lote "conflictos de validación")

**Caso:** Dispositivo A offline firma `greg_1`; Dispositivo B offline TAMBIÉN
firma `greg_1`; ambos sincronizan después.

- **`id`:** `uid('val')` = `'val_' + Date.now().toString(36) + random6`. Se
  genera 100% local, sin coordinación entre dispositivos — A y B producen
  ids DISTINTOS con probabilidad prácticamente 1 (timestamp + random).
- **¿Pueden coexistir 2 filas activas con el mismo `lubricationRecordId`?**
  SÍ. Nada en IndexedDB (no hay índice único sobre `lubricationRecordId`) ni
  en `engrase_sync` (upsert por `(store,id)`, ids distintos) lo impide. El
  único guard actual es el chequeo de `openValidationModal()` justo antes de
  guardar — pero ese chequeo solo ve lo que YA sincronizó a ESE dispositivo;
  si A y B nunca se vieron entre sí antes de firmar, ambos pasan el chequeo
  y ambos crean su fila. Tras sincronizar, **ambas filas sobreviven** en
  `engrase_sync` y se descargan a ambos dispositivos — no hay
  "last-write-wins" real aquí (ese mecanismo solo aplica cuando dos escrituras
  comparten el MISMO `id`, no es el caso).
- **`findActiveValidation()` con 2 activas para el mismo registro:** devuelve
  la PRIMERA que encuentra (`Array.find`), en el orden que entrega
  `DB.allActive()` → `IndexedDB.getAll()` (orden ascendente por `id`). Como
  el `id` embebe `Date.now().toString(36)`, en la práctica esto suele
  devolver la validación creada MÁS TEMPRANO — pero es una coincidencia del
  formato del id, NO una regla explícita: relojes de dispositivo
  desincronizados o un cambio de longitud del timestamp podrían alterarlo.
  **No es una decisión de negocio, es un efecto secundario no garantizado.**
- **¿Puede una firma ocultar/sustituir silenciosamente otra?** Los DATOS
  nunca se destruyen (ambas filas quedan completas, con su firma, en
  IndexedDB y en `engrase_sync`) — pero la SEGUNDA validación (la que
  `find()` no elige) queda invisible en la UI: nadie la ve, ni hay pantalla
  que liste "todas las validaciones de un registro". Es un riesgo real de
  UX/auditoría (una firma válida existe pero no se muestra), no de pérdida
  de datos.

### Solución mínima — IMPLEMENTADA

1. `findActiveValidations(lubricationRecordId, validations)` (plural, en
   `src/core/grease-validation.js`) devuelve TODAS las activas para un
   registro, sin elegir ninguna — única fuente de verdad; `findActiveValidation()`
   (singular) y `validationStatusFor()` se apoyan en ella, nunca leen
   `validations` por su cuenta.
2. `hasValidationConflict(lubricationRecordId, validations)` = `count > 1`.
3. `findActiveValidation()` (singular) **YA NO "elige la primera"**: con 0 o
   con 2+ activas devuelve `null` a propósito — nunca resuelve un conflicto
   en silencio. `validationStatusFor()` devuelve `CONFLICTO_VALIDACION`
   (4º estado, badge tono `red`, distinto de Pendiente/ámbar y de ambos
   Validado) cuando hay 2+ activas.
4. UI: badge "Conflicto de validación" en Historial (acción "Ver conflicto"),
   `openValidationConflictModal()` en `app.js` lista TODAS las activas
   completas (nombre/rol/fecha-hora/motivo/firma) — nunca borra ni
   auto-selecciona cuál es la "correcta". El re-chequeo de
   `openValidationModal()` (justo antes de guardar) ahora distingue 0/1/2+ y
   abre el modal de conflicto en vez de crear una firma adicional si ya hay
   2+.
5. Dashboard: KPI secundario "Conflictos de validación" (solo visible si
   count > 0, `openConflictosValidacionModal()`), y "Pendientes de
   validación" ahora excluye explícitamente los registros con conflicto
   (0 activas ≠ 2+ activas — un registro con 2+ NO es "pendiente", es
   "conflicto").

No se implementó el desempate por `signedAt` en `findActiveValidation()`
mencionado como opción 4 en la propuesta original: se prefirió que
`findActiveValidation()` NUNCA devuelva una con 2+ (null explícito) en vez de
introducir un criterio de desempate que podría malinterpretarse como
"resolución" del conflicto — ver §13.

Tests: `tests/unit/grease-validation.test.js` (26/26, cubre 0/1/2+ activas en
`findActiveValidations`/`hasValidationConflict`/`findActiveValidation`/
`validationStatusFor`) y `tests/ui/grease-validation.spec.js` (conflicto vía
`openValidationModal()`, no crea una tercera firma, abre el modal con ambas).

## 11. Firma — tamaño estimado (canvas 500×180, PNG)

Estimación (no medida con una firma real — no se generó ninguna firma para
esto): bitmap crudo 500×180×4 bytes ≈ 352 KB máximo teórico; una firma es
mayormente blanco con un trazo delgado, así que PNG comprime muy bien
(rangos largos del mismo color) → **PNG típico ≈ 5-10 KB**, base64
(`signatureLocal`, +~37%) **≈ 8-15 KB por firma** (puede subir a 20-30 KB en
firmas muy complejas). **100 firmas ≈ 1-1.5 MB. 1,000 firmas ≈ 10-15 MB** —
trivial para la cuota de IndexedDB en un teléfono actual.

**Razonable ahora** (mismo orden de magnitud que ya acepta el patrón
`photo`/`photos` existente, sin quejas reportadas). **A futuro, sin
implementar todavía:** `signatureLocal` nunca se limpia en el dispositivo
que la creó (mismo comportamiento ya existente para `photo`/`photos`, no es
un problema nuevo) — si el volumen de firmas crece mucho, convendría un
criterio de limpieza (ej. borrar `signatureLocal` cuando `signatureUploaded
&& signatureUrl` están confirmados Y pasaron N días sin acceso offline), NO
antes de proponerlo explícitamente y confirmar que no rompe la vista offline.

## 12. Storage — bucket y permisos (confirmado desde `schema.sql`, NO desde Supabase real)

`schema.sql` (el que YA existe en el repo, no confirmado si está aplicado al
proyecto Supabase real) declara: bucket `engrase-photos` **público**
(`public: true`), y 3 políticas sobre `storage.objects` — `select`,
`insert`, `update` — las 3 con la ÚNICA condición `bucket_id =
'engrase-photos'`, **sin restricción de prefijo/carpeta**. Esto significa
que, TAL COMO ESTÁ DECLARADO, subir a `grease_validations/<id>.png` (el
prefijo que ya arma `uploadSignatureIfNeeded()`, reutilizando el mismo
bucket, sin bucket nuevo) debería estar permitido sin cambios de política.

**PENDIENTE DE PRUEBA REAL** — no se puede confirmar sin escribir contra el
proyecto Supabase real si: (a) este `schema.sql` efectivamente se aplicó tal
cual, o (b) alguien restringió los permisos manualmente después desde el
dashboard de Supabase. No se asume que funcionará.

## 13. Resolución de conflicto de validación — SOLO documentado, NO implementado

La detección (§10) está implementada; decidir "cuál firma es la correcta"
cuando hay 2+ activas NO. Requisitos para cuando se implemente (a futuro,
no ahora):

1. **Nunca DELETE físico** de ninguna validación: la(s) descartada(s) se
   marcan `active: false` (mismo soft-delete que ya usa el resto de la app,
   ver §5), nunca se eliminan de IndexedDB/`engrase_sync`.
2. Preservar TODAS las firmas originales completas para auditoría, incluida
   la descartada — siguen siendo consultables (no ocultas del todo), solo
   dejan de contar como "la" validación activa del registro.
3. Registrar quién resolvió el conflicto y cuándo (nuevo campo explícito,
   ej. `resolvedBy`/`resolvedAt` en la fila descartada, o una entidad de
   resolución aparte — sin decidir esto todavía).
4. Indicar cuál quedó como la validación aceptada (`active: true` restante)
   de forma explícita, nunca implícita por orden de arreglo.
5. Quien resuelve debe ser un rol con permiso para eso (a definir cuál —
   Supervisor/Administrador, no el mismo Lubricador/Operador que firmó).

No implementar esto sin volver a confirmar el flujo con el usuario: agregar
un campo o botón de "resolución" ahora sería inventar una regla de negocio
no pedida.

## 14. Regresión "Mis Engrases" → Plan del turno + baseline histórico (2026-09-25)

### Causa raíz (auditada, confirmada en código)

Tras Finalizar Engrase, los botones "Validar ahora"/"Validar después"
llamaban a `navigate(App.route)`. `navigate()` (línea ~1792 de `app.js`) es
el router de la interfaz de **escritorio**: pinta `#topbar-title`/`#sidebar`
y usa el mapa `renderers[route]` (`turno` → `renderTurno()` de escritorio,
`historial` → `renderHistorial()` de escritorio). El shell del **Lubricador**
(`.lub-shell`, `bootLubricador()`) NUNCA usa `navigate()` para su propia
navegación — tiene su propio manejador de clics que llama directo a
`renderLubricadorHome()`/`renderLubricadorHistorial()`/etc. (mismo criterio
ya documentado en `redibujarPantallaActual()`). Como el Lubricador entra a
Finalizar Engrase desde "Mi Turno" (`App.route` se queda en `'turno'` todo
el flujo, `startLubricadorGreaseFlow()` → `startGreaseFlow(id, $('#lub-flow'))`),
`navigate(App.route)` terminaba llamando a `renderTurno()` (la tabla de
escritorio "PLAN DE ENGRASE DEL TURNO – DÍA") y pintándola DENTRO del
`#app-content` del shell del Lubricador — de ahí el reporte.

**Corrección:** nueva función `irAMisEngrasesTrasRegistrar()` (`app.js`,
justo antes de `startGreaseFlow`) que detecta el shell (`document.querySelector('.lub-shell')`)
y, si es el Lubricador, fija `App.route = 'historial'` y llama directo a
`renderLubricadorHistorial()` (la vista de tarjetas "Mis Engrases" ya
existente — NO se creó una segunda versión); si es escritorio, mantiene el
comportamiento previo (`navigate(App.route)`, sin cambios). Los 2 botones de
`startGreaseFlow()` ahora llaman a esta función en vez de `navigate()`
directo.

### Baseline histórico — `GREASE_VALIDATION_ENABLED_FROM`

Punto central único en `src/core/grease-validation.js`:
`GREASE_VALIDATION_ENABLED_FROM` (ISO string o `null`). Nuevas funciones
puras: `isRecordSubjectToValidation(recordDate)`,
`validationStatusForRecord(record, validations)` (antepone el chequeo de
baseline a `validationStatusFor()`, devuelve el 5º estado
`HISTORICO_SIN_VALIDACION` — badge neutro, "Histórico · Sin validación
requerida", **sin botón Validar**) e `isRecordPendingValidation(record, validations)`
(la definición exacta de "pendiente": sujeto a validación Y 0 activas — la
usa el KPI del Dashboard). `drawHistory()` y `renderLubricadorHistorial()`
("Mis Engrases") usan `validationStatusForRecord()`, nunca
`validationStatusFor()` directo, para respetar el baseline.

**`GREASE_VALIDATION_ENABLED_FROM` queda en `null` a propósito** — no hay
fecha de salida a producción oficial todavía, y no se debía inventar una
(instrucción explícita). Mientras sea `null`, `isRecordSubjectToValidation()`
trata TODOS los registros como sujetos a validación — es decir, el
comportamiento de "Pendientes" **no cambia funcionalmente todavía** respecto
de antes de este lote (los registros antiguos seguirán apareciendo como
pendientes hasta que se configure una fecha real). El mecanismo completo
(constante + 3 funciones + toda la UI que las usa) ya está implementado y
probado — falta un solo dato antes de producción:

> **PENDIENTE DE DEFINIR POR EL USUARIO:** la fecha/hora (ISO, con zona
> horaria) desde la cual un engrase pasa a estar sujeto a validación. Debe
> asignarse a `GREASE_VALIDATION_ENABLED_FROM` en
> `src/core/grease-validation.js` antes de llevar esta funcionalidad a
> producción.

### Bug adicional encontrado y corregido de paso

`validationBadgeHTML()` no tenía mapeo para el tono `red` (usado por
`CONFLICTO_VALIDACION`) en su tabla de clases CSS — caía al mismo
`hist-compliance-neutral` que ahora usa el nuevo estado Histórico, con lo
que un conflicto y un registro histórico habrían lucido IDÉNTICOS (mismo
gris). Se agregó `red: 'hist-compliance-alert'` (clase ya existente, roja,
reutilizada de `complianceBadgeHTML()`) para que el conflicto conserve su
tono de alerta, distinto de Pendiente/Validado/Histórico.

## 15. CORRECCIÓN CENTRAL — `isRecordSubjectToValidation(null)` debía ser `false`, no `true` (2026-09-25)

### El error

§14 implementó `isRecordSubjectToValidation()` con
`if (!GREASE_VALIDATION_ENABLED_FROM) return true;` — es decir, mientras el
baseline siguiera sin configurar, **todo** registro se trataba como sujeto a
validación ("preservar el comportamiento actual, sin cambios retroactivos").
En la práctica esto hacía que el Dashboard mostrara "Pendientes de
validación" con un número grande (ej. 46) compuesto casi enteramente por
engrases históricos, de antes de que esta funcionalidad existiera — nunca
tuvieron ni podían tener una firma. El primer intento de arreglo (lote
"PULIDO FINAL — tarjetas Actividad") solo parchó la tarjeta del Dashboard
con una rama especial (`GREASE_VALIDATION_ENABLED_FROM ? conteo real : '—'`),
dejando intacto el mismo problema en Historial, Mis Engrases y Reportes —
exactamente el tipo de "excepción por pantalla" que se pedía evitar.

### La corrección

`isRecordSubjectToValidation()` ahora es:

```js
function isRecordSubjectToValidation(recordDate) {
  if (!GREASE_VALIDATION_ENABLED_FROM) return false;
  return new Date(recordDate).getTime() >= new Date(GREASE_VALIDATION_ENABLED_FROM).getTime();
}
```

Mientras `GREASE_VALIDATION_ENABLED_FROM` sea `null`, la funcionalidad de
validación se considera **NO ACTIVADA oficialmente** — ningún registro
(nuevo o viejo) es "sujeto", sin importar qué tan reciente sea. Como
`validationStatusForRecord()`/`isRecordPendingValidation()` ya delegaban en
esta función (nunca reimplementaban la comparación de fecha por su cuenta),
la corrección se propaga sola a Historial, Mis Engrases, Dashboard y
Reportes — CERO excepciones por pantalla. Se agregó además
`isRecordInConflict(record, validations)` (misma forma que
`isRecordPendingValidation()`) para que el KPI "Conflictos de validación"
del Dashboard también respete el gate central — antes usaba
`hasValidationConflict()` directo, sin chequear si el registro era
histórico, lo que podía mostrar un conflicto en el Dashboard que Historial
ya mostraba como "Histórico" (inconsistencia entre pantallas).

Se revirtió el workaround de la tarjeta del Dashboard: `dashActivityCard()`
volvió a su firma simple (`label, value, tone, action`), y "Pendientes de
validación" volvió a un solo camino
(`recordsPendientesValidacion.length`, que ahora da `0` honestamente
mientras el baseline siga en `null`, en vez de fabricar un "—" con una rama
aparte).

### Consecuencia esperada (no un bug): "Validar después" queda sin
### destino de vuelta mientras el baseline sea null

El flujo Finalizar Engrase → "Validar ahora"/"Validar después" **sigue
funcionando** (no se tocó `startGreaseFlow()`): "Validar ahora" todavía
abre el modal de firma y persiste en `grease_validations` si se firma. Pero
como TODO registro se muestra como "Histórico" mientras el baseline sea
`null`, el botón "Validar" de Historial/Mis Engrases (que depende de
`validationStatusForRecord() !== HISTORICO`) no aparece para ningún
registro — así que alguien que eligió "Validar después" hoy no tendrá,
todavía, una forma de volver a encontrar ese registro pendiente en
Historial. Esto es la consecuencia literal y esperada de "la funcionalidad
no está activada oficialmente" durante esta fase de prueba/preproducción —
no se implementó ninguna excepción para evitarlo, porque hacerlo sería
exactamente el tipo de regla especial por pantalla que se pidió eliminar.
Cuando se configure `GREASE_VALIDATION_ENABLED_FROM`, todo lo posterior a
esa fecha entra normalmente al flujo Pendiente → Validado.

### Pruebas de "Validar ahora/después" mientras el baseline sigue null

Para probar en automático las transiciones 0/1/2+ activas (que ahora
necesitan un baseline real para manifestarse en la UI), los tests definen
un baseline **explícito solo dentro de la página de prueba** —
`window.isRecordSubjectToValidation = () => true;` (o una función más
específica por fecha) — nunca se toca la constante productiva
`GREASE_VALIDATION_ENABLED_FROM` para esto. Ver
`tests/ui/mis-engrases-flow.spec.js` y
`tests/ui/historial-eq-search-flow.spec.js` (describe "Validación del
engrase") para el patrón exacto.
