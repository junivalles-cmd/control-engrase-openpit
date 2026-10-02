# Checklist de dispositivos reales de campo — antes de autorizar 0003

Preparado 2026-10-02, sin dispositivos reales todavía. Nada de este
documento se ejecuta hasta que lleguen los teléfonos/tablets reales de
campo — es la plantilla que el usuario completa, no una prueba ya hecha.

## 0. Dotación real (completar cuando se tenga la nómina)

| ROL | NOMBRE | USUARIO (app_profiles) | TURNO | DISPOSITIVO | CUADRILLA | UBICACIÓN |
|---|---|---|---|---|---|---|
| ADMINISTRADOR | Junior Valles | (ya existe, activo) | — | — | — | — |
| SUPERVISOR | | | | | | |
| LUBRICADOR | | | | | | |
| LUBRICADOR | | | | | | |
| PLANIFICADOR | | | | | | |
| VISOR | | | | | | |

Agregar una fila por persona real (no por rol) — hoy solo hay 1 cuenta Auth
real activa por cada uno de ADMINISTRADOR/SUPERVISOR/LUBRICADOR, y 0 en
PLANIFICADOR/VISOR (verificado en producción, `app_profiles`, 2026-10-02).
No asumir cuántas personas/dispositivos reales hacen falta — esta tabla la
completa el usuario con la dotación real del pit.

## 1. Por dispositivo (una tabla por cada teléfono/tablet real)

**Dispositivo:** ______________________ (modelo, serial `adb devices`)
**Cuadrilla:** ______________________
**Ubicación:** ______________________
**Usuario(s) que lo usan:** ______________________
**Build instalado hoy (antes de tocar nada):** `dumpsys package <paquete> |
grep -E "versionName|lastUpdateTime"` → ______________________
**AUTH_MODE del build instalado:** ☐ `supabase` ☐ `legacy` (si dice legacy,
reinstalar con el build actual ANTES de seguir — ver §27 del plan de
cutover, orden A-C)

| # | Prueba | Resultado | Notas |
|---|---|---|---|
| 1 | Login online (usuario real + contraseña) | ☐ PASS ☐ FAIL | |
| 2 | Configurar PIN (Quick Unlock) | ☐ PASS ☐ FAIL | |
| 3 | Bloquear (lockApp) — PIN pide, sesión Auth sigue intacta | ☐ PASS ☐ FAIL | |
| 4 | Abrir con PIN correcto | ☐ PASS ☐ FAIL | |
| 5 | Cerrar la app y reabrir (sin reiniciar el teléfono) | ☐ PASS ☐ FAIL | |
| 6 | Reiniciar el teléfono (restart real) | ☐ PASS ☐ FAIL | |
| 7 | Modo avión (offline) | ☐ PASS ☐ FAIL | |
| 8 | Ver pendientes (Dashboard) en offline | ☐ PASS ☐ FAIL | |
| 9 | Registrar un engrase en offline | ☐ PASS ☐ FAIL | |
| 10 | Registrar un "No se pudo ejecutar" (lubrication_skip) en offline | ☐ PASS ☐ FAIL | |
| 11 | Cerrar la app estando offline | ☐ PASS ☐ FAIL | |
| 12 | Reabrir la app todavía offline — los datos de 9/10 siguen ahí | ☐ PASS ☐ FAIL | |
| 13 | Restaurar internet | ☐ PASS ☐ FAIL | |
| 14 | Sync real (reconexión) — sin pedir login de nuevo | ☐ PASS ☐ FAIL | |
| 15 | Confirmar que no hay duplicados del engrase/skip de 9/10 | ☐ PASS ☐ FAIL | |
| 16 | Cambiar de usuario (otra persona entra en el mismo dispositivo) | ☐ PASS ☐ FAIL | |
| 17 | Cerrar sesión (logout) — pide usuario+contraseña, no PIN | ☐ PASS ☐ FAIL | |
| 18 | Device assignment (cuadrilla/ubicación del dispositivo se conserva tras 16/17) | ☐ PASS ☐ FAIL | |
| 19 | Escanear QR de un equipo real | ☐ PASS ☐ FAIL | |
| 20 | Notificaciones locales (recordatorio de turno) | ☐ PASS ☐ FAIL | |
| 21 | OneSignal — identidad asociada al usuario real (si ya está activo) | ☐ PASS ☐ FAIL ☐ N/A todavía | |
| 22 | Fotos/firmas (Storage) se ven y se suben bien | ☐ PASS ☐ FAIL | |

**OK para 0003 en este dispositivo:** ☐ SÍ ☐ NO — todas las filas 1-18 en
PASS (19-22 son deseables pero no bloquean 0003 por sí solas, ver
`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §15).

(Copiar esta sección §1 una vez por cada dispositivo real.)

## 2. Carryover real (al menos un dispositivo, Día→Noche)

| # | Prueba | Resultado |
|---|---|---|
| 1 | Turno Día no ejecuta un punto programado → queda `lubrication_skip` | ☐ PASS ☐ FAIL |
| 2 | Turno Noche abre Dashboard → aparece en "Pendientes del turno anterior" | ☐ PASS ☐ FAIL |
| 3 | Turno Noche lo ejecuta → queda "Realizado atrasado", NUNCA crea `OUT_OF_PLAN` ni una occurrence nueva | ☐ PASS ☐ FAIL |

## 3. Gate final — "OK para 0003" a nivel de TODO el cutover

No marcar ninguna casilla de abajo sin evidencia real (no simulada):

- [ ] Backup ejecutado (`docs/PRE_CUTOVER_BACKUP_CHECKLIST.md`)
- [ ] Tag de retorno confirmado (`pre-cutover-908e0e2` o el más reciente)
- [ ] Cuentas Auth reales creadas para TODO el personal que opera el
      teléfono (tabla §0 completa, sin filas vacías para gente real)
- [ ] Login real PASS en TODOS los dispositivos de campo (no solo 1)
- [ ] PIN real PASS en todos
- [ ] Offline real PASS en todos
- [ ] Logout/cambiar usuario real PASS en todos
- [ ] Device assignment real PASS en todos
- [ ] `manage-users` probado con un usuario NO-administrador real (403
      esperado en acciones de admin)
- [ ] `push_tokens` protegido (`0007` aplicado, DESPUÉS de `0003`)
- [ ] `0003` preparado y revisado (`supabase/migrations/0003_auth_rls_CUTOVER_PREPARED.sql`)
- [ ] Rollback de `0003` preparado y entendido
- [ ] `tools/verify-rls-matrix.mjs` preparado (correr DESPUÉS de `0003`)
- [ ] `0005_storage_privacy` preparado y revisado
- [ ] Rollback de `0005` preparado
- [ ] OneSignal preparado (App ID real, Firebase/`google-services.json` si
      aplica Android)
- [ ] Al menos 1 prueba OneSignal real (push real recibido en un
      dispositivo real)
- [ ] Ningún usuario real queda atrapado en `legacy` (todos los dispositivos
      de campo reinstalados con el build `supabase` ANTES de `0003`)
- [ ] Sin P0/P1 abiertos que bloqueen (ver `docs/BUG_REGISTER.md`)

Solo cuando TODO lo de arriba esté en `[x]` con evidencia real, se pide la
autorización explícita y puntual para ejecutar `0003` (nunca antes, y
nunca como parte de "hacer todo").
