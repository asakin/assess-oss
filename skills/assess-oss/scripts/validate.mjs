import { SourceError } from './http.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const text = value => string(value) && value.length > 0;
const count = value => Number.isFinite(value) && value >= 0;
const arrayOf = check => value => Array.isArray(value) && value.every(check);
const optional = (value, check) => value == null || check(value);
const strings = arrayOf(string);
const repo = value => object(value) && text(value.full_name) && text(value.html_url) &&
  object(value.owner) && text(value.owner.login) && text(value.owner.type) &&
  optional(value.topics, strings) && optional(value.license, object) &&
  optional(value.stargazers_count, count) && optional(value.forks_count, count);
const issue = value => object(value) && text(value.title) && text(value.html_url) &&
  text(value.repository_url) && text(value.state) && optional(value.pull_request, object);
const crate = value => object(value) && text(value.id) &&
  optional(value.repository, string) &&
  optional(value.keywords, strings) && optional(value.downloads, count) &&
  optional(value.recent_downloads, count);
const searchResult = (value, key, check) => object(value) && arrayOf(check)(value[key]);
const contributor = value => object(value) && text(value.type) && count(value.contributions) &&
  (value.type === 'Anonymous' || (text(value.login) && text(value.html_url)));

/** Validate only consumed contracts; unknown upstream fields remain forward-compatible. */
export function validatePayload(url, data) {
  const { hostname, pathname } = new URL(url);
  let valid = false;
  if (hostname === 'api.github.com') {
    const repositoryPath = pathname.match(/^\/(?:repos\/[^/]+\/[^/]+|repositories\/\d+)(\/.*)?$/);
    const resource = repositoryPath ? repositoryPath[1] ?? '' : null;
    if (pathname === '/search/repositories') valid = searchResult(data, 'items', repo);
    else if (pathname === '/search/issues') valid = searchResult(data, 'items', issue);
    else if (/^\/users\/[^/]+\/events\/public$/.test(pathname)) valid = arrayOf(e =>
      object(e) && optional(e.repo, r => object(r) && text(r.name)) && optional(e.payload, object))(data);
    else if (resource === '/pulls') valid = arrayOf(p => object(p) && Number.isInteger(p.number))(data);
    else if (resource === '/actions/runs') valid = object(data) && arrayOf(r => object(r) &&
      text(r.status) && text(r.html_url) && text(r.head_sha))(data.workflow_runs);
    else if (resource !== null && /^\/git\/trees\/[^/]+$/.test(resource)) valid = object(data) &&
      typeof data.truncated === 'boolean' &&
      arrayOf(entry => object(entry) && text(entry.path) && text(entry.type))(data.tree);
    else if (resource === '/contents/package.json') valid = object(data) &&
      data.encoding === 'base64' && string(data.content) && text(data.html_url);
    else if (/^\/users\/[^/]+$/.test(pathname)) valid = object(data) &&
      text(data.login) && text(data.type) && text(data.html_url);
    else if (resource === '/languages') valid = object(data) && Object.values(data).every(count);
    else if (resource === '/releases/latest') valid = object(data) &&
      text(data.tag_name) && text(data.html_url) && optional(data.published_at, string);
    else if (resource === '/contributors') valid = arrayOf(contributor)(data);
    else if (resource === '/readme') valid = object(data) &&
      data.encoding === 'base64' && string(data.content) && text(data.html_url);
    else if (resource === '') valid = repo(data);
  } else if (hostname === 'registry.npmjs.org') {
    if (pathname === '/-/v1/search') {
      valid = searchResult(data, 'objects', entry => object(entry) && object(entry.package) &&
        text(entry.package.name) && object(entry.package.links) && text(entry.package.links.npm));
    } else if (/^\/[^/]+\/latest$/.test(pathname)) {
      valid = object(data) && text(data.name) && text(data.version) &&
        optional(data.maintainers, arrayOf(m => object(m) && text(m.name))) &&
        optional(data.repository, r => string(r) || (object(r) && optional(r.url, string))) &&
        optional(data.engines, object) &&
        ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
          .every(key => optional(data[key], object));
    } else if (/^\/[^/]+$/.test(pathname)) {
      valid = object(data) && (object(data.time) || string(data.readme)) &&
        optional(data.time, t => object(t) && Object.values(t).every(string)) &&
        optional(data.readme, string) &&
        optional(data.repository, r => string(r) || (object(r) && optional(r.url, string))) &&
        optional(data.maintainers, arrayOf(m => object(m) && text(m.name)));
    }
  } else if (hostname === 'api.npmjs.org') {
    valid = object(data) && count(data.downloads) && text(data.start) && text(data.end);
  } else if (hostname === 'crates.io') {
    if (/^\/api\/v1\/crates\/[^/]+\/[^/]+\/dependencies$/.test(pathname)) valid = object(data) &&
      arrayOf(d => object(d) && text(d.crate_id) && ['normal', 'dev', 'build'].includes(d.kind))(data.dependencies);
    else if (pathname === '/api/v1/crates') valid = searchResult(data, 'crates', crate);
    else if (/^\/api\/v1\/crates\/[^/]+$/.test(pathname)) valid = object(data) && crate(data.crate) &&
      text(data.crate.max_stable_version || data.crate.max_version) &&
      optional(data.versions, arrayOf(v => object(v) && text(v.num)));
  }
  if (!valid) throw new SourceError(`Unexpected response shape: ${url}`);
  return data;
}
