// Trusted controller receipts outlive workflow-artifact retention. No candidate code is imported here.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, requireThat, selection, stable, submissionId } from './model.mjs';
import { readOperatorEvidence } from './operator-evidence.mjs';

export function bindReport(envelope, version) {
  const evidence = version.evidence, release = `${version.package}@${version.version}`;
  requireThat(/^[a-f0-9]{64}$/.test(evidence?.submission) && /^[a-f0-9]{64}$/.test(evidence.reportSha256), 'invalid report identity');
  requireThat(digest(envelope) === evidence.reportSha256, `${release}: report checksum differs`);
  const input = envelope.input, submission = input?.submission;
  requireThat(envelope.inputSha256 === digest(input) && submission && submissionId(submission) === evidence.submission,
    `${release}: report input identity differs`);
  requireThat(submission.vendor === version.vendor && submission.package === version.package && submission.version === version.version &&
    submission.source === version.source && submission.integrity === version.integrity, `${release}: report release differs`);
  const report = envelope.report;
  requireThat(envelope.status === 'ready' && report?.ready === true && report.vendor === version.vendor &&
    report.package === version.package && report.version === version.version, `${release}: report is not release readiness`);
  return { envelope, report };
}

// Source builds read the same durable reports as publication, only for the current defaults.
export async function hydrateEvidence(index, references, fetcher = fetch) {
  const evidence = { ...references };
  for (const entry of index.vendors) {
    const { choice } = selection(index, entry);
    if (!choice) continue;
    const id = choice.v.submission ?? choice.v.assessment, receipt = references[id];
    if (!receipt?.reportSha256) continue;
    requireThat(/^[a-f0-9]{64}$/.test(id) && /^[a-f0-9]{64}$/.test(receipt.reportSha256) &&
      receipt.reportPath === `evidence/${id}.json`, 'invalid report reference');
    const url = new URL(receipt.url);
    requireThat(url.origin === 'https://github.com' && !url.search && !url.hash &&
      new RegExp(`^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/tag/evidence-${id}-${receipt.reportSha256}$`).test(url.pathname),
      'invalid durable report URL');
    url.pathname = url.pathname.replace('/releases/tag/', '/releases/download/') + '/report.json';
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    requireThat(response.ok, `${choice.p.name}@${choice.v.version}: report download HTTP ${response.status}`);
    const envelope = await response.json();
    bindReport(envelope, { vendor: entry.vendor, package: choice.p.name, source: choice.p.source,
      ...choice.v, evidence: { submission: id, ...receipt } });
    evidence[id] = { ...receipt, envelope };
  }
  return evidence;
}

export function validateEvidence(envelope, proof, repository) {
  requireThat(digest(envelope) === proof.reportSha256, 'evidence digest differs from successful readiness receipt');
  requireThat(envelope.status === 'ready' && envelope.report?.ready === true, 'evidence is not successful package readiness');
  requireThat(envelope.input?.repository === repository && envelope.input?.pullRequest === proof.pullRequest && envelope.input?.head === proof.head && envelope.input?.base === proof.base, 'evidence PR identity differs');
  requireThat(stable(envelope.input.submission) === stable(proof.submission), 'evidence artifact identity differs');
  requireThat(envelope.inputSha256 === digest(envelope.input) && envelope.dependencyLock?.packages, 'evidence input or lock identity differs');
  if (proof.kind === 'operator') {
    requireThat(envelope.receipt?.kind === 'operator' && envelope.workflow === null && envelope.input.controller?.sourceCommit === proof.base, 'operator evidence controller identity differs');
    return envelope;
  }
  requireThat(envelope.workflow?.repository === repository && envelope.workflow.file === 'check.yml', 'evidence workflow identity differs');
  requireThat(!proof.workflow || (envelope.workflow.run === proof.workflow.run && envelope.workflow.attempt === proof.workflow.attempt), 'evidence workflow differs from bound receipt');
  return envelope;
}
export async function readinessRun(proof, github) {
  if (proof.workflow) {
    const { run: id, attempt } = proof.workflow;
    requireThat(Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(attempt) && attempt > 0, 'invalid readiness workflow run or attempt');
    const run = await github.call(`actions/runs/${id}/attempts/${attempt}`);
    requireThat(run.id === id && run.run_attempt === attempt && run.repository?.full_name === github.repository, 'readiness workflow identity differs from receipt');
    requireThat(run.path === '.github/workflows/check.yml' && ['pull_request_target', 'workflow_dispatch'].includes(run.event), 'evidence did not come from the trusted readiness workflow');
    requireThat(run.status === 'completed' && run.conclusion === 'success', 'readiness workflow attempt did not succeed');
    requireThat(run.head_sha === (run.event === 'workflow_dispatch' ? proof.base : proof.head), 'readiness workflow source commit differs from bound input');
    return run;
  }
  const url = new URL(proof.check.details_url);
  requireThat(url.origin === 'https://github.com', 'readiness evidence is not a GitHub run');
  const prefix = `/${github.repository}/actions/runs/`;
  const runId = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
  let run;
  if (/^[0-9]+$/.test(runId)) run = await github.call(`actions/runs/${runId}`);
  else {
    requireThat(url.pathname === `/${github.repository}/runs/${proof.check.id}` && Number.isSafeInteger(proof.check.check_suite?.id), 'readiness evidence run belongs to a different repository');
    const suite = proof.check.check_suite.id;
    const result = await github.call(`actions/runs?check_suite_id=${suite}&per_page=100`);
    const matches = result.workflow_runs.filter((r) => r.check_suite_id === suite && r.head_sha === proof.head && r.path === '.github/workflows/check.yml');
    requireThat(matches.length === 1, 'readiness check has no unique matching workflow run');
    run = matches[0];
  }
  requireThat(run.path === '.github/workflows/check.yml' && ['pull_request_target', 'workflow_dispatch'].includes(run.event), 'evidence did not come from the trusted readiness workflow');
  return run;
}
export async function persistEvidence(proofs, github) {
  const receipts = {};
  for (const proof of proofs) {
    const id = submissionId(proof.submission), tag = `evidence-${id}-${proof.reportSha256}`;
    let release = await github.optional(`releases/tags/${tag}`);
    let asset = release?.assets.find((a) => a.name === 'report.json');
    let envelope;
    if (proof.kind === 'operator') {
      requireThat(release && asset, 'authenticated operator evidence has disappeared');
      const retained = await readOperatorEvidence(release, github, { submission: proof.submission });
      envelope = retained.envelope;
    } else if (asset) envelope = JSON.parse((await github.download(`releases/assets/${asset.id}`)).toString('utf8'));
    else {
      const run = await readinessRun(proof, github);
      const artifacts = await github.call(`actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact = artifacts.artifacts.find((a) => a.name === `catalog-assessment-${run.id}-${run.run_attempt}` && !a.expired);
      requireThat(artifact, 'readiness report expired or missing; reassess the current PR before admission');
      const temp = mkdtempSync(join(tmpdir(), 'catalog-evidence-')), file = join(temp, 'evidence.zip');
      writeFileSync(file, await github.download(`actions/artifacts/${artifact.id}/zip`));
      // Read one member to stdout; never extract paths supplied in an archive.
      const data = spawnSync('unzip', ['-p', file, 'report.json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      requireThat(data.status === 0, 'readiness artifact contains no readable report');
      envelope = JSON.parse(data.stdout);
      requireThat(envelope.workflow?.run === run.id && envelope.workflow?.attempt === run.run_attempt, 'evidence workflow differs from artifact source');
      validateEvidence(envelope, proof, github.repository);
      if (!release) release = await github.call('releases', 'POST', { tag_name: tag, target_commitish: proof.commit, name: `Assessment ${proof.submission.package}@${proof.submission.version}`, body: `Readiness report SHA-256: ${proof.reportSha256}\nAdmission PR: #${proof.pullRequest}`, draft: false, prerelease: true });
      asset = await github.upload(release.upload_url, 'report.json', Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`));
    }
    validateEvidence(envelope, proof, github.repository);
    // The resolved dependency lock is retained in the report identity; workflow diagnostics are supplementary.
    receipts[id] = { ...(proof.kind === 'operator' ? { kind: 'operator', authority: proof.operator.authority } : {}), pullRequest: proof.pullRequest, url: release.html_url, reportSha256: proof.reportSha256, reportPath: `evidence/${id}.json`, ...(proof.moderation ? { moderation: proof.moderation } : {}), envelope };
  }
  return receipts;
}
