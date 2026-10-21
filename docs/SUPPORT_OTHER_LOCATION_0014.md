# SUPPORT_OTHER_LOCATION — 0014 revisada

Preparación local PRE-0008. No autoriza instalación, SQL remoto ni publicación.
Estado de destino: 0009/0010/0012/0013 reparada/0011 ya instaladas; 0014 ausente.

## Instalación real y límites

Ejecutar primero, por el procedimiento manual autorizado, `0014_PRODUCTION_PREFLIGHT_READ_ONLY.sql`.
Revisar las seis definiciones/hash de cuerpos instalados, ownership, ocho gates,
ACL, readiness, referencias y duplicados. Una diferencia detiene la instalación;
no actualizar hashes para silenciar un drift sin revisar su definición.

El único SQL de instalación de esta entrega es
`../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql`.
Es una transacción autocontenida. Sustituye realmente `public.lubrication_execution`
y `public.evidence_operation`, además de recrear sus wrappers de evidencia con las
mismas firmas. No requiere reejecutar 0009/0010/0013, ni instalar 0007/0015/0008.
No modifica archivos de migraciones antiguas para simular una actualización instalada.

Conserva el clasificador 0013 con su OID bajo el nombre
`authorization_private.authorization_row_in_scope_baseline_0013`. Las políticas
INSERT/UPDATE/DELETE siguen apuntando a ese mismo cuerpo, sin excepciones nuevas.
Recrea únicamente `authorization_scope_select`, usando un nuevo clasificador que
añade referencias puntuales para SELECT. La matriz independiente y catalog_* de
0011 permanecen vigentes. Los tres guards `assignment_skip_rpc_*` niegan escrituras
genéricas también sobre `lubrication_records`, incluso con policies legacy PUBLIC.

El backend usa el mismo bloqueo de tabla de 0009/0010 antes de adquirir locks de
fila/advisory. CAS sigue comprobando las versiones de los objetos involucrados.
Esto serializa COMPLETE/CANCEL/REASSIGN y evita un protocolo de locks incompatible.
Las pruebas PGlite verifican transiciones, versiones obsoletas y replay; no reemplazan
una prueba de carga con múltiples conexiones PostgreSQL reales.

## Grant operacional

Se deriva del assignment persistido, activo, no eliminado y PENDING; crew/equipo/
plan/ubicaciones deben existir y estar activos; plan.equipmentId debe coincidir;
la clave debe tener prefijo exacto de plan y fecha válida o ciclo horario; no puede
haber dos assignments pendientes para la misma identidad. El actor debe pertenecer
actualmente a la crew. La metadata descriptiva nunca concede permisos.

La referencia es assignmentId + crew + equipo + plan + occurrenceKey + versión.
No se agrega Mojón a authorizedLocationIds. El manifiesto permite descargar solo
assignment/equipo/plan/puntos y la fila descriptiva de la ubicación. No concede
enumeración del destino ni operaciones de catálogo sobre él.

GLOBAL crea nuevos apoyos y el servidor establece assignmentType=SUPPORT_OTHER_LOCATION.
Supervisor no crea apoyos externos; puede cancelar/reasignar uno existente de su
crew, con destino limitado a sus propias crews autorizadas. Lubricador no gestiona
assignments. Nuevas creaciones conservan las validaciones de ocurrencia vigente de
0014; gestionar una asignación persistente no recalcula su identidad.

Los dos casos reales se reconocen por relaciones válidas y ubicación distinta aun
con metadata NULL. No hay backfill, reparación, cambio de ubicación ni IDs especiales
en lógica de autorización. Los IDs reportados solo aparecen en preflight/fixtures.

## Atención tardía, PARTIAL e histórico

ASSIGNED continúa siendo el executionType. SUPPORT_OTHER_LOCATION es el tipo de
assignment, no un cuarto executionType.

0009 valida el assignment exacto antes de aplicar la igualdad normal de ubicaciones.
Para ASSIGNED utiliza su occurrenceKey persistida. El registro conserva fecha real,
executedAt, operationalDate/shift reales y ambas ubicaciones maestras en snapshot.
assignedOccurrenceKey separa obligación atendida y momento de captura.
COMPLETE satisface exclusivamente esa clave, exige grasa >0 y completa el assignment.
PARTIAL no satisface la obligación y lo deja PENDING; puede continuarse mediante
otra ejecución del mismo assignment. SKIP conserva esa misma identidad con fecha y
turno reales, sin generar un engrase ni terminar el assignment.
Las correcciones de un registro asignado conservan su resultado COMPLETE/PARTIAL;
para terminar el trabajo parcial se registra la continuación, sin reescribir el
resultado histórico de la primera ejecución.

No se avanza el ciclo actual de un plan cuando la clave asignada es otra. La matriz,
estado DAY/NIGHT y cumplimiento excluyen un registro asignado a otra ocurrencia del
match basado únicamente en su fecha real. Una clave legacy sin turno no se convierte
en DAY/NIGHT retroactivo. Checklist, horómetro, autoría, firmas y CAS siguen activos.

authorization_private.support_links registra procedencia aceptada, escrita solo por
gateways propietarios. RLS y manifiesto no usan un snapshot enviado por cliente como
prueba histórica. Los resultados aceptados de records/skips/anomalies/validations y
las referencias mínimas para mostrarlos siguen accesibles para la crew autorizada
después de COMPLETE/CANCEL; no mantienen permiso para ejecutar nuevamente.

0010 autoriza REPORT mediante el wrapper explícito report_assignment_anomaly.
AUTOMATIC se acota a su assignment/crew y no reutiliza anomalías ajenas por compartir
equipo/punto. CAPTURE deriva autorización del record aceptado después de COMPLETE.
EDIT/CLOSE conservan owner/rol; RESOLVE/RETIRE siguen siendo de Administrador.
El replay conserva request exacto, identidad activa y autorización histórica/membresía.

## Cliente, sincronización y revocación

El manifiesto get_assignment_support_context es account-scoped. Su revisión es
independiente de authorizationFingerprint: completar un assignment no invalida la
cola de evidencia. La huella de membresías sigue siendo la autoridad de cuenta.

Cada pull obtiene referencias y las hidrata por IDs sin filtro updated_at. Comprueba
otra vez la revisión antes de publicarlas; no confirma dependencias incompletas.
Las filas de esa hidratación no adelantan el cursor incremental global.
Al revocar un grant, se reemplaza el manifiesto: DB.get/all y los filtros operativos
ocultan dependencias no autorizadas sin borrar filas, IndexedDB ni colas.
Las filas históricas admitidas permanecen en el manifiesto. El cambio de cuenta
mantiene identidad, fingerprint y etiquetas de propiedad; la selección de crew no
concede acceso.

_supportOperational es una decoración local de la relación confirmada en manifiesto;
se excluye del transporte genérico. Los RPC vuelven a validar contra datos del servidor.
El cliente elige una asignación cuando existen varias pendientes de un equipo y
transporta la identidad elegida al ejecutar/SKIP. No convierte apoyo en cobertura normal.

La revocación efectiva en servidor es inmediata al cambiar el estado. Un dispositivo
offline no puede conocer una cancelación remota antes de reconectar; el servidor
rechaza la intención obsoleta cuando se envía y el cliente conserva su cola para revisión.

## Storage y riesgo residual

0014 no cambia bucket, no elimina objetos y no amplía policies de Storage.
Las URLs firmadas se cachean por servidor/cuenta/fingerprint/revisión de grants/path.
Antes de subir imágenes de apoyo se comprueba la operación; al aceptar referencias
de fotos el gateway exige objeto propio, salvo referencias ya aceptadas de una edición.
CAPTURE mantiene comprobación de propiedad e inmutabilidad de firma de 0010.

El bucket público/lectura legacy sigue siendo un riesgo separado ANTES DEL CUTOVER.
Este paquete no promete privacidad completa de objetos ni revocación instantánea de
URLs públicas/firmadas ya emitidas o copias offline. El aislamiento de filas no corrige
por sí solo esa exposición. No desplegar una supuesta solución de privacidad del bucket
basándose solo en este cambio.

## Data API / ACL

RPC públicos authenticated, sin grants anon/PUBLIC:

- get_authorization_context() — existente, sin cambio de firma.
- get_assignment_support_context() — nuevo manifiesto.
- authorize_assignment_evidence_upload(text,text,text) — nueva comprobación booleana.
- lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz) — reemplazado.
- manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text).
- record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text).
- report_assignment_anomaly(text,text,text,text,text,text,text,jsonb,text) — nuevo REPORT puntual.
- report_anomaly, edit_anomaly, close_anomaly, retire_anomaly,
  repeat_anomaly_from_execution, capture_grease_validation,
  resolve_grease_validation_conflict — existentes, mismas firmas/roles.

NUNCA exponer el schema authorization_private. Sus tablas/helpers no son API.
resolve_authorization_scope, assignment_skip_operation y evidence_operation permanecen
sin EXECUTE para public/anon/authenticated. Los dos clasificadores de filas tienen
EXECUTE authenticated únicamente por evaluación de policies y deben permanecer fuera
de schemas expuestos. No se modificó configuración remota de Data API.

## Rollback safe-stop

El rollback pone enabled=false y revoca wrappers de assignments/skips/manifiesto/
upload, ejecución y evidencia. Conserva datos, recibos, procedencia, historial, RLS,
los ocho gates y catálogo 0011; no restaura permisos anon ni escrituras genéricas.
Es conservador: también detiene ejecución/evidencia normal. Las funciones reemplazadas
siguen instaladas. La reanudación requiere un forward fix revisado, no reejecutar 0014
ni restaurar cuerpos antiguos sobre datos nuevos. Los clientes deben detenerse antes
de ese procedimiento; no interpretarlo como rollback funcional sin interrupción.

## Validación local y límites

- Fixtures SQL con las dos relaciones reportadas: persistencia sin cambios,
  SELECT puntual, aislamiento, PARTIAL/continuación/COMPLETE tardío, SKIP, firma
  posterior, anomalías, autoría, snapshot falso, guards, CAS y replay.
- Unitarias de scope/cache/sync/ocurrencias/cumplimiento/Storage y bootstrap de cuenta.
- Playwright 390/412: IndexedDB real y Mi Turno real con datos sintéticos.
- Typecheck, sintaxis JavaScript, lint CSS, build y verify:dist.

El validador opcional post-cutover `validate-assignment-skip-gateways.mjs` sin
--precutover se detiene en la precondición de 0015 sobre los predicados de 0007
(comparación textual del catálogo PGlite). No se alteraron 0007/0015 para saltarla.
Esa ruta futura no es el estado instalado objetivo de esta 0014; requiere su propia
revisión antes del cutover. El validador --precutover y el específico SUPPORT sí
ejercitan el SQL ejecutable de esta entrega.

No se ejecutó preflight real, carga con varias conexiones, SQL remoto, instalación,
commit, push, deploy ni empaquetado/instalación de APK en un dispositivo real.
Se preparó también el ajuste mínimo de matching en notify-vencidos para que una
captura tardía no suprima el recordatorio de DAY/NIGHT actual. Es código local:
su despliegue compatible debe coordinarse antes de habilitar atención tardía; no se
desplegó ninguna Edge Function en esta pasada.
