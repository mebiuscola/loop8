import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {contentListDocument} from '../lib/materials.mjs';
import {translateReference,referenceProgress} from '../lib/reference-study.mjs';
import {buildReferenceTerms,termParts,checkPartTerms,mergeReferenceTerms,relevantReferenceTerms,readReferenceTerms} from '../lib/reference-terms.mjs';

test('glossary parts keep paragraphs whole and group them by page',()=>{
 const units=[{text:'a'.repeat(20),pageIndex:0},{text:'b'.repeat(20),pageIndex:0},{text:'c'.repeat(20),pageIndex:1}];
 const parts=termParts(units,45);
 assert.equal(parts.length,2);
 assert.deepEqual(parts[0].pages.map(p=>p.page),[1]);
 assert.equal(parts[0].pages[0].text,'a'.repeat(20)+'\n\n'+'b'.repeat(20));
 assert.deepEqual(parts[1].pages,[{page:2,text:'c'.repeat(20)}]);
});

test('glossary terms must be written in the text; pages come from the text, not the model',()=>{
 const part={pages:[{page:3,text:'Weltliteratur is not a canon.'},{page:4,text:'Distant reading and Weltliteratur.'}]};
 const kept=checkPartTerms({terms:[
  {english:'Weltliteratur',chinese:'世界文学',scope:'Goethe’s term',pages:[99]},
  {english:'close reading',chinese:'细读',scope:'not in this text'},
  {english:'',chinese:'空'},
 ]},part);
 assert.deepEqual(kept,[{english:'Weltliteratur',chinese:'世界文学',scope:'Goethe’s term',pages:[3,4]}]);
 assert.throws(()=>checkPartTerms({},part),/terms/);
});

test('merging keeps the first rendering and lists the others; only terms in a passage are sent',()=>{
 const units=[{text:'Mimesis and world literature.',pageIndex:0},{text:'Mimesis again.',pageIndex:2}];
 const terms=mergeReferenceTerms([[{english:'mimesis',chinese:'摹仿',scope:'representation',pages:[1]}],[{english:'Mimesis',chinese:'模仿',scope:'Representation',pages:[3]},{english:'world literature',chinese:'世界文学',scope:'',pages:[1]}]],units);
 assert.deepEqual(terms[0],{english:'mimesis',chinese:'摹仿',scope:'representation',pages:[1,3],alternatives:['模仿']});
 assert.deepEqual(relevantReferenceTerms(terms,'A note on world literature.'),[{english:'world literature',chinese:'世界文学'}]);
 assert.deepEqual(relevantReferenceTerms(terms,'mimesisless'),[],'whole words only');
});

async function setup(paragraphs){
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-ref-terms-'));
 const file={id:'ref',role:'reading',name:'Reading.pdf',stored:'Reading.pdf',parsed:'ref/blocks.json',parseStatus:'ready'};
 const p={id:'Week_T',name:'Terms week',files:[file],sessions:[],materialRevision:1,revision:1,outputStorageVersion:1};
 await mkdir(path.join(dir,'Parsed','ref'),{recursive:true});await mkdir(path.join(dir,'Source'),{recursive:true});
 await writeFile(path.join(dir,'Source','Reading.pdf'),'pdf');
 await writeFile(path.join(dir,'Parsed','ref','blocks.json'),JSON.stringify(contentListDocument(paragraphs.map(([text,page_idx])=>({type:'text',text,page_idx})),file)));
 return {dir,file,p};
}

/** A model that answers glossary and translation requests and records what it was sent. */
function fakeModel({delay=5}={}){
 const calls=[];let active=0,peak=0;
 const run=async(kind,user,answer)=>{active++;peak=Math.max(peak,active);calls.push({kind,input:JSON.parse(user)});await new Promise(r=>setTimeout(r,delay));active--;return answer(JSON.parse(user));};
 return {calls,get peak(){return peak;},
  object:(name,system,user,validate,options)=>run(name.startsWith('参考文献术语')?'terms':'single',user,input=>{
   const value=name.startsWith('参考文献术语')?{terms:[{english:'Weltliteratur',chinese:'世界文学',scope:'Goethe'},{english:'invented term',chinese:'编造',scope:'absent'}]}:{chinese:'译文 '+input.english};validate(value);return value;}),
  text:(name,system,user)=>run('batch',user,input=>JSON.stringify({translations:input.items.map(i=>({id:i.id,chinese:'译文 '+i.english}))})),
 };
}

test('a reference is translated with its own glossary, in large batches, several at once',async()=>{
 const paragraphs=Array.from({length:40},(_,i)=>[(i%7===0?'Weltliteratur ':'')+'Paragraph '+(i+1)+' of the reading. '+'Comparison. '.repeat(20),Math.floor(i/3)]);
 const {dir,file,p}=await setup(paragraphs);
 try{
  const model=fakeModel(),stages=[];
  const settings={parseConcurrency:3,modelRoutes:{},modelProfiles:[],defaultProfileId:'',model:'fixture',baseUrl:'https://example.test',apiKey:'x'};
  const summary=await translateReference(p,file,settings,{dir,model,prompts:{reference_translation:'translate',reference_terminology:'glossary'},stage:async(_,text)=>stages.push(text),putClass:async()=>{},signal:new AbortController().signal});
  assert.equal(summary.completed,40);assert.deepEqual(summary.glossary,{status:'complete',count:1,error:''});
  assert.equal(model.calls.filter(c=>c.kind==='terms').length,1,'one glossary request for a short reading');
  const batches=model.calls.filter(c=>c.kind==='batch');
  assert(batches.length<=Math.ceil(40/12)+1,'large batches: '+batches.length);
  assert(new Set(batches[0].input.items.map(i=>i.page)).size>1,'a batch runs across pages');
  assert(model.peak>1&&model.peak<=3,'runs several requests at once, never more than the setting: '+model.peak);
  for(const b of batches){
   assert(!('weeklyTerminology' in b.input));
   const text=b.input.items.map(i=>i.english).join(' ');
   assert.deepEqual(b.input.referenceTerminology.map(t=>t.english),text.includes('Weltliteratur')?['Weltliteratur']:[],'only terms in this batch');
  }
  const saved=await readReferenceTerms(dir,'ref',(await referenceProgress(p,file,dir)).source);
  assert.equal(saved.current,true);assert.deepEqual(saved.terms.map(t=>t.english),['Weltliteratur'],'terms not in the text are dropped');
  // The finished glossary is reused while the parse is unchanged: no request is sent for it again.
  const {source,units}=await referenceProgress(p,file,dir);
  const reused=await buildReferenceTerms({dir,file,source,units,model:{object:()=>assert.fail('glossary rebuilt')},prompt:'g',limit:2});
  assert.deepEqual(reused.terms.map(t=>t.english),['Weltliteratur']);
  // A new parse makes it out of date.
  assert.equal((await readReferenceTerms(dir,'ref',{...source,parsedHash:'changed'})).current,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('stopping keeps every finished paragraph; a failed glossary does not block translation',async()=>{
 const paragraphs=Array.from({length:30},(_,i)=>['Paragraph '+(i+1)+'. '+'Text. '.repeat(30),i]);
 const {dir,file,p}=await setup(paragraphs);
 try{
  const controller=new AbortController(),model=fakeModel({delay:20});let batches=0;
  model.object=async(name,system,user,validate)=>{if(name.startsWith('参考文献术语'))throw Error('glossary service down');return {chinese:'x'};};
  const text=model.text;model.text=async(...args)=>{if(++batches===3)controller.abort();return text(...args);};
  const settings={parseConcurrency:1,modelRoutes:{},modelProfiles:[],model:'fixture',baseUrl:'https://example.test',apiKey:'x'};
  await assert.rejects(translateReference(p,file,settings,{dir,model,prompts:{reference_translation:'t',reference_terminology:'g'},stage:async()=>{},putClass:async()=>{},signal:controller.signal}));
  const progress=await referenceProgress(p,file,dir);
  assert.equal(progress.summary.completed,24,'two whole batches were saved before the stop');
  const glossary=await readReferenceTerms(dir,'ref',progress.source);
  assert.equal(glossary.status,'partial');assert.match(glossary.error,/glossary service down/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
