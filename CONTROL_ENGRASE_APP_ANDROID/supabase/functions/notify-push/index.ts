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

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";

async function getActivePushIds(roles: string[]) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.push_tokens&select=payload`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) throw new Error(`No se pudieron leer los tokens: ${res.status}`);
  const rows: { payload: any }[] = await res.json();
  return rows
    .map((r) => r.payload)
    .filter((t) => t && t.active && t.token && roles.includes(t.role))
    .map((t) => t.token); // en push_tokens, "token" guarda el subscription id de OneSignal
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

    // ── Anomalía nueva ──────────────────────────────────────────────
    if (row.store === "anomalies") {
      const cfg = settings.anomalias;
      if (!cfg.enabled || !cfg.roles.length) {
        return new Response("aviso de anomalías desactivado", { status: 200 });
      }
      const anomaly = row.payload ?? {};
      const ids = await getActivePushIds(cfg.roles);
      const esCritica = anomaly.criticality === "Crítica" || anomaly.criticality === "Alta";
      const title = esCritica ? "⚠ Anomalía crítica reportada" : "Nueva anomalía reportada";
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
      const pendientes = (rec.details ?? []).filter((d: any) => !d.done).length;

      // "Solo casos importantes": únicamente si quedaron puntos sin engrasar o el equipo venía vencido
      if (cfg.soloCriticos && !pendientes && !rec._veniaVencido) {
        return new Response("engrase de rutina, no se avisa (modo solo críticos)", { status: 200 });
      }

      // Busca el código del equipo para que el aviso sea entendible
      let codigo = "Equipo";
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/engrase_sync?store=eq.equipment&id=eq.${rec.equipmentId}&select=payload`,
          { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
        );
        if (r.ok) { const eqRows = await r.json(); codigo = eqRows[0]?.payload?.code ?? codigo; }
      } catch (_) { /* si falla, se queda con "Equipo" */ }

      const ids = await getActivePushIds(cfg.roles);
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
