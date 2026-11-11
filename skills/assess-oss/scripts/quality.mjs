import { source } from './sources.mjs';
import { dependencies } from './evidence.mjs';

const GH = 'https://api.github.com';

export async function quality(client, record, branch = 'HEAD') {
  const root = `${GH}/repos/${record.id}`;
  const [pulls, runs, tree] = await Promise.all([
    source(client, record, `${root}/pulls?state=open&per_page=1`, ['open_pull_requests']),
    source(client, record, `${root}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
      ['latest_workflow_run']),
    source(client, record, `${root}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      ['test_file_signals', 'workflow_file_signals']),
  ]);
  const pullSource = record.sources.find(s => s.fields.includes('open_pull_requests'));
  const openPrs = !pulls ? null : pulls.length === 0 ? 0
    : pullSource.last_page ?? (pullSource.next_page ? null : pulls.length);
  const combined = record.open_issues_and_pull_requests;
  const issueCount = openPrs !== null && combined !== null && combined >= openPrs ? combined - openPrs : null;
  const paths = tree?.tree.filter(entry => entry.type === 'blob').map(entry => entry.path) ?? [];
  const tests = paths.filter(path => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^/]+$/i.test(path));
  const workflows = paths.filter(path => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path));
  const run = runs?.workflow_runs?.[0];
  record.quality = {
    open_pull_requests: openPrs, open_issues: issueCount,
    issue_count_basis: 'Combined repository count minus paginated open-PR count; observations are not atomic.',
    latest_workflow_run: run ? {
      name: run.name, status: run.status, conclusion: run.conclusion,
      head_sha: run.head_sha, branch: run.head_branch, url: run.html_url,
      updated_at: run.updated_at,
    } : null,
    ci_scope: 'Latest sampled GitHub Actions run on the default branch; not proof all CI passes or that it covers current HEAD.',
    tests: {
      status: tests.length ? 'files_detected' : 'not_established',
      matching_paths: tests.slice(0, 20), tree_truncated: tree?.truncated ?? null,
      note: 'Filename evidence only; no claim about coverage or successful execution. Inline tests may not be visible.',
    },
    workflow_paths: workflows.slice(0, 20),
    dependencies: null,
  };
  if (paths.includes('package.json')) {
    const url = `${root}/contents/package.json?ref=${encodeURIComponent(branch)}`;
    const file = await source(client, record, url, ['root_manifest_dependencies', 'declared_test_script']);
    if (file) {
      try {
        const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error();
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'scripts']) {
          if (manifest[key] != null && (typeof manifest[key] !== 'object' || Array.isArray(manifest[key]))) throw new Error();
        }
        record.quality.dependencies = dependencies(manifest, 'repository root package.json', file.html_url);
        const command = typeof manifest.scripts?.test === 'string' ? manifest.scripts.test : null;
        record.quality.tests.declared_test_script = command;
        if (!tests.length && command && !/no test specified/i.test(command)) {
          record.quality.tests.status = 'script_declared';
        }
      } catch { record.warnings.push(`Invalid root package.json evidence: ${url}`); }
    }
  }
}
