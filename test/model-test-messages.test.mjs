import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {complete} from '../lib/adapters.mjs';
import {diagnosticError,MODEL_TEST_SECONDS} from '../lib/diagnostics.mjs';
import {listenSafe} from '../lib/ports.mjs';

test('an API error keeps the reason the service gave, without the key or address',async()=>{
 // Gemini's OpenAI-compatible endpoint answers an overloaded model like this.
 const server=http.createServer((req,res)=>{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify([{error:{code:503,message:'The model is overloaded. Please try again later. key=secret-key-123 see https://ai.google.dev/x',status:'UNAVAILABLE'}}]));});
 const port=await listenSafe(server);
 try{
  const settings={provider:'api',baseUrl:`http://127.0.0.1:${port}/v1`,apiKey:'secret-key-123',model:'gemini-4-carbon',contextChars:100000,maxOutputTokens:1024};
  const error=await complete(settings,'system','Return exactly {"status":"ok"}.').then(()=>null,e=>e);
  assert.equal(error.httpStatus,503);
  assert.match(error.message,/HTTP 503（服务方说明：UNAVAILABLE: The model is overloaded/);
  assert.doesNotMatch(error.message,/secret-key-123|ai\.google\.dev/);
  assert.match(error.message,/服务方暂时不可用或模型过载（不是设置错误）/);assert.doesNotMatch(error.message,/请检查接口/);
 }finally{await new Promise(r=>server.close(r));}
});

test('a model test that runs out of time says so, and does not mention MinerU',()=>{
 const stopped=AbortSignal.abort();
 const model=diagnosticError(Error('aborted'),stopped,{},'model');
 assert.match(model,new RegExp(`等待 ${MODEL_TEST_SECONDS} 秒仍没有收到回复`));
 assert.doesNotMatch(model,/MinerU/);
 assert.match(diagnosticError(Error('aborted'),stopped,{}),/MinerU/,'MinerU tests keep their own message');
 assert(MODEL_TEST_SECONDS>=120,'slow models get at least two minutes');
});
