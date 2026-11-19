import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {json,save,atomic} from './core.mjs';
import {serialWriter} from './concurrency.mjs';
import {outputPath} from './outputs.mjs';
const SCHEMA='classroom.reading-references.v1',writers=new Map(),short=/^r-[A-Za-z0-9_-]{10,22}$/;
const registryPath=dir=>path.join(dir,'Parsed','reading_references.json');
function validate(ref){
 if(!ref||ref.v!==1||![ref.b,ref.a,ref.z].every(Number.isSafeInteger)||ref.b<0||ref.a<0||ref.z<=ref.a||ref.z-ref.a>18000)throw Error('Reading 引用范围无效。');
 if(typeof ref.s!=='string'||!ref.s||![ref.h,ref.p,ref.t].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)))throw Error('Reading 引用定位信息无效。');
 return {v:1,s:ref.s,h:ref.h,p:ref.p,b:ref.b,a:ref.a,z:ref.z,t:ref.t};
}
export function decodeLegacyReference(encoded){
 if(typeof encoded!=='string'||encoded.length>1800||!/^[\w-]+$/.test(encoded))throw Error('Reading 引用无效。');let ref;try{ref=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw Error('Reading 引用无法读取。');}return validate(ref);
}
async function registry(dir){const saved=await json(registryPath(dir),null);if(!saved)return {schema:SCHEMA,entries:{}};if(saved.schema!==SCHEMA||!saved.entries||typeof saved.entries!=='object'||Array.isArray(saved.entries))throw Error('本地引用记录格式无效；未重置已有引用。');return saved;}
export async function resolveReferenceRecord(dir,encoded){
 if(typeof encoded==='string'&&short.test(encoded)){const saved=await registry(dir);if(!Object.hasOwn(saved.entries,encoded))throw Error('这条引用的本地记录不存在，请从原课程目录打开或重新生成分析。');return validate(saved.entries[encoded]);}
 // Old copied/exported links remain readable, but new outputs never emit them.
 return decodeLegacyReference(encoded);
}
export function registerReadingReferences(dir,references){
 const key=path.resolve(dir);if(!writers.has(key))writers.set(key,serialWriter());return writers.get(key)(async()=>{
  const saved=await registry(dir),result=new Map();let changed=false;
  for(const encoded of new Set(references)){
   if(short.test(encoded)){if(!Object.hasOwn(saved.entries,encoded))throw Error('这条引用的本地记录不存在。');validate(saved.entries[encoded]);result.set(encoded,encoded);continue;}
   const ref=decodeLegacyReference(encoded),canonical=JSON.stringify(ref),digest=createHash('sha256').update(canonical).digest('base64url');let id;
   // Deterministic short IDs cannot silently be reassigned if a registry is
   // lost and recreated. Existing entries are checked for a rare collision.
   for(let n=10;n<=22;n+=2){const candidate='r-'+digest.slice(0,n),old=saved.entries[candidate];if(!old||JSON.stringify(validate(old))===canonical){id=candidate;break;}}
   if(!id)throw Error('引用编号冲突，未覆盖原记录。');if(!Object.hasOwn(saved.entries,id)){saved.entries[id]=ref;changed=true;}result.set(encoded,id);
  }
  if(changed)await save(registryPath(dir),saved);return result;
 });
}
export async function compactReadingLinks(project,dir,text){
 const root=`/api/projects/${encodeURIComponent(project.id)}/reading-reference?ref=`,escaped=root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped+'([A-Za-z0-9_-]{30,1800})(?![A-Za-z0-9_-])','g'),tokens=[...text.matchAll(pattern)].map(m=>m[1]),valid=[];
 for(const token of new Set(tokens))try{decodeLegacyReference(token);valid.push(token);}catch{/* Invalid pre-existing references stay visibly unmodified. */}
 if(!valid.length)return {text,changed:false,references:0,unconverted:tokens.length};
 const ids=await registerReadingReferences(dir,valid);let count=0;const compact=text.replace(pattern,(all,token)=>{const id=ids.get(token);if(!id)return all;count++;return root+id;});
 return {text:compact,changed:compact!==text,references:count,unconverted:tokens.length-count};
}
export async function migrateReadingCitations(project,dir){
 const results=[];
 for(const scope of ['week',...project.sessions.map(s=>s.id)]){
  const file=outputPath(dir,project,scope,scope==='week'?'Weekly_Deep_Dive.md':'Deep_Dive.md');let text;try{text=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const result=await compactReadingLinks(project,dir,text);if(result.changed)await atomic(file,result.text);results.push({scope,changed:result.changed,references:result.references,unconverted:result.unconverted});
 }
 return results;
}
