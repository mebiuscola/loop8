import {validateSegments} from './core.mjs';
import {normalizeCueIds,coverageDetails} from './subtitle-check.mjs';
import {budgetObject} from './context-budget.mjs';
const meaningful=s=>String(s).toLowerCase().replace(/\b(?:student|lecturer|um|uh|you know)\b/gi,'').match(/[\p{L}\p{N}]+/gu)||[];
export function classroomBatches(cues,{model,prompt,session,chunkChars}){const out=[];let batch=[],size=0;for(const cue of cues){const fits=list=>(model.remaining?.(prompt,JSON.stringify({session,context:'',previousForContinuityOnly:[],cues:list,part:cues.length,totalParts:cues.length}))??Infinity)>=500;if(batch.length&&(size+cue.text.length>chunkChars||!fits([...batch,cue]))){out.push(batch);batch=[];size=0;}if(!fits([cue]))throw Error('第 '+cue.id+' 条字幕超过单次预算，请提高 contextChars 或先拆分该条字幕。');batch.push(cue);size+=cue.text.length;}if(batch.length)out.push(batch);return out;}
export function contentAudit(segments,cues){return segments.flatMap((s,index)=>{const source=cues.filter(c=>s.cueIds.includes(c.id)),issues=[],labelled=source.filter(c=>/^\s*(student|lecturer)\s*:/i.test(c.text));if(labelled.some(c=>c.text.match(/^\s*(student|lecturer)/i)[1].toLowerCase()!==s.speaker.toLowerCase()))issues.push('原字幕的明确说话者标签与整理结果不一致，需核对。');const text=s.english.toLowerCase(),suspect=source.filter(c=>{const words=meaningful(c.text);return (words.length>=4||words.length>0&&(/^\s*Student\s*:/i.test(c.text)||/[?\uFF1F]/.test(c.text)))&&words.filter(w=>text.includes(w)).length/words.length<0.45;});if(suspect.length)issues.push('这些字幕的内容可能被过度压缩或改写：'+suspect.map(c=>c.id).join('、'));return issues.length?[{segmentIndex:index,cueIds:s.cueIds,issues}]:[];});}
// Find the contiguous damaged span, anchored by exact ordered prefix/suffix
// segments. Cue IDs only locate it; they never authorize sorting speech text.
export function repairWindow(segments,cues){
 const details=coverageDetails(segments,cues),positions=new Map(cues.map((c,i)=>[c.id,i])),affected=new Set();let high=-1,owner=-1,orderConflict=false;
 for(const [i,s] of segments.entries()){
  if(!s.cueIds.length||s.cueIds.some(id=>details.extra.includes(id)||details.duplicated.includes(id)))affected.add(i);
  for(const id of s.cueIds){const pos=positions.get(id);if(pos===undefined)continue;if(pos<high){orderConflict=true;affected.add(i);affected.add(owner);}if(pos>high){high=pos;owner=i;}}
 }
 for(const id of details.missing){const pos=positions.get(id);let before=-1,after=-1,lower=-1,upper=cues.length;for(const [i,s] of segments.entries())for(const n of s.cueIds){const p=positions.get(n);if(p<pos&&p>lower){lower=p;before=i;}if(p>pos&&p<upper){upper=p;after=i;}}if(before>=0)affected.add(before);if(after>=0)affected.add(after);}
 if(!affected.size)segments.forEach((s,i)=>affected.add(i));
 let first=Math.min(...affected),last=Math.max(...affected),prefix=0,suffix=cues.length;
 for(let i=0;i<first;i++){const ids=segments[i].cueIds;if(ids.some((id,j)=>id!==cues[prefix+j]?.id)){first=i;break;}prefix+=ids.length;}
 for(let i=segments.length-1;i>last;i--){const ids=segments[i].cueIds,start=suffix-ids.length;if(start<prefix||ids.some((id,j)=>id!==cues[start+j]?.id)){last=i;break;}suffix=start;}
 return {details,first,last,target:segments.slice(first,last+1),allowed:cues.slice(prefix,suffix),orderConflict};
}
export async function reconstructBatch({model,prompt,repairPrompt,restorePrompt=prompt,input,cues}){
 const validate=v=>validateSegments(v?.segments,cues);
 return model.object(`重建课堂 · ${input.part}/${input.totalParts}`,prompt,JSON.stringify(budgetObject(model,prompt,input,{query:cues.map(c=>c.text).join(' '),fields:['context','previousForContinuityOnly']})),validate,{repair:async({value,error})=>{
  const segments=value?.segments;if(!Array.isArray(segments)||!segments.length||segments.some(s=>!s||typeof s.english!=='string'||!s.english.trim()||!['Lecturer','Student','Unclear speaker'].includes(s.speaker))){const e=Error('无法恢复正文结构，需要重新生成当前批次。');e.regenerate=true;throw e;}
  normalizeCueIds(segments);for(const s of segments)if(!Array.isArray(s.cueIds))s.cueIds=[];
  const {details,first,last,target,allowed,orderConflict}=repairWindow(segments,cues);
  async function restoreLocal(order=false){
   const task=order?'Restore ONLY this local cue span from its SRT in chronological order. Split any paragraph that crosses another speaker turn. Existing paragraphs are a flawed draft, not authoritative speech. Preserve every student turn; never merely sort IDs.':'Restore ONLY this local cue span from its SRT; preserve all student turns and order.';
   const localInput=budgetObject(model,restorePrompt,{session:input.session,context:input.context||'',previousForContinuityOnly:[],cues:allowed,existingParagraphs:target,part:input.part,totalParts:input.totalParts,issues:details,task},{query:allowed.map(c=>c.text).join(' '),fields:['context']});
   let local;try{local=await model.object(`${order?'重排课堂片段':'补全字幕正文'} · ${input.part}/${input.totalParts}`,restorePrompt,JSON.stringify(localInput),v=>validateSegments(v?.segments,allowed));}
   catch(e){throw Object.assign(Error((order?'课堂局部顺序修复未完成：':'课堂局部正文补全未完成：')+e.message),{details,errorCause:e.message});}
   const restored={...value,segments:[...segments.slice(0,first),...local.segments,...segments.slice(last+1)]};validate(restored);return restored;
  }
  // A paragraph containing both sides of a student turn cannot be fixed by an
  // ID-only assignment. Go straight to a local, source-grounded reconstruction.
  if(orderConflict)return restoreLocal(true);
  const repairInput={task:'repair_srt_associations',issues:details,expectedCueIds:allowed.map(c=>c.id),cues:allowed,segments:target.map((s,i)=>({segmentIndex:first+i,speaker:s.speaker,english:s.english,cueIds:s.cueIds})),rule:'Only repair IDs. English, speaker and chapter are immutable. If spoken content is absent from these paragraphs, report missingContent instead of pretending it is covered.'};
  let answer;try{answer=await model.object(`修复字幕关联 · ${input.part}/${input.totalParts}`,repairPrompt,JSON.stringify(repairInput),v=>{
   if(Array.isArray(v?.missingContent)&&v.missingContent.length){if(v.missingContent.some(id=>!Number.isInteger(id)||!allowed.some(c=>c.id===id)))throw Error('missingContent 只能引用本次修复范围内的字幕编号。');return;}
   if(!Array.isArray(v?.assignments)||v.assignments.length!==target.length)throw Error('必须完整返回目标段落的 assignments。');const indexes=v.assignments.map(a=>a.segmentIndex);if(new Set(indexes).size!==target.length||indexes.some(i=>!Number.isInteger(i)||i<first||i>last))throw Error('修复不能修改无关段落。');
   const candidate=structuredClone(segments);for(const a of v.assignments){if(!Array.isArray(a.cueIds))throw Error('cueIds 必须为数组。');candidate[a.segmentIndex].cueIds=a.cueIds;}
   normalizeCueIds(candidate);const check=coverageDetails(candidate,cues);
   // An exact but crossed association is a valid diagnosis for the next local
   // step, not a successful final transcript and not another futile JSON retry.
   if(!check.missing.length&&!check.duplicated.length&&!check.extra.length&&check.orderMismatch&&candidate.every(s=>s.cueIds.length))return;
   validateSegments(candidate,cues);
  });}catch(e){throw Object.assign(Error('字幕覆盖关联局部修复未完成：'+e.message),{details,errorCause:e.message});}
  if(answer.missingContent?.length)return restoreLocal();
  const restored=structuredClone(value);for(const a of answer.assignments)restored.segments[a.segmentIndex].cueIds=a.cueIds;normalizeCueIds(restored.segments);
  if(coverageDetails(restored.segments,cues).orderMismatch)return restoreLocal(true);
  validate(restored);return restored;
 }});
}
