import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {mergeModelProfiles,shareConnection,connectionOf,validateModelRouting,resolveModel,publicProfiles} from '../lib/model-routing.mjs';

const base={provider:'api',baseUrl:'https://api.example.com/v1',outputTokenField:'max_tokens',contextChars:180000,maxOutputTokens:12000};

test('models of one API connection share its address, name and key; each stays its own model',()=>{
 const saved={modelProfiles:[{...base,id:'ds',name:'DeepSeek',model:'deepseek-chat',apiKey:'k-1'}]};
 // A model added to the connection without a key uses the connection's saved key.
 const added=mergeModelProfiles(saved,{modelProfiles:[...saved.modelProfiles,{...base,id:'ds-r',connectionId:'ds',name:'DeepSeek',model:'deepseek-reasoner'}]});
 assert.equal(added[1].apiKey,'k-1');
 assert.equal(connectionOf(added[0]),'ds');assert.equal(connectionOf(added[1]),'ds');
 // Changing the address or name on one model applies to the other; the key only when it was changed.
 const edited={...added[0],baseUrl:'https://api.deepseek.com/v1',name:'DeepSeek 官方'};
 let shared=shareConnection([edited,added[1]],edited,{baseUrl:edited.baseUrl});
 assert.equal(shared[1].baseUrl,'https://api.deepseek.com/v1');assert.equal(shared[1].name,'DeepSeek 官方');assert.equal(shared[1].model,'deepseek-reasoner');assert.equal(shared[1].apiKey,'k-1');
 shared=shareConnection([{...edited,apiKey:'k-2'},shared[1]],{...edited,apiKey:'k-2'},{apiKey:'k-2'});
 assert.equal(shared[1].apiKey,'k-2');
 // Other connections are untouched.
 const other={...base,id:'oa',name:'OpenAI',model:'gpt',apiKey:'k-o'};
 assert.deepEqual(shareConnection([edited,other],edited,{apiKey:'x'})[1],other);
 // Each model is routed on its own.
 const s={modelRoutingVersion:2,modelProfiles:shared,modelRoutes:{qa:'ds-r',deepDive:'ds'},defaultProfileId:'ds',fallbackProfileId:''};
 validateModelRouting(s);
 assert.equal(resolveModel(s,'qa').model,'deepseek-reasoner');assert.equal(resolveModel(s,'deepDive').model,'deepseek-chat');
 assert.equal(resolveModel(s,'qa').apiKey,'k-2');
 assert.throws(()=>validateModelRouting({...s,modelProfiles:[{...shared[0],connectionId:'bad id!'}]}),/API 连接编号无效/);
});

test('a model saved without its own key (by an older server) uses its connection key',()=>{
 const s={modelRoutingVersion:2,modelProfiles:[{...base,id:'ds',name:'DeepSeek',model:'deepseek-chat',apiKey:'k-1'},{...base,id:'ds-r',connectionId:'ds',name:'DeepSeek',model:'deepseek-reasoner',apiKey:''}],modelRoutes:{qa:'ds-r'},defaultProfileId:'ds',fallbackProfileId:''};
 assert.equal(resolveModel(s,'qa').apiKey,'k-1','used for tasks and tests');
 assert.equal(publicProfiles(s).find(p=>p.id==='ds-r').hasApiKey,true,'the settings page does not report a missing key');
 assert.equal(publicProfiles(s).find(p=>p.id==='ds-r').apiKey,undefined);
 // A model of another connection never borrows a key.
 assert.equal(resolveModel({...s,modelProfiles:[...s.modelProfiles,{...base,id:'x',name:'X',model:'m',apiKey:''}],modelRoutes:{qa:'x'}},'qa').apiKey,'');
});

test('the settings page saves a second model on a connection and deletes the whole connection',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-multi-model-'));let child;
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:dir,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  for(let i=0;i<150&&!log.includes('http://');i++)await sleep(30);
  const host=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(host,log);
  const save=async body=>{const r=await fetch(host+'/api/settings/editor',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();assert(r.ok,JSON.stringify(d));return d;};
  await save({section:'model',profile:{...base,id:'ds',name:'DeepSeek',model:'deepseek-chat',apiKey:'secret-key'}});
  let s=await save({section:'model',profile:{...base,id:'ds-r',connectionId:'ds',name:'DeepSeek',model:'deepseek-reasoner'}});
  const second=s.modelProfiles.find(p=>p.id==='ds-r');
  assert.equal(second.hasApiKey,true,'the new model uses the connection key');assert.equal(second.apiKey,undefined,'keys are never returned');
  s=await save({section:'model',profile:{...base,id:'ds',name:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat'}});
  assert.equal(s.modelProfiles.find(p=>p.id==='ds-r').baseUrl,'https://api.deepseek.com/v1','the address follows the connection');
  const stored=JSON.parse(await readFile(path.join(dir,'settings.json'),'utf8'));
  assert.equal(stored.modelProfiles.find(p=>p.id==='ds-r').apiKey,'secret-key');
  await save({section:'routes',modelRoutes:{...s.modelRoutes,qa:'ds-r',deepDive:'ds'}});
  await save({section:'model',profile:{...base,id:'other',name:'Other',model:'m',apiKey:'k'}});
  s=await save({section:'delete-connection',connectionId:'ds'});
  assert.deepEqual(s.modelProfiles.map(p=>p.id),['other'],'every model of the connection is removed, others stay');
  assert.equal(s.modelRoutes.qa,'');assert.equal(s.modelRoutes.deepDive,'');
 }finally{child?.kill();if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:50});}
});
