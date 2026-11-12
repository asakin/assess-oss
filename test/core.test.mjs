import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReference, repositoryLink, UsageError } from '../skills/assess-oss/scripts/references.mjs';
import { HttpClient } from '../skills/assess-oss/scripts/http.mjs';
import { inspect, compare, search, alternatives, profile, maintainers, readmeEvidence } from '../skills/assess-oss/scripts/collect.mjs';
import { run, argumentsFor } from '../skills/assess-oss/scripts/cli.mjs';
import { assess, payload, interpret } from '../skills/assess-oss/scripts/jev.mjs';
import { clean, markdown } from '../skills/assess-oss/scripts/render.mjs';
import { fixtureClient, repo, user, answers } from './fixtures.mjs';

test('references: supported URLs, scoped names, explicit identities', () => {
  for (const input of ['npm:@scope/tool', 'https://www.npmjs.com/package/@scope/tool']) {
    assert.deepEqual(parseReference(input), { kind: 'npm', id: '@scope/tool' });
  }
  assert.deepEqual(parseReference('https://github.com/Alice/tool.git/tree/main'), { kind: 'github', id: 'alice/tool' });
  assert.deepEqual(parseReference('@Alice'), { kind: 'profile', id: 'alice' });
  assert.deepEqual(parseReference('https://github.com/alice'), { kind: 'profile', id: 'alice' });
  assert.deepEqual(parseReference('https://crates.io/crates/clap'), { kind: 'crate', id: 'clap' });
  for (const input of ['bad name!', 'http://github.com/alice/tool', 'https://evil.test/alice/tool',
    'https://token@github.com/alice/tool', 'npm:../../etc', 'https://github.com:444/alice/tool']) {
    assert.throws(() => parseReference(input), UsageError);
  }
});

test('repository links preserve monorepo identity and reject other hosts', () => {
  for (const url of ['git+https://github.com/alice/tool.git', 'git@github.com:alice/tool.git',
    'ssh://git@github.com/alice/tool.git', 'github:alice/tool', 'alice/tool']) {
    assert.equal(repositoryLink({ url, directory: 'packages/tool' }).directory, 'packages/tool');
    assert.equal(repositoryLink(url).id, 'alice/tool');
  }
  assert.equal(repositoryLink('https://gitlab.com/alice/tool'), null);
});

test('GitHub brief preserves sources and labels contributor samples, README evidence', async () => {
  const { client } = fixtureClient();
  const record = await inspect(client, 'alice/tool');
  assert.equal(record.stars, 42);
  assert.equal(record.contributors.sampled, 1);
  assert.equal(record.contributors.total, null);
  assert.equal(record.supported_platforms, null);
  assert.equal(record.readme.untrusted, true);
  assert.ok(record.sources.some(s => s.fields.includes('identity')));
  assert.ok(record.sources.some(s => s.fields.includes('readme')));
  assert.ok(record.sources.every(s => s.url.startsWith('https:') && s.observed_at));
  assert.equal(readmeEvidence('x'.repeat(20), 'https://example.com', 5).text.length, 5);
  assert.equal(readmeEvidence('x'.repeat(20), 'https://example.com', 5).truncated, true);
});

test('npm keeps download windows, registry maintainers and monorepo boundaries', async () => {
  const { client } = fixtureClient();
  const record = await inspect(client, 'npm:@scope/tool');
  assert.equal(record.id, '@scope/tool');
  assert.equal(record.downloads.start, '2026-10-01');
  assert.equal(record.published_at, '2026-09-01T00:00:00Z');
  assert.equal(record.repository_directory, 'packages/tool');
  assert.equal(record.repository.id, 'alice/tool');
  assert.deepEqual(record.declared_maintainers, [{ name: 'registry-name' }]);
  assert.ok(record.warnings.some(w => /whole repository/.test(w)));
});

test('crate stable version and license align; popularity units stay source-specific', async () => {
  const { client } = fixtureClient();
  const record = await inspect(client, 'crate:tool');
  assert.equal(record.version, '1.0.0');
  assert.equal(record.license, 'MIT');
  assert.match(record.downloads.metric, /lifetime/);
  assert.equal(record.downloads.recent_count, 100);
});

test('source failures preserve usable facts; not found is not zero', async () => {
  const { client } = fixtureClient(url => url.endsWith('/languages') ? new Response('', { status: 403 }) : undefined);
  const record = await inspect(client, 'alice/tool');
  assert.equal(record.status, 'ok');
  assert.equal(record.languages, null);
  assert.match(record.warnings.join(' '), /HTTP 403/);
  const missing = fixtureClient(() => new Response('', { status: 404 })).client;
  assert.equal((await inspect(missing, 'alice/missing')).status, 'unavailable');
});

test('project comparison rejects people before doing I/O', async () => {
  const { client, calls } = fixtureClient();
  await assert.rejects(compare(client, ['@alice', '@bob']), UsageError);
  assert.equal(calls.length, 0);
  assert.equal((await compare(client, ['alice/tool', 'npm:tool'])).projects.length, 2);
});

test('search covers all sources, alternatives exclude the seed', async () => {
  const { client } = fixtureClient();
  for (const ecosystem of ['github', 'npm', 'crate']) {
    const found = await search(client, 'parser', { ecosystem, limit: 2 });
    assert.ok(found.candidates.length);
    assert.equal(found.status, 'ok');
  }
  const found = await alternatives(client, 'alice/tool', { query: 'parser', limit: 2 });
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].id, 'alice/other');
  await assert.rejects(alternatives(client, '@alice'), UsageError);
});

test('profiles highlight owned originals, preserve incomplete coverage and unknown PR merge status', async () => {
  const { client } = fixtureClient(url => {
    if (new URL(url).pathname === '/search/repositories') return {
      items: [repo, { ...repo, fork: true }], incomplete_results: true, total_count: 300,
    };
  });
  const record = await profile(client, 'alice');
  assert.equal(record.notable_repositories.length, 1);
  assert.equal(record.selection.incomplete, true);
  assert.equal(record.external_contributions[0].merged, null);
  assert.equal(record.external_contributions[0].repository, 'bob/parser');
  assert.equal(record.external_contributions.length, 2);
  assert.equal(record.recent_external_activity.length, 1);
  assert.equal(record.recent_external_activity[0].type, 'PushEvent');
  assert.equal('score' in record, false);
});

test('organizations remain organizations; not personal contribution histories', async () => {
  const { client, calls } = fixtureClient(url => new URL(url).pathname.startsWith('/users/')
    ? { ...user, type: 'Organization' } : undefined);
  const record = await profile(client, 'alice');
  assert.equal(record.account_type, 'Organization');
  assert.equal(calls.filter(c => c.url.includes('/search/issues')).length, 0);
});

test('maintainer lookup distinguishes owner, creator and contributor', async () => {
  const { client } = fixtureClient();
  const record = await maintainers(client, 'npm:tool');
  assert.equal(record.creator, null);
  assert.equal(record.owner.login, 'alice');
  assert.match(record.contributor_candidates[0].relationship, /administrative control/);
  assert.ok(record.documented_maintainer_evidence[0].url);
  assert.equal(record.profiles.length, 1);
  assert.equal(record.package_maintainers[0].name, 'registry-name');
  await assert.rejects(maintainers(client, 'alice/tool', { people: ['a', 'b', 'c', 'd'] }), UsageError);
});

test('HTTP client sends credentials only to GitHub and refuses arbitrary hosts', async () => {
  const calls = [];
  const client = new HttpClient({ noCache: true, token: 'test-only-placeholder', fetcher: async (url, options) => {
    calls.push({ url, options });
    return Response.json({});
  } });
  await client.get('https://api.github.com/users/alice');
  await client.get('https://registry.npmjs.org/tool');
  assert.ok(calls[0].options.headers.Authorization);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  await assert.rejects(client.get('https://localhost/foo'), /Refusing/);
  await assert.rejects(client.get('http://api.github.com/users/alice'), /Refusing/);
});

test('cache retains observation time, expires, and no-cache bypasses reads/writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assess-cache-test-'));
  let time = Date.now();
  let count = 0;
  const client = new HttpClient({ cacheDir: dir, ttl: 1000, now: () => time,
    fetcher: async () => { count++; return Response.json({ ok: true }); } });
  try {
    const first = await client.get('https://api.github.com/users/alice');
    const second = await client.get('https://api.github.com/users/alice');
    assert.equal(count, 1);
    assert.equal(second.source.cached, true);
    assert.equal(first.source.observed_at, second.source.observed_at);
    time += 1001;
    await client.get('https://api.github.com/users/alice');
    assert.equal(count, 2);
    client.noCache = true;
    await client.get('https://api.github.com/users/alice');
    assert.equal(count, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('crates requests are paced, concurrency is bounded', async () => {
  let time = 0;
  const starts = [];
  let active = 0;
  let peak = 0;
  const client = new HttpClient({ noCache: true, concurrency: 2, now: () => time,
    sleep: async ms => { time += ms; },
    fetcher: async () => {
      starts.push(time); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--; return Response.json({});
    } });
  await Promise.all([1, 2, 3].map(i => client.get(`https://crates.io/api/v1/crates/tool${i}`)));
  assert.ok(peak <= 2);
  assert.ok(starts[1] - starts[0] >= 1000);
  assert.ok(starts[2] - starts[1] >= 1000);
});

test('HTTP response byte limits, private repo and rate-limit errors are explicit', async () => {
  const huge = new HttpClient({ noCache: true, fetcher: async () => Response.json({ text: 'x'.repeat(100) }) });
  await assert.rejects(huge.get('https://api.github.com/users/alice', { maxBytes: 10 }), /exceeds/);
  const privateRepo = new HttpClient({ noCache: true, fetcher: async () => Response.json({ private: true }) });
  await assert.rejects(privateRepo.get('https://api.github.com/repos/alice/tool'), /public/);
  const limited = new HttpClient({ noCache: true, fetcher: async () => new Response('', { status: 429, headers: { 'retry-after': '10' } }) });
  await assert.rejects(limited.get('https://api.github.com/users/alice'), /retry after 10/);
});

test('network and malformed upstream bodies produce source errors, not stack traces', async () => {
  const timeout = new HttpClient({ noCache: true, fetcher: async () => { throw new Error('network detail'); } });
  await assert.rejects(timeout.get('https://api.github.com/users/alice'), /failed or timed out/);
  const invalid = new HttpClient({ noCache: true, fetcher: async () => new Response('not-json') });
  await assert.rejects(invalid.get('https://api.github.com/users/alice'), /Invalid JSON/);
  const privateSearch = new HttpClient({ noCache: true, fetcher: async () => Response.json({ items: [{ private: true }] }) });
  await assert.rejects(privateSearch.get('https://api.github.com/search/repositories?q=private'), /public/);
});

test('failed profile search reports unknown completeness, not a clean empty history', async () => {
  const { client } = fixtureClient(url => url.includes('/search/issues')
    ? new Response('', { status: 403 }) : undefined);
  const record = await profile(client, 'alice');
  assert.equal(record.selection.incomplete, null);
  assert.equal(record.selection.external_pr_matches, null);
  assert.match(record.warnings.join(' '), /HTTP 403/);
});

test('Jev dry-run never sends; optional missing-key and failures are not negative judgments', async () => {
  const { client } = fixtureClient();
  const project = await inspect(client, 'alice/tool');
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ model: 'jev-1.14.0', answers }); };
  const dry = await assess(project, 'parse arguments', { dryRun: true, fetcher });
  assert.equal(dry.sent, false);
  assert.equal(calls, 0);
  assert.equal(payload(project, 'parse arguments').questions.documented_fit.type, 'score');
  assert.equal((await assess(project, 'parse arguments', { key: '' })).status, 'unavailable');
  const judged = await assess(project, 'parse arguments', { key: 'test-only-placeholder', fetcher });
  assert.equal(judged.interpretation, 'evidence_available');
  assert.equal(calls, 1);
  assert.equal(interpret({ ...answers, evidence_sufficient: { noul: 0.5 } }), 'uncertain_evidence');
  assert.throws(() => interpret({}), /contract/);
  assert.throws(() => payload({ kind: 'profile' }, 'goal'), UsageError);
  const bad = await assess(project, 'parse arguments', { key: 'test-only-placeholder', fetcher: async () => Response.json({}) });
  assert.equal(bad.status, 'unavailable');
});

test('CLI contracts, invalid flags, machine output and terminal sanitization', async () => {
  const { client } = fixtureClient();
  const result = await run(['compare', 'alice/tool', 'npm:tool', '--json'], { client });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.text).schema_version, 1);
  assert.equal(result.result.data.kind, 'comparison');
  for (const args of [['inspect', 'bad name!'], ['compare', '@alice', '@bob'],
    ['search', 'foo', '--limit', 'NaN'], ['inspect', 'alice/tool', '--dry-run'],
    ['profile', '@alice', '--jev', '--goal', 'good'], ['wat'], ['--typo']]) {
    assert.throws(() => argumentsFor(args), UsageError);
  }
  assert.match((await run(['--help'])).text, /Usage:/);
  assert.equal(clean('\x1b[31mred\x1b[0m\x07'), 'red');
  assert.match(markdown(result.result, { evidence: false }), /Downloads \(source-specific\)/);
  const unavailable = await run(['inspect', 'alice/missing', '--json'], {
    client: fixtureClient(() => new Response('', { status: 404 })).client,
  });
  assert.equal(unavailable.exitCode, 1);
});
