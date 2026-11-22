<script lang="ts">
 import {TASKS,type SettingsModel} from '../../lib/settings.svelte';
 let {model}:{model:SettingsModel}=$props();
 const groups=$derived(model.options());
 const empty=$derived(!groups.some(g=>g.items.length));
</script>

{#snippet choices(first:string)}
 <option value="">{first}</option>
 {#each groups as g (g.label)}
  <optgroup label={g.label}>{#each g.items as [v,t] (v)}<option value={v}>{t}</option>{/each}</optgroup>
 {/each}
{/snippet}

{#if empty}
 <p class="notice">还没有可用的模型。先到"服务与账号"登录 Antigravity 或 ChatGPT，或添加一个 API 连接。</p>
{/if}

<div class="default">
 <label for="default-model">默认模型</label>
 <select id="default-model" bind:value={model.assign.defaultId}>{@render choices('未选择')}</select>
 <small>下面没有单独指定的功能都用它。</small>
</div>

{#each TASKS as [title,tasks] (title)}
 <h3>{title}</h3>
 <div class="table">
  {#each tasks as [task,label] (task)}
   <div class="row">
    <label for={'route-'+task}>{label}</label>
    <select id={'route-'+task} bind:value={model.assign.modelRoutes[task]}>{@render choices(task==='pptPreview'?'跟随课件识别':'使用默认模型')}</select>
    <span class="actual" class:missing={model.actual(task)==='未选择模型'} title="实际使用">→ {model.actual(task)}</span>
   </div>
  {/each}
 </div>
{/each}

<h3>备用模型</h3>
<div class="fallback">
 <label class="check"><input type="checkbox" bind:checked={model.assign.fallbackEnabled}/>主模型失败时改用备用模型重试</label>
 <select bind:value={model.assign.fallbackProfileId} disabled={!model.assign.fallbackEnabled} aria-label="备用模型">{@render choices('未选择')}</select>
</div>
<p class="hint">选择 Antigravity 或 ChatGPT 的模型后保存，会自动为它建立连接；它的上下文额度、图片输入和测试在"服务与账号"中。</p>

<style>
 .notice{padding:var(--space-3);border-radius:var(--radius-sm);background:var(--status-stopped-bg);color:var(--status-stopped-fg);font-size:var(--text-sm);}
 .default{display:grid;grid-template-columns:auto minmax(240px,380px) 1fr;align-items:center;gap:var(--space-3);margin-bottom:var(--space-5);font-size:var(--text-sm);}
 .default label{font-weight:var(--weight-bold);}
 small,.hint{color:var(--fg-muted);font-size:var(--text-xs);}
 h3{font-size:var(--text-md);margin:var(--space-4) 0 var(--space-2);}
 .table{border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);}
 .row{display:grid;grid-template-columns:minmax(120px,170px) minmax(220px,360px) 1fr;gap:var(--space-3);align-items:center;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .row:last-child{border-bottom:0;}
 select{height:32px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .actual{color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .actual.missing{color:var(--status-stopped-fg);}
 .fallback{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);font-size:var(--text-sm);}
 .fallback select{min-width:280px;}
 .check{display:flex;align-items:center;gap:var(--space-2);}
 .hint{margin-top:var(--space-4);}
</style>
