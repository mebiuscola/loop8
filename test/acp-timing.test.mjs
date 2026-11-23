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
  for(const phase of ['starting','initialize','session','prompt','thinking','generating'])assert(phase in first.phases,'first request has '+phase+': '+JSON.stringify(first.phases));
  assert(!('session' in second.phases),'a reused session is not created again');
  const sum=Object.values(first.phases).reduce((a,b)=>a+b,0);
  assert(Math.abs(sum-first.total)<0.01,'phases add up to the total');
  const text=describeAcpTiming(first);
  assert.match(text,/^耗时 \d+\.\d 秒：/);assert.match(text,/新启动 Antigravity 程序/);
  assert.match(describeAcpTiming(second),/沿用已打开的 Antigravity 程序，沿用会话/);
  assert(first.thoughtUpdates>=1,'thoughts are counted');assert.equal(first.toolCalls,0);
  assert.doesNotMatch(JSON.stringify(acpTimings),/first batch|second batch|private thought/,'no request, reply or thought text is kept');
 }finally{console.log=quiet;await runtime.disconnect();}
});

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const mockRuntime=()=>createAcpRuntime({validate:()=>{},launch:(exe,args,options)=>spawn(exe,[fixture.pathname.replace(/^\/(.:)/,'$1')],options)});

// Pages of one deck share a session: the instructions (with the tool rules) go with the first page
// only; later pages carry a short reminder and their own input. Every fourth page starts afresh.
test('pages of a deck share a session for up to four pages, and the instructions are sent once',async()=>{
 const runtime=mockRuntime(),quiet=console.log;console.log=()=>{};
 try{
  const heads=[];
  for(let page=1;page<=5;page++)heads.push(JSON.parse(await runtime.run(settings,{system:'Read the slide.',user:'echo-head page '+page,images:[png],sessionGroup:'pages:deck'})));
  assert.deepEqual(heads.map(h=>h.full),[true,false,false,false,true],'full instructions on the first page and again after four');
  assert.equal(heads[0].tools,true,'the tool rules go with the instructions');
  assert(heads.every(h=>h.images===1),'every page still sends its own image');
  // A different instruction set in the same group (e.g. a translation request) is sent in full once.
  const other=JSON.parse(await runtime.run(settings,{system:'Translate.',user:'echo-head translation',sessionGroup:'pages:deck'}));
  assert.equal(other.full,true);
 }finally{console.log=quiet;await runtime.disconnect();}
});

// Tool use beyond the limit stops the request; it is then asked once more without tools.
test('tool use past the limit stops the request, records the tool kind, and a retry runs without tools',async()=>{
 const runtime=mockRuntime(),quiet=console.log;console.log=()=>{};
 try{
  const error=await runtime.run(settings,{user:'use-tools on this slide',toolLimitMs:300}).then(()=>null,e=>e);
  assert.equal(error?.category,'tool_timeout',String(error?.message));
  assert.match(error.message,/工具调用超过/);
  const retried=await runtime.run(settings,{user:'use-tools on this slide',noTools:true});
  assert(retried.length>0,'the request without tools completes');
  const last=acpTimings.at(-1);
  assert.equal(last.noTools,true);
  const head=JSON.parse(await runtime.run(settings,{user:'echo-head',noTools:true}));
  assert.deepEqual([head.noTools,head.tools],[true,false],'no tool rules, an explicit "no tools" instead');
  assert(acpTimings.some(t=>t.toolKinds?.search===1),'the kind of tool is recorded, not its query');
 }finally{console.log=quiet;await runtime.disconnect();}
});

test('timings record how much each request sends (numbers only), so size can be compared with waiting',async()=>{
 const runtime=mockRuntime(),quiet=console.log;console.log=()=>{};
 try{
  await runtime.run(settings,{system:'Read the slide.',user:'echo-head size',images:[png]});
  const t=acpTimings.at(-1);
  assert(t.promptChars>100,'characters sent: '+t.promptChars);
  assert(Number.isInteger(t.imageKB));
  assert.match(describeAcpTiming(t),/发送 \d+ 字符/);
 }finally{console.log=quiet;await runtime.disconnect();}
});
