import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zipFixture} from './helpers/zip-fixture.mjs';
import {contentHash} from '../lib/materials.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('published PPT terms reach actual preparation, session translation, Deep Dive, weekly synthesis and every QA scope',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-term-flow-')),seen=[];
 const mock=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),system=body.messages[0].content,input=JSON.parse(body.messages[1].content);seen.push({system,input});
  let output='Evidence summary';
  if(system.includes('Deep Dive issue plan'))output=JSON.stringify({centralQuestion:'How does comparison change the argument?',issues:[{question:'How does comparison change the argument?',searchQueries:['comparison','distant reading','opacity']}]});
  else if(system.includes('Reconstruct classroom'))output=JSON.stringify({segments:input.cues.map(c=>({chapter:'Reading',speaker:'Lecturer',cueIds:[c.id],english:c.text}))});
  else if(system.includes('Paragraph translation'))output=JSON.stringify({chinese:'我们讨论远读。'});
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:output}}]}));
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const api=async(route,value)=>{const res=await fetch(base+route,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});const data=await res.json();assert(res.ok,JSON.stringify(data));return data;};
  await api('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'mock',model:'mock',visionEnabled:false});
  const project=await api('/api/projects',{name:'Terminology'}),route='/api/projects/'+project.id,bytes=zipFixture([['ppt/slides/slide1.xml','one']]);
  const upload=async(role,name,bytes,session)=>{const res=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':role,'x-file-name':name,...(session?{'x-session-id':session}:{})},body:bytes});assert.equal(res.status,201);return res.json();};
  const p=await upload('ppt','Lecture.pptx',bytes),f=p.files[0],term={english:'Distant reading',chinese:'远读',scope:'Moretti 的方法',pages:[1]};
  const report={schema:'classroom.ppt-visual.v1',source:{sha256:contentHash(bytes),fileName:f.name,format:'pptx',pageCount:1},learningSchema:'classroom.ppt-learning.v1',deckReview:{terms:[term]},pages:[{page:1,title:'Distant reading',hidden:false,blank:false,originalText:[{text:'Distant reading',method:'native',role:'body'}],speakerNotes:'',visualObservations:[],analysis:[],uncertainties:[],inspection:{textExtracted:true,fullPageViewed:true,status:'complete'},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'远读'}],closeReading:'远读以较大规模研究文学。'}}]};
  const imported=await fetch(base+route+'/parsed?source='+f.id,{method:'POST',headers:{'x-parse-format':'json'},body:JSON.stringify(report)});assert.equal(imported.status,200);
  const run=async(options)=>{await api(route+'/process',options);for(let i=0;i<200;i++){const p=await api(route);if(p.status!=='running'){assert.equal(p.status,'done',p.error);return p;}await sleep(20);}throw Error('timeout');};
  await run({mode:'preparation'});const s=(await api(route+'/sessions',{type:'Lecture',title:'Lecture'})).session;
  await upload('srt','Lecture.srt','1\n00:00:01,000 --> 00:00:02,000\nWe discuss distant reading.',s.id);await run({mode:'session',sessionId:s.id});await run({mode:'analysis',sessionId:s.id});await run({mode:'week'});
  for(const options of [{scope:'week'},{scope:s.id},{scope:'preparation',focus:{kind:'page',sourceId:f.id,pageIndex:0}}])await api(route+'/ask',{question:'Explain distant reading',...options});
  for(const label of ['Reconstruct classroom','Paragraph translation','Deep Dive /','Weekly synthesis','Ask this class']){const requests=seen.filter(r=>r.system.includes(label));assert(requests.length,label);for(const r of requests){assert.equal(r.input.weeklyTerminology[0].chinese,'远读',label);assert.equal(r.input.weeklyTerminology[0].sourceId,f.id);assert.deepEqual(r.input.weeklyTerminology[0].pages,[1]);assert.match(r.system,/不是课堂证据/);}}
  assert.equal(seen.filter(r=>r.system.includes('Ask this class')).length,3);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true});}
});
