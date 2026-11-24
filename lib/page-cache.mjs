import {checkCoverage,sameImages} from './ppt-quality.mjs';
export {sameImages};
import {readFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {json,save,atomic} from './core.mjs';
import {contentHash} from './materials.mjs';
import {sourcePath} from './storage.mjs';
import {zipEntries} from './zip.mjs';
import {semaphore} from './concurrency.mjs';
import {launchRenderer,browserExecutable} from './browser-render.mjs';

// One disk image per page, shared by visual requests and the reader. No LLM
// calls here. A per-material worker coalesces concurrent requests for pages.
export function pageCacheService({root,previews,fonts,render=launchRenderer}){
 const resources=new Map(),running=new Map(),renderGate=semaphore(2),originals=new Map();let code,codeStamp='';
 const identity=(dir,f)=>dir+'|'+f.id;
 function eligibleForSmallerImage(seed,image){
  const text=seed.nativeText?.trim()||'';
  return image.length>180000&&text.length>=20&&text.length<=500&&text.split('\n').length<=12&&
   !seed.warnings?.length&&!seed.integrity?.textIssues?.length&&
   !/[∑∫√≤≥±]|\b(?:figure|chart|diagram|equation|formula|table)\b|图表|公式|表格/i.test(text);
 }
 async function describe(dir,f,settings={}){
  const original=sourcePath(dir,f.stored),info=await stat(original),signature=info.size+':'+info.mtimeMs+':'+info.ctimeMs;let stored=originals.get(original);
  if(stored?.signature!==signature){const bytes=await readFile(original);stored={signature,bytes,hash:contentHash(bytes)};originals.set(original,stored);if(originals.size>2)originals.delete(originals.keys().next().value);}const {bytes,hash}=stored;
  let kind=/\.pptx$/i.test(f.name)?'pptx':'pdf',fileBytes=bytes,basis=kind;
  const associated=f.role==='ppt'?await previews.status(dir,f):null;
  // A preview PDF (made by PowerPoint, LibreOffice or linked by the user) is drawn instead of the
  // built-in approximation; with PowerPoint's own slide images, those are the page images.
  const slides=associated?.status==='ready'&&!associated.direct&&!!associated.slides;
  if(associated?.status==='ready'&&!associated.direct){fileBytes=(await previews.pdf(dir,f)).bytes;kind='pdf';basis='associated-pdf:'+contentHash(fileBytes)+(slides?':powerpoint-png:'+associated.slideWidth+':'+associated.generated:'');}
  if(/\.ppt$/i.test(f.name)&&associated?.status!=='ready')throw Error('旧版 PPT 请先关联包含全部页面的 PDF，或另存为 PPTX。');
  const assets=['public/parse-render.js','public/parse-render.html','public/pptx-frame.js','public/pptx-frame.html','public/render-audit.js','public/vendor/pptx-renderer/renderer.mjs','public/vendor/pptx-renderer/table-layout.mjs','lib/browser-render.mjs'];
  const stamp=JSON.stringify(await Promise.all(assets.map(async n=>{const s=await stat(path.join(root,n));return [n,s.size,s.mtimeMs,s.ctimeMs];})));
  if(!code||stamp!==codeStamp){code=await Promise.all(assets.map(async n=>contentHash(await readFile(path.join(root,n)))));codeStamp=stamp;}
  const fontKey=fonts?await fonts.fingerprint(bytes,/\.pptx$/i.test(f.name)):'';
  let browserVersion='auto';try{const executable=await browserExecutable(settings.browserPath),s=await stat(executable);browserVersion=executable+':'+s.size+':'+s.mtimeMs;}catch{browserVersion=settings.browserPath||'auto';}
  const renderKey=contentHash(JSON.stringify({hash,basis,code,fontKey,browserVersion,format:'native-layout-hidpi-v2'})),cache=path.join(dir,'.Cache','Pages',f.id);
  // renderKey decides whether the cached page images can be reused, so it includes the drawing code
  // and the browser. imageKey decides whether results made from the images (guides, checkpoints) are
  // still about the same pictures: pages drawn exactly (PowerPoint's own images, or a PDF) depend only
  // on the original and how it is drawn, not on Edge updates or changes to the drawing code.
  const exact=kind==='pdf',imageKey=exact?contentHash(JSON.stringify({hash,basis,image:'exact-v1'})):renderKey;
  return {bytes,fileBytes,hash,kind,basis,renderBasis:basis,renderKey,imageKey,exact,cache,slides};
 }
 async function validPage(d,index,modelImages=false){
  const base=path.join(d.cache,'page-'+(index+1));
  const seed=await json(base+'.json',null);
  if(seed?.renderKey!==d.renderKey||modelImages&&!seed.modelImageChecked)return null;
  try{
   await stat(base+'.png');
   if(modelImages&&seed.hasModelImage)await stat(base+'.model.png');
   return seed;
  }catch(e){if(e.code!=='ENOENT')throw e;return null;}
 }
 async function ensure(dir,f,settings,{origin,indices=null,signal,onInventory,onPage=async()=>{}}={}){
  signal?.throwIfAborted();const d=await describe(dir,f,settings),manifest=await json(path.join(d.cache,'manifest.json'),null);
  const modelImages=!!onInventory&&settings.compactPptImages===true;
  if(indices?.some(i=>!Number.isInteger(i)||i<0||i>=2000))throw Error('无效页面编号。');
  if(manifest?.renderKey===d.renderKey){
   const wanted=indices||Array.from({length:manifest.pages},(_,i)=>i);
   if(wanted.some(i=>i>=manifest.pages))throw Error('页面超出课件范围。');
   const seeds=await Promise.all(wanted.map(i=>validPage(d,i,modelImages)));
   if(seeds.every(Boolean)){
    const ready={...manifest,cache:d.cache,imageKey:d.imageKey,exact:d.exact};
    if(onInventory&&!indices)onInventory({...ready,inventory:seeds,cached:true});
    return ready;
   }
  }
  const k=identity(dir,f),previous=running.get(k);
  if(previous){if(previous.accepting&&previous.renderKey===d.renderKey){if(indices)indices.forEach(i=>previous.pending.add(i));else previous.all=true;}await previous.promise;signal?.throwIfAborted();return ensure(dir,f,settings,{origin,indices,signal,onInventory,onPage});}
  const entry={renderKey:d.renderKey,pending:new Set(indices||[]),all:!indices,accepting:true};
  const work=renderGate.run(async()=>{
   signal?.throwIfAborted();
   let browser,token;await mkdir(d.cache,{recursive:true});
   try{
    const nativeParts=/\.pptx$/i.test(f.name)?Object.fromEntries(zipEntries(d.bytes,n=>/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/.test(n)).map(e=>[e.name,e.bytes.toString('utf8')])):{};
    token=randomUUID();resources.set(token,{bytes:d.fileBytes,nativeParts});
    browser=await render(origin,settings,signal);const base=origin+'/api/parse-resource/'+token;
    const info=await browser.open({kind:d.kind,url:base+'/file',nativeUrl:base+'/native',fontUrl:origin+'/api/projects/'+encodeURIComponent(path.basename(dir))+'/preview-fonts?source='+encodeURIComponent(f.id),hash:d.kind==='pptx'?d.hash:undefined,collectInventory:!!onInventory,externalImages:d.slides});
    if(!Number.isInteger(info.pages)||info.pages<1||info.pages>2000)throw Error('材料页数无效。');
    if(d.kind==='pdf'&&/\.pptx$/i.test(f.name)&&(await import('./ppt-count.mjs')).pptxSlideCount(d.bytes)!==info.pages)throw Error('关联 PDF 页数与 PPTX 不符，请包含隐藏页。');
    const value={schema:'classroom.page-cache.v1',sourceHash:d.hash,renderKey:d.renderKey,renderBasis:d.basis,pages:info.pages,generated:new Date().toISOString()};
    if(onInventory&&info.inventory?.length===info.pages)onInventory({...value,cache:d.cache,imageKey:d.imageKey,exact:d.exact,inventory:info.inventory});
    const done=new Set();for(;;){if(entry.all)for(let i=0;i<info.pages;i++)if(!done.has(i))entry.pending.add(i);const wanted=[...entry.pending].filter(i=>!done.has(i));entry.pending.clear();if(!wanted.length){entry.accepting=false;break;}if(wanted.some(i=>i>=info.pages))throw Error('页面超出课件范围。');
    for(const i of wanted){signal?.throwIfAborted();if(!await validPage(d,i,modelImages)){
     const page=await browser.page(i);let {image,external,...seed}=page;
     // The page image is PowerPoint's own when it exported one (the PDF page is then not drawn at all);
     // text checks still come from the PDF page.
     if(d.slides){
      const exported=await previews.slideImage(dir,f,i),png=exported?await readFile(exported).catch(()=>null):null;
      if(!png)throw Error('PowerPoint 导出的原页图片缺失，请重新生成原页。');
      image='data:image/png;base64,'+png.toString('base64');seed.width=png.readUInt32BE(16);seed.height=png.readUInt32BE(20);seed.drawnBy='PowerPoint';
     }
     if(!/^data:image\/png;base64,/.test(image||''))throw Error('页面未生成有效 PNG。');if(seed.integrity?.geometry?.complete===false)throw Error('页面导出不完整，未保存缓存。');
     if(seed.integrity?.renderedText!==undefined){seed.domCoverage=checkCoverage(seed.nativeText,seed.integrity.renderedText);if(seed.domCoverage.missingCount)seed.warnings=[...(seed.warnings||[]),seed.domCoverage.missingCount+' 段原生文字候选未在页面渲染文本中匹配，需核对是否隐藏或渲染遗漏'];}
     if(/\.ppt$/i.test(f.name))seed.warnings=[...(seed.warnings||[]),'旧 PPT 使用关联 PDF，备注和隐藏页状态未核验。'];
     await atomic(path.join(d.cache,'page-'+(i+1)+'.png'),Buffer.from(image.split(',')[1],'base64'));
     if(modelImages){
      seed.modelImageChecked=true;
      const smaller=eligibleForSmallerImage(seed,image)?await browser.modelImage?.(image).catch(()=>null):null;
      if(smaller?.startsWith('data:image/png;base64,')){
       await atomic(path.join(d.cache,'page-'+(i+1)+'.model.png'),Buffer.from(smaller.split(',')[1],'base64'));
       seed.hasModelImage=true;
      }
     }
     await save(path.join(d.cache,'page-'+(i+1)+'.json'),{...seed,sourceHash:d.hash,renderKey:d.renderKey});
    }done.add(i);await onPage(i,info.pages);}}
    if(contentHash(await readFile(sourcePath(dir,f.stored)))!==d.hash)throw Error('原件在生成预览期间变化，请重试。');
    await save(path.join(d.cache,'manifest.json'),value);return {...value,cache:d.cache,imageKey:d.imageKey,exact:d.exact};
   }finally{await browser?.close().catch(()=>{});if(token)resources.delete(token);}
  });entry.promise=work;running.set(k,entry);try{return await work;}finally{if(running.get(k)===entry)running.delete(k);}
 }
 return {ensure,describe,resource:token=>resources.get(token),busy:dir=>[...running.keys()].some(k=>k.startsWith(dir+'|')),
  async page(dir,f,settings,options){const index=options.index,manifest=await ensure(dir,f,settings,{...options,indices:[index]}),seed=await json(path.join(manifest.cache,'page-'+(index+1)+'.json'),null);return {...manifest,seed,bytes:await readFile(path.join(manifest.cache,'page-'+(index+1)+'.png'))};}};
}
