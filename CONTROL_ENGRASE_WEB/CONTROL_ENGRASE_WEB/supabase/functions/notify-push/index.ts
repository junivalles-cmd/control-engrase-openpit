// supabase/functions/notify-push/index.ts
//
// Se activa mediante un "Database Webhook" de Supabase (Database -> Webhooks ->
// tabla: engrase_sync, evento: Insert, función: notify-push) — igual que antes.
//
// La diferencia con la versión de Firebase: aquí NO hay cuenta de servicio ni
// firma de tokens. Solo una llamada HTTP simple con tu REST API Key de OneSignal.
//
// Variables de entorno que necesitas configurar (Supabase -> Edge Functions -> Secrets):
//   ONESIGNAL_APP_ID       -> el "App ID" de tu app en OneSignal
//   ONESIGNAL_REST_API_KEY -> la "REST API Key" de OneSignal (Settings -> Keys & IDs)
// Estas SÍ son secretas — nunca las pongas en el código de la app, solo aquí.
//
// Y las que Supabase ya te da solas:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Lote arquitectura de notificaciones (2026-09-30, pedido explícito del
// usuario): la decisión de QUIÉN recibe SIEMPRE es server-side (§31) —
// antes `getActivePushIds()` solo filtraba por rol; ahora TAMBIÉN aplica
// notificationShift/notificationAvailability/receiveAllShifts (guardados
// en la fila push_tokens de cada persona, ver saveOneSignalId()/
// saveNotificationPreferences() en app.js), con la MISMA regla que
// src/core/notification-routing.js (isUserEligibleForNotification) — este
// archivo no puede importarlo (Deno no ve el bundle del navegador), así
// que se reimplementa aquí IDÉNTICA, con un comentario que remite allá
// para que nunca diverjan en silencio. §27 (OUT_OF_PLAN no dispara el push
// normal de "engrase realizado") y deduplicación (§30, por id de fila —
// un webhook reintentado nunca manda el mismo aviso dos veces) también se
// agregan en este lote.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";

// Turno actual real — MISMA fuente que currentShiftId() (src/core/shifts.js
// en el cliente): shiftDayStart/shiftNightStart de settings/general, nunca
// un horario distinto inventado aquí. Defaults 6/18 si no hay nada guardado
// (idénticos a App.generalSettings en app.js).
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
// isUserEligibleForNotification() en src/core/notification-routing.js:
// active !== false + rol permitido + disponibilidad AVAILABLE + (turno
// compatible O receiveAllShifts). `disp` es la fila push_tokens de la
// persona (payload de engrase_sync). Sin anotaciones de tipo A PROPÓSITO
// (aunque el archivo sea .ts) — mismo criterio que manage-users/index.ts:
// JS válido, para poder extraerla y probarla con new Function() sin el
// runtime de Deno (ver tests/unit/notify-edge-functions-eligibility.test.js).
function isRecipientEligible(disp, roles, turnoActual) {
  if (!disp || disp.active === false || !disp.token) return false;
  // A diferencia de notification-routing.js (donde el caller SIEMPRE
  // garantiza roles no vacío antes de llamar, ver avisarPorGrupo() en
  // notify-vencidos), aquí esta función ES el único filtro de rol — una
  // lista vacía/ausente NUNCA debe interpretarse como "sin restricción"
  // (eso mandaría el aviso a cualquiera), así que excluye explícitamente.
  if (!roles || !roles.length || !roles.includes(disp.role)) return false;
  if ((disp.notificationAvailability || "AVAILABLE") === "RESTING") return false;
  if (disp.receiveAllShifts) return true;
  const shift = disp.notificationShift || "BOTH";
  return shift === "BOTH" || shift === turnoActual;
}

async function getEligiblePushIds(roles: string[], turnoActual: "DAY" | "NIGHT") {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.push_tokens&select=payload`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) throw new Error(`No se pudieron leer los tokens: ${res.status}`);
  const rows: { payload: any }[] = await res.json();
  return rows
    .map((r) => r.payload)
    .filter((t) => isRecipientEligible(t, roles, turnoActual))
    .map((t) => t.token); // en push_tokens, "token" guarda el subscription id de OneSignal
}

// Deduplicación (§30) — clave durable = tipo + ocurrencia (aquí, el id de
// la fila de engrase_sync que disparó el webhook, un identificador natural
// y estable) + ventana ('immediate', evento sin horario). Reclamo ATÓMICO
// vía INSERT con ignore-duplicates + on_conflict(store,id) — el MISMO
// mecanismo que ya usa pushAll() en sync.js para su CAS, aplicado aquí a
// un store nuevo (notification_dispatch_log). Si el INSERT no crea fila
// nueva (alguien ya la reclamó), NO se envía — evita doble push por
// reintento del webhook.
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
    return rows.length > 0; // true = de verdad se reclamó ahora (nadie antes) -> SÍ enviar
  } catch (_) { return true; }
}

async function sendOneSignalPush(subscriptionIds: string[], title: string, body: string) {
  if (!subscriptionIds.length) return;
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_subscription_ids: subscriptionIds,
      headings: { en: title },
      contents: { en: body },
    }),
  });
  if (!res.ok) console.error(`OneSignal respondió ${res.status}: ${await res.text()}`);
}

// Lee la configuración de notificaciones que dejó el Administrador en la app.
// Si no encuentra nada guardado, usa valores razonables por defecto.
async function getNotifSettings() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.settings&id=eq.notifications&select=payload`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  const base = {
    enabled: true,
    engraseRealizado: { enabled: false, roles: ["SUPERVISOR"], soloCriticos: false },
    anomalias: { enabled: true, roles: ["ADMINISTRADOR", "SUPERVISOR", "PLANIFICADOR"] },
  };
  if (!res.ok) return base;
  const rows = await res.json();
  const guardado = rows[0]?.payload;
  if (!guardado) return base;
  return {
    enabled: guardado.enabled !== false,
    engraseRealizado: { ...base.engraseRealizado, ...(guardado.engraseRealizado || {}) },
    anomalias: { ...base.anomalias, ...(guardado.anomalias || {}) },
  };
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const row = payload?.record;
    if (!row || row.deleted) return new Response("ignorado", { status: 200 });

    const settings = await getNotifSettings();
    if (!settings.enabled) return new Response("notificaciones desactivadas por el administrador", { status: 200 });

    const turnoActual = await getCurrentNotificationShift();

    // ── Anomalía nueva ──────────────────────────────────────────────
    if (row.store === "anomalies") {
      const cfg = settings.anomalias;
      if (!cfg.enabled || !cfg.roles.length) {
        return new Response("aviso de anomalías desactivado", { status: 200 });
      }
      // §28: CRITICAL/HIGH son inmediatas (esto), MEDIUM/LOW quedan para
      // resumen (no se envían por esta vía event-driven) — evita spam de
      // una alerta individual por cada anomalía menor.
      const anomaly = row.payload ?? {};
      const esCritica = anomaly.criticality === "Crítica" || anomaly.criticality === "Alta";
      if (!esCritica) return new Response("anomalía menor: va a resumen, no a push inmediato", { status: 200 });

      const dedupeKey = `anomalias|none|all|${row.id}`;
      const reclamado = await claimDedupeKey(dedupeKey, { rowId: row.id });
      if (!reclamado) return new Response("ya enviado antes (dedupe)", { status: 200 });

      const ids = await getEligiblePushIds(cfg.roles, turnoActual);
      const title = "⚠ Anomalía crítica reportada";
      const body = `${anomaly.component ?? "Componente"} · Reportado por ${anomaly.createdBy ?? "un lubricador"}`;
      await sendOneSignalPush(ids, title, body);
      return new Response(`ok, anomalía enviada a ${ids.length} dispositivo(s)`, { status: 200 });
    }

    // ── Engrase registrado ──────────────────────────────────────────
    if (row.store === "lubrication_records") {
      const cfg = settings.engraseRealizado;
      if (!cfg.enabled || !cfg.roles.length) {
        return new Response("aviso de engrases desactivado", { status: 200 });
      }
      const rec = row.payload ?? {};

      // §27: un engrase FUERA DE PLAN completado nunca dispara el push
      // normal — es trabajo esperado (PM/correctivo/oportunidad), no una
      // sorpresa que amerite avisar. Si esa ejecución generó además una
      // anomalía crítica, esa llega por la rama de "anomalies" arriba, no
      // por esta.
      if (rec.operationalSnapshot?.executionType === "OUT_OF_PLAN") {
        return new Response("fuera de plan: no dispara el push normal de engrase (§27)", { status: 200 });
      }

      const pendientes = (rec.details ?? []).filter((d: any) => !d.done).length;

      // "Solo casos importantes": únicamente si quedaron puntos sin engrasar o el equipo venía vencido
      if (cfg.soloCriticos && !pendientes && !rec._veniaVencido) {
        return new Response("engrase de rutina, no se avisa (modo solo críticos)", { status: 200 });
      }

      const dedupeKey = `engraseRealizado|none|all|${row.id}`;
      const reclamado = await claimDedupeKey(dedupeKey, { rowId: row.id });
      if (!reclamado) return new Response("ya enviado antes (dedupe)", { status: 200 });

      // Busca el código del equipo para que el aviso sea entendible
      let codigo = "Equipo";
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.equipment&id=eq.${rec.equipmentId}&select=payload`,
          { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
        );
        if (r.ok) { const eqRows = await r.json(); codigo = eqRows[0]?.payload?.code ?? codigo; }
      } catch (_) { /* si falla, se queda con "Equipo" */ }

      const ids = await getEligiblePushIds(cfg.roles, turnoActual);
      const title = pendientes ? "⚠ Engrase con puntos pendientes" : "✓ Engrase realizado";
      const body = `${codigo} · ${rec.userName ?? "un lubricador"}${pendientes ? ` · ${pendientes} punto(s) sin engrasar` : ""}`;
      await sendOneSignalPush(ids, title, body);
      return new Response(`ok, engrase enviado a ${ids.length} dispositivo(s)`, { status: 200 });
    }

    return new Response("ignorado (no requiere aviso)", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(`error: ${err}`, { status: 500 });
  }
});
