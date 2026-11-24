import {parseJson} from './core.mjs';
import {failureKind} from './page-rounds.mjs';

// samePage:false lets a batch run across page breaks (references); courseware keeps one page per batch.
export function translationBatches(items,{maxChars=6000,maxItems=5,samePage=true}={}){
 const batches=[];
 for(const item of items){
  let batch=batches.at(-1);
  if(!batch||batch.items.length>=maxItems||batch.characters+item.english.length>maxChars||samePage&&batch.page!==item.page){
   batch={items:[],characters:0,page:item.page};
   batches.push(batch);
  }
  batch.items.push(item);
  batch.characters+=item.english.length;
 }
 return batches.map(batch=>batch.items);
}

/**
 * The complete items of a batch reply that was cut off (Antigravity sometimes ends a reply early
 * while reporting a normal finish): every {"id","chinese"} object that closed before the cut.
 * Items cut off or missing are sent again; finished ones are kept.
 */
export function salvageTranslations(raw){
 const start=raw.indexOf('"translations"');if(start<0)return [];
 const open=raw.indexOf('[',start);if(open<0)return [];
 const out=[];let depth=0,inString=false,escaped=false,from=-1;
 for(let i=open+1;i<raw.length;i++){
  const c=raw[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"'){inString=true;continue;}
  if(c==='{'){if(depth===0)from=i;depth++;}
  else if(c==='}'&&depth>0){depth--;if(depth===0&&from>=0){try{const v=JSON.parse(raw.slice(from,i+1));if(v&&typeof v.id==='string'&&typeof v.chinese==='string')out.push(v);}catch{}from=-1;}}
  else if(c===']'&&depth===0)break;
 }
 return out;
}

export async function translateBatch(items,{signal,request,single,save,blocked}){
 signal?.throwIfAborted();
 if(items.length===1){
  const [item]=items;
  try{const chinese=await single(item);signal?.throwIfAborted();await save(item,chinese);}
  catch(error){
   if(!blocked||!['blocked','recitation'].includes(failureKind(error)))throw error;
   await blocked(item);
  }
  return;
 }
 let raw,value;
 try{raw=await request(items);}
 catch(error){
  if(!['blocked','recitation','truncated'].includes(failureKind(error)))throw error;
 }
 if(typeof raw==='string')try{value=parseJson(raw);}catch{value={translations:salvageTranslations(raw)};}
 signal?.throwIfAborted();
 const ids=new Map(items.map(item=>[item.id,item]));
 const results=new Map(),duplicates=new Set();
 if(Array.isArray(value?.translations))for(const row of value.translations){
  if(!ids.has(row?.id))continue;
  if(results.has(row.id)){duplicates.add(row.id);continue;}
  results.set(row.id,typeof row.chinese==='string'?row.chinese.trim():'');
 }
 const pending=[];
 for(const item of items){
  const chinese=results.get(item.id);
  if(chinese&&!duplicates.has(item.id))await save(item,chinese);
  else pending.push(item);
 }
 if(!pending.length)return;
 if(pending.length<items.length){
  await translateBatch(pending,{signal,request,single,save,blocked});
  return;
 }
 const middle=Math.ceil(pending.length/2);
 for(const part of [pending.slice(0,middle),pending.slice(middle)]){
  await translateBatch(part,{signal,request,single,save,blocked});
 }
}
