import {auditSlide} from './render-audit.js';
import {getDocument,GlobalWorkerOptions} from '/vendor/pdfjs/pdf.mjs?build=legacy-6.4.299';
GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs?build=legacy-6.4.299';
let config,frame,pdf,meta,ticket,inventory=[];
function xml(text){const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('PPT XML 无法读取');return d;}
const els=(d,name)=>[...d.getElementsByTagNameNS('*',name)];
function texts(d){return els(d,'p').map(p=>els(p,'t').map(t=>t.textContent).join('')).filter(Boolean);}
function resolve(part,target){return new URL(target,'http://local/'+part).pathname.slice(1);}
function nativeInventory(parts){
 const rels=els(xml(parts['ppt/_rels/presentation.xml.rels']),'Relationship');
 return els(xml(parts['ppt/presentation.xml']),'sldId').map(id=>{
  const rid=id.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),rel=rels.find(r=>r.getAttribute('Id')===rid);if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('PPT 页序关系无效');
  const name=resolve('ppt/presentation.xml',rel.getAttribute('Target')),d=xml(parts[name]);const relName=name.replace(/([^/]+)$/,'_rels/$1.rels');let notes='';
  if(parts[relName]){const nr=els(xml(parts[relName]),'Relationship').find(r=>/\/notesSlide$/.test(r.getAttribute('Type'))&&r.getAttribute('TargetMode')!=='External');if(nr){const nd=xml(parts[resolve(name,nr.getAttribute('Target'))]);for(const shape of els(nd,'sp')){const ph=els(shape,'ph')[0];if(['sldImg','sldNum','hdr','ftr','dt'].includes(ph?.getAttribute('type')))continue;notes+=texts(shape).join('\n')+'\n';}}}
  return {hidden:d.documentElement.getAttribute('show')==='0',nativeText:texts(d).join('\n'),speakerNotes:notes.trim()};
 });
}
function waitPage(action){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('幻灯片渲染超时'));},110000);const cleanup=()=>{clearTimeout(timer);removeEventListener('message',receive);};const receive=e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow||e.data.ticket!==ticket)return;if(e.data.error){cleanup();reject(Error(e.data.error));}else if(e.data.ready){cleanup();meta=e.data;resolve(meta);}};addEventListener('message',receive);action();});}
window.materialRenderer={
 async open(value){config=value;inventory=[];document.querySelector('iframe')?.remove();document.querySelector('canvas')?.remove();if(pdf)await pdf.destroy();pdf=null;
  if(config.kind==='pptx'){
   const response=await fetch(config.nativeUrl);if(!response.ok)throw Error('无法读取 PPT 原生结构');inventory=nativeInventory(await response.json());ticket=crypto.randomUUID();frame=document.createElement('iframe');frame.src='/pptx-frame.html';frame.style.height='900px';document.body.append(frame);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('课件渲染框架加载超时')),15000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.onerror=()=>{clearTimeout(timer);reject(Error('课件渲染框架加载失败'));};});
   await waitPage(()=>frame.contentWindow.postMessage({type:'classroom-reader',action:'open',ticket,url:config.url,fontUrl:config.fontUrl,hash:config.hash,pageIndex:0,nativeLayout:true},location.origin));
   if(meta.pages!==inventory.length)throw Error('渲染页数与 PPT 原始页序不符');return {pages:meta.pages,inventory};
  }
  if(config.nativeUrl){const parts=await (await fetch(config.nativeUrl)).json();if(parts['ppt/presentation.xml'])inventory=nativeInventory(parts);}
  pdf=await getDocument({url:config.url,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false}).promise;
  if(inventory.length&&inventory.length!==pdf.numPages)throw Error('关联 PDF 与 PPT 原始页数不同');
  if(config.collectInventory&&!inventory.length){
   for(let number=1;number<=pdf.numPages;number++){
    const page=await pdf.getPage(number);
    inventory.push({nativeText:await pdfText(page),speakerNotes:'',hidden:false});
   }
  }
  return {pages:pdf.numPages,inventory};
 },
 async modelImage(image){
  const bitmap=new Image();
  bitmap.src=image;
  await bitmap.decode();
  const scale=Math.min(1,1800/Math.max(bitmap.naturalWidth,bitmap.naturalHeight));
  if(scale===1)return null;
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(bitmap.naturalHeight*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  const smaller=canvas.toDataURL('image/png');
  return smaller.length<image.length?smaller:null;
 },
 async page(index){
  if(config.kind==='pptx'){
   if(meta.pageIndex!==index)await waitPage(()=>frame.contentWindow.postMessage({type:'classroom-reader',action:'page',ticket,pageIndex:index},location.origin));
   const width=meta.width,height=meta.height;frame.style.width=width+'px';frame.style.height=height+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const integrity=auditSlide(frame.contentDocument,width,height),warnings=[...(meta.warnings||[])];
   if(!integrity.geometry.complete)throw Error('页面容器裁切或尺寸不一致，已停止导出，请核对渲染环境。');
   if(integrity.textIssues.length)warnings.push(integrity.textIssues.length+' 个文字区域可能裁切或超出页面，需核对原件');
   if(integrity.failedImages.length)warnings.push(integrity.failedImages.length+' 张图片未加载完成，不能视为完整页面');
   return {width,height,pixelRatio:Math.min(2,3200/Math.max(width,height)),warnings,integrity,...inventory[index]};
  }
  // PowerPoint's own slide images replace the page image, so only the text is read from the PDF.
  if(config.externalImages){const page=await pdf.getPage(index+1);return {integrity:{schema:'classroom.render-audit.v1',geometry:{complete:true},textIssues:[],failedImages:[]},image:'',external:true,width:0,height:0,warnings:[],...(inventory[index]||{nativeText:await pdfText(page),speakerNotes:'',hidden:false})};}
  const page=await pdf.getPage(index+1),base=page.getViewport({scale:1}),scale=Math.min((config.detail?3200:2400)/Math.max(base.width,base.height),config.detail?3.5:2.5),viewport=page.getViewport({scale});
  let canvas=document.querySelector('canvas');if(!canvas){canvas=document.createElement('canvas');document.body.append(canvas);}canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  const native=inventory[index]||{nativeText:await pdfText(page),speakerNotes:'',hidden:false};
  return {integrity:{schema:'classroom.render-audit.v1',geometry:{complete:true},textIssues:[],failedImages:[]},image:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,warnings:[],...native};
 }
};
async function pdfText(page){
 const {items}=await page.getTextContent();
 return items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
}
