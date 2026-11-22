import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {testPdf} from '../lib/diagnostics.mjs';

async function until(check){
 for(let i=0;i<220;i++){const result=await check();if(result)return result;await sleep(35);}
 throw Error('Background task did not reach the expected state.');
}

test('MinerU and Ask overlap, keep independent state and preserve navigation and drafts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-background-'));
 const uploads=new Map(),questions=[];
 const mock=http.createServer((req,res)=>{
  if(req.url.startsWith('/mineru/')){uploads.set(decodeURIComponent(req.url.slice(8)),res);return;}
  questions.push(res);
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+mock.address().port,hook=path.join(dir,'mock.mjs');
 const preload=`import {registerHooks} from 'node:module';
 registerHooks({load(url,context,next){
  if(!url.endsWith('/lib/mineru-cloud.mjs'))return next(url,context);
  return {format:'module',shortCircuit:true,source:\`
   import {contentListDocument} from './materials.mjs';
   export async function mineruCloud(settings,input,onProgress,{source}){
    await onProgress('Mock upload waiting');
    const response=await fetch('${origin}/mineru/'+encodeURIComponent(source.name));
    if(!response.ok)throw Error('Mock MinerU failure');
    return contentListDocument([{type:'text',text:'Recovered reading evidence',page_idx:0}],source);
   }\`};
 }});`;
 await writeFile(hook,preload);
 const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='',ui;
 child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);
 const reply=res=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'The saved answer.'}}]}));};
 try{
  const base=await until(()=>{if(child.exitCode!==null)throw Error(log);return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
  const request=async(url,body)=>fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const api=async(url,body)=>{const response=await request(url,body),value=await response.json();assert(response.ok,value.error);return value;};
  await api('/api/settings',{baseUrl:origin+'/v1',apiKey:'mock-key',model:'mock'});
  const first=await api('/api/projects',{name:'Background A'}),second=await api('/api/projects',{name:'Background B'});
  const route='/api/projects/'+first.id;
  await api(route+'/bb',{text:'Evidence available before parsing.'});
  async function upload(name,role='reading'){
   const response=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':role,'x-file-name':name},body:role==='reading'?Buffer.concat([testPdf(),Buffer.from('% '+name+'\n')]):'Supplementary evidence.'});
   assert(response.ok);return (await response.json()).files.find(file=>file.name===name);
  }
  const a=await upload('A.pdf'),b=await upload('B.pdf');
  await api(route+'/process',{mode:'reading',sourceId:a.id});
  await api(route+'/process',{mode:'reading',sourceId:b.id});
  await until(()=>uploads.size===2);
  const progress=await api(route);
  assert.equal(progress.files.find(file=>file.id===a.id).progress,'Mock upload waiting');
  assert.equal((await request(route+'/material-role',{sourceId:a.id,role:'ppt'})).status,400);
  await upload('extra.txt','bb');
  let browser=true;try{await browserExecutable();}catch{browser=false;}
  let pending;
  if(browser){
   ui=await launchRenderer(base,{});
   await ui.evaluate(`localStorage.setItem('classroom-project',${JSON.stringify(first.id)});setTimeout(()=>location.href='/legacy/',0);true`);
   await until(()=>ui.evaluate("document.querySelector('#title')?.textContent==='Background A'"));
   await ui.evaluate("document.querySelector('#qa-launch').click();document.querySelector('#question').value='My original question';document.querySelector('#ask-form').requestSubmit();true");
  }else pending=api(route+'/ask',{question:'My original question'});
  await until(()=>questions[0]);
  assert.equal((await request(route+'/ask',{question:'Duplicate'})).status,400);
  if(ui){
   await ui.evaluate("document.querySelector('#question').value='Next question draft';[...document.querySelectorAll('#projects .project')].find(x=>x.textContent.includes('Background B')).click();true");
   await until(()=>ui.evaluate("document.querySelector('#title').textContent==='Background B'"));
  }
  uploads.get('A.pdf').end('ok');
  await until(async()=> (await api(route)).files.find(file=>file.id===a.id).parseStatus==='ready');
  reply(questions[0]);await pending;
  await until(async()=> (await api(route)).chat.length===2);
  uploads.get('B.pdf').end('ok');
  const done=await until(async()=>{const value=await api(route);return value.status==='done'&&value;});
  assert.equal(done.chat.length,2);
  assert.equal(done.files.filter(file=>file.parseStatus==='ready').length,3);
  assert(done.files.find(file=>file.name==='extra.txt'));
  if(ui){
   await ui.evaluate("[...document.querySelectorAll('#projects .project')].find(x=>x.textContent.includes('Background A')).click();true");
   await until(()=>ui.evaluate("document.querySelector('#chat').textContent.includes('The saved answer.')"));
   assert.equal(await ui.evaluate("document.querySelector('#question').value"),'Next question draft');
  }
 }finally{
  await ui?.close();child.kill();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));
  await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});
 }
});
