import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,reload,waitFor} from './helpers/app.mjs';

// Server push (GET /api/events) and "知道了" stored on the server (docs/API.md).
test('the server announces course changes, pages update without polling, and task acknowledgements are shared',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-events-')),id='Week_E';let child,ui,stream;const controller=new AbortController();
 try{
  const failed={status:'error',error:'模型未正常结束（content_filter）',started:'2026-11-20T10:00:00.000Z',finished:'2026-11-20T10:05:00.000Z'};
  const p={id,name:'Events week',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'idle',materialRevision:1,revision:1,bbText:'',sessions:[],files:[],chat:[],tasks:{'reference:gone':failed,'reading:gone':{...failed,error:'解析失败'}}};
  await mkdir(path.join(dir,'classes',id),{recursive:true});await writeFile(path.join(dir,'classes',id,'project.json'),JSON.stringify(p));
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {ok:r.ok,data:await r.json()};};

  // The event stream itself.
  const events=[];
  stream=await fetch(base+'/api/events',{signal:controller.signal});
  assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  (async()=>{const decoder=new TextDecoder();let buffer='';try{for await(const chunk of stream.body){buffer+=decoder.decode(chunk,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const data=block.split('\n').find(l=>l.startsWith('data: '));if(data)events.push(JSON.parse(data.slice(6)));}}}catch{/* closed */}})();
  await sleep(100);
  const created=(await post('/api/projects',{name:'New week'})).data;
  for(let i=0;i<100&&!events.some(e=>e.type==='list');i++)await sleep(20);
  assert(events.some(e=>e.type==='list'),'creating a course announces the list: '+JSON.stringify(events));
  assert(events.some(e=>e.type==='course'&&e.id===created.id),'and the course itself');
  events.length=0;
  await post('/api/projects/'+id+'/bb',{text:'Course notes'});
  for(let i=0;i<100&&!events.some(e=>e.type==='course'&&e.id===id);i++)await sleep(20);
  assert(events.some(e=>e.type==='course'&&e.id===id),'saving a course announces it: '+JSON.stringify(events));

  // "知道了" is stored on the task and only for failed or stopped tasks.
  const done=await post('/api/projects/'+id+'/task-dismiss',{key:'reference:gone'});
  assert(done.ok,JSON.stringify(done.data));
  assert.equal(done.data.dismissed,failed.finished+'|'+failed.error);
  const saved=await (await fetch(base+'/api/projects/'+id)).json();
  assert.equal(saved.tasks['reference:gone'].dismissed,failed.finished+'|'+failed.error);
  assert.equal((await post('/api/projects/'+id+'/task-dismiss',{key:'script:none'})).ok,false);

  try{await browserExecutable();}catch{t.diagnostic('browser unavailable; page updates not checked');return;}
  ui=await launchRenderer(base,{});
  // An acknowledgement kept in the browser by the previous version moves to the server once.
  await openApp(ui,'/w/'+id+'/overview',{width:1280,height:800});
  await ui.evaluate(`localStorage.setItem('classroom.next.dismissedTasks',JSON.stringify({${JSON.stringify(id+'|reading:gone')}:${JSON.stringify(failed.finished+'|解析失败')}}));true`);
  await reload(ui);
  for(let i=0;i<100;i++){const t=(await (await fetch(base+'/api/projects/'+id)).json()).tasks['reading:gone'];if(t.dismissed)break;await sleep(50);}
  assert.equal((await (await fetch(base+'/api/projects/'+id)).json()).tasks['reading:gone'].dismissed,failed.finished+'|解析失败');
  await waitFor(ui,"localStorage.getItem('classroom.next.dismissedTasks')===null",{label:'the browser copy is removed after moving'});
  await waitFor(ui,"(document.querySelector('nav.sidebar a[title=\"Events week\"] .dot')?.className||'').includes('ready')",{label:'both acknowledged tasks leave the course dot'});

  // A change made elsewhere (another tab or device) appears at once, long before the 60-second safety refresh.
  await waitFor(ui,"document.querySelector('main h1')?.textContent==='Events week'");
  await sleep(500);
  const r=await post('/api/projects/'+id+'/bb',{text:'Updated from another device'});assert(r.ok);
  await waitFor(ui,"document.body.innerText.includes('Updated from another device')",{timeout:4000,label:'pushed change shown'});
  await post('/api/projects',{name:'Week from elsewhere'});
  await waitFor(ui,"[...document.querySelectorAll('nav.sidebar a')].some(a=>a.textContent.includes('Week from elsewhere'))",{timeout:4000,label:'new course appears in the list'});
 }finally{
  controller.abort();
  await ui?.close();child?.kill();
  if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
