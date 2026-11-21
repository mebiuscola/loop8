<script lang="ts">
 import {onMount} from 'svelte';
 import {api,type ReferenceReader,type ReferenceParagraph} from '../../lib/api';
 import {openPdf,drawPage,type PdfDoc} from '../../lib/pdf';

 let {projectId,reader,columns,jump,onpage,onpages}:{projectId:string;reader:ReferenceReader;columns:{original:boolean;translation:boolean};jump:{page:number;seq:number};onpage:(n:number)=>void;onpages:(n:number)=>void}=$props();

 let scroller:HTMLElement;
 let doc=$state<PdfDoc|null>(null),pdfError=$state('');

 // Paragraphs grouped by PDF page; those without a page go last.
 const groups=$derived.by(()=>{
  const byPage=new Map<number,ReferenceParagraph[]>(),loose:ReferenceParagraph[]=[];
  for(const p of reader.paragraphs){if(p.pageIndex===null||p.pageIndex===undefined)loose.push(p);else{const l=byPage.get(p.pageIndex)||[];l.push(p);byPage.set(p.pageIndex,l);}}
  const lastIndex=Math.max(-1,...byPage.keys());
  const count=Math.max(doc?.numPages||0,lastIndex+1);
  return {pages:Array.from({length:count},(_,i)=>({index:i,paragraphs:byPage.get(i)||[]})),loose};
 });
 $effect(()=>{onpages(groups.pages.length);});

 const shown=$derived([columns.original&&reader.pdf,columns.translation].filter(Boolean).length);
 const template=$derived(columns.original&&reader.pdf&&columns.translation?'minmax(320px,1fr) minmax(320px,1fr)':'1fr');

 // Draw each PDF page when it comes near the view.
 const drawn=new Map<number,{cancel:()=>void}>();
 let drawState=$state<Record<number,'ready'|'error'>>({});
 let cancelPdf:()=>void=()=>{};
 onMount(()=>{
  let alive=true;
  if(reader.pdf)openPdf(api.referenceFileUrl(projectId,reader.sourceId)).then(r=>{if(!alive){r.cancel();return;}doc=r.doc;cancelPdf=r.cancel;}).catch(e=>{pdfError='原始 PDF 无法打开：'+(e?.message||e);});
  return ()=>{alive=false;drawn.forEach(d=>d.cancel());cancelPdf();};
 });

 function draw(canvas:HTMLCanvasElement,index:number){
  const observer=new IntersectionObserver(entries=>{
   if(!entries.some(e=>e.isIntersecting)||!doc||drawn.has(index))return;
   const width=canvas.parentElement!.clientWidth;
   const job=drawPage(doc,index,canvas,width);drawn.set(index,job);
   job.done.then(()=>drawState[index]='ready').catch(()=>drawState[index]='error');
  },{root:scroller,rootMargin:'600px 0px'});
  observer.observe(canvas);
  return {destroy(){observer.disconnect();}};
 }

 let quietUntil=0;
 onMount(()=>{
  const visible=new Set<number>();
  const observer=new IntersectionObserver(entries=>{
   for(const e of entries){const n=Number((e.target as HTMLElement).dataset.page);if(e.isIntersecting)visible.add(n);else visible.delete(n);}
   if(Date.now()<quietUntil||!visible.size)return;
   onpage(Math.min(...visible));
  },{root:scroller,rootMargin:'-40px 0px -60% 0px'});
  const watch=()=>scroller.querySelectorAll('section[data-page]').forEach(s=>observer.observe(s));
  watch();
  const mo=new MutationObserver(watch);mo.observe(scroller,{childList:true});
  return ()=>{observer.disconnect();mo.disconnect();};
 });

 $effect(()=>{
  const {page}=jump;groups.pages.length;
  const target=scroller?.querySelector<HTMLElement>(`section[data-page="${page}"]`);
  if(!target)return;
  quietUntil=Date.now()+600;
  const header=scroller.querySelector<HTMLElement>('.colhead')?.offsetHeight||0;
  scroller.scrollTo({top:page===1?0:target.offsetTop-header});
 });
</script>

<div class="scroller" bind:this={scroller}>
 <div class="colhead" style:grid-template-columns={template}>
  {#if columns.original&&reader.pdf}<span class="kind original">原页</span>{/if}
  {#if columns.translation}<span class="kind translation">双语译文</span>{/if}
 </div>
 {#if pdfError}<p class="warn">{pdfError}</p>{/if}
 {#if !reader.pdf&&columns.original}<p class="warn">这份参考文献没有可显示的原始 PDF，只显示文字。</p>{/if}
 {#if !shown}<p class="empty">请在上方至少勾选一栏。</p>{/if}

 {#each groups.pages as g (g.index)}
  {@const n=g.index+1}
  {@const printed=g.paragraphs.find(p=>p.printedPage)?.printedPage}
  <section data-page={n} aria-label={'PDF 第 '+n+' 页'}>
   <header class="pagehead">PDF 第 {n} 页{#if printed} · 印刷页 {printed}{/if}</header>
   <div class="row" style:grid-template-columns={template}>
    {#if columns.original&&reader.pdf}
     <div class="col">
      <div class="pdfpage" class:ready={drawState[g.index]==='ready'}>
       {#if doc}<canvas use:draw={g.index} aria-label={'原页 PDF 第 '+n+' 页'}></canvas>{/if}
       {#if drawState[g.index]!=='ready'}<span class="placeholder">{drawState[g.index]==='error'?'这一页无法绘制。':'正在加载原页…'}</span>{/if}
      </div>
     </div>
    {/if}
    {#if columns.translation}
     <div class="col">
      {#each g.paragraphs as para (para.key)}
       <div class="para {para.kind}">
        <p class="en" lang="en">{para.english}</p>
        {#if para.chinese}<p class="zh" lang="zh-CN">{para.chinese}</p>
        {:else if para.status==='blocked'}<p class="blocked">模型过滤 · 待补译</p>
        {:else}<p class="missing">尚未翻译</p>{/if}
       </div>
      {:else}
       <p class="missing">本页没有解析出正文。</p>
      {/each}
     </div>
    {/if}
   </div>
  </section>
 {/each}

 {#if groups.loose.length&&columns.translation}
  <section>
   <header class="pagehead">页码未提供</header>
   {#each groups.loose as para (para.key)}
    <div class="para"><p class="en" lang="en">{para.english}</p>{#if para.chinese}<p class="zh">{para.chinese}</p>{:else}<p class="missing">尚未翻译</p>{/if}</div>
   {/each}
  </section>
 {/if}
</div>

<style>
 .scroller{position:absolute;inset:0;overflow:auto;padding:0 var(--space-4) var(--space-6);}
 .colhead{position:sticky;top:0;z-index:2;display:grid;gap:var(--space-4);padding:var(--space-2) 0;background:var(--bg-app);border-bottom:1px solid var(--line);}
 .kind{font-size:var(--text-xs);font-weight:var(--weight-medium);}
 .kind.original{color:var(--kind-original);}
 .kind.translation{color:var(--kind-translation);}
 section{padding:var(--space-3) 0 var(--space-4);border-bottom:1px solid var(--line);}
 .pagehead{margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--fg-muted);}
 .row{display:grid;gap:var(--space-4);align-items:start;}
 .col{min-width:0;}
 .pdfpage{position:sticky;top:44px;min-height:240px;background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden;display:grid;place-items:center;}
 .pdfpage.ready{min-height:0;}
 canvas{display:block;max-width:100%;}
 .placeholder{position:absolute;font-size:var(--text-xs);color:var(--fg-muted);}
 .para{padding:0 0 var(--space-3) var(--space-3);border-left:2px solid var(--kind-translation);margin-bottom:var(--space-3);}
 .para.title,.para.heading{font-weight:var(--weight-bold);}
 .en{margin:0 0 var(--space-1);font-family:var(--font-reading);font-size:var(--text-md);color:var(--ink-700);}
 .zh{margin:0;font-size:var(--text-md);}
 .missing{margin:0;font-size:var(--text-sm);color:var(--fg-subtle);}
 .blocked{margin:0;font-size:var(--text-sm);color:var(--status-stopped-fg);}
 .warn{margin:var(--space-3) 0;font-size:var(--text-sm);color:var(--status-stopped-fg);}
 .empty{padding:var(--space-5) 0;color:var(--fg-muted);}
</style>
