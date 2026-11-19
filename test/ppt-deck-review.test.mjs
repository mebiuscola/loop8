import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyDeckReview,reviewDeck} from '../lib/ppt-deck-review.mjs';
import {weeklyTerminology,withTerminology} from '../lib/terminology.mjs';
import {contentHash} from '../lib/materials.mjs';

const page=n=>({page:n,title:'Distant reading',blank:false,originalText:[{text:'Distant reading',role:'body',method:'native'}],visualObservations:[],speakerNotes:'Original notes',inspection:{status:'complete',fullPageViewed:true,textExtracted:true},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'远读'}],closeReading:'作者背景介绍。当前页的具体论点。'}});
const result=n=>({terms:[{english:'Distant reading',chinese:'远读',scope:'Moretti 的阅读方法',pages:[n]}],changes:[{page:n,kind:'explanation',before:page(n).learning.closeReading,after:'本页进一步限定远读的尺度与证据。',reason:'删除重复背景，突出本页推进'}]});

test('review applies only targeted learning edits and rejects stale patches or invented term coordinates',()=>{
 const pages=[page(1),page(2)],before=structuredClone(pages),r=applyDeckReview(pages,result(2));
 assert.deepEqual(pages,before);assert.deepEqual(r.pages[0],pages[0]);assert.deepEqual(r.pages[1].originalText,pages[1].originalText);assert.equal(r.pages[1].speakerNotes,'Original notes');assert.equal(r.pages[1].learning.paragraphs[0].chinese,'远读');assert.notEqual(r.pages[1].learning.closeReading,pages[1].learning.closeReading);
 for(const change of [r=>r.changes[0].before='wrong',r=>r.changes[0].kind='originalText',r=>r.terms[0].english='Invented concept',r=>r.terms[0].pages=[99]]){const bad=result(2);change(bad);assert.throws(()=>applyDeckReview(pages,bad));}
});

test('batched primary review resumes only failed checks, retains source and accepted pages, and reuses finished review',async()=>{
 const checkpoint={total:11,pages:Array.from({length:11},(_,i)=>page(i+1))},original=structuredClone(checkpoint.pages),requests=[];let fail=true,saves=0;
 const options={checkpoint,prompt:'Review',settings:{model:'primary',contextChars:180000},weeklyTerms:[],persist:async()=>{saves++;},call:async(s,system,user,o)=>{
  const input=JSON.parse(user);requests.push(input);assert.equal(s.model,'primary');assert.equal(o.images,undefined);
  if(input.pages[0].page===11&&fail)throw Error('temporary invalid response');
  const value=result(input.pages[0].page);value.changes[0].before=input.pages[0].learning.closeReading;return JSON.stringify(value);
 }};
 await reviewDeck(options);assert.equal(checkpoint.deckReview.status,'pending');assert(checkpoint.deckReviewDraft.parts[0].complete);assert.deepEqual(checkpoint.pages.map(p=>p.originalText),original.map(p=>p.originalText));
 fail=false;await reviewDeck(options);assert.equal(requests.filter(r=>r.pages[0].page===1).length,1);assert.equal(requests.at(-1).earlierTerms[0].chinese,'远读');assert.equal(checkpoint.deckReview.status,'complete');assert.equal(checkpoint.deckReview.terms.length,1);assert(checkpoint.deckReview.changes.length===2);assert(saves>2);
 const count=requests.length;await reviewDeck(options);assert.equal(requests.length,count);
 for(let i=0;i<11;i++)assert.deepEqual(checkpoint.pages[i].originalText,original[i].originalText);
 await reviewDeck({...options,prompt:'Revised review rules'});assert(requests.length>count,'changing review Skill reruns review, not page recognition');
});

test('weekly terminology derives only from current published originals and reaches every generated task',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-terms-'));
 try{
  await mkdir(path.join(dir,'Source'));await mkdir(path.join(dir,'Parsed','ppt'),{recursive:true});await writeFile(path.join(dir,'Source','Lecture.pptx'),'original');
  const f={id:'ppt',role:'ppt',name:'Lecture.pptx',stored:'Lecture.pptx',externalAnalysis:'ppt/report.json'},project={files:[f]},report={source:{sha256:contentHash(Buffer.from('original'))},pages:[page(1)],deckReview:{terms:result(1).terms}};
  await writeFile(path.join(dir,'Parsed','ppt','report.json'),JSON.stringify(report));const terms=await weeklyTerminology(project,dir);assert.equal(terms[0].source,'Lecture.pptx');assert.equal(terms[0].pages[0],1);assert.deepEqual(await weeklyTerminology(project,dir,{exclude:'ppt'}),[]);
  const requests=[],model=withTerminology({text:async(...a)=>{requests.push(a);return 'text';},object:async(...a)=>{requests.push(a);return {chinese:'远读'};}},terms),validate=()=>{};
  await model.object('translation','rules','{"english":"Distant reading"}',validate);await model.text('Deep Dive','rules','evidence');await model.text('weekly','rules','sessions');
  assert.equal(requests[0][3],validate);for(const r of requests){assert.match(r[1],/never evidence/);assert.deepEqual(JSON.parse(r[2]).weeklyTerminology,terms);}assert.equal(JSON.parse(requests[0][2]).english,'Distant reading');
  await writeFile(path.join(dir,'Source','Lecture.pptx'),'changed');assert.deepEqual(await weeklyTerminology(project,dir),[]);assert.deepEqual(await weeklyTerminology({files:[]},dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
