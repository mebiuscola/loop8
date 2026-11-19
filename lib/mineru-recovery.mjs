import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {archiveDocument,contentHash} from './materials.mjs';
import {save} from './core.mjs';
import {sourcePath} from './storage.mjs';

// Local-only recovery: use the ZIP already bound to this material directory.
// Never replace an existing accepted import/AI result, and never call a provider.
// Call at startup or while the project has no running jobs.
export async function recoverMineruArchives(p,dir,putClass){
 const recovered=[],failed=[];
 for(const f of p.files){
  if(f.parsed||!(['reading'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name)))continue;
  if(f.aiParse?.status==='running')continue;
  let bytes;try{bytes=await readFile(path.join(dir,'Parsed',f.id,'mineru_result.zip'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  try{
   if(f.sha256&&contentHash(await readFile(sourcePath(dir,f.stored)))!==f.sha256)throw Error('原件已变化，不能直接复用旧 MinerU 结果包。');
   const doc=archiveDocument(bytes,{id:f.id,name:f.name,role:f.role});
   await save(path.join(dir,'Parsed',f.id,'blocks.json'),doc);
   f.parsed=f.id+'/blocks.json';f.parseStatus='ready';f.blocks=doc.blocks.length;f.progress='已收录现有 MinerU 结果包';
   delete f.error;delete f.aiParse;delete f.externalAnalysis;delete f.importSummary;recovered.push(f.id);
  }catch(e){failed.push({sourceId:f.id,message:e.message});}
 }
 if(recovered.length){
  p.revision++;p.materialRevision++;
  if(p.status!=='running'&&/份材料等待解析/.test(p.error||'')&&p.files.filter(f=>['reading','ppt'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name)).every(f=>f.parsed)){
   p.status='idle';p.stage='材料解析已恢复，可继续生成';delete p.error;delete p.failedStage;delete p.parallel;delete p.parallelTasks;
  }
  await putClass(p);
 }
 return {recovered,failed};
}
