-- Rollback de 0004_lubrication_assignments_rls_PREPARED.sql — elimina
-- ÚNICAMENTE las 5 filas de app_store_permissions para
-- store='lubrication_assignments'. No toca ninguna policy (son genéricas,
-- ver 0002) ni ninguna fila de engrase_sync.

delete from app_store_permissions where store = 'lubrication_assignments';
