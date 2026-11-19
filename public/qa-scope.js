// Three user-facing choices; the session identity is chosen separately.
export const QA_MODES=[['page','当前页'],['session','本节课'],['week','本周课']];
export function questionTarget({mode,sessionId,context,sessions,reading}){
 if(mode==='page'){
  if(!reading||!context)throw Error('请先打开 PPT 阅读并选择一页。');
  if(!context.pageAvailable)throw Error('当前页尚无有效解析，或页码对应需要核对；请先导入解析 JSON，或改选本节课／本周课。');
  return {scope:'preparation',focus:context.focus};
 }
 if(mode==='session'){
  if(!sessions.some(s=>s.id===sessionId))throw Error('请先选择要提问的课堂；尚未添加课堂时，可选择本周课。');
  return {scope:sessionId,focus:null};
 }
 if(mode==='week')return {scope:'week',focus:null};
 throw Error('请选择当前页、本节课或本周课。');
}
