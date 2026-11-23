import {mapPool} from './concurrency.mjs';
import {contentHash} from './materials.mjs';
import {modelIdentity} from './model-routing.mjs';
import {needsWork} from './doubts.mjs';

export function failureKind(e){
 if(e.category)return e.category;
 if(e.finishReason==='recitation'||/\brecitation\b/i.test(e.message))return 'recitation';
 if(e.truncated)return 'truncated';
 if([401,403,404].includes(e.httpStatus))return 'configuration';
 if(e.httpStatus===429)return 'rate_limit';
 if(e.httpStatus>=500||e.name==='TimeoutError'||e.message==='fetch failed')return 'transport';
 return 'format';
}
// Only pages that could not be recognised are retried; other doubts are hints (lib/doubts.mjs).
export const hasIssues=(page,ppt)=>needsWork(page,ppt);
export function materialRouteConfigured(settings){
 return Boolean(settings?.model&&(settings.provider==='chatgpt-plan'||(settings.provider==='antigravity-acp'?settings.acpExecutable:settings.apiKey)));
}
export function routeSignature(settings,prompt){
 if(settings.provider==='antigravity-acp')return contentHash(JSON.stringify({acp:modelIdentity(settings),prompt}));
 if(settings.provider==='chatgpt-plan')return contentHash(JSON.stringify({chatgpt:modelIdentity(settings),prompt}));
 return contentHash(JSON.stringify({model:settings.model,base:settings.baseUrl,key:contentHash(settings.apiKey||''),tokens:settings.maxOutputTokens,tokenField:settings.outputTokenField,prompt}));
}

// Per-file round barriers; per-request concurrency is shared across all files.
// Persist an attempt before sending. An interrupted submission consumes its slot
// rather than becoming an unbounded hidden retry after restart.
export async function runPageRounds({checkpoint,primary,fallback,autoFallback,prompt,ppt,review=false,queue,limit=2,signal,persist,notify,request,backoff=ms=>new Promise(r=>setTimeout(r,ms))}){
 checkpoint.attempts??={};checkpoint.provenance??={};checkpoint.cycles??={};
 const rounds=review?[{id:'review',label:ppt?'主模型核对疑点页':'备用模型复核疑点页',settings:ppt?primary:fallback}]:[
  {id:'initial',label:'主模型首轮',settings:primary},
  {id:'retry',label:'主模型补试',settings:primary},
  ...(autoFallback&&!ppt?[{id:'fallback',label:'备用模型补救',settings:fallback}]:[])
 ];
 const summary=[];const errors=new Map();
 for(const round of rounds){
  signal.throwIfAborted();
  const missing=Array.from({length:checkpoint.total},(_,i)=>i).filter(i=>review?hasIssues(checkpoint.pages[i],ppt):!checkpoint.pages[i]);
  if(!missing.length)break;
  if(!materialRouteConfigured(round.settings)){summary.push({id:round.id,label:round.label,status:'not_configured',total:missing.length,success:0,failed:0});await notify({round:round.label,summary});continue;}
  const signature=routeSignature(round.settings,prompt),cycle=i=>checkpoint.cycles[i]||0;
  const configurationFailed=Object.entries(checkpoint.attempts).some(([i,entries])=>entries.some(a=>a.signature===signature&&a.cycle===cycle(i)&&a.kind==='configuration'));
  if(configurationFailed){summary.push({id:round.id,label:round.label,model:round.settings.model,status:'configuration_error',total:missing.length,success:0,failed:0});await notify({round:round.label,summary});continue;}
  const attempted=i=>(checkpoint.attempts[i]||[]).some(a=>a.round===round.id&&a.cycle===cycle(i)&&a.signature===signature&&a.kind!=='quota_exhausted');
  const eligible=missing.filter(i=>!attempted(i));
  const past=Object.entries(checkpoint.attempts).flatMap(([i,entries])=>entries.filter(a=>a.round===round.id&&a.cycle===cycle(i)&&a.signature===signature));
  const row={id:round.id,label:round.label,model:round.settings.model,total:eligible.length+past.length,success:past.filter(a=>a.status==='success').length,failed:past.filter(a=>a.status==='failed'||a.status==='interrupted').length,reused:missing.length-eligible.length,status:'running'};summary.push(row);await notify({round:round.label,summary});
  let blocked=false,quotaPaused=false;
  await mapPool(eligible,limit,async i=>{
   if(blocked||signal.aborted)return;
   try{
    const value=await queue.run(async()=>{
     if(blocked)return null;signal.throwIfAborted();
     const attempt={round:round.id,cycle:cycle(i),signature,model:round.settings.model,ruleHash:contentHash(prompt),at:new Date().toISOString(),status:'running',transportAttempts:0};
     (checkpoint.attempts[i]??=[]).push(attempt);await persist();
     try{
      for(let transport=0;;transport++){
       signal.throwIfAborted();attempt.transportAttempts++;await persist();
       try{return await request(i,round.settings,{round:round.label,attempt});}
       catch(e){
        const kind=failureKind(e);
        if(kind==='quota_exhausted'){quotaPaused=true;blocked=true;}
        if(kind==='rate_limit')queue.limited();
        if(!['transport','rate_limit'].includes(kind)||transport>=2)throw e;
        await notify({index:i,phase:'网络退避',round:round.label,summary});
        await backoff(1000*(transport+1));
       }
      }
     }catch(e){attempt.status=signal.aborted?'interrupted':'failed';attempt.kind=failureKind(e);attempt.message=e.message;attempt.finished=new Date().toISOString();await persist();throw e;}
    },signal);
    if(!value)return;signal.throwIfAborted();
    const record=checkpoint.attempts[i].at(-1);record.status='success';record.finished=new Date().toISOString();
    // A failed review never erases its existing usable result.
    checkpoint.pages[i]=value;checkpoint.provenance[i]={model:round.settings.model,round:round.id,ruleHash:contentHash(prompt),renderBasis:checkpoint.renderBasis,at:record.finished};
    await persist();row.success++;errors.delete(i);await notify({index:i,phase:'已保存',round:round.label,summary});
   }catch(e){
    if(signal.aborted)return;
    const kind=failureKind(e);
    row.failed++;
    errors.set(i,{page:i+1,kind,message:e.message});
    if(kind==='configuration'||kind==='quota_exhausted')blocked=true;
    if(kind==='quota_exhausted')quotaPaused=true;
    await notify({index:i,phase:'本轮失败',round:round.label,summary});
   }
  });
  signal.throwIfAborted();row.status=quotaPaused?'quota_paused':blocked?'configuration_error':'finished';await notify({round:round.label,summary});
  if(quotaPaused)break;
 }
 const missing=Array.from({length:checkpoint.total},(_,i)=>i).filter(i=>!checkpoint.pages[i]);
 const unresolved=review?Array.from({length:checkpoint.total},(_,i)=>i).filter(i=>hasIssues(checkpoint.pages[i],ppt)):missing;
 const failures=unresolved.map(i=>errors.get(i)||{page:i+1,kind:(checkpoint.attempts[i]||[]).at(-1)?.kind||'unresolved',message:(checkpoint.attempts[i]||[]).at(-1)?.message||'本页尚未恢复，自动尝试已用完或备用模型未配置。'});
 return {summary,missing:missing.map(i=>i+1),failures};
}
