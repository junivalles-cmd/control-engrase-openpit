-- User-authorized SCHEMA/METADATA extraction for staging preparation.
-- Read only: no operational data, profiles/Auth rows, secrets or image objects.
-- app_store_permissions is explicitly requested authorization configuration.
-- Does NOT export function source. Rebuild only from verified local sources.
begin transaction read only;
with app_tables as materialized (
 select c.oid,n.nspname as schema,c.relname as name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
   pg_get_userbyid(c.relowner) as owner
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','authorization_private') and c.relkind in ('r','p')
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
), app_functions as materialized (
 select p.oid,n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as args,
   pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
   p.prorettype::regtype::text as return_type,pg_get_function_result(p.oid) as return_declaration,
   md5(coalesce(pg_get_expr(p.proargdefaults,0),'')) as argument_defaults_md5,
   p.proargmodes as argument_modes,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,
   p.procost,p.prorows,l.lanname as language,
   md5(btrim(replace(p.prosrc,E'\r\n',E'\n'))) as source_md5,
   md5(regexp_replace(p.prosrc,'[[:space:]]','','g')) as no_whitespace_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_language l on l.oid=p.prolang
 where n.nspname in ('public','authorization_private') and p.prokind in ('f','p')
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
)
select jsonb_build_object(
 'captured_at',current_timestamp,'read_only',current_setting('transaction_read_only'),
 'server_version',current_setting('server_version'),
 'tables',(select coalesce(jsonb_agg(to_jsonb(t)-'oid' order by schema,name),'[]') from app_tables t),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',a.attname,
   'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by t.schema,t.name,a.attnum),'[]')
   from app_tables t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',c.conname,
   'type',c.contype,'definition',pg_get_constraintdef(c.oid,false),'validated',c.convalidated) order by t.schema,t.name,c.conname),'[]')
   from app_tables t join pg_constraint c on c.conrelid=t.oid),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',ic.relname,
   'definition',pg_get_indexdef(i.indexrelid),'constraint_index',exists(select 1 from pg_constraint co where co.conindid=i.indexrelid),
   'valid',i.indisvalid) order by t.schema,t.name,ic.relname),'[]')
   from app_tables t join pg_index i on i.indrelid=t.oid join pg_class ic on ic.oid=i.indexrelid),
 'functions',(select coalesce(jsonb_agg(to_jsonb(f)-'oid' order by schema,name,args),'[]') from app_functions f),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p
   where (schemaname in ('public','authorization_private')) or (schemaname='storage' and tablename='objects')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',tr.tgname,
   'definition_md5',md5(pg_get_triggerdef(tr.oid,false)),'enabled',tr.tgenabled,
   'function_schema',fn.nspname,'function_name',fp.proname,
   'external_webhook',fn.nspname='supabase_functions' and fp.proname='http_request') order by t.schema,t.name,tr.tgname),'[]')
   from app_tables t join pg_trigger tr on tr.tgrelid=t.oid and not tr.tgisinternal
   join pg_proc fp on fp.oid=tr.tgfoid join pg_namespace fn on fn.oid=fp.pronamespace),
 'table_grants',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by t.schema,t.name,a.grantee,a.privilege_type),'[]')
   from app_tables t join pg_class c on c.oid=t.oid cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),
 'function_grants',(select coalesce(jsonb_agg(jsonb_build_object('schema',f.schema,'name',f.name,'args',f.args,
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by f.schema,f.name,f.args,a.grantee,a.privilege_type),'[]')
   from app_functions f join pg_proc p on p.oid=f.oid cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),
 'schema_grants',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by n.nspname,a.grantee,a.privilege_type),'[]')
   from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname in ('public','authorization_private')),
 'matrix',(select coalesce(jsonb_agg(to_jsonb(m) order by store,role),'[]') from public.app_store_permissions m),
 'support_control',(select coalesce(jsonb_agg(jsonb_build_object('singleton',singleton,'enabled',enabled)),'[]') from authorization_private.support_control),
 'release_state',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'matrix_digest',matrix_digest) order by version),'[]') from authorization_private.release_migration_state),
 'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) order by e.extname),'[]') from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'bucket',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)),'[]')
   from storage.buckets where id='engrase-photos'),
 'types',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype) order by n.nspname,t.typname),'[]')
   from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','authorization_private') and t.typtype in ('e','d')
   and not exists(select 1 from pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e')),
 'sequences',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname),'[]')
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','authorization_private') and c.relkind='S'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind) order by n.nspname,c.relname),'[]')
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','authorization_private') and c.relkind in ('v','m')
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e'))
) as catalog;
rollback;
