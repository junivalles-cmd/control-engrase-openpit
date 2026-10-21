# Recuperación de sync backend — runbook preparado

Estado: preparación local; **no autoriza conexión ni ejecución en producción**. No aplicar 0008. No push/deploy ni cambios DAY/NIGHT.

## Decisiones de orden

**0007 — aditiva pre-cutover.** Su SQL instala policies RESTRICTIVE `TO authenticated` para que las acciones sobre `push_tokens` respeten `userId` del perfil Auth y no permitan hard delete. Estas policies no se aplican a `anon`. Con la policy legacy presente, anon conserva la exposición que le permitan los grants existentes. El encabezado se actualizó para indicar ese alcance y requerir 0007 antes de 0015. Los registros legacy sin `userId` no se reparan automáticamente.

**0010 — aditiva pre-cutover.** Su dependencia es 0009, el baseline Auth/perfiles y Storage RLS. 0003 solo elimina la policy legacy; no crea dependencias de 0010. El encabezado de 0010 se corrigió solo como documentación. 0010 requiere cliente compatible antes de operar; con legacy presente sigue la exposición anónima en otras operaciones y lecturas.

**0015 — límite de cutover.** Requiere 0014, las 72 combinaciones de permisos y ahora comprueba en catálogo las cuatro policies de 0007, incluyendo tabla, comando, modo RESTRICTIVE, audiencia exacta y fragmentos esenciales de ownership. Si faltan o se debilitan, aborta antes de cambiar permisos. Sigue modificando la matriz efectiva; no es parte de la fase aditiva.

**Cutover final — límite de cutover.** Verifica de nuevo los guards 0007, RPCs, row-scope y matriz/digest 0015. En una transacción revoca privilegios de tabla a anon y elimina la policy legacy. No ejecutar `0003_auth_rls_CUTOVER_PREPARED.sql` por separado: solo elimina la policy y omite los controles adicionales del cutover final.

## Estado intermedio

Entre las migraciones aditivas y el cutover, clasificar el sistema como **FUNCTIONALLY_PREPARED_WITH_LEGACY_ANON_RISK**. Que 0007 proteja a authenticated no significa que el sistema ya esté seguro: la policy legacy continúa abriendo a anon cualquier acción permitida por sus grants actuales. No habilitar tráfico productivo sin el cutover aprobado.

## Orden final

### PHASE A — READ-ONLY PREFLIGHT

Ejecutar manualmente, con autorización, `docs/PRODUCTION_SYNC_BACKEND_PREFLIGHT_READ_ONLY.sql`. Revisar history de Supabase, baseline, matrices, grants, RLS/FORCE RLS, policies, endpoints, tokens ownerless y readiness 0015. Resolver cada `FAIL`/`REVIEW_REQUIRED`; no inferir estado productivo ni ejecutar migraciones parciales.

### PHASE B — ADDITIVE SERVER INFRASTRUCTURE

Aplicar cada archivo original completo, individualmente, y verificarlo con consultas read-only antes del siguiente paso:

1. `0009_lubrication_execution_gateway_PREPARED.sql`
2. `0010_evidence_gateway_PREPARED.sql`
3. `0011_operational_catalog_gateway_PREPARED.sql`
4. `0012_authorization_scope_bootstrap_PREPARED.sql`
5. `0013_authorization_row_scope_PREPARED.sql`
6. `0014_assignment_skip_gateways_PREPARED.sql`
7. `0007_push_tokens_ownership_rls_PREPARED.sql`

`0006_notification_dispatch_log_rls_PREPARED.sql` solo si se confirma que ese store es necesario. No aplicar 0008. No concatenar scripts. Detenerse ante cualquier error, objeto parcial, firma distinta o postcondición no PASS. 0007 requiere cliente/token compatibles y validación de propietarios antes de aplicarse.

### PHASE C — SERVER VALIDATION

Confirmar RPC signatures/ACLs, perfil Auth activo, helper de autorización, cuatro policies row-scope y `rowScopeEnforced=true`, más guards RESTRICTIVE de 0007 para `authenticated`. Comprobar first-pull capability con cuentas autorizadas y scopes reales. La policy legacy todavía deja riesgo anon. No probar con impersonación ni datos de producción.

### PHASE D — CLIENT COMPATIBILITY VALIDATION

Validar Web compatible contra backend preparado sin borrar IndexedDB: Auth válido antes de sync, bootstrap, scope, pull y operaciones RPC. Después preparar Android desde el mismo `dist` y verificar artefactos antes de instalar. No publicar/desplegar como parte de este runbook. La validación Web pre-cutover solo puede autorizarse en un entorno controlado y consciente del riesgo anon; no equivale a release seguro.

### PHASE E — CONTROLLED CUTOVER

En una ventana aprobada y con cliente compatible listo:

1. Aplicar `0015_store_permission_target_PREPARED.sql`; su guard de catálogo aborta si falta cualquier policy de 0007 o está debilitada.
2. Validar 72 filas únicas, valores de matriz objetivo y digest registrado; repetir el preflight y confirmar todos los gates del cutover.
3. Ejecutar una vez `AUTH_RLS_FINAL_CUTOVER_PREPARED.sql` completo. No ejecutar 0003 aparte.
4. Confirmar policy legacy ausente, anon sin privilegios de tabla, RLS activo, permisos authenticated bajo RLS, 0007 owner guards y digest intacto.

No proceder si cambió la matriz después de 0015, faltan policies, `rowScopeEnforced` no está habilitado, o existe discrepancia de grants/owners.

### PHASE F — POST VALIDATION

Validar con las cuatro cuentas/roles autorizados y scopes reales: login, bootstrap, first pull, datos A/B aislados, sync, RPCs, token propio, Web y Android. Confirmar anon denegado al store. Detener despliegue/expansión de uso si cualquiera difiere.

## Compatibilidad del cliente antes de 0015

| Flujo | Funciona pre-0015 | Limitación | Requiere 0015 |
|---|---|---|---|
| Bootstrap / first pull | Sí, si baseline + 0012 + 0013 y sesión/scopes válidos | La policy legacy mantiene riesgo anon; validar perfil/scope real. | No por diseño de endpoint; la matriz actual debe permitir lectura. |
| Full sync | Condicional, no certificar | `fullSync()` puede empujar writes; necesita todos los gateways y permisos actuales. No existe modo “solo lectura”. | La matriz final debe concordar con las operaciones genéricas remanentes. |
| Engrase | Sí, con 0009 | Requiere wrapper compatible y permiso/rol/scope actual. | No debe depender de mutación genérica. |
| Evidencia/anomalía/validación | Sí, con 0010 | Wrapper authenticated; old direct-write clients deben retirarse; storage policy/bucket debe ser compatible. | No debe depender de mutación genérica. |
| Catálogo/equipo/plan/settings | Sí, con 0011 | Gateway y rol/scope correcto; validar permisos existentes antes de 0015. | La matriz final debe conservar los permisos de lectura necesarios. |
| Assignments/skips | Sí, con 0014 | Row scope activo y wrapper correcto. | No debe depender de mutación genérica. |
| Push tokens | Sí, con 0007 y propietario verificable | Ownerless legacy queda inaccesible; legacy anon sigue expuesto hasta cutover. | 0015 habilita RIU genérico; exige guards 0007 instalados. |

**¿Puede probarse Web sync antes del cutover?** Solo como prueba controlada/limitada tras B y C, con sesión real, cliente compatible, scopes validados y decisión explícita de aceptar que anon sigue abierto. No constituye prueba de seguridad completa ni autorización para producción general. La ausencia de 0015 puede hacer que algunas capacidades del cliente no tengan el permiso final esperado; registrar cada flujo como condicional, no declarar compatibilidad total.

## Tokens históricos sin propietario

El preflight identifica filas `push_tokens` cuyo JSON no tiene `userId`, sin seleccionar ni mostrar el valor del token o identidades. Solo muestra un localizador de fila truncado, `active`, ausencia de `userId` y si el prefijo del id permite resolver un `app_user_id` existente. Clasificación sugerida: `RECONCILE` si el perfil propietario se puede corroborar; `DEACTIVATE` como candidato si ya está inactivo/no utilizable; `UNKNOWN` si no se puede demostrar propietario. La decisión se hace con resultados productivos autorizados. No hay reparación, reasignación ni desactivación automática.

## Rollback y stop conditions

- Migración fallida: parar y usar únicamente el rollback específico después de revisar sus precondiciones. Los rollback `safe-stop` no necesariamente eliminan schema/recibos/datos.
- 0015 no tiene rollback aislado; el rollback final restaura una matriz previa bajo condiciones y nunca recrea la policy legacy. Revisarlo antes de la autorización del cutover.
- Si el cutover falla, detener sync y no improvisar SQL. No restaurar anon como atajo.
- Parar ante grants inesperados, guards 0007 débiles, matriz/digest distinto, token ownerless que requiera operar, `rowScopeEnforced != true`, Auth/scope inválido, error SQL, o divergencia Web/Android.

Este artefacto es solo preparación local. No se conectó a producción, ejecutó SQL, aplicó migraciones, modificó datos, hizo push/deploy ni tocó los cambios DAY/NIGHT.
