// Synthetic inline fixtures only: no Vite server, Supabase or production network.
import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('tests/ui'),
  testMatch: ['matrix-occurrence-detail.spec.js', 'weekly-matrix-dual-shift.spec.js', 'tasks-notifications-panel-ui.spec.js'],
  outputDir: path.resolve('node_modules/.cache/playwright-weekly-matrix'), workers: 2, timeout: 20000,
  reporter: 'list', use: { baseURL: 'http://fixture.invalid', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'phone-390', use: { viewport: { width: 390, height: 844 }, hasTouch: true } }, { name: 'desktop-1366', use: { viewport: { width: 1366, height: 768 } } }],
});
