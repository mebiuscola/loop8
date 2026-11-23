import path from 'node:path';
import {readingIndex,hydrateReading} from './reading-index.mjs';
import {publishCurrent,outputPath} from './outputs.mjs';
import {json,save} from './core.mjs';
import {contentHash} from './materials.mjs';
import {modelIdentity,resolveModel} from './model-routing.mjs';
import {failureKind} from './page-rounds.mjs';
import {translateBatch,translationBatches} from './translation-batch.mjs';
export async function referenceDocument(p,file,dir){const index=await readingIndex(p,dir),s=index.sources.find(s=>s.sourceId===file.id);if(!s?.available)throw Error(s?.reason||'请先解析此参考文献。');return {source:s,units:index.units.filter(u=>u.sourceId===file.id&&u.evidenceKind==='original'&&!['header','footer','page_number','decoration','discarded'].includes(u.kind)).map(u=>hydrateReading(index,u))};}
const checkpointPath=(dir,id)=>path.join(dir,'Parsed',id,'reference-translation.json');
const usable=value=>typeof value?.chinese==='string'&&!!value.chinese.trim();
const keyParts=(page,kind,text)=>contentHash(JSON.stringify([page,kind,text]));
const blockedText='模型过滤 · 待补译';
function totals(paragraphs){return {total:paragraphs.length,completed:paragraphs.filter(usable).length,blocked:paragraphs.filter(p=>p.status==='blocked').length};}
/**
 * Paragraph translations kept only in the model cache (Parsed/.pipeline.json): versions before the
 * per-file checkpoint saved finished paragraphs nowhere else, so a translation stopped part-way
 * showed 0 done. Keyed by the paragraph's own cache slot (its text and place), whatever model made it.
 */
async function cachedTranslations(dir,fileId){
 const cache=await json(path.join(dir,'Parsed','.pipeline.json'),null),prefix='reference:'+fileId+':',out=new Map();
 for(const entry of Object.values(cache?.entries||{})){
  if(!usable(entry?.output))continue;
  for(const owner of entry.owners||[{slot:entry.slot}])
   if(typeof owner?.slot==='string'&&owner.slot.startsWith(prefix)&&!owner.slot.startsWith(prefix+'batch:'))out.set(owner.slot.slice(prefix.length),entry.output.chinese);
 }
 return out;
}
export async function referenceProgress(p,file,dir){
 const {source,units}=await referenceDocument(p,file,dir),scope='reference:'+file.id;
 const [saved,reader,cached]=await Promise.all([json(checkpointPath(dir,file.id),null),json(outputPath(dir,p,scope,'Reference_Reader.json'),null),cachedTranslations(dir,file.id)]);
 const sameSource=reader?.sourceHash===source.sourceHash&&reader.parsedHash===source.parsedHash;
 const old=new Map((reader?.paragraphs||[]).filter(r=>r.key&&usable(r)).map(r=>[r.key,r])),occurrences=new Map();
 const paragraphs=units.map((u,i)=>{
  const base=keyParts(u.pageIndex,u.kind,u.text),count=(occurrences.get(base)||0)+1;occurrences.set(base,count);const key=base+':'+count;
  const legacy=sameSource?reader.paragraphs[i]:null,entry=saved?.entries?.[key]||old.get(key)||(legacy?.english===u.text&&legacy.pageIndex===u.pageIndex&&legacy.kind===u.kind&&usable(legacy)?{chinese:legacy.chinese,model:legacy.model||reader.model}:null)||(cached.has(u.unitKey)?{chinese:cached.get(u.unitKey)}:null);
  return {key,pageIndex:u.pageIndex,printedPage:u.printedPage,kind:u.kind,english:u.text,chinese:usable(entry)?entry.chinese:'',status:usable(entry)?'complete':entry?.status==='blocked'?'blocked':'pending',...(entry?.model?{model:entry.model}:{})};
 });
 return {source,units,paragraphs,summary:totals(paragraphs),reader,stale:!!reader&&!sameSource};
}
export function referenceMarkdown(file,source,paragraphs){
 const {total,completed}=totals(paragraphs),warnings=[];
 if(completed<total)warnings.push(`译文未完成：${completed}/${total} 块。未完成处保留原文。`);
 if(source.parserCoverage?.missing?.length||source.uncertainties?.length)warnings.push('原文有未恢复页面或解析疑点；译文仅覆盖当前可用原文。');
 return '# '+file.name+' · 双语翻译\n\n'+warnings.map(w=>'> '+w+'\n\n').join('')+paragraphs.map(u=>`### ${u.pageIndex===null?'页码未提供':'PDF 第 '+(u.pageIndex+1)+' 页'}${u.printedPage?' · 印刷页 '+u.printedPage:''}\n\n${u.english}\n\n${u.chinese||(u.status==='blocked'?blockedText:'尚未翻译')}`).join('\n\n');
}
export async function translateReference(p,file,settings,{dir,model,prompts,stage,putClass,referenceProvider,signal}){
 const {source,units,paragraphs}=await referenceProgress(p,file,dir);if(!units.length)throw Error('未找到可翻译的参考文献原文，请先补充解析。');
 const primary=resolveModel(settings,'referenceTranslation'),provider=referenceProvider||primary;
 const entries=Object.fromEntries(paragraphs.filter(r=>r.status!=='pending').map(r=>[r.key,{chinese:r.chinese,status:r.status,model:r.model}]));
 const checkpoint=checkpointPath(dir,file.id),prompt=prompts.reference_translation;
 const validate=v=>{if(!usable(v))throw Error('缺少完整中文译文。');};
 const input=(u,i)=>[`参考文献翻译 · ${file.id} · ${i+1}/${units.length}`,prompt,JSON.stringify({source:file.name,pageIndex:u.pageIndex,kind:u.kind,english:u.text}),validate,{cacheSlot:'reference:'+file.id+':'+u.unitKey}];
 function record(row,entry){Object.assign(row,entry);entries[row.key]=entry;}
 const persist=()=>save(checkpoint,{entries});
 // Import verified legacy cache entries before sending any new request.
 for(const [i,u] of units.entries())if(!usable(paragraphs[i])){
  const cached=model.cachedObject?.(...input(u,i));
  if(cached)record(paragraphs[i],{chinese:cached.chinese,status:'complete',model:primary.model});
 }
 await persist();
 async function translateOne({index}){
  const args=input(units[index],index);
  const result=await model.object(...args.slice(0,4),{...args[4],provider});
  return result.chinese;
 }
 async function saveTranslation({index},chinese,status='complete'){
  record(paragraphs[index],{chinese,status,model:provider.model});
  await persist();
 }
 const pending=units.flatMap((unit,index)=>usable(paragraphs[index])?[]:[{index,id:String(index+1),page:unit.pageIndex,kind:unit.kind,english:unit.text}]);
 if(provider.provider==='antigravity-acp'){
  const batches=translationBatches(pending,{maxChars:Math.min(6000,Math.floor((provider.contextChars||180000)/4))});
  for(const batch of batches){
   await stage(p,`参考文献翻译 · 已译 ${totals(paragraphs).completed}/${units.length} 段 · ${file.name}`);
   await translateBatch(batch,{signal,single:translateOne,save:saveTranslation,blocked:item=>saveTranslation(item,'','blocked'),
    request:items=>model.text('参考文献翻译 · 批量 · '+file.id,
     prompt+'\n\nFor this batch, replace the single-paragraph output format with JSON {"translations":[{"id":"input ID","chinese":"complete translation"}]}. Apply the translation rules separately to each item and copy its ID exactly.',
     JSON.stringify({source:file.name,pageIndex:items[0].page,items:items.map(({id,kind,english})=>({id,kind,english}))}),
     {json:true,provider,cacheSlot:'reference:'+file.id+':batch:'+items.map(item=>item.id).join(',')})});
  }
 }else for(const item of pending){
  signal?.throwIfAborted();
  await stage(p,`参考文献翻译 · ${item.index+1}/${units.length} · ${file.name}`);
  try{await saveTranslation(item,await translateOne(item));}
  catch(error){if(!['blocked','recitation'].includes(failureKind(error)))throw error;await saveTranslation(item,'','blocked');}
 }
 const latest=await referenceDocument(p,file,dir);if(latest.source.sourceHash!==source.sourceHash||latest.source.parsedHash!==source.parsedHash)throw Error('材料在翻译期间发生变化，未发布过期译文。');
 const summary=totals(paragraphs),metadata={sourceHash:source.sourceHash,parsedHash:source.parsedHash,routeHash:modelIdentity(primary),model:primary.model,coverage:source.parserCoverage||null,uncertainties:source.uncertainties||[],summary};
 const reader={schema:'classroom.reference-reader.v1',sourceId:file.id,source:file.name,...metadata,paragraphs};
 signal?.throwIfAborted();
 await publishCurrent(p,'reference:'+file.id,{'Bilingual.md':referenceMarkdown(file,source,paragraphs),'Reference_Reader.json':JSON.stringify(reader,null,2)},metadata,{dir,putClass});
 return summary;
}
