<script lang="ts">
 import Icon from './Icon.svelte';
 import {store} from '../lib/store.svelte';
 import {router,courseHref} from '../lib/router.svelte';
 import {api,ApiError} from '../lib/api';

 let {collapsed=$bindable(false)}:{collapsed?:boolean}=$props();

 const dotText={running:'有任务在运行',attention:'有停止或失败的任务',ready:'没有未完成的任务'};
 /** Short label for the collapsed list: capitals and digits, e.g. "DebateW4" → "DW4". */
 function abbrev(name:string){
  const marks=name.match(/[A-Z]|\d+/g)?.join('')||'';
  return (marks||name).slice(0,4);
 }
 let creating=$state(false),name=$state(''),createError=$state(''),busy=$state(false);
 const activeId=$derived(router.route.page==='course'?router.route.courseId:null);

 async function create(event:SubmitEvent){
  event.preventDefault();
  if(!name.trim())return;
  busy=true;createError='';
  try{const p=await api.createProject(name.trim());await store.refresh();creating=false;name='';router.go(courseHref(p.id,'overview'));}
  catch(e){createError=e instanceof ApiError?e.message:String(e);}
  finally{busy=false;}
 }
</script>

<nav class="sidebar" class:collapsed aria-label="课程">
 <div class="head">
  <a class="brand" href="#/" title="Classroom"><Icon name="book"/>{#if !collapsed}<span>Classroom</span>{/if}</a>
  <button class="toggle" onclick={()=>collapsed=!collapsed} title={collapsed?'展开课程列表':'收起课程列表'} aria-expanded={!collapsed}>
   <Icon name={collapsed?'chevron-right':'chevron-left'} size={16}/>
  </button>
 </div>

 {#if !collapsed}
  <div class="section-label">每周课程</div>
  <ul class="courses">
   {#each store.projects as p (p.id)}
    {@const state=store.courseState(p)}
    <li>
     <a href={courseHref(p.id)} class:active={p.id===activeId} aria-current={p.id===activeId?'page':undefined} title={p.name}>
      <span class="dot {state}" title={dotText[state]}><span class="visually-hidden">{dotText[state]}</span></span>
      <span class="name">{p.name}</span>
     </a>
    </li>
   {:else}
    {#if store.loaded&&!store.connectionError}<li class="empty">还没有课程</li>{/if}
   {/each}
  </ul>

  {#if creating}
   <form class="create" onsubmit={create}>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={name} placeholder="例如 Week 05 · Topic" aria-label="新课程名称" autofocus disabled={busy}/>
    <div class="create-actions">
     <button type="button" class="btn btn-quiet light" onclick={()=>{creating=false;createError='';}}>取消</button>
     <button type="submit" class="btn btn-primary" disabled={busy||!name.trim()}>创建</button>
    </div>
    {#if createError}<p class="error" role="alert">{createError}</p>{/if}
   </form>
  {:else}
   <button class="add" onclick={()=>creating=true}><Icon name="plus" size={16}/>新建一周</button>
  {/if}
 {:else}
  <ul class="courses mini">
   {#each store.projects as p (p.id)}
    {@const state=store.courseState(p)}
    <li><a href={courseHref(p.id)} class:active={p.id===activeId} title={p.name+' · '+dotText[state]}><span class="dot {state}"></span><span class="initial">{abbrev(p.name)}</span></a></li>
   {/each}
  </ul>
 {/if}

 <div class="foot">
  <a class="settings" class:active={router.route.page==='settings'} href="#/settings" title="设置"><Icon name="gear" size={16}/>{#if !collapsed}<span>设置</span>{/if}</a>
  {#if !collapsed}<span class="version">v{__APP_VERSION__}</span>{/if}
 </div>
</nav>

<style>
 .sidebar{display:flex;flex-direction:column;height:100%;background:var(--bg-sidebar);color:var(--fg-sidebar);padding:var(--space-3) var(--space-2);gap:var(--space-2);overflow:hidden;}
 .head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);padding:0 var(--space-1);min-height:36px;}
 .collapsed .head{flex-direction:column;}
 .brand{display:flex;align-items:center;gap:var(--space-2);color:var(--fg-sidebar);text-decoration:none;font-weight:var(--weight-bold);font-size:var(--text-lg);}
 .toggle{display:grid;place-items:center;width:28px;height:28px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.18);background:transparent;color:var(--fg-sidebar);}
 .toggle:hover{background:var(--bg-sidebar-active);}
 .section-label{margin-top:var(--space-3);padding:0 var(--space-2);font-size:var(--text-xs);color:var(--fg-sidebar-muted);}
 .courses{list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:2px;}
 .courses a{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);color:var(--fg-sidebar);text-decoration:none;font-size:var(--text-sm);}
 .courses a:hover{background:var(--bg-sidebar-active);}
 .courses a.active{background:var(--bg-sidebar-active);box-shadow:inset 3px 0 0 var(--sand-100);font-weight:var(--weight-medium);}
 .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .empty{padding:var(--space-2);font-size:var(--text-sm);color:var(--fg-sidebar-muted);}
 .dot{flex:none;width:8px;height:8px;border-radius:50%;}
 .dot.ready{background:var(--fg-sidebar-muted);}
 .dot.running{background:var(--status-running-bg);box-shadow:0 0 0 2px rgba(227,238,246,.35);}
 .dot.attention{background:var(--status-stopped-bg);outline:2px solid var(--status-stopped-fg);outline-offset:-1px;}
 .mini a{justify-content:center;flex-direction:column;gap:2px;padding:var(--space-1);}
 .initial{font-size:var(--text-xs);}
 .add{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);border:1px dashed rgba(255,255,255,.3);background:transparent;color:var(--fg-sidebar);font-size:var(--text-sm);}
 .add:hover{background:var(--bg-sidebar-active);}
 .create{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:var(--bg-sidebar-active);}
 .create input{height:32px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid transparent;background:var(--bg-raised);color:var(--fg);}
 .create-actions{display:flex;justify-content:flex-end;gap:var(--space-2);}
 .light{color:var(--fg-sidebar);}
 .light:hover:not(:disabled){background:var(--bg-sidebar-active);}
 .error{margin:0;font-size:var(--text-xs);color:var(--status-stopped-bg);}
 .foot{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);padding-top:var(--space-2);border-top:1px solid rgba(255,255,255,.12);}
 .collapsed .foot{justify-content:center;}
 .settings{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);color:var(--fg-sidebar);text-decoration:none;font-size:var(--text-sm);}
 .settings:hover,.settings.active{background:var(--bg-sidebar-active);}
 .version{font-size:var(--text-xs);color:var(--fg-sidebar-muted);}
</style>
