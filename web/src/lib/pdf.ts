// Loads the vendored pdf.js (public/vendor/pdfjs) at run time; it is not bundled.
const BUILD='legacy-6.4.299';
let lib:Promise<any>|null=null;

function load(){
 lib??=import(/* @vite-ignore */ '/vendor/pdfjs/pdf.mjs?build='+BUILD).then(m=>{
  m.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs?build='+BUILD;
  return m;
 });
 return lib;
}

export interface PdfDoc{numPages:number;getPage(n:number):Promise<any>;destroy():Promise<void>;}

export async function openPdf(url:string):Promise<{doc:PdfDoc;cancel:()=>void}>{
 const pdfjs=await load();
 const task=pdfjs.getDocument({url,disableStream:true,disableAutoFetch:true,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,
  standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false});
 const doc=await task.promise;
 return {doc,cancel:()=>{task.destroy();}};
}

/** Draws one page to fit `width` CSS pixels; returns a cancel function. */
export function drawPage(doc:PdfDoc,pageIndex:number,canvas:HTMLCanvasElement,width:number){
 let renderTask:any=null,cancelled=false;
 const done=(async()=>{
  const page=await doc.getPage(pageIndex+1);if(cancelled)return;
  const base=page.getViewport({scale:1}),scale=width/base.width,ratio=window.devicePixelRatio||1;
  const viewport=page.getViewport({scale:scale*ratio});
  canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);
  canvas.style.width=Math.floor(viewport.width/ratio)+'px';canvas.style.height=Math.floor(viewport.height/ratio)+'px';
  renderTask=page.render({canvasContext:canvas.getContext('2d')!,viewport});
  await renderTask.promise;
 })();
 return {done,cancel:()=>{cancelled=true;renderTask?.cancel();}};
}
