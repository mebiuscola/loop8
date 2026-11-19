import {spawn} from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';

export function curlHead(url,{signal,seconds=10,allowHttp=false}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const executable=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe'):'curl';
  const child=spawn(executable,['-q','--config','-','--head','--silent','--proto',allowHttp?'=http,https':'=https','--connect-timeout',String(seconds),'--max-time',String(seconds),'--output',process.platform==='win32'?'NUL':'/dev/null','--write-out','%{http_code}'],{windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
  let result='',settled=false;
  const abort=()=>{child.kill();finish(signal.reason);};
  const timer=setTimeout(()=>{child.kill();finish(Error('系统 curl 连接 OSS 超时。'));},seconds*1000+1000);
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);}
  signal?.addEventListener('abort',abort,{once:true});child.stdin.on('error',()=>{});
  child.on('error',()=>finish(Error('系统 curl 不可用。')));child.stdout.on('data',b=>result=(result+b).slice(-20));
  child.on('close',code=>{if(signal?.aborted)return finish(signal.reason);const status=Number(result.trim());if(code===0&&status>=100&&status<600)finish(null,{status,transport:'系统 curl'});else finish(Error(`系统 curl 无法连接 OSS（退出码 ${code??'unknown'}）。`));});
  child.stdin.end(`url = "${String(url).replaceAll('\\','\\\\').replaceAll('"','\\"').replace(/[\r\n]/g,'')}"\n`);
 });
}
export function nodeHead(url,{signal,seconds=10,allowHttp=false}={}){
 signal?.throwIfAborted();
 const target=new URL(url);if(target.protocol!=='https:'&&!(allowHttp&&target.protocol==='http:'))throw Error('OSS 探测必须使用 HTTPS。');
 return new Promise((resolve,reject)=>{
  let settled=false;const req=(target.protocol==='https:'?https:http).request(target,{method:'HEAD',signal});
  const timer=setTimeout(()=>finish(Error('Node.js 连接 OSS 超时。')),seconds*1000);
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);req.destroy();error?reject(error):resolve(value);}
  req.on('response',res=>{res.resume();finish(null,{status:res.statusCode,transport:'Node.js'});});req.on('error',e=>finish(Error(`Node.js 无法连接 OSS（${e.code||'网络错误'}）。`)));req.end();
 });
}
export async function quickMineruCheck(settings,onProgress,signal,runtime={}){
 signal.throwIfAborted();
 if(settings.mineruMode!=='cloud')throw Error('快速检查适用于 MinerU 官方 API；CLI 和 Bridge 请使用完整解析测试。');
 if(!settings.mineruToken?.trim())throw Error('请先填写 MinerU API Token。');
 await onProgress('1/2 · 检查 MinerU API 响应与鉴权拒绝');
 const request=runtime.fetch||fetch;
 const response=await request('https://mineru.net/api/v4/extract-results/batch/_test',{headers:{Authorization:`Bearer ${settings.mineruToken.trim()}`},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
 if([401,403].includes(response.status))throw Error(`MinerU API 鉴权被拒绝（HTTP ${response.status}）。`);
 if(!response.ok&&response.status!==404)throw Error(`MinerU API 不可用（HTTP ${response.status}）。`);
 let data;try{data=await response.json();}catch{throw Error('MinerU API 返回的不是有效 JSON，可能遇到代理或登录页面。');}
 if(!data||typeof data!=='object'||!['number','string'].includes(typeof data.code))throw Error('MinerU API 返回格式不符合预期。');
 const code=String(data.code),msg=typeof data.msg==='string'?data.msg:'';
 if(['A0202','A0211','-60013'].includes(code))throw Error(`MinerU API 拒绝当前凭据或权限（${code}）。`);
 const missingTask=code==='-60012'||/(?:task|batch).*(?:not.?found|does not exist|invalid|expired)|(?:批次|任务).*(?:不存在|无效|过期)|(?:找不到|无效).*(?:任务|批次)/i.test(msg);
 if(code!=='0'&&!missingTask)throw Error(`MinerU API 返回业务错误（${code}），不能视为连接正常。`);
 await onProgress('1/2 ✓ API 响应符合预期，未收到鉴权拒绝；尚未创建解析任务');
 const transports=runtime.headTransports||[curlHead,nodeHead];const observations=[];let reached;
 for(let i=0;i<transports.length;i++){
  signal.throwIfAborted();await onProgress(`2/2 · 检查文件存储 OSS · ${i===0?'系统 curl':'Node.js 备用'}`);
  try{const result=await transports[i]('https://mineru.oss-cn-shanghai.aliyuncs.com',{signal,seconds:10});if(!(result.status>=100&&result.status<600))throw Error('无有效 HTTP 响应');if(result.status>=500||result.status===429)throw Error(`服务器可达，但返回 HTTP ${result.status}`);reached=result;break;}catch(e){if(signal.aborted)throw signal.reason;observations.push(e.message);await onProgress(`OSS 尝试未通过：${e.message}${i+1<transports.length?' 正在尝试备用连接。':''}`);}
 }
 if(!reached)throw Error('API 已响应，但 OSS 连接检查未通过：'+observations.join('；'));
 return `快速检查通过：API 响应符合预期；OSS 可连接（${reached.transport}，HTTP ${reached.status}）。${reached.status===403?'这里的 403 来自无签名探测，仅证明服务器可达。':''}尚未验证文件上传、解析、可用额度或大文件速度，请继续完整解析测试。`;
}
