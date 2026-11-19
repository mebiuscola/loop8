export function initQaWindow(){const panel=document.querySelector('.qa'),layout=document.querySelector('#qa-layout');let state;try{state=JSON.parse(localStorage.getItem('classroom-qa-window'))||{};}catch{state={};}let maximized=false;
 function apply(){
  const width=Math.min(innerWidth-12,Math.max(320,state.width||420)),height=Math.min(innerHeight,Math.max(300,state.height||innerHeight));
  const sidebar=document.querySelector('aside').getBoundingClientRect().width;
  const canParallel=innerWidth>=1101&&innerWidth-sidebar-width>=590&&!maximized;
  const parallel=canParallel&&!!state.parallel;
  document.documentElement.style.setProperty('--qa-width',width+'px');
  document.documentElement.style.setProperty('--qa-height',height+'px');
  document.body.classList.toggle('qa-parallel',parallel);
  panel.classList.toggle('qa-maximized',maximized);
  layout.disabled=!canParallel;
  layout.textContent=canParallel?(parallel?'悬浮':'并排'):(maximized?'已最大化':'悬浮中');
  layout.title=canParallel?'切换问答布局':maximized?'恢复面板后可切换布局':'当前宽度不足以并排';
  document.querySelector('#qa-maximize').textContent=maximized?'恢复':'最大化';
  dispatchEvent(new Event('qa-resized'));
 }
 const save=()=>localStorage.setItem('classroom-qa-window',JSON.stringify(state));
 for(const handle of panel.querySelectorAll('.qa-resize')){
  function update(dx,dy,start){
   if(handle.dataset.edge!=='top')state.width=start.w-dx;
   if(handle.dataset.edge!=='left')state.height=start.h-dy;
  }
  handle.onkeydown=event=>{
   const delta={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[event.key];
   if(!delta)return;
   event.preventDefault();
   const rect=panel.getBoundingClientRect();
   update(...delta,{w:rect.width,h:rect.height});apply();save();
  };
  handle.onpointerdown=event=>{
   if(!event.isPrimary||event.button!==0)return;
   event.preventDefault();
   const rect=panel.getBoundingClientRect(),start={x:event.clientX,y:event.clientY,w:rect.width,h:rect.height};
   maximized=false;handle.setPointerCapture(event.pointerId);
   let frame=0;
   const move=event=>{
    update(event.clientX-start.x,event.clientY-start.y,start);
    if(!frame)frame=requestAnimationFrame(()=>{frame=0;apply();});
   };
   const stop=()=>{
    if(frame)cancelAnimationFrame(frame);
    apply();save();
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(type,stop);
    handle.removeEventListener('pointermove',move);
   };
   handle.addEventListener('pointermove',move);
   for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
  };
 }
 layout.onclick=()=>{state.parallel=!state.parallel;apply();save();};
 document.querySelector('#qa-maximize').onclick=()=>{maximized=!maximized;apply();};
 addEventListener('resize',apply);apply();
}
