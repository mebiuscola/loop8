// Reads the text a PDF already carries (its text layer) with the vendored pdf.js, so born-digital
// readings need no upload and no MinerU quota. Scanned pages have no usable text layer; when too
// many pages lack one (or the text is garbled), the caller falls back to MinerU for the whole file.
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {contentListDocument} from './materials.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let lib=null;
async function pdfjs(){
 // pdf.js reports missing optional canvas support while loading in Node; text reading needs none of it.
 lib??=(async()=>{
  const {log,warn}=console;console.log=console.warn=()=>{};
  try{
   const m=await import(pathToFileURL(path.join(ROOT,'public','vendor','pdfjs','pdf.mjs')).href);
   m.GlobalWorkerOptions.workerSrc=pathToFileURL(path.join(ROOT,'public','vendor','pdfjs','pdf.worker.mjs')).href;
   return m;
  }finally{console.log=log;console.warn=warn;}
 })();
 return lib;
}

const BROKEN=/[�-]/gu;           // replacement and private-use characters: a broken font encoding
const NUMBER=/^(?:\d{1,4}|[ivxlcdm]{1,7})$/i;     // a printed page number (arabic or roman)
const median=values=>{const v=[...values].sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:0;};

/**
 * One page's text items as blocks. Lines are items on one baseline (a small raised footnote mark
 * stays on its line). Running headers, footers and the printed page number at the page edges are
 * set apart from the body. Body lines become paragraphs at a blank line, a first-line indent, a
 * short sentence-final line, a change of type size, or a jump to another column. Small type at the
 * bottom of the page is kept as footnotes; very small type elsewhere (figure labels) as one aside.
 */
export function pageBlocks(items,width,height){
 const parts=items.filter(i=>typeof i.str==='string').map(i=>({str:i.str,x:i.transform[4],y:i.transform[5],size:Math.abs(i.transform[3])||i.height||10,eol:!!i.hasEOL}));
 // Body size: the type size carrying the most characters (many tiny chart labels must not win).
 const weight=new Map();for(const p of parts){const n=p.str.trim().length;if(n){const k=Math.round(p.size*2)/2;weight.set(k,(weight.get(k)||0)+n);}}
 const body=[...weight].sort((a,b)=>b[1]-a[1])[0]?.[0]||10;
 const lines=[];let line=null;
 for(const p of parts){
  const mark=line&&p.size<body*0.75&&Math.abs(p.y-line.y)<body*0.8;
  if(!line||(!mark&&Math.abs(line.y-p.y)>Math.min(line.size,p.size)*0.5)){line={y:p.y,x:p.x,size:p.str.trim()?p.size:0,text:''};lines.push(line);}
  else if(!mark&&p.str.trim())line.size=Math.max(line.size,p.size);
  if(!line.text.trim()&&p.str.trim())line.x=p.x;
  line.text+=p.str;
  if(p.eol)line=null;
 }
 const kept=lines.map(l=>({...l,size:l.size||body,text:l.text.replace(/\s+/g,' ').trim()})).filter(l=>l.text);

 let pageNumber=null;const blocks=[],content=[],labels=[];
 for(const l of kept){
  const top=l.y>height*0.91,bottom=l.y<height*0.07,words=l.text.split(' ');
  if((top||bottom)&&l.size<body*0.75){blocks.push({type:'discarded',text:l.text});continue;}   // stamps, download notes
  if((top||bottom)&&NUMBER.test(l.text)){pageNumber??=l.text;continue;}
  const numbered=NUMBER.test(words[0])?words[0]:NUMBER.test(words.at(-1))?words.at(-1):null;
  if(numbered&&(top&&words.length<=14||bottom&&words.length<=6)){pageNumber??=numbered;blocks.push({type:top?'header':'footer',text:l.text});continue;}
  // Very small type inside the page (chart and figure labels) is kept together, apart from the prose.
  if(l.size<body*0.7){labels.push(l.text);continue;}
  content.push(l);
 }

 // Usual line spacing and full line length come from prose lines only, so chart labels or a
 // table on the same page do not make ordinary lines look like paragraph breaks.
 const prose=l=>l.text.length>20&&Math.abs(l.size-body)<body*0.15;
 const usual=median(content.slice(1).map((l,i)=>prose(l)&&prose(content[i])?content[i].y-l.y:0).filter(g=>g>0))||body*1.2;
 const full=median(content.filter(prose).map(l=>l.text.length))||median(content.map(l=>l.text.length));
 let para=null;
 const close=()=>{if(!para)return;const small=median(para.sizes)<body*0.92&&para.y<height*0.4;blocks.push({type:small?'page_footnote':'text',text:para.text});para=null;};
 content.forEach((l,i)=>{
  const prev=content[i-1],next=content[i+1];
  if(prev){
   const gap=prev.y-l.y,sameColumn=Math.abs(l.x-prev.x)<width*0.25;
   // An indented line starts a paragraph when the line after it returns to the margin
   // (a hanging indent, as in a bibliography, keeps its lines together).
   const indented=sameColumn&&l.x>prev.x+body*0.6&&(!next||Math.abs(next.x-prev.x)<body*0.3);
   if(gap<=0||gap>usual*1.45||!sameColumn&&gap>usual*0.5||indented
    ||prev.text.length<full*0.7&&/[.!?:;"”’)\]]$/.test(prev.text)
    ||Math.abs(l.size-prev.size)>body*0.15)close();
  }
  if(!para)para={text:l.text,sizes:[l.size],y:l.y};
  else{
   // Join a word broken across lines ("compar-" + "ison"); keep real hyphens before capitals.
   para.text=/[a-z]-$/.test(para.text)&&/^[a-z]/.test(l.text)?para.text.slice(0,-1)+l.text:para.text+' '+l.text;
   para.sizes.push(l.size);para.y=l.y;
  }
 });
 close();
 if(labels.length)blocks.push({type:'aside_text',text:labels.join(' ')});
 return {blocks,pageNumber};
}

/** Reads every page's text layer: blocks, the printed page number, and how readable the text is. */
export async function readTextLayer(bytes){
 const m=await pdfjs();
 const task=m.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,verbosity:0});
 try{
  const doc=await task.promise,pages=[];
  for(let i=0;i<doc.numPages;i++){
   const page=await doc.getPage(i+1),view=page.getViewport({scale:1});
   const {blocks,pageNumber}=pageBlocks((await page.getTextContent()).items,view.width,view.height);
   const text=blocks.filter(b=>b.type==='text'||b.type==='page_footnote').map(b=>b.text).join('\n');
   const letters=(text.match(/[\p{L}\p{N}]/gu)||[]).length,broken=(text.match(BROKEN)||[]).length;
   pages.push({pageIndex:i,blocks,pageNumber,letters,garbled:broken>Math.max(2,letters*0.02)});
   page.cleanup();
  }
  return pages;
 }finally{await task.destroy().catch(()=>{});}
}

/**
 * Whether the text layer can replace MinerU. Not when any page's text is garbled (a broken font
 * encoding), and not when more than a few pages have no text at all — that is a scan. A few
 * textless pages (blank pages, full-page figures) are fine in an otherwise born-digital file.
 */
export function textLayerSufficient(pages){
 if(!pages.length||pages.some(p=>p.garbled))return false;
 const withoutText=pages.filter(p=>!p.letters).length,letters=pages.reduce((n,p)=>n+p.letters,0);
 return letters>=200&&withoutText<=Math.max(1,Math.floor(pages.length*0.1));
}

/** The standard block document built from the text layer, in the same shape MinerU results use. */
export function textLayerDocument(pages,source){
 const list=[];
 for(const p of pages){
  for(const b of p.blocks)list.push({type:b.type,text:b.text,page_idx:p.pageIndex});
  if(p.pageNumber)list.push({type:'page_number',text:p.pageNumber,page_idx:p.pageIndex});
 }
 const doc=contentListDocument(list,source);
 doc.provenance='pdf-text-layer';
 doc.textLayer={pages:pages.length,withoutText:pages.filter(p=>!p.letters).map(p=>p.pageIndex+1)};
 return doc;
}
