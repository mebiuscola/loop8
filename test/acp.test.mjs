import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {createAcpPool,createAcpRuntime,validateAcpProfile,assertInteractiveProvider,prepareAcpLaunch} from '../lib/acp-client.mjs';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {interactiveJobs} from '../lib/acp-jobs.mjs';
import {resolveModel,modelIdentity,validateModelRouting,mergeModelProfiles} from '../lib/model-routing.mjs';
const fixture=new URL('./fixtures/mock-acp.mjs',import.meta.url),settings={provider:'antigravity-acp',acpExecutable:process.execPath,acpEntry:'cli',model:'mock-gemini',contextChars:50000,acpThinking:'high'};
const create=()=>createAcpRuntime({validate:()=>{},launch:(exe,args,options)=>spawn(exe,[fixture.pathname.replace(/^\/(.:)/,'$1')],options)});
test('ACP pool runs separate child processes, cancels only the targeted turn and reuses a scoped text session',async()=>{
 const primary=create(),pool=createAcpPool(2,{primary,create});
 const first=new AbortController(),second=new AbortController();
 const readyA=Promise.withResolvers(),readyB=Promise.withResolvers();
 try{
  const taskA=pool.acquire(runtime=>runtime.run(settings,{user:'slow-request',signal:first.signal,onRequest:readyA.resolve}),first.signal);
  const stopped=assert.rejects(taskA,/取消/);
  await readyA.promise;
  const taskB=pool.acquire(runtime=>{
   assert.notEqual(runtime,primary);
   return runtime.run(settings,{user:'independent page',signal:second.signal,onRequest:readyB.resolve});
  },second.signal);
  await readyB.promise;
  first.abort();
  assert.match(await taskB,/independent page/);
  await stopped;
  const firstText=JSON.parse(await primary.run(settings,{user:'first batch',sessionGroup:'document-A'}));
  const nextText=JSON.parse(await primary.run(settings,{user:'second batch',sessionGroup:'document-A'}));
  const otherText=JSON.parse(await primary.run(settings,{user:'other batch',sessionGroup:'document-B'}));
  assert.equal(firstText.sessionId,nextText.sessionId);
  assert.notEqual(nextText.sessionId,otherText.sessionId);
 }finally{first.abort();second.abort();await pool.close();await primary.disconnect();}
});
test('ACP profile routing does not inherit HTTP keys, rejects arbitrary executables and distinguishes model cache identity',()=>{
 const profile={id:'acp',name:'ACP',provider:'antigravity-acp',model:'g',acpEntry:'cli',acpExecutable:'C:\\Official\\agy.exe'},s={apiKey:'secret',baseUrl:'http://default',model:'api',modelProfiles:[profile],modelRoutes:{qa:'acp'}};
 validateModelRouting(s);const actual=resolveModel(s,'qa');assert.equal(actual.apiKey,undefined);assert.equal(actual.baseUrl,undefined);assert.equal(resolveModel(s,'context').provider,'api');assert.notEqual(modelIdentity(actual),modelIdentity({...actual,provider:'api'}));assert.notEqual(modelIdentity(actual),modelIdentity({...actual,acpThinking:'high'}));assert.throws(()=>validateAcpProfile({...profile,acpExecutable:'C:\\x\\run.cmd'}));assert.throws(()=>validateAcpProfile({...profile,acpEntry:'standalone'}));assert.doesNotThrow(()=>assertInteractiveProvider(actual,'deepDive'));assert.doesNotThrow(()=>assertInteractiveProvider(actual,'qa'));assert.equal(mergeModelProfiles({modelProfiles:[]},{modelProfiles:[{...profile,apiKey:'never-store'}]})[0].apiKey,'');
});
test('standalone accepts the real official filename, requires its sibling helper and overrides an inherited harness path',async()=>{
 const profile={provider:'antigravity-acp',acpEntry:'standalone',acpExecutable:'C:\\Official\\agy_acp_server.exe'};assert.doesNotThrow(()=>validateAcpProfile(profile));assert.throws(()=>validateAcpProfile({...profile,acpExecutable:'C:\\Official\\antigravity-acp.exe'}),/agy_acp_server/);assert.throws(()=>validateAcpProfile({...profile,acpEntry:'cli'}),/不一致/);
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-acp-layout-')),executable=path.join(dir,'agy_acp_server.exe'),helper=path.join(dir,'localharness_external.exe');try{
  await writeFile(executable,'fixture');const p={...settings,acpEntry:'standalone',acpExecutable:executable};
  await assert.rejects(prepareAcpLaunch(p),/localharness_external/);await mkdir(helper);await assert.rejects(prepareAcpLaunch(p),/localharness_external/);await rm(helper,{recursive:true});await writeFile(helper,'matching fixture helper');
  const inherited={KEEP:'yes',ANTIGRAVITY_HARNESS_PATH:'C:\\wrong.exe',GEMINI_API_KEY:'secret'},spec=await prepareAcpLaunch(p,inherited);assert.deepEqual(spec.args,[]);assert.equal(spec.env.ANTIGRAVITY_HARNESS_PATH,helper);assert.equal(spec.env.KEEP,'yes');assert.equal(spec.env.GEMINI_API_KEY,undefined);assert.equal(inherited.GEMINI_API_KEY,'secret');
  const cli=await prepareAcpLaunch({...settings,acpExecutable:process.execPath},inherited);assert.deepEqual(cli.args,['acp']);assert.equal(cli.env.ANTIGRAVITY_HARNESS_PATH,undefined);
  const runtime=createAcpRuntime({validate:()=>{},launch:(exe,args,options)=>{assert.equal(options.env.ANTIGRAVITY_HARNESS_PATH,helper);assert.notEqual(options.cwd,dir);assert.deepEqual(args,[]);return spawn(process.execPath,[fixture.pathname.replace(/^\/(.:)/,'$1')],options);}});
  try{const meta=await runtime.run(p,{action:'handshake'});assert.equal(meta.imageInput,true);await runtime.run(p,{user:'Standalone request'});}finally{await runtime.disconnect();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('official SDK stdio handshake, personal auth, new sessions, model config, images, streaming and refusal',async()=>{
 const runtime=create();try{
  const meta=await runtime.run(settings,{action:'inspect'});assert.equal(meta.models[0].modelId,'mock-gemini');assert.equal(meta.imageInput,true);assert.equal(meta.credits,'unknown');
  await runtime.run(settings,{action:'login'});let chunks=[];
  const first=JSON.parse(await runtime.run(settings,{system:'skill task',user:'question',onUpdate:(update,text)=>chunks.push(text)}));
  assert(first.text.includes('skill task'));assert(!first.text.includes('system_prompt'));assert.equal(chunks.at(-1).includes('private thought'),false);
  const second=JSON.parse(await runtime.run(settings,{system:'skill',user:'second'}));assert.notEqual(first.sessionId,second.sessionId);
  const selected={...settings,model:'mock-other',acpThinking:'low'};
  const selection=await runtime.run(selected,{action:'inspect'});
  assert.equal(selection.currentModel,'mock-other');
  const status=[];
  await runtime.run(selected,{user:'another model',onUpdate:update=>status.push(update.text)});
  assert(status.some(text=>text?.includes('Mock Other · low')));
  assert.deepEqual(JSON.parse(await runtime.run(settings,{system:'read image',user:'code?',json:true,images:['data:image/png;base64,AAAA']})),{code:'Q7M4Z9'});
  await assert.rejects(runtime.run({...settings,model:'made-up-model'},{user:'hi'}),/可用模型/);
  await assert.rejects(runtime.run(settings,{user:'refuse-request'}),/refusal/);
 }finally{await runtime.disconnect();}
});
test('ACP stops before sending a prompt when model or thinking selection is not confirmed',async()=>{
 const runtime=createAcpRuntime({validate:()=>{},launch:(exe,args,options)=>spawn(exe,[fixture.pathname.replace(/^\/(.:)/,'$1')],{...options,env:{...options.env,MOCK_ACP_IGNORE_CONFIG:'1'}})});
 try{
  let sent=false;
  const onRequest=()=>{sent=true;};
  await assert.rejects(runtime.run({...settings,model:'mock-other'},{user:'test',onRequest}),/未确认切换/);
  await assert.rejects(runtime.run(settings,{user:'test',onRequest}),/未确认所选模型和思考强度/);
  assert.equal(sent,false);
 }finally{await runtime.disconnect();}
});
test('permission is explicit and once-only; cancellation releases busy slot and crashed process reconnects',async()=>{
 const runtime=create();try{
  let permissions;
  await runtime.run(settings,{user:'need-permission',onPermission:async p=>{permissions=p;return 'once';}});assert(!permissions.options.some(o=>o.kind==='allow_always'));
  const abort=new AbortController();let ready;const started=new Promise(r=>ready=r);
  const pending=runtime.run(settings,{user:'slow-request',signal:abort.signal,onRequest:ready});await started;
  await assert.rejects(runtime.run(settings,{user:'other'}),/另一项交互/);abort.abort();await assert.rejects(pending,/取消/);assert.equal(runtime.busy,false);
  await assert.rejects(runtime.run(settings,{user:'crash-runtime'}),/ACP/);await runtime.run(settings,{user:'after crash'});
 }finally{await runtime.disconnect();}
});
test('interactive jobs require permission ID, never accept always-allow, stop abandoned work and retain final status',async()=>{
 const jobs=interactiveJobs({abandonMs:50});try{
  const initial=jobs.start(async options=>{await options.onPermission({toolCall:{title:'Read'},options:[{optionId:'once',kind:'allow_once'},{optionId:'always',kind:'allow_always'}]},options.signal);return {answer:'ok'};});await sleep(5);
  const waiting=jobs.get(initial.id);assert.equal(waiting.permission.options.length,1);assert.throws(()=>jobs.decide(initial.id,'wrong','once'));assert.throws(()=>jobs.decide(initial.id,waiting.permission.id,'always'));jobs.decide(initial.id,waiting.permission.id,'once');await sleep(5);assert.equal(jobs.get(initial.id).status,'success');
  const other=jobs.start(async options=>{await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));options.signal.throwIfAborted();});await sleep(120);assert.equal(jobs.get(other.id).status,'cancelled');
 }finally{await jobs.close();}
});
