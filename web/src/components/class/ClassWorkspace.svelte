<script lang="ts">
 import {untrack} from 'svelte';
 import StatusBadge from '../StatusBadge.svelte';
 import ErrorNote from '../ErrorNote.svelte';
 import ClassReader from './ClassReader.svelte';
 import {api,ApiError,type Project,type Session,type Transcript} from '../../lib/api';
 import {router,courseHref} from '../../lib/router.svelte';
 import {store} from '../../lib/store.svelte';
 import {askContext} from '../../lib/ask-context.svelte';
 import {scriptStatus} from '../../lib/classroom';

 let {project,rest}:{project:Project;rest:string}=$props();

 // rest = "<sessionId>/p/<paragraph>", or "<sessionId>/t/<ms>" for a moment cited in an answer.
 const parsed=$derived.by(()=>{
  const [id,mark,n]=rest.split('/');
  return {sessionId:id||'',paragraph:mark==='p'?Math.max(0,(Number(n)||1)-1):0,timeMs:mark==='t'&&/^\d+$/.test(n||'')?Number(n):null};
 });
 const sessions=$derived(project.sessions);
 const session=$derived(sessions.find(s=>s.id===parsed.sessionId)||sessions[0]||null);
 const href=(s:Session,paragraph=0)=>courseHref(project.id,'class',encodeURIComponent(s.id)+(paragraph?'/p/'+(paragraph+1):''));

 const status=$derived(session?scriptStatus(project,session):null);
 const srt=$derived(session?project.files.find(f=>f.id===session.srtId):undefined);
 const recording=$derived(session?.audio?project.files.find(f=>f.id===session.audio!.fileId):undefined);

 // ---- transcript, cached per class and version ----
 let transcripts=$state<Record<string,Transcript|null>>({});
 let loadError=$state('');
 // The reader stays mounted for one class and version (readerKey); a change to the
 // recording or its alignment (versionKey) refreshes the data underneath it.
 const readerKey=$derived(session?.generation?session.id+'|'+session.generation:'');
 const versionKey=$derived(readerKey?readerKey+'|'+JSON.stringify(session!.audio||null):'');
 $effect(()=>{
  const key=versionKey,id=session?.id;
  if(!key||!id)return;
  untrack(()=>{
   if(key in transcripts)return;
   transcripts[key]=null;loadError='';
   api.transcript(project.id,id).then(t=>transcripts[key]=t,e=>{delete transcripts[key];loadError=e instanceof ApiError?e.message:String(e);});
  });
 });
 let previous:{key:string;data:Transcript}|null=null;
 const transcript=$derived.by(()=>{
  const now=versionKey?transcripts[versionKey]:null;
  if(now){previous={key:readerKey,data:now};return now;}
  return previous?.key===readerKey&&readerKey?previous.data:null;
 });

 // ---- position: the paragraph in view is kept in the URL ----
 let seq=0;
 let jump=$state({index:0,seq:0,flash:false});
 $effect(()=>{
  const p=parsed.paragraph,t=parsed.timeMs;session?.id;
  if(t===null){untrack(()=>jump={index:p,seq:++seq,flash:false});return;}
  // A cited moment: wait for the transcript, open the paragraph containing it, then keep a normal URL.
  if(!transcript?.available||!session)return;
  const list=transcript.paragraphs;let index=list.findIndex(x=>t<x.endMs);if(index<0)index=list.length-1;
  untrack(()=>{jump={index,seq:++seq,flash:true};router.remember(href(session,index));});
 });
 function onParagraph(n:number){if(session)router.remember(href(session,n));}

 $effect(()=>{
  if(!session){askContext.set(null);return;}
  askContext.set({label:session.type+' · '+session.title,scope:session.id,focus:null});
 });
 $effect(()=>()=>askContext.set(null));

 // ---- the one primary action ----
 const action=$derived.by(()=>{
  if(!session||!status||!session.srtId)return null;
  if(status.kind==='running')return {label:'讲稿生成中…',disabled:true};
  if(status.kind==='done')return null;
  return {label:status.kind==='stale'?'更新讲稿':status.kind==='stopped'?'继续生成讲稿':status.kind==='failed'?'重新生成讲稿':'生成讲稿',disabled:false};
 });
 let starting=$state(false),actionError=$state('');
 async function generate(){
  if(!session)return;
  starting=true;actionError='';menuOpen=false;
  try{await api.process(project.id,'session',session.id);await store.refresh();}
  catch(e){actionError=e instanceof ApiError?e.message:String(e);}
  finally{starting=false;}
 }

 // ---- uploads (subtitles and recording of this class) ----
 let srtInput=$state<HTMLInputElement>(),audioInput=$state<HTMLInputElement>();
 let uploading=$state(''),uploadNote=$state('');
 const AUDIO=/\.(mp3|m4a|wav|ogg|webm|flac|aac)$/i;
 async function upload(files:FileList|File[]|null){
  if(!session||!files)return;
  uploadNote='';actionError='';
  for(const file of Array.from(files)){
   const isSrt=/\.srt$/i.test(file.name),isAudio=AUDIO.test(file.name);
   if(!isSrt&&!isAudio){actionError=file.name+'：请上传 .srt 字幕，或 MP3、M4A、WAV、OGG、WebM、FLAC、AAC 录音。';continue;}
   try{
    uploading='正在保存 '+file.name+'…';
    const p=isSrt?await api.uploadSrt(project.id,session.id,file):await api.uploadAudio(project.id,session.id,file,f=>uploading='正在上传 '+file.name+' · '+Math.round(f*100)+'%');
    const last=(p as any).lastUpload;
    uploadNote=last?.kind==='reused'?'内容相同的文件已存在，沿用 '+last.name+'。':last?.kind==='renamed'?'同名文件内容不同，已另存为 '+last.name+'。':(isSrt?'字幕已保存。':'录音已保存。');
   }catch(e){actionError=e instanceof ApiError?e.message:String(e);}
  }
  uploading='';
  await store.refresh();
 }
 let dragging=$state(false);
 function drop(e:DragEvent){e.preventDefault();dragging=false;upload(e.dataTransfer?.files||null);}

 let menuOpen=$state(false);
 let menuWrap=$state<HTMLElement>();
 function outside(event:MouseEvent){if(menuOpen&&menuWrap&&!menuWrap.contains(event.target as Node))menuOpen=false;}
 const pick=(input?:HTMLInputElement)=>{menuOpen=false;input?.click();};
</script>

<svelte:window onclick={outside} onkeydown={e=>{if(e.key==='Escape')menuOpen=false;}}/>

<input class="hidden" type="file" accept=".srt" bind:this={srtInput} onchange={e=>{upload((e.currentTarget as HTMLInputElement).files);(e.currentTarget as HTMLInputElement).value='';}}/>
<input class="hidden" type="file" accept=".mp3,.m4a,.wav,.ogg,.webm,.flac,.aac,audio/*" bind:this={audioInput} onchange={e=>{upload((e.currentTarget as HTMLInputElement).files);(e.currentTarget as HTMLInputElement).value='';}}/>

<div class="class">
 {#if !sessions.length}
  <div class="empty">
   <h2>本周还没有课堂记录</h2>
   <p>在"概览"中添加一节课（Lecture / Seminar）后会出现在这里。</p>
   <a class="btn btn-primary" href={courseHref(project.id,'overview')}>去概览添加课堂</a>
  </div>
 {:else if session&&status}
  <div class="toolbar">
   <select aria-label="选择课堂" value={session.id} onchange={e=>router.go(href(sessions.find(s=>s.id===(e.currentTarget as HTMLSelectElement).value)!))}>
    {#each sessions as s (s.id)}<option value={s.id}>{s.type} · {s.title}{s.date?' · '+s.date:''} — {scriptStatus(project,s).text}</option>{/each}
   </select>
   <ul class="have" aria-label="本节材料">
    <li class:yes={!!srt} title={srt?.name||'还没有字幕'}>字幕 {srt?'✓':'–'}</li>
    <li class:yes={!!recording} title={recording?.name||'还没有录音（可选）'}>录音 {recording?'✓':'–'}</li>
    <li class:yes={!!session.generation} title={session.generation?'已生成':'未生成'}>讲稿 {session.generation?'✓':'–'}</li>
   </ul>
   <a class="link" href={courseHref(project.id,'deepdive',encodeURIComponent(session.id))}>查看本节 Deep Dive</a>
   <div class="end">
    {#if action}<button class="btn btn-primary" onclick={generate} disabled={action.disabled||starting}>{starting?'正在开始…':action.label}</button>{/if}
    <div class="menu" bind:this={menuWrap}>
     <button class="btn btn-quiet icon" onclick={()=>menuOpen=!menuOpen} aria-haspopup="menu" aria-expanded={menuOpen} title="更多">⋯</button>
     {#if menuOpen}
      <div class="menu-list" role="menu">
       <button role="menuitem" onclick={()=>pick(srtInput)}>{srt?'替换字幕':'上传字幕'}</button>
       <button role="menuitem" onclick={()=>pick(audioInput)}>{recording?'替换录音':'上传录音'}</button>
       {#if session.generation&&status.kind==='done'}<button role="menuitem" onclick={generate}>重新生成讲稿</button>{/if}
       {#if session.generation||srt||recording}<div class="menu-sep" role="separator"></div><span class="menu-label">下载</span>{/if}
       {#if session.generation}<a role="menuitem" href={api.outputUrl(project.id,'Class_Script_Bilingual.md',session.id)}>双语讲稿（Markdown）</a>{/if}
       {#if srt}<a role="menuitem" href={api.sourceUrl(project.id,srt.id)}>字幕原件</a>{/if}
       <div class="menu-sep" role="separator"></div>
       <a role="menuitem" href={courseHref(project.id,'overview')}>重命名、删除这节课（在概览中）</a>
      </div>
     {/if}
    </div>
   </div>
  </div>

  <div class="statusline">
   <StatusBadge kind={status.kind} text={status.text}/>
   {#if status.kind==='stale'&&session.generation}<span class="note">下面仍显示旧讲稿，更新后替换。</span>{/if}
   {#if uploading}<span class="note">{uploading}</span>{:else if uploadNote}<span class="note">{uploadNote}</span>{/if}
   {#if actionError}<ErrorNote text={actionError}/>{/if}
  </div>

  <div class="body">
   {#if !session.srtId}
    <div class="drop" class:on={dragging} role="region" aria-label="上传字幕" ondragover={e=>{e.preventDefault();dragging=true;}} ondragleave={()=>dragging=false} ondrop={drop}>
     <h2>先上传这节课的字幕</h2>
     <p>讲稿按字幕整理，时间来自字幕。录音可选，有录音时可以点段落时间播放。</p>
     <div class="row">
      <button class="btn btn-primary" onclick={()=>srtInput?.click()} disabled={!!uploading}>选择 .srt 字幕</button>
      <button class="btn" onclick={()=>audioInput?.click()} disabled={!!uploading}>{recording?'替换录音':'上传录音（可选）'}</button>
     </div>
     <small>也可以把文件直接拖到这里。</small>
    </div>
   {:else if !session.generation}
    <div class="empty">
     <h2>{status.kind==='running'?'讲稿正在生成':'还没有讲稿'}</h2>
     <p>{status.kind==='running'?'可以在右上角"后台任务"查看进度。完成后会显示在这里。':'点右上角"'+(action?.label||'生成讲稿')+'"，按字幕整理出英文原段和中文对照，区分 Lecturer / Student。生成在后台进行，不会自动开始。'}</p>
     {#if !recording}<button class="btn" onclick={()=>audioInput?.click()} disabled={!!uploading}>上传录音（可选）</button>{/if}
    </div>
   {:else if loadError}
    <div class="empty"><h2>无法读取讲稿</h2><p>{loadError}</p><button class="btn" onclick={()=>{loadError='';const k=versionKey;delete transcripts[k];transcripts={...transcripts};}}>重试</button></div>
   {:else if !transcript}
    <p class="loading">正在读取讲稿…</p>
   {:else if !transcript.available}
    <div class="empty"><h2>讲稿暂时无法按段落显示</h2><p>{transcript.message}</p>{#if session.generation}<a class="btn" href={api.outputUrl(project.id,'Class_Script_Bilingual.md',session.id)}>下载 Markdown 讲稿</a>{/if}</div>
   {:else}
    {#key readerKey}
     <ClassReader projectId={project.id} sessionId={session.id} data={transcript} {jump} onparagraph={onParagraph} onproject={()=>store.refresh()} onupload={()=>audioInput?.click()}/>
    {/key}
   {/if}
  </div>
 {/if}
</div>

<style>
 .hidden{display:none;}
 .class{display:flex;flex-direction:column;height:100%;min-height:0;}
 .toolbar{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-4);background:var(--bg-surface);border-bottom:1px solid var(--line);}
 select{min-width:0;max-width:420px;height:32px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);font-size:var(--text-sm);}
 .have{display:flex;gap:var(--space-2);margin:0;padding:0;list-style:none;font-size:var(--text-xs);}
 .have li{padding:2px var(--space-2);border-radius:999px;background:var(--status-idle-bg);color:var(--status-idle-fg);}
 .have li.yes{background:var(--status-done-bg);color:var(--status-done-fg);}
 .link{font-size:var(--text-sm);color:var(--accent);}
 .end{margin-left:auto;display:flex;align-items:center;gap:var(--space-2);}
 .icon{width:32px;padding:0;justify-content:center;}
 .menu{position:relative;}
 .menu-list{position:absolute;right:0;top:calc(100% + var(--space-1));min-width:240px;padding:var(--space-1);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:10;display:flex;flex-direction:column;}
 .menu-list a,.menu-list button{display:flex;align-items:center;gap:var(--space-1);padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg);text-decoration:none;font-size:var(--text-sm);text-align:left;}
 .menu-list a:hover,.menu-list button:hover{background:var(--sand-100);}
 .menu-sep{height:1px;margin:var(--space-1) 0;background:var(--line);}
 .menu-label{padding:var(--space-1) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .statusline{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 .note{color:var(--fg-muted);}
 .body{flex:1;min-height:0;position:relative;}
 .empty,.drop{max-width:560px;margin:var(--space-6) auto;padding:0 var(--space-4);}
 .drop{padding:var(--space-5);border:1px dashed var(--line-strong);border-radius:var(--radius-md);background:var(--bg-surface);}
 .drop.on{border-color:var(--accent);background:var(--accent-soft);}
 .empty h2,.drop h2{font-size:var(--text-lg);margin-bottom:var(--space-2);}
 .empty p,.drop p{color:var(--fg-muted);}
 .row{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:var(--space-3) 0 var(--space-2);}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .loading{padding:var(--space-5);color:var(--fg-muted);}
</style>
