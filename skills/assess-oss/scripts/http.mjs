import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const allowed = new Set(['api.github.com', 'registry.npmjs.org', 'api.npmjs.org', 'crates.io']);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class SourceError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

export async function boundedText(response, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new SourceError(`Response exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Bounded I/O with public-only endpoint callers and injectable dependencies for tests. */
export class HttpClient {
  constructor({
    fetcher = globalThis.fetch, token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'assess-oss'),
    noCache = false, ttl = 900_000, timeout = 15_000, concurrency = 4,
    sleep = delay, now = Date.now,
  } = {}) {
    Object.assign(this, { fetcher, token, cacheDir, noCache, ttl, timeout, sleep, now });
    this.active = 0;
    this.waiters = [];
    this.concurrency = concurrency;
    this.crateQueue = Promise.resolve();
    this.crateNext = 0;
  }

  async slot(fn) {
    if (this.active >= this.concurrency) await new Promise(resolve => this.waiters.push(resolve));
    else this.active++;
    try { return await fn(); }
    finally {
      const waiter = this.waiters.shift();
      if (waiter) waiter();
      else this.active--;
    }
  }

  async paceCrates(request) {
    const previous = this.crateQueue;
    let release;
    this.crateQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      await this.sleep(Math.max(0, this.crateNext - this.now()));
      this.crateNext = this.now() + 1000;
      return await request();
    } finally { release(); }
  }

  async get(url, { accept = 'application/json', text = false, maxBytes = 8_000_000 } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname) ||
        parsed.username || parsed.password || parsed.port) {
      throw new SourceError('Refusing a non-public-API URL.');
    }
    const key = createHash('sha256').update(`${url}\n${accept}\n${text}\n${maxBytes}`).digest('hex');
    const path = this.cacheDir ? join(this.cacheDir, `${key}.json`) : null;
    if (!this.noCache && this.cacheDir) {
      try {
        const saved = JSON.parse(await readFile(path, 'utf8'));
        if (saved.source.url === url && this.now() - Date.parse(saved.source.observed_at) < this.ttl) {
          const data = saved.data;
          if (parsed.hostname === 'api.github.com' &&
              (data?.private === true || (Array.isArray(data?.items) && data.items.some(item => item.private === true)))) {
            throw new SourceError('Cached private data is not supported.');
          }
          return { ...saved, source: { ...saved.source, cached: true } };
        }
      } catch { /* A missing/corrupt cache never prevents collection. */ }
    }
    const result = await this.slot(async () => {
      const headers = {
        Accept: accept,
        'User-Agent': 'assess-oss/0.1.0 (public OSS metadata research)',
      };
      if (parsed.hostname === 'api.github.com') {
        headers['X-GitHub-Api-Version'] = '2022-11-28';
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
      }
      let response;
      try {
        const request = () => this.fetcher(url, {
          headers, redirect: 'error', signal: AbortSignal.timeout(this.timeout),
        });
        response = parsed.hostname === 'crates.io'
          ? await this.paceCrates(request) : await request();
      } catch {
        throw new SourceError(`Request failed or timed out: ${url}`);
      }
      if (!response.ok) {
        const reset = response.headers.get('x-ratelimit-reset');
        const retry = response.headers.get('retry-after');
        await response.body?.cancel();
        const resetDate = new Date(Number(reset) * 1000);
        throw new SourceError(`HTTP ${response.status}: ${url}` +
          (retry ? `; retry after ${retry}s` : '') +
          (reset && Number.isFinite(resetDate.getTime()) ? `; rate limit reset ${resetDate.toISOString()}` : ''), response.status);
      }
      let raw;
      try {
        raw = await boundedText(response, maxBytes);
      } catch (error) {
        if (error instanceof SourceError) throw error;
        throw new SourceError(`Response interrupted: ${url}`);
      }
      let data;
      try { data = text ? raw : JSON.parse(raw); }
      catch { throw new SourceError(`Invalid JSON from ${url}`); }
      if (parsed.hostname === 'api.github.com' &&
          (data?.private === true || (Array.isArray(data?.items) && data.items.some(item => item.private === true)))) {
        throw new SourceError('Only public repositories are supported.');
      }
      let lastPage = null;
      const lastLink = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="last"/)?.[1];
      if (lastLink) {
        try {
          const last = new URL(lastLink);
          const page = Number(last.searchParams.get('page'));
          const canonicalPulls = parsed.hostname === 'api.github.com' &&
            /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(parsed.pathname) &&
            /^\/repositories\/\d+\/pulls$/.test(last.pathname);
          const sameFilters = [...parsed.searchParams].every(([key, value]) =>
            key === 'page' || last.searchParams.get(key) === value);
          if (last.origin === parsed.origin && (last.pathname === parsed.pathname || canonicalPulls) &&
              sameFilters &&
              Number.isInteger(page) && page > 0) lastPage = page;
        } catch { /* A malformed pagination hint does not invalidate primary source data. */ }
      }
      return {
        data,
        source: {
          url, observed_at: new Date(this.now()).toISOString(), cached: false,
          next_page: /rel="next"/.test(response.headers.get('link') ?? ''),
          last_page: lastPage,
        },
      };
    });
    if (!this.noCache && this.cacheDir) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
        await rename(temporary, path);
      } catch {
        await unlink(temporary).catch(() => {});
      }
    }
    return result;
  }
}
