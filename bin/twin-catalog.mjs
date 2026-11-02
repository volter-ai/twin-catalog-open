#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIndex, defaults, read, write, requireThat, stable, submissionId, validateSubmission } from '../lib/model.mjs';
import { metadata } from '../lib/registry.mjs';
import { GitHub } from '../lib/github.mjs';
import { assessPullRequest, configure } from '../lib/automation.mjs';
import { build, builtIndex } from '../lib/publication.mjs';
import { propose } from '../lib/propose.mjs';
import { browse } from '../lib/browse.mjs';
import { register } from '../lib/register.mjs';
import { captureContent } from '../lib/content.mjs';
import { recordAssessment } from '../lib/operator-evidence.mjs';
import { preparePublication, stagePublication, uploadPrepared, confirmPublication } from '../lib/prepared-publication.mjs';

const [command, ...args] = process.argv.slice(2);
const arg = (name, fallback) => { const at = args.indexOf(`--${name}`); if (at < 0) return fallback; requireThat(args[at + 1] && !args[at + 1].startsWith('--'), `--${name} needs a value`); return args[at + 1]; };
const root = resolve(arg('root', process.cwd()));
const installed = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = () => read(join(existsSync(join(root, 'policy.json')) ? root : installed, 'policy.json'));
const github = () => new GitHub(arg('repository', process.env.GITHUB_REPOSITORY ?? 'volter-ai/twin-catalog-open'), process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN);
try {
  let result;
  switch (command) {
    case 'browse': {
      const indexRoot = args.includes('--root') || existsSync(join(root, 'catalog.json')) ? root : installed;
      result = browse(indexRoot, { vendor: arg('vendor'), package: arg('package'), integrity: arg('integrity', null) });
      break;
    }
    case 'register': {
      const fork = existsSync(join(root, 'sources.json'));
      const indexRoot = fork ? root : installed;
      result = register(read(join(indexRoot, 'sources.json')), {
        name: arg('source'), repository: arg('source-repository'), scope: arg('scope'),
        official: args.includes('--official'), protocol: '3', workflow: arg('workflow', 'release.yml')
      }, resolve(arg('out', join(root, fork ? 'sources.json' : 'registration/sources.json'))));
      break;
    }
    case 'submit': {
      const indexRoot = existsSync(join(root, 'sources.json')) ? root : installed;
      const p = policy();
      const doc = await metadata(arg('package'), arg('version'), p.registry, fetch, args.includes('--confirm-published') ? {} : undefined);
      const submission = { schemaVersion: 1, source: arg('source'), vendor: arg('vendor'), package: doc.name, version: doc.version, integrity: doc.dist?.integrity };
      validateSubmission(submission, loadIndex(indexRoot).sources);
      const file = resolve(arg('out', join(resolve(arg('out-dir', join(root, args.includes('--reassess') ? 'reassessments' : 'submissions'))), `${submissionId(submission)}.json`)));
      requireThat(basename(file) === `${submissionId(submission)}.json`, 'output must be named for the submission identity');
      if (existsSync(file)) requireThat(stable(read(file)) === stable(submission), 'submission output already exists with different content');
      write(file, submission);
      result = { file, submission, next: 'Open a pull request adding only this submission file to the catalog. No publication or PR was performed.' };
      break;
    }
    case 'defaults': result = defaults(builtIndex(existsSync(join(root, 'sources.json')) ? root : installed)); break;
    case 'check': result = { valid: Boolean(builtIndex(existsSync(join(root, 'sources.json')) ? root : installed)) }; break;
    case 'assess-pr': {
      const event = process.env.GITHUB_EVENT_PATH ? read(process.env.GITHUB_EVENT_PATH) : {};
      result = await assessPullRequest(root, github(), Number(arg('pr', process.env.CATALOG_PR ?? event.pull_request?.number)), resolve(arg('out', 'assessment/report.json')));
      if (result.status !== 'ready') process.exitCode = 1;
      break;
    }
    case 'record-assessment': {
      requireThat(args.includes('--send'), 'record-assessment publishes authenticated evidence; pass --send');
      result = await recordAssessment(read(resolve(arg('report'))), github());
      break;
    }
    case 'configure': result = await configure(github(), args.includes('--apply'), policy().reviewBypassUsers ?? []); break;
    case 'propose': {
      requireThat(args.includes('--send'), 'propose opens GitHub PRs; pass --send for this explicit publisher action');
      result = await propose(github(), resolve(arg('from', args.includes('--reassess') ? 'reassessments' : 'submissions')), args.includes('--reassess'));
      break;
    }
    case 'build': result = build(root, resolve(arg('out', 'dist'))); break;
    case 'capture-content': result = await captureContent(root, builtIndex(root), policy().registry); break;
    case 'prepare-publication': {
      const client = github();
      const policyClient = process.env.CATALOG_READ_TOKEN ? new GitHub(client.repository, process.env.CATALOG_READ_TOKEN) : client;
      result = await preparePublication(root, resolve(arg('out')), client, policyClient);
      break;
    }
    case 'stage-publication': {
      requireThat(args.includes('--send'), 'stage-publication uploads prepared data; pass --send');
      result = await stagePublication(root, resolve(arg('from')), arg('tag'), resolve(arg('sweep')), github());
      break;
    }
    case 'upload-prepared': result = await uploadPrepared(root, arg('tag'), arg('sha256'), github()); break;
    case 'confirm-publication': result = await confirmPublication(read(resolve(arg('receipt'))), policy().registry); break;
    case 'publish': throw new Error('Direct publication is retired. Prepare, review and keys-sweep the exact archive outside CI, then use stage-publication and the registered publish.yml workflow with manager permission.');
    default: throw new Error('usage: twin-catalog register --source <id> --source-repository <owner/repo> --scope <@scope> [--out <sources.json>] | submit --source <id> --vendor <vendor> --package <@scope/name> --version <exact> | browse [--root <installed-index>] [--vendor <vendor>] [--package <@scope/name>] | capture-content | assess-pr --pr <number> | record-assessment --report <file> --send | check | defaults | build --out <new-directory> | prepare-publication --out <new-directory> | stage-publication --from <prepared-directory> --tag <unique-tag> --sweep <receipt> --send | confirm-publication --receipt <prepared-publication.json> | configure [--apply] | propose --from <submission-directory> --send');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`twin-catalog: ${error.message ?? error}`); process.exitCode = 1; }
