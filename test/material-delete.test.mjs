import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {launchRenderer} from '../lib/browser-render.mjs';
import {deleteMaterial,materialDeleteJournal} from '../lib/material-delete.mjs';
import {contentHash} from '../lib/materials.mjs';

async function until(check){
 for(let i=0;i<150;i++){const value=await check();if(value)return value;await sleep(40);}
 throw Error('Timed out waiting for material management');
}

test('material deletion resumes after a locked file and preserves shared originals, previews and other material data',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-material-delete-'));
 const a={id:'a',name:'Deck.pptx',role:'ppt',stored:'Deck.pptx',parsed:'a/blocks.json'};
 const b={...a,id:'b',parsed:'b/blocks.json'};
 const pages=[a,b].map(file=>({sourceId:file.id,source:file.name,pageIndex:0,paragraphs:[{english:'Page '+file.id,chinese:'Translation '+file.id}],closeReading:'Reading '+file.id}));
 const project={name:'Week',files:[a,b],materialRevision:3,revision:4,preparation:{generation:'current',pages},chat:[{text:'Earlier answer'}]};
 const hash=contentHash(Buffer.from('shared bytes')),preview='.Cache/PPT/'+hash+'.pdf';
 try{
  for(const [file,content] of [['Source/Deck.pptx','shared bytes'],['Parsed/a/blocks.json','parsed'],['Parsed/b/blocks.json','other'],['.Cache/Pages/a/page-1.png','page'],['Output/References/a/Bilingual.md','translation'],[preview,'preview']]){
   const target=path.join(dir,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);
  }
  await mkdir(path.join(dir,'Output','Preparation'),{recursive:true});
  await writeFile(path.join(dir,'Output','Preparation','PPT_Reader.json'),JSON.stringify({pages}));
  await assert.rejects(deleteMaterial(project,'a',dir,async()=>{}, {remove:async()=>{throw Error('locked');}}),/删除未完成/);
  assert.equal((await materialDeleteJournal(dir)).sourceId,'a');
  await deleteMaterial(project,'a',dir,async()=>{});
  assert.equal(await materialDeleteJournal(dir),null);
  assert.deepEqual(project.files,[b]);assert.equal(project.materialRevision,4);
  assert.equal(project.chat.length,1);
  for(const file of ['Parsed/a/blocks.json','.Cache/Pages/a/page-1.png','Output/References/a/Bilingual.md'])await assert.rejects(readFile(path.join(dir,file)),{code:'ENOENT'});
  assert.equal(await readFile(path.join(dir,'Parsed/b/blocks.json'),'utf8'),'other');
  assert.equal(await readFile(path.join(dir,'Source/Deck.pptx'),'utf8'),'shared bytes');
  assert.equal(await readFile(path.join(dir,preview),'utf8'),'preview');
  const guide=await readFile(path.join(dir,'Output','Preparation','PPT_Bilingual_Guide.md'),'utf8');
  assert.match(guide,/Page b/);assert.doesNotMatch(guide,/Page a/);
  await deleteMaterial(project,'b',dir,async()=>{});
  await assert.rejects(readFile(path.join(dir,'Source/Deck.pptx')),{code:'ENOENT'});
  await assert.rejects(readFile(path.join(dir,preview)),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('desktop sidebar scrolls independently and the material menu confirms deletion through the real UI',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-material-ui-'));
 const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='',browser;
 server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
 try{
  const base=await until(()=>{if(server.exitCode!==null)throw Error(log);return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
  async function api(endpoint,options){
   const response=await fetch(base+endpoint,options),data=await response.json();
   assert(response.ok,data.error);return data;
  }
  const post=(endpoint,body)=>api(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  for(let i=0;i<16;i++)await post('/api/projects',{name:'Test week '+i});
  const project=await post('/api/projects',{name:'Material test week'}),route='/api/projects/'+project.id;
  const uploaded=await api(route+'/upload',{method:'POST',headers:{'x-file-role':'bb','x-file-name':'BB%20example.md'},body:'Test material'});
  const file=uploaded.files.at(-1);
  browser=await launchRenderer(base,{});
  await browser.evaluate("setTimeout(()=>location.href='/',0);true");
  await until(()=>browser.evaluate("!!document.querySelector('#files .item-trigger')"));
  await browser.evaluate("if(document.body.classList.contains('sidebar-collapsed'))document.querySelector('#sidebar-toggle').click();true");
  await browser.screenshot(1280,720);
  const layout=await browser.evaluate(`(()=>{
   const list=document.querySelector('#projects'),footer=document.querySelector('aside footer');
   list.scrollTop=list.scrollHeight;
   return {scroll:list.scrollTop,rows:list.children.length,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,overflow:getComputedStyle(list).overflowY,body:document.body.className,footer:footer.getBoundingClientRect().bottom,list:list.getBoundingClientRect().bottom,width:innerWidth,height:innerHeight,duplicate:!!document.querySelector('#week-menu')};
  })()`);
  assert(layout.scroll>0,JSON.stringify(layout));assert(layout.list<=layout.footer&&layout.footer<=layout.height,JSON.stringify(layout));assert.equal(layout.duplicate,false);
  await sleep(100);
  assert(await browser.evaluate(`(()=>{
   const row=document.querySelector('#projects .project-row:last-child');
   row.querySelector('.item-trigger').click();
   const menu=row.querySelector('.item-popover'),bounds=menu.getBoundingClientRect();
   const visible=menu.matches(':popover-open')&&bounds.top>=0&&bounds.bottom<=innerHeight;
   menu.hidePopover();return visible;
  })()`));
  await browser.evaluate("document.querySelector('#files .item-trigger').click();document.querySelector('#files .item-popover .danger-text').click();true");
  await until(()=>browser.evaluate("document.querySelector('#delete-material-dialog').open"));
  assert.equal(await browser.evaluate("document.querySelector('#delete-material-name').textContent"),file.name);
  if(process.env.CLASSROOM_MATERIAL_EVIDENCE)await writeFile(process.env.CLASSROOM_MATERIAL_EVIDENCE,await browser.screenshot(1280,720));
  await browser.evaluate("document.querySelector('#delete-material-confirm').click();true");
  await until(async()=>!(await api(route)).files.length);
  await until(()=>browser.evaluate("!document.querySelector('#files [data-file-id]')"));
  await assert.rejects(readFile(path.join(dir,'classes',project.id,'Source',file.stored)),{code:'ENOENT'});
 }finally{
  await browser?.close();
  server.kill();await new Promise(resolve=>server.exitCode!==null||server.signalCode!==null?resolve():server.once('exit',resolve));
  await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
});
