# Fase 2B: anomalías y firmas mediante operaciones autenticadas

Base auditada: `e379131`, rama `migration-typescript`. Preparación local;
ningún SQL aplicado, ningún permiso productivo cambiado.

## Auditoría y cambios

Antes: anomalías manuales, automáticas, edición, cierre y baja lógica usaban
DB.put + transporte REST genérico. El editor no verificaba propiedad,
permitía cambiar equipo y exponía los tres estados a todos. Las automáticas
no conservaban intento cuando fallaba el efecto posterior al engrase.
Firmas sin versión del registro, upload con x-upsert:true y resolución ADMIN
por PATCH genérico del anchor. QR permitía scope ausente/ambiguo y assignments
fuera de cobertura.

Ahora: RPCs tipadas report_anomaly, edit_anomaly, close_anomaly,
retire_anomaly, repeat_anomaly_from_execution, capture_grease_validation,
resolve_grease_validation_conflict. Implementación interna sin EXECUTE para
clientes, sin store ni payload arbitrarios. JWT + perfil activo + matriz
vigente + scope legacy antes de consultar recibo/escribir. Capturador/actor
y tiempo del servidor, distintos del nombre/rol declarados por firmante externo.
No se modifica app_store_permissions.

| Operación | ADMIN | PLANIFICADOR | SUPERVISOR | LUBRICADOR |
|---|---|---|---|---|
| Anomalía manual | Global con I | Denegado | Scope con I | Scope con I |
| Editar/cerrar | Global con U | Denegado | Scope con U | Propia y scope, delegado por I |
| Baja lógica | Global con D | Denegado | Denegado | Denegado |
| Automática | Ejecución propia aceptada + record I | Igual | Igual + scope | Igual + scope |
| Capturar firma | Validation I | Solo si matriz I; hoy no | Validation I + scope, ENCARGADO/identidad propia | Validation I + scope, firmante declarado |
| Resolver conflicto | Validation U, CAS de todas las firmas | Denegado | Denegado | Denegado |

El servidor fija equipo de edición a partir de la anomalía existente. Una
anomalía legacy sin capturedByAuthUserId no demuestra propiedad: el nombre
createdBy no autoriza corrección del lubricador. ADMIN/SUPERVISOR conservan
gestión legítima. Para restringidos, crew explícita autorizada o única membresía
activa; crew.locationId debe coincidir con equipment.locationId. No se consulta
crew_locations. QR exige scope válido y cobertura; assignment nunca la amplía.
La Ficha QR, mini Ficha de matriz y apertura del formulario aplican la misma
denegación; se retiró el bypass “Continuar fuera de plan” para equipos externos.
Los equipos autorizados conservan prioridad ASSIGNED/PLANNED/OUT_OF_PLAN.

## Transiciones reales preservadas

| Actual | EDIT autorizado | CLOSE dedicado |
|---|---|---|
| Abierta | Abierta / En atención / Cerrada | Cerrada |
| En atención | Abierta / En atención / Cerrada | Cerrada |
| Cerrada | Abierta / En atención / Cerrada | Denegado |

La reapertura estaba disponible en el editor real. Se conserva para editor
autorizado, sin inventar estados. RETIRE conserva payload/histórico y marca baja.

## Automáticas, CAS y offline

Se mantienen como efecto recuperable posterior. Guardar CREATE de engrase
guarda atómicamente también evidence:auto:<recordId> en app_config. La proyección
visual de anomalías es secundaria: su fallo no elimina el intento ni la evidencia.
El ACK de ejecución fija la versión exacta esperada para ese efecto. El servidor
deriva puntos pendientes/horómetro, conserva exclusión de equipo sin horómetro,
repite solo una anomalía abierta por equipo/punto y rechaza ambigüedad sin
escrituras parciales. Serialización compartida con 0009; recibo por Auth UID/op
evita incrementar dos veces, incluso si se pierde ACK. No vuelve a crear engrase.
El ID de la automática es obligatoriamente auto:<recordId>; un nonce distinto
no permite inflar repeticiones. Se exige recibo privado CREATE de 0009 con el
mismo actor y payload canónico, no basta un capturedByAuthUserId declarado.
El intento conserva también snapshot local con fotos/detalles originales. Si
una edición posterior llega antes que el efecto automático, el CAS bloquea
ese efecto para revisión; no toma silenciosamente otra versión ni pierde la evidencia.

Queue local persistente, operation ID estable, solicitud congelada antes de enviar,
CAS de versiones, account guard y session epoch antes del ACK. Upload falla:
se conservan píxeles. Endpoint ausente/red/5xx: RETRYABLE. DENIED/CONFLICT/403:
BLOCKED conservado para revisión, sin bucle ni fallback REST. Los dirty legacy
sin intención tipada se conservan/quarantinan: requieren revisión, no conversión
automática a autorizaciones nuevas. pendingCount incluye efectos sin fila proyectada.

## Firmas y resolución

CAPTURE verifica versión exacta vigente, guarda recordVersion + recordSnapshot
del servidor. 0009 sigue bloqueando EDIT cuando existe cualquier firma activa,
incluido ADMIN. No se migra ni inventa vínculo para firmas históricas sin versión.
Alternativas offline distintas se insertan y se muestran como conflicto; recibo
idéntico es idempotente, mismo ID diferente es conflicto.

ADMIN resuelve mediante CAS de todas las firmas activas. Solo cambia metadata
de resolución del anchor determinista; conserva binarios, referencias, snapshots,
firmas alternativas e historial de resoluciones. Auditoría Auth UID/usuario/hora/
motivo/versión seleccionada. Una nueva alternativa invalida una resolución anterior;
CAS rechazado marca resolución local pendiente de revisión, sin declarar oficial.
Cuando el servidor devuelve el anchor canónico tras rechazo CAS, se restaura
atómicamente; el intento y su auditoría quedan en la queue bloqueada. El ACK de
ejecución conserva un recibo local de versión para la carrera con el modal de firma:
nunca se firma automáticamente una edición posterior tomando su última versión.

Uploads de firmas sin upsert. Ante colisión, lectura autenticada y comparación
byte por byte; nunca aceptación ciega. Servidor comprueba objeto del bucket/path
derivado y propietario Auth (owner_id o owner legacy). Referencia canónica como
path, compatible con resolveEvidenceSrc/getSignedPhotoUrl existentes; no confía
en host URL del cliente. Guards restrictivos Storage impiden UPDATE/DELETE bajo
grease_validations/, incluso antes de ACK. No cambian bucket, SELECT, privacidad,
otros prefijos ni políticas de 0007. Limpieza de uploads huérfanos: fase posterior
específica y autorizada; jamás borrar firma activa para recuperarse de un fallo.

## Preparación/despliegue futuro, no ejecutado

0010_evidence_gateway_PREPARED.sql depende del schema Auth/permisos existente
y del endpoint 0009. No depende de 0008 ni de 0007. El workflow Pages no ejecuta
SQL y no se encontró runner secuencial configurado: PREPARED se revisa/aplica
manualmente, no por orden lexicográfico automático. Con un runner futuro habría
que resolver expresamente el salto de 0008; el número 0010 no autoriza omitirlo.

Precondiciones SQL: 0009 instalado; instalador dueño de engrase_sync; RLS enabled
sin FORCE RLS; storage.objects con RLS. Verificar grants/policies reales en staging.
Plan manual sujeto a autorización separada: schema/0009 en entorno de ensayo,
ensayar 0010 completo + cliente compatible + roles/Storage, resolver colas legacy,
retirar/bloquear versiones cliente antiguas, ventana controlada para instalar
0010 y distribuir cliente. Los guards finales bloquean escrituras directas aun
con ALL/true legacy: **no es una instalación inerte compatible con cliente viejo**.
No ejecutar ninguno de estos pasos en esta fase. 0003/cutover y 0008 siguen
pendientes y requieren su propia autorización y validación productiva.

Rollback seguro preparado: revocar EXECUTE a authenticated, mantener guards,
recibos y evidencia. No restaurar escrituras abiertas ni borrar recibos/tablas.
Las colas quedan conservadas; reanudación explícita tras reparación autorizada.

Settings READ para PLANIFICADOR/SUPERVISOR/LUBRICADOR queda documentado para fase
posterior. getHelpContent no justifica INSERT global. Push tokens/0007 y permisos
directos de otros stores quedan fuera del alcance. No certifica todavía cutover
0003 ni seguridad completa de todos los stores.

## Validación local

tools/validate-evidence-gateway.mjs utiliza PGlite ya instalado externamente:
PostgreSQL en memoria, roles/RLS/policies reales, fixtures controlados. No lee
credenciales ni realiza conexiones de red. Pruebas unit y Playwright dirigido
ejercitan fuente real, IndexedDB, colas, Auth/session changes y contratos RPC;
no sustituyen validación de permisos/Storage del entorno productivo futuro.

Resultado local: 1.530 unit/95 archivos; 29 comprobaciones PostgreSQL para 0010
y 42 regresiones de 0009. Playwright dirigido: 414 casos únicos en 390/412/1366,
incluidos 186 de QR/cobertura/matriz y 228 de evidencia/registro/firma. Repetición
de los 75 afectados por el último ajuste CAS y 66 del contrato QR actualizado
(sin suite completa). Los seis fallos iniciales QR eran expectativas de asignación
fuera de cobertura, actualizadas a denegación con pruebas positivas de assignment
autorizado; no fueron fallos de recursos ni ocultamiento de errores reales.
Typecheck/build/verify:dist verdes. lint:css: 0 errores, 98 warnings anteriores,
sin cambios CSS. Ninguna migración aplicada.
