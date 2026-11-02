// Long preparation and confirmation run outside CI; the registered workflow uploads only these exact bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, git, verifyAdmission } from './publication.mjs';
import { persistEvidence } from './evidence.mjs';
import { metadata } from './registry.mjs';
import { accountMatches, read, requireThat, stable, write, packagePattern, versionPattern } from './model.mjs';

const hashes = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'),
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
const publicationRef = 'refs/heads/publish', publicationWorkflow = 'publish.yml';
const workflowRef = repository => `${repository}/.github/workflows/${publicationWorkflow}@${publicationRef}`;
const preparationTag = receipt => `prepared-catalog-${receipt.version}`;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function validatePreparation(receipt, repository) {
  requireThat(receipt.schemaVersion === 1 && receipt.kind === 'prepared-catalog-publication' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) && receipt.repository === repository &&
    receipt.publicationRef === publicationRef && receipt.publicationWorkflow === publicationWorkflow &&
    /^[a-f0-9]{40}$/.test(receipt.sourceCommit) && packagePattern.test(receipt.package) && versionPattern.test(receipt.version) &&
    /^[a-f0-9]{64}$/.test(receipt.digest) && /^[a-f0-9]{64}$/.test(receipt.sha256) && /^sha512-[A-Za-z0-9+/]{86}==$/.test(receipt.integrity) &&
    typeof receipt.file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(receipt.file), 'invalid prepared publication identity or publish binding');
}

async function requireTagSource(github, tag, commit) {
  let object = (await github.call(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
  const seen = new Set();
  while (object?.type === 'tag') {
    requireThat(!seen.has(object.sha), 'publication tag has a cyclic target');
    seen.add(object.sha);
    object = (await github.call(`git/tags/${object.sha}`)).object;
  }
  requireThat(object?.type === 'commit' && object.sha === commit, 'publication tag targets another source commit');
}

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
    publicationRef, publicationWorkflow,
    sourceCommit: index.sourceCommit, package: pkg.name, version: index.version, digest: index.digest,
    file, ...identity, preparedAt: new Date().toISOString() };
  write(join(out, 'prepared-publication.json'), receipt);
  return { ...receipt, directory: out, tag: preparationTag(receipt), next: 'Independently review and keys-sweep this archive, obtain manager permission, explicitly advance publish to sourceCommit, then stage the immutable inputs and dispatch publish.yml --ref publish.' };
}

export async function stagePublication(root, directory, tag, sweepFile, github) {
  requireThat(!process.env.GITHUB_ACTIONS, 'publication staging is an explicit operator action');
  const receipt = read(join(directory, 'prepared-publication.json'));
  validatePreparation(receipt, github.repository);
  requireThat(tag === preparationTag(receipt), 'publication must use the one prepared-catalog-<version> tag for this immutable version');
  const bytes = readFileSync(join(directory, receipt.file));
  requireThat(stable(hashes(bytes)) === stable({ sha256: receipt.sha256, integrity: receipt.integrity }), 'prepared archive bytes changed');
  const source = await github.call('git/ref/heads/publish');
  requireThat(source.object?.sha === receipt.sourceCommit && git(root, ['rev-parse', 'HEAD']) === receipt.sourceCommit &&
    git(root, ['status', '--porcelain']) === '', 'stage the clean reviewed preparation at the authorized publish head');
  const sweep = read(sweepFile);
  requireThat(sweep.passed === true && sweep.sha256 === receipt.sha256 && sweep.integrity === receipt.integrity &&
    typeof sweep.rules === 'string' && sweep.rules && sweep.custodyValuesChecked === true,
    'a clean exact-archive rules and custody-values keys sweep is required');
  const policy = JSON.parse(await github.content('policy.json', receipt.sourceCommit)), issuer = await github.account();
  requireThat(accountMatches(issuer, policy.publicationAuthorities), 'authenticated account is not a registered publication authority');
  const envelope = { ...receipt, sweep, issuer: { id: issuer.id, login: issuer.login, type: issuer.type } };
  const assets = [{ name: receipt.file, bytes }, { name: 'prepared-publication.json', bytes: jsonBytes(envelope) }];
  let release = await github.optional(`releases/tags/${tag}`);
  if (!release) release = await github.call('releases', 'POST', { tag_name: tag, target_commitish: receipt.sourceCommit,
    name: `Prepared ${receipt.package}@${receipt.version}`, body: `Archive SHA-256: ${receipt.sha256}\nSource: ${receipt.sourceCommit}`, draft: false, prerelease: true });
  requireThat(!release.draft && release.tag_name === tag && release.author?.id === issuer.id && release.author?.login === issuer.login && release.author?.type === issuer.type,
    'publication stage belongs to another issuer');
  await requireTagSource(github, tag, receipt.sourceCommit);
  for (const asset of assets) {
    const existing = release.assets?.find(item => item.name === asset.name);
    if (existing) requireThat((await github.download(`releases/assets/${existing.id}`)).equals(asset.bytes), 'staged publication asset conflicts');
    else await github.upload(release.upload_url, asset.name, asset.bytes);
  }
  const staged = { ...envelope, staged: true, url: release.html_url, tag,
    dispatch: { workflow: publicationWorkflow, ref: 'publish', inputs: { prepared_tag: tag, archive_sha256: receipt.sha256, expected_source_commit: receipt.sourceCommit } } };
  const file = join(directory, 'staged-publication.json');
  if (existsSync(file)) requireThat(stable(read(file)) === stable(staged), 'local staged publication receipt conflicts');
  else write(file, staged);
  return staged;
}

export async function uploadPrepared(root, tag, expectedSha256, github, fetcher = fetch, execute = spawnSync, { expectedSourceCommit } = {}) {
  requireThat(process.env.GITHUB_ACTIONS === 'true', 'npm upload requires the registered provenance workflow');
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  requireThat(process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === publicationRef &&
    process.env.GITHUB_REPOSITORY === github.repository && process.env.GITHUB_SHA === sourceCommit && expectedSourceCommit === sourceCommit &&
    process.env.GITHUB_WORKFLOW_REF === workflowRef(github.repository) && process.env.GITHUB_WORKFLOW_SHA === sourceCommit &&
    /^[a-f0-9]{64}$/.test(expectedSha256), 'publication requires the exact prepared source and registered workflow on refs/heads/publish');
  const workflow = { run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    ref: publicationRef, workflowRef: process.env.GITHUB_WORKFLOW_REF, workflowSha: process.env.GITHUB_WORKFLOW_SHA, sourceCommit };
  requireThat(/^[1-9][0-9]*$/.test(workflow.run) && /^[1-9][0-9]*$/.test(workflow.attempt), 'publication workflow has no run/attempt identity');
  requireThat(git(root, ['status', '--porcelain']) === '', 'publication source must be clean');
  const publishedSource = await github.call('git/ref/heads/publish');
  requireThat(publishedSource.object?.sha === sourceCommit, 'publish advanced from the prepared source; refuse dispatch');
  const release = await github.call(`releases/tags/${encodeURIComponent(tag)}`);
  requireThat(!release.draft && release.assets?.filter(asset => asset.name === 'prepared-publication.json').length === 1, 'staged publication receipt is missing or ambiguous');
  const receiptAsset = release.assets.find(asset => asset.name === 'prepared-publication.json');
  const receiptBytes = await github.download(`releases/assets/${receiptAsset.id}`), receipt = JSON.parse(receiptBytes.toString('utf8'));
  validatePreparation(receipt, github.repository);
  requireThat(tag === preparationTag(receipt) && release.tag_name === tag, 'publication uses another immutable-version stage tag');
  await requireTagSource(github, tag, sourceCommit);
  const policy = read(join(root, 'policy.json'));
  requireThat(accountMatches(release.author, policy.publicationAuthorities) && accountMatches(receiptAsset.uploader, policy.publicationAuthorities) &&
    release.author.id === receiptAsset.uploader.id && stable(receipt.issuer) === stable({ id: release.author.id, login: release.author.login, type: release.author.type }),
    'staged publication issuer is unauthorized or conflicting');
  requireThat(receipt.sourceCommit === sourceCommit && receipt.package === read(join(root, 'package.json')).name && receipt.sha256 === expectedSha256,
    'staged publication source, archive or identity differs');
  requireThat(receipt.sweep?.passed === true && receipt.sweep.sha256 === receipt.sha256 && receipt.sweep.integrity === receipt.integrity &&
    receipt.sweep.custodyValuesChecked === true && typeof receipt.sweep.rules === 'string' && receipt.sweep.rules, 'staged publication lacks its exact-archive sweep');
  requireThat(release.assets.filter(asset => asset.name === receipt.file).length === 1, 'staged publication archive is missing or ambiguous');
  const archiveAsset = release.assets.find(asset => asset.name === receipt.file);
  requireThat(accountMatches(archiveAsset.uploader, policy.publicationAuthorities) && archiveAsset.uploader.id === release.author.id, 'archive uploader differs from registered issuer');
  const bytes = await github.download(`releases/assets/${archiveAsset.id}`);
  requireThat(stable(hashes(bytes)) === stable({ sha256: receipt.sha256, integrity: receipt.integrity }), 'staged publication bytes differ');
  const identity = { schemaVersion: 1, repository: github.repository, tag, sourceCommit, publicationRef,
    package: receipt.package, version: receipt.version, digest: receipt.digest, sha256: receipt.sha256, integrity: receipt.integrity,
    preparationSha256: hashes(receiptBytes).sha256, workflow };
  const retainOutcome = async outcome => {
    const name = `publication-result-${workflow.run}-${workflow.attempt}.json`;
    const asset = await github.upload(release.upload_url, name, jsonBytes({ ...identity, kind: 'catalog-publication-outcome', ...outcome }));
    return { asset: asset.id, name, url: release.html_url, ...outcome };
  };
  const registry = policy.registry.replace(/\/$/, ''), url = `${registry}/${encodeURIComponent(receipt.package)}/${receipt.version}`;
  const before = await fetcher(url, { redirect: 'error' });
  if (before.ok) {
    const existing = await before.json();
    requireThat(existing.name === receipt.package && existing.version === receipt.version && existing.dist?.integrity === receipt.integrity &&
      stable(existing.catalog) === stable({ sourceCommit, digest: receipt.digest }), 'immutable published index conflicts with prepared archive');
    const outcome = await retainOutcome({ state: 'existing', observedAt: new Date().toISOString() });
    return { uploaded: false, existing: true, ...receipt, workflow, outcome };
  }
  requireThat(before.status === 404, `registry lookup failed: HTTP ${before.status}`);
  requireThat(!release.assets.some(asset => asset.name === 'publication-upload-intent.json'),
    'this immutable version has an earlier upload intent; confirm retained bytes outside CI without another upload');
  requireThat(workflow.attempt === '1', 'a workflow retry cannot upload an uncertain immutable version; confirm retained bytes outside CI');
  const file = join(root, receipt.file);
  writeFileSync(file, bytes);
  const manifest = execute('tar', ['-xzOf', file, 'package/package.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  requireThat(manifest.status === 0, 'prepared archive has no readable manifest');
  const pkg = JSON.parse(manifest.stdout);
  requireThat(pkg.name === receipt.package && pkg.version === receipt.version && stable(pkg.catalog) === stable({ sourceCommit, digest: receipt.digest }), 'prepared archive manifest differs');
  // This fixed, version-scoped asset is written before npm, including on a fresh dispatch.
  // A failed or uncertain write stops here; neither this write nor npm is retried.
  await github.upload(release.upload_url, 'publication-upload-intent.json', jsonBytes({ ...identity,
    kind: 'catalog-publication-upload-intent', startedAt: new Date().toISOString() }));
  let result;
  try { result = npmCommand(['publish', file, '--ignore-scripts', '--access', 'public', '--provenance', '--registry', registry],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, execute); }
  catch (error) { result = { status: null, error }; }
  let outcome;
  try { outcome = await retainOutcome({ state: result.status === 0 ? 'accepted' : 'uncertain', exitCode: result.status ?? null,
    signal: result.signal ?? null, completedAt: new Date().toISOString() }); }
  catch (error) { throw new Error(`npm upload ${result.status === 0 ? 'accepted' : 'uncertain'} but result receipt could not be retained; the durable intent forbids another upload: ${error.message}`, { cause: error }); }
  requireThat(result.status === 0, `index upload uncertain or failed: ${result.error?.message ?? result.stderr}; confirm the exact version without another upload`);
  return { uploaded: true, confirmed: false, ...receipt, workflow, outcome,
    next: 'Run confirm-publication outside CI; an accepted upload is never repeated.' };
}

export async function confirmPublication(receipt, registry, fetcher = fetch, confirmation = {}) {
  requireThat(!process.env.GITHUB_ACTIONS, 'registry propagation confirmation runs outside CI');
  validatePreparation(receipt, receipt.repository);
  const doc = await metadata(receipt.package, receipt.version, registry, fetcher, confirmation);
  requireThat(doc.dist?.integrity === receipt.integrity && stable(doc.catalog) === stable({ sourceCommit: receipt.sourceCommit, digest: receipt.digest }),
    'registry index identity differs from exact prepared archive');
  return { confirmed: true, package: receipt.package, version: receipt.version, integrity: receipt.integrity, sourceCommit: receipt.sourceCommit,
    publicationRef, publicationWorkflow, digest: receipt.digest, ...(receipt.tag ? { tag: receipt.tag } : {}), confirmedAt: new Date().toISOString() };
}
