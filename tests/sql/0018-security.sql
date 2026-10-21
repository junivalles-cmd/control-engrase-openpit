-- tests/sql/0018-security.sql
-- STAGING ONLY, as postgres, AFTER independent installation of 0018 (on
-- top of an already-ACTIVE 0017). No migration execution from this file.
-- Actual RLS DML; fixture writes always ROLLBACK (the whole script runs
-- inside one transaction that is never committed by the harness that
-- invokes it — see tests/staging0017/README.md for the runner convention
-- this file reuses).
--
-- STATUS (2026-10-18, authoring session): PREPARED, NEVER EXECUTED against
-- any live or local Postgres in this session — this environment has no
-- permission to link/run a database instance here. This file is the exact
-- same hand-authored equivalence-test technique 0017 used
-- (tests/sql/0017-security.sql, 44/44 PASS when it WAS run against
-- production in a prior session) — written to the same standard, ready
-- for a human/future session with DB access to execute before 0018 is
-- ever applied. Discovers real active profiles; needs a SECOND real
-- SUPERVISOR profile for the "other supervisor" test — if only one
-- exists, that one check is SKIPPED with a notice, never faked with a
-- synthetic account (same rule the project has followed throughout).
begin;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end$$;
create function pg_temp.visible(p_actor uuid,p_store text,p_id text) returns boolean language plpgsql as $$
declare found_row boolean; begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  execute 'set local role authenticated';
  select exists(select 1 from public.engrase_sync where store=p_store and id=p_id) into found_row;
  execute 'reset role'; return found_row;
exception when others then execute 'reset role'; raise;
end$$;
create function pg_temp.dml(p_actor uuid,statement text,expected boolean,label text) returns void language plpgsql as $$
declare affected integer:=0; denied boolean:=false; begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  begin
    execute 'set local role authenticated'; execute statement;
    get diagnostics affected=row_count;
    execute 'reset role';
  exception when insufficient_privilege then execute 'reset role'; denied:=true;
  end;
  perform pg_temp.check_true((not denied and affected>0)=expected,label);
end$$;
do $security$
declare
  a uuid; p uuid; s uuid; s2 uuid; l uuid; v uuid;
  au text; su text; s2u text; lu text;
  prefix text:='__0018_test_'||replace(gen_random_uuid()::text,'-','');
  msg_admin text; msg_planner text; msg_s text; msg_s2 text;
  v_payload jsonb; has_second_supervisor boolean:=true;
begin
  select auth_user_id,app_user_id into a,au from public.app_profiles where active and role='ADMINISTRADOR' order by auth_user_id limit 1;
  select auth_user_id,app_user_id into p,au from public.app_profiles where active and role='PLANIFICADOR' order by auth_user_id limit 1;
  -- `au` se reescribe arriba a propósito: solo necesitamos EL id, no distinguir
  -- admin de planner por nombre de variable (cada bloque usa su propio app_user_id real abajo).
  select app_user_id into au from public.app_profiles where auth_user_id=a;
  declare pu text; begin select app_user_id into pu from public.app_profiles where auth_user_id=p; au:=au; end;
  select auth_user_id,app_user_id into s,su from public.app_profiles where active and role='SUPERVISOR' order by auth_user_id limit 1;
  select auth_user_id,app_user_id into s2,s2u from public.app_profiles where active and role='SUPERVISOR' and auth_user_id<>s order by auth_user_id limit 1;
  select auth_user_id,app_user_id into l,lu from public.app_profiles where active and role='LUBRICADOR' order by auth_user_id limit 1;
  select auth_user_id into v from public.app_profiles where active and role='VISOR' order by auth_user_id limit 1;
  if a is null or p is null or s is null or l is null or v is null then raise exception 'Missing real profile fixtures: STOP'; end if;
  if s2 is null then has_second_supervisor:=false; raise notice 'SKIP: solo hay 1 cuenta SUPERVISOR real — se omite la prueba "otro supervisor no puede editar"'; end if;

  foreach a in array array[a] loop
    perform set_config('request.jwt.claim.sub',a::text,true);
    perform pg_temp.check_true(public.resolve_authorization_scope(a)->>'status'='AUTHORIZED','admin operational context AUTHORIZED');
  end loop;

  -- 1) SUPERVISOR crea broadcast = ALLOW (siempre a nombre propio).
  msg_s:=prefix||'_s1';
  v_payload:=jsonb_build_object('id',msg_s,'title','Aviso supervisor','message','x','priority','INFORMATIVA','targetType','ALL_LUBRICATORS','createdBy',su);
  perform pg_temp.dml(s,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_messages',msg_s,v_payload),true,'1. supervisor create own broadcast ALLOW');

  -- 2) SUPERVISOR intenta crear a nombre de otro -> DENY (ownership, igual que ADMIN/PLANIFICADOR).
  perform pg_temp.dml(s,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_messages',prefix||'_s1b',v_payload||jsonb_build_object('id',prefix||'_s1b','createdBy',au)),false,'2. supervisor cannot create as another user DENY');

  -- 3) SUPERVISOR ve su propio mensaje (SELECT).
  perform pg_temp.check_true(pg_temp.visible(s,'broadcast_messages',msg_s),'3. supervisor sees own broadcast');

  -- 4) SUPERVISOR edita su propio mensaje = ALLOW.
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Editado"}','broadcast_messages',msg_s),true,'4. supervisor edit own ALLOW');

  -- 5) SUPERVISOR "cancela" (UPDATE validUntil) su propio mensaje = ALLOW (mismo mecanismo que editar, broadcast_messages no tiene status separado).
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"validUntil":"2020-01-01T00:00:00.000Z"}','broadcast_messages',msg_s),true,'5. supervisor cancel own (shorten validUntil) ALLOW');

  -- 6) ADMIN crea un broadcast propio.
  msg_admin:=prefix||'_admin1';
  v_payload:=jsonb_build_object('id',msg_admin,'title','Aviso admin','message','x','priority','CRITICA','targetType','ALL_LUBRICATORS','createdBy',au);
  perform pg_temp.dml(a,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_messages',msg_admin,v_payload),true,'6. admin create own broadcast ALLOW (baseline unchanged)');

  -- 7) SUPERVISOR intenta editar el broadcast del ADMIN -> DENY.
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Hackeado"}','broadcast_messages',msg_admin),false,'7. supervisor cannot edit admin broadcast DENY');

  -- 8) SUPERVISOR intenta VER (SELECT) el broadcast del ADMIN -> DENY (nunca es receptor por diseño).
  perform pg_temp.check_true(not pg_temp.visible(s,'broadcast_messages',msg_admin),'8. supervisor cannot see admin broadcast (not a receiver)');

  -- 9) PLANIFICADOR crea un broadcast propio.
  declare pu2 text; begin select app_user_id into pu2 from public.app_profiles where auth_user_id=p;
    msg_planner:=prefix||'_planner1';
    v_payload:=jsonb_build_object('id',msg_planner,'title','Aviso planner','message','x','priority','IMPORTANTE','targetType','ALL_LUBRICATORS','createdBy',pu2);
    perform pg_temp.dml(p,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_messages',msg_planner,v_payload),true,'9. planner create own broadcast ALLOW (baseline unchanged)');
  end;

  -- 10) SUPERVISOR intenta editar el broadcast del PLANIFICADOR -> DENY.
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Hackeado"}','broadcast_messages',msg_planner),false,'10. supervisor cannot edit planner broadcast DENY');

  -- 11) ADMIN edita el broadcast del SUPERVISOR = ALLOW (admin administra todos).
  perform pg_temp.dml(a,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Corregido por admin"}','broadcast_messages',msg_s),true,'11. admin manage any (incl. supervisor''s) ALLOW');

  -- 12) PLANIFICADOR edita el broadcast del SUPERVISOR = ALLOW (planner administra todos).
  perform pg_temp.dml(p,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Corregido por planner"}','broadcast_messages',msg_s),true,'12. planner manage any (incl. supervisor''s) ALLOW');

  -- 13) LUBRICADOR intenta crear un broadcast -> DENY (sin cambio respecto a 0017).
  perform pg_temp.dml(l,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_messages',prefix||'_lub1',jsonb_build_object('id',prefix||'_lub1','title','x','message','x','priority','INFORMATIVA','targetType','ALL_LUBRICATORS','createdBy',lu)),false,'13. lubricador create DENY (unchanged)');

  -- 14) LUBRICADOR sigue recibiendo un broadcast ALL_LUBRICATORS (regresión — targeting sin cambios).
  perform pg_temp.check_true(pg_temp.visible(l,'broadcast_messages',msg_admin),'14. lubricador still receives ALL_LUBRICATORS (targeting unchanged, regression check)');

  -- 15) VISOR sigue sin acceso alguno.
  perform pg_temp.check_true(not pg_temp.visible(v,'broadcast_messages',msg_admin),'15. visor still has zero broadcast access (unchanged)');

  -- 16) SUPERVISOR no puede DELETE ni su propio broadcast (solo ADMIN/PLANIFICADOR borran físicamente).
  perform pg_temp.dml(s,format('delete from public.engrase_sync where store=%L and id=%L','broadcast_messages',msg_s),false,'16. supervisor cannot physically delete own broadcast DENY');

  -- 17) ADMIN sí puede DELETE (physical delete sigue exclusivo de ADMIN/PLANIFICADOR, sin cambio).
  perform pg_temp.dml(a,format('delete from public.engrase_sync where store=%L and id=%L','broadcast_messages',msg_planner),true,'17. admin physical delete ALLOW (unchanged)');

  -- 18) "Otro supervisor no puede editar" — solo si existe una 2da cuenta real.
  if has_second_supervisor then
    perform pg_temp.dml(s2,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Hackeado"}','broadcast_messages',msg_s),false,'18. other supervisor cannot edit DENY');
    perform pg_temp.check_true(not pg_temp.visible(s2,'broadcast_messages',msg_s),'18b. other supervisor cannot even SELECT it');
  end if;

  -- 19) Regresión manual_tasks: SUPERVISOR sigue pudiendo crear una tarea (0018 nunca tocó manual_task_row_in_scope()).
  declare task_id text:=prefix||'_task1'; eq text:=prefix||'_eq'; ca text:=prefix||'_ca'; begin
    insert into public.engrase_sync(store,id,payload) values
      ('locations',prefix||'_loc',jsonb_build_object('id',prefix||'_loc','active',true)),
      ('cuadrillas',ca,jsonb_build_object('id',ca,'active',true,'locationId',prefix||'_loc','memberUserIds',jsonb_build_array(su))),
      ('equipment',eq,jsonb_build_object('id',eq,'locationId',prefix||'_loc'));
    perform pg_temp.dml(s,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','manual_tasks',task_id,
      jsonb_build_object('id',task_id,'crewId',ca,'equipmentId',eq,'createdBy',su,'status','PENDING')),true,'19. manual_tasks regression: supervisor still creates tasks ALLOW (unchanged by 0018)');
  end;

  -- 20) Unknown store sigue fail-closed (independiente de este cambio).
  perform pg_temp.dml(a,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)',prefix||'_unknown_store_xyz',prefix||'_u1',jsonb_build_object('id',prefix||'_u1')),false,'20. unknown store fails closed (unchanged)');

end
$security$;
rollback;
