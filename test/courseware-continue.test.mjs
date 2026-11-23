import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {contentHash,contentListDocument} from '../lib/materials.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,waitFor} from './helpers/app.mjs';

const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');

// A courseware guide run interrupted part-way (e.g. by restarting Classroom) could not be continued
// when an older guide for the file existed: the row said "已完成导读" and offered only "阅读".
test('an interrupted courseware guide run can be continued even when an older guide exists',async t=>{
 try{await browserExecutable();}catch{t.skip('Browser unavailable');return;}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-continue-')),id='Week_K',folder=path.join(dir,'classes',id);let child,ui;
 try{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([720,405]).drawText('Slide',{x:40,y:300,size:28,font});
  const bytes=Buffer.from(await pdf.save());
  const f={id:'deck',role:'ppt',name:'Deck.pdf',stored:'Deck.pdf',sha256:contentHash(bytes),size:bytes.length,parsed:'deck/blocks.json',parseStatus:'ready',
   aiParse:{status:'interrupted',stage:'上次解析被中断，可继续',completed:1,total:22}};
  const p={id,name:'Continue week',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'idle',materialRevision:1,revision:1,bbText:'',sessions:[],files:[f],chat:[],
   preparation:{generation:'prep',materialRevision:1},tasks:{preparation:{status:'complete'}}};
  const reader={schema:'classroom.reader.v1',pages:[{sourceId:'deck',source:'Deck.pdf',sourceHash:f.sha256,pageIndex:0,paragraphs:[{english:'Slide',chinese:'幻灯片'}],closeReading:'旧导读。'}]};
  for(const [file,value] of Object.entries({'project.json':JSON.stringify(p),'Source/Deck.pdf':bytes,'Parsed/deck/blocks.json':JSON.stringify(contentListDocument([{type:'text',text:'Slide',page_idx:0}],f)),'Output/Preparation/PPT_Reader.json':JSON.stringify(reader)})){
   await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),value);
  }
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  ui=await launchRenderer(base,{});
  await openApp(ui,'/w/'+id+'/overview',{width:1280,height:800});
  const row="[...document.querySelectorAll('main .row')].find(r=>r.innerText.includes('Deck.pdf'))";
  await waitFor(ui,`(${row})?.innerText.includes('导读生成未完成 · 1/22')`,{label:'the unfinished run is shown'});
  assert.equal(await ui.evaluate(`[...(${row}).querySelectorAll('button')].some(b=>b.textContent.trim()==='继续生成导读'&&!b.disabled)`),true,'it can be continued');
  assert.doesNotMatch(await ui.evaluate(`(${row}).innerText`),/已完成导读/);
 }finally{
  await ui?.close();child?.kill();
  if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
