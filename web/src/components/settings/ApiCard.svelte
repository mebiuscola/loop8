<script lang="ts">
 // Connections to OpenAI-compatible APIs. A connection has one address and key and any number of
 // models; each model is assigned to functions on its own (docs/API.md: connectionId).
 import JobView from './JobView.svelte';
 import {api,type ModelProfile} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';
 import type {SettingsModel} from '../../lib/settings.svelte';

 let {model}:{model:SettingsModel}=$props();
 let open=$state<string|null>(null);
 const runs=new Map<string,JobRun>();
 const runOf=(id:string)=>{let r=runs.get(id);if(!r){r=new JobRun();runs.set(id,r);}return r;};
 async function check(p:ModelProfile,kind:'ai'|'vision'){
  const snap=$state.snapshot(p) as ModelProfile;if(!snap.apiKey)delete snap.apiKey;
  try{await runOf(p.id).run(()=>api.modelTest(kind,snap));}catch{/* shown below */}
 }
 let confirming=$state<string|null>(null);
 const isSaved=(id:string)=>!!model.saved?.modelProfiles.some(p=>p.id===id);
 const usedBy=(models:ModelProfile[])=>models.flatMap(p=>model.usage(p.id));
 const set=(id:string,key:'name'|'baseUrl'|'outputTokenField'|'apiKey'|'clearApiKey')=>(e:Event)=>{
  const el=e.currentTarget as HTMLInputElement|HTMLSelectElement;
  model.setConnection(id,key,el instanceof HTMLInputElement&&el.type==='checkbox'?el.checked:el.value);
 };
 function add(){open=model.addApi();}
 function addModel(id:string){model.addModel(id);open=id;}
</script>

<section class="card">
 <header>
  <div>
   <h2>API 连接</h2>
   <p>OpenAI 兼容接口（如 DeepSeek、OpenAI、Gemini API）。每个连接填写一次地址和密钥，可以添加多个模型，分别分配给不同功能。</p>
  </div>
  <button class="btn" type="button" onclick={add}>＋ 添加 API 连接</button>
 </header>

 {#each model.connections as c (c.id)}
  {@const first=c.models[0]}
  {@const used=usedBy(c.models)}
  {@const dirty=c.models.some(p=>model.profileDirty(p))}
  <div class="item" class:open={open===c.id}>
   <button class="summary" type="button" onclick={()=>open=open===c.id?null:c.id} aria-expanded={open===c.id}>
    <span class="title">{first.name||'未命名连接'}{#if dirty}<span class="dot" title="有未保存的修改"> ●</span>{/if}</span>
    <span class="meta">{c.models.map(p=>p.model||'未填写模型').join('、')} · {c.models.some(p=>isSaved(p.id))?(used.length?'用于 '+used.length+' 项':'未分配'):'未保存'}{first.hasApiKey||first.apiKey?'':' · 缺少密钥'}</span>
   </button>
   {#if open===c.id}
    <div class="editor">
     <div class="connection">
      <label class="field"><span>名称</span><input type="text" value={first.name} oninput={set(c.id,'name')}/></label>
      <label class="field wide"><span>API 地址</span><input type="url" value={first.baseUrl} oninput={set(c.id,'baseUrl')} placeholder="https://…/v1" spellcheck="false"/></label>
      <label class="field"><span>API 密钥</span>
       <input type="password" value={first.apiKey} oninput={set(c.id,'apiKey')} autocomplete="new-password" spellcheck="false" disabled={first.clearApiKey} placeholder={first.hasApiKey&&!first.clearApiKey?'已保存，留空则保留':'粘贴密钥'}/>
       {#if first.hasApiKey}<small><label class="inline"><input type="checkbox" checked={first.clearApiKey} onchange={set(c.id,'clearApiKey')}/>保存时清除已存密钥</label></small>{/if}
      </label>
      <label class="field"><span>输出参数名</span><select value={first.outputTokenField} onchange={set(c.id,'outputTokenField')}><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option></select></label>
     </div>

     <div class="models" role="list" aria-label="这个连接的模型">
      <div class="models-head"><span>模型</span><button class="btn btn-quiet" type="button" onclick={()=>addModel(c.id)}>＋ 添加模型</button></div>
      {#each c.models as p (p.id)}
       {@const run=runOf(p.id)}
       {@const pUsed=model.usage(p.id)}
       <div class="model" role="listitem">
        <div class="model-fields">
         <label class="field"><span>模型名称</span><input type="text" bind:value={p.model} spellcheck="false" placeholder="例如 deepseek-chat"/></label>
         <label class="field"><span>上下文字符额度</span><input type="number" bind:value={p.contextChars} min="20000" max="2000000"/></label>
         <label class="field"><span>输出 Token 上限</span><input type="number" bind:value={p.maxOutputTokens} min="1000" max="100000"/></label>
         <label class="inline"><input type="checkbox" checked={p.visionEnabled!==false} onchange={e=>p.visionEnabled=(e.currentTarget as HTMLInputElement).checked}/>允许图片输入</label>
        </div>
        <div class="actions">
         <small class="use">{isSaved(p.id)?(pUsed.length?'用于：'+pUsed.join('、'):'未分配'):'未保存'}</small>
         <span class="spacer"></span>
         <button class="btn" type="button" disabled={run.state.running} onclick={()=>check(p,'ai')} title={'发送一个很短的请求，要求只回复 {"status":"ok"}：检查地址、密钥、模型名称是否可用，以及能否按要求返回 JSON。最长等待 2 分钟。'}>测试文字 / JSON</button>
         <button class="btn" type="button" disabled={run.state.running} onclick={()=>check(p,'vision')} title='发送一张小图表，检查模型能否读出其中两个数值（课件识别要用到图片输入）。最长等待 2 分钟。'>测试图片</button>
         {#if c.models.length>1}
          {#if confirming===p.id}
           <span class="confirm">{pUsed.length?'删除后，'+pUsed.join('、')+'将改用默认模型。':'删除这个模型？'}
            <button class="btn danger" type="button" disabled={model.saving} onclick={()=>{confirming=null;model.remove(p.id);}}>确定删除</button>
            <button class="btn btn-quiet" type="button" onclick={()=>confirming=null}>取消</button></span>
          {:else}<button class="btn btn-quiet danger-text" type="button" onclick={()=>confirming=p.id}>删除模型</button>{/if}
         {/if}
        </div>
        <JobView job={run.state}/>
       </div>
      {/each}
     </div>

     <div class="actions">
      <span class="spacer"></span>
      {#if confirming===c.id}
       <span class="confirm">{used.length?'删除后，'+used.join('、')+'将改用默认模型。':'删除这个连接和它的 '+c.models.length+' 个模型？'}
        <button class="btn danger" type="button" disabled={model.saving} onclick={()=>{confirming=null;model.removeConnection(c.id);}}>确定删除</button>
        <button class="btn btn-quiet" type="button" onclick={()=>confirming=null}>取消</button></span>
      {:else}<button class="btn btn-quiet danger-text" type="button" onclick={()=>confirming=c.id}>删除连接</button>{/if}
     </div>
    </div>
   {/if}
  </div>
 {:else}
  <p class="muted">还没有 API 连接。</p>
 {/each}
</section>

<style>
 .card{padding:var(--space-4) var(--space-5);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-surface);display:flex;flex-direction:column;gap:var(--space-2);}
 header{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4);margin-bottom:var(--space-2);}
 h2{font-size:var(--text-lg);}
 header p{margin:var(--space-1) 0 0;color:var(--fg-muted);font-size:var(--text-sm);}
 .item{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-raised);}
 .summary{width:100%;display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border:0;background:transparent;text-align:left;}
 .title{font-weight:var(--weight-medium);font-size:var(--text-sm);}
 .dot{color:var(--status-stopped-fg);font-size:10px;}
 .meta{color:var(--fg-muted);font-size:var(--text-xs);text-align:right;}
 .editor{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-3);border-top:1px solid var(--line);}
 .connection{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-3);}
 .field{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);}
 .field.wide{grid-column:span 2;}
 .field>span{font-weight:var(--weight-medium);}
 input:not([type=checkbox]),select{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .inline{display:inline-flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);}
 .models{display:flex;flex-direction:column;gap:var(--space-2);}
 .models-head{display:flex;align-items:center;justify-content:space-between;font-size:var(--text-sm);font-weight:var(--weight-medium);}
 .model{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-surface);}
 .model-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-3);align-items:end;}
 .actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);}
 .use{max-width:50%;}
 .spacer{flex:1;}
 .confirm{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);color:var(--status-failed-fg);font-size:var(--text-xs);}
 .danger{border-color:var(--status-failed-fg);color:var(--status-failed-fg);}
 .danger-text{color:var(--status-failed-fg);}
 .muted{color:var(--fg-muted);font-size:var(--text-sm);margin:0;}
 @media (max-width:900px){.field.wide{grid-column:auto;}}
</style>
