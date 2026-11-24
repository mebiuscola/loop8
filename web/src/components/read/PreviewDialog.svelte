<script lang="ts">
 // How original pages are drawn for one courseware file, and its PDF preview.
 import Modal from '../Modal.svelte';
 import Icon from '../Icon.svelte';
 import {api} from '../../lib/api';
 import type {CoursePreview} from '../../lib/preview.svelte';
 import type {PreviewMode} from './OriginalPage.svelte';

 let {preview,projectId,onclose}:{preview:CoursePreview;projectId:string;onclose:()=>void}=$props();
 let input=$state<HTMLInputElement>();
 const st=$derived(preview.status);
 const direct=$derived(!!st?.direct);
 const modes:[PreviewMode,string,string][]=[
  ['cached','原页图片（默认）','由 PowerPoint 逐页绘制并缓存（与 PowerPoint 中显示一致）；不能用 PowerPoint 时为近似绘制。'],
  ['pdf','PDF 预览','按 PDF 绘制：课件本身是 PDF 时直接使用；PPTX 需先转换或关联你导出的 PDF。'],
 ];
 // Who drew the slide images (PowerPoint, a PDF, or the built-in approximation).
 const deck=$derived(/.pptx?$/i.test(preview.fileName));
 const drawn=$derived(!st?'正在读取…':direct?'课件本身是 PDF，按原件绘制。':['queued','running'].includes(st.status)?'正在用 PowerPoint 绘制…':st.status==='ready'&&st.slides?'由 PowerPoint 绘制'+(st.generated?'（'+new Date(st.generated).toLocaleString()+'）':'')+'，与 PowerPoint 中显示一致。':st.status==='ready'?'按 PDF 绘制（'+(st.engine||'PDF')+'）。':'近似绘制（非 PowerPoint）'+(st.status==='error'&&st.error?'：'+st.error:'。'));
 const statusText=$derived(!st?'正在读取…':st.status==='ready'?'已就绪'+(st.engine?' · '+st.engine:'')+(st.pages?' · '+st.pages+' 页':''):['queued','running'].includes(st.status)?'正在转换…'+(st.stage?' '+st.stage:''):st.status==='error'?'转换失败'+(st.error?'：'+st.error:''):'未生成');
</script>

<input class="hidden" type="file" accept=".pdf,application/pdf" bind:this={input} onchange={e=>{const el=e.currentTarget as HTMLInputElement;const f=el.files?.[0];el.value='';if(f)preview.associate(f);}}/>

<Modal title="原页预览" {onclose} busy={preview.busy} closeLabel="关闭">
 <section class="engine">
  <h3>原页绘制</h3>
  <p>{drawn}</p>
  {#if deck&&!direct}
   <div class="row"><button class="btn" disabled={preview.busy||['queued','running'].includes(st?.status||'')} onclick={()=>preview.convert(true)}>用 PowerPoint 重新生成原页</button></div>
   <small>在后台用本机 PowerPoint 打开课件副本（只读、不显示窗口、不运行宏），逐页导出图片；完成后替换原页，已生成的导读不会自动重做。</small>
  {/if}
 </section>
 <fieldset class="modes">
  <legend>显示方式</legend>
  {#each modes as [id,label,hint] (id)}
   <label>
    <input type="radio" name="preview-mode" checked={preview.mode===id} onchange={()=>preview.setMode(id)}/>
    <span><b>{label}</b><small>{hint}</small></span>
   </label>
  {/each}
 </fieldset>

 <section class="pdf">
  <h3>PDF 预览</h3>
  <p>状态：{direct?'课件本身是 PDF，直接使用原件':statusText}</p>
  {#if st?.warning}<p class="warn">{st.warning}</p>{/if}
  {#if !direct}
   <div class="row">
    {#if st&&st.status!=='ready'&&!['queued','running'].includes(st.status)}
     <button class="btn" disabled={preview.busy} onclick={()=>preview.convert(st?.status==='error')}>{st?.status==='error'?'重新转换':'转换为 PDF'}</button>
    {/if}
    <button class="btn" disabled={preview.busy||['queued','running'].includes(st?.status||'')} onclick={()=>input?.click()}>关联导出的 PDF…</button>
    {#if st?.status==='ready'}<button class="btn btn-quiet" disabled={preview.busy} onclick={()=>preview.clear()}>清除 PDF 预览</button>{/if}
   </div>
   <small>转换使用"设置 › 原页预览"中选择的方式。关联的 PDF 须包含隐藏页，页数要和课件一致。</small>
  {/if}
  {#if st?.status==='ready'}<a href={api.previewFileUrl(projectId,preview.sourceId)} target="_blank" rel="noopener">打开预览 PDF <Icon name="external" size={12}/></a>{/if}
 </section>

 {#if preview.error}<p class="error" role="alert">{preview.error}</p>{/if}
 {#snippet actions()}<button class="btn" onclick={()=>preview.redraw()} disabled={preview.busy}>重新加载原页</button>{/snippet}
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
 .pdf{display:flex;flex-direction:column;gap:var(--space-2);padding-top:var(--space-3);border-top:1px solid var(--line);}
 .pdf p{margin:0;}
 .row{display:flex;flex-wrap:wrap;gap:var(--space-2);}
 a{color:var(--accent);font-size:var(--text-sm);display:inline-flex;align-items:center;gap:var(--space-1);}
 .warn{color:var(--status-stopped-fg);}
 .error{color:var(--status-failed-fg);margin:var(--space-2) 0 0;}
</style>
