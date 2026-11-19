import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateModelSettings,resolveModel,validateModelRouting,MODEL_TASKS} from '../lib/model-routing.mjs';
import {acpInteraction,interactiveAcpCall} from '../lib/acp-interaction.mjs';
import {interactiveJobs} from '../lib/acp-jobs.mjs';
import {setTimeout as sleep} from 'node:timers/promises';
import {adaptiveQueue} from '../lib/ai-material.mjs';
const legacy={baseUrl:'https://api.example/v1',apiKey:'default-secret',model:'default',contextChars:180000,maxOutputTokens:12000,outputTokenField:'max_tokens',visionEnabled:true,parseModel:'vision',parseApiKey:'vision-secret',parseBaseUrl:'https://vision.example/v1',fallbackModel:'rescue',fallbackApiKey:'rescue-secret',modelProfiles:[{id:'special',name:'Special',baseUrl:'https://special.example/v1',model:'special',apiKey:''}],modelRoutes:{deepDive:'special'}};
test('editor migration preserves every effective legacy model, inherited key, weekly and PPT routes; is idempotent',()=>{
 const s=migrateModelSettings(legacy);validateModelRouting(s);assert.equal(s.modelRoutingVersion,2);assert.deepEqual(migrateModelSettings(s),s);assert.equal(legacy.modelProfiles.length,1);
 for(const task of Object.keys(MODEL_TASKS)){const old=resolveModel(legacy,task),next=resolveModel(s,task);for(const key of ['baseUrl','apiKey','model'])assert.equal(next[key],old[key],task+' '+key);}
 assert(s.fallbackProfileId);assert.equal(s.modelProfiles.find(p=>p.id===s.fallbackProfileId).apiKey,'rescue-secret');
});
test('ACP can be the default for existing tasks, overrides win, and trials require explicit assignment',()=>{
 const s=migrateModelSettings(legacy),p={id:'acp',name:'ACP',provider:'antigravity-acp',model:'account-model',acpEntry:'standalone',acpExecutable:'C:\\official\\agy_acp_server.exe'};s.modelProfiles.push(p);s.defaultProfileId=p.id;s.modelRoutes={};validateModelRouting(s);
 for(const task of Object.keys(MODEL_TASKS).filter(task=>task!=='pptPreview')){const actual=resolveModel(s,task);assert.equal(actual.provider,'antigravity-acp');assert.equal(actual.model,'account-model');assert.equal(actual.apiKey,undefined);assert.equal(actual.baseUrl,undefined);}
 assert.equal(resolveModel(s,'pptPreview').model,'');assert.throws(()=>validateModelRouting({...s,modelRoutes:{pptPreview:p.id}}),/ChatGPT/);
 s.modelRoutes.pptTranslation='special';assert.equal(resolveModel(s,'pptTranslation').model,'special');assert.equal(resolveModel(s,'pptExplanation').model,'account-model');p.model='';assert.equal(resolveModel(s,'qa').model,'');s.defaultProfileId='';assert.equal(resolveModel(s,'context').model,'');
});
test('generated ACP requests require an explicit observed continuation; stopping aborts pending workflow requests',async()=>{
 const jobs=interactiveJobs(),calls=[];try{
  const job=jobs.start(options=>acpInteraction.run(options,()=>interactiveAcpCall(async actual=>{calls.push(actual.acpInteractive);return 'answer';},{model:'ACP'},'skill','input',{json:true})));await sleep(5);assert.deepEqual(calls,[]);const p=jobs.get(job.id).permission;assert.equal(p.options[0].optionId,'continue');jobs.decide(job.id,p.id,'continue');await sleep(5);assert.deepEqual(calls,[true]);assert.equal(jobs.get(job.id).status,'success');
  const stop=jobs.start(options=>acpInteraction.run(options,()=>interactiveAcpCall(()=>{throw Error('must not call');},{model:'ACP'},'skill','input',{})));await sleep(5);const next=jobs.get(stop.id).permission;jobs.decide(stop.id,next.id,'stop');await sleep(5);assert.equal(jobs.get(stop.id).status,'cancelled');
 }finally{await jobs.close();}
});
test('shared material workers preserve the interactive context of queued requests across workflows',async()=>{
 const queue=adaptiveQueue(1);let release;const first=queue.run(()=>new Promise(r=>release=r));await sleep(1);const marker={workflow:'observed'},next=acpInteraction.run(marker,()=>queue.run(()=>acpInteraction.getStore()));release();await first;assert.equal(await next,marker);
});

test('user-started automatic ACP tasks finish multiple turns and tool permissions without a browser observer',async()=>{
 const jobs=interactiveJobs({autoApprove:true,abandonMs:0});let completed=false;
 try{
  const job=jobs.start(options=>acpInteraction.run(options,async()=>{
   // Longer than a short observation timer; no polling or permission decisions.
   await sleep(75);
   const answers=await Promise.all([1,2,3].map(i=>interactiveAcpCall(async actual=>{
    actual.signal.throwIfAborted();assert(actual.acpInteractive);
    const chosen=await actual.onPermission({toolCall:{title:'Task action '+i},options:[{optionId:'persist',kind:'allow_always'},{optionId:'one-'+i,kind:'allow_once'}]},actual.signal);
    assert.equal(chosen,'one-'+i);return i;
   },{model:'ACP'},'skill','input',{})));
   assert.deepEqual(answers,[1,2,3]);completed=true;return 'done';
  }));
  await sleep(120);assert(completed);assert.equal(jobs.get(job.id).status,'success');assert.equal(jobs.get(job.id).permission,undefined);
  const waiting=jobs.start(async options=>{await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));options.signal.throwIfAborted();});
  await sleep(5);jobs.cancel(waiting.id);await sleep(5);assert.equal(jobs.get(waiting.id).status,'cancelled');
 }finally{await jobs.close();}
});
