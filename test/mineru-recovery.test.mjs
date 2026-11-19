import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {contentListDocument,documentText,documentChunks,contentHash} from '../lib/materials.mjs';
import {recoverMineruArchives} from '../lib/mineru-recovery.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';

test('MinerU extended text categories retain exact text, original type, order, coordinates and evidence labels',()=>{
 const types=['text','aside_text','page_footnote','ref_text','header','footer','page_number'];
 const list=types.map((type,i)=>({type,text:'unique '+type,page_idx:i,bbox:[1,2,3,4]})),doc=contentListDocument(list,{id:'r',name:'Reading.pdf',role:'reading'});
 assert.equal(doc.blocks.length,list.length);
 for(let i=0;i<list.length;i++){assert.equal(doc.blocks[i].type,list[i].type);assert.equal(doc.blocks[i].text,list[i].text);assert.equal(doc.blocks[i].pageIndex,i);assert.deepEqual(doc.blocks[i].bbox,list[i].bbox);}
 for(const text of [documentText(doc),documentChunks(doc,500).join('\n')]){assert.match(text,/Page footnote/);assert.match(text,/Aside \/ marginal text/);assert.match(text,/Reference text/);assert.match(text,/Page header; separate from body/);assert.match(text,/Printed page number; not PDF file page/);for(const block of list)assert.equal(text.split(block.text).length-1,1);}
 assert.throws(()=>contentListDocument([{type:'aside_text',text:['bad']}],doc.source),/格式不支持/);
 assert.throws(()=>contentListDocument([{type:'genuinely_unknown',text:'preserve error'}],doc.source),/不会静默丢弃/);
});

test('startup restores downloaded ZIP without remote calls, keeps originals and AI checkpoints, skips accepted results, and is idempotent',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-mineru-recovery-'));let saves=0;
 const p={status:'error',error:'1 份材料等待解析。',failedStage:'解析材料',revision:1,materialRevision:1,files:[{id:'r',name:'Reading.pdf',role:'reading',stored:'Reading.pdf',sha256:contentHash('ORIGINAL'),parseStatus:'failed',error:'aside_text',aiParse:{status:'error'}},{id:'manual',name:'other.pdf',role:'reading',parsed:'manual/blocks.json'}]};
 try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source/Reading.pdf'),'ORIGINAL');await mkdir(path.join(dir,'Parsed/r'),{recursive:true});const archive=zipFixture([['a_content_list.json',JSON.stringify([{type:'aside_text',text:'Side note',page_idx:0},{type:'page_footnote',text:'1. A footnote',page_idx:0}])]]);await writeFile(path.join(dir,'Parsed/r/mineru_result.zip'),archive);await writeFile(path.join(dir,'Parsed/r/ai_task.json'),'CHECKPOINT');
  const put=async()=>saves++;const result=await recoverMineruArchives(p,dir,put);assert.deepEqual(result.recovered,['r']);assert.equal(p.status,'idle');assert.equal(p.files[0].parseStatus,'ready');assert.equal(p.materialRevision,2);assert.equal(p.files[0].aiParse,undefined);assert.equal(await readFile(path.join(dir,'Source/Reading.pdf'),'utf8'),'ORIGINAL');assert.deepEqual(await readFile(path.join(dir,'Parsed/r/mineru_result.zip')),archive);assert.equal(await readFile(path.join(dir,'Parsed/r/ai_task.json'),'utf8'),'CHECKPOINT');assert.equal(JSON.parse(await readFile(path.join(dir,'Parsed/r/blocks.json'))).blocks.length,2);assert.equal(p.files[1].parsed,'manual/blocks.json');assert.equal((await recoverMineruArchives(p,dir,put)).recovered.length,0);assert.equal(saves,1);
  delete p.files[0].parsed;p.files[0].sha256=contentHash('CHANGED');assert.equal((await recoverMineruArchives(p,dir,put)).failed.length,1);assert.equal(p.files[0].parsed,undefined);assert.equal(saves,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
