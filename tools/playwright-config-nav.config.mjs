// Synthetic inline fixtures only: no Vite server, Supabase or production network.
import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: path.resolve('tests/ui'),
  testMatch: ['configuration-navigation-real.spec.js'],
  outputDir: path.resolve('node_modules/.cache/playwright-config-nav'), workers: 2, timeout: 20000,
  reporter: 'list', use: { baseURL: 'http://fixture.invalid', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'desktop-1366', use: { viewport: { width: 1366, height: 900 } } }],
});
