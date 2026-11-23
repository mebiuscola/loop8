<script lang="ts">
 // One material: one status, at most one next step, everything else in the ⋯ menu
 // (常用 / 下载 / 高级 / 删除), technical progress folded into "详情".
 import Icon from '../Icon.svelte';
 import Modal from '../Modal.svelte';
 import StatusBadge from '../StatusBadge.svelte';
 import ErrorNote from '../ErrorNote.svelte';
 import {api,ApiError,type CoursewareReader,type PartialResults,type Project,type ReferenceReader,type Role,type SourceFile} from '../../lib/api';
 import {courseHref} from '../../lib/router.svelte';
 import {store} from '../../lib/store.svelte';
 import {canChangeRole,deckReviewText,isPdf,isPlainBb,materialView,roleLabel,roleTag,sizeText} from '../../lib/overview';

 let {project,file,reader,locked}:{project:Project;file:SourceFile;reader?:CoursewareReader|ReferenceReader|null;locked:boolean}=$props();

 const view=$derived(materialView(project,file,reader));
 const ai=$derived(file.aiParse);
 const running=$derived(ai?.status==='running'||file.parseStatus==='running');
 const pendingDelete=$derived(project.materialDeletionPending?.sourceId===file.id);
 const readHref=$derived(courseHref(project.id,'read',(file.role==='ppt'?'ppt':'ref')+'/'+encodeURIComponent(file.id)+'/p/1'));
 const fail=(e:unknown)=>e instanceof ApiError?e.message:String(e);

 let message=$state(''),error=$state(''),working=$state(false),queuedNow=false;
 async function act(task:()=>Promise<unknown>,done:string|(()=>string)=''){
  working=true;error='';message='';menuOpen=false;
  try{await task();message=typeof done==='function'?done():done;await store.refresh();}
  catch(e){error=fail(e);}
  finally{working=false;}
 }
 function step(){
  const s=view.step;if(!s)return;
  if(s.kind==='cancel')act(()=>api.cancelAiParse(project.id,file.id),'正在停止；已完成的页面会保留。');
  else if(s.kind==='ai-parse')act(()=>api.aiParse(project.id,file.id),'已开始，可以去阅读已完成的部分。');
  else if(s.kind==='parse-pdf')act(()=>api.parsePdf(project.id,file.id),'已开始解析。');
  else if(s.kind==='translate')act(async()=>{const p=await api.process(project.id,'reference',file.id);queuedNow=p?.tasks?.['reference:'+file.id]?.status==='queued';},()=>queuedNow?'本周有其他任务正在进行，翻译已排队，完成后自动开始。':'已开始翻译。');
 }

 // ---- ⋯ menu ----
 let menuOpen=$state(false);
 let menuWrap=$state<HTMLElement>();
 function outside(event:MouseEvent){if(menuOpen&&menuWrap&&!menuWrap.contains(event.target as Node))menuOpen=false;}
 const hasAi=$derived(file.role==='ppt'||!!(isPdf(file)&&['reading','bb'].includes(file.role)));
 const pptComplete=$derived(file.role==='ppt'&&!!ai?.total&&ai.completed===ai.total);

 let importInput=$state<HTMLInputElement>();
 function importFile(e:Event){
  const input=e.currentTarget as HTMLInputElement,f=input.files?.[0];input.value='';if(!f)return;
  act(()=>api.importParsed(project.id,file.id,f),file.role==='ppt'?'解析 JSON 已收录，原件不变。':'补充解析已收录，原件不变。');
 }
 function changeRole(role:Role){if(role!==file.role)act(()=>api.materialRole(project.id,file.id,role),'用途已改为'+roleLabel[role]+'；原件名称和已有解析不变。');}

 // ---- dialogs ----
 let dialog=$state<''|'fresh'|'delete'|'partial'>('');
 let plan=$state<{name:string;sharedOriginal?:boolean}|null>(null);
 async function openDelete(){
  menuOpen=false;error='';
  try{plan=await api.materialDeletePlan(project.id,file.id);dialog='delete';}catch(e){error=fail(e);}
 }
 async function confirmDelete(){
  working=true;
  try{await api.materialDelete(project.id,file.id);dialog='';await store.refresh();}
  catch(e){error=fail(e);dialog='';}
  finally{working=false;}
 }
 let partial=$state<PartialResults|null>(null);
 async function openPartial(){
  menuOpen=false;error='';
  try{partial=await api.aiPartial(project.id,file.id);dialog='partial';}catch(e){error=fail(e);}
 }
 function pageText(n:number){
  const p=partial!.pages.find(x=>x.page===n),pending=partial!.pending?.find(x=>x.page===n),draft=pending?.draft;
  if(p)return [...(p.originalText||[]).map(b=>'[原文] '+b.text),...(p.blocks||[]).map(b=>'['+b.kind+'] '+b.text),...(p.learning?.paragraphs||[]).map(b=>'[中文] '+b.chinese),
   ...(p.visualObservations||[]).map(v=>'[视觉观察] '+v.description),...(p.analysis||[]).map(t=>'[分析] '+t),p.learning?.closeReading?'[本页解读] '+p.learning.closeReading:'',...(p.uncertainties||[]).map(t=>'[提示] '+t)].filter(Boolean).join('\n\n');
  if(draft)return [...draft.blocks.map(b=>'[原文] '+b.original+'\n[中文] '+(b.chinese||'待补译')),...draft.visuals.map(v=>'[视觉观察] '+v.description),draft.explanation?'[解读] '+draft.explanation:'解读待补全',...draft.uncertainties.map(t=>'[提示] '+t)].join('\n\n');
  return '等待恢复本页内容，已完成的其他页保留。';
 }
 // A page either could not be recognised, or is done (possibly with hints to check in the reader).
 const pageState=(n:number)=>{
  const p=partial!.pages.find(x=>x.page===n),pending=partial!.pending?.find(x=>x.page===n);
  if(!p)return '待完成：'+(pending?.parts||['识别']).join('、');
  if(p.inspection?.status==='unavailable'||p.inspection?.fullPageViewed===false||p.status==='unreadable')return '未能识别';
  const hints=new Set([...(p.uncertainties||[]),...(p.visualObservations||[]).flatMap(v=>v.uncertainties||[])].filter(t=>!/^(本机缺少课件字体|原课件字体未完整加载)/.test(t))).size;
  return hints?'已完成 · '+hints+' 条提示':'已完成';
 };
 const queued=$derived(project.tasks?.['reference:'+file.id]?.status==='queued');
 const elapsed=$derived(ai?.started?Math.max(0,Math.round(((ai.finished||Date.now())-ai.started)/1000)):0);
 const hasDetails=$derived(!!(ai||file.error||file.progress||file.parseSource));
</script>

<svelte:window onclick={outside} onkeydown={e=>{if(e.key==='Escape')menuOpen=false;}}/>
<input class="hidden" type="file" accept={file.role==='ppt'?'.json':'.json,.md,.txt'} bind:this={importInput} onchange={importFile}/>

<div class="row">
 <span class="tag {file.role}">{roleTag[file.role]||file.role}</span>
 <div class="name">
  <span class="title" title={file.name}>{file.name}</span>
  <small>{roleLabel[file.role]}{file.size?' · '+sizeText(file.size):''}</small>
 </div>
 <div class="state">
  {#if pendingDelete}<StatusBadge kind="stopped" text="删除未完成"/>{:else}<StatusBadge kind={view.kind} text={view.text}/>{/if}
 </div>
 <div class="act">
  {#if pendingDelete}
   <button class="btn" onclick={openDelete} disabled={working}>继续删除</button>
  {:else if view.step?.kind==='read'}
   <a class="btn" href={readHref}>阅读</a>
  {:else if view.step}
   <!-- Next steps use the normal button style: "＋ 添加文件" stays the page's one main button. -->
   <button class="btn" onclick={step} disabled={working||locked&&view.step.kind!=='cancel'&&view.step.kind!=='translate'}>{view.step.label}</button>
  {/if}
  <div class="menu" bind:this={menuWrap}>
   <button class="btn btn-quiet icon" onclick={()=>menuOpen=!menuOpen} aria-haspopup="menu" aria-expanded={menuOpen} title="更多" aria-label={'更多 · '+file.name}>⋯</button>
   {#if menuOpen}
    <div class="menu-list" role="menu">
     {#if canChangeRole(file)}
      <span class="menu-label">用途</span>
      <div class="roles" role="group" aria-label="材料用途">
       {#each ['ppt','reading','bb'] as const as r (r)}<button role="menuitemradio" aria-checked={file.role===r} class:on={file.role===r} disabled={running||locked||working} onclick={()=>changeRole(r)}>{roleLabel[r]}</button>{/each}
      </div>
     {/if}
     {#if view.step?.kind!=='read'&&(file.role==='ppt'&&reader||file.role==='reading'&&file.parsed)}<a role="menuitem" href={readHref}>阅读</a>{/if}
     {#if queued}<button role="menuitem" onclick={()=>act(()=>api.queueCancel(project.id,'reference:'+file.id),'已取消排队。')}>取消排队的翻译</button>{/if}
     <div class="menu-sep" role="separator"></div><span class="menu-label">下载</span>
     <a role="menuitem" href={api.sourceUrl(project.id,file.id)}>原件</a>
     {#if file.externalAnalysis}<a role="menuitem" href={api.analysisUrl(project.id,file.id)}>解析 JSON</a>{/if}
     {#if !isPlainBb(file)}
      <div class="menu-sep" role="separator"></div><span class="menu-label">高级</span>
      {#if isPdf(file)&&file.role!=='ppt'&&file.parsed}<button role="menuitem" disabled={running||locked} onclick={()=>act(()=>api.parsePdf(project.id,file.id,'mineru'),'已交给 MinerU 重新解析。')}>用 MinerU 重新解析</button>{/if}
      {#if hasAi&&file.role!=='ppt'}<button role="menuitem" disabled={running||locked} onclick={()=>act(()=>api.aiParse(project.id,file.id),'AI 解析已开始。')}>{ai?'继续 / 补全 AI 解析':'AI 解析整份 PDF'}</button>{/if}
      <button role="menuitem" disabled={running||locked} onclick={()=>{menuOpen=false;importInput?.click();}}>{file.role==='ppt'?(file.parsed?'更换解析 JSON':'导入解析 JSON'):file.parsed?'更换解析结果':'导入补充解析'}</button>
      {#if ai&&(ai.completed||ai.drafted||ai.failed?.length)}<button role="menuitem" onclick={openPartial}>查看逐页结果</button>{/if}
      {#if ai&&!running&&ai.missing?.length}<button role="menuitem" disabled={locked} onclick={()=>act(()=>api.aiParse(project.id,file.id,{retryFailed:true}),'只为未完成页重新尝试；已完成页保留。')}>再次尝试未完成页</button>{/if}
      {#if ai&&!running&&ai.incomplete}<button role="menuitem" disabled={locked} onclick={()=>act(()=>api.aiParse(project.id,file.id,{retryIssues:true}),'正在重新识别未能识别的页面。')}>{file.role==='ppt'?'重新识别未能识别的页':'用备用模型重新识别未能识别的页'}</button>{/if}
      {#if pptComplete}
       <button role="menuitem" disabled={running||locked} onclick={()=>act(()=>api.aiParse(project.id,file.id,{teachingPart:'translation'}),'只更新翻译；识别和解读不变。')}>只更新翻译</button>
       <button role="menuitem" disabled={running||locked} onclick={()=>act(()=>api.aiParse(project.id,file.id,{teachingPart:'explanation'}),'只更新解读；识别和翻译不变。')}>只更新解读</button>
      {/if}
      {#if hasAi}<button role="menuitem" disabled={running||locked} onclick={()=>{menuOpen=false;dialog='fresh';}}>重新解析全部…</button>{/if}
      {#if hasAi}<button role="menuitem" disabled={running} onclick={()=>act(()=>api.aiCacheClear(project.id,file.id),'页面缓存已清理，原件和当前结果保留。')}>清理页面缓存</button>{/if}
     {/if}
     <div class="menu-sep" role="separator"></div>
     <button role="menuitem" class="danger" disabled={running||working} onclick={openDelete}>删除材料…</button>
    </div>
   {/if}
  </div>
 </div>

 {#if error}<p class="line"><ErrorNote text={error}/></p>{:else if message}<p class="line" role="status">{message}</p>{/if}

 {#if hasDetails}
  <details class="details">
   <summary>详情</summary>
   {#if file.parseSource}<p>文字来源：{file.parseSource==='text-layer'?'PDF 自带文字（未上传）':'MinerU 识别'}</p>{/if}
   {#if file.progress}<p>进度：{file.progress}</p>{/if}
   {#if file.error}<p class="error">{file.error}</p>{/if}
   {#if ai}
    <p><b>{ai.stage||'AI 解析'}</b> · 页面准备 {ai.prepared||0}/{ai.total||'?'} · AI 完成 {ai.completed||0}/{ai.total||'?'}{elapsed?' · '+elapsed+' 秒':''}{ai.model?' · '+ai.model:''}</p>
    {#if ai.error}<p class="error">{ai.error}</p>{/if}
    {#each ai.rounds||[] as r, i (i)}<p>{r.label}{r.model?' · '+r.model:''}：成功 {r.success}/{r.total}{r.status==='not_configured'?'（未配置）':r.status==='configuration_error'?'（配置错误，已暂停）':''}</p>{/each}
    <!-- While the guide is still being made, the check shows as progress above, not as an unfinished batch. -->
    {#if ai.review&&!running}<p>{deckReviewText(ai.review)}</p>{/if}
    {#if ai.incomplete}<p class="error">{ai.incomplete} 页未能识别，可在 ⋯ › 高级 中重新识别。</p>{/if}
    {#if ai.hints}<p>{ai.hints} 页有解析提示，可在阅读页对照原页核对。</p>{/if}
    {#each ai.notes||[] as note (note)}<p>{note}。安装这些字体后，原页显示会更准确。</p>{/each}
    {#if ai.pendingParts?.length}<p>待完成：{ai.pendingParts.map(p=>'第 '+p.page+' 页 '+p.parts.join('、')).join('；')}</p>{/if}
   {/if}
  </details>
 {/if}
</div>

{#if dialog==='fresh'}
 <Modal title="重新解析全部页面" onclose={()=>dialog=''} busy={working}>
  <p>将重新识别 {file.name} 的全部页面，并重置本次尝试次数。成功后替换当前结果；原件不变。</p>
  {#snippet actions()}<button class="btn btn-primary" disabled={working} onclick={()=>{dialog='';act(()=>api.aiParse(project.id,file.id,{fresh:true}),'已开始重新解析全部页面。');}}>重新解析</button>{/snippet}
 </Modal>
{/if}

{#if dialog==='delete'&&plan}
 <Modal title="删除材料" onclose={()=>dialog=''} busy={working}>
  <p><b>{plan.name}</b></p>
  <p>将清理这份材料的解析、缓存、翻译和解读。{plan.sharedOriginal?'原件仍被其他材料引用，会保留原件。':'本地原件也会一并删除。'}此操作不能撤销。</p>
  {#snippet actions()}<button class="btn danger" disabled={working} onclick={confirmDelete}>{working?'正在删除…':'永久删除材料'}</button>{/snippet}
 </Modal>
{/if}

{#if dialog==='partial'&&partial}
 <Modal title={'逐页结果 · '+partial.source} onclose={()=>dialog=''} busy={working} wide>
  <p>已完成 {partial.completed}/{partial.total} 页{partial.missing.length?'；待完成页：'+partial.missing.join('、'):'；全部页面已有结果。'}{partial.requiresComplete?' PPT 全部页面完成后才发布新导读。':''}</p>
  {#if partial.review}<p>{deckReviewText(partial.review)}。</p>{/if}
  {#each partial.reviewDiagnostics||[] as d, i (i)}<details class="page"><summary>整课检查诊断 {i+1}</summary><pre>{JSON.stringify(d,null,2)}</pre></details>{/each}
  {#each Array.from({length:partial.total},(_,i)=>i+1) as n (n)}
   {@const pending=partial.pending?.find(x=>x.page===n)}
   <details class="page">
    <summary>第 {n} 页 · {pageState(n)} · {partial.provenance?.[n-1]?.model||ai?.model||'保存结果'}</summary>
    <pre>{pageText(n)}</pre>
    {#if pending?.diagnostic}<details><summary>最近失败返回（诊断）</summary><pre>{pending.diagnostic.stage+'\n'+pending.diagnostic.error+'\n\n'+pending.diagnostic.response}</pre></details>{/if}
   </details>
  {/each}
  {#snippet actions()}
   {#if !partial!.requiresComplete&&partial!.missing.length}
    <button class="btn btn-primary" disabled={working||running||locked} onclick={()=>{dialog='';act(()=>api.aiPartialImport(project.id,file.id),'已收录部分结果，缺失页仍保留标记。');}}>采用部分结果</button>
   {/if}
  {/snippet}
 </Modal>
{/if}

<style>
 .hidden{display:none;}
 .row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:var(--space-2) var(--space-3);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--line);}
 .row:last-child{border-bottom:0;}
 .tag{width:36px;text-align:center;padding:1px 0;border-radius:var(--radius-sm);background:var(--sand-200);color:var(--fg-muted);font-size:var(--text-xs);font-weight:var(--weight-bold);}
 .tag.ppt{background:var(--accent-soft);color:var(--accent-strong);}
 .name{display:flex;flex-direction:column;min-width:0;}
 .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm);font-weight:var(--weight-medium);}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .act{display:flex;align-items:center;gap:var(--space-1);justify-content:flex-end;}
 .act .btn{white-space:nowrap;}
 .icon{width:32px;padding:0;justify-content:center;}
 .menu{position:relative;}
 .menu-list{position:absolute;right:0;top:calc(100% + var(--space-1));min-width:240px;padding:var(--space-1);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:10;display:flex;flex-direction:column;}
 .menu-list a,.menu-list>button{display:flex;align-items:center;gap:var(--space-1);padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg);text-decoration:none;font-size:var(--text-sm);text-align:left;}
 .menu-list a:hover,.menu-list>button:hover:not(:disabled){background:var(--sand-100);}
 .menu-list button:disabled{color:var(--fg-subtle);}
 .menu-sep{height:1px;margin:var(--space-1) 0;background:var(--line);}
 .menu-label{padding:var(--space-1) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .roles{display:flex;gap:2px;margin:0 var(--space-3) var(--space-1);padding:2px;border-radius:var(--radius-sm);background:var(--sand-200);}
 .roles button{flex:1;padding:var(--space-1) var(--space-2);border:0;border-radius:4px;background:transparent;font-size:var(--text-xs);color:var(--fg-muted);}
 .roles button.on{background:var(--bg-raised);color:var(--fg);font-weight:var(--weight-medium);}
 .danger{color:var(--status-failed-fg);}
 .btn.danger{border-color:var(--status-failed-fg);}
 .line{grid-column:2/-1;margin:0;font-size:var(--text-xs);color:var(--fg-muted);}
 .line.error,.error{color:var(--status-failed-fg);}
 .details{grid-column:2/-1;font-size:var(--text-xs);color:var(--fg-muted);}
 .details summary{cursor:pointer;width:max-content;}
 .details p{margin:var(--space-1) 0;}
 .page summary{cursor:pointer;padding:var(--space-1) 0;}
 pre{white-space:pre-wrap;font-size:var(--text-xs);background:var(--sand-100);padding:var(--space-2);border-radius:var(--radius-sm);margin:0 0 var(--space-2);max-height:320px;overflow:auto;}
 @media (max-width:700px){.row{grid-template-columns:auto minmax(0,1fr) auto;}.state{grid-column:2/-1;grid-row:2;}}
</style>
