<script lang="ts">
 // Confirms what each added file is before uploading: a material role, or the class a
 // subtitle / recording belongs to. Same-name files with different content are kept
 // under a numbered name by the server; nothing is overwritten.
 import {untrack} from 'svelte';
 import Modal from '../Modal.svelte';
 import {api,ApiError,type Project,type Role} from '../../lib/api';
 import {store} from '../../lib/store.svelte';
 import {guessRole,roleLabel,rolesFor,sizeText} from '../../lib/overview';

 let {project,files,onclose}:{project:Project;files:File[];onclose:(summary:string)=>void}=$props();

 type Kind=Role|'srt'|'audio';
 // The list is taken once when the dialog opens; later changes are made in the dialog itself.
 const firstSession=untrack(()=>project.sessions[0]?.id||'');
 let items=$state(untrack(()=>files).map(file=>({file,kind:guessRole(file.name) as Kind|null,sessionId:firstSession,status:'' as ''|'done'|'error',note:''})));
 const choices=(name:string):Kind[]=>{const g=guessRole(name);return g==='srt'||g==='audio'?[g]:rolesFor(name);};
 const needsClass=(k:Kind|null)=>k==='srt'||k==='audio';
 const ready=$derived(items.length>0&&items.every(i=>i.status==='done'||i.kind&&(!needsClass(i.kind)||i.sessionId)));
 let busy=$state(false);

 async function upload(){
  busy=true;let saved=0;const notes:string[]=[];
  for(const item of items){
   if(item.status==='done'||!item.kind)continue;
   try{
    item.note='正在上传…';
    const p=item.kind==='srt'?await api.uploadSrt(project.id,item.sessionId,item.file)
     :item.kind==='audio'?await api.uploadAudio(project.id,item.sessionId,item.file,f=>item.note='正在上传 '+Math.round(f*100)+'%')
     :await api.uploadMaterial(project.id,item.file,item.kind);
    const last=p?.lastUpload;
    item.note=last?.kind==='reused'?'内容相同的文件已存在，沿用 '+last.name:last?.kind==='renamed'?'同名但内容不同，另存为 '+last.name:'已保存';
    if(last?.kind==='renamed')notes.push(item.file.name+' 另存为 '+last.name);
    item.status='done';saved++;
   }catch(e){item.status='error';item.note=e instanceof ApiError?e.message:String(e);}
  }
  busy=false;
  await store.refresh();
  if(items.every(i=>i.status==='done'))onclose('已添加 '+saved+' 个文件。'+(notes.length?notes.join('；')+'。':''));
 }
</script>

<Modal title="添加文件" onclose={()=>onclose(items.some(i=>i.status==='done')?'部分文件已添加。':'')} {busy} wide>
 <p class="hint">确认每个文件的用途后上传。原件按原名保存；同名但内容不同的文件会另存为编号文件名，不会覆盖。</p>
 <div class="list">
  {#each items as item, i (i)}
   {@const options=choices(item.file.name)}
   <div class="item" class:done={item.status==='done'}>
    <div class="name"><span title={item.file.name}>{item.file.name}</span><small>{sizeText(item.file.size)}</small></div>
    {#if !options.length}
     <span class="error">不支持的文件类型</span>
    {:else if needsClass(item.kind)}
     {#if project.sessions.length}
      <label class="pick">{item.kind==='srt'?'字幕':'录音'}属于
       <select bind:value={item.sessionId} disabled={busy||item.status==='done'}>{#each project.sessions as s (s.id)}<option value={s.id}>{s.type} · {s.title}</option>{/each}</select>
      </label>
     {:else}
      <span class="error">请先在"课堂"中添加一节课</span>
     {/if}
    {:else}
     <label class="pick">用途
      <select bind:value={item.kind} disabled={busy||item.status==='done'||options.length<2}>{#each options as r (r)}<option value={r}>{roleLabel[r]}</option>{/each}</select>
     </label>
    {/if}
    <span class="note" class:error={item.status==='error'}>{item.note}</span>
    {#if item.status!=='done'}<button class="btn btn-quiet" type="button" disabled={busy} onclick={()=>items.splice(i,1)} aria-label={'移除 '+item.file.name}>移除</button>{/if}
   </div>
  {/each}
 </div>
 {#snippet actions()}
  <button class="btn btn-primary" disabled={!ready||busy||items.every(i=>i.status==='done')} onclick={upload}>{busy?'正在上传…':'上传'}</button>
 {/snippet}
</Modal>

<style>
 .hint{margin:0 0 var(--space-3);color:var(--fg-muted);}
 .list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius-sm);}
 .item{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,auto) auto;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--line);}
 .item:last-child{border-bottom:0;}
 .item.done{background:var(--status-done-bg);}
 .name{display:flex;flex-direction:column;min-width:0;}
 .name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .pick{display:flex;align-items:center;gap:var(--space-2);white-space:nowrap;color:var(--fg-muted);}
 select{height:30px;max-width:240px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .note{font-size:var(--text-xs);color:var(--fg-muted);}
 .error{color:var(--status-failed-fg);font-size:var(--text-xs);}
</style>
