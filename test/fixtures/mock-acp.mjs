import * as acp from '@agentclientprotocol/sdk';
import {Readable,Writable} from 'node:stream';
let count=0,authenticated=false;const waiting=new Map(),sessions=new Map(),referenceBatches=new Set();
const configOptions=[{id:'model',name:'Model',category:'model',type:'select',currentValue:'mock-gemini',options:[{value:'mock-gemini',name:'Mock Gemini'},{value:'mock-other',name:'Mock Other'}]},{id:'thinking',name:'Thinking',category:'thought_level',type:'select',currentValue:'low',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}];
acp.agent()
 .onRequest('initialize',async ctx=>{if(process.env.MOCK_ACP_HANG==='initialize')await new Promise(()=>{});return {protocolVersion:ctx.params.protocolVersion,agentCapabilities:{promptCapabilities:{image:true}},agentInfo:{name:'Mock official ACP fixture',version:'1'},authMethods:[{id:'oauth-personal',name:'Google personal'}]};})
 .onRequest('authenticate',async ctx=>{if(ctx.params.methodId!=='oauth-personal')throw Error('Wrong auth method');
  if(process.env.MOCK_ACP_AUTH_URL){const line='Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A18901%2F&state=fixture-only\n';process.stderr.write(line.slice(0,95));await new Promise(r=>setTimeout(r,15));process.stderr.write(line.slice(95));}
  if(process.env.MOCK_ACP_AUTH_DELAY)await new Promise(r=>setTimeout(r,Number(process.env.MOCK_ACP_AUTH_DELAY)));
  if(process.env.MOCK_ACP_HANG==='authenticate')await new Promise(()=>{});authenticated=true;return {};
 })
 .onRequest('session/new',async ctx=>{
  if(process.env.MOCK_ACP_HANG==='session')await new Promise(()=>{});
  const sessionId='mock-'+(++count),options=structuredClone(configOptions);
  sessions.set(sessionId,options);
  return {sessionId,configOptions:options};
 })
 .onRequest('session/set_config_option',ctx=>{
  const {sessionId,configId,value}=ctx.params,options=sessions.get(sessionId);
  if(process.env.MOCK_ACP_IGNORE_CONFIG!=='1')options.find(option=>option.id===configId).currentValue=value;
  return {configOptions:options};
 })
 .onRequest('session/prompt',async ctx=>{
  const {sessionId,prompt}=ctx.params,text=prompt.filter(p=>p.type==='text').map(p=>p.text).join('');
  if(!authenticated)throw Error('Not authenticated');
  if(text.includes('crash-runtime'))process.exit(3);
  if(text.includes('slow-request')){await new Promise(resolve=>waiting.set(sessionId,resolve));return {stopReason:'cancelled'};}
  if(text.includes('need-permission')){const decision=await ctx.client.request('session/request_permission',{sessionId,toolCall:{toolCallId:'test-tool',title:'Inspect scratch directory',kind:'read',status:'pending',rawInput:{path:'scratch'}},options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'always',name:'Always allow',kind:'allow_always'},{optionId:'no',name:'Reject',kind:'reject_once'}]});if(decision.outcome.outcome==='cancelled')return {stopReason:'cancelled'};}
  let reply;
  if(text.includes('ACP_REFERENCE_EVIDENCE')){
   const input=JSON.parse(text.split('\n\nTask input:\n').at(-1).split('\n\nReturn only the requested JSON value')[0]);
   if(Array.isArray(input.items)){
    const omit=referenceBatches.has(sessionId)?'':'2';
    referenceBatches.add(sessionId);
    reply=JSON.stringify({translations:input.items.filter(item=>item.id!==omit).map(({id})=>({id,chinese:'译文 '+sessionId+' '+id}))});
   }else reply=JSON.stringify({chinese:'逐段译文 '+sessionId});
  }else reply=prompt.some(p=>p.type==='image')&&text.includes('Books')?'{"books":7,"notes":4}':prompt.some(p=>p.type==='image')?'{"code":"Q7M4Z9"}':text.includes('plain text connectivity check')?'OK':text.includes('Return exactly')?'{"status":"ok"}':JSON.stringify({sessionId,text,types:prompt.map(p=>p.type)});
  await ctx.client.notify('session/update',{sessionId,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private thought never shown'}}});
  await ctx.client.notify('session/update',{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:reply.slice(0,8)}}});
  await ctx.client.notify('session/update',{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:reply.slice(8)}}});
  return {stopReason:text.includes('refuse-request')?'refusal':'end_turn'};
 })
 .onNotification('session/cancel',ctx=>waiting.get(ctx.params.sessionId)?.())
 .connect(acp.ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
