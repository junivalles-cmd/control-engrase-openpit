import { defineConfig, devices } from '@playwright/test';

const viewports = {
  'phone-390': { width: 390, height: 844 },
  'phone-412': { width: 412, height: 915 },
  'tablet-768': { width: 768, height: 1024 },
  'tablet-1024': { width: 1024, height: 768 },
  'desktop-1366': { width: 1366, height: 768 },
  'desktop-1920': { width: 1920, height: 1080 },
};

export default defineConfig({
  testDir: './tests/ui',
  outputDir: './tests/ui/.playwright-artifacts',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  projects: Object.entries(viewports).map(([name, viewport]) => ({
    name,
    use: { ...devices['Desktop Chrome'], viewport, hasTouch: name.startsWith('phone') || name.startsWith('tablet') },
  })),
});
