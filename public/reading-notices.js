export function readingNotices({bar,close,tools,retry}){
 const list=document.createElement('ul'),details=document.createElement('details'),summary=document.createElement('summary'),all=document.createElement('ul');
 list.className='reading-notice-list';all.className='reading-detail-list';details.className='reading-material-details';details.hidden=true;summary.textContent='材料详情';details.append(summary,all);tools.append(details);
 close.setAttribute('aria-label','关闭错误提示');bar.classList.add('reading-notices');bar.setAttribute('role','alert');bar.append(list);
 if(retry){const button=document.createElement('button');button.type='button';button.textContent='重新读取';button.className='reading-retry';button.onclick=async()=>{button.disabled=true;try{await retry();}finally{button.disabled=false;}};bar.append(button);}
 let key='',issues=[],dismissed=new Set();
 const items=values=>values.map(issue=>{const item=document.createElement('li');item.textContent=issue.text;return item;});
 function paint(){
  const errors=issues.filter(issue=>issue.severity==='error'&&!dismissed.has(issue.id));
  bar.hidden=!errors.length;details.hidden=!issues.length;
  list.replaceChildren(...items(errors));all.replaceChildren(...items(issues));
 }
 close.onclick=()=>{dismissed=new Set([...dismissed,...issues.filter(i=>i.severity==='error').map(i=>i.id)]);try{localStorage.setItem(key,JSON.stringify([...dismissed]));}catch{}paint();summary.focus({preventScroll:true});};
 return {update(materialKey,next){
  const nextKey='classroom-reading-notices:'+materialKey;
  if(key!==nextKey){key=nextKey;details.open=false;try{dismissed=new Set(JSON.parse(localStorage.getItem(key)||'[]'));}catch{dismissed=new Set();}}
  issues=next.filter(issue=>!issue.guide);paint();
 }};
}
