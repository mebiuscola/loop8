<script lang="ts">
 import {onMount} from 'svelte';
 import {api,type CoursewareReader} from '../../lib/api';
 import {boldParts} from '../../lib/reading';

 let {projectId,reader,columns,jump,onpage}:{projectId:string;reader:CoursewareReader;columns:{original:boolean;translation:boolean;notes:boolean};jump:{page:number;seq:number};onpage:(n:number)=>void}=$props();

 let scroller:HTMLElement;
 const shown=$derived([columns.original&&'original',columns.translation&&'translation',columns.notes&&'notes'].filter(Boolean) as string[]);
 const template=$derived(shown.map(c=>c==='original'?'minmax(280px,1.15fr)':c==='translation'?'minmax(260px,1fr)':'minmax(220px,.85fr)').join(' ')||'1fr');

 // Images: loaded once each, with a visible placeholder until then (UI issue 27).
 let imageState=$state<Record<number,'loading'|'ready'|'error'>>({});

 // Report the page at the top of the view; ignore our own scrolling for a moment after a jump.
 let quietUntil=0;
 onMount(()=>{
  const visible=new Map<number,number>();
  const observer=new IntersectionObserver(entries=>{
   for(const e of entries){const n=Number((e.target as HTMLElement).dataset.page);if(e.isIntersecting)visible.set(n,e.boundingClientRect.top);else visible.delete(n);}
   if(Date.now()<quietUntil||!visible.size)return;
   onpage(Math.min(...visible.keys()));
  },{root:scroller,rootMargin:'-40px 0px -60% 0px'});
  scroller.querySelectorAll('section[data-page]').forEach(s=>observer.observe(s));
  return ()=>observer.disconnect();
 });

 $effect(()=>{
  const {page}=jump;
  const target=scroller?.querySelector<HTMLElement>(`section[data-page="${page}"]`);
  if(!target)return;
  quietUntil=Date.now()+600;
  const header=scroller.querySelector<HTMLElement>('.colhead')?.offsetHeight||0;
  scroller.scrollTo({top:page===1?0:target.offsetTop-header});
 });

 const pageTypeLabel:Record<string,string>={cover:'封面',agenda:'目录',section:'章节页',content:'',quote:'引文',image:'图片',ending:'结尾'};
</script>

<div class="scroller" bind:this={scroller}>
 <div class="colhead" style:grid-template-columns={template}>
  {#if columns.original}<span class="kind original">原页</span>{/if}
  {#if columns.translation}<span class="kind translation">双语译文</span>{/if}
  {#if columns.notes}<span class="kind notes">细读 · AI 分析</span>{/if}
 </div>

 {#if !reader.pages.length}
  <p class="empty">这份课件还没有可读的页面。请先在"概览"中为它生成导读。</p>
 {/if}

 {#each reader.pages as p (p.pageIndex)}
  {@const n=p.pageIndex+1}
  <section data-page={n} aria-label={'第 '+n+' 页'}>
   <header class="pagehead">第 {n} 页{#if p.pageType&&pageTypeLabel[p.pageType]} · {pageTypeLabel[p.pageType]}{/if}</header>
   <div class="row" style:grid-template-columns={template}>
    {#if columns.original}
     <div class="col">
      <figure class="slide" class:ready={imageState[n]==='ready'}>
       <img src={api.pageImageUrl(projectId,reader.sourceId,p.pageIndex,reader.sourceHash)} alt={'课件原页 第 '+n+' 页'} loading="lazy" decoding="async"
        onload={()=>imageState[n]='ready'} onerror={()=>imageState[n]='error'}/>
       {#if imageState[n]!=='ready'}
        <figcaption>{imageState[n]==='error'?'原页预览读取失败。可在"⋯ › 高级"中改用其他预览方式。':'正在加载原页…'}</figcaption>
       {/if}
      </figure>
     </div>
    {/if}
    {#if columns.translation}
     <div class="col translation-col">
      {#each p.paragraphs as para, i (i)}
       <div class="para">
        <p class="en" lang="en">{para.english}</p>
        {#if para.chinese}<p class="zh" lang="zh-CN">{para.chinese}</p>{:else}<p class="missing">尚未翻译</p>{/if}
       </div>
      {:else}
       <p class="missing">本页没有可翻译的文字。</p>
      {/each}
     </div>
    {/if}
    {#if columns.notes}
     <div class="col notes-col">
      {#if p.closeReading}
       <p class="notes">{#each boldParts(p.closeReading) as part, i (i)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}</p>
      {:else}
       <p class="missing">尚未生成细读。</p>
      {/if}
     </div>
    {/if}
   </div>
  </section>
 {/each}
</div>

<style>
 .scroller{position:absolute;inset:0;overflow:auto;padding:0 var(--space-4) var(--space-6);}
 .colhead{position:sticky;top:0;z-index:2;display:grid;gap:var(--space-4);padding:var(--space-2) 0;background:var(--bg-app);border-bottom:1px solid var(--line);}
 .kind{font-size:var(--text-xs);font-weight:var(--weight-medium);}
 .kind.original{color:var(--kind-original);}
 .kind.translation{color:var(--kind-translation);}
 .kind.notes{color:var(--kind-analysis);}
 section{padding:var(--space-3) 0 var(--space-4);border-bottom:1px solid var(--line);}
 .pagehead{display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--fg-muted);}
 .row{display:grid;gap:var(--space-4);align-items:start;}
 .col{min-width:0;}
 /* The original page stays in view while its translation scrolls (UI issue 28). */
 .slide{position:sticky;top:44px;margin:0;aspect-ratio:16/9;background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden;display:grid;place-items:center;}
 .slide.ready{aspect-ratio:auto;}
 .slide img{display:block;width:100%;height:auto;opacity:0;}
 .slide.ready img{opacity:1;}
 .slide:not(.ready) img{position:absolute;width:1px;height:1px;}
 figcaption{padding:var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);text-align:center;}
 .para{padding:0 0 var(--space-3) var(--space-3);border-left:2px solid var(--kind-translation);margin-bottom:var(--space-3);}
 .en{margin:0 0 var(--space-1);font-family:var(--font-reading);font-size:var(--text-md);color:var(--ink-700);}
 .zh{margin:0;font-size:var(--text-md);}
 .notes{margin:0;padding-left:var(--space-3);border-left:2px solid var(--kind-analysis);white-space:pre-wrap;font-size:var(--text-sm);line-height:1.7;}
 .missing{margin:0;font-size:var(--text-sm);color:var(--fg-subtle);}
 .empty{padding:var(--space-5) 0;color:var(--fg-muted);}
</style>
