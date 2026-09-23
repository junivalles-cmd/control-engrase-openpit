-- ═══════════════════════════════════════════════════════════════════
-- LIMPIAR DATOS DE PRUEBA DEL SERVIDOR
-- ═══════════════════════════════════════════════════════════════════
--
-- Úsalo si en tu sistema quedaron lubricantes, ubicaciones o cuadrillas
-- de ejemplo que al borrarlos desde la app volvían a aparecer.
--
-- CÓMO USARLO:
--   1. Entra a supabase.com → tu proyecto → SQL Editor
--   2. Pega el bloque que necesites y presiona RUN
--   3. En la app, toca el indicador de conexión para sincronizar
--
-- ⚠ ANTES DE EMPEZAR: descarga un respaldo desde la app
--   (Configuración → Respaldo completo de datos). Esto no se puede deshacer.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1. VER QUÉ HAY (no borra nada, solo muestra) ──────────────────
-- Corre esto primero para saber qué tienes antes de borrar.

SELECT store,
       payload->>'name'  AS nombre,
       payload->>'code'  AS codigo,
       deleted           AS esta_borrado,
       updated_at
FROM engrase_sync
WHERE store IN ('lubricants', 'locations', 'equipment_types', 'cuadrillas', 'shifts')
ORDER BY store, nombre;


-- ── 2. BORRAR LOS LUBRICANTES DE EJEMPLO ──────────────────────────
-- Son los tres que la app creaba sola: Grasa EP2, Grasa Moly y
-- Grasa Alta Temperatura. Si ya cargaste los lubricantes reales de la
-- mina, estos sobran.

DELETE FROM engrase_sync
WHERE store = 'lubricants'
  AND id IN ('lub_ep2', 'lub_moly', 'lub_ht');


-- ── 3. BORRAR LAS UBICACIONES DE EJEMPLO ──────────────────────────
-- "Rajo Principal", "Botadero Norte", "Taller Mecánico".
-- ⚠ NO las borres si tus equipos están asignados a ellas: primero
--    cambia los equipos a las ubicaciones reales (Mojón, Volcán, etc.)

DELETE FROM engrase_sync
WHERE store = 'locations'
  AND id IN ('loc_pit1', 'loc_botadero', 'loc_taller');


-- ── 4. BORRAR LAS CUADRILLAS DE EJEMPLO ───────────────────────────
-- "Cuadrilla A" a "Cuadrilla D". Igual que arriba: revisa antes que
-- ningún lubricador ni equipo las tenga asignadas.

DELETE FROM engrase_sync
WHERE store = 'cuadrillas'
  AND id IN ('cuad_a', 'cuad_b', 'cuad_c', 'cuad_d');


-- ── 5. BORRAR LOS USUARIOS DE DEMOSTRACIÓN ────────────────────────
-- Los de PIN 1111 / 2222 / 3333 / 4444.
-- ⚠ NO corras esto hasta haber creado tu propio usuario administrador
--    con otro PIN, o te quedas sin poder entrar al sistema.

DELETE FROM engrase_sync
WHERE store = 'users'
  AND payload->>'pin' IN ('1111', '2222', '3333', '4444');


-- ── 6. LIMPIEZA PROFUNDA: quitar todo lo marcado como borrado ─────
-- La app no borra de verdad, solo oculta. Esto elimina definitivamente
-- todo lo que ya estaba oculto, para recuperar espacio.
-- Después de correr esto, la papelera de la app queda vacía.

DELETE FROM engrase_sync WHERE deleted = true;


-- ── 7. COMPROBAR CÓMO QUEDÓ ───────────────────────────────────────

SELECT store, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE deleted) AS ocultos
FROM engrase_sync
GROUP BY store
ORDER BY store;
