import { HttpClient } from '../skills/assess-oss/scripts/http.mjs';

export const repo = {
  full_name: 'alice/tool', html_url: 'https://github.com/alice/tool',
  description: 'A cross-platform argument parser', stargazers_count: 42, forks_count: 3,
  language: 'Rust', pushed_at: '2026-10-01T00:00:00Z', created_at: '2024-01-01T00:00:00Z',
  archived: false, fork: false, license: { spdx_id: 'MIT' },
  default_branch: 'main', open_issues_count: 3,
  topics: ['argument-parser'], owner: { login: 'alice', type: 'User', html_url: 'https://github.com/alice' },
};
export const user = {
  login: 'alice', html_url: 'https://github.com/alice', type: 'User', name: 'Alice',
  bio: 'Builds parsing tools', created_at: '2020-01-01T00:00:00Z',
};
export const readme = {
  encoding: 'base64',
  content: Buffer.from('# Tool\nMaintained by [Alice](https://github.com/alice).\nSupports Linux and macOS.').toString('base64'),
  html_url: 'https://github.com/alice/tool/blob/main/README.md',
};
export const answers = {
  documented_fit: { type: 'score', score: 1.8, confidence: 0.6, probabilities: { 0: 0, 1: 0.2, 2: 0.8 } },
  evidence_sufficient: { type: 'noul', noul: 0.9 },
};

export function fixtureResponse(url) {
  const u = new URL(url);
  const path = u.pathname;
  if (u.hostname === 'registry.npmjs.org') {
    if (path === '/-/v1/search') return { objects: [
      { package: { name: 'tool', version: '1.0.0', description: 'Parser', links: { npm: 'https://www.npmjs.com/package/tool' } } },
      { package: { name: 'other', version: '1.0.0', description: 'Another parser', links: { npm: 'https://www.npmjs.com/package/other' } } },
    ], total: 2 };
    if (path.endsWith('/latest')) return {
      name: '@scope/tool', version: '1.0.0', description: 'A parser', license: 'MIT',
      repository: { url: 'git+https://github.com/alice/tool.git', directory: 'packages/tool' },
      maintainers: [{ name: 'registry-name', email: 'not-in-output@example.com' }], engines: { node: '>=22' },
    };
    return { time: { '1.0.0': '2026-09-01T00:00:00Z' }, readme: 'A package README' };
  }
  if (u.hostname === 'api.npmjs.org') return { downloads: 100, start: '2026-10-01', end: '2026-10-30' };
  if (u.hostname === 'crates.io') {
    if (path.endsWith('/dependencies')) return { dependencies: [
      { crate_id: 'parser-core', kind: 'normal', optional: false },
      { crate_id: 'parser-derive', kind: 'normal', optional: true },
      { crate_id: 'test-helper', kind: 'dev', optional: false },
    ] };
    if (path === '/api/v1/crates') return { crates: [{ id: 'other', description: 'Another parser', downloads: 900 }], meta: { total: 1 } };
    return {
      crate: { id: 'tool', description: 'A parser', max_stable_version: '1.0.0', max_version: '2.0.0-beta',
        downloads: 1000, recent_downloads: 100, created_at: '2020-01-01T00:00:00Z',
        repository: 'https://github.com/alice/tool', keywords: ['parser'] },
      versions: [{ num: '2.0.0-beta', license: 'Apache-2.0', created_at: '2026-10-02T00:00:00Z' },
        { num: '1.0.0', license: 'MIT', created_at: '2026-01-01T00:00:00Z' }],
    };
  }
  if (path.includes('/events/public')) return [
    { type: 'PushEvent', repo: { name: 'bob/parser' }, created_at: '2026-10-02T00:00:00Z', payload: {} },
    { type: 'WatchEvent', repo: { name: 'bob/parser' }, created_at: '2026-10-02T00:00:00Z', payload: {} },
  ];
  if (path.startsWith('/users/')) return user;
  if (path === '/search/repositories') return {
    items: [repo, { ...repo, full_name: 'alice/other', html_url: 'https://github.com/alice/other' }],
    incomplete_results: false, total_count: 2,
  };
  if (path === '/search/issues') return {
    incomplete_results: false, total_count: 1,
    items: [{
      title: 'Fix parser', html_url: 'https://github.com/bob/parser/pull/1',
      repository_url: 'https://api.github.com/repos/bob/parser',
      state: 'closed', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
      ...(u.searchParams.get('q').includes('is:pr') ? { pull_request: { url: 'https://api.github.com/repos/bob/parser/pulls/1' } } : {}),
    }],
  };
  if (path.endsWith('/pulls')) return [{ number: 1 }];
  if (path.endsWith('/actions/runs')) return { workflow_runs: [{
    name: 'CI', status: 'completed', conclusion: 'success', head_sha: 'abc123', head_branch: 'main',
    html_url: 'https://github.com/alice/tool/actions/runs/1', updated_at: '2026-10-01T00:00:00Z',
  }] };
  if (path.includes('/git/trees/')) return { truncated: false, tree: [
    { path: 'package.json', type: 'blob' }, { path: 'test/core.test.mjs', type: 'blob' },
    { path: '.github/workflows/check.yml', type: 'blob' },
  ] };
  if (path.endsWith('/contents/package.json')) return {
    encoding: 'base64', html_url: 'https://github.com/alice/tool/blob/main/package.json',
    content: Buffer.from(JSON.stringify({ dependencies: { parser: '^1' }, scripts: { test: 'node --test' } })).toString('base64'),
  };
  if (path.endsWith('/languages')) return { Rust: 1000 };
  if (path.endsWith('/releases/latest')) return { tag_name: 'v1.0.0', published_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/alice/tool/releases/tag/v1.0.0' };
  if (path.endsWith('/contributors')) return [{ login: 'alice', type: 'User', contributions: 50, html_url: 'https://github.com/alice' }];
  if (path.endsWith('/readme')) return readme;
  if (path.startsWith('/repos/')) return repo;
  throw new Error(`Fixture missing: ${url}`);
}

export function fixtureClient(override) {
  const calls = [];
  const client = new HttpClient({
    noCache: true, token: '', sleep: async () => {},
    fetcher: async (url, options) => {
      calls.push({ url, options });
      const value = override ? await override(url, options) : undefined;
      if (value instanceof Response) return value;
      return Response.json(value ?? fixtureResponse(url));
    },
  });
  return { client, calls };
}
