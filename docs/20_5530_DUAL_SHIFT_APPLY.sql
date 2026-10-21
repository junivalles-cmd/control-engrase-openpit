-- CONTROL DE ENGRASE — APPLY (NO EJECUTAR TODAVÍA). Excavadora 20-5530
-- (eq_mskx59942hzld2), plan plan_mskx6baww0rm5t. Activa DAY/NIGHT
-- (requiredShifts + effectiveDate) sin tocar ningún otro campo del plan ni
-- ninguna otra fila. Ver docs/EXCAVATOR_DUAL_SHIFT.md y
-- docs/20_5530_DUAL_SHIFT_BASELINE_READ_ONLY.sql (correr y guardar ese
-- baseline ANTES de aplicar esto). Transacción autocontenida: CAS por
-- updated_at + validación exacta de contenido previo; aborta con
-- RAISE EXCEPTION ante cualquier drift, sin escribir nada.

begin;

do $plan_20_5530_dual_shift$
declare
  row_version   timestamptz;
  row_payload   jsonb;
  row_deleted   boolean;
  write_at      timestamptz := clock_timestamp();
  updated_rows  integer;
begin
  select updated_at, payload, deleted
    into row_version, row_payload, row_deleted
    from public.engrase_sync
   where store = 'lubrication_plans' and id = 'plan_mskx6baww0rm5t'
   for update;

  if row_version is null then
    raise exception 'STOP: plan_mskx6baww0rm5t no existe — el plan referenciado por este preflight desapareció';
  end if;

  if row_deleted then
    raise exception 'STOP: plan_mskx6baww0rm5t está marcado deleted — no corresponde aplicar este cambio';
  end if;

  -- Validación exacta del estado documentado en el baseline. Cualquier
  -- desvío detiene la ejecución sin escribir nada.
  if not (
    row_payload->>'id' = 'plan_mskx6baww0rm5t'
    and row_payload->>'equipmentId' = 'eq_mskx59942hzld2'
    and row_payload->>'controlType' = 'Día y turno de la semana'
    and row_payload->>'frequency' = '10'
    and row_payload->>'shiftId' = 'shift_dia'
    and (row_payload->'requiredShifts' is null or row_payload->'requiredShifts' = 'null'::jsonb)
    and nullif(row_payload->>'effectiveDate', '') is null
    and row_payload->'assignedDays' = '["Lunes","Martes","Jueves","Sábado"]'::jsonb
    and coalesce(row_payload->>'active', 'true') = 'true'
  ) then
    raise exception 'STOP: plan_mskx6baww0rm5t cambió desde el preflight/baseline — revisar antes de reaplicar';
  end if;

  -- Merge aditivo: preserva TODOS los demás campos del payload intactos
  -- (equipmentId, controlType, frequency, shiftId, assignedDays, active,
  -- createdAt/createdBy y cualquier otro campo existente). Solo estas dos
  -- claves cambian, más updatedAt (dentro del JSON, misma convención que
  -- los gateways 0009/0014: payload||jsonb_build_object(...,'updatedAt',write_at)).
  update public.engrase_sync
     set payload = row_payload || jsonb_build_object(
           'requiredShifts', '["shift_dia","shift_noche"]'::jsonb,  -- JSONB array real, no string
           'effectiveDate',  '2026-10-17',
           'updatedAt',      write_at
         ),
         updated_at = write_at  -- MISMO write_at que payload.updatedAt (columna y JSON sincronizados)
   where store = 'lubrication_plans'
     and id = 'plan_mskx6baww0rm5t'
     and updated_at = row_version; -- CAS explícito, además del lock FOR UPDATE ya tomado arriba

  get diagnostics updated_rows = row_count;

  if updated_rows is distinct from 1 then
    raise exception 'STOP: CAS falló — % filas afectadas (se esperaba exactamente 1); plan_mskx6baww0rm5t se modificó concurrentemente, reintentar desde el baseline', updated_rows;
  end if;
end
$plan_20_5530_dual_shift$;

-- Consulta final de verificación, dentro de la misma transacción (antes
-- del COMMIT) — confirma el resultado exacto que se está a punto de confirmar.
select
  id,
  updated_at,
  payload->>'equipmentId'    as equipment_id,
  payload->>'controlType'    as control_type,
  payload->>'frequency'      as frequency,
  payload->>'shiftId'        as shift_id,
  payload->'requiredShifts'  as required_shifts,
  payload->>'effectiveDate'  as effective_date,
  payload->'assignedDays'    as assigned_days,
  payload->>'active'         as active,
  payload->>'updatedAt'      as payload_updated_at
from public.engrase_sync
where store = 'lubrication_plans' and id = 'plan_mskx6baww0rm5t';

commit;
