import {parseJson,chunks} from './core.mjs';
import {translatable,validateLearning,LEARNING_SCHEMA,PAGE_TYPES} from './ppt-learning.mjs';
import {PPT_SCHEMA,validateReport} from './ppt-report.mjs';
import {contentHash} from './materials.mjs';

// Only used after a combined response is truncated. Cache completed substeps so
// a failed explanation does not force OCR or translation to be repeated.
export async function splitLearning({input,source,settings,prompts,state,call,options,persist}){
 if(!state.original){const value=parseJson(await call(settings,prompts.parse,JSON.stringify(input),options));value.page=1;value.hidden=!!input.hidden;value.speakerNotes=input.speakerNotes||'';
  validateReport({schema:PPT_SCHEMA,source:{...source,pageCount:1},pages:[value]},source.sha256);state.original=value;await persist();}
 const value=structuredClone(state.original),translated=[];state.translations??={};
 const originals=value.originalText.flatMap((p,i)=>translatable(p)?[{id:String(i),english:p.text}]:[]);
 // Split exceptionally dense text entries but keep final paragraph alignment.
 const parts=originals.flatMap(p=>chunks(p.english,3500).map((english,i)=>({id:p.id+':'+i,originalIndex:Number(p.id),english}))),batches=[];let batch=[],size=0;
 for(const p of parts){if(batch.length&&size+p.english.length>5000){batches.push(batch);batch=[];size=0;}batch.push(p);size+=p.english.length;}if(batch.length)batches.push(batch);
 for(const paragraphs of batches){const k=contentHash(JSON.stringify(paragraphs));let answer=state.translations[k];if(!answer){answer=parseJson(await call(settings,prompts.translation,JSON.stringify({page:input.page,paragraphs}),{...options,images:undefined}));
   if(!Array.isArray(answer.paragraphs)||JSON.stringify(answer.paragraphs.map(p=>p.id))!==JSON.stringify(paragraphs.map(p=>p.id))||answer.paragraphs.some(p=>typeof p.chinese!=='string'||!p.chinese.trim()))throw Error('密集页的分批翻译缺段或顺序错误。');state.translations[k]=answer;await persist();}
  translated.push(...answer.paragraphs.map((p,i)=>({...p,originalIndex:paragraphs[i].originalIndex})));}
 if(!state.explanation){const answer=parseJson(await call(settings,prompts.explanation,JSON.stringify({...input,recognizedOriginal:value.originalText,visualObservations:value.visualObservations,uncertainties:value.uncertainties}),options));if(!PAGE_TYPES.includes(answer.pageType)||typeof answer.closeReading!=='string'||!answer.closeReading.trim())throw Error('密集页解读缺少有效页面类型或解释。');state.explanation=answer;await persist();}
 value.learning={schema:LEARNING_SCHEMA,...state.explanation,paragraphs:originals.map(p=>({originalIndex:Number(p.id),chinese:translated.filter(t=>t.originalIndex===Number(p.id)).map(t=>t.chinese).join('\n\n')}))};validateLearning(value);return value;
}
