import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mapPool,semaphore} from '../lib/concurrency.mjs';
import {pipeline} from '../lib/pipeline.mjs';
import {mineruCloud} from '../lib/mineru-cloud.mjs';
import {archiveDocument,contentListDocument,documentText} from '../lib/materials.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function temporary(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-parallel-'));try{await fn(dir);}finally{const relative=path.relative(os.tmpdir(),dir);if(relative&&!relative.startsWith('..'))await rm(dir,{recursive:true,force:true});}}
test('context pool overlaps requests, respects limit, preserves input order and drains failures',async()=>{
 let active=0,peak=0,finished=0;const results=await mapPool([0,1,2,3,4,5,6],3,async i=>{active++;peak=Math.max(peak,active);try{await sleep(35-i*4);if(i===2)throw Error('one source failed');return i;}finally{active--;finished++;}});
 assert.equal(peak,3);assert.equal(active,0);assert.equal(finished,7);assert.equal(results[2].status,'rejected');assert.deepEqual(results.filter(r=>r.status==='fulfilled').map(r=>r.value),[0,1,3,4,5,6]);
});
test('40 parallel completions preserve all checkpoints and simultaneous identical work is coalesced',()=>temporary(async dir=>{
 let calls=0;const settings={model:'fixture',baseUrl:'local'};const model=await pipeline(dir,settings,{call:async(s,sys,user)=>{calls++;await sleep(Number(user)%7);return 'notes-'+user;}});
 await Promise.all(Array.from({length:40},(_,i)=>model.text('context '+i,'rules',String(i))));await Promise.all([model.text('identical','rules','99'),model.text('identical','rules','99')]);assert.equal(calls,41);
 const saved=JSON.parse(await readFile(path.join(dir,'Parsed','.pipeline.json'),'utf8'));assert.equal(Object.keys(saved.entries).length,41);
 const resumed=await pipeline(dir,settings,{call:async()=>{throw Error('unexpected reprocessing');}});for(let i=0;i<40;i++)assert.equal(await resumed.text('context '+i,'rules',String(i)),'notes-'+i);
}));
test('cloud upload gate overlaps 4 uploads and releases slots before parsing; six documents never cross-map',()=>temporary(async dir=>{
 const count=6,gate=semaphore(4),controller=new AbortController();let active=0,peak=0,uploaded=0;const timer=setTimeout(()=>controller.abort(),2500);
 const fake=async(url,opts={})=>{opts.signal?.throwIfAborted();url=String(url);
  if(url.endsWith('/file-urls/batch')){const b=JSON.parse(opts.body),id=b.files[0].data_id;return Response.json({code:0,data:{batch_id:id,file_urls:[`https://storage.example/${id}`]}});}
  if(url.startsWith('https://storage.example/')){active++;peak=Math.max(peak,active);await sleep(20);active--;uploaded++;return new Response('',{status:200});}
  if(url.includes('/extract-results/batch/')){const id=url.split('/').at(-1);return Response.json({code:0,data:{extract_result:[{data_id:id,state:uploaded===count?'done':'pending',full_zip_url:`https://cdn.example/${id}`}]}});}
  if(url.startsWith('https://cdn.example/')){const id=url.split('/').at(-1);return new Response(zipFixture([['full.md','THIS MARKDOWN MUST NOT BE USED'],['doc_content_list.json',JSON.stringify([{type:'text',page_idx:0,text:'Evidence for '+id}])]]));}
  throw Error('unexpected URL');
 };
 try{const files=await Promise.all(Array.from({length:count},async(_,i)=>{const file=path.join(dir,i+'.pdf');await writeFile(file,'fixture');return file;}));const docs=await Promise.all(files.map((file,i)=>mineruCloud({mineruToken:'fixture'},file,async()=>{},{fetch:fake,sleep:()=>sleep(5),signal:controller.signal,source:{id:'doc'+i,name:i+'.pdf',role:'reading'},uploadGate:gate,archivePath:path.join(dir,'parsed'+i,'mineru_result.zip')})));
 assert.equal(peak,4);assert.equal(uploaded,count);docs.forEach((doc,i)=>{assert.equal(doc.source.id,'doc'+i);assert.equal(doc.blocks[0].text,'Evidence for doc'+i);assert(!documentText(doc).includes('MARKDOWN'));});assert((await readFile(path.join(dir,'parsed0','mineru_result.zip'))).length>0);
 }finally{clearTimeout(timer);controller.abort();}
}));
test('JSON preserves tables, equations, images and coordinates; unsupported blocks fail visibly',()=>{
 const source={id:'reading',name:'Original.pdf',role:'reading'};const doc=contentListDocument([{type:'text',page_idx:0,text:'A unique paragraph.'},{type:'table',page_idx:1,table_body:'<table><tr><td>42</td></tr></table>',table_caption:['Table 1']},{type:'equation',page_idx:2,text:'E=mc^2'},{type:'image',page_idx:2,img_path:'images/a.png',img_caption:['Figure 1']}],source);const text=documentText(doc);assert.equal(text.split('A unique paragraph.').length-1,1);assert.match(text,/Reading page 2/);assert.match(text,/42/);assert.match(text,/E=mc/);assert.match(text,/pixels not inspected/);
 assert.throws(()=>contentListDocument([{type:'new_unknown_type'}],source),/不会静默丢弃/);assert.throws(()=>archiveDocument(zipFixture([['full.md','text only']]),source),/不使用 Markdown/);
});
