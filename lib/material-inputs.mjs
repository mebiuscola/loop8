// What the course context (lib/study.mjs, "构建课程上下文") reads from each material of a week, as
// fingerprints (2026-11-24). Deep Dives record the fingerprints they were made from, and only a
// real change of that text makes them outdated (lib/workflow.mjs materialChanges): re-translating
// or re-explaining courseware does not, because the context reads only the original text, visual
// observations, speaker notes and uncertainties of each slide. Lecture scripts do not follow
// materials at all: their subtitles are the only source of what was said.
import path from 'node:path';
import {json} from './core.mjs';
import {materialParts,contentHash} from './materials.mjs';
import {LEARNING_SCHEMA} from './ppt-learning.mjs';

/** The course-context text of a deck with a page-by-page guide (used by lib/study.mjs too, so both stay the same). */
export function learningNote(f,report){
 return `[SOURCE ${f.id} | ${f.name}]\n[Course roadmap; navigation, not quoted evidence] ${JSON.stringify(report.courseMap)}\n`+report.pages.map(page=>`[PPT slide ${page.page}]\n[Original text] ${page.originalText.map(t=>t.text).join('\n')}\n[Visual observations] ${JSON.stringify(page.visualObservations)}\n[Speaker notes; not classroom speech] ${page.speakerNotes}\n[Uncertainty] ${page.uncertainties.join('; ')}`).join('\n\n');
}

/** Fingerprints of what the course context reads: {<material id | 'BB_Info'>: {name, role, hash}}. */
export async function materialInputs(p,dir){
 const sources={};
 if(p.bbText)sources.BB_Info={name:'课程介绍',role:'bb',hash:contentHash(p.bbText)};
 for(const f of p.files||[]){
  if(['srt','audio'].includes(f.role))continue;
  let text=null;
  try{
   if(f.role==='ppt'&&f.externalAnalysis){const report=await json(path.join(dir,'Parsed',f.externalAnalysis),null);if(report?.learningSchema===LEARNING_SCHEMA)text=learningNote(f,report);}
   if(text===null&&(f.parsed||f.stored))text=JSON.stringify(await materialParts(path.join(dir,f.parsed?'Parsed':'Source',f.parsed||f.stored)));
  }catch{text=null;}
  sources[f.id]={name:f.name,role:f.role,hash:text===null?'unreadable':contentHash(text)};
 }
 return sources;
}

/** Brings p.materialInputs up to date with the week's material counter; true when it was recomputed. */
export async function refreshMaterialInputs(p,dir){
 if(p.materialInputs?.revision===p.materialRevision)return false;
 p.materialInputs={revision:p.materialRevision,sources:await materialInputs(p,dir)};
 return true;
}
