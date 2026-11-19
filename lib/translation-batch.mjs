import {parseJson} from './core.mjs';
import {failureKind} from './page-rounds.mjs';

export function translationBatches(items,{maxChars=6000,maxItems=5}={}){
 const batches=[];
 for(const item of items){
  let batch=batches.at(-1);
  if(!batch||batch.items.length>=maxItems||batch.characters+item.english.length>maxChars||batch.page!==item.page){
   batch={items:[],characters:0,page:item.page};
   batches.push(batch);
  }
  batch.items.push(item);
  batch.characters+=item.english.length;
 }
 return batches.map(batch=>batch.items);
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
 if(typeof raw==='string')try{value=parseJson(raw);}catch{}
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
