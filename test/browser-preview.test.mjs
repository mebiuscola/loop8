import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {zipFixture} from './helpers/zip-fixture.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('unparsed PPTX is independently readable, does not start Office, and preview source is restricted to PPTX material',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-browser-')),child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await pause(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(url,body)=>{const r=await fetch(base+url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});assert(r.ok,await r.clone().text());return r.json();};
  const p=await call('/api/projects',{name:'BrowserOnly'}),route='/api/projects/'+p.id;
  const original=zipFixture([['ppt/presentation.xml','<p:presentation xmlns:p="p"><p:sldIdLst><p:sldId id="2"/><p:sldId id="1"/></p:sldIdLst></p:presentation>'],['ppt/slides/slide1.xml','<p:sld show="0"/>'],['ppt/slides/slide2.xml','<p:sld/>']]);
  const response=await fetch(base+route+'/upload',{method:'POST',headers:{'X-File-Name':encodeURIComponent('中文 课件.pptx'),'X-File-Role':'ppt'},body:original});assert.equal(response.status,201);const uploaded=await response.json(),f=uploaded.files[0];assert.equal(f.parseStatus,'awaiting-json');
  const reader=await call(route+'/reader?source='+f.id);assert.equal(reader.nativePageCount,2);assert.deepEqual(reader.pages,[]);assert.equal(reader.generated,false);
  const bytes=await fetch(base+route+'/preview-source?source='+f.id);assert.equal(bytes.status,200);assert.match(bytes.headers.get('content-type'),/presentationml/);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),original);
  const status=await call(route+'/preview-status?source='+f.id);assert.equal(status.status,'missing');assert(!(await readdir(path.join(temp,'classes',p.id))).includes('.Cache'),'upload must never launch Office or create preview cache');
  const bad=await fetch(base+route+'/preview-source?source=other-project');assert.equal(bad.status,400);
  const raw=await readFile(path.join(temp,'classes',p.id,'Source',f.stored));assert.deepEqual(raw,original);
  const frame=await fetch(base+'/pptx-frame.html'),policy=frame.headers.get('content-security-policy');assert.match(policy,/frame-ancestors 'self'/);assert.match(policy,/default-src 'none'/);assert.match(policy,/connect-src 'self' blob:/);
  const page=await fetch(base+'/');assert(!page.headers.get('content-security-policy').includes("style-src 'self' 'unsafe-inline'"),'inline styles are isolated to the renderer frame');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));const relative=path.relative(os.tmpdir(),temp);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))await rm(temp,{recursive:true,force:true});}
});
