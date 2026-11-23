import {readFile} from 'node:fs/promises';
import {materialSettings,fallbackSettings} from './ai-material.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {complete,normalize} from './adapters.mjs';
import {parseJson} from './core.mjs';
import {quickMineruCheck} from './connectivity.mjs';
import {documentText} from './materials.mjs';
import {mineruCloud} from './mineru-cloud.mjs';
export function testPdf(){
 const text='BT /F1 20 Tf 40 140 Td (Classroom connection test) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(pdf);
}
export function validateVisionResponse(text,settings={}){
 const clean=String(text||'').trim();
 let value;
 try{value=parseJson(clean);}catch{}
 if(value?.books===7&&value?.notes===4)return '图片识别通过；本次回复的 JSON 格式也正确。';
 if(/\bBooks\s*[:=]?\s*7\b/i.test(clean)&&/\bNotes\s*[:=]?\s*4\b/i.test(clean)){
  return '图片识别通过；回复采用文字格式，JSON 输出请单独测试。';
 }
 const excerpt=diagnosticError(Error(clean.replace(/\s+/g,' ').slice(0,800)),new AbortController().signal,settings).slice(0,240);
 throw Error('图片识别测试未通过，模型回复未能核对到图表中的数值。回复样例「'+(excerpt||'空回复')+'」。');
}
export async function testConnection(kind,settings,onProgress,signal,interaction={}){
 signal.throwIfAborted();
 if(kind==='mineru-connection')return quickMineruCheck(settings,onProgress,signal);
 if(kind==='vision'||kind==='fallback-vision'){
  await onProgress('发送一张小图表，检查模型能否读出其中 Books 和 Notes 两个数值；等待回复');
  const image='data:image/png;base64,'+(await readFile(new URL('../resources/vision-check.png',import.meta.url))).toString('base64');
  const selected=(kind==='fallback-vision')?fallbackSettings(settings):['antigravity-acp','chatgpt-plan'].includes(settings.provider)?settings:materialSettings(settings);
  const text=await complete({...selected,maxOutputTokens:Math.min(settings.maxOutputTokens||4096,4096)},
   'Read the attached chart only. Report the numeric values labelled Books and Notes as plain text: Books <number>, Notes <number>. If you cannot read the chart, say UNREADABLE. Do not guess.',
   'What are the Books and Notes values in this chart?',{...interaction,images:[image],signal});
  return validateVisionResponse(text,selected);
 }
 if(kind==='text'){
  await onProgress('发送一句很短的文字请求（要求回复 OK），等待回复');
  const text=await complete(settings,'This is a plain text connectivity check.','Reply with exactly OK.',{...interaction,signal});
  if(text.trim().toUpperCase()!=='OK')throw Error('已收到完整的流式回复，但测试文字不符合预期。');
  return '纯文字测试通过：已收到完整流式回复。';
 }
 if(kind==='ai'||kind==='json'){
  await onProgress('发送一个很短的请求（要求只回复 {"status":"ok"}），检查能否连通并按要求返回 JSON；等待回复');
  const text=await complete({...settings,maxOutputTokens:Math.min(settings.maxOutputTokens,1024)},'This is a connectivity check. Return only the JSON object requested by the user.','Return exactly {"status":"ok"}.',{...interaction,signal,...(kind==='json'?{json:true}:{})});
  await onProgress('校验模型返回格式');
  let value;try{value=parseJson(text);}catch{throw Error('模型已连接，但没有返回要求的 JSON；请检查模型的结构化输出能力。');}
  if(value.status!=='ok')throw Error('模型已连接，但测试返回内容不符合要求。');
  return 'AI 测试成功：已收到有效 JSON 回复。小请求可用；长课堂仍受模型上下文和输出上限约束。';
 }
 if(kind!=='mineru')throw Error('无效测试类型。');
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-connect-'));
 try{const file=path.join(dir,'Classroom_connection_test.pdf');await writeFile(file,testPdf());await onProgress('准备单页测试 PDF（不到 1 KB）');const result=settings.mineruMode==='cloud'?await mineruCloud(settings,file,onProgress,{signal}):await normalize(settings,file,path.join(dir,'parsed'),onProgress,{signal});const text=typeof result==='string'?result:documentText(result);if(!text.toLowerCase().includes('classroom'))throw Error('解析请求已完成，但结果未包含测试页文字；请检查解析输出。');return 'MinerU 测试成功：测试页已上传、解析并取回 JSON 文字。大文件上传速度仍取决于网络。';}
 finally{const relative=path.relative(os.tmpdir(),dir);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))await rm(dir,{recursive:true,force:true});}
}
// Model tests wait this long for an answer; slower (thinking) models can need more than a minute.
export const MODEL_TEST_SECONDS=120;
export function diagnosticError(e,signal,settings,context='mineru'){
 let message=signal.aborted?(context==='model'?`等待 ${MODEL_TEST_SECONDS} 秒仍没有收到回复，已停止等待。请求已经发出，服务方可能仍在处理（AI Studio 等后台会记录这次调用）。较慢的模型在实际任务中会等待更久（最长 10 分钟）；如果经常超时，请换用较快的模型或稍后再试。`:'测试超过等待上限，已停止本地等待。MinerU 已提交的云端任务可能仍在运行。'):e.message;
 if(e.name==='TimeoutError'&&!signal.aborted)message='当前阶段连接超时，请检查网络和代理；可根据停止阶段区分 API 或 OSS 问题。';
 if(e.message==='fetch failed'){const code=e.cause?.code;message=`连接失败${code?'（'+code+'）':''}。请检查网络、代理及服务地址。`;}
 if(/HTTP 401|A0202|A0211/.test(message))message+=' 请检查密钥是否正确或已过期。';
 if(/HTTP 403/.test(message))message+=/上传服务器/.test(message)?' 请检查签名上传地址是否过期或权限不匹配。':' 当前密钥可能没有该服务或模型的访问权限。';
 if(/HTTP 429/.test(message))message+=' 请检查服务额度或请求频率限制。';
 for(const key of ['apiKey','parseApiKey','fallbackApiKey','mineruKey','mineruToken'])if(settings[key])message=message.replaceAll(settings[key],'[已隐藏密钥]');
 return message.replace(/https?:\/\/\S+/g,'[服务地址]').slice(0,600);
}
