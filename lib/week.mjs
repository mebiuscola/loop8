import {randomUUID} from 'node:crypto';
import {scriptState,weeklyState} from './workflow.mjs';
export const PREP_OUTPUTS=['PPT_Bilingual_Guide.md'];
export const SESSION_OUTPUTS=['Class_Script_Bilingual.md','Deep_Dive.md'];
export function migrateWeek(p){
 if(p.schemaVersion===2)return p;
 p.materialRevision=p.revision||0;p.sessions=[];
 for(const f of p.files.filter(f=>f.role==='srt')){
  const id=f.sessionId||f.id;f.sessionId=id;
  p.sessions.push({id,type:'Lecture',title:'已有课堂记录',date:'',revision:1,srtId:f.id,...(p.generation?{generation:p.generation,materialRevision:p.outputRevision,outputRevision:1,coverage:p.coverage}:{})});
 }
 p.schemaVersion=2;return p;
}
export function addSession(p,{type='Lecture',title='',date=''}={}){
 if(!['Lecture','Seminar','Other'].includes(type))throw Error('请选择 Lecture、Seminar 或 Other。');
 if(typeof title!=='string'||title.length>120||typeof date!=='string'||date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('课堂名称或日期无效。');
 const s={id:randomUUID(),type,title:title.trim()||`${type} ${p.sessions.length+1}`,date,revision:0};p.sessions.push(s);return s;
}
export function artifact(p,scope='week'){
 if(scope.startsWith('reference:')){const file=p.files.find(f=>f.id===scope.slice(10));if(!file)throw Error('参考文献不存在。');return {value:file.referenceTranslation,names:['Bilingual.md','Reference_Reader.json'],folder:'References/'+file.id,scope};}
 if(scope==='preparation')return {value:p.preparation,names:PREP_OUTPUTS,folder:'Preparation',scope};
 if(scope==='week')return {value:p.weekly,names:['Weekly_Deep_Dive.md'],folder:'',scope};
 const session=p.sessions.find(s=>s.id===scope);if(!session)throw Error('课堂记录不存在。');
 return {value:session,names:SESSION_OUTPUTS,folder:`Sessions/${session.id}`,scope};
}
export function stale(p,scope){
 if(scope==='week')return !weeklyState(p).available||weeklyState(p).stale;
 if(scope!=='preparation'){const s=p.sessions.find(s=>s.id===scope);return !scriptState(p,s).available||scriptState(p,s).stale;}
 const {value:a}=artifact(p,scope);if(!a?.generation)return true;
 if(a.materialRevision!==p.materialRevision)return true;
 return false;
}
export function validFocus(p,scope,focus){
 if(!focus)return null;
 if(scope!=='preparation'&&scope!=='week')throw Error('页面提问请选择预习或本周范围。');
 if(focus.kind==='file'&&typeof focus.sourceId==='string'&&p.files.some(f=>f.id===focus.sourceId&&['ppt','reading'].includes(f.role)))return {kind:'file',sourceId:focus.sourceId};
 if(focus.kind==='page'&&typeof focus.sourceId==='string'&&Number.isInteger(focus.pageIndex)&&focus.pageIndex>=0&&p.files.some(f=>f.id===focus.sourceId&&['ppt','reading'].includes(f.role)))return {kind:'page',sourceId:focus.sourceId,pageIndex:focus.pageIndex};
 throw Error('提问位置无效，请重新选择问题或页面。');
}
