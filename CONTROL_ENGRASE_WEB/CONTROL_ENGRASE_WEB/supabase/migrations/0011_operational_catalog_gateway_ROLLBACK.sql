-- PREPARED ONLY. Stop RPCs without reopening broad writes or deleting evidence.
-- Restrictive role policies and settings READ access intentionally remain in force.
begin;
revoke execute on function public.move_equipment_master_location(text,text,timestamptz,text),public.set_equipment_shift(text,text,timestamptz,text),
 public.set_equipment_alert_pause(text,text,text,timestamptz,date,text),public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean),
 public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text) from authenticated;
commit;
