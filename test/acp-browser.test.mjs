import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {testPdf} from '../lib/diagnostics.mjs';
async function until(fn){for(let i=0;i<200;i++){const value=await fn();if(value)return value;await sleep(40);}throw Error('Timed out waiting for browser state');}
test('ACP settings, diagnostics, Ask permissions, navigation, cancellation and API compatibility work through real browser',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-acp-ui-')),exe=path.join(dir,'agy_acp_server.exe'),hook=path.join(dir,'hook.mjs'),fixture=fileURLToPath(new URL('./fixtures/mock-acp.mjs',import.meta.url)).replaceAll('\\','/');await writeFile(exe,'test fixture placeholder');await writeFile(path.join(dir,'localharness_external.exe'),'matching test helper');
 await writeFile(hook,`import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const r=next(url,context);if(!url.endsWith('/lib/acp-client.mjs'))return r;return {...r,source:String(r.source).replace('export const acpRuntime=createAcpRuntime();','export const acpRuntime=createAcpRuntime({launch:(_exe,_args,options)=>spawn(process.execPath,${JSON.stringify([fixture])},options)});')};}});`);
 const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='',ui;child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  const base=await until(()=>{if(child.exitCode!==null)throw Error(log);return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
  const call=async(u,b)=>{const r=await fetch(base+u,b===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),value=await r.json();assert(r.ok,value.error);return value;};
  const profile={id:'acp-test',name:'Antigravity test',provider:'antigravity-acp',model:'mock-gemini',acpEntry:'standalone',acpExecutable:exe,contextChars:50000,visionEnabled:true};await call('/api/settings',{modelProfiles:[profile],modelRoutes:{qa:profile.id},baseUrl:'http://127.0.0.1:1/v1',apiKey:'keep-api-secret',model:'api-model'});
  const saved=await call('/api/settings');assert.equal(saved.modelProfiles[0].apiKey,undefined);assert.equal(saved.apiKey,undefined);
  for(const kind of ['text','json','vision']){
   const job=await call('/api/settings/model-test',{profile,kind});
   assert.equal(job.transport,'acp');
   await until(async()=>{
    const result=await call('/api/acp/jobs/'+job.id);
    if(result.status==='running')return false;
    assert.equal(result.status,'success',result.message);
    return true;
   });
  }
  const connect=async action=>{const j=await call('/api/acp/connect',{action,profileId:profile.id});return until(async()=>{const job=await call('/api/acp/jobs/'+j.id);if(job.status==='running')return false;assert.equal(job.status,'success',job.message);return job.result;});};
  assert.equal((await connect('inspect')).models[0].modelId,'mock-gemini');await connect('login');assert.match((await connect('text')).message,/JSON/);assert.match((await connect('vision')).message,/JSON/);
  const p=await call('/api/projects',{name:'ACP course'}),other=await call('/api/projects',{name:'Other course'}),route='/api/projects/'+p.id;await call(route+'/bb',{text:'Evidence for questions.'});
  let migrated=await call('/api/settings/editor');assert.equal(migrated.modelRoutingVersion,2);assert(!JSON.stringify(migrated).includes('keep-api-secret'));
  migrated=await call('/api/settings/editor',{section:'models',defaultProfileId:profile.id});await call('/api/settings/editor',{section:'routes',modelRoutes:{},fallbackProfileId:'',fallbackEnabled:false});
  assert.equal((await call('/api/settings')).defaultProfileId,profile.id);
  const uploaded=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':'ACP Reference.pdf'},body:testPdf()});assert.equal(uploaded.status,201);const reference=(await uploaded.json()).files.at(-1);
  const imported=await fetch(base+route+'/parsed?source='+reference.id,{method:'POST',headers:{'x-parse-format':'json'},body:JSON.stringify(Array.from({length:6},(_,index)=>({type:'text',page_idx:0,text:'ACP_REFERENCE_EVIDENCE: Original paragraph '+(index+1)+'.'})))});assert.equal(imported.status,200);
  const generation=await call(route+'/process',{mode:'reference',sourceId:reference.id});assert(generation.acpJobId,'default ACP reaches actual generation transport');await until(async()=>{const j=await call('/api/acp/jobs/'+generation.acpJobId);assert.equal(j.permission,undefined,'the start button authorizes the whole workflow');if(j.status==='running')return false;assert.equal(j.status,'success',j.message);return true;});
  assert((await call(route)).files.find(f=>f.id===reference.id).referenceTranslation.generation,'ACP generation is published after validation');
  const reader=await call(route+'/reference-reader?source='+reference.id);
  assert.equal(reader.summary.completed,6);
  assert.match(reader.paragraphs[1].chinese,/逐段译文/);
  assert.match(reader.paragraphs[0].chinese,/译文 mock-\d+ 1/);
  assert.equal(new Set(reader.paragraphs.map(row=>row.chinese.match(/mock-\d+/)?.[0])).size,1);
  await call('/api/settings',{modelRoutes:{qa:profile.id,deepDive:profile.id}});const gate=await fetch(base+route+'/process',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'analysis'})});assert.equal(gate.status,400);assert.match((await gate.json()).error,/讲稿/);await call('/api/settings',{modelRoutes:{qa:profile.id}});
  let browser=true;try{await browserExecutable();}catch{browser=false;t.diagnostic('Browser unavailable; ACP HTTP diagnostics verified.');}
  if(browser){
   ui=await launchRenderer(base,{});await ui.evaluate(`localStorage.setItem('classroom-project',${JSON.stringify(p.id)});setTimeout(()=>location.href='/',0);true`);await until(()=>ui.evaluate("document.querySelector('#title')?.textContent==='ACP course'"));
   await ui.evaluate("document.querySelector('#settings-open').click();true");await until(()=>ui.evaluate("document.querySelector('[data-model-id=acp-test]')"));await ui.evaluate("document.querySelector('[data-model-id=acp-test]').click();true");
   assert.equal(await ui.evaluate("!!document.querySelector('[data-profile=acp-test] [data-field=acpExecutable]')"),true);
   await ui.evaluate("document.querySelector('[data-settings-section=routes]').click();true");assert.equal(await ui.evaluate("document.querySelector('[data-task=deepDive] option[value=acp-test]').disabled"),false);await ui.evaluate("document.querySelector('[data-settings-section=models]').click();true");
   await ui.evaluate("[...document.querySelectorAll('[data-profile=acp-test] button')].find(b=>b.textContent==='读取模型列表').click();true");await until(()=>ui.evaluate("document.querySelector('[data-profile=acp-test] .profile-test-status')?.textContent.includes('已完成')"));
   assert.equal(await ui.evaluate("document.querySelector('[data-profile=acp-test] [data-field=model]').value"),'mock-gemini');
   assert.equal(await ui.evaluate("[...document.querySelectorAll('[data-profile=acp-test] input')].some(e=>e.type==='password')"),false);
   if(process.env.CLASSROOM_ACP_EVIDENCE){await ui.evaluate("document.querySelector('[data-profile=acp-test]').scrollIntoView({block:'start'});true");await mkdir(process.env.CLASSROOM_ACP_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_ACP_EVIDENCE,'ACP-settings.png'),await ui.screenshot(1500,1000));}
   await ui.evaluate("document.querySelector('#settings-close').click();document.querySelector('#qa-launch').click();document.querySelector('#question').value='need-permission';document.querySelector('#ask-form').requestSubmit();true");
   await until(async()=> (await call(route)).chat.length===2);
   await until(()=>ui.evaluate("!document.querySelector('#ask').disabled"));await ui.evaluate("document.querySelector('#question').value='slow-request';document.querySelector('#ask-form').requestSubmit();true");await until(()=>ui.evaluate("!!document.querySelector('#chat .acp-progress button')"));
   await ui.evaluate("[...document.querySelectorAll('#projects .project')].find(e=>e.textContent.includes('Other course')).click();true");await until(()=>ui.evaluate("document.querySelector('#title').textContent==='Other course'"));
   await ui.evaluate("[...document.querySelectorAll('#projects .project')].find(e=>e.textContent.includes('ACP course')).click();true");await until(()=>ui.evaluate("!!document.querySelector('#chat .acp-progress button')"));
   await ui.evaluate("document.querySelector('#chat .acp-progress button').click();true");await until(()=>ui.evaluate("document.querySelector('#chat').textContent.includes('停止')"));assert.equal((await call(route)).chat.length,2,'cancelled answer is not saved');
  }
 }finally{await ui?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:80});}
});
