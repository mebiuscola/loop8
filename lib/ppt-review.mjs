import {contentHash} from './materials.mjs';
import {parseJson} from './core.mjs';
import {validateLearning} from './ppt-learning.mjs';
import {failureKind} from './page-rounds.mjs';
const CONTRACT=`Return JSON {terms:[{english,chinese,scope,pages:[positive slide numbers]}],changes:[{page,kind:"translation"|"explanation",originalIndex:0,before,after,reason}]}. originalIndex is required only for translation. before must be exact. Only edit supplied target pages; source references may point to any evidence page in the deck. No source edits. Empty arrays are valid. For mode repair_items return {repairs:[{id,value}]} ONLY for unresolved items: corrected term/change, or value:null with reason to withdraw it. Never reemit accepted items.`;
const hash=v=>contentHash(JSON.stringify(v));
export const termText=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\u00ad\u200b]/g,'').replace(/\s+/g,' ').trim();
const chineseText=s=>termText(s).replace(/\s+/g,'');
const contains=(text,term)=>{const value=termText(text),needle=termText(term);if(!needle)return false;let i=value.indexOf(needle);while(i>=0){const word=c=>c&&/[\p{L}\p{N}]/u.test(c);if(!word(value[i-1])&&!word(value[i+needle.length]))return true;i=value.indexOf(needle,i+1);}return false;};
const mergeTerms=terms=>{const out=new Map();for(const t of terms){const k=hash([termText(t.english),chineseText(t.chinese),termText(t.scope)]),old=out.get(k);out.set(k,{...t,pages:[...new Set([...(old?.pages||[]),...t.pages])].sort((a,b)=>a-b)});}return [...out.values()];};
const relevant=(terms,pages)=>terms.filter(t=>pages.some(p=>contains(p.originalText.map(b=>b.text).join('\n'),t.english)));
function applyChange(pages,c,allowed){
 const page=pages.find(p=>p.page===c?.page);if(!page||!allowed.includes(c.page)||!['translation','explanation'].includes(c.kind)||typeof c.reason!=='string'||!c.reason.trim()||typeof c.after!=='string'||!c.after.trim())throw Error('修改的页码、目标或理由无效。');
 const target=c.kind==='translation'?page.learning.paragraphs.find(p=>p.originalIndex===c.originalIndex):page.learning,field=c.kind==='translation'?'chinese':'closeReading';if(!target||typeof c.before!=='string'||target[field]!==c.before)throw Error('修改前文本与当前内容不匹配。');target[field]=c.after;validateLearning(page);
}
export function validateTerm(pages,t){
 if(!t||['english','chinese','scope'].some(k=>typeof t[k]!=='string'||!t[k].trim())||!Array.isArray(t.pages)||!t.pages.length)throw Error('术语缺少英文、中文、语境或来源页。');
 for(const n of t.pages){const page=pages.find(p=>p.page===n);if(!page||!contains(page.originalText.map(b=>b.text).join('\n'),t.english))throw Error(`术语 ${t.english}：第 ${n} 页没有匹配原文。`);const translated=page.learning.paragraphs.map(p=>p.chinese).join('\n')+'\n'+page.learning.closeReading;if(!chineseText(translated).includes(chineseText(t.chinese)))throw Error(`术语 ${t.english}：第 ${n} 页未核对到译法 ${t.chinese}。`);}
 return {english:t.english.trim(),chinese:t.chinese.trim(),scope:t.scope.trim(),pages:[...new Set(t.pages)].sort((a,b)=>a-b)};
}
export function evaluateDeckReview(pages,result,{allowedPages=pages.map(p=>p.page)}={}){
 if(!Array.isArray(result?.terms)||!Array.isArray(result.changes))throw Error('整课检查必须返回 terms 和 changes 数组。');let next=structuredClone(pages);const issues=[],terms=[],changes=[],seen=new Set();
 for(const [i,value] of result.changes.entries())try{const k=hash([value?.page,value?.kind,value?.kind==='translation'?value.originalIndex:null]);if(seen.has(k))throw Error('修改目标重复。');seen.add(k);const candidate=structuredClone(next);applyChange(candidate,value,allowedPages);next=candidate;changes.push(value);}catch(e){issues.push({id:'change-'+i,kind:'change',value,error:e.message});}
 for(const [i,value] of result.terms.entries())try{terms.push(validateTerm(next,value));}catch(e){issues.push({id:'term-'+i,kind:'term',value,error:e.message});}return {pages:next,terms:mergeTerms(terms),changes,issues};
}
export function applyDeckReview(pages,result){const r=evaluateDeckReview(pages,result);if(r.issues.length)throw Error(r.issues[0].error);return {pages:r.pages,terms:r.terms};}

export async function reviewDeck({checkpoint,prompt,settings,weeklyTerms=[],call,persist,signal,notify=async()=>{},onRateLimit=()=>{},backoff=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(checkpoint.pages.length!==checkpoint.total||Array.from({length:checkpoint.total},(_,i)=>!checkpoint.pages[i]).some(Boolean))throw Error('整课检查需要全部页面完成。');
 const ruleKey=hash({prompt,contract:CONTRACT}),basis=hash({source:checkpoint.source,original:checkpoint.pages.map(p=>[p.page,p.originalText])});let state=checkpoint.deckReviewDraft;
 if(state?.version!==3||state.ruleKey!==ruleKey||state.basis!==basis)state={version:3,ruleKey,basis,parts:{},groups:[]};checkpoint.deckReviewDraft=state;
 const system=prompt+'\n\n'+CONTRACT,limit=settings.contextChars||180000,groupPages=ns=>checkpoint.pages.filter(p=>ns.includes(p.page)),keyFor=pages=>hash({pages,terms:relevant(weeklyTerms,pages)});
 const redact=s=>{let v=String(s||'');for(const k of ['apiKey','parseApiKey','fallbackApiKey','mineruToken','mineruKey'])if(settings[k])v=v.replaceAll(settings[k],'[redacted]');return v;};
 if(!state.groups.length){let group=[],size=0;for(const page of checkpoint.pages){const n=JSON.stringify(page).length;if(group.length&&(group.length>=10||size+n>Math.min(45000,limit/2))){state.groups.push(group);group=[];size=0;}group.push(page.page);size+=n;}if(group.length)state.groups.push(group);}
 async function request(input,part){
  const user=JSON.stringify(input);if(system.length+user.length>limit)throw Error('检查输入超过 contextChars；页面成果已保留，可提高上限后继续检查。');
  for(let a=0;;a++){let raw;try{signal?.throwIfAborted();part.request={attempt:a+1,started:new Date().toISOString()};await persist();raw=await call(settings,system,user,{signal,json:true});part.diagnostic={response:redact(raw).slice(0,80000),responseTruncated:raw.length>80000,at:new Date().toISOString()};return parseJson(raw);}catch(e){const response=raw??e.rawResponse;part.diagnostic={...(typeof response==='string'?{response:redact(response).slice(0,80000),responseTruncated:response.length>80000}:{}),error:redact(e.message),at:new Date().toISOString()};await persist();if(signal?.aborted||e.name==='AbortError')throw e;const kind=failureKind(e);if(!['rate_limit','transport'].includes(kind)||a>=2)throw e;if(kind==='rate_limit')onRateLimit();await notify({phase:'网络退避',attempt:a+1});await backoff(1000*(a+1));}}
 }
 function inputFor(numbers,part,repair){
  const pages=groupPages(numbers),base={task:'ppt_deck_review',mode:repair?'repair_items':'review',pages:pages.map(p=>({page:p.page,originalText:p.originalText,learning:p.learning})),roadmap:checkpoint.pages.map(p=>({page:p.page,title:p.title})),weeklyTerminology:relevant(weeklyTerms,pages),earlierTerms:mergeTerms(Object.values(state.parts).flatMap(p=>p.terms||[])),...(repair?{unresolved:part.issues}:{})};
  // Citation evidence is text only. Other explanations are complete passages,
  // not misleading 300-character prefixes. Explicitly disclose limited coverage.
  const others=checkpoint.pages.filter(p=>!numbers.includes(p.page)),selected=[];let remaining=limit-system.length-JSON.stringify(base).length-2500;
  const words=new Set(pages.flatMap(p=>termText(p.learning.closeReading).match(/[a-z]{4,}|[\u3400-\u9fff]{2,}/g)||[]));const ranked=others.map(p=>({p,score:[...words].reduce((n,w)=>n+(termText(p.learning.closeReading).includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score||a.p.page-b.p.page);
  for(const {p} of ranked){const v={page:p.page,originalText:p.originalText,learning:p.learning},n=JSON.stringify(v).length;if(n<=remaining){selected.push(v);remaining-=n;}}
  base.otherPages=selected;base.comparisonCoverage={total:others.length,supplied:selected.length,method:selected.length===others.length?'full other pages':'selected complete pages; not exhaustive'};part.comparisonCoverage=base.comparisonCoverage;return base;
 }
 for(const [i,numbers] of state.groups.entries()){
  let quotaPaused=false;
  signal?.throwIfAborted();let part=state.parts[i],key=keyFor(groupPages(numbers));if(part?.outputKey!==key)part=state.parts[i]={terms:[],changes:[],issues:[]};if(part.outputKey===key&&part.complete)continue;
  await notify({batch:i+1,total:state.groups.length,phase:part.issues.length?'补查问题项目':'整课检查'});
  try{
   let value;const repair=!!part.outputKey&&part.issues.length>0;
   for(let a=0;a<2;a++)try{value=await request({...inputFor(numbers,part,repair),formatError:a?part.diagnostic?.error:undefined},part);if(repair&&!Array.isArray(value?.repairs))throw Error('补查必须返回 repairs 数组。');if(!repair&&(!Array.isArray(value?.terms)||!Array.isArray(value?.changes)))throw Error('检查必须返回 terms、changes 数组。');break;}catch(e){if(signal?.aborted||e.httpStatus||failureKind(e)!=='format'||a===1)throw e;part.diagnostic={...(part.diagnostic||{}),error:redact(e.message)};}
   if(repair){const pending=part.issues,results=new Map();for(const r of value.repairs)if(pending.some(p=>p.id===r.id)&&!results.has(r.id))results.set(r.id,r);const nextIssues=[];
    for(const item of pending){const r=results.get(item.id);if(!r){nextIssues.push(item);continue;}if(r.value===null&&typeof r.reason==='string'&&r.reason.trim()){(part.withdrawn??=[]).push({id:item.id,reason:r.reason});continue;}if(item.kind==='change'&&hash([r.value?.page,r.value?.kind,r.value?.originalIndex])!==hash([item.value?.page,item.value?.kind,item.value?.originalIndex])){nextIssues.push({...item,error:'补查不能改为修改已通过或无关的项目。'});continue;}const checked=evaluateDeckReview(checkpoint.pages,{terms:item.kind==='term'?[r.value]:[],changes:item.kind==='change'?[r.value]:[]},{allowedPages:numbers});if(checked.issues.length)nextIssues.push({...item,value:r.value,error:checked.issues[0].error});else{checkpoint.pages=checked.pages;part.terms.push(...checked.terms);part.changes.push(...checked.changes.map(({page,kind,originalIndex,reason})=>({page,kind,originalIndex,reason})));}}
    part.issues=nextIssues;
   }else{const checked=evaluateDeckReview(checkpoint.pages,value,{allowedPages:numbers});checkpoint.pages=checked.pages;part.terms=checked.terms;part.changes=checked.changes.map(({page,kind,originalIndex,reason})=>({page,kind,originalIndex,reason}));part.issues=checked.issues;}
   part.terms=mergeTerms(part.terms);part.complete=part.issues.length===0;delete part.error;
  }catch(e){if(signal?.aborted||e.name==='AbortError')throw e;part.error=redact(e.message);part.complete=false;quotaPaused=failureKind(e)==='quota_exhausted';}
  part.outputKey=keyFor(groupPages(numbers));await persist();
  if(quotaPaused)break;
 }
 const terms=[],issues=[];for(const [i,part] of Object.entries(state.parts)){const valid=[];for(const t of part.terms||[])try{const v=validateTerm(checkpoint.pages,t);terms.push(v);valid.push(v);}catch(e){part.issues.push({id:'term-final-'+hash(t).slice(0,12),kind:'term',value:t,error:e.message});part.complete=false;}part.terms=valid;issues.push(...part.issues.map(p=>({...p,batch:Number(i)+1})));if(part.error)issues.push({batch:Number(i)+1,kind:'request',error:part.error});}
 const next={version:3,ruleKey,status:issues.length?'pending':'complete',fingerprint:hash(checkpoint.pages),terms:mergeTerms(terms),issues,completed:Object.values(state.parts).filter(p=>p.complete).length,total:state.groups.length,changes:Object.values(state.parts).flatMap(p=>p.changes),comparisonCoverage:Object.values(state.parts).map(p=>p.comparisonCoverage).filter(Boolean)};
 const {at,...previous}=checkpoint.deckReview||{};checkpoint.deckReview={...next,at:hash(previous)===hash(next)?at:new Date().toISOString()};await persist();return checkpoint.deckReview;
}
