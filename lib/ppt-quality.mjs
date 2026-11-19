const compact=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const words=text=>String(text||'').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
function missingLines(nativeText,recovered){
 const target=compact(recovered),available=new Map();for(const w of words(recovered))available.set(w,(available.get(w)||0)+1);
 return String(nativeText||'').split(/\r?\n/).map(s=>s.trim()).filter(s=>compact(s).length>=6).filter(s=>{
  if(target.includes(compact(s)))return false;const source=words(s),needed=new Map();for(const w of source)needed.set(w,(needed.get(w)||0)+1);
  const matched=[...needed].reduce((n,[w,count])=>n+Math.min(count,available.get(w)||0),0);return !source.length||matched/source.length<0.9;
 });
}
export function checkCoverage(nativeText,recovered){const lines=String(nativeText||'').split(/\r?\n/).filter(s=>compact(s).length>=6),missing=missingLines(nativeText,recovered);return {method:'native-text candidate comparison; not proof of visible completeness',checked:lines.length,missing:missing.slice(0,40).map(s=>s.slice(0,600)),missingCount:missing.length};}
export function inspectRecognition(page,seed,renderKey){
 const comparison=checkCoverage(seed.nativeText,page.originalText.map(p=>p.text).join('\n'));
 const render=seed.integrity,issues=[];
 if(render?.geometry?.complete===false)issues.push('页面导出存在边界裁切，不能标记为完整识别。');
 if(render?.textIssues?.length)issues.push(`渲染检查发现 ${render.textIssues.length} 个文字区域可能裁切或超出页面。`);
 if(render?.failedImages?.length)issues.push(`渲染检查发现 ${render.failedImages.length} 张图片未加载完成。`);
 if(comparison.missingCount)issues.push(`原文覆盖待核对：${comparison.missingCount} 段原生文字候选未在识别结果中充分匹配；可能是漏读、被遮挡或原件不可见内容，不能自动补成可见原文。`);
 page.uncertainties=[...new Set([...page.uncertainties,...issues])];if(page.uncertainties.length&&page.inspection.status==='complete')page.inspection.status='partial';
 page.quality={renderKey,renderAudit:render?{geometryComplete:render.geometry?.complete,textIssues:render.textIssues?.length||0,failedImages:render.failedImages?.length||0}:null,coverage:comparison};return page;
}
export function learningFreshness(report,currentKey){const previousKey=report?.parser?.renderKey||report?.pages?.find(p=>p.quality?.renderKey)?.quality.renderKey;return {stale:!previousKey||previousKey!==currentKey,reason:previousKey?'原页预览已更新，当前识别、译文和解读基于旧图像。':'当前学习结果未记录页面图像版本，需重新核对。'};}
