// tests/unit/table-responsive-audit-p1.test.js
//
// Regresión — LOTE P1 de docs/UI_RESPONSIVE_FULL_AUDIT.md.
//
// Causa raíz real (verificada leyendo navigate(), app.js:1789-1809): esa función
// SÍ aplica makeTablesResponsive() automáticamente a #app-content después de la
// carga INICIAL de cualquier ruta — por eso UI-FULL-101 (Engrase del Turno)
// resultó ser un falso positivo de la auditoría estática (renderTurno() no tiene
// ningún otro punto de entrada, así que ese gancho central ya lo cubre siempre;
// no se tocó). El bug real en los otros 3 casos es que esas pantallas se
// RE-renderizan a sí mismas (guardar, importar, cualquier acción de
// Configuración) llamando a su propia función directamente — sin pasar de nuevo
// por navigate() — así que el gancho central nunca vuelve a aplicarse ahí. Este
// test no ejecuta DOM real (no hay jsdom configurado, ver vitest.config.js:
// environment 'node' — no se agregó por esta corrección, sería infraestructura
// nueva para 3 líneas) — verifica, sobre el código fuente real, que el patrón ya
// usado en el resto de la app (renderPlan/renderLubricantes/Dashboard/
// Historial/Reportes, todos con su propia llamada explícita) también está
// presente en los 3 puntos donde antes faltaba.
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('UI-FULL-102 — Actualizar Horómetros: re-render tras "Guardar"', () => {
  it('renderHorometros() llama makeTablesResponsive() sobre su propio contenedor', () => {
    const body = extractDeclaration(appSource, 'renderHorometros');
    expect(body).toMatch(/makeTablesResponsive\(c\)/);
  });
});

describe('UI-FULL-305 — Horómetros → preview de importación Excel (modal)', () => {
  it('handleHourmeterExcelImport() aplica makeTablesResponsive() después de abrir el modal', () => {
    const body = extractDeclaration(appSource, 'handleHourmeterExcelImport');
    const openModalIdx = body.indexOf('openModal(');
    const callIdx = body.indexOf('makeTablesResponsive(');
    expect(openModalIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(openModalIdx); // debe ir DESPUÉS de abrir el modal (tabla ya en el DOM)
  });
});

describe('UI-FULL-103 — Configuración: Registro de auditoría tras cualquier acción de la pantalla', () => {
  it('renderConfig() etiqueta explícitamente la tabla de auditoría (#audit-log-panel)', () => {
    const body = extractDeclaration(appSource, 'renderConfig');
    expect(body).toContain('id="audit-log-panel"');
    expect(body).toMatch(/makeTablesResponsive\(\$\('#audit-log-panel'\)\)/);
  });

  it('no renderiza una tabla global de tokens push que exponía datos de otros usuarios', () => {
    const body = extractDeclaration(appSource, 'renderConfig');
    expect(body).not.toContain('push-tokens-list');
    expect(body).not.toContain('data-edit-notif-user');
  });
});

describe('UI-FULL-101 — Engrase del Turno (falso positivo, documentado, sin cambios)', () => {
  it('renderTurno() no tiene ningún otro punto de entrada además de navigate()', () => {
    // Si esto alguna vez deja de ser cierto (alguien agrega un botón que llama
    // renderTurno() directamente, como pasa en renderHorometros()/renderConfig()),
    // este mismo patrón de bug reaparecería aquí y SÍ necesitaría su propia
    // llamada — por eso este test existe, como aviso temprano.
    const occurrences = (appSource.match(/renderTurno\(\)/g) || []).length;
    // 1 aparición esperada: la propia declaración ("async function renderTurno() {").
    // En el mapa de rutas de navigate() se referencia sin paréntesis ("turno:
    // renderTurno,"), así que no cuenta aquí. Cualquier aparición extra sería una
    // llamada directa nueva que bypassea navigate() — el mismo bug que UI-FULL-102/103.
    expect(occurrences).toBe(1);
  });
});
