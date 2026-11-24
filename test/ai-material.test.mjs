import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {aiMaterialService,adaptiveQueue,validatePdfPage,materialSettings} from '../lib/ai-material.mjs';
import {serialWriter} from '../lib/concurrency.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const page={printedPage:'12',status:'complete',blocks:[{kind:'body',text:'Original text'}, {kind:'image_description',text:'A visible diagram'}],uncertainties:[]};
test('PDF recovery validates evidence categories, missing text and uncertain pages',()=>{
 assert.equal(validatePdfPage(page),page);assert.throws(()=>validatePdfPage({...page,blocks:[]}));assert.throws(()=>validatePdfPage({...page,status:'partial'}));assert.throws(()=>validatePdfPage({...page,blocks:[{kind:'analysis',text:'invented'}]}));
 assert.equal(materialSettings({baseUrl:'a',model:'b',apiKey:'c',parseModel:'vision'}).model,'vision');
});
test('shared queue enforces a global cap and preserves queued cancellation',async()=>{
 const q=adaptiveQueue(2);let active=0,peak=0;const controller=new AbortController();const tasks=Array.from({length:12},(_,i)=>q.run(async()=>{active++;peak=Math.max(peak,active);await sleep(5);active--;return i;},i===11?controller.signal:undefined).catch(e=>e));controller.abort(Error('cancel'));const out=await Promise.all(tasks);assert.equal(peak,2);assert.equal(out[0],0);assert.match(out[11].message,/cancel/);
});
test('whole PDF jobs overlap globally, checkpoint resume skips complete pages, model change preserves, failed rerun preserves current result',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-ai-')),root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 let p={id:'Week_Test',revision:0,materialRevision:0,files:[{id:'a',name:'a.pdf',stored:'a.pdf',role:'reading'},{id:'b',name:'b.pdf',stored:'b.pdf',role:'reading'}]},active=0,peak=0,calls=0,fail=false,stopAfter=false;const write=serialWriter();
 const s={baseUrl:'http://local/v1',apiKey:'secret',model:'vision',maxOutputTokens:8000,parseConcurrency:2};
 await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','a.pdf'),'PDF A');await writeFile(path.join(dir,'Source','b.pdf'),'PDF B');
 let service;
 const options={root,getClass:async()=>structuredClone(p),dirFor:()=>dir,mutate:async(id,fn)=>write(()=>{fn(p);}),previews:{status:async()=>({status:'missing'})},render:async()=>({open:async()=>({pages:3}),page:async i=>({image:'data:image/png;base64,YQ==',nativeText:'page '+i,warnings:[],speakerNotes:'',hidden:false}),close:async()=>{}}),call:async(settings,system,user,o)=>{assert.equal(o.json,true);assert.match(o.images[0],/^data:image\/png/);active++;peak=Math.max(peak,active);calls++;for(let w=0;w<200&&peak<2;w++)await sleep(10);await sleep(20);active--;if(fail){const e=Error('unauthorized');e.httpStatus=401;throw e;}if(stopAfter&&JSON.parse(user).page===2){service.cancel('Week_Test','a');throw Error('cancel');}return JSON.stringify(page);}};
 service=aiMaterialService(options);
 try{
  const jobs=await Promise.all(['a','b'].map(fid=>service.start(p.id,fid,s,{origin:'http://local'})));await Promise.all(jobs.map(j=>j.done));assert.equal(peak,2);assert.equal(calls,6);assert.equal(p.materialRevision,2);assert.equal(p.files[0].aiParse.completed,3);
  const blocks=JSON.parse(await readFile(path.join(dir,'Parsed/a/blocks.json')));assert.equal(blocks.blocks.filter(b=>b.evidenceKind==='original').length,3);assert.equal(blocks.blocks.filter(b=>b.evidenceKind==='visual_observation').length,3);
  service=aiMaterialService(options);await (await service.start(p.id,'a',s,{origin:'http://local'})).done;assert.equal(calls,6,'disk checkpoints survive service restart');
  await (await service.start(p.id,'a',{...s,model:'changed'},{origin:'http://local'})).done;assert.equal(calls,6,'new model preserves successful pages');
  const before=await readFile(path.join(dir,'Parsed/a/blocks.json'),'utf8');fail=true;await assert.rejects((await service.start(p.id,'a',s,{origin:'http://local',fresh:true})).done);assert.equal(await readFile(path.join(dir,'Parsed/a/blocks.json'),'utf8'),before);assert.equal(p.files[0].aiParse.status,'error');assert.equal(service.busy(p.id),false);fail=false;
  stopAfter=true;await assert.rejects((await service.start(p.id,'a',s,{origin:'http://local',fresh:true})).done);assert.equal(p.files[0].aiParse.status,'cancelled');const checkpoint=JSON.parse(await readFile(path.join(dir,'Parsed/a/ai_task.json')));assert(checkpoint.pages[0]);stopAfter=false;
  const n=calls;service=aiMaterialService(options);await (await service.start(p.id,'a',s,{origin:'http://local'})).done;assert(calls-n<3,'only unfinished pages are sent again');
 }finally{await rm(dir,{recursive:true,force:true});}
});
