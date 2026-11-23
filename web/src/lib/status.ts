// The six status words used everywhere (docs/IA-PROPOSAL.md §2).
import type {Project,ProjectSummary,Task} from './api';

export type StatusKind='idle'|'running'|'stopped'|'failed'|'done'|'stale';
export const statusWord:Record<StatusKind,string>={idle:'未开始',running:'进行中',stopped:'已停止',failed:'失败',done:'已完成',stale:'已过期'};

const STOPPED=/已停止|已取消|可以继续|可继续/;

export function taskStatus(task:Task):StatusKind{
 if(task.status==='running'||task.status==='queued')return 'running';   // queued: waits, then starts by itself
 if(task.status==='complete')return 'done';
 if(task.status==='partial')return 'stopped';
 if(task.status==='error')return STOPPED.test(task.error||'')?'stopped':'failed';
 return 'idle';
}

/** One dot per course in the sidebar: running beats problems beats ready. */
export function courseStatus(p:ProjectSummary,dismissed:(key:string,task:Task)=>boolean=()=>false):'running'|'attention'|'ready'{
 const tasks=Object.entries(p.tasks||{});
 if(p.status==='running'||tasks.some(([,t])=>t.status==='running'))return 'running';
 if(tasks.some(([k,t])=>['error','partial'].includes(t.status)&&!dismissed(k,t)))return 'attention';
 return 'ready';
}

const modeLabel:Record<string,string>={preparation:'课件导读',reading:'文献解析',reference:'文献翻译',script:'讲稿',analysis:'本节 Deep Dive',week:'整周 Deep Dive'};

/** Human label for a task key such as "script:<sessionId>" or "reference:<fileId>". */
export function taskLabel(key:string,project?:Pick<Project,'files'|'sessions'>):{action:string;target:string}{
 const [mode,ref]=key.split(/:(.*)/s);
 const action=modeLabel[mode]||mode;
 if(!ref||!project)return {action,target:''};
 const file=project.files?.find(f=>f.id===ref),session=project.sessions?.find(s=>s.id===ref);
 return {action,target:file?.name||session?.title||''};
}
