-- GENERATED STAGING-ONLY variant, TEST0017 prefix + marker guard.
-- STAGING ONLY, as postgres, AFTER independent installation of 0017.
-- No migration execution. Actual RLS DML; fixture writes always ROLLBACK.
-- On error issue ROLLBACK and STOP. Never run this file in production.
-- Discovers real active profiles: all five roles + two lubricators required.
begin;
do $staging_guard$ begin
 if to_regclass('test0017_private.environment') is null then raise exception 'No staging marker'; end if;
 if not exists(select 1 from test0017_private.environment where id='TEST0017' and environment='STAGING') then raise exception 'Wrong environment'; end if;
end $staging_guard$;

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
  a uuid; p uuid; s uuid; l uuid; b uuid; v uuid; actor uuid;
  au text; su text; lu text; bu text; actor_user text;
  prefix text:='TEST0017_SQL_'||replace(gen_random_uuid()::text,'-','');
  ca text; cb text; cl text; lp text; ls text; ll text; eq text; task text; msg text; receipt text;
  roles text[]:=array['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR','VISOR']; actors uuid[];
  v_payload jsonb; done jsonb; equipment_before jsonb; f text; target text; n integer; sql text;
begin
  select auth_user_id,app_user_id into a,au from public.app_profiles where active and role='ADMINISTRADOR' order by auth_user_id limit 1;
  select auth_user_id into p from public.app_profiles where active and role='PLANIFICADOR' order by auth_user_id limit 1;
  select auth_user_id,app_user_id into s,su from public.app_profiles where active and role='SUPERVISOR' order by auth_user_id limit 1;
  select auth_user_id,app_user_id into l,lu from public.app_profiles where active and role='LUBRICADOR' order by auth_user_id limit 1;
  select auth_user_id,app_user_id into b,bu from public.app_profiles where active and role='LUBRICADOR' and auth_user_id<>l order by auth_user_id limit 1;
  select auth_user_id into v from public.app_profiles where active and role='VISOR' order by auth_user_id limit 1;
  if a is null or p is null or s is null or l is null or b is null or v is null then raise exception 'Missing real profile fixtures: STOP'; end if;
  actors:=array[a,p,s,l,v]; ca:=prefix||'_a'; cb:=prefix||'_b'; cl:=prefix||'_legacy';
  lp:=prefix||'_principal'; ls:=prefix||'_support'; ll:=prefix||'_old'; eq:=prefix||'_eq'; task:=prefix||'_task';
  insert into public.engrase_sync(store,id,payload) values
    ('locations',lp,jsonb_build_object('id',lp,'active',true)),
    ('locations',ls,jsonb_build_object('id',ls,'active',true)),
    ('locations',ll,jsonb_build_object('id',ll,'active',true)),
    ('cuadrillas',ca,jsonb_build_object('id',ca,'active',true,'locationId',ll,'memberUserIds',jsonb_build_array(lu,su))),
    ('cuadrillas',cb,jsonb_build_object('id',cb,'active',true,'locationId',ls,'memberUserIds',jsonb_build_array(bu,su))),
    ('cuadrillas',cl,jsonb_build_object('id',cl,'active',true,'locationId',ll,'memberUserIds',jsonb_build_array(bu))),
    ('crew_locations',prefix||'_p',jsonb_build_object('crew_id',ca,'location_id',lp,'active',true,'coverage_type','PRINCIPAL')),
    ('crew_locations',prefix||'_s',jsonb_build_object('crew_id',ca,'location_id',ls,'active',true,'coverage_type','APOYO')),
    ('equipment',eq,jsonb_build_object('id',eq,'locationId',lp));
  select payload into equipment_before from public.engrase_sync where store='equipment' and id=eq;
  foreach actor in array actors||array[b] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    if actor<>v then
      perform pg_temp.check_true(public.resolve_authorization_scope(actor)->>'status'='AUTHORIZED','real operational context AUTHORIZED: '||actor::text);
    end if;
  end loop;
  for n in 1..5 loop
    actor:=actors[n]; select app_user_id into actor_user from public.app_profiles where auth_user_id=actor;
    v_payload:=jsonb_build_object('id',prefix||'_bc_'||n,'targetType','ALL_LUBRICATORS','createdBy',actor_user);
    perform pg_temp.dml(actor,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_messages',v_payload->>'id',v_payload),n<=2,'broadcast creation '||roles[n]);
    v_payload:=jsonb_build_object('id',prefix||'_tc_'||n,'crewId',ca,'equipmentId',eq,'createdBy',actor_user,'status','PENDING');
    perform pg_temp.dml(actor,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','manual_tasks',v_payload->>'id',v_payload),n<=3,'task creation '||roles[n]);
  end loop;
  foreach target in array array['ALL_LUBRICATORS','CREW','LOCATION','USER'] loop
    msg:=prefix||'_'||target;
    v_payload:=jsonb_build_object('id',msg,'createdBy',au,'targetType',target,'targetId',case target when 'CREW' then ca when 'LOCATION' then lp when 'USER' then lu else null end);
    insert into public.engrase_sync(store,id,payload) values('broadcast_messages',msg,v_payload);
    perform pg_temp.check_true(pg_temp.visible(l,'broadcast_messages',msg),'lubricator receives '||target);
    perform pg_temp.check_true(not pg_temp.visible(s,'broadcast_messages',msg),'supervisor excluded '||target);
    perform pg_temp.check_true(not pg_temp.visible(v,'broadcast_messages',msg),'visor excluded '||target);
    perform pg_temp.check_true(pg_temp.visible(a,'broadcast_messages',msg) and pg_temp.visible(p,'broadcast_messages',msg),'admin/planner see '||target);
    if target<>'ALL_LUBRICATORS' then perform pg_temp.check_true(not pg_temp.visible(b,'broadcast_messages',msg),'other lubricator excluded '||target); end if;
    if target='USER' then
      update public.engrase_sync set payload=payload||jsonb_build_object('targetId',su) where store='broadcast_messages' and id=msg;
      perform pg_temp.check_true(not pg_temp.visible(s,'broadcast_messages',msg),'exact USER supervisor excluded');
      update public.engrase_sync set payload=payload||jsonb_build_object('targetId',lu) where store='broadcast_messages' and id=msg;
    end if;
  end loop;
  msg:=prefix||'_LOCATION';
  update public.engrase_sync set payload=payload||jsonb_build_object('targetId',ls) where store='broadcast_messages' and id=msg;
  perform pg_temp.check_true(pg_temp.visible(l,'broadcast_messages',msg),'APOYO and multiple locations');
  update public.engrase_sync set payload=payload||jsonb_build_object('targetId',ll) where store='broadcast_messages' and id=msg;
  perform pg_temp.check_true(not pg_temp.visible(l,'broadcast_messages',msg),'real coverage overrides contradictory legacy');
  perform pg_temp.check_true(pg_temp.visible(b,'broadcast_messages',msg),'legacy fallback with no coverage rows');
  insert into public.engrase_sync(store,id,payload) values('crew_locations',prefix||'_inactive',jsonb_build_object('crew_id',cl,'location_id',lp,'active',false));
  perform pg_temp.check_true(not pg_temp.visible(b,'broadcast_messages',msg),'inactive coverage suppresses legacy');
  update public.engrase_sync set deleted=true where store='crew_locations' and id=prefix||'_inactive';
  perform pg_temp.check_true(not pg_temp.visible(b,'broadcast_messages',msg),'deleted coverage cannot resurrect legacy');
  update public.engrase_sync set payload=payload||'{"targetType":"UNKNOWN"}'::jsonb where store='broadcast_messages' and id=msg;
  perform pg_temp.check_true(not pg_temp.visible(l,'broadcast_messages',msg),'unknown target denied');
  msg:=prefix||'_USER'; receipt:=msg||':'||lu;
  v_payload:=jsonb_build_object('id',receipt,'messageId',msg,'userId',lu,'readAt',now());
  sql:=format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_message_reads',receipt,v_payload);
  perform pg_temp.dml(b,sql,false,'B cannot insert A receipt'); perform pg_temp.dml(l,sql,true,'owner inserts receipt');
  perform pg_temp.check_true(pg_temp.visible(l,'broadcast_message_reads',receipt),'owner sees receipt');
  foreach actor in array array[b,a,p,s,v] loop
    perform pg_temp.check_true(not pg_temp.visible(actor,'broadcast_message_reads',receipt),'no foreign/global receipt visibility');
    perform pg_temp.dml(actor,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"readAt":"changed"}','broadcast_message_reads',receipt),false,'foreign receipt update denied');
  end loop;
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"readAt":"changed"}','broadcast_message_reads',receipt),true,'owner updates receipt');
  perform pg_temp.dml(l,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_message_reads',prefix||'_bad',v_payload),false,'malformed receipt ID denied');
  update public.engrase_sync set payload=payload||jsonb_build_object('targetId',bu) where store='broadcast_messages' and id=msg;
  perform pg_temp.check_true(not pg_temp.visible(l,'broadcast_message_reads',receipt),'receipt requires visible message');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"readAt":"again"}','broadcast_message_reads',receipt),false,'invisible message receipt update denied');
  perform pg_temp.dml(l,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_message_reads',receipt||'_other',v_payload||jsonb_build_object('id',receipt||'_other')),false,'invisible message receipt insert denied');
  -- This exact valid receipt ID has no existing row: isolates visibility,
  -- independently of the malformed-ID check above.
  update public.engrase_sync set payload=payload||jsonb_build_object('targetId',lu) where store='broadcast_messages' and id=msg;
  v_payload:=jsonb_build_object('id',msg||':'||bu,'messageId',msg,'userId',bu);
  perform pg_temp.dml(b,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_message_reads',v_payload->>'id',v_payload),false,'valid receipt ID but invisible message denied');
  msg:=prefix||'_ALL_LUBRICATORS';
  v_payload:=jsonb_build_object('id',msg||':'||bu,'messageId',msg,'userId',bu);
  perform pg_temp.dml(b,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','broadcast_message_reads',v_payload->>'id',v_payload),true,'B creates own visible receipt');
  perform pg_temp.check_true(not pg_temp.visible(l,'broadcast_message_reads',v_payload->>'id'),'A cannot read B receipt');
  foreach actor in array array[a,p] loop
    perform pg_temp.dml(actor,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Edited"}','broadcast_messages',msg),true,'admin/planner edit broadcast');
  end loop;
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"title":"Edited"}','broadcast_messages',msg),false,'supervisor cannot edit broadcast');
  perform pg_temp.dml(s,format('delete from public.engrase_sync where store=%L and id=%L','broadcast_messages',msg),false,'supervisor cannot delete broadcast');
  v_payload:=jsonb_build_object('id',task,'equipmentId',eq,'crewId',ca,'createdBy',su,'title','Check','description','Original','taskType','OTRO','priority','IMPORTANT','dueAt','2026-10-20','status','PENDING');
  insert into public.engrase_sync(store,id,payload) values('manual_tasks',task,v_payload);
  perform pg_temp.check_true(pg_temp.visible(l,'manual_tasks',task) and not pg_temp.visible(b,'manual_tasks',task),'task crew visibility');
  done:=v_payload||jsonb_build_object('status','COMPLETED','completedBy',lu,'completedAt',now(),'completionComment','Done','photos',jsonb_build_array('manual_tasks/test.jpg'));
  foreach f in array array['crewId','equipmentId'] loop
    perform pg_temp.dml(a,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)','manual_tasks',task||'_missing',v_payload-f),false,'required task field '||f);
  end loop;
  foreach f in array array['equipmentId','crewId','createdBy','title','description','taskType','priority','dueAt'] loop
    perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',done||jsonb_build_object(f,prefix||'_tampered'),'manual_tasks',task),false,'protected field '||f);
    perform pg_temp.check_true((select payload=v_payload from public.engrase_sync where store='manual_tasks' and id=task),'denied UPDATE preserves task');
  end loop;
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',v_payload||'{"unexpected":"tampered"}'::jsonb,'manual_tasks',task),false,'PENDING arbitrary field blocked');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',done||'{"unexpected":"tampered"}'::jsonb,'manual_tasks',task),false,'completion arbitrary field blocked');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',done||jsonb_build_object('completedBy',bu),'manual_tasks',task),false,'cannot complete for another user');
  perform pg_temp.dml(b,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',done||jsonb_build_object('completedBy',bu),'manual_tasks',task),false,'other crew cannot complete');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',v_payload||'{"status":"CANCELLED"}'::jsonb,'manual_tasks',task),false,'lubricator cannot cancel');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',done-'completedAt','manual_tasks',task),false,'completion requires completedAt');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L',done,'manual_tasks',task),true,'actual PENDING -> COMPLETED');
  perform pg_temp.check_true((select payload=done from public.engrase_sync where store='manual_tasks' and id=task),'completion saved with photos');
  perform pg_temp.dml(l,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"completionComment":"again"}','manual_tasks',task),false,'completed task cannot be rewritten');
  update public.engrase_sync set payload=v_payload where store='manual_tasks' and id=task;
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L',jsonb_build_object('crewId',cb,'previousCrewId',ca),'manual_tasks',task),true,'supervisor reassigns A -> B');
  perform pg_temp.check_true(not pg_temp.visible(l,'manual_tasks',task) and pg_temp.visible(b,'manual_tasks',task),'A loses, B gains same task ID');
  perform pg_temp.check_true((select payload=equipment_before from public.engrase_sync where store='equipment' and id=eq),'equipment location unchanged');
  perform pg_temp.dml(s,format('update public.engrase_sync set payload=payload||%L::jsonb where store=%L and id=%L','{"status":"CANCELLED"}','manual_tasks',task),true,'creator cancels task');
  perform pg_temp.check_true((select count(*)=1 and bool_and(payload->>'status'='CANCELLED') from public.engrase_sync where store='manual_tasks' and id=task),'cancelled row preserved, not pending');
  -- Unknown stores are denied by EFFECTIVE matrix + row RLS. The old
  -- baseline helper alone accepts GLOBAL unknowns; do not confuse the two.
  insert into public.engrase_sync(store,id,payload) values(prefix||'_unknown',prefix,'{}');
  foreach actor in array actors loop
    perform pg_temp.check_true(not pg_temp.visible(actor,prefix||'_unknown',prefix),'unknown SELECT fail closed');
    perform pg_temp.dml(actor,format('insert into public.engrase_sync(store,id,payload) values(%L,%L,%L::jsonb)',prefix||'_unknown',prefix||'_new','{}'),false,'unknown INSERT fail closed');
    perform pg_temp.dml(actor,format('update public.engrase_sync set payload=%L::jsonb where store=%L and id=%L','{}',prefix||'_unknown',prefix),false,'unknown UPDATE fail closed');
    perform pg_temp.dml(actor,format('delete from public.engrase_sync where store=%L and id=%L',prefix||'_unknown',prefix),false,'unknown DELETE fail closed');
  end loop;
end $security$;
rollback;
