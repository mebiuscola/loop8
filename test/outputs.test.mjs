import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,mkdir,readdir,rm,rename,symlink} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {publishCurrent,migrateOutputs,recoverOutputs,outputPath} from '../lib/outputs.mjs';
const project=()=>({id:'Week_Test',name:'Test',materialRevision:1,sessions:[{id:'lesson',revision:1,title:'Lesson'}]});
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-current-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const missing=file=>assert.rejects(readFile(file),{code:'ENOENT'});
test('successful reruns replace all scope files, keep other scopes and create no history',()=>fixture(async dir=>{
 const p=project(),put=q=>writeFile(path.join(dir,'project.json'),JSON.stringify(q));
 await publishCurrent(p,'lesson',{'Class_Script_Bilingual.md':'first','Deep_Dive.md':'analysis','Transcript_Reader.json':'{}'},{evidence:{cues:[1]}},{dir,putClass:put});const old=p.sessions[0].generation;
 await publishCurrent(p,'week',{'Weekly_Deep_Dive.md':'week'},{},{dir,putClass:put});
 await publishCurrent(p,'lesson',{'Class_Script_Bilingual.md':'second','Deep_Dive.md':'new'},{evidence:{cues:[2]}},{dir,putClass:put});
 assert.notEqual(p.sessions[0].generation,old);assert.equal(p.sessions[0].history,undefined);assert.equal(await readFile(outputPath(dir,p,'lesson','Class_Script_Bilingual.md'),'utf8'),'second');assert.equal(await readFile(outputPath(dir,p,'week','Weekly_Deep_Dive.md'),'utf8'),'week');await missing(outputPath(dir,p,'lesson','Transcript_Reader.json'));assert.deepEqual((await readdir(dir)).sort(),['Output','project.json']);await missing(path.join(dir,'Output','.versions'));
 // Invalid publication must never remove the existing successful output.
 await assert.rejects(publishCurrent(p,'lesson',{'../../bad.md':'bad'},{},{dir,putClass:put}));assert.equal(await readFile(outputPath(dir,p,'lesson','Class_Script_Bilingual.md'),'utf8'),'second');
}));
test('migration takes only referenced current results and evidence, verifies before discarding history, is idempotent',()=>fixture(async dir=>{
 const p=project();p.sessions[0].generation='current';p.sessions[0].history=[{generation:'old'}];p.weekly={generation:'week'};
 for(const [file,text] of Object.entries({'.versions/current/Class_Script_Bilingual.md':'current','.versions/current/Deep_Dive.md':'lesson','.versions/current/evidence.json':'{"source":1}', '.versions/old/Class_Script_Bilingual.md':'obsolete','.versions/week/Deep_Dive.md':'weekly','Sessions/lesson/Class_Script_Bilingual.md':'wrong friendly copy'})){const target=path.join(dir,'Output',file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,text);}
 await mkdir(path.join(dir,'Source'));await writeFile(path.join(dir,'Source','original.pptx'),'original');
 const put=q=>writeFile(path.join(dir,'project.json'),JSON.stringify(q));await migrateOutputs(p,dir,put);await migrateOutputs(p,dir,put);
 assert.equal(await readFile(outputPath(dir,p,'lesson','Class_Script_Bilingual.md'),'utf8'),'current');assert.equal(await readFile(outputPath(dir,p,'lesson','evidence.json'),'utf8'),'{"source":1}');assert.equal(await readFile(outputPath(dir,p,'week','Weekly_Deep_Dive.md'),'utf8'),'weekly');assert.equal(await readFile(path.join(dir,'Source','original.pptx'),'utf8'),'original');assert.equal(p.sessions[0].history,undefined);await assert.rejects(readdir(path.join(dir,'Output','.versions')),{code:'ENOENT'});
}));
test('missing current output aborts migration without deleting old data',()=>fixture(async dir=>{
 const p=project();p.sessions[0].generation='missing';await mkdir(path.join(dir,'Output','.versions','old'),{recursive:true});await writeFile(path.join(dir,'Output','.versions','old','keep.md'),'keep');await assert.rejects(migrateOutputs(p,dir,async()=>{}),/缺失/);assert.equal(p.outputStorageVersion,undefined);assert.equal(await readFile(path.join(dir,'Output','.versions','old','keep.md'),'utf8'),'keep');
}));
test('interrupted directory swap rolls forward using the journal and cleans old/temp files',()=>fixture(async dir=>{
 const p=project(),next={...p,outputStorageVersion:1};await mkdir(path.join(dir,'.output-old-test'));await writeFile(path.join(dir,'.output-old-test','old.md'),'old');await mkdir(path.join(dir,'.output-stage-test'));await writeFile(path.join(dir,'.output-stage-test','Weekly_Deep_Dive.md'),'new');await writeFile(path.join(dir,'.output-transaction.json'),JSON.stringify({stage:'.output-stage-test',old:'.output-old-test',next}));
 await recoverOutputs(p,dir,q=>writeFile(path.join(dir,'project.json'),JSON.stringify(q)));assert.equal(await readFile(path.join(dir,'Output','Weekly_Deep_Dive.md'),'utf8'),'new');assert.deepEqual((await readdir(dir)).sort(),['Output','project.json']);assert.equal(p.outputStorageVersion,1);
}));
