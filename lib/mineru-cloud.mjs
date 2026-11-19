import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {atomic} from './core.mjs';
import {uploadFile} from './upload.mjs';
import {archiveDocument,contentHash} from './materials.mjs';
export function coordinateText(list,input){
 if(!Array.isArray(list))return '';
 return list.map(b=>{
  const pieces=[b.text,b.table_body,...(b.list_items||[]),...(b.img_caption||[]),...(b.table_caption||[]),...(b.table_footnote||[])].filter(x=>typeof x==='string'&&x.trim());
  return pieces.length?`[${/\.pptx?$/i.test(input)?'PPT slide':'Reading page'} ${Number.isInteger(b.page_idx)?b.page_idx+1:'unavailable'}]\n${pieces.join('\n')}`:'';
 }).filter(Boolean).join('\n\n');
}
async function limitedBytes(response,max){if(Number(response.headers.get('content-length'))>max)throw Error('MinerU 结果包超过本地大小上限。');let size=0,parts=[];for await(const part of response.body){size+=part.length;if(size>max)throw Error('MinerU 结果包超过本地大小上限。');parts.push(part);}return Buffer.concat(parts);}
function remoteUrl(value){const u=new URL(value);if(u.protocol!=='https:')throw Error('MinerU 上传和下载链接必须使用 HTTPS。');return u;}
export async function mineruCloud(settings,input,onProgress=async()=>{},runtime={}){
 const request=runtime.fetch||fetch,sleep=runtime.sleep||(ms=>new Promise(r=>setTimeout(r,ms))),base=runtime.baseUrl||'https://mineru.net/api/v4';
 const timed=ms=>runtime.signal?AbortSignal.any([runtime.signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);
 if(!settings.mineruToken)throw Error('请在设置中填写 MinerU 官方 API Token。');
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${settings.mineruToken}`};
 async function api(endpoint,body){const r=await request(base+endpoint,{method:body?'POST':'GET',headers,redirect:'error',...(body?{body:JSON.stringify(body)}:{}),signal:timed(120000)});if(!r.ok)throw Error(`MinerU API HTTP ${r.status}；请检查 Token、额度或服务状态。`);const d=await r.json();if(d.code!==0)throw Error(`MinerU API 错误 ${String(d.code)}；请参阅官方错误码说明。`);return d.data;}
 await onProgress('申请上传链接');
 const data=await api('/file-urls/batch',{files:[{name:path.basename(input),...(runtime.source?{data_id:runtime.source.id}:{})}],model_version:'vlm',language:settings.mineruLanguage||'en',enable_formula:true,enable_table:true});
 if(!data?.batch_id||!data.file_urls?.[0])throw Error('MinerU 未返回上传链接。');
 await onProgress(runtime.uploadGate?'等待上传名额':'上传原始文件到 MinerU');
 // Injectable transport is only for adapter contract tests; normal use streams
 // through system curl, with native Node HTTPS as a fallback.
 const uploadTask=async()=>{await onProgress('上传原始文件到 MinerU');if(runtime.fetch)return request(remoteUrl(data.file_urls[0]),{method:'PUT',body:await readFile(input),redirect:'error',signal:timed(600000)});return uploadFile(remoteUrl(data.file_urls[0]),input,{signal:runtime.signal,onProgress});};
 const upload=runtime.uploadGate?await runtime.uploadGate.run(uploadTask):await uploadTask();
 if(!(upload.status>=200&&upload.status<300))throw Error(`MinerU 文件上传失败 HTTP ${upload.status}。`);
 await onProgress('上传已获服务器确认，等待 MinerU 解析');
 const deadline=Date.now()+30*60*1000;let interval=3000;
 while(Date.now()<deadline){
  const result=await api('/extract-results/batch/'+encodeURIComponent(data.batch_id));const files=result?.extract_result||[];if(files.length>1)throw Error('单文件批次返回多个结果，已停止以避免材料对应错误。');const file=files[0];if(file?.data_id&&runtime.source&&file.data_id!==runtime.source.id)throw Error('MinerU 结果的材料 ID 不匹配，已停止。');
  if(file?.state==='failed')throw Error('MinerU 解析失败。可在官网任务列表查看原因，或手动补入 Markdown。');
  if(file?.state==='done'){
   await onProgress('下载并收录解析结果');
   const response=await request(remoteUrl(file.full_zip_url),{redirect:'follow',signal:timed(300000)});if(!response.ok)throw Error(`MinerU 结果下载失败 HTTP ${response.status}。`);
   const archive=await limitedBytes(response,200*1024*1024);
   if(runtime.archivePath)await atomic(runtime.archivePath,archive);
   const source=runtime.source||{id:contentHash(await readFile(input)).slice(0,16),name:path.basename(input),role:/\.pptx?$/i.test(input)?'ppt':'reading'};
   return archiveDocument(archive,source);
  }
  const progress=file?.extract_progress;await onProgress(`${file?.state||'排队中'}${progress?` · ${progress.extracted_pages}/${progress.total_pages} 页`:''}`);
  await sleep(interval);runtime.signal?.throwIfAborted();interval=Math.min(15000,interval+2000);
 }
 throw Error('MinerU 等待超过 30 分钟；原件已保留，可稍后重试或手动补入。');
}
