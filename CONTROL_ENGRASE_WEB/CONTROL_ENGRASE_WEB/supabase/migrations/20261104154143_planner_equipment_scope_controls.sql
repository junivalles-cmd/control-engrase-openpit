-- Cierre del cutover PLANIFICADOR por ubicación:
-- 1) permite crear/editar equipos solo dentro de su ubicación asignada;
-- 2) un perfil legacy sin ubicación mantiene sesión pero recibe cero alcance
--    operacional, sin fallback global ni logout automático.
begin;

update public.app_store_permissions
set can_insert=true, can_update=true
where role='PLANIFICADOR' and store='equipment';

-- Estas políticas ya existían como RESTRICTIVE. Se conserva exactamente su
-- matriz salvo que equipment admite PLANIFICADOR; el clasificador por fila y
-- enforce_planner_location_write siguen exigiendo la ubicación asignada.
drop policy if exists catalog_insert_roles on public.engrase_sync;
create policy catalog_insert_roles on public.engrase_sync
as restrictive for insert to authenticated
with check (
  case
    when store='settings' then public.catalog_writer_role()='ADMINISTRADOR'
    when store in ('equipment','lubrication_plans','lubrication_points')
      then public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR')
    else true
  end
);

drop policy if exists catalog_update_roles on public.engrase_sync;
create policy catalog_update_roles on public.engrase_sync
as restrictive for update to authenticated
using (
  case
    when store='settings' then public.catalog_writer_role()='ADMINISTRADOR'
    when store in ('equipment','lubrication_plans','lubrication_points')
      then public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR')
    else true
  end
)
with check (
  case
    when store='settings' then public.catalog_writer_role()='ADMINISTRADOR'
    when store in ('equipment','lubrication_plans','lubrication_points')
      then public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR')
    else true
  end
);

-- Conserva el resolver estricto instalado por planner_location_scope como
-- implementación base. El wrapper solo transforma los dos estados de perfil
-- incompleto en un contexto autenticado vacío y con fingerprint propio.
alter function public.resolve_authorization_scope(uuid)
  rename to resolve_authorization_scope_location_required_20261104;
revoke all on function public.resolve_authorization_scope_location_required_20261104(uuid)
  from public,anon,authenticated;

create function public.resolve_authorization_scope(p_auth_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=pg_catalog
as $scope$
declare
  base_result jsonb;
  profile public.app_profiles%rowtype;
  fingerprint text;
begin
  base_result := public.resolve_authorization_scope_location_required_20261104(p_auth_user_id);
  if base_result->>'status'='AUTHORIZED' then return base_result; end if;
  if base_result->>'code' not in ('PLANNER_LOCATION_REQUIRED','PLANNER_LOCATION_INVALID') then
    return base_result;
  end if;

  select * into profile from public.app_profiles where auth_user_id=p_auth_user_id;
  if not found or profile.active is distinct from true or profile.role<>'PLANIFICADOR' then
    return base_result;
  end if;

  fingerprint := md5(jsonb_build_object(
    'authUserId',profile.auth_user_id,'appUserId',profile.app_user_id,
    'role',profile.role,'active',profile.active,'sourceLocationId',profile.location_id,
    'scopeType','NO_LOCATION_ASSIGNED','authorizedCrewIds','[]'::jsonb,
    'authorizedLocationIds','[]'::jsonb
  )::text);

  return jsonb_build_object('status','AUTHORIZED','context',jsonb_build_object(
    'authUserId',profile.auth_user_id,'appUserId',profile.app_user_id,
    'displayName',profile.display_name,'role',profile.role,'active',profile.active,
    'locationId',null,'scopeType','NO_LOCATION_ASSIGNED',
    'authorizedCrewIds','[]'::jsonb,'authorizedLocationIds','[]'::jsonb,
    'authorizationFingerprint',fingerprint,'rowScopeEnforced',false,
    'scopeCode',base_result->>'code'
  ));
end
$scope$;

revoke all on function public.resolve_authorization_scope(uuid)
  from public,anon,authenticated;

commit;
