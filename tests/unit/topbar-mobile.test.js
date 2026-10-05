// tests/unit/topbar-mobile.test.js
//
// Topbar global móvil (lote "fix: refine global mobile topbar") — a
// 390/412px competían menú/título/búsqueda/QR/conexión/turno/usuario:
// el badge de conexión se recortaba a texto sin sentido ("SIN INTERN…") y
// .topbar-shift se desbordaba a una segunda línea. Prueba por patrón de
// fuente (mismo método que el resto de dashboard-*.test.js): confirma que
// updateConnBadge() SIEMPRE fija aria-label/title (sin importar qué tan
// compacto se vea por CSS) y que el nuevo CSS está acotado a ".topbar"
// (nunca ".lub-topbar" — Mi Turno no se toca).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const connSrc = extractDeclaration(appSource, 'updateConnBadge');
const cssSource = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

describe('updateConnBadge() — SIEMPRE fija aria-label/title con el texto completo, para TODOS los estados', () => {
  it('fija aria-label y title UNA sola vez al final, fuera de cada rama (nunca solo en 3 de 8 estados como antes)', () => {
    expect(connSrc).toContain("b.setAttribute('aria-label', text);");
    expect(connSrc).toMatch(/b\.title = detail \? `\$\{text\} — \$\{detail\}` : `\$\{text\} — toca para sincronizar ahora`;/);
  });

  it('las 8 ramas de estado siguen existiendo con el mismo texto real (sin internet/unconfigured/syncing/offline/backend_unreachable/error/partial/AUTH_REQUIRED/AUTH_FORBIDDEN/ok/inicial) — el fix es solo de accesibilidad, no cambia ningún mensaje', () => {
    expect(connSrc).toContain("text = 'SIN INTERNET · GUARDANDO LOCAL';");
    expect(connSrc).toContain("text = 'SOLO LOCAL · SIN SERVIDOR CONFIGURADO';");
    expect(connSrc).toContain("text = 'SINCRONIZANDO…';");
    expect(connSrc).toContain("text = 'SIN CONEXIÓN CON EL SERVIDOR';");
    expect(connSrc).toContain("text = 'ERROR DE SINCRONIZACIÓN';");
    expect(connSrc).toContain('text = `SINCRONIZADO PARCIAL (${lastSyncState.errors.length} con error)`;');
    expect(connSrc).toContain("text = lastSyncState.status === 'AUTH_REQUIRED' ? 'SESIÓN REQUERIDA' : 'SIN PERMISO PARA SINCRONIZAR';");
    expect(connSrc).toContain("text = 'SINCRONIZADO';");
  });

  it('el detalle extra (backend_unreachable/error/partial) se conserva — se agrega al title, nunca se pierde', () => {
    expect(connSrc).toContain('detail = ');
    expect(connSrc).toContain('No se pudo contactar al servidor a tiempo');
    expect(connSrc).toContain("'Falló: ' + lastSyncState.errors.join(', ')");
  });
});

describe('CSS del fix — acotado a ".topbar", NUNCA toca ".lub-topbar" (Mi Turno no se modifica)', () => {
  it('el bloque nuevo (@media max-width:480px) existe y usa selectores ".topbar"/".topbar-shift"/".topbar-right", nunca ".lub-topbar"', () => {
    const idx = cssSource.indexOf('@media (max-width: 480px) {');
    expect(idx).toBeGreaterThan(-1);
    const block = cssSource.slice(idx, idx + 1300);
    expect(block).toContain('.topbar-shift { display: none; }');
    expect(block).toContain('.topbar .conn-badge {');
    // El bloque de comentario explicativo (justo ANTES de este índice) sí
    // menciona ".lub-topbar" a propósito, como ejemplo negativo ("esto no se
    // toca") — se revisa solo el CÓDIGO real (desde la llave de apertura),
    // nunca ese comentario.
    expect(block).not.toContain('.lub-topbar');
    expect(block).not.toContain('.lub-user-strip');
  });

  it('el conn-badge compacto mantiene 44px de área táctil real (var(--tap)), nunca un objetivo táctil reducido', () => {
    const idx = cssSource.indexOf('.topbar .conn-badge {');
    const block = cssSource.slice(idx, idx + 300);
    expect(block).toContain('width: var(--tap)');
    expect(block).toContain('height: var(--tap)');
  });

  it('el punto de color del conn-badge compacto usa currentColor (hereda el color semántico real de .conn-ok/.conn-off/.conn-warn, sin inventar una paleta nueva)', () => {
    const idx = cssSource.indexOf('.topbar .conn-badge::before');
    const block = cssSource.slice(idx, idx + 200);
    expect(block).toContain('background: currentColor;');
  });

  it('las clases .conn-ok/.conn-off/.conn-warn (semántica de color real) no se tocaron', () => {
    expect(cssSource).toContain('.conn-ok { background: rgba(63,185,80,0.15); color: var(--green); }');
    expect(cssSource).toContain('.conn-off { background: rgba(229,72,77,0.15); color: var(--red); }');
    expect(cssSource).toContain('.conn-warn { background: rgba(232,163,61,0.15); color: var(--amber); }');
  });
});

describe('No se tocó: Auth, navegación, búsqueda universal, QR, sync, roles/permisos (lógica)', () => {
  it('wireQuickFind()/openQrScanner()/navigate()/PERMISSIONS no se modificaron en este lote (siguen presentes, mismas firmas)', () => {
    expect(appSource).toContain('function wireQuickFind()');
    expect(appSource).toContain('function openQrScanner(');
    expect(appSource).toContain('function navigate(route)');
    expect(appSource).toContain('const PERMISSIONS = {');
  });

  it('boot()/bootLubricador() siguen generando los mismos ids reales (btn-menu-toggle/topbar-title/quick-find/btn-scan-qr-topbar/conn-badge) — el fix es CSS/accesibilidad, nunca una reestructuración de IDs', () => {
    expect(appSource).toContain('id="btn-menu-toggle"');
    expect(appSource).toContain('id="topbar-title"');
    expect(appSource).toContain('id="quick-find-toggle"');
    expect(appSource).toContain('id="btn-scan-qr-topbar"');
    expect(appSource).toContain('id="conn-badge"');
  });
});
