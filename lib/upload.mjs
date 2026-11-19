import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

export class UploadError extends Error{constructor(message,status){super(message);this.status=status;}}
function configValue(value){if(/[\r\n]/.test(value))throw new UploadError('上传路径或地址包含无效换行。');return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';}
function progressText(method,bytes,total,started){const seconds=Math.max(.1,(Date.now()-started)/1000),percent=total?Math.min(100,bytes/total*100):0;return `上传原始文件到 MinerU · ${method} · 已发送约 ${(bytes/1048576).toFixed(2)}/${(total/1048576).toFixed(2)} MB（${percent.toFixed(1)}%）· 平均 ${(bytes/1024/seconds).toFixed(0)} KB/s · ${Math.round(seconds)} 秒${bytes>=total?' · 等待服务器确认':''}`;}
export async function curlUpload(url,file,{signal,onProgress=async()=>{},size,allowHttp=false,connectSeconds=20,idleSeconds=30,maxSeconds=600,curlExecutable}={}){
 signal?.throwIfAborted();const total=size??(await stat(file)).size,started=Date.now();
 const executable=curlExecutable||(process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe'):'curl');
 return new Promise((resolve,reject)=>{
  let settled=false,bytes=0,stdout='',buffer='',lastReport=0,updates=Promise.resolve(),callbackError,stopError;
  const args=['-q','--config','-','--request','PUT','--header','Content-Type:','--proto',allowHttp?'=http,https':'=https','--connect-timeout',String(connectSeconds),'--max-time',String(maxSeconds),'--speed-limit','1','--speed-time',String(idleSeconds),'--progress-bar','--output',process.platform==='win32'?'NUL':'/dev/null','--write-out','%{http_code}'];
  const child=spawn(executable,args,{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const report=force=>{if(!force&&Date.now()-lastReport<1000)return;lastReport=Date.now();updates=updates.then(()=>onProgress(progressText('系统 curl',bytes,total,started))).catch(e=>{callbackError=e;child.kill();});};
  const heartbeat=setInterval(()=>report(true),1000);
  // Wait for process close before returning: on Windows kill() does not
  // synchronously release curl's file handle.
  const stop=error=>{stopError=error;child.kill();};
  const abort=()=>stop(signal.reason);
  const timer=setTimeout(()=>stop(new UploadError('系统上传超过总等待上限。')),maxSeconds*1000+2000);
  function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);clearInterval(heartbeat);signal?.removeEventListener('abort',abort);updates.then(()=>error||callbackError?reject(error||callbackError):resolve(result));}
  signal?.addEventListener('abort',abort,{once:true});
  child.on('error',()=>finish(new UploadError('系统 curl 无法启动。')));
  child.stdin.on('error',()=>{});
  child.stdout.on('data',data=>{stdout=(stdout+data).slice(-30);});
  child.stderr.on('data',data=>{buffer=(buffer+data).slice(-8192);const percentages=[...buffer.matchAll(/(\d+(?:\.\d+)?)%/g)];if(percentages.length){bytes=Math.min(total,Math.round(total*Number(percentages.at(-1)[1])/100));report(false);}});
  child.on('close',code=>{if(stopError)return finish(stopError);if(signal?.aborted)return finish(signal.reason);if(callbackError)return finish(callbackError);const status=Number(stdout.trim());if(code===0&&status>=200&&status<300){bytes=total;report(true);finish(null,{status,transport:'curl'});}else if(status>=400)finish(new UploadError(`上传服务器返回 HTTP ${status}。`,status));else finish(new UploadError(`系统上传失败（curl ${code??'unknown'}：${({6:'域名解析失败',7:'连接失败',28:'连接超时、传输停滞或等待服务器确认超时',35:'TLS 握手失败',60:'证书验证失败'})[code]||'传输错误'}）。`));});
  report(true);
  try{child.stdin.end(`url = ${configValue(String(url))}\nupload-file = ${configValue(file)}\n`);}catch(e){stop(e);}
 });
}
export async function nodeUpload(url,file,{signal,onProgress=async()=>{},size,allowHttp=false,connectSeconds=20,idleSeconds=30,maxSeconds=600}={}){
 signal?.throwIfAborted();url=new URL(url);if(url.protocol!=='https:'&&!(allowHttp&&url.protocol==='http:'))throw new UploadError('上传地址必须使用 HTTPS。');
 const total=size??(await stat(file)).size,started=Date.now();
 return new Promise((resolve,reject)=>{
  let bytes=0,settled=false,updates=Promise.resolve(),callbackError;const stream=createReadStream(file,{highWaterMark:64*1024});
  const req=(url.protocol==='https:'?https:http).request(url,{method:'PUT',headers:{'Content-Length':total}});
  const report=()=>{updates=updates.then(()=>onProgress(progressText('Node.js 备用',bytes,total,started))).catch(e=>{callbackError=e;req.destroy();});};
  const abort=()=>finish(signal.reason);
  const connectTimer=setTimeout(()=>finish(new UploadError('备用上传连接超时（含域名解析/TLS）。')),connectSeconds*1000);
  const totalTimer=setTimeout(()=>finish(new UploadError('备用上传超过总等待上限。')),maxSeconds*1000);
  const progressTimer=setInterval(report,1000);
  function finish(error,result){if(settled)return;settled=true;clearTimeout(connectTimer);clearTimeout(totalTimer);clearInterval(progressTimer);signal?.removeEventListener('abort',abort);stream.destroy();req.destroy();updates.then(()=>error||callbackError?reject(error||callbackError):resolve(result));}
  signal?.addEventListener('abort',abort,{once:true});
  req.on('socket',socket=>socket.once(url.protocol==='https:'?'secureConnect':'connect',()=>clearTimeout(connectTimer)));
  req.setTimeout(idleSeconds*1000,()=>finish(new UploadError('备用上传无网络进展或服务器确认超时。')));
  req.on('error',e=>finish(new UploadError(`备用上传失败（${e.code||'网络错误'}）。`)));
  req.on('response',res=>{const status=res.statusCode;res.resume();if(status>=200&&status<300){report();finish(null,{status,transport:'node'});}else finish(new UploadError(`上传服务器返回 HTTP ${status}。`,status));});
  report();
  (async()=>{try{for await(const chunk of stream){if(settled)return;await new Promise((r,j)=>req.write(chunk,e=>e?j(e):r()));bytes+=chunk.length;}if(!settled)req.end();}catch(e){if(!settled)finish(e);}})();
 });
}
export async function uploadFile(url,file,options={}){
 const size=(await stat(file)).size;const methods=options.transports||[curlUpload,nodeUpload],failures=[];
 for(let i=0;i<methods.length;i++){
  options.signal?.throwIfAborted();
  try{await options.onProgress?.(`${i===0?'开始上传':'切换备用上传方式'} · ${i===0?'系统 curl':'Node.js'} · 文件 ${(size/1048576).toFixed(2)} MB`);return await methods[i](url,file,{...options,size});}
  catch(e){if(options.signal?.aborted)throw options.signal.reason;if(e.status>=400&&e.status<500)throw e;failures.push(e.message);await options.onProgress?.(`本次上传尝试失败：${e.message}${i+1<methods.length?' 正在切换备用方式。':''}`);}
 }
 throw new UploadError(failures.join('；'));
}
