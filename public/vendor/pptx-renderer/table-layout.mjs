/** DrawingML frames use border-center coordinates. HTML collapsed borders
 * occupy layout space; compensate their half-widths instead of changing the
 * authored table frame. All dimensions remain in native slide coordinates.
 */
const layouts=new WeakMap();
export function tableGeometry(node){
 const sum=values=>values.reduce((n,v)=>n+(Number.isFinite(v)&&v>0?v:0),0);
 return {gridWidth:sum(node.columns||[]),gridHeight:sum((node.rows||[]).map(r=>r.height)),frameWidth:node.authoredFrame?.size?.w??node.size.w,frameHeight:node.authoredFrame?.size?.h??node.size.h};
}
export function resolvedTableHeight(geometry,measured){if(!Number.isFinite(measured)||measured<0)throw Error('Invalid measured table height');return Math.max(0,geometry.frameHeight>0?geometry.frameHeight:geometry.gridHeight);}
export function registerTableLayout(wrapper,table,node){
 const geometry=tableGeometry(node),height=resolvedTableHeight(geometry,0);wrapper.dataset.classroomTable='true';wrapper.dataset.tableFrameHeight=String(geometry.frameHeight);wrapper.dataset.tableGridHeight=String(geometry.gridHeight);
 layouts.set(wrapper,{table,node,geometry,paddings:new Map()});wrapper.style.width=(geometry.frameWidth||geometry.gridWidth)+'px';wrapper.style.height=height+'px';wrapper.style.overflow='visible';
 table.style.height=height+'px';table.style.minHeight='';
 for(let i=0;i<table.rows.length;i++){const rowHeight=node.rows[i]?.height||0;table.rows[i].style.height=rowHeight>0?rowHeight+'px':'';}
 return wrapper;
}
function layoutTable(wrapper){
 const record=layouts.get(wrapper);if(!record||!wrapper.isConnected)return null;const {table,geometry,node,paddings}=record,height=resolvedTableHeight(geometry,0),rows=[...table.rows];
 const half=(cell,edge)=>parseFloat(getComputedStyle(cell)['border'+edge+'Width'])/2||0;
 let top=0,bottom=0,left=0,right=0;
 rows.forEach((row,i)=>[...row.cells].forEach((cell,j)=>{
  if(i===0)top=Math.max(top,half(cell,'Top'));if(i+cell.rowSpan>=rows.length)bottom=Math.max(bottom,half(cell,'Bottom'));if(j===0)left=Math.max(left,half(cell,'Left'));if(j===row.cells.length-1)right=Math.max(right,half(cell,'Right'));
  if(!paddings.has(cell)){const s=getComputedStyle(cell);paddings.set(cell,['Top','Right','Bottom','Left'].map(e=>parseFloat(s['padding'+e])||0));}
  ['Top','Right','Bottom','Left'].forEach((edge,k)=>cell.style['padding'+edge]=Math.max(0,paddings.get(cell)[k]-half(cell,edge))+'px');
 }));
 table.style.position='relative';table.style.left=-left+'px';table.style.top=-top+'px';table.style.width=(geometry.frameWidth||geometry.gridWidth)+left+right+'px';table.style.height=height+top+bottom+'px';
 const expected=height+top+bottom,measured=table.offsetHeight;table.style.clipPath=`inset(0px 0px ${Math.max(0,measured-expected)}px 0px)`;
 wrapper.dataset.tableResolvedHeight=String(height);
 const problems=[];if(table.rows.length!==node.rows.length)problems.push('行数量与原件不一致');if(measured>expected+2)problems.push('表格内容超过原课件外框');
 for(const cell of table.querySelectorAll('td')){if(!cell.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(cell);const text=range.getBoundingClientRect(),box=cell.getBoundingClientRect();if(text.bottom>box.bottom+2||text.top<box.top-2||text.right>box.right+2||text.left<box.left-2){problems.push('单元格文字超出边界');break;}}
 wrapper.dataset.tableLayoutStatus=problems.length?'warning':'ready';return {height,contentHeight:measured,gridHeight:geometry.gridHeight,frameHeight:geometry.frameHeight,problems};
}
export function layoutTables(root){return [...root.querySelectorAll('[data-classroom-table]')].map(layoutTable).filter(Boolean);}
// The host calls this once after fonts, media and layout have settled.
