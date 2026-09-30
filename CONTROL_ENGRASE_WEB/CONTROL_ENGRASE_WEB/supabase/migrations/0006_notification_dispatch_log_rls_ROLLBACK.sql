-- Rollback de 0006_notification_dispatch_log_rls_PREPARED.sql — elimina
-- ÚNICAMENTE las 5 filas de app_store_permissions para
-- store='notification_dispatch_log'. No toca ninguna policy (son
-- genéricas, ver 0002) ni ninguna fila de engrase_sync.

delete from app_store_permissions where store = 'notification_dispatch_log';
