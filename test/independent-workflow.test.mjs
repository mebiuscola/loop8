import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {scriptState,analysisState,weeklyState} from '../public/workflow.js';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {pipeline} from '../lib/pipeline.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('forcing an analysis rerun preserves transcript checkpoints and shared material notes',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-task-cache-'));let calls=0;const settings={model:'mock',baseUrl:'mock',contextChars:40000},call=async()=>{calls++;return 'saved output';};
 try{
  let model=await pipeline(dir,settings,{scope:'session:l',call});await model.text('Transcript','prompt','source');await model.text('构建课程上下文 · source','prompt','material');await model.finish();assert.equal(calls,2);
  model=await pipeline(dir,settings,{scope:'analysis:l',fresh:true,call});await model.text('Analysis','prompt','evidence');await model.text('构建课程上下文 · source','prompt','material');await model.finish();assert.equal(calls,3,'fresh analysis reuses shared material notes');
  model=await pipeline(dir,settings,{scope:'session:l',call});await model.text('Transcript','prompt','source');await model.finish();assert.equal(calls,3,'transcript cache survives independent analysis reruns');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('independent freshness follows selected transcript evidence, never analysis generations or other sessions',()=>{
 const p={materialRevision:1,sessions:[{id:'l',generation:'l1',materialRevision:1,revision:1,outputRevision:1,artifactStatus:{deepDive:'complete'},analysis:{generation:'a1',materialRevision:1,scriptGeneration:'l1',outputRevision:1}},{id:'s',generation:'s1',materialRevision:1,revision:1,outputRevision:1}],weekly:{generation:'w1',materialRevision:1,selectedSessionIds:['l'],availableSessionIds:['l','s'],sessionInputs:[{id:'l',generation:'l1',revision:1}]}};
 assert.deepEqual(scriptState(p,p.sessions[0]),{available:true,stale:false});assert.equal(analysisState(p,p.sessions[0]).stale,false);assert.equal(weeklyState(p).stale,false);
 p.sessions[0].analysis.generation='a2';assert.equal(weeklyState(p).stale,false,'updating a single analysis cannot invalidate weekly evidence');
 p.sessions[1].revision++;assert.equal(weeklyState(p).stale,false,'excluded session changes do not invalidate selected evidence');assert.equal(scriptState(p,p.sessions[0]).stale,false);
 p.sessions[0].generation='l2';assert.equal(analysisState(p,p.sessions[0]).stale,true);assert.equal(weeklyState(p).stale,true);
 p.sessions[0].generation='l1';p.materialRevision++;assert.equal(scriptState(p,p.sessions[0]).stale,true);
 const legacy={...p.sessions[0],analysis:undefined,materialRevision:2};assert.equal(analysisState(p,legacy).available,true,'legacy complete analyses remain readable');
 const pending={materialRevision:1,sessions:[{id:'pending',revision:1}],weekly:{generation:'w',materialRevision:1,selectedSessionIds:[],availableSessionIds:[],knownSessionIds:['pending'],pendingSessionInputs:[{id:'pending',revision:1}],sessionInputs:[]}};assert.equal(weeklyState(pending).stale,false);pending.sessions[0].revision++;assert.equal(weeklyState(pending).stale,true,'new subtitles in an unfinished classroom make weekly coverage outdated');
});

test('actual UI and HTTP tasks keep scripts, per-session analysis and selected weekly analysis independent, preserve results on failure',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-independent-'));const seen=[];let failAnalysis=false,ui;
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),system=b.messages[0].content,user=b.messages[1].content;let input;try{input=JSON.parse(user);}catch{}seen.push({system,input});let answer='Course background notes.';
  if(system.includes('Reconstruct classroom'))answer=JSON.stringify({segments:input.cues.map(c=>({chapter:'Discussion',speaker:'Lecturer',cueIds:[c.id],english:c.text}))});
  else if(system.includes('Paragraph translation'))answer=JSON.stringify({chinese:'课堂中文翻译。'});
  else if(system.includes('Deep Dive issue plan'))answer=JSON.stringify({centralQuestion:'What does scale explain?',issues:[{question:'What does scale explain?',searchQueries:['scale']}]});
  else if(system.includes('Deep Dive /')){if(failAnalysis){res.writeHead(503);return res.end('{}');}answer='## Single analysis\n\nLecturer says: the question of scale.\n\nAnalysis: a distinct argument.';}
  else if(system.includes('Weekly synthesis'))answer='## Weekly analysis\n\nAnalysis: compare the selected classroom evidence.';
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:answer}}]}));
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const api=async(url,body)=>{const r=await call(url,body);assert(r.status<300,JSON.stringify(r.value));return r.value;};
  await api('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'mock-only',model:'mock'});const p=await api('/api/projects',{name:'Independent week'}),route='/api/projects/'+p.id;await api(route+'/bb',{text:'This week considers scale and comparison.'});
  const lecture=(await api(route+'/sessions',{type:'Lecture',title:'Lecture'})).session,seminar=(await api(route+'/sessions',{type:'Seminar',title:'Seminar'})).session;
  const upload=async(s,text)=>{const r=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'srt','x-file-name':s.title+'.srt','x-session-id':s.id},body:'1\n00:00:01,000 --> 00:00:03,000\n'+text});assert.equal(r.status,201);};
  const wait=async()=>{for(let i=0;i<300;i++){const state=await api(route);if(state.status!=='running')return state;await sleep(20);}throw Error('task timeout');};
  const run=async body=>{await api(route+'/process',body);return wait();};
  await upload(lecture,'LECTURE_ONLY: scale.');await upload(seminar,'SEMINAR_ONLY: a different question.');
  assert.equal((await call(route+'/process',{mode:'analysis',sessionId:lecture.id})).status,400);assert.equal(seen.length,0,'missing transcript fails before model calls');
  let state=await run({mode:'session',sessionId:lecture.id});assert.equal(state.status,'done',state.error);assert(!state.weekly);assert(!seen.some(r=>/Deep Dive|Weekly synthesis/.test(r.system)),'script does not plan or write analysis');
  state=await run({mode:'session',sessionId:seminar.id});assert(!state.weekly);assert.equal(state.sessions[0].artifactStatus.deepDive,'not_generated');
  const transcriptGeneration=state.sessions[0].generation,scriptFile=path.join(dir,'classes',p.id,'Output/Sessions',lecture.id,'Class_Script_Bilingual.md'),originalScript=await readFile(scriptFile,'utf8');
  let browser=true;try{await browserExecutable();}catch{browser=false;t.diagnostic('Browser unavailable; independent HTTP flow still checked.');}
  const uiWait=async expression=>{for(let i=0;i<180;i++){try{if(await ui.evaluate(expression))return;}catch{}await sleep(40);}throw Error('UI timeout: '+expression);};
  if(browser){
   ui=await launchRenderer(base,{});await ui.evaluate("setTimeout(()=>location.href='/',0);true");await uiWait("!!document.querySelector('#surface-analysis')&&!document.querySelector('#workspace').hidden");
   assert.equal(await ui.evaluate("[...document.querySelectorAll('.workspace-nav > button')].map(b=>b.textContent).join('|')"),'本周材料|材料阅读|课堂讲稿|Deep Dive');
   await ui.evaluate("document.querySelector('#surface-transcripts').click();true");await uiWait("document.querySelector('#process').textContent.includes('本节讲稿')");assert.equal(await ui.evaluate("document.querySelector('#view-week').hidden"),true);
   await ui.evaluate("document.querySelector('#surface-analysis').click();true");await uiWait("!document.querySelector('#analysis-plan').hidden&&document.querySelector('#process').textContent.includes('整周')");
   await ui.evaluate(`(()=>{const c=document.querySelector('[data-session-id="${seminar.id}"]');c.checked=false;c.dispatchEvent(new Event('change'));document.querySelector('#process').click();return true;})()`);await uiWait("document.querySelector('#process').textContent.includes('正在处理')");state=await wait();
  }else state=await run({mode:'week',sessionIds:[lecture.id]});
  assert.equal(state.status,'done',state.error);assert.deepEqual(state.weekly.selectedSessionIds,[lecture.id]);const weeklyGeneration=state.weekly.generation;
  const packet=seen.find(r=>r.system.includes('Weekly synthesis')).input;assert.equal(packet.sessions.length,1);assert.equal(packet.sessions[0].id,lecture.id);assert(!JSON.stringify(packet.sessions).includes('SEMINAR_ONLY'));assert.equal(packet.pendingSessions[0].id,seminar.id);
  if(browser){
   await uiWait("!document.querySelector('#process').disabled");await ui.evaluate("document.querySelector('#view-preparation').click();true");await uiWait("document.querySelector('#process').textContent.includes('本节 Deep Dive')&&!document.querySelector('#process').disabled");await ui.evaluate("document.querySelector('#process').click();true");await uiWait("document.querySelector('#process').textContent.includes('正在处理')");state=await wait();
  }else state=await run({mode:'analysis',sessionId:lecture.id});
  assert.equal(state.status,'done',state.error);assert.equal(state.sessions[0].generation,transcriptGeneration);assert.equal(state.weekly.generation,weeklyGeneration);assert.equal(await readFile(scriptFile,'utf8'),originalScript);
  const singlePacket=seen.find(r=>r.system.includes('Deep Dive /')).input;assert(JSON.stringify(singlePacket).includes('LECTURE_ONLY'));assert(!JSON.stringify(singlePacket).includes('SEMINAR_ONLY'));
  const analysisUrl=route+'/output?scope='+lecture.id+'&name=Deep_Dive.md',analysisText=await (await fetch(base+analysisUrl)).text(),analysisGeneration=state.sessions[0].analysis.generation;
  failAnalysis=true;state=await run({mode:'analysis',sessionId:lecture.id,fresh:true});assert.equal(state.status,'error');assert.equal(state.sessions[0].analysis.generation,analysisGeneration);assert.equal(await (await fetch(base+analysisUrl)).text(),analysisText);assert.equal(state.weekly.generation,weeklyGeneration);assert.equal(state.tasks['analysis:'+lecture.id].status,'error');failAnalysis=false;
  const previousCalls=seen.length;await upload(lecture,'LECTURE_ONLY: revised scale.');assert.equal((await call(route+'/process',{mode:'analysis',sessionId:lecture.id})).status,400);assert.equal(seen.length,previousCalls,'stale transcript stops before model calls');state=await api(route);assert.equal(scriptState(state,state.sessions[1]).stale,false);assert.equal(analysisState(state,state.sessions[0]).stale,true);assert.equal(weeklyState(state).stale,true);
  state=await run({mode:'session',sessionId:lecture.id});assert.equal(state.weekly.generation,weeklyGeneration);assert.equal(state.sessions[0].analysis.generation,analysisGeneration);assert.equal(analysisState(state,state.sessions[0]).stale,true);assert.equal(await (await fetch(base+analysisUrl)).text(),analysisText,'updating transcript retains the readable old analysis with stale metadata');
  state=await run({mode:'analysis',sessionId:lecture.id});assert.equal(analysisState(state,state.sessions[0]).stale,false);assert.equal(state.weekly.generation,weeklyGeneration);
  const lastScript=state.sessions[0].generation;state=await run({mode:'week',sessionIds:[]});assert.deepEqual(state.weekly.selectedSessionIds,[]);assert.equal(state.sessions[0].generation,lastScript);assert.equal(weeklyState(state).stale,false,'explicit materials-only analysis is valid');
  assert.equal((await call(route+'/process',{mode:'week',sessionIds:['unknown']})).status,400);
  if(browser&&process.env.CLASSROOM_WORKFLOW_EVIDENCE){await mkdir(process.env.CLASSROOM_WORKFLOW_EVIDENCE,{recursive:true});await ui.evaluate("document.querySelector('#surface-analysis').click();document.querySelector('#view-week').click();true");await uiWait("!document.querySelector('#process').disabled");await writeFile(path.join(process.env.CLASSROOM_WORKFLOW_EVIDENCE,'Independent-Deep-Dive.png'),await ui.screenshot(1500,1100));}
  const readingUpload=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':'Unparsed.pdf'},body:'Original PDF fixture'});assert.equal(readingUpload.status,201);const reading=(await readingUpload.json()).files.find(f=>f.role==='reading');
  await api('/api/settings',{clearApiKey:true,model:'',clearMineruToken:true});const callsBeforeMineru=seen.length;
  state=await run({mode:'reading',sourceId:reading.id});assert.equal(state.status,'error');assert.match(state.error,/MinerU.*Token/);assert.equal(state.files.find(f=>f.id===reading.id).parseStatus,'failed');assert.equal(seen.length,callsBeforeMineru,'explicit MinerU tasks never require or call an LLM');assert.equal(state.sessions[0].generation,lastScript);
 }finally{await ui?.close();child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true});}
});
