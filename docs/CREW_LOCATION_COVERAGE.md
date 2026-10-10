# Cobertura de cuadrillas (preparada, sin aplicar SQL)

La autorización continúa siendo usuario autenticado → rol → cuadrillas con
memberUserIds → ubicaciones → turno. No depende de hardware.

IndexedDB v9 incorpora `crew_locations`. Los registros usan los campos
`crew_id`, `location_id`, `role`, `active`, `created_at`, `updated_at`, y las
marcas existentes `updatedAt`/`_pushedVersion` para transporte CAS.
`cuadrillas.locationId` se conserva. Si no existe ninguna relación de esa
cuadrilla, su ubicación legacy es PRINCIPAL en el helper; la recepción de
trabajo normal legacy conserva la regla `isDefault` (una auxiliar no pasa
a recibir trabajo por este cambio). Una relación inactiva revoca acceso y
evita que el fallback lo restaure. PRINCIPAL explícito tiene prioridad.

Mi Turno consolida el trabajo normal de las principales y las asignaciones
explícitas cuya ubicación maestra esté en PRINCIPAL o APOYO autorizada.
Un assignment externo se conserva, pero no amplía cobertura ni entra
automáticamente en Mi Turno. Los cuatro KPI usan las mismas listas finales
que las secciones, después del filtro de ubicación: Todas muestra el
consolidado; una ubicación muestra solo sus filas. El widget mantiene el
consolidado de la cuadrilla. La matriz
conserva una tabla por ubicación principal, ambos turnos y solo lectura.
APOYO sin asignación abre fuera de plan; una asignación propia tiene prioridad.
Ubicaciones ajenas conservan advertencia. No se cambia equipment.locationId.

Cada nuevo operationalSnapshot incluye `executionLocationId` igual a la
ubicación real del equipo, además de equipmentLocationIdAtExecution y del
campo histórico crewLocationIdAtExecution. Ficha utiliza executionLocationId
cuando existe; para registros antiguos conserva el snapshot histórico y
no inventa una ubicación de ejecución a partir de una cuadrilla actual.

La sincronización no consulta una tabla REST adicional: pullAll ya descarga
los stores de engrase_sync antes de marcar lastPull. Un servidor anterior
sin relaciones devuelve el catálogo legacy normalmente. Cambios locales
de cobertura pendientes necesitan 0008 para subir con permisos: una
respuesta 403 conserva las filas dirty y no debe impedir otros stores.
Una instalación offline utiliza la cobertura descargada o fallback legacy.

0008 prepara una tabla con UNIQUE(crew_id, location_id), índice parcial de
una PRINCIPAL activa por ubicación y un trigger transaccional que proyecta
las escrituras de engrase_sync; las violaciones abortan la escritura CAS.
Las FK compuestas referencian los maestros reales (store,id) de engrase_sync,
con discriminadores generados fijos para cuadrillas y locations; también
rechazan referencias inexistentes en filas inactivas. No borran maestros
en cascada. La migración aborta si sigue presente la policy legacy abierta.
El acceso directo a la proyección es solo lectura autenticada; ADMIN y
PLANIFICADOR editan vía el store. RLS conserva el alcance por rol del
catálogo actual, sin afirmar aislamiento por membership en el servidor.
La desactivación de una cuadrilla retira inmediatamente su alcance local;
el trigger revoca sus relaciones con soft delete y libera las ubicaciones
principales en servidor, también para clientes antiguos.

Antes de autorizar producción: revisar el SQL en una instancia de prueba y
su preflight. Si varias cuadrillas legacy comparten ubicación, el seed
PRINCIPAL solicitado es incompatible con el índice: la migración aborta
sin cambios. Un responsable debe resolver esas coberturas explícitamente.
No se consulta ni modifica producción para resolverlo aquí.

Clientes antiguos ignoran el nuevo store y conservan su comportamiento
de ubicación única. Requiere actualizar los clientes de campo antes de
activar coberturas múltiples. No ejecutar la suite UI completa en este lote.

## Validación local

Unit: 1.403 pruebas aprobadas (87 archivos), incluidas 16 de cobertura y
transporte. Playwright dirigido: lotes de 567 y 490 pruebas aprobados;
1.008 casos distintos en siete resoluciones (49 casos comunes de cobertura).
La versión final de cobertura se comprobó nuevamente con sus 56 casos:
primer pull parcial, offline, roles, principal duplicada, filtros, KPI,
widget, matrix, COMPLETE adelantado en ambas ubicaciones, PARTIAL y carryover.
Sin fallos finales ni retries. Suite completa no ejecutada en este lote.
Typecheck, build y verify:dist aprobados. CSS: cero errores y las mismas
85 advertencias previas. No se aplicó SQL ni se accedió a producción;
esa validación inicial no ejecutó SQL. El preflight posterior se detalla abajo.

## Preflight SQL/RLS local — 2026-10-10

Ejecutado en PostgreSQL 17.5 WASM (PGlite 0.3.15), bases nuevas en memoria
con datos ficticios. Ninguna conexión a Supabase ni a producción. No se
modificaron 0003/0005/0007 ni código funcional. La dependencia de validación
se instaló en una carpeta temporal, fuera de package.json/package-lock.json.

Reproducción: instalar `@electric-sql/pglite@0.3.15` con npm `--prefix`
en una carpeta temporal y ejecutar `node tools/preflight-crew-locations.mjs`
con la ruta absoluta a su `node_modules/@electric-sql/pglite/dist/index.js`.
El harness importa el SQL real de 0008 y las funciones/policies de 0002.
La instalación local comienza con las policies de cutover ya vigentes;
otra base con la policy legacy abierta comprueba el aborto previo de 0008.
Solo se simula auth.uid() mediante el claim de sesión; SET ROLE usa
authenticated/anon sin SUPERUSER ni BYPASSRLS. No se usa service_role.
Esto verifica RLS PostgreSQL, no el login ni la validación HTTP de JWT de
Supabase (fuera del alcance de esta prueba local).

Antes del fix se reprodujeron: ausencia de FK y aceptación de referencias
huérfanas inactivas; aplicación de 0008 con policy legacy abierta. Después
del fix pasan A–J, FK activas/inactivas, backfill aditivo e idempotencia,
soft removal, rechazo de relaciones huérfanas preexistentes y rollback total.
Dos crews legacy en la misma ubicación abortan: ninguna elección ni
conversión automática a APOYO. Crews sin ubicación se conservan sin seed.

RLS: los cinco perfiles activos leen; ADMINISTRADOR y PLANIFICADOR insertan,
actualizan y hacen soft delete por engrase_sync. Toda escritura directa en
crew_locations se deniega; SUPERVISOR, LUBRICADOR, VISOR y anon no pueden
escribir su store. Anon no obtiene filas aun con privilegio SELECT concedido.

`docs/CREW_LOCATION_PREFLIGHT_READ_ONLY.sql` está preparada y probada solo
en las bases ficticias. Detecta duplicados legacy, conflictos entre seed
y relaciones existentes, ausencia de ubicación, huérfanos, roles inválidos
y policies del transporte. Antes de producción es necesario ejecutar esa
consulta con autorización y resolver conflictos; aquí no se conoce su
existencia real. No aplicar 0008 sin esa revisión y autorización posterior.

Validación posterior: 1.404 unit tests (87 archivos), incluido fallback
gradual cuando otra crew ya tiene relaciones; typecheck, build y verify:dist
aprobados. No se ejecutó Playwright en este preflight.

## Scope automático y KPI por filtro — 2026-10-10

La clasificación central resuelve el equipo maestro por equipmentId antes
de admitir una asignación: su locationId debe pertenecer a
allAuthorizedLocationIds. Sin filas de cobertura para esa cuadrilla,
principalLocationIds y allAuthorizedLocationIds conservan crew.locationId.
Una asignación sin equipo maestro disponible tampoco entra automáticamente.
No se borran assignments ni se cambia equipment.locationId.

Los filtros contienen PRINCIPALES reales y añaden APOYO solo cuando tiene
trabajo visible. APOYO sin assignment no carga programación normal ni genera
pestañas de Matrix. Se conserva el flujo explícito de ejecución fuera de
plan/cross-location, sus advertencias y los motivos existentes.

Las secciones y sus encabezados, Vencidos por horas, Pendientes hoy,
Arrastrados y Realizados hoy comparten las filas de su filtro; no se
recalculan estados, cumplimiento ni satisfacción de occurrences.

Caso real 80-177: cobertura real NO VERIFICADA. No hay export de su cache
accesible en esta sesión. Los nombres visibles en la captura no demuestran
ubicaciones autorizadas. Se usaron únicamente fixtures C1/E1/E2/E3 con IDs
ficticios, por autorización expresa del usuario: Troja única excluye los
assignments de Volcán/Mojón, dos PRINCIPALES reciben programación y APOYO
requiere assignment. El escenario KPI comprueba Todas=3, Volcán=2, Mojón=1.
El test anterior que exigía KPI siempre consolidado se actualizó por el
cambio explícito de especificación. Fixtures de ejecución asignada declaran
APOYO explícito; la asignación sola no lo concede.

Unit: 1.408 aprobados (87 archivos). Typecheck, build y verify:dist aprobados.
Playwright dirigido de cobertura: 91 casos aprobados en siete resoluciones.
Regresión cercana: 399 casos aprobados de ejecución real de Mi Turno,
cross-location explícito, Matrix responsive y widget; total dirigido 490,
sin fallos, skips ni retries.
No se ejecuta la suite completa ni se accede a producción en este fix.
