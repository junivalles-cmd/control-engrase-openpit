-- PREPARED ONLY. Disable new clients first; never revert to generic writes.
-- Receipts are retained to preserve idempotency/audit evidence. No data deletion.
begin;
revoke execute on function public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz) from authenticated;
commit;
