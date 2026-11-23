// A reference's own glossary: built from the reference's recognized text before it is translated,
// then sent with each translation request (only the terms that occur in that request's text).
// The week's courseware glossary is not used for references.
import path from 'node:path';
import {json,save} from './core.mjs';
import {contentHash} from './materials.mjs';
import {mapPool} from './concurrency.mjs';
import {termText,contains} from './ppt-review.mjs';

export const PART_CHARS=30000,PART_TERMS=40,MAX_TERMS=120;
const SCHEMA='classroom.reference-terms.v1';
const termsPath=(dir,id)=>path.join(dir,'Parsed',id,'reference-terms.json');
const pageOf=u=>Number.isInteger(u.pageIndex)?u.pageIndex+1:null;

/** Splits the reference into parts of about PART_CHARS characters, in reading order, keeping units whole. */
export function termParts(units,limit=PART_CHARS){
 const parts=[];let part=null;
 for(const u of units){
  if(!part||part.chars+u.text.length>limit&&part.units.length){part={units:[],chars:0};parts.push(part);}
  part.units.push(u);part.chars+=u.text.length;
 }
 return parts.map(p=>{
  const pages=[];for(const u of p.units){const page=pageOf(u),last=pages.at(-1);if(last&&last.page===page)last.text+='\n\n'+u.text;else pages.push({page,text:u.text});}
  return {pages,key:contentHash(JSON.stringify(pages))};
 });
}

const CONTRACT='Return JSON {"terms":[{"english":"term exactly as written in the text","chinese":"Chinese rendering","scope":"short note on the sense in this text"}]}. At most '+PART_TERMS+' terms.';

/** Checks a model reply for one part; keeps only terms written in that part, with the pages they occur on. */
export function checkPartTerms(value,part){
 if(!value||typeof value!=='object'||!Array.isArray(value.terms))throw Error('缺少 terms 列表。');
 const out=[];
 for(const t of value.terms.slice(0,PART_TERMS)){
  if(!t||typeof t.english!=='string'||typeof t.chinese!=='string'||!t.english.trim()||!t.chinese.trim())continue;
  const pages=part.pages.filter(p=>contains(p.text,t.english)).map(p=>p.page);
  if(!pages.length)continue;   // not in this text: never becomes a convention
  out.push({english:t.english.trim(),chinese:t.chinese.trim(),scope:typeof t.scope==='string'?t.scope.trim():'',pages:[...new Set(pages.filter(n=>n!==null))]});
 }
 return out;
}

/**
 * Merges the parts' terms in reading order: the same English in the same sense keeps the first
 * Chinese; other renderings are kept as alternatives. Over MAX_TERMS, the most frequent are kept.
 */
export function mergeReferenceTerms(lists,units){
 const map=new Map();
 for(const t of lists.flat()){
  const k=termText(t.english)+'\u0000'+termText(t.scope),old=map.get(k);
  if(!old){map.set(k,{...t,alternatives:[]});continue;}
  old.pages=[...new Set([...old.pages,...t.pages])];
  if(termText(old.chinese)!==termText(t.chinese)&&!old.alternatives.some(a=>termText(a)===termText(t.chinese)))old.alternatives.push(t.chinese);
 }
 let terms=[...map.values()].map(t=>{
  const pages=[...new Set(units.filter(u=>contains(u.text,t.english)).map(pageOf).filter(n=>n!==null))].sort((a,b)=>a-b);
  const {alternatives,...rest}=t;return {...rest,pages:pages.length?pages:t.pages.sort((a,b)=>a-b),count:units.filter(u=>contains(u.text,t.english)).length,...(alternatives.length?{alternatives}:{})};
 });
 if(terms.length>MAX_TERMS){const keep=new Set([...terms].sort((a,b)=>b.count-a.count).slice(0,MAX_TERMS));terms=terms.filter(t=>keep.has(t));}
 return terms.map(({count,...t})=>t);
}

/** The terms of a glossary that occur in a piece of text, as sent to the model. */
export function relevantReferenceTerms(terms,text){
 return (terms||[]).filter(t=>contains(text,t.english)).map(({english,chinese,scope,alternatives})=>({english,chinese,...(scope?{scope}:{}),...(alternatives?{alternatives}:{})}));
}

/** The saved glossary of a reference, or null. `current` is false when the parse changed since. */
export async function readReferenceTerms(dir,id,source){
 const saved=await json(termsPath(dir,id),null);
 if(saved?.schema!==SCHEMA)return null;
 const current=!!source&&saved.sourceHash===source.sourceHash&&saved.parsedHash===source.parsedHash;
 return {terms:saved.terms||[],status:saved.status,error:saved.error||'',built:saved.built,current};
}

/**
 * Builds (or reuses) the glossary of a reference. Parts already done are kept, so a stopped build
 * continues where it was. A part that fails leaves a partial glossary; translation still goes on.
 */
export async function buildReferenceTerms({dir,file,source,units,model,prompt,provider,limit=2,signal,stage}){
 const file_=termsPath(dir,file.id),saved=await json(file_,null);
 const same=saved?.schema===SCHEMA&&saved.sourceHash===source.sourceHash&&saved.parsedHash===source.parsedHash;
 if(same&&saved.status==='complete')return {terms:saved.terms,status:'complete',error:''};
 const parts=termParts(units),done={...(same?saved.parts:{})};let finished=0,error='';
 const write=(status)=>save(file_,{schema:SCHEMA,sourceHash:source.sourceHash,parsedHash:source.parsedHash,status,built:new Date().toISOString(),
  ...(error?{error}:{}),parts:Object.fromEntries(parts.filter(p=>done[p.key]).map(p=>[p.key,done[p.key]])),terms:mergeReferenceTerms(parts.filter(p=>done[p.key]).map(p=>done[p.key]),units)});
 let writing=Promise.resolve();const persist=status=>(writing=writing.then(()=>write(status)));
 const results=await mapPool(parts,limit,async(part,i)=>{
  if(done[part.key]){finished++;return;}
  signal?.throwIfAborted();
  await stage?.(`参考文献术语整理 · ${finished}/${parts.length} 部分 · ${file.name}`);
  const input={source:file.name,part:i+1,parts:parts.length,pages:part.pages};
  done[part.key]=await model.object(`参考文献术语整理 · ${file.id} · ${i+1}/${parts.length}`,prompt+'\n\n'+CONTRACT,JSON.stringify(input),
   value=>{checkPartTerms(value,part);},{provider,cacheSlot:'reference:'+file.id+':terms:'+part.key}).then(value=>checkPartTerms(value,part));
  finished++;await persist('partial');
 });
 signal?.throwIfAborted();
 const failed=results.find(r=>r.status==='rejected');
 if(failed)error=failed.reason?.message||String(failed.reason);
 await persist(error?'partial':'complete');await writing;
 const latest=await json(file_,null);
 return {terms:latest?.terms||[],status:error?'partial':'complete',error};
}
