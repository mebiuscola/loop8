<script lang="ts">
 import Icon from './Icon.svelte';
 import {api,ApiError,type Project,type ChatMessage} from '../lib/api';
 import {store} from '../lib/store.svelte';
 import {askContext} from '../lib/ask-context.svelte';

 let {project,onclose}:{project:Project;onclose:()=>void}=$props();

 // Scope list follows the backend's ask scopes: week, preparation, or one session.
 const scopes=$derived([
  {id:'week',label:'本周课'},
  {id:'preparation',label:'本周教学材料'},
  ...project.sessions.map(s=>({id:s.id,label:s.type+' · '+s.title})),
 ]);
 let scope=$state('week');
 // The reader offers "this page"; it is used until the user removes it, and comes back for another material.
 let useFocus=$state(true);
 const focus=$derived(useFocus?askContext.focus:null);
 $effect(()=>{askContext.focus?.focus.sourceId;useFocus=true;});
 const activeScope=$derived(focus?focus.scope:scope);
 let question=$state(''),sending=$state(false),error=$state(''),progress=$state('');
 let list:HTMLElement;

 // Questions and answers are stored as pairs; show all of them, newest last, each with its scope.
 const history=$derived((project.chat||[]) as ChatMessage[]);
 const scopeLabel=(m:ChatMessage)=>m.contextLabel||scopes.find(s=>s.id===m.scope)?.label||m.scope;

 $effect(()=>{history.length;queueMicrotask(()=>list?.scrollTo({top:list.scrollHeight}));});

 const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 async function waitForJob(kind:'acp'|'chatgpt',id:string){
  for(;;){
   const job=await api.job(kind,id);
   if(job.status!=='running'){
    if(job.status!=='success')throw new Error(job.message||'提问没有完成。');
    return;
   }
   progress=job.stage||'正在回答…';
   await pause(1500);
  }
 }

 async function send(event:SubmitEvent){
  event.preventDefault();
  const text=question.trim();
  if(!text||sending)return;
  sending=true;error='';progress='正在回答…';
  try{
   const result=await api.ask(project.id,text,activeScope,focus?.focus??null);
   if('chatgptJobId' in result)await waitForJob('chatgpt',result.chatgptJobId);
   else if('acpJobId' in result)await waitForJob('acp',result.acpJobId);
   question='';
   await store.refresh();
  }catch(e){error=e instanceof ApiError?e.message:(e as Error).message;}
  finally{sending=false;progress='';}
 }

 function keydown(event:KeyboardEvent){
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();}
 }
</script>

<aside class="ask" aria-label="提问">
 <header>
  <h2>提问</h2>
  <button class="btn btn-quiet icon" onclick={onclose} title="收起提问"><Icon name="close" size={16}/></button>
 </header>

 <div class="history" bind:this={list}>
  {#each history as m, i (m.at+m.role+i)}
   <article class="msg {m.role}" class:current={m.scope===activeScope}>
    <div class="meta">{m.role==='user'?'我':'AI 回答'} · <span class="scope">{scopeLabel(m)}</span></div>
    <div class="text">{m.text}</div>
   </article>
  {:else}
   <p class="empty">还没有提问。问题会根据所选范围内的材料、讲稿和分析来回答。</p>
  {/each}
 </div>

 <form onsubmit={send}>
  {#if focus}
   <div class="scope-row">范围
    <span class="chip" title={focus.label}><span class="chip-text">{focus.label}</span>
     <button type="button" class="chip-x" onclick={()=>useFocus=false} title="改为按整体范围提问" aria-label="去掉当前位置"><Icon name="close" size={12}/></button>
    </span>
   </div>
  {:else}
   <label class="scope-row">范围
    <select bind:value={scope} disabled={sending}>
     {#each scopes as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    </select>
   </label>
  {/if}
  <textarea bind:value={question} onkeydown={keydown} rows="3" placeholder="输入问题（Ctrl+Enter 发送）" aria-label="问题" disabled={sending} maxlength="10000"></textarea>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="send-row">
   <span class="progress" aria-live="polite">{progress}</span>
   <button class="btn btn-primary" type="submit" disabled={sending||!question.trim()}>提问</button>
  </div>
 </form>
</aside>

<style>
 .ask{display:flex;flex-direction:column;height:100%;background:var(--bg-surface);border-left:1px solid var(--line);min-width:0;}
 header{display:flex;align-items:center;justify-content:space-between;padding:0 var(--space-2) 0 var(--space-4);height:44px;border-bottom:1px solid var(--line);}
 h2{font-size:var(--text-md);}
 .icon{width:32px;padding:0;justify-content:center;}
 .history{flex:1;overflow-y:auto;padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-3);}
 .msg{padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);background:var(--bg-raised);border:1px solid var(--line);opacity:.72;}
 .msg.current{opacity:1;}
 .msg.assistant{border-left:3px solid var(--kind-analysis);}
 .msg.user{border-left:3px solid var(--line-strong);}
 .meta{font-size:var(--text-xs);color:var(--fg-muted);margin-bottom:var(--space-1);}
 .scope{color:var(--accent);}
 .text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-sm);}
 .empty{color:var(--fg-muted);font-size:var(--text-sm);}
 form{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-top:1px solid var(--line);}
 .scope-row{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-xs);color:var(--fg-muted);}
 .chip{display:inline-flex;align-items:center;gap:var(--space-1);min-width:0;max-width:100%;height:26px;padding:0 var(--space-1) 0 var(--space-2);border-radius:999px;background:var(--accent-soft);color:var(--accent-strong);font-size:var(--text-xs);}
 .chip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .chip-x{display:grid;place-items:center;width:20px;height:20px;border:0;border-radius:50%;background:transparent;color:inherit;}
 .chip-x:hover{background:var(--white);}
 select{flex:1;height:28px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);font-size:var(--text-sm);}
 textarea{resize:vertical;min-height:64px;padding:var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .error{margin:0;font-size:var(--text-xs);color:var(--status-failed-fg);}
 .send-row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);}
 .progress{font-size:var(--text-xs);color:var(--status-running-fg);}
</style>
