import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {listenSafe} from '../lib/ports.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('independent transcript and Deep Dive tasks preserve readable outputs and retry analysis without reconstructing or translating',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-stages-'));let base,route,sessionId,fail=true,rebuild=0,translation=0,dive=0,readDuringDive=0;
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),system=b.messages[0].content,user=b.messages[1].content;let answer='Shared material notes';
  if(system.includes('Deep Dive issue plan'))answer=JSON.stringify({centralQuestion:'How does comparison change the argument?',issues:[{question:'How does comparison change the argument?',searchQueries:['comparison','distant reading','opacity']}]});
  else if(system.includes('Reconstruct classroom')){rebuild++;assert.equal(b.response_format.type,'json_object');const input=JSON.parse(user);answer=JSON.stringify({segments:input.cues.map(c=>({chapter:'Discussion',speaker:'Student',cueIds:[c.id],english:c.text}))});}
  else if(system.includes('Paragraph translation')){translation++;assert.equal(b.response_format.type,'json_object');answer=JSON.stringify({chinese:'学生提出异议。'});}
  else if(system.includes('Deep Dive /')){dive++;const input=JSON.parse(user);assert.equal(input.session.generation,undefined);assert.equal(input.session.artifactStatus,undefined);const transcript=await (await fetch(base+route+'/transcript?session='+sessionId)).json();assert.equal(transcript.available,true);assert.equal(transcript.paragraphs.length,1);assert.equal((await fetch(base+route+'/output?scope='+sessionId+'&name=Class_Script_Bilingual.md')).status,200);readDuringDive++;if(fail){res.writeHead(503);return res.end('{}');}answer='## Analysis\n\nStudent discussion stays distinct.';}
  else if(system.includes('Weekly synthesis'))answer='## Weekly analysis';
  else if(system.includes('Ask this class'))answer='Student discussion is in the available transcript.';
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:answer}}]}));
 });await listenSafe(mock);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const api=async(url,value)=>{const r=await fetch(base+url,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)}),data=await r.json();assert(r.ok,JSON.stringify(data));return data;};
  await api('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'mock',model:'mock'});const p=await api('/api/projects',{name:'Recovery'});route='/api/projects/'+p.id;await api(route+'/bb',{text:'Shared course introduction.'});sessionId=(await api(route+'/sessions',{type:'Seminar',title:'Seminar'})).session.id;
  async function upload(text){const r=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'srt','x-file-name':'Seminar.srt','x-session-id':sessionId},body:text});assert.equal(r.status,201);}
  await upload('1\n00:00:01,000 --> 00:00:02,000\nStudent: I disagree with this reading.');
  const run=async(mode='session')=>{await api(route+'/process',{mode,sessionId});for(let i=0;i<500;i++){const p=await api(route);if(p.status!=='running')return p;await sleep(20);}throw Error('timeout');};
  let state=await run();assert.equal(state.status,'done',state.error);assert.equal(dive,0);assert.equal(state.weekly,undefined);const scriptGeneration=state.sessions[0].generation;state=await run('analysis');assert.equal(state.status,'error',state.error);assert.equal(rebuild,1);assert.equal(translation,1);assert.equal(state.sessions[0].artifactStatus.script,'complete');assert.equal(state.sessions[0].artifactStatus.deepDive,'not_generated');assert.equal(state.tasks['analysis:'+sessionId].status,'error');assert.equal(dive,3);assert.equal(readDuringDive,3);assert.equal((await fetch(base+route+'/output?scope='+sessionId+'&name=Deep_Dive.md')).status,400);await api(route+'/ask',{scope:sessionId,question:'What did the student say?'});
  fail=false;state=await run('analysis');assert.equal(state.sessions[0].generation,scriptGeneration);assert.equal(state.status,'done',state.error);assert.equal(rebuild,1);assert.equal(translation,1);assert.equal(dive,4);assert.equal(state.sessions[0].artifactStatus.deepDive,'complete');assert.equal((await fetch(base+route+'/output?scope='+sessionId+'&name=Deep_Dive.md')).status,200);assert.match(await readFile(path.join(dir,'classes',p.id,'Output/Sessions',sessionId,'Class_Script_Bilingual.md'),'utf8'),/I disagree/);
  const bad='1\n00:99:01,000 --> 00:99:02,000\nInvalid time',rejected=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'srt','x-file-name':'Bad.srt','x-session-id':sessionId},body:bad});assert.equal(rejected.status,400,'new invalid uploads fail before storage');
  const srt=state.files.find(f=>f.id===state.sessions[0].srtId);await writeFile(path.join(dir,'classes',p.id,'Source',srt.stored),bad);const count=rebuild+translation+dive;state=await run();assert.equal(state.status,'error');assert.match(state.error,/时间/);assert.equal(rebuild+translation+dive,count,'invalid stored SRT cannot consume model calls');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true});}
});
