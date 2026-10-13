-- PREPARED ONLY. Installs the generic transport matrix for PRE-0008.
-- Capability available only through a typed RPC is deliberately not represented
-- as a generic can_insert/can_update/can_delete grant.
begin;
do $preconditions$
begin
  if to_regprocedure('public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text)') is null
     or to_regprocedure('public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text)') is null then
    raise exception '0015 requires the 0014 assignment/skip gateways';
  end if;
  if (select count(*) from public.app_store_permissions
      where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
        and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
          'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
          'notification_dispatch_log','push_tokens','settings','shifts','users')) <> 72 then
    raise exception '0015 requires exactly the known 72 role/store rows; reconcile missing or duplicate matrix rows first';
  end if;
end
$preconditions$;

with target(store,role,can_read,can_insert,can_update,can_delete) as (values
 ('anomalies','ADMINISTRADOR',true,false,false,false),('audit_log','ADMINISTRADOR',true,false,false,false),
 ('cuadrillas','ADMINISTRADOR',true,true,true,true),('equipment','ADMINISTRADOR',true,true,true,true),
 ('equipment_types','ADMINISTRADOR',true,true,true,true),('grease_validations','ADMINISTRADOR',true,false,false,false),
 ('locations','ADMINISTRADOR',true,true,true,true),('lubricants','ADMINISTRADOR',true,true,true,true),
 ('lubrication_assignments','ADMINISTRADOR',true,false,false,false),('lubrication_plans','ADMINISTRADOR',true,true,true,true),
 ('lubrication_points','ADMINISTRADOR',true,true,true,true),('lubrication_records','ADMINISTRADOR',true,false,false,false),
 ('lubrication_skips','ADMINISTRADOR',true,false,false,false),('notification_dispatch_log','ADMINISTRADOR',false,false,false,false),
 ('push_tokens','ADMINISTRADOR',true,true,true,false),('settings','ADMINISTRADOR',true,true,true,false),
 ('shifts','ADMINISTRADOR',true,true,true,true),('users','ADMINISTRADOR',false,false,false,false),
 ('anomalies','PLANIFICADOR',false,false,false,false),('audit_log','PLANIFICADOR',false,false,false,false),
 ('cuadrillas','PLANIFICADOR',true,false,false,false),('equipment','PLANIFICADOR',true,false,false,false),
 ('equipment_types','PLANIFICADOR',true,false,false,false),('grease_validations','PLANIFICADOR',true,false,false,false),
 ('locations','PLANIFICADOR',true,false,false,false),('lubricants','PLANIFICADOR',true,false,false,false),
 ('lubrication_assignments','PLANIFICADOR',true,false,false,false),('lubrication_plans','PLANIFICADOR',true,true,true,false),
 ('lubrication_points','PLANIFICADOR',true,true,true,false),('lubrication_records','PLANIFICADOR',true,false,false,false),
 ('lubrication_skips','PLANIFICADOR',true,false,false,false),('notification_dispatch_log','PLANIFICADOR',false,false,false,false),
 ('push_tokens','PLANIFICADOR',true,true,true,false),('settings','PLANIFICADOR',true,false,false,false),
 ('shifts','PLANIFICADOR',true,false,false,false),('users','PLANIFICADOR',false,false,false,false),
 ('anomalies','SUPERVISOR',true,false,false,false),('audit_log','SUPERVISOR',false,false,false,false),
 ('cuadrillas','SUPERVISOR',true,false,false,false),('equipment','SUPERVISOR',true,false,false,false),
 ('equipment_types','SUPERVISOR',true,false,false,false),('grease_validations','SUPERVISOR',true,false,false,false),
 ('locations','SUPERVISOR',true,false,false,false),('lubricants','SUPERVISOR',true,false,false,false),
 ('lubrication_assignments','SUPERVISOR',true,false,false,false),('lubrication_plans','SUPERVISOR',true,false,false,false),
 ('lubrication_points','SUPERVISOR',true,false,false,false),('lubrication_records','SUPERVISOR',true,false,false,false),
 ('lubrication_skips','SUPERVISOR',true,false,false,false),('notification_dispatch_log','SUPERVISOR',false,false,false,false),
 ('push_tokens','SUPERVISOR',true,true,true,false),('settings','SUPERVISOR',true,false,false,false),
 ('shifts','SUPERVISOR',true,false,false,false),('users','SUPERVISOR',false,false,false,false),
 ('anomalies','LUBRICADOR',true,false,false,false),('audit_log','LUBRICADOR',false,false,false,false),
 ('cuadrillas','LUBRICADOR',true,false,false,false),('equipment','LUBRICADOR',true,false,false,false),
 ('equipment_types','LUBRICADOR',true,false,false,false),('grease_validations','LUBRICADOR',true,false,false,false),
 ('locations','LUBRICADOR',true,false,false,false),('lubricants','LUBRICADOR',true,false,false,false),
 ('lubrication_assignments','LUBRICADOR',true,false,false,false),('lubrication_plans','LUBRICADOR',true,false,false,false),
 ('lubrication_points','LUBRICADOR',true,false,false,false),('lubrication_records','LUBRICADOR',true,false,false,false),
 ('lubrication_skips','LUBRICADOR',true,false,false,false),('notification_dispatch_log','LUBRICADOR',false,false,false,false),
 ('push_tokens','LUBRICADOR',true,true,true,false),('settings','LUBRICADOR',true,false,false,false),
 ('shifts','LUBRICADOR',true,false,false,false),('users','LUBRICADOR',false,false,false,false)
)
update public.app_store_permissions p set can_read=t.can_read,can_insert=t.can_insert,
  can_update=t.can_update,can_delete=t.can_delete
from target t where p.store=t.store and p.role=t.role;

do $assertions$
begin
  if exists(select 1 from public.app_store_permissions where store='notification_dispatch_log'
      and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and (can_read or can_insert or can_update or can_delete)) then raise exception 'dispatch log must remain server-only'; end if;
  if exists(select 1 from public.app_store_permissions where store in ('lubrication_assignments','lubrication_skips',
      'lubrication_records','anomalies','grease_validations') and role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and (can_insert or can_update or can_delete)) then raise exception 'typed RPC stores cannot retain generic mutation permissions'; end if;
end
$assertions$;
create table if not exists authorization_private.release_migration_state (
  version text primary key, applied_at timestamptz not null default clock_timestamp(), matrix_digest text not null
);
revoke all on authorization_private.release_migration_state from public,anon,authenticated;
insert into authorization_private.release_migration_state(version,matrix_digest)
  select '0015_store_permission_target',md5(string_agg(store||':'||role||':'||can_read||':'||can_insert||':'||can_update||':'||can_delete,'|' order by store,role))
  from public.app_store_permissions where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
    and store in ('anomalies','audit_log','cuadrillas','equipment','equipment_types','grease_validations','locations','lubricants',
      'lubrication_assignments','lubrication_plans','lubrication_points','lubrication_records','lubrication_skips',
      'notification_dispatch_log','push_tokens','settings','shifts','users')
  on conflict(version) do update set applied_at=excluded.applied_at,matrix_digest=excluded.matrix_digest;
commit;
