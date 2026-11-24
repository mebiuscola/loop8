import path from 'node:path';
import {mkdir,writeFile,readFile,unlink,readdir,stat} from 'node:fs/promises';
import {contentHash} from './materials.mjs';
import {safeName} from './core.mjs';
const fingerprints=new Map();
async function fileHash(file,known){const info=await stat(file),cached=fingerprints.get(file);if(known){fingerprints.set(file,{size:info.size,time:info.mtimeMs,hash:known});return known;}if(cached?.size===info.size&&cached.time===info.mtimeMs)return cached.hash;const hash=contentHash(await readFile(file));fingerprints.set(file,{size:info.size,time:info.mtimeMs,hash});return hash;}
export function originalName(value){
 const name=String(value);if(!name||name.length>255||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||['.','..'].includes(name))throw Error('原文件名不适用于 Windows，请先重命名原件后上传。');return name;
}
export function sourcePath(dir,stored){const root=path.resolve(dir,'Source'),result=path.resolve(root,stored),relative=path.relative(root,result);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('原件路径不在课程 Source 目录内。');return result;}
export async function sessionFolder(p,session,dir){
 if(session.storageFolder)return session.storageFolder;
 const base=safeName(`${session.date||'未注明日期'}_${session.type}_${session.title}`),used=new Set(p.sessions.filter(s=>s.id!==session.id).map(s=>s.storageFolder?.toLowerCase()));
 const parent=path.join(dir,'Source','Sessions');await mkdir(parent,{recursive:true});const existing=new Set((await readdir(parent)).map(s=>s.toLowerCase()));
 let candidate=base;for(let n=2;used.has(candidate.toLowerCase())||existing.has(candidate.toLowerCase());n++)candidate=`${base} (${n})`;
 session.storageFolder=candidate;return candidate;
}
async function namedFile(dir,folder,name,bytes){
 const parent=sourcePath(dir,folder);await mkdir(parent,{recursive:true});const existing=new Map((await readdir(parent)).map(s=>[s.toLowerCase(),s]));const ext=path.extname(name),base=name.slice(0,name.length-ext.length),hash=contentHash(bytes);
 for(let n=1;n<10000;n++){
  const candidate=n===1?name:`${base} (${n})${ext}`,found=existing.get(candidate.toLowerCase());
  if(found){const file=path.join(parent,found);if(await fileHash(file)===hash)return {stored:`${folder}/${found}`,name:found};continue;}
  try{const file=path.join(parent,candidate);await writeFile(file,bytes,{flag:'wx'});await fileHash(file,hash);return {stored:`${folder}/${candidate}`,name:candidate};}catch(e){if(e.code!=='EEXIST')throw e;existing.set(candidate.toLowerCase(),candidate);n--;}
 }
 throw Error('同名文件数量过多，请调整原文件名。');
}
export async function storeSource(p,dir,{name,role,session,bytes}){
 name=originalName(name);const hash=contentHash(bytes);
 const namespace=f=>role==='srt'?f.role==='srt'&&f.sessionId===session.id:!['srt','audio'].includes(f.role);
 for(const f of p.files.filter(namespace)){
  const actual=await fileHash(sourcePath(dir,f.stored));f.sha256=actual;
  if(actual===hash){
   if(f.role===role)return {existing:f,kind:'reused',name:f.name,requestedName:name};
   return {stored:f.stored,name:f.name,sha256:hash,kind:'reused-file',requestedName:name};
  }
 }
 const folder=role==='srt'?`Sessions/${await sessionFolder(p,session,dir)}`:'Materials';const placed=await namedFile(dir,folder,name,bytes);
 return {...placed,sha256:hash,kind:placed.name===name?'saved':'renamed',requestedName:name};
}
export async function migrateSourceNames(p,dir,putClass){
 if(p.sourceLayoutVersion===1)return;
 const next=structuredClone(p),obsolete=new Set();next.files=[];
 for(const f of p.files){
  if(/^(Materials|Sessions)[/\\]/.test(f.stored)){next.files.push({...f});continue;}
  const session=f.role==='srt'?next.sessions.find(s=>s.id===f.sessionId):null;
  if(f.role==='srt'&&!session){next.files.push({...f});continue;}
  const placed=await storeSource(next,dir,{name:f.name,role:f.role,session,bytes:await readFile(sourcePath(dir,f.stored))});
  const replacement={...f,stored:placed.existing?.stored||placed.stored,name:placed.existing?.name||placed.name,originalName:f.originalName||f.name,sha256:placed.existing?.sha256||placed.sha256};next.files.push(replacement);
  if(replacement.stored!==f.stored)obsolete.add(f.stored);
 }
 next.sourceLayoutVersion=1;await putClass(next);Object.assign(p,next);
 // Only remove an old byte-identical copy after the new manifest is durable.
 for(const stored of obsolete)if(!p.files.some(f=>f.stored===stored))await unlink(sourcePath(dir,stored)).catch(e=>{if(e.code!=='ENOENT')console.warn('旧原件副本未清理：'+e.code);});
}
