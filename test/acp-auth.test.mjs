import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {createAcpRuntime} from '../lib/acp-client.mjs';
import {authOutputReader,googleAuthorizationUrl} from '../lib/acp-auth.mjs';
import {interactiveJobs} from '../lib/acp-jobs.mjs';
const fixture=fileURLToPath(new URL('./fixtures/mock-acp.mjs',import.meta.url));
const settings={acpEntry:'cli',acpExecutable:process.execPath,model:'mock-gemini',contextChars:50000};
const url='https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A18901%2F&state=fixture-only';
// Each case makes the mock hang at one phase and gives only that phase a short limit. The other
// phases get generous limits, so a machine busy with the rest of the test suite (a slow start of
// the mock process) is not mistaken for the timeout under test.
const relaxed={initialize:8000,authenticate:5000,session:5000,config:5000};
function runtime(env={},short={}){return createAcpRuntime({validate:()=>{},timeouts:{...relaxed,...short},launch:(exe,args,options)=>spawn(exe,[fixture],{...options,env:{...options.env,...env}})});}
test('auth URL reader handles fragmented UTF8, large and duplicate URLs, rejects callbacks and untrusted addresses',()=>{
 const found=[],reader=authOutputReader(u=>found.push(u)),long=url+'&scope='+'a'.repeat(16000),bytes=Buffer.from('授权地址 '+long+'\n');
 for(let i=0;i<bytes.length;i+=17)reader.push(bytes.subarray(i,i+17));reader.push(Buffer.from(long+'\n'));reader.push(Buffer.from('access_token=secret\nhttps://evil.example/login\n'));reader.flush();assert.deepEqual(found,[long]);
 for(const bad of [url.replace('accounts.google.com','accounts.google.com.evil.example'),url.replace('https:','http:'),url.replace('127.0.0.1','remote.example'),url+'&code=secret',url+'&access_token=secret','http://127.0.0.1:18901/?code=secret',url.replace('/v2/auth','/token')])assert.equal(googleAuthorizationUrl(bad),null);
});
test('personal auth finishes without session/new, repeated login reuses verified auth, model timeout names the separate phase',async()=>{
 const r=runtime({MOCK_ACP_HANG:'session'},{session:100}),events=[];try{
  const result=await r.run(settings,{action:'login',onUpdate:u=>events.push(u)});assert.equal(result.authenticated,true);assert.deepEqual(result.models,[]);assert(!events.some(e=>e.phase==='session'));
  const again=[];await r.run(settings,{action:'login',onUpdate:u=>again.push(u)});assert(!again.some(e=>e.phase==='authenticate'));
  await assert.rejects(r.run(settings,{action:'inspect'}),/已认证.*读取模型列表超时/);
 }finally{await r.disconnect();}
});
test('startup and authorization timeouts are distinct, cancellation releases slot, auth URL only exists while pending',async()=>{
 const startup=runtime({MOCK_ACP_HANG:'initialize'},{initialize:1000});try{await assert.rejects(startup.run(settings,{action:'login'}),/尚未进入 Google/);}finally{await startup.disconnect();}
 const r=runtime({MOCK_ACP_AUTH_URL:'1',MOCK_ACP_HANG:'authenticate'},{authenticate:500}),jobs=interactiveJobs();try{
  const job=jobs.start(options=>r.run(settings,{...options,action:'login'}));let state;for(let i=0;i<200;i++){state=jobs.get(job.id);if(state.authorizationUrl)break;await sleep(5);}assert.equal(state.authorizationUrl,url);assert.equal(state.phase,'authenticate');assert(state.phaseStarted);jobs.cancel(job.id);
  for(let i=0;i<300&&jobs.get(job.id).status==='running';i++)await sleep(10);assert.equal(jobs.get(job.id).status,'cancelled');assert.equal(jobs.get(job.id).authorizationUrl,undefined);assert.equal(r.busy,false);
 }finally{await jobs.close();await r.disconnect();}
 const auth=runtime({MOCK_ACP_HANG:'authenticate'},{authenticate:500});try{await assert.rejects(auth.run(settings,{action:'login'}),/个人账号认证超时/);}finally{await auth.disconnect();}
});
