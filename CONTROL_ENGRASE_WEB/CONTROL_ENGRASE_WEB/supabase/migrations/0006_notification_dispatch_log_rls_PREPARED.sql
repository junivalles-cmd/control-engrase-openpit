-- PREPARADA — NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA
--
-- Lote arquitectura de notificaciones (§30, deduplicación real: una misma
-- notificación no puede enviarse 2 veces por cron retry/reconnect/
-- foreground/duplicación local+remota, ver supabase/functions/
-- notify-vencidos e notify-push). Agrega el store nuevo
-- `notification_dispatch_log` a la matriz de permisos que YA gobierna
-- `engrase_sync` (0002_auth_profiles_rls_PREPARED.sql) — las policies de
-- SELECT/INSERT/UPDATE sobre engrase_sync son genéricas por `store`, así
-- que NO hace falta ninguna policy nueva.
--
-- Qué hace este archivo — UNA sola cosa:
--   INSERT en app_store_permissions para store='notification_dispatch_log',
--   un rol por fila (mismo patrón que 0004/0005).
--
-- Criterio de la matriz para este store: es un log ESCRITO ÚNICAMENTE por
-- las Edge Functions (vía SERVICE_ROLE_KEY, que de por sí ignora RLS por
-- completo — esta matriz nunca lo bloquearía ni lo habilitaría). NINGÚN
-- rol de cliente puede insert/update/delete aquí — reclamar una clave de
-- deduplicación es responsabilidad exclusiva del servidor. Solo
-- ADMINISTRADOR puede LEER (para una futura pantalla de auditoría de
-- envíos), igual que audit_log hoy.
--
-- Rollback en 0006_notification_dispatch_log_rls_ROLLBACK.sql (mismo directorio).

insert into app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  ('notification_dispatch_log', 'ADMINISTRADOR', true,  false, false, false),
  ('notification_dispatch_log', 'PLANIFICADOR',  false, false, false, false),
  ('notification_dispatch_log', 'SUPERVISOR',    false, false, false, false),
  ('notification_dispatch_log', 'LUBRICADOR',    false, false, false, false),
  ('notification_dispatch_log', 'VISOR',         false, false, false, false)
on conflict (store, role) do update set
  can_read = excluded.can_read, can_insert = excluded.can_insert,
  can_update = excluded.can_update, can_delete = excluded.can_delete;

-- FIN — un solo INSERT real. Todo lo de arriba es documentación.
