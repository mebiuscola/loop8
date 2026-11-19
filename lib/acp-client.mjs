import {spawn} from 'node:child_process';
import {Readable,Writable} from 'node:stream';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {interactiveAcpCall} from './acp-interaction.mjs';
import {authOutputReader} from './acp-auth.mjs';
import {semaphore,serialWriter} from './concurrency.mjs';

// Official ACP stdio only. No credential extraction, API emulation, headless
// prompt flags, system-prompt override or request retry loop. Permission choices
// come from the initiating local task, via the official ACP callback.
export function validateAcpProfile(p){
 if(typeof p.acpExecutable!=='string'||!path.win32.isAbsolute(p.acpExecutable)||!(/^(agy|agy_acp_server)\.exe$/i.test(path.win32.basename(p.acpExecutable))))throw Error('ACP 请填写官方 agy.exe 或独立 agy_acp_server.exe 的绝对路径；不接受脚本或自定义参数。');
 if(!['cli','standalone'].includes(p.acpEntry))throw Error('请选择官方 CLI 或独立 ACP 入口。');
 if(p.acpEntry==='cli'&&!/^agy\.exe$/i.test(path.win32.basename(p.acpExecutable))||p.acpEntry==='standalone'&&!/^agy_acp_server\.exe$/i.test(path.win32.basename(p.acpExecutable)))throw Error('ACP 入口与可执行文件名称不一致：CLI 选择 agy.exe，独立入口选择 agy_acp_server.exe。');
 if(p.acpThinking!==undefined&&(typeof p.acpThinking!=='string'||p.acpThinking.length>120))throw Error('ACP thinking 配置无效。');
}
export function assertInteractiveProvider(settings,task){
 if(settings.provider==='antigravity-acp'&&!settings.acpExecutable)throw Error('请先配置 ACP 程序路径。');
}
const problem=(message,category='acp')=>Object.assign(Error(message),{category,providerFailure:true});
export async function prepareAcpLaunch(settings,inherited=process.env){
 const executable=settings.acpExecutable;
 if(!await stat(executable).then(s=>s.isFile(),()=>false))throw problem('找不到官方 Antigravity 可执行文件，请安装后在设置填写完整路径。');
 const env={...inherited};for(const k of ['GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GENAI_USE_VERTEXAI','ANTIGRAVITY_HARNESS_PATH'])delete env[k];
 if(settings.acpEntry==='standalone'){
  const helper=path.join(path.dirname(executable),'localharness_external.exe');
  if(!await stat(helper).then(s=>s.isFile(),()=>false))throw problem('独立 ACP 缺少同目录的 localharness_external.exe。请完整解压同一版本的官方压缩包，保留两个 EXE，不要只移动主程序。');
  env.ANTIGRAVITY_HARNESS_PATH=helper;
 }
 return {executable,args:settings.acpEntry==='cli'?['acp']:[],env};
}
async function terminateAcpProcess(child){
 if(!child.pid||child.exitCode!==null)return;
 // The official Windows standalone runtime starts a same-name worker. Killing
 // only the launcher can orphan that worker and leave the scratch cwd locked.
 if(process.platform==='win32')await new Promise(resolve=>{
  const killer=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
  const timer=setTimeout(()=>{killer.kill();child.kill();resolve();},2500);killer.once('error',()=>{clearTimeout(timer);child.kill();resolve();});killer.once('close',()=>{clearTimeout(timer);resolve();});
 });else child.kill();
}
function availableOptions(option){return (option?.options||[]).flatMap(o=>Array.isArray(o.options)?o.options:[o]).filter(o=>typeof o.value==='string');}
export function sessionMetadata(init,session){
 const configOptions=session.configOptions||[],modelOption=configOptions.find(o=>o.category==='model'||o.id==='model'),thinkingOption=configOptions.find(o=>o.category==='thought_level'||/thinking|thought|effort/i.test(o.id));
 const models=modelOption?availableOptions(modelOption).map(o=>({modelId:o.value,name:o.name||o.value,description:o.description})):session.models?.availableModels||[];
 return {agent:init.agentInfo||null,protocolVersion:init.protocolVersion,authMethods:(init.authMethods||[]).map(m=>({id:m.id,name:m.name})),imageInput:init.agentCapabilities?.promptCapabilities?.image===true,models,currentModel:modelOption?.currentValue||session.models?.currentModelId||'',thinking:thinkingOption?{id:thinkingOption.id,current:thinkingOption.currentValue,options:availableOptions(thinkingOption).map(o=>({value:o.value,name:o.name||o.value}))}:null,credits:'unknown',configOptions};
}

function modelSelection(session,metadata,settings){
 const model=settings.model;
 if(metadata.models.some(option=>option.modelId===model))return {model,thinking:settings.acpThinking};
 // Older presets saved the legacy ID with the thinking level in its suffix.
 if(!session.models?.availableModels?.some(option=>option.modelId===model))return null;
 for(const option of metadata.models){
  const level=metadata.thinking?.options.find(level=>model===option.modelId+'-'+level.value);
  if(level)return {model:option.modelId,thinking:settings.acpThinking||level.value};
 }
 return null;
}
const authenticateOne=serialWriter();
export function createAcpRuntime({launch=spawn,validate=validateAcpProfile,idleMs=180000,timeouts={}}={}){
 const limits={initialize:60000,authenticate:300000,session:90000,config:30000,prompt:600000,...timeouts};
 let runtime=null,occupied=false,current=null,idleTimer;
 async function disconnect(){const old=runtime;runtime=null;clearTimeout(idleTimer);if(!old)return;await terminateAcpProcess(old.child);old.connection?.close();await Promise.race([old.childClosed,new Promise(r=>{const t=setTimeout(r,2000);t.unref?.();})]);await rm(old.cwd,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(()=>{});}
 async function connect(settings,signal,request){
  validate(settings);signal.throwIfAborted();const key=JSON.stringify([settings.acpExecutable,settings.acpEntry]);
  if(runtime?.key===key&&!runtime.connection.signal.aborted)return runtime;
  await disconnect();const spec=await prepareAcpLaunch(settings);
  const acp=await import('@agentclientprotocol/sdk');
  const cwd=await mkdtemp(path.join(os.tmpdir(),'classroom-acp-'));
  let child;try{child=launch(spec.executable,spec.args,{cwd,env:spec.env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{await rm(cwd,{recursive:true,force:true});throw problem('无法启动官方 Antigravity ACP。');}
  const state={key,cwd,child,connection:null};runtime=state;
  state.childClosed=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
  // Parsing is enabled only for the lifetime of authenticate. Discard all
  // unrelated output; do not keep raw stderr or persistent OAuth URL logs.
  child.stderr.on('data',bytes=>state.authOutput?.push(bytes));child.on('error',()=>state.connection?.close(problem('无法启动 Antigravity ACP，请核对程序路径。')));child.on('close',()=>state.connection?.close(problem('Antigravity ACP 进程已退出，请重新连接。')));
  const app=acp.client({name:'Classroom Local',version:'2.25.10'})
   .onNotification('session/update',ctx=>{const update=ctx.params;if(current?.sessionId===update.sessionId){if(update.update.sessionUpdate==='agent_message_chunk'&&update.update.content.type==='text'){current.text+=update.update.content.text;if(current.text.length>2000000){current.abort.abort(problem('ACP 回复过长，已停止等待。'));return;}}current.onUpdate?.(update.update,current.text);}})
   .onRequest('session/request_permission',async ctx=>{
    if(!current||current.sessionId!==ctx.params.sessionId||!current.onPermission)return {outcome:{outcome:'cancelled'}};
    // Only approve this one action; never persist an allow_always permission.
    const options=ctx.params.options.filter(o=>o.kind!=='allow_always');
    const selected=await current.onPermission({...ctx.params,options},current.signal);
    return {outcome:options.some(o=>o.optionId===selected)?{outcome:'selected',optionId:selected}:{outcome:'cancelled'}};
   });
  state.connection=app.connect(acp.ndJsonStream(Writable.toWeb(child.stdin),Readable.toWeb(child.stdout)));
  state.init=await request(state,'initialize',{protocolVersion:acp.PROTOCOL_VERSION,clientInfo:{name:'Classroom Local',version:'2.25.10'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}},'initialize');
  if(state.init.protocolVersion!==acp.PROTOCOL_VERSION)throw problem('ACP 协议版本不匹配，请更新官方 Antigravity。');
  return state;
 }
 async function run(settings,{action='prompt',system='',user='',images=[],json=false,signal:outerSignal,onUpdate,onPermission,onRequest,sessionGroup}={}){
  if(occupied)throw problem('Antigravity ACP 正在处理另一项交互，请等待完成或取消后重试。','acp_busy');
  occupied=true;clearTimeout(idleTimer);const abort=new AbortController(),signal=AbortSignal.any([abort.signal,outerSignal||new AbortController().signal,AbortSignal.timeout(1200000)]);let state,sessionId,cancelTimer,phase='starting',phaseTimeout=false;
  const descriptions={starting:'正在启动官方 ACP',initialize:'正在进行 ACP 协议握手',authenticate:'正在进行官方个人账号认证；有效凭据可能直接复用',authenticated:'个人账号认证已完成',session:'正在创建会话并读取模型列表',config:'正在读取所选模型配置',prompt:'等待模型回复'};
  const progress=(next,extra={})=>{phase=next;onUpdate?.({sessionUpdate:'status',phase:next,text:descriptions[next]||next,authenticated:!!state?.personalAuth,authorizationUrl:null,...extra},'');};
  const request=async(target,method,params,next,details)=>{progress(next,details);const timeout=AbortSignal.timeout(limits[next]);try{return await target.connection.agent.request(method,params,{cancellationSignal:AbortSignal.any([signal,timeout]),stopWaitingOnCancel:true});}catch(e){if(timeout.aborted&&!signal.aborted){phaseTimeout=true;throw problem((next==='initialize'?'ACP 启动／握手超时，尚未进入 Google 认证。':next==='authenticate'?'官方个人账号认证超时；请检查登录页面是否完成授权。':next==='session'?(target.personalAuth?'已认证；创建会话／读取模型列表超时。无需因此重复登录。':'创建会话／读取模型列表超时；尚不能确认登录状态。'):next==='config'?'所选模型配置读取超时。':'模型回复超时。')+' 可停止后手动重试。','acp_timeout');}throw e;}};
  const cancel=()=>{current?.cancelPermission?.();if(sessionId&&state?.connection&&!state.connection.signal.aborted){state.connection.agent.notify('session/cancel',{sessionId}).catch(()=>{});cancelTimer=setTimeout(()=>state.connection.close(problem('ACP 取消等待已超时。')),2000);cancelTimer.unref?.();}};signal.addEventListener('abort',cancel,{once:true});
  try{
   progress('starting');state=await connect(settings,signal,request);
   if(action==='handshake')return sessionMetadata(state.init,{});
   if((action==='login'||action==='prompt')&&!state.personalAuth){
    if(!state.init.authMethods?.some(m=>m.id==='oauth-personal'))throw problem('官方运行时没有提供 oauth-personal 登录方式；本连接不会改用 API Key。');
    await authenticateOne(async()=>{
     signal.throwIfAborted();
     state.authOutput=authOutputReader(url=>progress('authenticate',{text:'请在官方 Google 登录页面完成授权',authorizationUrl:url}));
     try{await request(state,'authenticate',{methodId:'oauth-personal'},'authenticate');}finally{state.authOutput?.flush();state.authOutput=null;}
     state.personalAuth=true;
    });
   }
   if(action==='login'){progress('authenticated');return {...sessionMetadata(state.init,{}),authenticated:true,message:'个人账号认证已完成；模型列表请单独读取。'};}
   const groupKey=action==='prompt'&&sessionGroup&&!images.length?JSON.stringify([sessionGroup,settings.model,settings.acpThinking]):null;
   const historyBudget=Math.min(48000,Math.floor((settings.contextChars||180000)/2));
   const reusable=groupKey&&state.reusable?.key===groupKey&&state.reusable.chars+system.length+user.length<=historyBudget?state.reusable:null;
   let metadata;
   if(reusable){
    sessionId=reusable.sessionId;
    metadata=reusable.metadata;
   }else{
   state.reusable=null;
   let session;try{session=await request(state,'session/new',{cwd:state.cwd,mcpServers:[]},'session');}catch(e){if(e.code===-32000||/auth|login|sign.in/i.test(e.message)){state.personalAuth=false;throw problem('需要官方登录：请点击“个人账号登录”，在浏览器完成授权后重试。');}throw e;}
   sessionId=session.sessionId;
   metadata=sessionMetadata(state.init,session);
   const selection=modelSelection(session,metadata,settings);
   if(!selection){if(action==='inspect')return metadata;throw problem('所选 ACP 模型不在账号的可用模型列表中。请刷新列表并更新对应预设。');}
   const modelOption=metadata.configOptions.find(o=>o.category==='model'||o.id==='model');
   if(metadata.currentModel!==selection.model){
    if(modelOption){
     const changed=await request(state,'session/set_config_option',{sessionId,configId:modelOption.id,value:selection.model},'config');
     metadata=sessionMetadata(state.init,changed);
     if(metadata.currentModel!==selection.model)throw problem('ACP 未确认切换到所选模型，任务已停止。');
    }else{
     await request(state,'session/set_model',{sessionId,modelId:selection.model},'config');
     metadata.currentModel=selection.model;
    }
   }
   if(action==='inspect')return {...metadata,selectedModel:selection.model,selectedThinking:selection.thinking};
   if(selection.thinking&&metadata.thinking?.current!==selection.thinking){
    if(!metadata.thinking?.options.some(o=>o.value===selection.thinking))throw problem('当前模型不支持所选思考强度，请刷新模型列表。');
    const changed=await request(state,'session/set_config_option',{sessionId,configId:metadata.thinking.id,value:selection.thinking},'config');
    metadata=sessionMetadata(state.init,changed);
    if(metadata.currentModel!==selection.model||metadata.thinking?.current!==selection.thinking)throw problem('ACP 未确认所选模型和思考强度，任务已停止。');
   }
   }
   const activeModel=metadata.models.find(option=>option.modelId===metadata.currentModel)?.name||metadata.currentModel;
   const activeThinking=metadata.thinking?.current;
   if(images.length&&!metadata.imageInput)throw problem('当前 ACP 运行时没有声明图片输入能力。');
   if(system.length+user.length>(settings.contextChars||180000))throw problem('本次上下文超过设置上限；没有截断材料。');
   if(images.reduce((n,v)=>n+Buffer.byteLength(v),0)>32*1024*1024)throw problem('图片请求超过 32 MB。');
   const prompt=[{type:'text',text:'Classroom task instructions (user-supplied Skill; follow your official runtime policies):\n'+system+'\n\nTask input:\n'+user+(json?'\n\nReturn only the requested JSON value, without a Markdown code fence.':'')}];
   for(const image of images){const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image);if(!match)throw problem('ACP 图片必须是本地图片数据。');prompt.push({type:'image',mimeType:match[1],data:match[2]});}
   current={sessionId,text:'',onUpdate,onPermission,signal,abort};await onRequest?.();
   const modelLabel=[activeModel,activeThinking].filter(Boolean).join(' · ');
   const result=await request(state,'session/prompt',{sessionId,prompt},'prompt',{text:'等待 '+modelLabel+' 回复',modelLabel});signal.throwIfAborted();
   if(result.stopReason==='max_tokens')throw Object.assign(problem('ACP 输出达到上限。','truncated'),{truncated:true});
   if(result.stopReason==='refusal')throw problem('ACP 模型拒绝了此请求（refusal）。','blocked');
   if(result.stopReason!=='end_turn')throw problem('ACP 未正常完成（'+result.stopReason+'）；没有保存为成功。');
   if(!current.text.trim())throw problem('ACP 没有返回可用文字。');
   if(groupKey)state.reusable={key:groupKey,sessionId,metadata,chars:(reusable?.chars||0)+prompt[0].text.length+current.text.length};
   return current.text;
  }catch(e){
   if(state)state.reusable=null;
   if(signal.aborted)throw problem('ACP 已取消或等待超时；不会自动重试。','cancelled');
   if(e.category)throw e;
   const reason=String(e.message||'');
   if(/quota (?:exhausted|exceeded)|(?:daily|weekly) (?:quota|limit)|insufficient.quota/i.test(reason))throw problem('ACP 额度暂时用尽，已保存进度。','quota_exhausted');
   if(e.code===429||/rate.limit|too many requests/i.test(reason))throw problem('ACP 暂时限流。','rate_limit');
   throw problem('ACP '+(descriptions[phase]||'请求')+'失败：'+(typeof e.code==='number'?'协议错误 '+e.code:'请检查官方运行时、登录与模型可用性')+'。不会自动重试或切换到 API。');
  }
  finally{
   signal.removeEventListener('abort',cancel);clearTimeout(cancelTimer);current=null;
   // ACP v1 session/close is optional. Never assume agent supports it; fresh
   // session IDs isolate turns, and the idle process timeout releases sessions.
   if(signal.aborted||phaseTimeout||state?.connection?.signal.aborted||!state?.init)await disconnect();
   occupied=false;idleTimer=setTimeout(()=>disconnect().catch(()=>{}),idleMs);idleTimer.unref?.();
  }
 }
 return {run,disconnect,get busy(){return occupied;}};
}
export const acpRuntime=createAcpRuntime();
export function createAcpPool(limit,{primary=acpRuntime,create=createAcpRuntime}={}){
 const slots=Array.from({length:limit},(_,index)=>({runtime:index===0?primary:null,busy:false}));
 const gate=semaphore(limit);
 return {
  acquire(work,signal){
   return gate.run(async()=>{
    signal.throwIfAborted();
    const slot=slots.find(candidate=>!candidate.busy);
    slot.busy=true;
    try{return await work(slot.runtime??=create());}
    finally{slot.busy=false;}
   });
  },
  async close(){await Promise.allSettled(slots.slice(1).map(slot=>slot.runtime?.disconnect()));}
 };
}
export const completeAcp=(settings,system,user,options={})=>interactiveAcpCall(actual=>{if(!actual.acpInteractive)throw problem('ACP 请求需要网页交互任务，请从课程页面启动。');return (actual.runtime||acpRuntime).run(settings,{...actual,system,user});},settings,system,user,options);
