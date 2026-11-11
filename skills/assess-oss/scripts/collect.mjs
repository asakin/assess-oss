import { parseReference, repositoryLink, UsageError } from './references.mjs';
import { source } from './sources.mjs';
import { npmHomepage, matchesRepository, dependencies, publication, npmFirstPublication,
  downloadAge, creatorInference } from './evidence.mjs';
import { quality } from './quality.mjs';

const GH = 'https://api.github.com';
const enc = encodeURIComponent;
const sampleLimit = 30;

function base(kind, id, url) {
  return { kind, id, url, sources: [], warnings: [] };
}

function repoSummary(repo) {
  return {
    id: repo.full_name, url: repo.html_url, description: repo.description,
    stars: repo.stargazers_count ?? null, forks: repo.forks_count ?? null,
    language: repo.language ?? null, pushed_at: repo.pushed_at ?? null,
    archived: repo.archived ?? null, is_fork: repo.fork ?? null,
    license: repo.license?.spdx_id ?? null,
  };
}

export function readmeEvidence(text, url, maxChars = 10_000) {
  return {
    text: text.slice(0, maxChars), url, truncated: text.length > maxChars,
    untrusted: true,
  };
}

export async function github(client, id, { readme = true, details = false, followPackages = true } = {}) {
  const record = base('github', id, `https://github.com/${id}`);
  const root = `${GH}/repos/${id}`;
  const repo = await source(client, record, root,
    ['identity', 'description', 'popularity', 'activity', 'license', 'topics', 'owner', 'open_issues_and_pull_requests']);
  if (!repo) return { ...record, status: 'unavailable' };
  Object.assign(record, repoSummary(repo), {
    kind: 'github', status: 'ok', homepage: repo.homepage ?? null,
    owner: { login: repo.owner.login, type: repo.owner.type, url: repo.owner.html_url,
      role: 'repository_owner', administrative_control: repo.owner.type === 'User' ? true : null },
    topics: repo.topics ?? [], created_at: repo.created_at ?? null,
    supported_platforms: null,
    activity_note: 'Repository push time is not a maintenance guarantee.',
    open_issues_and_pull_requests: repo.open_issues_count ?? null,
  });
  // Follow the canonical identity returned by GitHub without following HTTP redirects.
  const canonical = `${GH}/repos/${record.id}`;
  const [languages, release, contributors, readmeData] = await Promise.all([
    source(client, record, `${canonical}/languages`, ['languages']),
    source(client, record, `${canonical}/releases/latest`, ['release']),
    source(client, record, `${canonical}/contributors?per_page=${sampleLimit}&anon=true`,
      ['contributor_sample']),
    readme ? source(client, record, `${canonical}/readme`, ['readme']) : null,
  ]);
  record.languages = languages;
  record.release = release ? {
    tag: release.tag_name, published_at: release.published_at, url: release.html_url,
  } : null;
  record.contributors = Array.isArray(contributors) ? {
    sampled: contributors.length, total: null,
    has_more: record.sources.find(s => s.fields.includes('contributor_sample'))?.next_page ?? false,
    people: contributors.map(c => ({
      login: c.login ?? null, type: c.type, contributions: c.contributions, url: c.html_url ?? null,
      relationship: c.login?.toLowerCase() === record.owner.login.toLowerCase() && record.owner.type === 'User'
        ? 'repository owner with administrative control; contributor' : 'contributor',
    })),
    note: 'One page, at most 30 reported contributors including anonymous entries; not an exact total or active maintainer list.',
  } : null;
  record.readme = readmeData?.encoding === 'base64'
    ? readmeEvidence(Buffer.from(readmeData.content, 'base64').toString('utf8'), readmeData.html_url)
    : null;
  record.creator_inference = creatorInference(record, record.contributors,
    record.sources.find(s => s.fields.includes('contributor_sample'))?.url);
  const hint = npmHomepage(record.homepage);
  record.package_hints = hint ? [{ ...hint, source: record.homepage, relationship: 'explicit repository homepage' }] : [];
  record.packages = [];
  if (hint && followPackages) {
    const linked = await npm(client, hint.id, { enrich: false, readme: false });
    if (linked.status === 'ok' && matchesRepository(linked.repository_link, record.id)) {
      record.packages.push({ ...linked, relationship: 'homepage and registry repository backlink agree' });
    } else {
      record.warnings.push(`Homepage points to npm:${hint.id}, but its repository association could not be verified; package facts were not merged.`);
    }
  }
  if (details) await quality(client, record, repo.default_branch ?? 'HEAD');
  return record;
}

export async function npm(client, id, { enrich = true, readme = true, details = false } = {}) {
  const record = base('npm', id, `https://www.npmjs.com/package/${id}`);
  const root = `https://registry.npmjs.org/${enc(id)}`;
  const latest = await source(client, record, `${root}/latest`,
    ['identity', 'version', 'description', 'license', 'repository', 'declared_maintainers', 'platform_constraints', 'direct_dependencies']);
  if (!latest) return { ...record, status: 'unavailable' };
  Object.assign(record, {
    status: 'ok', description: latest.description ?? null,
    version: latest.version, license: latest.license ?? null,
    deprecated: latest.deprecated ?? null, homepage: latest.homepage ?? null,
    keywords: latest.keywords ?? [], repository_link: latest.repository ?? null,
    declared_maintainers: (latest.maintainers ?? []).map(m => ({ name: m.name })),
    platform_constraints: { os: latest.os ?? null, cpu: latest.cpu ?? null, engines: latest.engines ?? null },
    supported_platforms: null,
    dependencies: dependencies(latest, 'published npm version', `${root}/latest`),
  });
  const [downloads, metadata] = await Promise.all([
    source(client, record, `https://api.npmjs.org/downloads/point/last-month/${enc(id)}`, ['downloads']),
    source(client, record, root, readme ? ['publication', 'readme', 'declared_maintainers'] : ['publication', 'declared_maintainers']),
  ]);
  record.downloads = downloads ? {
    count: downloads.downloads, start: downloads.start, end: downloads.end,
    metric: 'npm downloads', note: 'Downloads are not unique users.',
  } : null;
  publication(record, npmFirstPublication(metadata?.time), metadata?.time?.[latest.version] ?? null,
    metadata?.time?.created ?? null);
  if (metadata?.maintainers) record.declared_maintainers = metadata.maintainers.map(m => ({ name: m.name }));
  record.declared_maintainers_scope = metadata?.maintainers ? 'current_registry_metadata' : 'selected_version_metadata';
  record.readme = readme && metadata?.readme ? readmeEvidence(metadata.readme, record.url) : null;
  downloadAge(record);
  if (enrich) await enrichRepository(client, record, { details });
  return record;
}

export async function crate(client, id, { details = false } = {}) {
  const record = base('crate', id, `https://crates.io/crates/${id}`);
  const metadata = await source(client, record, `https://crates.io/api/v1/crates/${enc(id)}`,
    ['identity', 'description', 'version', 'license', 'repository', 'downloads', 'publication', 'keywords']);
  if (!metadata?.crate) return { ...record, status: 'unavailable' };
  const data = metadata.crate;
  const selectedVersion = data.max_stable_version || data.max_version;
  const version = metadata.versions?.find(v => v.num === selectedVersion);
  Object.assign(record, {
    status: 'ok', description: data.description ?? null,
    version: selectedVersion, license: version?.license ?? null,
    homepage: data.homepage ?? null,
    repository_link: data.repository ?? null,
    keywords: data.keywords ?? [], supported_platforms: null,
    downloads: {
      count: data.downloads ?? null, metric: 'crates.io lifetime downloads',
      start: data.created_at ?? null, end: null,
      recent_count: data.recent_downloads ?? null,
      recent_window: 'crates.io recent_downloads (upstream-defined window)',
      note: 'Lifetime and recent downloads are not comparable to npm 30-day counts or unique users.',
    },
  });
  publication(record, data.created_at ?? null, version?.created_at ?? null, data.created_at ?? null);
  if (details) {
    const url = `https://crates.io/api/v1/crates/${enc(id)}/${enc(selectedVersion)}/dependencies`;
    const result = await source(client, record, url, ['direct_dependencies']);
    record.dependencies = result ? {
      runtime: new Set(result.dependencies.filter(d => d.kind === 'normal').map(d => d.crate_id)).size,
      development: new Set(result.dependencies.filter(d => d.kind === 'dev').map(d => d.crate_id)).size,
      build: new Set(result.dependencies.filter(d => d.kind === 'build').map(d => d.crate_id)).size,
      optional: new Set(result.dependencies.filter(d => d.optional).map(d => d.crate_id)).size,
      scope: 'published crate version; runtime includes optional declarations', source: url,
    } : null;
  }
  await enrichRepository(client, record, { details });
  return record;
}

async function enrichRepository(client, record, options = {}) {
  const link = repositoryLink(record.repository_link);
  record.repository = link ? await github(client, link.id, { ...options, followPackages: false }) : null;
  record.repository_directory = link?.directory ?? null;
  if (!link) record.warnings.push('No supported GitHub repository link declared; repository enrichment unavailable.');
  if (link?.directory) {
    record.warnings.push(`Monorepo package directory: ${link.directory}. Repository README and metrics describe the whole repository, not necessarily this package.`);
  }
}

export async function inspect(client, input, options = {}) {
  const ref = typeof input === 'string' ? parseReference(input) : input;
  if (ref.kind === 'profile') return profile(client, ref.id);
  return { github, npm, crate }[ref.kind](client, ref.id, options);
}

export async function compare(client, inputs, options = {}) {
  if (inputs.length < 2 || inputs.length > 5) throw new UsageError('Compare between 2 and 5 projects.');
  const refs = inputs.map(parseReference);
  if (refs.some(r => r.kind === 'profile')) {
    throw new UsageError('Profile comparison is not supported. Inspect each public portfolio separately.');
  }
  return {
    kind: 'comparison', projects: await Promise.all(refs.map(r => inspect(client, r, options))),
    warnings: ['Compare project fit, not raw metrics across ecosystems. No universal quality score is calculated.'],
  };
}

export async function search(client, query, { ecosystem = 'github', limit = 5 } = {}) {
  if (!query.trim() || query.length > 256) throw new UsageError('Search query must contain 1–256 characters.');
  if (!['github', 'npm', 'crate'].includes(ecosystem)) throw new UsageError('Ecosystem must be github, npm, or crate.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new UsageError('Limit must be an integer from 1 to 10.');
  const result = { ...base('search', query, null), ecosystem, candidates: [] };
  if (ecosystem === 'github') {
    const data = await source(client, result,
      `${GH}/search/repositories?q=${enc(`${query} is:public`)}&per_page=${limit}&sort=stars&order=desc`,
      ['candidates']);
    result.candidates = (data?.items ?? []).map(r => ({ ...repoSummary(r), ref: `github:${r.full_name}` }));
    result.incomplete = data?.incomplete_results ?? null;
    result.total_matches = data?.total_count ?? null;
  } else if (ecosystem === 'npm') {
    const data = await source(client, result,
      `https://registry.npmjs.org/-/v1/search?text=${enc(query)}&size=${limit}`, ['candidates']);
    result.candidates = (data?.objects ?? []).map(({ package: p, score }) => ({
      id: p.name, ref: `npm:${p.name}`, url: p.links.npm,
      description: p.description ?? null, version: p.version,
      registry_score: score?.detail ?? null,
    }));
    result.total_matches = data?.total ?? null;
  } else {
    const data = await source(client, result,
      `https://crates.io/api/v1/crates?q=${enc(query)}&per_page=${limit}&page=1`, ['candidates']);
    result.candidates = (data?.crates ?? []).map(c => ({
      id: c.id, ref: `crate:${c.id}`, url: `https://crates.io/crates/${c.id}`,
      description: c.description ?? null, downloads: c.downloads ?? null,
    }));
    result.total_matches = data?.meta?.total ?? null;
  }
  result.status = result.sources.length ? 'ok' : 'unavailable';
  result.warnings.push('Bounded keyword search; candidates are not verified substitutes. Search rankings are source-specific.');
  return result;
}

export async function alternatives(client, input, { query, limit = 5, details = false } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new UsageError('Limit must be an integer from 1 to 10.');
  const ref = parseReference(input);
  if (ref.kind === 'profile') throw new UsageError('Alternatives apply to projects, not people.');
  const seed = await inspect(client, ref, { details });
  if (seed.status === 'unavailable') return { kind: 'alternatives', seed, status: 'unavailable', candidates: [] };
  const hints = seed.topics ?? seed.keywords ?? [];
  const derived = Array.isArray(hints) && hints.length ? hints.slice(0, 2).join(' ')
    : (seed.description ?? '').split(/\s+/).slice(0, 6).join(' ');
  const actualQuery = query || derived;
  if (!actualQuery) throw new UsageError('No useful search hints found. Supply --query describing the desired alternative.');
  const found = await search(client, actualQuery, { ecosystem: ref.kind, limit: Math.min(limit + 1, 10) });
  const candidates = found.candidates.filter(c => c.id.toLowerCase() !== seed.id.toLowerCase()).slice(0, limit);
  return {
    ...found, kind: 'alternatives', seed, candidates, query: actualQuery,
    warnings: [...found.warnings, 'Refine --query for the intended use case; topic matches can be complementary rather than competing tools.'],
  };
}

/** Public footprint only: bounded owned repositories and linked external PRs/issues. */
export async function profile(client, login) {
  const ref = parseReference(`user:${login}`);
  const record = base('profile', ref.id, `https://github.com/${ref.id}`);
  const user = await source(client, record, `${GH}/users/${ref.id}`, ['identity', 'bio', 'account_type']);
  if (!user) return { ...record, status: 'unavailable' };
  Object.assign(record, {
    status: 'ok', id: user.login, url: user.html_url, name: user.name,
    bio: user.bio, account_type: user.type, created_at: user.created_at,
  });
  const ownedQuery = `user:${user.login} fork:false is:public`;
  const externalQuery = `author:${user.login} -user:${user.login} is:public`;
  const [owned, prs, issues, events] = await Promise.all([
    source(client, record, `${GH}/search/repositories?q=${enc(ownedQuery)}&sort=stars&order=desc&per_page=10`, ['notable_repositories']),
    user.type === 'User' ? source(client, record,
      `${GH}/search/issues?q=${enc(`${externalQuery} is:pr`)}&sort=updated&order=desc&per_page=10`, ['external_pull_requests']) : null,
    user.type === 'User' ? source(client, record,
      `${GH}/search/issues?q=${enc(`${externalQuery} is:issue`)}&sort=updated&order=desc&per_page=10`, ['external_issues']) : null,
    user.type === 'User' ? source(client, record,
      `${GH}/users/${enc(user.login)}/events/public?per_page=30`, ['recent_external_activity']) : null,
  ]);
  record.notable_repositories = (owned?.items ?? []).filter(r => !r.fork).map(repoSummary);
  record.selection = {
    repositories: 'Up to 10 non-fork owned repositories, sorted by stars; popularity highlights, not a quality judgment or proof of authorship.',
    contribution_samples: 'Up to 10 public authored pull requests and 10 authored issues outside the account namespace, sorted by update time.',
    incomplete: [owned, prs, issues].some(r => r?.incomplete_results === true) ? true
      : !owned || (user.type === 'User' && (!prs || !issues)) ? null : false,
    repository_sample_truncated: owned ? owned.total_count > record.notable_repositories.length : null,
    external_pr_sample_truncated: prs ? prs.total_count > (prs.items?.length ?? 0) : null,
    external_issue_sample_truncated: issues ? issues.total_count > (issues.items?.length ?? 0) : null,
    repository_matches: owned?.total_count ?? null,
    external_pr_matches: prs?.total_count ?? null,
    external_issue_matches: issues?.total_count ?? null,
  };
  record.external_contributions = [...(prs?.items ?? []), ...(issues?.items ?? [])].map(item => ({
    title: item.title, url: item.html_url,
    repository: item.repository_url?.replace(`${GH}/repos/`, '') ?? null,
    type: item.pull_request ? 'pull_request' : 'issue',
    state: item.state, created_at: item.created_at, updated_at: item.updated_at,
    // Closed PRs are not necessarily merged. Search does not always return merged_at.
    merged: item.pull_request && Object.hasOwn(item.pull_request, 'merged_at')
      ? Boolean(item.pull_request.merged_at) : null,
  }));
  const contributionEvents = new Set(['PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent',
    'PullRequestReviewCommentEvent', 'IssuesEvent', 'IssueCommentEvent']);
  record.recent_external_activity = (Array.isArray(events) ? events : [])
    .filter(e => contributionEvents.has(e.type) && e.repo?.name &&
      e.repo.name.split('/')[0].toLowerCase() !== user.login.toLowerCase())
    .map(e => ({
      type: e.type, repository: e.repo.name, date: e.created_at,
      url: e.payload?.comment?.html_url ?? e.payload?.pull_request?.html_url ??
        e.payload?.issue?.html_url ?? `https://github.com/${e.repo.name}`,
    }));
  record.recent_activity_coverage = 'At most 30 public events sampled; GitHub limits the feed to 30 days and 300 events overall. May be delayed; not a contribution total. Stars/forks excluded.';
  record.warnings.push(
    'Public, bounded search only; not a lifetime contribution history. No inference about private work or personal ability.',
    'Outside the account namespace can include organizations the person maintains; affiliation is not established.',
    'Authored issues/PRs do not cover reviews, discussions, documentation work outside these records, or direct commits.',
    'No matching public records does not mean no contributions. Forks and stars are not counted as contributions.',
  );
  if (user.type !== 'User') record.warnings.push('This account is not an individual user; personal authored-contribution queries were skipped.');
  return record;
}

/** Show relationship evidence first; investigate only explicitly selected people or the owner. */
export async function maintainers(client, input, { people = [], details = false } = {}) {
  const ref = parseReference(input);
  if (ref.kind === 'profile') throw new UsageError('Maintainer lookup requires a repository or package.');
  if (people.length > 3) throw new UsageError('Select at most three profiles with --person.');
  const project = await inspect(client, ref, { details });
  const repo = project.kind === 'github' ? project : project.repository;
  const result = {
    kind: 'maintainers', project, owner: repo?.owner ?? null,
    creator: null, creator_inference: repo?.creator_inference ?? null,
    documented_maintainer_evidence: [], contributor_candidates: [],
    profiles: [], sources: [], warnings: [],
  };
  if (!repo || repo.status !== 'ok') {
    result.warnings.push('GitHub repository unavailable; cannot establish account relationships.');
    return result;
  }
  const text = repo.readme?.text ?? '';
  result.documented_maintainer_evidence = text.split('\n').flatMap((line, index) =>
    /\b(maintain(?:er|ers|ed)|creat(?:or|ed)|author(?:s|ed)?)\b/i.test(line)
      ? [{ text: line.slice(0, 500), line: index + 1, url: repo.readme.url, interpretation: 'Documentation excerpt; verify identity and current role.' }]
      : []).slice(0, 10);
  result.package_maintainers = project.kind === 'npm' ? project.declared_maintainers ?? []
    : (repo.packages ?? []).flatMap(p => p.declared_maintainers.map(m => ({
      ...m, registry: 'npm', package: p.id, source: p.url,
    })));
  result.contributor_candidates = (repo.contributors?.people ?? [])
    .filter(p => p.type === 'User').slice(0, 5);
  const selected = people.length ? people.map(p => parseReference(p.startsWith('@') || p.startsWith('user:') || p.startsWith('https://') ? p : `user:${p}`))
    : [{ kind: 'profile', id: repo.owner.login }];
  if (selected.some(p => p.kind !== 'profile')) throw new UsageError('--person must identify a GitHub profile, not a repository.');
  result.profiles = await Promise.all(selected.map(p => profile(client, p.id)));
  result.profile_selection = people.length
    ? 'Explicitly requested profiles; repository relationship must be checked against the evidence.'
    : 'Current owner account only; organization ownership remains organization ownership.';
  return result;
}
