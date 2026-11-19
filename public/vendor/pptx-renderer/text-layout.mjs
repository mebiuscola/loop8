/** normAutofit reflows text at the authored width. Never scale its clip box. */
const bases=new WeakMap();
export function fitTextToBox(box){
 if(!box.isConnected||getComputedStyle(box).writingMode!=='horizontal-tb'||box.style.transform)return;
 let base=bases.get(box);if(!base){base=[box,...box.querySelectorAll('*')].filter(e=>e.style.fontSize).map(e=>({element:e,style:e.style.fontSize,px:parseFloat(getComputedStyle(e).fontSize)}));bases.set(box,base);}
 if(!base.length||!box.clientWidth||!box.clientHeight)return;
 const anchor=box.style.justifyContent;box.style.justifyContent='flex-start';
 const apply=ratio=>{for(const b of base)b.element.style.fontSize=ratio===1?b.style:(b.px*ratio)+'px';};
 const fits=()=>{
  const range=document.createRange();range.selectNodeContents(box);const text=range.getBoundingClientRect(),frame=box.getBoundingClientRect(),eps=.5;
  return box.scrollHeight<=box.clientHeight+1&&box.scrollWidth<=box.clientWidth+1&&text.bottom<=frame.bottom+eps&&text.right<=frame.right+eps;
 };
 try{
  apply(1);let ratio=1;
  if(!fits()){
   let low=.1,high=1;apply(low);
   if(fits()){for(let i=0;i<16;i++){const mid=(low+high)/2;apply(mid);if(fits())low=mid;else high=mid;}ratio=low;}else ratio=.1;
   apply(ratio);
  }
  box.dataset.classroomAutofitScale=String(ratio);
 }finally{box.style.justifyContent=anchor;}
}
export function queueTextFit(box,context){
 const task=(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));fitTextToBox(box);})();
 context.asyncTasks?.push(task);return task;
}
