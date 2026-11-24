import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {previewService} from '../lib/preview.mjs';
import {sourcePath} from '../lib/storage.mjs';
import {zipFixture} from './helpers/zip-fixture.mjs';

const {PDFDocument}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function pdf(count){const doc=await PDFDocument.create();for(let i=0;i<count;i++)doc.addPage([400,300]);return Buffer.from(await doc.save());}
const deckBytes=zipFixture([['ppt/slides/slide1.xml','A'],['ppt/slides/slide2.xml','B']]);

/** A stand-in for PowerPoint: writes the PDF and, when asked, one PNG per slide plus slides.json. */
function fakePowerPoint({slides=2,listed=slides,engine='PowerPoint'}={}){
 const calls=[];
 return {calls,convert:async({dest,slidesDir})=>{
  calls.push({slidesDir:!!slidesDir});await writeFile(dest,await pdf(2));
  if(slidesDir&&engine==='PowerPoint'){await mkdir(slidesDir,{recursive:true});for(let i=1;i<=slides;i++)await writeFile(path.join(slidesDir,'slide-'+i+'.png'),'png '+i);await writeFile(path.join(slidesDir,'slides.json'),JSON.stringify({count:listed,width:1920,height:1080}));}
  return engine;
 }};
}
async function deck(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-slides-')),f={id:'ppt',name:'Lecture.pptx',stored:'Materials/Lecture.pptx'};
 await mkdir(path.join(dir,'Source','Materials'),{recursive:true});await writeFile(sourcePath(dir,f.stored),deckBytes);return {dir,f};
}

test('PowerPoint slide images are kept with the preview and replace nothing until complete',async()=>{
 const {dir,f}=await deck(),fake=fakePowerPoint();
 try{
  const service=previewService(dir,{convert:fake.convert});
  assert.equal(await service.slideImage(dir,f,0),null,'no images before PowerPoint has drawn the deck');
  const state=await service.settle(dir,f,{});
  assert.equal(state.status,'ready');assert.equal(state.slides,true);assert.equal(state.engine,'PowerPoint');assert.equal(fake.calls[0].slidesDir,true);
  assert.equal(await readFile(await service.slideImage(dir,f,1),'utf8'),'png 2');
  assert.deepEqual(await readFile(sourcePath(dir,f.stored)),deckBytes,'the original is never changed');
  // A PDF linked by the user replaces PowerPoint's images (they would no longer match what is shown).
  await service.associate(dir,f,await pdf(2));
  assert.equal((await service.status(dir,f)).slides,undefined);assert.equal(await service.slideImage(dir,f,0),null);
  await service.clear(dir,f);assert.equal((await service.status(dir,f)).status,'missing');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('an incomplete PowerPoint export or another converter keeps the PDF but no slide images',async()=>{
 for(const options of [{slides:2,listed:3},{engine:'LibreOffice'}]){
  const {dir,f}=await deck();
  try{
   const service=previewService(dir,{convert:fakePowerPoint(options).convert}),state=await service.settle(dir,f,{});
   assert.equal(state.status,'ready');assert.equal(state.slides,undefined);assert.equal(await service.slideImage(dir,f,0),null);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('waiting for a failed PowerPoint drawing returns the error instead of throwing, and it is not retried by itself',async()=>{
 const {dir,f}=await deck();let calls=0;
 try{
  const service=previewService(dir,{convert:async()=>{calls++;throw Error('PowerPoint：无法打开');}});
  const state=await service.settle(dir,f,{});assert.equal(state.status,'error');assert.match(state.error,/无法打开/);
  await service.settle(dir,f,{});assert.equal(calls,1,'a failure is retried only on request');
  await service.ensure(dir,f,{},{force:true});await pause(20);assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});

// Real PowerPoint: opt in with CLASSROOM_POWERPOINT=1 (it starts PowerPoint on this computer, hidden).
const powerPoint=process.platform==='win32'&&process.env.CLASSROOM_POWERPOINT==='1';
test('real PowerPoint draws every slide and those images become the page images',{skip:!powerPoint&&'set CLASSROOM_POWERPOINT=1 to run with PowerPoint'},async()=>{
 try{execFileSync('reg',['query','HKCR\\PowerPoint.Application'],{stdio:'ignore'});}catch{return;}
 const data=await mkdtemp(path.join(os.tmpdir(),'classroom-powerpoint-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:data,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<150&&!log.includes('http://');i++)await pause(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const api=async(url,value)=>{const r=await fetch(base+url,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});const v=await r.json();assert(r.ok,JSON.stringify(v));return v;};
  let p=await api('/api/projects',{name:'PowerPoint'});
  const r=await fetch(base+'/api/projects/'+p.id+'/upload',{method:'POST',headers:{'x-file-role':'ppt','x-file-name':'deck.pptx'},body:await readFile(new URL('fixtures/text-layout.pptx',import.meta.url))});assert.equal(r.status,201);p=await r.json();
  const f=p.files[0],route='/api/projects/'+p.id;
  let st;for(let i=0;i<300;i++){st=await api(route+'/preview-status?source='+f.id);if(!['queued','running','missing'].includes(st.status))break;await pause(200);}
  assert.equal(st.status,'ready',st.error);assert.equal(st.slides,true);assert.equal(st.pages,6);
  const reader=await api(route+'/reader?source='+f.id);assert.equal(reader.drawnBy.kind,'powerpoint');
  const image=Buffer.from(await (await fetch(base+route+'/page-image?source='+f.id+'&page=2')).arrayBuffer());
  const exported=await readFile(path.join(data,'classes',p.id,'.Cache','PPT',st.hash+'-slides','slide-2.png'));
  assert.deepEqual(image,exported,'the page image is exactly the slide PowerPoint exported');
  await access(path.join(data,'classes',p.id,'.Cache','PPT',st.hash+'.pdf'));
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(data,{recursive:true,force:true});}
});
