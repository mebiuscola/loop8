<script lang="ts">
 import Icon from './Icon.svelte';
 import RichText from './RichText.svelte';
 import ErrorNote from './ErrorNote.svelte';
 import {api,ApiError,type Project,type ChatMessage} from '../lib/api';
 import {store} from '../lib/store.svelte';
 import {askContext,courseAsk,type CourseAsk} from '../lib/ask-context.svelte';

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
 // A new material or class brings the chip back; turning pages within one material does not.
 $effect(()=>{const f=askContext.focus;f?.scope;f?.focus?.sourceId;useFocus=true;});
 const activeScope=$derived(focus?focus.scope:scope);
 // Draft, waiting state and errors belong to the course, so switching courses mid-answer
 // neither shows this course's progress elsewhere nor clears another course's draft.
 const ask=$derived(courseAsk(project.id));
 let list:HTMLElement;

 // Questions and answers are stored as pairs; show all of them, newest last, each with its scope.
 const history=$derived((project.chat||[]) as ChatMessage[]);
 const scopeLabel=(m:ChatMessage)=>m.contextLabel||scopes.find(s=>s.id===m.scope)?.label||m.scope;

 $effect(()=>{history.length;queueMicrotask(()=>list?.scrollTo({top:list.scrollHeight}));});

 const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 async function waitForJob(s:CourseAsk,kind:'acp'|'chatgpt',id:string){
  s.job={kind,id};
  try{
   for(;;){
    const job=await api.job(kind,id);
    if(job.status!=='running'){
     if(job.status==='cancelled')throw new Error('已停止，这个问题没有保存。');
     if(job.status!=='success')throw new Error(job.message||'提问没有完成。');
     return;
    }
    if(s.progress!=='正在停止…')s.progress=job.stage||'正在回答…';
    await pause(1500);
   }
  }finally{s.job=null;}
 }

 async function send(event:SubmitEvent){
  event.preventDefault();
  const s=ask,text=s.question.trim();
  if(!text||s.sending)return;
  // The box is free for the next question while this one is answered.
  s.sending=true;s.error='';s.progress='正在回答…';s.question='';
  try{
   const result=await api.ask(project.id,text,activeScope,focus?.focus??null);
   if('chatgptJobId' in result)await waitForJob(s,'chatgpt',result.chatgptJobId);
   else if('acpJobId' in result)await waitForJob(s,'acp',result.acpJobId);
   await store.refresh();
  }catch(e){
   s.error=e instanceof ApiError?e.message:(e as Error).message;
   if(!s.question.trim())s.question=text;   // give the unanswered question back
  }
  finally{s.sending=false;s.progress='';}
 }

 function stop(){
  const s=ask,j=s.job;if(!j)return;
  s.progress='正在停止…';
  api.cancelJob(j.kind,j.id).catch(e=>{s.error=(e as Error).message;});
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
    {#if m.role==='assistant'}<RichText text={m.text} {project}/>{:else}<div class="text">{m.text}</div>{/if}
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
    <select bind:value={scope} disabled={ask.sending}>
     {#each scopes as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    </select>
   </label>
  {/if}
  <textarea bind:value={ask.question} onkeydown={keydown} rows="3" placeholder="输入问题（Ctrl+Enter 发送）" aria-label="问题" maxlength="10000"></textarea>
  {#if ask.error}<p class="error-line"><ErrorNote text={ask.error}/></p>{/if}
  <div class="send-row">
   <span class="progress" aria-live="polite">{ask.progress}</span>
   {#if ask.sending&&ask.job}<button class="btn btn-quiet" type="button" onclick={stop}>停止</button>{/if}
   <button class="btn btn-primary" type="submit" disabled={ask.sending||!ask.question.trim()}>{ask.sending?'正在回答…':'提问'}</button>
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
 .error-line{margin:0;font-size:var(--text-xs);}
 .send-row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);}
 .progress{flex:1;font-size:var(--text-xs);color:var(--status-running-fg);}
</style>
