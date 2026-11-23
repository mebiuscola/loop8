<script lang="ts">
 // Deep Dive: one list on the left (the whole week, then each class), the chosen analysis on the right.
 // Generation only starts from the button (AGENTS.md rule 6).
 import {untrack} from 'svelte';
 import Icon from '../Icon.svelte';
 import StatusBadge from '../StatusBadge.svelte';
 import ErrorNote from '../ErrorNote.svelte';
 import RichText from '../RichText.svelte';
 import {api,ApiError,type Project,type Session} from '../../lib/api';
 import {router,courseHref} from '../../lib/router.svelte';
 import {store} from '../../lib/store.svelte';
 import {askContext} from '../../lib/ask-context.svelte';
 import {scriptStale} from '../../lib/classroom';
 import {sessionAnalysis,sessionDiveStatus,weekDiveStatus,weeklyAnalysis,shortDate} from '../../lib/deepdive';

 let {project,rest}:{project:Project;rest:string}=$props();

 // rest = "week" | "<sessionId>"
 const sessions=$derived(project.sessions);
 const session=$derived(sessions.find(s=>s.id===rest.split('/')[0])||null);
 const isWeek=$derived(!session);
 const href=(id:string)=>courseHref(project.id,'deepdive',encodeURIComponent(id));

 const status=$derived(session?sessionDiveStatus(project,session):weekDiveStatus(project));
 const result=$derived(session?sessionAnalysis(project,session):weeklyAnalysis(project));
 const generated=$derived(session?shortDate(session.analysis?.generated||session.generated):shortDate(project.weekly?.generated));

 // ---- which classes the weekly analysis includes (kept per course while the app is open) ----
 const ready=$derived(sessions.filter(s=>s.generation));
 let chosen=$state<Record<string,{ids:string[];known:string[]}>>({});
 const choice=$derived.by(()=>{
  const saved=chosen[project.id];
  const ids=saved?saved.ids:project.weekly?.selectedSessionIds||ready.map(s=>s.id);
  // Classes whose transcript became ready since are included by default, as before.
  const known=saved?saved.known:project.weekly?.availableSessionIds||ready.map(s=>s.id);
  return new Set([...ids,...ready.filter(s=>!known.includes(s.id)).map(s=>s.id)].filter(id=>ready.some(s=>s.id===id)));
 });
 function toggle(id:string,on:boolean){
  const next=new Set(choice);on?next.add(id):next.delete(id);
  chosen[project.id]={ids:[...next],known:ready.map(s=>s.id)};
 }

 // ---- the document, cached per generation ----
 const docKey=$derived(session?(result.available?session.id+'|'+(session.analysis?.generation||session.generation):''):(result.available?'week|'+project.weekly?.generation:''));
 let docs=$state<Record<string,string|null>>({});
 let docError=$state('');
 $effect(()=>{
  const key=docKey,scope=session?session.id:'week',name=session?'Deep_Dive.md':'Weekly_Deep_Dive.md';
  if(!key)return;
  untrack(()=>{
   if(key in docs)return;
   docs[key]=null;docError='';
   api.outputText(project.id,name,scope).then(t=>docs[key]=t,e=>{delete docs[key];docError=e instanceof ApiError?e.message:String(e);});
  });
 });
 // The page header already names the document, so a leading "# title" line is not repeated.
 const doc=$derived.by(()=>{const t=docKey?docs[docKey]:null;return typeof t==='string'?t.replace(/^\s*# [^\n]*\n+/,''):t;});

 $effect(()=>{
  askContext.set(session?{label:session.type+' · '+session.title,scope:session.id,focus:null}:{label:'本周课',scope:'week',focus:null});
 });
 $effect(()=>()=>askContext.set(null));

 // ---- the one primary action ----
 const canGenerate=$derived(session?!!session.generation&&!scriptStale(project,session):true);
 const action=$derived.by(()=>{
  if(status.kind==='running')return {label:'生成中…',disabled:true};
  if(!canGenerate)return null;
  if(status.kind==='done')return null;
  const what=session?'本节 Deep Dive':'整周 Deep Dive';
  return {label:(result.available?'更新':'生成')+what,disabled:false};
 });
 let starting=$state(false),actionError=$state('');
 async function generate(){
  starting=true;actionError='';menuOpen=false;
  try{
   if(session)await api.process(project.id,'analysis',session.id);
   else await api.processWeek(project.id,sessions.filter(s=>choice.has(s.id)).map(s=>s.id));
   await store.refresh();
  }catch(e){actionError=e instanceof ApiError?e.message:String(e);}
  finally{starting=false;}
 }

 let menuOpen=$state(false);
 let menuWrap=$state<HTMLElement>();
 function outside(event:MouseEvent){if(menuOpen&&menuWrap&&!menuWrap.contains(event.target as Node))menuOpen=false;}
 const listStatus=(s:Session)=>sessionDiveStatus(project,s);
 // The list keeps names readable: a short word here, the full status as a tooltip and in the header.
 const short=(st:{kind:string;text:string})=>({done:'✓',running:'生成中',stale:'待更新',stopped:'已停止',failed:'失败'} as Record<string,string>)[st.kind]||(st.text.startsWith('需要')?'无讲稿':st.text);
 const weekStatus=$derived(weekDiveStatus(project));
 const citationIssues=$derived((session?session.analysis?.citationIssues:project.weekly?.analysis?.citationIssues)?.length||0);
</script>

<svelte:window onclick={outside} onkeydown={e=>{if(e.key==='Escape')menuOpen=false;}}/>

<!-- The layout follows the width of the work area (sidebar and Ask panel included), not the window. -->
<div class="fit">
<div class="dive">
 <nav class="list" aria-label="Deep Dive 清单">
  <a href={href('week')} class:on={isWeek} aria-current={isWeek?'page':undefined}>
   <span class="name">整周 Deep Dive</span>
   <span class="mini {weekStatus.kind}" title={weekStatus.text}>{short(weekStatus)}</span>
  </a>
  <div class="sep" role="separator"></div>
  <span class="label">本节 Deep Dive</span>
  {#each sessions as s (s.id)}
   {@const st=listStatus(s)}
   <a href={href(s.id)} title={s.type+' · '+s.title} class:on={session?.id===s.id} aria-current={session?.id===s.id?'page':undefined}>
    <span class="name">{s.type} · {s.title}</span>
    <span class="mini {st.kind}" title={st.text}>{short(st)}</span>
   </a>
  {:else}
   <span class="none">本周还没有课堂记录。</span>
  {/each}
 </nav>

 <section class="main">
  <header class="head">
   <div class="title">
    <h1>{session?session.type+' · '+session.title:'整周 Deep Dive'}</h1>
    <StatusBadge kind={status.kind} text={status.text+(generated&&result.available?' · '+generated:'')}/>
   </div>
   <div class="end">
    {#if action}<button class="btn btn-primary" onclick={generate} disabled={action.disabled||starting}>{starting?'正在开始…':action.label}</button>{/if}
    <div class="menu" bind:this={menuWrap}>
     <button class="btn btn-quiet icon" onclick={()=>menuOpen=!menuOpen} aria-haspopup="menu" aria-expanded={menuOpen} title="更多">⋯</button>
     {#if menuOpen}
      <div class="menu-list" role="menu">
       {#if result.available&&status.kind==='done'&&canGenerate}<button role="menuitem" onclick={generate}>重新生成{session?'本节':'整周'} Deep Dive</button>{/if}
       {#if session}<a role="menuitem" href={courseHref(project.id,'class',encodeURIComponent(session.id))}>打开这节课的讲稿</a>{/if}
       {#if result.available}
        <div class="menu-sep" role="separator"></div><span class="menu-label">下载</span>
        <a role="menuitem" href={api.outputUrl(project.id,session?'Deep_Dive.md':'Weekly_Deep_Dive.md',session?session.id:'week')}>{session?'本节':'整周'} Deep Dive（Markdown）</a>
       {/if}
       {#if !session||!result.available}<span class="menu-label">没有更多操作</span>{/if}
      </div>
     {/if}
    </div>
   </div>
  </header>

  {#if isWeek}
   <div class="scope" role="group" aria-label="纳入的课堂">
    <span class="scope-label">纳入：</span>
    <span class="always">本周教学材料</span>
    {#each sessions as s (s.id)}
     <label class:off={!s.generation} title={s.generation?(scriptStale(project,s)?'讲稿待更新：纳入后会注明使用的是旧讲稿':''):'这节课还没有讲稿，不能纳入'}>
      <input type="checkbox" checked={choice.has(s.id)} disabled={!s.generation||status.kind==='running'} onchange={e=>toggle(s.id,(e.currentTarget as HTMLInputElement).checked)}/>
      {s.type} · {s.title}{#if !s.generation}<small>（无讲稿）</small>{:else if scriptStale(project,s)}<small>（讲稿待更新）</small>{/if}
     </label>
    {/each}
   </div>
  {/if}

  {#if actionError||citationIssues||session&&result.available&&scriptStale(project,session)}
   <div class="notes">
    {#if actionError}<ErrorNote text={actionError}/>{/if}
    {#if session&&result.available&&scriptStale(project,session)}<span class="note">这节课的讲稿需要先更新，之后才能更新本节 Deep Dive。<a href={courseHref(project.id,'class',encodeURIComponent(session.id))}>去课堂更新讲稿</a></span>{/if}
    {#if citationIssues&&result.available}<span class="note">有 {citationIssues} 处引用未能在提供的原文中核对，文中标为"来源待核对"。</span>{/if}
   </div>
  {/if}

  <div class="body">
   {#if session&&!session.generation}
    <div class="empty">
     <h2>需要先生成讲稿</h2>
     <p>本节 Deep Dive 以这节课的讲稿为依据。请先到"课堂"生成讲稿。</p>
     <a class="btn btn-primary" href={courseHref(project.id,'class',encodeURIComponent(session.id))}>去课堂生成讲稿</a>
    </div>
   {:else if session&&!result.available&&scriptStale(project,session)}
    <div class="empty">
     <h2>讲稿需要先更新</h2>
     <p>这节课的字幕或本周材料在讲稿生成后有变化。先在"课堂"更新讲稿，再生成本节 Deep Dive。</p>
     <a class="btn btn-primary" href={courseHref(project.id,'class',encodeURIComponent(session.id))}>去课堂更新讲稿</a>
    </div>
   {:else if !result.available}
    <div class="empty">
     <h2>{status.kind==='running'?'正在生成':session?'还没有本节 Deep Dive':'还没有整周 Deep Dive'}</h2>
     <p>{status.kind==='running'?'可以在右上角"后台任务"查看进度，完成后会显示在这里。':session?'点右上角按钮，根据这节课的讲稿和本周相关材料生成分析，不会纳入其他课堂的发言。':'勾选要纳入的课堂后点右上角按钮。没有勾选课堂时只分析本周教学材料。生成在后台进行，不会自动开始。'}</p>
    </div>
   {:else if docError}
    <div class="empty"><h2>无法读取 Deep Dive</h2><p>{docError}</p><button class="btn" onclick={()=>{docError='';delete docs[docKey];docs={...docs};}}>重试</button></div>
   {:else if doc===null||doc===undefined}
    <p class="loading">正在读取…</p>
   {:else}
    <article class="doc">
     <!-- Whether it is outdated is said once, by the status next to the title and its update button. -->
     <p class="kind">AI 分析</p>
     <RichText text={doc} {project} variant="doc"/>
    </article>
   {/if}
  </div>
 </section>
</div>
</div>

<style>
 .fit{height:100%;min-height:0;container-type:inline-size;}
 .dive{display:grid;grid-template-columns:240px minmax(0,1fr);height:100%;min-height:0;}
 .list{display:flex;flex-direction:column;gap:2px;padding:var(--space-3) var(--space-2);border-right:1px solid var(--line);background:var(--bg-surface);overflow:auto;}
 .list a{display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);color:var(--fg-muted);text-decoration:none;font-size:var(--text-sm);}
 .list a:hover{background:var(--sand-200);color:var(--fg);}
 .list a.on{background:var(--accent-soft);color:var(--accent-strong);font-weight:var(--weight-medium);}
 .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .mini{flex:none;font-size:var(--text-xs);font-weight:var(--weight-medium);}
 .mini.done{color:var(--status-done-fg);}
 .mini.running{color:var(--status-running-fg);}
 .mini.stale{color:var(--status-stale-fg);}
 .mini.stopped{color:var(--status-stopped-fg);}
 .mini.failed{color:var(--status-failed-fg);}
 .mini.idle{color:var(--fg-subtle);font-weight:400;}
 .sep{height:1px;margin:var(--space-2) var(--space-2);background:var(--line);}
 .label{padding:var(--space-1) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .none{padding:var(--space-2) var(--space-3);font-size:var(--text-sm);color:var(--fg-muted);}
 .main{display:flex;flex-direction:column;min-width:0;min-height:0;}
 .head{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-4);background:var(--bg-surface);border-bottom:1px solid var(--line);}
 .title{display:flex;align-items:center;gap:var(--space-3);min-width:0;flex-wrap:wrap;}
 h1{font-size:var(--text-lg);margin:0;}
 .end{margin-left:auto;display:flex;align-items:center;gap:var(--space-2);}
 .icon{width:32px;padding:0;justify-content:center;}
 .menu{position:relative;}
 .menu-list{position:absolute;right:0;top:calc(100% + var(--space-1));min-width:240px;padding:var(--space-1);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:10;display:flex;flex-direction:column;}
 .menu-list a,.menu-list button{display:flex;align-items:center;gap:var(--space-1);padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg);text-decoration:none;font-size:var(--text-sm);text-align:left;}
 .menu-list a:hover,.menu-list button:hover{background:var(--sand-100);}
 .menu-sep{height:1px;margin:var(--space-1) 0;background:var(--line);}
 .menu-label{padding:var(--space-1) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .scope{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-1) var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .scope-label{color:var(--fg-muted);}
 .always{padding:1px var(--space-2);border-radius:999px;background:var(--sand-200);font-size:var(--text-xs);}
 .scope label{display:flex;align-items:center;gap:var(--space-1);cursor:pointer;}
 .scope label.off{color:var(--fg-subtle);cursor:default;}
 .scope small{color:var(--fg-muted);font-size:var(--text-xs);}
 .notes{display:flex;flex-wrap:wrap;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .note{color:var(--fg-muted);}
 .error{color:var(--status-failed-fg);}
 .body{flex:1;min-height:0;overflow:auto;}
 .doc{max-width:820px;margin:0 auto;padding:var(--space-5) var(--space-5) var(--space-6);}
 .kind{display:inline-block;margin:0 0 var(--space-4);padding:1px var(--space-2);border-radius:999px;background:var(--status-stale-bg);color:var(--kind-analysis);font-size:var(--text-xs);font-weight:var(--weight-medium);}
 .empty{max-width:560px;margin:var(--space-6) auto;padding:0 var(--space-4);}
 .empty h2{font-size:var(--text-lg);margin-bottom:var(--space-2);}
 .empty p{color:var(--fg-muted);}
 .loading{padding:var(--space-5);color:var(--fg-muted);}
 /* A narrow work area: the list becomes one scrollable row above the content. */
 @container (max-width:820px){
  .dive{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);}
  .list{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line);padding:var(--space-2);}
  .list a{flex:none;}
  .sep,.label{display:none;}
 }
</style>
