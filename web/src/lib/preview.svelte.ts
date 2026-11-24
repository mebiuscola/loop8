// Original-page preview of one courseware file: which way pages are drawn, and the PDF
// preview behind the "pdf" mode (converted, linked by the user, or the courseware itself).
import {api,ApiError,type PreviewStatus} from './api';
import {openPdf,type PdfDoc} from './pdf';
import type {PreviewMode} from '../components/read/OriginalPage.svelte';

const KEY='classroom.next.previewMode';
const saved=():Record<string,PreviewMode>=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}');}catch{return {};}};

export class CoursePreview{
 mode=$state<PreviewMode>('cached');
 status=$state<PreviewStatus|null>(null);
 error=$state('');
 busy=$state(false);
 /** Bumped to redraw every page (e.g. after linking a new PDF). */
 reload=$state(0);
 pdf=$state<Promise<PdfDoc>|null>(null);
 pptx=$state<Promise<ArrayBuffer>|null>(null);
 private closePdf=()=>{};
 private timer:ReturnType<typeof setTimeout>|undefined;
 /** Called when a conversion (e.g. PowerPoint drawing the slides) has finished or failed. */
 onsettled:()=>void=()=>{};

 constructor(readonly projectId:string,readonly sourceId:string,readonly fileName:string){
  const m=saved()[sourceId];
  // The live view drew with the same built-in approximation as the page images, so it is gone;
  // a saved choice of it shows the page images.
  this.mode=m==='browser'?'cached':m||'cached';
  this.refresh().then(()=>this.apply());
 }
 /** The live view draws PPTX only. */
 get isPptx(){return /\.pptx$/i.test(this.fileName);}
 get pdfReady(){return this.status?.status==='ready';}

 async refresh(){
  const was=this.status?.status;
  try{this.status=await api.previewStatus(this.projectId,this.sourceId);this.error='';}
  catch(e){this.error=e instanceof ApiError?e.message:String(e);}
  // Follow a conversion while it runs.
  clearTimeout(this.timer);
  if(this.status&&['queued','running'].includes(this.status.status))this.timer=setTimeout(()=>this.refresh().then(()=>this.apply()),2500);
  else if(was&&['queued','running'].includes(was))this.onsettled();
 }

 setMode(mode:PreviewMode){
  this.mode=mode;
  const all=saved();all[this.sourceId]=mode;try{localStorage.setItem(KEY,JSON.stringify(all));}catch{/* private mode */}
  this.apply();
 }

 /** Opens what the current mode needs, and nothing else. */
 private apply(){
  if(this.mode==='pdf'&&this.pdfReady&&!this.pdf){
   const opened=openPdf(api.previewFileUrl(this.projectId,this.sourceId));
   this.pdf=opened.then(o=>o.doc);
   opened.then(o=>this.closePdf=()=>{o.cancel();o.doc.destroy();},()=>{});
  }
  if(this.mode!=='pdf'&&this.pdf){this.closePdf();this.closePdf=()=>{};this.pdf=null;}
  if(this.mode==='browser'&&!this.pptx){
   this.pptx=fetch(api.previewSourceUrl(this.projectId,this.sourceId)).then(r=>{if(!r.ok)throw new Error('无法读取 PPT 原件。');return r.arrayBuffer();});
  }
  if(this.mode!=='browser')this.pptx=null;
 }

 private resetPdf(){this.closePdf();this.closePdf=()=>{};this.pdf=null;}
 private async act(task:()=>Promise<unknown>){
  this.busy=true;this.error='';
  try{await task();this.resetPdf();await this.refresh();this.apply();this.reload++;}
  catch(e){this.error=e instanceof ApiError?e.message:String(e);}
  finally{this.busy=false;}
 }
 /** Converts the courseware to PDF in the background (engine chosen in settings). */
 convert(force=false){return this.act(()=>api.previewEnsure(this.projectId,this.sourceId,force));}
 associate(file:File){return this.act(async()=>{await api.previewAssociate(this.projectId,this.sourceId,file);this.mode='pdf';this.setMode('pdf');});}
 clear(){return this.act(async()=>{await api.previewClear(this.projectId,this.sourceId);if(this.mode==='pdf')this.setMode('cached');});}
 redraw(){this.resetPdf();this.apply();this.reload++;}

 destroy(){clearTimeout(this.timer);this.resetPdf();this.pptx=null;}
}
