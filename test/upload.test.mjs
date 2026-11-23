import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {curlUpload,nodeUpload,uploadFile,UploadError} from '../lib/upload.mjs';
import {listenSafe} from '../lib/ports.mjs';
async function fixture(action){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-upload-'));const file=path.join(dir,'带空格 file.bin'),bytes=Buffer.alloc(2*1024*1024,87);await writeFile(file,bytes);const sockets=new Set();const server=http.createServer(action);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await listenSafe(server);return {file,bytes,url:`http://127.0.0.1:${server.address().port}/signed?signature=private`,async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));const rel=path.relative(os.tmpdir(),dir);if(rel&&!rel.startsWith('..'))await rm(dir,{recursive:true,force:true});}};}
for(const method of [curlUpload,nodeUpload])test(`${method.name} sends exact binary bytes, no authorization/content-type, and reports progress`,async()=>{
 let uploaded;const f=await fixture(async(req,res)=>{assert.equal(req.method,'PUT');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['content-type'],undefined);const parts=[];for await(const c of req)parts.push(c);uploaded=Buffer.concat(parts);res.end('ok');});
 try{const messages=[];const result=await method(f.url,f.file,{allowHttp:true,onProgress:async m=>messages.push(m)});assert.equal(result.status,200);assert.deepEqual(uploaded,f.bytes);assert(messages.some(m=>m.includes('MB')));assert(!messages.join('').includes('signature'));}finally{await f.close();}
});
test('automatic fallback retries same signed URL only after transport failure; 403 stops immediately',async()=>{
 const f=await fixture((req,res)=>res.end());try{let attempts=0;const messages=[];const fallback=async(url,file,opts)=>{attempts++;return nodeUpload(url,file,opts);};await uploadFile(f.url,f.file,{allowHttp:true,onProgress:async m=>messages.push(m),transports:[async()=>{throw new UploadError('connection failed');},fallback]});assert.equal(attempts,1);assert(messages.some(m=>m.includes('切换备用')));
  attempts=0;await assert.rejects(()=>uploadFile(f.url,f.file,{transports:[async()=>{throw new UploadError('HTTP 403',403);},fallback]}),/403/);assert.equal(attempts,0);
 }finally{await f.close();}
});
for(const method of [curlUpload,nodeUpload])test(`${method.name} aborts while server withholds confirmation`,async()=>{
 const f=await fixture(async(req,res)=>{for await(const chunk of req){};});try{await assert.rejects(()=>method(f.url,f.file,{allowHttp:true,signal:AbortSignal.timeout(200)}));}finally{await f.close();}
});
test('native uploader identifies stalled server and curl absence falls back',async()=>{
 const f=await fixture(async(req,res)=>{for await(const chunk of req){};});try{await assert.rejects(()=>nodeUpload(f.url,f.file,{allowHttp:true,idleSeconds:.1}),/超时/);}finally{await f.close();}
 const g=await fixture(async(req,res)=>{for await(const chunk of req){}res.end();});try{const result=await uploadFile(g.url,g.file,{allowHttp:true,curlExecutable:'C:/nonexistent-curl-for-test.exe'});assert.equal(result.transport,'node');}finally{await g.close();}
});
