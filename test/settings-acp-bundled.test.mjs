import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=path.dirname(fileURLToPath(new URL('../server.mjs',import.meta.url)));

test('settings editor reports the bundled ACP server and a connection can use it without typing a path',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-acp-bundled-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await pause(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(body)=>{const r=await fetch(base+'/api/settings/editor',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const v=await r.json();assert(r.ok,v.error);return v;};

  const expected=path.join(ROOT,'agy-acp-server','agy_acp_server.exe');
  const present=await access(expected).then(()=>true,()=>false);
  const editor=await call();
  assert.equal(editor.acpBundled,present?expected:'');
  // Old data is untouched: nothing is added to the saved settings just by reading them.
  assert.equal(editor.modelProfiles.length,0);
  assert.deepEqual(editor.acpPaths,{});

  if(present){
   // The reported path passes the backend's own ACP validation when a connection is saved with it.
   const saved=await call({section:'model',profile:{id:'acp-test-model',name:'Antigravity · test',provider:'antigravity-acp',acpEntry:'standalone',acpExecutable:editor.acpBundled,model:'test-model',contextChars:180000},acpPaths:{standalone:editor.acpBundled}});
   assert.equal(saved.modelProfiles[0].acpExecutable,expected);
   assert.equal(saved.acpPaths.standalone,expected);
  }
 }finally{
  child.kill();await pause(100);await rm(temp,{recursive:true,force:true});
 }
});
