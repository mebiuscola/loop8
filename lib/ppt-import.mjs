import {PPT_SCHEMA,validateReport,reportSummary} from './ppt-report.mjs';
export {PPT_SCHEMA};
export function externalPptDocument(report,source,expectedHash){
 validateReport(report,expectedHash);if(source.role!=='ppt')throw Error('完整 PPT 解析 JSON 只能导入对应 PPT 材料。');
 const blocks=[];const append=(page,kind,text)=>{if(text.trim())blocks.push({id:`${source.id}:b${blocks.length+1}`,type:'text',pageIndex:page.page-1,evidenceKind:kind,text});};
 for(const page of report.pages){
  for(const item of page.originalText){append(page,'original',`[Original text | ${item.method}]\n${item.text}`);blocks.at(-1).originalText=item.text;blocks.at(-1).originalRole=item.role||'body';if(item.uncertainty)append(page,'uncertainty','[OCR uncertainty] '+item.uncertainty);}
  for(const item of page.visualObservations)append(page,'visual_observation',`[Visual observation | ${item.id} | ${item.kind}]\n${item.description}${item.visibleText?'\n[Visible image text; observation transcript] '+item.visibleText:''}${item.relations?.length?'\n[Observed relations] '+item.relations.join('; '):''}${item.uncertainties?.length?'\n[Visual uncertainty] '+item.uncertainties.join('; '):''}`);
  if(page.speakerNotes)append(page,'notes','[Speaker notes from file; not classroom speech]\n'+page.speakerNotes);
  for(const text of page.analysis)append(page,'analysis','[Analysis by external PPT Skill; not original slide text or lecturer speech]\n'+text);
  for(const text of page.uncertainties)append(page,'uncertainty','[Uncertainty]\n'+text);
  append(page,'inspection',`[External PPT Skill inspection] page ${page.page}; hidden=${page.hidden}; blank=${page.blank}; status=${page.inspection.status}; fullPageViewed=${page.inspection.fullPageViewed}. This is the imported report's record, not a new visual inspection by this app.`);
 }
 return {schema:'classroom.blocks.v1',source,provenance:'external-ppt-skill',blocks,pageCount:report.source.pageCount,externalPpt:{schema:PPT_SCHEMA,originalSource:report.source,summary:reportSummary(report),pages:report.pages.map(p=>({pageIndex:p.page-1,title:p.title,hidden:p.hidden,blank:p.blank,...p.inspection}))}};
}
