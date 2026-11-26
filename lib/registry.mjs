import { createHash, X509Certificate } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import Config from '@npmcli/config';
import npmDefinitions from '@npmcli/config/lib/definitions/index.js';
import npmRegistryFetch from 'npm-registry-fetch';
import npmTransport from 'make-fetch-happen';
import { requireThat, packagePattern, versionPattern } from './model.mjs';

let configuration;
async function npmConfiguration() {
  configuration ??= (async () => {
    const npmPath = process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm') :
      resolve(dirname(process.execPath), '../lib/node_modules/npm');
    const config = new Config({ ...npmDefinitions, npmPath, argv: [], env: { ...process.env }, warn: false });
    await config.load();
    return config.flat;
  })();
  try { return await configuration; }
  catch { throw new Error('could not read existing npm registry configuration'); }
}

/** Use npm's credential selection, constrained to the requested host/path and with no redirects. */
export async function registryFetch(value, options = {}) {
  const url = new URL(value);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'registry reads require credential-free HTTPS URLs');
  try {
    // Setting registry to this URL disables npm's same-host fallback to another registry path.
    const settings = await npmConfiguration();
    const auth = npmRegistryFetch.getAuth(url.href, { ...settings, registry: url.href });
    const headers = new Headers(options.headers);
    headers.delete('authorization');
    if (auth.token) headers.set('authorization', `Bearer ${auth.token}`);
    else if (auth.auth) headers.set('authorization', `Basic ${auth.auth}`);
    return await npmTransport(url.href, { ...options, headers: Object.fromEntries(headers), redirect: 'error',
      ca: settings.ca, cert: auth.cert, key: auth.key, strictSSL: settings.strictSSL,
      proxy: settings.httpsProxy ?? settings.proxy, noProxy: settings.noProxy, cache: 'no-store', retry: { retries: 0 } });
  } catch {
    // Credential/configuration/transport errors can contain authentication values; retain no raw message.
    throw new Error('npm registry read failed; check existing npm credentials and connectivity');
  }
}

/** The npm access API owns visibility; package manifests and submission flags do not. */
export async function packageVisibility(name, registry, fetcher = registryFetch) {
  requireThat(packagePattern.test(name), 'visibility lookup requires a scoped package');
  const base = new URL(registry);
  requireThat(base.protocol === 'https:' && !base.username && !base.password, 'registry must be HTTPS without credentials');
  const response = await fetcher(`${registry.replace(/\/$/, '')}/-/package/${name.replace('/', '%2f')}/visibility`, { redirect: 'error' });
  requireThat(response.ok, `registry visibility: HTTP ${response.status}`);
  const visibility = await response.json();
  requireThat(typeof visibility?.public === 'boolean', 'registry returned no package visibility');
  return visibility.public ? 'public' : 'restricted';
}

export async function metadata(name, version, registry, fetcher = registryFetch, confirmation) {
  requireThat(packagePattern.test(name) && versionPattern.test(version), 'registry lookup requires an exact scoped package version');
  const base = new URL(registry);
  requireThat(base.protocol === 'https:' && !base.username && !base.password, 'registry must be HTTPS without credentials');
  const { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), windowMs = 600_000, intervalMs = 15_000 } = confirmation ?? {};
  // Publisher confirmation uses the observed registry propagation in docs/measurements/registry-confirmation.json.
  requireThat(!confirmation || (Number.isFinite(windowMs) && windowMs > 0 && Number.isFinite(intervalMs) && intervalMs > 0), 'invalid registry confirmation timing');
  const deadline = now() + windowMs;
  let response;
  for (;;) {
    response = await fetcher(`${registry.replace(/\/$/, '')}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { redirect: 'error' });
    if (response.ok || !confirmation || response.status !== 404) break;
    const remaining = deadline - now();
    requireThat(remaining > 0, 'published package is not yet visible; retry confirmation, never upload this version again');
    await sleep(Math.min(intervalMs, remaining));
  }
  requireThat(response.ok, `registry metadata: HTTP ${response.status}`);
  const doc = await response.json();
  requireThat(doc.name === name && doc.version === version, 'registry returned a different package/version');
  return doc;
}
export function registryURL(value, registry) {
  const url = new URL(value);
  requireThat(url.origin === new URL(registry).origin && !url.username && !url.password && !url.hash, 'artifact and attestation URLs must remain on the policy registry');
  return url.href;
}
/** Artifact bytes can propagate after exact-version metadata. Retry 404 only, never a conflicting artifact. */
export async function artifactBytes(doc, submission, registry, fetcher = registryFetch, confirmation = {}) {
  const { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), windowMs = 600_000, intervalMs = 15_000 } = confirmation;
  // Same read-only propagation bound as docs/measurements/registry-confirmation.json.
  requireThat(Number.isFinite(windowMs) && windowMs > 0 && Number.isFinite(intervalMs) && intervalMs > 0, 'invalid registry confirmation timing');
  requireThat(doc.dist?.integrity === submission.integrity, 'artifact metadata integrity mismatch');
  const url = registryURL(doc.dist.tarball, registry), deadline = now() + windowMs;
  for (;;) {
    const response = await fetcher(url, { redirect: 'error' });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      verifyArtifact(bytes, submission, doc);
      return bytes;
    }
    requireThat(response.status === 404, `tarball: HTTP ${response.status}`);
    const remaining = deadline - now();
    requireThat(remaining > 0, 'published tarball is not yet visible; retry confirmation, never upload this version again');
    await sleep(Math.min(intervalMs, remaining));
  }
}
export const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export function verifyArtifact(bytes, submission, doc) {
  requireThat(doc.dist?.integrity === submission.integrity && integrityOf(bytes) === submission.integrity, 'artifact integrity mismatch');
}
/** Select artifact and registered-workflow identity; verifiedProvenance verifies the selected bundle. */
export function attestedIdentity(document, source, bytes, { ref } = {}) {
  requireThat(ref === undefined || /^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref), 'invalid provenance source ref');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha512 = createHash('sha512').update(bytes).digest('hex');
  const expected = `https://github.com/${source.repository}/.github/workflows/${source.workflow ?? 'release.yml'}@`;
  const attestations = document.attestations ?? [];
  for (const attestation of attestations) {
    const bundle = attestation.bundle;
    const material = bundle?.verificationMaterial;
    const raw = material?.certificate?.rawBytes ?? material?.x509CertificateChain?.certificates?.[0]?.rawBytes;
    if (!raw || !bundle?.dsseEnvelope?.payload) continue;
    const cert = new X509Certificate(Buffer.from(raw, 'base64'));
    const san = /URI:([^,]+)/.exec(cert.subjectAltName ?? '')?.[1];
    const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
    if (!['https://slsa.dev/provenance/v1', 'https://slsa.dev/provenance/v0.2'].includes(statement.predicateType)) continue;
    if (!(ref ? san === `${expected}${ref}` : san?.startsWith(expected)) || !statement.subject?.some(({ digest: d }) => d && (d.sha512 === sha512 || d.sha256 === sha256) && (!d.sha512 || d.sha512 === sha512) && (!d.sha256 || d.sha256 === sha256))) continue;
    const definition = statement.predicate?.buildDefinition;
    const dependencies = definition?.resolvedDependencies?.filter((item) => item.uri?.startsWith(`git+https://github.com/${source.repository}@`)) ?? [];
    const dependency = dependencies[0];
    const sourceCommit = dependency?.digest?.gitCommit;
    if (ref) {
      const workflow = definition?.externalParameters?.workflow;
      if (statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
        workflow?.repository !== `https://github.com/${source.repository}` || workflow.path !== `.github/workflows/${source.workflow ?? 'release.yml'}` || workflow.ref !== ref ||
        dependencies.length !== 1 || dependency.uri !== `git+https://github.com/${source.repository}@${ref}` || !/^[a-f0-9]{40}$/.test(sourceCommit)) continue;
    }
    return { signer: san, subjectSha256: sha256, subjectSha512: sha512, predicateType: statement.predicateType, ...(sourceCommit && /^[a-f0-9]{40}$/.test(sourceCommit) ? { sourceCommit } : {}),
      ...(ref ? { sourceRef: ref, workflowRef: `${source.repository}/.github/workflows/${source.workflow ?? 'release.yml'}@${ref}` } : {}), bundle };
  }
  throw new Error('verified attestation does not bind this tarball to the registered repository and workflow');
}

/** Cryptographically verify the exact downloaded bundle and its registered-workflow identity. */
export async function verifiedProvenance(document, source, bytes, verifier, options = {}) {
  const expected = `https://github.com/${source.repository}/.github/workflows/${source.workflow ?? 'release.yml'}@`;
  const identity = options.ref ? `${expected}${options.ref}` : expected;
  const regex = `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${options.ref ? '' : '.+'}$`;
  for (const attestation of document.attestations ?? []) {
    if (!attestation.bundle?.dsseEnvelope?.payload) continue;
    try {
      // npm also supplies a publish receipt signed with its public key. Only repository provenance qualifies here.
      const identity = attestedIdentity({ attestations: [attestation] }, source, bytes, options);
      await verifier(attestation.bundle, undefined, { certificateIssuer: 'https://token.actions.githubusercontent.com', certificateIdentityURI: regex });
      return identity;
    } catch { /* another subject, signer, predicate or an invalid bundle cannot confer readiness */ }
  }
  throw new Error('no verified registered-workflow provenance for this artifact');
}
