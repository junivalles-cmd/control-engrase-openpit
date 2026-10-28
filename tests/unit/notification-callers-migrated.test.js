// tests/unit/notification-callers-migrated.test.js
//
// Lote "cerrar integración real de notificaciones" — inventario de
// callers existentes y verificación de que cada uno de verdad pasa por el
// routing central (isUserEligibleForNotification/routeAnomalyEvent/
// shouldNotifyOutOfPlanCompletion, src/core/notification-routing.js) en
// vez de repetir su propia lógica de "rol → destinatario". Prueba a nivel
// de FUENTE (mismo criterio que grease-finalize-validate-flow.test.js):
// estas funciones tienen demasiadas dependencias de DOM/IndexedDB/
// Capacitor como para ejecutarlas completas aquí — se confirma que el
// texto real las llama, no una reimplementación paralela.
//
// INVENTARIO (ver también docs/OPERATIONAL_SCOPE.md):
//   refreshLocalNotifications()  -> vencidos/porEngrasar/cumplimiento/
//     resumenSemanal/asignaciones (LOCAL, recalculado en cada sync/boot)
//     -> MIGRADO (este archivo).
//   notifyNewAnomalies()         -> anomalía nueva (LOCAL, al sincronizar)
//     -> MIGRADO (este archivo).
//   notificarEngraseRealizado()  -> engrase registrado (toast LOCAL del
//     mismo dispositivo; el push a otros dispositivos lo hace notify-push)
//     -> MIGRADO (este archivo).
//   notify-push (Edge Function)  -> anomalies/lubrication_records/
//     lubrication_skips (REMOTO, vía OneSignal) -> MIGRADO (commit
//     anterior + la rama nueva de lubrication_skips en este lote).
//   notify-vencidos (Edge Function) -> vencidos/porEngrasar (REMOTO)
//     -> MIGRADO (commit anterior).
//   Assignments (createAssignment/reassignAssignment/cancelAssignment/
//     completeAssignmentIfPending, operational-scope.js) -> NO envían
//     notificación ellos mismos (son puros) — el aviso real lo dispara
//     refreshLocalNotifications() al recalcular desde
//     lubrication_assignments (ver bloque 5 de esa función, ya migrado
//     arriba) — DEAD CODE relativo a notificaciones: nada que migrar ahí.
//   NOTIF_ID_DAILY_TASKS / NOTIF_ID_WEEKDAY_PLAN -> declarados, incluidos
//     en el cancel-list, pero NUNCA usados para programar nada -> DEAD
//     CODE (documentado, no se inventó uso nuevo para ellos en este lote).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY_PUSH_TS_PATH = path.resolve(__dirname, '../../CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-push/index.ts');

const appSource = readSource(APP_JS_PATH);
const refreshSrc = extractDeclaration(appSource, 'refreshLocalNotifications');
const notifyAnomSrc = extractDeclaration(appSource, 'notifyNewAnomalies');
const notifEngraseSrc = extractDeclaration(appSource, 'notificarEngraseRealizado');
const logoutSrc = extractDeclaration(appSource, 'logout');
const notifyPushSource = readSource(NOTIFY_PUSH_TS_PATH);

// lockApp()/Quick Unlock se retiraron por completo en UX CAMPO V2
// (2026-10-24) — ya no existe ningún "bloquear sin cerrar sesión" que
// conserve notificaciones/identidad OneSignal aparte, así que esa
// distinción se retira junto con la función.
describe('logout() — §9: limpieza de notificaciones personales al cerrar sesión', () => {
  it('logout() cancela las notificaciones locales Y retira la identidad OneSignal (en modo supabase)', () => {
    expect(logoutSrc).toContain('cancelAllLocalNotifications();');
    expect(logoutSrc).toContain('clearOneSignalIdentity();');
  });

  it('"Cambiar usuario" (confirmChangeUser) delega en logout() para la salida — no duplica la lógica de limpieza', () => {
    const confirmChangeUserSrc = extractDeclaration(appSource, 'confirmChangeUser');
    expect(confirmChangeUserSrc).toContain('logout()');
  });

  it('enterAppAsProfile() (login exitoso) asocia la identidad OneSignal ANTES de boot()', () => {
    const enterAppSrc = extractDeclaration(appSource, 'enterAppAsProfile');
    const iBind = enterAppSrc.indexOf('bindOneSignalIdentity(');
    const iBoot = enterAppSrc.indexOf('boot();');
    expect(iBind).toBeGreaterThan(-1);
    expect(iBoot).toBeGreaterThan(iBind);
  });
});

describe('refreshLocalNotifications() — MIGRADO al routing central (vencidos/porEngrasar/cumplimiento/resumenSemanal/asignaciones)', () => {
  it('calcula el contexto de elegibilidad UNA vez (currentUserEligibilityContext) y lo reutiliza, nunca uno distinto por tipo', () => {
    expect(refreshSrc).toContain('const personaElegible = await currentUserEligibilityContext();');
    expect(refreshSrc.match(/currentUserEligibilityContext\(\)/g) || []).toHaveLength(1);
  });

  it('cada tipo programado pasa por elegiblePara()/isUserEligibleForNotification(), ya NO decide solo por "cfg.roles.includes(rol)"', () => {
    expect(refreshSrc).not.toMatch(/cfgV\.roles\.includes\(rol\)/);
    expect(refreshSrc).not.toMatch(/cfgP\.roles\.includes\(rol\)/);
    expect(refreshSrc).not.toMatch(/cfgC\.roles\.includes\(rol\)/);
    expect(refreshSrc).not.toMatch(/cfgS\.roles\.includes\(rol\)/);
    expect(refreshSrc).toContain('elegiblePara(cfgV)');
    expect(refreshSrc).toContain('elegiblePara(cfgP)');
    expect(refreshSrc).toContain('elegiblePara(cfgC)');
    expect(refreshSrc).toContain('elegiblePara(cfgS)');
  });

  it('las asignaciones (bloque Lubricador) también pasan por isUserEligibleForNotification() — RESTING apaga incluso una asignación real pendiente', () => {
    expect(refreshSrc).toMatch(/rol === 'LUBRICADOR' && isUserEligibleForNotification\(/);
  });

  it('elegiblePara() usa el turno REAL (currentShiftId()), nunca un valor hardcodeado', () => {
    expect(refreshSrc).toContain('const turnoReal = currentShiftId();');
    expect(refreshSrc).toContain('currentShiftId: turnoReal');
  });
});

describe('notifyNewAnomalies() — MIGRADO (§7/§28: severidad + elegibilidad, ya no solo rol)', () => {
  it('usa routeAnomalyEvent() para decidir si la anomalía merece un aviso individual (Crítica/Alta) o va a resumen (Media/Baja)', () => {
    expect(notifyAnomSrc).toContain("routeAnomalyEvent(a.criticality) === 'SUMMARY'");
  });

  it('usa isUserEligibleForNotification() en vez de solo comprobar relevantRoles.includes(rol)', () => {
    expect(notifyAnomSrc).toContain('isUserEligibleForNotification(');
    expect(notifyAnomSrc).not.toMatch(/if \(!isRelevantRole\) continue;\s*\/\/ por ahora solo/);
  });

  it('no envía nada a quien reportó la anomalía (regla previa, no se quitó al migrar)', () => {
    expect(notifyAnomSrc).toContain('a.createdBy === App.currentUser.name');
  });
});

describe('notificarEngraseRealizado() — MIGRADO (§6/§27: OUT_OF_PLAN nunca dispara el aviso normal)', () => {
  it('usa shouldNotifyOutOfPlanCompletion() (siempre false) para cortar antes que cualquier otra validación', () => {
    const iOutOfPlan = notifEngraseSrc.indexOf('shouldNotifyOutOfPlanCompletion()');
    const iSoloCriticos = notifEngraseSrc.indexOf('cfg.soloCriticos');
    expect(iOutOfPlan).toBeGreaterThan(-1);
    expect(iSoloCriticos).toBeGreaterThan(-1);
    expect(iOutOfPlan).toBeLessThan(iSoloCriticos); // el corte de OUT_OF_PLAN es ANTES del filtro soloCriticos
  });
});

describe('notify-push (Edge Function) — rama nueva lubrication_skips (§5/§26: UNSAFE inmediato, YA_ENGRASADO conciliación)', () => {
  it('existe la rama, gateada por settings.noEjecucion.enabled', () => {
    expect(notifyPushSource).toContain('row.store === "lubrication_skips"');
    expect(notifyPushSource).toContain('settings.noEjecucion');
  });

  it('CONDICION_INSEGURA y YA_ENGRASADO son los ÚNICOS motivos con aviso inmediato — el resto corta sin enviar (evita spam de REPARACION/SIN_TIEMPO/NO_DISPONIBLE/OTRO)', () => {
    expect(notifyPushSource).toContain('skip.reason === "CONDICION_INSEGURA"');
    expect(notifyPushSource).toContain('skip.reason === "YA_ENGRASADO"');
    expect(notifyPushSource).toContain('motivo sin aviso inmediato (carryover ya lo muestra)');
  });

  it('usa claimDedupeKey() antes de enviar — un reintento del webhook no duplica el aviso', () => {
    const iRama = notifyPushSource.indexOf('row.store === "lubrication_skips"');
    const rama = notifyPushSource.slice(iRama);
    const iClaim = rama.indexOf('claimDedupeKey(');
    const iSend = rama.indexOf('sendOneSignalPush(');
    expect(iClaim).toBeGreaterThan(-1);
    expect(iSend).toBeGreaterThan(iClaim);
  });

  it('UNSAFE y RECONCILIACION usan listas de roles DISTINTAS (rolesUnsafe vs rolesReconciliacion) — nunca la misma ruta', () => {
    expect(notifyPushSource).toContain('cfg.rolesUnsafe');
    expect(notifyPushSource).toContain('cfg.rolesReconciliacion');
  });
});
