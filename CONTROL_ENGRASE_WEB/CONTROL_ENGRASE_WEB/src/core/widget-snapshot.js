/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/widget-snapshot.js
   Snapshot MÍNIMO para el widget de pantalla de inicio de Android (pedido
   "WIDGET ANDROID + PALETA CORPORATIVA FINAL + MODO SOL", 2026-10-09).
   Puro, sin DOM/DB/Capacitor directo — mismo patrón que weekly-matrix.js/
   operational-scope.js. app.js (que SÍ calcula Atrasados/Mi Turno/
   Realizados en renderLubricadorHome(), la ÚNICA fuente real — ver §4 del
   pedido "NO duplicar lógica en Android") llama a esta función con lo que
   YA tiene calculado, y el resultado es EXACTAMENTE lo que se envía al
   plugin nativo (WidgetBridgePlugin) para guardar en SharedPreferences.

   NUNCA incluye JWT/contraseña/PIN/refresh token/apikey ni el payload
   completo de un equipo (nombre completo, marca, modelo, ubicación
   interna, etc.) — exclusivamente los 6 campos de abajo. `equipmentCodes`
   se recorta a 3 aquí mismo (nunca se asume que el caller ya lo hizo).
   ============================================================ */

function buildWidgetSnapshot({ locationName, turnoLabel, overdueCount, pendingCount, completedCount, equipmentCodes, now }) {
  return {
    location: locationName || null,
    shift: turnoLabel || null,
    overdue: Number.isFinite(overdueCount) ? overdueCount : 0,
    pending: Number.isFinite(pendingCount) ? pendingCount : 0,
    completed: Number.isFinite(completedCount) ? completedCount : 0,
    equipment: (equipmentCodes || []).filter(Boolean).slice(0, 3),
    updatedAt: (now instanceof Date ? now : new Date()).toISOString(),
  };
}
