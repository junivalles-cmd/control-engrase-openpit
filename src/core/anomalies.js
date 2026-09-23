/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/anomalies.js
   Criticidad automática de una anomalía generada desde un punto de engrase
   no atendido. Extraído de app.js sin cambios de comportamiento — ver
   docs/MODULARIZATION.md.
   Script clásico (sin export/import): queda disponible como global, igual
   que las de app.js/db.js/sync.js. La usa createAutoAnomalies() en app.js
   (que sigue ahí — está fuertemente acoplada a IndexedDB, ver
   docs/AUTOMATED_TESTS.md).
   ============================================================ */

const CRITICIDAD_POR_MOTIVO = {
  'Grasera dañada': 'Alta',
  'Línea de engrase obstruida': 'Alta',
  'Falla mecánica': 'Crítica',
  'Sello dañado': 'Alta',
  'Punto inaccesible': 'Media',
  'Falta de lubricante': 'Media',
  'Equipo trabajando': 'Baja',
  'Equipo detenido': 'Baja',
  'Otro': 'Media'
};
