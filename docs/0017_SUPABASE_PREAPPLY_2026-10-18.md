# 0017 — pre-apply contra Supabase real

**ENVIRONMENT: PRODUCTION ONLY. READY TO APPLY 0017: NO.**

Se revisaron las conexiones existentes el 18 de octubre de 2026. No hay staging accesible en los proyectos y ramas devueltos por la sesión actual. Se ejecutó únicamente el preflight de catálogo de producción en una transacción `READ ONLY`, con `ROLLBACK` y sin DML, DDL, fixtures, cambio de rol, JWT simulado ni aumento de statement_timeout. No se aplicó 0017, no se modificaron 0014/0015/0016 ni se hizo commit.

## Entorno identificado

| Consulta existente | Resultado |
|---|---|
| `supabase projects list --output json` | `cont_engrase`, ref `havrirlapjyqrffgalqx`: enlazado, ACTIVE_HEALTHY. Es la producción identificada en la configuración e historial del proyecto. |
| Segundo proyecto accesible | `OT_Minalibertad`, ref `nxbwdrfgezzrfqzxgaks`: INACTIVE, otra aplicación, no se trató como staging. |
| `supabase branches list --project-ref havrirlapjyqrffgalqx --output json` | `[]`: ninguna rama de staging. |
| Conexiones alternativas del proceso | Sin nombres de variables DATABASE/POSTGRES/SUPABASE configuradas en el entorno inspeccionado. No se inventaron credenciales. |

Esta clasificación describe el acceso disponible en la sesión actual; no afirma que no pueda existir un staging en otra cuenta o conexión todavía no facilitada.

## PRECHECK

El preflight final se ejecutó el **18/10/2026 a las 11:40:07, America/Managua** (`2026-10-18T17:40:07.361319+00:00`). PostgreSQL 17.6. `transaction_read_only=on`.

| Comprobación | Resultado real |
|---|---|
| PRECHECK_0016 | **PASS**. Existe el registro `0016_fix_support_rls_performance`, instalado `2026-10-17T20:20:47.699923+00:00`. El dispatcher coincide con el código de 0016 al ignorar espacios. |
| PRECHECK_0017 | **PASS: AUSENTE**. Sin helpers broadcast/manual_task, sin ramas de 0017 en dispatcher, sin permisos de los tres stores nuevos, sin filas nuevas ni registro de 0017. No se detectó instalación parcial en estas comprobaciones. |
| PRECHECK_POLICIES | **PASS de presencia/forma** de las ocho policies scope/store. Son restrictivas para authenticated. INSERT/UPDATE/DELETE siguen referenciando baseline_0013; SELECT usa el wrapper actual y conserva la excepción settings de 0014. |
| Tabla bus | RLS activo, FORCE RLS desactivado, propietario postgres. |
| Stores actuales | Se contaron 2.108 filas en 17 stores con datos; la matriz contiene 18 stores. Esto demuestra lectura por postgres y presencia de permisos, **no certifica acceso autenticado por cada cuenta**. No se simularon sesiones de usuarios en producción. |

### Discrepancia de formato resuelta

El primer preflight comparó el cuerpo con saltos de línea normalizados y marcó `FAIL_OR_DRIFT`. Se conservó ese resultado inicial. Una comparación adicional **solo de hashes** aclaró la diferencia:

| Hash del dispatcher | Local 0016 | Producción |
|---|---|---|
| MD5 con trim/saltos normalizados | `58cb6292bf7ad185be32ead2004dcf90` | `215e2de3847979514d3d574a8d150bdb` |
| MD5 eliminando espacios | `8493617b1e85891beb6302495414d3d8` | `8493617b1e85891beb6302495414d3d8` |

El cuerpo de este wrapper no contiene espacios significativos dentro de sus literales. La coincidencia sin espacios confirma que esta discrepancia es de formato; no se alteró ninguna función para obtener el PASS. Se verificaron además `SECURITY DEFINER`, propietario postgres y `search_path=pg_catalog`. No se exportó el cuerpo de producción.

## Resultado funcional solicitado

**NOT RUN** significa no ejecutado contra Supabase real/staging. No significa PASS ni 0. La validación local previa continúa documentada por separado y no sustituye estos resultados.

| Campo del reporte | Estado |
|---|---|
| EXISTING STORE EQUIVALENCE — OLD_NOT_NEW | **NOT RUN / sin valor real**. No se reporta 0. |
| EXISTING STORE EQUIVALENCE — NEW_NOT_OLD | **NOT RUN / sin valor real**. No se reporta 0. |
| BROADCAST | NOT RUN |
| READ PRIVACY | NOT RUN |
| MANUAL TASK CREATION | NOT RUN |
| MANUAL TASK VISIBILITY | NOT RUN |
| PROTECTED FIELD UPDATE — equipmentId | NOT RUN |
| PROTECTED FIELD UPDATE — crewId | NOT RUN |
| PROTECTED FIELD UPDATE — createdBy | NOT RUN |
| PROTECTED FIELD UPDATE — title | NOT RUN |
| PROTECTED FIELD UPDATE — description | NOT RUN |
| PROTECTED FIELD UPDATE — taskType | NOT RUN |
| PROTECTED FIELD UPDATE — priority | NOT RUN |
| PROTECTED FIELD UPDATE — dueAt | NOT RUN |
| VALID COMPLETION | NOT RUN |
| OTHER CREW COMPLETION | NOT RUN |
| REASSIGNMENT | NOT RUN |
| CANCELLATION | NOT RUN |
| UNKNOWN STORE | NOT RUN para el estado 0017 en Supabase. |
| PERFORMANCE — LOCATION | NOT RUN; execution/planning time, scans y filas examinadas no disponibles para 0017 real. |
| PERFORMANCE — MANUAL TASK SELECT | NOT RUN; métricas no disponibles. |
| PERFORMANCE — COMPLETION UPDATE | NOT RUN; métricas no disponibles. |
| FIXTURE CLEANUP | No se crearon fixtures; los stores nuevos tienen cero filas. Las consultas read-only finalizaron con ROLLBACK. No hay limpieza pendiente de esta sesión. |
| FAILURES | Falta staging accesible; 0017 está ausente y está prohibido instalarla. La batería funcional no puede ejecutarse en el estado actual. |
| READY TO APPLY 0017 | **NO — NO-GO** |

Las pruebas preparadas de equivalencia y seguridad requieren funciones de 0017 ya instaladas. Ejecutarlas sobre el estado actual produciría un error por función ausente o una falsa denegación sin valor probatorio. Esta tarea prohíbe instalar 0017 incluso en staging, por lo que no se realizó una instalación temporal ni dentro de una transacción destinada a rollback.

Los perfiles activos observados en producción son uno de cada rol ADMINISTRADOR/PLANIFICADOR/SUPERVISOR/LUBRICADOR. No hay VISOR activo ni segundo LUBRICADOR para la batería completa. No se crearon cuentas de prueba en producción.

## SQL seguro para ejecución manual

1. Abrir el proyecto `cont_engrase` en el SQL Editor y seleccionar el rol postgres.
2. Copiar **todo** `docs/0017_PREAPPLY_PREFLIGHT_READ_ONLY.sql`. Tiene una sola salida JSON y comienza con `BEGIN TRANSACTION READ ONLY`; termina con `ROLLBACK`.
3. Verificar `transaction_read_only=on`, `PRECHECK_0016=PASS_EXPECTED_0016_BODY_IGNORING_WHITESPACE`, `PRECHECK_0017=PASS_ABSENT_NO_PARTIAL_OBJECTS`, las ocho policies PASS y ausencia de registro 0017. Ante otra salida detenerse y conservar el resultado.
4. Si se necesita aclarar el hash, usar `docs/0017_PREAPPLY_FUNCTION_CATALOG_READ_ONLY.sql`, que devuelve únicamente hashes/metadatos. No devuelve el código de la función.
5. No ejecutar `tests/sql/0017-security.sql` ni la migración 0017 en producción. Tampoco ejecutar el antiguo archivo de equivalencia contra esta producción: aunque es read-only, requiere 0017 instalada y no puede verificar la versión nueva antes de existir.

Estos pasos manuales permiten repetir el precheck; no convierten una comprobación de catálogo en prueba de RLS de una versión no instalada.

Para desbloquear la batería funcional se necesita una conexión existente de staging confirmada y un estado que permita probar 0017, autorizado por separado. No se ha preparado ni ejecutado una orden de instalación como parte de esta tarea. Las pruebas actuales `tests/sql/0017-security.sql` y `docs/0017_BROADCAST_MESSAGES_EQUIVALENCE_TESTS_READ_ONLY.sql` conservan su alcance documentado; no se modificaron para simular un PASS real. Los requisitos adicionales de rendimiento (SELECT por crew y métricas de ejecución), prefijo `TEST_0017` y verificación final de fixtures siguen pendientes para esa ejecución autorizada en staging.

## Evidencia guardada

- `docs/evidence/0017_SUPABASE_PREAPPLY_PREFLIGHT_2026-10-18.json`: resultado inicial, incluida la discrepancia de formato.
- `docs/evidence/0017_SUPABASE_FUNCTION_HASHES_2026-10-18.json`: hashes y metadatos reales, sin cuerpo de función.
- `docs/evidence/0017_SUPABASE_PREAPPLY_FINAL_2026-10-18.json`: preflight final completo, fuente del reporte.
- `docs/0017_VALIDATION_2026-10-18.md`: informe histórico de pruebas locales; no es certificación de Supabase.

La revisión automática rechazó un intento de exportar el cuerpo completo de la función de autorización por considerarlo sensible. Se descartó esa operación y se usó la alternativa de hashes/metadatos, que fue aceptada. No se exportó ese código ni queda una solicitud de aprobación pendiente.
