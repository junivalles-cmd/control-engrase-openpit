// supabase/functions/notify-vencidos/index.ts
//
// Se ejecuta por horario (Supabase -> Database -> Cron Jobs) y manda DOS avisos:
//   1. Equipos con el engrase VENCIDO
//   2. Equipos que toca engrasar HOY
//
// A diferencia de la versión anterior, esta:
//   - lee la configuración que dejó el Administrador en la app (roles, encendido/apagado)
//   - cubre TAMBIÉN los equipos con plan por día/turno (antes solo contaba los de horas)
//   - respeta los equipos con avisos pausados (los que están en taller)
//   - agrupa por zona y turno, para que a cada cuadrilla le lleguen solo sus equipos
//
// Variables de entorno: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY,
//                       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Lote arquitectura de notificaciones (2026-09-30, pedido explícito del
// usuario, §31: "la decisión final de push remoto SIEMPRE es server-side"):
// `avisarPorGrupo()` ya filtraba Lubricador por zona/turno DEL EQUIPO
// (disp.shiftId/locationId/cuadrillaId, que vienen del DISPOSITIVO) —
// ahora TAMBIÉN filtra a CUALQUIER rol por el turno/disponibilidad DE LA
// PERSONA (notificationShift/notificationAvailability/receiveAllShifts,
// guardados en su fila push_tokens — ver saveOneSignalId()/
// saveNotificationPreferences() en app.js), con la MISMA regla que
// isUserEligibleForNotification() de src/core/notification-routing.js
// (reimplementada aquí porque Deno no puede importar el bundle del
// navegador — cualquier cambio de esa regla debe reflejarse en AMBOS
// lados). Deduplicación (§30) por tipo+destinatario+día, para que un
// reintento de cron no duplique el mismo aviso el mismo día.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const OPERATIONAL_TIME_ZONE = "America/Managua";

function operationalDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[value("weekday")];
  return {
    dateISO: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")), weekdayIndex,
  };
}

async function getStoreRows(store: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.${store}&select=payload,deleted`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) throw new Error(`No se pudo leer ${store}: ${res.status}`);
  const rows: { payload: any; deleted: boolean }[] = await res.json();
  return rows.filter((r) => !r.deleted && r.payload?.active !== false).map((r) => r.payload);
}

// Lee la configuración de notificaciones que el Administrador dejó en la app
async function getNotifSettings() {
  const base = {
    enabled: true,
    vencidos: { enabled: true, roles: ["ADMINISTRADOR", "PLANIFICADOR", "SUPERVISOR"], soloSiHay: true },
    porEngrasar: { enabled: true, roles: ["LUBRICADOR", "SUPERVISOR"], soloSiHay: true },
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.settings&id=eq.notifications&select=payload`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!res.ok) return base;
    const rows = await res.json();
    const g = rows[0]?.payload;
    if (!g) return base;
    return {
      enabled: g.enabled !== false,
      vencidos: { ...base.vencidos, ...(g.vencidos || {}) },
      porEngrasar: { ...base.porEngrasar, ...(g.porEngrasar || {}) },
    };
  } catch (_) { return base; }
}

// Turno actual real — MISMA fuente que currentShiftId() (src/core/shifts.js
// en el cliente): shiftDayStart/shiftNightStart de settings/general, nunca
// un horario distinto inventado aquí (§4: "usar esa función como fuente
// central", este es el equivalente Deno porque no se puede importar el
// archivo del navegador).
async function getCurrentNotificationShift(now = new Date()): Promise<"DAY" | "NIGHT"> {
  let shiftDayStart = 6, shiftNightStart = 18;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.settings&id=eq.general&select=payload`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (res.ok) {
      const rows = await res.json();
      const g = rows[0]?.payload;
      if (g) { shiftDayStart = g.shiftDayStart ?? shiftDayStart; shiftNightStart = g.shiftNightStart ?? shiftNightStart; }
    }
  } catch (_) { /* si falla, usa los defaults */ }
  const h = operationalDateParts(now).hour;
  return (h >= shiftDayStart && h < shiftNightStart) ? "DAY" : "NIGHT";
}

// Destinatario elegible (§3, §21, §22, §29) — MISMA regla que
// isUserEligibleForNotification() en src/core/notification-routing.js.
// Aplica a CUALQUIER rol (antes el filtro de turno solo existía, de
// hecho roto, para Lubricador — ver más abajo avisarPorGrupo()).
// Sin anotaciones de tipo A PROPÓSITO (aunque el archivo sea .ts) —
// mismo criterio que manage-users/index.ts: JS válido, para poder
// extraerla y probarla con new Function() sin el runtime de Deno (ver
// tests/unit/notify-edge-functions-eligibility.test.js).
function isRecipientEligible(disp, turnoActual) {
  if (disp.active === false) return false;
  if ((disp.notificationAvailability || "AVAILABLE") === "RESTING") return false;
  if (disp.receiveAllShifts) return true;
  const shift = disp.notificationShift || "BOTH";
  return shift === "BOTH" || shift === turnoActual;
}

// Los dispositivos guardan qué roles, turno y zona tiene quien los usa
async function getDispositivos() {
  const rows = await getStoreRows("push_tokens");
  return rows.filter((t: any) => t.active && t.token);
}

async function sendPush(ids: string[], title: string, body: string) {
  if (!ids.length) return 0;
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${ONESIGNAL_REST_API_KEY}` },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_subscription_ids: ids,
      headings: { en: title },
      contents: { en: body },
    }),
  });
  if (!res.ok) { console.error(`OneSignal respondió ${res.status}: ${await res.text()}`); return 0; }
  return ids.length;
}

function avisosPausados(eq: any) {
  return eq.avisosPausadosHasta && new Date(eq.avisosPausadosHasta).getTime() > Date.now();
}

// DAY y NIGHT son ocurrencias separadas: solo un snapshot con identidad
// exacta de fecha operacional y turno puede resolver esta obligación.
function findRecordForNotificationOccurrence(records, { equipmentId, operationalDate, shiftId, occurrenceKey }) {
  return (records || []).find((record) => {
    if (record.equipmentId !== equipmentId) return false;
    const assigned = record.operationalSnapshot?.assignedOccurrenceKey;
    if (assigned) return assigned === occurrenceKey && record.operationalSnapshot.satisfiedOccurrenceKey === occurrenceKey
      && Number(record.qty) > 0 && (record.details || []).every(point => point.done);
    return record.shiftId === shiftId && (record.operationalSnapshot?.occurrenceKey === occurrenceKey
      || (record.operationalSnapshot?.operationalDate === operationalDate && record.operationalSnapshot?.shiftId === shiftId));
  });
}

function getOutstandingDualOccurrences({ plan, equipment, records, operationalDate }) {
  const required = ["shift_dia", "shift_noche"];
  const configured = Array.isArray(plan?.requiredShifts)
    && required.every((id) => plan.requiredShifts.includes(id))
    && !!plan.effectiveDate && operationalDate >= plan.effectiveDate;
  if (!configured || !plan.id || !equipment?.id) return [];
  return required.flatMap((shiftId) => {
    const occurrenceKey = `${plan.id}:${operationalDate}:${shiftId}`;
    const done = findRecordForNotificationOccurrence(records, {
      equipmentId: equipment.id, operationalDate, shiftId, occurrenceKey,
    });
    return done ? [] : [{ equipment, shiftId, operationalDate, occurrenceKey }];
  });
}

function localDateISO(date) { return operationalDateParts(date).dateISO; }
function notificationEquipment(item) { return item.equipment || item; }
function notificationCode(item) {
  const eq = notificationEquipment(item);
  const shift = item.shiftId === "shift_dia" ? " · TURNO DÍA" : item.shiftId === "shift_noche" ? " · TURNO NOCHE" : "";
  return `${eq.code}${shift}`;
}

// Deduplicación (§30) — clave durable = tipo + destinatario + DÍA de hoy
// (esta función es un cron que corre como mucho una vez por ventana
// relevante al día: si se reintenta/reprograma el mismo día, la MISMA
// clave ya reclamada evita un segundo envío). Reclamo atómico vía INSERT
// con ignore-duplicates + on_conflict(store,id) — mismo mecanismo que el
// CAS de pushAll() en sync.js, aplicado a un store nuevo
// (notification_dispatch_log).
async function claimDedupeKey(dedupeKey: string, meta: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/engrase_sync?on_conflict=store,id`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([{
        store: "notification_dispatch_log", id: dedupeKey,
        payload: { ...meta, sentAt: new Date().toISOString() },
        updated_at: new Date().toISOString(), deleted: false,
      }]),
    });
    if (!res.ok) return true; // si no se puede verificar el dedupe, no se bloquea el envío real
    const rows = await res.json();
    return rows.length > 0; // true = de verdad se reclamó ahora -> SÍ enviar
  } catch (_) { return true; }
}

serve(async (_req) => {
  try {
    const settings = await getNotifSettings();
    if (!settings.enabled) return new Response("notificaciones desactivadas por el administrador", { status: 200 });

    const [equipos, plans, records, dispositivos] = await Promise.all([
      getStoreRows("equipment"), getStoreRows("lubrication_plans"),
      getStoreRows("lubrication_records"), getDispositivos(),
    ]);
    const turnoActual = await getCurrentNotificationShift();
    const hoy = new Date();
    const hoyPartes = operationalDateParts(hoy);
    const hoyISO = hoyPartes.dateISO;
    const nombreHoy = DIAS[hoyPartes.weekdayIndex];
    // Iteración de calendario operacional en UTC para que la zona horaria
    // del runtime Edge no desplace el día de negocio.
    const inicioHoy = new Date(`${hoyISO}T00:00:00.000Z`);

    const vencidos: any[] = [];
    const porEngrasar: any[] = [];

    for (const eq of equipos) {
      if (eq.status !== "Operativo" || avisosPausados(eq)) continue;
      const plan = plans.find((p: any) => p.equipmentId === eq.id);
      if (!plan) continue;

      if (plan.controlType === "Día y turno de la semana") {
        // Antes estos equipos se ignoraban por completo en el aviso del servidor
        const dias: string[] = plan.assignedDays || [];
        if (!dias.length) continue;
        const leTocaHoy = dias.includes(nombreHoy);
        const dualDaily = Array.isArray(plan.requiredShifts)
          && ["shift_dia", "shift_noche"].every((id) => plan.requiredShifts.includes(id))
          && !!plan.effectiveDate && hoyISO >= plan.effectiveDate;
        if (dualDaily) {
          if (leTocaHoy) porEngrasar.push(...getOutstandingDualOccurrences({ plan, equipment: eq, records, operationalDate: hoyISO }));
          // Cada turno vencido del último día programado se reporta por separado.
          for (let atras = 1; atras <= 7; atras++) {
            const d = new Date(inicioHoy); d.setUTCDate(d.getUTCDate() - atras);
            if (!dias.includes(DIAS[d.getUTCDay()])) continue;
            const dateISO = localDateISO(d);
            vencidos.push(...getOutstandingDualOccurrences({ plan, equipment: eq, records, operationalDate: dateISO }));
            break;
          }
          continue;
        }
        const hechoHoy = records.some((r: any) =>
          r.equipmentId === eq.id && (r.operationalSnapshot?.assignedOccurrenceKey
            ? r.operationalSnapshot.assignedOccurrenceKey === `${plan.id}:${hoyISO}` && r.operationalSnapshot.satisfiedOccurrenceKey === `${plan.id}:${hoyISO}` && Number(r.qty)>0 && (r.details || []).every((point:any)=>point.done)
            : new Date(r.date) >= inicioHoy && new Date(r.date) <= hoy));
        if (leTocaHoy && !hechoHoy) { porEngrasar.push(eq); continue; }

        // ¿El día asignado más reciente quedó sin hacer?
        for (let atras = 1; atras <= 7; atras++) {
          const d = new Date(inicioHoy); d.setUTCDate(d.getUTCDate() - atras);
          if (!dias.includes(DIAS[d.getUTCDay()])) continue;
          const finDia = new Date(d); finDia.setUTCHours(23, 59, 59, 999);
          const hecho = records.some((r: any) => r.equipmentId === eq.id && (r.operationalSnapshot?.assignedOccurrenceKey
            ? r.operationalSnapshot.assignedOccurrenceKey === `${plan.id}:${localDateISO(d)}` && r.operationalSnapshot.satisfiedOccurrenceKey === `${plan.id}:${localDateISO(d)}` && Number(r.qty)>0 && (r.details || []).every((point:any)=>point.done)
            : new Date(r.date) >= d));
          if (!hecho) vencidos.push(eq);
          break; // solo interesa el día asignado más reciente
        }
      } else {
        const proximo = (plan.lastGreaseHour || 0) + (plan.frequency || 0);
        if (!plan.frequency || plan.frequency <= 0) continue; // plan mal configurado: se ignora
        const restante = proximo - (eq.hourmeter || 0);
        if (restante < 0) vencidos.push(eq);
        else if (restante <= (plan.alertYellowHours || 10)) porEngrasar.push(eq);
      }
    }

    // A cada dispositivo se le manda SOLO lo que le corresponde por rol, zona y turno
    const enviados: string[] = [];

    async function avisarPorGrupo(lista: any[], cfg: any, etiqueta: string, titulo: (n: number, l: string) => string, cuerpo: (n: number, l: string) => string) {
      if (!cfg.enabled || !cfg.roles?.length) return;
      if (cfg.soloSiHay && !lista.length) return;

      for (const disp of dispositivos) {
        const rolesDisp: string[] = disp.roles?.length ? disp.roles : (disp.role ? [disp.role] : []);
        if (!rolesDisp.some((r) => cfg.roles.includes(r))) continue;
        // Turno/disponibilidad DE LA PERSONA (§21/§22) — aplica a
        // CUALQUIER rol, no solo Lubricador (ver comentario de cabecera).
        if (!isRecipientEligible(disp, turnoActual)) continue;

        // Los lubricadores solo reciben lo de su zona y turno (DEL
        // DISPOSITIVO, no de la persona — concepto distinto, ver §6/§7);
        // las jefaturas, todo lo que su rol/turno/disponibilidad permitan.
        const esLub = rolesDisp.includes("LUBRICADOR") && rolesDisp.length === 1;
        const suyos = esLub
          ? lista.filter((item) => {
              const eq = notificationEquipment(item);
              const itemShift = item.shiftId || eq.shiftId;
              return (!disp.shiftId || itemShift === disp.shiftId) &&
                (!disp.locationId || !eq.locationId || eq.locationId === disp.locationId) &&
                (!disp.cuadrillaId || !eq.cuadrillaId || eq.cuadrillaId === disp.cuadrillaId);
            })
          : lista;

        if (cfg.soloSiHay && !suyos.length) continue;
        // Un grupo de DAY no reclama ni deduplica NIGHT (y viceversa).
        // Para planes legacy se conserva el agrupamiento diario anterior.
        const grupos = new Map();
        for (const item of suyos) {
          const shiftId = item.shiftId || "none";
          const operationalDate = item.operationalDate || hoyISO;
          const key = `${shiftId}|${operationalDate}`;
          if (!grupos.has(key)) grupos.set(key, { shiftId, operationalDate, items: [] });
          grupos.get(key).items.push(item);
        }
        for (const grupo of grupos.values()) {
          const recipient = disp.userId || disp.token;
          const nuevos = [];
          for (const item of grupo.items) {
            const occurrenceIdentity = item.occurrenceKey || "legacy";
            const dedupeKey = `${etiqueta}|${occurrenceIdentity}|${recipient}|${grupo.operationalDate}`;
            const reclamado = await claimDedupeKey(dedupeKey, {
              userId: disp.userId, etiqueta, dia: grupo.operationalDate,
              shiftId: grupo.shiftId === "none" ? null : grupo.shiftId,
              occurrenceKey: item.occurrenceKey || null,
            });
            if (reclamado) nuevos.push(item);
          }
          if (!nuevos.length) continue;

          const codigos = nuevos.slice(0, 5).map(notificationCode).join(", ");
          const extra = nuevos.length > 5 ? ` y ${nuevos.length - 5} más` : "";
          const n = await sendPush([disp.token], titulo(nuevos.length, codigos), cuerpo(nuevos.length, codigos + extra));
          if (n) enviados.push(`${etiqueta}->${disp.ultimoUsuario || disp.token.slice(0, 6)}`);
        }
      }
    }

    await avisarPorGrupo(vencidos, settings.vencidos, "vencidos",
      (n) => n ? `🔴 ${n} equipo(s) con engrase VENCIDO` : "Sin engrases vencidos",
      (n, l) => n ? `${l}. Requieren atención inmediata.` : "Ningún equipo tiene el engrase vencido.");

    await avisarPorGrupo(porEngrasar, settings.porEngrasar, "porEngrasar",
      (n) => n ? `🟡 ${n} equipo(s) por engrasar hoy` : "Sin engrases programados",
      (n, l) => n ? `${l}.` : "No hay equipos programados para hoy.");

    return new Response(
      `ok · ${vencidos.length} vencidos, ${porEngrasar.length} por engrasar · ${enviados.length} envío(s)`,
      { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(`error: ${err}`, { status: 500 });
  }
});
