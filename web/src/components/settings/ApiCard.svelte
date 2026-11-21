<script lang="ts">
 // Connections to OpenAI-compatible APIs: each has its own address, key and model.
 import JobView from './JobView.svelte';
 import {api,type ModelProfile} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';
 import {providerOf,type SettingsModel} from '../../lib/settings.svelte';

 let {model}:{model:SettingsModel}=$props();
 const list=$derived(model.profiles.filter(p=>providerOf(p)==='api'));  // unsaved ones stay at the end
 let open=$state<string|null>(null);
 const runs=new Map<string,JobRun>();
 const runOf=(id:string)=>{let r=runs.get(id);if(!r){r=new JobRun();runs.set(id,r);}return r;};
 async function check(p:ModelProfile,kind:'ai'|'vision'){
  const snap=$state.snapshot(p) as ModelProfile;if(!snap.apiKey)delete snap.apiKey;
  try{await runOf(p.id).run(()=>api.modelTest(kind,snap));}catch{/* shown below */}
 }
 let confirming=$state<string|null>(null);
 const isSaved=(id:string)=>!!model.saved?.modelProfiles.some(p=>p.id===id);
</script>

<section class="card">
 <header>
  <div>
   <h2>API 连接</h2>
   <p>OpenAI 兼容接口（如 DeepSeek、OpenAI、Gemini API）。每个连接填写地址、密钥和模型名称。</p>
  </div>
  <button class="btn" type="button" onclick={()=>open=model.addApi()}>＋ 添加 API 连接</button>
 </header>

 {#each list as p (p.id)}
  {@const used=model.usage(p.id)}
  {@const run=runOf(p.id)}
  <div class="item" class:open={open===p.id}>
   <button class="summary" type="button" onclick={()=>open=open===p.id?null:p.id} aria-expanded={open===p.id}>
    <span class="title">{p.name||'未命名连接'}{#if model.profileDirty(p)}<span class="dot" title="有未保存的修改"> ●</span>{/if}</span>
    <span class="meta">{p.model||'未填写模型'} · {isSaved(p.id)?(used.length?'用于 '+used.length+' 项':'未分配'):'未保存'}{p.hasApiKey||p.apiKey?'':' · 缺少密钥'}</span>
   </button>
   {#if open===p.id}
    <div class="editor">
     <label class="field"><span>名称</span><input type="text" bind:value={p.name}/></label>
     <label class="field wide"><span>API 地址</span><input type="url" bind:value={p.baseUrl} placeholder="https://…/v1" spellcheck="false"/></label>
     <label class="field"><span>模型名称</span><input type="text" bind:value={p.model} spellcheck="false"/></label>
     <label class="field"><span>API 密钥</span>
      <input type="password" bind:value={p.apiKey} autocomplete="new-password" spellcheck="false" disabled={p.clearApiKey} placeholder={p.hasApiKey&&!p.clearApiKey?'已保存，留空则保留':'粘贴密钥'}/>
      {#if p.hasApiKey}<small><label class="inline"><input type="checkbox" bind:checked={p.clearApiKey}/>保存时清除已存密钥</label></small>{/if}
     </label>
     <details class="more">
      <summary>更多参数</summary>
      <div class="grid">
       <label class="field"><span>上下文字符额度</span><input type="number" bind:value={p.contextChars} min="20000" max="2000000"/><small>范围 20000–2000000</small></label>
       <label class="field"><span>输出 Token 上限</span><input type="number" bind:value={p.maxOutputTokens} min="1000" max="100000"/><small>范围 1000–100000</small></label>
       <label class="field"><span>输出参数名</span><select bind:value={p.outputTokenField}><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option></select></label>
       <label class="inline"><input type="checkbox" checked={p.visionEnabled!==false} onchange={e=>p.visionEnabled=(e.currentTarget as HTMLInputElement).checked}/>允许图片输入</label>
      </div>
     </details>
     <div class="actions">
      <button class="btn" type="button" disabled={run.state.running} onclick={()=>check(p,'ai')}>测试文字 / JSON</button>
      <button class="btn" type="button" disabled={run.state.running} onclick={()=>check(p,'vision')}>测试图片</button>
      <span class="spacer"></span>
      {#if confirming===p.id}
       <span class="confirm">{used.length?'删除后，'+used.join('、')+'将改用默认模型。':'删除这个连接？'}
        <button class="btn danger" type="button" disabled={model.saving} onclick={()=>{confirming=null;model.remove(p.id);}}>确定删除</button>
        <button class="btn btn-quiet" type="button" onclick={()=>confirming=null}>取消</button></span>
      {:else}<button class="btn btn-quiet danger-text" type="button" onclick={()=>confirming=p.id}>删除</button>{/if}
     </div>
     <JobView job={run.state}/>
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
 .meta{color:var(--fg-muted);font-size:var(--text-xs);}
 .editor{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--space-3);padding:var(--space-3);border-top:1px solid var(--line);}
 .field{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);}
 .field.wide{grid-column:span 2;}
 .field>span{font-weight:var(--weight-medium);}
 input:not([type=checkbox]),select{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .inline{display:inline-flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);}
 .more,.actions,.editor :global(.job){grid-column:1/-1;}
 .more summary{cursor:pointer;font-size:var(--text-sm);color:var(--fg-muted);}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-3);margin-top:var(--space-2);align-items:end;}
 .actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);}
 .spacer{flex:1;}
 .confirm{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);color:var(--status-failed-fg);font-size:var(--text-xs);}
 .danger{border-color:var(--status-failed-fg);color:var(--status-failed-fg);}
 .danger-text{color:var(--status-failed-fg);}
 .muted{color:var(--fg-muted);font-size:var(--text-sm);margin:0;}
 @media (max-width:900px){.field.wide{grid-column:auto;}}
</style>
