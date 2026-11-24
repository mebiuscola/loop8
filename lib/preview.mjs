import {readFile,mkdir,stat,access,unlink,rm,mkdtemp,rename,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {atomic,save,json} from './core.mjs';
import {contentHash} from './materials.mjs';
import {sourcePath} from './storage.mjs';
import {semaphore} from './concurrency.mjs';
import {pptxSlideCount} from './ppt-count.mjs';
const {PDFDocument}=createRequire(import.meta.url)('../vendor/pdf-lib.cjs');
export async function pdfInfo(bytes){try{const doc=await PDFDocument.load(bytes,{updateMetadata:false});const pages=doc.getPageCount();if(!pages)throw Error();return {pages};}catch{throw Error('无法读取预览 PDF；请使用未加密且完整的 PDF。');}}
function command(executable,args,timeout=120000){return new Promise((resolve,reject)=>{
 const child=spawn(executable,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let output='',error='',timed=false;
 const timer=setTimeout(()=>{timed=true;child.kill();},timeout);
 child.stdout.on('data',b=>output=(output+b).slice(-4000));child.stderr.on('data',b=>error=(error+b).slice(-4000));
 child.on('error',()=>{clearTimeout(timer);reject(Error('未找到可用转换程序。'));});child.on('close',code=>{clearTimeout(timer);if(timed)reject(Error('预览转换超过 '+Math.round(timeout/60000)+' 分钟；可关联手动导出的 PDF。'));else if(code!==0){const reason=error.split(/\r?\n/).map(l=>l.trim()).find(l=>l&&!/^(At |\+|CategoryInfo|FullyQualifiedErrorId)/.test(l))||'';reject(Error('转换程序未能导出 PDF'+(reason?'（'+reason.slice(0,200)+'）':'')+'；请检查本机安装或关联手动导出的 PDF。'));}else resolve(output);});
 });}
async function available(file){try{await access(file);return true;}catch{return false;}}
/** Slide images are drawn by PowerPoint at this width (height follows the slide size). */
export const SLIDE_WIDTH=1920;
/**
 * Makes the preview PDF of a PPT/PPTX. With PowerPoint, every slide (hidden ones included) is also
 * exported as a PNG into slidesDir: these are the slide images shown and sent to models, so they
 * look exactly as in PowerPoint. The deck is opened from a copy, read-only and without a window.
 */
export async function convertPreview({source,dest,temp,root,settings,slidesDir}){
 const mode=settings.previewEngine||'auto',failures=[];
 if(mode==='manual')throw Error('已选择手动预览，请关联从原始 PPT 导出的 PDF（包括隐藏页）。');
 if(['auto','powerpoint'].includes(mode)){
  if(process.platform==='win32')try{
   const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),copy=path.join(temp,'deck'+path.extname(source).toLowerCase());
   await copyFile(source,copy);
   // Bypass applies to this one run only: Windows blocks unsigned scripts by default, and this one ships with the app.
   await command(exe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'resources','export-preview.ps1'),'-InputPath',copy,'-OutputPath',dest,...(slidesDir?['-SlidesDir',slidesDir,'-Width',String(SLIDE_WIDTH)]:[])],10*60000);
   return 'PowerPoint';
  }catch(e){failures.push('PowerPoint：'+e.message);}
  else failures.push('PowerPoint 仅支持 Windows。');
 }
 if(['auto','libreoffice'].includes(mode)){
  const candidates=[settings.libreOfficePath,...['ProgramFiles','ProgramFiles(x86)'].map(k=>process.env[k]&&path.join(process.env[k],'LibreOffice','program','soffice.exe'))].filter(Boolean);
  let executable;for(const file of candidates)if(await available(file)){executable=file;break;}
  if(!executable)try{const list=await command(process.platform==='win32'?'where.exe':'which',['soffice']);executable=list.trim().split(/\r?\n/)[0];}catch{}
  if(executable)try{
   const out=path.join(temp,'lo-output');await mkdir(out,{recursive:true});
   await command(executable,['-env:UserInstallation='+pathToFileURL(path.join(temp,'lo-profile')).href,'--headless','--convert-to','pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}','--outdir',out,source]);
   const pdf=path.join(out,path.basename(source,path.extname(source))+'.pdf');await atomic(dest,await readFile(pdf));return 'LibreOffice';
  }catch(e){failures.push('LibreOffice：'+e.message);}else failures.push('未找到 LibreOffice。');
 }
 throw Error('当前无法自动生成预览。'+failures.join(' ')+' 可在设置中选择转换程序，或关联手动导出的 PDF（包括隐藏页）。');
}
export function previewService(root,{convert=convertPreview}={}){
 const gate=semaphore(1),jobs=new Map(),hashes=new Map();
 async function descriptor(dir,file){
  const source=sourcePath(dir,file.stored),s=await stat(source);let entry=hashes.get(source);
  if(!entry||entry.size!==s.size||entry.time!==s.mtimeMs){entry={hash:contentHash(await readFile(source)),size:s.size,time:s.mtimeMs};hashes.set(source,entry);}
  const hash=entry.hash,cache=path.join(dir,'.Cache','PPT'),key=dir+'|'+hash;return {source,hash,cache,key,pdf:path.join(cache,hash+'.pdf'),meta:path.join(cache,hash+'.json'),slides:path.join(cache,hash+'-slides')};
 }
 async function expectedCount(dir,file){if(/\.pptx$/i.test(file.name))return pptxSlideCount(await readFile(sourcePath(dir,file.stored)));if(file.parsed){const doc=await json(path.join(dir,'Parsed',file.parsed),null);if(doc?.externalPpt)return doc.pageCount;}return undefined;}
 async function inspectPdf(dir,file,bytes){const info=await pdfInfo(bytes),expected=await expectedCount(dir,file);if(expected&&expected!==info.pages)throw Error(`预览 PDF 有 ${info.pages} 页，原始 PPTX 有 ${expected} 页；请包含隐藏页后重新导出，避免页面错位。`);return info;}
 async function status(dir,file){const d=await descriptor(dir,file);
  if(/\.pdf$/i.test(file.name)){const info=await pdfInfo(await readFile(d.source));return {status:'ready',engine:'原始 PDF',hash:d.hash,pages:info.pages,direct:true};}
  const job=jobs.get(d.key);if(job&&['queued','running'].includes(job.status))return {...job,done:undefined,hash:d.hash};
  const meta=await json(d.meta,null);if(meta&&await available(d.pdf))return {status:'ready',...meta,warning:job?.status==='error'?job.error:undefined};
  return job?.status==='error'?{...job,done:undefined}:{status:'missing',hash:d.hash};
 }
 async function ensure(dir,file,settings,{force=false}={}){
  const existing=await status(dir,file);if(existing.direct||existing.status==='ready'&&!force||['queued','running'].includes(existing.status)||existing.status==='error'&&!force)return existing;
  const d=await descriptor(dir,file),running=jobs.get(d.key);if(running&&['queued','running'].includes(running.status))return {...running,done:undefined};const job={status:'queued',hash:d.hash,stage:'等待预览转换'};jobs.set(d.key,job);
  const done=gate.run(async()=>{
   job.status='running';job.stage='本机生成预览 PDF';await mkdir(d.cache,{recursive:true});const temp=await mkdtemp(path.join(d.cache,'convert-'));
   try{
    const output=path.join(temp,'preview.pdf'),slidesDir=path.join(temp,'slides'),engine=await convert({source:d.source,dest:output,temp,root,settings,slidesDir}),bytes=await readFile(output),info=await inspectPdf(dir,file,bytes);
    // PowerPoint's slide images, kept only when every slide is there and the count matches.
    const listed=await json(path.join(slidesDir,'slides.json'),null),slides=engine==='PowerPoint'&&listed?.count===info.pages;
    await rm(d.slides,{recursive:true,force:true});if(slides)await rename(slidesDir,d.slides);
    await atomic(d.pdf,bytes);const meta={hash:d.hash,pages:info.pages,engine,generated:new Date().toISOString(),...(slides?{slides:true,slideWidth:listed.width,slideHeight:listed.height}:{})};await save(d.meta,meta);Object.assign(job,meta,{status:'ready',stage:'预览已就绪'});
   }
   finally{const relative=path.relative(d.cache,temp);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))await rm(temp,{recursive:true,force:true});}
  }).catch(e=>{job.status='error';job.stage='需要关联预览 PDF';job.error=e.message;});job.done=done;return {...job,done:undefined};
 }
 async function associate(dir,file,bytes){const d=await descriptor(dir,file);if(['queued','running'].includes(jobs.get(d.key)?.status))throw Error('请等待当前预览转换结束后再关联 PDF。');if(/\.pdf$/i.test(file.name))throw Error('课件本身是 PDF，直接使用原件预览即可。');const info=await inspectPdf(dir,file,bytes);await rm(d.slides,{recursive:true,force:true});await atomic(d.pdf,bytes);const meta={hash:d.hash,pages:info.pages,engine:'手动关联 PDF',generated:new Date().toISOString()};await save(d.meta,meta);jobs.delete(d.key);return {status:'ready',...meta};}
 async function clear(dir,file){const d=await descriptor(dir,file);if(['queued','running'].includes(jobs.get(d.key)?.status))throw Error('预览仍在转换，请稍后清理。');for(const target of [d.pdf,d.meta])await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});await rm(d.slides,{recursive:true,force:true});jobs.delete(d.key);return {ok:true,direct:/\.pdf$/i.test(file.name)};}
 async function pdf(dir,file){const info=await status(dir,file);if(info.status!=='ready')throw Error('预览尚未就绪。');const d=await descriptor(dir,file);return {bytes:await readFile(info.direct?d.source:d.pdf),hash:d.hash};}
 /** PowerPoint's image of one slide (0-based), or null when this deck has none. */
 async function slideImage(dir,file,index){const info=await status(dir,file);if(info.status!=='ready'||!info.slides)return null;const d=await descriptor(dir,file);return path.join(d.slides,'slide-'+(index+1)+'.png');}
 /** Waits for a running or new conversion (started when missing); resolves with the final status, never throws. */
 async function settle(dir,file,settings){
  const first=await ensure(dir,file,settings);if(first.direct||first.status==='ready'||first.status==='error')return first;
  const d=await descriptor(dir,file);await jobs.get(d.key)?.done?.catch(()=>{});return status(dir,file);
 }
 return {status,ensure,settle,slideImage,associate,clear,pdf,busy:dir=>[...jobs].some(([key,job])=>key.startsWith(dir+'|')&&['queued','running'].includes(job.status))};
}
