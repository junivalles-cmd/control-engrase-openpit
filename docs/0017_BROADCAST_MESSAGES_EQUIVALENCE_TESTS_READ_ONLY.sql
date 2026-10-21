-- 0017 revision 3. READ ONLY; requires 0017 already installed in STAGING.
-- Never install 0017 in production just to run this query.
-- Uses real profiles and binds auth.uid() to each resolved context.
-- No placeholder UUIDs, empty/vacuous success, fixtures or sampling LIMIT.
-- End-to-end RLS/DML tests live in tests/sql/0017-security.sql; those
-- require staging, write disposable fixtures and always ROLLBACK.
begin transaction read only;
do $equivalence$
declare
  actor record; candidate record; ctx jsonb; old_result boolean; new_result boolean;
  old_not_new integer:=0; new_not_old integer:=0; checked integer:=0; actors integer:=0;
begin
  if to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null then
    raise exception '0017 absent: STOP. Do not install it in production to run these tests';
  end if;
  for actor in select auth_user_id from public.app_profiles where active loop
    perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
    ctx:=public.resolve_authorization_scope(actor.auth_user_id);
    if ctx->>'status' is distinct from 'AUTHORIZED' then continue; end if;
    actors:=actors+1;
    for candidate in select e.*,a.action from public.engrase_sync e
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) a(action)
      where e.store not in ('broadcast_messages','broadcast_message_reads','manual_tasks') loop
      old_result:=coalesce(
        (candidate.action='SELECT' and auth.uid() is not null and ctx->>'status'='AUTHORIZED'
         and ctx->'context'->>'authUserId'=auth.uid()::text
         and authorization_private.support_row_granted(candidate.store,candidate.id,ctx))
        or authorization_private.authorization_row_in_scope_baseline_0013(
          candidate.store,candidate.id,candidate.payload,candidate.action,ctx),false);
      new_result:=coalesce(authorization_private.authorization_row_in_scope(
        candidate.store,candidate.id,candidate.payload,candidate.action,ctx),false);
      old_not_new:=old_not_new+(old_result and not new_result)::integer;
      new_not_old:=new_not_old+(new_result and not old_result)::integer;
      checked:=checked+1;
    end loop;
  end loop;
  if actors=0 or checked=0 then raise exception 'Empty equivalence is NOT a pass'; end if;
  raise notice 'OLD_NOT_NEW=%, NEW_NOT_OLD=%, CHECKED=%, ACTORS=%',old_not_new,new_not_old,checked,actors;
  if old_not_new<>0 or new_not_old<>0 then raise exception 'Existing-store difference: STOP, READY TO APPLY=NO'; end if;
end $equivalence$;
rollback;
