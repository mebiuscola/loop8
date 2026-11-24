import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';

const root=new URL('..',import.meta.url);
const run=args=>{const child=spawn(process.execPath,['scripts/test-server.mjs',...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);return {child,log:()=>log};};

test('the test-server script starts a test copy on its own data folder and never on the project data',async()=>{
 const data=path.join(await mkdtemp(path.join(os.tmpdir(),'classroom-testcopy-')),'data');
 const {child,log}=run(['--port','0','--data',data]);
 try{
  let base;for(let i=0;i<200&&!(base=log().match(/Classroom Local: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]);i++)await sleep(30);assert(base,log());
  const settings=await (await fetch(base+'/api/settings/editor')).json();
  assert.equal(settings.testCopy,true,'Settings does not check the Antigravity account by itself');
  assert((await readdir(data)).length>0,'the server writes into the given data folder');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(path.dirname(data),{recursive:true,force:true});}
 // Refused: the project's own data folder.
 const refused=run(['--port','0','--data',fileURLToPathSafe(new URL('../data/test-copy',import.meta.url))]);
 const code=await new Promise(r=>refused.child.once('exit',r));
 assert.notEqual(code,0);assert.match(refused.log(),/outside the project folder/);
});
function fileURLToPathSafe(u){return decodeURIComponent(u.pathname).replace(/^\/(.:)/,'$1');}
