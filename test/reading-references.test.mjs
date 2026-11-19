import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {contentHash} from '../lib/materials.mjs';
import {readingIndex,hydrateReading,resolveReadingReference} from '../lib/reading-index.mjs';
import {registerReadingReferences,resolveReferenceRecord,compactReadingLinks,migrateReadingCitations,decodeLegacyReference} from '../lib/reading-references.mjs';
const quote='Comparison preserves the distinction between evidence and interpretation.';
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-short-refs-'));try{
 await mkdir(path.join(dir,'Source'));await mkdir(path.join(dir,'Parsed/r'),{recursive:true});const bytes=Buffer.from('Original PDF fixture'),file={id:'r',role:'reading',name:'Article [original].pdf',stored:'Article.pdf',sha256:contentHash(bytes),parsed:'r/blocks.json'},p={id:'Week_引用_1',name:'Reading',sessions:[{id:'lesson'}],files:[file]};
 const doc={schema:'classroom.blocks.v1',source:{id:file.id},blocks:[{id:'b1',type:'text',text:quote,pageIndex:2},{id:'b2',type:'text',text:'An unlocated qualification.',pageIndex:null}]};await writeFile(path.join(dir,'Source',file.stored),bytes);await writeFile(path.join(dir,'Parsed',file.parsed),JSON.stringify(doc));const index=await readingIndex(p,dir),evidence=index.units.map(u=>hydrateReading(index,u));await fn({p,dir,file,doc,evidence});
 }finally{await rm(dir,{recursive:true,force:true});}}

test('short references persist only coordinates, resolve the same excerpt and keep unknown pages unknown',()=>fixture(async({p,dir,evidence})=>{
 const ids=await registerReadingReferences(dir,evidence.map(e=>e.reference));for(const e of evidence){const id=ids.get(e.reference);assert.match(id,/^r-[\w-]{10}$/);assert(id.length<20);const actual=await resolveReadingReference(p,dir,id),legacy=await resolveReadingReference(p,dir,e.reference);assert.deepEqual(actual,legacy);assert.equal(actual.pageIndex,e.pageIndex);}
 const disk=await readFile(path.join(dir,'Parsed/reading_references.json'),'utf8');assert(!disk.includes(evidence[0].reference));assert(!disk.includes(quote),'no article body or full encoded token in the registry');assert.equal(Object.keys(JSON.parse(disk).entries).length,2);
 assert.equal((await registerReadingReferences(dir,[evidence[0].reference])).get(evidence[0].reference),ids.get(evidence[0].reference));assert.equal(await readFile(path.join(dir,'Parsed/reading_references.json'),'utf8'),disk,'unchanged citations do not rewrite records');
}));

test('short references retain stale-source validation and cannot be resolved by another project',()=>fixture(async({p,dir,evidence,file,doc})=>{
 const id=(await registerReadingReferences(dir,[evidence[0].reference])).get(evidence[0].reference);await assert.rejects(()=>resolveReadingReference({...p,files:[]},dir,id),/移除/);
 doc.blocks[0].text+=' Restored text.';await writeFile(path.join(dir,'Parsed',file.parsed),JSON.stringify(doc));await assert.rejects(()=>resolveReadingReference(p,dir,id),/更新/);
 const other=await mkdtemp(path.join(os.tmpdir(),'classroom-other-refs-'));try{await assert.rejects(()=>resolveReadingReference(p,other,id),/记录不存在/);}finally{await rm(other,{recursive:true,force:true});}
 await assert.rejects(()=>resolveReferenceRecord(dir,'../../outside'),/无效/);await assert.rejects(()=>resolveReferenceRecord(dir,'r-unknownref0'),/不存在/);
}));

test('concurrent registration is idempotent; collisions and a broken registry never replace existing records',()=>fixture(async({dir,evidence})=>{
 await Promise.all(Array.from({length:12},()=>registerReadingReferences(dir,evidence.map(e=>e.reference))));let disk=JSON.parse(await readFile(path.join(dir,'Parsed/reading_references.json'),'utf8'));assert.equal(Object.keys(disk.entries).length,2);
 const token=evidence[0].reference,id=(await registerReadingReferences(dir,[token])).get(token),other=decodeLegacyReference(evidence[1].reference);disk.entries[id]=other;await writeFile(path.join(dir,'Parsed/reading_references.json'),JSON.stringify(disk));const longer=(await registerReadingReferences(dir,[token])).get(token);assert.notEqual(longer,id);assert.equal(longer.length,id.length+2);assert.deepEqual(await resolveReferenceRecord(dir,id),other);
 await writeFile(path.join(dir,'Parsed/reading_references.json'),'{}');await assert.rejects(()=>registerReadingReferences(dir,[token]),/格式无效/);assert.equal(await readFile(path.join(dir,'Parsed/reading_references.json'),'utf8'),'{}','never silently resets a damaged registry');
}));

test('existing weekly and single-class analyses convert links without changing prose, filenames, pages or generations',()=>fixture(async({p,dir,evidence})=>{
 const root=`/api/projects/${encodeURIComponent(p.id)}/reading-reference?ref=`,line=`A grounded claim. [Reading 原文 · Article [original].pdf · PDF 第 3 页](${root}${evidence[0].reference})`,text='# Deep Dive\n\n'+line+'\n\n'+line+'\n';
 for(const relative of ['Output/Weekly_Deep_Dive.md','Output/Sessions/lesson/Deep_Dive.md']){await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),text);}const untouched=JSON.stringify(p);
 const results=await migrateReadingCitations(p,dir);assert(results.every(r=>r.changed&&r.references===2));assert.equal(JSON.stringify(p),untouched);
 const converted=await readFile(path.join(dir,'Output/Weekly_Deep_Dive.md'),'utf8');assert(!converted.includes('eyJ2Ijox'));const short=converted.match(/ref=(r-[\w-]+)/)[1];assert.equal(converted,text.replaceAll(evidence[0].reference,short),'only link targets change');assert.equal((await resolveReadingReference(p,dir,short)).excerpt,quote);
 const rerun=await migrateReadingCitations(p,dir);assert(rerun.every(r=>!r.changed));assert.equal((await compactReadingLinks({...p,id:'OtherProject'},dir,text)).changed,false,'no cross-project rewriting');assert.equal((await compactReadingLinks(p,dir,'No citations here')).changed,false);
 const broken='['+'Unrecognized'+']('+root+'a'.repeat(60)+')';assert.equal((await compactReadingLinks(p,dir,broken)).text,broken,'unrecognized references are not fabricated');
}));

test('server startup converts old citations and both short and previously exported long links still resolve',()=>fixture(async({p,dir,evidence})=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'classroom-citation-startup-'));let child;
 try{
  Object.assign(p,{created:new Date().toISOString(),schemaVersion:2,sourceLayoutVersion:1,outputStorageVersion:1,status:'done',revision:1,materialRevision:1,chat:[],weekly:{generation:'week',materialRevision:1}});
  const file=path.join(data,'classes',p.id);await mkdir(path.dirname(file),{recursive:true});await cp(dir,file,{recursive:true});await writeFile(path.join(file,'project.json'),JSON.stringify(p));await mkdir(path.join(file,'Output'),{recursive:true});
  const root=`/api/projects/${encodeURIComponent(p.id)}`,text=`# Analysis\n\n[Reading 原文 · Article · PDF 第 3 页](${root}/reading-reference?ref=${evidence[0].reference})`;await writeFile(path.join(file,'Output/Weekly_Deep_Dive.md'),text);
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CLASSROOM_DATA:data,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);for(let i=0;i<100&&!log.includes('http://');i++)await new Promise(r=>setTimeout(r,30));const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert(base,log);
  const output=await (await fetch(base+root+'/output?scope=week&name=Weekly_Deep_Dive.md')).text(),short=output.match(/ref=(r-[\w-]+)/)?.[1];assert(short,output);assert(!output.includes(evidence[0].reference));assert.equal(JSON.parse(await readFile(path.join(file,'project.json'),'utf8')).weekly.generation,'week');
  for(const ref of [short,evidence[0].reference]){const response=await fetch(base+root+'/reading-reference-data?ref='+ref);assert.equal(response.status,200);assert.equal((await response.json()).excerpt,quote);}
 }finally{if(child){child.kill();await new Promise(r=>child.once('exit',r));}await rm(data,{recursive:true,force:true});}
}));
