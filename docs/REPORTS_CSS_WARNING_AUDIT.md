# Auditoría CSS previa a certificación

Comparación: `c6e9372` → `cccc7ed`, archivo canónico
`CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css`.
Se ejecutó Stylelint con la misma configuración para ambos contenidos,
sin cambiar archivos productivos ni desactivar reglas. Para comparar mensajes
se normalizaron únicamente las referencias a números de línea; se conservaron
las multiplicidades de cada warning.

- Baseline: 86 warnings, 0 errores.
- Reportes: 103 warnings, 0 errores.
- Delta: 17 warnings, todos `no-descending-specificity`.
- Los 86 anteriores siguen presentes (categoría F), sin cambios de mensaje
  ni de línea: el rediseño agregó un bloque al final. No hay warnings nuevos
  de selectores duplicados.

## Clasificación del delta

Los selectores de Reportes usan `:where(.rep-page)` para limitar su alcance
sin aumentar la especificidad. Stylelint compara el último elemento del
selector con reglas anteriores; esas reglas pueden pertenecer a otra pantalla,
un tema o un estado. Esa comparación no demuestra una colisión en el DOM.

Líneas referidas al archivo en `cccc7ed`:

| Línea | Selector de Reportes después de `:where(.rep-page)` | Comparación anterior | Grupo | Evaluación |
| --- | --- | --- | --- | --- |
| 3675 | `.panel` | `[data-mode="light"] .panel` | B | `min-width` permite encoger el panel; el tema conserva su fondo/borde. |
| 3676 | `.panel-head` | `.lub-content:has(.ayuda-page) .panel-head` | C | Densidad propia de Reportes; Ayuda y Reportes tienen alcances distintos. |
| 3677 | `.panel-head h3` | encabezado de Ayuda | C | Jerarquía tipográfica local; no altera Ayuda. |
| 3679 | `.kpi-card` | `[data-mode="light"] .kpi-card` | B | Padding/radio locales; las propiedades cromáticas del tema conservan prioridad. |
| 3680 | `.kpi-value` | `.rep-resumen-grid .kpi-value` | C | Tamaño 26px común; Resumen ya tiene 26px. Añade altura de línea y números tabulares. |
| 3681 | `.kpi-label` | `.rep-resumen-grid .kpi-label` | C | Tamaño 12px común; Resumen ya tiene 12px. Añade legibilidad y wrap a las otras métricas. |
| 3682 | `.empty-state` | empty state de Dashboard | C | Padding compacto local; Dashboard no pertenece a `.rep-page`. |
| 3686 | `.btn` | `.crew-location-filters .btn` | C | Altura táctil mínima de Reportes; no modifica el selector de cuadrillas. |
| 3688 | `.rep-filters-row .filter-label` | filtros de Dashboard | C | Tipografía y separación de filtros de Reportes, con alcance independiente. |
| 3690 | `.rep-tendencia-turno-grid > .panel` | panel de Ayuda | C | Ancho completo dentro del grid/flex de Reportes; Ayuda queda fuera. |
| 3705 | `.rep-consumo-row` | `.rep-consumo-row:last-child` | C | Altura/alineación/padding; `last-child` conserva la eliminación del borde final. |
| 3708 | `.data-table th` | `table.matriz th` | C | Header local de Reportes; Matriz Semanal queda fuera. |
| 3709 | `.data-table td` | `.data-table tbody tr:last-child td` | C | Padding/tipografía/wrap; no contradice la eliminación del borde final. |
| 3710 | `.data-table tbody tr:hover` | zebra de filas pares del tema claro | B | Se mantiene prioridad de la zebra del tema. El hover usa el mismo token de superficie; no hay contenido oculto ni cambio de interacción. |
| 3711 | `.rep-equipo-table th:nth-child(n+3)` | última columna de Matriz | C | Alineación numérica de Reportes; la tabla de Matriz tiene otro alcance. |
| 3712 | `.rep-equipo-table td:nth-child(n+3)` | último borde de fila | C | Alineación/números tabulares independientes de la propiedad del borde final. |
| 3718 | `.btn:focus-visible` | `#quick-unlock-area .btn` | C | Outline accesible local; Quick Unlock queda fuera de Reportes. |

Totales: A=0 nuevos; B=3; C=14; D=0; E=0; F=86 preexistentes.
Los overrides responsive de Reportes existen, pero no generan mensajes nuevos
en este delta. No se encontró propiedad duplicada accidental, selector duplicado
innecesario, override contradictorio ni CSS muerto que justifique una corrección.

## Decisión

Conservar el CSS aprobado y los 17 warnings documentados. No agregar excepciones
a Stylelint, aumentar especificidad ni reordenar reglas solo para bajar el contador:
eso podría alterar prioridad de temas/estados sin corregir un defecto demostrado.
No hay cambios de diseño ni CSS productivo en este lote; no corresponde segundo
commit CSS ni revalidación visual por cambios de estilos.

## Fixture de privacidad

En `cccc7ed`, el lote aislado con `--workers=1` reprodujo 42 casos correctos y
7 fallos (el mismo conflicto en los siete proyectos) por
`ReferenceError: findActiveValidation is not defined`.
`openValidationConflictModal()` llama a `findActiveValidation()`, que llama a
`findActiveValidations()` en `src/core/grease-validation.js`.
La fixture omitía ambos helpers. Se agregan a su lista existente de extracción
con `extractDeclaration`, igual que `validation-resolution.spec.js` y
`grease-validation.spec.js`; no se copian implementaciones ni cambian asserts,
firmas, mocks de red existentes o código productivo.

## Resultado de la pre-certificación

- Fixture aislada, todos los proyectos, `--workers=1`: 49 passed.
- Lote dirigido, siete proyectos, `--workers=2`: 525 passed,
  0 failed, 0 skipped, 0 flaky.
- Desglose: privacidad evidencia 49; cierre de privacidad 84;
  validación/firma 133; resolución de conflictos 28;
  estampado de fotos 56; trazabilidad/detalle de fotos 105;
  detalle de ocurrencias 70.
- Unit: 1471 passed (92 archivos).
- Typecheck, build y verify:dist: correctos.
- Lint CSS: 103 warnings, 0 errores, sin cambios respecto a `cccc7ed`.
- No se ejecutó la suite Playwright completa, SQL ni acceso a producción.
