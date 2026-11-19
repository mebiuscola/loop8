export function translationValidator(parts){return v=>{if(!Array.isArray(v?.paragraphs)||JSON.stringify(v.paragraphs.map(p=>p.id))!==JSON.stringify(parts.map(p=>p.id))||v.paragraphs.some(p=>typeof p.chinese!=='string'||!p.chinese.trim())){const e=Error('正文译文段落必须完整对应原文，保持 id 和顺序。');e.details={expected:parts.map(p=>p.id),received:v?.paragraphs?.map(p=>p.id)};throw e;}};}
export async function translateParagraphs(model,prompt,input){const parts=input.paragraphs;return model.object('PPT 正文双语翻译',prompt,JSON.stringify(input),translationValidator(parts),{repair:async({value})=>{
 const accepted=new Map();for(const p of value?.paragraphs||[])if(parts.some(s=>s.id===p.id)&&!accepted.has(p.id)&&typeof p.chinese==='string'&&p.chinese.trim())accepted.set(p.id,p.chinese);
 for(const p of parts)if(!accepted.has(p.id)){const translated=await model.object('PPT 补译单段',prompt,JSON.stringify({...input,paragraphs:[p]}),translationValidator([p]),{cacheSlot:JSON.stringify([input.sourceId,input.pageIndex,input.part,p.id])});accepted.set(p.id,translated.paragraphs[0].chinese);}
 return {paragraphs:parts.map(p=>({id:p.id,chinese:accepted.get(p.id)}))};
 }});}
