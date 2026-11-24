import {spawn} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {walk} from './core.mjs';
import {mineruCloud} from './mineru-cloud.mjs';
import {completeAcp} from './acp-client.mjs';
import {acpInteraction} from './acp-interaction.mjs';
import {completeChatGPT} from './chatgpt-responses.mjs';
let chatGPTPlan;
export const setChatGPTPlan=plan=>{chatGPTPlan=plan;};
/**
 * The reason the API gave for an error (e.g. Gemini's "UNAVAILABLE: The model is overloaded"),
 * short, without keys or addresses. It never contains the request's course text.
 */
async function providerReason(response,settings){
 let raw='';try{raw=await response.text();}catch{return '';}
 let data=null;try{data=JSON.parse(raw);}catch{/* plain text */}
 const error=(Array.isArray(data)?data[0]:data)?.error;
 let text=error?[error.status,error.message].filter(v=>typeof v==='string'&&v).join(': '):'';
 if(!text&&raw&&!/^\s*</.test(raw))text=raw;
 for(const key of [settings.apiKey].filter(Boolean))text=text.replaceAll(key,'[已隐藏密钥]');
 return text.replace(/https?:\/\/\S+/g,'[服务地址]').replace(/\s+/g,' ').trim().slice(0,200);
}
export async function complete(settings,system,user,options={}){
 const interaction=acpInteraction.getStore();if(interaction?.signal){options={...options,signal:options.signal?AbortSignal.any([interaction.signal,options.signal]):interaction.signal};options.signal.throwIfAborted();}
 if(settings.provider==='antigravity-acp')return completeAcp(settings,system,user,options);
 if(settings.provider==='chatgpt-plan')return completeChatGPT(chatGPTPlan,settings,system,user,options);
 if(!settings.apiKey||!settings.model)throw Error('请先在设置中填写 API Key 和模型名称。');
 if(system.length+user.length>settings.contextChars)throw Error('本次上下文超过设置上限。请提高 contextChars（确认模型支持），或减少材料。没有截断材料。');
 const url=new URL(settings.baseUrl.replace(/\/$/,'')+'/chat/completions');
 const content=options.images?.length?[{type:'text',text:user},...options.images.map(url=>({type:'image_url',image_url:{url}}))]:user;
 if(options.images?.reduce((n,v)=>n+Buffer.byteLength(v),0)>32*1024*1024)throw Error('图片请求超过 32 MB，请降低页面分辨率。');
 const request=fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${settings.apiKey}`},body:JSON.stringify({model:settings.model,messages:[{role:'system',content:system},{role:'user',content}],...(options.json?{response_format:{type:'json_object'}}:{}),...(settings.reasoningEffort?{reasoning_effort:settings.reasoningEffort}:{}),[settings.outputTokenField||'max_completion_tokens']:settings.maxOutputTokens}),signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(600000)]):AbortSignal.timeout(600000)});
 const [response]=await Promise.all([request,options.onRequest?.()]);
 if(!response.ok){const hint=options.images?.length&&[400,415,422].includes(response.status)?'图片请求被接口拒绝；请确认模型支持图片输入，或在设置关闭 PPT 图片分析后重试。':response.status>=500?'服务方暂时不可用或模型过载（不是设置错误），请稍后再试或换用其他模型。':'请检查接口、模型和额度。';const reason=await providerReason(response,settings);const error=Error(`模型请求失败 HTTP ${response.status}${reason?'（服务方说明：'+reason+'）':''}；${hint}`);error.httpStatus=response.status;throw error;}
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{const error=Error('模型接口返回的响应不是合法 JSON。');error.formatError=true;error.rawResponse=raw;throw error;}const choice=data.choices?.[0];
 if(choice?.finish_reason!=='stop'){
  const reason=String(choice?.finish_reason||'unknown').toLowerCase(),recitation=reason==='recitation',truncated=['length','max_tokens'].includes(reason);
  const e=Error(recitation?'模型因复述内容检查停止（RECITATION）；本页已保留失败记录，将按轮次补试或交给备用模型。':truncated?'模型输出被截断，请提高单次输出 token 上限。':`模型未正常结束（${reason}），未将其内容记为成功。`);
  e.finishReason=reason;e.truncated=truncated;e.rawResponse=typeof choice?.message?.content==='string'?choice.message.content:'';e.category=recitation?'recitation':truncated?'truncated':['content_filter','refusal','safety','prohibited_content'].includes(reason)?'blocked':'format';throw e;
 }
 if(!choice.message?.content?.trim())throw Error('模型返回空内容。');return choice.message.content;
}
function command(executable,args,timeout,signal){return new Promise((resolve,reject)=>{signal?.throwIfAborted();const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:'ignore'});const abort=()=>{child.kill();reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{child.kill();reject(Error('MinerU 超时，请检查命令或改为导入解析结果。'));},timeout);const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};child.on('error',()=>{cleanup();reject(Error('无法启动 MinerU。请检查可执行文件路径。'));});child.on('close',code=>{cleanup();code===0?resolve():reject(Error(`MinerU 退出码 ${code}。可导入人工/替代解析 Markdown 后重试。`));});});}
export async function normalize(settings,input,outdir,onProgress,options={}){
 await mkdir(outdir,{recursive:true});
 if(settings.mineruMode==='cloud')return mineruCloud(settings,input,onProgress,{signal:options.signal});
 if(settings.mineruMode==='service'){
  if(!settings.mineruUrl)throw Error('请配置 MinerU bridge 服务地址。');
  const form=new FormData();form.append('file',new Blob([await readFile(input)]),path.basename(input));
  const headers=settings.mineruKey?{Authorization:`Bearer ${settings.mineruKey}`} : {};
  const response=await fetch(settings.mineruUrl,{method:'POST',headers,body:form,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(1200000)]):AbortSignal.timeout(1200000)});
  if(!response.ok)throw Error(`MinerU bridge HTTP ${response.status}`);
  const data=await response.json();if(typeof data.markdown!=='string'||!data.markdown.trim())throw Error('Bridge 必须返回 {markdown: "..."}。');return data.markdown;
 }
 if(!settings.mineruExecutable)throw Error('尚未配置 MinerU。请在设置填写命令，或在材料列表导入解析后的 Markdown。');
 const args=settings.mineruArgs.map(a=>a.replaceAll('{input}',input).replaceAll('{output}',outdir));
 await command(settings.mineruExecutable,args,1200000,options.signal);
 const files=await walk(outdir),structured=files.find(f=>f.endsWith('_content_list.json'));
 if(structured){const list=JSON.parse(await readFile(structured,'utf8'));if(Array.isArray(list)){const text=list.map(b=>`[${/\.pptx?$/i.test(input)?'PPT slide':'Reading page'} ${Number.isInteger(b.page_idx)?b.page_idx+1:'unknown'}]\n${b.text||b.table_body||b.img_caption?.join('\n')||b.table_caption?.join('\n')||''}`).join('\n\n');if(text.trim()&&list.some(b=>b.text||b.table_body))return text;}}
 const md=files.filter(f=>/\.md$/i.test(f));if(md.length!==1)throw Error('MinerU 输出中未找到唯一 Markdown。请手动导入要使用的 Markdown。');const text=await readFile(md[0],'utf8');if(!text.trim())throw Error('MinerU 返回空 Markdown。');return text;
}
