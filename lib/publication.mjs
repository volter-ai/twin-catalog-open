import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { accountMatches, admit, digest, loadIndex, read, requireThat, selection, stable, submissionId, validateIndex, write } from './model.mjs';
import { contentIdentity, retainedContent } from './content.mjs';
import { readOperatorEvidence } from './operator-evidence.mjs';

export function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  requireThat(r.status === 0, `git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
}
export function submissions(root) {
  return ['submissions', 'reassessments'].flatMap((kind) => {
    const dir = join(root, kind);
    return existsSync(dir) ? readdirSync(dir).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).sort().map((f) => {
      const submission = read(join(dir, f));
      requireThat(f === `${submissionId(submission)}.json`, 'submission name/identity mismatch');
      const path = `${kind}/${f}`;
      const commit = git(root, ['log', '--diff-filter=A', '--format=%H', '--', path]).split('\n')[0];
      requireThat(/^[a-f0-9]{40}$/.test(commit), `${path} is not in the committed admission ledger`);
      return { submission, path, reassessment: kind === 'reassessments', commit, at: git(root, ['show', '-s', '--format=%cI', commit]) };
    }) : [];
  });
}
export function builtIndex(root) {
  const index = loadIndex(root);
  // Recommendations may refer to admitted submissions not yet present in legacy vendors/.
  const recommendations = index.recommendations, revocations = index.revocations;
  index.recommendations = {}; index.revocations = [];
  for (const item of submissions(root)) admit(index, item.submission, item.commit, item.at, item.reassessment);
  index.recommendations = recommendations; index.revocations = revocations;
  validateIndex(index);
  return index;
}
export function build(root, out, evidence = {}) {
  requireThat(!existsSync(out), 'build output must be a new directory');
  const index = builtIndex(root);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const version = `0.2.${git(root, ['rev-list', '--first-parent', '--count', 'HEAD'])}`;
  const references = Object.fromEntries(Object.entries(evidence).map(([id, { envelope, ...receipt }]) => [id, receipt]));
  const current = index.vendors.flatMap((entry) => {
    const { choice } = selection(index, entry);
    return choice ? [{ vendor: entry.vendor, package: choice.p.name, source: choice.p.source, ...choice.v }] : [];
  });
  const reportIds = new Set(current.map((v) => v.submission ?? v.assessment));
  const contentIds = new Set(current.map((v) => submissionId(contentIdentity(v))));
  const content = Object.fromEntries(Object.entries(retainedContent(root, index)).filter(([id]) => contentIds.has(id)));
  const contentBinding = Object.keys(content).length ? { content } : {};
  const identity = digest({ evidence: references, sources: index.sources, vendors: index.vendors, recommendations: index.recommendations, revocations: index.revocations, ...contentBinding });
  mkdirSync(out, { recursive: true });
  write(join(out, 'sources.json'), index.sources);
  write(join(out, 'recommendations.json'), index.recommendations);
  write(join(out, 'revocations.json'), index.revocations);
  for (const e of index.vendors) write(join(out, 'vendors', `${e.vendor}.json`), e);
  const catalog = { schemaVersion: 1, sourceCommit: commit, digest: identity, versions: index.vendors.flatMap((e) => e.packages.flatMap((p) => p.versions.map((v) => ({ vendor: e.vendor, package: p.name, source: p.source, ...v, evidence: (v.submission ?? v.assessment) ? { submission: v.submission ?? v.assessment, admissionCommit: v.assessmentCommit ?? v.commit, ...(references[v.submission ?? v.assessment] ?? {}) } : null, assessed: Boolean(v.submission ?? v.assessment) })))) };
  write(join(out, 'catalog.json'), catalog);
  if (Object.keys(content).length) {
    catalog.content = content;
    write(join(out, 'catalog.json'), catalog);
    for (const { path } of Object.values(content)) write(join(out, path), read(join(root, path)));
  }
  for (const [id, receipt] of Object.entries(evidence)) if (reportIds.has(id) && receipt.reportSha256) {
    requireThat(receipt.envelope, `current default report is missing: ${id}`);
    write(join(out, 'evidence', `${id}.json`), receipt.envelope);
  }
  const pkg = { ...read(join(root, 'package.json')), version, catalog: { sourceCommit: commit, digest: identity } };
  delete pkg.devDependencies;
  write(join(out, 'package.json'), pkg);
  for (const path of ['bin', 'lib', 'runner', 'docs', 'README.md', 'policy.json', 'LICENSE']) if (existsSync(join(root, path))) cpSync(join(root, path), join(out, path), { recursive: true });
  return { version, sourceCommit: commit, digest: identity, directory: out };
}

function authorizedMaintainer(pr, policy, mergerPermission) {
  return Array.isArray(policy.reviewBypassUsers) && policy.reviewBypassUsers.includes(pr.merged_by?.login) &&
    ['admin', 'maintain'].includes(mergerPermission);
}
export function trustedAccountAdmission(pr, policy, mergerPermission) {
  return Boolean(accountMatches(pr.user, policy.trustedAccounts) && authorizedMaintainer(pr, policy, mergerPermission));
}

export function internalAdmission(pr, source, policy, mergerPermission) {
  const bot = pr.user.type === 'Bot' && (pr.user.login === 'github-actions[bot]' ||
    (Array.isArray(policy.internalBotAuthors) && policy.internalBotAuthors.some((author) =>
      Number.isSafeInteger(author?.id) && author.id > 0 && author.id === pr.user.id && author.login === pr.user.login)));
  return Boolean(source && Array.isArray(policy.internalRepositories) && policy.internalRepositories.includes(source.repository) &&
    authorizedMaintainer(pr, policy, mergerPermission) &&
    pr.head.repo?.full_name === pr.base.repo?.full_name && pr.base.repo?.full_name &&
    (bot || (pr.user.type !== 'Bot' && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association))));
}
export function reviewSatisfied(pr, reviews, checks, internal = false, operatorReady = false) {
  const latest = new Map();
  for (const r of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) latest.set(r.user.login, r);
  }
  const decisions = [...latest.values()].filter((r) => r.commit_id === pr.head.sha);
  return Boolean(pr.merged_at) && (internal || decisions.some((r) => r.state === 'APPROVED' && r.user.login !== pr.user.login && r.user.type !== 'Bot' && !r.user.login.endsWith('[bot]') && ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(r.author_association))) && !decisions.some((r) => r.state === 'CHANGES_REQUESTED') && (operatorReady || checks.some((c) => c.name === 'catalog/readiness' && c.head_sha === pr.head.sha && c.conclusion === 'success' && c.app?.slug === 'github-actions'));
}
export async function verifyAdmission(root, github, policyClient = github) {
  requireThat(git(root, ['status', '--porcelain']) === '', 'publication requires a clean committed catalog checkout');
  const main = await github.call('git/ref/heads/main');
  requireThat(main.object?.sha === git(root, ['rev-parse', 'HEAD']), 'publication must use current main; retry the latest source commit');
  requireThat(/^\*\s+@/m.test(await github.content('.github/CODEOWNERS', main.object.sha)), 'catalog needs moderator CODEOWNERS over every path');
  const owners = await github.call('codeowners/errors?ref=main');
  requireThat(Array.isArray(owners.errors) && owners.errors.length === 0, 'catalog CODEOWNERS has invalid moderators');
  // Admission authority and bound evidence replace CI merge gates. Historical receipt verification remains below.
  const evidenceReleases = await github.pages('releases');
  const proofs = [];
  const policy = read(join(root, 'policy.json'));
  const sources = loadIndex(root).sources;
  for (const item of submissions(root)) {
    const pulls = await github.pages(`commits/${item.commit}/pulls`);
    let accepted = false;
    for (const p of pulls.filter((p) => p.merged_at && p.base.ref === 'main')) {
      const pr = await github.call(`pulls/${p.number}`);
      const files = await github.pages(`pulls/${p.number}/files`);
      if (files.length !== 1 || files[0].status !== 'added' || files[0].filename !== item.path) continue;
      const contents = JSON.parse(await github.content(files[0].filename, pr.head.sha));
      if (stable(contents) !== stable(item.submission)) continue;
      const reviews = await github.pages(`pulls/${p.number}/reviews`);
      const checks = await github.call(`commits/${pr.head.sha}/check-runs?check_name=catalog%2Freadiness&filter=latest&per_page=100`);
      const source = sources.find((s) => s.name === item.submission.source);
      requireThat(typeof pr.merged_by?.login === 'string', 'admission has no merger identity');
      const permission = (await policyClient.call(`collaborators/${encodeURIComponent(pr.merged_by.login)}/permission`)).permission;
      if (!['admin', 'maintain'].includes(permission)) continue;
      const trusted = trustedAccountAdmission(pr, policy, permission);
      const internal = internalAdmission(pr, source, policy, permission);
      const operatorReports = [];
      const prefix = `evidence-${submissionId(item.submission)}-`;
      for (const release of evidenceReleases.filter(candidate => candidate.tag_name?.startsWith(prefix))) {
        const asset = release.assets?.find(candidate => candidate.name === 'report.json');
        if (!asset) continue;
        const bytes = await github.download(`releases/assets/${asset.id}`);
        const envelope = JSON.parse(bytes.toString('utf8'));
        if (envelope.receipt?.kind !== 'operator') continue;
        // Evidence for a superseded head remains historical, never current readiness.
        if (envelope.input?.head !== pr.head.sha || envelope.input?.pullRequest !== pr.number) continue;
        operatorReports.push(await readOperatorEvidence(release, github, { pr, submission: item.submission }));
      }
      requireThat(operatorReports.length <= 1, 'conflicting operator readiness receipts for this admitted head');
      const operator = operatorReports[0];
      if (operator && reviewSatisfied(pr, reviews, [], trusted || internal, true)) {
        proofs.push({ ...item, pullRequest: pr.number, head: pr.head.sha, base: operator.envelope.input.base,
          reportSha256: operator.reportSha256, kind: 'operator', operator,
          moderation: { mode: trusted ? 'trusted-account-merge' : internal ? 'internal-maintainer-merge' : 'human-review',
            mergedBy: pr.merged_by.login, ...(trusted ? { account: { id: pr.user.id, login: pr.user.login, type: pr.user.type } } : {}) } });
        accepted = true; break;
      }
      if (reviewSatisfied(pr, reviews, checks.check_runs, trusted || internal)) {
        const check = checks.check_runs.find((c) => c.name === 'catalog/readiness' && c.head_sha === pr.head.sha && c.conclusion === 'success' && c.app?.slug === 'github-actions');
        const parts = (check.external_id ?? '').split(':');
        requireThat([4, 6].includes(parts.length) && parts[0] === String(pr.number) && parts[1] === pr.head.sha && /^[a-f0-9]{40}$/.test(parts[2]) && /^[a-f0-9]{64}$/.test(parts[3]), 'readiness check has no bound evidence receipt');
        let workflow;
        if (parts.length === 6) {
          requireThat(/^[1-9][0-9]*$/.test(parts[4]) && /^[1-9][0-9]*$/.test(parts[5]) && Number.isSafeInteger(Number(parts[4])) && Number.isSafeInteger(Number(parts[5])), 'readiness receipt has an invalid workflow run or attempt');
          workflow = { run: Number(parts[4]), attempt: Number(parts[5]) };
        }
        proofs.push({ ...item, pullRequest: pr.number, head: pr.head.sha, base: parts[2], reportSha256: parts[3], ...(workflow ? { workflow } : {}), check, moderation: { mode: trusted ? 'trusted-account-merge' : internal ? 'internal-maintainer-merge' : 'human-review', mergedBy: pr.merged_by.login, ...(trusted ? { account: { id: pr.user.id, login: pr.user.login, type: pr.user.type } } : {}) } });
        accepted = true; break;
      }
    }
    requireThat(accepted, `${submissionId(item.submission)}: no reviewed current-head admission with successful readiness`);
  }
  return proofs;
}

