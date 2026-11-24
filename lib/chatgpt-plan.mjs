import {listenSafe} from './ports.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash,createPublicKey,randomBytes,randomUUID,timingSafeEqual,verify} from 'node:crypto';
import path from 'node:path';
import {json,save} from './core.mjs';
import {serialWriter} from './concurrency.mjs';

const issuer='https://auth.openai.com';
const resource='https://api.openai.com/v1';
const publicClient='dynamic_agent_client';
const permission='chatgpt.tokens.use.direct';
const scopes='openid profile email offline_access resource.invoke '+permission;
const authError=message=>Object.assign(Error(message),{category:'configuration',providerFailure:true});
const timed=ms=>AbortSignal.timeout(ms);
const random=()=>randomBytes(32).toString('base64url');
const scopeList=value=>typeof value==='string'?value.trim().split(/\s+/).filter(Boolean):[];
const terminalRefreshCodes=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);

function windowsVault(action,bytes){
 if(process.platform!=='win32')throw authError('ChatGPT 订阅凭据存储目前仅支持 Windows。');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const method=action==='seal'?'Protect':'Unprotect';
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $outputBytes=[Security.Cryptography.ProtectedData]::${method}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($outputBytes))`;
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['-NoProfile','-NonInteractive','-Command',script],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],signal:timed(15000)});
  let output='';
  child.stdout.setEncoding('ascii');child.stdout.on('data',chunk=>output+=chunk);
  child.stdin.on('error',()=>{});
  child.on('error',()=>reject(authError('无法使用 Windows 凭据保护。')));
  child.on('close',code=>code===0&&output?resolve(Buffer.from(output,'base64')):reject(authError('无法读取或写入 Windows 加密凭据。')));
  child.stdin.end(bytes.toString('base64'));
 });
}

function sameSecret(left,right){
 if(typeof left!=='string'||typeof right!=='string')return false;
 const a=Buffer.from(left),b=Buffer.from(right);
 return a.length===b.length&&timingSafeEqual(a,b);
}

export function chatgptError(status,code){
 if(code==='subscription_sharing_usage_limit_exceeded'){
  return authError('ChatGPT 订阅额度暂不可用。请到 ChatGPT 的使用情况设置查看额度。');
 }
 if(['subscription_sharing_usage_unavailable','subscription_sharing_user_unavailable'].includes(code)){
  return Object.assign(Error('ChatGPT 暂时无法查询订阅额度，请稍后重试。'),{category:'transport',providerFailure:true});
 }
 if(code==='subscription_sharing_user_not_eligible')return authError('此 ChatGPT 账号、工作区或客户端暂不具备订阅调用资格。');
 if(code==='subscription_sharing_unsupported_capability')return authError('此 ChatGPT 模型或账号暂不支持本次请求所需的功能。请在设置中测试对应能力。');
 if(status===401)return authError('ChatGPT 登录已失效，请在设置中重新授权。');
 if(status===403)return authError('ChatGPT 拒绝此次调用。请核对账号授权和模型资格。');
 const message=status?`ChatGPT 请求失败（HTTP ${status}）。`:'ChatGPT 返回了未完成的响应。';
 return Object.assign(Error(message),{httpStatus:status,category:status===429?'rate_limit':status>=500?'transport':'chatgpt_response',providerFailure:true});
}

export function createChatGPTPlan({data,request=fetch,vault=windowsVault}){
 const hostFile=path.join(data,'.chatgpt-host.json'),recordFile=path.join(data,'.chatgpt-plan.json');
 const write=serialWriter();
 let pending=null,loginError='',loading,working=false,disconnecting=false,accountAbort=new AbortController();
 const load=()=>loading??=(async()=>{
  const value=await json(recordFile,null);
  return value?.encrypted?JSON.parse((await vault('open',Buffer.from(value.encrypted,'base64'))).toString('utf8')):null;
 })().catch(error=>{loading=undefined;throw error;});
 async function persist(record){
  const encrypted=await vault('seal',Buffer.from(JSON.stringify(record)));
  await save(recordFile,{encrypted:encrypted.toString('base64')});
  loading=Promise.resolve(record);
 }
 async function fetchJson(url,options={}){
  const response=await request(url,{...options,redirect:'error',signal:options.signal||timed(15000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok){
   const code=value.error?.code||value.error;
   throw Object.assign(chatgptError(response.status,code),{httpStatus:response.status,terminalRefresh:terminalRefreshCodes.has(code)});
  }
  return value;
 }
 const discovery=()=>fetchJson(issuer+'/.well-known/openid-configuration');
 function authUrl(value){
  const url=new URL(value);
  if(url.origin!==issuer||url.username||url.password)throw authError('OpenAI 身份服务返回了无效地址。');
  return url;
 }
 async function verifyIdentity(token,clientId,nonce){
  if(typeof token!=='string'||token.length>30000)throw authError('OpenAI 未返回可验证的身份令牌。');
  const parts=token.split('.');
  if(parts.length!==3)throw authError('OpenAI 身份令牌格式无效。');
  const [header,claims]=parts.slice(0,2).map(part=>JSON.parse(Buffer.from(part,'base64url')));
  const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!==issuer||
     !audience.includes(clientId)||(audience.length>1&&claims.azp!==clientId)||
     !Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000||
     !sameSecret(claims.nonce,nonce)||typeof claims.sub!=='string'||!claims.sub){
   throw authError('OpenAI 身份令牌校验失败，请重新授权。');
  }
  const config=await discovery(),keys=await fetchJson(authUrl(config.jwks_uri));
  const key=keys.keys?.find(item=>item.kid===header.kid&&item.kty==='RSA'&&(!item.alg||item.alg==='RS256'));
  if(!key||!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'))){
   throw authError('OpenAI 身份令牌签名校验失败。');
  }
  return {subject:claims.sub,email:typeof claims.email==='string'?claims.email:''};
 }
 const tokenRequest=values=>fetchJson(issuer+'/api/accounts/oauth/token',{
  method:'POST',body:new URLSearchParams({...values,resource}),
 });
 function tokenRecord(data,previous,initial){
  const granted=data.scope===undefined&&!initial?previous.scopes:scopeList(data.scope);
  if(!granted?.includes(permission)||!granted.includes('resource.invoke'))throw authError('未获准使用 ChatGPT 订阅额度，请重新授权。');
  if(typeof data.access_token!=='string'||!data.access_token||String(data.token_type).toLowerCase()!=='bearer'||
     !Number.isFinite(data.expires_in)||data.expires_in<=0)throw authError('OpenAI 没有返回有效的访问凭据。');
  return {...previous,scopes:granted,accessToken:data.access_token,
   refreshToken:data.refresh_token||(initial?'':previous.refreshToken),
   expiresAt:Date.now()+data.expires_in*1000};
 }
 function finish(attempt){
  clearTimeout(attempt.timer);attempt.server.close();
  if(pending===attempt)pending=null;
 }
 async function start({reconsent=false}={}){
  if(pending||working||disconnecting)throw authError('已有 ChatGPT 授权操作正在进行。');
  working=true;loginError='';
  try{
   const previous=await load();
   let host=await json(hostFile,null);
   if(!host){host={id:'urn:uuid:'+randomUUID()};await save(hostFile,host);}
   const state=random(),nonce=random(),verifier=random();
   const attempt={used:false};
   const server=http.createServer(async(req,res)=>{
    const reply=(status,message)=>{
     res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
     res.end(message);
    };
    if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${server.address()?.port}`)return reply(404,'未找到授权回调。');
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return reply(400,'无效授权回调。');}
    if(url.pathname!=='/auth/callback')return reply(404,'未找到授权回调。');
    if(attempt.used||pending!==attempt||!sameSecret(url.searchParams.get('state'),state))return reply(400,'无效或已过期的授权回调。');
    attempt.used=true;
    try{
     const issued=url.searchParams.get('client_id'),clientId=issued||previous?.clientId;
     const code=url.searchParams.get('code');
     if(url.searchParams.has('error'))throw authError('ChatGPT 授权已拒绝或取消。');
     if(!code||!clientId||clientId===publicClient||(previous?.clientId&&clientId!==previous.clientId))throw authError('ChatGPT 授权回调缺少有效的客户端注册。');
     await write(async()=>{
      if(!previous)await persist({clientId});
      const data=await tokenRequest({grant_type:'authorization_code',client_id:clientId,code,
       code_verifier:verifier,redirect_uri:attempt.redirect});
      const identity=await verifyIdentity(data.id_token,clientId,nonce);
      if(previous?.subject&&previous.subject!==identity.subject)throw authError('当前授权账号与已保存连接不同。');
      if(!scopeList(data.scope).includes(permission)||!scopeList(data.scope).includes('resource.invoke')){
       if(!previous?.accessToken)await persist({...identity,clientId,permissionDeclined:true});
       throw authError('本次登录未授予订阅额度。请在设置中选择重新授权订阅额度。');
      }
      const record=tokenRecord(data,{...identity,clientId,idToken:data.id_token},true);
      if(pending!==attempt)throw authError('本次授权已过期。');
      await persist(record);
     });
     reply(200,'ChatGPT 订阅授权成功。可以关闭此页面并返回 Classroom Local。');
    }catch(error){
     loginError=error.providerFailure?error.message:'ChatGPT 授权未完成，请返回设置重试。';
     reply(400,loginError);
    }finally{finish(attempt);}
   });
   attempt.server=server;
   // A port the browser accepts: the sign-in page redirects the browser here (lib/ports.mjs).
   await listenSafe(server);
   server.unref();
   attempt.redirect=`http://127.0.0.1:${server.address().port}/auth/callback`;
   const authorize=new URL(issuer+'/api/accounts/authorize');
   authorize.search=new URLSearchParams({client_id:previous?.clientId||publicClient,
    ...(!previous?.clientId?{agent_name_hint:'Classroom Local'}:{}),ext_agent_host_id:host.id,
    ...(previous?.email?{login_hint:previous.email}:{}),
    ...(reconsent&&previous?.clientId?{prompt:'consent'}:{}),
    response_type:'code',redirect_uri:attempt.redirect,scope:scopes,resource,state,nonce,
    code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
   pending=attempt;
   attempt.timer=setTimeout(()=>{loginError='ChatGPT 授权已超时。';finish(attempt);},300000);
   attempt.timer.unref();
   return {authorizationUrl:authorize.href};
  }finally{working=false;}
 }
 async function status(){
  const record=await load();
  return {connected:!!record?.accessToken&&(record.expiresAt>Date.now()||!!record.refreshToken),
   email:record?.email||'',pending:!!pending||working,permissionDeclined:!!record?.permissionDeclined,error:loginError};
 }
 const access=()=>write(async()=>{
  if(disconnecting)throw authError('ChatGPT 连接正在断开。');
  const record=await load();
  if(!record?.accessToken||!record.scopes?.includes(permission))throw authError('请先在 AI 模型设置中授权使用 ChatGPT 订阅。');
  if(record.expiresAt>Date.now()+30000)return record.accessToken;
  if(!record.refreshToken)throw authError('ChatGPT 登录已过期，请重新授权。');
  try{
   const response=await tokenRequest({grant_type:'refresh_token',client_id:record.clientId,refresh_token:record.refreshToken});
   const next=tokenRecord(response,record,false);await persist(next);return next.accessToken;
  }catch(error){
   if(error.terminalRefresh){await persist({clientId:record.clientId,subject:record.subject,email:record.email});throw authError('ChatGPT 登录已过期，请重新授权。');}
   throw error;
  }
 });
 async function disconnect(){
  if(disconnecting||working||pending?.used)throw authError('请等待正在进行的授权操作完成。');
  disconnecting=true;
  if(pending)finish(pending);
  accountAbort.abort();accountAbort=new AbortController();
  return write(async()=>{
   const record=await load();let revoked=true;
   if(record?.refreshToken){
    try{
     const config=await discovery();
     const response=await request(authUrl(config.revocation_endpoint),{method:'POST',redirect:'error',signal:timed(8000),
      body:new URLSearchParams({token:record.refreshToken,token_type_hint:'refresh_token',client_id:record.clientId})});
     revoked=response.ok;
    }catch{revoked=false;}
   }
   if(record)await persist({clientId:record.clientId,subject:record.subject,email:record.email});
   loginError='';return {connected:false,revoked};
  }).finally(()=>{disconnecting=false;});
 }
/** Thinking levels a ChatGPT model lists (when the model list gives them). */
 function reasoningLevels(item){
  const list=Array.isArray(item.supported_reasoning_levels)?item.supported_reasoning_levels:Array.isArray(item.supported_reasoning_efforts)?item.supported_reasoning_efforts:[];
  const thinking=list.map(l=>typeof l==='string'?l:l?.effort).filter(v=>typeof v==='string'&&/^[\w-]{1,40}$/.test(v));
  const fallback=item.default_reasoning_level??item.default_reasoning_effort;
  return thinking.length?{thinking,...(typeof fallback==='string'?{defaultThinking:fallback}:{})}:{};
 }
 async function models(){
  const value=await fetchJson(resource+'/models',{headers:{Authorization:'Bearer '+await access()}});
  return {models:(value.models||[]).filter(item=>item.visibility==='list'&&typeof item.slug==='string')
   .map(item=>({modelId:item.slug,name:typeof item.display_name==='string'?item.display_name:item.slug,...reasoningLevels(item)}))};
 }
 async function respond(body,{signal,onRequest}={}){
  const abort=AbortSignal.any([accountAbort.signal,timed(600000),...(signal?[signal]:[])]);
  const token=await access();abort.throwIfAborted();
  await onRequest?.();
  return request(resource+'/responses',{method:'POST',redirect:'error',signal:abort,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(body)});
 }
 return {start,status,disconnect,models,respond};
}
