import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {listenSafe} from '../lib/ports.mjs';

const {PDFDocument,StandardFonts}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
async function textPdf(label){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),page=doc.addPage([595,842]);
 for(let i=0;i<8;i++)page.drawText(`${label}: a sentence of the reading on comparative literature, line ${i}.`,{x:60,y:760-i*15,size:11,font});
 return Buffer.from(await doc.save());
}
async function until(check,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const v=await check();if(v)return v;await sleep(50);}throw Error('Timed out: '+label);}

// Starting a reference translation while another job of the same week is running used to fail with
// "此课程正在处理请求". Now it waits in a queue and starts by itself; it can be cancelled while waiting.
test('a reference translation started during another job waits in the queue and then starts by itself',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-queue-'));
 const held=[];
 const mock=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/mineru/')){held.push(res);return;}
  let body='';for await(const c of req)body+=c;
  res.setHeader('content-type','application/json');
  // Model requests: answer every translation request so the started task can run.
  let input={};try{input=JSON.parse(JSON.parse(body).messages.at(-1).content);}catch{/* not a translation */}
  const answer=Array.isArray(input.items)?{translations:input.items.map(i=>({id:i.id,chinese:'译文'}))}:{chinese:'译文'};
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}));
 });
 await listenSafe(mock);
 const origin='http://127.0.0.1:'+mock.address().port,hook=path.join(dir,'mock.mjs');
 // MinerU is replaced by a stand-in that waits until the test releases it: the week stays busy.
 await writeFile(hook,`import {registerHooks} from 'node:module';
 registerHooks({load(url,context,next){
  if(!url.endsWith('/lib/mineru-cloud.mjs'))return next(url,context);
  return {format:'module',shortCircuit:true,source:\`
   import {contentListDocument} from './materials.mjs';
   export async function mineruCloud(settings,input,onProgress,{source}){
    await onProgress('Mock upload waiting');
    await fetch('${origin}/mineru/'+encodeURIComponent(source.name));
    return contentListDocument([{type:'text',text:'Recovered text',page_idx:0}],source);
   }\`};
 }});`);
 const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{
  const base=await until(()=>{if(child.exitCode!==null)throw Error(log);return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];},'server');
  const request=(url,body)=>fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const api=async(url,body)=>{const r=await request(url,body),v=await r.json();assert(r.ok,v.error);return v;};
  await api('/api/settings',{baseUrl:origin+'/v1',apiKey:'mock-key',model:'mock'});
  const p=await api('/api/projects',{name:'Queue week'}),route='/api/projects/'+p.id;
  const upload=async name=>{const r=await fetch(base+route+'/upload',{method:'POST',headers:{'x-file-role':'reading','x-file-name':name},body:await textPdf(name)});assert(r.ok);return (await r.json()).files.find(f=>f.name===name);};
  const reading=await upload('Reading.pdf'),other=await upload('Other.pdf');
  await api(route+'/process',{mode:'reading',sourceId:reading.id});
  await until(async()=>(await api(route)).files.find(f=>f.id===reading.id).parseStatus==='ready','reading parsed');
  const task=async()=>(await api(route)).tasks?.['reference:'+reading.id];

  // Another job keeps the week busy: re-parsing Other.pdf with MinerU, held by the stand-in.
  await api(route+'/process',{mode:'reading',sourceId:other.id,engine:'mineru'});
  await until(()=>held.length===1,'MinerU job running');

  // Cancelling while queued.
  let queued=await api(route+'/process',{mode:'reference',sourceId:reading.id});
  assert.equal(queued.tasks['reference:'+reading.id].status,'queued');
  await api(route+'/queue-cancel',{key:'reference:'+reading.id});
  assert.match((await task()).error,/已取消排队/);

  // Queued again; it starts by itself once the other job is done.
  queued=await api(route+'/process',{mode:'reference',sourceId:reading.id});
  assert.equal(queued.tasks['reference:'+reading.id].status,'queued');
  await sleep(2500);
  assert.equal((await task()).status,'queued','still waiting while the other job runs');
  held.shift().end('ok');
  const done=await until(async()=>{const t=await task();return t&&t.status!=='queued'&&t.status!=='running'&&t;},'queued translation ran',20000);
  assert.equal(done.status,'complete',JSON.stringify(done));
  const reader=await api(route+'/reference-reader?source='+reading.id);
  assert(reader.summary.completed>0&&reader.summary.completed===reader.summary.total,JSON.stringify(reader.summary));
 }finally{
  for(const res of held)res.end('ok');
  child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await new Promise(r=>mock.close(r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
