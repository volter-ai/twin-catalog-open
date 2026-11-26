// Admission reads the immutable artifact and retained reviews; no candidate code runs.
import { Parser } from 'tar';
import semver from 'semver';
import { verify } from 'sigstore';
import { digest, requireThat } from './model.mjs';
import { artifactBytes, metadata, packageVisibility, registryURL, registryFetch, verifiedProvenance } from './registry.mjs';
import { publisherReview, validatePublisherEnvelope } from './publisher-review.mjs';
import { GitHub } from './github.mjs';

function artifactFiles(bytes) {
  return new Promise((resolve, reject) => {
    const files = new Map(), seen = new Set();
    const parser = new Parser({ strict: true });
    parser.on('entry', entry => {
      try {
        const name = entry.path.replace(/\/$/, '');
        requireThat((name === 'package' || name.startsWith('package/')) &&
          !name.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules' || part === '.npmrc') &&
          !name.includes('\\') && ['File', 'Directory'].includes(entry.type), `unsafe archive entry: ${name}`);
        requireThat(!seen.has(name), `repeated archive entry: ${name}`);
        seen.add(name);
        const retained = entry.type === 'File' && (name === 'package/package.json' || name === 'package/generated/pack-facts.json' ||
          /^package\/readme(?:\.md|\.markdown|\.txt)?$/i.test(name) || /^package\/journeys\/customer-life(?:\.outline)?(?:\.verdict)?\.(?:md|json)$/.test(name));
        if (retained) {
          const chunks = [];
          entry.on('data', chunk => chunks.push(chunk));
          entry.on('end', () => files.set(name, Buffer.concat(chunks)));
        } else entry.resume();
      } catch (error) { parser.abort(error); }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(files));
    parser.end(bytes);
  });
}

export async function assessArtifact(input, github) {
  const { submission: s, source, policy } = input;
  const doc = await metadata(s.package, s.version, policy.registry);
  const registryVisibility = await packageVisibility(s.package, policy.registry);
  const bytes = await artifactBytes(doc, s, policy.registry);
  let provenance = null, sourceCommit;
  if (registryVisibility === 'public') {
    requireThat(doc.dist?.attestations?.url, 'npm provenance required; this public version has no attestation');
    const response = await registryFetch(registryURL(doc.dist.attestations.url, policy.registry), { redirect: 'error' });
    requireThat(response.ok, `attestation: HTTP ${response.status}`);
    provenance = await verifiedProvenance(await response.json(), source, bytes, verify,
      { ref: policy.provenanceRefs?.[source.repository] });
    sourceCommit = provenance.sourceCommit;
    requireThat(s.sourceCommit === undefined || s.sourceCommit === sourceCommit, 'submission commit differs from verified provenance');
  } else {
    requireThat(/^[a-f0-9]{40}$/.test(s.sourceCommit), 'restricted package submission requires sourceCommit');
    const sourceGitHub = new GitHub(source.repository, github.token, github.fetcher);
    const commit = await sourceGitHub.call(`git/commits/${s.sourceCommit}`);
    requireThat(commit.sha === s.sourceCommit, 'restricted source commit differs from registered repository');
    requireThat(doc.gitHead === undefined || doc.gitHead === s.sourceCommit, 'registry source commit differs from submission');
    sourceCommit = s.sourceCommit;
  }
  const files = await artifactFiles(bytes);
  requireThat(files.has('package/package.json') && files.has('package/generated/pack-facts.json'), 'artifact needs its manifest and generated pack facts');
  const pack = JSON.parse(files.get('package/package.json').toString('utf8'));
  requireThat(pack.name === s.package && pack.version === s.version, 'artifact manifest identity mismatch');
  requireThat(typeof pack.license === 'string' && pack.license.trim() && pack.license !== 'UNLICENSED', 'artifact needs a redistributable license declaration for moderator review');
  const repository = typeof pack.repository === 'string' ? pack.repository : pack.repository?.url;
  requireThat(repository?.replace(/^git\+/, '').replace(/\.git$/, '') === `https://github.com/${source.repository}`, 'artifact repository differs from registered source');
  for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pack[group] ?? {})) requireThat(typeof range === 'string' && semver.validRange(range),
      `${name}: registry semver dependencies only; git, file, URL and alias dependencies are not admitted`);
  }
  const facts = JSON.parse(files.get('package/generated/pack-facts.json').toString('utf8'));
  const readmes = [...files.keys()].filter(name => /^package\/readme(?:\.md|\.markdown|\.txt)?$/i.test(name));
  requireThat(readmes.length <= 1, 'artifact has ambiguous READMEs');
  const packageMetadata = { description: typeof pack.description === 'string' ? pack.description : null,
    license: pack.license, engines: pack.engines ?? {}, peerDependencies: pack.peerDependencies ?? {},
    dependencies: pack.dependencies ?? {}, peerDependenciesMeta: pack.peerDependenciesMeta ?? {},
    repositoryDirectory: typeof pack.repository === 'object' ? pack.repository.directory ?? null : null,
    bugs: typeof pack.bugs === 'string' ? pack.bugs : pack.bugs?.url ?? null };
  const prepared = { schemaVersion: 2, submission: s, integrity: s.integrity, registryVisibility, sourceCommit, provenance, facts, packageMetadata,
    readme: readmes.length ? { path: readmes[0], markdown: files.get(readmes[0]).toString('utf8') } : null };
  const report = { schemaVersion: 2, kind: 'publisher-review', vendor: s.vendor, package: s.package, version: s.version,
    integrity: s.integrity, ready: true, prepared, publisherReview: publisherReview(files, s.vendor) };
  const envelope = { schemaVersion: 2, kind: 'publisher-review', input, inputSha256: digest(input), prepared, report,
    status: 'ready', evaluatedAt: new Date().toISOString() };
  validatePublisherEnvelope(envelope);
  return envelope;
}
