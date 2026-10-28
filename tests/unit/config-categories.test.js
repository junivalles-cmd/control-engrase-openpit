// tests/unit/config-categories.test.js
//
// Configuración — tabs/categorías (lote dashboard+config UX) + cierre
// bloque Configuración (2026-10-18, mover Usuarios adentro). Prueba por
// patrón de fuente (mismo método que registrar-engrase-inicial.test.js)
// las partes de renderConfig() que requieren DB/Auth reales y por eso no se
// cubren en el fixture estático de tests/ui/config-desktop-grid.spec.js:
//   D) "Usuarios y accesos" EMBEBE renderUsuarios() de verdad (misma
//      función, mismo wiring) dentro de su propio contenedor — nunca un
//      redirect a otra pantalla, nunca una reimplementación ni un módulo
//      duplicado.
//   E) Cuadrillas/Ubicaciones/Categorías siguen llamando exactamente las
//      mismas funciones reales de siempre (cuadrillasPanelHTML/
//      simpleListPanelHTML/wireCuadrillasPanel/wireSimpleListPanel) — el
//      lote de tabs solo las reagrupa, nunca las reescribe.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const renderConfigSrc = extractDeclaration(appSource, 'renderConfig');
const wireNavSrc = extractDeclaration(appSource, 'wireConfigCategoryNav');
const navigateSrc = extractDeclaration(appSource, 'navigate');

describe('D) "Usuarios y accesos" — embebe renderUsuarios() real dentro de Configuración, sin duplicar pantalla', () => {
  it('renderConfig() ya NO redirige a la pantalla separada (sin navigate(\'usuarios\'), sin botón "Ir a Usuarios")', () => {
    expect(renderConfigSrc).not.toContain("navigate('usuarios')");
    expect(renderConfigSrc).not.toContain('btn-config-go-usuarios');
  });

  it('renderConfig() llama a renderUsuarios() real, apuntado a su propio contenedor embebido (nunca una reimplementación)', () => {
    expect(renderConfigSrc).toContain("await renderUsuarios($('#config-usuarios-embed'))");
    expect(renderConfigSrc).toContain('id="config-usuarios-embed"');
  });

  it('el contenedor embebido vive dentro de config-cat-usuarios (no se reimplementa tabla/fetch propios en renderConfig)', () => {
    // La categoría "usuarios" de renderConfig() es solo el contenedor —
    // la tabla y Auth.manageUsers('LIST_USERS') siguen viviendo
    // exclusivamente dentro de renderUsuarios()/renderUsuariosSupabase(),
    // funciones aparte, nunca copiadas aquí.
    const usuariosCategoryMatch = renderConfigSrc.match(/config-cat-usuarios[\s\S]*?config-cat-notificaciones/);
    expect(usuariosCategoryMatch).not.toBeNull();
    expect(usuariosCategoryMatch[0]).toContain('config-usuarios-embed');
    expect(usuariosCategoryMatch[0]).not.toContain('manageUsers');
    expect(usuariosCategoryMatch[0]).not.toContain('<table');
  });

  it('navigate(\'usuarios\') redirige a Configuración > Usuarios y accesos para quien también tiene "config" (nunca una pantalla duplicada); quien no tiene "config" sigue yendo a la pantalla separada de siempre', () => {
    expect(navigateSrc).toContain("route === 'usuarios'");
    expect(navigateSrc).toContain("includes('config')");
    expect(navigateSrc).toContain("_activeConfigCategory = 'usuarios'");
    expect(navigateSrc).toContain("route = 'config'");
  });
});

describe('E) Cuadrillas/Ubicaciones/Categorías — siguen usando las funciones reales de siempre, el lote de tabs solo las reagrupa', () => {
  it('renderConfig() sigue llamando cuadrillasPanelHTML()/simpleListPanelHTML() tal cual (nunca una reimplementación)', () => {
    expect(renderConfigSrc).toContain('await cuadrillasPanelHTML()');
    expect(renderConfigSrc).toContain("await simpleListPanelHTML('locations'");
    expect(renderConfigSrc).toContain("await simpleListPanelHTML('equipment_types'");
  });

  it('el wiring real (wireCuadrillasPanel/wireSimpleListPanel) sigue conectado después del render, sin cambios', () => {
    expect(renderConfigSrc).toContain('wireCuadrillasPanel(c, () => renderConfig())');
    expect(renderConfigSrc).toContain("wireSimpleListPanel(c, 'locations', () => renderConfig())");
    expect(renderConfigSrc).toContain("wireSimpleListPanel(c, 'equipment_types', () => renderConfig())");
  });

  it('Cuadrillas vive FUERA de .config-grid-2 (ancho completo); Ubicaciones/Categorías SÍ están dentro (emparejadas)', () => {
    const organizacionMatch = renderConfigSrc.match(/config-cat-organizacion[\s\S]*?config-cat-usuarios/);
    expect(organizacionMatch).not.toBeNull();
    const block = organizacionMatch[0];
    const cuadrillasIdx = block.indexOf('cuadrillasPanelHTML');
    const gridIdx = block.indexOf('config-grid-2');
    const locationsIdx = block.indexOf("simpleListPanelHTML('locations'");
    expect(cuadrillasIdx).toBeGreaterThan(-1);
    expect(gridIdx).toBeGreaterThan(-1);
    expect(locationsIdx).toBeGreaterThan(-1);
    // Cuadrillas aparece ANTES de abrir .config-grid-2; Ubicaciones aparece DESPUÉS.
    expect(cuadrillasIdx).toBeLessThan(gridIdx);
    expect(gridIdx).toBeLessThan(locationsIdx);
  });
});

// "Seguridad"/PIN rápido (Quick Unlock) se retiró por completo de
// CONFIG_CATEGORIES en UX CAMPO V2 (2026-10-24) — ya no es una categoría
// condicional, simplemente no existe.
describe('Categorías — set completo (7 categorías, sin "Seguridad")', () => {
  it('CONFIG_CATEGORIES declara las 7 categorías pedidas, en orden', () => {
    expect(renderConfigSrc).toContain("{ key: 'general', label: 'General' }");
    expect(renderConfigSrc).not.toContain("key: 'seguridad'");
    expect(renderConfigSrc).toContain("{ key: 'operacion', label: 'Operación' }");
    expect(renderConfigSrc).toContain("{ key: 'organizacion', label: 'Organización' }");
    expect(renderConfigSrc).toContain("{ key: 'usuarios', label: 'Usuarios y accesos' }");
    expect(renderConfigSrc).toContain("{ key: 'notificaciones', label: 'Notificaciones' }");
    expect(renderConfigSrc).toContain("{ key: 'sincronizacion', label: 'Sincronización' }");
    expect(renderConfigSrc).toContain("{ key: 'administracion', label: 'Administración' }");
  });

  it('no queda ningún bloque "Seguridad"/PIN rápido (retirado con Quick Unlock)', () => {
    expect(renderConfigSrc).not.toContain('quickUnlockAvailable');
    expect(renderConfigSrc).not.toContain('config-cat-seguridad');
  });
});

describe('wireConfigCategoryNav() — usa la clase .hidden real del proyecto, nunca el atributo hidden nativo', () => {
  it('nunca asigna .hidden = true/false (conflicto de especificidad con las reglas display de .config-*, ver styles.css)', () => {
    // Quita las líneas de comentario antes de revisar: el comentario de
    // app.js menciona a propósito "el.hidden = true" como ejemplo de lo que
    // NO hacer — solo el CÓDIGO real (fuera de comentarios) debe cumplir
    // la regla.
    const codeOnly = wireNavSrc.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(codeOnly).not.toMatch(/\.hidden\s*=\s*(true|false|desktop|!effective|!!effective)/);
  });

  it('usa classList.toggle(\'hidden\', ...) — mismo patrón que quick-find/pin-area en el resto de app.js', () => {
    expect(wireNavSrc).toContain("classList.toggle('hidden'");
  });

  it('no agrega un listener de resize nuevo en cada llamada (reutiliza uno solo vía _configResizeListenerWired)', () => {
    expect(wireNavSrc).toContain('_configResizeListenerWired');
    expect(wireNavSrc).toMatch(/if \(!_configResizeListenerWired\)/);
  });
});
