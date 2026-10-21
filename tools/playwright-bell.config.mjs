// Inline fixtures only: real source and IndexedDB, no production network.
import base from '../playwright.config.js';
import path from 'node:path';
export default { ...base, testDir: path.resolve('tests/ui'), outputDir: path.resolve('node_modules/.cache/playwright-bell'), webServer: undefined, use: { ...base.use, baseURL: 'http://fixture.invalid' } };
