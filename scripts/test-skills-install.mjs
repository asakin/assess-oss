import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fixtureClient } from '../test/fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const installerVersion = '1.8.1';
const { values } = parseArgs({ options: {
  'output-dir': { type: 'string' }, source: { type: 'string' },
} });
const source = values.source ?? root;
const sandbox = await mkdtemp(join(tmpdir(), 'assess-skills-install-'));
const output = values['output-dir'] ? resolve(values['output-dir']) : null;
const agentNames = ['pi', 'claude-code', 'codex', 'cursor', 'warp', 'opencode'];
const result = [];
try {
  if (output) await mkdir(output, { recursive: true });
  for (const method of ['symlink', 'copy']) {
    const project = join(sandbox, method, 'project');
    const home = join(sandbox, method, 'home');
    await mkdir(project, { recursive: true });
    await mkdir(home, { recursive: true });
    const userConfig = join(home, 'empty-npmrc');
    await writeFile(userConfig, '');
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
      npm_config_userconfig: userConfig, npm_config_cache: join(sandbox, 'npm-cache'),
      DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', NO_COLOR: '1' };
    for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN',
      'npm_config_package', 'npm_config_call']) delete env[name];
    const args = ['--yes', `--package=skills@${installerVersion}`, '--', 'skills', 'add', source,
      '--skill', 'assess-oss', ...agentNames.flatMap(name => ['--agent', name]), '--yes'];
    if (method === 'copy') args.push('--copy');
    const log = execFileSync('npx', args, { cwd: project, env, encoding: 'utf8', timeout: 120_000 });
    if (output) await writeFile(join(output, `${method}-installer.txt`), log);
    const canonical = join(project, '.agents/skills/assess-oss');
    for (const location of ['.agents/skills/assess-oss', '.claude/skills/assess-oss']) {
      const installed = join(project, location);
      assert.equal(await readFile(join(installed, 'SKILL.md'), 'utf8'),
        await readFile(join(root, 'skills/assess-oss/SKILL.md'), 'utf8'));
      for (const file of ['LICENSE', 'scripts/cli.mjs', 'scripts/collect.mjs', 'scripts/validate.mjs']) {
        await access(join(installed, file));
      }
      assert.match(execFileSync(process.execPath, [join(installed, 'scripts/cli.mjs'), '--version'],
        { cwd: home, encoding: 'utf8' }), /assess-oss 0.1.0/);
    }
    const { run } = await import(pathToFileURL(join(canonical, 'scripts/cli.mjs')).href);
    const check = await run(['compare', 'npm:tool', 'crate:tool', '--json'], { client: fixtureClient().client });
    assert.equal(check.exitCode, 0);
    assert.equal(check.result.data.projects.length, 2);
    result.push({ method, agents: agentNames, status: 'passed',
      checks: ['standard discovery', 'skill and helpers copied', 'installed script execution', 'fixture comparison'] });
  }
  const report = { installer: `skills@${installerVersion}`, runtime: process.version,
    source, isolated_user_config: true, telemetry: false, results: result };
  if (output) await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(sandbox, { recursive: true, force: true }); }
