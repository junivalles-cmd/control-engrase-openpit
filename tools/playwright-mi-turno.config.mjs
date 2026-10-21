// Local fixtures only: no application boot, production credentials or Vite server.
import base from './playwright-support.config.mjs';
export default {
  ...base,
  testMatch: ['mi-turno-selected-crew.spec.js', 'lubricador-fresh-install-bootstrap.spec.js'],
  outputDir: 'node_modules/.cache/playwright-mi-turno',
};
