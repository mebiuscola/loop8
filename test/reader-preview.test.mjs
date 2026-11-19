import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {storeSource,migrateSourceNames,sourcePath,originalName} from '../lib/storage.mjs';
import {previewService} from '../lib/preview.mjs';
import {bodyParagraphs} from '../lib/reader.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';
const {PDFDocument}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const temp=()=>mkdtemp(path.join(os.tmpdir(),'classroom-reader-'));
async function clean(dir){const relative=path.relative(os.tmpdir(),dir);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))await rm(dir,{recursive:true,force:true});}
async function pdf(count){const doc=await PDFDocument.create();for(let i=0;i<count;i++)doc.addPage([400,300]);return Buffer.from(await doc.save());}
test('original names survive, different bytes receive numeric suffixes, identical bytes reuse storage, and sessions use readable folders',async()=>{
 const dir=await temp(),p={files:[],sessions:[{id:'id-only-in-manifest',type:'Seminar',title:'讨论',date:'2026-10-20'}]};
 try{
  const first=await storeSource(p,dir,{name:'Lecture 2.pptx',role:'ppt',bytes:Buffer.from('A')});assert.equal(first.stored,'Materials/Lecture 2.pptx');p.files.push({...first,id:'first',role:'ppt'});
  const duplicate=await storeSource(p,dir,{name:'Other name.pptx',role:'ppt',bytes:Buffer.from('A')});assert.equal(duplicate.existing.id,'first');
  const next=await storeSource(p,dir,{name:'Lecture 2.pptx',role:'ppt',bytes:Buffer.from('B')});assert.equal(next.stored,'Materials/Lecture 2 (2).pptx');p.files.push({...next,id:'second',role:'ppt'});
  const session=p.sessions[0],srt=await storeSource(p,dir,{name:'SmartSub_RAW.srt',role:'srt',session,bytes:Buffer.from('SRT')});assert.match(srt.stored,/Sessions\/2026-10-20_Seminar_讨论\/SmartSub_RAW.srt$/);assert(!srt.stored.includes(session.id));
  assert.equal(await readFile(sourcePath(dir,first.stored),'utf8'),'A');assert.equal(await readFile(sourcePath(dir,next.stored),'utf8'),'B');assert.equal((await readdir(path.join(dir,'Source','Materials'))).length,2);
  assert.equal(originalName('Ａ课件.pptx'),'Ａ课件.pptx');assert.throws(()=>originalName('../bad.pptx'));assert.throws(()=>sourcePath(dir,'../outside'));
 }finally{await clean(dir);}
});
test('legacy originals migrate only after manifest commit; failure leaves original bytes and old paths recoverable',async()=>{
 const dir=await temp();try{
  await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','uuid_Lecture.pptx'),'ORIGINAL');const p={files:[{id:'old-id',name:'Lecture.pptx',stored:'uuid_Lecture.pptx',role:'ppt'}],sessions:[],generation:'keep-output'};
  await assert.rejects(()=>migrateSourceNames(p,dir,async()=>{throw Error('disk save failed');}));assert.equal(p.files[0].stored,'uuid_Lecture.pptx');assert.equal(await readFile(path.join(dir,'Source','uuid_Lecture.pptx'),'utf8'),'ORIGINAL');
  await migrateSourceNames(p,dir,async next=>{assert.equal(await readFile(sourcePath(dir,next.files[0].stored),'utf8'),'ORIGINAL');await access(path.join(dir,'Source','uuid_Lecture.pptx'));});assert.equal(p.files[0].stored,'Materials/Lecture.pptx');assert.equal(p.generation,'keep-output');await assert.rejects(()=>access(path.join(dir,'Source','uuid_Lecture.pptx')));assert.equal((await readdir(path.join(dir,'Source','Materials'))).length,1);
 }finally{await clean(dir);}
});
test('preview cache coalesces conversion, reuses PDF, validates page counts, and clearing never deletes originals',async()=>{
 const dir=await temp(),two=await pdf(2),one=await pdf(1);let calls=0,active=0,peak=0;
 const service=previewService(dir,{convert:async({dest})=>{calls++;active++;peak=Math.max(peak,active);await pause(35);await writeFile(dest,two);active--;return 'fixture converter';}});
 try{
  await mkdir(path.join(dir,'Source','Materials'),{recursive:true});const bytes=zipFixture([['ppt/slides/slide1.xml','A'],['ppt/slides/slide2.xml','B']]),f={id:'ppt',name:'Lecture.pptx',stored:'Materials/Lecture.pptx'};await writeFile(sourcePath(dir,f.stored),bytes);
  await Promise.all([service.ensure(dir,f,{}),service.ensure(dir,f,{})]);for(let i=0;i<100&&(await service.status(dir,f)).status!=='ready';i++)await pause(10);let state=await service.status(dir,f);assert.equal(state.status,'ready');assert.equal(state.pages,2);assert.equal(calls,1);
  await service.ensure(dir,f,{});assert.equal(calls,1);await assert.rejects(()=>service.associate(dir,f,one),/隐藏页/);assert.deepEqual((await service.pdf(dir,f)).bytes,two);
  await service.clear(dir,f);assert.equal((await service.status(dir,f)).status,'missing');assert.deepEqual(await readFile(sourcePath(dir,f.stored)),bytes);
  const manual=await service.associate(dir,f,two);assert.equal(manual.engine,'手动关联 PDF');
  const direct={id:'pdf',name:'Lecture.pdf',stored:'Materials/Lecture.pdf'};await writeFile(sourcePath(dir,direct.stored),two);assert.equal((await service.ensure(dir,direct,{})).direct,true);await service.clear(dir,direct);assert.deepEqual((await service.pdf(dir,direct)).bytes,two);
  const other={id:'other',name:'Other.pptx',stored:'Materials/Other.pptx'};await writeFile(sourcePath(dir,other.stored),zipFixture([['ppt/slides/slide1.xml','C'],['ppt/slides/slide2.xml','D']]));await service.clear(dir,f);await Promise.all([service.ensure(dir,f,{}),service.ensure(dir,other,{})]);for(let i=0;i<100&&((await service.status(dir,f)).status!=='ready'||(await service.status(dir,other)).status!=='ready');i++)await pause(10);assert.equal(peak,1,'Office conversions must not collide');
 }finally{await clean(dir);}
});
test('missing converter reports actionable error and does not loop until explicit retry',async()=>{
 const dir=await temp();let calls=0;try{
  await mkdir(path.join(dir,'Source'));const f={name:'Lecture.ppt',stored:'Lecture.ppt'};await writeFile(sourcePath(dir,f.stored),'original');const service=previewService(dir,{convert:async()=>{calls++;throw Error('Install a converter or associate PDF');}});await service.ensure(dir,f,{});for(let i=0;i<100&&(await service.status(dir,f)).status!=='error';i++)await pause(10);assert.match((await service.status(dir,f)).error,/associate PDF/);await service.ensure(dir,f,{});assert.equal(calls,1);await service.ensure(dir,f,{},{force:true});for(let i=0;i<100&&(await service.status(dir,f)).status!=='error';i++)await pause(10);assert.equal(calls,2);assert.equal(await readFile(sourcePath(dir,f.stored),'utf8'),'original');
 }finally{await clean(dir);}
});
test('body translation excludes notes, interpretation, footer and page-number blocks',()=>{
 const page={externalInspection:{},blocks:[{evidenceKind:'original',originalRole:'body',originalText:'Main paragraph'},{evidenceKind:'original',originalRole:'footer',originalText:'Repeated footer'},{evidenceKind:'original',originalRole:'page_number',originalText:'12'},{evidenceKind:'analysis',text:'Interpretation'},{evidenceKind:'notes',text:'Speaker notes'}]};assert.deepEqual(bodyParagraphs(page),['Main paragraph']);
});
