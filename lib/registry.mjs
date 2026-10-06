import { createHash, X509Certificate } from 'node:crypto';
import { requireThat, packagePattern, versionPattern } from './model.mjs';

export async function metadata(name, version, registry, fetcher = fetch, confirmation) {
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
/** Confirm the registry view npm install uses; visibility of /name/version alone is insufficient. */
export async function installationMetadata(submission, registry, fetcher = fetch, confirmation = {}) {
  const { package: name, version, integrity } = submission;
  requireThat(packagePattern.test(name) && versionPattern.test(version), 'installation lookup requires an exact scoped package version');
  requireThat(typeof integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity), 'installation lookup requires artifact SHA-512 integrity');
  const base = new URL(registry);
  requireThat(base.protocol === 'https:' && !base.username && !base.password, 'registry must be HTTPS without credentials');
  const { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), windowMs = 600_000, intervalMs = 15_000 } = confirmation;
  // Reuse the measured bound in docs/measurements/registry-confirmation.json; this is read-only propagation recovery.
  requireThat(Number.isFinite(windowMs) && windowMs > 0 && Number.isFinite(intervalMs) && intervalMs > 0, 'invalid registry confirmation timing');
  const deadline = now() + windowMs;
  for (;;) {
    const response = await fetcher(`${registry.replace(/\/$/, '')}/${encodeURIComponent(name)}`, {
      redirect: 'error', headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (response.ok) {
      const doc = await response.json();
      requireThat(doc?.name === name && doc.versions && typeof doc.versions === 'object' && !Array.isArray(doc.versions), 'registry installation metadata has a different or malformed package identity');
      if (Object.hasOwn(doc.versions, version)) {
        const release = doc.versions[version];
        requireThat(release?.name === name && release.version === version, 'registry installation metadata returned a different package/version');
        requireThat(release.dist?.integrity === integrity, 'registry installation metadata has conflicting artifact integrity');
        return release;
      }
    } else requireThat(response.status === 404, `registry installation metadata: HTTP ${response.status}`);
    const remaining = deadline - now();
    requireThat(remaining > 0, 'published package is not yet visible to npm install; retry confirmation, never upload this version again');
    await sleep(Math.min(intervalMs, remaining));
  }
}
export function registryURL(value, registry) {
  const url = new URL(value);
  requireThat(url.origin === new URL(registry).origin && !url.username && !url.password && !url.hash, 'artifact and attestation URLs must remain on the policy registry');
  return url.href;
}
/** Artifact bytes can propagate after exact-version metadata. Retry 404 only, never a conflicting artifact. */
export async function artifactBytes(doc, submission, registry, fetcher = fetch, confirmation = {}) {
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
/** Called only after npm audit signatures has verified the installed artifact's attestations. */
export function attestedIdentity(document, source, bytes) {
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
    if (!san?.startsWith(expected) || !statement.subject?.some(({ digest: d }) => d && (d.sha512 === sha512 || d.sha256 === sha256) && (!d.sha512 || d.sha512 === sha512) && (!d.sha256 || d.sha256 === sha256))) continue;
    const dependency = statement.predicate?.buildDefinition?.resolvedDependencies?.find((item) => item.uri?.startsWith(`git+https://github.com/${source.repository}@`));
    const sourceCommit = dependency?.digest?.gitCommit;
    return { signer: san, subjectSha256: sha256, subjectSha512: sha512, predicateType: statement.predicateType, ...(sourceCommit && /^[a-f0-9]{40}$/.test(sourceCommit) ? { sourceCommit } : {}), bundle };
  }
  throw new Error('verified attestation does not bind this tarball to the registered repository and workflow');
}

/** Verify the exact downloaded bundle, so its identity cannot be swapped after npm's audit. */
export async function verifiedProvenance(document, source, bytes, verifier) {
  const expected = `https://github.com/${source.repository}/.github/workflows/${source.workflow ?? 'release.yml'}@`;
  const regex = `^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.+$`;
  for (const attestation of document.attestations ?? []) {
    if (!attestation.bundle?.dsseEnvelope?.payload) continue;
    try {
      // npm also supplies a publish receipt signed with its public key. Only repository provenance qualifies here.
      const identity = attestedIdentity({ attestations: [attestation] }, source, bytes);
      await verifier(attestation.bundle, undefined, { certificateIssuer: 'https://token.actions.githubusercontent.com', certificateIdentityURI: regex });
      return identity;
    } catch { /* another subject, signer, predicate or an invalid bundle cannot confer readiness */ }
  }
  throw new Error('no verified registered-workflow provenance for this artifact');
}
