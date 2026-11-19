import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {zipTextEntries} from './zip.mjs';
import {chunks} from './core.mjs';
export const BLOCK_SCHEMA='classroom.blocks.v1';
function strings(value,label){if(value===undefined)return [];if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw Error(`${label} 结构不支持，原始 ZIP 已保留。`);return value;}
export function contentListDocument(list,source){
 if(!Array.isArray(list)||list.some(b=>!b||typeof b!=='object'||Array.isArray(b)))throw Error('云端内容列表不是预期的平铺 JSON 数组；原始结果保留，请检查格式。');
 const blocks=list.map((b,index)=>{
  const block={id:`${source.id}:b${index+1}`,type:b.type,pageIndex:Number.isInteger(b.page_idx)&&b.page_idx>=0?b.page_idx:null};
  if(b.bbox!==undefined)block.bbox=b.bbox;
  const text=(key)=>{if(b[key]!==undefined&&typeof b[key]!=='string')throw Error(`内容块 ${index+1} 的 ${key} 格式不支持。`);return b[key]||'';};
  switch(b.type){
   case 'text':case 'heading':case 'equation':case 'discarded':case 'footnote':
   case 'aside_text':case 'page_footnote':case 'ref_text':case 'header':case 'footer':case 'page_number':
    // Keep the provider's category, full text, page and bbox. In particular,
    // footnotes and marginal/reference text are evidence, not discarded noise.
    block.text=text('text');if(Number.isInteger(b.text_level))block.level=b.text_level;if(b.text_format)block.format=b.text_format;break;
   case 'table':block.html=text('table_body');block.captions=strings(b.table_caption,'table_caption');block.footnotes=strings(b.table_footnote,'table_footnote');if(b.img_path)block.image=text('img_path');break;
   case 'image':block.image=text('img_path');block.captions=strings(b.img_caption,'img_caption');block.footnotes=strings(b.img_footnote,'img_footnote');break;
   case 'list':block.items=strings(b.list_items,'list_items');break;
   case 'code':block.text=text('code_body')||text('text');block.captions=strings(b.code_caption,'code_caption');break;
   default:throw Error(`不支持的 MinerU 内容块类型 ${String(b.type)}（第 ${index+1} 块）；不会静默丢弃，请检查原始 ZIP。`);
  }
  return block;
 });
 if(!blocks.length)throw Error('MinerU 内容列表为空。');
 return {schema:BLOCK_SCHEMA,source,blocks};
}
export function archiveDocument(bytes,source){const entries=zipTextEntries(bytes).filter(e=>/(^|\/)[^/]*content_list\.json$/i.test(e.name));if(entries.length!==1)throw Error('结果包必须包含唯一 content_list.json；不使用 Markdown 代替。原始 ZIP 已保留。');let list;try{list=JSON.parse(entries[0].text);}catch{throw Error('MinerU 内容列表 JSON 损坏。');}const result=contentListDocument(list,source);result.contentListEntry=entries[0].name;return result;}
export function blockText(block){const pieces=[block.text,block.html,...(block.items||[]),...(block.captions||[]),...(block.footnotes||[])].filter(v=>typeof v==='string'&&v.trim());const label={aside_text:'Aside / marginal text',page_footnote:'Page footnote',ref_text:'Reference text',header:'Page header; separate from body',footer:'Page footer; separate from body',page_number:'Printed page number; not PDF file page'}[block.type];if(label&&pieces.length)pieces.unshift('['+label+']');if(block.image)pieces.push(`[Image resource: ${block.image}; image pixels not inspected]`);return pieces.join('\n');}
export function documentText(doc){if(doc?.schema!==BLOCK_SCHEMA||!Array.isArray(doc.blocks))throw Error('材料不是当前标准化内容块 JSON。');return doc.blocks.map(b=>`[Source ${doc.source.id} | ${doc.source.name} | Block ${b.id} | ${doc.source.role==='ppt'?'PPT parser page':doc.source.role==='bb'?'BB page':'Reading page'} ${b.pageIndex===null?'unavailable':b.pageIndex+1}${doc.provenance==='manual-import'?' | manual import':''}]\n${blockText(b)}`).join('\n\n');}
export function documentChunks(doc,limit=12000){
 if(doc?.schema!==BLOCK_SCHEMA||!Array.isArray(doc.blocks))throw Error('材料不是当前标准化内容块 JSON。');
 const result=[];let current='';
 for(const block of doc.blocks){const header=`[Source ${doc.source.id} | ${doc.source.name} | Block ${block.id} | ${doc.source.role==='ppt'?'PPT parser page':doc.source.role==='bb'?'BB page':'Reading page'} ${block.pageIndex===null?'unavailable':block.pageIndex+1}]\n`;const parts=chunks(blockText(block),Math.max(200,limit-header.length-50));for(let i=0;i<parts.length;i++){const text=header+(parts.length>1?`[Block part ${i+1}/${parts.length}]\n`:'')+parts[i];if(current&&current.length+text.length>limit){result.push(current);current='';}current+=text+'\n\n';}}
 if(current.trim())result.push(current);return result;
}
export async function materialParts(file,limit=12000){const text=await readFile(file,'utf8');return /\.json$/i.test(file)?documentChunks(JSON.parse(text),limit):chunks(text,limit);}
export function manualDocument(text,source){if(!text.trim())throw Error('导入文字不能为空。');const blocks=[];const pattern=/^\[(?:Reading page|PPT slide)\s+(\d+)\]\s*$/gm;let start=0,page=null,match;while((match=pattern.exec(text))){if(text.slice(start,match.index).trim())blocks.push({id:`${source.id}:b${blocks.length+1}`,type:'text',pageIndex:page,text:text.slice(start,match.index).trim()});page=Number(match[1])-1;start=pattern.lastIndex;}if(text.slice(start).trim())blocks.push({id:`${source.id}:b${blocks.length+1}`,type:'text',pageIndex:page,text:text.slice(start).trim()});return {schema:BLOCK_SCHEMA,source,provenance:'manual-import',blocks};}
export async function readableMaterial(file,source){if(/\.json$/i.test(file))return documentText(JSON.parse(await readFile(file,'utf8')));return readFile(file,'utf8');}
export const contentHash=bytes=>createHash('sha256').update(bytes).digest('hex');
