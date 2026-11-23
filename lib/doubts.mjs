// What counts as a problem in a page-by-page AI parse (2026-11-23).
//
// Before, every doubt on a page — a model's general caveat, a rendering note, even the
// courseware-wide "missing fonts" warning copied onto every page — marked the page as not
// complete, and re-running the same model could not clear it. Now:
//   - only a page that could not be recognised at all needs work (and is retried);
//   - every other doubt is a hint shown with its page, which the reader can mark as checked;
//   - courseware-wide notes (missing fonts) are kept once for the file, not on every page.
// Stored results are unchanged; this is how they are read.
import path from 'node:path';
import {readFile,writeFile,rename} from 'node:fs/promises';

export const DOUBT_VERSION=1;
const DECK_NOTE=/^(本机缺少课件字体|原课件字体未完整加载)/;
export const isDeckNote=text=>DECK_NOTE.test(String(text||''));

/** A page that could not be recognised: no usable image, or nothing recovered. */
export function needsWork(page,ppt){
 if(!page)return false;
 return ppt?page.inspection?.status==='unavailable'||page.inspection?.fullPageViewed===false:page.status==='unreadable';
}

// The same text-overflow finding is reported by up to three checks (the page renderer, the
// render audit and the recognition check), each in its own words; it is shown as one hint.
const OVERFLOW=/^(?:渲染检查发现 )?(\d+) 个(?:文字区域|文本框)可能(?:裁切或超出页面|溢出)|^页面导出存在边界裁切/;
const overflowHint=n=>(n>1?n+' 个':'有')+'文字区域可能超出页面或被裁切，请对照原页（或 PDF 预览）核对。';

/** The page's own doubts, without courseware-wide notes; each finding once. */
export function pageHints(page){
 const all=[...(page?.uncertainties||[]),...(page?.visualObservations||[]).flatMap(v=>v?.uncertainties||[])].filter(t=>typeof t==='string'&&t.trim()&&!isDeckNote(t));
 let overflow=0;const rest=[];
 for(const t of all){const m=t.match(OVERFLOW);if(m)overflow=Math.max(overflow,Number(m[1]||1));else rest.push(t);}
 return [...new Set([...(overflow?[overflowHint(overflow)]:[]),...rest])];
}

/** Courseware-wide notes found in a checkpoint (stored once, or copied on pages by older versions). */
export function deckNotes(checkpoint){
 return [...new Set([...(checkpoint?.deckNotes||[]),...(checkpoint?.pages||[]).flatMap(p=>(p?.uncertainties||[]).filter(isDeckNote))])];
}

/** Counts kept on the material (`aiParse`): pages needing work, pages with hints, file notes. */
export function doubtSummary(checkpoint,ppt,checked={}){
 const pages=(checkpoint?.pages||[]).filter(Boolean);
 const open=p=>pageHints(p).filter(t=>!(checked[p.page]||[]).includes(t));
 return {incomplete:pages.filter(p=>needsWork(p,ppt)).length,hints:pages.filter(p=>open(p).length).length,notes:deckNotes(checkpoint),doubtVersion:DOUBT_VERSION};
}

/** Whole-deck check batches still unchecked. Suggested edits that failed verification were not applied and need nothing. */
export const reviewOpen=review=>(review?.issues||[]).some(i=>i.kind==='request'||i.kind==='pending');

// Hints the reader has checked against the original page, per file: {"<page>":[hint text]}.
const checksFile=(dir,fid)=>path.join(dir,'Parsed',fid,'hint-checks.json');
export async function readHintChecks(dir,fid){
 try{const v=JSON.parse(await readFile(checksFile(dir,fid),'utf8'));return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
 catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return {};throw e;}
}
export async function setHintCheck(dir,fid,page,hint,checked){
 const all=await readHintChecks(dir,fid),key=String(page),list=new Set(all[key]||[]);
 checked?list.add(hint):list.delete(hint);
 if(list.size)all[key]=[...list];else delete all[key];
 const file=checksFile(dir,fid),temp=file+'.tmp';
 await writeFile(temp,JSON.stringify(all,null,1));await rename(temp,file);
 return all;
}

/** The checkpoint file of a material's AI parse. */
export const checkpointFile=(dir,f)=>path.join(dir,'Parsed',f.id,f.role==='ppt'?'ppt_task.json':'ai_task.json');

/**
 * Migration: recount `aiParse` of materials parsed before doubt levels existed, from their
 * saved checkpoints. Nothing is re-parsed and no result changes. Returns true when changed.
 */
export async function migrateDoubtCounts(p,dir){
 let changed=false;
 for(const f of p.files||[]){
  if(!f.aiParse||f.aiParse.doubtVersion===DOUBT_VERSION||f.aiParse.status==='running')continue;
  let checkpoint=null;
  try{checkpoint=JSON.parse(await readFile(checkpointFile(dir,f),'utf8'));}catch{/* no checkpoint: nothing to recount */}
  if(!checkpoint)continue;
  Object.assign(f.aiParse,doubtSummary(checkpoint,f.role==='ppt',await readHintChecks(dir,f.id)));changed=true;
  // Older versions called a deck check with only unapplied suggestions "检查待处理".
  if(f.aiParse.stage==='页面已完成 · 检查待处理'&&!reviewOpen(checkpoint.deckReview||f.aiParse.review))f.aiParse.stage='已收录';
 }
 return changed;
}
