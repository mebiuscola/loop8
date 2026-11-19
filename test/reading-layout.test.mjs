import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {contentListDocument,contentHash} from '../lib/materials.mjs';
import {transcriptData,cleanScript} from '../lib/transcript.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pdf(){const streams=[1,2].map(i=>`BT /F1 30 Tf 40 320 Td (Slide ${i}: Reading and comparison) Tj ET`),objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];let out='%PDF-1.4\n',offsets=[0];for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+o+'\nendobj\n';}const pos=Buffer.byteLength(out);return Buffer.from(out+'xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+pos+'\n%%EOF');}
function wav(){const b=Buffer.alloc(44+16000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(16000,40);return b;}

test('compact reading layout gives documents viewport space, resizes actual separators, preserves player and survives narrow windows',async t=>{
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
  ui=await launchRenderer(base,{});await ui.screenshot(1600,1000);await ui.evaluate("setTimeout(()=>location.href='/',0);true");
  const wait=async expression=>{for(let i=0;i<180;i++){try{if(await ui.evaluate(expression))return;}catch{}await sleep(40);}throw Error('UI timeout: '+expression);};
  await wait("!!document.querySelector('#surface-reading')&&!document.querySelector('#workspace').hidden");
  await ui.evaluate("document.querySelector('#toggle-import').click();true");
  assert.equal(await ui.evaluate("document.querySelector('#material-import').hidden"),false);
  await ui.evaluate("document.querySelector('#toggle-import').click();true");
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE){
   await mkdir(process.env.CLASSROOM_LAYOUT_EVIDENCE,{recursive:true});
   await ui.evaluate("document.querySelector('#sidebar-toggle').click();true");
   await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Library.png'),await ui.screenshot(1440,920));
   await ui.evaluate("document.querySelector('#sidebar-toggle').click();true");
   await ui.screenshot(1600,1000);
  }
  await ui.evaluate("document.querySelector('#files .file-title').click();true");await wait("document.querySelectorAll('.page-row').length===2");
  const geometry=()=>ui.evaluate("(()=>{const r=document.querySelector('#reader-scroll').getBoundingClientRect(),t=document.querySelector('.reader-toolbar').getBoundingClientRect();return {top:r.top,height:r.height,bottom:r.bottom,viewport:innerHeight,toolbar:t.height,hidden:document.querySelector('#study-controls').hidden,process:document.querySelector('#process').closest('.reading-toolbar-right')!==null,overflow:document.documentElement.scrollWidth>innerWidth};})()");
  assert(!(await ui.evaluate("document.querySelector('#reader-scroll').textContent")).includes(reference.id));
  assert((await ui.evaluate("document.querySelector('#reader-scroll').textContent")).includes('Hogarth Introduction · 第 3 页'));
  const flat=await ui.evaluate("(()=>{const panes=[...document.querySelectorAll('.page-row:first-child .page-pane')];return {colors:panes.map(p=>getComputedStyle(p).backgroundColor),handle:getComputedStyle(document.querySelector('.page-divider'),'::after').content,shadow:getComputedStyle(document.querySelector('#material-tabs .selected')).boxShadow,padding:getComputedStyle(document.querySelector('.page-preview-host')).padding};})()");
  assert.equal(new Set(flat.colors).size,1,'all reading columns share one paper color');assert.equal(flat.handle,'none');assert.equal(flat.shadow,'none');assert.equal(flat.padding,'0px');
  let g=await geometry();assert(g.hidden&&g.process);assert(g.top<260,JSON.stringify(g));assert(g.height>700,JSON.stringify(g));assert(g.bottom<=g.viewport+1);assert(!g.overflow);assert.equal(await ui.evaluate("document.querySelector('.progress').hidden"),true,'completed progress has no permanent footprint');
  assert.equal(await ui.evaluate("document.querySelectorAll('.continuous-tools .column-divider').length"),0,'no separate resize buttons');
  assert(await ui.evaluate("(()=>{const bar=document.querySelector('.reader-toolbar').getBoundingClientRect(),nav=document.querySelector('.reader-nav').getBoundingClientRect();return Math.abs((bar.left+bar.right-nav.left-nav.right)/2)<1;})()"),'page navigation is centered independently of toolbar content');
  assert(await ui.evaluate("(()=>{const nav=document.querySelector('.reader-nav'),input=nav.querySelector('input'),slash=nav.querySelector('.page-slash'),total=nav.querySelector('#reader-total'),a=input.getBoundingClientRect(),b=slash.getBoundingClientRect(),c=total.getBoundingClientRect();return a.height===28&&b.height===28&&c.height===28&&Math.abs(a.y-b.y)<.5&&Math.abs(b.y-c.y)<.5&&Math.abs((b.x+b.width/2)-(a.x+a.width/2)-((c.x+c.width/2)-(b.x+b.width/2)))<.5&&getComputedStyle(input).lineHeight===getComputedStyle(total).lineHeight;})()"),'page fields and slash have matching vertical geometry and symmetric horizontal spacing');
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE){
   await ui.evaluate("(()=>{const box=document.createElement('div');box.id='pagination-evidence';Object.assign(box.style,{position:'fixed',inset:'0',zIndex:'9999',display:'flex',alignItems:'center',justifyContent:'center',gap:'32px',background:'#eeeee7'});for(const [page,total] of [[1,9],[7,33],[99,240]]){const nav=document.querySelector('.reader-nav').cloneNode(true);nav.querySelector('input').value=page;nav.querySelector('#reader-total').textContent=total;nav.querySelectorAll('button').forEach(b=>b.disabled=false);box.append(nav);}document.body.append(box);return true;})()");
   await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Pagination-samples.png'),await ui.screenshot(900,220));
   await ui.evaluate("document.querySelector('#pagination-evidence').remove();true");
   await ui.screenshot(1600,1000);
  }
  const before=await ui.evaluate("document.querySelector('.page-original').getBoundingClientRect().width");
  await ui.evaluate("(()=>{const h=document.querySelector('.page-divider');h.focus();for(let i=0;i<3;i++)h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return true;})()");
  const wider=await ui.evaluate("document.querySelector('.page-original').getBoundingClientRect().width");assert(wider>before+60,'actual separator keyboard operation changes all row tracks');
  await ui.evaluate("(()=>{const h=document.querySelector('.page-divider'),x=h.getBoundingClientRect().x;h.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:x,button:0,bubbles:true}));h.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:x-40,bubbles:true}));h.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:x-40,bubbles:true}));return true;})()");
  const dragged=await ui.evaluate("document.querySelector('.page-original').getBoundingClientRect().width");assert(dragged<wider-30,'pointer dragging works on the separator');
  const ratio=await ui.evaluate("localStorage.getItem('classroom-reader:Week_Layout')");assert(JSON.parse(ratio).widths.every(n=>n>0));
  await ui.evaluate("document.querySelector('#reader-hint').textContent='向下滚动连续阅读；点击页码可跳页。';true");await sleep(40);assert.equal(await ui.evaluate("document.querySelector('#reader-message').hidden&&!document.querySelector('.reading-notice-entry')"),true,'routine guidance adds no banner or pending badge');
  await ui.evaluate("document.querySelector('#reading-focus').click();true");await wait("getComputedStyle(document.querySelector('aside')).display==='none'");g=await geometry();assert(g.top<170,JSON.stringify(g));assert(g.height>800,JSON.stringify(g));
  await ui.evaluate("document.querySelector('#reading-focus').click();document.querySelector('#reader-next').click();true");await wait("document.querySelector('#reader-page').value==='2'");
  await ui.evaluate("window.beforeAuditReload=true;setTimeout(()=>location.reload(),0);true");
  await wait("!window.beforeAuditReload&&document.querySelector('#surface-reading')?.getAttribute('aria-current')==='page'&&document.querySelector('#reader-page')?.value==='2'");
  await wait("(()=>{const row=document.querySelector('.page-row[data-page=\"1\"]').getBoundingClientRect(),view=document.querySelector('#reader-scroll').getBoundingClientRect();return row.top<view.bottom&&row.bottom>view.top;})()");
  await ui.screenshot(1320,1000);
  await ui.evaluate("document.querySelector('#qa-launch').click();document.querySelector('#qa-layout').click();true");
  await wait("document.querySelector('#reader-grid').dataset.columns==='2'");
  assert(await ui.evaluate("document.querySelector('#reader-next').getBoundingClientRect().right<document.querySelector('.qa').getBoundingClientRect().left"));
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Reading-and-Ask.png'),await ui.screenshot(1320,1000));
  await ui.evaluate("document.querySelector('.reader-compact-tools [data-side=analysis]').click();true");
  assert.equal(await ui.evaluate("document.querySelector('#reader-grid').dataset.translation"),'false');
  await ui.evaluate("document.querySelector('.reader-compact-tools [data-layout]').click();true");
  assert.equal(await ui.evaluate("document.querySelector('#reader-grid').dataset.columns"),'3');
  await ui.screenshot(1050,1000);
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Toolbar-1050.png'),await ui.screenshot(1050,1000));
  await wait("document.querySelector('#qa-layout').disabled&&!document.body.classList.contains('qa-parallel')&&document.querySelector('#reader-grid').dataset.columns==='3'");
  await ui.evaluate("(()=>{const page=document.querySelector('#reader-page');page.value='1';page.dispatchEvent(new Event('change'));return true;})()");
  await wait("document.querySelector('#reader-page').value==='1'&&document.querySelector('#reader-scroll').scrollTop<5");
  assert(await ui.evaluate("(()=>{const next=document.querySelector('#reader-next'),r=next.getBoundingClientRect();return next.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),'floating Ask leaves the next-page button reachable at 1050px: '+JSON.stringify(await ui.evaluate("(()=>{const n=document.querySelector('#reader-next'),r=n.getBoundingClientRect();return {nav:r.toJSON(),blocker:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,240)};})()")));
  assert(await ui.evaluate("document.querySelector('#reader-scroll').getBoundingClientRect().right<=document.querySelector('.qa').getBoundingClientRect().left+1"),'Ask does not cover the reading panes at 1050px');
  assert(await ui.evaluate("Array.from(document.querySelectorAll('.page-row:first-child .page-label')).every(h=>Math.abs(h.getBoundingClientRect().top-document.querySelector('.page-row:first-child .page-label').getBoundingClientRect().top)<1)"),'all three reading headings start at the same height');
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE){
   await wait("!!document.querySelector('.cached-slide')?.naturalWidth");
   await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Narrow-reading.png'),await ui.screenshot(1050,1000));
  }
  await ui.evaluate("document.querySelector('#question').value='Question about the first slide';document.querySelector('#reader-next').click();true");
  await wait("document.querySelector('#reader-page').value==='2'&&!document.querySelector('.ask-move-draft').hidden");
  assert.equal(await ui.evaluate("document.querySelector('#question').value"),'Question about the first slide');
  assert.match(await ui.evaluate("document.querySelector('#ask-context').textContent"),/第 1 页/);
  await ui.evaluate("document.querySelector('.ask-move-draft').click();true");
  assert.match(await ui.evaluate("document.querySelector('#ask-context').textContent"),/第 2 页/);
  assert.equal(await ui.evaluate("document.querySelector('#question').value"),'Question about the first slide');
  await ui.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));true");
  assert.equal(await ui.evaluate("document.activeElement.id"),'qa-launch');
  await ui.evaluate("document.querySelector('#qa-launch').click();true");
  assert.equal(await ui.evaluate("document.activeElement.id"),'question');
  await ui.evaluate("document.querySelector('#qa-toggle').click();true");
  await ui.screenshot(1600,1000);
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE){await wait("!!document.querySelector('.cached-slide')?.naturalWidth");await sleep(300);await mkdir(process.env.CLASSROOM_LAYOUT_EVIDENCE,{recursive:true});await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'PPT-compact.png'),await ui.screenshot(1600,1000));}
  await ui.evaluate("document.querySelector('#surface-transcripts').click();true");await wait("!!document.querySelector('.lesson-player audio')");
  assert(await ui.evaluate("document.querySelector('#stage').textContent.includes('重建课堂')&&document.querySelector('#process').textContent==='重试本节讲稿'&&!document.querySelector('#process').disabled"));
  const bar=await ui.evaluate("(()=>{const b=document.querySelector('#study-controls').getBoundingClientRect(),s=document.querySelector('#session-select').getBoundingClientRect(),p=document.querySelector('#process').getBoundingClientRect();return {height:b.height,delta:Math.abs(s.top-p.top),width:document.documentElement.scrollWidth,viewport:innerWidth,tabs:document.querySelector('#document-tabs').hidden};})()");assert(bar.height<100,JSON.stringify(bar));assert(bar.delta<20);assert(bar.tabs);assert(bar.width<=bar.viewport);
  assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.lesson-player')).position"),'sticky');assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.lesson-player')).bottom"),'0px');assert.equal(await ui.evaluate("!!document.querySelector('.audio-speed')&&!!document.querySelector('.audio-follow')&&!!document.querySelector('.save-offset')"),true,'original player controls remain');
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Transcript-compact.png'),await ui.screenshot(1600,1000));
  await ui.screenshot(650,1000);await sleep(200);assert(await ui.evaluate("document.documentElement.scrollWidth<=innerWidth"),'transcript narrow layout has no horizontal overflow');await ui.evaluate("document.querySelector('#surface-reading').click();true");await wait("document.querySelectorAll('.page-row').length===2");assert(await ui.evaluate("document.documentElement.scrollWidth<=innerWidth"),'PPT narrow layout has no horizontal overflow');g=await geometry();assert(g.height>400,JSON.stringify(g));
  await ui.screenshot(1600,1000);
  await ui.evaluate("document.querySelector('#surface-transcripts').click();true");
  await wait("document.querySelector('.lesson-player audio')?.readyState>=1");
  await ui.evaluate("(()=>{const a=document.querySelector('.lesson-player audio'),s=document.querySelector('.audio-speed');a.currentTime=.45;s.value='1.5';s.dispatchEvent(new Event('change'));document.querySelector('#surface-reading').click();return true;})()");
  await wait("document.querySelectorAll('.page-row').length===2");
  await ui.evaluate("document.querySelector('#surface-transcripts').click();true");
  await wait("document.querySelector('.lesson-player audio')?.currentTime>.4");
  assert(await ui.evaluate("(()=>{const a=document.querySelector('.lesson-player audio');return a.paused&&a.playbackRate===1.5&&document.querySelector('.audio-speed').value==='1.5';})()"));
  assert.equal(JSON.parse(await ui.evaluate("localStorage.getItem('classroom-reader:Week_Layout')")).widths.length,3);
  await ui.evaluate("document.querySelector('#surface-reading').click();true");
  await wait("document.querySelectorAll('.page-row').length===2");
  await wait("!!document.querySelector('.cached-slide')?.naturalWidth");
  await ui.evaluate("document.querySelector('#reader-hint').dataset.error='true';document.querySelector('#reader-hint').textContent='PERSISTED_TEST_ISSUE';true");
  await wait("!document.querySelector('#reader-message').hidden");
  await ui.evaluate("document.querySelector('#reader-hint-close').click();true");
  assert(await ui.evaluate("document.querySelector('#reader-message').hidden&&!document.querySelector('#reader-more-content .reading-material-details').hidden&&!document.querySelector('.reading-notice-entry')"));
  const reloadOrigin=await ui.evaluate("setTimeout(()=>location.reload(),0);performance.timeOrigin");
  await wait("performance.timeOrigin!=="+reloadOrigin);
  await wait("!!document.querySelector('#workspace')&&!document.querySelector('#workspace').hidden");
  await ui.evaluate("document.querySelector('#surface-reading').click();true");
  await wait("!!document.querySelector('.cached-slide')?.naturalWidth");
  await ui.evaluate("document.querySelector('#reader-hint').dataset.error='true';document.querySelector('#reader-hint').textContent='PERSISTED_TEST_ISSUE';true");
  await sleep(50);
  assert(await ui.evaluate("document.querySelector('#reader-message').hidden"),'dismissed material warnings stay collapsed after reload');
  await ui.evaluate("document.querySelector('#reader-more').open=true;document.querySelector('.reading-material-details').open=true;true");
  assert(await ui.evaluate("document.querySelector('.reading-detail-list').textContent.includes('PERSISTED_TEST_ISSUE')&&document.querySelector('#reader-message').hidden"),'dismissed errors remain available on demand without reopening a banner');
  await ui.evaluate("document.querySelector('#reader-more').open=false;document.querySelector('#reader-hint').dataset.error='true';document.querySelector('#reader-hint').textContent='NEW_SOURCE_ISSUE';true");
  await wait("!document.querySelector('#reader-message').hidden&&document.querySelector('.reading-notice-list').textContent.includes('NEW_SOURCE_ISSUE')");
  await ui.evaluate("document.querySelector('#reader-hint-close').click();document.querySelector('#reader-page').value='1';document.querySelector('#reader-page').dispatchEvent(new Event('change'));true");
  await wait("document.querySelector('#reader-scroll').scrollTop<5");
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Reading-centered.png'),await ui.screenshot(1600,1000));
  await ui.evaluate("document.querySelector('#reader-more').open=true;true");
  assert(await ui.evaluate("(()=>{const button=document.querySelector('#process'),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"),'generation remains reachable from the reading menu');
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Reading-menu.png'),await ui.screenshot(1600,1000));
  await ui.evaluate("document.querySelector('#reader-more summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true");
  assert(await ui.evaluate("!document.querySelector('#reader-more').open&&document.activeElement===document.querySelector('#reader-more summary')"),'reading menu closes with Escape and restores focus');

  await ui.evaluate("document.querySelector('#material-reference').click();true");
  await wait("!document.querySelector('#reference-reader').hidden&&document.querySelector('#process').textContent.includes('文献翻译')");
  assert(await ui.evaluate("(()=>{const p=document.querySelector('#process'),bar=document.querySelector('.reference-toolbar'),nav=bar.querySelector('.reader-nav'),b=p.getBoundingClientRect(),n=nav.getBoundingClientRect();return p.closest('.reading-toolbar-right')&&Math.abs((b.top+b.bottom-n.top-n.bottom)/2)<2&&!document.querySelector('.reading-first-action');})()"),'initial reference translation shares the pagination toolbar without an action row');
  await wait("!!document.querySelector('.reference-page-preview canvas')");
  assert(await ui.evaluate("(()=>{const pane=document.querySelector('.reference-translation'),h=pane.querySelector('.reference-pane-heading'),p=pane.querySelector('.bilingual-paragraph');return Math.abs(h.getBoundingClientRect().left-p.getBoundingClientRect().left)<1;})()"),'reference title and body share the same text edge');
  if(process.env.CLASSROOM_LAYOUT_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Reference-toolbar.png'),await ui.screenshot(1600,1000));
  await ui.evaluate("document.querySelector('#reference-next').click();true");
  await wait("document.querySelector('#reference-page').value==='2'");
  await ui.evaluate("document.querySelector('#surface-overview').click();true");
  await wait("!document.querySelector('#course-overview').hidden");
  await ui.evaluate("document.querySelector('[data-file-id=ppt] .file-title').click();true");
  await wait("document.querySelector('#material-courseware').classList.contains('selected')&&document.querySelector('#reader-page').value==='1'");
  await ui.evaluate("document.querySelector('#material-reference').click();true");
  await wait("!document.querySelector('#reference-reader').hidden&&document.querySelector('#reference-page').value==='2'");
  await ui.evaluate("window.beforeReferenceReload=true;setTimeout(()=>location.reload(),0);true");
  await wait("!window.beforeReferenceReload&&document.querySelector('.reference-page-preview canvas')&&document.querySelector('#reference-page').value==='2'");

  await ui.evaluate("(async()=>{const {watchAcpWorkflow}=await import('/acp-workflow.js');window.quietNotices=[];window.quietJob={status:'running',stage:'读取中'};watchAcpWorkflow('quiet-test',{api:async()=>window.quietJob,post:async()=>({}),notice:text=>window.quietNotices.push(text)});return true;})()");
  await wait("!!document.querySelector('.acp-workflow')");
  assert(await ui.evaluate("document.querySelector('.acp-workflow>.acp-interaction').hidden"),'background task details start collapsed');
  await ui.evaluate("document.querySelector('.acp-workflow>header button').click();window.quietJob={status:'success',result:{message:'已完成'}};true");
  await wait("!document.querySelector('.acp-workflow')");assert.equal(await ui.evaluate("window.quietNotices.length"),0,'successful generation produces no task-ended notification');
  await ui.evaluate("(async()=>{const {watchAcpWorkflow}=await import('/acp-workflow.js');watchAcpWorkflow('error-test',{api:async()=>({status:'error',message:'识别失败，请重试'}),post:async()=>({}),notice:text=>window.quietNotices.push(text)});return true;})()");
  await wait("window.quietNotices.length===1");assert.match(await ui.evaluate("window.quietNotices[0]"),/识别失败/);

  if(process.env.CLASSROOM_LAYOUT_EVIDENCE){
   await ui.screenshot(430,900);
   await ui.evaluate("document.querySelector('#surface-overview').click();true");
   await wait("!document.querySelector('#course-overview').hidden");
   await writeFile(path.join(process.env.CLASSROOM_LAYOUT_EVIDENCE,'Mobile-library.png'),await ui.screenshot(430,900));
  }
 }finally{await ui?.close();if(child){child.kill();await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});
