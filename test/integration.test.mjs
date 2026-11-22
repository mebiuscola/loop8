import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,reload,waitText} from './helpers/app.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('local workflow: parse recovery, immutable originals, complete outputs, QA, failed rerun preserves output',async t=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-check-'));let failCoverage=false,calls=0,contextActive=0,contextPeak=0;
 const mock=http.createServer(async(req,res)=>{let bytes='';for await(const c of req)bytes+=c;if(req.url==='/parse'){assert.match(bytes,/Classroom connection test/);res.setHeader('content-type','application/json');return res.end(JSON.stringify({markdown:'Classroom connection test'}));}if(req.headers.authorization==='Bearer invalid'){res.writeHead(401);return res.end('{}');}const b=JSON.parse(bytes);calls++;const system=b.messages[0].content,user=b.messages[1].content;let content;
  if(system.includes('Deep Dive issue plan'))content=JSON.stringify({centralQuestion:'How does comparison change the argument?',issues:[{question:'How does comparison change the argument?',searchQueries:['comparison','distant reading','opacity']}]});
  else if(system.includes('Reconstruct classroom')){const v=JSON.parse(user.split('\n\nFormatting retry:')[0]);content=JSON.stringify({segments:v.cues.map((c,i)=>({chapter:'Opacity',speaker:c.text.startsWith('Student:')?'Student':'Unclear speaker',cueIds:[failCoverage?999:c.id],english:c.text,corrections:[]}))});}
  else if(system.includes('Paragraph translation'))content=JSON.stringify({chinese:'这是课堂段落的中文对照。'});
  else if(system.includes('Ask this class'))content='依据 SmartSub_RAW.srt [SRT 00:00:03,100]，学生提出疑问。Analysis: 需要保留这一分歧。';
  else if(system.includes('Deep Dive /'))content='# Deep Dive\n\n**Student discussion** [SRT 00:00:03,100]: Why?\n\n**Analysis**: A test evidence note.';
  else if(system.includes('connectivity check'))content='{"status":"ok"}';
  else {contextActive++;contextPeak=Math.max(contextPeak,contextActive);await sleep(150);contextActive--;content='Evidence: opacity. [Reading page 1] / [SRT 00:00:01,000].';}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let n=0;n<100&&!log.includes('http://');n++)await sleep(50);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value};};
  const upload=async(id,role,name,text)=>{const r=await fetch(`${base}/api/projects/${id}/upload`,{method:'POST',headers:{'x-file-name':encodeURIComponent(name),'x-file-role':role},body:text});assert.equal(r.status,201,await r.clone().text());return r.json();};
  assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/api/projects',{headers:{Origin:'https://malicious.example'}})).status,403);
  assert.equal((await call('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'test-secret',model:'fixture-model',mineruExecutable:''})).status,200);
  const settings=(await call('/api/settings')).value;assert.equal(settings.hasApiKey,true);assert(!JSON.stringify(settings).includes('test-secret'));
  const diagnostic=async(kind,settings)=>{const start=await call('/api/settings/test',{kind,settings});assert.equal(start.status,202);for(let n=0;n<100;n++){const job=(await call('/api/settings/test/'+start.value.id)).value;if(job.status!=='running')return job;await sleep(20);}throw Error('diagnostic timeout');};
  let check=await diagnostic('ai',{apiKey:'draft-secret'});assert.equal(check.status,'success',check.message);assert(!JSON.stringify(check).includes('draft-secret'));assert.equal(JSON.parse(await readFile(path.join(temp,'settings.json'),'utf8')).apiKey,'test-secret');
  check=await diagnostic('ai',{apiKey:''});assert.equal(check.status,'success');
  check=await diagnostic('ai',{apiKey:'invalid'});assert.equal(check.status,'error');assert.match(check.message,/401/);
  check=await diagnostic('mineru',{mineruMode:'service',mineruUrl:`http://127.0.0.1:${mock.address().port}/parse`,model:''});assert.equal(check.status,'success',check.message);
  check=await diagnostic('mineru',{mineruMode:'cloud',mineruToken:'',clearMineruToken:true});assert.equal(check.status,'error');assert.match(check.message,/Token/);
  check=await diagnostic('mineru-connection',{mineruMode:'cloud',mineruToken:'',clearMineruToken:true});assert.equal(check.status,'error');assert.match(check.message,/Token/);assert.equal(check.limitSeconds,60);
  const p=(await call('/api/projects',{name:'05 · Theory'})).value,id=p.id;
  await call(`/api/projects/${id}/bb`,{text:'Comparative literature and opacity.'});
  const repeated=await call(`/api/projects/${id}/bb`,{text:'Comparative literature and opacity.'});
  const baseline=await call(`/api/projects/${id}`);
  await call(`/api/projects/${id}/bb`,{text:repeated.value.bbText});
  const unchanged=await call(`/api/projects/${id}`);
  assert.equal(unchanged.value.materialRevision,baseline.value.materialRevision);
  assert.equal(unchanged.value.revision,baseline.value.revision);
  const srt='1\n00:00:01,000 --> 00:00:03,000\nLet us discuss opacity.\n\n2\n00:00:03,100 --> 00:00:05,000\nStudent: Why?';
  await upload(id,'srt','SmartSub_RAW.srt',srt);let state=await upload(id,'reading','reading.pdf','original-pdf-fixture');const f=state.files.find(f=>f.role==='reading');
  const wait=async()=>{for(let i=0;i<200;i++){const p=(await call(`/api/projects/${id}`)).value;if(p.status!=='running')return p;await sleep(30);}throw Error('job timeout');};
  await call(`/api/projects/${id}/process`,{});state=await wait();assert.equal(state.status,'partial');assert.equal(state.files.find(x=>x.id===f.id).parseStatus,'pending');assert(!state.weekly);assert.equal(state.sessions[0].artifactStatus.deepDive,'not_generated');
  const manual=await fetch(`${base}/api/projects/${id}/parsed?source=${f.id}`,{method:'POST',body:'[Reading page 1]\nOpacity is a concept.'});assert.equal(manual.status,200);await call(`/api/projects/${id}/bb`,{text:'Comparative literature and opacity: revised background.'});
  await call(`/api/projects/${id}/process`,{});state=await wait();assert.equal(state.status,'done',state.error);assert.deepEqual(state.coverage,{cues:2,covered:2,segments:2});assert(calls>=7);assert(contextPeak>=2,'server must overlap independent context model HTTP requests');assert(state.parallelSummary.peak>=2);assert.equal(state.files.find(x=>x.id===f.id).parsed,f.id+'/blocks.json');
  const script=(await call(`/api/projects/${id}/output?name=Class_Script_Bilingual.md`)).value;assert.match(script,/Student/);assert.match(script,/Unclear speaker/);assert.match(script,/中文对照/);assert.doesNotMatch(script,/\[SRT|cues \d/);const timeline=(await call(`/api/projects/${id}/transcript?session=${state.sessions[0].id}`)).value;assert.equal(timeline.available,true);assert.equal(timeline.paragraphs[1].startMs,3100);assert.equal(timeline.paragraphs[1].speaker,'Student');
  const source=await readFile(path.join(temp,'classes',id,'Source',f.stored),'utf8');assert.equal(source,'original-pdf-fixture');
  assert.equal((await call(`/api/projects/${id}/ask`,{question:'学生的问题是什么？'})).status,200);
  await call(`/api/projects/${id}/process`,{mode:'week'});state=await wait();assert.equal(state.status,'done',state.error);
  failCoverage=true;await call(`/api/projects/${id}/process`,{fresh:true});state=await wait();assert.equal(state.status,'error');assert.match(state.error,/覆盖/);assert.equal((await call(`/api/projects/${id}/output?name=Class_Script_Bilingual.md`)).value,script);
  failCoverage=false;
  const sessionId=state.sessions[0].id;
  const retry=await call(`/api/projects/${id}/process`,{mode:'session',sessionId});
  assert.equal(retry.status,202);state=await wait();
  assert.equal(state.tasks['script:'+sessionId].status,'complete',state.error);
  const download=await fetch(base+`/api/projects/${id}/output?scope=${sessionId}&name=Class_Script_Bilingual.md&download=1`);
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal(await download.text(),(await call(`/api/projects/${id}/output?scope=${sessionId}&name=Class_Script_Bilingual.md`)).value);
  await t.test('reopening the transcript after reload shows the retried output',async t=>{
   try{await browserExecutable();}catch{return t.skip('Requires Edge / Chrome');}
   const ui=await launchRenderer(base,{});
   try{
    await openApp(ui,'/w/'+encodeURIComponent(id)+'/class/'+encodeURIComponent(sessionId));
    await waitText(ui,'Let us discuss opacity.','main');
    await reload(ui);
    await waitText(ui,'Let us discuss opacity.','main');
    assert(await ui.evaluate("!![...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='⋯')"),'other actions stay in the menu');
    assert.equal(await ui.evaluate("[...document.querySelectorAll('main .btn-primary')].filter(b=>/讲稿/.test(b.textContent)).length"),0,'a finished class script offers no primary generate button');
   }finally{await ui.close();}
  });
  assert((await stat(path.join(temp,'classes',id,'Output','Weekly_Deep_Dive.md'))).size>0);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(temp,{recursive:true,force:true});}
});
