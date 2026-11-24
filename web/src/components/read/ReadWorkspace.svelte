<script lang="ts">
 import {untrack} from 'svelte';
 import Icon from '../Icon.svelte';
 import StatusBadge from '../StatusBadge.svelte';
 import ErrorNote from '../ErrorNote.svelte';
 import CoursewareReader from './CoursewareReader.svelte';
 import ReferenceReader from './ReferenceReader.svelte';
 import RetryDialog from './RetryDialog.svelte';
 import PreviewDialog from './PreviewDialog.svelte';
 import TrialDialog from './TrialDialog.svelte';
 import {CoursePreview} from '../../lib/preview.svelte';
 import {readerCache,readerSignature} from '../../lib/reader-cache.svelte';
 import {api,ApiError,type RedoPart,type Project,type CoursewareReader as CR,type ReferenceReader as RR} from '../../lib/api';
 import {router,courseHref} from '../../lib/router.svelte';
 import {store} from '../../lib/store.svelte';
 import {askContext} from '../../lib/ask-context.svelte';
 import {coursewareStatus,referenceStatus,type MaterialStatus} from '../../lib/reading';

 let {project,rest}:{project:Project;rest:string}=$props();
 // Original-page preview of the courseware shown (set up further below).
 let preview=$state<CoursePreview|null>(null);

 type Kind='ppt'|'ref';
 // rest = "<ppt|ref>/<sourceId>/p/<page>"
 // Each part of the address is its own plain value, so a refresh of the course data (which now
 // arrives whenever anything in the course is saved) never counts as a change of address and
 // never sends the reader back to the page first named in it.
 const parts=$derived(rest.split('/'));
 const urlKind=$derived(parts[0]);
 const sourceId=$derived(parts[1]||'');
 const urlPage=$derived(Math.max(1,Number(parts[3])||1));
 // Without a kind in the address, open courseware, or the references when the week has none.
 const fallbackKind=$derived<Kind>(project.files.some(f=>f.role==='ppt')||!project.files.some(f=>f.role==='reading')?'ppt':'ref');
 const files=$derived({ppt:project.files.filter(f=>f.role==='ppt'),ref:project.files.filter(f=>f.role==='reading')});
 const kind=$derived<Kind>(urlKind==='ref'||urlKind==='ppt'?urlKind:fallbackKind);
 const list=$derived(files[kind]);
 const file=$derived(list.find(f=>f.id===sourceId)||list[0]||null);

 const href=(k:Kind,sourceId?:string,page=1)=>courseHref(project.id,'read',k+(sourceId?'/'+encodeURIComponent(sourceId)+'/p/'+page:''));

 // Reading data, kept per material and kind while the app is open (lib/reader-cache.svelte.ts): coming
 // back to this workspace shows it at once, and a material is read again only when its saved result
 // changes, not on every progress update of a running task. The kind is part of the key: a material
 // whose role changed must never be shown with the other kind's data.
 const keyOf=(k:Kind,id:string)=>readerCache.key(project.id,k,id);
 const readers=$derived(readerCache.data),loadError=$derived(readerCache.errors);
 function load(k:Kind,id:string,force=false){const f=files[k].find(x=>x.id===id);if(f)return readerCache.load(project,k,f,force);}
 $effect(()=>{
  const all=[...files.ppt.map(f=>['ppt',f] as const),...files.ref.map(f=>['ref',f] as const)];
  const signatures=all.map(([k,f])=>readerSignature(project,k,f));
  // untrack: loading writes the cache, which must not re-run this effect.
  untrack(()=>{signatures;for(const [k,f] of all)readerCache.load(project,k,f);});
 });

 const statusOf=(k:Kind,id:string):MaterialStatus=>{
  const f=files[k].find(x=>x.id===id)!;
  const key=keyOf(k,id);
  if(loadError[key])return {kind:'failed',text:'读取失败'};
  return k==='ppt'?coursewareStatus(project,f,readers[key] as CR|null):referenceStatus(project,f,readers[key] as RR|null);
 };
 const current=$derived(file?readers[keyOf(kind,file.id)]:null);
 // Pages of this courseware being generated right now (index → current step), shown on each page.
 const generating=$derived(kind==='ppt'&&file?.aiParse?.status==='running'?((file.aiParse as {tasks?:Record<string,{phase?:string}>}).tasks||{}):null);
 // Reference paragraphs without a translation yet (e.g. refused by a model); they can be finished with another model.
 const untranslated=$derived(kind==='ref'&&current?(current as RR).summary.total-(current as RR).summary.completed:0);
 const status=$derived(file?statusOf(kind,file.id):null);

 // Columns the reader shows; remembered per kind.
 const COLS_KEY='classroom.next.readColumns';
 const defaults={ppt:{original:true,translation:true,notes:true},ref:{original:true,translation:true,notes:false}};
 let columns=$state((()=>{try{return {...defaults,...JSON.parse(localStorage.getItem(COLS_KEY)||'{}')};}catch{return defaults;}})());
 $effect(()=>{try{localStorage.setItem(COLS_KEY,JSON.stringify(columns));}catch{/* private mode */}});

 // Page position: the reader reports the page in view; we record it in the URL and offer it to Ask.
 let page=$state(1),pageCount=$state(0),seq=0;
 let jump=$state<{page:number;seq:number}>({page:1,seq:0});
 $effect(()=>{const p=urlPage;page=p;jump={page:p,seq:++seq};});
 const total=$derived(current?(kind==='ppt'?Math.max((current as CR).pages.length,(current as CR).nativePageCount||0,preview?.status?.pages||0):pageCount):0);
 // The printed page number of the reference page in view, next to the PDF page number.
 const printed=$derived(kind==='ref'&&current?(current as RR).paragraphs.find(p=>p.pageIndex===page-1&&p.printedPage)?.printedPage||'':'');
 function onPage(n:number){
  page=n;
  if(file){router.remember(href(kind,file.id,n));readerCache.setPage(project.id,kind,file.id,n);}
 }
 function goPage(n:number){if(!total)return;const target=Math.min(total,Math.max(1,n));page=target;jump={page:target,seq:++seq};if(file){router.remember(href(kind,file.id,target));readerCache.setPage(project.id,kind,file.id,target);}}
 $effect(()=>{
  if(!file){askContext.set(null);return;}
  askContext.set({label:file.name+' · 第 '+page+' 页',scope:'preparation',focus:{kind:'page',sourceId:file.id,pageIndex:page-1}});
 });
 $effect(()=>()=>askContext.set(null));

 // The one primary action of this page.
 const action=$derived.by(()=>{
  if(!file||!status)return null;
  if(kind==='ppt'){
   if(status.kind==='running')return {label:'导读生成中…',disabled:true};
   if(status.kind==='idle'&&status.text==='读取中…')return null;
   if(status.kind==='done')return null;
   return {label:status.kind==='idle'?'生成本周课件导读':status.kind==='stale'?'更新本周课件导读':'继续生成导读',disabled:false};
  }
  if(status.kind==='running')return {label:project.tasks?.['reference:'+file.id]?.status==='queued'?'排队中…':'翻译中…',disabled:true};
  if(status.kind==='done'||status.text==='读取中…')return null;
  return {label:status.kind==='idle'?'翻译这份文献':status.kind==='stale'?'重新翻译':'补译剩余',disabled:false};
 });
 let starting=$state(false),actionError=$state('');
 async function start(){
  if(!file)return;
  starting=true;actionError='';
  try{await api.process(project.id,kind==='ppt'?'preparation':'reference',kind==='ref'?file.id:undefined);await store.refresh();}
  catch(e){actionError=e instanceof ApiError?e.message:String(e);}
  finally{starting=false;}
 }

 // Redo one page; the job shows in the task panel and on the page while it runs.
 async function redo(pageIndex:number,part:RedoPart){
  if(!file)return;actionError='';
  try{await api.aiParse(project.id,file.id,{pages:[pageIndex+1],part});await store.refresh();}
  catch(e){actionError=e instanceof ApiError?e.message:String(e);}
 }
 async function checkHint(n:number,hint:string,checked:boolean){
  if(!file)return;actionError='';
  try{await api.hintCheck(project.id,file.id,n,hint,checked);await load('ppt',file.id,true);store.refresh();}
  catch(e){actionError=e instanceof ApiError?e.message:String(e);}
 }

 let menuOpen=$state(false);
 let menuWrap:HTMLElement;
 function outside(event:MouseEvent){if(menuOpen&&menuWrap&&!menuWrap.contains(event.target as Node))menuOpen=false;}

 // Original-page preview of the courseware shown (one at a time).
 $effect(()=>{
  const id=kind==='ppt'?file?.id:undefined,name=file?.name||'';
  if(!id){untrack(()=>{preview?.destroy();preview=null;});return;}
  const next=new CoursePreview(project.id,id,name);
  // When PowerPoint finishes drawing the slides, read the deck again: new render key, new images.
  next.onsettled=()=>{const f=files.ppt.find(x=>x.id===id);if(f)readerCache.load(project,'ppt',f,true);};
  untrack(()=>{preview?.destroy();preview=next;});
  return ()=>next.destroy();
 });
 // A drawing started by opening the deck is followed until it is done.
 $effect(()=>{if(kind==='ppt'&&(current as CR|null)?.drawnBy?.kind==='converting'&&preview&&!['queued','running'].includes(preview.status?.status||''))untrack(()=>preview?.refresh());});
 const drawnNote=$derived.by(()=>{
  const d=kind==='ppt'?(current as CR|null)?.drawnBy:null;if(!d)return '';
  if(d.kind==='converting')return '正在用 PowerPoint 绘制原页…完成前显示近似图。';
  if(d.kind==='approximate')return '原页为近似绘制（非 PowerPoint）'+(d.reason?'：'+d.reason:'。');
  if(d.kind==='pdf')return d.engine==='原始 PDF'?'':'原页按 PDF 绘制'+(d.engine?'（'+d.engine+'）':'')+'。';
  return '';
 });
 let dialog=$state<''|'preview'|'trial'|'retry'>(''),dialogPage=$state(0);
 function openDialog(kind:'preview'|'trial'|'retry',pageIndex=page-1){menuOpen=false;dialogPage=pageIndex;dialog=kind;}
</script>

<svelte:window onclick={outside} onkeydown={e=>{if(e.key==='Escape')menuOpen=false;}}/>

<div class="read">
 <div class="toolbar">
  <div class="segmented" role="tablist" aria-label="材料类型">
   <a role="tab" href={href('ppt')} aria-selected={kind==='ppt'} class:on={kind==='ppt'}>课件</a>
   <a role="tab" href={href('ref')} aria-selected={kind==='ref'} class:on={kind==='ref'}>参考文献</a>
  </div>

  {#if list.length}
   <select aria-label="选择材料" value={file?.id} onchange={e=>{const id=(e.currentTarget as HTMLSelectElement).value;router.go(href(kind,id,readerCache.lastPage(project.id,kind,id)));}}>
    {#each list as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
   </select>
   <div class="pager" aria-label="翻页">
    <button class="btn btn-quiet icon" onclick={()=>goPage(page-1)} disabled={page<=1} title="上一页"><Icon name="chevron-left" size={16}/></button>
    <input aria-label="页码" type="number" min="1" max={total||1} value={page} onchange={e=>goPage(Number((e.currentTarget as HTMLInputElement).value))}/>
    <span>/ {total||'–'}</span>
    {#if printed}<span class="printed" title="书上印的页码">印刷页 {printed}</span>{/if}
    <button class="btn btn-quiet icon" onclick={()=>goPage(page+1)} disabled={!total||page>=total} title="下一页"><Icon name="chevron-right" size={16}/></button>
   </div>
   <fieldset class="cols" aria-label="显示">
    <label><input type="checkbox" bind:checked={columns[kind].original}/>原页</label>
    <label><input type="checkbox" bind:checked={columns[kind].translation}/>译文</label>
    {#if kind==='ppt'}<label><input type="checkbox" bind:checked={columns.ppt.notes}/>细读</label>{/if}
   </fieldset>
  {/if}

  <div class="end">
   {#if action}<button class="btn btn-primary" onclick={start} disabled={action.disabled||starting}>{starting?'正在开始…':action.label}</button>{/if}
   <div class="menu" bind:this={menuWrap}>
    <button class="btn btn-quiet icon" onclick={()=>menuOpen=!menuOpen} aria-haspopup="menu" aria-expanded={menuOpen} title="更多">⋯</button>
    {#if menuOpen}
     <div class="menu-list" role="menu">
      {#if file&&kind==='ppt'}<a role="menuitem" href={'/api/projects/'+encodeURIComponent(project.id)+'/source?id='+encodeURIComponent(file.id)}>下载原件</a>{/if}
      {#if file&&kind==='ref'}<a role="menuitem" href={api.referenceFileUrl(project.id,file.id)} target="_blank" rel="noopener">打开原始 PDF <Icon name="external" size={12}/></a>{/if}
      {#if file&&kind==='ref'&&untranslated&&status?.kind!=='running'&&status?.kind!=='stale'}
       <div class="menu-sep" role="separator"></div>
       <span class="menu-label">高级</span>
       <button role="menuitem" onclick={()=>openDialog('retry')}>用其他模型补译…</button>
      {/if}
      {#if file&&kind==='ppt'}
       <div class="menu-sep" role="separator"></div>
       <span class="menu-label">高级</span>
       <button role="menuitem" onclick={()=>openDialog('preview')}>原页预览…</button>
       <button role="menuitem" disabled={!total} onclick={()=>openDialog('trial')}>试解析第 {page} 页…</button>
      {/if}
     </div>
    {/if}
   </div>
  </div>
 </div>

 {#if file&&status}
  <div class="statusline">
   <StatusBadge kind={status.kind} text={status.text}/>
   {#if kind==='ppt'&&current&&(current as CR).learningStale&&status.kind==='done'}
    {@const n=(current as CR).pages.filter(p=>p.learningStale).length}
    <span class="note">{(current as CR).drawnBy?.kind==='powerpoint'?'原页已改用 PowerPoint 绘制，'+n+' 页的导读是按旧图生成的，可在该页 ⋯ 中重新生成。':'原页渲染方式更新过，'+n+' 页的导读是按旧版原页生成的，内容通常仍可用。'}</span>
   {/if}
   {#each kind==='ppt'&&current?(current as CR).notes||[]:[] as note (note)}<span class="note">{note}。安装这些字体后，原页显示会更准确。</span>{/each}
   {#if drawnNote}<span class="note">{drawnNote} <button class="link" onclick={()=>openDialog('preview')}>原页预览…</button></span>{/if}
   {#if kind==='ppt'&&current&&(current as CR).previewIssue}<span class="note">原页预览：{(current as CR).previewIssue}</span>{/if}
   {#if kind==='ref'&&current&&(current as RR).sourceWarnings?.missingPages?.length}<span class="note">有 {(current as RR).sourceWarnings!.missingPages!.length} 页原文未能解析</span>{/if}
   {#if kind==='ppt'&&list.length>1&&action}<span class="note">课件导读按整周生成，会处理本周全部课件。</span>{/if}
   {#if actionError}<ErrorNote text={actionError}/>{/if}
  </div>
 {/if}

 <div class="body">
  {#if !list.length}
   <div class="empty">
    <h2>{kind==='ppt'?'本周还没有课件':'本周还没有参考文献'}</h2>
    <p>在"概览"中添加文件后会出现在这里。</p>
    <a class="btn btn-primary" href={courseHref(project.id,'overview')}>去概览添加文件</a>
   </div>
  {:else if file&&loadError[keyOf(kind,file.id)]}
   <div class="empty"><h2>无法读取这份材料</h2><p>{loadError[keyOf(kind,file.id)]}</p><button class="btn" onclick={()=>load(kind,file.id,true)}>重试</button></div>
  {:else if !current}
   <p class="loading">正在读取…</p>
  {:else if kind==='ppt'}
   {#key file?.id}
    <CoursewareReader projectId={project.id} reader={current as CR} columns={columns.ppt} {jump} onpage={onPage}
     mode={preview?.mode} pdf={preview?.pdf} pptx={preview?.pptx} reload={preview?.reload} pageCount={preview?.status?.pages||0} oncheck={checkHint} {generating} onredo={redo} ontrial={i=>openDialog('trial',i)}/>
   {/key}
  {:else}
   {#key file?.id}
    <ReferenceReader projectId={project.id} reader={current as RR} columns={columns.ref} {jump} onpage={onPage} onpages={n=>pageCount=n}/>
   {/key}
  {/if}
 </div>
</div>

{#if dialog==='preview'&&preview}<PreviewDialog {preview} projectId={project.id} onclose={()=>dialog=''}/>{/if}
{#if dialog==='retry'&&file&&kind==='ref'}<RetryDialog projectId={project.id} sourceId={file.id} fileName={file.name} remaining={untranslated} onclose={()=>dialog=''} onstarted={()=>{dialog='';store.refresh();}}/>{/if}
{#if dialog==='trial'&&file}<TrialDialog projectId={project.id} sourceId={file.id} fileName={file.name} pageIndex={dialogPage} onclose={()=>dialog=''}/>{/if}

<style>
 .read{display:flex;flex-direction:column;height:100%;min-height:0;}
 .toolbar{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-4);background:var(--bg-surface);border-bottom:1px solid var(--line);}
 .segmented{display:inline-flex;padding:2px;border-radius:var(--radius-sm);background:var(--sand-200);}
 .segmented a{padding:var(--space-1) var(--space-3);border-radius:4px;color:var(--fg-muted);text-decoration:none;font-size:var(--text-sm);}
 .segmented a.on{background:var(--bg-raised);color:var(--fg);font-weight:var(--weight-medium);}
 select{min-width:0;max-width:360px;height:32px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);font-size:var(--text-sm);}
 .pager{display:flex;align-items:center;gap:var(--space-1);font-size:var(--text-sm);color:var(--fg-muted);}
 .printed{margin-left:var(--space-1);white-space:nowrap;}
 .pager input{width:52px;height:28px;text-align:center;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .icon{width:32px;padding:0;justify-content:center;}
 .cols{display:flex;gap:var(--space-3);margin:0;padding:0;border:0;font-size:var(--text-sm);color:var(--fg-muted);}
 .cols label{display:flex;align-items:center;gap:var(--space-1);cursor:pointer;}
 .end{margin-left:auto;display:flex;align-items:center;gap:var(--space-2);}
 .menu{position:relative;}
 .menu-list{position:absolute;right:0;top:calc(100% + var(--space-1));min-width:260px;padding:var(--space-1);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:10;display:flex;flex-direction:column;}
 .menu-list button{display:flex;align-items:center;padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg);font-size:var(--text-sm);text-align:left;}
 .menu-list button:hover:not(:disabled){background:var(--sand-100);}
 .menu-list button:disabled{color:var(--fg-subtle);}
 .menu-list a{display:flex;align-items:center;gap:var(--space-1);padding:var(--space-2) var(--space-3);border-radius:var(--radius-sm);color:var(--fg);text-decoration:none;font-size:var(--text-sm);}
 .menu-list a:hover{background:var(--sand-100);}
 .menu-sep{height:1px;margin:var(--space-1) 0;background:var(--line);}
 .menu-label{padding:var(--space-1) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .statusline{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .note{color:var(--fg-muted);}
 .link{border:0;background:none;padding:0;color:var(--accent);font-size:inherit;cursor:pointer;}
 .body{flex:1;min-height:0;position:relative;}
 .empty{max-width:520px;margin:var(--space-6) auto;padding:0 var(--space-4);}
 .empty h2{font-size:var(--text-lg);margin-bottom:var(--space-2);}
 .empty p{color:var(--fg-muted);}
 .loading{padding:var(--space-5);color:var(--fg-muted);}
</style>
