import path from 'node:path';
import {readFile,readdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {json,save} from './core.mjs';
import {contentHash} from './materials.mjs';
import {sourcePath} from './storage.mjs';
import {serialWriter} from './concurrency.mjs';
const locks=new Map();
const lock=dir=>{if(!locks.has(dir))locks.set(dir,serialWriter());return locks.get(dir);};
const journal=(dir,id)=>path.join(dir,'Parsed','.material-commit-'+id+'.json');
function validate(j){if(!/^[\w-]+$/.test(j?.id||'')||j.doc?.rawReport!==j.id+'/ai_analysis.json'||j.patch?.parsed!==j.id+'/blocks.json'||!j.generation)throw Error('材料提交记录无效。');}
async function finish(dir,j,mutate,hooks={}){
 validate(j);if(contentHash(await readFile(sourcePath(dir,j.stored)))!==j.report.source.sha256)throw Error('待提交材料的原件已变化，请先恢复原件，未删除提交记录。');
 await save(path.join(dir,'Parsed',j.doc.rawReport),j.report);await hooks.afterReport?.();await save(path.join(dir,'Parsed',j.id,'blocks.json'),j.doc);
 await mutate(p=>{const f=p.files.find(f=>f.id===j.id);if(!f)throw Error('待提交材料已不在课程中。');if(f.materialGeneration===j.generation)return;Object.assign(f,j.patch,{materialGeneration:j.generation});delete f.error;p.revision++;p.materialRevision++;});
 await rm(journal(dir,j.id),{force:true});
}
export async function commitMaterial(dir,id,{stored,report,doc,patch},mutate,hooks){return lock(dir)(async()=>{const j={id,stored,report,doc,patch,generation:randomUUID()};validate(j);await save(journal(dir,id),j);await finish(dir,j,mutate,hooks);});}
export async function materialCommitPending(dir){return (await readdir(path.join(dir,'Parsed')).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).some(n=>/^\.material-commit-[\w-]+\.json$/.test(n));}
export async function recoverMaterialCommits(dir,mutate){return lock(dir)(async()=>{for(const n of await readdir(path.join(dir,'Parsed')).catch(e=>{if(e.code==='ENOENT')return [];throw e;}))if(/^\.material-commit-[\w-]+\.json$/.test(n)){const j=await json(path.join(dir,'Parsed',n),null);validate(j);if(n!==path.basename(journal(dir,j.id)))throw Error('材料提交记录名称不匹配。');await finish(dir,j,mutate);}});}
