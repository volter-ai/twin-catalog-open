import { requireThat } from './model.mjs';

export class GitHub {
  constructor(repository, token, fetcher = fetch) {
    requireThat(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'invalid repository');
    requireThat(token, 'GitHub token required for repository automation');
    this.repository = repository; this.token = token; this.fetcher = fetcher;
  }
  async call(path, method = 'GET', body) {
    const url = `https://api.github.com/repos/${this.repository}/${path}`;
    const options = { method, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await this.fetcher(url, options); break; }
      catch (error) {
        // Both sandbox attempts retained ready evidence but failed on the post-evaluation read
        // (Actions 37313751170, attempts 1 and 2). Retry the read, never a potentially applied write.
        if (method === 'GET' && attempt === 0) continue;
        const code = error.cause?.code ?? error.code ?? 'unknown';
        throw new Error(`GitHub ${method} ${path}: transport failed (${code})`, { cause: error });
      }
    }
    if (!r.ok) { const error = new Error(`GitHub ${method} ${path}: HTTP ${r.status}`); error.status = r.status; throw error; }
    return r.status === 204 ? null : r.json();
  }
  async account() {
    const response = await this.fetcher('https://api.github.com/user', { headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    requireThat(response.ok, `GitHub authenticated account: HTTP ${response.status}`);
    return response.json();
  }
  async optional(path) {
    try { return await this.call(path); } catch (error) { if (error.status === 404) return null; throw error; }
  }
  async download(path) {
    const accept = /^releases\/assets\/\d+$/.test(path) ? 'application/octet-stream' : 'application/vnd.github+json';
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}/${path}`, { headers: { authorization: `Bearer ${this.token}`, accept, 'x-github-api-version': '2022-11-28' } });
    requireThat(response.ok, `GitHub download ${path}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  async upload(url, name, bytes) {
    const target = new URL(url.replace(/\{.*$/, ''));
    requireThat(target.origin === 'https://uploads.github.com', 'unexpected evidence upload host');
    target.searchParams.set('name', name);
    const response = await this.fetcher(target, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': name.endsWith('.tgz') ? 'application/octet-stream' : 'application/json', 'x-github-api-version': '2022-11-28' }, body: bytes });
    requireThat(response.ok, `GitHub evidence upload: HTTP ${response.status}`);
    return response.json();
  }
  async pages(path) {
    const result = [];
    for (let page = 1; ; page++) {
      const rows = await this.call(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      requireThat(Array.isArray(rows), 'GitHub pagination expected an array');
      result.push(...rows);
      if (rows.length < 100) return result;
    }
  }
  async content(path, ref) {
    requireThat(/^[a-f0-9]{40}$/.test(ref), 'content must be read at an immutable commit');
    const doc = await this.call(`contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
    requireThat(doc.type === 'file' && doc.encoding === 'base64', 'expected a data file');
    return Buffer.from(doc.content, 'base64').toString('utf8');
  }
}

