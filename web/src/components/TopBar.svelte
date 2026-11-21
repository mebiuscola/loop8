<script lang="ts">
 import Icon from './Icon.svelte';
 import TaskPanel from './TaskPanel.svelte';
 import {store} from '../lib/store.svelte';
 import {router,workspaces,courseHref} from '../lib/router.svelte';

 let {askOpen=$bindable(false),askAvailable=false}:{askOpen?:boolean;askAvailable?:boolean}=$props();
 let tasksOpen=$state(false);
 let wrap:HTMLElement;

 const route=$derived(router.route);
 const title=$derived(route.page==='course'?(store.current?.name||store.projects.find(p=>p.id===route.courseId)?.name||''):route.page==='settings'?'设置':'');
 const running=$derived(store.tasks.filter(t=>t.kind==='running').length);
 const attention=$derived(store.tasks.filter(t=>t.kind==='failed'||t.kind==='stopped').length);

 function outside(event:MouseEvent){if(tasksOpen&&wrap&&!wrap.contains(event.target as Node))tasksOpen=false;}
 function key(event:KeyboardEvent){if(event.key==='Escape')tasksOpen=false;}
</script>

<svelte:window onclick={outside} onkeydown={key}/>

<header class="topbar">
 <div class="title" title={title}>{title}</div>

 {#if route.page==='course'}
  <nav class="tabs" aria-label="工作区">
   {#each workspaces as w (w.id)}
    <a href={courseHref(route.courseId,w.id)} class:active={route.workspace===w.id} aria-current={route.workspace===w.id?'page':undefined}>{w.label}</a>
   {/each}
  </nav>
 {/if}

 <div class="actions">
  <div class="tasks" bind:this={wrap}>
   <button class="btn btn-quiet" class:busy={running} onclick={()=>tasksOpen=!tasksOpen} aria-expanded={tasksOpen} aria-haspopup="dialog" title="后台任务">
    <Icon name="tasks" size={16}/>
    {#if running}<span>{running} 个任务进行中</span>{:else if attention}<span class="warn">{attention} 个任务待处理</span>{:else}<span class="visually-hidden">后台任务</span>{/if}
   </button>
   {#if tasksOpen}<TaskPanel onclose={()=>tasksOpen=false}/>{/if}
  </div>
  {#if askAvailable}
   <button class="btn" class:btn-primary={askOpen} onclick={()=>askOpen=!askOpen} aria-pressed={askOpen}><Icon name="ask" size={16}/>提问</button>
  {/if}
 </div>
</header>

<style>
 .topbar{display:flex;align-items:center;gap:var(--space-4);height:var(--topbar-height);padding:0 var(--space-4);background:var(--bg-surface);border-bottom:1px solid var(--line);}
 .title{font-size:var(--text-lg);font-weight:var(--weight-bold);max-width:28ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .tabs{display:flex;gap:var(--space-1);height:100%;}
 .tabs a{display:flex;align-items:center;padding:0 var(--space-3);color:var(--fg-muted);text-decoration:none;font-size:var(--text-sm);border-bottom:2px solid transparent;}
 .tabs a:hover{color:var(--fg);}
 .tabs a.active{color:var(--accent-strong);border-bottom-color:var(--accent);font-weight:var(--weight-medium);}
 .actions{margin-left:auto;display:flex;align-items:center;gap:var(--space-2);}
 .tasks{position:relative;}
 .busy{color:var(--status-running-fg);}
 .warn{color:var(--status-stopped-fg);}
</style>
