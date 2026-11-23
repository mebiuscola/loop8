// Full logs of Antigravity (ACP) requests, for troubleshooting. Only when the setting acpTrace is on.
// One JSON-lines file per request under <data>/diagnostics/acp/: what was sent (text in full, images
// by size), every message Antigravity sent back in order (status, plans, thoughts, tool calls and their
// results, the reply), permission questions and answers, timing, and the result or error.
// The logs contain course text: they stay on this computer, are never printed, and can be cleared.
import path from 'node:path';
import {mkdir,appendFile,readdir,stat,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

let traceDir=null;
export function setAcpTraceDir(dir){traceDir=dir;}
export const TRACE_NAME=/^\d{8}-\d{6}-[a-f0-9]{8}\.jsonl$/;

/** Starts a log for one request; returns null when logging is off. Writing never fails the request. */
export function startTrace(settings,meta){
 if(!settings?.acpTrace||!traceDir)return null;
 const at=new Date(),stamp=at.toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
 const file=path.join(traceDir,stamp+'-'+randomUUID().slice(0,8)+'.jsonl');
 let chain=mkdir(traceDir,{recursive:true}).catch(()=>{});
 const write=line=>{chain=chain.then(()=>appendFile(file,JSON.stringify({t:new Date().toISOString(),...line})+'\n')).catch(()=>{});return chain;};
 write({kind:'request',...meta});
 return {
  event:(kind,data)=>void write({kind,data}),
  end:(kind,data)=>write({kind,data}),
 };
}

/** The saved logs, newest first. */
export async function listTraces(){
 if(!traceDir)return {files:[],totalBytes:0};
 let names=[];try{names=(await readdir(traceDir)).filter(n=>TRACE_NAME.test(n));}catch{/* none yet */}
 const files=[];let totalBytes=0;
 for(const name of names.sort().reverse()){const info=await stat(path.join(traceDir,name)).catch(()=>null);if(!info)continue;files.push({name,size:info.size,at:info.mtime.toISOString()});totalBytes+=info.size;}
 return {files,totalBytes};
}
export function tracePath(name){if(!traceDir||!TRACE_NAME.test(String(name)))throw Error('无效日志文件。');return path.join(traceDir,name);}
/** Deletes every saved log (only files this module writes). */
export async function clearTraces(){
 const {files}=await listTraces();
 for(const f of files)await rm(path.join(traceDir,f.name),{force:true});
 return files.length;
}
