import {readFile,writeFile,rename,mkdir,readdir,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {preflightCues,coverageDetails,normalizeCueIds} from './subtitle-check.mjs';
export async function json(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function atomic(file,text){
 await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,text,'utf8');
 try{for(let attempt=0;;attempt++){try{await rename(tmp,file);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=6)throw e;await new Promise(r=>setTimeout(r,25*2**attempt));}}}
 finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export const save=(file,obj)=>atomic(file,JSON.stringify(obj,null,2));
export function safeName(s){return String(s).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,120)||'Untitled';}
export function chunks(text,limit=12000){const result=[];let current='';for(const line of text.split('\n')){if(current.length+line.length>limit&&current){result.push(current);current='';}if(line.length>limit){if(current){result.push(current);current='';}for(let i=0;i<line.length;i+=limit)result.push(line.slice(i,i+limit));}else current+=line+'\n';}if(current.trim())result.push(current);return result;}
export function parseSrt(text){const blocks=text.replace(/^\uFEFF/,'').replace(/\r/g,'').trim().split(/\n\s*\n/);const cues=[];for(const b of blocks){const lines=b.split('\n');const i=lines.findIndex(l=>/^\d{2,}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(l));if(i<0)throw Error('SRT 含无法识别的区块，请检查字幕格式。');const m=lines[i].match(/^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})/);const body=lines.slice(i+1).join('\n').trim();if(!m||!body)throw Error('SRT 区块缺少时间或文字。');cues.push({id:cues.length+1,start:m[1],end:m[2],text:body});}if(!cues.length)throw Error('SRT 为空。');return preflightCues(cues);}
export function cueBatches(cues,limit=7000){const out=[];let group=[],size=0;for(const c of cues){if(size+c.text.length>limit&&group.length){out.push(group);group=[];size=0;}group.push(c);size+=c.text.length;}if(group.length)out.push(group);return out;}
export function parseJson(text){const clean=text.replace(/^\uFEFF/,'').trim();return JSON.parse(clean.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}
export function validateSegments(segments,cues){if(!Array.isArray(segments)||!segments.length)throw Error('模型未返回课堂段落。');normalizeCueIds(segments);const expected=cues.map(c=>c.id),seen=[];for(const s of segments){if(!s||!['Lecturer','Student','Unclear speaker'].includes(s.speaker)||typeof s.english!=='string'||!s.english.trim()||!Array.isArray(s.cueIds)||!s.cueIds.length)throw Error('课堂段落格式不完整。');seen.push(...s.cueIds);}if(JSON.stringify(seen)!==JSON.stringify(expected)){const details=coverageDetails(segments,cues),e=Error('字幕覆盖或顺序检查失败：'+JSON.stringify(details));e.details=details;e.kind='coverage';throw e;}return segments;}
export async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else if(e.isFile())out.push(p);}return out;}
