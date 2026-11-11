import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { install, agents } from '../scripts/install.mjs';

test('all six install targets are standalone and existing installs are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assess-install-test-'));
  try {
    const paths = await install({ selected: Object.keys(agents), scope: 'global', root });
    assert.equal(paths.length, 4);
    for (const path of paths) {
      await access(join(path, 'SKILL.md'));
      assert.match(execFileSync(process.execPath, [join(path, 'scripts/cli.mjs'), '--version'],
        { cwd: tmpdir(), encoding: 'utf8' }), /assess-oss 0.1.0/);
    }
    await assert.rejects(install({ selected: ['pi'], scope: 'global', root }), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installation dry run does not create targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assess-dry-install-'));
  try {
    const [path] = await install({ selected: ['pi'], root, dryRun: true });
    await assert.rejects(access(path));
    await assert.rejects(install({ selected: ['not-an-agent'], root }), /Select/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
