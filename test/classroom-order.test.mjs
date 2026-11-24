import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {pipeline} from '../lib/pipeline.mjs';
import {reconstructBatch,repairWindow} from '../lib/class-reconstruction.mjs';
import {validateSegments} from '../lib/core.mjs';
import {listenSafe} from '../lib/ports.mjs';
const settings={model:'mock',baseUrl:'http://mock',contextChars:100000,maxOutputTokens:12000};
const ids=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
const segment=(cueIds,speaker,english)=>({chapter:'Discussion',cueIds,speaker,english,corrections:[]});
const cues=ids(128,252).map(id=>({id,start:'00:00:01,000',end:'00:00:02,000',text:id===191?'Lecturer: Are there any questions?':id===192?'Do you understand this criticism?':id>=193&&id<=201?'Student: Here is my question '+id+'.':'Lecturer: Explanation '+id+'.'}));
function broken(missing=true){return {segments:[segment(ids(128,190),'Lecturer','Earlier classroom speech.'),segment(ids(193,201),'Student','Here is my question.'),segment([191,...(missing?[]:[192]),...ids(202,217)],'Lecturer','Are there any questions? Do you understand this criticism? Here is the later answer.'),segment(ids(218,252),'Lecturer','Later classroom speech.')]};}
const fixed={segments:[segment([191,192],'Lecturer','Are there any questions? Do you understand this criticism?'),segment(ids(193,201),'Student','Here is my question.'),segment(ids(202,217),'Lecturer','Here is the later answer.')]};
const input={session:{id:'s',title:'Seminar'},context:'Course evidence',cues,previousForContinuityOnly:[],part:2,totalParts:5};
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-order-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('125 cues with a teacher paragraph crossing a student turn repair only 191–217, with and without a missing ID',()=>fixture(async dir=>{
 for(const missing of [true,false]){
  const original=broken(missing),requests=[],model=await pipeline(path.join(dir,String(missing)),settings,{scope:'session:s',call:async(s,system,user)=>{
   const data=JSON.parse(user);requests.push({system,data});if(system==='main')return JSON.stringify(original);assert.equal(system,'restore');assert.deepEqual(data.cues.map(c=>c.id),ids(191,217));assert.equal(data.existingParagraphs.length,2);assert.match(data.task,/Split any paragraph/);return JSON.stringify(fixed);
  }});
  const result=await reconstructBatch({model,prompt:'main',repairPrompt:'assignment',restorePrompt:'restore',input,cues});validateSegments(result.segments,cues);assert.equal(requests.length,2,'one reconstruction and one local restoration, no futile ID-only retry');assert.deepEqual(result.segments[0],original.segments[0]);assert.deepEqual(result.segments.at(-1),original.segments.at(-1));assert.deepEqual(result.segments.slice(1,-1),fixed.segments);assert.equal(result.segments[2].speaker,'Student');
  await reconstructBatch({model,prompt:'main',repairPrompt:'assignment',restorePrompt:'restore',input,cues});assert.equal(requests.length,2,'validated batch resumes without another request');
 }
}));

test('local resegmentation failure retains the original batch draft and resumes it after restart',()=>fixture(async dir=>{
 let fail=true,main=0,local=0;const original=broken(),call=async(s,system)=>{if(system==='main'){main++;return JSON.stringify(original);}assert.equal(system,'restore');local++;return JSON.stringify(fail?{segments:fixed.segments.slice(1)}:fixed);};
 const run=async()=>reconstructBatch({model:await pipeline(dir,settings,{scope:'session:s',call}),prompt:'main',repairPrompt:'assignment',restorePrompt:'restore',input,cues});
 await assert.rejects(run,/局部顺序修复未完成/);assert.equal(main,1);assert.equal(local,3);const saved=JSON.parse(await readFile(path.join(dir,'Parsed/.pipeline.json'),'utf8'));assert(Object.values(saved.drafts).some(d=>JSON.stringify(d.output)===JSON.stringify(original)),'original English remains recoverable');assert(!Object.values(saved.entries).some(e=>e.name?.startsWith('重建课堂')),'bad local output never becomes a successful batch');
 fail=false;const result=await run();assert.equal(main,1,'does not request the original batch again');assert.equal(local,4);validateSegments(result.segments,cues);
}));

test('an ID-only answer revealing an order conflict escalates once to body restoration instead of retrying IDs',()=>fixture(async dir=>{
 const localCues=ids(1,4).map(id=>({id,text:'Utterance '+id})),draft={segments:[segment([1,2],'Lecturer','Opening.'),segment([3],'Student','Last words before earlier words.')]};let assignment=0,restore=0;
 const model=await pipeline(dir,settings,{call:async(s,system,user)=>{if(system==='main')return JSON.stringify(draft);if(system==='assignment'){assignment++;return JSON.stringify({assignments:[{segmentIndex:1,cueIds:[4,3]}]});}assert.equal(system,'restore');restore++;const data=JSON.parse(user);assert.deepEqual(data.cues.map(c=>c.id),[3,4]);return JSON.stringify({segments:[segment([3],'Student','Earlier words.'),segment([4],'Student','Last words.')]});}});
 const result=await reconstructBatch({model,prompt:'main',repairPrompt:'assignment',restorePrompt:'restore',input:{...input,cues:localCues},cues:localCues});assert.equal(assignment,1);assert.equal(restore,1);validateSegments(result.segments,localCues);assert.deepEqual(result.segments[0],draft.segments[0]);
}));

test('repair windows preserve exact outside anchors and follow supplied cue order rather than sorting numbers',()=>{
 const source=[10,3,40,8,50].map(id=>({id})),segments=[segment([10],'Lecturer','Before'),segment([8],'Student','Question'),segment([3,40],'Lecturer','Wrongly merged'),segment([50],'Lecturer','After')];
 const window=repairWindow(segments,source);assert.equal(window.first,1);assert.equal(window.last,2);assert.equal(window.orderConflict,true);assert.deepEqual(window.allowed.map(c=>c.id),[3,40,8]);
 const gap=[segment([1],'Lecturer','Before'),segment([4,5],'Student','After')],missing=repairWindow(gap,ids(1,5).map(id=>({id})));assert.deepEqual(missing.allowed.map(c=>c.id),ids(1,5));assert.equal(missing.orderConflict,false,'missing IDs alone do not justify rewriting speech');
});

test('network failure during local order repair never falls back to relabelling cue IDs',()=>fixture(async dir=>{
 let main=0,local=0;const model=await pipeline(dir,settings,{backoff:async()=>{},call:async(s,system)=>{if(system==='main'){main++;return JSON.stringify(broken());}assert.equal(system,'restore');local++;const e=Error('offline');e.httpStatus=503;throw e;}});
 await assert.rejects(()=>reconstructBatch({model,prompt:'main',repairPrompt:'assignment',restorePrompt:'restore',input,cues}),/offline/);assert.equal(main,1);assert.equal(local,3);
}));

test('server loads the local restoration Skill and publishes a chronological transcript without starting Deep Dive',()=>fixture(async dir=>{
 const requests=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const original={segments:[segment([1],'Lecturer','Opening.'),segment([4,5],'Student','Student: Could you explain this point?'),segment([2,3,6],'Lecturer','Lecturer: Are there questions? Lecturer: Here is the answer.')]};
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),system=b.messages[0].content,input=JSON.parse(b.messages[1].content);requests.push({system,input});let answer='Course background.';
  if(system.includes('Reconstruct classroom local span')){assert.deepEqual(input.cues.map(c=>c.id),[2,3,4,5,6]);assert.equal(input.existingParagraphs.length,2);answer=JSON.stringify({segments:[segment([2,3],'Lecturer','Lecturer: Are there questions?'),segment([4,5],'Student','Student: Could you explain this point?'),segment([6],'Lecturer','Lecturer: Here is the answer.')]});}
  else if(system.includes('Reconstruct classroom'))answer=JSON.stringify(original);
  else if(system.includes('Paragraph translation'))answer=JSON.stringify({chinese:'按原顺序保留课堂发言。'});
  else assert(!/Deep Dive|Weekly synthesis/.test(system),'transcript repair never launches analysis');
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:answer}}]}));
 });await listenSafe(mock);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const api=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),v=await r.json();assert(r.ok,JSON.stringify(v));return v;};
  await api('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'mock-only',model:'mock'});const p=await api('/api/projects',{name:'Chronological seminar'}),route='/api/projects/'+p.id;await api(route+'/bb',{text:'Classroom questions and answers.'});const s=(await api(route+'/sessions',{type:'Seminar',title:'Seminar'})).session;
  const text=['Lecturer: Opening.','Lecturer: Are there','questions?','Student: Could you explain','this point?','Lecturer: Here is the answer.'];
  const uploaded=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'srt','x-file-name':'Seminar.srt','x-session-id':s.id},body:text.map((text,i)=>`${i+1}\n00:00:0${i},000 --> 00:00:0${i+1},000\n${text}`).join('\n\n')});assert.equal(uploaded.status,201);
  await api(route+'/process',{mode:'session',sessionId:s.id});let state;for(let i=0;i<250;i++){state=await api(route);if(state.status!=='running')break;await sleep(20);}assert.equal(state.status,'done',state.error);
  const timeline=await api(route+'/transcript?session='+s.id);assert.equal(timeline.available,true);assert.deepEqual(timeline.paragraphs.map(p=>p.cueIds),[[1],[2,3],[4,5],[6]]);assert.deepEqual(timeline.paragraphs.map(p=>p.speaker),['Lecturer','Lecturer','Student','Lecturer']);assert.deepEqual(timeline.paragraphs.map(p=>p.startMs),[0,1000,3000,5000]);
  assert.equal(requests.filter(r=>r.system.includes('Reconstruct classroom local span')).length,1);assert.equal(requests.filter(r=>r.system.includes('# Reconstruct classroom /')).length,1);assert.equal(requests.filter(r=>r.system.includes('Paragraph translation')).length,4);assert(!state.weekly);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));}
}));
