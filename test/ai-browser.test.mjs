import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testPdf} from '../lib/diagnostics.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,go,waitFor,waitText,click} from './helpers/app.mjs';
import {listenSafe} from '../lib/ports.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real isolated browser renders PPTX and PDF, sends page images, imports valid JSON, keeps originals and hides parsing credentials',async t=>{
 try{await browserExecutable();}catch{return t.skip('Requires locally installed Edge / Chrome');}
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-ai-browser-'));if(process.env.CLASSROOM_UI_EVIDENCE)await mkdir(process.env.CLASSROOM_UI_EVIDENCE,{recursive:true});let calls=0,images=0,mapCalls=0;const requests=[];
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const data=JSON.parse(raw),content=data.messages[1].content;
  if(data.messages[0].content.includes('PPT course map')){mapCalls++;const input=JSON.parse(content);res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({overview:'完整课件结构',pages:input.pages.map(p=>({page:p.page,title:'Page '+p.page,section:'Layout',purpose:'解释文本结构'})),terms:[{english:'layout',chinese:'版式'}]})}}]}));}
  if(typeof content==='string'&&JSON.parse(content).task==='ppt_deck_review'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({terms:[],changes:[]})}}]}));}
  const visionTest=data.messages[0].content.includes('Read the attached chart only');
  assert(Array.isArray(content));const text=content.find(c=>c.type==='text').text;if(!visionTest)assert.equal(data.response_format.type,'json_object');const pic=content.find(c=>c.type==='image_url').image_url.url;assert(pic.length>1000);images++;calls++;
  let result;if(visionTest)result={books:7,notes:4};
  else {const input=JSON.parse(text);requests.push({source:input.source,page:input.page,model:data.model,key:req.headers.authorization});if(input.source==='needs-backup.pdf'&&data.model!=='mock-fallback'||input.source==='partial.pdf'&&input.page===2){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{finish_reason:'recitation',message:{content:''}}]}));}result=data.messages[0].content.includes('PPT integrated learning')?{title:'Rendered page '+input.page,blank:false,originalText:[{text:input.nativeText||'Visual page content',method:input.nativeText?'native':'visual_ocr',role:'body'}],visualObservations:[],analysis:[],uncertainties:[],inspection:{textExtracted:true,fullPageViewed:true,status:'complete'},learning:{schema:'classroom.ppt-learning.v1',pageType:'concept',paragraphs:[{originalIndex:0,chinese:'完整正文翻译'}],closeReading:'这页具体解释文字排版，不重复翻译。'}}:{printedPage:null,status:'complete',blocks:[{kind:'body',text:input.nativeText||'Classroom connection test'}],uncertainties:[]};}
  await sleep(80);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
 });await listenSafe(mock);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await sleep(50);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  async function api(route,value){const r=await fetch(base+route,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});const data=await r.json();assert(r.ok,JSON.stringify(data));return data;}
  await api('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'general-secret',model:'mock-general',parseApiKey:'vision-secret',parseModel:'mock-vision'});assert(!(JSON.stringify(await api('/api/settings'))).includes('vision-secret'));
  const check=await api('/api/settings/test',{kind:'vision'});for(let i=0;i<100;i++){const j=await api('/api/settings/test/'+check.id);if(j.status!=='running'){assert.equal(j.status,'success',j.message);break;}await sleep(50);}
  let p=await api('/api/projects',{name:'AI browser test'});const ppt=await readFile(new URL('fixtures/text-layout.pptx',import.meta.url));
  for(const [role,name,bytes] of [['ppt','test.pptx',ppt],['reading','scan.pdf',testPdf()]]){const r=await fetch(`${base}/api/projects/${p.id}/upload`,{method:'POST',headers:{'x-file-role':role,'x-file-name':name},body:bytes});assert.equal(r.status,201);p=await r.json();}
  const url='/api/projects/'+p.id;await Promise.all(p.files.map(f=>api(url+'/ai-parse',{sourceId:f.id})));
  for(let i=0;i<240;i++){p=await api(url);if(p.files.every(f=>['done','error'].includes(f.aiParse?.status)))break;await sleep(250);}
  for(const f of p.files){assert.equal(f.aiParse?.status,'done',f.aiParse?.error||log);assert.equal(f.parseStatus,'ready');const report=await api(url+'/analysis?source='+f.id);assert.equal(report.pages.length,f.role==='ppt'?6:1);assert(report.pages.every((v,i)=>v.page===i+1));}
  assert.equal(calls,8);assert.equal(images,8);assert.equal(mapCalls,1);const reader=await api(url+'/reader?source='+p.files[0].id);assert.equal(reader.pages.length,6);assert.equal(reader.learningStale,false);assert(reader.pages.every(page=>page.renderKey===reader.renderKey));
  const reportFile=path.join(temp,'classes',p.id,'Parsed',p.files[0].id,'ai_analysis.json'),savedReport=await readFile(reportFile,'utf8'),oldReport=JSON.parse(savedReport);oldReport.parser.renderKey='previous-image';for(const page of oldReport.pages)page.quality.renderKey='previous-image';await writeFile(reportFile,JSON.stringify(oldReport));
  assert.equal((await api(url+'/reader?source='+p.files[0].id)).learningStale,true,'old image interpretation must be visibly stale');const staleImage=await fetch(base+url+'/page-image?source='+p.files[0].id+'&page=1');assert.equal(staleImage.headers.get('X-Learning-Stale'),'1');assert.equal(calls,8,'preview freshness checks must never trigger AI');await staleImage.arrayBuffer();await writeFile(reportFile,savedReport);
  const original=await fetch(base+url+'/source?id='+p.files[0].id);assert.deepEqual(Buffer.from(await original.arrayBuffer()),ppt);
  await api('/api/settings',{fallbackEnabled:true,fallbackModel:'mock-fallback',fallbackApiKey:'fallback-secret'});assert(!JSON.stringify(await api('/api/settings')).includes('fallback-secret'));
  const fallbackCheck=await api('/api/settings/test',{kind:'fallback-vision'});for(let i=0;i<100;i++){const j=await api('/api/settings/test/'+fallbackCheck.id);if(j.status!=='running'){assert.equal(j.status,'success',j.message);break;}await sleep(50);}
  async function extra(name,bytes){const r=await fetch(base+url+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':name},body:bytes});assert.equal(r.status,201);const p=await r.json();return p.files.find(f=>f.name===name);}
  async function waitFile(id){for(let i=0;i<200;i++){const p=await api(url),f=p.files.find(f=>f.id===id);if(f.aiParse&&f.aiParse.status!=='running')return f;await sleep(50);}throw Error('file timeout');}
  const needs=await extra('needs-backup.pdf',Buffer.concat([testPdf(),Buffer.from('\n% backup fixture')]));await api(url+'/ai-parse',{sourceId:needs.id});assert.equal((await waitFile(needs.id)).aiParse.status,'done');const three=requests.filter(r=>r.source==='needs-backup.pdf');assert.deepEqual(three.map(r=>r.model),['mock-vision','mock-vision','mock-fallback']);assert.equal(three[2].key,'Bearer fallback-secret');
  const report=await api(url+'/analysis?source='+needs.id);assert.equal(report.parser.pageProvenance[0].model,'mock-fallback');
  const {PDFDocument}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs'),two=await PDFDocument.create(),one=await PDFDocument.load(testPdf());for(let i=0;i<2;i++)two.addPage((await two.copyPages(one,[0]))[0]);
  const partial=await extra('partial.pdf',await two.save());await api(url+'/ai-parse',{sourceId:partial.id});assert.equal((await waitFile(partial.id)).aiParse.status,'partial');const part=await api(url+'/ai-partial?source='+partial.id);assert.equal(part.completed,1);assert.deepEqual(part.missing,[2]);
  const before=calls;await api(url+'/ai-parse',{sourceId:partial.id});await waitFile(partial.id);assert.equal(calls,before,'continue does not reset exhausted submissions');
  const ui=await launchRenderer(base,{});
  try{
   const course='/w/'+encodeURIComponent(p.id);
   await openApp(ui,course+'/overview',{width:1540,height:1100});
   for(const name of ['test.pptx','scan.pdf','needs-backup.pdf','partial.pdf'])await waitText(ui,name,'main');
   const imagePath=path.join(temp,'classes',p.id,'.Cache','Pages',p.files[0].id,'page-1.png'),imageBefore=await readFile(imagePath),seedPath=imagePath.replace('.png','.json'),seedBefore=await readFile(seedPath,'utf8');
   const beforeOpen=calls;
   await go(ui,'#'+course+'/read/'+encodeURIComponent(p.files[0].id));
   await waitFor(ui,"[...document.querySelectorAll('main img')].some(i=>i.complete&&i.naturalWidth>0)",{timeout:20000,label:'cached page image'});
   assert.equal(await ui.evaluate("document.querySelectorAll('main iframe').length"),0,'the default reader never starts per-slide render frames');
   await waitText(ui,'完整正文翻译','main');
   await go(ui,'#'+course+'/overview');await waitText(ui,'partial.pdf','main');
   await go(ui,'#'+course+'/read/'+encodeURIComponent(p.files[0].id));await waitText(ui,'完整正文翻译','main');await sleep(400);
   assert.deepEqual(await readFile(imagePath),imageBefore);assert.equal(await readFile(seedPath,'utf8'),seedBefore);assert.equal(calls,beforeOpen,'reading never invokes a model');
   if(process.env.CLASSROOM_UI_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_UI_EVIDENCE,'PPT-cache.png'),await ui.screenshot(1540,1100));
   await go(ui,'#/settings');
   await click(ui,'高级','.nav button');
   assert.equal(await waitFor(ui,"[...document.querySelectorAll('main label')].find(l=>l.textContent.trim().startsWith('材料解析并发数'))?.querySelector('input')?.value"),'2');
   await click(ui,'服务与账号','.nav button');
   await click(ui,/备用/,'button.summary');
   assert.equal(await waitFor(ui,"[...document.querySelectorAll('main label')].find(l=>l.textContent.trim().startsWith('模型名称'))?.querySelector('input')?.value"),'mock-fallback');
   assert(!(await ui.evaluate('document.documentElement.outerHTML')).includes('fallback-secret'),'saved keys never reach the page');
   assert.equal(await ui.evaluate("[...document.querySelectorAll('main input[type=password]')].every(e=>e.value==='')"),true);
   await go(ui,'#'+course+'/overview');
   await click(ui,'⋯','button[aria-label="更多 · partial.pdf"]');
   await click(ui,'查看逐页结果');
   await waitText(ui,'已完成 1/2 页','dialog[open]');
   assert(await ui.evaluate("[...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent.trim()==='采用部分结果'&&!b.disabled)"),'partial results can be accepted');
   if(process.env.CLASSROOM_UI_EVIDENCE)await writeFile(path.join(process.env.CLASSROOM_UI_EVIDENCE,'AI-partial.png'),await ui.screenshot(1540,1000));
  }finally{await ui.close();}
  await api(url+'/ai-partial-import',{sourceId:partial.id,confirm:true});const accepted=await api(url+'/analysis?source='+partial.id);assert.deepEqual(accepted.coverage.missing,[2]);assert.equal(accepted.pages[1].status,'unreadable');
  const beforeRetry=calls;await api(url+'/ai-parse',{sourceId:partial.id,retryFailed:true});await waitFile(partial.id);assert.equal(calls-beforeRetry,3);assert.equal(requests.filter(r=>r.source==='partial.pdf'&&r.page===1).length,1);
  // One courseware page done again: only that page is sent, the other pages stay as they were.
  const deckId=p.files[0].id,beforeRedo=calls,pagesBefore=(await api(url+'/analysis?source='+deckId)).pages;
  await api(url+'/ai-parse',{sourceId:deckId,pages:[2],part:'all'});const redone=await waitFile(deckId);assert.equal(redone.aiParse.status,'done',redone.aiParse.error);
  assert.equal(calls-beforeRedo,1,'only page 2 is sent: '+redone.aiParse.stage+' '+(redone.aiParse.error||''));assert.deepEqual(requests.slice(-1).map(r=>r.page),[2]);
  const pagesAfter=(await api(url+'/analysis?source='+deckId)).pages;assert.equal(pagesAfter.length,6);for(const i of [0,2,3,4,5])assert.deepEqual(pagesAfter[i].originalText,pagesBefore[i].originalText);
  await assert.rejects(api(url+'/ai-parse',{sourceId:deckId,pages:[9],part:'all'}),/存在的页面|无效/);
  // An unchanged slide image is answered without the image.
  const firstImage=await fetch(base+url+'/page-image?source='+deckId+'&page=1'),etag=firstImage.headers.get('etag');await firstImage.arrayBuffer();
  const sameImage=await fetch(base+url+'/page-image?source='+deckId+'&page=1',{headers:{'if-none-match':etag}});assert.equal(sameImage.status,304);

  const editor=await api('/api/settings/editor');
  const profile=editor.modelProfiles.find(item=>item.model==='mock-vision');
  assert(profile);
  await api('/api/settings/editor',{section:'routes',modelRoutes:{...editor.modelRoutes,pptPreview:profile.id}});
  const preview=await api(url+'/ppt-page-preview',{sourceId:p.files[0].id,pageIndex:1});
  assert.equal(preview.transport,'preview');
  let job;
  for(let i=0;i<200;i++){
   job=await api('/api/preview/jobs/'+preview.id);
   if(job.status!=='running')break;
   await sleep(50);
  }
  assert.equal(job.status,'success',job.message);
  assert.equal(requests.at(-1).model,'mock-vision');
  assert.equal(requests.at(-1).page,2);
  assert.equal(await readFile(reportFile,'utf8'),savedReport);
  await api(url+'/ai-cache-clear',{sourceId:p.files[0].id});assert.equal((await api(url)).files[0].parseStatus,'ready');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>mock.close(r));await rm(temp,{recursive:true,force:true});}
});
