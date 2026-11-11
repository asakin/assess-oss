import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { run } from '../skills/assess-oss/scripts/cli.mjs';
import { HttpClient } from '../skills/assess-oss/scripts/http.mjs';

const { values } = parseArgs({ options: { 'output-dir': { type: 'string' } } });
const output = values['output-dir'] ? resolve(values['output-dir'])
  : await mkdtemp(join(tmpdir(), 'assess-public-smoke-'));
await mkdir(output, { recursive: true });
const client = new HttpClient();
const cases = [
  ['github-inspect', ['inspect', 'alexeyraspopov/picocolors']],
  ['npm-inspect', ['inspect', 'npm:picocolors']],
  ['scoped-npm', ['inspect', 'npm:@sindresorhus/is']],
  ['crate-inspect', ['inspect', 'crate:clap']],
  ['github-search', ['search', 'terminal multiplexer', '--limit', '3']],
  ['npm-search', ['search', 'terminal colors', '--ecosystem', 'npm', '--limit', '3']],
  ['crate-search', ['search', 'argument parser', '--ecosystem', 'crate', '--limit', '3']],
  ['comparison', ['compare', 'npm:picocolors', 'npm:kleur']],
  ['alternatives', ['alternatives', 'crate:clap', '--query', 'argument parser', '--limit', '3']],
  ['portfolio', ['profile', '@alexeyraspopov']],
  ['maintainers', ['maintainers', 'alexeyraspopov/picocolors']],
  ['missing-project', ['inspect', 'assess-oss-missing-2026/no-such-repository'], 1],
  ['unsupported-repository', ['inspect', 'crate:libredox']],
  ['jev-preview', ['inspect', 'npm:picocolors', '--jev', '--goal', 'Terminal colors in a Node CLI', '--dry-run']],
];
const summary = [];
function sourceFailures(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value.warnings)) found.push(...value.warnings.filter(w =>
    /HTTP \d+|Unexpected response|failed|exceeds|interrupted/.test(w)));
  for (const [key, child] of Object.entries(value)) if (key !== 'warnings') {
    if (Array.isArray(child)) child.forEach(item => sourceFailures(item, found));
    else if (typeof child === 'object') sourceFailures(child, found);
  }
  return [...new Set(found)];
}
for (const [name, args, expectedExit = 0] of cases) {
  const started = Date.now();
  try {
    const result = await run([...args, '--json'], { client });
    await writeFile(join(output, `${name}.json`), result.text);
    assert.equal(result.exitCode, expectedExit, 'Unexpected exit code');
    const data = result.result.data;
    if (name === 'unsupported-repository') assert.equal(data.repository, null, 'Expected non-GitHub repository');
    if (name === 'scoped-npm') assert.equal(data.id, '@sindresorhus/is');
    if (name === 'portfolio') assert.ok(data.notable_repositories.length > 0);
    if (name === 'maintainers') assert.equal(data.owner.login, 'alexeyraspopov');
    if (name === 'jev-preview') assert.equal(data.assessment.sent, false);
    if (name.endsWith('-search') || name === 'alternatives') assert.ok(data.candidates.length > 0);
    const errors = sourceFailures(data);
    // A source may legitimately have no GitHub releases; other source failures need investigation.
    const unexpected = errors.filter(error =>
      !(name === 'missing-project' && /HTTP 404/.test(error)) &&
      !/HTTP 404: https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/latest/.test(error));
    assert.deepEqual(unexpected, [], 'Unexpected upstream/enrichment failures');
    summary.push({ name, status: 'passed', exit_code: result.exitCode, duration_ms: Date.now() - started, source_notes: errors });
  } catch (error) {
    summary.push({ name, status: 'failed', duration_ms: Date.now() - started, error: error.message });
  }
}
const report = { observed_at: new Date().toISOString(), runtime: process.version,
  paid_api_calls: 0, output, cases: summary };
await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (summary.some(item => item.status !== 'passed')) process.exitCode = 1;
