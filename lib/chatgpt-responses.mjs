import {chatgptError} from './chatgpt-plan.mjs';

const maxText=2_000_000;
const failure=(message,category='chatgpt_response')=>Object.assign(Error(message),{category,providerFailure:true});
const safeField=(value,pattern)=>typeof value==='string'&&pattern.test(value)?value:'';
function responseError(error,response,fields={}){
 const {status,headers}=response;
 const media=safeField(headers.get('content-type')?.split(';',1)[0].trim().toLowerCase(),/^[a-z0-9.+_-]{1,64}\/[a-z0-9.+_-]{1,64}$/);
 const requestIdPattern=/^[\w-]{1,128}$/;
 const requestId=safeField(headers.get('x-request-id'),requestIdPattern)||safeField(headers.get('x-oai-request-id'),requestIdPattern);
 const code=safeField(fields.code,/^[a-z0-9_]{1,100}$/i);
 const param=safeField(fields.param,/^[a-z0-9_.[\]-]{1,100}$/i);
 const details={status,media,requestId,code,param};
 const diagnostic=['HTTP '+status,media||'响应类型缺失',requestId&&'请求 ID '+requestId,code,param&&'参数 '+param].filter(Boolean).join(' · ');
 return Object.assign(error,{message:error.message+'（'+diagnostic+'）',details,httpStatus:status});
}

function completedText(response,streamed){
 const content=(response?.output||[]).flatMap(item=>item.type==='message'?item.content||[]:[]);
 if(content.some(item=>item.type==='refusal'))throw failure('模型拒绝了此请求。','blocked');
 const output=content.filter(item=>item.type==='output_text').map(item=>item.text||'').join('')||streamed;
 if(!output.trim())throw failure('ChatGPT 没有返回可用文字。');
 if(output.length>maxText)throw failure('ChatGPT 返回文字过长。');
 return output;
}

export async function readChatGPTStream(response,onText){
 const media=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
 const fail=(message,category)=>responseError(failure(message,category),response);
 if(!response.ok){
  const data=media==='application/json'||media?.endsWith('+json')?await response.json().catch(()=>null):null;
  if(!data)await response.body?.cancel().catch(()=>{});
  throw responseError(chatgptError(response.status,data?.error?.code),response,data?.error||{});
 }
 if(!response.body)throw fail('ChatGPT 返回空响应。');
 const missingType=response.status===200&&!response.headers.has('content-type');
 if(media!=='text/event-stream'&&!missingType){
  await response.body.cancel().catch(()=>{});
  throw fail(media==='text/html'?'ChatGPT 请求收到了网页，请检查网络登录页或代理。':media==='application/json'||media?.endsWith('+json')?'ChatGPT 返回了非流式 JSON。':'ChatGPT 响应类型与 SSE 不符。');
 }
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',text='',refused=false,confirmed=!missingType;
 try{
  for(;;){
   const {done,value}=await reader.read().catch(error=>{
    if(error.name==='AbortError')throw error;
    throw fail('ChatGPT 响应流读取中断，请检查网络后重试。','transport');
   });
   buffer+=decoder.decode(value,{stream:!done});
   if(buffer.length>maxText*3)throw fail('ChatGPT 流式响应过长。');
   let boundary;
   while((boundary=/\r?\n\r?\n/.exec(buffer))){
    const frame=buffer.slice(0,boundary.index);
    buffer=buffer.slice(boundary.index+boundary[0].length);
    const lines=frame.split(/\r?\n/);
    if(!confirmed&&lines.some(line=>line&&!/^(?::|(?:data|event|id|retry)(?::|$))/.test(line))){
     throw fail('ChatGPT 响应缺少类型，正文不符合 SSE 格式。');
    }
    const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')continue;
    let event;
    try{event=JSON.parse(data);}catch{throw fail('ChatGPT 返回了无效的流式事件。');}
    if(!event||typeof event.type!=='string')throw fail('ChatGPT 返回了无效的流式事件。');
    if(!confirmed){
     if(!event.type.startsWith('response.')&&event.type!=='error')throw fail('ChatGPT 响应缺少类型，正文不含有效的 Responses 事件。');
     confirmed=true;
    }
    if(event.type==='response.output_text.delta'&&typeof event.delta==='string'){
     text+=event.delta;
     if(text.length>maxText)throw fail('ChatGPT 返回文字过长。');
     onText?.(text);
    }
    if(event.type==='response.refusal.delta')refused=true;
    if(event.type==='response.failed'||event.type==='error'){
     const fields=event.response?.error||event.error||event;
     throw responseError(chatgptError(undefined,fields.code),response,fields);
    }
    if(event.type==='response.incomplete'){
     const reason=event.response?.incomplete_details?.reason;
     throw fail('ChatGPT 响应未完成，已保留原有结果。',reason==='content_filter'?'blocked':reason==='max_output_tokens'?'truncated':undefined);
    }
    if(event.type==='response.completed'){
     if(refused)throw fail('模型拒绝了此请求。','blocked');
     if(event.response?.status&&event.response.status!=='completed')throw fail('ChatGPT 响应未完成，已保留原有结果。');
     try{return completedText(event.response,text);}catch(error){throw responseError(error,response);}
    }
   }
   if(done)throw fail(confirmed?'ChatGPT 响应流中断，未收到完成事件。':'ChatGPT 响应缺少类型，未收到有效的 Responses 事件。');
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function completeChatGPT(plan,settings,instructions,text,options={}){
 if(!settings.model)throw failure('请在设置中选择 ChatGPT 账号可用的模型。','configuration');
 if(!plan)throw failure('ChatGPT 订阅连接未初始化。','configuration');
 if(instructions.length+text.length>(settings.contextChars||180000))throw failure('本次材料超过模型配置的上下文上限。','configuration');
 const images=options.images||[];
 if(images.reduce((sum,image)=>sum+Buffer.byteLength(image),0)>32*1024*1024)throw failure('图片请求超过 32 MB。','configuration');
 if(images.some(image=>!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)))throw failure('图片必须是本地生成的有效图像数据。','configuration');
 const content=[{type:'input_text',text},...images.map(image_url=>({type:'input_image',image_url,detail:'auto'}))];
 const body={model:settings.model,instructions,input:[{role:'user',content}],store:false,stream:true,...(settings.reasoningEffort?{reasoning:{effort:settings.reasoningEffort}}:{})};
 if(options.json){
  // JSON mode checks input messages for the word JSON, even with instructions set.
  content.push({type:'input_text',text:'Return one valid JSON object only.'});
  body.text={format:{type:'json_object'}};
 }
 const response=await plan.respond(body,options);
 return readChatGPTStream(response,options.onText);
}
