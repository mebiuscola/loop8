// Geometry is measured after layout, fonts and images settle. This checks the
// browser output, not PowerPoint fidelity or whether an image has semantic text.
export function auditSlide(doc,width,height){
 const win=doc.defaultView,slide=doc.querySelector('#slide'),r=slide.getBoundingClientRect(),eps=2;
 const box=e=>{const v=e.getBoundingClientRect();return {left:v.left,top:v.top,right:v.right,bottom:v.bottom,width:v.width,height:v.height};};
 const ancestors=[doc.documentElement,doc.body].map(e=>({tag:e.tagName,...box(e),overflow:win.getComputedStyle(e).overflow}));
 const clipped=ancestors.filter(e=>/hidden|clip|auto|scroll/.test(e.overflow)&&(e.left>r.left+eps||e.top>r.top+eps||e.right<r.right-eps||e.bottom<r.bottom-eps));
 const viewport={width:win.innerWidth,height:win.innerHeight};
 const complete=!clipped.length&&r.left>=-eps&&r.top>=-eps&&r.right<=viewport.width+eps&&r.bottom<=viewport.height+eps&&Math.abs(r.width-width)<eps&&Math.abs(r.height-height)<eps;
 const textIssues=[];
 for(const node of slide.querySelectorAll('[data-classroom-text-box],td,th')){
  if(!node.textContent.trim())continue;const range=doc.createRange();range.selectNodeContents(node);const t=range.getBoundingClientRect(),b=node.getBoundingClientRect();
  if(b.width<=0||b.height<=0)continue;
  const outside=t.left<r.left-eps||t.top<r.top-eps||t.right>r.right+eps||t.bottom>r.bottom+eps;
  const style=win.getComputedStyle(node),inside=/hidden|clip/.test(style.overflow)&&(t.left<b.left-eps||t.top<b.top-eps||t.right>b.right+eps||t.bottom>b.bottom+eps);
  if(outside||inside)textIssues.push({text:node.textContent.slice(0,180),outsidePage:outside,clippedInBox:inside});
 }
 const failedImages=[...slide.querySelectorAll('img')].filter(i=>{const b=i.getBoundingClientRect();return b.width>0&&b.height>0&&(!i.complete||!i.naturalWidth);}).map(i=>({alt:i.alt||'',status:'not-loaded'}));
 return {schema:'classroom.render-audit.v1',geometry:{complete,slide:box(slide),viewport,ancestors,clippedAncestors:clipped.map(e=>e.tag)},textIssues,failedImages,renderedText:slide.textContent||''};
}
