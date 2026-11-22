<script lang="ts">
 import {onMount} from 'svelte';
 import StatusBadge from './StatusBadge.svelte';
 import {store} from '../lib/store.svelte';
 import {courseHref} from '../lib/router.svelte';
 import {statusWord} from '../lib/status';

 let {onclose}:{onclose:()=>void}=$props();
 // Load once per opening. (An $effect here would track store.details and re-run after every load.)
 onMount(()=>{store.loadTaskDetails();});

 function when(time?:string){
  if(!time)return '';
  const minutes=Math.round((Date.now()-Date.parse(time))/60000);
  return minutes<1?'刚刚':minutes<60?minutes+' 分钟前':Math.round(minutes/60)+' 小时前';
 }
</script>

<div class="panel" role="dialog" aria-label="后台任务">
 <header><h2>后台任务</h2><span class="hint">所有课程 · 近 24 小时完成的任务</span></header>
 {#if store.tasks.length}
  <ul>
   {#each store.tasks as t (t.courseId+t.key)}
    <li class={t.kind}>
     <div class="main">
      <div class="title"><span class="course">{t.courseName}</span>{' · '+t.action}{#if t.target}<span class="target">{' · '+t.target}</span>{/if}</div>
      {#if t.detail}<div class="detail">{t.detail}</div>{/if}
     </div>
     <div class="side">
      <StatusBadge kind={t.kind} text={t.kind==='done'?statusWord.done+' · '+when(t.time):undefined}/>
      <a class="btn btn-quiet" href={courseHref(t.courseId,'overview')} onclick={onclose}>去看看</a>
     </div>
    </li>
   {/each}
  </ul>
  <p class="note">停止或继续：点"去看看"，在对应的材料、课堂或 Deep Dive 旁操作。</p>
 {:else}
  <p class="empty">没有正在运行或需要处理的任务。</p>
 {/if}
</div>

<style>
 .panel{position:absolute;top:calc(100% + var(--space-2));right:0;width:min(520px,calc(100vw - 32px));max-height:min(70vh,560px);overflow:auto;background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:20;}
 header{display:flex;align-items:baseline;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg-raised);}
 h2{font-size:var(--text-md);}
 .hint{font-size:var(--text-xs);color:var(--fg-muted);}
 ul{list-style:none;margin:0;padding:var(--space-1) 0;}
 li{display:flex;gap:var(--space-3);align-items:flex-start;justify-content:space-between;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--line);}
 li:last-child{border-bottom:0;}
 .main{min-width:0;}
 .title{font-size:var(--text-sm);}
 .course{font-weight:var(--weight-medium);}
 .target{color:var(--fg-muted);overflow-wrap:anywhere;}
 .detail{margin-top:2px;font-size:var(--text-xs);color:var(--fg-muted);overflow-wrap:anywhere;}
 li.failed .detail{color:var(--status-failed-fg);}
 li.stopped .detail{color:var(--status-stopped-fg);}
 .side{display:flex;flex-direction:column;align-items:flex-end;gap:var(--space-1);flex:none;}
 .empty,.note{margin:0;padding:var(--space-4);font-size:var(--text-sm);color:var(--fg-muted);}
 .note{padding-top:var(--space-2);font-size:var(--text-xs);}
</style>
