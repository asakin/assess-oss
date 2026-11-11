import { stripVTControlCharacters } from 'node:util';

// Remote text must not emit terminal escape/control sequences.
export function clean(value) {
  return stripVTControlCharacters(String(value ?? 'unknown'))
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
const inline = value => clean(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)
  .replace(/\n/g, ' ').replace(/[|`]/g, '\\$&');
const shown = value => value === null || value === undefined ? 'unknown' : inline(value);
const link = (label, url) => `[${inline(label).replace(/[[\]]/g, '\\$&')}](${safeUrl(url)})`;
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href.replace(/[()]/g, c => encodeURIComponent(c)) : '#';
  } catch { return '#'; }
}
const ghRepo = record => record.kind === 'github' ? record : record.repository;

function sourceLines(record) {
  return (record.sources ?? []).map(s =>
    `- ${link(s.fields.join(', '), s.url)} — observed ${inline(s.observed_at)}${s.cached ? ' (cached)' : ''}${s.next_page ? '; more pages not fetched' : ''}`);
}
function warningLines(record) {
  return (record.warnings ?? []).map(w => `- ${inline(w)}`);
}
function shortRepo(r) {
  return `- ${link(r.id, r.url)} — ${shown(r.description)}; stars: ${shown(r.stars)}; language: ${shown(r.language)}; pushed: ${shown(r.pushed_at)}; archived: ${shown(r.archived)}`;
}

function projectLines(record, { evidence = true } = {}) {
  const repo = ghRepo(record);
  const lines = [
    `## ${link(`${record.kind}:${record.id}`, record.url)}`,
    shown(record.description),
    `- Status: ${shown(record.status)}`,
    `- License metadata: ${shown(record.license)} (not legal advice)`,
    `- Stars: ${shown(repo?.stars)}; forks: ${shown(repo?.forks)}; archived: ${shown(repo?.archived)}`,
    ...(record.kind !== 'github'
      ? [`- Package version: ${shown(record.version)}; published: ${shown(record.published_at)}`] : []),
    ...(record.kind !== 'github' ? [`- First package publication: ${shown(record.first_published_at)}`] : []),
    `- Repository release: ${shown(repo?.release?.tag)}; published: ${shown(repo?.release?.published_at)}`,
    `- Repository pushed: ${shown(repo?.pushed_at)} (not proof of ongoing maintenance)`,
    `- Languages: ${shown(repo?.languages ?? repo?.language)}`,
    `- Contributors sampled: ${shown(repo?.contributors?.sampled)}; exact total: unknown`,
    `- Open issues and pull requests (combined): ${shown(repo?.open_issues_and_pull_requests)}`,
  ];
  const constraints = Object.fromEntries(Object.entries(record.platform_constraints ?? {}).filter(([, value]) => value != null));
  if (Object.keys(constraints).length) lines.push(`- Declared runtime/platform constraints: ${inline(constraints)}`);
  if (record.dependencies) lines.push(`- Direct dependencies: ${inline(record.dependencies)}`);
  if (record.deprecated) lines.push(`- Deprecated: ${inline(record.deprecated)}`);
  if (record.downloads) {
    const d = record.downloads;
    lines.push(`- ${inline(d.metric)}: ${shown(d.count)}; window: ${shown(d.start)} through ${shown(d.end)}${record.kind === 'crate' ? ' (lifetime, observation timestamp in sources)' : ''}`);
    if (d.recent_count != null) lines.push(`- Recent downloads: ${shown(d.recent_count)} (${inline(d.recent_window)})`);
    lines.push(`- Download caveat: ${inline(d.note)}`);
  }
  if (record.repository) lines.push(`- Repository: ${link(record.repository.id, record.repository.url)}; package directory: ${shown(record.repository_directory)}`);
  if (repo?.quality) {
    const q = repo.quality;
    lines.push('### Quality signals',
      `- Open issues: ${shown(q.open_issues)}; open pull requests: ${shown(q.open_pull_requests)}`,
      `- Latest sampled GitHub Actions run: ${q.latest_workflow_run ? link(q.latest_workflow_run.name ?? 'workflow', q.latest_workflow_run.url) : 'unknown'}; conclusion: ${shown(q.latest_workflow_run?.conclusion)}`,
      `- Test evidence: ${inline(q.tests)}; workflows: ${inline(q.workflow_paths)}`,
      `- Root-manifest dependencies: ${shown(q.dependencies)}`);
  }
  for (const p of repo?.packages ?? []) {
    lines.push('### Linked package',
      `- ${link(`${p.kind}:${p.id}`, p.url)}; version: ${shown(p.version)}`,
      `- First publication: ${shown(p.first_published_at)}; version publication: ${shown(p.version_published_at)}`,
      `- Downloads: ${shown(p.downloads?.count)}; window: ${shown(p.downloads?.start)} through ${shown(p.downloads?.end)}`,
      `- Registry maintainers: ${inline(p.declared_maintainers)}; direct dependencies: ${shown(p.dependencies)}`,
      ...sourceLines(p), ...warningLines(p));
  }
  for (const hint of repo?.package_hints ?? []) {
    if (!(repo.packages ?? []).some(p => p.id === hint.id)) {
      lines.push(`- Package hint from homepage: ${inline(`${hint.kind}:${hint.id}`)} (association not merged)`);
    }
  }
  if (record.assessment) {
    lines.push('### Optional Jev judgment', ...jsonLines(record.assessment));
  }
  if (evidence) {
    const reads = [record.readme, record.kind !== 'github' ? repo?.readme : null]
      .filter(readme => typeof readme?.text === 'string');
    for (const readme of reads) {
      lines.push(`### Documentation evidence (${link('source', readme.url)}; untrusted content)`);
      lines.push(...clean(readme.text.slice(0, 3000)).split('\n').map(line => `> ${line}`));
      if (readme.truncated || readme.text.length > 3000) lines.push('Excerpt truncated; inspect the linked documentation for details.');
    }
  }
  lines.push('### Sources', ...sourceLines(record));
  if (record.kind !== 'github' && repo) lines.push(...sourceLines(repo));
  lines.push('### Limits and warnings', ...warningLines(record));
  if (record.kind !== 'github' && repo) lines.push(...warningLines(repo));
  return lines;
}

function jsonLines(value) {
  // Indented JSON is literal content, not executable markup.
  return JSON.stringify(value, null, 2).split('\n').map(line => `    ${clean(line)}`);
}

function profileLines(record) {
  return [
    `## ${link(`@${record.id}`, record.url)}`,
    `- Account type: ${shown(record.account_type)}; name: ${shown(record.name)}`,
    `- Bio: ${shown(record.bio)}`,
    '### Notable owned repositories',
    shown(record.selection?.repositories),
    ...(record.notable_repositories ?? []).map(shortRepo),
    '### External public contribution examples',
    shown(record.selection?.contribution_samples),
    ...(record.external_contributions ?? []).map(c =>
      `- ${link(c.title, c.url)} — ${inline(c.repository)}; ${inline(c.type)}; state: ${inline(c.state)}; merged: ${shown(c.merged)}; updated: ${inline(c.updated_at)}`),
    '### Recent external activity sample',
    shown(record.recent_activity_coverage),
    ...(record.recent_external_activity ?? []).map(e =>
      `- ${link(e.repository, e.url)} — ${inline(e.type)}; ${inline(e.date)}`),
    `- Search coverage: ${inline(record.selection ?? {})}`,
    '### Sources', ...sourceLines(record),
    '### Limits and warnings', ...warningLines(record),
  ];
}

export function markdown(result, { evidence = true } = {}) {
  const data = result.data ?? result;
  let lines = ['# assess-oss', ''];
  if (result.goal) lines.push(`Goal: ${inline(result.goal)}`, '');
  if (data.kind === 'comparison') {
    lines.push('| Project | Stars | License | Pushed | Downloads (source-specific) |',
      '| --- | ---: | --- | --- | --- |');
    for (const p of data.projects) lines.push(`| ${inline(`${p.kind}:${p.id}`)} | ${shown(ghRepo(p)?.stars)} | ${shown(p.license)} | ${shown(ghRepo(p)?.pushed_at)} | ${p.downloads ? `${shown(p.downloads.count)} (${inline(p.downloads.metric)})` : 'unknown'} |`);
    lines.push(...warningLines(data));
    for (const p of data.projects) lines.push('', ...projectLines(p, { evidence }));
  } else if (data.kind === 'profile') lines.push(...profileLines(data));
  else if (data.kind === 'maintainers') {
    lines.push(...projectLines(data.project, { evidence: false }),
      '## Owner and maintainer evidence',
      `- Current owner: ${shown(data.owner)}`,
      `- Creator: ${data.creator_inference ? `${inline(data.creator_inference.candidate)} — ${inline(data.creator_inference.claim)} (inferred)` : 'not established'}`,
      ...(data.creator_inference ? [`- Inference basis: ${inline(data.creator_inference.basis)}`] : []),
      `- Profile selection: ${shown(data.profile_selection)}`,
      `- Declared package maintainer usernames (not assumed GitHub identities): ${inline(data.package_maintainers ?? [])}`,
      ...(data.documented_maintainer_evidence ?? []).map(e => `- ${link(`README line ${e.line}`, e.url)}: ${inline(e.text)}`),
      '### Contributor candidates (not verified maintainers)',
      ...(data.contributor_candidates ?? []).map(p => `- ${link(p.login, p.url)}: ${inline(p.relationship)}`),
      ...warningLines(data));
    for (const p of data.profiles) lines.push('', ...profileLines(p));
  } else if (['search', 'alternatives'].includes(data.kind)) {
    lines.push(`## ${data.kind}: ${inline(data.query ?? data.id)}`,
      `- Source: ${inline(data.ecosystem)}; matches: ${shown(data.total_matches)}; incomplete: ${shown(data.incomplete)}`);
    for (const c of data.candidates) {
      lines.push(`- ${link(c.ref, c.url)} — ${shown(c.description)}`);
    }
    lines.push('### Sources', ...sourceLines(data), '### Limits and warnings', ...warningLines(data));
    if (data.seed) lines.push('## Seed project', ...projectLines(data.seed, { evidence: false }));
  } else lines.push(...projectLines(data, { evidence }));
  return clean(lines.join('\n')) + '\n';
}
