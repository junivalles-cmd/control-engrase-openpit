-- PREPARED ONLY. Safe stop; preserves all evidence, receipts and restrictive guards.
-- No reopening direct writes. Never automatically execute.
begin;
revoke execute on function public.report_anomaly(text,text,text,text,text,text,text,jsonb),
 public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb),public.close_anomaly(text,text,text,timestamptz,text),
 public.retire_anomaly(text,text,timestamptz),public.repeat_anomaly_from_execution(text,text,text,timestamptz),
 public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text),
 public.resolve_grease_validation_conflict(text,text,text,text,jsonb) from authenticated;
commit;
