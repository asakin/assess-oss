#!/usr/bin/env node
import { main, HELP } from '../skills/assess-oss/scripts/cli.mjs';
import { runInstaller } from '../scripts/install.mjs';
import { clean } from '../skills/assess-oss/scripts/render.mjs';

const args = process.argv.slice(2);
if (args[0] === 'install-skill') {
  try {
    const result = await runInstaller(args.slice(1));
    process.stdout.write(result.text);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`assess-oss: ${clean(error.message)}\n`);
    process.exitCode = 2;
  }
} else if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
  process.stdout.write(HELP.replace('node <skill>/scripts/cli.mjs', 'assess-oss') +
    '\nSkill installation: assess-oss install-skill --agent all --scope global [--dry-run]\n');
} else await main(args);
