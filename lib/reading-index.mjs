import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {json,save} from './core.mjs';
import {contentHash,manualDocument,BLOCK_SCHEMA} from './materials.mjs';
import {sourcePath} from './storage.mjs';
import {resolveReferenceRecord} from './reading-references.mjs';
const SCHEMA='classroom.reading-index.v1',hashes=new Map();
const stops=new Set('the a an and or of to in is are was were be been being this that these those it its as for with by from on at we you they their our not but can could would should will have has had do does did which what how where when who why than then into about also such more most some any only'.split(' '));
export const normalizeReading=s=>String(s||'').normalize('NFKC').replace(/[\u00ad\u200b]/g,'').replace(/\s+/g,' ').trim();
function tokens(text){const raw=normalizeReading(text).toLowerCase().match(/[a-z][a-z0-9'-]{2,}|[\u3400-\u9fff]+/g)||[],out=[];for(let t of raw){if(stops.has(t))continue;if(/[\u3400-\u9fff]/.test(t)){for(let i=0;i<t.length-1;i++)out.push(t.slice(i,i+2));if(t.length===1)out.push(t);}else{if(t.length>5&&t.endsWith('s')&&!t.endsWith('ss'))t=t.slice(0,-1);out.push(t);}}return out;}
async function fileHash(file){const s=await stat(file),stamp=[s.size,s.mtimeMs,s.ctimeMs,s.ino].join(':');if(hashes.get(file)?.stamp===stamp)return hashes.get(file).hash;const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);const hash=h.digest('hex');hashes.set(file,{stamp,hash});if(hashes.size>64)hashes.delete(hashes.keys().next().value);return hash;}
function parsedPath(dir,name){const root=path.resolve(dir,'Parsed'),target=path.resolve(root,name),relative=path.relative(root,target);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Reading 解析路径无效。');return target;}
export function readingBlock(block,provenance=''){
 if(block.evidenceKind==='uncertainty'||provenance==='local-ai-pdf'&&/^\[(?:AI PDF recovery status|Uncertainty)\]/.test(block.text||''))return null;
 let text=[block.text,block.html,...(block.items||[]),...(block.captions||[]),...(block.footnotes||[])].filter(s=>typeof s==='string'&&s.trim()).join('\n\n'),printedPage=null,kind=block.type||'text';
 const header=provenance==='local-ai-pdf'&&text.match(/^\[([a-z_]+) \| Printed page: ([^\]\n]+)\]\r?\n/);if(header){kind=header[1];printedPage=header[2]==='unknown'?null:header[2];text=text.slice(header[0].length);}
 if(!text.trim())return null;return {text,kind,printedPage,evidenceKind:block.evidenceKind==='visual_observation'?'visual_observation':'original',pageIndex:Number.isInteger(block.pageIndex)&&block.pageIndex>=0?block.pageIndex:null};
}
async function loadReading(p,dir,file){
 if(!file.parsed)throw Error('尚未解析，原件已保留。');const sourceHash=await fileHash(sourcePath(dir,file.stored));if(file.sha256&&file.sha256!==sourceHash)throw Error('原件已经变化，旧解析不可作为当前原文。');const bytes=await readFile(parsedPath(dir,file.parsed)),parsedHash=contentHash(bytes),source={id:file.id,name:file.name,role:'reading'};
 const doc=/\.json$/i.test(file.parsed)?JSON.parse(bytes.toString('utf8')):manualDocument(bytes.toString('utf8'),source);
 if(doc.schema!==BLOCK_SCHEMA||!Array.isArray(doc.blocks))throw Error('Reading 不是标准化内容块。');if(doc.sourceHash&&doc.sourceHash!==sourceHash)throw Error('Reading 解析与原件不匹配。');const printedPages=new Map();for(const b of doc.blocks)if(b.type==='page_number'&&Number.isInteger(b.pageIndex)&&typeof b.text==='string'&&b.text.trim().length<=40){const page=b.pageIndex,v=b.text.trim();if(!printedPages.has(page))printedPages.set(page,v);else if(printedPages.get(page)!==v)printedPages.set(page,null);}return {file,doc,sourceHash,parsedHash,printedPages};
}
function spans(text,size=1500){const out=[];for(let start=0;start<text.length;){let end=Math.min(text.length,start+size);if(end<text.length){const split=Math.max(text.lastIndexOf('\n',end),text.lastIndexOf(' ',end));if(split>start+size/2)end=split;}if(end===start)end=Math.min(text.length,start+size);out.push({start,end});start=end;}return out;}
export async function readingIndex(project,dir){
 const loaded=new Map(),sources=[];
 for(const file of project.files.filter(f=>f.role==='reading'))try{const value=await loadReading(project,dir,file);loaded.set(file.id,value);sources.push({sourceId:file.id,name:file.name,sourceHash:value.sourceHash,parsedHash:value.parsedHash,available:true,provenance:value.doc.provenance||'normalized original',parserCoverage:value.doc.coverage||file.partialCoverage||null});}catch(e){sources.push({sourceId:file.id,name:file.name,available:false,reason:e.message});}
 const fingerprint=contentHash(JSON.stringify({schema:SCHEMA,sources})),dest=path.join(dir,'Parsed','reading_index.json'),previous=await json(dest,null);
 if(previous?.schema===SCHEMA&&previous.fingerprint===fingerprint&&Array.isArray(previous.units))return {...previous,loaded};
 const units=[];for(const source of sources.filter(s=>s.available)){const {doc}=loaded.get(source.sourceId);source.headings=[];source.uncertainties=[];source.imageOnlyBlocks=0;source.unlocatedUnits=0;const pages=new Set();
  for(const [blockIndex,b] of doc.blocks.entries()){
   if(b.evidenceKind==='uncertainty'){source.uncertainties.push({pageIndex:b.pageIndex??null,text:b.text});continue;}const block=readingBlock(b,doc.provenance);if(!block){if(b.image)source.imageOnlyBlocks++;continue;}block.printedPage??=loaded.get(source.sourceId).printedPages.get(block.pageIndex)||null;
   if(block.kind==='heading'||b.level>0)source.headings.push({text:block.text.slice(0,240),excerpted:block.text.length>240,pageIndex:block.pageIndex});
   if(block.pageIndex!==null)pages.add(block.pageIndex);
   for(const span of spans(block.text)){const text=block.text.slice(span.start,span.end),words=tokens(text),terms={};for(const t of words)terms[t]=(terms[t]||0)+1;const unit={key:source.sourceId+':'+blockIndex+':'+span.start,sourceId:source.sourceId,blockId:b.id||null,blockIndex,...span,pageIndex:block.pageIndex,printedPage:block.printedPage,kind:block.kind,evidenceKind:block.evidenceKind,characters:text.length,length:words.length,terms};if(block.pageIndex===null)source.unlocatedUnits++;units.push(unit);}
  }source.observedPages=[...pages].sort((a,b)=>a-b);source.declaredPageCount=Number.isInteger(doc.pageCount)?doc.pageCount:null;source.units=units.filter(u=>u.sourceId===source.sourceId).length;source.originalUnits=units.filter(u=>u.sourceId===source.sourceId&&u.evidenceKind==='original').length;
 }
 const result={schema:SCHEMA,fingerprint,sources,units};await save(dest,result);return {...result,loaded};
}
function referenceToken(source,unit,text){return Buffer.from(JSON.stringify({v:1,s:source.sourceId,h:source.sourceHash,p:source.parsedHash,b:unit.blockIndex,a:unit.start,z:unit.end,t:contentHash(text)})).toString('base64url');}
export function hydrateReading(index,unit){const source=index.sources.find(s=>s.sourceId===unit.sourceId),loaded=index.loaded.get(unit.sourceId),block=readingBlock(loaded.doc.blocks[unit.blockIndex],loaded.doc.provenance);if(!block||!Number.isInteger(unit.start)||!Number.isInteger(unit.end)||unit.start<0||unit.end<=unit.start||unit.end>block.text.length)throw Error('Reading 索引位置已无效，请重新生成分析以更新索引。');const text=block.text.slice(unit.start,unit.end);return {unitKey:unit.key,sourceId:unit.sourceId,source:source.name,pageIndex:block.pageIndex,printedPage:block.printedPage||loaded.printedPages.get(block.pageIndex)||null,blockId:loaded.doc.blocks[unit.blockIndex].id||null,kind:block.kind,evidenceKind:block.evidenceKind,text,reference:referenceToken(source,unit,text)};}
export function readingOrientation(index,maxUnits=12){const groups=index.sources.filter(s=>s.available).map(source=>{const all=index.units.filter(u=>u.sourceId===source.sourceId&&u.evidenceKind==='original'&&!['header','footer','page_number','discarded'].includes(u.kind));return [...new Set([0,Math.floor(all.length/2),all.length-1])].map(i=>all[i]).filter(Boolean);}),chosen=[];for(let i=0;i<3;i++)for(const group of groups)if(group[i]&&chosen.length<maxUnits)chosen.push(group[i]);return chosen.map(u=>hydrateReading(index,u));}
export function searchReading(index,queries,{maxUnits=22,perQuery=4}={}){
 const selected=new Map(),df=new Map(),N=index.units.length,average=index.units.reduce((n,u)=>n+u.length,0)/Math.max(1,N);for(const u of index.units)for(const t of Object.keys(u.terms))df.set(t,(df.get(t)||0)+1);
 const add=(u,reason)=>{if(!u)return;const old=selected.get(u.key);selected.set(u.key,{unit:u,reasons:[...new Set([...(old?.reasons||[]),reason])]});};
 for(const [qi,query] of queries.entries()){const terms=[...new Set(tokens(query))].slice(0,80),ranked=index.units.map(u=>({u,score:terms.reduce((n,t)=>{const f=u.terms[t]||0,idf=Math.log(1+(N-(df.get(t)||0)+0.5)/((df.get(t)||0)+0.5));return n+(f?idf*f*2.2/(f+1.2*(0.25+0.75*u.length/Math.max(1,average))):0);},0)*(['header','footer','page_number','discarded'].includes(u.kind)?0.2:1)})).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.u.blockIndex-b.u.blockIndex||a.u.start-b.u.start);
  for(const {u} of ranked.slice(0,perQuery)){add(u,'query '+(qi+1));const all=index.units.filter(v=>v.sourceId===u.sourceId),i=all.findIndex(v=>v.key===u.key);for(const neighbor of [all[i-1],all[i+1]])if(neighbor&&neighbor.pageIndex===u.pageIndex)add(neighbor,'neighbor context');}
 }
 // Every available Reading gets at least one actual passage if capacity allows;
 // a no-match passage is explicitly orientation, never claimed as a query hit.
 const essential=[];for(const source of index.sources.filter(s=>s.available)){let item=[...selected.values()].find(v=>v.unit.sourceId===source.sourceId);if(!item){const unit=index.units.find(u=>u.sourceId===source.sourceId&&u.evidenceKind==='original');if(unit){add(unit,'orientation; no lexical hit');item=selected.get(unit.key);}}if(item)essential.push(item);}
 const ordered=[...essential,...[...selected.values()].filter(v=>!essential.includes(v))].slice(0,maxUnits);return ordered.map(({unit,reasons})=>({...hydrateReading(index,unit),selection:reasons}));
}
export async function resolveReadingReference(project,dir,encoded){
 const ref=await resolveReferenceRecord(dir,encoded);
 if(ref.v!==1||![ref.b,ref.a,ref.z].every(Number.isSafeInteger)||ref.b<0||ref.a<0||ref.z<=ref.a||ref.z-ref.a>18000)throw Error('Reading 引用范围无效。');const file=project.files.find(f=>f.id===ref.s&&['reading','ppt','bb'].includes(f.role));if(!file)throw Error('这份 Reading 已移除。');const current=await loadReading(project,dir,file);
 if(current.sourceHash!==ref.h||current.parsedHash!==ref.p)throw Error('原件或解析已更新，旧引用不能冒充当前原文，请更新 Deep Dive。');const original=current.doc.blocks[ref.b],block=original&&readingBlock(original,current.doc.provenance);if(!block||ref.z>block.text.length)throw Error('引用段落已不存在。');const excerpt=block.text.slice(ref.a,ref.z);if(contentHash(excerpt)!==ref.t)throw Error('引用摘录已变化，请更新分析。');const a=Math.max(0,ref.a-1200),z=Math.min(block.text.length,ref.z+1200);return {file,sourceHash:current.sourceHash,source:file.name,blockId:original.id||null,pageIndex:block.pageIndex,printedPage:block.printedPage||current.printedPages.get(block.pageIndex)||null,kind:block.kind,evidenceKind:block.evidenceKind,excerpt,context:block.text.slice(a,z),contextRange:{start:a,end:z,total:block.text.length},range:{start:ref.a,end:ref.z}};
}
