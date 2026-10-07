// Read-only discovery over a published index. Never resolve or import candidate packages.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { digest, loadIndex, read, requireThat, selection, stable, submissionId, validateIndex } from './model.mjs';
import { contentIdentity, contentReceipt } from './content.mjs';

const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const releaseKey = (v) => `${v.package}@${v.version}`;

function packageDetails(bound, source, packageName, version, content) {
  const metadata = content?.packageMetadata ?? bound?.report.prepared?.packageMetadata;
  if (!metadata) return null;
  const commit = bound?.report.prepared?.provenance?.sourceCommit;
  const directory = metadata.repositoryDirectory ?? '';
  const parts = typeof directory === 'string' ? directory.split('/').filter(Boolean) : null;
  const validDirectory = parts && parts.every((part) => part !== '.' && part !== '..' && !part.includes('\\'));
  const sourceRoot = /^[a-f0-9]{40}$/.test(commit ?? '') && validDirectory
    ? `https://github.com/${source.repository}/blob/${commit}/${parts.length ? parts.map(encodeURIComponent).join('/') + '/' : ''}`
    : null;
  let issuesUrl = null;
  try { const url = new URL(metadata.bugs); if (url.protocol === 'https:') issuesUrl = url.href; } catch { /* No usable issue URL was supplied. */ }
  return { ...metadata, sourceCommit: commit ?? null,
    readmeUrl: sourceRoot ? `${sourceRoot}README.md` : null,
    licenseUrl: sourceRoot ? `${sourceRoot}LICENSE` : null,
    packageUrl: `https://www.npmjs.com/package/${packageName}/v/${encodeURIComponent(version)}`,
    issuesUrl };
}

function repositoryOf(pkg) {
  const value = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = /^git\+https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value ?? '') ??
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value ?? '');
  requireThat(match, 'catalog package must name its GitHub repository');
  return `https://github.com/${match[1]}`;
}

function reportFor(root, version) {
  const evidence = version.evidence;
  if (!evidence?.reportSha256) return null;
  requireThat(/^[a-f0-9]{64}$/.test(evidence.submission) && /^[a-f0-9]{64}$/.test(evidence.reportSha256), 'invalid report identity');
  const path = `evidence/${evidence.submission}.json`;
  requireThat(evidence.reportPath === path && existsSync(join(root, path)), `${releaseKey(version)}: bound report is missing`);
  const envelope = read(join(root, path));
  requireThat(digest(envelope) === evidence.reportSha256, `${releaseKey(version)}: report checksum differs`);
  const input = envelope.input;
  const submission = input?.submission;
  requireThat(envelope.inputSha256 === digest(input) && submission && submissionId(submission) === evidence.submission,
    `${releaseKey(version)}: report input identity differs`);
  requireThat(submission.vendor === version.vendor && submission.package === version.package && submission.version === version.version &&
    submission.source === version.source && submission.integrity === version.integrity, `${releaseKey(version)}: report release differs`);
  const report = envelope.report;
  requireThat(envelope.status === 'ready' && report?.ready === true && report.vendor === version.vendor &&
    report.package === version.package && report.version === version.version, `${releaseKey(version)}: report is not release readiness`);
  return { envelope, report };
}

/** Load and project an installed index. integrity is caller-retained install evidence, not computed here. */
export function browse(root, { vendor, package: packageName, integrity = null } = {}) {
  const pkg = read(join(root, 'package.json'));
  const catalog = read(join(root, 'catalog.json'));
  const index = validateIndex(loadIndex(root));
  requireThat(catalog.schemaVersion === 1 && Array.isArray(catalog.versions), 'unsupported catalog snapshot');
  requireThat(/^[a-f0-9]{40}$/.test(catalog.sourceCommit) && /^[a-f0-9]{64}$/.test(catalog.digest), 'invalid snapshot identity');
  requireThat(pkg.catalog?.sourceCommit === catalog.sourceCommit && pkg.catalog?.digest === catalog.digest, 'package/catalog identity differs');
  requireThat(integrity === null || /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity), 'invalid retained install integrity');
  const records = new Map();
  const references = {};
  for (const v of catalog.versions) {
    requireThat(!records.has(releaseKey(v)), 'repeated catalog release');
    records.set(releaseKey(v), v);
    if (v.evidence) {
      const { submission, admissionCommit, ...receipt } = v.evidence;
      requireThat(submission === (v.submission ?? v.assessment) && admissionCommit === (v.assessmentCommit ?? v.commit), 'evidence admission identity differs');
      if (Object.keys(receipt).length) {
        requireThat(!references[submission] || stable(references[submission]) === stable(receipt), 'conflicting evidence references');
        references[submission] = receipt;
      }
    }
  }
  const expected = index.vendors.flatMap((e) => e.packages.flatMap((p) => p.versions.map((v) => {
    const id = v.submission ?? v.assessment;
    return { vendor: e.vendor, package: p.name, source: p.source, ...v,
      evidence: id ? { submission: id, admissionCommit: v.assessmentCommit ?? v.commit, ...(references[id] ?? {}) } : null,
      assessed: Boolean(id) };
  })));
  requireThat(expected.length === records.size && expected.every((v) => stable(v) === stable(records.get(releaseKey(v)))),
    'catalog records differ from index data');
  const snapshotDigest = (vendors) => digest({ evidence: references, sources: index.sources, vendors,
    recommendations: index.recommendations, revocations: index.revocations,
    ...(catalog.content ? { content: catalog.content } : {}) });
  // Publication can append newly admitted vendors after the legacy vendors. Directory enumeration is alphabetical;
  // catalog.json retains the publication order. Accept either only when its complete digest matches the snapshot.
  const publicationOrder = new Map([...new Set(catalog.versions.map((v) => v.vendor))].map((name, at) => [name, at]));
  const orderedVendors = [...index.vendors].sort((a, b) =>
    (publicationOrder.get(a.vendor) ?? index.vendors.length) - (publicationOrder.get(b.vendor) ?? index.vendors.length));
  requireThat(snapshotDigest(index.vendors) === catalog.digest || snapshotDigest(orderedVendors) === catalog.digest,
    'catalog snapshot digest differs');
  const repository = repositoryOf(pkg);
  if (vendor !== undefined) requireThat(index.vendors.some((e) => e.vendor === vendor), `unknown catalog vendor: ${vendor}`);
  if (packageName !== undefined) requireThat(index.vendors.some((e) => (vendor === undefined || e.vendor === vendor) &&
    e.packages.some((p) => p.name === packageName)), `unknown catalog package: ${packageName}`);

  const vendors = index.vendors.filter((e) => vendor === undefined || e.vendor === vendor)
    .filter((e) => packageName === undefined || e.packages.some((p) => p.name === packageName))
    .sort((a, b) => textOrder(a.vendor, b.vendor)).map((entry) => {
      // Compute the choice before filtering: a package filter cannot silently change the default.
      const { candidates, recommended, choice } = selection(index, entry);
      const defaultRelease = choice ? { package: choice.p.name, version: choice.v.version, source: choice.p.source } : null;
      const state = choice ? 'selected' : recommended ? 'unavailable-recommendation' : candidates.length > 1 ? 'choice-required' : 'unavailable';
      return { vendor: entry.vendor, recommendation: recommended ?? null, selection: { state, default: defaultRelease },
        implementations: entry.packages.filter((p) => packageName === undefined || p.name === packageName)
          .sort((a, b) => textOrder(a.name, b.name)).map((p) => {
            const source = index.sources.find((s) => s.name === p.source);
            const sourceUrl = `https://github.com/${source.repository}`;
            return { package: p.name, source: { ...source, url: sourceUrl,
              workflowUrl: `${sourceUrl}/blob/HEAD/.github/workflows/${source.workflow ?? 'release.yml'}` },
              versions: p.versions.map((v) => {
                const record = records.get(`${p.name}@${v.version}`);
                const bound = reportFor(root, record);
                const contentReference = catalog.content?.[submissionId(contentIdentity(record))];
                const content = contentReceipt(root, record, contentReference);
                const preparedReadme = bound?.report.prepared?.readme;
                const documentation = content ? { markdown: content.readme?.markdown ?? null,
                  path: content.readme?.path ?? null, receiptPath: contentReference.path,
                  receiptSha256: contentReference.sha256, artifactIntegrity: v.integrity } :
                  preparedReadme ? { ...preparedReadme, receiptPath: record.evidence.reportPath,
                    receiptSha256: record.evidence.reportSha256, artifactIntegrity: v.integrity } : null;
                const revoked = index.revocations.find((r) => r.package === p.name && r.version === v.version);
                const selectable = v.status === 'live' && !v.version.includes('-') && !revoked;
                const quick = bound?.report.quick, browser = bound?.report.browser;
                return { ...v, packageMetadata: packageDetails(bound, source, p.name, v.version, content),
                  documentation,
                  revoked: revoked ? { reason: revoked.reason } : null, selectable: Boolean(selectable),
                  default: choice?.p.name === p.name && choice.v.version === v.version,
                  assessment: { recorded: record.assessed, available: Boolean(bound), evidence: record.evidence,
                    input: bound ? { repository: bound.envelope.input.repository, pullRequest: bound.envelope.input.pullRequest,
                      head: bound.envelope.input.head, base: bound.envelope.input.base, image: bound.envelope.image,
                      workflow: bound.envelope.workflow, tools: bound.envelope.input.policy?.tools ?? null } : null },
                  measurements: bound ? {
                    scope: quick?.scope ?? null, surface: quick?.surface ?? null,
                    operationCoverage: quick?.operationCoverage ?? null, servedOperations: quick?.servedOperations ?? null,
                    steps: quick?.steps ?? null, answered: quick?.answered ?? null, failures: quick?.failures ?? null,
                    replay: quick?.replay ?? null, conformance: bound.report.conformance ?? null,
                    consumer: bound.report.consumer ? {
                      measured: bound.report.consumer.measured === true, passed: bound.report.consumer.passed === true,
                      scope: bound.report.consumer.scope ?? null, fixture: bound.report.consumer.fixture ?? null,
                      sdkDependencies: bound.envelope.prepared?.consumerFixture?.dependencies ?? null,
                      tools: bound.report.consumer.tools ?? null, clock: bound.report.consumer.clock ?? null,
                      application: bound.report.consumer.application ?? null,
                      retainedReadback: bound.report.consumer.retainedReadback ?? null,
                      retentionNotApplicable: bound.report.consumer.retentionNotApplicable ?? null,
                      teardownVerified: bound.report.consumer.teardownVerified ?? null,
                      failures: bound.report.consumer.failures ?? null,
                    } : null,
                    browser: browser?.measured === true ? browser : null,
                    codeCoverage: quick?.codeCoverage ?? null, stateTransitionCoverage: quick?.stateTransitionCoverage ?? null,
                    domCoverage: browser?.domCoverage ?? null, comparison: bound.report.comparison ?? null } : null };
              }) };
          }) };
    });
  return { schemaVersion: 1, snapshot: { package: pkg.name, version: pkg.version, integrity,
    sourceCommit: catalog.sourceCommit, digest: catalog.digest },
    contribution: { repository, registrationUrl: `${repository}/edit/main/sources.json`,
      pullRequestsUrl: `${repository}/pulls`, guideUrl: `${repository}/blob/${catalog.sourceCommit}/docs/contributing.md` }, vendors };
}
