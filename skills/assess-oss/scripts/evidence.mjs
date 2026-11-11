import { parseReference, repositoryLink } from './references.mjs';

export function npmHomepage(homepage) {
  try {
    const url = new URL(homepage);
    if (!['www.npmjs.com', 'npmjs.com'].includes(url.hostname)) return null;
    const ref = parseReference(homepage);
    return ref.kind === 'npm' ? ref : null;
  } catch { return null; }
}

export function matchesRepository(repository, id) {
  return repositoryLink(repository)?.id.toLowerCase() === id.toLowerCase();
}

export function dependencies(manifest, scope, source) {
  return {
    runtime: Object.keys(manifest.dependencies ?? {}).length,
    development: Object.keys(manifest.devDependencies ?? {}).length,
    peer: Object.keys(manifest.peerDependencies ?? {}).length,
    optional: Object.keys(manifest.optionalDependencies ?? {}).length,
    scope, source,
    note: 'Direct declarations, not transitive dependencies; categories can overlap.',
  };
}

export function npmFirstPublication(time) {
  return Object.entries(time ?? {})
    .filter(([key, value]) => !['created', 'modified'].includes(key) &&
      typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .map(([, value]) => value)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

export function publication(record, first, selected, created = null) {
  record.first_published_at = first;
  record.version_published_at = selected;
  record.registry_created_at = created;
  record.published_at = selected;
  record.published_at_scope = 'selected_version; compatibility alias of version_published_at';
}

export function downloadAge(record) {
  const downloads = record.downloads;
  if (!downloads?.start || !downloads.end || !record.first_published_at) return;
  const start = Date.parse(`${downloads.start}T00:00:00Z`);
  const end = Date.parse(`${downloads.end}T00:00:00Z`);
  const first = Date.parse(`${record.first_published_at.slice(0, 10)}T00:00:00Z`);
  if (![start, end, first].every(Number.isFinite) || end < start) return;
  const day = 86_400_000;
  downloads.window_days = Math.round((end - start) / day) + 1;
  downloads.days_since_publication_in_window = Math.max(0,
    Math.round((end - Math.max(start, first)) / day) + 1);
  downloads.window_precedes_first_publication = first > start;
  if (first > start) {
    record.warnings.push(`Download window starts before first publication (${record.first_published_at.slice(0, 10)}); ` +
      `only ${downloads.days_since_publication_in_window} of ${downloads.window_days} calendar days overlap the package's published lifetime.`);
  }
}

export function creatorInference(repo, contributors, sourceUrl) {
  if (repo.owner?.type !== 'User' || repo.is_fork !== false ||
      !contributors || contributors.has_more || contributors.people.length !== 1 ||
      contributors.people[0].login?.toLowerCase() !== repo.owner.login.toLowerCase() ||
      !(contributors.people[0].contributions > 0)) return null;
  return {
    status: 'inferred', candidate: repo.owner.login, claim: 'likely self-authored',
    basis: [
      'The repository is owned by this personal account and is not a fork.',
      'The complete returned contributor page, requested with anonymous contributors included, reports only the owner.',
      `${contributors.people[0].contributions} contributions are attributed to that account by GitHub.`,
    ],
    sources: [repo.url, sourceUrl],
    limitations: 'Inference, not verified original creation. Transfers, rewritten/imported history, and GitHub attribution limits can change the picture.',
  };
}

/** Output-only projection: collection and opted-in assessments still get their evidence. */
export function withoutReadmes(value) {
  if (Array.isArray(value)) return value.map(withoutReadmes);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'readme' || key.endsWith('_readme')) && child && typeof child.text === 'string') {
      const { text: _text, ...metadata } = child;
      output[key] = { ...metadata, omitted: true };
    } else output[key] = withoutReadmes(child);
  }
  if (value.status === 'dry_run' && value.request) output.request_readme_text_omitted = true;
  return output;
}
