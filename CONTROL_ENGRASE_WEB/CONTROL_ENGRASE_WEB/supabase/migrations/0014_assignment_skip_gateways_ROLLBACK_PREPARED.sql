-- MANUAL-PRODUCTION-PREPARED safe-stop. Stop execution/evidence/assignment clients first.
-- Revoke typed public wrappers; retain receipts, dispatchers (API-denied),
-- all 0014 mutation guards, all eight 0013 gates/readiness and catalog_*.
-- Do not drop policies, remove data, restore anon grants or reset the matrix.
-- After 0015/cutover review release dependencies before applying safe-stop.
begin;
-- Safe-stop, NOT restoration of 0009/0010 bodies. Keep accepted history and all
-- guards. Operational support stops immediately at the server; cached copies
-- are hidden when clients next reconcile. No bucket or row data is removed.
update authorization_private.support_control set enabled=false where singleton;
revoke execute on function public.get_assignment_support_context(),
 public.authorize_assignment_evidence_upload(text,text,text),
 public.report_assignment_anomaly(text,text,text,text,text,text,text,jsonb,text)
from public,anon,authenticated;
-- Stop execution/evidence clients as well: replaced functions remain installed.
-- Conservative safe-stop revokes normal and support execution/evidence alike;
-- a separately reviewed forward migration is required to resume them.
revoke execute on function
 public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz),
 public.report_anomaly(text,text,text,text,text,text,text,jsonb),
 public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb),
 public.close_anomaly(text,text,text,timestamptz,text),public.retire_anomaly(text,text,timestamptz),
 public.repeat_anomaly_from_execution(text,text,text,timestamptz),
 public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text),
 public.resolve_grease_validation_conflict(text,text,text,text,jsonb)
from public,anon,authenticated;
revoke execute on function
  public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text),
  public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)
from public,anon,authenticated;
revoke all on function
  public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)
from public,anon,authenticated;
commit;
