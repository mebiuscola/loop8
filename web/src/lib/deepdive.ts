// Status of each Deep Dive in the six status words (docs/IA-PROPOSAL.md §2).
// Freshness follows lib/workflow.mjs (analysisState, weeklyState) exactly, so the
// new frontend and the server agree on what is out of date.
import type {Project,Session,MaterialInputs} from './api';
import {taskStatus,type StatusKind} from './status';
import {scriptStale} from './classroom';

export interface DiveStatus{kind:StatusKind;text:string;}

export interface MaterialChange{id:string;name:string;change:'added'|'removed'|'changed';}
/** Same as lib/workflow.mjs materialChanges: what changed since the fingerprints a result recorded, or null when unknown. */
export function materialChanges(p:Project,saved?:MaterialInputs):MaterialChange[]|null{
 const now=p.materialInputs;
 if(!saved||!now?.sources||now.revision!==p.materialRevision)return null;
 const changes:MaterialChange[]=[];
 for(const [id,v] of Object.entries(now.sources)){const old=saved[id];if(!old)changes.push({id,name:v.name,change:'added'});else if(old.hash!==v.hash)changes.push({id,name:v.name,change:'changed'});}
 for(const [id,old] of Object.entries(saved))if(!now.sources[id])changes.push({id,name:old.name,change:'removed'});
 return changes;
}
/** Same as lib/workflow.mjs materialsStale. */
function materialsStale(p:Project,value?:{materialInputs?:MaterialInputs;materialRevision?:number}){
 const changes=materialChanges(p,value?.materialInputs);
 return changes?changes.length>0:value?.materialRevision!==p.materialRevision;
}
/** Plain words for what changed, e.g. "《Reading.pdf》已变更"; '材料有变化' when unknown (older results). */
export function changeText(p:Project,value?:{materialInputs?:MaterialInputs}){
 const changes=materialChanges(p,value?.materialInputs);
 if(!changes?.length)return '材料有变化';
 const first=changes[0],name=first.id==='BB_Info'?'课程介绍':'《'+first.name+'》';
 const one=first.change==='added'?'新增'+name:first.change==='removed'?name+'已删除':name+'已变更';
 return changes.length>1?one+'等 '+changes.length+' 项':one;
}

export function sessionAnalysis(p:Project,s:Session){
 const available=!!s.analysis?.generation||!!s.generation&&(!s.artifactStatus||s.artifactStatus.deepDive==='complete');
 const a=s.analysis;
 const stale=available&&(scriptStale(p,s)||(a?.generation?materialsStale(p,a)||a.scriptGeneration!==s.generation||a.outputRevision!==s.revision:materialsStale(p,s)));
 return {available,stale};
}

export function weeklyAnalysis(p:Project){
 const a=p.weekly,available=!!a?.generation;
 if(!a||!available)return {available:false,stale:false};
 if(materialsStale(p,a))return {available,stale:true};
 if(!a.selectedSessionIds)return {available,stale:p.sessions.some(s=>s.generation&&scriptStale(p,s))||JSON.stringify(a.sessionInputs||[])!==JSON.stringify(p.sessions.map(s=>({id:s.id,revision:s.revision,generation:s.generation||null})))};
 const changed=(a.sessionInputs||[]).some(old=>{const s=p.sessions.find(s=>s.id===old.id);return !s||scriptStale(p,s)||s.generation!==old.generation||s.revision!==old.revision;});
 const newlyReady=p.sessions.some(s=>s.generation&&!(a.availableSessionIds||[]).includes(s.id));
 const newSession=!!a.knownSessionIds&&p.sessions.some(s=>!a.knownSessionIds!.includes(s.id));
 const pendingChanged=(a.pendingSessionInputs||[]).some(old=>{const s=p.sessions.find(s=>s.id===old.id);return !s||s.revision!==old.revision;});
 return {available,stale:changed||newlyReady||newSession||pendingChanged};
}

function failure(p:Project,key:string):DiveStatus|null{
 const task=p.tasks?.[key];
 if(!task||!['error','partial'].includes(task.status))return null;
 const k=taskStatus(task);
 return {kind:k,text:k==='stopped'?'已停止 · 可重新生成':'失败'+(/content_filter/.test(task.error||'')?' · 模型过滤':'')};
}

export function sessionDiveStatus(p:Project,s:Session):DiveStatus{
 if(p.tasks?.['analysis:'+s.id]?.status==='running')return {kind:'running',text:'生成中'};
 const {available,stale}=sessionAnalysis(p,s);
 if(available)return stale?{kind:'stale',text:scriptStale(p,s)?'讲稿待更新 · 建议之后更新':materialsStale(p,s.analysis?.generation?s.analysis:s)?changeText(p,s.analysis?.generation?s.analysis:s)+' · 建议更新':'讲稿已重新生成 · 建议更新'}:{kind:'done',text:'已生成'};
 if(!s.generation)return {kind:'idle',text:'需要先生成讲稿'};
 if(scriptStale(p,s))return {kind:'idle',text:'讲稿待更新'};
 return failure(p,'analysis:'+s.id)||{kind:'idle',text:'未生成'};
}

export function weekDiveStatus(p:Project):DiveStatus{
 if(p.tasks?.week?.status==='running')return {kind:'running',text:'生成中'};
 const {available,stale}=weeklyAnalysis(p);
 if(available)return stale?{kind:'stale',text:(materialsStale(p,p.weekly||undefined)?changeText(p,p.weekly||undefined):'课堂有变化')+' · 建议更新'}:{kind:'done',text:'已生成'};
 return failure(p,'week')||{kind:'idle',text:'未生成'};
}

/** "11-17" style date of a generation, or '' when unknown. */
export function shortDate(iso?:string){
 if(!iso)return '';
 const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
 return String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
