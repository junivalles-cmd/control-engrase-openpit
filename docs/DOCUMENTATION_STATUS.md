# Estado de la documentación y fuentes de verdad

Actualizado: 2026-10-25

## CURRENT

- `docs/MIGRATION_STATUS.md`: estado y orden de las migraciones.
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/`: SQL
  versionado; revisar el encabezado de cada migración antes de aplicar.
- `docs/OPERATIONAL_SCOPE.md`: autorización y alcance operativo actuales.
- `docs/PRODUCTION_SYNC_BACKEND_ADDITIVE_RUNBOOK.md`: procedimiento de
  preparación/verificación del backend sin alterar datos.
- `docs/ANDROID_INSTALLATION.md`, `docs/WEB_DEPLOYMENT.md` y
  `docs/VITE_MIGRATION.md`: instalación y despliegue actuales; siempre
  generar `dist/` y ejecutar `verify:dist`.

## HISTORICAL / DEPRECATED

- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/schema.sql`: baseline inicial;
  contiene policy abierta y bucket público. No es instalador vigente.
- `docs/AUTH_RLS_MIGRATION_DESIGN.md` y
  `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`: diseño y rollout de la transición
  Auth/RLS; contienen estados legacy deliberadamente documentados.
- `docs/PROD_PRECUTOVER_AUTH_2026-09-26.md` y
  `docs/SESSION_HANDOFF.md`: fotografías históricas de un cutover pendiente.
- `docs/STORAGE_PRIVACY_DESIGN.md`: preparación histórica de Storage privado;
  sus referencias a bucket público no describen una configuración final.
- `docs/RELEASE_v1.0.0-rc1.md` y `docs/PILOTO_CAMPO_v1.0.0-rc1.md`:
  release candidate/piloto históricos. Quick Unlock/PIN y los menús de esa
  versión no son parte del flujo actual.

Los documentos históricos se conservan para auditoría y trazabilidad; no
deben usarse como instrucciones de instalación, despliegue o seguridad.

## Reglas de lectura

1. Si un documento histórico contradice una migración aplicada o la app
   actual, prevalecen las migraciones y los documentos CURRENT.
2. No ejecutar SQL encontrado en un documento de diseño, rollback,
   preflight o release anterior sin confirmar primero su estado y objetivo.
3. No interpretar URLs `/storage/v1/object/public/` de evidencias históricas
   como autorización para publicar el bucket actual.
