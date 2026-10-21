-- CONTROL_ENGRASE — preflight read-only para backend de sync PRE-0008.
-- Ejecutar manualmente en Supabase SQL Editor cuando se autorice el preflight.
-- Este archivo contiene únicamente SELECT/CTE sobre information_schema/pg_catalog
-- y lecturas de las tablas existentes. No aplica ni simula migraciones.
-- Cada bloque devuelve check, status, expected, actual, impact y action.

-- 1) Objetos base, columnas, RLS y prerequisite de instalación.
WITH expected_objects(object_name, relation_name) AS (
  VALUES ('engrase_sync','public.engrase_sync'),
         ('app_profiles','public.app_profiles'),
         ('app_store_permissions','public.app_store_permissions'),
         ('storage.objects','storage.objects'),
         ('storage.buckets','storage.buckets')
), relation_state AS (
  SELECT e.object_name, e.relation_name, c.oid,
         c.relrowsecurity, c.relforcerowsecurity,
         pg_catalog.pg_get_userbyid(c.relowner) AS owner_name
  FROM expected_objects e
  LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.relation_name)
), column_expectations(table_name,column_name) AS (
  VALUES ('engrase_sync','store'),('engrase_sync','id'),('engrase_sync','payload'),
         ('engrase_sync','updated_at'),('engrase_sync','deleted'),
         ('app_profiles','auth_user_id'),('app_profiles','app_user_id'),
         ('app_profiles','display_name'),('app_profiles','role'),('app_profiles','active'),
         ('app_store_permissions','store'),('app_store_permissions','role'),
         ('app_store_permissions','can_read'),('app_store_permissions','can_insert'),
         ('app_store_permissions','can_update'),('app_store_permissions','can_delete')
), checks AS (
  SELECT 'relation:'||object_name AS check,
         CASE WHEN oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'relation exists' AS expected,
         CASE WHEN oid IS NULL THEN 'missing' ELSE 'present; owner='||owner_name END AS actual,
         'Required schema object for sync/backend gateways.' AS impact,
         CASE WHEN oid IS NULL THEN 'Stop; reconcile the baseline before any migration.' ELSE 'Continue.' END AS action
  FROM relation_state
  UNION ALL
  SELECT 'columns:'||e.table_name,
         CASE WHEN count(*) FILTER (WHERE c.column_name IS NULL)=0 THEN 'PASS' ELSE 'FAIL' END,
         'all expected columns exist',
         coalesce(string_agg(e.column_name,', ' ORDER BY e.column_name) FILTER (WHERE c.column_name IS NULL),'all present'),
         'Missing columns can break authorization, RPCs, or sync.',
         CASE WHEN count(*) FILTER (WHERE c.column_name IS NULL)>0 THEN 'Stop; inspect baseline schema.' ELSE 'Continue.' END
  FROM column_expectations e
  LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
  GROUP BY e.table_name
  UNION ALL
  SELECT 'rls:'||object_name,
         CASE WHEN oid IS NULL THEN 'FAIL'
              WHEN object_name='storage.buckets' THEN 'PASS'
              WHEN NOT relrowsecurity THEN 'FAIL'
              WHEN object_name IN ('engrase_sync','app_profiles') AND (relforcerowsecurity OR owner_name<>current_user) THEN 'FAIL'
              ELSE 'PASS' END,
         CASE WHEN object_name='storage.buckets' THEN 'Storage catalog available; inspect policies separately'
              WHEN object_name='storage.objects' THEN 'RLS enabled'
              WHEN object_name='app_store_permissions' THEN 'RLS enabled; inspect policies and grants separately'
              ELSE 'RLS enabled, FORCE RLS disabled, installer owns relation' END,
         CASE WHEN oid IS NULL THEN 'missing'
              ELSE 'rls='||relrowsecurity||'; force='||relforcerowsecurity||'; owner='||owner_name END,
         'RLS and ownership are prerequisites for safe SECURITY DEFINER migrations.',
         CASE WHEN oid IS NULL OR NOT relrowsecurity
                OR (object_name IN ('engrase_sync','app_profiles') AND (relforcerowsecurity OR owner_name<>current_user))
              THEN 'Stop and reconcile exact prerequisite; do not bypass it.' ELSE 'Continue.' END
  FROM relation_state
)
SELECT check,status,expected,actual,impact,action FROM checks ORDER BY check;

-- Policies for the profile and permission control tables; expose definitions,
-- not profile data. Review against the approved 0002 state.
SELECT 'policy:'||tablename||':'||policyname AS check,'REVIEW_REQUIRED' AS status,
       'compare with approved app_profiles/app_store_permissions policy set',
       permissive||' / '||cmd||'; roles='||roles::text||'; USING='||coalesce(qual,'')||'; CHECK='||coalesce(with_check,''),
       'These tables are the authority for Auth identity and store capabilities.',
       'Compare every row with migration 0002 and known production evidence; do not alter from this query.' AS action
FROM pg_catalog.pg_policies
WHERE schemaname='public' AND tablename IN ('app_profiles','app_store_permissions')
UNION ALL
SELECT 'policy:profile-and-permission-tables', 'REVIEW_REQUIRED',
       'policies for app_profiles and app_store_permissions are present as designed',
       'no policies returned','No expected policy rows were found in the catalog.',
       'Stop and inspect migration history before proceeding.'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public'
  AND tablename IN ('app_profiles','app_store_permissions'));

-- Aggregate role/profile state only; no names, emails, UUIDs, or profile rows.
SELECT 'app_profiles:role-counts' AS check,'REVIEW_REQUIRED' AS status,
       'only approved active roles; at least the expected operational profiles',
       coalesce(string_agg(role||' active='||active_count||' inactive='||inactive_count,', ' ORDER BY role),'no profile aggregates'),
       'Missing or inactive profiles can block login/bootstrap; identities remain private.',
       'Review aggregate counts with the authorized account roster; this query does not expose identifiers.' AS action
FROM (SELECT role,count(*) FILTER(WHERE active) AS active_count,
             count(*) FILTER(WHERE NOT active) AS inactive_count
      FROM public.app_profiles GROUP BY role) profiles;

-- The inspected migrations require no non-core extension (their hashing uses
-- pg_catalog.md5); list installed extensions as read-only environment context.
SELECT 'extensions:inventory' AS check,'PASS' AS status,
       'no extra extension required by 0006/0007/0009-0015',
       coalesce(string_agg(extname||' '||extversion,', ' ORDER BY extname),'none reported'),
       'Environment inventory only; this does not install or alter extensions.',
       'Review only if the inspected migration source changes.' AS action
FROM pg_catalog.pg_extension;

-- 1b) Auth helper and grants on the generic transport. The legacy policy does
-- not itself grant SQL privileges; both layers must be reviewed independently.
WITH state AS (
 SELECT pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_exists,
        pg_catalog.to_regclass('public.engrase_sync') AS sync_oid
)
SELECT 'helper:auth.uid' AS check,
       CASE WHEN auth_uid_exists THEN 'PASS' ELSE 'FAIL' END AS status,
       'auth.uid() exists',CASE WHEN auth_uid_exists THEN 'present' ELSE 'missing' END,
       'Bootstrap and row-scope functions depend on the Supabase Auth identity helper.',
       CASE WHEN auth_uid_exists THEN 'Continue.' ELSE 'Stop before installing 0012.' END AS action
FROM state
UNION ALL
SELECT 'table-grants:engrase_sync',
       'REVIEW_REQUIRED',
       'authenticated needs SELECT/INSERT/UPDATE; anon grants must be reviewed separately from RLS; no hard DELETE expected',
       'authenticated S='||has_table_privilege('authenticated',sync_oid,'SELECT')||
       ' I='||has_table_privilege('authenticated',sync_oid,'INSERT')||
       ' U='||has_table_privilege('authenticated',sync_oid,'UPDATE')||
       ' D='||has_table_privilege('authenticated',sync_oid,'DELETE')||
       '; anon S='||has_table_privilege('anon',sync_oid,'SELECT')||
       ' I='||has_table_privilege('anon',sync_oid,'INSERT')||
       ' U='||has_table_privilege('anon',sync_oid,'UPDATE')||
       ' D='||has_table_privilege('anon',sync_oid,'DELETE'),
       'Privileges and RLS are separate gates. The later 0003 cutover revokes anon table privileges.',
       'Compare against the approved grants and cutover plan; do not change grants from this preflight.'
FROM state WHERE sync_oid IS NOT NULL;

-- Existing helper signatures required by the Auth/RLS baseline and row-scope.
WITH expected(name,signature) AS (VALUES
 ('current_app_role','public.current_app_role()'),
 ('current_app_active','public.current_app_active()'),
 ('get_authorization_context','public.get_authorization_context()'),
 ('resolve_authorization_scope','public.resolve_authorization_scope(uuid)'),
 ('authorization_row_in_scope','authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)'))
SELECT 'helper:'||name AS check,
       CASE WHEN pg_catalog.to_regprocedure(signature) IS NOT NULL THEN 'PASS' ELSE 'REVIEW_REQUIRED' END AS status,
       signature||' exists after its expected migration',
       coalesce(pg_catalog.to_regprocedure(signature)::text,'absent'),
       'Missing helpers can prevent role resolution, first pull, or restrictive scope evaluation.',
       'Absent before its migration is expected; after that migration, stop and inspect.'
FROM expected ORDER BY name;

-- 2) Existing policies on engrase_sync. Presence of the legacy policy is an
-- explicit REVIEW_REQUIRED during the additive phase; this query never removes it.
WITH expected(policyname, expected_permissive, expected_cmd) AS (
  VALUES ('acceso interno con anon key','PERMISSIVE','ALL'),
         ('engrase_sync: leer según matriz','PERMISSIVE','SELECT'),
         ('engrase_sync: crear según matriz','PERMISSIVE','INSERT'),
         ('engrase_sync: actualizar según matriz','PERMISSIVE','UPDATE'),
         ('authorization_scope_select','RESTRICTIVE','SELECT'),
         ('authorization_scope_insert','RESTRICTIVE','INSERT'),
         ('authorization_scope_update','RESTRICTIVE','UPDATE'),
         ('authorization_scope_delete','RESTRICTIVE','DELETE'),
         ('push_tokens_select_owner_only','RESTRICTIVE','SELECT'),
         ('push_tokens_insert_owner_only','RESTRICTIVE','INSERT'),
         ('push_tokens_update_owner_only','RESTRICTIVE','UPDATE'),
         ('push_tokens_no_hard_delete','RESTRICTIVE','DELETE'),
         ('evidence_rpc_insert_only','RESTRICTIVE','INSERT'),
         ('evidence_rpc_update_only','RESTRICTIVE','UPDATE'),
         ('evidence_rpc_delete_only','RESTRICTIVE','DELETE'),
         ('assignment_skip_rpc_insert_only','RESTRICTIVE','INSERT'),
         ('assignment_skip_rpc_update_only','RESTRICTIVE','UPDATE'),
         ('assignment_skip_rpc_delete_only','RESTRICTIVE','DELETE'),
         ('catalog_insert_roles','RESTRICTIVE','INSERT'),
         ('catalog_update_roles','RESTRICTIVE','UPDATE'),
         ('catalog_delete_roles','RESTRICTIVE','DELETE'),
         ('catalog_settings_read','PERMISSIVE','SELECT')
), actual AS (
  SELECT policyname, permissive, cmd, roles::text AS roles,
         coalesce(qual,'') AS using_expr, coalesce(with_check,'') AS check_expr
  FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='engrase_sync'
)
SELECT 'policy:'||e.policyname AS check,
       CASE WHEN a.policyname IS NULL AND e.policyname='acceso interno con anon key' THEN 'FAIL'
            WHEN a.policyname IS NULL THEN 'REVIEW_REQUIRED'
            WHEN e.policyname='acceso interno con anon key' THEN 'REVIEW_REQUIRED'
            WHEN a.permissive<>e.expected_permissive OR a.cmd<>e.expected_cmd THEN 'FAIL'
            ELSE 'PASS' END AS status,
       e.expected_permissive||' / '||e.expected_cmd,
       coalesce(a.permissive||' / '||a.cmd||'; roles='||a.roles||'; USING='||a.using_expr||'; CHECK='||a.check_expr,'absent'),
       CASE WHEN e.policyname='acceso interno con anon key'
         THEN 'Temporary public ALL true/true policy can expose rows while present; 0013 row-scope RESTRICTIVE policies also apply to public.'
         ELSE 'Policy state must match the migration stage; permissive and restrictive policies combine differently.' END,
       CASE WHEN e.policyname='acceso interno con anon key' THEN 'Keep only for the approved temporary phase; schedule separate reviewed cutover.'
            WHEN a.policyname IS NULL THEN 'Compare with migration stage; missing before its step is expected, missing after is a stop.'
            WHEN a.permissive<>e.expected_permissive OR a.cmd<>e.expected_cmd THEN 'Stop; inspect the definition and migration history.'
            ELSE 'Continue.' END AS action
FROM expected e LEFT JOIN actual a USING(policyname)
ORDER BY e.policyname;

-- Storage policies are shown verbatim as catalog metadata, without object data.
SELECT 'storage-policy:'||policyname AS check,
       CASE WHEN policyname IN ('signature_objects_immutable_update','signature_objects_immutable_delete')
         AND permissive='RESTRICTIVE' THEN 'PASS'
            WHEN policyname IN ('signature_objects_immutable_update','signature_objects_immutable_delete') THEN 'FAIL'
            ELSE 'REVIEW_REQUIRED' END AS status,
       '0010 immutable UPDATE/DELETE policies must be RESTRICTIVE after 0010',
       permissive||' / '||cmd||'; roles='||roles::text||'; USING='||coalesce(qual,'')||'; CHECK='||coalesce(with_check,''),
       'Storage policies govern evidence mutation and must be checked alongside bucket/object RLS.',
       'Review every listed Storage policy against 0005 and 0010; do not alter them from this query.'
FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
UNION ALL
SELECT 'storage-policy:0010-immutable-policies',
       'REVIEW_REQUIRED','both immutable policies exist after 0010',
       'listed above only when present','A missing row before 0010 is expected; after 0010 it indicates incomplete installation.',
       'Compare after the named migration.'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='signature_objects_immutable_update')
   OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='signature_objects_immutable_delete');

-- 3) RPC endpoints and signatures required by this rollout.
WITH expected(name, signature, stage) AS (
  VALUES
   ('public.get_authorization_context','public.get_authorization_context()','0012'),
   ('public.resolve_authorization_scope','public.resolve_authorization_scope(uuid)','0012'),
   ('public.lubrication_execution','public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz)','0009'),
   ('public.evidence_operation','public.evidence_operation(text,text,text,text,text,timestamptz,text,text,text,text,jsonb,text,text,text,text,text,jsonb)','0010'),
   ('public.report_anomaly','public.report_anomaly(text,text,text,text,text,text,text,jsonb)','0010'),
   ('public.edit_anomaly','public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb)','0010'),
   ('public.close_anomaly','public.close_anomaly(text,text,text,timestamptz,text)','0010'),
   ('public.retire_anomaly','public.retire_anomaly(text,text,timestamptz)','0010'),
   ('public.repeat_anomaly_from_execution','public.repeat_anomaly_from_execution(text,text,text,timestamptz)','0010'),
   ('public.capture_grease_validation','public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text)','0010'),
   ('public.resolve_grease_validation_conflict','public.resolve_grease_validation_conflict(text,text,text,text,jsonb)','0010'),
   ('public.catalog_writer_role','public.catalog_writer_role()','0011'),
   ('public.operational_catalog_operation','public.operational_catalog_operation(text,text,text,text,timestamptz,text,text,date,text,numeric,boolean)','0011'),
   ('public.move_equipment_master_location','public.move_equipment_master_location(text,text,timestamptz,text)','0011'),
   ('public.set_equipment_shift','public.set_equipment_shift(text,text,timestamptz,text)','0011'),
   ('public.set_equipment_alert_pause','public.set_equipment_alert_pause(text,text,text,timestamptz,date,text)','0011'),
   ('public.update_equipment_hourmeter','public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean)','0011'),
   ('public.reprogram_lubrication_plan','public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text)','0011'),
   ('public.assignment_skip_operation','public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)','0014'),
   ('public.manage_lubrication_assignment','public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)','0014'),
   ('public.record_lubrication_skip','public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)','0014')
), state AS (
  SELECT e.*, pg_catalog.to_regprocedure(e.signature) IS NOT NULL AS exists_now,
         pg_catalog.to_regprocedure(e.signature)::oid AS proc_oid
  FROM expected e
)
SELECT 'rpc:'||name AS check,
       CASE WHEN exists_now THEN 'PASS' ELSE 'REVIEW_REQUIRED' END AS status,
       signature||' installed after migration '||stage,
       CASE WHEN exists_now THEN pg_catalog.pg_get_function_identity_arguments(proc_oid) ELSE 'absent' END,
       'A missing endpoint blocks only its dependent client operation; conflicting signatures need review.',
       CASE WHEN exists_now THEN 'Inspect EXECUTE ACL in check 4.' ELSE 'Expected before its migration; after the step, stop and verify deployment.' END
FROM state ORDER BY stage,name;

-- Overload/conflict inventory for endpoint names: exact signature presence is
-- checked above; additional signatures require human review rather than being ignored.
WITH expected_names(name) AS (VALUES
 ('get_authorization_context'),('resolve_authorization_scope'),('lubrication_execution'),
 ('evidence_operation'),('operational_catalog_operation'),('assignment_skip_operation'),
 ('manage_lubrication_assignment'),('record_lubrication_skip'))
SELECT 'rpc-overloads:'||n.name AS check,
       CASE WHEN count(p.oid)=0 THEN 'REVIEW_REQUIRED'
            WHEN count(p.oid)=1 THEN 'PASS' ELSE 'REVIEW_REQUIRED' END AS status,
       'one endpoint signature per migration design; zero before install is expected',
       count(p.oid)::text||coalesce(': '||string_agg(pg_catalog.oidvectortypes(p.proargtypes),'; ' ORDER BY p.oid),' (none)'),
       'Unexpected overloads can leave stale or ambiguous API entry points.',
       'Compare every existing signature with the exact migration and client call; do not drop functions from this preflight.'
FROM expected_names n
LEFT JOIN pg_catalog.pg_proc p ON p.proname=n.name AND p.pronamespace IN
  (pg_catalog.to_regnamespace('public'),pg_catalog.to_regnamespace('authorization_private'))
GROUP BY n.name ORDER BY n.name;

-- 4) RPC execute privileges. Checks are catalog-only; no endpoint is invoked.
WITH expected(signature,stage) AS (
  VALUES ('public.get_authorization_context()','0012'),
         ('public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz)','0009'),
         ('public.evidence_operation(text,text,text,text,text,timestamptz,text,text,text,text,jsonb,text,text,text,text,text,jsonb)','0010'),
         ('public.report_anomaly(text,text,text,text,text,text,text,jsonb)','0010'),
         ('public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb)','0010'),
         ('public.close_anomaly(text,text,text,timestamptz,text)','0010'),
         ('public.retire_anomaly(text,text,timestamptz)','0010'),
         ('public.repeat_anomaly_from_execution(text,text,text,timestamptz)','0010'),
         ('public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text)','0010'),
         ('public.resolve_grease_validation_conflict(text,text,text,text,jsonb)','0010'),
         ('public.catalog_writer_role()','0011'),
         ('public.operational_catalog_operation(text,text,text,text,timestamptz,text,text,date,text,numeric,boolean)','0011'),
         ('public.move_equipment_master_location(text,text,timestamptz,text)','0011'),
         ('public.set_equipment_shift(text,text,timestamptz,text)','0011'),
         ('public.set_equipment_alert_pause(text,text,text,timestamptz,date,text)','0011'),
         ('public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean)','0011'),
         ('public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text)','0011'),
         ('public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)','0014'),
         ('public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)','0014')
), state AS (
  SELECT signature,stage,pg_catalog.to_regprocedure(signature)::oid AS oid FROM expected
)
SELECT 'execute_acl:'||signature AS check,
       CASE WHEN oid IS NULL THEN 'REVIEW_REQUIRED'
            WHEN has_function_privilege('authenticated',oid,'EXECUTE')
             AND NOT has_function_privilege('anon',oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc p,
                 LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
               WHERE p.oid=state.oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
             ) THEN 'PASS'
            ELSE 'FAIL' END AS status,
       'authenticated EXECUTE; anon and PUBLIC no EXECUTE after stage '||stage,
       CASE WHEN oid IS NULL THEN 'function absent'
            ELSE 'authenticated='||has_function_privilege('authenticated',oid,'EXECUTE')||
                 '; anon='||has_function_privilege('anon',oid,'EXECUTE')||
                 '; PUBLIC EXECUTE='||EXISTS (
                   SELECT 1 FROM pg_catalog.pg_proc p,
                     LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
                   WHERE p.oid=state.oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
                 ) END,
       'Incorrect EXECUTE privileges can block valid users or expose SECURITY DEFINER operations.',
       CASE WHEN oid IS NULL THEN 'Check after installing the named migration.'
            WHEN has_function_privilege('authenticated',oid,'EXECUTE')
             AND NOT has_function_privilege('anon',oid,'EXECUTE')
             AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc p,
                 LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
               WHERE p.oid=state.oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
             ) THEN 'Continue.'
            ELSE 'Stop; compare exact function ACL with migration grants/revokes.' END
FROM state ORDER BY stage,signature;

-- Internal SECURITY DEFINER implementations are intentionally not API-callable.
WITH expected(signature,stage) AS (VALUES
 ('public.resolve_authorization_scope(uuid)','0012'),
 ('public.evidence_operation(text,text,text,text,text,timestamptz,text,text,text,text,jsonb,text,text,text,text,text,jsonb)','0010'),
 ('public.operational_catalog_operation(text,text,text,text,timestamptz,text,text,date,text,numeric,boolean)','0011'),
 ('public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)','0014')),
state AS (SELECT signature,stage,pg_catalog.to_regprocedure(signature)::oid AS oid FROM expected)
SELECT 'internal-execute-revoked:'||signature AS check,
       CASE WHEN oid IS NULL THEN 'REVIEW_REQUIRED'
            WHEN has_function_privilege('authenticated',oid,'EXECUTE') OR has_function_privilege('anon',oid,'EXECUTE')
              OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p,
                LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
                WHERE p.oid=state.oid AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'FAIL'
            ELSE 'PASS' END AS status,
       'no EXECUTE for authenticated, anon or PUBLIC after '||stage,
       CASE WHEN oid IS NULL THEN 'function absent'
            ELSE 'authenticated='||has_function_privilege('authenticated',oid,'EXECUTE')||
              '; anon='||has_function_privilege('anon',oid,'EXECUTE') END,
       'Only typed wrapper functions should be callable through PostgREST.',
       'Stop if any client role or PUBLIC can call the internal implementation.'
FROM state ORDER BY stage,signature;

-- 0013 classifier is executable by authenticated policy evaluation only.
WITH state AS (SELECT pg_catalog.to_regprocedure(
 'authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')::oid AS oid)
SELECT 'row-helper:execute-acl' AS check,
       CASE WHEN oid IS NULL THEN 'REVIEW_REQUIRED'
            WHEN has_function_privilege('authenticated',oid,'EXECUTE')
             AND NOT has_function_privilege('anon',oid,'EXECUTE')
             AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p,
               LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
               WHERE p.oid=state.oid AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END,
       'authenticated EXECUTE; anon/PUBLIC revoked',
       CASE WHEN oid IS NULL THEN 'function absent'
            ELSE 'authenticated='||has_function_privilege('authenticated',oid,'EXECUTE')||
              '; anon='||has_function_privilege('anon',oid,'EXECUTE') END,
       'RLS evaluation needs authenticated access to the private classifier without exposing it anonymously.',
       'Verify after 0013 and inspect authorization_private schema USAGE.'
FROM state;

-- 4b) 0012 SECURITY DEFINER hardening and 0013 fail-closed anonymous behavior.
WITH bootstrap AS (
 SELECT p.oid,p.prosecdef,p.proconfig,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec,
        EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec
 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_authorization_context()')
), scope_policy AS (
 SELECT * FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='engrase_sync'
   AND policyname='authorization_scope_select'
), helper AS (
 SELECT p.oid,pg_catalog.pg_get_functiondef(p.oid) AS definition
 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(
   'authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')
)
SELECT 'bootstrap:security-definer-search-path' AS check,
       CASE WHEN EXISTS(SELECT 1 FROM bootstrap WHERE prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']) THEN 'PASS'
            WHEN NOT EXISTS(SELECT 1 FROM bootstrap) THEN 'REVIEW_REQUIRED' ELSE 'FAIL' END AS status,
       'get_authorization_context is SECURITY DEFINER with search_path=pg_catalog',
       coalesce((SELECT 'security_definer='||prosecdef||'; proconfig='||coalesce(proconfig::text,'(default)') FROM bootstrap),'function absent'),
       'A fixed search_path prevents object-shadowing attacks in SECURITY DEFINER code.',
       'Verify after 0012; do not proceed if the function exists with a different search_path.' AS action
UNION ALL
SELECT 'bootstrap:execute-roles',
       CASE WHEN NOT EXISTS(SELECT 1 FROM bootstrap) THEN 'REVIEW_REQUIRED'
            WHEN (SELECT auth_exec AND NOT anon_exec AND NOT public_exec FROM bootstrap) THEN 'PASS' ELSE 'FAIL' END,
       'authenticated EXECUTE; anon and PUBLIC revoked',
       coalesce((SELECT 'authenticated='||auth_exec||'; anon='||anon_exec||'; PUBLIC='||public_exec FROM bootstrap),'function absent'),
       'Unauthenticated callers must not retrieve authorization context.',
       'Verify after 0012; stop on any anon/PUBLIC EXECUTE.'
UNION ALL
SELECT 'row-scope:authenticated-intersection',
       CASE WHEN NOT EXISTS(SELECT 1 FROM scope_policy) OR NOT EXISTS(SELECT 1 FROM helper) THEN 'REVIEW_REQUIRED'
            WHEN (SELECT permissive='RESTRICTIVE' AND cmd='SELECT' AND 'authenticated'=ANY(roles)
                    AND NOT ('public'=ANY(roles)) FROM scope_policy)
             AND (SELECT definition ILIKE '%auth.uid() is null%' FROM helper) THEN 'PASS'
            ELSE 'FAIL' END,
       '0013 restrictive SELECT applies to authenticated only; helper fails closed for null auth',
       coalesce((SELECT permissive||' / '||cmd||'; roles='||roles::text||'; USING='||coalesce(qual,'') FROM scope_policy),'policy absent')||
         coalesce('; helper null-auth guard='||((SELECT definition ILIKE '%auth.uid() is null%' FROM helper))::text,'; helper absent'),
       'Authenticated matrix PERMISSIVE policies intersect row-scope RESTRICTIVE policies. These policies do not apply to anon.',
       'Verify after 0013. Continue to treat anon as allowed by the legacy policy until separate 0003 cutover.'
UNION ALL
SELECT 'row-scope:legacy-anon-access',
       CASE WHEN NOT EXISTS(SELECT 1 FROM scope_policy) THEN 'REVIEW_REQUIRED'
            WHEN NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='engrase_sync'
                    AND policyname='acceso interno con anon key') THEN 'PASS'
            WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_policies l,scope_policy s
                    WHERE l.schemaname='public' AND l.tablename='engrase_sync'
                      AND l.policyname='acceso interno con anon key' AND l.permissive='PERMISSIVE' AND l.cmd='ALL'
                      AND 'public'=ANY(l.roles) AND lower(coalesce(l.qual,''))='true' AND lower(coalesce(l.with_check,''))='true'
                      AND s.permissive='RESTRICTIVE' AND 'authenticated'=ANY(s.roles) AND NOT ('public'=ANY(s.roles))) THEN 'REVIEW_REQUIRED'
            ELSE 'FAIL' END,
       'legacy absent after cutover; if present with true/true, anon remains allowed under table grants',
       coalesce((SELECT 'legacy='||permissive||'/'||cmd||'; roles='||roles::text||'; USING='||coalesce(qual,'')||'; CHECK='||coalesce(with_check,'')
                 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='engrase_sync'
                   AND policyname='acceso interno con anon key'),'legacy policy absent'),
       '0013 scope policies target authenticated, so they do not intersect anon with the legacy permissive policy.',
       'Keep REVIEW_REQUIRED during this temporary phase. The separate 0003 cutover is required to remove anon access.';

-- 5) Permission matrix baseline (72 rows = 18 stores x 4 operational roles).
-- It does not assert the 0015 target matrix; that migration intentionally changes bits.
WITH roles(role) AS (VALUES ('ADMINISTRADOR'),('PLANIFICADOR'),('SUPERVISOR'),('LUBRICADOR')),
stores(store) AS (VALUES ('anomalies'),('audit_log'),('cuadrillas'),('equipment'),('equipment_types'),
 ('grease_validations'),('locations'),('lubricants'),('lubrication_assignments'),('lubrication_plans'),
 ('lubrication_points'),('lubrication_records'),('lubrication_skips'),('notification_dispatch_log'),
 ('push_tokens'),('settings'),('shifts'),('users')),
expected AS (SELECT store,role FROM stores CROSS JOIN roles),
actual AS (SELECT store,role,count(*) AS copies FROM public.app_store_permissions p
  WHERE store IN (SELECT store FROM stores) AND role IN (SELECT role FROM roles) GROUP BY store,role),
delta AS (
 SELECT e.store,e.role,coalesce(a.copies,0) AS copies FROM expected e LEFT JOIN actual a USING(store,role)
 UNION ALL
 SELECT a.store,a.role,a.copies FROM actual a LEFT JOIN expected e USING(store,role) WHERE e.store IS NULL
)
SELECT 'matrix:72-role-store-combinations' AS check,
       CASE WHEN count(*) FILTER(WHERE copies<>1)=0 THEN 'PASS' ELSE 'FAIL' END AS status,
       'exactly one of each expected 72 role/store rows',
       count(*) FILTER(WHERE copies=1)||' valid; '||count(*) FILTER(WHERE copies=0)||' missing; '||
         count(*) FILTER(WHERE copies>1)||' duplicates; total='||count(*),
       'Incorrect rows can block sync or leave generic mutation paths open. 0015 replaces several permission bits.',
       CASE WHEN count(*) FILTER(WHERE copies<>1)=0 THEN 'Review current values against approved matrix; do not apply 0015 from this count alone.'
            ELSE 'Stop and reconcile missing/duplicate rows before 0015; this query does not repair them.' END
FROM delta;

-- 6) Storage and receipt-table requirements, plus helper/policy state.
WITH checks AS (
 SELECT 'storage:objects-rls' AS check,
        CASE WHEN c.oid IS NOT NULL AND c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS status,
        'storage.objects exists with RLS enabled',
        coalesce('exists; rls='||c.relrowsecurity,'missing'),
        '0010 requires Storage RLS and creates restrictive evidence-object policies.',
        CASE WHEN c.oid IS NOT NULL AND c.relrowsecurity THEN 'Continue.' ELSE 'Stop before 0010.' END AS action
 FROM (SELECT pg_catalog.to_regclass('storage.objects')::oid AS oid) x
 LEFT JOIN pg_catalog.pg_class c ON c.oid=x.oid
 UNION ALL
 SELECT 'storage:engrase-photos-bucket',
        CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'REVIEW_REQUIRED'
             WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='engrase-photos') THEN 'PASS' ELSE 'FAIL' END,
        'bucket engrase-photos exists',
        CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'storage.buckets unavailable'
             WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='engrase-photos') THEN 'present' ELSE 'missing' END,
        'Evidence RPC validates stored objects in this bucket.',
        CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'Review Storage catalog availability.'
             WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='engrase-photos') THEN 'Continue.' ELSE 'Stop before evidence validation.' END
 UNION ALL
 SELECT 'helper:authorization_private_row_classifier',
        CASE WHEN to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)') IS NOT NULL THEN 'PASS' ELSE 'REVIEW_REQUIRED' END,
        'exists after 0013 with authenticated EXECUTE only',
        coalesce(pg_catalog.to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')::text,'absent'),
        '0013 helper is called by restrictive row-scope policies.',
        'Compare function ACL and schema exposure after 0013.'
 UNION ALL
 SELECT 'receipts:gateway-tables',
        CASE WHEN to_regclass('public.lubrication_execution_receipts') IS NOT NULL
          AND to_regclass('public.evidence_operation_receipts') IS NOT NULL
          AND to_regclass('public.operational_catalog_receipts') IS NOT NULL
          AND to_regclass('public.assignment_skip_operation_receipts') IS NOT NULL THEN 'PASS' ELSE 'REVIEW_REQUIRED' END,
        'receipt tables for 0009, 0010, 0011 and 0014 exist after their steps',
        concat_ws(', ',CASE WHEN to_regclass('public.lubrication_execution_receipts') IS NOT NULL THEN '0009 present' ELSE '0009 absent' END,
          CASE WHEN to_regclass('public.evidence_operation_receipts') IS NOT NULL THEN '0010 present' ELSE '0010 absent' END,
          CASE WHEN to_regclass('public.operational_catalog_receipts') IS NOT NULL THEN '0011 present' ELSE '0011 absent' END,
          CASE WHEN to_regclass('public.assignment_skip_operation_receipts') IS NOT NULL THEN '0014 present' ELSE '0014 absent' END),
        'Missing receipt tables invalidate the corresponding idempotent RPC gateway.',
        'Check the corresponding step; do not infer success from partial objects.'
)
SELECT check,status,expected,actual,impact,action FROM checks ORDER BY check;

-- Receipt tables must remain private to the migration owner; inspect role and
-- PUBLIC ACLs without reading receipt contents.
WITH expected(table_name) AS (VALUES
 ('public.lubrication_execution_receipts'),('public.evidence_operation_receipts'),
 ('public.operational_catalog_receipts'),('public.assignment_skip_operation_receipts')),
state AS (SELECT table_name,pg_catalog.to_regclass(table_name)::oid AS oid FROM expected)
SELECT 'receipt-table-grants:'||table_name AS check,
       CASE WHEN oid IS NULL THEN 'REVIEW_REQUIRED'
            WHEN NOT has_table_privilege('anon',oid,'SELECT') AND NOT has_table_privilege('anon',oid,'INSERT')
             AND NOT has_table_privilege('anon',oid,'UPDATE') AND NOT has_table_privilege('anon',oid,'DELETE')
             AND NOT has_table_privilege('authenticated',oid,'SELECT') AND NOT has_table_privilege('authenticated',oid,'INSERT')
             AND NOT has_table_privilege('authenticated',oid,'UPDATE') AND NOT has_table_privilege('authenticated',oid,'DELETE')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
               LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
               WHERE c.oid=state.oid AND a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) THEN 'PASS'
            ELSE 'FAIL' END AS status,
       'no client-role or PUBLIC table privileges after the gateway migration',
       CASE WHEN oid IS NULL THEN 'table absent'
            ELSE 'anon SELECT/INSERT/UPDATE/DELETE='||has_table_privilege('anon',oid,'SELECT')||'/'||has_table_privilege('anon',oid,'INSERT')||'/'||has_table_privilege('anon',oid,'UPDATE')||'/'||has_table_privilege('anon',oid,'DELETE')||
              '; authenticated SELECT/INSERT/UPDATE/DELETE='||has_table_privilege('authenticated',oid,'SELECT')||'/'||has_table_privilege('authenticated',oid,'INSERT')||'/'||has_table_privilege('authenticated',oid,'UPDATE')||'/'||has_table_privilege('authenticated',oid,'DELETE') END,
       'Receipt rows contain idempotency requests/results and must not be directly exposed.',
       CASE WHEN oid IS NULL THEN 'Expected before its migration; verify after the corresponding step.'
            ELSE 'Stop on any direct grant; compare with migration REVOKE statements.' END
FROM state ORDER BY table_name;

-- 7) Migration ledger is intentionally informational: the project has no
-- authoritative migration-ledger dependency in these prepared files. Inspect
-- actual objects above and compare the operator's Supabase migration history.
SELECT 'migration-history' AS check,'REVIEW_REQUIRED' AS status,
       'Compare applied-migration ledger to these prepared filenames',
       'No application-side migration ledger is trusted by this script',
       'Partial application cannot be inferred from filenames alone.',
       'Use Supabase migration history plus object checks; stop on any partial/conflicting state.';

-- 8) 0007 ownership guards: report catalog facts and essential predicate
-- fragments. This is read-only and intentionally does not expose row/token data.
WITH expected(policyname,cmd,using_parts,check_parts) AS (VALUES
 ('push_tokens_select_owner_only','SELECT',array['store<>''push_tokens''','current_app_active()','payload->>''userid''','app_profiles','auth.uid()','active=true']::text[],array[]::text[]),
 ('push_tokens_insert_owner_only','INSERT',array[]::text[],array['store<>''push_tokens''','current_app_active()','notdeleted','payload->>''id''=id','payload->>''userid''','app_profiles','auth.uid()','active=true']::text[]),
 ('push_tokens_update_owner_only','UPDATE',array['store<>''push_tokens''','current_app_active()','notdeleted','payload->>''userid''','app_profiles','auth.uid()','active=true']::text[],array['store<>''push_tokens''','current_app_active()','notdeleted','payload->>''id''=id','payload->>''userid''','app_profiles','auth.uid()','active=true']::text[]),
 ('push_tokens_no_hard_delete','DELETE',array['store<>''push_tokens''']::text[],array[]::text[])
), actual AS (
 SELECT e.*,p.permissive,p.roles,p.cmd AS actual_cmd,
   lower(regexp_replace(coalesce(p.qual,''),'[[:space:]]','','g')) AS using_sql,
   lower(regexp_replace(coalesce(p.with_check,''),'[[:space:]]','','g')) AS check_sql
 FROM expected e LEFT JOIN pg_catalog.pg_policies p
   ON p.schemaname='public' AND p.tablename='engrase_sync' AND p.policyname=e.policyname
)
SELECT 'push-token-guard:'||policyname AS check,
 CASE WHEN permissive='RESTRICTIVE' AND actual_cmd=cmd AND cardinality(roles)=1
        AND 'authenticated'=ANY(roles) AND NOT ('public'=ANY(roles))
        AND NOT EXISTS(SELECT 1 FROM unnest(using_parts) f WHERE position(f in using_sql)=0)
        AND NOT EXISTS(SELECT 1 FROM unnest(check_parts) f WHERE position(f in check_sql)=0)
      THEN 'PASS' ELSE 'FAIL' END AS status,
 'RESTRICTIVE on public.engrase_sync; exact command; role authenticated only; owner predicates present',
 coalesce(permissive||' / '||actual_cmd||'; roles='||roles::text||'; USING='||coalesce(qual,'')||'; CHECK='||coalesce(with_check,''),'missing'),
 '0015 grants generic push_tokens RIU to every role; 0007 must guard owner rows before that matrix/cutover.',
 'Stop before 0015/cutover unless all four checks PASS.' AS action
FROM actual ORDER BY policyname;

-- Ownerless push-token inventory. Never selects/prints token values or owner
-- identifiers. The shortened row key is only a locator; resolvability is a
-- boolean based on an app_profile whose app_user_id matches the legacy key.
WITH ownerless AS (
 SELECT e.id,e.payload->>'active' AS token_active,
        substring(e.id from '^tok_(.+)_[^_]+$') AS encoded_owner
 FROM public.engrase_sync e
 WHERE e.store='push_tokens' AND NOT (e.payload ? 'userId')
), classified AS (
 SELECT o.id,o.token_active,
        EXISTS(SELECT 1 FROM public.app_profiles p WHERE p.app_user_id=o.encoded_owner) AS owner_resolvable
 FROM ownerless o
)
SELECT 'push-token-ownerless:'||left(id,18) AS check,
       CASE WHEN owner_resolvable THEN 'REVIEW_REQUIRED'
            WHEN token_active='false' THEN 'REVIEW_REQUIRED'
            ELSE 'REVIEW_REQUIRED' END AS status,
       'no automatic repair; classify manually as RECONCILE, DEACTIVATE, or UNKNOWN',
       'active='||coalesce(token_active,'not recorded')||'; userId=absent; owner resolvable='||owner_resolvable||
         '; recommendation='||CASE WHEN token_active='false' THEN 'DEACTIVATE candidate'
                                   WHEN owner_resolvable THEN 'RECONCILE candidate' ELSE 'UNKNOWN' END,
       'Ownerless legacy rows are intentionally denied by 0007; token value and owner identity are omitted.',
       'Review the sanitized row locator and resolve with authorized production evidence. This query changes nothing.' AS action
FROM classified ORDER BY id;

-- 0015 readiness: informational only. It verifies prerequisite objects and
-- 0007 guard state without writing permissions or migration state.
WITH matrix AS (
 SELECT count(*) AS rows_count,count(DISTINCT store||':'||role) AS distinct_rows FROM public.app_store_permissions
 WHERE role IN ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
   AND store IN ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
     'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
     'notification_dispatch_log','push_tokens','settings','shifts','users')
), endpoints AS (
 SELECT to_regprocedure('public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)') IS NOT NULL AS present
), guards AS (
 SELECT count(*)=4 AS present FROM pg_catalog.pg_policies
 WHERE schemaname='public' AND tablename='engrase_sync' AND permissive='RESTRICTIVE'
   AND 'authenticated'=ANY(roles) AND NOT ('public'=ANY(roles))
   AND policyname IN ('push_tokens_select_owner_only','push_tokens_insert_owner_only','push_tokens_update_owner_only','push_tokens_no_hard_delete')
)
SELECT '0015:readiness' AS check,
 CASE WHEN (SELECT rows_count=72 AND distinct_rows=72 FROM matrix) AND (SELECT present FROM endpoints) AND (SELECT present FROM guards)
      THEN 'REVIEW_REQUIRED' ELSE 'FAIL' END AS status,
 '72 unique role/store rows, 0014 RPCs, and four 0007 authenticated restrictive guards; review target matrix before applying',
 'matrix rows='||(SELECT rows_count FROM matrix)||' distinct='||(SELECT distinct_rows FROM matrix)||'; 0014 endpoints='||(SELECT present FROM endpoints)||
   '; 0007 guards='||(SELECT present FROM guards),
 '0015 changes effective generic permissions and must remain at the cutover boundary.',
 'PASS here is not execution authorization. Compare the target matrix, owners and cutover preconditions separately.' AS action;
