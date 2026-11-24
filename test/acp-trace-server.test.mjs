import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';

test('the full Antigravity log setting can be switched on, and its logs listed, downloaded and cleared',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-trace-server-'));let child;
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const json=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  assert.equal((await json('/api/acp/traces')).data.enabled,false,'off by default');
  const saved=await json('/api/settings/editor',{section:'advanced',acpTrace:true});
  assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.acpTrace,true);
  assert.equal((await json('/api/acp/traces')).data.enabled,true);
  assert.equal((await json('/api/settings/editor',{section:'advanced',acpTrace:'yes'})).status,400,'must be true or false');
  // A log as a request would leave it.
  const name='20261123-204000-0123abcd.jsonl';
  await mkdir(path.join(dir,'diagnostics','acp'),{recursive:true});
  await writeFile(path.join(dir,'diagnostics','acp',name),'{"kind":"request"}\n{"kind":"result"}\n');
  const list=(await json('/api/acp/traces')).data;
  assert.deepEqual(list.files.map(f=>f.name),[name]);assert(list.totalBytes>0);
  const download=await fetch(base+'/api/acp/traces/'+name);
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.match(await download.text(),/"result"/);
  assert.equal((await fetch(base+'/api/acp/traces/..%2Fsettings.json')).status,400,'only log files can be downloaded');
  assert.equal((await json('/api/acp/traces-clear',{})).status,400,'clearing needs confirmation');
  assert.equal((await json('/api/acp/traces-clear',{confirm:true})).data.deleted,1);
  assert.equal((await json('/api/acp/traces')).data.files.length,0);
 }finally{child?.kill();if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
});
