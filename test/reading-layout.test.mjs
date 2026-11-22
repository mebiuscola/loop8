import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {contentListDocument,contentHash} from '../lib/materials.mjs';
import {transcriptData,cleanScript} from '../lib/transcript.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,openAsk,go,reload,waitFor,waitText,click,fill,has,text} from './helpers/app.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pdf(){const streams=[1,2].map(i=>`BT /F1 30 Tf 40 320 Td (Slide ${i}: Reading and comparison) Tj ET`),objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];let out='%PDF-1.4\n',offsets=[0];for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+o+'\nendobj\n';}const pos=Buffer.byteLength(out);return Buffer.from(out+'xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+pos+'\n%%EOF');}
function wav(){const b=Buffer.alloc(44+16000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(16000,40);return b;}

test('reading layout fills the window, keeps pages and playback across workspaces and reloads, leaves room for Ask and survives narrow windows',async t=>{
 try{await browserExecutable();}catch{t.skip('Browser unavailable');return;}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-layout-')),id='Week_Layout',folder=path.join(dir,'classes',id);let ui,child;
 try{
  const bytes=pdf(),srt=Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nReading involves comparison.'),s={id:'lecture',type:'Lecture',title:'Lecture One',revision:1,outputRevision:1,srtId:'srt',generation:'script',materialRevision:1,artifactStatus:{script:'complete',deepDive:'not_generated'},audio:{fileId:'audio',srtId:'srt',srtHash:contentHash(srt),offsetMs:0}};
  const f={id:'ppt',role:'ppt',name:'Slides.pdf',stored:'Slides.pdf',sha256:contentHash(bytes),parsed:'ppt/blocks.json',parseStatus:'ready',size:bytes.length},subtitle={id:'srt',role:'srt',name:'Lecture.srt',stored:'Lecture.srt',sessionId:s.id,size:srt.length,parseStatus:'ready'},audio={id:'audio',role:'audio',name:'Lecture.wav',stored:'Lecture.wav',sessionId:s.id,size:wav().length,parseStatus:'ready'};
  const reference={...f,id:'820d8d0a-01e6-4469-94ac-6728b88b7b60',role:'reading',name:'Hogarth Introduction_25_10_17_11_45_49.pdf',stored:'Reference.pdf',parsed:'reference/blocks.json'};
  const p={id,name:'Reading workspace',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'done',stage:'本节讲稿已完成',materialRevision:1,revision:1,bbText:'Comparison',sessions:[s],files:[f,subtitle,audio,reference],chat:[],preparation:{generation:'prep',materialRevision:1},tasks:{preparation:{status:'complete'},'script:lecture':{status:'error',stage:'重建课堂',error:'模拟覆盖失败'}},job:{mode:'session',sessionId:s.id}};
  const timeline=transcriptData(s,subtitle,srt,[{chapter:'Reading and comparison',speaker:'Lecturer',cueIds:[1],english:'Reading involves comparison. '.repeat(18),chinese:'阅读与比较相互联系。'.repeat(20)}]);
  const pages=[0,1].map(i=>({sourceId:f.id,source:f.name,sourceHash:f.sha256,pageIndex:i,paragraphs:[{english:`Slide ${i+1}: Reading and comparison`,chinese:`第 ${i+1} 页：阅读与比较`}],closeReading:'[Source 820d8d0a-01e6-4469-94ac-6728b88b7b60:b17 | Reading page 3]\n\n'+'## 本页问题\n\n从原文出发，讨论阅读和比较的关系。'.repeat(8)}));
  const files={'project.json':JSON.stringify(p),'Source/Reference.pdf':bytes,'Parsed/reference/blocks.json':JSON.stringify(contentListDocument([{type:'text',text:'Reading paragraph',page_idx:0}],reference)),'Source/Slides.pdf':bytes,'Source/Lecture.srt':srt,'Source/Lecture.wav':wav(),'Parsed/ppt/blocks.json':JSON.stringify(contentListDocument(pages.map(p=>({type:'text',text:p.paragraphs[0].english,page_idx:p.pageIndex})),f)),'Output/Preparation/PPT_Reader.json':JSON.stringify({schema:'classroom.reader.v1',pages}),'Output/Preparation/PPT_Bilingual_Guide.md':'# PPT guide','Output/Sessions/lecture/Transcript_Reader.json':JSON.stringify(timeline),'Output/Sessions/lecture/Class_Script_Bilingual.md':cleanScript(p.name,s,timeline)};
  for(const [file,value] of Object.entries(files)){await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),value);}
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);for(let i=0;i<100&&!log.includes('http://');i++)await sleep(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  ui=await launchRenderer(base,{});const course='/w/'+id,evidence=process.env.CLASSROOM_LAYOUT_EVIDENCE;
  if(evidence)await mkdir(evidence,{recursive:true});
  const shot=async(name,width=1600,height=1000)=>{if(evidence){await writeFile(path.join(evidence,name),await ui.screenshot(width,height));await ui.screenshot(width,height);}};
  const pageBox="document.querySelector('input[aria-label=页码]')?.value";
  const noOverflow="document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight";

  // Courseware: the reading area takes the window below one toolbar; the page itself never scrolls.
  await openApp(ui,course+'/read/ppt/ppt/p/1',{width:1600,height:1000});
  await waitFor(ui,"document.querySelectorAll('main section[data-page]').length===2",{label:'two courseware pages'});
  await waitFor(ui,"[...document.querySelectorAll('main section[data-page] img')].some(i=>i.complete&&i.naturalWidth>0)",{timeout:20000,label:'original page image'});
  const g=await ui.evaluate("(()=>{const s=document.querySelector('main section[data-page]').parentElement.getBoundingClientRect();return {top:s.top,bottom:s.bottom,height:s.height,viewport:innerHeight};})()");
  assert(g.top<200&&g.height>700&&g.bottom<=g.viewport+1,'reading area fills the window: '+JSON.stringify(g));
  assert(await ui.evaluate(noOverflow),'no page scrolling at 1600px');
  const notes=await text(ui,'main');
  assert(notes.includes('Hogarth Introduction · 第 3 页'),'reference citations in the close reading are shown by name and page');
  assert(!notes.includes(reference.id),'internal source ids are not shown');
  await shot('Reading.png');
  // Columns can be hidden and shown again.
  await fill(ui,'译文','');await waitFor(ui,"!document.querySelector('main').innerText.includes('第 1 页：阅读与比较')",{label:'translation hidden'});
  await fill(ui,'译文',true);await waitText(ui,'第 1 页：阅读与比较','main');
  // The page chosen is kept across a reload.
  await click(ui,'','button[title=下一页]');await waitFor(ui,pageBox+"==='2'");
  await reload(ui);
  await waitFor(ui,pageBox+"==='2'",{label:'page kept after reload'});
  await waitFor(ui,"(()=>{const r=document.querySelector('main section[data-page=\"2\"]')?.getBoundingClientRect(),v=document.querySelector('main section[data-page]').parentElement.getBoundingClientRect();return !!r&&r.top<v.bottom&&r.bottom>v.top;})()",{label:'page 2 in view after reload'});

  // Ask beside the reader at 1050px: it never covers the pages, and the draft stays while the page changes.
  await ui.screenshot(1050,1000);
  await openAsk(ui);
  await waitText(ui,'Slides.pdf · 第 2 页','.ask');
  assert(await ui.evaluate("document.querySelector('main').getBoundingClientRect().right<=document.querySelector('.ask').getBoundingClientRect().left+1"),'Ask does not cover the reading area at 1050px');
  assert(await ui.evaluate("(()=>{const b=document.querySelector('button[title=上一页]'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),'page buttons stay reachable with Ask open');
  assert(await ui.evaluate("document.documentElement.scrollWidth<=innerWidth"),'no horizontal overflow at 1050px with Ask open');
  await fill(ui,'问题','Question about the slides');
  await click(ui,'','button[title=上一页]');await waitFor(ui,pageBox+"==='1'");
  await waitText(ui,'Slides.pdf · 第 1 页','.ask');
  assert.equal(await ui.evaluate("document.querySelector('.ask textarea').value"),'Question about the slides');
  await shot('Reading-and-Ask.png',1050,1000);
  await ui.evaluate("document.querySelector('.ask textarea').value='';document.querySelector('.ask textarea').dispatchEvent(new Event('input'));true");
  await click(ui,'提问','.topbar button');await waitFor(ui,"!document.querySelector('.ask')");

  // Class: the failed script keeps the previous transcript readable, and the player keeps its place.
  await ui.screenshot(1600,1000);
  await click(ui,'课堂','.topbar nav a');
  await waitText(ui,'Reading involves comparison.','main');
  assert(await has(ui,'main button','重新生成讲稿'),'a failed script offers to generate it again: '+await ui.evaluate("[...document.querySelectorAll('main button')].map(b=>b.textContent.trim()).join('|')+' / '+document.querySelector('main').innerText.slice(0,300)"));
  await waitFor(ui,"document.querySelector('main audio')?.readyState>=1",{timeout:20000,label:'recording loaded'});
  await shot('Transcript.png');
  await ui.evaluate("(()=>{const a=document.querySelector('main audio');a.currentTime=.45;const s=document.querySelector('select[aria-label=播放速度]');s.value=s.options[[...s.options].findIndex(o=>o.textContent.startsWith('1.5'))].value;s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await waitFor(ui,"document.querySelector('main audio').playbackRate===1.5");
  await click(ui,'阅读','.topbar nav a');await waitFor(ui,"document.querySelectorAll('main section[data-page]').length===2");
  await click(ui,'课堂','.topbar nav a');
  await waitFor(ui,"(()=>{const a=document.querySelector('main audio');return a&&a.readyState>=1&&a.currentTime>.4&&a.paused&&a.playbackRate===1.5;})()",{timeout:20000,label:'playback position and speed kept'});
  // Narrow window: the course list folds away and nothing overflows sideways.
  await ui.screenshot(650,1000);
  await waitFor(ui,"document.querySelector('.frame').classList.contains('sidebar-collapsed')",{label:'course list collapses'});
  await sleep(200);
  assert(await ui.evaluate("document.documentElement.scrollWidth<=innerWidth"),'class page has no horizontal overflow at 650px');
  await shot('Transcript-narrow.png',650,1000);

  // Reference: its page is kept when visiting another workspace and after a reload.
  await ui.screenshot(1600,1000);
  await go(ui,'#'+course+'/read/ref/'+reference.id+'/p/1');
  await waitFor(ui,"[...document.querySelectorAll('main section[data-page] canvas')].some(c=>!!c.style.width)",{timeout:20000,label:'reference PDF page drawn'});
  await click(ui,'','button[title=下一页]');await waitFor(ui,pageBox+"==='2'");
  await click(ui,'概览','.topbar nav a');await waitText(ui,'Slides.pdf','main');
  await click(ui,'阅读','.topbar nav a');
  await waitFor(ui,pageBox+"==='2'&&location.hash.includes('/read/ref/')",{label:'reference page kept across workspaces'});
  await reload(ui);
  await waitFor(ui,pageBox+"==='2'&&location.hash.includes('/read/ref/')",{label:'reference page kept after reload'});
  await shot('Reference.png');

  // Phone width: the overview fits.
  await ui.screenshot(430,900);
  await click(ui,'概览','.topbar nav a');await waitText(ui,'Slides.pdf','main');await sleep(200);
  assert(await ui.evaluate("document.documentElement.scrollWidth<=innerWidth"),'overview has no horizontal overflow at 430px: '+await ui.evaluate("document.documentElement.scrollWidth+' '+[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>e.tagName+'.'+[...e.classList].join('.')+'['+Math.round(e.getBoundingClientRect().left)+','+Math.round(e.getBoundingClientRect().right)+']').join(' ')"));
  await shot('Mobile-overview.png',430,900);
 }finally{await ui?.close();if(child){child.kill();await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});
