import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readinessRun,validateEvidence} from '../lib/evidence.mjs';
import {assessPullRequest} from '../lib/automation.mjs';
import {digest,write} from '../lib/model.mjs';

// Actual metadata from policy PR 7: GitHub put the successful manual check in an older cancelled PR suite.
const repository='volter-ai/twin-catalog-rollout-test';
const head='8cb2d4ce95381e0df0ab28725cc75f42dab0359a';
const base='a70e91328b47cae43de65d893b97f74506a31d34';
const check={id:111973278024,check_suite:{id:101226656845},details_url:`https://github.com/${repository}/runs/111973278024`};
const workflow={run:37370945933,attempt:2};
const successfulRun={id:workflow.run,run_attempt:2,repository:{full_name:repository},head_sha:base,path:'.github/workflows/check.yml',event:'workflow_dispatch',status:'completed',conclusion:'success'};
const proof={head,base,check,workflow};

test('manual recovery follows the recorded successful attempt, not GitHub’s old cancelled suite',async()=>{
 const calls=[];
 const github={repository,call:async path=>{calls.push(path);assert.equal(path,'actions/runs/37370945933/attempts/2');return successfulRun;}};
 assert.deepEqual(await readinessRun(proof,github),successfulRun);
 assert.deepEqual(calls,['actions/runs/37370945933/attempts/2']);
 const target={...successfulRun,event:'pull_request_target',head_sha:head};
 assert.equal((await readinessRun(proof,{repository,call:async()=>target})).head_sha,head);
});

test('receipt resolution refuses different source, attempt, repository, event and failed execution',async()=>{
 for(const change of [{id:1},{run_attempt:1},{repository:{full_name:'outside/fork'}},{path:'.github/workflows/other.yml'},{event:'push'},{head_sha:head},{status:'queued'},{conclusion:'failure'}]) {
  await assert.rejects(readinessRun(proof,{repository,call:async()=>({...successfulRun,...change})}));
 }
 await assert.rejects(readinessRun(proof,{repository,call:async()=>({...successfulRun,event:'pull_request_target'})}),/source commit/);
 for(const workflow of [{run:0,attempt:2},{run:37370945933,attempt:0},{run:'37370945933',attempt:2},{run:37370945933,attempt:NaN}]) {
  await assert.rejects(readinessRun({...proof,workflow},{repository,call:async()=>{throw new Error('invalid receipt must make no request');}}),/invalid readiness/);
 }
});

test('durable evidence also matches the receipt attempt when the GitHub display association is replaced',()=>{
 const submission={package:'@fixture/search',version:'0.0.1'};
 const input={repository,pullRequest:8,head,base,submission};
 const envelope={status:'ready',report:{ready:true},input,inputSha256:digest(input),dependencyLock:{packages:{}},workflow:{repository,file:'check.yml',...workflow}};
 const bound={...proof,pullRequest:8,submission,reportSha256:digest(envelope)};
 assert.equal(validateEvidence(envelope,bound,repository),envelope);
 assert.throws(()=>validateEvidence(envelope,{...bound,workflow:{...workflow,attempt:1}},repository),/differs from bound receipt/);
});

test('trusted controller records the actual workflow run and attempt with the report digest',async()=>{
 const root=mkdtempSync(join(tmpdir(),'catalog-workflow-receipt-'));
 for(const [file,value] of Object.entries({'sources.json':[],'recommendations.json':{},'revocations.json':[],'policy.json':{}}))write(join(root,file),value);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Synthetic metadata fixture');
 const base=git('rev-parse','HEAD');
 const pr={state:'open',number:8,head:{sha:head},base:{sha:base},changed_files:1};
 let completed;
 const github={repository,pages:async path=>path.endsWith('/files')?[{filename:'README.md',status:'modified'}]:[],call:async(path,method,data)=>{
  if(path==='pulls/8')return pr;
  if(path==='check-runs')return{id:42};
  if(path==='check-runs/42'){completed=data;return{id:42};}
  if(path==='issues/8/comments')return{id:1};
  throw new Error(`Unexpected route ${path}`);
 }};
 const previous={run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
 process.env.GITHUB_RUN_ID=String(workflow.run);process.env.GITHUB_RUN_ATTEMPT=String(workflow.attempt);
 try{
  const envelope=await assessPullRequest(root,github,8,join(tmpdir(),`report-${root.split('/').at(-1)}.json`));
  assert.equal(envelope.status,'ready');
  assert.equal(completed.external_id,`8:${head}:${base}:${digest(envelope)}:${workflow.run}:${workflow.attempt}`);
  assert.equal(completed.conclusion,'success');
 }finally{
  if(previous.run===undefined)delete process.env.GITHUB_RUN_ID;else process.env.GITHUB_RUN_ID=previous.run;
  if(previous.attempt===undefined)delete process.env.GITHUB_RUN_ATTEMPT;else process.env.GITHUB_RUN_ATTEMPT=previous.attempt;
 }
});
