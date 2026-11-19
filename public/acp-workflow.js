import {acpPanel,observeAcpJob} from './acp.js';
const watched=new Set();
export function watchAcpWorkflow(id,{api,post,notice,transport='acp'}){
 if(watched.has(id))return;watched.add(id);
 const label=transport==='chatgpt'?'ChatGPT 生成任务':'ACP 任务',storageKey='classroom-'+transport+'-workflows';
 const host=document.createElement('section');host.className='acp-workflow';host.setAttribute('aria-label',label);const head=document.createElement('header'),title=document.createElement('h3'),toggle=document.createElement('button');title.textContent=label;toggle.type='button';toggle.textContent='查看进度';toggle.setAttribute('aria-expanded','false');const panel=acpPanel();panel.hidden=true;toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.textContent=panel.hidden?'查看进度':'收起';toggle.setAttribute('aria-expanded',String(!panel.hidden));};head.append(title,toggle);host.append(head,panel);document.body.append(host);
 const active=JSON.parse(sessionStorage.getItem(storageKey)||'[]');if(!active.includes(id))sessionStorage.setItem(storageKey,JSON.stringify([...active,id]));
 observeAcpJob({api,post,id,host:panel,transport,onProgress:j=>{if(j.permission){panel.hidden=false;toggle.textContent='收起';toggle.setAttribute('aria-expanded','true');}}}).catch(e=>{if(!e.cancelled)notice(e.message);}).finally(()=>{host.remove();watched.delete(id);sessionStorage.setItem(storageKey,JSON.stringify(JSON.parse(sessionStorage.getItem(storageKey)||'[]').filter(x=>x!==id)));});
}
