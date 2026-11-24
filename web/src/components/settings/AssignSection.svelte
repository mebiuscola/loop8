<script lang="ts">
 import ModelPicker from './ModelPicker.svelte';
 import {TASKS,type SettingsModel} from '../../lib/settings.svelte';
 let {model}:{model:SettingsModel}=$props();
 const groups=$derived(model.options());
 const empty=$derived(!groups.some(g=>g.items.length));
 const levels=$derived<[string,string][]>(model.thinkingLevels.map(l=>[l.value,l.name]));
 /** Sets an assignment: the picked model, keeping the thinking level chosen before when it is Antigravity. */
 const choose=(old:string,picked:string)=>picked?model.withThinking(picked,model.parts(old).thinking):'';
 const isAcp=(value:string)=>model.parts(value).kind==='acp';
</script>

{#snippet assignment(id:string,value:string,set:(v:string)=>void,first:string,label:string)}
 <div class="pick">
  <ModelPicker {id} {label} value={model.pickerValue(value)} {groups} first={['',first]} onpick={v=>set(choose(value,v))}/>
  {#if isAcp(value)&&levels.length}
   <ModelPicker compact id={id+'-thinking'} label={label+'的思考强度'} value={model.parts(value).thinking} groups={[{label:'思考强度',items:levels}]} first={['','模型默认']} onpick={t=>set(model.withThinking(value,t))}/>
  {/if}
 </div>
{/snippet}

{#if empty}
 <p class="notice">还没有可用的模型。先到"服务与账号"登录 Antigravity 或 ChatGPT，或添加一个 API 连接。</p>
{/if}

<div class="default">
 <span class="title">默认模型</span>
 {@render assignment('default-model',model.assign.defaultId,v=>model.assign.defaultId=v,'未选择','默认模型')}
 <small>下面没有单独指定的功能都用它。</small>
</div>

{#each TASKS as [title,tasks] (title)}
 <h3>{title}</h3>
 <div class="table">
  {#each tasks as [task,label] (task)}
   <div class="row">
    <span class="title">{label}</span>
    {@render assignment('route-'+task,model.assign.modelRoutes[task]||'',v=>model.assign.modelRoutes[task]=v,task==='pptPreview'||task==='deckReview'?'跟随课件识别':'使用默认模型',label)}
    <span class="actual" class:missing={model.actual(task)==='未选择模型'} title={'实际使用：'+model.actual(task)}>→ {model.actual(task)}</span>
   </div>
  {/each}
 </div>
{/each}

<h3>备用模型</h3>
<div class="fallback">
 <label class="check"><input type="checkbox" bind:checked={model.assign.fallbackEnabled}/>主模型失败时改用备用模型重试</label>
 <div class="fallback-pick">{@render assignment('fallback-model',model.assign.fallbackProfileId,v=>model.assign.fallbackProfileId=v,'未选择','备用模型')}</div>
</div>
<p class="hint">选择 Antigravity 或 ChatGPT 的模型后保存，会自动为它建立连接；Antigravity 模型可在旁边选择思考强度（读取模型列表后可选）。上下文额度、图片输入和测试在"服务与账号"中。"整课检查"在课件全部页面完成后统一术语、去掉重复介绍，不需要深度推理，可选较低的思考强度以加快速度。</p>

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
 .pick :global(.compact){width:130px;}
 .actual{color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .actual.missing{color:var(--status-stopped-fg);}
 .fallback{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);font-size:var(--text-sm);}
 .fallback-pick{min-width:320px;}
 .check{display:flex;align-items:center;gap:var(--space-2);}
 .hint{margin-top:var(--space-4);}
</style>
