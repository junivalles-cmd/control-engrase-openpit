-- DO NOT APPLY WITHOUT EXPLICIT AUTHORIZATION
--
-- Cierra el gap P1 señalado en docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §7/§9 y
-- docs/AUTH_RLS_MIGRATION_DESIGN.md (líneas ~220, ~292, ~320) y repetido en
-- la auditoría pre-cutover de docs/SESSION_HANDOFF.md ("push_tokens sin
-- restricción por fila propia"): la matriz de app_store_permissions
-- autoriza por (store, role), nunca por FILA — hoy, cualquier persona con
-- can_insert/can_update=true en 'push_tokens' (CUALQUIER rol salvo VISOR en
-- insert/update) puede escribir la fila de notificaciones de OTRA persona
-- (payload->>'userId' ajeno), lo que equivale a poder silenciar/redirigir
-- sus avisos o falsificar su suscripción push.
--
-- Requiere PRIMERO que 0003_auth_rls_CUTOVER_PREPARED.sql ya esté aplicado
-- (retira la policy legacy) — mientras esa policy siga activa, cualquier
-- policy nueva sobre engrase_sync sigue siendo inerte (Postgres combina
-- policies permisivas por OR, igual que documenta 0002/0003).
--
-- Qué hace este archivo — SOLO reemplaza las policies INSERT/UPDATE de
-- engrase_sync (0002_auth_profiles_rls_PREPARED.sql), agregando una
-- condición adicional que SOLO aplica cuando store='push_tokens':
--
--   - Si la fila tiene payload->>'userId' (fila de PERSONA — la que
--     guarda subscription id/preferencias de notificación, id
--     "tok_<userId>_<plataforma>", ver saveOneSignalId() en app.js L855):
--     userId debe coincidir con el app_user_id de quien hace la request.
--   - Si la fila NO tiene payload->>'userId' (fila de DISPOSITIVO — la
--     que guarda cuadrillaId/locationId/shiftId del equipo compartido, id
--     = getDeviceId(), ver saveDeviceAssignment() en app.js L696 y
--     docs/OPERATIONAL_SCOPE.md): sin cambio — sigue gobernada solo por la
--     matriz de rol, exactamente como hoy. Un dispositivo se usa por
--     distintas personas en distintos turnos POR DISEÑO — restringirlo
--     a "una sola persona propietaria" rompería esa funcionalidad ya
--     desplegada (sesión 2026-09-28, docs/OPERATIONAL_SCOPE.md), que no
--     es parte de este gap y no se toca aquí.
--   - Cualquier otro store (no push_tokens): sin cambio, mismo
--     comportamiento exacto que 0002 — la condición nueva es un no-op.
--
-- Qué NO hace este archivo (a propósito, fuera de alcance):
--   - No toca SELECT — leer el listado de dispositivos de otra persona ya
--     es necesario hoy (panel de Dispositivos de Configuración, solo
--     ADMINISTRADOR/PLANIFICADOR/SUPERVISOR/LUBRICADOR según la matriz
--     existente) y no es el gap señalado (el gap es poder ESCRIBIR la
--     fila de otra persona, no verla).
--   - No crea columnas nuevas, no cambia app_store_permissions, no toca
--     ninguna otra tabla.
--
-- Rollback preparado en 0007_push_tokens_ownership_rls_ROLLBACK.sql
-- (mismo directorio) — restaura las 2 policies a su forma exacta de 0002.

drop policy if exists "engrase_sync: crear según matriz" on engrase_sync;
create policy "engrase_sync: crear según matriz"
  on engrase_sync for insert
  with check (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and p.can_insert
    )
    and (
      engrase_sync.store <> 'push_tokens'
      or engrase_sync.payload->>'userId' is null
      or engrase_sync.payload->>'userId' = (
        select app_user_id from app_profiles where auth_user_id = auth.uid()
      )
    )
  );

drop policy if exists "engrase_sync: actualizar según matriz" on engrase_sync;
create policy "engrase_sync: actualizar según matriz"
  on engrase_sync for update
  using (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and (p.can_update or p.can_delete)
    )
    and (
      engrase_sync.store <> 'push_tokens'
      or engrase_sync.payload->>'userId' is null
      or engrase_sync.payload->>'userId' = (
        select app_user_id from app_profiles where auth_user_id = auth.uid()
      )
    )
  )
  with check (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and (
          (engrase_sync.deleted and p.can_delete)
          or (not engrase_sync.deleted and p.can_update)
        )
    )
    and (
      engrase_sync.store <> 'push_tokens'
      or engrase_sync.payload->>'userId' is null
      or engrase_sync.payload->>'userId' = (
        select app_user_id from app_profiles where auth_user_id = auth.uid()
      )
    )
  );

-- FIN — 2 policies reemplazadas. Todo lo de arriba es documentación.
