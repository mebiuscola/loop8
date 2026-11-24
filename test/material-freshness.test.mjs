import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {materialInputs,refreshMaterialInputs} from '../lib/material-inputs.mjs';
import {materialChanges,scriptState,analysisState,weeklyState} from '../lib/workflow.mjs';
import {LEARNING_SCHEMA} from '../lib/ppt-learning.mjs';
import {json} from '../lib/core.mjs';

// 2026-11-24: lecture scripts follow only their subtitles; Deep Dives follow only real changes of
// what the course context reads from the materials.

const slide=(n,{original='Original text '+n,explanation='Explanation '+n,chinese='译文 '+n}={})=>({page:n,originalText:[{text:original}],visualObservations:[],speakerNotes:'',uncertainties:[],learning:{paragraphs:[{originalIndex:0,chinese}],closeReading:explanation}});
async function week(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-inputs-'));
 await mkdir(path.join(dir,'Parsed','deck'),{recursive:true});await mkdir(path.join(dir,'Parsed','ref'),{recursive:true});await mkdir(path.join(dir,'Source'),{recursive:true});
 const report=pages=>({learningSchema:LEARNING_SCHEMA,courseMap:{overview:'Course'},pages,source:{sha256:'x'}});
 await writeFile(path.join(dir,'Parsed','deck','ai_analysis.json'),JSON.stringify(report([slide(1),slide(2)])));
 await writeFile(path.join(dir,'Parsed','ref','blocks.json'),JSON.stringify({blocks:[{type:'text',text:'Reading text',page_idx:0}]}));
 const p={materialRevision:1,bbText:'Course intro',files:[{id:'deck',role:'ppt',name:'Lecture.pptx',stored:'Lecture.pptx',externalAnalysis:'deck/ai_analysis.json'},{id:'ref',role:'reading',name:'Reading.pdf',stored:'Reading.pdf',parsed:'ref/blocks.json'},{id:'srt',role:'srt',name:'class.srt',stored:'class.srt'}],sessions:[]};
 return {dir,p,report};
}

test('fingerprints follow what the course context reads: not translations or explanations, but original text, readings and the introduction',async()=>{
 const {dir,p,report}=await week();
 try{
  const first=await materialInputs(p,dir);
  assert.deepEqual(Object.keys(first).sort(),['BB_Info','deck','ref'],'subtitles and recordings are not materials');
  await writeFile(path.join(dir,'Parsed','deck','ai_analysis.json'),JSON.stringify(report([slide(1,{explanation:'A new explanation',chinese:'新的译文'}),slide(2)])));
  assert.deepEqual(await materialInputs(p,dir),first,'re-explaining or re-translating a slide changes nothing the context reads');
  await writeFile(path.join(dir,'Parsed','deck','ai_analysis.json'),JSON.stringify(report([slide(1,{original:'Corrected original text'}),slide(2)])));
  const second=await materialInputs(p,dir);assert.notEqual(second.deck.hash,first.deck.hash,'a corrected original text does');assert.equal(second.ref.hash,first.ref.hash);
  p.bbText='New intro';assert.notEqual((await materialInputs(p,dir)).BB_Info.hash,first.BB_Info.hash);
  // Recomputed only after the week's material counter moved.
  assert.equal(await refreshMaterialInputs(p,dir),true);assert.equal(await refreshMaterialInputs(p,dir),false);p.materialRevision++;assert.equal(await refreshMaterialInputs(p,dir),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('freshness: scripts follow subtitles only, Deep Dives follow real material changes, older results keep the counter rule',()=>{
 const inputs={deck:{name:'Lecture.pptx',role:'ppt',hash:'d1'},ref:{name:'Reading.pdf',role:'reading',hash:'r1'}};
 const p={materialRevision:2,materialInputs:{revision:2,sources:structuredClone(inputs)},sessions:[]};
 const s={id:'l',generation:'g',revision:1,outputRevision:1,materialRevision:1,materialInputs:structuredClone(inputs),analysis:{generation:'a',scriptGeneration:'g',outputRevision:1,materialRevision:1,materialInputs:structuredClone(inputs)}};
 p.sessions.push(s);
 assert.equal(scriptState(p,s).stale,false,'the week counter moved (a slide was re-explained), the script is current');
 assert.equal(analysisState(p,s).stale,false,'and so is the Deep Dive: nothing it read changed');
 p.materialInputs.sources.ref.hash='r2';
 assert.equal(scriptState(p,s).stale,false,'a changed reading does not touch the script');
 assert.equal(analysisState(p,s).stale,true);assert.deepEqual(materialChanges(p,s.analysis.materialInputs),[{id:'ref',name:'Reading.pdf',change:'changed'}]);
 p.materialInputs.sources.extra={name:'New.pdf',role:'reading',hash:'n'};delete p.materialInputs.sources.deck;
 assert.deepEqual(materialChanges(p,s.analysis.materialInputs).map(c=>c.change).sort(),['added','changed','removed']);
 // Fingerprints of the week not yet recomputed: unknown, so the counter decides.
 p.materialInputs.revision=1;assert.equal(materialChanges(p,s.analysis.materialInputs),null);assert.equal(analysisState(p,s).stale,true);
 // A Deep Dive made before fingerprints existed keeps the counter rule.
 const old={...s,materialInputs:undefined,analysis:{...s.analysis,materialInputs:undefined,materialRevision:2}};p.materialInputs.revision=2;
 assert.equal(analysisState(p,old).stale,false);p.materialRevision=3;p.materialInputs.revision=3;assert.equal(analysisState(p,old).stale,true);
 // The weekly Deep Dive.
 const w={materialRevision:2,weekly:{generation:'w',materialInputs:structuredClone(p.materialInputs.sources),selectedSessionIds:[],availableSessionIds:['l'],knownSessionIds:['l'],sessionInputs:[]},materialInputs:p.materialInputs,sessions:[s]};
 w.materialRevision=3;assert.equal(weeklyState(w).stale,false);w.materialInputs={revision:3,sources:{...p.materialInputs.sources,ref:{name:'Reading.pdf',role:'reading',hash:'r3'}}};assert.equal(weeklyState(w).stale,true);
});

test('opening a week computes its fingerprints once and keeps them in project.json',async()=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'classroom-inputs-server-')),id='Week_Inputs',folder=path.join(data,'classes',id);
 await mkdir(path.join(folder,'Source'),{recursive:true});
 await writeFile(path.join(folder,'project.json'),JSON.stringify({id,name:'Inputs',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'idle',materialRevision:4,revision:4,bbText:'Intro',sessions:[],files:[],chat:[],tasks:{}}));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:data,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const p=await (await fetch(base+'/api/projects/'+id)).json();
  assert.equal(p.materialInputs.revision,4);assert.deepEqual(Object.keys(p.materialInputs.sources),['BB_Info']);
  const saved=await json(path.join(folder,'project.json'),null);assert.deepEqual(saved.materialInputs,p.materialInputs,'kept for the next time');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(data,{recursive:true,force:true});}
});
