import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {zipEntries} from './zip.mjs';
import {blockText} from './materials.mjs';
export async function pptPages(dir,file){
 const doc=JSON.parse(await readFile(path.join(dir,'Parsed',file.parsed),'utf8'));
 const found=new Map();for(const b of doc.blocks){const page=b.pageIndex;if(!found.has(page))found.set(page,[]);found.get(page).push(b);}
 let count=doc.pageCount||Math.max(0,...[...found.keys()].filter(Number.isInteger).map(n=>n+1));let countBasis=doc.externalPpt?(doc.externalPpt.originalSource.pageCountBasis||'Original page order recorded in imported PPT Skill report; report hash matched uploaded original'):'MinerU page indices; trailing blank pages cannot be confirmed';
 if(!doc.externalPpt&&/\.pptx$/i.test(file.name)){
  try{const slides=zipEntries(await readFile(path.join(dir,'Source',file.stored)),n=>/^ppt\/slides\/slide\d+\.xml$/i.test(n));if(slides.length){count=Math.max(count,slides.length);countBasis='original PPTX slide count; OCR page correspondence must be checked against original';}}catch{countBasis+='; original PPTX slide count unavailable';}
 }
 const pages=Array.from({length:count},(_,pageIndex)=>({sourceId:file.id,source:file.name,pageIndex,countBasis,blocks:found.get(pageIndex)||[],externalInspection:doc.externalPpt?.pages.find(p=>p.pageIndex===pageIndex)}));
 if(found.has(null))pages.push({sourceId:file.id,source:file.name,pageIndex:null,countBasis:'unlocated blocks; no invented page',blocks:found.get(null)});
 return pages;
}
export function pageText(page){return page.blocks.map(b=>`[Block ${b.id}]\n${blockText(b)}`).join('\n\n');}
export function pageOriginalText(page){return page.externalInspection?page.blocks.filter(b=>b.evidenceKind==='original').map(b=>`[Block ${b.id}]\n${b.originalText}`).join('\n\n'):pageText(page);}
export function pageEvidenceText(page){return page.externalInspection?page.blocks.filter(b=>b.evidenceKind!=='original').map(b=>`[Block ${b.id}]\n${blockText(b)}`).join('\n\n'):'';}
export async function pageImages(dir,file,page){
 if(page.externalInspection)return {images:[],note:`Imported external Skill records: status=${page.externalInspection.status}; fullPageViewed=${page.externalInspection.fullPageViewed}; hidden=${page.externalInspection.hidden}. Visual observations are imported textual evidence. This model has not inspected the original page pixels.`};
 const refs=[...new Set(page.blocks.map(b=>b.image).filter(Boolean))];if(!refs.length)return {images:[],note:'No image resource supplied by parser; no full-page screenshot was inspected.'};
 let archive;try{archive=await readFile(path.join(dir,'Parsed',file.id,'mineru_result.zip'));}catch(e){if(e.code==='ENOENT')return {images:[],note:'Image references exist but original result ZIP is unavailable; image pixels not inspected.'};throw e;}
 const entries=zipEntries(archive,n=>refs.some(ref=>n===ref||n.endsWith('/'+ref))&&/\.(png|jpe?g|webp)$/i.test(n),8*1024*1024);
 if(entries.length>4||entries.reduce((n,e)=>n+e.bytes.length,0)>8*1024*1024)throw Error('本页图片超过视觉请求上限（4 张 / 8 MB）；请补入图片解释或关闭设置中的图片分析后重试。');
 return {images:entries.map(e=>`data:image/${/\.jpe?g$/i.test(e.name)?'jpeg':/\.webp$/i.test(e.name)?'webp':'png'};base64,${e.bytes.toString('base64')}`),note:`Parser image crops supplied: ${entries.length}/${refs.length}. These are not full-page renders. Missing images must remain unresolved.`};
}
