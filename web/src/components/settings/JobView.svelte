<script lang="ts">
 import type {JobState} from '../../lib/jobs.svelte';
 let {job}:{job:JobState}=$props();
 let copied=$state(false);
 async function copy(){try{await navigator.clipboard.writeText(job.loginUrl);copied=true;}catch{copied=false;}}
</script>

{#if job.running||job.message}
 <div class="job" class:failed={job.failed} role="status" aria-live="polite">
  {#if job.running}
   <div class="line"><span class="stage">{job.stage||'进行中…'}</span><button class="btn btn-quiet" type="button" onclick={job.cancel}>停止</button></div>
   {#if job.loginUrl}
    <div class="login">
     <a class="btn btn-primary" href={job.loginUrl} target="_blank" rel="noopener noreferrer">打开 Google 登录页面</a>
     <button class="btn" type="button" onclick={copy}>{copied?'已复制':'复制登录链接'}</button>
     <small>如果浏览器没有自动打开，请用上面的按钮登录；登录由你本人在浏览器中完成。</small>
    </div>
   {/if}
   {#if job.permission}
    <div class="permission">
     <strong>Antigravity 请求：{job.permission.title}</strong>
     {#if job.permission.details}<details><summary>查看操作内容</summary><pre>{job.permission.details}</pre></details>{/if}
     <div class="choices">
      {#each job.permission.options.filter(o=>o.kind!=='allow_always') as o (o.optionId)}
       <button class="btn" type="button" onclick={()=>job.answer(o.optionId)}>{o.kind==='allow_once'?'仅允许这一次':o.name}</button>
      {/each}
      <button class="btn btn-quiet" type="button" onclick={()=>job.answer(null)}>取消此操作</button>
     </div>
    </div>
   {/if}
   {#if job.text}<pre class="text">{job.text}</pre>{/if}
  {:else}
   <div class="line"><span>{job.message}</span></div>
  {/if}
 </div>
{/if}

<style>
 .job{margin-top:var(--space-2);padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);background:var(--status-running-bg);color:var(--status-running-fg);font-size:var(--text-sm);}
 .job.failed{background:var(--status-failed-bg);color:var(--status-failed-fg);}
 .line{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);}
 .login,.permission{margin-top:var(--space-2);display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);color:var(--fg);}
 .permission{flex-direction:column;align-items:flex-start;}
 .choices{display:flex;flex-wrap:wrap;gap:var(--space-2);}
 small{color:var(--fg-muted);}
 pre{max-height:160px;overflow:auto;white-space:pre-wrap;margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--fg);}
</style>
