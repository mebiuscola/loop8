import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {quickMineruCheck,curlHead,nodeHead} from '../lib/connectivity.mjs';
const settings={mineruMode:'cloud',mineruToken:'test-key'};
const signal=()=>AbortSignal.timeout(5000);
test('quick check accepts expected missing task, probes OSS separately, sends no upload and marks limits',async()=>{
 const messages=[];let apiCalls=0,headCalls=0;
 const answer=await quickMineruCheck(settings,async s=>messages.push(s),signal(),{fetch:async(url,options)=>{apiCalls++;assert(url.endsWith('/_test'));assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer test-key');return Response.json({code:-60012,msg:'task not found'},{status:404});},headTransports:[async(url,opts)=>{headCalls++;assert.equal(opts.headers,undefined);return {status:403,transport:'fixture'};}]});
 assert.equal(apiCalls,1);assert.equal(headCalls,1);assert.match(answer,/无签名探测/);assert.match(answer,/尚未验证/);assert(messages.some(s=>s.startsWith('1/2 ✓')));
});
test('quick check rejects invalid keys, HTTP failures, HTML and business errors before probing OSS',async()=>{
 for(const response of [Response.json({code:'A0202'}),Response.json({code:0},{status:401}),Response.json({code:-1},{status:503}),new Response('<html>login</html>'),Response.json({code:-60018,msg:'daily quota exceeded'}),Response.json({code:-1,msg:'Service not found'})]){
  let probes=0;await assert.rejects(()=>quickMineruCheck(settings,async()=>{},signal(),{fetch:async()=>response,headTransports:[async()=>{probes++;return {status:200};}]}));assert.equal(probes,0);
 }
});
test('quick check falls back for network faults and reports API success separately if both OSS probes fail',async()=>{
 const fetch=async()=>Response.json({code:0});let second=0;
 const answer=await quickMineruCheck(settings,async()=>{},signal(),{fetch,headTransports:[async()=>{throw Error('TLS error');},async()=>{second++;return {status:403,transport:'Node.js'};}]});assert.equal(second,1);assert.match(answer,/Node.js/);
 await assert.rejects(()=>quickMineruCheck(settings,async()=>{},signal(),{fetch,headTransports:[async()=>{throw Error('DNS error');},async()=>({status:503})]}),/API 已响应，但 OSS/);
 await assert.rejects(()=>quickMineruCheck({...settings,mineruMode:'cli'},async()=>{},signal()),/CLI/);
});
for(const method of [curlHead,nodeHead])test(`${method.name} observes unsigned OSS-like 403 without credentials or uploads`,async()=>{
 const server=http.createServer((req,res)=>{assert.equal(req.method,'HEAD');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['content-length'],undefined);res.writeHead(403);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const result=await method(`http://127.0.0.1:${server.address().port}/`,{signal:signal(),allowHttp:true});assert.equal(result.status,403);}finally{await new Promise(r=>server.close(r));}
});
