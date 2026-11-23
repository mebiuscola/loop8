// Status of each readable material, in the six status words (docs/IA-PROPOSAL.md §2).
import type {CoursewareReader,Project,ReferenceReader,SourceFile} from './api';
import type {StatusKind} from './status';
import {taskStatus} from './status';

export interface MaterialStatus{kind:StatusKind;text:string;}

/** A short, plain reason for a failed task (the full message stays in the task panel). */
function reason(error?:string){
 if(!error)return '';
 if(/content_filter/.test(error))return ' · 模型过滤';
 if(/超时|timeout/i.test(error))return ' · 超时';
 if(/模型|model/i.test(error)&&/设置|配置/.test(error))return ' · 模型未设置';
 return '';
}

export function coursewareStatus(project:Project,file:SourceFile,reader?:CoursewareReader|null):MaterialStatus{
 const task=project.tasks?.preparation;
 if(task?.status==='running')return {kind:'running',text:'导读生成中'};
 if(!reader)return {kind:'idle',text:'读取中…'};
 const total=reader.pages.length,done=reader.pages.filter(p=>p.closeReading||p.paragraphs.some(x=>x.chinese)).length;
 // "原件已变更" only when the original file itself changed; otherwise other material of the week did.
 if(reader.sourceChanged)return {kind:'stale',text:'原件已变更 · 建议更新'};
 if(reader.stale)return {kind:'stale',text:'材料有变化 · 建议更新'};
 if(!reader.generated||!done){
  if(task&&['error','partial'].includes(task.status)){const k=taskStatus(task);return {kind:k,text:(k==='stopped'?'已停止':'失败')+(k==='failed'?reason(task.error):'')+(done?' · '+done+'/'+total+' 已保存':'')};}
  return {kind:'idle',text:'未生成导读'};
 }
 if(done<total)return {kind:'stopped',text:'部分完成 · '+done+'/'+total};
 return {kind:'done',text:'已完成导读'};
}

export function referenceStatus(project:Project,file:SourceFile,reader?:ReferenceReader|null):MaterialStatus{
 const task=project.tasks?.['reference:'+file.id];
 if(task?.status==='running')return {kind:'running',text:'翻译中'+(reader?' '+reader.summary.completed+'/'+reader.summary.total:'')};
 if(!reader)return {kind:'idle',text:'读取中…'};
 const {total,completed,blocked}=reader.summary;
 if(reader.stale)return {kind:'stale',text:'原件已变更 · 建议更新'};
 if(total&&completed===total)return {kind:'done',text:'已翻译'};
 if(task&&['error','partial'].includes(task.status)){
  const k=taskStatus(task);return {kind:k,text:(k==='stopped'?'已停止':'失败')+(k==='failed'?reason(task.error):'')+' · '+completed+'/'+total+' 已保存'+(blocked?' · '+blocked+' 段被过滤':'')};
 }
 if(completed)return {kind:'stopped',text:'部分完成 · '+completed+'/'+total};
 return {kind:'idle',text:'未翻译'};
}

/** Render "**bold**" as strong text without ever interpreting HTML. */
export function boldParts(text:string):{text:string;bold:boolean}[]{
 return text.split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map(part=>/^\*\*[^*\n]+\*\*$/.test(part)?{text:part.slice(2,-2),bold:true}:{text:part,bold:false});
}
