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
explícitas de cualquier ubicación. Los KPI mantienen su deduplicación y
muestran el consolidado; los filtros locales cambian las listas. La matriz
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
la revisión ejecutable de constraints/trigger/RLS en PostgreSQL queda
pendiente en un entorno de prueba antes de autorizar producción.
