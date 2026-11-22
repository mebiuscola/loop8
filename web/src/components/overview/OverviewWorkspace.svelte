<script lang="ts">
 // Overview: "where is this week up to". The one home for adding files, materials'
 // status and next steps, adding classes, and the week's own rename / delete.
 import {untrack} from 'svelte';
 import Icon from '../Icon.svelte';
 import Modal from '../Modal.svelte';
 import StatusBadge from '../StatusBadge.svelte';
 import MaterialRow from './MaterialRow.svelte';
 import AddFiles from './AddFiles.svelte';
 import {api,ApiError,type CoursewareReader,type Project,type ReferenceReader,type Session} from '../../lib/api';
 import {router,courseHref} from '../../lib/router.svelte';
 import {store} from '../../lib/store.svelte';
 import {scriptStatus} from '../../lib/classroom';
 import {sessionDiveStatus,weekDiveStatus,weeklyAnalysis} from '../../lib/deepdive';

 let {project}:{project:Project}=$props();
 const fail=(e:unknown)=>e instanceof ApiError?e.message:String(e);
 const locked=$derived(project.status==='running'||!!project.weekDeletionPending);

 // Materials in a stable order: courseware, references, course notes.
 const order:Record<string,number>={ppt:0,reading:1,bb:2};
 const materials=$derived(project.files.filter(f=>f.role in order).sort((a,b)=>order[a.role]-order[b.role]));

 // ---- reading status of each material (same data as the reading page) ----
 // Each entry remembers the role it was read for: after a role change the row must not be given
 // the other kind's data (a courseware row given reference data broke the whole page).
 let readers=$state<Record<string,{role:string;reader:CoursewareReader|ReferenceReader}>>({});
 const signature=$derived(JSON.stringify([project.tasks||{},project.materialRevision,materials.map(f=>[f.id,f.role,f.parsed,f.parseStatus,f.aiParse?.status,f.aiParse?.completed])]));
 let last='';
 $effect(()=>{
  const sig=signature;if(sig===last)return;last=sig;
  untrack(()=>{
   for(const f of materials){
    const load=f.role==='ppt'?api.reader(project.id,f.id):f.role==='reading'&&f.parsed?api.referenceReader(project.id,f.id):null;
    const role=f.role;
    if(load)load.then(reader=>readers[f.id]={role,reader},()=>{/* the row shows "读取中" and the reading page shows the error */});
   }
  });
 });

 // ---- adding files (button or drop anywhere on the page) ----
 let picker=$state<HTMLInputElement>();
 let adding=$state<File[]|null>(null),addNote=$state('');
 let dragging=$state(0);
 function drop(e:DragEvent){e.preventDefault();dragging=0;const list=Array.from(e.dataTransfer?.files||[]);if(list.length&&!locked)adding=list;}

 // ---- course notes (Blackboard text) ----
 let bbOpen=$state(false),bbText=$state(''),bbSaving=$state(false),bbNote=$state('');
 function openBb(){bbText=project.bbText||'';bbNote='';bbOpen=!bbOpen;}
 async function saveBb(){
  bbSaving=true;bbNote='';
  try{await api.saveBb(project.id,bbText);await store.refresh();bbNote='已保存。';}catch(e){bbNote=fail(e);}
  finally{bbSaving=false;}
 }

 // ---- classes ----
 let adder=$state(false),newType=$state('Lecture'),newTitle=$state(''),newDate=$state(''),classError=$state(''),classBusy=$state(false);
 async function addClass(e:SubmitEvent){
  e.preventDefault();classBusy=true;classError='';
  try{await api.createSession(project.id,newType,newTitle,newDate);adder=false;newTitle='';newDate='';await store.refresh();}
  catch(err){classError=fail(err);}
  finally{classBusy=false;}
 }
 // A generated but outdated result is shown in the "stale" colour without a tick.
 const chip=(on:boolean,label:string,stale=false)=>({on,stale:on&&stale,label:on&&stale?label+(/[A-Za-z]$/.test(label)?' ':'')+'待更新':label});
 const chips=(s:Session)=>{
  const script=scriptStatus(project,s),dive=sessionDiveStatus(project,s);
  return [chip(!!s.srtId,'字幕'),chip(!!s.audio,'录音'),chip(!!s.generation,'讲稿',script.kind==='stale'),chip(dive.kind==='done'||dive.kind==='stale','Deep Dive',dive.kind==='stale')];
 };

 // ---- dialogs: rename and two-step delete for a class or the whole week ----
 type Dialog={kind:'rename-class';session:Session}|{kind:'delete-class';session:Session;text:string}|{kind:'rename-week'}|{kind:'delete-week';text:string};
 let dialog=$state<Dialog|null>(null),dialogError=$state(''),dialogBusy=$state(false),nameInput=$state('');
 let classMenu=$state<string|null>(null),weekMenu=$state(false);
 function closeMenus(event:MouseEvent){const t=event.target as HTMLElement;if(!t.closest('.menu')){classMenu=null;weekMenu=false;}}
 async function openDeleteClass(s:Session){
  classMenu=null;dialogError='';
  try{const plan=await api.sessionDeletePlan(project.id,s.id);dialog={kind:'delete-class',session:s,text:`${plan.title}：${plan.subtitles} 份字幕、${plan.recordings} 份录音、${plan.versions?1:0} 组当前输出（讲稿、本节 Deep Dive）。`};}
  catch(e){classError=fail(e);}
 }
 async function openDeleteWeek(){
  weekMenu=false;dialogError='';
  try{const plan=await api.weekDeletePlan(project.id);dialog={kind:'delete-week',text:`${plan.name}：${plan.sessions} 节课堂、${plan.materials} 份教学材料、${plan.subtitles} 份字幕、${plan.recordings} 份录音，以及全部译文、讲稿和 Deep Dive。`};}
  catch(e){classError=fail(e);}
 }
 async function runDialog(){
  if(!dialog)return;dialogBusy=true;dialogError='';
  try{
   if(dialog.kind==='rename-class')await api.sessionRename(project.id,dialog.session.id,nameInput.trim());
   else if(dialog.kind==='delete-class')await api.sessionDelete(project.id,dialog.session.id);
   else if(dialog.kind==='rename-week'){
    const p=await api.weekRename(project.id,nameInput.trim());
    // Renaming may give the week a new id; follow it.
    if(p?.id&&p.id!==project.id){dialog=null;await store.refresh();router.go(courseHref(p.id,'overview'));return;}
   }else{
    // Leave the week's page first, so the refresh does not ask for the deleted week.
    await api.weekDelete(project.id);dialog=null;router.go('#/');await store.refresh();return;
   }
   dialog=null;await store.refresh();
  }catch(e){dialogError=fail(e);}
  finally{dialogBusy=false;}
 }

 const week=$derived(weekDiveStatus(project));
 const weekIncluded=$derived(weeklyAnalysis(project).available?(project.weekly?.selectedSessionIds?.length??0):null);
</script>

<svelte:window onclick={closeMenus}/>
<input class="hidden" type="file" multiple accept=".pptx,.ppt,.pdf,.md,.txt,.srt,.mp3,.m4a,.wav,.ogg,.webm,.flac,.aac" bind:this={picker}
 onchange={e=>{const input=e.currentTarget as HTMLInputElement;const list=Array.from(input.files||[]);input.value='';if(list.length)adding=list;}}/>

<div class="overview" role="region" aria-label="概览" class:dragging={dragging>0}
 ondragenter={e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragging++;}}}
 ondragleave={()=>dragging=Math.max(0,dragging-1)} ondragover={e=>e.preventDefault()} ondrop={drop}>
 <header class="head">
  <h1>{project.name}</h1>
  <div class="end">
   <button class="btn btn-primary" onclick={()=>picker?.click()} disabled={locked}>＋ 添加文件</button>
   <div class="menu">
    <button class="btn btn-quiet icon" onclick={()=>weekMenu=!weekMenu} aria-haspopup="menu" aria-expanded={weekMenu} title="更多" aria-label="本周更多操作">⋯</button>
    {#if weekMenu}
     <div class="menu-list" role="menu">
      <button role="menuitem" disabled={locked} onclick={()=>{weekMenu=false;nameInput=project.name;dialogError='';dialog={kind:'rename-week'};}}>重命名本周</button>
      <div class="menu-sep" role="separator"></div><span class="menu-label">高级</span>
      <a role="menuitem" href={api.pptSkillUrl()}>下载 PPT 外部解析 Skill</a>
      <div class="menu-sep" role="separator"></div>
      <button role="menuitem" class="danger" disabled={project.status==='running'} onclick={openDeleteWeek}>{project.weekDeletionPending?'继续删除整周…':'删除整周…'}</button>
     </div>
    {/if}
   </div>
  </div>
 </header>
 {#if addNote}<p class="note" role="status">{addNote}</p>{/if}
 {#if project.weekDeletionPending}<p class="warn" role="alert">整周课程尚未删除完成。请在右上角 ⋯ 中继续删除。</p>{/if}

 <section>
  <div class="section-head"><h2>材料</h2><span class="when">课前</span></div>
  <div class="box">
   <div class="bb">
    <span class="tag">BB</span>
    <div class="name"><span class="title">课程说明（Blackboard 文字）</span><small>{project.bbText?.trim()?project.bbText.trim().slice(0,60)+(project.bbText.trim().length>60?'…':''):'可选：粘贴本周 Blackboard 上的课程说明'}</small></div>
    <StatusBadge kind={project.bbText?.trim()?'done':'idle'} text={project.bbText?.trim()?'已保存':'未填写'}/>
    <button class="btn" onclick={openBb} aria-expanded={bbOpen}>{bbOpen?'收起':project.bbText?.trim()?'编辑':'填写'}</button>
   </div>
   {#if bbOpen}
    <div class="bb-edit">
     <textarea bind:value={bbText} rows="6" aria-label="课程说明" disabled={locked||bbSaving}></textarea>
     <div class="row-end">{#if bbNote}<span class="note">{bbNote}</span>{/if}<button class="btn btn-primary" onclick={saveBb} disabled={locked||bbSaving||bbText===(project.bbText||'')}>{bbSaving?'正在保存…':'保存'}</button></div>
    </div>
   {/if}
   {#each materials as f (f.id)}
    <MaterialRow {project} file={f} reader={readers[f.id]?.role===f.role?readers[f.id].reader:null} {locked}/>
   {:else}
    <div class="empty">
     <p>还没有课件或参考文献。点"＋ 添加文件"，或把文件拖到这个页面。</p>
     <small>课件：PPTX / PPT / PDF；参考文献：PDF；课程说明：PDF / MD / TXT。</small>
    </div>
   {/each}
  </div>
 </section>

 <section>
  <div class="section-head"><h2>课堂</h2><span class="when">课后</span></div>
  <div class="box">
   {#each project.sessions as s (s.id)}
    {@const pending=project.deletionPending?.sessionId===s.id}
    <div class="class-row">
     <span class="tag">{s.type==='Seminar'?'SEM':s.type==='Lecture'?'LEC':'—'}</span>
     <div class="name"><span class="title">{s.type} · {s.title}</span><small>{s.date||'未填日期'}</small></div>
     <ul class="chips" aria-label="本节进度">{#each chips(s) as c (c.label)}<li class:on={c.on&&!c.stale} class:stale={c.stale}>{c.label}{c.stale?'':c.on?' ✓':' –'}</li>{/each}</ul>
     <div class="act">
      {#if pending}<button class="btn" onclick={()=>openDeleteClass(s)}>继续删除</button>
      {:else}<a class="btn" href={courseHref(project.id,'class',encodeURIComponent(s.id))}>打开</a>{/if}
      <div class="menu">
       <button class="btn btn-quiet icon" onclick={()=>classMenu=classMenu===s.id?null:s.id} aria-haspopup="menu" aria-expanded={classMenu===s.id} title="更多" aria-label={'更多 · '+s.title}>⋯</button>
       {#if classMenu===s.id}
        <div class="menu-list" role="menu">
         <a role="menuitem" href={courseHref(project.id,'deepdive',encodeURIComponent(s.id))}>本节 Deep Dive</a>
         <button role="menuitem" disabled={locked||!!project.deletionPending} onclick={()=>{classMenu=null;nameInput=s.title;dialogError='';dialog={kind:'rename-class',session:s};}}>重命名</button>
         <div class="menu-sep" role="separator"></div>
         <button role="menuitem" class="danger" disabled={locked||!!project.deletionPending&&!pending} onclick={()=>openDeleteClass(s)}>删除这节课…</button>
        </div>
       {/if}
      </div>
     </div>
    </div>
   {/each}
   {#if adder}
    <form class="adder" onsubmit={addClass}>
     <select bind:value={newType} aria-label="类型"><option value="Lecture">Lecture</option><option value="Seminar">Seminar</option><option value="Other">Other</option></select>
     <input type="text" bind:value={newTitle} maxlength="120" placeholder={newType+' '+(project.sessions.length+1)} aria-label="名称（可留空）"/>
     <input type="date" bind:value={newDate} aria-label="日期（可选）"/>
     <button class="btn btn-primary" type="submit" disabled={classBusy}>添加</button>
     <button class="btn btn-quiet" type="button" onclick={()=>adder=false}>取消</button>
    </form>
   {:else}
    <button class="add-class" onclick={()=>{adder=true;classError='';}} disabled={locked}>＋ 添加一节课</button>
   {/if}
   {#if classError}<p class="error" role="alert">{classError}</p>{/if}
  </div>
  <p class="hint">字幕和录音可以在"添加文件"里指定给某节课，也可以打开这节课后上传。</p>
 </section>

 <section>
  <div class="section-head"><h2>整周</h2><span class="when">周末</span></div>
  <div class="box">
   <div class="class-row">
    <span class="tag">WK</span>
    <div class="name"><span class="title">整周 Deep Dive</span><small>{weekIncluded===null?'可选择纳入哪些课堂':weekIncluded?'含 '+weekIncluded+' 节课':'仅本周材料'}</small></div>
    <StatusBadge kind={week.kind} text={week.text}/>
    <div class="act"><a class="btn" href={courseHref(project.id,'deepdive','week')}>打开</a></div>
   </div>
  </div>
 </section>

 {#if dragging>0}<div class="drop-hint" aria-hidden="true">松开以添加文件</div>{/if}
</div>

{#if adding}
 <AddFiles {project} files={adding} onclose={note=>{adding=null;addNote=note;}}/>
{/if}

{#if dialog}
 <Modal title={dialog.kind==='rename-class'?'重命名课堂':dialog.kind==='rename-week'?'重命名本周':dialog.kind==='delete-class'?'删除这节课':'删除整周课程'} onclose={()=>dialog=null} busy={dialogBusy}>
  {#if dialog.kind==='rename-class'||dialog.kind==='rename-week'}
   <label class="field">名称<input type="text" bind:value={nameInput} maxlength="120"/></label>
  {:else}
   <p>将永久删除：</p><p><b>{dialog.text}</b></p><p>此操作不能撤销。</p>
  {/if}
  {#if dialogError}<p class="error" role="alert">{dialogError}</p>{/if}
  {#snippet actions()}
   {#if dialog!.kind==='rename-class'||dialog!.kind==='rename-week'}
    <button class="btn btn-primary" disabled={dialogBusy||!nameInput.trim()} onclick={runDialog}>保存</button>
   {:else}
    <button class="btn danger" disabled={dialogBusy} onclick={runDialog}>{dialogBusy?'正在删除…':'永久删除'}</button>
   {/if}
  {/snippet}
 </Modal>
{/if}

<style>
 .hidden{display:none;}
 .overview{position:relative;max-width:1080px;margin:0 auto;padding:var(--space-5) var(--space-5) var(--space-6);}
 .head{display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);}
 h1{font-size:var(--text-xl);margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .end{margin-left:auto;display:flex;align-items:center;gap:var(--space-2);}
 section{margin-top:var(--space-5);}
 .section-head{display:flex;align-items:baseline;gap:var(--space-2);margin-bottom:var(--space-2);}
 h2{font-size:var(--text-md);margin:0;}
 .when{font-size:var(--text-xs);color:var(--fg-muted);}
 .box{border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);}
 .bb,.class-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--line);}
 .class-row{grid-template-columns:auto minmax(0,1fr) auto auto;}
 .box>:last-child{border-bottom:0;}
 .tag{width:36px;text-align:center;padding:1px 0;border-radius:var(--radius-sm);background:var(--sand-200);color:var(--fg-muted);font-size:var(--text-xs);font-weight:var(--weight-bold);}
 .name{display:flex;flex-direction:column;min-width:0;}
 .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm);font-weight:var(--weight-medium);}
 small{color:var(--fg-muted);font-size:var(--text-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .bb-edit{padding:var(--space-2) var(--space-3) var(--space-3);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:var(--space-2);}
 textarea{width:100%;resize:vertical;padding:var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);font-size:var(--text-sm);}
 .row-end{display:flex;justify-content:flex-end;align-items:center;gap:var(--space-2);}
 .chips{display:flex;flex-wrap:wrap;gap:var(--space-1);margin:0;padding:0;list-style:none;font-size:var(--text-xs);}
 .chips li{padding:1px var(--space-2);border-radius:999px;background:var(--status-idle-bg);color:var(--status-idle-fg);white-space:nowrap;}
 .chips li.on{background:var(--status-done-bg);color:var(--status-done-fg);}
 .chips li.stale{background:var(--status-stale-bg);color:var(--status-stale-fg);}
 .act{display:flex;align-items:center;gap:var(--space-1);justify-content:flex-end;}
 .icon{width:32px;padding:0;justify-content:center;}
 .menu{position:relative;}
 .menu-list{position:absolute;right:0;top:calc(100% + var(--space-1));min-width:220px;padding:var(--space-1);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:10;display:flex;flex-direction:column;}
 .menu-list a,.menu-list button{display:flex;padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg);text-decoration:none;font-size:var(--text-sm);text-align:left;}
 .menu-list a:hover,.menu-list button:hover:not(:disabled){background:var(--sand-100);}
 .menu-list button:disabled{color:var(--fg-subtle);}
 .menu-sep{height:1px;margin:var(--space-1) 0;background:var(--line);}
 .menu-label{padding:var(--space-1) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .danger{color:var(--status-failed-fg);}
 .btn.danger{border-color:var(--status-failed-fg);}
 .add-class{width:100%;padding:var(--space-2) var(--space-3);border:0;background:transparent;color:var(--accent);text-align:left;font-size:var(--text-sm);}
 .add-class:hover:not(:disabled){background:var(--sand-100);}
 .adder{display:flex;flex-wrap:wrap;gap:var(--space-2);padding:var(--space-2) var(--space-3);}
 .adder select,.adder input{height:32px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);font-size:var(--text-sm);padding:0 var(--space-2);}
 .adder input[type=text]{flex:1;min-width:160px;}
 .empty{padding:var(--space-4) var(--space-3);}
 .empty p{margin:0 0 var(--space-1);}
 .note,.hint{color:var(--fg-muted);font-size:var(--text-xs);}
 .hint{margin:var(--space-2) 0 0;}
 .warn{color:var(--status-stopped-fg);font-size:var(--text-sm);}
 .error{color:var(--status-failed-fg);font-size:var(--text-xs);margin:var(--space-1) var(--space-3);}
 .field{display:flex;flex-direction:column;gap:var(--space-1);}
 .field input{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);}
 .overview.dragging .box{outline:2px dashed var(--accent);outline-offset:2px;}
 .drop-hint{position:fixed;left:50%;bottom:var(--space-6);transform:translateX(-50%);padding:var(--space-2) var(--space-4);border-radius:999px;background:var(--accent-strong);color:var(--white);font-size:var(--text-sm);pointer-events:none;}
 @media (max-width:760px){
  .overview{padding:var(--space-3);}
  .class-row{grid-template-columns:auto minmax(0,1fr) auto;}
  .class-row .chips,.class-row :global(.badge){grid-column:2/-1;grid-row:2;}
 }
</style>
