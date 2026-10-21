// tests/unit/pre-release-quickwins.test.js
//
// Cubre el lote "CIERRE DE HALLAZGOS PRE-RELEASE DE BAJO RIESGO"
// (auditoría 2026-10-21): el P0 de autorización visible (LOGIC-P0-01) y los
// quick wins seguros (S1/S2/NAV-A11Y-02/S13/LUB-10/ONB-01/S12). Todas las
// aserciones leen la fuente REAL de app.js (extractDeclaration), nunca una
// reimplementación a mano — si el código cambia, estas pruebas corren
// contra el código nuevo automáticamente.
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, OPERATIONAL_SCOPE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const operationalScopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);

describe('LOGIC-P0-01 — SUPERVISOR no debe ver/poder navegar a "Usuarios" en modo Supabase', () => {
  function runGetAllowedRoutes(isSupabaseMode) {
    const body = `${extractDeclaration(source, 'PERMISSIONS')}\n\n${extractDeclaration(source, 'getAllowedRoutes')}\n\nreturn getAllowedRoutes;`;
    const factory = new Function('Auth', body);
    const getAllowedRoutes = factory({ isSupabaseMode: () => isSupabaseMode });
    return getAllowedRoutes;
  }

  it('SUPERVISOR + modo Supabase: "usuarios" queda excluido', () => {
    const getAllowedRoutes = runGetAllowedRoutes(true);
    expect(getAllowedRoutes('SUPERVISOR')).not.toContain('usuarios');
  });

  it('SUPERVISOR + modo legacy: "usuarios" se conserva (no romper lo existente)', () => {
    const getAllowedRoutes = runGetAllowedRoutes(false);
    expect(getAllowedRoutes('SUPERVISOR')).toContain('usuarios');
  });

  it('ADMINISTRADOR + modo Supabase: "usuarios" se conserva (el rechazo del backend es solo para no-ADMINISTRADOR)', () => {
    const getAllowedRoutes = runGetAllowedRoutes(true);
    expect(getAllowedRoutes('ADMINISTRADOR')).toContain('usuarios');
  });

  it('SUPERVISOR + modo Supabase: ninguna otra ruta de PERMISSIONS.SUPERVISOR se pierde', () => {
    const getAllowedRoutes = runGetAllowedRoutes(true);
    const PERMISSIONS = new Function(`${extractDeclaration(source, 'PERMISSIONS')}\nreturn PERMISSIONS;`)();
    const sinUsuarios = PERMISSIONS.SUPERVISOR.filter(r => r !== 'usuarios');
    expect(getAllowedRoutes('SUPERVISOR').sort()).toEqual(sinUsuarios.sort());
  });

  it('navigate(): redirige "usuarios" a "dashboard" para SUPERVISOR en modo Supabase, antes del fold a Configuración', () => {
    const fn = extractDeclaration(source, 'navigate');
    const iGuard = fn.indexOf("role === 'SUPERVISOR'");
    const iConfigFold = fn.indexOf("_activeConfigCategory = 'usuarios'");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iConfigFold).toBeGreaterThan(-1);
    expect(iGuard).toBeLessThan(iConfigFold);
    expect(fn.slice(fn.indexOf("role === 'SUPERVISOR'") - 40, iConfigFold)).toContain("route = 'dashboard'");
  });
});

describe('S1 — desactivar un usuario pide confirmación (legacy y Supabase)', () => {
  it('legacy (renderUsuarios): el handler de data-deactivate abre un modal de confirmación antes de desactivar', () => {
    const fn = extractDeclaration(source, 'renderUsuarios');
    const iHandler = fn.indexOf("button[data-deactivate]");
    const iOpenModal = fn.indexOf('openModal', iHandler);
    const iPut = fn.indexOf("DB.put('users'", iHandler);
    expect(iOpenModal).toBeGreaterThan(iHandler);
    expect(iPut).toBeGreaterThan(iOpenModal);
  });

  it('Supabase (renderUsuariosSupabase): desactivar (no activar) pide confirmación antes de SET_ACTIVE', () => {
    const fn = extractDeclaration(source, 'renderUsuariosSupabase');
    const iHandler = fn.indexOf('button[data-toggle]');
    const iGuard = fn.indexOf('if (!activeNow)', iHandler);
    const iOpenModal = fn.indexOf('openModal', iHandler);
    expect(iGuard).toBeGreaterThan(iHandler);
    expect(iOpenModal).toBeGreaterThan(iGuard);
  });
});

describe('S2 — el PIN existente no se muestra en texto plano al editar un usuario', () => {
  it('el input de PIN nunca se precarga con el valor guardado', () => {
    const fn = extractDeclaration(source, 'renderUsuarios');
    expect(fn).not.toMatch(/name="pin"[^>]*value="\$\{u\.pin\}"/);
    expect(fn).toContain('Dejar vacío para conservar el PIN actual');
  });

  it('un PIN vacío al guardar NUNCA sobreescribe el existente', () => {
    const fn = extractDeclaration(source, 'renderUsuarios');
    expect(fn).toContain('if (existing && !fd.pin) delete fd.pin;');
  });
});

describe('NAV-A11Y-02 — el botón de menú (☰) tiene aria-label', () => {
  it('el markup inicial trae aria-label y aria-expanded', () => {
    const fn = extractDeclaration(source, 'boot');
    expect(fn).toMatch(/id="btn-menu-toggle"[^>]*aria-label="Abrir menú"/);
    expect(fn).toMatch(/id="btn-menu-toggle"[^>]*aria-expanded="false"/);
  });

  it('el toggle actualiza aria-expanded/aria-label al abrir y cerrar', () => {
    const fn = extractDeclaration(source, 'boot');
    expect(fn).toContain("toggle.setAttribute('aria-expanded', String(open))");
    expect(fn).toContain("open ? 'Cerrar menú' : 'Abrir menú'");
  });
});

describe('S13 — el control de sincronización automática explica por qué está deshabilitado', () => {
  it('el field-hint menciona el permiso cuando el rol no es ADMINISTRADOR', () => {
    const fn = extractDeclaration(source, 'renderConfig');
    expect(fn).toContain('Solo el Administrador puede cambiar este ajuste.');
  });
});

describe('LUB-10 — el mensaje de Reportes no expone nombres técnicos ni rutas internas', () => {
  it('drawValidacionSeccion ya no menciona GREASE_VALIDATION_ENABLED_FROM ni docs/ en el texto visible', () => {
    const fn = extractDeclaration(source, 'renderReportes');
    const iDraw = fn.indexOf('function drawValidacionSeccion');
    const iInnerHTML = fn.indexOf('area.innerHTML = GREASE_VALIDATION_ENABLED_FROM', iDraw);
    const iEnd = fn.indexOf(';', fn.indexOf("</div>';", iInnerHTML));
    const mensajeVisible = fn.slice(fn.indexOf('?', iInnerHTML), iEnd);
    expect(mensajeVisible).not.toContain('GREASE_VALIDATION_ENABLED_FROM');
    expect(mensajeVisible).not.toContain('docs/');
    expect(mensajeVisible).toContain('fecha configurada para el sistema');
  });
});

describe('ONB-01 — Ayuda/FAQ explica los términos que un Lubricador nuevo ve a diario', () => {
  it('DEFAULT_FAQ incluye Pendiente, Seguimiento, Historial y Sincronizado con advertencia', () => {
    const DEFAULT_FAQ = new Function(`${extractDeclaration(source, 'DEFAULT_FAQ')}\nreturn DEFAULT_FAQ;`)();
    const haystack = DEFAULT_FAQ.map(f => `${f.question} ${f.answer}`).join(' | ');
    expect(haystack).toMatch(/"?Pendiente"?/);
    expect(haystack).toMatch(/"?Seguimiento"?/);
    expect(haystack).toContain('Historial');
    expect(haystack).toContain('Sincronizado con advertencia');
    expect(haystack.toLowerCase()).toContain('sin internet');
  });
});

describe('S12 — una tarea/mensaje creado por OTRO supervisor se marca "Solo lectura"', () => {
  it('taskRowHTML y msgRowHTML calculan soloLectura contra canManageThisManualTask/canManageThisBroadcast', () => {
    const fn = extractDeclaration(source, 'renderTareasYMensajes');
    expect(fn).toContain('canManageAssignments(actor.role) && !canManageThisManualTask(t, actor)');
    expect(fn).toContain('canCreateBroadcast(actor.role) && !canManageThisBroadcast(m, actor)');
    expect(fn).toContain("soloLectura ? 'Solo lectura' : null");
  });

  it('el panel de detalle (desktop) también muestra la nota de solo lectura para tareas y mensajes ajenos', () => {
    const fn = extractDeclaration(source, 'renderTareasYMensajes');
    const iTaskPane = fn.indexOf('function buildTaskDetailPaneHTML');
    const iMsgPane = fn.indexOf('function buildMsgDetailPaneHTML');
    expect(fn.slice(iTaskPane, iMsgPane)).toContain('soloLecturaAjena');
    expect(fn.slice(iMsgPane)).toContain('soloLecturaAjena');
  });
});

describe('S15 — imprimir el QR de todos los equipos pide confirmación con el conteo real', () => {
  it('el handler de #eq-print-all-qr confirma antes de llamar printAllQRCodes', () => {
    const fn = extractDeclaration(source, 'renderEquipos');
    const iHandler = fn.indexOf('eq-print-all-qr');
    const iOpenModal = fn.indexOf('openModal', iHandler);
    const iPrint = fn.indexOf('printAllQRCodes(equipos)', iHandler);
    expect(iOpenModal).toBeGreaterThan(iHandler);
    expect(iPrint).toBeGreaterThan(iOpenModal);
    expect(fn.slice(iHandler, iOpenModal + 60)).toContain('equipos.length');
  });
});

describe('Sin regresión — el alcance propio/ajeno de SUPERVISOR en tareas/mensajes no cambió', () => {
  // S12 (auditoría 2026-10-21) solo agrega un INDICADOR visual ("Solo
  // lectura"); la regla de permiso real debe seguir siendo EXACTAMENTE la
  // misma: un SUPERVISOR administra sus propias tareas/mensajes, nunca los
  // de otro supervisor — comportamiento, no solo texto, para que sobreviva
  // a un futuro refactor.
  function loadManageThisHelpers() {
    const body = [
      extractDeclaration(operationalScopeSource, 'ROLES_CAN_MANAGE_ASSIGNMENTS'),
      extractDeclaration(operationalScopeSource, 'ROLES_CAN_CREATE_BROADCAST'),
      extractDeclaration(operationalScopeSource, 'canManageAssignments'),
      extractDeclaration(operationalScopeSource, 'canCreateBroadcast'),
      extractDeclaration(source, 'canManageThisManualTask'),
      extractDeclaration(source, 'canManageThisBroadcast'),
      'return { canManageThisManualTask, canManageThisBroadcast };',
    ].join('\n\n');
    return new Function(body)();
  }
  const { canManageThisManualTask, canManageThisBroadcast } = loadManageThisHelpers();
  const supervisorA = { id: 'u-a', role: 'SUPERVISOR' };
  const supervisorB = { id: 'u-b', role: 'SUPERVISOR' };
  const admin = { id: 'u-admin', role: 'ADMINISTRADOR' };

  it('canManageThisManualTask: SUPERVISOR gestiona su propia tarea, no la de otro supervisor', () => {
    expect(canManageThisManualTask({ createdBy: supervisorA.id }, supervisorA)).toBe(true);
    expect(canManageThisManualTask({ createdBy: supervisorB.id }, supervisorA)).toBe(false);
  });

  it('canManageThisBroadcast: SUPERVISOR gestiona su propio mensaje, no el de otro supervisor', () => {
    expect(canManageThisBroadcast({ createdBy: supervisorA.id }, supervisorA)).toBe(true);
    expect(canManageThisBroadcast({ createdBy: supervisorB.id }, supervisorA)).toBe(false);
  });

  it('ADMINISTRADOR gestiona cualquier tarea/mensaje (sin el recorte por autoría de SUPERVISOR)', () => {
    expect(canManageThisManualTask({ createdBy: supervisorA.id }, admin)).toBe(true);
    expect(canManageThisBroadcast({ createdBy: supervisorA.id }, admin)).toBe(true);
  });
});
