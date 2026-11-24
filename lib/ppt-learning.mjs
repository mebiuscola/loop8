import {contentHash} from './materials.mjs';
export const LEARNING_SCHEMA='classroom.ppt-learning.v1';
export const PAGE_TYPES=['cover','agenda','concept','quotation','diagram','assessment','example','transition','blank','other'];
export const translatable=item=>!['footer','page_number','decoration'].includes(item.role);
export function validateLearning(page){
 const v=page.learning;if(v?.schema!==LEARNING_SCHEMA||!PAGE_TYPES.includes(v.pageType)||!Array.isArray(v.paragraphs)||typeof v.closeReading!=='string'||!v.closeReading.trim())throw Error('PPT 学习结果缺少页面类型、正文翻译或解读。');
 const expected=page.originalText.flatMap((item,i)=>translatable(item)?[i]:[]);
 if(JSON.stringify(v.paragraphs.map(p=>p.originalIndex))!==JSON.stringify(expected)||v.paragraphs.some(p=>typeof p.chinese!=='string'||!p.chinese.trim()))throw Error('正文翻译必须按 originalIndex 完整对应原文，不能漏段、重复或加入脚注解释。');
 if(page.blank&&v.paragraphs.length)throw Error('空白页不能有正文译文。');return page;
}
export function readerPage(page,file,hash){return {sourceId:file.id,source:file.name,pageIndex:page.page-1,sourceHash:hash,pageType:page.learning.pageType,paragraphs:page.learning.paragraphs.map(p=>({english:page.originalText[p.originalIndex].text,chinese:p.chinese})),closeReading:page.learning.closeReading,inspection:{...page.inspection},quality:page.quality||null,renderKey:page.quality?.renderKey||null,learningSchema:LEARNING_SCHEMA};}
export function mapKey(inventory,prompt){return contentHash(JSON.stringify({inventory,prompt}));}
export function validateMap(v,total){
 if(typeof v?.overview!=='string'||!Array.isArray(v.pages)||v.pages.length!==total)throw Error('课件地图必须覆盖全部页。');
 for(const [i,p] of v.pages.entries())if(p?.page!==i+1||typeof p.title!=='string'||typeof p.section!=='string'||typeof p.purpose!=='string')throw Error('课件地图页序或字段不完整。');
 if(!Array.isArray(v.terms)||v.terms.some(t=>typeof t.english!=='string'||typeof t.chinese!=='string'))throw Error('课件地图术语表无效。');return v;
}
export function pageContext(map,inventory,index){
 const current=map.pages[index];
 const neighbours=[map.pages[index-1],map.pages[index+1]].filter(Boolean)
  .map(({page,title,purpose})=>({page,title:title.slice(0,180),purpose:purpose.slice(0,420)}));
 const page=inventory[index];
 const source=[page?.nativeText,page?.speakerNotes,current?.title,current?.purpose].join('\n').normalize('NFKC').toLowerCase();
 const terms=map.terms.filter(term=>source.includes(term.english.normalize('NFKC').toLowerCase())).slice(0,20);
 return {current,neighbours,terms};
}
