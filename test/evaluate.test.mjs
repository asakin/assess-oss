import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = join(root, 'scripts/evaluate.mjs');

test('evaluation outputs default outside the checkout and leave source files unchanged', async () => {
  const before = await readdir(root);
  const result = JSON.parse(execFileSync(process.execPath, [runner], { encoding: 'utf8' }));
  const outputRoot = join(result.workspace, '../..');
  try {
    assert.ok(relative(root, result.workspace).startsWith('..'));
    assert.equal(result.cases.length, 5);
    assert.ok(result.cases.every(item => item.exit_code === 0));
    await access(join(result.workspace, 'eval-1-inspect-crate/collector/outputs/result.json'));
    assert.deepEqual(await readdir(root), before);
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
});

test('evaluation output destination can be explicitly selected outside the checkout', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'assess-eval-destination-'));
  try {
    const result = JSON.parse(execFileSync(process.execPath, [
      runner, '--output-dir', destination,
    ], { encoding: 'utf8' }));
    assert.equal(result.workspace, join(destination, 'fixture/iteration-1'));
    const saved = JSON.parse(await readFile(join(result.workspace,
      'eval-4-public-portfolio/collector/outputs/result.json'), 'utf8'));
    assert.equal(saved.data.kind, 'profile');
  } finally { await rm(destination, { recursive: true, force: true }); }
});
