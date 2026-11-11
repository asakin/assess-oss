import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.endsWith('-workspace') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exitCode = 1;
    } else if (entry.name.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
  }
}
await check(root);
const skill = await readFile(join(root, 'skills/assess-oss/SKILL.md'), 'utf8');
if (!skill.startsWith('---\n') || !skill.includes('\nname: assess-oss\n') ||
    !skill.includes('\ndescription: >-\n') || !skill.includes('\ncompatibility: ')) {
  throw new Error('Skill frontmatter is missing required portable metadata.');
}
const description = skill.match(/\ndescription: >-\n((?: {2}.+\n)+)/)?.[1]?.replace(/\s+/g, ' ').trim();
if (!description || description.length > 1024) throw new Error('Skill description must have 1–1024 characters.');
if (skill.split('\n').length > 500) throw new Error('Keep SKILL.md below 500 lines.');
for (const entry of await readdir(join(root, 'skills/assess-oss/scripts'))) {
  const contents = await readFile(join(root, 'skills/assess-oss/scripts', entry), 'utf8');
  if (/from\s+['"]\.\.\//.test(contents)) throw new Error(`Runtime file imports outside its bundle: ${entry}`);
}
if (!process.exitCode) console.log('Syntax and JSON checks passed.');
