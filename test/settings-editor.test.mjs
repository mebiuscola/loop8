import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
async function until(fn){for(let i=0;i<220;i++){const value=await fn();if(value)return value;await sleep(30);}throw Error('Settings UI timed out');}
test('section saves are independent, default includes ACP, model tests preserve private keys, editing never sends a request',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-settings-')),requests=[];const mock=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests.push({authorization:req.headers.authorization,body});res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({status:'ok',books:7,notes:4})}}]}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='',ui;child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  const base=await until(()=>log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);const api=async(url,b)=>{const r=await fetch(base+url,b===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const value=await r.json();assert(r.ok,value.error);return value;};
  await api('/api/settings',{baseUrl:'http://127.0.0.1:'+mock.address().port+'/v1',apiKey:'preserved-secret',model:'old-model'});
  const initial=await api('/api/settings/editor'),id=initial.defaultProfileId,profile=initial.modelProfiles.find(p=>p.id===id);assert(!JSON.stringify(initial).includes('preserved-secret'));assert(profile.hasApiKey);
  let state=await api('/api/settings/editor',{section:'model',profile:{...profile,apiKey:'',name:'My API',model:'custom-model'}});assert(state.modelProfiles.find(p=>p.id===id).hasApiKey);
  for(const kind of ['ai','vision']){let j=await api('/api/settings/model-test',{profile:{...state.modelProfiles.find(p=>p.id===id),apiKey:''},kind});j=await until(async()=>{const value=await api('/api/settings/test/'+j.id);return value.status!=='running'&&value;});assert.equal(j.status,'success',j.message);}
  assert(requests.every(r=>r.authorization==='Bearer preserved-secret'&&r.body.model==='custom-model'));
  const acp={id:'another-acp',name:'My ACP',provider:'antigravity-acp',acpEntry:'standalone',acpExecutable:'C:\\Official\\agy_acp_server.exe',model:'account-choice',contextChars:180000};await api('/api/settings/editor',{section:'model',profile:acp});await api('/api/settings/editor',{section:'models',defaultProfileId:acp.id});await api('/api/settings/editor',{section:'routes',modelRoutes:{qa:id}});state=await api('/api/settings/editor');assert.equal(state.defaultProfileId,acp.id);assert.equal(state.modelRoutes.qa,id);
  assert.equal(state.acpPaths.standalone,acp.acpExecutable);
  const cliPath='C:\\Official CLI\\agy.exe';
  const cli={...acp,id:'cli-acp',name:'CLI model',model:'another-account-choice',acpEntry:'cli',acpExecutable:cliPath};
  await api('/api/settings/editor',{section:'model',profile:cli,acpPaths:{cli:cliPath,standalone:acp.acpExecutable}});
  state=await api('/api/settings/editor');assert.deepEqual(state.acpPaths,{cli:cliPath,standalone:acp.acpExecutable});
  let browser=true;try{await browserExecutable();}catch{browser=false;t.diagnostic('Browser unavailable; settings HTTP checks completed.');}
  if(browser){ui=await launchRenderer(base,{});await ui.evaluate("setTimeout(()=>location.href='/',0);true");await until(()=>ui.evaluate("!!document.querySelector('.settings-menu')"));await ui.evaluate("document.querySelector('#settings-open').click();true");await until(()=>ui.evaluate("document.querySelector('#settings').open"));
   assert.equal(await ui.evaluate("document.querySelector('#default-model').value"),acp.id);assert.equal(await ui.evaluate("document.querySelector('#default-model option[value=another-acp]').disabled"),false);
   const switchEntry=entry=>ui.evaluate(`(()=>{const input=document.querySelector('[data-field=acpEntry]');input.value='${entry}';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));return document.querySelector('[data-field=acpExecutable]').value;})()`);
   assert.equal(await switchEntry('cli'),cliPath);
   assert.equal(await switchEntry('standalone'),acp.acpExecutable);
   assert.equal(await ui.evaluate("document.querySelector('[data-field=model]').value"),acp.model);
   await ui.evaluate("document.querySelector('.settings-footer button').click();true");
   await until(()=>ui.evaluate("document.querySelector('#settings-status').textContent==='已保存'"));
   await ui.evaluate("document.querySelector('[data-settings-section=routes]').click();true");assert.equal(await ui.evaluate("document.querySelector('[data-task=qa]').value"),id);assert.equal(await ui.evaluate("document.querySelector('[data-task=deepDive] option[value=another-acp]').disabled"),false);
   if(process.env.CLASSROOM_SETTINGS_EVIDENCE){await mkdir(process.env.CLASSROOM_SETTINGS_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_SETTINGS_EVIDENCE,'Function-models.png'),await ui.screenshot(1500,1000));}
   await ui.evaluate(`document.querySelector('[data-settings-section=models]').click();document.querySelector('[data-model-id="${id}"]').click();true`);
   assert.equal(await ui.evaluate("document.querySelector('[data-field=apiKey]').value"),'');
   await ui.evaluate("document.querySelector('[data-field=name]').value='';document.querySelector('[data-field=name]').dispatchEvent(new Event('input'));document.querySelector('[data-settings-section=mineru]').click();document.querySelector('[name=uploadConcurrency]').value='3';document.querySelector('[name=uploadConcurrency]').dispatchEvent(new Event('input'));document.querySelector('.settings-footer button').click();true");
   await until(async()=> (await api('/api/settings')).uploadConcurrency===3);assert.equal((await api('/api/settings/editor')).modelProfiles.find(p=>p.id===id).name,'My API','invalid model draft did not contaminate MinerU save');assert.equal(requests.length,2,'editing, selecting and saving never request model inference');
   await ui.evaluate("document.querySelector('[data-settings-section=models]').click();document.querySelector('[data-field=name]').value='My API';document.querySelector('[data-field=name]').dispatchEvent(new Event('input'));document.querySelector('[data-field=model]').value='another-custom-model';document.querySelector('[data-field=model]').dispatchEvent(new Event('input'));document.querySelector('.settings-footer button').click();true");
   await until(async()=> (await api('/api/settings/editor')).modelProfiles.find(p=>p.id===id).model==='another-custom-model');
   if(process.env.CLASSROOM_SETTINGS_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_SETTINGS_EVIDENCE,'AI-models.png'),await ui.screenshot(1500,1000));
   await ui.evaluate("document.querySelector('#settings-close').click();true");assert.equal(await ui.evaluate("document.querySelector('#settings').open"),false);
  }
 }finally{await ui?.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));mock.closeAllConnections();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
});
