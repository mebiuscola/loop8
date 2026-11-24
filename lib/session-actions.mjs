import {readFile,readdir,lstat,rm,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {json,save,atomic} from './core.mjs';
// A deletion journal contains paths only. No deleted source text is retained.
export async function checked(dir,relative){
 const root=await realpath(dir),target=path.resolve(root,relative),rel=path.relative(root,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('清理路径超出本周课程目录。');
 let current=root;for(const part of rel.split(path.sep)){current=path.join(current,part);try{const info=await lstat(current);if(info.isSymbolicLink())throw Error('清理路径包含链接，请先检查课程目录。');}catch(e){if(e.code==='ENOENT')break;throw e;}}return target;
}
const generations=s=>[s?.generation,...(s?.history||[]).map(h=>h.generation)].filter(Boolean);
export async function deletionPlan(p,sid,dir){
 const session=p.sessions.find(s=>s.id===sid);if(!session)throw Error('课堂不存在。');const owned=p.files.filter(f=>f.sessionId===sid),others=p.files.filter(f=>f.sessionId!==sid),paths=new Set();
 const add=async relative=>{await checked(dir,relative);paths.add(relative.replaceAll('\\','/'));};
 for(const f of owned){if(!others.some(o=>o.stored===f.stored))await add('Source/'+f.stored);for(const key of ['parsed','externalAnalysis'])if(f[key]&&!others.some(o=>o[key]===f[key]))await add('Parsed/'+f[key]);}
 if(session.storageFolder){const folder='Sessions/'+session.storageFolder;if(!others.some(f=>f.stored===folder||f.stored.startsWith(folder+'/')))await add('Source/'+folder);}
 const removed=new Set([...generations(session),...generations(p.weekly)]),kept=new Set([...generations(p.preparation),...p.sessions.filter(s=>s.id!==sid).flatMap(generations)]);
 for(const g of removed){if(kept.has(g))throw Error('输出版本被其他课堂共用，无法安全完整删除；请先检查项目数据。');await add('Output/.versions/'+g);}
 // Failed publications can leave unreferenced output versions containing evidence.
 let entries=[];try{entries=await readdir(path.join(dir,'Output','.versions'),{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const entry of entries)if(entry.isDirectory()&&!kept.has(entry.name))await add('Output/.versions/'+entry.name);
 await add('Output/Sessions/'+sid);await add('Output/Weekly_Deep_Dive.md');await add('Output/Deep_Dive.md');if(removed.has(p.generation))await add('Output/Class_Script_Bilingual.md');
 for(const f of ['Parsed/.pipeline.json','Parsed/.last_model_failure.json','Parsed/context.json'])await add(f);
 for(const folder of ['Parsed','Source','.']){const parent=await checked(dir,folder==='.'?'project.json':folder);let names=[];try{names=await readdir(folder==='.'?dir:parent);}catch(e){if(e.code!=='ENOENT')throw e;}for(const name of names)if((folder==='Parsed'&&/^\.(pipeline\.json|last_model_failure\.json|context\.json)\..+\.tmp$/.test(name))||(folder==='.'&&/^project\.json\..+\.tmp$/.test(name))||(folder==='Source'&&/^\.audio-upload-.+\.part$/.test(name)))await add(folder==='.'?name:folder+'/'+name);}
 return {schema:1,sessionId:sid,paths:[...paths],summary:{title:session.title,subtitles:owned.filter(f=>f.role==='srt').length,recordings:owned.filter(f=>f.role==='audio').length,versions:generations(session).length,clearsWeekAnalysis:true,clearsWeekChat:true}};
}
export async function deleteSession(p,sid,dir,putClass,{remove=rm}={}){
 const journal=path.join(dir,'.session-delete.json');let plan=await json(journal,null);if(plan&&plan.sessionId!==sid)throw Error('另一节课尚未清理完成，请先继续清理。');if(!plan){plan=await deletionPlan(p,sid,dir);await save(journal,plan);}p.deletionPending={sessionId:sid,summary:plan.summary};await putClass(p);
 try{for(const relative of plan.paths){const target=await checked(dir,relative);await remove(target,{recursive:true,force:true});}}
 catch(e){p.status='error';p.stage='课堂删除未完成';p.error='部分文件未能删除，请关闭占用文件的程序，再继续清理。'+e.message;await putClass(p);throw Error(p.error);}
 const deletedGenerations=new Set(generations(p.sessions.find(s=>s.id===sid)));p.files=p.files.filter(f=>f.sessionId!==sid);p.sessions=p.sessions.filter(s=>s.id!==sid);p.chat=(p.chat||[]).filter(c=>c.scope&&c.scope!=='week'&&c.scope!==sid);delete p.weekly;
 if(deletedGenerations.has(p.generation)||plan.paths.includes('Output/.versions/'+p.generation)){delete p.generation;delete p.coverage;delete p.outputRevision;}if(p.tasks){delete p.tasks['script:'+sid];delete p.tasks['analysis:'+sid];delete p.tasks.week;}for(const k of ['job','error','failedStage','parallel','parallelTasks','deletionPending'])delete p[k];p.revision++;p.status='idle';p.stage='课堂已删除；整周分析需要更新';await putClass(p);await unlink(journal);return p;
}
export async function renameSession(p,sid,title,dir,putClass){
 if(typeof title!=='string'||!title.trim()||title.trim().length>120||/[\r\n]/.test(title))throw Error('课堂名称应为 1–120 个字符，不能换行。');const session=p.sessions.find(s=>s.id===sid);if(!session)throw Error('课堂不存在。');const next=title.trim();
 // Update the sole current output headings.
 session.title=next;for(const name of ['Class_Script_Bilingual.md','Deep_Dive.md']){const target=await checked(dir,'Output/Sessions/'+sid+'/'+name);try{await atomic(target,titledOutput(await readFile(target,'utf8'),p,session,name));}catch(e){if(e.code!=='ENOENT')throw e;}}p.chat=(p.chat||[]).map(c=>c.scope===sid?{...c,contextLabel:next}:c);p.revision++;await putClass(p);return p;
}
export function titledOutput(text,p,session,name){if(name==='Bilingual.md')return text;if(!session)return text.replace(/^# [^\r\n]*(?:\r?\n|$)/,`# ${p.name} · ${name==='PPT_Bilingual_Guide.md'?'PPT 逐页导读':'整周 Deep Dive'}\n`);const heading=`# ${p.name} · ${session.type}: ${session.title}${name==='Deep_Dive.md'?' · Deep Dive':''}`;return text.replace(/^# [^\r\n]*(?:\r?\n|$)/,heading+'\n');}
