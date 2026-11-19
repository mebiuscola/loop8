import {AsyncLocalStorage} from 'node:async_hooks';
export const acpInteraction=new AsyncLocalStorage();
let tail=Promise.resolve();
// Share the initiating task's cancellation and permissions with every model
// call. Legacy manual hosts can still request per-turn confirmation.
export async function interactiveAcpCall(work,settings,system,user,options){
 const context=acpInteraction.getStore();if(!context)return work(options);
 if(context.acquire){
  const signal=options.signal?AbortSignal.any([context.signal,options.signal]):context.signal;
  signal.throwIfAborted();
  let page;
  try{page=JSON.parse(user)?.page;}catch{}
  const onPermission=(params,permissionSignal)=>{
   if(!Number.isSafeInteger(page)||page<1)return context.onPermission(params,permissionSignal);
   const toolCall={...params.toolCall,title:'第 '+page+' 页 · '+(params.toolCall?.title||'工具操作')};
   return context.onPermission({...params,toolCall},permissionSignal);
  };
  return context.acquire(runtime=>work({...context,...options,signal,runtime,onPermission,acpInteractive:true}),signal);
 }
 const prior=tail;let release,onAbort;tail=new Promise(r=>release=r);
 try{await Promise.race([prior,new Promise((r,reject)=>{onAbort=()=>reject(context.signal.reason);if(context.signal.aborted)onAbort();else context.signal.addEventListener('abort',onAbort,{once:true});})]);context.signal.removeEventListener('abort',onAbort);context.signal.throwIfAborted();
  const signal=options.signal?AbortSignal.any([context.signal,options.signal]):context.signal;
  if(!context.autoApprove){
   const selected=await context.onPermission({toolCall:{title:'下一步模型请求 · '+settings.model,kind:'other',rawInput:{model:settings.model,textCharacters:system.length+user.length,images:options.images?.length||0,output:options.json?'JSON':'文字',note:'点击继续才会发送本次请求；停止会保留已完成结果。'}},options:[{optionId:'continue',name:'继续这一步',kind:'allow_once'},{optionId:'stop',name:'停止任务',kind:'reject_once'}]},signal);
   if(selected!=='continue'){context.cancel?.();throw Object.assign(Error('已停止 ACP 交互任务。'),{category:'cancelled',providerFailure:true});}
  }
  return await work({...context,...options,signal,acpInteractive:true});
 }finally{if(onAbort)context.signal.removeEventListener('abort',onAbort);release();}
}
