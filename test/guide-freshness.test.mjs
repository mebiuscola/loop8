import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pageCacheService,sameImages} from '../lib/page-cache.mjs';
import {learningFreshness} from '../lib/ppt-quality.mjs';
import {aiMaterialService} from '../lib/ai-material.mjs';
import {serialWriter} from '../lib/concurrency.mjs';
import {contentHash} from '../lib/materials.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));

// Guides are outdated only when the picture they were made from changed (2026-11-24): not when Edge
// updates or the drawing code changes while pages are drawn exactly (PowerPoint's images or a PDF).

test('sameImages: image identity first, then the old render key, then the drawing basis of exact drawings',()=>{
 const exact={renderKey:'r2',imageKey:'i1',exact:true,renderBasis:'pdf',hash:'s1'},approximate={renderKey:'r2',imageKey:'r2',exact:false,renderBasis:'pptx',hash:'s1'};
 assert.equal(sameImages({imageKey:'i1',renderKey:'r1'},exact),true,'same pictures although the drawing code changed');
 assert.equal(sameImages({imageKey:'i0',renderKey:'r2'},exact),false,'other pictures');
 assert.equal(sameImages({renderKey:'r2'},approximate),true,'saved before imageKey: the same full key');
 assert.equal(sameImages({renderKey:'r1',renderBasis:'pdf',sourceHash:'s1'},exact),true,'saved before imageKey, exact drawing, same original and basis');
 assert.equal(sameImages({renderKey:'r1',renderBasis:'pdf',sourceHash:'s0'},exact),false,'another original');
 assert.equal(sameImages({renderKey:'r1',renderBasis:'pptx',sourceHash:'s1'},exact),false,'drawn another way');
 assert.equal(sameImages({renderKey:'r1',renderBasis:'pptx',sourceHash:'s1'},approximate),false,'the approximate drawing depends on its code and the browser');
 assert.equal(learningFreshness({parser:{renderKey:'r1',renderBasis:'pdf'},source:{sha256:'s1'}},exact).stale,false);
 assert.equal(learningFreshness({parser:{renderKey:'r1',renderBasis:'pptx'},source:{sha256:'s1'}},exact).stale,true);
});

test('an Edge update changes the cache key but not the image identity of exactly drawn pages',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-freshness-'));
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','Slides.pdf'),'PDF ORIGINAL');await writeFile(path.join(dir,'Source','Deck.pptx'),'PPTX ORIGINAL');
  // Two "browser versions": the key uses the program's size and time.
  const edgeA=path.join(dir,'edge-a.exe'),edgeB=path.join(dir,'edge-b.exe');await writeFile(edgeA,'a');await writeFile(edgeB,'bb');
  const pdf={id:'pdf',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf'},pptx={id:'pptx',role:'ppt',name:'Deck.pptx',stored:'Deck.pptx'};
  const cache=pageCacheService({root,previews:{status:async(d,f)=>f.id==='pdf'?{status:'ready',direct:true}:{status:'missing'}}});
  const [a,b]=[await cache.describe(dir,pdf,{browserPath:edgeA}),await cache.describe(dir,pdf,{browserPath:edgeB})];
  assert.notEqual(a.renderKey,b.renderKey,'the page image cache is rebuilt');assert.equal(a.imageKey,b.imageKey,'the guide stays current');assert.equal(a.exact,true);
  const [c,d]=[await cache.describe(dir,pptx,{browserPath:edgeA}),await cache.describe(dir,pptx,{browserPath:edgeB})];
  assert.equal(c.exact,false);assert.equal(c.imageKey,c.renderKey);assert.notEqual(c.imageKey,d.imageKey,'the approximate drawing may look different in another browser');
 }finally{await rm(dir,{recursive:true,force:true});}
});

const page=n=>({title:'Page',page:n,hidden:false,blank:false,speakerNotes:'',originalText:[{text:'Comparative literature',method:'native',role:'heading'}],visualObservations:[],analysis:[],uncertainties:[],inspection:{textExtracted:true,fullPageViewed:true,status:'complete'},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'比较文学'}],closeReading:'解释这一页的概念。'}});
for(const [label,basis,redone] of [['kept when only the drawing code or browser changed','pdf',0],['redone when the pages were drawn another way','pptx',3]])
test('a finished guide saved with an older key is '+label,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-freshness-run-')),write=serialWriter();let pageCalls=0;
 const f={id:'ppt',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf'},p={id:'Week_Fresh',name:'Fresh',revision:1,materialRevision:1,files:[f],sessions:[]};
 const settings={baseUrl:'http://mock/v1',model:'primary',apiKey:'secret',contextChars:100000,parseConcurrency:2};
 const shared=pageCacheService({root,previews:{status:async()=>({status:'ready',direct:true})},render:async()=>({open:async()=>({pages:3}),page:async i=>({image:'data:image/png;base64,YQ==',nativeText:'Text '+i,warnings:[]}),close:async()=>{}})});
 try{
  await mkdir(path.join(dir,'Source'));const bytes=Buffer.from('ORIGINAL');await writeFile(path.join(dir,'Source',f.stored),bytes);await mkdir(path.join(dir,'skills'));
  for(const name of ['ppt_map','ppt_learning','ppt_recognition','ppt_block_translation','ppt_explanation','ppt_response_repair','ppt_deck_review'])await copyFile(path.join(root,'skills',name+'.md'),path.join(dir,'skills',name+'.md'));
  const source={fileName:f.name,format:'pdf',sha256:contentHash(bytes)};
  // Saved by an earlier version: another full key (older Edge or drawing code), no image identity.
  const old={version:2,source,total:3,pages:[1,2,3].map(page),learningSchema:'classroom.ppt-learning.v1',learningRules:'old-contract',renderKey:'key-from-older-edge',renderBasis:basis,courseMap:{overview:'Course',pages:[1,2,3].map(n=>({page:n,title:'Page',section:'Part',purpose:'Concept'})),terms:[]},attempts:{},cycles:{},provenance:{0:{model:'primary'},1:{model:'primary'},2:{model:'primary'}}};
  await mkdir(path.join(dir,'Parsed','ppt'),{recursive:true});await writeFile(path.join(dir,'Parsed','ppt','ppt_task.json'),JSON.stringify(old));
  const service=aiMaterialService({root:dir,pageCache:shared,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,fn)=>write(()=>fn(p)),call:async(s,system,user)=>{const value=JSON.parse(user);if(value.task==='ppt_deck_review')return JSON.stringify({terms:[],changes:[]});if(value.pages)return JSON.stringify(old.courseMap);pageCalls++;return JSON.stringify(page(value.page));}});
  await (await service.start(p.id,f.id,settings,{origin:'http://mock'})).done;
  assert.equal(pageCalls,redone);
  const next=JSON.parse(await readFile(path.join(dir,'Parsed','ppt','ppt_task.json')));
  assert.equal(next.pages.filter(Boolean).length,3);
  if(!redone)assert.deepEqual(next.pages,old.pages,'the finished pages are kept as they were');
 }finally{await rm(dir,{recursive:true,force:true});}
});
