<script lang="ts">
 // How original pages are drawn for one courseware file.
 // PPT/PPTX: PowerPoint draws them; linking your own PDF is offered only when PowerPoint can't be used.
 // A PDF courseware: page images or the PDF itself.
 import Modal from '../Modal.svelte';
 import Icon from '../Icon.svelte';
 import {api} from '../../lib/api';
 import type {CoursePreview} from '../../lib/preview.svelte';
 import type {PreviewMode} from './OriginalPage.svelte';

 let {preview,projectId,onclose}:{preview:CoursePreview;projectId:string;onclose:()=>void}=$props();
 let input=$state<HTMLInputElement>();
 const st=$derived(preview.status);
 const direct=$derived(!!st?.direct);
 const working=$derived(['queued','running'].includes(st?.status||''));
 const byPowerPoint=$derived(st?.status==='ready'&&!!st.slides);
 const modes:[PreviewMode,string,string][]=[
  ['cached','原页图片（默认）','逐页绘制后缓存，翻页最快。'],
  ['pdf','PDF 原件','直接用 PDF 原件逐页显示。'],
 ];
 const time=(iso?:string)=>iso?new Date(iso).toLocaleString():'';
 const drawn=$derived(!st?'正在读取…':direct?'课件本身是 PDF，按原件绘制。'
  :working?'正在用 PowerPoint 绘制…'+(st.stage?' '+st.stage:'')
  :byPowerPoint?'由 PowerPoint 绘制'+(st.pages?' · '+st.pages+' 页':'')+(st.generated?' · '+time(st.generated):'')
  :st.status==='ready'?'按你关联的 PDF 绘制'+(st.pages?' · '+st.pages+' 页':'')+(st.engine&&st.engine!=='PowerPoint'?'（'+st.engine+'）':'')
  :'近似绘制（不是 PowerPoint）'+(st.status==='error'&&st.error?'：'+st.error:'。'));
</script>

<input class="hidden" type="file" accept=".pdf,application/pdf" bind:this={input} onchange={e=>{const el=e.currentTarget as HTMLInputElement;const f=el.files?.[0];el.value='';if(f)preview.associate(f);}}/>

<Modal title="原页预览" {onclose} busy={preview.busy} closeLabel="关闭">
 <section class="engine">
  <h3>原页绘制</h3>
  <p>{drawn}</p>
  {#if st?.warning}<p class="warn">{st.warning}</p>{/if}
  {#if !direct}
   <div class="row"><button class="btn" disabled={preview.busy||working} onclick={()=>preview.convert(true)}>用 PowerPoint 重新生成原页</button></div>
   <small>在后台用本机 PowerPoint 打开课件副本（只读、不显示窗口、不运行宏），逐页导出图片，与 PowerPoint 中显示一致。重新生成后，已生成的导读不会自动重做。</small>
  {/if}
 </section>

 {#if direct}
  <fieldset class="modes">
   <legend>显示方式</legend>
   {#each modes as [id,label,hint] (id)}
    <label>
     <input type="radio" name="preview-mode" checked={preview.mode===id} onchange={()=>preview.setMode(id)}/>
     <span><b>{label}</b><small>{hint}</small></span>
    </label>
   {/each}
  </fieldset>
 {:else if st&&!working&&!byPowerPoint}
  <section class="fallback">
   <h3>不能用 PowerPoint 时</h3>
   <p>可以在 PowerPoint 或 WPS 中把课件导出为 PDF（包含隐藏页，页数与课件一致），再关联到这里；原页就按这份 PDF 绘制。</p>
   <div class="row">
    <button class="btn" disabled={preview.busy} onclick={()=>input?.click()}>关联导出的 PDF…</button>
    {#if st.status==='ready'}<button class="btn btn-quiet" disabled={preview.busy} onclick={()=>preview.clear()}>取消关联</button>{/if}
   </div>
   {#if st.status==='ready'}<a href={api.previewFileUrl(projectId,preview.sourceId)} target="_blank" rel="noopener">打开关联的 PDF <Icon name="external" size={12}/></a>{/if}
  </section>
 {/if}

 {#if preview.error}<p class="error" role="alert">{preview.error}</p>{/if}
 {#snippet actions()}{#if direct}<button class="btn" onclick={()=>preview.redraw()} disabled={preview.busy}>重新加载原页</button>{/if}{/snippet}
</Modal>

<style>
 .hidden{display:none;}
 .engine{display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-4);}
 .engine p{margin:0;}
 .modes{margin:0 0 var(--space-4);padding:0;border:0;display:flex;flex-direction:column;gap:var(--space-2);}
 legend{font-weight:var(--weight-medium);margin-bottom:var(--space-2);}
 .modes label{display:flex;gap:var(--space-2);align-items:flex-start;cursor:pointer;}
 .modes span{display:flex;flex-direction:column;}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 h3{font-size:var(--text-sm);margin:0 0 var(--space-1);}
 .fallback{display:flex;flex-direction:column;gap:var(--space-2);padding-top:var(--space-3);border-top:1px solid var(--line);}
 .fallback p{margin:0;}
 .row{display:flex;flex-wrap:wrap;gap:var(--space-2);}
 a{color:var(--accent);font-size:var(--text-sm);display:inline-flex;align-items:center;gap:var(--space-1);}
 .warn{color:var(--status-stopped-fg);}
 .error{color:var(--status-failed-fg);margin:var(--space-2) 0 0;}
</style>
