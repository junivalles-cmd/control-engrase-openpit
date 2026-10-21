# Soporte — "No sincroniza" / "No sube mis datos"

Guía operativa rápida para cuando un usuario reporta que la app "no
sincroniza". La app es **local-first**: todo se guarda primero en el
celular (IndexedDB) y se sincroniza solo cuando hay conexión — un dato
"no sincronizado" casi nunca es un dato perdido.

## Checklist (en orden)

**1. Revisar el badge de conexión** (junto a la campana, arriba a la
derecha). Tocarlo también fuerza un intento de sincronización.

| Badge visible | Significa | Acción |
|---|---|---|
| SINCRONIZADO (verde) | Todo al día | Ninguna |
| SINCRONIZANDO… (ámbar) | Primer ciclo de esta sesión en curso | Esperar unos segundos |
| SIN CONEXIÓN CON EL SERVIDOR (rojo) | No hay red / no llegó al servidor a tiempo | Ver punto 2 |
| SINCRONIZADO CON ADVERTENCIA (N pendiente) (ámbar) | El ciclo terminó, pero N fila(s) quedaron con error/conflicto aislado | Ver punto 5 — **no es un fallo total** |
| ERROR DE SINCRONIZACIÓN (rojo) | El ciclo falló | Ver punto 9 |
| SESIÓN REQUERIDA / SIN PERMISO PARA SINCRONIZAR (rojo, solo modo Supabase) | La sesión expiró o el pull completo fue rechazado | Pedir que cierre y vuelva a entrar con usuario/contraseña (no con PIN) |
| DATOS PENDIENTES DE HIDRATAR (ámbar) | La descarga inicial de esta cuenta no terminó | Tocar el badge para reintentar; si persiste, ver punto 9 |

**2. Revisar conectividad real del dispositivo** — WiFi/datos
activados, señal real (no solo el ícono del sistema, que puede
equivocarse). Probar abrir cualquier página web en el navegador del
dispositivo.

**3. Tocar el badge ("Sincronizar ahora")** — dispara un ciclo
inmediato sin esperar el intervalo automático.

**4. Revisar la última sincronización** — el detalle (tocar el ícono
ⓘ si aparece, o el `title` del badge) muestra cuándo fue el último
intento y qué pasó.

**5. Cambios pendientes / conflictos aislados** — "SINCRONIZADO CON
ADVERTENCIA" con un número significa que el resto del ciclo terminó bien;
solo esas filas puntuales necesitan revisión (puede ser un conflicto de
dos ediciones simultáneas, o una fila sin permiso). **No equivale a que
nada se guardó** — el resto de los datos del turno sí llegaron.

**6. Cerrar y volver a abrir la app sin borrar datos** — deslizar la
app fuera de recientes y reabrirla. Esto NUNCA borra IndexedDB.

**7. NO desinstalar la app** — desinstalar borra toda la cola de
sincronización pendiente y la sesión local. Si hay datos sin subir
todavía, se pierden.

**8. NO usar "Borrar datos" de la app** (Ajustes de Android) salvo
indicación explícita de soporte técnico autorizado — es destructivo y
equivalente a una reinstalación desde cero.

**9. Si nada de lo anterior resuelve, escalar con el SYNC #id** — pedir
al usuario una captura del detalle del badge (o Configuración →
Sincronización → Diagnóstico si el error es 403) y el nombre de
usuario/equipo afectado. Soporte técnico revisa logs del lado servidor
con ese identificador — nunca se diagnostica a ciegas sin él.

**10. Cuándo escalar** — escalar de inmediato si: el badge dice
`ERROR DE SINCRONIZACIÓN` o `SIN PERMISO PARA SINCRONIZAR` por más de un
turno completo; aparecen conflictos repetidos para el mismo equipo/usuario;
o el usuario reporta que un registro que sabe que hizo no aparece en
Historial después de confirmar conexión y varios reintentos.

## Conceptos clave para explicar al usuario

- **Local-first:** el registro ya está guardado en el celular en el
  momento en que se confirma en pantalla — sincronizar es "subirlo",
  nunca "crearlo".
- **Offline:** la app funciona sin internet para todo el flujo operativo
  (Mi Turno, registrar engrase, anomalías, fotos). Se sincroniza solo al
  recuperar conexión.
- **Reconnect:** al recuperar señal, la sincronización se reintenta sola
  (no hace falta reabrir la app ni tocar nada).
- **Watchdog:** si un ciclo de sincronización se queda "pegado"
  anormalmente, la app lo detecta y lo reintenta sola — no es necesario
  reiniciar el dispositivo para esto.
- **Conflictos aislados no son un fallo total:** una advertencia sobre 1-2
  filas no invalida el resto de un turno completo de trabajo.
