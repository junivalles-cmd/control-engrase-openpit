-- CONTROL DE ENGRASE — POSTCHECK READ-ONLY, excavadora 20-5530
-- (eq_mskx59942hzld2), plan plan_mskx6baww0rm5t. Correr DESPUÉS de aplicar
-- docs/20_5530_DUAL_SHIFT_APPLY.sql y comparar contra
-- docs/20_5530_DUAL_SHIFT_BASELINE_READ_ONLY.sql. Solo SELECT — ningún
-- UPDATE/INSERT/DELETE.

-- 1) Estado final del plan y cada campo esperado, verificado explícitamente.
select
  id,
  updated_at,
  payload->>'equipmentId'  as equipment_id,
  payload->'requiredShifts' as required_shifts,
  payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb as has_shift_dia_and_shift_noche,
  payload->>'effectiveDate' as effective_date,
  (payload->>'effectiveDate' = '2026-10-17') as effective_date_is_2026_10_17,
  payload->>'shiftId' as shift_id,
  (payload->>'shiftId' = 'shift_dia') as shift_id_unchanged,
  payload->>'controlType' as control_type,
  (payload->>'controlType' = 'Día y turno de la semana') as control_type_unchanged,
  payload->>'frequency' as frequency,
  (payload->>'frequency' = '10') as frequency_unchanged,
  payload->'assignedDays' as assigned_days,
  (payload->'assignedDays' = '["Lunes","Martes","Jueves","Sábado"]'::jsonb) as assigned_days_unchanged,
  payload->>'active' as active,
  payload->>'updatedAt' as payload_updated_at
from public.engrase_sync
where store = 'lubrication_plans' and id = 'plan_mskx6baww0rm5t';

-- 2) Un solo plan activo para esta excavadora — sin duplicados.
select
  payload->>'equipmentId'   as equipment_id,
  count(*)                  as active_plan_count,
  array_agg(id order by id) as active_plan_ids
from public.engrase_sync
where store = 'lubrication_plans'
  and not deleted
  and coalesce(payload->>'active','true') = 'true'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2'
group by payload->>'equipmentId';

-- 3) lubrication_records del equipo — comparar count/max(updated_at)
--    contra el baseline: deben ser IDÉNTICOS (cero cambio histórico).
select
  'lubrication_records' as store,
  count(*)              as rows,
  max(updated_at)        as max_updated_at
from public.engrase_sync
where store = 'lubrication_records'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2';

-- 4) lubrication_assignments del equipo — mismo propósito.
select
  'lubrication_assignments' as store,
  count(*)                  as rows,
  max(updated_at)            as max_updated_at
from public.engrase_sync
where store = 'lubrication_assignments'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2';

-- 5) lubrication_skips del equipo — mismo propósito.
select
  'lubrication_skips' as store,
  count(*)            as rows,
  max(updated_at)      as max_updated_at
from public.engrase_sync
where store = 'lubrication_skips'
  and payload->>'equipmentId' = 'eq_mskx59942hzld2';
