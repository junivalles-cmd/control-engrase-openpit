// tests/unit/tareas-mensajes-module.test.js
//
// "TAREAS Y MENSAJES" — módulo unificado (2026-10-18). Cubre, con el
// código REAL de app.js (nunca reimplementado):
//   A) PERMISSIONS — 'tareas-mensajes' visible para ADMIN/PLANIFICADOR/
//      SUPERVISOR (LUBRICADOR no usa PERMISSIONS, tiene su shell fijo —
//      ver app.js bootLubricador()), NUNCA VISOR.
//   B) computeTasksMensajesBadgeCount() — fuente ÚNICA del badge (§9 del
//      pedido): tareas pendientes (todos los roles) + mensajes no leídos
//      (SOLO LUBRICADOR — quien envía nunca tiene "no leído" que contar).
import { describe, it, expect } from 'vitest';
import { loadAppLogic } from '../helpers/loadLubricationLogic.js';

describe('A) PERMISSIONS — acceso a "tareas-mensajes" (§1 del pedido)', () => {
  const { PERMISSIONS } = loadAppLogic({});

  it('1. ADMINISTRADOR ve tareas-mensajes', () => {
    expect(PERMISSIONS.ADMINISTRADOR).toContain('tareas-mensajes');
  });
  it('2. PLANIFICADOR ve tareas-mensajes', () => {
    expect(PERMISSIONS.PLANIFICADOR).toContain('tareas-mensajes');
  });
  it('3. SUPERVISOR ve tareas-mensajes', () => {
    expect(PERMISSIONS.SUPERVISOR).toContain('tareas-mensajes');
  });
  it('4. VISOR NUNCA ve tareas-mensajes (cero acceso a manual_tasks/broadcast_messages por RLS)', () => {
    expect(PERMISSIONS.VISOR).not.toContain('tareas-mensajes');
  });
  it('5. LUBRICADOR no usa PERMISSIONS (shell fijo) — su entrada propia se prueba en app.js/bootLubricador(), no aquí', () => {
    expect(PERMISSIONS.LUBRICADOR).not.toContain('tareas-mensajes');
  });
});

function makeFakeDB(data) {
  return { async allActive(store) { return data[store] || []; } };
}

function task(overrides = {}) {
  return { id: 'mt1', equipmentId: 'e1', crewId: 'cq1', status: 'PENDING', description: 'x', priority: 'ALTA', createdBy: 'u-admin', createdAt: '2026-10-18T08:00:00.000Z', ...overrides };
}
function broadcast(overrides = {}) {
  return { id: 'b1', title: 'Aviso', message: 'x', priority: 'INFORMATIVA', targetType: 'ALL_LUBRICATORS', createdBy: 'u-admin', createdAt: '2026-10-18T08:00:00.000Z', validFrom: null, validUntil: null, ...overrides };
}

describe('B) computeTasksMensajesBadgeCount() — fuente única del badge (§9 del pedido)', () => {
  it('campana: mismo subtotal unread, sin leer tareas ni contar retirados/inactivos/futuros', async () => {
    const stores = [];
    const db = makeFakeDB({
      manual_tasks: [task()],
      broadcast_messages: [broadcast(), broadcast({ id:'b2' }), broadcast({ id:'b3' }),
        broadcast({ id:'deleted', active:false }), broadcast({ id:'retired', retiredAt:'2026-01-01' }),
        broadcast({ id:'future', validFrom:'2999-01-01' })],
    });
    const allActive = db.allActive;
    db.allActive = store => { stores.push(store); return allActive(store); };
    const { computeTasksMensajesBadgeCount } = loadAppLogic({currentUser:{id:'lub',role:'LUBRICADOR'}}, db);
    let unread;
    expect(await computeTasksMensajesBadgeCount({messagesOnly:true,onUnreadCount:value=>{unread=value;}})).toBe(3);
    expect(unread).toBe(3);
    expect(stores).toEqual(['broadcast_messages','broadcast_message_reads']);
  });
  it('6. LUBRICADOR: 1 tarea pendiente + 1 mensaje no leído = 2', async () => {
    const fakeApp = { currentUser: { role: 'LUBRICADOR', id: 'u-lub1', name: 'Lub' } };
    const fakeDB = makeFakeDB({ manual_tasks: [task()], broadcast_messages: [broadcast()], broadcast_message_reads: [] });
    const { computeTasksMensajesBadgeCount } = loadAppLogic(fakeApp, fakeDB);
    expect(await computeTasksMensajesBadgeCount()).toBe(2);
  });

  it('7. LUBRICADOR: mensaje ya leído no cuenta', async () => {
    const fakeApp = { currentUser: { role: 'LUBRICADOR', id: 'u-lub1', name: 'Lub' } };
    const fakeDB = makeFakeDB({
      manual_tasks: [task()], broadcast_messages: [broadcast()],
      broadcast_message_reads: [{ id: 'b1:u-lub1', messageId: 'b1', userId: 'u-lub1', readAt: 't' }],
    });
    const { computeTasksMensajesBadgeCount } = loadAppLogic(fakeApp, fakeDB);
    expect(await computeTasksMensajesBadgeCount()).toBe(1);
  });

  it('8. LUBRICADOR: tarea COMPLETED no cuenta (solo PENDING)', async () => {
    const fakeApp = { currentUser: { role: 'LUBRICADOR', id: 'u-lub1', name: 'Lub' } };
    const fakeDB = makeFakeDB({ manual_tasks: [task({ status: 'COMPLETED' })], broadcast_messages: [], broadcast_message_reads: [] });
    const { computeTasksMensajesBadgeCount } = loadAppLogic(fakeApp, fakeDB);
    expect(await computeTasksMensajesBadgeCount()).toBe(0);
  });

  it('9. LUBRICADOR: mensaje VENCIDO no cuenta como no leído', async () => {
    const fakeApp = { currentUser: { role: 'LUBRICADOR', id: 'u-lub1', name: 'Lub' } };
    const fakeDB = makeFakeDB({ manual_tasks: [], broadcast_messages: [broadcast({ validUntil: '2020-01-01T00:00:00.000Z' })], broadcast_message_reads: [] });
    const { computeTasksMensajesBadgeCount } = loadAppLogic(fakeApp, fakeDB);
    expect(await computeTasksMensajesBadgeCount()).toBe(0);
  });

  it('10. ADMINISTRADOR/PLANIFICADOR/SUPERVISOR: SOLO tareas pendientes, nunca mensajes (quien envía no tiene "no leído")', async () => {
    const fakeDB = makeFakeDB({ manual_tasks: [task(), task({ id: 'mt2' })], broadcast_messages: [broadcast(), broadcast({ id: 'b2' })], broadcast_message_reads: [] });
    for (const role of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR']) {
      const { computeTasksMensajesBadgeCount } = loadAppLogic({ currentUser: { role, id: 'u1', name: 'X' } }, fakeDB);
      expect(await computeTasksMensajesBadgeCount()).toBe(2); // 2 tareas, 0 por mensajes
    }
  });

  it('11. recalcular 3 veces con los mismos datos nunca infla el número (puro, sin estado acumulado)', async () => {
    const fakeApp = { currentUser: { role: 'LUBRICADOR', id: 'u-lub1', name: 'Lub' } };
    const fakeDB = makeFakeDB({ manual_tasks: [task()], broadcast_messages: [broadcast()], broadcast_message_reads: [] });
    const { computeTasksMensajesBadgeCount } = loadAppLogic(fakeApp, fakeDB);
    const results = await Promise.all([1, 2, 3].map(() => computeTasksMensajesBadgeCount()));
    expect(results).toEqual([2, 2, 2]);
  });
});
