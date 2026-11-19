import {readFile,rm,unlink} from 'node:fs/promises';
import path from 'node:path';
import {atomic,json,save} from './core.mjs';
import {contentHash} from './materials.mjs';
import {readingMarkdown} from './reader.mjs';
import {checked} from './session-actions.mjs';

const journalName='.material-delete.json';
const relativeKey=value=>path.win32.normalize(value).toLowerCase();
const inside=(value,parent)=>value===parent||value.startsWith(parent+'\\');
export const materialDeleteJournal=async dir=>json(await checked(dir,journalName),null);

function childPath(folder,value){
 const key=relativeKey(folder+'/'+value),parent=relativeKey(folder);
 if(key===parent||!inside(key,parent))throw Error('材料路径超出允许清理的目录。');
 return folder+'/'+value;
}

export async function materialDeletionPlan(project,sourceId,dir){
 const file=project.files.find(item=>item.id===sourceId&&['bb','ppt','reading'].includes(item.role));
 if(!file||!/^[-\w]+$/.test(sourceId))throw Error('教学材料不存在。');
 const others=project.files.filter(item=>item.id!==sourceId);
 const sharedOriginal=others.some(item=>relativeKey(item.stored)===relativeKey(file.stored));
 const paths=new Set();
 if(!sharedOriginal)paths.add(childPath('Source',file.stored));

 const parsedReferences=others.flatMap(item=>[item.parsed,item.externalAnalysis]).filter(Boolean).map(relativeKey);
 for(const value of [sourceId,file.parsed,file.externalAnalysis].filter(Boolean)){
  const key=relativeKey(value);
  if(!parsedReferences.some(reference=>inside(reference,key)||inside(key,reference)))paths.add(childPath('Parsed',value));
 }
 paths.add('.Cache/Pages/'+sourceId);
 paths.add('.Cache/AI/'+sourceId);
 paths.add('Output/References/'+sourceId);
 for(const name of ['reading_index.json','context.json','.pipeline.json','.last_model_failure.json'])paths.add('Parsed/'+name);

 if(/\.pptx?$/i.test(file.name)&&!sharedOriginal){
  const bytes=await readFile(await checked(dir,childPath('Source',file.stored))).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const hash=bytes?contentHash(bytes):file.sha256;
  if(/^[\da-f]{64}$/i.test(hash||'')){
   let sharedPreview=false;
   for(const other of others.filter(item=>/\.pptx?$/i.test(item.name))){
    const original=await readFile(await checked(dir,childPath('Source',other.stored))).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if((original?contentHash(original):other.sha256)===hash){sharedPreview=true;break;}
   }
   if(!sharedPreview)for(const extension of ['pdf','json'])paths.add('.Cache/PPT/'+hash+'.'+extension);
  }
 }
 for(const relative of paths)await checked(dir,relative);
 const preparation=project.preparation;
 const prunePreparation=!!preparation?.generation&&(Array.isArray(preparation.pages)
  ?preparation.pages.some(page=>page.sourceId===sourceId):file.role==='ppt');
 return {sourceId,paths:[...paths],prunePreparation,summary:{name:file.name,sharedOriginal}};
}

async function prunePreparation(project,dir,sourceId,remove){
 const readerPath=await checked(dir,'Output/Preparation/PPT_Reader.json');
 const guidePath=await checked(dir,'Output/Preparation/PPT_Bilingual_Guide.md');
 const reader=await json(readerPath,null);
 const pages=reader?.pages?.filter(page=>page.sourceId!==sourceId)||[];
 if(!pages.length){
  for(const target of [readerPath,guidePath])await remove(target,{force:true});
  delete project.preparation;
  delete project.tasks?.preparation;
  return;
 }
 await save(readerPath,{...reader,pages});
 await atomic(guidePath,readingMarkdown(pages,project.name));
 project.preparation.pages=pages.map(({sourceId,source,pageIndex})=>({sourceId,source,pageIndex}));
}

export async function deleteMaterial(project,sourceId,dir,putClass,{remove=rm}={}){
 let plan=await materialDeleteJournal(dir);
 if(plan&&plan.sourceId!==sourceId)throw Error('请先完成另一份材料的删除。');
 if(!plan){
  plan=await materialDeletionPlan(project,sourceId,dir);
  await save(await checked(dir,journalName),plan);
 }
 try{
  for(const relative of plan.paths)await remove(await checked(dir,relative),{recursive:true,force:true});
  if(plan.prunePreparation&&project.preparation)await prunePreparation(project,dir,sourceId,remove);
 }catch{
  throw Error('材料删除未完成。请关闭占用文件的程序，然后选择「继续删除材料」。');
 }
 if(project.files.some(file=>file.id===sourceId)){
  project.files=project.files.filter(file=>file.id!==sourceId);
  for(const task of ['reference:','reading:'])delete project.tasks?.[task+sourceId];
  project.revision++;
  project.materialRevision++;
  project.lastMaterialDeletionRevision=project.materialRevision;
  project.materialDeletedAt=new Date().toISOString();
  await putClass(project);
 }
 await unlink(await checked(dir,journalName));
 return project;
}
