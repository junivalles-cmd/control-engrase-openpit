import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadAuthLogic, loadDbLogic, loadManageUsersLogic, loadOperationalScopeLogic,
} from '../helpers/loadLubricationLogic.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_PATH = path.join(ROOT, 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js');
const MIGRATION_PATH = path.join(ROOT, 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/20261104151939_planner_location_scope.sql');
const FOLLOWUP_MIGRATION_PATH = path.join(ROOT, 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/20261104154143_planner_equipment_scope_controls.sql');
const EDGE_PATH = path.join(ROOT, 'CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/manage-users/index.ts');

afterEach(() => vi.unstubAllGlobals());

describe('PLANIFICADOR — alcance operativo único por ubicación maestra', () => {
  const {
    resolveOperationalScope, canAccessLocation, canAccessEquipment,
    filterEquipmentByScope, filterRowsByEquipmentScope, classifyEquipmentWork,
  } = loadOperationalScopeLogic();
  const equipment = [
    { id: 'e-volcan', locationId: 'volcan' },
    { id: 'e-mojon', locationId: 'mojon' },
  ];
  const scope = resolveOperationalScope({
    currentUser: { id: 'planner', role: 'PLANIFICADOR', locationId: 'volcan' },
    cuadrillas: [], shiftId: 'shift_dia',
  });

  it('no es global y solo autoriza su locationId explícito', () => {
    expect(scope.kind).toBe('LOCATION_SCOPED');
    expect(canAccessLocation(scope, 'volcan')).toBe(true);
    expect(canAccessLocation(scope, 'mojon')).toBe(false);
    expect(canAccessEquipment(scope, equipment[0])).toBe(true);
    expect(canAccessEquipment(scope, equipment[1])).toBe(false);
  });

  it('filtra equipos y filas relacionadas por equipmentId sin inferir cuadrilla/turno', () => {
    expect(filterEquipmentByScope(equipment, scope).map(row => row.id)).toEqual(['e-volcan']);
    const rows = [{ id: 'p1', equipmentId: 'e-volcan' }, { id: 'p2', equipmentId: 'e-mojon' }];
    expect(filterRowsByEquipmentScope(rows, equipment, scope).map(row => row.id)).toEqual(['p1']);
  });

  it('classifyEquipmentWork nunca devuelve equipo/asignación de otra ubicación', () => {
    const result = classifyEquipmentWork({ scope, equipos: equipment, cuadrillas: [],
      assignments: [
        { id: 'a1', equipmentId: 'e-volcan', status: 'PENDING', active: true },
        { id: 'a2', equipmentId: 'e-mojon', status: 'PENDING', active: true },
      ] });
    expect(result.normal.map(row => row.id)).toEqual(['e-volcan']);
    expect(result.assigned.map(row => row.id)).toEqual(['a1']);
  });
});

describe('PLANIFICADOR — cache local respeta LOCATION_SCOPED', () => {
  const { localAuthorizationState } = loadDbLogic();
  const context = { appUserId: 'planner', active: true, scopeType: 'LOCATION_SCOPED',
    authorizedCrewIds: ['crew-volcan'], authorizedLocationIds: ['volcan'] };
  const tagged = row => ({ ...row, __authorizationAppUserId: 'planner', _pushedVersion: row.updatedAt });

  it('equipo de la ubicación asignada autorizado; otra ubicación fuera de alcance', () => {
    expect(localAuthorizationState('equipment', tagged({ id: 'e1', locationId: 'volcan' }), context, 'planner')).toBe('AUTHORIZED');
    expect(localAuthorizationState('equipment', tagged({ id: 'e2', locationId: 'mojon' }), context, 'planner')).toBe('OUT_OF_SCOPE');
  });

  it('filas relacionadas fallan cerrado en el clasificador puro hasta resolver el equipo maestro', () => {
    expect(localAuthorizationState('lubrication_records', tagged({ id: 'r1', equipmentId: 'e1', locationId: 'volcan', crewId: 'crew-apoyo' }), context, 'planner')).toBe('OUT_OF_SCOPE');
    expect(localAuthorizationState('anomalies', tagged({ id: 'x1', equipmentId: 'e2', locationId: 'mojon', crewId: 'crew-volcan' }), context, 'planner')).toBe('OUT_OF_SCOPE');
  });
});

describe('PLANIFICADOR — perfil y administración de usuarios', () => {
  it('perfil PLANIFICADOR incompleto conserva sesión para mostrar el estado fail-closed', () => {
    const { isValidProfile } = loadAuthLogic({});
    expect(isValidProfile({ active: true, role: 'PLANIFICADOR' })).toBe(true);
    expect(isValidProfile({ active: true, role: 'PLANIFICADOR', locationId: 'volcan' })).toBe(true);
    expect(isValidProfile({ active: true, role: 'ADMINISTRADOR' })).toBe(true);
  });

  it('CREATE_USER rechaza planificador sin ubicación antes de tocar red', async () => {
    const { handleCreateUser } = loadManageUsersLogic();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await handleCreateUser({ supabaseUrl: 'https://fake', serviceRoleKey: 's' },
      { display_name: 'Planificador', username: 'planner', role: 'PLANIFICADOR', temp_password: '12345678' });
    expect(result).toEqual({ status: 400, body: { error: 'planner_location_required' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CREATE_USER valida catálogo maestro y persiste location_id', async () => {
    const { handleCreateUser } = loadManageUsersLogic();
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push([String(url), options]);
      if (String(url).includes('app_user_id=eq.')) return { ok: true, json: async () => [] };
      if (String(url).includes('store=eq.locations')) return { ok: true, json: async () => [{ id: 'volcan', payload: { active: true }, deleted: false }] };
      if (String(url).includes('/auth/v1/admin/users') && options.method === 'POST') return { ok: true, json: async () => ({ id: 'auth-new' }) };
      if (String(url).endsWith('/rest/v1/app_profiles') && options.method === 'POST') return { ok: true, json: async () => [{}] };
      throw new Error(`unexpected ${url}`);
    }));
    const result = await handleCreateUser({ supabaseUrl: 'https://fake', serviceRoleKey: 's' },
      { display_name: 'Planificador', username: 'planner', role: 'PLANIFICADOR', location_id: 'volcan', temp_password: '12345678' });
    expect(result.status).toBe(200);
    const profileRequest = calls.find(([url, options]) => url.endsWith('/rest/v1/app_profiles') && options.method === 'POST');
    expect(JSON.parse(profileRequest[1].body)[0].location_id).toBe('volcan');
  });

  it('UPDATE_ROLE permite al ADMIN cambiar la ubicación sin mover equipos', async () => {
    const { handleUpdateRole } = loadManageUsersLogic();
    let patchBody = null;
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (String(url).includes('app_user_id=eq.') && !options.method) {
        return { ok: true, json: async () => [{ auth_user_id: 'auth-planner', app_user_id: 'u_planner', role: 'PLANIFICADOR', location_id: 'volcan', active: true }] };
      }
      if (String(url).includes('store=eq.locations')) {
        return { ok: true, json: async () => [{ id: 'mojon', payload: { active: true }, deleted: false }] };
      }
      if (options.method === 'PATCH') { patchBody = JSON.parse(options.body); return { ok: true, json: async () => [{}] }; }
      throw new Error(`unexpected ${url}`);
    }));
    const result = await handleUpdateRole({ supabaseUrl: 'https://fake', serviceRoleKey: 's' },
      { app_user_id: 'u_planner', role: 'PLANIFICADOR', location_id: 'mojon' });
    expect(result.status).toBe(200);
    expect(patchBody).toMatchObject({ role: 'PLANIFICADOR', location_id: 'mojon' });
    expect(patchBody).not.toHaveProperty('equipmentId');
  });
});

describe('Defensa en profundidad — UI, Edge Function y SQL', () => {
  const app = fs.readFileSync(APP_PATH, 'utf8');
  const edge = fs.readFileSync(EDGE_PATH, 'utf8');
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const followupSql = fs.readFileSync(FOLLOWUP_MIGRATION_PATH, 'utf8');

  it('UI usa ubicaciones maestras, muestra placeholder y valida mensaje exacto', () => {
    expect(app).toContain("const locations = await DB.allActive('locations')");
    expect(app).toContain('— Seleccionar ubicación —');
    expect(app).toContain('Selecciona la ubicación asignada al planificador.');
    expect(app).toContain("location_id: fd.role === 'PLANIFICADOR' ? fd.location_id : null");
    expect(app).toContain("PLANIFICADOR: ['dashboard','tareas-mensajes','equipos','plan','matriz','turno','historial','anomalias','reportes'");
    expect(app).toContain('No tienes una ubicación asignada. Contacta al administrador.');
    expect(app).toContain('aria-readonly="true"');
    expect(app).toContain("if (plannerScope) obj.locationId = plannerScope.locationId");
  });

  it('Edge Function lista/lee/escribe location_id y valida la ubicación maestra', () => {
    expect(edge).toContain('location_id,created_at');
    expect(edge).toContain('isActiveMasterLocation');
    expect(edge).toContain('planner_location_required');
    expect(edge).toContain('location_id: locationId');
  });

  it('migración crea LOCATION_SCOPED, falla cerrado y protege RPC/REST por trigger', () => {
    expect(sql).toContain("scope_kind := 'LOCATION_SCOPED'");
    expect(sql).toContain("'PLANNER_LOCATION_REQUIRED'");
    expect(sql).toContain('authorizedLocationIds');
    expect(sql).toContain('enforce_planner_location_write');
    expect(sql).toContain("where store='anomalies' and role='PLANIFICADOR'");
    expect(sql).toContain("raise insufficient_privilege using message='PLANNER_LOCATION_SCOPE_DENIED'");
    expect(sql).not.toContain("profile.role in ('ADMINISTRADOR','PLANIFICADOR')");
  });

  it('migración incremental permite editar equipos propios y conserva sesión sin alcance', () => {
    expect(followupSql).toContain("where role='PLANIFICADOR' and store='equipment'");
    expect(followupSql).toContain("scopeType','NO_LOCATION_ASSIGNED'");
    expect(followupSql).toContain("authorizedLocationIds','[]'::jsonb");
    expect(followupSql).toContain("store in ('equipment','lubrication_plans','lubrication_points')");
    expect(followupSql).not.toMatch(/delete\s+from\s+public\.engrase_sync/i);
  });
});
