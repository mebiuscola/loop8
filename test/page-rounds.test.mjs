import test from 'node:test';
import assert from 'node:assert/strict';
import {runPageRounds,failureKind} from '../lib/page-rounds.mjs';
import {adaptiveQueue} from '../lib/ai-material.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const settings={model:'gemini',baseUrl:'http://primary',apiKey:'secret',maxOutputTokens:10000};
const backup={...settings,model:'claude',baseUrl:'http://backup'};
const value=i=>({page:i+1,status:'complete',blocks:[],uncertainties:[]});
function recitation(){const e=Error('RECITATION');e.finishReason='recitation';return e;}

test('round barriers, global request cap, failed-only fallback, persistent budgets, and changed model preserve successful pages',async()=>{
 let task={total:4,pages:[]},saved,active=0,peak=0;const calls=[],queue=adaptiveQueue(2);
 const run=()=>runPageRounds({checkpoint:task,primary:settings,fallback:backup,autoFallback:true,prompt:'rules',ppt:false,queue,limit:2,signal:new AbortController().signal,persist:async()=>{saved=structuredClone(task);},notify:async()=>{},request:async(i,s,{attempt})=>{active++;peak=Math.max(peak,active);calls.push([i,attempt.round]);await sleep(5);active--;if(i===3||i===2&&s.model!=='claude'||i===1&&attempt.round==='initial')throw recitation();return value(i);}});
 const result=await run();assert.equal(peak,2);assert.deepEqual(result.missing,[4]);assert.deepEqual(calls,[[0,'initial'],[1,'initial'],[2,'initial'],[3,'initial'],[1,'retry'],[2,'retry'],[3,'retry'],[2,'fallback'],[3,'fallback']]);assert.equal(task.provenance[0].model,'gemini');assert.equal(task.provenance[2].model,'claude');assert.equal(task.attempts[3].length,3);
 task=structuredClone(saved);const n=calls.length;await run();assert.equal(calls.length,n,'restart must not reset exhausted attempt slots');
 const completed=structuredClone(task.pages);await runPageRounds({checkpoint:task,primary:{...settings,model:'different-primary'},fallback:{...backup,model:'new-backup'},autoFallback:true,prompt:'changed rules',ppt:false,queue,limit:2,signal:new AbortController().signal,persist:async()=>{},notify:async()=>{},request:async(i)=>{assert.equal(i,3);return value(i);}});for(let i=0;i<3;i++)assert.deepEqual(task.pages[i],completed[i]);
});

test('review failure retains usable partial result and transport retry does not become an additional OCR round',async()=>{
 // Only unreadable pages are re-checked; a page that was read but carries doubts is left alone (lib/doubts.mjs).
 const doubtful={total:1,pages:[{page:1,status:'partial',uncertainties:['small text']}]};let asked=0;
 await runPageRounds({checkpoint:doubtful,primary:settings,fallback:backup,autoFallback:true,review:true,prompt:'rules',ppt:false,queue:adaptiveQueue(2),signal:new AbortController().signal,persist:async()=>{},notify:async()=>{},request:async()=>{asked++;return value(0);}});
 assert.equal(asked,0,'doubts alone do not trigger another model call');
 const partial={page:1,status:'unreadable',uncertainties:['page image unreadable']},task={total:1,pages:[partial]};
 await runPageRounds({checkpoint:task,primary:settings,fallback:backup,autoFallback:true,review:true,prompt:'rules',ppt:false,queue:adaptiveQueue(2),signal:new AbortController().signal,persist:async()=>{},notify:async()=>{},request:async()=>{throw recitation();}});assert.deepEqual(task.pages[0],partial);assert.equal(task.attempts[0].length,1);
 const network={total:1,pages:[]};let attempts=0,limited=0;
 await runPageRounds({checkpoint:network,primary:settings,autoFallback:false,prompt:'rules',ppt:false,queue:{run:fn=>fn(),limited:()=>limited++},signal:new AbortController().signal,persist:async()=>{},notify:async()=>{},backoff:async()=>{},request:async()=>{if(!attempts++){const e=Error('rate limit');e.httpStatus=429;throw e;}return value(0);}});assert.equal(limited,1);assert.equal(network.attempts[0].length,1);assert.equal(network.attempts[0][0].transportAttempts,2);
 assert.equal(failureKind(recitation()),'recitation');const e=Error('bad key');e.httpStatus=401;assert.equal(failureKind(e),'configuration');
});

test('credential errors pause the affected route rather than retrying every remaining page; fallback can still complete them',async()=>{
 const task={total:5,pages:[]},calls=[];
 const result=await runPageRounds({checkpoint:task,primary:settings,fallback:backup,autoFallback:true,prompt:'rules',ppt:false,queue:adaptiveQueue(2),limit:2,signal:new AbortController().signal,persist:async()=>{},notify:async()=>{},request:async(i,s,{attempt})=>{calls.push({i,model:s.model,round:attempt.round});if(s.model==='gemini'){const e=Error('invalid key');e.httpStatus=401;throw e;}return value(i);}});
 assert(calls.filter(c=>c.model==='gemini').length<=2);assert.equal(calls.filter(c=>c.round==='retry').length,0);assert.equal(calls.filter(c=>c.model==='claude').length,5);assert.deepEqual(result.missing,[]);
});
