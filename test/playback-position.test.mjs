import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {contentHash} from '../lib/materials.mjs';
import {transcriptData,cleanScript} from '../lib/transcript.mjs';
import {browserExecutable,launchRenderer} from '../lib/browser-render.mjs';
import {openApp,go,waitFor} from './helpers/app.mjs';

// Two minutes of silence: long enough to have a position worth remembering.
function wav(seconds=120){const rate=8000,data=rate*2*seconds,b=Buffer.alloc(44+data);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data,40);return b;}

// Leaving the class page for another workspace and coming back must keep the recording's position,
// even when the newly opened player reports 0:00 before the recording is ready (pressing play at
// once does that) — which used to be saved over the real position.
test('the recording keeps its position across workspaces even if the new player reports 0:00 first',async t=>{
 try{await browserExecutable();}catch{t.skip('Browser unavailable');return;}
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-playback-')),id='Week_P',folder=path.join(dir,'classes',id);let ui,child;
 try{
  const srt=Buffer.from('1\n00:00:00,000 --> 00:01:50,000\nReading involves comparison.'),audioBytes=wav();
  const s={id:'lecture',type:'Lecture',title:'Lecture One',revision:1,outputRevision:1,srtId:'srt',generation:'script',materialRevision:1,artifactStatus:{script:'complete',deepDive:'not_generated'},audio:{fileId:'audio',srtId:'srt',srtHash:contentHash(srt),offsetMs:0}};
  const subtitle={id:'srt',role:'srt',name:'Lecture.srt',stored:'Lecture.srt',sessionId:s.id,size:srt.length,parseStatus:'ready'};
  const audio={id:'audio',role:'audio',name:'Lecture.wav',stored:'Lecture.wav',sessionId:s.id,size:audioBytes.length,parseStatus:'ready'};
  const p={id,name:'Playback week',created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'done',materialRevision:1,revision:1,bbText:'',sessions:[s],files:[subtitle,audio],chat:[],tasks:{}};
  const timeline=transcriptData(s,subtitle,srt,[{chapter:'Comparison',speaker:'Lecturer',cueIds:[1],english:'Reading involves comparison.',chinese:'阅读涉及比较。'}]);
  for(const [file,value] of Object.entries({'project.json':JSON.stringify(p),'Source/Lecture.srt':srt,'Source/Lecture.wav':audioBytes,'Output/Sessions/lecture/Transcript_Reader.json':JSON.stringify(timeline),'Output/Sessions/lecture/Class_Script_Bilingual.md':cleanScript(p.name,s,timeline)})){
   await mkdir(path.dirname(path.join(folder,file)),{recursive:true});await writeFile(path.join(folder,file),value);
  }
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  ui=await launchRenderer(base,{});
  await openApp(ui,'/w/'+id+'/class',{width:1280,height:800});
  await waitFor(ui,"document.querySelector('audio')?.readyState>=1",{label:'recording ready'});
  // Listen up to 1:15, then go to the reading page.
  await ui.evaluate("(()=>{const a=document.querySelector('audio');a.muted=true;a.currentTime=75;return true;})()");
  await waitFor(ui,"Math.round(document.querySelector('audio').currentTime)===75");
  await go(ui,'/w/'+id+'/read');
  await waitFor(ui,"!document.querySelector('audio')",{label:'left the class page'});
  // Coming back: the moment the new player appears, before the recording has loaded, it reports
  // 0:00 (as pressing play at once does).
  await ui.evaluate(`(()=>{const seen=new MutationObserver(()=>{const a=document.querySelector('audio');if(a&&!a.__reported){a.__reported=true;window.__stateWhenReported=a.readyState;a.dispatchEvent(new Event('timeupdate'));}});seen.observe(document.body,{childList:true,subtree:true});window.__seen=seen;return true;})()`);
  await go(ui,'/w/'+id+'/class');
  await waitFor(ui,"document.querySelector('audio')?.__reported&&document.querySelector('audio').readyState>=1",{label:'back on the class page'});
  await waitFor(ui,"Math.round(document.querySelector('audio').currentTime)===75",{label:'position restored to 1:15',timeout:8000});
  const saved=await ui.evaluate("Object.values(JSON.parse(localStorage.getItem('classroom.next.playback')||'{}')).map(v=>Math.round(v.time))");
  assert.deepEqual(saved,[75],'the remembered position was not replaced by 0:00');
  // A jump chosen by the reader still wins over the remembered position.
  await ui.evaluate("(()=>{const a=document.querySelector('audio');a.currentTime=30;return true;})()");
  await waitFor(ui,"Math.round(document.querySelector('audio').currentTime)===30");
  await go(ui,'/w/'+id+'/overview');await waitFor(ui,"!document.querySelector('audio')");
  await go(ui,'/w/'+id+'/class');
  await waitFor(ui,"Math.round(document.querySelector('audio')?.currentTime??-1)===30",{label:'the newer position is kept',timeout:8000});
 }finally{
  await ui?.close();child?.kill();
  if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});
 }
});
