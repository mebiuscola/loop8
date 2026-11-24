import {refreshMaterialInputs} from './material-inputs.mjs';
import path from 'node:path';
import {readFile,writeFile,mkdir,readdir,lstat,rename,rm,cp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {json,save,atomic} from './core.mjs';
import {artifact} from './week.mjs';

// A generation is an input-freshness token, never a directory or saved history.
export function outputPath(dir,p,scope,name){
 if(!['preparation','week'].includes(scope)&&!/^[-\w]+$/.test(scope)&&!/^reference:[-\w]+$/.test(scope))throw Error('输出课堂 ID 无效。');
 const a=artifact(p,scope),allowed=[...a.names,...(scope==='preparation'?['PPT_Reader.json']:scope==='week'?[]:['Transcript_Reader.json','evidence.json'])];
 if(!allowed.includes(name))throw Error('无效输出文件。');
 return bounded(dir,path.join('Output',a.folder,name));
}
function bounded(dir,relative){const root=path.resolve(dir),target=path.resolve(root,relative),rel=path.relative(root,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('输出路径超出课程目录。');return target;}
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function guard(file){if(!await exists(file))return;const s=await lstat(file);if(s.isSymbolicLink())throw Error('输出目录包含链接，停止迁移或清理。');if(s.isDirectory())for(const name of await readdir(file))await guard(path.join(file,name));}
async function remove(dir,name){const target=bounded(dir,name);await guard(target);await rm(target,{recursive:true,force:true});}
const journalName='.output-transaction.json';
function validJournal(j){if(!/^\.output-stage-[\w-]+$/.test(j.stage)||!/^\.output-old-[\w-]+$/.test(j.old)||!j.next?.id)throw Error('输出提交记录无效。');}
async function filesBelow(dir,prefix=''){
 const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const relative=path.join(prefix,e.name);if(e.isDirectory())out.push(...await filesBelow(path.join(dir,e.name),relative));else out.push(relative);}return out;
}
async function prune(dir,expected){for(const e of await readdir(dir,{withFileTypes:true})){const current=path.join(dir,e.name),source=path.join(expected,e.name);if(!await exists(source)){await guard(current);await rm(current,{recursive:true,force:true});}else if(e.isDirectory())await prune(current,source);}}
async function finish(dir,j,putClass){
 validJournal(j);const output=bounded(dir,'Output'),stage=bounded(dir,j.stage),old=bounded(dir,j.old);
 await guard(output);await guard(stage);await guard(old);
 if(await exists(stage)){
  // Keep Output itself stable on Windows: Explorer/file viewers can hold the
  // directory open. Only individual result files are atomically replaced.
  if(!j.backupComplete){
   if(await exists(output)){await remove(dir,j.old);await mkdir(old);await cp(output,old,{recursive:true});}
   else if(!await exists(old))await mkdir(old);
   j.backupComplete=true;await save(path.join(dir,journalName),j);
  }
  await mkdir(output,{recursive:true});
  for(const relative of await filesBelow(stage)){
   const bytes=await readFile(path.join(stage,relative)),target=path.join(output,relative);await atomic(target,bytes);
   if(!(await readFile(target)).equals(bytes))throw Error('输出提交校验失败。');
  }
  await putClass(j.next);
  // Delete history/obsolete readers only after all current files and metadata
  // have been saved. A pending journal makes this cleanup restartable.
  await prune(output,stage);
 }else{if(!await exists(output))throw Error('输出提交文件缺失，停止清理。');await putClass(j.next);}
 await remove(dir,j.old);await remove(dir,j.stage);
 await rm(path.join(dir,journalName),{force:true});
}
export async function recoverOutputs(p,dir,putClass){
 const j=await json(path.join(dir,journalName),null);if(j){if(j.next?.id!==p.id)throw Error('输出提交记录与课程不匹配。');await finish(dir,j,putClass);Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,j.next);}
 // Only application-owned, bounded temporary directories are removed on startup.
 for(const name of await readdir(dir))if(/^\.output-(stage|old)-[\w-]+$/.test(name))await remove(dir,name);
}
async function commit(p,next,dir,putClass,prepare){
 const id=randomUUID(),j={stage:'.output-stage-'+id,old:'.output-old-'+id,next};
 const stage=bounded(dir,j.stage);await mkdir(stage);
 try{await prepare(stage);await guard(stage);}catch(e){await remove(dir,j.stage);throw e;}
 await save(path.join(dir,journalName),j);
 // Roll forward from the journal after interruption; readers are blocked while
 // this short commit runs. Never delete the last successful output on build failure.
 await finish(dir,j,putClass);
 Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,next);
}
function clearHistory(p){delete p.history;for(const a of [p.preparation,p.weekly,...p.sessions||[]])if(a)delete a.history;}
export async function publishCurrent(p,scope,files,metadata,{dir,putClass}){
 // Lecture scripts and Deep Dives record the fingerprints of the week's materials (lib/material-inputs.mjs).
 const follows=scope==='week'||scope!=='preparation'&&!scope.startsWith('reference:');
 if(follows)await refreshMaterialInputs(p,dir);const inputs=follows?p.materialInputs?.sources:undefined;
 for(const name of Object.keys(files))outputPath(dir,p,scope,name);if(metadata.evidence)outputPath(dir,p,scope,'evidence.json');
 const next=structuredClone(p),target=artifact(next,scope),generation=randomUUID();
 const value={...metadata,generation,materialRevision:p.materialRevision,...(inputs?{materialInputs:inputs}:{}),generated:new Date().toISOString()};delete value.evidence;delete value.merge;
 if(metadata.kind==='analysis'){
  value.generation=target.value.generation;value.materialRevision=target.value.materialRevision;if(target.value.materialInputs)value.materialInputs=target.value.materialInputs;else delete value.materialInputs;value.generated=target.value.generated;
  value.analysis={...metadata.analysis,generation,generated:new Date().toISOString(),materialRevision:p.materialRevision,...(inputs?{materialInputs:inputs}:{}),scriptGeneration:target.value.generation,outputRevision:target.value.outputRevision};
 }
 if(scope==='preparation')next.preparation=value;else if(scope==='week')next.weekly=value;else if(scope.startsWith('reference:'))next.files.find(f=>f.id===scope.slice(10)).referenceTranslation=value;else Object.assign(target.value,value,metadata.kind==='analysis'?{}:{outputRevision:target.value.revision});
 clearHistory(next);next.outputStorageVersion=1;
 await commit(p,next,dir,putClass,async stage=>{
  const current=path.join(dir,'Output');await guard(current);if(await exists(current))await cp(current,stage,{recursive:true});
  const a=artifact(next,scope),folder=path.join(stage,a.folder);if(scope!=='week'&&!metadata.merge)await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  for(const [name,text] of Object.entries(files)){outputPath(dir,next,scope,name);await writeFile(path.join(folder,name),text,'utf8');}
  if(metadata.evidence)await save(path.join(folder,'evidence.json'),metadata.evidence);
 });
 return generation;
}
export async function migrateOutputs(p,dir,putClass){
 await recoverOutputs(p,dir,putClass);
 if(p.outputStorageVersion===1)return;
 const next=structuredClone(p);clearHistory(next);next.outputStorageVersion=1;
 await commit(p,next,dir,putClass,async stage=>{
  await guard(path.join(dir,'Output'));
  for(const scope of ['preparation','week',...(p.sessions||[]).map(s=>s.id)]){
   const a=artifact(p,scope);if(!a.value?.generation)continue;if(!/^[-\w]+$/.test(a.value.generation))throw Error('输出标记无效。');
   const names=[...a.names,...(scope==='preparation'?['PPT_Reader.json']:scope==='week'?[]:['Transcript_Reader.json','evidence.json'])];
   for(const name of names){
    const oldName=scope==='week'?'Deep_Dive.md':name;
    const legacy=bounded(dir,path.join('Output','.versions',a.value.generation,oldName)),friendly=outputPath(dir,p,scope,name);
    const source=await exists(legacy)?legacy:await exists(friendly)?friendly:scope==='week'&&await exists(path.join(dir,'Output','Deep_Dive.md'))?path.join(dir,'Output','Deep_Dive.md'):null;
    if(!source){if(a.names.includes(name))throw Error('当前结果缺失，未删除旧文件：'+name);continue;}
    const bytes=await readFile(source),target=path.join(stage,a.folder,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);if(!(await readFile(target)).equals(bytes))throw Error('输出迁移校验失败。');
   }
  }
 });
}
