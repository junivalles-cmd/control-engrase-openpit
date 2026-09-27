# Plantilla de altas — usuarios reales para Supabase Auth (P0-2)

Plantilla vacía. **Sin nombres inventados.** Se llena únicamente con
personas reales que el usuario/negocio confirme, antes de la Etapa A del
rollout (ver `docs/AUTH_RLS_MIGRATION_DESIGN.md` §12).

Ver la regla de identidad completa en
`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §16: **AUTH USER = persona real**.
No van aquí vehículos, equipos, cuadrillas, turnos, ni cuentas genéricas
compartidas — ver §17/§19 de ese mismo documento para dónde vive esa
información en cambio (ya existe: `equipment`, `cuadrillas`, `shiftId`).

**Nunca completar una columna de password/contraseña en este archivo ni
en ningún archivo del repositorio** — las contraseñas se crean/gestionan
únicamente dentro de Supabase Auth (dashboard o Admin API), nunca se
escriben en texto en ningún documento ni código.

## Tabla (vacía — completar con datos reales antes de la Etapa A)

| NOMBRE REAL | USUARIO | ROL | ACTIVO | IDENTIFICADOR AUTH | APP_USER_ID | CREAR AUTH SÍ/NO |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

## Guía de columnas

- **NOMBRE REAL:** nombre y apellido de la persona (no un rol, no un
  vehículo, no "Sistema"/"Test"/"Verificación").
- **USUARIO:** el identificador corto que la persona escribe al iniciar
  sesión (ej. `jguerrero`) — nunca ve el identificador Auth completo.
- **ROL:** uno de `ADMINISTRADOR`, `PLANIFICADOR`, `SUPERVISOR`,
  `LUBRICADOR`, `VISOR` (exactamente esos 5 strings — mismo `CHECK` que
  `app_profiles.role` en el SQL draft).
- **ACTIVO:** `true`/`false` — si la persona todavía trabaja con la app.
- **IDENTIFICADOR AUTH:** el email sintético interno que Supabase Auth
  usará por debajo (ej. `jguerrero@engrase.internal` — dominio a
  confirmar). Se genera de forma determinística a partir de USUARIO, no
  se inventa aparte.
- **APP_USER_ID:** el id estable que tendrá en `app_profiles.app_user_id`
  (y, si aplica, el nuevo `users.id` local — **nunca** reutilizar
  `u_admin`, `u_lub1`, `u_plan`, `u_sup`, `u_mso1a02g4k05ie`,
  `u_mu2w78xmok1njx`, `u_mu2w804yo1n94u` — esos 7 quedan como
  `LEGACY_SHARED`/`TEST_SEED`/`LEGACY_OPERATIONAL_ALIAS`, sin login
  futuro, ver `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §17).
- **CREAR AUTH SÍ/NO:** decisión explícita fila por fila — permite listar
  a alguien para revisión sin comprometerse todavía a crear su cuenta.

## Qué falta antes de poder llenar esta tabla con datos reales

1. Confirmar, para cada persona real que opera hoy en los dispositivos
   (las que hoy se esconden detrás de "Camioneta Lubrica"/"Camion
   Lubrico"/"Planificador"/el admin de bootstrap), su nombre real y rol.
2. Decidir si las cuentas por vehículo se reemplazan 1:1 por la persona
   que normalmente lo opera, o si varias personas rotan por turno sobre
   el mismo vehículo (en ese caso, cada persona es su propia fila aquí —
   el vehículo sigue siendo solo `equipmentId` en los registros, nunca un
   usuario, ver §19).
3. Confirmar el dominio del email sintético a usar en IDENTIFICADOR AUTH.

Nada de este archivo se aplica a Supabase hasta que estas 3 preguntas
tengan respuesta y la tabla de arriba tenga filas reales.
