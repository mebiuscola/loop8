<script lang="ts">
 import {onMount} from 'svelte';
 import FieldList,{type Field} from './FieldList.svelte';
 import ProfileEditor from './ProfileEditor.svelte';
 import RoutesSection from './RoutesSection.svelte';
 import JobView from './JobView.svelte';
 import {api,ApiError,type Settings,type ModelProfile,type SettingsSave} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';

 type Section='models'|'routes'|'mineru'|'preview'|'advanced';
 const sections:[Section,string,string][]=[
  ['models','模型连接','保存 API、Antigravity 或 ChatGPT 订阅连接，并选择默认模型。'],
  ['routes','功能分配','每项功能可以沿用默认模型，也可以单独指定；右侧显示实际会使用的模型。新增或修改连接请到"模型连接"。'],
  ['mineru','MinerU','参考文献 PDF 的云端解析。'],
  ['preview','原页预览','课件原页的生成方式。'],
  ['advanced','高级','并发数、分段长度等。一般不需要修改。'],
 ];
 const KEY='classroom.next.settingsSection';
 let section=$state<Section>((()=>{try{return (localStorage.getItem(KEY) as Section)||'models';}catch{return 'models';}})());
 $effect(()=>{try{localStorage.setItem(KEY,section);}catch{/* private mode */}});

 let saved=$state<Settings|null>(null),loadError=$state('');
 // Drafts
 let profiles=$state<ModelProfile[]>([]);       // saved + unsaved connections, as edited
 let selected=$state('');
 let defaultId=$state('');
 let routes=$state({modelRoutes:{} as Record<string,string>,fallbackProfileId:'',fallbackEnabled:false});
 let mineru=$state<Record<string,any>>({}),preview=$state<Record<string,any>>({}),advanced=$state<Record<string,any>>({});

 function withDefaults(s:Settings,p:ModelProfile):ModelProfile{
  // $state.snapshot, not structuredClone: `p` may be a reactive proxy.
  return {contextChars:s.contextChars,maxOutputTokens:s.maxOutputTokens,outputTokenField:s.outputTokenField,visionEnabled:s.visionEnabled,...$state.snapshot(p),apiKey:'',clearApiKey:false};
 }
 function adopt(s:Settings,keepUnsaved=true){
  const unsaved=keepUnsaved?profiles.filter(p=>!s.modelProfiles.some(x=>x.id===p.id)&&!saved?.modelProfiles.some(x=>x.id===p.id)):[];
  saved=s;
  profiles=[...s.modelProfiles.map(p=>withDefaults(s,p)),...unsaved];
  if(!profiles.some(p=>p.id===selected))selected=profiles[0]?.id||'';
  defaultId=s.defaultProfileId;
  routes={modelRoutes:{...s.modelRoutes},fallbackProfileId:s.fallbackProfileId,fallbackEnabled:s.fallbackEnabled};
  mineru={mineruToken:'',clearMineruToken:false,mineruLanguage:s.mineruLanguage,uploadConcurrency:s.uploadConcurrency};
  preview={previewEngine:s.previewEngine,browserPath:s.browserPath,libreOfficePath:s.libreOfficePath};
  advanced={contextConcurrency:s.contextConcurrency,parseConcurrency:s.parseConcurrency,chunkChars:s.chunkChars,compactPptImages:s.compactPptImages,structuredOutput:s.structuredOutput};
 }
 onMount(async()=>{try{adopt(await api.settings(),false);}catch(e){loadError=(e as Error).message;}});

 // Unsaved changes, per section.
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 /** Everything except the write-only key fields, for comparing a draft with what is saved. */
 const comparable=({apiKey:_k,clearApiKey:_c,hasApiKey:_h,...rest}:ModelProfile)=>rest;
 function profileDirty(p:ModelProfile){
  if(!saved)return false;
  const base=saved.modelProfiles.find(x=>x.id===p.id);if(!base)return true;
  return !!p.apiKey||!!p.clearApiKey||!same(comparable(p),comparable(withDefaults(saved,base)));
 }
 const current=$derived(profiles.find(p=>p.id===selected)||null);
 const dirty=$derived.by(()=>{
  if(!saved)return false;
  switch(section){
   case 'models':return defaultId!==saved.defaultProfileId||(!!current&&profileDirty(current));
   case 'routes':return !same(routes,{modelRoutes:saved.modelRoutes,fallbackProfileId:saved.fallbackProfileId,fallbackEnabled:saved.fallbackEnabled});
   case 'mineru':return !!mineru.mineruToken||mineru.clearMineruToken||mineru.mineruLanguage!==saved.mineruLanguage||Number(mineru.uploadConcurrency)!==saved.uploadConcurrency;
   case 'preview':return !same(preview,{previewEngine:saved.previewEngine,browserPath:saved.browserPath,libreOfficePath:saved.libreOfficePath});
   case 'advanced':return !same(advanced,{contextConcurrency:saved.contextConcurrency,parseConcurrency:saved.parseConcurrency,chunkChars:saved.chunkChars,compactPptImages:saved.compactPptImages,structuredOutput:saved.structuredOutput});
  }
 });
 const anyDirty=$derived(!!saved&&(defaultId!==saved.defaultProfileId||profiles.some(profileDirty)));
 const unsavedNames=$derived(saved?profiles.filter(profileDirty).map(p=>p.name||'未命名连接'):[]);

 let saving=$state(false),saveError=$state(''),saveMessage=$state('');
 async function save(){
  if(!saved)return;
  saving=true;saveError='';saveMessage='';
  try{
   let next=saved;
   const send=async(payload:SettingsSave)=>{next=await api.saveSettings(payload);};
   if(section==='models'){
    if(current&&profileDirty(current)){
     const p=$state.snapshot(current) as ModelProfile;
     if(!p.apiKey)delete p.apiKey;
     const acpPaths=p.provider==='antigravity-acp'&&p.acpEntry?{...saved.acpPaths,[p.acpEntry]:p.acpExecutable||''}:undefined;
     await send({section:'model',profile:p,...(acpPaths?{acpPaths}:{})});
    }
    if(defaultId!==saved.defaultProfileId)await send({section:'models',defaultProfileId:defaultId});
   }else if(section==='routes')await send({section:'routes',...$state.snapshot(routes)});
   else if(section==='mineru'){const m=$state.snapshot(mineru);if(!m.mineruToken)delete m.mineruToken;if(!m.clearMineruToken)delete m.clearMineruToken;m.uploadConcurrency=Number(m.uploadConcurrency);await send({section:'mineru',...m});}
   else if(section==='preview')await send({section:'preview',...$state.snapshot(preview)});
   else await send({section:'advanced',...Object.fromEntries(Object.entries($state.snapshot(advanced)).map(([k,v])=>[k,typeof v==='string'&&/^\d+$/.test(v)?Number(v):v]))});
   adopt(next);saveMessage='已保存。';
  }catch(e){saveError=readable(e instanceof ApiError?e.message:(e as Error).message);}
  finally{saving=false;}
 }
 /** Backend validation messages name internal keys; show the labels the user sees instead. */
 function readable(message:string){
  const labels:Record<string,string>=Object.fromEntries([...mineruFields,...previewFields,...advancedFields].map(f=>[f.key,'"'+f.label+'"']));
  Object.assign(labels,{maxOutputTokens:'"输出 Token 上限"',contextChars:'"上下文字符额度"'});
  return message.replace(/\b[a-zA-Z]+(Chars|Concurrency|Tokens|Path|Language|Engine)\b/g,k=>labels[k]||k);
 }

 function addProfile(){
  const p:ModelProfile={id:crypto.randomUUID(),name:'新模型',provider:'api',baseUrl:'https://api.openai.com/v1',model:'',apiKey:'',contextChars:180000,maxOutputTokens:12000,outputTokenField:'max_completion_tokens',visionEnabled:true};
  profiles=[...profiles,p];selected=p.id;
 }
 async function removeProfile(id:string){
  saveError='';
  if(saved?.modelProfiles.some(p=>p.id===id)){
   saving=true;
   try{const next=await api.saveSettings({section:'delete-model',profileId:id});profiles=profiles.filter(p=>p.id!==id);adopt(next);}
   catch(e){saveError=(e as Error).message;}
   finally{saving=false;}
  }else{profiles=profiles.filter(p=>p.id!==id);selected=profiles[0]?.id||'';}
 }
 const providerLabel=(p:ModelProfile)=>p.provider==='chatgpt-plan'?'ChatGPT 订阅':p.provider==='antigravity-acp'?'ACP':'API';

 const mineruFields:Field[]=[
  {key:'mineruToken',label:'MinerU API Token',type:'password',placeholder:''},
  {key:'mineruLanguage',label:'文档语言',type:'select',choices:[['en','英文 (en)'],['ch','中文 (ch)'],['japan','日文 (japan)'],['korean','韩文 (korean)'],['latin','拉丁字母 (latin)']]},
  {key:'uploadConcurrency',label:'同时上传解析的文件数',type:'number',min:1,max:8},
 ];
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
  const m=$state.snapshot(mineru);if(!m.mineruToken)delete m.mineruToken;
  try{await mineruTest.run(()=>api.settingsTest(kind,{...m,uploadConcurrency:Number(m.uploadConcurrency),mineruMode:'cloud',mineruModel:'vlm'}));}catch{/* shown below */}
 }

 function beforeUnload(e:BeforeUnloadEvent){if(anyDirty||dirty){e.preventDefault();}}
</script>

<svelte:window onbeforeunload={beforeUnload}/>

<div class="settings">
 <nav class="nav" aria-label="设置分类">
  {#each sections as [id,label] (id)}
   <button class:on={section===id} aria-current={section===id?'page':undefined} onclick={()=>{section=id;saveError='';saveMessage='';}}>{label}</button>
  {/each}
 </nav>

 <div class="main">
  <div class="body">
   {#if loadError}<p class="error">{loadError}</p>
   {:else if !saved}<p class="muted">正在读取设置…</p>
   {:else}
    {@const info=sections.find(s=>s[0]===section)!}
    <h1>{info[1]}</h1>
    <p class="lead">{info[2]}</p>

    {#if section==='models'}
     <label class="default">
      <span>全局默认模型</span>
      <select bind:value={defaultId}>
       <option value="">未选择</option>
       {#each saved.modelProfiles as p (p.id)}<option value={p.id}>{p.name} · {providerLabel(p)}</option>{/each}
      </select>
      <small>没有单独指定模型的功能都使用它。</small>
     </label>
     <div class="workspace">
      <div class="list" role="listbox" aria-label="模型连接">
       {#each profiles as p (p.id)}
        <button role="option" aria-selected={p.id===selected} class:on={p.id===selected} onclick={()=>selected=p.id}>
         <span class="name">{p.name||'未命名连接'}{#if profileDirty(p)}<span class="dot" title="有未保存的修改">●</span>{/if}</span>
         <small>{providerLabel(p)}{p.id===saved.defaultProfileId?' · 默认':''}{!saved.modelProfiles.some(x=>x.id===p.id)?' · 未保存':''}</small>
        </button>
       {/each}
       <button class="add" onclick={addProfile}>＋ 添加模型连接</button>
      </div>
      <div class="pane">
       {#if current}
        {#key current.id}<ProfileEditor profile={current} saved={saved} {saving} ondelete={()=>removeProfile(current.id)}/>{/key}
       {:else}<p class="muted">还没有模型连接。点"添加模型连接"开始。</p>{/if}
      </div>
     </div>
    {:else if section==='routes'}
     <RoutesSection {saved} draft={routes}/>
    {:else if section==='mineru'}
     <FieldList fields={mineruFields.map(f=>f.key==='mineruToken'?{...f,placeholder:saved!.hasMineruToken&&!mineru.clearMineruToken?'已保存，留空则保留':'粘贴 Token'}:f.key==='mineruLanguage'&&saved!.mineruLanguage&&!f.choices!.some(([v])=>v===saved!.mineruLanguage)?{...f,choices:[...f.choices!,[saved!.mineruLanguage,saved!.mineruLanguage]]}:f)} draft={mineru}/>
     {#if saved.hasMineruToken}<label class="check"><input type="checkbox" bind:checked={mineru.clearMineruToken}/>保存时清除已存 Token</label>{/if}
     <div class="tests">
      <button class="btn" disabled={mineruTest.state.running} onclick={()=>testMineru('mineru-connection')}>检查连接</button>
      <button class="btn" disabled={mineruTest.state.running} onclick={()=>testMineru('mineru')}>测试解析</button>
     </div>
     <JobView job={mineruTest.state}/>
    {:else if section==='preview'}
     <FieldList fields={previewFields} draft={preview}/>
    {:else}
     <FieldList fields={advancedFields} draft={advanced}/>
    {/if}
   {/if}
  </div>

  {#if saved}
   <footer class="savebar">
    <span class="state" class:warn={dirty} role="status">
     {#if saveError}<span class="error">{saveError}</span>
     {:else if dirty}{section!=='models'?'有未保存的修改':[defaultId!==saved.defaultProfileId?'默认模型':'',current&&profileDirty(current)?'"'+(current.name||'未命名连接')+'"':''].filter(Boolean).join('和')+'有未保存的修改'}
     {:else if section==='models'&&unsavedNames.length}其他连接有未保存的修改：{unsavedNames.join('、')}
     {:else}{saveMessage||'所有修改已保存'}{/if}
    </span>
    <button class="btn btn-primary" onclick={save} disabled={!dirty||saving}>{saving?'正在保存…':'保存'}</button>
   </footer>
  {/if}
 </div>
</div>

<style>
 .settings{display:grid;grid-template-columns:200px minmax(0,1fr);height:100%;min-height:0;}
 .nav{display:flex;flex-direction:column;gap:2px;padding:var(--space-4) var(--space-2);border-right:1px solid var(--line);background:var(--bg-surface);}
 .nav button{text-align:left;padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;font-size:var(--text-sm);color:var(--fg-muted);}
 .nav button:hover{background:var(--sand-200);color:var(--fg);}
 .nav button.on{background:var(--accent-soft);color:var(--accent-strong);font-weight:var(--weight-medium);}
 .main{display:flex;flex-direction:column;min-height:0;}
 .body{flex:1;overflow:auto;padding:var(--space-5) var(--space-6);}
 h1{font-size:var(--text-xl);}
 .lead{margin:var(--space-1) 0 var(--space-5);color:var(--fg-muted);font-size:var(--text-sm);}
 .default{display:grid;grid-template-columns:auto minmax(220px,360px) 1fr;align-items:center;gap:var(--space-3);margin-bottom:var(--space-5);font-size:var(--text-sm);}
 .default span{font-weight:var(--weight-medium);}
 .default small{color:var(--fg-muted);font-size:var(--text-xs);}
 select{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .workspace{display:grid;grid-template-columns:220px minmax(0,1fr);gap:var(--space-4);align-items:start;}
 .list{display:flex;flex-direction:column;gap:2px;padding:var(--space-1);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);}
 .list button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;text-align:left;font-size:var(--text-sm);}
 .list button:hover{background:var(--sand-100);}
 .list button.on{background:var(--accent-soft);}
 .list small{color:var(--fg-muted);font-size:var(--text-xs);}
 .dot{margin-left:var(--space-1);color:var(--status-stopped-fg);font-size:10px;}
 .list .add{color:var(--accent);}
 .pane{padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-surface);}
 .check{display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-3);font-size:var(--text-sm);}
 .tests{display:flex;gap:var(--space-2);margin-top:var(--space-4);}
 .savebar{display:flex;align-items:center;justify-content:flex-end;gap:var(--space-3);padding:var(--space-3) var(--space-6);border-top:1px solid var(--line);background:var(--bg-surface);}
 .state{font-size:var(--text-sm);color:var(--fg-muted);}
 .state.warn{color:var(--status-stopped-fg);}
 .error{color:var(--status-failed-fg);}
 .muted{color:var(--fg-muted);}
</style>
