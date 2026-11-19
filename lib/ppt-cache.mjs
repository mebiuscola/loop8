import {contentHash} from './materials.mjs';
import {normalizePptDraft} from './ppt-response.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {json} from './core.mjs';
const hash=v=>contentHash(JSON.stringify(v));
export function pageFingerprint(seed,image){
 return hash([contentHash(image),seed.nativeText||'',seed.speakerNotes||'',!!seed.hidden,seed.warnings||[]]);
}
export async function reusablePptPages(dir,fileId,checkpoint){
 const byFingerprint=new Map();
 for(const [index,page] of (checkpoint?.pages||[]).entries()){
  if(!page||page.inspection?.status!=='complete')continue;
  let reuse=checkpoint.pageDrafts?.[index]?.reuse;
  if(!reuse&&checkpoint.renderKey){
   const base=path.join(dir,'.Cache','Pages',fileId,'page-'+(index+1));
   const seed=await json(base+'.json',null);
   if(seed?.renderKey!==checkpoint.renderKey)continue;
   const image=await readFile(base+'.png').catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
   if(image)reuse={fingerprint:pageFingerprint(seed,image)};
  }
  if(!reuse?.fingerprint)continue;
  const entries=byFingerprint.get(reuse.fingerprint)||[];
  entries.push({page,reuse,rules:checkpoint.componentRules,sourceHash:checkpoint.source?.sha256});
  byFingerprint.set(reuse.fingerprint,entries);
 }
 return byFingerprint;
}
export function reusePptDraft(candidates,rules,identity,sourceHash){
 const reusable=(candidates||[]).filter(entry=>entry.rules?.recognition===rules.recognition);
 const match=reusable.find(entry=>entry.reuse.context===identity.context)||reusable[0];
 if(!match)return null;
 const sameLegacySource=!match.reuse.context&&match.sourceHash===sourceHash;
 const draft=normalizePptDraft(match.page);
 if(match.rules.translation!==rules.translation||(!sameLegacySource&&match.reuse.terms!==identity.terms)){
  for(const block of draft.blocks)block.chinese=null;
 }
 if(match.rules.explanation!==rules.explanation||(!sameLegacySource&&match.reuse.context!==identity.context))draft.explanation='';
 return {draft,models:match.page.models||{},reuse:identity};
}
export function componentRules({prompt,mapPrompt,splitPrompts,evidence}){return {recognition:hash(splitPrompts.recognition),translation:hash([prompt,splitPrompts.translation]),explanation:hash([prompt,splitPrompts.explanation,evidence,mapPrompt]),map:hash(mapPrompt)};}
export function resetPptTeaching(task,part){
 if(!['translation','explanation'].includes(part)||!task.total)throw Error('请先完成课件识别，再单独更新翻译或解读。');
 for(let i=0;i<task.total;i++){let state=task.pageDrafts[i];if(task.pages[i])state={draft:normalizePptDraft(task.pages[i]),models:task.pages[i].models||{}};if(!state?.draft)throw Error('课件仍有未识别页面，请先补全。');if(part==='translation'){for(const b of state.draft.blocks)b.chinese=null;state.translationParts={};}else state.draft.explanation='';task.pageDrafts[i]=state;task.pages[i]=null;}
 task.attempts={};task.cycles={};delete task.deckReview;delete task.deckReviewDraft;
}
// A background/teaching-rule change invalidates teaching content, not pixels or
// recovered source text. Legacy checkpoints are upgraded without discarding OCR.
export function updatePptRules(task,rules,learningRules){
 const old=task.componentRules,changed=task.learningRules!==learningRules;
 const recognition=old&&old.recognition!==rules.recognition,translation=old?old.translation!==rules.translation:changed,explanation=old?old.explanation!==rules.explanation:changed;
 if(recognition){task.pages=[];task.pageDrafts={};task.attempts={};task.cycles={};task.provenance={};delete task.deckReview;delete task.deckReviewDraft;}
 else if(translation||explanation){
  task.pageDrafts??={};
  for(let i=0;i<Math.max(task.total||0,task.pages.length);i++){
   let state=task.pageDrafts[i];if(task.pages[i])state={draft:normalizePptDraft(task.pages[i]),models:task.pages[i].models||{}};if(!state?.draft)continue;
   if(translation){for(const b of state.draft.blocks)b.chinese=null;state.translationParts={};}
   if(explanation)state.draft.explanation='';task.pageDrafts[i]=state;task.pages[i]=null;
  }task.attempts={};task.cycles={};delete task.deckReview;delete task.deckReviewDraft;
 }
 if(old&&old.map!==rules.map){delete task.courseMap;task.mapParts={};}
 task.componentRules=rules;task.learningRules=learningRules;return {recognition:!!recognition,translation:!!translation,explanation:!!explanation};
}
