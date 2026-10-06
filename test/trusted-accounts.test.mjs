import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { submissionId, write } from '../lib/model.mjs';
import { trustedAccountAdmission, verifyAdmission } from '../lib/publication.mjs';

const account = { id: 253602084, login: 'portable-one', type: 'User' };
const sha = 'a'.repeat(40);
const at = '2026-10-05T00:00:00Z';

test('account trust requires exact GitHub identity and an authorized merger', () => {
  const pr = { user: account, merged_by: { login: 'maintainer' } };
  const policy = { trustedAccounts: [account], reviewBypassUsers: ['maintainer'] };
  assert.equal(trustedAccountAdmission(pr, policy, 'admin'), true);
  assert.equal(trustedAccountAdmission(pr, policy, 'maintain'), true);
  for (const user of [{ ...account, id: 1 }, { ...account, login: 'lookalike' }, { ...account, type: 'Bot' }]) {
    assert.equal(trustedAccountAdmission({ ...pr, user }, policy, 'admin'), false);
  }
  for (const trustedAccounts of [undefined, account, [null], [{ ...account, id: String(account.id) }], [{ ...account, id: 0 }], [{ ...account, type: undefined }]]) {
    assert.equal(trustedAccountAdmission(pr, { ...policy, trustedAccounts }, 'admin'), false);
  }
  assert.equal(trustedAccountAdmission(pr, policy, 'write'), false);
  assert.equal(trustedAccountAdmission({ ...pr, merged_by: { login: 'outsider' } }, policy, 'admin'), false);
  assert.equal(trustedAccountAdmission(pr, { ...policy, reviewBypassUsers: [] }, 'admin'), false);
});

test('publication accepts a directly trusted fork author without review and records the actual path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-trusted-author-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const source = { name: 'publisher', repository: 'publisher/packs', scope: '@publisher', official: false, protocol: '3', workflow: 'release.yml' };
  const submission = { schemaVersion: 1, source: source.name, vendor: 'tavily', package: '@publisher/tavily', version: '0.0.1', integrity: 'sha512-' + Buffer.alloc(64).toString('base64') };
  const path = `submissions/${submissionId(submission)}.json`;
  write(join(root, 'sources.json'), [source]);
  write(join(root, 'policy.json'), { trustedAccounts: [account], reviewBypassUsers: ['maintainer'], internalRepositories: [] });
  write(join(root, 'recommendations.json'), {});
  write(join(root, 'revocations.json'), []);
  write(join(root, path), submission);
  mkdirSync(join(root, '.github'), { recursive: true });
  writeFileSync(join(root, '.github/CODEOWNERS'), '* @maintainer\n');
  git('init', '-q'); git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Catalog fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic admission fixture');
  const commit = git('rev-parse', 'HEAD');
  const pr = { number: 1, merged_at: at, merged_by: { login: 'maintainer' }, author_association: 'NONE', user: { ...account }, head: { sha, repo: { full_name: 'portable-one/catalog-fork' } }, base: { ref: 'main', repo: { full_name: 'catalog/index' } } };
  const check = { name: 'catalog/readiness', head_sha: sha, conclusion: 'success', app: { slug: 'github-actions' }, external_id: `1:${sha}:${commit}:${'b'.repeat(64)}` };
  let permission = 'admin', reviews = [];
  const github = {
    repository: 'catalog/index',
    content: async (file) => file === '.github/CODEOWNERS' ? '* @maintainer' : JSON.stringify(submission),
    pages: async (route) => route.endsWith('/pulls') ? [pr] : route.endsWith('/files') ? [{ filename: path, status: 'added' }] : reviews,
    call: async (route) => {
      if (route === 'git/ref/heads/main') return { object: { sha: commit } };
      if (route.startsWith('codeowners/errors')) return { errors: [] };
      if (route === 'branches/main/protection') return { enforce_admins: { enabled: true }, required_status_checks: { strict: true, contexts: ['catalog/readiness'] }, required_pull_request_reviews: { dismiss_stale_reviews: true, require_code_owner_reviews: true, require_last_push_approval: true } };
      if (route === 'pulls/1') return pr;
      if (route.startsWith('commits/')) return { check_runs: [check] };
      if (route.startsWith('collaborators/')) return { permission };
      throw new Error(`Unexpected request: ${route}`);
    }
  };
  assert.deepEqual((await verifyAdmission(root, github))[0].moderation, { mode: 'trusted-account-merge', mergedBy: 'maintainer', account });
  const legacyReceipt = check.external_id;
  check.external_id = `${legacyReceipt}:37370945933:2`;
  assert.deepEqual((await verifyAdmission(root, github))[0].workflow, { run: 37370945933, attempt: 2 });
  for (const suffix of ['0:1', 'abc:2', '37370945933:0', '9007199254740992:1', '37370945933:2:extra']) {
    check.external_id = `${legacyReceipt}:${suffix}`;
    await assert.rejects(verifyAdmission(root, github), /readiness/);
  }
  check.external_id = legacyReceipt;
  permission = 'write';
  await assert.rejects(verifyAdmission(root, github), /no reviewed current-head admission/);
  permission = 'admin';
  pr.user = { ...account, id: 1 };
  await assert.rejects(verifyAdmission(root, github), /no reviewed current-head admission/);
  reviews = [{ state: 'APPROVED', commit_id: sha, user: { id: 2, login: 'moderator', type: 'User' }, author_association: 'MEMBER' }];
  assert.equal((await verifyAdmission(root, github))[0].moderation.mode, 'human-review');
  pr.user = { ...account }; reviews = [];
  for (const change of [{ conclusion: 'cancelled' }, { head_sha: 'c'.repeat(40) }, { app: { slug: 'untrusted' } }]) {
    const original = { ...check }; Object.assign(check, change);
    await assert.rejects(verifyAdmission(root, github), /no reviewed current-head admission/);
    Object.assign(check, original);
  }
  reviews = [{ state: 'CHANGES_REQUESTED', commit_id: sha, user: { login: 'moderator', type: 'User' } }];
  await assert.rejects(verifyAdmission(root, github), /no reviewed current-head admission/);
  reviews = []; pr.merged_at = null;
  await assert.rejects(verifyAdmission(root, github), /no reviewed current-head admission/);
});
