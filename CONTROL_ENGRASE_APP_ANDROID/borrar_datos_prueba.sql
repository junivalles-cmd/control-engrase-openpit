-- Borra los equipos de ejemplo (y sus planes/puntos de engrase) que quedaron
-- sincronizados en el servidor desde las primeras pruebas de la app.
-- Son los camiones/tractor de mentira: 45-86, 45-69, 05-68, 12-31.
--
-- Cómo usarlo: Supabase → SQL Editor → pega esto → Run.
-- Es seguro correrlo aunque ya no existan esas filas (simplemente no borra nada).

delete from engrase_sync
where id like 'eq_demo_%'
   or id like 'plan_eq_demo_%'
   or id like 'pt_eq_demo_%';
