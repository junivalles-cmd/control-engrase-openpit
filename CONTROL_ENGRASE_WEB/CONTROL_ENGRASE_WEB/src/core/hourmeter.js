/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/hourmeter.js
   Validación de cambios de horómetro (evita errores de digitación al
   registrar un engrase). Extraído de app.js sin cambios de comportamiento
   — ver docs/MODULARIZATION.md. Depende de `fmt()` (definida en app.js),
   disponible como global cuando esta función se LLAMA.
   Script clásico (sin export/import): queda disponible como global, igual
   que las de app.js/db.js/sync.js.
   ============================================================ */

/* ---------- Validación de horómetro (evita errores de digitación) ---------- */
function validateHourmeterChange(oldValue, newValue) {
  if (isNaN(newValue) || newValue < 0) {
    return { ok: false, message: 'El horómetro debe ser un número válido y positivo.' };
  }
  if (newValue < oldValue) {
    return { ok: false, message: `El horómetro nuevo (${fmt(newValue)} h) es menor al actual (${fmt(oldValue)} h). El horómetro nunca debería bajar — revisa que no haya un error de digitación.` };
  }
  const diff = newValue - oldValue;
  if (diff > 500) {
    return { ok: 'warn', message: `El horómetro subió ${fmt(diff)} h de una sola vez (de ${fmt(oldValue)} a ${fmt(newValue)}). Es un salto grande. ¿Confirmas que el dato es correcto?` };
  }
  return { ok: true };
}
