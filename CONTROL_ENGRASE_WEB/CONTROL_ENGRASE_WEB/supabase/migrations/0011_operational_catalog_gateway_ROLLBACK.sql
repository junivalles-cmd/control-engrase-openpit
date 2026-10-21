-- MANUAL-PRODUCTION-PREPARED safe-stop: stop the five typed RPCs without
-- reopening broad writes or deleting evidence. Stop compatible clients first.
-- Restrictive role policies and settings READ access intentionally remain in force.
-- Also retains repaired 0013's eight gates/readiness and all receipts/helpers.
-- Internal dispatcher stays inaccessible to API roles. Generic operations
-- still require their existing matrix/scope/role permissions; this is not a
-- blanket read-only switch, and it does not close legacy anonymous exposure.
-- After 0014/0015/cutover, review client/gateway dependencies before safe-stop.
-- Do not drop policies/helpers, restore legacy grants, or reapply 0011 to undo
-- this rollback: re-enabling RPCs requires a separately reviewed manual grant.
begin;
revoke execute on function public.move_equipment_master_location(text,text,timestamptz,text),public.set_equipment_shift(text,text,timestamptz,text),
 public.set_equipment_alert_pause(text,text,text,timestamptz,date,text),public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean),
 public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text) from authenticated;
commit;
