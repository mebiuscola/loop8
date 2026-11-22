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
  ['cached','原页图片（默认）','由本地服务生成并缓存，速度快。'],
  ['pdf','PDF 预览','按 PDF 绘制：课件本身是 PDF 时直接使用；PPTX 需先转换或关联你导出的 PDF。'],
  ['browser','实时浏览器预览（核对）','在浏览器中直接绘制 PPTX，用来核对原页图片是否准确。较慢，仅限 PPTX。'],
 ];
 const statusText=$derived(!st?'正在读取…':st.status==='ready'?'已就绪'+(st.engine?' · '+st.engine:'')+(st.pages?' · '+st.pages+' 页':''):['queued','running'].includes(st.status)?'正在转换…'+(st.stage?' '+st.stage:''):st.status==='error'?'转换失败'+(st.error?'：'+st.error:''):'未生成');
</script>

<input class="hidden" type="file" accept=".pdf,application/pdf" bind:this={input} onchange={e=>{const el=e.currentTarget as HTMLInputElement;const f=el.files?.[0];el.value='';if(f)preview.associate(f);}}/>

<Modal title="原页预览" {onclose} busy={preview.busy} closeLabel="关闭">
 <fieldset class="modes">
  <legend>显示方式</legend>
  {#each modes as [id,label,hint] (id)}
   <label class:off={id==='browser'&&!preview.isPptx}>
    <input type="radio" name="preview-mode" checked={preview.mode===id} disabled={id==='browser'&&!preview.isPptx} onchange={()=>preview.setMode(id)}/>
    <span><b>{label}</b><small>{id==='browser'&&!preview.isPptx?'这份课件不是 PPTX。':hint}</small></span>
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
 .modes{margin:0 0 var(--space-4);padding:0;border:0;display:flex;flex-direction:column;gap:var(--space-2);}
 legend{font-weight:var(--weight-medium);margin-bottom:var(--space-2);}
 .modes label{display:flex;gap:var(--space-2);align-items:flex-start;cursor:pointer;}
 .modes label.off{opacity:.55;cursor:default;}
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
