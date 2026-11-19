import {modelIdentity} from './model-routing.mjs';
import {parseJson} from './core.mjs';
import {PPT_SCHEMA,validateReport} from './ppt-report.mjs';
import {PAGE_TYPES,LEARNING_SCHEMA,validateLearning,translatable} from './ppt-learning.mjs';
import {translateBatch,translationBatches} from './translation-batch.mjs';

// This contract is sent verbatim with the editable teaching prompt. The model
// produces content, not IDs, page numbers or cross-array translation indexes.
export const PPT_CONTENT_SCHEMA={type:'object',required:['blocks','visuals','explanation','uncertainties'],properties:{
 title:{type:'string'},pageType:{type:'string',enum:PAGE_TYPES},blank:{type:'boolean'},status:{type:'string',enum:['complete','partial','unavailable']},
 blocks:{type:'array',items:{type:'object',required:['original','chinese','role'],properties:{original:{type:'string'},chinese:{type:['string','null']},role:{type:'string',enum:['body','heading','caption','footer','page_number','decoration']},method:{type:'string',enum:['native','visual_ocr']}}}},
 visuals:{type:'array',items:{type:'object',required:['description'],properties:{description:{type:'string'},kind:{type:'string'},relations:{type:'array',items:{type:'string'}},uncertainties:{type:'array',items:{type:'string'}}}}},
 explanation:{type:'string'},uncertainties:{type:'array',items:{type:'string'}}
}};
const list=(v,label)=>{if(v===undefined||v===null)return [];if(typeof v==='string')return v.trim()?[v]:[];if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw Error(label+' 必须是文字数组。');return v.filter(x=>x.trim());};
const nonempty=v=>typeof v==='string'&&!!v.trim();
const role=v=>['body','heading','caption','footer','page_number','decoration'].includes(v)?v:['table','formula','equation','list','text',undefined,null].includes(v)?'body':null;

export function normalizePptDraft(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('页面返回必须是一个 JSON 对象。');
 let blocks;
 if(Array.isArray(raw.blocks))blocks=raw.blocks.map((b,i)=>{if(!b||typeof b!=='object'||!nonempty(b.original??b.text))throw Error(`内容块 ${i+1} 缺少原文，不能删除该块来通过检查。`);const r=role(b.role);if(!r)throw Error(`内容块 ${i+1} role 无效。`);return {original:b.original??b.text,chinese:typeof b.chinese==='string'?b.chinese:null,role:r,method:b.method==='native'?'native':'visual_ocr'};});
 else if(Array.isArray(raw.originalText)){
  // Compatibility with existing correct reports, and real v2.8 responses.
  // Numeric index strings are unambiguous; absent/misaligned indexes are NOT
  // guessed by array position. Keep the original and request missing Chinese.
  const translations=new Map();for(const p of raw.learning?.paragraphs||[]){const index=typeof p.originalIndex==='string'&&/^\d+$/.test(p.originalIndex)?Number(p.originalIndex):p.originalIndex;if(Number.isInteger(index)&&index>=0&&index<raw.originalText.length){if(translations.has(index))throw Error('译文索引重复，不能猜测对应关系。');translations.set(index,p.chinese);}}
  blocks=raw.originalText.map((b,i)=>{if(!nonempty(b?.text))throw Error(`原文块 ${i+1} 无有效文字。`);const r=role(b.role);if(!r)throw Error(`原文块 ${i+1} role 无效。`);return {original:b.text,chinese:typeof translations.get(i)==='string'?translations.get(i):null,role:r,method:b.method==='native'?'native':'visual_ocr'};});
 }else throw Error('返回缺少 blocks 原文数组。');
 const supplied=raw.visuals??raw.visualObservations??[];if(!Array.isArray(supplied))throw Error('visuals 必须是数组。');
 const visuals=supplied.map((v,i)=>{if(typeof v==='string')v={description:v};if(!nonempty(v?.description))throw Error(`视觉内容 ${i+1} 缺少描述。`);return {description:v.description,kind:nonempty(v.kind)?v.kind:'image',relations:list(v.relations,'relations'),uncertainties:list(v.uncertainties,'visual uncertainties'),...(typeof v.visibleText==='string'?{visibleText:v.visibleText}:{})};});
 const status=raw.inspection?.fullPageViewed===false?'unavailable':raw.status??raw.inspection?.status??'complete';if(!['complete','partial','unavailable'].includes(status))throw Error('页面状态无效。');
 const blank=raw.blank===true;if(blank&&(blocks.length||visuals.length))throw Error('标为空白但仍有正文或图像，需核对。');
 if(!blank&&status==='complete'&&!blocks.length&&!visuals.length)throw Error('非空白页没有原文或视觉内容，不能仅凭解读宣称完成。');
 const uncertainties=list(raw.uncertainties,'uncertainties');if(status!=='complete'&&!uncertainties.length)uncertainties.push('模型标记本页未完整恢复，需核对原图。');
 return {title:typeof raw.title==='string'?raw.title:'',pageType:PAGE_TYPES.includes(raw.pageType??raw.learning?.pageType)?(raw.pageType??raw.learning.pageType):blank?'blank':'other',blank,status,blocks,visuals,explanation:typeof(raw.explanation??raw.learning?.closeReading)==='string'?(raw.explanation??raw.learning.closeReading):'',uncertainties};
}
export function pendingPptParts(draft){if(!draft)return ['识别'];if(draft.status==='unavailable')return ['识别'];const pending=[];if(draft.blocks.some(b=>translatable(b)&&!nonempty(b.chinese)))pending.push('翻译');if(!nonempty(draft.explanation))pending.push('解读');return pending;}
export function draftToPage(draft,source,input){
 const pending=pendingPptParts(draft);if(pending.length)throw Error('本页尚待完成：'+pending.join('、'));
 const page={page:input.page,title:draft.title,hidden:!!input.hidden,blank:draft.blank,speakerNotes:input.speakerNotes||'',originalText:draft.blocks.map(b=>({text:b.original,method:b.method,role:b.role})),visualObservations:draft.visuals.map((v,i)=>({...v,id:'figure-'+(i+1)})),analysis:[],uncertainties:[...draft.uncertainties],inspection:{textExtracted:!!draft.blocks.length,fullPageViewed:true,status:draft.status},learning:{schema:LEARNING_SCHEMA,pageType:draft.pageType,paragraphs:draft.blocks.flatMap((b,i)=>translatable(b)?[{originalIndex:i,chinese:b.chinese}]:[]),closeReading:draft.explanation}};
 validateLearning(page);validateReport({schema:PPT_SCHEMA,source:{...source,pageCount:1},pages:[{...page,page:1}]},source.sha256);return page;
}

export async function completePptPage({state,input,source,settings,prompts,call,options,persist,notify=async()=>{}}){
 const signal=options.signal,withoutImage={...options,images:undefined};
 const redact=s=>{for(const secret of [...['apiKey','parseApiKey','fallbackApiKey','mineruToken','mineruKey'].map(k=>settings[k]),...Object.values(settings.taskModels||{}).map(p=>p.apiKey)].filter(Boolean))s=s.replaceAll(secret,'[已隐藏密钥]');return s;};
 async function record(stage,response,error){state.diagnostic={stage,response:redact(response||'').slice(0,80000),responseTruncated:(response||'').length>80000,error:redact(error.message||String(error)),model:state.models?.[stage]?.model||settings.model,at:new Date().toISOString()};await persist();}
 async function structured(stage,prompt,value,opts,validate){
  const provider=stage==='补译正文'?(settings.taskModels?.translation||settings):stage==='补全解读'?(settings.taskModels?.explanation||settings):settings;state.models??={};state.models[stage]={model:provider.model,baseUrl:provider.baseUrl};
  signal?.throwIfAborted();let raw;
  await notify(stage+' · '+provider.model,provider);
  if(stage==='逐页内容'&&provider.visionEnabled===false)throw Error('课件识别模型需要允许图片输入，请修改此连接的图片设置。');
  const actualOptions=provider.visionEnabled===false?{...opts,images:undefined}:opts;
  if(stage==='补全解读'&&!actualOptions.images)value={...value,visualCoverage:'No image supplied to this function; rely on recognized original text and labelled visual observations, do not claim direct visual inspection.'};
  try{raw=await call(provider,prompt,JSON.stringify(value),{...actualOptions,onRequest:()=>notify('等待 '+stage+' · '+provider.model,provider)});}catch(e){await record(stage,e.rawResponse||'',e);throw e;}
  try{return validate(parseJson(raw));}catch(e){await record(stage,raw,e);await notify('修正返回格式');
   // One bounded correction with the actual error. No source re-reading, code
   // evaluation, guessed quotes or removal of blocks. Original raw is retained.
   const repairInput={stage,error:e.message,raw,expected:stage==='逐页内容'?PPT_CONTENT_SCHEMA:value.expected,rule:'Only correct serialization/field structure. Preserve every original text, translation, visual description and explanation. Do not invent missing content.'};
   if(prompts.repair.length+JSON.stringify(repairInput).length>settings.contextChars)throw e;
   let corrected;try{corrected=await call(provider,prompts.repair,JSON.stringify(repairInput),withoutImage);return validate(parseJson(corrected));}catch(next){state.repairDiagnostic={stage,response:redact(corrected||'').slice(0,80000),error:redact(next.message),model:provider.model};await persist();throw next;}
  }
 }
 // Reuse a recognized draft or convert a previously accepted v2.8 page when a
 // review needs only translation/explanation. A genuinely unavailable visual
 // result is re-read from the same image using the same primary model.
 if(!state.draft||state.draft.status==='unavailable'){
  const split=settings.taskModels&&Object.values(settings.taskModels).some(s=>modelIdentity(s)!==modelIdentity(settings));
  const prompt=split?prompts.recognition:prompts.learning;
  await notify('识别、翻译与解读');
  try{state.draft=await structured('逐页内容',prompt,{...input,...(split?{task:'recognition only; Chinese and explanation are generated separately by assigned models'}:{}),responseContract:PPT_CONTENT_SCHEMA},options,normalizePptDraft);if(split){for(const b of state.draft.blocks)b.chinese=null;state.draft.explanation='';}await persist();}
  catch(e){if(!e.truncated)throw e;
   await notify('密集页：单独恢复原文');const recovered=await structured('逐页内容',prompts.recognition+'\n\nProgram response contract:\n'+JSON.stringify(PPT_CONTENT_SCHEMA),{...input,task:'recognition only; blocks.chinese may be null and explanation may be empty',responseContract:PPT_CONTENT_SCHEMA},options,normalizePptDraft);state.draft=recovered;if(split){for(const b of state.draft.blocks)b.chinese=null;state.draft.explanation='';}await persist();
  }
 }
 const draft=state.draft;if(draft.status==='unavailable')throw Error('本页图像内容尚未恢复，保留任务等待同一模型补全。');
 const translationProvider=settings.taskModels?.translation||settings;
 const pending=[];
 for(let i=0;i<draft.blocks.length;i++){
  const block=draft.blocks[i];if(!translatable(block)||nonempty(block.chinese))continue;
  const parts=[];const text=block.original;for(let at=0;at<text.length;at+=5000)parts.push(text.slice(at,at+5000));
  state.translationParts??={};state.translationParts[i]??={};
  for(let j=0;j<parts.length;j++)if(!state.translationParts[i][j])pending.push({id:`${i+1}.${j+1}`,english:parts[j],i,j});
 }
 const batches=translationBatches(pending,{maxItems:translationProvider.provider==='antigravity-acp'?5:1});
 for(const batch of batches){
  await notify('补译正文 '+batch.map(part=>part.i+1).join('、'),translationProvider);
  await translateBatch(batch,{signal,
   single:async({english})=>{
    const answer=await structured('补译正文',prompts.translation,{english,weeklyTerminology:input.weeklyTerminology,expected:{chinese:'complete Chinese translation'}},withoutImage,v=>{if(!nonempty(v?.chinese))throw Error('缺少完整中文译文。');return {chinese:v.chinese};});
    return answer.chinese;
   },
   async save({i,j},chinese){state.translationParts[i][j]=chinese;await persist();},
   request:async items=>{
    state.models??={};
    state.models['补译正文']={model:translationProvider.model,baseUrl:translationProvider.baseUrl};
    const batchPrompt=prompts.translation+'\n\nReturn JSON {"translations":[{"id":"input ID","chinese":"complete translation"}]}. Translate every item separately and copy each ID exactly.';
    const value={weeklyTerminology:input.weeklyTerminology,items:items.map(({id,english})=>({id,english}))};
    return call(translationProvider,batchPrompt,JSON.stringify(value),{...withoutImage,onRequest:()=>notify('等待补译正文',translationProvider)});
   }
  });
 }
 for(let i=0;i<draft.blocks.length;i++){
  const block=draft.blocks[i];
  if(translatable(block)&&!nonempty(block.chinese)){
   block.chinese=Object.values(state.translationParts[i]).join('\n');
   await persist();
  }
 }
 if(!nonempty(draft.explanation)){
  await notify('补全本页解读');const answer=await structured('补全解读',prompts.explanation,{...input,recognizedOriginal:draft.blocks.map(b=>({text:b.original,role:b.role})),visualObservations:draft.visuals,uncertainties:draft.uncertainties,expected:{closeReading:'page-specific explanation',pageType:PAGE_TYPES}},options,v=>{const explanation=v?.explanation??v?.closeReading;if(!nonempty(explanation))throw Error('缺少本页解读。');return {explanation,pageType:PAGE_TYPES.includes(v.pageType)?v.pageType:draft.pageType};});draft.explanation=answer.explanation;draft.pageType=answer.pageType;await persist();
 }
 return {...draftToPage(draft,source,input),models:state.models||{}};
}
