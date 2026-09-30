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
async function getCurrentNotificationShift(): Promise<"DAY" | "NIGHT"> {
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
  const h = new Date().getHours();
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
    const hoyISO = new Date().toISOString().slice(0, 10);

    const hoy = new Date();
    const nombreHoy = DIAS[hoy.getDay()];
    const inicioHoy = new Date(hoy); inicioHoy.setHours(0, 0, 0, 0);

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
        const hechoHoy = records.some((r: any) =>
          r.equipmentId === eq.id && new Date(r.date) >= inicioHoy && new Date(r.date) <= hoy);
        if (leTocaHoy && !hechoHoy) { porEngrasar.push(eq); continue; }

        // ¿El día asignado más reciente quedó sin hacer?
        for (let atras = 1; atras <= 7; atras++) {
          const d = new Date(inicioHoy); d.setDate(d.getDate() - atras);
          if (!dias.includes(DIAS[d.getDay()])) continue;
          const finDia = new Date(d); finDia.setHours(23, 59, 59, 999);
          const hecho = records.some((r: any) => r.equipmentId === eq.id && new Date(r.date) >= d);
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
          ? lista.filter((eq) =>
              (!disp.shiftId || eq.shiftId === disp.shiftId) &&
              (!disp.locationId || !eq.locationId || eq.locationId === disp.locationId) &&
              (!disp.cuadrillaId || !eq.cuadrillaId || eq.cuadrillaId === disp.cuadrillaId))
          : lista;

        if (cfg.soloSiHay && !suyos.length) continue;

        // Dedupe (§30): tipo + destinatario (userId, o el propio token si
        // no hay userId) + día — un reintento del cron el MISMO día no
        // reenvía.
        const dedupeKey = `${etiqueta}|none|${disp.userId || disp.token}|${hoyISO}`;
        const reclamado = await claimDedupeKey(dedupeKey, { userId: disp.userId, etiqueta, dia: hoyISO });
        if (!reclamado) continue;

        const codigos = suyos.slice(0, 5).map((e: any) => e.code).join(", ");
        const extra = suyos.length > 5 ? ` y ${suyos.length - 5} más` : "";
        const n = await sendPush([disp.token], titulo(suyos.length, codigos), cuerpo(suyos.length, codigos + extra));
        if (n) enviados.push(`${etiqueta}->${disp.ultimoUsuario || disp.token.slice(0, 6)}`);
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
