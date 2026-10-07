// Artifact documentation is data, independent of assessment and admission evidence.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { digest, read, requireThat, stable, submissionId, validateSubmission, write } from './model.mjs';
import { artifactBytes, metadata } from './registry.mjs';

export const contentIdentity = (v) => ({ schemaVersion: 1, source: v.source, vendor: v.vendor,
  package: v.package, version: v.version, integrity: v.integrity });
export function contentReceipt(root, v, reference) {
  if (!reference) return null;
  const identity = contentIdentity(v), path = `content/${submissionId(identity)}.json`;
  requireThat(reference.path === path && /^[a-f0-9]{64}$/.test(reference.sha256), 'invalid release content reference');
  const receipt = read(join(root, path));
  requireThat(digest(receipt) === reference.sha256, `${v.package}@${v.version}: content checksum differs`);
  requireThat(receipt.schemaVersion === 1 && stable(receipt.release) === stable(identity), 'release content identity differs');
  requireThat(receipt.packageMetadata && (receipt.readme === null ||
    (typeof receipt.readme?.markdown === 'string' && /^package\/readme(?:\.md|\.markdown|\.txt)?$/i.test(receipt.readme.path))),
    'invalid retained release documentation');
  return receipt;
}
export function retainedContent(root, index) {
  const references = {};
  for (const e of index.vendors) for (const p of e.packages) for (const v of p.versions) {
    if (!v.integrity) continue;
    const release = contentIdentity({ vendor: e.vendor, package: p.name, source: p.source, ...v });
    const id = submissionId(release), path = `content/${id}.json`;
    if (!existsSync(join(root, path))) continue;
    const reference = { path, sha256: digest(read(join(root, path))) };
    contentReceipt(root, release, reference);
    references[id] = reference;
  }
  return references;
}

// Read named members to stdout only: no extraction, installation or package execution.
function archive(bytes, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], errors = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(out).toString('utf8')) :
      reject(new Error(`read artifact archive: ${Buffer.concat(errors).toString('utf8')}`)));
    child.stdin.end(bytes);
  });
}
export async function captureContent(root, index, registry, fetcher = fetch) {
  const releases = [];
  for (const e of index.vendors) for (const p of e.packages) for (const v of p.versions) {
    if (!v.integrity) continue;
    const release = contentIdentity({ vendor: e.vendor, package: p.name, source: p.source, ...v });
    const source = validateSubmission(release, index.sources);
    const id = submissionId(release), path = `content/${id}.json`;
    if (existsSync(join(root, path))) {
      contentReceipt(root, release, { path, sha256: digest(read(join(root, path))) });
      releases.push({ package: p.name, version: v.version, path, existing: true });
      continue;
    }
    const doc = await metadata(p.name, v.version, registry, fetcher);
    const bytes = await artifactBytes(doc, release, registry, fetcher);
    const members = (await archive(bytes, ['-tzf', '-'])).trim().split('\n');
    requireThat(members.filter(name => name === 'package/package.json').length === 1, 'artifact needs one package manifest');
    const pack = JSON.parse(await archive(bytes, ['-xzOf', '-', 'package/package.json']));
    requireThat(pack.name === p.name && pack.version === v.version, 'artifact manifest identity differs');
    const repository = typeof pack.repository === 'string' ? pack.repository : pack.repository?.url;
    requireThat(repository?.replace(/^git\+/, '').replace(/\.git$/, '') === `https://github.com/${source.repository}`,
      'artifact repository differs from registered source');
    const readmes = members.filter(name => /^package\/readme(?:\.md|\.markdown|\.txt)?$/i.test(name));
    requireThat(readmes.length <= 1, 'artifact has ambiguous READMEs');
    const receipt = { schemaVersion: 1, release,
      packageMetadata: {
        description: typeof pack.description === 'string' ? pack.description : null,
        license: typeof pack.license === 'string' ? pack.license : null,
        engines: pack.engines ?? {}, peerDependencies: pack.peerDependencies ?? {},
        repositoryDirectory: typeof pack.repository === 'object' ? pack.repository.directory ?? null : null,
        bugs: typeof pack.bugs === 'string' ? pack.bugs : pack.bugs?.url ?? null,
      },
      readme: readmes.length ? { path: readmes[0], markdown: await archive(bytes, ['-xzOf', '-', readmes[0]]) } : null,
    };
    write(join(root, path), receipt);
    releases.push({ package: p.name, version: v.version, path, existing: false, readme: Boolean(receipt.readme) });
  }
  return { releases, next: 'Commit the captured data with the catalog maintenance change; publication binds it to the snapshot. No assessment was run.' };
}
