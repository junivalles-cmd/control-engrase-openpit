-- CONTROL DE ENGRASE — read-only preflight for excavator daily DAY/NIGHT rollout.
-- Run manually only after review in Supabase SQL Editor. This script reads the
-- generic engrase_sync JSON stores and performs no writes.

WITH active_excavators AS (
  SELECT e.id AS equipment_id,
         e.payload->>'code' AS equipment_code,
         e.payload->>'typeId' AS equipment_type_id,
         et.payload->>'name' AS equipment_type,
         e.payload->>'locationId' AS location_id,
         e.payload->>'shiftId' AS equipment_shift_id,
         e.payload->>'status' AS equipment_status
  FROM public.engrase_sync e
  LEFT JOIN public.engrase_sync et
    ON et.store='equipment_types' AND et.id=e.payload->>'typeId' AND NOT et.deleted
  WHERE e.store='equipment'
    AND NOT e.deleted
    AND COALESCE(e.payload->>'active','true')='true'
    AND COALESCE(et.payload->>'name',et.payload->>'label',et.payload->>'description','') ILIKE '%excavadora%'
), active_plans AS (
  SELECT p.id AS plan_id,
         p.payload->>'equipmentId' AS equipment_id,
         p.payload->>'controlType' AS control_type,
         p.payload->>'frequency' AS frequency,
         p.payload->>'shiftId' AS plan_shift_id,
         p.payload->'requiredShifts' AS required_shifts,
         p.payload->>'effectiveDate' AS effective_date,
         p.payload->'assignedDays' AS assigned_days,
         p.updated_at
  FROM public.engrase_sync p
  WHERE p.store='lubrication_plans'
    AND NOT p.deleted
    AND COALESCE(p.payload->>'active','true')='true'
)
SELECT e.equipment_id,
       e.equipment_code,
       e.equipment_type_id,
       e.equipment_type,
       e.location_id,
       e.equipment_status,
       e.equipment_shift_id,
       p.plan_id,
       p.control_type,
       p.frequency,
       p.plan_shift_id,
       p.required_shifts,
       p.effective_date,
       p.assigned_days,
       CASE
         WHEN p.plan_id IS NULL THEN 'MISSING_PLAN'
         WHEN p.required_shifts @> '["shift_dia","shift_noche"]'::jsonb AND NULLIF(p.effective_date,'') IS NOT NULL THEN 'DUAL_SHIFT_CONFIGURED'
         WHEN p.control_type='Día y turno de la semana' THEN 'LEGACY_WEEKDAY_PLAN'
         ELSE 'LEGACY_HOURMETER_PLAN_REVIEW'
       END AS rollout_state
FROM active_excavators e
LEFT JOIN active_plans p ON p.equipment_id=e.equipment_id
ORDER BY e.equipment_code, p.plan_id;

-- Duplicate/conflicting active plans per active excavator.
WITH active_excavators AS (
  SELECT e.id AS equipment_id, e.payload->>'code' AS equipment_code
  FROM public.engrase_sync e
  LEFT JOIN public.engrase_sync et
    ON et.store='equipment_types' AND et.id=e.payload->>'typeId' AND NOT et.deleted
  WHERE e.store='equipment' AND NOT e.deleted
    AND COALESCE(e.payload->>'active','true')='true'
    AND COALESCE(et.payload->>'name',et.payload->>'label',et.payload->>'description','') ILIKE '%excavadora%'
), plans AS (
  SELECT p.id, p.payload->>'equipmentId' AS equipment_id
  FROM public.engrase_sync p
  WHERE p.store='lubrication_plans' AND NOT p.deleted
    AND COALESCE(p.payload->>'active','true')='true'
)
SELECT e.equipment_id, e.equipment_code, COUNT(p.id) AS active_plan_count,
       ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL) AS plan_ids
FROM active_excavators e
LEFT JOIN plans p ON p.equipment_id=e.equipment_id
GROUP BY e.equipment_id, e.equipment_code
HAVING COUNT(p.id)<>1
ORDER BY e.equipment_code;
