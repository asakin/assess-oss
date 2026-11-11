#!/usr/bin/env node
import { cp, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMain } from '../skills/assess-oss/scripts/references.mjs';

export const agents = {
  pi: { project: '.agents/skills', global: '.agents/skills' },
  'claude-code': { project: '.claude/skills', global: '.claude/skills' },
  codex: { project: '.agents/skills', global: '.agents/skills' },
  cursor: { project: '.agents/skills', global: '.cursor/skills' },
  warp: { project: '.agents/skills', global: '.agents/skills' },
  opencode: { project: '.agents/skills', global: '.config/opencode/skills' },
};
const source = fileURLToPath(new URL('../skills/assess-oss', import.meta.url));

/** Copy an entire self-contained bundle; never replace an existing installation. */
export async function install({ selected, scope = 'project', root, dryRun = false }) {
  if (!['project', 'global'].includes(scope)) throw new Error('Scope must be project or global.');
  if (!selected?.length || selected.some(a => !agents[a])) {
    throw new Error(`Select --agent from: ${Object.keys(agents).join(', ')} (or all).`);
  }
  const targetRoot = resolve(root ?? (scope === 'global' ? homedir() : process.cwd()));
  const destinations = [...new Set(selected.map(a => join(targetRoot, agents[a][scope], 'assess-oss')))];
  // Preflight all targets before writing any, including broken symlinks.
  for (const destination of destinations) {
    try {
      await lstat(destination);
      throw new Error(`Installation already exists: ${destination}. Review/remove it explicitly before reinstalling.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!dryRun) for (const destination of destinations) {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  }
  return destinations;
}

export async function runInstaller(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    agent: { type: 'string', multiple: true }, scope: { type: 'string', default: 'project' },
    'target-root': { type: 'string' }, 'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    return { text: 'Usage: assess-oss install-skill --agent all|pi|claude-code|codex|cursor|warp|opencode\n  [--agent ...] [--scope project|global] [--target-root PATH] [--dry-run]\nCopies only this skill bundle. Existing installations are never overwritten.\n', exitCode: 0 };
  }
  const selected = values.agent?.includes('all') ? Object.keys(agents) : values.agent;
  const paths = await install({ selected, scope: values.scope, root: values['target-root'], dryRun: values['dry-run'] });
  return { text: `${values['dry-run'] ? 'Would install' : 'Installed'}:\n${paths.join('\n')}\n`, exitCode: 0 };
}

if (isMain(import.meta.url)) {
  try {
    const result = await runInstaller();
    process.stdout.write(result.text);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
