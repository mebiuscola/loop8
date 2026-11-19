import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pipeline} from '../lib/pipeline.mjs';
const settings={model:'fixture',baseUrl:'http://localhost/v1',maxOutputTokens:12000,apiKey:'private-test-key'};
const validate=value=>{if(typeof value?.chinese!=='string'||!value.chinese.trim())throw Error('missing chinese');};
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-pipeline-'));try{await fn(dir);}finally{const relative=path.relative(os.tmpdir(),dir);if(relative&&!relative.startsWith('..'))await rm(dir,{recursive:true,force:true});}}
test('invalid JSON is regenerated, then the valid result resumes without further model calls',()=>fixture(async dir=>{
 let calls=0;const model=await pipeline(dir,settings,{call:async(s,system,user)=>{calls++;assert(user.startsWith('original evidence'));return calls===1?'{"chinese":"他说"概念"。"}':' \n```json\n{"chinese":"他说“概念”。"}\n``` ';}});
 const output=await model.object('translation 1','rules','original evidence',validate);assert.equal(output.chinese,'他说“概念”。');assert.equal(calls,2);
 const resumed=await pipeline(dir,settings,{call:async()=>{throw Error('must not call');}});assert.deepEqual(await resumed.object('translation 1','rules','original evidence',validate),output);
 const disk=await readFile(path.join(dir,'Parsed','.pipeline.json'),'utf8');assert(!disk.includes(settings.apiKey));
}));
test('repeated schema/JSON failures stop after 3 tries, save redacted evidence, and preserve earlier steps',()=>fixture(async dir=>{
 let calls=0;const model=await pipeline(dir,settings,{call:async()=>{calls++;return calls===1?'completed material notes':'{"chinese":"private-test-key "bad quotes"}';}});
 await model.text('notes','rules','material');await assert.rejects(()=>model.object('translation 2','rules','original',validate),/连续 3 次/);assert.equal(calls,4);
 const failure=JSON.parse(await readFile(path.join(dir,'Parsed','.last_model_failure.json'),'utf8'));assert.equal(failure.stage,'translation 2');assert(!failure.response.includes(settings.apiKey));
 const resumed=await pipeline(dir,settings,{call:async()=>'{"chinese":"恢复完成"}'});assert.equal(await resumed.text('notes','rules','material'),'completed material notes');assert.equal((await resumed.object('translation 2','rules','original',validate)).chinese,'恢复完成');
}));
test('prompt changes invalidate cached steps; provider/network errors are not retried as JSON errors',()=>fixture(async dir=>{
 let calls=0;const model=await pipeline(dir,settings,{call:async()=>{calls++;return '{"chinese":"文字"}';}});await model.object('translation','rules1','original',validate);await model.object('translation','rules2','original',validate);assert.equal(calls,2);
 const failing=await pipeline(dir,settings,{call:async()=>{calls++;throw Error('HTTP 401');}});await assert.rejects(()=>failing.object('translation','rules3','original',validate),/401/);assert.equal(calls,3);
}));
