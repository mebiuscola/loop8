import {layoutTables} from '/vendor/pptx-renderer/table-layout.mjs';
import {PptxViewer,parseZipLazyMedia,buildPresentation,RECOMMENDED_ZIP_LIMITS} from '/vendor/pptx-renderer/renderer.mjs';
let viewer=null,abort=null,ticket='',generation=0,warnings=[],currentPage=0,queuedPage=null,rendering=false;
let nativeWidth=960,nativeHeight=540,ownedFonts=[],fontWarnings=[],nativeLayout=false;
function clearFonts(){for(const face of ownedFonts)document.fonts.delete(face);ownedFonts=[];}
function fit(){slide.style.transform=nativeLayout?'none':`scale(${innerWidth/nativeWidth})`;slide.style.transformOrigin='0 0';}
addEventListener('resize',fit);
const state=document.querySelector('#state'),slide=document.querySelector('#slide');
function emit(detail){parent.postMessage({type:'classroom-pptx',ticket,...detail},location.origin);}
function status(stage,extra={}){state.textContent=stage;emit({stage,...extra});}
function metadata(){const model=viewer?.presentationData;return {pages:viewer?.slideCount||0,width:model?.width,height:model?.height,pageIndex:currentPage,hidden:!!model?.slides[currentPage]?.hidden,warnings:[...warnings]};}
async function settle(){
 await document.fonts.ready;
 await Promise.all([...slide.querySelectorAll('img')].map(img=>img.decode?.().catch(()=>{})));
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 fit();
 const tables=layoutTables(slide);if(tables.some(t=>t.problems.length))warnings.push('表格排版仍有疑点，可用 PDF 核对');
 // Diagnostics never mutate text scale or override authored autofit modes.
 let overflow=0;for(const box of slide.querySelectorAll('[data-classroom-text-box]')){
  if(!box.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(box);const text=range.getBoundingClientRect(),rect=box.getBoundingClientRect(),eps=2;
  if(rect.width>0&&rect.height>0&&(text.right>rect.right+eps||text.bottom>rect.bottom+eps||text.left<rect.left-eps||text.top<rect.top-eps))overflow++;
 }
 if(overflow)warnings.push(`${overflow} 个文本框可能溢出，可用 PDF 核对`);
}
async function navigate(index){queuedPage=index;if(rendering)return;rendering=true;const task=generation;try{while(queuedPage!==null&&task===generation&&viewer){const next=queuedPage;queuedPage=null;currentPage=next;warnings=[...fontWarnings];status('正在绘制第 '+(next+1)+' 页…',{rendering:true});await viewer.goToSlide(next);await settle();if(task===generation){state.textContent='';slide.style.visibility='visible';emit({ready:true,...metadata()});}}}catch(e){if(task===generation)status('当前页无法显示：'+e.message,{error:e.message,...metadata()});}finally{if(task===generation)rendering=false;}}
addEventListener('message',async event=>{
 if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='classroom-reader')return;
 const message=event.data;
 if(message.action==='open'){
  const task=++generation;nativeLayout=message.nativeLayout===true;ticket=message.ticket;abort?.abort();viewer?.destroy();clearFonts();fontWarnings=[];viewer=null;queuedPage=null;rendering=false;warnings=[];currentPage=Math.max(0,message.pageIndex||0);abort=new AbortController();
  try{
   const url=new URL(message.url,location.origin);if(url.origin!==location.origin||!(/^\/api\/projects\/[^/]+\/preview-source$/.test(url.pathname)||/^\/api\/parse-resource\/[a-f0-9-]{36}\/file$/.test(url.pathname)))throw Error('无效课件地址。');
   slide.style.visibility='hidden';status('正在读取课件…');let buffer=message.buffer;if(!(buffer instanceof ArrayBuffer)){const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('读取课件失败 '+response.status);buffer=await response.arrayBuffer();}if(task!==generation)return;
   if(message.hash){const digest=await crypto.subtle.digest('SHA-256',buffer),actual=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(actual!==message.hash){const changed=Error('课件在读取期间发生变化，请重新加载');changed.sourceChanged=true;throw changed;}if(task!==generation)return;}
   status('正在加载课件字体…');
   const fontUrl=new URL(message.fontUrl||url,location.origin);fontUrl.pathname=fontUrl.pathname.replace(/preview-source$/,'preview-fonts');if(fontUrl.origin!==location.origin||!/^\/api\/projects\/[^/]+\/preview-fonts$/.test(fontUrl.pathname))throw Error('无效字体清单地址');
   let fontFaces=[];try{const response=await fetch(fontUrl,{signal:abort.signal});if(!response.ok)throw Error('字体清单读取失败');const manifest=await response.json();const loaded=await Promise.all(manifest.faces.map(async face=>{const response=await fetch('/api/preview-font/'+face.id,{signal:abort.signal});if(!response.ok)throw Error(face.family);const source=await response.arrayBuffer();const probe=new FontFace(face.family,source,face.descriptors);await probe.load();document.fonts.add(probe);ownedFonts.push(probe);return {family:face.family,source,descriptors:face.descriptors};}));fontFaces=loaded;if(manifest.missing.length)warnings.push('本机缺少课件字体：'+manifest.missing.slice(0,6).join('、')+'；这些文字可能使用替代字体');}catch(e){if(e.name==='AbortError')throw e;warnings.push('原课件字体未完整加载：'+e.message+'；可切换 PDF 核对');}if(task!==generation)return;fontWarnings=[...warnings];slide.dataset.loadedFontFamilies=JSON.stringify([...new Set(fontFaces.map(f=>f.family))]);
   status('正在解析课件结构…');const parts=await parseZipLazyMedia(buffer,RECOMMENDED_ZIP_LIMITS);if(task!==generation)return;const model=buildPresentation(parts,{lazySlides:true});nativeWidth=model.width;nativeHeight=model.height;slide.style.width=nativeWidth+'px';slide.style.height=nativeHeight+'px';fit();viewer=new PptxViewer(slide,{fontFaces,fitMode:'none',width:nativeWidth,externalMedia:'block',zipLimits:RECOMMENDED_ZIP_LIMITS,lazySlides:true,lazyMedia:true,pdfjs:{moduleUrl:'/vendor/pdfjs/pdf.mjs?build=legacy-6.4.299',workerUrl:'/vendor/pdfjs/pdf.worker.mjs?build=legacy-6.4.299'},onNodeError:(_id,e)=>{if(warnings.length<8)warnings.push(String(e?.message||e));}});
   const active=viewer;active.load(model);
   if(!active.slideCount)throw Error('课件没有可显示的页面。');currentPage=Math.min(currentPage,active.slideCount-1);status('正在绘制第 '+(currentPage+1)+' 页…');await active.renderSlide(currentPage);await settle();if(task!==generation)return;
   state.textContent='';slide.style.visibility='visible';emit({ready:true,...metadata()});
  }catch(e){if(task===generation&&e.name!=='AbortError')status('课件无法显示：'+e.message,{error:e.message,sourceChanged:!!e.sourceChanged});}
 }else if(message.ticket===ticket&&message.action==='page'&&viewer)navigate(message.pageIndex);
 else if(message.ticket===ticket&&message.action==='dispose'){generation++;abort?.abort();viewer?.destroy();clearFonts();viewer=null;slide.replaceChildren();}
});
parent.postMessage({type:'classroom-pptx',handshake:true},location.origin);
