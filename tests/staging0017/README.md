# Staging aislado para 0017

**Estado: PREPARADO, NO OPERATIVO. No baseline certificado; no 0017 aplicada.**

Este paquete no conecta a producción, no crea un proyecto externo, no instala dependencias y no modifica el cliente ni las migraciones. Los endpoints locales usan puertos 553xx y el identificador `control_engrase_test0017`. El `supabase/.temp/project-ref` de la raíz del repositorio no se usa.

## Arranque local

1. Abrir Docker Desktop y completar su configuración hasta que el engine esté saludable. El intento de esta sesión no consiguió habilitar su API. No se cambian características de Windows, WSL ni BIOS automáticamente.
2. Desde la raíz del repositorio ejecutar `./tests/staging0017/start-local.ps1 -CheckOnly`.
3. Si pasa, ejecutar `./tests/staging0017/start-local.ps1`. Crea una red propia vinculada a 127.0.0.1 y arranca Postgres/Auth/Storage/API. El log `local/startup.local` está ignorado y puede contener llaves locales: no publicarlo.
4. No ejecutar `supabase link`, `db push`, `db reset`, ni comandos con `--linked` desde este paquete. Las migraciones y el seed automáticos están desactivados deliberadamente.

El arranque aislado sigue el mecanismo oficial de [Supabase local](https://supabase.com/docs/guides/local-development), incluido el binding de red a loopback. Abrir los puertos no instala el esquema de Control de Engrase ni certifica fidelidad.

## Gate de fidelidad del baseline

Falta un baseline versionado que represente el estado **real** hasta 0016. No ejecutar todos los archivos numéricamente. 0001 es DRAFT; 0002 lo sustituye. 0003 y el cutover final son alternativas con condiciones diferentes, 0008 tiene una etapa distinta y dos archivos 0005 representan cambios independientes.

Además existe evidencia concreta de diferencia: 0006 deja VISOR sin lectura en `notification_dispatch_log`; la matriz preparada de 0015 deja sin lectura los otros cuatro roles. Esa cadena preparada produciría cero roles lectores, mientras el preflight real guardado registra uno. Esto no identifica qué permiso exacto está activo ni autoriza cambiarlo; demuestra que aplicar ciegamente la cadena no reproduce el estado guardado.

El anterior runner PGlite no resuelve esta falta: usa infraestructura simplificada y salta el guard de catálogo de 0015 para cargar solo su matriz destino. No se utiliza aquí como baseline fiel.

Antes de instalar una base candidata se necesita revisar la selección/orden efectivamente aplicados, tablas, firmas/cuerpos verificados de funciones, índices, permisos exactos por rol/store, grants y estado de Storage. Las salidas guardadas hasta ahora contienen hashes y agregados, no un snapshot completo. En esta tarea no se vuelve a consultar ni exportar producción para completarlo.

`baseline-check.sql` permite inspeccionar el candidato de staging cuando exista; no genera un PASS automáticamente. Comparar contra la referencia aprobada y añadir pruebas reales de Auth/HTTP y sync CAS. Todos los stores existentes deben conservar permisos exactos; unknown store debe rechazarse por RLS efectiva. No aplicar 0017 hasta cerrar este gate.

## Fixtures preparadas

`node tests/staging0017/prepare.mjs` regenera el seed y la variante de pruebas desde las fuentes actuales, verifica nombres/prefijos y guarda hashes. Solo lee/escribe archivos; no ejecuta SQL ni conecta a servidores.

`fixtures.json` define seis usuarios (`TEST0017_ADMIN`, `TEST0017_PLANNER`, `TEST0017_SUPERVISOR`, `TEST0017_LUB_A`, `TEST0017_LUB_B`, `TEST0017_VIEWER`) y once filas sintéticas:

- CREW_A cubre LOC_A PRINCIPAL y LOC_B APOYO; su legacy locationId apunta a LOC_C de forma contradictoria.
- CREW_B cubre LOC_C PRINCIPAL.
- CREW_LEGACY no tiene crew_locations y apunta a LOC_B para probar fallback.
- EQUIPMENT_X permanece en LOC_A.

Tras reconstruir el esquema revisado, comprobar la identidad local antes de crear `target-marker.sql`. El marcador es una segunda barrera, no demuestra por sí mismo identidad ni fidelidad. Ejecutar SQL con `ON_ERROR_STOP=1`, exclusivamente en el contenedor `supabase_db_control_engrase_test0017` previamente verificado. No ejecutar esos scripts en una consola enlazada a producción.

Crear las seis cuentas Auth mediante Admin API o Dashboard del staging, con emails `test0017_admin@example.invalid`, `test0017_planner@example.invalid`, `test0017_supervisor@example.invalid`, `test0017_lub_a@example.invalid`, `test0017_lub_b@example.invalid`, `test0017_viewer@example.invalid`. Usar contraseñas aleatorias nuevas, conservadas localmente; no hardcodear claves ni escribir directamente en auth.users. Después ejecutar `seed.synthetic.sql`: resuelve los UUID reales por email y se detiene si faltan cuentas o ya hay fixtures/datos ajenos.

## Secuencia de validación cuando el baseline sea PASS

1. Guardar el catálogo y matriz completos del staging 0016; comprobar endpoints de Auth, bootstrap y sync CAS como cada cuenta, no como service_role. Guardar visibilidad/decisiones por store antes de 0017.
2. Instalar únicamente `0017_broadcast_messages_scope_PREPARED.sql` en ese staging identificado. Guardar cualquier error íntegro, sin tokens. No adaptar una migración para eludir un guard.
3. Ejecutar `docs/0017_BROADCAST_MESSAGES_EQUIVALENCE_TESTS_READ_ONLY.sql` y comparar además las decisiones efectivas/matriz con el snapshot anterior, incluyendo INSERT/UPDATE USING/CHECK/DELETE. Exigir OLD_NOT_NEW=0 y NEW_NOT_OLD=0; detenerse ante cualquier diferencia.
4. Ejecutar `security.staging.sql`: variante de la batería SQL existente con guard de staging y prefijo TEST0017_SQL_. Incluye las ocho mutaciones protegidas separadas, cierre válido con una fila realmente afectada, recepción, lecturas, creación, reasignación, cancelación y unknown store. La transacción termina en ROLLBACK; verificar prefijo TEST0017_SQL_ en cero después.
5. Completar el gate de fotos real que se describe abajo. El cambio de crew para SUPERVISOR está en la batería; añadir la misma comprobación para PLANIFICADOR, con mismo task.id/equipmentId, equipo intacto y campos de historial conservados.
6. Ejecutar `performance.sql` en el dataset sintético: genera planes ANALYZE/BUFFERS de LOCATION, SELECT por crew y cierre, con tiempos de planificación/ejecución, filas y scans. El UPDATE se revierte. Sus planes exteriores no exponen todo el trabajo de SECURITY DEFINER: inspeccionar además cobertura y búsqueda por clave, y buscar recomputación de grants/scope por fila. No aumentar statement_timeout ni generar carga masiva.
7. Ejecutar el rollback preparado de 0017. Comparar policies, matriz y accesos con el baseline guardado; comprobar denegación de stores nuevos y desconocidos. El diseño conserva helpers revocados: una reaplicación directa debe detenerse por precondiciones. No borrar esos helpers para forzar un PASS de reaplicación.
8. Eliminar las imágenes dummy usando Storage API, ejecutar `cleanup.synthetic.sql`, eliminar las seis cuentas Auth por Admin API/Dashboard y comprobar cero fixtures. No hacer DELETE SQL sobre storage.objects para limpiar archivos.

## Gate de fotos — bloqueo encontrado

`node tests/staging0017/photo-contract.mjs` usa el código real `Sync.uploadPhotoIfNeeded()` y `stripLocalAuthorizationMetadata()` con HTTP/DB simulados. No sube nada ni ejecuta 0017. Su salida es intencionalmente no cero mientras exista la incompatibilidad:

- Se sustituye `photos` por una URL con una subida simulada.
- También se añaden `photo` y `photoUploaded` al payload destinado al servidor.
- Ambos quedan fuera de la allowlist de cierre de 0017, que solo permite status/completedBy/completedAt/completionComment/photos.

Es una incompatibilidad de contrato reproducida offline; no se declara como rechazo empírico de Storage o RLS en staging. Al integrar manual_tasks se necesita proyectar el resultado de subida al payload de cierre permitido y mantener metadatos locales fuera del payload. El cliente todavía no registra manual_tasks en STORES, por lo que tampoco existe una sincronización genérica completa de ese store lista para esta prueba.

La evidencia final debe usar login real de LUB_A, subir una imagen dummy al bucket de staging mediante el helper real, recuperar sus bytes, comprobar sustitución de URL/path y sincronización de la tarea, y probar acceso directo/signed URL con LUB_B sin scope. Las policies del schema histórico son públicas; la migración de privacidad preparada admite cualquier cuenta activa, sin scope por tarea. No se puede prometer aislamiento de fotos por crew a partir del RLS del bus. No se modifican esas policies existentes en esta preparación: el requisito necesita revisión explícita antes de un GO.

## Staging alojado independiente — acción manual

La opción preferida requiere que el usuario cree el proyecto; este paquete no crea recursos externos. En el [Dashboard](https://supabase.com/dashboard/projects):

1. Elegir la organización adecuada y **New project**.
2. Nombre: `control_engrase_staging_0017`. Región: preferiblemente la misma de producción (`us-west-2`), si está disponible.
3. Generar una contraseña de base nueva y guardarla en el gestor de contraseñas. Revisar plan/coste antes de crear. Si exige contratar o ampliar un plan, detenerse; no hay autorización para recursos pagos.
4. Crear un proyecto vacío y esperar estado saludable. No restaurar datos, fotos, usuarios ni contraseñas productivos; no reutilizar `OT_Minalibertad`.
5. Facilitar únicamente el nuevo project ref o URL del Dashboard. No pegar service_role, JWT ni contraseña en el chat. Se aprovechará la sesión CLI existente para identificarlo, conservando el enlace de producción intacto.

La creación externa y la carga del baseline continúan pendientes; crear un proyecto vacío no resuelve por sí solo la fidelidad ni el gate de fotos.
