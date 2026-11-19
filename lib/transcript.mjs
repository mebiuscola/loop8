import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseSrt} from './core.mjs';
import {contentAudit} from './class-reconstruction.mjs';
export const TRANSCRIPT_SCHEMA='classroom.transcript.v1';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function timeMs(value){const m=String(value).match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/);if(!m||+m[2]>59||+m[3]>59)throw Error('字幕时间无效。');return ((+m[1]*60 + +m[2])*60 + +m[3])*1000 + +m[4];}
export function clock(ms){const seconds=Math.floor(ms/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
export function transcriptData(session,srt,bytes,segments){
 const cues=parseSrt(bytes.toString('utf8')),seen=[];
 const paragraphs=segments.map((s,i)=>{if(!['Lecturer','Student','Unclear speaker'].includes(s.speaker)||typeof s.english!=='string'||!s.english.trim()||typeof s.chinese!=='string'||!s.chinese.trim()||!Array.isArray(s.cueIds)||!s.cueIds.length)throw Error('讲稿段落数据不完整。');seen.push(...s.cueIds);const first=cues[s.cueIds[0]-1],last=cues[s.cueIds.at(-1)-1];if(!first||!last)throw Error('讲稿引用不存在的字幕。');const startMs=timeMs(first.start),endMs=timeMs(last.end);if(endMs<=startMs)throw Error('字幕结束时间必须晚于开始时间。');return {id:'paragraph-'+(i+1),chapter:String(s.chapter||'').replace(/[\r\n]/g,' '),speaker:s.speaker,startMs,endMs,cueIds:s.cueIds,english:s.english,chinese:s.chinese,corrections:Array.isArray(s.corrections)?s.corrections.map(String):[]};});
 if(JSON.stringify(seen)!==JSON.stringify(cues.map(c=>c.id)))throw Error('讲稿时间关联未完整覆盖字幕，或字幕顺序不符。');
 for(let i=1;i<paragraphs.length;i++)if(paragraphs[i].startMs<paragraphs[i-1].startMs)throw Error('字幕时间顺序无效。');
 return {schema:TRANSCRIPT_SCHEMA,sessionId:session.id,srtId:srt.id,srtHash:digest(bytes),paragraphs,contentAudit:contentAudit(segments,cues)};
}
export function cleanScript(title,session,timeline){
 let output=`# ${title} · ${session.type}: ${session.title}\n\n`,speaker='Lecturer',chapter='',chapterAt=-Infinity;
 for(const p of timeline.paragraphs){if(p.chapter&&p.chapter!==chapter&&(chapter===''||p.startMs-chapterAt>=180000)){output+=`## ${p.chapter}\n\n`;chapter=p.chapter;chapterAt=p.startMs;}if(p.speaker!==speaker){output+=`**${p.speaker}**\n\n`;speaker=p.speaker;}output+=p.english+'\n\n'+p.chinese+'\n\n';}
 return output;
}
export function legacyTranscript(markdown,session,srt,bytes){
 if(session.outputRevision!==session.revision)throw Error('旧讲稿使用的字幕版本无法确认，请重新生成讲稿后启用时间定位。');
 const pattern=/^## ([^\r\n]+)\r?\n\s*\n\*\*(Lecturer|Student|Unclear speaker)\*\*\s*·\s*\[SRT ([\d:,.]+) → ([\d:,.]+); cues (\d+)–(\d+)\]\s*\n/gm,matches=[...markdown.matchAll(pattern)],cues=parseSrt(bytes.toString('utf8'));
 if(!matches.length)throw Error('此旧讲稿没有可靠的段落时间，请重新生成讲稿。');
 const segments=matches.map((m,i)=>{const first=+m[5],last=+m[6];if(last<first||last-first>cues.length||!cues[first-1]||!cues[last-1]||timeMs(cues[first-1].start)!==timeMs(m[3])||timeMs(cues[last-1].end)!==timeMs(m[4]))throw Error('旧讲稿时间与当前字幕不符，请重新生成讲稿。');const body=markdown.slice(m.index+m[0].length,matches[i+1]?.index??markdown.length).replace(/^> ASR corrections:.*$/gm,'').trim(),parts=body.split(/\n\s*\n/);if(parts.length!==2)throw Error('旧讲稿段落结构无法可靠恢复，请重新生成。');return {chapter:m[1],speaker:m[2],cueIds:Array.from({length:last-first+1},(_,j)=>first+j),english:parts[0],chinese:parts[1]};});
 return {...transcriptData(session,srt,bytes,segments),legacy:true};
}
export async function loadTranscript(dir,session,files,generation){
 const folder=path.join(dir,'Output','Sessions',session.id);let data;
 try{data=JSON.parse(await readFile(path.join(folder,'Transcript_Reader.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const srt=files.find(f=>f.id===session.srtId&&f.sessionId===session.id);if(!srt||generation!==session.generation)throw Error('此历史版本没有可靠的字幕关联，请查看 Markdown，或重新生成讲稿。');return legacyTranscript(await readFile(path.join(folder,'Class_Script_Bilingual.md'),'utf8'),session,srt,await readFile(path.join(dir,'Source',srt.stored)));}
 if(data.schema!==TRANSCRIPT_SCHEMA||data.sessionId!==session.id||!Array.isArray(data.paragraphs))throw Error('讲稿时间数据无效，请重新生成。');
 const srt=files.find(f=>f.id===data.srtId&&f.sessionId===session.id);if(!srt)throw Error('讲稿对应的字幕原件不存在。');const bytes=await readFile(path.join(dir,'Source',srt.stored));if(digest(bytes)!==data.srtHash)throw Error('讲稿对应的字幕原件已变化，请重新生成讲稿。');
 const verified=transcriptData(session,srt,bytes,data.paragraphs);return {...verified,legacy:false};
}
