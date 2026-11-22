<script lang="ts">
 // Finishes a reference translation with another model, e.g. when one model refused some
 // paragraphs. Only the untranslated paragraphs are sent; finished ones are kept, and the
 // model assigned to reference translation in the settings stays as it is.
 import {onMount} from 'svelte';
 import Modal from '../Modal.svelte';
 import ErrorNote from '../ErrorNote.svelte';
 import {api,ApiError,type ModelProfile} from '../../lib/api';

 let {projectId,sourceId,fileName,remaining,onclose,onstarted}:{projectId:string;sourceId:string;fileName:string;remaining:number;onclose:()=>void;onstarted:()=>void}=$props();
 let profiles=$state<ModelProfile[]>([]),current=$state(''),choice=$state(''),error=$state(''),busy=$state(false),loading=$state(true);
 onMount(async()=>{
  try{
   const s=await api.settings();
   profiles=s.modelProfiles;current=s.modelRoutes.referenceTranslation||s.defaultProfileId;
   choice=profiles.find(p=>p.id!==current)?.id||current;
  }catch(e){error=e instanceof ApiError?e.message:(e as Error).message;}
  finally{loading=false;}
 });
 async function start(){
  busy=true;error='';
  try{await api.processReference(projectId,sourceId,choice);onstarted();}
  catch(e){error=e instanceof ApiError?e.message:(e as Error).message;busy=false;}
 }
</script>

<Modal title="用其他模型补译" {onclose} {busy}>
 <p>{fileName} · 还有 {remaining} 段没有译文。只补译这些段落，已完成的译文保留；"模型分配"中的设置不变。</p>
 {#if loading}<p class="muted">正在读取模型…</p>
 {:else if profiles.length}
  <label class="field"><span>补译使用的模型</span>
   <select bind:value={choice} disabled={busy}>
    {#each profiles as p (p.id)}<option value={p.id}>{p.name}{p.model&&p.model!==p.name?' · '+p.model:''}{p.id===current?'（当前）':''}</option>{/each}
   </select>
  </label>
 {:else}<p class="muted">还没有可用的模型。<a href="#/settings">去设置</a></p>{/if}
 {#if error}<p><ErrorNote text={error}/></p>{/if}
 {#snippet actions()}<button class="btn btn-primary" disabled={busy||!choice} onclick={start}>{busy?'正在开始…':'开始补译'}</button>{/snippet}
</Modal>

<style>
 p{margin:0;}
 .muted{color:var(--fg-muted);}
 .field{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);}
 .field span{color:var(--fg-muted);font-size:var(--text-xs);}
 select{height:32px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
</style>
