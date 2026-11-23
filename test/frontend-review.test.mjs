import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {contentListDocument,contentHash} from '../lib/materials.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,reload,waitFor,waitText,click,go} from './helpers/app.mjs';

const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
async function pdf(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 doc.addPage([595,842]).drawText('Translation is never a neutral transfer of meaning.',{x:60,y:760,size:11,font});
 return Buffer.from(await doc.save());
}

// Problems found when reviewing the new frontend (docs/UI-ISSUES.md, 2026-11-22).
test('frontend review fixes: course switching, polling, sidebar, stale scripts, reading tab, printed page, dismissing failed tasks',async t=>{
 try{await browserExecutable();}catch{t.skip('Browser unavailable');return;}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-review-fixes-'));let ui,child;
 try{
  // Week A: a reference only (no courseware), a class whose script is outdated, and a failed translation.
  const id='Week_A',folder=path.join(dir,'classes',id),bytes=await pdf();
  const ref={id:'ref',role:'reading',name:'Reading.pdf',stored:'Reading.pdf',sha256:contentHash(bytes),size:bytes.length,parsed:'ref/blocks.json',parseStatus:'ready',parseSource:'text-layer'};
  const session={id:'lecture',type:'Lecture',title:'Lecture One',revision:2,outputRevision:1,srtId:'srt',generation:'script',materialRevision:1,artifactStatus:{script:'complete',deepDive:'not_generated'}};
  const srt={id:'srt',role:'srt',name:'Lecture.srt',stored:'Lecture.srt',sessionId:'lecture',size:10,parseStatus:'ready'};
  const p={id,name:'Week A',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'idle',materialRevision:1,revision:1,bbText:'',sessions:[session],files:[ref,srt],chat:[],
   tasks:{'reference:ref':{status:'error',error:'模型未正常结束（content_filter）',started:'2026-11-20T10:00:00.000Z',finished:'2026-11-20T10:05:00.000Z'}}};
  const doc=contentListDocument([{type:'text',text:'Translation is never a neutral transfer of meaning.',page_idx:0},{type:'page_number',text:'101',page_idx:0}],ref);
  for(const [file,value] of Object.entries({'project.json':JSON.stringify(p),'Source/Reading.pdf':bytes,'Source/Lecture.srt':'1\n00:00:00,000 --> 00:00:01,000\nHello.','Parsed/ref/blocks.json':JSON.stringify(doc)})){
   await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),value);
  }
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const b=await (await fetch(base+'/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Week B'})})).json();
  const hashA='#/w/'+encodeURIComponent(id),hashB='#/w/'+encodeURIComponent(b.id);
  ui=await launchRenderer(base,{});
  const h1="document.querySelector('main h1')?.textContent";

  // An outdated script is shown as "讲稿待更新" in the stale colour, without a tick.
  await openApp(ui,'/w/'+id+'/overview',{width:1280,height:800});
  await waitText(ui,'Lecture One','main');
  const chip=await ui.evaluate("[...document.querySelectorAll('main .chips li')].map(l=>[l.textContent.trim(),l.className.includes('stale')])");
  assert.deepEqual(chip.find(c=>c[0].startsWith('讲稿')),['讲稿待更新',true],JSON.stringify(chip));
  await go(ui,hashA.slice(1)+'/class');
  await waitFor(ui,"[...document.querySelectorAll('main li.stale')].some(l=>l.textContent.trim()==='讲稿待更新')",{label:'class toolbar shows the script as outdated'});

  // "阅读" opens the references when the week has no courseware, with the printed page next to the PDF page.
  await go(ui,hashA.slice(1)+'/read');
  await waitFor(ui,"document.querySelector('[role=tab][aria-selected=true]')?.textContent==='参考文献'",{label:'reference tab selected'});
  await waitFor(ui,"document.querySelector('.pager .printed')?.textContent==='印刷页 101'",{label:'printed page in the toolbar'});

  // A failed task can be acknowledged: it leaves the task list and the course dot, and stays gone after a reload.
  const dot="document.querySelector('nav.sidebar a[title=\"Week A\"] .dot')?.className||''";
  await waitFor(ui,`(${dot}).includes('attention')`,{label:'Week A asks for attention'});
  await click(ui,/1 个任务待处理/);
  await waitText(ui,'模型未正常结束','[role=dialog]');
  await click(ui,'知道了');
  await waitText(ui,'没有正在运行或需要处理的任务。','[role=dialog]');
  await waitFor(ui,`!(${dot}).includes('attention')`,{label:'dot cleared'});
  await reload(ui);
  await waitFor(ui,`(${dot}).includes('ready')`,{label:'dismissal remembered'});
  assert.equal(await ui.evaluate("document.querySelector('.topbar .warn')"),null);
  await go(ui,hashA.slice(1)+'/overview');
  await waitFor(ui,`${h1}==='Week A'`);

  // A slow answer for the course just left never replaces the course now shown.
  await ui.evaluate(`window.__fetch=window.fetch;window.fetch=async(u,o)=>{if(String(u).includes('/api/projects/Week_A'))await new Promise(r=>setTimeout(r,1500));return __fetch(u,o);};true`);
  await go(ui,hashA.slice(1)+'/overview');await sleep(50);await go(ui,hashB.slice(1)+'/overview');
  await sleep(100);await go(ui,hashA.slice(1)+'/class');await sleep(100);await go(ui,hashB.slice(1)+'/overview');
  await waitFor(ui,`${h1}==='Week B'`,{label:'Week B shown'});
  await sleep(2500);
  assert.equal(await ui.evaluate(h1),'Week B','the late Week A answer is dropped');

  // Rapid switching while requests overlap still leaves a single polling loop.
  await ui.evaluate(`window.fetch=async(u,o)=>{if(/\\/api\\/projects$/.test(String(u)))await new Promise(r=>setTimeout(r,400));return __fetch(u,o);};true`);
  for(let i=0;i<6;i++){await go(ui,(i%2?hashA:hashB).slice(1)+'/overview');await sleep(60);}
  await sleep(1500);
  await ui.evaluate(`window.__lists=0;const slow=window.fetch;window.fetch=(u,o)=>{if(/\\/api\\/projects$/.test(String(u)))__lists++;return slow(u,o);};true`);
  await sleep(16000);
  const lists=await ui.evaluate('__lists');
  assert(lists<=2,'one polling loop (15 s apart), got '+lists+' list requests in 16 s');
  await ui.evaluate('window.fetch=__fetch;true');

  // Interface tidying: status words are not repeated inside the material and class lists, a week
  // with nothing to analyse offers no whole-week Deep Dive, and a narrow work area keeps the class
  // toolbar on one line.
  await go(ui,hashB.slice(1)+'/overview');
  await waitFor(ui,"document.querySelector('main')?.innerText.includes('先添加课件、参考文献或课堂')",{label:'empty week explains what the whole-week Deep Dive needs'});
  assert.equal(await ui.evaluate("!!document.querySelector('main a[href$=\"/deepdive/week\"]')"),false);
  await go(ui,hashA.slice(1)+'/class');
  await waitFor(ui,"document.querySelector('select[aria-label=选择课堂] option')?.textContent==='Lecture · Lecture One'",{label:'class list without status words'});
  await go(ui,hashA.slice(1)+'/read/ref');
  await waitFor(ui,"document.querySelector('select[aria-label=选择材料] option')?.textContent==='Reading.pdf'",{label:'material list without status words'});
  await go(ui,hashA.slice(1)+'/class');
  await ui.screenshot(1000,700);
  await waitFor(ui,"getComputedStyle(document.querySelector('ul.have')).display==='none'",{label:'marks left out in a narrow work area'});
  await ui.screenshot(1600,900);
  await waitFor(ui,"getComputedStyle(document.querySelector('ul.have')).display==='flex'",{label:'marks shown in a wide work area'});

  // A narrow window collapses the course list; a wide one brings back the user's choice.
  await ui.screenshot(700,800);
  await waitFor(ui,"document.querySelector('.frame').classList.contains('sidebar-collapsed')",{label:'collapsed when narrow'});
  await ui.screenshot(1280,800);
  await waitFor(ui,"!document.querySelector('.frame').classList.contains('sidebar-collapsed')",{label:'expanded again when wide'});
  await reload(ui);
  assert.equal(await ui.evaluate("document.querySelector('.frame').classList.contains('sidebar-collapsed')"),false);
 }finally{
  await ui?.close();child?.kill();
  if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
