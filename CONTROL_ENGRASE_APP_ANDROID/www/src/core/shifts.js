/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/shifts.js
   Lógica de turnos (Día/Noche) y ventana de avisos del Lubricador.
   Extraído de app.js sin cambios de comportamiento — ver
   docs/MODULARIZATION.md. Depende del objeto global `App`
   (App.currentUser, App.generalSettings), definido en app.js, que ya
   está disponible cuando estas funciones se LLAMAN (después de boot()),
   aunque este archivo se cargue antes en index.html.
   Script clásico (sin export/import): sus funciones quedan disponibles
   como globales, igual que las de app.js/db.js/sync.js.
   ============================================================ */

function currentShiftId() {
  const h = new Date().getHours();
  const { shiftDayStart, shiftNightStart } = App.generalSettings;
  return (h >= shiftDayStart && h < shiftNightStart) ? 'shift_dia' : 'shift_noche';
}

/* ---------- ¿Está esta persona dentro de su turno de trabajo? ----------
   Con teléfonos compartidos entre cuadrillas, esto es clave: el aviso debe ser para
   quien tiene la sesión abierta Y está trabajando, no para quien ya se fue a casa. */
function dentroDeSuTurno(settings, fecha) {
  if (!settings.soloEnTurno) return true;
  const u = App.currentUser;
  if (!u) return false;
  // Jefaturas y oficina no tienen turno rotativo: reciben en horario de oficina
  if (u.role !== 'LUBRICADOR') return true;

  const ahora = fecha || new Date();
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const { shiftDayStart, shiftNightStart } = App.generalSettings;
  const antes = settings.minutosAntesDelTurno ?? 15;
  const despues = settings.minutosDespuesDelTurno ?? 30;

  // El turno del usuario se toma del que tenga asignado; si no, del horario actual
  const turno = u.shiftId || currentShiftId();
  if (turno === 'shift_dia') {
    const ini = shiftDayStart * 60 - antes;
    const fin = shiftNightStart * 60 + despues;
    return min >= ini && min <= fin;
  }
  // Turno noche: cruza la medianoche
  const ini = shiftNightStart * 60 - antes;
  const fin = shiftDayStart * 60 + despues;
  return min >= ini || min <= fin;
}
