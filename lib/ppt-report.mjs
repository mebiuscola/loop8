export const PPT_SCHEMA='classroom.ppt-visual.v1';
function fail(message){throw Error('PPT 解析 JSON：'+message);}
function text(value,label,empty=false){if(typeof value!=='string'||!empty&&!value.trim())fail(label+' 必须为文字。');}
function strings(value,label){if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v.trim()))fail(label+' 必须为非空文字数组（无内容时用空数组）。');}
export function validateReport(report,expectedHash){
 if(report?.schema!==PPT_SCHEMA)fail('格式版本应为 '+PPT_SCHEMA+'。');
 const source=report.source;text(source?.fileName,'source.fileName');
 if(!/^[a-f0-9]{64}$/i.test(source?.sha256||''))fail('缺少原件 SHA-256。');
 if(expectedHash&&source.sha256.toLowerCase()!==expectedHash.toLowerCase())fail('与当前上传的原始文件不匹配，请选择对应原件的解析结果。');
 if(!['pptx','ppt','pdf'].includes(source.format))fail('source.format 应为 pptx、ppt 或 pdf。');
 if(!Number.isInteger(source.pageCount)||source.pageCount<1||source.pageCount>2000)fail('总页数必须为 1–2000。');
 if(!Array.isArray(report.pages)||report.pages.length!==source.pageCount)fail('必须保留全部页面，包括空白页、隐藏页和未完成页。');
 for(const [index,page] of report.pages.entries()){
  const label=`第 ${index+1} 页`;
  if(page?.page!==index+1)fail(label+' 页序错误，page 从 1 开始且必须连续。');
  text(page.title,label+' title',true);if(typeof page.hidden!=='boolean'||typeof page.blank!=='boolean')fail(label+' hidden / blank 应为布尔值。');
  text(page.speakerNotes,label+' speakerNotes',true);
  if(!Array.isArray(page.originalText))fail(label+' originalText 应为数组。');
  for(const item of page.originalText){text(item?.text,label+' 原文');if(!['native','visual_ocr'].includes(item.method))fail(label+' 原文 method 应为 native 或 visual_ocr。');if(item.role!==undefined&&!['body','heading','caption','footer','page_number','decoration'].includes(item.role))fail(label+' 原文 role 无效。');if(item.uncertainty!==undefined)text(item.uncertainty,label+' 原文疑点',true);}
  if(!Array.isArray(page.visualObservations))fail(label+' visualObservations 应为数组。');
  const ids=new Set();for(const item of page.visualObservations){text(item?.id,label+' 图像 ID');if(ids.has(item.id))fail(label+' 图像 ID 重复。');ids.add(item.id);text(item.kind,label+' 图像类型');text(item.description,label+' 图像描述');if(item.visibleText!==undefined)text(item.visibleText,label+' 图片文字',true);if(item.relations!==undefined)strings(item.relations,label+' 图像关系');if(item.uncertainties!==undefined)strings(item.uncertainties,label+' 图像疑点');}
  strings(page.analysis,label+' analysis');strings(page.uncertainties,label+' uncertainties');
  const check=page.inspection;if(typeof check?.textExtracted!=='boolean'||typeof check?.fullPageViewed!=='boolean'||!['complete','partial','unavailable'].includes(check.status))fail(label+' inspection 记录不完整。');
  if(check.status==='complete'&&!check.fullPageViewed)fail(label+' 未查看整页，不能标为 complete。');
  if(!check.fullPageViewed&&(page.visualObservations.length||page.originalText.some(t=>t.method==='visual_ocr')))fail(label+' 未查看整页，不能声称完成图像观察或视觉 OCR。');
  if(check.status!=='complete'&&!page.uncertainties.length)fail(label+' 未完成页必须说明疑点或缺失内容。');
  if(page.blank&&(page.originalText.length||page.visualObservations.length))fail(label+' 标为空白但仍包含正文或图像观察。');
 }
 return report;
}
export function reportSummary(report){return {pages:report.pages.length,viewed:report.pages.filter(p=>p.inspection.fullPageViewed).length,incomplete:report.pages.filter(p=>p.inspection.status!=='complete').length,hidden:report.pages.filter(p=>p.hidden).length};}
