<script lang="ts" module>
 export type PreviewMode='cached'|'pdf'|'browser';
</script>

<script lang="ts">
 // One original page, drawn only while near the view:
 //  cached  — the page image the server renders (default);
 //  pdf     — a page of the PDF preview (converted, linked, or the courseware itself);
 //  browser — the PPTX drawn live in the browser (/pptx-frame.html), for checking.
 import {onMount} from 'svelte';
 import {api,type CoursewareReader} from '../../lib/api';
 import {drawPage,type PdfDoc} from '../../lib/pdf';

 let {projectId,reader,pageIndex,mode,pdf,pptx,reload=0,large=false}:{
  projectId:string;reader:CoursewareReader;pageIndex:number;mode:PreviewMode;
  pdf?:Promise<PdfDoc>|null;pptx?:Promise<ArrayBuffer>|null;reload?:number;large?:boolean;
 }=$props();

 let host=$state<HTMLElement>();
 let near=$state(false),phase=$state<'loading'|'ready'|'error'>('loading'),note=$state('');
 let aspect=$state(16/9);
 const n=$derived(pageIndex+1);

 onMount(()=>{
  if(large){near=true;return;}
  const observer=new IntersectionObserver(([e])=>{near=e.isIntersecting;},{rootMargin:'600px 0px'});
  observer.observe(host!);
  return ()=>observer.disconnect();
 });

 // A new mode or a reload starts the page over.
 $effect.pre(()=>{mode;reload;phase='loading';note='';});

 // ---- PDF ----
 let canvas=$state<HTMLCanvasElement>();
 $effect(()=>{
  if(mode!=='pdf'||!near||!pdf||!canvas)return;
  reload;
  let cancel=()=>{},stopped=false;
  phase='loading';note='';
  pdf.then(doc=>{
   if(stopped)return;
   if(pageIndex>=doc.numPages){phase='error';note='PDF 预览没有这一页，请核对导出的 PDF 是否包含隐藏页。';return;}
   const task=drawPage(doc,pageIndex,canvas!,Math.max(200,host!.clientWidth));cancel=task.cancel;
   task.done.then(()=>{if(!stopped)phase='ready';},e=>{if(!stopped&&e?.name!=='RenderingCancelledException'){phase='error';note='PDF 页面绘制失败。';}});
  },e=>{if(!stopped){phase='error';note=(e as Error).message||'无法打开 PDF 预览。';}});
  return ()=>{stopped=true;cancel();};
 });

 // ---- live PPTX ----
 let frame=$state<HTMLIFrameElement>();
 let ticket='';
 $effect(()=>{
  if(mode!=='browser'||!near||!pptx||!frame)return;
  reload;
  const token=reader.sourceId+':'+pageIndex+':'+Date.now()+Math.random();ticket=token;
  phase='loading';note='正在绘制…';
  const target=frame;let stopped=false;
  const timer=setTimeout(()=>{if(!stopped&&phase==='loading'){phase='error';note='实时预览超时，可重新加载或改用其他预览方式。';}},45000);
  const listen=(event:MessageEvent)=>{
   if(event.origin!==location.origin||event.source!==target.contentWindow||event.data?.type!=='classroom-pptx'||event.data.ticket!==token)return;
   const r=event.data;
   if(r.stage&&phase==='loading')note=r.stage;
   if(r.ready){clearTimeout(timer);aspect=r.width/r.height||16/9;phase='ready';note=(r.hidden?'隐藏幻灯片':'')+(r.warnings?.length?(r.hidden?' · ':'')+r.warnings.join('；'):'');}
   if(r.error){clearTimeout(timer);phase='error';note='实时预览失败：'+r.error;}
  };
  addEventListener('message',listen);
  const open=()=>pptx.then(buffer=>{if(!stopped)target.contentWindow?.postMessage({type:'classroom-reader',action:'open',ticket:token,url:api.previewSourceUrl(projectId,reader.sourceId),hash:reader.sourceHash,pageIndex,buffer},location.origin);},e=>{phase='error';note=(e as Error).message;});
  target.addEventListener('load',open,{once:true});
  target.src='/pptx-frame.html';
  return ()=>{stopped=true;clearTimeout(timer);removeEventListener('message',listen);target.removeEventListener('load',open);target.src='about:blank';};
 });

 let imageUrl=$derived(api.pageImageUrl(projectId,reader.sourceId,pageIndex,reader.sourceHash)+(reload?'&r='+reload:''));
</script>

<div class="original" class:large bind:this={host} style:--aspect={aspect}>
 {#if mode==='cached'}
  <figure class="slide" class:ready={phase==='ready'}>
   <img src={imageUrl} alt={'课件原页 第 '+n+' 页'} loading={large?'eager':'lazy'} decoding="async" onload={()=>phase='ready'} onerror={()=>{phase='error';note='原页预览读取失败。可在"⋯ › 原页预览"中改用其他方式。';}}/>
   {#if phase!=='ready'}<figcaption>{phase==='error'?note:'正在加载原页…'}</figcaption>{/if}
  </figure>
 {:else if mode==='pdf'}
  <figure class="slide" class:ready={phase==='ready'}>
   {#if near}<canvas bind:this={canvas} aria-label={'PDF 预览 第 '+n+' 页'}></canvas>{/if}
   {#if !pdf}<figcaption>PDF 预览尚未就绪。可在"⋯ › 原页预览"中转换，或关联从课件导出的 PDF。</figcaption>
   {:else if phase!=='ready'}<figcaption>{phase==='error'?note:'正在绘制 PDF 页面…'}</figcaption>{/if}
  </figure>
 {:else}
  <figure class="slide live" class:ready={phase==='ready'}>
   {#if near}<iframe bind:this={frame} title={'课件原始页面 · 第 '+n+' 页'} sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe>{/if}
   {#if phase!=='ready'}<figcaption>{phase==='error'?note:note||'滚动到这一页时绘制'}</figcaption>{/if}
  </figure>
  {#if phase==='ready'&&note}<p class="warn">{note}</p>{/if}
 {/if}
</div>

<style>
 .original{position:relative;}
 .slide{position:relative;margin:0;aspect-ratio:16/9;background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden;display:grid;place-items:center;}
 .slide.ready{aspect-ratio:auto;display:block;}
 .slide.live{aspect-ratio:var(--aspect);}
 img,canvas{display:block;width:100%;height:auto;}
 .slide:not(.ready) img,.slide:not(.ready) canvas{position:absolute;width:1px;height:1px;opacity:0;}
 iframe{display:block;width:100%;height:100%;border:0;background:var(--white);}
 .slide.live:not(.ready) iframe{position:absolute;inset:0;opacity:0;}
 figcaption{padding:var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);text-align:center;}
 .warn{margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--status-stopped-fg);}
</style>
