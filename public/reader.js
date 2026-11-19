import {readingNotices} from './reading-notices.js';
export function createReader({api,post,project,endpoint,markdown,escape,version,onContext,onError}){
 const $=s=>document.querySelector(s);let sourceId='',pageIndex=0,data=null,preview=null,mode='cached',visible=false,key='',ticket=0,pdf=null,buffer=null,zoom=1,aspect=16/9,observer=null,resizeTimer,scrollTimer,restore=null,enlarged=null,pdfTask=null,readAbort=null;
 let ratios=[4,3,3];
 const previewIssues=new Map();
 const frames=new Map(),draws=new Map(),imageJobs=new Map();let near=new Set(),jobs=0;
 const files=()=>project()?.files.filter(f=>f.role==='ppt')||[],file=()=>files().find(f=>f.id===sourceId),isPptx=()=>/\.pptx$/i.test(file()?.name||''),url=action=>endpoint(action)+'?source='+encodeURIComponent(sourceId),storageKey=()=> 'classroom-reader:'+project()?.id;
 function saved(){try{return JSON.parse(localStorage.getItem(storageKey())||'null');}catch{return null;}}
 function remember(){if(!data?.sourceHash)return;try{localStorage.setItem(storageKey(),JSON.stringify({sourceId,hash:data.sourceHash,pageIndex,mode,widths:ratios,cacheVersion:1}));}catch{}}
 const count=()=>data?.nativePageCount||preview?.pages||Math.max(1,...(data?.pages||[]).filter(p=>Number.isInteger(p.pageIndex)).map(p=>p.pageIndex+1));
 const mismatch=()=>!!(data?.sourceChanged||mode==='pdf'&&preview?.pages&&data?.nativePageCount&&preview.pages!==data.nativePageCount);
 function context(){const f=file();return f?{file:f,focus:{kind:'page',sourceId,pageIndex},pageAvailable:!mismatch()&&!!data?.pages?.some(p=>p.pageIndex===pageIndex),label:f.name+' · 第 '+(pageIndex+1)+' 页'}:null;}
 function nav(){const total=count();pageIndex=Math.max(0,Math.min(pageIndex,total-1));$('#reader-page').value=pageIndex+1;$('#reader-page').max=total;$('#reader-total').textContent=total;$('#reader-prev').disabled=pageIndex<=0;$('#reader-next').disabled=pageIndex>=total-1;remember();onContext(context());queue();}
 function dropFrame(index){const item=frames.get(index);if(!item)return;clearTimeout(item.timer);if(!item.done)jobs=Math.max(0,jobs-1);item.frame.contentWindow?.postMessage({type:'classroom-reader',action:'dispose',ticket:item.token},location.origin);item.frame.remove();frames.delete(index);}
 function drop(){previewIssues.clear();observer?.disconnect();observer=null;near.clear();for(const index of [...frames.keys()])dropFrame(index);for(const draw of draws.values())draw.cancel();draws.clear();jobs=0;buffer=null;readAbort?.abort();readAbort=null;pdfTask?.destroy().catch(()=>{});pdfTask=null;pdf=null;imageJobs.clear();$('#reader-grid').replaceChildren();}
 function resizeFrames(){for(const image of document.querySelectorAll('.cached-slide')){const host=image.parentElement;image.style.width=Math.max(100,host.clientWidth-24)*zoom+'px';}for(const [index,item] of frames){const host=hostFor(index);if(!host)continue;const width=Math.max(100,host.clientWidth-24)*zoom;item.frame.style.width=width+'px';item.frame.style.height=width/aspect+'px';}}
 const rowFor=i=>$('#reader-grid').querySelector('[data-page="'+i+'"]'),hostFor=i=>rowFor(i)?.querySelector('.page-preview-host');
 function status(i,text){const el=rowFor(i)?.querySelector('.page-preview-status');if(el)el.textContent=text;if(/失败|无法|超时/.test(text))previewIssues.set(i,text);else previewIssues.delete(i);hintVisibility();}
 function queue(){if(!visible||mismatch())return;const candidates=[...near].sort((a,b)=>Math.abs(a-pageIndex)-Math.abs(b-pageIndex)).slice(0,3);for(const i of [...frames.keys()])if(!candidates.includes(i))dropFrame(i);for(const i of candidates){if(mode==='cached'){if(!imageJobs.has(i)&&!hostFor(i)?.querySelector('img'))drawCached(i);}else if(mode==='browser'){if(jobs>=2)break;if(!frames.has(i))startFrame(i);}else if(pdf&&!draws.has(i)&&!hostFor(i)?.querySelector('canvas'))drawPdf(i);}}
 function startFrame(index){if(!buffer)return;const host=hostFor(index);if(!host)return;const frame=document.createElement('iframe'),token=ticket+':'+index+':'+Date.now(),item={frame,token,done:false};jobs++;frames.set(index,item);frame.title='课件原始页面 · 第 '+(index+1)+' 页';frame.src='/pptx-frame.html';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.setAttribute('referrerpolicy','no-referrer');frame.onload=()=>{if(frames.get(index)!==item)return;frame.contentWindow.postMessage({type:'classroom-reader',action:'open',ticket:token,url:url('preview-source'),hash:data.sourceHash,pageIndex:index,buffer},location.origin);};host.replaceChildren(frame);resizeFrames();status(index,'正在绘制…');item.timer=setTimeout(()=>{if(frames.get(index)===item&&!item.done){item.done=true;jobs=Math.max(0,jobs-1);status(index,'预览准备超时，可重新加载或切换 PDF。');queue();}},45000);}
 addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.type!=='classroom-pptx')return;const r=event.data,pair=[...frames].find(([,v])=>v.frame.contentWindow===event.source&&v.token===r.ticket);if(!pair)return;const [index,item]=pair;if(r.stage)status(index,r.stage);if(r.ready||r.error){clearTimeout(item.timer);if(!item.done){item.done=true;jobs=Math.max(0,jobs-1);}if(r.ready){aspect=r.width/r.height||16/9;resizeFrames();status(index,(r.hidden?'隐藏幻灯片 · ':'')+(r.warnings?.length?r.warnings.join('；'):'浏览器预览'));if(r.pages!==count()){data.sourceChanged=true;$('#reader-hint').textContent='原件与解析页数不一致，请核对后重新导入。';paint();}}else status(index,'预览失败：'+r.error+'。可切换 PDF。');queue();}});
 async function drawCached(index){
  const host=hostFor(index);if(!host)return;const mine=ticket;imageJobs.set(index,mine);status(index,'读取页面缓存；首次查看时生成…');
  try{const response=await fetch(url('page-image')+'&page='+(index+1)+'&hash='+encodeURIComponent(data.sourceHash));if(!response.ok){let message;try{message=(await response.json()).error;}catch{}throw Error(message||'页面预览读取失败');}
   const warnings=decodeURIComponent(response.headers.get('X-Preview-Warnings')||''),outdated=response.headers.get('X-Learning-Stale')==='1',blob=await response.blob();if(outdated&&mine===ticket){data.learningStale=true;const p=data.pages?.find(p=>p.pageIndex===index);if(p)p.learningStale=true;decorateQuality();}if(mine!==ticket||!visible||!host.isConnected||!near.has(index))return;
   const image=document.createElement('img'),objectUrl=URL.createObjectURL(blob);image.className='cached-slide';image.alt='课件原始页面 · 第 '+(index+1)+' 页';image.onload=image.onerror=()=>URL.revokeObjectURL(objectUrl);image.src=objectUrl;host.replaceChildren(image);resizeFrames();status(index,[warnings,outdated?'译文与解读待更新':'已缓存原页 · 供阅读与 AI 识别复用'].filter(Boolean).join('；'));
  }catch(e){if(mine===ticket)status(index,'页面预览失败：'+e.message+'；可切换实时预览或关联 PDF。');}finally{if(imageJobs.get(index)===mine)imageJobs.delete(index);}
 }
 async function drawPdf(index){const host=hostFor(index);if(!host||!pdf)return;const mine=ticket;try{const page=await pdf.getPage(index+1);if(mine!==ticket||!visible||!host.isConnected)return;const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.max(150,host.clientWidth-24)*zoom/base.width}),ratio=Math.min(devicePixelRatio||1,2),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('aria-label','原始课件第 '+(index+1)+' 页');host.replaceChildren(canvas);const task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});draws.set(index,task);await task.promise;if(mine===ticket)status(index,preview.direct?'PDF 原件':'PDF 预览');}catch(e){if(e.name!=='RenderingCancelledException'&&mine===ticket)status(index,'PDF 无法显示：'+e.message);}finally{draws.delete(index);}}

 function decorateQuality(){
  if(data?.learningStale&&!mismatch())$('#reader-hint').textContent='原页预览已更新或未记录图像版本；当前译文和解读保留供参考，请生成预习后核对。';
  for(const row of $('#reader-grid').querySelectorAll('.page-row')){
   for(const [selector,label] of [['.page-original','原页'],['.page-translation','双语译文'],['.page-analysis','细读']]){
    row.querySelector(selector+' h3').textContent=label;
   }
  }
 }
 function paint(){
  if(!visible)return;const blocked=mismatch();$('#reader-hint').dataset.error=String(blocked);$('#reader-hint').textContent=blocked?'原件、预览或解析页数不一致，暂不对应旧译文。':data?.legacy?'正在显示从旧版导读恢复的内容；原文与译文按页对应。':data?.stale?'材料已有更新；当前显示已保存版本，可重新生成。':!file()?.parsed?'在材料行 AI 解析或导入 JSON 后，可生成正文双语翻译与细读。':'向下滚动连续阅读；点击页码可跳页。';
  if(!blocked&&data?.review?.status==='pending')$('#reader-hint').textContent+=' 全部页面已完成；整课检查仍有 '+(data.review.issues?.length||0)+' 项待处理，可在材料行继续检查。';
  $('#preview-mode').value=mode;$('#preview-mode').disabled=false;$('#preview-mode').querySelector('[value=browser]').disabled=!isPptx();$('#preview-associate').hidden=!!preview?.direct;$('#preview-clear').hidden=!preview?.pages||!!preview?.direct;$('#preview-pdf-link').hidden=preview?.status!=='ready';$('#preview-pdf-link').href=url('preview-file');$('#preview-original').href=endpoint('source')+'?id='+encodeURIComponent(sourceId);
  $('#reader-grid').innerHTML=Array.from({length:count()},(_,i)=>{const p=blocked?null:data?.pages?.find(p=>p.pageIndex===i),paragraphs=p?.paragraphs||[];return `<article class="page-row" data-page="${i}" aria-label="第 ${i+1} 页"><div class="page-break">第 ${i+1} 页</div><section class="page-pane page-original"><div class="page-label"><h3>第 ${i+1} 页 · 原页</h3><button data-enlarge="${i}" aria-label="放大第 ${i+1} 页"><svg class="app-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/></svg></button></div><div class="page-preview-host"></div><p class="page-preview-status hint">${blocked?'待核对页面':mode==='pdf'&&preview?.status!=='ready'?'请在“更多”中关联从课件导出的 PDF。':'滚动到本页时加载预览'}</p></section><div class="page-divider column-divider" data-divider="0" role="separator" aria-label="调整原页与译文宽度" aria-orientation="vertical" tabindex="0"></div><section class="page-pane page-translation"><div class="page-label"><h3>正文双语翻译</h3></div>${paragraphs.length?paragraphs.map(p=>`<div class="bilingual-paragraph"><div lang="en">${escape(p.english)}</div>${p.chinese?`<div lang="zh">${escape(p.chinese)}</div>`:''}</div>`).join(''):`<p class="empty">${blocked?'待核对页面。':data?.generated?'本页未收录可翻译正文。':''}</p>`}</section><div class="page-divider column-divider" data-divider="1" role="separator" aria-label="调整译文与细读宽度" aria-orientation="vertical" tabindex="0"></div><section class="page-pane page-analysis"><div class="page-label"><h3>本页细读</h3></div>${p?.closeReading?`<div class="markdown">${markdown(p.closeReading)}</div>`:''}</section></article>`;}).join('');
  $('#reader-grid').querySelectorAll('[data-enlarge]').forEach(b=>b.onclick=()=>enlarge(+b.dataset.enlarge));bindDividers();columns();nav();observer?.disconnect();observer=new IntersectionObserver(entries=>{for(const e of entries){const i=+e.target.dataset.page;if(e.isIntersecting)near.add(i);else {near.delete(i);dropFrame(i);const task=draws.get(i);task?.cancel();draws.delete(i);hostFor(i)?.replaceChildren();}}queue();},{root:$('#reader-scroll'),rootMargin:'400px 0px'});$('#reader-grid').querySelectorAll('.page-row').forEach(row=>observer.observe(row));
 }
 async function load(){const stored=saved()?.widths;ratios=Array.isArray(stored)&&stored.length===3&&stored.every(n=>Number.isFinite(n)&&n>0)?stored:[4,3,3];applyWidths();const mine=++ticket;drop();data=null;preview=null;try{const response=await api(url('reader')+(version()?'&version='+encodeURIComponent(version()):''));if(mine!==ticket)return;data=response;if(restore?.hash===data.sourceHash){pageIndex=restore.pageIndex||0;mode=restore.mode==='pdf'?'pdf':restore.mode==='browser'&&isPptx()?'browser':'cached';}else{pageIndex=0;mode='cached';}restore=null;preview=await api(url('preview-status'));if(mine!==ticket)return;paint();if(mode==='browser'){
   readAbort=new AbortController();const response=await fetch(url('preview-source'),{signal:readAbort.signal});if(!response.ok)throw Error('无法读取 PPT 原件。');const bytes=await response.arrayBuffer();if(mine!==ticket)return;buffer=bytes;queue();
  }else if(mode==='pdf'&&preview.status==='ready'){const lib=await import('/vendor/pdfjs/pdf.mjs?build=legacy-6.4.299');lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs?build=legacy-6.4.299';pdfTask=lib.getDocument({url:url('preview-file'),disableRange:true,disableStream:true,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false});const document=await pdfTask.promise;if(mine!==ticket){document.destroy();return;}pdf=document;if(!data.nativePageCount&&pdf.numPages!==count()){preview.pages=pdf.numPages;paint();}queue();}go(pageIndex);
  }catch(e){if(mine===ticket&&e.name!=='AbortError'){$('#reader-hint').dataset.error='true';$('#reader-hint').textContent=e.message;}}}
 async function sync(){
  if(!visible)return;
  const list=files(),signature=JSON.stringify(list.map(f=>[f.id,f.name]));
  if($('#reader-file').dataset.options!==signature){
   $('#reader-file').innerHTML=list.map(f=>`<option value="${escape(f.id)}">${escape(f.name)}</option>`).join('');
   $('#reader-file').dataset.options=signature;
  }
  const previous=saved();
  if(!list.some(f=>f.id===sourceId)){sourceId=list.find(f=>f.id===previous?.sourceId)?.id||list[0]?.id||'';pageIndex=0;key='';}
  $('#reader-file').value=sourceId;$('#reader-file').title=file()?.name||'';$('#reader-empty').hidden=!!sourceId;$('#reader-content').hidden=!sourceId;
  const selected=file(),p=project();
  const next=JSON.stringify([p?.id,sourceId,selected?.parsed,selected?.parsedAt,selected?.aiParse?.finished,p?.preparation?.generation,version()]);
  if(next!==key){
   if(!restore&&previous?.sourceId===sourceId)restore={...previous,mode:previous.cacheVersion===1?previous.mode:'cached'};
   key=next;if(sourceId)await load();else onContext(null);
  }
 }
 function go(index){
  pageIndex=Math.max(0,Math.min(count()-1,index));
  nav();
  const row=rowFor(pageIndex),scroller=$('#reader-scroll');
  if(row)scroller.scrollTo({top:scroller.scrollTop+row.getBoundingClientRect().top-scroller.getBoundingClientRect().top,behavior:'instant'});
 }
 $('#reader-scroll').onscroll=()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const top=$('#reader-scroll').getBoundingClientRect().top;let best=0,distance=Infinity;for(const row of $('#reader-grid').querySelectorAll('.page-row')){const rect=row.getBoundingClientRect();if(rect.bottom<=top+10)continue;if(rect.top<=top+100&&rect.bottom>top+100){best=+row.dataset.page;break;}if(rect.top>top+100)break;const d=Math.abs(rect.top-top);if(d<distance){best=+row.dataset.page;distance=d;}if(rect.top>top+100)break;}if(best!==pageIndex){pageIndex=best;nav();}},100);};
 $('#reader-file').onchange=()=>{sourceId=$('#reader-file').value;restore=null;key='';sync().catch(onError);};$('#reader-prev').onclick=()=>go(pageIndex-1);$('#reader-next').onclick=()=>go(pageIndex+1);$('#reader-page').onchange=()=>go(Number($('#reader-page').value)-1||0);$('#reader-page').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go(Number(e.target.value)-1||0);}};
 async function changeMode(value){restore={hash:data?.sourceHash,pageIndex,mode:value};key='';await sync();}
 $('#preview-mode').onchange=()=>changeMode($('#preview-mode').value).catch(onError);$('#preview-zoom').onchange=()=>{zoom=+$('#preview-zoom').value;resizeFrames();if(mode==='pdf')for(const i of near)drawPdf(i);};$('#preview-generate').onclick=()=>changeMode(mode).catch(onError);
 $('#preview-associate').onclick=()=>$('#preview-file-input').click();$('#preview-file-input').onchange=async()=>{const chosen=$('#preview-file-input').files[0];if(!chosen)return;try{await api(url('preview-pdf'),{method:'POST',body:chosen});await changeMode('pdf');$('#reader-more').open=false;}catch(e){onError(e.message);}finally{$('#preview-file-input').value='';}};
 $('#preview-clear').onclick=async()=>{try{await post(url('preview-clear'),{});await changeMode('cached');$('#reader-more').open=false;}catch(e){onError(e.message);}};
 const layoutTools=document.createElement('div');
 layoutTools.className='reader-compact-tools';layoutTools.hidden=true;
 layoutTools.innerHTML='<button type="button" data-side="translation">译文</button><button type="button" data-side="analysis">细读</button><button type="button" data-layout>展开三栏</button>';
 $('.continuous-tools').append(layoutTools);
 let compact=false,side='translation',preferThree=false;
 const compactNeeded=()=>document.body.classList.contains('qa-parallel')&&document.body.classList.contains('qa-open')&&$('#reader-scroll').clientWidth<1080&&$('#show-translation').checked&&$('#show-close-reading').checked;
 function visibleColumns(){
  return {translation:$('#show-translation').checked&&(!compact||side==='translation'),reading:$('#show-close-reading').checked&&(!compact||side==='analysis')};
 }
 function columns(){
  decorateQuality();
  const needed=compactNeeded();
  if(!needed)preferThree=false;
  compact=needed&&!preferThree;layoutTools.hidden=!needed;
  layoutTools.querySelector('[data-layout]').textContent=compact?'展开三栏':'改为双栏';
  for(const button of layoutTools.querySelectorAll('[data-side]')){
   button.hidden=!compact;button.setAttribute('aria-pressed',String(button.dataset.side===side));
  }
  const {translation,reading}=visibleColumns(),grid=$('#reader-grid');
  grid.dataset.columns=1+Number(translation)+Number(reading);grid.dataset.translation=String(translation);
  grid.classList.toggle('no-translation',!translation);grid.classList.toggle('no-analysis',!reading);
  grid.querySelectorAll('.page-divider').forEach(e=>{e.hidden=(!translation&&!reading)||+e.dataset.divider===1&&(!translation||!reading);});
  applyWidths();requestAnimationFrame(resizeFrames);
 }
 layoutTools.onclick=e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.side)side=button.dataset.side;else preferThree=compact;
  columns();resize();
 };
 $('#show-translation').onchange=columns;$('#show-close-reading').onchange=columns;
 async function enlarge(index){const host=$('#enlarged-page');host.replaceChildren();$('#preview-dialog').showModal();try{if(mode==='cached'){const image=document.createElement('img');image.alt='放大的课件原始页面';image.src=url('page-image')+'&page='+(index+1)+'&hash='+encodeURIComponent(data.sourceHash);image.className='enlarged-cached-slide';host.append(image);}else if(mode==='browser'&&buffer){enlarged=document.createElement('iframe');enlarged.src='/pptx-frame.html';enlarged.title='放大的课件页面';enlarged.setAttribute('sandbox','allow-scripts allow-same-origin');enlarged.style.width='100%';enlarged.style.height=Math.max(200,host.clientWidth/aspect)+'px';enlarged.onload=()=>enlarged?.contentWindow.postMessage({type:'classroom-reader',action:'open',ticket:'enlarged-'+Date.now(),url:url('preview-source'),hash:data.sourceHash,pageIndex:index,buffer},location.origin);host.append(enlarged);}else if(pdf){const page=await pdf.getPage(index+1),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,Math.max(600,innerWidth*.85)/base.width)}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;host.append(canvas);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;}}catch(e){onError(e.message);}}
 $('#preview-dialog-close').onclick=()=>$('#preview-dialog').close();
 $('#preview-dialog').addEventListener('close',()=>{enlarged?.remove();enlarged=null;$('#enlarged-page').replaceChildren();});
 function resize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!visible)return;if(compact!==(compactNeeded()&&!preferThree)||(!compactNeeded()&&preferThree))columns();resizeFrames();if(mode==='pdf')for(const i of near)drawPdf(i);},150);}addEventListener('resize',resize);addEventListener('qa-resized',resize);new ResizeObserver(resize).observe($('#reader-scroll'));
 function applyWidths(){const {translation,reading}=visibleColumns();const tracks=translation&&reading?`minmax(0,${ratios[0]}fr) 8px minmax(0,${ratios[1]}fr) 8px minmax(0,${ratios[2]}fr)`:`minmax(0,${ratios[0]}fr) 8px minmax(0,${translation?ratios[1]:ratios[2]}fr)`;$('#reader-grid').style.setProperty('--reader-tracks',tracks);}
 function divider(handle,delta,widths){const three=$('#reader-grid').dataset.columns==='3',i=three?+handle.dataset.divider:0,min=Math.min(190,(widths[i]+widths[i+1])/3),left=Math.max(min,Math.min(widths[i]+widths[i+1]-min,widths[i]+delta)),next=[...widths];next[i]=left;next[i+1]=widths[i]+widths[i+1]-left;if(three)ratios=next;else{const other=visibleColumns().translation?1:2;const total=ratios[0]+ratios[other],sum=next[0]+next[1];ratios[0]=next[0]/sum*total;ratios[other]=next[1]/sum*total;}applyWidths();remember();resize();}
 function bindDividers(){for(const handle of $('#reader-grid').querySelectorAll('.page-divider')){
  const widths=()=>[...handle.closest('.page-row').querySelectorAll('.page-pane')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.getBoundingClientRect().width);
  handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key)||$('#reader-grid').dataset.columns==='1')return;e.preventDefault();divider(handle,e.key==='ArrowRight'?24:-24,widths());};
  handle.onpointerdown=e=>{if(e.button!==0||$('#reader-grid').dataset.columns==='1')return;e.preventDefault();handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-columns');const start=e.clientX,w=widths(),move=e=>divider(handle,e.clientX-start,w),stop=()=>{document.body.classList.remove('resizing-columns');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop);};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);};
 }}
 const hints=readingNotices({bar:$('#reader-message'),close:$('#reader-hint-close'),tools:$('#reader-more-content'),retry:async()=>{restore={hash:data?.sourceHash,pageIndex,mode};key='';await sync();}});
 $('#reader-hint').hidden=true;
 function hintVisibility(){
  const text=$('#reader-hint').textContent,guide=text==='向下滚动连续阅读；点击页码可跳页。';
  const issues=text?[{id:'message:'+text,text,guide,severity:$('#reader-hint').dataset.error==='true'?'error':'detail'}]:[];
  for(const p of data?.pages||[]){
   if(['partial','unavailable'].includes(p.inspection?.status)||p.quality?.coverage?.missingCount){
    const missing=p.quality?.coverage?.missing||[];
    issues.push({id:'quality:'+p.pageIndex+':'+JSON.stringify([p.inspection?.status,missing]),text:'第 '+(p.pageIndex+1)+' 页有待核对内容'+(missing.length?'：'+missing.slice(0,6).join('；'):'，请对照原页核对。')});
   }
  }
  for(const [i,text] of previewIssues)issues.push({id:'preview:'+i+':'+text,severity:'error',text:'第 '+(i+1)+' 页：'+text});
  hints.update(JSON.stringify([project()?.id,sourceId,data?.sourceHash]),issues);
 }
 new MutationObserver(hintVisibility).observe($('#reader-hint'),{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-error']});
 return {context,sync,async show(value){const changed=visible!==value;visible=value;$('#ppt-reader').hidden=!value;if(value){await sync();if(changed)resize();}else if(changed){remember();ticket++;drop();key='';}},reset(){remember();sourceId='';key='';restore=null;ticket++;drop();},refresh(){restore={hash:data?.sourceHash,pageIndex,mode};key='';return sync();}};
}
