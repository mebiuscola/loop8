import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,rm,readFile,readdir,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {transcriptData} from '../lib/transcript.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('streamed local audio: immutable originals, binding, range playback, session isolation, upload limit and interruption cleanup',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'classroom-audio-')),child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:temp,CLASSROOM_AUDIO_LIMIT_MB:'1',PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<100&&!log.includes('http://');i++)await pause(30);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const call=async(url,body)=>{const r=await fetch(base+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});assert(r.ok,await r.clone().text());return r.json();};
  let p=await call('/api/projects',{name:'Audio'});const route='/api/projects/'+p.id,session=(await call(route+'/sessions',{title:'Lecture'})).session,other=(await call(route+'/sessions',{type:'Seminar'})).session;
  const upload=async(action,name,bytes,sid=session.id)=>fetch(base+route+'/'+action,{method:'POST',headers:{'X-File-Name':encodeURIComponent(name),'X-Session-Id':sid,'X-File-Role':'srt'},body:bytes});
  const audio=Buffer.alloc(100000,27);let response=await upload('audio-upload','Lecture.wav',audio);assert.equal(response.status,201);p=await response.json();const file=p.files[0];assert.equal(p.sessions[0].revision,0);assert.equal(p.materialRevision,0);assert.equal(p.sessions[0].audio.srtId,null);
  assert.deepEqual(await readFile(path.join(temp,'classes',p.id,'Source',file.stored)),audio);
  const srt='1\n00:00:01,000 --> 00:00:03,000\nHello';response=await upload('upload','SmartSub.srt',srt);p=await response.json();assert.equal(p.sessions[0].audio.srtId,p.sessions[0].srtId);const revision=p.sessions[0].revision;
  response=await upload('audio-upload','Lecture.wav',audio);p=await response.json();assert.equal(p.lastUpload.kind,'reused');assert.equal(p.files.filter(f=>f.role==='audio').length,1);assert.equal(p.sessions[0].revision,revision);
  response=await upload('audio-upload','Lecture.wav',Buffer.alloc(100000,28));p=await response.json();assert.equal(p.lastUpload.name,'Lecture (2).wav');assert.deepEqual(await readFile(path.join(temp,'classes',p.id,'Source',file.stored)),audio);
  const media=base+route+'/audio?id='+file.id;response=await fetch(media,{headers:{Range:'bytes=10-29'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 10-29/100000');assert.equal((await response.arrayBuffer()).byteLength,20);
  response=await fetch(media,{method:'HEAD',headers:{Range:'bytes=-10'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-length'),'10');assert.equal((await response.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(media,{headers:{Range:'bytes=100000-'}})).status,416);
  response=await fetch(media,{headers:{Range:'bytes=0-9','If-Range':'wrong'}});assert.equal(response.status,200);await response.arrayBuffer();
  response=await upload('audio-upload','wrong.wav',audio,'missing-session');assert.equal(response.status,400);
  assert.equal((await fetch(base+route+'/audio?id='+p.sessions[0].srtId)).status,400);
  assert.equal((await upload('audio-upload','big.wav',Buffer.alloc(1048577))).status,400);
  // Chunked request has no Content-Length and must still save exact bytes.
  await new Promise((resolve,reject)=>{const req=http.request(base+route+'/audio-upload',{method:'POST',headers:{'X-File-Name':'chunked.mp3','X-Session-Id':other.id}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{assert.equal(res.statusCode,201,text);resolve();}catch(e){reject(e);}});});req.on('error',reject);req.write(audio.subarray(0,50000));req.end(audio.subarray(50000));});
  await new Promise(resolve=>{const req=http.request(base+route+'/audio-upload',{method:'POST',headers:{'X-File-Name':'broken.wav','X-Session-Id':other.id,'Content-Length':1000000}});req.on('error',()=>resolve());req.write(audio);setTimeout(()=>req.destroy(),50);});await pause(80);
  assert(!(await readdir(path.join(temp,'classes',p.id,'Source'))).some(n=>n.endsWith('.part')));
  // A generated reader is associated with exact SRT bytes and refuses binding to another revision.
  const dir=path.join(temp,'classes',p.id),generation='test-generation';p=await call(route);const lesson=p.sessions[0],source=p.files.find(f=>f.id===lesson.srtId),timeline=transcriptData(lesson,source,Buffer.from(srt),[{speaker:'Lecturer',cueIds:[1],english:'Hello',chinese:'你好'}]);await mkdir(path.join(dir,'Output','Sessions',lesson.id),{recursive:true});await writeFile(path.join(dir,'Output','Sessions',lesson.id,'Transcript_Reader.json'),JSON.stringify(timeline));lesson.generation=generation;lesson.outputRevision=lesson.revision;await writeFile(path.join(dir,'project.json'),JSON.stringify(p));
  assert.equal((await call(route+'/transcript?session='+lesson.id)).audio.matched,true);
  p=await (await upload('upload','SmartSub.srt',srt.replace('Hello','Changed'))).json();assert.notEqual(p.sessions[0].audio.srtId,p.sessions[0].srtId);p=await call(route+'/audio-binding',{sessionId:lesson.id,bindCurrent:true,offsetMs:1500});assert.equal(p.sessions[0].audio.offsetMs,1500);assert.equal((await call(route+'/transcript?session='+lesson.id)).audio.matched,false);
  assert.equal((await fetch(base+route+'/audio-binding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:other.id,offsetMs:0})})).status,200); // Other session has its own independently uploaded audio.
  assert.equal((await fetch(base+route+'/transcript?session='+other.id)).status,400);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(temp,{recursive:true,force:true});}
});

