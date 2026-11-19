const element=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
export function chatgptUsageLink(){
 const link=element('a','管理 ChatGPT 使用量');
 link.href='https://chatgpt.com/settings/usage';
 link.target='_blank';link.rel='noopener noreferrer';
 return link;
}
export function acpPanel(){const host=element('section');host.className='acp-interaction';host.setAttribute('aria-label','Antigravity 交互状态');return host;}
export async function observeAcpJob({api,post,id,host,transport='acp',showText=true,onProgress=()=>{}}){
 const owningDialog=host.closest('dialog');
 const chatgpt=transport==='chatgpt',jobsUrl=transport==='preview'?'/api/preview/jobs/':chatgpt?'/api/chatgpt/jobs/':'/api/acp/jobs/';
 if(transport==='preview')host.setAttribute('aria-label','模型请求状态');
 if(chatgpt)host.setAttribute('aria-label','ChatGPT 订阅请求状态');
 const heading=element('div'),status=element('span',transport==='preview'?'准备模型请求…':chatgpt?'准备 ChatGPT 请求…':'连接官方 Antigravity…'),cancel=element('button','停止'),preview=element('div'),permission=element('div'),login=element('div');
 heading.className='acp-progress';status.setAttribute('role','status');cancel.type='button';heading.append(status,cancel);preview.className='acp-preview';permission.className='acp-permission';login.className='acp-login-actions';host.replaceChildren(heading,login,preview,permission);
 if(chatgpt){
  const usage=element('div');usage.className='acp-login-actions';
  usage.append(element('small','使用 ChatGPT 订阅'),chatgptUsageLink());heading.after(usage);
 }
 cancel.onclick=async()=>{cancel.disabled=true;try{await post(jobsUrl+id+'/cancel',{});status.textContent='正在停止…';}catch(e){status.textContent=e.message;cancel.disabled=false;}};
 let permissionId=null,visibleText='',loginUrl='';
 try{for(;;){
  if(owningDialog&&!owningDialog.open){await post(jobsUrl+id+'/cancel',{});throw Error(chatgpt?'窗口已关闭，ChatGPT 请求已停止。':'设置窗口已关闭，测试已停止。');}
  const job=await api(jobsUrl+id);
  const modelNote=job.modelLabel&&!job.stage.includes(job.modelLabel)?' · '+job.modelLabel:'';
  status.textContent=job.stage+modelNote+(job.status==='running'&&job.phaseStarted?' · 本阶段 '+Math.max(0,Math.round((Date.now()-job.phaseStarted)/1000))+' 秒':'');onProgress(job);
  if((job.authorizationUrl||'')!==loginUrl){loginUrl=job.authorizationUrl||'';login.replaceChildren();if(loginUrl){let u;try{u=new URL(loginUrl);}catch{}if(u?.protocol==='https:'&&u.hostname==='accounts.google.com'&&!u.username&&!u.password){const open=element('a','打开登录页面'),copy=element('button','复制登录链接'),note=element('small','未自动弹出浏览器时，可手动打开；此链接仅用于当前官方授权。');open.href=loginUrl;open.target='_blank';open.rel='noopener noreferrer';copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(loginUrl);copy.textContent='已复制';}catch{copy.textContent='请右键登录入口复制链接';}};login.append(open,copy,note);}}}
  if(showText&&job.text!==visibleText){visibleText=job.text||'';preview.textContent=visibleText;preview.hidden=!visibleText;}
  if((job.permission?.id||null)!==permissionId){permissionId=job.permission?.id||null;permission.replaceChildren();if(job.permission){
   const p=job.permission;permission.append(element('strong','Antigravity 请求：'+p.title));const details=element('details'),summary=element('summary','查看操作内容'),pre=element('pre',p.details||'没有提供额外说明');details.append(summary,pre);permission.append(details);const actions=element('div');actions.className='acp-actions';
   for(const choice of [...p.options.filter(o=>o.kind!=='allow_always'),{optionId:null,name:'取消此操作',kind:'reject_once'}]){const b=element('button',choice.optionId==='continue'?choice.name:choice.kind==='allow_once'?'仅允许这一次':choice.name||'拒绝');b.type='button';b.onclick=async()=>{for(const x of actions.children)x.disabled=true;try{await post(jobsUrl+id+'/permission',{permissionId:p.id,optionId:choice.optionId});}catch(e){status.textContent=e.message;for(const x of actions.children)x.disabled=false;}};actions.append(b);}permission.append(actions);
  }}
  if(job.status!=='running'){cancel.hidden=true;permission.replaceChildren();login.replaceChildren();if(job.status!=='success')throw Object.assign(Error(job.message||(chatgpt?'ChatGPT 请求未完成。':'ACP 交互未完成。')),{cancelled:job.status==='cancelled'});status.textContent=(job.result?.message||'已完成')+modelNote;return job.result;}
  await new Promise(resolve=>setTimeout(resolve,650));
 }}catch(e){status.textContent=e.message;throw e;}finally{cancel.hidden=true;login.replaceChildren();loginUrl='';}
}
