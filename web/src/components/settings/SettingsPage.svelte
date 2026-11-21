<script lang="ts">
 import {onMount} from 'svelte';
 import FieldList,{type Field} from './FieldList.svelte';
 import AccountCard from './AccountCard.svelte';
 import ApiCard from './ApiCard.svelte';
 import AssignSection from './AssignSection.svelte';
 import JobView from './JobView.svelte';
 import {api} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';
 import {SettingsModel} from '../../lib/settings.svelte';

 type Section='services'|'assign'|'preview'|'advanced';
 const sections:[Section,string,string][]=[
  ['services','服务与账号','登录 AI 账号、添加 API 连接，以及参考文献解析用的 MinerU。'],
  ['assign','模型分配','选一个默认模型，需要时为某项功能单独指定。'],
  ['preview','原页预览','课件原页图片的生成方式。'],
  ['advanced','高级','并发数、分段长度等。一般不需要修改。'],
 ];
 const KEY='classroom.next.settingsSection';
 let section=$state<Section>((()=>{try{const v=localStorage.getItem(KEY) as Section;return sections.some(s=>s[0]===v)?v:'services';}catch{return 'services';}})());
 $effect(()=>{try{localStorage.setItem(KEY,section);}catch{/* private mode */}});

 const model=new SettingsModel();
 onMount(()=>{model.load();});

 const dirtyOf=(s:Section)=>s==='services'?model.servicesDirty:s==='assign'?model.assignDirty:s==='preview'?model.previewDirty:model.advancedDirty;
 const dirty=$derived(!!model.saved&&dirtyOf(section));
 const otherDirty=$derived(model.saved?sections.filter(([id])=>id!==section&&dirtyOf(id)).map(([,label])=>label):[]);

 const mineruFields=$derived.by(():Field[]=>{
  const s=model.saved;const langs:[string,string][]=[['en','英文 (en)'],['ch','中文 (ch)'],['japan','日文 (japan)'],['korean','韩文 (korean)'],['latin','拉丁字母 (latin)']];
  if(s?.mineruLanguage&&!langs.some(([v])=>v===s.mineruLanguage))langs.push([s.mineruLanguage,s.mineruLanguage]);
  return [
   {key:'mineruToken',label:'MinerU API Token',type:'password',placeholder:s?.hasMineruToken&&!model.mineru.clearMineruToken?'已保存，留空则保留':'粘贴 Token'},
   {key:'mineruLanguage',label:'文档语言',type:'select',choices:langs},
   {key:'uploadConcurrency',label:'同时解析的文件数',type:'number',min:1,max:8},
  ];
 });
 const previewFields:Field[]=[
  {key:'previewEngine',label:'预览方式',type:'select',choices:[['auto','自动选择'],['powerpoint','本机 PowerPoint'],['libreoffice','LibreOffice'],['manual','手动提供 PDF 预览']]},
  {key:'browserPath',label:'Edge / Chrome 程序路径',type:'text',placeholder:'留空自动查找',hint:'用于绘制原页'},
  {key:'libreOfficePath',label:'LibreOffice 程序路径',type:'text',placeholder:'留空自动查找'},
 ];
 const advancedFields:Field[]=[
  {key:'contextConcurrency',label:'材料背景整理并发数',type:'number',min:1,max:8},
  {key:'parseConcurrency',label:'材料解析并发数',type:'number',min:1,max:4},
  {key:'chunkChars',label:'分段字符数',type:'number',min:1500,max:15000},
  {key:'structuredOutput',label:'使用结构化 JSON 输出（模型不支持时取消）',type:'checkbox'},
  {key:'compactPptImages',label:'压缩课件图片后再发送给模型',type:'checkbox'},
 ];
 const mineruTest=new JobRun();
 async function testMineru(kind:'mineru-connection'|'mineru'){
  const m=$state.snapshot(model.mineru);if(!m.mineruToken)delete m.mineruToken;
  try{await mineruTest.run(()=>api.settingsTest(kind,{...m,uploadConcurrency:Number(m.uploadConcurrency),mineruMode:'cloud',mineruModel:'vlm'}));}catch{/* shown below */}
 }
 function beforeUnload(e:BeforeUnloadEvent){if(sections.some(([id])=>model.saved&&dirtyOf(id)))e.preventDefault();}
</script>

<svelte:window onbeforeunload={beforeUnload}/>

<div class="settings">
 <nav class="nav" aria-label="设置分类">
  {#each sections as [id,label] (id)}
   <button class:on={section===id} aria-current={section===id?'page':undefined} onclick={()=>{section=id;model.error='';model.message='';}}>
    {label}{#if model.saved&&dirtyOf(id)}<span class="dot" title="有未保存的修改">●</span>{/if}
   </button>
  {/each}
 </nav>

 <div class="main">
  <div class="body">
   {#if model.loadError}<p class="error">{model.loadError}</p>
   {:else if !model.saved}<p class="muted">正在读取设置…</p>
   {:else}
    {@const info=sections.find(s=>s[0]===section)!}
    <h1>{info[1]}</h1>
    <p class="lead">{info[2]}</p>

    {#if section==='services'}
     <div class="cards">
      <AccountCard kind="acp" {model}/>
      <AccountCard kind="chatgpt" {model}/>
      <ApiCard {model}/>
      <section class="card">
       <header><h2>MinerU</h2><p>参考文献 PDF 的云端解析。课件不会上传到 MinerU。</p></header>
       <FieldList fields={mineruFields} draft={model.mineru}/>
       {#if model.saved.hasMineruToken}<label class="check"><input type="checkbox" bind:checked={model.mineru.clearMineruToken}/>保存时清除已存 Token</label>{/if}
       <div class="tests">
        <button class="btn" disabled={mineruTest.state.running} onclick={()=>testMineru('mineru-connection')}>检查连接</button>
        <button class="btn" disabled={mineruTest.state.running} onclick={()=>testMineru('mineru')}>测试解析</button>
       </div>
       <JobView job={mineruTest.state}/>
      </section>
     </div>
    {:else if section==='assign'}
     <AssignSection {model}/>
    {:else if section==='preview'}
     <FieldList fields={previewFields} draft={model.preview}/>
    {:else}
     <FieldList fields={advancedFields} draft={model.advanced}/>
    {/if}
   {/if}
  </div>

  {#if model.saved}
   <footer class="savebar">
    <span class="state" class:warn={dirty} role="status">
     {#if model.error}<span class="error">{model.error}</span>
     {:else if dirty}本页有未保存的修改
     {:else if otherDirty.length}{otherDirty.join('、')}有未保存的修改
     {:else}{model.message||'所有修改已保存'}{/if}
    </span>
    <button class="btn btn-primary" onclick={()=>model.save(section)} disabled={!dirty||model.saving}>{model.saving?'正在保存…':'保存'}</button>
   </footer>
  {/if}
 </div>
</div>

<style>
 .settings{display:grid;grid-template-columns:200px minmax(0,1fr);height:100%;min-height:0;}
 .nav{display:flex;flex-direction:column;gap:2px;padding:var(--space-4) var(--space-2);border-right:1px solid var(--line);background:var(--bg-surface);}
 .nav button{display:flex;justify-content:space-between;align-items:center;text-align:left;padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;font-size:var(--text-sm);color:var(--fg-muted);}
 .nav button:hover{background:var(--sand-200);color:var(--fg);}
 .nav button.on{background:var(--accent-soft);color:var(--accent-strong);font-weight:var(--weight-medium);}
 .dot{color:var(--status-stopped-fg);font-size:10px;}
 .main{display:flex;flex-direction:column;min-height:0;}
 .body{flex:1;overflow:auto;padding:var(--space-5) var(--space-6) var(--space-6);}
 h1{font-size:var(--text-xl);}
 .lead{margin:var(--space-1) 0 var(--space-5);color:var(--fg-muted);font-size:var(--text-sm);}
 .cards{display:flex;flex-direction:column;gap:var(--space-4);max-width:1080px;}
 .card{padding:var(--space-4) var(--space-5);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-surface);display:flex;flex-direction:column;gap:var(--space-3);}
 .card header h2{font-size:var(--text-lg);}
 .card header p{margin:var(--space-1) 0 0;color:var(--fg-muted);font-size:var(--text-sm);}
 .check{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 .tests{display:flex;gap:var(--space-2);}
 .savebar{display:flex;align-items:center;justify-content:flex-end;gap:var(--space-3);padding:var(--space-3) var(--space-6);border-top:1px solid var(--line);background:var(--bg-surface);}
 .state{font-size:var(--text-sm);color:var(--fg-muted);}
 .state.warn{color:var(--status-stopped-fg);}
 .error{color:var(--status-failed-fg);}
 .muted{color:var(--fg-muted);}
</style>
