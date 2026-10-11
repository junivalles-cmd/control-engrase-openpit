import { it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
const source = readSource(APP_JS_PATH);
const severity = new Function(`${extractDeclaration(source, 'getLubricationAgeSeverity')}; return getLubricationAgeSeverity;`)();
it.each([[1, 'follow-up'], [2, 'attention'], [3, 'attention'], [4, 'critical'], [8, 'critical'], [0, 'follow-up'], [null, 'unknown'], [NaN, 'unknown']])('age %s has only visual severity %s', (days, key) => {
  expect(severity(days).key).toBe(key);
});
