import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pipeline} from '../lib/pipeline.mjs';
import {reconstructBatch,contentAudit,classroomBatches} from '../lib/class-reconstruction.mjs';
import {parseSrt,validateSegments} from '../lib/core.mjs';
import {budgetObject} from '../lib/context-budget.mjs';
import {translateParagraphs} from '../lib/paragraph-translation.mjs';
import {buildContext,preparation} from '../lib/study.mjs';
import {contentHash} from '../lib/materials.mjs';
const settings={model:'mock',baseUrl:'http://mock',apiKey:'SECRET',contextChars:100000,maxOutputTokens:12000};
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-repair-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const cues=Array.from({length:97},(_,i)=>({id:i+1,text:i===96?'to be more efficient.':'Statement number '+(i+1)+'.',start:'00:00:01,000',end:'00:00:02,000'}));
function draft(){let n=1;return {segments:[5,1,1,6,4,5,7,4,4,3,4,5,10,5,7,3,6,12,4].map((count,i)=>{const ids=Array.from({length:count},()=>n++);return {speaker:i%2?'Student':'Lecturer',chapter:'Discussion',cueIds:ids,english:ids.map(id=>cues[id-1].text).join(' ')+(i===18?' to be more efficient.':'')};})};}
const input={session:{id:'s',title:'Seminar'},context:'Shared course evidence',previousForContinuityOnly:[],cues,part:1,totalParts:3};
test('97th cue already present in English is linked locally without changing any of the nineteen paragraphs',()=>fixture(async dir=>{
 const original=draft(),requests=[],model=await pipeline(dir,settings,{scope:'session:s',call:async(s,sys,user,opts)=>{assert.equal(opts.json,true);const value=JSON.parse(user);requests.push({sys,value});if(sys==='repair'){assert.deepEqual(value.issues.missing,[97]);assert.equal(value.segments.length,1);assert.equal(value.segments[0].segmentIndex,18);assert.deepEqual(value.cues.map(c=>c.id),[93,94,95,96,97]);return JSON.stringify({assignments:[{segmentIndex:18,cueIds:[93,94,95,96,97]}]});}return JSON.stringify(original);}});
 const options={model,prompt:'reconstruct',repairPrompt:'repair',input,cues},answer=await reconstructBatch(options);assert.equal(requests.length,2);assert.deepEqual(answer.segments.map(s=>s.english),original.segments.map(s=>s.english));assert.deepEqual(answer.segments.map(s=>s.speaker),original.segments.map(s=>s.speaker));validateSegments(answer.segments,cues);await reconstructBatch(options);assert.equal(requests.length,2);
}));
test('failed association repair resumes saved English instead of regenerating it',()=>fixture(async dir=>{
 let main=0,repair=0,fail=true;const call=async(s,sys)=>{if(sys==='reconstruct'){main++;return JSON.stringify(draft());}repair++;if(fail){const e=Error('offline');e.httpStatus=503;throw e;}return JSON.stringify({assignments:[{segmentIndex:18,cueIds:[93,94,95,96,97]}]});};
 const make=()=>pipeline(dir,settings,{scope:'session:s',call,backoff:async()=>{}});await assert.rejects(()=>make().then(model=>reconstructBatch({model,prompt:'reconstruct',repairPrompt:'repair',input,cues})));assert.equal(main,1);assert.equal(repair,3);const failed=JSON.parse(await readFile(path.join(dir,'Parsed/.pipeline.json')));assert(Object.values(failed.drafts).some(d=>d.output.segments?.length===19));
 fail=false;await reconstructBatch({model:await make(),prompt:'reconstruct',repairPrompt:'repair',input,cues});assert.equal(main,1);assert.equal(repair,4);
}));
test('SRT preflight rejects bad times before generation, and coverage details do not claim semantic verification',()=>{
 for(const stamp of ['00:99:00,000 --> 00:99:01,000','00:00:03,000 --> 00:00:02,000'])assert.throws(()=>parseSrt('1\n'+stamp+'\nHello'));
 const v=[{speaker:'Student',english:'Hello',cueIds:['1']}];validateSegments(v,[{id:1}]);assert.deepEqual(v[0].cueIds,[1]);const audit=contentAudit([{speaker:'Lecturer',english:'The teacher agrees.',cueIds:[1]}],[{id:1,text:'Student: I disagree with this assertion.'}]);assert.equal(audit.length,1);assert.match(audit[0].issues.join(' '),/说话者/);
});
test('context selection accounts for final JSON size, keeps mandatory cues and shares space across session evidence',()=>{
 const model={remaining:(s,u)=>14000-s.length-u.length-1000},value={cues:[{id:97,text:'to be more efficient.'}],sessions:[{id:'s1',notes:['Evidence A '.repeat(3000)]},{id:'s2',notes:['Evidence B '.repeat(3000)]}],sourceNotes:'Background '.repeat(8000)};
 const selected=budgetObject(model,'rules',value,{fields:['sessions.0.notes','sessions.1.notes','sourceNotes']});assert.deepEqual(selected.cues,value.cues);assert(selected.sessions[0].notes.length);assert(selected.sessions[1].notes.length);assert(JSON.stringify(selected).length<13000);assert.equal(selected.contextCoverage.sourceNotes.exhaustive,false);assert.throws(()=>budgetObject(model,'rules',{cues:'Essential speech '.repeat(10000)},{fields:[]}));
});

test('classroom batches include JSON overhead and split before a request exceeds its budget',()=>{
 const input=Array.from({length:20},(_,i)=>({id:i+1,start:'00:00:01,000',end:'00:00:02,000',text:'Short sentence '.repeat(10)})),model={remaining:(s,u)=>1500-s.length-u.length},session={id:'s'};const batches=classroomBatches(input,{model,prompt:'rules',session,chunkChars:100000});assert(batches.length>1);assert.deepEqual(batches.flat(),input);for(const cues of batches)assert(model.remaining('rules',JSON.stringify({session,context:'',previousForContinuityOnly:[],cues,part:20,totalParts:20}))>=0);
});
test('legacy PPT translation repairs only missing or invalid paragraph IDs while retaining accepted Chinese',()=>fixture(async dir=>{
 const calls=[],model=await pipeline(dir,settings,{call:async(s,sys,user)=>{const v=JSON.parse(user);calls.push(v);return JSON.stringify({paragraphs:v.paragraphs.length===2?[{id:'p1',chinese:'已通过的译文'},{id:'wrong',chinese:'未关联译文'}]:[{id:'p2',chinese:'仅补译第二段'}]});}});
 const answer=await translateParagraphs(model,'rules',{sourceId:'ppt',pageIndex:0,part:1,paragraphs:[{id:'p1',english:'First'},{id:'p2',english:'Second'}]});assert.equal(calls.length,2);assert.equal(calls[1].paragraphs.length,1);assert.equal(calls[1].paragraphs[0].id,'p2');assert.equal(answer.paragraphs[0].chinese,'已通过的译文');
}));
test('generic retries receive exact validation errors; independent failures have separate records and scoped obsolete keys are pruned',()=>fixture(async dir=>{
 const users=[],model=await pipeline(dir,settings,{scope:'session:a',call:async(s,sys,user)=>{users.push(user);return users.length===1?'{"value":0}':'{"value":1}';}}),validate=v=>{if(v.value!==1)throw Error('Expected value=1, got '+v.value);};
 await model.object('step','rules','input',validate);assert.match(users[1],/Expected value=1, got 0/);await model.object('step','changed rules','new input',validate);await model.finish();const disk=JSON.parse(await readFile(path.join(dir,'Parsed/.pipeline.json')));assert.equal(Object.keys(disk.entries).length,1);
}));

test('localized body recovery is used only when a missing cue is genuinely absent from existing English',()=>fixture(async dir=>{
 const original=draft();original.segments[18].english=original.segments[18].english.replace(' to be more efficient.','');let main=0,local=0;
 const model=await pipeline(dir,settings,{call:async(s,sys,user)=>{const v=JSON.parse(user);if(sys==='repair')return JSON.stringify({missingContent:[97]});if(v.task?.startsWith('Restore ONLY')){local++;assert.deepEqual(v.cues.map(c=>c.id),[93,94,95,96,97]);return JSON.stringify({segments:[{...original.segments[18],cueIds:[93,94,95,96,97],english:original.segments[18].english+' to be more efficient.'}]});}main++;return JSON.stringify(original);}});
 const result=await reconstructBatch({model,prompt:'reconstruct',repairPrompt:'repair',input,cues});assert.equal(main,1);assert.equal(local,1);assert.deepEqual(result.segments.slice(0,18),original.segments.slice(0,18));assert.match(result.segments[18].english,/efficient/);validateSegments(result.segments,cues);
}));

test('failed parallel stages retain separate diagnostics instead of overwriting each other',()=>fixture(async dir=>{
 const model=await pipeline(dir,settings,{call:async()=>'{invalid SECRET'}),validate=()=>{};await Promise.allSettled([model.object('stage a','rules','a',validate),model.object('stage b','rules','b',validate)]);const cache=JSON.parse(await readFile(path.join(dir,'Parsed/.pipeline.json')));assert.equal(Object.keys(cache.failures).length,2);assert(!JSON.stringify(cache.failures).includes('SECRET'));assert.deepEqual(new Set(Object.values(cache.failures).map(f=>f.stage)),new Set(['stage a','stage b']));
}));

test('cleaning one session cache preserves shared results still referenced by another session',()=>fixture(async dir=>{
 const a=await pipeline(dir,settings,{scope:'session:a',call:async()=> 'shared'});await a.text('step','rules','same paragraph');await a.finish();const b=await pipeline(dir,settings,{scope:'session:b',call:async()=> 'changed'});assert.equal(await b.text('step','rules','same paragraph'),'shared');await b.text('step','rules','different paragraph');await b.finish();const again=await pipeline(dir,settings,{scope:'session:a',call:async()=>{throw Error('lost shared cache');}});assert.equal(await again.text('step','rules','same paragraph'),'shared');
}));

test('missing Reading does not block an already parsed complete PPT and remains explicit in source coverage',()=>fixture(async dir=>{
 await mkdir(path.join(dir,'Source'));await mkdir(path.join(dir,'Parsed/ppt'),{recursive:true});await writeFile(path.join(dir,'Source','Lecture.pdf'),'original');await writeFile(path.join(dir,'Source','Reading.pdf'),'unparsed');
 const page={page:1,title:'Concept',hidden:false,blank:false,originalText:[{text:'A course concept',method:'native',role:'body'}],speakerNotes:'',visualObservations:[],analysis:[],uncertainties:[],inspection:{textExtracted:true,fullPageViewed:true,status:'complete'},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'课程概念'}],closeReading:'本页解释课程概念。'}};
 const files=[{id:'ppt',name:'Lecture.pdf',stored:'Lecture.pdf',role:'ppt',parsed:'ppt/blocks.json',externalAnalysis:'ppt/ai_analysis.json'},{id:'reading',name:'Reading.pdf',stored:'Reading.pdf',role:'reading',parseStatus:'failed',error:'Cloud parser unavailable'}],project={name:'Test',files,materialRevision:1};
 await writeFile(path.join(dir,'Parsed/ppt/blocks.json'),JSON.stringify({schema:'classroom.blocks.v1',source:{id:'ppt',name:'Lecture.pdf',role:'ppt'},pageCount:1,blocks:[{id:'b1',type:'text',text:'A course concept',pageIndex:0}]}));await writeFile(path.join(dir,'Parsed/ppt/ai_analysis.json'),JSON.stringify({source:{sha256:contentHash(Buffer.from('original'))},learningSchema:'classroom.ppt-learning.v1',pages:[page]}));
 const model={text(){throw Error('unexpected model call');},object(){throw Error('unexpected translation');}},common={dir,model,prompts:{},stage:async()=>{},allowIncompleteMaterials:true};const context=await buildContext(project,{uploadConcurrency:2,contextConcurrency:2},common);assert.equal(context.missingMaterials.length,1);assert.match(context.context,/Missing source.*Reading.pdf/);const result=await preparation(project,{contextConcurrency:2},{...common,context:context.context});assert.equal(JSON.parse(result.files['PPT_Reader.json']).pages.length,1);assert.equal(await readFile(path.join(dir,'Source/Reading.pdf'),'utf8'),'unparsed');
}));
