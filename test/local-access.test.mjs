import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';

/** GET with a chosen Host (and Origin) header; fetch does not allow setting Host. */
function get(port,host,origin){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:'/api/projects',headers:{host,...(origin?{origin}:{})}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);req.end();
 });
}

test('the app answers 127.0.0.1 and localhost only, and refuses requests from other sites',async()=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'classroom-access-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:data,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const port=Number(log.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);assert(port,log);
  assert.equal(await get(port,'127.0.0.1:'+port),200);
  assert.equal(await get(port,'localhost:'+port),200,'localhost is this computer too');
  assert.equal(await get(port,'LOCALHOST:'+port),200);
  assert.equal(await get(port,'example.com:'+port),403,'another name (DNS rebinding) is refused');
  assert.equal(await get(port,'localhost.example.com:'+port),403);
  assert.equal(await get(port,'localhost:'+port,'http://example.com'),403,'a request from another site is refused');
  assert.equal(await get(port,'localhost:'+port,'http://localhost:'+port),200);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(data,{recursive:true,force:true});}
});
