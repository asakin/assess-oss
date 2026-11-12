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

// Explicit endpoint fixtures: unknown routes fail instead of inheriting a suffix-based schema.
const responses = new Map();
const gh = 'https://api.github.com';
for (const id of ['alice/tool', 'alice/other', 'alice/readme', 'alice/languages', 'alice/contributors', 'alice/pulls']) {
  const root = `${gh}/repos/${id}`;
  responses.set(root, { ...repo, full_name: id, html_url: `https://github.com/${id}` });
  responses.set(`${root}/languages`, { Rust: 1000 });
  responses.set(`${root}/releases/latest`, { tag_name: 'v1.0.0', published_at: '2026-10-01T00:00:00Z', html_url: `https://github.com/${id}/releases/tag/v1.0.0` });
  responses.set(`${root}/contributors`, [{ login: 'alice', type: 'User', contributions: 50, html_url: 'https://github.com/alice' }]);
  responses.set(`${root}/readme`, readme);
  responses.set(`${root}/pulls`, [{ number: 1 }]);
  responses.set(`${root}/actions/runs`, { workflow_runs: [{
    name: 'CI', status: 'completed', conclusion: 'success', head_sha: 'abc123', head_branch: 'main',
    html_url: `https://github.com/${id}/actions/runs/1`, updated_at: '2026-10-01T00:00:00Z',
  }] });
  responses.set(`${root}/git/trees/main`, { truncated: false, tree: [
    { path: 'package.json', type: 'blob' }, { path: 'test/core.test.mjs', type: 'blob' },
    { path: '.github/workflows/check.yml', type: 'blob' },
  ] });
  responses.set(`${root}/contents/package.json`, {
    encoding: 'base64', html_url: `https://github.com/${id}/blob/main/package.json`,
    content: Buffer.from(JSON.stringify({ dependencies: { parser: '^1' }, scripts: { test: 'node --test' } })).toString('base64'),
  });
}
for (const name of ['tool', 'other', '@scope/tool', 'latest']) {
  const root = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  responses.set(`${root}/latest`, {
    name, version: '1.0.0', description: 'A parser', license: 'MIT',
    repository: { url: 'git+https://github.com/alice/tool.git', directory: 'packages/tool' },
    maintainers: [{ name: 'registry-name', email: 'not-in-output@example.com' }], engines: { node: '>=22' },
  });
  responses.set(root, { name, time: { '1.0.0': '2026-09-01T00:00:00Z' }, readme: 'A package README' });
  responses.set(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`,
    { downloads: 100, start: '2026-10-01', end: '2026-10-30' });
}
responses.set('https://registry.npmjs.org/-/v1/search', { objects: ['tool', 'other'].map(name => ({
  package: { name, version: '1.0.0', description: 'Parser', links: { npm: `https://www.npmjs.com/package/${name}` } },
})), total: 2 });
for (const id of ['tool', 'dependencies']) {
  const root = `https://crates.io/api/v1/crates/${id}`;
  responses.set(root, {
    crate: { id, description: 'A parser', max_stable_version: '1.0.0', max_version: '2.0.0-beta',
      downloads: 1000, recent_downloads: 100, created_at: '2020-01-01T00:00:00Z',
      repository: 'https://github.com/alice/tool', keywords: ['parser'] },
    versions: [{ num: '2.0.0-beta', license: 'Apache-2.0', created_at: '2026-10-02T00:00:00Z' },
      { num: '1.0.0', license: 'MIT', created_at: '2026-01-01T00:00:00Z' }],
  });
  responses.set(`${root}/1.0.0/dependencies`, { dependencies: [
    { crate_id: 'parser-core', kind: 'normal', optional: false },
    { crate_id: 'parser-derive', kind: 'normal', optional: true },
    { crate_id: 'test-helper', kind: 'dev', optional: false },
  ] });
}
responses.set('https://crates.io/api/v1/crates', { crates: [{ id: 'other', description: 'Another parser', downloads: 900 }], meta: { total: 1 } });
responses.set(`${gh}/users/alice`, user);
responses.set(`${gh}/users/alice/events/public`, [
  { type: 'PushEvent', repo: { name: 'bob/parser' }, created_at: '2026-10-02T00:00:00Z', payload: {} },
  { type: 'WatchEvent', repo: { name: 'bob/parser' }, created_at: '2026-10-02T00:00:00Z', payload: {} },
]);
responses.set(`${gh}/search/repositories`, {
  items: [repo, responses.get(`${gh}/repos/alice/other`)], incomplete_results: false, total_count: 2,
});
responses.set(`${gh}/search/issues`, url => ({
  incomplete_results: false, total_count: 1,
  items: [{
    title: 'Fix parser', html_url: 'https://github.com/bob/parser/pull/1',
    repository_url: 'https://api.github.com/repos/bob/parser',
    state: 'closed', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
    ...(url.searchParams.get('q').includes('is:pr') ? { pull_request: { url: 'https://api.github.com/repos/bob/parser/pulls/1' } } : {}),
  }],
}));

export function fixtureResponse(url) {
  const parsed = new URL(url);
  const value = responses.get(parsed.origin + parsed.pathname);
  if (value === undefined) throw new Error(`Fixture missing: ${url}`);
  return typeof value === 'function' ? value(parsed) : structuredClone(value);
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
