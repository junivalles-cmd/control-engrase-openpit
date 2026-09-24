// playwright.config.js — UI/Responsive Fase 1 (auditoría, ver docs/UI_RESPONSIVE.md).
//
// Sirve la FUENTE canónica (CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB) con el
// propio servidor de desarrollo de Vite — no dist/, no www — para auditar
// exactamente lo que edita cualquier corrección de esta fase, sin esperar a
// un build. `npm run preview` (sobre dist/) se usa aparte, ya en
// npm run build:web, para la validación final post-cambios (PASO 22 del
// pedido), no para la auditoría.
//
// Solo se automatiza la pantalla de login (pública, sin autenticación, sin
// datos de negocio) — ver docs/UI_RESPONSIVE.md para por qué el resto de
// pantallas requiere validación manual (autenticación con PIN real de
// producción; no hay credenciales de prueba seguras en este entorno).
import { defineConfig, devices } from '@playwright/test';

// Las 7 resoluciones pedidas explícitamente, con su interpretación:
// 360x800 teléfono pequeño · 390x844 teléfono estándar · 412x915 Android grande
// 768x1024 tablet · 1024x768 tablet/desktop pequeño · 1366x768 PC común · 1920x1080 monitor grande
const RESOLUTIONS = {
  'phone-360': { width: 360, height: 800 },
  'phone-390': { width: 390, height: 844 },
  'phone-412': { width: 412, height: 915 },
  'tablet-768': { width: 768, height: 1024 },
  'tablet-1024': { width: 1024, height: 768 },
  'desktop-1366': { width: 1366, height: 768 },
  'desktop-1920': { width: 1920, height: 1080 },
};

export default defineConfig({
  testDir: './tests/ui',
  outputDir: './tests/ui/.playwright-artifacts', // gitignored — puede contener capturas con datos reales
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    screenshot: 'off', // las capturas de auditoría las toma cada test explícitamente, con ruta controlada
  },
  projects: Object.entries(RESOLUTIONS).map(([name, viewport]) => ({
    name,
    use: { ...devices['Desktop Chrome'], viewport, hasTouch: name.startsWith('phone') || name.startsWith('tablet') },
  })),
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
