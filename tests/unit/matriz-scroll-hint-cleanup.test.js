// tests/unit/matriz-scroll-hint-cleanup.test.js
//
// Hardening pre-release 2026-10-08, hallazgo real de la auditoría:
// wireMatrizScrollHint() usaba window.addEventListener('resize', update)
// sin remover nunca ese listener — renderMatrizSemanal() reconstruye
// .matriz-wrap con innerHTML en cada navegación de semana/filtro, y el
// guard (wrap.dataset.scrollHintWired) es por-elemento, así que cada
// re-render dejaba un listener huérfano acumulado en `window` para
// siempre. Fix: ResizeObserver atado al propio `wrap`, nunca a `window` —
// se vuelve recolectable solo al reemplazarse el wrap, sin depender de un
// disconnect() explícito en ningún otro punto.
//
// Verificado por fuente (no por ejecución real): contar listeners vivos en
// `window` entre renders sucesivos no es observable con las APIs estándar
// del DOM — el comportamiento CSS/visual del scroll-hint ya se cubre con
// ejecución real en tests/ui/*.spec.js (matriz-*). Esto cierra el gap
// específico: que la implementación ya no registre nada en `window`.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const src = extractDeclaration(readSource(APP_JS_PATH), 'wireMatrizScrollHint');

describe('wireMatrizScrollHint() — cleanup real, sin acumular listeners en window', () => {
  it('ya NO registra window.addEventListener(\'resize\', update) como llamada real (solo queda mencionado en un comentario explicando el fix)', () => {
    expect(src).not.toMatch(/window\.addEventListener\(\s*['"]resize['"]\s*,\s*update\s*\)/);
  });

  it('usa ResizeObserver atado al propio wrap', () => {
    expect(src).toMatch(/new ResizeObserver\(update\)\.observe\(wrap\)/);
  });

  it('conserva el guard por-elemento (scrollHintWired) — no re-wirea el mismo wrap 2 veces', () => {
    expect(src).toContain('wrap.dataset.scrollHintWired');
  });

  it('conserva el listener de scroll propio del wrap (comportamiento visual intacto)', () => {
    expect(src).toMatch(/wrap\.addEventListener\(\s*['"]scroll['"]/);
  });
});
