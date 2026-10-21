# Plantilla de Hallazgo de Piloto

Copiar un bloque por hallazgo. Un hallazgo = una observación concreta, no
un resumen del turno completo.

```
ID:
Fecha:
Usuario/Rol:
Equipo:
Pantalla:
Descripción:

Tipo:
- BUG
- UX
- DATO
- SYNC
- CAPACITACIÓN

Criticidad:
- P0
- P1
- P2
- P3

Reproducible: Sí/No

Evidencia: (captura/log/SYNC #id)

Acción: pendiente/corregido/descartado
```

## Guía rápida de criticidad

- **P0** — bloquea el uso de la app o causa pérdida/corrupción de datos.
- **P1** — rompe un flujo importante, pero hay una forma de rodearlo.
- **P2** — molesto o confuso, no bloquea el trabajo.
- **P3** — cosmético o mejora menor.

## Guía rápida de tipo

- **BUG** — el sistema hace algo distinto de lo esperado.
- **UX** — el sistema hace lo esperado, pero es confuso o incómodo.
- **DATO** — algo mostró información incorrecta (no necesariamente un
  bug de código — puede ser un dato mal cargado).
- **SYNC** — relacionado a sincronización/offline/reconexión.
- **CAPACITACIÓN** — el usuario no sabía cómo hacer algo que la app sí
  soporta — no requiere cambio de código, sí de guía/entrenamiento.
