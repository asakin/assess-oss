import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpClient } from '../skills/assess-oss/scripts/http.mjs';
import { run } from '../skills/assess-oss/scripts/cli.mjs';
import { markdown } from '../skills/assess-oss/scripts/render.mjs';
import { fixtureClient, fixtureResponse, repo } from './fixtures.mjs';

test('valid project names cannot select the schema for an API subresource', async () => {
  for (const name of ['readme', 'languages', 'contributors', 'pulls']) {
    const { result, exitCode } = await run(['inspect', `alice/${name}`, '--details'], { client: fixtureClient().client });
    assert.equal(exitCode, 0);
    assert.equal(result.data.id, `alice/${name}`);
    assert.equal(result.data.stars, 42);
    assert.ok(result.data.readme.text.includes('Maintained by'));
    assert.equal(result.data.quality.open_pull_requests, 1);
    assert.deepEqual(result.data.warnings, []);
  }
  for (const ref of ['npm:latest', 'crate:dependencies']) {
    const { result, exitCode } = await run(['inspect', ref, '--details'], { client: fixtureClient().client });
    assert.equal(exitCode, 0);
    assert.ok(result.data.first_published_at);
    assert.equal(result.data.version, '1.0.0');
    assert.ok(result.data.repository.readme.text);
  }
});

test('renames follow redirects, enrich the canonical repository, and retain evidence through cache and Markdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assess-redirects-'));
  const old = 'https://api.github.com/repos/old/tool';
  const middle = 'https://api.github.com/repositories/123';
  const canonical = 'https://api.github.com/repos/alice/tool';
  const calls = [];
  const client = new HttpClient({ cacheDir: dir, token: '', fetcher: async (url) => {
    calls.push(url);
    if (url === old) return new Response(null, { status: 301, headers: { location: '/repositories/123' } });
    if (url === middle) return new Response(null, { status: 308, headers: { location: canonical } });
    return Response.json(fixtureResponse(url));
  } });
  try {
    const first = await run(['inspect', 'old/tool'], { client });
    assert.equal(first.exitCode, 0);
    assert.equal(first.result.data.id, 'alice/tool');
    assert.equal(first.result.data.requested_id, 'old/tool');
    assert.ok(first.result.data.readme.text);
    assert.ok(calls.includes(`${canonical}/readme`));
    assert.ok(!calls.includes(`${old}/readme`));
    assert.match(first.text, /Repository moved or renamed: old\/tool -> alice\/tool/);
    assert.match(first.text, /HTTP 301 redirect/);
    const source = first.result.data.sources.find(s => s.fields.includes('identity'));
    assert.equal(source.final_url, canonical);
    assert.deepEqual(source.redirects, [
      { from: old, to: middle, status: 301 }, { from: middle, to: canonical, status: 308 },
    ]);
    const sent = calls.length;
    const cached = await run(['inspect', 'old/tool', '--json'], { client });
    assert.equal(calls.length, sent);
    const evidence = cached.result.data.sources.find(s => s.fields.includes('identity'));
    assert.equal(evidence.cached, true);
    assert.deepEqual(evidence.redirects, source.redirects);
    assert.equal(evidence.observed_at, source.observed_at);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('temporary routing redirects are visible without falsely claiming a rename', async () => {
  const client = fixtureClient(url => {
    if (url === 'https://api.github.com/repos/alice/tool') {
      return new Response(null, { status: 302, headers: { location: '/repositories/123' } });
    }
    if (url === 'https://api.github.com/repositories/123') return repo;
  }).client;
  const result = await run(['inspect', 'alice/tool'], { client });
  assert.match(result.text, /HTTP 302 redirect/);
  assert.doesNotMatch(result.text, /moved or renamed/);
});

test('redirects cannot leak credentials, escape supported hosts, loop forever, or bypass response checks', async () => {
  const start = 'https://api.github.com/repos/alice/tool';
  const registry = 'https://registry.npmjs.org/tool';
  const calls = [];
  const crossOrigin = new HttpClient({ noCache: true, token: 'fixture-token', fetcher: async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    if (url === start) return new Response(null, { status: 301, headers: { location: registry } });
    if (url === registry) return new Response(null, { status: 302, headers: { location: `${start}/languages` } });
    return Response.json({ Rust: 100 });
  } });
  await crossOrigin.get(start);
  assert.equal(calls[0].authorization, 'Bearer fixture-token');
  assert.equal(calls[1].authorization, undefined);
  assert.equal(calls[2].authorization, undefined);
  for (const location of ['https://evil.test/data', 'http://api.github.com/data',
    'https://secret@api.github.com/data', 'https://api.github.com:444/data', start]) {
    let requests = 0;
    const client = new HttpClient({ noCache: true, token: '', fetcher: async () => {
      requests++;
      return new Response(null, { status: 301, headers: { location } });
    } });
    await assert.rejects(client.get(start), /Refusing|Redirect loop/);
    assert.equal(requests, 1);
  }
  for (const [body, options, error] of [[{ private: true }, {}, /public repositories/],
    [{ content: 'x'.repeat(100) }, { maxBytes: 10 }, /exceeds/]]) {
    const client = new HttpClient({ noCache: true, token: '', fetcher: async url => url === start
      ? new Response(null, { status: 307, headers: { location: '/repositories/123' } }) : Response.json(body) });
    await assert.rejects(client.get(start, options), error);
  }
});

test('npm maintainers, publication, and downloads survive absent or failing GitHub enrichment', async () => {
  for (const repository of ['https://gitlab.com/alice/tool', 'https://github.com/alice/tool']) {
    const client = fixtureClient(url => {
      if (url === 'https://registry.npmjs.org/tool/latest') return { ...fixtureResponse(url), repository };
      if (url === 'https://api.github.com/repos/alice/tool') return new Response(null, { status: 503 });
    }).client;
    const r = await run(['maintainers', 'npm:tool', '--person', 'alice'], { client });
    assert.equal(r.exitCode, 0);
    assert.equal(r.result.data.package_maintainers[0].name, 'registry-name');
    assert.equal(r.result.data.project.downloads.count, 100);
    assert.ok(r.result.data.project.first_published_at);
    assert.equal(r.result.data.profiles[0].id, 'alice');
    assert.match(r.text, /registry-name/);
  }
});

test('npm sources and GitHub evidence remain usable when a neighboring source fails', async () => {
  const failedVersion = fixtureClient(url => {
    if (url === 'https://registry.npmjs.org/tool/latest') return new Response(null, { status: 503 });
    if (url === 'https://registry.npmjs.org/tool') return {
      ...fixtureResponse(url), repository: 'https://github.com/alice/tool', maintainers: [{ name: 'current-owner' }],
    };
  }).client;
  const r = await run(['inspect', 'npm:tool'], { client: failedVersion });
  assert.equal(r.exitCode, 0);
  assert.equal(r.result.data.version, null);
  assert.equal(r.result.data.dependencies, null);
  assert.equal(r.result.data.downloads.count, 100);
  assert.equal(r.result.data.declared_maintainers[0].name, 'current-owner');
  assert.equal(r.result.data.repository.stars, 42);
  assert.match(r.result.data.warnings.join(' '), /503/);

  const failedRegistry = fixtureClient(url => {
    if (url === 'https://api.github.com/repos/alice/tool') return { ...repo, homepage: 'https://www.npmjs.com/package/tool' };
    if (new URL(url).hostname === 'registry.npmjs.org') return new Response(null, { status: 503 });
  }).client;
  const g = await run(['inspect', 'alice/tool'], { client: failedRegistry });
  assert.equal(g.exitCode, 0);
  assert.equal(g.result.data.stars, 42);
  assert.deepEqual(g.result.data.packages, []);
  const hint = g.result.data.package_hints[0];
  assert.equal(hint.evidence.status, 'unavailable');
  assert.equal(hint.evidence.downloads.count, 100);
  assert.match(g.text, /Unverified homepage package/);
  assert.match(g.text, /503/);
});

test('large npm history does not discard publication dates and current maintainers', async () => {
  const client = fixtureClient(url => url === 'https://registry.npmjs.org/tool' ? {
    ...fixtureResponse(url), maintainers: [{ name: 'current-owner' }], versions: { historical: 'x'.repeat(8_100_000) },
  } : undefined).client;
  const r = await run(['inspect', 'npm:tool'], { client });
  assert.equal(r.exitCode, 0);
  assert.equal(r.result.data.first_published_at, '2026-09-01T00:00:00Z');
  assert.equal(r.result.data.declared_maintainers[0].name, 'current-owner');
  assert.equal(r.result.data.readme.text, 'A package README');
  assert.ok(!r.result.data.warnings.some(w => /exceeds/.test(w)));
});

function nameClient({ same = false, forksOnly = false, fail = false, empty = false } = {}) {
  const popular = { ...repo, stargazers_count: 100, pushed_at: '2024-01-01T00:00:00Z', fork: forksOnly };
  const active = { ...repo, full_name: 'bob/tool', html_url: 'https://github.com/bob/tool',
    stargazers_count: 10, pushed_at: '2026-11-01T00:00:00Z', fork: forksOnly };
  return fixtureClient(url => {
    const u = new URL(url);
    if (u.pathname === '/search/repositories') {
      if (fail) return new Response(null, { status: 503 });
      if (empty || (forksOnly && u.searchParams.get('q').includes('fork:false'))) {
        return { items: [], total_count: 0, incomplete_results: false };
      }
      const match = same || u.searchParams.get('sort') === 'stars' ? popular : active;
      return { items: [
        { ...repo, full_name: 'forker/tool', fork: !forksOnly, stargazers_count: 9000 },
        { ...repo, full_name: 'someone/tool-extra', stargazers_count: 99000 }, match,
      ], total_count: 3, incomplete_results: false };
    }
    if (u.pathname === '/repos/alice/tool') return popular;
    if (u.pathname === '/repos/bob/tool') return active;
    const related = new Map([
      ['/repos/bob/tool/languages', '/repos/alice/tool/languages'],
      ['/repos/bob/tool/releases/latest', '/repos/alice/tool/releases/latest'],
      ['/repos/bob/tool/contributors', '/repos/alice/tool/contributors'],
      ['/repos/bob/tool/readme', '/repos/alice/tool/readme'],
    ]);
    if (related.has(u.pathname)) return fixtureResponse(`https://api.github.com${related.get(u.pathname)}`);
  });
}

test('a bare name returns distinct popular and active originals and visibly discloses inference', async () => {
  const r = await run(['inspect', 'tool'], { client: nameClient().client });
  assert.equal(r.exitCode, 0);
  assert.equal(r.result.data.inferred, true);
  assert.deepEqual(r.result.data.candidates.map(c => [c.id, c.selected_by]), [
    ['alice/tool', ['most_starred']], ['bob/tool', ['most_active']],
  ]);
  assert.deepEqual(r.result.data.results.map(p => p.id), ['alice/tool', 'bob/tool']);
  assert.match(r.text, /identity was inferred/);
  assert.match(r.text, /alice\/tool/);
  assert.match(r.text, /bob\/tool/);
  assert.match(r.text, /owner\/repo or a URL/);
});

test('the same original is collected once when it wins both name selections', async () => {
  const { client, calls } = nameClient({ same: true });
  const r = await run(['inspect', 'tool', '--jev', '--goal', 'parse arguments', '--dry-run', '--json'], { client });
  assert.equal(r.result.data.candidates.length, 1);
  assert.deepEqual(r.result.data.candidates[0].selected_by, ['most_starred', 'most_active']);
  assert.equal(calls.filter(c => c.url === 'https://api.github.com/repos/alice/tool').length, 1);
  assert.equal(r.result.data.results[0].assessment.sent, false);
  assert.equal(r.result.data.inferred, true);
});

test('name resolution works for comparisons, maintainer lookup, and alternatives', async () => {
  for (const args of [['compare', 'tool', 'npm:tool'], ['maintainers', 'tool'], ['alternatives', 'tool', '--query', 'parser']]) {
    const r = await run(args, { client: nameClient({ same: true }).client });
    assert.equal(r.exitCode, 0);
    assert.match(r.text, /identity was inferred/);
    if (args[0] === 'compare') {
      assert.deepEqual(r.result.data.projects.map(p => p.kind), ['github', 'npm']);
      assert.equal(r.result.data.resolutions[0].id, 'tool');
    } else assert.equal(r.result.data.results[0].kind, args[0]);
  }
});

test('failed or empty name searches return helpful unavailable evidence rather than usage errors', async () => {
  for (const options of [{ empty: true }, { fail: true }]) {
    const { client, calls } = nameClient(options);
    const r = await run(['inspect', 'tool'], { client });
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.result.data.results, []);
    assert.match(r.text, /owner\/repo would help/);
    if (options.fail) assert.ok(!calls.some(c => c.url.includes('fork%3Aonly')));
  }
});

test('forks are an explicit fallback only after an empty original search', async () => {
  const r = await run(['inspect', 'tool'], { client: nameClient({ forksOnly: true, same: true }).client });
  assert.equal(r.exitCode, 0);
  assert.ok(r.result.data.candidates.every(c => c.is_fork));
  assert.match(markdown(r.result), /these candidates are forks/);
});
