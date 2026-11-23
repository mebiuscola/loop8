<script lang="ts">
 import {onMount} from 'svelte';
 import OriginalPage,{type PreviewMode} from './OriginalPage.svelte';
 import type {CoursewareReader,ReaderPage} from '../../lib/api';
 import type {PdfDoc} from '../../lib/pdf';
 import {boldParts} from '../../lib/reading';

 let {projectId,reader,columns,jump,onpage,mode='cached',pdf=null,pptx=null,reload=0,onenlarge,pageCount=0,oncheck}:{projectId:string;reader:CoursewareReader;columns:{original:boolean;translation:boolean;notes:boolean};jump:{page:number;seq:number};onpage:(n:number)=>void;
  /** Marks a parse hint of a page as checked against the original (or undoes it). */
  oncheck?:(page:number,hint:string,checked:boolean)=>Promise<void>;
  mode?:PreviewMode;pdf?:Promise<PdfDoc>|null;pptx?:Promise<ArrayBuffer>|null;reload?:number;onenlarge?:(pageIndex:number)=>void;
  /** Pages in the original file; before any parsing the original pages are still shown. */
  pageCount?:number}=$props();

 const parsed=$derived(!!reader.pages.length);
 const rows=$derived.by(():(ReaderPage&{unparsed?:boolean})[]=>{
  const total=Math.max(reader.pages.length,reader.nativePageCount||0,pageCount||0);
  return Array.from({length:total},(_,i)=>reader.pages.find(x=>x.pageIndex===i)||{sourceId:reader.sourceId,pageIndex:i,paragraphs:[],closeReading:'',unparsed:true});
 });

 let scroller:HTMLElement;
 const shown=$derived([columns.original&&'original',columns.translation&&'translation',columns.notes&&'notes'].filter(Boolean) as string[]);
 const template=$derived(shown.map(c=>c==='original'?'minmax(280px,1.15fr)':c==='translation'?'minmax(260px,1fr)':'minmax(220px,.85fr)').join(' ')||'1fr');


 // Report the page at the top of the view.
 // Scroll position right after our own jump to a chosen page. While the view is still there,
 // the chosen page stays shown (the last pages may not reach the top); any scrolling by the
 // reader, however soon after the jump, updates it.
 let jumpTop=-1;
 onMount(()=>{
  const visible=new Map<number,number>();
  const observer=new IntersectionObserver(entries=>{
   for(const e of entries){const n=Number((e.target as HTMLElement).dataset.page);if(e.isIntersecting)visible.set(n,e.boundingClientRect.top);else visible.delete(n);}
   if(!visible.size||Math.abs(scroller.scrollTop-jumpTop)<2)return;
   onpage(Math.min(...visible.keys()));
  },{root:scroller,rootMargin:'-40px 0px -60% 0px'});
  scroller.querySelectorAll('section[data-page]').forEach(s=>observer.observe(s));
  return ()=>observer.disconnect();
 });

 $effect(()=>{
  const {page}=jump;
  const target=scroller?.querySelector<HTMLElement>(`section[data-page="${page}"]`);
  if(!target)return;
  const header=scroller.querySelector<HTMLElement>('.colhead')?.offsetHeight||0;
  scroller.scrollTo({top:page===1?0:target.offsetTop-header});
  jumpTop=scroller.scrollTop;
 });

 // Hints are doubts from parsing; they do not mean the page is unfinished. Checked ones fold away.
 let busyHint=$state('');
 async function check(page:number,hint:string,checked:boolean){
  if(!oncheck)return;busyHint=page+'|'+hint;
  try{await oncheck(page,hint,checked);}finally{busyHint='';}
 }
 const pageTypeLabel:Record<string,string>={cover:'封面',agenda:'目录',section:'章节页',content:'',quote:'引文',image:'图片',ending:'结尾'};
</script>

<div class="scroller" bind:this={scroller}>
 <div class="colhead" style:grid-template-columns={template}>
  {#if columns.original}<span class="kind original">原页</span>{/if}
  {#if columns.translation}<span class="kind translation">双语译文</span>{/if}
  {#if columns.notes}<span class="kind notes">细读 · AI 分析</span>{/if}
 </div>

 {#if !rows.length}
  <p class="empty">这份课件还没有可读的页面。请先在"概览"中为它生成导读。</p>
 {:else if !parsed}
  <p class="empty">还没有生成导读，下面只显示原页。可点右上角按钮生成。</p>
 {/if}

 {#each rows as p (p.pageIndex)}
  {@const n=p.pageIndex+1}
  <section data-page={n} aria-label={'第 '+n+' 页'}>
   <header class="pagehead">第 {n} 页{#if p.pageType&&pageTypeLabel[p.pageType]} · {pageTypeLabel[p.pageType]}{/if}
    {#if columns.original&&onenlarge}<button class="enlarge" type="button" onclick={()=>onenlarge(p.pageIndex)} title="放大原页">放大</button>{/if}</header>
   <div class="row" style:grid-template-columns={template}>
    {#if columns.original}
     <div class="col">
      <!-- The original page stays in view while its translation scrolls (UI issue 28); placeholder while loading (issue 27). -->
      <div class="sticky"><OriginalPage {projectId} {reader} pageIndex={p.pageIndex} {mode} {pdf} {pptx} {reload}/></div>
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
       <p class="missing">{p.unparsed?'尚未生成导读':'本页没有可翻译的文字。'}</p>
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
   {#if p.hints?.length}
    {@const open=p.hints.filter(h=>!h.checked)}
    <details class="hints" class:done={!open.length}>
     <summary>{open.length?'解析提示 '+open.length+' 条 · 可对照原页核对':'解析提示已全部核对（'+p.hints.length+' 条）'}</summary>
     <ul>
      {#each p.hints as h (h.text)}
       <li class:checked={h.checked}>
        <span>{h.text}</span>
        {#if oncheck}<button type="button" class="btn btn-quiet" disabled={busyHint===n+'|'+h.text} onclick={()=>check(n,h.text,!h.checked)}>{h.checked?'撤销':'已核对'}</button>{/if}
       </li>
      {/each}
     </ul>
    </details>
   {/if}
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
 .sticky{position:sticky;top:44px;}
 .enlarge{margin-left:auto;padding:0 var(--space-2);height:24px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg-raised);font-size:var(--text-xs);color:var(--fg-muted);}
 .enlarge:hover{color:var(--fg);border-color:var(--line-strong);}
 .para{padding:0 0 var(--space-3) var(--space-3);border-left:2px solid var(--kind-translation);margin-bottom:var(--space-3);}
 .en{margin:0 0 var(--space-1);font-family:var(--font-reading);font-size:var(--text-md);color:var(--ink-700);}
 .zh{margin:0;font-size:var(--text-md);}
 .notes{margin:0;padding-left:var(--space-3);border-left:2px solid var(--kind-analysis);white-space:pre-wrap;font-size:var(--text-sm);line-height:1.7;}
 .missing{margin:0;font-size:var(--text-sm);color:var(--fg-subtle);}
 .empty{padding:var(--space-5) 0;color:var(--fg-muted);}
 .hints{margin-top:var(--space-2);font-size:var(--text-xs);color:var(--status-stopped-fg);}
 .hints.done{color:var(--fg-subtle);}
 .hints summary{cursor:pointer;width:max-content;}
 .hints ul{list-style:none;margin:var(--space-1) 0 0;padding:0;display:flex;flex-direction:column;gap:var(--space-1);}
 .hints li{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm);background:var(--bg-raised);color:var(--fg-muted);}
 .hints li.checked span{text-decoration:line-through;color:var(--fg-subtle);}
 .hints li .btn{flex:none;height:24px;padding:0 var(--space-2);font-size:var(--text-xs);}
</style>
