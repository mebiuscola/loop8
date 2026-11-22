import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('new frontend is served at / with a strict CSP, old addresses redirect, old files are gone, and no path traversal',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-next-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await pause(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const get=url=>fetch(base+url,{redirect:'manual'});

  // The redesign-era address leads to the new home page.
  for(const old of ['/next','/next/','/next/index.html']){
   const redirect=await get(old);
   assert.equal(redirect.status,302,old);
   assert.equal(redirect.headers.get('location'),'/',old);
  }

  const built=await access(new URL('../public/next/index.html',import.meta.url)).then(()=>true,()=>false);
  const index=await get('/');
  if(built){
   assert.equal(index.status,200);
   assert.match(index.headers.get('content-type'),/text\/html/);
   assert.equal(index.headers.get('cache-control'),'no-cache');
   const csp=index.headers.get('content-security-policy');
   assert.match(csp,/script-src 'self' 'wasm-unsafe-eval';/);
   assert.doesNotMatch(csp,/'unsafe-inline'|'unsafe-eval'/);
  }else{
   assert.equal(index.status,404);
   assert.equal((await index.json()).error,'新界面尚未构建。');
  }

  assert.equal((await get('/next/assets/does-not-exist.js')).status,404);
  for(const evil of ['/next/..%2f..%2fserver.mjs','/next/%2e%2e/%2e%2e/package.json','/next/..%5c..%5cserver.mjs']){
   const r=await get(evil);
   assert.ok([400,404].includes(r.status),evil+' -> '+r.status);
   assert.doesNotMatch(await r.text(),/createServer|"version"/);
  }

  // The old frontend was removed; its address leads to the new one, and its files are gone.
  for(const old of ['/legacy','/legacy/']){
   const r=await get(old);
   assert.equal(r.status,302,old);
   assert.equal(r.headers.get('location'),'/',old);
  }
  for(const old of ['/app.js','/style.css','/settings.js','/reader.js','/workflow.js'])assert.equal((await get(old)).status,404,old);
  // Standalone pages the server still needs keep their files.
  for(const kept of ['/reading-reference.js','/reading-reference.css','/pptx-frame.js','/parse-render.js'])assert.equal((await get(kept)).status,200,kept);
 }finally{
  child.kill();await pause(100);await rm(temp,{recursive:true,force:true});
 }
});
