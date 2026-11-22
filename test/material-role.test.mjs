import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {launchRenderer} from '../lib/browser-render.mjs';
import {openApp,waitFor,waitText,click} from './helpers/app.mjs';

const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
async function textPdf(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(let n=0;n<2;n++){
  const page=doc.addPage([595,842]);let y=760;
  for(let i=0;i<8;i++){page.drawText('A sentence of the reading on comparative literature and translation, line '+i+'.',{x:60,y,size:11,font});y-=15;}
 }
 return Buffer.from(await doc.save());
}

// Changing a material's role in the overview ⋯ menu used to break the page: the row was given the
// reading data loaded for its old role, rendering failed and the menu no longer responded.
test('changing a material role in the overview updates the row and keeps the page working',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-material-role-'));
 const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='',browser;
 server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 try{
  let base;for(let i=0;i<150&&!(base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);i++)await sleep(40);
  assert(base,log);
  const api=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert(r.ok,data.error);return data;};
  const p=await api('/api/projects',{name:'Role week'}),route='/api/projects/'+p.id;
  const up=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':'Reading.pdf'},body:await textPdf()});
  const file=(await up.json()).files[0];
  await api(route+'/process',{mode:'reading',sourceId:file.id});
  for(let i=0;i<200&&(await api(route)).files[0].parseStatus!=='ready';i++)await sleep(30);

  browser=await launchRenderer(base,{});
  await openApp(browser,'/w/'+encodeURIComponent(p.id)+'/overview',{width:1280,height:800});
  await browser.evaluate(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));true`);
  const row=`[...document.querySelectorAll('main small')].find(s=>s.closest('div')?.textContent.includes('Reading.pdf'))?.textContent||''`;
  await waitFor(browser,`(${row}).startsWith('参考文献')&&document.body.innerText.includes('未翻译')`,{label:'reference row with its reading status'});

  for(const [role,status] of [['课件',/未生成导读|读取中/],['课程说明',/已解析/],['参考文献',/未翻译/]]){
   await click(browser,'⋯','button[aria-label="更多 · Reading.pdf"]');
   await click(browser,role,'[role=menuitemradio]');
   await waitText(browser,'用途已改为'+role,'main');
   await waitFor(browser,`(${row}).startsWith(${JSON.stringify(role)})`,{label:'row shows '+role});
   await waitFor(browser,`${status}.test(document.querySelector('main').innerText)`,{label:'status for '+role});
   assert.deepEqual(await browser.evaluate('__errors'),[],'no rendering error after changing to '+role);
  }
  assert.equal((await api(route)).files[0].role,'reading');
 }finally{
  await browser?.close();server.kill();
  await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
