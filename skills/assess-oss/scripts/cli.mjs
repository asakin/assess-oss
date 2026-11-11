#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { HttpClient } from './http.mjs';
import { UsageError, parseReference, isMain } from './references.mjs';
import { inspect, compare, search, alternatives, maintainers, profile } from './collect.mjs';
import { assess } from './jev.mjs';
import { markdown, clean } from './render.mjs';
import { withoutReadmes } from './evidence.mjs';

export const HELP = `assess-oss — source-backed OSS briefs, portfolios, and comparisons

Usage:
  node <skill>/scripts/cli.mjs <command> [references...] [options]

Commands:
  inspect <ref>                  Inspect one project or @handle
  compare <ref> <ref> [...]       Compare 2–5 projects, never people
  search <query>                 Find candidates in one ecosystem
  alternatives <ref>             Find candidate alternatives; refine with --query
  profile <@handle|profile-url>   Public portfolio and external contribution samples
  maintainers <ref>              Owner, maintainer evidence, contributor candidates

References: owner/repo, github:owner/repo, npm:package, npm:@scope/package,
            crate:name, @handle, user:handle, or public source URLs.
Bare names are intentionally ambiguous; supply an ecosystem prefix.

Options:
  --json                         Structured output (schema_version 1)
  --ecosystem github|npm|crate    Search source (default github)
  --limit N                      Search/alternatives candidates, 1–10 (default 5)
  --query TEXT                   Override alternatives search query
  --person HANDLE                Investigate a selected profile in maintainer context
                                 (repeat, at most 3; default current owner account)
  --goal TEXT                    Your intended use case
  --jev                          Experimental TypeSafe judgment: sends public docs AND goal
  --dry-run                      With --jev, show payload without calling TypeSafe
  --no-cache                     Bypass cache reads and writes
  --no-evidence                  Omit README excerpts from Markdown (still in JSON)
  --no-readme                    Omit full README text from JSON and Markdown
  --details                      Add bounded issue/PR, CI, test-file and dependency signals
  --help, -h                     Help
  --version, -V                  Version

Environment:
  GITHUB_TOKEN or GH_TOKEN        Optional GitHub API token (public data only)
  TYPESAFE_API_KEY                Required only for explicit --jev calls
  XDG_CACHE_HOME                  Cache parent (default ~/.cache; TTL 15 minutes)

Examples:
  node <skill>/scripts/cli.mjs compare npm:express npm:fastify --json
  node <skill>/scripts/cli.mjs alternatives crate:clap --query "argument parser"
  node <skill>/scripts/cli.mjs maintainers sindresorhus/slugify --person sindresorhus
  node <skill>/scripts/cli.mjs inspect npm:zod --jev --goal "validate API input" --dry-run

Exit: 0 useful result (possibly partial), 1 unavailable/assessment failed, 2 usage error.
No code from the inspected projects is downloaded or executed.
`;

export function argumentsFor(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true, strict: true,
      options: {
        json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' }, ecosystem: { type: 'string' },
        limit: { type: 'string' }, query: { type: 'string' }, person: { type: 'string', multiple: true },
        goal: { type: 'string' }, jev: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
        'no-cache': { type: 'boolean' }, 'no-evidence': { type: 'boolean' },
        'no-readme': { type: 'boolean' }, details: { type: 'boolean' },
      },
    });
  } catch (error) { throw new UsageError(error.message); }
  const { values: options, positionals } = parsed;
  const [command, ...inputs] = positionals;
  if (options.help || command === 'help') return { help: true };
  if (options.version || command === 'version') return { version: true };
  if (!command) return { help: true };
  if (!['inspect', 'compare', 'search', 'alternatives', 'profile', 'maintainers'].includes(command)) {
    throw new UsageError(`Unknown command "${command}". Run --help.`);
  }
  if (options.person) for (const person of options.person) {
    const ref = parseReference(person.startsWith('@') || person.startsWith('user:') ||
      person.startsWith('https://') ? person : `user:${person}`);
    if (ref.kind !== 'profile') throw new UsageError('--person must identify a GitHub profile.');
  }
  if (command !== 'compare' && inputs.length !== 1) throw new UsageError(`${command} requires exactly one argument; quote a multi-word query.`);
  if (command === 'compare' && (inputs.length < 2 || inputs.length > 5)) throw new UsageError('Compare 2–5 project references.');
  if (options['dry-run'] && !options.jev) throw new UsageError('--dry-run requires --jev.');
  if (options.jev && (!['inspect', 'compare'].includes(command) || !options.goal?.trim())) {
    throw new UsageError('--jev requires inspect/compare and --goal; it is not available for people.');
  }
  const limit = options.limit === undefined ? 5 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new UsageError('--limit must be an integer from 1 to 10.');
  if (options.ecosystem && command !== 'search') throw new UsageError('--ecosystem applies to search only.');
  if (options.ecosystem && !['github', 'npm', 'crate'].includes(options.ecosystem)) throw new UsageError('--ecosystem must be github, npm, or crate.');
  if (options.query && command !== 'alternatives') throw new UsageError('--query applies to alternatives only.');
  if (options.person && command !== 'maintainers') throw new UsageError('--person applies to maintainers only.');
  if (options.person?.length > 3) throw new UsageError('Select at most three --person profiles.');
  if (options.details && ['search', 'profile'].includes(command)) throw new UsageError('--details applies to project workflows only.');
  if (options.limit && !['search', 'alternatives'].includes(command)) throw new UsageError('--limit applies to search/alternatives only.');
  if (options.goal && options.goal.length > 4000) throw new UsageError('--goal must be at most 4000 characters.');
  if (command !== 'search') {
    const refs = inputs.map(parseReference);
    if (options.details && refs.some(r => r.kind === 'profile')) {
      throw new UsageError('--details applies to project evidence, not profile portfolios.');
    }
    if ((command === 'compare' || options.jev || command === 'maintainers' || command === 'alternatives') &&
        refs.some(r => r.kind === 'profile')) throw new UsageError('This workflow requires projects, not profiles.');
    if (command === 'profile' && refs[0].kind !== 'profile') throw new UsageError('Use @handle, user:handle, or a GitHub profile URL.');
  }
  return { command, inputs, options, limit };
}

export async function run(args, { client, fetcher, key } = {}) {
  const parsed = argumentsFor(args);
  if (parsed.help) return { text: HELP, exitCode: 0 };
  if (parsed.version) return { text: 'assess-oss 0.1.0\n', exitCode: 0 };
  const { command, inputs, options, limit } = parsed;
  client ??= new HttpClient({ noCache: options['no-cache'] });
  const collection = { details: options.details };
  let data;
  if (command === 'inspect') data = await inspect(client, inputs[0], collection);
  if (command === 'compare') data = await compare(client, inputs, collection);
  if (command === 'search') data = await search(client, inputs[0], { ecosystem: options.ecosystem, limit });
  if (command === 'alternatives') data = await alternatives(client, inputs[0], { query: options.query, limit, ...collection });
  if (command === 'profile') data = await profile(client, parseReference(inputs[0]).id);
  if (command === 'maintainers') data = await maintainers(client, inputs[0], { people: options.person, ...collection });
  if (options.jev) {
    const projects = data.kind === 'comparison' ? data.projects : [data];
    for (const p of projects) p.assessment = await assess(p, options.goal, { dryRun: options['dry-run'], fetcher, key });
  }
  if (options['no-readme']) data = withoutReadmes(data);
  const result = { schema_version: 1, generated_at: new Date().toISOString(), goal: options.goal ?? null, data };
  const projects = data.projects ?? [data.project ?? data];
  const failed = data.status === 'unavailable' || projects.every(p => p.status === 'unavailable');
  const assessmentFailed = projects.some(p => p.assessment?.status === 'unavailable');
  return {
    result, exitCode: failed || assessmentFailed ? 1 : 0,
    text: options.json ? JSON.stringify(result, null, 2) + '\n'
      : markdown(result, { evidence: !options['no-evidence'] }),
  };
}

export async function main(args = process.argv.slice(2)) {
  process.stdout.on('error', error => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
  try {
    const result = await run(args);
    process.stdout.write(result.text);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`assess-oss: ${clean(error.message)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

if (isMain(import.meta.url)) await main();
