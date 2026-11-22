<script lang="ts">
 // Trial-parses one slide with the model assigned to "单页 PPT 试解析". The result is only
 // shown here (original, translation, close reading, things to check); nothing is saved.
 import {onMount} from 'svelte';
 import Modal from '../Modal.svelte';
 import JobView from '../settings/JobView.svelte';
 import {api} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';
 import {boldParts} from '../../lib/reading';

 let {projectId,sourceId,fileName,pageIndex,onclose}:{projectId:string;sourceId:string;fileName:string;pageIndex:number;onclose:()=>void}=$props();
 const run=new JobRun();
 type Result={page:{paragraphs:{english:string;chinese:string}[];closeReading:string};warnings?:string[]};
 let result=$state<Result|null>(null);
 async function start(){
  result=null;
  try{result=await run.run(()=>api.pptPagePreview(projectId,sourceId,pageIndex)) as unknown as Result;}catch{/* shown by JobView */}
 }
 onMount(()=>{start();return ()=>{if(run.state.running)run.state.cancel();};});
</script>

<Modal title="单页试解析" {onclose} wide>
 <p class="label">{fileName} · 第 {pageIndex+1} 页 · 结果只用于查看，不会写入课程。</p>
 <JobView job={run.state}/>
 {#if result}
  <section>
   <h3>原文与翻译</h3>
   {#each result.page.paragraphs as p, i (i)}
    <div class="para"><p class="en" lang="en">{p.english}</p><p class="zh" lang="zh-CN">{p.chinese}</p></div>
   {:else}<p class="muted">本页没有正文段落。</p>{/each}
   <h3>本页细读</h3>
   <p class="notes">{#each boldParts(result.page.closeReading||'') as part, i (i)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}</p>
   {#if result.warnings?.length}<h3>需要核对</h3>{#each result.warnings as w, i (i)}<p class="warn">{w}</p>{/each}{/if}
  </section>
 {/if}
 {#snippet actions()}<button class="btn" disabled={run.state.running} onclick={start}>重新试解析</button>{/snippet}
</Modal>

<style>
 .label{margin:0 0 var(--space-2);color:var(--fg-muted);}
 h3{font-size:var(--text-sm);margin:var(--space-4) 0 var(--space-2);}
 .para{padding:0 0 var(--space-2) var(--space-3);border-left:2px solid var(--kind-translation);margin-bottom:var(--space-2);}
 .en{margin:0 0 var(--space-1);font-family:var(--font-reading);}
 .zh{margin:0;}
 .notes{white-space:pre-wrap;padding-left:var(--space-3);border-left:2px solid var(--kind-analysis);line-height:1.7;margin:0;}
 .warn{color:var(--status-stopped-fg);margin:0 0 var(--space-1);}
 .muted{color:var(--fg-muted);}
</style>
