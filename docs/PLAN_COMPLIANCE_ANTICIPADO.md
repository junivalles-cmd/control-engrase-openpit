# Cumplimiento del plan — "anticipado" con tolerancia ±10% (Horas de operación)

Fecha: 2026-09-25. Estado: **IMPLEMENTADO** (sin commit todavía; sin
integrar en DB/sync ni en `sync.js` — solo lógica pura + UI de Historial).

## Regla implementada

Solo aplica a `plan.controlType === 'Horas de operación'`. Plan Día/Turno
**no cambió** (sigue binario `cumplido`/`fuera_de_plan`, sin `anticipado`).

```
ratio = (record.hourmeter - previousRecord.hourmeter) / plan.frequency

ratio < 0.90          → 'anticipado'
0.90 <= ratio <= 1.10 → 'cumplido'
ratio > 1.10          → 'fuera_de_plan'
sin registro anterior → 'no_evaluable' (nunca se asume ninguno de los 3)
```

Tolerancia operativa: **±10% del intervalo del plan**, decisión ya tomada
(no inventada por el modelo). Ejemplo con intervalo 250 h:

| Delta | Ratio | Estado |
|---|---|---|
| 180 h | 0.72 | anticipado |
| 224 h | 0.896 | anticipado |
| 225 h | 0.90 | cumplido |
| 250 h | 1.00 | cumplido |
| 275 h | 1.10 | cumplido |
| 276 h | 1.104 | fuera_de_plan |
| 350 h | 1.40 | fuera_de_plan |

## Archivos modificados

- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/plan-compliance.js` —
  `evaluateRecordCompliance()` (rama Horas) reescrita con la fórmula de
  ratio; nueva función `computeFleetCompliance(evaluations)` (cumplimiento
  de flota a partir de evaluaciones ya calculadas).
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js` — `complianceBadgeHTML()`
  agrega `anticipado: ['hist-compliance-early', 'Anticipado']`.
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css` — nueva clase
  `.hist-compliance-early` (ámbar tenue, mismo patrón que
  ok/alert/neutral).
- `tests/helpers/loadLubricationLogic.js` — extrae también
  `computeFleetCompliance` desde la fuente real.
- `tests/unit/plan-compliance.test.js` — casos de tolerancia (tabla de
  arriba, vía `it.each`) + 4 tests de `computeFleetCompliance()`.
- `tests/ui/historial-eq-search-flow.spec.js` — fixture `r5` ajustada
  (200h→230h de delta) para seguir cayendo en "cumplido" bajo la nueva
  regla; badge "Anticipado" ya soportado por `complianceBadgeHTML()`.

## Compliance de flota (`computeFleetCompliance`)

- `cumplido` → cuenta como cumplimiento.
- `fuera_de_plan` → cuenta como incumplimiento.
- `pct = cumplido / (cumplido + fuera_de_plan)`, redondeado.
- `anticipado` → categoría separada, **no** entra en `pct` (ni suma ni
  resta).
- `no_evaluable` → excluido del denominador por completo.
- Si la base (`cumplido + fuera_de_plan`) es 0, `pct` es `null` — nunca se
  inventa un porcentaje sin datos evaluables.

Esta función es pura y está probada, pero **no está conectada** todavía a
ningún KPI del Dashboard (el `compliance%` actual de `renderDashboard()` es
otro cálculo, basado en `statusFor()`/`counts`, no en historial de
registros) — conectar ambos queda fuera de este lote, a decidir si se desea
más adelante.

## Verificación

`npm test`: 234/234 PASS (25 en `plan-compliance.test.js`, antes 13).
`npm run typecheck`: PASS. `tests/ui/historial-eq-search-flow.spec.js`:
168/168 PASS (incluida la sección "Cumplimiento del plan").
