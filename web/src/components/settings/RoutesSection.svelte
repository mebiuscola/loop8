<script lang="ts">
 import type {Settings} from '../../lib/api';
 let {saved,draft}:{saved:Settings;draft:{modelRoutes:Record<string,string>;fallbackProfileId:string;fallbackEnabled:boolean}}=$props();

 // Same task list and labels as lib/model-routing.mjs MODEL_TASKS.
 const groups:[string,[string,string][]][]=[
  ['课件与文献',[['pptRecognition','课件识别'],['pptTranslation','课件翻译'],['pptExplanation','课件解读'],['pptPreview','单页 PPT 试解析'],['referenceTranslation','参考文献翻译'],['pdfRecognition','文献 AI 补救']]],
  ['课堂与分析',[['classroom','课堂重建'],['transcriptTranslation','讲稿翻译'],['deepDive','本节 Deep Dive'],['weeklyDeepDive','整周 Deep Dive'],['context','材料背景整理'],['qa','提问（Ask）']]],
 ];
 const providerLabel=(p:Settings['modelProfiles'][number])=>p.provider==='chatgpt-plan'?'ChatGPT 订阅':p.provider==='antigravity-acp'?'ACP':'API';
 const name=(id:string)=>saved.modelProfiles.find(p=>p.id===id)?.name||'';
 function actual(task:string):string{
  const id=draft.modelRoutes[task];
  if(id)return name(id);
  if(task==='pptPreview')return actual('pptRecognition');
  return name(saved.defaultProfileId)||'未选择模型';
 }
</script>

{#each groups as [title,tasks] (title)}
 <h3>{title}</h3>
 <div class="table" role="table">
  {#each tasks as [task,label] (task)}
   <div class="row" role="row">
    <span role="cell" class="label">{label}</span>
    <select role="cell" bind:value={draft.modelRoutes[task]} aria-label={label+'使用的模型'}>
     <option value="">{task==='pptPreview'?'跟随课件识别':'使用默认模型'}</option>
     {#each saved.modelProfiles as p (p.id)}<option value={p.id}>{p.name} · {providerLabel(p)}</option>{/each}
    </select>
    <span role="cell" class="actual" class:missing={actual(task)==='未选择模型'}>{actual(task)}</span>
   </div>
  {/each}
 </div>
{/each}

<h3>备用模型</h3>
<div class="fallback">
 <label class="check"><input type="checkbox" bind:checked={draft.fallbackEnabled}/>主模型失败时改用备用模型重试</label>
 <select bind:value={draft.fallbackProfileId} disabled={!draft.fallbackEnabled} aria-label="备用模型">
  <option value="">未选择</option>
  {#each saved.modelProfiles as p (p.id)}<option value={p.id}>{p.name} · {providerLabel(p)}</option>{/each}
 </select>
</div>

<style>
 h3{font-size:var(--text-md);margin:0 0 var(--space-2);}
 .table+h3{margin-top:var(--space-5);}
 .table{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);}
 .row{display:grid;grid-template-columns:minmax(120px,180px) minmax(200px,1fr) minmax(120px,200px);gap:var(--space-3);align-items:center;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .row:last-child{border-bottom:0;}
 select{height:32px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .actual{color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .actual.missing{color:var(--status-stopped-fg);}
 .fallback{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);font-size:var(--text-sm);}
 .check{display:flex;align-items:center;gap:var(--space-2);}
 .fallback select{min-width:260px;}
</style>
