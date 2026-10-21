# Preparación de staging 0017 — 18/10/2026

**READY FOR PRODUCTION 0017: NO.** Hay un paquete local preparado, pero no un staging operativo ni un baseline 0016 certificado. No se conectó a producción durante esta tarea. No se creó ningún proyecto externo ni recurso pago, no se aplicó 0017, no se modificaron las migraciones existentes ni el cliente y no se hizo commit.

| Resultado solicitado | Estado de esta tarea |
|---|---|
| STAGING TYPE | Supabase local **configurado, no iniciado**. Proyecto independiente alojado: requiere creación manual. PostgreSQL nativo no está instalado; PGlite anterior continúa siendo solo una simulación SQL. |
| BASELINE 0016 | **BLOCKED**. Docker no responde y falta reconstrucción fiel verificada del catálogo/matriz/grants/Storage. No se declaró PASS con el runner simplificado anterior. |
| 0017 APPLY STAGING | NOT RUN: no baseline PASS. |
| EXISTING STORE EQUIVALENCE | NOT RUN en el staging solicitado. Los resultados locales históricos no se reutilizan como validación nueva. |
| OLD_NOT_NEW | Sin valor de staging; no se declara 0. |
| NEW_NOT_OLD | Sin valor de staging; no se declara 0. |
| BROADCAST | NOT RUN en staging; batería preparada. |
| READ PRIVACY | NOT RUN en staging; batería preparada. |
| MANUAL TASK CREATE | NOT RUN en staging. |
| MANUAL TASK VISIBILITY | NOT RUN en staging. |
| COMPLETION | NOT RUN en staging. |
| PROTECTED FIELDS | Los ocho siguen pendientes en staging: equipmentId, crewId, createdBy, title, description, taskType, priority, dueAt. |
| OTHER CREW | NOT RUN en staging. |
| PHOTO PIPELINE | **FAIL de contrato offline**, separado de Storage real NOT RUN. La preparación del upload añade photo/photoUploaded que 0017 no permite cambiar al cerrar. Tampoco está manual_tasks integrado en STORES del cliente. |
| REASSIGNMENT | NOT RUN en staging. Batería disponible para SUPERVISOR; falta ampliar la misma comprobación a PLANIFICADOR durante la ejecución real. |
| CANCELLATION | NOT RUN en staging. |
| UNKNOWN STORE | NOT RUN en staging. |
| PERFORMANCE — LOCATION | Script EXPLAIN ANALYZE/BUFFERS preparado; no execution/planning times ni filas/scans reales del staging. |
| PERFORMANCE — TASK SELECT | Preparado; NOT RUN. |
| PERFORMANCE — TASK COMPLETION | Preparado con UPDATE dentro de transacción revertida; NOT RUN. |
| ROLLBACK TEST | NOT RUN en staging; 0017 no llegó a instalarse. |
| REAPPLY TEST | NOT RUN. El diseño actual conserva helpers revocados tras rollback y rechaza la reaplicación directa. Eso debe comprobarse como safe-stop, no eludirse borrando objetos. |
| FIXTURE CLEANUP | Cero fixtures creadas en base/Storage/Auth durante esta tarea. Solo existen definiciones en archivos; no hay limpieza de datos pendiente. |
| FAILURES | Docker engine indisponible; baseline exacto incompleto; incompatibilidad de contrato de fotos. Los gates funcionales no se ejecutaron. |
| READY FOR PRODUCTION 0017 | **NO — NO-GO** |

## Capacidad auditada y bloqueo local

Se usó únicamente configuración y evidencia local existentes. La auditoría anterior mostró `cont_engrase` como producción y ninguna rama staging; no se repitieron consultas remotas ahora. El otro proyecto conocido `OT_Minalibertad` no se reutilizó. No hay configuración alternativa de staging en el repositorio ni URL SQL en el entorno inspeccionado.

El CLI Supabase v2.116.0 y Docker Desktop v29.8.0 están instalados. Se intentó iniciar Docker por CLI y abrir la aplicación en segundo plano. Sus procesos quedaron presentes, pero el engine no expuso la API `dockerDesktopLinuxEngine`. El intento real de `supabase start` falló con `LegacyDockerLifecycleInspectError` por ausencia de esa named pipe. `start-local.ps1 -CheckOnly` confirmó el bloqueo y se detuvo sin SQL.

No se modificaron características de Windows, WSL, BIOS ni se reinició el equipo. El usuario debe completar el arranque/configuración de Docker Desktop hasta que su engine esté saludable. La [documentación oficial](https://supabase.com/docs/guides/local-development) exige un runtime de contenedores para el stack local en Windows; su alternativa nativa experimental descrita para Linux/macOS no es una solución Windows confirmada para este caso.

## Por qué no se aplicó ciegamente 0001→0016

El repositorio contiene borradores, reemplazos y cambios de cutover separados. 0001 es DRAFT, 0002 lo reemplaza, 0003 no equivale al cutover final y 0008 exige una etapa distinta. Los números de archivo no demuestran el estado aplicado.

Hay una diferencia observable sin consultar producción: en el preflight real guardado, `notification_dispatch_log` tiene un rol con lectura; aplicar los archivos preparados 0006 + 0015 dejaría cero. 0006 deja VISOR sin lectura y 0015 pone en false la lectura de los cuatro roles operativos. La diferencia no autoriza corregir producción ni inventar sus filas; exige conocer el baseline efectivo antes de certificar fidelidad.

Los resultados guardados tienen hashes, ocho policies y conteos de matriz; faltan las filas exactas de permisos, grants, catálogo/índices completos, selección/orden confirmados de cambios y estado real de Storage. No se exportó código sensible ni datos de producción para rellenar esos huecos. El runner anterior que omitía el guard textual de 0015 no se adoptó como staging fiel.

## Paquete preparado

Ruta: `tests/staging0017/`. El [README](../tests/staging0017/README.md) contiene la secuencia completa y los límites.

- `local/supabase/config.toml`: proyecto `control_engrase_test0017`, PG17, puertos 553xx; migraciones y seed automáticos desactivados, sin enlace remoto.
- `start-local.ps1`: valida identidad, rechaza enlaces remotos, comprueba Docker y usa una red propia vinculada a loopback. No aplica esquema ni SQL.
- `fixtures.json` y `seed.synthetic.sql`: seis perfiles y once filas sintéticas. CREW_A tiene LOC_A PRINCIPAL/LOC_B APOYO y legacy contradictorio LOC_C; CREW_B cubre LOC_C; CREW_LEGACY permite fallback a LOC_B sin relaciones. Los UUID Auth se resuelven por emails sintéticos, no se inventan ni se copian de producción.
- `target-marker.sql`: segunda barrera de staging, utilizable solo tras confirmar el destino. No es una prueba suficiente de identidad o fidelidad.
- `baseline-check.sql`: inspección read-only del candidato; no produce un PASS de fidelidad por sí sola.
- `security.staging.sql`: batería RLS derivada de las fuentes actuales, con guard de staging, prefijo TEST0017_SQL_ y ROLLBACK.
- `performance.sql`: planes ANALYZE/BUFFERS para LOCATION, SELECT por crew y completion. Fixtures pequeñas, UPDATE revertido y conteo posterior esperado en cero. No cambia statement_timeout.
- `cleanup.synthetic.sql`: limpieza exclusiva de filas/perfiles TEST0017 tras rollback; exige marcador y ausencia de 0017 activa. Objetos Storage y cuentas Auth deben eliminarse con sus APIs, no con DELETE SQL en tablas administradas.
- `prepare.mjs`: regeneración offline de seed/batería y manifest de hashes; sin ejecución SQL, red ni secretos.
- `photo-contract.mjs`: prueba offline del código real de preparación de fotos con HTTP/DB simulados. No es un test de Storage real.

## Root cause de fotos

La prueba ejecutada usa `Sync.uploadPhotoIfNeeded()` y después `stripLocalAuthorizationMetadata()`, tal como prepara el payload de transporte. Una imagen PNG dummy de 68 bytes produce una solicitud simulada a `manual_tasks/TEST0017_TASK_PHOTO_0.jpg`, una URL en photos y dos campos adicionales: photo y photoUploaded. El filtro actual de metadatos locales no los retira. La allowlist de cierre de 0017 admite únicamente status/completedBy/completedAt/completionComment/photos. Ambos campos adicionales quedan fuera del contrato.

No se ensanchó el permiso de cierre ni se cambió sync para ocultar el fallo. Para integrar ese store habrá que proyectar el resultado de upload al payload permitido y mantener metadatos locales fuera del cierre; después demostrarlo con Storage y sync reales. El cliente aún no incluye manual_tasks en STORES.

La privacidad de fotos también sigue pendiente: el schema histórico crea el bucket público, y el diseño de privacidad preparado admite cualquier perfil activo sin scope por tarea. El RLS de manual_tasks no basta para probar que LUB_B no pueda obtener una imagen por URL directa o signed URL. En esta tarea no se cambió ninguna policy de Storage.

## Acción manual necesaria: proyecto staging independiente

En el [Dashboard de Supabase](https://supabase.com/dashboard/projects):

1. Elegir la organización y **New project**.
2. Nombre `control_engrase_staging_0017`; región preferida `us-west-2` si está disponible.
3. Generar una contraseña nueva y guardarla en el gestor de contraseñas. Revisar coste/plan antes de confirmar: si requiere contratar o ampliar, detenerse.
4. Crear el proyecto vacío y esperar estado saludable. No restaurar datos/usuarios/fotos productivos ni reutilizar contraseñas.
5. Facilitar solo el nuevo project ref o URL del Dashboard. No enviar tokens, service_role ni contraseña en el chat. El enlace local existente a producción debe conservarse intacto.

La [referencia oficial del CLI](https://supabase.com/docs/reference/cli/v0/supabase-orgs) confirma que crear proyectos requiere organización, contraseña de base y opciones de región/tamaño; no se ejecutó esa creación automáticamente. Un proyecto vacío resuelve el alojamiento, pero todavía requiere el baseline verificado y cerrar el contrato de fotos antes de obtener GO.

## Comprobaciones ejecutadas

- `supabase init --workdir tests/staging0017/local`: completado, solo configuración local.
- `supabase start ...`: falló antes de crear el backend por Docker engine inaccesible. El log privado `startup.local` está ignorado.
- `start-local.ps1 -CheckOnly`: bloqueo por Docker; no SQL.
- `node tests/staging0017/prepare.mjs`: PASS de generación, seis usuarios y once filas; gate de fidelidad BLOCKED.
- `node tests/staging0017/photo-contract.mjs`: salida 1, incompatibilidad de contrato reproducida offline. La sustitución de URL pasó con upload simulado; no hubo red real ni foto subida.

Evidencia: `docs/evidence/0017_STAGING_PREPARATION_2026-10-18.json` y `docs/evidence/0017_PHOTO_CONTRACT_2026-10-18.json`. Los hashes permiten comprobar que las fuentes del cliente y migraciones auditadas permanecieron intactas durante la preparación.
