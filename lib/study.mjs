import {readerPage,validateLearning,LEARNING_SCHEMA} from './ppt-learning.mjs';
import {reconstructBatch,contentAudit,classroomBatches} from './class-reconstruction.mjs';
import {budgetObject} from './context-budget.mjs';
import {translateParagraphs} from './paragraph-translation.mjs';
import {generateDeepDive} from './deep-dive.mjs';
import {publishCurrent,outputPath} from './outputs.mjs';
import {transcriptData,cleanScript} from './transcript.mjs';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {save,atomic,chunks,parseSrt,cueBatches,validateSegments,json} from './core.mjs';
import {mapPool,semaphore} from './concurrency.mjs';
import {parseReadingPdf,parseSourceOf} from './reading-parse.mjs';
import {archiveDocument,readableMaterial,manualDocument,materialParts,contentHash} from './materials.mjs';
import {artifact,stale} from './week.mjs';
import {pptPages,pageText,pageOriginalText,pageEvidenceText,pageImages} from './pages.mjs';
import {bodyParagraphs,readingMarkdown} from './reader.mjs';
import {compactCoursewareCitations} from './courseware-citations.mjs';
import {learningNote} from './material-inputs.mjs';

function fields(value,names){for(const key of names)if(typeof value?.[key]!=='string'||!value[key].trim())throw Error(`返回缺少有效 ${key} 字段。`);}
// Evidence selection is explicit and preserves coordinates. Full material
// summaries remain cached; preparation calls receive a relevant subset.
export function evidenceFor(context,query,budget){
 const terms=[...new Set(query.toLowerCase().match(/[a-z0-9]{3,}|[\u3400-\u9fff]/g)||[])];
 const ranked=chunks(context,4500).map((text,i)=>({text,i,score:terms.reduce((n,t)=>n+text.toLowerCase().split(t).length-1,0)})).sort((a,b)=>b.score-a.score||a.i-b.i);
 const selected=[];for(const part of ranked)if(part.text.length<=budget){selected.push(part);budget-=part.text.length;}
 return {method:'lexical selection of material notes; not exhaustive original reading',totalParts:ranked.length,parts:selected.sort((a,b)=>a.i-b.i).map(p=>p.text)};
}
async function studyPool(p,tasks,limit,stage,task){
 p.parallel={phase:'生成预习',limit,active:0,completed:0,total:tasks.length,failed:0};p.parallelTasks=[];
 const results=await mapPool(tasks,limit,async(item,index)=>{
  const label=item.label||`预习任务 ${index+1}`;p.parallel.active++;p.parallelTasks.push(label);await stage(p,`生成预习 · ${p.parallel.completed}/${tasks.length} · ${label}`);
  try{return await task(item,index);}catch(e){p.parallel.failed++;throw Error(`${label}：${e.message}`);}
  finally{p.parallel.active--;p.parallel.completed++;p.parallelTasks=p.parallelTasks.filter(s=>s!==label);await stage(p,`生成预习 · 已完成 ${p.parallel.completed}/${tasks.length} · 失败 ${p.parallel.failed}`);}
 });
 const failures=results.filter(r=>r.status==='rejected');if(failures.length)throw Error(`${failures.length} 个预习任务失败；成功步骤已缓存。${failures[0].reason.message}`);
 delete p.parallel;delete p.parallelTasks;return results.map(r=>r.value);
}
export async function preparation(p,settings,{dir,model,prompts,stage,context}){
 const pages=[],hashes=new Map(),integrated=new Map();for(const f of p.files.filter(f=>f.role==='ppt')){
  hashes.set(f.id,contentHash(await readFile(path.join(dir,'Source',f.stored))));pages.push(...await pptPages(dir,f));
  if(f.externalAnalysis){const report=await json(path.join(dir,'Parsed',f.externalAnalysis),null);if(report?.learningSchema===LEARNING_SCHEMA&&report.source.sha256===hashes.get(f.id))for(const page of report.pages){
   if(page.learning){validateLearning(page);integrated.set(f.id+':'+(page.page-1),readerPage(page,f,hashes.get(f.id)));}
   else throw Error(f.name+' 第 '+page.page+' 页尚未完成学习；不会发布缺页导读。');
  }}
 }

 const tasks=pages.map(page=>({...page,label:`${page.source} · 第 ${page.pageIndex===null?'未知':page.pageIndex+1} 页`}));
 const results=await studyPool(p,tasks,settings.contextConcurrency,stage,async item=>{
  const ready=integrated.get(item.sourceId+':'+item.pageIndex);if(ready)return ready;
  const file=p.files.find(f=>f.id===item.sourceId),originals=bodyParagraphs(item).flatMap(text=>chunks(text,6000)).map((english,i)=>({id:'p'+(i+1),english})),paragraphs=[];
  let batch=[],size=0;const batches=[];for(const part of originals){if(batch.length&&size+part.english.length>6500){batches.push(batch);batch=[];size=0;}batch.push(part);size+=part.english.length;}if(batch.length)batches.push(batch);
  for(const [i,parts] of batches.entries()){
   const answer=await translateParagraphs(model,prompts.ppt_translation,{sourceId:item.sourceId,source:item.source,pageIndex:item.pageIndex,part:i+1,paragraphs:parts});paragraphs.push(...parts.map((part,j)=>({english:part.english,chinese:answer.paragraphs[j].chinese})));
  }
  const visual=settings.visionEnabled||item.externalInspection?await pageImages(dir,file,item):{images:[],note:'Image analysis disabled; original pixels not inspected by this model.'};
  const original=originals.map(p=>p.english).join('\n\n'),visualEvidence=pageEvidenceText(item);
  const selected=evidenceFor(compactCoursewareCitations(context,p.files),original,Math.min(18000,Math.max(0,settings.contextChars-prompts.ppt_close_reading.length-original.length-visualEvidence.length-5000)));
  const closeReading=await model.text('PPT 本页细读',prompts.ppt_close_reading,JSON.stringify({source:item.source,pageIndex:item.pageIndex,original,importedVisualEvidence:visualEvidence,visualCoverage:visual.note,relatedEvidence:selected}),{images:visual.images});
  return {sourceId:item.sourceId,source:item.source,pageIndex:item.pageIndex,sourceHash:hashes.get(item.sourceId),paragraphs,closeReading,inspection:item.externalInspection||null};
 });
 for(const page of results)page.closeReading=compactCoursewareCitations(page.closeReading,p.files);
 const guide=readingMarkdown(results,p.name),reader={schema:'classroom.reader.v1',generated:new Date().toISOString(),materialRevision:p.materialRevision,pages:results};
 return {files:{'PPT_Bilingual_Guide.md':guide,'PPT_Reader.json':JSON.stringify(reader,null,2)},pages:results.map(({sourceId,source,pageIndex})=>({sourceId,source,pageIndex})),readerVersion:1};
}
export const publish=publishCurrent;
export async function weekly(p,settings,{dir,model,prompts,stage,context,putClass,sessionIds,signal}){
 await stage(p,'更新整周分析');const sessions=[];
 const selected=p.sessions.filter(s=>s.generation&&(!sessionIds||sessionIds.includes(s.id)));
 for(const s of selected){
  const evidence=await json(outputPath(dir,p,s.id,'evidence.json'),null);
  // Legacy output has no evidence checkpoint; mark it explicitly as secondary.
  const notes=evidence||chunks(await readFile(outputPath(dir,p,s.id,'Class_Script_Bilingual.md'),'utf8'),12000);
  sessions.push({id:s.id,type:s.type,title:s.title,date:s.date,stale:stale(p,s.id),evidenceType:evidence?'classroom evidence notes':'legacy reconstructed transcript; secondary',notes,contentAudit:s.contentAudit||[]});
 }
 const pendingSessions=p.sessions.filter(s=>!selected.some(i=>i.id===s.id)).map(({id,type,title,date,srtId,generation})=>({id,type,title,date,recordingSupplied:!!srtId,reason:generation?'用户未纳入本次分析':'尚无讲稿'}));
 const analysis=await generateDeepDive({project:p,dir,model,prompts,stage,context,sessions,pendingSessions});
 const included=selected.map(s=>({id:s.id,generation:s.generation}));
 const header=`# ${p.name} · 整周 Deep Dive\n\n> 已纳入课堂 / Included sessions: ${sessions.length?sessions.map(s=>`${s.type} · ${s.title}${s.date?' · '+s.date:''}${s.stale?'（输入已变更，课堂输出待更新）':''}`).join('; '):'本次未纳入课堂，仅基于本周教学材料 / Materials only.'}\n\n> 未纳入课堂 / Excluded sessions: ${pendingSessions.map(s=>s.title+'（'+s.reason+'）').join('; ')||'无 / None'}\n\n`;
 signal?.throwIfAborted();await publish(p,'week',{'Weekly_Deep_Dive.md':header+analysis.text},{sessions:included,selectedSessionIds:selected.map(s=>s.id),availableSessionIds:p.sessions.filter(s=>s.generation).map(s=>s.id),knownSessionIds:p.sessions.map(s=>s.id),pendingSessionInputs:p.sessions.filter(s=>!s.generation).map(s=>({id:s.id,revision:s.revision})),sessionInputs:selected.map(s=>({id:s.id,revision:s.revision,generation:s.generation})),analysis:analysis.metadata},{dir,putClass});
}

export async function sessionDeepDive(p,entry,{dir,model,prompts,stage,context}){
 if(!entry?.generation||stale(p,entry.id))throw Error('请先生成或更新本节讲稿，再生成本节 Deep Dive。');
 const evidence=await json(outputPath(dir,p,entry.id,'evidence.json'),null);
 const classroomEvidence=evidence||chunks(await readFile(outputPath(dir,p,entry.id,'Class_Script_Bilingual.md'),'utf8'),12000).map(s=>'[Legacy reconstructed transcript; secondary evidence] '+s);
 const session={id:entry.id,type:entry.type,title:entry.title,date:entry.date};
 return generateDeepDive({project:p,dir,model,prompts,stage,context,session,classroomEvidence,contentAudit:entry.contentAudit||[]});
}

export async function buildContext(p,settings,{dir,model,prompts,stage,signal,allowIncompleteMaterials=false,existingOnly=false}){
  const waiting=[];
  // PPT never falls through to a cloud upload. Reuse legacy local results,
  // but require an external report before spending any remote parsing quota.
  for(const f of p.files.filter(f=>f.role==='ppt')){
   if(existingOnly&&!f.parsed)continue;
   const source={id:f.id,name:f.name,role:f.role};
   if(f.parsed&&/\.json$/i.test(f.parsed)){await readableMaterial(path.join(dir,'Parsed',f.parsed));const doc=await json(path.join(dir,'Parsed',f.parsed),null);if(doc?.externalPpt?.originalSource?.sha256&&doc.externalPpt.originalSource.sha256.toLowerCase()!==contentHash(await readFile(path.join(dir,'Source',f.stored))))throw Error(`${f.name} 原件在本地已有变更，请重新导入对应解析 JSON。`);continue;}
   let doc;if(f.parsed&&f.parseStatus==='manual')doc=manualDocument(await readFile(path.join(dir,'Parsed',f.parsed),'utf8'),source);
   else try{doc=archiveDocument(await readFile(path.join(dir,'Parsed',f.id,'mineru_result.zip')),source);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(doc){await save(path.join(dir,'Parsed',f.id,'blocks.json'),doc);f.parsed=f.id+'/blocks.json';f.parseStatus='manual';}
   else{f.parseStatus='awaiting-json';f.progress='请先导入 AI 解析 JSON；PPT 不上传 MinerU';waiting.push(f.name);}
  }
  if(waiting.length){await stage(p,'等待导入 PPT 解析 JSON');throw Error(`${waiting.length} 份 PPT 等待 AI 解析 JSON：${waiting.join('；')}。请先将原件交给 Codex，使用 course-ppt-parser 解析，再在对应材料行导入 JSON。PPT 不会上传 MinerU。`);}
  const materials=p.files.filter(f=>['ppt','reading'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name));
  const uploadGate=semaphore(settings.uploadConcurrency);let parsed=0;
  p.parallel={phase:'解析材料',limit:settings.uploadConcurrency,active:0,completed:0,total:materials.length,failed:0};p.parallelTasks=[];
  await stage(p,'解析材料');
  await mapPool(materials,Math.max(8,settings.uploadConcurrency*2),async f=>{
   if(existingOnly&&!f.parsed){parsed++;p.parallel.completed=parsed;return;}
   const source={id:f.id,name:f.name,role:f.role};
   try{
    if(allowIncompleteMaterials&&f.role!=='ppt'&&f.parseStatus==='failed'&&!f.parsed)throw Error(f.error||'材料待解析。');
    if(f.parsed&&/\.json$/i.test(f.parsed)){await readableMaterial(path.join(dir,'Parsed',f.parsed));f.parseStatus=f.parseStatus==='manual'?'manual':'ready';}
    else {
     const dest=`${f.id}/blocks.json`,archivePath=path.join(dir,'Parsed',f.id,'mineru_result.zip');let doc;
     const manual=f.parseStatus==='manual';f.parseStatus='running';
     let existingArchive;try{existingArchive=await readFile(archivePath);}catch(e){if(e.code!=='ENOENT')throw e;}
     if(manual&&f.parsed)doc=manualDocument(await readFile(path.join(dir,'Parsed',f.parsed),'utf8'),source);
     else if(existingArchive){doc=archiveDocument(existingArchive,source);}
     else {
      if(f.role==='ppt')throw Error('PPT 需要导入 AI 解析 JSON，不使用 MinerU。');
      doc=await parseReadingPdf(settings,path.join(dir,'Source',f.stored),source,async detail=>{f.progress=detail;p.parallel.active=uploadGate.active;await stage(p,`解析材料 · 已完成 ${parsed}/${materials.length} · 上传中 ${uploadGate.active}/${settings.uploadConcurrency}`);},{archivePath,uploadGate,signal});
     }
     await save(path.join(dir,'Parsed',dest),doc);f.parsed=dest;if(!manual&&!existingArchive)f.parseSource=parseSourceOf(doc);f.parseStatus=doc.provenance==='manual-import'?'manual':'ready';f.blocks=doc.blocks.length;
    }
    delete f.error;f.progress='JSON 内容块已就绪';
   }catch(e){f.parseStatus='failed';f.error=e.message;f.progress='等待处理';p.parallel.failed++;}
   finally{parsed++;p.parallel.completed=parsed;p.parallel.active=uploadGate.active;await stage(p,`解析材料 · 已完成 ${parsed}/${materials.length} · 失败 ${p.parallel.failed}`);}
  });
  const failed=materials.filter(f=>f.parseStatus==='failed'||existingOnly&&!f.parsed);
  if(!existingOnly&&failed.length&&(!allowIncompleteMaterials||failed.some(f=>f.role==='ppt')))throw Error(`${failed.length} 份材料等待解析。原始文件已保留；请在对应材料行导入 content_list JSON 或补救 Markdown 后重新 Process。`);
  await stage(p,'构建课程上下文');
  const integratedNotes=[];
  const sources=[];for(const f of p.files.filter(f=>!['srt','audio'].includes(f.role)&&!failed.some(item=>item.id===f.id))){
   if(f.role==='ppt'&&f.externalAnalysis){const report=await json(path.join(dir,'Parsed',f.externalAnalysis),null);if(report?.learningSchema===LEARNING_SCHEMA){
    integratedNotes.push(learningNote(f,report));continue;
   }}const parts=await materialParts(path.join(dir,f.parsed?'Parsed':'Source',f.parsed||f.stored));sources.push({id:f.id,name:f.name,role:f.role,parts});}
  if(p.bbText)sources.unshift({id:'BB_Info',name:'BB_Info.md',role:'bb',parts:chunks(p.bbText,12000)});
  const tasks=sources.flatMap(source=>{const parts=source.parts;return parts.map((material,i)=>({source,material,index:i,total:parts.length,label:`${source.name} [${source.id.slice(0,6)}] ${i+1}/${parts.length}`}));});
  p.parallel={phase:'构建课程上下文',limit:settings.contextConcurrency,active:0,completed:0,total:tasks.length,failed:0,peak:0};p.parallelTasks=[];
  const results=await mapPool(tasks,settings.contextConcurrency,async task=>{
   p.parallel.active++;p.parallel.peak=Math.max(p.parallel.peak,p.parallel.active);p.parallelTasks.push(task.label);
   await stage(p,`构建课程上下文 · 已完成 ${p.parallel.completed}/${tasks.length} · 并行 ${p.parallel.active}/${settings.contextConcurrency}`);
   try{const notes=await model.text(`构建课程上下文 · ${task.label}`,prompts.source_normalization,JSON.stringify({source:task.source.name,sourceId:task.source.id,part:task.index+1,totalParts:task.total,material:task.material}));return `[SOURCE ${task.source.id} | ${task.source.name} | part ${task.index+1}]\n${notes}`;}
   catch(e){p.parallel.failed++;throw Error(`${task.label}：${e.message}`);}
   finally{p.parallel.active--;p.parallel.completed++;p.parallelTasks=p.parallelTasks.filter(label=>label!==task.label);await stage(p,`构建课程上下文 · 已完成 ${p.parallel.completed}/${tasks.length} · 并行 ${p.parallel.active}/${settings.contextConcurrency} · 失败 ${p.parallel.failed}`);}
  });
  const failedContexts=results.filter(r=>r.status==='rejected');if(failedContexts.length)throw Error(`${failedContexts.length} 个材料分析任务失败；成功任务已保存，可重试。${failedContexts[0].reason.message}`);
  const sourceNotes=[...integratedNotes,...results.map(r=>r.value),...failed.map(f=>`[Missing source | ${f.name}] 原件保留，当前未解析；不能据此声称已读。`)];p.parallelSummary={...p.parallel};delete p.parallel;delete p.parallelTasks;
  const context=sourceNotes.join('\n\n');

 await save(path.join(dir,'Parsed','context.json'),{sourceNotes,materialRevision:p.materialRevision});
 return {context,sourceNotes,missingMaterials:failed.map(f=>({id:f.id,name:f.name,error:f.error}))};
}
export async function classroom(p,entry,settings,{dir,model,prompts,stage,context}){
 const srt=p.files.find(f=>f.id===entry.srtId&&f.sessionId===entry.id);if(!srt)throw Error('\u8bf7\u5148\u4e0a\u4f20\u672c\u8282\u8bfe\u7684 SRT\u3002');
 const srtBytes=await readFile(path.join(dir,'Source',srt.stored)),cues=parseSrt(srtBytes.toString('utf8'));
 const session={id:entry.id,type:entry.type,title:entry.title,date:entry.date},batches=classroomBatches(cues,{model,prompt:prompts.class_script,session,chunkChars:settings.chunkChars}),segments=[];
 for(let i=0;i<batches.length;i++){
  await stage(p,`\u91cd\u5efa\u8bfe\u5802 \u00b7 ${i+1}/${batches.length}`);
  const result=await reconstructBatch({model,prompt:prompts.class_script,repairPrompt:prompts.class_script_repair,restorePrompt:prompts.class_script_restore,input:{session,context,previousForContinuityOnly:segments.slice(-2),cues:batches[i],part:i+1,totalParts:batches.length},cues:batches[i]});
  segments.push(...result.segments);
 }
 validateSegments(segments,cues);
 const translated=[];
 for(let i=0;i<segments.length;i++){
  await stage(p,`\u751f\u6210\u53cc\u8bed\u8bb2\u7a3f \u00b7 ${i+1}/${segments.length}`);
  const seg=segments[i],answer=await model.object(`生成双语讲稿 · ${i+1}/${segments.length}`,prompts.translation,JSON.stringify({english:seg.english,speaker:seg.speaker}),value=>{if(typeof value?.chinese!=='string'||!value.chinese.trim())throw Error('\u7ffb\u8bd1\u8fd4\u56de\u7f3a\u5c11\u6709\u6548 chinese \u5b57\u6bb5\u3002');});
  translated.push({...seg,chinese:answer.chinese});
 }
 const timeline=transcriptData(entry,srt,srtBytes,translated),audit=contentAudit(segments,cues);timeline.contentAudit=audit;
 const evidence=timeline.paragraphs.map(t=>`[Session ${session.id} | ${session.type} | ${session.title} | SRT ${cues[t.cueIds[0]-1].start} → ${cues[t.cueIds.at(-1)-1].end} | cues ${t.cueIds[0]}–${t.cueIds.at(-1)} | ${t.speaker}]\n[Reconstructed from SRT; not audio-verified] ${t.english}`);
 const base={files:{'Class_Script_Bilingual.md':cleanScript(p.name,entry,timeline),'Transcript_Reader.json':JSON.stringify(timeline)},sourceSrtId:srt.id,sourceSrtHash:timeline.srtHash,evidence,contentAudit:audit,coverage:{cues:cues.length,covered:cues.length,segments:segments.length}};
 return base;
}
