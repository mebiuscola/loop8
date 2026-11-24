import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,unlink,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pageCacheService} from '../lib/page-cache.mjs';
import {validateLearning,readerPage,validateMap} from '../lib/ppt-learning.mjs';
import {aiMaterialService} from '../lib/ai-material.mjs';
import {serialWriter} from '../lib/concurrency.mjs';
import {preparation} from '../lib/study.mjs';
import {splitLearning} from '../lib/ppt-split.mjs';
import {contentHash} from '../lib/materials.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const originalText=[{text:'Comparative literature',method:'native',role:'heading'},{text:'A relationship is not necessarily causal.',method:'native',role:'body'},{text:'footer',method:'native',role:'footer'}];
const page=()=>({title:'Comparison',page:1,hidden:false,blank:false,speakerNotes:'',originalText:structuredClone(originalText),visualObservations:[],analysis:[],uncertainties:[],inspection:{textExtracted:true,fullPageViewed:true,status:'complete'},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'比较文学'},{originalIndex:1,chinese:'关系不必然是因果关系。'}],closeReading:'解释为什么关联本身不足以证明因果，不重复翻译。'}});

test('integrated learning requires exact translation coverage, preserves original English and excludes footer',()=>{
 const value=page();validateLearning(value);const reader=readerPage(value,{id:'ppt',name:'Lecture.pptx'},'hash');assert.equal(reader.paragraphs.length,2);assert.equal(reader.paragraphs[1].english,originalText[1].text);assert.equal(reader.pageIndex,0);
 for(const change of [p=>p.learning.paragraphs.pop(),p=>p.learning.paragraphs.reverse(),p=>p.learning.paragraphs.push({originalIndex:2,chinese:'页脚'}),p=>p.learning.closeReading='',p=>p.learning.pageType='unknown']){const bad=page();change(bad);assert.throws(()=>validateLearning(bad));}
 assert.throws(()=>validateMap({overview:'x',pages:[{page:0,title:'x',section:'x',purpose:'x'}],terms:[]},1));
});

test('v2.8 migration preserves accepted pages, retries only unfinished pages with primary, and forbids PPT partial publication',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-migrate-ppt-')),write=serialWriter(),calls=[];
 const f={id:'ppt',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf'},p={id:'Week_Migrate',name:'Migration',revision:1,materialRevision:1,files:[f],sessions:[]};
 const settings={baseUrl:'http://mock/v1',model:'primary',apiKey:'secret',contextChars:100000,parseConcurrency:2,fallbackEnabled:true,fallbackModel:'backup'};
 const shared=pageCacheService({root,previews:{status:async()=>({status:'ready',direct:true})},render:async()=>({open:async()=>({pages:3}),page:async i=>({image:'data:image/png;base64,YQ==',nativeText:'Main text '+i,warnings:[]}),close:async()=>{}})});
 try{
  await mkdir(path.join(dir,'Source'));const bytes=Buffer.from('ORIGINAL');await writeFile(path.join(dir,'Source',f.stored),bytes);await mkdir(path.join(dir,'skills'));
  for(const name of ['ppt_map','ppt_learning','ppt_recognition','ppt_block_translation','ppt_explanation','ppt_response_repair','ppt_deck_review'])await copyFile(path.join(root,'skills',name+'.md'),path.join(dir,'skills',name+'.md'));
  const info=await shared.ensure(dir,f,settings,{origin:'http://mock'}),source={fileName:f.name,format:'pdf',sha256:contentHash(bytes)};
  const old={version:2,source,total:3,pages:[{...page(),page:1},{...page(),page:2},null],learningSchema:'classroom.ppt-learning.v1',learningRules:'v2.8-old-contract',renderKey:info.renderKey,courseMap:{overview:'Course',pages:[1,2,3].map(page=>({page,title:'Page',section:'Part',purpose:'Concept'})),terms:[]},attempts:{2:[{round:'initial',status:'failed'},{round:'retry',status:'failed'}]},cycles:{},provenance:{0:{model:'primary'},1:{model:'primary'}}};
  await mkdir(path.join(dir,'Parsed','ppt'),{recursive:true});await writeFile(path.join(dir,'Parsed','ppt','ppt_task.json'),JSON.stringify(old));
  const service=aiMaterialService({root:dir,pageCache:shared,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,fn)=>write(()=>fn(p)),call:async(s,system,user)=>{const value=JSON.parse(user);if(value.task==='ppt_deck_review')return JSON.stringify({terms:[],changes:[]});calls.push({model:s.model,page:value.page});return JSON.stringify(page());}});
  await (await service.start(p.id,f.id,settings,{origin:'http://mock'})).done;assert.deepEqual(calls,[{model:'primary',page:3}]);const next=JSON.parse(await readFile(path.join(dir,'Parsed','ppt','ppt_task.json')));assert.equal(next.contractVersion,2);assert.deepEqual(next.pages.slice(0,2),old.pages.slice(0,2));assert.equal(p.files[0].aiParse.status,'done');
  await assert.rejects(()=>service.acceptPartial(p.id,f.id),/全部页面/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

for(const provider of ['api','antigravity-acp'])test('invalid course-map formatting preserves page learning via '+provider,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-map-ppt-')),write=serialWriter();let mapCalls=0,pageCalls=0;
 const f={id:'ppt',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf'},p={id:'Week_Map',name:'Map',revision:0,materialRevision:0,files:[f],sessions:[]},settings={model:'primary',apiKey:'secret',contextChars:100000,parseConcurrency:2,fallbackEnabled:true,fallbackModel:'backup'};
 if(provider==='antigravity-acp')Object.assign(settings,{
  modelRoutingVersion:2,defaultProfileId:'mock-acp',modelRoutes:{},
  modelProfiles:[{id:'mock-acp',provider,model:'primary',acpEntry:'cli',acpExecutable:'C:\\Official\\agy.exe'}],
 });
 const shared=pageCacheService({root,previews:{status:async()=>({direct:true,status:'ready'})},render:async()=>({open:async()=>({pages:2}),page:async()=>({image:'data:image/png;base64,YQ==',nativeText:'Comparison',warnings:[]}),close:async()=>{}})});
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source',f.stored),'ORIGINAL');await mkdir(path.join(dir,'skills'));
  for(const name of ['ppt_map','ppt_learning','ppt_recognition','ppt_block_translation','ppt_explanation','ppt_response_repair','ppt_deck_review'])await copyFile(path.join(root,'skills',name+'.md'),path.join(dir,'skills',name+'.md'));
  const service=aiMaterialService({root:dir,pageCache:shared,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,fn)=>write(()=>fn(p)),call:async(s,system,user)=>{assert.equal(s.model,'primary');assert.equal(s.provider,provider);assert.equal(s.apiKey,provider==='api'?'secret':undefined);const input=JSON.parse(user);if(input.task==='ppt_deck_review')return JSON.stringify({terms:[],changes:[]});if(input.pages){mapCalls++;return 'invalid map JSON';}pageCalls++;assert.equal(input.courseContext.neighbours.length,1);return JSON.stringify(page());}});
  await (await service.start(p.id,f.id,settings,{origin:'http://mock'})).done;assert.equal(mapCalls,3);assert.equal(pageCalls,2);assert.equal(p.files[0].aiParse.status,'done');const saved=JSON.parse(await readFile(path.join(dir,'Parsed','ppt','ppt_task.json')));assert.equal(saved.mapProvisional,true);assert(saved.mapDiagnostic.error);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('dense-page split resumes failed explanation without repeating recognized text or completed translations',async()=>{
 const state={},counts={parse:0,translation:0,explanation:0};let fail=true,persisted=0;
 const call=async(s,prompt,user)=>{counts[prompt]++;if(prompt==='parse')return JSON.stringify(page());if(prompt==='translation'){const input=JSON.parse(user);return JSON.stringify({paragraphs:input.paragraphs.map(p=>({id:p.id,chinese:'完整译文'}))});}if(fail)throw Error('temporary explanation failure');return JSON.stringify({pageType:'concept',closeReading:'解释概念的限定条件。'});};
 const options={input:{page:7,hidden:false,speakerNotes:'',nativeText:'original'},source:{fileName:'slides.pdf',format:'pdf',sha256:'a'.repeat(64)},settings:{},prompts:{parse:'parse',translation:'translation',explanation:'explanation'},state,call,options:{images:['data:image/png;base64,YQ=='],json:true},persist:async()=>{persisted++;}};
 await assert.rejects(()=>splitLearning(options),/temporary/);assert(state.original);assert(Object.keys(state.translations).length);fail=false;const result=await splitLearning(options);assert.equal(counts.parse,1);assert.equal(counts.translation,1);assert.equal(counts.explanation,2);assert.equal(result.learning.paragraphs.length,2);assert(persisted>=3);
});

test('shared disk preview coalesces pages, survives restart, regenerates only missing images, invalidates fonts and originals',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-cache-'));let launches=0,font='v1';const drawn=[];
 const f={id:'ppt',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf'},previews={status:async()=>({direct:true,status:'ready'})};
 const options={root,previews,fonts:{fingerprint:async()=>font},render:async()=>{launches++;await sleep(15);return {open:async()=>({pages:3}),page:async i=>{drawn.push(i);await sleep(10);return {image:'data:image/png;base64,YQ==',nativeText:'Page '+(i+1),warnings:[]};},close:async()=>{}};}};
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source',f.stored),'ORIGINAL');let cache=pageCacheService(options);
  await Promise.all([0,1,2].map(index=>cache.page(dir,f,{}, {origin:'http://local',index})));assert.equal(launches,1);assert.deepEqual([...drawn].sort(),[0,1,2]);
  cache=pageCacheService(options);await cache.ensure(dir,f,{}, {origin:'http://local'});assert.equal(launches,1,'disk cache survives service restart');
  await unlink(path.join(dir,'.Cache','Pages','ppt','page-2.png'));await cache.ensure(dir,f,{}, {origin:'http://local'});assert.equal(launches,2);assert.deepEqual(drawn.slice(0,3).sort(),[0,1,2]);assert.equal(drawn.at(-1),1);assert.equal(drawn.length,4);
  font='v2';await cache.page(dir,f,{}, {origin:'http://local',index:0});assert.equal(launches,3);assert.equal(drawn.at(-1),0);
  await writeFile(path.join(dir,'Source',f.stored),'NEW ORIGINAL');const result=await cache.page(dir,f,{}, {origin:'http://local',index:0});assert.equal(launches,4);assert.equal(await readFile(path.join(dir,'Source',f.stored),'utf8'),'NEW ORIGINAL');assert.equal(result.seed.renderKey,result.renderKey);
  await assert.rejects(()=>cache.page(dir,f,{}, {origin:'http://local',index:99}),/超出/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('PPT map precedes combined calls, same-primary retry persists and never uses fallback, preparation uses saved learning without more model calls',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-learning-')),write=serialWriter(),firstPage=Promise.withResolvers();let launches=0,failAll=false,overlapped=false;const requests=[];
 let p={id:'Week_PPT',name:'PPT',revision:0,materialRevision:0,files:[{id:'ppt',name:'Slides.pdf',stored:'Slides.pdf',role:'ppt'}],sessions:[]};
 const settings={baseUrl:'http://mock/v1',model:'primary',apiKey:'secret',maxOutputTokens:12000,parseConcurrency:2,contextConcurrency:2,contextChars:180000,fallbackEnabled:true,fallbackModel:'backup'};
 const inventory=Array.from({length:3},(_,index)=>({nativeText:'Comparative literature '+index,speakerNotes:'file notes',hidden:index===2}));
 const shared=pageCacheService({root,previews:{status:async()=>({status:'ready',direct:true})},render:async()=>{
  launches++;
  return {open:async()=>({pages:3,inventory}),page:async i=>{
   if(i===2&&!failAll)overlapped=await Promise.race([firstPage.promise.then(()=>true),sleep(800).then(()=>false)]);
   return {image:'data:image/png;base64,YQ==',...inventory[i],warnings:[]};
  },close:async()=>{}};
 }});
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','Slides.pdf'),'ORIGINAL');await mkdir(path.join(dir,'skills'));
  for(const name of ['ppt_map','ppt_learning','ppt_recognition','ppt_block_translation','ppt_explanation','ppt_response_repair','ppt_deck_review'])await copyFile(path.join(root,'skills',name+'.md'),path.join(dir,'skills',name+'.md'));
  const call=async(s,system,user,options)=>{
   const input=JSON.parse(user);if(input.task==='ppt_deck_review')return JSON.stringify({terms:[],changes:[]});requests.push({map:!!input.pages,page:input.page,model:s.model});if(failAll){const e=Error('unauthorized');e.httpStatus=401;throw e;}
   if(input.pages){assert.equal(options.images,undefined);return JSON.stringify({overview:'概念如何发展',pages:input.pages.map(p=>({page:p.page,title:'Concept',section:'Comparison',purpose:'限定关系'})),terms:[{english:'comparison',chinese:'比较'}]});}
   assert(options.images[0].startsWith('data:image/png;'));assert(input.courseContext.neighbours.length<=2);assert.equal(input.courseContext.current.page,input.page);
   if(input.page===1)firstPage.resolve();
   if(input.page===2&&requests.filter(r=>r.page===2).length===1){const e=Error('RECITATION');e.category='recitation';throw e;}return JSON.stringify(page());
  };
  const service=aiMaterialService({root:dir,pageCache:shared,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,fn)=>write(()=>fn(p)),call});
  await (await service.start(p.id,'ppt',settings,{origin:'http://mock'})).done;assert.equal(overlapped,true,'first inference starts before the last screenshot');assert.equal(requests[0].map,true);assert.equal(requests.filter(r=>r.page===1).length,1);assert.deepEqual(requests.filter(r=>r.page===2).map(r=>r.model),['primary','primary']);
  const report=JSON.parse(await readFile(path.join(dir,'Parsed/ppt/ai_analysis.json')));assert.equal(report.pages[2].hidden,true);assert.equal(report.parser.pageProvenance[1].model,'primary');assert(requests.every(r=>r.model==='primary'));assert.equal(report.courseMap.pages.length,3);
  const revision=p.materialRevision,n=requests.length;await (await service.start(p.id,'ppt',settings,{origin:'http://mock'})).done;assert.equal(requests.length,n);assert.equal(p.materialRevision,revision,'reusing output does not invalidate all course artifacts');assert.equal(launches,1);
  const result=await preparation(p,settings,{dir,model:{object(){throw Error('duplicate translation');},text(){throw Error('duplicate close reading');}},prompts:{},stage:async()=>{},context:''});const reader=JSON.parse(result.files['PPT_Reader.json']);assert.equal(reader.pages.length,3);assert.equal(reader.pages[0].paragraphs[0].chinese,'比较文学');assert.match(result.files['PPT_Bilingual_Guide.md'],/第 3 页/);
  const before=await readFile(path.join(dir,'Parsed/ppt/blocks.json'),'utf8');failAll=true;await assert.rejects((await service.start(p.id,'ppt',settings,{origin:'http://mock',fresh:true})).done);assert.equal(await readFile(path.join(dir,'Parsed/ppt/blocks.json'),'utf8'),before,'failed rerun preserves published evidence and translations');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('all twelve PPT pages publish despite an invalid review term; continuation repairs the item without any new visual requests',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-twelve-review-')),write=serialWriter(),p={id:'Week_Twelve',name:'Twelve',revision:0,materialRevision:0,files:[{id:'ppt',name:'Slides.pdf',stored:'Slides.pdf',role:'ppt'}],sessions:[]};let visual=0,reviews=0;
 const settings={baseUrl:'http://mock/v1',model:'primary',apiKey:'secret',maxOutputTokens:12000,parseConcurrency:3,contextChars:180000};
 const shared=pageCacheService({root,previews:{status:async()=>({status:'ready',direct:true})},render:async()=>({open:async()=>({pages:12}),page:async()=>({image:'data:image/png;base64,YQ==',nativeText:'Comparative literature',warnings:[]}),close:async()=>{}})});
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','Slides.pdf'),'ORIGINAL');await mkdir(path.join(dir,'skills'));for(const n of ['ppt_map','ppt_learning','ppt_recognition','ppt_block_translation','ppt_explanation','ppt_response_repair','ppt_deck_review'])await copyFile(path.join(root,'skills',n+'.md'),path.join(dir,'skills',n+'.md'));
  const call=async(s,sys,user,o)=>{const v=JSON.parse(user);assert.equal(s.model,'primary');if(v.task==='ppt_deck_review'){reviews++;assert.equal(o.images,undefined);const available=JSON.parse(await readFile(path.join(dir,'Parsed/ppt/ai_analysis.json')));assert.equal(available.pages.length,12,'all pages must be readable before review returns');assert.equal(p.files[0].aiParse.status,'running');if(v.mode==='repair_items')return JSON.stringify({repairs:v.unresolved.map(item=>({id:item.id,value:null,reason:'Not present in this deck; withdraw unsupported term'}))});return JSON.stringify({terms:v.pages[0].page===1?[{english:'Invented term',chinese:'不存在',scope:'test',pages:[1]}]:[],changes:[]});}if(v.pages)return JSON.stringify({overview:'Course',pages:v.pages.map(p=>({page:p.page,title:'Title',section:'Part',purpose:'Concept'})),terms:[]});visual++;return JSON.stringify(page());};
  const service=aiMaterialService({root:dir,pageCache:shared,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,change)=>write(()=>change(p)),call});
  await (await service.start(p.id,'ppt',settings,{origin:'http://mock'})).done;assert.equal(visual,12);assert.equal(p.files[0].aiParse.status,'done');assert.equal(p.files[0].aiParse.review.status,'pending');assert.equal(p.files[0].parseStatus,'ready');
  const published=JSON.parse(await readFile(path.join(dir,'Parsed/ppt/ai_analysis.json')));assert.equal(published.pages.length,12);assert.equal(published.coverage.missing.length,0);assert.equal(published.deckReview.terms.length,0);
  const partial=await service.partial(p.id,'ppt');assert.equal(partial.review.issues[0].value.english,'Invented term');assert(partial.reviewDiagnostics[0].diagnostic.response);
  await (await service.start(p.id,'ppt',settings,{origin:'http://mock'})).done;assert.equal(visual,12);assert.equal(reviews,3);assert.equal(p.files[0].aiParse.review.status,'complete');const revision=p.materialRevision;
  await (await service.start(p.id,'ppt',settings,{origin:'http://mock'})).done;assert.equal(reviews,3);assert.equal(p.materialRevision,revision);
 }finally{await rm(dir,{recursive:true,force:true});}
});
