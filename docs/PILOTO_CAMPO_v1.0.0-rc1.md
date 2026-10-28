# HISTORICAL / DEPRECATED — plan de piloto de `v1.0.0-rc1`.
# No usar como checklist actual de campo; la navegación y autenticación de
# esa versión ya cambiaron.

# Plan de Piloto de Campo — v1.0.0-rc1

**Objetivo:** validar `v1.0.0-rc1` en condiciones reales de campo, con
alcance controlado, antes de ampliar el despliegue.

## Alcance

- **Duración:** 2 a 3 turnos reales (no un solo registro suelto).
- **Participantes:** 1–2 lubricadores inicialmente, de una sola
  cuadrilla/ubicación conocida.
- **No desplegar masivamente de inmediato.** Ampliar solo después de
  revisar los hallazgos del piloto (ver `docs/PILOT_ISSUES_TEMPLATE.md`)
  contra los criterios de la sección siguiente.

## Qué observar durante el piloto

- Tiempo real para abrir Mi Turno desde que se desbloquea el celular.
- Tiempo real para registrar un engrase completo (checklist + horómetro +
  foto si aplica).
- Número de toques/pasos que el lubricador necesita para tareas
  comunes — ¿algo se siente innecesariamente largo?
- Uso real offline — ¿el lubricador nota o le preocupa quedarse sin
  señal?
- Frecuencia de advertencias de sincronización (badge ámbar/rojo) y si
  el lubricador sabe qué hacer cuando aparecen.
- Uso de Tareas (tareas asignadas, mensajes recibidos).
- Notificaciones push recibidas — ¿llegan, se entienden, se actúa sobre
  ellas?
- Fotos — ¿se suben sin fricción? ¿el lubricador confía en que quedaron
  guardadas?
- Registro de anomalías — ¿encuentra la pantalla? ¿completa los campos
  sin ayuda?
- Errores de usuario — toques equivocados, confusión de pantallas,
  pasos repetidos por accidente.
- Dudas frecuentes — anotar literalmente qué pregunta el lubricador, no
  solo "tuvo dudas".
- Uso de Quick Unlock — ¿lo configura solo? ¿entiende que es local al
  celular?
- Navegación general — ¿encuentra lo que busca sin que alguien le
  indique dónde está?

Todo esto se registra con la plantilla `docs/PILOT_ISSUES_TEMPLATE.md` y
se revisa contra el checklist `docs/PILOTO_CAMPO_CHECKLIST.md` en cada
turno.

## Criterios para pasar de RC a RELEASE

`v1.0.0-rc1` pasa a release formal **solo si**, durante el piloto:

- **Cero P0** (bloqueantes) encontrados, o todos cerrados.
- **Cero P1 abiertos** al cierre del piloto.
- **Sincronización estable** — sin pérdida de registros, sin
  duplicados, conflictos solo aislados y explicables (nunca sistemáticos).
- **Offline/reconnect correctos** en todos los turnos observados.
- **Los usuarios pueden operar sin asistencia continua** — después de la
  primera orientación, no necesitan que alguien les resuelva cada paso.
- **Feedback de uso aceptable** — sin rechazo generalizado al flujo
  principal (registrar engrase, ver Mi Turno).

`P2`/`P3` **no bloquean** el paso a release — se documentan y pasan al
backlog.

## Backlog diferido (no se implementa en este piloto)

- `LUB-02` — checklist de puntos marcado por defecto.
- `LUB-03` — Historial del Lubricador sin filtro de fecha.
- `DES-01` — migración de diálogos `alert()`/`confirm()`/`prompt()`
  nativos al modal propio.
- `S5` — Planificador sin acceso a Configuración.
- Lo que surja del piloto, clasificado con
  `docs/PILOT_ISSUES_TEMPLATE.md`.

Detalle completo del release en `docs/RELEASE_v1.0.0-rc1.md`.
# HISTORICAL / DEPRECATED — plan de piloto de `v1.0.0-rc1`.
# No usar como checklist actual de campo; la navegación y autenticación de
# esa versión ya cambiaron.

