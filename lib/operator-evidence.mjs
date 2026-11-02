// An authenticated catalog authority records completed controller output. No candidate executes here.
import { accountMatches, digest, requireThat, stable, submissionId, validateSubmission } from './model.mjs';
import { dependencyLockFile, parseDependencyLock, validateRegistryLock, directDependency } from './dependency-lock.mjs';

export function authorityMatches(account, policy) {
  return accountMatches(account, policy.assessmentAuthorities);
}

export async function validateOperatorEnvelope(envelope, github, { pr, submission, current = false } = {}) {
  const input = envelope.input;
  requireThat(envelope.schemaVersion === 1 && envelope.receipt?.kind === 'operator' && envelope.workflow === null,
    'operator evidence must retain its explicit non-Actions identity');
  requireThat(input?.repository === github.repository && Number.isSafeInteger(input.pullRequest) && input.pullRequest > 0 &&
    /^[a-f0-9]{40}$/.test(input.head) && /^[a-f0-9]{40}$/.test(input.base), 'operator evidence has invalid PR bindings');
  requireThat(input.controller?.repository === github.repository && input.controller.sourceCommit === input.base &&
    envelope.receipt.controllerSource === input.base && envelope.inputSha256 === digest(input), 'operator controller or input identity differs');
  requireThat(envelope.status === 'ready' && envelope.report?.ready === true && /^sha256:[a-f0-9]{64}$/.test(envelope.image) &&
    typeof envelope.evaluatedAt === 'string' && Number.isFinite(Date.parse(envelope.evaluatedAt)), 'operator evidence is not a complete successful assessment');
  const policy = JSON.parse(await github.content('policy.json', input.base));
  const sources = JSON.parse(await github.content('sources.json', input.base));
  requireThat(stable(input.policy) === stable(policy), 'operator assessment policy differs from trusted base');
  requireThat(['submission', 'reassessment'].includes(input.kind) && policy.requireProvenance === true, 'operator evidence must assess a provenance-required release submission');
  const source = validateSubmission(input.submission, sources);
  requireThat(stable(source) === stable(input.source), 'operator source registration differs from trusted base');
  requireThat(!submission || stable(submission) === stable(input.submission), 'operator artifact differs from admitted submission');
  const s = input.submission, prepared = envelope.prepared, report = envelope.report;
  requireThat(report.vendor === s.vendor && report.package === s.package && report.version === s.version && report.integrity === s.integrity,
    'operator report release identity differs');
  requireThat(prepared?.integrity === s.integrity && stable(prepared.submission) === stable(s) &&
    stable(prepared.tools) === stable(policy.tools) && prepared.provenance?.sourceCommit &&
    /^[a-f0-9]{64}$/.test(prepared.dependencyLockSha256) && /^[a-f0-9]{64}$/.test(prepared.consumerDependencyLockSha256),
    'operator preparation, provenance or tool bindings are missing');
  const provenanceRef = policy.provenanceRefs?.[source.repository];
  if (provenanceRef !== undefined) requireThat(prepared.provenance.sourceRef === provenanceRef &&
    prepared.provenance.workflowRef === `${source.repository}/.github/workflows/${source.workflow ?? 'release.yml'}@${provenanceRef}` &&
    prepared.provenance.signer === `https://github.com/${prepared.provenance.workflowRef}` &&
    /^[a-f0-9]{40}$/.test(prepared.provenance.sourceCommit) &&
    prepared.provenance.subjectSha512 === Buffer.from(s.integrity.slice('sha512-'.length), 'base64').toString('hex'),
    'operator provenance differs from the policy-bound publication ref or artifact');
  const consumerFormat = prepared.consumerDependencyLockFormat ?? 'npm';
  requireThat((prepared.consumerDependencyLockFile ?? 'package-lock.json') === dependencyLockFile(consumerFormat), 'operator customer lock path differs from its format');
  if (consumerFormat === 'pnpm') requireThat(prepared.consumerPackageManager === `pnpm@${policy.pnpm}` &&
    envelope.executionPlatform === 'linux/amd64', 'operator native customer installer or execution platform differs');
  requireThat(envelope.dependencyLock?.packages && envelope.consumerDependencyLock &&
    envelope.lockBindings?.dependencyLock === digest(envelope.dependencyLock) &&
    envelope.lockBindings.consumerDependencyLock === digest(envelope.consumerDependencyLock), 'operator dependency locks differ');
  requireThat(typeof envelope.dependencyLockText === 'string' && typeof envelope.consumerDependencyLockText === 'string' &&
    digest(envelope.dependencyLockText) === prepared.dependencyLockSha256 &&
    digest(envelope.consumerDependencyLockText) === prepared.consumerDependencyLockSha256 &&
    stable(parseDependencyLock(envelope.dependencyLockText)) === stable(envelope.dependencyLock) &&
    stable(parseDependencyLock(envelope.consumerDependencyLockText, consumerFormat)) === stable(envelope.consumerDependencyLock), 'operator original lock bytes differ from preparation');
  validateRegistryLock(envelope.dependencyLock, 'npm', policy.registry);
  validateRegistryLock(envelope.consumerDependencyLock, consumerFormat, policy.registry);
  for (const sdk of prepared.clientSdkLocks ?? []) {
    requireThat(typeof sdk.lock === 'string' && digest(sdk.lock) === sdk.sha256, 'operator standard SDK lock bytes differ');
    if (sdk.format === 'pnpm') {
      requireThat(sdk.file === 'pnpm-lock.yaml' && sdk.packageManager === `pnpm@${policy.pnpm}` &&
        sdk.manifest?.packageManager === sdk.packageManager && envelope.executionPlatform === 'linux/amd64', 'operator standard SDK native installer differs');
      validateRegistryLock(parseDependencyLock(sdk.lock, 'pnpm'), 'pnpm', policy.registry);
    }
  }
  for (const [name, version] of Object.entries(policy.tools)) requireThat(
    envelope.dependencyLock.packages[`node_modules/${name}`]?.version === version, `${name}: operator evaluator lock differs from policy`);
  requireThat(envelope.dependencyLock.packages[`node_modules/${s.package}`]?.integrity === s.integrity &&
    directDependency(envelope.consumerDependencyLock, consumerFormat, s.package)?.integrity === s.integrity,
    'operator installed candidate differs from submitted archive');
  const pull = pr ?? await github.call(`pulls/${input.pullRequest}`);
  requireThat(pull.number === input.pullRequest && pull.head.sha === input.head && pull.base.sha === input.base && pull.base.ref === 'main', 'operator evidence PR identity differs');
  if (current) requireThat(pull.state === 'open' && pull.base.sha === input.base, 'operator evidence is superseded; reassess current head/base');
  const file = `${input.kind === 'reassessment' ? 'reassessments' : 'submissions'}/${submissionId(s)}.json`;
  const files = await github.pages(`pulls/${input.pullRequest}/files`);
  requireThat(files.length === 1 && files[0].status === 'added' && files[0].filename === file &&
    stable(JSON.parse(await github.content(file, input.head))) === stable(s), 'operator PR is not its one immutable submission');
  const comparison = await github.call(`compare/${input.base}...${input.head}`);
  requireThat(comparison.merge_base_commit?.sha === input.base, 'operator head must include its exact assessed base');
  return { policy, pr: pull };
}

export async function readOperatorEvidence(release, github, options = {}) {
  requireThat(!release.draft && release.assets?.filter(asset => asset.name === 'report.json').length === 1,
    'operator evidence release must retain one published report');
  const asset = release.assets.find(item => item.name === 'report.json');
  const bytes = await github.download(`releases/assets/${asset.id}`);
  const envelope = JSON.parse(bytes.toString('utf8'));
  const validated = await validateOperatorEnvelope(envelope, github, options);
  const reportSha256 = digest(envelope), id = submissionId(envelope.input.submission);
  requireThat(release.tag_name === `evidence-${id}-${reportSha256}`, 'operator evidence release identity differs from its report');
  requireThat(authorityMatches(release.author, validated.policy) && authorityMatches(asset.uploader, validated.policy),
    'operator evidence issuer is not a registered assessment authority');
  requireThat(release.author.id === asset.uploader.id && release.author.login === asset.uploader.login &&
    release.author.type === asset.uploader.type, 'operator release and asset authorities differ');
  return { envelope, release, reportSha256, authority: { id: release.author.id, login: release.author.login, type: release.author.type } };
}

export async function recordAssessment(envelope, github) {
  requireThat(!process.env.GITHUB_ACTIONS, 'assessment recording is an explicit operator action outside CI');
  const { policy } = await validateOperatorEnvelope(envelope, github, { current: true });
  const account = await github.account();
  requireThat(authorityMatches(account, policy), 'authenticated account is not a registered assessment authority');
  const id = submissionId(envelope.input.submission), sha256 = digest(envelope), tag = `evidence-${id}-${sha256}`;
  for (const prior of (await github.pages('releases')).filter(item => item.tag_name?.startsWith(`evidence-${id}-`) && item.tag_name !== tag)) {
    const asset = prior.assets?.find(item => item.name === 'report.json');
    if (!asset) continue;
    const bytes = await github.download(`releases/assets/${asset.id}`);
    const previous = JSON.parse(bytes.toString('utf8'));
    requireThat(previous.receipt?.kind !== 'operator' || previous.input?.head !== envelope.input.head ||
      previous.input?.pullRequest !== envelope.input.pullRequest, 'a different ready operator receipt already names this head; retain it or advance the submission head before reassessment');
  }
  let release = await github.optional(`releases/tags/${tag}`);
  if (!release) release = await github.call('releases', 'POST', { tag_name: tag, target_commitish: envelope.input.base,
    name: `Operator assessment ${envelope.input.submission.package}@${envelope.input.submission.version}`,
    body: `Operator assessment; report SHA-256: ${sha256}\nPR: #${envelope.input.pullRequest}\nHead: ${envelope.input.head}\nBase/controller: ${envelope.input.base}`,
    draft: false, prerelease: true });
  requireThat(release.author?.id === account.id && release.author?.login === account.login && release.author?.type === account.type,
    'existing evidence release belongs to another issuer');
  if (!release.assets?.some(asset => asset.name === 'report.json')) {
    await github.upload(release.upload_url, 'report.json', Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`));
    release = await github.call(`releases/${release.id}`);
  }
  const retained = await readOperatorEvidence(release, github, { current: true });
  return { recorded: true, kind: 'operator', submission: id, reportSha256: sha256, url: release.html_url,
    authority: retained.authority, head: envelope.input.head, base: envelope.input.base };
}
