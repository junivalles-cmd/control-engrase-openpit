# Gateway de ejecución — Fase 2A, preparado localmente

Base: `b7ef2b3`, rama `migration-typescript`. No ejecutado en producción.

## Traza y límites

Se revisaron completos `startGreaseFlow`, `openEditGreaseRecordForm`,
`completeGreaseAssignmentForOccurrence`, `createAutoAnomalies`,
`evaluateAnomalyActions`, `stamp`, `Sync.pushAll`, el upload de fotos,
los helpers de ocurrencias/completitud y la resolución de firmas.

Antes: record, equipo, plan, auditoría y asignación se guardaban por separado.
El registro usaba reversión manual ante errores; completar assignment tenía
un catch independiente y podía fallar después de guardar. El editor guardaba
record/equipo/plan sin una transacción común. Sync enviaba esas filas mediante
INSERT/PATCH genéricos con `_pushedVersion` como CAS.

Ahora: record, efectos sobre horómetro/referencias de plan, completion de
assignment y su intent se guardan juntos en una transacción IndexedDB. La RPC
aplica esas mismas escrituras más auditoría y recibo en una transacción
PostgreSQL. Se conservan los IDs existentes y el modelo de versiones.

Operaciones independientes:

- Fotos: watermark existente antes de IndexedDB, upload autenticado a Storage
  antes de RPC. Solo URLs viajan a SQL. Fallo de upload conserva el intent;
  retry no vuelve a estampar. Binarios y políticas de Storage no se rediseñan.
  Un upload exitoso seguido de una RPC rechazada puede dejar un objeto sin
  referencia remota; su limpieza requiere una fase independiente.
  Fotos de EDIT usan la clave del operation ID existente en lugar de la del
  record: evita sobrescribir bytes de la versión anterior antes del rechazo
  por firma. No cambia bucket, API ni políticas de Storage.
- Anomalías: observaciones propias del equipo/punto, sin FK a record. La
  decisión de negocio y el transporte existente permanecen independientes.
  Su creación/repetición no cambia ciclos ni assignment. No se concede U
  adicional. La autorización restringida de anomalías corresponde a Fase 2B.
  Si falla su guardado local se avisa en consola y el detalle operativo sigue
  conservado en el record; recuperación de ese seguimiento queda pendiente.
- Notificaciones: posteriores al commit local, no parte del estado canónico.
- Validaciones: store independiente; sync espera a que el record haya sido
  confirmado. No se implementa RPC de firmas ni resolución de conflictos.
- Skips: siguen siendo eventos separados y nunca pasan por esta RPC.

## Contrato

`public.lubrication_execution(...) RETURNS jsonb`, con acción explícita
`CREATE` o `EDIT`. Sin argumentos `store`, `payload`, rol, identidad Auth,
nombre de capturador, location, frequency ni campos maestros.

Parámetros obligatorios (los valores opcionales se envían como null):

| Grupo | Parámetros | Tipo |
| --- | --- | --- |
| Operación | operation_id, action, record_id | text |
| Referencias | equipment_id, plan_id, crew_id, assignment_id | text |
| Fecha declarada | execution_date, client_captured_at | timestamptz |
| Contexto | shift_id, execution_type, out_of_plan_reason, performed_by | text |
| Flags | retroactive, no_hourmeter | boolean |
| Lectura/consumo | hourmeter, quantity | numeric |
| Entrada | no_hourmeter_reason, lubricant_id, condition, notes | text |
| Checklist | details | jsonb, array de objetos con claves cerradas |
| Evidencia | photos | jsonb, máximo 5 URLs HTTPS; sin binarios |
| CAS | expected_record, expected_equipment, expected_plan, expected_assignment | timestamptz |

Los nombres HTTP tienen prefijo `p_`. El servidor valida IDs, existencia,
estado activo, pertenencia del plan/equipo/puntos, cantidad, checklist,
motivo fuera de plan, turno declarado, occurrence y estado de assignment.
Normaliza nombres de puntos desde catálogo/historial, no desde texto enviado.
Los detalles no admiten claves adicionales ni razones estructuradas arbitrarias.

Identidad: `auth.uid()` → `app_profiles` activo → rol y permiso I/U del record.
Los efectos estrechos sobre equipment/plan se delegan mediante ese permiso
de ejecución, sin exigir ni conceder U genérico en esos stores. Completar
assignment exige además U de `lubrication_assignments`.

El servidor determina `capturedByAuthUserId`, `capturedByAppUserId`,
`capturedAt`, `createdBy`, nombre del capturador y autor de auditoría.
En retroactivos ADMIN/PLANIFICADOR, `performed_by` puede señalar un usuario
legacy existente; esto no cambia Auth ni el capturador verificado.

`date` y `createdAt` conservan las fechas declaradas de ejecución/captura
local para no cambiar el historial/KPI offline o retroactivo. No son prueba
de reloj confiable. `capturedAt`, completion y auditoría usan reloj servidor.
Las versiones `updated_at` son monotónicas frente a bases antiguas que
contengan timestamps futuros; no se usan como reloj de autorización.

Calendario operativo: America/Managua; turnos desde `settings/general`,
con defaults existentes 6/18. La ventana de edición del lubricador se valida
contra el día de ejecución y tiempo servidor, nunca contra la hora del retry.
Una edición offline que llega después de su ventana se conserva bloqueada
para revisión; no se extiende la autorización confiando en hora del cliente.

## Scope previo a 0008

No se consulta `crew_locations`. ADMIN/PLANIFICADOR mantienen alcance global.
SUPERVISOR/LUBRICADOR requieren membresía vigente en `cuadrillas.memberUserIds`,
crew activa, ubicación legacy válida y coincidencia con equipo maestro.
La selección de crew es una referencia que se verifica; nunca autoridad.
Si no se selecciona crew, solo se deriva cuando hay exactamente una membresía.
PLANNED exige única crew default válida; la ambigüedad se rechaza.
Assignment no amplía ubicación, aunque exista y haya sido creado por jefatura.
No se mueve ningún equipo ni se borra assignment.

El scope se vuelve a verificar también antes de devolver un recibo de retry.
No hay datos productivos inferidos ni verificación del caso real 80-177.

## Reglas preservadas y edición

Registro: mismo cálculo de COMPLETE/PARTIAL por checklist. Cantidad cero
se bloquea para todo COMPLETE, incluso sin puntos. Esta es una corrección de
negocio autorizada explícitamente durante Fase 2A: todo COMPLETE requiere
cantidad >0 lb tanto en registro como en edición futura. Registros históricos
COMPLETE +0 lb no se modifican, migran ni reciben cantidades inventadas.
Cliente muestra «Un engrase completo debe registrar una cantidad de grasa
mayor a 0 lb.» y servidor devuelve COMPLETE_REQUIRES_GREASE. PARTIAL/SKIP
conservan sus reglas. Ciclo por horas avanza solo con COMPLETE; PARTIAL no resetea.
Sin horómetro, el registro conserva la lectura del equipo y el motivo;
`lastGreaseDateNoHm` sigue su rama existente. Retroactivos anteriores a otro
record no pisan el equipo; un retroactivo nunca baja su lectura actual.

Early completion replica hoy/mañana, exactamente una candidata, no +2 días,
ni ambigüedad ni PARTIAL. La consulta conserva el universo de records que
usa actualmente el helper; no cambia su cálculo. La occurrence se calcula
antes del avance de referencia, incluso para ASSIGNED/OUT_OF_PLAN.

Assignment: solo PENDING de equipo/occurrence/crew correctos; completion
modifica status, completedAt, completedRecordId y updatedAt. Se conserva
el comportamiento existente de completion por occurrence también para
registro parcial; no reasigna, cancela ni cambia la identidad del trabajo.

Editor: hourmeter, greaseType, qty, condition, notes, details y fotos.
No cambia equipo, autor, fecha, plan original, snapshots, executionType,
assignment, flag retroactivo ni estado sin horómetro. El editor por fin
reutiliza `canAdvanceHourCycle` para impedir que un PARTIAL reinicie horas;
la rama antigua de edición no aplicaba esa regla aunque registro sí.
Si es el record más reciente se aplican únicamente sus efectos permitidos.

Decisión humana de esta fase: **una o más firmas activas → SIGNED_RECORD_LOCKED**,
también ADMIN. Cliente informa el bloqueo y servidor lo impone. No elimina,
modifica ni desvincula firmas ni modifica la versión firmada. Corrección
auditada mediante nueva versión se diseñará aparte.

## Cola, versiones y retry

`app_config` guarda `execution:<operationId>`; no agrega stores sincronizados
ni cambia DB_VERSION. CREATE reutiliza record.id; EDIT usa el generador uid
existente con prefijo gedit. Actor local identifica a quién pertenece el
intent; servidor obtiene identidad únicamente del JWT.

Las filas afectadas tienen `_executionOperationId` y nunca salen por POST/PATCH
genérico. La cola se ordena por dependencias. Un nuevo engrase/edición offline
puede depender de operaciones previas sobre equipo/plan/record/assignment.
El ACK canónico resuelve sus expected versions en una transacción local.
No pisa ediciones posteriores; cambios de catálogo concurrentes conservan
su delta sobre la versión canónica. Los marcadores de transporte no se
aceptan como datos canónicos del servidor.

Si ya había una modificación independiente de equipo/plan/assignment antes
de abrir el engrase, primero debe sincronizarse por su flujo autorizado.
`CATALOG_SYNC_REQUIRED` conserva el formulario/borrador y las filas previas;
no absorbe ni pierde esa modificación maestra, ni la envía por la RPC.
Esto no impide encadenar varias ejecuciones offline sobre catálogo confirmado;
las dependencias entre ejecuciones sí están soportadas. El gateway no sustituye
la gestión offline de catálogos, que queda fuera de esta fase.

Antes de dispatch se persisten URLs y el request exacto (`frozen`). Retry
reenvía ese request sin variaciones. El recibo privado, PK(Auth UID,operationId),
compara la solicitud completa y devuelve el resultado canónico original.
Reutilizar ID con contenido diferente devuelve IDEMPOTENCY_CONFLICT.
Fallos parciales de Storage no congelan ni envían base64 a SQL.

CAS exige todas las bases referenciadas. VERSION_CONFLICT/assignment conflict
y denegaciones semánticas quedan BLOCKED, conservando datos y respuesta.
SIGNED_RECORD_LOCKED es terminal, visible y no se reintenta automáticamente.
La respuesta incluye versión original y referencias canónicas autorizadas;
se restituye la versión oficial local y sus efectos cuando aún pertenecen
al intento rechazado. El intento completo permanece en la cola para revisión;
ediciones posteriores del mismo record también se bloquean, sin borrar firmas.
HTTP 404/5xx o red caída quedan RETRYABLE; jamás degradan a escritura genérica.
Respuesta canónica incompleta no consume el intent. Logout/expiración impiden
dispatch/ACK fuera de sesión; Quick Unlock local no autoriza la RPC.
Otra cuenta no puede reproducir el intent de quien lo capturó.

Compatibilidad: rutas ajenas a este slice conservan transporte previo, incluidos
pendientes históricos que no tienen intent. **No convertir esos pendientes
por inferencia**: antes de desplegar/cutover hay que auditar y conciliar colas
viejas, backups/imports y clientes antiguos, y cerrar el acceso genérico en
las fases siguientes. Esta migración no retira las policies existentes ni
certifica el cutover 0003 completo.

## Seguridad y despliegue

`SECURITY DEFINER`, `search_path=pg_catalog`, tablas schema-qualified, sin
SQL dinámico. EXECUTE revocado a PUBLIC/anon, concedido solo a authenticated.
Recibos tienen RLS y ningún privilegio PUBLIC/anon/authenticated. Consultas
al perfil y autorización preceden cualquier escritura.

La RPC usa un lock conservador SHARE ROW EXCLUSIVE de `engrase_sync` para
serializar con firmas/REST existentes. Una firma concurrente no puede entrar
entre comprobar firmas y editar el record. El bloqueo también serializa
escrituras de otros equipos: limitación de rendimiento a medir antes de
producción. Un protocolo por equipo exige que todos los escritores de firmas
participen; no se introduce unilateralmente en Fase 2A.

`0009` es el siguiente número libre después de 0008; su independencia funcional
de 0008 es explícita. Puede prepararse/probarse sin aplicar 0008. No modifica
0003, 0007, 0008 ni app_store_permissions.

Orden futuro, sujeto a autorización: validar SQL y clientes en entorno de
prueba, disponer endpoint y grants, probar roles, luego distribuir Web/APK.
**Nunca distribuir este cliente antes del endpoint**. La ausencia de endpoint
mantiene intents pendientes; no habilita fallback. Cutover/0008 son pasos
separados y siguen sin autorización de ejecución.

Rollback preparado: revoca EXECUTE a authenticated; conserva función, recibos,
auditoría y datos. Detener primero clientes nuevos. No restituye escrituras
genéricas ni destruye evidencias.

## Verificación local

`node tools/validate-lubrication-gateway.mjs`: PGlite ya disponible localmente;
alternativamente indicar `PGLITE_MODULE_PATH` a un módulo instalado. No cambia
package.json, no usa credenciales ni red; crea solo fixtures en memoria.
Comprueba ACL, perfiles/roles/permisos, scope/membresías/ambigüedad, campos,
COMPLETE/PARTIAL/early, CAS, assignment, firmas/ADMIN, retry, rollback atómico,
retroactivos, reloj/versiones y rollback preparado.

`tests/unit/execution-gateway.test.js` ejecuta el adaptador real y el DTO
extraído. `tests/ui/execution-gateway.spec.js` usa IndexedDB real del navegador
con datos sintéticos y transporte interceptado. El formulario real comparte
el helper de producción de extracción; no reimplementa reglas de negocio.
No se ejecuta la suite Playwright completa ni SQL remoto.

Resultados locales de cierre (2026-10-12): 42 escenarios SQL, 1529 unitarios
en 95 archivos y 198 casos Playwright dirigidos en 390/412/1366, todos verdes.
Después se repitieron los 21 casos del gateway con el cache de fotos original
y precisión UTC hasta microsegundos: verdes. Typecheck, build y verify:dist
correctos; lint:css sin errores y con 98 warnings preexistentes (CSS no cambió).
Las dirigidas iniciales de Fase 2A/regla de cantidad pasaron 197 casos; la
comprobación de equivalencia de versiones del cache se agregó después y quedó
incluida en los 1529 unitarios finales. No hubo pruebas productivas ni validación
de carga/concurrencia con conexiones PostgreSQL múltiples.
