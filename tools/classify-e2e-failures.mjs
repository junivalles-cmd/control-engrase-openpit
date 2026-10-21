import fs from 'node:fs';

const input = process.argv[2] || 'node_modules/.cache/e2e-final-ui.json';
const output = process.argv[3] || 'docs/evidence/E2E_FAILURE_CLASSIFICATION_2026-10-20.json';
const report = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const failures = [];
function visit(suite) {
  for (const spec of suite.specs || []) for (const test of spec.tests || []) {
    if (test.status !== 'unexpected') continue;
    const result = test.results.at(-1);
    failures.push({ file: spec.file, title: spec.title, project: test.projectName,
      error: (result.error?.message || '').replace(/\u001b\[[\d;]*m/g, '') });
  }
  for (const child of suite.suites || []) visit(child);
}
report.suites.forEach(visit);
function classify(f) {
  if (f.error.includes("reading 'supportGrants'")) return ['F', 'Initial authorization context null dereference', 'Persist first context without inheriting grants from a nonexistent predecessor', 'Previous context null; optional comparisons both matched undefined before dereference'];
  if (f.error.includes('overlaps')) return ['F', '360px topbar flex shrink', '44px controls occupy separate hit areas', 'Quick-find wrapper shrinks to 20.3125px around its 44px button; QR starts at 166px before button ends at 187.6875px'];
  if (f.error.includes('ReferenceError')) return ['E', f.error.split('\n')[0], 'Load real function dependencies in isolated fixture', 'Extracted function invokes a dependency omitted by the fixture; scripts exist in real index.html'];
  if (f.file === 'evidence-photo-stamp.spec.js') return ['E', 'Evidence persistence dependencies and submit/ACK missing', 'Load complete DB, authenticated account context, await durable write and arrange acknowledged version before edit', 'Extracted DB lacks tagRowsForCurrentAccount and Auth context; immediate reads also race async submit and yield undefined to edit'];
  if (f.file === 'lubricador-shift-workspace.spec.js') return ['E', 'Second crew has no principal coverage fixture', 'Explicit principal coverage for the second crew', 'Crew is neither explicit PRINCIPAL nor legacy isDefault; no principal work is selected'];
  if (f.file === 'follow-up-visual-consistency.spec.js') return ['D', 'Whole app compared with historical commit 301bc41', 'Assert theme preferences isolation against their current contract', 'Accepted business and navigation changes differ from historical entire-file snapshot'];
  if (f.error.includes('outOfPlan')) return ['E', 'Unawaited async navigation handler', 'Wait for flow callback before reading captured options', 'Captured callback options are read before asynchronous equipment/scope lookup completes'];
  if (f.error.includes('addStyleTag')) return ['G', 'External Google Fonts stylesheet load failure', 'Fixture CSS loads independently of external network', 'addStyleTag rejects while @import depends on external request'];
  if (f.error.includes('timeout')) return ['G', '30s timeout requiring isolated rerun', 'Complete same assertions in bounded isolated run', 'Six timeouts in long concurrent run; not assumed flaky until rerun'];
  return ['H', 'Unclassified', 'Investigate', f.error];
}
const groups = new Map();
for (const f of failures) {
  const [category, cause, expected, actual] = classify(f);
  const key = category + ':' + cause;
  const group = groups.get(key) || { category, cause, count: 0, files: {}, expected, actual, examples: [] };
  group.count++; group.files[f.file] = (group.files[f.file] || 0) + 1;
  if (group.examples.length < 2) group.examples.push(f);
  groups.set(key, group);
}
const totals = Object.fromEntries('ABCDEFGH'.split('').map(c => [c, 0]));
for (const g of groups.values()) totals[g.category] += g.count;
const result = { source: input, originalStats: report.stats, initialFailures: failures.length,
  note: 'Historical execution predates the final navigation rename; no failures attributed to that later change. Categories G require rerun before final disposition.',
  limits: [
    'Counts identify tests associated with root causes, not numbers of distinct bugs.',
    'The context setter defect is reproduced with partial fixture contexts lacking identity/fingerprint fields; no Supabase Auth/RLS failure is inferred from those 161 tests.',
    'Additional fixture errors unmasked after the first failure are tracked in subsequent runs rather than double-counted in the original 643.',
  ],
  totals, groups: [...groups.values()].sort((a,b) => b.count-a.count) };
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ initialFailures: result.initialFailures, totals, groups: result.groups.length }));
