import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrateWeek,addSession,stale} from '../lib/week.mjs';
import {pptPages,pageImages} from '../lib/pages.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('legacy project migration preserves original file paths, generation, speaker coverage and chat',()=>{
 const old={revision:4,outputRevision:4,generation:'original-generation',files:[{id:'srt1',stored:'original.srt',role:'srt'}],coverage:{cues:2},chat:[{text:'old'}]};
 const p=migrateWeek(old);assert.equal(p.sessions[0].generation,'original-generation');assert.equal(p.sessions[0].srtId,'srt1');assert.equal(p.files[0].stored,'original.srt');assert.equal(p.chat[0].text,'old');assert.equal(stale(p,'srt1'),false);assert.equal(migrateWeek(p).sessions.length,1);
 const s=addSession(p,{type:'Seminar'});assert.equal(stale(p,'srt1'),false);assert.equal(stale(p,s.id),true);p.materialRevision++;assert.equal(stale(p,'srt1'),true);
});

test('preparation without SRT, shared materials across two sessions, scoped QA, latest-only outputs and interrupted synthesis',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-week-'));let materialCalls=0,failWeekly=false,seenAsk,visionCalls=0,bbCalls=0;const sessionInputs=[],weekInputs=[];
 const mock=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const request=JSON.parse(raw),system=request.messages[0].content;
  const user=request.messages[1].content,text=Array.isArray(user)?user[0].text:user;let value;try{value=JSON.parse(text.split('\n\nFormatting retry:')[0]);}catch{}let content;
  if(system.includes('Deep Dive issue plan'))content=JSON.stringify({centralQuestion:'How does comparison change the argument?',issues:[{question:'How does comparison change the argument?',searchQueries:['comparison','distant reading','opacity']}]});
  else if(system.includes('Blackboard question extraction')){bbCalls++;content=JSON.stringify({questions:[]});}
  else if(system.includes('Preparation bilingual answers'))content=JSON.stringify({english:'Comparison reveals differences.',chinese:'比较揭示差异。',evidence:'Reading page 1',uncertainty:'Await classroom verification.'});
  else if(system.includes('PPT body translation'))content=JSON.stringify({paragraphs:value.paragraphs.map(p=>({id:p.id,chinese:'比较文学：共同材料'}))});
  else if(system.includes('PPT close reading')){if(Array.isArray(user)){visionCalls++;assert(user.some(p=>p.type==='image_url'));}content=value.original?'A method of comparison. 一种比较的方法。':'No original body text available.';}
  else if(system.includes('Reconstruct classroom')){sessionInputs.push(value);content=JSON.stringify({segments:value.cues.map(c=>({chapter:'Comparison',speaker:c.text.startsWith('Student:')?'Student':'Lecturer',cueIds:[c.id],english:c.text}))});}
  else if(system.includes('Paragraph translation'))content=JSON.stringify({chinese:'课堂中文段落。'});
  else if(system.includes('Weekly synthesis')){weekInputs.push(value);if(failWeekly){res.writeHead(503);return res.end('{}');}content='## 整周分析\n\nIncluded sessions: '+value.sessions.map(s=>s.id).join(',');}
  else if(system.includes('Deep Dive /'))content='## 本节课堂分析\n\nStudent discussion remains distinct.';
  else if(system.includes('Ask this class')){seenAsk=value;content='这是有来源的回答。';}
  else{if(value?.sourceId)materialCalls++;content='[Reading page 1] Shared comparison material. [PPT parser page 1] Comparative literature.';}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(url,data)=>{const r=await fetch(base+url,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value};};
  assert.equal((await call('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'fixture',model:'fixture',visionEnabled:true})).status,200);
  const project=(await call('/api/projects',{name:'Shared Week'})).value,id=project.id,route=`/api/projects/${id}`;let state;
  const wait=async()=>{for(let i=0;i<250;i++){state=(await call(route)).value;if(state.status!=='running')return state;await sleep(20);}throw Error('processing timeout');};
  const process=async options=>{const result=await call(route+'/process',options);assert.equal(result.status,202,JSON.stringify(result.value));return wait();};
  const upload=async(role,name,bytes,sessionId)=>{const r=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':role,'x-file-name':name,...(sessionId?{'x-session-id':sessionId}:{})},body:bytes});assert.equal(r.status,201,await r.clone().text());return r.json();};
  const output=async(scope,name,version)=>call(route+`/output?scope=${scope}&name=${name}${version?'&version='+version:''}`);
  await call(route+'/bb',{text:'Week topic\nWhy compare?'});
  state=await upload('reading','reading.pdf','ORIGINAL READING');const reading=state.files.find(f=>f.role==='reading');
  let r=await fetch(base+route+'/parsed?source='+reading.id,{method:'POST',body:'[Reading page 1]\nShared comparison material.'});assert.equal(r.status,200);
  const pptBytes=zipFixture([['ppt/slides/slide1.xml','one'],['ppt/slides/slide2.xml','two'],['ppt/slides/slide3.xml','blank']]);state=await upload('ppt','slides.pptx',pptBytes);const ppt=state.files.find(f=>f.role==='ppt');
  const list=[{type:'text',page_idx:0,text:'Comparative literature: shared materials'},{type:'image',page_idx:1,img_path:'images/chart.png',img_caption:['Comparison chart']}];
  r=await fetch(base+route+'/parsed?source='+ppt.id,{method:'POST',headers:{'x-parse-format':'json'},body:JSON.stringify(list)});assert.equal(r.status,200);
  const parsedDir=path.join(temp,'classes',id,'Parsed',ppt.id);await writeFile(path.join(parsedDir,'mineru_result.zip'),zipFixture([['doc_content_list.json',JSON.stringify(list)],['images/chart.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XcAAAAASUVORK5CYII=','base64')]]));
  state=await process({mode:'preparation'});assert.equal(state.status,'done',state.error);assert.equal(state.sessions.length,0);assert.equal(state.preparation.questions,undefined);assert.equal(bbCalls,0);assert.equal(state.preparation.pages.length,3);assert(visionCalls>0);
  assert.equal(state.weekly,undefined,'PPT guide never generates weekly analysis');state=await process({mode:'week'});
  const prepGeneration=state.preparation.generation,materialRevision=state.materialRevision,initialMaterialCalls=materialCalls,firstWeekly=state.weekly.generation;
  assert.equal((await output('preparation','Preparation_QA.md')).status,400);const guide=(await output('preparation','PPT_Bilingual_Guide.md')).value;assert.match(guide,/正文双语翻译/);assert.match(guide,/第 3 页/);assert.match(guide,/No original body text/);
  const pages=await pptPages(path.join(temp,'classes',id),state.files.find(f=>f.id===ppt.id));assert.equal(pages[2].blocks.length,0);const images=await pageImages(path.join(temp,'classes',id),ppt,pages[1]);assert.equal(images.images.length,1);
  assert.equal((await call(route+'/ask',{question:'解释这一页',scope:'preparation',focus:{kind:'page',sourceId:ppt.id,pageIndex:0}})).status,200);assert.match(seenAsk.focusedEvidence.text,/Comparative literature/);
  const lecture=(await call(route+'/sessions',{type:'Lecture',title:'Lecture One',date:'2026-10-20'})).value.session;
  const lectureSrt='1\n00:00:01,000 --> 00:00:02,000\nLECTURE_ONLY: comparison.';state=await upload('srt','Lecture.srt',lectureSrt,lecture.id);assert.equal(state.materialRevision,materialRevision);assert.equal(state.preparation.generation,prepGeneration);
  state=await process({mode:'session',sessionId:lecture.id});assert.equal(state.status,'done',state.error);assert.equal(materialCalls,initialMaterialCalls,'material model work must be reused');assert(sessionInputs[0].context.includes('Shared comparison material'));assert(!JSON.stringify(sessionInputs[0]).includes('Comparison reveals differences.'));
  assert.equal(state.weekly.generation,firstWeekly);assert.equal(state.sessions[0].artifactStatus.deepDive,'not_generated');state=await process({mode:'analysis',sessionId:lecture.id});
  const lectureGeneration=state.sessions[0].generation,lectureScript=(await output(lecture.id,'Class_Script_Bilingual.md')).value;
  const seminar=(await call(route+'/sessions',{type:'Seminar',title:'Seminar Discussion'})).value.session;
  const seminarSrt='1\n00:00:03,000 --> 00:00:05,000\nStudent: SEMINAR_ONLY: Why?';await upload('srt','Seminar.srt',seminarSrt,seminar.id);
  state=await process({mode:'session',sessionId:seminar.id});assert.equal(state.status,'done',state.error);assert.equal(state.sessions[0].generation,lectureGeneration);assert.equal(state.preparation.generation,prepGeneration);assert.equal(materialCalls,initialMaterialCalls);assert.equal(state.weekly.generation,firstWeekly);state=await process({mode:'analysis',sessionId:seminar.id});state=await process({mode:'week'});assert.equal(weekInputs.at(-1).sessions.length,2);assert.deepEqual(state.sessions[1].coverage,{cues:1,covered:1,segments:1});assert.match((await output(seminar.id,'Class_Script_Bilingual.md')).value,/Student/);
  assert.equal((await output(lecture.id,'Class_Script_Bilingual.md')).value,lectureScript);assert.equal((await output('week','Weekly_Deep_Dive.md',firstWeekly)).status,400);assert.equal((await output(seminar.id,'Deep_Dive.md',lectureGeneration)).status,400);
  assert.equal((await call(route+'/ask',{question:'这节课说了什么？',scope:seminar.id})).status,200);assert(!JSON.stringify(seenAsk).includes('LECTURE_ONLY'));assert(JSON.stringify(seenAsk).includes('SEMINAR_ONLY'));
  assert.equal((await call(route+'/ask',{question:'解释这张图',scope:'preparation',focus:{kind:'page',sourceId:ppt.id,pageIndex:1}})).status,200);assert.equal(seenAsk.focusedEvidence.pageIndex,1);assert(!JSON.stringify(seenAsk).includes('SEMINAR_ONLY'));
  state=await upload('srt','Seminar-revised.srt',seminarSrt+' Revised.',seminar.id);assert.equal(state.files.filter(f=>f.sessionId===seminar.id).length,2);assert.equal(stale(state,seminar.id),true);assert.equal(stale(state,'week'),true);assert.equal(stale(state,'preparation'),false);
  state=await process({mode:'session',sessionId:seminar.id});assert.equal(state.status,'done',state.error);assert.equal(state.sessions[0].generation,lectureGeneration);assert.equal(state.preparation.generation,prepGeneration);assert.equal(materialCalls,initialMaterialCalls);assert.equal(stale(state,'week'),true);state=await process({mode:'week'});assert.equal(stale(state,'week'),false);
  const oldWeekly=state.weekly.generation;failWeekly=true;state=await process({mode:'week',fresh:true});assert.equal(state.status,'error');assert.equal(state.weekly.generation,oldWeekly);assert.equal(state.sessions[0].generation,lectureGeneration);failWeekly=false;
  await call(route+'/bb',{text:'Week topic revised; no explicit questions.'});state=await process({mode:'preparation'});assert.equal(state.status,'done',state.error);assert.equal(state.preparation.questions,undefined);assert.equal(bbCalls,0);assert.equal(state.preparation.history,undefined);assert.equal(state.sessions[0].generation,lectureGeneration);assert.notEqual(state.materialRevision,materialRevision);
  assert.equal(await readFile(path.join(temp,'classes',id,'Source',reading.stored),'utf8'),'ORIGINAL READING');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(temp,{recursive:true,force:true});}
});
