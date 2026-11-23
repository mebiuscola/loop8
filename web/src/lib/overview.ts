// What the overview shows for each material: one status and at most one next step
// (docs/IA-PROPOSAL.md §2 and §3.1). Reading statuses come from lib/reading.ts so the
// overview and the reading page always say the same thing.
import type {CoursewareReader,DeckReview,Project,ReferenceReader,Role,SourceFile} from './api';
import type {StatusKind} from './status';
import {coursewareStatus,referenceStatus} from './reading';

export interface Step{kind:'ai-parse'|'cancel'|'parse-pdf'|'translate'|'read';label:string;}
export interface MaterialView{kind:StatusKind;text:string;step:Step|null;}

export const roleLabel:Record<string,string>={bb:'课程说明',ppt:'课件',reading:'参考文献',srt:'字幕',audio:'录音'};
export const roleTag:Record<string,string>={bb:'BB',ppt:'PPT',reading:'PDF'};

export const isPdf=(f:SourceFile)=>/\.pdf$/i.test(f.name);
/** BB given as Markdown or plain text needs no parsing. */
export const isPlainBb=(f:SourceFile)=>f.role==='bb'&&!isPdf(f);
/** Files whose role can be changed (the server allows it for PDF and PowerPoint material). */
export const canChangeRole=(f:SourceFile)=>['ppt','reading','bb'].includes(f.role)&&/\.(pdf|pptx?)$/i.test(f.name);
export const progressOf=(f:SourceFile)=>f.aiParse?.total?(f.aiParse.completed||0)+'/'+f.aiParse.total:'';

export function materialView(p:Project,f:SourceFile,reader?:CoursewareReader|ReferenceReader|null):MaterialView{
 const ai=f.aiParse;
 if(ai?.status==='running')return {kind:'running',text:(f.role==='ppt'?'导读生成中':'AI 解析中')+(progressOf(f)?' '+progressOf(f):''),step:{kind:'cancel',label:'停止'}};
 if(f.parseStatus==='running')return {kind:'running',text:'解析中'+(f.progress?' · '+f.progress:''),step:null};
 if(isPlainBb(f))return {kind:'done',text:'已保存',step:null};

 if(f.role==='ppt'){
  if(reader){
   const s=coursewareStatus(p,f,reader as CoursewareReader);
   if(s.kind==='done')return {...s,step:{kind:'read',label:'阅读'}};
   if(s.kind==='running')return {...s,step:null};
   return {...s,step:{kind:'ai-parse',label:s.kind==='stale'?'更新导读':ai?'继续生成导读':'生成导读'}};
  }
  return {kind:'idle',text:'读取中…',step:null};
 }

 // Reading and BB PDFs are first parsed (their own text layer, MinerU for scans, or an imported parse).
 if(!f.parsed){
  if(f.parseStatus==='failed')return {kind:'failed',text:'解析失败'+(f.error?' · 详见详情':''),step:{kind:'parse-pdf',label:'重新解析'}};
  return {kind:'idle',text:'待解析',step:{kind:'parse-pdf',label:'解析 PDF'}};
 }
 if(f.role==='bb')return {kind:'done',text:'已解析',step:null};
 if(!reader)return {kind:'idle',text:'读取中…',step:null};
 const s=referenceStatus(p,f,reader as ReferenceReader);
 if(s.kind==='done')return {...s,step:{kind:'read',label:'阅读'}};
 if(s.kind==='running')return {...s,step:null};
 return {...s,step:{kind:'translate',label:s.kind==='idle'?'翻译':s.kind==='stale'?'重新翻译':'补译剩余'}};
}

/** A guess for a newly added file; the user confirms or changes it before uploading. */
export function guessRole(name:string):Role|'srt'|'audio'|null{
 if(/\.pptx?$/i.test(name))return 'ppt';
 if(/\.pdf$/i.test(name))return 'reading';
 if(/\.(md|txt)$/i.test(name))return 'bb';
 if(/\.srt$/i.test(name))return 'srt';
 if(/\.(mp3|m4a|wav|ogg|webm|flac|aac)$/i.test(name))return 'audio';
 return null;
}
/** Roles a file type may take (server: bb .md .txt .pdf; ppt .ppt .pptx .pdf; reading .pdf). */
export function rolesFor(name:string):Role[]{
 if(/\.pdf$/i.test(name))return ['ppt','reading','bb'];
 if(/\.pptx?$/i.test(name))return ['ppt'];
 if(/\.(md|txt)$/i.test(name))return ['bb'];
 return [];
}

export function sizeText(bytes?:number){
 if(!bytes&&bytes!==0)return '';
 return bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
}

/**
 * The whole-deck check in plain words. Only batches not yet checked are unfinished; edits the
 * checker suggested but could not verify against the page were simply not applied.
 */
export function deckReviewText(review?:DeckReview|null){
 if(!review)return '';
 const issues=review.issues||[],open=issues.filter(i=>i.kind==='request'||i.kind==='pending').length,declined=issues.length-open;
 if(open)return '整课检查有 '+open+' 批未完成，可继续生成以补查';
 return '整课检查已完成'+(declined?' · '+declined+' 条修改建议未通过核对，没有采用（页面内容不变）':'');
}
