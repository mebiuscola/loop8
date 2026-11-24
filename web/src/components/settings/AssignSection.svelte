<script lang="ts">
 import ModelPicker from './ModelPicker.svelte';
 import {TASKS,FOLLOWS,THINKING_DEFAULT,type SettingsModel} from '../../lib/settings.svelte';
 let {model}:{model:SettingsModel}=$props();
 const groups=$derived(model.options());
 const empty=$derived(!groups.some(g=>g.items.length));
 const followName=(task:string)=>TASKS.flatMap(([,t])=>t).find(([k])=>k===FOLLOWS[task])?.[1]||'';

 /** Choices of the thinking picker of a function: what it inherits, then the levels its model offers. */
 function thinking(task:string){
  const route=model.routeOf(task),kind=model.parts(route).kind,choices=model.thinkingChoices(route);
  const inherited=model.inheritedThinking(task),own=model.parts(route).thinking;
  const first:[string,string]=['',inherited?'跟随 · '+model.thinkingName(inherited,kind):own?'模型默认（'+model.thinkingName(own,kind)+'）':'模型默认'];
  const value=model.assign.modelThinking[task]||'';
  // A level saved for another model stays visible, marked, until it is changed.
  const items=value&&!choices.some(([v])=>v===value)?[...choices,[value,model.thinkingName(value,kind)+'（此模型不支持）'] as [string,string]]:choices;
  return {kind,items,first,value,waiting:kind==='acp'&&!choices.length};
 }
</script>

{#snippet assignment(id:string,task:string,value:string,set:(v:string)=>void,first:string,label:string)}
 {@const t=thinking(task)}
 <div class="pick">
  <ModelPicker {id} {label} value={model.pickerValue(value)} {groups} first={['',first]} onpick={v=>set(v)}/>
  {#if t.kind}
   <ModelPicker compact id={id+'-thinking'} label={label+'的思考强度'} value={t.value} groups={t.items.length?[{label:'思考强度',items:t.items}]:[]}
    first={t.waiting?['','刷新模型后可选']:t.first} disabled={t.waiting} onpick={level=>model.setThinking(task,level)}/>
  {/if}
 </div>
{/snippet}

{#if empty}
 <p class="notice">还没有可用的模型。先到"服务与账号"登录 Antigravity 或 ChatGPT，或添加一个 API 连接。</p>
{/if}

<div class="default">
 <span class="title">默认模型</span>
 {@render assignment('default-model',THINKING_DEFAULT,model.assign.defaultId,v=>model.assign.defaultId=v,'未选择','默认模型')}
 <small>下面没有单独指定的功能都用它。</small>
</div>

{#each TASKS as [title,tasks] (title)}
 <h3>{title}</h3>
 <div class="table">
  {#each tasks as [task,label] (task)}
   <div class="row">
    <span class="title">{label}</span>
    {@render assignment('route-'+task,task,model.assign.modelRoutes[task]||'',v=>model.assign.modelRoutes[task]=v,FOLLOWS[task]?'跟随'+followName(task):'使用默认模型',label)}
    <span class="actual" class:missing={model.actual(task)==='未选择模型'} title={'实际使用：'+model.actual(task)}>→ {model.actual(task)}</span>
   </div>
  {/each}
 </div>
{/each}

<h3>备用模型</h3>
<div class="fallback">
 <label class="check"><input type="checkbox" bind:checked={model.assign.fallbackEnabled}/>主模型失败时改用备用模型重试</label>
 <div class="fallback-pick"><ModelPicker id="fallback-model" label="备用模型" value={model.pickerValue(model.assign.fallbackProfileId)} {groups} first={['','未选择']} onpick={v=>model.assign.fallbackProfileId=v}/></div>
</div>
<p class="hint">选择 Antigravity 或 ChatGPT 的模型后保存，会自动为它建立连接。每项功能可在模型旁单独选择思考强度：Antigravity 用账号提供的级别（刷新可用模型后出现），ChatGPT 用该模型列出的级别，API 连接按 OpenAI 兼容的 reasoning_effort 发送低/中/高（模型不支持时接口会报错，可改回"模型默认"）。没有单独选择的功能跟随默认模型或所跟随功能的设置。"整课检查""参考文献翻译"不需要深度推理，可选较低的思考强度以加快速度。</p>

<style>
 .notice{padding:var(--space-3);border-radius:var(--radius-sm);background:var(--status-stopped-bg);color:var(--status-stopped-fg);font-size:var(--text-sm);}
 .default{display:grid;grid-template-columns:auto minmax(260px,460px) 1fr;align-items:center;gap:var(--space-3);margin-bottom:var(--space-5);font-size:var(--text-sm);}
 .default .title{font-weight:var(--weight-bold);}
 small,.hint{color:var(--fg-muted);font-size:var(--text-xs);}
 h3{font-size:var(--text-md);margin:var(--space-4) 0 var(--space-2);}
 .table{border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);}
 .row{display:grid;grid-template-columns:minmax(120px,170px) minmax(260px,460px) 1fr;gap:var(--space-3);align-items:center;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .row:last-child{border-bottom:0;}
 .pick{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-2);align-items:center;}
 .pick :global(.compact){width:150px;}
 .actual{color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .actual.missing{color:var(--status-stopped-fg);}
 .fallback{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);font-size:var(--text-sm);}
 .fallback-pick{min-width:320px;}
 .check{display:flex;align-items:center;gap:var(--space-2);}
 .hint{margin-top:var(--space-4);}
</style>
