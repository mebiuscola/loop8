import {readingNotices} from './reading-notices.js';
export function createReferenceReader({api,project,endpoint,onContext,onError}){
 const $=selector=>document.querySelector(selector);
 const scroll=$('#reference-scroll'),host=$('#reference-paragraphs');
 let visible=false,id='',key='',data=null,page=0,pdf=null,pdfTask=null,ticket=0,timer,scrollFrame,observer;
 const rows=new Map(),near=new Set(),renders=new Map(),rendered=new Map(),previewErrors=new Map();
 const positions=new Map(),selections=new Map();
 const files=()=>project()?.files.filter(f=>f.role==='reading')||[];
 const file=()=>files().find(f=>f.id===id);
 const positionKey=()=>JSON.stringify([project()?.id,id]);
 const count=()=>pdf?.numPages||Math.max(1,...(data?.paragraphs||[]).map(p=>(p.pageIndex??0)+1));
 function remember(){
  if(!id||!data)return;
  const row=rows.get(page);
  positions.set(positionKey(),{page,offset:row?scroll.getBoundingClientRect().top-row.getBoundingClientRect().top:0});
  selections.set(project()?.id,id);
 }
 function context(){return file()?{file:file(),focus:{kind:'page',sourceId:id,pageIndex:page},pageAvailable:!!data?.paragraphs.some(p=>p.pageIndex===page),label:file().name+' · PDF 第 '+(page+1)+' 页'}:null;}
 function stopPreview(){
  observer?.disconnect();near.clear();
  for(const entry of renders.values())entry.task?.cancel();
  renders.clear();
 }
 function releaseDocument(){
  stopPreview();rendered.clear();rows.clear();previewErrors.clear();
  pdfTask?.destroy().catch(()=>{});pdfTask=null;pdf=null;
 }
 const profile=document.createElement('select');profile.id='reference-retry-model';profile.setAttribute('aria-label','本次补译模型');profile.hidden=true;
 $('#reference-actions').prepend(profile);
 const bar=document.createElement('div'),close=document.createElement('button');
 close.type='button';close.className='reading-notice-close';close.textContent='×';
 bar.append(close);$('#reference-status').after(bar);
 const hints=readingNotices({bar,close,tools:$('#reference-more .reading-menu-content'),retry:async()=>{remember();key='';await sync();}});
 $('#reference-status').hidden=true;
 function showProgress(){
  const {summary,taskStatus,taskError,stale,sourceWarnings,models}=data;
  const notices=[];
  const printed=[...new Set(data.paragraphs.filter(p=>p.pageIndex===page&&p.printedPage).map(p=>p.printedPage))];
  notices.push('PDF 第 '+(page+1)+' 页'+(printed.length?' · 印刷页 '+printed.join('、'):''));
  if(summary.total)notices.push(`已翻译 ${summary.completed}/${summary.total} 块`);
  if(summary.blocked)notices.push(`${summary.blocked} 块被过滤，待补译`);
  if(taskStatus==='running')notices.push('正在翻译');
  if(taskError)notices.push(taskError);
  if(stale)notices.push('原文已更新，匹配的译文已保留');
  if(sourceWarnings.missingPages.length||sourceWarnings.uncertaintyCount)notices.push('原文有缺页或解析疑点，译文仅覆盖可用内容');
  $('#reference-status').textContent=notices.join(' · ');
  const issues=[];
  const blocked=data.paragraphs.filter(p=>p.status==='blocked').map(p=>p.key);
  if(blocked.length)issues.push({id:'blocked:'+JSON.stringify(blocked),text:summary.blocked+' 块被模型过滤，原文已保留，可从“更多”补译。'});
  if(taskError)issues.push({id:'error:'+taskError,severity:'error',text:taskError+' 可在工具栏重试翻译。'});
  if(stale)issues.push({id:'stale',text:'原文已更新，匹配的译文已保留。'});
  if(sourceWarnings.missingPages.length||sourceWarnings.uncertaintyCount)issues.push({id:'source:'+JSON.stringify(sourceWarnings),text:'原文有缺页或解析疑点，译文仅覆盖可用内容。'});
  for(const [index,message] of previewErrors)issues.push({id:'preview:'+index+':'+message,severity:'error',text:'第 '+(index+1)+' 页：'+message});
  hints.update(JSON.stringify([project()?.id,id]),issues);
  const progress=$('.reference-toolbar .reading-task-status');
  if(progress){progress.hidden=taskStatus!=='running';progress.textContent='翻译 '+summary.completed+'/'+summary.total;}

  const choices=[['','使用当前模型'],...models.map(m=>[m.id,m.name+' · '+m.model])],optionsKey=JSON.stringify(choices);
  if(profile.dataset.options!==optionsKey){const selected=profile.value;profile.replaceChildren(...choices.map(([value,label])=>new Option(label,value)));profile.value=choices.some(([id])=>id===selected)?selected:'';profile.dataset.options=optionsKey;}
  profile.hidden=!models.length||summary.completed===summary.total||!data.generated&&!['error','interrupted'].includes(taskStatus);
  profile.disabled=taskStatus==='running';
 }

 function paragraph(p){
  const row=document.createElement('section'),en=document.createElement('div'),zh=document.createElement('div');
  row.className='bilingual-paragraph';en.lang='en';zh.lang='zh';
  en.textContent=p.english;
  zh.textContent=p.chinese||(p.status==='blocked'?'模型过滤了本段译文，可在工具栏补译。':'');
  if(!p.chinese)zh.classList.add('hint');
  row.append(en);if(zh.textContent)row.append(zh);
  return row;
 }
 function fillText(target,parts){
  target.replaceChildren(...parts.map(paragraph));
  if(!parts.length)target.textContent='本页未提供可读取的正文。';
 }
 function updateText(){
  const anchor=rows.get(page),top=anchor?.getBoundingClientRect().top;
  const groups=new Map(),unlocated=[];
  for(const part of data.paragraphs){
   if(!Number.isInteger(part.pageIndex)||part.pageIndex<0||part.pageIndex>=count())unlocated.push(part);
   else {if(!groups.has(part.pageIndex))groups.set(part.pageIndex,[]);groups.get(part.pageIndex).push(part);}
  }
  for(const [index,row] of rows){
   const parts=groups.get(index)||[],printed=[...new Set(parts.filter(p=>p.printedPage).map(p=>p.printedPage))];
   row.querySelector('.reference-original h3').textContent='原页'+(printed.length?' · 印刷页 '+printed.join('、'):'');
   fillText(row.querySelector('.reference-page-text'),parts);
  }
  host.querySelector('.reference-unlocated')?.remove();
  if(unlocated.length){
   const section=document.createElement('section'),heading=document.createElement('h3'),note=document.createElement('p'),body=document.createElement('div');
   section.className='reference-unlocated';heading.textContent='页码待核对的原文';
   note.textContent='以下内容没有可靠的 PDF 页码，保留在此供对照。';note.className='hint';
   fillText(body,unlocated);section.append(heading,note,body);host.append(section);
  }
  if(anchor&&top!==undefined)scroll.scrollTop+=anchor.getBoundingClientRect().top-top;
 }
 function nav(){
  page=Math.max(0,Math.min(count()-1,page));
  $('#reference-page').value=page+1;$('#reference-page').max=count();$('#reference-total').textContent=count();
  $('#reference-prev').disabled=page<=0;$('#reference-next').disabled=page>=count()-1;
  showProgress();remember();onContext(context());queue();
 }
 function observe(){
  observer?.disconnect();
  observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    const index=Number(entry.target.dataset.page);
    if(entry.isIntersecting)near.add(index);else near.delete(index);
   }
   queue();
  },{root:scroll,rootMargin:'400px 0px'});
  for(const row of rows.values())observer.observe(row);
 }
 function buildRows(){
  stopPreview();rendered.clear();rows.clear();host.replaceChildren();
  const fragment=document.createDocumentFragment();
  for(let i=0;i<count();i++){
   const row=document.createElement('article');
   row.className='reference-page-row';row.dataset.page=i;row.setAttribute('aria-label','PDF 第 '+(i+1)+' 页');
   row.innerHTML='<div class="page-break">PDF 第 '+(i+1)+' 页</div><section class="reference-original"><h3 class="reference-pane-heading">原页</h3><div class="reference-page-preview"></div></section><section class="reference-translation"><h3 class="reference-pane-heading">双语译文</h3><div class="reference-page-text"></div></section>';
   const preview=row.querySelector('.reference-page-preview');
   preview.style.aspectRatio='3 / 4';
   if(!pdf)preview.textContent=data.pdf?'正在读取原 PDF…':'请从“更多”下载原件对照。';
   rows.set(i,row);fragment.append(row);
  }
  host.append(fragment);updateText();observe();
 }
 async function draw(index,width){
  const document=pdf,row=rows.get(index),preview=row?.querySelector('.reference-page-preview'),mine=ticket,entry={task:null};
  if(!preview||!document)return;
  renders.set(index,entry);
  try{
   const original=await document.getPage(index+1);
   if(mine!==ticket||!visible||renders.get(index)!==entry)return;
   const base=original.getViewport({scale:1}),viewport=original.getViewport({scale:width/base.width});
   const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(4000000/(viewport.width*viewport.height)));
   const canvas=window.document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
   canvas.setAttribute('aria-label','PDF 第 '+(index+1)+' 页');
   canvas.dataset.page=index;if(index===0)canvas.id='reference-canvas';
   entry.task=original.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});
   await entry.task.promise;
   if(mine!==ticket||!visible||renders.get(index)!==entry)return;
   preview.style.aspectRatio=base.width+' / '+base.height;
   preview.replaceChildren(canvas);rendered.set(index,width);previewErrors.delete(index);
  }catch(error){
   if(mine===ticket&&renders.get(index)===entry&&error.name!=='RenderingCancelledException'){
    previewErrors.set(index,error.message);preview.textContent='原页显示失败，可下载原件对照。';showProgress();
   }
  }finally{if(renders.get(index)===entry){renders.delete(index);queue();}}
 }
 function queue(){
  if(!visible||!pdf)return;
  const candidates=[...near].sort((a,b)=>Math.abs(a-page)-Math.abs(b-page)).slice(0,3);
  for(const [index,entry] of renders)if(!candidates.includes(index)){entry.task?.cancel();renders.delete(index);}
  for(const [index] of rendered)if(!candidates.includes(index)){
   const preview=rows.get(index)?.querySelector('.reference-page-preview');
   preview?.replaceChildren();rendered.delete(index);
  }
  for(const index of candidates){
   const width=Math.floor(rows.get(index)?.querySelector('.reference-page-preview').clientWidth||0);
   if(width>0&&renders.size<2&&!renders.has(index)&&rendered.get(index)!==width&&!previewErrors.has(index))void draw(index,width);
  }
 }
 function go(n,offset=0){
  if(!data)return;
  page=Math.max(0,Math.min(count()-1,Math.floor(n)||0));
  const row=rows.get(page);
  if(row)scroll.scrollTo({top:scroll.scrollTop+row.getBoundingClientRect().top-scroll.getBoundingClientRect().top+offset,behavior:'instant'});
  nav();
 }
 function activePage(){
  const top=scroll.getBoundingClientRect().top+80;
  for(const [index,row] of rows){
   const rect=row.getBoundingClientRect();
   if(rect.top<=top&&rect.bottom>top)return index;
  }
  return page;
 }
 async function fetchProgress(){return api(endpoint('reference-reader')+'?source='+encodeURIComponent(id));}
 async function load(){
  const mine=++ticket;releaseDocument();data=null;profile.hidden=true;profile.value='';
  host.textContent='正在读取参考文献…';
  const restore=positions.get(positionKey())||{page:0,offset:0};
  try{
   const result=await fetchProgress();if(mine!==ticket)return;
   data=result;page=restore.page;$('#reference-original').href=endpoint('source')+'?id='+encodeURIComponent(id);
   buildRows();go(page,restore.offset);
   if(data.pdf){
    const lib=await import('/vendor/pdfjs/pdf.mjs?build=legacy-6.4.299');
    if(mine!==ticket)return;
    lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs?build=legacy-6.4.299';
    pdfTask=lib.getDocument({url:endpoint('reference-file')+'?source='+encodeURIComponent(id),disableStream:true,disableAutoFetch:true,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false});
    const document=await pdfTask.promise;
    if(mine!==ticket){document.destroy();return;}
    const index=activePage(),row=rows.get(index);
    const current=restore.page>=count()?restore:{page:index,offset:row?scroll.getBoundingClientRect().top-row.getBoundingClientRect().top:0};
    pdf=document;buildRows();go(current.page,current.offset);
   }
  }catch(error){
   if(mine===ticket){
    $('#reference-status').textContent=error.message;
    hints.update(JSON.stringify([project()?.id,id]),[{id:'load:'+error.message,severity:'error',text:error.message}]);
    if(!data)host.textContent='请先在本周材料完成解析。';
    else if(!pdf)for(const row of rows.values())row.querySelector('.reference-page-preview').textContent='原 PDF 未能显示，可下载原件对照。';
   }
  }
 }
 let progressKey='',progressRequest=0;
 async function sync(){
  if(!visible)return;
  const p=project(),list=files(),saved=selections.get(p?.id);
  if(!list.some(f=>f.id===id))id=list.find(f=>f.id===saved)?.id||list[0]?.id||'';
  const select=$('#reference-file'),items=JSON.stringify(list.map(f=>[f.id,f.name]));
  if(select.dataset.items!==items){select.replaceChildren(...list.map(f=>new Option(f.name,f.id)));select.dataset.items=items;}
  select.value=id;select.title=file()?.name||'';$('#reference-empty').hidden=!!id;$('#reference-content').hidden=!id;
  const f=file(),next=JSON.stringify([p?.id,id,f?.parsed,f?.parsedAt,f?.aiParse?.finished]),task=p?.tasks?.['reference:'+id];
  const nextProgress=JSON.stringify([f?.referenceTranslation?.generation,task?.status,task?.started,task?.finished,task?.status==='running'?p.stage:null]);
  if(id&&next!==key){key=next;progressKey=nextProgress;await load();}
  else if(id&&data&&nextProgress!==progressKey){
   progressKey=nextProgress;
   const request=++progressRequest,mine=ticket;
   try{
    const result=await fetchProgress();
    if(mine===ticket&&request===progressRequest){data=result;updateText();nav();}
   }catch(error){if(mine===ticket&&request===progressRequest){progressKey='';onError(error.message);}}
  }
  onContext(context());
 }
 scroll.onscroll=()=>{
  cancelAnimationFrame(scrollFrame);
  scrollFrame=requestAnimationFrame(()=>{
   if(!visible||!data)return;
   let current=activePage();
   if(scroll.scrollTop>0&&scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-2)current=count()-1;
   if(current!==page){page=current;nav();}else remember();
  });
 };
 $('#reference-file').onchange=()=>{remember();id=$('#reference-file').value;key='';void sync();};
 $('#reference-prev').onclick=()=>go(page-1);$('#reference-next').onclick=()=>go(page+1);
 $('#reference-page').onchange=()=>go(Number($('#reference-page').value)-1);
 $('#reference-page').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();go(Number(event.target.value)-1);}};
 new ResizeObserver(()=>{
  clearTimeout(timer);timer=setTimeout(()=>{if(visible){previewErrors.clear();queue();}},150);
 }).observe(scroll);
 return {
  context,state:()=>({available:!!data?.generated,stale:!!data?.stale,needsPublish:!!data?.needsPublish,pending:!!data?.summary&&(data.generated||['error','interrupted'].includes(data.taskStatus))&&data.summary.completed<data.summary.total}),
  retryProfile:()=>profile.hidden?'':profile.value,sourceId:()=>id,
  async show(value){const changed=visible!==value;if(changed&&!value){remember();stopPreview();}visible=value;$('#reference-reader').hidden=!value;if(value){await sync();if(changed&&data){observe();queue();}}},
  reset(){remember();ticket++;releaseDocument();key='';id='';page=0;data=null;},
  sync
 };
}
