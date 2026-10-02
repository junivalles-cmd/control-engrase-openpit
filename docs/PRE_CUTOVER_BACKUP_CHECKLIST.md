# Checklist de respaldo — ANTES de aplicar 0003/0005/0007

Preparado 2026-10-02, **sin ejecutar**. Este documento existe porque se
verificó contra producción (`supabase backups list --project-ref
havrirlapjyqrffgalqx`) que **no existe ningún respaldo remoto real hoy**:
`pitr_enabled: false`, `backups: []`. No asumir que Supabase ya respalda
esto solo — cualquier respaldo tiene que generarse a mano con los comandos
de abajo, y confirmarse (archivo con tamaño > 0, abre/parsea bien) antes de
continuar al siguiente paso del cutover.

No ejecutar ninguno de estos comandos todavía — son para el momento en que
el usuario autorice explícitamente empezar el cutover real (§27 de
`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`).

## 1. Datos de PostgreSQL (todas las tablas, `public` + `storage` schema)

```
supabase db dump --linked --project-ref havrirlapjyqrffgalqx \
  --data-only --schema public,storage \
  -f backups/pre-cutover-<fecha>-data.sql
```

Confirmar después: `grep -c "INSERT INTO" backups/pre-cutover-<fecha>-data.sql`
da un número > 0 y razonable (comparar contra `select count(*) from
engrase_sync` de una auditoría reciente — última conocida: ~1662+ filas).

## 2. Estructura + políticas (schema completo, sin datos)

```
supabase db dump --linked --project-ref havrirlapjyqrffgalqx \
  --schema public,storage,auth \
  -f backups/pre-cutover-<fecha>-schema.sql
```

Debe incluir las funciones `current_app_role()`/`current_app_active()`,
las 3+N policies de `engrase_sync`, y las policies de `storage.objects`
(antes/después de 0005). Guardar aparte del dump de datos — sirve para
reconstruir la estructura exacta si el rollback de una migración falla a
medias.

## 3. Migrations ya aplicadas (snapshot de referencia)

```
supabase migration list --linked --project-ref havrirlapjyqrffgalqx
```

Guardar la salida junto al backup — es la foto de "qué estaba aplicado
exactamente" en el momento del respaldo, para comparar si algo diverge
después.

## 4. Configuración relevante (sin secretos)

- `supabase functions list --project-ref havrirlapjyqrffgalqx` (versión
  activa de `manage-users`/`notify-push`/`notify-vencidos`).
- Valor de `AUTH_MODE` en el commit que se va a desplegar (`git show
  <commit>:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/auth.js | grep
  "const AUTH_MODE"`).
- **Nunca** incluir el `service_role` key ni ningún secret de Edge
  Functions en este respaldo — ninguno de los comandos de arriba los toca,
  pero si se hace un dump manual de `vault`/`secrets`, excluirlos a mano.

## 5. Objetos de Storage (bucket `engrase-photos`)

Antes de que el bucket pase a privado (0005), confirmar que cada objeto
sigue siendo accesible por su URL pública actual (sirve como respaldo "de
emergencia" aunque no sea un backup formal):

```
supabase db query --linked --project-ref havrirlapjyqrffgalqx \
  "select count(*), sum((metadata->>'size')::bigint) as bytes_totales from storage.objects where bucket_id='engrase-photos';"
```

Si se quiere un respaldo real de los archivos (no solo el conteo),
descargarlos todos con `supabase storage cp --recursive
ss://engrase-photos backups/pre-cutover-<fecha>-storage/ --linked
--project-ref havrirlapjyqrffgalqx` (requiere `--experimental`, confirmar
sintaxis exacta con `supabase storage cp --help` antes de correrlo, no
asumida aquí sin probar).

## 6. Código Git (ya hecho, confirmado)

- Tag `pre-cutover-908e0e2` ya existe sobre el HEAD validado — **ningún
  commit nuevo entre este tag y el cutover real sin volver a etiquetar**.
- `git log -1 --oneline pre-cutover-908e0e2` para confirmar antes de
  desplegar que el build que se publica es exactamente ese commit (o uno
  posterior ya re-etiquetado).

## 7. Versión de la app corriendo en cada plataforma

Antes de tocar RLS, confirmar (no asumir) qué build corre HOY en:
- Web pública (GitHub Pages).
- Cada dispositivo Android real de campo (`adb shell dumpsys package
  <paquete> | grep versionName`, o el equivalente ya usado en sesiones
  anteriores con `dumpsys package` + `lastUpdateTime`).

Este punto depende de `docs/FIELD_DEVICE_CUTOVER_CHECKLIST.md` (§13 del
pedido) — no se puede completar hasta que lleguen los dispositivos reales.

## 8. Rollback — qué hacer si algo falla a mitad de camino

| Si falló… | Acción |
|---|---|
| `0003` | `supabase db query --linked --project-ref havrirlapjyqrffgalqx --file supabase/migrations/0003_auth_rls_CUTOVER_ROLLBACK.sql` — restaura la policy legacy, sin tocar datos. |
| `0005_storage_privacy` | `..._ROLLBACK.sql` correspondiente — vuelve el bucket a público, sin borrar objetos. |
| `0007` | `0007_push_tokens_ownership_rls_ROLLBACK.sql` — restaura las 2 policies a su forma de 0002. |
| Algo en los datos quedó corrupto | Restaurar desde el dump de datos (§1) sobre una copia de prueba primero, NUNCA directo sobre producción sin verificar. |
| El build desplegado está mal | Volver al tag anterior (`pre-auth-users-rollout-7380d84` o el que corresponda), redesplegar. |

Ninguna fila de este documento se ejecuta sola — cada una requiere
autorización explícita en el momento, igual que el resto del cutover.
