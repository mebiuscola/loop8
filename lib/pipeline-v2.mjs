import {createHash} from 'node:crypto';
import path from 'node:path';
import {json,save,parseJson} from './core.mjs';
import {serialWriter} from './concurrency.mjs';
import {complete} from './adapters.mjs';
import {failureKind} from './page-rounds.mjs';
import {modelIdentity} from './model-routing.mjs';
export async function pipeline(dir,settings,{fresh=false,scope='legacy',onStatus=async()=>{},call=complete,backoff=ms=>new Promise(r=>setTimeout(r,ms)),signal}={}){
 const file=path.join(dir,'Parsed','.pipeline.json'),cached=await json(file,{version:1,entries:{}});
 if(cached.version!==1||!cached.entries)throw Error('课程检查点格式无效，请保留文件并检查。');cached.drafts??={};cached.failures??={};
 const write=serialWriter(),inflight=new Map(),touched=new Set(),scopes=new Set(),persist=()=>{const value=structuredClone(cached);return write(()=>save(file,value));};
 const owners=e=>e.owners||(e.scope?[{scope:e.scope,slot:e.slot}]:[]),attach=(e,loc)=>{const values=owners(e);e.owners=[...values.filter(v=>v.scope!==loc.scope||v.slot!==loc.slot),loc];Object.assign(e,loc);},detach=(bucket,key,predicate)=>{const e=cached[bucket][key],left=owners(e).filter(v=>!predicate(v));if(left.length){e.owners=left;Object.assign(e,left.at(-1));}else delete cached[bucket][key];};
 const redact=s=>{let value=String(s||'');for(const secret of [...['apiKey','parseApiKey','fallbackApiKey','mineruKey','mineruToken'].map(k=>settings[k]),...(settings.modelProfiles||[]).map(p=>p.apiKey),...(settings.redactionKeys||[])].filter(Boolean))value=value.replaceAll(secret,'[已隐藏密钥]');return value;};
 const keyFor=(n,s,u,o={})=>{const actual=o.provider||settings;return createHash('sha256').update(JSON.stringify({name:n,system:s,user:u,...(['antigravity-acp','chatgpt-plan'].includes(actual.provider)?{provider:modelIdentity(actual)}:{}),model:actual.model,base:actual.baseUrl,tokens:actual.maxOutputTokens,tokenField:actual.outputTokenField,images:o.images||[]})).digest('hex');};
 function location(name,user,options){let value;try{value=JSON.parse(user);}catch{}return {scope:options.cacheScope||(/^构建课程上下文/.test(name)?'materials':scope),slot:options.cacheSlot||JSON.stringify([name.replace(/(\d+)\/\d+$/,'$1'),value?.sourceId??null,value?.pageIndex??null,value?.part??null])};}
 async function failure(key,name,error,raw,attempts,loc){const record={...loc,stage:name,key,at:new Date().toISOString(),attempts,reason:redact(error.message),details:error.details,response:redact(raw).slice(0,150000),responseTruncated:String(raw||'').length>150000};cached.failures[key]=record;await persist();await write(()=>save(path.join(dir,'Parsed','.last_model_failure.json'),record));}
 async function invoke(system,user,name,options){for(let a=0;;a++)try{signal?.throwIfAborted();const {provider,...safe}=options,actual=provider||settings;if(signal)safe.signal=safe.signal?AbortSignal.any([signal,safe.signal]):signal;if(actual.visionEnabled===false)safe.images=undefined;if(actual.contextChars&&system.length+user.length+1800>actual.contextChars)throw Error(name+'：超过此功能模型的 contextChars 配置，请提高额度或减少材料；没有截断必要原文。');return await call(actual,system,user,safe);}catch(e){signal?.throwIfAborted();if(!['transport','rate_limit'].includes(failureKind(e))||a>=2){e.providerFailure=!e.formatError;throw e;}await onStatus(`${name} · 网络退避 ${a+1}/2`);await backoff(1000*(a+1));}}
 async function request(name,system,user,validate,options,key){
  signal?.throwIfAborted();const loc=location(name,user,options);scopes.add(loc.scope);touched.add(key);
  const accept=async output=>{const previous=cached.entries[key];cached.entries[key]={...loc,owners:previous?owners(previous).filter(v=>v.scope!==loc.scope||v.slot!==loc.slot).concat(loc):[loc],name,output,created:new Date().toISOString()};delete cached.drafts[key];delete cached.failures[key];for(const bucket of ['entries','drafts','failures'])for(const [other,e] of Object.entries(cached[bucket]))if(other!==key&&owners(e).some(v=>v.scope===loc.scope&&v.slot===loc.slot))detach(bucket,other,v=>v.scope===loc.scope&&v.slot===loc.slot);await persist();return output;};
  const force=fresh&&loc.scope===scope,saved=!force&&cached.entries[key];if(saved)try{if(validate)validate(saved.output);attach(saved,loc);return saved.output;}catch{if(options.repair)cached.drafts[key]={...loc,output:saved.output};delete cached.entries[key];}
  let raw='',error,attempts=0;
  async function check(value){
   if(!validate)return accept(value);
   cached.drafts[key]={...loc,output:value,at:new Date().toISOString()};await persist();
   try{validate(value);return accept(value);}catch(e){
    if(!options.repair)throw e;
    await onStatus(name+' · 局部核对：'+e.message);
    try{const repaired=await options.repair({value,error:e,key});validate(repaired);return accept(repaired);}catch(next){if(next.regenerate){delete cached.drafts[key];throw next;}next.localRepair=true;throw next;}
   }
  }
  if(!force&&options.repair&&cached.drafts[key])try{return await check(structuredClone(cached.drafts[key].output));}catch(e){error=e;raw=JSON.stringify(cached.drafts[key]?.output||'');if(e.localRepair){await failure(key,name,e,raw,0,loc);throw e;}}
  for(let i=0;i<(validate?3:1);i++){
   attempts=i+1;let retry='';if(i){await onStatus(`${name} · 核对失败，针对具体错误重试 ${i}/2`);const details=JSON.stringify({error:error?.message,details:error?.details,previousResponse:raw.slice(0,16000),responseExcerpted:raw.length>16000});retry='\n\nFormatting retry: correct this specific failure; preserve all evidence and valid content. Return one complete JSON object.\n'+details;}
   try{raw=await invoke(system,user+retry,name,{...options,...(validate&&settings.structuredOutput!==false?{json:true}:{})});signal?.throwIfAborted();return await check(validate?parseJson(raw):raw);}catch(e){signal?.throwIfAborted();error=e;if(e.rawResponse)raw=e.rawResponse;if(e.localRepair||e.providerFailure||(!e.formatError&&(e.httpStatus||e.category||e.truncated||['transport','rate_limit'].includes(failureKind(e))))){await failure(key,name,e,e.rawResponse||raw,attempts,loc);throw e;}}
  }
  await failure(key,name,error,raw,attempts,loc);throw Error(`${name}：模型返回的 JSON 格式或字段连续 ${attempts} 次未通过。已保存当前失败与可恢复内容。原因：${error.message}`);
 }
 function once(name,system,user,validate,options={}){const key=keyFor(name,system,user,options);if(inflight.has(key))return inflight.get(key);const task=request(name,system,user,validate,options,key);inflight.set(key,task);task.then(()=>inflight.delete(key),()=>inflight.delete(key));return task;}
 return {text:(n,s,u,o)=>once(n,s,u,undefined,o),object:(n,s,u,v,o)=>once(n,s,u,v,o),remaining:(s,u)=>(settings.contextChars||Infinity)-s.length-u.length-1800,
  cachedObject(n,s,u,validate,options={}){const loc=location(n,u,options),key=keyFor(n,s,u,options),entry=cached.entries[key];if(!entry||fresh&&loc.scope===scope)return;try{validate(entry.output);}catch{return;}scopes.add(loc.scope);touched.add(key);attach(entry,loc);return entry.output;},
  async finish(){for(const bucket of ['entries','drafts','failures'])for(const [key,e] of Object.entries(cached[bucket]))if(!touched.has(key)&&owners(e).some(v=>scopes.has(v.scope)))detach(bucket,key,v=>scopes.has(v.scope));await persist();}};
}
