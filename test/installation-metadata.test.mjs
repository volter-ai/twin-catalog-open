import test from 'node:test';
import assert from 'node:assert/strict';
import { installationMetadata, integrityOf } from '../lib/registry.mjs';
const candidate={package:'@outside/fixture',version:'0.0.1',integrity:integrityOf(Buffer.from('immutable fixture'))};
const release={name:candidate.package,version:candidate.version,dist:{integrity:candidate.integrity}};
const document=(entry=release)=>({name:candidate.package,versions:{[candidate.version]:entry}});
const response=(status,body)=>({status,ok:status===200,json:async()=>body});
function clock(){let time=0;const sleeps=[];return {now:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;},windowMs:30,intervalMs:15,sleeps};}

test('installation confirmation recovers missing package and missing version without changing identity',async()=>{
 assert.ok(process.env.VOLTER_WORLD,'run the scoped confirmation cases through a World');
 const replies=[response(404),response(200,{name:candidate.package,versions:{}}),response(200,document())];const timing=clock();let calls=0;
 const actual=await installationMetadata(candidate,'https://registry.npmjs.org',async(url,options)=>{
  calls++;assert.equal(url,'https://registry.npmjs.org/%40outside%2Ffixture');assert.equal(options.headers.accept,'application/vnd.npm.install-v1+json');assert.equal(options.redirect,'error');return replies.shift();
 },timing);
 assert.deepEqual(actual,release);assert.equal(calls,3);assert.deepEqual(timing.sleeps,[15,15]);
});
test('installation confirmation refuses HTTP errors and conflicting identities immediately',async()=>{
 for(const reply of [response(401),response(403),response(429),response(500),response(200,{...document(),name:'@attacker/fixture'}),response(200,document({...release,version:'0.0.2'})),response(200,document({...release,dist:{integrity:integrityOf(Buffer.from('substituted bytes'))}})),response(200,{name:candidate.package,versions:null})]){
  let calls=0;const timing=clock();await assert.rejects(installationMetadata(candidate,'https://registry.npmjs.org',async()=>{calls++;return reply;},timing));assert.equal(calls,1);assert.deepEqual(timing.sleeps,[]);
 }
});
test('installation confirmation expires without uploading or extending its read window',async()=>{
 for(const reply of [response(404),response(200,{name:candidate.package,versions:{}})]){
  let calls=0;const timing=clock();await assert.rejects(installationMetadata(candidate,'https://registry.npmjs.org',async()=>{calls++;return reply;},timing),/retry confirmation, never upload/);assert.equal(calls,3);assert.deepEqual(timing.sleeps,[15,15]);
 }
});
test('installation confirmation rejects mutable input and malformed registry data',async()=>{
 for(const change of [{version:'latest'},{package:'https://attacker.example/file'},{integrity:undefined}]){
  await assert.rejects(installationMetadata({...candidate,...change},'https://registry.npmjs.org',()=>{throw new Error('must not fetch invalid input');},clock()),/requires/);
 }
 await assert.rejects(installationMetadata(candidate,'http://registry.npmjs.org',()=>{throw new Error('must not fetch HTTP registry');},clock()),/HTTPS/);
 await assert.rejects(installationMetadata(candidate,'https://registry.npmjs.org',async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('malformed JSON');}}),clock()),/malformed JSON/);
});
