import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createAcpRuntime,acpTimings,describeAcpTiming} from '../lib/acp-client.mjs';

const fixture=new URL('./fixtures/mock-acp.mjs',import.meta.url),settings={provider:'antigravity-acp',acpExecutable:process.execPath,acpEntry:'cli',model:'mock-gemini',contextChars:50000,acpThinking:'high'};

// Each Antigravity request records where its time went (program start, handshake, session, model
// switch, waiting for the first words, generation), without any request or reply text.
test('Antigravity requests record per-phase timing, and show when the program and session are reused',async()=>{
 const runtime=createAcpRuntime({validate:()=>{},launch:(exe,args,options)=>spawn(exe,[fixture.pathname.replace(/^\/(.:)/,'$1')],options)});
 const quiet=console.log;console.log=()=>{};
 try{
  const before=acpTimings.length;
  await runtime.run(settings,{user:'first batch',sessionGroup:'document-A'});
  await runtime.run(settings,{user:'second batch',sessionGroup:'document-A'});
  const [first,second]=acpTimings.slice(before);
  assert(first&&second,'two timings recorded');
  assert.equal(first.reusedProcess,false);assert.equal(second.reusedProcess,true,'the program stays open between requests');
  assert.equal(first.reusedSession,false);assert.equal(second.reusedSession,true,'a text request of the same document reuses its session');
  for(const phase of ['starting','initialize','session','prompt','generating'])assert(phase in first.phases,'first request has '+phase+': '+JSON.stringify(first.phases));
  assert(!('session' in second.phases),'a reused session is not created again');
  const sum=Object.values(first.phases).reduce((a,b)=>a+b,0);
  assert(Math.abs(sum-first.total)<0.01,'phases add up to the total');
  const text=describeAcpTiming(first);
  assert.match(text,/^耗时 \d+\.\d 秒：/);assert.match(text,/新启动 Antigravity 程序/);
  assert.match(describeAcpTiming(second),/沿用已打开的 Antigravity 程序，沿用会话/);
  assert.doesNotMatch(JSON.stringify(acpTimings),/first batch|second batch/,'no request text is kept');
 }finally{console.log=quiet;await runtime.disconnect();}
});
