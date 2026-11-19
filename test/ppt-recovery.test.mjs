import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {evaluateDeckReview,validateTerm,reviewDeck} from '../lib/ppt-review.mjs';
import {componentRules,updatePptRules,reusePptDraft,pageFingerprint} from '../lib/ppt-cache.mjs';
import {completePptPage} from '../lib/ppt-response.mjs';
import {commitMaterial,materialCommitPending,recoverMaterialCommits} from '../lib/material-commit.mjs';
import {contentHash} from '../lib/materials.mjs';
import {weeklyTerminology} from '../lib/terminology.mjs';
const page=n=>({page:n,title:'Term',hidden:false,blank:false,originalText:[{text:'Distant\nreading',role:'body',method:'native'}],speakerNotes:'Original notes',visualObservations:[],analysis:[],uncertainties:[],inspection:{status:'complete',textExtracted:true,fullPageViewed:true},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'远读'}],closeReading:'本页讨论文学研究的尺度。'}});
const term={english:'Distant reading',chinese:'远读',scope:'Moretti',pages:[1]};
test('revised deck reuses verified page text and only carries teaching with matching context',()=>{
 const seed={nativeText:'Distant reading',speakerNotes:'Notes',hidden:false},image=Buffer.from('page image');
 const fingerprint=pageFingerprint(seed,image);
 assert.notEqual(pageFingerprint({...seed,speakerNotes:'Changed'},image),fingerprint);
 const rules={recognition:'r',translation:'t',explanation:'e'};
 const reuse={fingerprint,context:'old context',terms:'same terms'};
 const candidates=[{page:page(1),rules,reuse,sourceHash:'old'}];
 const moved=reusePptDraft(candidates,rules,{...reuse,context:'new section'},'revised');
 assert.equal(moved.draft.blocks[0].original,'Distant\nreading');
 assert.equal(moved.draft.blocks[0].chinese,'远读');
 assert.equal(moved.draft.explanation,'');
 assert.equal(reusePptDraft(candidates,rules,{...reuse,terms:'new terms'},'revised').draft.blocks[0].chinese,null);
 assert.equal(reusePptDraft(candidates,{...rules,recognition:'changed'},reuse,'revised'),null);
});
test('whitespace-normalized terms accept cross-batch references, reject substring guesses and restrict edits to target pages',()=>{
 const pages=[page(1),page(11)];assert.deepEqual(validateTerm(pages,{...term,pages:[1,11]}).pages,[1,11]);
 assert.throws(()=>validateTerm([{...page(1),originalText:[{text:'Partial evidence'}]}],{...term,english:'art'}));
 const checked=evaluateDeckReview(pages,{terms:[{...term,pages:[1,11]}],changes:[{page:1,kind:'explanation',before:pages[0].learning.closeReading,after:'不允许跨目标页修改',reason:'test'}]},{allowedPages:[11]});assert.equal(checked.terms.length,1);assert.equal(checked.issues.length,1);assert.deepEqual(checked.pages,pages);
});
test('valid work survives one invalid term; continuation repairs only that item, keeps complete pages and a stable publication fingerprint',async()=>{
 const task={total:12,pages:Array.from({length:12},(_,i)=>page(i+1))},requests=[];let fix=false;
 const options={checkpoint:task,prompt:'review',settings:{model:'primary',apiKey:'SECRET',contextChars:100000},persist:async()=>{},call:async(s,sys,user,o)=>{
  assert.equal(s.model,'primary');assert.equal(o.images,undefined);const input=JSON.parse(user);requests.push(input);
  if(input.mode==='repair_items'){assert(fix);assert.equal(input.unresolved.length,1);assert.equal(input.unresolved[0].value.english,'Nonexistent');return JSON.stringify({repairs:[{id:input.unresolved[0].id,value:{...term,pages:[1,11]}}]});}
  return JSON.stringify({terms:input.pages[0].page===1?[term,{...term,english:'Nonexistent'}]:[],changes:input.pages[0].page===1?[{page:1,kind:'explanation',before:input.pages[0].learning.closeReading,after:'本页解释远读如何改变研究尺度。',reason:'Remove repeated background'}]:[]});
 }};
 await reviewDeck(options);assert.equal(task.pages.length,12);assert(task.pages.every(Boolean));assert.equal(task.deckReview.status,'pending');assert.equal(task.deckReview.terms.length,1);assert.equal(task.deckReview.issues.length,1);assert.match(task.pages[0].learning.closeReading,/改变研究尺度/);assert.match(task.deckReview.issues[0].error,/Nonexistent/);
 fix=true;await reviewDeck(options);assert.equal(requests.length,3);assert.equal(requests.at(-1).mode,'repair_items');assert.equal(task.deckReview.status,'complete');assert.equal(task.deckReview.terms[0].pages.length,2);const at=task.deckReview.at;
 await reviewDeck(options);assert.equal(requests.length,3);assert.equal(task.deckReview.at,at);assert.equal(task.pages[0].originalText[0].text,'Distant\nreading');
 await reviewDeck({...options,weeklyTerms:[{english:'Unrelated',chinese:'无关',scope:'Other',pages:[2]}]});assert.equal(requests.length,3,'unrelated glossary changes cannot rerun the deck');
});
test('review rate limits use bounded backoff; malformed responses retain redacted diagnostics without failing completed pages',async()=>{
 let calls=0,limited=0;const delays=[],task={total:1,pages:[page(1)]},options={checkpoint:task,prompt:'review',settings:{model:'primary',apiKey:'SECRET',contextChars:50000},persist:async()=>{},onRateLimit:()=>limited++,backoff:async ms=>delays.push(ms)};
 await reviewDeck({...options,call:async()=>{calls++;if(calls<3){const e=Error('rate limit');e.httpStatus=429;throw e;}return '{"terms":[],"changes":[]}';}});assert.equal(calls,3);assert.equal(limited,2);assert.deepEqual(delays,[1000,2000]);assert.equal(task.deckReview.status,'complete');
 await reviewDeck({...options,prompt:'new rules',call:async()=>'{"broken":"SECRET'});assert.equal(task.deckReview.status,'pending');assert(!JSON.stringify(task.deckReviewDraft).includes('SECRET'));assert.match(task.deckReviewDraft.parts[0].diagnostic.response,/redacted/);assert(task.pages[0]);
 let networkCalls=0;await reviewDeck({...options,prompt:'network rules',call:async()=>{networkCalls++;throw Error('fetch failed');}});assert.equal(networkCalls,3,'network retries cannot restart as JSON retries');assert.equal(task.deckReview.status,'pending');
});

test('a changed weekly term reopens only batches containing that concept',async()=>{
 const task={total:11,pages:Array.from({length:11},(_,i)=>page(i+1))},requests=[];for(let i=0;i<10;i++)task.pages[i].originalText[0].text='Another concept';
 const options={checkpoint:task,prompt:'review',settings:{model:'primary',contextChars:100000},persist:async()=>{},call:async(s,sys,user)=>{requests.push(JSON.parse(user));return '{"terms":[],"changes":[]}';}};
 await reviewDeck(options);assert.equal(requests.length,2);await reviewDeck({...options,weeklyTerms:[{...term,sourceId:'other'}]});assert.equal(requests.length,3);assert.equal(requests.at(-1).pages[0].page,11);
});

test('parallel deck conflicts have a deterministic review preference and never enter the active glossary before reconciliation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-term-conflict-'));
 try{
  await mkdir(path.join(dir,'Source'));const files=[];
  for(const [id,chinese] of [['first','远读'],['second','远距阅读']]){await writeFile(path.join(dir,'Source',id+'.pptx'),id);await mkdir(path.join(dir,'Parsed',id),{recursive:true});const p=page(1);p.learning.paragraphs[0].chinese=chinese;const report={source:{sha256:contentHash(Buffer.from(id))},pages:[p],deckReview:{terms:[{...term,chinese}]}};await writeFile(path.join(dir,'Parsed',id,'report.json'),JSON.stringify(report));files.push({id,role:'ppt',name:id+'.pptx',stored:id+'.pptx',externalAnalysis:id+'/report.json'});}
  assert.deepEqual(await weeklyTerminology({files},dir),[]);const candidates=await weeklyTerminology({files},dir,{forReview:true});assert.equal(candidates[0].sourceId,'first');assert.equal(candidates[0].chinese,'远读');assert.equal(candidates[0].alternatives[0].chinese,'远距阅读');assert.equal(candidates[0].requiresReconciliation,true);
  const dest=path.join(dir,'Parsed/second/report.json'),report=JSON.parse(await readFile(dest));report.pages[0].learning.paragraphs[0].chinese='远读';report.deckReview.terms[0].chinese='远读';await writeFile(dest,JSON.stringify(report));const active=await weeklyTerminology({files},dir);assert.equal(active.length,1);assert.equal(active[0].alsoSources[0].sourceId,'second');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Reading and teaching-rule changes reuse OCR while refreshing only affected learning components',async()=>{
 const inputs={prompt:'learning',mapPrompt:'map',splitPrompts:{recognition:'recognition',translation:'translation',explanation:'explanation'},evidence:[]},task={total:1,pages:[page(1)],learningRules:'old',pageDrafts:{},attempts:{}};
 task.componentRules=componentRules(inputs);task.learningRules='same';const before=structuredClone(task.pages[0]);
 const changed=updatePptRules(task,componentRules({...inputs,evidence:['new Reading']}),'new');assert.equal(changed.recognition,false);assert.equal(changed.translation,false);assert.equal(changed.explanation,true);assert.deepEqual(task.pageDrafts[0].draft.blocks.map(b=>b.original),before.originalText.map(b=>b.text));assert.equal(task.pageDrafts[0].draft.blocks[0].chinese,'远读');
 const calls=[];const result=await completePptPage({state:task.pageDrafts[0],input:{page:1},source:{fileName:'test.pptx',format:'pptx',sha256:'a'.repeat(64)},settings:{contextChars:50000},prompts:{explanation:'explanation'},options:{},persist:async()=>{},call:async(s,sys)=>{calls.push(sys);return JSON.stringify({closeReading:'依据新 Reading 更新解读。'});}});
 assert.deepEqual(calls,['explanation']);assert.deepEqual(result.originalText,before.originalText);assert.equal(result.learning.paragraphs[0].chinese,'远读');
 task.pages=[result];updatePptRules(task,componentRules({...inputs,evidence:['new Reading'],splitPrompts:{...inputs.splitPrompts,translation:'new translation'}}),'third');assert.equal(task.pageDrafts[0].draft.blocks[0].chinese,null);assert.equal(task.pageDrafts[0].draft.explanation,'依据新 Reading 更新解读。');
});
test('material publication interruption is discoverable, rolls forward consistently and increments revisions only once',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-material-commit-'));
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','Lecture.pptx'),'original');const p={revision:0,materialRevision:0,files:[{id:'ppt'}]},report={source:{sha256:contentHash(Buffer.from('original'))},pages:[page(1)]},doc={rawReport:'ppt/ai_analysis.json',blocks:[{text:'Distant reading'}]},patch={parsed:'ppt/blocks.json',externalAnalysis:doc.rawReport},mutate=async f=>f(p);
  await assert.rejects(()=>commitMaterial(dir,'ppt',{stored:'Lecture.pptx',report,doc,patch},mutate,{afterReport:()=>{throw Error('interrupted');}}));assert(await materialCommitPending(dir));assert.equal(p.materialRevision,0);
  await recoverMaterialCommits(dir,mutate);assert.equal(await materialCommitPending(dir),false);assert.deepEqual(JSON.parse(await readFile(path.join(dir,'Parsed/ppt/ai_analysis.json'))),report);assert.deepEqual(JSON.parse(await readFile(path.join(dir,'Parsed/ppt/blocks.json'))),doc);assert.equal(p.materialRevision,1);await recoverMaterialCommits(dir,mutate);assert.equal(p.materialRevision,1);
  let fail=true;await assert.rejects(()=>commitMaterial(dir,'ppt',{stored:'Lecture.pptx',report,doc,patch},async change=>{change(p);if(fail)throw Error('manifest save interrupted');}));const version=p.materialRevision;fail=false;await recoverMaterialCommits(dir,mutate);assert.equal(p.materialRevision,version,'generation token prevents double increment after manifest save');
 }finally{await rm(dir,{recursive:true,force:true});}
});
