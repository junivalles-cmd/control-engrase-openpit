-- Verificacion de equivalencia: 0014 vs. 0016 corregido (NO instala 0016).
-- Copiar TODO en Supabase SQL Editor y ejecutar como postgres, con 0014
-- instalada. Un solo SELECT: sin DDL, escrituras, JWT simulado ni objetos
-- temporales. No llama support_row_granted(), que aun no debe instalarse.
--
-- OLD reproduce literalmente las relaciones de support_grant_rows() de
-- 0014, sustituyendo solo resolve_authorization_scope(auth.uid()) por el
-- contexto resuelto explicitamente para CADA perfil activo autorizado.
-- NEW reproduce el CASE de support_row_granted() del PREPARED corregido.
-- No se compara el fallback baseline_0013 ni el permiso por store: aqui
-- se compara exclusivamente la concesion de soporte de ambas versiones.
-- support_assignment_valid() se usa sin modificar para los datos reales.
-- El guard AUTHORIZED comun al wrapper delimita los contextos comparados;
-- no se agrega ese guard dentro del CASE nuevo, que no lo tiene en 0016.
--
-- Los candidatos incluyen los grants OLD aunque no exista su fila en
-- engrase_sync: no se ocultan diferencias por referencias historicas.
-- IDs NULL no conceden una fila bajo g.id=p_id en 0014, y 0016 los rechaza.
-- No se presupone que los stores de support_links sean una lista cerrada:
-- OLD conserva su UNION final completa, NEW conserva su ELSE exacto.
--
-- TEST-1/2/3 son mundos separados exclusivamente en VALUES/CTEs; pasan
-- por los mismos evaluadores OLD/NEW que los datos reales. Su validez
-- operacional se suministra como false (no hay asignacion operacional).
-- No llaman support_assignment_valid() con identificadores sinteticos.
--
-- Resultado esperado (diferencias NULL para pruebas sinteticas):
-- verificacion | diferencias | resultado
-- OLD_NOT_NEW  | 0           | PASS
-- NEW_NOT_OLD  | 0           | PASS
-- TEST-1       | NULL        | PASS
-- TEST-2       | NULL        | PASS
-- TEST-3       | NULL        | PASS
-- PASS 0/0 describe los datos/contextos presentes en esta instantanea;
-- las pruebas sinteticas comprueban ademas los tres casos de regresion.
-- Este archivo no aplica ni autoriza aplicar ninguna migracion.

with
resolved_contexts as materialized (
  select ap.auth_user_id::text as actor,
         public.resolve_authorization_scope(ap.auth_user_id) as c
  from public.app_profiles ap
  where ap.active
),
contexts as materialized (
  select 'REAL'::text as world, actor, c
  from resolved_contexts
  where c->>'status' = 'AUTHORIZED'
  union all
  select t.world, '__synthetic_actor__',
         '{"status":"AUTHORIZED","context":{"authorizedCrewIds":["__crew__"]}}'::jsonb
  from (values ('TEST-1'), ('TEST-2'), ('TEST-3')) as t(world)
),
synthetic_rows(world, store, id, payload, deleted) as (
  values
    ('TEST-2', 'equipment', '__eq2__',
     '{"locationId":"__loc2__"}'::jsonb, true),
    ('TEST-3', 'lubrication_points', '__pt3__',
     '{"planId":"__plan3__"}'::jsonb, false)
),
sync_rows as materialized (
  select 'REAL'::text as world, s.store, s.id, s.payload, s.deleted
  from public.engrase_sync s
  union all
  select world, store, id, payload, deleted from synthetic_rows
),
synthetic_links(world, store, entity_id, assignment_id, crew_id, equipment_id, plan_id) as (
  values
    ('TEST-1', 'lubrication_records', '__rec1__', '__asg1__', '__crew__', '__eq1__', '__plan1__'),
    ('TEST-2', 'anomalies', '__anom2__', '__asg2__', '__crew__', '__eq2__', '__plan2__'),
    ('TEST-3', 'grease_validations', '__gv3__', '__asg3__', '__crew__', '__eq3__', '__plan3__')
),
links as materialized (
  select 'REAL'::text as world, l.store, l.entity_id, l.assignment_id,
         l.crew_id, l.equipment_id, l.plan_id
  from authorization_private.support_links l
  union all
  select world, store, entity_id, assignment_id, crew_id, equipment_id, plan_id
  from synthetic_links
),
assignment_validity as materialized (
  select a.world, a.id,
         case when a.world = 'REAL'
              then authorization_private.support_assignment_valid(a.id)
              else false end as valid
  from sync_rows a
  where a.store = 'lubrication_assignments'
),
-- OLD: transcripcion de los CTEs y las seis UNION de 0014.
-- No agregar NOT deleted aqui: support_assignment_valid ya lo garantiza.
old_operational as materialized (
  select ctx.world, ctx.actor, a.id, a.payload
  from sync_rows a
  join contexts ctx on ctx.world = a.world
  join assignment_validity v on v.world = a.world and v.id = a.id
  where a.store = 'lubrication_assignments'
    and ctx.c->>'status' = 'AUTHORIZED'
    and ctx.c->'context'->'authorizedCrewIds' ? (a.payload->>'assignedCrewId')
    and v.valid
),
old_historical as materialized (
  select ctx.actor, l.*
  from links l join contexts ctx on ctx.world = l.world
  where ctx.c->>'status' = 'AUTHORIZED'
    and ctx.c->'context'->'authorizedCrewIds' ? l.crew_id
),
old_refs as (
  select o.world, o.actor, o.id as assignment_id,
         o.payload->>'equipmentId' as equipment_id,
         o.payload->>'planId' as plan_id
  from old_operational o
  union
  select h.world, h.actor, h.assignment_id, h.equipment_id, h.plan_id
  from old_historical h
),
old_raw as (
  select r.world, r.actor, 'lubrication_assignments'::text as store, r.assignment_id as id from old_refs r
  union
  select r.world, r.actor, 'equipment', r.equipment_id from old_refs r
  union
  select r.world, r.actor, 'lubrication_plans', r.plan_id from old_refs r
  union
  select a.world, a.actor, 'lubrication_points', p.id
  from sync_rows p join old_operational a
    on p.world = a.world and p.store = 'lubrication_points'
    and p.payload->>'planId' = a.payload->>'planId'
  union
  select r.world, r.actor, 'locations', e.payload->>'locationId'
  from sync_rows e join old_refs r
    on e.world = r.world and e.store = 'equipment' and e.id = r.equipment_id
  union
  select h.world, h.actor, h.store, h.entity_id from old_historical h
),
old_grants as materialized (
  select * from old_raw where store is not null and id is not null
),
candidates as materialized (
  select ctx.world, ctx.actor, s.store, s.id
  from contexts ctx join sync_rows s on s.world = ctx.world
  union
  select world, actor, store, id from old_grants
),
-- NEW: asignaciones operacionales del CASE de 0016. Separadas de OLD
-- para no reutilizar accidentalmente sus decisiones de autorizacion.
new_operational as materialized (
  select ctx.world, ctx.actor, a.id, a.payload
  from contexts ctx join sync_rows a on a.world = ctx.world
  join assignment_validity v on v.world = a.world and v.id = a.id
  where a.store = 'lubrication_assignments' and not a.deleted
    and coalesce(ctx.c->'context'->'authorizedCrewIds', '[]'::jsonb)
        ? (a.payload->>'assignedCrewId')
    and v.valid
),
new_evaluation as materialized (
  select q.*,
    case
      when q.store is null or q.id is null then false
      else case q.store
        when 'lubrication_assignments' then
          exists (select 1 from new_operational a
                  where a.world=q.world and a.actor=q.actor and a.id=q.id)
          or exists (select 1 from links l
                     where l.world=q.world and l.assignment_id=q.id and crews.ids ? l.crew_id)
        when 'equipment' then
          exists (select 1 from new_operational a
                  where a.world=q.world and a.actor=q.actor and a.payload->>'equipmentId'=q.id)
          or exists (select 1 from links l
                     where l.world=q.world and l.equipment_id=q.id and crews.ids ? l.crew_id)
        when 'lubrication_plans' then
          exists (select 1 from new_operational a
                  where a.world=q.world and a.actor=q.actor and a.payload->>'planId'=q.id)
          or exists (select 1 from links l
                     where l.world=q.world and l.plan_id=q.id and crews.ids ? l.crew_id)
        when 'lubrication_points' then
          exists (
            select 1 from sync_rows pt join new_operational a
              on a.world=pt.world and a.actor=q.actor
              and a.payload->>'planId'=pt.payload->>'planId'
            where pt.world=q.world and pt.store='lubrication_points' and pt.id=q.id
          ) -- SOLO operational: ninguna rama historical.
        when 'locations' then
          exists (
            select 1 from sync_rows e join new_operational a
              on a.world=e.world and a.actor=q.actor and a.payload->>'equipmentId'=e.id
            where e.world=q.world and e.store='equipment'
              and e.payload->>'locationId'=q.id and not e.deleted
          ) or exists (
            select 1 from sync_rows e join links l
              on l.world=e.world and l.equipment_id=e.id
            where e.world=q.world and e.store='equipment'
              and e.payload->>'locationId'=q.id and crews.ids ? l.crew_id
          ) -- Historico SIN NOT e.deleted, exactamente como 0016 corregido.
        else
          exists (select 1 from links l where l.world=q.world
                  and l.store=q.store and l.entity_id=q.id and crews.ids ? l.crew_id)
      end
    end as granted
  from candidates q
  join contexts ctx on ctx.world=q.world and ctx.actor=q.actor
  cross join lateral (
    select coalesce(ctx.c->'context'->'authorizedCrewIds', '[]'::jsonb) as ids
  ) crews
),
new_grants as materialized (
  select world, actor, store, id from new_evaluation where granted
),
old_not_new as (
  select world, actor, store, id from old_grants where world='REAL'
  except
  select world, actor, store, id from new_grants where world='REAL'
),
new_not_old as (
  select world, actor, store, id from new_grants where world='REAL'
  except
  select world, actor, store, id from old_grants where world='REAL'
),
synthetic_expectations(world, store, id, expected) as (
  values
    ('TEST-1', 'lubrication_assignments', '__asg1__', true),
    ('TEST-2', 'locations', '__loc2__', true),
    ('TEST-3', 'lubrication_points', '__pt3__', false)
),
synthetic_results as (
  select x.world,
    -- Exige candidato evaluado, resultado explicito y acuerdo con OLD.
    -- TEST-3 no pasa por ausencia accidental del candidato.
    (select count(*)=1 from new_evaluation n
     where n.world=x.world and n.actor='__synthetic_actor__'
       and n.store=x.store and n.id=x.id and n.granted=x.expected)
    and (exists (select 1 from old_grants o
                 where o.world=x.world and o.actor='__synthetic_actor__'
                   and o.store=x.store and o.id=x.id) = x.expected)
    and not exists (select 1 from new_operational a where a.world=x.world)
    and case x.world
      when 'TEST-1' then exists (
        select 1 from synthetic_links l where l.world=x.world
          and l.store<>'lubrication_assignments' and l.assignment_id=x.id)
      when 'TEST-2' then exists (
        select 1 from synthetic_links l join synthetic_rows e
          on e.world=l.world and e.store='equipment' and e.id=l.equipment_id
        where l.world=x.world and e.deleted and e.payload->>'locationId'=x.id)
      when 'TEST-3' then exists (
        select 1 from synthetic_links l join synthetic_rows pt
          on pt.world=l.world and pt.store='lubrication_points'
          and pt.payload->>'planId'=l.plan_id
        where l.world=x.world and pt.id=x.id)
      else false
    end as passed
  from synthetic_expectations x
),
results as (
  select 1 as position, 'OLD_NOT_NEW'::text as verificacion,
         count(*) as diferencias, case when count(*)=0 then 'PASS' else 'FAIL' end as resultado
  from old_not_new
  union all
  select 2, 'NEW_NOT_OLD', count(*), case when count(*)=0 then 'PASS' else 'FAIL' end
  from new_not_old
  union all
  select case world when 'TEST-1' then 3 when 'TEST-2' then 4 else 5 end,
         world, null::bigint, case when passed then 'PASS' else 'FAIL' end
  from synthetic_results
)
select verificacion, diferencias, resultado from results order by position;
