import base from './playwright-support.config.mjs';
export default { ...base,
  testMatch: ['mi-turno-selected-crew.spec.js', 'assignment-occurrence-execution-regression.spec.js', 'grease-validation.spec.js', 'lubricador-fresh-install-bootstrap.spec.js'],
  outputDir: 'node_modules/.cache/playwright-double-shift',
};
