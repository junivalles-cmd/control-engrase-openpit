# Reporte Final de Piloto — v1.0.0-rc1

> Plantilla en blanco. Completar únicamente con datos reales extraídos de
> las bitácoras de turno (`docs/PILOT_SHIFT_LOG_TEMPLATE.md`, una copia
> por turno) y de los hallazgos registrados en
> `docs/PILOT_ISSUES_TEMPLATE.md`. No completar ningún campo numérico
> "a ojo" ni por estimación — si un dato no se midió, se deja en blanco
> y se anota como pendiente, nunca se inventa.

**PILOT_DURATION:** (nº de turnos reales observados, no planeados)
**USERS:** (lubricadores que participaron)
**DEVICES:** (modelo + serial de cada uno)
**SHIFTS:** (fecha + turno de cada uno, uno por bitácora)

## Totales (suma de todas las bitácoras de turno)

**ENGRASES:**
**TASKS:**
**ANOMALIES:**
**PHOTOS:**

**SYNC_WARNINGS:**
**SYNC_ERRORS:**
**OFFLINE_EVENTS:**
**RECONNECTS:**
**DUPLICATES:**
**LOST_RECORDS:**

## Hallazgos (de docs/PILOT_ISSUES_TEMPLATE.md, agrupados por causa raíz —
no contar el mismo problema dos veces si se repitió en varios turnos)

**P0:** (lista de IDs, o "ninguno")
**P1:** (lista de IDs, o "ninguno")
**P2:** (lista de IDs)
**P3:** (lista de IDs)

## Feedback del lubricador (citas literales de las bitácoras, no resúmenes)

**USER_FEEDBACK:**

**TOP_FRICTIONS:** (los 3-5 puntos de fricción que más se repitieron entre
turnos/usuarios, no una lista exhaustiva)

**TOP_POSITIVES:**

## Agrupación post-piloto (sección 8 del pedido — por causa raíz, no por
síntoma)

**BUGS_TO_FIX:** (hallazgos tipo BUG, P0/P1 — candidatos a fix inmediato;
P2/P3 van al backlog normal, no aquí)
**UX_BACKLOG:** (hallazgos tipo UX, cualquier criticidad que no sea P0/P1
bloqueante)
**TRAINING_NEEDS:** (hallazgos tipo CAPACITACIÓN — no requieren cambio de
código, sí ajustar la guía rápida o el acompañamiento inicial)

## Decisión RC → RELEASE

Verificar cada criterio contra los totales de arriba antes de marcar
`RC_TO_RELEASE`:

- [ ] P0 abiertos = 0
- [ ] P1 abiertos = 0
- [ ] LOST_RECORDS = 0
- [ ] DUPLICATES = 0 (o explicados y no sistemáticos)
- [ ] Sync estable (SYNC_ERRORS aislados, no recurrentes por turno)
- [ ] Offline/reconnect funcionó en todos los eventos observados
- [ ] Lubricador(es) operaron sin asistencia continua después de la
      primera orientación

Si **todas** las casillas están marcadas → `RC_TO_RELEASE: YES`.
Si falta alguna → `RC_TO_RELEASE: NO`, indicar cuál(es) faltan y qué se
necesita para volver a intentarlo.

**RC_TO_RELEASE:** YES / NO

**VERDICT:** FIELD_PILOT_COMPLETE (solo marcar cuando el piloto real
terminó sus 2-3 turnos y este reporte está completo con datos reales)
