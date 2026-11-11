import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from '../skills/assess-oss/scripts/cli.mjs';
import { markdown } from '../skills/assess-oss/scripts/render.mjs';
import { fixtureClient } from '../test/fixtures.mjs';
import { HttpClient } from '../skills/assess-oss/scripts/http.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  live: { type: 'boolean' }, 'output-dir': { type: 'string' },
} });
const mode = values.live ? 'live' : 'fixture';
const cases = JSON.parse(await readFile(join(root, 'evals/evals.json'), 'utf8')).evals;
const outputRoot = values['output-dir'] ? resolve(values['output-dir'])
  : await mkdtemp(join(tmpdir(), 'assess-oss-eval-'));
const workspace = join(outputRoot, mode, 'iteration-1');
const client = values.live ? new HttpClient() : fixtureClient().client;
const summary = [];

// Serial public API calls share cache and pacing; no TypeSafe calls in this runner.
for (const task of cases) {
  const args = values.live ? task.args : task.fixture_args;
  const dir = join(workspace, `eval-${task.id}-${task.name}`, 'collector');
  const output = join(dir, 'outputs');
  await mkdir(output, { recursive: true });
  const started = performance.now();
  const result = await run([...args, '--json'], { client });
  const elapsed = performance.now() - started;
  await writeFile(join(dir, 'eval_metadata.json'), JSON.stringify({
    eval_id: task.id, eval_name: task.name, prompt: task.prompt,
    expected_output: task.expected_output,
    method: `${mode} collector replay; not an independent agent run or baseline comparison`,
    assertions: [],
  }, null, 2) + '\n');
  await writeFile(join(output, 'result.json'), result.text);
  await writeFile(join(output, 'brief.txt'), markdown(result.result));
  await writeFile(join(dir, 'timing.json'), JSON.stringify({
    total_duration_seconds: elapsed / 1000, method: 'collector wall time, not agent time',
  }, null, 2) + '\n');
  const data = result.result.data;
  const warnings = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.warnings)) warnings.push(...value.warnings);
    for (const [key, child] of Object.entries(value)) if (key !== 'warnings') {
      if (Array.isArray(child)) child.forEach(visit);
      else if (typeof child === 'object') visit(child);
    }
  }
  visit(data);
  summary.push({
    name: task.name, args, exit_code: result.exitCode, kind: data.kind,
    duration_ms: Math.round(elapsed),
    source_errors: warnings.filter(w => /HTTP|failed|unavailable|exceeds/i.test(w)),
    candidate_count: data.candidates?.length,
    highlights: data.notable_repositories?.length,
    external_examples: data.external_contributions?.length,
    profiles: data.profiles?.map(p => ({ id: p.id, type: p.account_type, status: p.status })),
  });
}
console.log(JSON.stringify({ mode, workspace, cases: summary }, null, 2));
if (summary.some(item => item.exit_code !== 0)) process.exitCode = 1;
