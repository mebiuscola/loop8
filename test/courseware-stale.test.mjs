import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {contentHash,contentListDocument} from '../lib/materials.mjs';
import {LEARNING_SCHEMA} from '../lib/ppt-learning.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,waitFor} from './helpers/app.mjs';

const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
async function deck(label){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 doc.addPage([720,405]).drawText(label,{x:40,y:300,size:28,font});
 return Buffer.from(await doc.save());
}

// A courseware file shown from its own page-by-page guide used to be called "原件已变更 · 建议更新"
// right after it was updated: finishing the update raises the week's material revision, and the
// check compared that with the older whole-week guide, so updating again could never clear it.
test('an updated courseware guide is not called outdated; only a changed original is "原件已变更"',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-stale-')),id='Week_S',folder=path.join(dir,'classes',id);let child,ui;
 try{
  const fresh=await deck('Fresh slide'),old=await deck('Old slide');
  const a={id:'fresh',role:'ppt',name:'Fresh.pdf',stored:'Fresh.pdf',sha256:contentHash(fresh),size:fresh.length,parsed:'fresh/blocks.json',parseStatus:'ready',externalAnalysis:'fresh/ai_analysis.json',aiParse:{status:'done',completed:1,total:1}};
  const b={id:'old',role:'ppt',name:'Old.pdf',stored:'Old.pdf',sha256:contentHash(old),size:old.length,parsed:'old/blocks.json',parseStatus:'ready'};
  // The whole-week guide was made at material revision 1; finishing Fresh.pdf's own guide raised it to 3.
  const p={id,name:'Stale week',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'idle',materialRevision:3,revision:3,bbText:'',sessions:[],files:[a,b],chat:[],
   preparation:{generation:'prep',materialRevision:1},tasks:{preparation:{status:'complete'}}};
  const report={schema:'classroom.ppt-recovery.v1',learningSchema:LEARNING_SCHEMA,source:{sha256:a.sha256,fileName:a.name,pageCount:1},
   pages:[{page:1,title:'Fresh slide',hidden:false,blank:false,originalText:[{text:'Fresh slide',method:'native'}],visualObservations:[],analysis:[],uncertainties:[],inspection:{status:'complete',fullPageViewed:true,textExtracted:true},
    learning:{pageType:'cover',paragraphs:[{originalIndex:0,chinese:'新的一页'}],closeReading:'本页是封面。'}}]};
  const reader={schema:'classroom.reader.v1',pages:[{sourceId:'old',source:'Old.pdf',sourceHash:b.sha256,pageIndex:0,paragraphs:[{english:'Old slide',chinese:'旧的一页'}],closeReading:'旧导读。'}]};
  for(const [file,value] of Object.entries({'project.json':JSON.stringify(p),'Source/Fresh.pdf':fresh,'Source/Old.pdf':old,
   'Parsed/fresh/blocks.json':JSON.stringify(contentListDocument([{type:'text',text:'Fresh slide',page_idx:0}],a)),'Parsed/old/blocks.json':JSON.stringify(contentListDocument([{type:'text',text:'Old slide',page_idx:0}],b)),
   'Parsed/fresh/ai_analysis.json':JSON.stringify(report),'Output/Preparation/PPT_Reader.json':JSON.stringify(reader)})){
   await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),value);
  }
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const get=async source=>(await fetch(`${base}/api/projects/${id}/reader?source=${source}`)).json();

  const updated=await get('fresh');
  assert.equal(updated.generated,true);assert.equal(updated.pages[0].paragraphs[0].chinese,'新的一页','shown from its own guide');
  assert.equal(updated.stale,false,'not outdated right after its update');assert.equal(updated.sourceChanged,false);
  const older=await get('old');
  assert.equal(older.stale,true,'the whole-week guide predates newer material');assert.equal(older.sourceChanged,false,'but its original did not change');

  try{await browserExecutable();}catch{t.diagnostic('browser unavailable; wording not checked');return;}
  ui=await launchRenderer(base,{});
  await openApp(ui,'/w/'+id+'/overview',{width:1280,height:800});
  const row=name=>`[...document.querySelectorAll('main .row')].find(r=>r.innerText.includes(${JSON.stringify(name)}))?.innerText||''`;
  await waitFor(ui,`(${row('Old.pdf')}).includes('材料有变化 · 建议更新')`,{label:'other material changed'});
  await waitFor(ui,`(${row('Fresh.pdf')}).includes('已完成导读')`,{label:'the updated file is done'});
  assert.doesNotMatch(await ui.evaluate(`document.querySelector('main').innerText`),/原件已变更/);
 }finally{
  await ui?.close();child?.kill();
  if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
