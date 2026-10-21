-- 0016_SECURITY_EQUIVALENCE_VERIFICATION_READ_ONLY.sql
--
-- Compara, fila por fila, el conjunto de grants que da la función VIEJA
-- (authorization_private.support_grant_rows(), instalada por 0014, SIN
-- cambios) contra la NUEVA (authorization_private.support_row_granted(),
-- propuesta en 0016) — para CADA contexto de autorización actualmente
-- autorizado (una fila por usuario con perfil activo y cuadrilla(s)).
--
-- Resultado esperado para aprobar 0016: 0 filas en AMBAS tablas
-- "faltantes"/"adicionales" de más abajo, Y 'PASS' en los 5 casos
-- sintéticos de la sección final (Task C).
--
-- REVISIÓN PRE-PRODUCCIÓN (antes de la primera ejecución real de este
-- script): se encontraron y corrigieron 2 bugs en el PREPARED de 0016
-- (ambos eran FALTANTES — más restrictivos que 0014, nunca una
-- ampliación de acceso):
--   1. Rama historica de 'lubrication_assignments' en support_row_granted()
--      filtraba por l.store='lubrication_assignments', pero refs en 0014
--      NO filtra por l.store (ver `historical` CTE de support_grant_rows():
--      `select l.* from support_links l` sin WHERE l.store=...). Cualquier
--      support_link de OTRO store sigue concediendo su assignment_id.
--   2. Rama historica de 'locations' conservaba `not e.deleted`, pero la
--      UNION de 'locations' en support_grant_rows() no filtra e.deleted en
--      absoluto — una location detrás de un equipo borrado DESPUÉS de
--      crearse el support_link sigue siendo concedida por 0014.
-- La reconstrucción _verif_old de más abajo YA modelaba correctamente
-- ambas relaciones desde que se escribió este script (no se le encontró
-- el mismo bug) — ver los comentarios inline en cada CTE. Los casos
-- sintéticos de la sección final prueban estos 2 puntos de forma directa
-- y determinista, sin depender de datos reales de producción.
--
-- CÓMO EJECUTAR (como postgres, en el SQL editor de Supabase):
--   1. Correr TODO este archivo dentro de una transacción que termina en
--      ROLLBACK (ya incluido abajo) — nunca dejar 0016 aplicada por este
--      script. Si el resultado es 0/0 diferencias, recién ahí aplicar
--      0016_fix_support_rls_performance_PREPARED.sql de verdad (su propia
--      transacción, con COMMIT).
--   2. Revisar las 2 tablas de resultado al final. Cualquier fila ahí
--      significa que support_row_granted() diverge de support_grant_rows()
--      para ese (store,id,appUserId) — NO aplicar 0016 hasta corregirlo.
--
-- Este script NUNCA debe dejar cambios de datos reales — set_config('role',
-- ...) y auth.uid() dependen del contexto JWT real; como postgres, auth.uid()
-- es NULL, así que en vez de eso iteramos manualmente sobre cada contexto de
-- autorización persistido/derivable para cada app_profile activo con
-- membership real, reconstruyendo p_context tal como get_authorization_context()
-- lo arma (vía resolve_authorization_scope(auth_user_id)) pero pasando el
-- auth_user_id explícito en vez de depender de auth.uid().

begin;

-- 0016 debe estar instalada DENTRO de esta transacción de prueba para que
-- exista support_row_granted() — se revierte con el ROLLBACK final, nunca
-- queda aplicada por este script.
\i 0016_fix_support_rls_performance_PREPARED.sql

-- Reconstruye, para cada auth_user_id con un app_profile activo, el MISMO
-- jsonb que get_authorization_context() entrega — pero evaluado
-- explícitamente (auth.uid() es NULL para el rol postgres), para poder
-- iterar sobre TODOS los usuarios reales en una sola pasada.
create temporary table _verif_contexts as
select ap.auth_user_id,
  jsonb_set(public.resolve_authorization_scope(ap.auth_user_id),
    '{context,rowScopeEnforced}','true'::jsonb,false) as context
from public.app_profiles ap
where ap.active;

-- Conjunto VIEJO: para cada contexto, qué (store,id) da
-- support_grant_rows() — ejecutada "como si" auth.uid() fuera ese usuario,
-- vía set_config de un truco de evaluación: support_grant_rows() llama
-- auth.uid() internamente (no toma el contexto como parámetro), así que se
-- reconstruye aquí su MISMA lógica line-by-line contra el contexto ya
-- resuelto, en vez de poder invocar la función tal cual fuera de una
-- sesión JWT real (limitación conocida: documentar si auth.uid() no es
-- sustituible en tu versión de Postgres/Supabase — en ese caso, correr
-- esta comparación una vez por usuario real autenticando como cada uno,
-- no como postgres).
-- Modela, término a término, las 6 relaciones de support_grant_rows()
-- (0014) que support_row_granted() (0016) debe reproducir exactamente:
--   (a) assignment histórico: por l.assignment_id, CUALQUIER l.store
--       (refs.assignment_id viene de `historical` sin filtro de store).
--   (b) equipment histórico: por l.equipment_id, cualquier l.store.
--   (c) plan histórico: por l.plan_id, cualquier l.store.
--   (d) location histórica: derivada del equipment_id de refs (operational
--       UNION historical) vía join a `engrase_sync e where e.store=
--       'equipment'` — SIN exigir e.deleted=false (0014 no lo exige).
--   (e) lubrication_points: SOLO desde `operational` (join a `operational a`
--       en 0014) — `historical` nunca participa en esta rama.
--   (f) cualquier otro store: por (l.store,l.entity_id) exacto — el
--       `select h.store,h.entity_id from historical h` final de 0014.
create temporary table _verif_old as
with ctx as (select auth_user_id, context as c from _verif_contexts),
operational as (
  select ctx.auth_user_id, a.id, a.payload from public.engrase_sync a, ctx
  where a.store='lubrication_assignments' and not a.deleted
    and ctx.c->>'status'='AUTHORIZED'
    and ctx.c->'context'->'authorizedCrewIds' ? (a.payload->>'assignedCrewId')
    and authorization_private.support_assignment_valid(a.id)
), historical as (
  -- (a)(b)(c)(f): `l.*` de TODO support_links con crew autorizada — SIN
  -- WHERE l.store=..., igual que el `historical` CTE real de 0014.
  select ctx.auth_user_id, l.* from authorization_private.support_links l, ctx
  where ctx.c->>'status'='AUTHORIZED'
    and ctx.c->'context'->'authorizedCrewIds' ? l.crew_id
), refs as (
  select o.auth_user_id, o.id assignment_id, o.payload->>'equipmentId' equipment_id, o.payload->>'planId' plan_id from operational o
  union select h.auth_user_id, h.assignment_id, h.equipment_id, h.plan_id from historical h
)
-- (a) assignment histórico por l.assignment_id (vía refs), cualquier l.store.
select auth_user_id, 'lubrication_assignments' store, assignment_id id from refs
-- (b) equipment histórico por l.equipment_id (vía refs), cualquier l.store.
union select auth_user_id, 'equipment', equipment_id from refs
-- (c) plan histórico por l.plan_id (vía refs), cualquier l.store.
union select auth_user_id, 'lubrication_plans', plan_id from refs
-- (e) lubrication_points: SOLO operational (join explícito a `operational
-- o`, nunca a `historical`) — refs se usa solo para acotar el plan_id,
-- pero el INNER JOIN a `operational` exige que ese plan_id tenga una
-- asignación operacional real; un plan_id que SOLO viene de `historical`
-- no sobrevive este join.
union select r.auth_user_id, 'lubrication_points', p.id from public.engrase_sync p join refs r on p.store='lubrication_points' and p.payload->>'planId'=r.plan_id
  join operational o on o.auth_user_id=r.auth_user_id and o.payload->>'planId'=r.plan_id
-- (d) location histórica: join directo a refs.equipment_id, SIN filtro de
-- e.deleted (a propósito — 0014 no lo filtra en esta rama).
union select r.auth_user_id, 'locations', e.payload->>'locationId' from public.engrase_sync e join refs r on e.store='equipment' and e.id=r.equipment_id
-- (f) cualquier otro store por (store,entity_id) exacto del propio link.
union select auth_user_id, store, entity_id from historical;

-- Conjunto NUEVO: para cada contexto y cada fila candidata de
-- engrase_sync, qué dice support_row_granted().
create temporary table _verif_new as
select ctx.auth_user_id, e.store, e.id
from public.engrase_sync e, _verif_contexts ctx
where authorization_private.support_row_granted(e.store, e.id, ctx.context);

-- FALTANTES: el viejo autorizaba, el nuevo NO — esto SÍ sería una regresión
-- de seguridad (reduce acceso que 0014 ya daba). Debe ser 0 filas.
select 'FALTANTES (nuevo deniega algo que el viejo permitía)' as categoria,
  o.auth_user_id, o.store, o.id
from _verif_old o
left join _verif_new n on n.auth_user_id=o.auth_user_id and n.store=o.store and n.id=o.id
where n.auth_user_id is null;

-- ADICIONALES: el nuevo autoriza algo que el viejo NO — esto SÍ sería una
-- ampliación de acceso no autorizada. Debe ser 0 filas.
select 'ADICIONALES (nuevo permite algo que el viejo denegaba)' as categoria,
  n.auth_user_id, n.store, n.id
from _verif_new n
left join _verif_old o on o.auth_user_id=n.auth_user_id and o.store=n.store and o.id=n.id
where o.auth_user_id is null;

-- Resumen por store (ambas tablas deben dar 0 en todas las filas).
select coalesce(f.store, a.store) as store,
  coalesce(f.faltantes,0) as faltantes, coalesce(a.adicionales,0) as adicionales
from (select store, count(*) faltantes from _verif_old o
      where not exists(select 1 from _verif_new n where n.auth_user_id=o.auth_user_id and n.store=o.store and n.id=o.id)
      group by store) f
full outer join (select store, count(*) adicionales from _verif_new n
      where not exists(select 1 from _verif_old o where o.auth_user_id=n.auth_user_id and o.store=n.store and o.id=n.id)
      group by store) a
  on a.store=f.store;

-- ============================================================
-- CASOS SINTÉTICOS (Task C) — deterministas, aislados de datos reales de
-- producción (ids con prefijo __verif_), dentro de la MISMA transacción
-- que termina en ROLLBACK más abajo: nada de esto queda escrito.
-- Llaman authorization_private.support_row_granted() directamente con un
-- p_context construido a mano (no dependen de auth.uid()/app_profiles),
-- así que prueban la función tal cual quedaría instalada por 0016, de
-- forma independiente de la reconstrucción _verif_old/_verif_new de
-- arriba. El resultado esperado de cada caso, PASS o FAIL, está derivado
-- directamente de la fuente de 0014 citada en su comentario — no de
-- support_row_granted() mismo, para que esto sea una prueba real y no una
-- tautología.
-- ============================================================

-- Caso 1: un support_link cuyo PROPIO store NO es 'lubrication_assignments'
-- debe seguir concediendo su assignment_id (0014: refs.assignment_id viene
-- de `historical` SIN WHERE l.store=...).
insert into authorization_private.support_links(store,entity_id,assignment_id,crew_id,equipment_id,plan_id,occurrence_key)
values ('lubrication_records','__verif_rec1__','__verif_asg1__','__verif_crew__','__verif_eq1__','__verif_plan1__','__verif_plan1__:2026-01-01');

select 'CASO 1: assignment vía support_link de otro store' as caso,
  case when authorization_private.support_row_granted('lubrication_assignments','__verif_asg1__',
      jsonb_build_object('context',jsonb_build_object('authorizedCrewIds',jsonb_build_array('__verif_crew__'))))
    then 'PASS' else 'FAIL (regresión: niega lo que 0014 concedía)' end as resultado
union all
select 'CASO 1b (control negativo): crew NO autorizada no debe conceder',
  case when authorization_private.support_row_granted('lubrication_assignments','__verif_asg1__',
      jsonb_build_object('context',jsonb_build_object('authorizedCrewIds',jsonb_build_array('__otra_crew__'))))
    then 'FAIL (amplía acceso: concede con crew no autorizada)' else 'PASS' end;

-- Caso 2: un support_link histórico cuyo equipment_id referencia un equipo
-- YA BORRADO debe seguir concediendo la misma location (0014: la rama
-- 'locations' no filtra e.deleted en absoluto).
insert into public.engrase_sync(store,id,payload,deleted)
values ('equipment','__verif_eq2__', jsonb_build_object('locationId','__verif_loc2__'), true);
insert into authorization_private.support_links(store,entity_id,assignment_id,crew_id,equipment_id,plan_id,occurrence_key)
values ('anomalies','__verif_anom2__','__verif_asg2__','__verif_crew__','__verif_eq2__','__verif_plan2__','__verif_plan2__:2026-01-01');

select 'CASO 2: location histórica detrás de equipment borrado' as caso,
  case when authorization_private.support_row_granted('locations','__verif_loc2__',
      jsonb_build_object('context',jsonb_build_object('authorizedCrewIds',jsonb_build_array('__verif_crew__'))))
    then 'PASS' else 'FAIL (regresión: niega lo que 0014 concedía)' end as resultado;

-- Caso 3: un plan_id que SOLO existe vía support_links (histórico) — sin
-- ninguna lubrication_assignments operacional real para ese plan — NO debe
-- ampliar el acceso a sus lubrication_points (0014: esa rama solo joinea
-- `operational`, nunca `historical`).
insert into public.engrase_sync(store,id,payload)
values ('lubrication_points','__verif_pt3__', jsonb_build_object('planId','__verif_plan3__'));
insert into authorization_private.support_links(store,entity_id,assignment_id,crew_id,equipment_id,plan_id,occurrence_key)
values ('grease_validations','__verif_gv3__','__verif_asg3__','__verif_crew__','__verif_eq3__','__verif_plan3__','__verif_plan3__:2026-01-01');

select 'CASO 3: lubrication_points NO se amplía vía plan histórico' as caso,
  case when authorization_private.support_row_granted('lubrication_points','__verif_pt3__',
      jsonb_build_object('context',jsonb_build_object('authorizedCrewIds',jsonb_build_array('__verif_crew__'))))
    then 'FAIL (amplía acceso: 0016 concede lo que 0014 nunca concedía)' else 'PASS' end as resultado;

rollback;
