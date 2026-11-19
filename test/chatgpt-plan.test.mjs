import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createChatGPTPlan} from '../lib/chatgpt-plan.mjs';
import {completeChatGPT,readChatGPTStream} from '../lib/chatgpt-responses.mjs';
import {resolveModel,validateModelRouting} from '../lib/model-routing.mjs';

const issuer='https://auth.openai.com';
const resource='https://api.openai.com/v1';
const clientId='oaiapp_fixture';
const frame=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
function stream(...chunks){
 return new Response(new ReadableStream({start(controller){
  for(const chunk of chunks)controller.enqueue(Buffer.from(chunk));
  controller.close();
 }}),{headers:{'content-type':'text/event-stream'}});
}

test('ChatGPT plan OAuth validates the callback, refreshes once and revokes persisted Windows credentials',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-siwc-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const key={...publicKey.export({format:'jwk'}),kid:'fixture'};
 let authorization,exchanges=0,refreshes=0,revocations=0;
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const fakeRequest=async(input,options)=>{
  const url=String(input);
  assert.equal(options.redirect,'error');
  if(url===issuer+'/api/accounts/oauth/token'){
   const body=options.body;
   assert.equal(body.get('resource'),resource);
   assert.equal(body.get('client_id'),clientId);
   assert.equal(body.has('client_secret'),false);
   if(body.get('grant_type')==='refresh_token'){
    refreshes++;
    assert.equal(body.get('refresh_token'),'fixture-refresh');
    return Response.json({access_token:'fixture-renewed',refresh_token:'fixture-rotated',token_type:'Bearer',expires_in:3600});
   }
   exchanges++;
   assert.equal(body.get('grant_type'),'authorization_code');
   assert.equal(body.get('code'),'fixture-code');
   assert.equal(body.get('redirect_uri'),authorization.get('redirect_uri'));
   assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),authorization.get('code_challenge'));
   const jwt=encode({alg:'RS256',kid:key.kid})+'.'+encode({iss:issuer,aud:clientId,nonce:authorization.get('nonce'),
    sub:'fixture-user',email:'fixture@example.test',exp:Date.now()/1000+3600});
   return Response.json({id_token:jwt+'.'+sign('RSA-SHA256',Buffer.from(jwt),privateKey).toString('base64url'),
    access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:10,scope:authorization.get('scope')});
  }
  if(url===issuer+'/.well-known/openid-configuration')return Response.json({jwks_uri:issuer+'/keys',revocation_endpoint:issuer+'/revoke'});
  if(url===issuer+'/keys')return Response.json({keys:[key]});
  if(url===issuer+'/revoke'){
   revocations++;
   assert.equal(options.body.get('token'),'fixture-rotated');
   return new Response(null,{status:200});
  }
  assert.equal(url,resource+'/models');
  assert.equal(options.headers.Authorization,'Bearer fixture-renewed');
  return Response.json({models:[{visibility:'list',slug:'model-fixture',display_name:'Fixture Model'},{visibility:'hidden',slug:'hidden'}]});
 };
 const config={data:dir,request:fakeRequest,
  ...(process.platform==='win32'?{}:{vault:async(_,bytes)=>Buffer.from(bytes.map(byte=>byte^187))})};
 const plan=createChatGPTPlan(config);
 const auth=new URL((await plan.start()).authorizationUrl);
 authorization=auth.searchParams;
 assert.equal(auth.origin+auth.pathname,issuer+'/api/accounts/authorize');
 assert.equal(authorization.get('client_id'),'dynamic_agent_client');
 assert.equal(authorization.get('code_challenge_method'),'S256');
 assert.match(authorization.get('scope'),/chatgpt\.tokens\.use\.direct/);
 const callback=new URL(authorization.get('redirect_uri'));
 assert.equal(callback.hostname,'127.0.0.1');
 assert.equal(callback.pathname,'/auth/callback');
 callback.search=new URLSearchParams({state:'wrong',code:'fixture-code',client_id:clientId});
 assert.equal((await fetch(callback)).status,400);
 assert.equal(exchanges,0);
 callback.searchParams.set('state',authorization.get('state'));
 const accepted=await fetch(callback);
 assert.equal(accepted.status,200,await accepted.text());
 assert.deepEqual(await plan.status(),{connected:true,email:'fixture@example.test',pending:false,permissionDeclined:false,error:''});
 assert.doesNotMatch(await readFile(path.join(dir,'.chatgpt-plan.json'),'utf8'),/fixture-access|fixture-refresh/);
 const catalog={models:[{modelId:'model-fixture',name:'Fixture Model'}]};
 assert.deepEqual(await Promise.all([plan.models(),plan.models()]),[catalog,catalog]);
 assert.equal(refreshes,1);
 const restarted=createChatGPTPlan(config);
 assert.deepEqual(await restarted.models(),catalog);
 assert.deepEqual(await restarted.disconnect(),{connected:false,revoked:true});
 assert.equal(revocations,1);
 assert.equal((await createChatGPTPlan(config).status()).connected,false);
 const returning=new URL((await restarted.start()).authorizationUrl);
 assert.equal(returning.searchParams.get('client_id'),clientId);
 assert.equal(returning.searchParams.get('ext_agent_host_id'),authorization.get('ext_agent_host_id'));
 assert.equal(returning.searchParams.has('agent_name_hint'),false);
 await restarted.disconnect();
});

test('ChatGPT Responses sends the allowed request fields and accepts only completed streams',async()=>{
 let requested;
 const partial=[];
 const delta=frame({type:'response.output_text.delta',delta:'双语'});
 const done=frame({type:'response.completed',response:{status:'completed'}});
 const plan={respond:async body=>{requested=body;return stream(delta.slice(0,14),delta.slice(14),done);}};
 const image='data:image/png;base64,AAAA';
 const result=await completeChatGPT(plan,{model:'fixture'},'Analyze','Page text',{images:[image],json:true,onText:value=>partial.push(value)});
 assert.equal(result,'双语');
 assert.deepEqual(partial,['双语']);
 assert.equal(requested.store,false);
 assert.equal(requested.stream,true);
 assert.deepEqual(requested.text,{format:{type:'json_object'}});
 assert.deepEqual(requested.input[0].content[1],{type:'input_image',image_url:image,detail:'auto'});
 assert(requested.input[0].content.some(part=>part.type==='input_text'&&/\bjson\b/i.test(part.text)));
 for(const field of ['temperature','max_output_tokens','background','previous_response_id','tools'])assert.equal(field in requested,false);
 await assert.rejects(readChatGPTStream(stream(delta)),/未收到完成事件/);
 await assert.rejects(readChatGPTStream(stream(delta,frame({type:'response.incomplete',response:{incomplete_details:{reason:'content_filter'}}}))),{category:'blocked'});
 await assert.rejects(readChatGPTStream(stream(frame({type:'response.refusal.delta',delta:'No'}),done)),{category:'blocked'});
 await assert.rejects(readChatGPTStream(Response.json({error:{code:'subscription_sharing_user_not_eligible'}},{status:403})),/资格/);
 const sse=delta+done;
 assert.equal(await readChatGPTStream(new Response(sse,{headers:{'Content-Type':'Text/Event-Stream; charset=UTF-8'}})),'双语');
 const untyped=body=>new Response(Buffer.from(body),{headers:{'x-oai-request-id':'req_oai_fixture'}});
 assert.equal(await readChatGPTStream(untyped(': keep-alive\r\n\r\n'+sse)),'双语');
 await assert.rejects(readChatGPTStream(untyped(delta)),/未收到完成事件.*req_oai_fixture/);
 await assert.rejects(readChatGPTStream(untyped('<html>untrusted page</html>\n\n'+sse)),/正文不符合 SSE 格式/);
 await assert.rejects(readChatGPTStream(untyped(frame({type:'other.event'})+sse)),/不含有效的 Responses 事件/);
 await assert.rejects(readChatGPTStream(untyped('{"status":"completed","output":[]}')),/未收到有效的 Responses 事件/);
 await assert.rejects(readChatGPTStream(new Response(null,{status:204})),/空响应.*204/);
 await assert.rejects(readChatGPTStream(new Response('<html>private data</html>',{headers:{'content-type':'text/html','x-request-id':'req_fixture'}})),
  error=>error.details.media==='text/html'&&/请求 ID req_fixture/.test(error.message)&&!/private data/.test(error.message));
 await assert.rejects(readChatGPTStream(Response.json({object:'response'})),/非流式 JSON/);
 await assert.rejects(readChatGPTStream(Response.json({error:{code:'subscription_sharing_unsupported_capability',param:'text.format'}},{status:400})),/400.*subscription_sharing_unsupported_capability.*text\.format/);
});

test('ChatGPT plan can be the global default and per-task overrides still win',()=>{
 const settings={modelRoutingVersion:2,modelProfiles:[{id:'gpt',name:'GPT',provider:'chatgpt-plan',model:'fixture'}],modelRoutes:{qa:'gpt',pptPreview:'gpt'}};
 assert.doesNotThrow(()=>validateModelRouting(settings));
 assert.equal(resolveModel(settings,'pptPreview').provider,'chatgpt-plan');
 const defaulted={...settings,defaultProfileId:'gpt'};
 assert.doesNotThrow(()=>validateModelRouting(defaulted));
 for(const task of ['pptRecognition','classroom','weeklyDeepDive','referenceTranslation'])assert.equal(resolveModel(defaulted,task).provider,'chatgpt-plan');
 const overridden={...defaulted,modelProfiles:[...settings.modelProfiles,{id:'api',name:'API',provider:'api',model:'other',baseUrl:'https://example.test',apiKey:'fixture'}],modelRoutes:{classroom:'api'}};
 assert.doesNotThrow(()=>validateModelRouting(overridden));
 assert.equal(resolveModel(overridden,'classroom').provider,'api');
 assert.equal(resolveModel(overridden,'pptPreview').model,'fixture');
});
