import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureClient, fixtureResponse, repo } from './fixtures.mjs';
import { inspect, maintainers } from '../skills/assess-oss/scripts/collect.mjs';
import { run, argumentsFor } from '../skills/assess-oss/scripts/cli.mjs';
import { downloadAge, npmHomepage } from '../skills/assess-oss/scripts/evidence.mjs';

function linkedClient(override) {
  return fixtureClient(url => {
    const custom = override?.(url);
    if (custom !== undefined) return custom;
    if (new URL(url).pathname === '/repos/alice/tool') {
      return { ...repo, homepage: 'https://www.npmjs.com/package/tool' };
    }
  });
}

test('explicit npm homepage yields one verified package without recursive repository content', async () => {
  const { client, calls } = linkedClient();
  const result = await inspect(client, 'alice/tool');
  assert.equal(result.package_hints[0].id, 'tool');
  assert.equal(result.packages[0].downloads.count, 100);
  assert.equal(result.packages[0].repository, undefined);
  assert.equal(result.packages[0].readme, null);
  assert.equal(calls.filter(c => new URL(c.url).pathname === '/repos/alice/tool').length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/tool/latest')).length, 1);
});

test('scoped npm homepages parse correctly; arbitrary homepages are not guessed', () => {
  assert.deepEqual(npmHomepage('https://www.npmjs.com/package/@scope/tool'), { kind: 'npm', id: '@scope/tool' });
  assert.equal(npmHomepage('https://example.com/tool'), null);
  assert.equal(npmHomepage('http://npmjs.com/package/tool'), null);
});

test('mismatched or unavailable registry backlinks remain hints, not associated packages', async () => {
  for (const unavailable of [false, true]) {
    const { client } = linkedClient(url => {
      if (!url.endsWith('/tool/latest')) return undefined;
      return unavailable ? new Response('', { status: 404 }) : {
        ...fixtureResponse(url), repository: 'https://github.com/another/project',
      };
    });
    const result = await inspect(client, 'alice/tool');
    assert.equal(result.packages.length, 0);
    assert.equal(result.package_hints[0].id, 'tool');
    assert.match(result.warnings.join(' '), /could not be verified/);
  }
});

test('maintainers is the combined workflow and uses current linked package maintainer identities', async () => {
  const { client, calls } = linkedClient(url => {
    if (url === 'https://registry.npmjs.org/tool') {
      return { ...fixtureResponse(url), maintainers: [{ name: 'current-registry-owner' }] };
    }
  });
  const result = await maintainers(client, 'alice/tool', { people: ['alice'] });
  assert.equal(result.project.id, 'alice/tool');
  assert.equal(result.profiles[0].id, 'alice');
  assert.equal(result.package_maintainers[0].name, 'current-registry-owner');
  assert.equal(result.package_maintainers[0].package, 'tool');
  assert.notEqual(result.package_maintainers[0].name, result.owner.login);
  assert.equal(calls.filter(c => new URL(c.url).pathname === '/users/alice').length, 1);
});

test('personal ownership is an admin fact; sole-owner authorship is explicitly an inference', async () => {
  const result = await inspect(fixtureClient().client, 'alice/tool');
  assert.equal(result.owner.administrative_control, true);
  assert.equal(result.owner.role, 'repository_owner');
  assert.match(result.contributors.people[0].relationship, /administrative control/);
  assert.equal(result.creator_inference.status, 'inferred');
  assert.equal(result.creator_inference.candidate, 'alice');
  assert.ok(result.creator_inference.sources[1].includes('anon=true'));
  assert.match(result.creator_inference.limitations, /Transfers/);
});

test('forks, organizations, anonymous contributors, and incomplete lists do not get creator inferences', async () => {
  const variants = [
    url => new URL(url).pathname === '/repos/alice/tool' ? { ...repo, fork: true } : undefined,
    url => new URL(url).pathname === '/repos/alice/tool'
      ? { ...repo, owner: { ...repo.owner, type: 'Organization' } } : undefined,
    url => new URL(url).pathname.endsWith('/contributors')
      ? [...fixtureResponse(url), { type: 'Anonymous', contributions: 1 }] : undefined,
    url => new URL(url).pathname.endsWith('/contributors')
      ? Response.json(fixtureResponse(url), { headers: { link: '<https://api.github.com/repos/alice/tool/contributors?page=2>; rel="next"' } }) : undefined,
  ];
  for (const override of variants) {
    const result = await inspect(fixtureClient(override).client, 'alice/tool');
    assert.equal(result.creator_inference, null);
  }
});

test('publication fields distinguish registry creation, earliest version, and selected version', async () => {
  const { client } = fixtureClient(url => url === 'https://registry.npmjs.org/tool' ? {
    time: { created: '2026-10-01T00:00:00Z', modified: '2026-11-01T00:00:00Z',
      '0.1.0': '2026-10-15T12:00:00Z', '1.0.0': '2026-10-20T12:00:00Z' },
  } : undefined);
  const result = await inspect(client, 'npm:tool');
  assert.equal(result.registry_created_at, '2026-10-01T00:00:00Z');
  assert.equal(result.first_published_at, '2026-10-15T12:00:00Z');
  assert.equal(result.version_published_at, '2026-10-20T12:00:00Z');
  assert.equal(result.published_at, result.version_published_at);
  assert.match(result.published_at_scope, /selected_version/);
  assert.equal(result.downloads.days_since_publication_in_window, 16);
  assert.equal(result.downloads.start, '2026-10-01');
  assert.match(result.warnings.join(' '), /16 of 30/);
});

test('download lifetime overlap handles publication on the boundary and after the whole window', () => {
  for (const [first, days, warned] of [['2026-10-01', 30, false], ['2026-10-30', 1, true], ['2026-11-01', 0, true]]) {
    const record = { first_published_at: `${first}T12:00:00Z`,
      downloads: { count: 100, start: '2026-10-01', end: '2026-10-30' }, warnings: [] };
    downloadAge(record);
    assert.equal(record.downloads.days_since_publication_in_window, days);
    assert.equal(record.warnings.length > 0, warned);
    assert.equal(record.downloads.count, 100);
  }
});

test('--no-readme omits full README text from all project records and retains relationship excerpts', async () => {
  const { client } = linkedClient();
  const result = await run(['maintainers', 'alice/tool', '--person', 'alice', '--no-readme', '--json'], { client });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.data.project.readme.text, undefined);
  assert.equal(result.result.data.project.readme.omitted, true);
  assert.ok(result.result.data.documented_maintainer_evidence.length);
  assert.ok(result.result.data.project.sources.some(s => s.fields.includes('readme')));
  const markdown = await run(['inspect', 'npm:tool', '--no-readme'], { client });
  assert.equal(markdown.exitCode, 0);
  assert.doesNotMatch(markdown.text, /Documentation evidence/);
});

test('README omission also covers Jev preview copies without making a model request', async () => {
  const result = await run(['inspect', 'npm:tool', '--jev', '--goal', 'parse arguments',
    '--dry-run', '--no-readme', '--json'], { client: fixtureClient().client });
  assert.equal(result.result.data.assessment.sent, false);
  assert.equal(result.result.data.assessment.request.state.project.package_readme.text, undefined);
  assert.equal(result.result.data.assessment.request_readme_text_omitted, true);
});

test('quality lookups are opt-in and provide separately scoped facts', async () => {
  const basic = fixtureClient();
  const record = await inspect(basic.client, 'npm:tool');
  assert.equal(record.dependencies.runtime, 0);
  assert.equal(record.repository.open_issues_and_pull_requests, 3);
  assert.equal(record.repository.quality, undefined);
  assert.equal(basic.calls.some(c => c.url.includes('/actions/')), false);
  assert.equal(record.repository.warnings.some(w => /Platform support/.test(w)), false);
  const result = await inspect(fixtureClient().client, 'alice/tool', { details: true });
  assert.equal(result.quality.open_pull_requests, 1);
  assert.equal(result.quality.open_issues, 2);
  assert.equal(result.quality.latest_workflow_run.conclusion, 'success');
  assert.equal(result.quality.tests.status, 'files_detected');
  assert.equal(result.quality.dependencies.runtime, 1);
  assert.match(result.quality.dependencies.scope, /root package/);
});

test('PR pagination yields a bounded count; incomplete pagination is not an exact total', async () => {
  for (const includeLast of [true, false]) {
    const { client } = fixtureClient(url => {
      if (!new URL(url).pathname.endsWith('/pulls')) return undefined;
      const root = 'https://api.github.com/repos/alice/tool/pulls?state=open&per_page=1';
      const link = `<${root}&page=2>; rel="next"` + (includeLast ? `, <${root}&page=3>; rel="last"` : '');
      return Response.json([{ number: 1 }], { headers: { link } });
    });
    const result = await inspect(client, 'alice/tool', { details: true });
    assert.equal(result.quality.open_pull_requests, includeLast ? 3 : null);
    assert.equal(result.quality.open_issues, includeLast ? 0 : null);
  }
});

test('failed/truncated quality sources preserve primary facts and avoid false no-tests claims', async () => {
  const { client } = fixtureClient(url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/actions/runs')) return new Response('', { status: 403 });
    if (path.includes('/git/trees/')) return { truncated: true, tree: [] };
  });
  const result = await inspect(client, 'alice/tool', { details: true });
  assert.equal(result.status, 'ok');
  assert.equal(result.quality.latest_workflow_run, null);
  assert.equal(result.quality.tests.status, 'not_established');
  assert.equal(result.quality.tests.tree_truncated, true);
  assert.match(result.warnings.join(' '), /HTTP 403/);
});

test('canonical GitHub pagination is accepted but a different PR filter is not', async () => {
  for (const state of ['open', 'closed']) {
    const { client } = fixtureClient(url => new URL(url).pathname.endsWith('/pulls')
      ? Response.json([{ number: 1 }], { headers: {
        link: `<https://api.github.com/repositories/123/pulls?state=${state}&per_page=1&page=3>; rel="last", <https://api.github.com/repositories/123/pulls?state=${state}&per_page=1&page=2>; rel="next"`,
      } }) : undefined);
    const result = await inspect(client, 'alice/tool', { details: true });
    assert.equal(result.quality.open_pull_requests, state === 'open' ? 3 : null);
  }
});

test('crate detail dependencies are direct declarations, not a transitive count', async () => {
  const result = await inspect(fixtureClient().client, 'crate:tool', { details: true });
  assert.equal(result.dependencies.runtime, 2);
  assert.equal(result.dependencies.optional, 1);
  assert.equal(result.dependencies.development, 1);
  assert.equal(result.first_published_at, '2020-01-01T00:00:00Z');
});

test('details and no-readme flags are accepted without weakening profile restrictions', () => {
  assert.equal(argumentsFor(['inspect', 'alice/tool', '--details', '--no-readme']).options.details, true);
  assert.throws(() => argumentsFor(['profile', '@alice', '--details']));
  assert.throws(() => argumentsFor(['inspect', '@alice', '--details']));
  assert.throws(() => argumentsFor(['compare', '@alice', '@bob', '--details']));
});
