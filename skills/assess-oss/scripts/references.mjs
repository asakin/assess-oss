import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(url) {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url)); }
  catch { return false; }
}

const handlePattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const repoPattern = /^[a-z\d_.-]+$/i;
const packagePattern = /^(?:@[a-z\d_.-]+\/)?[a-z\d_.-]+$/i;

export class UsageError extends Error {}

export function handle(value) {
  if (!handlePattern.test(value)) throw new UsageError(`Invalid GitHub handle: ${value}`);
  return value.toLowerCase();
}

/** Resolve identities, not arbitrary URLs. Registry scope slashes are preserved. */
export function parseReference(input) {
  let value = input.trim();
  if (value.startsWith('@') && !value.includes('/')) {
    return { kind: 'profile', id: handle(value.slice(1)) };
  }
  if (value.startsWith('user:')) return { kind: 'profile', id: handle(value.slice(5)) };
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); }
    catch { throw new UsageError('Invalid source URL. Supply a public GitHub, npm, or crates.io HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
      throw new UsageError('Use a public HTTPS GitHub, npm, or crates.io URL without credentials.');
    }
    let parts;
    try { parts = decodeURIComponent(url.pathname).split('/').filter(Boolean); }
    catch { throw new UsageError('Source URL contains invalid percent encoding.'); }
    if (url.hostname === 'github.com') {
      if (parts.length === 1) return { kind: 'profile', id: handle(parts[0]) };
      if (parts.length >= 2) {
        value = `github:${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
      } else throw new UsageError('A GitHub URL must identify an account or repository.');
    } else if (['www.npmjs.com', 'npmjs.com'].includes(url.hostname) && parts[0] === 'package') {
      value = `npm:${parts.slice(1, parts[1]?.startsWith('@') ? 3 : 2).join('/')}`;
    } else if (url.hostname === 'crates.io' && parts[0] === 'crates') {
      value = `crate:${parts[1] ?? ''}`;
    } else throw new UsageError('Supported URL hosts: github.com, npmjs.com, crates.io.');
  }
  if (value.startsWith('npm:')) {
    const id = value.slice(4);
    if (!packagePattern.test(id) || id.split('/').some(part => ['.', '..'].includes(part))) {
      throw new UsageError(`Invalid npm package: ${id}`);
    }
    return { kind: 'npm', id };
  }
  if (/^(crate|crates):/.test(value)) {
    const id = value.slice(value.indexOf(':') + 1);
    if (!/^[a-z\d_-]+$/i.test(id)) throw new UsageError(`Invalid crate: ${id}`);
    return { kind: 'crate', id };
  }
  if (!value.startsWith('github:') && repoPattern.test(value) &&
      !['.', '..'].includes(value) && value.length <= 100) {
    return { kind: 'name', id: value };
  }
  value = value.replace(/^github:/, '');
  const parts = value.split('/');
  const repoName = parts[1]?.replace(/\.git$/, '');
  if (parts.length === 2 && handlePattern.test(parts[0]) && repoPattern.test(repoName ?? '') &&
      !['.', '..'].includes(repoName)) {
    return { kind: 'github', id: `${handle(parts[0])}/${repoName}` };
  }
  throw new UsageError('Use a repository name, owner/repo, @handle, npm:package, or crate:name (or their public URLs).');
}

/** Package repository links commonly use git+https, ssh, and monorepo directories. */
export function repositoryLink(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return null;
  let value = raw.replace(/^git\+/, '').replace(/^git:\/\/github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/');
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value}`;
  try {
    const ref = parseReference(value);
    if (ref.kind !== 'github') return null;
    return { ...ref, directory: typeof repository === 'object' ? repository.directory ?? null : null };
  } catch {
    return null;
  }
}
