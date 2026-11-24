import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {resolveModel,thinkingFor,modelIdentity,validateModelRouting} from '../lib/model-routing.mjs';
import {complete} from '../lib/adapters.mjs';
import {completeChatGPT} from '../lib/chatgpt-responses.mjs';
import {listenSafe} from '../lib/ports.mjs';

const api={id:'api',name:'API',provider:'api',baseUrl:'https://example.test/v1',model:'m',apiKey:'k'};
const gpt={id:'gpt',name:'GPT',provider:'chatgpt-plan',model:'gpt-fixture'};
const acp={id:'acp',name:'AG',provider:'antigravity-acp',model:'gemini-fixture',acpThinking:'high'};
const base={modelRoutingVersion:2,modelProfiles:[api,gpt,acp],defaultProfileId:'api'};

test('each function has its own thinking level, sent in the form of its model kind',()=>{
 const s={...base,modelRoutes:{pptRecognition:'acp',qa:'gpt'},modelThinking:{pptRecognition:'low',qa:'medium',classroom:'high'}};
 assert.equal(resolveModel(s,'pptRecognition').acpThinking,'low','Antigravity: replaces the connection level');
 assert.equal(resolveModel(s,'qa').reasoningEffort,'medium','ChatGPT');
 assert.equal(resolveModel(s,'classroom').reasoningEffort,'high','API on the default model');
 assert.equal(resolveModel(s,'deepDive').reasoningEffort,undefined,'no level: nothing is sent');
 assert.equal(resolveModel({...s,modelThinking:{}},'pptRecognition').acpThinking,'high','no level: the connection’s own');
});

test('a function that follows another takes its thinking level unless it has its own',()=>{
 const s={...base,modelRoutes:{pptRecognition:'acp'},modelThinking:{pptRecognition:'high',_default:'low'}};
 assert.equal(thinkingFor(s,'deckReview'),'high','follows courseware recognition');
 assert.equal(resolveModel({...s,modelThinking:{...s.modelThinking,deckReview:'low'}},'deckReview').acpThinking,'low','its own level, same model');
 assert.equal(thinkingFor(s,'qa'),'low','functions on the default model take the default level');
 assert.equal(thinkingFor({...s,modelRoutes:{...s.modelRoutes,qa:'api'}},'qa'),'','a function with its own model does not take the default level');
});

test('model identity stays the same when no thinking level is set, and changes with one',()=>{
 const plain=resolveModel({...base,modelRoutes:{}},'qa');
 assert.equal(modelIdentity(plain),modelIdentity({...plain,reasoningEffort:undefined}));
 assert.notEqual(modelIdentity(plain),modelIdentity({...plain,reasoningEffort:'low'}));
});

test('thinking settings are checked',()=>{
 assert.doesNotThrow(()=>validateModelRouting({...base,modelProfiles:[api,gpt],modelRoutes:{},modelThinking:{qa:'low',_default:''}}));
 assert.throws(()=>validateModelRouting({...base,modelProfiles:[api,gpt],modelRoutes:{},modelThinking:{nope:'low'}}),/思考强度/);
 assert.throws(()=>validateModelRouting({...base,modelProfiles:[api,gpt],modelRoutes:{},modelThinking:{qa:'a b'}}),/思考强度/);
});

test('API requests carry reasoning_effort and ChatGPT requests reasoning.effort only when a level is set',async()=>{
 const bodies=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;bodies.push(JSON.parse(raw));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));});
 await listenSafe(server);
 try{
  const settings={provider:'api',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'m',apiKey:'k',contextChars:10000,maxOutputTokens:100};
  await complete({...settings,reasoningEffort:'low'},'s','u',{});await complete(settings,'s','u',{});
  assert.equal(bodies[0].reasoning_effort,'low');assert.equal('reasoning_effort' in bodies[1],false);
 }finally{await new Promise(r=>server.close(r));}
 const sent=[],event=v=>'data: '+JSON.stringify(v)+'\n\n';
 const plan={respond:async body=>{sent.push(body);return new Response(event({type:'response.output_text.delta',delta:'ok'})+event({type:'response.completed',response:{status:'completed'}}),{headers:{'content-type':'text/event-stream'}});}};
 await completeChatGPT(plan,{model:'gpt',reasoningEffort:'high'},'i','t');await completeChatGPT(plan,{model:'gpt'},'i','t');
 assert.deepEqual(sent[0].reasoning,{effort:'high'});assert.equal('reasoning' in sent[1],false);
});
