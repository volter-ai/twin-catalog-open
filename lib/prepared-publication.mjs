// Long preparation and confirmation run outside CI; the registered workflow uploads only these exact bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, git, verifyAdmission } from './publication.mjs';
import { persistEvidence } from './evidence.mjs';
import { read, requireThat, stable, write, packagePattern, versionPattern } from './model.mjs';

const hashes = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'),
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
const accountMatches = (account, policy) => Array.isArray(policy.publicationAuthorities) && policy.publicationAuthorities.some(entry =>
  entry.id === account?.id && entry.login === account.login && entry.type === account.type && ['User', 'Bot'].includes(entry.type));

function npmCommand(args, options, execute = spawnSync) {
  if (process.platform !== 'win32') return execute('npm', args, options);
  // Invoke npm's JS entry directly; a .cmd shim would require an avoidable command shell.
  const cli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  requireThat(existsSync(cli), 'this Node installation has no adjacent npm CLI; install the normal npm-enabled Node distribution');
  return execute(process.execPath, [cli, ...args], options);
}

export async function preparePublication(root, out, github, policyClient = github) {
  requireThat(!process.env.GITHUB_ACTIONS, 'publication preparation runs explicitly outside CI');
  requireThat(!existsSync(out), 'publication output must be a new directory');
  const proofs = await verifyAdmission(root, github, policyClient);
  const evidence = await persistEvidence(proofs, github);
  mkdirSync(out, { recursive: true });
  const index = build(root, join(out, 'index'), evidence);
  const packed = npmCommand(['pack', '--ignore-scripts', '--json', '--pack-destination', out], {
    cwd: join(out, 'index'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  requireThat(packed.status === 0, `index packing failed: ${packed.error?.message ?? packed.stderr}`);
  const entries = JSON.parse(packed.stdout);
  requireThat(entries.length === 1 && basename(entries[0].filename) === entries[0].filename, 'pack returned an invalid archive identity');
  const file = entries[0].filename, bytes = readFileSync(join(out, file)), identity = hashes(bytes);
  const pkg = read(join(out, 'index/package.json'));
  requireThat(entries[0].integrity === identity.integrity, 'packed archive integrity differs');
  const receipt = { schemaVersion: 1, kind: 'prepared-catalog-publication', repository: github.repository,
    sourceCommit: index.sourceCommit, package: pkg.name, version: index.version, digest: index.digest,
    file, ...identity, preparedAt: new Date().toISOString() };
  write(join(out, 'prepared-publication.json'), receipt);
  return { ...receipt, directory: out, next: 'Independently review, keys-sweep this exact archive, obtain manager publication permission, then stage the immutable inputs and dispatch publish.yml at sourceCommit.' };
}

export async function stagePublication(root, directory, tag, sweepFile, github) {
  requireThat(!process.env.GITHUB_ACTIONS, 'publication staging is an explicit operator action');
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(tag), 'publication tag must be a plain unique release tag');
  const receipt = read(join(directory, 'prepared-publication.json'));
  requireThat(receipt.schemaVersion === 1 && receipt.kind === 'prepared-catalog-publication' && receipt.repository === github.repository &&
    basename(receipt.file) === receipt.file && receipt.file.endsWith('.tgz'), 'invalid prepared publication receipt');
  const bytes = readFileSync(join(directory, receipt.file));
  requireThat(stable(hashes(bytes)) === stable({ sha256: receipt.sha256, integrity: receipt.integrity }), 'prepared archive bytes changed');
  const source = await github.call('git/ref/heads/main');
  requireThat(source.object?.sha === receipt.sourceCommit && git(root, ['rev-parse', 'HEAD']) === receipt.sourceCommit,
    'stage the reviewed current-main preparation; source changed');
  const sweep = read(sweepFile);
  requireThat(sweep.passed === true && sweep.sha256 === receipt.sha256 && sweep.integrity === receipt.integrity &&
    typeof sweep.rules === 'string' && sweep.rules && sweep.custodyValuesChecked === true,
    'a clean exact-archive rules and custody-values keys sweep is required');
  const policy = JSON.parse(await github.content('policy.json', receipt.sourceCommit)), issuer = await github.account();
  requireThat(accountMatches(issuer, policy), 'authenticated account is not a registered publication authority');
  const envelope = { ...receipt, sweep, issuer: { id: issuer.id, login: issuer.login, type: issuer.type } };
  const assets = [{ name: receipt.file, bytes }, { name: 'prepared-publication.json', bytes: Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`) }];
  let release = await github.optional(`releases/tags/${tag}`);
  if (!release) release = await github.call('releases', 'POST', { tag_name: tag, target_commitish: receipt.sourceCommit,
    name: `Prepared ${receipt.package}@${receipt.version}`, body: `Archive SHA-256: ${receipt.sha256}\nSource: ${receipt.sourceCommit}`, draft: false, prerelease: true });
  requireThat(release.author?.id === issuer.id && release.author?.login === issuer.login && release.author?.type === issuer.type,
    'publication stage belongs to another issuer');
  for (const asset of assets) {
    const existing = release.assets?.find(item => item.name === asset.name);
    if (existing) requireThat((await github.download(`releases/assets/${existing.id}`)).equals(asset.bytes), 'staged publication asset conflicts');
    else await github.upload(release.upload_url, asset.name, asset.bytes);
  }
  return { staged: true, url: release.html_url, tag, sourceCommit: receipt.sourceCommit, sha256: receipt.sha256,
    dispatch: { workflow: 'publish.yml', ref: receipt.sourceCommit, inputs: { prepared_tag: tag, archive_sha256: receipt.sha256 } } };
}

export async function uploadPrepared(root, tag, expectedSha256, github, fetcher = fetch, execute = spawnSync) {
  requireThat(process.env.GITHUB_ACTIONS === 'true', 'npm upload requires the registered provenance workflow');
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  requireThat(process.env.GITHUB_SHA === sourceCommit && /^[a-f0-9]{64}$/.test(expectedSha256), 'publication source or archive digest is invalid');
  requireThat(git(root, ['status', '--porcelain']) === '', 'publication source must be clean');
  const main = await github.call('git/ref/heads/main');
  requireThat(main.object?.sha === sourceCommit, 'publication source is obsolete; prepare current main');
  const release = await github.call(`releases/tags/${encodeURIComponent(tag)}`);
  requireThat(!release.draft && release.assets?.filter(asset => asset.name === 'prepared-publication.json').length === 1, 'staged publication receipt is missing or ambiguous');
  const receiptAsset = release.assets.find(asset => asset.name === 'prepared-publication.json');
  const receipt = JSON.parse((await github.download(`releases/assets/${receiptAsset.id}`)).toString('utf8'));
  const policy = read(join(root, 'policy.json'));
  requireThat(accountMatches(release.author, policy) && accountMatches(receiptAsset.uploader, policy) &&
    release.author.id === receiptAsset.uploader.id && stable(receipt.issuer) === stable({ id: release.author.id, login: release.author.login, type: release.author.type }),
    'staged publication issuer is unauthorized or conflicting');
  requireThat(receipt.schemaVersion === 1 && receipt.kind === 'prepared-catalog-publication' && receipt.repository === github.repository &&
    receipt.sourceCommit === sourceCommit && receipt.package === read(join(root, 'package.json')).name && versionPattern.test(receipt.version) && /^[a-f0-9]{64}$/.test(receipt.digest) &&
    receipt.sha256 === expectedSha256 && /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(receipt.file),
    'staged publication source, archive or identity differs');
  requireThat(receipt.sweep?.passed === true && receipt.sweep.sha256 === receipt.sha256 && receipt.sweep.integrity === receipt.integrity &&
    receipt.sweep.custodyValuesChecked === true && typeof receipt.sweep.rules === 'string', 'staged publication lacks its exact-archive sweep');
  requireThat(release.assets.filter(asset => asset.name === receipt.file).length === 1, 'staged publication archive is missing or ambiguous');
  const archiveAsset = release.assets.find(asset => asset.name === receipt.file);
  requireThat(accountMatches(archiveAsset.uploader, policy) && archiveAsset.uploader.id === release.author.id, 'archive uploader differs from registered issuer');
  const bytes = await github.download(`releases/assets/${archiveAsset.id}`);
  requireThat(stable(hashes(bytes)) === stable({ sha256: receipt.sha256, integrity: receipt.integrity }), 'staged publication bytes differ');
  const registry = policy.registry.replace(/\/$/, ''), url = `${registry}/${encodeURIComponent(receipt.package)}/${receipt.version}`;
  const before = await fetcher(url, { redirect: 'error' });
  if (before.ok) {
    const existing = await before.json();
    requireThat(existing.dist?.integrity === receipt.integrity && stable(existing.catalog) === stable({ sourceCommit, digest: receipt.digest }), 'immutable published index conflicts with prepared archive');
    return { uploaded: false, existing: true, ...receipt };
  }
  requireThat(before.status === 404, `registry lookup failed: HTTP ${before.status}`);
  requireThat(process.env.GITHUB_RUN_ATTEMPT === '1', 'a workflow retry cannot upload an uncertain immutable version; confirm retained bytes outside CI');
  const file = join(root, receipt.file);
  writeFileSync(file, bytes);
  const manifest = execute('tar', ['-xzOf', file, 'package/package.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  requireThat(manifest.status === 0, 'prepared archive has no readable manifest');
  const pkg = JSON.parse(manifest.stdout);
  requireThat(pkg.name === receipt.package && pkg.version === receipt.version && stable(pkg.catalog) === stable({ sourceCommit, digest: receipt.digest }), 'prepared archive manifest differs');
  const result = npmCommand(['publish', file, '--ignore-scripts', '--access', 'public', '--provenance', '--registry', registry], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, execute);
  requireThat(result.status === 0, `index upload uncertain or failed: ${result.error?.message ?? result.stderr}; confirm the exact version before any retry`);
  return { uploaded: true, confirmed: false, ...receipt, workflow: { run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT },
    next: 'Run confirm-publication outside CI; an accepted upload is never repeated.' };
}

export async function confirmPublication(receipt, registry, fetcher = fetch, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), windowMs = 600_000, intervalMs = 15_000 } = {}) {
  requireThat(!process.env.GITHUB_ACTIONS, 'registry propagation confirmation runs outside CI');
  requireThat(receipt.kind === 'prepared-catalog-publication' && packagePattern.test(receipt.package) && versionPattern.test(receipt.version) && /^sha512-[A-Za-z0-9+/]{86}==$/.test(receipt.integrity), 'invalid confirmation receipt');
  const deadline = now() + windowMs;
  for (;;) {
    const response = await fetcher(`${registry.replace(/\/$/, '')}/${encodeURIComponent(receipt.package)}/${receipt.version}`, { redirect: 'error' });
    if (response.ok) {
      const doc = await response.json();
      requireThat(doc.name === receipt.package && doc.version === receipt.version && doc.dist?.integrity === receipt.integrity &&
        stable(doc.catalog) === stable({ sourceCommit: receipt.sourceCommit, digest: receipt.digest }), 'registry index identity differs from exact prepared archive');
      return { confirmed: true, package: receipt.package, version: receipt.version, integrity: receipt.integrity, sourceCommit: receipt.sourceCommit, digest: receipt.digest, confirmedAt: new Date().toISOString() };
    }
    requireThat(response.status === 404, `registry confirmation failed: HTTP ${response.status}`);
    const remaining = deadline - now();
    requireThat(remaining > 0, 'upload remains unverified; retain the receipt and confirm again without upload');
    await sleep(Math.min(intervalMs, remaining));
  }
}
