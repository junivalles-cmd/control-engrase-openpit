-- STAGING ONLY, POST-0017. Small fixtures, real RLS, EXPLAIN ANALYZE.
-- Run as postgres with ON_ERROR_STOP. Never in production. No timeout change.
begin;
do $guard$ begin
  if to_regclass('test0017_private.environment') is null then raise exception 'No staging marker'; end if;
  if not exists(select 1 from test0017_private.environment where id='TEST0017' and environment='STAGING') then raise exception 'Wrong environment'; end if;
  if to_regprocedure('authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb)') is null
    or to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null then raise exception '0017 not installed'; end if;
  if not exists(select 1 from app_profiles where app_user_id='TEST0017_LUB_A' and role='LUBRICADOR' and active) then raise exception 'No synthetic lubricator'; end if;
end $guard$;
insert into public.engrase_sync(store,id,payload) values
('broadcast_messages','TEST0017_PERF_LOCATION',jsonb_build_object('id','TEST0017_PERF_LOCATION','targetType','LOCATION','targetId','TEST0017_LOC_B','createdBy','TEST0017_ADMIN')),
('manual_tasks','TEST0017_PERF_TASK',jsonb_build_object('id','TEST0017_PERF_TASK','crewId','TEST0017_CREW_A','equipmentId','TEST0017_EQUIPMENT_X','createdBy','TEST0017_SUPERVISOR','title','Synthetic performance fixture','description','Synthetic','taskType','OTRO','priority','INFO','status','PENDING'));
select set_config('request.jwt.claim.sub',(select auth_user_id::text from app_profiles where app_user_id='TEST0017_LUB_A'),true);
set local role authenticated;

-- LOCATION: APOYO, real wrapper invoked under the actual test identity.
explain (analyze,buffers,format json)
select * from public.engrase_sync where store='broadcast_messages' and id='TEST0017_PERF_LOCATION';

-- SELECT crew: fixture-sized dataset, retain the real row/store policies.
explain (analyze,buffers,format json)
select * from public.engrase_sync where store='manual_tasks' and payload->>'crewId'='TEST0017_CREW_A';

-- UPDATE really executes, but this entire transaction always rolls back.
explain (analyze,buffers,format json)
update public.engrase_sync set payload=payload||jsonb_build_object(
 'status','COMPLETED','completedBy','TEST0017_LUB_A','completedAt',clock_timestamp(),
 'completionComment','Synthetic performance completion','photos','[]'::jsonb)
where store='manual_tasks' and id='TEST0017_PERF_TASK';
reset role;
do $verify$ begin
  if not exists(select 1 from public.engrase_sync where store='manual_tasks' and id='TEST0017_PERF_TASK'
    and payload->>'status'='COMPLETED') then raise exception 'Completion affected no task: not a PASS'; end if;
end $verify$;
rollback;
-- Must be zero after the rollback. Base TEST0017 seed remains until cleanup.
select count(*) as performance_fixtures_left from public.engrase_sync where id in ('TEST0017_PERF_LOCATION','TEST0017_PERF_TASK');
