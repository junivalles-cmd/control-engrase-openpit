-- CONTROL DE ENGRASE — BASELINE READ-ONLY, excavadora 20-5530 (eq_mskx59942hzld2),
-- plan plan_mskx6baww0rm5t. Correr y GUARDAR el resultado ANTES de aplicar
-- 20_5530_DUAL_SHIFT_APPLY.sql. Solo SELECT — ningún UPDATE/INSERT/DELETE.
-- No se conecta ni se ejecuta desde la aplicación; copiar manualmente en el
-- SQL Editor de Supabase. Ver docs/EXCAVATOR_DUAL_SHIFT.md.

-- 1) Estado completo del plan: fila entera (updated_at + payload completo),
--    más los campos relevantes extraídos para lectura rápida.
select
  id,
  store,
  deleted,
  updated_at,
  payload as full_payload,
  payload->>'id'              as payload_id,
  payload->>'equipmentId'     as equipment_id,
  payload->>'controlType'     as control_type,
  payload->>'frequency'       as frequency,
  payload->>'shiftId'         as shift_id,
  payload->'requiredShifts'   as required_shifts,
  payload->>'effectiveDate'   as effective_date,
  payload->'assignedDays'     as assigned_days,
  payload->>'active'          as active,
  payload->>'updatedAt'       as payload_updated_at
from public.engrase_sync
where store = 'lubrication_plans'
  and id = 'plan_mskx6baww0rm5t';

-- 2) lubrication_records del equipo — count + último updated_at (para
--    comparar después y confirmar "cero cambio histórico").
select
  'lubrication_records' as store,
  count(*)              as rows,
  max(updated_at)        as max_updated_at
from public.engrase_sync
where store = 'lubrication_records'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2';

-- 3) lubrication_assignments del equipo — mismo propósito.
select
  'lubrication_assignments' as store,
  count(*)                  as rows,
  max(updated_at)            as max_updated_at
from public.engrase_sync
where store = 'lubrication_assignments'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2';

-- 4) lubrication_skips del equipo — mismo propósito.
select
  'lubrication_skips' as store,
  count(*)            as rows,
  max(updated_at)      as max_updated_at
from public.engrase_sync
where store = 'lubrication_skips'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2';

-- 5) Cantidad de planes activos de esta excavadora + sus IDs — confirma que
--    hoy existe exactamente 1 plan activo antes de tocar nada.
select
  payload->>'equipmentId'        as equipment_id,
  count(*)                       as active_plan_count,
  array_agg(id order by id)      as active_plan_ids
from public.engrase_sync
where store = 'lubrication_plans'
  and not deleted
  and coalesce(payload->>'active','true') = 'true'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2'
group by payload->>'equipmentId';
