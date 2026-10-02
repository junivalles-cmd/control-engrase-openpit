// @ts-check
/* ============================================================
   CONTROL DE ENGRASE - OPEN PIT — src/core/hourmeter.js
   Validación de cambios de horómetro (evita errores de digitación al
   registrar un engrase). Extraído de app.js sin cambios de comportamiento
   — ver docs/MODULARIZATION.md. Depende de `fmt()` (definida en
   src/core/lubrication-status.js, cargada antes que este archivo en
   index.html), disponible como global cuando esta función se LLAMA.
   Script clásico (sin export/import): queda disponible como global, igual
   que las de app.js/db.js/sync.js.

   TypeScript Fase 1 (ver docs/TYPESCRIPT_MIGRATION.md): este archivo sigue
   siendo .js (renombrarlo a .ts no es seguro todavía — Vite no procesa
   scripts clásicos y el arnés de tests evalúa el texto fuente crudo con
   `new Function()`, incompatible con sintaxis TS real). Se agregó
   `// @ts-check` + JSDoc para que `npm run typecheck` verifique tipos
   sobre el .js real, sin cambiar ni una línea de lógica.
   ============================================================ */

/**
 * @typedef {{ ok: true }} HourmeterOk
 * @typedef {{ ok: false, message: string }} HourmeterRejected
 * @typedef {{ ok: 'warn', message: string }} HourmeterWarning
 * @typedef {HourmeterOk | HourmeterRejected | HourmeterWarning} HourmeterValidationResult
 */

/* ---------- Validación de horómetro (evita errores de digitación) ---------- */
/**
 * @param {number} oldValue
 * @param {number} newValue
 * @returns {HourmeterValidationResult}
 */
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
