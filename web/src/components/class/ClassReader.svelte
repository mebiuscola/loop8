<script lang="ts">
 // One class's transcript: English speech with the Chinese alongside, a table of
 // contents, and the recording on its own row below (never covering the text).
 import {onMount,untrack} from 'svelte';
 import {api,ApiError,type Project,type Transcript} from '../../lib/api';
 import {chapterStarts,clock,speakerLabel} from '../../lib/classroom';

 type Ready=Extract<Transcript,{available:true}>;
 let {projectId,sessionId,data,jump,onparagraph,onproject,onupload}:{
  projectId:string;sessionId:string;data:Ready;
  jump:{index:number;seq:number;flash?:boolean};
  onparagraph:(index:number)=>void;
  onproject:(p:Project)=>void;
  onupload:()=>void;
 }=$props();

 const paragraphs=$derived(data.paragraphs);
 const chapters=$derived(chapterStarts(paragraphs));
 const toc=$derived([...chapters.entries()].map(([index,title])=>({index,title,startMs:paragraphs[index].startMs})));
 const issues=$derived(new Map((data.contentAudit||[]).map(a=>[a.segmentIndex,a.issues])));
 const audio=$derived(data.audio);
 const playable=$derived(!!audio?.matched);
 const offset=$derived((audio?.offsetMs||0)/1000);

 let scroller:HTMLElement;
 let player=$state<HTMLAudioElement>();
 let active=$state(-1),visible=$state(0),follow=$state(true),playing=$state(false),stopAt:number|null=null;
 let message=$state(''),autoScrollUntil=0;

 // ---- playback position, speed and "follow" are remembered per class ----
 const POS_KEY='classroom.next.playback';
 const posKey=$derived(projectId+'/'+sessionId);
 type Saved={time:number;rate:number;follow:boolean};
 const readAll=():Record<string,Saved>=>{try{return JSON.parse(localStorage.getItem(POS_KEY)||'{}');}catch{return {};}};
 function savePosition(){
  if(!player)return;
  const all=readAll();all[posKey]={time:player.currentTime,rate:player.playbackRate,follow};
  try{localStorage.setItem(POS_KEY,JSON.stringify(all));}catch{/* private mode */}
 }
 let rate=$state(1);
 onMount(()=>{
  const saved=readAll()[untrack(()=>posKey)];
  if(saved){rate=saved.rate||1;follow=saved.follow??true;}
  return ()=>savePosition();
 });
 function onLoaded(){
  if(!player)return;
  player.playbackRate=rate;
  const saved=readAll()[posKey];
  if(saved&&Number.isFinite(saved.time))player.currentTime=Math.min(player.duration||Infinity,saved.time);
  const end=paragraphs.at(-1)!.endMs/1000+offset;
  message=Number.isFinite(player.duration)&&end>player.duration+3?'字幕末段超出录音长度，请核对文件或校准时间。':'';
 }
 let lastSave=0;
 function onTime(){
  if(!player)return;
  if(stopAt!==null&&player.currentTime>=stopAt){player.pause();stopAt=null;}
  if(Date.now()-lastSave>5000){lastSave=Date.now();savePosition();}
  if(!playable)return;
  const ms=(player.currentTime-offset)*1000;let index=-1;
  for(let i=paragraphs.length-1;i>=0;i--){const p=paragraphs[i];if(ms>=p.startMs&&ms<p.endMs){index=i;break;}}
  if(index===active)return;
  active=index;
  if(follow&&index>=0&&!player.paused)scrollTo(index,true);
 }

 // ---- scrolling ----
 function scrollTo(index:number,smooth=false){
  const el=scroller?.querySelector<HTMLElement>('[data-p="'+index+'"]');if(!el)return;
  autoScrollUntil=Date.now()+1200;
  el.scrollIntoView({behavior:smooth?'smooth':'auto',block:smooth?'center':'start'});
 }
 // User scrolling stops following the recording; "回到当前段" turns it back on.
 function userScroll(){if(Date.now()>autoScrollUntil&&follow&&playing)follow=false;}
 function onScroll(){
  if(!scroller)return;
  const top=scroller.getBoundingClientRect().top+8;
  const items=scroller.querySelectorAll<HTMLElement>('[data-p]');
  let index=0;for(const el of items){if(el.getBoundingClientRect().bottom>top){index=Number(el.dataset.p);break;}}
  if(index!==visible){visible=index;onparagraph(index);}
 }
 // Opening a class (or the URL) asks for a paragraph.
 let lastJump=-1;
 // The first paragraph means the top, so the legend and first heading stay visible.
 // (setTimeout, not requestAnimationFrame: rAF does not run in a background window.)
 let flash=$state(-1);
 $effect(()=>{const j=jump;if(j.seq===lastJump)return;lastJump=j.seq;setTimeout(()=>{
  const i=Math.min(j.index,paragraphs.length-1);
  if(j.flash){scrollTo(i);flash=i;setTimeout(()=>{if(flash===i)flash=-1;},3000);}
  else if(i<=0){autoScrollUntil=Date.now()+600;scroller?.scrollTo({top:0});}else scrollTo(i);
 },30);});

 // ---- controls ----
 async function seek(index:number,only=false){
  if(!player||!playable)return;
  const p=paragraphs[index],t=p.startMs/1000+offset;
  if(t<0||Number.isFinite(player.duration)&&t>=player.duration){message='该段时间超出录音范围，请检查录音与字幕，或校准时间。';return;}
  stopAt=only?p.endMs/1000+offset:null;
  player.currentTime=t;follow=true;
  try{await player.play();}catch{message='无法播放这份录音。请检查格式，或点击播放器的播放按钮。';}
 }
 const nudge=(s:number)=>{if(!player)return;stopAt=null;player.currentTime=Math.max(0,Math.min(Number.isFinite(player.duration)?player.duration:Infinity,player.currentTime+s));};
 function backToCurrent(){follow=true;if(active>=0)scrollTo(active,true);}
 $effect(()=>{if(player)player.playbackRate=rate;});

 // ---- alignment with the subtitles ----
 let offsetInput=$state(untrack(()=>String((data.audio?.offsetMs||0)/1000)));
 let binding=$state(false),calibrate=$state(false);
 async function bind(change:{offsetMs:number}|{bindCurrent:true}){
  binding=true;message='';
  try{onproject(await api.audioBinding(projectId,sessionId,change));message='录音时间关联已保存。';calibrate=false;}
  catch(e){message=e instanceof ApiError?e.message:String(e);}
  finally{binding=false;}
 }
 function saveOffset(){const n=Number(offsetInput);if(!Number.isFinite(n)||Math.abs(n)>86400){message='偏移应在正负 86400 秒以内。';return;}bind({offsetMs:Math.round(n*1000)});}
</script>

<div class="class-reader">
 <div class="scroll" role="region" aria-label="讲稿" bind:this={scroller} onscroll={onScroll} onwheel={userScroll} ontouchmove={userScroll}>
  <div class="text">
   <p class="legend"><span class="k speech">课堂发言</span>英文，按字幕整理 · <span class="k translation">译文</span>中文对照{#if data.legacy} · 旧版讲稿，时间由文字恢复{/if}</p>
   {#each paragraphs as p,i (p.id)}
    {#if chapters.has(i)}<h2 id={'ch-'+i}>{chapters.get(i)}</h2>{/if}
    {@const prev=paragraphs[i-1]}
    <section class="para" class:playing={i===active} class:flash={i===flash} data-p={i}>
     <div class="meta">
      <button class="time" type="button" onclick={()=>seek(i)} disabled={!playable} title={playable?'从这里播放':audio?'录音未关联当前字幕':'上传录音后可播放'}>{playable?'▶ ':''}{clock(p.startMs)}</button>
      {#if !prev||prev.speaker!==p.speaker||chapters.has(i)}<span class="speaker {p.speaker==='Lecturer'?'lecturer':p.speaker==='Student'?'student':'unclear'}">{speakerLabel[p.speaker]}</span>{/if}
      {#if issues.has(i)}<span class="check" title={issues.get(i)!.join('；')}>待核对</span>{/if}
     </div>
     <p class="en">{p.english}</p>
     <p class="zh">{p.chinese}</p>
     <details class="source">
      <summary>来源</summary>
      <p>字幕 {clock(p.startMs)} → {clock(p.endMs)} · 第 {p.cueIds[0]}–{p.cueIds.at(-1)} 条 · {p.speaker}</p>
      {#if p.corrections.length}<p>识别修正：{p.corrections.join('；')}</p>{/if}
      {#if issues.has(i)}<p class="warn">内容待核对：{issues.get(i)!.join('；')}</p>{/if}
      {#if playable}<button class="btn btn-quiet" type="button" onclick={()=>seek(i,true)}>只听这一段</button>{/if}
     </details>
    </section>
   {/each}
  </div>
  {#if toc.length}
   <nav class="toc" aria-label="目录">
    <h3>目录</h3>
    {#each toc as c,n (c.index)}
     {@const next=toc[n+1]?.index??Infinity}
     <button type="button" class:on={(active>=0?active:visible)>=c.index&&(active>=0?active:visible)<next} onclick={()=>scrollTo(c.index)}><span>{c.title}</span><small>{clock(c.startMs)}</small></button>
    {/each}
   </nav>
  {/if}
 </div>

 <div class="player" aria-label="录音">
  {#if !audio}
   <span class="muted">上传本节录音后，可点击段落时间播放。</span>
   <button class="btn" type="button" onclick={onupload}>上传录音</button>
  {:else}
   {#if !audio.matched}
    <div class="unbound">
     <span>录音还没有关联当前字幕。确认这份录音对应当前字幕后再关联。</span>
     <button class="btn" type="button" disabled={binding} onclick={()=>bind({bindCurrent:true})}>关联当前字幕</button>
    </div>
   {/if}
   <audio bind:this={player} src={audio.url} preload="metadata" controls
    onloadedmetadata={onLoaded} ontimeupdate={onTime} onplay={()=>playing=true} onpause={()=>{playing=false;savePosition();}}
    onerror={()=>message='浏览器无法播放此录音编码，可换成 MP3 或 WAV。'}></audio>
   <div class="tools">
    <button class="btn btn-quiet" type="button" onclick={()=>nudge(-10)}>−10 秒</button>
    <button class="btn btn-quiet" type="button" onclick={()=>nudge(10)}>＋10 秒</button>
    <select bind:value={rate} aria-label="播放速度">{#each [0.75,1,1.25,1.5,2] as r (r)}<option value={r}>{r}×</option>{/each}</select>
    <label class="follow"><input type="checkbox" bind:checked={follow}/>跟随讲稿</label>
    <button class="btn btn-quiet" type="button" onclick={backToCurrent} disabled={active<0}>回到当前段</button>
    <details class="calibrate" bind:open={calibrate}>
     <summary>时间校准</summary>
     <div class="pop">
      <label>录音时间 = 字幕时间 ＋ <input type="number" step="0.1" bind:value={offsetInput}/> 秒</label>
      <button class="btn" type="button" disabled={binding} onclick={saveOffset}>保存</button>
      <small>用于开头时差；中途剪辑过的录音需要重新对齐字幕。</small>
     </div>
    </details>
   </div>
  {/if}
  {#if message}<span class="message" role="status">{message}</span>{/if}
 </div>
</div>

<style>
 .class-reader{display:flex;flex-direction:column;height:100%;min-height:0;container-type:inline-size;}
 .scroll{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:var(--space-5);padding:var(--space-4) var(--space-5) var(--space-6);}
 .text{max-width:820px;width:100%;justify-self:center;}
 .legend{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-1);margin:0 0 var(--space-4);color:var(--fg-muted);font-size:var(--text-xs);}
 .k{padding:1px var(--space-2);border-radius:999px;font-weight:var(--weight-medium);margin-left:var(--space-2);}
 .k:first-child{margin-left:0;}
 .k.speech{color:var(--kind-speech);background:var(--status-running-bg);}
 .k.translation{color:var(--kind-translation);background:var(--accent-soft);}
 h2{font-size:var(--text-lg);margin:var(--space-5) 0 var(--space-3);padding-top:var(--space-2);border-top:1px solid var(--line);}
 .para{padding:var(--space-2) var(--space-3);margin:0 0 var(--space-2);border-radius:var(--radius-sm);scroll-margin-top:var(--space-4);}
 .para.playing{background:var(--status-running-bg);}
 .para.flash{box-shadow:inset 3px 0 0 var(--accent);background:var(--accent-soft);transition:background .6s;}
 .meta{display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1);}
 .time{border:0;background:transparent;padding:0;font-size:var(--text-xs);color:var(--accent);font-variant-numeric:tabular-nums;cursor:pointer;}
 .time:disabled{color:var(--fg-muted);cursor:default;}
 .speaker{padding:1px var(--space-2);border-radius:999px;font-size:var(--text-xs);font-weight:var(--weight-bold);}
 .speaker.lecturer{color:var(--kind-speech);background:var(--status-running-bg);}
 .speaker.student{color:var(--status-done-fg);background:var(--status-done-bg);}
 .speaker.unclear{color:var(--status-stopped-fg);background:var(--status-stopped-bg);}
 .check{font-size:var(--text-xs);color:var(--status-stopped-fg);}
 .en,.zh{margin:0;padding-left:var(--space-3);white-space:pre-wrap;line-height:1.7;font-family:var(--font-reading);}
 .en{border-left:2px solid var(--kind-speech);font-size:var(--text-md);}
 .zh{border-left:2px solid var(--kind-translation);margin-top:var(--space-1);font-size:var(--text-md);color:var(--ink-700);}
 .source{margin:var(--space-1) 0 0 var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);}
 .source summary{cursor:pointer;width:max-content;}
 .source p{margin:var(--space-1) 0;}
 .warn{color:var(--status-stopped-fg);}
 .toc{position:sticky;top:0;align-self:start;max-height:calc(100vh - 220px);overflow:auto;display:flex;flex-direction:column;gap:2px;font-size:var(--text-sm);}
 .toc h3{font-size:var(--text-xs);color:var(--fg-muted);font-weight:var(--weight-medium);margin:0 0 var(--space-1);}
 .toc button{display:flex;justify-content:space-between;gap:var(--space-2);text-align:left;padding:var(--space-1) var(--space-2);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg-muted);}
 .toc button:hover{background:var(--sand-200);color:var(--fg);}
 .toc button.on{background:var(--accent-soft);color:var(--accent-strong);}
 .toc small{font-variant-numeric:tabular-nums;flex:none;}
 .player{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3);padding:var(--space-2) var(--space-4);border-top:1px solid var(--line);background:var(--bg-surface);font-size:var(--text-sm);}
 audio{height:36px;flex:1 1 320px;min-width:240px;}
 .tools{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2);}
 .tools select{height:30px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .follow{display:flex;align-items:center;gap:var(--space-1);}
 .calibrate{position:relative;}
 .calibrate summary{cursor:pointer;color:var(--fg-muted);}
 .pop{position:absolute;right:0;bottom:calc(100% + var(--space-2));width:300px;display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);z-index:5;}
 .pop .btn{align-self:flex-start;}
 .pop input{width:72px;height:28px;border-radius:var(--radius-sm);border:1px solid var(--line-strong);}
 .pop small{color:var(--fg-muted);font-size:var(--text-xs);}
 .unbound{flex-basis:100%;display:flex;align-items:center;gap:var(--space-3);color:var(--status-stopped-fg);}
 .muted{color:var(--fg-muted);}
 .message{flex-basis:100%;color:var(--fg-muted);font-size:var(--text-xs);}
 /* Measured on the reader itself, so the open Ask panel also hides the table of contents. */
 @container (max-width:760px){.scroll{grid-template-columns:minmax(0,1fr);padding:var(--space-3) var(--space-3) var(--space-5);}.toc{display:none;}}
</style>
