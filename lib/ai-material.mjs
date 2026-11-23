import {resolveModel,modelIdentity} from './model-routing.mjs';
import {inspectRecognition} from './ppt-quality.mjs';
import {reviewDeck} from './ppt-deck-review.mjs';
import {weeklyTerminology} from './terminology.mjs';
import {compactCoursewareCitations} from './courseware-citations.mjs';
import {componentRules,updatePptRules,resetPptTeaching,pageFingerprint,reusablePptPages,reusePptDraft} from './ppt-cache.mjs';
import {commitMaterial,recoverMaterialCommits} from './material-commit.mjs';
import {completePptPage,normalizePptDraft,pendingPptParts} from './ppt-response.mjs';
import {validateLearning,validateMap,pageContext,LEARNING_SCHEMA} from './ppt-learning.mjs';
import {pageCacheService} from './page-cache.mjs';
import {runPageRounds,hasIssues,materialRouteConfigured} from './page-rounds.mjs';
import {isDeckNote,doubtSummary,readHintChecks,reviewOpen,doubtRules,needsFullImage} from './doubts.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {json,save,atomic,parseJson} from './core.mjs';
import {serialWriter} from './concurrency.mjs';
import {contentHash,materialParts} from './materials.mjs';
import {sourcePath} from './storage.mjs';
import {zipEntries} from './zip.mjs';
import {complete} from './adapters.mjs';
import {PPT_SCHEMA,validateReport,reportSummary} from './ppt-report.mjs';
import {externalPptDocument} from './ppt-import.mjs';
import {launchRenderer} from './browser-render.mjs';
import {AsyncResource} from 'node:async_hooks';

export function materialSettings(s,task='pptRecognition'){return s.profileId&&!s.modelProfiles?{...s}:resolveModel(s,task);}
export function adaptiveQueue(initial=2){
 let configured=initial,limit=initial,active=0,cooldown=0,timer;const waiting=[];
 function pump(){clearTimeout(timer);if(Date.now()<cooldown){timer=setTimeout(pump,cooldown-Date.now());return;}while(active<limit&&waiting.length){const item=waiting.shift();item.signal?.removeEventListener('abort',item.abort);if(item.signal?.aborted){item.reject(item.signal.reason);continue;}active++;Promise.resolve().then(()=>{item.signal?.throwIfAborted();return item.task();}).then(item.resolve,item.reject).finally(()=>{active--;pump();});}}
 return {configure(n){if(n!==configured){configured=n;limit=n;}pump();},limited(){limit=Math.max(1,limit-1);cooldown=Math.max(cooldown,Date.now()+2000);},get active(){return active;},get limit(){return limit;},run(task,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(signal.reason);const item={task:AsyncResource.bind(task),signal,resolve,reject};item.abort=()=>{const i=waiting.indexOf(item);if(i>=0){waiting.splice(i,1);reject(signal.reason);}};signal?.addEventListener('abort',item.abort,{once:true});waiting.push(item);pump();});}};
}
export function validatePdfPage(value){
 if(!value||!['complete','partial','unreadable','blank'].includes(value.status)||!Array.isArray(value.blocks)||!Array.isArray(value.uncertainties)||value.uncertainties.some(v=>typeof v!=='string'))throw Error('PDF 页面必须包含 status、blocks、uncertainties。');
 if(value.printedPage!==null&&typeof value.printedPage!=='string')throw Error('印刷页码必须为字符串或 null。');
 const kinds=['heading','body','footnote','table','formula','caption','header','footer','image_description'];
 for(const block of value.blocks)if(!kinds.includes(block?.kind)||typeof block.text!=='string'||!block.text.trim())throw Error('PDF 内容块缺少有效 kind / text。');
 if(value.status==='blank'&&value.blocks.length)throw Error('空白页不能包含内容块。');
 if(['partial','unreadable'].includes(value.status)&&!value.uncertainties.length)throw Error('未完整恢复的页面必须说明疑点。');
 if(value.status==='complete'&&!value.blocks.length)throw Error('没有内容的页面不能标为完整恢复。');
 return value;
}
export function pdfDocument(report,source){
 const blocks=[];for(const page of report.pages){validatePdfPage(page);for(const b of page.blocks)blocks.push({id:`${source.id}:b${blocks.length+1}`,type:'text',pageIndex:page.page-1,evidenceKind:b.kind==='image_description'?'visual_observation':'original',text:`[${b.kind==='image_description'?'Image description; not original text':b.kind} | Printed page: ${page.printedPage||'unknown'}]\n${b.text}`});for(const issue of page.uncertainties)blocks.push({id:`${source.id}:b${blocks.length+1}`,type:'text',pageIndex:page.page-1,evidenceKind:'uncertainty',text:'[Uncertainty] '+issue});blocks.push({id:`${source.id}:b${blocks.length+1}`,type:'text',pageIndex:page.page-1,text:'[AI PDF recovery status] '+page.status});}
 return {schema:'classroom.blocks.v1',source,provenance:'local-ai-pdf',pageCount:report.pages.length,sourceHash:report.source.sha256,blocks};
}
export function fallbackSettings(s){if(s.modelRoutingVersion===2)return s.fallbackProfileId?resolveModel({...s,modelRoutes:{...s.modelRoutes,pdfRecognition:s.fallbackProfileId}},'pdfRecognition'):{...s,provider:'api',model:'',apiKey:''};const primary=materialSettings(s,'pdfRecognition');return {...primary,provider:'api',baseUrl:s.fallbackBaseUrl||primary.baseUrl,model:s.fallbackModel||'',apiKey:s.fallbackApiKey||primary.apiKey};}
export function aiMaterialService({root,getClass,dirFor,mutate,previews,pageCache,render=launchRenderer,call=complete}){
 const shared=pageCache||pageCacheService({root,previews,render});
 const running=new Map(),resources=new Map(),queue=adaptiveQueue(2),key=(id,fid)=>id+'|'+fid;
 async function update(id,fid,job,extra={}){await mutate(id,p=>{const f=p.files.find(f=>f.id===fid);if(!f)throw Error('解析材料已不存在');f.aiParse=structuredClone(job);Object.assign(f,extra);});}
 async function checkpointFor(id,fid){const p=await getClass(id),f=p.files.find(f=>f.id===fid);if(!f)throw Error('材料不存在');const task=await json(path.join(dirFor(id),'Parsed',fid,f.role==='ppt'?'ppt_task.json':'ai_task.json'),null)||await json(path.join(dirFor(id),'Parsed',fid,'ai_task.json'),null);if(!task?.total||task.source?.sha256!==contentHash(await readFile(sourcePath(dirFor(id),f.stored))))throw Error('没有与当前原件匹配的逐页结果。');return {p,f,task};}
 async function publish(id,fid,task,job,allowPartial=false,keepRunning=false){
  const dir=dirFor(id),p=await getClass(id),f=p.files.find(f=>f.id===fid),ppt=f.role==='ppt';
  if(contentHash(await readFile(sourcePath(dir,f.stored)))!==task.source.sha256)throw Error('原件已变化，停止收录。');
  const missing=Array.from({length:task.total},(_,i)=>i).filter(i=>!task.pages[i]);
  if(ppt&&missing.length)throw Error('PPT 全部页面完成后才能发布，不能收录缺页结果。');
  if(missing.length&&(!allowPartial||missing.length===task.total))throw Error('页面未全部恢复；请查看部分结果后明确选择收录。');
  const pages=[];for(let i=0;i<task.total;i++){
   if(task.pages[i]){pages.push(task.pages[i]);continue;}
   const seed=await json(path.join(dir,'.Cache',ppt?'Pages':'AI',fid,'page-'+(i+1)+'.json'),{}),issue='本页未恢复；不能据此推断原文。';
   pages.push(ppt?{page:i+1,title:'',hidden:!!seed.hidden,blank:false,originalText:[],speakerNotes:seed.speakerNotes||'',visualObservations:[],analysis:[],uncertainties:[issue,...(seed.hidden===undefined?['隐藏页状态未核验']:[])],inspection:{textExtracted:false,fullPageViewed:false,status:'unavailable'}}:{page:i+1,printedPage:null,status:'unreadable',blocks:[],uncertainties:[issue]});
  }
  const models=[...new Set(Object.values(task.provenance||{}).map(v=>v.model))];
  const coverage={total:task.total,recovered:task.pages.filter(Boolean).length,missing:missing.map(i=>i+1),partial:missing.length>0};
  const report={schema:ppt?PPT_SCHEMA:'classroom.pdf-recovery.v1',source:{...task.source,fileName:f.name,pageCount:task.total},pages,coverage,courseMap:task.courseMap,deckReview:task.deckReview,learningRules:task.learningRules,learningSchema:task.learningSchema,parser:{model:models.length===1?models[0]:'mixed',pageProvenance:task.provenance||{},at:new Date().toISOString(),renderBasis:task.renderBasis,renderKey:task.renderKey}};
  const previous=f.externalAnalysis?await json(path.join(dir,'Parsed',f.externalAnalysis),null):null;
  if(previous?.source?.sha256===task.source.sha256&&previous.learningRules===task.learningRules&&JSON.stringify(previous.pages)===JSON.stringify(pages)&&JSON.stringify(previous.deckReview)===JSON.stringify(task.deckReview)){
   Object.assign(job,{status:keepRunning?'running':coverage.partial?'partial':'done',stage:keepRunning?'全页已发布 · 正在检查':ppt&&reviewOpen(task.deckReview)?'页面已完成 · 检查待处理':'复用已保存结果',tasks:{},active:0,finished:keepRunning?undefined:Date.now(),completed:coverage.recovered,total:task.total,...doubtSummary({pages,deckNotes:task.deckNotes},ppt,await readHintChecks(dir,fid)),review:task.deckReview});await update(id,fid,job,{error:'',progress:job.stage});return;
  }
  const identity={id:f.id,name:f.name,role:f.role},doc=ppt?externalPptDocument(report,identity,task.source.sha256):pdfDocument(report,identity);doc.provenance=ppt?'local-ai-ppt':'local-ai-pdf';doc.rawReport=fid+'/ai_analysis.json';doc.coverage=coverage;
  Object.assign(job,{status:keepRunning?'running':coverage.partial?'partial':'done',stage:keepRunning?'全页已发布 · 正在检查':coverage.partial?'已收录部分结果':ppt&&reviewOpen(task.deckReview)?'页面已完成 · 检查待处理':'已收录',tasks:{},active:0,finished:keepRunning?undefined:Date.now(),completed:coverage.recovered,total:task.total,missing:coverage.missing,partialAccepted:coverage.partial,...doubtSummary({pages,deckNotes:task.deckNotes},ppt,await readHintChecks(dir,fid)),review:task.deckReview});
  const patch={parsed:fid+'/blocks.json',parseStatus:'ready',externalAnalysis:doc.rawReport,partialCoverage:coverage.partial?coverage:undefined,aiParse:job,importSummary:ppt?reportSummary(report):undefined,progress:`AI 已收录 ${coverage.recovered}/${task.total} 页${coverage.partial?'（部分结果）':job.incomplete?' · '+job.incomplete+' 页有疑点':''}${ppt&&reviewOpen(task.deckReview)?' · 检查待处理':''}`};
  await commitMaterial(dir,fid,{stored:f.stored,report,doc,patch},change=>mutate(id,change));
 }
 async function execute(id,fid,settings,options,entry){
  const dir=dirFor(id),controller=entry.controller,signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal,write=serialWriter();let browser,token,checkpoint,rendering;
  const job={status:'running',stage:'准备任务',started:Date.now(),updated:Date.now(),completed:0,total:0,prepared:0,tasks:{},rounds:[]};
  const persist=()=>{const snapshot=structuredClone(checkpoint);return write(()=>save(path.join(dir,'Parsed',fid,checkpoint?.learningSchema?'ppt_task.json':'ai_task.json'),snapshot));};
  try{
   await recoverMaterialCommits(dir,change=>mutate(id,change));
   const p=await getClass(id),f=p.files.find(f=>f.id===fid);if(!f||!(['ppt','reading'].includes(f.role)||f.role==='bb')||!/\.(pptx?|pdf)$/i.test(f.name))throw Error('请选择 PPT、Reading 或 BB PDF。');
   const ppt=f.role==='ppt',primary=materialSettings(settings,ppt?'pptRecognition':'pdfRecognition'),fallback=ppt?null:fallbackSettings(settings),review=options.retryIssues===true;
   if(review&&!ppt&&!fallback.model)throw Error('请先配置备用模型，再复核疑点页。');
   if(!materialRouteConfigured(primary))throw Error('请先保存材料解析模型或通用模型设置。');
   queue.configure(settings.parseConcurrency||2);
   const prompt=await readFile(path.join(root,'skills',ppt?'ppt_learning.md':'pdf_rescue.md'),'utf8'),bytes=await readFile(sourcePath(dir,f.stored)),hash=contentHash(bytes),source={fileName:f.name,sha256:hash,format:path.extname(f.name).slice(1).toLowerCase()};
   const mapPrompt=ppt?await readFile(path.join(root,'skills','ppt_map.md'),'utf8'):'';
   const weeklyTerms=ppt?(options.weeklyTermsSnapshot||await weeklyTerminology(p,dir,{exclude:fid})).filter(t=>t.sourceId!==fid):[];
   const deckPrompt=ppt?await readFile(path.join(root,'skills','ppt_deck_review.md'),'utf8'):'';
   const checkDeck=async()=>{if(!ppt)return;try{await reviewDeck({checkpoint,prompt:deckPrompt,settings:primary,weeklyTerms,call:(...args)=>queue.run(()=>call(...args),signal),persist,signal,onRateLimit:()=>queue.limited(),notify:async event=>{job.reviewProgress=event;job.stage=`${event.phase} · ${event.batch||job.reviewProgress?.batch||''}/${event.total||''}`;await update(id,fid,job,{progress:job.stage});}});}catch(e){if(signal.aborted)throw e;checkpoint.deckReview={...(checkpoint.deckReview||{}),status:'pending',issues:[{kind:'request',error:e.message}],terms:[],completed:0,total:1};await persist();}job.review=checkpoint.deckReview;};
   const finishMaterial=async()=>{
    if(ppt){
     checkpoint.deckReview??={status:'pending',terms:[],issues:[{kind:'pending',error:'整课检查尚未完成。'}],completed:0,total:Math.ceil(checkpoint.total/10)};
     await publish(id,fid,checkpoint,job,false,true);
     await checkDeck();
    }
    await publish(id,fid,checkpoint,job);
   };
   const taskModels=ppt?{translation:resolveModel(settings,'pptTranslation'),explanation:resolveModel(settings,'pptExplanation')}:null;
   const splitPrompts=ppt?Object.fromEntries(await Promise.all([['recognition','ppt_recognition'],['translation','ppt_block_translation'],['explanation','ppt_explanation'],['repair','ppt_response_repair']].map(async([key,name])=>[key,await readFile(path.join(root,'skills',name+'.md'),'utf8')]))):null;
   const evidence=[];if(ppt){
    if(p.bbText)evidence.push({source:'BB_Info',text:p.bbText});
    for(const bb of p.files.filter(x=>x.role==='bb'&&!x.parsed&&/\.(md|txt)$/i.test(x.name)))evidence.push({source:bb.name,text:await readFile(sourcePath(dir,bb.stored),'utf8')});
    for(const reading of p.files.filter(x=>x.role!=='ppt'&&x.parsed)){for(const text of await materialParts(path.join(dir,'Parsed',reading.parsed),4500))evidence.push({source:reading.name,text:compactCoursewareCitations(text,p.files)});}
   }
   if(ppt){for(const [key,task] of [['recognition','pptRecognition'],['translation','pptTranslation'],['explanation','pptExplanation']])if(settings.modelRoutes?.[task]||settings.modelRoutes?.pptRecognition)splitPrompts[key]+='\n[Configured task model '+modelIdentity({...resolveModel(settings,task),apiKey:''})+']';}
   const learningRules=ppt?contentHash(JSON.stringify({prompt,mapPrompt,splitPrompts,evidence})):null;
   // Doubt-writing rules go only into the requests sent, not into these fingerprints (lib/doubts.mjs).
   const withRules=await doubtRules(root);
   checkpoint=options.fresh?null:await json(path.join(dir,'Parsed',fid,ppt?'ppt_task.json':'ai_task.json'),null);
   const previousCheckpoint=checkpoint&&{...checkpoint,pageDrafts:{...checkpoint.pageDrafts}};
   // A new learning contract has its own checkpoint. Existing raw recognition and
   // published results are left untouched until the replacement is successful.
   if(ppt&&checkpoint?.learningRules!==learningRules&&checkpoint?.contractVersion!==2){
    if(checkpoint?.source?.sha256===hash&&checkpoint.contractVersion!==2){
     checkpoint.pages=checkpoint.pages.map(page=>{if(!page)return null;try{validateLearning(page);return page;}catch{return null;}});checkpoint.attempts={};checkpoint.cycles={};checkpoint.pageDrafts={};checkpoint.learningRules=learningRules;
    }
   }
   // Model, endpoint, token limit and Skill changes never erase successful pages.
   if(checkpoint?.source?.sha256!==hash)checkpoint={version:2,source,pages:[],attempts:{},provenance:{},cycles:{}};
   if(ppt){const rules=componentRules({prompt,mapPrompt,splitPrompts,evidence});if(options.teachingPart&&checkpoint.componentRules){rules.recognition=checkpoint.componentRules.recognition;rules.map=checkpoint.componentRules.map;const other=options.teachingPart==='translation'?'explanation':'translation';rules[other]=checkpoint.componentRules[other];}updatePptRules(checkpoint,rules,learningRules);checkpoint.learningSchema=LEARNING_SCHEMA;checkpoint.contractVersion=2;checkpoint.pageDrafts??={};}
   if(ppt&&options.teachingPart)resetPptTeaching(checkpoint,options.teachingPart);
   checkpoint.version=2;checkpoint.attempts??={};checkpoint.provenance??={};checkpoint.cycles??={};
   for(let i=0;i<checkpoint.pages.length;i++)if(checkpoint.pages[i]&&!checkpoint.provenance[i])checkpoint.provenance[i]={model:'legacy-saved',round:'imported',ruleHash:'unknown'};
   if(options.retryFailed)for(let i=0;i<checkpoint.total;i++)if(!checkpoint.pages[i])checkpoint.cycles[i]=(checkpoint.cycles[i]||0)+1;
   if(review)for(let i=0;i<checkpoint.total;i++)if(hasIssues(checkpoint.pages[i],ppt))checkpoint.cycles[i]=(checkpoint.cycles[i]||0)+1;
   Object.assign(job,{completed:checkpoint.pages.filter(Boolean).length,total:checkpoint.total||0,model:primary.model,fallbackModel:fallback?.model||'',ruleHash:contentHash(prompt),failed:[]});
   if(!review&&checkpoint.total&&checkpoint.pages.filter(Boolean).length===checkpoint.total&&(!ppt||checkpoint.renderKey===(await shared.describe(dir,f,settings)).renderKey)){job.rounds=checkpoint.rounds||[];job.prepared=checkpoint.total;await finishMaterial();return;}
   await update(id,fid,job,{error:'',progress:'准备独立浏览器渲染'});await persist();
   let cache,reusablePages;
   const readyPages=new Map();
   function pageReady(index){
    if(!readyPages.has(index))readyPages.set(index,Promise.withResolvers());
    return readyPages.get(index);
   }
   const notify=async(event={})=>{signal.throwIfAborted();if(event.round)job.round=event.round;if(event.summary)job.rounds=structuredClone(event.summary);if(event.index!==undefined){if(['已保存','本轮失败'].includes(event.phase))delete job.tasks[event.index];else job.tasks[event.index]={phase:event.phase,at:Date.now(),model:event.model};}job.updated=Date.now();job.drafted=Object.values(checkpoint.pageDrafts||{}).filter(s=>s.draft).length;job.pendingParts=Object.entries(checkpoint.pageDrafts||{}).filter(([i])=>!checkpoint.pages[i]).map(([i,s])=>({page:Number(i)+1,parts:pendingPptParts(s.draft)}));job.completed=checkpoint.pages.filter(Boolean).length;job.active=Object.values(job.tasks).filter(t=>t.phase.startsWith('等待')).length;job.limit=queue.limit;await update(id,fid,job,{progress:`${job.round||job.stage} · AI ${job.completed}/${job.total} · 请求中 ${job.active}/${queue.limit}`});};
   if(ppt){
    job.stage='准备共享页面缓存';
    if(!options.fresh&&!review&&!options.teachingPart){
     if(previousCheckpoint?.renderKey&&previousCheckpoint.renderKey!==(await shared.describe(dir,f,settings)).renderKey){
      reusablePages=await reusablePptPages(dir,fid,previousCheckpoint);
     }else if(!previousCheckpoint){
      const sourceName=f.originalName||f.name;
      for(const old of p.files.filter(candidate=>candidate.id!==fid&&candidate.role==='ppt'&&(candidate.originalName||candidate.name)===sourceName).reverse()){
       const previous=await json(path.join(dir,'Parsed',old.id,'ppt_task.json'),null);
       if(!previous)continue;
       reusablePages=await reusablePptPages(dir,old.id,previous);
       if(reusablePages.size)break;
      }
     }
    }
    const inventoryReady=Promise.withResolvers();
    rendering=shared.ensure(dir,f,settings,{origin:options.origin,signal,
     onInventory:inventoryReady.resolve,
     onPage:async(i,total)=>{pageReady(i).resolve();job.prepared=Math.max(job.prepared,i+1);job.total=total;await notify();}
    });
    rendering.catch(()=>{});
    const info=await Promise.race([inventoryReady.promise,rendering]);
    cache=info.cache;
    if(checkpoint.renderKey&&checkpoint.renderKey!==info.renderKey){checkpoint.pages=[];checkpoint.attempts={};checkpoint.provenance={};checkpoint.cycles={};delete checkpoint.courseMap;delete checkpoint.splitPages;checkpoint.pageDrafts={};}
    checkpoint.renderKey=info.renderKey;checkpoint.renderBasis=info.renderBasis;checkpoint.total=info.pages;checkpoint.pages.length=info.pages;job.total=info.pages;
    if(info.cached||!info.inventory)job.prepared=info.pages;
    const inventory=[];
    for(let i=0;i<info.pages;i++){
     const seed=info.inventory?.[i]||await json(path.join(cache,'page-'+(i+1)+'.json'),{});
     inventory.push({page:i+1,nativeText:seed.nativeText||'',speakerNotes:seed.speakerNotes||'',hidden:!!seed.hidden});
    }
    // Persist each map part so an interrupted large-deck map does not start over.
    if(!checkpoint.courseMap){
     try{
     job.stage='建立课件结构地图';await notify();checkpoint.mapParts??={};const maps=[];
     let batch=[],length=0;const batches=[];const budget=Math.min(45000,Math.max(4000,(settings.contextChars||180000)-mapPrompt.length-3000));
     for(const item of inventory){const value={...item,nativeText:item.nativeText.slice(0,5000),speakerNotes:item.speakerNotes.slice(0,2000),textCoverage:{nativeCharacters:item.nativeText.length,notesCharacters:item.speakerNotes.length,excerpted:item.nativeText.length>5000||item.speakerNotes.length>2000}};const n=JSON.stringify(value).length;if(batch.length&&(length+n>budget||batch.length>=30)){batches.push(batch);batch=[];length=0;}batch.push(value);length+=n;}if(batch.length)batches.push(batch);
     for(let part=0;part<batches.length;part++){
      const pages=batches[part],k=contentHash(JSON.stringify({pages,mapPrompt,model:primary.model,base:primary.baseUrl}));let value=checkpoint.mapParts[k];
      if(!value){let last,mapRaw='';for(let attempt=0;attempt<3;attempt++)try{
       mapRaw=await queue.run(()=>call(primary,mapPrompt,JSON.stringify({source:f.name,pages,part:part+1,totalParts:batches.length}),{signal,json:true}),signal);value=parseJson(mapRaw);
       const local={...value,pages:value.pages?.map((p,i)=>({...p,page:p.page-pages[0].page+1}))};validateMap(local,pages.length);if(value.pages.some((p,i)=>p.page!==pages[i].page))throw Error('课件地图页码不对应。');break;
      }catch(e){last=e;value=null;const response=primary.apiKey?mapRaw.replaceAll(primary.apiKey,'[redacted]'):mapRaw;checkpoint.mapDiagnostic={error:e.message,response:response.slice(0,80000),responseTruncated:response.length>80000,at:new Date().toISOString()};await persist();if(e.providerFailure||e.httpStatus||e.name==='AbortError')throw e;}
      if(!value)throw last;checkpoint.mapParts[k]=value;await persist();}
      maps.push(value);
     }
     checkpoint.courseMap={overview:maps.map(m=>m.overview).join('\n'),pages:maps.flatMap(m=>m.pages),terms:[...new Map(maps.flatMap(m=>m.terms).map(t=>[t.english.toLowerCase(),t])).values()].slice(0,80)};validateMap(checkpoint.courseMap,info.pages);await persist();
     }catch(e){
      if(signal.aborted||e.category==='quota_exhausted'||[401,403,404].includes(e.httpStatus))throw e;
      checkpoint.mapDiagnostic={...(checkpoint.mapDiagnostic||{}),error:e.message,at:new Date().toISOString()};checkpoint.mapProvisional=true;
      checkpoint.courseMap={overview:'Provisional native page order; AI roadmap unavailable. Inspect each page directly.',pages:inventory.map(p=>({page:p.page,title:p.nativeText.split('\n')[0].slice(0,100),section:'',purpose:'Page order only; cross-page interpretation awaits visual inspection.'})),terms:[]};await persist();
     }
    }
    entry.inventory=inventory;
   }else{
   let kind=/\.pptx$/i.test(f.name)?'pptx':'pdf',fileBytes=bytes,renderBasis=kind;const associated=ppt?await previews.status(dir,f):null;
   if(ppt&&associated?.status==='ready'&&!associated.direct){fileBytes=(await previews.pdf(dir,f)).bytes;kind='pdf';renderBasis='associated-pdf:'+contentHash(fileBytes);}
   if(/\.ppt$/i.test(f.name)&&associated?.status!=='ready')throw Error('旧版 .ppt 需要先生成或关联包含隐藏页的 PDF，或另存为 PPTX。');
   checkpoint.renderBasis=renderBasis;
   cache=path.join(dir,'.Cache','AI',fid);await mkdir(cache,{recursive:true});
   const renderKey=contentHash(JSON.stringify({hash,renderBasis,version:'2.5.0'}));
   token=randomUUID();const nativeParts=/\.pptx$/i.test(f.name)?Object.fromEntries(zipEntries(bytes,n=>/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/.test(n)).map(e=>[e.name,e.bytes.toString('utf8')])):{};resources.set(token,{bytes:fileBytes,nativeParts});
   browser=await render(options.origin,settings,signal);const base=options.origin+'/api/parse-resource/'+token;
   const info=await browser.open({kind,url:base+'/file',nativeUrl:base+'/native',fontUrl:options.origin+'/api/projects/'+encodeURIComponent(id)+'/preview-fonts?source='+encodeURIComponent(fid),detail:review,hash:kind==='pptx'?hash:undefined});
   if(!Number.isInteger(info.pages)||info.pages<1||info.pages>2000)throw Error('材料页数无效（支持 1–2000 页）');
   if(checkpoint.total&&checkpoint.total!==info.pages)throw Error('页面来源页数已变化；已有成功页保留，请核对页序后选择重新解析全部。');
   if(kind==='pdf'&&/\.pptx$/i.test(f.name)&&(await import('./ppt-count.mjs')).pptxSlideCount(bytes)!==info.pages)throw Error('关联 PDF 页数与 PPTX 不符，请包含隐藏页。');
   checkpoint.total=info.pages;checkpoint.pages.length=info.pages;job.total=info.pages;await persist();
   // Render only missing pages (or explicit review pages). Images stay on disk;
   // bounded request workers load them on demand instead of retaining every PNG.
   for(let i=0;i<info.pages;i++){
    signal.throwIfAborted();if(checkpoint.pages[i]&&!(review&&hasIssues(checkpoint.pages[i],ppt))){job.prepared++;continue;}
    job.stage='准备页面';const imageFile=path.join(cache,'page-'+(i+1)+'.png'),seedFile=path.join(cache,'page-'+(i+1)+'.json');let seed=await json(seedFile,null),cached=false;
    if(!review&&seed?.renderKey===renderKey)try{await readFile(imageFile);cached=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!cached){const page=await browser.page(i);if(!/^data:image\/png;base64,/.test(page.image||''))throw Error('页面未生成有效 PNG');await atomic(imageFile,Buffer.from(page.image.split(',')[1],'base64'));const {image,...rest}=page;seed={...rest,renderKey};if(ppt&&/\.ppt$/i.test(f.name))seed.warnings=[...(seed.warnings||[]),'旧 PPT 使用关联 PDF，备注与隐藏页状态未核验。'];await save(seedFile,seed);}
    job.prepared++;await notify();
   }
   await browser.close();browser=null;resources.delete(token);token=null;
   }
   await persist();
   job.stage=ppt?'逐页识别、翻译与解读':'AI 逐页识别';
   const result=await runPageRounds({checkpoint,primary,fallback,autoFallback:!ppt&&settings.fallbackEnabled===true&&(primary.provider==='chatgpt-plan')===(fallback?.provider==='chatgpt-plan'),prompt,ppt,review,queue,limit:settings.parseConcurrency||2,signal,persist,notify,
    request:async(index,route,{round,attempt})=>{
     if(rendering)await Promise.race([pageReady(index).promise,rendering]);
     signal.throwIfAborted();
     const seed=await json(path.join(cache,'page-'+(index+1)+'.json'),null);
     const bytes=await readFile(path.join(cache,'page-'+(index+1)+'.png'));
     const smaller=ppt&&settings.compactPptImages&&seed.hasModelImage&&attempt.round==='initial'&&!checkpoint.pageDrafts?.[index]?.draft
      ?await readFile(path.join(cache,'page-'+(index+1)+'.model.png')).catch(()=>null):null;
     const image='data:image/png;base64,'+(smaller||bytes).toString('base64');
     await notify({index,phase:'准备模型请求',round,model:route.model});
     const terms=[...new Set((seed.nativeText||'').toLowerCase().match(/[a-z]{3,}/g)||[])];
     const ranked=evidence.map((p,i)=>({...p,i,score:terms.reduce((n,t)=>n+(p.text.toLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.score-a.score||a.i-b.i);
     const selected=[];let budget=5000;for(const part of ranked)if((part.score>0||part.source==='BB_Info')&&part.text.length<=budget){selected.push(part);budget-=part.text.length;}
     const pageText=[seed.nativeText,seed.speakerNotes].join('\n').normalize('NFKC').toLowerCase();
     const relevantTerms=ppt?weeklyTerms.filter(term=>pageText.includes(term.english.normalize('NFKC').toLowerCase())).map(({sourceId,alsoSources,alternatives,...term})=>({...term,...(alsoSources?{alsoSources:alsoSources.map(({sourceId,...value})=>value)}:{}),...(alternatives?{alternatives:alternatives.map(({sourceId,...value})=>value)}:{})})):undefined;
     const input={page:index+1,source:f.name,weeklyTerminology:relevantTerms,courseContext:ppt?pageContext(checkpoint.courseMap,entry.inventory,index):undefined,relatedEvidence:ppt?selected:undefined,nativeText:seed.nativeText,speakerNotes:seed.speakerNotes,hidden:seed.hidden,renderWarnings:seed.warnings,outputInstruction:'Return one complete JSON object. Preserve all evidence; do not summarize original text. Follow weeklyTerminology for the same meaning and scope.'},requestOptions={images:[image],signal,json:true,onRequest:()=>notify({index,phase:'等待模型返回',round,model:route.model})};let value;
     if(ppt){
      checkpoint.pageDrafts??={};let state=checkpoint.pageDrafts[index];
      if(review&&state?.reviewCycle!==checkpoint.cycles[index])state={reviewCycle:checkpoint.cycles[index]};
      const reuse={fingerprint:pageFingerprint(seed,bytes),context:contentHash(JSON.stringify([input.courseContext,relevantTerms,selected])),terms:contentHash(JSON.stringify(relevantTerms))};
      if(!state)state=reusePptDraft(reusablePages?.get(reuse.fingerprint),checkpoint.componentRules,reuse,hash)||{};
      state.reuse=reuse;
      checkpoint.pageDrafts[index]=state;
      value=await completePptPage({state,input,source,settings:{...route,taskModels},prompts:{...splitPrompts,recognition:withRules(splitPrompts.recognition),learning:withRules(prompt)},call,options:requestOptions,persist,notify:(phase,provider)=>notify({index,phase,round,model:provider?.model||route.model})});
      // Only what the model itself could not read can come from the smaller image; the program's own
      // checks (text running off the page, native text not matched) do not depend on it.
      const ownDoubts=(value.uncertainties||[]).length+(value.visualObservations||[]).reduce((n,v)=>n+(v.uncertainties||[]).length,0);
      inspectRecognition(value,seed,checkpoint.renderKey);validateLearning(value);validateReport({schema:PPT_SCHEMA,source:{...source,pageCount:1},pages:[{...value,page:1}]},hash);
      // Redo with the full image only when the page could not be read, or the model reported
      // something it could not read (lib/doubts.mjs); a whole redo costs as much as the first try.
      if(smaller&&needsFullImage(value,ownDoubts)){
       checkpoint.pageDrafts[index]={reuse};
       await persist();
       throw Error('传输图识别有疑点，将使用完整原图补试。');
      }
     }else{const raw=await call(route,withRules(prompt),JSON.stringify(input),requestOptions);value=parseJson(raw);validatePdfPage(value);if(value.status==='complete'&&value.uncertainties.length)value.status='partial';}
     await notify({index,phase:'\u6821\u9a8c\u7ed3\u679c',round,model:route.model});
     // Courseware-wide notes (missing fonts) are kept once for the file, not as a doubt on every page.
     const deck=(seed.warnings||[]).filter(isDeckNote),local=(seed.warnings||[]).filter(w=>!isDeckNote(w));
     if(deck.length)checkpoint.deckNotes=[...new Set([...(checkpoint.deckNotes||[]),...deck])];
     if(local.length){value.uncertainties=[...new Set([...value.uncertainties,...local])];if(ppt)value.inspection.status='partial';else if(value.status==='complete')value.status='partial';}
     return {...value,page:index+1};
    }});
   await rendering;
   checkpoint.rounds=result.summary;await persist();job.rounds=result.summary;job.failed=result.failures;job.missing=result.missing;Object.assign(job,doubtSummary(checkpoint,ppt,await readHintChecks(dir,fid)));
   if(result.summary.some(round=>round.status==='quota_paused'))throw Error('ACP 额度暂时用尽，已保存完成的页面，额度恢复后可继续。');
   if(ppt&&result.missing.length){job.pendingParts=result.missing.map(page=>({page,parts:pendingPptParts(checkpoint.pageDrafts?.[page-1]?.draft)}));throw Error('PPT 尚有 '+result.missing.length+' 页待完成：'+job.pendingParts.map(p=>'第 '+p.page+' 页 ['+p.parts.join('、')+']').join('；')+'。已保存成果，可继续补全；全部页完成后发布。');}
   if(result.missing.length)throw Error(`${result.missing.length} 页未恢复。成功页已保存；可查看部分结果、配置备用模型或手动再次尝试未完成页。`);
   await finishMaterial();
  }catch(e){const cancelled=signal.aborted;controller.abort(e);await write(()=>Promise.resolve());job.status=cancelled?'cancelled':checkpoint?.pages?.some(Boolean)?'partial':'error';job.stage=cancelled?'已取消，可继续':job.status==='partial'?'部分解析完成，待补全':'需要处理后继续';job.error=e.message;job.completed=checkpoint?.pages?.filter(Boolean).length||0;job.tasks={};job.active=0;job.finished=Date.now();await update(id,fid,job,{progress:job.stage,error:cancelled?'':e.message});throw e;}
  finally{await rendering?.catch(()=>{});await browser?.close().catch(()=>{});if(token)resources.delete(token);running.delete(key(id,fid));}
 }
 return {busy:id=>[...running.keys()].some(k=>k.startsWith(id+'|')),resource:token=>resources.get(token)||shared.resource(token),cancel(id,fid){running.get(key(id,fid))?.controller.abort(Error('用户取消解析'));},
  async partial(id,fid){const {f,task}=await checkpointFor(id,fid);return {source:f.name,role:f.role,requiresComplete:f.role==='ppt',review:task.deckReview,reviewDiagnostics:Object.entries(task.deckReviewDraft?.parts||{}).filter(([,v])=>!v.complete).map(([batch,v])=>({batch:Number(batch)+1,issues:v.issues,error:v.error,diagnostic:v.diagnostic})),pending:Object.entries(task.pageDrafts||{}).filter(([i])=>!task.pages[i]).map(([i,s])=>({page:Number(i)+1,parts:pendingPptParts(s.draft),draft:s.draft||null,diagnostic:s.diagnostic||null})),total:task.total,completed:task.pages.filter(Boolean).length,missing:Array.from({length:task.total},(_,i)=>i+1).filter(i=>!task.pages[i-1]),pages:task.pages.filter(Boolean),provenance:task.provenance||{},rounds:task.rounds||[]};},
  async acceptPartial(id,fid){const {f,task}=await checkpointFor(id,fid);if(f.role==='ppt')throw Error('PPT 全部页面完成后才能发布，不支持收录缺页结果。');await publish(id,fid,task,{...(f.aiParse||{}),started:f.aiParse?.started||Date.now(),prepared:task.total,rounds:task.rounds||[]},true);},
  async start(id,fid,settings,options){const k=key(id,fid);if(running.has(k))throw Error('该材料已在解析');const entry={controller:new AbortController()};running.set(k,entry);try{await mutate(id,p=>{const f=p.files.find(f=>f.id===fid);if(!f)throw Error('材料不存在');f.aiParse={...(f.aiParse||{}),status:'running',stage:'准备任务',started:Date.now(),tasks:{}};});}catch(e){running.delete(k);throw e;}entry.done=execute(id,fid,settings,options,entry);entry.done.catch(()=>{});return entry;}};
}
