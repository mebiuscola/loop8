import test from 'node:test';
import assert from 'node:assert/strict';
import {testConnection,diagnosticError,validateVisionResponse} from '../lib/diagnostics.mjs';
test('vision checks recognition separately from JSON formatting and retains a safe failure excerpt',()=>{
 assert.match(validateVisionResponse('Books 7, Notes 4'),/图片识别通过/);
 assert.match(validateVisionResponse('Books 7, Notes 4.'),/JSON 输出请单独测试/);
 assert.match(validateVisionResponse('```json\n{"books":7,"notes":4}\n```'),/JSON 格式也正确/);
 assert.throws(()=>validateVisionResponse('{"code":"WRONG"}'),/图片识别测试未通过/);
 assert.throws(()=>validateVisionResponse('null'),/回复样例「null」/);
 assert.throws(()=>validateVisionResponse('I cannot see the image. API_SECRET https://example.test?token=secret',{apiKey:'API_SECRET'}),error=>
  /cannot see the image/.test(error.message)&&!error.message.includes('API_SECRET')&&!error.message.includes('token=secret'));
});
test('diagnostic abort and error messages never echo credentials or signed links',async()=>{
 const signal=AbortSignal.abort();await assert.rejects(()=>testConnection('ai',{},async()=>{},signal));
 assert.match(diagnosticError(Error('failure'),signal,{}),/等待上限/);
 const e=Error('fetch failed');e.cause={code:'ENOTFOUND'};assert.match(diagnosticError(e,new AbortController().signal,{}),/ENOTFOUND/);
 const safe=diagnosticError(Error('secret-key https://storage.example?token=abc'),new AbortController().signal,{apiKey:'secret-key'});assert(!safe.includes('secret-key'));assert(!safe.includes('token=abc'));
});
