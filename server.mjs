import {translateReference,referenceProgress,referenceMarkdown} from './lib/reference-study.mjs';
import {readingIndex,searchReading} from './lib/reading-index.mjs';
import {registerReadingReferences} from './lib/reading-references.mjs';
import {renderReadingCitations} from './lib/deep-dive.mjs';
import {resolveModel,mergeModelProfiles,validateModelRouting,publicProfiles,taskForStage,migrateModelSettings,acpPathsForSettings,setAcpPaths} from './lib/model-routing.mjs';
import {acpInteraction} from './lib/acp-interaction.mjs';
import {acpRuntime,createAcpPool} from './lib/acp-client.mjs';
import {interactiveJobs} from './lib/acp-jobs.mjs';
import {inspectRecognition,learningFreshness} from './lib/ppt-quality.mjs';
import {PPT_CONTENT_SCHEMA,draftToPage,normalizePptDraft} from './lib/ppt-response.mjs';
import {weeklyTerminology,withTerminology} from './lib/terminology.mjs';
import {recoverMaterialCommits,materialCommitPending} from './lib/material-commit.mjs';
import {budgetObject} from './lib/context-budget.mjs';
import {readerPage,LEARNING_SCHEMA} from './lib/ppt-learning.mjs';
import {compactCoursewareCitations,compactCoursewareGuide} from './lib/courseware-citations.mjs';
import {pageCacheService} from './lib/page-cache.mjs';
import {recoverMineruArchives} from './lib/mineru-recovery.mjs';
import {aiMaterialService,materialSettings} from './lib/ai-material.mjs';
import {localFontService,presentationFonts} from './lib/fonts.mjs';
import {migrateOutputs,outputPath} from './lib/outputs.mjs';
import {weekSummary,weekJournal,pendingWeeks,pendingProject,deleteWeek,renameWeek} from './lib/week-actions.mjs';
import {deletionPlan,deleteSession,renameSession,titledOutput} from './lib/session-actions.mjs';
import {materialDeleteJournal,materialDeletionPlan,deleteMaterial} from './lib/material-delete.mjs';
import {legacyReading} from './lib/reader.mjs';
import {receiveAudio,serveAudio,serveLocalFile} from './lib/audio.mjs';
import {resolveReadingReference} from './lib/reading-index.mjs';
import {migrateReadingCitations} from './lib/reading-references.mjs';
import {loadTranscript,digest} from './lib/transcript.mjs';
import http from 'node:http';
import {readFile,writeFile,mkdir,readdir,rm,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {json,save,atomic,safeName,chunks,parseSrt,cueBatches,parseJson,validateSegments} from './lib/core.mjs';
import {complete,normalize,setChatGPTPlan} from './lib/adapters.mjs';
import {createChatGPTPlan} from './lib/chatgpt-plan.mjs';
import {materialRouteConfigured} from './lib/page-rounds.mjs';
import {testConnection,diagnosticError} from './lib/diagnostics.mjs';
import {pipeline} from './lib/pipeline.mjs';
import {mapPool,semaphore,serialWriter} from './lib/concurrency.mjs';
import {parseReadingPdf,parseSourceOf} from './lib/reading-parse.mjs';
import {contentListDocument,manualDocument,materialParts,contentHash} from './lib/materials.mjs';
import {externalPptDocument,PPT_SCHEMA} from './lib/ppt-import.mjs';
import {pptxSlideCount} from './lib/ppt-count.mjs';
import {migrateWeek,addSession,artifact,stale,validFocus} from './lib/week.mjs';
import {buildContext,classroom,sessionDeepDive,preparation,publish,weekly} from './lib/study.mjs';
import {analysisState,taskKey} from './lib/workflow.mjs';
import {pptPages,pageText,pageImages} from './lib/pages.mjs';
import {bodyParagraphs} from './lib/reader.mjs';
import {storeSource,originalName,sourcePath,migrateSourceNames} from './lib/storage.mjs';
import {previewService,pdfInfo} from './lib/preview.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),DATA=process.env.CLASSROOM_DATA||path.join(ROOT,'data');
await mkdir(path.join(DATA,'classes'),{recursive:true});
try{for(const line of (await readFile(path.join(ROOT,'.env'),'utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}}catch(e){if(e.code!=='ENOENT')throw e;}
const defaults={modelProfiles:[],modelRoutes:{},baseUrl:process.env.LLM_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.LLM_API_KEY||'',model:process.env.LLM_MODEL||'',outputTokenField:'max_completion_tokens',maxOutputTokens:12000,contextChars:180000,chunkChars:6500,mineruMode:'cloud',mineruToken:process.env.MINERU_API_TOKEN||'',mineruModel:'vlm',mineruLanguage:'en',mineruExecutable:'',mineruArgs:['-p','{input}','-o','{output}'],mineruUrl:'',mineruKey:''};
Object.assign(defaults,{modelRoutingVersion:1,defaultProfileId:'',fallbackProfileId:''});
defaults.previewEngine='auto';defaults.libreOfficePath='';defaults.visionEnabled=true;defaults.uploadConcurrency=4;defaults.contextConcurrency=3;defaults.structuredOutput=process.env.LLM_JSON_MODE!=='false';
Object.assign(defaults,{parseBaseUrl:'',parseModel:'',parseApiKey:'',parseConcurrency:2,compactPptImages:false,browserPath:'',fallbackEnabled:false,fallbackBaseUrl:'',fallbackModel:'',fallbackApiKey:''});
const config=async()=>({...defaults,...await json(path.join(DATA,'settings.json'),{})});
const classDir=id=>{if(!/^Week_[\w\-\u0080-\uffff]+$/.test(id)||id.includes('..'))throw Error('无效项目 ID。');return path.join(DATA,'classes',id);};
const getClass=async id=>{classDir(id);const pending=await weekJournal(DATA,id);if(pending)return pendingProject(pending);const p=await json(path.join(classDir(id),'project.json'),null);if(!p)throw Error('课程不存在。');return migrateWeek(p);};
const projectWrites=new Map();
function writeProject(id,change){
 if(!projectWrites.has(id))projectWrites.set(id,serialWriter());
 const file=path.join(classDir(id),'project.json');
 return projectWrites.get(id)(async()=>save(file,change(await json(file,null))));
}
const putClass=(p,{replaceChat=false}={})=>{
 const snapshot=JSON.parse(JSON.stringify(p));
 return writeProject(p.id,latest=>({...snapshot,chat:replaceChat?snapshot.chat:latest?.chat??snapshot.chat}));
};
const skill=async name=>await readFile(path.join(ROOT,'skills',name+'.md'),'utf8');
const active=new Set(),asking=new Map(),requestLocks=new Set(),mineruJobs=new Map(),deletingMaterials=new Set();
const acpJobs=interactiveJobs({autoApprove:true,abandonMs:0});
const chatgptPlan=createChatGPTPlan({data:DATA});
setChatGPTPlan(chatgptPlan);
const previewJobs=interactiveJobs({label:'API',starting:'准备单页试解析'});
const chatgptJobs=interactiveJobs({label:'ChatGPT',starting:'准备 ChatGPT 请求'});
const chatgptBatchJobs=interactiveJobs({label:'ChatGPT',starting:'准备 ChatGPT 生成任务'});
const usesChatGPT=profiles=>profiles.some(profile=>profile.provider==='chatgpt-plan');
async function checkModelConnections(profiles){
 for(const profile of profiles){
  if(!materialRouteConfigured(profile))throw Error('请先在设置中为所需功能保存有效的模型连接。');
 }
 if(usesChatGPT(profiles)&&!(await chatgptPlan.status()).connected)throw Error('请先在模型设置中连接 ChatGPT 订阅。');
}
function modelJobInteraction(job,model){
 const status=(phase,text)=>job.onUpdate({sessionUpdate:'status',phase,text,modelLabel:model},'');
 return {signal:job.signal,status,onRequest:()=>status('submitted','已发送，等待首段正文'),
  onText:text=>job.onUpdate({sessionUpdate:'status',phase:'streaming',text:'正在接收正文',modelLabel:model},text)};
}
const hasAcp=(s,tasks)=>tasks.some(task=>resolveModel(s,task).provider==='antigravity-acp');
function startAcpWorkflow(work,batch){
 if(acpJobs.busy||acpRuntime.busy)throw Error('ACP 正在处理另一项交互，请完成或停止后再试。');
 return acpJobs.start(async options=>{
  if(!batch)return acpInteraction.run(options,()=>work(options));
  const pool=createAcpPool(batch.limit);
  try{return await acpInteraction.run({...options,acquire:pool.acquire,sessionGroup:batch.sessionGroup},()=>work(options));}
  finally{await pool.close();}
 });
}
const readingJobs=id=>[...mineruJobs.values()].filter(job=>job.id===id&&!job.finished);
const readingKey=(id,sourceId)=>JSON.stringify([id,sourceId]);
function editableSource(id,sourceId){
 if(mineruJobs.has(readingKey(id,sourceId)))throw Error('此文件正在由 MinerU 处理，请稍后修改。');
}
async function updateReadingProject(job,change){
 while(requestLocks.has(job.id))await new Promise(resolve=>setTimeout(resolve,50));
 requestLocks.add(job.id);
 try{
  const project=await getClass(job.id);
  change(project,project.files.find(file=>file.id===job.sourceId));
  await putClass(project);
 }finally{requestLocks.delete(job.id);}
}
async function runReading(job,file,settings,force){
 const dir=classDir(job.id),archivePath=path.join(dir,'Parsed',file.id,'mineru_result.zip');
 let error='',parseSource='';
 try{
  const doc=await parseReadingPdf(settings,sourcePath(dir,file.stored),{id:file.id,name:file.name,role:file.role},detail=>{job.progress=detail;},{archivePath,force});
  await save(path.join(dir,'Parsed',file.id,'blocks.json'),doc);parseSource=parseSourceOf(doc);
 }catch(e){error=e.message;}
 await updateReadingProject(job,(project,current)=>{
  const other=readingJobs(job.id).find(item=>item!==job);
  current.parseStatus=error?(current.parsed?'ready':'failed'):'ready';
  current.progress=error?'解析未完成':parseSource==='text-layer'?'已读取 PDF 自带文字':'MinerU 已解析';
  if(error)current.error=error;
  else{current.parsed=file.id+'/blocks.json';current.parsedAt=new Date().toISOString();current.parseSource=parseSource;delete current.error;project.materialRevision++;}
  project.tasks[taskKey('reading',file.id)]={status:error?'error':'complete',...(error?{error}:{}),finished:new Date().toISOString()};
  project.status=other?'running':error?'error':'done';
  project.job={mode:'reading',sourceId:other?.sourceId||file.id};
  project.stage=other?'PDF 解析中':error?'PDF 解析未完成':'PDF 解析完成';
  project.error=other?'':error;
  job.finished=true;
 });
}
const outputNames=['Class_Script_Bilingual.md','Deep_Dive.md'];
const diagnostics=new Map(),previews=previewService(ROOT),localFonts=localFontService();
const pageCache=pageCacheService({root:ROOT,previews,fonts:localFonts});
const materialWrites=new Map();
const materialParser=aiMaterialService({root:ROOT,getClass,dirFor:classDir,previews,pageCache,mutate(id,change){if(!materialWrites.has(id))materialWrites.set(id,serialWriter());return materialWrites.get(id)(async()=>{const p=await getClass(id);change(p);await putClass(p);});}});
function mergeSettings(saved,input){const s={...saved};for(const key of Object.keys(defaults))if(key in input){if(['apiKey','parseApiKey','fallbackApiKey','mineruKey','mineruToken'].includes(key)&&input[key]==='')continue;s[key]=input[key];}s.modelProfiles=mergeModelProfiles(saved,input);if(input.clearApiKey)s.apiKey='';if(input.clearParseApiKey)s.parseApiKey='';if(input.clearFallbackApiKey)s.fallbackApiKey='';if(input.clearMineruKey)s.mineruKey='';if(input.clearMineruToken)s.mineruToken='';return s;}
async function classes(){const results=[];for(const d of await readdir(path.join(DATA,'classes'),{withFileTypes:true})){if(d.isDirectory()){const p=await json(path.join(DATA,'classes',d.name,'project.json'),null);if(p)results.push(migrateWeek(p));}}for(const pending of await pendingWeeks(DATA)){const index=results.findIndex(p=>p.id===pending.id),value=pendingProject(pending);if(index<0)results.push(value);else results[index]=value;}return results.sort((a,b)=>b.created.localeCompare(a.created));}
for(const p of await classes()){await recoverMaterialCommits(classDir(p.id),async change=>{const current=await getClass(p.id);change(current);await putClass(current);Object.assign(p,current);});if(p.weekDeletionPending||await materialDeleteJournal(classDir(p.id)))continue;for(const f of p.files)if(f.aiParse?.status==='running'){f.aiParse.status='interrupted';f.aiParse.stage='上次解析被中断，可继续';f.aiParse.tasks={};f.progress='解析中断，可继续';}await migrateSourceNames(p,classDir(p.id),putClass);await migrateOutputs(p,classDir(p.id),putClass);const pending=await json(path.join(classDir(p.id),'.session-delete.json'),null);if(pending){p.deletionPending={sessionId:pending.sessionId,summary:pending.summary};p.status='error';p.stage='课堂删除未完成';}if(p.status==='running'){for(const f of p.files)if(f.parseStatus==='running'&&p.tasks?.[taskKey('reading',f.id)]?.status==='running'){f.parseStatus=f.parsed?'ready':'pending';delete f.progress;}for(const task of Object.values(p.tasks||{}))if(task.status==='running'){task.status='interrupted';task.error='Previous task was interrupted; saved results are available.';}p.status='interrupted';p.stage='上次处理被中断；原始材料和已有输出已保留，可重新处理。';}await recoverMineruArchives(p,classDir(p.id),putClass);await putClass(p);await migrateReadingCitations(p,classDir(p.id));}
async function updateStage(p,text){p.stage=text;p.updated=new Date().toISOString();await putClass(p);}
async function run(p,settings,{origin,fresh=false,mode='preparation',sessionId,sessionIds,sourceId,referenceProvider,signal,onProgress}={}){
 const dir=classDir(p.id);let model;const warnings=[],usedModels={};
 const stage=async(project,text)=>{signal?.throwIfAborted();onProgress?.(text);await updateStage(project,text);};
 try{
  signal?.throwIfAborted();
  if(mode==='session'){const entry=p.sessions.find(s=>s.id===sessionId),file=p.files.find(f=>f.id===entry?.srtId);parseSrt(await readFile(sourcePath(dir,file.stored),'utf8'));}

  // On preparation, upgrade old visual reports to the integrated learning
  // contract. Explicit partial imports remain partial until the user resumes.
  const pending=mode==='preparation'?p.files.filter(f=>f.role==='ppt'&&(!f.parsed||settings.visionEnabled!==false&&f.externalAnalysis)):[];
  if(settings.visionEnabled===false&&pending.some(f=>!f.parsed))throw Error('PPT 尚未解析；关闭视觉解析时，请先导入对应的解析 JSON。');
  if(pending.length){
   const readings=p.files.filter(f=>f.role!=='ppt'&&f.role!=='srt'&&f.role!=='audio'&&!f.parsed&&/\.pdf$/i.test(f.name));
   const gate=semaphore(settings.uploadConcurrency);const parsed=await mapPool(readings,settings.uploadConcurrency,async f=>{
    try{
    await stage(p,'解析 Reading · '+f.name);const archivePath=path.join(dir,'Parsed',f.id,'mineru_result.zip');let doc;
    let archive;try{archive=await readFile(archivePath);}catch(e){if(e.code!=='ENOENT')throw e;}
    const source={id:f.id,name:f.name,role:f.role};doc=archive?(await import('./lib/materials.mjs')).archiveDocument(archive,source):await parseReadingPdf(settings,sourcePath(dir,f.stored),source,async detail=>{f.progress=detail;await stage(p,'解析 Reading · '+f.name+' · '+detail);},{archivePath,uploadGate:gate,signal});
    f.parsed=f.id+'/blocks.json';f.parseSource=parseSourceOf(doc);await save(path.join(dir,'Parsed',f.parsed),doc);f.parseStatus='ready';await putClass(p);
    }catch(e){f.parseStatus='failed';f.error=e.message;await putClass(p);throw e;}
   });const failed=parsed.find(r=>r.status==='rejected');if(failed&&settings.visionEnabled===false)throw failed.reason;
  }
  if(pending.length){await stage(p,'解析材料 · AI 解析 PPT');const jobs=await Promise.all(pending.map(f=>materialParser.start(p.id,f.id,settings,{origin,signal})));const results=await Promise.allSettled(jobs.map(j=>j.done));Object.assign(p,await getClass(p.id));signal?.throwIfAborted();if(results.some(r=>r.status==='rejected'))throw Error('PPT 解析未全部完成，请查看材料行的问题说明并继续解析。PPT 不会上传 MinerU。');}
  if(pending.length>1){
   // All parallel decks see the same frozen terminology snapshot. Reconciliation
   // only opens review batches containing changed relevant terms, never OCR.
   const weeklyTermsSnapshot=await weeklyTerminology(p,dir,{forReview:true});await stage(p,'合并本周术语');
   const jobs=await Promise.all(pending.map(f=>materialParser.start(p.id,f.id,settings,{origin,weeklyTermsSnapshot,signal})));
   const outcomes=await Promise.allSettled(jobs.map(j=>j.done));
   Object.assign(p,await getClass(p.id));
   const failed=outcomes.find(result=>result.status==='rejected');
   if(failed)throw failed.reason;
  }
  const prompts={};for(const name of ['source_normalization','class_script','translation','deep_dive','deep_dive_plan','ppt_translation','ppt_close_reading','weekly_synthesis','class_script_repair','class_script_restore','reference_translation'])prompts[name]=await skill(name);
  const rootTask=mode==='session'?'classroom':mode==='analysis'?'deepDive':mode==='week'?'weeklyDeepDive':mode==='reference'?'referenceTranslation':'pptExplanation',resolved=resolveModel(settings,rootTask),rawModel=await pipeline(dir,{...resolved,modelProfiles:settings.modelProfiles,redactionKeys:[settings.apiKey,settings.parseApiKey,settings.fallbackApiKey]},{fresh,scope:['session','analysis'].includes(mode)?mode+':'+sessionId:mode==='reference'?'reference:'+sourceId:mode,onStatus:text=>stage(p,text),signal});
  const routeFor=(name,override)=>{const task=taskForStage(mode,name),actual=override||resolveModel(settings,task);usedModels[task]={model:actual.model,baseUrl:actual.baseUrl,profileId:actual.profileId||null};return actual;};
  const routed={text:(n,sys,u,o)=>rawModel.text(n,sys,u,{...o,provider:routeFor(n,mode==='reference'?o?.provider:undefined)}),object:(n,sys,u,v,o)=>rawModel.object(n,sys,u,v,{...o,provider:routeFor(n,mode==='reference'?o?.provider:undefined)}),cachedObject:(n,sys,u,v,o)=>rawModel.cachedObject(n,sys,u,v,o),remaining:rawModel.remaining,finish:rawModel.finish};
  model=withTerminology(routed,await weeklyTerminology(p,dir),await skill('terminology'));
  const common={dir,model,prompts,stage,putClass,sessionIds,signal,existingOnly:mode!=='preparation',allowIncompleteMaterials:mode==='preparation'&&p.files.some(f=>f.role==='ppt'&&f.parsed)};
  const {context,missingMaterials}=mode==='reference'?{context:'',missingMaterials:[]}:await buildContext(p,settings,common);common.context=context;if(missingMaterials.length)warnings.push('部分材料未解析：'+missingMaterials.map(f=>f.name).join('、'));
  let referencePartial=false;
  if(mode==='reference'){const file=p.files.find(f=>f.id===sourceId&&f.role==='reading');if(!file)throw Error('请选择参考文献。');const summary=await translateReference(p,file,settings,{...common,referenceProvider});referencePartial=summary.blocked>0;if(referencePartial)warnings.push(`${summary.blocked} 块被模型过滤，已保留原文，可仅补译缺失块。`);
  }else if(mode==='preparation'){
   const result=await preparation(p,settings,common);signal?.throwIfAborted();await publish(p,'preparation',result.files,{pages:result.pages,readerVersion:result.readerVersion},common);
  }else if(mode==='session'){
   const entry=p.sessions.find(s=>s.id===sessionId);if(!entry)throw Error('课堂不存在。');
   const previous=analysisState(p,entry).available?{...entry.analysis,generation:entry.analysis?.generation||entry.generation,materialRevision:entry.analysis?.materialRevision??entry.materialRevision,scriptGeneration:entry.analysis?.scriptGeneration||entry.generation,outputRevision:entry.analysis?.outputRevision??entry.outputRevision}:null;
   const result=await classroom(p,entry,settings,common);
   signal?.throwIfAborted();
   await publish(p,sessionId,result.files,{merge:true,kind:'script',evidence:result.evidence,coverage:result.coverage,sourceSrtId:result.sourceSrtId,sourceSrtHash:result.sourceSrtHash,contentAudit:result.contentAudit,analysis:previous,artifactStatus:{script:'complete',deepDive:previous?'complete':'not_generated'}},common);
   // Keep the legacy endpoint available without changing older output files.
   p.generation=p.sessions.find(s=>s.id===sessionId).generation;p.coverage=result.coverage;p.outputRevision=p.revision;await putClass(p);
  }else if(mode==='analysis'){
   const entry=p.sessions.find(s=>s.id===sessionId),analysis=await sessionDeepDive(p,entry,common);
   signal?.throwIfAborted();
   await publish(p,sessionId,{'Deep_Dive.md':analysis.text},{merge:true,kind:'analysis',artifactStatus:{script:'complete',deepDive:'complete'},analysisError:'',analysis:analysis.metadata},common);
  }else if(mode==='week')await weekly(p,settings,common);
  await model.finish?.();
  p.status=warnings.length?'partial':'done';p.stage=mode==='preparation'?'PPT 导读已完成':mode==='session'?'本节讲稿已完成':mode==='analysis'?'本节 Deep Dive 已完成':mode==='reference'?(referencePartial?'参考文献部分已翻译，待补译':'参考文献翻译已完成'):'整周 Deep Dive 已完成';p.warnings=warnings;p.error='';delete p.parallel;delete p.parallelTasks;p.tasks[taskKey(mode,mode==='reference'?sourceId:sessionId)]={status:referencePartial?'partial':'complete',finished:new Date().toISOString(),warnings,models:usedModels};await putClass(p);
 }catch(e){p.status='error';p.error=signal?.aborted?'任务已停止，可以继续；已保存完成的步骤。':e.message;p.failedStage=p.stage;p.tasks[taskKey(mode,mode==='reference'?sourceId:sessionId)]={status:'error',error:p.error,stage:p.stage,finished:new Date().toISOString()};p.stage='本次任务未完成；已有结果保留';await putClass(p);}
 finally{active.delete(p.id);}
}
async function ask(p,question,settings,{scope='week',focus=null,...interaction}={}){
 settings=resolveModel(settings,'qa');
 if(await materialCommitPending(classDir(p.id)))throw Error('材料结果正在提交，请稍后再提问或重启以恢复提交。');
 artifact(p,scope);focus=validFocus(p,scope,focus);
 const dir=classDir(p.id),context=await json(path.join(dir,'Parsed','context.json'),{sourceNotes:[]}),pool=[];
 const focusFile=focus?.sourceId?p.files.find(f=>f.id===focus.sourceId):null;
 if(focusFile&&!focusFile.parsed)throw Error(focusFile.parseStatus==='running'?'这份文件正在解析，结果就绪后即可提问。':'请先解析选中的材料，再提问。');
 if(focusFile){const doc=await json(path.join(dir,'Parsed',focusFile.parsed),null);if(doc?.externalPpt?.originalSource?.sha256&&doc.externalPpt.originalSource.sha256.toLowerCase()!==contentHash(await readFile(sourcePath(dir,focusFile.stored))))throw Error('PPT 原件已有变更，请重新导入解析 JSON 后提问。');}
 const sessions=scope==='preparation'?[]:scope==='week'?p.sessions:p.sessions.filter(s=>s.id===scope);
 for(const f of p.files){
  if(focusFile&&f.id!==focusFile.id)continue;
  if(f.role==='srt'&&!sessions.some(s=>s.id===f.sessionId&&s.srtId===f.id))continue;
  if(f.role==='bb'&&/\.(md|txt)$/i.test(f.name)||f.role==='srt'||f.parsed)(await materialParts(path.join(dir,f.parsed?'Parsed':'Source',f.parsed||f.stored),4500)).forEach((text,i)=>pool.push({source:f.name,sourceId:f.id,sessionId:f.sessionId,part:i+1,text}));
 }
 if(p.bbText&&!focusFile)chunks(p.bbText,4500).forEach((text,i)=>pool.push({source:'BB_Info.md',part:i+1,text}));
 const scopes=focusFile?[]:scope==='week'?['preparation',...sessions.map(s=>s.id),'week']:[scope];
 for(const selectedScope of scopes){const a=artifact(p,selectedScope);if(!a.value?.generation)continue;for(const name of a.names.filter(name=>name!=='Deep_Dive.md'||!a.value.artifactStatus||a.value.artifactStatus.deepDive==='complete')){const revision=name==='Deep_Dive.md'?(a.value.analysis?.materialRevision??a.value.materialRevision):a.value.materialRevision;if(p.lastMaterialDeletionRevision&&(revision??0)<p.lastMaterialDeletionRevision)continue;const text=await readFile(outputPath(dir,p,selectedScope,name),'utf8');chunks(text,4500).forEach((text,i)=>pool.push({source:name,scope:selectedScope,secondary:true,stale:name==='Deep_Dive.md'?analysisState(p,a.value).stale:stale(p,selectedScope),part:i+1,text}));}}
 let images=[],focusedEvidence=null;
 if(focus?.kind==='file')focusedEvidence={sourceId:focusFile.id,source:focusFile.name,scope:'whole PPT; selected original passages and material notes, not exhaustive full text'};
 if(focus?.kind==='page'&&focusFile.role==='ppt'){
  const file=p.files.find(f=>f.id===focus.sourceId),page=(await pptPages(dir,file)).find(p=>p.pageIndex===focus.pageIndex);if(!page)throw Error('页面不存在。');
  focusedEvidence={sourceId:file.id,source:file.name,pageIndex:page.pageIndex,text:pageText(page)};
  if(settings.visionEnabled){if(file.externalAnalysis){const visual=await pageCache.page(dir,file,settings,{origin:'http://127.0.0.1:'+server.address().port,index:page.pageIndex});images=['data:image/png;base64,'+visual.bytes.toString('base64')];focusedEvidence.visualCoverage='Shared full-page preview supplied; warnings: '+(visual.seed.warnings||[]).join('; ');}else{const visual=await pageImages(dir,file,page);images=visual.images;focusedEvidence.visualCoverage=visual.note;}}
 }
 let referenceEvidence=[];
 if(focusFile?.role==='reading'){
  const index=await readingIndex(p,dir),subset={...index,sources:index.sources.filter(s=>s.sourceId===focusFile.id),units:index.units.filter(u=>u.sourceId===focusFile.id&&(focus.kind!=='page'||u.pageIndex===focus.pageIndex))};
  if(!subset.units.length)throw Error('这页没有可用原文，请核对页码或补充解析。');referenceEvidence=searchReading(subset,[question]).map((e,i)=>({...e,cite:'R'+(i+1)}));const refs=await registerReadingReferences(dir,referenceEvidence.map(e=>e.reference));referenceEvidence=referenceEvidence.map(e=>({...e,reference:refs.get(e.reference)}));pool.length=0;for(const e of referenceEvidence)pool.push({source:e.source,sourceId:e.sourceId,pageIndex:e.pageIndex,printedPage:e.printedPage,cite:e.cite,text:e.text});focusedEvidence={sourceId:focusFile.id,source:focusFile.name,kind:focus.kind,pageIndex:focus.pageIndex,scope:'selected original passages from this reference only; not exhaustive reading'};
 }
 const terms=[...new Set(question.toLowerCase().match(/[a-z0-9]{2,}|[\u3400-\u9fff]/g)||[])];
 const ranked=pool.map((v,index)=>({...v,index,score:terms.reduce((n,t)=>n+v.text.toLowerCase().split(t).length-1,0)})).sort((a,b)=>b.score-a.score||a.index-b.index);
 const system=await skill('qa')+'\n\n'+await skill('terminology'),weeklyTerms=await weeklyTerminology(p,dir),focusKey=JSON.stringify(focus),history=(p.chat||[]).filter(e=>(!p.materialDeletedAt||e.at>=p.materialDeletedAt)&&(e.scope||'week')===scope&&JSON.stringify(e.focus||null)===focusKey).slice(-8);
 const rawBase={question,scope,focusedEvidence,weeklyTerminology:weeklyTerms,sourceNotes:!focusFile&&context.materialRevision===p.materialRevision?context.sourceNotes:[],history,coverage:{totalPassages:pool.length,selectedPassages:0,method:'lexical retrieval; scoped source notes plus selected passages',scope,materialsChanged:context.materialRevision!==p.materialRevision}};
 const base=budgetObject({remaining:(sys,user)=>settings.contextChars-sys.length-user.length-3000},system,rawBase,{query:question,fields:['sourceNotes','history']});
 let available=settings.contextChars-system.length-JSON.stringify(base).length-3000;if(available<1000)throw Error('本次问题或课程摘要过长，请提高上下文字符上限或缩小问题范围。');
 if(!pool.length&&!focusedEvidence)throw Error('请先生成预习或整理课堂，以便解析本周材料。');
 const selected=[];for(const v of ranked){const length=JSON.stringify(v).length;if(length<=available){selected.push(v);available-=length;}}
 base.coverage.selectedPassages=selected.length;let answer=await complete(settings,system,JSON.stringify({...base,passages:selected}),{images,...interaction});interaction.signal?.throwIfAborted();if(referenceEvidence.length)answer=renderReadingCitations(answer,referenceEvidence.filter(e=>selected.some(p=>p.cite===e.cite)),p.id).text;
 const contextLabel=focusFile?(focus.kind==='page'?focusFile.name+' · 第 '+(focus.pageIndex+1)+' 页':focusFile.name+(focusFile.role==='reading'?' · 整篇参考文献':' · 整份课件')):scope==='week'?'本周课':scope==='preparation'?'本周教学材料':p.sessions.find(s=>s.id===scope)?.title;
 const metadata={scope,focus,contextLabel,at:new Date().toISOString(),requestId:randomUUID()};
 const messages=[{role:'user',text:question,...metadata},{role:'assistant',text:answer,...metadata,coverage:base.coverage}];
 await writeProject(p.id,latest=>({...latest,chat:[...(latest.chat||[]),...messages]}));
 return {answer,coverage:base.coverage,messages};
}
const respond=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req,limit=2*1024*1024){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>limit)throw Error('文件过大。单文件上限 150 MB；文本请求上限 2 MB。');parts.push(part);}return Buffer.concat(parts);}
const payload=async req=>JSON.parse((await body(req)).toString('utf8')||'{}');
function editable(id){if(active.has(id)||materialParser.busy(id)||pageCache.busy(classDir(id)))throw Error('此课程正在处理请求，请稍后再修改。');}
function deletable(id){
 editable(id);
 if(asking.has(id)||readingJobs(id).length)throw Error('此课程还有后台任务，请等待完成后再删除。');
}
function validateSettings(s){validateModelRouting(s);
 if(!['auto','powerpoint','libreoffice','manual'].includes(s.previewEngine))throw Error('无效预览转换方式。');
 if(typeof s.visionEnabled!=='boolean')throw Error('图片分析开关无效。');
 if(typeof s.structuredOutput!=='boolean')throw Error('结构化输出设置必须为布尔值。');
 if(typeof s.fallbackEnabled!=='boolean')throw Error('备用模型开关无效。');
 if(s.fallbackEnabled&&!(s.modelRoutingVersion===2?s.fallbackProfileId:s.fallbackModel.trim()))throw Error('开启文献备用前请先选择备用模型。');
 for(const key of ['fallbackBaseUrl','fallbackApiKey','fallbackModel','parseBaseUrl','parseApiKey','parseModel','browserPath','baseUrl','apiKey','model','mineruExecutable','mineruUrl','mineruKey','mineruToken','mineruLanguage','libreOfficePath'])if(typeof s[key]!=='string')throw Error(`${key} 必须为文字。`);
 if(typeof s.compactPptImages!=='boolean')throw Error('课件传输图设置无效。');
 if(!Number.isInteger(s.parseConcurrency)||s.parseConcurrency<1||s.parseConcurrency>4)throw Error('材料解析并发数应为 1–4。');
 for(const key of ['baseUrl','parseBaseUrl','fallbackBaseUrl','mineruUrl'])if(s[key]){const u=new URL(s[key]);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('服务地址必须为 HTTP(S)，且不能在地址中嵌入凭据。');}
 for(const [key,min,max] of [['maxOutputTokens',1000,100000],['contextChars',20000,2000000],['chunkChars',1500,15000]])if(!Number.isInteger(s[key])||s[key]<min||s[key]>max)throw Error(`${key} 必须在 ${min}–${max} 之间。`);
 for(const key of ['uploadConcurrency','contextConcurrency'])if(!Number.isInteger(s[key])||s[key]<1||s[key]>8)throw Error(`${key} 必须为 1–8 的整数。`);
 if(!Array.isArray(s.mineruArgs)||s.mineruArgs.some(x=>typeof x!=='string'))throw Error('MinerU 参数应为 JSON 字符串数组。');
 if(!['cloud','cli','service'].includes(s.mineruMode))throw Error('无效 MinerU 模式。');
 if(!['vlm','pipeline'].includes(s.mineruModel))throw Error('无效 MinerU 模型。');
 if(!['max_completion_tokens','max_tokens'].includes(s.outputTokenField))throw Error('无效输出 token 参数。');
}
const server=http.createServer(async(req,res)=>{
 let lockedId;
 try{
  const host=req.headers.host;if(!/^127\.0\.0\.1:\d+$/.test(host||''))return respond(res,403,{error:'只允许本机访问。'});
  if(req.headers.origin&&req.headers.origin!==`http://${host}`)return respond(res,403,{error:'拒绝跨站请求。'});
  const url=new URL(req.url,`http://${host}`),parts=url.pathname.split('/').filter(Boolean),method=req.method;
  if(parts[0]==='api'&&parts[1]==='parse-resource'&&method==='GET'){
   const resource=materialParser.resource(parts[2]);if(!resource)return respond(res,404,{error:'渲染资源已失效'});
   if(parts[3]==='native')return respond(res,200,resource.nativeParts);
   if(parts[3]!=='file')return respond(res,404,{error:'无效渲染资源'});
   res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(resource.bytes);
  }
  if(parts[0]==='api'&&parts[1]==='preview-font'&&parts.length===3&&method==='GET'){const bytes=await localFonts.bytes(parts[2]);res.writeHead(200,{'Content-Type':'font/ttf','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
  if(url.pathname==='/api/ppt-skill'&&method==='GET'){res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="course-ppt-parser.zip"'});return res.end(await readFile(path.join(ROOT,'resources','course-ppt-parser.zip')));}
  if(url.pathname==='/api/chatgpt/status'&&method==='GET')return respond(res,200,await chatgptPlan.status());
  if(url.pathname==='/api/chatgpt/login'&&method==='POST')return respond(res,200,await chatgptPlan.start({reconsent:(await payload(req)).reconsent===true}));
  if(url.pathname==='/api/chatgpt/disconnect'&&method==='POST')return respond(res,200,await chatgptPlan.disconnect());
  if(url.pathname==='/api/chatgpt/models'&&method==='GET')return respond(res,200,await chatgptPlan.models());
  if(parts[0]==='api'&&['chatgpt','preview'].includes(parts[1])&&parts[2]==='jobs'&&parts[3]){
   const jobs=parts[1]==='preview'?previewJobs:chatgptBatchJobs.has(parts[3])?chatgptBatchJobs:chatgptJobs;
   if(method==='GET'&&parts.length===4)return respond(res,200,jobs.get(parts[3]));
   if(method==='POST'&&parts.length===5&&parts[4]==='cancel')return respond(res,200,jobs.cancel(parts[3]));
  }
  if(url.pathname==='/api/settings/editor'){
   const saved=await config();let s=migrateModelSettings(saved);
   if(method==='POST'){
    const b=await payload(req);
    if(b.section==='model'){
     const p=b.profile;if(!p?.id)throw Error('模型编号无效。');
     s.modelProfiles=mergeModelProfiles(s,{modelProfiles:[...s.modelProfiles.filter(x=>x.id!==p.id),p]});
     if(p.provider==='antigravity-acp'&&b.acpPaths!==undefined)setAcpPaths(s,b.acpPaths);
    }
    else if(b.section==='delete-model'){const id=b.profileId;s.modelProfiles=s.modelProfiles.filter(p=>p.id!==id);if(s.defaultProfileId===id)s.defaultProfileId='';if(s.fallbackProfileId===id){s.fallbackProfileId='';s.fallbackEnabled=false;}for(const task of Object.keys(s.modelRoutes))if(s.modelRoutes[task]===id)s.modelRoutes[task]='';}
    else {const allowed={models:['defaultProfileId'],routes:['modelRoutes','fallbackProfileId','fallbackEnabled'],mineru:['mineruToken','clearMineruToken','mineruLanguage','uploadConcurrency'],preview:['previewEngine','browserPath','libreOfficePath'],advanced:['contextConcurrency','parseConcurrency','compactPptImages','chunkChars','structuredOutput']}[b.section];if(!allowed)throw Error('无效设置分类。');s=mergeSettings(s,Object.fromEntries(allowed.filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]])));}
    validateSettings(s);await save(path.join(DATA,'settings.json'),s);
   }else if(method!=='GET')throw Error('无效设置操作。');
   const bundled=path.join(ROOT,'agy-acp-server','agy_acp_server.exe'),acpBundled=await access(bundled).then(()=>bundled,()=>'');
   return respond(res,200,{...s,acpBundled,acpPaths:acpPathsForSettings(s),modelProfiles:publicProfiles(s),apiKey:undefined,parseApiKey:undefined,fallbackApiKey:undefined,mineruKey:undefined,mineruToken:undefined,hasMineruToken:!!s.mineruToken});
  }
  if(url.pathname==='/api/settings/acp-logout'&&method==='POST'){
   const input=await payload(req);
   if(input.confirm!==true)throw Error('请先确认退出共享的 Antigravity 账号。');
   const settings=await config();
   const selected=settings.modelProfiles.find(p=>p.provider==='antigravity-acp'&&p.id===input.profileId);
   if(!selected)throw Error('请先保存并选择 Antigravity 模型连接。');
   if(acpJobs.busy||acpRuntime.busy)throw Error('请先完成或停止正在运行的 ACP 任务，再退出登录。');
   const profile={...selected,acpExecutable:acpPathsForSettings(settings)[selected.acpEntry]||selected.acpExecutable};
   return respond(res,200,await acpRuntime.run(profile,{action:'logout'}));
  }
  if(url.pathname==='/api/settings/model-test'&&method==='POST'){
   const b=await payload(req),saved=migrateModelSettings(await config());if(!['ai','text','json','vision','inspect','login'].includes(b.kind))throw Error('无效测试类型。');
   const profiles=mergeModelProfiles(saved,{modelProfiles:[b.profile]}),profile=profiles[0];
   const probe={...saved,acpPaths:undefined,modelProfiles:profiles,defaultProfileId:'',fallbackProfileId:'',modelRoutes:{qa:profile.id}};
   validateModelRouting(probe);
   const selected=resolveModel(probe,'qa');
   if(selected.provider==='chatgpt-plan'){
    if(!['ai','text','json','vision'].includes(b.kind))throw Error('请使用 ChatGPT 的独立登录和模型列表按钮。');
    if(chatgptJobs.busy)throw Error('已有 ChatGPT 请求正在进行，请等待完成或停止。');
    return respond(res,202,{...chatgptJobs.start(async job=>{
     const interaction=modelJobInteraction(job,selected.model);
     const message=await testConnection(b.kind,selected,text=>interaction.status('testing',text),job.signal,interaction);
     return {message};
    }),transport:'chatgpt'});
   }
   if(selected.provider==='antigravity-acp'){
    if(!['ai','text','json','vision','inspect','login'].includes(b.kind))throw Error('无效 ACP 测试类型。');
    if(acpJobs.busy||acpRuntime.busy)throw Error('ACP 正在处理另一项交互，请完成或停止后再试。');
    return respond(res,202,{...acpJobs.start(options=>['inspect','login'].includes(b.kind)?acpRuntime.run(selected,{...options,action:b.kind}):testConnection(b.kind,selected,async text=>options.onUpdate({sessionUpdate:'status',text},''),options.signal,options).then(message=>({message}))),transport:'acp'});
   }
   if(!['ai','text','json','vision'].includes(b.kind))throw Error('API 连接不使用账号登录。');
   const job={id:randomUUID(),status:'running',stage:'准备测试',started:Date.now(),updated:Date.now(),limitSeconds:60},controller=new AbortController();diagnostics.set(job.id,job);job.controller=controller;const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);
   testConnection(b.kind,{...selected,parseBaseUrl:selected.baseUrl,parseApiKey:selected.apiKey,parseModel:selected.model},async text=>{job.stage=text;job.updated=Date.now();},signal).then(message=>{job.status='success';job.message=message;}).catch(e=>{job.status='error';job.message=controller.signal.aborted?'\u6d4b\u8bd5\u5df2\u505c\u6b62\u3002':diagnosticError(e,signal,selected);}).finally(()=>job.finished=Date.now());return respond(res,202,{...job,controller:undefined,transport:'api'});
  }
  if(parts[0]==='api'&&parts[1]==='settings'&&parts[2]==='test'&&parts[3]&&parts[4]==='cancel'&&method==='POST'){diagnostics.get(parts[3])?.controller?.abort();return respond(res,200,{ok:true});}
  if(url.pathname==='/api/acp/connect'&&method==='POST'){
   const b=await payload(req);if(!['inspect','login','text','vision'].includes(b.action))throw Error('无效 ACP 操作。');
   const s=mergeSettings(await config(),b.settings||{});validateSettings(s);const profile=s.modelProfiles.find(p=>p.id===b.profileId&&p.provider==='antigravity-acp');if(!profile)throw Error('请选择 ACP 连接。');
   const selected=resolveModel({...s,modelRoutes:{...s.modelRoutes,qa:profile.id}},'qa');
   if(acpRuntime.busy||acpJobs.busy)throw Error('ACP 正在处理另一项交互，请等待完成或取消。');
   return respond(res,202,acpJobs.start(async options=>{
    if(['inspect','login'].includes(b.action))return acpRuntime.run(selected,{...options,action:b.action});
    const message=await testConnection(b.action==='vision'?'vision':'ai',selected,async text=>options.onUpdate({sessionUpdate:'status',text},''),options.signal,options);return {message};
   }));
  }
  if(parts[0]==='api'&&parts[1]==='acp'&&parts[2]==='jobs'&&parts[3]){
   if(method==='GET'&&parts.length===4)return respond(res,200,acpJobs.get(parts[3]));
   if(method==='POST'&&parts[4]==='cancel')return respond(res,200,acpJobs.cancel(parts[3]));
   if(method==='POST'&&parts[4]==='permission'){const b=await payload(req);return respond(res,200,acpJobs.decide(parts[3],b.permissionId,b.optionId));}
  }
  if(url.pathname==='/api/settings/test'&&method==='POST'){
   if([...diagnostics.values()].some(j=>j.status==='running'))throw Error('已有连接测试正在进行，请等待结束。');
   const b=await payload(req);if(!['ai','vision','fallback-vision','mineru','mineru-connection'].includes(b.kind))throw Error('无效测试类型。');
   let s=mergeSettings(await config(),b.settings||{});validateSettings(s);if(b.task){s=resolveModel(s,b.task);s={...s,parseBaseUrl:s.baseUrl,parseModel:s.model,parseApiKey:s.apiKey};}
   if(s.provider==='antigravity-acp')throw Error('请使用 ACP 连接内的交互式测试按钮。');
   for(const [id,j] of diagnostics)if(j.status!=='running')diagnostics.delete(id);
   const job={id:randomUUID(),kind:b.kind,status:'running',stage:'准备测试',started:Date.now(),updated:Date.now(),limitSeconds:b.kind==='mineru'?120:60};diagnostics.set(job.id,job);
   const signal=AbortSignal.timeout(job.limitSeconds*1000);
   testConnection(b.kind,s,async text=>{job.stage=text;job.updated=Date.now();},signal).then(message=>{job.status='success';job.message=message;}).catch(e=>{job.status='error';job.message=diagnosticError(e,signal,s);}).finally(()=>{job.finished=Date.now();});
   return respond(res,202,job);
  }
  if(parts[0]==='api'&&parts[1]==='settings'&&parts[2]==='test'&&parts[3]&&method==='GET'){const job=diagnostics.get(parts[3]);if(!job)return respond(res,404,{error:'测试记录不存在或服务已重启。'});return respond(res,200,job);}
  if(url.pathname==='/api/settings'){
   if(method==='GET'){const s=await config();return respond(res,200,{...s,modelProfiles:publicProfiles(s),apiKey:undefined,fallbackApiKey:undefined,hasFallbackApiKey:!!s.fallbackApiKey,parseApiKey:undefined,hasParseApiKey:!!s.parseApiKey,mineruKey:undefined,mineruToken:undefined,hasApiKey:!!s.apiKey,hasMineruKey:!!s.mineruKey,hasMineruToken:!!s.mineruToken});}
   if(method==='POST'){const input=await payload(req),s=mergeSettings(await config(),input);validateSettings(s);await save(path.join(DATA,'settings.json'),s);return respond(res,200,{ok:true});}
  }
  if(url.pathname==='/api/projects'){
   if(method==='GET')return respond(res,200,await classes());
   if(method==='POST'){const b=await payload(req),name=safeName(b.name||'Untitled'),id=`Week_${name.replace(/[^\w\-\u0080-\uffff]/g,'_')}_${randomUUID().slice(0,8)}`;const p={id,name,created:new Date().toISOString(),status:'idle',stage:'等待添加课程材料',files:[],bbText:'',revision:0,materialRevision:0,schemaVersion:2,sourceLayoutVersion:1,sessions:[],chat:[]};for(const d of ['Source','Parsed','Output'])await mkdir(path.join(classDir(id),d),{recursive:true});await putClass(p);return respond(res,201,p);}
  }
  if(parts[0]==='api'&&parts[1]==='projects'&&parts[2]){
   const id=decodeURIComponent(parts[2]);
   if(method==='POST'){if(requestLocks.has(id))throw Error('此课程正在保存，请稍后重试。');if(!['ask','ai-parse','ai-parse-cancel'].includes(parts[3])){requestLocks.add(id);lockedId=id;if(parts[3]==='material-delete')deletingMaterials.add(id);}}
   let p=await getClass(id);const dir=classDir(id),action=parts[3];
   const pendingMaterial=p.weekDeletionPending?null:await materialDeleteJournal(dir);
   if(pendingMaterial&&!action&&method==='GET')return respond(res,200,{...p,materialDeletionPending:{sourceId:pendingMaterial.sourceId,...pendingMaterial.summary}});
   if((pendingMaterial||deletingMaterials.has(id))&&action&&!['material-delete','material-delete-plan'].includes(action))throw Error('请先完成待清理的材料删除。');
   if(['reader','analysis','ask','process','output','transcript','parsed','reading-reference-data','reading-pdf','reference-reader','reference-file'].includes(action)&&await materialCommitPending(dir))return respond(res,409,{error:'材料结果正在提交；若持续出现，请重启以恢复完整提交。'});
   if((method==='POST'||['output','transcript','reader'].includes(action))&&await json(path.join(dir,'.output-transaction.json'),null))return respond(res,409,{error:'结果正在提交；如果此提示持续出现，请重启软件完成恢复。'});
   if(!action&&method==='GET'){
    for(const job of readingJobs(id)){
     const file=p.files.find(file=>file.id===job.sourceId);
     if(file?.parseStatus==='running')file.progress=job.progress;
    }
    return respond(res,200,p);
   }
   if(p.weekDeletionPending&&!['week-delete','week-delete-plan'].includes(action))throw Error('整周课程尚未删除完成，请先继续删除。');
   if(action==='reading-reference'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});return res.end(await readFile(path.join(ROOT,'public','reading-reference.html')));}
   if(action==='reading-reference-data'&&method==='GET'){const data=await resolveReadingReference(p,dir,url.searchParams.get('ref'));const {file,...publicData}=data;return respond(res,200,publicData);}
   if(action==='reading-pdf'&&['GET','HEAD'].includes(method)){const data=await resolveReadingReference(p,dir,url.searchParams.get('ref'));if(!/\.pdf$/i.test(data.file.name))throw Error('原件不是 PDF。');return serveLocalFile(req,res,dir,data.file,{mime:'application/pdf'});}
   if(action==='week-delete-plan'&&method==='GET'){const pending=await weekJournal(DATA,id);return respond(res,200,pending?.summary||weekSummary(p));}
   if(action==='week-rename'&&method==='POST'){editable(id);if(p.deletionPending)throw Error('请先完成课堂清理。');const b=await payload(req);return respond(res,200,await renameWeek(DATA,p,b.name,putClass));}
   if(action==='week-delete'&&method==='POST'){deletable(id);if(previews.busy(dir))throw Error('本周课件正在转换，请等待预览转换结束后再删除。');const b=await payload(req);if(b.confirm!==true)throw Error('请确认永久删除整周课程。');const result=await deleteWeek(DATA,p);projectWrites.delete(id);return respond(res,200,result);}
   if(p.deletionPending&&!['session-delete','session-delete-plan'].includes(action))throw Error('有课堂删除尚未完成，请先继续清理。');
   if(action==='material-delete-plan'&&method==='GET'){
    const sourceId=url.searchParams.get('source');
    if(pendingMaterial&&pendingMaterial.sourceId!==sourceId)throw Error('请先完成另一份材料的删除。');
    return respond(res,200,pendingMaterial?.summary||(await materialDeletionPlan(p,sourceId,dir)).summary);
   }
   if(action==='material-delete'&&method==='POST'){
    const b=await payload(req);
    if(b.confirm!==true)throw Error('请确认永久删除材料。');
    deletable(id);
    if(previews.busy(dir))throw Error('本周课件正在转换，请等待预览转换结束。');
    if(await materialCommitPending(dir))throw Error('材料结果尚未提交完成，请重启软件完成恢复后再删除。');
    return respond(res,200,await deleteMaterial(p,b.sourceId,dir,putClass));
   }
   if(['ppt-page-preview','chatgpt-ppt-page'].includes(action)&&method==='POST'){
    editable(id);
    if(await materialCommitPending(dir))throw Error('材料结果正在提交，请稍后重试。');
    const b=await payload(req),file=p.files.find(item=>item.id===b.sourceId&&item.role==='ppt');
    if(!file||!Number.isSafeInteger(b.pageIndex)||b.pageIndex<0)throw Error('请先选择一页有效的课件。');
    const s=await config(),selected=resolveModel(s,'pptPreview');
    await checkModelConnections([selected]);
    if(selected.visionEnabled===false)throw Error('单页 PPT 试解析需要图片输入，请在该模型设置中启用或选择支持图片的模型。');
    const transport=selected.provider==='chatgpt-plan'?'chatgpt':selected.provider==='antigravity-acp'?'acp':'preview';
    if(transport==='chatgpt'&&chatgptJobs.busy)throw Error('已有 ChatGPT 请求正在进行，请等待完成或停止。');
    active.add(id);
    try{
     const work=async job=>{
      const interaction={...job,...modelJobInteraction(job,selected.model)};
      try{
       interaction.status('preparing','准备当前页原图和原生文本');
       const {seed,bytes,sourceHash:hash,renderKey}=await pageCache.page(dir,file,s,{origin:url.origin,index:b.pageIndex,signal:job.signal});
       const input={page:b.pageIndex+1,source:file.name,nativeText:seed.nativeText||'',speakerNotes:seed.speakerNotes||'',hidden:!!seed.hidden,renderWarnings:seed.warnings||[],responseContract:PPT_CONTENT_SCHEMA};
       const raw=await complete(selected,await skill('ppt_learning'),JSON.stringify(input),{...interaction,json:true,images:['data:image/png;base64,'+bytes.toString('base64')]});
       job.signal.throwIfAborted();
       const page=draftToPage(normalizePptDraft(parseJson(raw)),{fileName:file.name,format:path.extname(file.name).slice(1).toLowerCase(),sha256:hash},input);
       inspectRecognition(page,seed,renderKey);
       return {message:'单页校验通过 · 试解析',page:readerPage(page,file,hash),warnings:page.uncertainties};
      }finally{active.delete(id);}
     };
     const job=transport==='acp'?startAcpWorkflow(work):transport==='chatgpt'?chatgptJobs.start(work):previewJobs.start(work);
     return respond(res,202,{id:job.id,transport,...(transport==='chatgpt'?{chatgptJobId:job.id}:{})});
    }catch(error){active.delete(id);throw error;}
   }
   if(action==='ai-parse'&&method==='POST'){
    if(active.has(id)||readingJobs(id).length)throw Error('本周正在处理材料，请稍后启动 AI 解析。');
    const b=await payload(req),f=p.files.find(f=>f.id===b.sourceId);if(!f||!(['ppt','reading'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name)))throw Error('请选择可解析的材料。');
    const settings=await config();validateSettings(settings);
    const tasks=f.role==='ppt'?['pptRecognition','pptTranslation','pptExplanation']:['pdfRecognition'];
    const models=tasks.map(task=>materialSettings(settings,task));
    await checkModelConnections(models);
    if(await materialDeleteJournal(dir)||requestLocks.has(id))throw Error('此课程正在保存或清理，请稍后再试。');
    const options={origin:url.origin,fresh:b.fresh===true,retryIssues:b.retryIssues===true,retryFailed:b.retryFailed===true,teachingPart:b.teachingPart};
    const acpFallback=settings.fallbackProfileId&&settings.modelProfiles.some(p=>p.id===settings.fallbackProfileId&&p.provider==='antigravity-acp')&&(options.retryIssues||settings.fallbackEnabled&&!usesChatGPT(models));
    if(hasAcp(settings,tasks)||acpFallback){
     const batch=f.role==='ppt'?{limit:settings.parseConcurrency}:undefined;
     const job=startAcpWorkflow(async ({signal})=>{
      if(active.has(id)||readingJobs(id).length)throw Error('本周已有任务正在运行，请稍后再试。');
      const entry=await materialParser.start(id,f.id,settings,{...options,signal});await entry.done;
     },batch);
     return respond(res,202,{started:true,acpJobId:job.id});
    }
    await materialParser.start(id,f.id,settings,options);return respond(res,202,{started:true});
   }
   if(action==='ai-parse-cancel'&&method==='POST'){const b=await payload(req);materialParser.cancel(id,b.sourceId);return respond(res,200,{ok:true});}
   if(action==='ai-partial'&&method==='GET')return respond(res,200,await materialParser.partial(id,url.searchParams.get('source')));
   if(action==='ai-partial-import'&&method==='POST'){editable(id);const b=await payload(req);if(b.confirm!==true)throw Error('请明确确认使用部分结果。');await materialParser.acceptPartial(id,b.sourceId);return respond(res,200,await getClass(id));}
   if(action==='page-image'&&method==='GET'){
    const f=p.files.find(f=>f.id===url.searchParams.get('source')&&f.role==='ppt');if(!f)throw Error('请选择本周 PPT。');const value=url.searchParams.get('page');if(!/^\d+$/.test(value||''))throw Error('无效页码。');const index=Number(value)-1;
    const image=await pageCache.page(dir,f,await config(),{origin:url.origin,index});if(url.searchParams.has('hash')&&url.searchParams.get('hash')!==image.sourceHash)throw Error('原件已变化，请刷新后重新核对页面。');const report=f.externalAnalysis?await json(path.join(dir,'Parsed',f.externalAnalysis),null):null;const outdated=report?learningFreshness(report,image.renderKey).stale:false;res.writeHead(200,{'X-Render-Key':image.renderKey,'X-Learning-Stale':outdated?'1':'0','Content-Type':'image/png','Cache-Control':'no-cache','ETag':'"'+image.renderKey+'-'+index+'"','X-Content-Type-Options':'nosniff','X-Preview-Warnings':encodeURIComponent((image.seed.warnings||[]).join('；'))});return res.end(image.bytes);
   }
   if(action==='page-cache-clear'&&method==='POST'){editable(id);const b=await payload(req),f=p.files.find(f=>f.id===b.sourceId&&f.role==='ppt');if(!f)throw Error('材料不存在。');await rm(path.join(dir,'.Cache','Pages',f.id),{recursive:true,force:true});return respond(res,200,{ok:true});}
   if(action==='ai-cache-clear'&&method==='POST'){editable(id);const b=await payload(req),f=p.files.find(f=>f.id===b.sourceId);if(!f)throw Error('材料不存在。');await rm(path.join(dir,'.Cache',f.role==='ppt'?'Pages':'AI',f.id),{recursive:true,force:true});return respond(res,200,{ok:true});}
   if(action==='audio-upload'&&method==='POST'){
    editable(id);const session=p.sessions.find(s=>s.id===req.headers['x-session-id']);if(!session)throw Error('请选择录音所属课堂。');
    const result=await receiveAudio(req,p,session,dir,decodeURIComponent(req.headers['x-file-name']||''));if(!p.files.some(f=>f.id===result.file.id))p.files.push(result.file);
    const srt=p.files.find(f=>f.id===session.srtId&&f.sessionId===session.id&&f.role==='srt');session.audio={fileId:result.file.id,srtId:srt?.id||null,srtHash:srt?digest(await readFile(sourcePath(dir,srt.stored))):null,offsetMs:0};
    p.lastUpload={kind:result.kind,name:result.file.name};p.revision++;await putClass(p);return respond(res,201,p);
   }
   if(action==='audio'&&['GET','HEAD'].includes(method)){const file=p.files.find(f=>f.id===url.searchParams.get('id')&&f.role==='audio');if(!file)throw Error('录音不存在。');return await serveAudio(req,res,dir,file);}
   if(action==='audio-binding'&&method==='POST'){
    editable(id);const b=await payload(req),session=p.sessions.find(s=>s.id===b.sessionId);if(!session?.audio||!p.files.some(f=>f.id===session.audio.fileId&&f.sessionId===session.id&&f.role==='audio'))throw Error('本节课尚未上传录音。');
    if(b.offsetMs!==undefined){if(!Number.isFinite(b.offsetMs)||Math.abs(b.offsetMs)>86400000)throw Error('时间偏移应在正负 24 小时以内。');session.audio.offsetMs=Math.round(b.offsetMs);}
    if(b.bindCurrent===true){const f=p.files.find(f=>f.id===session.srtId&&f.sessionId===session.id&&f.role==='srt');if(!f)throw Error('请先上传本节字幕。');session.audio.srtId=f.id;session.audio.srtHash=digest(await readFile(sourcePath(dir,f.stored)));}
    p.revision++;await putClass(p);return respond(res,200,p);
   }
   if(action==='transcript'&&method==='GET'){
    const session=p.sessions.find(s=>s.id===url.searchParams.get('session'));if(!session)throw Error('课堂不存在。');const generation=url.searchParams.get('version')||session.generation;
    if(!generation||generation!==session.generation)throw Error('没有这个讲稿版本。');
    try{const timeline=await loadTranscript(dir,session,p.files,generation),file=p.files.find(f=>f.id===session.audio?.fileId&&f.sessionId===session.id&&f.role==='audio');return respond(res,200,{available:true,...timeline,audio:file?{...session.audio,name:file.name,url:`/api/projects/${encodeURIComponent(id)}/audio?id=${encodeURIComponent(file.id)}`,matched:session.audio.srtId===timeline.srtId&&session.audio.srtHash===timeline.srtHash}:null});}catch(e){return respond(res,200,{available:false,message:e.message});}
   }
   if(action==='bb'&&method==='POST'){editable(id);const b=await payload(req);if(typeof b.text!=='string')throw Error('课程介绍应为文字。');if(b.text===(p.bbText??''))return respond(res,200,p);p.bbText=b.text;p.revision++;p.materialRevision++;await atomic(path.join(dir,'Source','BB_Info.md'),b.text);await putClass(p);return respond(res,200,p);}
   if(action==='upload'&&method==='POST'){
    editable(id);const name=originalName(decodeURIComponent(req.headers['x-file-name']||'')),role=req.headers['x-file-role'];
    const allowed={bb:['.md','.txt','.pdf'],ppt:['.ppt','.pptx','.pdf'],reading:['.pdf'],srt:['.srt']};if(!allowed[role]?.includes(path.extname(name).toLowerCase()))throw Error('材料类型与扩展名不匹配。');
    let session;if(role==='srt'){const sid=req.headers['x-session-id'];session=sid?p.sessions.find(s=>s.id===sid):addSession(p,{});if(!session)throw Error('请先添加或选择课堂记录。');}
    const bytes=await body(req,150*1024*1024);if(!bytes.length)throw Error('不能上传空文件。');if(role==='srt')parseSrt(bytes.toString('utf8'));
    const placed=await storeSource(p,dir,{name,role,session,bytes});p.lastUpload={kind:placed.kind,name:placed.name,requestedName:name};
    if(placed.existing){if(session&&session.srtId!==placed.existing.id){session.srtId=placed.existing.id;session.revision++;p.revision++;if(session.audio&&!session.audio.srtId){session.audio.srtId=placed.existing.id;session.audio.srtHash=digest(bytes);}}await putClass(p);return respond(res,201,p);}
    const fid=randomUUID(),f={id:fid,name:placed.name,originalName:name,stored:placed.stored,sha256:placed.sha256,role,...(session?{sessionId:session.id}:{}),size:bytes.length,parseStatus:role==='ppt'?'awaiting-json':role==='reading'||role==='bb'&&/\.pdf$/i.test(name)?'pending':'ready'};p.files.push(f);p.revision++;if(session){session.srtId=fid;session.revision++;if(session.audio&&!session.audio.srtId){session.audio.srtId=fid;session.audio.srtHash=digest(bytes);}}else p.materialRevision++;await putClass(p);
    return respond(res,201,p);
   }
   if(action==='parsed'&&method==='POST'){
    editable(id);const f=p.files.find(f=>f.id===url.searchParams.get('source'));if(!f||!(['ppt','reading'].includes(f.role)||f.role==='bb'&&/\.pdf$/i.test(f.name)))throw Error('请选择原始 PPT、Reading 或 BB PDF。');editableSource(id,f.id);
    const text=(await body(req,30*1024*1024)).toString('utf8').replace(/^\uFEFF/,'');if(!text.trim())throw Error('导入内容不能为空。');const source={id:f.id,name:f.name,role:f.role};let doc;
    if(req.headers['x-parse-format']==='json'){
     let report;try{report=JSON.parse(text);}catch{throw Error('解析文件不是合法 JSON，请重新导出完整 JSON。');}
     if(report?.schema===PPT_SCHEMA){
      const original=await readFile(path.join(dir,'Source',f.stored)),expected=contentHash(original);doc=externalPptDocument(report,source,expected);
      if(report.source.format!==path.extname(f.name).slice(1).toLowerCase())throw Error('PPT 解析报告的原始文件格式与上传原件不符。');
      if(/\.pptx$/i.test(f.name)){const count=pptxSlideCount(original);if(count!==doc.pageCount)throw Error('PPT 解析 JSON 页数与原始 PPTX 幻灯片数量不符，请检查是否遗漏隐藏页或空白页。');}
      if(/\.pdf$/i.test(f.name)&&(await pdfInfo(original)).pages!==doc.pageCount)throw Error('PPT 解析 JSON 页数与课件 PDF 页数不符，请检查是否漏页。');
      const rawPath=f.id+'/ppt_analysis_'+contentHash(text).slice(0,16)+'.json';await save(path.join(dir,'Parsed',rawPath),report);doc.rawReport=rawPath;
     }else if(Array.isArray(report))doc=contentListDocument(report,source);
     else throw Error('请选择 course-ppt-parser 生成的完整 PPT JSON，或原生 MinerU content_list 数组；不支持其他 JSON 格式。');
    }else doc=manualDocument(text,source);
    if(doc.provenance!=='external-ppt-skill')doc.provenance='manual-import';
    await save(path.join(dir,'Parsed',f.id,'blocks.json'),doc);f.parsed=f.id+'/blocks.json';f.parsedAt=new Date().toISOString();f.parseStatus='manual';f.importSummary=doc.externalPpt?.summary;f.externalAnalysis=doc.rawReport;f.progress=doc.externalPpt?`AI 解析已收录 · ${f.importSummary.pages} 页 · 记录整页查看 ${f.importSummary.viewed} 页 · 待核查 ${f.importSummary.incomplete} 页`:'补充解析已收录';delete f.error;p.revision++;p.materialRevision++;await putClass(p);return respond(res,200,p);
   }
   if(action==='analysis'&&method==='GET'){
    const f=p.files.find(f=>f.id===url.searchParams.get('source'));if(!f?.externalAnalysis)throw Error('尚未导入完整 PPT 分析 JSON。');const text=await readFile(path.join(dir,'Parsed',f.externalAnalysis),'utf8');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name+'_PPT_Analysis.json')}`});return res.end(text);
   }
   if(['preview','preview-pdf','preview-clear','preview-status','preview-file','preview-source','reader'].includes(action)){
    const f=p.files.find(f=>f.id===url.searchParams.get('source')&&f.role==='ppt');if(!f)throw Error('请选择本周 PPT 课件。');
    if(action==='preview-source'&&method==='GET'){if(!/\.pptx$/i.test(f.name))throw Error('浏览器预览仅支持 PPTX。');const bytes=await readFile(sourcePath(dir,f.stored));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.presentationml.presentation','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
    if(action==='preview'&&method==='POST'){const b=await payload(req);return respond(res,202,await previews.ensure(dir,f,await config(),{force:b.force===true}));}
    if(action==='preview-status'&&method==='GET')return respond(res,200,await previews.status(dir,f));
    if(action==='preview-pdf'&&method==='POST')return respond(res,200,await previews.associate(dir,f,await body(req,150*1024*1024)));
    if(action==='preview-clear'&&method==='POST')return respond(res,200,await previews.clear(dir,f));
    if(action==='preview-file'&&method==='GET'){const result=await previews.pdf(dir,f);res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(result.bytes);}
    if(action==='reader'&&method==='GET'){
     const version=url.searchParams.get('version'),a=p.preparation;if(version&&version!==a?.generation)throw Error('无效预习历史版本。');
     const generation=version||a?.generation;let reader=generation?await json(outputPath(dir,p,'preparation','PPT_Reader.json'),null):null;if(!reader&&generation){try{reader=await legacyReading(await readFile(outputPath(dir,p,'preparation','PPT_Bilingual_Guide.md'),'utf8'),p.files.filter(f=>f.role==='ppt'));}catch(e){if(e.code!=='ENOENT')throw e;}}
     const sourceHash=contentHash(await readFile(sourcePath(dir,f.stored))),parsedDoc=f.parsed?await json(path.join(dir,'Parsed',f.parsed),null):null,reportChanged=!!parsedDoc?.externalPpt?.originalSource?.sha256&&parsedDoc.externalPpt.originalSource.sha256.toLowerCase()!==sourceHash;let pages=reader?.pages.filter(page=>page.sourceId===f.id),learningReady=false;
     if(f.externalAnalysis&&(!pages?.length||a?.materialRevision!==p.materialRevision)){
      const report=await json(path.join(dir,'Parsed',f.externalAnalysis),null);if(report?.learningSchema===LEARNING_SCHEMA&&report.source.sha256===sourceHash){learningReady=true;pages=report.pages.map(page=>page.learning?readerPage(page,f,sourceHash):({sourceId:f.id,source:f.name,pageIndex:page.page-1,sourceHash,paragraphs:[],closeReading:'本页尚未完成识别与学习，请补全失败页。',inspection:page.inspection}));}
     }
     if(!pages?.length)pages=f.parsed?(await pptPages(dir,f)).map(page=>({sourceId:f.id,source:f.name,pageIndex:page.pageIndex,paragraphs:bodyParagraphs(page).map(english=>({english,chinese:''})),closeReading:'',inspection:page.externalInspection})):[];
     let renderKey=null,previewIssue='';try{renderKey=(await pageCache.describe(dir,f,await config())).renderKey;}catch(e){previewIssue=e.message;}
     pages=pages.map(page=>({...page,closeReading:compactCoursewareCitations(page.closeReading||'',p.files),learningStale:!!(page.closeReading||page.paragraphs?.some(p=>p.chinese))&&(!page.renderKey||page.renderKey!==renderKey)}));
     return respond(res,200,{sourceId:f.id,source:f.name,sourceHash,renderKey,previewIssue,review:f.aiParse?.review||null,learningStale:pages.some(page=>page.learningStale),nativePageCount:/\.pptx$/i.test(f.name)?pptxSlideCount(await readFile(sourcePath(dir,f.stored))):undefined,generation,legacy:!!reader?.legacy||!!generation&&!reader,generated:learningReady||!!reader?.pages.some(page=>page.sourceId===f.id),stale:reportChanged||!!a&&(a.materialRevision!==p.materialRevision||pages.some(page=>page.sourceHash&&page.sourceHash!==sourceHash)),sourceChanged:reportChanged||pages.some(page=>page.sourceHash&&page.sourceHash!==sourceHash),pages});
    }
   }
   if(action==='session-delete-plan'&&method==='GET')return respond(res,200,(await deletionPlan(p,url.searchParams.get('session'),dir)).summary);
   if(action==='session-rename'&&method==='POST'){editable(id);if(asking.has(id))throw Error('请等待本周问答完成后再重命名课堂。');const b=await payload(req);return respond(res,200,await renameSession(p,b.sessionId,b.title,dir,project=>putClass(project,{replaceChat:true})));}
   if(action==='session-delete'&&method==='POST'){deletable(id);const b=await payload(req);if(b.confirm!==true)throw Error('请确认删除范围。');return respond(res,200,await deleteSession(p,b.sessionId,dir,project=>putClass(project,{replaceChat:true})));}
   if(action==='sessions'&&method==='POST'){editable(id);const session=addSession(p,await payload(req));await putClass(p);return respond(res,201,{project:p,session});}
   if(action==='preview-fonts'&&method==='GET'){const f=p.files.find(f=>f.id===(url.searchParams.get('source')||url.searchParams.get('id'))&&f.role==='ppt');if(!f||!/^.*\.pptx$/i.test(f.name))throw Error('请选择 PPTX 课件。');const names=presentationFonts(await readFile(sourcePath(dir,f.stored)));return respond(res,200,await localFonts.manifest(names));}
   if(action==='process'&&method==='POST'){
    editable(id);const s=await config();validateSettings(s);
    const options=await payload(req),mode=options.mode||(p.sessions.some(s=>s.srtId)?'session':'preparation'),sessionId=options.sessionId||p.sessions.find(s=>s.srtId)?.id;
    if(!['preparation','session','analysis','week','reading','reference'].includes(mode))throw Error('无效处理任务。');
    let referenceProvider;
    if(mode==='reference'&&options.referenceProfileId){
     if(!s.modelProfiles.some(profile=>profile.id===options.referenceProfileId))throw Error('所选模型连接已不存在，请重新选择。');
     referenceProvider=resolveModel({...s,modelRoutes:{...s.modelRoutes,referenceTranslation:options.referenceProfileId}},'referenceTranslation');
    }
    const workflowTasks=mode==='session'?['context','classroom','transcriptTranslation']:mode==='analysis'?['context','deepDive']:mode==='week'?['context','weeklyDeepDive']:mode==='reference'?['referenceTranslation']:['context','pptRecognition','pptTranslation','pptExplanation'];
    const models=mode==='reading'?[]:workflowTasks.map(task=>task==='referenceTranslation'&&referenceProvider?referenceProvider:resolveModel(s,task));
    await checkModelConnections(models);
    if(mode==='reading'&&!p.files.some(f=>f.id===options.sourceId&&['reading','bb'].includes(f.role)&&/\.pdf$/i.test(f.name)))throw Error('请选择 Reading 或 BB PDF。');
    if(mode==='reading'){
     const file=p.files.find(item=>item.id===options.sourceId);
     editableSource(id,file.id);
     if(readingJobs(id).length>=s.uploadConcurrency)throw Error('已达到本周 MinerU 并行上限，请等待一个文件完成。');
     const key=readingKey(id,file.id),job={id,sourceId:file.id,progress:'准备解析'};
     p.tasks||={};
     p.tasks[taskKey('reading',file.id)]={status:'running',started:new Date().toISOString()};
     p.status='running';p.error='';p.stage='PDF 解析中';p.job={mode,sourceId:file.id};
     file.parseStatus='running';file.progress=job.progress;delete file.error;
     await putClass(p);
     mineruJobs.set(key,job);
     void runReading(job,file,s,options.engine==='mineru'?'mineru':undefined).catch(error=>console.error('MinerU result save failed:',error.message)).finally(()=>mineruJobs.delete(key));
     return respond(res,202,p);
    }
    if(readingJobs(id).length)throw Error('本周有材料正在解析。请等待解析结果提交后再启动生成。');
    if(mode==='reference'&&!p.files.some(f=>f.id===options.sourceId&&f.role==='reading'&&f.parsed))throw Error('请先为选中的参考文献完成解析。');
    if(mode==='session'&&!p.sessions.some(s=>s.id===sessionId&&s.srtId))throw Error('请先为选中的课堂上传 SRT。');
    if(mode==='analysis'&&(!p.sessions.some(s=>s.id===sessionId&&s.generation)||stale(p,sessionId)))throw Error('请先生成或更新本节讲稿，再生成本节 Deep Dive。');
    if(mode==='week'&&options.sessionIds!==undefined&&(!Array.isArray(options.sessionIds)||new Set(options.sessionIds).size!==options.sessionIds.length||options.sessionIds.some(id=>!p.sessions.some(s=>s.id===id&&s.generation))))throw Error('纳入的课堂无效，请刷新后选择已有讲稿的课堂。');
    if(!p.bbText.trim()&&!p.files.some(f=>!['srt','audio'].includes(f.role)))throw Error('请先上传本周教学材料或填写 BB 信息。');
    const interactive=models.some(model=>model.provider==='antigravity-acp'),chatgpt=usesChatGPT(models);
    p.status='running';p.error='';p.warnings=[];delete p.failedStage;p.job={mode,sessionId,sourceId:options.sourceId};p.tasks||={};p.tasks[taskKey(mode,mode==='reference'?options.sourceId:sessionId)]={status:'running',started:new Date().toISOString()};p.stage='准备处理';
    const work=async(job={})=>{await run(p,s,{origin:url.origin,fresh:options.fresh===true,mode,sessionId,sessionIds:options.sessionIds,sourceId:options.sourceId,referenceProvider,signal:job.signal,onProgress:chatgpt&&!interactive?text=>job.onUpdate({sessionUpdate:'status',text,phase:'working'},''):undefined});const latest=await getClass(id);if(latest.status==='error')throw Error(latest.error);};
    if(interactive||chatgpt){
     const start=interactive?startAcpWorkflow:chatgptBatchJobs.start;
     const batch=mode==='preparation'?{limit:s.parseConcurrency}:mode==='reference'?{limit:1,sessionGroup:randomUUID()}:undefined;
     const job=start(async job=>{
      editable(id);
      const latest=await getClass(id);
      editable(id);
      if(readingJobs(id).length||latest.revision!==p.revision||latest.status==='running')throw Error('课程在任务启动时已变化，请刷新后重新开始。');
      active.add(id);
      try{await putClass(p);await work(job);}finally{active.delete(id);}
     },batch);
     return respond(res,202,{...p,...(interactive?{acpJobId:job.id}:{chatgptJobId:job.id})});
    }
    active.add(id);await putClass(p);work().catch(()=>active.delete(id));return respond(res,202,p);
   }
   if(action==='ask'&&method==='POST'){
    const b=await payload(req);
    if(typeof b.question!=='string'||!b.question.trim()||b.question.length>10000)throw Error('问题应为 1–10000 字符。');
    p=await getClass(id);
    if(requestLocks.has(id)||p.deletionPending||p.weekDeletionPending)throw Error('课程正在保存或清理，请稍后提问。');
    const scope=b.scope||'week',focus=validFocus(p,scope,b.focus||null),key=JSON.stringify([scope,focus]);
    const pending=asking.get(id)||new Set();
    if(pending.has(key))throw Error('这个对话正在回答，请稍候。');
    asking.set(id,pending);pending.add(key);
    const settings=await config(),selected=resolveModel(settings,'qa');
    if(selected.provider==='chatgpt-plan'){
     try{
      if(chatgptJobs.busy)throw Error('已有 ChatGPT 请求正在进行，请等待完成或停止。');
      const job=chatgptJobs.start(async job=>{
       try{return await ask(p,b.question,settings,{scope,focus,...modelJobInteraction(job,selected.model)});}
       finally{pending.delete(key);if(!pending.size)asking.delete(id);}
      });
      return respond(res,202,{chatgptJobId:job.id});
     }catch(error){pending.delete(key);if(!pending.size)asking.delete(id);throw error;}
    }
    if(selected.provider==='antigravity-acp'){
     if(acpRuntime.busy||acpJobs.busy){pending.delete(key);if(!pending.size)asking.delete(id);throw Error('ACP 正在处理另一项交互，请等待完成或取消。');}
     const job=acpJobs.start(async interaction=>{try{return await ask(p,b.question,settings,{scope,focus,...interaction});}finally{pending.delete(key);if(!pending.size)asking.delete(id);}});
     return respond(res,202,{acpJobId:job.id});
    }
    try{return respond(res,200,await ask(p,b.question,settings,{scope,focus}));}
    finally{pending.delete(key);if(!pending.size)asking.delete(id);}
   }
   if(action==='output'&&method==='GET'){
    let name=url.searchParams.get('name'),scope=url.searchParams.get('scope');
    if(!scope){const session=p.sessions.find(s=>s.generation===p.generation);if(!session)throw Error('输出尚未生成。');scope=session.id;}
    if(scope==='week'&&name==='Deep_Dive.md')name='Weekly_Deep_Dive.md';
    const a=artifact(p,scope);if(name==='Deep_Dive.md'&&!analysisState(p,a.value).available)throw Error('本节 Deep Dive 尚未生成，请到 Deep Dive 页面单独生成。');if(!a.names.includes(name))throw Error('无效输出文档。');
    const version=url.searchParams.get('version'),currentVersion=name==='Deep_Dive.md'?a.value?.analysis?.generation||a.value?.generation:a.value?.generation;if(version&&version!==currentVersion)throw Error('仅提供当前结果，请刷新页面。');
    const reference=name==='Bilingual.md'&&scope.startsWith('reference:')?p.files.find(f=>f.id===scope.slice(10)&&f.role==='reading'):null;
    let text;
    if(reference){const {source,paragraphs,summary}=await referenceProgress(p,reference,dir);if(!summary.completed&&!summary.blocked)throw Error('输出尚未生成。');text=referenceMarkdown(reference,source,paragraphs);}
    else{if(!a.value?.generation)throw Error('输出尚未生成。');text=titledOutput(await readFile(outputPath(dir,p,scope,name),'utf8'),p,p.sessions.find(s=>s.id===scope),name);if(name==='PPT_Bilingual_Guide.md')text=compactCoursewareGuide(text,p.files);}
    res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store',...(url.searchParams.has('download')?{'Content-Disposition':(reference?"attachment; filename*=UTF-8''"+encodeURIComponent(reference.name.replace(/\.[^.]+$/,'')+'_Bilingual.md'):`attachment; filename="${name}"`)}:{})});return res.end(text);
   }
   if(action==='material-role'&&method==='POST'){
    editable(id);const b=await payload(req),f=p.files.find(f=>f.id===b.sourceId&&!['srt','audio'].includes(f.role));if(!f||!['ppt','reading','bb'].includes(b.role))throw Error('无效材料用途。');editableSource(id,f.id);if(b.role!=='bb'&&!/\.(pdf|pptx?)$/i.test(f.name))throw Error('课件和参考文献需要 PDF/PPT 文件。');if(f.role!==b.role){f.role=b.role;p.materialRevision++;p.revision++;await putClass(p);}return respond(res,200,p);
   }
   if(action==='reference-reader'&&method==='GET'){
    const f=p.files.find(f=>f.id===url.searchParams.get('source')&&f.role==='reading');if(!f)throw Error('参考文献不存在。');
    const {source,paragraphs,summary,stale,reader}=await referenceProgress(p,f,dir),settings=await config(),task=p.tasks?.[taskKey('reference',f.id)];
    const needsPublish=summary.completed>0&&summary.completed===summary.total&&(!reader||reader.summary?.blocked>0);
    return respond(res,200,{sourceId:f.id,source:f.name,sourceWarnings:{missingPages:source.parserCoverage?.missing||[],uncertaintyCount:source.uncertainties?.length||0},pdf:/\.pdf$/i.test(f.name),generated:summary.completed>0||summary.blocked>0,stale,needsPublish,paragraphs,summary,taskStatus:task?.status,taskError:task?.error,models:settings.modelProfiles.map(({id,name,model})=>({id,name,model}))});
   }
   if(action==='reference-file'&&['GET','HEAD'].includes(method)){
    const f=p.files.find(f=>f.id===url.searchParams.get('source')&&f.role==='reading');if(!f)throw Error('参考文献不存在。');return serveLocalFile(req,res,dir,f,{mime:/\.pdf$/i.test(f.name)?'application/pdf':'application/octet-stream'});
   }
   if(action==='source'&&method==='GET'){const f=p.files.find(f=>f.id===url.searchParams.get('id'));if(!f)throw Error('原文件不存在。');if(f.role==='audio')return await serveAudio(req,res,dir,f,true);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`});return res.end(await readFile(path.join(dir,'Source',f.stored)));}
  }
  if(method==='GET'&&['/vendor/pdfjs/','/vendor/pptx-renderer/'].some(prefix=>url.pathname.startsWith(prefix))){
   const root=path.join(ROOT,'public','vendor'),relative=decodeURIComponent(url.pathname.slice('/vendor/'.length)),target=path.resolve(root,relative),checked=path.relative(root,target);if(!checked||checked.startsWith('..')||path.isAbsolute(checked))throw Error('无效资源路径。');const bytes=await readFile(target);res.writeHead(200,{'Content-Type':target.endsWith('.mjs')?'text/javascript':target.endsWith('.wasm')?'application/wasm':'application/octet-stream','X-Content-Type-Options':'nosniff'});return res.end(bytes);
  }
  if(method==='GET'&&['/pptx-frame.html','/parse-render.html'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:; font-src 'self' data: blob:; img-src 'self' data: blob:; media-src blob: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'});return res.end(await readFile(path.join(ROOT,'public',url.pathname.slice(1))));}
  // The new frontend: its page at /, its built files under /next/. /next and /next/ (the
  // address used during the redesign) lead to /.
  if(method==='GET'&&(url.pathname==='/next'||url.pathname==='/next/'||url.pathname==='/next/index.html')){res.writeHead(302,{Location:'/'});return res.end();}
  if(method==='GET'&&(url.pathname==='/'||url.pathname.startsWith('/next/'))){
   const root=path.join(ROOT,'public','next'),relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice('/next/'.length)),target=path.resolve(root,relative),checked=path.relative(root,target);if(!checked||checked.startsWith('..')||path.isAbsolute(checked))return respond(res,400,{error:'无效资源路径。'});
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'},type=types[path.extname(target)];
   let bytes;try{bytes=await readFile(target);}catch{return respond(res,404,{error:relative==='index.html'?'新界面尚未构建。':'未找到资源。'});}
   res.writeHead(200,{'Content-Type':type||'application/octet-stream','Cache-Control':relative==='index.html'?'no-cache':'max-age=31536000, immutable','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});return res.end(bytes);
  }
  // The old frontend was removed in 2.26.0; its address leads to the new one.
  if(method==='GET'&&(url.pathname==='/legacy'||url.pathname==='/legacy/')){res.writeHead(302,{Location:'/'});return res.end();}
  // Standalone pages' scripts and styles: page rendering (parse-render, pptx-frame) and the citation viewer.
  if(method==='GET'&&['/parse-render.js','/render-audit.js','/pptx-frame.js','/reading-reference.js','/reading-reference.css'].includes(url.pathname)){const file=url.pathname.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; frame-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(await readFile(path.join(ROOT,'public',file)));}
  respond(res,404,{error:'未找到页面。'});
 }catch(e){respond(res,400,{error:e.message});}finally{if(lockedId){requestLocks.delete(lockedId);deletingMaterials.delete(lockedId);}}
});
server.requestTimeout=0;
const port=Number(process.env.PORT||4317);
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use. Close the existing app or set PORT to another port.`:e.message);process.exitCode=1;});
server.requestTimeout=30*60*1000;
for(const event of ['SIGINT','SIGTERM'])process.once(event,async()=>{const guard=setTimeout(()=>process.exit(0),4000);guard.unref();await Promise.all([previewJobs.close(),acpJobs.close(),chatgptJobs.close(),chatgptBatchJobs.close()]);await acpRuntime.disconnect();process.exit(0);});
server.listen(port,'127.0.0.1',()=>{const address=`http://127.0.0.1:${server.address().port}`;console.log(`Classroom Local: ${address}\nKeep this window open. Ctrl+C to stop.\nData: ${DATA}`);if(process.argv.includes('--open')&&process.platform==='win32')spawn('explorer.exe',[address],{windowsHide:true,stdio:'ignore'});});
