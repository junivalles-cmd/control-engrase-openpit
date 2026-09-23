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

serve(async (_req) => {
  try {
    const settings = await getNotifSettings();
    if (!settings.enabled) return new Response("notificaciones desactivadas por el administrador", { status: 200 });

    const [equipos, plans, records, dispositivos] = await Promise.all([
      getStoreRows("equipment"), getStoreRows("lubrication_plans"),
      getStoreRows("lubrication_records"), getDispositivos(),
    ]);

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

    async function avisarPorGrupo(lista: any[], cfg: any, titulo: (n: number, l: string) => string, cuerpo: (n: number, l: string) => string, etiqueta: string) {
      if (!cfg.enabled || !cfg.roles?.length) return;
      if (cfg.soloSiHay && !lista.length) return;

      for (const disp of dispositivos) {
        const rolesDisp: string[] = disp.roles?.length ? disp.roles : (disp.role ? [disp.role] : []);
        if (!rolesDisp.some((r) => cfg.roles.includes(r))) continue;

        // Los lubricadores solo reciben lo de su zona y turno; las jefaturas, todo
        const esLub = rolesDisp.includes("LUBRICADOR") && rolesDisp.length === 1;
        const suyos = esLub
          ? lista.filter((eq) =>
              (!disp.shiftId || eq.shiftId === disp.shiftId) &&
              (!disp.locationId || !eq.locationId || eq.locationId === disp.locationId) &&
              (!disp.cuadrillaId || !eq.cuadrillaId || eq.cuadrillaId === disp.cuadrillaId))
          : lista;

        if (cfg.soloSiHay && !suyos.length) continue;
        const codigos = suyos.slice(0, 5).map((e: any) => e.code).join(", ");
        const extra = suyos.length > 5 ? ` y ${suyos.length - 5} más` : "";
        const n = await sendPush([disp.token], titulo(suyos.length, codigos), cuerpo(suyos.length, codigos + extra));
        if (n) enviados.push(`${etiqueta}->${disp.ultimoUsuario || disp.token.slice(0, 6)}`);
      }
    }

    await avisarPorGrupo(vencidos, settings.vencidos,
      (n) => n ? `🔴 ${n} equipo(s) con engrase VENCIDO` : "Sin engrases vencidos",
      (n, l) => n ? `${l}. Requieren atención inmediata.` : "Ningún equipo tiene el engrase vencido.",
      "vencidos");

    await avisarPorGrupo(porEngrasar, settings.porEngrasar,
      (n) => n ? `🟡 ${n} equipo(s) por engrasar hoy` : "Sin engrases programados",
      (n, l) => n ? `${l}.` : "No hay equipos programados para hoy.",
      "porEngrasar");

    return new Response(
      `ok · ${vencidos.length} vencidos, ${porEngrasar.length} por engrasar · ${enviados.length} envío(s)`,
      { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(`error: ${err}`, { status: 500 });
  }
});
