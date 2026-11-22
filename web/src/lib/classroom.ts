// Status of each class (session) and its transcript, in the six status words (docs/IA-PROPOSAL.md §2).
import type {Project,Session,TranscriptParagraph} from './api';
import {taskStatus,type StatusKind} from './status';

export interface ClassStatus{kind:StatusKind;text:string;}

/** Same freshness rule as public/workflow.js scriptState. */
export function scriptStale(project:Project,s:Session){
 return !!s.generation&&(s.materialRevision!==project.materialRevision||s.outputRevision!==s.revision);
}

export function scriptStatus(project:Project,s:Session):ClassStatus{
 const task=project.tasks?.['script:'+s.id];
 if(task?.status==='running')return {kind:'running',text:'讲稿生成中'};
 if(!s.srtId)return {kind:'idle',text:'等待字幕'};
 if(s.generation){
  if(scriptStale(project,s))return {kind:'stale',text:s.outputRevision!==s.revision?'字幕已更换 · 建议更新讲稿':'课件已变更 · 建议更新讲稿'};
  return {kind:'done',text:'讲稿已就绪'};
 }
 if(task&&['error','partial'].includes(task.status)){const k=taskStatus(task);return {kind:k,text:k==='stopped'?'已停止 · 可继续':'失败'+(/content_filter/.test(task.error||'')?' · 模型过滤':'')};}
 return {kind:'idle',text:'未生成讲稿'};
}

export const speakerLabel:Record<TranscriptParagraph['speaker'],string>={Lecturer:'Lecturer',Student:'Student','Unclear speaker':'Unclear'};

/** "mm:ss" or "h:mm:ss" from milliseconds. */
export function clock(ms:number){
 if(!Number.isFinite(ms))return '00:00';
 const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;
 return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

/**
 * Chapter headings shown in the transcript and its table of contents.
 * Same rule as the Markdown output: a new heading when the chapter changes,
 * but not more often than every three minutes.
 */
export function chapterStarts(paragraphs:TranscriptParagraph[]):Map<number,string>{
 const out=new Map<number,string>();let chapter='',at=-Infinity;
 paragraphs.forEach((p,i)=>{if(p.chapter&&p.chapter!==chapter&&(chapter===''||p.startMs-at>=180000)){out.set(i,p.chapter);chapter=p.chapter;at=p.startMs;}});
 return out;
}
