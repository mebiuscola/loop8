import {randomUUID} from 'node:crypto';

// User-started in-memory jobs. Observation expiry and permission handling are
// explicit host policies; closing the local server still stops running jobs.
export function interactiveJobs({abandonMs=45000,autoApprove=false,retentionMs=300000,label='ACP',starting='连接官方 Antigravity'}={}){
 const jobs=new Map();
 const view=j=>({id:j.id,status:j.status,stage:j.stage,phase:j.phase,phaseHistory:j.phaseHistory,started:j.started,phaseStarted:j.phaseStarted,updated:j.updated,authenticated:j.authenticated,authorizationUrl:j.authorizationUrl,text:j.text,permission:j.permission,result:j.result,message:j.message,modelLabel:j.modelLabel});
 function prune(){for(const [id,j] of jobs)if(j.finished&&Date.now()-j.finished>retentionMs)jobs.delete(id);}
 function start(work){
  prune();if(jobs.size>=100)throw Error('交互记录过多，请稍后重试。');
  const controller=new AbortController(),j={id:randomUUID(),status:'running',stage:starting,phase:'starting',phaseHistory:[{phase:'starting',at:Date.now()}],started:Date.now(),phaseStarted:Date.now(),updated:Date.now(),text:'',seen:Date.now(),controller};jobs.set(j.id,j);
  const timer=abandonMs>0?setInterval(()=>{if(Date.now()-j.seen>abandonMs)controller.abort(Error('网页已断开观察'));},Math.min(abandonMs,5000)):null;timer?.unref?.();
  const permissions=new Map();
  const showPermission=()=>{
   const next=permissions.values().next().value;
   j.permission=next?.request;
   if(j.status==='running')j.stage=next?'等待你确认操作':'等待官方运行时继续';
  };
  const permission=(params,signal)=>new Promise(resolve=>{
   if(signal.aborted)return resolve(null);
   // The initiating button authorizes this task. Select only the runtime's
   // offered one-action permission; never grant a lasting allow_always policy.
   if(autoApprove)return resolve(params.options.find(o=>o.kind==='allow_once')?.optionId??null);
   const id=randomUUID();
   const finish=value=>{
    if(!permissions.delete(id))return;
    signal.removeEventListener('abort',cancel);
    showPermission();
    resolve(value);
   };
   const cancel=()=>finish(null);
   const request={id,title:params.toolCall?.title||'工具操作',kind:params.toolCall?.kind||'other',details:JSON.stringify({rawInput:params.toolCall?.rawInput,locations:params.toolCall?.locations,content:params.toolCall?.content},null,2).slice(0,20000),options:params.options.filter(o=>o.kind!=='allow_always')};
   permissions.set(id,{request,finish});
   showPermission();
   signal.addEventListener('abort',cancel,{once:true});
  });
  j.resolvePermission=(value,id)=>{if(id)permissions.get(id)?.finish(value);else for(const pending of permissions.values())pending.finish(null);};
  const onUpdate=(update,text)=>{j.text=text;j.updated=Date.now();if(update.phase==='starting')j.modelLabel=undefined;if(update.modelLabel)j.modelLabel=update.modelLabel;if(update.phase&&update.phase!==j.phase){j.phase=update.phase;j.phaseStarted=Date.now();j.phaseHistory.push({phase:j.phase,at:j.phaseStarted});j.phaseHistory=j.phaseHistory.slice(-20);}if(typeof update.authenticated==='boolean')j.authenticated=update.authenticated;if(Object.hasOwn(update,'authorizationUrl'))j.authorizationUrl=update.authorizationUrl||undefined;if(!j.permission)j.stage=update.sessionUpdate==='status'?update.text:update.sessionUpdate==='tool_call'?'官方 Agent 正在执行：'+(update.title||'工具操作'):'正在回复';};
  j.done=Promise.resolve().then(()=>work({signal:controller.signal,onUpdate,onPermission:permission,acpInteractive:true,autoApprove,cancel:()=>controller.abort()})).then(result=>{controller.signal.throwIfAborted();j.status='success';j.result=result;j.stage=result?.authenticated?'个人账号认证已完成':'已完成';}).catch(e=>{j.status=controller.signal.aborted?'cancelled':'error';j.message=controller.signal.aborted?label+' 交互已停止；未自动重试。':e.message;j.stage='已停止';}).finally(()=>{clearInterval(timer);j.authorizationUrl=undefined;j.resolvePermission?.(null);j.finished=Date.now();});
  return view(j);
 }
 function get(id){prune();const j=jobs.get(id);if(!j)throw Error(label+' 交互不存在、已过期或服务已重启。');j.seen=Date.now();return view(j);}
 function cancel(id){const j=jobs.get(id);if(!j)throw Error(label+' 交互不存在。');if(j.status==='running'){j.controller.abort();j.resolvePermission?.(null);}return view(j);}
 function decide(id,permissionId,optionId){const j=jobs.get(id);if(!j||j.status!=='running'||!j.permission||j.permission.id!==permissionId)throw Error('权限请求已失效。');if(optionId!==null&&!j.permission.options.some(o=>o.optionId===optionId&&o.kind!=='allow_always'))throw Error('无效权限选项。');j.seen=Date.now();j.resolvePermission(optionId,permissionId);return view(j);}
 return {start,get,cancel,decide,has:id=>jobs.has(id),get busy(){return [...jobs.values()].some(j=>j.status==='running');},async close(){for(const j of jobs.values())if(j.status==='running')j.controller.abort();await Promise.all([...jobs.values()].map(j=>j.done));}};
}
