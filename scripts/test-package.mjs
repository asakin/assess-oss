import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, access, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fixtureClient } from '../test/fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { 'output-dir': { type: 'string' } } });
const sandbox = await mkdtemp(join(tmpdir(), 'assess-npm-package-'));
const output = values['output-dir'] ? resolve(values['output-dir']) : sandbox;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function command(executable, args, cwd = sandbox) {
  return execFileSync(executable, args, { cwd, encoding: 'utf8', timeout: 120_000 });
}
try {
  await mkdir(output, { recursive: true });
  const [packed] = JSON.parse(command(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', output], root));
  const paths = packed.files.map(file => file.path);
  for (const required of ['package.json', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/output.md', 'bin/assess-oss.mjs',
    'scripts/install.mjs', 'skills/assess-oss/SKILL.md', 'skills/assess-oss/LICENSE',
    'skills/assess-oss/scripts/validate.mjs']) assert.ok(paths.includes(required), required);
  for (const path of paths) {
    assert.ok(['package.json', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/output.md'].includes(path) ||
      path === 'scripts/install.mjs' || path.startsWith('bin/') ||
      path.startsWith('skills/assess-oss/'), `Unexpected published file: ${path}`);
    assert.ok(!path.split('/').some(part => part === 'AGENTS.md' || part.startsWith('.')), path);
  }
  const tarball = join(output, packed.filename);
  const prefix = join(sandbox, 'installation');
  command(npm, ['install', '--global', '--prefix', prefix, '--ignore-scripts',
    '--no-audit', '--no-fund', '--offline', tarball]);
  const executable = join(prefix, 'bin', 'assess-oss');
  assert.match(command(executable, ['--version']), /assess-oss 0.1.0/);
  assert.match(command(executable, ['--help']), /install-skill/);
  const skillRoot = join(sandbox, 'agent-home');
  command(executable, ['install-skill', '--agent', 'all', '--scope', 'global', '--target-root', skillRoot]);
  for (const relative of ['.agents/skills', '.claude/skills', '.cursor/skills', '.config/opencode/skills']) {
    await access(join(skillRoot, relative, 'assess-oss/SKILL.md'));
    assert.match(command(process.execPath, [join(skillRoot, relative, 'assess-oss/scripts/cli.mjs'), '--version']), /0.1.0/);
  }
  const installedRoot = join(prefix, 'lib/node_modules/assess-oss');
  const { run } = await import(pathToFileURL(join(installedRoot, 'skills/assess-oss/scripts/cli.mjs')).href);
  const result = await run(['compare', 'npm:tool', 'crate:tool', '--json'], { client: fixtureClient().client });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.data.projects.length, 2);
  const metadata = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.private, undefined);
  assert.equal(metadata.bin['assess-oss'], 'bin/assess-oss.mjs');
  console.log(JSON.stringify({
    package: packed.name, version: packed.version, runtime: process.version,
    files: paths, unpacked_bytes: packed.unpackedSize, shasum: packed.shasum,
    integrity: packed.integrity, tarball: values['output-dir'] ? tarball : '(temporary artifact removed after validation)',
    checks: ['file allowlist', 'offline npm installation', 'installed executable', 'all skill destinations', 'installed collector fixture comparison'],
  }, null, 2));
} finally { await rm(sandbox, { recursive: true, force: true }); }
