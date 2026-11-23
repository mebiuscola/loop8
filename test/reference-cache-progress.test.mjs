import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {contentListDocument} from '../lib/materials.mjs';
import {referenceDocument,referenceProgress} from '../lib/reference-study.mjs';

// Versions before the per-file checkpoint kept finished paragraphs only in the model cache, so a
// translation stopped part-way (e.g. by a content filter) showed "0/240". Those count now.
test('reference progress counts paragraphs translated earlier that are kept only in the model cache',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-ref-cache-'));
 try{
  const file={id:'ref',role:'reading',name:'Reading.pdf',stored:'Reading.pdf',parsed:'ref/blocks.json',parseStatus:'ready'};
  const p={id:'Week_C',name:'Cache week',files:[file],sessions:[],materialRevision:1,revision:1,outputStorageVersion:1};
  const doc=contentListDocument(['First paragraph of the reading.','Second paragraph of the reading.','Third paragraph of the reading.'].map(text=>({type:'text',text,page_idx:0})),file);
  await mkdir(path.join(dir,'Parsed','ref'),{recursive:true});await mkdir(path.join(dir,'Source'),{recursive:true});
  await writeFile(path.join(dir,'Source','Reading.pdf'),'pdf');await writeFile(path.join(dir,'Parsed','ref','blocks.json'),JSON.stringify(doc));
  const before=await referenceProgress(p,file,dir);
  assert.equal(before.summary.total,3);assert.equal(before.summary.completed,0);
  const {units}=await referenceDocument(p,file,dir);
  // The model cache as an older version left it: two paragraphs done, plus an unrelated batch entry.
  const entry=(slot,output)=>({scope:'reference:ref',slot,owners:[{scope:'reference:ref',slot}],name:'参考文献翻译',output,created:'2026-11-05T10:00:00.000Z'});
  await writeFile(path.join(dir,'Parsed','.pipeline.json'),JSON.stringify({version:1,entries:{
   a:entry('reference:ref:'+units[0].unitKey,{chinese:'第一段译文'}),
   b:entry('reference:ref:'+units[1].unitKey,{chinese:'第二段译文'}),
   c:entry('reference:ref:batch:3',{translations:[{id:'3',chinese:'不该按位置使用'}]}),
   d:entry('reference:other:'+units[2].unitKey,{chinese:'另一份文献'}),
  }}));
  const after=await referenceProgress(p,file,dir);
  assert.equal(after.summary.completed,2,'the two cached paragraphs count');
  assert.deepEqual(after.paragraphs.map(x=>x.chinese),['第一段译文','第二段译文',''],'batch entries and other files are not used');
  assert.equal(after.paragraphs[2].status,'pending');
 }finally{await rm(dir,{recursive:true,force:true});}
});
