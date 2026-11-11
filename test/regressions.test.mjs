import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureClient, fixtureResponse } from './fixtures.mjs';
import { inspect, compare, search, profile } from '../skills/assess-oss/scripts/collect.mjs';
import { markdown } from '../skills/assess-oss/scripts/render.mjs';
import { parseReference, UsageError } from '../skills/assess-oss/scripts/references.mjs';
import { run } from '../skills/assess-oss/scripts/cli.mjs';

test('package publication stays unknown independently of repository releases', async () => {
  for (const kind of ['npm', 'crate']) {
    const { client } = fixtureClient(url => {
      const { hostname, pathname } = new URL(url);
      if (hostname === 'registry.npmjs.org' && !pathname.endsWith('/latest')) return { readme: 'Docs without publication time' };
      if (hostname === 'crates.io') return { ...fixtureResponse(url), versions: [] };
    });
    const project = await inspect(client, `${kind}:tool`);
    assert.equal(project.published_at, null);
    assert.ok(project.repository.release.published_at);
    const report = markdown(project, { evidence: false });
    assert.match(report, /Package version: 1\.0\.0; published: unknown/);
    assert.match(report, /Repository release: v1\.0\.0; published: 2026-10-01/);
    assert.equal(JSON.parse(JSON.stringify(project)).published_at, null);
  }
});

test('package and repository publication dates retain distinct provenance in monorepos', async () => {
  const project = await inspect(fixtureClient().client, 'npm:tool');
  const report = markdown(project, { evidence: false });
  assert.match(report, /Package version: 1\.0\.0; published: 2026-09-01/);
  assert.match(report, /Repository release: v1\.0\.0; published: 2026-10-01/);
  assert.equal(project.repository_directory, 'packages/tool');
});

test('degenerate identities and malformed URLs fail as usage errors before requests', async () => {
  const { client, calls } = fixtureClient();
  for (const ref of ['alice/.git', 'alice/..git', 'alice/...git', 'npm:.', 'npm:..',
    'https://github.com/%ZZ/tool', 'https://[invalid']) {
    assert.throws(() => parseReference(ref), UsageError);
    await assert.rejects(run(['inspect', ref], { client }), UsageError);
  }
  assert.equal(calls.length, 0);
});

test('valid but malformed upstream JSON becomes unavailable rather than crashing', async () => {
  for (const ref of ['alice/tool', 'npm:tool', 'crate:tool', '@alice']) {
    const result = await inspect(fixtureClient(() => ({})).client, ref);
    assert.equal(result.status, 'unavailable');
    assert.match(result.warnings.join(' '), /Unexpected response shape/);
  }
});

test('malformed enrichment preserves primary package evidence and useful comparisons', async () => {
  const client = fixtureClient(url => new URL(url).pathname === '/repos/alice/tool' ? {} : undefined).client;
  const packageBrief = await inspect(client, 'npm:tool');
  assert.equal(packageBrief.status, 'ok');
  assert.equal(packageBrief.repository.status, 'unavailable');
  const comparison = await compare(client, ['alice/tool', 'npm:tool']);
  assert.equal(comparison.projects[0].status, 'unavailable');
  assert.equal(comparison.projects[1].status, 'ok');
});

test('malformed search and profile subresults are warnings, not false empty successes', async () => {
  for (const ecosystem of ['github', 'npm', 'crate']) {
    const result = await search(fixtureClient(() => ({ items: 'bad' })).client, 'parser', { ecosystem });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.candidates.length, 0);
    assert.match(result.warnings.join(' '), /Unexpected response shape/);
  }
  const client = fixtureClient(url => url.includes('/search/') ? { items: 'bad' } : undefined).client;
  const result = await profile(client, 'alice');
  assert.equal(result.status, 'ok');
  assert.equal(result.selection.incomplete, null);
});

test('malformed optional arrays and language maps do not escape partial-result handling', async () => {
  const cases = [
    ['/contributors', [{ login: null }]],
    ['/languages', { Rust: 'a lot' }],
    ['/readme', { encoding: 'base64', content: 42 }],
  ];
  for (const [suffix, value] of cases) {
    const client = fixtureClient(url => new URL(url).pathname.endsWith(suffix) ? value : undefined).client;
    const result = await inspect(client, 'alice/tool');
    assert.equal(result.status, 'ok');
    assert.match(result.warnings.join(' '), /Unexpected response shape/);
  }
});
